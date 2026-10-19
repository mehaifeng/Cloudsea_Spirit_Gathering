import * as THREE from 'three';
import { gaitFoot, Rig, rigid, segGeo, segW, skinMat, solveLeg, type WeightFn } from './rig';
import { angDiff, C, clamp, lerp, M, mat } from './util';

export interface HumanoidLook {
  readonly skinTone: string;
  readonly hairColor: string;
  readonly clothColor: string;
  readonly scarfColor: string;
  readonly height?: number;
  /** 手提灯（玩家）。 */
  readonly lantern?: boolean;
}

/**
 * 动作（DESIGN 14.3，v0.5）：采集用的砍（斧）、凿（镐）、摘（篮子）；
 * v0.11 修船播片加了钉（蹲下用锤子钉木板）、锯（弯腰拉锯）。
 */
export type ActionKind = 'chop' | 'mine' | 'pick' | 'hammer' | 'saw';
/** 每种动作的时长与“落下”的时刻（占时长的比例）。 */
const ACTION_TIMING: Record<ActionKind, { duration: number; impact: number }> = {
  chop: { duration: 0.95, impact: 0.5 },
  mine: { duration: 0.95, impact: 0.5 },
  pick: { duration: 0.95, impact: 0.5 },
  hammer: { duration: 0.5, impact: 0.55 },
  saw: { duration: 0.7, impact: 0.5 },
};

/** 手里拿着 / 扛着的东西（v0.11，播片里的商队伙计）：肩上的木板、捧着的工具箱、云气晶体。 */
export type CarryKind = 'plank' | 'box' | 'crystal';

