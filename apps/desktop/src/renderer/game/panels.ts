import {
  affinityLevel,
  BLUEPRINT_SHOP,
  coreUpgradeCost,
  ECONOMY,
  ELEMENT_INFO,
  HOME_CHART_POS,
  NATURES,
  PART_SLOTS,
  REGION_NAME,
  STAT_NAME,
  TOOL_NAME,
  toolUpgradeCost,
  type ContentDb,
  type ItemStack,
  type ToolKind,
} from '@cloudsea/content';
import {
  breedBlocker,
  buildingSlots,
  buildingsUsed,
  clockAt,
  dayOf,
  encodeSpiritCode,
  equippableSkills,
  evolutionBlocker,
  expForLevel,
  expressedParts,
  forecast,
  formOf,
  homeIslandId,
  isStarter,
  nextStoryNode,
  passiveSkills,
  skillPool,
  slotsUsed,
  spiritCapacity,
  spiritCount,
  storageCapacity,
  weatherAt,
  workEfficiency,
  type BuildingInstance,
  type Intent,
  type Spirit,
  type WorldState,
} from '@cloudsea/sim';
import { button, elementBadge, elementIcon, h, icon } from '@cloudsea/ui';
import { PLAYER_ID } from './session';
import { conditionText, elementBadges, itemName, spiritTitle, statBlock, stateLabel } from './text';
import type { UiRoot } from './uiRoot';

export interface Ctx {
  readonly content: ContentDb;
  readonly ui: UiRoot;
  world(): Readonly<WorldState>;
  /** 发意图；失败时提示原因。成功返回 true。 */
  act(intent: Intent, ok?: string): Promise<boolean>;
  enterBuild(): void;
  saveNow(): Promise<void>;
  quitToTitle(): void;
  /** 出航（v0.6：预检 → 上船表演 → 发意图）。 */
  sail(islandId: string): Promise<boolean>;
  /** 联机（M2）。 */
  readonly net: NetCtx;
}

/** 菜单里“联机”页需要的操作（M2）。 */
export interface NetCtx {
  role(): 'host' | 'guest';
  lan(): { port: number; addresses: string[] } | null;
  openLan(): Promise<void>;
  steamStatus(): Promise<{ available: boolean; error: string | null; name: string | null; appId: number }>;
  openSteam(): Promise<void>;
  steamLobby(): string | null;
  leave(): void;
}

const me = (ctx: Ctx) => ctx.world().characters[PLAYER_ID]!;
const home = (ctx: Ctx) => ctx.world().homes[PLAYER_ID]!;
const atHome = (ctx: Ctx) => ctx.world().players[PLAYER_ID]!.islandId === homeIslandId(PLAYER_ID);

function costText(ctx: Ctx, cost: { shells: number; items: readonly ItemStack[] }): string {
  return [cost.shells ? `${cost.shells} 云贝` : '', ...cost.items.map((s) => `${itemName(ctx.content, s.item)}×${s.count}`)].filter(Boolean).join('、');
}

function frame(title: string, ctx: Ctx, ...body: Array<HTMLElement | null>): HTMLElement {
  return h('div', { class: 'panel' }, button('关闭 Esc', () => ctx.ui.closeModal(), { class: 'small close-x' }), h('h2', {}, title), ...body.filter((x): x is HTMLElement => !!x));
}

async function doAndRefresh(ctx: Ctx, intent: Intent, ok?: string): Promise<boolean> {
  const r = await ctx.act(intent, ok);
  ctx.ui.refresh();
  return r;
}

// =================================================================== 主菜单

type Tab = 'spirits' | 'bag' | 'codex' | 'orders' | 'net' | 'settings';
const TABS: Array<[Tab, string]> = [
  ['spirits', '絮灵'],
  ['bag', '背包'],
  ['codex', '图鉴'],
  ['orders', '订单'],
  ['net', '联机'],
  ['settings', '设置'],
];

export function openMenu(ctx: Ctx, tab: Tab = 'spirits'): void {
  let current = tab;
  const render = (): HTMLElement => {
    const tabs = h('div', { class: 'tabs' }, ...TABS.map(([id, label]) => button(label, () => ((current = id), ctx.ui.refresh(true)), { class: id === current ? 'selected' : '' })));
    const body = current === 'spirits' ? spiritsTab(ctx) : current === 'bag' ? bagTab(ctx) : current === 'codex' ? codexTab(ctx) : current === 'orders' ? ordersTab(ctx) : current === 'net' ? netTab(ctx) : settingsTab(ctx);
    return frame('菜单', ctx, tabs, body);
  };
  ctx.ui.openModal(render);
}

// ---------------------------------------------------------------- 联机（M2）

let steamInfo: Awaited<ReturnType<NetCtx['steamStatus']>> | null = null;

