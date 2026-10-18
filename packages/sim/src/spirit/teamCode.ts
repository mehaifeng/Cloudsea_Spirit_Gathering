import type { ContentDb } from '@cloudsea/content';
import { base32ToBits, BitReader, bitsToBase32, BitWriter, checksum16, formatLongCode, readSpiritFields, SPIRIT_FIELD_BITS, writeSpiritFields, type SpiritCodeData } from './code';
import { equippableSkills, MAX_SKILL_SLOTS, skillPool } from './spirit';
import type { Spirit } from './types';

/**
 * 队伍码（DESIGN 10，M3-5）：最多 6 只絮灵的基因、等级、形态和装备的技能。
 * XT-XXXX-XXXX-…（多行文本块）。导入后由战斗 AI 操控，相当于异步 PvP。
 * 技能编号 = 技能在数据表里的顺序：技能表只能往后追加，不能插队或删除（否则旧码会错位）。
 */
const VERSION = 1;
const MAX_TEAM = 6;
const B = { version: 4, count: 3, skillCount: 3, skill: 7, checksum: 16 } as const;

/** 絮灵字段的错误换成队伍码的说法（写成字面量，本地化能抽到，M4-3）。 */
const TEAM_ERRORS: Readonly<Record<string, string>> = {
  絮灵码里的物种不存在: '队伍码里的物种不存在',
  絮灵码里的等级无效: '队伍码里的等级无效',
  絮灵码里的属性无效: '队伍码里的属性无效',
  絮灵码里的外观或性格无效: '队伍码里的外观或性格无效',
  絮灵码里的零件不存在: '队伍码里的零件不存在',
  絮灵码里的零件槽位不对: '队伍码里的零件槽位不对',
  絮灵码里的异化标记无效: '队伍码里的异化标记无效',
};

export interface TeamMember extends SpiritCodeData {
  readonly skills: readonly string[];
}

export function encodeTeamCode(content: ContentDb, spirits: readonly Spirit[]): string {
  const team = spirits.slice(0, MAX_TEAM);
  if (team.length === 0) throw new Error('empty team');
  const ids = [...content.skills.keys()];
  const w = new BitWriter();
  w.write(VERSION, B.version);
  w.write(team.length, B.count);
  for (const s of team) {
    writeSpiritFields(w, content, { genes: s.genes, formId: s.formId, level: s.level });
    const skills = s.skillSlots.slice(0, MAX_SKILL_SLOTS);
    w.write(skills.length, B.skillCount);
    for (const id of skills) w.write(ids.indexOf(id), B.skill);
  }
  w.write(checksum16(w.bits), B.checksum);
  return formatLongCode('XT', bitsToBase32(w.bits));
}

/** 解码队伍码；无效时返回错误信息。 */
export function decodeTeamCode(content: ContentDb, code: string): TeamMember[] | string {
  const body = code.trim().toUpperCase().replace(/^XT-?/, '');
  const bits = base32ToBits(body);
  if (!bits || bits.length < 40) return '队伍码不完整';
  const r = new BitReader(bits);
  if (r.read(B.version) !== VERSION) return '不支持的队伍码版本';
  const count = r.read(B.count);
  if (count < 1 || count > MAX_TEAM) return '队伍码里的数量不对';
  // 先按结构走一遍算出长度、核对校验位，再逐项检查含义（抄错时统一报“校验失败”）
  const scan = new BitReader(bits);
  scan.pos = r.pos;
  for (let i = 0; i < count; i++) {
    scan.pos += SPIRIT_FIELD_BITS;
    const n = scan.read(B.skillCount);
    scan.pos += n * B.skill;
  }
  const payload = scan.pos;
  if (payload + B.checksum > bits.length) return '队伍码不完整，可能没抄全';
  if (scan.read(B.checksum) !== checksum16(bits.slice(0, payload))) return '队伍码校验失败，可能抄错了';
  if (bits.length - scan.pos >= 5 || bits.slice(scan.pos).some((b) => b !== 0)) return '队伍码长度不对';
  const ids = [...content.skills.keys()];
  const bookSkills = new Set([...content.items.values()].map((i) => i.teaches).filter((x): x is string => !!x));
  const out: TeamMember[] = [];
  for (let i = 0; i < count; i++) {
    const data = readSpiritFields(r, content);
    if (typeof data === 'string') return TEAM_ERRORS[data] ?? '队伍码里有无效的絮灵';
    const n = r.read(B.skillCount);
    if (n > MAX_SKILL_SLOTS) return '队伍码里的技能数不对';
    const skills: string[] = [];
    for (let j = 0; j < n; j++) {
      const id = ids[r.read(B.skill)];
      if (!id) return '队伍码里的技能不存在';
      skills.push(id);
    }
    // 技能必须是它能学会的：本源 / 零件技能，或技能书
    const base = skillPool(content, { formId: data.formId, genes: data.genes, learnedSkills: [] });
    const learned = skills.filter((id) => !base.includes(id));
    if (learned.some((id) => !bookSkills.has(id))) return '队伍码里有这只絮灵学不会的技能';
    if (new Set(skills).size !== skills.length) return '队伍码里的技能重复了';
    const allowed = equippableSkills(content, { formId: data.formId, genes: data.genes, learnedSkills: learned });
    if (skills.some((id) => !allowed.includes(id))) return '队伍码里有不能装备的技能';
    out.push({ ...data, skills });
  }
  return out;
}
