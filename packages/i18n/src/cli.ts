import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extract } from './extract';
import { EN } from './en';

/** pnpm --filter @cloudsea/i18n extract [--missing out.json]：列出缺英文的键（按文件分组）。 */
const root = resolve(import.meta.dirname, '../../..');
const msgs = extract(root);
const missing = msgs.filter((m) => !(m.id in EN));
const stale = Object.keys(EN).filter((k) => !msgs.some((m) => m.id === k));
console.log(`键 ${msgs.length} 个，缺英文 ${missing.length} 个，多余 ${stale.length} 个`);
const byFile: Record<string, string[]> = {};
for (const m of missing) (byFile[m.file] ??= []).push(m.id);
const i = process.argv.indexOf('--missing');
if (i > 0) writeFileSync(process.argv[i + 1]!, JSON.stringify(byFile, null, 1));
else for (const [f, ids] of Object.entries(byFile)) console.log(`  ${f}: ${ids.length}`);
