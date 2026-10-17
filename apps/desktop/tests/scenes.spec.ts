import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * 场景截图（v0.6 测试模式）：每个场景直接启动到某个画面并截图，改动后几秒钟就能自查，
 * 不必跑完整的新手引导回归。截图在 screenshots/scenes/（不入库）。
 * 只跑部分场景：SCENES=swim,dock pnpm scenes
 */
const only = (process.env['SCENES'] ?? '').split(',').filter(Boolean);

async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

async function launch(scene: string): Promise<{ win: Page; close: () => Promise<void>; errors: string[] }> {
  const app = await electron.launch({ args: ['.'], cwd: resolve(__dirname, '..'), env: { ...process.env, CLOUDSEA_TEST: '1', CLOUDSEA_SCENE: scene } });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.waitForSelector(`body[data-scene="${scene}"]`, { timeout: 60_000 });
  return { win, errors, close: () => app.close() };
}

const shot = (win: Page, name: string) => win.screenshot({ path: `screenshots/scenes/${name}.png` });

/** 每个场景：启动后要截的几张图（可以在截图之间推进时间或操作）。 */
const SCENES: Record<string, (win: Page) => Promise<void>> = {
  opening: async (win) => {
    await g(win, 'g.freeze(true)');
    for (const [t, name] of [[2.5, 'a-glide'], [5.6, 'b-approach'], [7.4, 'c-slide'], [10.4, 'd-stopped'], [12.6, 'e-jump'], [16.2, 'f-orb']] as const) {
      const now = (await g<number | null>(win, 'g.cutsceneTime()')) ?? 0;
      await g(win, `g.advance(${Math.max(0, t - now)})`);
      await win.waitForTimeout(150);
      await shot(win, `opening-${name}`);
    }
    await g(win, 'g.advance(4)');
    await g(win, 'g.freeze(false)');
    await win.waitForTimeout(300);
    await shot(win, 'opening-g-back');
    expect(await g(win, 'g.mode()')).toBe('explore');
    const p = await g<{ y: number; airborne: boolean }>(win, 'g.player()');
    expect(p.airborne).toBe(false);
  },
  home: async (win) => {
    await win.waitForTimeout(500);
    await shot(win, 'home');
    await win.locator('.party-badge').first().click();
    await win.waitForTimeout(300);
    await shot(win, 'home-party-click');
    expect(await win.locator('#party-bar').isVisible()).toBe(false);
  },
  night: async (win) => {
    await win.waitForTimeout(800);
    await shot(win, 'night');
  },
  swim: async (win) => {
    await win.waitForTimeout(600);
    const p = await g<{ swimming: boolean }>(win, 'g.player()');
    expect(p.swimming).toBe(true);
    await shot(win, 'swim');
  },
  shore: async (win) => {
    await win.waitForTimeout(300);
    await shot(win, 'shore-a-dry');
    await win.keyboard.down('KeyW');
    for (let i = 0; i < 40 && !(await g<{ swimming: boolean }>(win, 'g.player()')).swimming; i++) await win.waitForTimeout(100);
    await win.keyboard.up('KeyW');
    expect((await g<{ swimming: boolean }>(win, 'g.player()')).swimming).toBe(true);
    await shot(win, 'shore-b-swim');
  },
  dock: async (win) => {
    await win.waitForTimeout(400);
    const p = await g<{ y: number }>(win, 'g.player()');
    expect(p.y).toBeGreaterThan(0.2);
    await shot(win, 'dock');
    // 往云舟走：会被船身挡住，不会穿进去
    await win.keyboard.down('KeyD');
    await win.waitForTimeout(1500);
    await win.keyboard.up('KeyD');
    const q = await g<{ x: number; y: number }>(win, 'g.player()');
    // 停泊的云舟在 x = 3.65，船舷半宽约 0.94：玩家停在船舷外
    expect(q.x).toBeLessThan(3.65 - 0.94);
    await shot(win, 'dock-blocked');
  },
  voyage: async (win) => {
    await shot(win, 'voyage-a-boarded');
    for (let i = 0; i < 50 && (await g<string>(win, 'g.mode()')) !== 'voyage'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(1500);
    await shot(win, 'voyage-b-depart');
    await win.waitForTimeout(2500);
    await shot(win, 'voyage-c-cruise');
    await win.keyboard.press('Space');
    for (let i = 0; i < 80 && (await g<string>(win, 'g.mode()')) !== 'landing'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(500);
    await shot(win, 'voyage-d-landing');
    for (let i = 0; i < 80 && (await g<string>(win, 'g.mode()')) === 'landing'; i++) await win.waitForTimeout(100);
    await shot(win, 'voyage-e-landed');
  },
  ambush: async (win) => {
    for (let i = 0; i < 40 && (await g<string>(win, 'g.mode()')) !== 'cutscene'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(1200);
    await shot(win, 'ambush-a-run');
    await win.waitForTimeout(2200);
    await shot(win, 'ambush-b-face');
    for (let i = 0; i < 60 && (await g<string>(win, 'g.mode()')) !== 'transition'; i++) await win.waitForTimeout(50);
    await win.waitForTimeout(250);
    await shot(win, 'ambush-c-transition');
    for (let i = 0; i < 40 && (await g<string>(win, 'g.mode()')) !== 'battle'; i++) await win.waitForTimeout(50);
    await win.waitForTimeout(300);
    await shot(win, 'ambush-d-battle-intro');
    await win.waitForTimeout(1500);
    await shot(win, 'ambush-e-battle');
  },
  wild: async (win) => {
    await win.waitForTimeout(1500);
    // 出招按钮的说明卡
    await win.locator('#battle-ui .btn.sk').first().hover();
    await win.waitForTimeout(200);
    await shot(win, 'wild-a-tooltip');
    // 连续出招：双方都要回到原位、面朝对方
    for (let turn = 0; turn < 5; turn++) {
      const btn = win.locator('#battle-ui .btn:not([aria-disabled="true"])', { hasText: '轻击' }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click();
      await win.waitForTimeout(3500);
    }
    await shot(win, 'wild-b-after-turns');
    const pos = await g<Record<string, { x: number; z: number; yaw: number; home: { x: number; z: number } }> | null>(win, 'g.battlePositions()');
    for (const [uid, p] of Object.entries(pos ?? {})) {
      expect(Math.hypot(p.x - p.home.x, p.z - p.home.z), uid).toBeLessThan(0.3);
      const facing = uid.startsWith('0:') ? Math.PI : 0;
      expect(Math.abs(Math.atan2(Math.sin(p.yaw - facing), Math.cos(p.yaw - facing))), uid).toBeLessThan(0.5);
    }
  },
};

for (const [name, run] of Object.entries(SCENES)) {
  if (only.length && !only.includes(name)) continue;
  test(`场景：${name}`, async () => {
    test.setTimeout(120_000);
    const { win, close, errors } = await launch(name);
    try {
      await run(win);
    } finally {
      await close();
    }
    expect(errors).toEqual([]);
  });
}
