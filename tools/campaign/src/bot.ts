import { REGIONS, toolUpgradeCost, type ContentDb, type Island, type Region, type ToolKind } from '@cloudsea/content';
import {
  activeUnits,
  advanceWorld,
  applyIntent,
  arrivalPoint,
  chooseActions,
  CLOUDLORD_SPOT,
  createCharacter,
  createWorld,
  currentHp,
  dayOf,
  effectiveFog,
  gatherNodes,
  GUARDIAN_SPOT,
  homeIslandId,
  islandPresent,
  joinWorld,
  maxHpOf,
  regionUnlocked,
  spiritCapacity,
  spiritCount,
  type BattleAction,
  type CharacterState,
  type Intent,
  type Spirit,
  type WorldEvent,
  type WorldState,
} from '@cloudsea/sim';

/**
 * 自动通关机器人（M3-6）：从新游戏开始，只通过意图玩（和玩家、联机客人走同一条路），
 * 依次打赢五位灯塔守卫与云主，直到终章。用来验证主线能通、并给出大致的进度节奏。
 *
 * 策略刻意简单、像一个“认真但不精明”的玩家：
 * - 在已开放、去得了的岛里挑野生等级合适的岛练级，顺手采集；
 * - 抓等级够的絮灵补满 6 只队伍，多出来的在家打工（工坊加工、田里种风铃果）；
 * - 回家用核心塔养伤、交材料升级提灯和云舟、能进化就进化；
 * - 队伍够强就挑战守卫、讨伐云主；输了就再练练。
 */
const PLAYER = 'p1';
const HOME = homeIslandId(PLAYER);
const CORE = { x: 0, z: 3 };
/** 玩家操作花的游戏时间（tick）：让“第几天”接近真人节奏。 */
const COST = { turn: 60, gather: 40, move: 30, chores: 300 } as const;
/** 机器人这边的战斗 AI：只看启发式、不犯错（比真人稳，但不做搜索）。 */
const BOT_AI = { depth: 0, mistakeRate: 0 } as const;

export interface Milestone {
  readonly day: number;
  readonly what: string;
  readonly partyLevels: readonly number[];
}

export interface BotReport {
  readonly finished: boolean;
  readonly days: number;
  readonly milestones: readonly Milestone[];
  readonly battles: { won: number; lost: number };
  readonly reason?: string;
}

export class CampaignBot {
  readonly world: WorldState;
  readonly milestones: Milestone[] = [];
  private won = 0;
  private lost = 0;
  private finale = false;
  private losses = new Map<string, number>();
  private workshop: string | null = null;
  private fields: string[] = [];
  readonly log: string[] = [];

  constructor(
    private readonly content: ContentDb,
    seed: number,
    private readonly verbose = false,
  ) {
    this.world = createWorld(content, { seed, hostId: PLAYER });
    joinWorld(this.world, createCharacter(content, { id: PLAYER, name: '机器人' }));
  }

  private get c(): CharacterState {
    return this.world.characters[PLAYER]!;
  }

  private get p() {
    return this.world.players[PLAYER]!;
  }

  private get day(): number {
    return dayOf(this.world.tick);
  }

  private note(what: string): void {
    this.milestones.push({ day: this.day, what, partyLevels: this.party().map((s) => s.level) });
    if (this.verbose) console.log(`第 ${this.day} 天：${what}（队伍 ${this.party().map((s) => s.level).join('/')}）`);
  }

  private act(intent: Intent): boolean {
    const r = applyIntent(this.content, this.world, PLAYER, intent);
    this.watch(r.events);
    if (!r.ok && this.verbose) this.log.push(`${intent.type}: ${r.error}`);
    return r.ok;
  }

  private watch(events: readonly WorldEvent[]): void {
    for (const e of events) {
      if (e.t === 'finale') this.finale = true;
      if (e.t === 'battleEnd' && e.playerId === PLAYER) {
        if (e.result === 'win') this.won++;
        else this.lost++;
      }
    }
  }

  private advance(ticks: number): void {
    for (let t = 0; t < ticks; t += 10) this.watch(advanceWorld(this.content, this.world, 10));
  }

  private party(): Spirit[] {
    return this.c.party.map((id) => this.c.spirits[id]!).filter(Boolean);
  }

  private strength(): number {
    const lv = this.party()
      .map((s) => s.level)
      .sort((a, b) => b - a)
      .slice(0, 3);
    return lv.length ? lv.reduce((a, b) => a + b, 0) / lv.length : 0;
  }

  // ------------------------------------------------------------------ 移动与航行

