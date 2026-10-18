import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerLlmIpc } from './llm';
import { registerNetIpc } from './net';
import { registerSaveIpc } from './saves';

// 开发时由 scripts/dev.mjs 注入；打包后加载本地文件
const devServerUrl = process.env['CLOUDSEA_DEV_SERVER_URL'];
/** 自动化测试：存档写到临时目录，并让页面打开测试钩子。 */
const testMode = process.env['CLOUDSEA_TEST'] === '1';
/** 场景直达（测试模式下）：CLOUDSEA_SCENE=swim 等，见 renderer/game/scenarios.ts。 */
const scene = process.env['CLOUDSEA_SCENE'];
if (testMode) app.setPath('userData', join(app.getPath('temp'), `cloudsea-test-${process.pid}`));
/** 同一台机器开两个窗口联机时，用不同的配置目录（CLOUDSEA_PROFILE=guest），存档互不干扰（M2）。 */
const profile = process.env['CLOUDSEA_PROFILE'];
if (profile && /^[a-z0-9-]{1,24}$/.test(profile)) app.setPath('userData', join(app.getPath('userData'), `profile-${profile}`));
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#f6d7b8',
    title: '云海拾灵',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.once('ready-to-show', () => win.show());

  // 外部链接交给系统浏览器，窗口内不允许跳转到别的站点
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!devServerUrl || !url.startsWith(devServerUrl)) event.preventDefault();
  });

  const query = new URLSearchParams();
  if (testMode) query.set('test', '1');
  if (testMode && scene) query.set('scene', scene);
  // 双窗口联机调试：预填加入地址 / 自动开房（scripts/duo.mjs）
  const autoJoin = process.env['CLOUDSEA_AUTOJOIN'];
  if (autoJoin) query.set('join', autoJoin);
  if (process.env['CLOUDSEA_AUTOHOST'] === '1') query.set('autohost', '1');
  if (process.env['CLOUDSEA_PORT']) query.set('port', process.env['CLOUDSEA_PORT']);
  if (profile) query.set('profile', profile);
  const search = query.toString();
  if (devServerUrl) {
    void win.loadURL(search ? `${devServerUrl}?${search}` : devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '..', 'dist', 'renderer', 'index.html'), search ? { search } : {});
  }
}

void app.whenReady().then(() => {
  registerSaveIpc();
  registerNetIpc(() => mainWindow);
  registerLlmIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
