# Spec — `.gitnook/` 統一佈局、Workspace 可選遞迴掃描、Decision 加入 Workspace

> **執行模式：parallel。** 發布目標：既有的 nook board（`.issues/`，這批落地後變成
> `.gitnook/issues/`）。分支：待定。

## Problem

使用者在一個「母資料夾底下並排幾個獨立 repo」的非正式 monorepo（`multi-vr`，底下
8 個子 repo）誤在母資料夾跑了 `nook issue init`。`nook workspace` 的遞迴掃描
（`src/core/workspace.ts` 的 `scan()`：找到一個含 `.issues/issues/` 的目錄就不再
往它底下更深處找）把 8 個子 repo 的 board 全部靜默遮蔽掉——不報錯，只是掃到 1 個
成員而不是 9 個。

追根究底，這暴露三個各自獨立、但彼此牽連的缺口：

1. **Workspace root 自己想要有 issue/ADR 時，沒有辦法不遮蔽底下的成員。** 掃描邏輯
   把「找到就停」無條件套用在每一層，包括使用者主動要求的 workspace root 本身。
2. **Issue 跟 Decision 是兩個完全獨立的模組，各自要 init、各自的 Sharing 狀態。**
   Decision 從來沒有 private 模式；一個 board 想要「issue shared、decision
   private」或反過來都做不到一致的心智模型，兩次 init 也容易漏掉一次。
3. **Decision 完全不在 Workspace 概念裡。** `WorkspaceMember` 只包 `Board`，
   `nook workspace` 底下沒有任何 `decision` 子指令——想跨 repo 看 ADR，只能一個一
   個 `cd` 進去。

## Outcome

- `nook init [--private] [--workspace]` 是唯一的初始化入口，一次把 issues 跟
  decisions 兩個模組都準備好（新建或補齊，冪等），可選擇 private（整個
  `.gitnook/` 不進 git 追蹤）與 workspace（標記這個目錄在遞迴掃描時繼續往下鑽）。
- 一個目錄底下同時有 `.gitnook/`（自己的 issue/ADR）與子目錄各自的
  `.gitnook/`，`nook workspace` 兩層都看得到，不再互相遮蔽。
- `nook workspace decision list/new/set/show/history` 對稱於既有的
  `nook workspace list/new/set`，讓跨 repo 彙整 ADR 跟彙整 issue 一樣一等公民。
- 舊版 `.issues/`／`.decisions/` 佈局的使用者，指令會清楚告訴他們要跑哪幾條
  `git mv`，而不是靜默失敗或莫名其妙找不到 board。

## Scope

- 新的統一初始化入口 `initNook()`（`src/core/gitattributes.ts`），CLI 掛在裸的
  `nook init [--private] [--workspace]`。
- `.issues/issues/` → `.gitnook/issues/`，`.decisions/decisions/` →
  `.gitnook/decisions/`，新增 `.gitnook/config.json`（`{ "workspace"?: boolean }`）
  與對應的讀寫模組 `src/core/nookConfig.ts`。
- `src/core/sharing.ts` 從「以 `.issues` 為中心」改成「以 `.gitnook` 為中心」——
  一條 exclude 規則蓋住整個 `.gitnook/`，`opLogsTracked`/`ignoredByGit` 改為對
  issues、decisions 兩個 op-log 目錄各自窄探測、OR 起來。
- `src/core/workspace.ts`：`hasBoard()` 改判斷 `.gitnook/` 存在；`scan()` 找到
  board 後讀 `.gitnook/config.json` 的 `workspace` 欄位決定要不要繼續往下鑽；
  `WorkspaceMember` 加 `decisionLog`；新增 `locateDecisionInWorkspace()`。
- `lazyDecisionLog()` 從 `src/server/serve.ts` 私有函式升級為
  `src/core/decisionLog.ts` 匯出的共用函式，`serve.ts` 與 `workspace.ts` 都改用它。
- `src/cli/workspace.ts` 新增 `decision` 子指令家族：`list/new/set/show/history`。
- `src/render/table.ts` 新增 `renderWorkspaceDecisionList`/`WorkspaceDecisionGroup`。
- `src/core/health.ts` 新增 `InvalidNookConfig` 診斷；既有 `knownEntities`/
  `repair()` 的路徑常數改指向 `.gitnook/...`。
- 舊版佈局偵測：找不到 `.gitnook/` 但找到舊版 marker 時，錯誤訊息附上可直接複製
  貼上的 `git mv` 指令。
