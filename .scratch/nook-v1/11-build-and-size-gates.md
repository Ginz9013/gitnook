# 11 打包發布與體積／冷啟閘門

## Outcome

`npm pack` 產出的 tarball 可安裝、可執行，且證明四個硬指標中剩下的兩個。

## Acceptance criteria

**打包**

- [ ] tsup 設定產出 CJS 或 ESM 單檔 bundle 與型別宣告
- [ ] `package.json` 的 `files` 欄位只含發布必需品（`dist/`、`bin/`、README、LICENSE）—— **不含 `src/`、`test/`、golden files**
- [ ] `bin` 指向的檔案含 shebang 且有執行權限
- [ ] `exports` 同時支援 `import { openBoard } from '@nook/cli'` 與 CLI —— library-first 是產品定位，必須有測試守住
- [ ] **runtime dependencies 為零**（`dependencies` 為空或僅含 markdown renderer；一切建置工具都是 devDependency）
- [ ] `engines.node >= 22`
- [ ] LICENSE 為 MIT

**閘門（`npm run bench`）**

- [ ] **package size < 3MB** —— 由 `npm pack` 的實際 tarball 量測解壓後大小，印出實際值與餘裕
- [ ] **冷啟 < 500ms** —— 從**打包後的 tarball**（非 `src/`）執行 `nook --version`，取多次執行的中位數，印出實際值
- [ ] 兩個閘門超標時 CI fail
- [ ] `npm run bench` 同時彙整票 05 的 merge 閘門與票 07 的 token 閘門，一次列出四個硬指標的當前數值

**煙霧測試**

- [ ] 在乾淨的暫存目錄安裝 packed tarball，執行 `init` → `new` → `list`，驗證真實安裝路徑可用

## Test seam

打包產物本身。這張票**必須**針對 tarball 測試，而非 `src/` —— 只有前者能反映使用者實際拿到的東西。

## Write ownership

- `tsup.config.ts`
- `package.json`
- `LICENSE`
- `README.md`
- `bench/size.ts`
- `bench/coldstart.ts`
- `bench/index.ts`
- `test/integration/packed-smoke.test.ts`

> `package.json` 由票 01 建立，本票修改。兩者不會同批執行（本票被 10 阻擋），無碰撞風險。

## Shared resources

暫存目錄。`npm pack` 會在 repo 根目錄產生 tarball，測試後須清除。

## Blocked by

10

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
