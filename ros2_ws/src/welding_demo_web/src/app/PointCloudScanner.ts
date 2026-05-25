import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { ModelLoader } from './ModelLoader';
import type { SeamManager } from './SeamManager';
import type { ScanResult, SensorMode } from '../types';

const SENSOR_CONFIG: Record<SensorMode, { count: number; noise: number; color: number; size: number }> = {
  far: { count: 3500, noise: 0.018, color: 0x60a5fa, size: 0.012 },
  near: { count: 12000, noise: 0.004, color: 0x34d399, size: 0.006 },
};

export class PointCloudScanner {
  scanResults: ScanResult[] = [];
  alignmentTransform = new THREE.Matrix4();
  private cloudMeshes: THREE.Points[] = [];

  constructor(
    private sceneManager: SceneManager,
    private modelLoader: ModelLoader,
    private seamManager: SeamManager,
  ) {}

  async scan(sensor: SensorMode): Promise<ScanResult> {
    const config = SENSOR_CONFIG[sensor];
    const bounds = this.modelLoader.getModelBounds();
    const size = bounds.getSize(new THREE.Vector3());

    const appliedTransform = {
      position: [
        (Math.random() - 0.5) * size.x * 0.08,
        (Math.random() - 0.5) * size.y * 0.05,
        (Math.random() - 0.5) * size.z * 0.08,
      ] as [number, number, number],
      rotation: [
        THREE.MathUtils.degToRad((Math.random() - 0.5) * 6),
        THREE.MathUtils.degToRad((Math.random() - 0.5) * 8),
        THREE.MathUtils.degToRad((Math.random() - 0.5) * 4),
      ] as [number, number, number],
    };

    const points = this.generatePointCloud(bounds, config.count, config.noise, appliedTransform);
    const result: ScanResult = {
      points,
      sensor,
      noiseLevel: config.noise,
      appliedTransform,
      alignmentError: 0,
      matchedSeams: [],
    };

    this.scanResults.push(result);
    this.renderPointCloud(result, config.color, config.size);
    return result;
  }

  async alignScans(): Promise<{ error: number; matchedSeams: string[] }> {
    if (this.scanResults.length === 0) {
      throw new Error('Сначала выполните сканирование.');
    }

    const bounds = this.modelLoader.getModelBounds();
    const size = bounds.getSize(new THREE.Vector3());
    const avgTransform = this.averageTransforms(this.scanResults);

    this.alignmentTransform.identity();
    this.alignmentTransform.makeRotationFromEuler(
      new THREE.Euler(...avgTransform.rotation, 'XYZ'),
    );
    this.alignmentTransform.setPosition(new THREE.Vector3(...avgTransform.position));

    const error = this.computeAlignmentError(avgTransform, size);
    const matchedSeams = this.matchSeamsToCloud(error);

    this.scanResults.forEach((scan) => {
      scan.alignmentError = error;
      scan.matchedSeams = matchedSeams;
    });

    this.applyAlignmentToClouds();
    return { error, matchedSeams };
  }

  clearClouds(): void {
    this.sceneManager.clearGroup(this.sceneManager.pointCloudGroup);
    this.cloudMeshes = [];
    this.scanResults = [];
    this.alignmentTransform.identity();
  }

  private generatePointCloud(
    bounds: THREE.Box3,
    count: number,
    noise: number,
    transform: ScanResult['appliedTransform'],
  ): Float32Array {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const points = new Float32Array(count * 3);
    const matrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(...transform.rotation, 'XYZ'),
    );
    matrix.setPosition(new THREE.Vector3(...transform.position));

    for (let i = 0; i < count; i += 1) {
      const local = new THREE.Vector3(
        center.x + (Math.random() - 0.5) * size.x * 1.05,
        center.y + (Math.random() - 0.5) * size.y * 1.05,
        center.z + (Math.random() - 0.5) * size.z * 1.05,
      );
      local.add(new THREE.Vector3(
        (Math.random() - 0.5) * noise,
        (Math.random() - 0.5) * noise,
        (Math.random() - 0.5) * noise,
      ));
      local.applyMatrix4(matrix);
      points[i * 3] = local.x;
      points[i * 3 + 1] = local.y;
      points[i * 3 + 2] = local.z;
    }

    return points;
  }

  private renderPointCloud(result: ScanResult, color: number, size: number): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(result.points, 3));
    const material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });
    const cloud = new THREE.Points(geometry, material);
    this.cloudMeshes.push(cloud);
    this.sceneManager.pointCloudGroup.add(cloud);
  }

  private averageTransforms(results: ScanResult[]): ScanResult['appliedTransform'] {
    const sum = results.reduce(
      (acc, r) => {
        acc.position[0] += r.appliedTransform.position[0];
        acc.position[1] += r.appliedTransform.position[1];
        acc.position[2] += r.appliedTransform.position[2];
        acc.rotation[0] += r.appliedTransform.rotation[0];
        acc.rotation[1] += r.appliedTransform.rotation[1];
        acc.rotation[2] += r.appliedTransform.rotation[2];
        return acc;
      },
      {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
      },
    );
    const n = results.length;
    return {
      position: [sum.position[0] / n, sum.position[1] / n, sum.position[2] / n],
      rotation: [sum.rotation[0] / n, sum.rotation[1] / n, sum.rotation[2] / n],
    };
  }

  private computeAlignmentError(
    transform: ScanResult['appliedTransform'],
    size: THREE.Vector3,
  ): number {
    const posErr = Math.hypot(...transform.position);
    const rotErr = Math.hypot(...transform.rotation);
    const scale = Math.max(size.x, size.y, size.z);
    return (posErr / scale) * 100 + rotErr * 57.3 * 0.15;
  }

  private matchSeamsToCloud(error: number): string[] {
    const threshold = error < 1.5 ? 1 : 0.65;
    return this.seamManager
      .getSelectedSeams()
      .filter((_, index) => index / this.seamManager.getSelectedSeams().length <= threshold)
      .map((s) => s.id);
  }

  private applyAlignmentToClouds(): void {
    this.cloudMeshes.forEach((cloud) => {
      cloud.applyMatrix4(this.alignmentTransform.clone().invert());
    });
  }
}
