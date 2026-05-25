from __future__ import annotations

import json

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from welding_backend.icp import run_icp
from welding_backend.moveit_export import build_moveit_plan
from welding_backend.step_convert import convert_step_to_stl_bytes, sample_mesh_points

app = FastAPI(title="Welding Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IcpRequest(BaseModel):
    source: list[list[float]] = Field(..., description="Scan point cloud Nx3")
    target: list[list[float]] = Field(..., description="CAD sample cloud Nx3")
    max_correspondence_distance: float = 0.05
    max_iterations: int = 50


class MoveItExportRequest(BaseModel):
    frame_id: str = "base_link"
    group: str = "welding_arm"
    seams: list[dict]


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "welding_backend"}


@app.post("/api/convert/step")
async def convert_step(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in {"step", "stp"}:
        raise HTTPException(status_code=400, detail="Expected .step or .stp file")

    raw = await file.read()
    try:
        stl_bytes, meta = convert_step_to_stl_bytes(raw, file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    from fastapi.responses import Response

    headers = {"X-Mesh-Meta": json.dumps(meta)}
    return Response(content=stl_bytes, media_type="model/stl", headers=headers)


@app.post("/api/align/icp")
def align_icp(body: IcpRequest):
    source = np.asarray(body.source, dtype=np.float64)
    target = np.asarray(body.target, dtype=np.float64)
    try:
        result = run_icp(
            source,
            target,
            max_correspondence_distance=body.max_correspondence_distance,
            max_iterations=body.max_iterations,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@app.post("/api/sample/mesh")
async def sample_mesh(file: UploadFile = File(...), count: int = 8000):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")
    raw = await file.read()
    try:
        points = sample_mesh_points(raw, file.filename, count=min(count, 20000))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"count": int(points.shape[0]), "points": points.tolist()}


@app.post("/api/export/moveit")
def export_moveit(body: MoveItExportRequest):
    plan = build_moveit_plan(body.model_dump())
    return plan