function netTab(ctx: Ctx): HTMLElement {
  const w = ctx.world();
  const players = Object.values(w.characters).map((c) => {
    const p = w.players[c.id]!;
    const isl = p.islandId.startsWith('home:') ? `${w.characters[p.islandId.slice(5)]?.name ?? ''}的家园岛` : (ctx.content.islands.get(p.islandId)?.name ?? '');
    return h(
      'div',
      { class: 'row', style: 'justify-content:space-between' },
      h('span', {}, h('b', {}, c.name), c.id === w.hostId ? h('span', { class: 'badge', style: 'margin-left:6px' }, '房主') : null, c.id === PLAYER_ID ? h('span', { class: 'muted' }, '（你）') : null),
      h('span', { class: 'muted' }, p.voyage ? '航行中' : isl, p.battleId ? ' · 战斗中' : ''),
    );
  });
  const body = h('div', { class: 'col', style: 'align-items:stretch;gap:10px' }, h('h3', {}, `在线（${players.length}/4）`), ...players);
  if (ctx.net.role() === 'guest') {
    body.append(
      h('div', { class: 'muted' }, `你在 ${w.characters[w.hostId]?.name ?? '房主'} 的世界里。角色会自动存到你自己的电脑上。`),
      button('离开（保存角色）', () => ctx.net.leave()),
    );
    return body;
  }
  const lan = ctx.net.lan();
  body.append(
    h('h3', {}, '局域网 / 直连'),
    lan
      ? h('div', {}, '已开放。让朋友在标题画面点“加入联机”，输入：', ...lan.addresses.map((a) => h('div', { class: 'badge', style: 'margin:4px 6px 0 0' }, `${a}:${lan.port}`)), h('div', { class: 'muted' }, `同一台电脑上测试用 127.0.0.1:${lan.port}`))
      : button('开放局域网联机', async () => {
          await ctx.net.openLan();
          ctx.ui.refresh(true);
        }, { class: 'primary' }),
    h('h3', {}, 'Steam 好友'),
  );
  if (!steamInfo) {
    body.append(h('div', { class: 'muted' }, '正在检查 Steam……'));
    void ctx.net.steamStatus().then((s) => {
      steamInfo = s;
      ctx.ui.refresh(true);
    });
  } else if (!steamInfo.available) {
    body.append(h('div', { class: 'muted' }, steamInfo.error ?? 'Steam 不可用'));
  } else {
    body.append(
      h('div', { class: 'muted' }, `已登录：${steamInfo.name}（开发期使用测试 App ID ${steamInfo.appId}）`),
      button(ctx.net.steamLobby() ? '再次邀请好友' : '创建房间并邀请好友', async () => {
        await ctx.net.openSteam();
        ctx.ui.refresh(true);
      }, { class: 'primary' }),
    );
  }
  return body;
}

// ---------------------------------------------------------------- 絮灵

function spiritCard(ctx: Ctx, s: Spirit, onclick: () => void, selected = false): HTMLElement {
  const f = formOf(ctx.content, s);
  return h(
    'button',
    { class: `spirit-card ${selected ? 'selected' : ''}`, focus: true, onclick, 'data-key': `sp:${s.id}` },
    spiritTitle(ctx.content, s),
    h('div', { class: 'row', style: 'gap:4px;margin-top:3px' }, elementBadges(ctx.content, s), h('span', { class: 'muted' }, f.form.name), h('span', { class: 'tag' }, stateLabel(s))),
  );
}

function spiritsTab(ctx: Ctx): HTMLElement {
  const c = me(ctx);
  const all = Object.values(c.spirits);
  const party = c.party.map((id) => c.spirits[id]!).filter(Boolean);
  const others = all.filter((s) => !c.party.includes(s.id)).sort((a, b) => b.level - a.level);
  const cap = spiritCapacity(ctx.content, home(ctx));
  return h(
    'div',
    {},
    h('div', { class: 'muted' }, `絮灵 ${spiritCount(c)} / ${cap}（队伍 6 + 栖巢 × 4，蛋不占位置）`),
    h('h3', {}, `队伍（${party.length}/6）`),
    party.length ? h('div', { class: 'grid' }, ...party.map((s) => spiritCard(ctx, s, () => openSpirit(ctx, s.id)))) : h('div', { class: 'muted' }, '还没有伙伴。'),
    h('h3', {}, '家园'),
    others.length ? h('div', { class: 'grid' }, ...others.map((s) => spiritCard(ctx, s, () => openSpirit(ctx, s.id)))) : h('div', { class: 'muted' }, '家里还没有絮灵。'),
  );
}

export function openSpirit(ctx: Ctx, id: string): void {
  ctx.ui.openModal(() => spiritDetail(ctx, id));
}

