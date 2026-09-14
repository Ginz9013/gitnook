# Spec — Workspace 可寫入：跨子專案的寫入路由

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。Branch：`monorepo-mode`（延續上一輪唯讀彙整的分支，尚未合併回 `main`）。
>
> **誠實的警語**：延續上一輪的教訓——六個新子指令全部共用同一個新檔案
> `src/cli/workspace.ts`（以及對 `src/cli/run.ts` 的小幅擴充匯出），
> 因此除了票 01（純 core，無共用檔案）之外，票 02→03→04→05→06→07→08
> 是一條全序鏈。選 parallel 執行模式沒有錯，但這個切法一樣買不到跨票的
> 平行處理，是誠實反映而非刻意製造。

## Problem

上一輪 Workspace 唯讀彙整（`.scratch/workspace/`）刻意把寫入排除在範圍外，
留了一張 backlog 票（`01M26B2MARRQ7DACJSCW89YJ0D`）記著：「一個 Change
該落在哪個成員 board，需要一套選擇機制，複雜度與唯讀彙整不成比例」。

grilling 階段釐清了這個問題其實不對稱——`new` 沒有既有 ref，必須明確指定
目標；但 `set`/`mv`/`comment`/`label`/`rm` 都以一個既有的完整 ULID 開頭，
而 ULID 跨 board 實務上全域唯一，可以直接掃過全部成員找出擁有者，使用者
完全不必再指定一次「哪個成員」。原本聽起來很難的問題，只有 `new` 才是
真問題。

## Outcome

在母資料夾底下，不必先 `cd` 進任何子專案：

```
nook workspace new <title> --in <path> [--description <text|->] [--label <l>] [--editor]
nook workspace set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
nook workspace mv <ref> <status>
nook workspace comment <ref> <body|->
nook workspace label <ref> +bug -ui
nook workspace rm <ref> [--yes]
```

六個都能對正確的成員 Board 生效，語意（篩選、`--editor`、`--yes` 的
TTY/非 TTY 規則等）與單一 Board 的既有指令完全一致；`Board.create()`/
`Board.apply()` 一行都不改。

## Scope

- `core/workspace.ts` 新增兩個匯出函式（不是 `Workspace` 介面上的方法，
  見 Domain decisions）：`locateInWorkspace(workspace, ref)`、
  `memberAt(workspace, path)`
- `core/ids.ts` 新增 `isFullRef(ref)`
- `core/types.ts` 新增四個錯誤型別：`IncompleteRef`、
  `RefNotFoundInWorkspace`、`AmbiguousWorkspaceRef`、`NotAWorkspaceMember`
- `cli/workspace.ts` 新增六個子指令：`new`/`set`/`mv`/`comment`/`label`/`rm`
- `cli/run.ts` 漸進匯出 `set`/`mv`/`comment`/`label`/`rm`/`new` 既有用到的
  輔助函式（`fromEditor`、`longText`、`STDIN`、`asChange`、`SETTABLE`、
  `isSettable`、`BOOLEAN_FIELDS`、`confirmed`），並把四個新錯誤型別加進
  `USER_ERRORS`（各自在第一次可觸達的那張票加入，不是一次全加）
- README、AGENT.md 補上六個寫入指令的說明

## Non-goals

- **不做 `history`/`show` 的 workspace 版本。** 這次範圍就是六個寫入指令，
  讀取彙整已經在上一輪做完。
- **`--in` 不支援 cwd 自動推斷。** 一律必填；人已經站在某個成員裡的話，
  直接用單一 Board 的 `nook new` 更直接。
- **不支援短前綴的跨 board ref。** `set`/`mv`/`comment`/`label`/`rm` 的
  `<ref>` 必須是完整 26 碼 ULID——短前綴在單一 Board 內可能無歧義，跨
  board 天生更容易撞號，兩個獨立 board 各自的前綴可能剛好相同、卻指向
  不同 issue。
- **不處理「同一個 ref 出現在多個成員」之外的資料完整性問題。** 那個情境
  本身就是使用者手動複製檔案造成的，`AmbiguousWorkspaceRef` 只負責清楚
  報錯、不猜、不自動選一個，不負責修復。
- **不新增 studio 的寫入介面。** `nook workspace studio` 點進去的子 studio
  本來就可讀寫（就是完整不變的 `serve()`）；這次補的缺口純粹是 CLI 不透過
  瀏覽器這條路。

## Domain decisions

**路由函式是 `core/workspace.ts` 匯出的純函式，不是 `Workspace` 介面上的
方法**：`Workspace` 型別已經在上一輪匯出到 `src/index.ts`，變成永久的
相容承諾——現在幫它加方法，等於把 `locate`/`memberAt` 的形狀也一起鎖死。
改成吃 `Workspace` 當參數的純函式（`locateInWorkspace(workspace, ref)`、
`memberAt(workspace, path)`），CLI 內部直接 import 使用（同 `src/index.ts`
自己講的「同一個 package 內的模組不必經過公開面」），之後真的有外部呼叫端
需要，升格成方法或收進 `src/index.ts` 都是純新增、不破壞任何人。

