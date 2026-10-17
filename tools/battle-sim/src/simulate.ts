import { ELEMENT_BOOK_SKILL, type ContentDb, type Element } from '@cloudsea/content';
import {
  chooseActions,
  createBattle,
  createRng,
  createSpirit,
  deriveSeed,
  generateWildGenes,
  resolveTurn,
  type AiOptions,
  type BattleState,
  type Rng,
  type Spirit,
} from '@cloudsea/sim';

export interface MatchConfig {
  readonly level: number;
  readonly teamSize: number;
  readonly ai: readonly [Omit<AiOptions, 'seed'>, Omit<AiOptions, 'seed'>];
  readonly maxTurns: number;
}

export interface MatchResult {
  readonly winner: 0 | 1 | null;
  readonly turns: number;
  /** 每只被击倒的絮灵从上场到倒下经历的回合数。 */
  readonly turnsToKo: number[];
  readonly lines: readonly [string[], string[]];
  readonly skillUses: Record<string, number>;
  readonly timedOut: boolean;
}

/** 按等级选进化段：按该线自己的进化等级（三段线 16 / 36，两段线 30，M3）。 */
export function formIndexForLevel(level: number, line?: { forms: readonly { evolution?: { level: number } | undefined }[] }): number {
  if (!line) return level < 16 ? 0 : level < 36 ? 1 : 2;
  let i = 0;
  while (i < line.forms.length - 1 && level >= line.forms[i]!.evolution!.level) i++;
  return i;
}

export function randomTeam(content: ContentDb, rng: Rng, size: number, level: number, side: number): Spirit[] {
  const lines = [...content.lines.values()];
  return Array.from({ length: size }, (_, i) => {
    const line = rng.pick(lines);
    const spirit = createSpirit(content, {
      id: `s${side}-${i}`,
      ownerId: `side${side}`,
      genes: generateWildGenes(rng, line),
      level,
      formIndex: formIndexForLevel(level, line),
    });
    // 10 级以上视为已学会本属性技能书（中期队伍的典型配置）
    if (level < 10) return spirit;
    const book = ELEMENT_BOOK_SKILL[line.element];
    const learned = { ...spirit, learnedSkills: [book] };
    const slots = [book, ...spirit.skillSlots.filter((s) => s !== book)].slice(0, 4);
    return { ...learned, skillSlots: slots };
  });
}

export function runMatch(content: ContentDb, seed: number, cfg: MatchConfig, weather: Element | null): MatchResult {
  const rng = createRng(seed);
  const teams = [randomTeam(content, rng, cfg.teamSize, cfg.level, 0), randomTeam(content, rng, cfg.teamSize, cfg.level, 1)] as const;
  let state: BattleState = createBattle(content, {
    kind: 'friendly',
    sides: [{ spirits: teams[0] }, { spirits: teams[1] }],
    baseWeather: weather,
    seed: deriveSeed(seed, 'battle'),
  });
  const entered = new Map<string, number>();
  for (const sd of state.sides) for (const i of sd.active) if (i !== null) entered.set(sd.units[i]!.uid, 1);
  const turnsToKo: number[] = [];
  const skillUses: Record<string, number> = {};
  for (let t = 0; t < cfg.maxTurns && !state.outcome; t++) {
    const a = chooseActions(content, state, 0, { ...cfg.ai[0], seed: deriveSeed(seed, 'ai0') });
    const b = chooseActions(content, state, 1, { ...cfg.ai[1], seed: deriveSeed(seed, 'ai1') });
    const turn = state.turn;
    const r = resolveTurn(content, state, [a, b]);
    for (const e of r.events) {
      if (e.t === 'use') skillUses[e.skillId] = (skillUses[e.skillId] ?? 0) + 1;
      if (e.t === 'downed') turnsToKo.push(turn - (entered.get(e.target) ?? turn) + 1);
      if (e.t === 'switch') entered.set(e.in, r.state.turn === turn ? turn : turn + 1);
    }
    state = r.state;
  }
  return {
    winner: state.outcome ? state.outcome.winner : null,
    turns: state.turn,
    turnsToKo,
    lines: [teams[0].map((s) => s.genes.lineId), teams[1].map((s) => s.genes.lineId)],
    skillUses,
    timedOut: !state.outcome,
  };
}

export interface Report {
  readonly level: number;
  readonly matches: number;
  readonly avgTurns: number;
  readonly timeoutRate: number;
  readonly avgTurnsToKo: number;
  readonly medianTurnsToKo: number;
  /** 每条进化线：所在队伍的胜率（按出场次数加权）。 */
  readonly lineWinRate: Record<string, number>;
  readonly skillShare: Record<string, number>;
}

export function summarize(content: ContentDb, level: number, results: readonly MatchResult[]): Report {
  const ko = results.flatMap((r) => r.turnsToKo).sort((a, b) => a - b);
  const lineStats = new Map<string, { wins: number; games: number }>();
  for (const r of results) {
    r.lines.forEach((team, side) => {
      for (const l of team) {
        const s = lineStats.get(l) ?? { wins: 0, games: 0 };
        s.games++;
        if (r.winner === side) s.wins++;
        lineStats.set(l, s);
      }
    });
  }
  const uses: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.skillUses)) uses[k] = (uses[k] ?? 0) + v;
  const totalUses = Object.values(uses).reduce((a, b) => a + b, 0) || 1;
  return {
    level,
    matches: results.length,
    avgTurns: avg(results.map((r) => r.turns)),
    timeoutRate: results.filter((r) => r.timedOut).length / results.length,
    avgTurnsToKo: avg(ko),
    medianTurnsToKo: ko[Math.floor(ko.length / 2)] ?? 0,
    lineWinRate: Object.fromEntries([...content.lines.keys()].map((l) => [l, (lineStats.get(l)?.wins ?? 0) / (lineStats.get(l)?.games || 1)])),
    skillShare: Object.fromEntries(Object.entries(uses).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v / totalUses])),
  };
}

function avg(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
