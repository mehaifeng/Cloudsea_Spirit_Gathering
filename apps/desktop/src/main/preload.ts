import { contextBridge, ipcRenderer } from 'electron';

/**
 * 渲染进程可见的最小桥接。存档读写经这里转发到主进程；
 * 之后的 Steam、LLM 请求也走这里，API key 永远不进入渲染进程（铁律 8）。
 */
contextBridge.exposeInMainWorld('cloudsea', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    read: (slot: string) => ipcRenderer.invoke('saves:read', slot),
    write: (slot: string, world: string, characters: Array<{ id: string; data: string }>) => ipcRenderer.invoke('saves:write', slot, world, characters),
    remove: (slot: string) => ipcRenderer.invoke('saves:delete', slot),
  },
});
