import type { Ailment, Element, PartSlot, Stat, StageStat } from '@cloudsea/content';

export type Sex = 'male' | 'female';
export type Pattern = 'plain' | 'spots' | 'stripes';
export const PATTERNS: readonly Pattern[] = ['plain', 'spots', 'stripes'];

export interface PartGene {
  readonly partId: string | null;
  /** 异化零件（DESIGN 4.2）。 */
  readonly mutated: boolean;
}

/**
 * 基因：出生时确定、终身不变、可遗传。全部是整数或枚举，保证絮灵码能无损编码。
 */
export interface Genes {
  readonly lineId: string;
  readonly sex: Sex;
  /** 副属性；null = 单属性。主属性 = 进化线属性。 */
  readonly secondaryElement: Element | null;
  readonly parts: Readonly<Record<PartSlot, PartGene>>;
  /** 色相偏移（度），-18..18。 */
  readonly hueShift: number;
  readonly pattern: Pattern;
  /** 体型（百分比），85..115。 */
  readonly sizePercent: number;
  /** 资质 0..31。 */
  readonly talents: Readonly<Record<Stat, number>>;
  readonly natureId: string;
  /** 幻色。 */
  readonly shiny: boolean;
}

/**
 * 伤势（DESIGN 4.8，v0.7 取代疲惫）：战斗结束时的生命、增减益层数（含限时层数，turnsLeft 为还剩几回合）、
 * 状态异常，带进下一场战斗；生命回满时整体清除（null = 完好）。
 */
export interface SpiritCondition {
  readonly hp: number;
  readonly stages: Readonly<Partial<Record<StageStat, number>>>;
  readonly timedStages: readonly { readonly stat: StageStat; readonly delta: number; readonly turnsLeft: number }[];
  readonly ailment: { readonly id: Ailment; readonly turnsLeft: number } | null;
}

/** 絮灵所处的状态（DESIGN 4.8）。 */
export type SpiritState = 'idle' | 'working' | 'party' | 'purifying' | 'egg';

export interface Spirit {
  readonly id: string;
  readonly ownerId: string;
  readonly genes: Genes;
  readonly formId: string;
  readonly level: number;
  /** 累计经验。 */
  readonly exp: number;
  readonly nickname: string | null;
  /** 装备栏，最多 4 个，从技能池中选（被动技能不占栏）。 */
  readonly skillSlots: readonly string[];
  /** 通过技能书学会的技能。 */
  readonly learnedSkills: readonly string[];
  readonly state: SpiritState;
  /** 伤势；null = 完好（DESIGN 4.8，v0.7）。 */
  readonly condition: SpiritCondition | null;
  /** 通过絮灵码导入（DESIGN 10）。 */
  readonly foreign: boolean;
  /** 蚀化：捕获后需要净化。 */
  readonly blighted: boolean;
  /** 净化 / 孵化完成的 tick（state 为 purifying / egg 时有效）。 */
  readonly readyAtTick: number;
  /** 繁殖冷却结束的 tick。 */
  readonly breedReadyTick: number;
}

export type Stats = Readonly<Record<Stat, number>>;
