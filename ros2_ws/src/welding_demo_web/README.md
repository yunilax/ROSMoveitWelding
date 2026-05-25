# Welding Demo Web

Браузерное демо-приложение на **Three.js** для цикла сварочного производства.

## Функции

1. **CAD** — STL, OBJ, GLTF/GLB; STEP через backend API
2. **Швы** — авто-поиск рёбер, ручной выбор, типы швов
3. **Сканирование** — дальний/ближний датчик, ICP (Open3D backend или локально)
4. **Сварка** — управление процессом, прогресс, анимация
5. **ROS / MoveIt** — rosbridge, экспорт траекторий, RViz markers

## Быстрый старт

```bash
# Backend (терминал 1)
cd ros2_ws/src/welding_demo_backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python run_server.py

# Web UI (терминал 2)
cd ros2_ws/src/welding_demo_web
npm install
npm run dev
```

## Полный стек (Linux/WSL + ROS2)

```bash
ros2 launch welding_robot_moveit_config demo.launch.py
ros2 launch welding_demo_bridge web_bridge.launch.py
python ros2_ws/src/welding_demo_backend/run_server.py
cd ros2_ws/src/welding_demo_web && npm run dev
```

## Связанные пакеты

| Пакет | Назначение |
|-------|------------|
| `welding_demo_web` | Браузерный UI (Three.js) |
| `welding_demo_backend` | FastAPI: STEP, ICP, MoveIt JSON |
| `welding_demo_bridge` | rosbridge + weld status + RViz markers |
| `welding_robot_*` | URDF, MoveIt, Gazebo |

## ROS topics

- `/welding_demo/status_in` — статус сварки (JSON из web)
- `/welding_demo/trajectory` — MoveIt plan (JSON)
- `/welding_demo/markers` — MarkerArray для RViz
