import { WeldingDemoApp } from './app/WeldingDemoApp';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element not found');
}

new WeldingDemoApp(canvas);
