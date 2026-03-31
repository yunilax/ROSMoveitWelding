import os
import sys

from moveit_configs_utils.launches import generate_static_virtual_joint_tfs_launch


sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from moveit_config_data import build_moveit_config


def generate_launch_description():
    return generate_static_virtual_joint_tfs_launch(build_moveit_config())
