import { AILMENT_INFO, ELEMENT_INFO, STAGE_STATS, type ContentDb, type Element } from '@cloudsea/content';
import {
  activeUnits,
  availableSkills,
  benchUnits,
  createTerrain,
  findUnit,
  isAlive,
  unitAt,
  type ActiveBattle,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type BattleUnit,
  type DewQuality,
  type SideActions,
  type SlotRef,
  type WorldState,
} from '@cloudsea/sim';
import { buildIslandMesh, CreatureView, Environment, Fx, lookFromSpirit, nightFactor } from '@cloudsea/render';
import { button, clear, elementIcon, h } from '@cloudsea/ui';
import * as THREE from 'three';
import type { UiRoot } from './uiRoot';
import { PLAYER_ID } from './session';
import { clockAt } from '@cloudsea/sim';

const TARGET_LABEL: Record<string, string> = { singleEnemy: '单个对手', twoEnemies: '两个对手', allEnemies: '全部对手', self: '自己', singleAlly: '一名队友', allAllies: '我方全体', nextAlly: '下一位上场的队友', targets: '指定目标' };
const CATEGORY: Record<string, { label: string; order: number }> = {
  attack: { label: '攻击', order: 0 },
  protect: { label: '防御', order: 1 },
  buff: { label: '增益', order: 2 },
  heal: { label: '治疗', order: 3 },
  debuff: { label: '削弱', order: 4 },
};
const STAT_LABEL: Record<string, string> = { power: '力量', guard: '守护', agility: '灵巧', resonance: '共鸣', accuracy: '命中', evasion: '闪避' };
const DEW_ITEM: Record<DewQuality, string> = { normal: 'lanternDew', refined: 'refinedDew', superior: 'superiorDew' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 战斗画面：固定舞台镜头，双方 3 位一排对峙（DESIGN 14.3）。
 * 选择阶段逐只选行动；提交后按房主发回的事件逐条播放动画。
 */
export class BattleView {
  readonly scene = new THREE.Scene();
  readonly env: Environment;
  private readonly fx: Fx;
  private readonly views = new Map<string, CreatureView>();
  private state: BattleState;
  private readonly tagLayer = h('div', { class: 'unit-tags' });
  private readonly log = h('div', { id: 'battle-log' });
  private readonly panel = h('div', { id: 'battle-ui' });
  private readonly tags = new Map<string, HTMLElement>();
  private choices: Record<number, BattleAction> = {};
  private choosingSlot = -1;
  private sub: 'main' | 'target' | 'switch' | 'dew' | 'forfeit' = 'main';
  private pendingSkill: string | null = null;
  private busy = false;
  private t = 0;
  private ended = false;
  /** 开场运镜（v0.6）：从对手身边拉回舞台机位。 */
  private intro = 0;
  private static readonly INTRO_SECONDS = 1.1;
  private readonly tip = h('div', { class: 'skill-tip hidden' });
  private readonly ground = (_x: number, _z: number) => 0;

  constructor(
    private readonly content: ContentDb,
    private readonly ui: UiRoot,
    private readonly camera: THREE.PerspectiveCamera,
    private battle: ActiveBattle,
    private world: Readonly<WorldState>,
    private readonly submit: (actions: SideActions) => Promise<{ ok: boolean; error?: string }>,
    private readonly onFinished: () => void,
    /** 认输（守岛人对战）。 */
    private readonly forfeit: () => Promise<boolean>,
  ) {
    this.state = battle.state;
    this.env = new Environment(this.scene, { farIslands: true });
    const clock = clockAt(world.tick);
    this.env.setNight(nightFactor(clock.tickOfDay) * 0.7);
    this.env.setWeather(this.state.field.current);
    this.fx = new Fx(this.scene);
    const stage = buildIslandMesh(createTerrain({ seed: 77, radius: 10, amplitude: 0.15, flats: [{ x: 0, z: 0, radius: 9, height: 0 }] }), { grass: 120, flowers: 40, depth: 7 });
    this.scene.add(stage);
    this.ui.layer.append(this.tagLayer, this.log, this.panel, this.tip);
    this.placeAll();
    this.placeCamera(0);
    this.say(this.battle.kind === 'keeper' ? '守岛人对战开始！' : this.battle.kind === 'scripted' ? '被蚀化的絮灵扑了过来！' : `${this.enemyNames()} 出现了！`);
    // 运镜结束前不出行动栏
    setTimeout(() => !this.ended && this.startChoosing(), BattleView.INTRO_SECONDS * 1000 - 200);
  }

  /** 舞台机位；k < 1 时在“对手身边”与舞台之间（开场拉回）。 */
  private placeCamera(k: number): void {
    const e = 1 - Math.pow(1 - Math.min(1, k), 3);
    const enemy = this.slotPos(1, 0);
    const near = new THREE.Vector3(enemy.x + 1.8, 1.3, enemy.z + 2.6);
    const nearLook = new THREE.Vector3(enemy.x, 0.7, enemy.z);
    const stage = new THREE.Vector3(0, 6.2, 10.5);
    const stageLook = new THREE.Vector3(0, 0.8, 0.4);
    this.camera.position.lerpVectors(near, stage, e);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(nearLook, stageLook, e));
  }

  /** 各单位的位置与朝向（测试用：检查出招后是否回到原位）。 */
  positions(): Record<string, { x: number; z: number; yaw: number; home: { x: number; z: number } }> {
    const out: Record<string, { x: number; z: number; yaw: number; home: { x: number; z: number } }> = {};
    for (const side of [0, 1] as const) {
      this.state.sides[side].active.forEach((idx, slot) => {
        if (idx === null) return;
        const u = this.state.sides[side].units[idx]!;
        const v = this.views.get(u.uid);
        if (!v) return;
        const home = this.slotPos(side, slot);
        out[u.uid] = { x: v.group.position.x, z: v.group.position.z, yaw: v.yaw, home: { x: home.x, z: home.z } };
      });
    }
    return out;
  }

  private enemyNames(): string {
    return activeUnits(this.state, 1).map((a) => a.unit.name).join('、');
  }

  private slotPos(side: 0 | 1, slot: number): THREE.Vector3 {
    const n = this.state.sides[side].active.length;
    const x = (slot - (n - 1) / 2) * 2.7;
    return new THREE.Vector3(side === 0 ? x : -x, 0, side === 0 ? 3.1 : -3.1);
  }

  private spiritFor(u: BattleUnit) {
    return battleUnitSpirit(this.world, this.battle, u);
  }

  private placeAll(): void {
    for (const side of [0, 1] as const) {
      this.state.sides[side].active.forEach((idx, slot) => {
        if (idx === null) return;
        const u = this.state.sides[side].units[idx]!;
        if (!this.views.has(u.uid)) this.addView(u, side, slot);
      });
    }
  }

  private addView(u: BattleUnit, side: 0 | 1, slot: number): CreatureView {
    const v = new CreatureView(lookFromSpirit(this.content, this.spiritFor(u)));
    const p = this.slotPos(side, slot);
    v.setPosition(p.x, p.z, side === 0 ? Math.PI : 0);
    v.setFainted(u.downed);
    this.scene.add(v.group);
    this.views.set(u.uid, v);
    const tag = h('div', { class: 'unit-tag' });
    this.tagLayer.append(tag);
    this.tags.set(u.uid, tag);
    return v;
  }

  private removeView(uid: string): void {
    const v = this.views.get(uid);
    if (v) {
      this.scene.remove(v.group);
      v.dispose();
    }
    this.views.delete(uid);
    this.tags.get(uid)?.remove();
    this.tags.delete(uid);
  }

  private say(text: string): void {
    const line = h('div', { class: 'line' }, text);
    this.log.append(line);
    while (this.log.children.length > 3) this.log.firstChild?.remove();
  }

  // ---------------------------------------------------------------- 选择阶段

  private needsChoice(slot: number): boolean {
    const u = unitAt(this.state, { side: 0, slot });
    return isAlive(u) && !u.charging;
  }

  private startChoosing(): void {
    this.choices = {};
    this.sub = 'main';
    this.choosingSlot = this.state.sides[0].active.findIndex((_, slot) => this.needsChoice(slot));
    if (this.choosingSlot < 0) void this.send();
    else this.renderPanel();
  }

  private qiLeft(): number {
    let qi = this.state.sides[0].qi;
    for (const a of Object.values(this.choices)) if (a.type === 'skill') qi -= this.content.skills.get(a.skillId)!.qiCost;
    return qi;
  }

  private choose(action: BattleAction): void {
    this.choices[this.choosingSlot] = action;
    this.sub = 'main';
    this.pendingSkill = null;
    const next = this.state.sides[0].active.findIndex((_, slot) => slot > this.choosingSlot && this.needsChoice(slot));
    if (next < 0) void this.send();
    else {
      this.choosingSlot = next;
      this.renderPanel();
    }
  }

  private back(): void {
    if (this.sub !== 'main') {
      this.sub = 'main';
      this.renderPanel();
      return;
    }
    const prev = [...this.state.sides[0].active.keys()].reverse().find((slot) => slot < this.choosingSlot && this.needsChoice(slot));
    if (prev === undefined) return;
    delete this.choices[prev];
    this.choosingSlot = prev;
    this.renderPanel();
  }

  private async send(): Promise<void> {
    this.busy = true;
    clear(this.panel);
    this.panel.append(h('div', { class: 'panel muted' }, '……'));
    const r = await this.submit(this.choices);
    if (!r.ok) {
      this.ui.toast(r.error ?? '行动无效', 'error');
      this.busy = false;
      this.startChoosing();
    }
  }

  private renderPanel(): void {
    clear(this.panel);
    this.tip.classList.add('hidden');
    if (this.busy || this.ended) return;
    const slot = this.choosingSlot;
    const u = unitAt(this.state, { side: 0, slot });
    if (!u) return;
    const qi = this.qiLeft();
    const qiPips = h('span', { class: 'qi-pips', title: '云气' }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < qi ? 'on' : '' })));
    const head = h(
      'div',
      { class: 'row', style: 'justify-content:space-between;width:100%' },
      h('span', {}, h('b', {}, u.name), `  的行动`, h('span', { class: 'muted' }, `  （${slot + 1} 号位）`)),
      h('span', { class: 'row' }, '云气 ', qiPips, `${qi}/10`),
    );
    const box = h('div', { class: 'panel battle-actions' }, head);
    const row = h('div', { class: 'row action-row' });
    box.append(row);
    const c = this.world.characters[PLAYER_ID]!;

    if (this.sub === 'main') {
      // 出招按类别排序：攻击 → 防御 → 增益 → 治疗 → 削弱；同类里轻击 / 防御这类基础招式放最后（v0.6）
      const skills = availableSkills(u)
        .map((id) => this.content.skills.get(id)!)
        .sort((a, b) => (CATEGORY[a.category]?.order ?? 9) - (CATEGORY[b.category]?.order ?? 9) || Number(a.source === 'basic') - Number(b.source === 'basic'));
      let lastCat = '';
      for (const sk of skills) {
        const el: Element = sk.element === 'user' ? u.elements[0]! : sk.element;
        const can = sk.qiCost <= qi;
        if (sk.category !== lastCat) {
          lastCat = sk.category;
          row.append(h('span', { class: 'sk-group' }, CATEGORY[sk.category]?.label ?? ''));
        }
        const btn = button([elementIcon(el, 14), h('b', {}, sk.name), h('span', { class: 'sk-cost' }, String(sk.qiCost))], () => this.pickSkill(sk.id), {
          disabled: !can,
          class: `sk ${sk.category === 'attack' && sk.source !== 'basic' ? 'primary' : ''}`,
        });
        this.attachTip(btn, () => this.skillTip(sk.id, el, can));
        row.append(btn);
      }
      row.append(h('span', { class: 'sk-group' }, '其他'));
      const bench = benchUnits(this.state, 0).filter((i) => !Object.values(this.choices).some((a) => a.type === 'switch' && a.unitIndex === i));
      const tipped = (label: string, onClick: () => void, title: string, text: string) => {
        const b = button(label, onClick, { class: 'sk' });
        this.attachTip(b, () => h('div', {}, h('b', {}, title), h('div', {}, text)));
        row.append(b);
      };
      if (bench.length > 0) tipped('换人', () => ((this.sub = 'switch'), this.renderPanel()), '换人', '换下这只絮灵，换上后备的伙伴。换人在本回合最先执行，换上来的伙伴这回合不行动。');
      if (this.state.kind === 'wild') {
        tipped('灯露', () => ((this.sub = 'dew'), this.renderPanel()), '灯露', '用灯露邀请野生絮灵加入。对方体力越低、灯露品质越好，成功率越高。');
        tipped('逃跑', () => this.choose({ type: 'flee' }), '逃跑', '离开这场战斗。按双方的灵巧判定能否逃掉，失败会白白浪费这一回合。');
      } else if (this.state.kind !== 'scripted') {
        tipped('认输', () => ((this.sub = 'forfeit'), this.renderPanel()), '认输', '结束这场对战，按战败处理：上过场的絮灵会疲惫。');
      }
      // 被看破的对手：显示它下回合要做什么
      const prepared = this.battle.preparedAi;
      if (prepared) {
        for (const [s, a] of Object.entries(prepared)) {
          const enemy = unitAt(this.state, { side: 1, slot: Number(s) });
          if (!enemy || !this.state.revealed.includes(enemy.uid)) continue;
          const what = a.type === 'skill' ? this.content.skills.get(a.skillId)!.name : a.type === 'switch' ? '换人' : a.type;
          box.append(h('div', { class: 'muted', style: 'margin-top:6px' }, `听风：${enemy.name} 下回合会使用「${what}」`));
        }
      }
    } else if (this.sub === 'target') {
      const sk = this.content.skills.get(this.pendingSkill!)!;
      const ally = sk.target === 'singleAlly';
      row.append(h('span', { class: 'muted' }, `${sk.name}：选择${ally ? '队友' : '目标'}`));
      const side = ally ? 0 : 1;
      for (const { slot: s, unit } of activeUnits(this.state, side)) {
        if (ally && unit === u) continue;
        row.append(button(`${unit.name}  ${unit.hp}/${unit.maxHp}`, () => this.choose({ type: 'skill', skillId: sk.id, target: { side, slot: s } as SlotRef }), { class: 'primary' }));
      }
      row.append(button('返回', () => this.back()));
    } else if (this.sub === 'switch') {
      row.append(h('span', { class: 'muted' }, '换上：'));
      for (const i of benchUnits(this.state, 0)) {
        if (Object.values(this.choices).some((a) => a.type === 'switch' && a.unitIndex === i)) continue;
        const b = this.state.sides[0].units[i]!;
        row.append(button(`${b.name} Lv.${b.level}  ${b.hp}/${b.maxHp}`, () => this.choose({ type: 'switch', unitIndex: i })));
      }
      row.append(button('返回', () => this.back()));
    } else if (this.sub === 'dew') {
      row.append(h('span', { class: 'muted' }, '用哪种灯露？'));
      for (const q of ['normal', 'refined', 'superior'] as const) {
        const n = (c.backpack[DEW_ITEM[q]] ?? 0) - Object.values(this.choices).filter((a) => a.type === 'dew' && a.quality === q).length;
        if (n <= 0) continue;
        for (const { slot: s, unit } of activeUnits(this.state, 1)) {
          row.append(button(`${this.content.items.get(DEW_ITEM[q])!.name}（${n}）→ ${unit.name}`, () => this.choose({ type: 'dew', quality: q, target: { side: 1, slot: s } }), { class: 'primary' }));
        }
      }
      if (row.children.length === 1) row.append(h('span', {}, '背包里没有灯露了'));
      row.append(button('返回', () => this.back()));
    } else if (this.sub === 'forfeit') {
      row.append(
        h('span', {}, '认输会按战败处理：上过场的絮灵会疲惫。'),
        button('确定认输', async () => {
          this.busy = true;
          clear(this.panel);
          if (!(await this.forfeit())) {
            this.busy = false;
            this.sub = 'main';
            this.renderPanel();
          }
        }, { class: 'primary' }),
        button('继续战斗', () => this.back()),
      );
    }
    if (this.sub === 'main' && Object.keys(this.choices).length > 0) row.append(button('上一只', () => this.back()));
    this.panel.append(box);
    (box.querySelector('[data-focus]') as HTMLElement | null)?.focus();
  }

  /** 技能说明卡（悬停 / 获得焦点时显示在按钮上方）。 */
  private skillTip(id: string, el: Element, can: boolean): HTMLElement {
    const sk = this.content.skills.get(id)!;
    const facts = [`云气 ${sk.qiCost}`, sk.power ? `威力 ${sk.power}` : null, sk.accuracy ? `命中 ${sk.accuracy}%` : '必中', `目标：${TARGET_LABEL[sk.target] ?? sk.target}`, sk.priority > 0 ? '先手' : sk.priority < 0 ? '后手' : null].filter(Boolean);
    return h(
      'div',
      {},
      h('div', { class: 'row', style: 'gap:6px' }, elementIcon(el, 16), h('b', {}, sk.name), h('span', { class: 'badge' }, CATEGORY[sk.category]?.label ?? ''), h('span', { class: 'muted' }, ELEMENT_INFO[el].name)),
      h('div', { class: 'muted', style: 'font-size:14px' }, facts.join(' · ')),
      h('div', {}, sk.description),
      can ? null : h('div', { class: 'warn-text' }, '云气不够'),
    );
  }

  private attachTip(btn: HTMLElement, render: () => HTMLElement): void {
    const show = () => {
      clear(this.tip);
      this.tip.append(render());
      this.tip.classList.remove('hidden');
      const r = btn.getBoundingClientRect();
      const w = this.tip.offsetWidth;
      this.tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
      this.tip.style.top = `${r.top - this.tip.offsetHeight - 10}px`;
    };
    const hide = () => this.tip.classList.add('hidden');
    btn.addEventListener('mouseenter', show);
    btn.addEventListener('focus', show);
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('blur', hide);
  }

  private pickSkill(id: string): void {
    const sk = this.content.skills.get(id)!;
    if (sk.target === 'singleEnemy' || sk.target === 'twoEnemies' || sk.target === 'singleAlly') {
      const candidates = sk.target === 'singleAlly' ? activeUnits(this.state, 0).length - 1 : activeUnits(this.state, 1).length;
      if (candidates <= 0) {
        this.ui.toast('没有可以选的目标', 'error');
        return;
      }
      if (candidates === 1 && sk.target !== 'singleAlly') {
        const only = activeUnits(this.state, 1)[0]!;
        this.choose({ type: 'skill', skillId: id, target: { side: 1, slot: only.slot } });
        return;
      }
      this.pendingSkill = id;
      this.sub = 'target';
      this.renderPanel();
      return;
    }
    this.choose({ type: 'skill', skillId: id });
  }

  // ---------------------------------------------------------------- 播放

  /** 房主结算完一回合：逐条播放事件，然后进入下一回合的选择。 */
  async playTurn(events: readonly BattleEvent[], next: ActiveBattle | null, world: Readonly<WorldState>): Promise<void> {
    this.world = world;
    this.busy = true;
    clear(this.panel);
    for (const e of events) {
      await this.playEvent(e);
    }
    if (next) {
      this.battle = next;
      this.state = next.state;
      this.syncViews();
      this.busy = false;
      if (!this.ended) this.startChoosing();
    }
  }

  private name(uid: string): string {
    return findUnit(this.state, uid).unit.name;
  }

  private damageNumber(uid: string, text: string, heal = false): void {
    const v = this.views.get(uid);
    if (!v) return;
    const p = v.headPos().clone();
    p.y += 0.4;
    const s = p.project(this.camera);
    const el = h('div', { class: `dmg ${heal ? 'heal' : ''}`, style: `left:${(s.x * 0.5 + 0.5) * innerWidth}px;top:${(-s.y * 0.5 + 0.5) * innerHeight}px` }, text);
    this.tagLayer.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  private async playEvent(e: BattleEvent): Promise<void> {
    const st = this.state;
    switch (e.t) {
      case 'turnStart':
        st.sides[0].qi = e.qi[0];
        st.sides[1].qi = e.qi[1];
        return;
      case 'use': {
        const sk = this.content.skills.get(e.skillId)!;
        this.say(`${this.name(e.uid)} 使用了「${sk.name}」`);
        const v = this.views.get(e.uid);
        // 出招：原地向前扑一下再弹回（不走路、不转身，位置不会累积漂移，v0.6）
        if (v && sk.power > 0) {
          v.lunge(1.1);
          await sleep(320);
        } else v?.hop(2.2);
        await sleep(240);
        return;
      }
      case 'charge':
        this.say(`${this.name(e.uid)} 正在蓄力……`);
        await sleep(500);
        return;
      case 'miss':
        this.say('没有命中！');
        this.damageNumber(e.target, 'MISS');
        await sleep(450);
        return;
      case 'damage': {
        const u = findUnit(st, e.target).unit;
        u.hp = e.hpAfter;
        this.views.get(e.target)?.hit();
        this.damageNumber(e.target, `-${e.amount}`);
        const v = this.views.get(e.target);
        if (v) this.fx.spawn('spark', v.headPos(), 5, { size: 0.35, vy: 0.6, life: 0.5, spread: 1.6, color: 0xffe2a0 });
        if (e.crit) this.say('暴击！');
        if (e.effectiveness > 1) this.say('效果拔群！');
        else if (e.effectiveness < 1) this.say('效果不太好……');
        await sleep(420);
        return;
      }
      case 'heal': {
        findUnit(st, e.target).unit.hp = e.hpAfter;
        this.damageNumber(e.target, `+${e.amount}`, true);
        const v = this.views.get(e.target);
        if (v) this.fx.spawn('spark', v.headPos(), 6, { size: 0.3, vy: 1, life: 0.9, spread: 1, color: 0xb8ffd8 });
        await sleep(380);
        return;
      }
      case 'stage':
        this.say(`${this.name(e.target)} 的${STAT_LABEL[e.stat] ?? e.stat}${e.delta > 0 ? '提升' : '下降'}了`);
        await sleep(380);
        return;
      case 'ailment':
        findUnit(st, e.target).unit.ailment = { id: e.ailment, turnsLeft: 3 };
        this.say(`${this.name(e.target)} 陷入了「${AILMENT_INFO[e.ailment].name}」`);
        await sleep(420);
        return;
      case 'ailmentEnd':
        findUnit(st, e.target).unit.ailment = null;
        this.say(`${this.name(e.target)} 的「${AILMENT_INFO[e.ailment].name}」解除了`);
        await sleep(300);
        return;
      case 'paralyzedSkip':
        this.say(`${this.name(e.uid)} 麻痹了，动不了！`);
        await sleep(450);
        return;
      case 'retarget':
        this.say(`${this.name(e.uid)} 在迷蒙中弄错了目标！`);
        await sleep(400);
        return;
      case 'intercept':
        this.say(`${this.name(e.protector)} 挡在了 ${this.name(e.target)} 前面！`);
        await sleep(400);
        return;
      case 'reveal':
        this.say(`看破了 ${this.name(e.target)} 的下一步！`);
        await sleep(400);
        return;
      case 'weather':
        st.field.current = e.weather;
        this.env.setWeather(e.weather);
        this.say(e.reverted ? `天候恢复为${e.weather ? ELEMENT_INFO[e.weather].name : '无'}` : `天候变成了${e.weather ? ELEMENT_INFO[e.weather].name : '无'}！`);
        await sleep(450);
        return;
      case 'qi':
        st.sides[e.side].qi = e.qi;
        return;
      case 'downed': {
        const u = findUnit(st, e.target).unit;
        u.downed = true;
        this.views.get(e.target)?.setFainted(true);
        this.say(`${u.name} 倒下了`);
        await sleep(550);
        return;
      }
      case 'switch': {
        const incoming = findUnit(st, e.in).unit;
        if (e.out) this.removeView(e.out);
        st.sides[e.side].active[e.slot] = findUnit(st, e.in).index;
        const v = this.addView(incoming, e.side, e.slot);
        v.hop(3);
        this.fx.spawn('puff', v.headPos(), 10, { size: 0.6, vy: 0.6, life: 0.9, spread: 2 });
        this.say(`${incoming.name} 上场了`);
        await sleep(450);
        return;
      }
      case 'captureAttempt': {
        const v = this.views.get(e.target);
        if (v) this.fx.spawn('spark', v.headPos(), 12, { size: 0.4, vy: 0.8, life: 1, spread: 1.4, color: 0xffd59a });
        this.say(`灯露的光包住了 ${this.name(e.target)}……（成功率 ${Math.round(e.chance * 100)}%）`);
        await sleep(800);
        if (e.success) {
          findUnit(st, e.target).unit.captured = true;
          this.say('捕获成功！');
          if (v) {
            v.hop(4);
            this.fx.spawn('heart', v.headPos(), 8, { size: 0.35, vy: 1.2, life: 1.3, spread: 1.4 });
          }
          await sleep(500);
          this.removeView(e.target);
        } else {
          this.say('它挣脱了！');
          await sleep(400);
        }
        return;
      }
      case 'flee':
        this.say(e.success ? '成功逃跑了。' : '没能逃掉！');
        await sleep(500);
        return;
      case 'end':
        return;
    }
  }

  private syncViews(): void {
    for (const side of [0, 1] as const) {
      this.state.sides[side].active.forEach((idx, slot) => {
        if (idx === null) return;
        const u = this.state.sides[side].units[idx]!;
        if (!this.views.has(u.uid)) this.addView(u, side, slot);
        this.views.get(u.uid)!.setFainted(u.downed);
      });
    }
    const onField = new Set(this.state.sides.flatMap((s) => s.active.filter((i): i is number => i !== null).map((i) => s.units[i]!.uid)));
    for (const uid of [...this.views.keys()]) if (!onField.has(uid)) this.removeView(uid);
  }

  /** 战斗结束：显示结算。 */
  showResult(r: { result: string; exp: Readonly<Record<string, number>>; levelUps: readonly string[]; captured: readonly string[]; rescued: boolean }, world: Readonly<WorldState>): void {
    this.ended = true;
    this.busy = true;
    clear(this.panel);
    const c = world.characters[PLAYER_ID]!;
    const title = r.result === 'win' ? '胜利！' : r.result === 'fled' ? '离开了战斗' : r.result === 'lose' ? '败下阵来……' : '平局';
    const lines: HTMLElement[] = [];
    for (const [id, exp] of Object.entries(r.exp)) {
      const s = c.spirits[id];
      if (!s || exp <= 0) continue;
      lines.push(h('div', {}, `${s.nickname ?? this.content.forms.get(s.formId)!.form.name} 获得经验 ${exp}${r.levelUps.includes(id) ? ` · 升到了 ${s.level} 级！` : ''}`));
    }
    for (const id of r.captured) {
      const s = c.spirits[id];
      if (s) lines.push(h('div', {}, `「${this.content.forms.get(s.formId)!.form.name}」加入了你的${s.state === 'party' ? '队伍' : '家园'}${s.blighted ? '（它被蚀化了，需要在净化池净化）' : ''}`));
    }
    if (r.result === 'lose') lines.push(h('div', { class: 'muted' }, '参战的絮灵疲惫了，暂时不能出战。回到家园岛就会慢慢恢复（有栖巢快一倍、有温泉快四倍），或者喂暖心包立刻恢复——码头的商队有卖。'));
    if (r.rescued) lines.push(h('div', { class: 'muted' }, '路过的风帆商队把你送回了家园岛。'));
    const box = h('div', { class: 'panel', style: 'width:min(560px,94vw)' }, h('h2', {}, title), ...lines, h('div', { class: 'row', style: 'margin-top:10px' }, button('继续', () => this.onFinished(), { class: 'primary' })));
    this.panel.append(box);
    (box.querySelector('[data-focus]') as HTMLElement | null)?.focus();
  }

  update(dt: number): void {
    this.t += dt;
    if (this.intro < BattleView.INTRO_SECONDS) {
      this.intro += dt;
      this.placeCamera(this.intro / BattleView.INTRO_SECONDS);
    }
    for (const v of this.views.values()) v.update(dt, this.t, this.ground);
    this.env.update(dt, this.t, this.camera, new THREE.Vector3(0, 0, 0));
    this.fx.update(dt);
    // 单位标签
    for (const [uid, tag] of this.tags) {
      const v = this.views.get(uid);
      const { unit } = findUnit(this.state, uid);
      if (!v) continue;
      const p = v.headPos().clone();
      p.y += 0.55;
      const s = p.project(this.camera);
      tag.style.left = `${(s.x * 0.5 + 0.5) * innerWidth}px`;
      tag.style.top = `${(-s.y * 0.5 + 0.5) * innerHeight}px`;
      const ratio = unit.hp / unit.maxHp;
      const stages = STAGE_STATS.map((k) => [k, unit.stages[k]] as const).filter(([, n]) => n !== 0);
      const key = `${unit.hp}|${unit.ailment?.id}|${stages.join()}|${this.choosingSlot}|${unit.charging?.skillId}`;
      if (tag.dataset['key'] === key) continue;
      tag.dataset['key'] = key;
      clear(tag);
      const mine = uid.startsWith('0:');
      tag.className = `unit-tag ${mine && this.state.sides[0].active[this.choosingSlot] === findUnit(this.state, uid).index && !this.busy ? 'active' : ''}`;
      tag.append(
        h('div', { class: 'row', style: 'gap:4px' }, ...unit.elements.map((e) => elementIcon(e, 14)), h('b', {}, unit.name), h('span', { class: 'muted' }, `Lv.${unit.level}`)),
        h('div', { class: `hpbar ${ratio < 0.3 ? 'low' : ''}` }, h('i', { style: `width:${Math.max(0, ratio * 100)}%` })),
        h('div', { class: 'muted', style: 'font-size:14px' }, `${unit.hp}/${unit.maxHp}`, unit.ailment ? `  ${AILMENT_INFO[unit.ailment.id].name}` : '', unit.charging ? '  蓄力中' : '', ...stages.map(([k, n]) => `  ${STAT_LABEL[k]}${n > 0 ? '+' : ''}${n}`)),
      );
    }
  }

  dispose(): void {
    this.tip.remove();
    this.tagLayer.remove();
    this.log.remove();
    this.panel.remove();
    for (const v of this.views.values()) v.dispose();
    this.fx.clear();
  }
}

