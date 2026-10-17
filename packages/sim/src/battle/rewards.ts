import { STAGE_STATS, STATS, type ContentDb } from '@cloudsea/content';
import type { SpiritCondition } from '../spirit/types';
import { other } from './engine';
import type { BattleState, BattleUnit, SideIndex } from './types';

export type BattleResult = 'win' | 'lose' | 'fled' | 'draw';

export function resultFor(state: BattleState, side: SideIndex): BattleResult | null {
  const o = state.outcome;
  if (!o) return null;
  if (o.reason === 'fled') return 'fled';
  if (o.winner === null) return 'draw';
  return o.winner === side ? 'win' : 'lose';
}

/**
 * 经验（DESIGN 4.3）：每个被击倒或捕获的对手给 floor(种族值总和 × 等级 / 20)；
 * 上过场的絮灵拿全额，替补拿 50%。逃跑和战败不给经验。
 */
export function expRewards(content: ContentDb, state: BattleState, side: SideIndex): Map<string, number> {
  const out = new Map<string, number>();
  const r = resultFor(state, side);
  if (r !== 'win') return out;
  let total = 0;
  for (const u of state.sides[other(side)].units) {
    if (!u.downed && !u.captured) continue;
    const form = content.forms.get(u.formId)!.form;
    const bst = STATS.reduce((a, s) => a + form.baseStats[s], 0);
    total += Math.floor((bst * u.level) / 20);
  }
  for (const u of state.sides[side].units) out.set(u.spiritId, u.participated ? total : Math.floor(total / 2));
  return out;
}

/**
 * 战斗结束时单位的伤势（DESIGN 4.8，v0.7）：生命、层数、限时层数（换算成还剩几回合）、状态异常。
 * 完好（满血、无层数、无异常）时返回 null。
 */
export function conditionFromUnit(state: BattleState, u: BattleUnit): SpiritCondition | null {
  const stages: Partial<Record<(typeof STAGE_STATS)[number], number>> = {};
  for (const k of STAGE_STATS) if (u.stages[k]) stages[k] = u.stages[k];
  const timedStages = u.timedStages.map((t) => ({ stat: t.stat, delta: t.delta, turnsLeft: Math.max(1, t.endsAfterTurn - state.turn + 1) }));
  const hp = u.downed ? 0 : u.hp;
  if (hp >= u.maxHp && Object.keys(stages).length === 0 && timedStages.length === 0 && !u.ailment) return null;
  return { hp, stages, timedStages, ailment: u.ailment ? { ...u.ailment } : null };
}

/** 本场被捕获的对方絮灵 id。 */
export function capturedSpirits(state: BattleState, side: SideIndex): string[] {
  return state.sides[other(side)].units.filter((u) => u.captured).map((u) => u.spiritId);
}
