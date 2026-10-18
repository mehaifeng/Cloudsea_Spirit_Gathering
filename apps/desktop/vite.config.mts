import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  // 打包后用 file:// 加载，资源路径必须是相对的
  base: './',
  // 版本号（M4-4）：标题画面显示
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    // 字体文件（fonts.css 里用 @fonts/... 引用，见 scripts/fonts.mjs）
    alias: { '@fonts': fileURLToPath(new URL('./node_modules/@fontsource', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    // 不把小文件内联成 data: URI（内容安全策略只允许本地文件；字体切片都要是真文件）
    assetsInlineLimit: 0,
    // three.js 单包约 600 kB，桌面端本地加载，不必拆包
    chunkSizeWarningLimit: 1500,
  },
  // 端口被占时自动换下一个（启动脚本读实际地址，不依赖固定端口）
  server: { port: 5173, strictPort: false },
});
