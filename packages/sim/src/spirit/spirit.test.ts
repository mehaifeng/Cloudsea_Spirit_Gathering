import { getContent, NATURES, STATS } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { generateWildGenes } from './genes';
import {
  addExp,
  computeStats,
  createSpirit,
  equipSkills,
  evolutionBlocker,
  evolve,
  expForLevel,
  expressedParts,
  passiveSkills,
  skillPool,
} from './spirit';
import type { Genes, Spirit } from './types';

const content = getContent();
const line = (id: string) => content.lines.get(id)!;

/** 一份固定的基因，便于手算。 */
function fixedGenes(over: Partial<Genes> = {}): Genes {
  return {
    lineId: 'warmbud',
    sex: 'female',
    secondaryElement: null,
    parts: {
      ears: { partId: 'floppyEars', mutated: false },
      horns: { partId: 'singleHorn', mutated: false },
      wings: { partId: null, mutated: false },
      tail: { partId: null, mutated: false },
      feet: { partId: 'twoFeet', mutated: false },
    },
    hueShift: 0,
    pattern: 'plain',
    sizePercent: 100,
    talents: { hp: 15, power: 15, guard: 15, agility: 15, resonance: 15 },
    natureId: 'calm',
    shiny: false,
    ...over,
  };
}

describe('野生基因', () => {
  it('同一种子得到同一基因', () => {
    expect(generateWildGenes(createRng(3), line('warmbud'))).toEqual(generateWildGenes(createRng(3), line('warmbud')));
  });

  it('取值都在设计范围内，零件来自本线零件池，足槽不为空', () => {
    const rng = createRng(77);
    for (let i = 0; i < 2000; i++) {
      const l = rng.pick([...content.lines.values()]);
      const g = generateWildGenes(rng, l);
      expect(g.hueShift).toBeGreaterThanOrEqual(-18);
      expect(g.hueShift).toBeLessThanOrEqual(18);
      expect(g.sizePercent).toBeGreaterThanOrEqual(85);
      expect(g.sizePercent).toBeLessThanOrEqual(115);
      for (const s of STATS) expect(g.talents[s]).toBeLessThanOrEqual(31);
      expect(NATURES.some((n) => n.id === g.natureId)).toBe(true);
      expect(g.parts.feet.partId).not.toBeNull();
      for (const [slot, gene] of Object.entries(g.parts)) {
        expect(l.partPool[slot as keyof typeof l.partPool].some((e) => e.part === gene.partId)).toBe(true);
      }
      if (g.secondaryElement) expect(g.secondaryElement).not.toBe(l.element);
    }
  });

  it('性别比例接近 0.5', () => {
    const rng = createRng(9);
    let males = 0;
    for (let i = 0; i < 4000; i++) if (generateWildGenes(rng, line('warmbud')).sex === 'male') males++;
    expect(males / 4000).toBeGreaterThan(0.46);
    expect(males / 4000).toBeLessThan(0.54);
  });
});

describe('数值公式（DESIGN 4.3）', () => {
  const base = content.forms.get('warmbud')!.form.baseStats;

  it('60 级、资质 15、中性性格：手算一致', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 60 });
    expect(computeStats(content, s)).toEqual({
      hp: base.hp * 2 + 15 + 60 + 10,
      power: base.power * 2 + 15 + 5,
      guard: base.guard * 2 + 15 + 5,
      agility: base.agility * 2 + 15 + 5,
      resonance: base.resonance * 2 + 15 + 5,
    });
  });

  it('1 级：生命 = floor((基础×2+资质)/60) + 11', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 1 });
    expect(computeStats(content, s).hp).toBe(Math.floor((base.hp * 2 + 15) / 60) + 1 + 10);
  });

  it('性格 ±10%，不影响生命', () => {
    const neutral = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 60 });
    const reckless = createSpirit(content, { id: 'b', ownerId: 'p', genes: fixedGenes({ natureId: 'reckless' }), level: 60 });
    const a = computeStats(content, neutral);
    const b = computeStats(content, reckless);
    expect(b.hp).toBe(a.hp);
    expect(b.power).toBe(Math.floor((base.power * 2 + 15) * 1.1) + 5);
    expect(b.guard).toBe(Math.floor((base.guard * 2 + 15) * 0.9) + 5);
    expect(b.agility).toBe(a.agility);
  });
});

describe('经验与升级', () => {
  it('累计经验曲线 4L³/5', () => {
    expect(expForLevel(1)).toBe(0);
    expect(expForLevel(10)).toBe(800);
    expect(expForLevel(60)).toBe(172800);
  });

  it('一次给足经验可以连升多级，60 级封顶', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 5 });
    expect(addExp(s, expForLevel(12) - s.exp).level).toBe(12);
    expect(addExp(s, 10 ** 9).level).toBe(60);
    expect(addExp(s, 10 ** 9).exp).toBe(expForLevel(60));
  });
});

describe('技能池与零件', () => {
  it('幼絮还没长出 minStage = lord 的独角', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 5 });
    expect(expressedParts(content, s).horns).toBeNull();
    expect(skillPool(content, s)).toEqual(['dawnlight', 'softEarRest', 'hop']);
    expect(s.skillSlots).toEqual(['dawnlight', 'softEarRest', 'hop']);
  });

  it('被动技能在技能池里但不占装备栏', () => {
    const genes = fixedGenes({ lineId: 'hazepuff', parts: { ...fixedGenes().parts, horns: { partId: null, mutated: false }, ears: { partId: 'roundEars', mutated: false }, feet: { partId: 'cloudFeet', mutated: false } } });
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes, level: 5 });
    expect(passiveSkills(content, s)).toEqual(['floating']);
    expect(s.skillSlots).not.toContain('floating');
    expect(equipSkills(content, s, ['floating'])).toBeTypeOf('string');
  });

  it('装备栏校验', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 5 });
    expect(equipSkills(content, s, ['hop', 'hop'])).toBeTypeOf('string');
    expect(equipSkills(content, s, ['boltStrike'])).toBeTypeOf('string');
    expect((equipSkills(content, s, ["hop"]) as Spirit).skillSlots).toEqual(['hop']);
  });
});

describe('进化', () => {
  const day = { weather: 'sun' as const, isNight: false };

  it('等级不够不能进化；够了手动进化，保留基因', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 15 });
    expect(evolutionBlocker(content, s, day)).toBe('需要 16 级');
    const s16 = addExp(s, expForLevel(16) - s.exp);
    const e = evolve(content, s16, day);
    expect(typeof e).toBe('object');
    expect((e as typeof s).formId).toBe('sheafglow');
    expect((e as typeof s).genes).toBe(s.genes);
  });

  it('云主形需要本属性天气；进化后长出独角并装上角冲', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 40, formIndex: 1 });
    expect(evolutionBlocker(content, s, { weather: 'rain', isNight: false })).toBe('需要在晴天进化');
    const e = evolve(content, s, day) as typeof s;
    expect(e.formId).toBe('dawncrown');
    expect(e.skillSlots).toContain('hornRush');
  });

  it('最终形态不能再进化', () => {
    const s = createSpirit(content, { id: 'a', ownerId: 'p', genes: fixedGenes(), level: 60, formIndex: 2 });
    expect(evolutionBlocker(content, s, day)).toBe('已是最终形态');
  });
});
