import { z } from 'zod';
import { skillEffectSchema } from './skills';
import { workTaskSchema } from './work';

/** 零件槽位（DESIGN 4.2）。足槽决定腿数，必须有零件；其余槽位允许“无”。 */
export const PART_SLOTS = ['ears', 'horns', 'wings', 'tail', 'feet'] as const;
export const partSlotSchema = z.enum(PART_SLOTS);
export type PartSlot = z.infer<typeof partSlotSchema>;

export const partSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    /** 稳定编号（1 起），絮灵码依赖它，发布后不能改。 */
    no: z.int().min(1).max(15),
    name: z.string().min(1).max(6),
    slot: partSlotSchema,
    /** 零件携带的技能 id。 */
    skill: z.string(),
    /** 腿数，只有足槽零件有：0（浮游）/ 2 / 4 / 6。 */
    legs: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]).optional(),
    /** 工作加成（DESIGN 4.6，倍率 1.0–1.3）。 */
    workBonus: z.strictObject({ task: workTaskSchema, multiplier: z.number().gt(1).max(1.3) }).optional(),
    /**
     * 异化版本（DESIGN 4.2）：对应技能威力 +20%，或附加一个小效果。
     * 至少填一项；威力倍率只对攻击技能有意义（由内容校验检查）。
     */
    mutation: z
      .strictObject({
        powerMultiplier: z.number().gt(1).max(1.5).optional(),
        extraEffects: z.array(skillEffectSchema).min(1).optional(),
        description: z.string().min(1),
      })
      .refine((m) => m.powerMultiplier !== undefined || m.extraEffects !== undefined, '异化至少要有一项效果'),
  })
  .superRefine((p, ctx) => {
    if ((p.slot === 'feet') !== (p.legs !== undefined)) {
      ctx.addIssue({ code: 'custom', message: `${p.id}: 只有足槽零件（且必须）标注腿数` });
    }
  });
export type Part = z.infer<typeof partSchema>;
export type PartInput = z.input<typeof partSchema>;
