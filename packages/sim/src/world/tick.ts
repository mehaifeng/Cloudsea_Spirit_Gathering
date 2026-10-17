import { ECONOMY, ORDER_PREMIUM, ORDER_TEMPLATES, type ContentDb } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import type { Spirit } from '../spirit/types';
import type { WorldEvent } from './events';
import { homeIslandId } from './create';
import { hasRoomForSpirit, tickHome } from './home';
import { newId } from './ids';
import { planKeeperDay } from './keeper';
import type { CharacterState, Order, WorldState } from './state';
import { dayOf } from './time';
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

/**
 * 疲惫恢复倍速（DESIGN 4.8）：在家园岛上休息时，有温泉 4×、有栖巢 2×；出门在外 1×。
 * “在家”= 空闲的絮灵，或主人此刻就在家园岛上时队伍里的絮灵（D52）；工作中的絮灵按自然速度。
 */
function recoveryRate(content: ContentDb, world: WorldState, c: CharacterState, s: Spirit): number {
  if (s.state === 'egg' || s.state === 'purifying' || s.state === 'working') return 1;
  const atHome = s.state === 'idle' || world.players[c.id]?.islandId === homeIslandId(c.id);
  const home = world.homes[c.id];
  if (!atHome || !home) return 1;
  const kinds = new Set(Object.values(home.buildings).filter((b) => b.built).map((b) => content.buildings.get(b.type)!.kind));
  if (kinds.has('hotSpring')) return 4;
  if (kinds.has('nest')) return 2;
  return 1;
}

function tickSpirits(content: ContentDb, world: WorldState, c: CharacterState, dt: number, events: WorldEvent[]): void {
  for (const s of Object.values(c.spirits)) {
    let next = s;
    if (s.weary) {
      const remaining = s.wearyRemaining - dt * recoveryRate(content, world, c, s);
      next = remaining <= 0 ? { ...next, weary: false, wearyRemaining: 0 } : { ...next, wearyRemaining: remaining };
      if (remaining <= 0) events.push({ t: 'recovered', playerId: c.id, spiritId: s.id });
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

  for (const home of Object.values(world.homes)) tickHome(content, world, home, dt, events);
  for (const c of Object.values(world.characters)) tickSpirits(content, world, c, dt, events);

  // 活跃岛：有玩家在的固定岛
  const active = new Set(Object.values(world.players).map((p) => p.islandId));
  for (const id of active) {
    const island = content.islands.get(id);
    if (!island || island.kind !== 'fixed') continue;
    const rt = world.islands[id];
    if (!rt || world.tick - rt.lastRefreshTick >= WILD_REFRESH_TICKS) refreshWild(content, world, island);
  }

  for (const k of Object.values(world.keepers)) {
    if (k.visiting && world.tick >= k.visiting.untilTick) k.visiting = null;
  }
  return events;
}
