import { ECONOMY, getContent, REGION_NAME, REGIONS, steamName } from '@cloudsea/content';
import type { ClientTransport } from '@cloudsea/net';
import { createCharacter as newCharacter, loadCharacter } from '@cloudsea/sim';
import {
  createRng,
  createSpirit,
  createTerrain,
  footprint,
  generateWildGenes,
  homeIslandId,
  homeTerrain,
  type IslandLayout,
  sailBlocked,
  type ActiveBattle,
  type BattleEvent,
  type Intent,
  type WorldEvent,
  type WorldState,
} from '@cloudsea/sim';
import { buildIslandMesh, CreatureView, Environment, lookFromSpirit, makeBuildingView } from '@cloudsea/render';
import { tr } from '@cloudsea/i18n';
import { button, focusFirst, h } from '@cloudsea/ui';
import { languageRow } from './panels';
import * as THREE from 'three';
import { battleUnitSpirit, BattleView } from './battle';
import { Cutscene, type Shot } from './cinematic';
import { ambushShots, arrivalShots, keeperIntroShots, openingShots } from './cutscenes';
import { SCENARIOS, type ScenarioHost } from './scenarios';
import { VoyageView } from './voyageView';
import { arrivalPoint, CLOUDLORD_SPOT, HOME_DOCK } from '@cloudsea/sim';
import { BuildMode } from './build';
import { ExploreView, type Interactable } from './explore';
import { Hud } from './hud';
import { GamepadInput, type PadContext } from './gamepad';
import { Input } from './input';
import { openBuilding, openCore, openDock, openKeeper, openMenu, openSpirit, openStarChart, type Ctx } from './panels';
import { saveBackend } from './saves';
import { achievementBridge, loadBlockedLines, rememberBlocked } from './spirit';
import { isBlocked } from '@cloudsea/ai';
import { characterStore, GameSession, newCharacterId, PLAYER_ID } from './session';
import { ipcClientTransport, netBridge } from './netTransports';
import { itemName } from './text';
import { Tutorial } from './tutorial';
import { UiRoot } from './uiRoot';

