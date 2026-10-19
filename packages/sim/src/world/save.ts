import { getContent } from '@cloudsea/content';
import { relocateBuildings } from './home';
import { arrivalPoint, HOME_DOCK, homeTerrain, islandTerrain } from './layout';
import type { CharacterState, PlayerRuntime, WorldState } from './state';

/**
 * 存档（铁律 7、DESIGN 9.3 / 9.4）：世界存档与角色存档分开，都带 version。
 * 结构变更时：版本号 +1，在 MIGRATIONS 里加一条从旧版本升级的函数，并补测试。
 */
export const WORLD_SAVE_VERSION = 7;
export const CHARACTER_SAVE_VERSION = 4;

export interface WorldSaveFile {
  readonly kind: 'cloudsea-world';
  readonly version: number;
  /** 不含在线角色与进行中的战斗（战斗不存档，读档后视为没发生）。 */
  readonly world: Omit<WorldState, 'characters' | 'battles'>;
}

export interface CharacterSaveFile {
  readonly kind: 'cloudsea-character';
  readonly version: number;
  readonly character: CharacterState;
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** 版本 n → n+1 的迁移函数。键是旧版本号。 */
export const WORLD_MIGRATIONS: Readonly<Record<number, Migration>> = {
  /**
   * v1 → v2（DESIGN v0.5）：家园岛从 15 米扩到 24 米、建筑占地按尺度规范变大、新增云舟航行。
   * 码头挪到新的岛缘；因为变大而重叠或出界的建筑挪到附近空位；玩家加上 voyage 字段。
   */
  1: (data) => {
    const content = getContent();
    const w = JSON.parse(JSON.stringify(data['world'])) as Omit<WorldState, 'characters' | 'battles'>;
    for (const [id, p] of Object.entries(w.players)) {
      (p as PlayerRuntime).voyage = null;
      if (p.islandId === `home:${id}`) {
        p.x = HOME_DOCK.x;
        p.z = HOME_DOCK.z - 2.5;
      }
    }
    for (const home of Object.values(w.homes)) {
      for (const b of Object.values(home.buildings)) {
        if (b.type === 'dock') home.buildings[b.id] = { ...b, x: HOME_DOCK.x - 2, z: HOME_DOCK.z - 1 };
      }
      relocateBuildings(content, home);
    }
    return { ...data, world: w };
  },
  /** v2 → v3（DESIGN v0.7）：移除疲惫；野生 / 守岛人的絮灵加上空的伤势字段。 */
  2: (data) => {
    const w = JSON.parse(JSON.stringify(data['world'])) as Record<string, unknown>;
    const fix = (sp: Record<string, unknown>) => {
      delete sp['weary'];
      delete sp['wearyRemaining'];
      sp['condition'] = null;
    };
    for (const isl of Object.values((w['islands'] ?? {}) as Record<string, { wild?: Record<string, { group: Record<string, unknown>[] }> }>)) for (const g of Object.values(isl.wild ?? {})) g.group.forEach(fix);
    for (const k of Object.values((w['keepers'] ?? {}) as Record<string, { spirits?: Record<string, unknown>[] }>)) (k.spirits ?? []).forEach(fix);
    return { ...data, world: w };
  },
  /** v3 → v4（M2）：记录重燃的灯塔。 */
  3: (data) => {
    const w = JSON.parse(JSON.stringify(data['world'])) as Record<string, unknown>;
    w['lighthousesLit'] = w['lighthousesLit'] ?? [];
    return { ...data, world: w };
  },
  /** v4 → v5（M3-2）：灯塔守卫。已经重燃的灯塔视为守卫也打赢了。 */
  4: (data) => {
    const w = JSON.parse(JSON.stringify(data['world'])) as Record<string, unknown>;
    w['guardiansBeaten'] = w['guardiansBeaten'] ?? [...((w['lighthousesLit'] as string[] | undefined) ?? [])];
    return { ...data, world: w };
  },
  /**
   * v5 → v6（M3-3）：守岛人按种子分配。迁移只补空表（并补上 M3-4 灵性模式的字段）；房主读档后按种子补抽（reconcileKeepers，需要内容数据）。
   * 阿禾、岚是晴原的固定住户，抽签一定包含他们，原有的好感与剧情进度保留。
   */
  5: (data) => {
    const w = JSON.parse(JSON.stringify(data['world'])) as Record<string, unknown>;
    w['keeperIslands'] = w['keeperIslands'] ?? {};
    // M3-4：灵性模式
    w['aiMode'] = w['aiMode'] ?? 'default';
    for (const k of Object.values((w['keepers'] ?? {}) as Record<string, Record<string, unknown>>)) {
      k['summary'] ??= '';
      k['pendingPlan'] ??= null;
      k['pendingTalk'] ??= {};
      k['summaryPending'] ??= false;
    }
    return { ...data, world: w };
  },
  /**
   * v6 → v7（DESIGN v0.10）：池塘重做、挪离码头，水里不能站人。因为池塘挪了位置而落进水里的建筑挪到附近空位；
   * 站在水里的玩家挪到码头边（家园岛）或登岛点（其他岛）。
   */
  6: (data) => {
    const content = getContent();
    const w = JSON.parse(JSON.stringify(data['world'])) as Omit<WorldState, 'characters' | 'battles'>;
    for (const home of Object.values(w.homes)) relocateBuildings(content, home);
    for (const [id, p] of Object.entries(w.players)) {
      const home = p.islandId === `home:${id}` ? w.homes[id] : undefined;
      const island = content.islands.get(p.islandId);
      const terrain = home ? homeTerrain(home.seed, home.coreLevel) : island ? islandTerrain(island) : null;
      if (!terrain || terrain.waterDistance(p.x, p.z) > 0.3) continue;
      const to = home ? { x: HOME_DOCK.x, z: HOME_DOCK.z - 2.5 } : arrivalPoint(island!);
      p.x = to.x;
      p.z = to.z;
    }
    return { ...data, world: w };
  },
};
export const CHARACTER_MIGRATIONS: Readonly<Record<number, Migration>> = {
  /** v1 → v2（DESIGN v0.5）：工具“风帆”改为“云舟”；新增看过的播片列表（已完成引导的角色视为看过开场）。 */
  1: (data) => {
    const c = { ...(data['character'] as Record<string, unknown>) };
    const tools = { ...(c['tools'] as Record<string, number>) };
    tools['skiff'] = tools['skiff'] ?? tools['sail'] ?? 1;
    delete tools['sail'];
    const tutorial = c['tutorial'] as { done?: boolean } | undefined;
    return { ...data, character: { ...c, version: 2, tools, seenCutscenes: tutorial?.done ? ['opening'] : [] } };
  },
  /** v2 → v3（DESIGN v0.7）：移除疲惫，改为伤势延续；原来疲惫的絮灵视为完好（不再惩罚）。 */
  2: (data) => {
    const c = { ...(data['character'] as Record<string, unknown>) };
    const spirits: Record<string, Record<string, unknown>> = {};
    for (const [id, sp] of Object.entries((c['spirits'] ?? {}) as Record<string, Record<string, unknown>>)) {
      const { weary: _w, wearyRemaining: _r, ...rest } = sp;
      spirits[id] = { ...rest, condition: null };
    }
    return { ...data, character: { ...c, version: 3, spirits } };
  },
  /** v3 → v4（M4-1）：成就与新的统计计数。已有的成就由房主读档后按条件补发。 */
  3: (data) => {
    const c = { ...(data['character'] as Record<string, unknown>) };
    const stats = { resonanceBred: 0, purified: 0, coopWins: 0, teamCodeWins: 0, ...((c['stats'] ?? {}) as Record<string, number>) };
    return { ...data, character: { ...c, version: 4, stats, achievements: (c['achievements'] as string[] | undefined) ?? [] } };
  },
};

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

function migrate(data: Record<string, unknown>, current: number, migrations: Readonly<Record<number, Migration>>, what: string): Record<string, unknown> {
  let v = data['version'];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new SaveError(`${what}缺少版本号`);
  if (v > current) throw new SaveError(`${what}来自更新版本的游戏（v${v}），请先升级游戏`);
  let out = data;
  while (v < current) {
    const m = migrations[v];
    if (!m) throw new SaveError(`${what}无法从 v${v} 升级`);
    out = { ...m(out), version: v + 1 };
    v++;
  }
  return out;
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** 把运行中的世界拆成存档文件。 */
export function saveWorld(world: WorldState): { world: WorldSaveFile; characters: CharacterSaveFile[] } {
  const { characters, battles, ...rest } = clone(world);
  const restNoBattle = {
    ...rest,
    players: Object.fromEntries(Object.entries(rest.players).map(([id, p]) => [id, { ...p, battleId: null }])),
  };
  void battles;
  return {
    world: { kind: 'cloudsea-world', version: WORLD_SAVE_VERSION, world: restNoBattle },
    characters: Object.values(characters).map((c) => saveCharacter(c)),
  };
}

export function saveCharacter(c: CharacterState): CharacterSaveFile {
  return { kind: 'cloudsea-character', version: CHARACTER_SAVE_VERSION, character: clone(c) };
}

export function loadCharacter(raw: unknown): CharacterState {
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== 'cloudsea-character') throw new SaveError('不是角色存档');
  const data = migrate(raw as Record<string, unknown>, CHARACTER_SAVE_VERSION, CHARACTER_MIGRATIONS, '角色存档');
  const c = (data as unknown as CharacterSaveFile).character;
  if (!c || typeof c.id !== 'string' || typeof c.spirits !== 'object') throw new SaveError('角色存档已损坏');
  return clone(c);
}

/** 读世界存档；在线角色另行 joinWorld。战斗中断的絮灵会被正常保留。 */
export function loadWorld(raw: unknown): WorldState {
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== 'cloudsea-world') throw new SaveError('不是世界存档');
  const data = migrate(raw as Record<string, unknown>, WORLD_SAVE_VERSION, WORLD_MIGRATIONS, '世界存档');
  const w = (data as unknown as WorldSaveFile).world;
  if (!w || typeof w.seed !== 'number' || typeof w.tick !== 'number') throw new SaveError('世界存档已损坏');
  return { ...clone(w), characters: {}, battles: {} } as WorldState;
}

/** 内部用：迁移函数的入口（测试用）。 */
export const __migrate = migrate;
