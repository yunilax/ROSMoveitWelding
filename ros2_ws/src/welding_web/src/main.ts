import { WeldingApp } from './app/WeldingApp';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas element not found');
}

new WeldingApp(canvas);
