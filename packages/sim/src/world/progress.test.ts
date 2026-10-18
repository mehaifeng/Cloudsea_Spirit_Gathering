import { getContent, REGIONS } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { AI_PRESETS, chooseActions } from '../battle/ai';
import { activeUnits } from '../battle/engine';
import type { BattleAction, SideActions } from '../battle/types';
import { makeSpirit } from '../testing';
import { CLOUDLORD_SPOT, GUARDIAN_SPOT } from './battleflow';
import { createCharacter, createWorld, joinWorld } from './create';
import type { WorldEvent } from './events';
import { applyIntent, type Intent } from './intents';
import { allLit, chapterOf, effectiveFog, regionUnlocked } from './progress';
import { loadWorld, saveWorld } from './save';
import type { ActiveBattle, WorldState } from './state';
import { advanceWorld } from './tick';
import { spawnTable } from './wild';

const content = getContent();

function world(level = 60): WorldState {
  const w = createWorld(content, { seed: 5, hostId: 'p1' });
  const c = createCharacter(content, { id: 'p1', name: '测试' });
  ['warmbud', 'forgespark', 'eavedrop'].forEach((line, k) => {
    const s = makeSpirit(content, line, level, { id: `p1-s${k + 1}`, owner: 'p1', talents: 31, formIndex: 2 });
    c.spirits[s.id] = { ...s, state: 'party' };
    c.party.push(s.id);
  });
  c.tools = { lantern: 5, skiff: 5, gatherTool: 1 };
  c.backpack['lanternFuel'] = 99;
  c.tutorial = { step: 6, done: true };
  joinWorld(w, c);
  return w;
}

function act(w: WorldState, intent: Intent): readonly WorldEvent[] {
  const r = applyIntent(content, w, 'p1', intent);
  if (!r.ok) throw new Error(`${intent.type}: ${r.error}`);
  if (intent.type === 'sail') while (w.players['p1']!.voyage) advanceWorld(content, w, 10);
  return r.events;
}

function jab(b: ActiveBattle): SideActions {
  const out: Record<number, BattleAction> = {};
  const foe = activeUnits(b.state, 1)[0];
  for (const { slot, unit } of activeUnits(b.state, 0)) if (!unit.charging) out[slot] = foe ? { type: 'skill', skillId: 'jab', target: { side: 1, slot: foe.slot } } : { type: 'skill', skillId: 'guard' };
  return out;
}

/** 打到这场战斗结束，返回所有事件。smart = 我方也用战斗 AI（高难度，测流程而不是测数值）。 */
function fightOut(w: WorldState, smart = false): WorldEvent[] {
  const all: WorldEvent[] = [];
  for (let i = 0; i < 120; i++) {
    const id = w.players['p1']!.battleId;
    if (!id) break;
    const b = w.battles[id]!;
    const actions = smart ? chooseActions(content, b.state, 0, { ...AI_PRESETS.hard, seed: i }) : jab(b);
    all.push(...act(w, { type: 'battleActions', battleId: id, actions }));
  }
  return all;
}

