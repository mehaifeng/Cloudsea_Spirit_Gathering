import { getContent, type ContentDb } from '@cloudsea/content';
import { ClientSession, createLoopback, HostSession } from '@cloudsea/net';
import {
  createCharacter,
  createWorld,
  joinWorld,
  loadCharacter,
  loadWorld,
  saveWorld,
  type WorldEvent,
  type WorldState,
} from '@cloudsea/sim';
import { saveBackend } from './saves';

export const PLAYER_ID = 'p1';
const AUTOSAVE_MS = 60_000;

/**
 * 一局游戏：本机房主 + 本机客户端，经 Loopback 连接（单人 = 0 个客人的房主，铁律 3）。
 * 界面只通过 client 发意图、读快照。
 */
export class GameSession {
  readonly content: ContentDb = getContent();
  readonly host: HostSession;
  readonly client: ClientSession;
  private sinceSave = 0;
  private saving = false;

  private constructor(
    readonly slot: string,
    private readonly world: WorldState,
  ) {
    const { client, host } = createLoopback(PLAYER_ID);
    this.host = new HostSession(this.content, world, host, (events) => this.onHostEvents(events));
    this.client = new ClientSession(PLAYER_ID, client);
    // 先推一次快照
    this.host.broadcastSnapshot();
  }

  static create(name: string, seed?: number): GameSession {
    seed ??= (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const content = getContent();
    const world = createWorld(content, { seed, hostId: PLAYER_ID });
    joinWorld(world, createCharacter(content, { id: PLAYER_ID, name: name.trim().slice(0, 16) || '守岛人' }));
    return new GameSession(`world-${seed.toString(36)}`, world);
  }

  static async load(slot: string): Promise<GameSession> {
    const data = await saveBackend().read(slot);
    if (!data) throw new Error('找不到存档');
    const world = loadWorld(JSON.parse(data.world));
    for (const c of data.characters) joinWorld(world, loadCharacter(JSON.parse(c)));
    if (!world.characters[PLAYER_ID]) throw new Error('存档里没有本机角色');
    return new GameSession(slot, world);
  }

  update(ms: number): void {
    this.host.update(ms);
    this.sinceSave += ms;
    if (this.sinceSave >= AUTOSAVE_MS) void this.save();
  }

  private onHostEvents(events: readonly WorldEvent[]): void {
    // 每个游戏日开始时自动存档（DESIGN 9.4）
    if (events.some((e) => e.t === 'dayStart') && this.world.tick > 100) void this.save();
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.sinceSave = 0;
    try {
      const s = saveWorld(this.world);
      await saveBackend().write(
        this.slot,
        JSON.stringify(s.world),
        s.characters.map((c) => ({ id: c.character.id, data: JSON.stringify(c) })),
      );
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    this.host.dispose();
    this.client.dispose();
  }
}
