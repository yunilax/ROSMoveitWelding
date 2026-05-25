import type { AppState, SensorMode, WorkflowStep } from '../types';
import { SceneManager } from './SceneManager';
import { ModelLoader } from './ModelLoader';
import { SeamManager } from './SeamManager';
import { PointCloudScanner } from './PointCloudScanner';
import { WeldingController } from './WeldingController';
import { Sidebar } from './Sidebar';
import { BackendClient } from './BackendClient';
import { RosBridgeClient } from './RosBridgeClient';
import { downloadJson } from './MoveItExporter';

export class WeldingDemoApp {
  private state: AppState = {
    step: 'model',
    modelLoaded: false,
    modelName: '',
    seams: [],
    scanResults: [],
    alignmentDone: false,
    weldingActive: false,
    currentSeamIndex: 0,
    backendOnline: false,
    rosConnected: false,
    useBackendIcp: true,
  };

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
    this.scanner = new PointCloudScanner(
      this.sceneManager,
      this.modelLoader,
      this.seamManager,
      this.backend,
    );
    this.welding = new WeldingController(this.sceneManager, this.seamManager, () => this.refresh());

    this.ros.onConnectionChange = (connected) => {
      this.state.rosConnected = connected;
      this.refresh();
    };

    this.sidebar = new Sidebar(
      document.getElementById('sidebar')!,
      document.getElementById('workflow-steps')!,
      {
        onLoadDemo: () => this.loadDemo(),
        onLoadFile: (file) => void this.loadFile(file),
        onDetectSeams: () => this.detectSeams(),
        onSelectAllSeams: (selected) => {
          this.seamManager.selectAll(selected);
          this.refresh();
        },
        onToggleSeam: (id) => {
          this.seamManager.toggleSeamSelection(id);
          this.refresh();
        },
        onSetWeldType: (id, type) => {
          this.seamManager.setWeldType(id, type);
          this.refresh();
        },
        onGoToStep: (step) => this.goToStep(step),
        onScan: (sensor) => void this.runScan(sensor),
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
        onToggleBackendIcp: (enabled) => {
          this.state.useBackendIcp = enabled;
          this.refresh();
        },
      },
    );

