/**
 * 种子 RNG（铁律 2：sim 内禁止 Math.random）。
 *
 * 算法为 mulberry32：状态只有一个 uint32，便于写进存档、在房主和客人之间同步。
 * 算法一旦上线就不能改，否则旧存档的回放会变；rng.test.ts 中的固定序列用来防止误改。
 */
export interface Rng {
  /** 当前内部状态（uint32），可存档；用 createRng(state) 恢复。 */
  readonly state: number;
  /** [0, 1) 均匀浮点数。 */
  next(): number;
  /** [min, max] 闭区间均匀整数。 */
  int(min: number, max: number): number;
  /** 以概率 p 返回 true。 */
  chance(p: number): boolean;
  /** 从非空数组中等概率取一个元素。 */
  pick<T>(items: readonly T[]): T;
  /** 按权重取下标；权重须非负且总和大于 0。 */
  weightedIndex(weights: readonly number[]): number;
  /** 返回打乱后的新数组（Fisher–Yates），不修改原数组。 */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const nextUint32 = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const next = (): number => nextUint32() / 4294967296;

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`rng.int: invalid range [${min}, ${max}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    get state() {
      return s;
    },
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new RangeError('rng.pick: empty array');
      return items[int(0, items.length - 1)] as (typeof items)[number];
    },
    weightedIndex: (weights) => {
      let total = 0;
      for (const w of weights) {
        if (!(w >= 0)) throw new RangeError('rng.weightedIndex: negative or NaN weight');
        total += w;
      }
      if (total <= 0) throw new RangeError('rng.weightedIndex: total weight must be > 0');
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] as number;
        if (r < 0) return i;
      }
      // 浮点误差兜底：返回最后一个正权重
      for (let i = weights.length - 1; i >= 0; i--) if ((weights[i] as number) > 0) return i;
      return weights.length - 1;
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
}

/**
 * 由基础种子和一个标签派生独立的子种子（例如每座岛、每场战斗各用一条随机流），
 * 避免不同系统共用一条流导致“改一处、全局随机结果都变”。
 * 标签哈希用 FNV-1a，再经 mulberry32 的输出函数打散。
 */
export function deriveSeed(seed: number, label: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return createRng(h >>> 0).int(0, 0xffffffff) >>> 0;
}
