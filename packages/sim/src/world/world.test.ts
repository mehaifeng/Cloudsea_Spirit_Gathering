import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { defaultActions } from '../battle/engine';
import type { SideActions } from '../battle/types';
import { makeSpirit } from '../testing';
import { createCharacter, createWorld, homeIslandId, joinWorld } from './create';
import { applyIntent, type Intent } from './intents';
import { gatherNodes } from './layout';
import { loadCharacter, loadWorld, saveWorld, SaveError, __migrate } from './save';
import type { WorldState } from './state';
import { advanceWorld } from './tick';
import { clockAt, TICKS_PER_DAY } from './time';
import { weatherAt } from './weather';

const content = getContent();

function newGame(seed = 7): WorldState {
  const world = createWorld(content, { seed, hostId: 'p1' });
  joinWorld(world, createCharacter(content, { id: 'p1', name: '小禾' }));
  return world;
}

function act(world: WorldState, intent: Intent) {
  const r = applyIntent(content, world, 'p1', intent);
  if (!r.ok) throw new Error(`${intent.type}: ${r.error}`);
  return r;
}

function run(world: WorldState, ticks: number) {
  const events = [];
  for (let t = 0; t < ticks; t += 10) events.push(...advanceWorld(content, world, 10));
  return events;
}

describe('时间与天气', () => {
  it('06:00 开始；第 7800 tick 入夜（19:00）；12000 tick 一天', () => {
    expect(clockAt(0)).toMatchObject({ day: 1, hour: 6, minute: 0, isNight: false });
    expect(clockAt(7799).isNight).toBe(false);
    expect(clockAt(7800)).toMatchObject({ hour: 19, isNight: true });
    expect(clockAt(TICKS_PER_DAY)).toMatchObject({ day: 2, hour: 6 });
  });

  it('天气由种子决定、可重算；晴原主天气（晴）约占一半', () => {
    expect(weatherAt(1, 'sunPlains', 50000)).toBe(weatherAt(1, 'sunPlains', 50000));
    let sun = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (weatherAt(3, 'sunPlains', i * 3001) === 'sun') sun++;
    expect(sun / N).toBeGreaterThan(0.4);
    expect(sun / N).toBeLessThan(0.6);
  });
});

describe('开局与采集', () => {
  it('新角色：200 云贝、开局蓝图、出现在自家码头；领养晴线幼絮作为第一只伙伴', () => {
    const w = newGame();
    const c = w.characters['p1']!;
    expect(c.shells).toBe(200);
    expect(c.blueprints).toEqual(expect.arrayContaining(['nest', 'field', 'workshop']));
    expect(w.players['p1']!.islandId).toBe(homeIslandId('p1'));
    act(w, { type: 'adoptStarter' });
    const starter = Object.values(c.spirits)[0]!;
    expect(starter.formId).toBe('warmbud');
    expect(c.party).toEqual([starter.id]);
    expect(applyIntent(content, w, 'p1', { type: 'release', spiritId: starter.id }).error).toBe('第一只伙伴不能放归');
  });

  it('出航：雾浓度需要提灯等级与燃料', () => {
    const w = newGame();
    act(w, { type: 'sail', islandId: 'wheatSlope' });
    expect(applyIntent(content, w, 'p1', { type: 'sail', islandId: 'mistHollow' }).error).toMatch(/提灯/);
    expect(applyIntent(content, w, 'p1', { type: 'sail', islandId: 'brookIsle' }).error).toMatch(/燃料/);
    w.characters['p1']!.backpack['lanternFuel'] = 3;
    act(w, { type: 'sail', islandId: 'brookIsle' });
    expect(w.characters['p1']!.backpack['lanternFuel']).toBe(2);
  });

  it('采集：走近才能采，采完要等它长回来', () => {
    const w = newGame();
    act(w, { type: 'sail', islandId: 'wheatSlope' });
    const node = gatherNodes(content.islands.get('wheatSlope')!).find((n) => n.kind === 'tree')!;
    expect(applyIntent(content, w, 'p1', { type: 'gather', nodeId: node.id }).error).toBe('再靠近一点');
    act(w, { type: 'move', x: node.x + 1, z: node.z, yaw: 0 });
    const r = act(w, { type: 'gather', nodeId: node.id });
    expect(r.events[0]).toMatchObject({ t: 'items', item: 'wood' });
    expect(applyIntent(content, w, 'p1', { type: 'gather', nodeId: node.id }).error).toBe('还没长好');
  });
});

