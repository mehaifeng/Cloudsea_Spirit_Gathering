import {
  BLUEPRINT_SHOP,
  coreUpgradeCost,
  ECONOMY,
  GATHER_YIELD,
  TOOL_NAME,
  toolUpgradeCost,
  type ContentDb,
  type ToolKind,
} from '@cloudsea/content';
import type { SideActions } from '../battle/types';
import { createRng, deriveSeed } from '../rng';
import { breed } from '../spirit/breeding';
import { decodeSpiritCode } from '../spirit/code';
import { generateWildGenes } from '../spirit/genes';
import { createSpirit, equipSkills, evolve, formOf, MAX_SKILL_SLOTS } from '../spirit/spirit';
import { forfeitBattle, startKeeperBattle, startTutorialBattle, startWildBattle, submitBattleActions } from './battleflow';
import { homeIslandId } from './create';
import type { WorldEvent } from './events';
import {
  harvestField,
  hasRoomForSpirit,
  HOME_REGION,
  newBuilding,
  placementBlocker,
  releaseWorkers,
  spiritCapacity,
  spiritCount,
  storageCapacity,
} from './home';
import { newId } from './ids';
import { addItems, canPay, payFrom, removeItems } from './inventory';
import { AFFINITY, changeAffinity, giftKeeper, talkToKeeper } from './keeper';
import { arrivalPoint, gatherNodes, HOME_DOCK } from './layout';
import type { CharacterState, PlayerRuntime, Rotation, WorldState } from './state';
import { clockAt, dayOf, TICKS_PER_DAY, TICKS_PER_SECOND } from './time';
import { sailBlocked, VOYAGE_HURRY_REMAIN, voyageTicks } from './voyage';
import { weatherAt } from './weather';
import { refreshWild } from './wild';

/** 客户端发给房主的意图（铁律 4）。房主校验后执行，不合法就拒绝。 */
export type Intent =
  | { readonly type: 'move'; readonly x: number; readonly z: number; readonly yaw: number }
  /** 出航（v0.5：开始一段实时航行，抵达由房主按 tick 结算）。 */
  | { readonly type: 'sail'; readonly islandId: string }
  /** 航行中加速：剩余时间缩到约 2 秒。 */
  | { readonly type: 'hurryVoyage' }
  | { readonly type: 'gather'; readonly nodeId: string }
  | { readonly type: 'encounter'; readonly wildId: string }
  | { readonly type: 'battleActions'; readonly battleId: string; readonly actions: SideActions }
  /** 认输（守岛人对战等不能逃跑的战斗），按战败结算。 */
  | { readonly type: 'forfeit'; readonly battleId: string }
  | { readonly type: 'tutorialBattle' }
  | { readonly type: 'adoptStarter' }
  | { readonly type: 'build'; readonly building: string; readonly x: number; readonly z: number; readonly rot: Rotation }
  | { readonly type: 'demolish'; readonly buildingId: string }
  | { readonly type: 'assignWorker'; readonly buildingId: string; readonly spiritId: string }
  | { readonly type: 'unassignWorker'; readonly buildingId: string; readonly spiritId: string }
  | { readonly type: 'plant'; readonly buildingId: string; readonly seedItem: string }
  | { readonly type: 'harvest'; readonly buildingId: string }
  | { readonly type: 'craft'; readonly buildingId: string; readonly recipeId: string; readonly count: number }
  | { readonly type: 'cancelCraft'; readonly buildingId: string }
  | { readonly type: 'breed'; readonly buildingId: string; readonly a: string; readonly b: string }
  | { readonly type: 'purify'; readonly buildingId: string; readonly spiritId: string }
  | { readonly type: 'feed'; readonly spiritId: string; readonly item: string }
  | { readonly type: 'learnBook'; readonly spiritId: string; readonly item: string }
  | { readonly type: 'equipSkills'; readonly spiritId: string; readonly skills: readonly string[] }
  | { readonly type: 'evolve'; readonly spiritId: string }
  | { readonly type: 'setParty'; readonly spiritIds: readonly string[] }
  | { readonly type: 'release'; readonly spiritId: string }
  | { readonly type: 'rename'; readonly spiritId: string; readonly name: string }
  | { readonly type: 'fulfillOrder'; readonly orderId: string }
  | { readonly type: 'buy'; readonly item: string; readonly count: number }
  | { readonly type: 'buyBlueprint'; readonly building: string }
  | { readonly type: 'sell'; readonly item: string; readonly count: number }
  | { readonly type: 'moveItems'; readonly item: string; readonly count: number; readonly to: 'storage' | 'backpack' }
  | { readonly type: 'upgradeCore' }
  | { readonly type: 'upgradeTool'; readonly tool: ToolKind }
  | { readonly type: 'talk'; readonly keeperId: string }
  | { readonly type: 'gift'; readonly keeperId: string; readonly item: string }
  | { readonly type: 'challenge'; readonly keeperId: string }
  | { readonly type: 'importSpirit'; readonly code: string }
  | { readonly type: 'pause'; readonly paused: boolean }
  | { readonly type: 'tutorial'; readonly step: number; readonly done?: boolean }
  /** 记下看过的一次性播片。 */
  | { readonly type: 'seenCutscene'; readonly id: string };

