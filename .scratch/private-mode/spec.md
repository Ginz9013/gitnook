# Spec — private mode：一塊只存在於本機的 board

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。Branch：`v3`。

## Problem

`nook init` 要在別人的 repo 裡留下兩樣東西才能工作：`.issues/` 這個目錄，以及
`.gitattributes` 的那一行。技術上都無害，**但它們是 committed bytes** ——
團隊裡只有一個人想用、或想先私下試用一段時間的人，沒有辦法在不進入
「跟全隊解釋這是什麼」的對話之前開始用。

所以 private mode 買到的不是技術相容性，**是社交足跡為零**。這一句要寫進
README，否則下一個讀的人會以為它解的是中途導入的技術問題。

## Outcome

`nook init --private` 之後：

- `git status --porcelain` 乾淨，`git ls-files .issues` 為空，`.gitattributes`
  一個 byte 都沒動 —— **zero committed bytes**
- `nook new` / `list` / `show` / `studio` 全部照常工作
- `list` / `show` **不再**警告缺少 merge=union
- `nook doctor` 在健康的 private board 上**完全沉默**，exit 0
- `nook share` 能把它升級回一塊共享的 board

## Scope

- `nook init --private`：建 `.issues/issues/`、把 ignore 規則冪等寫進
  `$GIT_DIR/info/exclude`、**完全不碰 `.gitattributes`**
- 兩條拒絕：op-log 已被 git 追蹤（已共享）、不在 git work tree 內
- 讀取指令在 private board 上不警告
- `doctor` 在 private board 上壓掉 `MissingMergeDriver`
- `doctor` 說出 fs 與 git 不一致的兩種狀態（新 Diagnostic kind）
- `nook share`：private → shared 的升級路徑
- README 一節、AGENT.md、CONTEXT.md 詞彙、ADR-0011

## Non-goals

- **`nook unshare`（shared → private 的降級）。** 要 `git rm -r --cached`
  才做得到，那是破壞性的，由使用者自己決定並自己執行。`init --private`
  撞到已共享的 board 時會把這個指令講出來，但 nook 不替他跑。
- **跨機器同步**（`refs/nook/issues` 之類的獨立 ref）。一整層新的儲存管線，
  而且會打破「issue 是工作目錄裡的純文字檔」。
- **committed `.gitignore` 的形式。** private mode 只有一種形狀：
  `$GIT_DIR/info/exclude`。寫進 `.gitignore` 的那一行本身就是 committed bytes，
  與這個模式存在的理由相反。
- **token 閘門的 `SKILL_DOC` 不動**（`test/render/token-budget.test.ts`）。
  目前 4102 B / 上限 4608 B，只剩 506 B 餘裕，而 agent 幾乎不會執行 `init`。
  AGENT.md 不在那個量測範圍內，所以它照寫不花預算。
- studio 不新增任何介面。private board 上 `boardAlerts()` 自然就安靜了 ——
  因為 `diagnose()` 不再回報那一條。唯一要動的是票 05 的新 kind 對應。

## Domain decisions

**Sharing（共享狀態）** —— 一塊 Board 的 op-log 是否交給 git 追蹤。兩個值：

- **shared**：預設。op-log 被 commit，`merge=union` 是它的零衝突保證。
- **private**：op-log 被 `$GIT_DIR/info/exclude` 排除，只存在於這一個工作目錄。

_Avoid_：mode、local、offline、visibility（`visibility` 已經被 `archived`
佔用 —— 那是「先不要看到」，與這裡的「要不要交給 git」是兩件事）。

三個關鍵的語意決定：

1. **Sharing 是推導出來的，不是儲存的。** 沒有 config 檔、沒有 marker 檔
   （ADR-0002：`.issues/` 底下零本機狀態）。
2. **private 是被測的那一側，其餘一律算 shared。** 剛 `init` 還沒 commit 的
   board 是 shared —— 它的意圖是共享，只是還沒送出去。這讓讀取熱路徑只需要
   回答一個是非題。
