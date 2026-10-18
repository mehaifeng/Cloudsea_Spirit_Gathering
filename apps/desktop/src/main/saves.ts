import { app, ipcMain } from 'electron';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pullSlots, pushSlot, type CloudStore } from './cloudSync';
import { STEAM_APP_ID, steamClient } from './net';

/**
 * 存档读写（主进程）：每个世界一个目录，世界存档与角色存档分开（DESIGN 9.3）。
 * 写入用“临时文件 + 改名”，并保留 3 个滚动备份（DESIGN 9.4）。
 */
const BACKUPS = 3;
const SLOT_RE = /^[A-Za-z0-9_-]{1,64}$/;

function root(): string {
  return join(app.getPath('userData'), 'saves');
}

function slotDir(slot: string): string {
  if (!SLOT_RE.test(slot)) throw new Error('invalid save slot');
  return join(root(), slot);
}

async function writeWithBackups(file: string, data: string): Promise<void> {
  for (let i = BACKUPS - 1; i >= 1; i--) {
    await rename(`${file}.bak${i}`, `${file}.bak${i + 1}`).catch(() => {});
  }
  await rename(file, `${file}.bak1`).catch(() => {});
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

export interface SaveSlotInfo {
  slot: string;
  modified: number;
}

/** Steam 云（M4-1）：没有 Steam、或玩家关了云同步时 enabled() 为 false。 */
function steamCloud(): CloudStore {
  const s = steamClient();
  return {
    enabled: () => {
      try {
        // 开发期的测试 App ID 480（Spacewar）不写云：那是 Valve 的示例游戏的云盘
        return !!s && STEAM_APP_ID !== 480 && s.cloud.isEnabledForAccount() && s.cloud.isEnabledForApp();
      } catch {
        return false;
      }
    },
    read: (n) => (s && s.cloud.fileExists(n) ? s.cloud.readFile(n) : null),
    write: (n, c) => !!s && s.cloud.writeFile(n, c),
    list: () => (s ? s.cloud.listFiles().map((f) => f.name) : []),
  };
}

async function writeSlot(slot: string, world: string, characters: ReadonlyArray<{ id: string; data: string }>): Promise<void> {
  const dir = slotDir(slot);
  await mkdir(join(dir, 'characters'), { recursive: true });
  await writeWithBackups(join(dir, 'world.json'), world);
  for (const c of characters) {
    if (!SLOT_RE.test(c.id)) continue;
    await writeWithBackups(join(dir, 'characters', `${c.id}.json`), c.data);
  }
}

export function registerSaveIpc(): void {
  ipcMain.handle('saves:list', async (): Promise<SaveSlotInfo[]> => {
    await mkdir(root(), { recursive: true });
    // 先从 Steam 云拉回比本机新的存档
    const local = new Map<string, number>();
    for (const name of await readdir(root())) {
      const st = SLOT_RE.test(name) ? await stat(join(root(), name, 'world.json')).catch(() => null) : null;
      if (st) local.set(name, st.mtimeMs);
    }
    for (const p of pullSlots(steamCloud(), local)) if (SLOT_RE.test(p.slot)) await writeSlot(p.slot, p.files.world, p.files.characters).catch(() => {});
    const out: SaveSlotInfo[] = [];
    for (const name of await readdir(root())) {
      if (!SLOT_RE.test(name)) continue;
      const s = await stat(join(root(), name, 'world.json')).catch(() => null);
      if (s) out.push({ slot: name, modified: s.mtimeMs });
    }
    return out.sort((a, b) => b.modified - a.modified);
  });

  ipcMain.handle('saves:read', async (_e, slot: string): Promise<{ world: string; characters: string[] } | null> => {
    const dir = slotDir(slot);
    const world = await readFile(join(dir, 'world.json'), 'utf8').catch(() => null);
    if (world === null) return null;
    const chars: string[] = [];
    const charDir = join(dir, 'characters');
    for (const f of await readdir(charDir).catch(() => [] as string[])) {
      if (f.endsWith('.json')) chars.push(await readFile(join(charDir, f), 'utf8'));
    }
    return { world, characters: chars };
  });

  ipcMain.handle('saves:write', async (_e, slot: string, world: string, characters: Array<{ id: string; data: string }>): Promise<void> => {
    await writeSlot(slot, world, characters);
    pushSlot(steamCloud(), slot, { world, characters: characters.filter((c) => SLOT_RE.test(c.id)) }, Date.now());
  });

  // 客人自己的角色（DESIGN 9.3：角色存在玩家本机；加入别人的世界时带过去，M2）
  const charRoot = () => join(app.getPath('userData'), 'characters');
  ipcMain.handle('characters:list', async (): Promise<Array<{ id: string; data: string; modified: number }>> => {
    await mkdir(charRoot(), { recursive: true });
    const out: Array<{ id: string; data: string; modified: number }> = [];
    for (const f of await readdir(charRoot())) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      if (!SLOT_RE.test(id)) continue;
      const file = join(charRoot(), f);
      out.push({ id, data: await readFile(file, 'utf8'), modified: (await stat(file)).mtimeMs });
    }
    return out.sort((a, b) => b.modified - a.modified);
  });
  ipcMain.handle('characters:write', async (_e, id: string, data: string): Promise<void> => {
    if (!SLOT_RE.test(id)) throw new Error('invalid character id');
    await mkdir(charRoot(), { recursive: true });
    await writeWithBackups(join(charRoot(), `${id}.json`), data);
  });

  ipcMain.handle('saves:delete', async (_e, slot: string): Promise<void> => {
    await rm(slotDir(slot), { recursive: true, force: true });
  });
}
