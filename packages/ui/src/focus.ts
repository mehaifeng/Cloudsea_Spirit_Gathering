/**
 * 焦点导航（D15）：所有菜单都用“焦点 + 方向”模型，键盘方向键 / 手柄十字键在可聚焦元素间移动，
 * 确认键点击，返回键关闭。鼠标仍然可以直接点。
 */
export type NavKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

export function keyToNav(e: KeyboardEvent): NavKey | null {
  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case ' ':
      return 'confirm';
    case 'Escape':
    case 'Backspace':
      return 'back';
    default:
      return null;
  }
}

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-focus]')].filter((el) => el.offsetParent !== null && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[hidden]'));
}

/** 在 root 里按方向移动焦点：选方向上最近的元素（主轴距离 + 2 倍侧向距离）。 */
export function moveFocus(root: Element, dir: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
  const items = focusables(root);
  if (items.length === 0) return null;
  const cur = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    items[0]!.focus();
    return items[0]!;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (main <= 1) continue;
    const score = main + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  best?.focus();
  return best;
}

/** 聚焦第一个可操作的元素；“关闭”按钮（.close-x）排在最后，免得手柄一打开菜单就停在右上角（M4-2）。 */
export function focusFirst(root: Element): void {
  const items = focusables(root);
  (items.find((el) => !el.classList.contains('close-x')) ?? items[0])?.focus();
}
