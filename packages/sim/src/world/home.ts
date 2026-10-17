import { ECONOMY, ELEMENT_WORK, PART_SLOTS, type Building, type ContentDb, type WorkTask } from '@cloudsea/content';
import { elementsOf } from '../spirit/genes';
import { expressedParts } from '../spirit/spirit';
import type { Spirit } from '../spirit/types';
import type { WorldEvent } from './events';
import { addItems, payFrom } from './inventory';
import { homeTerrain } from './layout';
import type { BuildingInstance, CharacterState, HomeIsland, Rotation, WorldState } from './state';
import { weatherAt } from './weather';

/** 中枢群岛暂按晴原的天气（M1 只有晴原）。 */
export const HOME_REGION = 'sunPlains' as const;

/** 无絮灵时建筑按 0.3 倍速自建（DESIGN 7）。 */
export const SELF_BUILD_RATE = 0.3;

// ---------------------------------------------------------------- 容量

export function storageCapacity(content: ContentDb, home: HomeIsland): number {
  const extra = Object.values(home.buildings)
    .filter((b) => b.built && content.buildings.get(b.type)?.kind === 'storage')
    .reduce((a, b) => a + (content.buildings.get(b.type)!.capacity ?? 0), 0);
  return ECONOMY.storageBase + ECONOMY.storagePerCoreLevel * (home.coreLevel - 1) + extra;
}

export function buildingSlots(home: HomeIsland): number {
  return ECONOMY.buildingSlotsBase + ECONOMY.buildingSlotsPerCoreLevel * (home.coreLevel - 1);
}

export function buildingsUsed(content: ContentDb, home: HomeIsland): number {
  return Object.values(home.buildings).filter((b) => content.buildings.get(b.type)!.countsTowardLimit).length;
}

function builtOfKind(content: ContentDb, home: HomeIsland, kind: Building['kind']): BuildingInstance[] {
  return Object.values(home.buildings).filter((b) => b.built && content.buildings.get(b.type)!.kind === kind);
}

/** 絮灵容量 = 队伍 6 + 栖巢 × 4（DESIGN 4.8）。蛋不占位置。 */
export function spiritCapacity(content: ContentDb, home: HomeIsland): number {
  return ECONOMY.partyMax + builtOfKind(content, home, 'nest').reduce((a, b) => a + (content.buildings.get(b.type)!.capacity ?? 0), 0);
}

export function spiritCount(c: CharacterState): number {
  return Object.values(c.spirits).filter((s) => s.state !== 'egg').length;
}

export function hasRoomForSpirit(content: ContentDb, world: WorldState, c: CharacterState): boolean {
  const home = world.homes[c.id];
  return !!home && spiritCount(c) < spiritCapacity(content, home);
}

// ---------------------------------------------------------------- 工作效率

/**
 * 工作效率（DESIGN 4.6）= 属性匹配（1.0 / 0.6）× 零件加成（1.0–1.3）× 等级项（0.5 + 等级/120）× 疲惫（0.5）。
 */
export function workEfficiency(content: ContentDb, spirit: Spirit, task: WorkTask | null): number {
  let match = 1;
  let partBonus = 1;
  if (task) {
    match = elementsOf(content, spirit.genes).some((el) => ELEMENT_WORK[el].includes(task)) ? 1 : 0.6;
    const parts = expressedParts(content, spirit);
    for (const slot of PART_SLOTS) {
      const id = parts[slot];
      const wb = id ? content.parts.get(id)!.workBonus : undefined;
      if (wb && wb.task === task) partBonus = Math.max(partBonus, wb.multiplier);
    }
  }
  const levelTerm = 0.5 + spirit.level / 120;
  return match * partBonus * levelTerm;
}

/** 找到絮灵和它的主人（工位上的絮灵可能属于联机的其他玩家）。 */
export function findSpirit(world: WorldState, spiritId: string): { owner: CharacterState; spirit: Spirit } | null {
  for (const c of Object.values(world.characters)) {
    const s = c.spirits[spiritId];
    if (s) return { owner: c, spirit: s };
  }
  return null;
}

// ---------------------------------------------------------------- 摆放

export function footprint(def: Building, rot: Rotation): { w: number; d: number } {
  return rot % 2 === 0 ? { w: def.size.w, d: def.size.d } : { w: def.size.d, d: def.size.w };
}

export function cellsOf(def: Building, b: Pick<BuildingInstance, 'x' | 'z' | 'rot'>): Array<[number, number]> {
  const { w, d } = footprint(def, b.rot);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([b.x + i, b.z + j]);
  return out;
}

/** 地基高度 = 占地四角的最高点（DESIGN 7 地基规则）。 */
export function foundationHeight(content: ContentDb, home: HomeIsland, b: Pick<BuildingInstance, 'type' | 'x' | 'z' | 'rot'>): number {
  const def = content.buildings.get(b.type)!;
  const { w, d } = footprint(def, b.rot);
  const t = homeTerrain(home.seed, home.coreLevel);
  return Math.max(t.height(b.x, b.z), t.height(b.x + w, b.z), t.height(b.x, b.z + d), t.height(b.x + w, b.z + d));
}

