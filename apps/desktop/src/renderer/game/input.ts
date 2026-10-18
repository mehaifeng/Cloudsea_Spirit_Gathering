/** 键盘与鼠标状态（游戏操作用；菜单的焦点导航在 UiRoot 里处理）。 */
export class Input {
  readonly keys = new Set<string>();
  /** 按下过、还没被处理的键（一次性动作：E、Tab、B……）；同一帧按两次会排两次。 */
  private pressed: string[] = [];
  dragDX = 0;
  dragDY = 0;
  wheel = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  mouseX = 0;
  mouseY = 0;
  clicked = false;
  rightClicked = false;
  private downAt = { x: 0, y: 0, t: 0 };

  /** 手柄的模拟量（M4-2）：每帧由 GamepadInput 写入。 */
  private pad: { move: { x: number; y: number }; look: { x: number; y: number }; zoom: number; run: boolean } | null = null;

  /** dt：这一帧的秒数。镜头转速按时间算（原来按帧算，掉帧时转得慢）。 */
  setPad(pad: Input['pad'], dt = 1 / 60): void {
    this.pad = pad;
    if (pad) {
      const f = dt * 60;
      this.dragDX += pad.look.x * 9 * f;
      this.dragDY += pad.look.y * 6 * f;
      this.wheel -= pad.zoom * 14 * f;
    }
  }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly blocked: () => boolean) {
    window.addEventListener('keydown', (e) => {
      if (this.blocked()) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!e.repeat) this.pressed.push(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.focus();
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (!this.dragging) return;
      this.dragDX += e.clientX - this.lastX;
      this.dragDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 6 && performance.now() - this.downAt.t < 400) {
        if (e.button === 2) this.rightClicked = true;
        else this.clicked = true;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      { passive: false },
    );
  }

  /** 有没有按下过这个键（按住不算）；每次调用消耗一次按下。 */
  hit(code: string): boolean {
    const i = this.pressed.indexOf(code);
    if (i < 0) return false;
    this.pressed.splice(i, 1);
    return true;
  }

  /** 每帧结束时清空一次性输入；没处理完的按键最多留到下一帧。 */
  endFrame(): void {
    this.pressed = this.pressed.slice(-4);
    this.dragDX = 0;
    this.dragDY = 0;
    this.wheel = 0;
    this.clicked = false;
    this.rightClicked = false;
  }

  axis(): { x: number; y: number; run: boolean } {
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const p = this.pad;
    // 手柄摇杆是模拟量：推一半就走一半的速度
    return {
      x: kx || (p?.move.x ?? 0),
      y: ky || (p?.move.y ?? 0),
      run: k.has('ShiftLeft') || k.has('ShiftRight') || !!p?.run,
    };
  }
}
