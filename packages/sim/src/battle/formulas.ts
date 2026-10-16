import { COUNTERS, GENERATES, RARITY_INFO, type Element, type Rarity } from '@cloudsea/content';
import type { DewQuality } from './types';

/** 战斗常量（DESIGN 4.1、5.1、5.2、5.5）。 */
export const BATTLE = {
  counterMultiplier: 1.5,
  counteredMultiplier: 0.67,
  weatherBoost: 1.3,
  weatherGeneratedBoost: 1.1,
  affinityBonus: 1.2,
  synergyBonus: 1.1,
  critChance: 0.05,
  critMultiplier: 1.5,
  stagePerLevel: 0.15,
  maxStage: 3,
  startQi: 3,
  qiPerTurn: 2,
  maxQi: 10,
  fieldWeatherTurns: 5,
  ailmentDuration: 3,
  slots: 3,
  maxCatchChance: 0.95,
  ailmentCatchBonus: 1.3,
} as const;

export const DEW_MULTIPLIER: Readonly<Record<DewQuality, number>> = { normal: 1, refined: 1.5, superior: 2 };

/** 单属性对单属性的克制倍率。 */
export function elementMultiplier(attack: Element, defend: Element): number {
  if (COUNTERS[attack] === defend) return BATTLE.counterMultiplier;
  if (COUNTERS[defend] === attack) return BATTLE.counteredMultiplier;
  return 1;
}

/** 对双属性按两个属性相乘（最高 ×2.25，最低约 ×0.45，DESIGN 4.2）。 */
export function effectiveness(attack: Element, defender: readonly Element[]): number {
  return defender.reduce((m, d) => m * elementMultiplier(attack, d), 1);
}

/** 天候系数：同属性 +30%，相生链上的下一属性 +10%（DESIGN 5.1）。 */
export function weatherMultiplier(skillElement: Element, field: Element | null): number {
  if (field === null) return 1;
  if (field === skillElement) return BATTLE.weatherBoost;
  if (GENERATES[field] === skillElement) return BATTLE.weatherGeneratedBoost;
  return 1;
}

/** 层数修正：每层 ±15%。 */
export function stageMultiplier(stage: number): number {
  return 1 + BATTLE.stagePerLevel * stage;
}

/** 闪避层数对命中的修正：每层闪避使命中 -15%，负层数反之。 */
export function evasionMultiplier(stage: number): number {
  return 1 - BATTLE.stagePerLevel * stage;
}

/**
 * 基础伤害（决策 12）：floor( floor(2×等级/5 + 2) × 威力 × 力量 / 守护 / 50 ) + 2
 */
export function baseDamage(level: number, power: number, attack: number, defense: number): number {
  return Math.floor((Math.floor((2 * level) / 5 + 2) * power * attack) / Math.max(1, defense) / 50) + 2;
}

/** 状态命中率 / 治疗量的共鸣系数：0.8 + 共鸣/400。 */
export function resonanceFactor(resonance: number): number {
  return 0.8 + resonance / 400;
}

/**
 * 捕获率（DESIGN 5.5）：基础率 × (1 - 剩余血量比 × 0.7) × 状态加成 × 灯露品质，上限 0.95。
 */
export function catchChance(rarity: Rarity, hpRatio: number, hasAilment: boolean, dew: DewQuality): number {
  const raw =
    RARITY_INFO[rarity].catchRate *
    (1 - Math.max(0, Math.min(1, hpRatio)) * 0.7) *
    (hasAilment ? BATTLE.ailmentCatchBonus : 1) *
    DEW_MULTIPLIER[dew];
  return Math.min(BATTLE.maxCatchChance, raw);
}

/** 逃跑成功率：按双方场上最高灵巧比较（补充决定），0.25–0.95。 */
export function fleeChance(ourAgility: number, theirAgility: number): number {
  return Math.max(0.25, Math.min(0.95, 0.5 + (ourAgility - theirAgility) / 200));
}
