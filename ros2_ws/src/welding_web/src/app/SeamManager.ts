import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { ModelLoader } from './ModelLoader';
import {
  DEFAULT_SEAM_PARAMS,
  DEFAULT_SEAM_SETTINGS,
  type SeamDetectionSettings,
  type SeamEdge,
  type SeamProcessParams,
  type SeamSortMode,
  type SeamSource,
  type WeldSeam,
  type WeldType,
} from '../types';

interface SeamVisual {
  group: THREE.Group;
  pickMesh: THREE.Mesh;
}

interface SeamPolyline {
  points: THREE.Vector3[];
  length: number;
  source: SeamSource;
  normal: THREE.Vector3;
  dihedralDeg: number;
}

interface RawSeamSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
  normal: THREE.Vector3;
  dihedralDeg: number;
  source: SeamSource;
  meshAId?: number;
  meshBId?: number;
}

export class SeamManager {
  seams: WeldSeam[] = [];
  settings: SeamDetectionSettings = { ...DEFAULT_SEAM_SETTINGS };
  focusedSeamId: string | null = null;
  /** false РґРѕ ICP вЂ” С€РІС‹ РЅР° CAD, РЅРµ РЅР° СЂРµР°Р»СЊРЅРѕР№ РґРµС‚Р°Р»Рё */
  coRegistered = true;

  private seamVisuals = new Map<string, SeamVisual>();
  private hoverSeamId: string | null = null;
  private pulsePhase = 0;

  constructor(
    private sceneManager: SceneManager,
    private modelLoader: ModelLoader,
  ) {}

  setSettings(partial: Partial<SeamDetectionSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.renderSeams();
  }

  /** РџРѕР»РЅС‹Р№ СЃР±СЂРѕСЃ С€РІРѕРІ Рё РІРёР·СѓР°Р»РёР·Р°С†РёРё (РїСЂРё СЃРјРµРЅРµ CAD). */
  clearAll(): void {
    this.seams = [];
    this.focusedSeamId = null;
    this.hoverSeamId = null;
    this.renderSeams();
  }

  /**
   * РџРѕРёСЃРє СЂРµР°Р»СЊРЅС‹С… СЃРІР°СЂРѕС‡РЅС‹С… С€РІРѕРІ:
   *  1) РєРѕРЅС‚Р°РєС‚РЅС‹Рµ Р»РёРЅРёРё РјРµР¶РґСѓ СЂР°Р·РЅС‹РјРё РјРµС€Р°РјРё СЃР±РѕСЂРєРё (СЂС‘Р±СЂР° РјРµС€Р° A, Р»РµР¶Р°С‰РёРµ РЅР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё РјРµС€Р° B);
   *  2) РІРѕРіРЅСѓС‚С‹Рµ РґРёС…РµРґСЂР°Р»СЊРЅС‹Рµ СЂС‘Р±СЂР° РІРЅСѓС‚СЂРё РѕРґРЅРѕРіРѕ РјРµС€Р° (РјРѕРЅРѕР»РёС‚РЅР°СЏ STL).
   * Р—Р°С‚РµРј СЃС€РёРІРєР° СЃРѕСЃРµРґРЅРёС… СЂС‘Р±РµСЂ РІ РїРѕР»РёР»РёРЅРёРё.
   */
  autoDetectSeams(): WeldSeam[] {
    const meshes = this.modelLoader.getModelMeshes();
    if (meshes.length === 0) {
      this.clearAll();
      return this.seams;
    }

    meshes.forEach((m) => m.updateMatrixWorld(true));
    this.sceneManager.modelGroup.updateMatrixWorld(true);
    this.sceneManager.seamGroup.updateMatrixWorld(true);

    const bbox = this.modelLoader.getModelBounds();
    const diag = bbox.getSize(new THREE.Vector3()).length();
    const contactTol = Math.max(this.settings.contactTolerance, diag * 0.004);
    const minLength = Math.max(this.settings.minLength, diag * 0.006);
    const allTris = meshes.flatMap((m) => this.collectWorldTriangles(m));
    const invModel = this.getModelLocalMatrixInverse();

    const contactSegments = this.detectContactSegments(meshes, contactTol);
    const concaveSegments = this.detectConcaveSegments(meshes);
    let allSegments = [...contactSegments, ...concaveSegments];
    if (meshes.length === 1 || allSegments.length < 4) {
      allSegments = [...allSegments, ...this.detectSharpEdgeSegments(meshes)];
    }

    const seamMergeTol = Math.max(contactTol * 1.5, diag * 0.003);
    const polylines = this.dedupeSpatialPolylines(
      this.groupSegmentsIntoPolylines(allSegments, seamMergeTol),
      Math.max(contactTol * 2.5, diag * 0.008),
    );

    const manual = this.seams.filter((s) => s.source === 'manual');
    const seams: WeldSeam[] = [];
    let idx = 0;
    for (const poly of polylines) {
      if (poly.length < minLength) continue;
      if (poly.length > this.settings.lengthFilterMax) continue;
      if (!this.isValidSeamPolyline(poly.points, allTris, bbox, contactTol)) continue;

      const localPts = poly.points.map((p) => this.toModelLocal(p, invModel));
      const worldQuat = new THREE.Quaternion();
      this.sceneManager.modelGroup.getWorldQuaternion(worldQuat);
      const localNormal = poly.normal.clone().applyQuaternion(worldQuat.invert()).normalize();
      idx += 1;
      const id = `seam-${idx}`;
      const weldType = this.classifyWeldType(poly.dihedralDeg, poly.source, poly.length);
      seams.push({
        id,
        points: localPts.map((p) => [p.x, p.y, p.z]) as [number, number, number][],
        start: [localPts[0].x, localPts[0].y, localPts[0].z],
        end: [
          localPts[localPts.length - 1].x,
          localPts[localPts.length - 1].y,
          localPts[localPts.length - 1].z,
        ],
        midpoint: this.computeMidpoint(localPts),
        length: poly.length,
        autoDetected: true,
        source: poly.source,
        normal: [localNormal.x, localNormal.y, localNormal.z],
        dihedralDeg: poly.dihedralDeg,
        selected: true,
        weldType,
        progress: 0,
        status: 'pending',
        params: { ...DEFAULT_SEAM_PARAMS },
      });
    }

    const sorted = this.sortSeamList([...manual, ...seams], this.settings.sortMode);
    this.seams = sorted.slice(0, this.settings.maxSeamCount);
    this.focusedSeamId = this.seams[0]?.id ?? null;
    this.renderSeams();
    if (this.focusedSeamId) this.focusSeam(this.focusedSeamId, false);
    return this.seams;
  }


