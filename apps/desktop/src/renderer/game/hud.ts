import { ELEMENT_INFO, type ContentDb } from '@cloudsea/content';
import { clockAt, formatClock, homeIslandId, weatherAt, type WorldState } from '@cloudsea/sim';
import { clear, elementIcon, h, icon } from '@cloudsea/ui';
import type { Interactable } from './explore';
import { PLAYER_ID } from './session';
import type { UiRoot } from './uiRoot';

/** 抬头显示：时间 / 天气 / 所在岛 / 云贝 / 燃料 / 灯露 / 队伍一览（DESIGN 14.4）。 */
export class Hud {
  private lastKey = '';
  private lastPrompt = '';

  constructor(private readonly content: ContentDb, private readonly ui: UiRoot) {}

  update(world: Readonly<WorldState>, nearest: Interactable | null, mode: 'explore' | 'build' | 'battle'): void {
    const c = world.characters[PLAYER_ID]!;
    const p = world.players[PLAYER_ID]!;
    const island = this.content.islands.get(p.islandId);
    const clock = clockAt(world.tick);
    const weather = weatherAt(world.seed, island?.region ?? 'sunPlains', world.tick);
    const placeName = p.islandId === homeIslandId(PLAYER_ID) ? `${c.name}的家园岛` : island?.name ?? '';
    const key = [clock.day, formatClock(clock), weather, placeName, c.shells, c.backpack['lanternFuel'] ?? 0, c.backpack['lanternDew'] ?? 0, mode, world.paused, JSON.stringify(c.party.map((id) => [c.spirits[id]?.level, c.spirits[id]?.weary, c.spirits[id]?.formId]))].join('|');
    if (key !== this.lastKey) {
      this.lastKey = key;
      clear(this.ui.hudTL);
      clear(this.ui.hudTR);
      clear(this.ui.partyBar);
      this.ui.hudTL.append(
        h('span', { class: 'hud-chip' }, icon('clock'), `第 ${clock.day} 天 ${formatClock(clock)}`, clock.isNight ? ' · 夜' : ''),
        h('span', { class: 'hud-chip', title: '天气' }, elementIcon(weather, 16), ELEMENT_INFO[weather].name),
        h('span', { class: 'hud-chip' }, placeName, island ? h('span', { class: 'muted' }, ` 雾 ${island.fogLevel}`) : null),
      );
      if (world.paused) this.ui.hudTL.append(h('span', { class: 'hud-chip' }, '已暂停'));
      this.ui.hudTR.append(
        h('span', { class: 'hud-chip', title: '云贝' }, icon('shell'), String(c.shells)),
        h('span', { class: 'hud-chip', title: '提灯燃料' }, icon('lantern'), String(c.backpack['lanternFuel'] ?? 0)),
        h('span', { class: 'hud-chip', title: '灯露' }, icon('star'), String((c.backpack['lanternDew'] ?? 0) + (c.backpack['refinedDew'] ?? 0) + (c.backpack['superiorDew'] ?? 0))),
      );
      if (mode !== 'battle') {
        for (const id of c.party) {
          const s = c.spirits[id];
          if (!s) continue;
          const form = this.content.forms.get(s.formId)!;
          this.ui.partyBar.append(
            h(
              'div',
              { class: 'party-card' },
              h('b', {}, s.nickname ?? form.form.name),
              h('span', { class: 'row', style: 'gap:4px' }, elementIcon(form.line.element, 14), `Lv.${s.level}`, s.weary ? h('span', { class: 'tag warn' }, '疲惫') : null),
            ),
          );
        }
      }
      this.ui.hints.textContent =
        mode === 'build'
          ? '鼠标选位置 · 点击放置 · R 旋转 · Esc / 右键退出'
          : mode === 'battle'
            ? '方向键选择 · Enter 确认 · Esc 返回'
            : `WASD 移动 · Shift 跑 · 空格 跳 · 拖动转视角 · E 交互 · Tab 菜单${p.islandId === homeIslandId(PLAYER_ID) ? ' · B 建造' : ''} · M 星图`;
      this.ui.hints.classList.toggle('hidden', false);
    }
    const prompt = mode === 'explore' && nearest ? nearest.label : '';
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      clear(this.ui.prompt);
      if (prompt) this.ui.prompt.append(h('span', { class: 'hud-chip' }, h('kbd', {}, 'E'), prompt));
    }
  }

  clear(): void {
    this.lastKey = '';
    this.lastPrompt = '';
    for (const el of [this.ui.hudTL, this.ui.hudTR, this.ui.partyBar, this.ui.prompt]) clear(el);
    this.ui.hints.classList.add('hidden');
  }
}
