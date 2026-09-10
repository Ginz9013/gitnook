# gitNook

*[English](README.md)*

一個隨 git 走、為 agent 而寫的 issue tracker。Issue 是你 repo 裡的純文字檔，
它們跟著分支走，而且**兩個人在兩條分支上改同一張 Issue，合併時不會衝突**。

```bash
npm i -D gitnook
npx nook init                                     # .issues/ 與 .gitattributes 那一行
npx nook new "修掉 Safari 上的登入轉址迴圈"
npx nook list
```

想在一個不是你說了算的 repo 裡導入？`npx nook init --private` 給你同一塊 board，
但**零 committed bytes** —— 不會出現在任何人的 diff、review 或 clone 裡，所以現在
還不必跟任何人解釋它。它保證的東西明確比較少，[private mode](#private-mode)
會把放棄了什麼逐條寫清楚。

沒有資料庫。沒有原生 binary。沒有常駐程式。沒有帳號。**CLI 零執行期相依** ——
`nook` 出貨的 bundle 裡每一個 import 要嘛是 `node:` 內建模組，要嘛是這個套件裡的
檔案。

`npm i -D gitnook` 安裝**零個間接相依套件**。`dependencies` 是空的，而且會一直是
空的：studio 的前端（React 19、Radix、Tailwind）是一組 `devDependencies`，事先編譯
成兩個靜態檔 —— `dist/studio/studio.js` 與 `studio.css`，合計 431 KB —— 躺在
tarball 裡，瀏覽器要的時候才從磁碟讀出來。安裝時沒有任何東西被解析、下載或執行。

這個說法真正變弱的那一半：**React 與 Radix 的 CVE 風險面現在住在我們的 tarball
裡。** 你的 `npm audit` 看不到它，你的 repo 也不會因此開出 Dependabot PR，因為對
npm 來說那裡什麼都沒有。讓那個 bundle 保持在最新是**我們的**責任，而出一個修好的
版本意味著 gitNook 要發一次新版，不是你那邊跑一次 `npm update`。如果你只用 CLI，
`nook studio` 是唯一會載入那些 byte 的東西。

## 為什麼是 gitNook

**Issue 住在工作目錄裡。** `.issues/issues/*.ndjson` 是普通的、被 commit 的檔案。
GitHub 的網頁 UI 會在 diff 裡顯示它們，`grep` 找得到它們，agent 可以 `cat` 一張
而不必對外呼叫任何工具，而一條分支會把它的 Issue 連同「關掉它們的那些程式碼」一起
帶著走。

**兩條分支改同一張 Issue，合併時不會衝突。** 每張 Issue 是一份**只增不改的
Op-log**，一行一個不可變更的 Op，而讀取時摺疊的是那些 Op 的**集合** —— 檔案裡的
順序無關緊要。正是這一點讓 git 內建的 `union` 合併驅動能做這件事，而 `union` 就
住在 git 裡面：commit 一行 `.gitattributes` 就是全部的設定，對每一個 clone 都成立，
團隊裡沒有任何人需要跑 `git config`。

**儲存格式就是資料模型。** 一行一個 JSON 物件，欄位有型別 —— 不是一段要再被解析回
欄位的散文，所以沒有「標題慣例」會壞掉，也沒有來回轉換會遺失資訊。

**它像一個普通的 dev dependency 一樣安裝。** 一次 `npm i -D gitnook`，解壓後
約 675 KB，零執行期相依，沒有各平台一份的原生 binary，沒有常駐程式，沒有帳號，
也沒有**衍生的**本機狀態需要寫進 `.gitignore`。（有一樣東西你可以刻意留在 git
之外 —— board 本身，用下面的 `nook init --private` —— 而即使是它，寫的也是
`$GIT_DIR/info/exclude`，永遠不是你的 `.gitignore`。）

**兩個介面讀的是同一批檔案。** CLI 可組合、而且精簡到能待在 agent 的 token 預算裡
（下面有一條實測的閘門）；`nook studio` 是給人看的本機看板。兩者都不是另一個的快取。

## 它怎麼運作

```
.issues/issues/01JBX7A9Q3.ndjson    被 commit，merge=union
.gitattributes                      被 commit，裡面有 merge=union 那一行
```

一張 Issue、一個檔案、一行一個 JSON 物件。每一行都是一個不可變更的 Op：

```jsonl
{"id":"01JBX7A9Q3","t":1,"a":"k3f9","op":"create","title":"修掉登入轉址"}
{"id":"01JBX7B2K9","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}
{"id":"01JBX7C5R1","t":3,"a":"k3f9","op":"label.add","v":"bug"}
{"id":"01JBX9F3M2","t":4,"a":"m8q2","op":"label.rm","v":"bug","seen":["01JBX7C5R1"]}
```

讀一張 Issue 的意思是：解析每一行、用 `(t, actor, id)` 排成一個全序、以 op id 去掉
重複，然後摺疊。**結果只取決於那些 Op 的集合，永遠與它們在檔案裡的順序無關。**
這就是為什麼 `merge=union` —— 它單純把兩邊的每一行都留下來 —— 一定會收斂。沒有任何
東西需要人工解決。

`merge=union` 是一個出貨在 git **裡面**的驅動。commit 那一行 `.gitattributes`
就夠了：每一個 clone 都拿到這個行為，沒有人需要跑 `git config`。這正是 gitNook
不建立在 Automerge 或 Yjs 上的全部理由 —— 它們的自訂合併驅動沒辦法只靠一個被
commit 的檔案就啟用。

- **Actor 識別**由 `git config user.email` 推導而來；什麼都不儲存。
- **Label** 是一個 add-wins 的 OR-Set，所以並行的 `+bug` 與 `-bug` 會保留那個 Label。
- **刪除永遠不 unlink 檔案。** `nook rm` 追加一筆 `deleted` 墓碑就停手：這張 Issue
  離開每一份列表，而它的 `.ndjson` 一個 byte 不動地留在磁碟上，用
  `nook set <ref> deleted false` 就撈得回來。真的把位元組收回來是另一個、尚未實作的
  操作。modify/delete 是 `union` 唯一蓋不住的衝突，所以 gitNook 從不製造它
  （ADR-0009）。
- **零本機狀態。** 沒有快取、沒有索引、沒有 `config.json` —— 沒有任何**衍生**出來、
  需要一條 `.gitignore` 去蓋的東西。唯一的例外是你自己要求的那一件：
  `nook init --private` 把**權威資料本身**留在 git 之外（見下一節）。那是另一個
  主張，而「nook 從不寫你的 `.gitignore`」這條規則在它之後仍然成立。

沒有快取，是因為沒有東西需要快取：完整掃描並摺疊 100 張 Issue 要 3 ms、2,000 張
53 ms、10,000 張 266 ms。Node 自己的冷啟動是 10–20 ms。

## private mode

```bash
npx nook init --private      # 一塊零 committed bytes 的 board
```

它建出 `.issues/issues/`，並把一行 `/.issues/` 寫進 `$GIT_DIR/info/exclude`。
它**完全不碰 `.gitattributes`**。之後 `git status --porcelain` 是空的、
`git ls-files .issues` 也是空的：**零 committed bytes**，所以不會有任何東西出現在
任何人的 diff、review 或 clone 裡。

**它買到的是社交足跡為零，不是技術相容性。** 導入 gitNook 從來不難 ——
`nook init` 只多一個目錄加一行。問題在於那些 byte 是**被 commit 的**：如果團隊裡
只有你一個人想試，你沒有辦法在還沒經歷「我們 repo 裡這是什麼東西」那場對話之前
開始。private mode 把那場對話延後，而那就是它存在的全部理由。

所以它**不是與 shared 對等的第二種玩法**。它是一個試用／單人模式，保證的東西明確
比較**少** —— 具體來說，上面「為什麼是 gitNook」的前兩條在它底下是關掉的：

- **Issue 住在工作目錄裡** —— 仍然成立，但它們不再**跟著分支走**。一個被排除的檔案
  在每條分支上都是同一個檔案，所以換一條分支不會改變你的 board，而一張 Issue 也
  永遠不可能跟著關掉它的那些程式碼一起抵達別人的 clone。
- **兩條分支改同一張 Issue 不會衝突** —— 根本沒有合併。board 不會進到 git，所以
  `merge=union` 沒有東西要保證。那條保證在這裡是「**不需要**」而不是「缺少」——
  這也是為什麼健康的 private board 上 `nook doctor` 沉默且 exit 0，以及為什麼
  `list` / `show` 不再警告 `.gitattributes` 那一行。

其餘一切照常運作：`new`、`list`、`show`、`history`、`set`、`mv`、`comment`、
`label`、`studio`。

### 四條代價

1. **`git clean -xdf` 會刪掉整塊 board，而且沒有備份。** 實測：`git clean -xdn`
   回報 `Would remove .issues/`。git 平常就是這個工具的備份機制，而 private mode
   正是「決定不要那個機制」—— 所以 `init --private` 每一次執行都會把這條代價印出來，
   包含它什麼都沒做的那幾次。
2. **Issue 不再跟著分支走。** 一塊 board，從這個工作目錄的每一條分支都看得到；
   一條分支沒辦法帶著自己的 Issue，而 merge 或 rebase 一張都不會搬。
3. **git worktree 之間看不到彼此的 board。** ignore 規則**是**共用的 —— 它住在
   common git dir，所以每個 linked worktree 都繼承它 —— 但 untracked 的檔案不是。
   實測：在一個剛加出來的 linked worktree 裡，`nook list` 會說這裡沒有 board，而
   `nook init --private` 在那裡只印出 `Created  .issues/issues/`（規則已經在了），
   於是那個 worktree 有了自己的一塊**空** board。如果你在 worktree 裡跑並行
   agent，這是地雷。
4. **換一台機器、或重新 clone，什麼都沒有。** 沒有任何同步機制：這塊 board 只存在
   於一個工作目錄、一顆磁碟上。

### 升級回共享：`nook share`

```
$ nook share
Shared  .issues/  已從 $GIT_DIR/info/exclude 移除（這塊 board 從現在起會進 git）
Created  .gitattributes  .issues/issues/*.ndjson merge=union
Next  nook 不替你跑任何會寫入的 git 指令，請自己執行：
  git add "<repo>/.issues" "<repo>/.gitattributes"
  git commit -m "Share the nook board"
```

`share` 只移除 nook 借走的那一行 —— 你其他的排除項目、以及那個檔案本身，都不會被
動到 —— 補回 `merge=union` 那一行，印出**你自己**要跑的 `git add`（用完整路徑，
因為 board 不一定在 repo 根目錄），然後停手。那兩行 git 指令只在 op-log 還在 index
之外時才會印：在一塊已經 commit 過的 board 上，`share` 會說它什麼都沒改並停在那裡，
因為 `git commit` 不是冪等的 —— 它要嘛失敗，要嘛把你手上還沒 commit 的 Issue 編輯
掃進一個聲稱「在共享 board」的 commit 裡。**nook 不執行任何會寫入的 git 指令**，而
`git add` 也不會是第一個：把一塊 board 交給整個團隊是一個社交決定，而那個決定連同
它的 commit message 都屬於你。如果到那時候**仍然**有東西在 ignore 這塊 board
（最常見的形狀是 committed 的 `.gitignore` 裡自己有一條），`share` 會說出擋路的是
哪個檔案第幾行並 exit 1，而不是印出一條 git 會拒絕的 `git add`。

沒有 `nook unshare`。反方向要用 `git rm -r --cached`，那會從同事的 clone 裡刪掉這塊
board —— 那是破壞性的，所以由你自己執行。`init --private` 撞到一塊已經共享的 board
時會拒絕，並把那條指令印給你；它不會替你跑。這一切的理由，包含為什麼那條規則寫進
`$GIT_DIR/info/exclude` 而不是一個被 commit 的 `.gitignore`，都在 ADR-0011。

## 四個硬指標

這些是閘門，不是願望。`npm run bench` 會印出全部四項 —— 外加下面那兩列結構性的
—— 任何一項超預算就以非 0 結束。

| 指標 | 預算 | 實測 |
|---|---|---|
| 套件體積，解壓後 | < 3 MB | **675,267 B**（閘門的 21%） |
| 冷啟動，從打包好的 tarball 跑 `nook --version` | < 500 ms | **≈25 ms** |
| 同一張 Issue 在兩條分支上並行合併 | 零衝突 | **0** |
| Agent token，40 張 Issue 的情境 | < 4.5 KB | **4,102 B** |

體積與冷啟動是對著 `npm pack` 產出的 tarball 量的，不是對著 `src/` —— 只有 tarball
反映你實際安裝到的東西。合併那個數字來自一次真實的 `git merge` / `git pull
--rebase` 整合測試。token 那個數字是「agent 指示文件 + 每一條指令的輸出」在一個
40 張 Issue 的專案做 `list → show → mv → comment` 的總 byte 數；預算綁在那個情境上，
因為輸出會隨 Issue 數量線性成長。

（在 node 22.22.1 / darwin-arm64、乾淨的 `dist/` 上量測。冷啟動因機器而異，跑一次
`npm run bench` 看你自己的。）

另外兩列存在，是因為那四項看不到它們該看的東西：

| 列 | 預算 | 實測 |
|---|---|---|
| studio 資產，`dist/studio/` | < 768 KB | **441,497 B** |
| `dist/cli/run.js` 裡的 React 痕跡 | 0 | **0** |

studio 佔了整包的四分之三，所以它可以再長一半而套件體積那一列看起來仍然很寬裕 ——
它自己那一列才是讓這種成長被看見的東西。痕跡那一列直接執行 ADR-0008 的硬性限制：
studio 的 bundle 絕不能進到 `src/cli/run.ts` 的 import 鏈。冷啟動只能間接守著這件
事，而計時會漂 —— 在一台吵雜的機器上它說的是「好像慢了一點」，而在出貨的 CLI
bundle 裡數 `react` / `createRoot` / `radix` / `tailwind` 說的是「React 進了 CLI
bundle」。

## gitNook 拒絕做的事

護城河是**拒絕變成一個專案管理工具**的能力。小與正確是那個拒絕的結果，不是額外
加上去的功能。所以，明確且永久地不在範圍內：

- **負責人（assignee）** —— Actor 是「誰寫了這個 Op」，不是「誰負責這件事」
- **優先級、里程碑、到期日、估時** —— 用 Label
- **可自訂的 Status** —— 八個是固定的，所以 agent 永遠不必先問「這個專案有哪些
  狀態」才能動手
- **子任務** —— 描述裡的 `- [ ]` 是文字，而且就只是文字
- **搜尋／篩選 UI、TUI** —— `nook studio` 是 GUI 而且它確實能編輯（ADR-0007），
  但它沒有搜尋、沒有篩選，也沒有終端機介面
- **MCP server** —— CLI 就是那個介面
- **Op-log 壓縮**
- **`nook next`** 以及其他針對某一種特定 agent 工作流而設計的原語

有些團隊會想要第九個 Status。答案是一個 Label。對那個要求說不，**正是**這個產品。

## 模型

**Status** —— 八個，固定：

```
backlog  todo  queued  in_progress  review  blocked  done  cancelled
```

`backlog` 與 `todo` 是**人的車道**；`queued` 之後是 **agent 的車道**。`queued` 是
交接閘門：把一張 Issue 移進 `queued` 表示需求已經釘死，而且**已授權 agent 不再詢問
直接動手**。它是一條授權邊界，不是一個分類桶。

**`blocked` 就只是一個 Status**，不帶任何附加規則：不強制留言，也沒有閘門。扁平的
Status 清單確實會遺失「我卡住之前在做什麼」，而 ADR-0003 接受這個遺失 —— 留一則
Comment 是任何人都可以做的選擇，不是工具強制的規則。

**`archived` 是一個欄位，不是 Status。** 歸檔是**可見性**；`done` / `cancelled` 是
**工作結果**。兩者正交，把它們壓成一個會永久遺失「一張歸檔的 Issue 是完成了還是
被放棄了」。

**Ref 是 ULID。** 任何接受 id 的地方都接受任何無歧義的前綴，就像 git 的短 hash；
有歧義時是一個列出候選的錯誤，永遠不是一次無聲的猜測。Status 也接受前綴
（`que` → `queued`）。

## 指令

```
init [--private]                       建立 .issues/ 與 .gitattributes 那一行；
                                       --private 改成不留任何 committed bytes
new <title> [--description <text|->] [--label <l>] [--editor]
list [--all] [--status <s>] [--label <l>] [--json]
show <ref> [--json]
history <ref> [<field>]                某個 LWW 欄位被寫過的每一個值，唯讀
set <ref> <title|description|status|archived|deleted> <value|->  [--editor]
mv <ref> <status>
rm <ref> [--yes]                       刪除：寫一筆墓碑，永不 unlink
comment <ref> <body|->
label <ref> +bug -ui
share                                  把一塊 private board 升級回共享
doctor [--fix]                         資料健康檢查；--fix 修復黏合行
studio [--port <n>]                    localhost 上的看板；可新增、拖拉、編輯、留言
```

值的位置寫 `-` 表示從 stdin 讀。

## 給 agent

把下面這段貼進你的 agent 指示、skill 檔案或 `CLAUDE.md`。它就是 token 預算閘門
實際量測的那份文字，所以它不會無聲地與 CLI 的實際行為漂開：

```
# nook

Git-native issue tracker. Issues are plain text files in the repo.

nook list [--all]          one line per issue: <ref> <status> <title> [labels]
nook show <ref>            title line, description, comments
nook history <ref>         every write to a field, with actor and lamport t
nook new "<title>"         create an issue
nook mv <ref> <status>     backlog todo queued in_progress review blocked done cancelled
nook comment <ref> "<body>"
nook label <ref> +bug -ui
nook set <ref> archived true

<ref> is any unambiguous ID prefix. Status takes prefixes too (que -> queued).
queued means requirements are settled: act without asking.
list hides archived, done and cancelled unless --all.
--json exists for scripts; the default table is cheaper to read.
```

預設輸出是一張精簡表格，**給人與 agent 共用**。直覺反應是丟 JSON 給 agent；量測
說的是反面：

```
{"id":"01JBX7A9Q3","title":"Fix login redirect","status":"queued","labels":["bug"]}   83 bytes
01JBX7  queued  Fix login redirect  [bug]                                            41 bytes
```

同樣的資訊，一半的 byte，而且沒有任何模型讀不懂它。`--json` 留給真的需要解析的
腳本。

### Agent 使用指南

`AGENT.md` 跟著套件一起出貨。上面那一段是 agent 在每一次互動裡都需要的最小集合；
`AGENT.md` 是完整參考 —— 每一個指令、`queued` 那條授權邊界、Ref 怎麼運作，以及
gitNook 拒絕做什麼。

它是帶 YAML header 的純 Markdown，所以把任何 agent 指向它就行：

```
node_modules/gitnook/AGENT.md
```

Claude Code 的話，symlink 進去讓它按需載入：

```sh
mkdir -p ~/.claude/skills/nook
ln -s "$PWD/node_modules/gitnook/AGENT.md" ~/.claude/skills/nook/SKILL.md
```

## Library first

CLI 是一個公開 API 的呼叫端，而不是反過來：

```ts
import { openBoard } from 'gitnook';

const board = openBoard();                  // 預設是 ./.issues
const issue = board.create({ title: '修掉登入轉址', labels: ['bug'] });

board.apply(issue.id, { status: 'queued', labels: { add: ['p1'] } });
board.list({ status: 'queued' });
board.health();                             // `nook doctor` 回報的東西
```

`Board` 擁有整個 CRDT：Op 的產生、lamport clock、ULID、trailing-newline 的紀律、
去重、全序、摺疊、OR-Set 的簿記，以及前綴解析。**呼叫端永遠不會看到一個 Op。**
你說的是 `{ labels: { add: ['bug'] } }`；add-wins 是 gitNook 的問題。

同時匯出的還有：`initBoard`、`diagnose`、`repair`、`serve`、`STATUSES`、那份 API
裡的每一個型別，以及錯誤型別（`RefNotFound`、`AmbiguousRef`、`InvalidStatus`、
`BoardNotInitialized`、`IssueDeleted`、`ConflictingGitAttributes`、`NestedBoard`、
`AlreadySharedBoard`、`NoGitDir`、`PortInUse`）—— 讓呼叫端能用 `instanceof` 分辨
「這你自己修得好」與「回報一個 bug」。那份清單被 `test/index.test.ts` 釘住，而它
就是這句話過期時會來通知你的那個東西。

那份清單刻意很短。渲染器與 studio 的 request handler **沒有**被匯出：它們是呈現與
管線，而每一個匯出都是永久的相容負債。日後新增一個是相容的改動；拿掉一個不是，
所以這個套件從窄的開始。

## studio

```bash
npx nook studio
```

**人**的介面，跑在 `127.0.0.1` 上。CLI 是 agent 的：可組合、可解析、token 便宜。
把六張 Issue 拖進 `todo` 並排好順序，在那邊是六次 `nook mv`，在這邊是六秒
（ADR-0007）。

八個欄位可以把 Issue 拖來拖去，每張 Issue 有一個抽屜可以編輯標題、描述、Label、
Status 與留言。**八個欄位就是八個 Status，不多不少** —— 沒有車道、沒有閘門、沒有
任何一欄代表 Status 沒說的事（ADR-0010）。一欄代表什麼，是你和你的團隊把它養成
什麼。

你可以**新增**一張 Issue 而不必回到終端機 —— header 上一個按鈕、八個欄位各一個
`+`，兩者都只問標題、別的都不問。從抽屜裡可以**歸檔**與取消歸檔，或在一次確認之後
**刪除**；刪除寫的是 `nook rm` 寫的那同一筆墓碑，所以卡片離開看板而檔案留在磁碟上
（ADR-0009）。**主題**切換提供亮色、暗色與跟隨系統，記在 `localStorage` 裡 ——
你怎麼看這塊 board 是這台機器的性質，不是 Op-log 的性質。寫入走 `POST /i/<ref>`、
新增走 `POST /api/issues`，進到 CLI 寫的那同一份只增不改的 Op-log，所以 CLI 與
studio 可以同時開著。失敗沒有 rollback，也不需要：一個落地的 Op 是永久的，而一張
跑到別處去的卡片是在 last-writer-wins 裡輸給了寫得比較晚的那個人。兩秒一次的輪詢
就地套用變更而不是重新載入頁面，而你正把指標放在上面的那張 Issue 永遠不會從你底下
被搬走。

**只綁 loopback 現在是全部的安全模型，不是一個保守的預設值。** studio 沒有任何
驗證，所以任何連得到它的東西都能寫整塊 board。這就是為什麼它只綁 `127.0.0.1`，
以及為什麼 `--host` 不是「還沒做」而是**永遠不做**（ADR-0007）。studio 寫的每一個
Op 都歸屬於你 `git config user.email` 那個 Actor，而那是它不能被共享的第二個理由：
一個共享的 studio 會把所有人的工作都記在同一個 Actor 底下，並破壞合併所依賴的
決勝機制。

前端是一個 React SPA（`src/studio/`，由 Vite 建進 `dist/studio/`）。Markdown 仍然
在伺服器端被渲染成安全的 HTML，用的是和以前同一個「先轉義」的渲染器 —— 交給瀏覽器
的字串已經是安全的，而不是信任瀏覽器去清理它們。

## doctor

`.gitattributes` 那一行是唯一的單點失效：刪掉它，Issue 就開始靜默衝突。
`nook doctor` 會檢查它，而讀取類指令在它缺失時會警告。在一塊**共享的** board 上，
那個警告永遠不是雜訊；在一塊 private board 上，警告與檢查都不適用，而那裡的沉默是
正確的輸出，不是一個被吞掉的問題（見上面的 private mode）。

`doctor` 也是唯一看得到 board 的**共享狀態不一致**的地方 —— 排除規則在、git 卻
已經追蹤著 op-log；nook 沒有寫任何規則、git 卻照樣 ignore 了 op-log；或者 nook 那
一行在、卻被一條優先序更高的規則壓過去。`list` 與 `show` 對這三種都是盲的，因為
要正確回答那個問題必須去問 git，而它們不被允許生出子行程。`doctor` 會去問，並說出
git 自己指的是哪個檔案第幾行（ADR-0011）。

`doctor` 同時回報無法解析的行、未知的 Op 型別（它們被忽略而不是致命 —— 一個用著
較新版本的同事絕不該讓你的資料變得讀不了），以及**黏合行**：如果某次寫入少了結尾的
換行，`union` 合併可能把兩個 JSON 物件接成一個。`doctor --fix` 會修好它們。

## 環境需求

Node >= 22。全部就這樣。沒有原生模組、沒有 SQLite、沒有 postinstall 腳本，團隊裡
也沒有任何人需要跑 `git config`。

## 已知限制

- **`description` 是 last-writer-wins。** 並行編輯同一份描述只會留下一個版本。
  輸的那一份沒有遺失 —— 每一次寫入都還在 Op-log 裡，`nook history <ref>`（或
  `Board.opLog()`）會連同它的 Actor 與 lamport clock 印回來 —— 但摺疊出來只有一個
  值，而要把另一個救回來是手動複製貼上。
- **沒有跨分支的原子性。** 兩個 agent 在兩個 worktree 裡可以拿到同一張 Issue。
  兩邊的操作都會存活並收斂 —— 但工作可能白做了一次。
- **短 ID 只在印出的那一刻無歧義。** 後來的一張 Issue 可能延伸一個共用的 ULID
  前綴，就像 git 的短 hash 一樣。需要永久有效就印完整的 26 個字元。

## 參與開發

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run bench         # 四個硬指標，外加兩列結構性的
npm run build         # tsup bundle + 型別宣告 + studio 資產
```

前三個會在 CI（`.github/workflows/ci.yml`）上對每一次 push 與 pull request 執行。

**一律用 `npm run build`。絕不要單獨跑 `npx tsup`。** 這個 repo 有兩個 build
目標 —— node 那側用 tsup，studio 用 Vite —— 而 tsup 會清掉**整個** `dist/`，包含
只有 `vite build` 會寫的 `dist/studio/`。單獨跑 tsup，build 看起來成功了，而
`nook studio` 已經沒有資產可以提供。

同樣的理由：套件體積要從 `npm run bench` 讀，永遠不要直接看 `dist/`。bench 透過
`prepack` 打包 tarball，所以它量到的一定是一棵剛建好的樹；你剛好在看的那個 `dist/`
可能還帶著上一次 build 的產物，讀起來會比實際出貨的大很多。

有一個測試需要一張非 loopback 的 IPv4 介面：`test/server/serve.test.ts` 斷言
`studio` 拒絕綁定除 loopback 以外的任何東西，而在沒有對外介面時它**丟錯而不是
跳過**。那是刻意的 —— 無聲地跳過會讓一個 `0.0.0.0` 的回歸在 CI 裡過關。所以工作流程
會先檢查有沒有那張介面，並以一句指名道姓的訊息失敗，而不是安靜地把那個測試中性化；
一個沒有那張介面的 runner，必須在別的地方補上那份保證。

## 授權

MIT