  private getModelLocalMatrixInverse(): THREE.Matrix4 {
    this.sceneManager.modelGroup.updateMatrixWorld(true);
    return new THREE.Matrix4().copy(this.sceneManager.modelGroup.matrixWorld).invert();
  }

  private toModelLocal(p: THREE.Vector3, invModel: THREE.Matrix4): THREE.Vector3 {
    return p.clone().applyMatrix4(invModel);
  }

  private isValidSeamPolyline(
    points: THREE.Vector3[],
    allTris: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; normal: THREE.Vector3 }>,
    bbox: THREE.Box3,
    tol: number,
  ): boolean {
    if (points.length < 2) return false;
    const step = Math.max(1, Math.floor(points.length / 6));
    for (let i = 0; i < points.length; i += step) {
      if (this.distanceToTriangles(points[i], allTris) > tol * 8) return false;
    }
    const mid = points[Math.floor(points.length / 2)];
    if (bbox.distanceToPoint(mid) > tol * 24) return false;
    return true;
  }

  // ===== detection: mesh-to-mesh contact =====

  private detectContactSegments(meshes: THREE.Mesh[], tol: number): RawSeamSegment[] {
    const out: RawSeamSegment[] = [];
    if (meshes.length < 2) return out;

    const meshData = meshes.map((m, idx) => ({
      idx,
      mesh: m,
      bbox: new THREE.Box3().setFromObject(m).expandByScalar(tol * 4),
      tris: this.collectWorldTriangles(m),
      edges: this.collectUniqueEdges(m),
    }));

    for (let i = 0; i < meshData.length; i += 1) {
      for (let j = i + 1; j < meshData.length; j += 1) {
        const aData = meshData[i];
        const bData = meshData[j];
        if (!aData.bbox.intersectsBox(bData.bbox)) continue;
        for (const a of [aData, bData]) {
          const b = a === aData ? bData : aData;
          for (const edge of a.edges) {
            if (edge.a.distanceTo(edge.b) < 0.008) continue;

            const dA = this.distanceToTriangles(edge.a, b.tris);
            const dB = this.distanceToTriangles(edge.b, b.tris);
            const mid = edge.a.clone().lerp(edge.b, 0.5);
            const dMid = this.distanceToTriangles(mid, b.tris);
            if (dA > tol || dB > tol || dMid > tol) continue;

            const nB = this.nearestNormal(mid, b.tris);
            const cosNB = Math.abs(edge.normal.dot(nB));
            if (cosNB > 0.88) continue;

            const dihedralDeg = THREE.MathUtils.radToDeg(Math.acos(
              THREE.MathUtils.clamp(Math.abs(edge.normal.dot(nB)), -1, 1),
            ));
            if (dihedralDeg < 18 || dihedralDeg > 162) continue;

            const edgeDir = edge.b.clone().sub(edge.a).normalize();
            if (Math.abs(edgeDir.dot(edge.normal)) > 0.92) continue;
            if (Math.abs(edgeDir.dot(nB)) > 0.92) continue;

            const normal = edge.normal.clone().add(nB).normalize();
            out.push({
              start: edge.a.clone(),
              end: edge.b.clone(),
              normal,
              dihedralDeg,
              source: 'contact',
              meshAId: a.idx,
              meshBId: b.idx,
            });
          }
        }
      }
    }
    return out;
  }

  /** РЈРЅРёРєР°Р»СЊРЅС‹Рµ СЂС‘Р±СЂР° РјРµС€Р° (Р±РµР· РґСѓР±Р»РёСЂРѕРІР°РЅРёСЏ РёР· СЃРѕСЃРµРґРЅРёС… С‚СЂРµСѓРіРѕР»СЊРЅРёРєРѕРІ). */
  private collectUniqueEdges(mesh: THREE.Mesh): Array<{
    a: THREE.Vector3;
    b: THREE.Vector3;
    normal: THREE.Vector3;
  }> {
    const map = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normal: THREE.Vector3 }>();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geometry.attributes.position;
    const mat = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i += 3) {
      const va = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat);
      const vb = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mat);
      const vc = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mat);
      const normal = new THREE.Vector3()
        .crossVectors(vb.clone().sub(va), vc.clone().sub(va))
        .normalize();
      for (const [a, b] of [[va, vb], [vb, vc], [vc, va]] as const) {
        const key = this.edgeKey(a, b);
        if (!map.has(key)) map.set(key, { a: a.clone(), b: b.clone(), normal: normal.clone() });
      }
    }
    return Array.from(map.values());
  }

  // ===== detection: concave intra-mesh edges =====

  private detectConcaveSegments(meshes: THREE.Mesh[]): RawSeamSegment[] {
    const angleThreshold = Math.cos(THREE.MathUtils.degToRad(this.settings.maxAngleDeg));
    const out: RawSeamSegment[] = [];

    for (const mesh of meshes) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = geometry.attributes.position;
      const mat = mesh.matrixWorld;
      const edgeMap = new Map<
        string,
        { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[]; thirdVerts: THREE.Vector3[] }
      >();

      for (let i = 0; i < pos.count; i += 3) {
        const va = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat);
        const vb = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mat);
        const vc = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mat);
        const n = new THREE.Vector3()
          .crossVectors(vb.clone().sub(va), vc.clone().sub(va))
          .normalize();
        this.addDihedralEdge(edgeMap, va, vb, n, vc);
        this.addDihedralEdge(edgeMap, vb, vc, n, va);
        this.addDihedralEdge(edgeMap, vc, va, n, vb);
      }

      for (const [, data] of edgeMap) {
        if (data.normals.length < 2) continue;
        const n1 = data.normals[0];
        const n2 = data.normals[1];
        const dot = n1.dot(n2);
        if (dot > angleThreshold) continue; // РїРѕС‡С‚Рё СЃРѕРїР»РѕСЃРєРѕСЃС‚РЅС‹Рµ вЂ” РЅРµ С€РѕРІ

        // С‚РµСЃС‚ РІРѕРіРЅСѓС‚РѕСЃС‚Рё: edgeDir Г— n1 РЅР°РїСЂР°РІР»РµРЅРѕ Рє С‚СЂРµС‚СЊРµР№ С‚РѕС‡РєРµ РІС‚РѕСЂРѕР№ РіСЂР°РЅРё?
        const mid = data.a.clone().add(data.b).multiplyScalar(0.5);
        const opp1 = data.thirdVerts[0].clone().sub(mid);
        const opp2 = data.thirdVerts[1].clone().sub(mid);
        const concave = opp1.dot(n1) * opp2.dot(n2) < 0;
        if (!concave) continue;

        const dihedralDeg = THREE.MathUtils.radToDeg(Math.acos(
          THREE.MathUtils.clamp(dot, -1, 1),
        ));
        if (
          dihedralDeg < this.settings.tJointMinDeg
          || dihedralDeg > this.settings.tJointMaxDeg
        ) continue;
        const normal = n1.clone().add(n2).normalize();
        out.push({
          start: data.a.clone(),
          end: data.b.clone(),
          normal,
          dihedralDeg,
          source: 'concave',
        });
      }
    }
    return out;
  }

  private addDihedralEdge(
    map: Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[]; thirdVerts: THREE.Vector3[] }>,
    a: THREE.Vector3,
    b: THREE.Vector3,
    normal: THREE.Vector3,
    third: THREE.Vector3,
  ): void {
    const key = this.edgeKey(a, b);
    const entry = map.get(key);
    if (entry) {
      entry.normals.push(normal.clone());
      entry.thirdVerts.push(third.clone());
    } else {
      map.set(key, {
        a: a.clone(),
        b: b.clone(),
        normals: [normal.clone()],
        thirdVerts: [third.clone()],
      });
    }
  }


  /** Sharp feature edges (~90 deg) for monolithic STL/STEP meshes. */
  private detectSharpEdgeSegments(meshes: THREE.Mesh[]): RawSeamSegment[] {
    const minDot = Math.cos(THREE.MathUtils.degToRad(this.settings.tJointMaxDeg));
    const maxDot = Math.cos(THREE.MathUtils.degToRad(this.settings.tJointMinDeg));
    const out: RawSeamSegment[] = [];

    for (const mesh of meshes) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = geometry.attributes.position;
      const mat = mesh.matrixWorld;
      const edgeMap = new Map<
        string,
        { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }
      >();

      for (let i = 0; i < pos.count; i += 3) {
        const va = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat);
        const vb = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mat);
        const vc = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mat);
        const n = new THREE.Vector3()
          .crossVectors(vb.clone().sub(va), vc.clone().sub(va))
          .normalize();
        this.addSharpEdge(edgeMap, va, vb, n);
        this.addSharpEdge(edgeMap, vb, vc, n);
        this.addSharpEdge(edgeMap, vc, va, n);
      }

      for (const [, data] of edgeMap) {
        if (data.normals.length < 2) continue;
        const n1 = data.normals[0];
        const n2 = data.normals[1];
        const dot = n1.dot(n2);
        if (dot > maxDot || dot < minDot) continue;

        const edgeLen = data.a.distanceTo(data.b);
        if (edgeLen < 0.003) continue;

        const dihedralDeg = THREE.MathUtils.radToDeg(Math.acos(
          THREE.MathUtils.clamp(Math.abs(dot), -1, 1),
        ));
        out.push({
          start: data.a.clone(),
          end: data.b.clone(),
          normal: n1.clone().add(n2).normalize(),
          dihedralDeg,
          source: 'sharp',
        });
      }
    }
    return out;
  }

  private addSharpEdge(
    map: Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }>,
    a: THREE.Vector3,
    b: THREE.Vector3,
    normal: THREE.Vector3,
  ): void {
    const key = this.edgeKey(a, b);
    const entry = map.get(key);
    if (entry) entry.normals.push(normal.clone());
    else map.set(key, { a: a.clone(), b: b.clone(), normals: [normal.clone()] });
  }
  // ===== polyline grouping =====

  private groupSegmentsIntoPolylines(
    segments: RawSeamSegment[],
    tol: number,
  ): Array<{ points: THREE.Vector3[]; length: number; source: SeamSource; normal: THREE.Vector3; dihedralDeg: number }> {
    if (segments.length === 0) return [];

    // РЈРґР°Р»РёРј РґСѓР±Р»РёРєР°С‚С‹ (РєРѕРЅС‚Р°РєС‚РЅР°СЏ Р»РёРЅРёСЏ РѕС‚ A->B Рё B->A)
    const unique: RawSeamSegment[] = [];
    const seen = new Set<string>();
    for (const seg of segments) {
      const key = this.edgeKey(seg.start, seg.end);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(seg);
    }

    const remaining = unique.slice();
    const polylines: Array<{
      points: THREE.Vector3[];
      length: number;
      source: SeamSource;
      normal: THREE.Vector3;
      dihedralDeg: number;
    }> = [];

    while (remaining.length > 0) {
      const seed = remaining.pop()!;
      const chain: THREE.Vector3[] = [seed.start.clone(), seed.end.clone()];
      const usedNormals = [seed.normal.clone()];
      const usedDihedral = [seed.dihedralDeg];
      const sources = new Set<SeamSource>([seed.source]);

      let extended = true;
      while (extended) {
        extended = false;
        for (let i = remaining.length - 1; i >= 0; i -= 1) {
          const seg = remaining[i];
          const head = chain[0];
          const tail = chain[chain.length - 1];
          if (!head || !tail || !seg.start || !seg.end || chain.length < 2) continue;
          const dirChain = tail.clone().sub(chain[chain.length - 2]).normalize();
          const dirSeg = seg.end.clone().sub(seg.start).normalize();

          if (tail.distanceTo(seg.start) < tol && Math.abs(dirChain.dot(dirSeg)) > 0.5) {
            chain.push(seg.end.clone());
            usedNormals.push(seg.normal.clone());
            usedDihedral.push(seg.dihedralDeg);
            sources.add(seg.source);
            remaining.splice(i, 1);
            extended = true;
          } else if (tail.distanceTo(seg.end) < tol && Math.abs(dirChain.dot(dirSeg)) > 0.5) {
            chain.push(seg.start.clone());
            usedNormals.push(seg.normal.clone());
            usedDihedral.push(seg.dihedralDeg);
            sources.add(seg.source);
            remaining.splice(i, 1);
            extended = true;
          } else if (head.distanceTo(seg.end) < tol && Math.abs(dirChain.dot(dirSeg)) > 0.5) {
            chain.unshift(seg.start.clone());
            usedNormals.push(seg.normal.clone());
            usedDihedral.push(seg.dihedralDeg);
            sources.add(seg.source);
            remaining.splice(i, 1);
            extended = true;
          } else if (head.distanceTo(seg.start) < tol && Math.abs(dirChain.dot(dirSeg)) > 0.5) {
            chain.unshift(seg.end.clone());
            usedNormals.push(seg.normal.clone());
            usedDihedral.push(seg.dihedralDeg);
            sources.add(seg.source);
            remaining.splice(i, 1);
            extended = true;
          }
        }
      }

      const length = this.polylineLength(chain);
      const avgN = new THREE.Vector3();
      usedNormals.forEach((n) => avgN.add(n));
      avgN.normalize();
      const avgD = usedDihedral.reduce((a, b) => a + b, 0) / usedDihedral.length;
      const source: SeamSource = sources.has('contact') ? 'contact' : sources.has('sharp') ? 'sharp' : 'concave';

      polylines.push({ points: chain, length, source, normal: avgN, dihedralDeg: avgD });
    }

    return polylines;
  }

  private buildSeamCurve(pts: THREE.Vector3[]): THREE.Curve<THREE.Vector3> {
    const valid = pts.filter((p) => p && Number.isFinite(p.x));
    if (valid.length < 2) {
      const a = valid[0] ?? new THREE.Vector3();
      const b = valid[1] ?? a.clone().add(new THREE.Vector3(0.01, 0, 0));
      return new THREE.LineCurve3(a, b);
    }
    if (valid.length === 2) {
      return new THREE.LineCurve3(valid[0], valid[valid.length - 1]);
    }
    return new THREE.CatmullRomCurve3(valid, false, 'centripetal');
  }

  /** Slightly lift seam off the surface so lines are not hidden by CAD depth buffer. */
  private liftSeamPoints(pts: THREE.Vector3[], seam: WeldSeam): THREE.Vector3[] {
    if (pts.length < 2) return pts;
    const bbox = this.modelLoader.getModelBounds();
    const lift = Math.max(bbox.getSize(new THREE.Vector3()).length() * 0.0025, 0.001);
    let n = seam.normal ? new THREE.Vector3(...seam.normal) : new THREE.Vector3();
    if (n.lengthSq() < 1e-8) {
      n = pts[pts.length - 1].clone().sub(pts[0]);
    }
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    else n.normalize();
    const offset = n.multiplyScalar(lift);
    return pts.map((p) => p.clone().add(offset));
  }

  private dedupeSpatialPolylines(polylines: SeamPolyline[], tol: number): SeamPolyline[] {
    const kept: SeamPolyline[] = [];
    for (const poly of polylines) {
      let duplicate = false;
      for (const other of kept) {
        if (this.polylinesOverlap(poly, other, tol)) {
          duplicate = true;
          if (poly.length > other.length) {
            other.points = poly.points;
            other.length = poly.length;
            other.normal = poly.normal;
            other.dihedralDeg = poly.dihedralDeg;
          }
          break;
        }
      }
      if (!duplicate) kept.push(poly);
    }
    return kept;
  }

  private polylinesOverlap(a: SeamPolyline, b: SeamPolyline, tol: number): boolean {
    const dirA = a.points[a.points.length - 1].clone().sub(a.points[0]).normalize();
    const dirB = b.points[b.points.length - 1].clone().sub(b.points[0]).normalize();
    if (Math.abs(dirA.dot(dirB)) < 0.85) return false;

    const midA = a.points[0].clone().lerp(a.points[a.points.length - 1], 0.5);
    const midB = b.points[0].clone().lerp(b.points[b.points.length - 1], 0.5);
    const segDist = this.segmentDistance(
      a.points[0], a.points[a.points.length - 1],
      b.points[0], b.points[b.points.length - 1],
    );
    return segDist < tol && midA.distanceTo(midB) < tol * 2;
  }

  private segmentDistance(a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3): number {
    const samples = 5;
    let maxD = 0;
    for (let i = 0; i < samples; i += 1) {
      const t = i / (samples - 1);
      const pa = a0.clone().lerp(a1, t);
      const pb = b0.clone().lerp(b1, t);
      maxD = Math.max(maxD, pa.distanceTo(pb));
    }
    return maxD;
  }

  private classifyWeldType(dihedralDeg: number, source: SeamSource, length: number): WeldType {
    if (source === 'contact') {
      // РїР»РѕСЃРєРѕСЃС‚СЊ Рє РїР»РѕСЃРєРѕСЃС‚Рё
      if (dihedralDeg > 70 && dihedralDeg < 110) return 'fillet'; // ~РїСЂСЏРјРѕР№ СѓРіРѕР»
      if (dihedralDeg > 150) return 'lap'; // РїР»РѕСЃРєРѕСЃС‚Рё РїРѕС‡С‚Рё РїР°СЂР°Р»Р»РµР»СЊРЅС‹ (РЅР°С…Р»С‘СЃС‚)
      if (length < 0.05) return 'plug';
      return 'corner';
    }
    if (source === 'sharp' || source === 'concave') {
      if (dihedralDeg >= this.settings.tJointMinDeg && dihedralDeg <= this.settings.tJointMaxDeg) return 'fillet';
    }
    if (dihedralDeg < 30) return 'butt';
    return 'corner';
  }

  // ===== helpers =====

  private computeMidpoint(points: THREE.Vector3[]): [number, number, number] {
    const totalLen = this.polylineLength(points);
    const target = totalLen / 2;
    let acc = 0;
    for (let i = 1; i < points.length; i += 1) {
      const len = points[i - 1].distanceTo(points[i]);
      if (acc + len >= target) {
        const t = (target - acc) / Math.max(len, 1e-9);
        const m = new THREE.Vector3().lerpVectors(points[i - 1], points[i], t);
        return [m.x, m.y, m.z];
      }
      acc += len;
    }
    const last = points[points.length - 1];
    return [last.x, last.y, last.z];
  }

  private polylineLength(points: THREE.Vector3[]): number {
    let len = 0;
    for (let i = 1; i < points.length; i += 1) len += points[i - 1].distanceTo(points[i]);
    return len;
  }

  private collectWorldTriangles(mesh: THREE.Mesh): Array<{
    a: THREE.Vector3;
    b: THREE.Vector3;
    c: THREE.Vector3;
    normal: THREE.Vector3;
  }> {
    const out: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; normal: THREE.Vector3 }> = [];
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geometry.attributes.position;
    const mat = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mat);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mat);
      const normal = new THREE.Vector3()
        .crossVectors(b.clone().sub(a), c.clone().sub(a))
        .normalize();
      out.push({ a, b, c, normal });
    }
    return out;
  }

  private distanceToTriangles(
    p: THREE.Vector3,
    tris: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; normal: THREE.Vector3 }>,
  ): number {
    let min = Infinity;
    const tmp = new THREE.Triangle();
    const closest = new THREE.Vector3();
    for (const t of tris) {
      tmp.set(t.a, t.b, t.c);
      tmp.closestPointToPoint(p, closest);
      const d = closest.distanceTo(p);
      if (d < min) {
        min = d;
        if (min < 1e-6) return 0;
      }
    }
    return min;
  }

  private nearestNormal(
    p: THREE.Vector3,
    tris: Array<{ a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; normal: THREE.Vector3 }>,
  ): THREE.Vector3 {
    let min = Infinity;
    let bestN = new THREE.Vector3(0, 1, 0);
    const tmp = new THREE.Triangle();
    const closest = new THREE.Vector3();
    for (const t of tris) {
      tmp.set(t.a, t.b, t.c);
      tmp.closestPointToPoint(p, closest);
      const d = closest.distanceTo(p);
      if (d < min) {
        min = d;
        bestN = t.normal;
      }
    }
    return bestN.clone();
  }

  // ===== public manipulation =====

  toggleSeamSelection(id: string): void {
    const seam = this.seams.find((s) => s.id === id);
    if (!seam) return;
    seam.selected = !seam.selected;
    this.updateSeamVisual(seam);
  }

  setWeldType(id: string, type: WeldType): void {
    const seam = this.seams.find((s) => s.id === id);
    if (!seam) return;
    seam.weldType = type;
    this.updateSeamVisual(seam);
  }

  updateSeamParams(id: string, partial: Partial<SeamProcessParams>): void {
    const seam = this.seams.find((s) => s.id === id);
    if (!seam) return;
    seam.params = { ...seam.params, ...partial };
  }

  reverseSeam(id: string): void {
    const seam = this.seams.find((s) => s.id === id);
    if (!seam || seam.points.length < 2) return;
    seam.points = [...seam.points].reverse() as [number, number, number][];
    const oldStart = seam.start;
    seam.start = seam.end;
    seam.end = oldStart;
    const pts = seam.points.map((p) => new THREE.Vector3(...p));
    seam.midpoint = this.computeMidpoint(pts);
    seam.params.reversed = !seam.params.reversed;
    this.rebuildSeamVisual(seam);
  }

  deleteSeam(id: string): void {
    const idx = this.seams.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const visual = this.seamVisuals.get(id);
    if (visual) {
      this.sceneManager.seamGroup.remove(visual.group);
      this.disposeGroup(visual.group);
      this.seamVisuals.delete(id);
    }
    this.seams.splice(idx, 1);
    if (this.focusedSeamId === id) {
      const next = this.seams[Math.min(idx, this.seams.length - 1)];
      this.focusedSeamId = next?.id ?? null;
      if (next) this.focusSeam(next.id, false);
      else this.seams.forEach((s) => this.updateSeamVisual(s));
    }
  }

  /** Р›СѓС‡ РїРѕ СѓРєР°Р·Р°С‚РµР»СЋ в†’ С‚РѕС‡РєР° РЅР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё CAD (РјРёСЂРѕРІС‹Рµ РєРѕРѕСЂРґРёРЅР°С‚С‹). */
  pickPointOnModel(): THREE.Vector3 | null {
    this.sceneManager.raycaster.setFromCamera(
      this.sceneManager.pointer,
      this.sceneManager.camera,
    );
    const meshes = this.modelLoader.getModelMeshes();
    if (meshes.length === 0) return null;
    const hits = this.sceneManager.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;
    return hits[0].point.clone();
  }

  /** Р СѓС‡РЅРѕР№ С€РѕРІ РїРѕ РґРІСѓРј С‚РѕС‡РєР°Рј РЅР° РїРѕРІРµСЂС…РЅРѕСЃС‚Рё (РјРёСЂРѕРІС‹Рµ РєРѕРѕСЂРґРёРЅР°С‚С‹). */
  addManualSeamFromWorldPoints(aWorld: THREE.Vector3, bWorld: THREE.Vector3): WeldSeam | null {
    const meshes = this.modelLoader.getModelMeshes();
    if (meshes.length === 0) return null;

    meshes.forEach((m) => m.updateMatrixWorld(true));
    this.sceneManager.modelGroup.updateMatrixWorld(true);
    const invModel = this.getModelLocalMatrixInverse();
    const allTris = meshes.flatMap((m) => this.collectWorldTriangles(m));
    const bbox = this.modelLoader.getModelBounds();
    const diag = bbox.getSize(new THREE.Vector3()).length();
    const contactTol = Math.max(this.settings.contactTolerance, diag * 0.002);

    const segLen = aWorld.distanceTo(bWorld);
    if (segLen < this.settings.minLength) return null;

    const samples = Math.max(2, Math.min(24, Math.ceil(segLen / 0.015)));
    const worldPts: THREE.Vector3[] = [];
    for (let i = 0; i < samples; i += 1) {
      worldPts.push(aWorld.clone().lerp(bWorld, i / (samples - 1)));
    }
    if (!this.isValidSeamPolyline(worldPts, allTris, bbox, contactTol)) return null;

    const localPts = worldPts.map((p) => this.toModelLocal(p, invModel));
    const nA = this.nearestNormal(aWorld, allTris);
    const nB = this.nearestNormal(bWorld, allTris);
    const worldQuat = new THREE.Quaternion();
    this.sceneManager.modelGroup.getWorldQuaternion(worldQuat);
    const localNormal = nA.clone().add(nB).normalize().applyQuaternion(worldQuat.invert()).normalize();
    const dihedralDeg = THREE.MathUtils.radToDeg(Math.acos(
      THREE.MathUtils.clamp(Math.abs(nA.dot(nB)), -1, 1),
    ));

    const manualCount = this.seams.filter((s) => s.source === 'manual').length;
    const id = `manual-${manualCount + 1}`;
    const seam: WeldSeam = {
      id,
      points: localPts.map((p) => [p.x, p.y, p.z]) as [number, number, number][],
      start: [localPts[0].x, localPts[0].y, localPts[0].z],
      end: [localPts[localPts.length - 1].x, localPts[localPts.length - 1].y, localPts[localPts.length - 1].z],
      midpoint: this.computeMidpoint(localPts),
      length: segLen,
      autoDetected: false,
      source: 'manual',
      normal: [localNormal.x, localNormal.y, localNormal.z],
      dihedralDeg,
      selected: true,
      weldType: this.classifyWeldType(dihedralDeg, 'manual', segLen),
      progress: 0,
      status: 'pending',
      params: { ...DEFAULT_SEAM_PARAMS },
    };
    this.seams.push(seam);
    this.focusSeam(id);
    this.renderSeams();
    return seam;
  }

  private rebuildSeamVisual(seam: WeldSeam): void {
    const old = this.seamVisuals.get(seam.id);
    if (old) {
      this.sceneManager.seamGroup.remove(old.group);
      this.disposeGroup(old.group);
      this.seamVisuals.delete(seam.id);
    }
    if (!this.settings.showUnselected && !seam.selected) return;
    const visual = this.createSeamVisual(seam);
    this.seamVisuals.set(seam.id, visual);
    this.sceneManager.seamGroup.add(visual.group);
  }

  selectAll(selected: boolean): void {
    this.settings.showUnselected = selected;
    this.seams.forEach((seam) => {
      seam.selected = selected;
    });
    this.renderSeams();
  }

  invertSelection(): void {
    this.seams.forEach((seam) => {
      seam.selected = !seam.selected;
      this.updateSeamVisual(seam);
    });
  }

  focusSeam(id: string | null, animate = true): void {
    this.focusedSeamId = id;
    if (id) {
      const seam = this.seams.find((s) => s.id === id);
      if (seam) {
        const target = this.sceneManager.applyToWorldPoint(new THREE.Vector3(...seam.midpoint));
        const dir = new THREE.Vector3(...(seam.normal ?? [0.6, 0.7, 0.6])).normalize();
        const distance = Math.max(seam.length * 1.8, 0.6);
        const camPos = target.clone().add(dir.clone().multiplyScalar(distance));
        camPos.y = Math.max(camPos.y, target.y + distance * 0.4);

        if (animate) this.sceneManager.flyTo(camPos, target, 600);
        else {
          this.sceneManager.controls.target.copy(target);
          this.sceneManager.camera.position.copy(camPos);
          this.sceneManager.controls.update();
        }
      }
    }
    this.seams.forEach((s) => this.updateSeamVisual(s));
  }

  focusNext(direction: 1 | -1): WeldSeam | null {
    if (this.seams.length === 0) return null;
    const currentIdx = this.focusedSeamId
      ? this.seams.findIndex((s) => s.id === this.focusedSeamId)
      : -1;
    let next = currentIdx + direction;
    if (next < 0) next = this.seams.length - 1;
    if (next >= this.seams.length) next = 0;
    const seam = this.seams[next];
    this.focusSeam(seam.id);
    return seam;
  }

  getSelectedSeams(): WeldSeam[] {
    return this.seams.filter((s) => s.selected);
  }

  getStats(): {
    total: number;
    selected: number;
    totalLength: number;
    selectedLength: number;
    bySource: Record<SeamSource, number>;
  } {
    const selected = this.getSelectedSeams();
    const bySource: Record<SeamSource, number> = { contact: 0, concave: 0, sharp: 0, manual: 0 };
    this.seams.forEach((s) => {
      bySource[s.source] += 1;
    });
    return {
      total: this.seams.length,
      selected: selected.length,
      totalLength: this.seams.reduce((a, s) => a + s.length, 0),
      selectedLength: selected.reduce((a, s) => a + s.length, 0),
      bySource,
    };
  }

  pickSeamAtPointer(): string | null {
    this.sceneManager.seamGroup.updateMatrixWorld(true);
    this.sceneManager.raycaster.setFromCamera(
      this.sceneManager.pointer,
      this.sceneManager.camera,
    );
    const pickMeshes = Array.from(this.seamVisuals.values()).map((v) => v.pickMesh);
    const hits = this.sceneManager.raycaster.intersectObjects(pickMeshes, false);
    if (hits.length === 0) return null;
    return (hits[0].object.userData.seamId as string) ?? null;
  }

  setHoverSeam(id: string | null): void {
    if (this.hoverSeamId === id) return;
    this.hoverSeamId = id;
    this.seams.forEach((seam) => this.updateSeamVisual(seam));
  }

  tick(delta: number): void {
    this.pulsePhase += delta * 4;
    const active = this.seams.find((s) => s.status === 'active');
    if (active) this.updateSeamVisual(active);
  }

  sortSeams(mode?: SeamSortMode): void {
    const m = mode ?? this.settings.sortMode;
    this.seams = this.sortSeamList(this.seams, m);
    this.renderSeams();
  }

  // ===== visualization =====

  renderSeams(): void {
    const { modelGroup, seamGroup } = this.sceneManager;
    if (seamGroup.parent !== modelGroup) {
      modelGroup.add(seamGroup);
    }
    this.sceneManager.clearGroup(seamGroup);
    this.seamVisuals.clear();
    for (const seam of this.seams) {
      if (!this.settings.showUnselected && !seam.selected) continue;
      try {
        const visual = this.createSeamVisual(seam);
        this.seamVisuals.set(seam.id, visual);
        this.sceneManager.seamGroup.add(visual.group);
      } catch (err) {
        console.warn('Seam visual failed:', seam.id, err);
      }
    }
  }

  updateSeamProgress(seam: WeldSeam): void {
    this.updateSeamVisual(seam);
  }

  private createSeamVisual(seam: WeldSeam): SeamVisual {
    const group = new THREE.Group();
    group.userData.seamId = seam.id;
    group.renderOrder = 50;

    const rawPts = seam.points.map((p) => new THREE.Vector3(...p));
    const pts = this.liftSeamPoints(rawPts, seam);
    const color = this.getSeamColor(seam);
    const { coreR, glowR, pickR } = this.getRadii(seam);
    const tubeSegments = Math.max(8, Math.min(64, Math.round(seam.length * 80)));

    let pickMesh: THREE.Mesh;
    try {
      const curve = this.buildSeamCurve(pts);
      const glowGeo = new THREE.TubeGeometry(curve, tubeSegments, glowR, 8, false);
      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: this.getGlowOpacity(seam),
        depthWrite: false,
        depthTest: false,
        fog: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.renderOrder = 50;

      const coreGeo = new THREE.TubeGeometry(curve, tubeSegments, coreR, 10, false);
      const coreMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: this.getCoreOpacity(seam),
        depthWrite: false,
        depthTest: false,
        fog: false,
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.renderOrder = 51;

      const pickGeo = new THREE.TubeGeometry(curve, Math.max(6, tubeSegments / 2), pickR, 6, false);
      pickMesh = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ visible: false }));
      pickMesh.userData.seamId = seam.id;

      group.add(glow, core, pickMesh);
    } catch {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: this.getCoreOpacity(seam),
        depthWrite: false,
        depthTest: false,
        fog: false,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.renderOrder = 51;

      const pickGeo = new THREE.SphereGeometry(pickR, 8, 8);
      pickMesh = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ visible: false }));
      pickMesh.userData.seamId = seam.id;
      pickMesh.position.copy(pts[Math.floor(pts.length / 2)]);

      group.add(line, pickMesh);
    }

    return { group, pickMesh };
  }

  private updateSeamVisual(seam: WeldSeam): void {
    const visual = this.seamVisuals.get(seam.id);
    if (!visual) {
      if (!this.settings.showUnselected && !seam.selected) return;
      const created = this.createSeamVisual(seam);
      this.seamVisuals.set(seam.id, created);
      this.sceneManager.seamGroup.add(created.group);
      return;
    }

    if (!this.settings.showUnselected && !seam.selected) {
      this.sceneManager.seamGroup.remove(visual.group);
      this.disposeGroup(visual.group);
      this.seamVisuals.delete(seam.id);
      return;
    }

    const [glow, core] = visual.group.children as THREE.Mesh[];
    const color = this.getSeamColor(seam);
    (glow.material as THREE.MeshBasicMaterial).color.setHex(color);
    (glow.material as THREE.MeshBasicMaterial).opacity = this.getGlowOpacity(seam);
    (core.material as THREE.MeshBasicMaterial).color.setHex(color);
    (core.material as THREE.MeshBasicMaterial).opacity = this.getCoreOpacity(seam);

    visual.group.scale.setScalar(1);
  }

  private getRadii(seam: WeldSeam): { coreR: number; glowR: number; pickR: number } {
    const base = 0.0032 * this.settings.tubeRadius;
    const mult =
      seam.status === 'active' ? 1.35
      : this.hoverSeamId === seam.id || this.focusedSeamId === seam.id ? 1.1
      : seam.selected ? 1.0
      : 0.8;
    const coreR = base * mult;
    return { coreR, glowR: coreR * 1.8, pickR: Math.max(coreR * 5, 0.018) };
  }

  setCoRegistered(registered: boolean): void {
    this.coRegistered = registered;
    this.renderSeams();
  }

  private getCoreOpacity(seam: WeldSeam): number {
    if (!this.coRegistered) return seam.selected ? 0.72 : 0.45;
    if (seam.status === 'done') return 0.35;
    if (!seam.selected) return 0.22;
    if (seam.status === 'active') return 1;
    return 0.95;
  }

  private getGlowOpacity(seam: WeldSeam): number {
    if (!this.coRegistered) return seam.selected ? 0.45 : 0.22;
    if (!seam.selected && seam.status !== 'active') return 0.08;
    if (seam.status === 'active') return 0.55;
    if (this.hoverSeamId === seam.id || this.focusedSeamId === seam.id) return 0.5;
    return seam.selected ? 0.55 : 0.25;
  }


  private getSeamColor(seam: WeldSeam): number {
    if (seam.status === 'done') return 0x64748b;
    if (seam.status === 'active') return 0xff4444;
    if (this.focusedSeamId === seam.id) return 0xff1a1a;
    if (this.hoverSeamId === seam.id) return 0xff3333;
    return 0xe11d48;
  }

  private sortSeamList<T extends SeamEdge>(list: T[], mode: SeamSortMode): T[] {
    const copy = [...list];
    switch (mode) {
      case 'length-asc':
        return copy.sort((a, b) => a.length - b.length);
      case 'id':
        return copy.sort((a, b) => a.id.localeCompare(b.id));
      default:
        return copy.sort((a, b) => b.length - a.length);
    }
  }

  private edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
    const pa = [a.x, a.y, a.z].map((v) => v.toFixed(3)).join(',');
    const pb = [b.x, b.y, b.z].map((v) => v.toFixed(3)).join(',');
    return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}