3. **零衝突保證在 private board 上是「不需要」，不是「缺少」。** 被 ignore 的
   op-log 永遠不會 merge。所以 doctor 在那裡沉默不是壓掉一個真問題，是那個
   問題在這個模式下不存在。

## Design contract

### `src/core/sharing.ts`（新）

- **Responsibilities**：回答「這塊 board 是 shared 還是 private」、把 ignore
  規則冪等寫進／移出 `$GIT_DIR/info/exclude`、以及解出 `$GIT_DIR` 本身
  （`.git` 可能是目錄、可能是 worktree 或 submodule 的**檔案**，linked
  worktree 還要再讀它的 `commondir` 才找得到共用的 `info/exclude`）。
- **Non-responsibilities**：`.gitattributes`（`gitattributes.ts`）、
  Diagnostic 的文字（`health.ts`）、輸出（`run.ts`）。不做一般化的 gitignore
  pattern 比對 —— 見下面的 Interface。
- **Interface**：
  - `type Sharing = 'shared' | 'private'`
  - `inspectSharing(root: string): Sharing` —— **純 fs，不 spawn 任何子行程**。
    這是讀取熱路徑唯一的問法。
  - `excludeBoard(root: string): 'created' | 'added' | 'unchanged'` ——
    冪等寫入；回傳值是 `init` 的輸出要講的那件事（沿用票 05「init 說話」
    的三分法）。
  - `unexcludeBoard(root: string): 'removed' | 'unchanged'` —— `share` 用。
  - `opLogsTracked(root: string): boolean` —— **會 spawn `git ls-files`**，
    只准 init / doctor / share 呼叫。
  - `ignoredByGit(root: string): { ignored: boolean; source: string | null }`
    —— **會 spawn `git check-ignore -v`**，`source` 是它自己指出的
    `<file>:<line>:<pattern>`。同樣只准 init / doctor / share 呼叫。
  - 錯誤：`AlreadySharedBoard`（op-log 已被追蹤）、`NoGitDir`（不在 git work
    tree 內）。兩者都是使用者修得好的錯誤 → 進 `USER_ERRORS`，exit 1。
- **Invariant（刻意的窄）**：`inspectSharing` **只認得 nook 自己寫的那一行**
  （整行字串比對），不實作 gitignore 的 pattern 與優先序規則。理由：那套規則
  （目錄排除、否定、後行覆蓋前行）只有 git 自己說得準，而讀取熱路徑不能
  spawn git。手寫成別的形狀的 ignore 規則因此不算 private —— 那是保守的失敗
  （照舊警告、照舊回報），不是靜默的失敗，而且 doctor 會用 git 問出真相並
  說出來（票 05）。
- **寫入的那一行**：`/<board 相對於 work tree 頂端的路徑>/.issues/`，board 在
  repo 根目錄時就是 `/.issues/`。work tree 頂端由 fs 向上找 `.git` 得到，同
  `findBoardRoot` 的走法。
- **Seam**：模組的公開函式本身。不設 adapter、不注入 fs —— ADR-0004：測試打
  真實檔案系統與真實 git。

### `src/core/gitattributes.ts`

- 多一個參數：`initBoard(dir, opts?: { sharing?: Sharing })`。
  `sharing: 'private'` 時**不寫 MERGE_RULE、不讀也不擋
  `ConflictingGitAttributes`**（那條規則在這個模式下無意義），改為呼叫
  `excludeBoard`。`NestedBoard` 與建目錄的前置條件兩條路共用。
- 為什麼長一個參數而不是多一個 `initPrivateBoard`：一塊 board 只有一種建立
  方式，Sharing 是它的參數。兩個入口會讓 `NestedBoard` 與 mkdir 的前置條件
  有兩份。

### `src/core/health.ts`

