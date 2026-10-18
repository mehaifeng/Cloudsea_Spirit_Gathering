import { getContent, PART_SLOTS } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { makeSpirit } from '../testing';
import { breed, breedBlocker, BREEDING, resonant } from './breeding';
import { decodeTeamCode, encodeTeamCode } from './teamCode';
import type { Spirit } from './types';

const content = getContent();
const DAY = 12000;

function parent(line: string, sex: 'male' | 'female', id: string): Spirit {
  const s = makeSpirit(content, line, 20, { id });
  return { ...s, genes: { ...s.genes, sex, secondaryElement: null } };
}

describe('共鸣繁殖（M3-5，DESIGN 4.5）', () => {
  it('主属性相生的不同物种可以繁殖（雨生晴、晴生雷……任一方向）；不相生的不行', () => {
    const rainF = parent('eavedrop', 'female', 'a');
    const sunM = parent('warmbud', 'male', 'b');
    const windM = parent('kitefluff', 'male', 'c');
    expect(resonant(content, rainF, sunM)).toBe(true);
    expect(breedBlocker(content, rainF, sunM, 0)).toBeNull();
    expect(breedBlocker(content, sunM, rainF, 0)).toBeNull();
    expect(breedBlocker(content, rainF, windM, 0)).toMatch(/不相生/);
  });

  it('物种随母方；父方的零件母方长不出来时那一槽按母方；突变约 8%、双属性约 3%', () => {
    const mother = parent('eavedrop', 'female', 'm');
    const father = parent('warmbud', 'male', 'f');
    const N = 6000;
    let mutated = 0;
    let slots = 0;
    let dual = 0;
    const pool = content.lines.get('eavedrop')!.partPool;
    for (let i = 0; i < N; i++) {
      const r = breed(content, createRng(1000 + i), father, mother, { now: 0, ticksPerDay: DAY, eggId: `e${i}`, hatchTicks: DAY });
      if (typeof r === 'string') throw new Error(r);
      expect(r.egg.genes.lineId).toBe('eavedrop');
      for (const slot of PART_SLOTS) {
        const id = r.egg.genes.parts[slot].partId;
        expect(pool[slot].some((e) => e.part === id), `${slot} ${id}`).toBe(true);
        const fromParent = id === mother.genes.parts[slot].partId || id === father.genes.parts[slot].partId;
        // 突变成父母都没有的零件（池里只有一种零件的槽无法突变，不计）
        if (pool[slot].length > 1) {
          slots++;
          if (!fromParent) mutated++;
        }
      }
      if (r.egg.genes.secondaryElement) dual++;
    }
    // 突变到“别的零件”里有可能正好撞上另一位亲本的零件，所以观察值略低于 8%
    expect(mutated / slots).toBeGreaterThan(BREEDING.partMutationChanceGenerating * 0.5);
    expect(mutated / slots).toBeLessThan(BREEDING.partMutationChanceGenerating * 1.25);
    expect(dual / N).toBeGreaterThan(0.02);
    expect(dual / N).toBeLessThan(0.04);
  });
});

describe('队伍码（M3-5，DESIGN 10）', () => {
  function team(): Spirit[] {
    return ['warmbud', 'eavedrop', 'kitefluff', 'forgespark', 'hazepuff', 'mossnewt'].map((line, i) => makeSpirit(content, line, 10 + i * 9, { id: `t${i}`, talents: (i * 7) % 32, formIndex: i >= 4 ? 1 : 0 }));
  }

  it('往返：基因、形态、等级、装备的技能都还原；多行文本块，抄写时的空白和大小写不影响', () => {
    const t = team();
    t[0] = { ...t[0]!, learnedSkills: ['waterBolt'], skillSlots: [...t[0]!.skillSlots.slice(0, 3), 'waterBolt'] };
    const code = encodeTeamCode(content, t);
    expect(code.startsWith('XT-')).toBe(true);
    expect(code).toContain('\n');
    const back = decodeTeamCode(content, `  ${code.toLowerCase().replace(/\n/g, ' \n ')}  `);
    if (typeof back === 'string') throw new Error(back);
    expect(back).toHaveLength(6);
    back.forEach((m, i) => {
      expect(m.genes).toEqual(t[i]!.genes);
      expect(m.formId).toBe(t[i]!.formId);
      expect(m.level).toBe(t[i]!.level);
      expect(m.skills).toEqual(t[i]!.skillSlots);
    });
  });

  it('校验位：改一个字符就拒绝；截断、学不会的技能也拒绝', () => {
    const code = encodeTeamCode(content, team().slice(0, 2));
    const body = code.slice(3);
    const i = body.search(/[0-9A-Z]/);
    const flipped = `XT-${body.slice(0, i + 5)}${body[i + 5] === 'A' ? 'B' : 'A'}${body.slice(i + 6)}`;
    expect(decodeTeamCode(content, flipped)).toMatch(/校验|不存在|无效|不对|学不会|不能/);
    expect(decodeTeamCode(content, code.slice(0, 30))).toMatch(/不完整|长度|校验|不对/);
    const s = team()[0]!;
    const cheat = encodeTeamCode(content, [{ ...s, skillSlots: ['tideSmite'] }]);
    expect(decodeTeamCode(content, cheat)).toMatch(/学不会/);
  });
});
