import { BrowserWindow, ipcMain } from 'electron';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * 联机传输（主进程，DESIGN 9.1，M2）：局域网 / 直连 IP（WebSocket）与 Steam 大厅 P2P。
 * 渲染进程里的房主 / 客户端会话只看到“连接 id + JSON 文本”，协议本身在 packages/net。
 *
 * 渲染 → 主：net:host-open / net:host-send / net:host-close / net:join-lan / net:client-send / net:client-close
 *            net:steam-status / net:steam-host / net:steam-invite / net:join-steam
 * 主 → 渲染：net:host-msg (connId, text) / net:host-drop (connId) / net:client-msg (text) / net:client-drop (reason)
 *            net:steam-join-request (lobbyId)
 */

/** Steam 暂用 Valve 的测试 App ID 480（决策 25；正式 App ID 到 M4 再换）。 */
export const STEAM_APP_ID = Number(process.env['CLOUDSEA_STEAM_APPID'] ?? 480);
export const DEFAULT_PORT = 47621;

type Win = () => BrowserWindow | null;

// ---------------------------------------------------------------- Steam（可选：没开 Steam 时禁用）

type SteamClient = ReturnType<typeof import('steamworks.js').init>;
let steam: SteamClient | null = null;

/** 其他主进程模块（成就、云存档）用的 Steam 客户端；没连上时是 null。 */
export function steamClient(): SteamClient | null {
  return steam;
}
let steamError: string | null = null;

function initSteam(win: Win): void {
  if (process.env['CLOUDSEA_TEST'] === '1') {
    steamError = '测试模式不连接 Steam';
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sw = require('steamworks.js') as typeof import('steamworks.js');
    steam = sw.init(STEAM_APP_ID);
    const cb = steam.callback;
    // steamworks.js 的回调枚举是 const enum（isolatedModules 下不能直接用），这里写数值：
    // 5 = LobbyChatUpdate，6 = P2PSessionRequest，8 = GameLobbyJoinRequested
    const on = <T>(id: number, h: (v: T) => void) => (cb.register as unknown as (id: number, h: (v: T) => void) => unknown)(id, h);
    const CB = { LobbyChatUpdate: 5, P2PSessionRequest: 6, GameLobbyJoinRequested: 8 } as const;
    // 好友邀请 / 从好友列表“加入游戏”
    on(CB.GameLobbyJoinRequested, (v: { lobby_steam_id: bigint }) => win()?.webContents.send('net:steam-join-request', v.lobby_steam_id.toString()));
    // 房主：接受大厅成员的 P2P 会话
    on(CB.P2PSessionRequest, (v: { remote: bigint }) => {
      if (steamLobby && steamLobby.getMembers().some((m) => m.steamId64 === v.remote)) steam?.networking.acceptP2PSession(v.remote);
    });
    on(CB.LobbyChatUpdate, (v: { user_changed: bigint; member_state_change: number }) => {
      // 成员离开大厅：当作断线
      if (hosting === 'steam' || steamLobby) {
        const id = `steam:${v.user_changed.toString()}`;
        if (v.member_state_change !== 1 /* Entered */) dropHostConn(win, id);
      }
    });
  } catch (e) {
    steam = null;
    steamError = `没有连上 Steam：${(e as Error).message.split('\n')[0]}（请先打开 Steam 并登录）`;
  }
}

type Lobby = Awaited<ReturnType<SteamClient['matchmaking']['createLobby']>>;
let steamLobby: Lobby | null = null;
let hosting: 'steam' | null = null;
/** 客人一侧：房主的 SteamID（P2P 收发对象）。 */
let steamHostId: bigint | null = null;

/** Steam 可靠包上限 1 MB：大消息切块（"#<id>/<i>/<n>|" 前缀），对端拼好再交给渲染进程。 */
const CHUNK = 900_000;
let chunkSeq = 0;
const partial = new Map<string, string[]>();

function steamSend(to: bigint, text: string): void {
  if (!steam) return;
  if (text.length <= CHUNK) {
    steam.networking.sendP2PPacket(to, 2 /* Reliable */, Buffer.from(text, 'utf8'));
    return;
  }
  const id = ++chunkSeq;
  const n = Math.ceil(text.length / CHUNK);
  for (let i = 0; i < n; i++) steam.networking.sendP2PPacket(to, 2, Buffer.from(`#${id}/${i}/${n}|${text.slice(i * CHUNK, (i + 1) * CHUNK)}`, 'utf8'));
}

function steamReceive(from: bigint, raw: string): string | null {
  if (!raw.startsWith('#')) return raw;
  const bar = raw.indexOf('|');
  const [id, i, n] = raw.slice(1, bar).split('/').map(Number) as [number, number, number];
  const key = `${from}:${id}`;
  const parts = partial.get(key) ?? new Array<string>(n);
  parts[i] = raw.slice(bar + 1);
  partial.set(key, parts);
  if (parts.filter((x) => x !== undefined).length < n) return null;
  partial.delete(key);
  return parts.join('');
}

