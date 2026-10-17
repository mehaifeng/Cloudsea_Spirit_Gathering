import type { ClientMessage, HostMessage } from './protocol';

/** 客户端一侧：发意图、收房主消息、知道连接断了。 */
export interface ClientTransport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: HostMessage) => void): () => void;
  onClose(handler: (reason: string) => void): () => void;
  close(): void;
}

/**
 * 房主一侧：按“连接”收发（连接建立时还不知道是哪位玩家，打招呼后才知道）。
 * 实现：Loopback（同进程）、局域网 WebSocket、Steam P2P——都在这层之下，协议相同。
 */
export interface HostTransport {
  onMessage(handler: (connId: string, msg: ClientMessage) => void): () => void;
  onDisconnect(handler: (connId: string) => void): () => void;
  send(connId: string, msg: HostMessage): void;
}

/**
 * 同进程的“集线器”：一个房主传输 + 任意多个客户端传输（单人模式与测试用）。
 * 消息同步传递；单人模式 = 0 个客人的房主（铁律 3），走的仍是同一套握手 / 意图 / 差量路径。
 */
export function createHub(): { host: HostTransport; connect(connId: string): ClientTransport; disconnect(connId: string): void } {
  const hostHandlers = new Set<(connId: string, msg: ClientMessage) => void>();
  const disconnectHandlers = new Set<(connId: string) => void>();
  const clients = new Map<string, { onMsg: Set<(m: HostMessage) => void>; onClose: Set<(r: string) => void> }>();
  const disconnect = (connId: string) => {
    const c = clients.get(connId);
    if (!c) return;
    clients.delete(connId);
    disconnectHandlers.forEach((h) => h(connId));
    c.onClose.forEach((h) => h('连接已断开'));
  };
  return {
    host: {
      onMessage: (h) => {
        hostHandlers.add(h);
        return () => hostHandlers.delete(h);
      },
      onDisconnect: (h) => {
        disconnectHandlers.add(h);
        return () => disconnectHandlers.delete(h);
      },
      send: (connId, msg) => clients.get(connId)?.onMsg.forEach((h) => h(msg)),
    },
    connect(connId) {
      const entry = { onMsg: new Set<(m: HostMessage) => void>(), onClose: new Set<(r: string) => void>() };
      clients.set(connId, entry);
      return {
        send: (msg) => {
          if (clients.get(connId) === entry) hostHandlers.forEach((h) => h(connId, msg));
        },
        onMessage: (h) => {
          entry.onMsg.add(h);
          return () => entry.onMsg.delete(h);
        },
        onClose: (h) => {
          entry.onClose.add(h);
          return () => entry.onClose.delete(h);
        },
        close: () => disconnect(connId),
      };
    },
    disconnect,
  };
}

/** 单人：一个本机连接。 */
export function createLoopback(): { client: ClientTransport; host: HostTransport; hub: ReturnType<typeof createHub> } {
  const hub = createHub();
  return { client: hub.connect('local'), host: hub.host, hub };
}
