import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { makeSpirit } from '../testing';
import {
  activeUnits,
  createBattle,
  defaultActions,
  findUnit,
  resolveTurn,
  unitAt,
  validateActions,
} from './engine';
import { baseDamage, catchChance, effectiveness, fleeChance, weatherMultiplier } from './formulas';
import { capturedSpirits, conditionFromUnit, expRewards, resultFor } from './rewards';
import type { BattleState, SideActions } from './types';

const content = getContent();
const jab = (slot: number): SideActions => ({ [slot]: { type: 'skill', skillId: 'jab', target: { side: 1, slot: 0 } } });

function duel(a: ReturnType<typeof makeSpirit>[], b: ReturnType<typeof makeSpirit>[], o: Partial<Parameters<typeof createBattle>[1]> = {}): BattleState {
  return createBattle(content, {
    kind: 'friendly',
    sides: [{ spirits: a }, { spirits: b }],
    baseWeather: null,
    seed: 1,
    ...o,
  });
}

function step(state: BattleState, a: SideActions, b: SideActions) {
  expect(validateActions(content, state, 0, a)).toBeNull();
  expect(validateActions(content, state, 1, b)).toBeNull();
  return resolveTurn(content, state, [a, b]);
}

describe('公式', () => {
  it('基础伤害（决策 12）', () => {
    // 60 级、威力 90、力量 = 守护：floor(26 × 90 / 50) + 2 = 48
    expect(baseDamage(60, 90, 120, 120)).toBe(48);
    // 1 级、威力 30：floor(2 × 30 / 50) + 2 = 3
    expect(baseDamage(1, 30, 6, 6)).toBe(3);
  });

  it('相克 ×1.5 / 被克 ×0.67 / 双属性相乘', () => {
    expect(effectiveness('sun', ['mist'])).toBe(1.5);
    expect(effectiveness('mist', ['sun'])).toBe(0.67);
    expect(effectiveness('rain', ['rain'])).toBe(1);
    expect(effectiveness('sun', ['mist', 'mist'])).toBe(2.25);
    expect(effectiveness('mist', ['sun', 'sun'])).toBeCloseTo(0.4489);
  });

  it('天候：同属性 +30%，相生下一属性 +10%', () => {
    expect(weatherMultiplier('rain', 'rain')).toBe(1.3);
    expect(weatherMultiplier('sun', 'rain')).toBe(1.1); // 雨生晴
    expect(weatherMultiplier('wind', 'rain')).toBe(1);
    expect(weatherMultiplier('wind', null)).toBe(1);
  });

  it('捕获率（DESIGN 5.5）', () => {
    expect(catchChance('common', 1, false, 'normal')).toBeCloseTo(0.6 * 0.3);
    expect(catchChance('rare', 0.5, true, 'refined')).toBeCloseTo(0.25 * 0.65 * 1.3 * 1.5);
    expect(catchChance('common', 0, true, 'superior')).toBe(0.95);
  });

  it('逃跑率在 0.25–0.95', () => {
    expect(fleeChance(0, 1000)).toBe(0.25);
    expect(fleeChance(1000, 0)).toBe(0.95);
    expect(fleeChance(100, 100)).toBe(0.5);
  });
});

describe('开战', () => {
  it('云气 3，位置数 = min(3, 出战数)，基准天候', () => {
    const s = duel(
      [makeSpirit(content, 'warmbud', 10, { id: 'a1' }), makeSpirit(content, 'warmbud', 10, { id: 'a2' })],
      [1, 2, 3, 4].map((i) => makeSpirit(content, 'eavedrop', 10, { id: `b${i}` })),
      { baseWeather: 'sun' },
    );
    expect(s.sides[0].qi).toBe(3);
    expect(s.sides[0].active).toEqual([0, 1]);
    expect(s.sides[1].active).toEqual([0, 1, 2]);
    expect(s.field).toEqual({ base: 'sun', current: 'sun', turnsLeft: 0 });
  });
});