function pumpSteam(win: Win): void {
  if (!steam) return;
  for (let size = steam.networking.isP2PPacketAvailable(); size > 0; size = steam.networking.isP2PPacketAvailable()) {
    const pkt = steam.networking.readP2PPacket(size);
    const text = steamReceive(pkt.steamId.steamId64, pkt.data.toString('utf8'));
    if (text === null) continue;
    if (steamHostId !== null && pkt.steamId.steamId64 === steamHostId) win()?.webContents.send('net:client-msg', text);
    else if (hosting === 'steam') win()?.webContents.send('net:host-msg', `steam:${pkt.steamId.steamId64.toString()}`, text);
  }
}

// ---------------------------------------------------------------- 局域网（WebSocket）

let server: WebSocketServer | null = null;
const lanConns = new Map<string, WebSocket>();
let lanSeq = 0;
let client: WebSocket | null = null;

function dropHostConn(win: Win, connId: string): void {
  const ws = lanConns.get(connId);
  if (ws) {
    lanConns.delete(connId);
    ws.close();
  }
  win()?.webContents.send('net:host-drop', connId);
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

export function registerNetIpc(win: Win): void {
  initSteam(win);
  const timer = setInterval(() => pumpSteam(win), 16);
  timer.unref();

  // ---------- 房主
  ipcMain.handle('net:host-open', async (_e, port?: number): Promise<{ port: number; addresses: string[] }> => {
    if (server) return { port: (server.address() as { port: number }).port, addresses: lanAddresses() };
    const want = port ?? DEFAULT_PORT;
    server = await new Promise<WebSocketServer>((resolve, reject) => {
      const s = new WebSocketServer({ port: want, maxPayload: 64 * 1024 * 1024 });
      s.once('listening', () => resolve(s));
      s.once('error', reject);
    });
    server.on('connection', (ws) => {
      const id = `lan:${++lanSeq}`;
      lanConns.set(id, ws);
      ws.on('message', (data) => win()?.webContents.send('net:host-msg', id, data.toString()));
      ws.on('close', () => {
        if (lanConns.delete(id)) win()?.webContents.send('net:host-drop', id);
      });
    });
    return { port: (server.address() as { port: number }).port, addresses: lanAddresses() };
  });
  ipcMain.on('net:host-send', (_e, connId: string, text: string) => {
    if (connId.startsWith('lan:')) lanConns.get(connId)?.send(text);
    else if (connId.startsWith('steam:')) steamSend(BigInt(connId.slice(6)), text);
  });
  ipcMain.handle('net:host-close', async () => {
    for (const ws of lanConns.values()) ws.close();
    lanConns.clear();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
    steamLobby?.leave();
    steamLobby = null;
    hosting = null;
  });

  // ---------- 客人（局域网）
  ipcMain.handle('net:join-lan', async (_e, url: string): Promise<{ ok: boolean; error?: string }> => {
    client?.close();
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { maxPayload: 64 * 1024 * 1024, handshakeTimeout: 5000 });
      let opened = false;
      ws.on('open', () => {
        opened = true;
        client = ws;
        resolve({ ok: true });
      });
      ws.on('message', (data) => win()?.webContents.send('net:client-msg', data.toString()));
      ws.on('close', () => {
        if (client === ws) {
          client = null;
          win()?.webContents.send('net:client-drop', '和房主的连接断开了');
        }
      });
      ws.on('error', (err) => {
        if (!opened) resolve({ ok: false, error: `连不上 ${url}：${err.message}` });
      });
    });
  });
  ipcMain.on('net:client-send', (_e, text: string) => {
    if (client) client.send(text);
    else if (steamHostId !== null) steamSend(steamHostId, text);
  });
  ipcMain.handle('net:client-close', async () => {
    client?.close();
    client = null;
    if (steamHostId !== null) {
      steamLobby?.leave();
      steamLobby = null;
      steamHostId = null;
    }
  });

  // ---------- Steam
  ipcMain.handle('net:steam-status', async () => ({ available: !!steam, error: steamError, name: steam ? steam.localplayer.getName() : null, appId: STEAM_APP_ID }));
  ipcMain.handle('net:steam-host', async (): Promise<{ ok: boolean; lobbyId?: string; error?: string }> => {
    if (!steam) return { ok: false, error: steamError ?? 'Steam 不可用' };
    if (!steamLobby) {
      steamLobby = await steam.matchmaking.createLobby(1 /* FriendsOnly */, 4);
      steamLobby.setData('cloudsea', '1');
      hosting = 'steam';
    }
    return { ok: true, lobbyId: steamLobby.id.toString() };
  });
  ipcMain.handle('net:steam-invite', async () => {
    if (steam && steamLobby) steam.overlay.activateInviteDialog(steamLobby.id);
  });
  ipcMain.handle('net:join-steam', async (_e, lobbyId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!steam) return { ok: false, error: steamError ?? 'Steam 不可用' };
    try {
      steamLobby = await steam.matchmaking.joinLobby(BigInt(lobbyId));
      steamHostId = steamLobby.getOwner().steamId64;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `进不了这个大厅：${(e as Error).message}` };
    }
  });
}