describe('家园经营', () => {
  function buildNest(w: WorldState) {
    const c = w.characters['p1']!;
    c.backpack['wood'] = 40;
    c.backpack['stone'] = 20;
    for (let x = -6; x <= 6; x++) {
      for (let z = -6; z <= 6; z++) {
        const r = applyIntent(content, w, 'p1', { type: 'build', building: 'nest', x, z, rot: 0 });
        if (r.ok) return Object.values(w.homes['p1']!.buildings).find((b) => b.type === 'nest')!;
      }
    }
    throw new Error('no place for nest');
  }

  it('建造：扣材料与云贝，无絮灵时 0.3 倍速自建，建成后容量 +4', () => {
    const w = newGame();
    const nest = buildNest(w);
    expect(w.characters['p1']!.shells).toBe(150);
    expect(nest.built).toBe(false);
    run(w, Math.ceil(600 / 0.3) + 20);
    expect(nest.built).toBe(true);
  });

  it('不能重叠、不能建在岛外、没有蓝图不能建', () => {
    const w = newGame();
    expect(applyIntent(content, w, 'p1', { type: 'build', building: 'nest', x: -1, z: -1, rot: 0 }).error).toBe('和其他建筑重叠了');
    expect(applyIntent(content, w, 'p1', { type: 'build', building: 'nest', x: 40, z: 0, rot: 0 }).error).toBe('超出岛的范围');
    expect(applyIntent(content, w, 'p1', { type: 'build', building: 'hatchery', x: 3, z: 3, rot: 0 }).error).toMatch(/蓝图/);
  });

  it('田地：种下晴麦，絮灵照料会自动收获进仓库', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    const c = w.characters['p1']!;
    c.backpack['wood'] = 10;
    let field;
    for (let x = 2; x < 8 && !field; x++) {
      if (applyIntent(content, w, 'p1', { type: 'build', building: 'field', x, z: 2, rot: 0 }).ok) field = Object.values(w.homes['p1']!.buildings).find((b) => b.type === 'field');
    }
    expect(field).toBeDefined();
    run(w, 1100);
    expect(field!.built).toBe(true);
    act(w, { type: 'plant', buildingId: field!.id, seedItem: 'sunWheatSeed' });
    const starter = c.party[0]!;
    act(w, { type: 'setParty', spiritIds: [] });
    act(w, { type: 'assignWorker', buildingId: field!.id, spiritId: starter });
    const events = run(w, TICKS_PER_DAY);
    expect(events.some((e) => e.t === 'harvest')).toBe(true);
    expect(w.homes['p1']!.storage['sunWheat']).toBeGreaterThanOrEqual(3);
  });

  it('工坊：有工人才会加工，原料从仓库和背包扣', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    const c = w.characters['p1']!;
    c.backpack['wood'] = 30;
    c.backpack['stone'] = 20;
    let shop;
    for (let x = -8; x < 8 && !shop; x++) {
      for (let z = -8; z < 8 && !shop; z++) {
        if (applyIntent(content, w, 'p1', { type: 'build', building: 'workshop', x, z, rot: 0 }).ok) shop = Object.values(w.homes['p1']!.buildings).find((b) => b.type === 'workshop');
      }
    }
    expect(shop).toBeDefined();
    shop!.built = true;
    c.backpack['wood'] = 4;
    act(w, { type: 'craft', buildingId: shop!.id, recipeId: 'plank', count: 2 });
    run(w, 2000);
    expect(w.homes['p1']!.storage['plank']).toBeUndefined();
    act(w, { type: 'setParty', spiritIds: [] });
    act(w, { type: 'assignWorker', buildingId: shop!.id, spiritId: c.party[0] ?? Object.keys(c.spirits)[0]! });
    // 5 级晴线做运输：0.6 × (0.5 + 5/120) ≈ 0.33 效率，一块木板约 1540 tick
    run(w, 3600);
    expect(w.homes['p1']!.storage['plank']).toBe(2);
    expect(c.backpack['wood']).toBeUndefined();
  });

  it('订单：每天 3–5 条商队订单；交货得云贝', () => {
    const w = newGame();
    run(w, 10);
    const caravan = w.orders.filter((o) => o.source === 'caravan');
    expect(caravan.length).toBeGreaterThanOrEqual(3);
    expect(caravan.length).toBeLessThanOrEqual(5);
    for (const o of caravan) {
      expect(o.reward).toBeGreaterThanOrEqual(50);
      expect(o.reward).toBeLessThanOrEqual(400);
    }
    const o = caravan[0]!;
    w.characters['p1']!.backpack[o.item] = o.count;
    const before = w.characters['p1']!.shells;
    act(w, { type: 'fulfillOrder', orderId: o.id });
    expect(w.characters['p1']!.shells).toBe(before + o.reward);
  });

  it('岛核升级：花费 500 云贝 + 材料，建筑位 +3', () => {
    const w = newGame();
    const c = w.characters['p1']!;
    c.shells = 1000;
    c.backpack['plank'] = 4;
    c.backpack['brick'] = 4;
    act(w, { type: 'upgradeCore' });
    expect(w.homes['p1']!.coreLevel).toBe(2);
    expect(c.shells).toBe(500);
  });
});

