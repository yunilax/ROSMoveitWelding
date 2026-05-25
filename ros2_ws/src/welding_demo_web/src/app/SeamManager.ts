import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { ModelLoader } from './ModelLoader';
import {
  WELD_TYPE_COLORS,
  type SeamEdge,
  type WeldSeam,
  type WeldType,
} from '../types';

const EDGE_ANGLE_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(35));

export class SeamManager {
  seams: WeldSeam[] = [];
  private candidateEdges: SeamEdge[] = [];
  private seamMeshes = new Map<string, THREE.Line>();
  private hoverSeamId: string | null = null;

  constructor(
    private sceneManager: SceneManager,
    private modelLoader: ModelLoader,
  ) {}

  autoDetectSeams(): WeldSeam[] {
    const meshes = this.modelLoader.getModelMeshes();
    const edges: SeamEdge[] = [];
    const seen = new Set<string>();

    for (const mesh of meshes) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = geometry.attributes.position;
      const edgeMap = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; faces: THREE.Vector3[] }>();

      for (let i = 0; i < pos.count; i += 3) {
        const vA = new THREE.Vector3().fromBufferAttribute(pos, i);
        const vB = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const vC = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        vA.applyMatrix4(mesh.matrixWorld);
        vB.applyMatrix4(mesh.matrixWorld);
        vC.applyMatrix4(mesh.matrixWorld);

        const normal = new THREE.Vector3()
          .subVectors(vB, vA)
          .cross(new THREE.Vector3().subVectors(vC, vA))
          .normalize();

        this.addEdge(edgeMap, vA, vB, normal);
        this.addEdge(edgeMap, vB, vC, normal);
        this.addEdge(edgeMap, vC, vA, normal);
      }

      for (const [, data] of edgeMap) {
        if (data.faces.length < 2) continue;
        const n1 = data.faces[0];
        const n2 = data.faces[1];
        if (n1.dot(n2) > EDGE_ANGLE_THRESHOLD) continue;

        const key = this.edgeKey(data.a, data.b);
        if (seen.has(key)) continue;
        seen.add(key);

        const start: [number, number, number] = [data.a.x, data.a.y, data.a.z];
        const end: [number, number, number] = [data.b.x, data.b.y, data.b.z];
        const midpoint: [number, number, number] = [
          (start[0] + end[0]) / 2,
          (start[1] + end[1]) / 2,
          (start[2] + end[2]) / 2,
        ];
        const length = data.a.distanceTo(data.b);

        if (length < 0.05) continue;

        edges.push({
          id: `seam-${edges.length + 1}`,
          start,
          end,
          midpoint,
          length,
          autoDetected: true,
        });
      }
    }

    this.candidateEdges = edges.sort((a, b) => b.length - a.length).slice(0, 24);
    this.seams = this.candidateEdges.map((edge) => ({
      ...edge,
      selected: true,
      weldType: this.guessWeldType(edge),
      progress: 0,
      status: 'pending',
    }));

    this.renderSeams();
    return this.seams;
  }

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

  selectAll(selected: boolean): void {
    this.seams.forEach((seam) => {
      seam.selected = selected;
      this.updateSeamVisual(seam);
    });
  }

  getSelectedSeams(): WeldSeam[] {
    return this.seams.filter((s) => s.selected);
  }

  pickSeamAtPointer(): string | null {
    this.sceneManager.raycaster.setFromCamera(
      this.sceneManager.pointer,
      this.sceneManager.camera,
    );
    const hits = this.sceneManager.raycaster.intersectObjects(
      Array.from(this.seamMeshes.values()),
      false,
    );
    if (hits.length === 0) return null;
    const mesh = hits[0].object as THREE.Line;
    return mesh.userData.seamId as string;
  }

  setHoverSeam(id: string | null): void {
    if (this.hoverSeamId === id) return;
    this.hoverSeamId = id;
    this.seams.forEach((seam) => this.updateSeamVisual(seam));
  }

  renderSeams(): void {
    this.sceneManager.clearGroup(this.sceneManager.seamGroup);
    this.seamMeshes.clear();

    for (const seam of this.seams) {
      const line = this.createSeamLine(seam);
      this.seamMeshes.set(seam.id, line);
      this.sceneManager.seamGroup.add(line);
    }
  }

  updateSeamProgress(seam: WeldSeam): void {
    this.updateSeamVisual(seam);
  }

  private createSeamLine(seam: WeldSeam): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...seam.start),
      new THREE.Vector3(...seam.end),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: this.getSeamColor(seam),
      linewidth: 2,
      transparent: true,
      opacity: seam.selected ? 0.95 : 0.25,
    });
    const line = new THREE.Line(geometry, material);
    line.userData.seamId = seam.id;
    return line;
  }

  private updateSeamVisual(seam: WeldSeam): void {
    const line = this.seamMeshes.get(seam.id);
    if (!line) return;
    const material = line.material as THREE.LineBasicMaterial;
    material.color.setHex(this.getSeamColor(seam));
    material.opacity = seam.selected ? 0.95 : 0.25;
  }

  private getSeamColor(seam: WeldSeam): number {
    if (seam.status === 'done') return 0x64748b;
    if (seam.status === 'active') return 0xfbbf24;
    if (this.hoverSeamId === seam.id) return 0xffffff;
    return WELD_TYPE_COLORS[seam.weldType];
  }

  private guessWeldType(edge: SeamEdge): WeldType {
    const dy = Math.abs(edge.end[1] - edge.start[1]);
    const dx = Math.hypot(edge.end[0] - edge.start[0], edge.end[2] - edge.start[2]);
    if (dy > dx * 0.8) return 'corner';
    if (edge.length > 0.8) return 'butt';
    if (edge.length < 0.15) return 'plug';
    return 'fillet';
  }

  private addEdge(
    map: Map<string, { a: THREE.Vector3; b: THREE.Vector3; faces: THREE.Vector3[] }>,
    a: THREE.Vector3,
    b: THREE.Vector3,
    normal: THREE.Vector3,
  ): void {
    const key = this.edgeKey(a, b);
    const entry = map.get(key);
    if (entry) {
      entry.faces.push(normal.clone());
    } else {
      map.set(key, { a: a.clone(), b: b.clone(), faces: [normal.clone()] });
    }
  }

  private edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
    const pa = [a.x, a.y, a.z].map((v) => v.toFixed(3)).join(',');
    const pb = [b.x, b.y, b.z].map((v) => v.toFixed(3)).join(',');
    return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
  }
}
