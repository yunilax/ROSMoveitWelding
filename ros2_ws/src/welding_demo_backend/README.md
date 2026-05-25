# Welding Demo Backend

FastAPI-сервис для расширения браузерного демо:

- **STEP → STL** — конвертация CAD (`POST /api/convert/step`)
- **ICP** — сопоставление облака точек с CAD (`POST /api/align/icp`)
- **MoveIt export** — JSON-план траекторий швов (`POST /api/export/moveit`)

## Установка

```bash
cd ros2_ws/src/welding_demo_backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
pip install cascadio     # для STEP
```

## Запуск

```bash
python run_server.py
```

API: http://localhost:8000  
Health: http://localhost:8000/health

## Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/health` | Проверка сервиса |
| POST | `/api/convert/step` | STEP/STP → STL binary |
| POST | `/api/align/icp` | ICP alignment (Open3D) |
| POST | `/api/export/moveit` | MoveIt weld plan JSON |

Web UI проксирует запросы через Vite (`/api` → `:8000`).
