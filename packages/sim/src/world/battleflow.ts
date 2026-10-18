import { affinityLevel, type Cloudlord, type ContentDb, type Situation } from '@cloudsea/content';
import { AI_PRESETS, chooseActions } from '../battle/ai';
import { activeUnits, createBattle, resolveTurn, unitAt, validateActions } from '../battle/engine';
import { capturedSpirits, conditionFromUnit, expRewards, resultFor } from '../battle/rewards';
import { EXTRA_ACTION_OFFSET, type BattleAction, type BattleState, type SideActions } from '../battle/types';
import { createRng, deriveSeed } from '../rng';
import { isDowned } from '../spirit/condition';
import { generateWildGenes } from '../spirit/genes';
import { addExp, createSpirit } from '../spirit/spirit';
import type { Spirit } from '../spirit/types';
import { homeIslandId } from './create';
import type { WorldEvent } from './events';
import { hasRoomForSpirit, spiritCapacity, spiritCount } from './home';
import { newId } from './ids';
import { AFFINITY, changeAffinity, keeperAffinity, keeperBattleBlocker, pickLine } from './keeper';
import { HOME_DOCK } from './layout';
import type { ActiveBattle, CharacterState, WorldState } from './state';
import { dayOf, TICKS_PER_SECOND } from './time';
import { weatherAt } from './weather';
import { makeWildSpirit } from './wild';

export const NO_READY_SPIRITS = '队伍里的絮灵都倒下了：回家园岛到核心塔附近恢复，或喂暖心包立刻回满（码头商队有卖）';

/** 多人战斗的选择倒计时（DESIGN 5.1：30 秒，按 tick 计）。 */
export const BATTLE_CHOICE_TICKS = 30 * TICKS_PER_SECOND;
/** 野外合作最多 3 人、云主战最多 4 人（DESIGN 5.3）。 */
const MAX_PARTICIPANTS = { wild: 3, cloudlord: 4 } as const;
/** 云主在灯塔岛上的位置（岛的局部坐标；渲染端同一处摆放）。 */
export const CLOUDLORD_SPOT = { x: 0, z: -6 } as const;
/** 灯塔守卫站的位置（M3-2）。 */
export const GUARDIAN_SPOT = { x: 5, z: -2 } as const;

/** 能出战的队伍成员：生命大于 0、未蚀化、不在净化或蛋里（DESIGN 4.8，v0.7）。 */
export function battleReady(content: ContentDb, c: CharacterState): Spirit[] {
  return c.party.map((id) => c.spirits[id]!).filter((s) => s && !isDowned(content, s) && !s.blighted && s.state === 'party');
}

function markSeen(c: CharacterState, formIds: readonly string[]): void {
  for (const f of formIds) if (!c.codex.seen.includes(f)) c.codex.seen.push(f);
}

type NewBattle = Omit<ActiveBattle, 'participants' | 'submitted' | 'deadlineTick' | 'cloudlordId'> & { cloudlordId?: string };

function begin(world: WorldState, nb: NewBattle, events: WorldEvent[]): string {
  const b: ActiveBattle = { ...nb, participants: [nb.playerId], submitted: {}, deadlineTick: null, cloudlordId: nb.cloudlordId ?? null };
  world.battles[b.id] = b;
  world.players[b.playerId]!.battleId = b.id;
  events.push({ t: 'battleStart', playerId: b.playerId, battleId: b.id });
  return b.id;
}

/** 在线的参战者（离线的玩家其位置按防御处理）。 */
function online(world: WorldState, b: ActiveBattle): string[] {
  return b.participants.filter((id) => !!world.characters[id]);
}

function isMulti(b: ActiveBattle): boolean {
  return b.participants.length > 1;
}

/**
 * 多人一方的出战名单（DESIGN 5.3，M2）：每人先出 1 只占一个位置（按加入顺序），剩下的位置归发起者；
 * 加入者另带 1 只替补；发起者的其余絮灵做替补。
 */
