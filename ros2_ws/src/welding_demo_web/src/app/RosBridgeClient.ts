import ROSLIB from 'roslib';

export interface RosConnectionState {
  connected: boolean;
  url: string;
  lastJointUpdate: string;
}

export class RosBridgeClient {
  private ros: ROSLIB.Ros | null = null;
  private jointTopic: ROSLIB.Topic | null = null;
  private statusTopic: ROSLIB.Topic | null = null;
  private trajectoryTopic: ROSLIB.Topic | null = null;
  state: RosConnectionState = { connected: false, url: '', lastJointUpdate: '—' };

  onConnectionChange?: (connected: boolean) => void;
  onJointState?: (names: string[], positions: number[]) => void;

  connect(url = 'ws://localhost:9090'): void {
    this.disconnect();
    this.ros = new ROSLIB.Ros({ url });

    this.ros.on('connection', () => {
      this.state.connected = true;
      this.state.url = url;
      this.setupTopics();
      this.onConnectionChange?.(true);
    });

    this.ros.on('error', () => {
      this.state.connected = false;
      this.onConnectionChange?.(false);
    });

    this.ros.on('close', () => {
      this.state.connected = false;
      this.onConnectionChange?.(false);
    });
  }

  disconnect(): void {
    this.jointTopic = null;
    this.statusTopic = null;
    this.trajectoryTopic = null;
    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }
    this.state.connected = false;
    this.onConnectionChange?.(false);
  }

  publishStatus(payload: Record<string, unknown>): void {
    if (!this.statusTopic) return;
    this.statusTopic.publish(new ROSLIB.Message({ data: JSON.stringify(payload) }));
  }

  publishTrajectory(plan: Record<string, unknown>): void {
    if (!this.trajectoryTopic) return;
    this.trajectoryTopic.publish(new ROSLIB.Message({ data: JSON.stringify(plan) }));
  }

  private setupTopics(): void {
    if (!this.ros) return;

    this.jointTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/joint_states',
      messageType: 'sensor_msgs/JointState',
    });
    this.jointTopic.subscribe((msg) => {
      const joint = msg as ROSLIB.Message & { name: string[]; position: number[] };
      this.state.lastJointUpdate = new Date().toLocaleTimeString();
      this.onJointState?.(joint.name, joint.position);
    });

    this.statusTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/welding_demo/status_in',
      messageType: 'std_msgs/String',
    });

    this.trajectoryTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/welding_demo/trajectory',
      messageType: 'std_msgs/String',
    });
  }
}