function spiritDetail(ctx: Ctx, id: string): HTMLElement {
  const c = me(ctx);
  const s = c.spirits[id];
  if (!s) return frame('絮灵', ctx, h('div', {}, '它已经不在了。'));
  const content = ctx.content;
  const { form, line } = formOf(content, s);
  const nature = NATURES.find((n) => n.id === s.genes.natureId)!;
  const parts = expressedParts(content, s);
  const world = ctx.world();
  const island = content.islands.get(world.players[PLAYER_ID]!.islandId);
  const weather = weatherAt(world.seed, island?.region ?? 'sunPlains', world.tick);
  const evoBlock = s.state === 'egg' ? '还是一枚蛋' : evolutionBlocker(content, s, { weather, isNight: clockAt(world.tick).isNight });
  const next = line.forms[line.forms.findIndex((f) => f.id === form.id) + 1];

  const info = h(
    'div',
    { class: 'col' },
    h('div', { class: 'row' }, spiritTitle(content, s), elementBadges(content, s), h('span', { class: 'tag' }, stateLabel(s))),
    h('div', { class: 'muted' }, `${line.name} · ${form.name}（${['幼絮', '成灵', '云主形'][line.forms.indexOf(form)]}）· 性格 ${nature.name}${nature.up !== nature.down ? `（${STAT_NAME[nature.up]}↑ ${STAT_NAME[nature.down]}↓）` : '（中性）'} · 体型 ${s.genes.sizePercent}% · 花纹 ${{ plain: '素色', spots: '斑点', stripes: '条纹' }[s.genes.pattern]}`),
    h('div', { class: 'muted' }, `经验 ${s.exp - expForLevel(s.level)} / ${s.level >= 60 ? '—' : expForLevel(s.level + 1) - expForLevel(s.level)}`, conditionText(content, s) ? `  · ${conditionText(content, s)}` : ''),
    statBlock(content, s),
  );

  const partList = h(
    'div',
    { class: 'row' },
    ...PART_SLOTS.map((slot) => {
      const pid = parts[slot];
      const gene = s.genes.parts[slot];
      if (!pid && !gene.partId) return null;
      const name = pid ? content.parts.get(pid)!.name : `${content.parts.get(gene.partId!)!.name}（还没长出来）`;
      return h('span', { class: `tag ${gene.mutated ? 'good' : ''}` }, name, gene.mutated ? ' ✦异化' : '');
    }).filter((x): x is HTMLSpanElement => !!x),
  );

  // 技能：池与装备栏
  const pool = skillPool(content, s);
  const equip = equippableSkills(content, s);
  const passive = passiveSkills(content, s);
  const skills = h(
    'div',
    { class: 'col' },
    ...equip.map((sk) => {
      const def = content.skills.get(sk)!;
      const on = s.skillSlots.includes(sk);
      const el = def.element === 'user' ? line.element : def.element;
      return h(
        'div',
        { class: 'row' },
        button([elementIcon(el, 14), h('b', {}, def.name), h('span', { class: 'muted' }, `云气 ${def.qiCost}${def.power ? ` · 威力 ${def.power}` : ''}`)], () => {
          const next2 = on ? s.skillSlots.filter((x) => x !== sk) : [...s.skillSlots, sk];
          void doAndRefresh(ctx, { type: 'equipSkills', spiritId: s.id, skills: next2 });
        }, { class: on ? 'selected small' : 'small', title: def.description }),
        h('span', { class: 'muted' }, def.description),
      );
    }),
    ...passive.map((sk) => h('div', { class: 'muted' }, `被动「${content.skills.get(sk)!.name}」：${content.skills.get(sk)!.description}`)),
    h('div', { class: 'muted' }, `已装备 ${s.skillSlots.length}/4（点按钮装备 / 卸下；在家园岛才能更换）。技能池共 ${pool.length} 个。轻击、防御不占装备栏。`),
  );

  const actions = h('div', { class: 'row' });
  const inParty = c.party.includes(s.id);
  if (s.state !== 'egg') {
    actions.append(
      button(inParty ? '离开队伍' : '加入队伍', () => {
        const ids = inParty ? c.party.filter((x) => x !== s.id) : [...c.party, s.id];
        void doAndRefresh(ctx, { type: 'setParty', spiritIds: ids });
      }),
    );
  }
  if (next && s.state !== 'egg') {
    actions.append(button(`进化为 ${next.name}`, () => void doAndRefresh(ctx, { type: 'evolve', spiritId: s.id }, `${form.name} 进化成了 ${next.name}！`), { class: evoBlock ? '' : 'primary', disabled: !!evoBlock, title: evoBlock ?? '' }));
    if (evoBlock) actions.append(h('span', { class: 'muted' }, `进化：${evoBlock}`));
  }
  for (const [itemId, n] of Object.entries(c.backpack)) {
    const item = content.items.get(itemId);
    if (item?.food && s.state !== 'egg') actions.append(button(`喂 ${item.name}（${n}）`, () => void doAndRefresh(ctx, { type: 'feed', spiritId: s.id, item: itemId }, item.food!.heal > 0 ? '它恢复了！' : '它吃得很开心')));
    if (item?.teaches && !s.learnedSkills.includes(item.teaches) && s.state !== 'egg') actions.append(button(`学习 ${item.name}`, () => void doAndRefresh(ctx, { type: 'learnBook', spiritId: s.id, item: itemId }, '学会了新技能！')));
  }
  const nameInput = h('input', { type: 'text', value: s.nickname ?? '', placeholder: form.name, maxlength: '16', style: 'width:140px' }) as HTMLInputElement;
  actions.append(nameInput, button('改名', () => void doAndRefresh(ctx, { type: 'rename', spiritId: s.id, name: nameInput.value })));
  if (!isStarter(c, s.id) && s.state !== 'egg') {
    actions.append(
      button('放归', () => {
        ctx.ui.openModal(() =>
          frame('放归', ctx, h('p', {}, `把 ${s.nickname ?? form.name} 送回云海？它会留下一段记忆碎片和 20 云贝。不能撤销。`), h('div', { class: 'row' }, button('确定放归', async () => {
            if (await ctx.act({ type: 'release', spiritId: s.id }, '它回到了云海。')) {
              ctx.ui.closeModal();
              ctx.ui.closeModal();
            }
          }, { class: 'primary' }), button('算了', () => ctx.ui.closeModal()))),
        );
      }),
    );
  }

  const code = s.state === 'egg' ? '' : encodeSpiritCode(content, { genes: s.genes, formId: s.formId, level: s.level });
  return frame(
    s.nickname ?? form.name,
    ctx,
    info,
    h('h3', {}, '零件'),
    partList,
    h('h3', {}, '技能'),
    s.state === 'egg' ? h('div', { class: 'muted' }, `蛋 · 第 ${dayOf(s.readyAtTick)} 天前后孵化`) : skills,
    h('h3', {}, '操作'),
    actions,
    code ? h('div', { class: 'muted', style: 'margin-top:8px' }, '絮灵码：', h('code', { style: 'user-select:text;font-size:15px' }, code), ' ', button('复制', () => void navigator.clipboard?.writeText(code).then(() => ctx.ui.toast('已复制絮灵码')), { class: 'small' })) : null,
  );
}

// ---------------------------------------------------------------- 背包 / 仓库

