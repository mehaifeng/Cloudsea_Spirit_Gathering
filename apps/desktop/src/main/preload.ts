import { contextBridge } from 'electron';

/**
 * 渲染进程可见的最小桥接。之后的存档读写、Steam、LLM 请求都经这里转发到主进程，
 * API key 永远不进入渲染进程（铁律 8）。
 */
contextBridge.exposeInMainWorld('cloudsea', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
