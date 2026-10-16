import { affinityLevel, type ContentDb, type Situation } from '@cloudsea/content';
import { AI_PRESETS, chooseActions } from '../battle/ai';
import { createBattle, validateActions } from '../battle/engine';
import { resolveTurn } from '../battle/engine';
import { capturedSpirits, expRewards, resultFor, wearyAfterBattle } from '../battle/rewards';
import type { BattleAction, SideActions } from '../battle/types';
import { createRng, deriveSeed } from '../rng';
import { addExp } from '../spirit/spirit';
import { makeWildSpirit } from './wild';
import type { Spirit } from '../spirit/types';
import type { WorldEvent } from './events';
import { hasRoomForSpirit, spiritCapacity, spiritCount } from './home';
import { homeIslandId } from './create';
import { newId } from './ids';
import { AFFINITY, changeAffinity, keeperAffinity, keeperBattleBlocker, pickLine } from './keeper';
import { HOME_DOCK } from './layout';
import type { ActiveBattle, CharacterState, WorldState } from './state';
import { dayOf, TICKS_PER_DAY } from './time';
import { weatherAt } from './weather';

/** 能出战的队伍成员：不疲惫、未蚀化、不在净化或蛋里。 */
export function battleReady(c: CharacterState): Spirit[] {
  return c.party.map((id) => c.spirits[id]!).filter((s) => s && !s.weary && !s.blighted && s.state === 'party');
}

function markSeen(c: CharacterState, formIds: readonly string[]): void {
  for (const f of formIds) if (!c.codex.seen.includes(f)) c.codex.seen.push(f);
}

function begin(world: WorldState, b: ActiveBattle, events: WorldEvent[]): string {
  world.battles[b.id] = b;
  world.players[b.playerId]!.battleId = b.id;
  events.push({ t: 'battleStart', playerId: b.playerId, battleId: b.id });
  return b.id;
}

/** 接触野生絮灵进入战斗（DESIGN 5.3）。 */
export function startWildBattle(content: ContentDb, world: WorldState, playerId: string, wildId: string, events: WorldEvent[]): string {
  const p = world.players[playerId]!;
  const c = world.characters[playerId]!;
  if (p.battleId) return '已经在战斗中';
  const island = content.islands.get(p.islandId);
  const wild = world.islands[p.islandId]?.wild[wildId];
  if (!island || !wild) return '它已经走开了';
  if (Math.hypot(wild.x - p.x, wild.z - p.z) > 5) return '再靠近一点';
  if (Object.values(world.battles).some((b) => b.wildId === wildId)) return '它正在和别人战斗';
  const ready = battleReady(c);
  if (ready.length === 0) return '队伍里没有能出战的絮灵';
  markSeen(c, wild.group.map((s) => s.formId));
  const id = newId(world, 'b');
  const seed = deriveSeed(world.seed, `battle:${id}`);
  return begin(
    world,
    {
      id,
      kind: 'wild',
      playerId,
      islandId: island.id,
      wildId,
      keeperId: null,
      aiSeed: seed,
      preparedAi: null,
      state: createBattle(content, {
        kind: 'wild',
        sides: [{ spirits: ready }, { spirits: wild.group, wild: true }],
        baseWeather: weatherAt(world.seed, island.region, world.tick),
        seed,
      }),
    },
    events,
  );
}

/** 守岛人对战（每天每人一次）。 */
export function startKeeperBattle(content: ContentDb, world: WorldState, playerId: string, keeperId: string, events: WorldEvent[]): string {
  const p = world.players[playerId]!;
  const c = world.characters[playerId]!;
  const k = world.keepers[keeperId];
  if (!k) return '没有这位守岛人';
  if (p.battleId) return '已经在战斗中';
  const blocker = keeperBattleBlocker(world, k, playerId);
  if (blocker) return blocker;
  const ready = battleReady(c);
  if (ready.length === 0) return '队伍里没有能出战的絮灵';
  k.lastBattleDay[playerId] = dayOf(world.tick);
  markSeen(c, k.spirits.map((s) => s.formId));
  const level = affinityLevel(keeperAffinity(k, playerId));
  events.push({ t: 'dialogue', playerId, keeperId, lines: [pickLine(content, keeperId, 'battleInvite', level, createRng(deriveSeed(world.seed, `inv:${world.tick}`)))] });
  const id = newId(world, 'b');
  const seed = deriveSeed(world.seed, `battle:${id}`);
  return begin(
    world,
    {
      id,
      kind: 'keeper',
      playerId,
      islandId: p.islandId,
      wildId: null,
      keeperId,
      aiSeed: seed,
      preparedAi: null,
      state: createBattle(content, {
        kind: 'keeper',
        sides: [{ spirits: ready }, { spirits: k.spirits }],
        baseWeather: weatherAt(world.seed, 'sunPlains', world.tick),
        seed,
      }),
    },
    events,
  );
}

