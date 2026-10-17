import type { ContentDb } from '@cloudsea/content';
import { computeStats } from './spirit';
import type { Spirit } from './types';

/**
 * 伤势延续（DESIGN 4.8，v0.7 取代疲惫）：生命、增减益、状态异常带到下一场战斗，
 * 生命回满时整体清除。
 */

export function maxHpOf(content: ContentDb, s: Pick<Spirit, 'formId' | 'level' | 'genes'>): number {
  return computeStats(content, s).hp;
}

/** 当前生命（整数，不超过最大生命）。 */
export function currentHp(content: ContentDb, s: Spirit): number {
  const max = maxHpOf(content, s);
  return s.condition ? Math.max(0, Math.min(max, Math.floor(s.condition.hp))) : max;
}

/** 生命为 0 = 倒下，不能出战或替补。 */
export function isDowned(content: ContentDb, s: Spirit): boolean {
  return currentHp(content, s) <= 0;
}

/** 恢复生命；回满时清除增减益与状态异常（condition 变回 null）。 */
export function healSpirit(content: ContentDb, s: Spirit, amount: number): Spirit {
  if (!s.condition || amount <= 0) return s;
  const max = maxHpOf(content, s);
  const hp = Math.min(max, s.condition.hp + amount);
  return { ...s, condition: hp >= max ? null : { ...s.condition, hp } };
}
