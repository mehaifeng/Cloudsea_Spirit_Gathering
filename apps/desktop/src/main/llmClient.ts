/**
 * 灵性模式的 LLM 客户端（主进程，M3-4）：OpenAI Chat Completions 兼容协议（DESIGN 11.5）。
 * 不依赖 Electron，便于用本地假服务器测试。API key 只在这里和 llmStore 里出现（铁律 8）：
 * 不写日志，错误信息里出现 key 一律抹掉。
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly temperature?: number;
}

export type ChatResult = { readonly ok: true; readonly content: string } | { readonly ok: false; readonly error: string };

/** 回复正文上限：再长就当作出错（防止失控的输出进到游戏里）。 */
export const MAX_REPLY_CHARS = 4000;
const MAX_BODY_BYTES = 256 * 1024;

export function chatUrl(baseUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return `${u.toString().replace(/\/+$/, '')}/chat/completions`;
}

export function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join('***') : text;
}

export async function chatComplete(req: ChatRequest, fetchImpl: typeof fetch = fetch): Promise<ChatResult> {
  const url = chatUrl(req.baseUrl);
  if (!url) return { ok: false, error: '服务地址无效（需要 http:// 或 https:// 开头）' };
  if (!req.apiKey) return { ok: false, error: '还没有填 API key' };
  if (!req.model.trim()) return { ok: false, error: '还没有填模型名' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({ model: req.model.trim(), messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature ?? 0.8 }),
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) return { ok: false, error: '回复太长' };
    if (!res.ok) return { ok: false, error: scrub(`服务返回 ${res.status}：${body.slice(0, 200)}`, req.apiKey) };
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, error: '服务返回的不是 JSON' };
    }
    const content = (json as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return { ok: false, error: '回复里没有内容' };
    if (content.length > MAX_REPLY_CHARS) return { ok: false, error: '回复太长' };
    return { ok: true, content };
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, error: '请求超时' };
    return { ok: false, error: scrub(`请求失败：${(e as Error).message}`, req.apiKey) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 预算（DESIGN 11.5）：每个游戏日的调用上限 + 每分钟上限（防止游戏加速或出错时刷爆账单）。
 */
export class LlmBudget {
  private day = -1;
  private usedToday = 0;
  private recent: number[] = [];

  constructor(private readonly perMinute = 20) {}

  /** 能用就记一次并返回 null，否则返回原因。now 为毫秒时间戳。 */
  take(gameDay: number, dailyLimit: number, now: number): string | null {
    if (gameDay !== this.day) {
      this.day = gameDay;
      this.usedToday = 0;
    }
    this.recent = this.recent.filter((t) => now - t < 60_000);
    if (this.usedToday >= dailyLimit) return '今天的调用次数用完了';
    if (this.recent.length >= this.perMinute) return '调用太频繁，稍后再试';
    this.usedToday++;
    this.recent.push(now);
    return null;
  }

  get used(): number {
    return this.usedToday;
  }
}
