from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    port = LaunchConfiguration("port")

    return LaunchDescription([
        DeclareLaunchArgument("port", default_value="9090"),
        Node(
            package="rosbridge_server",
            executable="rosbridge_websocket",
            name="rosbridge_websocket",
            parameters=[{"port": port}],
            output="screen",
        ),
        Node(
            package="welding_bridge",
            executable="weld_status_node",
            output="screen",
        ),
        Node(
            package="welding_bridge",
            executable="trajectory_bridge_node",
            output="screen",
        ),
    ])
