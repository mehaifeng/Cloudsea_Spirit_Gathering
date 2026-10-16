import type { ContentDb } from '@cloudsea/content';
import { advanceWorld, applyIntent, TICKS_PER_SECOND, type WorldEvent, type WorldState } from '@cloudsea/sim';
import type { HostTransport } from './transport';

/** 房主以固定步长推进 sim：每步 1 tick。 */
const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
/** 一帧最多补算的 tick，防止卡顿后一次性跑太多。 */
const MAX_TICKS_PER_UPDATE = 50;

/**
 * 房主会话（铁律 4）：唯一可以修改世界状态的地方。
 * 收到意图 → 校验并执行 → 回复结果、广播事件；update() 推进时间并广播快照。
 */
export class HostSession {
  private acc = 0;
  private readonly unsubscribe: () => void;

  constructor(
    readonly content: ContentDb,
    readonly world: WorldState,
    private readonly transport: HostTransport,
    /** 每次世界推进或意图执行后调用（例如自动存档检查）。 */
    private readonly onEvents?: (events: readonly WorldEvent[]) => void,
  ) {
    this.unsubscribe = transport.onMessage((playerId, msg) => {
      if (msg.type !== 'intent') return;
      const r = applyIntent(content, world, playerId, msg.intent);
      transport.send(playerId, { type: 'result', seq: msg.seq, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
      if (r.events.length > 0) this.emit(r.events);
      transport.broadcast({ type: 'snapshot', world });
    });
  }

  /** 按真实流逝的毫秒推进。 */
  update(realMs: number): void {
    this.acc += realMs;
    let ticks = Math.floor(this.acc / MS_PER_TICK);
    if (ticks <= 0) return;
    this.acc -= ticks * MS_PER_TICK;
    ticks = Math.min(ticks, MAX_TICKS_PER_UPDATE);
    const events = advanceWorld(this.content, this.world, ticks);
    if (events.length > 0) this.emit(events);
    this.transport.broadcast({ type: 'snapshot', world: this.world });
  }

  private emit(events: readonly WorldEvent[]): void {
    this.transport.broadcast({ type: 'events', events });
    this.onEvents?.(events);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
