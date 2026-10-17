import type { CharacterState, WorldState } from './state';

/**
 * 存档（铁律 7、DESIGN 9.3 / 9.4）：世界存档与角色存档分开，都带 version。
 * 结构变更时：版本号 +1，在 MIGRATIONS 里加一条从旧版本升级的函数，并补测试。
 */
export const WORLD_SAVE_VERSION = 1;
export const CHARACTER_SAVE_VERSION = 2;

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
export const WORLD_MIGRATIONS: Readonly<Record<number, Migration>> = {};
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
