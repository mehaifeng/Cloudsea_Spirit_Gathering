import { z } from 'zod';
import { regionSchema } from './species';

export const GATHER_KINDS = ['tree', 'rock', 'ore', 'crystal', 'bush'] as const;
export const gatherKindSchema = z.enum(GATHER_KINDS);
export type GatherKind = z.infer<typeof gatherKindSchema>;

/** 固定岛（DESIGN 3.1）：手工指定参数 + 程序化地形。 */
export const islandSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1).max(10),
  region: regionSchema,
  /** fixed 野外 / keeper 守岛人岛 / lighthouse 灯塔岛（云主盘踞，M2）。 */
  kind: z.enum(['fixed', 'keeper', 'lighthouse']),
  /** 雾浓度 0–5，提灯等级不低于它才能进入（DESIGN 3.3）。 */
  fogLevel: z.int().min(0).max(5),
  radius: z.number().min(10).max(80),
  /** 地形种子。 */
  seed: z.int().min(0),
  /** 地形主题（v0.5）：草坡 / 溪石 / 雾谷 / 农田 / 台地。 */
  theme: z.enum(['meadow', 'brook', 'valley', 'farm', 'terrace']),
  /** 海拔（米）：远景里岛的高低错落。 */
  altitude: z.number().min(-20).max(20),
  /** 星图上的位置（相对坐标）。 */
  chartPos: z.strictObject({ x: z.number(), y: z.number() }),
  /** 航行所需云舟等级（v0.5 起取代风帆）。 */
  skiffLevel: z.int().min(1).max(5),
  /** 野生絮灵等级范围。 */
  wildLevel: z.strictObject({ min: z.int().min(1), max: z.int().max(60) }),
  /** 同时存在的野生絮灵数量。 */
  wildCount: z.int().min(0).max(20),
  /** 蚀化絮灵出现概率。 */
  blightChance: z.number().min(0).max(1),
  /** 采集点：种类与数量。 */
  gather: z.array(z.strictObject({ kind: gatherKindSchema, count: z.int().min(1).max(30) })),
  /** 该岛的守岛人（kind = keeper）。 */
  keeper: z.string().optional(),
  /** 盘踞在该岛的云主（kind = lighthouse）。 */
  cloudlord: z.string().optional(),
  description: z.string().min(1),
});
export type Island = z.infer<typeof islandSchema>;
export type IslandInput = z.input<typeof islandSchema>;

/** 采集点产出（按种类），工具等级提高数量。 */
export const GATHER_YIELD: Readonly<Record<GatherKind, { item: string; min: number; max: number; respawnTicks: number }>> = {
  tree: { item: 'wood', min: 2, max: 3, respawnTicks: 6000 },
  rock: { item: 'stone', min: 2, max: 3, respawnTicks: 6000 },
  ore: { item: 'copperOre', min: 1, max: 2, respawnTicks: 9000 },
  crystal: { item: 'mistCrystal', min: 1, max: 2, respawnTicks: 9000 },
  bush: { item: 'rainBerry', min: 1, max: 3, respawnTicks: 4500 },
};
