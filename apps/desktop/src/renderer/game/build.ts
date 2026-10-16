import type { ContentDb } from '@cloudsea/content';
import { footprint, foundationHeight, placementBlocker, type Rotation, type WorldState } from '@cloudsea/sim';
import { makeBuildingView, type BuildingView } from '@cloudsea/render';
import { button, clear, h, icon } from '@cloudsea/ui';
import * as THREE from 'three';
import type { ExploreView } from './explore';
import type { Input } from './input';
import { itemName } from './text';
import { PLAYER_ID } from './session';
import type { UiRoot } from './uiRoot';

/**
 * 建造模式（DESIGN 7、14.3）：俯视 45° 镜头、网格高亮、半透明预览。
 * 预览用和房主同一个 placementBlocker 判断，最终仍由房主校验。
 */
export class BuildMode {
  private selected: string | null = null;
  private rot: Rotation = 0;
  private ghost: BuildingView | null = null;
  private readonly cursor: THREE.Mesh;
  private readonly grid: THREE.GridHelper;
  private readonly bar = h('div', { id: 'build-bar' });
  private cell: { x: number; z: number } | null = null;
  private blocker: string | null = null;
  private readonly ray = new THREE.Raycaster();

  constructor(
    private readonly content: ContentDb,
    private readonly ui: UiRoot,
    private readonly view: ExploreView,
    private readonly camera: THREE.PerspectiveCamera,
    private world: Readonly<WorldState>,
    private readonly place: (type: string, x: number, z: number, rot: Rotation) => Promise<boolean>,
    private readonly exit: () => void,
  ) {
    const size = Math.ceil(view.terrain.params.radius * 1.7);
    this.grid = new THREE.GridHelper(size, size, 0xffffff, 0xffffff);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.12;
    (this.grid.material as THREE.Material).depthWrite = false;
    this.grid.position.y = 0.25;
    view.scene.add(this.grid);
    this.cursor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), new THREE.MeshBasicMaterial({ color: 0x5cc8a0, transparent: true, opacity: 0.45, depthWrite: false }));
    view.scene.add(this.cursor);
    ui.layer.append(this.bar);
    this.renderBar();
  }

  setWorld(world: Readonly<WorldState>): void {
    const prevShells = this.world.characters[PLAYER_ID]?.shells;
    this.world = world;
    if (prevShells !== world.characters[PLAYER_ID]?.shells) this.renderBar();
  }

  private renderBar(): void {
    clear(this.bar);
    const c = this.world.characters[PLAYER_ID]!;
    const home = this.world.homes[PLAYER_ID]!;
    const list = h('div', { class: 'build-list' });
    for (const id of c.blueprints) {
      const def = this.content.buildings.get(id);
      if (!def) continue;
      const cost = [def.cost.shells ? `${def.cost.shells} 云贝` : '', ...def.cost.items.map((s) => `${itemName(this.content, s.item)}×${s.count}`)].filter(Boolean).join('、');
      const locked = home.coreLevel < def.coreLevel;
      const b = button([h('b', {}, def.name), h('span', { class: 'muted' }, locked ? `岛核 ${def.coreLevel} 级解锁` : cost || '免费')], () => this.select(id), { class: this.selected === id ? 'selected' : '', disabled: locked, title: def.description });
      list.append(b);
    }
    this.bar.append(
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('b', {}, '建造'), h('span', { class: 'row' }, icon('shell'), String(c.shells), button('完成', () => this.exit(), { class: 'small' }))),
        list,
        h('div', { class: 'muted', style: 'margin-top:4px' }, this.selected ? (this.blocker ? `不能放这里：${this.blocker}` : '点击放置 · R 旋转') : '选择要建的建筑'),
      ),
    );
  }

  private select(id: string): void {
    this.selected = id;
    this.rot = 0;
    this.rebuildGhost();
    this.renderBar();
  }

  private rebuildGhost(): void {
    if (this.ghost) this.view.scene.remove(this.ghost.group);
    this.ghost = null;
    if (!this.selected) return;
    const def = this.content.buildings.get(this.selected)!;
    const fp = footprint(def, this.rot);
    this.ghost = makeBuildingView(this.selected, fp.w, fp.d, 1);
    this.ghost.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = (m.material as THREE.Material).clone();
        (m.material as THREE.Material).transparent = true;
        (m.material as THREE.Material).opacity = 0.55;
        m.castShadow = false;
      }
    });
    this.ghost.update({ built: true, progress: 1, crop: null, working: false }, 0);
    this.view.scene.add(this.ghost.group);
  }

  update(input: Input): void {
    // 俯视镜头跟着玩家
    const P = this.view.player;
    this.camera.position.set(P.x + 9, this.view.ground(P.x, P.z) + 12, P.z + 9);
    this.camera.lookAt(P.x, this.view.ground(P.x, P.z), P.z);
    if (input.hit('Escape') || input.rightClicked) {
      if (this.selected) {
        this.selected = null;
        this.rebuildGhost();
        this.renderBar();
      } else this.exit();
      return;
    }
    if (input.hit('KeyR') && this.selected) {
      this.rot = ((this.rot + 1) % 4) as Rotation;
      this.rebuildGhost();
    }
    // 鼠标射线 → 地面网格
    const ndc = new THREE.Vector2((input.mouseX / innerWidth) * 2 - 1, -(input.mouseY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    let hit: THREE.Vector3 | null = null;
    for (let d = 1; d < 80; d += 0.25) {
      const p = this.ray.ray.at(d, new THREE.Vector3());
      if (p.y <= this.view.ground(p.x, p.z)) {
        hit = p;
        break;
      }
    }
    if (!hit || !this.selected) {
      this.cursor.visible = false;
      if (this.ghost) this.ghost.group.visible = false;
      return;
    }
    const def = this.content.buildings.get(this.selected)!;
    const fp = footprint(def, this.rot);
    const x = Math.round(hit.x - fp.w / 2);
    const z = Math.round(hit.z - fp.d / 2);
    const c = this.world.characters[PLAYER_ID]!;
    const home = this.world.homes[PLAYER_ID]!;
    const blocker = placementBlocker(this.content, home, c, this.selected, x, z, this.rot, false, [home.storage, c.backpack]);
    if (!this.cell || this.cell.x !== x || this.cell.z !== z || blocker !== this.blocker) {
      this.cell = { x, z };
      this.blocker = blocker;
      this.renderBar();
    }
    const y = foundationHeight(this.content, home, { type: this.selected, x, z, rot: this.rot });
    this.cursor.visible = true;
    this.cursor.scale.set(fp.w, 1, fp.d);
    this.cursor.position.set(x + fp.w / 2, y + 0.05, z + fp.d / 2);
    (this.cursor.material as THREE.MeshBasicMaterial).color.set(blocker ? 0xd9534f : 0x5cc8a0);
    if (this.ghost) {
      this.ghost.group.visible = true;
      this.ghost.group.position.set(x + fp.w / 2, y, z + fp.d / 2);
    }
    this.grid.position.set(0, this.view.ground(P.x, P.z) + 0.05, 0);
    if (input.clicked) {
      if (blocker) this.ui.toast(blocker, 'error');
      else void this.place(this.selected, x, z, this.rot);
    }
  }

  dispose(): void {
    if (this.ghost) this.view.scene.remove(this.ghost.group);
    this.view.scene.remove(this.cursor, this.grid);
    this.bar.remove();
  }
}
