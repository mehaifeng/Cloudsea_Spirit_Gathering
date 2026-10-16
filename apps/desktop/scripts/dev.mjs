// 开发模式：启动 Vite 开发服务器 → 编译主进程 → 启动 Electron 指向开发服务器。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { createServer } from 'vite';

const appDir = fileURLToPath(new URL('..', import.meta.url));

const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.mts', import.meta.url)) });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('vite dev server has no local url');

const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.main.json'], { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (tsc.status !== 0) {
  await server.close();
  process.exit(tsc.status ?? 1);
}

const electron = spawn(electronPath, ['.'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, CLOUDSEA_DEV_SERVER_URL: url },
});
electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