- `nook issue init`、`nook decision init` 整個移除，不留相容別名。
- ADR-0012 補一條 superseded 的新 Decision；CONTEXT.md 的 Workspace 詞條更新。

## Non-goals

- **不做自動搬移工具。** 舊版 `.issues/`／`.decisions/` → `.gitnook/` 的搬遷由使用
  者自己跑錯誤訊息附的 `git mv` 指令，nook 不執行任何會寫入的 git 指令（既有原則）。
- **不支援「issue shared、decision private」混搭。** Sharing 是整個 `.gitnook/`
  一份狀態。以後真的有需求再評估要不要拆開。
- **`nook init` 沒有解除 workspace flag 的路徑。** `--workspace` 只會把
  `.gitnook/config.json` 的 `workspace` 設成 `true`，不會設回 `false`。要關掉這
  個標記需要另一個未來的指令，這次不做。
- **Decision 的 `repair()`（黏合行修復）不擴及 decision 側。** 這是既有、與這次
  改動無關的落差（`nook doctor` 對它的診斷本來就已經涵蓋，缺的只有自動修復），
  不在這次範圍內。
- **`nook workspace doctor` 不用改。** 它呼叫的 `member.board.health()` 本來就
  同時涵蓋 issue 與 decision 側的零衝突保證診斷。
- **「頂層資料夾完全沒有 git」不特別處理。** 這是既有行為（任何 board 在 git repo
  外都是如此），`doctor` 的 `NotAGitRepo` 診斷維持現狀，不因為這次改動而調整。
- **不做跨 board 的 Decision ref 解析以外的功能**（例如不做 `nook workspace
  decision doctor`、不做 decision 專屬的 `mv`/`label`/`comment`——單一 board 的
  `nook decision` 本來就沒有這些）。

## Domain decisions

- **`.gitnook/`** 是一個 Board（Issue 集合）與 Decision Log（Decision 集合）共用
  的容器目錄，取代原本各自獨立的 `.issues/`、`.decisions/`。這不改變 CONTEXT.md
  裡 Board 與 Decision Log「不共用儲存或介面」的既有定義——兩者的資料格式、
  marker 子目錄、gitattributes 規則都還是各自獨立的兩份，只是放進同一個父目錄。
- **Sharing 收斂成 board 層級一份狀態**，覆蓋整個 `.gitnook/`，不分模組。
  CONTEXT.md 的 Sharing 詞條本來就是以 board 為單位在講這件事，這個改動讓實作與
  既有詞彙定義對齊。
- **Workspace 詞條補充**：探測邏輯預設仍是「找到 Board 就不再往它底下更深處找」
  （純檔案系統掃描，不需要設定檔）；但一個 Board 可以透過 `.gitnook/config.json`
  的 `workspace: true` 主動宣告自己也是一個 workspace 節點，此時掃描會繼續往它
  底下鑽。這是有意識地重新打開 ADR-0012 當時拒絕的「加一份設定檔控制掃描行為」，
  需要一條新 Decision 記錄取捨並把 ADR-0012 標成 superseded（ADR-0012 拒絕的是
  「排除清單」方向，這次做的是「continue-scanning 旗標」方向——同一個「要不要加
  設定檔」的判斷被重新打開，但解的是不同方向的問題，新 Decision 裡要把這個區別
  講清楚）。

## Design contract

### `src/core/gitattributes.ts`

- **Responsibilities**：marker 目錄佈局（`.gitnook/issues`、`.gitnook/decisions`）、
  gitattributes 的 merge=union 保證（issues、decisions 各自一條，不合併）、統一的
  init 入口。
- **Non-responsibilities**：sharing 機制（`sharing.ts`）、workspace 掃描
  （`workspace.ts`）、`.gitnook/config.json` 的形狀（`nookConfig.ts`）。
- **Interface**：
  ```ts
  export interface InitResult {
    readonly issues: 'created' | 'unchanged';
    readonly decisions: 'created' | 'unchanged';
    readonly gitattributes: 'created' | 'added' | 'unchanged'; // 只在 shared 模式有意義
    readonly workspace: 'enabled' | 'unchanged';
    readonly sharing: Sharing;
  }
  export function initNook(
    dir: string,
    opts?: { readonly sharing?: Sharing; readonly workspace?: boolean },
  ): InitResult;
  ```
  `ISSUES_DIR`/`DECISIONS_DIR`/`MERGE_RULE`/`DECISION_MERGE_RULE`/
  `OP_LOG_SAMPLE`/`DECISION_LOG_SAMPLE` 四個路徑常數改指向 `.gitnook/...`。
  `findBoardRoot`/`findDecisionRoot` 維持既有簽章，只是 marker 路徑換了。
