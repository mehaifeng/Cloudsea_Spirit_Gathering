import type { Intent, WorldEvent, WorldState } from '@cloudsea/sim';
import type { ClientTransport } from './transport';

/**
 * 客户端会话：只发意图，从不直接修改世界（铁律 4）。
 * request() 返回房主的处理结果，界面据此提示成功或失败原因。
 */
export class ClientSession {
  private seq = 0;
  private readonly pending = new Map<number, (r: { ok: boolean; error?: string }) => void>();
  private snapshot: Readonly<WorldState> | null = null;
  private readonly eventHandlers = new Set<(events: readonly WorldEvent[]) => void>();
  private readonly snapshotHandlers = new Set<(world: Readonly<WorldState>) => void>();
  private readonly unsubscribe: () => void;

  constructor(
    readonly playerId: string,
    private readonly transport: ClientTransport,
  ) {
    this.unsubscribe = transport.onMessage((msg) => {
      switch (msg.type) {
        case 'result': {
          const cb = this.pending.get(msg.seq);
          this.pending.delete(msg.seq);
          cb?.({ ok: msg.ok, ...(msg.error ? { error: msg.error } : {}) });
          break;
        }
        case 'events':
          this.eventHandlers.forEach((h) => h(msg.events));
          break;
        case 'snapshot':
          this.snapshot = msg.world;
          this.snapshotHandlers.forEach((h) => h(msg.world));
          break;
      }
    });
    transport.send({ type: 'hello', playerId });
  }

  get world(): Readonly<WorldState> | null {
    return this.snapshot;
  }

  request(intent: Intent): Promise<{ ok: boolean; error?: string }> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.transport.send({ type: 'intent', seq, intent });
    });
  }

  /** 不关心结果的意图（例如移动）。 */
  fire(intent: Intent): void {
    this.transport.send({ type: 'intent', seq: ++this.seq, intent });
  }

  onEvents(h: (events: readonly WorldEvent[]) => void): () => void {
    this.eventHandlers.add(h);
    return () => this.eventHandlers.delete(h);
  }

  onSnapshot(h: (world: Readonly<WorldState>) => void): () => void {
    this.snapshotHandlers.add(h);
    return () => this.snapshotHandlers.delete(h);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
