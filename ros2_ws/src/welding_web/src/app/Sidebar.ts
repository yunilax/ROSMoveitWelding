import {
  SEAM_SOURCE_LABELS,
  WELD_TYPE_COLORS,
  WELD_TYPE_LABELS,
  type AppState,
  type ScanPassCount,
  type WeldSeam,
  type WeldType,
  type WorkflowStep,
} from '../types';
import type { SeamManager } from './SeamManager';
import type { PointCloudScanner } from './PointCloudScanner';
import type { WeldingController } from './WeldingController';
import type { RosBridgeClient } from './RosBridgeClient';

const STEPS: { id: WorkflowStep; label: string }[] = [
  { id: 'model', label: '1 · CAD' },
  { id: 'scan', label: '2 · Скан' },
  { id: 'seams', label: '3 · Швы' },
  { id: 'weld', label: '4 · Сварка' },
  { id: 'integrate', label: '5 · ROS' },
];

const WELD_TYPES: WeldType[] = ['fillet', 'butt', 'corner', 'lap', 'plug'];

export interface SidebarCallbacks {
  onLoadSample: () => void;
  onLoadFile: (file: File) => void;
  onDetectSeams: () => void;
  onSelectAllSeams: (selected: boolean) => void;
  onToggleSeam: (id: string) => void;
  onFocusSeam: (id: string) => void;
  onSeamNav: (direction: 1 | -1) => void;
  onSetWeldType: (id: string, type: WeldType) => void;
  onGoToStep: (step: WorkflowStep) => void;
  onScan: (passCount: ScanPassCount) => void;
  onAlign: () => void;
  onClearClouds: () => void;
  onStartWelding: () => void;
  onPauseWelding: () => void;
  onStopWelding: () => void;
  onResetWelding: () => void;
  onConnectRos: (url: string) => void;
  onDisconnectRos: () => void;
  onExportMoveIt: () => void;
  onSendTrajectoryRos: () => void;
  onDownloadPlan: () => void;
  onRefreshBackend: () => void;
  onToggleBackendIcp: (enabled: boolean) => void;
}

