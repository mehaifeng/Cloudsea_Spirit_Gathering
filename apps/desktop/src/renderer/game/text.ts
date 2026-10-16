import { ELEMENT_INFO, STAT_NAME, STATS, TOOL_NAME, type ContentDb, type Element } from '@cloudsea/content';
import { computeStats, displayName, elementsOf, formOf, type Spirit, type WorldState } from '@cloudsea/sim';
import { elementBadge, h, icon } from '@cloudsea/ui';

export function itemName(content: ContentDb, id: string): string {
  return content.items.get(id)?.name ?? id;
}

export function spiritTitle(content: ContentDb, s: Spirit): HTMLElement {
  const name = displayName(content, s);
  const sex = icon(s.genes.sex === 'male' ? 'male' : 'female', 14);
  sex.style.color = s.genes.sex === 'male' ? '#4a8ac0' : '#d06a8a';
  return h(
    'span',
    { class: 'row', style: 'gap:4px' },
    h('b', {}, name),
    sex,
    h('span', { class: 'muted' }, `Lv.${s.level}`),
    s.genes.shiny ? h('span', { class: 'tag', title: '幻色' }, '✦幻色') : null,
    s.weary ? h('span', { class: 'tag warn' }, '疲惫') : null,
    s.blighted ? h('span', { class: 'tag warn' }, '蚀化') : null,
    s.foreign ? h('span', { class: 'tag' }, '外来') : null,
  );
}

export function elementBadges(content: ContentDb, s: Spirit): HTMLElement {
  return h('span', { class: 'row', style: 'gap:4px' }, ...elementsOf(content, s.genes).map((e) => elementBadge(e)));
}

export function stateLabel(s: Spirit): string {
  switch (s.state) {
    case 'party':
      return '队伍';
    case 'working':
      return '工作中';
    case 'idle':
      return '在家';
    case 'purifying':
      return '净化中';
    case 'egg':
      return '蛋';
  }
}

export function statBlock(content: ContentDb, s: Spirit): HTMLElement {
  const st = computeStats(content, s);
  const max = Math.max(...STATS.map((k) => st[k]), 1);
  return h(
    'div',
    { class: 'kv' },
    ...STATS.flatMap((k) => [
      h('span', {}, STAT_NAME[k]),
      h('div', { class: 'statbar' }, h('i', { style: `width:${Math.round((st[k] / max) * 100)}%` })),
      h('span', {}, `${st[k]}  `, h('span', { class: 'muted' }, `资质 ${s.genes.talents[k]}`)),
    ]),
  );
}

export function formName(content: ContentDb, s: Spirit): string {
  return formOf(content, s).form.name;
}

export function elementName(el: Element): string {
  return ELEMENT_INFO[el].name;
}

export function toolLine(world: Readonly<WorldState>, playerId: string): string {
  const c = world.characters[playerId]!;
  return (Object.keys(c.tools) as Array<keyof typeof c.tools>).map((k) => `${TOOL_NAME[k]} ${c.tools[k]} 级`).join(' · ');
}