**`memberAt()` 目前只有一個呼叫端（`new --in`）**，跟 `locateInWorkspace()`
（五個呼叫端）不對稱，但兩者都是 Workspace 的領域事實（「這個路徑/這個
ref 算不算這個 workspace 的東西」），用刪除測試看：拿掉它，複雜度不會
消失，只會原封不動搬回 CLI 層——所以還是放 core，一起匯出。

**跨 board 的 ref 要求完整 ULID 是兩層防線**：CLI 層 `requireFullRef(ref)`
在 `openWorkspace()` 掃描整棵樹之前就先擋掉格式錯的輸入（省一次無謂的
全樹掃描）；`locateInWorkspace()` 內部也做一次同樣的檢查（defense in
depth，保護不透過 CLI 的呼叫端）。同既有 `isValidRef`/`RefNotFound` 的
既有兩層分工。

**`rm` 的確認句與最終輸出標示成員路徑，其餘五個指令維持既有單一 Board的
輸出格式不變**：`list`/`doctor` 標成員路徑是因為那是彙整很多筆結果；
`new`/`set`/`mv`/`comment`/`label` 每次只印一筆結果，使用者剛剛才主動
指定了 `--in`/`<ref>`，結果早在預期內。`rm` 特殊在於它是刪除操作，
救援步驟（`nook workspace set <ref> deleted false`）需要先知道是哪個
成員。

## Design contract

### `src/core/ids.ts`（擴充）

- 新增 `isFullRef(ref: string): boolean`——`isValidRef(ref) && ref.length === 26`。
- **Non-responsibilities**：不做正規化、不做前綴解析——那些是既有
  `normalizeRef`/`resolvePrefix` 的事。

### `src/core/types.ts`（擴充）

- 四個新錯誤型別，放在既有 `RefNotFound`/`AmbiguousRef` 旁邊：
  - `IncompleteRef(ref)`——ref 不是完整 26 碼 ULID
  - `RefNotFoundInWorkspace(ref, searchedCount)`——掃過全部成員都找不到
  - `AmbiguousWorkspaceRef(ref, memberPaths)`——同一個 ref 同時存在於多個
    成員（資料完整性問題，不自動選一個）
  - `NotAWorkspaceMember(resolvedRoot, workspaceRoot)`——`memberAt()` 解析
    出來的 Board 根目錄不在這個 workspace 的 `members` 裡

### `src/core/workspace.ts`（擴充）

- **Responsibilities**：
  ```ts
  export function locateInWorkspace(
    workspace: Workspace,
    ref: string,
  ): { readonly member: WorkspaceMember; readonly issue: Issue };

  export function memberAt(workspace: Workspace, path: string): WorkspaceMember;
  ```
  `locateInWorkspace`：先 `isFullRef` 檢查（否則 `IncompleteRef`），對每個
  成員呼叫既有、未經修改的 `member.board.get(ref)`，抓 `RefNotFound` continue
  下一個、其餘例外原樣拋出；收集命中：0 個 → `RefNotFoundInWorkspace`；
  >1 個 → `AmbiguousWorkspaceRef`；剛好 1 個 → 回傳 `{ member, issue }`。

  `memberAt`：對 `path` 呼叫既有、未經修改的 `openBoard({ dir: path })`
  取得它的 `.root()`（沿用既有向上尋根，`path` 不必剛好是某個成員的根
  目錄），再從 `workspace.members` 裡找出 `path === root` 的那一個
  （回傳既有的 `WorkspaceMember`，不是重新開一個 Board 實例）；找不到就
  `NotAWorkspaceMember`。
- **Non-responsibilities**：不快取結果，跟 `openWorkspace()` 本身一致；
  不做任何 fs 寫入。
- **Seam**：兩個函式本身，沿用 ADR-0004——測試對真實 `mkdtemp` 樹上開好
  的多個 member Board 操作，不引入 mock。

### `src/cli/run.ts`（擴充）

- 漸進把 `fromEditor`、`longText`、`STDIN`、`asChange`、`SETTABLE`、
  `isSettable`、`BOOLEAN_FIELDS`、`confirmed` 加上 `export`——每張票只匯出
  它那個指令真的用到的那幾個，不一次全加。
- `USER_ERRORS` 加入四個新錯誤型別——`NotAWorkspaceMember` 在票 02
  （第一個用到 `memberAt` 的地方）加入；`IncompleteRef`／
  `RefNotFoundInWorkspace`／`AmbiguousWorkspaceRef` 在票 03（第一個用到
  `locateInWorkspace` 的地方）加入。

### `src/cli/workspace.ts`（擴充）