export interface IntentResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly events: WorldEvent[];
}

const STARTER_SUFFIX = '-s1';

export function isStarter(c: CharacterState, spiritId: string): boolean {
  return spiritId === `${c.id}${STARTER_SUFFIX}`;
}

function atHome(world: WorldState, playerId: string): boolean {
  return world.players[playerId]?.islandId === homeIslandId(playerId);
}

/** 守岛人能否交流：在他的岛上，或他正在拜访你的家园。 */
function nearKeeper(content: ContentDb, world: WorldState, p: PlayerRuntime, playerId: string, keeperId: string): boolean {
  const island = content.islands.get(p.islandId);
  if (island?.keeper === keeperId) return true;
  return world.keepers[keeperId]?.visiting?.playerId === playerId && p.islandId === homeIslandId(playerId);
}

function homeBags(world: WorldState, c: CharacterState) {
  return [world.homes[c.id]!.storage, c.backpack];
}

/** 执行一条意图。返回 error 时世界不变（校验在修改之前完成）。 */
export function applyIntent(content: ContentDb, world: WorldState, playerId: string, intent: Intent): IntentResult {
  const events: WorldEvent[] = [];
  const c = world.characters[playerId];
  const p = world.players[playerId];
  if (!c || !p) return { ok: false, error: '玩家不在这个世界里', events };
  const fail = (error: string): IntentResult => ({ ok: false, error, events: [] });
  const ok = (): IntentResult => ({ ok: true, events });
  const home = world.homes[playerId]!;
  const inBattle = p.battleId !== null;
  // 航行中只能做与航行无关的少数几件事
  if (p.voyage && !['pause', 'tutorial', 'seenCutscene', 'hurryVoyage'].includes(intent.type)) return fail('正在航行中');
  const spirit = (id: string) => c.spirits[id];

  switch (intent.type) {
    case 'pause':
      if (playerId !== world.hostId) return fail('只有房主可以暂停');
      world.paused = intent.paused;
      return ok();

    case 'move': {
      if (inBattle) return fail('战斗中不能移动');
      if (![intent.x, intent.z, intent.yaw].every(Number.isFinite)) return fail('位置无效');
      p.x = intent.x;
      p.z = intent.z;
      p.yaw = intent.yaw;
      return ok();
    }

    case 'sail': {
      const blocked = sailBlocked(content, p, c, playerId, intent.islandId);
      if (blocked) return fail(blocked);
      const to = intent.islandId === 'home' ? homeIslandId(playerId) : intent.islandId;
      const island = content.islands.get(to);
      if (island && island.fogLevel > 0) removeItems(c.backpack, 'lanternFuel', island.fogLevel);
      const ticks = voyageTicks(content, p.islandId, to, c.tools.skiff);
      p.voyage = { from: p.islandId, to, departTick: world.tick, arriveTick: world.tick + ticks };
      events.push({ t: 'voyageStart', playerId, from: p.islandId, to, departTick: world.tick, arriveTick: world.tick + ticks });
      return ok();
    }

    case 'hurryVoyage': {
      if (!p.voyage) return fail('没有在航行');
      p.voyage.arriveTick = Math.min(p.voyage.arriveTick, world.tick + VOYAGE_HURRY_REMAIN * TICKS_PER_SECOND);
      return ok();
    }

    case 'gather': {
      const island = content.islands.get(p.islandId);
      if (!island) return fail('这里没有可以采集的东西');
      const node = gatherNodes(island).find((n) => n.id === intent.nodeId);
      const rt = world.islands[island.id];
      if (!node || !rt) return fail('没有这个采集点');
      if (Math.hypot(node.x - p.x, node.z - p.z) > 3) return fail('再靠近一点');
      if ((rt.nodes[node.id] ?? 0) > world.tick) return fail('还没长好');
      const y = GATHER_YIELD[node.kind];
      const rng = createRng(deriveSeed(world.seed, `gather:${node.id}:${world.tick}`));
      const count = rng.int(y.min, y.max) + (c.tools.gatherTool - 1);
      const put = addItems(c.backpack, y.item, count, ECONOMY.backpackSlots);
      if (put === 0) return fail('背包满了');
      rt.nodes[node.id] = world.tick + y.respawnTicks;
      events.push({ t: 'items', playerId, item: y.item, count: put, where: 'backpack' });
      return ok();
    }

    case 'encounter': {
      const r = startWildBattle(content, world, playerId, intent.wildId, events);
      return world.battles[r] ? ok() : fail(r);
    }

    case 'tutorialBattle': {
      const r = startTutorialBattle(content, world, playerId, events);
      return world.battles[r] ? ok() : fail(r);
    }

    case 'battleActions': {
      const err = submitBattleActions(content, world, playerId, intent.battleId, intent.actions, events);
      return err ? fail(err) : ok();
    }

    case 'forfeit': {
      const b = world.battles[intent.battleId];
      if (!b || b.playerId !== playerId) return fail('没有这场战斗');
      if (b.kind === 'wild') return fail('野外战斗请用逃跑');
      if (b.kind === 'scripted') return fail('这一战不能认输');
      forfeitBattle(content, world, b.id, events);
      return ok();
    }

    case 'adoptStarter': {
      if (Object.keys(c.spirits).length > 0) return fail('已经有伙伴了');
      const rng = createRng(deriveSeed(world.seed, `starter:${playerId}`));
      const genes = generateWildGenes(rng, content.lines.get('warmbud')!);
      const id = `${c.id}${STARTER_SUFFIX}`;
      c.nextSpiritSeq = Math.max(c.nextSpiritSeq, 2);
      c.spirits[id] = createSpirit(content, { id, ownerId: c.id, genes: { ...genes, secondaryElement: null }, level: 5, state: 'party' });
      c.party = [id];
      const form = c.spirits[id]!.formId;
      c.codex.seen.push(form);
      c.codex.caught.push(form);
      c.memoryShards.push(form);
      return ok();
    }

    // ---------------------------------------------------------------- 建造
    case 'build': {
      if (!atHome(world, playerId)) return fail('只能在自己的家园岛上建造');
      const blocker = placementBlocker(content, home, c, intent.building, intent.x, intent.z, intent.rot, false, homeBags(world, c));
      if (blocker) return fail(blocker);
      const def = content.buildings.get(intent.building)!;
      c.shells -= def.cost.shells;
      payFrom(homeBags(world, c), def.cost.items);
      const b = newBuilding(newId(world, 'bd'), intent.building, intent.x, intent.z, intent.rot);
      if (def.buildWork === 0) b.built = true;
      home.buildings[b.id] = b;
      if (def.cost.shells) events.push({ t: 'shells', playerId, delta: -def.cost.shells });
      return ok();
    }

    case 'demolish': {
      if (!atHome(world, playerId)) return fail('只能在自己的家园岛上拆除');
      const b = home.buildings[intent.buildingId];
      if (!b) return fail('没有这座建筑');
      const def = content.buildings.get(b.type)!;
      if (def.kind === 'core' || def.kind === 'dock') return fail('这个不能拆');
      if (b.eggId || b.occupants.length > 0) return fail('里面还有絮灵');
      if (def.kind === 'nest' && b.built) {
        const capAfter = spiritCapacity(content, home) - (def.capacity ?? 0);
        if (spiritCount(c) > capAfter) return fail('拆掉后絮灵就没地方住了');
      }
      releaseWorkers(world, b);
      delete home.buildings[b.id];
      // 返还一半材料
      for (const st of def.cost.items) addItems(home.storage, st.item, Math.floor(st.count / 2), storageCapacity(content, home));
      return ok();
    }

    case 'assignWorker': {
      if (!atHome(world, playerId)) return fail('回到家园岛再安排工作');
      const b = home.buildings[intent.buildingId];
      const s = spirit(intent.spiritId);
      if (!b || !s) return fail('找不到建筑或絮灵');
      const def = content.buildings.get(b.type)!;
      const slots = b.built ? def.workSlots : 2;
      if (slots === 0) return fail('这座建筑不需要工人');
      if (b.workers.length >= slots) return fail('工位满了');
      if (s.state !== 'idle') return fail('只有在家空闲的絮灵可以工作（先从队伍里换下来）');
      if (s.blighted) return fail('蚀化的絮灵要先净化');
      for (const other of Object.values(home.buildings)) other.workers = other.workers.filter((w) => w !== s.id);
      b.workers.push(s.id);
      c.spirits[s.id] = { ...s, state: 'working' };
      return ok();
    }

    case 'unassignWorker': {
      const b = home.buildings[intent.buildingId];
      const s = spirit(intent.spiritId);
      if (!b || !s || !b.workers.includes(s.id)) return fail('它不在这里工作');
      b.workers = b.workers.filter((w) => w !== s.id);
      c.spirits[s.id] = { ...s, state: 'idle' };
      return ok();
    }

    case 'plant': {
      const b = home.buildings[intent.buildingId];
      if (!b || !b.built || content.buildings.get(b.type)!.kind !== 'field') return fail('这里不是田地');
      if (b.crop) return fail('田里已经种着东西');
      const seed = content.items.get(intent.seedItem);
      if (!seed?.grows) return fail('这不是种子');
      if (!payFrom(homeBags(world, c), [{ item: seed.id, count: 1 }])) return fail('没有种子');
      b.crop = { cropId: seed.grows, progress: 0, seedItem: seed.id };
      return ok();
    }

    case 'harvest': {
      const b = home.buildings[intent.buildingId];
      if (!b?.crop) return fail('还没有可以收的');
      const n = harvestField(content, world, home, b, events);
      return n > 0 ? ok() : fail('还没成熟，或者仓库满了');
    }

    case 'craft': {
      const b = home.buildings[intent.buildingId];
      const recipe = content.recipes.get(intent.recipeId);
      if (!b || !b.built || !recipe || recipe.building !== b.type) return fail('这里做不了这个');
      if (!Number.isInteger(intent.count) || intent.count < 1 || intent.count > 99) return fail('数量无效');
      if (b.job) return fail('工坊正在忙');
      b.job = { recipeId: recipe.id, remaining: intent.count, progress: 0, inputsPaid: false };
      return ok();
    }

    case 'cancelCraft': {
      const b = home.buildings[intent.buildingId];
      if (!b?.job) return fail('没有在做的东西');
      if (b.job.inputsPaid) {
        const recipe = content.recipes.get(b.job.recipeId)!;
        for (const st of recipe.inputs) addItems(home.storage, st.item, st.count, storageCapacity(content, home));
      }
      b.job = null;
      return ok();
    }

    // ---------------------------------------------------------------- 絮灵
    case 'breed': {
      const b = home.buildings[intent.buildingId];
      if (!b || !b.built || content.buildings.get(b.type)!.kind !== 'hatchery') return fail('需要繁殖屋');
      if (b.eggId) return fail('繁殖屋里已经有一枚蛋了');
      const sa = spirit(intent.a);
      const sb = spirit(intent.b);
      if (!sa || !sb) return fail('找不到絮灵');
      if (c.shells < ECONOMY.breedShells) return fail(`需要 ${ECONOMY.breedShells} 云贝`);
      const foods = [...content.items.values()].filter((i) => i.category === 'food');
      const bags = homeBags(world, c);
      const totalFood = foods.reduce((a, f) => a + bags.reduce((x, bag) => x + (bag[f.id] ?? 0), 0), 0);
      if (totalFood < ECONOMY.breedFood) return fail(`需要 ${ECONOMY.breedFood} 份絮灵食物`);
      const hasSpring = Object.values(home.buildings).some((x) => x.built && content.buildings.get(x.type)!.kind === 'hotSpring');
      const r = breed(content, createRng(deriveSeed(world.seed, `breed:${world.tick}:${sa.id}:${sb.id}`)), sa, sb, {
        now: world.tick,
        ticksPerDay: TICKS_PER_DAY,
        eggId: `${c.id}-s${c.nextSpiritSeq}`,
        // 繁殖占用 1 日产蛋 + 孵化 2 日（温泉 1 日）（DESIGN 4.5）
        hatchTicks: TICKS_PER_DAY * (1 + (hasSpring ? 1 : 2)),
      });
      if (typeof r === 'string') return fail(r);
      c.nextSpiritSeq++;
      c.shells -= ECONOMY.breedShells;
      let need: number = ECONOMY.breedFood;
      for (const f of foods) {
        for (const bag of bags) {
          const take = Math.min(need, bag[f.id] ?? 0);
          if (take > 0) removeItems(bag, f.id, take);
          need -= take;
        }
      }
      c.spirits[r.father.id] = r.father;
      c.spirits[r.mother.id] = r.mother;
      c.spirits[r.egg.id] = r.egg;
      b.eggId = r.egg.id;
      c.stats.bred++;
      events.push({ t: 'shells', playerId, delta: -ECONOMY.breedShells });
      return ok();
    }

    case 'purify': {
      const b = home.buildings[intent.buildingId];
      const s = spirit(intent.spiritId);
      if (!b || !b.built || content.buildings.get(b.type)!.kind !== 'purifyPool') return fail('需要净化池');
      if (!s?.blighted) return fail('它没有被蚀化');
      if (s.state === 'purifying') return fail('已经在净化了');
      if (b.occupants.length >= (content.buildings.get(b.type)!.capacity ?? 1)) return fail('净化池满了');
      c.party = c.party.filter((id) => id !== s.id);
      b.occupants.push(s.id);
      c.spirits[s.id] = { ...s, state: 'purifying', readyAtTick: world.tick + 3 * TICKS_PER_DAY };
      return ok();
    }

    case 'feed': {
      const s = spirit(intent.spiritId);
      const item = content.items.get(intent.item);
      if (!s || !item?.food) return fail('它不吃这个');
      if (!payFrom(atHome(world, playerId) ? homeBags(world, c) : [c.backpack], [{ item: item.id, count: 1 }])) return fail('没有这个食物');
      if (item.food.curesWeary && s.weary) {
        c.spirits[s.id] = { ...s, weary: false, wearyRemaining: 0 };
        events.push({ t: 'recovered', playerId, spiritId: s.id });
      }
      return ok();
    }

    case 'learnBook': {
      const s = spirit(intent.spiritId);
      const item = content.items.get(intent.item);
      if (!s || !item?.teaches) return fail('这不是技能书');
      if (s.learnedSkills.includes(item.teaches)) return fail('已经学会了');
      if (!removeItems(c.backpack, item.id, 1)) return fail('背包里没有这本书');
      const slots = s.skillSlots.length < MAX_SKILL_SLOTS ? [...s.skillSlots, item.teaches] : s.skillSlots;
      c.spirits[s.id] = { ...s, learnedSkills: [...s.learnedSkills, item.teaches], skillSlots: slots };
      return ok();
    }

    case 'equipSkills': {
      const s = spirit(intent.spiritId);
      if (!s) return fail('找不到絮灵');
      if (!atHome(world, playerId)) return fail('回到家园岛的栖巢再换技能');
      const r = equipSkills(content, s, intent.skills);
      if (typeof r === 'string') return fail(r);
      c.spirits[s.id] = r;
      return ok();
    }

    case 'evolve': {
      const s = spirit(intent.spiritId);
      if (!s) return fail('找不到絮灵');
      if (s.foreign) return fail('外来絮灵不能进化');
      const island = content.islands.get(p.islandId);
      const weather = weatherAt(world.seed, island?.region ?? HOME_REGION, world.tick);
      const r = evolve(content, s, { weather, isNight: clockAt(world.tick).isNight });
      if (typeof r === 'string') return fail(r);
      c.spirits[s.id] = r;
      if (!c.codex.caught.includes(r.formId)) c.codex.caught.push(r.formId);
      if (!c.codex.seen.includes(r.formId)) c.codex.seen.push(r.formId);
      if (!c.memoryShards.includes(r.formId)) c.memoryShards.push(r.formId);
      events.push({ t: 'evolved', playerId, spiritId: s.id, formId: r.formId });
      return ok();
    }

    case 'setParty': {
      if (inBattle) return fail('战斗中不能调整队伍');
      const ids = [...new Set(intent.spiritIds)];
      if (ids.length > ECONOMY.partyMax) return fail('队伍最多 6 只');
      for (const id of ids) {
        const s = spirit(id);
        if (!s) return fail('找不到絮灵');
        if (s.state === 'egg' || s.state === 'purifying') return fail(`${formOf(content, s).form.name} 现在不能加入队伍`);
        if (s.blighted) return fail('蚀化的絮灵要先净化');
      }
      if (!atHome(world, playerId)) {
        // 野外只能调整顺序 / 留下，不能把家里的絮灵叫来
        if (ids.some((id) => !c.party.includes(id))) return fail('回家以后才能换上别的絮灵');
      }
      for (const id of c.party) if (!ids.includes(id)) c.spirits[id] = { ...c.spirits[id]!, state: 'idle' };
      for (const id of ids) {
        const s = c.spirits[id]!;
        if (s.state === 'working') for (const b of Object.values(home.buildings)) b.workers = b.workers.filter((w) => w !== id);
        c.spirits[id] = { ...c.spirits[id]!, state: 'party' };
      }
      c.party = ids;
      return ok();
    }

    case 'release': {
      const s = spirit(intent.spiritId);
      if (!s) return fail('找不到絮灵');
      if (isStarter(c, s.id)) return fail('第一只伙伴不能放归');
      if (s.state === 'egg' || s.state === 'purifying' || s.state === 'working') return fail('现在不能放归');
      delete c.spirits[s.id];
      c.party = c.party.filter((id) => id !== s.id);
      c.shells += 20;
      if (!c.memoryShards.includes(s.formId)) c.memoryShards.push(s.formId);
      events.push({ t: 'shells', playerId, delta: 20 });
      return ok();
    }

    case 'rename': {
      const s = spirit(intent.spiritId);
      const name = intent.name.trim().slice(0, 16);
      if (!s) return fail('找不到絮灵');
      c.spirits[s.id] = { ...s, nickname: name.length > 0 ? name : null };
      return ok();
    }

    // ---------------------------------------------------------------- 经济
    case 'fulfillOrder': {
      const o = world.orders.find((x) => x.id === intent.orderId);
      if (!o || o.fulfilledBy !== null || o.expiresDay < dayOf(world.tick)) return fail('这个订单已经没有了');
      if (o.source === 'caravan' && !atHome(world, playerId)) return fail('回到家园岛的码头交货');
      if (o.source !== 'caravan' && !atHome(world, playerId) && !nearKeeper(content, world, p, playerId, o.source)) return fail('去守岛人那里交货');
      const bags = atHome(world, playerId) ? homeBags(world, c) : [c.backpack];
      if (!payFrom(bags, [{ item: o.item, count: o.count }])) return fail(`${content.items.get(o.item)!.name} 不够`);
      o.fulfilledBy = playerId;
      c.shells += o.reward;
      events.push({ t: 'shells', playerId, delta: o.reward });
      if (o.source !== 'caravan') {
        const k = world.keepers[o.source];
        if (k) changeAffinity(world, k, playerId, AFFINITY.orderDone, events);
      }
      return ok();
    }

    case 'buy': {
      if (!atHome(world, playerId)) return fail('商队在家园岛的码头');
      const item = content.items.get(intent.item);
      if (!item?.buyPrice) return fail('商队不卖这个');
      if (!Number.isInteger(intent.count) || intent.count < 1 || intent.count > 99) return fail('数量无效');
      const cost = item.buyPrice * intent.count;
      if (c.shells < cost) return fail('云贝不够');
      const put = addItems(c.backpack, item.id, intent.count, ECONOMY.backpackSlots);
      if (put < intent.count) {
        removeItems(c.backpack, item.id, put);
        return fail('背包放不下');
      }
      c.shells -= cost;
      events.push({ t: 'shells', playerId, delta: -cost });
      return ok();
    }

    case 'buyBlueprint': {
      if (!atHome(world, playerId)) return fail('商队在家园岛的码头');
      const offer = BLUEPRINT_SHOP.find((x) => x.blueprint === intent.building);
      if (!offer) return fail('商队没有这张蓝图');
      if (c.blueprints.includes(offer.blueprint)) return fail('已经有这张蓝图了');
      if (c.shells < offer.price) return fail('云贝不够');
      c.shells -= offer.price;
      c.blueprints.push(offer.blueprint);
      events.push({ t: 'shells', playerId, delta: -offer.price }, { t: 'blueprint', playerId, building: offer.blueprint });
      return ok();
    }

    case 'sell': {
      if (!atHome(world, playerId)) return fail('商队在家园岛的码头');
      const item = content.items.get(intent.item);
      if (!item || item.sellPrice === 0) return fail('商队不收这个');
      if (!Number.isInteger(intent.count) || intent.count < 1) return fail('数量无效');
      if (!payFrom(homeBags(world, c), [{ item: item.id, count: intent.count }])) return fail('数量不够');
      const gain = item.sellPrice * intent.count;
      c.shells += gain;
      events.push({ t: 'shells', playerId, delta: gain });
      return ok();
    }

    case 'moveItems': {
      if (!atHome(world, playerId)) return fail('回到家园岛才能用仓库');
      const [from, to, cap] =
        intent.to === 'storage' ? [c.backpack, home.storage, storageCapacity(content, home)] : [home.storage, c.backpack, ECONOMY.backpackSlots];
      const n = Math.min(intent.count, from[intent.item] ?? 0);
      if (n <= 0) return fail('没有这个');
      const put = addItems(to, intent.item, n, cap);
      if (put === 0) return fail(intent.to === 'storage' ? '仓库满了' : '背包满了');
      removeItems(from, intent.item, put);
      return ok();
    }

    case 'upgradeCore': {
      if (!atHome(world, playerId)) return fail('回到家园岛升级岛核');
      if (home.coreLevel >= ECONOMY.maxCoreLevel) return fail('岛核已经是最高级');
      const cost = coreUpgradeCost(home.coreLevel);
      if (c.shells < cost.shells) return fail(`需要 ${cost.shells} 云贝`);
      if (!canPay(homeBags(world, c), cost.items)) return fail('材料不够');
      c.shells -= cost.shells;
      payFrom(homeBags(world, c), cost.items);
      home.coreLevel++;
      events.push({ t: 'shells', playerId, delta: -cost.shells }, { t: 'toast', playerId, text: `岛核升到了 ${home.coreLevel} 级，岛长大了！` });
      return ok();
    }

    case 'upgradeTool': {
      if (!atHome(world, playerId)) return fail('回到家园岛升级工具');
      const lv = c.tools[intent.tool];
      if (lv >= 5) return fail(`${TOOL_NAME[intent.tool]}已经是最高级`);
      const cost = toolUpgradeCost(intent.tool, lv);
      if (c.shells < cost.shells) return fail(`需要 ${cost.shells} 云贝`);
      if (!canPay(homeBags(world, c), cost.items)) return fail('材料不够');
      c.shells -= cost.shells;
      payFrom(homeBags(world, c), cost.items);
      c.tools[intent.tool] = lv + 1;
      events.push({ t: 'shells', playerId, delta: -cost.shells }, { t: 'toast', playerId, text: `${TOOL_NAME[intent.tool]}升到了 ${lv + 1} 级` });
      return ok();
    }

    // ---------------------------------------------------------------- 守岛人
    case 'talk':
      if (!nearKeeper(content, world, p, playerId, intent.keeperId)) return fail('不在旁边');
      talkToKeeper(content, world, intent.keeperId, playerId, events);
      return ok();

    case 'gift': {
      if (!nearKeeper(content, world, p, playerId, intent.keeperId)) return fail('不在旁边');
      const err = giftKeeper(content, world, intent.keeperId, playerId, intent.item, events);
      return err ? fail(err) : ok();
    }

    case 'challenge': {
      if (!nearKeeper(content, world, p, playerId, intent.keeperId)) return fail('不在旁边');
      const r = startKeeperBattle(content, world, playerId, intent.keeperId, events);
      return world.battles[r] ? ok() : fail(r);
    }

    case 'importSpirit': {
      const data = decodeSpiritCode(content, intent.code);
      if (typeof data === 'string') return fail(data);
      if (!hasRoomForSpirit(content, world, c)) return fail('絮灵已经住满了');
      const id = `${c.id}-s${c.nextSpiritSeq++}`;
      const line = content.lines.get(data.genes.lineId)!;
      const formIndex = line.forms.findIndex((f) => f.id === data.formId);
      c.spirits[id] = { ...createSpirit(content, { id, ownerId: c.id, genes: data.genes, level: data.level, formIndex, foreign: true }) };
      if (!c.codex.seen.includes(data.formId)) c.codex.seen.push(data.formId);
      return ok();
    }

    case 'seenCutscene':
      if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(intent.id)) return fail('无效的播片 id');
      if (!c.seenCutscenes.includes(intent.id)) c.seenCutscenes.push(intent.id);
      return ok();

    case 'tutorial':
      c.tutorial = { step: Math.max(c.tutorial.step, intent.step), done: c.tutorial.done || !!intent.done };
      return ok();
  }
}
