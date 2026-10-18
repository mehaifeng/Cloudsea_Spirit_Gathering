import { app, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { chatComplete, LlmBudget, type ChatMessage, type ChatResult } from './llmClient';
import { LlmStore, type LlmPatch, type LlmPublicSettings, type SecretBox } from './llmStore';

/**
 * 灵性模式的 IPC（M3-4）：渲染进程只拿到“有没有 key”，发出去的是消息列表，回来的是回复正文。
 * key 只在主进程里读出、只发往玩家配置的地址（DESIGN 11.5，铁律 8）。
 */
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 6000;
const MAX_TOKENS = 400;

/**
 * 自动化测试（CLOUDSEA_TEST=1）不碰系统钥匙串（macOS 会弹授权框）：换成可逆的测试加密。
 * 正式运行一律用 safeStorage。
 */
const testBox: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((x) => x ^ 0xa5)),
  decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0xa5)).toString('utf8'),
};

export function registerLlmIpc(): void {
  const store = new LlmStore(join(app.getPath('userData'), 'llm'), process.env['CLOUDSEA_TEST'] === '1' ? testBox : safeStorage);
  const budget = new LlmBudget();

  ipcMain.handle('llm:get', (): Promise<LlmPublicSettings> => store.publicSettings());
  ipcMain.handle('llm:set', async (_e, patch: LlmPatch): Promise<{ ok: boolean; error?: string }> => {
    const err = await store.save(patch ?? {});
    return err ? { ok: false, error: err } : { ok: true };
  });
  const call = async (messages: readonly ChatMessage[], maxTokens: number, gameDay: number | null): Promise<ChatResult> => {
    const s = await store.settings();
    const key = await store.key();
    if (!key) return { ok: false, error: '还没有填 API key' };
    if (gameDay !== null) {
      if (!s.enabled) return { ok: false, error: '灵性模式没有打开' };
      const why = budget.take(gameDay, s.dailyLimit, Date.now());
      if (why) return { ok: false, error: why };
    }
    return chatComplete({ baseUrl: s.baseUrl, apiKey: key, model: s.model, messages, maxTokens, timeoutMs: s.timeoutMs });
  };
  ipcMain.handle('llm:test', () => call([{ role: 'user', content: '请只回复 JSON：{"ok":true}' }], 20, null));
  ipcMain.handle('llm:chat', (_e, req: { day: number; messages: ChatMessage[]; maxTokens?: number }): Promise<ChatResult> => {
    const messages = Array.isArray(req?.messages) ? req.messages.slice(0, MAX_MESSAGES) : [];
    const valid = messages.every((m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= MAX_MESSAGE_CHARS);
    if (!messages.length || !valid) return Promise.resolve({ ok: false, error: '请求格式不对' });
    return call(messages, Math.min(MAX_TOKENS, Math.max(16, Math.floor(req.maxTokens ?? 200))), Math.floor(Number(req.day) || 0));
  });
}
