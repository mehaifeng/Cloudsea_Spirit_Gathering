import type { z } from 'zod';
import { buildingSchema, cropSchema, recipeSchema, type Building, type BuildingInput, type Crop, type Recipe, type RecipeInput } from './buildings';
import { BUILDINGS, CROPS, RECIPES } from './data/buildings';
import { BLUEPRINT_SHOP, coreUpgradeCost, ORDER_TEMPLATES, toolUpgradeCost } from './data/economy';
import { ISLANDS } from './data/islands';
import { ITEMS } from './data/items';
import { DIALOGUE, KEEPERS } from './data/keepers';
import { LINES } from './data/lines';
import { PARTS } from './data/parts';
import { SKILLS } from './data/skills';
import { ELEMENT_BOOK_SKILL, ELEMENTS, INNATE_SKILL } from './elements';
import { GATHER_YIELD, islandSchema, type Island, type IslandInput } from './islands';
import { itemSchema, type Item, type ItemInput } from './items';
import { dialogueLineSchema, keeperSchema, SITUATIONS, type DialogueLine, type Keeper, type KeeperInput } from './keepers';
import { partSchema, PART_SLOTS, type Part, type PartInput } from './parts';
import { PASSIVE_KINDS, skillSchema, type Skill, type SkillInput } from './skills';
import { lineSchema, type Form, type Line, type LineInput } from './species';

export interface RawContent {
  readonly skills: readonly SkillInput[];
  readonly parts: readonly PartInput[];
  readonly lines: readonly LineInput[];
  readonly items?: readonly ItemInput[];
  readonly buildings?: readonly BuildingInput[];
  readonly recipes?: readonly RecipeInput[];
  readonly crops?: readonly Crop[];
  readonly islands?: readonly IslandInput[];
  readonly keepers?: readonly KeeperInput[];
  readonly dialogue?: readonly DialogueLine[];
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
  /** 按编号索引（絮灵码解码用）。 */
  readonly partsByNo: ReadonlyMap<number, Part>;
  readonly formsByNo: ReadonlyMap<number, FormEntry>;
  readonly items: ReadonlyMap<string, Item>;
  readonly buildings: ReadonlyMap<string, Building>;
  readonly recipes: ReadonlyMap<string, Recipe>;
  readonly crops: ReadonlyMap<string, Crop>;
  readonly islands: ReadonlyMap<string, Island>;
  readonly keepers: ReadonlyMap<string, Keeper>;
  readonly dialogue: readonly DialogueLine[];
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

  // 编号唯一
  const dupNo = (kind: string, nos: number[]): void => {
    const seen = new Set<number>();
    for (const n of nos) {
      if (seen.has(n)) issues.push(`${kind} 编号 ${n} 重复`);
      seen.add(n);
    }
  };
  dupNo('part', [...parts.values()].map((p) => p.no));
  dupNo('form', [...forms.values()].map((f) => f.form.no));

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

  // ---------- 经营与世界 ----------
  const items = indexById('item', parseAll('item', itemSchema, raw.items ?? []), issues);
  const buildings = indexById('building', parseAll('building', buildingSchema, raw.buildings ?? []), issues);
  const recipes = indexById('recipe', parseAll('recipe', recipeSchema, raw.recipes ?? []), issues);
  const crops = indexById('crop', parseAll('crop', cropSchema, raw.crops ?? []), issues);
  const islands = indexById('island', parseAll('island', islandSchema, raw.islands ?? []), issues);
  const keepers = indexById('keeper', parseAll('keeper', keeperSchema, raw.keepers ?? []), issues);
  const dialogue = parseAll('dialogue', dialogueLineSchema, raw.dialogue ?? []);

