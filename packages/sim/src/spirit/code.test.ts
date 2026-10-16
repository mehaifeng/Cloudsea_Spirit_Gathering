import { getContent } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { decodeSpiritCode, encodeSpiritCode } from './code';
import { generateWildGenes } from './genes';

const content = getContent();

describe('絮灵码', () => {
  it('随机个体编码再解码完全一致，长度 ≤ 24（不含连字符）', () => {
    const rng = createRng(2024);
    const forms = [...content.forms.values()];
    for (let i = 0; i < 3000; i++) {
      const f = rng.pick(forms);
      const genes = generateWildGenes(rng, f.line);
      // 覆盖稀有特质
      const g = { ...genes, shiny: rng.chance(0.5), secondaryElement: rng.chance(0.3) ? genes.secondaryElement : null };
      const data = { genes: g, formId: f.form.id, level: rng.int(1, 60) };
      const code = encodeSpiritCode(content, data);
      expect(code).toMatch(/^XL(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
      expect(code.replace(/-/g, '').length).toBeLessThanOrEqual(24);
      expect(decodeSpiritCode(content, code)).toEqual(data);
    }
  });

  it('容忍小写、空格、O/0 与 I/L/1 混淆', () => {
    const rng = createRng(1);
    const genes = generateWildGenes(rng, content.lines.get('warmbud')!);
    const data = { genes, formId: 'warmbud', level: 7 };
    const code = encodeSpiritCode(content, data);
    const sloppy = ` ${code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/-/g, ' ')} `;
    expect(decodeSpiritCode(content, sloppy)).toEqual(data);
  });

  it('抄错一个字符能被发现', () => {
    const rng = createRng(9);
    let detected = 0;
    let edits = 0;
    for (let i = 0; i < 500; i++) {
      const genes = generateWildGenes(rng, content.lines.get('kitefluff')!);
      const code = encodeSpiritCode(content, { genes, formId: 'kitefluff', level: 10 });
      const chars = code.split('');
      const pos = 3 + rng.int(0, 23);
      if (chars[pos] === '-') continue;
      edits++;
      chars[pos] = chars[pos] === 'A' ? 'B' : 'A';
      if (typeof decodeSpiritCode(content, chars.join('')) === 'string') detected++;
    }
    expect(detected / edits).toBeGreaterThan(0.97);
  });

  it('长度不对、无效字符', () => {
    expect(decodeSpiritCode(content, 'XL-1234')).toBe('絮灵码长度不对');
    expect(decodeSpiritCode(content, 'XL-UUUU-UUUU-UUUU-UUUU-UUUU')).toMatch(/无效字符/);
  });
});
