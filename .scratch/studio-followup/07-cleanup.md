# 07 死介面、過期註解、重複的 escapeHtml

nook ref：`01M22PKRW76AQKWZHEGWNAM7K4`

## Outcome

兩軸審查的清理項。**放最後**，因為它碰的檔案跟每一張票都撞，而且放最後
還能一併掃掉前四輪新產生的過期註解。

## Acceptance criteria

**死掉的公開面 —— 逐項確認真的沒人用再刪**

- [ ] `reconcile.ts` 的 `LAND` action 與 `PendingWrite.landed` ——
      `src/` 底下沒有 dispatcher，只有測試在用
- [ ] `ProjectedIssue.serverKnown` 與 `.held` —— **注意：票 05 之後 `held`
      很可能已經有人用了**。刪之前先 grep，只刪真的沒人用的
- [ ] `lanes.ts` 的 `laneOf()` 與 `ColumnDef.lane`（名字可能已被票 04 改掉）
- [ ] `@dnd-kit/sortable` 是宣告了的 devDependency 但沒有任何檔案 import
      （`dnd.ts` 有註解說明為何不用它）。移除後 `npm run bench` 要重跑

**過期註解 —— 這個 repo 的註解水準是「解釋為什麼」，過期的比沒有更糟**

- [ ] `board/Board.tsx` 還寫著「這是票 06 要填的空殼」
- [ ] `onGrab` 的註解說「目前的 `App.tsx` 還沒有 reducer 可派（票 05）」，
      已經有了；App 一律會傳，那兩個 prop 的 `?` 是死的
- [ ] `src/cli/run.ts:486` 的 `cmdStudio` 註解仍寫「唯讀的會議投影用檢視器」。
      **僅限這個註解，不得改該檔案的任何邏輯**
- [ ] 掃一遍前四輪新產生的過期註解（提到票號、或說「還沒有」而現在已經有的）

**重複**

- [ ] `escapeHtml` 現在在 `render/html.ts` 與 `server/handler.ts` 各一份
      （後者只給缺資產的訊息頁用）。收成一份 —— 但注意 `html.ts` 的那份是
      「先逸出、再構造」安全模型的一部分，**不得因為去重而改變它的行為**

## Test seam

既有的 305 條測試就是迴歸網。刪掉 `LAND` 會讓釘住它的測試變紅 ——
那些測試跟著刪，但要在報告裡列出刪了哪幾條、為什麼那不是覆蓋率損失。

## Write ownership

- `src/studio/reconcile.ts` `test/studio/reconcile.test.ts`
- `src/studio/board/**`
- `src/cli/run.ts`（**僅限** 486 行附近的註解）
- `src/server/handler.ts`
- `package.json` `package-lock.json`

**不得碰**：`src/render/html.ts` 的 markdown 邏輯（去重時若要動它，
先確認安全性質不變，並在報告裡逐條說明）、`src/core/**`。

## Blocked by

票 04、05、06 —— 全部。

## Status

queued
