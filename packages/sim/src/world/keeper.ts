import {
  affinityLevel,
  ORDER_PREMIUM,
  PLANNER_GOALS,
  type ContentDb,
  type DialogueLine,
  type PlannerGoal,
  type Situation,
} from '@cloudsea/content';
import { createRng, deriveSeed, type Rng } from '../rng';
import { addExp, expForLevel } from '../spirit/spirit';
import type { WorldEvent } from './events';
import { newId } from './ids';
import type { KeeperState, Order, WorldState } from './state';
import { clockAt, dayOf, TICKS_PER_DAY } from './time';
import { weatherAt } from './weather';

/** 好感变化（DESIGN 11.3；数值为补充决定 D37）。 */
export const AFFINITY = {
  talk: 2,
  giftLoved: 30,
  giftLiked: 15,
  giftNeutral: 5,
  giftDisliked: -5,
  battleWin: 15,
  battleLose: 6,
  orderDone: 12,
} as const;

export function keeperAffinity(k: KeeperState, playerId: string): number {
  return k.affinity[playerId] ?? 0;
}

export function changeAffinity(world: WorldState, k: KeeperState, playerId: string, delta: number, events: WorldEvent[]): void {
  const before = keeperAffinity(k, playerId);
  const after = Math.max(0, before + delta);
  k.affinity[playerId] = after;
  events.push({ t: 'affinity', playerId, keeperId: k.id, delta: after - before, level: affinityLevel(after) });
}

/** 从对话库挑一句：好感区间匹配优先，找不到就用该情境的任意一句（D36）。 */
export function pickLine(content: ContentDb, keeperId: string, situation: Situation, level: number, rng: Rng): string {
  const all = content.dialogue.filter((d) => d.keeper === keeperId && d.situation === situation);
  const fits = (d: DialogueLine) => (d.minAffinity ?? 0) <= level && level <= (d.maxAffinity ?? 5);
  const pool = all.filter(fits);
  const list = pool.length > 0 ? pool : all;
  return list.length > 0 ? rng.pick(list).text : '……';
}

function dialogueRng(world: WorldState, keeperId: string, playerId: string, salt: string): Rng {
  return createRng(deriveSeed(world.seed, `talk:${keeperId}:${playerId}:${world.tick}:${salt}`));
}

/** 下一个可以触发的剧情节点。 */
export function nextStoryNode(content: ContentDb, world: WorldState, k: KeeperState, playerId: string) {
  const def = content.keepers.get(k.id)!;
  const done = k.storyDone[playerId] ?? [];
  const level = affinityLevel(keeperAffinity(k, playerId));
  return def.story.find(
    (n) => !done.includes(n.id) && level >= n.minAffinityLevel && world.chapter >= n.minChapter && (!n.after || done.includes(n.after)),
  );
}

/** 和守岛人说话：有剧情节点先讲剧情，否则按情境闲聊；每天第一次说话加好感。 */
export function talkToKeeper(content: ContentDb, world: WorldState, keeperId: string, playerId: string, events: WorldEvent[]): void {
  const k = world.keepers[keeperId]!;
  const c = world.characters[playerId]!;
  const today = dayOf(world.tick);
  const firstToday = k.lastTalkDay[playerId] !== today;
  if (firstToday) {
    k.lastTalkDay[playerId] = today;
    changeAffinity(world, k, playerId, AFFINITY.talk, events);
  }
  const node = nextStoryNode(content, world, k, playerId);
  if (node) {
    (k.storyDone[playerId] ??= []).push(node.id);
    events.push({ t: 'dialogue', playerId, keeperId, lines: node.lines, title: node.title });
    const r = node.reward;
    if (r?.shells) {
      c.shells += r.shells;
      events.push({ t: 'shells', playerId, delta: r.shells });
    }
    for (const st of r?.items ?? []) {
      c.backpack[st.item] = (c.backpack[st.item] ?? 0) + st.count;
      events.push({ t: 'items', playerId, item: st.item, count: st.count, where: 'backpack' });
    }
    if (r?.blueprint && !c.blueprints.includes(r.blueprint)) {
      c.blueprints.push(r.blueprint);
      events.push({ t: 'blueprint', playerId, building: r.blueprint });
    }
    k.memory.push(`第 ${today} 天：和 ${c.name} 讲了“${node.title}”`);
    return;
  }
  const level = affinityLevel(keeperAffinity(k, playerId));
  const rng = dialogueRng(world, keeperId, playerId, 'talk');
  const region = 'sunPlains' as const;
  const weather = weatherAt(world.seed, region, world.tick);
  const situations: Situation[] = [firstToday ? 'greeting' : 'smallTalk'];
  if (!firstToday) {
    situations.push(clockAt(world.tick).isNight ? 'night' : (`weather${weather[0]!.toUpperCase()}${weather.slice(1)}` as Situation));
    situations.push('aboutIsland', 'smallTalk');
  }
  const situation = situations[firstToday ? 0 : rng.int(0, situations.length - 1)]!;
  events.push({ t: 'dialogue', playerId, keeperId, lines: [pickLine(content, keeperId, situation, level, rng)] });
}

