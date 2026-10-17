import {
  AILMENT_INFO,
  GENERATES,
  PART_SLOTS,
  STAGE_STATS,
  type ContentDb,
  type Element,
  type Skill,
  type SkillEffect,
  type StageStat,
} from '@cloudsea/content';
import { createRng, type Rng } from '../rng';
import { elementsOf } from '../spirit/genes';
import { computeStats, expressedParts, formOf, passiveSkills } from '../spirit/spirit';
import type { Spirit } from '../spirit/types';
import {
  BATTLE,
  baseDamage,
  catchChance,
  effectiveness,
  evasionMultiplier,
  fleeChance,
  resonanceFactor,
  stageMultiplier,
  weatherMultiplier,
} from './formulas';
import { EXTRA_ACTION_OFFSET } from './types';
import type {
  BattleAction,
  BattleEvent,
  BattleKind,
  BattleState,
  BattleUnit,
  Side,
  SideActions,
  SideIndex,
  SkillMod,
  SlotRef,
} from './types';

/** 所有絮灵都有、不占装备栏的基础动作。 */
export const BASIC_ACTIONS = ['jab', 'guard'] as const;

// ---------------------------------------------------------------- 开战

export interface BattleSideSetup {
  readonly spirits: readonly Spirit[];
  /** 野生方：可被捕获，可逃跑。 */
  readonly wild?: boolean;
  /** 位置数，默认 min(3, 可出战数)。 */
  readonly slots?: number;
}

export interface BattleSetup {
  readonly kind: BattleKind;
  readonly sides: readonly [BattleSideSetup, BattleSideSetup];
  /** 基准天候 = 当地当前天气；室内 / 巢穴为 null。 */
  readonly baseWeather: Element | null;
  readonly seed: number;
  /** 新手引导战斗：该方不会被击倒。 */
  readonly protectedSide?: SideIndex;
}

function buildUnit(content: ContentDb, spirit: Spirit, side: SideIndex, index: number, wild: boolean): BattleUnit {
  const { form, line } = formOf(content, spirit);
  const stats = computeStats(content, spirit);
  const parts = expressedParts(content, spirit);
  const skillMods: Record<string, SkillMod> = {};
  for (const slot of PART_SLOTS) {
    const partId = parts[slot];
    if (!partId || !spirit.genes.parts[slot].mutated) continue;
    const part = content.parts.get(partId)!;
    skillMods[part.skill] = {
      powerMultiplier: part.mutation.powerMultiplier ?? 1,
      extraEffects: part.mutation.extraEffects ?? [],
    };
  }
  const passiveEffects = passiveSkills(content, spirit).flatMap((id) => [
    ...content.skills.get(id)!.effects,
    ...(skillMods[id]?.extraEffects ?? []),
  ]);
  // 伤势延续（DESIGN 4.8，v0.7）：只有带着 condition 的絮灵（玩家的）会延续生命、层数与异常
  const cond = spirit.condition;
  const stages = emptyStages();
  for (const [k, v] of Object.entries(cond?.stages ?? {})) stages[k as StageStat] = v ?? 0;
  return {
    uid: `${side}:${index}`,
    spiritId: spirit.id,
    ownerId: spirit.ownerId,
    formId: form.id,
    lineId: line.id,
    name: spirit.nickname ?? form.name,
    level: spirit.level,
    elements: elementsOf(content, spirit.genes),
    rarity: line.rarity,
    stats,
    maxHp: stats.hp,
    hp: cond ? Math.max(0, Math.min(stats.hp, Math.floor(cond.hp))) : stats.hp,
    skills: [...spirit.skillSlots],
    passiveEffects,
    skillMods,
    wild,
    blighted: spirit.blighted,
    ailment: cond?.ailment ? { ...cond.ailment } : null,
    stages,
    timedStages: (cond?.timedStages ?? []).map((t) => ({ stat: t.stat, delta: t.delta, endsAfterTurn: t.turnsLeft })),
    extraActions: 0,
    phases: [],
    phase: 0,
    downed: false,
    captured: false,
    charging: null,
    empower: 1,
    guarding: 1,
    actLast: false,
    participated: false,
  };
}

function emptyStages(): Record<StageStat, number> {
  return Object.fromEntries(STAGE_STATS.map((s) => [s, 0])) as Record<StageStat, number>;
}

