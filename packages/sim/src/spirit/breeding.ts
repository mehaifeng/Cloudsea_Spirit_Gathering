import { GENERATES, NATURES, PART_SLOTS, STATS, type ContentDb, type Element, type PartSlot, type Stat } from '@cloudsea/content';
import type { Rng } from '../rng';
import { otherElement, randomSex, SHINY_CHANCE } from './genes';
import { createSpirit, formOf } from './spirit';
import type { Genes, PartGene, Spirit } from './types';

/** 繁殖参数（DESIGN 4.5、决策 D24）。 */
export const BREEDING = {
  partMutationChance: 0.05,
  partMutationChanceGenerating: 0.08,
  keepMutatedChance: 0.25,
  inheritedTalents: 3,
  parentShinyChance: 1 / 128,
  dualChanceGenerating: 0.03,
  inheritSecondaryChance: 0.3,
  inheritNatureChance: 0.5,
  hueJitter: 4,
  sizeJitter: 5,
} as const;

export interface BreedContext {
  readonly now: number;
  readonly ticksPerDay: number;
  readonly eggId: string;
}

/** 两只絮灵的主属性是否相生（任一方向）。 */
export function resonant(content: ContentDb, a: Spirit, b: Spirit): boolean {
  const ea = content.lines.get(a.genes.lineId)!.element;
  const eb = content.lines.get(b.genes.lineId)!.element;
  return GENERATES[ea] === eb || GENERATES[eb] === ea;
}

/** 两只絮灵能否繁殖；可以返回 null，否则返回原因。 */
export function breedBlocker(content: ContentDb, a: Spirit, b: Spirit, now: number): string | null {
  if (a.id === b.id) return '需要两只絮灵';
  if (a.genes.sex === b.genes.sex) return '需要一雄一雌';
  // 共鸣繁殖（M3-5，DESIGN 4.5）：不同物种只能在主属性相生时繁殖
  if (a.genes.lineId !== b.genes.lineId && !resonant(content, a, b)) return '属性不相生，不能共鸣繁殖（只有同物种或相生属性的物种之间可以）';
  for (const s of [a, b]) {
    const name = s.nickname ?? formOf(content, s).form.name;
    if (s.foreign) return `${name} 是外来絮灵，不能繁殖`;
    if (s.state === 'egg' || s.state === 'purifying') return `${name} 现在不能繁殖`;
    if (s.breedReadyTick > now) return `${name} 还在繁殖冷却中`;
  }
  return null;
}

function inheritPart(rng: Rng, content: ContentDb, lineId: string, slot: PartSlot, father: PartGene, mother: PartGene, generating: boolean): PartGene {
  let from = rng.chance(0.5) ? father : mother;
  // 共鸣繁殖：父方的零件母方物种长不出来时，这一槽按母方遗传（物种随母方）
  if (from === father && !content.lines.get(lineId)!.partPool[slot].some((e) => e.part === father.partId)) from = mother;
  let gene: PartGene = { partId: from.partId, mutated: from.mutated && rng.chance(BREEDING.keepMutatedChance) };
  const mutateChance = generating ? BREEDING.partMutationChanceGenerating : BREEDING.partMutationChance;
  if (rng.chance(mutateChance)) {
    const pool = content.lines.get(lineId)!.partPool[slot].filter((e) => e.part !== gene.partId);
    if (pool.length > 0) gene = { partId: pool[rng.weightedIndex(pool.map((e) => e.weight))]!.part, mutated: false };
  }
  return gene;
}

function inheritSecondary(rng: Rng, primary: Element, father: Genes, mother: Genes, fatherEl: Element, motherEl: Element): Element | null {
  const passed = [father, mother]
    .filter((g) => g.secondaryElement !== null && rng.chance(BREEDING.inheritSecondaryChance))
    .map((g) => g.secondaryElement!);
  if (passed.length > 0) {
    const el = rng.pick(passed);
    return el === primary ? null : el;
  }
  const generating = GENERATES[fatherEl] === motherEl || GENERATES[motherEl] === fatherEl;
  if (generating && rng.chance(BREEDING.dualChanceGenerating)) return otherElement(rng, primary);
  return null;
}

/**
 * 繁殖：生成一枚蛋（DESIGN 4.5）。蛋带完整基因；物种 = 母方物种，后代等级 1、幼絮形态。
 * 双亲进入 1 游戏日冷却；蛋的孵化时间由繁殖屋决定（readyAtTick 由调用方传入）。
 */
export function breed(
  content: ContentDb,
  rng: Rng,
  a: Spirit,
  b: Spirit,
  ctx: BreedContext & { readonly hatchTicks: number },
): { egg: Spirit; father: Spirit; mother: Spirit } | string {
  const blocker = breedBlocker(content, a, b, ctx.now);
  if (blocker) return blocker;
  const [father, mother] = a.genes.sex === 'male' ? [a, b] : [b, a];
  const fg = father.genes;
  const mg = mother.genes;
  const line = content.lines.get(mg.lineId)!;
  const fatherEl = content.lines.get(fg.lineId)!.element;
  const motherEl = line.element;
  const generating = GENERATES[fatherEl] === motherEl || GENERATES[motherEl] === fatherEl;

  const parts = Object.fromEntries(
    PART_SLOTS.map((slot) => [slot, inheritPart(rng, content, line.id, slot, fg.parts[slot], mg.parts[slot], generating)]),
  ) as Record<PartSlot, PartGene>;

  const inherited = new Set(rng.shuffle(STATS).slice(0, BREEDING.inheritedTalents));
  const talents = Object.fromEntries(
    STATS.map((s) => [s, inherited.has(s) ? (rng.chance(0.5) ? fg : mg).talents[s] : rng.int(0, 31)]),
  ) as Record<Stat, number>;

  const genes: Genes = {
    lineId: line.id,
    sex: randomSex(rng, line),
    secondaryElement: inheritSecondary(rng, motherEl, fg, mg, fatherEl, motherEl),
    parts,
    hueShift: clamp(Math.round((fg.hueShift + mg.hueShift) / 2) + rng.int(-BREEDING.hueJitter, BREEDING.hueJitter), -18, 18),
    pattern: rng.chance(0.5) ? fg.pattern : mg.pattern,
    sizePercent: clamp(Math.round((fg.sizePercent + mg.sizePercent) / 2) + rng.int(-BREEDING.sizeJitter, BREEDING.sizeJitter), 85, 115),
    talents,
    natureId: rng.chance(BREEDING.inheritNatureChance) ? (rng.chance(0.5) ? fg : mg).natureId : rng.pick(NATURES).id,
    shiny: rng.chance(fg.shiny || mg.shiny ? BREEDING.parentShinyChance : SHINY_CHANCE),
  };

  const egg = createSpirit(content, {
    id: ctx.eggId,
    ownerId: mother.ownerId,
    genes,
    level: 1,
    state: 'egg',
    readyAtTick: ctx.now + ctx.hatchTicks,
  });
  const cooldown = ctx.now + ctx.ticksPerDay;
  return {
    egg,
    father: { ...father, breedReadyTick: cooldown },
    mother: { ...mother, breedReadyTick: cooldown },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
