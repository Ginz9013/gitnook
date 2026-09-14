# Spec — Workspace：跨子專案的唯讀彙整檢視

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`）。Branch：`monorepo-mode`（已存在）。
>
> **誠實的警語**：這次的五張票因為共用同一個新檔案 `src/cli/workspace.ts`，
> 除了票 01（純 core，無共用檔案）之外，票 02→03→04→05 是一條全序鏈
> （`Blocked by` 依序相接）。選 parallel 執行模式沒有錯——每張票仍然各自
> 是獨立的 worker 執行、獨立 commit——但這個切法買不到真正跨票的平行處理。
> 沒有為了製造平行度而扭曲切法。

## Problem

nook 目前的尋根（`findBoardRoot`）只往上找，且在遇到 `.git` 就停——每一塊
Board 天生只回答「這一個 repo 裡的 issue」。當使用者的工作橫跨多個 repo
（monorepo 底下的多個套件、或母資料夾底下並排幾個 submodule／獨立 repo），
今天完全沒有辦法「一眼看到全部」：得一個一個 `cd` 進去、各自跑一次
`nook list`，自己在腦裡拼起整體狀態。

## Outcome

在一個母資料夾（可以是 monorepo 的根、也可以只是隨便放了幾個 repo 的資料夾）
底下執行：

- `nook workspace list [--all] [--status <s>] [--label <l>] [--json]`——
  依子專案分組列出全部 issue，每組標示來源路徑
- `nook workspace doctor [--fix]`——對每個偵測到的子 Board 各跑一次
  `health()`／`repair()`，任一個不健康就 exit 非 0
- `nook workspace studio [--port <n>]`——開一個入口頁，列出全部子 Board，
  點進去就是完全既有、未經修改的單一 Board studio

三者都只反映**已經存在**的 Board：不建立、不合併、不推測。

## Scope

- 新型別 `Workspace` / `WorkspaceMember`，工廠函式 `openWorkspace(opts)`
  （`src/core/workspace.ts`，新檔）
- 探測邏輯：從一個根目錄遞迴掃描找 `.issues/issues/`，找到就停止往下鑽，
  跳過 `.git`、`node_modules`，不追蹤 symlink，根目錄自己也算一個候選
- `nook workspace list` / `doctor` / `studio` 三個 CLI 子指令
- `serveWorkspace()`：一個小型 landing server，點連結才啟動（並重用既有、
  完全不變的）`serve(member.board)`
- `renderWorkspaceList()`：依來源分組的表格輸出
- `openWorkspace` / `serveWorkspace` 與相關型別進 `src/index.ts` 公開面
- README、AGENT.md 補上 Workspace 一節；CONTEXT.md 的 Workspace 詞彙與
  ADR-0012 已在規劃階段寫定（見下方 Domain decisions）

## Non-goals

- **任何寫入路徑。** 沒有 `nook workspace new/set/mv/comment`——在 Workspace
  層級對某個成員 Board 寫入，牽涉到「這個 Change 該落在哪個成員」的選擇
  機制，複雜度與這次的唯讀彙整不成比例。**這是刻意留給未來的一張大票**
  （規劃階段結束後會建一張 `backlog` 狀態的 nook issue 記錄這件事，不在
  這次的五張票裡）。
- **不做跨 Board 的 ref 解析／`show`。** 沒有「這個 ref 到底在哪個子專案」
  的全域查找。
- **不讀 `.gitmodules`。** 是不是 git submodule 與探測無關，只看
  `.issues/issues/` 存不存在（ADR-0012）。
- **不維護任何清單、快取或設定檔。** 每次 `openWorkspace()` 都是即時的
  完整掃描。
- **studio 入口頁不合併看板。** 每個子 Board 的看板完全獨立，不跨 Board
  拖曳、不共用任何狀態。
- **不做「這裡本該有 board 但沒有」的推測。** 子目錄沒有 `.issues/` 就
  完全略過，`doctor` 不特別回報。
- **不追加深度上限。** 遞迴不設固定層數——找到 Board 就停止往下鑽、跳過
  `.git`／`node_modules` 已經把代價壓到可接受，固定層數只會造成靜默漏掃。

## Domain decisions

**Workspace**（已寫入 CONTEXT.md）：
從一個根目錄往下遞迴掃描找到的一組 Board，供跨 Board 檢視（列表、篩選、
健康檢查）之用。純粹是觀察的角度——不建立任何新的儲存或狀態，不合併任何
Op-log，每個成員 Board 完全維持自己的獨立性（各自的 Op-log、Actor、
Sharing）。

_Avoid_：monorepo（使用者資料夾佈局的慣例，與 Workspace 正交——沒有
monorepo 佈局也能有 Workspace）、fleet、federation、group、collection。

**Board 的 `_Avoid_` 清單同步更新**：`workspace` 從「Board 的禁用同義詞」
變成「有自己明確定義的新概念」——單一 Board 不是 workspace，兩者不可混用。

**探測機制不對稱於 `openBoard`**：`openBoard()` 找不到 `.issues/` 會拋
`BoardNotInitialized`；`openWorkspace()` **不會**——找不到任何成員時
`members` 就是空陣列。理由是 Board 沒有 `.issues/` 就不成立，而 Workspace
本質上是「掃描的結果」，空結果是合法狀態。

見 [ADR-0012](../../docs/adr/0012-workspace-discovers-members-by-filesystem-scan.md)：
為什麼探測只看檔案系統、不讀 `.gitmodules` 或設定檔。

## Design contract

### `src/core/types.ts`（擴充）

- **Responsibilities**：新增 `Workspace`、`WorkspaceMember`、
  `OpenWorkspaceOptions` 三個型別宣告，與既有 `Board` 系列型別放在一起。
- **Interface**：
  ```ts
  export interface WorkspaceMember {
    readonly path: string; // 絕對路徑，同 Board.root()
    readonly board: Board; // openBoard({ dir: path }) 的產物
  }
  export interface Workspace {
    readonly members: readonly WorkspaceMember[]; // 依 path 字典序排序
    root(): string;
  }
  export interface OpenWorkspaceOptions {
    readonly dir?: string; // 預設 process.cwd()
  }
  ```
- **Non-responsibilities**：不定義探測演算法本身（那是 `workspace.ts` 的事）。

### `src/core/workspace.ts`（新）

- **Responsibilities**：`openWorkspace(opts)` 的實作——遞迴掃描檔案系統、
  套用跳過規則、組出排序後的 `members`。
- **Non-responsibilities**：不寫入任何東西、不快取跨呼叫的結果、不解析
  `.gitmodules`、不做 ref 查找。
- **Interface**：`openWorkspace(opts?: OpenWorkspaceOptions): Workspace`。
  **不拋錯**——ENOENT 等 fs 例外（例如 `dir`本身不存在）原樣往上冒，不
  包裝成新的 domain error；空結果本身不是錯誤。
- **Invariants**：
  - 找到一個成員（`.issues/issues/` 存在）就不再往它底下更深處掃
  - 跳過名為 `.git`、`node_modules` 的目錄（不比對內容，只比對名字）
  - 不追蹤 symlink 目錄（`readdirSync(..., { withFileTypes: true })`
    篩掉 `dirent.isSymbolicLink()`）
  - 起始目錄本身若含 `.issues/issues/` 也算一個成員
  - 讀某個子目錄失敗（例如 EACCES）時跳過那一支，不中止整個掃描
  - 深度不設上限
- **Seam**：模組公開函式本身，沿用 ADR-0004——直接測真實檔案系統
  （`mkdtemp` 造樹），不引入 mock fs 抽象。

### `src/cli/run.ts`（擴充）

- 新增 `case 'workspace': return dispatchWorkspace(rest, io)`，加進
  `COMMANDS` 清單與 `HELP` 文字。
- **把 `parseArgs`、`Args`、`VALUED` 三個目前模組內部（未 export）的符號
  加上 `export`**，供 `cli/workspace.ts` 重用——不在新檔裡重寫一份參數
  解析器。這三個符號只在 `src/cli/` 內部流通，不進 `src/index.ts`。

### `src/cli/workspace.ts`（新）

- **Responsibilities**：`nook workspace <list|doctor|studio>` 的 argv →
  Workspace → render → exit code。跟 `run.ts` 對單一 Board 的既有指令
  同一個薄度量級。
- **Interface**：
  - `dispatchWorkspace(argv, io): Promise<number>`
  - `list`：沿用 `Filter` 型別，對每個成員各呼叫一次
    `member.board.list(filter)`；空清單的成員整組略過不印
  - `doctor`：對每個成員呼叫 `member.board.health()`；`--fix` 時先對
    有 diagnostic 的成員呼叫既有、未經修改的 `repair(member.path)`
  - `studio`：`--port` 給 landing server；呼叫 `serveWorkspace(workspace, opts)`
- **Non-responsibilities**：不重新實作單一 Board 的任何指令邏輯、不碰
  `serve()`/`handleRequest()`。

### `src/render/table.ts`（擴充）

- 新增 `renderWorkspaceList(groups)`：
  ```ts
  export interface WorkspaceGroup {
    readonly path: string;
    readonly issues: readonly Issue[];
    readonly shortIdLen: number;
  }
  export function renderWorkspaceList(groups: readonly WorkspaceGroup[]): string;
  ```
  每組印一行路徑標頭 + 既有的 `renderTable(issues, shortIdLen)`，組間空一行。
  篩選後一張都沒有的組**整組不列出**；全部組都是空的才印一句彙整版的
  「沒有 issue」。**不重寫**既有的 grid／truncate／pad 邏輯——組合既有
  `renderTable`，不重新發明表格版面。

### `src/server/serveWorkspace.ts`（新）

- **Responsibilities**：`serveWorkspace(workspace, opts?): Promise<Studio>`——
  一個 landing HTTP server：`GET /` 列出全部成員（路徑 + 連結）；
  `GET /launch/<n>` 第一次被點時才呼叫既有、未經修改的
  `serve(members[n].board)`（各自獨立 ephemeral port），然後 302 redirect
  過去；重複點擊重用已啟動的那一個，不重複開 port。`close()` 一併關掉
  landing server 與所有已啟動的子 studio。
- **Non-responsibilities**：**完全不碰** `serve.ts`／`handler.ts`／studio
  前端。不合併任何看板畫面。
- **為什麼不用 path-prefix 掛載**：studio 前端的 fetch 是寫死的
  root-relative path（`/api/board`、`/i/<ref>`），把多個 Board 掛在同一個
  origin 的不同路徑下會讓所有子看板撞同一組 API path——每個成員各自一個
  port 是唯一不必改前端就能做到的形狀。
- **Seam**：同 `serve.ts`——真實 HTTP server、真實 port，不 mock。

### `src/index.ts`（擴充）

- 新增匯出：`openWorkspace`、`serveWorkspace`，型別
  `Workspace`、`WorkspaceMember`、`OpenWorkspaceOptions`。
- **不匯出** `renderWorkspaceList`／`WorkspaceGroup`（呈現，不是領域，
  同既有 `renderTable`／`renderJson` 不進公開面的理由）。

### `AGENT.md` / `README.md`（擴充）

- `AGENT.md` 至少要提到 `nook workspace`（`test/agent-doc.test.ts` 雙向
  比對 HELP 與 AGENT.md 提到的指令名，兩邊都要有）。
- `README.md` 新增「## workspace」一節，仿照既有「## private mode」／
  「## studio」的份量；「## Commands」表格加一行。

## Acceptance criteria

- [ ] 三層巢狀樹（`a/.issues/issues`、`a/b/.issues/issues`、
      `a/b/c/.issues/issues`）——`a` 是成員，`a/b`、`a/b/c` 都不是（找到
      `a` 就停止往下鑽）
- [ ] 起始目錄自己含 `.issues/issues/` 時也出現在 `members` 裡
- [ ] `node_modules/.issues/issues/`、`.git/.issues/issues/` 這種刻意造出來
      的路徑不會被列為成員
- [ ] symlink 目錄不被遞迴（造一個指回上層的環狀連結，掃描要能正常結束
      而非卡死或重複計算）
- [ ] 完全沒有任何成員時 `openWorkspace()` 不拋錯，`members` 是空陣列
- [ ] `members` 依 `path` 字典序排序，多次呼叫結果穩定
- [ ] `nook workspace list` 依路徑分組印出，套用 `--status`/`--label`/`--all`
      與單一 Board `list` 相同的篩選語意；篩選後整組為空的成員不列出
- [ ] `nook workspace list --json` 輸出可被解析、含路徑分組資訊
- [ ] `nook workspace doctor` 對多個成員各自的 diagnostic 都印得出來，
      任一個非空 exit 1；全部健康 exit 0
- [ ] `nook workspace doctor --fix` 真的呼叫每個需要的成員的 `repair()`
- [ ] `nook workspace studio` 印出 landing page 的 URL；打開 `/` 看得到
      全部成員的連結；點 `/launch/<n>` 之後可以對那個 port 正常操作
      既有 studio 的讀寫（拖曳、drawer）
- [ ] 兩次點同一個成員的連結重用同一個子 studio port，不重複啟動
- [ ] `close()` 之後 landing server 與全部已啟動的子 studio 的 port 都真的
      釋放
- [ ] `nook --help` 與 `AGENT.md` 都提到 `workspace`（`test/agent-doc.test.ts`
      綠燈）
- [ ] `npm run bench` 的 CLI bundle 零 React/studio 痕跡（ADR-0008 的既有
      保證不能被 `cli/workspace.ts` 破壞——它不得 import 任何 studio 或
      server 模組以外的重東西）

## Test strategy

- Seam：`openWorkspace()`（核心）、CLI 的 `dispatchWorkspace(argv, io)` +
  既有 `Io` capture adapter、`serveWorkspace()`（真實 HTTP）
- Test type：整合測試為主，沿用 ADR-0004——真實 `mkdtemp` 目錄樹、真實
  HTTP server，不引入 mock 檔案系統或 mock HTTP 的抽象層
- Dependency handling：全部真實。`serveWorkspace` 測試沿用
  `test/server/serve.test.ts` 的手法（開真的 server、打真的 fetch、記得
  `close()`）

## Verification

```bash
npx vitest run test/core/workspace.test.ts      # 票 01
npx vitest run test/cli/workspace.test.ts       # 票 02/03/04
npx vitest run test/server/serveWorkspace.test.ts  # 票 04
npx vitest run                                   # 完整 suite
npx tsc --noEmit                                 # 型別
```

`npm run bench` 由整合者在票 05 之後統一跑一次（同既有慣例：它會清掉
整個 `dist/`）。

## Baseline

2026-09-11，branch `main`（`6382c63`）實測：

- **687 tests passed / 39 files passed**
- **0 型別錯誤**（`npx tsc --noEmit`）
- 既有失敗：**無**。不要修任何不在你票上的東西。

## Risks and deferred questions

- **`.scratch/` 之外，CONTEXT.md 與 ADR-0012 已經在規劃階段直接寫入磁碟**
  （domain-modeling 的既有慣例：詞彙定案就地寫，不批次延後）。這兩個檔案
  目前是**未 commit** 的工作樹變更；建議跟票 01 的 commit 一起帶上，或者
  你想現在就先單獨 commit 也可以——這個決定留給你。
- **未來的可寫入能力**：規劃階段刻意排除。核准這份 board 之後，我會另外
  建一張 `backlog` 狀態的 nook issue（label `workspace`、`future`）記錄
  「Workspace 層級的 new/set/mv——寫入該路由到哪個成員」這個未解問題，
  避免它被忘記，但不會混進這次的五張執行票。
- **`serveWorkspace` 的 landing page 標記語言**：規劃階段沒有定案要不要
  重用 studio 現有的 CSS/字型，還是純手寫 HTML。這是票 04 實作時的細節，
  不影響公開介面，留給那張票決定。
