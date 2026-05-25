export type WorkflowStep = 'model' | 'seams' | 'scan' | 'weld' | 'integrate';

export type WeldType =
  | 'fillet'
  | 'butt'
  | 'corner'
  | 'lap'
  | 'plug';

export const WELD_TYPE_LABELS: Record<WeldType, string> = {
  fillet: 'Угловой (Fillet)',
  butt: 'Стыковой (Butt)',
  corner: 'Тавровый (Corner)',
  lap: 'Нахлёст (Lap)',
  plug: 'Точечный (Plug)',
};

export const WELD_TYPE_COLORS: Record<WeldType, number> = {
  fillet: 0x22c55e,
  butt: 0x3b82f6,
  corner: 0xf59e0b,
  lap: 0xa855f7,
  plug: 0xef4444,
};

export interface SeamEdge {
  id: string;
  start: [number, number, number];
  end: [number, number, number];
  midpoint: [number, number, number];
  length: number;
  autoDetected: boolean;
}

export interface WeldSeam extends SeamEdge {
  selected: boolean;
  weldType: WeldType;
  progress: number;
  status: 'pending' | 'active' | 'done';
}

export type SensorMode = 'far' | 'near';

export interface ScanResult {
  points: Float32Array;
  sensor: SensorMode;
  noiseLevel: number;
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
  weldingActive: boolean;
  currentSeamIndex: number;
  backendOnline: boolean;
  rosConnected: boolean;
  useBackendIcp: boolean;
}
