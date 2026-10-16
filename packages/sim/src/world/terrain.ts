import { fbm, smoothstep } from './noise';

/**
 * 浮岛地形（从原型 makeIsland 迁移）：不规则的岛缘 + fbm 起伏 + 可选的平地与小山。
 * 纯函数；render 用它生成网格，sim 用它判断坡度与摆放。
 */
export interface TerrainParams {
  readonly seed: number;
  readonly radius: number;
  /** 起伏幅度（米）。 */
  readonly amplitude: number;
  /** 小山：中心、半径²、高度。 */
  readonly hills?: ReadonlyArray<{ x: number; z: number; spread: number; height: number }>;
  /** 平地：中心、半径、高度（建筑区、码头）。 */
  readonly flats?: ReadonlyArray<{ x: number; z: number; radius: number; height: number }>;
}

export interface Terrain {
  readonly params: TerrainParams;
  /** 角度 th 方向的岛缘半径。 */
  rim(theta: number): number;
  /** 地面高度；岛外返回负值。 */
  height(x: number, z: number): number;
  /** 是否在岛上（留出边缘 margin）。 */
  inside(x: number, z: number, margin?: number): boolean;
}

export function createTerrain(params: TerrainParams): Terrain {
  const off = params.seed * 13.7 + 1.3;
  const rim = (th: number): number => params.radius * (1 + (fbm(Math.cos(th) * 1.4 + off, Math.sin(th) * 1.4 - off, params.seed) - 0.5) * 0.26);
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
    const e = 1 - smoothstep(0.8, 1.02, t);
    return h * e - (1 - e) * 0.8;
  };
  return {
    params,
    rim,
    height,
    inside: (x, z, margin = 0) => Math.hypot(x, z) < rim(Math.atan2(z, x)) * 0.8 - margin,
  };
}
