import type { GatherKind, Island } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import { createTerrain, type Terrain } from './terrain';

/** 家园岛：初始半径约 15 米，岛核 10 级约 45 米（DESIGN 3.2）。 */
export function homeRadius(coreLevel: number): number {
  return 15 + (coreLevel - 1) * (30 / 9);
}

/** 家园岛码头位置（岛核 1 级时的岛缘内侧，之后岛向外长，码头不动）。 */
export const HOME_DOCK = { x: 0, z: 10.5 } as const;

export function homeTerrain(seed: number, coreLevel: number): Terrain {
  return createTerrain({
    seed,
    radius: homeRadius(coreLevel),
    amplitude: 0.6,
    flats: [
      { x: 0, z: 0, radius: 6, height: 0.2 },
      { x: HOME_DOCK.x, z: HOME_DOCK.z, radius: 3.5, height: 0.15 },
    ],
  });
}

export function islandTerrain(island: Island): Terrain {
  const arrival = arrivalPoint(island);
  return createTerrain({
    seed: island.seed,
    radius: island.radius,
    amplitude: island.kind === 'keeper' ? 0.6 : 1.1,
    hills: [{ x: island.radius * 0.25, z: -island.radius * 0.25, spread: island.radius * 6, height: 1.8 }],
    flats: [
      { x: arrival.x, z: arrival.z, radius: 4, height: 0.2 },
      ...(island.kind === 'keeper' ? [{ x: 0, z: 0, radius: island.radius * 0.45, height: 0.2 }] : []),
    ],
  });
}

/** 登岛点：岛的南侧边缘内。 */
export function arrivalPoint(island: Pick<Island, 'radius'>): { x: number; z: number } {
  return { x: 0, z: island.radius * 0.62 };
}

export interface GatherNode {
  readonly id: string;
  readonly kind: GatherKind;
  readonly x: number;
  readonly z: number;
}

/** 采集点位置：由岛的种子决定，所有端一致。 */
export function gatherNodes(island: Island): GatherNode[] {
  const rng = createRng(deriveSeed(island.seed, 'gather'));
  const terrain = islandTerrain(island);
  const arrival = arrivalPoint(island);
  const placed: Array<{ x: number; z: number }> = [];
  const out: GatherNode[] = [];
  for (const g of island.gather) {
    let n = 0;
    for (let tries = 0; n < g.count && tries < 400; tries++) {
      const th = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * island.radius * 0.75;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      if (!terrain.inside(x, z, 1.5)) continue;
      if (Math.hypot(x - arrival.x, z - arrival.z) < 5) continue;
      if (island.kind === 'keeper' && Math.hypot(x, z) < island.radius * 0.45) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 2.6)) continue;
      placed.push({ x, z });
      out.push({ id: `${island.id}:${g.kind}:${n}`, kind: g.kind, x, z });
      n++;
    }
  }
  return out;
}

/** 在岛上随机挑一个能站的位置（野生絮灵出生点）。 */
export function randomSpot(island: Island, seed: number): { x: number; z: number } {
  const rng = createRng(seed);
  const terrain = islandTerrain(island);
  const arrival = arrivalPoint(island);
  for (let i = 0; i < 100; i++) {
    const th = rng.next() * Math.PI * 2;
    const r = (0.2 + 0.8 * Math.sqrt(rng.next())) * island.radius * 0.7;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    if (terrain.inside(x, z, 2) && Math.hypot(x - arrival.x, z - arrival.z) > 7) return { x, z };
  }
  return { x: 0, z: 0 };
}