function partySpirits(content: ContentDb, world: WorldState, participants: readonly string[], slots: number, perPlayer: number): Spirit[] {
  const lists = participants.map((id) => battleReady(content, world.characters[id]!));
  const firsts = lists.map((l) => l[0]).filter((s): s is Spirit => !!s);
  const initRest = lists[0]!.slice(1, perPlayer);
  const fill = initRest.slice(0, Math.max(0, slots - firsts.length));
  const joinRest = lists.slice(1).flatMap((l) => l.slice(1, 2));
  return [...firsts, ...fill, ...initRest.slice(fill.length), ...joinRest];
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
  const existing = Object.values(world.battles).find((b) => b.wildId === wildId);
  if (existing) return existing.state.turn === 1 && existing.participants.length < MAX_PARTICIPANTS.wild ? '它正在和别人战斗：靠近按“加入”一起打' : '它正在和别人战斗';
  const ready = battleReady(content, c);
  if (ready.length === 0) return NO_READY_SPIRITS;
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

/** 新手引导第一战的对手只有正常生命的 60%（DESIGN 13，v0.7）。 */
export const TUTORIAL_FOE_HP = 0.6;

function weakenFoes(state: BattleState, scale: number): BattleState {
  const units = state.sides[1].units.map((u) => {
    const hp = Math.max(1, Math.round(u.maxHp * scale));
    return { ...u, maxHp: hp, hp };
  });
  return { ...state, sides: [state.sides[0], { ...state.sides[1], units }] };
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
  const ready = battleReady(content, c);
  if (ready.length === 0) return NO_READY_SPIRITS;
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
  const partner = battleReady(content, c)[0];
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
      state: weakenFoes(
        createBattle(content, {
          kind: 'scripted',
          sides: [{ spirits: [partner], slots: 1 }, { spirits: [foe] }],
          baseWeather: 'sun',
          seed,
          protectedSide: 0,
        }),
        TUTORIAL_FOE_HP,
      ),
    },
    events,
  );
}

// ---------------------------------------------------------------- 云主战（DESIGN 5.3，M2）

/** 云主一方的絮灵（确定性：按世界种子生成基因；渲染端也用它摆出云主与护卫）。 */
export function cloudlordSpirits(content: ContentDb, world: WorldState, cl: Cloudlord): Spirit[] {
  return [cl.boss, ...cl.guards].map((u, i) => {
    const rng = createRng(deriveSeed(world.seed, `cloudlord:${cl.id}:${i}`));
    const line = content.lines.get(u.line)!;
    return createSpirit(content, { id: `${cl.id}-${i}`, ownerId: 'cloudlord', genes: generateWildGenes(rng, line), level: u.level, formIndex: u.formIndex, blighted: true });
  });
}

/** 云主战的战斗状态：玩家方位置数 = 人数（单人 3），云主生命按人数缩放，云主每回合多行动、按阶段换招。 */
function cloudlordState(content: ContentDb, world: WorldState, cl: Cloudlord, participants: readonly string[], seed: number): BattleState {
  const n = participants.length;
  const slots = n === 1 ? 3 : n;
  const mine = partySpirits(content, world, participants, slots, n === 1 ? 6 : 2);
  const state = createBattle(content, {
    kind: 'cloudlord',
    sides: [{ spirits: mine, slots }, { spirits: cloudlordSpirits(content, world, cl) }],
    baseWeather: cl.weather,
    seed,
  });
  const scale = cl.hpScale[Math.min(4, Math.max(1, n)) - 1]!;
  const units = state.sides[1].units.map((u, i) => {
    if (i !== 0) return u;
    const maxHp = Math.round(u.maxHp * scale);
    return { ...u, name: cl.name, maxHp, hp: maxHp, skills: [...cl.skills], extraActions: cl.extraActions, phases: cl.phases.map((p) => ({ hpBelow: p.hpBelow, skills: p.skills, stages: p.stages, line: p.line })), phase: 0 };
  });
  return { ...state, sides: [state.sides[0], { ...state.sides[1], units }] };
}

