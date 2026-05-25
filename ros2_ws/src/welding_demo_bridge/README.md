# welding_demo_bridge

ROS2-мост между браузерным демо и роботом.

## Запуск (Linux/WSL с ROS2)

```bash
# Терминал 1: MoveIt demo
ros2 launch welding_robot_moveit_config demo.launch.py

# Терминал 2: rosbridge + weld nodes
ros2 launch welding_demo_bridge web_bridge.launch.py

# Терминал 3: backend API
cd ../welding_demo_backend && python run_server.py

# Терминал 4: web UI
cd ../welding_demo_web && npm run dev
```

## ROS topics

| Topic | Type | Направление |
|-------|------|-------------|
| `/welding_demo/status_in` | std_msgs/String (JSON) | Web → ROS |
| `/welding_demo/status` | std_msgs/String (JSON) | relay |
| `/welding_demo/trajectory` | std_msgs/String (JSON) | Web → RViz markers |
| `/welding_demo/markers` | visualization_msgs/MarkerArray | RViz |
| `/joint_states` | sensor_msgs/JointState | Robot → Web (via rosbridge) |

Web UI подключается к `ws://localhost:9090`.