function itemRow(ctx: Ctx, id: string, n: number, extra: HTMLElement[]): HTMLElement {
  const item = ctx.content.items.get(id);
  return h('div', { class: 'row', style: 'justify-content:space-between;border-bottom:1px dashed #eadbc6;padding:3px 0' }, h('span', {}, h('b', {}, item?.name ?? id), ` × ${n}`, item ? h('span', { class: 'muted' }, `  ${item.description}`) : null), h('span', { class: 'row' }, ...extra));
}

function bagTab(ctx: Ctx): HTMLElement {
  const c = me(ctx);
  const hm = home(ctx);
  const here = atHome(ctx);
  const bag = Object.entries(c.backpack).sort();
  const store = Object.entries(hm.storage).sort();
  return h(
    'div',
    { class: 'col' },
    h('h3', {}, `背包 ${slotsUsed(c.backpack)}/${ECONOMY.backpackSlots} 格`),
    bag.length ? h('div', {}, ...bag.map(([id, n]) => itemRow(ctx, id, n, here ? [button('放进仓库', () => void doAndRefresh(ctx, { type: 'moveItems', item: id, count: n, to: 'storage' }), { class: 'small' })] : []))) : h('div', { class: 'muted' }, '空空的。'),
    h('h3', {}, `仓库 ${slotsUsed(hm.storage)}/${storageCapacity(ctx.content, hm)} 格`, here ? '' : h('span', { class: 'muted' }, '（回到家园岛才能取用）')),
    store.length ? h('div', {}, ...store.map(([id, n]) => itemRow(ctx, id, n, here ? [button('取到背包', () => void doAndRefresh(ctx, { type: 'moveItems', item: id, count: n, to: 'backpack' }), { class: 'small' })] : []))) : h('div', { class: 'muted' }, '空空的。'),
  );
}

// ---------------------------------------------------------------- 图鉴

function codexTab(ctx: Ctx): HTMLElement {
  const c = me(ctx);
  const forms = [...ctx.content.forms.values()].sort((a, b) => a.form.no - b.form.no);
  const caught = new Set(c.codex.caught);
  const seen = new Set(c.codex.seen);
  return h(
    'div',
    {},
    h('div', { class: 'muted' }, `见过 ${seen.size} · 拥有过 ${caught.size} / ${forms.length}。每个物种对应一段旧大地的记忆。`),
    h(
      'div',
      { class: 'grid', style: 'margin-top:8px' },
      ...forms.map((f) => {
        const known = caught.has(f.form.id);
        const glimpsed = seen.has(f.form.id);
        return h(
          'button',
          {
            class: 'spirit-card',
            focus: true,
            'data-key': `codex:${f.form.id}`,
            onclick: () => {
              if (!c.memoryShards.includes(f.form.id)) return;
              ctx.ui.say(`记忆碎片 · ${f.form.memoryShard.title}`, [f.form.memoryShard.text]);
            },
          },
          h('div', { class: 'row' }, h('span', { class: 'muted' }, `No.${String(f.form.no).padStart(3, '0')}`), glimpsed ? elementIcon(f.line.element, 14) : null),
          h('b', {}, glimpsed ? f.form.name : '？？？'),
          h('div', { class: 'muted' }, known ? `记忆碎片：${f.form.memoryShard.title}` : glimpsed ? '见过' : '未知'),
        );
      }),
    ),
  );
}

// ---------------------------------------------------------------- 订单

function ordersTab(ctx: Ctx): HTMLElement {
  const w = ctx.world();
  const today = dayOf(w.tick);
  const orders = w.orders.filter((o) => o.fulfilledBy === null && o.expiresDay >= today);
  const c = me(ctx);
  const hm = home(ctx);
  const have = (item: string) => (c.backpack[item] ?? 0) + (atHome(ctx) ? hm.storage[item] ?? 0 : 0);
  return h(
    'div',
    { class: 'col' },
    h('div', { class: 'muted' }, '商队的订单在家园岛码头交货；守岛人的订单可以在家交，也可以去他们的岛上交。'),
    ...(orders.length
      ? orders.map((o) => {
          const who = o.source === 'caravan' ? '风帆商队' : ctx.content.keepers.get(o.source)?.name ?? o.source;
          const enough = have(o.item) >= o.count;
          return h(
            'div',
            { class: 'row', style: 'justify-content:space-between;border-bottom:1px dashed #eadbc6;padding:4px 0' },
            h('span', {}, h('b', {}, who), `：${itemName(ctx.content, o.item)} × ${o.count}`, h('span', { class: 'muted' }, `（有 ${have(o.item)}）· 第 ${o.expiresDay} 天截止`)),
            h('span', { class: 'row' }, icon('shell'), String(o.reward), button('交货', () => void doAndRefresh(ctx, { type: 'fulfillOrder', orderId: o.id }, `完成订单，获得 ${o.reward} 云贝`), { class: enough ? 'primary small' : 'small', disabled: !enough })),
          );
        })
      : [h('div', { class: 'muted' }, '今天没有新的订单了。')]),
  );
}

// ---------------------------------------------------------------- 设置

function settingsTab(ctx: Ctx): HTMLElement {
  const w = ctx.world();
  const input = h('input', { type: 'text', placeholder: 'XL-XXXX-XXXX-XXXX-XXXX-XXXX', style: 'width:320px' }) as HTMLInputElement;
  return h(
    'div',
    { class: 'col' },
    h('div', { class: 'row' }, button('立即存档', () => void ctx.saveNow().then(() => ctx.ui.toast('已存档'))), button(w.paused ? '继续游戏' : '暂停世界', () => void doAndRefresh(ctx, { type: 'pause', paused: !w.paused }))),
    h('div', { class: 'muted' }, '游戏每到新的一天、以及每分钟会自动存档。世界只在游戏运行时流逝。'),
    h('h3', {}, '导入絮灵码'),
    h('div', { class: 'row' }, input, button('导入', () => void doAndRefresh(ctx, { type: 'importSpirit', code: input.value }, '外来絮灵来到了你的家园（不能繁殖、不能参加剧情战斗）'))),
    h('h3', {}, '离开'),
    h('div', { class: 'row' }, button('存档并回到标题', () => void ctx.saveNow().then(() => ctx.quitToTitle()))),
  );
}

