import { getContent } from '@cloudsea/content';
import {
  createRng,
  createSpirit,
  createTerrain,
  generateWildGenes,
  homeIslandId,
  type BattleEvent,
  type Intent,
  type WorldEvent,
  type WorldState,
} from '@cloudsea/sim';
import { buildIslandMesh, CreatureView, Environment, lookFromSpirit } from '@cloudsea/render';
import { button, focusFirst, h } from '@cloudsea/ui';
import * as THREE from 'three';
import { BattleView } from './battle';
import { Cutscene, type Shot } from './cinematic';
import { arrivalShots, firstWildShots, keeperIntroShots, openingShots } from './cutscenes';
import { BuildMode } from './build';
import { ExploreView, type Interactable } from './explore';
import { Hud } from './hud';
import { Input } from './input';
import { openBuilding, openCore, openDock, openKeeper, openMenu, openStarChart, type Ctx } from './panels';
import { saveBackend } from './saves';
import { GameSession, PLAYER_ID } from './session';
import { itemName } from './text';
import { Tutorial } from './tutorial';
import { UiRoot } from './uiRoot';

type Mode = 'title' | 'explore' | 'build' | 'battle' | 'sailing' | 'cutscene';

/** 标题画面背景：一座小岛和几只随机絮灵，镜头慢慢绕。 */
class TitleScene {
  readonly scene = new THREE.Scene();
  private readonly env: Environment;
  private readonly creatures: CreatureView[] = [];
  private t = 0;
  private readonly ground: (x: number, z: number) => number;

  constructor() {
    const content = getContent();
    this.env = new Environment(this.scene);
    const terrain = createTerrain({ seed: 5, radius: 12, amplitude: 0.5, flats: [{ x: 0, z: 0, radius: 5, height: 0.2 }] });
    this.ground = terrain.height;
    this.scene.add(buildIslandMesh(terrain));
    const rng = createRng(20261017);
    const lines = [...content.lines.values()];
    for (let i = 0; i < 5; i++) {
      const line = lines[i % lines.length]!;
      const s = createSpirit(content, { id: `title-${i}`, ownerId: 'title', genes: generateWildGenes(rng, line), level: 20, formIndex: i % 3 === 0 ? 1 : 0 });
      const v = new CreatureView(lookFromSpirit(content, s));
      const a = (i / 5) * Math.PI * 2;
      v.setPosition(Math.cos(a) * 3.2, Math.sin(a) * 3.2, a + Math.PI);
      this.scene.add(v.group);
      this.creatures.push(v);
    }
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.t += dt;
    const a = this.t * 0.05;
    camera.position.set(Math.sin(a) * 13, 5.5, Math.cos(a) * 13);
    camera.lookAt(0, 0.8, 0);
    for (const [i, v] of this.creatures.entries()) {
      if (Math.random() < dt * 0.25) {
        const r = Math.random() * 4;
        const th = Math.random() * Math.PI * 2;
        v.moveTo(Math.cos(th) * r, Math.sin(th) * r);
      }
      if (Math.random() < dt * 0.05) v.hop();
      v.update(dt, this.t + i, this.ground);
    }
    this.env.update(dt, this.t, camera, new THREE.Vector3());
  }

