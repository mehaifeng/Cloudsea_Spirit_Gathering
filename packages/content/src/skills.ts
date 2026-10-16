import { z } from 'zod';
import { ailmentSchema } from './ailments';
import { elementSchema } from './elements';
import { stageStatSchema } from './stats';

/** 技能类型（DESIGN 4.4）：攻击 / 守护 / 增益 / 减益 / 治疗 / 天候。 */
export const SKILL_CATEGORIES = ['attack', 'protect', 'buff', 'debuff', 'heal', 'weather'] as const;

/** 技能的目标范围。场上 3 个位置排成一行（DESIGN 5.1）。 */
export const SKILL_TARGETS = [
  'self',
  'singleEnemy',
  'twoEnemies',
  'allEnemies',
  'singleAlly',
  'allAllies',
] as const;

/** 效果作用对象：技能的目标 / 使用者 / 己方全体 / 敌方全体 / 本回合下一只行动的队友。 */
const effectTargetSchema = z.enum(['targets', 'self', 'allAllies', 'allEnemies', 'nextAlly']);

/** 效果的生效条件：当前战场天候。 */
const conditionSchema = z.strictObject({ fieldWeather: elementSchema });

const withCondition = { when: conditionSchema.optional() };

/**
 * 技能附加效果。sim 按 kind 解释；新增 kind 需要同时改 sim，新增技能只需要组合已有 kind。
 */
export const skillEffectSchema = z.discriminatedUnion('kind', [
  // 增减益层数；duration 省略 = 持续到退场（决策 17）
  z.strictObject({
    kind: z.literal('stage'),
    target: effectTargetSchema,
    stat: stageStatSchema,
    delta: z.int().min(-3).max(3).refine((d) => d !== 0, 'delta 不能为 0'),
    duration: z.int().min(1).optional(),
    ...withCondition,
  }),
  // 按目标最大生命的比例治疗（DESIGN 5.2 治疗公式）
  z.strictObject({ kind: z.literal('heal'), target: effectTargetSchema, ratio: z.number().gt(0).max(1), ...withCondition }),
  // 驱散负面状态
  z.strictObject({ kind: z.literal('cleanse'), target: effectTargetSchema, ...withCondition }),
  // 附加状态异常；chance 是技能标注值，实际命中率再乘 (0.8 + 共鸣/400)
  z.strictObject({
    kind: z.literal('ailment'),
    ailment: ailmentSchema,
    chance: z.number().gt(0).max(1),
    ...withCondition,
  }),
  // 改变战场天候，持续 5 回合后回到基准天候
  z.strictObject({ kind: z.literal('setFieldWeather'), weather: elementSchema, ...withCondition }),
  // 必定暴击
  z.strictObject({ kind: z.literal('guaranteedCrit'), ...withCondition }),
  // 蓄力：第 1 回合不造成伤害，第 2 回合自动对同一目标释放
  z.strictObject({ kind: z.literal('charge') }),
  // 替目标挡下下一次攻击
  z.strictObject({ kind: z.literal('intercept'), target: effectTargetSchema }),
  // 看破：目标下一回合的选择提前锁定并公开
  z.strictObject({ kind: z.literal('revealNextAction') }),
  // 本回合尚未行动的单位在各自优先级层内排到最后
  z.strictObject({ kind: z.literal('actLast'), target: effectTargetSchema, ...withCondition }),
  // 使用者下一次攻击伤害倍率
  z.strictObject({ kind: z.literal('empowerNextAttack'), multiplier: z.number().gt(1) }),
  // 本回合受到的伤害倍率（防御）
  z.strictObject({ kind: z.literal('guardThisTurn'), damageMultiplier: z.number().gt(0).lt(1) }),
  // 回复己方云气池；每方每回合最多回复 1 点由 sim 保证
  z.strictObject({ kind: z.literal('restoreQi'), amount: z.int().min(1) }),
  // 被动：受到群体攻击时的伤害倍率
  z.strictObject({ kind: z.literal('multiTargetDamageTaken'), multiplier: z.number().gt(0).lt(1) }),
  // 被动：免疫某种状态异常
  z.strictObject({ kind: z.literal('ailmentImmunity'), ailment: ailmentSchema }),
]);
export type SkillEffect = z.infer<typeof skillEffectSchema>;

/** 只能出现在被动技能里的效果。 */
export const PASSIVE_KINDS: ReadonlySet<SkillEffect['kind']> = new Set<SkillEffect['kind']>(['multiTargetDamageTaken', 'ailmentImmunity']);

export const skillSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    name: z.string().min(1).max(8),
    /** 属性；'user' 表示随使用者的主属性（轻击）。 */
    element: z.union([elementSchema, z.literal('user')]),
    source: z.enum(['basic', 'innate', 'part', 'book']),
    category: z.enum(SKILL_CATEGORIES),
    /** 威力；0 表示不造成伤害。 */
    power: z.int().min(0).max(250),
    /** 威力加成：威力 += 使用者该属性 / divisor（扑击：灵巧 / 4）。 */
    powerBonus: z.strictObject({ stat: z.enum(['agility', 'power', 'resonance']), divisor: z.int().min(1) }).optional(),
    qiCost: z.int().min(0).max(5),
    /** 命中（0–100）；null 表示必中（以自身或队友为目标的技能）。 */
    accuracy: z.int().min(1).max(100).nullable(),
    target: z.enum(SKILL_TARGETS),
    /** 优先级：+1 先手 / 0 普通 / -1 后发；+2 保留给换人。 */
    priority: z.int().min(-1).max(1),
    passive: z.boolean(),
    effects: z.array(skillEffectSchema),
    description: z.string().min(1),
  })
  .superRefine((s, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: 'custom', message: `${s.id}: ${message}` });
    if (s.category === 'attack' && s.power === 0) issue('攻击技能威力必须大于 0');
    if (s.category !== 'attack' && s.power > 0) issue('只有攻击技能可以有威力');
    if (s.powerBonus && s.power === 0) issue('powerBonus 需要基础威力');
    if (s.element === 'user' && s.source !== 'basic') issue("element 'user' 只能用于基础动作");
    if (s.passive) {
      if (s.source !== 'part') issue('被动技能只能来自零件');
      if (s.qiCost !== 0 || s.power !== 0) issue('被动技能不能有云气消耗或威力');
      if (s.effects.some((e) => !PASSIVE_KINDS.has(e.kind))) issue('被动技能只能使用被动效果');
    } else if (s.effects.some((e) => PASSIVE_KINDS.has(e.kind))) {
      issue('被动效果只能出现在被动技能里');
    }
    const selfOnly = s.target === 'self' || s.target === 'singleAlly' || s.target === 'allAllies';
    if (selfOnly && s.accuracy !== null) issue('以己方为目标的技能应为必中（accuracy: null）');
    if (!selfOnly && s.accuracy === null) issue('以敌方为目标的技能必须标注命中');
  });
export type Skill = z.infer<typeof skillSchema>;
export type SkillInput = z.input<typeof skillSchema>;
