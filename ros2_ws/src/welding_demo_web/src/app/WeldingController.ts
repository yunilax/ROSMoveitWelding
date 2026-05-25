import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { SeamManager } from './SeamManager';
import type { WeldSeam } from '../types';

export class WeldingController {
  active = false;
  paused = false;
  currentIndex = 0;
  private rafId = 0;
  private lastTime = 0;
  private torch: THREE.Mesh | null = null;
  private arcLight: THREE.PointLight | null = null;
  private sparkGroup = new THREE.Group();

  constructor(
    private sceneManager: SceneManager,
    private seamManager: SeamManager,
    private onUpdate: () => void,
  ) {
    this.sceneManager.weldEffectGroup.add(this.sparkGroup);
  }

  get selectedSeams(): WeldSeam[] {
    return this.seamManager.getSelectedSeams();
  }

  get currentSeam(): WeldSeam | null {
    return this.selectedSeams[this.currentIndex] ?? null;
  }

  get completedCount(): number {
    return this.selectedSeams.filter((s) => s.status === 'done').length;
  }

  get remainingCount(): number {
    return this.selectedSeams.length - this.completedCount - (this.active ? 1 : 0);
  }

  get overallProgress(): number {
    const seams = this.selectedSeams;
    if (seams.length === 0) return 0;
    const sum = seams.reduce((acc, s) => acc + s.progress, 0);
    return (sum / seams.length) * 100;
  }

  start(): void {
    const seams = this.selectedSeams;
    if (seams.length === 0) return;

    this.active = true;
    this.paused = false;
    this.currentIndex = seams.findIndex((s) => s.status !== 'done');
    if (this.currentIndex < 0) this.currentIndex = 0;

    seams.forEach((s) => {
      if (s.status === 'done') return;
      s.status = 'pending';
    });

    this.activateCurrentSeam();
    this.setupTorch();
    this.lastTime = performance.now();
    this.loop();
    this.onUpdate();
  }

  pause(): void {
    this.paused = !this.paused;
    if (!this.paused) {
      this.lastTime = performance.now();
      this.loop();
    } else {
      cancelAnimationFrame(this.rafId);
    }
    this.onUpdate();
  }

  stop(): void {
    this.active = false;
    this.paused = false;
    cancelAnimationFrame(this.rafId);
    this.cleanupEffects();
    this.onUpdate();
  }

  reset(): void {
    this.stop();
    this.currentIndex = 0;
    this.seamManager.seams.forEach((seam) => {
      seam.progress = 0;
      seam.status = 'pending';
      this.seamManager.updateSeamProgress(seam);
    });
    this.onUpdate();
  }

  private activateCurrentSeam(): void {
    this.seamManager.seams.forEach((seam) => {
      if (seam.status === 'active') seam.status = 'pending';
    });
    const current = this.currentSeam;
    if (current) {
      current.status = 'active';
      this.seamManager.updateSeamProgress(current);
    }
  }

  private setupTorch(): void {
    this.cleanupEffects();
    this.torch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.25 }),
    );
    this.arcLight = new THREE.PointLight(0xffaa44, 2.5, 0.4);
    this.sceneManager.weldEffectGroup.add(this.torch, this.arcLight);
  }

  private cleanupEffects(): void {
    if (this.torch) this.sceneManager.weldEffectGroup.remove(this.torch);
    if (this.arcLight) this.sceneManager.weldEffectGroup.remove(this.arcLight);
    this.sceneManager.clearGroup(this.sparkGroup);
    this.torch = null;
    this.arcLight = null;
  }

  private loop = (): void => {
    if (!this.active || this.paused) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const seam = this.currentSeam;
    if (!seam) {
      this.finishAll();
      return;
    }

    const speed = 0.18 / Math.max(seam.length, 0.1);
    seam.progress = Math.min(1, seam.progress + dt * speed);
    this.seamManager.updateSeamProgress(seam);
    this.updateTorchPosition(seam);
    this.spawnSparks(seam);

    if (seam.progress >= 1) {
      seam.progress = 1;
      seam.status = 'done';
      this.seamManager.updateSeamProgress(seam);
      this.currentIndex += 1;

      if (this.currentIndex >= this.selectedSeams.length) {
        this.finishAll();
      } else {
        this.activateCurrentSeam();
      }
    }

    this.onUpdate();
  };

  private updateTorchPosition(seam: WeldSeam): void {
    if (!this.torch || !this.arcLight) return;
    const start = new THREE.Vector3(...seam.start);
    const end = new THREE.Vector3(...seam.end);
    const pos = start.lerp(end, seam.progress);
    pos.y += 0.03;
    this.torch.position.copy(pos);
    this.torch.rotation.x = Math.PI / 2;
    this.arcLight.position.copy(pos);
    this.arcLight.intensity = 1.5 + Math.random() * 1.5;
  }

  private spawnSparks(seam: WeldSeam): void {
    if (Math.random() > 0.35) return;
    const start = new THREE.Vector3(...seam.start);
    const end = new THREE.Vector3(...seam.end);
    const pos = start.lerp(end, seam.progress);
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
    );
    spark.position.copy(pos);
    this.sparkGroup.add(spark);
    setTimeout(() => {
      this.sparkGroup.remove(spark);
      spark.geometry.dispose();
      (spark.material as THREE.Material).dispose();
    }, 120);
  }

  private finishAll(): void {
    this.active = false;
    this.cleanupEffects();
    this.onUpdate();
  }
}
