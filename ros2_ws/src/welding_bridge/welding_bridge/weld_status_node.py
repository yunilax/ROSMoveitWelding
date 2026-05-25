#!/usr/bin/env python3
"""Relay weld status JSON from web UI via rosbridge."""

import json

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class WeldStatusNode(Node):
    def __init__(self):
        super().__init__("weld_status_node")
        self._pub = self.create_publisher(String, "/welding/status", 10)
        self.create_subscription(String, "/welding/status_in", self._on_status, 10)
        self.get_logger().info("Listening on /welding/status_in, publishing /welding/status")

    def _on_status(self, msg: String):
        try:
            payload = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warn("Invalid JSON on /welding/status_in")
            return
        self.get_logger().info(
            f"Weld status: active={payload.get('active')} "
            f"seam={payload.get('current_seam')} "
            f"progress={payload.get('overall_progress')}%"
        )
        self._pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = WeldStatusNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
