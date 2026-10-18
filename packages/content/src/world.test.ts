import { REGIONS } from './species';
import { describe, expect, it } from 'vitest';
import { BLUEPRINT_SHOP, coreUpgradeCost } from './data/economy';
import { GATHER_YIELD } from './islands';
import { affinityLevel } from './keepers';
import { getContent } from './validate';

const db = getContent();

describe('M1 世界内容', () => {
  it('五大区：每区 5 座固定岛 + 1 座灯塔岛（云主）；云主等级随章节递增；晴原有阿禾、岚的守岛人岛（M3-2）', () => {
    for (const region of REGIONS) {
      const isl = [...db.islands.values()].filter((i) => i.region === region);
      expect(isl.filter((i) => i.kind === 'fixed'), region).toHaveLength(5);
      expect(isl.filter((i) => i.kind === 'lighthouse'), region).toHaveLength(1);
    }
    const lords = REGIONS.map((r) => [...db.cloudlords.values()].find((c) => c.region === r)!);
    for (let i = 1; i < lords.length; i++) expect(lords[i]!.boss.level).toBeGreaterThan(lords[i - 1]!.boss.level);
    for (const k of ['aHe', 'lan']) expect([...db.islands.values()].some((i) => i.keeper === k)).toBe(true);
    // 每区的野生等级在上一区之后
    const minLv = REGIONS.map((r) => Math.min(...[...db.islands.values()].filter((i) => i.region === r && i.kind === 'fixed').map((i) => i.wildLevel.min)));
    for (let i = 1; i < minLv.length; i++) expect(minLv[i]!).toBeGreaterThan(minLv[i - 1]!);
  });

  it('雾线只能在雾浓度 ≥ 2 的岛上出现，而 M1 确实有这样的岛', () => {
    const mist = db.lines.get('hazepuff')!;
    const minFog = Math.min(...mist.spawns.map((s) => s.minFogLevel ?? 0));
    expect([...db.islands.values()].some((i) => i.kind === 'fixed' && i.fogLevel >= minFog)).toBe(true);
  });

  it('每个配方的原料都能拿到（采集、种植、购买或另一个配方）', () => {
    const obtainable = new Set<string>([
      ...Object.values(GATHER_YIELD).map((g) => g.item),
      ...[...db.crops.values()].map((c) => c.item),
      ...[...db.items.values()].filter((i) => i.buyPrice).map((i) => i.id),
    ]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of db.recipes.values()) {
        if (!obtainable.has(r.output.item) && r.inputs.every((i) => obtainable.has(i.item))) {
          obtainable.add(r.output.item);
          changed = true;
        }
      }
    }
    for (const r of db.recipes.values()) for (const i of r.inputs) expect(obtainable.has(i.item), `${r.id} 需要 ${i.item}`).toBe(true);
    for (const b of db.buildings.values()) for (const c of b.cost.items) expect(obtainable.has(c.item), `${b.id} 需要 ${c.item}`).toBe(true);
    for (const c of coreUpgradeCost(1).items) expect(obtainable.has(c.item)).toBe(true);
  });

  it('开局蓝图包含栖巢、田地与工坊；其余可以从商队或守岛人拿到', () => {
    const starter = [...db.buildings.values()].filter((b) => b.starterBlueprint).map((b) => b.id);
    expect(starter).toEqual(expect.arrayContaining(['nest', 'field', 'workshop']));
    const buildable = [...db.buildings.values()].filter((b) => b.kind !== 'core' && b.kind !== 'dock');
    const fromKeepers = [...db.keepers.values()].flatMap((k) => k.story.map((n) => n.reward?.blueprint)).filter(Boolean);
    for (const b of buildable) {
      if (b.starterBlueprint) continue;
      expect(BLUEPRINT_SHOP.some((x) => x.blueprint === b.id) || fromKeepers.includes(b.id), b.id).toBe(true);
    }
  });

  it('好感阈值 0 / 50 / 120 / 220 / 360 / 540', () => {
    expect([0, 49, 50, 119, 120, 220, 359, 360, 540, 9999].map(affinityLevel)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 5]);
  });

  it('岛核升级成本 500 × 1.6^(n−1)', () => {
    expect(coreUpgradeCost(1).shells).toBe(500);
    expect(coreUpgradeCost(3).shells).toBe(1280);
  });
});

describe('分享码的编号空间（M3-5）', () => {
  it('建筑 < 64、作物 < 16、技能 < 128（岛屿码 / 队伍码的位宽）', () => {
    const db = getContent();
    expect(db.buildings.size).toBeLessThan(64);
    expect(db.crops.size).toBeLessThan(16);
    expect(db.skills.size).toBeLessThan(128);
  });
});
