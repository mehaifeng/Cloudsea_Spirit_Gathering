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
import { regionUnlocked } from './progress';
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
  const region = content.keepers.get(keeperId)!.region;
  const weather = weatherAt(world.seed, region, world.tick);
  const situations: Situation[] = [firstToday ? 'greeting' : 'smallTalk'];
  if (!firstToday) {
    situations.push(clockAt(world.tick).isNight ? 'night' : (`weather${weather[0]!.toUpperCase()}${weather.slice(1)}` as Situation));
    situations.push('aboutIsland', 'smallTalk');
  }
  const situation = situations[firstToday ? 0 : rng.int(0, situations.length - 1)]!;
  const line = pickLine(content, keeperId, situation, level, rng);
  if (world.aiMode === 'spirit') {
    // 灵性模式：请房主用 LLM 说这句话；超时用对话库的这句（M3-4）
    k.pendingTalk[playerId] = { deadline: world.tick + SPIRIT_WAIT_TICKS, fallback: line, situation };
    events.push({ t: 'keeperTalkRequest', keeperId, playerId, situation, level, fallback: line });
    return;
  }
  events.push({ t: 'dialogue', playerId, keeperId, lines: [line] });
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

/** LLM 生成的一句话的长度上限：中文 120 字（DESIGN 11.6）；英文按 200 个字符放宽（M4-3）。 */
export const LLM_LINE_MAX = 200;

/** 灵性模式等 LLM 的时限（tick）：超时就用默认模式的结果（DESIGN 11.5，M3-4）。 */
export const SPIRIT_WAIT_TICKS = 200;
/** 记忆条数：超过就压缩（灵性模式）或丢掉最旧的。 */
export const MEMORY_SUMMARY_AT = 30;
const MEMORY_CAP = { default: 30, spirit: 40 } as const;

/** 今天各目标的权重（性格 × 天气 × 世界状态）；权重为 0 的目标今天不能选。 */
export function goalWeights(content: ContentDb, world: WorldState, k: KeeperState): number[] {
  const def = content.keepers.get(k.id)!;
  const day = dayOf(world.tick);
  const weather = weatherAt(world.seed, def.region, world.tick);
  return PLANNER_GOALS.map((g) => {
    let w = def.plannerWeights[g] ?? 0;
    if (g === 'farm' && (weather === 'rain' || weather === 'sun')) w *= 1.5;
    if (g === 'explore' && weather === def.favoriteElement) w *= 1.5;
    if (g === 'visit' && !Object.values(world.characters).some((c) => c.tutorial.done)) w = 0;
    // 还在浓雾里的大区，守岛人出不来（M3-3）
    if (g === 'visit' && !regionUnlocked(content, world, def.region)) w = 0;
    if (g === 'postOrder' && world.orders.some((o) => o.source === k.id && o.fulfilledBy === null && o.expiresDay >= day)) w = 0;
    return w;
  });
}

/**
 * 每个游戏日开始时给守岛人定目标（DESIGN 11.4 / 11.5）。
 * - 默认模式：加权随机规划器当场定（世界种子，回放一致）；
 * - 灵性模式：先挂起并发出请求，房主拿 LLM 的结果用 keeperPlan 意图交回来；超时由 tick 用默认结果补上。
 */
export function planKeeperDay(content: ContentDb, world: WorldState, k: KeeperState, events: WorldEvent[]): void {
  const day = dayOf(world.tick);
  if (world.aiMode === 'spirit') {
    k.pendingPlan = { day, deadline: world.tick + SPIRIT_WAIT_TICKS };
    events.push({ t: 'keeperPlanRequest', keeperId: k.id, day });
    return;
  }
  executeKeeperGoal(content, world, k, randomGoal(content, world, k), events);
}

/** 默认模式的加权随机目标。 */
export function randomGoal(content: ContentDb, world: WorldState, k: KeeperState): PlannerGoal {
  const rng = createRng(deriveSeed(world.seed, `plan:${k.id}:${dayOf(world.tick)}`));
  return PLANNER_GOALS[rng.weightedIndex(goalWeights(content, world, k))]!;
}

/** 执行今天的目标（执行层确定性：随机数仍来自世界种子）。note：灵性模式下守岛人对今天的打算。 */
export function executeKeeperGoal(content: ContentDb, world: WorldState, k: KeeperState, goal: PlannerGoal, events: WorldEvent[], note?: string): void {
  const def = content.keepers.get(k.id)!;
  const day = dayOf(world.tick);
  const rng = createRng(deriveSeed(world.seed, `exec:${k.id}:${day}`));
  k.pendingPlan = null;
  if (note) k.memory.push(`第 ${day} 天的打算：${note}`);
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
  trimMemory(world, k, events);
}

/** 记忆太长：灵性模式请房主压缩成长期摘要；放不下了就丢最旧的。 */
export function trimMemory(world: WorldState, k: KeeperState, events: WorldEvent[]): void {
  if (world.aiMode === 'spirit' && k.memory.length >= MEMORY_SUMMARY_AT && !k.summaryPending) {
    k.summaryPending = true;
    events.push({ t: 'keeperSummaryRequest', keeperId: k.id });
  }
  const cap = MEMORY_CAP[world.aiMode];
  if (k.memory.length > cap) k.memory.splice(0, k.memory.length - cap);
}

/** 灵性模式超时：守岛人的计划与对话按默认模式补上（每 tick 调用）。 */
export function expireSpiritRequests(content: ContentDb, world: WorldState, events: WorldEvent[]): void {
  for (const k of Object.values(world.keepers)) {
    if (k.pendingPlan && world.tick >= k.pendingPlan.deadline) executeKeeperGoal(content, world, k, randomGoal(content, world, k), events);
    for (const [pid, t] of Object.entries(k.pendingTalk)) {
      if (world.tick < t.deadline) continue;
      delete k.pendingTalk[pid];
      events.push({ t: 'dialogue', playerId: pid, keeperId: k.id, lines: [t.fallback] });
    }
  }
}

/** 守岛人对战每天每人一次。 */
export function keeperBattleBlocker(world: WorldState, k: KeeperState, playerId: string): string | null {
  if (k.lastBattleDay[playerId] === dayOf(world.tick)) return '今天已经比过了，明天再来吧';
  return null;
}
