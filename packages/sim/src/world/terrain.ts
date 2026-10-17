import { fbm, smoothstep } from './noise';

/**
 * 浮岛地形（从原型 makeIsland 迁移，v0.5 加入水面）：不规则的岛缘 + fbm 起伏 + 小山 / 平地 + 池塘 / 溪流。
 * 纯函数；render 用它生成网格，sim 用它判断坡度、水面与摆放。
 */
export interface Pond {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly depth: number;
}

export interface Stream {
  /** 折线经过的点。 */
  readonly points: ReadonlyArray<{ x: number; z: number }>;
  readonly width: number;
  readonly depth: number;
}

export interface TerrainParams {
  readonly seed: number;
  readonly radius: number;
  /** 起伏幅度（米）。 */
  readonly amplitude: number;
  /** 小山：中心、扩散（半径²）、高度。 */
  readonly hills?: ReadonlyArray<{ x: number; z: number; spread: number; height: number }>;
  /** 平地：中心、半径、高度（建筑区、码头）。 */
  readonly flats?: ReadonlyArray<{ x: number; z: number; radius: number; height: number }>;
  readonly ponds?: readonly Pond[];
  readonly streams?: readonly Stream[];
}

/** 水面高度：池塘与溪流里低于它的地方是水。 */
export const WATER_LEVEL = -0.15;

export interface Terrain {
  readonly params: TerrainParams;
  /** 角度 th 方向的岛缘半径。 */
  rim(theta: number): number;
  /** 地面高度；岛外返回负值。 */
  height(x: number, z: number): number;
  /** 是否在岛上（留出边缘 margin）。 */
  inside(x: number, z: number, margin?: number): boolean;
  /** 这里是不是水（池塘或溪流里、地面低于水面）。 */
  isWater(x: number, z: number): boolean;
  /** 到最近水面的水平距离（米）；没有水返回 Infinity。用于岸边上色。 */
  waterDistance(x: number, z: number): number;
}

function segmentDistance(px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / len2));
  return Math.hypot(px - a.x - vx * t, pz - a.z - vz * t);
}

export function createTerrain(params: TerrainParams): Terrain {
  const off = params.seed * 13.7 + 1.3;
  const rim = (th: number): number => params.radius * (1 + (fbm(Math.cos(th) * 1.4 + off, Math.sin(th) * 1.4 - off, params.seed) - 0.5) * 0.26);
  const ponds = params.ponds ?? [];
  const streams = params.streams ?? [];

  /** 到水体中心线 / 池心的“相对距离”：0 = 中心，1 = 水边。 */
  const waterShape = (x: number, z: number): { k: number; depth: number; edge: number } => {
    let best = { k: Infinity, depth: 0, edge: Infinity };
    for (const p of ponds) {
      const d = Math.hypot(x - p.x, z - p.z);
      const k = d / p.radius;
      if (k < best.k) best = { k, depth: p.depth, edge: d - p.radius };
    }
    for (const s of streams) {
      for (let i = 0; i < s.points.length - 1; i++) {
        const d = segmentDistance(x, z, s.points[i]!, s.points[i + 1]!);
        const k = d / (s.width / 2);
        if (k < best.k) best = { k, depth: s.depth, edge: d - s.width / 2 };
      }
    }
    return best;
  };

  const height = (x: number, z: number): number => {
    const th = Math.atan2(z, x);
    const t = Math.hypot(x, z) / rim(th);
    let h = (fbm(x * 0.11 + off, z * 0.11 - off, params.seed + 7) - 0.45) * 1.7 * params.amplitude;
    for (const hl of params.hills ?? []) h += Math.exp(-((x - hl.x) ** 2 + (z - hl.z) ** 2) / hl.spread) * hl.height;
    for (const f of params.flats ?? []) {
      const d = Math.hypot(x - f.x, z - f.z);
      const k = smoothstep(f.radius * 0.55, f.radius, d);
      h = f.height + (h - f.height) * k;
    }
    // 水体：岸边 1.3 倍半径内逐渐下凹到水底
    const w = waterShape(x, z);
    if (w.k < 1.6) {
      const bed = WATER_LEVEL - w.depth;
      const k = smoothstep(0.55, 1.6, w.k);
      h = bed + (Math.max(h, WATER_LEVEL + 0.25) - bed) * k;
    }
    const e = 1 - smoothstep(0.8, 1.02, t);
    return h * e - (1 - e) * 0.8;
  };

  return {
    params,
    rim,
    height,
    inside: (x, z, margin = 0) => Math.hypot(x, z) < rim(Math.atan2(z, x)) * 0.8 - margin,
    isWater: (x, z) => (ponds.length > 0 || streams.length > 0) && waterShape(x, z).k < 1.05 && height(x, z) < WATER_LEVEL,
    waterDistance: (x, z) => (ponds.length > 0 || streams.length > 0 ? Math.max(0, waterShape(x, z).edge) : Infinity),
  };
}
