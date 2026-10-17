import { z } from 'zod';
import { elementSchema } from './elements';
import { stageStatSchema } from './stats';
import { regionSchema } from './species';

/** 云主的一只单位：进化线、形态序号（0 幼絮 / 1 成灵 / 2 云主形）、等级。 */
const unitSchema = z.strictObject({ line: z.string(), formIndex: z.int().min(0).max(2), level: z.int().min(1).max(60) });

/**
 * 云主（DESIGN 5.3，M2）：蚀化的云主形 + 护卫；按参战人数缩放生命；每回合行动 extraActions + 1 次；
 * 生命降到阈值时切换阶段（换招式、可锁定天候、可加层数）。
 */
export const cloudlordSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1).max(12),
  region: regionSchema,
  island: z.string(),
  boss: unitSchema,
  guards: z.array(unitSchema).max(2),
  /** 每回合额外行动次数（DESIGN：云主每回合行动 2 次 → 1）。 */
  extraActions: z.int().min(0).max(2),
  /** 按人数（1–4 人）的生命倍率。 */
  hpScale: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** 战斗期间的天候（DESIGN：固定为云主属性）。 */
  weather: elementSchema,
  /** 一阶段的招式。 */
  skills: z.array(z.string()).min(1).max(4),
  phases: z.array(
    z.strictObject({
      /** 生命比例 ≤ 该值时进入。 */
      hpBelow: z.number().gt(0).lt(1),
      skills: z.array(z.string()).min(1).max(4),
      stages: z.array(z.strictObject({ stat: stageStatSchema, delta: z.int().min(-3).max(3) })).default([]),
      line: z.string().min(1),
    }),
  ),
  reward: z.strictObject({ shells: z.int().min(0) }),
  description: z.string().min(1),
});
export type Cloudlord = z.infer<typeof cloudlordSchema>;
export type CloudlordInput = z.input<typeof cloudlordSchema>;
