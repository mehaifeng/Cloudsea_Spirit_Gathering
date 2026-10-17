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

/** 采集动作（DESIGN 14.3，v0.5）：砍（斧）、凿（镐）、摘（篮子）。 */
export type ActionKind = 'chop' | 'mine' | 'pick';
const ACTION_DURATION = 0.95;
const ACTION_IMPACT = 0.5;

const smoothK = (k: number, a: number, b: number): number => {
  const t = clamp((k - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

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
  /** 水（v0.6）：所在位置的水面高度与水深（由控制器每帧给出；没有水时 depth = 0）。 */
  water = { y: 0, depth: 0 };
  /** 游泳混合 0..1（深水自动切换，平滑过渡）。 */
  swim = 0;
  /** 踉跄 0..1（云舟迫降时随船身摇晃），自动衰减。 */
  stagger = 0;
  private jumpDelay = 0;
  private crouch = 0;
  private crouchV = 0;
  /** 正在做的动作。 */
  private action: { kind: ActionKind; t: number; onImpact: (() => void) | null } | null = null;
  private readonly tools = new Map<string, THREE.Object3D>();

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

  /** 游泳时水深的阈值：超过就游，低于就涉水走。 */
  static readonly SWIM_DEPTH = 1.0;
  /** 游泳时脚底在水面下多深（头和肩露出水面）。 */
  private static readonly SWIM_SINK = 0.95;

  get swimming(): boolean {
    return this.swim > 0.5;
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

  get busy(): boolean {
    return this.action !== null;
  }

  /** 跳：站立、行走、奔跑中都能跳（水平速度由控制器保持）；游泳时不能跳。返回是否起跳。 */
  jump(strength = 4.4): boolean {
    if (this.airborne || this.action || this.swim > 0.3) return false;
    this.jumpDelay = 0.07;
    this.jumpV = strength;
    this.crouchV -= 2.2;
    return true;
  }

  /** 做一个采集动作；onImpact 在工具落下的那一刻调用。 */
  playAction(kind: ActionKind, onImpact: () => void): boolean {
    if (this.action || this.airborne || this.swim > 0.3) return false;
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

  /** 由控制器给出位置 / 朝向 / 速度后，算出姿态。 */
  update(dt: number, t: number, ground: (x: number, z: number) => number): void {
    const gy = ground(this.x, this.z);
    // 水：深水游泳（浮在水面），浅水照常走；切换平滑
    const deep = this.water.depth > HumanoidView.SWIM_DEPTH && this.grounded;
    this.swim = clamp(this.swim + (deep ? dt * 3 : -dt * 3), 0, 1);
    const floatY = this.water.y - HumanoidView.SWIM_SINK;
    const floor = this.swim > 0 ? lerp(gy, Math.max(gy, floatY), smoothK(this.swim, 0, 1)) : gy;
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
        this.crouchV -= Math.min(4, Math.abs(this.vy) * 0.55);
        this.vy = 0;
      }
    } else {
      // 小台阶直接踩上去；游泳切换时平滑过渡
      this.footY = Math.abs(floor - this.lastFloor) < 0.5 ? floor : lerp(this.footY, floor, Math.min(1, dt * 12));
    }
    this.lastFloor = floor;
    const airH = Math.max(0, this.footY - floor);
    this.crouchV += (-90 * this.crouch - 11 * this.crouchV) * dt;
    this.crouch = clamp(this.crouch + this.crouchV * dt, -0.28, 0.08);
    const inAir = airH > 0.02 && !this.grounded;
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
      ak = act.t / ACTION_DURATION;
      if (act.onImpact && ak >= ACTION_IMPACT) {
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
    const hipsY = 0.88 + Math.cos(this.phase * Math.PI * 4) * 0.028 * w * (inAir ? 0 : 1) + Math.min(0, feet[0]!.y, feet[1]!.y) + Math.sin(t * 1.8) * 0.006 * (1 - w) + this.crouch + pickCrouch;
    B['hips']!.position.y = hipsY;
    for (const f of feet) {
      // 空中收腿；地面上按步态踩地
      const target = inAir ? { x: f.lx, y: Math.max(hipsY - 0.62, -airH + 0.06), z: f.L === 'L' ? 0.1 : -0.05 } : { x: f.lx, y: f.y + 0.06 + f.lift, z: f.lz };
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
    if (inAir) {
      // 空中张开手臂保持平衡
      B['uaL']!.rotation.set(-0.7, 0, 0.55);
      B['uaR']!.rotation.set(-0.7, 0, -0.55);
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
    } else if (act && act.kind === 'pick') {
      const reach = smoothK(ak, 0.1, 0.45) - smoothK(ak, 0.6, 1);
      B['spine']!.rotation.x += 0.5 * reach;
      B['uaR']!.rotation.set(-0.2 - 1.0 * reach, 0, -0.1);
      B['faR']!.rotation.x = -0.4 * reach - 0.2;
      B['uaL']!.rotation.set(-0.5, 0, 0.2);
      B['faL']!.rotation.x = -1.3;
    }
    // 游泳：身体前倾、蛙泳划手、腿在后面踢水（与行走姿态按混合度过渡）
    const sw2 = smoothK(this.swim, 0, 1);
    if (sw2 > 0.001) {
      const sp = t * (2.2 + this.speed * 1.4);
      const stroke = Math.sin(sp);
      B['hips']!.rotation.x = 0.95 * sw2;
      B['spine']!.rotation.x = lerp(B['spine']!.rotation.x, -0.25, sw2);
      for (const [L, s] of [['L', 1], ['R', -1]] as const) {
        const ua = B[`ua${L}`]!;
        const fa = B[`fa${L}`]!;
        ua.rotation.set(lerp(ua.rotation.x, -1.45 + stroke * 0.35, sw2), 0, lerp(ua.rotation.z, s * (0.35 + Math.max(0, -stroke) * 0.7), sw2));
        fa.rotation.x = lerp(fa.rotation.x, -0.5 - Math.max(0, stroke) * 0.6, sw2);
        const kick = Math.sin(sp * 2 + (s > 0 ? 0 : Math.PI)) * 0.35;
        B[`th${L}`]!.rotation.set(lerp(B[`th${L}`]!.rotation.x, 0.15 + kick, sw2), 0, 0);
        B[`sh${L}`]!.rotation.x = lerp(B[`sh${L}`]!.rotation.x, 0.35 + kick * 0.5, sw2);
        B[`ft${L}`]!.rotation.x = lerp(B[`ft${L}`]!.rotation.x, 0.9, sw2);
      }
    } else B['hips']!.rotation.x = 0;
    if (this.pivot) this.pivot.visible = this.swim < 0.5 && (this.action === null || this.action.kind === 'pick');
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