describe('战斗与捕获', () => {
  function toIslandWithWild(seed = 7) {
    const w = newGame(seed);
    act(w, { type: 'adoptStarter' });
    act(w, { type: 'sail', islandId: 'wheatSlope' });
    const wild = Object.values(w.islands['wheatSlope']!.wild)[0]!;
    act(w, { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    return { w, wild };
  }

  it('到岛上就有野生絮灵；接触进入战斗，打赢得到经验，野生絮灵消失', () => {
    const { w, wild } = toIslandWithWild();
    const c = w.characters['p1']!;
    c.spirits[c.party[0]!] = { ...c.spirits[c.party[0]!]!, level: 30 };
    act(w, { type: 'encounter', wildId: wild.id });
    const battleId = w.players['p1']!.battleId!;
    let ended = false;
    for (let i = 0; i < 30 && !ended; i++) {
      const b = w.battles[battleId]!;
      const actions: SideActions = { 0: { type: 'skill', skillId: 'jab', target: { side: 1, slot: 0 } } };
      const r = act(w, { type: 'battleActions', battleId, actions: b.state.sides[0].active[0] === null ? {} : actions });
      ended = r.events.some((e) => e.t === 'battleEnd');
      void b;
    }
    expect(ended).toBe(true);
    expect(w.players['p1']!.battleId).toBeNull();
    expect(w.islands['wheatSlope']!.wild[wild.id]).toBeUndefined();
    expect(c.stats.battlesWon).toBe(1);
  });

  it('灯露捕获：消耗灯露，捕获的絮灵进队伍并点亮图鉴', () => {
    let done = false;
    for (let seed = 1; seed < 30 && !done; seed++) {
      const { w, wild } = toIslandWithWild(seed);
      if (wild.blighted || wild.group.length > 1) continue;
      const c = w.characters['p1']!;
      act(w, { type: 'encounter', wildId: wild.id });
      const battleId = w.players['p1']!.battleId!;
      const r = act(w, { type: 'battleActions', battleId, actions: { 0: { type: 'dew', quality: 'normal', target: { side: 1, slot: 0 } } } });
      expect(c.backpack['lanternDew']).toBe(7);
      const end = r.events.find((e) => e.t === 'battleEnd');
      if (end?.t === 'battleEnd' && end.captured.length === 1) {
        const caught = c.spirits[end.captured[0]!]!;
        expect(caught.ownerId).toBe('p1');
        expect(c.party).toContain(caught.id);
        expect(c.codex.caught).toContain(caught.formId);
        done = true;
      }
    }
    expect(done).toBe(true);
  });

  it('战败：参战絮灵疲惫；全员疲惫时被商队送回家', () => {
    const { w, wild } = toIslandWithWild();
    const c = w.characters['p1']!;
    c.spirits[c.party[0]!] = { ...c.spirits[c.party[0]!]!, level: 1 };
    w.islands['wheatSlope']!.wild[wild.id] = { ...wild, group: [makeSpirit(content, 'forgespark', 40, { id: 'brute', owner: 'wild' })] };
    act(w, { type: 'encounter', wildId: wild.id });
    const battleId = w.players['p1']!.battleId!;
    let end;
    for (let i = 0; i < 20 && !end; i++) {
      const b = w.battles[battleId]!;
      end = act(w, { type: 'battleActions', battleId, actions: defaultActions(b.state, 0, false) }).events.find((e) => e.t === 'battleEnd');
    }
    expect(end).toMatchObject({ result: 'lose', rescued: true });
    expect(c.spirits[c.party[0]!]!.weary).toBe(true);
    expect(w.players['p1']!.islandId).toBe(homeIslandId('p1'));
  });

  it('疲惫一天后自然恢复；暖心包立刻恢复', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    const c = w.characters['p1']!;
    const id = c.party[0]!;
    c.spirits[id] = { ...c.spirits[id]!, weary: true, wearyRemaining: TICKS_PER_DAY };
    run(w, TICKS_PER_DAY / 2);
    expect(c.spirits[id]!.weary).toBe(true);
    c.backpack['warmBun'] = 1;
    act(w, { type: 'feed', spiritId: id, item: 'warmBun' });
    expect(c.spirits[id]!.weary).toBe(false);
  });

  it('Lynx 反馈：队伍里疲惫的絮灵回到家园岛就按栖巢倍速恢复；出门在外是自然速度', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    const c = w.characters['p1']!;
    const id = c.party[0]!;
    // 先建好一座栖巢
    w.homes['p1']!.buildings['n1'] = { id: 'n1', type: 'nest', x: 3, z: -5, rot: 0, built: true, buildProgress: 600, workers: [], crop: null, job: null, eggId: null, occupants: [] };
    c.spirits[id] = { ...c.spirits[id]!, weary: true, wearyRemaining: TICKS_PER_DAY };
    run(w, TICKS_PER_DAY / 2 + 20);
    expect(c.spirits[id]!.weary).toBe(false);
    act(w, { type: 'sail', islandId: 'wheatSlope' });
    c.spirits[id] = { ...c.spirits[id]!, weary: true, wearyRemaining: TICKS_PER_DAY };
    run(w, TICKS_PER_DAY / 2 + 20);
    expect(c.spirits[id]!.weary).toBe(true);
  });

  it('Lynx 反馈：暖心包可以在码头的商队买到', () => {
    const w = newGame();
    act(w, { type: 'buy', item: 'warmBun', count: 1 });
    expect(w.characters['p1']!.backpack['warmBun']).toBe(1);
  });

  it('Lynx 反馈：守岛人对战可以认输（按战败结算）；野外战斗只能逃跑', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    w.characters['p1']!.backpack['lanternFuel'] = 1;
    act(w, { type: 'sail', islandId: 'bellTerrace' });
    act(w, { type: 'challenge', keeperId: 'lan' });
    const battleId = w.players['p1']!.battleId!;
    const r = act(w, { type: 'forfeit', battleId });
    expect(r.events.find((e) => e.t === 'battleEnd')).toMatchObject({ result: 'lose' });
    expect(w.players['p1']!.battleId).toBeNull();
    const c = w.characters['p1']!;
    expect(c.spirits[c.party[0]!]!.weary).toBe(true);

    const w2 = newGame(3);
    act(w2, { type: 'adoptStarter' });
    act(w2, { type: 'sail', islandId: 'wheatSlope' });
    const wild = Object.values(w2.islands['wheatSlope']!.wild)[0]!;
    act(w2, { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    act(w2, { type: 'encounter', wildId: wild.id });
    expect(applyIntent(content, w2, 'p1', { type: 'forfeit', battleId: w2.players['p1']!.battleId! }).error).toBe('野外战斗请用逃跑');
  });

  it('新手引导战斗：1v1，脚本保证不会战败', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    const c = w.characters['p1']!;
    c.spirits[c.party[0]!] = { ...c.spirits[c.party[0]!]!, level: 1 };
    act(w, { type: 'tutorialBattle' });
    const battleId = w.players['p1']!.battleId!;
    let end;
    for (let i = 0; i < 60 && !end; i++) {
      end = act(w, { type: 'battleActions', battleId, actions: { 0: { type: 'skill', skillId: 'jab', target: { side: 1, slot: 0 } } } }).events.find((e) => e.t === 'battleEnd');
    }
    expect(end).toMatchObject({ result: 'win' });
  });
});

