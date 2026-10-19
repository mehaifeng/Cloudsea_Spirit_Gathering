import { type WorldState } from '@cloudsea/sim';
import { clear, h } from '@cloudsea/ui';
import type { ExploreView } from './explore';
import { PLAYER_ID } from './session';
import type { UiRoot } from './uiRoot';

/**
 * 新手引导（DESIGN 13，前 30 分钟）：
 * 0 坠落荒岛（移动） → 1 第一只絮灵（互动） → 2 蚀化絮灵袭击（第一场战斗）
 * → 3 捕获第一只野生絮灵 → 4 建栖巢、安排打工 → 5 点亮第一盏灯（引出主线）→ 完成
 */
export const STARTER_SPOT = { x: 2.5, z: 4.5 } as const; // 与 ExploreView.ORB 一致

const HINTS: Record<number, string> = {
  0: '你的云舟在云海中失事，坠落到这座荒岛上。<br>用 <b>WASD</b> 走一走，<b>拖动鼠标</b>转动视角。',
  1: '岛上有一团温暖的云气在发光。走近它，按 <b>E</b>。',
  2: '小心！',
  3: '路过的风帆商队帮你修好了云舟。去码头（按 <b>E</b>）打开<b>星图</b>，出航到<b>麦浪坡</b>。<br>靠近野生絮灵按 <b>E</b> 接触，在战斗里用<b>灯露</b>邀请它加入。先打掉它一些体力，成功率更高。',
  4: '回到家园岛，按 <b>B</b> 建一座<b>栖巢</b>。<br>在菜单（<b>Tab</b>）里让一只絮灵离开队伍，再对着建筑按 <b>E</b> 安排它<b>打工</b>——建筑会建得更快。',
  5: '走到岛中央的<b>岛核</b>前按 <b>E</b>，点亮岛上的第一盏灯。',
};

/** 第 4 步栖巢已经建好、但还没让絮灵干过活时的提示（例如读档回来）。 */
const HINT_NEST_BUILT = '栖巢建好了！再建一块<b>田地</b>（<b>B</b>），对着它按 <b>E</b>，安排一只不在队伍里的絮灵去<b>打工</b>。';

export class Tutorial {
  private moved = 0;
  private last: { x: number; z: number } | null = null;
  private shownStep = -1;
  private introDone = false;
  /** 第 4 步：看到过絮灵在打工（包括帮忙建栖巢——栖巢建好后建筑工会下工）。 */
  private sawWorker = false;

  constructor(
    private readonly ui: UiRoot,
    private readonly advance: (step: number, done?: boolean) => void,
  ) {}

  /** 每帧调用：根据角色进度更新提示、发光云团与完成条件。 */
  update(world: Readonly<WorldState>, view: ExploreView | null): void {
    const c = world.characters[PLAYER_ID]!;
    const step = c.tutorial.done ? 99 : c.tutorial.step;
    const home = world.homes[PLAYER_ID]!;
    const nestBuilt = Object.values(home.buildings).some((b) => b.type === 'nest' && b.built);
    if (step >= 3 && Object.values(c.spirits).some((s) => s.state === 'working')) this.sawWorker = true;
    // 提示随进度变：第 4 步栖巢建好了还没人干过活，换成“去田地打工”的提示（v0.10）
    const shown = step === 4 && nestBuilt && !this.sawWorker ? 4.5 : step;
    if (shown !== this.shownStep) {
      this.shownStep = shown;
      clear(this.ui.tutorial);
      const hint = shown === 4.5 ? HINT_NEST_BUILT : HINTS[step];
      this.ui.tutorial.classList.toggle('hidden', !hint);
      if (hint) this.ui.tutorial.append(h('div', { class: 'panel', html: `<div class="muted">引导</div>${hint}` }));
    }
    // 开场播片看完后才出坠落对话
    if (step === 0 && !this.introDone && c.seenCutscenes.includes('opening')) {
      this.introDone = true;
      this.ui.say('……', ['云舟的核心熄灭了，船身裂成两半。', '你抓着提灯，摔在一片柔软的草地上。', '四周很安静。这是一座没有人的小岛。'], '坠落');
    }
    if (!view) return;

    if (step === 0 && view.isHome) {
      const p = view.player;
      if (this.last) this.moved += Math.hypot(p.x - this.last.x, p.z - this.last.z);
      this.last = { x: p.x, z: p.z };
      if (this.moved > 4) this.advance(1);
    }

    // 第一只絮灵：发光的云气团（模型在 ExploreView 里，开场播片时也在场景中）
    const wantPuff = step <= 1 && view.isHome && Object.keys(c.spirits).length === 0;
    view.extraInteractables = wantPuff ? [{ kind: 'starter', id: 'starter', x: STARTER_SPOT.x, z: STARTER_SPOT.z, label: '靠近发光的云气', radius: 2.4 }] : [];

    // 按捕获次数判断：第一只捕获的絮灵很可能和伙伴同物种，图鉴不会增加
    if (step === 3 && c.stats.caught >= 1) this.advance(4);
    // 栖巢建好 + 有絮灵干过活（v0.10，Lynx 反馈：絮灵帮忙建好栖巢后自动下工，引导就卡住了）
    if (step === 4 && nestBuilt && this.sawWorker) this.advance(5);
  }

  /** 场景切换（保留接口）。 */
  detach(): void {}
}