// =================================================================== 建筑

export function openBuilding(ctx: Ctx, buildingId: string): void {
  ctx.ui.openModal(() => buildingPanel(ctx, buildingId));
}

function workerSection(ctx: Ctx, b: BuildingInstance, task: string | null): HTMLElement | null {
  const def = ctx.content.buildings.get(b.type)!;
  const slots = b.built ? def.workSlots : 2;
  if (slots === 0) return null;
  const c = me(ctx);
  const idle = Object.values(c.spirits).filter((s) => s.state === 'idle' && !s.blighted);
  const workers = b.workers.map((id) => c.spirits[id]).filter((s): s is Spirit => !!s);
  const eff = (s: Spirit) => Math.round(workEfficiency(ctx.content, s, (task as never) ?? null) * 100) / 100;
  return h(
    'div',
    { class: 'col' },
    h('h3', {}, b.built ? `工位 ${workers.length}/${slots}` : `帮忙建造 ${workers.length}/${slots}`),
    ...workers.map((s) => h('div', { class: 'row' }, spiritTitle(ctx.content, s), h('span', { class: 'muted' }, `效率 ${eff(s)}`), button('下工', () => void doAndRefresh(ctx, { type: 'unassignWorker', buildingId: b.id, spiritId: s.id }), { class: 'small' }))),
    workers.length < slots
      ? idle.length
        ? h('div', { class: 'row' }, h('span', { class: 'muted' }, '安排：'), ...idle.map((s) => button([h('b', {}, s.nickname ?? formOf(ctx.content, s).form.name), h('span', { class: 'muted' }, `效率 ${eff(s)}`)], () => void doAndRefresh(ctx, { type: 'assignWorker', buildingId: b.id, spiritId: s.id }), { class: 'small' })))
        : h('div', { class: 'muted' }, '没有空闲的絮灵。在菜单里把絮灵移出队伍，它们就会在家里待命。')
      : null,
  );
}