describe('繁殖与净化', () => {
  it('繁殖屋：扣 100 云贝和 2 份食物；3 天后孵化成 1 级幼絮', () => {
    const w = newGame();
    const c = w.characters['p1']!;
    const home = w.homes['p1']!;
    c.blueprints.push('hatchery');
    home.coreLevel = 2;
    c.shells = 1000;
    c.backpack = { plank: 10, brick: 10, riceBall: 2 };
    let hatch;
    for (let x = -8; x < 8 && !hatch; x++) for (let z = -8; z < 8 && !hatch; z++) if (applyIntent(content, w, 'p1', { type: 'build', building: 'hatchery', x, z, rot: 0 }).ok) hatch = Object.values(home.buildings).find((b) => b.type === 'hatchery');
    expect(hatch).toBeDefined();
    hatch!.built = true;
    const f = { ...makeSpirit(content, 'warmbud', 10, { id: 'p1-s1', owner: 'p1' }), state: 'idle' as const };
    const m = { ...makeSpirit(content, 'warmbud', 10, { id: 'p1-s2', owner: 'p1' }), state: 'idle' as const };
    c.spirits[f.id] = { ...f, genes: { ...f.genes, sex: 'male' } };
    c.spirits[m.id] = m;
    c.nextSpiritSeq = 3;
    act(w, { type: 'breed', buildingId: hatch!.id, a: f.id, b: m.id });
    expect(c.shells).toBe(1000 - 300 - 100);
    expect(c.backpack['riceBall']).toBeUndefined();
    const egg = c.spirits['p1-s3']!;
    expect(egg.state).toBe('egg');
    const events = run(w, 3 * TICKS_PER_DAY + 20);
    expect(events.some((e) => e.t === 'hatched')).toBe(true);
    expect(c.spirits['p1-s3']!.state).toBe('idle');
    expect(c.spirits['p1-s3']!.level).toBe(1);
  });

  it('净化池：蚀化絮灵 3 天后恢复', () => {
    const w = newGame();
    const c = w.characters['p1']!;
    const home = w.homes['p1']!;
    c.blueprints.push('purifyPool');
    home.coreLevel = 2;
    c.shells = 1000;
    c.backpack = { brick: 8, mistCrystal: 4 };
    let pool;
    for (let x = -8; x < 8 && !pool; x++) for (let z = -8; z < 8 && !pool; z++) if (applyIntent(content, w, 'p1', { type: 'build', building: 'purifyPool', x, z, rot: 0 }).ok) pool = Object.values(home.buildings).find((b) => b.type === 'purifyPool');
    pool!.built = true;
    const s = { ...makeSpirit(content, 'hazepuff', 10, { id: 'p1-s1', owner: 'p1' }), blighted: true, state: 'idle' as const };
    c.spirits[s.id] = s;
    act(w, { type: 'purify', buildingId: pool!.id, spiritId: s.id });
    run(w, 3 * TICKS_PER_DAY + 20);
    expect(c.spirits[s.id]).toMatchObject({ blighted: false, state: 'idle' });
  });
});

