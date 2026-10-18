import type { ContentDb, Island, Line } from '@cloudsea/content';
import { createRng, deriveSeed, type Rng } from '../rng';
import { generateWildGenes } from '../spirit/genes';
import { createSpirit } from '../spirit/spirit';
import type { Spirit } from '../spirit/types';
import { gatherNodes, randomSpot } from './layout';
import { clockAt } from './time';
import { weatherAt } from './weather';
import type { IslandRuntime, WildEntity, WorldState } from './state';
import { newId } from './ids';

/** 每 0.1 游戏日检查一次野生絮灵补充。 */
export const WILD_REFRESH_TICKS = 1200;

/** 某座岛此刻能刷新的进化线与权重（DESIGN 4.2 / 4.7：按天气、时段、雾浓度）。 */
export function spawnTable(content: ContentDb, island: Island, world: WorldState): Array<{ line: Line; weight: number }> {
  const weather = weatherAt(world.seed, island.region, world.tick);
  const night = clockAt(world.tick).isNight;
  const out: Array<{ line: Line; weight: number }> = [];
  for (const line of content.lines.values()) {
    let weight = 0;
    for (const s of line.spawns) {
      if (s.region !== island.region) continue;
      if (s.weathers && !s.weathers.includes(weather)) continue;
      if (s.time === 'night' && !night) continue;
      if (s.time === 'day' && night) continue;
      // 雾浓度在这里代表生态（雾里才有的絮灵），灯塔重燃后也不变；灯塔只影响能不能进岛
      if ((s.minFogLevel ?? 0) > island.fogLevel) continue;
      weight += s.weight;
    }
    if (weight > 0) out.push({ line, weight });
  }
  return out;
}

/**
 * 按野外等级选进化段：到了该线的进化等级才可能出现下一段（成灵 50%、云主形 30%）。
 * 按每条线自己的进化等级与段数（两段线没有云主形，M3-1）；三段线的随机数用法与 M1 相同。
 */
function formIndexFor(level: number, rng: Rng, line: Line): number {
  const evo = line.forms.map((f) => f.evolution?.level ?? Infinity);
  if (line.forms.length === 3 && level >= evo[1]! && rng.chance(0.3)) return 2;
  if (level >= evo[0]! && rng.chance(0.5)) return 1;
  return 0;
}

export function makeWildSpirit(content: ContentDb, rng: Rng, line: Line, island: Island, id: string, blighted: boolean): Spirit {
  const level = rng.int(island.wildLevel.min, island.wildLevel.max) + (blighted ? 2 : 0);
  return createSpirit(content, {
    id,
    ownerId: 'wild',
    genes: generateWildGenes(rng, line),
    level: Math.min(60, level),
    formIndex: formIndexFor(level, rng, line),
    blighted,
  });
}

export function ensureIslandRuntime(world: WorldState, island: Island): IslandRuntime {
  let rt = world.islands[island.id];
  if (!rt) {
    // 用有限数做“从未刷新”的标记：存档是 JSON，-Infinity 会变成 null
    rt = { id: island.id, wild: {}, nodes: {}, lastRefreshTick: -1_000_000_000 };
    for (const n of gatherNodes(island)) rt.nodes[n.id] = 0;
    world.islands[island.id] = rt;
  }
  return rt;
}

/**
 * 补充 / 更替野生絮灵：去掉已不符合当前刷新条件的，补到上限。
 * 活跃岛每 WILD_REFRESH_TICKS 调一次；冻结岛在玩家再次进入时调一次（一次性结算）。
 */
export function refreshWild(content: ContentDb, world: WorldState, island: Island): void {
  const rt = ensureIslandRuntime(world, island);
  const table = spawnTable(content, island, world);
  const allowed = new Set(table.map((t) => t.line.id));
  const engaged = new Set(Object.values(world.battles).map((b) => b.wildId));
  for (const [id, w] of Object.entries(rt.wild)) {
    if (engaged.has(id)) continue;
    const stale = !allowed.has(w.group[0]!.genes.lineId) || world.tick - w.spawnedAt > 6000;
    if (stale) delete rt.wild[id];
  }
  if (table.length === 0) return;
  const rng = createRng(deriveSeed(world.seed, `wild:${island.id}:${world.tick}`));
  while (Object.keys(rt.wild).length < island.wildCount) {
    const blighted = rng.chance(island.blightChance);
    const groupSize = blighted ? 1 : island.wildLevel.max >= 8 && rng.chance(0.35) ? 2 : 1;
    const id = newId(world, 'w');
    const group = Array.from({ length: groupSize }, (_, i) => {
      const line = table[rng.weightedIndex(table.map((t) => t.weight))]!.line;
      return makeWildSpirit(content, rng, line, island, `${id}-${i}`, blighted);
    });
    const spot = randomSpot(island, deriveSeed(world.seed, `spot:${id}`));
    const entity: WildEntity = { id, group, x: spot.x, z: spot.z, blighted, spawnedAt: world.tick };
    rt.wild[id] = entity;
  }
  rt.lastRefreshTick = world.tick;
}
