import { describe, expect, it } from 'vitest';
import { pullSlots, pushSlot, type CloudStore } from './cloudSync';

function memoryCloud(on = true): CloudStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    enabled: () => on,
    read: (n) => files.get(n) ?? null,
    write: (n, c) => (files.set(n, c), true),
    list: () => [...files.keys()],
  };
}

describe('Steam 云存档同步（M4-1）', () => {
  it('推上去的存档，在另一台机器（本机没有）上会被拉回来；本机更新时不拉', () => {
    const cloud = memoryCloud();
    expect(pushSlot(cloud, 'world-a', { world: '{"w":1}', characters: [{ id: 'p1', data: '{"c":1}' }] }, 1000)).toBe(true);
    const pulled = pullSlots(cloud, new Map());
    expect(pulled).toEqual([{ slot: 'world-a', files: { world: '{"w":1}', characters: [{ id: 'p1', data: '{"c":1}' }] }, modified: 1000 }]);
    expect(pullSlots(cloud, new Map([['world-a', 1000]]))).toEqual([]);
    expect(pullSlots(cloud, new Map([['world-a', 500]]))).toHaveLength(1);
  });

  it('云关闭或出错时什么都不做，也不抛错', () => {
    const off = memoryCloud(false);
    expect(pushSlot(off, 's', { world: 'x', characters: [] }, 1)).toBe(false);
    expect(pullSlots(off, new Map())).toEqual([]);
    const broken: CloudStore = { enabled: () => true, read: () => { throw new Error('boom'); }, write: () => { throw new Error('boom'); }, list: () => [] };
    expect(pushSlot(broken, 's', { world: 'x', characters: [] }, 1)).toBe(false);
    expect(pullSlots(broken, new Map())).toEqual([]);
  });
});
