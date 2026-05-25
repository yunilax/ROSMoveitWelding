from __future__ import annotations

import numpy as np

try:
    import open3d as o3d

    HAS_OPEN3D = True
except ImportError:
    HAS_OPEN3D = False


def _as_point_cloud(points: np.ndarray) -> "o3d.geometry.PointCloud":
    cloud = o3d.geometry.PointCloud()
    cloud.points = o3d.utility.Vector3dVector(points)
    return cloud


def run_icp(
    source: np.ndarray,
    target: np.ndarray,
    max_correspondence_distance: float = 0.05,
    max_iterations: int = 50,
) -> dict:
    """Align source scan to target CAD samples. Returns 4x4 transform and fitness."""
    source = np.asarray(source, dtype=np.float64).reshape(-1, 3)
    target = np.asarray(target, dtype=np.float64).reshape(-1, 3)

    if source.shape[0] < 10 or target.shape[0] < 10:
        raise ValueError("Нужно минимум 10 точек в каждом облаке")

    if HAS_OPEN3D:
        src = _as_point_cloud(source)
        tgt = _as_point_cloud(target)
        src.estimate_normals()
        tgt.estimate_normals()
        init = np.eye(4)
        result = o3d.pipelines.registration.registration_icp(
            src,
            tgt,
            max_correspondence_distance,
            init,
            o3d.pipelines.registration.TransformationEstimationPointToPoint(),
            o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=max_iterations),
        )
        transform = np.asarray(result.transformation)
        fitness = float(result.fitness)
        rmse = float(result.inlier_rmse)
    else:
        transform, fitness, rmse = _numpy_icp(source, target, max_iterations)

    rotation = transform[:3, :3]
    translation = transform[:3, 3]
    return {
        "matrix": transform.tolist(),
        "translation": translation.tolist(),
        "fitness": fitness,
        "rmse": rmse,
    }


def _numpy_icp(source: np.ndarray, target: np.ndarray, iterations: int) -> tuple[np.ndarray, float, float]:
    """Lightweight fallback ICP without Open3D."""
    transform = np.eye(4)
    src = source.copy()

    for _ in range(iterations):
        diff = src[:, None, :] - target[None, :, :]
        dist = np.linalg.norm(diff, axis=2)
        nearest = np.argmin(dist, axis=1)
        matched = target[nearest]

        src_centroid = src.mean(axis=0)
        tgt_centroid = matched.mean(axis=0)
        src_centered = src - src_centroid
        tgt_centered = matched - tgt_centroid
        h = src_centered.T @ tgt_centered
        u, _, vt = np.linalg.svd(h)
        r = vt.T @ u.T
        if np.linalg.det(r) < 0:
            vt[-1, :] *= -1
            r = vt.T @ u.T
        t = tgt_centroid - r @ src_centroid
        step = np.eye(4)
        step[:3, :3] = r
        step[:3, 3] = t
        transform = step @ transform
        src = (r @ src.T).T + t

    diff = src[:, None, :] - target[None, :, :]
    dist = np.linalg.norm(diff, axis=2)
    min_dist = dist.min(axis=1)
    inliers = min_dist < 0.05
    fitness = float(inliers.mean())
    rmse = float(np.sqrt((min_dist[inliers] ** 2).mean())) if inliers.any() else 999.0
    return transform, fitness, rmse
