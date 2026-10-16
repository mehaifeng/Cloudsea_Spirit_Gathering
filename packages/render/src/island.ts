import { fbm, hash2, type Terrain } from '@cloudsea/sim';
import * as THREE from 'three';
import { mulberry } from './util';

export interface IslandMeshOptions {
  /** 径向环数与每环分段（细节）。 */
  readonly rings?: number;
  readonly segments?: number;
  /** 岛底岩层深度（米）与层数。 */
  readonly depth?: number;
  readonly layers?: number;
  /** 草地色相（0..1），不同岛略有区别。 */
  readonly grassHue?: number;
  /** 草和花的数量。 */
  readonly grass?: number;
  readonly flowers?: number;
  /** 不长草的区域（建筑、码头）。 */
  readonly clear?: (x: number, z: number) => boolean;
}

/**
 * 浮岛网格（从原型 makeIsland 迁移）：同心环三角化的顶面 + 逐层收窄的岩层 + 底部尖锥。
 * 高度来自 sim 的 Terrain，所以玩法上的地面和画面上的地面一致。
 */
export function buildIslandMesh(terrain: Terrain, o: IslandMeshOptions = {}): THREE.Group {
  const R = terrain.params.radius;
  const seed = terrain.params.seed;
  const N = o.rings ?? Math.max(10, Math.round(R * 1.2));
  const SEG = o.segments ?? Math.max(36, Math.round(R * 3));
  const depth = o.depth ?? R * 0.8;
  const K = o.layers ?? 8;
  const off = seed * 13.7 + 1.3;
  const hue = o.grassHue ?? 0.24;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const tri = (a: number[], b: number[], d: number[], cl: THREE.Color) => {
    pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, d[0]!, d[1]!, d[2]!);
    for (let k = 0; k < 3; k++) col.push(cl.r, cl.g, cl.b);
  };
  const rings: number[][][] = [];
  for (let i = 0; i <= N; i++) {
    const row: number[][] = [];
    for (let j = 0; j < SEG; j++) {
      let th = (j / SEG) * Math.PI * 2;
      if (i > 0 && i < N) th += (hash2(i * 31, j * 17, seed) - 0.5) * 0.55 * ((Math.PI * 2) / SEG);
      let rr = i === 0 ? 0 : terrain.rim(th) * (i / N);
      if (i > 0 && i < N) rr *= 1 + (hash2(j * 23, i, seed + 1) - 0.5) * 0.06;
      const x = Math.cos(th) * rr;
      const z = Math.sin(th) * rr;
      row.push([x, terrain.height(x, z), z]);
    }
    rings.push(row);
  }
  const topColor = (a: number[], b: number[], d: number[]): THREE.Color => {
    const x = (a[0]! + b[0]! + d[0]!) / 3;
    const y = (a[1]! + b[1]! + d[1]!) / 3;
    const z = (a[2]! + b[2]! + d[2]!) / 3;
    const n = fbm(x * 0.35 + 9, z * 0.35 - 4, seed);
    const rr = Math.hypot(x, z) / terrain.rim(Math.atan2(z, x));
    if (rr > 0.86) return c.setHSL(0.09, 0.32, 0.5 + (n - 0.5) * 0.08); // 岛缘露出泥土
    return c.setHSL(hue + (n - 0.5) * 0.07, 0.34 + (n - 0.5) * 0.1, 0.45 + (n - 0.5) * 0.1 + y * 0.012);
  };
  for (let i = 1; i <= N; i++) {
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      const a = rings[i - 1]![j]!;
      const b = rings[i - 1]![j2]!;
      const cc = rings[i]![j]!;
      const d = rings[i]![j2]!;
      tri(a, d, cc, topColor(a, d, cc));
      if (i > 1) tri(a, b, d, topColor(a, b, d));
    }
  }
  const rock = (k: number, j: number): THREE.Color => {
    const r = hash2(Math.floor(k * 7.7 + off), Math.floor(j * 3.3), seed);
    if (k === 1) return c.setHSL(0.08, 0.34, 0.36 + r * 0.05);
    return c.setHSL(0.06 + r * 0.025, 0.13 + r * 0.06, 0.5 - (k / K) * 0.2 + (k % 2 ? 0.04 : -0.02) + r * 0.04);
  };
  let prev = rings[N]!;
  for (let k = 1; k <= K; k++) {
    const f = k / K;
    const row: number[][] = [];
    for (let j = 0; j < SEG; j++) {
      const p = rings[N]![j]!;
      const th = Math.atan2(p[2]!, p[0]!);
      const rr = terrain.rim(th) * (1 - Math.pow(f, 0.85) * 0.93) * (1 + (hash2(j * 19, k * 27, seed + 2) - 0.5) * 0.2);
      const y = p[1]! - 0.35 - f * depth * (0.8 + 0.4 * hash2(k * 51, j, seed + 3));
      row.push([Math.cos(th) * rr, y, Math.sin(th) * rr]);
    }
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      tri(prev[j]!, row[j]!, row[j2]!, rock(k, j));
      tri(prev[j]!, row[j2]!, prev[j2]!, rock(k, j + 0.5));
    }
    prev = row;
  }
  let minY = 0;
  for (const p of prev) minY = Math.min(minY, p[1]!);
  const tip = [(hash2(1, 1, seed) - 0.5) * R * 0.15, minY - depth * 0.3, (hash2(2, 2, seed) - 0.5) * R * 0.15];
  for (let j = 0; j < SEG; j++) tri(prev[j]!, tip, prev[(j + 1) % SEG]!, rock(K, j * 1.3));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);

  // 草与花（实例化）
  const rnd = mulberry(seed * 7 + 3);
  const gc = o.grass ?? Math.round(R * R * 1.2);
  const fc = o.flowers ?? Math.round(R * R * 0.35);
  if (gc > 0) {
    const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.3, 3).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), gc);
    const flow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.065, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 }), Math.max(1, fc));
    const dm = new THREE.Object3D();
    const FC = [0xf6d365, 0xf7a6b6, 0xffffff, 0xbaa7f3, 0xf59e7b];
    let gi = 0;
    let fi = 0;
    for (let tries = 0; (gi < gc || fi < fc) && tries < gc * 10; tries++) {
      const th = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * R;
      const x = Math.cos(th) * rr;
      const z = Math.sin(th) * rr;
      if (rr > terrain.rim(th) * 0.84 || o.clear?.(x, z)) continue;
      const y = terrain.height(x, z);
      if (gi < gc) {
        dm.position.set(x, y - 0.02, z);
        dm.rotation.set((rnd() - 0.5) * 0.5, rnd() * 6, (rnd() - 0.5) * 0.5);
        dm.scale.setScalar(0.7 + rnd() * 0.8);
        dm.updateMatrix();
        grass.setMatrixAt(gi, dm.matrix);
        grass.setColorAt(gi, c.setHSL(hue - 0.01 + rnd() * 0.06, 0.36, 0.36 + rnd() * 0.12));
        gi++;
      }
      if (fi < fc && rnd() < 0.35) {
        dm.position.set(x + 0.08, y + 0.2, z);
        dm.rotation.set(0, 0, 0);
        dm.scale.setScalar(0.8 + rnd() * 0.6);
        dm.updateMatrix();
        flow.setMatrixAt(fi, dm.matrix);
        flow.setColorAt(fi, c.set(FC[Math.floor(rnd() * FC.length)]!));
        fi++;
      }
    }
    grass.count = gi;
    flow.count = fi;
    grass.receiveShadow = true;
    group.add(grass, flow);
  }
  return group;
}