/** 在灯塔岛上向云主发起讨伐。 */
export function startCloudlordBattle(content: ContentDb, world: WorldState, playerId: string, cloudlordId: string, events: WorldEvent[]): string {
  const cl = content.cloudlords.get(cloudlordId);
  if (!cl) return '没有这位云主';
  const p = world.players[playerId]!;
  const c = world.characters[playerId]!;
  if (p.battleId) return '已经在战斗中';
  if (p.islandId !== cl.island) return '要先到灯塔岛上';
  if (world.lighthousesLit.includes(cl.id)) return '灯塔已经重新点亮了';
  if (!world.guardiansBeaten.includes(cl.id)) return `先打赢${cl.guardian.name}`;
  if (Object.values(world.battles).some((b) => b.cloudlordId === cl.id)) return '已经有人在讨伐了：靠近按“加入”一起打';
  if (Math.hypot(p.x - CLOUDLORD_SPOT.x, p.z - CLOUDLORD_SPOT.z) > 8) return '再靠近一点';
  if (battleReady(content, c).length === 0) return NO_READY_SPIRITS;
  markSeen(c, cloudlordSpirits(content, world, cl).map((s) => s.formId));
  const id = newId(world, 'b');
  const seed = deriveSeed(world.seed, `battle:${id}`);
  return begin(
    world,
    { id, kind: 'cloudlord', playerId, islandId: p.islandId, wildId: null, keeperId: null, aiSeed: seed, preparedAi: null, cloudlordId: cl.id, state: cloudlordState(content, world, cl, [playerId], seed) },
    events,
  );
}

// ---------------------------------------------------------------- 灯塔守卫（M3-2）

/** 守卫的队伍（确定性）。 */
export function guardianSpirits(content: ContentDb, world: WorldState, cl: Cloudlord): Spirit[] {
  return cl.guardian.team.map((u, i) => {
    const rng = createRng(deriveSeed(world.seed, `guardian:${cl.id}:${i}`));
    const line = content.lines.get(u.line)!;
    const genes = { ...generateWildGenes(rng, line), talents: { hp: 20, power: 20, guard: 20, agility: 20, resonance: 20 } };
    return createSpirit(content, { id: `${cl.id}-g${i}`, ownerId: 'guardian', genes, level: u.level, formIndex: u.formIndex });
  });
}

/** 挑战灯塔守卫（单人，类似道馆）：打赢后世界里就可以讨伐云主了。 */
export function startGuardianBattle(content: ContentDb, world: WorldState, playerId: string, cloudlordId: string, events: WorldEvent[]): string {
  const cl = content.cloudlords.get(cloudlordId);
  if (!cl) return '没有这座灯塔';
  const p = world.players[playerId]!;
  const c = world.characters[playerId]!;
  if (p.battleId) return '已经在战斗中';
  if (p.islandId !== cl.island) return '要先到灯塔岛上';
  if (world.guardiansBeaten.includes(cl.id)) return `已经打赢过${cl.guardian.name}了`;
  if (Math.hypot(p.x - GUARDIAN_SPOT.x, p.z - GUARDIAN_SPOT.z) > 6) return '再靠近一点';
  const ready = battleReady(content, c);
  if (ready.length === 0) return NO_READY_SPIRITS;
  const team = guardianSpirits(content, world, cl);
  markSeen(c, team.map((s) => s.formId));
  events.push({ t: 'npcLine', playerId, speaker: cl.guardian.name, lines: [cl.guardian.lines.intro] });
  const id = newId(world, 'b');
  const seed = deriveSeed(world.seed, `battle:${id}`);
  return begin(
    world,
    {
      id,
      kind: 'guardian',
      playerId,
      islandId: p.islandId,
      wildId: null,
      keeperId: null,
      aiSeed: seed,
      preparedAi: null,
      cloudlordId: cl.id,
      state: createBattle(content, { kind: 'guardian', sides: [{ spirits: ready }, { spirits: team }], baseWeather: cl.weather, seed }),
    },
    events,
  );
}

// ---------------------------------------------------------------- 加入（DESIGN 5.3，M2）

/** 同岛玩家在第一回合结算前加入野外战斗或云主战；按新的人数重建战斗。 */
export function joinBattle(content: ContentDb, world: WorldState, playerId: string, battleId: string, events: WorldEvent[]): string | null {
  const b = world.battles[battleId];
  if (!b) return '这场战斗已经结束了';
  if (b.kind !== 'wild' && b.kind !== 'cloudlord') return '这场战斗不能加入';
  if (b.participants.includes(playerId)) return '已经在这场战斗里了';
  if (b.state.turn !== 1) return '已经打起来了，下次早点来';
  const p = world.players[playerId]!;
  if (p.battleId) return '已经在战斗中';
  if (p.islandId !== b.islandId || p.voyage) return '不在同一座岛上';
  if (b.participants.length >= MAX_PARTICIPANTS[b.kind]) return '人已经满了';
  const c = world.characters[playerId]!;
  if (battleReady(content, c).length === 0) return NO_READY_SPIRITS;
  b.participants.push(playerId);
  p.battleId = b.id;
  rebuildBattle(content, world, b);
  markSeen(c, b.state.sides[1].units.map((u) => u.formId));
  events.push({ t: 'battleStart', playerId, battleId: b.id });
  for (const pid of b.participants) events.push({ t: 'battleJoined', playerId: pid, battleId: b.id, joiner: playerId });
  return null;
}

