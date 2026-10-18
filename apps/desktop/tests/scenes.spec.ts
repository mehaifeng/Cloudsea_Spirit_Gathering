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
  core: async (win) => {
    await win.waitForTimeout(500);
    await shot(win, 'core-a-day');
    await g(win, 'g.fastForward(8200 - g.world().tick % 12000)');
    await win.waitForTimeout(1200);
    await shot(win, 'core-b-night');
  },
  build: async (win) => {
    // Lynx 反馈：建造模式里预览要对准鼠标（之前因为相机矩阵没刷新，偏得很远）
    await win.keyboard.press('KeyB');
    await win.waitForTimeout(400);
    await win.locator('#build-bar .btn', { hasText: '路灯' }).click();
    for (const [mx, my] of [[640, 300], [420, 260], [860, 380]] as const) {
      await win.mouse.move(mx, my);
      await win.waitForTimeout(300);
      const c = await g<{ x: number; y: number } | null>(win, 'g.buildCursor()');
      expect(c).not.toBeNull();
      expect(Math.hypot(c!.x - mx, c!.y - my), `鼠标 ${mx},${my} → 预览 ${Math.round(c!.x)},${Math.round(c!.y)}`).toBeLessThan(60);
    }
    await shot(win, 'build-cursor');
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
    // 下船前后都不能被云舟挡住：船上的玩家在甲板高度
    expect((await g<{ y: number }>(win, 'g.player()')).y).toBeGreaterThan(0.6);
    for (let i = 0; i < 50 && (await g<string>(win, 'g.mode()')) !== 'voyage'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(1500);
    await shot(win, 'voyage-b-depart');
    await win.waitForTimeout(2500);
    await shot(win, 'voyage-c-cruise');
    await win.keyboard.press('Space');
    for (let i = 0; i < 80 && (await g<string>(win, 'g.mode()')) !== 'landing'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(1200);
    await shot(win, 'voyage-d-gangway-down');
    for (let i = 0; i < 80 && (await g<string>(win, 'g.mode()')) === 'landing'; i++) await win.waitForTimeout(100);
    await shot(win, 'voyage-e-landed');
  },
  boarding: async (win) => {
    for (const [ms, name] of [[1500, 'a'], [1200, 'b'], [1200, 'c'], [1500, 'd']] as const) {
      await win.waitForTimeout(ms);
      await shot(win, `boarding-${name}`);
    }
    for (let i = 0; i < 80 && (await g<string>(win, 'g.mode()')) !== 'voyage'; i++) await win.waitForTimeout(100);
    expect(await g(win, 'g.mode()')).toBe('voyage');
  },
  gallery: async (win) => {
    for (const page of [0, 1]) {
      await g(win, `g.gallery(${page})`);
      await win.waitForTimeout(800);
      await shot(win, `gallery-${page}`);
    }
  },
  lighthouse: async (win) => {
    await win.waitForTimeout(800);
    await shot(win, 'lighthouse');
    expect(await g(win, `g.interactables().some((i) => i.kind === 'cloudlord')`)).toBe(true);
  },
  cloudlord: async (win) => {
    await win.waitForTimeout(1800);
    await shot(win, 'cloudlord-battle');
    // 单人上限 3 个位置（只带了 1 只就上 1 只）；云主一方 = 云主 + 2 护卫
    expect(await g<string>(win, 'Object.values(g.world().battles)[0].kind')).toBe('cloudlord');
    expect(await g<number>(win, 'Object.values(g.world().battles)[0].state.sides[1].units.length')).toBe(3);
  },
  chart: async (win) => {
    await win.keyboard.press('KeyM');
    await win.waitForSelector('#modal .chart');
    for (const [label, name] of [['晴原', 'a-sunPlains'], ['风谷', 'b-windValley'], ['雨泽', 'c-rainMarsh'], ['雷崖', 'd-thunderCliff']] as const) {
      await win.locator('#modal .btn', { hasText: label }).first().click();
      await win.waitForTimeout(200);
      await shot(win, `chart-${name}`);
    }
    // 雷崖还在浓雾里：岛按钮都不能点
    expect(await win.locator('#modal .chart-fog').isVisible()).toBe(true);
    expect(await win.locator('#modal .chart .isle .btn:not([aria-disabled="true"])').count()).toBe(0);
    // 每张图的岛都在图框之内
    for (const label of ['晴原', '风谷', '雨泽', '雷崖', '雾海']) {
      await win.locator('#modal .btn', { hasText: label }).first().click();
      await win.waitForTimeout(100);
      const box = (await win.locator('#modal .chart').boundingBox())!;
      for (const b of await win.locator('#modal .chart .isle').all()) {
        const r = (await b.boundingBox())!;
        expect(r.x, label).toBeGreaterThanOrEqual(box.x - 1);
        expect(r.x + r.width, label).toBeLessThanOrEqual(box.x + box.width + 1);
        expect(r.y, label).toBeGreaterThanOrEqual(box.y - 1);
        expect(r.y + r.height, label).toBeLessThanOrEqual(box.y + box.height + 1);
      }
    }
  },
  share: async (win) => {
    await win.keyboard.press('Tab');
    await win.locator('#modal .btn', { hasText: '分享' }).click();
    await win.locator('#modal .btn', { hasText: '生成我的岛屿码' }).click();
    const islandCode = await win.locator('#modal textarea[readonly]').first().inputValue();
    expect(islandCode).toMatch(/^XI-/);
    await win.locator('#modal textarea[placeholder*="岛屿码"]').fill(islandCode);
    await win.locator('#modal .btn', { hasText: /生成当前队伍的队伍码/ }).click();
    const teamCode = await win.locator('#modal textarea[readonly]').nth(1).inputValue();
    expect(teamCode).toMatch(/^XT-/);
    await win.locator('#modal textarea[placeholder*="队伍码"]').fill(teamCode);
    await win.waitForTimeout(200);
    await shot(win, 'share-a-tab');
    await win.locator('#modal .btn', { hasText: '参观这座岛' }).click();
    await win.waitForTimeout(1500);
    expect(await g<string>(win, 'g.mode()')).toBe('visit');
    await shot(win, 'share-b-visit');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    expect(await g<string>(win, 'g.mode()')).toBe('explore');
    await win.keyboard.press('Tab');
    await win.locator('#modal .btn', { hasText: '分享' }).click();
    await win.locator('#modal .btn', { hasText: '挑战这支队伍' }).click();
    for (let i = 0; i < 40 && (await g<string>(win, 'g.mode()')) !== 'battle'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(1500);
    await shot(win, 'share-c-team-battle');
    expect(await g<string>(win, 'Object.values(g.world().battles)[0].kind')).toBe('teamCode');
  },
  achievements: async (win) => {
    await win.waitForTimeout(300);
    await shot(win, 'achievements-a-toast');
    const got = await g<string[]>(win, 'g.world().characters.p1.achievements');
    expect(got).toEqual(expect.arrayContaining(['firstFriend', 'firstLight', 'halfway', 'guardianNod']));
    await win.keyboard.press('Tab');
    await win.locator('#modal .btn', { hasText: '成就' }).click();
    await win.waitForTimeout(200);
    await shot(win, 'achievements-b-tab');
    expect(await win.locator('#modal .achievement.done').count()).toBe(got.length);
  },
  guardian: async (win) => {
    await win.waitForTimeout(600);
    await shot(win, 'guardian-a-explore');
    expect(await g<boolean>(win, `g.interactables().some((i) => i.kind === 'guardian')`)).toBe(true);
    // 走到守卫面前（跟着的絮灵也在附近，贴近一点让守卫成为最近的交互对象）
    await g(win, `(() => { const i = g.interactables().find((i) => i.kind === 'guardian'); g.teleport(i.x - 0.9, i.z + 0.3, Math.PI / 2); })()`);
    for (let i = 0; i < 30 && (await g<string | undefined>(win, 'g.nearest()?.kind')) !== 'guardian'; i++) await win.waitForTimeout(100);
    expect(await g<string | undefined>(win, 'g.nearest()?.kind')).toBe('guardian');
    await win.keyboard.press('KeyE');
    for (let i = 0; i < 40 && !(await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.waitForTimeout(100);
    await win.waitForTimeout(300);
    await shot(win, 'guardian-b-line');
    for (let i = 0; i < 40 && (await g<string>(win, 'g.mode()')) !== 'battle'; i++) {
      if (await g<boolean>(win, 'g.dialogueOpen()')) await win.keyboard.press('Enter');
      await win.waitForTimeout(100);
    }
    await win.waitForTimeout(1500);
    await shot(win, 'guardian-c-battle');
    expect(await g<string>(win, 'Object.values(g.world().battles)[0].kind')).toBe('guardian');
  },
  regions: async (win) => {
    const showcase: Record<string, string> = { sunPlains: 'wheatSlope', windValley: 'gustRidge', rainMarsh: 'lotusPond', thunderCliff: 'stormMesa', mistSea: 'jellyReef' };
    for (const [region, isl] of Object.entries(showcase)) {
      expect(await g<boolean>(win, `g.sail('${isl}')`), isl).toBe(true);
      for (let i = 0; i < 600; i++) {
        const done = await g<boolean>(win, `g.mode() === 'explore' && g.world().players.p1.islandId === '${isl}'`);
        if (done) break;
        if ((await g<string>(win, 'g.mode()')) === 'voyage') await g(win, 'g.fastForward(200)');
        await win.waitForTimeout(100);
      }
      await g(win, 'g.skipCutscene()');
      for (let i = 0; i < 10 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.keyboard.press('Enter');
      await g(win, 'g.setCamera(0.5, 0.3, 14)');
      await win.waitForTimeout(900);
      await shot(win, `region-${region}`);
    }
  },
  ambush: async (win) => {
    for (let i = 0; i < 40 && (await g<string>(win, 'g.mode()')) !== 'cutscene'; i++) await win.waitForTimeout(100);
    await win.waitForTimeout(700);
    await shot(win, 'ambush-a-mist');
    await win.waitForTimeout(700);
    await shot(win, 'ambush-a2-run');
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