/** 新手引导第一战：1v1，对手是一只蚀化的幼絮，脚本保证不会战败（DESIGN 13）。 */
export function startTutorialBattle(content: ContentDb, world: WorldState, playerId: string, events: WorldEvent[]): string {
  const p = world.players[playerId]!;
  const c = world.characters[playerId]!;
  if (p.battleId) return '已经在战斗中';
  const partner = battleReady(c)[0];
  if (!partner) return '队伍里没有能出战的絮灵';
  const rng = createRng(deriveSeed(world.seed, 'tutorial-foe'));
  const island = content.islands.get('wheatSlope')!;
  const foe = makeWildSpirit(content, rng, content.lines.get('kitefluff')!, { ...island, wildLevel: { min: 2, max: 2 } }, 'tutorial-foe', true);
  markSeen(c, [foe.formId]);
  const id = newId(world, 'b');
  const seed = deriveSeed(world.seed, `battle:${id}`);
  return begin(
    world,
    {
      id,
      kind: 'scripted',
      playerId,
      islandId: p.islandId,
      wildId: null,
      keeperId: null,
      aiSeed: seed,
      preparedAi: null,
      state: createBattle(content, {
        kind: 'scripted',
        sides: [{ spirits: [partner], slots: 1 }, { spirits: [foe] }],
        baseWeather: 'sun',
        seed,
        protectedSide: 0,
      }),
    },
    events,
  );
}

function aiActions(content: ContentDb, b: ActiveBattle): SideActions {
  if (b.kind === 'scripted') {
    return Object.fromEntries(Object.keys(b.state.sides[1].active).map((slot) => [slot, { type: 'skill', skillId: 'jab', target: { side: 0, slot: 0 } } as BattleAction]));
  }
  return chooseActions(content, b.state, 1, { ...aiFor(b), seed: b.aiSeed });
}

function aiFor(b: ActiveBattle) {
  if (b.kind === 'keeper') return AI_PRESETS.normal;
  if (b.kind === 'scripted') return AI_PRESETS.easy;
  return AI_PRESETS.wild;
}

/** 提交玩家一方本回合的行动；房主让 AI 选另一方，然后结算。 */
export function submitBattleActions(
  content: ContentDb,
  world: WorldState,
  playerId: string,
  battleId: string,
  actions: SideActions,
  events: WorldEvent[],
): string | null {
  const b = world.battles[battleId];
  if (!b || b.playerId !== playerId) return '没有这场战斗';
  const c = world.characters[playerId]!;
  const err = validateActions(content, b.state, 0, actions);
  if (err) return err;

  // 灯露：背包里要有；捕获后要放得下
  const dews = Object.values(actions).filter((a): a is Extract<BattleAction, { type: 'dew' }> => a.type === 'dew');
  if (dews.length > 0) {
    const free = spiritCapacity(content, world.homes[playerId]!) - spiritCount(c);
    if (free < dews.length) return '絮灵已经住满了，先建栖巢或放归一些';
    const need: Record<string, number> = {};
    for (const d of dews) {
      const item = d.quality === 'normal' ? 'lanternDew' : d.quality === 'refined' ? 'refinedDew' : 'superiorDew';
      need[item] = (need[item] ?? 0) + 1;
    }
    for (const [item, n] of Object.entries(need)) if ((c.backpack[item] ?? 0) < n) return `${content.items.get(item)!.name} 不够`;
    for (const [item, n] of Object.entries(need)) {
      c.backpack[item]! -= n;
      if (c.backpack[item] === 0) delete c.backpack[item];
    }
  }

  const ai = b.preparedAi ?? aiActions(content, b);
  const r = resolveTurn(content, b.state, [actions, ai]);
  b.state = r.state;
  // 听风看破了对手：下回合的选择现在就定下来并公开
  b.preparedAi = !b.state.outcome && b.state.revealed.some((uid) => uid.startsWith('1:')) ? aiActions(content, b) : null;
  events.push({ t: 'battleTurn', playerId, battleId, events: r.events });
  if (b.state.outcome) finishBattle(content, world, b, events);
  return null;
}

