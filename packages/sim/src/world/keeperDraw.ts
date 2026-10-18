import { REGIONS, type ContentDb, type Island } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import { createKeeper } from './create';
import type { WorldState } from './state';

/** 每个世界住进来的守岛人数量（DESIGN v0.9 第 3 条，M3-3）。 */
export const KEEPERS_PER_WORLD = { min: 6, max: 10 } as const;

/**
 * 按世界种子给守岛人岛分配住户（M3-3）：
 * - 数据里指定了守岛人的岛是固定住户（晴原的阿禾、岚）；
 * - 没指定的是空位，从本区人设池（本区、没有固定岛的人）里抽；
 * - 没有固定住户的大区至少住一位；总人数 6–10；没抽到的空位在这个世界里不存在。
 * 只依赖种子和内容，同一种子结果相同。
 */
export function drawKeepers(content: ContentDb, seed: number): Record<string, string> {
  const rng = createRng(deriveSeed(seed, 'keeperDraw'));
  const islands = [...content.islands.values()].filter((i) => i.kind === 'keeper');
  const out: Record<string, string> = {};
  const fixedKeepers = new Set<string>();
  for (const i of islands) {
    if (i.keeper) {
      out[i.id] = i.keeper;
      fixedKeepers.add(i.keeper);
    }
  }
  const pool = new Map(REGIONS.map((r) => [r, rng.shuffle([...content.keepers.values()].filter((k) => k.region === r && !fixedKeepers.has(k.id)).map((k) => k.id))]));
  const slots = REGIONS.map((r) => ({ region: r, slots: rng.shuffle(islands.filter((i) => i.region === r && !i.keeper).map((i) => i.id)) }));
  const fill = (region: (typeof REGIONS)[number], islandId: string): boolean => {
    const k = pool.get(region)!.shift();
    if (!k) return false;
    out[islandId] = k;
    return true;
  };
  const target = rng.int(KEEPERS_PER_WORLD.min, KEEPERS_PER_WORLD.max);
  // 先保证每个没有固定住户的大区有一位
  const rest: Array<{ region: (typeof REGIONS)[number]; island: string }> = [];
  for (const { region, slots: ids } of slots) {
    const hasFixed = islands.some((i) => i.region === region && i.keeper);
    ids.forEach((id, n) => {
      if (n === 0 && !hasFixed) fill(region, id);
      else rest.push({ region, island: id });
    });
  }
  for (const s of rng.shuffle(rest)) {
    if (Object.keys(out).length >= target) break;
    fill(s.region, s.island);
  }
  return out;
}

/**
 * 补齐世界里的守岛人（新世界、旧存档读档后由房主调用；幂等）：
 * 还没分配过就按种子分配；给分配到的人建状态，已有的状态（好感、剧情进度）原样保留。
 */
export function reconcileKeepers(content: ContentDb, world: WorldState): void {
  if (Object.keys(world.keeperIslands).length === 0) {
    world.keeperIslands = drawKeepers(content, world.seed);
  }
  for (const id of Object.values(world.keeperIslands)) {
    if (!world.keepers[id] && content.keepers.has(id)) world.keepers[id] = createKeeper(content, id, world.seed);
  }
}

/** 这座岛在这个世界里的守岛人（没有 = null）。 */
export function islandKeeper(world: Readonly<WorldState>, island: Pick<Island, 'id'>): string | null {
  return world.keeperIslands[island.id] ?? null;
}

/** 这座岛在这个世界里存在吗：守岛人岛的空位没抽到人就不存在（M3-3）。 */
export function islandPresent(world: Readonly<WorldState>, island: Pick<Island, 'id' | 'kind'>): boolean {
  return island.kind !== 'keeper' || !!world.keeperIslands[island.id];
}
