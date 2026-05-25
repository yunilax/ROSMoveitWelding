from __future__ import annotations

import math
from typing import Any


def _seam_orientation(start: list[float], end: list[float]) -> list[float]:
    dx, dy, dz = (end[i] - start[i] for i in range(3))
    length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    # Tool Z aligned with seam tangent; simple fixed orientation for demo
    yaw = math.atan2(dy, dx)
    qw = math.cos(yaw / 2)
    qz = math.sin(yaw / 2)
    return [0.0, 0.0, qz, qw]


def build_moveit_plan(payload: dict[str, Any]) -> dict[str, Any]:
    """Build MoveIt-compatible weld plan JSON from web payload."""
    frame_id = payload.get("frame_id", "base_link")
    group = payload.get("group", "welding_arm")
    seams_in = payload.get("seams", [])

    seams_out = []
    for seam in seams_in:
        start = seam["start"]
        end = seam["end"]
        mid = [(start[i] + end[i]) / 2 for i in range(3)]
        orientation = _seam_orientation(start, end)
        waypoints = [
            {
                "position": start,
                "orientation": orientation,
                "type": "approach",
            },
            {
                "position": start,
                "orientation": orientation,
                "type": "weld_start",
            },
            {
                "position": mid,
                "orientation": orientation,
                "type": "weld_mid",
            },
            {
                "position": end,
                "orientation": orientation,
                "type": "weld_end",
            },
            {
                "position": end,
                "orientation": orientation,
                "type": "retract",
            },
        ]
        seams_out.append(
            {
                "id": seam["id"],
                "weld_type": seam.get("weld_type", "fillet"),
                "length_m": seam.get("length", 0.0),
                "waypoints": waypoints,
            }
        )

    return {
        "version": 1,
        "frame_id": frame_id,
        "planning_group": group,
        "planner": "ompl",
        "pipeline": "move_group",
        "seams": seams_out,
    }
