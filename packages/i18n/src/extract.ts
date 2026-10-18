import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * 从源码里抽出所有要翻译的中文文本（M4-3）：字符串字面量与模板字符串里含中文的部分。
 * 模板字符串的 ${…} 记作 {0}、{1}……；只有静态部分含中文的模板才算（纯拼接不算）。
 * 测试和翻译工具都用它：英文表的键集必须和这里抽出来的一致。
 */
const CJK = /[㐀-鿿！-～　-〿]/;

/** 参与翻译的源码目录（相对仓库根）。开发用的场景描述、测试、AI 提示词不算。 */
export const SOURCE_DIRS = ['apps/desktop/src/renderer', 'packages/sim/src', 'packages/content/src', 'packages/ui/src'] as const;
const SKIP = [/\.test\.ts$/, /scenarios\.ts$/, /testing\.ts$/, /\/i18n\//, /validate\.ts$/];

export interface Msg {
  readonly id: string;
  readonly file: string;
}

function files(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) out.push(...files(root, rel));
    else if (rel.endsWith('.ts') && !SKIP.some((r) => r.test(rel))) out.push(rel);
  }
  return out;
}

/** 这个调用是不是不给玩家看的（日志、抛出的内部错误、正则）？ */
function internal(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      if (/^console\./.test(callee)) return true;
    }
    if (ts.isNewExpression(p) && /^(RangeError|TypeError)$/.test(p.expression.getText())) return true;
    if (ts.isRegularExpressionLiteral(p)) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
  }
  return false;
}

export function templateId(node: ts.TemplateExpression): string | null {
  let id = node.head.text;
  let staticText = node.head.text;
  node.templateSpans.forEach((span, i) => {
    id += `{${i}}${span.literal.text}`;
    staticText += span.literal.text;
  });
  return CJK.test(staticText) ? id : null;
}

export function extract(root: string): Msg[] {
  const out = new Map<string, Msg>();
  for (const dir of SOURCE_DIRS) {
    for (const file of files(root, dir)) {
      const src = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node): void => {
        let id: string | null = null;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) id = CJK.test(node.text) ? node.text : null;
        else if (ts.isTemplateExpression(node)) id = templateId(node);
        if (id && !internal(node)) {
          // 多行文本按行拆（对话框按行显示）
          for (const line of id.split('\n')) if (CJK.test(line) && !out.has(line)) out.set(line, { id: line, file: relative(root, join(root, file)) });
        }
        ts.forEachChild(node, visit);
      };
      visit(src);
    }
  }
  return [...out.values()];
}
