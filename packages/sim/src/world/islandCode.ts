import { ECONOMY, type ContentDb } from '@cloudsea/content';
import { base32ToBits, BitReader, bitsToBase32, BitWriter, checksum16, formatLongCode } from '../spirit/code';
import type { HomeIsland, Rotation } from './state';

/**
 * 岛屿码（DESIGN 7 / 10，M3-5）：家园岛的地形种子、岛核等级和建筑布局（类型、位置、朝向、田里种的作物）。
 * XI-XXXX-…（多行文本块）。导入后只能参观（不改自己的世界）。
 * 建筑 / 作物编号 = 在数据表里的顺序：只能往后追加。
 */
const VERSION = 1;
const B = { version: 4, core: 4, seed: 32, count: 8, type: 6, coord: 8, rot: 2, crop: 4, checksum: 16 } as const;
const COORD_OFFSET = 128;
const MAX_BUILDINGS = 255;

export interface IslandLayout {
  readonly seed: number;
  readonly coreLevel: number;
  readonly buildings: ReadonlyArray<{ readonly type: string; readonly x: number; readonly z: number; readonly rot: Rotation; readonly crop: string | null }>;
}

export function islandLayoutOf(home: Readonly<HomeIsland>): IslandLayout {
  return {
    seed: home.seed >>> 0,
    coreLevel: home.coreLevel,
    buildings: Object.values(home.buildings)
      .filter((b) => b.built)
      .slice(0, MAX_BUILDINGS)
      .map((b) => ({ type: b.type, x: b.x, z: b.z, rot: b.rot, crop: b.crop?.cropId ?? null })),
  };
}

export function encodeIslandCode(content: ContentDb, layout: IslandLayout): string {
  const types = [...content.buildings.keys()];
  const crops = [...content.crops.keys()];
  const list = layout.buildings.filter((b) => Math.abs(b.x) < COORD_OFFSET && Math.abs(b.z) < COORD_OFFSET).slice(0, MAX_BUILDINGS);
  const w = new BitWriter();
  w.write(VERSION, B.version);
  w.write(layout.coreLevel, B.core);
  w.write(layout.seed >>> 0, B.seed);
  w.write(list.length, B.count);
  for (const b of list) {
    w.write(types.indexOf(b.type), B.type);
    w.write(Math.round(b.x) + COORD_OFFSET, B.coord);
    w.write(Math.round(b.z) + COORD_OFFSET, B.coord);
    w.write(b.rot, B.rot);
    w.write(b.crop ? crops.indexOf(b.crop) + 1 : 0, B.crop);
  }
  w.write(checksum16(w.bits), B.checksum);
  return formatLongCode('XI', bitsToBase32(w.bits));
}

/** 解码岛屿码；无效时返回错误信息。 */
export function decodeIslandCode(content: ContentDb, code: string): IslandLayout | string {
  const bits = base32ToBits(code.trim().toUpperCase().replace(/^XI-?/, ''));
  if (!bits || bits.length < B.version + B.core + B.seed + B.count + B.checksum) return '岛屿码不完整';
  const r = new BitReader(bits);
  if (r.read(B.version) !== VERSION) return '不支持的岛屿码版本';
  const coreLevel = r.read(B.core);
  const seed = r.read(B.seed);
  const count = r.read(B.count);
  const need = r.pos + count * (B.type + 2 * B.coord + B.rot + B.crop) + B.checksum;
  if (bits.length < need || bits.length - need >= 5) return '岛屿码长度不对';
  const types = [...content.buildings.keys()];
  const crops = [...content.crops.keys()];
  const buildings: Array<IslandLayout['buildings'][number]> = [];
  for (let i = 0; i < count; i++) {
    const type = types[r.read(B.type)];
    const x = r.read(B.coord) - COORD_OFFSET;
    const z = r.read(B.coord) - COORD_OFFSET;
    const rot = r.read(B.rot) as Rotation;
    const cropIdx = r.read(B.crop);
    if (!type) return '岛屿码里的建筑不存在';
    const crop = cropIdx === 0 ? null : crops[cropIdx - 1];
    if (crop === undefined) return '岛屿码里的作物不存在';
    buildings.push({ type, x, z, rot, crop });
  }
  const payload = r.pos;
  if (r.read(B.checksum) !== checksum16(bits.slice(0, payload))) return '岛屿码校验失败，可能抄错了';
  if (coreLevel < 1 || coreLevel > ECONOMY.maxCoreLevel) return '岛屿码里的岛核等级无效';
  return { seed, coreLevel, buildings };
}