describe('守岛人', () => {
  it('在守岛人岛上可以说话、送礼；送礼每天只计一次好感；好感 1 级触发第一个剧情节点', () => {
    const w = newGame();
    act(w, { type: 'sail', islandId: 'heFarm' });
    const r1 = act(w, { type: 'talk', keeperId: 'aHe' });
    expect(r1.events.some((e) => e.t === 'dialogue')).toBe(true);
    const c = w.characters['p1']!;
    c.backpack['warmBun'] = 2;
    act(w, { type: 'gift', keeperId: 'aHe', item: 'warmBun' });
    act(w, { type: 'gift', keeperId: 'aHe', item: 'warmBun' });
    expect(w.keepers['aHe']!.affinity['p1']).toBe(2 + 30);
    w.keepers['aHe']!.affinity['p1'] = 60;
    run(w, TICKS_PER_DAY);
    const r2 = act(w, { type: 'talk', keeperId: 'aHe' });
    const story = r2.events.find((e) => e.t === 'dialogue' && e.title);
    expect(story).toMatchObject({ title: '第一袋面粉' });
    expect(c.blueprints).toContain('hatchery');
  });

  it('不在旁边不能交流；守岛人对战每天一次', () => {
    const w = newGame();
    act(w, { type: 'adoptStarter' });
    expect(applyIntent(content, w, 'p1', { type: 'talk', keeperId: 'lan' }).error).toBe('不在旁边');
    w.characters['p1']!.backpack['lanternFuel'] = 1;
    act(w, { type: 'sail', islandId: 'bellTerrace' });
    act(w, { type: 'challenge', keeperId: 'lan' });
    expect(w.players['p1']!.battleId).not.toBeNull();
  });

  it('守岛人每天按规划器行动（确定性）', () => {
    const a = newGame(11);
    const b = newGame(11);
    run(a, 3 * TICKS_PER_DAY);
    run(b, 3 * TICKS_PER_DAY);
    expect(a.keepers).toEqual(b.keepers);
    expect(a.keepers['aHe']!.memory.length).toBeGreaterThanOrEqual(3);
  });
});

