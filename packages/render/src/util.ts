import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 表现层用的随机数（不影响 sim；只为让外观稳定，用种子）。 */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const C = (hex: THREE.ColorRepresentation): THREE.Color => new THREE.Color(hex);

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/** 位置 + 欧拉角 + 缩放 → 矩阵（原型的 M()）。 */
export function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.clone().setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** 低多边形材质：flatShading、哑光（美术约定）。同参数共享一份。 */
export function mat(hex: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `${String(hex)}|${JSON.stringify(opts)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.9, metalness: 0, ...opts });
    matCache.set(key, m);
  }
  return m;
}

/** 顶点按位置抖动（同一位置同一偏移，面不撕裂）。 */
export function jitterGeo(geo: THREE.BufferGeometry, amt: number, rnd: () => number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1000) + 0).join(',');
    let o = map.get(k);
    if (!o) {
      o = [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt, (rnd() - 0.5) * amt];
      map.set(k, o);
    }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** 程序生成的 canvas 贴图（美术约定允许：粒子 sprite、天空 / 云海）。 */
export function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 64): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mats) if (![...matCache.values()].includes(x as THREE.MeshStandardMaterial)) x.dispose();
    }
  });
}
