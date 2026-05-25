import type { AppState, SensorMode, WorkflowStep } from '../types';
import { SceneManager } from './SceneManager';
import { ModelLoader } from './ModelLoader';
import { SeamManager } from './SeamManager';
import { PointCloudScanner } from './PointCloudScanner';
import { WeldingController } from './WeldingController';
import { Sidebar } from './Sidebar';

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
  };

  private sceneManager: SceneManager;
  private modelLoader: ModelLoader;
  private seamManager: SeamManager;
  private scanner: PointCloudScanner;
  private welding: WeldingController;
  private sidebar: Sidebar;

  constructor(canvas: HTMLCanvasElement) {
    this.sceneManager = new SceneManager(canvas);
    this.modelLoader = new ModelLoader(this.sceneManager);
    this.seamManager = new SeamManager(this.sceneManager, this.modelLoader);
    this.scanner = new PointCloudScanner(this.sceneManager, this.modelLoader, this.seamManager);
    this.welding = new WeldingController(this.sceneManager, this.seamManager, () => this.refresh());

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
      },
    );

    this.bindViewportEvents();
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
      const model = await this.modelLoader.loadFile(file);
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
      model: 'Загрузите CAD или используйте демо-деталь',
      seams: 'Клик по линии шва — выбор. Цвет соответствует типу сварки',
      scan: 'Синие точки — дальний датчик, зелёные — ближний',
      weld: 'Активный шов подсвечивается жёлтым, горелка движется по траектории',
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
      this.sidebar.setStatus('Сопоставление облака точек с CAD...');
      const { error, matchedSeams } = await this.scanner.alignScans();
      this.state.alignmentDone = true;
      this.sidebar.setStatus(`Совмещение выполнено. Ошибка ${error.toFixed(2)} мм-экв.`);
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
    this.refresh();
  }

  private pauseWelding(): void {
    this.welding.pause();
    this.state.weldingActive = this.welding.active && !this.welding.paused;
    this.sidebar.setStatus(this.welding.paused ? 'Сварка на паузе' : 'Сварка продолжена');
    this.refresh();
  }

  private stopWelding(): void {
    this.welding.stop();
    this.state.weldingActive = false;
    this.sidebar.setStatus('Сварка остановлена');
    this.refresh();
  }

  private resetWelding(): void {
    this.welding.reset();
    this.state.weldingActive = false;
    this.sidebar.setStatus('Прогресс сварки сброшен');
    this.refresh();
  }

  private refresh(): void {
    this.state.seams = this.seamManager.seams;
    this.state.scanResults = this.scanner.scanResults;
    this.state.weldingActive = this.welding.active;
    this.state.currentSeamIndex = this.welding.currentIndex;
    this.sidebar.update(this.state, this.seamManager, this.scanner, this.welding);
  }
}
