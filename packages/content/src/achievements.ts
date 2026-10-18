import { z } from 'zod';

/**
 * 成就（M4-1）：条件是数据，由 sim 判定（房主权威），客户端拿到事件后同步给 Steam。
 * id 也是 Steam 后台的 API 名（大写下划线形式，见 steamName）。
 */
export const ACHIEVEMENT_STATS = ['battlesWon', 'caught', 'bred', 'resonanceBred', 'purified', 'coopWins', 'teamCodeWins'] as const;

export const achievementConditionSchema = z.discriminatedUnion('kind', [
  /** 角色统计计数。 */
  z.strictObject({ kind: z.literal('stat'), stat: z.enum(ACHIEVEMENT_STATS), atLeast: z.int().min(1) }),
  /** 图鉴里抓到过的形态数。 */
  z.strictObject({ kind: z.literal('codex'), atLeast: z.int().min(1) }),
  /** 拥有的絮灵数（不含蛋）。 */
  z.strictObject({ kind: z.literal('spirits'), atLeast: z.int().min(1) }),
  /** 有一只自己的、没蚀化的絮灵达到某个进化段。 */
  z.strictObject({ kind: z.literal('stage'), stage: z.enum(['adult', 'lord']) }),
  z.strictObject({ kind: z.literal('shiny') }),
  z.strictObject({ kind: z.literal('level'), atLeast: z.int().min(1).max(60) }),
  /** 世界进度：重燃的灯塔数 / 打赢的守卫数。 */
  z.strictObject({ kind: z.literal('lighthouses'), atLeast: z.int().min(1) }),
  z.strictObject({ kind: z.literal('guardians'), atLeast: z.int().min(1) }),
  z.strictObject({ kind: z.literal('coreLevel'), atLeast: z.int().min(1) }),
  /** 提灯和云舟都达到这一级。 */
  z.strictObject({ kind: z.literal('tools'), atLeast: z.int().min(1).max(5) }),
  /** 对任意一位守岛人的好感等级。 */
  z.strictObject({ kind: z.literal('keeperAffinity'), atLeast: z.int().min(1).max(5) }),
  /** 和守岛人讲完的剧情节点总数。 */
  z.strictObject({ kind: z.literal('storyNodes'), atLeast: z.int().min(1) }),
]);
export type AchievementCondition = z.infer<typeof achievementConditionSchema>;

export const achievementSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1).max(12),
  description: z.string().min(1).max(60),
  /** 隐藏成就：解锁前只显示“？？？”。 */
  hidden: z.boolean().optional(),
  condition: achievementConditionSchema,
});
export type Achievement = z.infer<typeof achievementSchema>;
export type AchievementInput = z.input<typeof achievementSchema>;

/** Steam 后台的成就 API 名：firstCatch → ACH_FIRST_CATCH。 */
export function steamName(id: string): string {
  return `ACH_${id.replace(/([A-Z0-9]+)/g, '_$1').toUpperCase()}`;
}
