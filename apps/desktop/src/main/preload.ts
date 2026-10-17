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
  /** 联机传输（M2）：渲染进程只收发 JSON 文本。 */
  net: {
    hostOpen: (port?: number) => ipcRenderer.invoke('net:host-open', port),
    hostSend: (connId: string, text: string) => ipcRenderer.send('net:host-send', connId, text),
    hostClose: () => ipcRenderer.invoke('net:host-close'),
    joinLan: (url: string) => ipcRenderer.invoke('net:join-lan', url),
    clientSend: (text: string) => ipcRenderer.send('net:client-send', text),
    clientClose: () => ipcRenderer.invoke('net:client-close'),
    steamStatus: () => ipcRenderer.invoke('net:steam-status'),
    steamHost: () => ipcRenderer.invoke('net:steam-host'),
    steamInvite: () => ipcRenderer.invoke('net:steam-invite'),
    joinSteam: (lobbyId: string) => ipcRenderer.invoke('net:join-steam', lobbyId),
    on: (channel: 'net:host-msg' | 'net:host-drop' | 'net:client-msg' | 'net:client-drop' | 'net:steam-join-request', handler: (...args: unknown[]) => void) => {
      const fn = (_e: unknown, ...args: unknown[]) => handler(...args);
      ipcRenderer.on(channel, fn);
      return () => ipcRenderer.removeListener(channel, fn);
    },
  },
  characters: {
    list: () => ipcRenderer.invoke('characters:list'),
    write: (id: string, data: string) => ipcRenderer.invoke('characters:write', id, data),
  },
  saves: {
    list: () => ipcRenderer.invoke('saves:list'),
    read: (slot: string) => ipcRenderer.invoke('saves:read', slot),
    write: (slot: string, world: string, characters: Array<{ id: string; data: string }>) => ipcRenderer.invoke('saves:write', slot, world, characters),
    remove: (slot: string) => ipcRenderer.invoke('saves:delete', slot),
  },
});