/** 结算：经验、疲惫、捕获、掉落、好感；全员疲惫时被商队送回家（DESIGN 5.4）。 */
export function finishBattle(content: ContentDb, world: WorldState, b: ActiveBattle, events: WorldEvent[]): void {
  const c = world.characters[b.playerId]!;
  const p = world.players[b.playerId]!;
  const result = resultFor(b.state, 0)!;
  const exp = expRewards(content, b.state, 0);
  const levelUps: string[] = [];
  for (const [id, amount] of exp) {
    const s = c.spirits[id];
    if (!s) continue;
    const next = addExp(s, amount);
    if (next.level > s.level) levelUps.push(id);
    c.spirits[id] = next;
  }
  for (const id of wearyAfterBattle(b.state, 0)) {
    const s = c.spirits[id];
    if (s) c.spirits[id] = { ...s, weary: true, wearyRemaining: TICKS_PER_DAY };
  }

  const captured: string[] = [];
  const wildGroup = b.wildId ? world.islands[b.islandId]?.wild[b.wildId]?.group ?? [] : [];
  for (const wid of capturedSpirits(b.state, 0)) {
    const w = wildGroup.find((s) => s.id === wid);
    if (!w || !hasRoomForSpirit(content, world, c)) continue;
    const id = `${c.id}-s${c.nextSpiritSeq++}`;
    const inParty = !w.blighted && c.party.length < 6;
    c.spirits[id] = { ...w, id, ownerId: c.id, state: inParty ? 'party' : 'idle' };
    if (inParty) c.party.push(id);
    if (!c.codex.caught.includes(w.formId)) c.codex.caught.push(w.formId);
    if (!c.memoryShards.includes(w.formId)) c.memoryShards.push(w.formId);
    c.stats.caught++;
    captured.push(id);
  }

  if (result === 'win') {
    c.stats.battlesWon++;
    const enemyLevels = b.state.sides[1].units.reduce((a, u) => a + u.level, 0);
    const shells = b.kind === 'keeper' ? 120 : b.kind === 'scripted' ? 0 : 3 * enemyLevels;
    if (shells > 0) {
      c.shells += shells;
      events.push({ t: 'shells', playerId: c.id, delta: shells });
    }
    if (b.kind === 'wild' && wildGroup.some((s) => s.blighted)) {
      c.backpack['mistCrystal'] = (c.backpack['mistCrystal'] ?? 0) + 1;
      events.push({ t: 'items', playerId: c.id, item: 'mistCrystal', count: 1, where: 'backpack' });
    }
  }
  if (b.wildId && (result === 'win' || captured.length > 0)) delete world.islands[b.islandId]?.wild[b.wildId];

  if (b.keeperId) {
    const k = world.keepers[b.keeperId]!;
    changeAffinity(world, k, c.id, result === 'win' ? AFFINITY.battleWin : AFFINITY.battleLose, events);
    const situation: Situation = result === 'win' ? 'battleLose' : 'battleWin';
    const level = affinityLevel(keeperAffinity(k, c.id));
    events.push({ t: 'dialogue', playerId: c.id, keeperId: k.id, lines: [pickLine(content, k.id, situation, level, createRng(deriveSeed(world.seed, `end:${b.id}`)))] });
  }

  // 全员疲惫且不在家：商队顺路搭救
  const allWeary = c.party.length > 0 && c.party.every((id) => c.spirits[id]?.weary || c.spirits[id]?.blighted);
  const rescued = (result === 'lose' || result === 'draw') && allWeary && p.islandId !== homeIslandId(c.id);
  if (rescued) {
    p.islandId = homeIslandId(c.id);
    p.x = HOME_DOCK.x;
    p.z = HOME_DOCK.z - 2.5;
  }

  delete world.battles[b.id];
  p.battleId = null;
  events.push({ t: 'battleEnd', playerId: c.id, battleId: b.id, result, exp: Object.fromEntries(exp), levelUps, captured, rescued });
}

/** 放弃战斗（例如断线）：按战败处理。 */
export function forfeitBattle(content: ContentDb, world: WorldState, battleId: string, events: WorldEvent[]): void {
  const b = world.battles[battleId];
  if (!b) return;
  b.state = { ...b.state, outcome: { winner: 1, reason: 'defeat' } };
  finishBattle(content, world, b, events);
}
