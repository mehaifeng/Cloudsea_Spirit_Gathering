import { getContent, REGIONS } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { createCharacter, createWorld, joinWorld } from './create';
import { applyIntent } from './intents';
import { drawKeepers, islandPresent, KEEPERS_PER_WORLD, reconcileKeepers } from './keeperDraw';
import { loadWorld, saveWorld } from './save';
import { advanceWorld } from './tick';
import { TICKS_PER_DAY } from './time';

const content = getContent();

describe('守岛人人设池（M3-3）', () => {
  it('人设池 24 位，每区 4–6 位；每位恰好 3 个剧情节点', () => {
    const all = [...content.keepers.values()];
    expect(all).toHaveLength(24);
    for (const r of REGIONS) {
      const n = all.filter((k) => k.region === r).length;
      expect(n, r).toBeGreaterThanOrEqual(4);
      expect(n, r).toBeLessThanOrEqual(6);
    }
    for (const k of all) expect(k.story, k.id).toHaveLength(3);
  });

  it('按种子抽：同一种子结果相同；6–10 位；阿禾、岚总在晴原原来的岛上；每区至少一位；住户都是本区的人、不重复', () => {
    expect(drawKeepers(content, 42)).toEqual(drawKeepers(content, 42));
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const m = drawKeepers(content, seed);
      const ids = Object.values(m);
      sizes.add(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(KEEPERS_PER_WORLD.min);
      expect(ids.length).toBeLessThanOrEqual(KEEPERS_PER_WORLD.max);
      expect(new Set(ids).size).toBe(ids.length);
      expect(m['heFarm']).toBe('aHe');
      expect(m['bellTerrace']).toBe('lan');
      for (const [isl, k] of Object.entries(m)) expect(content.keepers.get(k)!.region).toBe(content.islands.get(isl)!.region);
      for (const r of REGIONS) expect(ids.some((k) => content.keepers.get(k)!.region === r), `${seed} ${r}`).toBe(true);
    }
    // 不同种子确实会抽出不同人数
    expect(sizes.size).toBeGreaterThan(2);
    expect(JSON.stringify(drawKeepers(content, 1))).not.toBe(JSON.stringify(drawKeepers(content, 2)));
  });

  it('新世界只住抽到的人；没抽到的空位岛不存在、去不了', () => {
    const w = createWorld(content, { seed: 7, hostId: 'p1' });
    joinWorld(w, createCharacter(content, { id: 'p1', name: '测试' }));
    expect(Object.keys(w.keepers).sort()).toEqual(Object.values(w.keeperIslands).sort());
    const empty = [...content.islands.values()].find((i) => i.kind === 'keeper' && !islandPresent(w, i) && i.region === 'sunPlains');
    if (empty) expect(applyIntent(content, w, 'p1', { type: 'sail', islandId: empty.id }).error).toBe('没有这座岛');
  });

  it('还在浓雾里的大区，守岛人不会来串门', () => {
    const w = createWorld(content, { seed: 3, hostId: 'p1' });
    const c = createCharacter(content, { id: 'p1', name: '测试' });
    c.tutorial = { step: 6, done: true };
    joinWorld(w, c);
    const visitors = new Set<string>();
    for (let d = 0; d < 40; d++) {
      advanceWorld(content, w, TICKS_PER_DAY);
      for (const k of Object.values(w.keepers)) if (k.visiting) visitors.add(k.id);
    }
    expect(visitors.size).toBeGreaterThan(0);
    for (const id of visitors) expect(content.keepers.get(id)!.region).toBe('sunPlains');
  });

  it('世界存档 v5 → v6：阿禾、岚的好感与剧情进度保留，读档后按种子补齐其他大区的守岛人', () => {
    const w = createWorld(content, { seed: 11, hostId: 'p1' });
    joinWorld(w, createCharacter(content, { id: 'p1', name: '测试' }));
    w.keepers['aHe']!.affinity['p1'] = 130;
    w.keepers['lan']!.storyDone['p1'] = ['lan1'];
    const saved = JSON.parse(JSON.stringify(saveWorld(w).world));
    // 做成 M2 时的样子：只有阿禾和岚，没有分配表
    saved.version = 5;
    delete saved.world.keeperIslands;
    saved.world.keepers = { aHe: saved.world.keepers.aHe, lan: saved.world.keepers.lan };
    const loaded = loadWorld(saved);
    expect(loaded.keeperIslands).toEqual({});
    reconcileKeepers(content, loaded);
    expect(loaded.keeperIslands).toEqual(drawKeepers(content, 11));
    expect(loaded.keepers['aHe']!.affinity['p1']).toBe(130);
    expect(loaded.keepers['lan']!.storyDone['p1']).toEqual(['lan1']);
    expect(Object.keys(loaded.keepers).length).toBeGreaterThanOrEqual(6);
    // 再调一次不变（幂等）
    const before = JSON.stringify(loaded);
    reconcileKeepers(content, loaded);
    expect(JSON.stringify(loaded)).toBe(before);
  });
});
