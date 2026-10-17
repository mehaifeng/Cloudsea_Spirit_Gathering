import { ECONOMY, type ContentDb } from '@cloudsea/content';
import { createRng, deriveSeed } from '../rng';
import { generateWildGenes } from '../spirit/genes';
import { createSpirit } from '../spirit/spirit';
import type { Appearance, BuildingInstance, CharacterState, HomeIsland, KeeperState, WorldState } from './state';
import { HOME_DOCK } from './layout';

export const DEFAULT_APPEARANCE: Appearance = {
  skinTone: '#F2C9A0',
  hairColor: '#4A3426',
  clothColor: '#D4664A',
  scarfColor: '#F0B143',
};

export function createCharacter(content: ContentDb, o: { id: string; name: string; appearance?: Appearance }): CharacterState {
  return {
    version: 2,
    id: o.id,
    name: o.name,
    appearance: o.appearance ?? DEFAULT_APPEARANCE,
    shells: ECONOMY.startShells,
    backpack: { lanternDew: 8, sunWheatSeed: 6 },
    tools: { lantern: 1, skiff: 1, gatherTool: 1 },
    seenCutscenes: [],
    spirits: {},
    party: [],
    codex: { seen: [], caught: [] },
    memoryShards: [],
    blueprints: [...content.buildings.values()].filter((b) => b.starterBlueprint).map((b) => b.id),
    nextSpiritSeq: 1,
    tutorial: { step: 0, done: false },
    stats: { battlesWon: 0, caught: 0, bred: 0 },
  };
}

function fixedBuilding(id: string, type: string, x: number, z: number): BuildingInstance {
  return { id, type, x, z, rot: 0, built: true, buildProgress: 0, workers: [], crop: null, job: null, eggId: null, occupants: [] };
}

export function createHome(ownerId: string, seed: number): HomeIsland {
  return {
    ownerId,
    seed,
    coreLevel: 1,
    buildings: {
      [`core:${ownerId}`]: fixedBuilding(`core:${ownerId}`, 'islandCore', -1, -1),
      [`dock:${ownerId}`]: fixedBuilding(`dock:${ownerId}`, 'dock', HOME_DOCK.x - 2, HOME_DOCK.z - 1),
    },
    storage: {},
  };
}

function createKeeper(content: ContentDb, keeperId: string, seed: number): KeeperState {
  const k = content.keepers.get(keeperId)!;
  const rng = createRng(deriveSeed(seed, `keeper:${keeperId}`));
  const spirits = k.coreSpirits.map((c, i) =>
    createSpirit(content, {
      id: `${keeperId}-s${i}`,
      ownerId: keeperId,
      genes: generateWildGenes(rng, content.lines.get(c.line)!),
      level: c.level,
      formIndex: c.formIndex,
      state: 'party',
    }),
  );
  return {
    id: keeperId,
    affinity: {},
    lastGiftDay: {},
    lastTalkDay: {},
    lastBattleDay: {},
    storyDone: {},
    islandLevel: 1,
    stock: {},
    spirits,
    goal: 'farm',
    goalDay: 0,
    visiting: null,
    memory: [],
  };
}

export function createWorld(content: ContentDb, o: { seed: number; hostId: string }): WorldState {
  return {
    version: 1,
    seed: o.seed >>> 0,
    tick: 0,
    paused: false,
    nextId: 1,
    hostId: o.hostId,
    characters: {},
    players: {},
    homes: {},
    islands: {},
    keepers: Object.fromEntries([...content.keepers.keys()].map((id) => [id, createKeeper(content, id, o.seed)])),
    orders: [],
    lastDailyDay: 0,
    battles: {},
    chapter: 1,
  };
}

export function homeIslandId(playerId: string): string {
  return `home:${playerId}`;
}

/** 玩家（含房主）进入世界：没有家园岛就认领一座，出现在自己的码头。 */
export function joinWorld(world: WorldState, character: CharacterState): void {
  world.characters[character.id] = character;
  if (!world.homes[character.id]) world.homes[character.id] = createHome(character.id, deriveSeed(world.seed, `home:${character.id}`));
  if (!world.players[character.id]) {
    world.players[character.id] = { islandId: homeIslandId(character.id), x: HOME_DOCK.x, z: HOME_DOCK.z - 2.5, yaw: Math.PI, battleId: null };
  }
}

/** 玩家离开：角色从世界里拿走（其絮灵在世界里的工位显示“主人不在”）。 */
export function leaveWorld(world: WorldState, playerId: string): CharacterState | undefined {
  const c = world.characters[playerId];
  delete world.characters[playerId];
  return c;
}
