import type { Ailment, Element, Rarity, SkillEffect, StageStat } from '@cloudsea/content';
import type { Stats } from '../spirit/types';

export type SideIndex = 0 | 1;

/** 场上位置引用：哪一方的第几个位置（位置号决定相邻关系，DESIGN 5.1）。 */
export interface SlotRef {
  readonly side: SideIndex;
  readonly slot: number;
}

export type BattleKind = 'wild' | 'nest' | 'guardian' | 'keeper' | 'friendly' | 'teamCode' | 'scripted' | 'cloudlord';

/** 额外行动在 SideActions 里的键 = 位置号 + 该偏移（云主每回合行动两次，M2）。 */
export const EXTRA_ACTION_OFFSET = 10;

/** 云主的阶段（DESIGN 5.3，M2）：生命比例 ≤ hpBelow 时换招式、加层数，并说一句。 */
export interface UnitPhase {
  readonly hpBelow: number;
  readonly skills: readonly string[];
  readonly stages: readonly { readonly stat: StageStat; readonly delta: number }[];
  readonly line: string;
}

export interface TimedStage {
  readonly stat: StageStat;
  readonly delta: number;
  /** 在该回合结束时回退。 */
  readonly endsAfterTurn: number;
}

/** 异化零件对技能的修正。 */
export interface SkillMod {
  readonly powerMultiplier: number;
  readonly extraEffects: readonly SkillEffect[];
}

export interface BattleUnit {
  readonly uid: string;
  readonly spiritId: string;
  readonly ownerId: string;
  readonly formId: string;
  readonly lineId: string;
  readonly name: string;
  readonly level: number;
  readonly elements: readonly Element[];
  readonly rarity: Rarity;
  readonly stats: Stats;
  readonly maxHp: number;
  hp: number;
  /** 装备栏技能（不含基础动作）；云主换阶段时会换掉。 */
  skills: readonly string[];
  /** 每回合额外行动次数（云主 1，其他 0）。 */
  readonly extraActions: number;
  /** 阶段表与当前所处阶段（0 = 一阶段）。 */
  readonly phases: readonly UnitPhase[];
  phase: number;
  /** 被动效果（被动技能 + 其异化附加）。 */
  readonly passiveEffects: readonly SkillEffect[];
  readonly skillMods: Readonly<Record<string, SkillMod>>;
  readonly wild: boolean;
  readonly blighted: boolean;
  ailment: { id: Ailment; turnsLeft: number } | null;
  stages: Record<StageStat, number>;
  timedStages: TimedStage[];
  downed: boolean;
  captured: boolean;
  charging: { skillId: string; target: SlotRef | null } | null;
  empower: number;
  /** 本回合受到的伤害倍率（防御）。 */
  guarding: number;
  actLast: boolean;
  /** 曾经上场（结算经验用）。 */
  participated: boolean;
}

export interface Side {
  readonly units: BattleUnit[];
  /** 每个位置上场的单位下标；null = 空位。 */
  active: (number | null)[];
  qi: number;
  qiRestoredThisTurn: boolean;
}

export interface FieldWeather {
  /** 基准天候 = 开战时当地天气，无限持续；室内 / 巢穴为 null（DESIGN 5.1）。 */
  readonly base: Element | null;
  current: Element | null;
  /** 技能改变的天候剩余回合；回到基准后为 0。 */
  turnsLeft: number;
}

export interface BattleOutcome {
  /** 胜方；null = 双方同时全灭。 */
  readonly winner: SideIndex | null;
  readonly reason: 'defeat' | 'fled' | 'allCaptured';
}

export interface BattleState {
  readonly version: 1;
  readonly kind: BattleKind;
  turn: number;
  readonly sides: [Side, Side];
  readonly field: FieldWeather;
  rngState: number;
  outcome: BattleOutcome | null;
  /** 本回合的“挡下攻击”：被保护者 uid → 保护者 uid。 */
  intercepts: Record<string, string>;
  /** 被“听风”看破、下回合选择需提前公开的单位 uid。 */
  revealed: string[];
  /** 新手引导：这一方的絮灵生命不会低于 1（DESIGN 13，脚本保证不会战败）。 */
  readonly protectedSide: SideIndex | null;
  /** 被捕获的单位 uid → 扔灯露的玩家（多人战斗时捕获归扔灯露的人，M2）。 */
  capturedBy: Record<string, string>;
}

export type DewQuality = 'normal' | 'refined' | 'superior';

/** 场上一个位置本回合的行动。 */
export type BattleAction =
  | { readonly type: 'skill'; readonly skillId: string; readonly target?: SlotRef; readonly timeout?: boolean }
  | { readonly type: 'switch'; readonly unitIndex: number }
  | { readonly type: 'dew'; readonly quality: DewQuality; readonly target: SlotRef }
  | { readonly type: 'flee' };

/** 一方本回合的全部行动，按位置号。 */
export type SideActions = Readonly<Record<number, BattleAction>>;

export type BattleEvent =
  | { readonly t: 'turnStart'; readonly turn: number; readonly qi: readonly [number, number] }
  | { readonly t: 'use'; readonly uid: string; readonly skillId: string }
  | { readonly t: 'charge'; readonly uid: string; readonly skillId: string }
  | { readonly t: 'miss'; readonly uid: string; readonly target: string }
  | {
      readonly t: 'damage';
      readonly uid: string;
      readonly target: string;
      readonly amount: number;
      readonly crit: boolean;
      readonly effectiveness: number;
      readonly hpAfter: number;
    }
  | { readonly t: 'heal'; readonly target: string; readonly amount: number; readonly hpAfter: number }
  | { readonly t: 'stage'; readonly target: string; readonly stat: StageStat; readonly delta: number }
  | { readonly t: 'ailment'; readonly target: string; readonly ailment: Ailment }
  | { readonly t: 'ailmentEnd'; readonly target: string; readonly ailment: Ailment }
  | { readonly t: 'paralyzedSkip'; readonly uid: string }
  | { readonly t: 'retarget'; readonly uid: string; readonly target: string }
  | { readonly t: 'intercept'; readonly protector: string; readonly target: string }
  | { readonly t: 'reveal'; readonly target: string }
  | { readonly t: 'weather'; readonly weather: Element | null; readonly reverted: boolean }
  | { readonly t: 'qi'; readonly side: SideIndex; readonly delta: number; readonly qi: number }
  | { readonly t: 'downed'; readonly target: string }
  | { readonly t: 'switch'; readonly side: SideIndex; readonly slot: number; readonly out: string | null; readonly in: string }
  | { readonly t: 'captureAttempt'; readonly target: string; readonly chance: number; readonly success: boolean }
  | { readonly t: 'phase'; readonly uid: string; readonly phase: number; readonly line: string }
  | { readonly t: 'flee'; readonly side: SideIndex; readonly success: boolean }
  | { readonly t: 'end'; readonly outcome: BattleOutcome };