/** 战斗单位对应的絮灵外观来源（自家 / 野生 / 守岛人；新手引导的对手不在世界里，按单位信息拼一个）。 */
export function battleUnitSpirit(world: Readonly<WorldState>, battle: ActiveBattle, u: BattleUnit): Parameters<typeof lookFromSpirit>[1] {
  const c = world.characters[PLAYER_ID]!;
  const own = c.spirits[u.spiritId];
  if (own) return own;
  const wild = battle.wildId ? Object.values(world.islands).flatMap((i) => Object.values(i.wild)).find((w) => w.id === battle.wildId)?.group.find((s) => s.id === u.spiritId) : undefined;
  if (wild) return wild;
  const keeperSpirit = battle.keeperId ? world.keepers[battle.keeperId]?.spirits.find((s) => s.id === u.spiritId) : undefined;
  if (keeperSpirit) return keeperSpirit;
  return { id: u.spiritId, formId: u.formId, blighted: u.blighted, genes: { lineId: u.lineId, sex: 'female', secondaryElement: null, parts: { ears: { partId: 'pointedEars', mutated: false }, horns: { partId: null, mutated: false }, wings: { partId: null, mutated: false }, tail: { partId: 'fluffTail', mutated: false }, feet: { partId: 'twoFeet', mutated: false } }, hueShift: 0, pattern: 'plain', sizePercent: 100, talents: { hp: 0, power: 0, guard: 0, agility: 0, resonance: 0 }, natureId: 'calm', shiny: false } } as Parameters<typeof lookFromSpirit>[1];
}
