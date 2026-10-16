import type { ItemInput } from '../items';

/** M1 物品（DESIGN 6.1 三级生产链）。价格是初稿，以 econ-sim / 试玩校准。 */
export const ITEMS: readonly ItemInput[] = [
  // ---------- 原料 ----------
  { id: 'wood', name: '木材', category: 'material', sellPrice: 4, description: '浮岛上的树木，坚韧而轻。' },
  { id: 'stone', name: '云石', category: 'material', sellPrice: 4, description: '带着细纹的白色石头，据说是凝固的云。' },
  { id: 'copperOre', name: '雷铜矿', category: 'material', sellPrice: 8, element: 'thunder', description: '雷雨过后在岩缝里闪光的矿石。' },
  { id: 'mistCrystal', name: '雾晶', category: 'material', sellPrice: 10, element: 'mist', description: '浓雾凝成的晶体，是提灯燃料的原料。' },
  // ---------- 作物 ----------
  { id: 'sunWheat', name: '晴麦', category: 'crop', sellPrice: 6, element: 'sun', description: '晒饱了太阳的麦子。' },
  { id: 'rainBerry', name: '雨莓', category: 'crop', sellPrice: 6, element: 'rain', description: '雨后最甜的浆果，有点酸。' },
  { id: 'windbellFruit', name: '风铃果', category: 'crop', sellPrice: 9, element: 'wind', description: '风一吹就会叮当作响的果子。' },
  // ---------- 种子 ----------
  { id: 'sunWheatSeed', name: '晴麦种子', category: 'seed', sellPrice: 2, buyPrice: 10, grows: 'sunWheat', description: '种在田里，晴天长得快。' },
  { id: 'rainBerrySeed', name: '雨莓种子', category: 'seed', sellPrice: 2, buyPrice: 12, grows: 'rainBerry', description: '种在田里，雨天长得快。' },
  { id: 'windbellSeed', name: '风铃果种子', category: 'seed', sellPrice: 3, buyPrice: 16, grows: 'windbellFruit', description: '种在田里，风天长得快。' },
  // ---------- 加工品 ----------
  { id: 'flour', name: '面粉', category: 'processed', sellPrice: 16, description: '风车磨出的细面粉。' },
  { id: 'jam', name: '果酱', category: 'processed', sellPrice: 20, description: '雨莓熬成的果酱。' },
  { id: 'plank', name: '木板', category: 'processed', sellPrice: 11, description: '刨得平整的木板，常用建材。' },
  { id: 'brick', name: '石砖', category: 'processed', sellPrice: 11, description: '烧制好的云石砖。' },
  { id: 'copperIngot', name: '铜锭', category: 'processed', sellPrice: 22, element: 'thunder', description: '熔炼过的雷铜。' },
  // ---------- 食物 ----------
  { id: 'riceBall', name: '絮灵饭团', category: 'food', sellPrice: 24, food: { curesWeary: false }, description: '絮灵最爱的点心，繁殖时需要。' },
  { id: 'warmBun', name: '暖心包', category: 'food', sellPrice: 36, food: { curesWeary: true }, description: '热乎乎的包子，吃了立刻消除疲惫。' },
  // ---------- 燃料与灯露 ----------
  { id: 'lanternFuel', name: '提灯燃料', category: 'fuel', sellPrice: 12, buyPrice: 30, description: '进入有雾的岛时消耗。' },
  { id: 'lanternDew', name: '灯露', category: 'dew', sellPrice: 10, buyPrice: 30, dewQuality: 'normal', description: '用来安抚野生絮灵、邀请它加入。' },
  { id: 'refinedDew', name: '精制灯露', category: 'dew', sellPrice: 30, buyPrice: 90, dewQuality: 'refined', description: '捕获成功率 ×1.5。' },
  { id: 'superiorDew', name: '极品灯露', category: 'dew', sellPrice: 80, dewQuality: 'superior', description: '捕获成功率 ×2。商队不卖。' },
  // ---------- 技能书 ----------
  { id: 'bookSunflare', name: '技能书·灼光', category: 'skillBook', sellPrice: 60, buyPrice: 360, teaches: 'sunflare', element: 'sun', description: '教会絮灵“灼光”。' },
  { id: 'bookWaterBolt', name: '技能书·水弹', category: 'skillBook', sellPrice: 60, buyPrice: 360, teaches: 'waterBolt', element: 'rain', description: '教会絮灵“水弹”。' },
  { id: 'bookWindBlade', name: '技能书·风刃', category: 'skillBook', sellPrice: 60, buyPrice: 360, teaches: 'windBlade', element: 'wind', description: '教会絮灵“风刃”。' },
  { id: 'bookSparkShot', name: '技能书·电击', category: 'skillBook', sellPrice: 60, buyPrice: 360, teaches: 'sparkShot', element: 'thunder', description: '教会絮灵“电击”。' },
  { id: 'bookMistLash', name: '技能书·雾刃', category: 'skillBook', sellPrice: 60, buyPrice: 360, teaches: 'mistLash', element: 'mist', description: '教会絮灵“雾刃”。' },
];
