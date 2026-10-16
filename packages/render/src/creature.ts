import type { ContentDb, Element, PartSlot } from '@cloudsea/content';
import { expressedParts, formOf, type Spirit } from '@cloudsea/sim';
import * as THREE from 'three';
import { gaitFoot, Rig, rigid, segGeo, segW, skinMat, solveLeg } from './rig';
import { angDiff, C, clamp, lerp, M } from './util';

/** 属性的基础色相 / 饱和度（来自原型 ELEM，与属性色一致）。 */
const ELEMENT_HSL: Readonly<Record<Element, { hue: number; sat: number }>> = {
  sun: { hue: 38, sat: 0.66 },
  rain: { hue: 205, sat: 0.58 },
  wind: { hue: 152, sat: 0.48 },
  thunder: { hue: 268, sat: 0.5 },
  mist: { hue: 228, sat: 0.16 },
};

/** 渲染需要的外观参数（全部来自基因与物种骨架模板）。 */
export interface CreatureLook {
  readonly seed: number;
  readonly element: Element;
  readonly secondary: Element | null;
  readonly hueShift: number;
  readonly pattern: 'plain' | 'spots' | 'stripes';
  /** 身体半径（米）= 骨架 bodyRadius × 体型。 */
  readonly size: number;
  readonly headRatio: number;
  readonly eyeScale: number;
  readonly tailSegments: number;
  readonly ears: 0 | 1 | 2 | 3;
  readonly horn: 0 | 1 | 2;
  readonly wings: boolean;
  readonly tail: 0 | 1 | 2;
  readonly legs: 0 | 2 | 4 | 6;
  readonly mutated: ReadonlySet<PartSlot>;
  readonly shiny: boolean;
  readonly blighted: boolean;
}

const EAR_TYPE: Record<string, 1 | 2 | 3> = { pointedEars: 1, floppyEars: 2, roundEars: 3 };
const HORN_TYPE: Record<string, 1 | 2> = { singleHorn: 1, twinHorns: 2 };
const TAIL_TYPE: Record<string, 1 | 2> = { fluffTail: 1, finTail: 2 };

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function lookFromSpirit(content: ContentDb, spirit: Pick<Spirit, 'id' | 'formId' | 'genes' | 'blighted'>): CreatureLook {
  const { form, line } = formOf(content, spirit);
  const parts = expressedParts(content, spirit);
  const feet = parts.feet ? content.parts.get(parts.feet)!.legs ?? 4 : 4;
  const mutated = new Set<PartSlot>();
  for (const slot of ['ears', 'horns', 'wings', 'tail', 'feet'] as const) if (parts[slot] && spirit.genes.parts[slot].mutated) mutated.add(slot);
  return {
    seed: hashString(spirit.id),
    element: line.element,
    secondary: spirit.genes.secondaryElement,
    hueShift: spirit.genes.hueShift,
    pattern: spirit.genes.pattern,
    size: form.skeleton.bodyRadius * (spirit.genes.sizePercent / 100),
    headRatio: form.skeleton.headRatio,
    eyeScale: form.skeleton.eyeScale,
    tailSegments: form.skeleton.tailSegments,
    ears: parts.ears ? EAR_TYPE[parts.ears] ?? 0 : 0,
    horn: parts.horns ? HORN_TYPE[parts.horns] ?? 0 : 0,
    wings: parts.wings === 'featherWings',
    tail: parts.tail ? TAIL_TYPE[parts.tail] ?? 0 : 0,
    legs: feet as 0 | 2 | 4 | 6,
    mutated,
    shiny: spirit.genes.shiny,
    blighted: spirit.blighted,
  };
}

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

interface LegInfo {
  lx: number;
  lz: number;
  off: number;
  a: number;
  b: number;
  knee: number;
  th: THREE.Bone;
  sh: THREE.Bone;
  ft: THREE.Bone;
}

/**
 * 絮灵模型 + 程序化动画（从原型 buildCreature / Creature 迁移）。
 * 同一套步态算法驱动 0 / 2 / 4 / 6 足。
 */
