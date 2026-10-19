import { fbm, hash2, WATER_LEVEL, type Terrain } from '@cloudsea/sim';
import { bedColor, waterMaterial } from './water';
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
  // 水面（v0.10）：凡是有顶点在水里的地形三角形，都在水面高度盖一片同样的三角形。
  // 水面和地形用同一套网格，岸线 = 地形穿出水面的那条线，岸边不会露出水面下的坑
  const water: number[] = [];
  const wetTri = (a: number[], b: number[], d: number[]) => {
    if (!terrain.isWater(a[0]!, a[2]!) && !terrain.isWater(b[0]!, b[2]!) && !terrain.isWater(d[0]!, d[2]!)) return;
    for (const p of [a, b, d]) water.push(p[0]!, WATER_LEVEL, p[2]!);
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
  const ab = new THREE.Vector3();
  const ad = new THREE.Vector3();
  const topColor = (a: number[], b: number[], d: number[]): THREE.Color => {
    const x = (a[0]! + b[0]! + d[0]!) / 3;
    const y = (a[1]! + b[1]! + d[1]!) / 3;
    const z = (a[2]! + b[2]! + d[2]!) / 3;
    const n = fbm(x * 0.35 + 9, z * 0.35 - 4, seed);
    const rr = Math.hypot(x, z) / terrain.rim(Math.atan2(z, x));
    if (rr > 0.86) return c.setHSL(0.09, 0.32, 0.5 + (n - 0.5) * 0.08); // 岛缘露出泥土
    // 水底（v0.11：岸上不再有一圈沙地，草一直长到水边）
    // 跨在岸线上的三角形露出水面的部分很显眼：只有整个在水下的才用池底色
    if (Math.max(a[1]!, b[1]!, d[1]!) < WATER_LEVEL + 0.02) return bedColor(c, WATER_LEVEL - y, n);
    // 陡坡露出岩石
    ab.set(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
    ad.set(d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!);
    const ny = Math.abs(ab.cross(ad).normalize().y);
    // 岸边那一小段陡坡也是草（否则水边会有一圈灰色的“岩石”）
    if (ny < 0.58 && terrain.waterDistance(x, z) > 1.5) return c.setHSL(0.07 + (n - 0.5) * 0.02, 0.14, 0.5 + (n - 0.5) * 0.1);
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
      wetTri(a, d, cc);
      if (i > 1) {
        tri(a, b, d, topColor(a, b, d));
        wetTri(a, b, d);
      }
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
      if (rr > terrain.rim(th) * 0.84 || o.clear?.(x, z) || terrain.waterDistance(x, z) < 0.8) continue;
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
  if (water.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
    wg.computeVertexNormals();
    const wm = new THREE.Mesh(wg, waterMaterial);
    wm.receiveShadow = true;
    wm.renderOrder = 2;
    group.add(wm);
    group.add(buildShore(terrain, (o.grass ?? 1) > 0));
  }
  return group;
}


/**
 * 岸（v0.10，v0.11 去掉岸边泡沫与成圈的石头）：水边零散的几簇石头和芦苇，不围成一圈。
 * 只是表现，不挡路（不能下水由探索层的碰撞负责）；decor = false（远景岛）时什么都不放。
 */
function buildShore(terrain: Terrain, decor: boolean): THREE.Object3D {
  const { ponds = [], streams = [], seed } = terrain.params;
  const g = new THREE.Group();
  if (!decor) return g;
  const rnd = mulberry(seed * 31 + 5);
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x6f9a4a, flatShading: true, roughness: 1 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8a6440, flatShading: true, roughness: 1 });
  const c = new THREE.Color();
  const rockAt = (x: number, z: number, size: number) => {
    const geo = new THREE.DodecahedronGeometry(size, 0);
    const col: number[] = [];
    for (let k = 0; k < geo.attributes['position']!.count; k++) {
      c.setHSL(0.08 + rnd() * 0.03, 0.08 + rnd() * 0.06, 0.55 + rnd() * 0.12);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, stone);
    m.scale.set(1, 0.55 + rnd() * 0.3, 0.8 + rnd() * 0.4);
    m.rotation.y = rnd() * 6;
    m.position.set(x, terrain.height(x, z) + size * 0.2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const reedsAt = (x: number, z: number) => {
    const y = terrain.height(x, z);
    for (let k = 0; k < 5; k++) {
      const h = 0.6 + rnd() * 0.5;
      const r = new THREE.Mesh(new THREE.ConeGeometry(0.025, h, 3).translate(0, h / 2, 0), reedMat);
      r.position.set(x + (rnd() - 0.5) * 0.35, y - 0.05, z + (rnd() - 0.5) * 0.35);
      r.rotation.set((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
      if (k % 2 === 0) {
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 4), headMat);
        head.position.y = h - 0.05;
        r.add(head);
      }
      g.add(r);
    }
  };
  for (const p of ponds) {
    // 两三簇：一簇芦苇贴着水边，旁边散两三块石头
    const n = 2 + Math.floor(rnd() * 2);
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 1.2;
      const at = (da: number, dd: number) => ({ x: p.x + Math.cos(a + da) * (p.radius + dd), z: p.z + Math.sin(a + da) * (p.radius + dd) });
      const r = at(0, 0.05);
      reedsAt(r.x, r.z);
      for (let j = 0, m = 1 + Math.floor(rnd() * 3); j < m; j++) {
        const s = at((rnd() - 0.5) * (1.4 / p.radius), 0.15 + rnd() * 0.5);
        rockAt(s.x, s.z, 0.12 + rnd() * 0.2);
      }
    }
  }
  for (const s of streams) {
    for (let i = 0; i < s.points.length - 1; i++) {
      const a = s.points[i]!;
      const b = s.points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      for (let k = 0; k < Math.round(len / 5); k++) {
        const t = rnd();
        const side = rnd() < 0.5 ? -1 : 1;
        const off = (s.width / 2) * (1.06 + rnd() * 0.2) * side;
        const x = a.x + (b.x - a.x) * t + nx * off;
        const z = a.z + (b.z - a.z) * t + nz * off;
        if (rnd() < 0.25) reedsAt(x, z);
        else rockAt(x, z, 0.14 + rnd() * 0.2);
      }
    }
  }
  return g;
}

/**
 * 远景岛（LOD）：低精度地形 + 几棵树，用于远处的浮岛与航行途中。
 * detail = 'far'（几百米外）或 'mid'（航行接近时）。
 */
export function buildIslandLod(terrain: Terrain, detail: 'far' | 'mid', seed: number): THREE.Group {
  const R = terrain.params.radius;
  const g = buildIslandMesh(terrain, {
    rings: detail === 'far' ? 6 : 12,
    segments: detail === 'far' ? 20 : 40,
    depth: R * 0.8,
    layers: detail === 'far' ? 4 : 6,
    grass: 0,
    flowers: 0,
  });
  const rnd = mulberry(seed);
  const trees = detail === 'far' ? Math.round(R / 5) : Math.round(R / 2.5);
  const trunk = new THREE.MeshStandardMaterial({ color: 0x8a5f40, flatShading: true });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x6fae55, flatShading: true });
  for (let i = 0; i < trees; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * R * 0.7;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (terrain.isWater(x, z)) continue;
    const s = 0.8 + rnd() * 0.6;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.25 * s, 1.6 * s, 4), trunk);
    t.position.set(x, terrain.height(x, z) + 0.8 * s, z);
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 * s, 0), leaf);
    f.position.set(x, terrain.height(x, z) + 2.2 * s, z);
    g.add(t, f);
  }
  return g;
}