- **不變量**：
  - `NestedBoard` 檢查只做一次，涵蓋兩個模組（不像現在 `initBoard`/
    `initDecisionRoot` 各自查一次）。
  - `opts.workspace` 是 additive-only：`true` 確保為 `true`，`undefined` 不動既
    有值，沒有「設回 false」的路徑。
  - private 模式：`AlreadySharedBoard`/`NoGitDir` 兩種拒絕排在任何寫入之前；
    `excludeBoard()` 排在建目錄之前；`.gitattributes` 完全不碰（同現有 private
    模式的既有紀律）。
  - shared 模式：`ConflictingGitAttributes` 排在建目錄之前；issues、decisions
    兩條 merge=union 規則各自冪等寫入。
- **Seam**：`initNook()` 本身，真實檔案系統（ADR-0004）。

### `src/core/nookConfig.ts`（新檔）

- **Responsibilities**：`.gitnook/config.json` 的讀寫，容錯（格式錯誤時安全失敗）。
- **Non-responsibilities**：不驗證 `.gitnook/` 本身存不存在，不知道 workspace 掃描
  或 init 的語意，純粹是一個小型 config 檔案存取層。
- **Interface**：
  ```ts
  export interface NookConfig {
    readonly workspace?: boolean;
  }
  export function readNookConfig(dir: string): NookConfig; // 檔案不存在或無法解析 → {}
  export function writeNookConfig(dir: string, config: NookConfig): void; // 整檔覆寫
  ```
- **不變量**：`readNookConfig` 對「檔案不存在」與「檔案存在但不是合法 JSON／不是
  物件」一律回傳 `{}`，不拋錯——熱路徑（`scan()`）不能因為一個壞掉的 config.json
  整個掛掉。格式錯誤的偵測與回報是 `health.ts` 的事（見下方）。
- **Seam**：模組公開函式本身，真實檔案系統。

### `src/core/sharing.ts`

- **公開介面不變**：`excludeBoard(root)`/`unexcludeBoard(root)`/
  `inspectSharing(root)`/`opLogsTracked(root)`/`ignoredByGit(root)`/
  `overridingRule(root)`，簽章一個字元都不改。
- **內部改動**：
  - `boardPattern()`：`/${prefix}.issues/` → `/${prefix}.gitnook/`。
  - `overridingRule()` 探測目標：`.issues` → `.gitnook`（維持單一探測，語意更
    簡單，因為現在只有一個容器目錄要顧）。
  - `opLogsTracked()`：內部拆成對 `.gitnook/issues`、`.gitnook/decisions` 兩個
    op-log 目錄**各自**做既有的窄探測（`git ls-files --error-unmatch`），OR 起來
    ——任一個被追蹤就算 `true`。**不**探測 `.gitnook/config.json`，維持現有「只
    問 op-log 本身，不問容器目錄」的假陽性防護（一個被 commit 的 config.json 不
    該讓「已共享」誤判成立，同現有對 `.gitkeep`／README 的防護邏輯）。
  - `ignoredByGit()` 的 `ignoreProbe()`：依序嘗試 issues op-log 目錄底下的檔案、
    decisions op-log 目錄底下的檔案，都沒有時退回 `.gitnook/issues` 這個目錄路徑
    本身（維持既有「保守退回」邏輯，只是候選來源從一個變兩個）。
- **Seam**：模組公開函式本身，真實檔案系統 + 真實 git 子行程（ADR-0004 既有做
  法，不 mock）。

### `src/core/workspace.ts` / `src/core/types.ts`

- **Interface 變動**：
  ```ts
  export interface WorkspaceMember {
    readonly path: string;
    readonly board: Board;
    readonly decisionLog: DecisionLog; // 新增
  }
  export function locateDecisionInWorkspace(
    workspace: Workspace,
    ref: string,
  ): { readonly member: WorkspaceMember; readonly decision: Decision };
  ```
