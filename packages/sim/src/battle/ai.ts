import { GENERATES, type ContentDb, type Element, type Skill } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import {
  activeUnits,
  availableSkills,
  benchUnits,
  effectiveStage,
  isAlive,
  other,
  resolveTurn,
  skillPower,
  validateActions,
} from './engine';
import { baseDamage, BATTLE, effectiveness, evasionMultiplier, stageMultiplier, weatherMultiplier } from './formulas';
import type { BattleAction, BattleState, BattleUnit, SideActions, SideIndex, SlotRef } from './types';

/**
 * 战斗 AI（DESIGN 5.6）：启发式打分选出候选组合，再用战斗模拟器做一层期望值搜索。
 * 难度 = 搜索深度 + 失误率。纯函数、确定性：随机只来自 seed。
 */
export interface AiOptions {
  /** 0 = 只看启发式；1 = 模拟一回合（对手按启发式预测）。 */
  readonly depth: 0 | 1;
  /** 每只单位以此概率随机选一个合法行动。 */
  readonly mistakeRate: number;
  /** 每个候选组合模拟的随机样本数。 */
  readonly samples?: number;
  readonly seed: number;
}

export const AI_PRESETS = {
  wild: { depth: 0, mistakeRate: 0.25 },
  easy: { depth: 0, mistakeRate: 0.15 },
  normal: { depth: 1, mistakeRate: 0.08 },
  hard: { depth: 1, mistakeRate: 0 },
} as const satisfies Record<string, Omit<AiOptions, 'seed'>>;

interface Candidate {
  readonly slot: number;
  readonly action: BattleAction;
  readonly score: number;
  readonly cost: number;
  /** 对单体目标的预计伤害（用于判断集火是否溢出）。 */
  readonly damage?: { readonly uid: string; readonly amount: number; readonly hp: number; readonly maxHp: number };
}

const PER_UNIT = 4;
const GUARD_QI_VALUE = 0.06;
const SEARCH_COMBOS = 8;

export function chooseActions(content: ContentDb, state: BattleState, side: SideIndex, opts: AiOptions): SideActions {
  const rng = createRng(deriveSeed(opts.seed ^ state.rngState, `ai:${side}:${state.turn}`));
  const perUnit = activeUnits(state, side)
    .filter((a) => !a.unit.charging)
    .map((a) => candidatesFor(content, state, side, a.slot, a.unit));
  if (perUnit.length === 0) return {};

  // 失误：该单位改用随机合法行动
  const pools = perUnit.map((cands) => {
    const sorted = [...cands].sort((x, y) => y.score - x.score);
    return rng.chance(opts.mistakeRate) ? [rng.pick(cands)] : sorted.slice(0, PER_UNIT);
  });

  const combos = combine(pools, state.sides[side].qi)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.depth === 0 ? 1 : SEARCH_COMBOS);
  const legal = combos.filter((c) => validateActions(content, state, side, c.actions) === null);
  if (legal.length === 0) return guardAll(state, side);
  if (opts.depth === 0 || legal.length === 1) return legal[0]!.actions;

  const predicted = chooseActions(content, state, other(side), { depth: 0, mistakeRate: 0, seed: opts.seed + 1 });
  const samples = opts.samples ?? 2;
  let best = legal[0]!;
  let bestValue = -Infinity;
  for (const combo of legal) {
    let total = 0;
    for (let i = 0; i < samples; i++) {
      const trial = { ...state, rngState: deriveSeed(state.rngState, `sample:${i}`) };
      const both: [SideActions, SideActions] = side === 0 ? [combo.actions, predicted] : [predicted, combo.actions];
      total += evaluate(resolveTurn(content, trial, both).state, side);
    }
    const value = total / samples + combo.score * 0.05;
    if (value > bestValue) {
      bestValue = value;
      best = combo;
    }
  }
  return best.actions;
}

