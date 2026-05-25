# welding_bridge

ROS2-РјРѕСЃС‚ РјРµР¶РґСѓ Р±СЂР°СѓР·РµСЂРЅС‹Рј РїСЂРёР»РѕР¶РµРЅРёРµРј Рё СЂРѕР±РѕС‚РѕРј.

## Р—Р°РїСѓСЃРє (Linux/WSL СЃ ROS2)

```bash
# РўРµСЂРјРёРЅР°Р» 1: MoveIt demo
ros2 launch welding_robot_moveit_config demo.launch.py

# РўРµСЂРјРёРЅР°Р» 2: rosbridge + weld nodes
ros2 launch welding_bridge web_bridge.launch.py

# РўРµСЂРјРёРЅР°Р» 3: backend API
cd ../welding_backend && python run_server.py

# РўРµСЂРјРёРЅР°Р» 4: web UI
cd ../welding_web && npm run dev
```

## ROS topics

| Topic | Type | РќР°РїСЂР°РІР»РµРЅРёРµ |
|-------|------|-------------|
| `/welding/status_in` | std_msgs/String (JSON) | Web в†’ ROS |
| `/welding/status` | std_msgs/String (JSON) | relay |
| `/welding/trajectory` | std_msgs/String (JSON) | Web в†’ RViz markers |
| `/welding/markers` | visualization_msgs/MarkerArray | RViz |
| `/joint_states` | sensor_msgs/JointState | Robot в†’ Web (via rosbridge) |

Web UI РїРѕРґРєР»СЋС‡Р°РµС‚СЃСЏ Рє `ws://localhost:9090`.

