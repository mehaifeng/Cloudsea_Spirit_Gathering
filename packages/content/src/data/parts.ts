import type { PartInput } from '../parts';

/** 零件初版数据（DESIGN 4.4 零件技能表）。异化效果是初稿。 */
export const PARTS: readonly PartInput[] = [
  // ---------- 耳 ----------
  {
    id: 'pointedEars',
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
    name: '独角',
    slot: 'horns',
    skill: 'hornRush',
    mutation: { powerMultiplier: 1.2, description: '角冲威力提升 20%。' },
  },
  {
    id: 'twinHorns',
    name: '双角',
    slot: 'horns',
    skill: 'twinHornQuake',
    mutation: { powerMultiplier: 1.2, description: '双角震威力提升 20%。' },
  },

  // ---------- 翼 ----------
  {
    id: 'featherWings',
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
    name: '鳍尾',
    slot: 'tail',
    skill: 'finWave',
    mutation: { powerMultiplier: 1.2, description: '甩尾浪威力提升 20%。' },
  },

  // ---------- 足 ----------
  {
    id: 'cloudFeet',
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
    name: '四足',
    slot: 'feet',
    skill: 'pounce',
    legs: 4,
    mutation: { powerMultiplier: 1.2, description: '扑击威力提升 20%。' },
  },
  {
    id: 'sixFeet',
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
];
