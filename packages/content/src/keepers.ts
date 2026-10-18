import { z } from 'zod';
import { elementSchema } from './elements';
import { regionSchema } from './species';

/** 守岛人对话的情境标签（DESIGN 11.5）。M1 的核心集合。 */
export const SITUATIONS = [
  'greeting',
  'farewell',
  'smallTalk',
  'weatherSun',
  'weatherRain',
  'weatherWind',
  'weatherThunder',
  'weatherMist',
  'night',
  'giftLoved',
  'giftLiked',
  'giftNeutral',
  'giftDisliked',
  'battleInvite',
  'battleWin',
  'battleLose',
  'orderPosted',
  'orderThanks',
  'visitPlayer',
  'aboutIsland',
] as const;
export const situationSchema = z.enum(SITUATIONS);
export type Situation = z.infer<typeof situationSchema>;

export const PLANNER_GOALS = ['farm', 'build', 'train', 'visit', 'postOrder', 'explore', 'rest'] as const;
export const plannerGoalSchema = z.enum(PLANNER_GOALS);
export type PlannerGoal = z.infer<typeof plannerGoalSchema>;

/** 剧情节点：手工设计的骨架，触发条件由主线章节与好感度共同决定（DESIGN 11.3）。 */
const storyNodeSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  minAffinityLevel: z.int().min(0).max(5),
  minChapter: z.int().min(1),
  /** 需要先完成的节点。 */
  after: z.string().optional(),
  lines: z.array(z.string().max(120)).min(1).max(5),
  /** 完成后获得的奖励。 */
  reward: z
    .strictObject({
      shells: z.int().min(0).optional(),
      items: z.array(z.strictObject({ item: z.string(), count: z.int().min(1) })).optional(),
      blueprint: z.string().optional(),
    })
    .optional(),
});

export const keeperSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1).max(6),
  /** 所在大区（M3-3）：新世界从各区的人设池里按种子抽人住进本区的守岛人岛。 */
  region: regionSchema,
  /** 外观参数（render 用）。 */
  appearance: z.strictObject({
    skinTone: z.string(),
    hairColor: z.string(),
    clothColor: z.string(),
    scarfColor: z.string(),
    height: z.number().min(0.85).max(1.15),
  }),
  personality: z.array(z.string()).min(1),
  speechStyle: z.string(),
  goal: z.string(),
  favoriteElement: elementSchema,
  /** 核心絮灵：进化线 + 等级。 */
  coreSpirits: z.array(z.strictObject({ line: z.string(), level: z.int().min(1).max(60), formIndex: z.int().min(0).max(2) })).min(1).max(6),
  /** 规划器权重（默认模式：加权随机）。 */
  plannerWeights: z.record(plannerGoalSchema, z.number().min(0)),
  gifts: z.strictObject({ loved: z.array(z.string()), liked: z.array(z.string()), disliked: z.array(z.string()) }),
  /** 与其他守岛人的关系。 */
  relations: z.array(z.strictObject({ keeper: z.string(), kind: z.enum(['friend', 'rival', 'lover', 'mentor', 'student']) })),
  story: z.array(storyNodeSchema).min(1).max(5),
});
export type Keeper = z.infer<typeof keeperSchema>;
export type KeeperInput = z.input<typeof keeperSchema>;

/** 对话库条目：人设 × 情境 × 好感（DESIGN 11.5）。affinity 省略 = 任何好感等级。 */
export const dialogueLineSchema = z.strictObject({
  keeper: z.string(),
  situation: situationSchema,
  minAffinity: z.int().min(0).max(5).optional(),
  maxAffinity: z.int().min(0).max(5).optional(),
  text: z.string().min(1).max(120),
});
export type DialogueLine = z.infer<typeof dialogueLineSchema>;

/** 好感阈值（DESIGN 11.3）：0 / 50 / 120 / 220 / 360 / 540。 */
export const AFFINITY_THRESHOLDS = [0, 50, 120, 220, 360, 540] as const;

export function affinityLevel(points: number): number {
  let lv = 0;
  AFFINITY_THRESHOLDS.forEach((t, i) => {
    if (points >= t) lv = i;
  });
  return lv;
}
