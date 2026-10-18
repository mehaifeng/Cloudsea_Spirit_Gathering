import { ELEMENT_INFO, PLANNER_GOALS, type ContentDb } from '@cloudsea/content';
import { clockAt, dayOf, goalWeights, weatherAt, type Intent, type WorldEvent, type WorldState } from '@cloudsea/sim';
import { parsePlan, parseSummary, parseTalk } from './parse';
import { planMessages, summaryMessages, talkMessages, type ChatMessage } from './prompts';

export type ChatFn = (req: { day: number; messages: ChatMessage[]; maxTokens: number }) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;

/**
 * 灵性模式的调度（房主端，M3-4）：sim 发出请求事件，这里调 LLM，结果整理成房主意图交回 sim 校验。
 * 任何失败都回退：对话立刻用对话库的那句（不等超时），计划与摘要交给 sim 的超时 / 截断处理。
 * 战斗决策永远不经过这里（铁律 6）。
 */
export class SpiritDirector {
  /** 最近一次失败的原因（设置界面显示）。 */
  lastError: string | null = null;
  calls = 0;
  fallbacks = 0;

  constructor(
    private readonly content: ContentDb,
    private readonly chat: ChatFn,
    private readonly world: () => Readonly<WorldState>,
    private readonly send: (intent: Intent) => Promise<unknown>,
  ) {}

  /** 处理一批世界事件（等所有请求都有结果）。 */
  async handle(events: readonly WorldEvent[]): Promise<void> {
    const jobs: Array<Promise<void>> = [];
    for (const e of events) {
      if (e.t === 'keeperTalkRequest') jobs.push(this.talk(e));
      else if (e.t === 'keeperPlanRequest') jobs.push(this.plan(e.keeperId));
      else if (e.t === 'keeperSummaryRequest') jobs.push(this.summarize(e.keeperId));
    }
    await Promise.all(jobs);
  }

  private async ask(messages: ChatMessage[], maxTokens: number): Promise<string | null> {
    this.calls++;
    const r = await this.chat({ day: dayOf(this.world().tick), messages, maxTokens });
    if (!r.ok) {
      this.lastError = r.error;
      return null;
    }
    return r.content;
  }

  private async talk(e: Extract<WorldEvent, { t: 'keeperTalkRequest' }>): Promise<void> {
    const w = this.world();
    const k = w.keepers[e.keeperId];
    const def = this.content.keepers.get(e.keeperId);
    if (!k || !def) return;
    const examples = this.content.dialogue.filter((d) => d.keeper === def.id && d.situation === e.situation && (d.minAffinity ?? 0) <= e.level && e.level <= (d.maxAffinity ?? 5));
    const reply = await this.ask(
      talkMessages({
        keeper: def,
        situation: e.situation,
        affinityLevel: e.level,
        playerName: w.characters[e.playerId]?.name ?? '守岛人',
        weather: ELEMENT_INFO[weatherAt(w.seed, def.region, w.tick)].name,
        isNight: clockAt(w.tick).isNight,
        memory: k.memory,
        summary: k.summary,
        examples,
      }),
      160,
    );
    const text = reply === null ? null : parseTalk(reply);
    if (text === null) {
      this.fallbacks++;
      if (reply !== null) this.lastError = '回复不合格，用了对话库';
    }
    await this.send({ type: 'keeperSay', keeperId: e.keeperId, playerId: e.playerId, text: text ?? e.fallback, generated: text !== null });
  }

  private async plan(keeperId: string): Promise<void> {
    const w = this.world();
    const k = w.keepers[keeperId];
    const def = this.content.keepers.get(keeperId);
    if (!k || !def) return;
    const weights = goalWeights(this.content, w as WorldState, k);
    const allowed = PLANNER_GOALS.filter((_, i) => weights[i]! > 0);
    const reply = await this.ask(planMessages({ keeper: def, day: dayOf(w.tick), weather: ELEMENT_INFO[weatherAt(w.seed, def.region, w.tick)].name, allowed, memory: k.memory, summary: k.summary }), 120);
    const plan = reply === null ? null : parsePlan(reply);
    if (!plan || !allowed.includes(plan.goal)) {
      this.fallbacks++;
      return; // sim 超时后用默认规划
    }
    await this.send({ type: 'keeperPlan', keeperId, goal: plan.goal, ...(plan.note ? { note: plan.note } : {}) });
  }

  private async summarize(keeperId: string): Promise<void> {
    const w = this.world();
    const k = w.keepers[keeperId];
    const def = this.content.keepers.get(keeperId);
    if (!k || !def) return;
    const reply = await this.ask(summaryMessages(def, k.summary, k.memory), 400);
    const summary = reply === null ? null : parseSummary(reply);
    if (summary === null) {
      this.fallbacks++;
      return;
    }
    await this.send({ type: 'keeperSummary', keeperId, summary });
  }
}
