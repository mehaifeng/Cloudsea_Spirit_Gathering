import { getContent } from '@cloudsea/content';
import { CampaignBot } from './bot';

/** pnpm --filter @cloudsea/campaign start [--seed 1] [--days 200] */
const args = process.argv.slice(2);
const arg = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const bot = new CampaignBot(getContent(), arg('seed', 1), true);
const t0 = performance.now();
const report = bot.run(arg('days', 200));
console.log(`\n${report.finished ? '通关' : '没通关'}：${report.days} 个游戏日，战斗 ${report.battles.won} 胜 ${report.battles.lost} 负，用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (report.reason) console.log(report.reason);