- **不變量**：
  - `hasBoard(dir)` 改為 `existsSync(join(dir, '.gitnook'))`。
  - `scan()`：`hasBoard(dir)` 為 true 時，讀 `readNookConfig(dir).workspace`——
    falsy（含檔案不存在）維持「找到就停」；`true` 繼續往下掃子目錄，子目錄裡遇到
    的 board 遞迴套用同一條規則（不特殊化「呼叫端傳入的那個 root」，這個特性掛在
    board 自己身上，不管從哪一層 cwd 呼叫 `openWorkspace()` 結果都一致）。
  - `WorkspaceMember.decisionLog` 用 `lazyDecisionLog(board)`（見下方）建構，惰性
    問 `board.root()`，不快取。
  - `locateDecisionInWorkspace()` 要求完整 26 碼 ref（`isFullRef`，不合格式時丟
    `IncompleteRef`，沿用既有型別），命中 0 個丟 `DecisionRefNotFoundInWorkspace`
    （新型別），命中 >1 個丟 `AmbiguousDecisionWorkspaceRef`（新型別）——不重用
    `RefNotFoundInWorkspace`/`AmbiguousWorkspaceRef`，理由見下方 Risks。
- **Seam**：`openWorkspace()`/`locateDecisionInWorkspace()` 本身，真實檔案系統
  （ADR-0004）。

### `src/core/decisionLog.ts`

- **新增匯出**：
  ```ts
  export function lazyDecisionLog(board: Board): DecisionLog;
  ```
  從 `src/server/serve.ts` 的私有 `lazyDecisionLog()` 原樣搬過來（惰性、每次呼叫
  才問 `board.root()`、不快取），`serve.ts` 改成 `import` 這個共用版本。`workspace.ts`
  用同一個函式建構每個成員的 `decisionLog`。

### `src/core/health.ts`

- **新增**：`DiagnosticKind` 加一個 `'InvalidNookConfig'`；`diagnose()` 在
  `.gitnook/config.json` 存在但 `readNookConfig` 判定為「無法解析」時（需要一個
  內部的、比 `readNookConfig` 更誠實的解析函式，或是 `readNookConfig` 額外提供一
  個「有沒有解析失敗」的旗標——留給設計 ticket 時決定精確形狀）推一條診斷，訊息
  講清楚檔案壞在哪、workspace 掃描會因此停在這裡。
- **既有路徑常數**改指向 `.gitnook/issues`（`repair()`、`knownEntities` 裡的
  issues 那一條）、`.gitnook/decisions`（`knownEntities` 裡的 decisions 那一條）。
  `knownEntities` 的 per-entity `active` 閘門維持不動（legacy board 遷移過程中兩
  個模組不一定同時存在，這個閘門仍然有意義）。

### `src/cli/run.ts`

- 新增 `case 'init': return cmdInit(parseArgs(rest, INIT_FLAGS), io)`，
  `INIT_FLAGS = new Set(['--private', '--workspace'])`。
- 從 `LEGACY_ISSUE_COMMANDS` 移除 `'init'`；`COMMANDS` 加入 `'init'`。
- 新 `cmdInit` 呼叫 `initNook()`，依 `InitResult` 印出 Created/Unchanged 三分法
  輸出（沿用現有 `cmdInit`／`initPrivate` 的既有措辭風格），private 模式額外印出
  既有那句 `git clean -xdf` 警語。

### `src/cli/issue.ts` / `src/cli/decision.ts`

- 移除各自的 `cmdInit` 與 `case 'init'` 分支。`issue.ts` 的其餘 10 個子指令、
  `decision.ts` 的 `new/list/show/set/history` 不動。

### `src/cli/workspace.ts`

- `dispatchWorkspace()` 新增 `case 'decision': return dispatchWorkspaceDecision(rest, io)`。
- 新函式 `dispatchWorkspaceDecision(argv, io)`：
  - `list [--disposition <d>] [--json]`——比照 `cmdList`（issue 版），對每個成員
    呼叫 `member.decisionLog.list(filter)`，空清單成員略過不印。decision log 尚
    未初始化的成員（legacy 過渡期）視為「零 decision」，不是錯誤。
  - `new --title <t> [--body <b>] [--disposition <d>] --in <path>`——比照
    `cmdNew`，`memberAt()` + `decisionLog.create()`。
  - `set <ref> <title|body|disposition|supersededBy> <value|-> [--editor]`——比照
    `cmdSet`，`requireFullRef()` + `locateDecisionInWorkspace()` +
    `decisionLog.apply()`。
  - `show <ref> [--json]`／`history <ref> [<field>]`——新形狀（issue 側 workspace
    指令沒有這兩個可以照抄），`locateDecisionInWorkspace()` 找到成員後委派給既有
    的 `renderDecisionDetail`/`renderDecisionSetOps` 等既有 render 函式。

