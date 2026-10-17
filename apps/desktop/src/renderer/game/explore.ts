import { GATHER_YIELD, HOME_CHART_POS, type ContentDb, type Island } from '@cloudsea/content';
import {
  arrivalPoint,
  clockAt,
  worldPosition,
  foundationHeight,
  footprint,
  gatherNodes,
  HOME_DOCK,
  homeIslandId,
  homeTerrain,
  islandTerrain,
  WATER_LEVEL,
  weatherAt,
  type BuildingInstance,
  type GatherNode,
  type Spirit,
  type Terrain,
  type WorldState,
} from '@cloudsea/sim';
import {
  angDiff,
  buildIslandLod,
  buildIslandMesh,
  clamp,
  CreatureView,
  Environment,
  Fx,
  glowTexture,
  HumanoidView,
  lerp,
  lookFromSpirit,
  makeBuildingView,
  makeGatherProp,
  makeGangway,
  makeSkiff,
  setWaterTint,
  SKIFF_DECK_Y,
  SKIFF_GATE,
  skiffCollisionHalfWidth,
  skiffHalfWidth,
  type GangwayView,
  type SkiffView,
  mat,
  nightFactor,
  type BuildingView,
  type PropView,
} from '@cloudsea/render';
import * as THREE from 'three';
import type { Input } from './input';
import { PLAYER_ID } from './session';

export type InteractKind = 'gather' | 'wild' | 'keeper' | 'building' | 'dock' | 'pier' | 'core' | 'starter' | 'pet' | 'recruit';

export interface Interactable {
  readonly kind: InteractKind;
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly label: string;
  readonly radius: number;
}

interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/** 建筑的矩形碰撞（中心 + 半宽 / 半深，已按旋转交换）。 */
interface RectObstacle {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** 矮障碍（围栏、路灯底座）：跳起来能越过。 */
  low?: boolean;
}

/**
 * 可以站上去的平台（v0.6）：码头栈台、登岛栈桥、云舟甲板。
 * 矩形（中心、朝向、半宽、半长）+ 顶面高度。站在顶面附近或从上方落下时算“在平台上”；
 * wall = true 的平台从下面过来是墙（云舟船身），否则是一级台阶（码头）。
 */
interface Platform {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly hw: number;
  readonly hd: number;
  readonly top: number;
  readonly wall: boolean;
  /** 云舟甲板：只能从登船口上下，其余地方被栏杆挡住。 */
  readonly deck?: boolean;
}

/** 脚下离平台顶面多近算“在上面”（台阶高度上限）。 */
const STEP = 0.55;

const HOME_REGION = 'sunPlains' as const;

/** 自动驾驶（上下船、开场跳下云舟）：走到目标点；可在途中起跳。 */
interface Autopilot {
  x: number;
  z: number;
  run: boolean;
  /** 剩余距离小于它时起跳（一次）。 */
  jumpAt?: number | undefined;
  jumpStrength?: number | undefined;
  jumped?: boolean;
  /** 到达后的朝向。 */
  faceYaw?: number | undefined;
  resolve: () => void;
  timeout: number;
}

/** 一座岛的场景：地形、采集点、建筑、野生絮灵、自家絮灵、守岛人、玩家。 */
export class ExploreView {
  readonly scene = new THREE.Scene();
  /** 岛上的一切（地形、建筑、絮灵、玩家、远景岛）；航行时整组挪到世界坐标里（v0.5）。 */
  readonly root = new THREE.Group();
  readonly env: Environment;
  readonly fx: Fx;
  readonly player: HumanoidView;
  readonly islandId: string;
  readonly island: Island | null;
  terrain!: Terrain;
  private islandMesh: THREE.Object3D | null = null;
  private coreLevel = 0;
  private readonly props = new Map<string, { node: GatherNode; view: PropView }>();
  private readonly buildings = new Map<string, { view: BuildingView; key: string; inst: BuildingInstance; foundation: THREE.Mesh | null }>();
  private readonly creatures = new Map<string, { view: CreatureView; home: { x: number; z: number }; kind: 'wild' | 'own' | 'keeper'; timer: number; state: Spirit['state']; aboard: boolean; path: Array<{ x: number; z: number }> }>();
  /** 舷梯（v0.7）：放在哪一舷、水平长度、落差、伸出比例（动画中）与目标。 */
  private gangway: { view: GangwayView; side: 1 | -1; run: number; drop: number; top: number; extend: number; target: number } | null = null;
  private readonly keepers = new Map<string, HumanoidView>();
  private obstacles: Obstacle[] = [];
  private rects: RectObstacle[] = [];
  /** 码头 / 栈桥（静态）与云舟甲板（随云舟摆放）。 */
  private staticPlatforms: Platform[] = [];
  private skiffPlatform: Platform | null = null;
  private readonly glowTex = glowTexture();
  camYaw = 0.45;
  camPitch = 0.42;
  camDist = 10;
  private readonly camT = new THREE.Vector3();
  private moveSentAt = 0;
  private lastSent = { x: 0, z: 0, yaw: 0 };
  nearest: Interactable | null = null;
  /** 播片期间由播片控制镜头。 */
  cameraLocked = false;
  /** 停在码头 / 栈桥边的云舟；家园岛在引导前三步是失事的残骸。 */
  private skiff: { view: SkiffView; wrecked: boolean } | null = null;
  /** 失事残骸停下的位置与朝向（开场迫降的终点）。 */
  static readonly WRECK = { x: 3.5, z: 11, yaw: 0.9 + Math.PI } as const;
  /** 停泊位置（相对码头 / 登岛点）：船身连推进舱都不压到码头 / 栈桥上。 */
  static readonly BERTH_HOME = { dx: 3.65, dz: 1.6 } as const;
  static readonly BERTH_PIER = { dx: 2.5, dz: 2.6 } as const;
  /** 迫降在地上划出的土痕。 */
  private trench: THREE.Mesh | null = null;
  private interactables: Interactable[] = [];
  /** 额外的交互点（新手引导用）。 */
  extraInteractables: Interactable[] = [];
  private t = 0;
  private autopilot: Autopilot | null = null;
  /** 乘着一个移动的物体（开场迫降时站在云舟甲板上）：每帧把玩家放到它的座位上。 */
  private riding: { group: THREE.Object3D; seat: THREE.Vector3; yaw: number } | null = null;
  /** 发光的云气团（引导第 1 步，第一只絮灵）。 */
  private orb: THREE.Group | null = null;
  /** 只做表现的临时絮灵（例如首战前冲过来的蚀化絮灵）。 */
  private readonly actors = new Map<string, CreatureView>();
  /** 水波纹（v0.7）：游泳 / 涉水时在水面上扩散的圆环。 */
  private readonly ripples: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private rippleTimer = 0;
  /** 队伍里有受伤的絮灵（核心塔附近会冒治疗光点）。 */
  private partyHurt = false;
  private lastSwim = 0;
  /** 从混沌迷雾中凝聚出来的临时絮灵（v0.7）：进度 0..1，凝聚完成后回调。 */
  private readonly mists = new Map<string, { t: number; dur: number; x: number; z: number; done: (() => void) | null }>();

  /** 远景岛：岛 id（家园岛用 'home'）→ 模型。航行时目的地的远景会被完整场景替换。 */
  readonly distant = new Map<string, THREE.Object3D>();

  constructor(
    private readonly content: ContentDb,
    world: Readonly<WorldState>,
    private readonly camera: THREE.PerspectiveCamera,
    /** 指定岛（航行时提前搭建目的地）；省略 = 玩家所在的岛。 */
    islandId?: string,
    /** 指定玩家出现的位置（航行目的地的降落点）。 */
    spawn?: { x: number; z: number; yaw: number },
  ) {
    const p = world.players[PLAYER_ID]!;
    this.islandId = islandId ?? p.islandId;
    this.island = content.islands.get(this.islandId) ?? null;
    this.scene.add(this.root);
    this.env = new Environment(this.scene, { farIslands: false });
    this.fx = new Fx(this.scene);
    const c = world.characters[PLAYER_ID]!;
    this.player = new HumanoidView({ ...c.appearance, lantern: true }, this.glowTex);
    const at = spawn ?? { x: p.x, z: p.z, yaw: p.yaw };
    this.player.setPosition(at.x, at.z, at.yaw);
    this.root.add(this.player.group);
    this.lastSent = { x: p.x, z: p.z, yaw: p.yaw };
    this.rebuildTerrain(world);
    this.addDistantIslands(world);
    this.camT.set(at.x, this.terrain.height(at.x, at.z) + 1.15, at.z);
    this.camYaw = at.yaw + Math.PI;
    this.sync(world);
  }

  get isHome(): boolean {
    return this.islandId === homeIslandId(PLAYER_ID);
  }

  /** 地形高度（不含平台）。 */
  ground = (x: number, z: number): number => this.terrain.height(x, z);

