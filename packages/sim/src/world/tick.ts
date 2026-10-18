import { ECONOMY, ORDER_PREMIUM, ORDER_TEMPLATES, type ContentDb } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import { healSpirit, maxHpOf } from '../spirit/condition';
import type { Spirit } from '../spirit/types';
import type { WorldEvent } from './events';
import { tickBattles } from './battleflow';
import { homeIslandId } from './create';
import { hasRoomForSpirit, tickHome } from './home';
import { newId } from './ids';
import { checkAchievements } from './achievements';
import { expireSpiritRequests, planKeeperDay } from './keeper';
import type { CharacterState, Order, WorldState } from './state';
import { dayOf } from './time';
import { tickVoyages } from './voyage';
import { refreshWild, WILD_REFRESH_TICKS } from './wild';

/** 生成当天的商队订单（DESIGN 6.3 / 6.6：每日 3–5 条，50–400 云贝）。 */
export function refreshOrders(content: ContentDb, world: WorldState, day: number): void {
  world.orders = world.orders.filter((o) => o.fulfilledBy === null && o.expiresDay >= day && o.source !== 'caravan');
  const rng = createRng(deriveSeed(world.seed, `orders:${day}`));
  const n = rng.int(ECONOMY.ordersPerDay.min, ECONOMY.ordersPerDay.max);
  for (let i = 0; i < n; i++) {
    const t = ORDER_TEMPLATES[rng.weightedIndex(ORDER_TEMPLATES.map((x) => x.weight))]!;
    const count = rng.int(t.min, t.max);
    const price = content.items.get(t.item)!.sellPrice;
    const scale = 1 + (world.chapter - 1) * 0.5;
    const reward = Math.min(ECONOMY.orderReward.max * scale, Math.max(ECONOMY.orderReward.min, Math.round(price * count * ORDER_PREMIUM * scale)));
    const order: Order = { id: newId(world, 'o'), source: 'caravan', item: t.item, count, reward: Math.round(reward), day, expiresDay: day, fulfilledBy: null };
    world.orders.push(order);
  }
}

function dailyUpdate(content: ContentDb, world: WorldState, day: number, events: WorldEvent[]): void {
  world.lastDailyDay = day;
  events.push({ t: 'dayStart', day });
  refreshOrders(content, world, day);
  for (const k of Object.values(world.keepers)) planKeeperDay(content, world, k, events);
}

/** 核心塔附近快速恢复的半径（米）与回满所需 tick；家园岛其他地方回满所需 tick（DESIGN 4.8，v0.7）。 */
export const CORE_HEAL = { radius: 6, fullTicks: 100 } as const;
export const HOME_HEAL_FULL_TICKS = 1500;

/**
 * 生命恢复速度（每 tick 恢复最大生命的比例；DESIGN 4.8，v0.7）：
 * 主人在家园岛核心塔附近时，队伍里的絮灵快速恢复；家园岛上（空闲、工作中，或主人在家时的队伍）缓慢恢复，
 * 有温泉 ×4、有栖巢 ×2；野外不恢复。
 */
export function healRate(content: ContentDb, world: WorldState, c: CharacterState, s: Spirit): number {
  if (s.state === 'egg' || s.state === 'purifying') return 0;
  const p = world.players[c.id];
  const playerHome = p?.islandId === homeIslandId(c.id) && !p.voyage;
  if (s.state === 'party' && !playerHome) return 0;
  if (s.state === 'party' && p && Math.hypot(p.x, p.z) <= CORE_HEAL.radius && !p.battleId) return 1 / CORE_HEAL.fullTicks;
  const home = world.homes[c.id];
  const kinds = new Set(Object.values(home?.buildings ?? {}).filter((b) => b.built).map((b) => content.buildings.get(b.type)!.kind));
  const mult = kinds.has('hotSpring') ? 4 : kinds.has('nest') ? 2 : 1;
  return mult / HOME_HEAL_FULL_TICKS;
}

function tickSpirits(content: ContentDb, world: WorldState, c: CharacterState, dt: number, events: WorldEvent[]): void {
  for (const s of Object.values(c.spirits)) {
    let next = s;
    if (s.condition) {
      const rate = healRate(content, world, c, s);
      if (rate > 0) {
        next = healSpirit(content, s, rate * dt * maxHpOf(content, s));
        if (!next.condition) events.push({ t: 'recovered', playerId: c.id, spiritId: s.id });
      }
    }
    if (s.state === 'egg' && world.tick >= s.readyAtTick && hasRoomForSpirit(content, world, c)) {
      next = { ...next, state: 'idle' };
      const home = world.homes[c.id];
      for (const b of Object.values(home?.buildings ?? {})) if (b.eggId === s.id) b.eggId = null;
      if (!c.codex.seen.includes(s.formId)) c.codex.seen.push(s.formId);
      if (!c.codex.caught.includes(s.formId)) c.codex.caught.push(s.formId);
      if (!c.memoryShards.includes(s.formId)) c.memoryShards.push(s.formId);
      events.push({ t: 'hatched', playerId: c.id, spiritId: s.id });
    }
    if (s.state === 'purifying' && world.tick >= s.readyAtTick) {
      next = { ...next, state: 'idle', blighted: false };
      const home = world.homes[c.id];
      for (const b of Object.values(home?.buildings ?? {})) b.occupants = b.occupants.filter((id) => id !== s.id);
      events.push({ t: 'purified', playerId: c.id, spiritId: s.id });
      c.stats.purified++;
    }
    if (next !== s) c.spirits[s.id] = next;
  }
}

/**
 * 推进世界 dt 个 tick（DESIGN 9.2）：每日结算、家园生产、絮灵计时、活跃岛的野生絮灵、守岛人来访。
 * 暂停时什么都不做。调用方以固定步长（例如 10 tick = 1 秒）循环调用。
 */
export function advanceWorld(content: ContentDb, world: WorldState, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (world.paused || dt <= 0) return events;
  world.tick += dt;
  const day = dayOf(world.tick);
  if (day !== world.lastDailyDay) dailyUpdate(content, world, day, events);

  tickVoyages(content, world, events);
  for (const home of Object.values(world.homes)) tickHome(content, world, home, dt, events);
  for (const c of Object.values(world.characters)) tickSpirits(content, world, c, dt, events);

  tickBattles(content, world, events);

  // 活跃岛：有在线玩家在的固定岛（DESIGN 9.2）
  const active = new Set(Object.entries(world.players).filter(([id]) => world.characters[id]).map(([, p]) => p.islandId));
  for (const id of active) {
    const island = content.islands.get(id);
    if (!island || island.kind !== 'fixed') continue;
    const rt = world.islands[id];
    if (!rt || world.tick - rt.lastRefreshTick >= WILD_REFRESH_TICKS) refreshWild(content, world, island);
  }

  for (const k of Object.values(world.keepers)) {
    if (k.visiting && world.tick >= k.visiting.untilTick) k.visiting = null;
  }
  expireSpiritRequests(content, world, events);
  checkAchievements(content, world, events);
  return events;
}