/** 送礼：每天对同一人最多计 1 次好感（DESIGN 11.3）。 */
export function giftKeeper(content: ContentDb, world: WorldState, keeperId: string, playerId: string, item: string, events: WorldEvent[]): string | null {
  const k = world.keepers[keeperId]!;
  const c = world.characters[playerId]!;
  if ((c.backpack[item] ?? 0) < 1) return '背包里没有这个';
  const today = dayOf(world.tick);
  c.backpack[item]! -= 1;
  if (c.backpack[item] === 0) delete c.backpack[item];
  const def = content.keepers.get(keeperId)!;
  const kind = def.gifts.loved.includes(item) ? 'giftLoved' : def.gifts.liked.includes(item) ? 'giftLiked' : def.gifts.disliked.includes(item) ? 'giftDisliked' : 'giftNeutral';
  if (k.lastGiftDay[playerId] !== today) {
    k.lastGiftDay[playerId] = today;
    changeAffinity(world, k, playerId, AFFINITY[kind], events);
  }
  k.stock[item] = (k.stock[item] ?? 0) + 1;
  const level = affinityLevel(keeperAffinity(k, playerId));
  events.push({ t: 'dialogue', playerId, keeperId, lines: [pickLine(content, keeperId, kind, level, dialogueRng(world, keeperId, playerId, 'gift'))] });
  k.memory.push(`第 ${today} 天：${c.name} 送了 ${content.items.get(item)?.name ?? item}`);
  return null;
}

/**
 * 默认模式的加权随机规划器（DESIGN 11.4 / 11.5）：每个游戏日选一个目标，按性格权重与世界状态调整。
 * 使用世界种子，保证同一存档回放一致。
 */
export function planKeeperDay(content: ContentDb, world: WorldState, k: KeeperState, events: WorldEvent[]): void {
  const def = content.keepers.get(k.id)!;
  const day = dayOf(world.tick);
  const rng = createRng(deriveSeed(world.seed, `plan:${k.id}:${day}`));
  const weather = weatherAt(world.seed, 'sunPlains', world.tick);
  const weights = PLANNER_GOALS.map((g) => {
    let w = def.plannerWeights[g] ?? 0;
    if (g === 'farm' && (weather === 'rain' || weather === 'sun')) w *= 1.5;
    if (g === 'explore' && weather === def.favoriteElement) w *= 1.5;
    if (g === 'visit' && !Object.values(world.characters).some((c) => c.tutorial.done)) w = 0;
    if (g === 'postOrder' && world.orders.some((o) => o.source === k.id && o.fulfilledBy === null && o.expiresDay >= day)) w = 0;
    return w;
  });
  const goal: PlannerGoal = PLANNER_GOALS[rng.weightedIndex(weights)]!;
  k.goal = goal;
  k.goalDay = day;
  switch (goal) {
    case 'farm': {
      const crop = rng.pick(['sunWheat', 'rainBerry', 'windbellFruit']);
      k.stock[crop] = (k.stock[crop] ?? 0) + rng.int(3, 8);
      k.memory.push(`第 ${day} 天：在田里忙了一整天`);
      break;
    }
    case 'build':
      if (k.islandLevel < 5 && rng.chance(0.4)) k.islandLevel++;
      k.memory.push(`第 ${day} 天：修整了岛上的房子`);
      break;
    case 'train':
      k.spirits = k.spirits.map((s) => (s.level < 30 ? addExp(s, expForLevel(s.level + 1) - s.exp) : s));
      k.memory.push(`第 ${day} 天：带着絮灵训练`);
      break;
    case 'postOrder': {
      const item = rng.pick([...def.gifts.liked, ...def.gifts.loved].filter((i) => content.items.get(i)!.sellPrice > 0));
      const info = content.items.get(item)!;
      const count = rng.int(2, 5);
      const reward = Math.max(60, Math.round(info.sellPrice * count * ORDER_PREMIUM * 1.2));
      const order: Order = { id: newId(world, 'o'), source: k.id, item, count, reward, day, expiresDay: day + 2, fulfilledBy: null };
      world.orders.push(order);
      k.memory.push(`第 ${day} 天：发布了订单（${info.name} × ${count}）`);
      break;
    }
    case 'visit': {
      // 只拜访已经走完新手引导的玩家
      const players = Object.values(world.characters).filter((c) => c.tutorial.done).map((c) => c.id);
      const playerId = rng.pick(players);
      k.visiting = { playerId, untilTick: world.tick + Math.round(TICKS_PER_DAY * 0.25) };
      events.push({ t: 'keeperVisit', keeperId: k.id, playerId });
      k.memory.push(`第 ${day} 天：去 ${world.characters[playerId]!.name} 的岛上串门`);
      break;
    }
    case 'explore':
    case 'rest':
      k.memory.push(`第 ${day} 天：${goal === 'explore' ? '出海转了一圈' : '在家歇着'}`);
      break;
  }
  if (k.memory.length > 30) k.memory.splice(0, k.memory.length - 30);
}

/** 守岛人对战每天每人一次。 */
export function keeperBattleBlocker(world: WorldState, k: KeeperState, playerId: string): string | null {
  if (k.lastBattleDay[playerId] === dayOf(world.tick)) return '今天已经比过了，明天再来吧';
  return null;
}
