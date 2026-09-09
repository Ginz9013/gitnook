# 01 `src/studio/` 骨架：Vite + React + Tailwind + shadcn

nook ref：`01M224RHGAW93GK72JXFG9TXPX`

## Outcome

`nook studio` 服務一個 React SPA 而非伺服器渲染的頁面。看板與 drawer 的實際內容
留給票 06 與 07 —— 這張票要的是**能跑起來的空殼**加上 SPA 需要的 JSON 讀取面。

## Acceptance criteria

**建置**

- [ ] `src/studio/` 是自己的 Vite 應用，輸出到 `dist/studio/`
- [ ] `npm run build` 同時產出 node 的 `dist/`（tsup，不變）與 `dist/studio/`
- [ ] tsup **不得**把 `src/studio/**` 收進 node 的 bundle
- [ ] `npx tsc --noEmit` 對 `.tsx` 通過（tsconfig 加 jsx 設定與 shadcn 的 `@/` 別名）
- [ ] React 19 + Tailwind v4 + shadcn。**不裝 vaul**（ADR-0008）
- [ ] shadcn 只裝這次會用到的：Sheet、DropdownMenu、Button、Badge、Textarea

**Server**

- [ ] `GET /` 回傳 SPA shell HTML
- [ ] `GET /assets/<file>` 服務 `dist/studio/` 底下的檔案，**在 request 當下才從磁碟讀**
- [ ] `GET /api/board` 回傳 `{ issues: IssueView[], hash }`，`IssueView` 見 spec.md
- [ ] `GET /hash` 行為不變（票 09 的契約）
- [ ] `descriptionHtml` / `bodyHtml` 由 `html.ts` 既有的 markdown renderer 產生
- [ ] 移除頁面內嵌的 `pollingScript` —— SPA 自己輪詢（票 05）
- [ ] `dist/studio/` 不存在時，`nook studio` 給出清楚訊息而非堆疊追蹤
- [ ] `/assets/` 的路徑穿越一律 404（沿用既有 ref 穿越測試的嚴格度）

**冷啟（最容易踩壞的一項）**

- [ ] **studio bundle 不得出現在 `src/cli/run.ts` 的 import 鏈上**（ADR-0008）
- [ ] `npm run bench` 的冷啟仍 < 500ms，且不明顯高於基線的 25.8ms

**App 殼（為票 06/07 預留插槽）**

- [ ] `src/studio/App.tsx` 渲染 `<Board/>` 與 `<IssueDrawer/>`
- [ ] `src/studio/board/Board.tsx` 與 `src/studio/drawer/IssueDrawer.tsx` 建成
      **可編譯的 stub**，讓票 06 與 07 各自只碰自己的目錄，不必回頭改 App.tsx

## Test seam

`handleRequest(board, req)` 純函數，沿用 `test/server/handler.test.ts` 既有的
mkdtemp + 真實 board 模式（ADR-0004）。新路由都在這裡測。

`GET /assets/*` 的檔案讀取需要 `dist/studio/` 存在 —— 測試自己在 mkdtemp 底下
造假的資產目錄，**不得**依賴真的建置產物。

**React 組件不寫測試**（見 spec.md 的測試策略）。App.tsx 與 stub 只靠型別把關。

## Write ownership

- `package.json` `package-lock.json` — **本批次只有這張票可以動**
- `tsconfig.json` `tsup.config.ts` `vite.config.ts`(新) `components.json`(新)
- `src/server/handler.ts` `src/server/serve.ts`
- `src/studio/main.tsx` `src/studio/App.tsx` `src/studio/api.ts` `src/studio/index.css`
- `src/studio/lib/utils.ts` `src/studio/components/ui/**`
- `src/studio/board/Board.tsx` `src/studio/drawer/IssueDrawer.tsx`（**僅建 stub**）
- `test/server/handler.test.ts` `test/server/serve.test.ts`

**不得碰**：`src/studio/reconcile.ts`（票 02）、`src/render/html.ts`（票 04）、
`bin/nook.js`、`src/cli/run.ts`、`src/core/**`。

## Shared resources

Port 一律綁 0。暫存目錄每個用例獨立 `mkdtemp`。

## Blocked by

無。

## Status

queued
