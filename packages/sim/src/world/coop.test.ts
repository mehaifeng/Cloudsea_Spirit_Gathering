import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { activeUnits, defaultActions } from '../battle/engine';
import type { BattleAction, BattleEvent, SideActions } from '../battle/types';
import { makeSpirit } from '../testing';
import { BATTLE_CHOICE_TICKS, CLOUDLORD_SPOT, playerLeaves } from './battleflow';
import { createCharacter, createWorld, joinWorld } from './create';
import type { WorldEvent } from './events';
import { applyIntent, type Intent } from './intents';
import { loadWorld, saveWorld } from './save';
import type { ActiveBattle, WorldState } from './state';
import { advanceWorld } from './tick';

const content = getContent();

/** 房主 p1 + 若干客人，每人一队指定等级的絮灵（直接写进角色，测试用）。 */
function coopWorld(players: number, level = 30, seed = 11): WorldState {
  const w = createWorld(content, { seed, hostId: 'p1' });
  for (let i = 1; i <= players; i++) {
    const id = `p${i}`;
    const c = createCharacter(content, { id, name: `玩家${i}` });
    const lines = ['warmbud', 'eavedrop', 'kitefluff', 'forgespark'];
    for (let k = 0; k < 3; k++) {
      const s = makeSpirit(content, lines[(i + k) % 4]!, level, { id: `${id}-s${k + 1}`, owner: id, talents: 25, formIndex: level >= 16 ? 1 : 0 });
      c.spirits[s.id] = { ...s, state: 'party' };
      c.party.push(s.id);
    }
    c.tutorial = { step: 6, done: true };
    joinWorld(w, c);
  }
  // 云主战的测试：灯塔守卫当作已经打过（守卫另有测试，M3-2）
  w.guardiansBeaten.push('sunPlainsLord');
  return w;
}

function act(w: WorldState, pid: string, intent: Intent): readonly WorldEvent[] {
  const r = applyIntent(content, w, pid, intent);
  if (!r.ok) throw new Error(`${pid} ${intent.type}: ${r.error}`);
  return r.events;
}

/** 坐云舟去某座岛（测试里直接飞到）。 */
function sailAll(w: WorldState, pids: string[], islandId: string): void {
  for (const pid of pids) act(w, pid, { type: 'sail', islandId });
  while (pids.some((pid) => w.players[pid]!.voyage)) advanceWorld(content, w, 10);
}

/** 某位玩家为自己的位置选行动：能打就打第一只活着的对手，否则防御。 */
function myActions(b: ActiveBattle, pid: string, skill = 'jab'): SideActions {
  const out: Record<number, BattleAction> = {};
  const foe = activeUnits(b.state, 1)[0];
  for (const { slot, unit } of activeUnits(b.state, 0)) {
    if (unit.ownerId !== pid || unit.charging) continue;
    out[slot] = foe ? { type: 'skill', skillId: skill, target: { side: 1, slot: foe.slot } } : { type: 'skill', skillId: 'guard' };
  }
  return out;
}

