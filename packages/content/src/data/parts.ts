import type { PartInput } from '../parts';

/** 零件初版数据（DESIGN 4.4 零件技能表）。异化效果是初稿。 */
export const PARTS: readonly PartInput[] = [
  // ---------- 耳 ----------
  {
    id: 'pointedEars',
    no: 1,
    name: '尖耳',
    slot: 'ears',
    skill: 'windListen',
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'targets', stat: 'accuracy', delta: -1 }],
      description: '听风额外使目标命中降低 1 层。',
    },
  },
  {
    id: 'floppyEars',
    no: 2,
    name: '垂耳',
    slot: 'ears',
    skill: 'softEarRest',
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'self', stat: 'guard', delta: 1 }],
      description: '软耳安眠额外使自身守护提升 1 层。',
    },
  },
  {
    id: 'roundEars',
    no: 3,
    name: '圆耳',
    slot: 'ears',
    skill: 'roundEarHum',
    mutation: {
      extraEffects: [{ kind: 'ailment', ailment: 'hazed', chance: 0.2 }],
      description: '圆耳鸣有机会使敌人陷入迷蒙。',
    },
  },

  // ---------- 角 ----------
  {
    id: 'singleHorn',
    no: 4,
    name: '独角',
    slot: 'horns',
    skill: 'hornRush',
    mutation: { powerMultiplier: 1.2, description: '角冲威力提升 20%。' },
  },
  {
    id: 'twinHorns',
    no: 5,
    name: '双角',
    slot: 'horns',
    skill: 'twinHornQuake',
    mutation: { powerMultiplier: 1.2, description: '双角震威力提升 20%。' },
  },

  // ---------- 翼 ----------
  {
    id: 'featherWings',
    no: 6,
    name: '羽翼',
    slot: 'wings',
    skill: 'wingBeat',
    workBonus: { task: 'transport', multiplier: 1.2 },
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'self', stat: 'agility', delta: 1 }],
      description: '振翼额外使自身灵巧提升 1 层。',
    },
  },

  // ---------- 尾 ----------
  {
    id: 'fluffTail',
    no: 7,
    name: '绒尾',
    slot: 'tail',
    skill: 'fluffGuard',
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'targets', stat: 'guard', delta: 1 }],
      description: '絮尾护额外使被保护的队友守护提升 1 层。',
    },
  },
  {
    id: 'finTail',
    no: 8,
    name: '鳍尾',
    slot: 'tail',
    skill: 'finWave',
    mutation: { powerMultiplier: 1.2, description: '甩尾浪威力提升 20%。' },
  },

  // ---------- 足 ----------
  {
    id: 'cloudFeet',
    no: 9,
    name: '浮云足',
    slot: 'feet',
    skill: 'floating',
    legs: 0,
    mutation: {
      extraEffects: [{ kind: 'ailmentImmunity', ailment: 'soaked' }],
      description: '浮游额外免疫湿透。',
    },
  },
  {
    id: 'twoFeet',
    no: 10,
    name: '双足',
    slot: 'feet',
    skill: 'hop',
    legs: 2,
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'self', stat: 'power', delta: 1 }],
      description: '蹦跳额外使自身力量提升 1 层。',
    },
  },
  {
    id: 'fourFeet',
    no: 11,
    name: '四足',
    slot: 'feet',
    skill: 'pounce',
    legs: 4,
    mutation: { powerMultiplier: 1.2, description: '扑击威力提升 20%。' },
  },
  {
    id: 'sixFeet',
    no: 12,
    name: '六足',
    slot: 'feet',
    skill: 'swiftStride',
    legs: 6,
    workBonus: { task: 'transport', multiplier: 1.3 },
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'allAllies', stat: 'evasion', delta: 1, duration: 1 }],
      description: '疾行额外使己方全体闪避提升 1 层，持续 1 回合。',
    },
  },

  // ---------- M3 新零件（编号 13–15；絮灵码零件位 4 bit，最多到 15）----------
  {
    id: 'mothWings',
    no: 13,
    name: '蛾翼',
    slot: 'wings',
    skill: 'dustVeil',
    workBonus: { task: 'perfumery', multiplier: 1.2 },
    mutation: {
      extraEffects: [{ kind: 'ailment', ailment: 'hazed', chance: 0.15 }],
      description: '鳞粉有机会使敌人陷入迷蒙。',
    },
  },
  {
    id: 'antennae',
    no: 14,
    name: '触角',
    slot: 'ears',
    skill: 'staticSense',
    workBonus: { task: 'power', multiplier: 1.2 },
    mutation: {
      extraEffects: [{ kind: 'stage', target: 'self', stat: 'accuracy', delta: 1 }],
      description: '感电额外使自身命中提升 1 层。',
    },
  },
  {
    id: 'tendrilTail',
    no: 15,
    name: '触须尾',
    slot: 'tail',
    skill: 'tendrilSting',
    workBonus: { task: 'irrigation', multiplier: 1.2 },
    mutation: { powerMultiplier: 1.25, description: '触须刺威力提升 25%。' },
  },
];
