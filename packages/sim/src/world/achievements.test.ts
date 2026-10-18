import { getContent, steamName } from '@cloudsea/content';
import { describe, expect, it } from 'vitest';
import { makeSpirit } from '../testing';
import { achievementMet, checkAchievements } from './achievements';
import { createCharacter, createWorld, joinWorld } from './create';
import type { WorldEvent } from './events';
import { applyIntent } from './intents';
import { loadCharacter, saveCharacter } from './save';
import type { WorldState } from './state';

const content = getContent();

function world(): WorldState {
  const w = createWorld(content, { seed: 2, hostId: 'p1' });
  joinWorld(w, createCharacter(content, { id: 'p1', name: '测试' }));
  return w;
}

const unlocked = (events: readonly WorldEvent[]) => events.filter((e) => e.t === 'achievement').map((e) => (e as Extract<WorldEvent, { t: 'achievement' }>).achievementId);

describe('成就（M4-1）', () => {
  it('约 20 个，id 唯一，Steam API 名合法', () => {
    const all = [...content.achievements.values()];
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(new Set(all.map((a) => steamName(a.id))).size).toBe(all.length);
    for (const a of all) expect(steamName(a.id)).toMatch(/^ACH_[A-Z0-9_]+$/);
    expect(steamName('firstCatch')).toBe('ACH_FIRST_CATCH');
    expect(steamName('codex40')).toBe('ACH_CODEX_40');
  });

  it('领到第一只伙伴就解锁“第一位伙伴”，只发一次事件', () => {
    const w = world();
    const r = applyIntent(content, w, 'p1', { type: 'adoptStarter' });
    expect(unlocked(r.events)).toEqual(['firstFriend']);
    expect(w.characters['p1']!.achievements).toEqual(['firstFriend']);
    const again: WorldEvent[] = [];
    checkAchievements(content, w, again);
    expect(again).toEqual([]);
  });

  it('各类条件：统计、图鉴、进化段、等级、幻色、灯塔、守卫、工具、岛核、好感、剧情', () => {
    const w = world();
    const c = w.characters['p1']!;
    const met = (id: string) => achievementMet(content, w, c, content.achievements.get(id)!.condition);
    expect(met('win100')).toBe(false);
    c.stats.battlesWon = 100;
    expect(met('win100')).toBe(true);
    c.codex.caught = [...content.forms.keys()];
    expect(met('codex40')).toBe(true);
    const lord = makeSpirit(content, 'warmbud', 60, { id: 'p1-s9', owner: 'p1', formIndex: 2 });
    c.spirits[lord.id] = lord;
    expect(met('lordForm')).toBe(true);
    expect(met('grownUp')).toBe(true);
    expect(met('level60')).toBe(true);
    c.spirits[lord.id] = { ...lord, foreign: true };
    expect(met('level60')).toBe(false); // 导入的外来絮灵不算
    expect(met('shiny')).toBe(false);
    c.spirits['p1-s8'] = { ...makeSpirit(content, 'eavedrop', 5, { id: 'p1-s8', owner: 'p1' }), genes: { ...lord.genes, lineId: 'eavedrop', shiny: true } };
    expect(met('shiny')).toBe(true);
    w.lighthousesLit.push('sunPlainsLord', 'windValleyLord', 'rainMarshLord');
    expect(met('halfway')).toBe(true);
    expect(met('rekindled')).toBe(false);
    w.guardiansBeaten.push('sunPlainsLord');
    expect(met('guardianNod')).toBe(true);
    c.tools = { ...c.tools, lantern: 5, skiff: 4 };
    expect(met('farSail')).toBe(false);
    c.tools.skiff = 5;
    expect(met('farSail')).toBe(true);
    w.homes['p1']!.coreLevel = 5;
    expect(met('growingIsland')).toBe(true);
    w.keepers['aHe']!.affinity['p1'] = 360;
    expect(met('kindred')).toBe(true);
    w.keepers['aHe']!.storyDone['p1'] = ['aHe1', 'aHe2', 'aHe3'];
    expect(met('storyteller')).toBe(false);
  });

  it('角色存档 v3 → v4：补上成就与新统计；已经满足的成就由房主读档后补发', () => {
    const w = world();
    applyIntent(content, w, 'p1', { type: 'adoptStarter' });
    const saved = JSON.parse(JSON.stringify(saveCharacter(w.characters['p1']!)));
    saved.version = 3;
    delete saved.character.achievements;
    saved.character.stats = { battlesWon: 3, caught: 1, bred: 0 };
    const c = loadCharacter(saved);
    expect(c.achievements).toEqual([]);
    expect(c.stats).toMatchObject({ battlesWon: 3, caught: 1, resonanceBred: 0, purified: 0, coopWins: 0, teamCodeWins: 0 });
    const w2 = world();
    joinWorld(w2, c);
    const ev: WorldEvent[] = [];
    checkAchievements(content, w2, ev);
    expect(unlocked(ev).sort()).toEqual(['firstCatch', 'firstFriend']);
  });
});
