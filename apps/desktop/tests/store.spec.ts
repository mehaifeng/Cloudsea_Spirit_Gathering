import { _electron as electron, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 商店素材（M4-4）：中英各一套截图（1920×1080）与胶囊图，全部由游戏画面 + 代码叠加的标题生成。
 * pnpm --filter @cloudsea/desktop store-art → screenshots/store/<lang>/（不入库）
 */
async function g<T = unknown>(win: Page, expr: string): Promise<T> {
  return win.evaluate(`(async () => { const g = window.__game; return ${expr}; })()`) as Promise<T>;
}

async function open(scene: string, lang: string, w = 1920, h = 1080) {
  const app = await electron.launch({ args: ['.'], cwd: resolve(__dirname, '..'), env: { ...process.env, CLOUDSEA_TEST: '1', CLOUDSEA_SCENE: scene, CLOUDSEA_LANG: lang } as Record<string, string> });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: w, height: h });
  await win.waitForSelector(`body[data-scene="${scene}"]`, { timeout: 60_000 });
  return { app, win };
}

/** 隐藏 HUD 与提示（宣传图不需要界面），关掉浮动提示。 */
async function clean(win: Page, keepUi = false): Promise<void> {
  await win.addStyleTag({ content: `.toast{display:none!important}${keepUi ? '' : '#hud-tl,#hud-tr,#party-bar,#hints,#prompt,#nameplates{display:none!important}'}` });
}

const TITLE: Record<string, { main: string; sub: string }> = {
  zh: { main: '云海拾灵', sub: 'Cloudsea: Spirit Gathering' },
  en: { main: 'Cloudsea', sub: 'Spirit Gathering' },
};

async function logo(win: Page, lang: string, scale: number, align: 'center' | 'left' = 'center', transparent = false): Promise<void> {
  const t = TITLE[lang]!;
  await win.evaluate(
    `(() => {
      const d = document.createElement('div');
      d.id = 'store-logo';
      d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;z-index:99;pointer-events:none;' +
        'align-items:${align === 'center' ? 'center' : 'flex-start'};padding-left:${align === 'left' ? '6%' : '0'};' +
        '${transparent ? 'background:transparent' : 'background:linear-gradient(180deg,rgba(255,240,220,0) 30%,rgba(255,236,214,.55))'}';
      d.innerHTML = '<div style="font-family:var(--f-title);font-size:${Math.round(96 * scale)}px;color:#3b2e28;text-shadow:0 ${Math.round(4 * scale)}px 0 #fff8ef,0 0 ${Math.round(24 * scale)}px rgba(255,248,239,.9);line-height:1.05">${t.main}</div>' +
        '<div style="font-family:var(--f-body);font-size:${Math.round(30 * scale)}px;color:#5a4636;letter-spacing:.06em;text-shadow:0 0 12px #fff8ef;margin-top:${Math.round(8 * scale)}px">${t.sub}</div>';
      document.body.append(d);
    })()`,
  );
  await win.waitForTimeout(300);
}

for (const lang of ['zh', 'en']) {
  test(`商店素材：${lang}`, async () => {
    test.setTimeout(600_000);
    const out = `screenshots/store/${lang}`;
    mkdirSync(out, { recursive: true });
    const shots: Array<[string, string, (win: Page) => Promise<void>]> = [
      ['01-home-day', 'share', async (win) => {
        await g(win, 'g.setCamera(0.8, 0.42, 16)');
        await win.waitForTimeout(1500);
      }],
      ['02-home-night', 'night', async (win) => {
        await g(win, 'g.setCamera(2.4, 0.3, 12)');
        await win.waitForTimeout(1200);
      }],
      ['03-battle', 'wild', async (win) => {
        await win.waitForTimeout(2200);
      }],
      ['04-cloudlord', 'lighthouse', async (win) => {
        await win.waitForTimeout(1500);
      }],
      ['05-star-chart', 'chart', async (win) => {
        await win.keyboard.press('KeyM');
        await win.waitForTimeout(600);
      }],
      ['06-mist-sea', 'regions', async (win) => {
        await g(win, `g.sail('jellyReef')`);
        for (let i = 0; i < 400; i++) {
          if (await g<boolean>(win, `g.mode() === 'explore' && g.world().players.p1.islandId === 'jellyReef'`)) break;
          if ((await g<string>(win, 'g.mode()')) === 'voyage') await g(win, 'g.fastForward(200)');
          await win.waitForTimeout(100);
        }
        await g(win, 'g.skipCutscene()');
        for (let i = 0; i < 10 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.keyboard.press('Enter');
        await g(win, 'g.setCamera(-0.6, 0.28, 13)');
        await win.waitForTimeout(1500);
      }],
      ['07-keeper', 'chart', async (win) => {
        await g(win, `g.sail('heFarm')`);
        for (let i = 0; i < 400; i++) {
          if (await g<boolean>(win, `g.mode() === 'explore' && g.world().players.p1.islandId === 'heFarm'`)) break;
          if ((await g<string>(win, 'g.mode()')) === 'voyage') await g(win, 'g.fastForward(200)');
          await win.waitForTimeout(100);
        }
        await g(win, 'g.skipCutscene()');
        for (let i = 0; i < 10 && (await g<boolean>(win, 'g.dialogueOpen()')); i++) await win.keyboard.press('Enter');
        await g(win, `g.act({ type: 'talk', keeperId: 'aHe' })`);
        await win.waitForTimeout(800);
      }],
    ];
    for (const [name, scene, setup] of shots) {
      const { app, win } = await open(scene, lang);
      await clean(win, name !== '01-home-day' && name !== '02-home-night' && name !== '06-mist-sea');
      await setup(win);
      await win.screenshot({ path: `${out}/screenshot-${name}.png` });
      await app.close();
    }
    // 胶囊图：家园岛白天 + 标题
    const capsules: Array<[string, number, number, number, 'center' | 'left', boolean]> = [
      ['capsule-main-1232x706', 1232, 706, 1.2, 'left', false],
      ['capsule-header-920x430', 920, 430, 0.95, 'left', false],
      ['capsule-small-462x174', 462, 174, 0.55, 'center', false],
      ['capsule-vertical-748x896', 748, 896, 0.95, 'center', false],
      ['library-capsule-600x900', 600, 900, 0.85, 'center', false],
      ['library-hero-3840x1240', 3840, 1240, 0, 'center', false],
      ['library-logo-1280x720', 1280, 720, 1.4, 'center', true],
    ];
    for (const [name, w, h, scale, align, transparent] of capsules) {
      const { app, win } = await open('share', lang, w, h);
      await clean(win);
      await g(win, `g.setCamera(0.8, 0.38, ${h > w ? 20 : 15})`);
      await win.waitForTimeout(1500);
      if (transparent) await win.addStyleTag({ content: 'html,body,canvas,#ui{background:transparent!important}canvas{visibility:hidden}' });
      if (scale > 0) await logo(win, lang, scale, align, transparent);
      await win.screenshot({ path: `${out}/${name}.png`, omitBackground: transparent });
      await app.close();
    }
  });
}
