import type { BuildingInput, Crop, RecipeInput } from '../buildings';

/** M1 建筑（DESIGN 7）。 */
export const BUILDINGS: readonly BuildingInput[] = [
  {
    id: 'islandCore', name: '岛核', kind: 'core', description: '浮岛的心脏。升级它，岛会长大。',
    size: { w: 2, d: 2 }, cost: { shells: 0, items: [] }, buildWork: 0, coreLevel: 1, starterBlueprint: false,
    workSlots: 0, workTasks: [], countsTowardLimit: false, maxCount: 1,
  },
  {
    id: 'dock', name: '码头', kind: 'dock', description: '风帆停靠的地方。商队的订单板也在这里。',
    size: { w: 4, d: 3 }, cost: { shells: 0, items: [] }, buildWork: 0, coreLevel: 1, starterBlueprint: false,
    workSlots: 0, workTasks: [], countsTowardLimit: false, maxCount: 1,
  },
  {
    id: 'nest', name: '栖巢', kind: 'nest', description: '絮灵休息的小窝，每座住 4 只。在这里休息恢复疲惫更快。',
    size: { w: 3, d: 3 }, cost: { shells: 50, items: [{ item: 'wood', count: 10 }, { item: 'stone', count: 5 }] },
    buildWork: 600, coreLevel: 1, starterBlueprint: true, workSlots: 0, workTasks: [], capacity: 4, countsTowardLimit: true,
  },
  {
    id: 'field', name: '田地', kind: 'field', description: '种下种子，絮灵会帮忙照料和收获。',
    size: { w: 3, d: 3 }, cost: { shells: 20, items: [{ item: 'wood', count: 4 }] },
    buildWork: 300, coreLevel: 1, starterBlueprint: true, workSlots: 1, workTasks: ['planting', 'irrigation'], countsTowardLimit: true,
  },
  {
    id: 'workshop', name: '工坊', kind: 'workshop', description: '把原料加工成面粉、木板、灯露……',
    size: { w: 5, d: 4 }, cost: { shells: 150, items: [{ item: 'wood', count: 20 }, { item: 'stone', count: 10 }] },
    buildWork: 1500, coreLevel: 1, starterBlueprint: true, workSlots: 2,
    workTasks: ['windmill', 'baking', 'brewing', 'power', 'smithing', 'perfumery', 'transport'], countsTowardLimit: true,
  },
  {
    id: 'storage', name: '仓库', kind: 'storage', description: '多放 20 格东西。',
    size: { w: 4, d: 3 }, cost: { shells: 120, items: [{ item: 'plank', count: 8 }, { item: 'brick', count: 4 }] },
    buildWork: 900, coreLevel: 1, starterBlueprint: false, workSlots: 0, workTasks: [], capacity: 20, countsTowardLimit: true,
  },
  {
    id: 'hatchery', name: '繁殖屋', kind: 'hatchery', description: '两只絮灵在这里生下絮灵蛋，蛋也在这里孵化。',
    size: { w: 4, d: 4 }, cost: { shells: 300, items: [{ item: 'plank', count: 10 }, { item: 'brick', count: 10 }] },
    buildWork: 2400, coreLevel: 2, starterBlueprint: false, workSlots: 0, workTasks: [], countsTowardLimit: true,
  },
  {
    id: 'purifyPool', name: '净化池', kind: 'purifyPool', description: '让蚀化的絮灵在这里静养 3 天，洗去暗色的雾。',
    size: { w: 3, d: 3 }, cost: { shells: 200, items: [{ item: 'brick', count: 8 }, { item: 'mistCrystal', count: 4 }] },
    buildWork: 1200, coreLevel: 2, starterBlueprint: false, workSlots: 0, workTasks: [], capacity: 2, countsTowardLimit: true,
  },
  {
    id: 'hotSpring', name: '温泉', kind: 'hotSpring', description: '疲惫的絮灵泡一泡很快就好；也让蛋孵得更快。',
    size: { w: 4, d: 4 }, cost: { shells: 400, items: [{ item: 'brick', count: 15 }, { item: 'copperIngot', count: 4 }] },
    buildWork: 2400, coreLevel: 3, starterBlueprint: false, workSlots: 0, workTasks: [], capacity: 4, countsTowardLimit: true, maxCount: 1,
  },
  {
    id: 'lamp', name: '路灯', kind: 'decoration', description: '夜里会亮起来。',
    size: { w: 1, d: 1 }, cost: { shells: 20, items: [{ item: 'wood', count: 2 }, { item: 'copperIngot', count: 1 }] },
    buildWork: 120, coreLevel: 1, starterBlueprint: true, workSlots: 0, workTasks: [], countsTowardLimit: false,
  },
  {
    id: 'fence', name: '围栏', kind: 'decoration', description: '木头围栏。',
    size: { w: 1, d: 1 }, cost: { shells: 0, items: [{ item: 'wood', count: 1 }] },
    buildWork: 60, coreLevel: 1, starterBlueprint: true, workSlots: 0, workTasks: [], countsTowardLimit: false,
  },
  {
    id: 'path', name: '石子路', kind: 'decoration', description: '铺在地上的小路。',
    size: { w: 1, d: 1 }, cost: { shells: 0, items: [{ item: 'stone', count: 1 }] },
    buildWork: 30, coreLevel: 1, starterBlueprint: true, workSlots: 0, workTasks: [], countsTowardLimit: false,
  },
  {
    id: 'flowerbed', name: '花坛', kind: 'decoration', description: '絮灵喜欢在花坛边打盹。',
    size: { w: 1, d: 1 }, cost: { shells: 10, items: [{ item: 'wood', count: 2 }, { item: 'stone', count: 1 }] },
    buildWork: 90, coreLevel: 1, starterBlueprint: true, workSlots: 0, workTasks: [], countsTowardLimit: false,
  },
];

