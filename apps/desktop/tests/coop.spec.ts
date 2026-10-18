import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * 双窗口联机回归（M2）：同一台电脑上一个房主、一个客人，经局域网 WebSocket 连接。
 * 只通过界面和意图操作（测试钩子也只发意图）；4 人云主战的不同步检测在 packages/net 的单元测试里。
 */
async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

async function waitFor(win: Page, expr: string, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await g<boolean>(win, expr).catch(() => false)) return;
    await win.waitForTimeout(100);
  }
  throw new Error(`等不到：${expr}`);
}

async function launch(env: Record<string, string>): Promise<{ app: ElectronApplication; win: Page; errors: string[] }> {
  const app = await electron.launch({ args: ['.'], cwd: resolve(__dirname, '..'), env: { ...process.env, CLOUDSEA_TEST: '1', ...env } });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await win.setViewportSize({ width: 1280, height: 720 });
  return { app, win, errors };
}

/** 跳过开场、领第一只伙伴、引导完成（都是意图）。 */
async function readyUp(win: Page): Promise<void> {
  await waitFor(win, `g.mode() === 'cutscene' || g.mode() === 'explore'`);
  await g(win, 'g.skipCutscene()');
  await win.waitForTimeout(300);
  for (let i = 0; i < 20 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.keyboard.press('Enter');
  await g(win, `g.act({ type: 'adoptStarter' })`);
  await g(win, `g.act({ type: 'tutorial', step: 6, done: true })`);
  await win.waitForTimeout(200);
  for (let i = 0; i < 20 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.keyboard.press('Enter');
}

async function sail(win: Page, islandId: string, me: string): Promise<void> {
  expect(await g<boolean>(win, `g.sail('${islandId}')`)).toBe(true);
  await waitFor(win, `g.mode() === 'voyage'`);
  await win.keyboard.press('Space');
  await waitFor(win, `!['voyage', 'landing'].includes(g.mode()) && g.world().players['${me}'].islandId === '${islandId}'`, 40_000);
  await g(win, 'g.skipCutscene()');
  await win.waitForTimeout(300);
}

test('双窗口联机：加入、互相看见、合作战斗、离开', async () => {
  test.setTimeout(240_000);
  const port = String(47700 + (process.pid % 200));
  const host = await launch({ CLOUDSEA_AUTOHOST: '1', CLOUDSEA_PORT: port });
  await readyUp(host.win);
  const guest = await launch({ CLOUDSEA_AUTOJOIN: `127.0.0.1:${port}` });
  await guest.win.waitForSelector('#join-address');
  await guest.win.screenshot({ path: 'screenshots/coop-01-join.png' });
  await guest.win.locator('#title .btn', { hasText: /^加入$/ }).click();
  await readyUp(guest.win);

  const guestId = await g<string>(guest.win, `Object.keys(g.world().characters).find((id) => id !== 'p1')`);
  expect(guestId).toBeTruthy();
  expect(await g<number>(host.win, 'Object.keys(g.world().characters).length')).toBe(2);
  expect(await g<string>(guest.win, `g.world().characters.p1.name`)).toBe('房主');

  // 一起去麦浪坡，站在一起：互相看得见（头顶名字）
  await sail(host.win, 'wheatSlope', 'p1');
  await sail(guest.win, 'wheatSlope', guestId);
  const wild = await g<{ id: string; x: number; z: number }>(host.win, `(() => { const w = Object.values(g.world().islands.wheatSlope.wild).filter((e) => e.group.length === 1)[0]; return { id: w.id, x: w.x, z: w.z }; })()`);
  await g(host.win, `g.teleport(${wild.x}, ${wild.z + 1.5}, Math.PI)`);
  await g(guest.win, `g.teleport(${wild.x + 1.6}, ${wild.z + 2.2}, Math.PI)`);
  await waitFor(host.win, `document.querySelectorAll('.nameplate').length >= 1`);
  await g(host.win, 'g.setCamera(0.6, 0.35, 7)');
  await host.win.waitForTimeout(800);
  await host.win.screenshot({ path: 'screenshots/coop-02-see-each-other.png' });
  expect(await host.win.locator('.nameplate').first().textContent()).toContain('客人');

  // 合作战斗：房主接触野生絮灵，客人按 E 加入
  await g(host.win, `g.act({ type: 'encounter', wildId: '${wild.id}' })`);
  await waitFor(guest.win, `g.interactables().some((i) => i.kind === 'joinBattle')`);
  const join = await g<{ x: number; z: number }>(guest.win, `g.interactables().find((i) => i.kind === 'joinBattle')`);
  await g(guest.win, `g.teleport(${join.x + 1}, ${join.z}, -Math.PI / 2)`);
  await waitFor(guest.win, `g.nearest()?.kind === 'joinBattle'`);
  await guest.win.keyboard.press('KeyE');
  await waitFor(guest.win, `g.mode() === 'battle'`);
  await waitFor(host.win, `g.mode() === 'battle'`);
  const battle = await g<{ participants: string[] }>(host.win, `Object.values(g.world().battles)[0]`);
  expect(battle.participants).toEqual(['p1', guestId]);
  await guest.win.waitForTimeout(1500);
  await guest.win.screenshot({ path: 'screenshots/coop-03-battle-guest.png' });

  // 两边各自选轻击，直到打完
  const cont = (w: Page) => w.locator('#battle-ui .btn', { hasText: /^继续$/ });
  // 按时间而不是按回合数等（机器忙的时候动画慢）
  const until = Date.now() + 120_000;
  for (let i = 0; Date.now() < until; i++) {
    if ((await cont(host.win).isVisible().catch(() => false)) && (await cont(guest.win).isVisible().catch(() => false))) break;
    for (const w of [host.win, guest.win]) {
      const b = w.locator('#battle-ui .btn:not([aria-disabled="true"])', { hasText: '轻击' }).first();
      if (await b.isVisible().catch(() => false)) await b.click();
    }
    if (i === 0) {
      await host.win.waitForTimeout(200);
      await host.win.screenshot({ path: 'screenshots/coop-04-waiting.png' });
    }
    await host.win.waitForTimeout(700);
  }
  await cont(host.win).click({ timeout: 60_000 });
  await cont(guest.win).click({ timeout: 60_000 });
  await waitFor(host.win, `g.mode() === 'explore'`);
  await waitFor(guest.win, `g.mode() === 'explore'`);

  // 客人离开：房主收到提示，客人的角色存到客人本机
  await guest.win.keyboard.press('Tab');
  await guest.win.locator('#modal .btn', { hasText: '联机' }).click();
  await guest.win.waitForTimeout(300);
  await guest.win.screenshot({ path: 'screenshots/coop-05-net-tab-guest.png' });
  await guest.win.locator('#modal .btn', { hasText: '离开（保存角色）' }).click();
  await waitFor(host.win, `Object.keys(g.world().characters).length === 1`);
  await guest.win.waitForSelector('#title');
  await host.win.keyboard.press('Tab');
  await host.win.locator('#modal .btn', { hasText: '联机' }).click();
  await host.win.waitForTimeout(300);
  await host.win.screenshot({ path: 'screenshots/coop-06-net-tab-host.png' });

  await guest.app.close();
  await host.app.close();
  expect(guest.errors).toEqual([]);
  expect(host.errors).toEqual([]);
});
