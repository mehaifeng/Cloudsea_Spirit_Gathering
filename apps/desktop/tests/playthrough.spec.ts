import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * 回归冒烟：按新手引导走一遍 M1 的核心循环，每一步截图（screenshots/，不入库）。
 * 只通过界面和意图操作世界（测试钩子也只发意图），页面不能有报错。
 */
async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

/** 播片：截一张图（可选）后按 Esc 跳过。 */
async function skipCutscene(win: Page, shot?: string): Promise<void> {
  for (let i = 0; i < 20 && (await g<string>(win, 'g.mode()')) !== 'cutscene'; i++) await win.waitForTimeout(100);
  if ((await g<string>(win, 'g.mode()')) !== 'cutscene') return;
  if (shot) {
    await win.waitForTimeout(1600);
    await win.screenshot({ path: shot });
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
}

async function closeDialogues(win: Page): Promise<void> {
  for (let i = 0; i < 30 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) {
    await win.keyboard.press('Enter');
    await win.waitForTimeout(100);
  }
}

/**
 * 打一场：按优先顺序点第一个能点的按钮，直到出现“继续”。
 * capture = true 时像玩家一样：先用轻击把对手打到一半以下，再用灯露（灯露用完就防御，不把它打倒）。
 */
async function fight(win: Page, prefer: RegExp[], capture = false): Promise<void> {
  const cont = win.locator('#battle-ui .btn', { hasText: /^继续$/ });
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (await cont.isVisible().catch(() => false)) break;
    let clicked = false;
    let order = prefer;
    if (capture) {
      const ratio = await g<number>(win, `(() => { const b = Object.values(g.world().battles)[0]; if (!b) return 1; const u = b.state.sides[1].units.find((x) => !x.downed && !x.captured); return u ? u.hp / u.maxHp : 1; })()`);
      order = ratio > 0.5 ? [/轻击/] : [/^灯露（\d+）/, /^灯露$/, /防御/];
    }
    for (const re of order) {
      const btn = win.locator('#battle-ui .btn:not([aria-disabled="true"])').filter({ hasText: re }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    await win.waitForTimeout(clicked ? 200 : 400);
  }
  await cont.click({ timeout: 5_000 });
  await win.waitForTimeout(500);
}

async function sail(win: Page, islandId: string, shot?: string): Promise<void> {
  const r = await g<{ ok: boolean; error?: string }>(win, `g.act({ type: 'sail', islandId: '${islandId}' })`);
  expect(r.ok, r.error).toBe(true);
  await win.waitForTimeout(1900);
  if (islandId !== 'home') await skipCutscene(win, shot);
}

async function gatherAll(win: Page, kinds: string[]): Promise<number> {
  const nodes = await g<Array<{ id: string; x: number; z: number }>>(win, `g.interactables().filter((i) => i.kind === 'gather')`);
  let n = 0;
  for (const node of nodes) {
    if (!kinds.some((k) => node.id.includes(`:${k}:`))) continue;
    await g(win, `g.teleport(${node.x}, ${node.z + 1.1})`);
    await win.waitForTimeout(60);
    const r = await g<{ ok: boolean }>(win, `g.act({ type: 'gather', nodeId: '${node.id}' })`);
    if (r.ok) n++;
  }
  return n;
}

test('新手引导与核心循环', async () => {
  test.setTimeout(300_000);
  const appDir = resolve(__dirname, '..');
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, CLOUDSEA_TEST: '1' } });
  const errors: string[] = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack}`));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.waitForSelector('body[data-ready="true"]');
  await win.waitForTimeout(1200);
  await win.screenshot({ path: 'screenshots/01-title.png' });

  // 0 坠落 → 移动
  await win.getByText('开始新的旅程').click();
  await win.waitForTimeout(2600);
  await win.screenshot({ path: 'screenshots/02a-opening.png' });
  await win.waitForTimeout(5200);
  await win.screenshot({ path: 'screenshots/02b-opening-crash.png' });
  await win.waitForTimeout(3600);
  await win.screenshot({ path: 'screenshots/02c-opening-light.png' });
  await skipCutscene(win);
  await win.waitForTimeout(500);
  await win.screenshot({ path: 'screenshots/02-intro.png' });
  await closeDialogues(win);
  await win.keyboard.down('KeyW');
  await win.waitForTimeout(1800);
  await win.keyboard.up('KeyW');
  await win.waitForTimeout(300);
  expect(await g(win, 'g.world().characters.p1.tutorial.step')).toBe(1);
  await win.screenshot({ path: 'screenshots/03-home-day.png' });

  // 1 第一只絮灵 → 2 第一场战斗（不会输）
  await g(win, 'g.teleport(2.5, 6)');
  await win.waitForTimeout(400);
  expect(await g(win, 'g.nearest()?.kind')).toBe('starter');
  await win.keyboard.press('KeyE');
  await win.waitForTimeout(700);
  await closeDialogues(win);
  await win.waitForTimeout(1200);
  expect(await g(win, 'g.mode()')).toBe('battle');
  await win.waitForTimeout(800);
  await win.screenshot({ path: 'screenshots/04-battle-tutorial.png' });
  await fight(win, [/轻击/]);
  expect(await g(win, 'g.world().characters.p1.tutorial.step')).toBe(3);

  // 3 出航、捕获
  await sail(win, 'wheatSlope', 'screenshots/05a-arrival.png');
  await win.screenshot({ path: 'screenshots/05-wheat-slope.png' });
  for (let attempt = 0; attempt < 8 && (await g<number>(win, 'g.world().characters.p1.stats.caught')) < 1; attempt++) {
    const t = await g<{ id: string; x: number; z: number } | null>(
      win,
      `(() => { const w = Object.values(g.world().islands.wheatSlope.wild).filter((e) => e.group.length === 1).sort((a, b) => a.group[0].level - b.group[0].level); const x = w[0]; return x ? { id: x.id, x: x.x, z: x.z } : null; })()`,
    );
    if (!t) break;
    await g(win, `g.teleport(${t.x}, ${t.z + 1.2})`);
    await win.waitForTimeout(200);
    const r = await g<{ ok: boolean }>(win, `g.act({ type: 'encounter', wildId: '${t.id}' })`);
    if (!r.ok) continue;
    await skipCutscene(win, attempt === 0 ? 'screenshots/05b-first-wild.png' : undefined);
    await win.waitForTimeout(1500);
    if (attempt === 0) await win.screenshot({ path: 'screenshots/06-battle-wild.png' });
    await fight(win, [], true);
  }
  expect(await g<number>(win, 'g.world().characters.p1.stats.caught')).toBeGreaterThanOrEqual(1);
  await win.waitForTimeout(300);
  expect(await g(win, 'g.world().characters.p1.tutorial.step')).toBe(4);

  // 4 采集 → 回家建栖巢 → 安排打工
  expect(await gatherAll(win, ['tree', 'rock'])).toBeGreaterThan(5);
  await sail(win, 'home');
  const nest = await g<{ ok: boolean; at?: [number, number] }>(
    win,
    `(async () => { for (let x = 2; x < 9; x++) for (let z = -8; z < 0; z++) { const r = await g.act({ type: 'build', building: 'nest', x, z, rot: 0 }); if (r.ok) return { ok: true, at: [x, z] }; } return { ok: false }; })()`,
  );
  expect(nest.ok).toBe(true);
  const worker = await g<string>(win, `(() => { const c = g.world().characters.p1; return c.party[c.party.length - 1]; })()`);
  const keep = await g<string[]>(win, `g.world().characters.p1.party.filter((id) => id !== '${worker}')`);
  expect((await g<{ ok: boolean }>(win, `g.act({ type: 'setParty', spiritIds: ${JSON.stringify(keep)} })`)).ok).toBe(true);
  const nestId = await g<string>(win, `Object.values(g.world().homes.p1.buildings).find((b) => b.type === 'nest').id`);
  expect((await g<{ ok: boolean; error?: string }>(win, `g.act({ type: 'assignWorker', buildingId: '${nestId}', spiritId: '${worker}' })`)).ok).toBe(true);
  await win.screenshot({ path: 'screenshots/07-building.png' });
  await g(win, 'g.fastForward(1500)');
  await win.waitForTimeout(800);
  expect(await g(win, `g.world().homes.p1.buildings['${nestId}'].built`)).toBe(true);
  // 栖巢建好后工人回到空闲；给它找份工作：田地
  const field = await g<{ ok: boolean }>(
    win,
    `(async () => { for (let x = -8; x < 0; x++) for (let z = -8; z < 0; z++) { const r = await g.act({ type: 'build', building: 'field', x, z, rot: 0 }); if (r.ok) return { ok: true }; } return { ok: false }; })()`,
  );
  expect(field.ok).toBe(true);
  const fieldId = await g<string>(win, `Object.values(g.world().homes.p1.buildings).find((b) => b.type === 'field').id`);
  expect((await g<{ ok: boolean; error?: string }>(win, `g.act({ type: 'assignWorker', buildingId: '${fieldId}', spiritId: '${worker}' })`)).ok).toBe(true);
  await win.waitForTimeout(400);
  expect(await g(win, 'g.world().characters.p1.tutorial.step')).toBe(5);

  // 5 点亮第一盏灯
  await g(win, 'g.teleport(0, 2.4)');
  await win.waitForTimeout(400);
  expect(await g(win, 'g.nearest()?.kind')).toBe('core');
  await win.keyboard.press('KeyE');
  await win.waitForTimeout(600);
  await win.screenshot({ path: 'screenshots/08-first-light.png' });
  await closeDialogues(win);
  expect(await g(win, 'g.world().characters.p1.tutorial.done')).toBe(true);

  // 菜单与建造模式
  await win.keyboard.press('Tab');
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'screenshots/09-menu-spirits.png' });
  await win.locator('#modal .spirit-card').first().click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: 'screenshots/10-spirit-detail.png' });
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await win.keyboard.press('KeyB');
  await win.waitForTimeout(400);
  await win.locator('#build-bar .btn', { hasText: '路灯' }).click();
  await win.mouse.move(700, 380);
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'screenshots/11-build-mode.png' });
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  expect(await g(win, 'g.mode()')).toBe('explore');

  // 夜晚与近景
  await g(win, 'g.fastForward(8200 - g.world().tick % 12000)');
  await win.waitForTimeout(1500);
  await g(win, 'g.setCamera(0.6, 0.35, 9)');
  await win.waitForTimeout(800);
  await win.screenshot({ path: 'screenshots/12-home-night.png' });
  await g(win, 'g.setCamera(2.4, 0.15, 3.6)');
  await win.waitForTimeout(800);
  await win.screenshot({ path: 'screenshots/13-closeup.png' });

  // 守岛人
  await sail(win, 'heFarm');
  await g(win, 'g.teleport(1.5, 2.2)');
  await win.waitForTimeout(500);
  expect(await g(win, 'g.nearest()?.kind')).toBe('keeper');
  await win.keyboard.press('KeyE');
  await skipCutscene(win, 'screenshots/14a-keeper-intro.png');
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'screenshots/14-keeper.png' });
  await win.locator('#modal .btn', { hasText: '聊聊' }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'screenshots/15-keeper-talk.png' });
  await closeDialogues(win);

  // 守岛人对战：可以认输（Lynx 反馈）
  await win.keyboard.press('KeyE');
  await win.waitForTimeout(300);
  await win.locator('#modal .btn', { hasText: '比一场' }).click();
  await win.waitForTimeout(500);
  await closeDialogues(win);
  await win.waitForTimeout(1200);
  expect(await g(win, 'g.mode()')).toBe('battle');
  await win.locator('#battle-ui .btn', { hasText: /^认输$/ }).click();
  await win.waitForTimeout(200);
  await win.screenshot({ path: 'screenshots/15b-keeper-forfeit.png' });
  await win.locator('#battle-ui .btn', { hasText: '确定认输' }).click();
  await win.waitForTimeout(800);
  await closeDialogues(win);
  await win.locator('#battle-ui .btn', { hasText: /^继续$/ }).click();
  await win.waitForTimeout(500);
  expect(await g(win, 'g.mode()')).toBe('explore');

  // 存档 → 回到标题 → 继续：位置、絮灵、建筑都还在
  const before = await g<{ spirits: number; buildings: number; shells: number; island: string }>(
    win,
    `(() => { const w = g.world(); return { spirits: Object.keys(w.characters.p1.spirits).length, buildings: Object.keys(w.homes.p1.buildings).length, shells: w.characters.p1.shells, island: w.players.p1.islandId }; })()`,
  );
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await win.locator('#modal .btn', { hasText: '存档并回到标题' }).click();
  await win.waitForTimeout(1500);
  await win.locator('.btn', { hasText: '继续：' }).first().click();
  await win.waitForTimeout(2500);
  const after = await g<typeof before>(
    win,
    `(() => { const w = g.world(); return { spirits: Object.keys(w.characters.p1.spirits).length, buildings: Object.keys(w.homes.p1.buildings).length, shells: w.characters.p1.shells, island: w.players.p1.islandId }; })()`,
  );
  expect(after).toEqual(before);
  expect(await g(win, 'g.mode()')).toBe('explore');
  await win.screenshot({ path: 'screenshots/16-loaded.png' });
  await app.close();
  console.log(errors.join('\n'));
  expect(errors).toEqual([]);
});
