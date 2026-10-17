import { ELEMENT_INFO, type ContentDb } from '@cloudsea/content';
import { clockAt, homeIslandId, islandWorldPos, weatherAt, type Spirit, type WorldState } from '@cloudsea/sim';
import { CreatureView, Environment, glowTexture, HumanoidView, lookFromSpirit, makeSkiff, nightFactor, type SkiffView } from '@cloudsea/render';
import * as THREE from 'three';
import type { ExploreView } from './explore';
import { PLAYER_ID } from './session';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 云舟航行（DESIGN 3.6，v0.5）：沿航线的实时过场。
 * 出发岛与目的岛的场景按真实世界坐标放进同一个场景；云舟沿三次贝塞尔航线飞行，
 * 镜头依次切换：起飞跟拍 → 尾随 → 侧拍 → 高空俯瞰 → 降落。目的岛由远景逐级换成完整场景。
 * 时间轴按房主的 tick 推进（和房主的抵达结算一致）。
 */
export class VoyageView {
  readonly scene = new THREE.Scene();
  private readonly env: Environment;
  private readonly skiff: SkiffView;
  private readonly player: HumanoidView;
  private readonly riders: CreatureView[] = [];
  private readonly orbs: THREE.Sprite[] = [];
  private readonly path: THREE.CubicBezierCurve3;
  private readonly originAt: THREE.Vector3;
  private readonly destAt: THREE.Vector3;
  private readonly startPose: { pos: THREE.Vector3; look: THREE.Vector3 };
  private k = 0;
  private t = 0;
  private destShown = false;
  private readonly glow = glowTexture();
  private readonly prev = new THREE.Vector3();

