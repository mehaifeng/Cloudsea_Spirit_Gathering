import './fonts.css';
import './styles.css';
import { detectLanguage, setLanguage, tr } from '@cloudsea/i18n';
import { App } from './game/app';

// 界面语言（M4-3）：网址参数 > 本机设置 > 系统语言；测试模式默认中文
{
  const qs = new URLSearchParams(location.search);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('cloudsea.lang');
  } catch {
    /* 没有本地存储也能玩 */
  }
  setLanguage(detectLanguage(qs.get('lang') ?? (qs.get('test') === '1' ? 'zh' : saved), navigator.language));
  document.title = tr('云海拾灵');
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const ui = document.querySelector<HTMLElement>('#ui');
if (!canvas || !ui) throw new Error('missing #scene / #ui');
new App(canvas, ui);
