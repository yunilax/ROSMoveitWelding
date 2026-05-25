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

function sanitizePointCloud(points: number[][]): number[][] {
  return points
    .filter((p) => p.length >= 3)
    .map((p) => [Number(p[0]), Number(p[1]), Number(p[2])])
    .filter((p) => p.every((v) => Number.isFinite(v)));
}

function subsamplePointCloud(points: number[][], maxCount: number): number[][] {
  if (points.length <= maxCount) return points;
  const out: number[][] = [];
  const step = points.length / maxCount;
  for (let i = 0; i < maxCount; i += 1) {
    out.push(points[Math.floor(i * step)]);
  }
  return out;
}

function formatErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (d as { msg?: string }).msg ?? String(d));
    const unique = [...new Set(msgs)];
    return unique.length === 1 ? unique[0] : unique.slice(0, 3).join("; ");
  }
  return fallback;
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
    const res = await fetch(`${this.baseUrl}/convert/step`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(formatErrorDetail(err.detail, 'STEP conversion failed'));
    }
    return res.blob();
  }

  async alignIcp(source: number[][], target: number[][]): Promise<IcpResult> {
    const cleanSource = subsamplePointCloud(sanitizePointCloud(source), 4000);
    const cleanTarget = subsamplePointCloud(sanitizePointCloud(target), 4000);
    if (cleanSource.length < 10 || cleanTarget.length < 10) {
      throw new Error('Недостаточно валидных точек для ICP (нужно >= 10)');
    }
    const res = await fetch(`${this.baseUrl}/align/icp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: cleanSource, target: cleanTarget }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(formatErrorDetail(err.detail, 'ICP alignment failed'));
    }
    return res.json();
  }

  async exportMoveIt(seams: WeldSeam[]): Promise<MoveItPlan> {
    const res = await fetch(`${this.baseUrl}/export/moveit`, {
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
      throw new Error(formatErrorDetail(err.detail, 'MoveIt export failed'));
    }
    return res.json();
  }
}
