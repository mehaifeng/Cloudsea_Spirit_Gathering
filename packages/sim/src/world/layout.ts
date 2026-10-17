import type { GatherKind, Island } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import { createTerrain, type Terrain, type TerrainParams } from './terrain';

/** 家园岛：初始半径约 24 米，岛核 10 级约 60 米（DESIGN 3.2，v0.5）。 */
export function homeRadius(coreLevel: number): number {
  return 24 + (coreLevel - 1) * 4;
}

/** 家园岛码头位置（岛核 1 级时的岛缘内侧，之后岛向外长，码头不动）。 */
export const HOME_DOCK = { x: 0, z: 16 } as const;

export function homeTerrain(seed: number, coreLevel: number): Terrain {
  // 家园岛（v0.5）：中心留出平地建造；一侧有池塘，另一侧有小山。位置由岛的种子决定、不随岛核等级变
  const rng = createRng(deriveSeed(seed, 'home-features'));
  const a = rng.next() * Math.PI * 2;
  const pondR = 12 + rng.next() * 2;
  return createTerrain({
    seed,
    radius: homeRadius(coreLevel),
    amplitude: 0.6,
    hills: [{ x: Math.cos(a + Math.PI) * 14, z: Math.sin(a + Math.PI) * 14, spread: 40, height: 2.2 }],
    flats: [
      { x: 0, z: 0, radius: 9, height: 0.2 },
      { x: HOME_DOCK.x, z: HOME_DOCK.z, radius: 4.5, height: 0.15 },
    ],
    ponds: [{ x: Math.cos(a) * pondR, z: Math.sin(a) * pondR * 0.6 - 3, radius: 2.8, depth: 0.7 }],
  });
}

/** 按主题生成地形要素（DESIGN 3.4，v0.5）：由岛的种子决定，所有端一致。 */
function themeFeatures(island: Island): Pick<TerrainParams, 'hills' | 'ponds' | 'streams'> {
  const R = island.radius;
  const rng = createRng(deriveSeed(island.seed, 'theme'));
  const at = (r: number, a: number) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  switch (island.theme) {
    case 'meadow': {
      const a = rng.next() * Math.PI * 2;
      return {
        hills: [
          { ...at(R * 0.35, a), spread: R * 6, height: 2.4 },
          { ...at(R * 0.4, a + 2.2), spread: R * 4, height: 1.6 },
        ],
        ponds: [{ ...at(R * 0.38, a + 4.1), radius: 3.2, depth: 0.8 }],
      };
    }
    case 'brook': {
      // 一条溪流斜穿全岛，两侧有岩壁（陡的小山）
      const a = rng.next() * Math.PI;
      const pts = [-0.85, -0.45, 0, 0.45, 0.85].map((t, i) => {
        const p = at(R * t, a);
        const wiggle = (i % 2 ? 1 : -1) * R * 0.08;
        return { x: p.x - Math.sin(a) * wiggle, z: p.z + Math.cos(a) * wiggle };
      });
      return {
        streams: [{ points: pts, width: 2.6, depth: 0.6 }],
        hills: [
          { ...at(R * 0.4, a + Math.PI / 2), spread: R * 1.6, height: 3.6 },
          { ...at(R * 0.45, a - Math.PI / 2 + 0.4), spread: R * 1.2, height: 3 },
        ],
      };
    }
    case 'valley': {
      // 一圈山围着低洼的谷地，谷底有一汪雾泉
      const hills = Array.from({ length: 5 }, (_, i) => ({ ...at(R * 0.6, (i / 5) * Math.PI * 2 + rng.next() * 0.5), spread: R * 3, height: 3.8 + rng.next() * 1.5 }));
      return { hills, ponds: [{ x: 0, z: -R * 0.1, radius: 3.6, depth: 0.9 }] };
    }
    case 'farm':
      return { ponds: [{ ...at(R * 0.55, -0.9), radius: 2.4, depth: 0.6 }] };
    case 'terrace':
      return {
        hills: [
          { ...at(R * 0.45, 2.5), spread: R * 3, height: 2.5 },
          { ...at(R * 0.5, 3.6), spread: R * 2, height: 1.8 },
        ],
      };
  }
}

export function islandTerrain(island: Island): Terrain {
  const arrival = arrivalPoint(island);
  return createTerrain({
    seed: island.seed,
    radius: island.radius,
    amplitude: island.kind === 'keeper' ? 0.6 : 1.1,
    ...themeFeatures(island),
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
      if (terrain.isWater(x, z) || terrain.waterDistance(x, z) < 1) continue;
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
    if (terrain.inside(x, z, 2) && !terrain.isWater(x, z) && Math.hypot(x - arrival.x, z - arrival.z) > 7) return { x, z };
  }
  return { x: 0, z: 0 };
}

/**
 * 世界布局（v0.5）：星图坐标 → 3D 世界坐标，1 个星图单位 = 1000 米，家园岛在原点。
 * 站在任何岛上看到的远处浮岛，就是星图上的这些岛（DESIGN 3.6）。
 */
export const CHART_SCALE = 1000;

export function worldPosition(island: Pick<Island, 'chartPos' | 'altitude'> | null, home: { readonly x: number; readonly y: number }): { x: number; y: number; z: number } {
  if (!island) return { x: 0, y: 0, z: 0 };
  return { x: (island.chartPos.x - home.x) * CHART_SCALE, y: island.altitude, z: (island.chartPos.y - home.y) * CHART_SCALE };
}
