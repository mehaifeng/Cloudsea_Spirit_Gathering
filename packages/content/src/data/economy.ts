import type { ItemStack } from '../items';

/** 经营数值锚点（DESIGN 6.6，初稿）。 */
export const ECONOMY = {
  startShells: 200,
  backpackSlots: 30,
  stackSize: 99,
  storageBase: 60,
  storagePerCoreLevel: 20,
  buildingSlotsBase: 6,
  buildingSlotsPerCoreLevel: 3,
  maxCoreLevel: 10,
  breedShells: 100,
  breedFood: 2,
  ordersPerDay: { min: 3, max: 5 },
  orderReward: { min: 50, max: 400 },
  /** 商队收购价 = 基础价；集市岛（M2+）再做浮动。 */
  partyMax: 6,
} as const;

/** 岛核升级到 n+1 级的花费：500 × 1.6^(n−1) 云贝 + 晴原特色材料。 */
export function coreUpgradeCost(level: number): { shells: number; items: ItemStack[] } {
  return {
    shells: Math.round(500 * 1.6 ** (level - 1)),
    items: [
      { item: 'plank', count: 4 * level },
      { item: 'brick', count: 4 * level },
    ],
  };
}

/** 玩家工具（DESIGN 8）：提灯、云舟（v0.5 起取代风帆）、采集工具。 */
export type ToolKind = 'lantern' | 'skiff' | 'gatherTool';
export const TOOL_NAME: Readonly<Record<ToolKind, string>> = { lantern: '提灯', skiff: '云舟', gatherTool: '采集工具' };

/** 工具从 level 升到 level+1 的花费（DESIGN 8：蓝图 + 材料 + 云贝；M1 蓝图默认已有）。 */
export function toolUpgradeCost(tool: ToolKind, level: number): { shells: number; items: ItemStack[] } {
  switch (tool) {
    case 'lantern':
      return { shells: 300 * level, items: [{ item: 'mistCrystal', count: 3 * level }, { item: 'copperIngot', count: level }] };
    case 'skiff':
      return { shells: 400 * level, items: [{ item: 'plank', count: 4 * level }, { item: 'windbellFruit', count: 2 * level }] };
    case 'gatherTool':
      return { shells: 200 * level, items: [{ item: 'copperIngot', count: 2 * level }] };
  }
}

/** 商队出售的蓝图。 */
export const BLUEPRINT_SHOP: ReadonlyArray<{ blueprint: string; price: number }> = [
  { blueprint: 'storage', price: 200 },
  { blueprint: 'hatchery', price: 900 },
  { blueprint: 'purifyPool', price: 700 },
  { blueprint: 'hotSpring', price: 1400 },
];

/** 订单模板：商队想要的货物（DESIGN 6.3）。 */
export const ORDER_TEMPLATES: ReadonlyArray<{ item: string; min: number; max: number; weight: number }> = [
  { item: 'sunWheat', min: 4, max: 10, weight: 3 },
  { item: 'rainBerry', min: 4, max: 10, weight: 2 },
  { item: 'wood', min: 8, max: 20, weight: 2 },
  { item: 'stone', min: 8, max: 20, weight: 2 },
  { item: 'flour', min: 2, max: 6, weight: 3 },
  { item: 'plank', min: 3, max: 8, weight: 3 },
  { item: 'brick', min: 3, max: 8, weight: 2 },
  { item: 'jam', min: 2, max: 5, weight: 2 },
  { item: 'copperIngot', min: 1, max: 4, weight: 1 },
  { item: 'riceBall', min: 2, max: 4, weight: 1 },
  { item: 'lanternFuel', min: 2, max: 6, weight: 1 },
];

/** 订单报酬倍率：比直接卖给商队多赚的部分。 */
export const ORDER_PREMIUM = 1.6;
