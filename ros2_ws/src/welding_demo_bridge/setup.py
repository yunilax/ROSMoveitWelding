from setuptools import find_packages, setup

package_name = "welding_demo_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/launch", ["launch/web_bridge.launch.py"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="yunilax",
    maintainer_email="yunilax@gmail.com",
    description="ROS2 bridge for welding demo web",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "weld_status_node = welding_demo_bridge.weld_status_node:main",
            "trajectory_bridge_node = welding_demo_bridge.trajectory_bridge_node:main",
        ],
    },
)
