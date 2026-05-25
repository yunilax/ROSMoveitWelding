from __future__ import annotations

import io
from typing import Any

import numpy as np
import trimesh


def convert_step_to_stl_bytes(step_bytes: bytes, filename: str) -> tuple[bytes, dict[str, Any]]:
    """Convert STEP bytes to STL using trimesh (requires cascadio for STEP)."""
    try:
        mesh = trimesh.load(
            io.BytesIO(step_bytes),
            file_type="step",
            file_name=filename,
        )
    except Exception as exc:
        raise ValueError(
            "Не удалось прочитать STEP. Установите cascadio: pip install cascadio"
        ) from exc

    if isinstance(mesh, trimesh.Scene):
        mesh = mesh.dump(concatenate=True)

    if not isinstance(mesh, trimesh.Trimesh) or mesh.vertices.shape[0] == 0:
        raise ValueError("STEP не содержит triangulated geometry")

    stl_buffer = io.BytesIO()
    mesh.export(stl_buffer, file_type="stl")
    meta = {
        "vertices": int(mesh.vertices.shape[0]),
        "faces": int(mesh.faces.shape[0]),
        "bounds": mesh.bounds.tolist(),
    }
    return stl_buffer.getvalue(), meta


def sample_mesh_points(step_or_stl_bytes: bytes, filename: str, count: int = 8000) -> np.ndarray:
    """Sample surface points from mesh for ICP target cloud."""
    ext = filename.rsplit(".", 1)[-1].lower()
    file_type = "step" if ext in {"step", "stp"} else "stl"
    mesh = trimesh.load(io.BytesIO(step_or_stl_bytes), file_type=file_type, file_name=filename)
    if isinstance(mesh, trimesh.Scene):
        mesh = mesh.dump(concatenate=True)
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError("Не удалось получить mesh для семплирования")
    points, _ = trimesh.sample.sample_surface(mesh, count)
    return np.asarray(points, dtype=np.float64)
