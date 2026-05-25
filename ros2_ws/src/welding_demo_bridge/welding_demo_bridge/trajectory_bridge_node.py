#!/usr/bin/env python3
"""Receive MoveIt weld plan JSON and publish RViz markers."""

import json

import rclpy
from geometry_msgs.msg import Point
from rclpy.node import Node
from std_msgs.msg import String
from visualization_msgs.msg import Marker, MarkerArray


class TrajectoryBridgeNode(Node):
    def __init__(self):
        super().__init__("trajectory_bridge_node")
        self._marker_pub = self.create_publisher(MarkerArray, "/welding_demo/markers", 10)
        self.create_subscription(String, "/welding_demo/trajectory", self._on_trajectory, 10)
        self.get_logger().info("Ready on /welding_demo/trajectory")

    def _on_trajectory(self, msg: String):
        try:
            plan = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warn("Invalid trajectory JSON")
            return

        markers = MarkerArray()
        marker_id = 0
        for seam in plan.get("seams", []):
            waypoints = seam.get("waypoints", [])
            if len(waypoints) < 2:
                continue
            marker = Marker()
            marker.header.frame_id = plan.get("frame_id", "base_link")
            marker.header.stamp = self.get_clock().now().to_msg()
            marker.ns = "weld_seams"
            marker.id = marker_id
            marker.type = Marker.LINE_STRIP
            marker.action = Marker.ADD
            marker.scale.x = 0.008
            marker.color.r = 1.0
            marker.color.g = 0.6
            marker.color.b = 0.0
            marker.color.a = 1.0
            for wp in waypoints:
                p = wp.get("position", [0, 0, 0])
                pt = Point()
                pt.x = float(p[0])
                pt.y = float(p[1])
                pt.z = float(p[2])
                marker.points.append(pt)
            markers.markers.append(marker)
            marker_id += 1

        self._marker_pub.publish(markers)
        self.get_logger().info(f"Published {len(markers.markers)} weld seam markers")


def main(args=None):
    rclpy.init(args=args)
    node = TrajectoryBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
