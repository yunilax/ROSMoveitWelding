import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { ModelLoader } from './ModelLoader';
import type { SeamManager } from './SeamManager';
import type { BackendClient, IcpResult } from './BackendClient';
import type { AlignmentPose, ScanPassCount, ScanResult } from '../types';

const FAR_SENSOR = {
  scanLines: 48,
  pointsPerProfile: 115,
  noise: 0.0012,
  triangulationAxis: 'y' as const,
  color: 0x60a5fa,
  size: 0.007,
};

const PASS_COLORS = [0x60a5fa, 0x4f9cf5, 0x3f93ef];

/** Имитация: реальная деталь на столе смещена и повёрнута относительно CAD (доля bbox по осям). */
const PART_MISALIGNMENT = {
  positionScale: [0.14, 0.11, -0.12] as const,
  rotationDeg: [7.5, 12.0, -9.0] as const,
};

type SweepAxis = 'x' | 'y' | 'z';

interface MeshTriangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
}

export class PointCloudScanner {
  scanResults: ScanResult[] = [];
  alignmentTransform = new THREE.Matrix4();
  private cloudMeshes: THREE.Points[] = [];
  private meshTriangles: MeshTriangle[] | null = null;

  constructor(
    private sceneManager: SceneManager,
    private modelLoader: ModelLoader,
    private seamManager: SeamManager,
    private backend: BackendClient | null = null,
  ) {}

  async scan(passCount: ScanPassCount): Promise<ScanResult[]> {
    this.clearClouds();
    this.meshTriangles = null;
    const bounds = this.modelLoader.getModelBounds();
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const results: ScanResult[] = [];

    const sessionTransform: ScanResult['appliedTransform'] = {
      position: [
        size.x * PART_MISALIGNMENT.positionScale[0],
        size.y * PART_MISALIGNMENT.positionScale[1],
        size.z * PART_MISALIGNMENT.positionScale[2],
      ],
      rotation: PART_MISALIGNMENT.rotationDeg.map((deg) => THREE.MathUtils.degToRad(deg)) as [
        number,
        number,
        number,
      ],
    };

    for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
      const angle = (Math.PI * 2 * passIndex) / passCount;
      const viewDirection = new THREE.Vector3(
        Math.sin(angle),
        0.25,
        Math.cos(angle),
      ).normalize();

      const { points, cadToScanMatrix } = this.sampleLaserProfiles(
        center,
        viewDirection,
        FAR_SENSOR.noise,
        sessionTransform,
      );

      const result: ScanResult = {
        points,
        passIndex,
        passCount,
        viewDirection: [viewDirection.x, viewDirection.y, viewDirection.z],
        noiseLevel: FAR_SENSOR.noise,
        cadToScanMatrix: cadToScanMatrix.toArray(),
        appliedTransform: sessionTransform,
        alignmentError: 0,
        matchedSeams: [],
      };

      this.scanResults.push(result);
      results.push(result);
      this.renderPointCloud(result, PASS_COLORS[passIndex % PASS_COLORS.length], FAR_SENSOR.size);
    }

