import { z } from 'zod';
import { itemStackSchema } from './items';
import { workTaskSchema } from './work';

/** 建筑功能（DESIGN 7）。sim 按 kind 解释。 */
export const BUILDING_KINDS = [
  'core',
  'dock',
  'nest',
  'field',
  'workshop',
  'hatchery',
  'purifyPool',
  'hotSpring',
  'storage',
  'decoration',
] as const;

export const buildingSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  name: z.string().min(1).max(8),
  kind: z.enum(BUILDING_KINDS),
  description: z.string().min(1),
  /** 占地（1 米网格），旋转 90° 时交换。 */
  size: z.strictObject({ w: z.int().min(1).max(6), d: z.int().min(1).max(6) }),
  /** 建造材料与云贝。 */
  cost: z.strictObject({ shells: z.int().min(0), items: z.array(itemStackSchema) }),
  /** 建造所需工时（絮灵工作 tick；无絮灵时按 0.3 倍速自建）。 */
  buildWork: z.int().min(0),
  /** 解锁所需岛核等级。 */
  coreLevel: z.int().min(1).max(10),
  /** 开局就拥有蓝图。 */
  starterBlueprint: z.boolean(),
  /** 工位数与可做的工作类型。 */
  workSlots: z.int().min(0).max(4),
  workTasks: z.array(workTaskSchema),
  /** 栖巢容量 / 仓库加成等数值，按 kind 解释。 */
  capacity: z.int().min(0).optional(),
  /** 是否计入建筑位上限（装饰不占）。 */
  countsTowardLimit: z.boolean(),
  /** 每座家园岛最多几座（省略 = 不限）。 */
  maxCount: z.int().min(1).optional(),
});
export type Building = z.infer<typeof buildingSchema>;
export type BuildingInput = z.input<typeof buildingSchema>;

/** 工坊配方（DESIGN 6.1 三级生产链）。 */
export const recipeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  /** 在哪种建筑里做。 */
  building: z.string(),
  inputs: z.array(itemStackSchema).min(1),
  output: itemStackSchema,
  /** 需要的工作类型，决定哪些絮灵效率高。 */
  task: workTaskSchema,
  /** 效率 1.0 时所需 tick。 */
  work: z.int().min(1),
});
export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeInput = z.input<typeof recipeSchema>;

/** 作物：田地里种的东西。 */
export const cropSchema = z.strictObject({
  id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  /** 收获得到的物品。 */
  item: z.string(),
  yield: z.int().min(1),
  /** 无絮灵照料时的生长 tick。 */
  growTicks: z.int().min(1),
  /** 喜欢的天气：该天气下生长 ×1.5。 */
  favoredWeather: z.enum(['sun', 'rain', 'wind', 'thunder', 'mist']),
});
export type Crop = z.infer<typeof cropSchema>;