function guardAll(state: BattleState, side: SideIndex): SideActions {
  const out: Record<number, BattleAction> = {};
  for (const { slot } of activeUnits(state, side)) out[slot] = { type: 'skill', skillId: 'guard' };
  return out;
}

function combine(pools: Candidate[][], qi: number): Array<{ actions: SideActions; score: number }> {
  const out: Array<{ actions: SideActions; score: number }> = [];
  const walk = (i: number, acc: Candidate[], cost: number): void => {
    if (i === pools.length) {
      const switches = acc.filter((c) => c.action.type === 'switch').map((c) => (c.action as { unitIndex: number }).unitIndex);
      if (new Set(switches).size !== switches.length) return;
      out.push({
        actions: Object.fromEntries(acc.map((c) => [c.slot, c.action])),
        score: acc.reduce((a, c) => a + c.score, 0) - overkillPenalty(acc) - extraGuardPenalty(acc),
      });
      return;
    }
    for (const c of pools[i]!) if (cost + c.cost <= qi) walk(i + 1, [...acc, c], cost + c.cost);
  };
  walk(0, [], 0);
  return out;
}

/** 防御回复云气每方每回合只算一次（DESIGN 4.4），第二只起扣掉云气收益。 */
function extraGuardPenalty(acc: Candidate[]): number {
  const guards = acc.filter((c) => c.action.type === 'skill' && c.action.skillId === 'guard').length;
  return Math.max(0, guards - 1) * GUARD_QI_VALUE;
}

/**
 * 集火溢出：同一目标的伤害超过其剩余生命的部分不算收益。
 * 罚的是“这一招自报的收益 − 它在前面队友出手之后实际还能带来的收益”，所以最多把这一招的收益扣到 0；
 * 只罚溢出、不罚集火本身——分散伤害会让治疗型对手永远打不死。
 * （M3-6 修正：原来按溢出量 / 最大生命罚、没有上限，高等级打低等级时每一招都是负分，AI 只会防御。）
 */
function overkillPenalty(acc: Candidate[]): number {
  const dealt = new Map<string, number>();
  let penalty = 0;
  for (const c of acc) {
    if (!c.damage) continue;
    const { uid, amount, hp, maxHp } = c.damage;
    const before = dealt.get(uid) ?? 0;
    const claimed = Math.min(amount, hp) / maxHp + (amount >= hp ? 0.5 : 0);
    const remaining = Math.max(0, hp - before);
    const effective = Math.min(amount, remaining) / maxHp + (remaining > 0 && amount >= remaining ? 0.5 : 0);
    penalty += claimed - effective;
    dealt.set(uid, before + amount);
  }
  return penalty;
}

function candidatesFor(content: ContentDb, state: BattleState, side: SideIndex, slot: number, unit: BattleUnit): Candidate[] {
  const out: Candidate[] = [];
  const enemies = activeUnits(state, other(side));
  const allies = activeUnits(state, side);
  const qi = state.sides[side].qi;
  for (const id of availableSkills(unit)) {
    const skill = content.skills.get(id)!;
    if (skill.qiCost > qi) continue;
    const targets: Array<SlotRef | undefined> =
      skill.target === 'singleEnemy' || skill.target === 'twoEnemies'
        ? enemies.map((e) => ({ side: other(side), slot: e.slot }))
        : skill.target === 'singleAlly'
          ? allies.filter((a) => a.unit !== unit).map((a) => ({ side, slot: a.slot }))
          : [undefined];
    for (const target of targets) {
      const action: BattleAction = { type: 'skill', skillId: id, ...(target ? { target } : {}) };
      const score = scoreSkill(state, side, unit, skill, target) - skill.qiCost * qiCostWeight(qi);
      const t = target && skill.target === 'singleEnemy' && skill.power > 0 ? state.sides[target.side].units[state.sides[target.side].active[target.slot]!] : undefined;
      const damage = t ? { uid: t.uid, amount: expectedDamage(state, side, unit, skill, t, false), hp: t.hp, maxHp: t.maxHp } : undefined;
      out.push({ slot, action, cost: skill.qiCost, score, ...(damage ? { damage } : {}) });
    }
  }
  const hpRatio = unit.hp / unit.maxHp;
  for (const idx of benchUnits(state, side)) {
    const bench = state.sides[side].units[idx]!;
    const threat = enemies.reduce((m, e) => Math.max(m, effectiveness(e.unit.elements[0]!, unit.elements)), 1);
    const benchThreat = enemies.reduce((m, e) => Math.max(m, effectiveness(e.unit.elements[0]!, bench.elements)), 1);
    const score = (hpRatio < 0.3 ? 0.15 : 0) + (threat - benchThreat) * 0.15 + (bench.hp / bench.maxHp - hpRatio) * 0.1;
    out.push({ slot, action: { type: 'switch', unitIndex: idx }, cost: 0, score });
  }
  return out;
}