/** 工坊配方。work = 效率 1.0 时的 tick（1 游戏日 = 12000 tick）。 */
export const RECIPES: readonly RecipeInput[] = [
  { id: 'flour', building: 'workshop', inputs: [{ item: 'sunWheat', count: 2 }], output: { item: 'flour', count: 1 }, task: 'windmill', work: 600 },
  { id: 'plank', building: 'workshop', inputs: [{ item: 'wood', count: 2 }], output: { item: 'plank', count: 1 }, task: 'transport', work: 500 },
  { id: 'jam', building: 'workshop', inputs: [{ item: 'rainBerry', count: 3 }], output: { item: 'jam', count: 1 }, task: 'brewing', work: 600 },
  { id: 'brick', building: 'workshop', inputs: [{ item: 'stone', count: 2 }], output: { item: 'brick', count: 1 }, task: 'power', work: 500 },
  { id: 'copperIngot', building: 'workshop', inputs: [{ item: 'copperOre', count: 2 }], output: { item: 'copperIngot', count: 1 }, task: 'smithing', work: 800 },
  { id: 'riceBall', building: 'workshop', inputs: [{ item: 'flour', count: 1 }, { item: 'jam', count: 1 }], output: { item: 'riceBall', count: 2 }, task: 'baking', work: 900 },
  { id: 'warmBun', building: 'workshop', inputs: [{ item: 'flour', count: 1 }, { item: 'windbellFruit', count: 1 }], output: { item: 'warmBun', count: 1 }, task: 'baking', work: 900 },
  { id: 'lanternFuel', building: 'workshop', inputs: [{ item: 'mistCrystal', count: 1 }, { item: 'sunWheat', count: 1 }], output: { item: 'lanternFuel', count: 2 }, task: 'perfumery', work: 600 },
  { id: 'lanternDew', building: 'workshop', inputs: [{ item: 'mistCrystal', count: 1 }, { item: 'rainBerry', count: 1 }], output: { item: 'lanternDew', count: 2 }, task: 'perfumery', work: 600 },
  { id: 'refinedDew', building: 'workshop', inputs: [{ item: 'lanternDew', count: 2 }, { item: 'copperIngot', count: 1 }], output: { item: 'refinedDew', count: 1 }, task: 'perfumery', work: 1200 },
];

/** 作物。生长速度 = 1 + 照料絮灵的工作效率之和；喜欢的天气下 ×1.5。 */
export const CROPS: readonly Crop[] = [
  { id: 'sunWheat', item: 'sunWheat', yield: 3, growTicks: 12000, favoredWeather: 'sun' },
  { id: 'rainBerry', item: 'rainBerry', yield: 4, growTicks: 15000, favoredWeather: 'rain' },
  { id: 'windbellFruit', item: 'windbellFruit', yield: 2, growTicks: 18000, favoredWeather: 'wind' },
];
