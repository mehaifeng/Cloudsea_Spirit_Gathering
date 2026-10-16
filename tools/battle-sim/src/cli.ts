/**
 * 自动对战与平衡统计（CLAUDE.md 测试要求）。
 *   pnpm --filter @cloudsea/battle-sim start [--matches 200] [--levels 1,10,30,60] [--json]
 * 改动战斗数值后运行，并在提交说明里附上关键数据变化。
 */
import { getContent } from '@cloudsea/content';
import { AI_PRESETS } from '@cloudsea/sim';
import { runMatch, summarize, type Report } from './simulate';

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const matches = Number(opt('matches', '200'));
const levels = opt('levels', '1,10,30,60').split(',').map(Number);
const json = args.includes('--json');

const content = getContent();
const reports: Report[] = [];
const duels: Report[] = [];
for (const level of levels) {
  const run = (teamSize: number) =>
    Array.from({ length: matches }, (_, i) =>
      runMatch(content, 1000 + i, { level, teamSize, ai: [AI_PRESETS.normal, AI_PRESETS.normal], maxTurns: 60 }, i % 2 ? 'sun' : null),
    );
  reports.push(summarize(content, level, run(3)));
  duels.push(summarize(content, level, run(1)));
}

if (json) {
  process.stdout.write(`${JSON.stringify({ teams: reports, duels }, null, 2)}\n`);
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const names = new Map([...content.lines.values()].map((l) => [l.id, l.name]));
  const lines: string[] = [`# battle-sim（每档 ${matches} 场，3v3，normal AI 对 normal AI）`, ''];
  lines.push('| 等级 | 3v3 平均回合 | 3v3 超时率 | 1v1 击倒回合（均值 / 中位，目标 3–6） |', '|---|---|---|---|');
  reports.forEach((r, i) => {
    const d = duels[i]!;
    lines.push(`| ${r.level} | ${r.avgTurns.toFixed(1)} | ${pct(r.timeoutRate)} | ${d.avgTurnsToKo.toFixed(1)} / ${d.medianTurnsToKo} |`);
  });
  lines.push('', '| 进化线 | ' + reports.map((r) => `${r.level} 级胜率`).join(' | ') + ' |', '|---|' + reports.map(() => '---').join('|') + '|');
  for (const id of content.lines.keys()) lines.push(`| ${names.get(id)} | ` + reports.map((r) => pct(r.lineWinRate[id] ?? 0)).join(' | ') + ' |');
  lines.push('', '技能使用占比（最高等级档前 8）：');
  const last = reports[reports.length - 1]!;
  lines.push(Object.entries(last.skillShare).slice(0, 8).map(([k, v]) => `${content.skills.get(k)?.name ?? k} ${pct(v)}`).join('，'));
  process.stdout.write(`${lines.join('\n')}\n`);
}