  constructor(
    private readonly content: ContentDb,
    world: Readonly<WorldState>,
    private readonly origin: ExploreView,
    readonly dest: ExploreView,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly depart: number,
    private arrive: number,
  ) {
    this.env = new Environment(this.scene, { farIslands: false });
    const clock = clockAt(world.tick);
    this.env.setNight(nightFactor(clock.tickOfDay));
    this.env.setWeather(weatherAt(world.seed, 'sunPlains', world.tick), 0);

    const posOf = (id: string) => {
      const p = islandWorldPos(content, id === homeIslandId(PLAYER_ID) ? '' : id);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    this.originAt = posOf(origin.islandId);
    this.destAt = posOf(dest.islandId);

    // 起点镜头：出发岛当前的镜头（换算到世界坐标）
    const look = new THREE.Vector3(origin.player.x, origin.ground(origin.player.x, origin.player.z) + 1.15, origin.player.z).add(this.originAt);
    this.startPose = { pos: camera.position.clone().add(this.originAt), look };

    // 两座岛的场景挂进来；出发岛的玩家与队伍上了云舟，目的岛先藏着（远景代替）
    origin.root.position.copy(this.originAt);
    this.scene.add(origin.root);
    origin.setTravelling(true);
    dest.root.position.copy(this.destAt);
    dest.root.visible = false;
    dest.setTravelling(true);
    for (const d of dest.distant.values()) d.visible = false;
    this.scene.add(dest.root);

    // 航线：出发泊位 → 爬升 → 巡航 → 下降 → 目的泊位
    const b0 = origin.berth();
    const b1 = dest.berth();
    const p0 = new THREE.Vector3(b0.x, b0.y, b0.z).add(this.originAt);
    const p3 = new THREE.Vector3(b1.x, b1.y, b1.z).add(this.destAt);
    const dir = p3.clone().sub(p0).setY(0).normalize();
    const dist = p0.distanceTo(p3);
    const p1 = p0.clone().addScaledVector(dir, Math.min(60, dist * 0.3)).add(new THREE.Vector3(0, 24, 0));
    const p2 = p3.clone().addScaledVector(dir, -Math.min(70, dist * 0.3)).add(new THREE.Vector3(0, 20, 0));
    this.path = new THREE.CubicBezierCurve3(p0, p1, p2, p3);

    // 云舟、玩家、甲板上的絮灵（最多 3 只），其余化为光团
    this.skiff = makeSkiff();
    for (const g of this.skiff.glows) this.env.glowMaterials.add(g);
    this.scene.add(this.skiff.group);
    const c = world.characters[PLAYER_ID]!;
    this.player = new HumanoidView({ ...c.appearance, lantern: true }, this.glow);
    this.skiff.group.add(this.player.group);
    const party = c.party.map((id) => c.spirits[id]).filter((s): s is Spirit => !!s);
    party.slice(0, 3).forEach((s, i) => {
      const v = new CreatureView(lookFromSpirit(content, s));
      const seat = this.skiff.seats[i + 1]!;
      v.setPosition(seat.x, seat.z, 0);
      this.skiff.group.add(v.group);
      this.riders.push(v);
    });
    for (const s of party.slice(3)) {
      const el = content.lines.get(s.genes.lineId)!.element;
      const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: ELEMENT_INFO[el].color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      orb.scale.setScalar(0.9);
      this.scene.add(orb);
      this.orbs.push(orb);
    }
    this.prev.copy(p0);
  }

  /** 房主加速后抵达时间会变。 */
  setArrive(tick: number): void {
    this.arrive = tick;
  }

  get progress(): number {
    return this.k;
  }

  /** 镜头：按航程分段，段与段之间平滑过渡。 */
  private shot(k: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const at = this.path.getPoint(k);
    const tan = this.path.getTangent(Math.min(0.999, k)).setY(0).normalize();
    const side = new THREE.Vector3(-tan.z, 0, tan.x);
    const chase = { pos: at.clone().addScaledVector(tan, -9).add(new THREE.Vector3(0, 4, 0)), look: at.clone().addScaledVector(tan, 6) };
    const profile = { pos: at.clone().addScaledVector(side, 10).addScaledVector(tan, 3).add(new THREE.Vector3(0, 1.5, 0)), look: at.clone().addScaledVector(tan, 2) };
    const high = { pos: at.clone().addScaledVector(side, -14).addScaledVector(tan, -6).add(new THREE.Vector3(0, 16, 0)), look: this.destAt.clone().lerp(at, 0.5) };
    const final = this.dest.followPose();
    const finalPose = { pos: final.pos.clone().add(this.destAt), look: final.look.clone().add(this.destAt) };
    const keys: Array<[number, { pos: THREE.Vector3; look: THREE.Vector3 }]> = [
      [0, this.startPose],
      [0.12, chase],
      [0.35, chase],
      [0.45, profile],
      [0.6, profile],
      [0.7, high],
      [0.82, chase],
      [0.9, chase],
      [1, finalPose],
    ];
    for (let i = 0; i < keys.length - 1; i++) {
      const [ka, a] = keys[i]!;
      const [kb, b] = keys[i + 1]!;
      if (k <= kb) {
        const e = smooth(ka, kb, k);
        return { pos: a.pos.clone().lerp(b.pos, e), look: a.look.clone().lerp(b.look, e) };
      }
    }
    return finalPose;
  }

  /** tick：房主当前 tick（快照之间按真实时间外推）。返回航程进度 0..1。 */
  update(dt: number, tick: number): number {
    this.t += dt;
    const raw = Math.max(0, Math.min(1, (tick - this.depart) / Math.max(1, this.arrive - this.depart)));
    // 起飞与降落慢、巡航快
    this.k = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const k = this.k;
    const at = this.path.getPoint(k);
    const ahead = this.path.getPoint(Math.min(1, k + 0.01));
    this.skiff.group.position.copy(at);
    if (ahead.distanceToSquared(at) > 1e-6) {
      const yaw = Math.atan2(ahead.x - at.x, ahead.z - at.z);
      const turn = Math.atan2(at.x - this.prev.x, at.z - this.prev.z) - yaw;
      this.skiff.group.rotation.set(0, yaw, THREE.MathUtils.clamp(turn * 2, -0.25, 0.25));
    }
    this.prev.copy(at);
    const speed = Math.min(1, Math.sin(Math.PI * raw) * 1.4);
    this.skiff.update(this.t, speed);
    // 甲板上的人与絮灵
    const seat = this.skiff.seats[0]!;
    this.player.setPosition(seat.x, seat.z, 0);
    this.player.speed = 0;
    this.player.update(dt, this.t, () => seat.y);
    for (const r of this.riders) r.update(dt, this.t, () => 0.67);
    this.orbs.forEach((o, i) => {
      const a = this.t * 1.6 + (i / this.orbs.length) * Math.PI * 2;
      o.position.set(at.x + Math.cos(a) * 2.4, at.y + 1.4 + Math.sin(this.t * 2 + i) * 0.3, at.z + Math.sin(a) * 2.4);
    });

    // 目的岛逐级加载：远景 → 完整场景
    if (!this.destShown && k > 0.55) {
      this.destShown = true;
      this.dest.root.visible = true;
      const key = this.dest.isHome ? 'home' : this.dest.islandId;
      const lod = this.origin.distant.get(key);
      if (lod) lod.visible = false;
    }

    const cam = this.shot(k);
    this.camera.position.copy(cam.pos);
    this.camera.lookAt(cam.look);
    this.env.update(dt, this.t, this.camera, at);
    return raw;
  }

  /** 降落完成：目的岛回到自己的场景（原点），镜头换算成本地坐标——画面不跳。 */
  finish(): void {
    this.scene.remove(this.dest.root);
    this.dest.root.position.set(0, 0, 0);
    this.dest.root.visible = true;
    for (const d of this.dest.distant.values()) d.visible = true;
    this.dest.setTravelling(false);
    this.dest.scene.add(this.dest.root);
    this.camera.position.sub(this.destAt);
    this.scene.remove(this.origin.root);
  }

  dispose(): void {
    this.player.dispose();
    for (const r of this.riders) r.dispose();
  }
}
