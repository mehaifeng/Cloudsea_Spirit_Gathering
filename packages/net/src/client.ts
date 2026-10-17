import type { CharacterSaveFile, Intent, WorldEvent, WorldState } from '@cloudsea/sim';
import { applyPatch } from './diff';
import { PROTOCOL_VERSION } from './protocol';
import type { ClientTransport } from './transport';

/**
 * 客户端会话：只发意图，从不直接修改世界（铁律 4）。
 * 连上后打招呼（客人带上角色存档），房主回 welcome（本机玩家 id + 完整世界），之后按差量更新。
 */
export class ClientSession {
  private seq = 0;
  private readonly pending = new Map<number, (r: { ok: boolean; error?: string }) => void>();
  private snapshot: Readonly<WorldState> | null = null;
  private id: string | null;
  private readonly eventHandlers = new Set<(events: readonly WorldEvent[]) => void>();
  private readonly snapshotHandlers = new Set<(world: Readonly<WorldState>) => void>();
  private readonly welcomeHandlers = new Set<(playerId: string) => void>();
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private readonly unsub: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly transport: ClientTransport,
    hello: { playerId?: string; character?: CharacterSaveFile },
  ) {
    this.id = hello.playerId ?? null;
    this.unsub.push(
      transport.onMessage((msg) => {
        switch (msg.type) {
          case 'welcome':
            this.id = msg.playerId;
            this.setWorld(msg.world);
            this.welcomeHandlers.forEach((h) => h(msg.playerId));
            break;
          case 'reject':
            this.close(msg.reason);
            break;
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
            this.setWorld(msg.world);
            break;
          case 'delta':
            if (this.snapshot) this.setWorld(applyPatch(this.snapshot, msg.patch));
            break;
        }
      }),
    );
    this.unsub.push(transport.onClose((reason) => this.close(reason)));
    transport.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...hello });
  }

  private setWorld(w: Readonly<WorldState>): void {
    this.snapshot = w;
    this.snapshotHandlers.forEach((h) => h(w));
  }

  /** 本机玩家 id（welcome 之前可能还不知道）。 */
  get playerId(): string | null {
    return this.id;
  }

  get world(): Readonly<WorldState> | null {
    return this.snapshot;
  }

  request(intent: Intent): Promise<{ ok: boolean; error?: string }> {
    if (this.closed) return Promise.resolve({ ok: false, error: '和房主的连接已断开' });
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.transport.send({ type: 'intent', seq, intent });
    });
  }

  /** 不关心结果的意图（例如移动）。 */
  fire(intent: Intent): void {
    if (!this.closed) this.transport.send({ type: 'intent', seq: ++this.seq, intent });
  }

  onEvents(h: (events: readonly WorldEvent[]) => void): () => void {
    this.eventHandlers.add(h);
    return () => this.eventHandlers.delete(h);
  }

  onSnapshot(h: (world: Readonly<WorldState>) => void): () => void {
    this.snapshotHandlers.add(h);
    return () => this.snapshotHandlers.delete(h);
  }

  onWelcome(h: (playerId: string) => void): () => void {
    this.welcomeHandlers.add(h);
    return () => this.welcomeHandlers.delete(h);
  }

  /** 连接断开或被拒绝（reason 给玩家看）。 */
  onClose(h: (reason: string) => void): () => void {
    this.closeHandlers.add(h);
    return () => this.closeHandlers.delete(h);
  }

  private close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.pending.values()) cb({ ok: false, error: reason });
    this.pending.clear();
    this.closeHandlers.forEach((h) => h(reason));
  }

  /** 主动离开。 */
  leave(): void {
    if (this.closed) return;
    this.transport.send({ type: 'leave' });
    this.close('已离开');
    this.transport.close();
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
  }
}
