import {
  ELEMENT_INFO,
  INNATE_SKILL,
  NATURES,
  NATURE_STATS,
  NATURE_MULTIPLIER,
  PART_SLOTS,
  STAGES,
  type ContentDb,
  type Element,
  type FormEntry,
  type PartSlot,
  type Stage,
} from '@cloudsea/content';
import type { Genes, Spirit, Stats } from './types';

export const MAX_LEVEL = 60;
export const MAX_SKILL_SLOTS = 4;

export function formOf(content: ContentDb, spirit: Pick<Spirit, 'formId'>): FormEntry {
  const f = content.forms.get(spirit.formId);
  if (!f) throw new Error(`unknown form ${spirit.formId}`);
  return f;
}

function natureMultiplier(natureId: string, stat: string): number {
  const n = NATURES.find((x) => x.id === natureId);
  if (!n || n.up === n.down) return 1;
  if (stat === n.up) return 1 + NATURE_MULTIPLIER;
  if (stat === n.down) return 1 - NATURE_MULTIPLIER;
  return 1;
}

/**
 * 数值公式（DESIGN 4.3）：
 * 属性值 = floor((基础×2 + 资质) × 等级/60 × 性格系数) + 5
 * 生命值 = floor((基础×2 + 资质) × 等级/60) + 等级 + 10
 */
export function computeStats(content: ContentDb, spirit: Pick<Spirit, 'formId' | 'level' | 'genes'>): Stats {
  const { form } = formOf(content, spirit);
  const { level, genes } = spirit;
  const raw = (stat: keyof Stats): number => (form.baseStats[stat] * 2 + genes.talents[stat]) * (level / MAX_LEVEL);
  const out: Record<string, number> = { hp: Math.floor(raw('hp')) + level + 10 };
  for (const s of NATURE_STATS) out[s] = Math.floor(raw(s) * natureMultiplier(genes.natureId, s)) + 5;
  return out as unknown as Stats;
}

