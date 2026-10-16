import { ELEMENTS, NATURES, PART_SLOTS, STATS, type ContentDb, type PartSlot } from '@cloudsea/content';
import { PATTERNS, type Genes, type PartGene } from './types';

/**
 * 絮灵码（DESIGN 10）：XL-XXXX-XXXX-XXXX-XXXX-XXXX。
 * 92 位数据 + 8 位校验 = 100 位 = 20 个 Base32 字符（Crockford 字母表，去掉 I L O U）。
 * 字段顺序和位宽一旦发布就不能改；新增字段要升 version 并保留旧版本解码。
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_VERSION = 1;

interface Field {
  readonly bits: number;
}
const F = {
  version: { bits: 4 },
  formNo: { bits: 10 },
  level: { bits: 6 },
  sex: { bits: 1 },
  secondary: { bits: 3 },
  part: { bits: 4 },
  mutated: { bits: 1 },
  hue: { bits: 6 },
  pattern: { bits: 2 },
  size: { bits: 5 },
  talent: { bits: 5 },
  nature: { bits: 4 },
  shiny: { bits: 1 },
  checksum: { bits: 8 },
} satisfies Record<string, Field>;

export interface SpiritCodeData {
  readonly genes: Genes;
  readonly formId: string;
  readonly level: number;
}

class BitWriter {
  readonly bits: number[] = [];
  write(value: number, width: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) throw new RangeError(`value ${value} does not fit ${width} bits`);
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

class BitReader {
  pos = 0;
  constructor(readonly bits: readonly number[]) {}
  read(width: number): number {
    let v = 0;
    for (let i = 0; i < width; i++) v = (v << 1) | (this.bits[this.pos++] ?? 0);
    return v >>> 0;
  }
}

function checksum(bits: readonly number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    h = Math.imul(h ^ byte, 0x01000193);
  }
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff;
}

export function encodeSpiritCode(content: ContentDb, data: SpiritCodeData): string {
  const w = new BitWriter();
  const g = data.genes;
  const form = content.forms.get(data.formId);
  if (!form || form.line.id !== g.lineId) throw new Error('form does not belong to gene line');
  w.write(CODE_VERSION, F.version.bits);
  w.write(form.form.no, F.formNo.bits);
  w.write(data.level - 1, F.level.bits);
  w.write(g.sex === 'male' ? 1 : 0, F.sex.bits);
  w.write(g.secondaryElement ? ELEMENTS.indexOf(g.secondaryElement) + 1 : 0, F.secondary.bits);
  for (const slot of PART_SLOTS) {
    const id = g.parts[slot].partId;
    w.write(id ? content.parts.get(id)!.no : 0, F.part.bits);
  }
  for (const slot of PART_SLOTS) w.write(g.parts[slot].mutated ? 1 : 0, F.mutated.bits);
  w.write(g.hueShift + 18, F.hue.bits);
  w.write(PATTERNS.indexOf(g.pattern), F.pattern.bits);
  w.write(g.sizePercent - 85, F.size.bits);
  for (const s of STATS) w.write(g.talents[s], F.talent.bits);
  w.write(NATURES.findIndex((n) => n.id === g.natureId), F.nature.bits);
  w.write(g.shiny ? 1 : 0, F.shiny.bits);
  w.write(checksum(w.bits), F.checksum.bits);

  let chars = '';
  for (let i = 0; i < w.bits.length; i += 5) {
    let v = 0;
    for (let j = 0; j < 5; j++) v = (v << 1) | (w.bits[i + j] ?? 0);
    chars += ALPHABET[v];
  }
  return `XL-${chars.match(/.{1,4}/g)!.join('-')}`;
}

/** 解码絮灵码；无效时返回错误信息。导入的絮灵须由调用方标记为外来。 */
export function decodeSpiritCode(content: ContentDb, code: string): SpiritCodeData | string {
  const cleaned = code.trim().toUpperCase().replace(/^XL/, '').replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (cleaned.length !== 20) return '絮灵码长度不对';
  const bits: number[] = [];
  for (const ch of cleaned) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return `絮灵码里有无效字符 ${ch}`;
    for (let j = 4; j >= 0; j--) bits.push((v >>> j) & 1);
  }
  const payloadBits = bits.length - F.checksum.bits;
  const r = new BitReader(bits);
  if (r.read(F.version.bits) !== CODE_VERSION) return '不支持的絮灵码版本';
  const formEntry = content.formsByNo.get(r.read(F.formNo.bits));
  const level = r.read(F.level.bits) + 1;
  const sex = r.read(F.sex.bits) === 1 ? 'male' : 'female';
  const secIdx = r.read(F.secondary.bits);
  const partNos = PART_SLOTS.map(() => r.read(F.part.bits));
  const mutated = PART_SLOTS.map(() => r.read(F.mutated.bits) === 1);
  const hueShift = r.read(F.hue.bits) - 18;
  const pattern = PATTERNS[r.read(F.pattern.bits)];
  const sizePercent = r.read(F.size.bits) + 85;
  const talentValues = STATS.map(() => r.read(F.talent.bits));
  const nature = NATURES[r.read(F.nature.bits)];
  const shiny = r.read(F.shiny.bits) === 1;
  if (r.pos !== payloadBits) throw new Error('spirit code layout mismatch');
  if (r.read(F.checksum.bits) !== checksum(bits.slice(0, payloadBits))) return '絮灵码校验失败，可能抄错了';

  if (!formEntry) return '絮灵码里的物种不存在';
  if (level > 60) return '絮灵码里的等级无效';
  if (secIdx > ELEMENTS.length) return '絮灵码里的属性无效';
  const secondaryElement = secIdx === 0 ? null : ELEMENTS[secIdx - 1]!;
  if (secondaryElement === formEntry.line.element) return '絮灵码里的属性无效';
  if (!pattern || !nature || hueShift > 18 || sizePercent > 115) return '絮灵码里的外观或性格无效';

  const parts = {} as Record<PartSlot, PartGene>;
  for (const [i, slot] of PART_SLOTS.entries()) {
    const no = partNos[i]!;
    const part = no === 0 ? null : content.partsByNo.get(no);
    if (part === undefined) return '絮灵码里的零件不存在';
    const partId = part?.id ?? null;
    if (part && part.slot !== slot) return '絮灵码里的零件槽位不对';
    if (!formEntry.line.partPool[slot].some((e) => e.part === partId)) return '这只絮灵不可能长出这个零件';
    if (partId === null && mutated[i]) return '絮灵码里的异化标记无效';
    parts[slot] = { partId, mutated: mutated[i]! };
  }

  return {
    formId: formEntry.form.id,
    level,
    genes: {
      lineId: formEntry.line.id,
      sex,
      secondaryElement,
      parts,
      hueShift,
      pattern,
      sizePercent,
      talents: Object.fromEntries(STATS.map((s, i) => [s, talentValues[i]!])) as Record<(typeof STATS)[number], number>,
      natureId: nature.id,
      shiny,
    },
  };
}