/** 能否在这里建造；可以返回 null，否则返回原因。 */
export function placementBlocker(
  content: ContentDb,
  home: HomeIsland,
  c: CharacterState,
  type: string,
  x: number,
  z: number,
  rot: Rotation,
  ignoreCost = false,
  bags: Array<Record<string, number>> = [],
): string | null {
  const def = content.buildings.get(type);
  if (!def || def.kind === 'core' || def.kind === 'dock') return '不能建造这个';
  if (!c.blueprints.includes(type)) return '还没有这个建筑的蓝图';
  if (home.coreLevel < def.coreLevel) return `需要岛核 ${def.coreLevel} 级`;
  if (def.countsTowardLimit && buildingsUsed(content, home) >= buildingSlots(home)) return '建筑位已满，升级岛核可以增加';
  if (def.maxCount && Object.values(home.buildings).filter((b) => b.type === type).length >= def.maxCount) return `${def.name} 最多建 ${def.maxCount} 座`;
  if (!Number.isInteger(x) || !Number.isInteger(z)) return '位置必须对齐网格';
  const terrain = homeTerrain(home.seed, home.coreLevel);
  const cells = cellsOf(def, { x, z, rot });
  for (const [cx, cz] of cells) if (!terrain.inside(cx + 0.5, cz + 0.5, 0.6)) return '超出岛的范围';
  for (const [cx, cz] of cells) if (terrain.isWater(cx + 0.5, cz + 0.5) || terrain.waterDistance(cx + 0.5, cz + 0.5) < 0.3) return '这里是水边，不能建造';
  const occupied = new Set<string>();
  for (const b of Object.values(home.buildings)) for (const [cx, cz] of cellsOf(content.buildings.get(b.type)!, b)) occupied.add(`${cx},${cz}`);
  if (cells.some(([cx, cz]) => occupied.has(`${cx},${cz}`))) return '和其他建筑重叠了';
  const { w, d } = footprint(def, rot);
  const hs = [terrain.height(x, z), terrain.height(x + w, z), terrain.height(x, z + d), terrain.height(x + w, z + d)];
  if (Math.max(...hs) - Math.min(...hs) > 1) return '太陡';
  if (!ignoreCost) {
    if (c.shells < def.cost.shells) return `云贝不够（需要 ${def.cost.shells}）`;
    const have = (item: string) => bags.reduce((a, bag) => a + (bag[item] ?? 0), 0);
    const lack = def.cost.items.find((s) => have(s.item) < s.count);
    if (lack) return `${content.items.get(lack.item)?.name ?? lack.item} 不够（需要 ${lack.count}）`;
  }
  return null;
}

/**
 * 存档迁移用：把重叠、出界或落进水里的建筑挪到附近的空位（按螺旋向外找）。
 * 岛核与码头不动。返回被挪动的建筑 id。
 */
export function relocateBuildings(content: ContentDb, home: HomeIsland): string[] {
  const terrain = homeTerrain(home.seed, home.coreLevel);
  const occupied = new Set<string>();
  const moved: string[] = [];
  const fits = (b: Pick<BuildingInstance, 'type' | 'x' | 'z' | 'rot'>): boolean =>
    cellsOf(content.buildings.get(b.type)!, b).every(
      ([cx, cz]) => !occupied.has(`${cx},${cz}`) && terrain.inside(cx + 0.5, cz + 0.5, 0.6) && !terrain.isWater(cx + 0.5, cz + 0.5),
    );
  const claim = (b: Pick<BuildingInstance, 'type' | 'x' | 'z' | 'rot'>) => {
    for (const [cx, cz] of cellsOf(content.buildings.get(b.type)!, b)) occupied.add(`${cx},${cz}`);
  };
  const list = Object.values(home.buildings).sort((a, b) => {
    const fixed = (x: BuildingInstance) => (['core', 'dock'].includes(content.buildings.get(x.type)!.kind) ? 0 : 1);
    return fixed(a) - fixed(b);
  });
  for (const b of list) {
    const kind = content.buildings.get(b.type)!.kind;
    if (kind === 'core' || kind === 'dock' || fits(b)) {
      claim(b);
      continue;
    }
    let placed = false;
    for (let r = 1; r < 40 && !placed; r++) {
      for (let dx = -r; dx <= r && !placed; dx++) {
        for (let dz = -r; dz <= r && !placed; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cand = { ...b, x: b.x + dx, z: b.z + dz };
          if (fits(cand)) {
            home.buildings[b.id] = { ...b, x: cand.x, z: cand.z };
            claim(cand);
            moved.push(b.id);
            placed = true;
          }
        }
      }
    }
    if (!placed) claim(b);
  }
  return moved;
}

export function newBuilding(id: string, type: string, x: number, z: number, rot: Rotation): BuildingInstance {
  return { id, type, x, z, rot, built: false, buildProgress: 0, workers: [], crop: null, job: null, eggId: null, occupants: [] };
}

// ---------------------------------------------------------------- 每 tick 推进

