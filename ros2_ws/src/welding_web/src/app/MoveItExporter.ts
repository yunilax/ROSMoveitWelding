import type { MoveItPlan } from './BackendClient';
import type { WeldSeam } from '../types';

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildLocalMoveItPlan(seams: WeldSeam[]): MoveItPlan {
  return {
    version: 1,
    frame_id: 'base_link',
    planning_group: 'welding_arm',
    planner: 'ompl',
    pipeline: 'move_group',
    seams: seams.map((seam) => ({
      id: seam.id,
      weld_type: seam.weldType,
      length_m: seam.length,
      waypoints: buildWaypoints(seam),
    })),
  };
}

function buildWaypoints(seam: WeldSeam) {
  const mid: [number, number, number] = [
    (seam.start[0] + seam.end[0]) / 2,
    (seam.start[1] + seam.end[1]) / 2,
    (seam.start[2] + seam.end[2]) / 2,
  ];
  const orient = seamOrientation(seam.start, seam.end);
  return [
    { position: [...seam.start], orientation: orient, type: 'approach' },
    { position: [...seam.start], orientation: orient, type: 'weld_start' },
    { position: mid, orientation: orient, type: 'weld_mid' },
    { position: [...seam.end], orientation: orient, type: 'weld_end' },
    { position: [...seam.end], orientation: orient, type: 'retract' },
  ];
}

function seamOrientation(start: [number, number, number], end: [number, number, number]): number[] {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const yaw = Math.atan2(dy, dx);
  return [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
}
