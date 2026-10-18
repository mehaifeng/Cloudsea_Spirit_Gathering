import { describe, expect, it } from 'vitest';
import { LINES } from './data/lines';
import { PARTS } from './data/parts';
import { SKILLS } from './data/skills';
import { COUNTERS, ELEMENTS, GENERATES, type Element } from './elements';
import { REGIONS } from './species';
import { STATS } from './stats';
import { buildContent, ContentError, getContent, type RawContent } from './validate';

const RAW: RawContent = { skills: SKILLS, parts: PARTS, lines: LINES };

/** 深拷贝原始数据后修改，用来验证校验能抓到错误。 */
function mutated(edit: (raw: { skills: any[]; parts: any[]; lines: any[] }) => void): RawContent {
  const copy = structuredClone({ skills: [...SKILLS], parts: [...PARTS], lines: [...LINES] }) as any;
  edit(copy);
  return copy;
}

function issuesOf(raw: RawContent): string[] {
  try {
    buildContent(raw);
    return [];
  } catch (e) {
    if (e instanceof ContentError) return [...e.issues];
    throw e;
  }
}

describe('属性关系', () => {
  it('相克与相生各自构成覆盖五属性的单环', () => {
    for (const rel of [COUNTERS, GENERATES]) {
      expect(new Set(Object.values(rel)).size).toBe(5);
      let el: Element = ELEMENTS[0];
      const seen = new Set<string>();
      for (let i = 0; i < 5; i++) {
        seen.add(el);
        el = rel[el];
      }
      expect(el).toBe(ELEMENTS[0]);
      expect(seen.size).toBe(5);
    }
  });

  it('与 DESIGN 4.1 一致', () => {
    expect(COUNTERS).toEqual({ sun: 'mist', mist: 'thunder', thunder: 'rain', rain: 'wind', wind: 'sun' });
    expect(GENERATES).toEqual({ rain: 'sun', sun: 'thunder', thunder: 'wind', wind: 'mist', mist: 'rain' });
  });
});

describe('内置内容', () => {
  const db = getContent();

  it('通过校验', () => {
    expect(issuesOf(RAW)).toEqual([]);
  });

  it('M3：14 条线、40 个形态，五属性都有；每个大区至少 3 条线可遇到（DESIGN v0.9）', () => {
    expect(db.lines.size).toBe(14);
    expect(db.forms.size).toBe(40);
    expect(new Set([...db.lines.values()].map((l) => l.element))).toEqual(new Set(ELEMENTS));
    expect([...db.lines.values()].filter((l) => l.forms.length === 2)).toHaveLength(2);
    for (const region of REGIONS) {
      const n = [...db.lines.values()].filter((l) => l.spawns.some((s) => s.region === region)).length;
      expect(n, region).toBeGreaterThanOrEqual(3);
    }
    // 图鉴编号 1–40 连续
    expect([...db.forms.values()].map((f) => f.form.no).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('M1 晴原的刷新条件仍符合 DESIGN 4.2：晴常见；风雨看天气；雷在夜晚或雷天；雾要雾浓度 ≥ 2', () => {
    const inSun = (id: string) => db.lines.get(id)!.spawns.filter((s) => s.region === 'sunPlains');
    expect(db.lines.get('warmbud')!.rarity).toBe('common');
    expect(inSun('eavedrop').every((s) => s.weathers?.includes('rain'))).toBe(true);
    expect(inSun('kitefluff').every((s) => s.weathers?.includes('wind'))).toBe(true);
    const thunder = inSun('forgespark');
    expect(thunder.some((s) => s.time === 'night')).toBe(true);
    expect(thunder.some((s) => s.weathers?.includes('thunder'))).toBe(true);
    expect(inSun('hazepuff').every((s) => (s.minFogLevel ?? 0) >= 2)).toBe(true);
  });

  it('种族值总和：三段线 250 / 350 / 450；两段线 250 / 390（苔蝾成体 375：30 级就进化，按 battle-sim 下调；M3-6 战斗 AI 修正后 365 → 375）', () => {
    for (const line of db.lines.values()) {
      const expected = line.forms.length === 3 ? [250, 350, 450] : [250, 390];
      line.forms.forEach((form, i) => expect(STATS.reduce((sum, s) => sum + form.baseStats[s], 0), form.id).toBe(line.id === 'mossnewt' && i === 1 ? 375 : expected[i]));
    }
  });

  it('性别比例默认 0.5', () => {
    for (const line of db.lines.values()) expect(line.sexRatio).toBe(0.5);
  });

  it('15 个零件（编号 1–15，絮灵码零件位上限）都有零件技能，基础动作 0 费', () => {
    expect(db.parts.size).toBe(15);
    expect(Math.max(...[...db.parts.values()].map((p) => p.no))).toBe(15);
    expect([...db.skills.values()].filter((s) => s.source === 'part')).toHaveLength(15);
    for (const id of ['jab', 'guard']) expect(db.skills.get(id)!.qiCost).toBe(0);
  });

  it('足槽零件覆盖 0 / 2 / 4 / 6 足', () => {
    const legs = [...db.parts.values()].filter((p) => p.slot === 'feet').map((p) => p.legs);
    expect(legs.sort()).toEqual([0, 2, 4, 6]);
  });
});

describe('校验能抓到错误', () => {
  it('攻击技能没有威力', () => {
    const raw = mutated((r) => (r.skills.find((s) => s.id === 'jab').power = 0));
    expect(issuesOf(raw).join()).toContain('攻击技能威力必须大于 0');
  });

  it('零件引用不存在的技能', () => {
    const raw = mutated((r) => (r.parts.find((p) => p.id === 'singleHorn').skill = 'nope'));
    expect(issuesOf(raw).join()).toContain('技能 nope 不存在');
  });

  it('零件放错槽位', () => {
    const raw = mutated((r) => r.lines[0].partPool.ears.push({ part: 'singleHorn', weight: 1 }));
    expect(issuesOf(raw).join()).toContain('不能放进 ears 槽');
  });

  it('足槽为“无”', () => {
    const raw = mutated((r) => r.lines[0].partPool.feet.push({ part: null, weight: 1 }));
    expect(issuesOf(raw).join()).toContain('足槽不能为“无”');
  });

  it('进化段顺序错误', () => {
    const raw = mutated((r) => r.lines[0].forms.reverse());
    expect(issuesOf(raw).length).toBeGreaterThan(0);
  });

  it('形态 id 重复', () => {
    const raw = mutated((r) => (r.lines[1].forms[0].id = 'warmbud'));
    expect(issuesOf(raw).join()).toContain('form warmbud: id 重复');
  });

  it('异化威力倍率用在非攻击技能上', () => {
    const raw = mutated((r) => (r.parts.find((p) => p.id === 'floppyEars').mutation = { powerMultiplier: 1.2, description: 'x' }));
    expect(issuesOf(raw).join()).toContain('异化威力倍率只能用于攻击技能');
  });

  it('被动效果出现在主动技能里', () => {
    const raw = mutated((r) => r.skills.find((s) => s.id === 'hop').effects.push({ kind: 'ailmentImmunity', ailment: 'soaked' }));
    expect(issuesOf(raw).join()).toContain('被动效果只能出现在被动技能里');
  });

  it('零件技能没有零件携带', () => {
    const raw = mutated((r) => (r.parts = r.parts.filter((p) => p.id !== 'sixFeet')));
    expect(issuesOf(raw).join()).toContain('skill swiftStride: 零件技能没有零件携带');
  });
});