function buildingPanel(ctx: Ctx, id: string): HTMLElement {
  const hm = home(ctx);
  const b = hm.buildings[id];
  if (!b) return frame('建筑', ctx, h('div', {}, '它已经不在了。'));
  const def = ctx.content.buildings.get(b.type)!;
  const c = me(ctx);
  const body: Array<HTMLElement | null> = [h('div', { class: 'muted' }, def.description)];
  if (!b.built) {
    body.push(h('div', {}, `建造进度 ${Math.floor((b.buildProgress / def.buildWork) * 100)}%`, h('span', { class: 'muted' }, b.workers.length ? '' : '（没人帮忙时只能慢慢自建，安排絮灵会快很多）')));
    body.push(workerSection(ctx, b, null));
  } else {
    switch (def.kind) {
      case 'field': {
        if (b.crop) {
          const crop = ctx.content.crops.get(b.crop.cropId)!;
          const pct = Math.min(100, Math.floor((b.crop.progress / crop.growTicks) * 100));
          body.push(h('div', {}, `${itemName(ctx.content, crop.item)}：${pct}%`, h('span', { class: 'muted' }, `（${ELEMENT_INFO[crop.favoredWeather].name}天长得快）`)));
          if (pct >= 100) body.push(button('收获', () => void doAndRefresh(ctx, { type: 'harvest', buildingId: b.id }), { class: 'primary' }));
        } else {
          const seeds = [...ctx.content.items.values()].filter((i) => i.grows && ((c.backpack[i.id] ?? 0) + (hm.storage[i.id] ?? 0)) > 0);
          body.push(h('div', { class: 'row' }, h('span', {}, '种下：'), ...(seeds.length ? seeds.map((sd) => button(`${sd.name}（${(c.backpack[sd.id] ?? 0) + (hm.storage[sd.id] ?? 0)}）`, () => void doAndRefresh(ctx, { type: 'plant', buildingId: b.id, seedItem: sd.id }), { class: 'primary small' })) : [h('span', { class: 'muted' }, '没有种子。码头的商队有卖。')])));
        }
        body.push(h('div', { class: 'muted' }, '安排擅长种植 / 灌溉的絮灵（晴、雨）照料：长得更快，熟了会自动收进仓库，并用仓库里的种子补种。'));
        body.push(workerSection(ctx, b, 'planting'));
        break;
      }
      case 'workshop': {
        if (b.job) {
          const r = ctx.content.recipes.get(b.job.recipeId)!;
          body.push(h('div', { class: 'row' }, `正在做：${itemName(ctx.content, r.output.item)}（还剩 ${b.job.remaining} 件，本件 ${Math.floor((b.job.progress / r.work) * 100)}%）`, button('取消', () => void doAndRefresh(ctx, { type: 'cancelCraft', buildingId: b.id }), { class: 'small' })));
          if (!b.workers.length) body.push(h('div', { class: 'tag warn' }, '没有絮灵在工作，工坊不会动。'));
        }
        const recipes = [...ctx.content.recipes.values()].filter((r) => r.building === b.type);
        body.push(h('h3', {}, '配方'));
        for (const r of recipes) {
          const have = (item: string) => (c.backpack[item] ?? 0) + (hm.storage[item] ?? 0);
          const can = r.inputs.every((i) => have(i.item) >= i.count);
          body.push(
            h(
              'div',
              { class: 'row', style: 'justify-content:space-between' },
              h('span', {}, h('b', {}, `${itemName(ctx.content, r.output.item)}×${r.output.count}`), h('span', { class: 'muted' }, `  ← ${r.inputs.map((i) => `${itemName(ctx.content, i.item)}×${i.count}（有 ${have(i.item)}）`).join(' + ')} · 工作：${{ windmill: '风车', baking: '烘烤', brewing: '酿造', power: '发电', smithing: '锻造', perfumery: '调香', transport: '运输' }[r.task as string] ?? r.task}`)),
              h('span', { class: 'row' }, ...[1, 5].map((n) => button(`做 ${n}`, () => void doAndRefresh(ctx, { type: 'craft', buildingId: b.id, recipeId: r.id, count: n }), { class: 'small', disabled: !!b.job || !can }))),
            ),
          );
        }
        body.push(workerSection(ctx, b, b.job ? ctx.content.recipes.get(b.job.recipeId)!.task : null));
        break;
      }
      case 'nest': {
        body.push(h('div', {}, `絮灵 ${spiritCount(c)} / ${spiritCapacity(ctx.content, hm)}。家园岛上的絮灵恢复生命快一倍。`));
        break;
      }
      case 'hatchery': {
        const egg = b.eggId ? c.spirits[b.eggId] : null;
        if (egg) body.push(h('div', {}, `蛋正在孵化，约第 ${dayOf(egg.readyAtTick)} 天孵出${egg.readyAtTick <= ctx.world().tick ? '（等栖巢有空位）' : ''}。`));
        else body.push(breedingSection(ctx, b));
        break;
      }
      case 'purifyPool': {
        const inPool = b.occupants.map((sid) => c.spirits[sid]).filter((s): s is Spirit => !!s);
        for (const s of inPool) body.push(h('div', {}, spiritTitle(ctx.content, s), h('span', { class: 'muted' }, ` 净化中，第 ${dayOf(s.readyAtTick)} 天完成`)));
        const blighted = Object.values(c.spirits).filter((s) => s.blighted && s.state !== 'purifying');
        if (blighted.length) body.push(h('div', { class: 'row' }, '放进净化池：', ...blighted.map((s) => button(s.nickname ?? formOf(ctx.content, s).form.name, () => void doAndRefresh(ctx, { type: 'purify', buildingId: b.id, spiritId: s.id }, '开始净化，3 天后完成'), { class: 'small' }))));
        else if (!inPool.length) body.push(h('div', { class: 'muted' }, '没有需要净化的絮灵。'));
        break;
      }
      case 'hotSpring':
        body.push(h('div', {}, '家园岛上的絮灵恢复生命快四倍；有温泉时蛋孵化只要 1 天。'));
        break;
      case 'storage':
        body.push(h('div', {}, `仓库容量 ${slotsUsed(hm.storage)}/${storageCapacity(ctx.content, hm)} 格。`));
        body.push(button('打开背包与仓库', () => openMenu(ctx, 'bag')));
        break;
      default:
        break;
    }
  }
  body.push(
    h(
      'div',
      { class: 'row', style: 'margin-top:12px' },
      button('拆除（返还一半材料）', () => {
        ctx.ui.openModal(() =>
          frame('拆除', ctx, h('p', {}, `确定拆除 ${def.name}？`), h('div', { class: 'row' }, button('拆除', async () => {
            if (await ctx.act({ type: 'demolish', buildingId: b.id }, '已拆除')) {
              ctx.ui.closeModal();
              ctx.ui.closeModal();
            }
          }, { class: 'primary' }), button('算了', () => ctx.ui.closeModal()))),
        );
      }, { class: 'small' }),
    ),
  );
  return frame(def.name, ctx, ...body);
}

function breedingSection(ctx: Ctx, b: BuildingInstance): HTMLElement {
  const c = me(ctx);
  const w = ctx.world();
  const sel: string[] = [];
  const candidates = Object.values(c.spirits).filter((s) => s.state !== 'egg' && s.state !== 'purifying');
  const box = h('div', { class: 'col' });
  const status = h('div', { class: 'muted' });
  const go = button('开始繁殖（100 云贝 + 2 份食物）', () => {
    if (sel.length === 2) void doAndRefresh(ctx, { type: 'breed', buildingId: b.id, a: sel[0]!, b: sel[1]! }, '两只絮灵生下了一枚蛋！约 3 天后孵化');
  }, { class: 'primary', disabled: true });
  const update = () => {
    if (sel.length < 2) {
      status.textContent = `选两只同物种、一雄一雌的絮灵（已选 ${sel.length}）`;
      go.setAttribute('aria-disabled', 'true');
      return;
    }
    const why = breedBlocker(ctx.content, c.spirits[sel[0]!]!, c.spirits[sel[1]!]!, w.tick);
    status.textContent = why ?? '可以繁殖。后代会遗传双亲的零件、资质与配色。';
    if (why) go.setAttribute('aria-disabled', 'true');
    else go.removeAttribute('aria-disabled');
  };
  const grid = h('div', { class: 'grid' });
  for (const s of candidates) {
    const card = spiritCard(ctx, s, () => {
      const i = sel.indexOf(s.id);
      if (i >= 0) sel.splice(i, 1);
      else {
        if (sel.length >= 2) sel.shift();
        sel.push(s.id);
      }
      for (const el of grid.children) el.classList.toggle('selected', sel.includes((el as HTMLElement).dataset['key']!.slice(3)));
      update();
    });
    grid.append(card);
  }
  update();
  box.append(status, grid, h('div', { class: 'row' }, go));
  return box;
}

// =================================================================== 岛核 / 码头 / 星图

