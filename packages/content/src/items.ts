import { z } from 'zod';
import { elementSchema } from './elements';

/** 物品类别。云贝不是物品，不占背包格（DESIGN 6.6）。 */
export const ITEM_CATEGORIES = ['material', 'crop', 'seed', 'processed', 'food', 'fuel', 'dew', 'skillBook', 'decoration'] as const;

export const itemSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
    name: z.string().min(1).max(8),
    category: z.enum(ITEM_CATEGORIES),
    description: z.string().min(1),
    /** 卖给商队的基础价（云贝）；0 = 不能出售。 */
    sellPrice: z.int().min(0),
    /** 商队售价；省略 = 商队不卖。 */
    buyPrice: z.int().min(1).optional(),
    /** 食物：可用于繁殖，部分能立即消除疲惫。 */
    food: z.strictObject({ curesWeary: z.boolean() }).optional(),
    /** 灯露品质。 */
    dewQuality: z.enum(['normal', 'refined', 'superior']).optional(),
    /** 技能书教的技能。 */
    teaches: z.string().optional(),
    /** 种子长成的作物。 */
    grows: z.string().optional(),
    /** 主题属性（用于守岛人喜好与图标颜色）。 */
    element: elementSchema.optional(),
  })
  .superRefine((it, ctx) => {
    const need = (cond: boolean, field: string, cat: string) => {
      if (cond !== (it.category === cat)) ctx.addIssue({ code: 'custom', message: `${it.id}: ${field} 只能且必须用于 ${cat}` });
    };
    need(it.food !== undefined, 'food', 'food');
    need(it.dewQuality !== undefined, 'dewQuality', 'dew');
    need(it.teaches !== undefined, 'teaches', 'skillBook');
    need(it.grows !== undefined, 'grows', 'seed');
  });
export type Item = z.infer<typeof itemSchema>;
export type ItemInput = z.input<typeof itemSchema>;

export const itemStackSchema = z.strictObject({ item: z.string(), count: z.int().min(1) });
export type ItemStack = z.infer<typeof itemStackSchema>;
