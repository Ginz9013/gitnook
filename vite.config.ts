import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const studio = fileURLToPath(new URL('./src/studio', import.meta.url));

/**
 * studio 的前端建置。node 那條（tsup）完全不動 —— 兩個目標的性質不同，
 * 硬塞進同一個 pipeline 只會讓兩邊都要遷就對方（ADR-0008）。
 *
 * 產物落在 `dist/studio/`，由 `handler.ts` 在 request 當下從磁碟讀。
 * **不得**讓任何一邊 import 到另一邊：studio bundle 一旦進了
 * `src/cli/run.ts` 的 import 鏈，每一次 `nook list` 都要多 parse 400KB。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': studio } },
  // 資產從 `/assets/` 服務出去，chunk 之間的相對 import 因此解析得到。
  base: '/assets/',
  build: {
    outDir: 'dist/studio',
    // tsup 的 clean 已經把 dist/ 清過一輪，這裡只負責自己的子目錄。
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/studio/main.tsx', import.meta.url)),
      output: {
        // 檔名固定、不帶內容雜湊：殼是 handler.ts 裡的一個常數，寫死檔名讓它
        // 是純函數（不必先建置就測得動）。studio 只服務 loopback 上的一個人，
        // 快取破壞買不到任何東西。
        entryFileNames: 'studio.js',
        chunkFileNames: 'studio-[name].js',
        assetFileNames: (info) => (info.names?.[0]?.endsWith('.css') === true ? 'studio.css' : '[name][extname]'),
      },
    },
  },
});
