export type WorkflowStep = 'model' | 'scan' | 'seams' | 'weld' | 'integrate';

export type WeldType =
  | 'fillet'
  | 'butt'
  | 'corner'
  | 'lap'
  | 'plug';

export const WELD_TYPE_LABELS: Record<WeldType, string> = {
  fillet: 'Угловой (fillet)',
  butt: 'Стыковой',
  corner: 'Угловой стык',
  lap: 'Нахлёст',
  plug: 'Точечный',
};

export const WELD_TYPE_COLORS: Record<WeldType, number> = {
  fillet: 0x22ff88,
  butt: 0x38bdf8,
  corner: 0xffb020,
  lap: 0xc084fc,
  plug: 0xff4466,
};

export type SeamSortMode = 'length-desc' | 'length-asc' | 'id';

/** Источник кандидата на шов */
export type SeamSource = 'contact' | 'concave' | 'sharp' | 'manual';

export const SEAM_SOURCE_LABELS: Record<SeamSource, string> = {
  contact: 'Контакт деталей',
  concave: 'T / внутр. ребро',
  sharp: 'Острые рёбра',
  manual: 'Ручной',
};

export interface SeamProcessParams {
  legSizeMm: number;
  workAngleDeg: number;
  travelAngleDeg: number;
  weldSpeedMmS: number;
  approachMm: number;
  retractMm: number;
  reversed: boolean;
  wpsName: string;
}

export const DEFAULT_SEAM_PARAMS: SeamProcessParams = {
  legSizeMm: 6,
  workAngleDeg: 45,
  travelAngleDeg: 10,
  weldSpeedMmS: 8,
  approachMm: 20,
  retractMm: 15,
  reversed: false,
  wpsName: 'Default-1G',
};

export interface SeamDetectionSettings {
  minLength: number;
  maxAngleDeg: number;
  maxSeamCount: number;
  tubeRadius: number;
  showUnselected: boolean;
  sortMode: SeamSortMode;
  lengthFilterMin: number;
  lengthFilterMax: number;
  contactTolerance: number;
  /** Мин. угол между гранями для T/fillet (°) */
  tJointMinDeg: number;
  /** Макс. угол между гранями для T/fillet (°) */
  tJointMaxDeg: number;
}

export const DEFAULT_SEAM_SETTINGS: SeamDetectionSettings = {
  minLength: 0.04,
  maxAngleDeg: 35,
  maxSeamCount: 150,
  tubeRadius: 1,
  showUnselected: true,
  sortMode: 'length-desc',
  lengthFilterMin: 0,
  lengthFilterMax: 99,
  contactTolerance: 0.004,
  tJointMinDeg: 55,
  tJointMaxDeg: 130,
};

export interface SeamEdge {
  id: string;
  points: [number, number, number][];
  start: [number, number, number];
  end: [number, number, number];
  midpoint: [number, number, number];
  length: number;
  autoDetected: boolean;
  source: SeamSource;
  normal?: [number, number, number];
  dihedralDeg?: number;
}

export interface WeldSeam extends SeamEdge {
  selected: boolean;
  weldType: WeldType;
  progress: number;
  status: 'pending' | 'active' | 'done';
  params: SeamProcessParams;
}

export type ScanPassCount = 2 | 3;

export type SensorMode = 'far' | 'near';

export interface MisalignmentPreview {
  offsetMm: number;
  offsetMmXYZ: [number, number, number];
  rotationDeg: number;
  rotationDegXYZ: [number, number, number];
  cadCenter: [number, number, number];
  scanCenter: [number, number, number];
}

export interface AlignmentPose {
  translation: [number, number, number];
  rotationEulerDeg: [number, number, number];
  cadCenterBefore?: [number, number, number];
  scanCenterBefore?: [number, number, number];
  rmse: number;
  fitness: number;
  source: 'backend' | 'local';
}

export interface ScanResult {
  points: Float32Array;
  passIndex: number;
  passCount: ScanPassCount;
  viewDirection: [number, number, number];
  noiseLevel: number;
  cadToScanMatrix: number[];
  appliedTransform: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  alignmentError: number;
  matchedSeams: string[];
}

export interface AppState {
  step: WorkflowStep;
  modelLoaded: boolean;
  modelName: string;
  seams: WeldSeam[];
  scanResults: ScanResult[];
  alignmentDone: boolean;
  alignmentPose: AlignmentPose | null;
  misalignment: MisalignmentPreview | null;
  weldingActive: boolean;
  currentSeamIndex: number;
  backendOnline: boolean;
  rosConnected: boolean;
  useBackendIcp: boolean;
  seamSettings: SeamDetectionSettings;
  focusedSeamId: string | null;
  manualSeamPickActive: boolean;
}
