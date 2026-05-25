# Welding Web

Браузерное приложение на **Three.js** для цикла сварочного производства.

## Функции

1. **CAD** — STL, OBJ, GLTF/GLB; STEP через backend API
2. **Швы** — авто-поиск рёбер, ручной выбор, типы швов
3. **Сканирование** — дальний/ближний датчик, ICP (Open3D backend или локально)
4. **Сварка** — управление процессом, прогресс, анимация
5. **ROS / MoveIt** — rosbridge, экспорт траекторий, RViz markers

## Быстрый старт

```bash
cd ros2_ws/src/welding_backend && python run_server.py
cd ros2_ws/src/welding_web && npm install && npm run dev
```

## ROS topics

- `/welding/status_in` — статус сварки
- `/welding/trajectory` — MoveIt plan
- `/welding/markers` — RViz markers