  private get platforms(): Platform[] {
    return this.skiffPlatform ? [...this.staticPlatforms, this.skiffPlatform] : this.staticPlatforms;
  }

  /** 点在平台矩形里时返回局部坐标。 */
  private platformLocal(pl: Platform, x: number, z: number, margin = 0): { lx: number; lz: number } | null {
    const dx = x - pl.x;
    const dz = z - pl.z;
    const c = Math.cos(pl.yaw);
    const s = Math.sin(pl.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) > pl.hw + margin || Math.abs(lz) > pl.hd + margin) return null;
    return { lx, lz };
  }

  /** 云舟甲板上某点是否在船舷之内（船头船尾收窄）。 */
  private onDeck(pl: Platform, lx: number, lz: number): boolean {
    return Math.abs(lx) < skiffHalfWidth(lz) - 0.05;
  }

  /** 给定脚底高度时的“地面”：地形与脚下附近的平台顶面取高者。 */
  groundAt(x: number, z: number, feet: number): number {
    let h = this.terrain.height(x, z);
    for (const pl of this.platforms) {
      if (pl.top <= h || pl.top - feet > STEP) continue;
      // 甲板只能从上面落下来或本来就站在上面（不能从船舷外直接走上去）
      if (pl.deck && feet < pl.top - 0.05) continue;
      const l = this.platformLocal(pl, x, z);
      if (!l) continue;
      if (pl.deck && !this.onDeck(pl, l.lx, l.lz)) continue;
      h = pl.top;
    }
    const r = this.rampHeight(x, z);
    if (r !== null && Math.abs(r - feet) < STEP) h = Math.max(h, r);
    return h;
  }

  /** 舷梯上某点的高度（放下时）；不在舷梯上返回 null。 */
  private rampHeight(x: number, z: number): number | null {
    const g = this.gangway;
    if (!g || g.extend < 0.95 || !this.skiff) return null;
    const grp = this.skiff.view.group;
    const yaw = grp.rotation.y;
    const dx = x - grp.position.x;
    const dz = z - grp.position.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const gz = (SKIFF_GATE.z0 + SKIFF_GATE.z1) / 2;
    if (Math.abs(lz - gz) > 0.42) return null;
    const a = lx * g.side - (skiffHalfWidth(gz) - 0.02);
    if (a < -0.25 || a > g.run + 0.05) return null;
    return g.top - g.drop * Math.max(0, Math.min(1, a / g.run));
  }

  /** 玩家用的地面（考虑平台、乘坐）。 */
  private readonly playerGround = (x: number, z: number): number => {
    if (this.riding) return this.ridingY();
    return this.groundAt(x, z, this.player.feetY);
  };

  /** 絮灵用的地面：矮平台（码头、栈桥）、上了船的站在甲板上，深水里浮在水面。 */
  private creatureGround(aboard: boolean): (x: number, z: number) => number {
    return (x, z) => {
      let h = this.terrain.height(x, z);
      if (this.terrain.isWater(x, z) && WATER_LEVEL - h > 0.35) h = WATER_LEVEL - 0.3;
      for (const pl of this.platforms) {
        if (pl.wall && !aboard) continue;
        const l = this.platformLocal(pl, x, z);
        if (l && (!pl.deck || this.onDeck(pl, l.lx, l.lz))) h = Math.max(h, pl.top);
      }
      const r = aboard ? this.rampHeight(x, z) : null;
      if (r !== null) h = Math.max(h, r);
      return h;
    };
  }

  private rebuildTerrain(world: Readonly<WorldState>): void {
    if (this.islandMesh) {
      this.root.remove(this.islandMesh);
    }
    if (this.isHome) {
      const home = world.homes[PLAYER_ID]!;
      this.coreLevel = home.coreLevel;
      this.terrain = homeTerrain(home.seed, home.coreLevel);
      const W = ExploreView.WRECK;
      this.islandMesh = buildIslandMesh(this.terrain, {
        grassHue: 0.25,
        clear: (x, z) => Math.hypot(x, z) < 2.5 || Math.hypot(x - HOME_DOCK.x, z - HOME_DOCK.z) < 2.5 || Math.hypot(x - W.x, z - W.z) < 3 || Math.hypot(x - HOME_DOCK.x - ExploreView.BERTH_HOME.dx, z - HOME_DOCK.z - ExploreView.BERTH_HOME.dz) < 3,
      });
    } else {
      this.terrain = islandTerrain(this.island!);
      const a = arrivalPoint(this.island!);
      this.islandMesh = buildIslandMesh(this.terrain, {
        grassHue: this.island!.fogLevel >= 2 ? 0.3 : this.island!.kind === 'keeper' ? 0.2 : 0.24,
        clear: (x, z) => Math.hypot(x - a.x, z - a.z) < 3 || Math.hypot(x - a.x - ExploreView.BERTH_PIER.dx, z - a.z - ExploreView.BERTH_PIER.dz) < 3,
      });
      if (this.props.size === 0) {
        for (const node of gatherNodes(this.island!)) {
          const view = makeGatherProp(node.kind, hashId(node.id));
          view.group.position.set(node.x, this.terrain.height(node.x, node.z) - 0.05, node.z);
          view.group.rotation.y = hashId(node.id) % 6;
          this.root.add(view.group);
          this.props.set(node.id, { node, view });
        }
        this.buildPier(a);
        if (this.island!.keeper) this.buildKeeperHome(this.island!.keeper);
      }
    }
    this.root.add(this.islandMesh);
  }

  /** 登岛栈桥：木板 + 两侧桩子，可以走上去；云舟停在它右边（v0.6）。 */
  private buildPier(a: { x: number; z: number }): void {
    const pier = new THREE.Group();
    const base = this.terrain.height(a.x, a.z + 2);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.4), mat(i % 2 ? 0x9a6a43 : 0x8a5f40));
      plank.position.set(0, 0.12, 0.6 + i * 0.45);
      plank.receiveShadow = true;
      plank.castShadow = true;
      pier.add(plank);
    }
    for (const sx of [-1, 1]) {
      for (const z of [0.5, 3.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), mat(0x6b4a35));
        post.position.set(sx * 0.85, 0.3, z);
        post.castShadow = true;
        pier.add(post);
        this.obstacles.push({ x: a.x + sx * 0.85, z: a.z + z, r: 0.12 });
      }
      // 桥面下的横梁，接到地面
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 3.1), mat(0x6b4a35));
      beam.position.set(sx * 0.7, -0.05, 1.95);
      pier.add(beam);
    }
    pier.position.set(a.x, base, a.z);
    this.root.add(pier);
    this.staticPlatforms.push({ x: a.x, z: a.z + 1.95, yaw: 0, hw: 0.8, hd: 1.6, top: base + 0.17, wall: false });
  }

  private placeSkiff(wrecked: boolean): void {
    if (this.skiff) this.root.remove(this.skiff.view.group);
    if (this.trench) {
      this.root.remove(this.trench);
      this.trench = null;
    }
    const view = makeSkiff({ wrecked, seed: 11 });
    for (const g of view.glows) this.env.glowMaterials.add(g);
    let x: number;
    let z: number;
    let yaw: number;
    let lift: number;
    if (wrecked) {
      ({ x, z, yaw } = ExploreView.WRECK);
      lift = -0.18;
    } else if (this.isHome) {
      x = HOME_DOCK.x + ExploreView.BERTH_HOME.dx;
      z = HOME_DOCK.z + ExploreView.BERTH_HOME.dz;
      yaw = 0;
      lift = 0.4;
    } else {
      const a = arrivalPoint(this.island!);
      x = a.x + ExploreView.BERTH_PIER.dx;
      z = a.z + ExploreView.BERTH_PIER.dz;
      yaw = 0;
      lift = 0.4;
    }
    const y = Math.max(this.terrain.height(x, z), wrecked ? -10 : 0) + lift;
    view.group.position.set(x, y, z);
    view.group.rotation.set(wrecked ? -0.05 : 0, yaw, wrecked ? 0.1 : 0, 'YXZ');
    this.root.add(view.group);
    this.skiff = { view, wrecked };
    this.skiffPlatform = { x, z, yaw, hw: 1.7, hd: 2.6, top: y + SKIFF_DECK_Y, wall: true, deck: true };
    if (wrecked) this.buildTrench();
  }

  /** 迫降的土痕：从触地点到残骸，一条压进草地的深色沟（v0.6）。progress 控制长出来多少。 */
  private buildTrench(): void {
    const W = ExploreView.WRECK;
    const len = ExploreView.SLIDE;
    const fx = Math.sin(W.yaw);
    const fz = Math.cos(W.yaw);
    const segs = 24;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const d = -len + (len * i) / segs - 1.2;
      const cx = W.x + fx * d;
      const cz = W.z + fz * d;
      const w = 0.55 + 0.25 * Math.sin((i / segs) * Math.PI);
      for (const s of [-1, 0, 1]) {
        const x = cx + fz * w * s;
        const z = cz - fx * w * s;
        pos.push(x, this.terrain.height(x, z) + (s === 0 ? -0.02 : 0.03), z);
      }
      if (i < segs) {
        const b = i * 3;
        idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.trench = new THREE.Mesh(geo, mat(0x7a5236, { polygonOffset: true, polygonOffsetFactor: -2 }));
    this.trench.receiveShadow = true;
    this.root.add(this.trench);
    this.setTrenchProgress(1);
  }

  /** 迫降滑行的距离（米）。 */
  static readonly SLIDE = 9;

  setTrenchProgress(k: number): void {
    if (!this.trench) return;
    const segs = 24;
    this.trench.geometry.setDrawRange(0, Math.round(clamp(k, 0, 1) * segs) * 12);
    this.trench.visible = k > 0.01;
  }

  /** 失事云舟（开场播片用）。 */
  get skiffView(): SkiffView | null {
    return this.skiff?.view ?? null;
  }

  /** 航行时：藏起岛上的玩家与跟随的队伍絮灵、停着的云舟（它们在飞行的云舟上）。 */
  setTravelling(travelling: boolean): void {
    this.player.group.visible = !travelling;
    for (const e of this.creatures.values()) if (e.kind === 'own' && e.state === 'party') e.view.group.visible = !travelling;
    if (this.skiff && !this.skiff.wrecked) this.skiff.view.group.visible = !travelling;
  }

  /** 云舟停泊处（本岛局部坐标）与船头朝向，航行的起点 / 终点。 */
  berth(): { x: number; y: number; z: number; yaw: number } {
    const g = this.skiff?.view.group;
    return g ? { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y } : { x: 0, y: 0, z: 0, yaw: 0 };
  }

  setSkiffVisible(visible: boolean): void {
    if (this.skiff) this.skiff.view.group.visible = visible;
  }

  keeperView(id: string): HumanoidView | undefined {
    return this.keepers.get(id);
  }

  /** 远处的浮岛 = 星图上的其他岛，按世界布局摆在真实的相对位置（DESIGN 3.6，v0.5）。 */
  private addDistantIslands(world: Readonly<WorldState>): void {
    const here = worldPosition(this.island, HOME_CHART_POS);
    const place = (key: string, terrain: Terrain, pos: { x: number; y: number; z: number }, seed: number) => {
      const dx = pos.x - here.x;
      const dz = pos.z - here.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1) return;
      const lod = buildIslandLod(terrain, dist < 260 ? 'mid' : 'far', seed);
      lod.position.set(dx, pos.y - here.y, dz);
      this.root.add(lod);
      this.distant.set(key, lod);
    };
    for (const isl of this.content.islands.values()) {
      if (isl.id === this.islandId) continue;
      place(isl.id, islandTerrain(isl), worldPosition(isl, HOME_CHART_POS), isl.seed);
    }
    if (!this.isHome) {
      const home = world.homes[PLAYER_ID]!;
      place('home', homeTerrain(home.seed, home.coreLevel), { x: 0, y: 0, z: 0 }, home.seed);
    }
  }

  /** 守岛人岛的房子与陈设（守岛人岛本身是抽象模拟，到访时按规则实例化，DESIGN 11.7）。 */
  private buildKeeperHome(keeperId: string): void {
    const layout: Array<[string, number, number, number, number]> =
      keeperId === 'aHe'
        ? [['nest', -5, -4, 3, 3], ['workshop', 4.5, -5, 5, 4], ['field', -7.5, 2, 3, 3], ['field', -4, 2, 3, 3], ['field', -7.5, 5.5, 3, 3], ['lamp', 0, -2, 1, 1], ['flowerbed', 2, 3, 1, 1]]
        : [['nest', -4, -4.5, 3, 3], ['lamp', -1.5, 1.5, 1, 1], ['lamp', 3.5, 1.5, 1, 1], ['lamp', 1, -3, 1, 1], ['fence', 5.5, -2, 1, 1], ['fence', 5.5, -1, 1, 1], ['fence', 5.5, 0, 1, 1], ['storage', 4, -6, 4, 3]];
    for (const [type, x, z, w, d] of layout) {
      const v = makeBuildingView(type, w, d, hashId(`${keeperId}:${x}:${z}`));
      v.group.position.set(x, this.terrain.height(x, z), z);
      v.update({ built: true, progress: 1, crop: type === 'field' ? { id: 'sunWheat', growth: 0.6 + (Math.abs(x) % 1) * 0.4 } : null, working: true }, 0);
      for (const g of v.glows) this.env.glowMaterials.add(g);
      this.root.add(v.group);
      if (type === 'field' || type === 'flowerbed') continue;
      this.rects.push({ x, z, hw: w / 2 - 0.15, hd: d / 2 - 0.15, low: type === 'fence' });
    }
  }

  /** 发光的云气团：光晕 + 小小的晶核 + 绕着转的光点 + 点光源（v0.6：场景里真实存在，开场镜头指向它）。 */
  private ensureOrb(want: boolean): void {
    if (want && !this.orb) {
      const g = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffe2a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(2.2);
      g.add(halo);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffc46a, emissiveIntensity: 1.2, flatShading: true });
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), coreMat);
      g.add(core);
      for (let i = 0; i < 6; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd59a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.scale.setScalar(0.28);
        sp.userData['i'] = i;
        g.add(sp);
      }
      const light = new THREE.PointLight(0xffc46a, 2.2, 6, 1.6);
      g.add(light);
      g.userData['core'] = core;
      this.root.add(g);
      this.orb = g;
    } else if (!want && this.orb) {
      this.root.remove(this.orb);
      this.orb = null;
    }
  }

  /** 云气团的位置（引导第 1 步）。 */
  static readonly ORB = { x: 2.5, z: 4.5 } as const;

  orbPos(): THREE.Vector3 {
    const O = ExploreView.ORB;
    return new THREE.Vector3(O.x, this.terrain.height(O.x, O.z) + 0.9, O.z);
  }

  /** 用房主快照刷新场景里的东西（增删改）。 */
  sync(world: Readonly<WorldState>): void {
    const c = world.characters[PLAYER_ID]!;
    // 天气与时间
    const region = this.island?.region ?? HOME_REGION;
    const weather = weatherAt(world.seed, region, world.tick);
    this.env.setWeather(weather, this.island?.fogLevel ?? 0);
    const clock = clockAt(world.tick);
    const n = nightFactor(clock.tickOfDay);
    this.env.setNight(n);
    this.player.setNight(n);

    // 云舟：家园岛在引导前三步是残骸（被商队修好之前），之后停在码头边
    const wantWreck = this.isHome && !c.tutorial.done && c.tutorial.step < 3;
    if (!this.skiff || this.skiff.wrecked !== wantWreck) this.placeSkiff(wantWreck);
    this.ensureOrb(this.isHome && !c.tutorial.done && c.tutorial.step <= 1 && Object.keys(c.spirits).length === 0);

    if (this.isHome) {
      const home = world.homes[PLAYER_ID]!;
      if (home.coreLevel !== this.coreLevel) this.rebuildTerrain(world);
      this.syncBuildings(world);
    } else if (this.island) {
      const rt = world.islands[this.island.id];
      for (const { node, view } of this.props.values()) view.setAvailable((rt?.nodes[node.id] ?? 0) <= world.tick);
    }

    // 絮灵：野生 / 自家 / 守岛人的
    const want = new Map<string, { spirit: Spirit; kind: 'wild' | 'own' | 'keeper'; x: number; z: number }>();
    if (this.island?.kind === 'fixed') {
      for (const w of Object.values(world.islands[this.island.id]?.wild ?? {})) want.set(w.id, { spirit: w.group[0]!, kind: 'wild', x: w.x, z: w.z });
    }
    const followers = c.party.map((id) => c.spirits[id]).filter((s): s is Spirit => !!s).slice(0, 3);
    followers.forEach((s, i) => want.set(s.id, { spirit: s, kind: 'own', x: this.player.x + (i - 1) * 1.2, z: this.player.z - 1.5 }));
    if (this.isHome) {
      const home = world.homes[PLAYER_ID]!;
      for (const s of Object.values(c.spirits)) {
        if (s.state === 'idle') want.set(s.id, { spirit: s, kind: 'own', x: ((hashId(s.id) % 9) - 4) * 0.9, z: ((hashId(s.id + 'z') % 9) - 4) * 0.9 });
        if (s.state === 'working') {
          const b = Object.values(home.buildings).find((x) => x.workers.includes(s.id));
          if (b) {
            const def = this.content.buildings.get(b.type)!;
            const fp = footprint(def, b.rot);
            want.set(s.id, { spirit: s, kind: 'own', x: b.x + fp.w / 2 + 0.8, z: b.z + fp.d + 0.4 });
          }
        }
      }
    }
    // 守岛人
    const keeperHere = this.island?.keeper ?? null;
    const visitors = Object.values(world.keepers).filter((k) => k.visiting?.playerId === PLAYER_ID && this.isHome).map((k) => k.id);
    const keeperIds = [...(keeperHere ? [keeperHere] : []), ...visitors];
    for (const kid of keeperIds) {
      const k = world.keepers[kid]!;
      const base = keeperHere === kid ? { x: 1.5, z: 0 } : { x: HOME_DOCK.x + 2.5, z: HOME_DOCK.z - 3 };
      k.spirits.slice(0, 2).forEach((s, i) => want.set(`${kid}:${s.id}`, { spirit: s, kind: 'keeper', x: base.x + (i ? 1.5 : -1.5), z: base.z + 1 }));
      if (!this.keepers.has(kid)) {
        const def = this.content.keepers.get(kid)!;
        const v = new HumanoidView({ ...def.appearance });
        v.setPosition(base.x, base.z, Math.PI);
        this.root.add(v.group);
        this.keepers.set(kid, v);
      }
    }
    for (const [kid, v] of this.keepers) {
      if (!keeperIds.includes(kid)) {
        this.root.remove(v.group);
        v.dispose();
        this.keepers.delete(kid);
      }
    }

    for (const [id, entry] of this.creatures) {
      const w = want.get(id);
      const stale = !w || (w.kind === 'own' && (w.spirit.blighted !== entry.view.look.blighted || lookKey(this.content, w.spirit) !== lookKeyOf(entry.view)));
      if (stale) {
        this.root.remove(entry.view.group);
        entry.view.dispose();
        this.creatures.delete(id);
      } else if (w) entry.state = w.spirit.state;
    }
    for (const [id, w] of want) {
      if (this.creatures.has(id)) {
        const e = this.creatures.get(id)!;
        if (w.kind === 'own') e.home = { x: w.x, z: w.z };
        continue;
      }
      const view = new CreatureView(lookFromSpirit(this.content, w.spirit));
      (view as unknown as { lookKey: string }).lookKey = lookKey(this.content, w.spirit);
      const spawnX = w.kind === 'own' && c.party.includes(w.spirit.id) ? this.player.x + (Math.random() - 0.5) * 2 : w.x;
      const spawnZ = w.kind === 'own' && c.party.includes(w.spirit.id) ? this.player.z - 1 : w.z;
      view.setPosition(spawnX, spawnZ, Math.random() * 6);
      this.root.add(view.group);
      this.creatures.set(id, { view, home: { x: w.x, z: w.z }, kind: w.kind, timer: Math.random() * 3, state: w.spirit.state, aboard: false, path: [] });
    }

    this.partyHurt = c.party.some((id) => !!c.spirits[id]?.condition);

    // 可交互对象
    const list: Interactable[] = [];
    if (this.island) {
      const rt = world.islands[this.island.id];
      for (const { node } of this.props.values()) {
        if ((rt?.nodes[node.id] ?? 0) > world.tick) continue;
        list.push({ kind: 'gather', id: node.id, x: node.x, z: node.z, label: `采集 ${this.content.items.get(GATHER_YIELD[node.kind].item)!.name}`, radius: 2.2 });
      }
      for (const w of Object.values(rt?.wild ?? {})) {
        const v = this.creatures.get(w.id)?.view;
        const name = this.content.forms.get(w.group[0]!.formId)!.form.name;
        list.push({ kind: 'wild', id: w.id, x: v?.x ?? w.x, z: v?.z ?? w.z, label: `${w.blighted ? '蚀化的' : '野生的'}${name} Lv.${w.group[0]!.level}${w.group.length > 1 ? ` 等 ${w.group.length} 只` : ''}`, radius: 2.4 });
      }
      const a = arrivalPoint(this.island);
      list.push({ kind: 'pier', id: 'pier', x: a.x, z: a.z + 1.9, label: '栈桥 · 出航', radius: 2.2 });
    }
    for (const [kid, v] of this.keepers) list.push({ kind: 'keeper', id: kid, x: v.x, z: v.z, label: `和${this.content.keepers.get(kid)!.name}说话`, radius: 2.4 });
    for (const [id, e] of this.creatures) {
      if (e.kind !== 'own') continue;
      const s = c.spirits[id];
      if (!s) continue;
      const name = s.nickname ?? this.content.forms.get(s.formId)!.form.name;
      // 队伍里的：抚摸；家里闲着 / 打工的：直接带上（等同菜单里的“加入队伍”）
      if (s.state === 'party') list.push({ kind: 'pet', id, x: e.view.x, z: e.view.z, label: `抚摸 ${name}`, radius: 1.6 });
      else list.push({ kind: 'recruit', id, x: e.view.x, z: e.view.z, label: s.state === 'working' ? `带上 ${name}（停下手里的活）` : `带上 ${name}`, radius: 1.6 });
    }
    if (this.isHome) {
      for (const { inst } of this.buildings.values()) {
        const def = this.content.buildings.get(inst.type)!;
        if (def.kind === 'decoration') continue;
        const fp = footprint(def, inst.rot);
        const kind: InteractKind = def.kind === 'dock' ? 'dock' : def.kind === 'core' ? 'core' : 'building';
        list.push({ kind, id: inst.id, x: inst.x + fp.w / 2, z: inst.z + fp.d / 2, label: def.kind === 'dock' ? '码头 · 订单 / 商队 / 出航' : def.kind === 'core' ? '岛核' : `${def.name}${inst.built ? '' : '（建造中）'}`, radius: Math.max(fp.w, fp.d) / 2 + 1.4 });
      }
    }
    this.interactables = list;
  }

  private syncBuildings(world: Readonly<WorldState>): void {
    const home = world.homes[PLAYER_ID]!;
    const seen = new Set<string>();
    this.rects = [];
    this.staticPlatforms = [];
    this.obstacles = [];
    for (const inst of Object.values(home.buildings)) {
      seen.add(inst.id);
      const def = this.content.buildings.get(inst.type)!;
      const fp = footprint(def, inst.rot);
      const key = `${inst.type}:${inst.x}:${inst.z}:${inst.rot}:${this.coreLevel}`;
      let entry = this.buildings.get(inst.id);
      const y = foundationHeight(this.content, home, inst);
      if (!entry || entry.key !== key) {
        if (entry) {
          this.root.remove(entry.view.group);
          if (entry.foundation) this.root.remove(entry.foundation);
        }
        const view = makeBuildingView(inst.type, def.size.w, def.size.d, hashId(inst.id));
        view.group.position.set(inst.x + fp.w / 2, y, inst.z + fp.d / 2);
        view.group.rotation.y = -inst.rot * (Math.PI / 2);
        this.root.add(view.group);
        for (const g of view.glows) this.env.glowMaterials.add(g);
        // 地基：建筑占地四角的最高点，石砌填到地形（DESIGN 7）
        const low = Math.min(this.terrain.height(inst.x, inst.z), this.terrain.height(inst.x + fp.w, inst.z), this.terrain.height(inst.x, inst.z + fp.d), this.terrain.height(inst.x + fp.w, inst.z + fp.d));
        let foundation: THREE.Mesh | null = null;
        if (y - low > 0.08 && def.kind !== 'decoration') {
          foundation = new THREE.Mesh(new THREE.BoxGeometry(fp.w, y - low + 0.2, fp.d), mat(0xa49a90));
          foundation.position.set(inst.x + fp.w / 2, (y + low) / 2 - 0.1, inst.z + fp.d / 2);
          foundation.receiveShadow = true;
          this.root.add(foundation);
        }
        entry = { view, key, inst, foundation };
        this.buildings.set(inst.id, entry);
      }
      entry.inst = inst;
      const crop = inst.crop ? { id: inst.crop.cropId, growth: inst.crop.progress / this.content.crops.get(inst.crop.cropId)!.growTicks } : null;
      entry.view.update({ built: inst.built, progress: def.buildWork ? inst.buildProgress / def.buildWork : 1, crop, working: !!inst.job && inst.workers.length > 0 }, this.t);
      const cx = inst.x + fp.w / 2;
      const cz = inst.z + fp.d / 2;
      if (def.kind === 'dock') {
        // 码头栈台可以走上去（一级台阶）；立柱、订单板亭、灯柱是细障碍（v0.6）
        this.staticPlatforms.push({ x: cx, z: cz, yaw: 0, hw: fp.w / 2, hd: fp.d / 2, top: y + 0.25, wall: false });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.obstacles.push({ x: cx + (sx * (fp.w - 0.3)) / 2, z: cz + (sz * (fp.d - 0.3)) / 2, r: 0.12 });
        for (const sx of [-1, 1]) this.obstacles.push({ x: cx - fp.w / 2 + 0.8 + sx * 0.6, z: cz - fp.d / 2 + 0.6, r: 0.1 });
        this.obstacles.push({ x: cx + fp.w / 2 - 0.3, z: cz - fp.d / 2 + 0.3, r: 0.08 });
        continue;
      }
      if (def.kind === 'field' || inst.type === 'path' || inst.type === 'flowerbed') continue;
      if (inst.type === 'fence') this.rects.push({ x: cx, z: cz, hw: 0.5, hd: 0.12, low: true });
      else if (inst.type === 'lamp') this.rects.push({ x: cx, z: cz, hw: 0.2, hd: 0.2 });
      else if (def.kind !== 'decoration') this.rects.push({ x: cx, z: cz, hw: fp.w / 2 - 0.15, hd: fp.d / 2 - 0.15 });
    }
    for (const [id, e] of this.buildings) {
      if (seen.has(id)) continue;
      this.root.remove(e.view.group);
      if (e.foundation) this.root.remove(e.foundation);
      this.buildings.delete(id);
    }
  }

  // ---------------------------------------------------------------- 乘坐 / 自动驾驶（播片与上下船）

  private ridingY(): number {
    const r = this.riding!;
    return r.group.localToWorld(r.seat.clone()).y - this.root.position.y;
  }

  /** 站在一个移动的物体上（例如迫降中的云舟甲板）。seat 为该物体的局部坐标。 */
  ride(group: THREE.Object3D, seat: THREE.Vector3, yaw = 0): void {
    this.riding = { group, seat: seat.clone(), yaw };
    this.player.speed = 0;
  }

  /** 下来：玩家留在当前位置，之后按普通物理（落到甲板 / 地面）。 */
  unride(): void {
    this.riding = null;
  }

  /** 让玩家自动走到某点（可选：途中起跳、到达后转向）。超时则直接放到目标点。 */
  walkTo(x: number, z: number, opts: { run?: boolean; jumpAt?: number; jumpStrength?: number; faceYaw?: number; timeout?: number } = {}): Promise<void> {
    this.autopilot?.resolve();
    return new Promise((resolve) => {
      this.autopilot = { x, z, run: !!opts.run, jumpAt: opts.jumpAt, jumpStrength: opts.jumpStrength, faceYaw: opts.faceYaw, resolve, timeout: opts.timeout ?? 6 };
    });
  }

  /** 取消自动驾驶（跳过播片时）。 */
  cancelWalk(): void {
    const ap = this.autopilot;
    this.autopilot = null;
    ap?.resolve();
  }

  get scripted(): boolean {
    return !!this.autopilot || !!this.riding;
  }

  /** 云舟局部坐标 → 本岛坐标。 */
  private skiffToLocal(lx: number, lz: number): { x: number; z: number } {
    const g = this.skiff!.view.group;
    const yaw = g.rotation.y;
    return { x: g.position.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z: g.position.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz };
  }

  private skiffYaw(): number {
    return this.skiff?.view.group.rotation.y ?? 0;
  }

  /** 放舷梯的一舷（v0.7）：两舷都有登船口，选外侧落在码头 / 栈桥上（或离它最近）的那一舷。 */
  private chooseGateSide(): 1 | -1 {
    const gz = (SKIFF_GATE.z0 + SKIFF_GATE.z1) / 2;
    const hw = skiffHalfWidth(gz);
    let best: 1 | -1 = -1;
    let bestScore = Infinity;
    for (const side of [-1, 1] as const) {
      const p = this.skiffToLocal(side * (hw + 1.4), gz);
      let score = Math.hypot(p.x, p.z) * 0.01; // 没有码头时：朝岛内那一侧
      if (this.staticPlatforms.length) {
        score = Math.min(...this.staticPlatforms.map((pl) => (this.platformLocal(pl, p.x, p.z) ? 0 : Math.hypot(p.x - pl.x, p.z - pl.z))));
      }
      if (score < bestScore) {
        bestScore = score;
        best = side;
      }
    }
    return best;
  }

  /** 舷梯相关的点（本岛坐标）：舷梯脚外侧、舷梯脚、登船口内（甲板上）、船头座位。 */
  boardingPoints(side: 1 | -1 = this.gangway?.side ?? this.chooseGateSide()): { approach: { x: number; z: number }; foot: { x: number; z: number }; inside: { x: number; z: number }; seat: { x: number; z: number } } {
    const gz = (SKIFF_GATE.z0 + SKIFF_GATE.z1) / 2;
    const hw = skiffHalfWidth(gz);
    const run = this.gangway?.run ?? 1.6;
    const seat = this.skiff!.view.seats[0]!;
    return {
      approach: this.skiffToLocal(side * (hw + run + 0.9), gz),
      foot: this.skiffToLocal(side * (hw + run - 0.15), gz),
      inside: this.skiffToLocal(side * (hw - 0.45), gz),
      seat: this.skiffToLocal(seat.x, seat.z),
    };
  }

  /**
   * 放下舷梯（v0.7）：落差 = 甲板高度 − 舷梯脚处的地面（码头 / 栈桥 / 草地），
   * 水平长度按约 28° 的坡度自适应（1–3.2 米）。返回放好时的 Promise。
   */
  private lowerGangway(side: 1 | -1): Promise<void> {
    const sk = this.skiff!;
    if (!this.gangway) {
      const view = makeGangway();
      this.gangway = { view, side, run: 1.6, drop: 0.5, top: 0, extend: 0, target: 0 };
    }
    const g = this.gangway;
    if (g.view.group.parent !== sk.view.group) sk.view.group.add(g.view.group);
    const gz = (SKIFF_GATE.z0 + SKIFF_GATE.z1) / 2;
    const hw = skiffHalfWidth(gz);
    const top = this.skiffPlatform!.top;
    let run = 1.6;
    for (let i = 0; i < 3; i++) {
      const f = this.skiffToLocal(side * (hw + run), gz);
      const drop = Math.max(0.05, top - this.groundAt(f.x, f.z, top - 0.3));
      run = clamp(drop / Math.tan((28 * Math.PI) / 180), 1, 3.2);
    }
    const foot = this.skiffToLocal(side * (hw + run), gz);
    g.side = side;
    g.run = run;
    g.top = top;
    g.drop = Math.max(0.05, top - this.groundAt(foot.x, foot.z, top - 0.3));
    g.view.group.position.set(side * (hw - 0.02), SKIFF_DECK_Y, gz);
    g.view.group.rotation.y = side > 0 ? 0 : Math.PI;
    g.target = 1;
    return new Promise((r) => {
      const wait = () => (g.extend >= 1 ? r() : setTimeout(wait, 50));
      wait();
    });
  }

  private raiseGangway(): Promise<void> {
    const g = this.gangway;
    if (!g) return Promise.resolve();
    g.target = 0;
    return new Promise((r) => {
      const wait = () => (g.extend <= 0 ? r() : setTimeout(wait, 50));
      wait();
    });
  }

  /** 让队伍絮灵沿一串路点走（上下船时跟着走舷梯）。 */
  private partyFollow(paths: (i: number) => Array<{ x: number; z: number }>): void {
    let i = 0;
    for (const e of this.creatures.values()) {
      if (e.kind !== 'own' || e.state !== 'party') continue;
      const p = paths(i++);
      if (!p.length) {
        e.view.group.visible = false;
        continue;
      }
      e.aboard = true;
      e.path = p;
    }
  }

  private partyArrived(): boolean {
    for (const e of this.creatures.values()) if (e.aboard && e.path.length) return false;
    return true;
  }

  private async waitParty(ms: number): Promise<void> {
    const end = performance.now() + ms;
    while (!this.partyArrived() && performance.now() < end) await new Promise((r) => setTimeout(r, 60));
  }

  /**
   * 上船（v0.7）：走到靠码头一舷 → 舷梯放下 → 沿舷梯走上甲板、走到船头站好；
   * 队伍絮灵跟着走舷梯上来坐好 → 收起舷梯。纯表演，结束后再发出航意图。
   */
  async board(): Promise<void> {
    if (!this.skiff || this.skiff.wrecked) return;
    const P = this.player;
    const side = this.chooseGateSide();
    const lowering = this.lowerGangway(side);
    const pts = this.boardingPoints(side);
    const yaw = this.skiffYaw();
    const far = Math.hypot(pts.approach.x - P.x, pts.approach.z - P.z) > 6;
    await this.walkTo(pts.approach.x, pts.approach.z, { run: far, timeout: 8 });
    await lowering;
    await this.walkTo(pts.foot.x, pts.foot.z, { timeout: 2.5 });
    await this.walkTo(pts.inside.x, pts.inside.z, { timeout: 3 });
    const seats = this.skiff.view.seats;
    this.partyFollow((i) => {
      const s = seats[1 + i];
      return s ? [pts.approach, pts.foot, pts.inside, this.skiffToLocal(s.x, s.z)] : [];
    });
    await this.walkTo(pts.seat.x, pts.seat.z, { faceYaw: yaw, timeout: 3 });
    await this.waitParty(3000);
    await this.raiseGangway();
  }

  /** 航行目的地：调整停泊朝向（降落时船头朝向哪边就停成哪边，v0.7 不再掉头）。 */
  setBerthYaw(yaw: number): void {
    if (!this.skiff || this.skiff.wrecked || !this.skiffPlatform) return;
    this.skiff.view.group.rotation.y = yaw;
    this.skiffPlatform = { ...this.skiffPlatform, yaw };
  }

  /** 航行目的地：玩家先站在停泊云舟的甲板座位上，镜头对准（降落后从这里下船）。 */
  placeOnDeck(): void {
    if (!this.skiff || this.skiff.wrecked || !this.skiffPlatform) return;
    const seat = this.boardingPoints().seat;
    this.player.setPosition(seat.x, seat.z, this.skiffYaw(), this.skiffPlatform.top);
    this.camT.set(seat.x, this.skiffPlatform.top + 1.15, seat.z);
    // 镜头在离岛心远的一侧（海那边）看向岛内：下船后往岛上走，正好在画面里
    const g = this.skiff.view.group.position;
    this.camYaw = Math.atan2(g.x, g.z);
    this.camPitch = 0.38;
    this.camDist = 9;
  }

  /** 下船（v0.7）：放下靠码头 / 栈桥一舷的舷梯 → 沿舷梯走下来 → 往岸上走两步；絮灵跟着 → 收起舷梯。 */
  async disembark(): Promise<void> {
    if (!this.skiff || this.skiff.wrecked) return;
    const P = this.player;
    const side = this.chooseGateSide();
    const seat = this.boardingPoints(side).seat;
    P.setPosition(seat.x, seat.z, this.skiffYaw(), this.skiffPlatform!.top);
    let i = 0;
    for (const e of this.creatures.values()) {
      if (e.kind !== 'own' || e.state !== 'party') continue;
      const s = this.skiff.view.seats[1 + i];
      i++;
      if (!s) continue;
      const at = this.skiffToLocal(s.x, s.z);
      e.aboard = true;
      e.path = [];
      e.view.setPosition(at.x, at.z, this.skiffYaw());
    }
    await this.lowerGangway(side);
    const pts = this.boardingPoints(side);
    await this.walkTo(pts.inside.x, pts.inside.z, { timeout: 3 });
    this.partyFollow(() => [pts.inside, pts.foot, pts.approach]);
    await this.walkTo(pts.foot.x, pts.foot.z, { timeout: 3 });
    await this.walkTo(pts.approach.x, pts.approach.z, { timeout: 2.5 });
    await this.waitParty(2500);
    for (const e of this.creatures.values()) {
      e.aboard = false;
      e.path = [];
    }
    await this.raiseGangway();
  }

  // ---------------------------------------------------------------- 表演用的临时絮灵

  addActor(id: string, view: CreatureView, x: number, z: number, yaw: number): void {
    this.removeActor(id);
    view.setPosition(x, z, yaw);
    this.root.add(view.group);
    this.actors.set(id, view);
  }

  /**
   * 混沌迷雾（v0.7，首战袭击）：一团翻滚的暗紫色雾先出现，絮灵在雾中由小变大地凝聚出来，
   * 凝聚完成后调用 onReady（例如开始冲向玩家）。
   */
  spawnFromMist(id: string, view: CreatureView, x: number, z: number, yaw: number, onReady: () => void, dur = 1.6): void {
    this.addActor(id, view, x, z, yaw);
    view.group.scale.setScalar(0.01);
    this.mists.set(id, { t: 0, dur, x, z, done: onReady });
  }

  actor(id: string): CreatureView | undefined {
    return this.actors.get(id);
  }

  removeActor(id: string): void {
    this.mists.delete(id);
    const v = this.actors.get(id);
    if (!v) return;
    this.root.remove(v.group);
    v.dispose();
    this.actors.delete(id);
  }

  // ---------------------------------------------------------------- 每帧

  /** 每帧：玩家移动、镜头、絮灵游荡、交互检测。 */
  update(dt: number, input: Input | null, send: (x: number, z: number, yaw: number) => void, controlsEnabled: boolean): void {
    this.t += dt;
    const t = this.t;
    const P = this.player;
    const prev = { x: P.x, z: P.z };
    // 玩家移动：手动（相对镜头）或自动驾驶（世界坐标）
    let mx = 0;
    let mz = 0;
    let mag = 0;
    let run = false;
    const ap = this.autopilot;
    if (ap) {
      ap.timeout -= dt;
      const dx = ap.x - P.x;
      const dz = ap.z - P.z;
      const d = Math.hypot(dx, dz);
      if (ap.jumpAt !== undefined && !ap.jumped && d < ap.jumpAt) {
        ap.jumped = P.jump(ap.jumpStrength);
        // 起跳时朝着落点、带上刚好够的水平速度（站定起跳也能跳过去）
        if (ap.jumped) {
          P.yaw = Math.atan2(dx, dz);
          P.speed = Math.max(P.speed, d / 0.8);
        }
      }
      if ((d < 0.18 && !P.airborne) || ap.timeout <= 0) {
        if (ap.timeout <= 0) P.setPosition(ap.x, ap.z, P.yaw, this.groundAt(ap.x, ap.z, 99));
        if (ap.faceYaw !== undefined) P.yaw = ap.faceYaw;
        P.speed = 0;
        this.autopilot = null;
        ap.resolve();
      } else {
        mx = dx / d;
        mz = dz / d;
        mag = Math.min(1, d / 0.6 + 0.35);
        run = ap.run;
      }
    } else if (controlsEnabled && input) {
      const ax = input.axis();
      let ix = ax.x;
      let iy = ax.y;
      const m = Math.hypot(ix, iy);
      if (m > 1) {
        ix /= m;
        iy /= m;
      }
      mag = Math.min(1, m);
      run = ax.run;
      const fx = -Math.sin(this.camYaw);
      const fz = -Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      mx = rx * ix + fx * iy;
      mz = rz * ix + fz * iy;
      if (input.hit('Space')) P.jump();
    }
    // 水深：涉水变慢，深水游泳
    const inWater = this.terrain.isWater(P.x, P.z) && !this.riding;
    const depth = inWater ? Math.max(0, WATER_LEVEL - this.terrain.height(P.x, P.z)) : 0;
    P.water = { y: WATER_LEVEL, depth: P.feetY > WATER_LEVEL + 0.3 && P.airborne ? 0 : depth };
    const wade = clamp(depth / HumanoidView.SWIM_DEPTH, 0, 1);
    const landSpeed = (run ? 4.6 : 3.1) * (1 - 0.45 * wade * (1 - P.swim));
    const swimSpeed = run ? 2.1 : 1.5;
    const top = lerp(landSpeed, swimSpeed, P.swim);
    // 做动作时站定；空中保持起跳时的速度
    const target = P.busy ? 0 : mag * top;
    if (this.riding) {
      const r = this.riding;
      const w = r.group.localToWorld(r.seat.clone()).sub(this.root.position);
      P.x = w.x;
      P.z = w.z;
      P.speed = 0;
      const e = new THREE.Euler().setFromQuaternion(r.group.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
      P.yaw = e.y + r.yaw;
    } else {
      if (!P.airborne) P.speed = lerp(P.speed, target, Math.min(1, dt * (target > P.speed ? 6 : 9)));
      if (mag > 0.08 && !P.busy) P.yaw += angDiff(P.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * (P.airborne ? 3 : P.swimming ? 4 : 10));
      P.x += Math.sin(P.yaw) * P.speed * dt;
      P.z += Math.cos(P.yaw) * P.speed * dt;
    }
    const push = (o: { x: number; z: number }, x: number, z: number, r: number) => {
      const dx = o.x - x;
      const dz = o.z - z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        o.x = x + (dx / d) * r;
        o.z = z + (dz / d) * r;
      }
    };
    if (!this.riding) {
      for (const o of this.obstacles) push(P, o.x, o.z, o.r + 0.3);
      // 建筑：矩形碰撞，沿穿透最浅的方向推出去
      for (const r of this.rects) {
        if (r.low && P.airborne) continue;
        const dx = P.x - r.x;
        const dz = P.z - r.z;
        const px = r.hw + 0.3 - Math.abs(dx);
        const pz = r.hd + 0.3 - Math.abs(dz);
        if (px > 0 && pz > 0) {
          if (px < pz) P.x += Math.sign(dx || 1) * px;
          else P.z += Math.sign(dz || 1) * pz;
        }
      }
      this.collidePlatforms(prev);
      for (const { node } of this.props.values()) push(P, node.x, node.z, node.kind === 'tree' ? 0.55 : 0.6);
      const th = Math.atan2(P.z, P.x);
      const lim = this.terrain.rim(th) * 0.8;
      const rr = Math.hypot(P.x, P.z);
      if (rr > lim) {
        P.x *= lim / rr;
        P.z *= lim / rr;
      }
    }
    // 看向最近的絮灵
    let best: { x: number; z: number } | null = null;
    let bd = 5;
    for (const { view } of this.creatures.values()) {
      const d = Math.hypot(view.x - P.x, view.z - P.z);
      if (d < bd) {
        bd = d;
        best = { x: view.x, z: view.z };
      }
    }
    P.lookAt = best;
    P.update(dt, t, this.playerGround);
    setWaterTint(this.root.position.y + WATER_LEVEL);
    this.updateWaterFx(dt, depth);
    // 核心塔附近：受伤的队伍絮灵身上升起暖色光点（与 sim 的 CORE_HEAL 半径一致）
    if (this.isHome && this.partyHurt && Math.hypot(P.x, P.z) <= 6) {
      for (const e of this.creatures.values()) {
        if (e.kind === 'own' && e.state === 'party' && Math.random() < dt * 6) this.fx.spawn('spark', e.view.headPos().sub(this.root.position), 1, { size: 0.22, vy: 1.1, life: 0.9, spread: 0.6, color: 0xffd59a });
      }
    }

    // 发送位置（节流）
    this.moveSentAt += dt;
    if (this.moveSentAt > 0.25 && (Math.abs(P.x - this.lastSent.x) > 0.05 || Math.abs(P.z - this.lastSent.z) > 0.05)) {
      this.moveSentAt = 0;
      this.lastSent = { x: P.x, z: P.z, yaw: P.yaw };
      send(P.x, P.z, P.yaw);
    }

    // 絮灵：游荡 / 跟随
    let followIdx = 0;
    const groundFloat = this.creatureGround(false);
    const groundAboard = this.creatureGround(true);
    for (const e of this.creatures.values()) {
      const v = e.view;
      if (e.aboard) {
        // 上船 / 下船：沿路点走（舷梯）
        const wp = e.path[0];
        if (wp) {
          if (Math.hypot(wp.x - v.x, wp.z - v.z) < 0.3) e.path.shift();
          else v.moveTo(wp.x, wp.z);
        }
      } else if (e.kind === 'own' && e.state === 'party') {
        const slot = followIdx++;
        const bx = P.x - Math.sin(P.yaw) * (1.4 + slot * 0.6) + Math.cos(P.yaw) * (slot - 1) * 0.9;
        const bz = P.z - Math.cos(P.yaw) * (1.4 + slot * 0.6) - Math.sin(P.yaw) * (slot - 1) * 0.9;
        if (Math.hypot(bx - v.x, bz - v.z) > 0.8) v.moveTo(bx, bz);
        if (Math.hypot(P.x - v.x, P.z - v.z) > 12) v.setPosition(bx, bz, P.yaw);
        v.lookAt = { x: P.x, z: P.z };
      } else {
        e.timer -= dt;
        if (e.timer <= 0) {
          const r = e.kind === 'wild' ? 2 : e.state === 'working' ? 0.6 : 2.5;
          const a = Math.random() * Math.PI * 2;
          const tx = e.home.x + Math.cos(a) * Math.random() * r;
          const tz = e.home.z + Math.sin(a) * Math.random() * r;
          if (this.terrain.inside(tx, tz, 0.5) && !this.terrain.isWater(tx, tz)) v.moveTo(tx, tz);
          e.timer = 2 + Math.random() * 4;
        }
        v.lookAt = Math.hypot(P.x - v.x, P.z - v.z) < 4.5 ? { x: P.x, z: P.z } : null;
      }
      if (!e.aboard) {
        push(v, P.x, P.z, 0.4 + v.look.size * 0.9);
        // 停着的云舟对絮灵也是实体
        const sp = this.skiffPlatform;
        if (sp) {
          const l = this.platformLocal(sp, v.x, v.z, 0.3);
          if (l) push(v, sp.x, sp.z, Math.hypot(l.lx, l.lz) + 0.4);
        }
      }
      v.update(dt, t, e.aboard ? groundAboard : groundFloat);
    }
    for (const v of this.actors.values()) v.update(dt, t, groundFloat);
    for (const [id, m] of this.mists) {
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const v = this.actors.get(id);
      const gy = this.ground(m.x, m.z);
      // 雾：开始浓、凝聚完成后慢慢散去
      const density = k < 1 ? 1 : Math.max(0, 1 - (m.t - m.dur) / 1.2);
      if (Math.random() < dt * 40 * density) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.random() * 1.2 * (1 - k * 0.5);
        this.fx.spawn('puff', new THREE.Vector3(m.x + Math.cos(a) * r, gy + 0.2 + Math.random() * 1.2, m.z + Math.sin(a) * r), 1, { size: 1.1 + Math.random() * 0.8, vy: 0.3, life: 1.4, spread: 0.6, color: Math.random() < 0.5 ? 0x3a2f4a : 0x5b4a6e });
      }
      if (Math.random() < dt * 10 * density) this.fx.spawn('spark', new THREE.Vector3(m.x, gy + 0.6, m.z), 1, { size: 0.2, vy: 0.8, life: 0.6, spread: 1.2, color: 0xa77be8 });
      if (v) {
        const e = k * k * (3 - 2 * k);
        v.group.scale.setScalar(Math.max(0.01, e));
      }
      if (k >= 1 && m.done) {
        const cb = m.done;
        m.done = null;
        cb();
      }
      if (density <= 0) this.mists.delete(id);
    }
    for (const k of this.keepers.values()) {
      k.lookAt = Math.hypot(P.x - k.x, P.z - k.z) < 6 ? { x: P.x, z: P.z } : null;
      if (k.lookAt) k.yaw += angDiff(k.yaw, Math.atan2(P.x - k.x, P.z - k.z)) * Math.min(1, dt * 2);
      k.update(dt, t, this.ground);
    }
    for (const { view } of this.props.values()) view.update(t);
    this.skiff?.view.update(t, 0);
    const gw = this.gangway;
    if (gw) {
      gw.extend = gw.target > gw.extend ? Math.min(gw.target, gw.extend + dt * 1.8) : Math.max(gw.target, gw.extend - dt * 2.2);
      gw.view.set(gw.run, gw.drop, gw.extend);
    }
    if (this.skiff?.wrecked && Math.random() < dt * 3) {
      const g = this.skiff.view.group.position;
      this.fx.spawn('puff', new THREE.Vector3(g.x, g.y + 1.4, g.z), 1, { size: 0.9, vy: 0.9, life: 2.2, spread: 0.4, color: 0x9a9298 });
    }
    if (this.orb) {
      const base = this.orbPos();
      this.orb.position.set(base.x, base.y + Math.sin(t * 1.6) * 0.12, base.z);
      for (const ch of this.orb.children) {
        const i = ch.userData['i'] as number | undefined;
        if (i === undefined) continue;
        const a = t * 1.3 + (i / 6) * Math.PI * 2;
        ch.position.set(Math.cos(a) * 0.55, Math.sin(t * 2 + i) * 0.25, Math.sin(a) * 0.55);
      }
      (this.orb.userData['core'] as THREE.Mesh).rotation.y = t;
    }

    // 镜头
    if (input && controlsEnabled) {
      this.camYaw -= input.dragDX * 0.006;
      this.camPitch = clamp(this.camPitch + input.dragDY * 0.004, 0.08, 1.25);
      this.camDist = clamp(this.camDist * (1 + input.wheel * 0.0012), 3.5, 18);
    }
    const goal = new THREE.Vector3(P.x, P.feetY + 1.15, P.z);
    this.camT.lerp(goal, Math.min(1, dt * 6));
    if (this.cameraLocked) {
      this.env.update(dt, t, this.camera, this.camT);
      this.fx.update(dt);
      this.updateNearest();
      return;
    }
    const cp = Math.cos(this.camPitch);
    this.camera.position.set(this.camT.x + Math.sin(this.camYaw) * cp * this.camDist, this.camT.y + Math.sin(this.camPitch) * this.camDist, this.camT.z + Math.cos(this.camYaw) * cp * this.camDist);
    const cth = Math.atan2(this.camera.position.z, this.camera.position.x);
    if (Math.hypot(this.camera.position.x, this.camera.position.z) < this.terrain.rim(cth)) this.camera.position.y = Math.max(this.camera.position.y, Math.max(this.ground(this.camera.position.x, this.camera.position.z), WATER_LEVEL) + 0.6);
    this.camera.lookAt(this.camT);
    this.env.update(dt, t, this.camera, this.camT);
    this.fx.update(dt);
    for (const e of this.buildings.values()) {
      const def = this.content.buildings.get(e.inst.type)!;
      const crop = e.inst.crop ? { id: e.inst.crop.cropId, growth: e.inst.crop.progress / this.content.crops.get(e.inst.crop.cropId)!.growTicks } : null;
      e.view.update({ built: e.inst.built, progress: def.buildWork ? e.inst.buildProgress / def.buildWork : 1, crop, working: !!e.inst.job && e.inst.workers.length > 0 }, t);
    }

    this.updateNearest();
  }

  /** 入水溅起水花；游泳 / 涉水时身边一圈圈的波纹（v0.7）。 */
  private updateWaterFx(dt: number, depth: number): void {
    const P = this.player;
    const at = new THREE.Vector3(P.x, WATER_LEVEL + 0.03, P.z);
    if (P.swim > 0.5 && this.lastSwim <= 0.5) {
      this.fx.spawn('puff', at.clone().add(new THREE.Vector3(0, 0.1, 0)), 14, { size: 0.45, vy: 2.2, life: 0.8, spread: 1.6, color: 0xeaf6ff });
      this.spawnRipple(P.x, P.z, 1.4);
    }
    this.lastSwim = P.swim;
    const wet = depth > 0.12 && !P.airborne;
    if (wet) {
      this.rippleTimer -= dt;
      const moving = P.speed > 0.4;
      if (this.rippleTimer <= 0) {
        this.spawnRipple(P.x, P.z, P.swim > 0.5 ? 1 : 0.6);
        this.rippleTimer = moving ? 0.35 : 1.1;
        if (moving) this.fx.spawn('puff', at, P.swim > 0.5 ? 3 : 2, { size: 0.25, vy: 1.2, life: 0.5, spread: 0.6, color: 0xeaf6ff });
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!;
      r.t += dt;
      const k = r.t / 1.6;
      r.mesh.scale.setScalar(0.3 + k * 2.2 * (r.mesh.userData['size'] as number));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
      if (k >= 1) {
        this.root.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.ripples.splice(i, 1);
      }
    }
  }

  private static rippleGeo = new THREE.RingGeometry(0.42, 0.5, 24).rotateX(-Math.PI / 2);

  private spawnRipple(x: number, z: number, size: number): void {
    if (this.ripples.length > 14) return;
    const m = new THREE.Mesh(ExploreView.rippleGeo, new THREE.MeshBasicMaterial({ color: 0xf2faff, transparent: true, opacity: 0.5, depthWrite: false }));
    m.position.set(x, WATER_LEVEL + 0.04, z);
    m.userData['size'] = size;
    m.renderOrder = 4;
    this.root.add(m);
    this.ripples.push({ mesh: m, t: 0 });
  }

  /**
   * 平台碰撞：在船身下方 → 船身是墙；站在甲板上 → 栏杆挡着，只有登船口能出去。
   */
  private collidePlatforms(prev: { x: number; z: number }): void {
    const P = this.player;
    for (const pl of this.platforms) {
      if (!pl.wall) continue;
      const l = this.platformLocal(pl, P.x, P.z, 0.3);
      const onTop = pl.deck ? P.feetY >= pl.top - 0.05 : P.feetY > pl.top - STEP;
      if (!onTop) {
        if (!l) continue;
        // 在舷梯上：不算撞船
        if (this.rampHeight(P.x, P.z) !== null) continue;
        // 从下面撞上船身：按船舷轮廓推出去
        const half = pl.deck ? skiffCollisionHalfWidth(l.lz) + 0.3 : pl.hw + 0.3;
        if (Math.abs(l.lx) < half && Math.abs(l.lz) < pl.hd + 0.3) {
          const px = half - Math.abs(l.lx);
          const pz = pl.hd + 0.3 - Math.abs(l.lz);
          let nx = l.lx;
          let nz = l.lz;
          if (px < pz) nx = Math.sign(l.lx || 1) * half;
          else nz = Math.sign(l.lz || 1) * (pl.hd + 0.3);
          const c = Math.cos(pl.yaw);
          const s = Math.sin(pl.yaw);
          P.x = pl.x + nx * c + nz * s;
          P.z = pl.z - nx * s + nz * c;
        }
        continue;
      }
      if (!pl.deck) continue;
      // 在甲板上：上一帧在船上的话，不能越过栏杆（登船口除外）
      const lp = this.platformLocal(pl, prev.x, prev.z);
      if (!lp || !this.onDeck(pl, lp.lx, lp.lz)) continue;
      const lNow = this.platformLocal(pl, P.x, P.z, 2) ?? lp;
      // 只有放下舷梯的那一舷登船口能出去
      const gwSide = this.gangway && this.gangway.extend >= 0.95 ? this.gangway.side : 0;
      const inGateZ = lNow.lz > SKIFF_GATE.z0 + 0.1 && lNow.lz < SKIFF_GATE.z1 - 0.1;
      // 跳着从登船口出去也行（开场跳下失事的云舟）
      const inGate = inGateZ && ((gwSide !== 0 && Math.sign(lNow.lx) === gwSide) || (!!this.autopilot?.jumped && P.airborne));
      const lim = skiffHalfWidth(lNow.lz) - 0.25;
      let lx = lNow.lx;
      let lz = clamp(lNow.lz, -1.95, 1.6);
      if (!inGate) lx = clamp(lx, -lim, lim);
      if (lx !== lNow.lx || lz !== lNow.lz) {
        const c = Math.cos(pl.yaw);
        const s = Math.sin(pl.yaw);
        P.x = pl.x + lx * c + lz * s;
        P.z = pl.z - lx * s + lz * c;
      }
    }
  }

  private updateNearest(): void {
    const P = this.player;
    // 游泳、上下船时不能交互
    if (P.swimming || this.scripted) {
      this.nearest = null;
      return;
    }
    // 最近的可交互对象（在面前优先）
    let near: Interactable | null = null;
    let nd = Infinity;
    for (const it of [...this.interactables, ...this.extraInteractables]) {
      const live = it.kind === 'wild' || it.kind === 'pet' || it.kind === 'recruit' ? this.creatures.get(it.id)?.view : null;
      const x = live?.x ?? it.x;
      const z = live?.z ?? it.z;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d > it.radius) continue;
      const facing = Math.abs(angDiff(P.yaw, Math.atan2(x - P.x, z - P.z)));
      const score = d + facing * 0.6;
      if (score < nd) {
        nd = score;
        near = { ...it, x, z };
      }
    }
    this.nearest = near;
  }

  /**
   * 采集：转身面向采集点，播放对应动作（树用斧、石头矿石雾晶用镐、浆果用篮子）；
   * 工具落下时调用 onImpact（发意图、出粒子）。
   */
  startGather(it: Interactable, onImpact: () => void): boolean {
    const P = this.player;
    const kind = it.id.includes(':tree:') ? 'chop' : it.id.includes(':bush:') ? 'pick' : 'mine';
    P.yaw = Math.atan2(it.x - P.x, it.z - P.z);
    P.speed = 0;
    return P.playAction(kind, () => {
      const at = new THREE.Vector3(it.x, this.ground(it.x, it.z) + (kind === 'chop' ? 1.2 : 0.5), it.z);
      if (kind === 'chop') this.fx.spawn('spark', at, 8, { size: 0.25, vy: 1.2, life: 0.8, spread: 2, color: 0x8fc66e });
      else if (kind === 'mine') this.fx.spawn('puff', at, 6, { size: 0.4, vy: 0.8, life: 0.7, spread: 1.6, color: 0xb9b0a8 });
      else this.fx.spawn('heart', at, 3, { size: 0.2, vy: 1, life: 0.8, spread: 0.8 });
      onImpact();
    });
  }

  /** 当前探索镜头的机位（播片结束时回到这里）。 */
  followPose(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const P = this.player;
    const look = new THREE.Vector3(P.x, P.feetY + 1.15, P.z);
    const cp = Math.cos(this.camPitch);
    return { pos: new THREE.Vector3(look.x + Math.sin(this.camYaw) * cp * this.camDist, look.y + Math.sin(this.camPitch) * this.camDist, look.z + Math.cos(this.camYaw) * cp * this.camDist), look };
  }

  /** 屏幕上一个世界点的位置（标签用）。 */
  project(v: THREE.Vector3, w: number, h: number): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: p.z < 1 };
  }

  /** 当前所有可交互对象（测试与调试用）。 */
  allInteractables(): readonly Interactable[] {
    return [...this.interactables, ...this.extraInteractables];
  }

  creatureView(id: string): CreatureView | undefined {
    return this.creatures.get(id)?.view;
  }

  /** 抚摸 / 开心的小动画。 */
  celebrate(id: string): void {
    const v = this.creatures.get(id)?.view;
    if (!v) return;
    v.hop();
    this.fx.spawn('heart', v.headPos(), 6, { size: 0.32, vy: 1.3, life: 1.4, spread: 1.2 });
  }

  dispose(): void {
    this.autopilot?.resolve();
    this.autopilot = null;
    for (const e of this.creatures.values()) e.view.dispose();
    for (const v of this.actors.values()) v.dispose();
    for (const k of this.keepers.values()) k.dispose();
    this.player.dispose();
    this.fx.clear();
  }
}

function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function lookKey(content: ContentDb, s: Spirit): string {
  return JSON.stringify(lookFromSpirit(content, s), (_k, v) => (v instanceof Set ? [...v] : v));
}

function lookKeyOf(v: CreatureView): string {
  return (v as unknown as { lookKey?: string }).lookKey ?? '';
}
