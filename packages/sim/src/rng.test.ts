import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from './rng';

describe('createRng', () => {
  it('同一种子产生同一序列', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('算法固定：种子 1 的前 5 个值不得改变（改了会破坏旧存档回放）', () => {
    const r = createRng(1);
    const seq = Array.from({ length: 5 }, () => r.next());
    expect(seq).toEqual(GOLDEN_SEED_1);
  });

  it('可从 state 恢复，之后的序列一致', () => {
    const a = createRng(7);
    for (let i = 0; i < 13; i++) a.next();
    const b = createRng(a.state);
    for (let i = 0; i < 50; i++) expect(b.next()).toBe(a.next());
  });

  it('next 落在 [0, 1)', () => {
    const r = createRng(123);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int 覆盖闭区间两端且不越界', () => {
    const r = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = r.int(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it('int 拒绝非法区间', () => {
    const r = createRng(1);
    expect(() => r.int(3, 2)).toThrow(RangeError);
    expect(() => r.int(0.5, 2)).toThrow(RangeError);
  });

  it('chance 的频率接近 p', () => {
    const r = createRng(2024);
    let hits = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (r.chance(0.25)) hits++;
    expect(hits / n).toBeGreaterThan(0.23);
    expect(hits / n).toBeLessThan(0.27);
  });

  it('weightedIndex 按权重分布，零权重永不选中', () => {
    const r = createRng(5);
    const counts = [0, 0, 0];
    const n = 30_000;
    for (let i = 0; i < n; i++) counts[r.weightedIndex([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[0]! / n).toBeGreaterThan(0.23);
    expect(counts[0]! / n).toBeLessThan(0.27);
  });

  it('weightedIndex 拒绝非法权重', () => {
    const r = createRng(5);
    expect(() => r.weightedIndex([0, 0])).toThrow(RangeError);
    expect(() => r.weightedIndex([1, -1])).toThrow(RangeError);
    expect(() => r.weightedIndex([])).toThrow(RangeError);
  });

  it('pick 拒绝空数组；shuffle 不改原数组且元素不变', () => {
    const r = createRng(11);
    expect(() => r.pick([])).toThrow(RangeError);
    const src = [1, 2, 3, 4, 5, 6];
    const out = r.shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(src);
  });
});

describe('deriveSeed', () => {
  it('确定且对标签敏感', () => {
    expect(deriveSeed(100, 'island:3')).toBe(deriveSeed(100, 'island:3'));
    expect(deriveSeed(100, 'island:3')).not.toBe(deriveSeed(100, 'island:4'));
    expect(deriveSeed(100, 'island:3')).not.toBe(deriveSeed(101, 'island:3'));
  });

  it('返回 uint32', () => {
    for (const label of ['a', 'battle', '絮灵']) {
      const v = deriveSeed(0xdeadbeef, label);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

// mulberry32(1) 的公开参考序列
const GOLDEN_SEED_1 = [
  0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
  0.9683778982143849,
];