export class Sidebar {
  private passCount: ScanPassCount = 3;

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
    ros: RosBridgeClient,
  ): void {
    this.renderSteps(state);
    this.setActivePanel(state.step);
    this.updateModelPanel(state);
    this.updateScanPanel(scanner, state);
    this.updateSeamsPanel(seamManager, state);
    this.updateWeldPanel(welding, state, seamManager);
    this.updateIntegratePanel(state, ros);
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
        <h2>Шаг 1 · CAD-модель</h2>
        <p class="subtitle">Загрузите STL / OBJ / GLTF / GLB или STEP (через backend). Можно использовать встроенный образец.</p>
        <div class="section">
          <h3>Загрузка</h3>
          <label class="file-label" for="cad-file">
            Перетащите файл или нажмите для выбора<br/>
            <small>STL · OBJ · GLTF · GLB · STEP</small>
          </label>
          <input class="file-input" id="cad-file" type="file" accept=".stl,.obj,.gltf,.glb,.step,.stp" />
          <button class="btn primary" id="load-sample" style="margin-top:0.5rem">Загрузить образец детали</button>
        </div>
        <div class="section">
          <h3>Backend API</h3>
          <div id="backend-info" class="info-box">Проверка...</div>
          <button class="btn" id="refresh-backend" style="margin-top:0.5rem">Обновить статус</button>
        </div>
        <div class="section">
          <h3>Текущая модель</h3>
          <div id="model-info" class="info-box">Модель не загружена</div>
        </div>
        <button class="btn primary" id="goto-scan-from-model" disabled>Далее: сканирование детали →</button>
      </div>

      <div class="panel" data-panel="scan">
        <h2>Шаг 2 · Сканирование и совмещение</h2>
        <p class="subtitle">Скан показывает, где деталь <em>на самом деле</em> лежит на столе. ICP переносит CAD и швы на эту позу.</p>
        <div class="scan-flow-box">
          <strong>Зачем скан?</strong> CAD может не совпадать с реальной деталью.
          Облако точек — эталон. После ICP швы оказываются на реальной геометрии и сварка идёт правильно.
        </div>
        <div class="section">
          <h3>Проходы</h3>
          <div class="toggle-row">
            <button class="btn" id="pass-2">2 прохода</button>
            <button class="btn active" id="pass-3">3 прохода</button>
          </div>
          <button class="btn primary" id="run-scan" style="margin-top:0.5rem">Сканировать дальним датчиком</button>
        </div>
        <div class="section">
          <h3>Совмещение с CAD</h3>
          <button class="btn primary" id="align-scans">Найти позу детали (ICP)</button>
          <label class="check-row" style="margin-top:0.5rem">
            <input type="checkbox" id="use-backend-icp" checked />
            ICP через backend (Open3D)
          </label>
          <button class="btn" id="clear-clouds" style="margin-top:0.5rem">Очистить облака</button>
        </div>
        <div class="section align-card" id="align-card">
          <h3>Результат сопоставления</h3>
          <div id="align-info" class="info-box">Выполните сканирование и сопоставление</div>
        </div>
        <div class="btn-row">
          <button class="btn" id="back-to-model">← CAD</button>
          <button class="btn primary" id="goto-seams" disabled>Далее: швы →</button>
        </div>
      </div>

      <div class="panel" data-panel="seams">
        <h2>Шаг 3 · Сварочные швы</h2>
        <p class="subtitle">Найденные швы — контактные линии между деталями и вогнутые рёбра. Кликайте по шву в 3D или используйте «‹» «›».</p>
        <div class="section">
          <div class="btn-row">
            <button class="btn" id="detect-seams">Перепоиск</button>
            <button class="btn" id="select-all-seams">Выбрать все</button>
            <button class="btn" id="deselect-all-seams">Снять все</button>
          </div>
          <div id="seam-stats-bar" class="seam-stats-bar"></div>
        </div>
        <div class="section">
          <h3>Навигатор шва</h3>
          <div class="nav-row">
            <button class="btn nav-btn" id="seam-prev">‹</button>
            <div id="focused-seam-card" class="focused-card">Выберите шов</div>
            <button class="btn nav-btn" id="seam-next">›</button>
          </div>
        </div>
        <div class="section seam-list-section">
          <h3>Все швы</h3>
          <div id="seam-list" class="seam-list seam-list--tall">
            <div class="empty-state">Загрузите модель — швы найдутся автоматически</div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" id="back-to-scan">← Скан</button>
          <button class="btn primary" id="goto-weld" disabled>Далее: сварка →</button>
        </div>
      </div>

      <div class="panel" data-panel="weld">
        <h2>Шаг 4 · Управление сваркой</h2>
        <p class="subtitle">Активный шов подсвечивается жёлтым, горелка движется по траектории.</p>
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
        <div class="btn-row">
          <button class="btn" id="back-to-seams">← Швы</button>
          <button class="btn primary" id="goto-integrate">Далее: ROS / MoveIt →</button>
        </div>
      </div>

      <div class="panel" data-panel="integrate">
        <h2>Шаг 5 · ROS / MoveIt</h2>
        <p class="subtitle">rosbridge, экспорт траекторий швов и отправка в RViz.</p>
        <div class="section">
          <h3>rosbridge</h3>
          <input class="text-input" id="ros-url" value="ws://localhost:9090" />
          <div class="btn-row" style="margin-top:0.5rem">
            <button class="btn success" id="connect-ros">Подключить</button>
            <button class="btn" id="disconnect-ros">Отключить</button>
          </div>
          <div id="ros-info" class="info-box" style="margin-top:0.5rem">Не подключено</div>
        </div>
        <div class="section">
          <h3>MoveIt export</h3>
          <button class="btn primary" id="export-moveit">Экспорт траекторий</button>
          <div class="btn-row" style="margin-top:0.5rem">
            <button class="btn" id="download-plan">Скачать JSON</button>
            <button class="btn" id="send-trajectory-ros">Отправить в ROS</button>
          </div>
        </div>
        <button class="btn" id="back-to-weld">← Сварка</button>
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
      fileLabel.classList.add('dragover');
    });
    fileLabel.addEventListener('dragleave', () => fileLabel.classList.remove('dragover'));
    fileLabel.addEventListener('drop', (e) => {
      e.preventDefault();
      fileLabel.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.callbacks.onLoadFile(file);
    });

    const c = this.callbacks;
    this.root.querySelector('#load-sample')!.addEventListener('click', () => c.onLoadSample());
    this.root.querySelector('#detect-seams')!.addEventListener('click', () => c.onDetectSeams());
    this.root.querySelector('#select-all-seams')!.addEventListener('click', () => c.onSelectAllSeams(true));
    this.root.querySelector('#deselect-all-seams')!.addEventListener('click', () => c.onSelectAllSeams(false));
    this.root.querySelector('#run-scan')!.addEventListener('click', () => c.onScan(this.passCount));
    this.root.querySelector('#align-scans')!.addEventListener('click', () => c.onAlign());
    this.root.querySelector('#clear-clouds')!.addEventListener('click', () => c.onClearClouds());
    this.root.querySelector('#start-weld')!.addEventListener('click', () => c.onStartWelding());
    this.root.querySelector('#pause-weld')!.addEventListener('click', () => c.onPauseWelding());
    this.root.querySelector('#stop-weld')!.addEventListener('click', () => c.onStopWelding());
    this.root.querySelector('#reset-weld')!.addEventListener('click', () => c.onResetWelding());
    this.root.querySelector('#refresh-backend')!.addEventListener('click', () => c.onRefreshBackend());
    this.root.querySelector('#use-backend-icp')!.addEventListener('change', (e) => {
      c.onToggleBackendIcp((e.target as HTMLInputElement).checked);
    });
    this.root.querySelector('#connect-ros')!.addEventListener('click', () => {
      const url = (this.root.querySelector('#ros-url') as HTMLInputElement).value;
      c.onConnectRos(url);
    });
    this.root.querySelector('#disconnect-ros')!.addEventListener('click', () => c.onDisconnectRos());
    this.root.querySelector('#export-moveit')!.addEventListener('click', () => c.onExportMoveIt());
    this.root.querySelector('#download-plan')!.addEventListener('click', () => c.onDownloadPlan());
    this.root.querySelector('#send-trajectory-ros')!.addEventListener('click', () => c.onSendTrajectoryRos());

    this.root.querySelector('#pass-2')!.addEventListener('click', () => this.setPassCount(2));
    this.root.querySelector('#pass-3')!.addEventListener('click', () => this.setPassCount(3));

    this.root.querySelector('#seam-prev')!.addEventListener('click', () => c.onSeamNav(-1));
    this.root.querySelector('#seam-next')!.addEventListener('click', () => c.onSeamNav(1));

    this.root.querySelector('#goto-scan-from-model')!.addEventListener('click', () => c.onGoToStep('scan'));
    this.root.querySelector('#goto-seams')!.addEventListener('click', () => c.onGoToStep('seams'));
    this.root.querySelector('#goto-weld')!.addEventListener('click', () => c.onGoToStep('weld'));
    this.root.querySelector('#goto-integrate')!.addEventListener('click', () => c.onGoToStep('integrate'));
    this.root.querySelector('#back-to-model')!.addEventListener('click', () => c.onGoToStep('model'));
    this.root.querySelector('#back-to-scan')!.addEventListener('click', () => c.onGoToStep('scan'));
    this.root.querySelector('#back-to-seams')!.addEventListener('click', () => c.onGoToStep('seams'));
    this.root.querySelector('#back-to-weld')!.addEventListener('click', () => c.onGoToStep('weld'));

    // keyboard nav on seams step
    window.addEventListener('keydown', (e) => {
      const panel = this.root.querySelector('.panel.active');
      if (panel?.getAttribute('data-panel') !== 'seams') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowRight' || e.key === 'n') c.onSeamNav(1);
      else if (e.key === 'ArrowLeft' || e.key === 'p') c.onSeamNav(-1);
    });
  }

  private setPassCount(count: ScanPassCount): void {
    this.passCount = count;
    this.root.querySelector('#pass-2')!.classList.toggle('active', count === 2);
    this.root.querySelector('#pass-3')!.classList.toggle('active', count === 3);
  }

  private renderSteps(state: AppState): void {
    const activeIdx = STEPS.findIndex((s) => s.id === state.step);
    this.stepsRoot.innerHTML = STEPS.map((step, i) => {
      const cls = i === activeIdx ? 'active' : i < activeIdx ? 'done' : '';
      return `<div class="step-pill ${cls}" data-go="${step.id}">${i === activeIdx ? '<span class="step-pill-dot" aria-hidden="true"></span>' : ""}${step.label}</div>`;
    }).join('');
    this.stepsRoot.querySelectorAll<HTMLElement>('.step-pill').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-go') as WorkflowStep | null;
        if (id) this.callbacks.onGoToStep(id);
      });
    });
  }

  private setActivePanel(step: WorkflowStep): void {
    this.root.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.getAttribute('data-panel') === step);
    });
  }

  private updateModelPanel(state: AppState): void {
    const info = this.root.querySelector('#model-info')!;
    info.textContent = state.modelLoaded ? `Загружена: ${state.modelName}` : 'Модель не загружена';
    (this.root.querySelector('#goto-scan-from-model') as HTMLButtonElement).disabled = !state.modelLoaded;

    const backendInfo = this.root.querySelector('#backend-info')!;
    backendInfo.className = state.backendOnline ? 'info-box success' : 'info-box';
    backendInfo.textContent = state.backendOnline
      ? 'Backend online — STEP, ICP (Open3D), MoveIt export'
      : 'Backend offline — запустите welding_backend на :8000';
  }

  private updateScanPanel(scanner: PointCloudScanner, state: AppState): void {
    const info = this.root.querySelector('#align-info')!;
    const card = this.root.querySelector('#align-card')!;
    if (scanner.scanResults.length === 0) {
      info.className = 'info-box';
      info.textContent = 'Выполните сканирование и сопоставление';
      card.classList.remove('success');
    } else if (!state.alignmentDone || !state.alignmentPose) {
      const totalPoints = scanner.getTotalPointCount();
      info.className = 'info-box';
      info.innerHTML = `Точек: <b>${totalPoints}</b> · сканов: ${scanner.scanResults.length}<br/><span style="color:#fdba74">CAD ≠ деталь на столе</span> — нужен ICP<br/>Швы пока на модели, не на скане`;
      card.classList.remove('success');
    } else {
      const p = state.alignmentPose;
      const last = scanner.scanResults[scanner.scanResults.length - 1];
      info.className = 'info-box success';
      info.innerHTML = `
        <strong style="color:#86efac">CAD и швы совмещены со сканом</strong><br/>
        <div class="metric-grid">
          <div><span class="m-lbl">Fitness</span><span class="m-val">${(p.fitness * 100).toFixed(1)}%</span></div>
          <div><span class="m-lbl">RMSE</span><span class="m-val">${p.rmse.toFixed(4)}</span></div>
          <div><span class="m-lbl">Источник</span><span class="m-val">${p.source === 'backend' ? 'Open3D' : 'Локально'}</span></div>
          <div><span class="m-lbl">Швов</span><span class="m-val">${last.matchedSeams.length}</span></div>
        </div>
        <div class="pose-line">T: ${p.translation.map((v) => v.toFixed(3)).join(', ')}</div>
        <div class="pose-line">R°: ${p.rotationEulerDeg.map((v) => v.toFixed(1)).join(', ')}</div>
      `;
      card.classList.add('success');
    }
    (this.root.querySelector('#goto-seams') as HTMLButtonElement).disabled = !state.modelLoaded;

    const icpCheckbox = this.root.querySelector('#use-backend-icp') as HTMLInputElement | null;
    if (icpCheckbox) icpCheckbox.checked = state.useBackendIcp;
  }

  private updateSeamsPanel(seamManager: SeamManager, state: AppState): void {
    const list = this.root.querySelector('#seam-list')!;
    const seams = seamManager.seams;
    const stats = seamManager.getStats();
    const focusedId = state.focusedSeamId;

    const statsBar = this.root.querySelector('#seam-stats-bar')!;
    statsBar.innerHTML = `
      <span class="chip-stat">Всего <b>${stats.total}</b></span>
      <span class="chip-stat accent">Выбрано <b>${stats.selected}</b></span>
      <span class="chip-stat">Длина <b>${stats.selectedLength.toFixed(2)}</b> м</span>
      <span class="chip-stat src-contact">Контакт ${stats.bySource.contact}</span>
      <span class="chip-stat src-concave">Вогн. ${stats.bySource.concave}</span>
      <span class="chip-stat src-sharp">Острые ${stats.bySource.sharp}</span>
    `;

    const focusedCard = this.root.querySelector('#focused-seam-card')!;
    const focused = focusedId ? seams.find((s) => s.id === focusedId) : null;
    if (!focused) {
      focusedCard.innerHTML = seams.length
        ? '<span class="muted">Клик по шву в 3D или используйте ‹ ›</span>'
        : '<span class="muted">Швов нет</span>';
    } else {
      const idx = seams.indexOf(focused) + 1;
      focusedCard.innerHTML = `
        <div class="focused-head">
          <span class="seam-dot" style="background:#${WELD_TYPE_COLORS[focused.weldType].toString(16).padStart(6, '0')}"></span>
          <strong>${focused.id}</strong>
          <span class="muted">${idx}/${seams.length}</span>
        </div>
        <div class="focused-meta">
          <span class="src-badge src-${focused.source}">${SEAM_SOURCE_LABELS[focused.source]}</span>
          <span>${focused.length.toFixed(3)} м</span>
          ${focused.dihedralDeg != null ? `<span>${focused.dihedralDeg.toFixed(0)}°</span>` : ''}
        </div>
        <div class="weld-chips" data-seam="${focused.id}">
          ${WELD_TYPES.map((t) => `
            <button class="weld-chip ${focused.weldType === t ? 'active' : ''}" data-type="${t}" style="--chip-c:#${WELD_TYPE_COLORS[t].toString(16).padStart(6, '0')}">${WELD_TYPE_LABELS[t]}</button>
          `).join('')}
        </div>
        <button class="btn ${focused.selected ? 'primary' : ''}" data-sel-toggle="${focused.id}" style="margin-top:0.45rem">
          ${focused.selected ? '✓ Выбран для сварки' : 'Добавить к сварке'}
        </button>
      `;

      focusedCard.querySelectorAll<HTMLButtonElement>('.weld-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          this.callbacks.onSetWeldType(focused.id, chip.dataset.type as WeldType);
        });
      });
      const selBtn = focusedCard.querySelector<HTMLButtonElement>('[data-sel-toggle]');
      selBtn?.addEventListener('click', () => this.callbacks.onToggleSeam(focused.id));
    }

    if (seams.length === 0) {
      list.innerHTML = '<div class="empty-state">Загрузите модель — швы найдутся автоматически</div>';
    } else {
      list.innerHTML = seams.map((seam) => this.renderSeamListItem(seam, seam.id === focusedId)).join('');
      list.querySelectorAll<HTMLElement>('.seam-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.closest('[data-action="toggle"]')) {
            this.callbacks.onToggleSeam(item.dataset.seamId!);
          } else {
            this.callbacks.onFocusSeam(item.dataset.seamId!);
          }
        });
      });
    }

    (this.root.querySelector('#goto-weld') as HTMLButtonElement).disabled =
      seamManager.getSelectedSeams().length === 0;
  }

  private renderSeamListItem(seam: WeldSeam, focused: boolean): string {
    const color = `#${WELD_TYPE_COLORS[seam.weldType].toString(16).padStart(6, '0')}`;
    return `
      <div class="seam-item ${seam.selected ? 'selected' : ''} ${focused ? 'focused' : ''} ${seam.status === 'active' ? 'active-weld' : ''} ${seam.status === 'done' ? 'done' : ''}" data-seam-id="${seam.id}">
        <span class="seam-dot" style="background:${color}"></span>
        <div class="seam-info">
          <strong>${seam.id}</strong>
          <div class="seam-meta">
            <span class="src-badge src-${seam.source}">${SEAM_SOURCE_LABELS[seam.source]}</span>
            <span>${seam.length.toFixed(2)} м</span>
            <span>${WELD_TYPE_LABELS[seam.weldType]}</span>
          </div>
        </div>
        <button class="mini-btn ${seam.selected ? 'on' : ''}" data-action="toggle" title="${seam.selected ? 'Убрать' : 'Добавить'}">${seam.selected ? '✓' : '+'}</button>
      </div>
    `;
  }

  private updateWeldPanel(welding: WeldingController, state: AppState, _seamManager: SeamManager): void {
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
            <div class="seam-info">
              <strong>#${index + 1} ${seam.id}</strong>
              <div class="seam-meta">${WELD_TYPE_LABELS[seam.weldType]}</div>
            </div>
            <span>${Math.round(seam.progress * 100)}%</span>
          </div>
        `).join('');
  }

  private updateIntegratePanel(state: AppState, ros: RosBridgeClient): void {
    const info = this.root.querySelector('#ros-info')!;
    info.className = state.rosConnected ? 'info-box success' : 'info-box';
    info.innerHTML = state.rosConnected
      ? `Подключено: ${ros.state.url}<br/>Joint states: ${ros.state.lastJointUpdate}`
      : 'Не подключено. Запустите: ros2 launch welding_bridge web_bridge.launch.py';
  }
}