/** 按当前参战者重建战斗（只在第一回合结算前）：位置、替补、云主生命都按人数重算，已选的行动作废。 */
function rebuildBattle(content: ContentDb, world: WorldState, b: ActiveBattle): void {
  if (b.kind === 'cloudlord' && b.cloudlordId) {
    b.state = cloudlordState(content, world, content.cloudlords.get(b.cloudlordId)!, b.participants, b.aiSeed);
  } else if (b.kind === 'wild' && b.wildId) {
    const wild = world.islands[b.islandId]?.wild[b.wildId];
    const island = content.islands.get(b.islandId)!;
    const n = b.participants.length;
    b.state = createBattle(content, {
      kind: 'wild',
      sides: [{ spirits: partySpirits(content, world, b.participants, 3, n === 1 ? 6 : 6 - 2 * (n - 1)), slots: 3 }, { spirits: wild?.group ?? [], wild: true }],
      baseWeather: b.state.field.base ?? weatherAt(world.seed, island.region, world.tick),
      seed: b.aiSeed,
    });
  }
  b.submitted = {};
  b.preparedAi = null;
  b.deadlineTick = isMulti(b) ? world.tick + BATTLE_CHOICE_TICKS : null;
}

// ---------------------------------------------------------------- 行动与结算

function aiActions(content: ContentDb, b: ActiveBattle): SideActions {
  if (b.kind === 'scripted') {
    return Object.fromEntries(Object.keys(b.state.sides[1].active).map((slot) => [slot, { type: 'skill', skillId: 'jab', target: { side: 0, slot: 0 } } as BattleAction]));
  }
  const opts = { ...aiFor(b), seed: b.aiSeed };
  const first = chooseActions(content, b.state, 1, opts);
  // 云主：额外行动（键 = 位置 + EXTRA_ACTION_OFFSET），按第一次花掉云气后的余量再选一次
  const extra: Record<number, BattleAction> = {};
  for (const { slot, unit } of activeUnits(b.state, 1)) {
    if (unit.extraActions <= 0 || unit.charging) continue;
    const spent = Object.values(first).reduce((a, x) => a + (x.type === 'skill' ? content.skills.get(x.skillId)!.qiCost : 0), 0);
    const s1 = b.state.sides[1];
    const trial: BattleState = { ...b.state, sides: [b.state.sides[0], { ...s1, qi: Math.max(0, s1.qi - spent) }] };
    const again = chooseActions(content, trial, 1, { ...opts, seed: opts.seed + 7 })[slot];
    if (again && again.type === 'skill') extra[slot + EXTRA_ACTION_OFFSET] = again;
  }
  return { ...first, ...extra };
}

function aiFor(b: ActiveBattle) {
  if (b.kind === 'keeper' || b.kind === 'cloudlord' || b.kind === 'guardian') return AI_PRESETS.normal;
  if (b.kind === 'scripted') return AI_PRESETS.easy;
  return AI_PRESETS.wild;
}

const DEW_ITEM = { normal: 'lanternDew', refined: 'refinedDew', superior: 'superiorDew' } as const;

function dewNeeds(actions: SideActions): Record<string, number> {
  const need: Record<string, number> = {};
  for (const a of Object.values(actions)) if (a.type === 'dew') need[DEW_ITEM[a.quality]] = (need[DEW_ITEM[a.quality]] ?? 0) + 1;
  return need;
}

/**
 * 提交玩家本回合的行动（只能指挥自己的絮灵）。单人：立刻结算；多人：等所有在线参战者都选好，
 * 或者到了截止 tick（DESIGN 5.1，30 秒）再结算。
 */
