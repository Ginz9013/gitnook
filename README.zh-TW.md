# gitNook

*[English](README.md)*

一個隨 git 走、為 agent 而寫的 issue tracker。Issue 是你 repo 裡的純文字檔，
它們跟著分支走，而且**兩個人在兩條分支上改同一張 Issue，合併時不會衝突**。

```bash
npm i -D gitnook
npx nook init                                           # .gitnook/ + 兩條 .gitattributes 規則
npx nook issue new "修掉 Safari 上的登入轉址迴圈"
npx nook issue list
```

想在一個不是你說了算的 repo 裡導入？`npx nook init --private` 給你同一塊
board，但**零 committed bytes** —— 不會出現在任何人的 diff、review 或 clone 裡，
所以現在還不必跟任何人解釋它。見 [private mode](#private-mode)。

沒有資料庫。沒有原生 binary。沒有常駐程式。沒有帳號。**CLI 零執行期相依**，
安裝時也零間接相依套件。

## 為什麼是 gitNook

**Issue 住在工作目錄裡。** `.gitnook/issues/*.ndjson` 是普通的、被 commit 的檔案。
GitHub 的網頁 UI 會在 diff 裡顯示它們，`grep` 找得到它們，agent 可以 `cat` 一張
而不必對外呼叫任何工具，而一條分支會把它的 Issue 連同「關掉它們的那些程式碼」一起
帶著走。

**兩條分支改同一張 Issue，合併時不會衝突。** 每張 Issue 是一份只增不改、由一堆
小操作組成的紀錄，讀取時摺疊的是那些操作的**集合** —— 檔案裡的順序無關緊要。
正是這一點讓 git 內建的 `union` 合併驅動能做這件事：commit 一行
`.gitattributes` 就是全部的設定，對每一個 clone 都成立，團隊裡沒有任何人需要
跑 `git config`。

**儲存格式就是資料模型。** 一行一個 JSON 物件，欄位有型別 —— 不是一段要再被
解析回欄位的散文，所以沒有「標題慣例」會壞掉，也沒有來回轉換會遺失資訊。

**它像一個普通的 dev dependency 一樣安裝。** 沒有各平台一份的原生 binary，
沒有常駐程式，沒有帳號，也沒有衍生的本機狀態需要寫進 `.gitignore`。

**兩個介面讀的是同一批檔案。** CLI 可組合、而且精簡到能待在 agent 的 token
預算裡；`nook studio` 是給人看的本機看板。兩者都不是另一個的快取。

**它拒絕變成一個專案管理工具。** 沒有負責人（Actor 是「誰寫了這個操作」，不是
「誰負責這件事」）、沒有優先級／里程碑／到期日（用 Label）、沒有可自訂的
Status、沒有子任務、沒有搜尋 UI、沒有 MCP server。有些團隊會想要第九個
Status —— 答案是一個 Label。對那個要求說不，正是這個產品。

## 模型

**Status** —— 八個，固定：

```
backlog  todo  queued  in_progress  review  blocked  done  cancelled
```

`backlog` 與 `todo` 是**人的車道**；`queued` 之後是 **agent 的車道**。`queued`
是交接閘門：把一張 Issue 移進 `queued` 表示需求已經釘死，而且**已授權 agent
不再詢問直接動手**。它是一條授權邊界，不是一個分類桶。

`blocked` 就只是一個 Status，不帶任何附加規則 —— 不強制留言，也沒有閘門。
`archived` 是一個欄位，不是 Status：歸檔是**可見性**，`done`／`cancelled` 是
**工作結果**，兩者正交。

**Ref 是 ULID。** 任何接受 id 的地方都接受任何無歧義的前綴，就像 git 的短
hash；有歧義時是一個列出候選的錯誤，永遠不是一次無聲的猜測。Status 也接受
前綴（`que` → `queued`）。

## private mode

```bash
npx nook init --private            # 一塊零 committed bytes 的 board
```

這會把 board 完全留在 git 之外（寫進 `$GIT_DIR/info/exclude`，永遠不是你的
`.gitignore`）。之後 `git status` 與 `git ls-files` 都是空的：零 committed
bytes，所以不會出現在任何人的 diff、review 或 clone 裡。

它買到的是社交足跡為零，不是技術相容性 —— 讓你能在一個不是你說了算的 repo 裡
先試用 gitNook，不必先經歷「這是什麼東西」那場對話。它是一個試用／單人模式，
不是與 shared 對等的第二種玩法，而且確實放棄了一些東西：

- `git clean -xdf` 會刪掉整塊 board，而且沒有備份。
- Issue 不再跟著分支走 —— 一塊 board，這個工作目錄的每一條分支都共用。
- git worktree 之間看不到彼此的 board。
- 換一台機器或重新 clone，什麼都沒有；沒有任何同步機制。

`nook issue share` 把一塊 private board 升級回共享：它補回 `merge=union`
那一行，並印出 `git add`／`git commit` 讓你自己執行 —— nook 不執行任何會
寫入的 git 指令。

其餘一切在 `nook issue <verb>` 底下照常運作 —— 見[指令](#指令)。

## 指令

```
init [--private] [--workspace]         建立 .gitnook/issues/ 與 .gitnook/decisions/
                                        （兩個模組一次到位）與各自的 .gitattributes
                                        規則；--private 改成不留任何 committed bytes；
                                        --workspace 標記這個目錄，讓遞迴掃描遇到它
                                        時不要停下來、繼續往下鑽
issue new <title> [--description <text|->] [--label <l>] [--editor]
issue list [--all] [--status <s>] [--label <l>] [--json]
issue show <ref> [--json]
issue history <ref> [<field>]          某個 LWW 欄位被寫過的每一個值，唯讀
issue set <ref> <title|description|status|archived|deleted> <value|->  [--editor]
issue mv <ref> <status>
issue rm <ref> [--yes]                 刪除：寫一筆墓碑，永不 unlink
issue comment <ref> <body|->
issue label <ref> +bug -ui
issue share                            把一塊 private board 升級回共享
decision new --title <t> [--body <b>] [--disposition <d>]
decision list [--disposition <d>] [--json]
decision show <ref> [--json]
decision set <ref> <title|body|disposition|supersededBy> <value|-> [--editor]
decision history <ref> [<field>]       某個欄位被寫過的每一個值，唯讀
doctor [--fix]                         資料健康檢查；--fix 修復黏合行
studio [--port <n>]                    localhost 上的看板；可新增、拖拉、編輯、留言
workspace list|doctor|studio           跨 repo，唯讀 —— 見下面的 workspace
workspace new <title> --in <path> [--description <text|->] [--label <l>] [--editor]
workspace set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
workspace mv <ref> <status>            <ref> 只接受完整 ULID —— 見下面的 workspace
workspace comment <ref> <body|->       <ref> 只接受完整 ULID —— 見下面的 workspace
workspace label <ref> +bug -ui         <ref> 只接受完整 ULID —— 見下面的 workspace
workspace rm <ref> [--yes]             <ref> 只接受完整 ULID —— 見下面的 workspace
workspace decision list|new|set|show|history   跨 repo 的 Decision —— 見下面的 workspace
```

`nook decision` 是第二個、並行的紀錄，用來存放 ADR（架構決策紀錄）—— 同一套
append-only 形狀與 `merge=union` 保證，住在 `.gitnook/decisions/`，跟
`.gitnook/issues/` 放在一起，刻意做得比 Issue 小（沒有 label、comment 或
封存）。它自己沒有獨立的 private mode —— Sharing 是整個 `.gitnook/` 目錄
一份狀態，`nook init --private` 與 `nook issue share` 兩個模組一起涵蓋。
Decision 有的是 `disposition`（`proposed`/`accepted`/`superseded`/
`rejected`），不是工作流的 `status`。

值的位置寫 `-` 表示從 stdin 讀。

## studio

```bash
npx nook studio
```

給人用的介面，跑在 `127.0.0.1` 上。八個欄位可以把 Issue 拖來拖去 —— 一個
Status 一欄，不多不少 —— 每張 Issue 有一個抽屜可以編輯標題、描述、Label、
Status 與留言。header 上的按鈕與每一欄的 `+` 只問標題就能新增一張 Issue；
抽屜裡可以歸檔或刪除（刪除寫的是 `nook issue rm` 寫的那同一筆墓碑 —— 卡片
離開看板，檔案留在磁碟上）。主題切換提供亮色、暗色與跟隨系統。

寫入走的是 CLI 寫的那同一份只增不改的紀錄，所以 CLI 與 studio 可以同時開著；
兩秒一次的輪詢就地套用變更，不會重新載入頁面。studio 沒有任何驗證，只綁
loopback —— 它是一個單機、單人工具，從來就不是設計來跨網路共享的。

## workspace

```bash
cd path/to/the/parent/folder
npx nook workspace list
```

一個 monorepo 底下的各個套件，或是一個資料夾裡剛好並排放著幾個不相干的
repo —— 不管是哪一種，`nook workspace` 都能給你一份跨越目前目錄底下所有
偵測到的 board 的唯讀彙整視角。它是一個**檢視角度**，不是新的一種儲存：
不建立、不合併、不快取任何東西，每個成員 board 完全維持自己的紀錄、actor
身分與 sharing 狀態，就跟你單獨開它一樣。

- `nook workspace list [--all] [--status <s>] [--label <l>] [--json]` ——
  依路徑分組列出每個成員的 issue，一個成員一張表。
- `nook workspace doctor [--fix]` —— 對每個成員各跑一次跟 `nook doctor`
  一樣的健康檢查。
- `nook workspace studio [--port <n>]` —— 一個入口頁，列出每一個成員；點
  其中一個就會啟動那個成員自己、完全沒被改動過的 `nook studio`。

還有六個子指令會寫入，各自被路由到它所屬的那一個成員：

```
nook workspace new <title> --in <path> [--description <text|->] [--label <l>] [--editor]
nook workspace set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
nook workspace mv <ref> <status>
nook workspace comment <ref> <body|->
nook workspace label <ref> +bug -ui
nook workspace rm <ref> [--yes]
```

`new` 沒有既有的 ref 可以拿來路由，所以改用 `--in <path>`。其餘五個都吃一個
ref —— 必須是**完整的 26 碼 ULID**，因為一個在某個成員的 board 裡無歧義的
前綴，可能剛好撞上另一個成員裡一張不相干的 issue。其餘語意跟單一 board 的
指令完全一致。

`nook workspace decision <list|new|set|show|history>` 是同一套邏輯套用在
Decision 而不是 Issue 上：

- `nook workspace decision list [--disposition <d>] [--json]` —— 依路徑分組
  列出每個成員的 decision；篩選與空群組略過的語意同 `nook workspace list`。
- `nook workspace decision new --title <t> [--body <b>] [--disposition <d>]
  --in <path>` —— 在 `<path>` 那個成員建立；`--in` 必填，不會 fallback 到
  cwd，同 `nook workspace new`。
- `nook workspace decision set <ref> <title|body|disposition|supersededBy>
  <value|-> [--editor]` —— 寫進擁有 `<ref>` 的那個成員；同樣要求完整 26 碼
  ULID，同 `nook workspace set`。
- `nook workspace decision show <ref> [--json]` 與 `nook workspace decision
  history <ref> [<field>]` —— 顯示擁有 `<ref>` 那個成員的詳細內容與寫入歷史。
  這兩個在單一 board 的 `workspace` 指令裡沒有對應（沒有 `nook workspace
  history`）——Decision 才有這兩個，因為跨 repo 查一條 ADR 或它的寫入歷史是
  常見需求。

## doctor

`nook doctor` 檢查讓合併能運作的 `.gitattributes` 那一行 —— 刪掉它，Issue
就開始靜默衝突 —— 並回報無法解析的行、未知的操作型別（會被忽略而非致命），
以及**黏合行**（少了結尾換行，把兩個 JSON 物件接成一個）。`doctor --fix`
會修好它修得了的部分。

## 給 agent

把下面這段貼進你的 agent 指示、skill 檔案或 `CLAUDE.md`：

```
# nook

Git-native issue tracker. Issues are plain text files in the repo.

nook issue list [--all]          one line per issue: <ref> <status> <title> [labels]
nook issue show <ref>            title line, description, comments
nook issue history <ref>         every write to a field, with actor and lamport t
nook issue new "<title>"         create an issue
nook issue mv <ref> <status>     backlog todo queued in_progress review blocked done cancelled
nook issue comment <ref> "<body>"
nook issue label <ref> +bug -ui
nook issue set <ref> archived true

<ref> is any unambiguous ID prefix. Status takes prefixes too (que -> queued).
queued means requirements are settled: act without asking.
list hides archived, done and cancelled unless --all.
--json exists for scripts; the default table is cheaper to read.
```

預設輸出是一張精簡表格，token 比等價的 JSON 便宜，模型讀起來一樣輕鬆；
`--json` 留給真的需要解析的腳本。

`AGENT.md` 跟著套件一起出貨，是完整參考。把任何 agent 指向
`node_modules/gitnook/AGENT.md`，或者對 Claude Code：

```sh
mkdir -p ~/.claude/skills/nook
ln -s "$PWD/node_modules/gitnook/AGENT.md" ~/.claude/skills/nook/SKILL.md
```

## Library first

CLI 是一個公開 API 的呼叫端，而不是反過來：

```ts
import { openBoard } from 'gitnook';

const board = openBoard();                  // 從 cwd 向上找 .gitnook/issues/
const issue = board.create({ title: '修掉登入轉址', labels: ['bug'] });

board.apply(issue.id, { status: 'queued', labels: { add: ['p1'] } });
board.list({ status: 'queued' });
board.health();                             // `nook doctor` 回報的東西
```

`Board` 擁有整個 CRDT —— Op 的產生、排序、去重、OR-Set 的簿記、前綴解析。
呼叫端永遠不會看到一個 Op；你說的是 `{ labels: { add: ['bug'] } }`，
add-wins 是 gitNook 的問題。同時匯出的還有 `openWorkspace`、`initBoard`、
`diagnose`、`repair`、`serve`、`serveWorkspace`、`STATUSES`，以及一組
有型別的錯誤（`RefNotFound`、`AmbiguousRef`、`InvalidStatus`、
`BoardNotInitialized` ……），讓呼叫端能用 `instanceof` 分辨「這你自己修得好」
與「回報一個 bug」。

## 已知限制

- **`description` 是 last-writer-wins。** 並行編輯只會留下一個版本；輸的
  那一份還在 `nook issue history <ref>` 裡，但要救回來是手動複製貼上。
- **沒有跨分支的原子性。** 兩個 agent 在兩個 worktree 裡可以拿到同一張
  Issue；兩邊的操作都會收斂，但工作可能白做了一次。
- **短 ID 只在印出的那一刻無歧義。** 後來的一張 Issue 可能延伸一個共用的
  ULID 前綴，就像 git 的短 hash 一樣。

## 環境需求

Node >= 22。沒有原生模組、沒有 SQLite、沒有 postinstall 腳本，團隊裡也沒有
任何人需要跑 `git config`。

## 參與開發

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run bench         # 體積、冷啟動、合併與 token 預算的閘門
npm run build         # tsup bundle + 型別宣告 + studio 資產
```

一律用 `npm run build` —— 絕不要單獨跑 `npx tsup`：它會清掉只有
`vite build` 會寫的 `dist/studio/`。

## 授權

MIT
