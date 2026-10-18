// 把 build/icon.svg 渲染成 512×512 的 build/icon.png（M4-4，图标也由代码生成）。
// 用法：pnpm --filter @cloudsea/desktop icon（用 Electron 自带的浏览器离屏渲染，不需要别的工具）
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, '../build/icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  writeFileSync(join(__dirname, '../build/icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  app.quit();
});
