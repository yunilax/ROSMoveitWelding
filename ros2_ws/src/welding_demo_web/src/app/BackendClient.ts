import type { WeldSeam } from '../types';

const DEFAULT_BASE = '/api';

export interface BackendHealth {
  status: string;
  service: string;
}

export interface IcpResult {
  matrix: number[][];
  translation: number[];
  fitness: number;
  rmse: number;
}

export interface MoveItPlan {
  version: number;
  frame_id: string;
  planning_group: string;
  planner: string;
  pipeline: string;
  seams: Array<{
    id: string;
    weld_type: string;
    length_m: number;
    waypoints: Array<{
      position: number[];
      orientation: number[];
      type: string;
    }>;
  }>;
}

export class BackendClient {
  constructor(private baseUrl = DEFAULT_BASE) {}

  async health(): Promise<BackendHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async convertStep(file: File): Promise<Blob> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${this.baseUrl}/api/convert/step`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? 'STEP conversion failed');
    }
    return res.blob();
  }

  async alignIcp(source: number[][], target: number[][]): Promise<IcpResult> {
    const res = await fetch(`${this.baseUrl}/api/align/icp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? 'ICP alignment failed');
    }
    return res.json();
  }

  async exportMoveIt(seams: WeldSeam[]): Promise<MoveItPlan> {
    const res = await fetch(`${this.baseUrl}/api/export/moveit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frame_id: 'base_link',
        group: 'welding_arm',
        seams: seams.map((s) => ({
          id: s.id,
          weld_type: s.weldType,
          start: s.start,
          end: s.end,
          length: s.length,
        })),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? 'MoveIt export failed');
    }
    return res.json();
  }
}
