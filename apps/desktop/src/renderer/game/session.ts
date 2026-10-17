import { getContent, type ContentDb } from '@cloudsea/content';
import { ClientSession, createHub, HostSession, type ClientTransport } from '@cloudsea/net';
import {
  createCharacter,
  createWorld,
  joinWorld,
  loadCharacter,
  loadWorld,
  saveCharacter,
  saveWorld,
  type CharacterState,
  type WorldEvent,
  type WorldState,
} from '@cloudsea/sim';
import { ipcHostTransport, muxHost, netBridge, SwitchableHost } from './netTransports';
import { saveBackend } from './saves';

/**
 * 本机玩家的角色 id。单人 / 房主的新游戏是 'p1'；作为客人加入时由房主在 welcome 里给出（M2）。
 * 用 let 导出：各模块拿到的是活绑定，切换会话后自动跟着变。
 */
export let PLAYER_ID = 'p1';

export function setLocalPlayer(id: string): void {
  PLAYER_ID = id;
}

const AUTOSAVE_MS = 60_000;

/** 角色存档的本机存储（客人自己的角色，DESIGN 9.3）。 */
interface CharacterStore {
  list(): Promise<Array<{ id: string; data: string; modified: number }>>;
  write(id: string, data: string): Promise<void>;
}

export function characterStore(): CharacterStore {
  const bridge = (window as unknown as { cloudsea?: { characters?: CharacterStore } }).cloudsea?.characters;
  if (bridge) return bridge;
  const KEY = 'cloudsea.characters';
  const all = (): Record<string, { data: string; modified: number }> => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
  };
  return {
    list: async () => Object.entries(all()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.modified - a.modified),
    write: async (id, data) => {
      const v = all();
      v[id] = { data, modified: Date.now() };
      try {
        localStorage.setItem(KEY, JSON.stringify(v));
      } catch {
        /* 试玩版不保证 */
      }
    },
  };
}

/** 新角色的 id：客人一侧生成，尽量不和别人撞（撞了房主也会改，M2）。 */
export function newCharacterId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`;
}

/**
 * 一局游戏（M2）：
 * - 房主：本机房主 + 本机客户端（Loopback），可以“开放联机”接上局域网 / Steam 的客人；
 * - 客人：只有客户端，世界来自房主；只保存自己的角色（DESIGN 9.3）。
 * 单人 = 0 个客人的房主（铁律 3）。界面只通过 client 发意图、读世界。
 */
export class GameSession {
  readonly content: ContentDb = getContent();
  readonly host: HostSession | null;
  readonly client: ClientSession;
  readonly role: 'host' | 'guest';
  private readonly remote = new SwitchableHost();
  private remoteDispose: (() => void) | null = null;
  private sinceSave = 0;
  private saving = false;
  /** 房主开放的局域网地址（开放后才有）。 */
  lan: { port: number; addresses: string[] } | null = null;
  steamLobby: string | null = null;

  private constructor(
    readonly slot: string,
    private readonly world: WorldState | null,
    client?: ClientSession,
  ) {
    if (world) {
      this.role = 'host';
      const hub = createHub();
      this.host = new HostSession(this.content, world, muxHost(hub.host, this.remote), (events) => this.onHostEvents(events));
      setLocalPlayer(world.hostId);
      this.client = new ClientSession(hub.connect('local'), { playerId: world.hostId });
    } else {
      this.role = 'guest';
      this.host = null;
      this.client = client!;
    }
  }

  static create(name: string, seed?: number): GameSession {
    seed ??= (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const content = getContent();
    const world = createWorld(content, { seed, hostId: 'p1' });
    joinWorld(world, createCharacter(content, { id: 'p1', name: name.trim().slice(0, 16) || '守岛人' }));
    return new GameSession(`world-${seed.toString(36)}`, world);
  }

  static async load(slot: string): Promise<GameSession> {
    const data = await saveBackend().read(slot);
    if (!data) throw new Error('找不到存档');
    const world = loadWorld(JSON.parse(data.world));
    // 只加入房主自己的角色：客人的角色在客人自己的电脑上（DESIGN 9.3）
    for (const c of data.characters) {
      const ch = loadCharacter(JSON.parse(c));
      if (ch.id === world.hostId) joinWorld(world, ch);
    }
    if (!world.characters[world.hostId]) throw new Error('存档里没有房主的角色');
    return new GameSession(slot, world);
  }

  /**
   * 作为客人加入（M2）：带着自己的角色连上房主，等 welcome（或拒绝 / 断线）。
   */
  static join(transport: ClientTransport, character: CharacterState): Promise<GameSession> {
    return new Promise((resolve, reject) => {
      const client = new ClientSession(transport, { character: saveCharacter(character) });
      const offW = client.onWelcome((id) => {
        offW();
        offC();
        setLocalPlayer(id);
        resolve(new GameSession(`guest-${id}`, null, client));
      });
      const offC = client.onClose((reason) => {
        offW();
        offC();
        reject(new Error(reason));
      });
    });
  }

  /** 房主：开放局域网 / 直连（DESIGN 9.1，M2）。 */
  async openLan(port?: number): Promise<{ port: number; addresses: string[] }> {
    if (this.role !== 'host') throw new Error('只有房主可以开放联机');
    const net = netBridge();
    if (!net) throw new Error('网页版不支持联机');
    this.attachRemote();
    this.lan = await net.hostOpen(port);
    return this.lan;
  }

  /** 房主：创建 Steam 好友房间并打开邀请界面。 */
  async openSteam(): Promise<{ ok: boolean; error?: string }> {
    const net = netBridge();
    if (!net || this.role !== 'host') return { ok: false, error: '只有房主可以邀请' };
    this.attachRemote();
    const r = await net.steamHost();
    if (r.ok && r.lobbyId) {
      this.steamLobby = r.lobbyId;
      await net.steamInvite();
    }
    return r;
  }

  private attachRemote(): void {
    const net = netBridge();
    if (!net || this.remoteDispose) return;
    const t = ipcHostTransport(net);
    this.remote.attach(t);
    this.remoteDispose = () => {
      t.dispose();
      this.remote.detach();
    };
  }

  /** 在线玩家（房主看到的）。 */
  get onlinePlayers(): string[] {
    return this.host?.players ?? Object.keys(this.client.world?.characters ?? {});
  }

  update(ms: number): void {
    this.host?.update(ms);
    this.sinceSave += ms;
    if (this.sinceSave >= AUTOSAVE_MS) void this.save();
  }

  private onHostEvents(events: readonly WorldEvent[]): void {
    // 每个游戏日开始时自动存档（DESIGN 9.4）
    if (events.some((e) => e.t === 'dayStart') && (this.world?.tick ?? 0) > 100) void this.save();
  }

  /** 房主：世界 + 房主自己的角色；客人：只存自己的角色（来自房主同步过来的世界）。 */
  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.sinceSave = 0;
    try {
      if (this.world) {
        const s = saveWorld(this.world);
        await saveBackend().write(
          this.slot,
          JSON.stringify(s.world),
          s.characters.filter((c) => c.character.id === this.world!.hostId).map((c) => ({ id: c.character.id, data: JSON.stringify(c) })),
        );
      } else {
        const me = this.client.world?.characters[PLAYER_ID];
        if (me) await characterStore().write(me.id, JSON.stringify(saveCharacter(me)));
      }
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    if (this.role === 'guest') this.client.leave();
    this.remoteDispose?.();
    this.remoteDispose = null;
    if (this.role === 'host' && (this.lan || this.steamLobby)) void netBridge()?.hostClose();
    this.host?.dispose();
    this.client.dispose();
  }
}
