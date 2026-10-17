// 同一台电脑上开两个窗口联机（M2 验收用）：一个房主（自动开新游戏并开放局域网），一个客人（预填加入地址）。
// 两个窗口用不同的配置目录（CLOUDSEA_PROFILE），存档互不干扰。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { createServer } from 'vite';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.CLOUDSEA_PORT ?? '47621';

// 用自己的端口，和同时开着的 pnpm dev（5173）互不影响；被占时 Vite 会自动往后找
const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.mts', import.meta.url)), server: { port: 5183, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('vite dev server has no local url');

const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.main.json'], { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (tsc.status !== 0) {
  await server.close();
  process.exit(tsc.status ?? 1);
}

const launch = (env) => spawn(electronPath, ['.'], { cwd: appDir, stdio: 'inherit', env: { ...process.env, CLOUDSEA_DEV_SERVER_URL: url, CLOUDSEA_PORT: port, ...env } });
const host = launch({ CLOUDSEA_PROFILE: 'host', CLOUDSEA_AUTOHOST: '1' });
// 稍等房主开好局域网再开客人窗口
await new Promise((r) => setTimeout(r, 2500));
const guest = launch({ CLOUDSEA_PROFILE: 'guest', CLOUDSEA_AUTOJOIN: `127.0.0.1:${port}` });

let alive = 2;
const done = async () => {
  if (--alive > 0) return;
  await server.close();
  process.exit(0);
};
host.on('exit', done);
guest.on('exit', done);
