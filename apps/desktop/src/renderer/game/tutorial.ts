import { type WorldState } from '@cloudsea/sim';
import { clear, h } from '@cloudsea/ui';
import * as THREE from 'three';
import type { ExploreView } from './explore';
import { PLAYER_ID } from './session';
import type { UiRoot } from './uiRoot';

/**
 * 新手引导（DESIGN 13，前 30 分钟）：
 * 0 坠落荒岛（移动） → 1 第一只絮灵（互动） → 2 蚀化絮灵袭击（第一场战斗）
 * → 3 捕获第一只野生絮灵 → 4 建栖巢、安排打工 → 5 点亮第一盏灯（引出主线）→ 完成
 */
export const STARTER_SPOT = { x: 2.5, z: 4.5 } as const;

const HINTS: Record<number, string> = {
  0: '你的风帆在云海中失事，坠落到这座荒岛上。<br>用 <b>WASD</b> 走一走，<b>拖动鼠标</b>转动视角。',
  1: '岛上有一团温暖的云气在发光。走近它，按 <b>E</b>。',
  2: '小心！',
  3: '去码头（按 <b>E</b>）打开<b>星图</b>，出航到<b>麦浪坡</b>。<br>靠近野生絮灵按 <b>E</b> 接触，在战斗里用<b>灯露</b>邀请它加入。先打掉它一些体力，成功率更高。',
  4: '回到家园岛，按 <b>B</b> 建一座<b>栖巢</b>。<br>在菜单（<b>Tab</b>）里让一只絮灵离开队伍，再对着建筑按 <b>E</b> 安排它<b>打工</b>——建筑会建得更快。',
  5: '走到岛中央的<b>岛核</b>前按 <b>E</b>，点亮岛上的第一盏灯。',
};

export class Tutorial {
  private puff: THREE.Sprite | null = null;
  private moved = 0;
  private last: { x: number; z: number } | null = null;
  private shownStep = -1;
  private introDone = false;

  constructor(
    private readonly ui: UiRoot,
    private readonly advance: (step: number, done?: boolean) => void,
  ) {}

  /** 每帧调用：根据角色进度更新提示、发光云团与完成条件。 */
  update(world: Readonly<WorldState>, view: ExploreView | null): void {
    const c = world.characters[PLAYER_ID]!;
    const step = c.tutorial.done ? 99 : c.tutorial.step;
    if (step !== this.shownStep) {
      this.shownStep = step;
      clear(this.ui.tutorial);
      const hint = HINTS[step];
      this.ui.tutorial.classList.toggle('hidden', !hint);
      if (hint) this.ui.tutorial.append(h('div', { class: 'panel', html: `<div class="muted">引导</div>${hint}` }));
      if (step === 0 && !this.introDone) {
        this.introDone = true;
        this.ui.say('……', ['风帆在云海里打转，桅杆断了。', '你抓着提灯，摔在一片柔软的草地上。', '四周很安静。这是一座没有人的小岛。'], '坠落');
      }
    }
    if (!view) return;

    if (step === 0 && view.isHome) {
      const p = view.player;
      if (this.last) this.moved += Math.hypot(p.x - this.last.x, p.z - this.last.z);
      this.last = { x: p.x, z: p.z };
      if (this.moved > 4) this.advance(1);
    }

    // 第一只絮灵：发光的云气团
    const wantPuff = step <= 1 && view.isHome && Object.keys(c.spirits).length === 0;
    if (wantPuff && !this.puff) {
      const tex = new THREE.CanvasTexture((() => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const g = cv.getContext('2d')!;
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,240,200,1)');
        gr.addColorStop(0.4, 'rgba(255,210,140,.6)');
        gr.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        return cv;
      })());
      tex.colorSpace = THREE.SRGBColorSpace;
      this.puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      this.puff.scale.setScalar(1.4);
      this.puff.position.set(STARTER_SPOT.x, view.ground(STARTER_SPOT.x, STARTER_SPOT.z) + 0.8, STARTER_SPOT.z);
      view.scene.add(this.puff);
    }
    if (this.puff) {
      if (!wantPuff) {
        view.scene.remove(this.puff);
        this.puff = null;
      } else this.puff.position.y = view.ground(STARTER_SPOT.x, STARTER_SPOT.z) + 0.8 + Math.sin(performance.now() / 400) * 0.12;
    }
    view.extraInteractables = wantPuff ? [{ kind: 'starter', id: 'starter', x: STARTER_SPOT.x, z: STARTER_SPOT.z, label: '靠近发光的云气', radius: 2.4 }] : [];

    // 按捕获次数判断：第一只捕获的絮灵很可能和伙伴同物种，图鉴不会增加
    if (step === 3 && c.stats.caught >= 1) this.advance(4);
    if (step === 4) {
      const home = world.homes[PLAYER_ID]!;
      const nest = Object.values(home.buildings).some((b) => b.type === 'nest' && b.built);
      const working = Object.values(c.spirits).some((s) => s.state === 'working');
      if (nest && working) this.advance(5);
    }
  }

  /** 场景切换时，旧场景里的云团跟着丢掉。 */
  detach(): void {
    this.puff = null;
  }
}
