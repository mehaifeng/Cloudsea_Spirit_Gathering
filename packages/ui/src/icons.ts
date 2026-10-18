import { tr } from '@cloudsea/i18n';
import { ELEMENT_INFO, type Element } from '@cloudsea/content';
import { svg } from './dom';

/**
 * 属性图标（DESIGN 4.1）：太阳 / 雨滴 / 风纹 / 闪电 / 雾团。
 * 显示属性的地方图标与颜色同时出现，照顾色弱玩家。
 */
const ELEMENT_PATHS: Record<Element, string> = {
  sun: '<circle cx="12" cy="12" r="5"/><g stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor"/></g>',
  rain: '<path d="M12 2.5C9 7 6 10.5 6 14a6 6 0 0 0 12 0c0-3.5-3-7-6-11.5z"/>',
  wind: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 18h7"/></g>',
  thunder: '<path d="M13 2L4 14h6l-2 8 10-13h-6l1-7z"/>',
  mist: '<g><ellipse cx="9" cy="11" rx="6" ry="4"/><ellipse cx="15" cy="10" rx="5" ry="4"/><rect x="4" y="16" width="16" height="2" rx="1"/><rect x="6" y="20" width="12" height="2" rx="1"/></g>',
};

export function elementIcon(el: Element, size = 18): HTMLSpanElement {
  const s = svg(
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ELEMENT_PATHS[el]}</svg>`,
    'icon element-icon',
  );
  s.style.color = ELEMENT_INFO[el].color;
  return s;
}

/** 属性徽章：图标 + 名字 + 颜色。 */
export function elementBadge(el: Element): HTMLSpanElement {
  const b = elementIcon(el, 14);
  b.className = 'badge element';
  b.style.setProperty('--c', ELEMENT_INFO[el].color);
  b.append(tr(ELEMENT_INFO[el].name));
  return b;
}

const UI_PATHS = {
  shell: '<path d="M12 3c-5 0-9 4-9 9 0 1 .3 2 1 3l8 6 8-6c.7-1 1-2 1-3 0-5-4-9-9-9zm0 3v12M7 8l5 10M17 8l-5 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  heart: '<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z"/>',
  qi: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a4 4 0 0 1 0 8 4 4 0 0 0 0 8" fill="none" stroke="currentColor" stroke-width="2"/>',
  lantern: '<path d="M9 3h6v2H9zM7 6h10l-1 12H8zM10 19h4v2h-4z"/>',
  sail: '<path d="M11 2v18H4zM13 6l7 14h-7zM3 21h18v1H3z"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  weary: '<path d="M4 15c3-4 13-4 16 0M7 10h3M14 10h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  male: '<circle cx="10" cy="14" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 10l6-6M15 4h5v5" fill="none" stroke="currentColor" stroke-width="2"/>',
  female: '<circle cx="12" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 14v8M9 19h6" fill="none" stroke="currentColor" stroke-width="2"/>',
  star: '<path d="M12 2l3 7 7 .6-5.3 4.6 1.7 7.3L12 17.8 5.6 21.5l1.7-7.3L2 9.6 9 9z"/>',
} as const;

export type UiIcon = keyof typeof UI_PATHS;

export function icon(name: UiIcon, size = 16): HTMLSpanElement {
  return svg(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${UI_PATHS[name]}</svg>`);
}
