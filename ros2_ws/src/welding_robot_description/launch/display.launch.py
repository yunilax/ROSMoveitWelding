from launch import LaunchDescription
from launch.substitutions import Command, FindExecutable, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    pkg = FindPackageShare("welding_robot_description")
    urdf_path = PathJoinSubstitution([pkg, "urdf", "welding_robot.urdf.xacro"])
    robot_description = Command([FindExecutable(name="xacro"), " ", urdf_path])

    return LaunchDescription(
        [
            Node(
                package="robot_state_publisher",
                executable="robot_state_publisher",
                parameters=[{"robot_description": robot_description}],
            ),
            Node(
                package="joint_state_publisher_gui",
                executable="joint_state_publisher_gui",
            ),
            Node(
                package="rviz2",
                executable="rviz2",
                arguments=[
                    "-d",
                    PathJoinSubstitution([pkg, "rviz", "welding_robot.rviz"]),
                ],
            ),
        ]
    )