- `diagnose(dir)` 先問 `inspectSharing`：
  - `private` 且 `opLogsTracked` 為 false → **不回報 `MissingMergeDriver`**，
    其餘檢查（黏合行、未知 op、`NotAGitRepo`）照舊。
  - `private` 且 `opLogsTracked` 為 true → 回報新的 `SharingMismatch`，
    且 `MissingMergeDriver` **照常回報** —— 這塊 board 實際上是共享的，而且
    真的沒有那條規則。
  - `shared` 但 `ignoredByGit` 為 true → 回報 `SharingMismatch`，訊息帶上
    git 自己指出的來源。這塊 board 看起來共享、實際上同事的 clone 會是空的。
- 成本：private board 多 spawn 一個 `git ls-files`；shared board 多一個
  `git check-ignore`。`doctor` 本來就 spawn 一個 `git rev-parse`，而它不在
  冷啟預算的情境裡。

### `src/cli/run.ts`

- `init --private`；`warnIfUnguarded` 在 private 上閉嘴；新指令 `share`。
- **不得在 list / show / new / set / mv / comment / label 的路徑上 spawn git。**
  `boardDir` 與 `warnIfUnguarded` 的既有註解已經把這件事當承諾在守。

## Acceptance criteria

- [ ] `nook init --private` 之後 `git status --porcelain` 是空的，且
      `git ls-files .issues` 是空的，`.gitattributes` 不存在或內容未變
- [ ] 同一條指令重跑是冪等的，且說得出這次什麼都沒做
- [ ] linked worktree 裡 `init --private` 寫的是共用的 `info/exclude`
      （實測：`git rev-parse --git-path info/exclude` 指向 common dir）
- [ ] `init --private` 在已 tracked 的 board 上 exit 1，訊息講出
      `git rm -r --cached .issues`
- [ ] `init --private` 不在 git work tree 內時 exit 1，訊息叫人直接 `nook init`
- [ ] private board 上 `nook list` / `show` 的 stderr 是空的
- [ ] private board 上 `nook doctor` 沉默、exit 0
- [ ] exclude 規則在、op-log 卻被 tracked 時，doctor 同時報 `SharingMismatch`
      與 `MissingMergeDriver`，exit 1
- [ ] 沒有 nook 的規則、git 卻說 op-log 被 ignore 時，doctor 報
      `SharingMismatch`，訊息指出是哪個檔案第幾行
- [ ] studio 的警示列對新 kind 給的是對的一句話與對的下一步指令
      （不是預設那句「op-log 上有 reducer 讀不動的資料」＋`doctor --fix`）
- [ ] `nook share` 在 private board 上移除規則、補上 MERGE_RULE、印出使用者
      自己該跑的 `git add`；在已共享的 board 上是個說得出話的 no-op
- [ ] `nook share` 之後 git 仍然 ignore 那些檔案時（例如 committed
      `.gitignore` 也有一條），說出是哪一條規則在擋
- [ ] 四條代價寫進 README；`init --private` 的輸出至少講出 `git clean -xdf`
      那一條
- [ ] AGENT.md 的「那個警告永遠不是雜訊」改成在 private board 上不適用
- [ ] `nook share` 出現在 HELP 與 AGENT.md 兩邊（`test/agent-doc.test.ts`
      把它們釘在一起 —— 只改一邊會讓測試紅）

## 四條必須被文件化的代價

1. **`git clean -xdf` 會把整塊 board 刪掉。** 實測 `git clean -xdn` 回報
   `Would remove .issues/`。private board 是一份沒有備份的資料，這條最嚴重。
2. issue 不再跟著分支走。
3. **git worktree 之間互相看不到。** ignore 規則是共用的（實測：linked
   worktree 繼承 common dir 的 `info/exclude`），但 untracked 的檔案不是 ——
   每個 worktree 各有一塊空 board。對並行 agent worktree 流程是地雷。
4. 換機器或重新 clone 就沒有了。

## Test strategy

- Seam：`inspectSharing` / `excludeBoard` / `initBoard` / `diagnose` 等核心
  函式，以及 CLI 的 `run(argv, io)` + 注入的 `Io`（ADR-0004 兩個真實接縫之一）
