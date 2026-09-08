import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/run.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  // tsup 預設會把 `node:fs` 改寫成 `fs`。出貨的 bundle 因此多出一串裸的
  // specifier，下游 bundler 是有可能把 `fs` 解析到 npm 上的同名 shim 的。
  // src/ 一律寫 `node:`，產物就該保持一致。
  removeNodeProtocol: false,
  clean: true,
  splitting: false,
  sourcemap: false,
  treeshake: true,
});
