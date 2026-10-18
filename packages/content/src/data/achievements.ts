import type { AchievementInput } from '../achievements';

/** 成就表（M4-1，约 20 个）。只能往后追加，id 发布后不能改（Steam 后台用同一个名字）。 */
export const ACHIEVEMENTS: readonly AchievementInput[] = [
  { id: 'firstFriend', name: '第一位伙伴', description: '在岛核前唤出第一只絮灵。', condition: { kind: 'spirits', atLeast: 1 } },
  { id: 'firstCatch', name: '初次邀请', description: '用灯露邀请一只野生絮灵加入。', condition: { kind: 'stat', stat: 'caught', atLeast: 1 } },
  { id: 'fullHouse', name: '热闹的家', description: '同时拥有 20 只絮灵。', condition: { kind: 'spirits', atLeast: 20 } },
  { id: 'codex20', name: '图鉴过半', description: '图鉴里抓到 20 种形态。', condition: { kind: 'codex', atLeast: 20 } },
  { id: 'codex40', name: '万物有灵', description: '图鉴里抓到全部 40 种形态。', condition: { kind: 'codex', atLeast: 40 } },
  { id: 'grownUp', name: '长大了', description: '让一只絮灵进化成成灵。', condition: { kind: 'stage', stage: 'adult' } },
  { id: 'lordForm', name: '云主之姿', description: '让一只絮灵进化成云主形。', condition: { kind: 'stage', stage: 'lord' } },
  { id: 'level60', name: '登峰', description: '一只絮灵达到 60 级。', condition: { kind: 'level', atLeast: 60 } },
  { id: 'shiny', name: '幻色', description: '拥有一只幻色絮灵。', hidden: true, condition: { kind: 'shiny' } },
  { id: 'firstEgg', name: '新生', description: '在繁殖屋里生下第一枚蛋。', condition: { kind: 'stat', stat: 'bred', atLeast: 1 } },
  { id: 'resonance', name: '共鸣', description: '让两只属性相生的不同物种生下一枚蛋。', condition: { kind: 'stat', stat: 'resonanceBred', atLeast: 1 } },
  { id: 'purifier', name: '洗去暗雾', description: '在净化池里净化一只蚀化的絮灵。', condition: { kind: 'stat', stat: 'purified', atLeast: 1 } },
  { id: 'win100', name: '百战', description: '赢下 100 场战斗。', condition: { kind: 'stat', stat: 'battlesWon', atLeast: 100 } },
  { id: 'together', name: '并肩', description: '和朋友一起打赢一场战斗。', condition: { kind: 'stat', stat: 'coopWins', atLeast: 1 } },
  { id: 'codeDuel', name: '以码会友', description: '赢下一场队伍码挑战。', condition: { kind: 'stat', stat: 'teamCodeWins', atLeast: 1 } },
  { id: 'guardianNod', name: '守卫的认可', description: '打赢一位灯塔会守卫。', condition: { kind: 'guardians', atLeast: 1 } },
  { id: 'firstLight', name: '第一座灯塔', description: '重燃晴原的灯塔。', condition: { kind: 'lighthouses', atLeast: 1 } },
  { id: 'halfway', name: '雾散了一半', description: '重燃三座灯塔。', condition: { kind: 'lighthouses', atLeast: 3 } },
  { id: 'rekindled', name: '群岛重燃', description: '重燃全部五座灯塔。', condition: { kind: 'lighthouses', atLeast: 5 } },
  { id: 'growingIsland', name: '岛长大了', description: '把岛核升到 5 级。', condition: { kind: 'coreLevel', atLeast: 5 } },
  { id: 'farSail', name: '远航', description: '提灯和云舟都升到 5 级。', condition: { kind: 'tools', atLeast: 5 } },
  { id: 'kindred', name: '知心', description: '和一位守岛人的好感达到 4 级。', condition: { kind: 'keeperAffinity', atLeast: 4 } },
  { id: 'storyteller', name: '听故事的人', description: '和守岛人讲完 9 段故事。', condition: { kind: 'storyNodes', atLeast: 9 } },
];