export function createBattle(content: ContentDb, setup: BattleSetup): BattleState {
  const sides = setup.sides.map((sideSetup, sideIdx) => {
    if (sideSetup.spirits.length === 0) throw new Error(`side ${sideIdx} has no spirits`);
    const units = sideSetup.spirits.map((sp, i) => buildUnit(content, sp, sideIdx as SideIndex, i, !!sideSetup.wild));
    const slotCount = Math.max(1, Math.min(sideSetup.slots ?? BATTLE.slots, units.length));
    const active = units.slice(0, slotCount).map((u, i) => {
      u.participated = true;
      return i;
    });
    return { units, active, qi: BATTLE.startQi, qiRestoredThisTurn: false } satisfies Side;
  }) as [Side, Side];
  return {
    version: 1,
    kind: setup.kind,
    turn: 1,
    sides,
    field: { base: setup.baseWeather, current: setup.baseWeather, turnsLeft: 0 },
    rngState: setup.seed >>> 0,
    outcome: null,
    intercepts: {},
    revealed: [],
    protectedSide: setup.protectedSide ?? null,
    capturedBy: {},
  };
}

// ---------------------------------------------------------------- 查询

export function cloneBattle(state: BattleState): BattleState {
  return JSON.parse(JSON.stringify(state)) as BattleState;
}

