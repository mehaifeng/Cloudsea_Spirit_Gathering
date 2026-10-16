import {
  NATURES,
  PART_SLOTS,
  STATS,
  type ContentDb,
  type Element,
  type Line,
  type PartSlot,
  type Stat,
  ELEMENTS,
} from '@cloudsea/content';
import type { Rng } from '../rng';
import { PATTERNS, type Genes, type PartGene, type Pattern } from './types';

/** 稀有特质的概率（DESIGN 4.2；野外双属性为补充决定）。 */
export const SHINY_CHANCE = 1 / 512;
export const MUTATION_CHANCE = 1 / 256;
export const WILD_DUAL_CHANCE = 1 / 100;

const PATTERN_WEIGHTS: Readonly<Record<Pattern, number>> = { plain: 2, spots: 2, stripes: 1 };

export function randomSex(rng: Rng, line: Line): 'male' | 'female' {
  return rng.chance(line.sexRatio) ? 'male' : 'female';
}

export function randomPartGene(rng: Rng, line: Line, slot: PartSlot): PartGene {
  const pool = line.partPool[slot];
  const entry = pool[rng.weightedIndex(pool.map((e) => e.weight))]!;
  return { partId: entry.part, mutated: entry.part !== null && rng.chance(MUTATION_CHANCE) };
}

export function randomPattern(rng: Rng): Pattern {
  return PATTERNS[rng.weightedIndex(PATTERNS.map((p) => PATTERN_WEIGHTS[p]))]!;
}

export function randomTalents(rng: Rng): Record<Stat, number> {
  return Object.fromEntries(STATS.map((s) => [s, rng.int(0, 31)])) as Record<Stat, number>;
}

export function otherElement(rng: Rng, not: Element): Element {
  return rng.pick(ELEMENTS.filter((e) => e !== not));
}

/** 野生个体的基因。 */
export function generateWildGenes(rng: Rng, line: Line): Genes {
  const parts = Object.fromEntries(PART_SLOTS.map((slot) => [slot, randomPartGene(rng, line, slot)])) as Record<
    PartSlot,
    PartGene
  >;
  return {
    lineId: line.id,
    sex: randomSex(rng, line),
    secondaryElement: rng.chance(WILD_DUAL_CHANCE) ? otherElement(rng, line.element) : null,
    parts,
    hueShift: rng.int(-18, 18),
    pattern: randomPattern(rng),
    sizePercent: rng.int(85, 115),
    talents: randomTalents(rng),
    natureId: rng.pick(NATURES).id,
    shiny: rng.chance(SHINY_CHANCE),
  };
}

/** 属性列表：主属性在前。 */
export function elementsOf(content: ContentDb, genes: Genes): readonly Element[] {
  const primary = content.lines.get(genes.lineId)!.element;
  return genes.secondaryElement ? [primary, genes.secondaryElement] : [primary];
}