### `src/render/table.ts`

- 新增：
  ```ts
  export interface WorkspaceDecisionGroup {
    readonly path: string;
    readonly decisions: readonly Decision[];
    readonly shortIdLen: number;
  }
  export function renderWorkspaceDecisionList(groups: readonly WorkspaceDecisionGroup[]): string;
  ```
  與既有 `renderWorkspaceList`/`WorkspaceGroup` 平行、不合併成 generic 版本
  （issue／decision 的欄位形狀本來就不同，`renderTable`/`renderDecisionTable`
  已經是兩個獨立函式）。

### 文件

- `CONTEXT.md` 的 Workspace 詞條補一句（見上方 Domain decisions）。
- README、AGENT.md：`## workspace` 一節補上 `decision` 子指令；`nook init` 取代
  `nook issue init`/`nook decision init` 的說明；`.gitnook/` 佈局說明取代
  `.issues/`/`.decisions/`。
- 一條新 Decision 記錄 ADR-0012 被 superseded（`nook decision new`），並把
  ADR-0012 的 `supersededBy` 設成這條新 ref。

## Acceptance criteria

- [ ] `nook init` 在一個全新目錄同時建立 `.gitnook/issues/`、`.gitnook/decisions/`
      與兩條各自的 `merge=union` 規則
- [ ] `nook init` 在已存在的 board 上重跑是冪等的（Unchanged），且會補齊缺的那
      一半（只有 issues 沒有 decisions 的舊 board，重新以新佈局 init 後兩者都在）
- [ ] `nook init --private` 整個 `.gitnook/` 被 `$GIT_DIR/info/exclude` 排除，
      一條規則涵蓋 issues 與 decisions 兩者；`.gitattributes` 完全不碰
- [ ] `nook init --private` 在 op-log 已被 git 追蹤時（issues 或 decisions 任一）
      丟 `AlreadySharedBoard`；不在 git work tree 內時丟 `NoGitDir`
- [ ] `nook init --workspace` 在 `.gitnook/config.json` 寫入 `workspace: true`；
      對已經是 `true` 的目錄重跑是 Unchanged；沒有 `--workspace` 的重跑不會把已
      經是 `true` 的值改回 `false`
- [ ] `nook issue init`、`nook decision init` 不存在，跑了得到清楚指向
      `nook init` 的錯誤訊息
- [ ] 三層目錄樹：root 自己 `--workspace` init 過且有 issue，`root/a` 也
      `--workspace` init 過且有 issue，`root/a/b`（沒有 `--workspace`）也有
      issue——`openWorkspace({dir: root})` 找到全部三個成員；`root/a/b` 底下即
      使還有更深的 board 也不會被列出（`root/a/b` 沒掛 workspace flag，維持「找
      到就停」）
- [ ] Workspace root 已 `--workspace` init、底下子目錄完全沒有 init 過：
      `openWorkspace()` 不拋錯，只回傳 root 自己一個成員
- [ ] `.gitnook/config.json` 格式錯誤（不是合法 JSON）時，`scan()` 把該目錄當
      「找到就停」處理（不當機、不當成 workspace root），且 `nook doctor` 在該
      目錄報一條 `InvalidNookConfig` 診斷、exit 非 0
- [ ] 舊版 `.issues/issues/`（可能還有 `.decisions/decisions/`）存在、
      `.gitnook/` 不存在時，`nook list`（或任何需要 board 的指令）的錯誤訊息附
      上可直接複製貼上的 `git mv .issues/issues .gitnook/issues`（若有 decisions
      同理再附一行）
- [ ] `nook workspace list` 在有 `--workspace` root 與底下子 board 混合的樹裡，
      依成員分組列出全部 issue（既有行為，只是現在能看到更多層）
- [ ] `nook workspace decision list [--disposition <d>] [--json]` 依成員分組列
      出全部 decision，篩選與空群組略過語意同 issue 版
- [ ] `nook workspace decision new --title <t> --in <path>` 在指定成員建立一筆
      decision，印出完整 ref
- [ ] `nook workspace decision set <ref> <field> <value>` 能在不知道 ref 屬於哪
      個成員的情況下改到正確的那一筆，欄位限定 `title/body/disposition/supersededBy`
