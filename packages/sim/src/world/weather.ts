import { ELEMENTS, type Element, type Region } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import { TICKS_PER_DAY } from './time';

/** 大区主天气 = 大区属性（DESIGN 3.5）。 */
export const REGION_MAIN_WEATHER: Readonly<Record<Region, Element>> = {
  sunPlains: 'sun',
  windValley: 'wind',
  rainMarsh: 'rain',
  thunderCliff: 'thunder',
  mistSea: 'mist',
};

interface Segment {
  readonly start: number;
  readonly end: number;
  readonly weather: Element;
}

/**
 * 天气段：每段 0.5–1.5 游戏日；主天气 50%，其余四种各 12.5%。
 * 第 k 段只由（世界种子, 大区, k）决定，因此任何时刻都可重算、可预报。
 */
function segment(seed: number, region: Region, k: number): { length: number; weather: Element } {
  const rng = createRng(deriveSeed(seed, `weather:${region}:${k}`));
  const length = Math.round(TICKS_PER_DAY * (0.5 + rng.next()));
  const main = REGION_MAIN_WEATHER[region];
  const weather = rng.chance(0.5) ? main : rng.pick(ELEMENTS.filter((e) => e !== main));
  return { length, weather };
}

/** 前若干段的缓存（纯函数结果的记忆化，不影响确定性）。 */
const cache = new Map<string, Segment[]>();

function segmentsUntil(seed: number, region: Region, tick: number): Segment[] {
  const key = `${seed}:${region}`;
  let list = cache.get(key);
  if (!list) {
    list = [];
    cache.set(key, list);
  }
  while (list.length === 0 || list[list.length - 1]!.end <= tick) {
    const k = list.length;
    const start = k === 0 ? 0 : list[k - 1]!.end;
    const { length, weather } = segment(seed, region, k);
    list.push({ start, end: start + length, weather });
  }
  return list;
}

export function weatherAt(seed: number, region: Region, tick: number): Element {
  const list = segmentsUntil(seed, region, Math.max(0, tick));
  // 二分查找
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.end <= tick) lo = mid + 1;
    else hi = mid;
  }
  return list[lo]!.weather;
}

/** 天气预报：从 tick 起未来 horizon tick 内的天气变化（星图上显示未来 1 日）。 */
export function forecast(seed: number, region: Region, tick: number, horizon = TICKS_PER_DAY): Array<{ from: number; weather: Element }> {
  const list = segmentsUntil(seed, region, tick + horizon);
  return list.filter((s) => s.end > tick && s.start < tick + horizon).map((s) => ({ from: Math.max(s.start, tick), weather: s.weather }));
}
