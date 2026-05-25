import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AlignmentPose } from '../types';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();

  readonly modelGroup = new THREE.Group();
  readonly ghostGroup = new THREE.Group();
  readonly alignmentGroup = new THREE.Group();
  readonly guideGroup = new THREE.Group();
  readonly coordinateGroup = new THREE.Group();
  readonly seamGroup = new THREE.Group();
  readonly pointCloudGroup = new THREE.Group();
  readonly weldEffectGroup = new THREE.Group();

  private animationId = 0;
  private cadAlignment = new THREE.Matrix4();

  private flyAnim: {
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    startTime: number;
    duration: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x0b0f14);
    this.scene.fog = new THREE.Fog(0x0b0f14, 8, 28);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
    this.camera.position.set(2.8, 2.1, 3.4);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0.35, 0);

    this.modelGroup.add(this.seamGroup);
    this.scene.add(
      this.modelGroup,
      this.ghostGroup,
      this.alignmentGroup,
      this.guideGroup,
      this.coordinateGroup,
      this.pointCloudGroup,
      this.weldEffectGroup,
    );
    this.setupLights();
    this.setupGrid();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-3, 2, -2);

    this.scene.add(ambient, key, fill);
  }

  private setupGrid(): void {
    const grid = new THREE.GridHelper(6, 24, 0x334155, 0x1e293b);
    grid.position.y = -0.001;
    this.scene.add(grid);
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const { clientWidth, clientHeight } = parent;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight, false);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.updateFlyAnim();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** РџР»Р°РІРЅС‹Р№ РїРµСЂРµР»С‘С‚ РєР°РјРµСЂС‹ Рє С‚РѕС‡РєРµ. */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, durationMs = 600): void {
    this.flyAnim = {
      startPos: this.camera.position.clone(),
      endPos: position.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: target.clone(),
      startTime: performance.now(),
      duration: Math.max(50, durationMs),
    };
  }

  private updateFlyAnim(): void {
    if (!this.flyAnim) return;
    const t = (performance.now() - this.flyAnim.startTime) / this.flyAnim.duration;
    const e = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
    this.camera.position.lerpVectors(this.flyAnim.startPos, this.flyAnim.endPos, e);
    this.controls.target.lerpVectors(this.flyAnim.startTarget, this.flyAnim.endTarget, e);
    if (t >= 1) this.flyAnim = null;
  }



  /** РЎС‚СЂРµР»РєР° Рё РјР°СЂРєРµСЂС‹: CAD (РѕСЂР°РЅР¶.) в†’ СЃРєР°РЅ (СЃРёРЅРёР№). */
  showMisalignmentGuide(cadCenter: THREE.Vector3, scanCenter: THREE.Vector3, _offsetMm: number): void {
    this.clearGroup(this.guideGroup);

    const dir = scanCenter.clone().sub(cadCenter);
    const len = dir.length();
    if (len < 1e-6) return;

    const lineGeo = new THREE.BufferGeometry().setFromPoints([cadCenter, scanCenter]);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineDashedMaterial({
        color: 0xff6b6b,
        dashSize: 0.04,
        gapSize: 0.025,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 10;

    const arrow = new THREE.ArrowHelper(
      dir.clone().normalize(),
      cadCenter,
      len,
      0xffaa00,
      Math.min(len * 0.12, 0.12),
      Math.min(len * 0.07, 0.07),
    );
    arrow.line.material = new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false });
    arrow.cone.material = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
    arrow.renderOrder = 11;

    const cadMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xf97316, depthTest: false }),
    );
    cadMarker.position.copy(cadCenter);
    cadMarker.renderOrder = 12;

    const scanMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0x60a5fa, depthTest: false }),
    );
    scanMarker.position.copy(scanCenter);
    scanMarker.renderOrder = 12;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.065, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false }),
    );
    ring.position.copy(cadCenter);
    ring.lookAt(scanCenter);
    ring.renderOrder = 9;

    this.guideGroup.add(line, arrow, cadMarker, scanMarker, ring);
  }

  hideMisalignmentGuide(): void {
    this.clearGroup(this.guideGroup);
  }

  clearCoordinateDisplay(): void {
    this.clearGroup(this.coordinateGroup);
  }

  /** Р”РІРµ РЎРљ РґРѕ ICP: РѕСЂР°РЅР¶РµРІР°СЏ CAD Рё СЃРёРЅСЏСЏ Scan (+ РїРѕР»СѓРїСЂРѕР·СЂР°С‡РЅС‹Рµ РїР»РѕСЃРєРѕСЃС‚Рё XY/XZ). */
  showDualCoordinateFrames(
    cadCenter: THREE.Vector3,
    scanCenter: THREE.Vector3,
    scanMatrix: THREE.Matrix4,
  ): void {
    this.clearGroup(this.coordinateGroup);

    const cadFrame = this.buildCoordinateFrame(0.24, 0.42, 0x334155, 0.09);
    cadFrame.position.copy(cadCenter);
    this.coordinateGroup.add(cadFrame);

    const scanQuat = new THREE.Quaternion();
    const scanScl = new THREE.Vector3();
    scanMatrix.decompose(new THREE.Vector3(), scanQuat, scanScl);
    const scanFrame = this.buildCoordinateFrame(0.24, 0.42, 0x1e3a5f, 0.14);
    scanFrame.position.copy(scanCenter);
    scanFrame.quaternion.copy(scanQuat);
    this.coordinateGroup.add(scanFrame);
  }

  /** РћРґРЅР° РЎРљ РїРѕСЃР»Рµ ICP (Р·РµР»С‘РЅР°СЏ) + РјР°СЂРєРµСЂ РёСЃС…РѕРґРЅРѕРіРѕ CAD. */
  showAlignedCoordinateFrames(pose: AlignmentPose): void {
    this.clearGroup(this.coordinateGroup);

    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(pose.rotationEulerDeg[0]),
      THREE.MathUtils.degToRad(pose.rotationEulerDeg[1]),
      THREE.MathUtils.degToRad(pose.rotationEulerDeg[2]),
      'XYZ',
    );
    const alignedOrigin = pose.scanCenterBefore
      ? new THREE.Vector3(...pose.scanCenterBefore)
      : new THREE.Vector3(...pose.translation);
    const aligned = this.buildCoordinateFrame(0.26, 0.45, 0x14532d, 0.16);
    aligned.position.copy(alignedOrigin);
    aligned.setRotationFromEuler(euler);
    this.coordinateGroup.add(aligned);

    if (pose.cadCenterBefore) {
      const nominal = this.buildCoordinateFrame(0.14, 0.22, 0x431407, 0.05);
      nominal.position.set(...pose.cadCenterBefore);
      this.coordinateGroup.add(nominal);
    }
  }

  private buildCoordinateFrame(axisLen: number, planeSize: number, planeColor: number, planeOpacity: number): THREE.Group {
    const group = new THREE.Group();
    const axes = new THREE.AxesHelper(axisLen);
    axes.renderOrder = 8;
    group.add(axes);

    const planeMat = new THREE.MeshBasicMaterial({
      color: planeColor,
      transparent: true,
      opacity: planeOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const xy = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), planeMat.clone());
    xy.renderOrder = 4;
    group.add(xy);

    const xz = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), planeMat.clone());
    xz.rotation.x = -Math.PI / 2;
    xz.renderOrder = 4;
    group.add(xz);

    return group;
  }

  /** РџРѕРґСЃРІРµС‚РєР° CAD РґРѕ/РїРѕСЃР»Рµ СЃРѕРІРјРµС‰РµРЅРёСЏ. */
  setCadVisualState(state: 'default' | 'misaligned' | 'aligned'): void {
    this.modelGroup.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((raw) => {
        if (!(raw instanceof THREE.MeshStandardMaterial)) return;
        if (state === 'misaligned') {
          raw.transparent = true;
          raw.opacity = 0.42;
          raw.emissive.setHex(0xf97316);
          raw.emissiveIntensity = 0.22;
        } else if (state === 'aligned') {
          raw.transparent = false;
          raw.opacity = 1;
          raw.emissive.setHex(0x22ff88);
          raw.emissiveIntensity = 0.06;
        } else {
          raw.transparent = false;
          raw.opacity = 1;
          raw.emissive.setHex(0x000000);
          raw.emissiveIntensity = 0;
        }
      });
    });
  }

  resetCadAlignment(): void {
    this.hideMisalignmentGuide();
    this.clearCoordinateDisplay();
    this.setCadVisualState('default');
    this.cadAlignment.identity();
    this.modelGroup.position.set(0, 0, 0);
    this.modelGroup.quaternion.identity();
    this.modelGroup.scale.set(1, 1, 1);
    if (this.seamGroup.parent !== this.modelGroup) {
      this.modelGroup.add(this.seamGroup);
    }
    this.modelGroup.updateMatrixWorld(true);
  }

  getCadAlignmentMatrix(): THREE.Matrix4 {
    return this.cadAlignment.clone();
  }

  applyToWorldPoint(local: THREE.Vector3): THREE.Vector3 {
    this.modelGroup.updateMatrixWorld(true);
    return local.clone().applyMatrix4(this.modelGroup.matrixWorld);
  }

  applyCadAlignment(matrix: THREE.Matrix4): void {
    this.cadAlignment.copy(matrix);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    matrix.decompose(pos, quat, scl);
    this.modelGroup.position.copy(pos);
    this.modelGroup.quaternion.copy(quat);
    this.modelGroup.scale.copy(scl);
    this.modelGroup.updateMatrixWorld(true);
  }

  animateCadAlignment(matrix: THREE.Matrix4, durationMs = 900): Promise<void> {
    const startPos = this.modelGroup.position.clone();
    const startQuat = this.modelGroup.quaternion.clone();
    const startScale = this.modelGroup.scale.clone();

    const endPos = new THREE.Vector3();
    const endQuat = new THREE.Quaternion();
    const endScale = new THREE.Vector3();
    matrix.decompose(endPos, endQuat, endScale);

    const startTime = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - startTime) / durationMs;
        const e = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
        const pos = startPos.clone().lerp(endPos, e);
        const quat = startQuat.clone().slerp(endQuat, e);
        const scl = startScale.clone().lerp(endScale, e);
        const mat = new THREE.Matrix4().compose(pos, quat, scl);
        this.applyCadAlignment(mat);
        if (t < 1) requestAnimationFrame(tick);
        else {
          this.applyCadAlignment(matrix);
          this.hideMisalignmentGuide();
          this.setCadVisualState('aligned');
          resolve();
        }
      };
      tick();
    });
  }

  /** РЎР±СЂРѕСЃ РІСЃРїРѕРјРѕРіР°С‚РµР»СЊРЅРѕР№ РіСЂСѓРїРїС‹ (РѕСЃРё вЂ” РІ coordinateGroup). */
  setAlignmentPose(_pose: AlignmentPose | null): void {
    this.clearGroup(this.alignmentGroup);
  }

  /** РџСЂРёР·СЂР°С‡РЅР°СЏ CAD-РєРѕРїРёСЏ РґР»СЏ РІРёР·СѓР°Р»РёР·Р°С†РёРё В«РґРѕ/РїРѕСЃР»РµВ» СЃРѕРІРјРµС‰РµРЅРёСЏ. */
  showGhostModel(source: THREE.Group, offset: THREE.Vector3): THREE.Group {
    this.clearGroup(this.ghostGroup);
    const ghost = source.clone(true);
    ghost.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff6b6b,
          transparent: true,
          opacity: 0.18,
          wireframe: true,
          depthWrite: false,
        });
        node.material = mat;
      }
    });
    ghost.position.copy(offset);
    this.ghostGroup.add(ghost);
    return ghost;
  }

  animateGhostToOrigin(durationMs = 1200): void {
    const ghost = this.ghostGroup.children[0];
    if (!ghost) return;
    const startPos = ghost.position.clone();
    const startQuat = ghost.quaternion.clone();
    const targetPos = new THREE.Vector3(0, 0, 0);
    const targetQuat = new THREE.Quaternion();
    const startTime = performance.now();
    const tick = () => {
      const t = (performance.now() - startTime) / durationMs;
      const e = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
      ghost.position.lerpVectors(startPos, targetPos, e);
      ghost.quaternion.copy(startQuat).slerp(targetQuat, e);
      if (t < 1) requestAnimationFrame(tick);
      else {
        setTimeout(() => this.clearGroup(this.ghostGroup), 800);
      }
    };
    tick();
  }

  clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      this.disposeObject(child);
    }
  }

  disposeObject(object: THREE.Object3D): void {
    object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((m) => m.dispose());
      }
      if (node instanceof THREE.LineSegments) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
      if (node instanceof THREE.Points) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
  }

  frameObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim / (2 * Math.tan((Math.PI * this.camera.fov) / 360));
    const offset = distance * 1.4;

    this.controls.target.copy(center);
    this.camera.position.set(center.x + offset, center.y + offset * 0.6, center.z + offset);
    this.controls.update();
  }

  setPointerFromEvent(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.controls.dispose();
    this.renderer.dispose();
  }
}