  dispose(): void {
    for (const v of this.creatures) v.dispose();
  }
}

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
  private readonly ui: UiRoot;
  private readonly input: Input;
  private readonly hud: Hud;
  private readonly content = getContent();
  private session: GameSession | null = null;
  private world: Readonly<WorldState> | null = null;
  private explore: ExploreView | null = null;
  private battle: BattleView | null = null;
  private build: BuildMode | null = null;
  private title: TitleScene | null = null;
  private tutorial: Tutorial | null = null;
  private mode: Mode = 'title';
  private last = performance.now();
  private pendingBattle: string | null = null;
  private pendingTurns: Array<{ battleId: string; events: readonly BattleEvent[] }> = [];
  private pendingEnd: Extract<WorldEvent, { t: 'battleEnd' }> | null = null;
  private titleEl: HTMLElement | null = null;
  private cutscene: Cutscene | null = null;
  private readonly ctx: Ctx;
  /** 自动化测试模式：固定世界种子、打开测试钩子。 */
  private readonly testMode = new URLSearchParams(location.search).get('test') === '1';

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.ui = new UiRoot(uiRoot);
    this.input = new Input(canvas, () => this.ui.capturing);
    this.hud = new Hud(this.content, this.ui);
    this.ctx = {
      content: this.content,
      ui: this.ui,
      world: () => this.world!,
      act: (intent, ok) => this.act(intent, ok),
      enterBuild: () => this.enterBuild(),
      saveNow: () => this.session?.save() ?? Promise.resolve(),
      quitToTitle: () => this.quitToTitle(),
    };
    const resize = () => {
      const w = innerWidth;
      const hh = innerHeight;
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
    window.addEventListener('beforeunload', () => void this.session?.save());
    if (this.testMode) this.exposeTestHooks();
    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- 标题

  private async showTitle(): Promise<void> {
    this.mode = 'title';
    this.title = new TitleScene();
    this.hud.clear();
    const saves = await saveBackend().list();
    const name = h('input', { type: 'text', value: '小禾', maxlength: '16', style: 'width:160px' }) as HTMLInputElement;
    const panel = h(
      'div',
      { class: 'panel col', style: 'align-items:stretch' },
      h('div', { class: 'row' }, h('span', {}, '守岛人的名字'), name),
      button('开始新的旅程', () => this.startSession(GameSession.create(name.value, this.testMode ? 20261017 : undefined)), { class: 'primary' }),
      ...saves.slice(0, 3).map((s) =>
        button(`继续：${s.slot}（${new Date(s.modified).toLocaleString()}）`, async () => {
          try {
            this.startSession(await GameSession.load(s.slot));
          } catch (e) {
            this.ui.toast(`读档失败：${(e as Error).message}`, 'error');
          }
        }),
      ),
    );
    this.titleEl = h('div', { id: 'title' }, h('h1', {}, '云海拾灵'), h('div', { class: 'sub' }, 'Cloudsea: Spirit Gathering · M1 垂直切片'), panel);
    this.ui.layer.append(this.titleEl);
    focusFirst(panel);
    document.body.dataset['ready'] = 'true';
  }

  private startSession(session: GameSession): void {
    this.titleEl?.remove();
    this.titleEl = null;
    this.title?.dispose();
    this.title = null;
    this.session = session;
    this.tutorial = new Tutorial(this.ui, (step, done) => void this.act({ type: 'tutorial', step, ...(done ? { done } : {}) }));
    session.client.onSnapshot((w) => this.onSnapshot(w));
    session.client.onEvents((es) => this.onEvents(es));
    this.world = session.client.world;
    this.enterExplore();
    void session.save();
    // 开场播片（新角色第一次进入）
    const c = this.world?.characters[PLAYER_ID];
    if (c && this.explore && !c.tutorial.done && c.tutorial.step === 0) this.playCutscene('opening', openingShots(this.explore), () => {});
  }

  /**
   * 播一段一次性播片：看过就直接执行 then；没看过先记下（发意图），播完再执行 then。
   */
  private playCutscene(id: string, shots: Shot[], then: () => void): void {
    const c = this.world?.characters[PLAYER_ID];
    if (!this.explore || !c || c.seenCutscenes.includes(id) || this.cutscene) {
      then();
      return;
    }
    void this.act({ type: 'seenCutscene', id });
    this.ui.closeAllModals();
    this.mode = 'cutscene';
    this.explore.cameraLocked = true;
    this.hud.clear();
    this.ui.tutorial.classList.add('hidden');
    this.ui.toasts.classList.add('hidden');
    this.cutscene = new Cutscene(shots, this.ui.layer, () => {
      this.cutscene = null;
      this.ui.toasts.classList.remove('hidden');
      if (this.explore) this.explore.cameraLocked = false;
      this.ui.tutorial.classList.remove('hidden');
      if (this.mode === 'cutscene') this.mode = 'explore';
      then();
    });
  }

  private quitToTitle(): void {
    this.cutscene?.dispose();
    this.cutscene = null;
    this.ui.closeAllModals();
    this.battle?.dispose();
    this.battle = null;
    this.build?.dispose();
    this.build = null;
    this.explore?.dispose();
    this.explore = null;
    this.session?.dispose();
    this.session = null;
    this.world = null;
    this.ui.tutorial.classList.add('hidden');
    void this.showTitle();
  }

  // ---------------------------------------------------------------- 意图

  private async act(intent: Intent, ok?: string): Promise<boolean> {
    if (!this.session) return false;
    const r = await this.session.client.request(intent);
    if (!r.ok) this.ui.toast(r.error ?? '做不到', 'error');
    else if (ok) this.ui.toast(ok);
    return r.ok;
  }

  // ---------------------------------------------------------------- 模式

  private enterExplore(): void {
    this.build?.dispose();
    this.build = null;
    if (!this.world) return;
    const island = this.world.players[PLAYER_ID]!.islandId;
    if (!this.explore || this.explore.islandId !== island) {
      this.explore?.dispose();
      this.tutorial?.detach();
      this.explore = new ExploreView(this.content, this.world, this.camera);
    }
    this.mode = 'explore';
  }

  private enterBuild(): void {
    if (!this.explore || !this.world) return;
    if (!this.explore.isHome) {
      this.ui.toast('只能在家园岛上建造', 'error');
      return;
    }
    this.ui.closeAllModals();
    this.mode = 'build';
    this.build = new BuildMode(
      this.content,
      this.ui,
      this.explore,
      this.camera,
      this.world,
      (type, x, z, rot) => this.act({ type: 'build', building: type, x, z, rot }, `开始建造${this.content.buildings.get(type)!.name}`),
      () => this.enterExplore(),
    );
  }

  private onSnapshot(world: Readonly<WorldState>): void {
    this.world = world;
    const p = world.players[PLAYER_ID]!;
    if (this.pendingBattle && world.battles[this.pendingBattle] && !this.battle && !this.cutscene) {
      const id = this.pendingBattle;
      this.pendingBattle = null;
      const b = world.battles[id]!;
      const wild = b.kind === 'wild' && b.wildId ? b.wildId : null;
      const name = b.state.sides[1].units[0]?.name ?? '絮灵';
      if (wild && this.explore) this.playCutscene('firstWild', firstWildShots(this.explore, wild, name), () => this.world && this.startBattleView(this.world, id));
      else this.startBattleView(world, id);
    }
    if (this.battle && (this.pendingTurns.length || this.pendingEnd)) {
      const turns = this.pendingTurns.splice(0);
      const end = this.pendingEnd;
      this.pendingEnd = null;
      const battle = this.battle;
      void (async () => {
        for (const t of turns) await battle.playTurn(t.events, world.battles[t.battleId] ?? null, world);
        if (end) battle.showResult(end, world);
      })();
    }
    if (this.mode === 'explore' || this.mode === 'build') {
      if (this.explore && this.explore.islandId !== p.islandId) {
        this.sailTransition(p.islandId);
        return;
      }
      this.explore?.sync(world);
      this.build?.setWorld(world);
    }
  }

  private sailTransition(islandId: string): void {
    this.mode = 'sailing';
    const name = islandId === homeIslandId(PLAYER_ID) ? '家园岛' : this.content.islands.get(islandId)?.name ?? '';
    const overlay = h('div', { id: 'title', style: 'background:rgba(255,248,239,.85)' }, h('h1', { style: 'font-size:36px' }, '扬帆出航'), h('div', { class: 'sub' }, `前往 ${name}……`));
    this.ui.layer.append(overlay);
    setTimeout(() => {
      overlay.remove();
      this.enterExplore();
      if (this.world) this.explore?.sync(this.world);
      const island = this.content.islands.get(islandId);
      if (island && this.explore) this.playCutscene(`arrive:${island.id}`, arrivalShots(this.explore, island), () => {});
    }, 1400);
  }

  private startBattleView(world: Readonly<WorldState>, battleId: string): void {
    const b = world.battles[battleId]!;
    this.ui.closeAllModals();
    this.build?.dispose();
    this.build = null;
    this.mode = 'battle';
    this.hud.clear();
    this.ui.tutorial.classList.add('hidden');
    this.battle = new BattleView(
      this.content,
      this.ui,
      this.camera,
      b,
      world,
      (actions) => this.session!.client.request({ type: 'battleActions', battleId, actions }),
      () => {
        this.battle?.dispose();
        this.battle = null;
        this.ui.tutorial.classList.remove('hidden');
        this.enterExplore();
        if (this.world) this.explore?.sync(this.world);
      },
      () => this.act({ type: 'forfeit', battleId }),
    );
  }

  private onEvents(events: readonly WorldEvent[]): void {
    const c = this.world?.characters[PLAYER_ID];
    for (const e of events) {
      if ('playerId' in e && e.playerId && e.playerId !== PLAYER_ID) continue;
      switch (e.t) {
        case 'toast':
          this.ui.toast(e.text);
          break;
        case 'items':
          this.ui.toast(`+${e.count} ${itemName(this.content, e.item)}`);
          break;
        case 'shells':
          if (e.delta > 0) this.ui.toast(`+${e.delta} 云贝`);
          break;
        case 'dayStart':
          if (e.day > 1) this.ui.toast(`第 ${e.day} 天的早晨。商队带来了新的订单。`);
          break;
        case 'battleStart':
          this.pendingBattle = e.battleId;
          break;
        case 'battleTurn':
          this.pendingTurns.push({ battleId: e.battleId, events: e.events });
          break;
        case 'battleEnd':
          this.pendingEnd = e;
          if (c && !c.tutorial.done && c.tutorial.step === 2) void this.act({ type: 'tutorial', step: 3 });
          break;
        case 'dialogue':
          this.ui.say(this.content.keepers.get(e.keeperId)?.name ?? '', e.lines, e.title);
          break;
        case 'affinity':
          if (e.delta !== 0) this.ui.toast(`${this.content.keepers.get(e.keeperId)?.name} 好感 ${e.delta > 0 ? '+' : ''}${e.delta}`);
          break;
        case 'built':
          if (e.ownerId === PLAYER_ID) this.ui.toast(`${this.content.buildings.get(this.world?.homes[PLAYER_ID]?.buildings[e.buildingId]?.type ?? '')?.name ?? '建筑'}建好了！`);
          break;
        case 'cropReady':
          if (e.ownerId === PLAYER_ID) this.ui.toast('田里的作物成熟了');
          break;
        case 'hatched':
          this.ui.toast('絮灵蛋孵化了！');
          break;
        case 'purified':
          this.ui.toast('一只絮灵净化完成了');
          break;
        case 'evolved':
          break;
        case 'keeperVisit':
          if (e.playerId === PLAYER_ID) this.ui.toast(`${this.content.keepers.get(e.keeperId)?.name} 来你的岛上串门了，在码头附近`);
          break;
        case 'blueprint':
          this.ui.toast(`获得蓝图：${this.content.buildings.get(e.building)?.name}`);
          break;
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------- 交互

  private async interact(it: Interactable): Promise<void> {
    const w = this.world!;
    const c = w.characters[PLAYER_ID]!;
    switch (it.kind) {
      case 'gather':
        if (await this.act({ type: 'gather', nodeId: it.id })) this.explore?.fx.spawn('puff', new THREE.Vector3(it.x, this.explore.ground(it.x, it.z) + 0.6, it.z), 8, { size: 0.5, vy: 0.6, life: 0.8, spread: 1.6 });
        break;
      case 'wild':
        await this.act({ type: 'encounter', wildId: it.id });
        break;
      case 'keeper':
        if (this.explore) this.playCutscene(`keeper:${it.id}`, keeperIntroShots(this.explore, it.id, this.content.keepers.get(it.id)!), () => openKeeper(this.ctx, it.id));
        else openKeeper(this.ctx, it.id);
        break;
      case 'building':
        openBuilding(this.ctx, it.id);
        break;
      case 'dock':
        openDock(this.ctx, () => openStarChart(this.ctx));
        break;
      case 'pier':
        openStarChart(this.ctx);
        break;
      case 'core':
        if (!c.tutorial.done && c.tutorial.step === 5) {
          await this.act({ type: 'tutorial', step: 6, done: true });
          this.ui.say('岛核', ['你把提灯举到岛核前。一点光落了进去。', '光亮了起来，雾慢慢散开。', '远处浮现出一座座小岛——麦浪坡、溪石屿、雾隐谷，还有挂满风铃的风铃台和一大片麦田的禾田屿。', '你是这座岛的守岛人了。'], '第一盏灯');
        } else openCore(this.ctx);
        break;
      case 'pet':
        this.explore?.celebrate(it.id);
        break;
      case 'starter':
        if (await this.act({ type: 'adoptStarter' })) {
          await this.act({ type: 'tutorial', step: 2 });
          const id = `${PLAYER_ID}-s1`;
          setTimeout(() => this.explore?.celebrate(id), 300);
          this.ui.say('……', ['云气慢慢凝成了一只小小的絮灵。', '它蹭了蹭你的手，好像认识你。', '这是旧大地的一段记忆——一片晒着太阳的麦田。'], '暖芽', () => {
            this.ui.say('！', ['远处传来低吼。', '一只被蚀雾侵蚀的絮灵冲了过来！'], undefined, () => void this.act({ type: 'tutorialBattle' }));
          });
        }
        break;
    }
  }

  /**
   * 自动化测试钩子（只在 ?test=1 时存在）：仍然只通过意图改世界。
   * teleport 先在本地移动玩家，再发 move 意图——和玩家走过去一样。
   */
  private exposeTestHooks(): void {
    (window as unknown as { __game: unknown }).__game = {
      world: () => this.world,
      mode: () => this.mode,
      act: (intent: Intent) => this.session?.client.request(intent),
      teleport: (x: number, z: number) => {
        this.explore?.player.setPosition(x, z, this.explore.player.yaw);
        this.session?.client.fire({ type: 'move', x, z, yaw: this.explore?.player.yaw ?? 0 });
      },
      nearest: () => this.explore?.nearest ?? null,
      interactables: () => this.explore?.allInteractables() ?? [],
      interact: () => (this.explore?.nearest ? this.interact(this.explore.nearest) : null),
      fastForward: (ticks: number) => {
        for (let i = 0; i < ticks; i += 50) this.session?.host.update(5000);
      },
      setCamera: (yaw: number, pitch: number, dist: number) => {
        if (!this.explore) return;
        this.explore.camYaw = yaw;
        this.explore.camPitch = pitch;
        this.explore.camDist = dist;
      },
      dialogueOpen: () => this.ui.dialogueOpen,
      modalOpen: () => this.ui.modalOpen,
    };
  }

  // ---------------------------------------------------------------- 主循环

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.session?.update(dt * 1000);
    const input = this.input;
    if (this.mode === 'title' && this.title) {
      this.title.update(dt, this.camera);
      this.renderer.render(this.title.scene, this.camera);
    } else if ((this.mode === 'explore' || this.mode === 'sailing') && this.explore && this.world) {
      const controls = this.mode === 'explore' && !this.ui.capturing;
      this.explore.update(dt, input, (x, z, yaw) => this.session?.client.fire({ type: 'move', x, z, yaw }), controls);
      if (controls) {
        if (input.hit('KeyE') && this.explore.nearest) void this.interact(this.explore.nearest);
        if (input.hit('Tab') || input.hit('KeyI')) openMenu(this.ctx);
        if (input.hit('KeyB')) this.enterBuild();
        if (input.hit('KeyM')) openStarChart(this.ctx);
        if (input.hit('Escape')) openMenu(this.ctx, 'settings');
      }
      if (this.mode === 'explore') this.hud.update(this.world, this.explore.nearest, 'explore');
      this.tutorial?.update(this.world, this.explore);
      this.renderer.render(this.explore.scene, this.camera);
    } else if (this.mode === 'build' && this.explore && this.build && this.world) {
      this.explore.update(dt, null, () => {}, false);
      if (!this.ui.capturing) this.build.update(input);
      this.hud.update(this.world, null, 'build');
      this.renderer.render(this.explore.scene, this.camera);
    } else if (this.mode === 'cutscene' && this.explore && this.cutscene) {
      this.explore.update(dt, null, () => {}, false);
      this.cutscene.update(dt, this.camera);
      this.renderer.render(this.explore.scene, this.camera);
    } else if (this.mode === 'battle' && this.battle) {
      this.battle.update(dt);
      this.renderer.render(this.battle.scene, this.camera);
    } else if (this.explore) {
      this.renderer.render(this.explore.scene, this.camera);
    }
    input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }
}