export function submitBattleActions(content: ContentDb, world: WorldState, playerId: string, battleId: string, actions: SideActions, events: WorldEvent[]): string | null {
  const b = world.battles[battleId];
  if (!b || !b.participants.includes(playerId)) return '没有这场战斗';
  const c = world.characters[playerId]!;
  for (const k of Object.keys(actions)) {
    const u = unitAt(b.state, { side: 0, slot: Number(k) });
    if (!u || u.ownerId !== playerId) return '只能指挥自己的絮灵';
  }
  for (const { slot, unit } of activeUnits(b.state, 0)) {
    if (unit.ownerId === playerId && !unit.charging && !(slot in actions)) return `位置 ${slot} 还没有选择行动`;
  }
  const others: Record<number, BattleAction> = {};
  for (const [pid, a] of Object.entries(b.submitted)) if (pid !== playerId) Object.assign(others, a);
  const err = validateActions(content, b.state, 0, { ...others, ...actions }, { requireAll: false });
  if (err) return err;

  // 灯露：背包里要有、捕获后要放得下（结算时才扣，免得有人加入重建战斗时白扣）
  const need = dewNeeds(actions);
  const dews = Object.values(need).reduce((a, n) => a + n, 0);
  if (dews > 0) {
    if (spiritCapacity(content, world.homes[playerId]!) - spiritCount(c) < dews) return '絮灵已经住满了，先建栖巢或放归一些';
    for (const [item, n] of Object.entries(need)) if ((c.backpack[item] ?? 0) < n) return `${content.items.get(item)!.name} 不够`;
  }

  b.submitted[playerId] = actions;
  const waiting = online(world, b).filter((pid) => !b.submitted[pid] && activeUnits(b.state, 0).some((a) => a.unit.ownerId === pid && !a.unit.charging));
  if (waiting.length === 0) resolveBattleTurn(content, world, b, events);
  return null;
}

/** 结算一回合：合并各人的行动，没选的位置按防御（超时，不回云气），AI 选对手，然后广播给每位参战者。 */
function resolveBattleTurn(content: ContentDb, world: WorldState, b: ActiveBattle, events: WorldEvent[]): void {
  const merged: Record<number, BattleAction> = {};
  for (const [pid, a] of Object.entries(b.submitted)) {
    const c = world.characters[pid];
    if (!c) continue;
    // 扣灯露（不够了就改成防御）
    for (const [k, act] of Object.entries(a)) {
      if (act.type === 'dew') {
        const item = DEW_ITEM[act.quality];
        if ((c.backpack[item] ?? 0) <= 0) {
          merged[Number(k)] = { type: 'skill', skillId: 'guard', timeout: true };
          continue;
        }
        c.backpack[item]! -= 1;
        if (c.backpack[item] === 0) delete c.backpack[item];
      }
      merged[Number(k)] = act;
    }
  }
  for (const { slot, unit } of activeUnits(b.state, 0)) {
    if (!unit.charging && !(slot in merged)) merged[slot] = { type: 'skill', skillId: 'guard', timeout: true };
  }
  const ai = b.preparedAi ?? aiActions(content, b);
  const r = resolveTurn(content, b.state, [merged, ai]);
  b.state = r.state;
  b.submitted = {};
  // 听风看破了对手：下回合的选择现在就定下来并公开
  b.preparedAi = !b.state.outcome && b.state.revealed.some((uid) => uid.startsWith('1:')) ? aiActions(content, b) : null;
  b.deadlineTick = isMulti(b) ? world.tick + BATTLE_CHOICE_TICKS : null;
  for (const pid of online(world, b)) events.push({ t: 'battleTurn', playerId: pid, battleId: b.id, events: r.events });
  if (b.state.outcome) finishBattle(content, world, b, events);
}

/** 每 tick：多人战斗到了截止时间就按已选的结算；参战者全部离线的战斗直接撤掉。 */
export function tickBattles(content: ContentDb, world: WorldState, events: WorldEvent[]): void {
  for (const b of Object.values(world.battles)) {
    if (online(world, b).length === 0) {
      delete world.battles[b.id];
      for (const pid of b.participants) if (world.players[pid]) world.players[pid]!.battleId = null;
      continue;
    }
    if (b.deadlineTick !== null && world.tick >= b.deadlineTick) resolveBattleTurn(content, world, b, events);
  }
}