- [ ] `nook workspace decision show <ref>`／`history <ref>` 對存在於某個成員的
      完整 ref 給出正確結果；ref 格式不完整丟 `IncompleteRef`；沒有任何成員擁有
      該 ref 丟 `DecisionRefNotFoundInWorkspace`；多個成員同時擁有（理論上不會發
      生，因為 ULID 不會撞號，但要跟 `locateInWorkspace` 對稱測到這條路徑）丟
      `AmbiguousDecisionWorkspaceRef`
- [ ] `nook workspace doctor` 在 decision 側 merge=union 規則缺失時照樣報出診斷
      （沿用既有 `board.health()`，不需要新程式碼，這裡驗證的是「不需要新程式
      碼」這個假設本身成立）
- [ ] `nook studio`／`nook workspace studio` 在新佈局下正常讀寫 issue 與 decision
      （既有 studio 前端完全不動，只驗證後端路徑接得上新的 `.gitnook/` 佈局）
- [ ] `npm run bench` 的 CLI bundle 零 React/studio 痕跡（既有保證不能被這次改動
      破壞）

## Test strategy

- Seam：`initNook()`、`readNookConfig()`/`writeNookConfig()`、`sharing.ts` 六個
  公開函式、`openWorkspace()`/`locateDecisionInWorkspace()`、
  `dispatchWorkspaceDecision(argv, io)` + 既有 `Io` capture adapter、既有
  `serve()`/`serveWorkspace()`（真實 HTTP，驗證新路徑接得上）
- Test type：整合測試為主，沿用 ADR-0004——真實 `mkdtemp` 目錄樹、真實檔案系統、
  真實 git 子行程（`sharing.ts` 那幾個會 spawn git 的函式）、真實 HTTP server，
  不引入 mock fs／mock git／mock HTTP 的抽象層
- Dependency handling：全部真實

## Verification

- Focused：依票而定，例如 `npx vitest run test/core/gitattributes.test.ts`、
  `npx vitest run test/core/workspace.test.ts`、
  `npx vitest run test/cli/workspace.test.ts` 等（各票在自己的 ticket 檔案裡列
  出對應的檔案）
- Suite：`npx vitest run`
- Static：`npx tsc --noEmit`
- E2E：None（`npm run bench` 屬於 Suite 的一部分，由整合者在最後一批之後統一跑
  一次，同既有 workspace 那一輪的慣例）

## Baseline

2026-09-16，branch `main`（`6cd7a55`）實測：

- **53 files / 964 tests passed**
- **0 型別錯誤**（`npx tsc --noEmit`）
- 既有失敗：**無**。不要修任何不在你票上的東西。

## Risks and deferred questions

- **`InvalidNookConfig` 的精確偵測方式還沒定案。** `readNookConfig()` 對外承諾
  「格式錯誤一律安全失敗成 `{}`」，但 `health.ts` 需要另一種方式分辨「檔案不存
  在」（正常）跟「檔案存在但壞掉」（要報診斷）。實作時二選一：(a) `nookConfig.ts`
  多匯出一個 `inspectNookConfig()` 回傳更細的狀態（`absent`/`valid`/`malformed`），
  `readNookConfig()` 疊在它上面；(b) `health.ts` 自己重新讀檔判斷。傾向 (a)——
  跟 `sharing.ts` 的 `inspectSharing()` vs. 內部細節那種分層一致——但留給對應的
  ticket 在寫測試時拍板，不預先鎖死。
- **`locateDecisionInWorkspace()` 的兩個新錯誤型別要放在哪個檔案。** 比照
  `RefNotFoundInWorkspace`/`AmbiguousWorkspaceRef` 現在放在 `src/core/types.ts`，
  這兩個新的大概率也該放那裡，但 Decision 相關型別目前集中在
  `src/core/decisionTypes.ts`——兩個既有慣例在這裡第一次衝突，留給實作的 ticket
  判斷，兩邊都說得通，不影響公開介面本身。
- **這是一次 breaking change，沒有自動遷移。** 任何現有跑過 `nook init`／
  `nook decision init` 的使用者，這次落地後得手動 `git mv` 才能繼續使用——包含
  nook 自己的 repo（這個 board 自己也要搬）。最後一張票之後需要人工確認 nook 自
  己的 `.issues/`／`.decisions/` 已經搬移，並重新驗證 `npm run bench`。
- **Sharing 混搭（issue/decision 各自狀態）被排除在這次範圍外，但需求可能之後
  出現。** 如果之後真的有人要「issue shared、decision private」，那是一次獨立
  規劃，不是這次順手加的旗標。
