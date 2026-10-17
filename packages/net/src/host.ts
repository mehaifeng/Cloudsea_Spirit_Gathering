import type { ContentDb } from '@cloudsea/content';
import { advanceWorld, applyIntent, joinWorld, loadCharacter, playerLeaves, TICKS_PER_SECOND, type CharacterState, type WorldEvent, type WorldState } from '@cloudsea/sim';
import { diff } from './diff';
import { PROTOCOL_VERSION, type ClientMessage, type HostMessage } from './protocol';
import type { HostTransport } from './transport';

/** 房主以固定步长推进 sim：每步 1 tick。 */
const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
/** 一帧最多补算的 tick，防止卡顿后一次性跑太多。 */
const MAX_TICKS_PER_UPDATE = 50;
/** 最多 4 人（DESIGN 9.1）。 */
export const MAX_PLAYERS = 4;

interface Conn {
  playerId: string | null;
  /** 这位客人最后收到的世界（JSON 副本）；差量相对它计算。 */
  sent: unknown;
}

/**
 * 房主会话（铁律 4）：唯一可以修改世界状态的地方。
 * 连接打招呼 → 加入世界、回一份完整世界；之后收到意图 → 校验执行 → 回结果、广播事件；
 * 每次世界变化后给每个连接发差量（DESIGN 9.1，M2）。
 */
export class HostSession {
  private acc = 0;
  private readonly conns = new Map<string, Conn>();
  private readonly unsub: Array<() => void> = [];

  constructor(
    readonly content: ContentDb,
    readonly world: WorldState,
    private readonly transport: HostTransport,
    /** 每次世界推进或意图执行后调用（例如自动存档检查）。 */
    private readonly onEvents?: (events: readonly WorldEvent[]) => void,
  ) {
    this.unsub.push(transport.onMessage((connId, msg) => this.onMessage(connId, msg)));
    this.unsub.push(transport.onDisconnect((connId) => this.onDisconnect(connId)));
  }

  /** 在线玩家（已打过招呼的连接）。 */
  get players(): string[] {
    return [...this.conns.values()].map((c) => c.playerId).filter((x): x is string => !!x);
  }

  private onMessage(connId: string, msg: ClientMessage): void {
    let conn = this.conns.get(connId);
    if (!conn) {
      conn = { playerId: null, sent: null };
      this.conns.set(connId, conn);
    }
    if (msg.type === 'hello') return this.hello(connId, conn, msg);
    if (!conn.playerId) return;
    if (msg.type === 'leave') return this.onDisconnect(connId);
    if (msg.type !== 'intent') return;
    const r = applyIntent(this.content, this.world, conn.playerId, msg.intent);
    this.transport.send(connId, { type: 'result', seq: msg.seq, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    if (r.events.length > 0) this.emit(r.events);
    this.sendDeltas();
  }

  private hello(connId: string, conn: Conn, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    const reject = (reason: string) => {
      this.transport.send(connId, { type: 'reject', reason });
      this.conns.delete(connId);
    };
    if (msg.protocol !== PROTOCOL_VERSION) return reject(`版本不一致（房主 ${PROTOCOL_VERSION}，你 ${msg.protocol}），请更新到同一版本`);
    let playerId: string;
    if (msg.character) {
      if (this.players.length >= MAX_PLAYERS) return reject(`房间满了（最多 ${MAX_PLAYERS} 人）`);
      let c: CharacterState;
      try {
        c = loadCharacter(msg.character);
      } catch (e) {
        return reject(`角色存档读不出来：${(e as Error).message}`);
      }
      // 角色 id 和在线的人撞了（例如两边都是旧版存档的 p1）：换一个新 id，客人以后就用新 id 保存
      if (this.world.characters[c.id]) c = renameCharacter(c, freshId(this.world, c));
      joinWorld(this.world, c);
      playerId = c.id;
      this.emit([{ t: 'playerJoined', playerId, name: c.name }]);
    } else {
      if (!msg.playerId || !this.world.characters[msg.playerId]) return reject('找不到这位玩家');
      playerId = msg.playerId;
    }
    conn.playerId = playerId;
    const world = this.copy();
    conn.sent = world;
    this.transport.send(connId, { type: 'welcome', playerId, world: world as WorldState });
    this.sendDeltas();
  }

  private onDisconnect(connId: string): void {
    const conn = this.conns.get(connId);
    this.conns.delete(connId);
    if (!conn?.playerId || conn.playerId === this.world.hostId) return;
    const events: WorldEvent[] = [];
    playerLeaves(this.content, this.world, conn.playerId, events);
    if (events.length) this.emit(events);
    this.sendDeltas();
  }

  private copy(): unknown {
    return JSON.parse(JSON.stringify(this.world));
  }

  /** 给每个已加入的连接发差量（没变就不发）。 */
  sendDeltas(): void {
    let cur: unknown = null;
    for (const [connId, conn] of this.conns) {
      if (!conn.playerId) continue;
      cur ??= this.copy();
      const patch = diff(conn.sent, cur);
      if (patch.length === 0) continue;
      conn.sent = cur;
      this.transport.send(connId, { type: 'delta', patch });
    }
  }

  /** 兼容：给所有连接推完整快照。 */
  broadcastSnapshot(): void {
    const world = this.copy();
    for (const [connId, conn] of this.conns) {
      if (!conn.playerId) continue;
      conn.sent = world;
      this.transport.send(connId, { type: 'snapshot', world: world as WorldState });
    }
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
    this.sendDeltas();
  }

  private emit(events: readonly WorldEvent[]): void {
    const msg: HostMessage = { type: 'events', events };
    for (const [connId, conn] of this.conns) if (conn.playerId) this.transport.send(connId, msg);
    this.onEvents?.(events);
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
  }
}

/** 撞 id 时给客人的新 id（确定性：按名字与世界里的人数）。 */
function freshId(world: WorldState, c: CharacterState): string {
  for (let i = 2; ; i++) {
    const id = `${c.id}x${i}`;
    if (!world.characters[id] && !world.homes[id]) return id;
  }
}

/** 改角色 id：絮灵的主人一起改（絮灵 id 只是字符串，不必改）。 */
function renameCharacter(c: CharacterState, id: string): CharacterState {
  const spirits = Object.fromEntries(Object.entries(c.spirits).map(([sid, s]) => [sid, { ...s, ownerId: id }]));
  return { ...c, id, spirits };
}
