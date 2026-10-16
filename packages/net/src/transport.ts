import type { ClientMessage, HostMessage } from './protocol';

/** 客户端一侧：发意图、收房主消息。 */
export interface ClientTransport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: HostMessage) => void): () => void;
}

/** 房主一侧：收各玩家的消息、向某个玩家或全体发消息。 */
export interface HostTransport {
  onMessage(handler: (playerId: string, msg: ClientMessage) => void): () => void;
  send(playerId: string, msg: HostMessage): void;
  broadcast(msg: HostMessage): void;
}

/**
 * Loopback：单人模式 = 0 个客人的房主（铁律 3）。
 * 消息同步传递，客户端和房主在同一进程里，走的仍是同一套意图 / 事件路径。
 */
export function createLoopback(playerId: string): { client: ClientTransport; host: HostTransport } {
  const toHost = new Set<(playerId: string, msg: ClientMessage) => void>();
  const toClient = new Set<(msg: HostMessage) => void>();
  return {
    client: {
      send: (msg) => toHost.forEach((h) => h(playerId, msg)),
      onMessage: (h) => {
        toClient.add(h);
        return () => toClient.delete(h);
      },
    },
    host: {
      onMessage: (h) => {
        toHost.add(h);
        return () => toHost.delete(h);
      },
      send: (id, msg) => {
        if (id === playerId) toClient.forEach((h) => h(msg));
      },
      broadcast: (msg) => toClient.forEach((h) => h(msg)),
    },
  };
}
