import * as THREE from 'three';
import { DEFAULT_SEAM_SETTINGS, type AppState, type ScanPassCount, type WorkflowStep } from '../types';
import { SceneManager } from './SceneManager';
import { ModelLoader } from './ModelLoader';
import { SeamManager } from './SeamManager';
import { PointCloudScanner } from './PointCloudScanner';
import { WeldingController } from './WeldingController';
import { Sidebar } from './Sidebar';
import { BackendClient } from './BackendClient';
import { RosBridgeClient } from './RosBridgeClient';
import { downloadJson } from './MoveItExporter';

export class WeldingApp {
  private state: AppState = {
    step: 'model',
    modelLoaded: false,
    modelName: '',
    seams: [],
    scanResults: [],
    alignmentDone: false,
    alignmentPose: null,
    misalignment: null,
    weldingActive: false,
    currentSeamIndex: 0,
    backendOnline: false,
    rosConnected: false,
    useBackendIcp: true,
    seamSettings: { ...DEFAULT_SEAM_SETTINGS },
    focusedSeamId: null,
    manualSeamPickActive: false,
  };

  private lastFrame = performance.now();
  private currentModelGroup: THREE.Group | null = null;

  private sceneManager: SceneManager;
  private modelLoader: ModelLoader;
  private seamManager: SeamManager;
  private scanner: PointCloudScanner;
  private welding: WeldingController;
  private sidebar: Sidebar;
  private backend = new BackendClient();
  private ros = new RosBridgeClient();
  private lastMoveItPlan: Record<string, unknown> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.sceneManager = new SceneManager(canvas);
    this.modelLoader = new ModelLoader(this.sceneManager);
    this.seamManager = new SeamManager(this.sceneManager, this.modelLoader);
    this.scanner = new PointCloudScanner(this.sceneManager, this.modelLoader, this.seamManager, this.backend);
    this.welding = new WeldingController(this.sceneManager, this.seamManager, () => this.refresh());

    this.ros.onConnectionChange = (connected) => {
      this.state.rosConnected = connected;
      this.refresh();
    };

    this.sidebar = new Sidebar(
      document.getElementById('sidebar')!,
      document.getElementById('workflow-steps')!,
      {
        onLoadSample: () => this.loadSample(),
        onLoadFile: (file) => void this.loadFile(file),
        onDetectSeams: () => this.detectSeams(),
        onSelectAllSeams: (selected) => { this.seamManager.selectAll(selected); this.refresh(); },
        onToggleSeam: (id) => { this.seamManager.toggleSeamSelection(id); this.refresh(); },
        onFocusSeam: (id) => { this.seamManager.focusSeam(id); this.refresh(); },
        onSeamNav: (dir) => { this.seamManager.focusNext(dir); this.refresh(); },
        onSetWeldType: (id, type) => { this.seamManager.setWeldType(id, type); this.refresh(); },
        onGoToStep: (step) => this.goToStep(step),
        onScan: (passCount) => void this.runScan(passCount),
        onAlign: () => void this.alignScans(),
        onClearClouds: () => this.clearClouds(),
        onStartWelding: () => this.startWelding(),
        onPauseWelding: () => this.pauseWelding(),
        onStopWelding: () => this.stopWelding(),
        onResetWelding: () => this.resetWelding(),
        onConnectRos: (url) => this.connectRos(url),
        onDisconnectRos: () => this.disconnectRos(),
        onExportMoveIt: () => void this.exportMoveIt(),
        onSendTrajectoryRos: () => this.sendTrajectoryToRos(),
        onDownloadPlan: () => this.downloadPlan(),
        onRefreshBackend: () => void this.checkBackend(),
        onToggleBackendIcp: (enabled) => { this.state.useBackendIcp = enabled; this.refresh(); },
      },
    );

