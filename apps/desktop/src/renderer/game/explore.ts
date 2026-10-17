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
  makeSkiff,
  type SkiffView,
  mat,
  nightFactor,
  type BuildingView,
  type PropView,
} from '@cloudsea/render';
import * as THREE from 'three';
import type { Input } from './input';
import { PLAYER_ID } from './session';

export type InteractKind = 'gather' | 'wild' | 'keeper' | 'building' | 'dock' | 'pier' | 'core' | 'starter' | 'pet';

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
}

const HOME_REGION = 'sunPlains' as const;

/** 一座岛的场景：地形、采集点、建筑、野生絮灵、自家絮灵、守岛人、玩家。 */
export class ExploreView {
  readonly scene = new THREE.Scene();
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
  private readonly creatures = new Map<string, { view: CreatureView; home: { x: number; z: number }; kind: 'wild' | 'own' | 'keeper'; timer: number; state: Spirit['state'] }>();
  private readonly keepers = new Map<string, HumanoidView>();
  private obstacles: Obstacle[] = [];
  private rects: RectObstacle[] = [];
  private readonly glowTex = glowTexture();
  camYaw = 0.45;
  camPitch = 0.42;
  camDist = 10;
  private readonly camT = new THREE.Vector3();
  private moveSentAt = 0;
  private lastSent = { x: 0, z: 0, yaw: 0 };
  nearest: Interactable | null = null;
  private lastDry = { x: 0, z: 0 };
  /** 播片期间由播片控制镜头。 */
  cameraLocked = false;
  /** 停在码头 / 栈桥边的云舟；家园岛在引导前三步是失事的残骸。 */
  private skiff: { view: SkiffView; wrecked: boolean } | null = null;
  /** 失事残骸的位置（开场播片的落点）。 */
  static readonly WRECK = { x: 5.5, z: 12.5 } as const;
  private interactables: Interactable[] = [];
  /** 额外的交互点（新手引导用）。 */
  extraInteractables: Interactable[] = [];
  private t = 0;

  constructor(
    private readonly content: ContentDb,
    world: Readonly<WorldState>,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const p = world.players[PLAYER_ID]!;
    this.islandId = p.islandId;
    this.island = content.islands.get(p.islandId) ?? null;
    this.env = new Environment(this.scene, { farIslands: false });
    this.fx = new Fx(this.scene);
    const c = world.characters[PLAYER_ID]!;
    this.player = new HumanoidView({ ...c.appearance, lantern: true }, this.glowTex);
    this.player.setPosition(p.x, p.z, p.yaw);
    this.lastDry = { x: p.x, z: p.z };
    this.scene.add(this.player.group);
    this.lastSent = { x: p.x, z: p.z, yaw: p.yaw };
    this.rebuildTerrain(world);
    this.addDistantIslands(world);
    this.camT.set(p.x, this.terrain.height(p.x, p.z) + 1.15, p.z);
    this.camYaw = p.yaw + Math.PI;
    this.sync(world);
  }

  get isHome(): boolean {
    return this.islandId === homeIslandId(PLAYER_ID);
  }

  ground = (x: number, z: number): number => this.terrain.height(x, z);