export function openCore(ctx: Ctx): void {
  ctx.ui.openModal(() => {
    const hm = home(ctx);
    const c = me(ctx);
    const body: HTMLElement[] = [
      h('div', {}, `岛核 ${hm.coreLevel} 级 · 建筑位 ${buildingsUsed(ctx.content, hm)}/${buildingSlots(hm)} · 仓库 ${storageCapacity(ctx.content, hm)} 格`),
    ];
    if (hm.coreLevel < ECONOMY.maxCoreLevel) {
      const cost = coreUpgradeCost(hm.coreLevel);
      body.push(h('div', { class: 'row' }, button(`升级到 ${hm.coreLevel + 1} 级`, () => void doAndRefresh(ctx, { type: 'upgradeCore' }), { class: 'primary' }), h('span', { class: 'muted' }, costText(ctx, cost)), h('span', { class: 'muted' }, '：岛会长大，建筑位 +3，解锁新建筑')));
    }
    body.push(h('h3', {}, '工具'));
    for (const tool of ['lantern', 'skiff', 'gatherTool'] as ToolKind[]) {
      const lv = c.tools[tool];
      const desc = tool === 'lantern' ? '能进入的雾浓度上限' : tool === 'skiff' ? '能到达的航程与航行速度' : '每次采集的数量';
      body.push(
        h(
          'div',
          { class: 'row' },
          h('b', {}, `${TOOL_NAME[tool]} ${lv} 级`),
          h('span', { class: 'muted' }, desc),
          lv < 5 ? button(`升级（${costText(ctx, toolUpgradeCost(tool, lv))}）`, () => void doAndRefresh(ctx, { type: 'upgradeTool', tool }), { class: 'small' }) : h('span', { class: 'tag good' }, '最高级'),
        ),
      );
    }
    return frame('岛核', ctx, ...body);
  });
}

export function openDock(ctx: Ctx, openChart: () => void): void {
  let tab: 'orders' | 'buy' | 'sell' | 'blueprints' = 'orders';
  ctx.ui.openModal(() => {
    const c = me(ctx);
    const hm = home(ctx);
    const tabs = h(
      'div',
      { class: 'tabs' },
      ...(
        [
          ['orders', '订单板'],
          ['buy', '商队商品'],
          ['blueprints', '蓝图'],
          ['sell', '卖给商队'],
        ] as const
      ).map(([id, label]) => button(label, () => ((tab = id), ctx.ui.refresh(true)), { class: tab === id ? 'selected' : '' })),
      button('星图 · 出航', () => {
        ctx.ui.closeModal();
        openChart();
      }, { class: 'primary' }),
    );
    let body: HTMLElement;
    if (tab === 'orders') body = ordersTab(ctx);
    else if (tab === 'buy') {
      body = h(
        'div',
        { class: 'col' },
        ...[...ctx.content.items.values()]
          .filter((i) => i.buyPrice)
          .map((i) =>
            h(
              'div',
              { class: 'row', style: 'justify-content:space-between' },
              h('span', {}, h('b', {}, i.name), h('span', { class: 'muted' }, `  ${i.description}`)),
              h('span', { class: 'row' }, icon('shell'), String(i.buyPrice), ...[1, 5].map((n) => button(`买 ${n}`, () => void doAndRefresh(ctx, { type: 'buy', item: i.id, count: n }), { class: 'small', disabled: c.shells < i.buyPrice! * n }))),
            ),
          ),
      );
    } else if (tab === 'blueprints') {
      body = h(
        'div',
        { class: 'col' },
        ...BLUEPRINT_SHOP.map((bp) => {
          const def = ctx.content.buildings.get(bp.blueprint)!;
          const owned = c.blueprints.includes(bp.blueprint);
          return h(
            'div',
            { class: 'row', style: 'justify-content:space-between' },
            h('span', {}, h('b', {}, def.name), h('span', { class: 'muted' }, `  ${def.description}（岛核 ${def.coreLevel} 级可建）`)),
            owned ? h('span', { class: 'tag good' }, '已拥有') : h('span', { class: 'row' }, icon('shell'), String(bp.price), button('购买', () => void doAndRefresh(ctx, { type: 'buyBlueprint', building: bp.blueprint }, `获得蓝图：${def.name}`), { class: 'small', disabled: c.shells < bp.price })),
          );
        }),
      );
    } else {
      const all = new Map<string, number>();
      for (const [k, v] of Object.entries(c.backpack)) all.set(k, (all.get(k) ?? 0) + v);
      for (const [k, v] of Object.entries(hm.storage)) all.set(k, (all.get(k) ?? 0) + v);
      body = h(
        'div',
        { class: 'col' },
        ...[...all.entries()]
          .filter(([id]) => (ctx.content.items.get(id)?.sellPrice ?? 0) > 0)
          .map(([id, n]) => {
            const p = ctx.content.items.get(id)!.sellPrice;
            return h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', {}, h('b', {}, itemName(ctx.content, id)), ` × ${n}`), h('span', { class: 'row' }, icon('shell'), `${p}/个`, ...[1, Math.min(10, n), n].filter((x, i, a) => a.indexOf(x) === i).map((k) => button(`卖 ${k}`, () => void doAndRefresh(ctx, { type: 'sell', item: id, count: k }, `卖出，得到 ${p * k} 云贝`), { class: 'small' }))));
          }),
      );
    }
    return frame('码头 · 风帆商队', ctx, tabs, body);
  });
}

