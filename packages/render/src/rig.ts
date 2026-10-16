import * as THREE from 'three';
import { clamp } from './util';

/** 蒙皮权重函数：返回 [骨骼, 权重, 骨骼2?, 权重2?]。 */
export type WeightFn = (lx: number, ly: number, lz: number, world: THREE.Vector3) => [number, number, number?, number?];
export type ColorFn = THREE.Color | ((localCenter: THREE.Vector3) => THREE.Color);

/**
 * 程序化骨骼 + 蒙皮（从原型 Rig 迁移，美术约定）：
 * 几何体拼装 → 按面上色 → 程序化骨骼 → 计算蒙皮权重。
 */
export class Rig {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly si: number[] = [];
  private readonly sw: number[] = [];
  readonly bones: THREE.Bone[] = [];
  private readonly bw: THREE.Vector3[] = [];

  bone(name: string, parent: number, x: number, y: number, z: number): number {
    const b = new THREE.Bone();
    b.name = name;
    const i = this.bones.length;
    this.bones.push(b);
    this.bw.push(new THREE.Vector3(x, y, z));
    if (parent >= 0) {
      const p = this.bw[parent]!;
      b.position.set(x - p.x, y - p.y, z - p.z);
      this.bones[parent]!.add(b);
    } else b.position.set(x, y, z);
    return i;
  }

  add(geo: THREE.BufferGeometry, m4: THREE.Matrix4, color: ColorFn, weight: WeightFn): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const a = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const lc = new THREE.Vector3();
    for (let i = 0; i < a.count; i += 3) {
      lc.set(
        (a.getX(i) + a.getX(i + 1) + a.getX(i + 2)) / 3,
        (a.getY(i) + a.getY(i + 1) + a.getY(i + 2)) / 3,
        (a.getZ(i) + a.getZ(i + 1) + a.getZ(i + 2)) / 3,
      );
      const c = typeof color === 'function' ? color(lc) : color;
      for (let k = 0; k < 3; k++) {
        v.set(a.getX(i + k), a.getY(i + k), a.getZ(i + k));
        const lx = v.x;
        const ly = v.y;
        const lz = v.z;
        v.applyMatrix4(m4);
        this.pos.push(v.x, v.y, v.z);
        this.col.push(c.r, c.g, c.b);
        const w = weight(lx, ly, lz, v);
        this.si.push(w[0], w[2] ?? 0, 0, 0);
        this.sw.push(w[1], w[3] ?? 0, 0, 0);
      }
    }
  }

  build(material: THREE.Material): THREE.SkinnedMesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.computeVertexNormals();
    const mesh = new THREE.SkinnedMesh(g, material);
    mesh.add(this.bones[0]!);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  boneMap(): Record<string, THREE.Bone> {
    return Object.fromEntries(this.bones.map((b) => [b.name, b]));
  }
}

export const rigid = (b: number): WeightFn => () => [b, 1];

/** 关节处两骨混合（上段 35% 渐变）。 */
export const segW = (b: number, p: number, len: number): WeightFn => (_lx, ly) => {
  const t = clamp(-ly / len, 0, 1);
  if (t < 0.35) {
    const w = 0.5 + t / 0.7;
    return [b, w, p, 1 - w];
  }
  return [b, 1];
};

export const segGeo = (rt: number, rb: number, len: number, rs: number): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, len, rs, 2).translate(0, -len / 2, 0);

export const skinMat = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });

/** 两骨 IK（腿平面内），kneeSign +1 = 膝盖朝前。 */
export function solveLeg(
  th: THREE.Bone,
  sh: THREE.Bone,
  ft: THREE.Bone,
  hip: { x: number; y: number; z: number },
  tg: { x: number; y: number; z: number },
  a: number,
  b: number,
  kneeSign: number,
): void {
  const dx = tg.x - hip.x;
  const dy = tg.y - hip.y;
  const dz = tg.z - hip.z;
  const V = Math.hypot(dx, dy);
  const roll = Math.atan2(dx, -dy);
  let L = Math.hypot(V, dz);
  L = clamp(L, Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const phi = Math.atan2(dz, V);
  const alpha = Math.acos(clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1));
  const bend = Math.PI - Math.acos(clamp((a * a + b * b - L * L) / (2 * a * b), -1, 1));
  th.rotation.order = 'ZXY';
  th.rotation.set(-(phi + alpha * kneeSign), 0, roll);
  sh.rotation.set(bend * kneeSign, 0, 0);
  ft.rotation.set(-(th.rotation.x + sh.rotation.x), 0, -roll);
}

/** 步态：相位 p 时脚的前后位移与抬起高度。 */
export function gaitFoot(p: number, stride: number, lift: number): [number, number] {
  p -= Math.floor(p);
  if (p < 0.5) return [stride / 2 - stride * (p / 0.5), 0];
  const q = (p - 0.5) / 0.5;
  return [-stride / 2 + stride * (0.5 - 0.5 * Math.cos(Math.PI * q)), Math.sin(Math.PI * q) * lift];
}