/** boarding / landing：上下船表演；transition：探索 → 战斗的转场（v0.6）。 */
type Mode = 'title' | 'explore' | 'build' | 'battle' | 'sailing' | 'cutscene' | 'voyage' | 'boarding' | 'landing' | 'transition' | 'gallery' | 'visit';

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
  private readonly gamepad: GamepadInput;
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
  /** 有人加入了战斗，等快照到了重建战斗界面（M2）。 */
  private pendingRebuild: string | null = null;
  private pendingTurns: Array<{ battleId: string; events: readonly BattleEvent[] }> = [];
  private pendingEnd: Extract<WorldEvent, { t: 'battleEnd' }> | null = null;
  private titleEl: HTMLElement | null = null;
  private cutscene: Cutscene | null = null;
  private voyage: VoyageView | null = null;
  private pendingVoyage: Extract<WorldEvent, { t: 'voyageStart' }> | null = null;
  private voyageLabel: HTMLElement | null = null;
  /** 最近一次快照的 tick 与收到时间：快照之间按真实时间外推。 */
  private snapTick = 0;
  private snapAt = performance.now();
  private readonly ctx: Ctx;
  /** 探索 → 战斗的转场。 */
  private transition: { t: number; id: string; from: THREE.Vector3; look: THREE.Vector3; focus: () => THREE.Vector3 | null; cleanup: (() => void) | null; wipe: HTMLElement } | null = null;
  /** 自动化测试模式：固定世界种子、打开测试钩子。 */
  private readonly testMode = new URLSearchParams(location.search).get('test') === '1';
  private sceneStarted = false;
  /** 测试：冻结真实时间（只渲染），用 advance() 按步推进，截图时刻精确。 */
  private frozen = false;

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
      sail: (islandId) => this.beginSail(islandId),
      net: {
        role: () => this.session?.role ?? 'host',
        lan: () => this.session?.lan ?? null,
        openLan: async () => {
          try {
            const r = await this.session!.openLan(this.lanPort());
            this.ui.toast(`已开放局域网联机：端口 ${r.port}`);
          } catch (e) {
            this.ui.toast(`开放失败：${(e as Error).message}`, 'error');
          }
        },
        steamStatus: async () => (await netBridge()?.steamStatus()) ?? { available: false, error: '网页版不支持 Steam', name: null, appId: 480 },
        openSteam: async () => {
          const r = await this.session!.openSteam();
          if (!r.ok) this.ui.toast(r.error ?? 'Steam 房间创建失败', 'error');
        },
        steamLobby: () => this.session?.steamLobby ?? null,
        leave: () => void this.leaveAsGuest(),
      },
      visitIsland: (layout) => this.showVisit(layout),
      spirit: {
        stats: () => (this.session?.spirit ? { calls: this.session.spirit.calls, fallbacks: this.session.spirit.fallbacks, lastError: this.session.spirit.lastError } : null),
        sync: () => this.session?.syncAiMode() ?? Promise.resolve(),
      },
    };
    loadBlockedLines();
    this.gamepad = new GamepadInput(this.input, () => this.padContext());
    this.ui.navRoot = () => {
      if (this.mode === 'battle') return this.ui.layer.querySelector<HTMLElement>('#battle-ui');
      if (this.mode === 'title') return this.titleEl;
      return null;
    };
    this.hud.onPartyClick = (id) => {
      if (this.mode === 'explore' && !this.ui.capturing) openSpirit(this.ctx, id);
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
    panel.append(button('加入联机', () => void this.showJoin(panel, name.value)));
    panel.append(languageRow());
    this.titleEl = h('div', { id: 'title' }, h('h1', {}, '云海拾灵'), h('div', { class: 'sub' }, 'Cloudsea: Spirit Gathering · M2 联机预览'), panel);
    this.ui.layer.append(this.titleEl);
    focusFirst(panel);
    document.body.dataset['ready'] = 'true';
    // 双窗口联机调试（scripts/duo.mjs）：房主自动开新游戏并开放局域网；客人预填加入地址
    const qs = new URLSearchParams(location.search);
    if (qs.get('autohost') === '1' && !this.sceneStarted) {
      this.sceneStarted = true;
      this.startSession(GameSession.create('房主', this.testMode ? 20261017 : undefined));
      await this.ctx.net.openLan();
      return;
    }
    if (qs.get('join') && !this.sceneStarted) {
      this.sceneStarted = true;
      void this.showJoin(panel, '客人', qs.get('join')!);
    }
    // 测试模式的场景直达：?test=1&scene=swim
    const scene = this.testMode ? new URLSearchParams(location.search).get('scene') : null;
    if (scene && !this.sceneStarted) {
      this.sceneStarted = true;
      void this.runScene(scene);
    }
  }

  private lanPort(): number | undefined {
    const p = Number(new URLSearchParams(location.search).get('port'));
    return Number.isFinite(p) && p > 0 ? p : undefined;
  }

  /** 标题画面的“加入联机”（M2）：选角色（本机已有的或新建）、填房主地址。 */
  private async showJoin(panel: HTMLElement, defaultName: string, address = '127.0.0.1:47621'): Promise<void> {
    const net = netBridge();
    if (!net) {
      this.ui.toast('网页版不能联机', 'error');
      return;
    }
    const chars = await characterStore().list();
    let pick: string | null = chars[0]?.id ?? null;
    const name = h('input', { type: 'text', value: defaultName, maxlength: '16', style: 'width:140px' }) as HTMLInputElement;
    const addr = h('input', { type: 'text', value: address, style: 'width:220px', id: 'join-address' }) as HTMLInputElement;
    const list = h('div', { class: 'col', style: 'align-items:stretch;gap:4px' });
    const renderList = () => {
      list.replaceChildren(
        ...chars.map((c) => {
          let label = c.id;
          try {
            const ch = loadCharacter(JSON.parse(c.data));
            label = `${ch.name}（絮灵 ${Object.keys(ch.spirits).length} 只）`;
          } catch {
            /* 坏档只显示 id */
          }
          return button(label, () => ((pick = c.id), renderList()), { class: pick === c.id ? 'selected' : '' });
        }),
        button(h('span', {}, '新角色：', name), () => ((pick = null), renderList()), { class: pick === null ? 'selected' : '' }),
      );
    };
    renderList();
    const status = h('div', { class: 'muted', id: 'join-status' }, '房主在菜单 → 联机 里开放局域网后，把地址告诉你。');
    const go = async () => {
      status.textContent = tr('连接中……');
      const url = addr.value.includes('://') ? addr.value : `ws://${addr.value.includes(':') ? addr.value : `${addr.value}:47621`}`;
      const r = await net.joinLan(url);
      if (!r.ok) {
        status.textContent = tr(r.error ?? '连不上');
        return;
      }
      await this.joinWith(ipcClientTransport(net), pick ? chars.find((c) => c.id === pick)!.data : null, name.value, (msg) => (status.textContent = tr(msg)));
    };
    panel.replaceChildren(
      h('b', {}, '加入联机'),
      h('div', { class: 'muted' }, '用哪个角色：'),
      list,
      h('div', { class: 'row' }, h('span', {}, '房主地址'), addr),
      h('div', { class: 'row' }, button('加入', () => void go(), { class: 'primary' }), button('返回', () => this.backToTitle())),
      h('div', { class: 'muted' }, 'Steam：在 Steam 好友列表里接受邀请，会自动加入。'),
      status,
    );
    focusFirst(panel);
  }

  private backToTitle(): void {
    this.titleEl?.remove();
    this.titleEl = null;
    this.title?.dispose();
    this.title = null;
    void this.showTitle();
  }

  /** 带着角色连上房主（局域网或 Steam 的连接都已建立）。 */
  private async joinWith(transport: ClientTransport, charData: string | null, name: string, report: (msg: string) => void): Promise<void> {
    // 新角色随机一套衣服与围巾的颜色，联机时一眼分得清谁是谁
    const palette = [['#4A7FB0', '#F2E2B6'], ['#5C9A6E', '#E07A5F'], ['#8A6BB0', '#F0B143'], ['#C9A35A', '#3F8A86'], ['#B5533C', '#9FD0E8']] as const;
    const [cloth, scarf] = palette[Math.floor(Math.random() * palette.length)]!;
    const character = charData
      ? loadCharacter(JSON.parse(charData))
      : newCharacter(this.content, { id: newCharacterId(), name: name.trim().slice(0, 16) || '旅人', appearance: { skinTone: '#F2C9A0', hairColor: '#4A3426', clothColor: cloth, scarfColor: scarf } });
    try {
      const session = await GameSession.join(transport, character);
      this.startSession(session);
    } catch (e) {
      report(`加入失败：${(e as Error).message}`);
      transport.close();
    }
  }

  /** 客人离开：先存自己的角色，再回标题。 */
  private async leaveAsGuest(): Promise<void> {
    await this.session?.save();
    this.quitToTitle();
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
    session.client.onClose((reason) => {
      if (this.session !== session || reason === '已离开') return;
      this.ui.toast(`联机结束：${reason}`, 'error');
      void session.save().finally(() => this.session === session && this.quitToTitle());
    });
    this.world = session.client.world;
    this.enterExplore();
    void session.save();
    // 成就同步到 Steam（换了电脑、离线时解锁的都补上；重复解锁无害）
    for (const id of this.world?.characters[PLAYER_ID]?.achievements ?? []) void achievementBridge()?.unlock(steamName(id));
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
    this.snapTick = world.tick;
    this.snapAt = performance.now();
    const p = world.players[PLAYER_ID]!;
    // 云舟航行：出发、加速、抵达
    if (this.pendingVoyage && this.explore && (this.mode === 'explore' || this.mode === 'build' || this.mode === 'boarding')) {
      const v = this.pendingVoyage;
      this.pendingVoyage = null;
      this.startVoyage(world, v);
    }
    if (this.voyage) {
      if (p.voyage) this.voyage.setArrive(p.voyage.arriveTick);
      else if (p.islandId === this.voyage.dest.islandId) this.finishVoyage(world);
      return;
    }
    if (this.pendingBattle && world.battles[this.pendingBattle] && !this.battle && !this.cutscene && !this.transition) {
      const id = this.pendingBattle;
      this.pendingBattle = null;
      const b = world.battles[id]!;
      if (b.kind === 'scripted' && this.explore) this.playAmbush(world, id, b);
      else if (this.explore) this.transitionToBattle(id, this.battleFocus(b));
      else this.startBattleView(world, id);
    }
    if (this.battle) this.battle.setWorld(world);
    if (this.battle && this.pendingRebuild && world.battles[this.pendingRebuild]) {
      this.battle.rebuild(world.battles[this.pendingRebuild]!);
      this.pendingRebuild = null;
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
    if (this.mode === 'explore' || this.mode === 'build' || this.mode === 'boarding' || this.mode === 'landing') {
      if (this.explore && this.explore.islandId !== p.islandId && this.mode !== 'boarding') {
        this.sailTransition(p.islandId);
        return;
      }
      this.explore?.sync(world);
      this.build?.setWorld(world);
    }
  }

  private startVoyage(world: Readonly<WorldState>, v: Extract<WorldEvent, { t: 'voyageStart' }>): void {
    if (!this.explore) return;
    this.build?.dispose();
    this.build = null;
    this.ui.closeAllModals();
    const toHome = v.to === homeIslandId(PLAYER_ID);
    const island = this.content.islands.get(v.to);
    const landing = toHome ? { x: HOME_DOCK.x, z: HOME_DOCK.z - 2.5 } : arrivalPoint(island!);
    // 目的岛场景在起飞时就开始搭建（航行途中逐级显示）
    const dest = new ExploreView(this.content, world, this.camera, v.to, { ...landing, yaw: Math.PI });
    this.voyage = new VoyageView(this.content, world, this.explore, dest, this.camera, v.departTick, v.arriveTick);
    this.mode = 'voyage';
    this.hud.clear();
    this.ui.tutorial.classList.add('hidden');
    const name = toHome ? '家园岛' : island?.name ?? '';
    this.voyageLabel = h('div', { class: 'cine on' }, h('div', { class: 'letterbox top' }), h('div', { class: 'letterbox bottom' }), h('div', { class: 'cine-sub' }, h('span', {}, `云舟起航 · 前往 ${name}`)), h('div', { class: 'cine-skip' }, '空格 加速'));
    this.ui.layer.append(this.voyageLabel);
  }

  private finishVoyage(world: Readonly<WorldState>): void {
    const v = this.voyage!;
    v.finish();
    v.dispose();
    this.explore?.dispose();
    this.explore = v.dest;
    this.voyage = null;
    this.voyageLabel?.remove();
    this.voyageLabel = null;
    this.explore.sync(world);
    // 下船（v0.6）：从甲板跳到栈桥 / 码头，再交还操作
    this.mode = 'landing';
    const ex = this.explore;
    void ex.disembark().then(() => {
      if (this.explore !== ex || this.mode !== 'landing') return;
      this.mode = 'explore';
      this.ui.tutorial.classList.remove('hidden');
      const island = this.content.islands.get(ex.islandId);
      if (island) this.playCutscene(`arrive:${island.id}`, arrivalShots(ex, island), () => {});
    });
  }

  /** 出航（v0.6）：先预检，能走就播上船，再发意图；失败时下船。 */
  private async beginSail(islandId: string): Promise<boolean> {
    const w = this.world;
    const ex = this.explore;
    if (!w || !ex) return false;
    const blocked = sailBlocked(this.content, w.players[PLAYER_ID]!, w.characters[PLAYER_ID]!, PLAYER_ID, islandId, w);
    if (blocked) {
      this.ui.toast(blocked, 'error');
      return false;
    }
    this.ui.closeAllModals();
    this.build?.dispose();
    this.build = null;
    this.mode = 'boarding';
    this.hud.clear();
    this.ui.tutorial.classList.add('hidden');
    await ex.board();
    if (this.explore !== ex) return false;
    const ok = await this.act({ type: 'sail', islandId });
    if (!ok) {
      await ex.disembark();
      this.mode = 'explore';
      this.ui.tutorial.classList.remove('hidden');
    }
    return ok;
  }

  /** 战斗转场的焦点：野生絮灵 / 守岛人的头。 */
  private battleFocus(b: ActiveBattle): () => THREE.Vector3 | null {
    const ex = this.explore;
    return () => {
      if (!ex) return null;
      if (b.wildId) return ex.creatureView(b.wildId)?.headPos() ?? null;
      if (b.cloudlordId) return new THREE.Vector3(CLOUDLORD_SPOT.x, ex.ground(CLOUDLORD_SPOT.x, CLOUDLORD_SPOT.z) + 1.8, CLOUDLORD_SPOT.z);
      if (b.keeperId) {
        const k = ex.keeperView(b.keeperId);
        return k ? new THREE.Vector3(k.x, k.feetY + 1.4, k.z) : null;
      }
      return null;
    };
  }

  /** 第一场战斗前：蚀化絮灵从远处冲过来 + 推镜（v0.6），再转场进战斗。 */
  private playAmbush(world: Readonly<WorldState>, id: string, b: ActiveBattle): void {
    const ex = this.explore!;
    const u = b.state.sides[1].units[0]!;
    const view = new CreatureView(lookFromSpirit(this.content, battleUnitSpirit(world, b, u)));
    const P = ex.player;
    // 出现点：约 10 米外、不在水里，冲过来的直线离核心塔和失事的云舟都远（不穿模，v0.7）
    const clearOf = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(ax + dx * t - cx, az + dz * t - cz);
    };
    const W = ExploreView.WRECK;
    let spot = { x: P.x + 4, z: P.z + 4, a: 0 };
    for (let i = 0; i < 24; i++) {
      const a = Math.atan2(-P.x, -P.z) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.3;
      const x = P.x + Math.sin(a) * 10;
      const z = P.z + Math.cos(a) * 10;
      if (!ex.terrain.inside(x, z, 1.5) || ex.terrain.isWater(x, z)) continue;
      if (clearOf(x, z, P.x, P.z, 0, 0) < 2.6 || clearOf(x, z, P.x, P.z, W.x, W.z) < 3.2) continue;
      spot = { x, z, a };
      break;
    }
    P.yaw = spot.a;
    P.lookAt = { x: spot.x, z: spot.z };
    ex.spawnFromMist('ambusher', view, spot.x, spot.z, spot.a + Math.PI, () => {
      view.maxSpeed *= 1.8;
      view.moveTo(P.x + Math.sin(spot.a) * 2.6, P.z + Math.cos(spot.a) * 2.6);
    });
    const focus = () => ex.actor('ambusher')?.headPos() ?? null;
    this.playCutscene('ambush', ambushShots(ex, 'ambusher'), () => this.transitionToBattle(id, focus, () => ex.removeActor('ambusher')));
  }

  /** 探索 → 战斗：镜头向对手推近、纸色淡出，然后进战斗（战斗镜头从对手身边拉回）。 */
  private transitionToBattle(id: string, focus: () => THREE.Vector3 | null, cleanup: (() => void) | null = null): void {
    if (!this.explore) return;
    this.ui.closeAllModals();
    this.build?.dispose();
    this.build = null;
    this.hud.clear();
    this.ui.tutorial.classList.add('hidden');
    this.mode = 'transition';
    this.explore.cameraLocked = true;
    const wipe = h('div', { class: 'battle-wipe' });
    this.ui.layer.append(wipe);
    const look = this.explore.followPose().look;
    this.transition = { t: 0, id, from: this.camera.position.clone(), look, focus, cleanup, wipe };
  }

  private static readonly TRANSITION_SECONDS = 0.55;

  private stepTransition(dt: number): void {
    const tr = this.transition!;
    tr.t += dt;
    const k = Math.min(1, tr.t / App.TRANSITION_SECONDS);
    const e = k * k;
    const f = tr.focus() ?? tr.look;
    this.camera.position.lerpVectors(tr.from, f, e * 0.6);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(tr.look, f, Math.min(1, k * 1.6)));
    if (k >= 1 && this.world?.battles[tr.id]) {
      this.transition = null;
      tr.cleanup?.();
      if (this.explore) this.explore.cameraLocked = false;
      this.startBattleView(this.world, tr.id);
      tr.wipe.classList.add('out');
      setTimeout(() => tr.wipe.remove(), 700);
    } else if (k >= 1) {
      // 战斗已经不在了（例如测试里直接结束）：撤掉转场
      this.transition = null;
      tr.cleanup?.();
      tr.wipe.remove();
      if (this.explore) this.explore.cameraLocked = false;
      this.mode = 'explore';
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

  /** 终章（M3-2）：五座灯塔全部重燃。 */
  private playFinale(): void {
    this.ui.say(
      '云海',
      [
        '五座灯塔同时亮着。光从晴原一直连到雾海，像一条重新接上的线。',
        '蚀雾退回了云海深处。被它吞没的絮灵一只只醒了过来。',
        '灯塔会的人说，很久很久以前，群岛就是这样亮着的。',
        '你提着灯站在岛核前。家园岛上的絮灵们围了过来。',
        '群岛重燃了。但云海很大——还有很多絮灵在等你遇见。',
      ],
      '终章 · 群岛重燃',
      () => this.ui.toast('感谢游玩！世界会继续运转：繁殖、经营、和朋友一起探索都可以继续。'),
    );
  }

  private onEvents(events: readonly WorldEvent[]): void {
    const c = this.world?.characters[PLAYER_ID];
    for (const e of events) {
      // 别人加入 / 离开世界（M2）：事件里的 playerId 是那个人
      if (e.t === 'playerJoined' || e.t === 'playerLeft') {
        if (e.playerId !== PLAYER_ID) this.ui.toast(`${e.name} ${e.t === 'playerJoined' ? '加入了世界' : '离开了世界'}`);
        continue;
      }
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
        case 'voyageStart':
          this.pendingVoyage = e;
          break;
        case 'battleTurn':
          this.pendingTurns.push({ battleId: e.battleId, events: e.events });
          break;
        case 'battleEnd':
          this.pendingEnd = e;
          if (c && !c.tutorial.done && c.tutorial.step === 2) void this.act({ type: 'tutorial', step: 3 });
          break;
        case 'dialogue': {
          const name = this.content.keepers.get(e.keeperId)?.name ?? '';
          if (e.generated) {
            // 客人端显示前再过滤一次（DESIGN 11.6）；被屏蔽的换成省略号
            const lines = e.lines.map((l) => (isBlocked(l) ? '……' : l));
            this.ui.say(name, lines, e.title, undefined, { onBlock: (line) => {
              rememberBlocked(line);
              this.ui.toast('已屏蔽这句话，以后不会再显示');
            } });
          } else this.ui.say(name, e.lines, e.title);
          break;
        }
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
        case 'battleJoined':
          // 有人加入了这场战斗：战斗按新人数重建，界面等下一份快照刷新
          this.pendingRebuild = e.battleId;
          if (e.joiner !== PLAYER_ID) this.ui.toast(`${this.world?.characters[e.joiner]?.name ?? '队友'} 加入了战斗`);
          break;
        case 'lighthouseLit': {
          const cl = this.content.cloudlords.get(e.cloudlordId);
          const region = cl ? REGION_NAME[cl.region] : '这片群岛';
          const next = cl ? REGIONS[REGIONS.indexOf(cl.region) + 1] : undefined;
          const lines = ['塔顶的灯一点一点亮了起来。', `笼罩着${region}的蚀雾退去了。被净化的${cl?.name.replace(/^蚀化的/, '') ?? '云主'}安静地趴在塔下。`];
          if (next) lines.push(`远处，${REGION_NAME[next]}方向的浓雾也薄了一些——星图上能看到那边的岛了。`);
          const finale = events.some((x) => x.t === 'finale' && x.playerId === PLAYER_ID);
          this.ui.say('灯塔', lines, '灯塔重燃', finale ? () => this.playFinale() : undefined);
          break;
        }
        case 'achievement': {
          const a = this.content.achievements.get(e.achievementId);
          if (a) this.ui.toast(`成就达成：${a.name}`, 'achievement');
          void achievementBridge()?.unlock(steamName(e.achievementId));
          break;
        }
        case 'npcLine':
          this.ui.say(e.speaker, e.lines);
          break;
        case 'recovered': {
          const s = this.world?.characters[PLAYER_ID]?.spirits[e.spiritId];
          if (s && s.state === 'party') this.ui.toast(`${s.nickname ?? this.content.forms.get(s.formId)?.form.name ?? '絮灵'} 恢复了`);
          break;
        }
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
        this.explore?.startGather(it, () => void this.act({ type: 'gather', nodeId: it.id }));
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
      case 'recruit': {
        const s = c.spirits[it.id];
        if (!s) break;
        const name = s.nickname ?? this.content.forms.get(s.formId)!.form.name;
        if (c.party.length >= ECONOMY.partyMax) {
          this.ui.toast(`队伍满了（${ECONOMY.partyMax} 只），先在菜单里让一只留下`, 'error');
          break;
        }
        if (await this.act({ type: 'setParty', spiritIds: [...c.party, it.id] }, `${name} 跟上了你`)) this.explore?.celebrate(it.id);
        break;
      }
      case 'joinBattle':
        await this.act({ type: 'joinBattle', battleId: it.id });
        break;
      case 'cloudlord':
        await this.act({ type: 'challengeCloudlord', cloudlordId: it.id });
        break;
      case 'guardian':
        await this.act({ type: 'challengeGuardian', cloudlordId: it.id });
        break;
      case 'starter':
        if (await this.act({ type: 'adoptStarter' })) {
          await this.act({ type: 'tutorial', step: 2 });
          const id = `${PLAYER_ID}-s1`;
          setTimeout(() => this.explore?.celebrate(id), 300);
          // 对话结束后蚀化絮灵冲过来（袭击播片 + 战斗转场，v0.6）
          this.ui.say('……', ['云气慢慢凝成了一只小小的絮灵。', '它蹭了蹭你的手，好像认识你。', '这是旧大地的一段记忆——一片晒着太阳的麦田。'], '暖芽', () => void this.act({ type: 'tutorialBattle' }));
        }
        break;
    }
  }

  /** 场景直达用的宿主（只发意图）。 */
  private scenarioHost(): ScenarioHost {
    return {
      newGame: async (prep) => {
        this.titleEl?.remove();
        this.titleEl = null;
        this.startSession(GameSession.create('小禾', 20261017, prep));
      },
      act: async (intent) => (await this.session?.client.request(intent)) ?? { ok: false, error: '没有会话' },
      world: () => this.world!,
      mode: () => this.mode,
      teleport: (x, z, yaw) => this.testTeleport(x, z, yaw),
      fastForward: (ticks) => this.fastForward(ticks),
      skipCutscene: () => this.cutscene?.skip(),
      closeDialogues: () => this.ui.skipDialogues(),
      setCamera: (yaw, pitch, dist) => {
        if (!this.explore) return;
        this.explore.camYaw = yaw;
        this.explore.camPitch = pitch;
        this.explore.camDist = dist;
      },
      advance: (seconds) => this.advance(seconds),
      interactNearest: async () => {
        if (this.explore?.nearest) await this.interact(this.explore.nearest);
      },
      sail: async (islandId) => {
        await this.beginSail(islandId);
      },
    };
  }

  private async runScene(name: string): Promise<void> {
    const sc = SCENARIOS[name];
    if (!sc) {
      this.ui.toast(`没有这个测试场景：${name}（可用：${Object.keys(SCENARIOS).join('、')}）`, 'error');
      return;
    }
    await sc.run(this.scenarioHost());
    document.body.dataset['scene'] = name;
  }

  private testTeleport(x: number, z: number, yaw?: number): void {
    if (!this.explore) return;
    this.explore.player.setPosition(x, z, yaw ?? this.explore.player.yaw);
    this.session?.client.fire({ type: 'move', x, z, yaw: yaw ?? this.explore.player.yaw });
  }

  private fastForward(ticks: number): void {
    for (let i = 0; i < ticks; i += 50) this.session?.host?.update(5000);
  }

  /** 按固定步长推进（不渲染）：播片与动画定格用。 */
  private advance(seconds: number): void {
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) this.step(dt);
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
      teleport: (x: number, z: number, yaw?: number) => this.testTeleport(x, z, yaw),
      nearest: () => this.explore?.nearest ?? null,
      interactables: () => this.explore?.allInteractables() ?? [],
      interact: () => (this.explore?.nearest ? this.interact(this.explore.nearest) : null),
      fastForward: (ticks: number) => this.fastForward(ticks),
      setCamera: (yaw: number, pitch: number, dist: number) => this.scenarioHost().setCamera(yaw, pitch, dist),
      dialogueOpen: () => this.ui.dialogueOpen,
      voyageProgress: () => this.voyage?.progress ?? null,
      modalOpen: () => this.ui.modalOpen,
      /** v0.6：场景直达、按步推进、出航（含上船）、玩家状态。 */
      scene: (name: string) => this.runScene(name),
      scenes: () => Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [k, v.desc])),
      advance: (seconds: number) => this.advance(seconds),
      sail: (islandId: string) => this.beginSail(islandId),
      skipCutscene: () => this.cutscene?.skip(),
      player: () => {
        const P = this.explore?.player;
        return P ? { x: P.x, z: P.z, y: P.feetY, yaw: P.yaw, swim: P.swim, swimming: P.swimming, airborne: P.airborne, scripted: this.explore!.scripted } : null;
      },
      battlePositions: () => this.battle?.positions() ?? null,
      buildCursor: () => this.build?.cursorScreen() ?? null,
      /** 图鉴陈列（测试）：40 个形态排成方阵，page 0 / 1 各一半。 */
      gallery: (page: number) => this.showGallery(page),
      creature: (id: string) => {
        const v = this.explore?.creatureView(id);
        return v ? { x: v.x, z: v.z } : null;
      },
      freeze: (on: boolean) => {
        this.frozen = on;
      },
      cutsceneTime: () => this.cutscene?.elapsed ?? null,
      /** 镜头（手柄测试用，M4-2）。 */
      camera: () => (this.explore ? this.explore.cameraState() : null),
    };
  }

  // ---------------------------------------------------------------- 主循环


  /** 手柄按键在当前画面的含义（M4-2）。 */
  private padContext(): PadContext {
    if (this.ui.dialogueOpen || this.ui.modalOpen || this.mode === 'battle' || this.mode === 'title' || this.mode === 'visit') return 'ui';
    if (this.mode === 'explore') return 'explore';
    if (this.mode === 'voyage') return 'voyage';
    if (this.mode === 'build') return 'build';
    return 'none';
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.gamepad.update(dt);
    this.hud.pad = this.gamepad.active;
    if (!this.frozen) this.step(dt);
    this.render();
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** 推进一帧逻辑（不渲染）。 */
  private step(dt: number): void {
    this.session?.update(dt * 1000);
    const input = this.input;
    if (this.mode === 'title' && this.title) {
      this.title.update(dt, this.camera);
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
      if (this.mode === 'explore') this.hud.update(this.world, this.explore.nearest, 'explore', this.ui.capturing);
      this.hud.nameplates(this.mode === 'explore' ? this.explore.nameplates().map((n) => ({ ...n, screen: this.explore!.project(n.pos, innerWidth, innerHeight) })) : []);
      this.tutorial?.update(this.world, this.explore);
    } else if (this.mode === 'visit') {
      if (input.hit('Escape') || input.hit('Enter')) this.endVisit();
    } else if ((this.mode === 'boarding' || this.mode === 'landing') && this.explore) {
      this.explore.update(dt, null, (x, z, yaw) => this.session?.client.fire({ type: 'move', x, z, yaw }), false);
    } else if (this.mode === 'transition' && this.explore) {
      this.explore.update(dt, null, () => {}, false);
      this.stepTransition(dt);
    } else if (this.mode === 'build' && this.explore && this.build && this.world) {
      this.explore.update(dt, null, () => {}, false);
      if (!this.ui.capturing) this.build.update(input);
      this.hud.update(this.world, null, 'build', this.ui.capturing);
    } else if (this.mode === 'voyage' && this.voyage) {
      if (input.hit('Space') || input.hit('Enter')) void this.act({ type: 'hurryVoyage' });
      const tick = this.snapTick + ((performance.now() - this.snapAt) / 1000) * 10;
      this.voyage.update(dt, tick);
    } else if (this.mode === 'cutscene' && this.explore && this.cutscene) {
      this.explore.update(dt, null, () => {}, false);
      this.cutscene.update(dt, this.camera);
    } else if (this.mode === 'battle' && this.battle) {
      this.battle.update(dt);
    }
  }

  private gallery: { scene: THREE.Scene; env: Environment; views: CreatureView[]; t: number } | null = null;

  /** 图鉴陈列（测试 / 自查用）：所有形态按编号排成方阵，每只带名字。 */
  private showGallery(page: number): void {
    this.titleEl?.remove();
    this.titleEl = null;
    this.gallery?.views.forEach((v) => v.dispose());
    const scene = new THREE.Scene();
    const env = new Environment(scene, { farIslands: false });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8d48a, flatShading: true }));
    scene.add(ground);
    const forms = [...this.content.forms.values()].sort((a, b) => a.form.no - b.form.no).slice(page * 20, page * 20 + 20);
    const rng = createRng(77);
    const views: CreatureView[] = [];
    const labels = h('div', { id: 'gallery-labels' });
    this.ui.layer.querySelector('#gallery-labels')?.remove();
    this.ui.layer.append(labels);
    forms.forEach((f, i) => {
      const s = createSpirit(this.content, { id: `g-${f.form.id}`, ownerId: 'g', genes: generateWildGenes(rng, f.line), level: 40, formIndex: f.index });
      const v = new CreatureView(lookFromSpirit(this.content, s));
      const x = ((i % 5) - 2) * 3.6;
      const z = (Math.floor(i / 5) - 1.5) * 3.4;
      v.setPosition(x, z, 0.3);
      scene.add(v.group);
      views.push(v);
      labels.append(h('div', { class: 'nameplate', 'data-x': String(x), 'data-z': String(z) }, `${f.form.no} ${f.form.name}`));
    });
    this.gallery = { scene, env, views, t: 0 };
    this.mode = 'gallery';
    this.camera.position.set(0, 13, 15);
    this.camera.lookAt(0, 0, 0.8);
    this.camera.updateMatrixWorld(true);
    for (const el of labels.children) {
      const p = new THREE.Vector3(Number((el as HTMLElement).dataset['x']), 0, Number((el as HTMLElement).dataset['z']) + 1.3).project(this.camera);
      (el as HTMLElement).style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth}px, ${(-p.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, 0)`;
    }
  }

  // ---------------------------------------------------------------- 参观岛屿码（M3-5）

  private visit: { scene: THREE.Scene; env: Environment; t: number; radius: number; panel: HTMLElement } | null = null;

  /** 参观别人的岛（岛屿码）：只看不改，镜头绕岛慢慢转；Esc 或“回去”返回。 */
  private showVisit(layout: IslandLayout): void {
    if (this.mode !== 'explore') return;
    this.ui.closeAllModals();
    const scene = new THREE.Scene();
    const env = new Environment(scene, { farIslands: false });
    const terrain = homeTerrain(layout.seed, layout.coreLevel);
    scene.add(buildIslandMesh(terrain, { grassHue: 0.25, clear: () => false }));
    let n = 0;
    for (const b of layout.buildings) {
      const def = this.content.buildings.get(b.type);
      if (!def) continue;
      const fp = footprint(def, b.rot);
      const y = Math.max(terrain.height(b.x, b.z), terrain.height(b.x + fp.w, b.z), terrain.height(b.x, b.z + fp.d), terrain.height(b.x + fp.w, b.z + fp.d));
      const v = makeBuildingView(b.type, def.size.w, def.size.d, n++ * 7919 + 13);
      v.group.position.set(b.x + fp.w / 2, y, b.z + fp.d / 2);
      v.group.rotation.y = -b.rot * (Math.PI / 2);
      v.update({ built: true, progress: 1, crop: b.crop ? { id: b.crop, growth: 0.85 } : null, working: true }, 0);
      for (const g of v.glows) env.glowMaterials.add(g);
      scene.add(v.group);
    }
    const panel = h(
      'div',
      { id: 'visit-panel', class: 'panel' },
      h('b', {}, '参观 · 别人的岛'),
      h('span', { class: 'muted' }, `岛核 ${layout.coreLevel} 级 · ${n} 座建筑`),
      button('回去（Esc）', () => this.endVisit(), { class: 'small' }),
    );
    this.ui.layer.append(panel);
    this.hud.clear();
    this.visit = { scene, env, t: 0, radius: 18 + layout.coreLevel * 2.5, panel };
    this.mode = 'visit';
  }

  private endVisit(): void {
    if (!this.visit) return;
    this.visit.panel.remove();
    this.visit.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.visit = null;
    this.mode = 'explore';
  }

  private render(): void {
    if (this.mode === 'visit' && this.visit) {
      const v = this.visit;
      v.t += 1 / 60;
      const a = v.t * 0.12;
      this.camera.position.set(Math.sin(a) * v.radius * 1.5, v.radius * 0.75, Math.cos(a) * v.radius * 1.5);
      this.camera.lookAt(0, 1, 0);
      v.env.update(1 / 60, v.t, this.camera, new THREE.Vector3());
      this.renderer.render(v.scene, this.camera);
      return;
    }
    if (this.mode === 'gallery' && this.gallery) {
      const gl = this.gallery;
      gl.t += 1 / 60;
      for (const v of gl.views) v.update(1 / 60, gl.t, () => 0);
      gl.env.update(1 / 60, gl.t, this.camera, new THREE.Vector3());
      this.renderer.render(gl.scene, this.camera);
      return;
    }
    if (this.mode === 'title' && this.title) this.renderer.render(this.title.scene, this.camera);
    else if (this.mode === 'voyage' && this.voyage) this.renderer.render(this.voyage.scene, this.camera);
    else if (this.mode === 'battle' && this.battle) this.renderer.render(this.battle.scene, this.camera);
    else if (this.explore) this.renderer.render(this.explore.scene, this.camera);
  }
}

