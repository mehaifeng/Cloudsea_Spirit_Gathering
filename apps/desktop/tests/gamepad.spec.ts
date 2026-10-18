import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * 手柄回归（M4-2）：用模拟的标准手柄（替换 navigator.getGamepads）只靠手柄走一遍核心操作：
 * 移动、转镜头、跳、交互、菜单焦点导航、战斗选招。截图在 screenshots/gamepad-*.png。
 */
async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

async function launch(scene: string) {
  const app = await electron.launch({ args: ['.'], cwd: resolve(__dirname, '..'), env: { ...process.env, CLOUDSEA_TEST: '1', CLOUDSEA_SCENE: scene } });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.waitForSelector(`body[data-scene="${scene}"]`, { timeout: 60_000 });
  // 模拟手柄（标准映射：17 个按键、4 个轴）
  await win.evaluate(`(() => {
    const pad = { id: 'Fake Pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  })()`);
  return { app, win, errors };
}

const BTN = { a: 0, b: 1, x: 2, y: 3, lt: 6, rt: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

async function press(win: Page, b: keyof typeof BTN, hold = 180): Promise<void> {
  await win.evaluate(`window.__pad.buttons[${BTN[b]}] = { pressed: true, touched: true, value: 1 }`);
  await win.waitForTimeout(hold);
  await win.evaluate(`window.__pad.buttons[${BTN[b]}] = { pressed: false, touched: false, value: 0 }`);
  await win.waitForTimeout(120);
}

async function stick(win: Page, axes: [number, number, number, number], ms: number): Promise<void> {
  await win.evaluate(`window.__pad.axes = ${JSON.stringify(axes)}`);
  await win.waitForTimeout(ms);
  await win.evaluate('window.__pad.axes = [0, 0, 0, 0]');
  await win.waitForTimeout(100);
}

test('手柄：探索、菜单、交互', async () => {
  test.setTimeout(120_000);
  const { app, win, errors } = await launch('home');
  try {
    // 左摇杆走路
    const p0 = await g<{ x: number; z: number }>(win, 'g.player()');
    await stick(win, [0, -1, 0, 0], 900);
    const p1 = await g<{ x: number; z: number }>(win, 'g.player()');
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(1.5);
    // 提示换成手柄按键
    expect(await win.locator('#hints').textContent()).toContain('左摇杆');
    // 右摇杆转镜头
    const c0 = await g<{ yaw: number }>(win, 'g.camera()');
    await win.evaluate('window.__pad.axes = [0, 0, 1, 0]');
    let turned = 0;
    for (let i = 0; i < 60 && turned <= 0.3; i++) {
      await win.waitForTimeout(50);
      turned = Math.abs((await g<{ yaw: number }>(win, 'g.camera()')).yaw - c0.yaw);
    }
    await win.evaluate('window.__pad.axes = [0, 0, 0, 0]');
    expect(turned).toBeGreaterThan(0.3);
    // X 跳
    // 按下 X 的同时就开始看是不是离地了（机器忙时帧慢，不能等松开再看）
    const jumping = press(win, 'x');
    let air = false;
    for (let i = 0; i < 40 && !air; i++) {
      air = await g<boolean>(win, 'g.player().airborne');
      await win.waitForTimeout(30);
    }
    await jumping;
    expect(air).toBe(true);
    await win.waitForTimeout(800);
    // 走到码头上，A 交互 → 打开码头面板；B 关掉（先让跟着的絮灵留在家里，免得它比码头更近）
    expect(await g<{ ok: boolean }>(win, `g.act({ type: 'setParty', spiritIds: [] })`)).toMatchObject({ ok: true });
    await g(win, 'g.teleport(1.2, 17.2, Math.PI / 2)');
    await win.waitForTimeout(300);
    expect(await g<string>(win, 'g.nearest()?.kind')).toBe('dock');
    await win.screenshot({ path: 'screenshots/gamepad-01-explore.png' });
    await press(win, 'a');
    expect(await g<boolean>(win, 'g.modalOpen()')).toBe(true);
    await press(win, 'b');
    expect(await g<boolean>(win, 'g.modalOpen()')).toBe(false);
    // Y 打开菜单，十字键右移到“背包”，A 切页，B 关闭
    await press(win, 'y');
    expect(await g<boolean>(win, 'g.modalOpen()')).toBe(true);
    const focused = () => win.evaluate<string>("document.activeElement?.textContent ?? ''");
    expect(await focused()).toBe('絮灵');
    await press(win, 'right');
    expect(await focused()).toBe('背包');
    await press(win, 'a');
    expect(await win.locator('#modal .tabs .btn.selected').textContent()).toBe('背包');
    await win.screenshot({ path: 'screenshots/gamepad-02-menu.png' });
    await press(win, 'b');
    expect(await g<boolean>(win, 'g.modalOpen()')).toBe(false);
    // Select 打开星图
    await press(win, 'select');
    expect(await win.locator('#modal .chart').count()).toBe(1);
    await press(win, 'b');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('手柄：战斗里选招、确认', async () => {
  test.setTimeout(120_000);
  const { app, win, errors } = await launch('wild');
  try {
    await win.waitForTimeout(1500);
    const turn0 = await g<number>(win, 'Object.values(g.world().battles)[0].state.turn');
    // 十字键在按钮间移动，A 确认；需要选目标时再按 A
    await press(win, 'down');
    await press(win, 'up');
    await win.screenshot({ path: 'screenshots/gamepad-03-battle.png' });
    for (let i = 0; i < 6; i++) {
      const b = await g<{ state: { turn: number } } | undefined>(win, 'Object.values(g.world().battles)[0]');
      if (!b || b.state.turn > turn0) break;
      await press(win, 'a');
      await win.waitForTimeout(250);
    }
    for (let i = 0; i < 40; i++) {
      const b = await g<{ state: { turn: number } } | undefined>(win, 'Object.values(g.world().battles)[0]');
      if (!b || b.state.turn > turn0) break;
      await win.waitForTimeout(200);
    }
    const after = await g<{ state: { turn: number } } | undefined>(win, 'Object.values(g.world().battles)[0]');
    expect(!after || after.state.turn > turn0).toBe(true);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
