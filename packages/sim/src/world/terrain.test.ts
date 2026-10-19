import { getContent, HOME_CHART_POS } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { arrivalPoint, gatherNodes, HOME_DOCK, homeTerrain, islandTerrain, randomSpot, WATER_CLEARANCE, worldPosition } from './layout';
import { createTerrain, WATER_LEVEL } from './terrain';

const content = getContent();

describe('地形与水面（v0.5）', () => {
  it('池塘中心是水、远处不是；水底低于水面', () => {
    const t = createTerrain({ seed: 1, radius: 30, amplitude: 0.5, ponds: [{ x: 5, z: 5, radius: 3, depth: 0.7 }] });
    expect(t.isWater(5, 5)).toBe(true);
    expect(t.height(5, 5)).toBeLessThan(WATER_LEVEL);
    expect(t.isWater(-10, -10)).toBe(false);
    expect(t.waterDistance(5, 9)).toBeCloseTo(1, 0);
  });

  it('岸线就是水面的边（v0.10）：岸外没有低于水面的坑，水里的地面都在水面下', () => {
    const terrains = [homeTerrain(1, 1), homeTerrain(42, 3), ...[...content.islands.values()].map((i) => islandTerrain(i))];
    for (const t of terrains) {
      const R = t.params.radius;
      for (let x = -R; x <= R; x += 0.37) {
        for (let z = -R; z <= R; z += 0.37) {
          if (!t.inside(x, z, 1)) continue;
          const d = t.waterDistance(x, z);
          if (d > 0 && d < 1) expect(t.height(x, z), `${t.params.seed} (${x}, ${z})`).toBeGreaterThanOrEqual(WATER_LEVEL);
          if (d === 0 && t.isWater(x, z)) expect(t.height(x, z)).toBeLessThan(WATER_LEVEL);
        }
      }
    }
  });

  it('水边离码头 / 登岛点、迫降点、云气团都至少 10 米（v0.10）', () => {
    // 迫降点与云气团的位置见 apps/desktop 的 ExploreView.WRECK / ORB
    const homeSpots = [HOME_DOCK, { x: 3.5, z: 11 }, { x: 2.5, z: 4.5 }];
    for (let seed = 1; seed <= 60; seed++) {
      const t = homeTerrain(seed * 7919, 1);
      for (const p of homeSpots) expect(t.waterDistance(p.x, p.z), `seed ${seed}`).toBeGreaterThanOrEqual(WATER_CLEARANCE);
    }
    for (const isl of content.islands.values()) {
      const a = arrivalPoint(isl);
      expect(islandTerrain(isl).waterDistance(a.x, a.z), isl.id).toBeGreaterThanOrEqual(WATER_CLEARANCE);
    }
  });

  it('溪流沿折线是水', () => {
    const t = createTerrain({ seed: 2, radius: 30, amplitude: 0.5, streams: [{ points: [{ x: -20, z: 0 }, { x: 20, z: 0 }], width: 3, depth: 0.6 }] });
    expect(t.isWater(0, 0)).toBe(true);
    expect(t.isWater(0, 6)).toBe(false);
  });

  it('家园岛 24 米起、60 米封顶，中心平地不是水', () => {
    const t1 = homeTerrain(123, 1);
    const t10 = homeTerrain(123, 10);
    expect(t1.params.radius).toBe(24);
    expect(t10.params.radius).toBe(60);
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) expect(t1.isWater(x, z)).toBe(false);
    expect(t1.params.ponds?.length).toBe(1);
  });

  it('每座岛按主题有不同地形；采集点和野生出生点都不在水里', () => {
    for (const isl of content.islands.values()) {
      const t = islandTerrain(isl);
      for (const n of gatherNodes(isl)) expect(t.isWater(n.x, n.z), `${isl.id} ${n.id}`).toBe(false);
      for (let i = 0; i < 30; i++) {
        const s = randomSpot(isl, i);
        expect(t.isWater(s.x, s.z)).toBe(false);
      }
    }
    expect(islandTerrain(content.islands.get('brookIsle')!).params.streams?.length).toBe(1);
    expect(islandTerrain(content.islands.get('mistHollow')!).params.hills?.length).toBe(5);
  });

  it('世界布局：家园岛在原点，其他岛按星图坐标 × 1000 米', () => {
    expect(worldPosition(null, HOME_CHART_POS)).toEqual({ x: 0, y: 0, z: 0 });
    const w = content.islands.get('wheatSlope')!;
    const p = worldPosition(w, HOME_CHART_POS);
    expect(p.x).toBeCloseTo((w.chartPos.x - HOME_CHART_POS.x) * 1000);
    expect(p.z).toBeCloseTo((w.chartPos.y - HOME_CHART_POS.y) * 1000);
  });
});
