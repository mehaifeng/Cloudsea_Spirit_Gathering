import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 灵性模式设置的本地存储（主进程，M3-4）。
 * - 设置（地址、模型、开关、上限）明文存 llm.json；
 * - API key 用系统加密（Electron safeStorage）存 llm-key.bin，系统加密不可用时拒绝保存（铁律 8）。
 * key 只经 key() 在主进程里取出，不经 IPC 回到渲染进程。
 */
export interface SecretBox {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface LlmSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  /** 每个游戏日最多调用次数。 */
  readonly dailyLimit: number;
  readonly timeoutMs: number;
}

export interface LlmPublicSettings extends LlmSettings {
  readonly hasKey: boolean;
  readonly encryption: boolean;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = { enabled: false, baseUrl: 'https://api.openai.com/v1', model: '', dailyLimit: 60, timeoutMs: 15_000 };

export type LlmPatch = Partial<LlmSettings> & { readonly apiKey?: string | null };

export class LlmStore {
  constructor(
    private readonly dir: string,
    private readonly box: SecretBox,
  ) {}

  private get settingsFile(): string {
    return join(this.dir, 'llm.json');
  }

  private get keyFile(): string {
    return join(this.dir, 'llm-key.bin');
  }

  async settings(): Promise<LlmSettings> {
    try {
      const raw = JSON.parse(await readFile(this.settingsFile, 'utf8')) as Partial<LlmSettings>;
      return sanitize({ ...DEFAULT_LLM_SETTINGS, ...raw });
    } catch {
      return DEFAULT_LLM_SETTINGS;
    }
  }

  async publicSettings(): Promise<LlmPublicSettings> {
    return { ...(await this.settings()), hasKey: (await this.key()) !== null, encryption: this.box.isEncryptionAvailable() };
  }

  async key(): Promise<string | null> {
    try {
      const buf = await readFile(this.keyFile);
      return this.box.decryptString(buf) || null;
    } catch {
      return null;
    }
  }

  /** 保存设置；apiKey：字符串 = 换新 key，null = 删除，省略 = 不动。返回错误原因或 null。 */
  async save(patch: LlmPatch): Promise<string | null> {
    await mkdir(this.dir, { recursive: true });
    const { apiKey, ...rest } = patch;
    if (apiKey !== undefined) {
      if (apiKey === null || apiKey.trim() === '') await rm(this.keyFile, { force: true });
      else {
        if (!this.box.isEncryptionAvailable()) return '这台电脑不支持系统加密，不能保存 key';
        await writeFile(this.keyFile, this.box.encryptString(apiKey.trim()));
      }
    }
    const next = sanitize({ ...(await this.settings()), ...rest });
    await writeFile(this.settingsFile, JSON.stringify(next, null, 2), 'utf8');
    return null;
  }
}

function sanitize(s: LlmSettings): LlmSettings {
  return {
    enabled: !!s.enabled,
    baseUrl: String(s.baseUrl ?? '').trim().slice(0, 300),
    model: String(s.model ?? '').trim().slice(0, 100),
    dailyLimit: Math.max(1, Math.min(1000, Math.floor(Number(s.dailyLimit) || DEFAULT_LLM_SETTINGS.dailyLimit))),
    timeoutMs: Math.max(3000, Math.min(60_000, Math.floor(Number(s.timeoutMs) || DEFAULT_LLM_SETTINGS.timeoutMs))),
  };
}
