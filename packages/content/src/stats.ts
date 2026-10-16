import { z } from 'zod';

/** 五项属性（DESIGN 4.3）：生命、力量、守护、灵巧（速度）、共鸣。 */
export const STATS = ['hp', 'power', 'guard', 'agility', 'resonance'] as const;
export const statSchema = z.enum(STATS);
export type Stat = z.infer<typeof statSchema>;

export const STAT_NAME: Readonly<Record<Stat, string>> = {
  hp: '生命',
  power: '力量',
  guard: '守护',
  agility: '灵巧',
  resonance: '共鸣',
};

/** 战斗中可加减层数的六项（DESIGN 5.2），各 -3 到 +3 层。 */
export const STAGE_STATS = ['power', 'guard', 'agility', 'resonance', 'accuracy', 'evasion'] as const;
export const stageStatSchema = z.enum(STAGE_STATS);
export type StageStat = z.infer<typeof stageStatSchema>;

export const baseStatsSchema = z.strictObject({
  hp: z.int().min(1).max(200),
  power: z.int().min(1).max(200),
  guard: z.int().min(1).max(200),
  agility: z.int().min(1).max(200),
  resonance: z.int().min(1).max(200),
});
export type BaseStats = z.infer<typeof baseStatsSchema>;
