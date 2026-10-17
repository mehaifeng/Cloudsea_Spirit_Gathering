import type { ClientMessage, ClientTransport, HostMessage, HostTransport } from '@cloudsea/net';

/**
 * 渲染进程这一侧的联机传输（M2）：经主进程的 IPC 收发 JSON 文本（主进程负责局域网 WebSocket 与 Steam P2P）。
 */
export interface NetBridge {
  hostOpen(port?: number): Promise<{ port: number; addresses: string[] }>;
  hostSend(connId: string, text: string): void;
  hostClose(): Promise<void>;
  joinLan(url: string): Promise<{ ok: boolean; error?: string }>;
  clientSend(text: string): void;
  clientClose(): Promise<void>;
  steamStatus(): Promise<{ available: boolean; error: string | null; name: string | null; appId: number }>;
  steamHost(): Promise<{ ok: boolean; lobbyId?: string; error?: string }>;
  steamInvite(): Promise<void>;
  joinSteam(lobbyId: string): Promise<{ ok: boolean; error?: string }>;
  on(channel: 'net:host-msg' | 'net:host-drop' | 'net:client-msg' | 'net:client-drop' | 'net:steam-join-request', handler: (...args: unknown[]) => void): () => void;
}

export function netBridge(): NetBridge | null {
  return (window as unknown as { cloudsea?: { net?: NetBridge } }).cloudsea?.net ?? null;
}

/** 房主：远程连接（局域网 / Steam）。 */
export function ipcHostTransport(net: NetBridge): HostTransport & { dispose(): void } {
  const msg = new Set<(connId: string, m: ClientMessage) => void>();
  const drop = new Set<(connId: string) => void>();
  const offs = [
    net.on('net:host-msg', (connId, text) => {
      let m: ClientMessage;
      try {
        m = JSON.parse(String(text)) as ClientMessage;
      } catch {
        return;
      }
      msg.forEach((h) => h(String(connId), m));
    }),
    net.on('net:host-drop', (connId) => drop.forEach((h) => h(String(connId)))),
  ];
  return {
    onMessage: (h) => {
      msg.add(h);
      return () => msg.delete(h);
    },
    onDisconnect: (h) => {
      drop.add(h);
      return () => drop.delete(h);
    },
    send: (connId, m) => net.hostSend(connId, JSON.stringify(m)),
    dispose: () => offs.forEach((o) => o()),
  };
}

/** 客人：到房主的一条连接。 */
export function ipcClientTransport(net: NetBridge): ClientTransport {
  const msg = new Set<(m: HostMessage) => void>();
  const close = new Set<(r: string) => void>();
  const offs = [
    net.on('net:client-msg', (text) => {
      try {
        const m = JSON.parse(String(text)) as HostMessage;
        msg.forEach((h) => h(m));
      } catch {
        /* 坏包忽略 */
      }
    }),
    net.on('net:client-drop', (reason) => close.forEach((h) => h(String(reason)))),
  ];
  return {
    send: (m) => net.clientSend(JSON.stringify(m)),
    onMessage: (h) => {
      msg.add(h);
      return () => msg.delete(h);
    },
    onClose: (h) => {
      close.add(h);
      return () => close.delete(h);
    },
    close: () => {
      offs.forEach((o) => o());
      void net.clientClose();
    },
  };
}

/** 把几个房主传输合成一个：本机连接（'local'）走 Loopback，其余走 IPC。 */
export function muxHost(local: HostTransport, remote: HostTransport): HostTransport {
  const pick = (connId: string) => (connId === 'local' ? local : remote);
  return {
    onMessage: (h) => {
      const a = local.onMessage(h);
      const b = remote.onMessage(h);
      return () => (a(), b());
    },
    onDisconnect: (h) => {
      const a = local.onDisconnect(h);
      const b = remote.onDisconnect(h);
      return () => (a(), b());
    },
    send: (connId, m) => pick(connId).send(connId, m),
  };
}

/** 一个“空”的远程传输：还没开放联机时用。之后可以接上真正的 IPC 传输。 */
export class SwitchableHost implements HostTransport {
  private inner: HostTransport | null = null;
  private readonly msg = new Set<(connId: string, m: ClientMessage) => void>();
  private readonly drop = new Set<(connId: string) => void>();
  private offs: Array<() => void> = [];

  attach(t: HostTransport): void {
    this.detach();
    this.inner = t;
    this.offs = [t.onMessage((c, m) => this.msg.forEach((h) => h(c, m))), t.onDisconnect((c) => this.drop.forEach((h) => h(c)))];
  }

  detach(): void {
    this.offs.forEach((o) => o());
    this.offs = [];
    this.inner = null;
  }

  onMessage(h: (connId: string, m: ClientMessage) => void): () => void {
    this.msg.add(h);
    return () => this.msg.delete(h);
  }

  onDisconnect(h: (connId: string) => void): () => void {
    this.drop.add(h);
    return () => this.drop.delete(h);
  }

  send(connId: string, m: HostMessage): void {
    this.inner?.send(connId, m);
  }
}
