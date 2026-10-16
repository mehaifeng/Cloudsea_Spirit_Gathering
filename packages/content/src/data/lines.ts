import type { LineInput } from '../species';

/**
 * 晴原 5 条进化线、15 个形态（DESIGN 4.2 / 决策 D4）：每属性 1 条，全部可在晴原遇到。
 * 种族值总和：幼絮 250 / 成灵 350 / 云主形 450。数值是初稿，以 battle-sim 校准。
 */
export const LINES: readonly LineInput[] = [
  // ---------- 晴：暖芽线（常见；新手引导的第一只伙伴）----------
  {
    id: 'warmbud',
    name: '暖芽线',
    element: 'sun',
    rarity: 'common',
    spawns: [{ region: 'sunPlains', weight: 3 }],
    partPool: {
      ears: [
        { part: 'floppyEars', weight: 3 },
        { part: 'roundEars', weight: 1 },
        { part: null, weight: 1 },
      ],
      horns: [
        { part: null, weight: 4 },
        { part: 'singleHorn', weight: 1, minStage: 'lord' },
      ],
      wings: [{ part: null, weight: 1 }],
      tail: [
        { part: 'fluffTail', weight: 2 },
        { part: null, weight: 2 },
      ],
      feet: [
        { part: 'twoFeet', weight: 3 },
        { part: 'fourFeet', weight: 2 },
      ],
    },
    forms: [
      {
        id: 'warmbud',
        name: '暖芽',
        stage: 'hatchling',
        baseStats: { hp: 55, power: 45, guard: 50, agility: 45, resonance: 55 },
        skeleton: { bodyRadius: 0.3, headRatio: 1.0, eyeScale: 1.25, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '午后的麦田', text: '风停的时候，麦穗会轻轻碰在一起。有人在田埂上睡着了，草帽盖着脸。' },
      },
      {
        id: 'sheafglow',
        name: '穗光',
        stage: 'adult',
        baseStats: { hp: 75, power: 60, guard: 70, agility: 65, resonance: 80 },
        skeleton: { bodyRadius: 0.4, headRatio: 0.85, eyeScale: 1.05, tailSegments: 4 },
        evolution: { level: 36, weather: 'sun' },
        memoryShard: { title: '打谷场', text: '收成的日子，全村的人把麦捆堆成小山。孩子们从上面滑下来，满身都是金色的灰。' },
      },
      {
        id: 'dawncrown',
        name: '曦冕',
        stage: 'lord',
        baseStats: { hp: 95, power: 75, guard: 90, agility: 85, resonance: 105 },
        skeleton: { bodyRadius: 0.55, headRatio: 0.75, eyeScale: 0.9, tailSegments: 5 },
        memoryShard: { title: '第一缕光', text: '天亮之前，整片原野都在等。太阳出来的那一刻，露水一下子全亮了。' },
      },
    ],
  },

  // ---------- 雨：檐滴线（少见；雨天刷新）----------
  {
    id: 'eavedrop',
    name: '檐滴线',
    element: 'rain',
    rarity: 'uncommon',
    spawns: [{ region: 'sunPlains', weathers: ['rain'], weight: 2 }],
    partPool: {
      ears: [
        { part: 'roundEars', weight: 2 },
        { part: 'floppyEars', weight: 1 },
        { part: null, weight: 2 },
      ],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: null, weight: 1 }],
      tail: [
        { part: 'finTail', weight: 4 },
        { part: null, weight: 1 },
      ],
      feet: [
        { part: 'cloudFeet', weight: 2 },
        { part: 'fourFeet', weight: 2 },
        { part: 'twoFeet', weight: 1 },
      ],
    },
    forms: [
      {
        id: 'eavedrop',
        name: '檐滴',
        stage: 'hatchling',
        baseStats: { hp: 50, power: 55, guard: 45, agility: 50, resonance: 50 },
        skeleton: { bodyRadius: 0.28, headRatio: 1.1, eyeScale: 1.3, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '屋檐下', text: '雨下了一整天。屋檐下摆着一排瓦罐，每个罐子接住的雨声都不一样。' },
      },
      {
        id: 'eavebell',
        name: '檐铃',
        stage: 'adult',
        baseStats: { hp: 70, power: 80, guard: 60, agility: 65, resonance: 75 },
        skeleton: { bodyRadius: 0.38, headRatio: 0.9, eyeScale: 1.1, tailSegments: 4 },
        evolution: { level: 36, weather: 'rain' },
        memoryShard: { title: '风铃与雨', text: '小镇的门口挂着铜铃。下雨时它不响，只是一滴一滴往下落水，像在数数。' },
      },
      {
        id: 'rainchime',
        name: '霖钟',
        stage: 'lord',
        baseStats: { hp: 85, power: 105, guard: 75, agility: 80, resonance: 105 },
        skeleton: { bodyRadius: 0.52, headRatio: 0.8, eyeScale: 0.95, tailSegments: 6 },
        memoryShard: { title: '雨季的钟楼', text: '钟楼在雨季敲得特别慢。人们说，那是为了让远处河上的船也听得见。' },
      },
    ],
  },

  // ---------- 风：鸢絮线（少见；风天刷新）----------
  {
    id: 'kitefluff',
    name: '鸢絮线',
    element: 'wind',
    rarity: 'uncommon',
    spawns: [{ region: 'sunPlains', weathers: ['wind'], weight: 2 }],
    partPool: {
      ears: [
        { part: 'pointedEars', weight: 3 },
        { part: null, weight: 1 },
      ],
      horns: [{ part: null, weight: 1 }],
      wings: [
        { part: 'featherWings', weight: 2, minStage: 'adult' },
        { part: null, weight: 2 },
      ],
      tail: [
        { part: 'fluffTail', weight: 2 },
        { part: null, weight: 2 },
      ],
      feet: [
        { part: 'twoFeet', weight: 2 },
        { part: 'sixFeet', weight: 1 },
        { part: 'cloudFeet', weight: 1 },
      ],
    },
    forms: [
      {
        id: 'kitefluff',
        name: '鸢絮',
        stage: 'hatchling',
        baseStats: { hp: 45, power: 50, guard: 40, agility: 70, resonance: 45 },
        skeleton: { bodyRadius: 0.27, headRatio: 1.05, eyeScale: 1.2, tailSegments: 4 },
        evolution: { level: 16 },
        memoryShard: { title: '山坡上的线', text: '风筝断了线，越飞越远。放风筝的孩子没有哭，只是一直挥手。' },
      },
      {
        id: 'kitewing',
        name: '鸢羽',
        stage: 'adult',
        baseStats: { hp: 60, power: 70, guard: 55, agility: 100, resonance: 65 },
        skeleton: { bodyRadius: 0.36, headRatio: 0.85, eyeScale: 1.0, tailSegments: 5 },
        evolution: { level: 36, weather: 'wind' },
        memoryShard: { title: '麦浪', text: '大风从山口吹下来，整片原野像被一只手抚过。草帽飞走了，谁也追不上。' },
      },
      {
        id: 'skykite',
        name: '苍鸢',
        stage: 'lord',
        baseStats: { hp: 75, power: 90, guard: 70, agility: 125, resonance: 90 },
        skeleton: { bodyRadius: 0.48, headRatio: 0.7, eyeScale: 0.9, tailSegments: 6 },
        memoryShard: { title: '远行', text: '候鸟每年秋天经过这里，从不停留。老人说，它们知道一条去南方的路。' },
      },
    ],
  },

  // ---------- 雷：炉星线（稀有；夜晚或雷天刷新）----------
  {
    id: 'forgespark',
    name: '炉星线',
    element: 'thunder',
    rarity: 'rare',
    spawns: [
      { region: 'sunPlains', time: 'night', weight: 1 },
      { region: 'sunPlains', weathers: ['thunder'], weight: 2 },
    ],
    partPool: {
      ears: [
        { part: 'pointedEars', weight: 2 },
        { part: null, weight: 2 },
      ],
      horns: [
        { part: 'singleHorn', weight: 2 },
        { part: 'twinHorns', weight: 1, minStage: 'adult' },
        { part: null, weight: 1 },
      ],
      wings: [{ part: null, weight: 1 }],
      tail: [
        { part: 'finTail', weight: 1 },
        { part: null, weight: 3 },
      ],
      feet: [
        { part: 'fourFeet', weight: 3 },
        { part: 'sixFeet', weight: 2 },
      ],
    },
    forms: [
      {
        id: 'forgespark',
        name: '炉星',
        stage: 'hatchling',
        baseStats: { hp: 45, power: 65, guard: 40, agility: 55, resonance: 45 },
        skeleton: { bodyRadius: 0.29, headRatio: 0.95, eyeScale: 1.15, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '炉膛', text: '铁匠铺的炉火一夜不熄。火星从风箱口飞出来，落在地上，很久才暗下去。' },
      },
      {
        id: 'hammerpeal',
        name: '锤鸣',
        stage: 'adult',
        baseStats: { hp: 60, power: 95, guard: 55, agility: 75, resonance: 65 },
        skeleton: { bodyRadius: 0.4, headRatio: 0.8, eyeScale: 1.0, tailSegments: 4 },
        evolution: { level: 36, weather: 'thunder' },
        memoryShard: { title: '打铁声', text: '叮、叮、当。整条街都听得见。那是镇上唯一一个从来不迟到的声音。' },
      },
      {
        id: 'thunderanvil',
        name: '霆砧',
        stage: 'lord',
        baseStats: { hp: 75, power: 125, guard: 70, agility: 90, resonance: 90 },
        skeleton: { bodyRadius: 0.55, headRatio: 0.7, eyeScale: 0.85, tailSegments: 5 },
        memoryShard: { title: '夏夜的雷', text: '远处的雷光照亮了整座山，好一会儿才听见声音。大家数着秒，猜它有多远。' },
      },
    ],
  },

  // ---------- 雾：烟团线（稀有；雾浓度 ≥ 2 的区域）----------
  {
    id: 'hazepuff',
    name: '烟团线',
    element: 'mist',
    rarity: 'rare',
    spawns: [{ region: 'sunPlains', minFogLevel: 2, weight: 2 }],
    partPool: {
      ears: [
        { part: 'roundEars', weight: 3 },
        { part: null, weight: 1 },
      ],
      horns: [{ part: null, weight: 1 }],
      wings: [
        { part: null, weight: 3 },
        { part: 'featherWings', weight: 1, minStage: 'lord' },
      ],
      tail: [
        { part: 'fluffTail', weight: 4 },
        { part: null, weight: 1 },
      ],
      feet: [
        { part: 'cloudFeet', weight: 4 },
        { part: 'fourFeet', weight: 1 },
      ],
    },
    forms: [
      {
        id: 'hazepuff',
        name: '烟团',
        stage: 'hatchling',
        baseStats: { hp: 60, power: 40, guard: 60, agility: 40, resonance: 50 },
        skeleton: { bodyRadius: 0.32, headRatio: 1.15, eyeScale: 1.2, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '灶台', text: '清晨的厨房里，蒸笼一揭开，白气就涌满了屋子。谁也看不清谁，只听见笑声。' },
      },
      {
        id: 'lakeveil',
        name: '湖纱',
        stage: 'adult',
        baseStats: { hp: 85, power: 55, guard: 85, agility: 55, resonance: 70 },
        skeleton: { bodyRadius: 0.42, headRatio: 0.9, eyeScale: 1.0, tailSegments: 5 },
        evolution: { level: 36, weather: 'mist' },
        memoryShard: { title: '湖面', text: '天刚亮，湖上铺着一层薄雾。划船的人不说话，桨声很轻，怕把雾惊散了。' },
      },
      {
        id: 'mirrormist',
        name: '镜雾',
        stage: 'lord',
        baseStats: { hp: 110, power: 70, guard: 110, agility: 65, resonance: 95 },
        skeleton: { bodyRadius: 0.58, headRatio: 0.8, eyeScale: 0.9, tailSegments: 6 },
        memoryShard: { title: '倒影', text: '湖水静的时候，天空掉进了水里。有人说，看久了就分不清自己站在哪一边。' },
      },
    ],
  },
];
