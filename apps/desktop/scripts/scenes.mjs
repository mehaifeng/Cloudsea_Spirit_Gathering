// 场景截图（v0.11）：默认只跑和改动有关的场景，不全量跑。
//   pnpm scenes                 按 git 里未提交的改动（含新文件）挑场景
//   pnpm scenes repair home     只跑指定的场景（也可以用 SCENES=repair,home）
//   pnpm scenes all             全量（里程碑交付前）
// 场景用无头 Chromium 打开打包好的渲染端，不弹窗口（见 tests/scenes.spec.ts）。
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const spec = readFileSync(new URL('../tests/scenes.spec.ts', import.meta.url), 'utf8');
const ALL = [...spec.matchAll(/^ {2}(\w+): async \(win\)/gm)].map((m) => m[1]);

/**
 * 文件 → 受影响的场景。按顺序匹配路径里的片段，一个文件可以命中多条。
 * 没列出的文件（sim 规则、数据表、文档、测试工具……）不触发场景截图：它们由单元测试和 pnpm smoke 覆盖。
 */
const MAP = [
  ['render/src/island.ts', ['home', 'pondSide', 'shore', 'regions']],
  ['render/src/water.ts', ['pondSide', 'shore']],
  ['render/src/environment.ts', ['home', 'night']],
  ['render/src/character.ts', ['home', 'opening']],
  ['render/src/creature.ts', ['gallery', 'wild']],
  ['render/src/rig.ts', ['gallery', 'home']],
  ['render/src/skiff.ts', ['dock', 'boarding', 'opening']],
  ['render/src/caravanShip.ts', ['repair']],
  ['render/src/buildings.ts', ['core', 'build', 'lighthouse']],
  ['render/src/props.ts', ['home', 'regions']],
  ['render/src/fx.ts', ['ambush', 'wild']],
  ['sim/src/world/terrain.ts', ['home', 'pondSide', 'shore', 'regions']],
  ['sim/src/world/layout.ts', ['home', 'pondSide', 'regions', 'dock']],
  ['renderer/game/cutscenes.ts', ['opening', 'ambush', 'repair']],
  ['renderer/game/cinematic.ts', ['opening', 'repair']],
  ['renderer/game/explore.ts', ['home', 'shore', 'dock', 'boarding']],
  ['renderer/game/voyageView.ts', ['voyage']],
  ['renderer/game/battle.ts', ['wild', 'guardian', 'cloudlord']],
  ['renderer/game/build.ts', ['build']],
  ['renderer/game/panels.ts', ['gallery', 'chart', 'achievements']],
  ['renderer/game/hud.ts', ['home']],
  ['renderer/game/uiRoot.ts', ['home', 'achievements']],
  ['renderer/game/tutorial.ts', ['home']],
  ['renderer/game/app.ts', ['home']],
  ['renderer/styles.css', ['home', 'chart', 'repair']],
];

/** 改了某个场景自己的代码（scenes.spec.ts 的断言、scenarios.ts 的布置）就跑那个场景：按改动的行号找所在的场景块。 */
function scenesTouchedIn(file, header) {
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', '-U0', 'HEAD', '--', file], { cwd: repo, encoding: 'utf8' });
  } catch {
    return [];
  }
  const lines = readFileSync(`${repo}/${file}`, 'utf8').split('\n');
  const starts = lines.flatMap((l, i) => (header.test(l) ? [{ i: i + 1, name: l.match(header)[1] }] : []));
  const out = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const from = Number(m[1]);
    const to = from + Math.max(0, Number(m[2] ?? 1) - 1);
    for (let ln = from; ln <= Math.max(from, to); ln++) {
      const s = [...starts].reverse().find((x) => x.i <= ln);
      if (s && ALL.includes(s.name)) out.add(s.name);
    }
  }
  return [...out];
}

function changedFiles() {
  const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' });
  return [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);
}

const args = process.argv.slice(2);
let picked;
let why = '';
if (args.includes('all') || process.env.SCENES === 'all') {
  picked = ALL;
  why = '全量';
} else if (args.length || process.env.SCENES) {
  picked = [...args, ...(process.env.SCENES ?? '').split(',')].filter(Boolean);
  const bad = picked.filter((s) => !ALL.includes(s));
  if (bad.length) {
    console.error(`没有这些场景：${bad.join(', ')}\n可用：${ALL.join(', ')}`);
    process.exit(1);
  }
  why = '指定';
} else {
  const set = new Set();
  const files = changedFiles();
  for (const f of files) for (const [frag, scenes] of MAP) if (f.includes(frag)) scenes.forEach((s) => set.add(s));
  if (files.includes('apps/desktop/tests/scenes.spec.ts')) scenesTouchedIn('apps/desktop/tests/scenes.spec.ts', /^ {2}(\w+): async \(win\)/).forEach((s) => set.add(s));
  if (files.includes('apps/desktop/src/renderer/game/scenarios.ts')) scenesTouchedIn('apps/desktop/src/renderer/game/scenarios.ts', /^ {2}(\w+): \{/).forEach((s) => set.add(s));
  picked = ALL.filter((s) => set.has(s));
  why = `按改动挑选（${files.length} 个文件有改动）`;
}

if (!picked.length) {
  console.log(`没有和改动相关的场景，不跑。指定场景：pnpm scenes <名字…>；全量：pnpm scenes all\n可用：${ALL.join(', ')}`);
  process.exit(0);
}
console.log(`场景截图（${why}）：${picked.join(', ')}`);

const run = (cmd, argv, env = process.env) => {
  const r = spawnSync(cmd, argv, { cwd: appDir, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('pnpm', ['build']);
run('pnpm', ['exec', 'playwright', 'test', 'tests/scenes.spec.ts'], { ...process.env, SCENES: picked.join(',') });
