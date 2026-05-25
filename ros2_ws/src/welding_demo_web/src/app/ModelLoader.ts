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

  async loadFile(file: File): Promise<THREE.Group> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
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
        default:
          throw new Error(`Формат .${ext} не поддерживается. Используйте STL, OBJ или GLTF/GLB.`);
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
