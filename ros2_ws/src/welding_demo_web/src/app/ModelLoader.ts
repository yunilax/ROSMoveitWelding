import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SceneManager } from './SceneManager';

const CAD_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x94a3b8,
  metalness: 0.35,
  roughness: 0.55,
  flatShading: false,
});

export class ModelLoader {
  private stlLoader = new STLLoader();
  private objLoader = new OBJLoader();
  private gltfLoader = new GLTFLoader();

  constructor(private sceneManager: SceneManager) {}

  loadDemoWorkpiece(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'demo-workpiece';

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.08, 0.9),
      CAD_MATERIAL.clone(),
    );
    base.position.set(0, 0.04, 0);
    base.castShadow = true;
    base.receiveShadow = true;

    const vertical = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.7, 0.9),
      CAD_MATERIAL.clone(),
    );
    vertical.position.set(-0.76, 0.39, 0);
    vertical.castShadow = true;

    const flange = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.5),
      CAD_MATERIAL.clone(),
    );
    flange.position.set(0.55, 0.11, 0.15);
    flange.castShadow = true;

    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.55, 24),
      CAD_MATERIAL.clone(),
    );
    pipe.position.set(0.55, 0.415, 0.15);
    pipe.castShadow = true;

    group.add(base, vertical, flange, pipe);
    return group;
  }

  async loadFile(file: File, backend?: { convertStep: (f: File) => Promise<Blob> }): Promise<THREE.Group> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    if ((ext === 'step' || ext === 'stp') && backend) {
      const stlBlob = await backend.convertStep(file);
      const url = URL.createObjectURL(stlBlob);
      try {
        return await this.loadStl(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const url = URL.createObjectURL(file);

    try {
      switch (ext) {
        case 'stl':
          return this.loadStl(url);
        case 'obj':
          return this.loadObj(url);
        case 'gltf':
        case 'glb':
          return this.loadGltf(url);
        case 'step':
        case 'stp':
          throw new Error('STEP требует backend API. Запустите welding_demo_backend на :8000');
        default:
          throw new Error(`Формат .${ext} не поддерживается. Используйте STL, OBJ, GLTF/GLB или STEP (с backend).`);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  setModel(group: THREE.Group): void {
    this.sceneManager.clearGroup(this.sceneManager.modelGroup);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (!Array.isArray(child.material)) {
          child.material = CAD_MATERIAL.clone();
        }
      }
    });
    this.sceneManager.modelGroup.add(group);
    this.sceneManager.frameObject(group);
  }

  getModelMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    this.sceneManager.modelGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    return meshes;
  }

  getModelBounds(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.sceneManager.modelGroup);
  }

  sampleSurfacePoints(count = 8000): number[][] {
    const meshes = this.getModelMeshes();
    const points: THREE.Vector3[] = [];

    for (const mesh of meshes) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
        const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
        const r1 = Math.random();
        const r2 = Math.random();
        const sqrtR1 = Math.sqrt(r1);
        points.push(new THREE.Vector3(
          (1 - sqrtR1) * a.x + sqrtR1 * (1 - r2) * b.x + sqrtR1 * r2 * c.x,
          (1 - sqrtR1) * a.y + sqrtR1 * (1 - r2) * b.y + sqrtR1 * r2 * c.y,
          (1 - sqrtR1) * a.z + sqrtR1 * (1 - r2) * b.z + sqrtR1 * r2 * c.z,
        ));
      }
    }

    if (points.length === 0) return [];
    const step = Math.max(1, Math.floor(points.length / count));
    const sampled: number[][] = [];
    for (let i = 0; i < points.length && sampled.length < count; i += step) {
      const p = points[i];
      sampled.push([p.x, p.y, p.z]);
    }
    return sampled;
  }

  private loadStl(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.stlLoader.load(
        url,
        (geometry) => {
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, CAD_MATERIAL.clone());
          const group = new THREE.Group();
          group.add(mesh);
          resolve(group);
        },
        undefined,
        reject,
      );
    });
  }

  private loadObj(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.objLoader.load(url, resolve, undefined, reject);
    });
  }

  private loadGltf(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const group = new THREE.Group();
          group.add(gltf.scene);
          resolve(group);
        },
        undefined,
        reject,
      );
    });
  }
}