/** 累计经验：到达等级 L 共需 floor(4 × L³ / 5)（DESIGN 4.3）。 */
export function expForLevel(level: number): number {
  return Math.floor((4 * level ** 3) / 5);
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/** 当前进化段已经长出的零件（零件池的 minStage，决策 D28）。 */
export function expressedParts(content: ContentDb, spirit: Pick<Spirit, 'formId' | 'genes'>): Record<PartSlot, string | null> {
  const { form, line } = formOf(content, spirit);
  const cur = stageIndex(form.stage);
  const out = {} as Record<PartSlot, string | null>;
  for (const slot of PART_SLOTS) {
    const gene = spirit.genes.parts[slot];
    const entry = line.partPool[slot].find((e) => e.part === gene.partId);
    const min = entry?.minStage ? stageIndex(entry.minStage) : 0;
    out[slot] = gene.partId !== null && cur >= min ? gene.partId : null;
  }
  return out;
}

/** 技能池：本源 1 + 已长出零件的技能 + 技能书（DESIGN 4.4）。 */
export function skillPool(content: ContentDb, spirit: Pick<Spirit, 'formId' | 'genes' | 'learnedSkills'>): string[] {
  const { line } = formOf(content, spirit);
  const pool = [INNATE_SKILL[line.element]];
  const parts = expressedParts(content, spirit);
  for (const slot of PART_SLOTS) {
    const id = parts[slot];
    if (id) pool.push(content.parts.get(id)!.skill);
  }
  for (const s of spirit.learnedSkills) if (!pool.includes(s)) pool.push(s);
  return pool;
}

/** 可以放进装备栏的技能（被动技能不占栏）。 */
export function equippableSkills(content: ContentDb, spirit: Pick<Spirit, 'formId' | 'genes' | 'learnedSkills'>): string[] {
  return skillPool(content, spirit).filter((id) => !content.skills.get(id)!.passive);
}

/** 生效的被动技能。 */
export function passiveSkills(content: ContentDb, spirit: Pick<Spirit, 'formId' | 'genes' | 'learnedSkills'>): string[] {
  return skillPool(content, spirit).filter((id) => content.skills.get(id)!.passive);
}

export function defaultSkillSlots(content: ContentDb, spirit: Pick<Spirit, 'formId' | 'genes' | 'learnedSkills'>): string[] {
  return equippableSkills(content, spirit).slice(0, MAX_SKILL_SLOTS);
}

/** 更换装备栏（在栖巢或训练场免费更换）。返回错误信息或新絮灵。 */
export function equipSkills(content: ContentDb, spirit: Spirit, slots: readonly string[]): Spirit | string {
  if (slots.length > MAX_SKILL_SLOTS) return '装备栏最多 4 个技能';
  if (new Set(slots).size !== slots.length) return '同一技能不能装备两次';
  const allowed = new Set(equippableSkills(content, spirit));
  const bad = slots.find((s) => !allowed.has(s));
  if (bad) return `技能 ${bad} 不在技能池中`;
  return { ...spirit, skillSlots: [...slots] };
}

/** 增加经验并处理升级，最高 60 级。 */
export function addExp(spirit: Spirit, amount: number): Spirit {
  if (spirit.level >= MAX_LEVEL) return spirit;
  const exp = Math.min(spirit.exp + Math.max(0, Math.floor(amount)), expForLevel(MAX_LEVEL));
  let level = spirit.level;
  while (level < MAX_LEVEL && exp >= expForLevel(level + 1)) level++;
  return { ...spirit, exp, level };
}

export interface EvolveEnv {
  readonly weather: Element | null;
  readonly isNight: boolean;
}

/** 进化条件检查（DESIGN 4.2）；返回不满足的原因，满足时返回 null。 */
export function evolutionBlocker(content: ContentDb, spirit: Spirit, env: EvolveEnv): string | null {
  const { form, line, index } = formOf(content, spirit);
  const next = line.forms[index + 1];
  const evo = form.evolution;
  if (!next || !evo) return '已是最终形态';
  if (spirit.state === 'egg' || spirit.state === 'purifying') return '现在不能进化';
  if (spirit.level < evo.level) return `需要 ${evo.level} 级`;
  if (evo.weather && env.weather !== evo.weather) return `需要在${ELEMENT_INFO[evo.weather].name}天进化`;
  if (evo.time === 'night' && !env.isNight) return '需要在夜晚进化';
  if (evo.time === 'day' && env.isNight) return '需要在白天进化';
  return null;
}

/** 进化（玩家确认后调用）：保留基因与技能，新长出的零件技能放进空栏。 */
export function evolve(content: ContentDb, spirit: Spirit, env: EvolveEnv): Spirit | string {
  const blocker = evolutionBlocker(content, spirit, env);
  if (blocker) return blocker;
  const { line, index } = formOf(content, spirit);
  const evolved: Spirit = { ...spirit, formId: line.forms[index + 1]!.id };
  const slots = [...spirit.skillSlots];
  for (const s of equippableSkills(content, evolved)) {
    if (slots.length >= MAX_SKILL_SLOTS) break;
    if (!slots.includes(s)) slots.push(s);
  }
  return { ...evolved, skillSlots: slots };
}

export interface NewSpiritOptions {
  readonly id: string;
  readonly ownerId: string;
  readonly genes: Genes;
  readonly level: number;
  readonly formIndex?: number;
  readonly state?: Spirit['state'];
  readonly blighted?: boolean;
  readonly foreign?: boolean;
  readonly readyAtTick?: number;
}

export function createSpirit(content: ContentDb, o: NewSpiritOptions): Spirit {
  const line = content.lines.get(o.genes.lineId);
  if (!line) throw new Error(`unknown line ${o.genes.lineId}`);
  const form = line.forms[o.formIndex ?? 0];
  if (!form) throw new Error(`line ${line.id} has no form ${o.formIndex}`);
  const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(o.level)));
  const base = {
    id: o.id,
    ownerId: o.ownerId,
    genes: o.genes,
    formId: form.id,
    level,
    exp: expForLevel(level),
    nickname: null,
    learnedSkills: [] as string[],
    state: o.state ?? 'idle',
    condition: null,
    foreign: o.foreign ?? false,
    blighted: o.blighted ?? false,
    readyAtTick: o.readyAtTick ?? 0,
    breedReadyTick: 0,
  };
  return { ...base, skillSlots: defaultSkillSlots(content, base) };
}

export function displayName(content: ContentDb, spirit: Spirit): string {
  return spirit.nickname ?? formOf(content, spirit).form.name;
}
