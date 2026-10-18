import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { AI_PRESETS, chooseActions } from '../battle/ai';
import { encodeTeamCode } from '../spirit/teamCode';
import { makeSpirit } from '../testing';
import { createCharacter, createWorld, joinWorld } from './create';
import { applyIntent } from './intents';
import { decodeIslandCode, encodeIslandCode, islandLayoutOf } from './islandCode';
import type { WorldState } from './state';

const content = getContent();

function world(): WorldState {
  const w = createWorld(content, { seed: 21, hostId: 'p1' });
  const c = createCharacter(content, { id: 'p1', name: '测试' });
  ['warmbud', 'eavedrop', 'forgespark'].forEach((line, k) => {
    const s = makeSpirit(content, line, 30, { id: `p1-s${k + 1}`, owner: 'p1', talents: 20, formIndex: 1 });
    c.spirits[s.id] = { ...s, state: 'party' };
    c.party.push(s.id);
  });
  c.tutorial = { step: 6, done: true };
  joinWorld(w, c);
  return w;
}

describe('岛屿码（M3-5，DESIGN 10）', () => {
  it('往返：地形种子、岛核等级、建筑类型 / 位置 / 朝向 / 作物都还原', () => {
    const w = world();
    const home = w.homes['p1']!;
    home.coreLevel = 4;
    home.buildings['bx1'] = { id: 'bx1', type: 'field', x: -6, z: 3, rot: 1, built: true, buildProgress: 0, workers: [], crop: { cropId: [...content.crops.keys()][1]!, progress: 10, seedItem: 'x' }, job: null, eggId: null, occupants: [] };
    home.buildings['bx2'] = { id: 'bx2', type: 'lamp', x: 9, z: -11, rot: 3, built: true, buildProgress: 0, workers: [], crop: null, job: null, eggId: null, occupants: [] };
    const layout = islandLayoutOf(home);
    const code = encodeIslandCode(content, layout);
    expect(code.startsWith('XI-')).toBe(true);
    const back = decodeIslandCode(content, code.toLowerCase());
    expect(back).toEqual(layout);
  });

  it('校验位与长度：改一个字符或少抄一段都拒绝；岛核等级越界拒绝', () => {
    const w = world();
    const code = encodeIslandCode(content, islandLayoutOf(w.homes['p1']!));
    const pos = code.length - 3;
    const flipped = code.slice(0, pos) + (code[pos] === 'A' ? 'B' : 'A') + code.slice(pos + 1);
    expect(decodeIslandCode(content, flipped)).toMatch(/校验/);
    expect(decodeIslandCode(content, code.slice(0, code.length - 6))).toMatch(/长度|不完整/);
    expect(decodeIslandCode(content, encodeIslandCode(content, { seed: 1, coreLevel: 0, buildings: [] }))).toMatch(/岛核/);
  });
});

describe('队伍码挑战（M3-5）', () => {
  it('只能在家园岛进行；对手由困难 AI 操控；友谊战不得经验和云贝、伤势不带出去', () => {
    const w = world();
    const theirs = ['stormray', 'lilypad', 'gustmoth'].map((line, i) => makeSpirit(content, line, 25, { id: `x${i}`, formIndex: 1 }));
    const code = encodeTeamCode(content, theirs);
    w.players['p1']!.islandId = 'wheatSlope';
    expect(applyIntent(content, w, 'p1', { type: 'teamChallenge', code }).error).toMatch(/家园岛/);
    w.players['p1']!.islandId = 'home:p1';
    expect(applyIntent(content, w, 'p1', { type: 'teamChallenge', code: 'XT-ABCD' }).ok).toBe(false);
    expect(applyIntent(content, w, 'p1', { type: 'teamChallenge', code }).ok).toBe(true);
    const id = w.players['p1']!.battleId!;
    const b = w.battles[id]!;
    expect(b.kind).toBe('teamCode');
    expect(b.state.sides[1].units.map((u) => u.formId)).toEqual(theirs.map((s) => s.formId));
    const before = JSON.stringify(Object.values(w.characters['p1']!.spirits).map((s) => [s.exp, s.condition]));
    const shells = w.characters['p1']!.shells;
    for (let i = 0; i < 80 && w.battles[id]; i++) {
      const actions = chooseActions(content, w.battles[id]!.state, 0, { ...AI_PRESETS.hard, seed: i });
      expect(applyIntent(content, w, 'p1', { type: 'battleActions', battleId: id, actions }).ok).toBe(true);
    }
    expect(w.battles[id]).toBeUndefined();
    expect(JSON.stringify(Object.values(w.characters['p1']!.spirits).map((s) => [s.exp, s.condition]))).toBe(before);
    expect(w.characters['p1']!.shells).toBe(shells);
  });
});
