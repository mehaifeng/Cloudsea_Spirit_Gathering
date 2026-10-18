import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  reporter: 'list',
  // 每个用例都开一到两个 Electron 窗口（联机用例两个），并发太多时动画和定时都会变慢、偶发超时
  workers: 2,
});