  private rebuildTerrain(world: Readonly<WorldState>): void {
    if (this.islandMesh) {
      this.scene.remove(this.islandMesh);
    }
    if (this.isHome) {
      const home = world.homes[PLAYER_ID]!;
      this.coreLevel = home.coreLevel;
      this.terrain = homeTerrain(home.seed, home.coreLevel);
      this.islandMesh = buildIslandMesh(this.terrain, {
        grassHue: 0.25,
        clear: (x, z) => Math.hypot(x, z) < 2.5 || Math.hypot(x - HOME_DOCK.x, z - HOME_DOCK.z) < 2.5,
      });
    } else {
      this.terrain = islandTerrain(this.island!);
      const a = arrivalPoint(this.island!);
      this.islandMesh = buildIslandMesh(this.terrain, {
        grassHue: this.island!.fogLevel >= 2 ? 0.3 : this.island!.kind === 'keeper' ? 0.2 : 0.24,
        clear: (x, z) => Math.hypot(x - a.x, z - a.z) < 3,
      });
      if (this.props.size === 0) {
        for (const node of gatherNodes(this.island!)) {
          const view = makeGatherProp(node.kind, hashId(node.id));
          view.group.position.set(node.x, this.terrain.height(node.x, node.z) - 0.05, node.z);
          view.group.rotation.y = hashId(node.id) % 6;
          this.scene.add(view.group);
          this.props.set(node.id, { node, view });
        }
        // 栈桥：在登岛点
        const pier = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.4), mat(i % 2 ? 0x9a6a43 : 0x8a5f40));
          plank.position.set(0, 0.12, i * 0.45);
          plank.receiveShadow = true;
          pier.add(plank);
        }
        pier.position.set(a.x, this.terrain.height(a.x, a.z), a.z + 1.2);
        this.scene.add(pier);
        if (this.island!.keeper) this.buildKeeperHome(this.island!.keeper);
      }
    }
    this.scene.add(this.islandMesh);
  }

  private placeSkiff(wrecked: boolean): void {
    if (this.skiff) this.scene.remove(this.skiff.view.group);
    const view = makeSkiff({ wrecked });
    for (const g of view.glows) this.env.glowMaterials.add(g);
    let x: number;
    let z: number;
    let yaw: number;
    let lift: number;
    if (wrecked) {
      ({ x, z } = ExploreView.WRECK);
      yaw = 0.9;
      lift = -0.25;
    } else if (this.isHome) {
      x = HOME_DOCK.x + 3.3;
      z = HOME_DOCK.z + 1.6;
      yaw = 0;
      lift = 0.4;
    } else {
      const a = arrivalPoint(this.island!);
      x = a.x + 2.1;
      z = a.z + 2.6;
      yaw = 0;
      lift = 0.4;
    }
    view.group.position.set(x, Math.max(this.terrain.height(x, z), 0) + lift, z);
    view.group.rotation.y = yaw;
    this.scene.add(view.group);
    this.skiff = { view, wrecked };
    if (wrecked) this.obstacles.push({ x, z, r: 1.6 });
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
    const place = (terrain: Terrain, pos: { x: number; y: number; z: number }, seed: number) => {
      const dx = pos.x - here.x;
      const dz = pos.z - here.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1) return;
      const lod = buildIslandLod(terrain, dist < 260 ? 'mid' : 'far', seed);
      lod.position.set(dx, pos.y - here.y, dz);
      this.scene.add(lod);
    };
    for (const isl of this.content.islands.values()) {
      if (isl.id === this.islandId) continue;
      place(islandTerrain(isl), worldPosition(isl, HOME_CHART_POS), isl.seed);
    }
    if (!this.isHome) {
      const home = world.homes[PLAYER_ID]!;
      place(homeTerrain(home.seed, home.coreLevel), { x: 0, y: 0, z: 0 }, home.seed);
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
      this.scene.add(v.group);
      this.obstacles.push({ x, z, r: Math.max(0.4, Math.min(w, d) / 2 + 0.2) });
    }
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
        this.scene.add(v.group);
        this.keepers.set(kid, v);
      }
    }
    for (const [kid, v] of this.keepers) {
      if (!keeperIds.includes(kid)) {
        this.scene.remove(v.group);
        v.dispose();
        this.keepers.delete(kid);
      }
    }

    for (const [id, entry] of this.creatures) {
      const w = want.get(id);
      const stale = !w || (w.kind === 'own' && (w.spirit.blighted !== entry.view.look.blighted || lookKey(this.content, w.spirit) !== lookKeyOf(entry.view)));
      if (stale) {
        this.scene.remove(entry.view.group);
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
      this.scene.add(view.group);
      this.creatures.set(id, { view, home: { x: w.x, z: w.z }, kind: w.kind, timer: Math.random() * 3, state: w.spirit.state });
    }

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
      list.push({ kind: 'pier', id: 'pier', x: a.x, z: a.z + 1.2, label: '栈桥 · 出航', radius: 2.2 });
    }
    for (const [kid, v] of this.keepers) list.push({ kind: 'keeper', id: kid, x: v.x, z: v.z, label: `和${this.content.keepers.get(kid)!.name}说话`, radius: 2.4 });
    for (const [id, e] of this.creatures) {
      if (e.kind !== 'own') continue;
      const s = c.spirits[id];
      if (s) list.push({ kind: 'pet', id, x: e.view.x, z: e.view.z, label: `抚摸 ${s.nickname ?? this.content.forms.get(s.formId)!.form.name}`, radius: 1.6 });
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
    for (const inst of Object.values(home.buildings)) {
      seen.add(inst.id);
      const def = this.content.buildings.get(inst.type)!;
      const fp = footprint(def, inst.rot);
      const key = `${inst.type}:${inst.x}:${inst.z}:${inst.rot}:${this.coreLevel}`;
      let entry = this.buildings.get(inst.id);
      if (!entry || entry.key !== key) {
        if (entry) {
          this.scene.remove(entry.view.group);
          if (entry.foundation) this.scene.remove(entry.foundation);
        }
        const view = makeBuildingView(inst.type, def.size.w, def.size.d, hashId(inst.id));
        const y = foundationHeight(this.content, home, inst);
        view.group.position.set(inst.x + fp.w / 2, y, inst.z + fp.d / 2);
        view.group.rotation.y = -inst.rot * (Math.PI / 2);
        this.scene.add(view.group);
        for (const g of view.glows) this.env.glowMaterials.add(g);
        // 地基：建筑占地四角的最高点，石砌填到地形（DESIGN 7）
        const low = Math.min(this.terrain.height(inst.x, inst.z), this.terrain.height(inst.x + fp.w, inst.z), this.terrain.height(inst.x, inst.z + fp.d), this.terrain.height(inst.x + fp.w, inst.z + fp.d));
        let foundation: THREE.Mesh | null = null;
        if (y - low > 0.08 && def.kind !== 'decoration') {
          foundation = new THREE.Mesh(new THREE.BoxGeometry(fp.w, y - low + 0.2, fp.d), mat(0xa49a90));
          foundation.position.set(inst.x + fp.w / 2, (y + low) / 2 - 0.1, inst.z + fp.d / 2);
          foundation.receiveShadow = true;
          this.scene.add(foundation);
        }
        entry = { view, key, inst, foundation };
        this.buildings.set(inst.id, entry);
      }
      entry.inst = inst;
      const crop = inst.crop ? { id: inst.crop.cropId, growth: inst.crop.progress / this.content.crops.get(inst.crop.cropId)!.growTicks } : null;
      entry.view.update({ built: inst.built, progress: def.buildWork ? inst.buildProgress / def.buildWork : 1, crop, working: !!inst.job && inst.workers.length > 0 }, this.t);
      if (def.kind === 'field' || inst.type === 'path' || inst.type === 'flowerbed') continue;
      if (inst.type === 'lamp' || inst.type === 'fence') this.rects.push({ x: inst.x + fp.w / 2, z: inst.z + fp.d / 2, hw: 0.2, hd: 0.2 });
      else if (def.kind !== 'decoration') this.rects.push({ x: inst.x + fp.w / 2, z: inst.z + fp.d / 2, hw: fp.w / 2 - 0.15, hd: fp.d / 2 - 0.15 });
    }
    for (const [id, e] of this.buildings) {
      if (seen.has(id)) continue;
      this.scene.remove(e.view.group);
      if (e.foundation) this.scene.remove(e.foundation);
      this.buildings.delete(id);
    }
  }

  /** 每帧：玩家移动、镜头、絮灵游荡、交互检测。返回是否需要发送位置。 */
  update(dt: number, input: Input | null, send: (x: number, z: number, yaw: number) => void, controlsEnabled: boolean): void {
    this.t += dt;
    const t = this.t;
    const P = this.player;
    // 玩家移动（相对镜头）
    const ax = controlsEnabled && input ? input.axis() : { x: 0, y: 0, run: false };
    let ix = ax.x;
    let iy = ax.y;
    const m = Math.hypot(ix, iy);
    if (m > 1) {
      ix /= m;
      iy /= m;
    }
    const mag = Math.min(1, m);
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    const mx = rx * ix + fx * iy;
    const mz = rz * ix + fz * iy;
    const target = mag * (ax.run ? 4.6 : 3.1);
    P.speed = lerp(P.speed, target, Math.min(1, dt * (target > P.speed ? 6 : 9)));
    if (mag > 0.08) P.yaw += angDiff(P.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * 10);
    P.x += Math.sin(P.yaw) * P.speed * dt;
    P.z += Math.cos(P.yaw) * P.speed * dt;
    const push = (o: { x: number; z: number }, x: number, z: number, r: number) => {
      const dx = o.x - x;
      const dz = o.z - z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) {
        o.x = x + (dx / d) * r;
        o.z = z + (dz / d) * r;
      }
    };
    for (const o of this.obstacles) push(P, o.x, o.z, o.r + 0.3);
    // 建筑：矩形碰撞，沿穿透最浅的方向推出去
    for (const r of this.rects) {
      const dx = P.x - r.x;
      const dz = P.z - r.z;
      const px = r.hw + 0.3 - Math.abs(dx);
      const pz = r.hd + 0.3 - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) P.x += Math.sign(dx || 1) * px;
        else P.z += Math.sign(dz || 1) * pz;
      }
    }
    for (const { node } of this.props.values()) push(P, node.x, node.z, node.kind === 'tree' ? 0.55 : 0.6);
    // 水面挡路（池塘、溪流）
    if (this.terrain.isWater(P.x, P.z)) {
      P.x = this.lastDry.x;
      P.z = this.lastDry.z;
      P.speed *= 0.5;
    } else this.lastDry = { x: P.x, z: P.z };
    const th = Math.atan2(P.z, P.x);
    const lim = this.terrain.rim(th) * 0.8;
    const rr = Math.hypot(P.x, P.z);
    if (rr > lim) {
      P.x *= lim / rr;
      P.z *= lim / rr;
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
    P.update(dt, t, this.ground);

    // 发送位置（节流）
    this.moveSentAt += dt;
    if (this.moveSentAt > 0.25 && (Math.abs(P.x - this.lastSent.x) > 0.05 || Math.abs(P.z - this.lastSent.z) > 0.05)) {
      this.moveSentAt = 0;
      this.lastSent = { x: P.x, z: P.z, yaw: P.yaw };
      send(P.x, P.z, P.yaw);
    }

    // 絮灵：游荡 / 跟随
    let followIdx = 0;
    for (const e of this.creatures.values()) {
      const v = e.view;
      if (e.kind === 'own' && e.state === 'party') {
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
      push(v, P.x, P.z, 0.4 + v.look.size * 0.9);
      v.update(dt, t, this.ground);
    }
    for (const k of this.keepers.values()) {
      k.lookAt = Math.hypot(P.x - k.x, P.z - k.z) < 6 ? { x: P.x, z: P.z } : null;
      if (k.lookAt) k.yaw += angDiff(k.yaw, Math.atan2(P.x - k.x, P.z - k.z)) * Math.min(1, dt * 2);
      k.update(dt, t, this.ground);
    }
    for (const { view } of this.props.values()) view.update(t);
    this.skiff?.view.update(t, 0);
    if (this.skiff?.wrecked && Math.random() < dt * 3) {
      const g = this.skiff.view.group.position;
      this.fx.spawn('puff', new THREE.Vector3(g.x, g.y + 1.2, g.z), 1, { size: 0.9, vy: 0.9, life: 2.2, spread: 0.4, color: 0x9a9298 });
    }

    // 镜头
    if (input && controlsEnabled) {
      this.camYaw -= input.dragDX * 0.006;
      this.camPitch = clamp(this.camPitch + input.dragDY * 0.004, 0.08, 1.25);
      this.camDist = clamp(this.camDist * (1 + input.wheel * 0.0012), 3.5, 18);
    }
    const goal = new THREE.Vector3(P.x, this.ground(P.x, P.z) + 1.15, P.z);
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
    if (Math.hypot(this.camera.position.x, this.camera.position.z) < this.terrain.rim(cth)) this.camera.position.y = Math.max(this.camera.position.y, this.ground(this.camera.position.x, this.camera.position.z) + 0.6);
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

  private updateNearest(): void {
    const P = this.player;
    // 最近的可交互对象（在面前优先）
    let near: Interactable | null = null;
    let nd = Infinity;
    for (const it of [...this.interactables, ...this.extraInteractables]) {
      const live = it.kind === 'wild' || it.kind === 'pet' ? this.creatures.get(it.id)?.view : null;
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

  /** 当前探索镜头的机位（播片结束时回到这里）。 */
  followPose(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const P = this.player;
    const look = new THREE.Vector3(P.x, this.ground(P.x, P.z) + 1.15, P.z);
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
    for (const e of this.creatures.values()) e.view.dispose();
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