- 六個新子指令，全部沿用既有輔助函式組裝 `Change`/`CreateInput`，不
  重新實作任何欄位驗證或篩選邏輯：
  - `new <title> --in <path> [--description] [--label] [--editor]`：
    `--in` 必填（缺少 → `UsageError`）；`memberAt(workspace, path)` 驗證
    → 對解析出的 `member.board` 呼叫既有 `cmdNew` 的組裝邏輯 → 印純 ULID
  - `set <ref> <field> <value|-> [--editor]`：`requireFullRef(ref)` →
    `locateInWorkspace()` → `asChange()` → `member.board.apply()` → 印
    更新後那一行（`renderTable([updated], displayLength(member.board))`）
  - `mv <ref> <status>`：同上，`{ status }`
  - `comment <ref> <body|->`：同上，`{ comment: longText(body, io) }`
  - `label <ref> +x -y`：同上，`{ labels: { add, remove } }`
  - `rm <ref> [--yes]`：`locateInWorkspace()` → 若 `issue.deleted`，印
    帶成員路徑的訊息（`workspaceDeletedMessage`，新函式，不是重用
    `run.ts` 的 `deletedMessage`——救援指令的措辭不同：指向
    `nook workspace set <ref> deleted false`，而看歷史需要先 `cd` 進那個
    成員，因為這次沒有 workspace 版的 `history`）→ 確認句用組好的
    `` `${relPath} 底下的 ${issue.title}` `` 字串重用既有 `confirmed(io, title)`
    （不改簽章）→ `member.board.apply(ref, { deleted: true })` → 最終輸出
    也帶成員路徑
- **Non-responsibilities**：不重寫任何欄位驗證、篩選、或確認邏輯——
  全部重用 `run.ts` 既有的。

## Acceptance criteria

- [ ] `locateInWorkspace()`：完整 ULID 但格式不對 → `IncompleteRef`；
      掃不到任何成員擁有它 → `RefNotFoundInWorkspace`；人為造出兩個成員
      各自擁有同一個 ref 的情境 → `AmbiguousWorkspaceRef`；剛好一個 →
      回傳正確的 `{ member, issue }`
- [ ] `memberAt()`：給某個成員底下的子目錄（不是根目錄）也能正確解析；
      給一個 workspace 掃描範圍外的合法 Board 路徑 → `NotAWorkspaceMember`；
      給一個完全不是 Board 的路徑 → 既有的 `BoardNotInitialized`（原樣
      冒出，不包裝）
- [ ] `nook workspace new <title> --in <path>`：成功建立在正確的成員底下，
      印出的是完整 26 碼 ULID；缺少 `--in` → `UsageError`；`--in` 指向
      workspace 掃描範圍外的路徑 → `NotAWorkspaceMember`
- [ ] `nook workspace set/mv/comment/label`：對的成員被正確更新，其餘成員
      完全不受影響；語意（`--editor`、欄位驗證、label 的 add/remove）
      跟單一 Board 版本一致
- [ ] `<ref>` 給短前綴時，`set`/`mv`/`comment`/`label`/`rm` 都拒絕並清楚
      說明「跨 board 操作需要完整 ULID」，不嘗試猜測
- [ ] `nook workspace rm`：確認句與最終輸出都標示成員路徑；已刪除的 ref
      印出的訊息指向 `nook workspace set <ref> deleted false` 復原、並
      提示 `cd` 進成員用 `nook history` 查看寫過的值；非 TTY 且未給
      `--yes` 時拒絕，同單一 Board 版本
- [ ] `nook --help`／`AGENT.md` 對六個新子指令沒有造成
      `test/agent-doc.test.ts` 的不一致
- [ ] `npm run bench` 六列閘門全綠，`cli/workspace.ts` 不得 import 任何
      `src/studio/*` 或非既有的 `src/server/*` 重東西

## Test strategy

- Seam：`locateInWorkspace`/`memberAt`（核心，真實 `mkdtemp` 多成員樹）、
  `dispatchWorkspace(argv, io)`（CLI，既有 `Io` capture adapter）
- Test type：整合測試為主，沿用 ADR-0004——不引入 mock 檔案系統
- `AmbiguousWorkspaceRef` 的測試情境：故意在兩個成員的 `.issues/issues/`
  底下放同一個檔名（同一個 ULID）的 op-log 檔案，模擬資料被複製過

## Verification

```bash
npx vitest run test/core/workspace.test.ts test/core/ids.prefix.test.ts   # 票 01
npx vitest run test/cli/workspace.test.ts                                  # 票 02~07
npx vitest run                                                             # 完整 suite
npx tsc --noEmit                                                           # 型別
```

`npm run bench` 由整合者在票 08 之後統一跑一次。

## Baseline

2026-09-11，branch `monorepo-mode`（`6229dd7`，上一輪 Workspace 唯讀彙整
已經落地）實測：

- **687 → 42 files / 723 tests passed**（上一輪彙整功能落地後的數字）
- **0 型別錯誤**（`npx tsc --noEmit`）
- 既有失敗：**無**。不要修任何不在你票上的東西。

## Risks and deferred questions

- **`AmbiguousWorkspaceRef` 目前只負責報錯，不負責任何修復建議之外的事。**
  如果這個情境實務上真的發生過，可能值得再開一張票設計「怎麼幫使用者
  分辨兩個同 ref 的 issue」，但這次判斷是低機率邊界情況，先把安全的
  失敗做對就好。
- **`memberAt()` 只有一個呼叫端**——這是規劃時就承認、跟使用者確認過的
  取捨（見 Domain decisions），不是遺漏。
