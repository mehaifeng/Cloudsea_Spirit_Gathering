import { app, ipcMain } from 'electron';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export function registerSaveIpc(): void {
  ipcMain.handle('saves:list', async (): Promise<SaveSlotInfo[]> => {
    await mkdir(root(), { recursive: true });
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
    const dir = slotDir(slot);
    await mkdir(join(dir, 'characters'), { recursive: true });
    await writeWithBackups(join(dir, 'world.json'), world);
    for (const c of characters) {
      if (!SLOT_RE.test(c.id)) continue;
      await writeWithBackups(join(dir, 'characters', `${c.id}.json`), c.data);
    }
  });

  ipcMain.handle('saves:delete', async (_e, slot: string): Promise<void> => {
    await rm(slotDir(slot), { recursive: true, force: true });
  });
}