    this.bindViewportEvents();
    void this.checkBackend();
    this.loadDemo();
  }

  private bindViewportEvents(): void {
    const canvas = this.sceneManager.renderer.domElement;

    canvas.addEventListener('pointermove', (event) => {
      this.sceneManager.setPointerFromEvent(event);
      if (this.state.step !== 'seams') return;
      const id = this.seamManager.pickSeamAtPointer();
      this.seamManager.setHoverSeam(id);
    });

    canvas.addEventListener('click', () => {
      if (this.state.step !== 'seams') return;
      const id = this.seamManager.pickSeamAtPointer();
      if (id) {
        this.seamManager.toggleSeamSelection(id);
        this.refresh();
      }
    });
  }

  private async checkBackend(): Promise<void> {
    const health = await this.backend.health();
    this.state.backendOnline = health?.status === 'ok';
    this.refresh();
  }

  private loadDemo(): void {
    const model = this.modelLoader.loadDemoWorkpiece();
    this.modelLoader.setModel(model);
    this.state.modelLoaded = true;
    this.state.modelName = 'Демо-деталь (T-образная конструкция)';
    this.state.alignmentDone = false;
    this.scanner.clearClouds();
    this.welding.reset();
    this.seamManager.seams = [];
    this.sidebar.setStatus('Демо-модель загружена');
    this.sidebar.setHint('Перейдите к шагу «Швы» для авто-поиска сварочных рёбер');
    this.refresh();
  }

  private async loadFile(file: File): Promise<void> {
    try {
      this.sidebar.setStatus(`Загрузка ${file.name}...`);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const useBackend = (ext === 'step' || ext === 'stp') && this.state.backendOnline;
      const model = useBackend
        ? await this.modelLoader.loadFile(file, { convertStep: (f) => this.backend.convertStep(f) })
        : await this.modelLoader.loadFile(file);
      this.modelLoader.setModel(model);
      this.state.modelLoaded = true;
      this.state.modelName = file.name;
      this.state.alignmentDone = false;
      this.scanner.clearClouds();
      this.welding.reset();
      this.seamManager.seams = [];
      this.sidebar.setStatus(`Модель ${file.name} загружена`);
      this.sidebar.setHint('Найдите швы автоматически или выберите их вручную');
      this.refresh();
    } catch (error) {
      this.sidebar.setStatus('Ошибка загрузки модели');
      alert(error instanceof Error ? error.message : 'Не удалось загрузить файл');
    }
  }

  private detectSeams(): void {
    const seams = this.seamManager.autoDetectSeams();
    this.state.seams = seams;
    this.sidebar.setStatus(`Найдено швов: ${seams.length}`);
    this.sidebar.setHint('Кликните по линии шва для включения/выключения. Задайте тип в списке.');
    this.refresh();
  }

  private goToStep(step: WorkflowStep): void {
    this.state.step = step;
    const hints: Record<WorkflowStep, string> = {
      model: 'Загрузите CAD или используйте демо-деталь. STEP через backend API.',
      seams: 'Клик по линии шва — выбор. Цвет соответствует типу сварки',
      scan: 'ICP через backend (Open3D) или локальная симуляция',
      weld: 'Активный шов подсвечивается жёлтым, горелка движется по траектории',
      integrate: 'Подключите rosbridge и экспортируйте траектории в MoveIt/RViz',
    };
    this.sidebar.setHint(hints[step]);
    this.refresh();
  }

  private async runScan(sensor: SensorMode): Promise<void> {
    this.sidebar.setStatus(`Сканирование (${sensor === 'far' ? 'дальний' : 'ближний'} датчик)...`);
    await this.scanner.scan(sensor);
    this.state.alignmentDone = false;
    this.sidebar.setStatus('Облако точек получено');
    this.refresh();
  }

  private async alignScans(): Promise<void> {
    try {
      const useBackend = this.state.useBackendIcp && this.state.backendOnline;
      this.sidebar.setStatus(useBackend ? 'ICP через backend (Open3D)...' : 'Локальное сопоставление...');
      const { error, matchedSeams, icp } = await this.scanner.alignScans(useBackend);
      this.state.alignmentDone = true;
      const detail = icp
        ? `fitness ${(icp.fitness * 100).toFixed(1)}%, RMSE ${icp.rmse.toFixed(4)}`
        : `ошибка ${error.toFixed(2)} мм-экв.`;
      this.sidebar.setStatus(`Совмещение выполнено. ${detail}`);
      this.sidebar.setHint(`Сопоставлено швов: ${matchedSeams.length}. Можно переходить к сварке.`);
      this.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ошибка сопоставления');
    }
  }

  private clearClouds(): void {
    this.scanner.clearClouds();
    this.state.alignmentDone = false;
    this.sidebar.setStatus('Облака точек очищены');
    this.refresh();
  }

  private startWelding(): void {
    if (this.seamManager.getSelectedSeams().length === 0) {
      alert('Выберите хотя бы один шов для сварки');
      return;
    }
    this.welding.start();
    this.state.weldingActive = true;
    this.sidebar.setStatus('Сварка запущена');
    this.publishRosStatus();
    this.refresh();
  }

  private pauseWelding(): void {
    this.welding.pause();
    this.state.weldingActive = this.welding.active && !this.welding.paused;
    this.sidebar.setStatus(this.welding.paused ? 'Сварка на паузе' : 'Сварка продолжена');
    this.publishRosStatus();
    this.refresh();
  }

  private stopWelding(): void {
    this.welding.stop();
    this.state.weldingActive = false;
    this.sidebar.setStatus('Сварка остановлена');
    this.publishRosStatus();
    this.refresh();
  }

  private resetWelding(): void {
    this.welding.reset();
    this.state.weldingActive = false;
    this.sidebar.setStatus('Прогресс сварки сброшен');
    this.publishRosStatus();
    this.refresh();
  }

  private connectRos(url: string): void {
    this.ros.connect(url);
    this.sidebar.setStatus(`Подключение к ROS: ${url}`);
  }

  private disconnectRos(): void {
    this.ros.disconnect();
    this.sidebar.setStatus('ROS отключён');
    this.refresh();
  }

  private async exportMoveIt(): Promise<void> {
    const seams = this.seamManager.getSelectedSeams();
    if (seams.length === 0) {
      alert('Выберите швы для экспорта');
      return;
    }
    try {
      const plan = this.state.backendOnline
        ? await this.backend.exportMoveIt(seams)
        : await import('./MoveItExporter').then((m) => m.buildLocalMoveItPlan(seams));
      this.lastMoveItPlan = plan as unknown as Record<string, unknown>;
      this.sidebar.setStatus(`MoveIt plan: ${seams.length} швов`);
      this.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Ошибка экспорта');
    }
  }

  private sendTrajectoryToRos(): void {
    if (!this.state.rosConnected) {
      alert('Сначала подключитесь к rosbridge');
      return;
    }
    if (!this.lastMoveItPlan) {
      alert('Сначала экспортируйте MoveIt plan');
      return;
    }
    this.ros.publishTrajectory(this.lastMoveItPlan);
    this.sidebar.setStatus('Траектория отправлена в ROS (/welding_demo/trajectory)');
  }

  private downloadPlan(): void {
    if (!this.lastMoveItPlan) {
      alert('Сначала экспортируйте MoveIt plan');
      return;
    }
    downloadJson('weld_plan.json', this.lastMoveItPlan);
  }

  private publishRosStatus(): void {
    if (!this.state.rosConnected) return;
    this.ros.publishStatus({
      active: this.welding.active,
      paused: this.welding.paused,
      current_seam: this.welding.currentSeam?.id ?? null,
      overall_progress: this.welding.overallProgress,
      remaining: this.welding.remainingCount,
    });
  }

  private refresh(): void {
    this.state.seams = this.seamManager.seams;
    this.state.scanResults = this.scanner.scanResults;
    this.state.weldingActive = this.welding.active;
    this.state.currentSeamIndex = this.welding.currentIndex;
    this.publishRosStatus();
    this.sidebar.update(this.state, this.seamManager, this.scanner, this.welding, this.ros);
  }
}