/** 云气越接近上限越不值得省（满了就浪费）。 */
function qiCostWeight(qi: number): number {
  return 0.04 * Math.max(0, 1 - qi / BATTLE.maxQi);
}

/** 估算伤害（取随机系数的均值、计入暴击期望与命中率）。 */
function expectedDamage(state: BattleState, side: SideIndex, actor: BattleUnit, skill: Skill, target: BattleUnit, multi: boolean): number {
  const el: Element = skill.element === 'user' ? actor.elements[0]! : skill.element;
  const atk = actor.stats.power * stageMultiplier(effectiveStage(actor, 'power'));
  const def = target.stats.guard * stageMultiplier(effectiveStage(target, 'guard'));
  const power = skillPower(skill, actor);
  let dmg = baseDamage(actor.level, power, atk, def);
  dmg *= effectiveness(el, target.elements) * weatherMultiplier(el, state.field.current);
  if (actor.elements.includes(el)) dmg *= BATTLE.affinityBonus;
  const guaranteed = skill.effects.some((e) => e.kind === 'guaranteedCrit' && (!e.when || e.when.fieldWeather === state.field.current));
  dmg *= guaranteed ? BATTLE.critMultiplier : 1 + BATTLE.critChance * (BATTLE.critMultiplier - 1);
  dmg *= 0.95 * actor.empower;
  if (multi) for (const p of target.passiveEffects) if (p.kind === 'multiTargetDamageTaken') dmg *= p.multiplier;
  const hit = skill.accuracy === null ? 1 : Math.min(1, (skill.accuracy / 100) * stageMultiplier(effectiveStage(actor, 'accuracy')) * evasionMultiplier(effectiveStage(target, 'evasion')));
  return dmg * hit;
}

function damageValue(dmg: number, target: BattleUnit): number {
  const dealt = Math.min(dmg, target.hp);
  return dealt / target.maxHp + (dmg >= target.hp ? 0.5 : 0);
}

