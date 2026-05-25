import {
  WELD_TYPE_COLORS,
  WELD_TYPE_LABELS,
  type AppState,
  type SensorMode,
  type WeldType,
  type WorkflowStep,
} from '../types';
import type { SeamManager } from './SeamManager';
import type { PointCloudScanner } from './PointCloudScanner';
import type { WeldingController } from './WeldingController';

const STEPS: { id: WorkflowStep; label: string }[] = [
  { id: 'model', label: '1. CAD' },
  { id: 'seams', label: '2. Швы' },
  { id: 'scan', label: '3. Скан' },
  { id: 'weld', label: '4. Сварка' },
];

export interface SidebarCallbacks {
  onLoadDemo: () => void;
  onLoadFile: (file: File) => void;
  onDetectSeams: () => void;
  onSelectAllSeams: (selected: boolean) => void;
  onToggleSeam: (id: string) => void;
  onSetWeldType: (id: string, type: WeldType) => void;
  onGoToStep: (step: WorkflowStep) => void;
  onScan: (sensor: SensorMode) => void;
  onAlign: () => void;
  onClearClouds: () => void;
  onStartWelding: () => void;
  onPauseWelding: () => void;
  onStopWelding: () => void;
  onResetWelding: () => void;
}

export class Sidebar {
  private sensorMode: SensorMode = 'far';

  constructor(
    private root: HTMLElement,
    private stepsRoot: HTMLElement,
    private callbacks: SidebarCallbacks,
  ) {
    this.render();
  }

  update(
    state: AppState,
    seamManager: SeamManager,
    scanner: PointCloudScanner,
    welding: WeldingController,
  ): void {
    this.renderSteps(state);
    this.setActivePanel(state.step);
    this.updateModelPanel(state);
    this.updateSeamsPanel(seamManager);
    this.updateScanPanel(scanner, seamManager, state);
    this.updateWeldPanel(welding, state);
  }

  setStatus(text: string): void {
    const chip = document.getElementById('status-chip');
    if (chip) chip.textContent = text;
  }