- Test type：整合測試為主 —— **真實 git repo、真實 linked worktree、真實
  暫存目錄**，一律 `mkdtemp`。不引入任何 in-memory fake（ADR-0004：那不是
  接縫，是掩體）
- Dependency handling：git 是 real。`Io` 用測試版 adapter 捕獲輸出
- React 組件不寫測試；`src/studio/board/health.ts` 是純函數，照既有
  `test/studio/health.test.ts` 的形狀加

## Verification

```bash
npx vitest run <該票的測試檔>      # focused
npx vitest run                     # suite
npx tsc --noEmit                   # static
```

`npm run bench` **由整合者最後統一跑**（它會清掉整個 `dist/`）。
六列閘門全綠、CLI bundle 的 React 痕跡必須是 0。

## Baseline

2026-09-10，branch `v3`（分自 `2f6ebee`）實測：

- **615 tests passed / 38 files passed**
- **0 型別錯誤**（`npx tsc --noEmit`）
- 既有失敗：**無**。不要修任何不在你票上的東西。

## 共用資源與環境風險

- 使用者可能正在 `127.0.0.1:4780` 跑 studio。**不要跑 `npx tsup`，也不要跑
  `npm run bench`**（兩者都會清掉 `dist/`）。`npx vite build` 可以。
- **不得寫入這個 repo 的 `.issues/`**，也不得對這個 repo 跑
  `nook init --private`、`nook share`、`git rm --cached` —— 那會把 nook 自己
  的 board 變成實驗品。全部測試都在 `mkdtemp` 出來的 repo 裡做。
- 測試建立的 git repo 一律只設 local 設定（`user.email` / `user.name` /
  `commit.gpgsign false`），不讀也不改使用者的全域設定，同
  `test/core/health.test.ts` 的 `gitInit()`。
- 測試若建 linked worktree，結束時要 `git worktree remove --force` 或連同
  暫存目錄一起 `rm -rf`。
- Port 一律綁 0。

## 批次計畫

| 批次 | 票 | 平行度 |
|---|---|---|
| B1 | 01 | 1 |
| B2 | 02 ∥ 04 | 2 |
| B3 | 03 ∥ 05 | 2 |
| B4 | 06 ∥ 07 | 2 |

序列化的原因是檔案不是邏輯：**`src/cli/run.ts` 被票 01、02、03、06 搶**，
**`src/core/health.ts` 被票 04、05 搶**，`src/core/sharing.ts` 被 01、02、06 搶。
票 07 是純文件，理論上隨時可跑，排在最後只因為 ADR 要寫進票 05 的已知限制、
README 要寫到票 06 的 `share`。

## Risks and deferred questions

- **`inspectSharing` 的窄比對會漏掉手寫的 ignore 形式。** 已接受：失敗方向是
  保守的（照舊警告），而 doctor 用 git 問得出真相並說出來（票 05）。
- **fs 與 git 不一致時 list / show 仍然是盲的。** 進到那個狀態要一次刻意的
  `git add -f`（ignore 中的路徑 `git add` 不加 `-f` 會被擋）。doctor 看得到，
  熱路徑看不到 —— 寫進 ADR-0011 的 Consequences。
- **ADR-0002 的 Consequences 寫著「連使用者的 `.gitignore` 都不需要修改」。**
  ADR-0011 必須正面處理這句話：ADR-0002 講的是**衍生狀態**不需要被 ignore，
  而 private mode ignore 的是**權威資料本身**，兩者不是同一件事 —— 但措辭
  重疊，不交代會讓下一個讀的人以為 0011 推翻了 0002。
- `nook unshare` 日後若要做，降級是破壞性的，需要自己的一張票與自己的決定。
- token 閘門的 `SKILL_DOC` 這次不動（餘裕只有 506 B）。若要讓 agent 也知道
  private mode，那是另一個決定，且要先量測。
