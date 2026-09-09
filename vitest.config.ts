import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `@/` 指 `src/studio` —— 與 tsconfig 的 `paths` 和 vite.config.ts 的 alias
  // 同一份。少了它，任何 import 到 `src/studio/board/**` 的測試都在載入時就死在
  // `Cannot find package '@/statuses'`：那些模組是 shadcn 慣例下的 `@/` 使用者。
  resolve: { alias: { '@': fileURLToPath(new URL('./src/studio', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