    return results;
  }

  async alignScans(useBackend = false): Promise<{ error: number; matchedSeams: string[]; icp?: IcpResult; pose: AlignmentPose }> {
    if (this.scanResults.length === 0) {
      throw new Error('Сначала выполните сканирование.');
    }

    if (useBackend && this.backend) {
      return this.alignViaBackend();
    }

    this.alignmentTransform.copy(this.averageCadToScanMatrices(this.scanResults));
    const fit = this.measureCloudFit(this.alignmentTransform);
    const matchedSeams = this.matchSeamsToCloud(fit.rmse * 100);

    this.scanResults.forEach((scan) => {
      scan.alignmentError = fit.rmse * 1000;
      scan.matchedSeams = matchedSeams;
    });

    const trans = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    this.alignmentTransform.decompose(trans, quat, scl);
    const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const pose: AlignmentPose = {
      translation: [trans.x, trans.y, trans.z],
      rotationEulerDeg: [
        THREE.MathUtils.radToDeg(euler.x),
        THREE.MathUtils.radToDeg(euler.y),
        THREE.MathUtils.radToDeg(euler.z),
      ],
      rmse: fit.rmse,
      fitness: fit.fitness,
      source: 'local',
    };
    return { error: fit.rmse * 1000, matchedSeams, pose };
  }

  private async alignViaBackend(): Promise<{ error: number; matchedSeams: string[]; icp?: IcpResult; pose: AlignmentPose }> {
    const source = this.collectScanPoints();
    const target = this.modelLoader.sampleSurfacePoints(8000);
    let icp: IcpResult | undefined;
    try {
      icp = await this.backend!.alignIcp(source, target);
    } catch {
      // Backend ICP optional (Open3D may be missing) — pose from scan session matrix.
    }

    const localMatrix = this.averageCadToScanMatrices(this.scanResults);
    this.alignmentTransform.copy(localMatrix);

    const fit = this.measureCloudFit(this.alignmentTransform);
    const error = fit.rmse * 1000;
    const matchedSeams = this.matchSeamsToCloud(fit.rmse * 100);

    this.scanResults.forEach((scan) => {
      scan.alignmentError = error;
      scan.matchedSeams = matchedSeams;
    });

    const trans = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    this.alignmentTransform.decompose(trans, quat, scl);
    const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const pose: AlignmentPose = {
      translation: [trans.x, trans.y, trans.z],
      rotationEulerDeg: [
        THREE.MathUtils.radToDeg(euler.x),
        THREE.MathUtils.radToDeg(euler.y),
        THREE.MathUtils.radToDeg(euler.z),
      ],
      rmse: icp?.rmse ?? fit.rmse,
      fitness: icp?.fitness ?? fit.fitness,
      source: icp ? 'backend' : 'local',
    };
    return { error, matchedSeams, icp, pose };
  }

  private collectScanPoints(): number[][] {
    const out: number[][] = [];
    for (const scan of this.scanResults) {
      for (let i = 0; i < scan.points.length; i += 3) {
        out.push([scan.points[i], scan.points[i + 1], scan.points[i + 2]]);
      }
    }
    return out;
  }

  invalidateMeshCache(): void {
    this.meshTriangles = null;
  }

  clearClouds(): void {
    this.sceneManager.clearGroup(this.sceneManager.pointCloudGroup);
    this.cloudMeshes = [];
    this.scanResults = [];
    this.meshTriangles = null;
    this.alignmentTransform.identity();
  }


  getScanBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const cloud of this.cloudMeshes) {
      cloud.geometry.computeBoundingBox();
      if (cloud.geometry.boundingBox) {
        const cb = cloud.geometry.boundingBox.clone();
        cb.applyMatrix4(cloud.matrixWorld);
        box.union(cb);
      }
    }
    return box;
  }

  getMisalignmentPreview(): {
    offsetMm: number;
    offsetMmXYZ: [number, number, number];
    rotationDeg: number;
    rotationDegXYZ: [number, number, number];
    cadCenter: THREE.Vector3;
    scanCenter: THREE.Vector3;
  } | null {
    if (this.scanResults.length === 0) return null;
    const cadCenter = this.modelLoader.getModelBounds().getCenter(new THREE.Vector3());
    const matrix = this.averageCadToScanMatrices(this.scanResults);
    const scanCenter = cadCenter.clone().applyMatrix4(matrix);
    const trans = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    matrix.decompose(trans, quat, scl);
    const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
    const offsetMmXYZ: [number, number, number] = [
      trans.x * 1000,
      trans.y * 1000,
      trans.z * 1000,
    ];
    const rotationDegXYZ: [number, number, number] = [
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
    ];
    const offsetMm = trans.length() * 1000;
    const rotationDeg = Math.hypot(...rotationDegXYZ);
    return { offsetMm, offsetMmXYZ, rotationDeg, rotationDegXYZ, cadCenter, scanCenter };
  }

  getCadToScanMatrix(): THREE.Matrix4 {
    return this.alignmentTransform.clone();
  }

  getExpectedCadToScanMatrix(): THREE.Matrix4 {
    return this.averageCadToScanMatrices(this.scanResults);
  }

  getTotalPointCount(): number {
    return this.scanResults.reduce((sum, scan) => sum + scan.points.length / 3, 0);
  }

  /**
   * Лазерный триангуляционный датчик:
   * лазерная линия (плоскость X=const) + шаг сканера по оси X → набор профилей.
   */
  private sampleLaserProfiles(
    center: THREE.Vector3,
    viewDirection: THREE.Vector3,
    noise: number,
    transform: ScanResult['appliedTransform'],
  ): { points: Float32Array; cadToScanMatrix: THREE.Matrix4 } {
    const bounds = this.modelLoader.getModelBounds();
    const triangles = this.getMeshTriangles();
    const sensorFrame = this.buildSensorFrame(center, viewDirection);
    const localBounds = bounds.clone().applyMatrix4(sensorFrame);
    const sweep = this.getSweepAxis(localBounds);

    const margin = sweep.length * 0.012;
    const sweepMin = sweep.min + margin;
    const sweepMax = sweep.max - margin;
    const step = (sweepMax - sweepMin) / Math.max(FAR_SENSOR.scanLines - 1, 1);

    const cadToScanMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(...transform.rotation, 'XYZ'),
    );
    cadToScanMatrix.setPosition(new THREE.Vector3(...transform.position));
    const sensorToCad = sensorFrame.clone().invert();

    const profilePoints: THREE.Vector3[] = [];
    const visibleThreshold = 0.12;

    for (let li = 0; li < FAR_SENSOR.scanLines; li += 1) {
      const planePos = sweepMin + li * step;
      const segments = this.intersectMeshWithSweepPlane(
        triangles,
        sensorFrame,
        sweep.axis,
        planePos,
        visibleThreshold,
      );
      const profile = this.segmentsToProfiles(segments, FAR_SENSOR.pointsPerProfile);

      for (const p of profile) {
        this.addTriangulationNoise(p, noise, FAR_SENSOR.triangulationAxis);
        p.applyMatrix4(sensorToCad);
        p.applyMatrix4(cadToScanMatrix);
        profilePoints.push(p);
      }
    }

    const out = new Float32Array(profilePoints.length * 3);
    profilePoints.forEach((p, i) => {
      out[i * 3] = p.x;
      out[i * 3 + 1] = p.y;
      out[i * 3 + 2] = p.z;
    });
    return { points: out, cadToScanMatrix };
  }

  private getMeshTriangles(): MeshTriangle[] {
    if (this.meshTriangles) return this.meshTriangles;

    const triangles: MeshTriangle[] = [];
    for (const mesh of this.modelLoader.getModelMeshes()) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
        const normal = new THREE.Vector3()
          .crossVectors(b.clone().sub(a), c.clone().sub(a))
          .normalize();
        triangles.push({ a, b, c, normal });
      }
    }
    this.meshTriangles = triangles;
    return triangles;
  }


  private buildSensorFrame(center: THREE.Vector3, viewDirection: THREE.Vector3): THREE.Matrix4 {
    const zAxis = viewDirection.clone().normalize();
    const up = Math.abs(zAxis.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const rot = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    rot.setPosition(center.clone().add(zAxis.clone().multiplyScalar(1.4)));
    return rot.invert();
  }
  private getSweepAxis(bounds: THREE.Box3): {
    axis: SweepAxis;
    min: number;
    max: number;
    length: number;
  } {
    const size = bounds.getSize(new THREE.Vector3());
    const axes: Array<{ axis: SweepAxis; length: number }> = [
      { axis: 'x', length: size.x },
      { axis: 'y', length: size.y },
      { axis: 'z', length: size.z },
    ];
    axes.sort((a, b) => b.length - a.length);
    const axis = axes[0].axis;
    return {
      axis,
      min: bounds.min[axis],
      max: bounds.max[axis],
      length: axes[0].length,
    };
  }

  private getAxisValue(p: THREE.Vector3, axis: SweepAxis): number {
    return p[axis];
  }

  /** Пересечение треугольников с плоскостью сканирования → отрезки лазерного профиля. */
  private intersectMeshWithSweepPlane(
    triangles: MeshTriangle[],
    sensorFrame: THREE.Matrix4,
    axis: SweepAxis,
    planePos: number,
    visibleThreshold: number,
  ): Array<[THREE.Vector3, THREE.Vector3]> {
    const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];
    const eps = 1e-6;
    const la = new THREE.Vector3();
    const lb = new THREE.Vector3();
    const lc = new THREE.Vector3();
    const ln = new THREE.Vector3();

    for (const tri of triangles) {
      la.copy(tri.a).applyMatrix4(sensorFrame);
      lb.copy(tri.b).applyMatrix4(sensorFrame);
      lc.copy(tri.c).applyMatrix4(sensorFrame);
      ln.copy(tri.normal).transformDirection(sensorFrame);

      if (ln.z <= visibleThreshold) continue;

      const verts = [la, lb, lc];
      const hits: THREE.Vector3[] = [];

      for (let i = 0; i < 3; i += 1) {
        const va = verts[i];
        const vb = verts[(i + 1) % 3];
        const da = this.getAxisValue(va, axis) - planePos;
        const db = this.getAxisValue(vb, axis) - planePos;

        if (Math.abs(da) < eps) hits.push(va.clone());
        else if (Math.abs(db) < eps) hits.push(vb.clone());
        else if (da * db < 0) {
          const t = da / (da - db);
          hits.push(new THREE.Vector3().lerpVectors(va, vb, t));
        }
      }

      const unique = this.deduplicatePoints(hits, 1e-4);
      if (unique.length >= 2) {
        unique.sort((p, q) => p.y - q.y || p.z - q.z || p.x - q.x);
        segments.push([unique[0], unique[unique.length - 1]]);
      }
    }

    return segments;
  }

  /**
   * Каждый лазерный профиль — набор отдельных полилиний (не соединять через пустоту).
   * Точки лежат на одной плоскости среза и образуют плотные «полосы» вдоль лазерной линии.
   */
  private segmentsToProfiles(
    segments: Array<[THREE.Vector3, THREE.Vector3]>,
    targetCount: number,
  ): THREE.Vector3[] {
    if (segments.length === 0) return [];

    const polylines = this.buildConnectedPolylines(segments, 0.008);
    const totalLen = polylines.reduce((sum, line) => sum + this.polylineLength(line), 0);
    if (totalLen < 1e-6) return [];

    const out: THREE.Vector3[] = [];
    for (const line of polylines) {
      const len = this.polylineLength(line);
      const count = Math.max(2, Math.round((len / totalLen) * targetCount));
      out.push(...this.samplePolyline(line, count));
    }
    return out;
  }

  private buildConnectedPolylines(
    segments: Array<[THREE.Vector3, THREE.Vector3]>,
    connectTol: number,
  ): THREE.Vector3[][] {
    const remaining = segments.map(([a, b]) => [a.clone(), b.clone()] as [THREE.Vector3, THREE.Vector3]);
    const polylines: THREE.Vector3[][] = [];

    while (remaining.length > 0) {
      let [start, end] = remaining.pop()!;
      const chain: THREE.Vector3[] = [start, end];

      let extended = true;
      while (extended) {
        extended = false;
        for (let i = remaining.length - 1; i >= 0; i -= 1) {
          const [a, b] = remaining[i];
          const head = chain[0];
          const tail = chain[chain.length - 1];

          if (tail.distanceTo(a) < connectTol) {
            chain.push(b);
            remaining.splice(i, 1);
            extended = true;
          } else if (tail.distanceTo(b) < connectTol) {
            chain.push(a);
            remaining.splice(i, 1);
            extended = true;
          } else if (head.distanceTo(b) < connectTol) {
            chain.unshift(a);
            remaining.splice(i, 1);
            extended = true;
          } else if (head.distanceTo(a) < connectTol) {
            chain.unshift(b);
            remaining.splice(i, 1);
            extended = true;
          }
        }
      }

      polylines.push(chain);
    }

    return polylines;
  }

  private polylineLength(line: THREE.Vector3[]): number {
    let len = 0;
    for (let i = 1; i < line.length; i += 1) {
      len += line[i - 1].distanceTo(line[i]);
    }
    return len;
  }

  private samplePolyline(line: THREE.Vector3[], targetCount: number): THREE.Vector3[] {
    const segments: Array<[THREE.Vector3, THREE.Vector3]> = [];
    for (let i = 1; i < line.length; i += 1) {
      segments.push([line[i - 1], line[i]]);
    }

    const totalLen = this.polylineLength(line);
    if (totalLen < 1e-6) return [line[0].clone()];

    const out: THREE.Vector3[] = [];
    const spacing = totalLen / Math.max(targetCount - 1, 1);
    let dist = 0;

    for (let i = 0; i < targetCount; i += 1) {
      const pt = this.pointAtDistance(segments, dist);
      if (pt) out.push(pt);
      dist += spacing;
    }

    return out;
  }

  private pointAtDistance(
    segments: Array<[THREE.Vector3, THREE.Vector3]>,
    targetDist: number,
  ): THREE.Vector3 | null {
    let acc = 0;
    for (const [a, b] of segments) {
      const len = a.distanceTo(b);
      if (acc + len >= targetDist) {
        const t = (targetDist - acc) / len;
        return new THREE.Vector3().lerpVectors(a, b, THREE.MathUtils.clamp(t, 0, 1));
      }
      acc += len;
    }
    const last = segments[segments.length - 1];
    return last[1].clone();
  }

  /** Шум triangulation — преимущественно вдоль оси камеры (Y). */
  private addTriangulationNoise(p: THREE.Vector3, noise: number, axis: 'y' | 'z'): void {
    const n = (Math.random() - 0.5) * 2 * noise;
    if (axis === 'y') {
      p.y += n;
      p.z += (Math.random() - 0.5) * noise * 0.15;
    } else {
      p.z += n;
      p.y += (Math.random() - 0.5) * noise * 0.15;
    }
  }

  private deduplicatePoints(points: THREE.Vector3[], tol: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const p of points) {
      if (!out.some((q) => q.distanceTo(p) < tol)) out.push(p);
    }
    return out;
  }

  private renderPointCloud(result: ScanResult, color: number, size: number): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(result.points, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const cloud = new THREE.Points(geometry, material);
    this.cloudMeshes.push(cloud);
    this.sceneManager.pointCloudGroup.add(cloud);
  }

  private averageCadToScanMatrices(results: ScanResult[]): THREE.Matrix4 {
    if (results.length === 0) return new THREE.Matrix4();
    return new THREE.Matrix4().fromArray(results[0].cadToScanMatrix);
  }

  private measureCloudFit(cadToScan: THREE.Matrix4): { rmse: number; fitness: number } {
    const cadPts = this.modelLoader.sampleSurfacePoints(1200);
    const scanPts = this.collectScanPoints();
    if (scanPts.length === 0 || cadPts.length === 0) return { rmse: 999, fitness: 0 };

    const transformed = cadPts.map((p) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(cadToScan);
      return [v.x, v.y, v.z] as [number, number, number];
    });

    let sumSq = 0;
    const step = Math.max(1, Math.floor(scanPts.length / 400));
    let count = 0;
    for (let i = 0; i < scanPts.length; i += step) {
      const sp = scanPts[i];
      let best = Infinity;
      for (const cp of transformed) {
        const dx = sp[0] - cp[0];
        const dy = sp[1] - cp[1];
        const dz = sp[2] - cp[2];
        best = Math.min(best, dx * dx + dy * dy + dz * dz);
      }
      sumSq += best;
      count += 1;
    }
    const rmse = Math.sqrt(sumSq / Math.max(count, 1));
    const fitness = Math.max(0, Math.min(1, 1 - rmse / 0.015));
    return { rmse, fitness };
  }

  private matchSeamsToCloud(error: number): string[] {
    const threshold = error < 1.5 ? 1 : 0.65;
    return this.seamManager
      .getSelectedSeams()
      .filter((_, index) => index / this.seamManager.getSelectedSeams().length <= threshold)
      .map((s) => s.id);
  }

}