    this.bindViewportEvents();
    this.startAnimationLoop();
    void this.checkBackend();
    this.loadSample();
  }

  private bindViewportEvents(): void {
    const canvas = this.sceneManager.renderer.domElement;
    canvas.addEventListener('pointermove', (event) => {
      this.sceneManager.setPointerFromEvent(event);
      if (this.state.step !== 'seams') return;
      this.seamManager.setHoverSeam(this.seamManager.pickSeamAtPointer());
    });
    canvas.addEventListener('click', () => {
      if (this.state.step !== 'seams') return;
      const id = this.seamManager.pickSeamAtPointer();
      if (id) { this.seamManager.focusSeam(id); this.state.focusedSeamId = id; this.refresh(); }
    });
  }

  private startAnimationLoop(): void {
    const loop = (now: number) => {
      this.seamManager.tick(Math.min((now - this.lastFrame) / 1000, 0.05));
      this.lastFrame = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private async checkBackend(): Promise<void> {
    const health = await this.backend.health();
    this.state.backendOnline = health?.status === 'ok';
    this.refresh();
  }

  private loadSample(): void {
    const model = this.modelLoader.loadSampleWorkpiece();
    this.modelLoader.setModel(model);
    this.currentModelGroup = model;
    this.state.modelLoaded = true;
    this.state.modelName = 'Демо-деталь (T-образная конструкция)';
    this.state.alignmentDone = false;
    this.state.alignmentPose = null;
    this.state.misalignment = null;
    this.sceneManager.setAlignmentPose(null);
    this.sceneManager.resetCadAlignment();
    this.scanner.invalidateMeshCache();
    this.seamManager.setCoRegistered(true);
    this.scanner.clearClouds();
    this.welding.reset();
    this.seamManager.clearAll();
    this.detectSeams();
    this.sidebar.setStatus('Демо-модель загружена');
    this.refresh();
  }

  private async loadFile(file: File): Promise<void> {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      let model: THREE.Group;
      if (ext === 'step' || ext === 'stp') {
        await this.checkBackend();
        if (!this.state.backendOnline) throw new Error('Backend недоступен на :8000');
        model = await this.modelLoader.loadFile(file, { convertStep: (f) => this.backend.convertStep(f) });
      } else {
        model = await this.modelLoader.loadFile(file);
      }
      this.modelLoader.setModel(model);
      this.currentModelGroup = model;
      this.state.modelLoaded = true;
      this.state.modelName = file.name;
      this.state.alignmentDone = false;
      this.state.alignmentPose = null;
      this.sceneManager.resetCadAlignment();
      this.scanner.clearClouds();
      this.seamManager.clearAll();
      this.detectSeams();
      this.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Не удалось загрузить файл');
    }
  }

  private detectSeams(): void {
    this.state.seams = this.seamManager.autoDetectSeams();
    this.refresh();
  }

  private goToStep(step: WorkflowStep): void {
    if (step === 'seams' && this.state.modelLoaded && this.seamManager.seams.length === 0) {
      this.detectSeams();
    }
    this.state.step = step;
    if (step === 'weld') this.sceneManager.setAlignmentPose(null);
    else if (this.state.alignmentPose) this.sceneManager.setAlignmentPose(this.state.alignmentPose);
    this.refresh();
  }

  private async runScan(passCount: ScanPassCount): Promise<void> {
    this.state.alignmentDone = false;
    this.state.alignmentPose = null;
    this.state.misalignment = null;
    this.sceneManager.setAlignmentPose(null);
    this.sceneManager.resetCadAlignment();
    this.scanner.invalidateMeshCache();
    await this.scanner.scan(passCount);
    const preview = this.scanner.getMisalignmentPreview();
    this.state.misalignment = preview ? {
      offsetMm: preview.offsetMm,
      offsetMmXYZ: preview.offsetMmXYZ,
      rotationDeg: preview.rotationDeg,
      rotationDegXYZ: preview.rotationDegXYZ,
      cadCenter: [preview.cadCenter.x, preview.cadCenter.y, preview.cadCenter.z],
      scanCenter: [preview.scanCenter.x, preview.scanCenter.y, preview.scanCenter.z],
    } : null;
    if (preview) {
      this.sceneManager.setCadVisualState('misaligned');
      this.seamManager.setCoRegistered(false);
      this.sceneManager.showMisalignmentGuide(preview.cadCenter, preview.scanCenter, preview.offsetMm);
      this.sceneManager.showDualCoordinateFrames(preview.cadCenter, preview.scanCenter, this.scanner.getExpectedCadToScanMatrix());
    }
    this.refresh();
  }

  private async alignScans(): Promise<void> {
    try {
      const beforeMis = this.state.misalignment;
      const useBackend = this.state.useBackendIcp && this.state.backendOnline;
      this.sceneManager.resetCadAlignment();
      this.scanner.invalidateMeshCache();
      const { icp, pose } = await this.scanner.alignScans(useBackend);
      const cadMatrix = this.scanner.getCadToScanMatrix();
      if (this.currentModelGroup) this.sceneManager.showGhostModel(this.currentModelGroup, new THREE.Vector3(0, 0, 0));
      await this.sceneManager.animateCadAlignment(cadMatrix, 900);
      this.sceneManager.setCadVisualState('aligned');
      this.sceneManager.clearGroup(this.sceneManager.ghostGroup);
      this.state.alignmentDone = true;
      this.state.alignmentPose = { ...pose, cadCenterBefore: beforeMis?.cadCenter, scanCenterBefore: beforeMis?.scanCenter };
      this.state.misalignment = null;
      this.seamManager.setCoRegistered(true);
      this.sceneManager.setAlignmentPose(this.state.alignmentPose);
      this.sceneManager.showAlignedCoordinateFrames(this.state.alignmentPose);
      this.seamManager.renderSeams();
      const fitness = Number.isFinite(pose.fitness) ? pose.fitness : 0;
      const rmse = Number.isFinite(pose.rmse) ? pose.rmse : 0;
      const detail = icp ? `fitness ${(icp.fitness * 100).toFixed(1)}%, RMSE ${icp.rmse.toFixed(4)}` : `RMSE ${rmse.toFixed(4)}, fitness ${(fitness * 100).toFixed(1)}%`;
      this.sidebar.setStatus(`Совмещение выполнено. ${detail}`);
      this.sidebar.setHint(`CAD совмещён со сканом. Найдено швов: ${this.seamManager.seams.length}, выбрано: ${this.seamManager.getSelectedSeams().length}`);
      this.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ошибка сопоставления');
    }
  }

  private clearClouds(): void {
    this.scanner.clearClouds();
    this.state.alignmentDone = false;
    this.state.alignmentPose = null;
    this.state.misalignment = null;
    this.sceneManager.resetCadAlignment();
    this.scanner.invalidateMeshCache();
    this.seamManager.setCoRegistered(true);
    this.sceneManager.clearGroup(this.sceneManager.ghostGroup);
    this.refresh();
  }

  private startWelding(): void {
    if (this.seamManager.getSelectedSeams().length === 0) { alert('Выберите швы'); return; }
    this.welding.start();
    this.state.weldingActive = true;
    this.refresh();
  }
  private pauseWelding(): void { this.welding.pause(); this.state.weldingActive = this.welding.active && !this.welding.paused; this.refresh(); }
  private stopWelding(): void { this.welding.stop(); this.state.weldingActive = false; this.refresh(); }
  private resetWelding(): void { this.welding.reset(); this.state.weldingActive = false; this.refresh(); }
  private connectRos(url: string): void { this.ros.connect(url); }
  private disconnectRos(): void { this.ros.disconnect(); this.refresh(); }

  private async exportMoveIt(): Promise<void> {
    const seams = this.seamManager.getSelectedSeams();
    if (seams.length === 0) { alert('Выберите швы'); return; }
    try {
      const plan = this.state.backendOnline ? await this.backend.exportMoveIt(seams) : await import('./MoveItExporter').then((m) => m.buildLocalMoveItPlan(seams));
      this.lastMoveItPlan = plan as unknown as Record<string, unknown>;
      this.refresh();
    } catch (error) { alert(error instanceof Error ? error.message : 'Ошибка экспорта'); }
  }
  private sendTrajectoryToRos(): void {
    if (!this.state.rosConnected || !this.lastMoveItPlan) { alert('Нужны ROS и plan'); return; }
    this.ros.publishTrajectory(this.lastMoveItPlan);
  }
  private downloadPlan(): void {
    if (!this.lastMoveItPlan) { alert('Сначала экспорт'); return; }
    downloadJson('weld_plan.json', this.lastMoveItPlan);
  }
  private publishRosStatus(): void {
    if (!this.state.rosConnected) return;
    this.ros.publishStatus({ active: this.welding.active, paused: this.welding.paused, current_seam: this.welding.currentSeam?.id ?? null, overall_progress: this.welding.overallProgress, remaining: this.welding.remainingCount });
  }

  private refresh(): void {
    this.state.seams = this.seamManager.seams;
    this.state.seamSettings = { ...this.seamManager.settings };
    this.state.focusedSeamId = this.seamManager.focusedSeamId;
    this.state.scanResults = this.scanner.scanResults;
    this.state.weldingActive = this.welding.active;
    this.state.currentSeamIndex = this.welding.currentIndex;
    this.updateViewportSeamHud();
    this.updateAlignmentGuide();
    this.publishRosStatus();
    this.sidebar.update(this.state, this.seamManager, this.scanner, this.welding, this.ros);
  }

  private fmtCoordRow(values: [number, number, number], unit: 'm' | 'mm' | 'deg'): [string, string, string] {
    const f = unit === 'mm' ? (v: number) => (v * 1000).toFixed(0) : unit === 'deg' ? (v: number) => v.toFixed(1) : (v: number) => v.toFixed(3);
    return [f(values[0]), f(values[1]), f(values[2])];
  }

  private buildCoordTable(title: string, rows: { label: string; values: [string, string, string] }[]): string {
    const body = rows.map((row) => `<tr><td>${row.label}</td><td>${row.values[0]}</td><td>${row.values[1]}</td><td>${row.values[2]}</td></tr>`).join('');
    return `<div class="coord-block"><div class="coord-block-title">${title}</div><table class="coord-table"><thead><tr><th></th><th>X</th><th>Y</th><th>Z</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  private updateAlignmentGuide(): void {
    const guide = document.getElementById('align-guide');
    const badge = document.getElementById('align-badge');
    const body = document.getElementById('align-guide-body');
    const steps = document.querySelectorAll<HTMLElement>('.align-step');
    if (!guide || !badge || !body) return;
    const show = this.state.modelLoaded && (this.state.step === 'scan' || this.state.step === 'seams' || this.state.step === 'weld') && (this.scanner.scanResults.length > 0 || this.state.alignmentDone);
    guide.classList.toggle('hidden', !show);
    if (!show) return;
    const setStep = (name: string, cls: 'active' | 'done' | '') => {
      steps.forEach((el) => {
        const on = el.dataset.step === name;
        el.classList.toggle('active', on && cls === 'active');
        el.classList.toggle('done', on && cls === 'done');
      });
    };
    if (this.state.alignmentDone) {
      badge.textContent = 'Совмещено';
      badge.className = 'align-badge ok';
      setStep('cad', 'done'); setStep('scan', 'done'); setStep('icp', 'done');
      const p = this.state.alignmentPose;
      if (!p) { body.innerHTML = '<strong>Деталь совмещена со сканом.</strong>'; return; }
      body.innerHTML = `<strong>CAD и швы на реальной детали.</strong>
        <div class="metric-row"><span>Fitness</span><span>${Number.isFinite(p.fitness) ? (p.fitness * 100).toFixed(1) : '0.0'}%</span></div>
        <div class="metric-row"><span>RMSE</span><span>${Number.isFinite(p.rmse) ? p.rmse.toFixed(4) : '—'} м</span></div>
        ${this.buildCoordTable('После ICP', [{ label: 'Позиция (м)', values: this.fmtCoordRow(p.translation, 'm') }, { label: 'Поворот (°)', values: this.fmtCoordRow(p.rotationEulerDeg, 'deg') }])}`;
      return;
    }
    if (this.scanner.scanResults.length > 0 && this.state.misalignment) {
      const m = this.state.misalignment;
      badge.textContent = 'Не совпадает';
      badge.className = 'align-badge warn';
      setStep('cad', 'done'); setStep('scan', 'done'); setStep('icp', 'active');
      body.innerHTML = `<strong>Деталь смещена относительно CAD.</strong>
        <div class="metric-row"><span>Смещение Σ</span><span><strong>${m.offsetMm.toFixed(1)} мм</strong></span></div>
        ${this.buildCoordTable('Центры (м)', [{ label: 'CAD', values: this.fmtCoordRow(m.cadCenter, 'm') }, { label: 'Scan', values: this.fmtCoordRow(m.scanCenter, 'm') }])}
        <div class="metric-row"><span>Швы</span><span>на CAD, нужен ICP</span></div>`;
      return;
    }
    badge.textContent = 'Ожидание';
    badge.className = 'align-badge';
    setStep('cad', 'done'); setStep('scan', 'active'); setStep('icp', '');
    body.innerHTML = 'Отсканируйте деталь.';
  }

  private updateViewportSeamHud(): void {
    const statsEl = document.getElementById('seam-hud-stats');
    const legendEl = document.getElementById('seam-legend');
    if (!statsEl) return;
    if (this.state.step !== 'seams' || this.seamManager.seams.length === 0) {
      statsEl.classList.add('hidden');
      legendEl?.classList.add('hidden');
      return;
    }
    const s = this.seamManager.getStats();
    statsEl.classList.remove('hidden');
    legendEl?.classList.remove('hidden');
    statsEl.innerHTML = `<div class="hud-stat"><span class="hud-val">${s.total}</span><span class="hud-lbl">найдено</span></div><div class="hud-stat accent"><span class="hud-val">${s.selected}</span><span class="hud-lbl">выбрано</span></div>`;
  }
}
