import { mountPlaceholderScene } from '@cloudsea/render';

interface CloudseaBridge {
  platform: string;
  versions: { electron: string; chrome: string };
}

declare global {
  interface Window {
    cloudsea?: CloudseaBridge;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('missing #scene canvas');
mountPlaceholderScene(canvas);

const info = document.querySelector('#build-info');
if (info && window.cloudsea) {
  info.textContent = `脚手架 · M1 · Electron ${window.cloudsea.versions.electron}`;
}
document.body.dataset['ready'] = 'true';
