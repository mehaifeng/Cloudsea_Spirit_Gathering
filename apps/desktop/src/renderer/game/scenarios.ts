import { homeTerrain, WATER_LEVEL, type Intent, type WorldState } from '@cloudsea/sim';

/**
 * 测试模式的“场景直达”（DESIGN v0.6，开发用）：
 * 测试模式下 `CLOUDSEA_SCENE=<名字>` 启动，或在页面里调用 `__game.scene('<名字>')`，
 * 直接把游戏带到某个画面，便于改动后快速截图自查（`pnpm scenes`）。
 * 和测试钩子一样，场景只通过意图改世界（不直接改状态）。
 */
export interface ScenarioHost {
  newGame(): Promise<void>;
  act(intent: Intent): Promise<{ ok: boolean; error?: string }>;
  world(): Readonly<WorldState>;
  mode(): string;
  teleport(x: number, z: number, yaw?: number): void;
  fastForward(ticks: number): void;
  skipCutscene(): void;
  closeDialogues(): void;
  setCamera(yaw: number, pitch: number, dist: number): void;
  /** 按固定步长推进若干秒（不等真实时间），用于播片和动画定格。 */
  advance(seconds: number): void;
  interactNearest(): Promise<void>;
  sail(islandId: string): Promise<void>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 8000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (cond()) return true;
    await wait(50);
  }
  return cond();
}

/** 新游戏 → 跳过开场 → 领到第一只伙伴 → 引导完成，站在岛核前（白天）。 */
async function home(h: ScenarioHost): Promise<void> {
  await h.newGame();
  await until(() => h.mode() === 'cutscene', 2000);
  h.skipCutscene();
  h.closeDialogues();
  await h.act({ type: 'adoptStarter' });
  await h.act({ type: 'tutorial', step: 6, done: true });
  h.closeDialogues();
  h.teleport(0, 4, Math.PI);
  await wait(300);
}

/** 家园岛最深的水点。 */
function deepestWater(w: Readonly<WorldState>): { x: number; z: number; depth: number } {
  const homeState = Object.values(w.homes)[0]!;
  const t = homeTerrain(homeState.seed, homeState.coreLevel);
  let best = { x: 0, z: 0, depth: 0 };
  for (let x = -30; x <= 30; x += 0.5) {
    for (let z = -30; z <= 30; z += 0.5) {
      if (!t.isWater(x, z)) continue;
      const d = WATER_LEVEL - t.height(x, z);
      if (d > best.depth) best = { x, z, depth: d };
    }
  }
  return best;
}

