import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 架构铁律 1、2 的自动检查：sim 源码（不含测试）只允许相对导入和 @cloudsea/content，
 * 且不得使用 Math.random / Date / performance 等非确定性来源。
 */
const SRC = join(import.meta.dirname, '.');

const ALLOWED_IMPORTS = [/^\.{1,2}\//, /^@cloudsea\/content$/];
const FORBIDDEN_CALLS: Array<[RegExp, string]> = [
  [/\bMath\.random\b/, 'Math.random（用种子 RNG）'],
  [/\bDate\b/, 'Date（用游戏内 tick）'],
  [/\bperformance\b/, 'performance'],
  [/\bsetTimeout\b|\bsetInterval\b/, '定时器'],
  [/\b(window|document|globalThis|process|require)\b/, '宿主环境对象'],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

/** 去掉注释，避免注释里提到 Math.random 也被判违规。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('sim 纯度', () => {
  const files = sourceFiles(SRC);

  it('找到了源文件', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(SRC, file);
    const code = stripComments(readFileSync(file, 'utf8'));

    it(`${name}：只导入允许的模块`, () => {
      const specs = [...code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .map((m) => m[1] ?? m[2] ?? '');
      const bad = specs.filter((s) => !ALLOWED_IMPORTS.some((re) => re.test(s)));
      expect(bad).toEqual([]);
    });

    it(`${name}：不使用非确定性来源`, () => {
      const hits = FORBIDDEN_CALLS.filter(([re]) => re.test(code)).map(([, why]) => why);
      expect(hits).toEqual([]);
    });
  }
});
