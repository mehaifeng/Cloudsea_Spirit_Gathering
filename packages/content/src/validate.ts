import type { z } from 'zod';
import { LINES } from './data/lines';
import { PARTS } from './data/parts';
import { SKILLS } from './data/skills';
import { ELEMENTS, INNATE_SKILL } from './elements';
import { partSchema, PART_SLOTS, type Part, type PartInput } from './parts';
import { PASSIVE_KINDS, skillSchema, type Skill, type SkillInput } from './skills';
import { lineSchema, type Form, type Line, type LineInput } from './species';

export interface RawContent {
  readonly skills: readonly SkillInput[];
  readonly parts: readonly PartInput[];
  readonly lines: readonly LineInput[];
}

export interface FormEntry {
  readonly form: Form;
  readonly line: Line;
  /** 在进化线中的序号（0 = 幼絮）。 */
  readonly index: number;
}

/** 校验过的内容库。sim 与 render 都从这里取数据。 */
export interface ContentDb {
  readonly skills: ReadonlyMap<string, Skill>;
  readonly parts: ReadonlyMap<string, Part>;
  readonly lines: ReadonlyMap<string, Line>;
  readonly forms: ReadonlyMap<string, FormEntry>;
}

export class ContentError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`内容校验失败（${issues.length} 处）：\n- ${issues.join('\n- ')}`);
    this.name = 'ContentError';
  }
}

/** 校验原始数据（schema + 交叉引用），全部问题一次性报出。 */
export function buildContent(raw: RawContent): ContentDb {
  const issues: string[] = [];

  const parseAll = <S extends z.ZodType>(kind: string, schema: S, items: readonly unknown[]): Array<z.infer<S>> =>
    items.flatMap((item, i) => {
      const r = schema.safeParse(item);
      if (r.success) return [r.data];
      for (const e of r.error.issues) issues.push(`${kind}[${i}] ${e.path.join('.')}: ${e.message}`);
      return [];
    });

  const skills = indexById('skill', parseAll('skill', skillSchema, raw.skills), issues);
  const parts = indexById('part', parseAll('part', partSchema, raw.parts), issues);
  const lines = indexById('line', parseAll('line', lineSchema, raw.lines), issues);

  // 形态 id 全局唯一
  const forms = new Map<string, FormEntry>();
  for (const line of lines.values()) {
    line.forms.forEach((form, index) => {
      if (forms.has(form.id)) issues.push(`form ${form.id}: id 重复`);
      forms.set(form.id, { form, line, index });
    });
  }

  // 本源技能：每个属性一个，属性一致
  for (const el of ELEMENTS) {
    const s = skills.get(INNATE_SKILL[el]);
    if (!s) issues.push(`本源技能 ${INNATE_SKILL[el]}（${el}）不存在`);
    else if (s.source !== 'innate' || s.element !== el) issues.push(`本源技能 ${s.id} 的来源或属性不符`);
  }

  // 零件 → 技能
  const usedPartSkills = new Set<string>();
  for (const p of parts.values()) {
    const s = skills.get(p.skill);
    if (!s) {
      issues.push(`part ${p.id}: 技能 ${p.skill} 不存在`);
      continue;
    }
    usedPartSkills.add(s.id);
    if (s.source !== 'part') issues.push(`part ${p.id}: 技能 ${s.id} 的来源不是 part`);
    if (p.mutation.powerMultiplier !== undefined && s.category !== 'attack') {
      issues.push(`part ${p.id}: 异化威力倍率只能用于攻击技能`);
    }
    for (const e of p.mutation.extraEffects ?? []) {
      if (PASSIVE_KINDS.has(e.kind) !== s.passive) issues.push(`part ${p.id}: 异化效果 ${e.kind} 与技能是否被动不符`);
    }
  }
  for (const s of skills.values()) {
    if (s.source === 'part' && !usedPartSkills.has(s.id)) issues.push(`skill ${s.id}: 零件技能没有零件携带`);
  }

  // 进化线零件池 → 零件，且槽位一致
  for (const line of lines.values()) {
    for (const slot of PART_SLOTS) {
      for (const entry of line.partPool[slot]) {
        if (entry.part === null) continue;
        const p = parts.get(entry.part);
        if (!p) issues.push(`line ${line.id}: ${slot} 槽的零件 ${entry.part} 不存在`);
        else if (p.slot !== slot) issues.push(`line ${line.id}: 零件 ${p.id} 属于 ${p.slot} 槽，不能放进 ${slot} 槽`);
      }
    }
  }

  if (issues.length > 0) throw new ContentError(issues);
  return { skills, parts, lines, forms };
}

function indexById<T extends { id: string }>(kind: string, items: readonly T[], issues: string[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) issues.push(`${kind} ${item.id}: id 重复`);
    map.set(item.id, item);
  }
  return map;
}

let cached: ContentDb | undefined;

/** 内置内容库（首次调用时校验，之后复用）。 */
export function getContent(): ContentDb {
  cached ??= buildContent({ skills: SKILLS, parts: PARTS, lines: LINES });
  return cached;
}