export const SCENARIOS: Record<string, { readonly desc: string; run(h: ScenarioHost): Promise<void> }> = {
  gallery: { desc: '图鉴陈列：40 个形态排成方阵（截图自查外观）', run: async () => {} },
  opening: { desc: '新游戏，开场播片从头播', run: (h) => h.newGame() },
  home: { desc: '引导完成，站在岛核前（白天）', run: home },
  night: {
    desc: '家园岛夜晚',
    run: async (h) => {
      await home(h);
      h.fastForward(8200 - (h.world().tick % 12000));
      await wait(300);
    },
  },
  swim: {
    desc: '家园岛池塘最深处游泳',
    run: async (h) => {
      await home(h);
      const p = deepestWater(h.world());
      h.teleport(p.x, p.z, 0);
      h.setCamera(0.8, 0.35, 7);
      h.advance(1);
    },
  },
  shore: {
    desc: '站在池塘边，正对着深水（走进去会切换游泳）',
    run: async (h) => {
      await home(h);
      const p = deepestWater(h.world());
      const homeState = Object.values(h.world().homes)[0]!;
      const t = homeTerrain(homeState.seed, homeState.coreLevel);
      // 从最深点往外走到岸上
      for (let r = 0; r < 12; r += 0.25) {
        if (!t.isWater(p.x + r, p.z)) {
          h.teleport(p.x + r + 0.8, p.z, -Math.PI / 2);
          break;
        }
      }
      // 镜头在玩家东边、朝西看：按 W 就是往水里走
      h.setCamera(Math.PI / 2, 0.3, 7);
      h.advance(0.5);
    },
  },
  core: {
    desc: '家园岛核心塔近景（地上一圈光点是治疗范围）',
    run: async (h) => {
      await home(h);
      h.teleport(0, 4.2, Math.PI);
      h.setCamera(0.5, 0.28, 6.5);
      h.advance(0.5);
    },
  },
  build: {
    desc: '家园岛，准备进建造模式（检查预览与鼠标对齐）',
    run: home,
  },
  dock: {
    desc: '站在码头上，旁边停着云舟',
    run: async (h) => {
      await home(h);
      h.teleport(1.2, 17.2, Math.PI / 2);
      h.setCamera(-0.6, 0.35, 7);
      h.advance(0.5);
    },
  },
  voyage: {
    desc: '从家园岛码头上船出航到麦浪坡',
    run: async (h) => {
      await home(h);
      await h.sail('wheatSlope');
    },
  },
  boarding: {
    desc: '在码头上船（舷梯放下、沿舷梯走上去）——不等上完',
    run: async (h) => {
      await home(h);
      h.teleport(0, 15.5, 0);
      h.setCamera(-0.9, 0.42, 9);
      void h.sail('wheatSlope');
    },
  },
  lighthouse: {
    desc: '晴原灯塔：熄灭的灯塔与盘踞在塔下的云主',
    run: async (h) => {
      await home(h);
      await h.sail('sunLighthouse');
      await until(() => h.mode() === 'explore' && h.world().players['p1']!.islandId === 'sunLighthouse', 30000);
      h.skipCutscene();
      h.teleport(5, 0, Math.PI * 1.15);
      h.setCamera(0.7, 0.32, 11);
      h.advance(0.5);
    },
  },
  cloudlord: {
    desc: '单人讨伐云主（3 个位置；看阶段切换的表现用）',
    run: async (h) => {
      await home(h);
      await h.sail('sunLighthouse');
      await until(() => h.mode() === 'explore' && h.world().players['p1']!.islandId === 'sunLighthouse', 30000);
      h.skipCutscene();
      h.teleport(0, -3, Math.PI);
      await wait(300);
      const r = await h.act({ type: 'challengeCloudlord', cloudlordId: 'sunPlainsLord' });
      if (!r.ok) throw new Error(`讨伐失败：${r.error}`);
      await until(() => h.mode() === 'battle', 5000);
    },
  },
  ambush: {
    desc: '唤出第一只伙伴后，蚀化絮灵袭击（首战转场）',
    run: async (h) => {
      await h.newGame();
      await until(() => h.mode() === 'cutscene', 2000);
      h.skipCutscene();
      h.closeDialogues();
      await h.act({ type: 'tutorial', step: 1 });
      h.teleport(2.5, 6.2, Math.PI);
      await wait(300);
      await h.interactNearest();
      await wait(200);
      h.closeDialogues();
      await wait(200);
      h.closeDialogues();
    },
  },
  wild: {
    desc: '麦浪坡和野生絮灵对战',
    run: async (h) => {
      await home(h);
      await h.sail('wheatSlope');
      await until(() => h.mode() === 'explore' && h.world().players['p1']!.islandId === 'wheatSlope', 30000);
      h.skipCutscene();
      const w = h.world().islands['wheatSlope'];
      const wild = Object.values(w?.wild ?? {}).sort((a, b) => a.group.length - b.group.length)[0];
      if (!wild) throw new Error('麦浪坡没有野生絮灵');
      h.teleport(wild.x, wild.z + 2, Math.PI);
      await wait(300);
      const r = await h.act({ type: 'encounter', wildId: wild.id });
      if (!r.ok) throw new Error(`遭遇失败：${r.error}`);
      await until(() => h.mode() === 'battle', 5000);
    },
  },
};
