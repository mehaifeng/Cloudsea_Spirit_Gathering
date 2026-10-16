import { z } from 'zod';
import type { Element } from './elements';

/** 状态异常（DESIGN 4.1、5.2）。每只絮灵同时最多 1 个，默认持续 3 回合。 */
export const AILMENTS = ['dazzled', 'soaked', 'unbalanced', 'paralyzed', 'hazed'] as const;
export const ailmentSchema = z.enum(AILMENTS);
export type Ailment = z.infer<typeof ailmentSchema>;

export const AILMENT_DURATION = 3;

/**
 * 状态异常的效果参数。百分比是独立乘数，与层数相乘，不折算成层数（DESIGN 5.2）。
 * sim 按 kind 解释，数值在这里调。
 */
export type AilmentEffect =
  | { readonly kind: 'accuracyMultiplier'; readonly multiplier: number }
  | { readonly kind: 'damageTakenMultiplier'; readonly element: Element; readonly multiplier: number }
  | { readonly kind: 'statMultiplier'; readonly stat: 'agility'; readonly multiplier: number }
  | { readonly kind: 'skipTurnChance'; readonly chance: number }
  | { readonly kind: 'retargetChance'; readonly chance: number };

export interface AilmentInfo {
  readonly name: string;
  readonly element: Element;
  readonly effect: AilmentEffect;
}

export const AILMENT_INFO: Readonly<Record<Ailment, AilmentInfo>> = {
  dazzled: { name: '目眩', element: 'sun', effect: { kind: 'accuracyMultiplier', multiplier: 0.8 } },
  soaked: {
    name: '湿透',
    element: 'rain',
    effect: { kind: 'damageTakenMultiplier', element: 'thunder', multiplier: 1.3 },
  },
  unbalanced: {
    name: '失衡',
    element: 'wind',
    effect: { kind: 'statMultiplier', stat: 'agility', multiplier: 0.7 },
  },
  paralyzed: { name: '麻痹', element: 'thunder', effect: { kind: 'skipTurnChance', chance: 0.25 } },
  // 单体技能有 30% 概率改为在场上除自身外的全部单位中随机选目标（决策 16）
  hazed: { name: '迷蒙', element: 'mist', effect: { kind: 'retargetChance', chance: 0.3 } },
};
