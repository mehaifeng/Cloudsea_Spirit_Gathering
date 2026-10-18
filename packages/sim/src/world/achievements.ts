import { affinityLevel, type AchievementCondition, type ContentDb } from '@cloudsea/content';
import type { WorldEvent } from './events';
import { keeperAffinity } from './keeper';
import type { CharacterState, WorldState } from './state';

/** 成就条件是否达成（M4-1）。只读世界和角色，不改状态。 */
export function achievementMet(content: ContentDb, world: Readonly<WorldState>, c: Readonly<CharacterState>, cond: AchievementCondition): boolean {
  const own = () => Object.values(c.spirits).filter((s) => s.state !== 'egg');
  switch (cond.kind) {
    case 'stat':
      return (c.stats[cond.stat] ?? 0) >= cond.atLeast;
    case 'codex':
      return c.codex.caught.length >= cond.atLeast;
    case 'spirits':
      return own().length >= cond.atLeast;
    case 'stage': {
      // 云主形也算“长大了”
      const ok = cond.stage === 'adult' ? ['adult', 'lord'] : ['lord'];
      return own().some((s) => !s.blighted && !s.foreign && ok.includes(content.forms.get(s.formId)?.form.stage ?? ''));
    }
    case 'shiny':
      return own().some((s) => s.genes.shiny && !s.foreign);
    case 'level':
      return own().some((s) => s.level >= cond.atLeast && !s.foreign);
    case 'lighthouses':
      return world.lighthousesLit.length >= cond.atLeast;
    case 'guardians':
      return world.guardiansBeaten.length >= cond.atLeast;
    case 'coreLevel':
      return (world.homes[c.id]?.coreLevel ?? 0) >= cond.atLeast;
    case 'tools':
      return c.tools.lantern >= cond.atLeast && c.tools.skiff >= cond.atLeast;
    case 'keeperAffinity':
      return Object.values(world.keepers).some((k) => affinityLevel(keeperAffinity(k, c.id)) >= cond.atLeast);
    case 'storyNodes':
      return Object.values(world.keepers).reduce((n, k) => n + (k.storyDone[c.id]?.length ?? 0), 0) >= cond.atLeast;
  }
}

/** 检查在线玩家的成就，新达成的记进角色并发事件（房主执行，客户端据此同步 Steam）。 */
export function checkAchievements(content: ContentDb, world: WorldState, events: WorldEvent[]): void {
  for (const c of Object.values(world.characters)) {
    for (const a of content.achievements.values()) {
      if (c.achievements.includes(a.id) || !achievementMet(content, world, c, a.condition)) continue;
      c.achievements.push(a.id);
      events.push({ t: 'achievement', playerId: c.id, achievementId: a.id });
    }
  }
}
