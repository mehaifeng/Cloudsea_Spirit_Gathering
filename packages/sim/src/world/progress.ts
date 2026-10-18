import { REGIONS, type ContentDb, type Island, type Region } from '@cloudsea/content';
import type { WorldState } from './state';

/**
 * 主线进度（DESIGN 2 / 3.3，M3-2）：五个大区按 晴原 → 风谷 → 雨泽 → 雷崖 → 雾海 的顺序开放；
 * 上一个大区的灯塔重燃后才能去下一个；灯塔重燃后该区雾散（全部岛的雾浓度按 0 算）。
 */

/** 某个大区的云主（每区一位）。 */
export function regionCloudlord(content: ContentDb, region: Region): string | undefined {
  for (const c of content.cloudlords.values()) if (c.region === region) return c.id;
  return undefined;
}

export function lighthouseLit(content: ContentDb, world: Readonly<WorldState>, region: Region): boolean {
  const id = regionCloudlord(content, region);
  return !!id && world.lighthousesLit.includes(id);
}

/** 大区是否开放：晴原一开始就开放；其余要上一个大区的灯塔重燃。 */
export function regionUnlocked(content: ContentDb, world: Readonly<WorldState>, region: Region): boolean {
  const i = REGIONS.indexOf(region);
  return i <= 0 || lighthouseLit(content, world, REGIONS[i - 1]!);
}

/** 生效的雾浓度：灯塔重燃后该区雾散。 */
export function effectiveFog(content: ContentDb, world: Readonly<WorldState>, island: Pick<Island, 'region' | 'fogLevel'>): number {
  return lighthouseLit(content, world, island.region) ? 0 : island.fogLevel;
}

/** 当前章节 = 已重燃的灯塔数 + 1（最多 5）；全部重燃后为 6（终章之后）。 */
export function chapterOf(world: Readonly<WorldState>): number {
  return world.lighthousesLit.length + 1;
}

/** 五座灯塔是否全部重燃（终章）。 */
export function allLit(content: ContentDb, world: Readonly<WorldState>): boolean {
  return content.cloudlords.size > 0 && [...content.cloudlords.keys()].every((id) => world.lighthousesLit.includes(id));
}
