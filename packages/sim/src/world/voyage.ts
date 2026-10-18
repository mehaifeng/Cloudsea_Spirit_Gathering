import { islandPresent } from './keeperDraw';
import { HOME_CHART_POS, REGION_NAME, type ContentDb } from '@cloudsea/content';
import { effectiveFog, regionUnlocked } from './progress';
import { homeIslandId } from './create';
import type { WorldEvent } from './events';
import { arrivalPoint, HOME_DOCK, worldPosition } from './layout';
import type { CharacterState, PlayerRuntime, WorldState } from './state';
import { TICKS_PER_SECOND } from './time';
import { refreshWild } from './wild';

/**
 * 云舟航行（DESIGN 3.6，v0.5）：沿航线的实时过场。房主按出发 / 抵达 tick 结算，
 * 航行中玩家处于“航行中”状态；客户端按同样的时间播放飞行画面。
 */
export interface Voyage {
  readonly from: string;
  readonly to: string;
  readonly departTick: number;
  arriveTick: number;
}

/** 航行时长 5–20 秒：距离 ÷ 云舟速度（1 级 30 米 / 秒，每级 +10）。 */
export const VOYAGE_MIN_SECONDS = 5;
export const VOYAGE_MAX_SECONDS = 20;
/** 加速后剩余至少还飞多久（秒），让降落画面完整。 */
export const VOYAGE_HURRY_REMAIN = 2;

export function skiffSpeed(level: number): number {
  return 30 + 10 * (level - 1);
}

/** 岛在世界里的位置；家园岛在原点。 */
export function islandWorldPos(content: ContentDb, islandId: string): { x: number; y: number; z: number } {
  return worldPosition(content.islands.get(islandId) ?? null, HOME_CHART_POS);
}

export function voyageTicks(content: ContentDb, from: string, to: string, skiffLevel: number): number {
  const a = islandWorldPos(content, from);
  const b = islandWorldPos(content, to);
  const seconds = Math.hypot(b.x - a.x, b.z - a.z) / skiffSpeed(skiffLevel);
  return Math.round(Math.max(VOYAGE_MIN_SECONDS, Math.min(VOYAGE_MAX_SECONDS, seconds)) * TICKS_PER_SECOND);
}

/** 降落：站到目的地的码头 / 栈桥上。 */
export function landAt(content: ContentDb, world: WorldState, p: PlayerRuntime, playerId: string, islandId: string): void {
  p.islandId = islandId;
  p.yaw = Math.PI;
  if (islandId === homeIslandId(playerId)) {
    p.x = HOME_DOCK.x;
    p.z = HOME_DOCK.z - 2.5;
    return;
  }
  const island = content.islands.get(islandId)!;
  const a = arrivalPoint(island);
  p.x = a.x;
  p.z = a.z;
  if (island.kind === 'fixed') refreshWild(content, world, island);
}

/** 每 tick 检查航行中的玩家是否到了。 */
export function tickVoyages(content: ContentDb, world: WorldState, events: WorldEvent[]): void {
  for (const [playerId, p] of Object.entries(world.players)) {
    const v = p.voyage;
    if (!v || world.tick < v.arriveTick) continue;
    p.voyage = null;
    landAt(content, world, p, playerId, v.to);
    events.push({ t: 'sailed', playerId, islandId: v.to });
  }
}

/**
 * 能不能出航；不能时返回原因（v0.6：客户端先用它预检，通过后才播上船动画再发意图）。
 * 纯函数，不改状态；`sail` 意图里用同一套判定。
 */
export function sailBlocked(content: ContentDb, p: Readonly<PlayerRuntime>, c: Readonly<CharacterState>, playerId: string, islandId: string, world: Readonly<WorldState>): string | null {
  if (p.battleId !== null) return '战斗中不能出航';
  if (p.voyage) return '正在航行中';
  const to = islandId === 'home' ? homeIslandId(playerId) : islandId;
  if (to === p.islandId) return '已经在这座岛上了';
  if (to !== homeIslandId(playerId)) {
    const island = content.islands.get(to);
    if (!island || !islandPresent(world, island)) return '没有这座岛';
    if (!regionUnlocked(content, world, island.region)) return `${REGION_NAME[island.region]}还在浓雾里：先点亮上一座灯塔`;
    const fog = effectiveFog(content, world, island);
    if (c.tools.skiff < island.skiffLevel) return `需要 ${island.skiffLevel} 级云舟`;
    if (c.tools.lantern < fog) return `雾太浓了，需要 ${fog} 级提灯`;
    if (fog > 0 && (c.backpack['lanternFuel'] ?? 0) < fog) return `提灯燃料不够（需要 ${fog}）`;
  }
  return null;
}
