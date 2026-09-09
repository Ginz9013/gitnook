# B1 —— server：`GET /api/board-info` 與 `GET /api/history/<ref>`

**批次**：B ｜ **阻擋**：A4（handler 的寫入所有權）｜ **批 B 的第一張**

## 目標

header（B2）與變更歷史面板（B7）都需要 server 才知道的東西。兩個唯讀端點，
**都放在 `/api/` 底下** —— `/i/` 這個前綴的意思是「寫入面」（405 白名單就是
以它為判準），讀取不該借用它。

## 介面

```
GET /api/board-info   → { root: string, branch: string | null,
                          actor: string, diagnostics: Diagnostic[] }
GET /api/history/<ref> → { writes: [{ field: SetKey, value: string | boolean,
                                      actor: string, t: number }] }
```

- `root` —— board 的絕對路徑。同時開兩個 repo 的 studio 時，這是唯一分得出來的東西。
- `branch` —— 目前分支；不是 git repo、或 detached HEAD 時是 `null`。
- `actor` —— `git config user.email` 推導出的那個（`deriveActor`）。
  **經由 studio 產生的每一個 op 都記在它身上**（ADR-0007），而現在畫面上完全看不到。
- `diagnostics` —— `board.health()` 的產物。B4 用它畫 `.gitattributes` 的警示。

**`board-info` 獨立於 `/api/board`，而且只在開場抓一次。** `board.health()` 會
spawn 一個 `git rev-parse`（`health.ts:167`），掛進快照等於每次全量讀取都多一個
子行程 —— 而快照在 `unmatchedAck` 落空時還會被重抓。

`history` 沿用 `board.opLog(ref)` 並只留 `set` op，與 `cmdHistory` 同一份篩選 ——
**不要另寫一份排序**，`opLog` 已經是 `orderOps` 的全序（`board.ts:113` 的註解）。

## 先寫紅燈

1. `GET /api/board-info` → 200，`root` 是那個暫時 board 的絕對路徑。
2. 不是 git repo 時 → 200 且 `branch === null`，**不是 500** ——
   nook 不強制在 git repo 裡（`doctor` 只是回報 `NotAGitRepo`）。
3. `.gitattributes` 缺 `merge=union` 時，`diagnostics` 含 `MissingMergeDriver`。
4. `GET /api/history/<ref>` → 200，列出對 LWW 欄位的每一次寫入，含 `actor` 與 `t`。
5. `GET /api/history/<不存在的 ref>` → 404；有歧義的前綴 → 404 且內文含候選。
6. `GET /api/history/<已刪的 ref>` → **200**，照樣讀得到（誤刪的救生索，
   `opLog` 對已刪的 Issue 照常，見 A2）。
7. **405 白名單沒有鬆動**：`POST /api/board-info`、`POST /api/history/x` 都是 405，
   `Allow: GET`。
8. `GET /api/history/`（沒有 ref）→ 404。

## 綠燈

`handler.ts` 的 `route` 加兩個分支。`branch` 的取得用 `execFileSync('git', ['rev-parse','--abbrev-ref','HEAD'])`
包 try/catch → `null`，比照 `health.ts:167` 既有的寫法。

## 寫入所有權

```
src/server/handler.ts
test/server/handler.test.ts
```
