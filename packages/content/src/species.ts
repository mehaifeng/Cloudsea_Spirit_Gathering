import { z } from 'zod';
import { elementSchema } from './elements';
import { PART_SLOTS, type PartSlot } from './parts';
import { baseStatsSchema } from './stats';

/** 大区（DESIGN 2.1、3.1）。 */
export const REGIONS = ['sunPlains', 'windValley', 'rainMarsh', 'thunderCliff', 'mistSea'] as const;
export const regionSchema = z.enum(REGIONS);
export type Region = z.infer<typeof regionSchema>;

export const REGION_NAME: Readonly<Record<Region, string>> = {
  sunPlains: '晴原',
  windValley: '风谷',
  rainMarsh: '雨泽',
  thunderCliff: '雷崖',
  mistSea: '雾海',
};

/** 稀有度档，决定捕获基础率（DESIGN 5.5）。 */
export const RARITIES = ['common', 'uncommon', 'rare', 'veryRare'] as const;
export const raritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof raritySchema>;

export const RARITY_INFO: Readonly<Record<Rarity, { name: string; catchRate: number }>> = {
  common: { name: '常见', catchRate: 0.6 },
  uncommon: { name: '少见', catchRate: 0.4 },
  rare: { name: '稀有', catchRate: 0.25 },
  veryRare: { name: '极稀', catchRate: 0.12 },
};

/** 进化段：幼絮 / 成灵 / 云主形。 */
export const STAGES = ['hatchling', 'adult', 'lord'] as const;
export const stageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof stageSchema>;

export const STAGE_NAME: Readonly<Record<Stage, string>> = {
  hatchling: '幼絮',
  adult: '成灵',
  lord: '云主形',
};

const timeOfDaySchema = z.enum(['day', 'night']);

/** 野外刷新规则：满足任意一条即可刷新（例如雷线 = 夜晚 或 雷天）。 */
const spawnRuleSchema = z.strictObject({
  region: regionSchema,
  /** 世界天气（weather）限制；省略 = 任何天气。 */
  weathers: z.array(elementSchema).min(1).optional(),
  /** 时段限制；省略 = 全天。 */
  time: timeOfDaySchema.optional(),
  /** 所在区域的最低雾浓度。 */
  minFogLevel: z.int().min(0).max(5).optional(),
  /** 同一区域内与其他物种比较的相对权重。 */
  weight: z.number().gt(0),
});

/**
 * 零件池条目。part 为 null 表示该槽位为“无”。
 * minStage：基因在出生时就已确定，但这个零件要到该进化段才长出来、才带来技能
 * （“进化解锁新的零件池条目”，DESIGN 4.2）。
 */
const partPoolEntrySchema = z.strictObject({
  part: z.string().nullable(),
  weight: z.number().gt(0),
  minStage: stageSchema.optional(),
});

const partPoolSchema = z.strictObject(
  Object.fromEntries(PART_SLOTS.map((slot) => [slot, z.array(partPoolEntrySchema).min(1)])) as Record<
    PartSlot,
    z.ZodArray<typeof partPoolEntrySchema>
  >,
);

/** 骨架模板参数，供 render 的程序化建模使用（参考原型 buildCreature）。 */
const skeletonSchema = z.strictObject({
  /** 身体半径（米），再乘基因里的体型 0.85–1.15。 */
  bodyRadius: z.number().min(0.15).max(1.5),
  /** 头身比：头部半径 / 身体半径。 */
  headRatio: z.number().min(0.4).max(1.4),
  /** 眼睛大小倍率。 */
  eyeScale: z.number().min(0.5).max(1.6),
  /** 尾巴节数（有尾时）。 */
  tailSegments: z.int().min(2).max(8),
});

const evolutionSchema = z.strictObject({
  level: z.int().min(2).max(60),
  /** 需要的世界天气（例如“雷雨天升级”）。 */
  weather: elementSchema.optional(),
  time: timeOfDaySchema.optional(),
});

export const formSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1).max(6),
  stage: stageSchema,
  baseStats: baseStatsSchema,
  skeleton: skeletonSchema,
  /** 进化到下一形态的条件；最后一段省略。进化需要玩家确认（DESIGN 4.2）。 */
  evolution: evolutionSchema.optional(),
  /** 图鉴里的记忆碎片：旧大地的一段记忆。 */
  memoryShard: z.strictObject({ title: z.string().min(1).max(12), text: z.string().min(1).max(120) }),
});
export type Form = z.infer<typeof formSchema>;

export const lineSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    name: z.string().min(1).max(8),
    element: elementSchema,
    rarity: raritySchema,
    /** 雄性比例（决策 14），默认 0.5。 */
    sexRatio: z.number().min(0).max(1).default(0.5),
    spawns: z.array(spawnRuleSchema),
    partPool: partPoolSchema,
    /** 按进化顺序排列；部分线只有两段。 */
    forms: z.array(formSchema).min(2).max(3),
  })
  .superRefine((line, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: 'custom', message: `${line.id}: ${message}` });
    line.forms.forEach((f, i) => {
      if (f.stage !== STAGES[i]) issue(`第 ${i + 1} 个形态应为 ${STAGES[i]}，实际是 ${f.stage}`);
      const isLast = i === line.forms.length - 1;
      if (isLast && f.evolution) issue(`${f.id} 是最后一段，不应有进化条件`);
      if (!isLast && !f.evolution) issue(`${f.id} 缺少进化条件`);
      const prev = line.forms[i - 1]?.evolution;
      if (prev && f.evolution && f.evolution.level <= prev.level) issue(`${f.id} 的进化等级应高于上一段`);
    });
    if (line.partPool.feet.some((e) => e.part === null)) issue('足槽不能为“无”（足决定腿数）');
    const forms = new Set(line.forms.map((f) => f.stage));
    for (const slot of PART_SLOTS) {
      for (const e of line.partPool[slot]) {
        if (e.minStage && !forms.has(e.minStage)) issue(`${slot} 槽的 minStage ${e.minStage} 在本线不存在`);
      }
      if (!line.partPool[slot].some((e) => !e.minStage || e.minStage === 'hatchling')) {
        issue(`${slot} 槽在幼絮阶段没有可用条目`);
      }
    }
  });
export type Line = z.infer<typeof lineSchema>;
export type LineInput = z.input<typeof lineSchema>;
