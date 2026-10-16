import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// 截图冒烟测试：启动打包后的应用，确认窗口出现、场景就绪、没有报错，截图存到 screenshots/（不入库）
test('桌面壳启动并渲染占位场景', async () => {
  // 本包是 CommonJS（主进程需要），Playwright 按 CJS 转译测试文件，因此用 __dirname
  const appDir = resolve(__dirname, '..');
  const app = await electron.launch({ args: ['.'], cwd: appDir });
  const errors: string[] = [];

  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await expect(win).toHaveTitle('云海拾灵');
  await win.waitForSelector('body[data-ready="true"]');
  await expect(win.locator('#build-info')).toContainText('Electron');
  await win.waitForTimeout(1_000);
  await win.screenshot({ path: 'screenshots/smoke-placeholder.png' });

  expect(errors).toEqual([]);
  await app.close();
});
