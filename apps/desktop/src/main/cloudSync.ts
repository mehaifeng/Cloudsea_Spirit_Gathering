/**
 * Steam 云存档同步（M4-1，DESIGN 9.4）：本地存档仍是唯一来源，每次写存档后把同一份文件推到 Steam 云；
 * 列存档时如果云上有本机没有、或比本机新的存档，先拉回来。没有 Steam / 云关闭时什么都不做。
 * 云上的文件名：<slot>/world.json、<slot>/characters/<id>.json、characters/<id>.json，外加一份清单记录各存档的修改时间。
 */
export interface CloudStore {
  enabled(): boolean;
  read(name: string): string | null;
  write(name: string, content: string): boolean;
  list(): string[];
}

const MANIFEST = 'cloudsea-manifest.json';

export interface SlotFiles {
  readonly world: string;
  readonly characters: ReadonlyArray<{ id: string; data: string }>;
}

type Manifest = Record<string, { modified: number; characters: string[] }>;

function manifest(cloud: CloudStore): Manifest {
  try {
    const m = JSON.parse(cloud.read(MANIFEST) ?? '{}');
    return m && typeof m === 'object' ? (m as Manifest) : {};
  } catch {
    return {};
  }
}

/** 写存档后推到云上；失败不影响本地存档。 */
export function pushSlot(cloud: CloudStore, slot: string, files: SlotFiles, modified: number): boolean {
  if (!cloud.enabled()) return false;
  try {
    if (!cloud.write(`${slot}/world.json`, files.world)) return false;
    for (const c of files.characters) cloud.write(`${slot}/characters/${c.id}.json`, c.data);
    const m = manifest(cloud);
    m[slot] = { modified, characters: [...new Set([...(m[slot]?.characters ?? []), ...files.characters.map((c) => c.id)])] };
    return cloud.write(MANIFEST, JSON.stringify(m));
  } catch {
    return false;
  }
}

/** 云上比本机新（或本机没有）的存档：返回要写回本机的内容。 */
export function pullSlots(cloud: CloudStore, local: ReadonlyMap<string, number>): Array<{ slot: string; files: SlotFiles; modified: number }> {
  if (!cloud.enabled()) return [];
  const out: Array<{ slot: string; files: SlotFiles; modified: number }> = [];
  try {
    for (const [slot, info] of Object.entries(manifest(cloud))) {
      if ((local.get(slot) ?? 0) >= info.modified) continue;
      const world = cloud.read(`${slot}/world.json`);
      if (!world) continue;
      const characters = info.characters.map((id) => ({ id, data: cloud.read(`${slot}/characters/${id}.json`) ?? '' })).filter((c) => c.data);
      out.push({ slot, files: { world, characters }, modified: info.modified });
    }
  } catch {
    return [];
  }
  return out;
}