function workersOf(world: WorldState, b: BuildingInstance): Spirit[] {
  return b.workers.map((id) => findSpirit(world, id)?.spirit).filter((s): s is Spirit => !!s);
}

/** 推进一座家园岛 dt 个 tick 的生产（DESIGN 6.2：玩家不在岛上时照常推进）。 */
export function tickHome(content: ContentDb, world: WorldState, home: HomeIsland, dt: number, events: WorldEvent[]): void {
  const owner = world.characters[home.ownerId];
  const cap = storageCapacity(content, home);
  const weather = weatherAt(world.seed, HOME_REGION, world.tick);

  for (const b of Object.values(home.buildings)) {
    const def = content.buildings.get(b.type)!;
    const workers = workersOf(world, b);

    if (!b.built) {
      const rate = workers.length > 0 ? workers.reduce((a, s) => a + workEfficiency(content, s, null), 0) : SELF_BUILD_RATE;
      b.buildProgress += rate * dt;
      if (b.buildProgress >= def.buildWork) {
        b.built = true;
        // 建好后多出来的建筑工人回到空闲；留下的就是这座建筑的工人
        if (b.workers.length > def.workSlots) {
          const extra = b.workers.slice(def.workSlots);
          b.workers = b.workers.slice(0, def.workSlots);
          releaseWorkers(world, { ...b, workers: extra });
        }
        events.push({ t: 'built', ownerId: home.ownerId, buildingId: b.id });
      }
      continue;
    }

    switch (def.kind) {
      case 'field': {
        if (!b.crop) {
          // 有照料者时自动补种（从仓库取种子）
          if (workers.length > 0) replant(content, home, b);
          break;
        }
        const crop = content.crops.get(b.crop.cropId)!;
        if (b.crop.progress >= crop.growTicks) {
          if (workers.length > 0) harvestField(content, world, home, b, events);
          break;
        }
        const care = workers.reduce((a, s) => a + Math.max(workEfficiency(content, s, 'planting'), workEfficiency(content, s, 'irrigation')), 0);
        b.crop.progress += dt * (1 + care) * (weather === crop.favoredWeather ? 1.5 : 1);
        if (b.crop.progress >= crop.growTicks) {
          b.crop.progress = crop.growTicks;
          events.push({ t: 'cropReady', ownerId: home.ownerId, buildingId: b.id });
        }
        break;
      }
      case 'workshop': {
        if (!b.job || workers.length === 0) break;
        const recipe = content.recipes.get(b.job.recipeId)!;
        if (!b.job.inputsPaid) {
          const bags = owner ? [home.storage, owner.backpack] : [home.storage];
          if (!payFrom(bags, recipe.inputs)) break;
          b.job.inputsPaid = true;
        }
        b.job.progress += dt * workers.reduce((a, s) => a + workEfficiency(content, s, recipe.task), 0);
        if (b.job.progress >= recipe.work) {
          const put = addItems(home.storage, recipe.output.item, recipe.output.count, cap);
          if (put < recipe.output.count) {
            b.job.progress = recipe.work; // 仓库满了，等腾出位置
            break;
          }
          events.push({ t: 'crafted', ownerId: home.ownerId, item: recipe.output.item, count: recipe.output.count });
          b.job.remaining--;
          b.job.progress = 0;
          b.job.inputsPaid = false;
          if (b.job.remaining <= 0) b.job = null;
        }
        break;
      }
      default:
        break;
    }
  }
}

export function releaseWorkers(world: WorldState, b: BuildingInstance): void {
  for (const id of b.workers) {
    const f = findSpirit(world, id);
    if (f && f.spirit.state === 'working') f.owner.spirits[id] = { ...f.spirit, state: 'idle' };
  }
  b.workers = [];
}

function replant(content: ContentDb, home: HomeIsland, b: BuildingInstance): void {
  for (const crop of content.crops.values()) {
    const seed = [...content.items.values()].find((i) => i.grows === crop.id);
    if (seed && (home.storage[seed.id] ?? 0) > 0 && b.crop === null) {
      payFrom([home.storage], [{ item: seed.id, count: 1 }]);
      b.crop = { cropId: crop.id, progress: 0, seedItem: seed.id };
    }
  }
}

export function harvestField(content: ContentDb, world: WorldState, home: HomeIsland, b: BuildingInstance, events: WorldEvent[]): number {
  if (!b.crop) return 0;
  const crop = content.crops.get(b.crop.cropId)!;
  if (b.crop.progress < crop.growTicks) return 0;
  const put = addItems(home.storage, crop.item, crop.yield, storageCapacity(content, home));
  const owner = world.characters[home.ownerId];
  const rest = crop.yield - put;
  const toBackpack = owner && rest > 0 ? addItems(owner.backpack, crop.item, rest, ECONOMY.backpackSlots) : 0;
  if (put + toBackpack === 0) return 0;
  events.push({ t: 'harvest', ownerId: home.ownerId, item: crop.item, count: put + toBackpack });
  b.crop = null;
  return put + toBackpack;
}