/** 玩家离开世界时的战斗处理：单人战斗按认输结算；多人战斗把他移出，剩下的人继续（他的位置每回合按防御）。 */
export function leaveBattles(content: ContentDb, world: WorldState, playerId: string, events: WorldEvent[]): void {
  const p = world.players[playerId];
  const b = p?.battleId ? world.battles[p.battleId] : undefined;
  if (!p || !b) return;
  if (!isMulti(b)) {
    forfeitBattle(content, world, b.id, events);
    return;
  }
  b.participants = b.participants.filter((id) => id !== playerId);
  delete b.submitted[playerId];
  p.battleId = null;
  if (b.participants.length === 1) b.deadlineTick = null;
}

/**
 * 结算（DESIGN 5.4，M2 多人）：经验、伤势各归各的絮灵；云贝每位参战者都得；捕获归扔灯露的人；
 * 全员倒下且不在家的参战者被商队送回家；云主被打败时灯塔重燃。
 */
export function finishBattle(content: ContentDb, world: WorldState, b: ActiveBattle, events: WorldEvent[]): void {
  const result = resultFor(b.state, 0)!;
  const exp = expRewards(content, b.state, 0);
  const levelUps: string[] = [];
  const ownerOf = new Map(b.state.sides[0].units.map((u) => [u.spiritId, u.ownerId]));
  for (const [id, amount] of exp) {
    const c = world.characters[ownerOf.get(id) ?? ''];
    const s = c?.spirits[id];
    if (!c || !s) continue;
    const next = addExp(s, amount);
    if (next.level > s.level) levelUps.push(id);
    c.spirits[id] = next;
  }
  // 伤势延续：玩家絮灵的生命、层数、异常带到下一场（DESIGN 4.8，v0.7）
  for (const u of b.state.sides[0].units) {
    const c = world.characters[u.ownerId];
    const s = c?.spirits[u.spiritId];
    if (c && s) c.spirits[u.spiritId] = { ...s, condition: conditionFromUnit(b.state, u) };
  }

  const captured: string[] = [];
  const wildGroup = b.wildId ? (world.islands[b.islandId]?.wild[b.wildId]?.group ?? []) : [];
  for (const wid of capturedSpirits(b.state, 0)) {
    const w = wildGroup.find((s) => s.id === wid);
    const unit = b.state.sides[1].units.find((u) => u.spiritId === wid);
    const ownerId = (unit && b.state.capturedBy[unit.uid]) ?? b.playerId;
    const c = world.characters[ownerId];
    if (!w || !c || !hasRoomForSpirit(content, world, c)) continue;
    const id = `${c.id}-s${c.nextSpiritSeq++}`;
    const inParty = !w.blighted && c.party.length < 6;
    c.spirits[id] = { ...w, id, ownerId: c.id, state: inParty ? 'party' : 'idle', condition: unit ? conditionFromUnit(b.state, unit) : null };
    if (inParty) c.party.push(id);
    if (!c.codex.caught.includes(w.formId)) c.codex.caught.push(w.formId);
    if (!c.memoryShards.includes(w.formId)) c.memoryShards.push(w.formId);
    c.stats.caught++;
    captured.push(id);
  }

  const members = online(world, b);
  if (result === 'win') {
    const enemyLevels = b.state.sides[1].units.reduce((a, u) => a + u.level, 0);
    const cl = b.cloudlordId ? content.cloudlords.get(b.cloudlordId) : undefined;
    const guardian = b.kind === 'guardian' && cl ? cl.guardian : undefined;
    const shells = guardian ? guardian.reward.shells : cl ? cl.reward.shells : b.kind === 'keeper' ? 120 : b.kind === 'scripted' ? 0 : 3 * enemyLevels;
    for (const pid of members) {
      const c = world.characters[pid]!;
      c.stats.battlesWon++;
      if (shells > 0) {
        c.shells += shells;
        events.push({ t: 'shells', playerId: c.id, delta: shells });
      }
      if (b.kind === 'wild' && wildGroup.some((s) => s.blighted)) {
        c.backpack['mistCrystal'] = (c.backpack['mistCrystal'] ?? 0) + 1;
        events.push({ t: 'items', playerId: c.id, item: 'mistCrystal', count: 1, where: 'backpack' });
      }
      if (guardian) {
        for (const st of guardian.reward.items) {
          c.backpack[st.item] = (c.backpack[st.item] ?? 0) + st.count;
          events.push({ t: 'items', playerId: c.id, item: st.item, count: st.count, where: 'backpack' });
        }
      } else if (cl) {
        const lordForm = b.state.sides[1].units[0]!.formId;
        if (!c.memoryShards.includes(lordForm)) c.memoryShards.push(lordForm);
      }
    }
    if (guardian && cl && !world.guardiansBeaten.includes(cl.id)) {
      world.guardiansBeaten.push(cl.id);
      for (const pid of members) events.push({ t: 'npcLine', playerId: pid, speaker: guardian.name, lines: [guardian.lines.win] });
    } else if (cl && b.kind === 'cloudlord' && !world.lighthousesLit.includes(cl.id)) {
      world.lighthousesLit.push(cl.id);
      world.chapter = world.lighthousesLit.length + 1;
      for (const pid of members) events.push({ t: 'lighthouseLit', playerId: pid, cloudlordId: cl.id });
      // 五座灯塔全部重燃：终章
      if ([...content.cloudlords.keys()].every((id) => world.lighthousesLit.includes(id))) for (const pid of members) events.push({ t: 'finale', playerId: pid });
    }
  }
  if (result !== 'win' && b.kind === 'guardian' && b.cloudlordId) {
    const g = content.cloudlords.get(b.cloudlordId)?.guardian;
    if (g) for (const pid of members) events.push({ t: 'npcLine', playerId: pid, speaker: g.name, lines: [g.lines.lose] });
  }
  if (b.wildId && (result === 'win' || captured.length > 0)) delete world.islands[b.islandId]?.wild[b.wildId];

  if (b.keeperId) {
    const c = world.characters[b.playerId];
    const k = world.keepers[b.keeperId]!;
    if (c) {
      changeAffinity(world, k, c.id, result === 'win' ? AFFINITY.battleWin : AFFINITY.battleLose, events);
      const situation: Situation = result === 'win' ? 'battleLose' : 'battleWin';
      const level = affinityLevel(keeperAffinity(k, c.id));
      events.push({ t: 'dialogue', playerId: c.id, keeperId: k.id, lines: [pickLine(content, k.id, situation, level, createRng(deriveSeed(world.seed, `end:${b.id}`)))] });
    }
  }

  delete world.battles[b.id];
  for (const pid of b.participants) {
    const p = world.players[pid];
    if (p) p.battleId = null;
  }
  for (const pid of members) {
    const c = world.characters[pid]!;
    const p = world.players[pid]!;
    // 全员倒下且不在家：商队顺路搭救
    const allDown = c.party.length > 0 && c.party.every((id) => { const s = c.spirits[id]; return !s || s.blighted || isDowned(content, s); });
    const rescued = (result === 'lose' || result === 'draw') && allDown && p.islandId !== homeIslandId(c.id);
    if (rescued) {
      p.islandId = homeIslandId(c.id);
      p.x = HOME_DOCK.x;
      p.z = HOME_DOCK.z - 2.5;
    }
    events.push({ t: 'battleEnd', playerId: c.id, battleId: b.id, result, exp: Object.fromEntries(exp), levelUps, captured, rescued });
  }
}

/** 放弃战斗（例如断线）：按战败处理。 */
export function forfeitBattle(content: ContentDb, world: WorldState, battleId: string, events: WorldEvent[]): void {
  const b = world.battles[battleId];
  if (!b) return;
  b.state = { ...b.state, outcome: { winner: 1, reason: 'defeat' } };
  finishBattle(content, world, b, events);
}

/**
 * 玩家离开世界前的收尾（M2）：战斗按 leaveBattles 处理；正在航行的直接到达目的地；
 * 然后把角色从世界里拿走并返回（客人带回本机保存）。
 */
export function playerLeaves(content: ContentDb, world: WorldState, playerId: string, events: WorldEvent[]): CharacterState | undefined {
  leaveBattles(content, world, playerId, events);
  const p = world.players[playerId];
  if (p?.voyage) {
    p.islandId = p.voyage.to;
    p.voyage = null;
  }
  const c = world.characters[playerId];
  if (c) events.push({ t: 'playerLeft', playerId, name: c.name });
  delete world.characters[playerId];
  return c;
}