describe('回合结算', () => {
  it('同样的输入得到同样的结果（确定性）', () => {
    const s = duel([makeSpirit(content, 'warmbud', 20)], [makeSpirit(content, 'forgespark', 20)]);
    const b: SideActions = { 0: { type: 'skill', skillId: 'jab', target: { side: 0, slot: 0 } } };
    expect(resolveTurn(content, s, [jab(0), b])).toEqual(resolveTurn(content, s, [jab(0), b]));
  });

  it('不修改传入的状态', () => {
    const s = duel([makeSpirit(content, 'warmbud', 20)], [makeSpirit(content, 'forgespark', 20)]);
    const before = JSON.stringify(s);
    resolveTurn(content, s, [jab(0), defaultActions(s, 1)]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('每回合 +2 云气，上限 10；防御每方每回合最多回复 1 点；超时防御不回复', () => {
    let s = duel(
      [makeSpirit(content, 'warmbud', 20, { id: 'a1' }), makeSpirit(content, 'warmbud', 20, { id: 'a2' })],
      [makeSpirit(content, 'warmbud', 20, { id: 'b1' })],
    );
    const guardBoth: SideActions = {
      0: { type: 'skill', skillId: 'guard' },
      1: { type: 'skill', skillId: 'guard' },
    };
    s = step(s, guardBoth, defaultActions(s, 1, true)).state;
    expect(s.sides[0].qi).toBe(3 + 1 + 2);
    expect(s.sides[1].qi).toBe(3 + 2);
    for (let i = 0; i < 5; i++) s = step(s, guardBoth, defaultActions(s, 1, true)).state;
    expect(s.sides[0].qi).toBe(10);
  });

  it('云气不足时行动不合法', () => {
    const s = duel([makeSpirit(content, 'forgespark', 20, { skills: ['boltStrike'] })], [makeSpirit(content, 'warmbud', 20)]);
    const a: SideActions = { 0: { type: 'skill', skillId: 'boltStrike', target: { side: 1, slot: 0 } } };
    expect(validateActions(content, s, 0, a)).toMatch(/云气不足/);
  });

  it('缺少行动、错误目标不合法', () => {
    const s = duel([makeSpirit(content, 'warmbud', 20)], [makeSpirit(content, 'warmbud', 20)]);
    expect(validateActions(content, s, 0, {})).toMatch(/还没有选择/);
    expect(validateActions(content, s, 0, { 0: { type: 'skill', skillId: 'jab', target: { side: 0, slot: 0 } } })).toMatch(/敌方目标/);
    expect(validateActions(content, s, 0, { 0: { type: 'flee' } })).toMatch(/不能逃跑/);
  });

  it('换人优先于先手技能', () => {
    const s = duel(
      [makeSpirit(content, 'warmbud', 20, { id: 'a1' }), makeSpirit(content, 'warmbud', 20, { id: 'a2' })],
      [makeSpirit(content, 'kitefluff', 20, { parts: { wings: 'featherWings' }, formIndex: 1, skills: ['wingBeat'] })],
      { sides: [{ spirits: [makeSpirit(content, 'warmbud', 20, { id: 'a1' }), makeSpirit(content, 'warmbud', 20, { id: 'a2' })], slots: 1 }, { spirits: [makeSpirit(content, 'kitefluff', 20, { formIndex: 1, parts: { wings: 'featherWings' }, skills: ['wingBeat'] })] }] },
    );
    const { events } = step(s, { 0: { type: 'switch', unitIndex: 1 } }, { 0: { type: 'skill', skillId: 'wingBeat' } });
    const order = events.filter((e) => e.t === 'switch' || e.t === 'use').map((e) => e.t);
    expect(order).toEqual(['switch', 'use']);
  });

  it('骤雨改天候为雨，5 回合后回到基准天候', () => {
    let s = duel([makeSpirit(content, 'eavedrop', 30, { skills: ['downpour'] })], [makeSpirit(content, 'hazepuff', 60)], {
      baseWeather: 'sun',
    });
    s = step(s, { 0: { type: 'skill', skillId: 'downpour' } }, defaultActions(s, 1, false)).state;
    expect(s.field.current).toBe('rain');
    for (let i = 0; i < 4; i++) {
      s = step(s, defaultActions(s, 0, false), defaultActions(s, 1, false)).state;
      expect(s.field.current).toBe(i < 3 ? 'rain' : 'sun');
    }
  });

  it('角冲：第 1 回合蓄力不造成伤害，第 2 回合自动出招', () => {
    let s = duel(
      [makeSpirit(content, 'forgespark', 30, { parts: { horns: 'singleHorn' }, skills: ['hornRush'] })],
      [makeSpirit(content, 'hazepuff', 60)],
    );
    const r1 = step(s, { 0: { type: 'skill', skillId: 'hornRush', target: { side: 1, slot: 0 } } }, defaultActions(s, 1, false));
    expect(r1.events.some((e) => e.t === 'charge')).toBe(true);
    expect(r1.events.some((e) => e.t === 'damage' && e.uid === '0:0')).toBe(false);
    s = r1.state;
    expect(validateActions(content, s, 0, {})).toBeNull(); // 蓄力中的单位不需要选择
    const r2 = resolveTurn(content, s, [{}, defaultActions(s, 1, false)]);
    expect(r2.events.some((e) => e.t === 'damage' && e.uid === '0:0')).toBe(true);
    expect(r2.state.sides[0].qi).toBe(s.sides[0].qi + 2); // 第 2 回合不再扣云气
  });

  it('倒下的絮灵在回合结束时由替补补位；全员倒下即战败', () => {
    let s = duel(
      [makeSpirit(content, 'forgespark', 60, { id: 'a1', talents: 31 })],
      [makeSpirit(content, 'warmbud', 1, { id: 'b1' }), makeSpirit(content, 'warmbud', 1, { id: 'b2' })],
      { sides: [{ spirits: [makeSpirit(content, 'forgespark', 60, { id: 'a1', talents: 31 })] }, { spirits: [makeSpirit(content, 'warmbud', 1, { id: 'b1' }), makeSpirit(content, 'warmbud', 1, { id: 'b2' })], slots: 1 }] },
    );
    const r = step(s, jab(0), defaultActions(s, 1, false));
    expect(r.events.some((e) => e.t === 'downed')).toBe(true);
    expect(unitAt(r.state, { side: 1, slot: 0 })!.spiritId).toBe('b2');
    s = r.state;
    const r2 = step(s, jab(0), defaultActions(s, 1, false));
    expect(resultFor(r2.state, 0)).toBe('win');
    expect(resultFor(r2.state, 1)).toBe('lose');
    // 伤势延续（v0.7）：倒下的单位结算为生命 0
    expect(r2.state.sides[1].units.map((u) => conditionFromUnit(r2.state, u)?.hp)).toEqual([0, 0]);
    const exp = expRewards(content, r2.state, 0);
    expect(exp.get('a1')).toBe(2 * Math.floor((250 * 1) / 20));
  });

  it('野外：灯露捕获成功后战斗结束，被捕获的絮灵记录下来', () => {
    let captured = false;
    for (let seed = 1; seed < 20 && !captured; seed++) {
      const s = createBattle(content, {
        kind: 'wild',
        sides: [{ spirits: [makeSpirit(content, 'warmbud', 10)] }, { spirits: [makeSpirit(content, 'warmbud', 3, { id: 'w1' })], wild: true }],
        baseWeather: 'sun',
        seed,
      });
      const r = step(s, { 0: { type: 'dew', quality: 'superior', target: { side: 1, slot: 0 } } }, defaultActions(s, 1, false));
      const attempt = r.events.find((e) => e.t === 'captureAttempt');
      expect(attempt).toBeDefined();
      if (attempt?.t === 'captureAttempt' && attempt.success) {
        captured = true;
        expect(r.state.outcome).toEqual({ winner: 0, reason: 'allCaptured' });
        expect(capturedSpirits(r.state, 0)).toEqual(['w1']);
      }
    }
    expect(captured).toBe(true);
  });

  it('絮尾护替队友挡下攻击', () => {
    const s = duel(
      [
        makeSpirit(content, 'hazepuff', 30, { id: 'a1', parts: { tail: 'fluffTail' }, skills: ['fluffGuard'] }),
        makeSpirit(content, 'warmbud', 30, { id: 'a2' }),
      ],
      [makeSpirit(content, 'forgespark', 30, { id: 'b1' })],
    );
    const r = step(
      s,
      { 0: { type: 'skill', skillId: 'fluffGuard', target: { side: 0, slot: 1 } }, 1: { type: 'skill', skillId: 'guard' } },
      { 0: { type: 'skill', skillId: 'jab', target: { side: 0, slot: 1 } } },
    );
    const dmg = r.events.find((e) => e.t === 'damage');
    expect(r.events.some((e) => e.t === 'intercept')).toBe(true);
    expect(dmg?.t === 'damage' && dmg.target).toBe('0:0');
  });

  it('疾行：灵巧 +1 层只持续本回合', () => {
    const s = duel([makeSpirit(content, 'kitefluff', 30, { parts: { feet: 'sixFeet' }, skills: ['swiftStride'] })], [makeSpirit(content, 'warmbud', 30)]);
    const r = step(s, { 0: { type: 'skill', skillId: 'swiftStride' } }, defaultActions(s, 1, false));
    expect(r.events.some((e) => e.t === 'stage' && e.stat === 'agility')).toBe(true);
    expect(findUnit(r.state, '0:0').unit.timedStages).toEqual([]);
  });

  it('雾隐：闪避 +1 层持续 3 回合', () => {
    let s = duel([makeSpirit(content, 'hazepuff', 30, { skills: ['mistVeil'] })], [makeSpirit(content, 'warmbud', 30)]);
    s = step(s, { 0: { type: 'skill', skillId: 'mistVeil' } }, defaultActions(s, 1, false)).state;
    for (let i = 0; i < 2; i++) {
      expect(findUnit(s, '0:0').unit.timedStages).toHaveLength(1);
      s = step(s, defaultActions(s, 0, false), defaultActions(s, 1, false)).state;
    }
    expect(findUnit(s, '0:0').unit.timedStages).toHaveLength(0);
  });

  it('被动浮游：受到群体攻击伤害 ×0.75', () => {
    const attacker = makeSpirit(content, 'eavedrop', 40, { skills: ['downpour'] });
    const hit = (feet: string) => {
      const s = duel([attacker], [makeSpirit(content, 'hazepuff', 40, { parts: { feet } })]);
      const r = resolveTurn(content, s, [{ 0: { type: 'skill', skillId: 'downpour' } }, defaultActions(s, 1, false)]);
      const d = r.events.find((e) => e.t === 'damage');
      return d?.t === 'damage' ? d.amount : 0;
    };
    const floating = hit('cloudFeet');
    const grounded = hit('fourFeet');
    expect(floating).toBeLessThan(grounded);
    expect(floating / grounded).toBeCloseTo(0.75, 1);
  });

  it('活着的单位都在场上', () => {
    const s = duel([makeSpirit(content, 'warmbud', 5)], [makeSpirit(content, 'warmbud', 5)]);
    expect(activeUnits(s, 0)).toHaveLength(1);
  });
});
