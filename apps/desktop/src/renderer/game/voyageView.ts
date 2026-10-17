import { ELEMENT_INFO, type ContentDb } from '@cloudsea/content';
import { clockAt, homeIslandId, islandWorldPos, weatherAt, type Spirit, type WorldState } from '@cloudsea/sim';
import { CreatureView, Environment, setWaterTint, glowTexture, HumanoidView, lookFromSpirit, makeSkiff, nightFactor, type SkiffView } from '@cloudsea/render';
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
 * 镜头（v0.6）：从上船时的跟随机位过渡到云舟后上方，全程朝向目的地、画面里一直有云舟；
 * 降落时过渡到玩家站在甲板上的跟随机位，接着下船。目的岛由远景逐级换成完整场景。
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
  private arriveYaw = 0;

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
    const look = new THREE.Vector3(origin.player.x, origin.player.feetY + 1.15, origin.player.z).add(this.originAt);
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
    const b0p = origin.berth();
    let b1 = dest.berth();
    // 降落朝向（v0.7）：停泊方向的正反两个朝向里，选和来向更接近的那个，直接落下（不再掉头）；
    // 两舷都有登船口，下船时用靠栈桥 / 码头那一舷
    {
      const inDir = new THREE.Vector3(b1.x, 0, b1.z).add(this.destAt).sub(new THREE.Vector3(b0p.x, 0, b0p.z).add(this.originAt)).normalize();
      const fwd = new THREE.Vector3(Math.sin(b1.yaw), 0, Math.cos(b1.yaw));
      const yaw = fwd.dot(inDir) >= 0 ? b1.yaw : b1.yaw + Math.PI;
      dest.setBerthYaw(yaw);
      b1 = dest.berth();
    }
    // 目的岛：玩家先站在停泊云舟的甲板上（降落后从这里下船），镜头对准那里
    dest.placeOnDeck();
    this.arriveYaw = b1.yaw;
    const p0 = new THREE.Vector3(b0.x, b0.y, b0.z).add(this.originAt);
    const p3 = new THREE.Vector3(b1.x, b1.y, b1.z).add(this.destAt);
    // 起飞沿停泊时的船头方向、降落沿目的地停泊的船头方向：上下船时船身朝向和停着的一致
    const dist = p0.distanceTo(p3);
    const out = new THREE.Vector3(Math.sin(b0.yaw), 0, Math.cos(b0.yaw));
    const inn = new THREE.Vector3(Math.sin(b1.yaw), 0, Math.cos(b1.yaw));
    const p1 = p0.clone().addScaledVector(out, Math.min(60, dist * 0.3)).add(new THREE.Vector3(0, 24, 0));
    // 降落：沿停泊朝向滑进来
    const p2 = p3.clone().addScaledVector(inn, -Math.min(70, dist * 0.3)).add(new THREE.Vector3(0, 20, 0));
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

  /**
   * 镜头（v0.6）：云舟后上方、朝向目的地（不切侧面），云舟在画面下三分之一处；
   * 起飞段从上船时的机位过渡过来，降落段过渡到玩家在甲板上的跟随机位。
   */
  private shot(k: number): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const at = this.path.getPoint(k);
    const toDest = this.destAt.clone().sub(at).setY(0);
    const dir = toDest.lengthSq() > 1 ? toDest.normalize() : this.path.getTangent(Math.min(0.999, k)).setY(0).normalize();
    const chase = { pos: at.clone().addScaledVector(dir, -10).add(new THREE.Vector3(0, 4.5, 0)), look: at.clone().addScaledVector(dir, 14).add(new THREE.Vector3(0, -1, 0)) };
    const final = this.dest.followPose();
    const finalPose = { pos: final.pos.clone().add(this.destAt), look: final.look.clone().add(this.destAt) };
    const mix = (a: { pos: THREE.Vector3; look: THREE.Vector3 }, b: { pos: THREE.Vector3; look: THREE.Vector3 }, x: number) => {
      const e = smooth(0, 1, x);
      return { pos: a.pos.clone().lerp(b.pos, e), look: a.look.clone().lerp(b.look, e) };
    };
    if (k < 0.14) return mix(this.startPose, chase, k / 0.14);
    if (k > 0.9) return mix(chase, finalPose, (k - 0.9) / 0.1);
    return chase;
  }

  /** tick：房主当前 tick（快照之间按真实时间外推）。返回航程进度 0..1。 */
  update(dt: number, tick: number): number {
    this.t += dt;
    setWaterTint(null);
    const raw = Math.max(0, Math.min(1, (tick - this.depart) / Math.max(1, this.arrive - this.depart)));
    // 起飞与降落慢、巡航快
    this.k = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const k = this.k;
    const at = this.path.getPoint(k);
    const ahead = this.path.getPoint(Math.min(1, k + 0.01));
    this.skiff.group.position.copy(at);
    if (ahead.distanceToSquared(at) > 1e-6) {
      let yaw = Math.atan2(ahead.x - at.x, ahead.z - at.z);
      const turn = Math.atan2(at.x - this.prev.x, at.z - this.prev.z) - yaw;
      if (k > 0.97) yaw = this.arriveYaw;
      this.skiff.group.rotation.set(0, yaw, THREE.MathUtils.clamp(turn * 2, -0.25, 0.25) * (k > 0.9 ? 0.3 : 1));
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