const smoothK = (k: number, a: number, b: number): number => {
  const t = clamp((k - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 大跳落地缓冲的时长（秒）。 */
const LAND_DURATION = 0.55;

/** 播片里商队领队捧着的云气晶体（与云舟桅顶的核心同色）。 */
const crystalMaterial = new THREE.MeshStandardMaterial({ color: 0xdff4ff, emissive: 0x8fd1f0, emissiveIntensity: 0.9, flatShading: true });

/** 提灯发光材质（夜里亮起）。 */
export const lanternMaterial = new THREE.MeshStandardMaterial({ color: 0xffd59a, emissive: 0xffa340, emissiveIntensity: 0.3, flatShading: true });

/**
 * 守岛人模型（从原型 makePlayer 迁移）：程序化骨骼、两骨 IK 步态、围巾弹簧、提灯钟摆。
 * 玩家与 AI 守岛人共用，按外观参数上色。
 */
export class HumanoidView {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly B: Record<string, THREE.Bone>;
  private pivot: THREE.Group | null = null;
  light: THREE.PointLight | null = null;
  private glowSprite: THREE.Sprite | null = null;
  x = 0;
  z = 0;
  yaw = 0;
  speed = 0;
  private phase = 0;
  private prevSpeed = 0;
  private prevYaw = 0;
  private headY = 0;
  private sc = [0, 0, 0];
  private scv = [0, 0, 0];
  private L = { ax: 0, az: 0, vx: 0, vz: 0 };
  /** 看向（附近的絮灵 / 说话对象）。 */
  lookAt: { x: number; z: number } | null = null;
  /** 挥手动作计时。 */
  private wave = 0;
  /**
   * 跳跃与落差（v0.6 用绝对高度）：脚底的世界高度、竖直速度、是否着地、起跳初速度、
   * 起跳前的蓄力计时、下蹲弹簧（负值 = 蹲下）。走出台沿会自然下落，跳到更高的面上会落在上面。
   */
  private footY = 0;
  private vy = 0;
  private grounded = true;
  private jumpV = 4.4;
  private lastFloor = 0;
  private placed = false;
  /** 踉跄 0..1（云舟迫降时随船身摇晃），自动衰减。 */
  stagger = 0;
  private jumpDelay = 0;
  private crouch = 0;
  private crouchV = 0;
  /** 正在做的动作。 */
  private action: { kind: ActionKind; t: number; onImpact: (() => void) | null } | null = null;
  private readonly tools = new Map<string, THREE.Object3D>();
  /**
   * 大跳（v0.11，播片里跳下云舟）：蓄力时深蹲、双臂后摆；起跳时手臂前甩、一条腿提膝；
   * 下落时双腿前伸找地面；落地后深蹲缓冲 landT 秒再站起来。
   */
  private bigJump = false;
  private windup = 0;
  private landT = 0;
  /** 拿着的东西（见 CarryKind）；raised = 举过头顶（装晶体）。 */
  carry: CarryKind | null = null;
  raised = false;
  private readonly carried = new Map<CarryKind, THREE.Object3D>();
  /** 说话时的手势（左手随话轻轻比划）。 */
  talking = false;

  constructor(look: HumanoidLook, glowTexture?: THREE.Texture) {
    const r = new Rig();
    const SKIN = C(look.skinTone);
    const HAIR = C(look.hairColor);
    const CLOAK = C(look.clothColor);
    const TUNIC = C(0xf0e2c4);
    const PANTS = C(0x3d6f73);
    const BOOT = C(0x6b4a35);
    const SCARF = C(look.scarfColor);
    const BAG = C(0x9a6a43);
    const EYE = C(0x2a211c);
    const BLUSH = C(0xf09a86);
    const ROLL = C(0xcbb48e);
    const root = r.bone('root', -1, 0, 0, 0);
    const hips = r.bone('hips', root, 0, 0.92, 0);
    const spine = r.bone('spine', hips, 0, 1.08, 0);
    const chest = r.bone('chest', spine, 0, 1.3, 0);
    const head = r.bone('head', chest, 0, 1.54, 0);
    const S: Record<string, number> = {};
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      S[`ua${L}`] = r.bone(`ua${L}`, chest, 0.25 * s, 1.45, 0);
      S[`fa${L}`] = r.bone(`fa${L}`, S[`ua${L}`]!, 0.25 * s, 1.16, 0);
      S[`hd${L}`] = r.bone(`hd${L}`, S[`fa${L}`]!, 0.25 * s, 0.91, 0);
      S[`th${L}`] = r.bone(`th${L}`, hips, 0.11 * s, 0.88, 0);
      S[`sh${L}`] = r.bone(`sh${L}`, S[`th${L}`]!, 0.11 * s, 0.46, 0);
      S[`ft${L}`] = r.bone(`ft${L}`, S[`sh${L}`]!, 0.11 * s, 0.06, 0);
    }
    const sc0 = r.bone('sc0', chest, 0, 1.44, -0.18);
    const sc1 = r.bone('sc1', sc0, 0, 1.25, -0.25);
    const sc2 = r.bone('sc2', sc1, 0, 1.06, -0.3);
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      r.add(segGeo(0.085, 0.075, 0.42, 7), M(0.11 * s, 0.88, 0), PANTS, segW(S[`th${L}`]!, hips, 0.42));
      r.add(segGeo(0.072, 0.06, 0.4, 7), M(0.11 * s, 0.46, 0), PANTS, segW(S[`sh${L}`]!, S[`th${L}`]!, 0.4));
      r.add(new THREE.BoxGeometry(0.13, 0.1, 0.24), M(0.11 * s, 0.02, 0.04), BOOT, rigid(S[`ft${L}`]!));
      r.add(segGeo(0.07, 0.062, 0.29, 7), M(0.25 * s, 1.45, 0), TUNIC, segW(S[`ua${L}`]!, chest, 0.29));
      r.add(segGeo(0.06, 0.052, 0.25, 7), M(0.25 * s, 1.16, 0), TUNIC, segW(S[`fa${L}`]!, S[`ua${L}`]!, 0.25));
      r.add(new THREE.SphereGeometry(0.062, 6, 5), M(0.25 * s, 0.87, 0), SKIN, rigid(S[`hd${L}`]!));
      r.add(new THREE.SphereGeometry(0.03, 6, 4), M(0.075 * s, 1.745, 0.19), EYE, rigid(head));
      r.add(new THREE.SphereGeometry(0.035, 6, 4), M(0.12 * s, 1.68, 0.168, 0, 0, 0, 1, 0.55, 0.4), BLUSH, rigid(head));
    }
    r.add(new THREE.CylinderGeometry(0.17, 0.16, 0.2, 8), M(0, 0.92, 0), PANTS, rigid(hips));
    r.add(new THREE.CylinderGeometry(0.19, 0.25, 0.32, 9, 1, true), M(0, 0.86, 0), TUNIC, rigid(hips));
    const torsoW: WeightFn = (_lx, _ly, _lz, w) => {
      const y = w.y;
      if (y > 1.3) return [chest, 1];
      if (y > 1.12) {
        const t = (y - 1.12) / 0.18;
        return [chest, t, spine, 1 - t];
      }
      return [spine, 0.6, hips, 0.4];
    };
    r.add(new THREE.CylinderGeometry(0.2, 0.185, 0.5, 9), M(0, 1.25, 0), TUNIC, torsoW);
    r.add(new THREE.CylinderGeometry(0.198, 0.198, 0.06, 9), M(0, 1.02, 0), BOOT, rigid(hips));
    r.add(new THREE.CylinderGeometry(0.235, 0.3, 0.56, 10, 2, true, Math.PI * 0.5, Math.PI), M(0, 1.2, 0), CLOAK, torsoW);
    r.add(new THREE.IcosahedronGeometry(0.21, 1), M(0, 1.73, 0), SKIN, rigid(head));
    // 头发（原型是兜帽；守岛人外观里用发色）
    r.add(new THREE.SphereGeometry(0.235, 10, 8, 0, Math.PI * 2, 0, 1.75), M(0, 1.77, -0.025, -0.6), HAIR, rigid(head));
    r.add(new THREE.SphereGeometry(0.255, 10, 8, 0, Math.PI * 2, 0, 1.95), M(0, 1.76, -0.06, -1.1, 0, 0, 1, 1, 0.9), CLOAK, rigid(head));
    r.add(new THREE.TorusGeometry(0.16, 0.055, 5, 12), M(0, 1.5, 0, Math.PI / 2), SCARF, rigid(chest));
    [sc0, sc1, sc2].forEach((b, i) => {
      const p = [chest, sc0, sc1][i]!;
      const y = [1.44, 1.25, 1.06][i]!;
      const z = [-0.18, -0.25, -0.3][i]!;
      r.add(new THREE.BoxGeometry(0.12, 0.2, 0.035).translate(0, -0.1, 0), M(0, y, z), SCARF, segW(b, p, 0.2));
    });
    r.add(new THREE.BoxGeometry(0.3, 0.32, 0.15), M(0, 1.24, -0.26), BAG, rigid(chest));
    r.add(new THREE.CylinderGeometry(0.075, 0.075, 0.36, 7), M(0, 1.44, -0.26, 0, 0, Math.PI / 2), ROLL, rigid(chest));
    this.mesh = r.build(skinMat());
    this.B = r.boneMap();
    // 模型按约 1.95 米搭建，统一缩到尺度规范的 1.75 米（DESIGN 14.1），守岛人再乘各自的身高系数
    const scale = 0.9 * (look.height ?? 1);
    this.mesh.scale.setScalar(scale);
    this.group.add(this.mesh);

    if (look.lantern) {
      const pivot = new THREE.Group();
      pivot.position.set(0, -0.05, 0);
      this.B['hdR']!.add(pivot);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4), mat(0x3d2c22));
      rod.position.y = -0.07;
      pivot.add(rod);
      const lf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), mat(0x3d2c22));
      lf.position.y = -0.24;
      pivot.add(lf);
      const lc = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.17, 0.18), lanternMaterial);
      lc.position.y = -0.24;
      pivot.add(lc);
      const lc2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.17, 0.12), lanternMaterial);
      lc2.position.y = -0.24;
      pivot.add(lc2);
      const light = new THREE.PointLight(0xffb45a, 0, 7, 1.6);
      light.position.y = -0.24;
      pivot.add(light);
      this.light = light;
      if (glowTexture) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        sp.position.y = -0.24;
        sp.scale.setScalar(1.2);
        pivot.add(sp);
        this.glowSprite = sp;
      }
      this.pivot = pivot;
    }
  }

  /** 放到某处；给 y 时脚底放在这个高度（例如甲板上），否则落在地面。 */
  setPosition(x: number, z: number, yaw: number, y?: number): void {
    this.x = x;
    this.z = z;
    this.yaw = this.prevYaw = yaw;
    if (y === undefined) this.placed = false;
    else {
      this.placed = true;
      this.footY = this.lastFloor = y;
      this.grounded = true;
      this.vy = 0;
    }
  }

  /** 脚底的世界高度。 */
  get feetY(): number {
    return this.footY;
  }

  /** 夜里提灯亮度 0..1。 */
  setNight(n: number): void {
    if (this.light) this.light.intensity = n * 1.7;
    if (this.glowSprite) (this.glowSprite.material as THREE.SpriteMaterial).opacity = n * 0.85;
  }

  waveHand(): void {
    this.wave = 1.6;
  }

  get airborne(): boolean {
    return !this.grounded || this.jumpDelay > 0;
  }

  /** 大跳落地后还在缓冲（站起来之前）。 */
  get landing(): boolean {
    return this.landT > 0;
  }

  /** 脚已经离地（不含起跳前的蓄力）。 */
  get offGround(): boolean {
    return !this.grounded;
  }

  get busy(): boolean {
    return this.action !== null;
  }

  /**
   * 跳：站立、行走、奔跑中都能跳（水平速度由控制器保持）。返回是否起跳。
   * windup：起跳前蹲下蓄力的时间（秒）。big：播片里的大跳（专门的蓄力 / 腾空 / 落地姿势）。
   */
  jump(strength = 4.4, windup = 0.07, big = false): boolean {
    if (this.airborne || this.action) return false;
    this.jumpDelay = windup;
    this.windup = windup;
    this.jumpV = strength;
    this.bigJump = big;
    if (!big) this.crouchV -= 2.2;
    return true;
  }

  /** 做一个采集动作；onImpact 在工具落下的那一刻调用。 */
  playAction(kind: ActionKind, onImpact: () => void): boolean {
    if (this.action || this.airborne) return false;
    this.action = { kind, t: 0, onImpact };
    this.showTool(kind);
    return true;
  }

  private tool(kind: string): THREE.Object3D {
    let t = this.tools.get(kind);
    if (t) return t;
    t = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.72, 5), mat(0x8a5f40));
    if (kind === 'chop') {
      handle.position.y = -0.3;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.2), mat(0xb8c0c8, { metalness: 0.3, roughness: 0.5 }));
      blade.position.set(0, -0.6, 0.1);
      t.add(handle, blade);
      this.B['hdR']!.add(t);
    } else if (kind === 'mine') {
      handle.position.y = -0.3;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.46), mat(0x8f98a0, { metalness: 0.3, roughness: 0.5 }));
      head.position.set(0, -0.62, 0);
      const tip1 = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), mat(0x8f98a0));
      tip1.rotation.x = Math.PI / 2;
      tip1.position.set(0, -0.62, 0.28);
      const tip2 = tip1.clone();
      tip2.rotation.x = -Math.PI / 2;
      tip2.position.z = -0.28;
      t.add(handle, head, tip1, tip2);
      this.B['hdR']!.add(t);
    } else if (kind === 'hammer') {
      // 短柄锤：柄顺着手往下，锤头横在柄端
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.34, 5), mat(0x8a5f40));
      h.position.y = -0.15;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), mat(0x6f777f, { metalness: 0.4, roughness: 0.5 }));
      head.position.set(0, -0.3, 0.02);
      t.add(h, head);
      this.B['hdR']!.add(t);
    } else if (kind === 'saw') {
      // 手锯：握把 + 一片往前伸的锯条
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.09), mat(0x8a5f40));
      grip.position.y = -0.04;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.5, 0.11), mat(0xb8c0c8, { metalness: 0.4, roughness: 0.4 }));
      blade.position.set(0, -0.34, 0.02);
      t.add(grip, blade);
      this.B['hdR']!.add(t);
    } else {
      // 篮子挂在左手
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.16, 8, 1, true), mat(0xc9a27a, { side: THREE.DoubleSide }));
      basket.position.y = -0.2;
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 4, 10, Math.PI), mat(0x8a5f40));
      loop.position.y = -0.12;
      t.add(basket, loop);
      this.B['hdL']!.add(t);
    }
    this.tools.set(kind, t);
    return t;
  }

  private showTool(kind: ActionKind | null): void {
    for (const [k, t] of this.tools) t.visible = k === kind;
    if (kind) this.tool(kind).visible = true;
    // 拿工具时把提灯收起来（提灯在右手）
    if (this.pivot) this.pivot.visible = kind === null || kind === 'pick';
  }

  /** 拿着的东西的模型（挂在胸口骨骼上，坐标是缩放前的模型单位）。 */
  private carriedModel(kind: CarryKind): THREE.Object3D {
    let o = this.carried.get(kind);
    if (o) return o;
    o = new THREE.Group();
    if (kind === 'plank') {
      // 右肩上扛着三块木板
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 1.9), mat(i % 2 ? 0xd9b27c : 0xc99f6a));
        p.position.set(0.24, 0.3 + i * 0.04, 0.15 + (i - 1) * 0.08);
        p.castShadow = true;
        o.add(p);
      }
    } else if (kind === 'box') {
      // 胸前捧着的工具箱：箱体、提手、露出来的锯柄和木尺
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.28), mat(0x8a5f40));
      body.position.set(0, -0.12, 0.36);
      body.castShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.3), mat(0x5a3e2c));
      trim.position.set(0, 0, 0.36);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), mat(0x3d2c22));
      handle.position.set(0, 0.1, 0.36);
      const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.4), mat(0xe9d6a8));
      ruler.position.set(0.14, 0.04, 0.4);
      ruler.rotation.x = 0.4;
      o.add(body, trim, handle, ruler);
    } else {
      // 云气晶体：双手捧着；举起时到头顶
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), crystalMaterial);
      c.position.set(0, -0.05, 0.34);
      c.name = 'crystal';
      o.add(c);
    }
    this.B['chest']!.add(o);
    this.carried.set(kind, o);
    return o;
  }

  /** 由控制器给出位置 / 朝向 / 速度后，算出姿态。 */
  update(dt: number, t: number, ground: (x: number, z: number) => number): void {
    const floor = ground(this.x, this.z);
    if (!this.placed) {
      this.footY = floor;
      this.lastFloor = floor;
      this.grounded = true;
      this.vy = 0;
      this.placed = true;
    }
    // 跳跃：蓄力 → 起跳 → 重力 → 落地缓冲（弹簧）；走出台沿 → 下落
    if (this.jumpDelay > 0) {
      this.jumpDelay -= dt;
      if (this.jumpDelay <= 0) {
        this.jumpDelay = 0;
        this.vy = this.jumpV;
        this.grounded = false;
        // 大跳：蹲到底时蹬地，身子一下子弹直
        if (this.bigJump) this.crouch = 0.04;
      }
    }
    if (this.grounded && floor < this.footY - 0.35) {
      this.grounded = false;
      this.vy = 0;
    }
    if (!this.grounded) {
      this.vy -= 13 * dt;
      this.footY += this.vy * dt;
      if (this.footY <= floor && this.vy <= 0) {
        this.footY = floor;
        this.grounded = true;
        if (this.bigJump) {
          this.bigJump = false;
          this.landT = LAND_DURATION;
        } else this.crouchV -= Math.min(4, Math.abs(this.vy) * 0.55);
        this.vy = 0;
      }
    } else {
      // 小台阶直接踩上去；大的落差平滑过渡
      this.footY = Math.abs(floor - this.lastFloor) < 0.5 ? floor : lerp(this.footY, floor, Math.min(1, dt * 12));
    }
    this.lastFloor = floor;
    const airH = Math.max(0, this.footY - floor);
    this.crouchV += (-90 * this.crouch - 11 * this.crouchV) * dt;
    this.crouch = clamp(this.crouch + this.crouchV * dt, -0.28, 0.08);
    const inAir = airH > 0.02 && !this.grounded;
    // 大跳的三段：蓄力 0..1、腾空（上升 / 下落）、落地缓冲 0..1
    const windK = this.bigJump && this.jumpDelay > 0 ? 1 - this.jumpDelay / Math.max(1e-3, this.windup) : 0;
    const bigAir = this.bigJump && !this.grounded;
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt);
    const landK = this.landT / LAND_DURATION;
    this.group.position.set(this.x, this.footY, this.z);
    this.group.rotation.y = this.yaw;
    const B = this.B;
    const w = clamp(this.speed / 1.4, 0, 1);
    const stride = 0.3 + 0.11 * this.speed;
    this.phase += (dt * Math.max(this.speed, 0.15)) / (2 * stride);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const feet: Array<{ L: string; lx: number; lz: number; y: number; lift: number }> = [];
    for (const [L, s, off] of [['L', 1, 0], ['R', -1, 0.5]] as const) {
      const gf = gaitFoot(this.phase + off, stride, 0.1 + 0.035 * this.speed);
      const lx = 0.11 * s;
      const lz = gf[0] * w;
      const wx = this.x + lx * cy + lz * sy;
      const wz = this.z - lx * sy + lz * cy;
      feet.push({ L, lx, lz, y: ground(wx, wz) - this.footY, lift: gf[1] * w });
    }
    // 动作进度
    const act = this.action;
    let ak = 0;
    if (act) {
      act.t += dt;
      const timing = ACTION_TIMING[act.kind];
      ak = act.t / timing.duration;
      if (act.onImpact && ak >= timing.impact) {
        const cb = act.onImpact;
        act.onImpact = null;
        cb();
      }
      if (ak >= 1) {
        this.action = null;
        this.showTool(null);
      }
    }
    const pickCrouch = act?.kind === 'pick' ? -0.18 * (smoothK(ak, 0, 0.4) - smoothK(ak, 0.65, 1)) : 0;
    // 蹲下钉木板：整段动作都蹲着（连续钉的时候不站起来）
    const kneel = act?.kind === 'hammer' ? -0.42 : act?.kind === 'saw' ? -0.12 : 0;
    const bigCrouch = -0.4 * smoothK(windK, 0, 0.7) - 0.42 * smoothK(landK, 0, 0.35);
    // 下坡时髋随低的那只脚往下沉；空中不沉（否则离地越高腿缩得越厉害，像蹲着飘）
    const hipsY = 0.88 + Math.cos(this.phase * Math.PI * 4) * 0.028 * w * (inAir ? 0 : 1) + (inAir ? 0 : Math.min(0, feet[0]!.y, feet[1]!.y)) + Math.sin(t * 1.8) * 0.006 * (1 - w) + this.crouch + pickCrouch + kneel + bigCrouch;
    B['hips']!.position.y = hipsY;
    // 上升 → 下落：vy 从起跳速度降到 0 再变负
    const rise = bigAir ? clamp(this.vy / Math.max(1, this.jumpV), -1, 1) : 0;
    for (const f of feet) {
      let target: { x: number; y: number; z: number };
      if (bigAir) {
        // 上升时前腿提膝、后腿向后蹬直；下落时两条腿一起往前下方伸、准备落地
        const lead = f.L === 'L';
        const up = { x: f.lx, y: hipsY - (lead ? 0.42 : 0.74), z: lead ? 0.3 : -0.32 };
        const down = { x: f.lx * 1.4, y: hipsY - (lead ? 0.7 : 0.64), z: lead ? 0.2 : 0.06 };
        const k = clamp(0.5 - rise * 0.7, 0, 1);
        target = { x: lerp(up.x, down.x, k), y: Math.max(lerp(up.y, down.y, k), -airH + 0.06), z: lerp(up.z, down.z, k) };
      } else if (inAir) target = { x: f.lx, y: Math.max(hipsY - 0.62, -airH + 0.06), z: f.L === 'L' ? 0.1 : -0.05 };
      // 钉木板：一条腿跪地、一条腿支起
      else if (act?.kind === 'hammer') target = f.L === 'L' ? { x: f.lx, y: f.y + 0.06, z: 0.28 } : { x: f.lx, y: f.y + 0.06, z: -0.3 };
      else target = { x: f.lx, y: f.y + 0.06 + f.lift, z: f.lz };
      // 空中收腿；地面上按步态踩地
      solveLeg(B[`th${f.L}`]!, B[`sh${f.L}`]!, B[`ft${f.L}`]!, { x: f.lx, y: hipsY - 0.04, z: 0 }, target, 0.42, 0.4, 1);
    }
    const sw = Math.cos(this.phase * Math.PI * 2);
    B['spine']!.rotation.set(0.1 * w * Math.min(this.speed / 3, 1.3) + Math.sin(t * 1.8) * 0.015, Math.sin(this.phase * Math.PI * 2) * 0.12 * w, Math.sin(this.phase * Math.PI * 2) * 0.03 * w);
    B['chest']!.rotation.y = -B['spine']!.rotation.y * 0.6;
    B['uaL']!.rotation.set(sw * 0.55 * w, 0, 0.12 + Math.sin(t * 1.8) * 0.02);
    B['faL']!.rotation.x = -0.25 - 0.25 * w;
    if (this.wave > 0) {
      this.wave -= dt;
      B['uaL']!.rotation.set(-2.6, 0, 0.3 + Math.sin(t * 14) * 0.25);
      B['faL']!.rotation.x = -0.4;
    }
    B['uaR']!.rotation.set(-0.2 - sw * 0.2 * w, 0, -0.14);
    B['faR']!.rotation.x = this.pivot ? -0.85 : -0.25 - 0.25 * w;
    if (bigAir) {
      // 起跳时手臂往前上方甩，下落时张开、略举高保持平衡；身子前倾
      const k = clamp(0.5 - rise * 0.7, 0, 1);
      B['uaL']!.rotation.set(lerp(-2.3, -1.2, k), 0, lerp(0.25, 0.85, k));
      B['uaR']!.rotation.set(lerp(-2.0, -1.2, k), 0, lerp(-0.25, -0.85, k));
      B['faL']!.rotation.x = lerp(-0.5, -0.3, k);
      B['faR']!.rotation.x = lerp(-0.5, -0.3, k);
      B['spine']!.rotation.x = lerp(0.18, 0.32, k);
    } else if (inAir) {
      // 空中张开手臂保持平衡
      B['uaL']!.rotation.set(-0.7, 0, 0.55);
      B['uaR']!.rotation.set(-0.7, 0, -0.55);
    } else if (windK > 0) {
      // 蓄力：弯腰、双臂向后摆
      const k = smoothK(windK, 0, 0.8);
      B['spine']!.rotation.x = 0.55 * k;
      B['uaL']!.rotation.set(0.9 * k, 0, 0.2);
      B['uaR']!.rotation.set(0.9 * k, 0, -0.2);
      B['faL']!.rotation.x = -0.2;
      B['faR']!.rotation.x = -0.2;
    } else if (landK > 0) {
      // 落地缓冲：上身前压、双手往前下方撑一下，再慢慢站起来
      const k = smoothK(landK, 0, 0.5);
      B['spine']!.rotation.x += 0.6 * k;
      B['uaL']!.rotation.set(-1.0 * k, 0, 0.12 + 0.3 * k);
      B['uaR']!.rotation.set(-1.0 * k - 0.2 * (1 - k), 0, -0.14 - 0.3 * k);
      B['faL']!.rotation.x = -0.25 - 0.3 * k;
    }
    if (act && (act.kind === 'chop' || act.kind === 'mine')) {
      // 举起 → 劈下 → 收回
      const up = smoothK(ak, 0, 0.38);
      const down = smoothK(ak, 0.38, 0.52);
      const back = smoothK(ak, 0.6, 1);
      const arm = -0.2 + (-2.8 + 0.2) * up + (2.5) * down;
      B['uaR']!.rotation.set(arm * (1 - back) + -0.2 * back, 0, -0.1);
      B['faR']!.rotation.x = (-0.9 * up + 0.8 * down) * (1 - back) + -0.3 * back;
      B['uaL']!.rotation.set(arm * 0.9 * (1 - back), 0, 0.1);
      B['spine']!.rotation.x += (-0.12 * up + 0.5 * down) * (1 - back);
    } else if (act && act.kind === 'hammer') {
      // 蹲着钉：右手举锤 → 快速敲下；左手扶着木板
      const up = smoothK(ak, 0, 0.42);
      const down = smoothK(ak, 0.42, 0.55);
      B['spine']!.rotation.x += 0.42;
      B['uaR']!.rotation.set(-0.7 - 1.0 * up + 1.0 * down, 0, -0.1);
      B['faR']!.rotation.x = -1.2 * up + 0.9 * down - 0.3;
      B['uaL']!.rotation.set(-1.05, 0, 0.12);
      B['faL']!.rotation.x = -0.35;
    } else if (act && act.kind === 'saw') {
      // 弯腰拉锯：右手前推后拉，左手按住木板
      const s = Math.sin(ak * Math.PI * 2);
      B['spine']!.rotation.x += 0.5;
      B['uaR']!.rotation.set(-0.85 - 0.35 * s, 0, -0.08);
      B['faR']!.rotation.x = -0.9 + 0.45 * s;
      B['uaL']!.rotation.set(-0.95, 0, 0.3);
      B['faL']!.rotation.x = -0.55;
    } else if (act && act.kind === 'pick') {
      const reach = smoothK(ak, 0.1, 0.45) - smoothK(ak, 0.6, 1);
      B['spine']!.rotation.x += 0.5 * reach;
      B['uaR']!.rotation.set(-0.2 - 1.0 * reach, 0, -0.1);
      B['faR']!.rotation.x = -0.4 * reach - 0.2;
      B['uaL']!.rotation.set(-0.5, 0, 0.2);
      B['faL']!.rotation.x = -1.3;
    }
    // 拿着东西：扛木板（右手扶肩上的木板）、捧工具箱（双手在胸前）、举晶体（双手过头）
    for (const [k, o] of this.carried) o.visible = k === this.carry;
    if (this.carry) {
      const o = this.carriedModel(this.carry);
      o.visible = true;
      if (this.carry === 'plank') {
        B['uaR']!.rotation.set(-2.5, 0, -0.25);
        B['faR']!.rotation.x = -1.4;
      } else {
        const up = this.raised ? 1 : 0;
        B['uaL']!.rotation.set(lerp(-0.75, -2.9, up), 0, lerp(0.22, 0.2, up));
        B['uaR']!.rotation.set(lerp(-0.75, -2.9, up), 0, lerp(-0.22, -0.2, up));
        B['faL']!.rotation.x = lerp(-0.75, -0.2, up);
        B['faR']!.rotation.x = lerp(-0.75, -0.2, up);
        // 举起时晶体跟到头顶
        o.position.set(0, up * 0.95, up * -0.18);
      }
    } else if (this.talking && !act && w < 0.2) {
      // 说话：左手在胸前随话比划
      B['uaL']!.rotation.set(-0.55 + Math.sin(t * 2.3) * 0.12, 0, 0.25);
      B['faL']!.rotation.x = -1.05 + Math.sin(t * 3.1) * 0.2;
    }
    B['hips']!.rotation.x = 0;
    if (this.pivot) this.pivot.visible = (this.action === null || this.action.kind === 'pick') && !this.carry;
    // 踉跄：身体随船身左右晃、手臂张开找平衡
    if (this.stagger > 0.001) {
      const k = this.stagger;
      B['spine']!.rotation.z += Math.sin(t * 9) * 0.22 * k;
      B['spine']!.rotation.x += Math.sin(t * 6.3) * 0.12 * k;
      B['uaL']!.rotation.set(lerp(B['uaL']!.rotation.x, -0.9, k), 0, lerp(B['uaL']!.rotation.z, 0.9 + Math.sin(t * 11) * 0.3, k));
      B['uaR']!.rotation.set(lerp(B['uaR']!.rotation.x, -0.9, k), 0, lerp(B['uaR']!.rotation.z, -0.9 - Math.sin(t * 10) * 0.3, k));
      B['hips']!.position.y -= 0.08 * k;
      this.stagger = Math.max(0, this.stagger - dt * 0.6);
    }
    let hy = 0;
    if (this.lookAt) {
      const d = Math.hypot(this.lookAt.x - this.x, this.lookAt.z - this.z);
      if (d < 5) hy = clamp(angDiff(this.yaw, Math.atan2(this.lookAt.x - this.x, this.lookAt.z - this.z)), -1, 1);
    }
    this.headY = lerp(this.headY, hy, Math.min(1, dt * 3));
    B['head']!.rotation.set(0.06 + (this.lookAt ? 0.08 : 0), this.headY, Math.sin(t * 0.7) * 0.04 * (1 - w));
    [B['sc0']!, B['sc1']!, B['sc2']!].forEach((b, i) => {
      const tg = (clamp(this.speed * 0.2, 0, 0.9) + 0.05) * [1, 0.55, 0.45][i]! + Math.sin(t * 10 - i * 1.3) * 0.08 * w;
      this.scv[i]! += ((tg - this.sc[i]!) * 70 - this.scv[i]! * 8) * dt;
      this.sc[i]! += this.scv[i]! * dt;
      b.rotation.x = this.sc[i]!;
    });
    if (this.pivot) {
      // 提灯钟摆
      const acc = (this.speed - this.prevSpeed) / Math.max(dt, 1e-3);
      const yr = angDiff(this.prevYaw, this.yaw) / Math.max(dt, 1e-3);
      const L = this.L;
      L.vx += (-30 * L.ax - 3 * L.vx + acc * 0.55 + Math.sin(this.phase * Math.PI * 4) * 2.2 * w) * dt;
      L.vz += (-30 * L.az - 3 * L.vz - yr * this.speed * 0.35) * dt;
      L.ax = clamp(L.ax + L.vx * dt, -0.9, 0.9);
      L.az = clamp(L.az + L.vz * dt, -0.9, 0.9);
      this.group.updateMatrixWorld(true);
      const qH = new THREE.Quaternion();
      B['hdR']!.getWorldQuaternion(qH);
      const qT = new THREE.Quaternion().setFromEuler(new THREE.Euler(L.ax, 0, L.az));
      qT.premultiply(this.group.quaternion);
      this.pivot.quaternion.copy(qH.invert().multiply(qT));
    }
    this.prevSpeed = this.speed;
    this.prevYaw = this.yaw;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
