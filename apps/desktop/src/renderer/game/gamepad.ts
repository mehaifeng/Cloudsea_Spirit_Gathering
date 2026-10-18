/**
 * 手柄（M4-2）：每帧读一次 Gamepad API。
 * - 摇杆直接写进 Input 的模拟量（左摇杆移动、右摇杆转镜头、扳机缩放）；
 * - 按键换成对应的键盘按键事件派发出去，菜单焦点导航、对话、交互都走和键盘同一条路。
 * 按键布局（标准手柄）：A 交互 / 确认，B 返回，X 跳跃，Y 菜单，Select 星图，Start 设置，十字键选择菜单项。
 */
import type { Input } from './input';

export type PadContext = 'explore' | 'ui' | 'voyage' | 'build' | 'none';

interface KeyDef {
  readonly key: string;
  readonly code: string;
}

const K = {
  enter: { key: 'Enter', code: 'Enter' },
  escape: { key: 'Escape', code: 'Escape' },
  e: { key: 'e', code: 'KeyE' },
  space: { key: ' ', code: 'Space' },
  tab: { key: 'Tab', code: 'Tab' },
  m: { key: 'm', code: 'KeyM' },
  r: { key: 'r', code: 'KeyR' },
  up: { key: 'ArrowUp', code: 'ArrowUp' },
  down: { key: 'ArrowDown', code: 'ArrowDown' },
  left: { key: 'ArrowLeft', code: 'ArrowLeft' },
  right: { key: 'ArrowRight', code: 'ArrowRight' },
} as const satisfies Record<string, KeyDef>;

/** 标准映射的按键序号。 */
const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

const DEAD = 0.18;
const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.12;

export class GamepadInput {
  private prev: boolean[] = [];
  private held = new Map<number, number>();
  /** 最近一次操作来自手柄（提示里显示手柄按键）。 */
  active = false;
  connected = false;

  constructor(
    private readonly input: Input,
    private readonly context: () => PadContext,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.isTrusted) this.active = false;
    });
    window.addEventListener('pointerdown', () => (this.active = false));
  }

  update(dt: number): void {
    const pads = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].filter((p): p is Gamepad => !!p) : [];
    const pad = pads[0];
    this.connected = !!pad;
    if (!pad) {
      this.input.setPad(null);
      return;
    }
    const axis = (i: number) => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);
    };
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const ctx = this.context();
    const move = { x: axis(0), y: -axis(1) };
    const look = { x: axis(2), y: axis(3) };
    const zoom = (pad.buttons[B.rt]?.value ?? 0) - (pad.buttons[B.lt]?.value ?? 0);
    if (Math.hypot(move.x, move.y) > 0 || Math.hypot(look.x, look.y) > 0 || pressed.some(Boolean)) this.active = true;
    this.input.setPad({ move, look, zoom, run: Math.hypot(move.x, move.y) > 0.9 });

    const edge = (i: number) => !!pressed[i] && !this.prev[i];
    const repeat = (i: number) => {
      if (!pressed[i]) {
        this.held.delete(i);
        return false;
      }
      const t = (this.held.get(i) ?? -REPEAT_DELAY) + dt;
      if (!this.prev[i]) {
        this.held.set(i, -REPEAT_DELAY);
        return true;
      }
      if (t >= REPEAT_RATE) {
        this.held.set(i, 0);
        return true;
      }
      this.held.set(i, t);
      return false;
    };

    if (edge(B.a)) this.tap(ctx === 'explore' ? K.e : K.enter);
    if (edge(B.b) && ctx !== 'explore' && ctx !== 'voyage') this.tap(K.escape);
    if (edge(B.x) && ctx === 'explore') this.tap(K.space);
    if (edge(B.y) && (ctx === 'explore' || ctx === 'ui')) this.tap(K.tab);
    if (edge(B.select) && ctx === 'explore') this.tap(K.m);
    if (edge(B.start) && ctx === 'explore') this.tap(K.escape);
    if (edge(B.rb) && ctx === 'build') this.tap(K.r);
    // 十字键：菜单 / 战斗里移动焦点（探索时左摇杆管移动，十字键不重复派发）
    if (ctx === 'ui') {
      if (repeat(B.up)) this.tap(K.up);
      if (repeat(B.down)) this.tap(K.down);
      if (repeat(B.left)) this.tap(K.left);
      if (repeat(B.right)) this.tap(K.right);
    }
    this.prev = pressed;
  }

  /** 像真键盘一样从当前焦点元素派发（经过 window 的捕获阶段，菜单拦下的键不会再传给游戏）。 */
  private tap(k: KeyDef): void {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, code: k.code, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: k.key, code: k.code, bubbles: true }));
  }
}