export function openStarChart(ctx: Ctx): void {
  ctx.ui.openModal(() => {
    const w = ctx.world();
    const c = me(ctx);
    const p = w.players[PLAYER_ID]!;
    const chart = h('div', { class: 'chart' });
    const place = (x: number, y: number, el: HTMLElement) => {
      el.style.left = `${x * 100}%`;
      el.style.top = `${y * 100}%`;
      chart.append(el);
    };
    place(
      HOME_CHART_POS.x,
      HOME_CHART_POS.y,
      h('div', { class: 'isle' }, button([h('b', {}, '家园岛'), h('span', { class: 'muted' }, '中枢群岛')], () => void sail(ctx, 'home'), { class: p.islandId === homeIslandId(PLAYER_ID) ? 'selected' : '' })),
    );
    for (const isl of ctx.content.islands.values()) {
      const weather = weatherAt(w.seed, isl.region, w.tick);
      const blocked = c.tools.lantern < isl.fogLevel ? `需要 ${isl.fogLevel} 级提灯` : c.tools.skiff < isl.skiffLevel ? `需要 ${isl.skiffLevel} 级云舟` : '';
      const fuel = isl.fogLevel > 0 ? `燃料 ${isl.fogLevel}` : '无雾';
      const keeper = isl.keeper ? ctx.content.keepers.get(isl.keeper)!.name : '';
      place(
        isl.chartPos.x,
        isl.chartPos.y,
        h(
          'div',
          { class: 'isle' },
          button(
            [h('span', { class: 'row', style: 'gap:3px' }, elementIcon(weather, 14), h('b', {}, isl.name)), h('span', { class: 'muted' }, keeper ? `守岛人 ${keeper}` : `Lv.${isl.wildLevel.min}–${isl.wildLevel.max}`), h('span', { class: 'muted' }, blocked || fuel)],
            () => void sail(ctx, isl.id),
            { class: p.islandId === isl.id ? 'selected' : '', disabled: !!blocked, title: isl.description },
          ),
        ),
      );
    }
    const fc = forecast(w.seed, 'sunPlains', w.tick).map((f) => `${dayOf(f.from) === dayOf(w.tick) ? '今天' : '明天'}起 ${ELEMENT_INFO[f.weather].name}`);
    return frame(
      '星图',
      ctx,
      h('div', { class: 'muted' }, `${REGION_NAME.sunPlains}天气预报：${fc.join(' → ')}。有雾的岛需要提灯燃料，雾浓度高于提灯等级就进不去。`),
      chart,
    );
  });
}

async function sail(ctx: Ctx, islandId: string): Promise<void> {
  await ctx.sail(islandId);
}

// =================================================================== 守岛人

export function openKeeper(ctx: Ctx, keeperId: string): void {
  ctx.ui.openModal(() => {
    const def = ctx.content.keepers.get(keeperId)!;
    const k = ctx.world().keepers[keeperId]!;
    const points = k.affinity[PLAYER_ID] ?? 0;
    const lv = affinityLevel(points);
    const c = me(ctx);
    const story = nextStoryNode(ctx.content, ctx.world(), k, PLAYER_ID);
    const giftable = Object.entries(c.backpack).filter(([id]) => (ctx.content.items.get(id)?.sellPrice ?? 0) > 0 || ctx.content.items.get(id)?.category === 'food');
    const giftedToday = k.lastGiftDay[PLAYER_ID] === dayOf(ctx.world().tick);
    const foughtToday = k.lastBattleDay[PLAYER_ID] === dayOf(ctx.world().tick);
    const orders = ctx.world().orders.filter((o) => o.source === keeperId && o.fulfilledBy === null && o.expiresDay >= dayOf(ctx.world().tick));
    return frame(
      def.name,
      ctx,
      h('div', { class: 'row' }, h('span', { style: 'color:#e07a5f' }, ...Array.from({ length: 5 }, (_, i) => icon('heart', 16)).map((x, i) => ((x.style.opacity = i < lv ? '1' : '.25'), x))), h('span', { class: 'muted' }, `好感 ${lv} 级（${points} 点）· ${def.personality.join('、')} · 喜欢${ELEMENT_INFO[def.favoriteElement].name}属性`), elementBadge(def.favoriteElement)),
      h('div', { class: 'muted' }, `心愿：${def.goal}`),
      h('div', { class: 'muted' }, `今天在忙：${{ farm: '种田', build: '修房子', train: '训练絮灵', visit: '串门', postOrder: '发订单', explore: '出海', rest: '休息' }[k.goal]}`),
      h(
        'div',
        { class: 'row', style: 'margin-top:8px' },
        button(story ? `聊聊（${story.title}）` : '聊聊', () => {
          ctx.ui.closeModal();
          void ctx.act({ type: 'talk', keeperId });
        }, { class: 'primary' }),
        button(foughtToday ? '今天已经比过了' : '比一场', () => {
          ctx.ui.closeModal();
          void ctx.act({ type: 'challenge', keeperId });
        }, { disabled: foughtToday }),
      ),
      h('h3', {}, `送礼${giftedToday ? '（今天已经送过，好感不会再增加）' : ''}`),
      giftable.length ? h('div', { class: 'row' }, ...giftable.map(([id, n]) => button(`${itemName(ctx.content, id)}（${n}）`, () => {
        ctx.ui.closeModal();
        void ctx.act({ type: 'gift', keeperId, item: id });
      }, { class: 'small' }))) : h('div', { class: 'muted' }, '背包里没有能送的东西。'),
      orders.length ? h('h3', {}, '委托') : null,
      ...orders.map((o) => h('div', { class: 'row' }, `${itemName(ctx.content, o.item)} × ${o.count}`, icon('shell'), String(o.reward), button('交货', () => void doAndRefresh(ctx, { type: 'fulfillOrder', orderId: o.id }, `${def.name}很高兴！`), { class: 'small' }))),
    );
  });
}

