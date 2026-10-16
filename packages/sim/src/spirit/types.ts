import type { Element, PartSlot, Stat } from '@cloudsea/content';

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

/** 絮灵所处的状态（DESIGN 4.8）。疲惫是单独的标记，可与空闲 / 工作 / 队伍并存（决策 15）。 */
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
  readonly weary: boolean;
  /** 疲惫自然恢复的 tick。 */
  readonly wearyUntilTick: number;
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