function scoreSkill(state: BattleState, side: SideIndex, unit: BattleUnit, skill: Skill, target: SlotRef | undefined): number {
  const enemies = activeUnits(state, other(side)).map((a) => a.unit);
  const allies = activeUnits(state, side).map((a) => a.unit);
  const targetUnit = target ? state.sides[target.side].units[state.sides[target.side].active[target.slot]!] : undefined;
  let score = 0;

  if (skill.power > 0) {
    const multi = skill.target === 'allEnemies' || skill.target === 'twoEnemies';
    const hitList =
      skill.target === 'allEnemies' ? enemies : skill.target === 'twoEnemies' ? [targetUnit, ...enemies.filter((e) => e !== targetUnit)].slice(0, 2) : [targetUnit];
    for (const t of hitList) if (isAlive(t)) score += damageValue(expectedDamage(state, side, unit, skill, t, multi), t);
    if (skill.effects.some((e) => e.kind === 'charge')) score *= 0.55;
  }

  for (const e of skill.effects) {
    if ('when' in e && e.when && e.when.fieldWeather !== state.field.current && e.kind !== 'setFieldWeather') continue;
    switch (e.kind) {
      case 'heal': {
        const list = e.target === 'allAllies' ? allies : e.target === 'self' ? [unit] : targetUnit ? [targetUnit] : [];
        for (const t of list) score += Math.min(e.ratio * t.maxHp, t.maxHp - t.hp) / t.maxHp;
        break;
      }
      case 'cleanse': {
        const list = e.target === 'allAllies' ? allies : [unit];
        score += list.filter((t) => t.ailment).length * 0.2;
        break;
      }
      case 'stage': {
        const list =
          e.target === 'allAllies' ? allies : e.target === 'allEnemies' ? enemies : e.target === 'self' ? [unit] : e.target === 'nextAlly' ? allies.filter((a) => a !== unit).slice(0, 1) : targetUnit ? [targetUnit] : [];
        const friendly = e.target !== 'allEnemies' && !(e.target === 'targets' && target?.side !== side);
        for (const t of list) {
          const cur = effectiveStage(t, e.stat);
          const room = e.delta > 0 ? BATTLE.maxStage - cur : BATTLE.maxStage + cur;
          if (room <= 0) continue;
          const v = 0.1 * Math.abs(e.delta) * (e.duration ? Math.min(1, e.duration / 3) : 1);
          score += friendly === e.delta > 0 ? v : -v;
        }
        break;
      }
      case 'ailment':
        score += enemies.filter((t) => !t.ailment).length > 0 ? e.chance * 0.25 : 0;
        break;
      case 'setFieldWeather': {
        if (state.field.current === e.weather) break;
        const weight = (u: BattleUnit) => (u.elements[0] === e.weather ? 0.12 : GENERATES[e.weather] === u.elements[0] ? 0.05 : 0);
        score += allies.reduce((a, u) => a + weight(u), 0) - enemies.reduce((a, u) => a + weight(u), 0);
        break;
      }
      case 'intercept': {
        if (targetUnit) score += (1 - targetUnit.hp / targetUnit.maxHp) * 0.25;
        break;
      }
      case 'guardThisTurn': {
        // 预计承受的伤害：对方每只用威力 60 的本属性技能打它的期望，取一半（只有部分敌人会打它）
        const incoming = enemies.reduce((sum, en) => {
          const base = baseDamage(en.level, 60, en.stats.power, unit.stats.guard) * effectiveness(en.elements[0]!, unit.elements);
          return sum + base * BATTLE.affinityBonus;
        }, 0) / Math.max(1, allies.length);
        const saved = Math.min(incoming * (1 - e.damageMultiplier), unit.hp) / unit.maxHp;
        score += saved * 0.6 + (incoming >= unit.hp ? 0.15 : 0);
        break;
      }
      case 'restoreQi':
        score += state.sides[side].qi < BATTLE.maxQi ? GUARD_QI_VALUE : 0;
        break;
      case 'empowerNextAttack':
        score += 0.15;
        break;
      case 'revealNextAction':
        score += 0.05;
        break;
      case 'actLast':
        score += 0.05;
        break;
      default:
        break;
    }
  }
  return score;
}

/** 局面评估：己方存活与血量 - 对方，外加云气与层数。 */
export function evaluate(state: BattleState, side: SideIndex): number {
  if (state.outcome) {
    if (state.outcome.winner === side) return 100;
    if (state.outcome.winner === other(side)) return -100;
  }
  const sideValue = (s: SideIndex) =>
    state.sides[s].units.reduce((a, u) => a + (isAlive(u) ? 0.4 + u.hp / u.maxHp : 0), 0) +
    state.sides[s].qi * 0.03 +
    activeUnits(state, s).reduce((a, { unit }) => a + 0.03 * (effectiveStage(unit, 'power') + effectiveStage(unit, 'guard') + effectiveStage(unit, 'agility')), 0);
  return sideValue(side) - sideValue(other(side));
}