describe('多人战斗（DESIGN 5.3，M2）', () => {
  it('野外：同岛玩家在第一回合结算前加入；位置按加入顺序分配，剩下的归发起者；各自只能指挥自己的絮灵', () => {
    const w = coopWorld(2, 8);
    sailAll(w, ['p1', 'p2'], 'wheatSlope');
    const wild = Object.values(w.islands['wheatSlope']!.wild)[0]!;
    act(w, 'p1', { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    act(w, 'p2', { type: 'move', x: wild.x + 1, z: wild.z + 1, yaw: 0 });
    act(w, 'p1', { type: 'encounter', wildId: wild.id });
    const id = w.players['p1']!.battleId!;
    const joined = act(w, 'p2', { type: 'joinBattle', battleId: id });
    expect(joined.some((e) => e.t === 'battleStart' && e.playerId === 'p2')).toBe(true);
    const b = w.battles[id]!;
    expect(b.participants).toEqual(['p1', 'p2']);
    expect(w.players['p2']!.battleId).toBe(id);
    const owners = activeUnits(b.state, 0).map((a) => a.unit.ownerId);
    expect(owners).toEqual(['p1', 'p2', 'p1']);
    // 加入者带 2 只：1 上场 1 替补
    expect(b.state.sides[0].units.filter((u) => u.ownerId === 'p2')).toHaveLength(2);
    // 不能指挥别人的絮灵
    expect(applyIntent(content, w, 'p2', { type: 'battleActions', battleId: id, actions: { 0: { type: 'skill', skillId: 'guard' } } }).error).toBe('只能指挥自己的絮灵');
    // 一人选好还不结算，两人都选好才结算；两人都收到这一回合
    const turn0 = b.state.turn;
    act(w, 'p1', { type: 'battleActions', battleId: id, actions: myActions(b, 'p1') });
    expect(w.battles[id]?.state.turn).toBe(turn0);
    const ev = act(w, 'p2', { type: 'battleActions', battleId: id, actions: myActions(b, 'p2') });
    const turns = ev.filter((e) => e.t === 'battleTurn').map((e) => e.playerId);
    expect(turns.sort()).toEqual(['p1', 'p2']);
    // 回合结算后不能再加入
    if (w.battles[id]) {
      joinWorld(w, createCharacter(content, { id: 'p3', name: '迟到' }));
      expect(applyIntent(content, w, 'p3', { type: 'joinBattle', battleId: id }).error).toBeTruthy();
    }
  });

  it('多人战斗 30 秒没选完：没选的位置按防御自动结算', () => {
    const w = coopWorld(2, 8);
    sailAll(w, ['p1', 'p2'], 'wheatSlope');
    const wild = Object.values(w.islands['wheatSlope']!.wild)[0]!;
    act(w, 'p1', { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    act(w, 'p2', { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    act(w, 'p1', { type: 'encounter', wildId: wild.id });
    const id = w.players['p1']!.battleId!;
    act(w, 'p2', { type: 'joinBattle', battleId: id });
    act(w, 'p1', { type: 'battleActions', battleId: id, actions: myActions(w.battles[id]!, 'p1') });
    const turn0 = w.battles[id]!.state.turn;
    const events: WorldEvent[] = [];
    for (let t = 0; t < BATTLE_CHOICE_TICKS + 10; t += 10) events.push(...advanceWorld(content, w, 10));
    const turn = events.find((e) => e.t === 'battleTurn');
    expect(turn).toBeTruthy();
    expect(!w.battles[id] || w.battles[id]!.state.turn > turn0).toBe(true);
  });

  it('多人战斗中有人离线：他移出参战者，剩下的人继续；单人战斗离线按认输结算', () => {
    const w = coopWorld(2, 8);
    sailAll(w, ['p1', 'p2'], 'wheatSlope');
    const wild = Object.values(w.islands['wheatSlope']!.wild)[0]!;
    act(w, 'p1', { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    act(w, 'p2', { type: 'move', x: wild.x, z: wild.z + 1, yaw: 0 });
    act(w, 'p1', { type: 'encounter', wildId: wild.id });
    const id = w.players['p1']!.battleId!;
    act(w, 'p2', { type: 'joinBattle', battleId: id });
    const events: WorldEvent[] = [];
    const left = playerLeaves(content, w, 'p2', events);
    expect(left?.id).toBe('p2');
    expect(w.characters['p2']).toBeUndefined();
    expect(w.battles[id]!.participants).toEqual(['p1']);
    // p1 一个人选好就结算（p2 的位置按防御）
    const ev = act(w, 'p1', { type: 'battleActions', battleId: id, actions: myActions(w.battles[id]!, 'p1') });
    expect(ev.some((e) => e.t === 'battleTurn')).toBe(true);
    // 单人：离线 = 认输
    const ev2: WorldEvent[] = [];
    if (w.battles[id]) {
      playerLeaves(content, w, 'p1', ev2);
      expect(w.battles[id]).toBeUndefined();
      expect(ev2.some((e) => e.t === 'battleEnd')).toBe(true);
    }
  });
});

describe('云主战（DESIGN 5.3，M2）', () => {
  /** 4 人在灯塔岛上：p1 发起，其余加入。 */
  function raid(level: number, seed = 11) {
    const w = coopWorld(4, level, seed);
    const pids = ['p1', 'p2', 'p3', 'p4'];
    sailAll(w, pids, 'sunLighthouse');
    for (const pid of pids) act(w, pid, { type: 'move', x: CLOUDLORD_SPOT.x, z: CLOUDLORD_SPOT.z + 3, yaw: Math.PI });
    act(w, 'p1', { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' });
    const id = w.players['p1']!.battleId!;
    for (const pid of pids.slice(1)) act(w, pid, { type: 'joinBattle', battleId: id });
    return { w, id, pids };
  }

  it('4 人：位置数 = 人数，每人 1 上场 1 替补；云主生命 ×2.8；天候固定为晴；云主每回合行动两次', () => {
    const { w, id, pids } = raid(30);
    const b = w.battles[id]!;
    expect(b.kind).toBe('cloudlord');
    expect(b.state.sides[0].active).toHaveLength(4);
    expect(activeUnits(b.state, 0).map((a) => a.unit.ownerId)).toEqual(pids);
    expect(b.state.sides[0].units).toHaveLength(8);
    const boss = b.state.sides[1].units[0]!;
    expect(boss.name).toBe('蚀化的曦冕');
    expect(boss.maxHp).toBe(Math.round(boss.stats.hp * 2.8));
    expect(boss.extraActions).toBe(1);
    expect(b.state.field.base).toBe('sun');
    expect(b.state.sides[1].units).toHaveLength(3);
    // 打一回合：云主出手两次（云气够的时候）
    let ev: readonly WorldEvent[] = [];
    for (const pid of pids) ev = act(w, pid, { type: 'battleActions', battleId: id, actions: myActions(w.battles[id]!, pid, 'guard') });
    const turn = ev.find((e) => e.t === 'battleTurn' && e.playerId === 'p1') as Extract<WorldEvent, { t: 'battleTurn' }>;
    const bossUses = turn.events.filter((e: BattleEvent) => e.t === 'use' && e.uid === boss.uid);
    expect(bossUses.length).toBe(2);
  });

  it('4 人讨伐到底：阶段切换、胜利后灯塔重燃、每人都拿到奖励、不能再挑战；全程确定（同样的意图得到同样的世界）', () => {
    const play = () => {
      const { w, id, pids } = raid(36);
      const shells0 = pids.map((pid) => w.characters[pid]!.shells);
      const all: BattleEvent[] = [];
      let end: WorldEvent | undefined;
      for (let round = 0; round < 80 && !end; round++) {
        for (const pid of pids) {
          const b = w.battles[id];
          if (!b) break;
          const ev = act(w, pid, { type: 'battleActions', battleId: id, actions: myActions(b, pid, 'jab') });
          for (const e of ev) {
            if (e.t === 'battleTurn' && e.playerId === 'p1') all.push(...e.events);
            if (e.t === 'battleEnd' && e.playerId === 'p1') end = e;
          }
        }
      }
      return { w, pids, shells0, all, end };
    };
    const a = play();
    expect(a.end).toMatchObject({ result: 'win' });
    expect(a.all.filter((e) => e.t === 'phase').map((e) => (e as Extract<BattleEvent, { t: 'phase' }>).phase)).toEqual([1, 2]);
    expect(a.w.lighthousesLit).toEqual(['sunPlainsLord']);
    a.pids.forEach((pid, i) => expect(a.w.characters[pid]!.shells - a.shells0[i]!).toBe(300));
    for (const pid of a.pids) expect(a.w.players[pid]!.battleId).toBeNull();
    expect(applyIntent(content, a.w, 'p1', { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' }).error).toBe('灯塔已经重新点亮了');
    const b = play();
    expect(JSON.stringify(b.w)).toBe(JSON.stringify(a.w));
  });

  it('单人也能讨伐：3 个位置，云主生命 ×1.0；输了可以立即重试', () => {
    const w = coopWorld(1, 5);
    sailAll(w, ['p1'], 'sunLighthouse');
    act(w, 'p1', { type: 'move', x: CLOUDLORD_SPOT.x, z: CLOUDLORD_SPOT.z + 3, yaw: 0 });
    act(w, 'p1', { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' });
    const id = w.players['p1']!.battleId!;
    const b = w.battles[id]!;
    expect(b.state.sides[0].active).toHaveLength(3);
    expect(b.state.sides[1].units[0]!.maxHp).toBe(b.state.sides[1].units[0]!.stats.hp);
    expect(b.deadlineTick).toBeNull();
    let end: WorldEvent | undefined;
    for (let i = 0; i < 60 && !end; i++) {
      const cur = w.battles[id];
      if (!cur) break;
      end = act(w, 'p1', { type: 'battleActions', battleId: id, actions: defaultActions(cur.state, 0, false) }).find((e) => e.t === 'battleEnd');
    }
    expect(end).toMatchObject({ result: 'lose' });
    expect(w.lighthousesLit).toEqual([]);
  });

  it('不在灯塔岛 / 离得太远不能发起', () => {
    const w = coopWorld(1, 10);
    expect(applyIntent(content, w, 'p1', { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' }).error).toBe('要先到灯塔岛上');
    sailAll(w, ['p1'], 'sunLighthouse');
    act(w, 'p1', { type: 'move', x: 20, z: 20, yaw: 0 });
    expect(applyIntent(content, w, 'p1', { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' }).error).toBe('再靠近一点');
  });

  it('世界存档 v3 → v4：补上重燃灯塔列表', () => {
    const w = coopWorld(1);
    const saved = JSON.parse(JSON.stringify(saveWorld(w).world));
    saved.version = 3;
    delete saved.world.lighthousesLit;
    expect(loadWorld(saved).lighthousesLit).toEqual([]);
  });
});
