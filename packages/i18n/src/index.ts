import { EN } from './en';

/**
 * 本地化（M4-3）：中文原文即键（gettext 的做法）。
 * - 精确匹配：整句在表里；
 * - 模板匹配：源码里的模板字符串 `第 ${day} 天` 抽成键 “第 {0} 天”，运行时按静态部分把整句对上，
 *   占位符里的内容再递归翻译（例如名字、另一句提示）；
 * - 多行文本按行翻译。找不到就原样返回（玩家起的名字、码等）。
 */
export type Lang = 'zh' | 'en';
export const LANGS: ReadonlyArray<{ id: Lang; name: string }> = [
  { id: 'zh', name: '中文' },
  { id: 'en', name: 'English' },
];

let lang: Lang = 'zh';
const CJK = /[㐀-鿿！-～　-〿]/;

interface Template {
  /** 静态片段（长度 = 占位符数 + 1）与每个占位符的编号。 */
  readonly parts: readonly string[];
  readonly en: string;
  readonly weight: number;
}
let templates: Template[] | null = null;
const cache = new Map<string, string>();

function compile(table: Readonly<Record<string, string>>): Template[] {
  const out: Template[] = [];
  for (const [zh, en] of Object.entries(table)) {
    if (!/\{\d+\}/.test(zh)) continue;
    const parts: string[] = [];
    const order: number[] = [];
    const pieces = zh.split(/(\{\d+\})/);
    for (const p of pieces) {
      const m = /^\{(\d+)\}$/.exec(p);
      if (m) order.push(Number(m[1]));
      else parts.push(p);
    }
    // 英文里按“第几个出现的占位符”引用
    out.push({ parts, en: order.reduce((s, idx, i) => s.split(`{${idx}}`).join(`\u0000${i}\u0000`), en), weight: zh.replace(/\{\d+\}/g, '').length });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * 把 s 按模板的静态片段切开，枚举所有切法（相邻占位符、重复片段时有多种），
 * 优先选每个参数都能完整翻译（不剩中文）的那种。
 */
function splits(s: string, parts: readonly string[]): string[][] {
  const out: string[][] = [];
  if (!s.startsWith(parts[0]!)) return out;
  const n = parts.length - 1;
  const walk = (pos: number, i: number, acc: string[]): void => {
    if (out.length > 32) return;
    if (i === n) {
      if (pos === s.length) out.push(acc);
      return;
    }
    const next = parts[i + 1]!;
    if (i + 1 === n && next === '') return walk(s.length, i + 1, [...acc, s.slice(pos)]);
    for (let j = pos; j <= s.length; j++) {
      if (next === '' || s.startsWith(next, j)) walk(j + next.length, i + 1, [...acc, s.slice(pos, j)]);
      if (i + 1 === n && next !== '') {
        // 最后一段静态文本必须正好在结尾
        if (s.endsWith(next) && s.length - next.length >= pos) walk(s.length, n, [...acc, s.slice(pos, s.length - next.length)]);
        return;
      }
    }
  };
  walk(parts[0]!.length, 0, []);
  return out;
}

export function setLanguage(l: Lang): void {
  lang = l;
  cache.clear();
}

export function getLanguage(): Lang {
  return lang;
}

/** 翻译一段界面文本（当前语言是中文时原样返回）。 */
export function tr(s: string, depth = 0): string {
  if (lang === 'zh' || !s || !CJK.test(s)) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  let out: string;
  if (s.includes('\n')) out = s.split('\n').map((l) => tr(l, depth)).join('\n');
  else out = EN[s] ?? matchTemplate(s, depth) ?? s;
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}

function matchTemplate(s: string, depth: number): string | null {
  if (depth > 3) return null;
  templates ??= compile(EN);
  let fallback: string | null = null;
  for (const t of templates) {
    for (const params of splits(s, t.parts)) {
      const done = params.map((p) => tr(p, depth + 1));
      const text = t.en.replace(/\u0000(\d+)\u0000/g, (_, i: string) => done[Number(i)] ?? '');
      if (!done.some((d) => CJK.test(d))) return text;
      fallback ??= text;
    }
  }
  return fallback;
}

/** 按系统语言选默认语言：中文系统用中文，其他用英文。 */
export function detectLanguage(saved: string | null, system: string): Lang {
  if (saved === 'zh' || saved === 'en') return saved;
  return /^zh/i.test(system) ? 'zh' : 'en';
}
