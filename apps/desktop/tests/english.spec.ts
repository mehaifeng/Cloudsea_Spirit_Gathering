import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * 英文界面（M4-3）：CLOUDSEA_LANG=en 启动，逐个画面检查看得见的界面文本里没有残留中文
 * （玩家名字、语言按钮“中文”除外），并截图 screenshots/en-*.png。
 */
async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

async function launch(scene: string | null) {
  const env: Record<string, string> = { ...process.env, CLOUDSEA_TEST: '1', CLOUDSEA_LANG: 'en' } as Record<string, string>;
  if (scene) env['CLOUDSEA_SCENE'] = scene;
  const app = await electron.launch({ args: ['.'], cwd: resolve(__dirname, '..'), env });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1280, height: 720 });
  if (scene) await win.waitForSelector(`body[data-scene="${scene}"]`, { timeout: 60_000 });
  else await win.waitForSelector('#title');
  return { app, win, errors };
}

/** 看得见的界面文字里还有没有中文（允许的例外：玩家名、“中文”按钮）。 */
async function leftovers(win: Page): Promise<string[]> {
  const text = await win.evaluate<string>(`(() => {
    const out = [];
    const walk = (el) => {
      if (el.nodeType === 3) { if (el.parentElement && el.parentElement.offsetParent !== null) out.push(el.textContent); return; }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      for (const c of el.childNodes) walk(c);
    };
    walk(document.querySelector('#ui'));
    return out.join('\\n');
  })()`);
  return text
    .split('\n')
    .map((l) => l.replace(/小禾|中文/g, ''))
    .filter((l) => /[一-鿿]/.test(l));
}

test('英文界面：标题、探索、菜单、星图、对话、战斗都没有残留中文', async () => {
  test.setTimeout(240_000);
  const found: string[] = [];
  {
    const { app, win } = await launch(null);
    await win.waitForTimeout(500);
    await win.screenshot({ path: 'screenshots/en-01-title.png' });
    found.push(...(await leftovers(win)));
    await app.close();
  }
  {
    const { app, win, errors } = await launch('chart');
    await win.waitForTimeout(800);
    await win.screenshot({ path: 'screenshots/en-02-home.png' });
    found.push(...(await leftovers(win)));
    for (const tab of ['Spirits', 'Bag', 'Codex', 'Achievements', 'Orders', 'Share', 'Settings']) {
      await win.keyboard.press('Tab');
      await win.waitForTimeout(150);
      const btn = win.locator('#modal .tabs .btn', { hasText: tab });
      if (await btn.count()) await btn.first().click();
      await win.waitForTimeout(200);
      if (tab === 'Spirits' || tab === 'Settings') await win.screenshot({ path: `screenshots/en-03-menu-${tab.toLowerCase()}.png` });
      found.push(...(await leftovers(win)).map((l) => `[${tab}] ${l}`));
      await win.keyboard.press('Escape');
      await win.waitForTimeout(150);
    }
    await win.keyboard.press('KeyM');
    await win.waitForTimeout(300);
    await win.screenshot({ path: 'screenshots/en-04-chart.png' });
    found.push(...(await leftovers(win)).map((l) => `[chart] ${l}`));
    await win.keyboard.press('Escape');
    // 去禾田屿和阿禾说话
    expect(await g<boolean>(win, `g.sail('heFarm')`)).toBe(true);
    for (let i = 0; i < 400; i++) {
      if (await g<boolean>(win, `g.mode() === 'explore' && g.world().players.p1.islandId === 'heFarm'`)) break;
      if ((await g<string>(win, 'g.mode()')) === 'voyage') await g(win, 'g.fastForward(200)');
      await win.waitForTimeout(100);
    }
    await g(win, 'g.skipCutscene()');
    for (let i = 0; i < 10 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.keyboard.press('Enter');
    await g(win, `g.act({ type: 'talk', keeperId: 'aHe' })`);
    await win.waitForTimeout(400);
    await win.screenshot({ path: 'screenshots/en-05-dialogue.png' });
    found.push(...(await leftovers(win)).map((l) => `[dialogue] ${l}`));
    await app.close();
    expect(errors).toEqual([]);
  }
  {
    const { app, win, errors } = await launch('wild');
    await win.waitForTimeout(1800);
    await win.screenshot({ path: 'screenshots/en-06-battle.png' });
    found.push(...(await leftovers(win)).map((l) => `[battle] ${l}`));
    const btn = win.locator('#battle-ui .btn:not([aria-disabled="true"])').first();
    await btn.hover();
    await win.waitForTimeout(200);
    found.push(...(await leftovers(win)).map((l) => `[battle-tip] ${l}`));
    await btn.click();
    await win.waitForTimeout(3500);
    await win.screenshot({ path: 'screenshots/en-07-battle-turn.png' });
    found.push(...(await leftovers(win)).map((l) => `[battle-turn] ${l}`));
    await app.close();
    expect(errors).toEqual([]);
  }
  expect([...new Set(found)]).toEqual([]);
});
