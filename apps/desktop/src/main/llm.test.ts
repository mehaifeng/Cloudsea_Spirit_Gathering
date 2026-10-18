import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatComplete, chatUrl, LlmBudget, MAX_REPLY_CHARS } from './llmClient';
import { LlmStore, type SecretBox } from './llmStore';

const KEY = 'sk-test-SECRET-1234567890';

/** 本地假服务器：按 path 决定行为。 */
let server: Server;
let base = '';
const seen: Array<{ url: string; auth: string; body: string }> = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ url: req.url ?? '', auth: String(req.headers['authorization'] ?? ''), body });
    const reply = (content: string) => res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    if (req.url?.startsWith('/ok/')) return reply('{"text":"你好呀"}');
    if (req.url?.startsWith('/slow/')) return setTimeout(() => reply('{"text":"太慢了"}'), 1500);
    if (req.url?.startsWith('/badjson/')) return res.end('<html>oops</html>');
    if (req.url?.startsWith('/long/')) return reply('啊'.repeat(MAX_REPLY_CHARS + 1));
    if (req.url?.startsWith('/echo-key/')) {
      res.statusCode = 401;
      return res.end(`invalid key ${KEY}`);
    }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const req = (path: string, timeoutMs = 1000) => ({ baseUrl: `${base}${path}`, apiKey: KEY, model: 'fake-model', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 50, timeoutMs });

describe('LLM 客户端（主进程，M3-4）', () => {
  it('成功：按 Chat Completions 协议发到 base_url/chat/completions，带 Bearer key', async () => {
    const r = await chatComplete(req('/ok/v1/'));
    expect(r).toEqual({ ok: true, content: '{"text":"你好呀"}' });
    const last = seen.at(-1)!;
    expect(last.url).toBe('/ok/v1/chat/completions');
    expect(last.auth).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(last.body)).toMatchObject({ model: 'fake-model', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('超时、非 JSON、超长、服务报错都返回失败（由调用方回退）；错误信息里不出现 key', async () => {
    expect(await chatComplete(req('/slow/', 300))).toEqual({ ok: false, error: '请求超时' });
    expect(await chatComplete(req('/badjson/'))).toEqual({ ok: false, error: '服务返回的不是 JSON' });
    expect(await chatComplete(req('/long/'))).toEqual({ ok: false, error: '回复太长' });
    const bad = await chatComplete(req('/echo-key/'));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(KEY);
    expect(JSON.stringify(bad)).toContain('***');
    const refused = await chatComplete({ ...req('/ok/'), baseUrl: 'http://127.0.0.1:1' });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(KEY);
  });

  it('地址只认 http / https；没有 key 或模型不发请求', async () => {
    expect(chatUrl('file:///etc/passwd')).toBeNull();
    expect(chatUrl('not a url')).toBeNull();
    const n = seen.length;
    expect((await chatComplete({ ...req('/ok/'), apiKey: '' })).ok).toBe(false);
    expect((await chatComplete({ ...req('/ok/'), model: ' ' })).ok).toBe(false);
    expect((await chatComplete({ ...req('/ok/'), baseUrl: 'ftp://x' })).ok).toBe(false);
    expect(seen.length).toBe(n);
  });

  it('预算：每个游戏日上限、每分钟上限；换一天重新计', () => {
    const b = new LlmBudget(5);
    for (let i = 0; i < 3; i++) expect(b.take(1, 3, 1000 + i)).toBeNull();
    expect(b.take(1, 3, 2000)).toMatch(/用完/);
    expect(b.take(2, 10, 3000)).toBeNull();
    expect(b.take(2, 10, 3001)).toBeNull();
    expect(b.take(2, 10, 3002)).toMatch(/频繁/);
    expect(b.take(2, 10, 3000 + 61_000)).toBeNull();
  });
});

describe('key 的本地存储（M3-4，铁律 8）', () => {
  // 假的系统加密：可逆但不是明文
  const box: SecretBox = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from([...Buffer.from(s, 'utf8')].map((x) => x ^ 0x5a)),
    decryptString: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8'),
  };

  it('key 加密保存、设置里不含 key；对外的设置只说“有没有 key”', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudsea-llm-'));
    const store = new LlmStore(dir, box);
    expect(await store.save({ enabled: true, baseUrl: 'http://x/v1', model: 'm', apiKey: KEY })).toBeNull();
    expect(await store.key()).toBe(KEY);
    for (const f of await readdir(dir)) expect((await readFile(join(dir, f))).toString('utf8'), f).not.toContain(KEY);
    const pub = await store.publicSettings();
    expect(pub).toMatchObject({ enabled: true, hasKey: true, model: 'm' });
    expect(JSON.stringify(pub)).not.toContain(KEY);
    // 不传 apiKey = 不动；null = 删除
    await store.save({ model: 'm2' });
    expect(await store.key()).toBe(KEY);
    await store.save({ apiKey: null });
    expect(await store.key()).toBeNull();
  });

  it('系统加密不可用时拒绝保存 key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cloudsea-llm-'));
    const store = new LlmStore(dir, { ...box, isEncryptionAvailable: () => false });
    expect(await store.save({ apiKey: KEY })).toMatch(/不支持系统加密/);
    expect(await store.key()).toBeNull();
  });
});
