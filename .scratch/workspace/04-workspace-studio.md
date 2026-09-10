# 04 `nook workspace studio`：入口頁 + 點了才啟動的子 studio

## Outcome

`nook workspace studio` 印出一個 landing page 的網址；打開它看到全部子
Board 的連結；點某一個之後，瀏覽器被轉去一個**完全既有、未經修改**的單一
Board studio，可以正常拖曳、編輯——就跟直接在那個子目錄跑 `nook studio`
一模一樣。

## Acceptance criteria

- [ ] `nook workspace studio` 印出的 URL 打開後，`/` 列出全部偵測到的成員
      （路徑 + 連結），包含母資料夾自己（若它也是一個成員）
- [ ] 點某個成員的連結，最終落在一個正常運作的 `serve()` studio 上——
      能看到那個 Board 的 issue、能拖曳改狀態、能開 drawer 編輯，這些行為
      全部來自既有 `serve()`/`handler.ts`/studio 前端，**這張票不改動它們
      任何一行**
- [ ] 兩次點同一個成員的連結，落在同一個 port 上（不重複啟動第二個
      `serve()` 實例）
- [ ] `close()` 之後，landing server 與所有已經啟動過的子 studio 的 port
      都真的釋放（下一次 `listen` 同一個 port 不會撞 `EADDRINUSE`）
- [ ] `--port` 指定的是 landing server 的 port；子 studio 各自用系統指派
      的 ephemeral port，彼此不衝突
- [ ] 空 workspace 時 `/` 印出「沒有偵測到任何 Board」一類的訊息，而不是
      一個空白頁或錯誤
- [ ] `nook --help` 與 `AGENT.md` 對 `studio` 子指令的存在沒有產生新的
      不一致（延續票 02 已經加好的頂層 `workspace` 條目）

## Test seam

`serveWorkspace(workspace, opts)`（`test/server/serveWorkspace.test.ts`，
新檔），沿用 `test/server/serve.test.ts` 的手法：真實 HTTP server、真實
`fetch`、真實 port，測完 `close()`。`dispatchWorkspace(['studio', ...])`
的參數解析（`--port` 合法性）另外補進
`test/cli/workspace.test.ts`（延續票 02/03 的檔案）。

## Write ownership

- `src/server/serveWorkspace.ts`（新檔）
- `src/cli/workspace.ts`（延續票 02/03 的檔案，新增 `studio` 子指令）
- `src/index.ts`（新增 `serveWorkspace` 的匯出）
- `test/server/serveWorkspace.test.ts`（新檔）
- `test/cli/workspace.test.ts`（延續既有檔案，新增 `studio` 的參數驗證
  案例）

**不得碰**：`src/server/serve.ts`、`src/server/handler.ts`、
`src/studio/*`——這張票的存在意義就是重用它們、完全不改。

## Shared resources

**Port**：測試裡每個 `serveWorkspace`/`serve` 實例都要用 `port: 0`
（系統指派）並在 `afterEach` 確實 `close()`，避免跟同批次其他測試檔案
撞號。

## Blocked by

票 03——同一個檔案 `src/cli/workspace.ts` 與 `test/cli/workspace.test.ts`。

## Status

todo

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