  setHint(text: string): void {
    const hint = document.getElementById('viewport-hint');
    if (hint) hint.textContent = text;
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="panel active" data-panel="model">
        <h2>CAD-модель</h2>
        <p class="subtitle">Загрузите STL, OBJ или GLTF/GLB либо используйте демо-деталь для сварки.</p>
        <div class="section">
          <h3>Загрузка</h3>
          <label class="file-label" for="cad-file">
            Перетащите файл или нажмите для выбора<br/>
            <small>STL · OBJ · GLTF · GLB</small>
          </label>
          <input class="file-input" id="cad-file" type="file" accept=".stl,.obj,.gltf,.glb" />
          <button class="btn primary" id="load-demo" style="margin-top:0.5rem">Загрузить демо-деталь</button>
        </div>
        <div class="section">
          <h3>Текущая модель</h3>
          <div id="model-info" class="info-box">Модель не загружена</div>
        </div>
        <button class="btn" id="goto-seams" disabled>Далее: выбор швов →</button>
      </div>

      <div class="panel" data-panel="seams">
        <h2>Сварочные швы</h2>
        <p class="subtitle">Авто-поиск рёбер или ручной выбор кликом по линии шва в 3D-сцене.</p>
        <div class="section">
          <div class="btn-row">
            <button class="btn primary" id="detect-seams">Найти швы автоматически</button>
            <button class="btn" id="select-all-seams">Выбрать все</button>
          </div>
        </div>
        <div class="section">
          <h3>Список швов</h3>
          <div id="seam-list" class="seam-list">
            <div class="empty-state">Сначала загрузите модель и выполните поиск швов</div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" id="back-to-model">← CAD</button>
          <button class="btn primary" id="goto-scan" disabled>Далее: сканирование →</button>
        </div>
      </div>

      <div class="panel" data-panel="scan">
        <h2>Сканирование зоны</h2>
        <p class="subtitle">Дальний датчик — обзорная сетка точек. Ближний — плотное облако для уточнения.</p>
        <div class="section">
          <h3>Датчик</h3>
          <div class="toggle-row">
            <button class="btn active" id="sensor-far">Дальний</button>
            <button class="btn" id="sensor-near">Ближний</button>
          </div>
          <button class="btn primary" id="run-scan" style="margin-top:0.5rem">Сканировать</button>
          <button class="btn" id="align-scans" style="margin-top:0.5rem">Сопоставить с CAD</button>
          <button class="btn" id="clear-clouds" style="margin-top:0.5rem">Очистить облака</button>
        </div>
        <div class="section">
          <h3>Результаты</h3>
          <div id="scan-info" class="info-box">Сканирование не выполнялось</div>
        </div>
        <div class="btn-row">
          <button class="btn" id="back-to-seams">← Швы</button>
          <button class="btn primary" id="goto-weld" disabled>Далее: сварка →</button>
        </div>
      </div>

      <div class="panel" data-panel="weld">
        <h2>Управление сваркой</h2>
        <p class="subtitle">Запуск процесса, текущий шов, прогресс и оставшиеся швы.</p>
        <div class="section">
          <div class="stat-grid">
            <div class="stat">
              <div class="label">Текущий шов</div>
              <div class="value" id="current-seam">—</div>
            </div>
            <div class="stat">
              <div class="label">Осталось</div>
              <div class="value" id="remaining-seams">0</div>
            </div>
          </div>
          <div class="progress-bar"><div class="progress-fill" id="overall-progress" style="width:0%"></div></div>
        </div>
        <div class="section">
          <div class="btn-row">
            <button class="btn success" id="start-weld">Старт</button>
            <button class="btn" id="pause-weld">Пауза</button>
          </div>
          <div class="btn-row" style="margin-top:0.5rem">
            <button class="btn danger" id="stop-weld">Стоп</button>
            <button class="btn" id="reset-weld">Сброс</button>
          </div>
        </div>
        <div class="section">
          <h3>Очередь швов</h3>
          <div id="weld-queue" class="seam-list"></div>
        </div>
        <button class="btn" id="back-to-scan">← Сканирование</button>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const fileInput = this.root.querySelector<HTMLInputElement>('#cad-file')!;
    const fileLabel = this.root.querySelector<HTMLLabelElement>('.file-label')!;

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.callbacks.onLoadFile(file);
      fileInput.value = '';
    });

    fileLabel.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileLabel.style.borderColor = '#3b82f6';
    });
    fileLabel.addEventListener('dragleave', () => {
      fileLabel.style.borderColor = '';
    });
    fileLabel.addEventListener('drop', (e) => {
      e.preventDefault();
      fileLabel.style.borderColor = '';
      const file = e.dataTransfer?.files?.[0];
      if (file) this.callbacks.onLoadFile(file);
    });

    this.root.querySelector('#load-demo')!.addEventListener('click', () => this.callbacks.onLoadDemo());
    this.root.querySelector('#detect-seams')!.addEventListener('click', () => this.callbacks.onDetectSeams());
    this.root.querySelector('#select-all-seams')!.addEventListener('click', () => {
      this.callbacks.onSelectAllSeams(true);
    });
    this.root.querySelector('#run-scan')!.addEventListener('click', () => this.callbacks.onScan(this.sensorMode));
    this.root.querySelector('#align-scans')!.addEventListener('click', () => this.callbacks.onAlign());
    this.root.querySelector('#clear-clouds')!.addEventListener('click', () => this.callbacks.onClearClouds());
    this.root.querySelector('#start-weld')!.addEventListener('click', () => this.callbacks.onStartWelding());
    this.root.querySelector('#pause-weld')!.addEventListener('click', () => this.callbacks.onPauseWelding());
    this.root.querySelector('#stop-weld')!.addEventListener('click', () => this.callbacks.onStopWelding());
    this.root.querySelector('#reset-weld')!.addEventListener('click', () => this.callbacks.onResetWelding());

    this.root.querySelector('#sensor-far')!.addEventListener('click', () => this.setSensor('far'));
    this.root.querySelector('#sensor-near')!.addEventListener('click', () => this.setSensor('near'));

    this.root.querySelector('#goto-seams')!.addEventListener('click', () => this.callbacks.onGoToStep('seams'));
    this.root.querySelector('#goto-scan')!.addEventListener('click', () => this.callbacks.onGoToStep('scan'));
    this.root.querySelector('#goto-weld')!.addEventListener('click', () => this.callbacks.onGoToStep('weld'));
    this.root.querySelector('#back-to-model')!.addEventListener('click', () => this.callbacks.onGoToStep('model'));
    this.root.querySelector('#back-to-seams')!.addEventListener('click', () => this.callbacks.onGoToStep('seams'));
    this.root.querySelector('#back-to-scan')!.addEventListener('click', () => this.callbacks.onGoToStep('scan'));
  }

  private setSensor(mode: SensorMode): void {
    this.sensorMode = mode;
    this.root.querySelector('#sensor-far')!.classList.toggle('active', mode === 'far');
    this.root.querySelector('#sensor-near')!.classList.toggle('active', mode === 'near');
  }

  private renderSteps(state: AppState): void {
    this.stepsRoot.innerHTML = STEPS.map((step) => {
      const index = STEPS.findIndex((s) => s.id === state.step);
      const stepIndex = STEPS.findIndex((s) => s.id === step.id);
      const cls = stepIndex === index ? 'active' : stepIndex < index ? 'done' : '';
      return `<div class="step-pill ${cls}">${step.label}</div>`;
    }).join('');
  }

  private setActivePanel(step: WorkflowStep): void {
    this.root.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === step);
    });
  }

  private updateModelPanel(state: AppState): void {
    const info = this.root.querySelector('#model-info')!;
    info.textContent = state.modelLoaded
      ? `Загружена: ${state.modelName}`
      : 'Модель не загружена';
    (this.root.querySelector('#goto-seams') as HTMLButtonElement).disabled = !state.modelLoaded;
  }

  private updateSeamsPanel(seamManager: SeamManager): void {
    const list = this.root.querySelector('#seam-list')!;
    const seams = seamManager.seams;

    if (seams.length === 0) {
      list.innerHTML = '<div class="empty-state">Сначала загрузите модель и выполните поиск швов</div>';
    } else {
      list.innerHTML = seams.map((seam) => `
        <div class="seam-item ${seam.selected ? 'selected' : ''} ${seam.status === 'active' ? 'active-weld' : ''} ${seam.status === 'done' ? 'done' : ''}" data-seam-id="${seam.id}">
          <span class="seam-dot" style="background:#${WELD_TYPE_COLORS[seam.weldType].toString(16).padStart(6, '0')}"></span>
          <div>
            <strong>${seam.id}</strong>
            <div class="seam-meta">${seam.autoDetected ? 'Авто' : 'Ручной'} · ${seam.length.toFixed(2)} м</div>
            <select class="seam-select" data-type-select="${seam.id}">
              ${(Object.keys(WELD_TYPE_LABELS) as WeldType[]).map((type) => `
                <option value="${type}" ${seam.weldType === type ? 'selected' : ''}>${WELD_TYPE_LABELS[type]}</option>
              `).join('')}
            </select>
          </div>
          <span>${Math.round(seam.progress * 100)}%</span>
        </div>
      `).join('');

      list.querySelectorAll('.seam-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).tagName === 'SELECT') return;
          const id = item.getAttribute('data-seam-id')!;
          this.callbacks.onToggleSeam(id);
        });
      });

      list.querySelectorAll<HTMLSelectElement>('[data-type-select]').forEach((select) => {
        select.addEventListener('change', () => {
          this.callbacks.onSetWeldType(select.dataset.typeSelect!, select.value as WeldType);
        });
      });
    }

    (this.root.querySelector('#goto-scan') as HTMLButtonElement).disabled =
      seamManager.getSelectedSeams().length === 0;
  }

  private updateScanPanel(scanner: PointCloudScanner, seamManager: SeamManager, state: AppState): void {
    const info = this.root.querySelector('#scan-info')!;
    if (scanner.scanResults.length === 0) {
      info.className = 'info-box';
      info.textContent = 'Сканирование не выполнялось';
    } else {
      const last = scanner.scanResults[scanner.scanResults.length - 1];
      info.className = state.alignmentDone ? 'info-box success' : 'info-box';
      info.innerHTML = `
        Сканов: ${scanner.scanResults.length}<br/>
        Последний: ${last.sensor === 'far' ? 'дальний' : 'ближний'} датчик, ${last.points.length / 3} точек<br/>
        ${state.alignmentDone
          ? `Совмещение выполнено. Ошибка: ${last.alignmentError.toFixed(2)} мм-экв.<br/>Найдено швов: ${last.matchedSeams.length}`
          : 'Выполните сопоставление с CAD-моделью'}
      `;
    }
    (this.root.querySelector('#goto-weld') as HTMLButtonElement).disabled =
      !state.alignmentDone || seamManager.getSelectedSeams().length === 0;
  }

  private updateWeldPanel(welding: WeldingController, state: AppState): void {
    const current = welding.currentSeam;
    this.root.querySelector('#current-seam')!.textContent =
      state.weldingActive && current ? current.id : current?.status === 'done' ? 'Завершено' : '—';
    this.root.querySelector('#remaining-seams')!.textContent = String(welding.remainingCount);
    (this.root.querySelector('#overall-progress') as HTMLElement).style.width =
      `${welding.overallProgress.toFixed(1)}%`;

    const queue = this.root.querySelector('#weld-queue')!;
    const seams = welding.selectedSeams;
    queue.innerHTML = seams.length === 0
      ? '<div class="empty-state">Нет выбранных швов</div>'
      : seams.map((seam, index) => `
          <div class="seam-item ${seam.status === 'active' ? 'active-weld' : ''} ${seam.status === 'done' ? 'done' : ''}">
            <span class="seam-dot" style="background:#${WELD_TYPE_COLORS[seam.weldType].toString(16).padStart(6, '0')}"></span>
            <div>
              <strong>#${index + 1} ${seam.id}</strong>
              <div class="seam-meta">${WELD_TYPE_LABELS[seam.weldType]}</div>
            </div>
            <span>${Math.round(seam.progress * 100)}%</span>
          </div>
        `).join('');
  }
}