  private moveTo(x: number, z: number): void {
    this.advance(COST.move);
    this.act({ type: 'move', x, z, yaw: 0 });
    // 野生絮灵可能主动扑上来
    if (this.p.battleId) this.fight(false);
  }

  private sail(islandId: string): boolean {
    const to = islandId === 'home' ? HOME : islandId;
    if (this.p.islandId === to) return true;
    if (!this.act({ type: 'sail', islandId })) return false;
    this.act({ type: 'hurryVoyage' });
    for (let i = 0; i < 2000 && this.p.voyage; i++) this.advance(10);
    return this.p.islandId === to;
  }

  // ------------------------------------------------------------------ 战斗

  private fight(capture: boolean): void {
    let dewThrown = 0;
    for (let i = 0; i < 200; i++) {
      const id = this.p.battleId;
      if (!id) return;
      const b = this.world.battles[id]!;
      const actions: Record<number, BattleAction> = { ...chooseActions(this.content, b.state, 0, { ...BOT_AI, seed: this.world.tick + i }) };
      // 抓：对手只剩一只、背包里有灯露——血量低了才扔，一招就能打倒的弱对手直接扔（其余的防御，免得打死它）
      const foes = activeUnits(b.state, 1);
      const dew = this.c.backpack['refinedDew'] ? 'refined' : this.c.backpack['lanternDew'] ? 'normal' : null;
      if (capture && b.kind === 'wild' && dew && dewThrown < 6 && foes.length === 1) {
        const foe = foes[0]!;
        const fragile = foe.unit.maxHp < 40 || foe.unit.hp / foe.unit.maxHp < 0.45;
        if (fragile) {
          const mine = activeUnits(b.state, 0);
          mine.forEach(({ slot }, k) => (actions[slot] = k === 0 ? { type: 'dew', quality: dew, target: { side: 1, slot: foe.slot } } : { type: 'skill', skillId: 'guard' }));
          dewThrown++;
        }
      }
      this.advance(COST.turn);
      if (!this.world.battles[id]) return;
      if (!this.act({ type: 'battleActions', battleId: id, actions })) {
        // AI 偶尔给出不合法的组合：全体防御兜底
        const fallback: Record<number, BattleAction> = {};
        for (const { slot } of activeUnits(b.state, 0)) fallback[slot] = { type: 'skill', skillId: 'guard' };
        if (!this.act({ type: 'battleActions', battleId: id, actions: fallback })) {
          if (this.verbose) console.log('  卡住的战斗：', JSON.stringify(actions), this.log.slice(-2).join(' | '));
          const flee: Record<number, BattleAction> = {};
          for (const { slot } of activeUnits(b.state, 0)) flee[slot] = { type: 'flee' };
          if (!this.act({ type: 'battleActions', battleId: id, actions: flee })) this.act({ type: 'forfeit', battleId: id });
        }
      }
    }
    if (this.p.battleId) this.act({ type: 'forfeit', battleId: this.p.battleId });
  }


  private hurt(): boolean {
    return this.party().some((s) => currentHp(this.content, s) < maxHpOf(this.content, s) * 0.6);
  }

  // ------------------------------------------------------------------ 家园

  private atHomeChores(): void {
    if (this.p.islandId !== HOME) return;
    this.advance(COST.chores);
    const c = this.c;
    // 东西放进仓库（工坊和升级从仓库、背包一起扣）
    for (const [item, n] of Object.entries(c.backpack)) {
      if (['lanternDew', 'refinedDew', 'lanternFuel', 'warmBun'].includes(item)) continue;
      this.act({ type: 'moveItems', item, count: n, to: 'storage' });
    }
    this.buildHome();
    this.organizeTeam();
    this.workHome();
    this.upgradeTools();
    // 补给：灯露、燃料
    const fuelNeed = 12 - (c.backpack['lanternFuel'] ?? 0);
    if (fuelNeed > 0 && c.shells > 300) this.act({ type: 'buy', item: 'lanternFuel', count: Math.min(fuelNeed, Math.floor((c.shells - 200) / 30)) });
    if ((c.backpack['lanternDew'] ?? 0) < 5 && c.shells > 400) this.act({ type: 'buy', item: 'lanternDew', count: 5 });
    if (this.strength() >= 30 && (c.backpack['refinedDew'] ?? 0) < 2 && c.shells > 1500) this.act({ type: 'buy', item: 'refinedDew', count: 2 });
    // 交得起的订单
    for (const o of this.world.orders) if (o.fulfilledBy === null) this.act({ type: 'fulfillOrder', orderId: o.id });
  }

