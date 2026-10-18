import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EN } from './en';
import { extract } from './extract';
import { detectLanguage, setLanguage, tr } from './index';

const root = resolve(import.meta.dirname, '../../..');

describe('本地化键集（M4-3）', () => {
  const msgs = extract(root);
  const keys = new Set(msgs.map((m) => m.id));

  it('源码里每一句中文都有英文，英文表里没有多余的键（两种语言键集一致）', () => {
    const missing = msgs.filter((m) => !(m.id in EN)).map((m) => `${m.file}: ${m.id}`);
    const stale = Object.keys(EN).filter((k) => !keys.has(k));
    expect(missing.slice(0, 20), `缺 ${missing.length} 条`).toEqual([]);
    expect(stale.slice(0, 20), `多 ${stale.length} 条`).toEqual([]);
  });

  it('占位符一一对应；英文里没有残留的中文', () => {
    const bad = Object.entries(EN).filter(([zh, en]) => (zh.match(/\{\d+\}/g) ?? []).sort().join() !== (en.match(/\{\d+\}/g) ?? []).sort().join());
    expect(bad.slice(0, 10)).toEqual([]);
    const chinese = Object.entries(EN).filter(([, en]) => /[一-鿿]/.test(en));
    expect(chinese.slice(0, 10)).toEqual([]);
  });
});

describe('翻译函数', () => {
  afterEach(() => setLanguage('zh'));

  it('中文时原样返回；英文时整句、模板、多行都能翻；不认识的（名字、码）原样返回', () => {
    const exact = Object.keys(EN).find((k) => !/\{\d+\}/.test(k))!;
    expect(tr(exact)).toBe(exact);
    setLanguage('en');
    expect(tr(exact)).toBe(EN[exact]);
    expect(tr(`${exact}\n${exact}`)).toBe(`${EN[exact]}\n${EN[exact]}`);
    expect(tr('XT-1234-ABCD')).toBe('XT-1234-ABCD');
    expect(tr('阿呆鸟')).toBe('阿呆鸟'); // 玩家起的名字不在表里
    // 模板：挑一个带占位符的键，代入数字后能翻出来，数字原样保留
    const tpl = Object.keys(EN).find((k) => /^[^{]*\{0\}[^{]*$/.test(k) && k.replace('{0}', '').length > 3)!;
    expect(tr(tpl.replace('{0}', '42'))).toBe(EN[tpl]!.replace('{0}', '42'));
  });

  it('默认语言：中文系统用中文，其他用英文；保存过的设置优先', () => {
    expect(detectLanguage(null, 'zh-CN')).toBe('zh');
    expect(detectLanguage(null, 'en-US')).toBe('en');
    expect(detectLanguage('zh', 'en-US')).toBe('zh');
    expect(detectLanguage('bogus', 'ja-JP')).toBe('en');
  });
});
