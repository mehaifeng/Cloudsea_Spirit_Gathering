type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  onclick?: (e: MouseEvent) => void;
  focus?: boolean;
};

/** 极简的 DOM 构造：h('div', { class: 'x' }, '文字', h('span', {}, ...))。 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k === 'focus') {
      if (v) el.dataset['focus'] = '';
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

/** 可聚焦的按钮（焦点导航用 data-focus 标记）。 */
export function button(label: Child | Child[], onclick: () => void, opts: { class?: string; disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  const b = h('button', { class: `btn ${opts.class ?? ''}`, focus: true, onclick: () => !opts.disabled && onclick(), title: opts.title }, ...(Array.isArray(label) ? label : [label]));
  if (opts.disabled) b.setAttribute('aria-disabled', 'true');
  return b;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function svg(markup: string, cls = 'icon'): HTMLSpanElement {
  const s = h('span', { class: cls });
  s.innerHTML = markup;
  return s;
}