  private place(building: string): string | null {
    const before = new Set(Object.keys(this.world.homes[PLAYER]!.buildings));
    for (let r = 4; r <= 16; r++) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
        if (z > 10) continue; // 码头那边留着
        if (this.applyQuiet({ type: 'build', building, x, z, rot: 0 })) {
          return Object.keys(this.world.homes[PLAYER]!.buildings).find((id) => !before.has(id)) ?? null;
        }
      }
    }
    return null;
  }

  private applyQuiet(intent: Intent): boolean {
    const r = applyIntent(this.content, this.world, PLAYER, intent);
    this.watch(r.events);
    return r.ok;
  }

  private buildHome(): void {
    if (!this.workshop) {
      this.workshop = this.place('workshop');
      if (this.workshop) this.note('建好工坊');
    }
    if (this.workshop && this.fields.length < 2) {
      const f = this.place('field');
      if (f) this.fields.push(f);
    }
    const home = this.world.homes[PLAYER]!;
    if (spiritCount(this.c) >= spiritCapacity(this.content, home) - 1) this.place('nest');
  }

  /** 队伍 = 等级最高的 6 只健康絮灵；其余在家打工。 */
  private organizeTeam(): void {
    const c = this.c;
    const all = Object.values(c.spirits).filter((s) => s.state !== 'egg' && s.state !== 'purifying' && !s.blighted);
    for (const s of all) this.applyQuiet({ type: 'evolve', spiritId: s.id });
    const best = Object.values(c.spirits)
      .filter((s) => s.state !== 'egg' && s.state !== 'purifying' && !s.blighted)
      .sort((a, b) => b.level - a.level)
      .slice(0, 6)
      .map((s) => s.id);
    if (best.join() !== c.party.join()) this.applyQuiet({ type: 'setParty', spiritIds: best });
    // 蚀化的放归（简化：机器人不做净化）
    for (const s of Object.values(c.spirits)) if (s.blighted && s.state !== 'party') this.applyQuiet({ type: 'release', spiritId: s.id });
  }

  private workHome(): void {
    const c = this.c;
    const home = this.world.homes[PLAYER]!;
    const idle = Object.values(c.spirits).filter((s) => s.state === 'idle' && !s.blighted);
    const slots: string[] = [];
    if (this.workshop && home.buildings[this.workshop]?.built) slots.push(this.workshop, this.workshop);
    for (const f of this.fields) if (home.buildings[f]?.built) slots.push(f);
    for (const id of slots) {
      const b = home.buildings[id]!;
      const want = slots.filter((x) => x === id).length;
      if (b.workers.length >= want) continue;
      const s = idle.shift();
      if (!s) break;
      this.applyQuiet({ type: 'assignWorker', buildingId: id, spiritId: s.id });
    }
    // 没建好的也派人帮忙
    for (const b of Object.values(home.buildings)) {
      if (b.built || b.workers.length > 0) continue;
      const s = idle.shift();
      if (s) this.applyQuiet({ type: 'assignWorker', buildingId: b.id, spiritId: s.id });
    }
    // 田：种风铃果（云舟要用），没种子就买
    for (const f of this.fields) {
      const b = home.buildings[f];
      if (!b?.built) continue;
      if (b.crop && b.crop.progress >= this.content.crops.get(b.crop.cropId)!.growTicks) this.applyQuiet({ type: 'harvest', buildingId: f });
      if (!b.crop) {
        if (!this.has('windbellSeed', 1)) this.applyQuiet({ type: 'buy', item: 'windbellSeed', count: 4 });
        this.applyQuiet({ type: 'plant', buildingId: f, seedItem: 'windbellSeed' });
      }
    }
    // 工坊：缺什么做什么
    const ws = this.workshop ? home.buildings[this.workshop] : undefined;
    if (ws?.built && !ws.job) {
      const want = this.materialNeeds();
      const order: Array<[string, string, number]> = [
        ['copperIngot', 'copperOre', 2],
        ['plank', 'wood', 2],
      ];
      for (const [recipe, input, per] of order) {
        const need = (want[recipe] ?? 0) - this.count(recipe);
        const can = Math.floor(this.count(input) / per);
        if (need > 0 && can > 0) {
          this.applyQuiet({ type: 'craft', buildingId: ws.id, recipeId: recipe, count: Math.min(need, can) });
          break;
        }
      }
    }
  }

  private count(item: string): number {
    return (this.c.backpack[item] ?? 0) + (this.world.homes[PLAYER]!.storage[item] ?? 0);
  }

  private has(item: string, n: number): boolean {
    return this.count(item) >= n;
  }

  /** 下一次升级提灯、云舟要的材料。 */
  private materialNeeds(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const tool of ['lantern', 'skiff'] as const) {
      const lv = this.c.tools[tool];
      if (lv >= 5) continue;
      for (const st of toolUpgradeCost(tool, lv).items) out[st.item] = (out[st.item] ?? 0) + st.count;
    }
    return out;
  }

  private neededTool(tool: ToolKind): number {
    // 需要的等级：已开放大区里最高的雾浓度 / 云舟等级
    let need = 1;
    for (const isl of this.content.islands.values()) {
      if (!islandPresent(this.world, isl) || !regionUnlocked(this.content, this.world, isl.region)) continue;
      need = Math.max(need, tool === 'lantern' ? effectiveFog(this.content, this.world, isl) : tool === 'skiff' ? isl.skiffLevel : 1);
    }
    return need;
  }

  private upgradeTools(): void {
    for (const tool of ['skiff', 'lantern'] as const) {
      while (this.c.tools[tool] < Math.min(5, this.neededTool(tool))) {
        if (!this.applyQuiet({ type: 'upgradeTool', tool })) break;
        this.note(`${tool === 'skiff' ? '云舟' : '提灯'}升到 ${this.c.tools[tool]} 级`);
      }
    }
  }

  private healAtHome(): void {
    if (!this.sail('home')) return;
    this.moveTo(CORE.x, CORE.z);
    for (let i = 0; i < 40 && this.party().some((s) => s.condition); i++) this.advance(20);
    this.atHomeChores();
  }

  // ------------------------------------------------------------------ 练级

  private reachable(isl: Island): boolean {
    if (!islandPresent(this.world, isl) || !regionUnlocked(this.content, this.world, isl.region)) return false;
    const fog = effectiveFog(this.content, this.world, isl);
    return this.c.tools.skiff >= isl.skiffLevel && this.c.tools.lantern >= fog && (fog === 0 || (this.c.backpack['lanternFuel'] ?? 0) >= fog);
  }

  private grindIsland(): Island | null {
    const top = this.strength();
    const fixed = [...this.content.islands.values()].filter((i) => i.kind === 'fixed' && this.reachable(i));
    // 野生最高等级不超过队伍强度 + 2 的岛里，挑最高的；都太强就挑最弱的
    const ok = fixed.filter((i) => i.wildLevel.max <= top + 2).sort((a, b) => b.wildLevel.max - a.wildLevel.max);
    return ok[0] ?? fixed.sort((a, b) => a.wildLevel.min - b.wildLevel.min)[0] ?? null;
  }

  /** 缺材料时：去采集点最多的那座岛（矿石、雾晶、木头）。 */
  private materialIsland(): Island | null {
    const need = this.materialNeeds();
    const short: Array<[string, string]> = [];
    if (this.count('copperIngot') * 2 + this.count('copperOre') < (need['copperIngot'] ?? 0) * 2) short.push(['ore', 'copperOre']);
    if (this.count('mistCrystal') < (need['mistCrystal'] ?? 0)) short.push(['crystal', 'mistCrystal']);
    if (this.count('plank') * 2 + this.count('wood') < (need['plank'] ?? 0) * 2) short.push(['tree', 'wood']);
    if (!short.length) return null;
    const kind = short[0]![0];
    const fixed = [...this.content.islands.values()].filter((i) => i.kind === 'fixed' && this.reachable(i));
    const ready = (i: Island) => gatherNodes(i).filter((n) => n.kind === kind && (this.world.islands[i.id]?.nodes[n.id] ?? 0) <= this.world.tick).length;
    const best = fixed.sort((a, b) => ready(b) - ready(a))[0];
    return best && ready(best) > 0 ? best : null;
  }

  private grind(): void {
    const isl = this.materialIsland() ?? this.grindIsland();
    if (!isl || !this.sail(isl.id)) {
      this.advance(200);
      return;
    }
    const minParty = Math.min(...this.party().map((s) => s.level));
    // 采集
    for (const node of gatherNodes(isl)) {
      if ((this.world.islands[isl.id]?.nodes[node.id] ?? 0) > this.world.tick) continue;
      this.moveTo(node.x, node.z + 1);
      this.advance(COST.gather);
      this.applyQuiet({ type: 'gather', nodeId: node.id });
    }
    // 打野生絮灵
    const wild = Object.values(this.world.islands[isl.id]?.wild ?? {}).sort((a, b) => a.group[0]!.level - b.group[0]!.level);
    for (const w of wild) {
      if (this.hurt()) break;
      if (w.group[0]!.level > this.strength() + 3) continue;
      this.moveTo(w.x, w.z + 1);
      if (!this.act({ type: 'encounter', wildId: w.id })) continue;
      const roomy = spiritCount(this.c) < spiritCapacity(this.content, this.world.homes[PLAYER]!);
      // 队伍不满、家里打工的不够 4 只、或者比队里最弱的强，就抓
      const worth = !w.blighted && w.group.length === 1 && (spiritCount(this.c) < 10 || w.group[0]!.level > minParty + 2);
      this.fight(roomy && worth);
    }
    // 回家养伤、整理
    const a = arrivalPoint(isl);
    this.moveTo(a.x, a.z);
    this.healAtHome();
  }

  // ------------------------------------------------------------------ 主线

  private currentRegion(): Region | null {
    return REGIONS.find((r) => !this.world.lighthousesLit.includes(this.lordOf(r).id)) ?? null;
  }

  private lordOf(r: Region) {
    return [...this.content.cloudlords.values()].find((c) => c.region === r)!;
  }

  private tryBoss(): boolean {
    const r = this.currentRegion();
    if (!r) return false;
    const cl = this.lordOf(r);
    const lighthouse = this.content.islands.get(cl.island)!;
    const guardianDone = this.world.guardiansBeaten.includes(cl.id);
    const target = guardianDone ? cl.boss.level : cl.boss.level - 4;
    const margin = 1 + 2 * (this.losses.get(`${cl.id}:${guardianDone}`) ?? 0);
    if (this.strength() < target + margin || !this.reachable(lighthouse) || this.party().length < 3) return false;
    if (!this.sail(cl.island)) return false;
    const before = this.won;
    if (!guardianDone) {
      this.moveTo(GUARDIAN_SPOT.x, GUARDIAN_SPOT.z + 1);
      if (!this.act({ type: 'challengeGuardian', cloudlordId: cl.id })) return false;
      this.fight(false);
      if (this.won > before) this.note(`打赢${cl.guardian.name}`);
    } else {
      this.moveTo(CLOUDLORD_SPOT.x, CLOUDLORD_SPOT.z + 2);
      if (!this.act({ type: 'challengeCloudlord', cloudlordId: cl.id })) return false;
      this.fight(false);
      if (this.world.lighthousesLit.includes(cl.id)) this.note(`讨伐${cl.name}，灯塔重燃`);
    }
    if (this.won === before) {
      const key = `${cl.id}:${guardianDone}`;
      this.losses.set(key, (this.losses.get(key) ?? 0) + 1);
      this.note(`${guardianDone ? cl.name : cl.guardian.name}没打过（第 ${this.losses.get(key)} 次）`);
    }
    this.healAtHome();
    return true;
  }

  /** 开局：跳过引导的表演部分，但领伙伴、首战、引导都走意图。 */
  private opening(): void {
    this.act({ type: 'adoptStarter' });
    this.act({ type: 'tutorial', step: 2 });
    if (this.act({ type: 'tutorialBattle' })) this.fight(false);
    this.act({ type: 'tutorial', step: 6, done: true });
    this.act({ type: 'buy', item: 'lanternDew', count: 3 });
    this.note('领到第一只伙伴');
  }

  run(maxDays: number): BotReport {
    this.opening();
    let lastDay = -1;
    while (!this.finale && this.day <= maxDays) {
      if (this.verbose && this.day !== lastDay && this.day % 3 === 0) {
        lastDay = this.day;
        const c = this.c;
        console.log(`  [第 ${this.day} 天] 云贝 ${c.shells} 提灯 ${c.tools.lantern} 云舟 ${c.tools.skiff} 絮灵 ${spiritCount(c)} 木 ${this.count('wood')} 板 ${this.count('plank')} 矿 ${this.count('copperOre')} 锭 ${this.count('copperIngot')} 晶 ${this.count('mistCrystal')} 风铃果 ${this.count('windbellFruit')} 岛 ${this.p.islandId} 需 ${JSON.stringify(this.materialNeeds())} ${this.log.slice(-3).join(' | ')}`);
      }
      if (this.p.battleId) this.fight(false);
      if (this.tryBoss()) continue;
      this.grind();
    }
    if (this.finale) this.note('终章：群岛重燃');
    return {
      finished: this.finale,
      days: this.day,
      milestones: this.milestones,
      battles: { won: this.won, lost: this.lost },
      ...(this.finale ? {} : { reason: `第 ${this.day} 天时只点亮了 ${this.world.lighthousesLit.length} 座灯塔` }),
    };
  }
}
