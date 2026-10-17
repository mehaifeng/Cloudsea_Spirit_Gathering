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
  /** 点队伍徽章（打开该絮灵的详情）。 */
  onPartyClick: ((spiritId: string) => void) | null = null;

  constructor(private readonly content: ContentDb, private readonly ui: UiRoot) {}

  update(world: Readonly<WorldState>, nearest: Interactable | null, mode: 'explore' | 'build' | 'battle', covered = false): void {
    // 菜单、对话打开时收起队伍徽章与操作提示（v0.6）
    this.ui.partyBar.classList.toggle('hidden', covered || mode !== 'explore');
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
        // 队伍徽章（v0.6）：属性图标 + 名字首字 + 等级 + 疲惫标记，点击打开详情
        for (const id of c.party) {
          const s = c.spirits[id];
          if (!s) continue;
          const form = this.content.forms.get(s.formId)!;
          const name = s.nickname ?? form.form.name;
          const badge = h(
            'button',
            { class: `party-badge ${s.weary ? 'weary' : ''}`, title: `${name} Lv.${s.level}${s.weary ? '（疲惫）' : ''} · 点击查看`, 'data-spirit': id },
            elementIcon(form.line.element, 14),
            h('span', { class: 'nm' }, name.slice(0, 2)),
            h('span', { class: 'lv' }, String(s.level)),
          );
          badge.addEventListener('click', () => this.onPartyClick?.(id));
          this.ui.partyBar.append(badge);
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