export class CreatureView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly look: CreatureLook;
  private readonly B: Record<string, THREE.Bone>;
  private readonly H0: number;
  private readonly hipY: number;
  private readonly eyes: THREE.Bone[] = [];
  private readonly ears: Array<{ b: THREE.Bone; s: number }> = [];
  private readonly wings: Array<{ b: THREE.Bone; s: number }> = [];
  private readonly tail: THREE.Bone[] = [];
  private readonly legs: LegInfo[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private aura: THREE.Points | null = null;

  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  /** 动画状态 */
  private phase = Math.random();
  private ph = Math.random() * 6;
  private jy = 0;
  private jv = 0;
  private sq = 0;
  private sqv = 0;
  private blink = 2 + Math.random() * 3;
  private headY = 0;
  private prevYaw = 0;
  private flash = 0;
  private faint = 0;
  /** 移动目标（由控制器设置）。 */
  targetX = 0;
  targetZ = 0;
  maxSpeed: number;
  moving = false;
  lookAt: { x: number; z: number } | null = null;

  constructor(look: CreatureLook) {
    this.look = look;
    const g = look;
    const r = g.size;
    const rig = new Rig();
    const legs = g.legs;
    const H0 = legs ? r * 1.15 + r * 0.7 : 0.95 + r;
    this.H0 = H0;
    const hsl = ELEMENT_HSL[g.element];
    let hue = hsl.hue + g.hueShift + (g.shiny ? 150 : 0);
    hue = ((hue % 360) + 360) % 360;
    const base = new THREE.Color().setHSL(hue / 360, clamp(hsl.sat * (g.shiny ? 1.15 : 1), 0, 1), g.shiny ? 0.72 : 0.67);
    if (g.blighted) base.lerp(C(0x3a3346), 0.55);
    const belly = base.clone().lerp(C(0xfff8ee), 0.55);
    const dark = base.clone().multiplyScalar(0.8);
    const pink = C(0xf6a8a6).lerp(base, 0.2);
    const secHsl = g.secondary ? ELEMENT_HSL[g.secondary] : null;
    const spot = secHsl
      ? new THREE.Color().setHSL(secHsl.hue / 360, Math.max(0.35, secHsl.sat), 0.6)
      : new THREE.Color().setHSL((((hue + 38) % 360) + 360) % 360 / 360, clamp(hsl.sat + 0.12, 0, 1), 0.53);
    if (g.blighted) spot.set(0x2a1838);
    const hornC = new THREE.Color().setHSL(0.12, 0.5, 0.86);
    const eyeC = C(0x231c24);
    const white = C(0xffffff);
    const glow = (slot: PartSlot, c: THREE.Color) => (g.mutated.has(slot) ? c.clone().lerp(C(0xfff2c4), 0.55) : c);

    const ROOT = rig.bone('root', -1, 0, 0, 0);
    const BODY = rig.bone('body', ROOT, 0, H0, 0);
    const hr = g.headRatio;
    const hp: [number, number, number] = [0, H0 + r * 0.62 * hr, r * 0.72];
    const HEAD = rig.bone('head', BODY, hp[0], hp[1], hp[2]);
    const patterned = (lc: THREE.Vector3): boolean => {
      if (g.pattern === 'spots') return hash2(lc.x * 7 + lc.z * 3 + (g.seed % 97), lc.y * 5) > 0.6;
      if (g.pattern === 'stripes') return Math.sin(lc.z * 9 + lc.y * 2) > 0.55;
      return g.blighted && hash2(lc.x * 11, lc.z * 13) > 0.7;
    };
    rig.add(
      new THREE.IcosahedronGeometry(1, 1),
      M(0, H0, 0, 0, 0, 0, r, r * 0.86, r * 1.08),
      (lc) => (lc.y < -0.38 ? belly : patterned(lc) ? spot : base),
      rigid(BODY),
    );
    rig.add(
      new THREE.IcosahedronGeometry(1, 1),
      M(hp[0], hp[1], hp[2], 0, 0, 0, r * 0.8 * hr, r * 0.76 * hr, r * 0.78 * hr),
      (lc) => (lc.z > 0.5 && lc.y < 0.05 ? belly : base),
      rigid(HEAD),
    );
    const eyes: number[] = [];
    const ears: Array<{ b: number; s: number }> = [];
    const wings: Array<{ b: number; s: number }> = [];
    const hs = hr;
    for (const s of [1, -1]) {
      const ex = hp[0] + s * r * 0.33 * hs;
      const ey = hp[1] + r * 0.06 * hs;
      const ez = hp[2] + r * 0.66 * hs;
      const EB = rig.bone(`eye${s}`, HEAD, ex, ey, ez);
      eyes.push(EB);
      const es = r * 0.15 * g.eyeScale * hs;
      rig.add(new THREE.SphereGeometry(1, 8, 6), M(ex, ey, ez, 0, 0, 0, es, es * 1.18, es * 0.6), g.blighted ? C(0x8a2a5a) : eyeC, rigid(EB));
      rig.add(new THREE.SphereGeometry(1, 5, 4), M(ex + s * es * 0.25, ey + es * 0.42, ez + es * 0.48, 0, 0, 0, es * 0.32), white, rigid(EB));
      rig.add(new THREE.SphereGeometry(1, 6, 4), M(hp[0] + s * r * 0.52 * hs, hp[1] - r * 0.2 * hs, hp[2] + r * 0.5 * hs, 0, s * 0.6, 0, r * 0.13, r * 0.08, r * 0.05), pink, rigid(HEAD));
      if (g.ears) {
        const ex2 = hp[0] + s * r * 0.42 * hs;
        const ey2 = hp[1] + r * 0.5 * hs;
        const ez2 = hp[2] - r * 0.05;
        const EA = rig.bone(`ear${s}`, HEAD, ex2, ey2, ez2);
        ears.push({ b: EA, s });
        const ec = glow('ears', base);
        if (g.ears === 1) {
          rig.add(new THREE.ConeGeometry(r * 0.2, r * 0.58, 5).translate(0, r * 0.29, 0), M(ex2, ey2, ez2, 0, 0, -s * 0.35), ec, rigid(EA));
          rig.add(new THREE.ConeGeometry(r * 0.11, r * 0.38, 4).translate(0, r * 0.21, r * 0.08), M(ex2, ey2, ez2, 0, 0, -s * 0.35), pink, rigid(EA));
        } else if (g.ears === 2) {
          const geo = new THREE.SphereGeometry(1, 7, 5);
          geo.scale(r * 0.13, r * 0.38, r * 0.2);
          geo.translate(s * r * 0.12, -r * 0.24, 0);
          rig.add(geo, M(ex2, ey2, ez2, 0, 0, s * 0.5), glow('ears', dark), rigid(EA));
        } else {
          rig.add(new THREE.SphereGeometry(1, 8, 5).scale(r * 0.22, r * 0.22, r * 0.08).translate(0, r * 0.17, 0), M(ex2, ey2, ez2, 0, 0, -s * 0.2), ec, rigid(EA));
          rig.add(new THREE.SphereGeometry(1, 7, 4).scale(r * 0.13, r * 0.13, r * 0.05).translate(0, r * 0.17, r * 0.05), M(ex2, ey2, ez2, 0, 0, -s * 0.2), pink, rigid(EA));
        }
      }
      if (g.wings) {
        const wx = s * r * 0.55;
        const wy = H0 + r * 0.55;
        const wz = -r * 0.15;
        const WB = rig.bone(`wing${s}`, BODY, wx, wy, wz);
        wings.push({ b: WB, s });
        for (let k = 0; k < 3; k++) {
          const geo = new THREE.SphereGeometry(1, 7, 4);
          geo.scale(r * (0.55 - k * 0.09), r * 0.05, r * 0.17);
          geo.translate(s * r * 0.48, -k * r * 0.05, -k * r * 0.17);
          rig.add(geo, M(wx, wy, wz, 0, -s * k * 0.22, s * (0.25 + k * 0.12)), glow('wings', belly.clone().lerp(white, 0.4)), rigid(WB));
        }
      }
    }
    const hornCol = glow('horns', g.blighted ? C(0x5a4a66) : hornC);
    if (g.horn === 1) rig.add(new THREE.ConeGeometry(r * 0.11, r * 0.48, 5).translate(0, r * 0.24, 0), M(hp[0], hp[1] + r * 0.6 * hs, hp[2] + r * 0.12, 0.35), hornCol, rigid(HEAD));
    if (g.horn === 2)
      for (const s of [1, -1])
        rig.add(new THREE.ConeGeometry(r * 0.09, r * 0.4, 5).translate(0, r * 0.2, 0), M(hp[0] + s * r * 0.26 * hs, hp[1] + r * 0.58 * hs, hp[2], 0.2, 0, -s * 0.38), hornCol, rigid(HEAD));

    const tail: number[] = [];
    if (g.tail) {
      const n = g.tailSegments;
      const seg = r * 0.3;
      let prev = BODY;
      let py = H0 + r * 0.1;
      let pz = -r * 0.95;
      for (let i = 0; i < n; i++) {
        const TB = rig.bone(`tail${i}`, prev, 0, py, pz);
        tail.push(TB);
        if (g.tail === 1) {
          const rad = r * (0.22 - i * 0.02) * (i === n - 1 ? 1.5 : 1);
          rig.add(new THREE.IcosahedronGeometry(1, 1), M(0, py + r * 0.03, pz - seg * 0.5, 0, 0, 0, Math.max(rad, r * 0.06)), glow('tail', i === n - 1 ? belly : base), rigid(TB));
        } else {
          rig.add(new THREE.IcosahedronGeometry(1, 0), M(0, py, pz - seg * 0.5, 0, 0, 0, r * 0.08, r * Math.max(0.06, 0.2 - i * 0.02), seg * 0.7), dark, rigid(TB));
          if (i === n - 1)
            for (const s of [1, -1])
              rig.add(new THREE.ConeGeometry(r * 0.16, r * 0.55, 4).translate(0, r * 0.27, 0), M(0, py, pz - seg * 0.7, -Math.PI / 2 + s * 0.5, 0, 0, 1, 1, 0.25), glow('tail', spot), rigid(TB));
        }
        prev = TB;
        py += r * 0.08;
        pz -= seg;
      }
    } else rig.add(new THREE.IcosahedronGeometry(r * 0.13, 0), M(0, H0, -r * 1.05), belly, rigid(BODY));

    const legInfo: Array<Omit<LegInfo, 'th' | 'sh' | 'ft'> & { i: number }> = [];
    let hipY = 0;
    if (legs) {
      hipY = H0 - r * 0.45;
      const a = hipY * 0.56;
      const b = hipY * 0.56;
      const lay =
        legs === 2
          ? [[0.45, 0, 0], [-0.45, 0, 0.5]]
          : legs === 4
            ? [[0.5, 0.55, 0], [-0.5, 0.55, 0.5], [0.5, -0.55, 0.5], [-0.5, -0.55, 0]]
            : [[0.6, 0.6, 0], [-0.6, 0.6, 0.5], [0.62, 0, 0.5], [-0.62, 0, 0], [0.6, -0.6, 0], [-0.6, -0.6, 0.5]];
      const legCol = glow('feet', dark);
      lay.forEach((l, i) => {
        const lx = l[0]! * r;
        const lz = l[1]! * r;
        const th = rig.bone(`th${i}`, ROOT, lx, hipY, lz);
        const sh = rig.bone(`sh${i}`, th, lx, hipY - a, lz);
        const ft = rig.bone(`ft${i}`, sh, lx, hipY - a - b, lz);
        rig.add(segGeo(r * 0.17, r * 0.14, a, 6), M(lx, hipY, lz), legCol, rigid(th));
        rig.add(segGeo(r * 0.14, r * 0.11, b, 6), M(lx, hipY - a, lz), legCol, segW(sh, th, b));
        rig.add(new THREE.SphereGeometry(1, 6, 4), M(lx, hipY - a - b + r * 0.03, lz + r * 0.05, 0, 0, 0, r * 0.17, r * 0.1, r * 0.22), belly, rigid(ft));
        legInfo.push({ i, lx, lz, off: l[2]!, a, b, knee: legs === 2 ? 1 : l[1]! > 0 ? -1 : 1 });
      });
    } else {
      const cloud = glow('feet', g.blighted ? C(0x6b6478) : C(0xfdfbff));
      for (const p of [[0.36, -0.88, 0.05], [-0.36, -0.88, 0.05], [0, -0.95, -0.25], [0, -0.9, 0.3]])
        rig.add(new THREE.IcosahedronGeometry(1, 1), M(p[0]! * r, H0 + p[1]! * r, p[2]! * r, 0, 0, 0, r * 0.34, r * 0.22, r * 0.3), cloud, rigid(BODY));
    }

    this.material = skinMat();
    this.mesh = rig.build(this.material);
    this.B = rig.boneMap();
    this.hipY = hipY;
    for (const e of eyes) this.eyes.push(rig.bones[e]!);
    for (const e of ears) this.ears.push({ b: rig.bones[e.b]!, s: e.s });
    for (const w of wings) this.wings.push({ b: rig.bones[w.b]!, s: w.s });
    for (const t of tail) this.tail.push(rig.bones[t]!);
    for (const l of legInfo) this.legs.push({ ...l, th: this.B[`th${l.i}`]!, sh: this.B[`sh${l.i}`]!, ft: this.B[`ft${l.i}`]! });
    this.group.add(this.mesh);

    // 蚀化：黑色粒子环绕；幻色：金色闪光
    if (g.blighted || g.shiny) {
      const n = 18;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: g.blighted ? 0x1a1022 : 0xffe9a8, size: r * 0.18, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      pts.frustumCulled = false;
      this.group.add(pts);
      this.aura = pts;
    }
    this.maxSpeed = (legs === 6 ? 1.3 : legs === 4 ? 1.1 : legs === 0 ? 0.9 : 1) * (0.8 + r);
  }

  /** 头顶位置（世界坐标），用于点选、名字标签、特效。 */
  headPos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.B['head']!.getWorldPosition(out);
  }

  setPosition(x: number, z: number, yaw = this.yaw): void {
    this.x = this.targetX = x;
    this.z = this.targetZ = z;
    this.yaw = this.prevYaw = yaw;
  }

  moveTo(x: number, z: number): void {
    this.targetX = x;
    this.targetZ = z;
    this.moving = true;
  }

  /** 抚摸 / 开心：跳一下。 */
  hop(strength = 3.4): void {
    this.jv = strength;
    this.sqv = -6;
  }

  /** 受击：闪白 + 抖。 */
  hit(): void {
    this.flash = 1;
    this.sqv = 5;
  }

  setFainted(f: boolean): void {
    this.faint = f ? 1 : 0;
  }

  update(dt: number, t: number, ground: (x: number, z: number) => number): void {
    const g = this.look;
    const r = g.size;
    let want = 0;
    if (this.moving) {
      const d = Math.hypot(this.targetX - this.x, this.targetZ - this.z);
      if (d < 0.25) this.moving = false;
      else {
        want = Math.min(this.maxSpeed * 1.9, Math.max(this.maxSpeed * 0.6, d * 1.6));
        const yawT = Math.atan2(this.targetX - this.x, this.targetZ - this.z);
        const dyaw = angDiff(this.yaw, yawT);
        this.yaw += clamp(dyaw, -3.2 * dt, 3.2 * dt);
        want *= Math.abs(dyaw) > 1.2 ? 0.3 : 1;
      }
    } else if (this.lookAt) {
      const yawT = Math.atan2(this.lookAt.x - this.x, this.lookAt.z - this.z);
      this.yaw += clamp(angDiff(this.yaw, yawT), -2 * dt, 2 * dt);
    }
    this.speed = lerp(this.speed, want, Math.min(1, dt * 4));
    this.x += Math.sin(this.yaw) * this.speed * dt;
    this.z += Math.cos(this.yaw) * this.speed * dt;
    const gy = ground(this.x, this.z);
    this.group.position.set(this.x, gy, this.z);
    this.group.rotation.y = this.yaw;

    // 跳跃与压扁回弹（弹簧）
    this.jv -= 11 * dt;
    this.jy += this.jv * dt;
    if (this.jy < 0) {
      if (this.jv < -1.5) this.sqv += this.jv * 1.4;
      this.jy = 0;
      this.jv = 0;
    }
    this.sqv += (-120 * this.sq - 9 * this.sqv) * dt;
    this.sq += this.sqv * dt;

    const w = clamp(this.speed / 0.5, 0, 1);
    const stride = r * 1.1;
    this.phase += (dt * Math.max(this.speed, 0.05)) / (2 * stride);
    const B = this.B;
    const bob = g.legs ? Math.cos(this.phase * Math.PI * 4) * r * 0.07 * w : Math.sin(t * 2 + this.ph) * 0.12;
    const faintDrop = this.faint * r * 0.5;
    B['body']!.position.y = this.H0 + bob + this.jy - faintDrop;
    B['body']!.scale.set(1 - this.sq * 0.5, 1 + this.sq, 1 - this.sq * 0.5);
    B['body']!.rotation.set(0.1 * w, 0, Math.sin(this.phase * Math.PI * 2) * 0.09 * w * (g.legs === 2 ? 1.6 : 1) + this.faint * 1.2);

    // 头：看向目标或四处张望
    let hy = Math.sin(t * 0.5 + this.ph) * 0.45 * (1 - w);
    if (this.lookAt) {
      const d = Math.hypot(this.lookAt.x - this.x, this.lookAt.z - this.z);
      if (d < 4.5) hy = clamp(angDiff(this.yaw, Math.atan2(this.lookAt.x - this.x, this.lookAt.z - this.z)), -0.9, 0.9);
    }
    this.headY = lerp(this.headY, hy, Math.min(1, dt * 4));
    B['head']!.rotation.set(-0.05 + this.faint * 0.4, this.headY, Math.sin(t * 0.8 + this.ph) * 0.16 * (1 - w));

    this.blink -= dt;
    const closed = this.blink < 0.12 || this.faint > 0.5;
    if (this.blink < 0) this.blink = 1.8 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = closed ? 0.12 : 1;

    const turn = angDiff(this.prevYaw, this.yaw) / Math.max(dt, 1e-3);
    this.prevYaw = this.yaw;
    for (const e of this.ears) {
      e.b.rotation.x = -w * 0.45 + Math.sin(t * 2.3 + this.ph) * 0.05 - this.jv * 0.06;
      e.b.rotation.z = e.s * (Math.sin(t * 1.7 + this.ph + e.s) * 0.08 + (Math.sin(t * 0.9 + this.ph) > 0.96 ? 0.35 : 0));
    }
    this.tail.forEach((b, i) => {
      b.rotation.y = Math.sin(t * 3 * (1 + w) - i * 0.75 + this.ph) * (0.22 + 0.2 * w) - turn * 0.12;
      b.rotation.x = 0.18 + Math.sin(t * 2 - i * 0.6) * 0.05;
    });
    for (const wg of this.wings) {
      const flap = g.legs ? (w > 0.6 || this.jy > 0 ? Math.sin(t * 16) * 0.6 : 0.12 + Math.sin(t * 1.5 + this.ph) * 0.05) : Math.sin(t * 7 + this.ph) * 0.55;
      wg.b.rotation.z = wg.s * flap;
    }

    // 腿 IK：脚踩在地形上
    if (g.legs) {
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      const hipY = this.hipY + bob + this.jy - faintDrop;
      for (const L of this.legs) {
        L.th.position.y = hipY;
        const gf = gaitFoot(this.phase + L.off, stride, r * 0.35);
        const lz = L.lz + gf[0] * w;
        const lx = L.lx * 1.05;
        const wx = this.x + lx * cy + lz * sy;
        const wz = this.z - lx * sy + lz * cy;
        let fy = ground(wx, wz) - gy + r * 0.06 + gf[1] * w;
        fy = Math.max(fy, hipY - (L.a + L.b) * 0.92);
        solveLeg(L.th, L.sh, L.ft, { x: L.lx, y: hipY, z: L.lz }, { x: lx, y: fy, z: lz }, L.a, L.b, L.knee);
      }
    }

    // 受击闪白
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      this.material.emissive.setRGB(this.flash, this.flash, this.flash);
    }
    this.material.opacity = 1;

    if (this.aura) {
      const p = this.aura.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const a = t * (g.blighted ? 0.8 : 1.6) + i * 2.1;
        const rr = r * (1.3 + 0.3 * Math.sin(t + i));
        p.setXYZ(i, Math.cos(a) * rr, this.H0 + Math.sin(a * 1.3 + i) * r * 0.8, Math.sin(a) * rr);
      }
      p.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.aura) {
      this.aura.geometry.dispose();
      (this.aura.material as THREE.Material).dispose();
    }
  }
}
