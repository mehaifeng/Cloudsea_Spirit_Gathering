import type { ContentDb, PartSlot } from '@cloudsea/content';
import { createSpirit } from './spirit/spirit';
import type { Genes, PartGene, Spirit } from './spirit/types';

/** 测试与工具用：按进化线快速造一只絮灵，零件可指定。 */
export function makeSpirit(
  content: ContentDb,
  lineId: string,
  level: number,
  o: {
    id?: string;
    owner?: string;
    formIndex?: number;
    parts?: Partial<Record<PartSlot, string | null>>;
    mutated?: PartSlot[];
    talents?: number;
    nature?: string;
    secondary?: Genes['secondaryElement'];
    skills?: string[];
  } = {},
): Spirit {
  const line = content.lines.get(lineId)!;
  const firstPart = (slot: PartSlot): string | null => line.partPool[slot][0]!.part;
  const parts = {} as Record<PartSlot, PartGene>;
  for (const slot of ['ears', 'horns', 'wings', 'tail', 'feet'] as const) {
    const partId = o.parts && slot in o.parts ? (o.parts[slot] ?? null) : firstPart(slot);
    parts[slot] = { partId, mutated: o.mutated?.includes(slot) ?? false };
  }
  const t = o.talents ?? 15;
  const s = createSpirit(content, {
    id: o.id ?? `${lineId}-${level}`,
    ownerId: o.owner ?? 'p1',
    level,
    ...(o.formIndex !== undefined ? { formIndex: o.formIndex } : {}),
    genes: {
      lineId,
      sex: 'female',
      secondaryElement: o.secondary ?? null,
      parts,
      hueShift: 0,
      pattern: 'plain',
      sizePercent: 100,
      talents: { hp: t, power: t, guard: t, agility: t, resonance: t },
      natureId: o.nature ?? 'calm',
      shiny: false,
    },
  });
  return o.skills ? { ...s, skillSlots: o.skills } : s;
}
