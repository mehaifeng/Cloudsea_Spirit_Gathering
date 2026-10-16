import type { PlannerGoal, ToolKind } from '@cloudsea/content';
import type { BattleKind, BattleState, SideActions } from '../battle/types';
import type { Spirit } from '../spirit/types';

/** 物品袋：物品 id → 数量。占用格数 = Σ ceil(数量 / 99)。 */
export type ItemBag = Record<string, number>;

export interface Appearance {
  readonly skinTone: string;
  readonly hairColor: string;
  readonly clothColor: string;
  readonly scarfColor: string;
}

/**
 * 角色存档（每位玩家自己电脑，DESIGN 9.3）：絮灵、云贝、背包、工具、图鉴、蓝图。
 * 可带进任何世界。
 */
export interface CharacterState {
  readonly version: 1;
  readonly id: string;
  name: string;
  appearance: Appearance;
  shells: number;
  backpack: ItemBag;
  tools: Record<ToolKind, number>;
  spirits: Record<string, Spirit>;
  /** 队伍（最多 6），按出场顺序。 */
  party: string[];
  codex: { seen: string[]; caught: string[] };
  /** 已解锁记忆碎片的形态 id。 */
  memoryShards: string[];
  blueprints: string[];
  nextSpiritSeq: number;
  tutorial: { step: number; done: boolean };
  stats: { battlesWon: number; caught: number; bred: number };
}

/** 玩家在世界里的位置（世界存档里按玩家 id 保存）。 */
export interface PlayerRuntime {
  /** 所在岛：固定岛 id，或 `home:<玩家 id>`。 */
  islandId: string;
  x: number;
  z: number;
  yaw: number;
  battleId: string | null;
}

export type Rotation = 0 | 1 | 2 | 3;

export interface BuildingInstance {
  readonly id: string;
  readonly type: string;
  /** 占地左上角网格坐标（米）。 */
  readonly x: number;
  readonly z: number;
  readonly rot: Rotation;
  built: boolean;
  /** 已完成的建造工时。 */
  buildProgress: number;
  /** 工位上的絮灵 id（可以属于不同玩家：联机时帮忙）。 */
  workers: string[];
  /** 田地：作物与生长进度（tick）。 */
  crop: { cropId: string; progress: number; seedItem: string } | null;
  /** 工坊：当前配方、剩余件数、本件进度。 */
  job: { recipeId: string; remaining: number; progress: number; inputsPaid: boolean } | null;
  /** 繁殖屋：正在孵的蛋。 */
  eggId: string | null;
  /** 净化池 / 温泉里的絮灵。 */
  occupants: string[];
}

/** 家园岛（世界存档；联机时每位玩家认领一座）。 */
export interface HomeIsland {
  readonly ownerId: string;
  readonly seed: number;
  coreLevel: number;
  buildings: Record<string, BuildingInstance>;
  storage: ItemBag;
}

export interface WildEntity {
  readonly id: string;
  /** 第一只是领头，场上看到的就是它。 */
  readonly group: Spirit[];
  readonly x: number;
  readonly z: number;
  readonly blighted: boolean;
  readonly spawnedAt: number;
}

/** 固定岛的运行时状态：有玩家在时活跃，否则冻结，再进入时按经过的 tick 补算（DESIGN 9.2）。 */
export interface IslandRuntime {
  readonly id: string;
  wild: Record<string, WildEntity>;
  /** 采集点 id → 可再次采集的 tick。 */
  nodes: Record<string, number>;
  lastRefreshTick: number;
}

/** 守岛人的抽象状态（DESIGN 11.7）。 */
export interface KeeperState {
  readonly id: string;
  /** 玩家 id → 好感点数。 */
  affinity: Record<string, number>;
  /** 玩家 id → 最近一次计入送礼的游戏日。 */
  lastGiftDay: Record<string, number>;
  lastTalkDay: Record<string, number>;
  lastBattleDay: Record<string, number>;
  /** 玩家 id → 已完成的剧情节点。 */
  storyDone: Record<string, string[]>;
  islandLevel: number;
  /** 抽象经营：作物与库存。 */
  stock: ItemBag;
  spirits: Spirit[];
  goal: PlannerGoal;
  goalDay: number;
  /** 正在拜访的玩家家园与离开时间。 */
  visiting: { playerId: string; untilTick: number } | null;
  /** 最近事件日志（灵性模式的记忆；默认模式只用于展示）。 */
  memory: string[];
}

export interface Order {
  readonly id: string;
  /** 'caravan' 或守岛人 id。 */
  readonly source: string;
  readonly item: string;
  readonly count: number;
  readonly reward: number;
  readonly day: number;
  readonly expiresDay: number;
  fulfilledBy: string | null;
}

export interface ActiveBattle {
  readonly id: string;
  readonly kind: BattleKind;
  readonly playerId: string;
  readonly islandId: string;
  readonly wildId: string | null;
  readonly keeperId: string | null;
  state: BattleState;
  readonly aiSeed: number;
  /** 对手被“听风”看破时，房主提前定下它下回合的行动并公开（DESIGN 5.1）。 */
  preparedAi: SideActions | null;
}

/**
 * 世界状态（房主权威）。保存时拆成世界存档 + 各角色存档（save.ts）。
 * 只能通过 applyIntent / advanceWorld 修改。
 */
export interface WorldState {
  readonly version: 1;
  readonly seed: number;
  tick: number;
  paused: boolean;
  nextId: number;
  readonly hostId: string;
  /** 在线玩家的角色（存档时拆出去）。 */
  characters: Record<string, CharacterState>;
  players: Record<string, PlayerRuntime>;
  homes: Record<string, HomeIsland>;
  islands: Record<string, IslandRuntime>;
  keepers: Record<string, KeeperState>;
  orders: Order[];
  /** 最近一次做过每日结算的游戏日。 */
  lastDailyDay: number;
  battles: Record<string, ActiveBattle>;
  chapter: number;
}