export function other(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

export function unitAt(state: BattleState, ref: SlotRef): BattleUnit | null {
  const side = state.sides[ref.side];
  const idx = side.active[ref.slot];
  return idx === undefined || idx === null ? null : (side.units[idx] ?? null);
}

export function isAlive(u: BattleUnit | null | undefined): u is BattleUnit {
  return !!u && !u.downed && !u.captured;
}

export function findUnit(state: BattleState, uid: string): { side: SideIndex; index: number; unit: BattleUnit } {
  const [s, i] = uid.split(':').map(Number) as [SideIndex, number];
  return { side: s, index: i, unit: state.sides[s].units[i]! };
}

export function slotOf(state: BattleState, uid: string): SlotRef | null {
  const { side, index } = findUnit(state, uid);
  const slot = state.sides[side].active.indexOf(index);
  return slot < 0 ? null : { side, slot };
}

/** 场上活着的单位与其位置。 */
export function activeUnits(state: BattleState, side: SideIndex): Array<{ slot: number; unit: BattleUnit }> {
  const out: Array<{ slot: number; unit: BattleUnit }> = [];
  state.sides[side].active.forEach((idx, slot) => {
    const u = idx === null ? null : state.sides[side].units[idx];
    if (isAlive(u)) out.push({ slot, unit: u });
  });
  return out;
}

/** 可以换上场的替补下标。 */
export function benchUnits(state: BattleState, side: SideIndex): number[] {
  const s = state.sides[side];
  return s.units.flatMap((u, i) => (isAlive(u) && !s.active.includes(i) ? [i] : []));
}

export function availableSkills(unit: BattleUnit): string[] {
  return [...unit.skills, ...BASIC_ACTIONS];
}

export function effectiveStage(unit: BattleUnit, stat: StageStat): number {
  const total = unit.stages[stat] + unit.timedStages.filter((t) => t.stat === stat).reduce((a, t) => a + t.delta, 0);
  return Math.max(-BATTLE.maxStage, Math.min(BATTLE.maxStage, total));
}

export function effectiveAgility(unit: BattleUnit): number {
  const unbalanced = unit.ailment?.id === 'unbalanced' ? AILMENT_INFO.unbalanced.effect : null;
  const ailmentMult = unbalanced?.kind === 'statMultiplier' ? unbalanced.multiplier : 1;
  return unit.stats.agility * stageMultiplier(effectiveStage(unit, 'agility')) * ailmentMult;
}

function skillElement(skill: Skill, unit: BattleUnit): Element {
  return skill.element === 'user' ? unit.elements[0]! : skill.element;
}

/** 技能的实际威力（含灵巧加成与异化倍率）。 */
export function skillPower(skill: Skill, unit: BattleUnit): number {
  let power = skill.power;
  if (skill.powerBonus) power += Math.floor(unit.stats[skill.powerBonus.stat] / skill.powerBonus.divisor);
  return Math.floor(power * (unit.skillMods[skill.id]?.powerMultiplier ?? 1));
}

/** 连携：相邻队友的主属性相生出本单位的主属性时 +10%（DESIGN 4.1）。 */
export function synergyMultiplier(state: BattleState, ref: SlotRef): number {
  const me = unitAt(state, ref);
  if (!me) return 1;
  for (const d of [-1, 1]) {
    const ally = unitAt(state, { side: ref.side, slot: ref.slot + d });
    if (isAlive(ally) && GENERATES[ally.elements[0]!] === me.elements[0]) return BATTLE.synergyBonus;
  }
  return 1;
}

// ---------------------------------------------------------------- 校验

/** 群体攻击：按技能范围判定，与实际命中几个目标无关。 */
function isGroupSkill(skill: Skill): boolean {
  return skill.target === 'allEnemies' || skill.target === 'twoEnemies';
}

function targetsEnemy(skill: Skill): boolean {
  return skill.target === 'singleEnemy' || skill.target === 'twoEnemies';
}

/** 校验一方本回合的行动；合法返回 null，否则返回原因。 */
/**
 * 校验一方的行动。requireAll = false 时不要求每个位置都选了（多人战斗里先收到的一部分，M2）。
 * 键 ≥ EXTRA_ACTION_OFFSET 是有额外行动的单位（云主）的第二个行动。
 */
export function validateActions(content: ContentDb, state: BattleState, side: SideIndex, actions: SideActions, opts: { requireAll?: boolean } = {}): string | null {
  if (state.outcome) return '战斗已经结束';
  const s = state.sides[side];
  let qi = 0;
  const switchIns = new Set<number>();
  for (const [slotStr, action] of Object.entries(actions)) {
    const key = Number(slotStr);
    const extra = key >= EXTRA_ACTION_OFFSET;
    const slot = extra ? key - EXTRA_ACTION_OFFSET : key;
    const unit = unitAt(state, { side, slot });
    if (!isAlive(unit)) return `位置 ${slot} 没有可行动的絮灵`;
    if (extra && (unit.extraActions <= 0 || action.type !== 'skill')) return `${unit.name} 没有额外行动`;
    if (unit.charging) continue; // 蓄力中的单位自动行动
    switch (action.type) {
      case 'skill': {
        if (!availableSkills(unit).includes(action.skillId)) return `${unit.name} 没有装备 ${action.skillId}`;
        const skill = content.skills.get(action.skillId)!;
        if (skill.passive) return '被动技能不能主动使用';
        qi += skill.qiCost;
        if (targetsEnemy(skill)) {
          if (!action.target || action.target.side === side || !isAlive(unitAt(state, action.target))) {
            return `${skill.name} 需要选择一个敌方目标`;
          }
        }
        if (skill.target === 'singleAlly') {
          const t = action.target && unitAt(state, action.target);
          if (!action.target || action.target.side !== side || !isAlive(t) || t === unit) {
            return `${skill.name} 需要选择一名队友`;
          }
        }
        break;
      }
      case 'switch': {
        if (!benchUnits(state, side).includes(action.unitIndex)) return '只能换上还能战斗的替补';
        if (s.units[action.unitIndex]!.ownerId !== unit.ownerId) return '只能换上自己的替补';
        if (switchIns.has(action.unitIndex)) return '同一只替补不能换上两次';
        switchIns.add(action.unitIndex);
        break;
      }
      case 'dew': {
        if (state.kind !== 'wild') return '只有野外遭遇可以使用灯露';
        const t = unitAt(state, action.target);
        if (action.target.side === side || !isAlive(t) || !t.wild) return '灯露只能对野生絮灵使用';
        break;
      }
      case 'flee':
        if (state.kind !== 'wild') return '这场战斗不能逃跑';
        break;
    }
  }
  if (opts.requireAll !== false) {
    for (const { slot, unit } of activeUnits(state, side)) {
      if (!unit.charging && !(slot in actions)) return `位置 ${slot} 还没有选择行动`;
    }
  }
  if (qi > s.qi) return `云气不足（需要 ${qi}，现有 ${s.qi}）`;
  return null;
}

/** 超时或缺省时的行动：防御（超时不回复云气）。 */
export function defaultActions(state: BattleState, side: SideIndex, timeout = true): SideActions {
  const out: Record<number, BattleAction> = {};
  for (const { slot } of activeUnits(state, side)) out[slot] = { type: 'skill', skillId: 'guard', timeout };
  return out;
}

// ---------------------------------------------------------------- 结算

interface QueueEntry {
  readonly side: SideIndex;
  readonly slot: number;
  readonly unitIndex: number;
  readonly action: BattleAction;
  readonly priority: number;
  readonly tiebreak: number;
  readonly continuing: boolean;
  done: boolean;
}

class TurnResolver {
  readonly events: BattleEvent[] = [];
  readonly rng: Rng;
  readonly queue: QueueEntry[] = [];
  readonly nextRevealed: string[] = [];

  constructor(
    readonly content: ContentDb,
    readonly s: BattleState,
  ) {
    this.rng = createRng(s.rngState);
  }

  run(actions: readonly [SideActions, SideActions]): void {
    const s = this.s;
    s.revealed = [];
    for (const side of [0, 1] as const) {
      let fleeQueued = false;
      for (const { slot, unit } of activeUnits(s, side)) {
        const unitIndex = s.sides[side].active[slot]!;
        let action = actions[side][slot] ?? { type: 'skill', skillId: 'guard', timeout: true };
        const continuing = !!unit.charging;
        if (unit.charging) action = { type: 'skill', skillId: unit.charging.skillId, ...(unit.charging.target ? { target: unit.charging.target } : {}) };
        if (action.type === 'flee') {
          if (fleeQueued) continue;
          fleeQueued = true;
        }
        this.queue.push({
          side,
          slot,
          unitIndex,
          action,
          priority: this.priorityOf(action),
          tiebreak: this.rng.next(),
          continuing,
          done: false,
        });
        // 云主：每回合多行动几次（第二个行动用 位置号 + EXTRA_ACTION_OFFSET 的键）
        for (let k = 0; k < unit.extraActions; k++) {
          const extra = actions[side][slot + EXTRA_ACTION_OFFSET * (k + 1)];
          if (!extra || extra.type !== 'skill') continue;
          this.queue.push({ side, slot, unitIndex, action: extra, priority: this.priorityOf(extra), tiebreak: this.rng.next(), continuing: false, done: false });
        }
      }
    }

    for (let next = this.pickNext(); next && !s.outcome; next = this.pickNext()) {
      next.done = true;
      this.execute(next);
      this.checkPhases();
      this.checkOutcome();
    }
    if (!s.outcome) this.endTurn();
    s.rngState = this.rng.state;
  }

  priorityOf(action: BattleAction): number {
    if (action.type === 'switch' || action.type === 'flee') return 2;
    if (action.type === 'dew') return 0;
    return this.content.skills.get(action.skillId)!.priority;
  }

  /** 动态取下一个行动：优先级 → 是否被推迟 → 灵巧 → 随机。 */
  pickNext(filter?: (e: QueueEntry) => boolean): QueueEntry | undefined {
    let best: QueueEntry | undefined;
    let bestKey: number[] = [];
    for (const e of this.queue) {
      if (e.done || (filter && !filter(e))) continue;
      const u = this.s.sides[e.side].units[e.unitIndex]!;
      const key = [e.priority, u.actLast ? 0 : 1, effectiveAgility(u), e.tiebreak];
      if (!best || compareKeys(key, bestKey) > 0) {
        best = e;
        bestKey = key;
      }
    }
    return best;
  }

  stillActing(e: QueueEntry): BattleUnit | null {
    const u = this.s.sides[e.side].units[e.unitIndex]!;
    return isAlive(u) && this.s.sides[e.side].active[e.slot] === e.unitIndex ? u : null;
  }

  execute(e: QueueEntry): void {
    const unit = this.stillActing(e);
    if (!unit) return;
    switch (e.action.type) {
      case 'switch':
        return this.doSwitch(e.side, e.slot, e.action.unitIndex);
      case 'flee':
        return this.doFlee(e.side);
      case 'dew':
        return this.doDew(e.side, e.action.quality, e.action.target, unit.ownerId);
      case 'skill':
        return this.doSkill(e, unit, e.action);
    }
  }

  doSwitch(side: SideIndex, slot: number, unitIndex: number): void {
    const s = this.s.sides[side];
    const incoming = s.units[unitIndex];
    if (!isAlive(incoming) || s.active.includes(unitIndex)) return;
    const outIdx = s.active[slot];
    const outgoing = outIdx === null || outIdx === undefined ? null : s.units[outIdx]!;
    if (outgoing) resetOnLeave(outgoing);
    s.active[slot] = unitIndex;
    incoming.participated = true;
    this.events.push({ t: 'switch', side, slot, out: outgoing?.uid ?? null, in: incoming.uid });
  }

  doFlee(side: SideIndex): void {
    const best = (sd: SideIndex) => Math.max(0, ...activeUnits(this.s, sd).map((a) => effectiveAgility(a.unit)));
    const success = this.rng.chance(fleeChance(best(side), best(other(side))));
    this.events.push({ t: 'flee', side, success });
    if (success) this.s.outcome = { winner: null, reason: 'fled' };
  }

  doDew(side: SideIndex, quality: 'normal' | 'refined' | 'superior', target: SlotRef, by: string): void {
    const t = unitAt(this.s, target);
    if (!isAlive(t) || !t.wild || target.side === side) return;
    const chance = catchChance(t.rarity, t.hp / t.maxHp, t.ailment !== null, quality);
    const success = this.rng.chance(chance);
    this.events.push({ t: 'captureAttempt', target: t.uid, chance, success });
    if (success) {
      t.captured = true;
      t.charging = null;
      this.s.capturedBy[t.uid] = by;
    }
  }

  doSkill(e: QueueEntry, actor: BattleUnit, action: Extract<BattleAction, { type: 'skill' }>): void {
    const s = this.s;
    const side = s.sides[e.side];
    if (actor.ailment?.id === 'paralyzed') {
      const eff = AILMENT_INFO.paralyzed.effect;
      if (eff.kind === 'skipTurnChance' && this.rng.chance(eff.chance)) {
        this.events.push({ t: 'paralyzedSkip', uid: actor.uid });
        return;
      }
    }
    const skill = this.content.skills.get(action.skillId)!;
    if (!e.continuing) {
      side.qi -= skill.qiCost;
      if (skill.qiCost > 0) this.events.push({ t: 'qi', side: e.side, delta: -skill.qiCost, qi: side.qi });
    }
    this.events.push({ t: 'use', uid: actor.uid, skillId: skill.id });

    if (skill.effects.some((x) => x.kind === 'charge') && !e.continuing) {
      actor.charging = { skillId: skill.id, target: action.target ?? null };
      this.events.push({ t: 'charge', uid: actor.uid, skillId: skill.id });
      return;
    }
    if (e.continuing) actor.charging = null;

    const ref: SlotRef = { side: e.side, slot: e.slot };
    let targets = this.resolveTargets(skill, ref, actor, action.target);
    const effects: SkillEffect[] = [...skill.effects, ...(actor.skillMods[skill.id]?.extraEffects ?? [])];

    // 迷蒙：单体技能有概率改打随机目标（敌我不分，不含自身）
    const hazed = AILMENT_INFO.hazed.effect;
    if (
      actor.ailment?.id === 'hazed' &&
      hazed.kind === 'retargetChance' &&
      (skill.target === 'singleEnemy' || skill.target === 'singleAlly') &&
      this.rng.chance(hazed.chance)
    ) {
      const pool = [...activeUnits(s, 0), ...activeUnits(s, 1)].map((a) => a.unit).filter((u) => u !== actor);
      if (pool.length > 0) {
        const t = this.rng.pick(pool);
        targets = [t];
        this.events.push({ t: 'retarget', uid: actor.uid, target: t.uid });
      }
    }

    // 絮尾护：替队友挡下攻击
    if (skill.power > 0) {
      targets = targets.map((t) => {
        const protectorUid = s.intercepts[t.uid];
        if (!protectorUid || findUnit(s, t.uid).side === e.side) return t;
        const p = findUnit(s, protectorUid).unit;
        delete s.intercepts[t.uid];
        if (!isAlive(p) || slotOf(s, p.uid) === null || targets.includes(p)) return t;
        this.events.push({ t: 'intercept', protector: p.uid, target: t.uid });
        return p;
      });
    }

    const crit = effects.some((x) => x.kind === 'guaranteedCrit' && this.conditionMet(x));
    const synergy = synergyMultiplier(s, ref);
    const hit: BattleUnit[] = [];
    for (const t of targets) {
      if (!isAlive(t)) continue;
      const enemy = findUnit(s, t.uid).side !== e.side;
      if (skill.accuracy !== null && enemy && !this.rollHit(skill, actor, t)) {
        this.events.push({ t: 'miss', uid: actor.uid, target: t.uid });
        continue;
      }
      if (skill.power > 0) this.dealDamage(skill, actor, t, isGroupSkill(skill), crit, synergy);
      hit.push(t);
    }
    if (skill.power > 0) actor.empower = 1;

    for (const effect of effects) {
      if ('when' in effect && effect.when && !this.conditionMet(effect)) continue;
      this.applyEffect(effect, e, actor, hit, synergy, action.timeout === true);
    }
  }

  /** 云主换阶段：生命比例降到阈值以下时换招式、加层数（DESIGN 5.3，M2）。 */
  checkPhases(): void {
    for (const sd of this.s.sides) {
      for (const u of sd.units) {
        if (!isAlive(u)) continue;
        while (u.phase < u.phases.length && u.hp / u.maxHp <= u.phases[u.phase]!.hpBelow) {
          const ph = u.phases[u.phase]!;
          u.phase++;
          u.skills = [...ph.skills];
          this.events.push({ t: 'phase', uid: u.uid, phase: u.phase, line: ph.line });
          for (const st of ph.stages) this.applyStage(u, st.stat, st.delta, undefined);
        }
      }
    }
  }

  conditionMet(effect: SkillEffect): boolean {
    return !('when' in effect) || !effect.when || this.s.field.current === effect.when.fieldWeather;
  }

  resolveTargets(skill: Skill, ref: SlotRef, actor: BattleUnit, target: SlotRef | undefined): BattleUnit[] {
    const s = this.s;
    const enemySide = other(ref.side);
    const fallbackEnemy = (): BattleUnit | null => {
      const list = activeUnits(s, enemySide);
      return list.length ? this.rng.pick(list).unit : null;
    };
    switch (skill.target) {
      case 'self':
        return [actor];
      case 'allAllies':
        return activeUnits(s, ref.side).map((a) => a.unit);
      case 'allEnemies':
        return activeUnits(s, enemySide).map((a) => a.unit);
      case 'singleAlly': {
        const t = target && unitAt(s, target);
        return isAlive(t) ? [t] : [];
      }
      case 'singleEnemy': {
        const t = target && unitAt(s, target);
        const chosen = target && target.side === enemySide && isAlive(t) ? t : fallbackEnemy();
        return chosen ? [chosen] : [];
      }
      case 'twoEnemies': {
        const t = target && unitAt(s, target);
        const primary = target && target.side === enemySide && isAlive(t) ? t : fallbackEnemy();
        if (!primary) return [];
        const pSlot = slotOf(s, primary.uid)!.slot;
        const neighbor = [pSlot + 1, pSlot - 1]
          .map((sl) => unitAt(s, { side: enemySide, slot: sl }))
          .find((u) => isAlive(u));
        const others = activeUnits(s, enemySide).map((a) => a.unit).filter((u) => u !== primary);
        const second = neighbor ?? others[0];
        return second ? [primary, second] : [primary];
      }
    }
  }

  rollHit(skill: Skill, actor: BattleUnit, target: BattleUnit): boolean {
    const dazzled = actor.ailment?.id === 'dazzled' ? AILMENT_INFO.dazzled.effect : null;
    const dazzleMult = dazzled?.kind === 'accuracyMultiplier' ? dazzled.multiplier : 1;
    const chance =
      (skill.accuracy! / 100) *
      stageMultiplier(effectiveStage(actor, 'accuracy')) *
      evasionMultiplier(effectiveStage(target, 'evasion')) *
      dazzleMult;
    return this.rng.next() < Math.min(1, chance);
  }

  dealDamage(skill: Skill, actor: BattleUnit, target: BattleUnit, multi: boolean, guaranteedCrit: boolean, synergy: number): void {
    const el = skillElement(skill, actor);
    const atk = actor.stats.power * stageMultiplier(effectiveStage(actor, 'power'));
    const def = target.stats.guard * stageMultiplier(effectiveStage(target, 'guard'));
    const base = baseDamage(actor.level, skillPower(skill, actor), atk, def);
    const eff = effectiveness(el, target.elements);
    const crit = guaranteedCrit || this.rng.chance(BATTLE.critChance);
    let mult =
      eff *
      weatherMultiplier(el, this.s.field.current) *
      (actor.elements.includes(el) ? BATTLE.affinityBonus : 1) *
      synergy *
      (crit ? BATTLE.critMultiplier : 1) *
      (0.9 + this.rng.next() * 0.1) *
      actor.empower *
      target.guarding;
    const soaked = target.ailment?.id === 'soaked' ? AILMENT_INFO.soaked.effect : null;
    if (soaked?.kind === 'damageTakenMultiplier' && soaked.element === el) mult *= soaked.multiplier;
    if (multi) {
      for (const p of target.passiveEffects) if (p.kind === 'multiTargetDamageTaken') mult *= p.multiplier;
    }
    const amount = Math.max(1, Math.floor(base * mult));
    const floor = this.s.protectedSide !== null && findUnit(this.s, target.uid).side === this.s.protectedSide ? 1 : 0;
    target.hp = Math.max(floor, target.hp - amount);
    this.events.push({ t: 'damage', uid: actor.uid, target: target.uid, amount, crit, effectiveness: eff, hpAfter: target.hp });
    if (target.hp === 0) {
      target.downed = true;
      target.charging = null;
      this.events.push({ t: 'downed', target: target.uid });
    }
  }

  applyEffect(effect: SkillEffect, e: QueueEntry, actor: BattleUnit, hit: BattleUnit[], synergy: number, timeout: boolean): void {
    const s = this.s;
    const resolve = (t: 'targets' | 'self' | 'allAllies' | 'allEnemies' | 'nextAlly'): BattleUnit[] => {
      switch (t) {
        case 'targets':
          return hit.filter(isAlive);
        case 'self':
          return isAlive(actor) ? [actor] : [];
        case 'allAllies':
          return activeUnits(s, e.side).map((a) => a.unit);
        case 'allEnemies':
          return activeUnits(s, other(e.side)).map((a) => a.unit);
        case 'nextAlly': {
          const next = this.pickNext((q) => q.side === e.side && q !== e);
          const u = next && this.stillActing(next);
          return u ? [u] : [];
        }
      }
    };
    switch (effect.kind) {
      case 'stage':
        for (const t of resolve(effect.target)) this.applyStage(t, effect.stat, effect.delta, effect.duration);
        break;
      case 'heal':
        for (const t of resolve(effect.target)) {
          const amount = Math.floor(effect.ratio * t.maxHp * resonanceFactor(this.resonance(actor)) * synergy);
          const before = t.hp;
          t.hp = Math.min(t.maxHp, t.hp + amount);
          this.events.push({ t: 'heal', target: t.uid, amount: t.hp - before, hpAfter: t.hp });
        }
        break;
      case 'cleanse':
        for (const t of resolve(effect.target)) {
          if (!t.ailment) continue;
          this.events.push({ t: 'ailmentEnd', target: t.uid, ailment: t.ailment.id });
          t.ailment = null;
        }
        break;
      case 'ailment':
        for (const t of hit.filter(isAlive)) {
          if (t.ailment) continue;
          if (t.passiveEffects.some((p) => p.kind === 'ailmentImmunity' && p.ailment === effect.ailment)) continue;
          if (!this.rng.chance(effect.chance * resonanceFactor(this.resonance(actor)))) continue;
          t.ailment = { id: effect.ailment, turnsLeft: BATTLE.ailmentDuration };
          this.events.push({ t: 'ailment', target: t.uid, ailment: effect.ailment });
        }
        break;
      case 'setFieldWeather':
        s.field.current = effect.weather;
        s.field.turnsLeft = BATTLE.fieldWeatherTurns;
        this.events.push({ t: 'weather', weather: effect.weather, reverted: false });
        break;
      case 'intercept':
        for (const t of resolve(effect.target)) {
          if (t === actor) continue;
          s.intercepts[t.uid] = actor.uid;
        }
        break;
      case 'revealNextAction':
        for (const t of hit.filter(isAlive)) {
          this.nextRevealed.push(t.uid);
          this.events.push({ t: 'reveal', target: t.uid });
        }
        break;
      case 'actLast':
        for (const t of resolve(effect.target)) t.actLast = true;
        break;
      case 'empowerNextAttack':
        actor.empower = effect.multiplier;
        break;
      case 'guardThisTurn':
        actor.guarding = effect.damageMultiplier;
        break;
      case 'restoreQi': {
        const side = s.sides[e.side];
        if (timeout || side.qiRestoredThisTurn) break;
        const before = side.qi;
        side.qi = Math.min(BATTLE.maxQi, side.qi + effect.amount);
        side.qiRestoredThisTurn = true;
        if (side.qi > before) this.events.push({ t: 'qi', side: e.side, delta: side.qi - before, qi: side.qi });
        break;
      }
      case 'guaranteedCrit':
      case 'charge':
      case 'multiTargetDamageTaken':
      case 'ailmentImmunity':
        break;
    }
  }

  resonance(u: BattleUnit): number {
    return u.stats.resonance * stageMultiplier(effectiveStage(u, 'resonance'));
  }

  applyStage(t: BattleUnit, stat: StageStat, delta: number, duration: number | undefined): void {
    if (duration !== undefined) {
      t.timedStages.push({ stat, delta, endsAfterTurn: this.s.turn + duration - 1 });
    } else {
      t.stages[stat] = Math.max(-BATTLE.maxStage, Math.min(BATTLE.maxStage, t.stages[stat] + delta));
    }
    this.events.push({ t: 'stage', target: t.uid, stat, delta });
  }

  /** 一方是否还有能战斗的絮灵。 */
  canFight(side: SideIndex): boolean {
    return this.s.sides[side].units.some(isAlive);
  }

  checkOutcome(): void {
    const s = this.s;
    if (s.outcome) {
      this.events.push({ t: 'end', outcome: s.outcome });
      return;
    }
    const a = this.canFight(0);
    const b = this.canFight(1);
    if (a && b) return;
    const loser = !a ? 0 : 1;
    const allCaptured = s.sides[loser].units.every((u) => u.captured || u.downed) && s.sides[loser].units.some((u) => u.captured);
    s.outcome = {
      winner: a ? 0 : b ? 1 : null,
      reason: allCaptured && s.sides[loser].units.every((u) => u.captured) ? 'allCaptured' : 'defeat',
    };
    this.events.push({ t: 'end', outcome: s.outcome });
  }

  endTurn(): void {
    const s = this.s;
    for (const side of [0, 1] as const) {
      for (const { unit } of activeUnits(s, side)) {
        if (unit.ailment && --unit.ailment.turnsLeft <= 0) {
          this.events.push({ t: 'ailmentEnd', target: unit.uid, ailment: unit.ailment.id });
          unit.ailment = null;
        }
      }
      for (const u of s.sides[side].units) {
        u.timedStages = u.timedStages.filter((t) => t.endsAfterTurn > s.turn);
        u.guarding = 1;
        u.actLast = false;
      }
      s.sides[side].qiRestoredThisTurn = false;
    }
    if (s.field.current !== s.field.base && --s.field.turnsLeft <= 0) {
      s.field.current = s.field.base;
      s.field.turnsLeft = 0;
      this.events.push({ t: 'weather', weather: s.field.base, reverted: true });
    }
    s.intercepts = {};
    s.revealed = this.nextRevealed.filter((uid) => slotOf(s, uid) !== null);

    // 倒下补位：回合结束时从替补中免费补到空位（DESIGN 5.1）
    for (const side of [0, 1] as const) {
      const sd = s.sides[side];
      sd.active.forEach((idx, slot) => {
        const cur: BattleUnit | null = idx === null ? null : sd.units[idx]!;
        if (cur && !cur.downed && !cur.captured) return;
        // 多人：优先补同一位主人的替补（M2）
        const benches = benchUnits(s, side);
        const bench = (cur && benches.find((i) => sd.units[i]!.ownerId === cur.ownerId)) ?? benches[0];
        if (bench === undefined) {
          if (cur) sd.active[slot] = null;
          return;
        }
        if (cur) resetOnLeave(cur);
        sd.active[slot] = bench;
        sd.units[bench]!.participated = true;
        this.events.push({ t: 'switch', side, slot, out: cur?.uid ?? null, in: sd.units[bench]!.uid });
      });
    }

    s.turn++;
    for (const sd of s.sides) sd.qi = Math.min(BATTLE.maxQi, sd.qi + BATTLE.qiPerTurn);
    this.events.push({ t: 'turnStart', turn: s.turn, qi: [s.sides[0].qi, s.sides[1].qi] });
  }
}

function resetOnLeave(u: BattleUnit): void {
  u.stages = emptyStages();
  u.timedStages = [];
  u.charging = null;
  u.empower = 1;
  u.guarding = 1;
  u.actLast = false;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 结算一个回合。双方行动须先通过 validateActions；不修改传入的 state。 */
export function resolveTurn(
  content: ContentDb,
  state: BattleState,
  actions: readonly [SideActions, SideActions],
): { state: BattleState; events: BattleEvent[] } {
  if (state.outcome) return { state, events: [] };
  const s = cloneBattle(state);
  const r = new TurnResolver(content, s);
  r.run(actions);
  return { state: s, events: r.events };
}
