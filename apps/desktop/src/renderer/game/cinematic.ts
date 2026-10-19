import { clear, h } from '@cloudsea/ui';
import * as THREE from 'three';

/**
 * 运镜与播片（DESIGN 14.3，v0.5）：镜头时间轴 = 一串镜头，每个镜头在两个机位之间缓动；
 * 上下黑边、字幕、标题卡，Esc / Enter / 空格跳过。
 */
export interface CamPose {
  readonly pos: THREE.Vector3;
  readonly look: THREE.Vector3;
}

export interface Shot {
  readonly duration: number;
  /** 起止机位；用函数是为了跟随移动中的目标。 */
  readonly from: () => CamPose;
  readonly to: () => CamPose;
  readonly ease?: 'inOut' | 'out' | 'linear';
  readonly subtitle?: string;
  readonly title?: { readonly main: string; readonly sub?: string };
  readonly onStart?: () => void;
  /** k：本镜头进度 0..1。 */
  readonly onUpdate?: (k: number, dt: number) => void;
  /** 镜头震动强度（坠落、撞击）。 */
  readonly shake?: number;
  /** 纸色转场（v0.10）：本镜头进度 k → 遮罩不透明度 0..1；有它时标题卡用墨色写在纸上（例如“半日后”）。 */
  readonly fade?: (k: number) => number;
  /** 停在本镜头的终点机位，直到它返回 false（v0.11：播片中途的对话，等玩家翻完）。 */
  readonly hold?: () => boolean;
}

const easeFns = {
  linear: (k: number) => k,
  out: (k: number) => 1 - (1 - k) * (1 - k),
  inOut: (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
};

export class Cutscene {
  private index = 0;
  private time = 0;
  private started = false;
  private finished = false;
  private readonly overlay: HTMLElement;
  private readonly top = h('div', { class: 'letterbox top' });
  private readonly bottom = h('div', { class: 'letterbox bottom' });
  private readonly subtitle = h('div', { class: 'cine-sub' });
  private readonly titleCard = h('div', { class: 'cine-title' });
  private readonly fadeEl = h('div', { class: 'cine-fade' });
  private readonly onKey = (e: KeyboardEvent) => {
    // 对话框先收到按键（翻页）时不跳过播片
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      this.skip();
    }
  };

  constructor(
    private readonly shots: readonly Shot[],
    layer: HTMLElement,
    private readonly onDone: () => void,
  ) {
    this.overlay = h('div', { class: 'cine' }, this.fadeEl, this.top, this.bottom, this.titleCard, this.subtitle, h('div', { class: 'cine-skip' }, 'Esc 跳过'));
    layer.append(this.overlay);
    requestAnimationFrame(() => this.overlay.classList.add('on'));
    window.addEventListener('keydown', this.onKey, true);
  }

  /** 从播片开始到现在的总时长（秒）。 */
  get elapsed(): number {
    let t = 0;
    for (let i = 0; i < this.index && i < this.shots.length; i++) t += this.shots[i]!.duration;
    return t + (this.started ? this.time : 0);
  }

  get done(): boolean {
    return this.finished;
  }

  skip(): void {
    if (this.finished) return;
    // 跳过也要执行每个镜头的开始动作（例如生成物体），保证状态一致
    for (let i = this.index + (this.started ? 1 : 0); i < this.shots.length; i++) this.shots[i]!.onStart?.();
    const last = this.shots[this.shots.length - 1];
    last?.onUpdate?.(1, 0);
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay.classList.remove('on');
    setTimeout(() => this.overlay.remove(), 400);
    this.onDone();
  }

  /** 每帧推进；返回是否还在播放。 */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (this.finished) return false;
    const shot = this.shots[this.index];
    if (!shot) {
      this.finish();
      return false;
    }
    if (!this.started) {
      this.started = true;
      this.time = 0;
      shot.onStart?.();
      clear(this.subtitle);
      if (shot.subtitle) this.subtitle.append(h('span', {}, shot.subtitle));
      clear(this.titleCard);
      if (shot.title) this.titleCard.append(h('div', { class: 'main' }, shot.title.main), shot.title.sub ? h('div', { class: 'sub' }, shot.title.sub) : '');
      this.titleCard.classList.toggle('on', !!shot.title);
      this.titleCard.classList.toggle('ink', !!shot.fade);
    }
    const holding = this.time >= shot.duration && !!shot.hold?.();
    this.time = holding ? shot.duration : this.time + dt;
    const k = Math.min(1, this.time / shot.duration);
    const e = easeFns[shot.ease ?? 'inOut'](k);
    const a = shot.from();
    const b = shot.to();
    camera.position.lerpVectors(a.pos, b.pos, e);
    const look = new THREE.Vector3().lerpVectors(a.look, b.look, e);
    if (shot.shake) {
      const s = shot.shake * (1 - k);
      camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    camera.lookAt(look);
    this.fadeEl.style.opacity = String(shot.fade ? shot.fade(k) : 0);
    shot.onUpdate?.(k, dt);
    if (k >= 1 && !shot.hold?.()) {
      this.index++;
      this.started = false;
    }
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay.remove();
  }
}

export const pose = (pos: THREE.Vector3, look: THREE.Vector3): CamPose => ({ pos, look });
export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
