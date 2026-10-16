import './styles.css';
import { App } from './game/app';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('missing #scene / #ui');
new App(canvas, ui);
