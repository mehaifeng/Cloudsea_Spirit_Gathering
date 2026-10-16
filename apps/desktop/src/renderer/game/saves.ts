/** 存档后端：Electron 里走主进程（文件），浏览器里退回 localStorage（网页试玩 / 测试）。 */
export interface SaveBackend {
  list(): Promise<Array<{ slot: string; modified: number }>>;
  read(slot: string): Promise<{ world: string; characters: string[] } | null>;
  write(slot: string, world: string, characters: Array<{ id: string; data: string }>): Promise<void>;
  remove(slot: string): Promise<void>;
}

declare global {
  interface Window {
    cloudsea?: {
      platform: string;
      versions: { electron: string; chrome: string };
      saves: SaveBackend;
    };
  }
}

function localBackend(): SaveBackend {
  const KEY = 'cloudsea.saves';
  const all = (): Record<string, { world: string; characters: Record<string, string>; modified: number }> => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
  };
  const put = (v: ReturnType<typeof all>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* 存不下就算了：试玩版不保证存档 */
    }
  };
  return {
    list: async () =>
      Object.entries(all())
        .map(([slot, v]) => ({ slot, modified: v.modified }))
        .sort((a, b) => b.modified - a.modified),
    read: async (slot) => {
      const v = all()[slot];
      return v ? { world: v.world, characters: Object.values(v.characters) } : null;
    },
    write: async (slot, world, characters) => {
      const v = all();
      v[slot] = { world, characters: Object.fromEntries(characters.map((c) => [c.id, c.data])), modified: Date.now() };
      put(v);
    },
    remove: async (slot) => {
      const v = all();
      delete v[slot];
      put(v);
    },
  };
}

export function saveBackend(): SaveBackend {
  return window.cloudsea?.saves ?? localBackend();
}
