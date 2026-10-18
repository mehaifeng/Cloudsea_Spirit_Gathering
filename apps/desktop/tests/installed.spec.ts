import { _electron as electron, expect, test } from '@playwright/test';

/**
 * 安装后的游戏能启动、能开新游戏（M4-4，验收清单第 8 条的自动化部分）。
 * 只在指定了安装好的可执行文件时运行：CLOUDSEA_INSTALLED_EXE=…/Cloudsea Spirit Gathering.exe
 * CI 的 Windows 任务里：静默安装 → 跑这个测试 → 静默卸载。
 */
const exe = process.env['CLOUDSEA_INSTALLED_EXE'];

test('安装好的游戏：标题画面、版本号、开始新游戏', async () => {
  test.skip(!exe, '没有指定 CLOUDSEA_INSTALLED_EXE');
  test.setTimeout(120_000);
  const app = await electron.launch({ executablePath: exe!, args: [], env: { ...process.env, CLOUDSEA_TEST: '1' } });
  const errors: string[] = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(win.locator('#title .sub')).toContainText('v0.1.0');
  await win.getByText('开始新的旅程').click();
  await win.waitForFunction('["cutscene", "explore"].includes(window.__game?.mode())', null, { timeout: 60_000 });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: 'screenshots/installed-01-new-game.png' });
  expect(errors).toEqual([]);
  await app.close();
});
