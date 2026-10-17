// 生成 src/renderer/fonts.css：只引用 Fontsource 字体的 woff2 切片（Electron 的 Chromium 用不到 woff，打包时就不带它们）。
// 字体：马善政体（标题）、思源宋体 500 / 700（正文），均为 OFL 授权（DESIGN 14.4）。
// 升级字体包后运行：node scripts/fonts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = [
  ['ma-shan-zheng', '400'],
  ['noto-serif-sc', '500'],
  ['noto-serif-sc', '700'],
];
let out = '/* 由 scripts/fonts.mjs 生成，不要手改。 */\n';
for (const [pkg, weight] of sources) {
  const css = readFileSync(`${root}node_modules/@fontsource/${pkg}/${weight}.css`, 'utf8');
  out += css
    .replace(/url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\), url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g, `url('@fonts/${pkg}/files/$1') format('woff2')`)
    .replace(/\/\*.*?\*\/\n/g, '');
}
writeFileSync(`${root}src/renderer/fonts.css`, out);
console.log(`fonts.css: ${(out.match(/@font-face/g) ?? []).length} faces`);
