import { getContent, STATS } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { makeSpirit } from '../testing';
import { breed, breedBlocker } from './breeding';
import type { Spirit } from './types';

const content = getContent();
const DAY = 12000;
const ctx = (now = 0) => ({ now, ticksPerDay: DAY, eggId: 'egg1', hatchTicks: 2 * DAY });

function pair(): [Spirit, Spirit] {
  const f = makeSpirit(content, 'warmbud', 20, { id: 'f', talents: 31 });
  const m = makeSpirit(content, 'warmbud', 20, { id: 'm', talents: 0 });
  return [{ ...f, genes: { ...f.genes, sex: 'male' } }, m];
}

describe('繁殖条件', () => {
  it('需要一雄一雌、同物种或属性相生、不是外来、不在冷却（v0.7 移除疲惫：受伤的也能繁殖）', () => {
    const [f, m] = pair();
    expect(breedBlocker(content, f, m, 0)).toBeNull();
    expect(breedBlocker(content, m, { ...m, id: 'm2' }, 0)).toBe('需要一雄一雌');
    // 晴与风不相生：不能共鸣繁殖（相生的见 resonance.test.ts）
    const other = makeSpirit(content, 'kitefluff', 20, { id: 'o' });
    expect(breedBlocker(content, f, other, 0)).toMatch(/属性不相生/);
    expect(breedBlocker(content, f, { ...m, condition: { hp: 0, stages: {}, timedStages: [], ailment: null } }, 0)).toBeNull();
    expect(breedBlocker(content, f, { ...m, foreign: true }, 0)).toMatch(/外来/);
    expect(breedBlocker(content, f, { ...m, breedReadyTick: 10 }, 0)).toMatch(/冷却/);
  });
});

describe('遗传', () => {
  it('蛋：1 级幼絮、母方物种、2 日后孵化；双亲冷却 1 日', () => {
    const [f, m] = pair();
    const r = breed(content, createRng(1), f, m, ctx(100));
    if (typeof r === 'string') throw new Error(r);
    expect(r.egg.state).toBe('egg');
    expect(r.egg.level).toBe(1);
    expect(r.egg.formId).toBe('warmbud');
    expect(r.egg.readyAtTick).toBe(100 + 2 * DAY);
    expect(r.father.breedReadyTick).toBe(100 + DAY);
    expect(r.mother.breedReadyTick).toBe(100 + DAY);
  });

  it('资质：恰好 3 项来自父母（父 31 / 母 0），统计上其余 2 项随机', () => {
    const [f, m] = pair();
    const rng = createRng(5);
    let inheritedCount = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const r = breed(content, rng, f, m, ctx());
      if (typeof r === 'string') throw new Error(r);
      inheritedCount += STATS.filter((s) => r.egg.genes.talents[s] === 31 || r.egg.genes.talents[s] === 0).length;
    }
    // 3 项继承 + 2 项随机时恰好落在 0 或 31 的概率 2/32
    expect(inheritedCount / N).toBeGreaterThan(3);
    expect(inheritedCount / N).toBeLessThan(3.3);
  });

  it('零件约 5% 突变，其余来自父母；体型与色相在范围内', () => {
    // 双亲都是垂耳：后代不是垂耳的比例 = 突变率
    const [f, m] = pair();
    const rng = createRng(11);
    let fromParents = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const r = breed(content, rng, f, m, ctx());
      if (typeof r === 'string') throw new Error(r);
      const ears = r.egg.genes.parts.ears.partId;
      if (ears === 'floppyEars') fromParents++;
      expect(r.egg.genes.sizePercent).toBeGreaterThanOrEqual(85);
      expect(r.egg.genes.sizePercent).toBeLessThanOrEqual(115);
      expect(Math.abs(r.egg.genes.hueShift)).toBeLessThanOrEqual(18);
    }
    expect(fromParents / N).toBeGreaterThan(0.93);
    expect(fromParents / N).toBeLessThan(0.97);
  });

  it('异化零件 25% 概率遗传异化', () => {
    const [f0, m0] = pair();
    const mutatedEars = { partId: 'floppyEars', mutated: true };
    const f = { ...f0, genes: { ...f0.genes, parts: { ...f0.genes.parts, ears: mutatedEars } } };
    const m = { ...m0, genes: { ...m0.genes, parts: { ...m0.genes.parts, ears: mutatedEars } } };
    const rng = createRng(3);
    let kept = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = breed(content, rng, f, m, ctx());
      if (typeof r === 'string') throw new Error(r);
      if (r.egg.genes.parts.ears.mutated) kept++;
    }
    // 25% × (1 - 5% 突变)
    expect(kept / N).toBeGreaterThan(0.21);
    expect(kept / N).toBeLessThan(0.26);
  });

  it('副属性：双属性亲本各自 30% 传出；与后代主属性相同则作废', () => {
    const [f0, m] = pair();
    const f = { ...f0, genes: { ...f0.genes, secondaryElement: 'wind' as const } };
    const rng = createRng(8);
    let dual = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = breed(content, rng, f, m, ctx());
      if (typeof r === 'string') throw new Error(r);
      if (r.egg.genes.secondaryElement === 'wind') dual++;
      expect(r.egg.genes.secondaryElement).not.toBe('sun');
    }
    expect(dual / N).toBeGreaterThan(0.27);
    expect(dual / N).toBeLessThan(0.33);

    const sameAsPrimary = { ...f0, genes: { ...f0.genes, secondaryElement: 'sun' as const } };
    for (let i = 0; i < 200; i++) {
      const r = breed(content, rng, sameAsPrimary, m, ctx());
      if (typeof r === 'string') throw new Error(r);
      expect(r.egg.genes.secondaryElement).toBeNull();
    }
  });

  it('同一种子同样的后代', () => {
    const [f, m] = pair();
    expect(breed(content, createRng(42), f, m, ctx())).toEqual(breed(content, createRng(42), f, m, ctx()));
  });
});
