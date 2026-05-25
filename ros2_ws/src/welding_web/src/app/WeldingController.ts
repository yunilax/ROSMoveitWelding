import * as THREE from 'three';
import type { SceneManager } from './SceneManager';
import type { SeamManager } from './SeamManager';
import type { WeldSeam } from '../types';

/**
 * Упрощённая визуализация сварки на текущем этапе: вдоль активного шва
 * движется небольшой светящийся маркер. Без горелки и нормалей — точность
 * ориентации добавим позже, когда будут уверенные нормали швов.
 */
export class WeldingController {
  active = false;
  paused = false;
  currentIndex = 0;

  /** Скорость прохода маркера вдоль шва (ед. сцены / сек). */
  private travelSpeed = 0.04;

  private rafId = 0;
  private lastTime = 0;

  private marker: THREE.Mesh | null = null;
  private markerHalo: THREE.Mesh | null = null;
  private markerLight: THREE.PointLight | null = null;

  constructor(
    private sceneManager: SceneManager,
    private seamManager: SeamManager,
    private onUpdate: () => void,
  ) {}

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
    this.setupMarker();
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
    this.cleanupMarker();
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

  private setupMarker(): void {
    this.cleanupMarker();

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd24a }),
    );
    this.markerHalo = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffb020,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.markerLight = new THREE.PointLight(0xffc070, 0.6, 0.25, 2);

    this.sceneManager.weldEffectGroup.add(this.marker, this.markerHalo, this.markerLight);
  }

  private cleanupMarker(): void {
    if (this.marker) {
      this.sceneManager.weldEffectGroup.remove(this.marker);
      this.marker.geometry.dispose();
      (this.marker.material as THREE.Material).dispose();
    }
    if (this.markerHalo) {
      this.sceneManager.weldEffectGroup.remove(this.markerHalo);
      this.markerHalo.geometry.dispose();
      (this.markerHalo.material as THREE.Material).dispose();
    }
    if (this.markerLight) this.sceneManager.weldEffectGroup.remove(this.markerLight);
    this.marker = null;
    this.markerHalo = null;
    this.markerLight = null;
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

    const dProgress = (this.travelSpeed * dt) / Math.max(seam.length, 1e-3);
    seam.progress = Math.min(1, seam.progress + dProgress);
    this.seamManager.updateSeamProgress(seam);
    this.updateMarker(seam);

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

  private updateMarker(seam: WeldSeam): void {
    if (!this.marker || !this.markerHalo || !this.markerLight) return;
    const point = this.sceneManager.applyToWorldPoint(sampleSeamPoint(seam, seam.progress));
    this.marker.position.copy(point);
    this.markerHalo.position.copy(point);
    this.markerLight.position.copy(point);

    const pulse = 0.85 + Math.random() * 0.3;
    this.markerLight.intensity = 0.5 * pulse;
    (this.markerHalo.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.random() * 0.15;
  }

  private finishAll(): void {
    this.active = false;
    this.cleanupMarker();
    this.onUpdate();
  }
}

/** Точка на полилинии шва по нормированной длине [0,1]. */
function sampleSeamPoint(seam: WeldSeam, progress: number): THREE.Vector3 {
  const pts = seam.points && seam.points.length >= 2 ? seam.points : [seam.start, seam.end];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const dz = pts[i][2] - pts[i - 1][2];
    const l = Math.hypot(dx, dy, dz);
    segLens.push(l);
    total += l;
  }
  if (total < 1e-9) return new THREE.Vector3(...pts[0]);

  let target = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const t = segLens[i] > 0 ? Math.min(1, target / segLens[i]) : 0;
      const a = new THREE.Vector3(...pts[i]);
      const b = new THREE.Vector3(...pts[i + 1]);
      return a.lerp(b, t);
    }
    target -= segLens[i];
  }
  return new THREE.Vector3(...pts[pts.length - 1]);
}
