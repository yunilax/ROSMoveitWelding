from moveit_configs_utils import MoveItConfigsBuilder


def build_moveit_config():
    return (
        MoveItConfigsBuilder("welding_robot", package_name="welding_robot_moveit_config")
        .robot_description(file_path="config/welding_robot.urdf.xacro")
        .robot_description_semantic(file_path="config/welding_robot.srdf")
        .robot_description_kinematics(file_path="config/kinematics.yaml")
        .planning_pipelines(
            pipelines=["ompl"],
            default_planning_pipeline="ompl",
        )
        .trajectory_execution(file_path="config/moveit_controllers.yaml")
        .joint_limits(file_path="config/joint_limits.yaml")
        .to_moveit_configs()
    )