  if (raw.items) {
    const needItem = (where: string, id: string) => {
      if (!items.has(id)) issues.push(`${where}: 物品 ${id} 不存在`);
    };
    for (const it of items.values()) {
      if (it.teaches) {
        const sk = skills.get(it.teaches);
        if (!sk || sk.source !== 'book') issues.push(`item ${it.id}: 技能书教的 ${it.teaches} 不是技能书技能`);
      }
      if (it.grows && !crops.has(it.grows)) issues.push(`item ${it.id}: 作物 ${it.grows} 不存在`);
    }
    for (const el of ELEMENTS) {
      const book = ELEMENT_BOOK_SKILL[el];
      if (![...items.values()].some((i) => i.teaches === book)) issues.push(`技能书 ${book} 没有对应物品`);
    }
    for (const c of crops.values()) needItem(`crop ${c.id}`, c.item);
    for (const b of buildings.values()) for (const st of b.cost.items) needItem(`building ${b.id}`, st.item);
    for (const r of recipes.values()) {
      const b = buildings.get(r.building);
      if (!b || b.kind !== 'workshop') issues.push(`recipe ${r.id}: 建筑 ${r.building} 不是工坊`);
      else if (!b.workTasks.includes(r.task)) issues.push(`recipe ${r.id}: 工坊不做 ${r.task}`);
      for (const st of [...r.inputs, r.output]) needItem(`recipe ${r.id}`, st.item);
    }
    for (const g of Object.values(GATHER_YIELD)) needItem('gather', g.item);
    for (const o of ORDER_TEMPLATES) needItem('order', o.item);
    for (const bp of BLUEPRINT_SHOP) if (!buildings.has(bp.blueprint)) issues.push(`blueprint shop: ${bp.blueprint} 不存在`);
    for (let lv = 1; lv < 10; lv++) for (const st of coreUpgradeCost(lv).items) needItem('core upgrade', st.item);
    for (const tool of ['lantern', 'sail', 'gatherTool'] as const) for (const st of toolUpgradeCost(tool, 1).items) needItem(`tool ${tool}`, st.item);

    for (const isl of islands.values()) {
      if ((isl.kind === 'keeper') !== !!isl.keeper) issues.push(`island ${isl.id}: 守岛人岛必须（且只有它）指定守岛人`);
      if (isl.keeper && !keepers.has(isl.keeper)) issues.push(`island ${isl.id}: 守岛人 ${isl.keeper} 不存在`);
      if (isl.wildLevel.min > isl.wildLevel.max) issues.push(`island ${isl.id}: 野生等级范围无效`);
    }
    for (const k of keepers.values()) {
      for (const id of [...k.gifts.loved, ...k.gifts.liked, ...k.gifts.disliked]) needItem(`keeper ${k.id} gifts`, id);
      for (const c of k.coreSpirits) if (!lines.has(c.line)) issues.push(`keeper ${k.id}: 进化线 ${c.line} 不存在`);
      for (const r of k.relations) if (!keepers.has(r.keeper)) issues.push(`keeper ${k.id}: 关系对象 ${r.keeper} 不存在`);
      const nodeIds = new Set(k.story.map((n) => n.id));
      for (const n of k.story) {
        if (n.after && !nodeIds.has(n.after)) issues.push(`keeper ${k.id}: 节点 ${n.id} 的前置 ${n.after} 不存在`);
        for (const st of n.reward?.items ?? []) needItem(`keeper ${k.id} story`, st.item);
        if (n.reward?.blueprint && !buildings.has(n.reward.blueprint)) issues.push(`keeper ${k.id}: 蓝图 ${n.reward.blueprint} 不存在`);
      }
      for (const sit of SITUATIONS) {
        if (!dialogue.some((d) => d.keeper === k.id && d.situation === sit)) issues.push(`keeper ${k.id}: 情境 ${sit} 没有对话`);
      }
    }
    for (const d of dialogue) if (!keepers.has(d.keeper)) issues.push(`dialogue: 守岛人 ${d.keeper} 不存在`);
  }

  if (issues.length > 0) throw new ContentError(issues);
  return {
    skills,
    parts,
    lines,
    forms,
    partsByNo: new Map([...parts.values()].map((p) => [p.no, p])),
    formsByNo: new Map([...forms.values()].map((f) => [f.form.no, f])),
    items,
    buildings,
    recipes,
    crops,
    islands,
    keepers,
    dialogue,
  };
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
  cached ??= buildContent({
    skills: SKILLS,
    parts: PARTS,
    lines: LINES,
    items: ITEMS,
    buildings: BUILDINGS,
    recipes: RECIPES,
    crops: CROPS,
    islands: ISLANDS,
    keepers: KEEPERS,
    dialogue: DIALOGUE,
  });
  return cached;
}
