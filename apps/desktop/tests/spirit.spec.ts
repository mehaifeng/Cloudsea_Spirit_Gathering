import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';

/**
 * 灵性模式端到端（M3-4）：本地假 AI 服务 → 设置页填地址 / 模型 / key → 和阿禾说话看到“AI 生成”的话；
 * 并确认 key 不出现在渲染进程（页面、世界数据、本地存储）、存档文件和日志里（铁律 8）。
 */
const KEY = 'sk-e2e-VERY-SECRET-key-0042';

async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

async function waitFor(win: Page, expr: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await g<boolean>(win, expr).catch(() => false)) return;
    await win.waitForTimeout(100);
  }
  throw new Error(`等不到：${expr}`);
}

async function grepDir(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) hits.push(...(await grepDir(p, needle)));
    else if (st.size < 20_000_000 && (await readFile(p)).toString('utf8').includes(needle)) hits.push(p);
  }
  return hits;
}

test('灵性模式：设置、生成对话、key 不外泄', async () => {
  test.setTimeout(180_000);
  const seen: Array<{ auth: string; body: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ auth: String(req.headers['authorization'] ?? ''), body });
      const sys = (JSON.parse(body).messages?.[0]?.content as string) ?? '';
      const content = sys.includes('为今天选一件事') ? '{"goal":"farm","note":"把东头那块地翻一翻"}' : sys.includes('长期记忆') && sys.includes('合并') ? '{"summary":"认识了新来的守岛人。"}' : '{"text":"（假服务）今天的麦子长得真好，你也来看看？"}';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  const app = await electron.launch({ args: ['.'], cwd: resolve(__dirname, '..'), env: { ...process.env, CLOUDSEA_TEST: '1', CLOUDSEA_SCENE: 'home' } });
  const win = await app.firstWindow();
  const logs: string[] = [];
  const errors: string[] = [];
  win.on('console', (m) => {
    logs.push(m.text());
    if (m.type() === 'error') errors.push(m.text());
  });
  win.on('pageerror', (e) => errors.push(e.message));
  app.process().stdout?.on('data', (d) => logs.push(String(d)));
  app.process().stderr?.on('data', (d) => logs.push(String(d)));
  await win.setViewportSize({ width: 1280, height: 720 });
  await win.waitForSelector('body[data-scene="home"]', { timeout: 60_000 });

  try {
    // 设置页：填地址、模型、key，打开灵性模式
    await win.keyboard.press('Tab');
    await win.locator('#modal .btn', { hasText: '设置' }).click();
    await win.waitForSelector('#modal input[type="password"]');
    await win.locator('#modal input[placeholder="https://api.openai.com/v1"]').fill(`http://127.0.0.1:${port}/v1`);
    await win.locator('#modal input[placeholder="模型名"]').fill('fake-model');
    await win.locator('#modal input[type="password"]').fill(KEY);
    await win.locator('#modal .btn', { hasText: '打开灵性模式' }).click();
    await waitFor(win, `g.world().aiMode === 'spirit'`);
    await win.locator('#modal .btn', { hasText: '测试连接' }).click();
    await win.waitForTimeout(800);
    await win.screenshot({ path: 'screenshots/spirit-01-settings.png' });
    expect(await win.locator('#modal input[type="password"]').inputValue()).toBe('');
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
    await win.waitForSelector('#dialogue .gen-tag', { timeout: 20_000 });
    expect(await win.locator('#dialogue .line').textContent()).toContain('假服务');
    await win.waitForTimeout(300);
    await win.screenshot({ path: 'screenshots/spirit-02-generated-line.png' });
    expect(seen.some((s) => s.auth === `Bearer ${KEY}`)).toBe(true);

    // 屏蔽这句
    await win.locator('#dialogue .gen-block').click();
    await win.waitForTimeout(300);
    expect(await g<boolean>(win, 'g.dialogueOpen()')).toBe(false);

    // key 不在渲染进程里
    const html = await win.content();
    const worldJson = await g<string>(win, 'JSON.stringify(g.world())');
    const storage = await win.evaluate<string>('JSON.stringify({ ...localStorage })');
    for (const [what, text] of [['页面', html], ['世界数据', worldJson], ['本地存储', storage]] as const) expect(text, what).not.toContain(KEY);
    expect(await win.evaluate('Object.keys(window.cloudsea.llm).sort().join(",")')).toBe('chat,get,set,test');

    // 存档后：存档目录里没有 key；整个配置目录里只有加密的 key 文件
    await win.keyboard.press('Tab');
    await win.locator('#modal .btn', { hasText: '设置' }).click();
    await win.locator('#modal .btn', { hasText: '立即存档' }).click();
    await win.waitForTimeout(800);
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    expect(await grepDir(join(userData, 'saves'), KEY)).toEqual([]);
    expect(await grepDir(userData, KEY)).toEqual([]);
  } finally {
    await app.close();
    server.close();
  }
  expect(logs.join('\n')).not.toContain(KEY);
  expect(errors).toEqual([]);
});