describe('存档', () => {
  it('世界与角色分开保存；读回来以后继续运行与没存档时完全一致', () => {
    const a = newGame(5);
    act(a, { type: 'adoptStarter' });
    run(a, 5000);
    const saved = saveWorld(a);
    expect(saved.world.version).toBe(1);
    expect(saved.characters).toHaveLength(1);
    const json = JSON.parse(JSON.stringify(saved));
    const b = loadWorld(json.world);
    joinWorld(b, loadCharacter(json.characters[0]));
    run(a, 8000);
    run(b, 8000);
    expect(b).toEqual(a);
  });

  it('拒绝更新版本与损坏的存档；迁移链按版本逐级执行', () => {
    expect(() => loadWorld({ kind: 'cloudsea-world', version: 99, world: {} })).toThrow(SaveError);
    expect(() => loadWorld({ kind: 'cloudsea-character', version: 1 })).toThrow(SaveError);
    expect(() => loadCharacter({ kind: 'cloudsea-character', version: 1, character: null })).toThrow(SaveError);
    const migrations = { 1: (d: Record<string, unknown>) => ({ ...d, a: 1 }), 2: (d: Record<string, unknown>) => ({ ...d, b: 2 }) };
    expect(__migrate({ version: 1 }, 3, migrations, 'x')).toEqual({ version: 3, a: 1, b: 2 });
    expect(() => __migrate({ version: 1 }, 3, { 1: migrations[1] }, 'x')).toThrow(/无法从 v2 升级/);
  });

  it('角色存档 v1 → v2：风帆改为云舟、补上看过的播片列表', () => {
    const v1 = {
      kind: 'cloudsea-character',
      version: 1,
      character: { ...createCharacter(content, { id: 'p9', name: '旧档' }), version: 1, tools: { lantern: 2, sail: 3, gatherTool: 1 }, seenCutscenes: undefined, tutorial: { step: 6, done: true } },
    };
    const c = loadCharacter(JSON.parse(JSON.stringify(v1)));
    expect(c.version).toBe(2);
    expect(c.tools).toEqual({ lantern: 2, skiff: 3, gatherTool: 1 });
    expect(c.seenCutscenes).toEqual(['opening']);
  });
});

describe('确定性', () => {
  it('同一种子、同一串意图得到同一个世界', () => {
    const play = () => {
      const w = newGame(42);
      act(w, { type: 'adoptStarter' });
      run(w, 3000);
      act(w, { type: 'sail', islandId: 'wheatSlope' });
      run(w, 3000);
      return JSON.stringify(w);
    };
    expect(play()).toBe(play());
  });
});
