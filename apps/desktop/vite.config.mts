import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  // 打包后用 file:// 加载，资源路径必须是相对的
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    // three.js 单包约 600 kB，桌面端本地加载，不必拆包
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, strictPort: true },
});
