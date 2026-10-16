import { STATS, type ContentDb } from '@cloudsea/content';
import { other } from './engine';
import type { BattleState, SideIndex } from './types';

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

/** 战败时进入疲惫的絮灵：上过场的全部（DESIGN 5.4）。 */
export function wearyAfterBattle(state: BattleState, side: SideIndex): string[] {
  const r = resultFor(state, side);
  if (r !== 'lose' && r !== 'draw') return [];
  return state.sides[side].units.filter((u) => u.participated).map((u) => u.spiritId);
}

/** 本场被捕获的对方絮灵 id。 */
export function capturedSpirits(state: BattleState, side: SideIndex): string[] {
  return state.sides[other(side)].units.filter((u) => u.captured).map((u) => u.spiritId);
}
