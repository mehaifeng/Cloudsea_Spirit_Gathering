import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { makeSpirit } from '../testing';
import { AI_PRESETS, chooseActions } from './ai';
import { createBattle, resolveTurn, validateActions } from './engine';
import type { BattleState } from './types';

const content = getContent();

function battle(seed: number): BattleState {
  return createBattle(content, {
    kind: 'friendly',
    sides: [
      { spirits: ['warmbud', 'eavedrop', 'forgespark'].map((l, i) => makeSpirit(content, l, 25, { id: `a${i}`, formIndex: 1 })) },
      { spirits: ['kitefluff', 'hazepuff', 'warmbud'].map((l, i) => makeSpirit(content, l, 25, { id: `b${i}`, formIndex: 1 })) },
    ],
    baseWeather: 'sun',
    seed,
  });
}

describe('战斗 AI', () => {
  it('总是给出合法行动，并能把战斗打完', () => {
    for (const preset of Object.values(AI_PRESETS)) {
      let s = battle(3);
      for (let turn = 0; turn < 80 && !s.outcome; turn++) {
        const a = chooseActions(content, s, 0, { ...preset, seed: 1 });
        const b = chooseActions(content, s, 1, { ...preset, seed: 2 });
        expect(validateActions(content, s, 0, a)).toBeNull();
        expect(validateActions(content, s, 1, b)).toBeNull();
        s = resolveTurn(content, s, [a, b]).state;
      }
      expect(s.outcome).not.toBeNull();
    }
  });

  it('确定性：同一种子同一选择', () => {
    const s = battle(5);
    expect(chooseActions(content, s, 0, { ...AI_PRESETS.hard, seed: 9 })).toEqual(chooseActions(content, s, 0, { ...AI_PRESETS.hard, seed: 9 }));
  });

  it('能击倒时优先击倒', () => {
    const s = battle(1);
    const weak = s.sides[1].units[0]!;
    weak.hp = 1;
    const a = chooseActions(content, s, 0, { ...AI_PRESETS.hard, seed: 1 });
    const targeted = Object.values(a).filter((x) => x.type === 'skill' && x.target?.side === 1 && x.target.slot === 0);
    expect(targeted.length).toBeGreaterThan(0);
  });

  it('困难 AI 对随机失误很多的 AI 胜率明显更高', () => {
    let wins = 0;
    const N = 30;
    for (let i = 0; i < N; i++) {
      let s = battle(100 + i);
      for (let t = 0; t < 80 && !s.outcome; t++) {
        const a = chooseActions(content, s, 0, { ...AI_PRESETS.hard, seed: i });
        const b = chooseActions(content, s, 1, { depth: 0, mistakeRate: 0.8, seed: i + 1000 });
        s = resolveTurn(content, s, [a, b]).state;
      }
      if (s.outcome?.winner === 0) wins++;
    }
    expect(wins / N).toBeGreaterThan(0.6);
  });
});
