import { setUserBlocked, blockLine, type ChatFn } from '@cloudsea/ai';

/** 主进程里灵性模式设置的公开部分（没有 key，只有“有没有”，铁律 8）。 */
export interface LlmPublicSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly dailyLimit: number;
  readonly timeoutMs: number;
  readonly hasKey: boolean;
  readonly encryption: boolean;
}

export interface LlmBridge {
  get(): Promise<LlmPublicSettings>;
  set(patch: Partial<Omit<LlmPublicSettings, 'hasKey' | 'encryption'>> & { apiKey?: string | null }): Promise<{ ok: boolean; error?: string }>;
  test(): Promise<{ ok: true; content: string } | { ok: false; error: string }>;
  chat: ChatFn;
}

/** 桌面版才有；网页试玩版没有灵性模式。 */
export function llmBridge(): LlmBridge | null {
  return (window as unknown as { cloudsea?: { llm?: LlmBridge } }).cloudsea?.llm ?? null;
}

/** 玩家屏蔽过的生成句子（本机记住，DESIGN 11.6）。 */
const BLOCK_KEY = 'cloudsea.blockedLines';

function readBlocked(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(BLOCK_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function loadBlockedLines(): void {
  setUserBlocked(readBlocked());
}

export function rememberBlocked(text: string): void {
  blockLine(text);
  const all = [...new Set([...readBlocked(), text])].slice(-500);
  try {
    localStorage.setItem(BLOCK_KEY, JSON.stringify(all));
  } catch {
    /* 存不下也不影响这一局 */
  }
}

/** Steam 成就（M4-1）：桌面版才有；没有 Steam 时主进程返回 false。 */
export function achievementBridge(): { unlock(apiName: string): Promise<boolean> } | null {
  return (window as unknown as { cloudsea?: { achievements?: { unlock(apiName: string): Promise<boolean> } } }).cloudsea?.achievements ?? null;
}
