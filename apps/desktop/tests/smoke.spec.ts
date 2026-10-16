import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// 快速冒烟：应用启动、标题画面就绪、没有报错
test('桌面壳启动并显示标题画面', async () => {
  const appDir = resolve(__dirname, '..');
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, CLOUDSEA_TEST: '1' } });
  const errors: string[] = [];
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await expect(win).toHaveTitle('云海拾灵');
  await win.waitForSelector('body[data-ready="true"]');
  await expect(win.getByText('开始新的旅程')).toBeVisible();
  await win.waitForTimeout(800);
  await win.screenshot({ path: 'screenshots/00-smoke-title.png' });
  expect(errors).toEqual([]);
  await app.close();
});
