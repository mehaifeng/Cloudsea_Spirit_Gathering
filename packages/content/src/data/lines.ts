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
        no: 1,
        name: '暖芽',
        stage: 'hatchling',
        baseStats: { hp: 45, power: 50, guard: 55, agility: 45, resonance: 55 },
        skeleton: { bodyRadius: 0.3, headRatio: 1.0, eyeScale: 1.25, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '午后的麦田', text: '风停的时候，麦穗会轻轻碰在一起。有人在田埂上睡着了，草帽盖着脸。' },
      },
      {
        id: 'sheafglow',
        no: 2,
        name: '穗光',
        stage: 'adult',
        baseStats: { hp: 60, power: 67, guard: 78, agility: 65, resonance: 80 },
        skeleton: { bodyRadius: 0.4, headRatio: 0.85, eyeScale: 1.05, tailSegments: 4 },
        evolution: { level: 36, weather: 'sun' },
        memoryShard: { title: '打谷场', text: '收成的日子，全村的人把麦捆堆成小山。孩子们从上面滑下来，满身都是金色的灰。' },
      },
      {
        id: 'dawncrown',
        no: 3,
        name: '曦冕',
        stage: 'lord',
        baseStats: { hp: 75, power: 85, guard: 100, agility: 85, resonance: 105 },
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
    spawns: [
      { region: 'sunPlains', weathers: ['rain'], weight: 2 },
      { region: 'rainMarsh', weight: 2 },
    ],
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
        no: 4,
        name: '檐滴',
        stage: 'hatchling',
        baseStats: { hp: 40, power: 48, guard: 52, agility: 50, resonance: 60 },
        skeleton: { bodyRadius: 0.28, headRatio: 1.1, eyeScale: 1.3, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '屋檐下', text: '雨下了一整天。屋檐下摆着一排瓦罐，每个罐子接住的雨声都不一样。' },
      },
      {
        id: 'eavebell',
        no: 5,
        name: '檐铃',
        stage: 'adult',
        baseStats: { hp: 55, power: 87, guard: 68, agility: 65, resonance: 75 },
        skeleton: { bodyRadius: 0.38, headRatio: 0.9, eyeScale: 1.1, tailSegments: 4 },
        evolution: { level: 36, weather: 'rain' },
        memoryShard: { title: '风铃与雨', text: '小镇的门口挂着铜铃。下雨时它不响，只是一滴一滴往下落水，像在数数。' },
      },
      {
        id: 'rainchime',
        no: 6,
        name: '霖钟',
        stage: 'lord',
        baseStats: { hp: 70, power: 112, guard: 83, agility: 80, resonance: 105 },
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
    spawns: [
      { region: 'sunPlains', weathers: ['wind'], weight: 2 },
      { region: 'windValley', weight: 2 },
    ],
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
        no: 7,
        name: '鸢絮',
        stage: 'hatchling',
        baseStats: { hp: 35, power: 55, guard: 45, agility: 70, resonance: 45 },
        skeleton: { bodyRadius: 0.27, headRatio: 1.05, eyeScale: 1.2, tailSegments: 4 },
        evolution: { level: 16 },
        memoryShard: { title: '山坡上的线', text: '风筝断了线，越飞越远。放风筝的孩子没有哭，只是一直挥手。' },
      },
      {
        id: 'kitewing',
        no: 8,
        name: '鸢羽',
        stage: 'adult',
        baseStats: { hp: 50, power: 75, guard: 60, agility: 100, resonance: 65 },
        skeleton: { bodyRadius: 0.36, headRatio: 0.85, eyeScale: 1.0, tailSegments: 5 },
        evolution: { level: 36, weather: 'wind' },
        memoryShard: { title: '麦浪', text: '大风从山口吹下来，整片原野像被一只手抚过。草帽飞走了，谁也追不上。' },
      },
      {
        id: 'skykite',
        no: 9,
        name: '苍鸢',
        stage: 'lord',
        baseStats: { hp: 60, power: 97, guard: 78, agility: 125, resonance: 90 },
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
      { region: 'thunderCliff', weight: 1 },
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
        no: 10,
        name: '炉星',
        stage: 'hatchling',
        baseStats: { hp: 35, power: 70, guard: 45, agility: 55, resonance: 45 },
        skeleton: { bodyRadius: 0.29, headRatio: 0.95, eyeScale: 1.15, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '炉膛', text: '铁匠铺的炉火一夜不熄。火星从风箱口飞出来，落在地上，很久才暗下去。' },
      },
      {
        id: 'hammerpeal',
        no: 11,
        name: '锤鸣',
        stage: 'adult',
        baseStats: { hp: 50, power: 100, guard: 60, agility: 75, resonance: 65 },
        skeleton: { bodyRadius: 0.4, headRatio: 0.8, eyeScale: 1.0, tailSegments: 4 },
        evolution: { level: 36, weather: 'thunder' },
        memoryShard: { title: '打铁声', text: '叮、叮、当。整条街都听得见。那是镇上唯一一个从来不迟到的声音。' },
      },
      {
        id: 'thunderanvil',
        no: 12,
        name: '霆砧',
        stage: 'lord',
        baseStats: { hp: 60, power: 132, guard: 78, agility: 90, resonance: 90 },
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
    spawns: [
      { region: 'sunPlains', minFogLevel: 2, weight: 2 },
      { region: 'mistSea', weight: 2 },
    ],
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
        no: 13,
        name: '烟团',
        stage: 'hatchling',
        baseStats: { hp: 50, power: 45, guard: 65, agility: 40, resonance: 50 },
        skeleton: { bodyRadius: 0.32, headRatio: 1.15, eyeScale: 1.2, tailSegments: 3 },
        evolution: { level: 16 },
        memoryShard: { title: '灶台', text: '清晨的厨房里，蒸笼一揭开，白气就涌满了屋子。谁也看不清谁，只听见笑声。' },
      },
      {
        id: 'lakeveil',
        no: 14,
        name: '湖纱',
        stage: 'adult',
        baseStats: { hp: 70, power: 62, guard: 93, agility: 55, resonance: 70 },
        skeleton: { bodyRadius: 0.42, headRatio: 0.9, eyeScale: 1.0, tailSegments: 5 },
        evolution: { level: 36, weather: 'mist' },
        memoryShard: { title: '湖面', text: '天刚亮，湖上铺着一层薄雾。划船的人不说话，桨声很轻，怕把雾惊散了。' },
      },
      {
        id: 'mirrormist',
        no: 15,
        name: '镜雾',
        stage: 'lord',
        baseStats: { hp: 90, power: 80, guard: 120, agility: 65, resonance: 95 },
        skeleton: { bodyRadius: 0.58, headRatio: 0.8, eyeScale: 0.9, tailSegments: 6 },
        memoryShard: { title: '倒影', text: '湖水静的时候，天空掉进了水里。有人说，看久了就分不清自己站在哪一边。' },
      },
    ],
  },

  // ======================== M3：九条新线（形态编号 16–40）========================

  // ---------- 晴：葵籽线（少见；晴原晴天、风谷）----------
  {
    id: 'sunseed',
    name: '葵籽线',
    element: 'sun',
    rarity: 'uncommon',
    spawns: [
      { region: 'sunPlains', weathers: ['sun'], weight: 1 },
      { region: 'windValley', weight: 1 },
    ],
    partPool: {
      ears: [{ part: 'roundEars', weight: 2 }, { part: 'floppyEars', weight: 1 }, { part: null, weight: 1 }],
      horns: [{ part: null, weight: 3 }, { part: 'twinHorns', weight: 1, minStage: 'lord' }],
      wings: [{ part: null, weight: 1 }],
      tail: [{ part: 'fluffTail', weight: 3 }, { part: null, weight: 1 }],
      feet: [{ part: 'twoFeet', weight: 2 }, { part: 'fourFeet', weight: 1 }],
    },
    forms: [
      { id: 'sunseed', no: 16, name: '葵籽', stage: 'hatchling', baseStats: { hp: 50, power: 45, guard: 50, agility: 45, resonance: 60 }, skeleton: { bodyRadius: 0.26, headRatio: 1.15, eyeScale: 1.3, tailSegments: 3 }, evolution: { level: 16 },
        memoryShard: { title: '向日葵', text: '院墙边种了一排向日葵，比孩子还高。每天傍晚，它们一起慢慢转过头去。' } },
      { id: 'sunplate', no: 17, name: '葵盘', stage: 'adult', baseStats: { hp: 70, power: 60, guard: 70, agility: 60, resonance: 90 }, skeleton: { bodyRadius: 0.38, headRatio: 1.0, eyeScale: 1.05, tailSegments: 4 }, evolution: { level: 36, weather: 'sun' },
        memoryShard: { title: '晒瓜子', text: '秋天把葵盘倒挂在屋檐下，一家人坐在门槛上剥瓜子，壳落了一地。' } },
      { id: 'goldwheel', no: 18, name: '金轮', stage: 'lord', baseStats: { hp: 90, power: 75, guard: 85, agility: 75, resonance: 125 }, skeleton: { bodyRadius: 0.5, headRatio: 0.9, eyeScale: 0.9, tailSegments: 5 },
        memoryShard: { title: '正午', text: '最热的那一刻，田里没有一点影子。蝉叫得很响，好像太阳也会发出声音。' } },
    ],
  },

  // ---------- 风：芦笛线（常见；风谷）----------
  {
    id: 'reedpipe',
    name: '芦笛线',
    element: 'wind',
    rarity: 'common',
    spawns: [{ region: 'windValley', weight: 3 }],
    partPool: {
      ears: [{ part: 'pointedEars', weight: 3 }, { part: 'roundEars', weight: 1 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: null, weight: 2 }, { part: 'featherWings', weight: 1, minStage: 'adult' }],
      tail: [{ part: 'fluffTail', weight: 2 }, { part: null, weight: 1 }],
      feet: [{ part: 'fourFeet', weight: 2 }, { part: 'twoFeet', weight: 1 }],
    },
    forms: [
      { id: 'reedpipe', no: 19, name: '芦笛', stage: 'hatchling', baseStats: { hp: 50, power: 55, guard: 45, agility: 60, resonance: 40 }, skeleton: { bodyRadius: 0.27, headRatio: 1.0, eyeScale: 1.2, tailSegments: 4 }, evolution: { level: 16 },
        memoryShard: { title: '河边的芦苇', text: '折一根芦苇，削个口子就能吹响。声音哑哑的，像鸭子在叫，大家笑成一团。' } },
      { id: 'reedwhistle', no: 20, name: '苇哨', stage: 'adult', baseStats: { hp: 60, power: 70, guard: 60, agility: 92, resonance: 68 }, skeleton: { bodyRadius: 0.37, headRatio: 0.85, eyeScale: 1.0, tailSegments: 5 }, evolution: { level: 36, weather: 'wind' },
        memoryShard: { title: '放牛', text: '牛在坡上吃草，放牛的人躺在草里吹哨。一支曲子吹到一半就睡着了。' } },
      { id: 'singingvale', no: 21, name: '鸣川', stage: 'lord', baseStats: { hp: 75, power: 90, guard: 78, agility: 118, resonance: 89 }, skeleton: { bodyRadius: 0.5, headRatio: 0.72, eyeScale: 0.9, tailSegments: 6 },
        memoryShard: { title: '山谷的回声', text: '对着山谷喊一声名字，山谷会慢慢地喊回来，一次比一次轻。' } },
    ],
  },

  // ---------- 风：岚蛾线（少见；风谷夜晚 / 风天）----------
  {
    id: 'gustmoth',
    name: '岚蛾线',
    element: 'wind',
    rarity: 'uncommon',
    spawns: [
      { region: 'windValley', time: 'night', weight: 2 },
      { region: 'windValley', weathers: ['wind'], weight: 1 },
    ],
    partPool: {
      ears: [{ part: 'antennae', weight: 4 }, { part: null, weight: 1 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: 'mothWings', weight: 4 }, { part: 'featherWings', weight: 1 }],
      tail: [{ part: null, weight: 3 }, { part: 'fluffTail', weight: 1 }],
      feet: [{ part: 'sixFeet', weight: 2 }, { part: 'cloudFeet', weight: 2 }],
    },
    forms: [
      { id: 'gustmoth', no: 22, name: '岚蛾', stage: 'hatchling', baseStats: { hp: 45, power: 58, guard: 45, agility: 60, resonance: 42 }, skeleton: { bodyRadius: 0.25, headRatio: 0.95, eyeScale: 1.35, tailSegments: 2 }, evolution: { level: 16 },
        memoryShard: { title: '灯下', text: '夏夜开着灯，飞蛾一只一只撞在纱窗上。奶奶说，它们是来找月亮的。' } },
      { id: 'windmoth', no: 23, name: '风蛾', stage: 'adult', baseStats: { hp: 60, power: 74, guard: 60, agility: 85, resonance: 71 }, skeleton: { bodyRadius: 0.34, headRatio: 0.85, eyeScale: 1.15, tailSegments: 3 }, evolution: { level: 36, weather: 'wind' },
        memoryShard: { title: '晾衣绳', text: '风一吹，院子里的床单全鼓起来，像一排要起飞的帆。' } },
      { id: 'azurehaze', no: 24, name: '苍岚', stage: 'lord', baseStats: { hp: 75, power: 97, guard: 75, agility: 108, resonance: 95 }, skeleton: { bodyRadius: 0.46, headRatio: 0.75, eyeScale: 1.0, tailSegments: 3 },
        memoryShard: { title: '山顶', text: '爬到山顶的时候，云就在脚底下。风很大，大家拉着手，谁也没有说话。' } },
    ],
  },

  // ---------- 雨：荷浮线（常见；雨泽）----------
  {
    id: 'lilypad',
    name: '荷浮线',
    element: 'rain',
    rarity: 'common',
    spawns: [{ region: 'rainMarsh', weight: 3 }],
    partPool: {
      ears: [{ part: 'floppyEars', weight: 3 }, { part: 'roundEars', weight: 1 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: null, weight: 1 }],
      tail: [{ part: 'finTail', weight: 2 }, { part: 'tendrilTail', weight: 1, minStage: 'adult' }, { part: null, weight: 1 }],
      feet: [{ part: 'fourFeet', weight: 2 }, { part: 'cloudFeet', weight: 1 }],
    },
    forms: [
      { id: 'lilypad', no: 25, name: '荷浮', stage: 'hatchling', baseStats: { hp: 55, power: 45, guard: 55, agility: 45, resonance: 50 }, skeleton: { bodyRadius: 0.3, headRatio: 1.05, eyeScale: 1.2, tailSegments: 3 }, evolution: { level: 16 },
        memoryShard: { title: '池塘', text: '雨点落在荷叶上，滚成一颗颗水珠。青蛙蹲在叶子中间，一动也不动。' } },
      { id: 'lotusboat', no: 26, name: '莲舟', stage: 'adult', baseStats: { hp: 78, power: 62, guard: 75, agility: 60, resonance: 75 }, skeleton: { bodyRadius: 0.42, headRatio: 0.88, eyeScale: 1.0, tailSegments: 4 }, evolution: { level: 36, weather: 'rain' },
        memoryShard: { title: '采莲', text: '小船划进荷花深处，人就看不见了，只听见船桨拨开叶子的声音。' } },
      { id: 'jademarsh', no: 27, name: '碧泽', stage: 'lord', baseStats: { hp: 100, power: 80, guard: 95, agility: 75, resonance: 100 }, skeleton: { bodyRadius: 0.56, headRatio: 0.75, eyeScale: 0.9, tailSegments: 5 },
        memoryShard: { title: '梅雨', text: '雨下了一整个月，衣服总也晒不干。可是那一年，稻子长得特别好。' } },
    ],
  },

  // ---------- 雨：苔蝾线（稀有；雨泽雨天；两段）----------
  {
    id: 'mossnewt',
    name: '苔蝾线',
    element: 'rain',
    rarity: 'rare',
    spawns: [{ region: 'rainMarsh', weathers: ['rain'], weight: 2 }],
    partPool: {
      ears: [{ part: null, weight: 3 }, { part: 'roundEars', weight: 1 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: null, weight: 1 }],
      tail: [{ part: 'finTail', weight: 3 }, { part: 'tendrilTail', weight: 1 }],
      feet: [{ part: 'sixFeet', weight: 2 }, { part: 'fourFeet', weight: 1 }],
    },
    forms: [
      { id: 'mossnewt', no: 28, name: '苔蝾', stage: 'hatchling', baseStats: { hp: 50, power: 48, guard: 50, agility: 45, resonance: 57 }, skeleton: { bodyRadius: 0.3, headRatio: 0.9, eyeScale: 1.1, tailSegments: 5 }, evolution: { level: 30, weather: 'rain' },
        memoryShard: { title: '井边', text: '老井的石头缝里长着青苔，凉丝丝的。打水的时候，桶会碰到井壁，咚的一声。' } },
      { id: 'bogdrake', no: 29, name: '沼蝾', stage: 'adult', baseStats: { hp: 70, power: 78, guard: 70, agility: 72, resonance: 75 }, skeleton: { bodyRadius: 0.5, headRatio: 0.78, eyeScale: 0.9, tailSegments: 6 },
        memoryShard: { title: '老桥', text: '石桥上的青苔被人踩出一条小路。桥下的水很慢，倒影里的人也走得很慢。' } },
    ],
  },

  // ---------- 雷：燧角线（常见；雷崖）----------
  {
    id: 'flintkid',
    name: '燧角线',
    element: 'thunder',
    rarity: 'common',
    spawns: [{ region: 'thunderCliff', weight: 3 }],
    partPool: {
      ears: [{ part: 'pointedEars', weight: 2 }, { part: 'antennae', weight: 1 }, { part: null, weight: 1 }],
      horns: [{ part: 'singleHorn', weight: 3 }, { part: 'twinHorns', weight: 1, minStage: 'adult' }],
      wings: [{ part: null, weight: 1 }],
      tail: [{ part: null, weight: 2 }, { part: 'fluffTail', weight: 1 }],
      feet: [{ part: 'fourFeet', weight: 3 }, { part: 'twoFeet', weight: 1 }],
    },
    forms: [
      { id: 'flintkid', no: 30, name: '燧角', stage: 'hatchling', baseStats: { hp: 45, power: 65, guard: 50, agility: 50, resonance: 40 }, skeleton: { bodyRadius: 0.28, headRatio: 0.98, eyeScale: 1.15, tailSegments: 3 }, evolution: { level: 16 },
        memoryShard: { title: '火石', text: '两块石头一碰，就会跳出一点火星。孩子们在河滩上敲了一下午，手都震麻了。' } },
      { id: 'flintblade', no: 31, name: '燧锋', stage: 'adult', baseStats: { hp: 60, power: 92, guard: 70, agility: 70, resonance: 58 }, skeleton: { bodyRadius: 0.38, headRatio: 0.85, eyeScale: 1.0, tailSegments: 4 }, evolution: { level: 36, weather: 'thunder' },
        memoryShard: { title: '山路', text: '下山的路全是碎石，一不留神就会滑倒。走在前面的人总会回头说：踩我脚印。' } },
      { id: 'boltcrest', no: 32, name: '霆角', stage: 'lord', baseStats: { hp: 85, power: 100, guard: 100, agility: 90, resonance: 75 }, skeleton: { bodyRadius: 0.52, headRatio: 0.72, eyeScale: 0.85, tailSegments: 5 },
        memoryShard: { title: '山火', text: '那年夏天雷劈中了山顶的老松，烧了一夜。第二年春天，焦黑的地上冒出了新芽。' } },
    ],
  },

  // ---------- 雷：雷鳐线（稀有；雷崖雷天 / 夜晚）----------
  {
    id: 'stormray',
    name: '雷鳐线',
    element: 'thunder',
    rarity: 'rare',
    spawns: [
      { region: 'thunderCliff', weathers: ['thunder'], weight: 2 },
      { region: 'thunderCliff', time: 'night', weight: 1 },
    ],
    partPool: {
      ears: [{ part: 'antennae', weight: 2 }, { part: null, weight: 2 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: 'mothWings', weight: 1, minStage: 'adult' }, { part: null, weight: 2 }],
      tail: [{ part: 'tendrilTail', weight: 3 }, { part: 'finTail', weight: 1 }],
      feet: [{ part: 'cloudFeet', weight: 1 }],
    },
    forms: [
      { id: 'stormray', no: 33, name: '雷鳐', stage: 'hatchling', baseStats: { hp: 40, power: 50, guard: 45, agility: 58, resonance: 57 }, skeleton: { bodyRadius: 0.28, headRatio: 0.85, eyeScale: 1.1, tailSegments: 5 }, evolution: { level: 16 },
        memoryShard: { title: '海边的夜', text: '退潮后的沙滩上，有东西一闪一闪地发着蓝光。走近了看，什么也没有。' } },
      { id: 'voltray', no: 34, name: '电鳐', stage: 'adult', baseStats: { hp: 55, power: 80, guard: 60, agility: 85, resonance: 70 }, skeleton: { bodyRadius: 0.38, headRatio: 0.78, eyeScale: 1.0, tailSegments: 6 }, evolution: { level: 36, weather: 'thunder' },
        memoryShard: { title: '灯塔', text: '海上起了大风浪，灯塔的光一圈一圈扫过去。船上的人看见了，就知道家在哪边。' } },
      { id: 'abyssbolt', no: 35, name: '霆渊', stage: 'lord', baseStats: { hp: 70, power: 108, guard: 78, agility: 110, resonance: 84 }, skeleton: { bodyRadius: 0.5, headRatio: 0.7, eyeScale: 0.9, tailSegments: 7 },
        memoryShard: { title: '深海', text: '据说海最深的地方没有一点光。可是渔夫们相信，那里住着会发光的鱼。' } },
    ],
  },

  // ---------- 雾：漂纱线（少见；雾海）----------
  {
    id: 'driftjelly',
    name: '漂纱线',
    element: 'mist',
    rarity: 'uncommon',
    spawns: [{ region: 'mistSea', weight: 3 }],
    partPool: {
      ears: [{ part: 'roundEars', weight: 2 }, { part: null, weight: 2 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: null, weight: 3 }, { part: 'mothWings', weight: 1, minStage: 'lord' }],
      tail: [{ part: 'tendrilTail', weight: 4 }, { part: 'fluffTail', weight: 1 }],
      feet: [{ part: 'cloudFeet', weight: 1 }],
    },
    forms: [
      { id: 'driftjelly', no: 36, name: '漂纱', stage: 'hatchling', baseStats: { hp: 55, power: 40, guard: 50, agility: 45, resonance: 60 }, skeleton: { bodyRadius: 0.3, headRatio: 1.2, eyeScale: 1.15, tailSegments: 4 }, evolution: { level: 16 },
        memoryShard: { title: '纱帘', text: '午后的风把窗边的纱帘吹进屋里，又吸回去。屋里的光也跟着一明一暗。' } },
      { id: 'mistmother', no: 37, name: '雾母', stage: 'adult', baseStats: { hp: 75, power: 65, guard: 70, agility: 60, resonance: 80 }, skeleton: { bodyRadius: 0.42, headRatio: 1.05, eyeScale: 1.0, tailSegments: 5 }, evolution: { level: 36, weather: 'mist' },
        memoryShard: { title: '摇篮曲', text: '母亲哼着一首没有词的歌，哼着哼着自己也打起了瞌睡。' } },
      { id: 'tidedream', no: 38, name: '汐梦', stage: 'lord', baseStats: { hp: 100, power: 85, guard: 83, agility: 75, resonance: 107 }, skeleton: { bodyRadius: 0.55, headRatio: 0.95, eyeScale: 0.95, tailSegments: 6 },
        memoryShard: { title: '涨潮', text: '晚上涨潮的声音很大，像有人在门外一遍遍地叫。第二天早上，沙滩又被抹得干干净净。' } },
    ],
  },

  // ---------- 雾：回声鸮线（极稀；雾海夜晚、浓雾；两段）----------
  {
    id: 'echoowl',
    name: '回声鸮线',
    element: 'mist',
    rarity: 'veryRare',
    spawns: [{ region: 'mistSea', time: 'night', weight: 1 }],
    partPool: {
      ears: [{ part: 'pointedEars', weight: 3 }, { part: 'roundEars', weight: 1 }],
      horns: [{ part: null, weight: 1 }],
      wings: [{ part: 'featherWings', weight: 3 }, { part: 'mothWings', weight: 1 }],
      tail: [{ part: 'fluffTail', weight: 2 }, { part: null, weight: 1 }],
      feet: [{ part: 'twoFeet', weight: 1 }],
    },
    forms: [
      { id: 'echoowl', no: 39, name: '鸮籁', stage: 'hatchling', baseStats: { hp: 50, power: 50, guard: 50, agility: 40, resonance: 60 }, skeleton: { bodyRadius: 0.29, headRatio: 1.25, eyeScale: 1.45, tailSegments: 3 }, evolution: { level: 30, weather: 'mist' },
        memoryShard: { title: '守夜', text: '守夜的人坐在火边，听着林子里的猫头鹰。叫一声，他就添一根柴。' } },
      { id: 'hushowl', no: 40, name: '寂鸮', stage: 'adult', baseStats: { hp: 72, power: 78, guard: 72, agility: 80, resonance: 88 }, skeleton: { bodyRadius: 0.45, headRatio: 1.05, eyeScale: 1.2, tailSegments: 4 },
        memoryShard: { title: '最后的灯', text: '夜深了，镇上的灯一盏一盏熄掉。最后亮着的，是钟楼上那一盏。' } },
    ],
  },
];