describe('主线进度（M3-2）', () => {
  it('云主血量降到阈值会换阶段（同等级队伍打晴原云主）', () => {
    const w = world(16);
    w.guardiansBeaten.push('sunPlainsLord');
    act(w, { type: 'sail', islandId: 'sunLighthouse' });
    act(w, { type: 'move', x: CLOUDLORD_SPOT.x, z: CLOUDLORD_SPOT.z + 2, yaw: 0 });
    act(w, { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' });
    const ev = fightOut(w);
    const phases = ev.filter((e) => e.t === 'battleTurn').flatMap((e) => (e as Extract<WorldEvent, { t: 'battleTurn' }>).events).filter((x) => x.t === 'phase');
    expect(phases.length).toBeGreaterThanOrEqual(1);
  });

  it('大区按顺序开放：晴原一开始就开放；风谷要晴原灯塔重燃；没开放的大区不能出航', () => {
    const w = world();
    expect(regionUnlocked(content, w, 'sunPlains')).toBe(true);
    expect(regionUnlocked(content, w, 'windValley')).toBe(false);
    expect(applyIntent(content, w, 'p1', { type: 'sail', islandId: 'reedCove' }).error).toMatch(/风谷还在浓雾里/);
    w.lighthousesLit.push('sunPlainsLord');
    expect(regionUnlocked(content, w, 'windValley')).toBe(true);
    expect(regionUnlocked(content, w, 'rainMarsh')).toBe(false);
    act(w, { type: 'sail', islandId: 'reedCove' });
    expect(w.players['p1']!.islandId).toBe('reedCove');
  });

  it('灯塔重燃后该区雾散：提灯不够也能去、不耗燃料；但雾里才有的絮灵照样在雾岛刷新', () => {
    const w = world();
    const c = w.characters['p1']!;
    c.tools.lantern = 1;
    const hollow = content.islands.get('mistHollow')!;
    expect(effectiveFog(content, w, hollow)).toBe(2);
    expect(applyIntent(content, w, 'p1', { type: 'sail', islandId: 'mistHollow' }).error).toMatch(/提灯/);
    w.lighthousesLit.push('sunPlainsLord');
    expect(effectiveFog(content, w, hollow)).toBe(0);
    const fuel = c.backpack['lanternFuel']!;
    act(w, { type: 'sail', islandId: 'mistHollow' });
    expect(c.backpack['lanternFuel']).toBe(fuel);
    // 生态不变：烟团（雾浓度 ≥ 2 才出现）还在雾隐谷的刷新表里
    expect(spawnTable(content, hollow, w).some((t) => t.line.id === 'hazepuff')).toBe(true);
  });

  it('灯塔守卫：打赢前不能讨伐云主；守卫开战与输赢都会说话；打赢后能讨伐', () => {
    const w = world();
    act(w, { type: 'sail', islandId: 'sunLighthouse' });
    act(w, { type: 'move', x: CLOUDLORD_SPOT.x - 4, z: CLOUDLORD_SPOT.z + 2, yaw: 0 });
    expect(applyIntent(content, w, 'p1', { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' }).error).toMatch(/先打赢灯塔会守卫/);
    expect(applyIntent(content, w, 'p1', { type: 'challengeGuardian', cloudlordId: 'sunPlainsLord' }).error).toBe('再靠近一点');
    act(w, { type: 'move', x: GUARDIAN_SPOT.x, z: GUARDIAN_SPOT.z + 1, yaw: 0 });
    const start = act(w, { type: 'challengeGuardian', cloudlordId: 'sunPlainsLord' });
    expect(start.some((e) => e.t === 'npcLine')).toBe(true);
    expect(w.battles[w.players['p1']!.battleId!]!.kind).toBe('guardian');
    const ev = fightOut(w);
    expect(ev.find((e) => e.t === 'battleEnd')).toMatchObject({ result: 'win' });
    expect(ev.filter((e) => e.t === 'npcLine')).toHaveLength(1);
    expect(w.guardiansBeaten).toEqual(['sunPlainsLord']);
    expect(w.characters['p1']!.backpack['refinedDew']).toBeGreaterThanOrEqual(2);
    expect(applyIntent(content, w, 'p1', { type: 'challengeGuardian', cloudlordId: 'sunPlainsLord' }).error).toMatch(/已经打赢过/);
    act(w, { type: 'move', x: CLOUDLORD_SPOT.x, z: CLOUDLORD_SPOT.z + 2, yaw: 0 });
    act(w, { type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' });
    expect(w.battles[w.players['p1']!.battleId!]!.kind).toBe('cloudlord');
  });

  it('五位云主：每位都能开战（招式与阶段有效）；依次重燃五座灯塔，最后一座触发终章；章节随之推进', () => {
    const w = world(60);
    let finale = false;
    expect(chapterOf(w)).toBe(1);
    for (const region of REGIONS) {
      const cl = [...content.cloudlords.values()].find((c) => c.region === region)!;
      w.guardiansBeaten.push(cl.id);
      act(w, { type: 'sail', islandId: cl.island });
      act(w, { type: 'move', x: CLOUDLORD_SPOT.x, z: CLOUDLORD_SPOT.z + 2, yaw: 0 });
      act(w, { type: 'challengeCloudlord', cloudlordId: cl.id });
      const b = w.battles[w.players['p1']!.battleId!]!;
      expect(b.state.sides[1].units[0]!.name).toBe(cl.name);
      expect(b.state.field.base).toBe(cl.weather);
      expect(b.state.sides[1].units[0]!.phases, `${cl.id} 阶段`).toHaveLength(cl.phases.length);
      const ev = fightOut(w, true);
      expect(ev.find((e) => e.t === 'battleEnd'), cl.id).toMatchObject({ result: 'win' });
      if (ev.some((e) => e.t === 'finale')) finale = true;
      // 打赢后回家，站在岛核旁养好伤再去下一区
      act(w, { type: 'sail', islandId: 'home' });
      act(w, { type: 'move', x: 0, z: 3, yaw: 0 });
      advanceWorld(content, w, 200);
      expect(Object.values(w.characters['p1']!.spirits).every((s) => s.condition === null)).toBe(true);
    }
    expect(w.lighthousesLit).toHaveLength(5);
    expect(allLit(content, w)).toBe(true);
    expect(chapterOf(w)).toBe(6);
    expect(finale).toBe(true);
  });

  it('五位云主逐一换阶段：生命降到 66% / 33% 以下时换成本阶段的招式、喊出本阶段的台词，第二阶段力量 +2', () => {
    for (const cl of content.cloudlords.values()) {
      const w = world(60);
      const r = REGIONS.indexOf(cl.region);
      for (const prev of REGIONS.slice(0, r)) w.lighthousesLit.push([...content.cloudlords.values()].find((c) => c.region === prev)!.id);
      w.guardiansBeaten.push(cl.id);
      act(w, { type: 'sail', islandId: cl.island });
      act(w, { type: 'move', x: CLOUDLORD_SPOT.x, z: CLOUDLORD_SPOT.z + 2, yaw: 0 });
      act(w, { type: 'challengeCloudlord', cloudlordId: cl.id });
      const id = w.players['p1']!.battleId!;
      const guardAll = (): SideActions => Object.fromEntries(activeUnits(w.battles[id]!.state, 0).map(({ slot }) => [slot, { type: 'skill', skillId: 'guard' } as BattleAction]));
      const boss = () => w.battles[id]!.state.sides[1].units[0]!;
      expect(boss().phases.map((p) => p.hpBelow), cl.id).toEqual(cl.phases.map((p) => p.hpBelow));
      cl.phases.forEach((ph, i) => {
        boss().hp = Math.floor(boss().maxHp * ph.hpBelow) - 1;
        const ev = act(w, { type: 'battleActions', battleId: id, actions: guardAll() });
        const turn = ev.filter((e) => e.t === 'battleTurn').flatMap((e) => (e as Extract<WorldEvent, { t: 'battleTurn' }>).events);
        const phase = turn.find((x) => x.t === 'phase') as { phase: number; line: string } | undefined;
        expect(phase, `${cl.id} 第 ${i + 2} 阶段`).toMatchObject({ phase: i + 1, line: ph.line });
        expect(boss().skills, `${cl.id} 第 ${i + 2} 阶段招式`).toEqual(ph.skills);
        for (const st of ph.stages ?? []) expect(boss().stages[st.stat], `${cl.id} ${st.stat}`).toBeGreaterThanOrEqual(st.delta);
      });
    }
  });

  it('世界存档 v4 → v5：补上灯塔守卫；已经重燃的灯塔视为守卫打赢了', () => {
    const w = world();
    w.lighthousesLit.push('sunPlainsLord');
    const saved = JSON.parse(JSON.stringify(saveWorld(w).world));
    saved.version = 4;
    delete saved.world.guardiansBeaten;
    expect(loadWorld(saved).guardiansBeaten).toEqual(['sunPlainsLord']);
  });
});
