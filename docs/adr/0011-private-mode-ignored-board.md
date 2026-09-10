# private mode：整塊 board 排除在 git 之外，規則寫在 `$GIT_DIR/info/exclude`

`nook init` 要在別人的 repo 裡留下兩樣東西才能工作：`.issues/` 這個目錄，以及 `.gitattributes` 的那一行。技術上都無害，**但它們是 committed bytes** —— 團隊裡只有一個人想用、或想先私下試用一段時間的人，沒有辦法在不進入「跟全隊解釋這是什麼」的對話之前開始用。

所以 `nook init --private` 把**整塊 `.issues/`** 排除在 git 之外：在 `$GIT_DIR/info/exclude` 冪等寫進一行 `/.issues/`（board 不在 repo 根目錄時是 `/<相對路徑>/.issues/`），建出 `.issues/issues/`，並**完全不碰 `.gitattributes`，連讀都不讀**。之後 `git status --porcelain` 是空的、`git ls-files .issues` 是空的 —— **zero committed bytes**。

**它買到的是社交足跡為零，不是技術相容性。** `nook init` 本來就只多一個目錄加一行，沒有相容性問題要解。private mode 因此不是與 shared 對等的第二種玩法，而是一個**保證明確較少**的試用／單人模式：排除在 git 之外的 op-log 不跟著分支走、不進別人的 clone、也不需要零衝突保證。`nook share` 是它的升級路徑。

## 為什麼是 `$GIT_DIR/info/exclude`，不是 committed 的 `.gitignore`

**寫進 `.gitignore` 的那一行本身就是 committed bytes，與這個模式存在的理由正好相反。** 它會進 diff、進 review、進每一個 clone —— 也就是會引起那場「這是什麼」的對話，而想先私下試用的人要的正是在對話之前先開始用。一個把自己公告給全隊的「不留痕跡」模式是自相矛盾的。

`$GIT_DIR/info/exclude` 是同一套 ignore 機制的 per-clone 那一半：git 自己讀它，但它從不進 git。所以 private mode 只有這一種形狀，committed `.gitignore` 是明確的 non-goal。

那個檔案仍然是**使用者的**檔案，所以 nook 只借一行：`excludeBoard` 冪等 append（既有檔案缺尾端換行時先補一個，否則規則會黏在使用者的最後一行上），`unexcludeBoard` 只移除那一行、其餘內容與順序一個 byte 都不動，而且**不刪也不清空那個檔案** —— 清掉它會順手丟掉使用者排除 build 產物的設定，而那與共享這塊 board 無關。

解 `$GIT_DIR` 要走三層，因為 `.git` 有三種形狀：普通 repo 的目錄、linked worktree 與 submodule 的**檔案**（內容 `gitdir: <path>`），而 linked worktree 的那個 gitdir 自己還有一個 `commondir` 檔才指得到共用的 `info/exclude`。少讀最後那一層，規則會被寫進只有那個 worktree 看得到的地方。實測基準是 git 自己的答案：在 linked worktree 內 `git rev-parse --git-path info/exclude` 回傳的就是 common dir 的那個路徑。

## 為什麼 Sharing 是推導出來的，不是儲存的

ADR-0002 的結論是 `.issues/` 底下**零本機狀態、零衍生資料**。一個 `.issues/config.json`、或一個 `.private` marker 檔，會是 `.issues/` 底下第一份本機狀態，而它買到的只是一個布林值 —— 那個布林值已經寫在 `info/exclude` 裡了。

而且 marker 檔會長出第三個答案。共享狀態的真實來源只有兩個：git 的 ignore 規則，與 git 的 index。marker 檔與其中任何一個不一致時，沒有任何辦法決定該信誰 —— 那是 `SharingMismatch` 這一類問題的第三個維度，純粹自己製造出來的。

所以 `inspectSharing(root)` 是一個**推導**：讀 `info/exclude`，看 nook 那一行在不在。`.issues/` 底下沒有任何一個 byte 參與這個答案 —— 實測：`git clean -xdf` 把整塊 board 刪掉之後，`info/exclude` 裡那一行原封不動（它住在 `.git` 底下，clean 碰不到），答案照樣說得出這塊 board 是 private。

推導還有一個形狀上的決定：**private 是被測的那一側，其餘一律算 shared。** 不在 git work tree 內、沒有 `info/exclude`、那一行不在、或規則被手寫成別的形狀，全部回答 shared。剛 `init` 還沒 commit 的 board 也是 shared —— 它的意圖是共享，只是還沒送出去。這讓讀取熱路徑只需要回答一個是非題，而答錯的方向是「照舊警告」，不是「靜默閉嘴」。

## 為什麼只認得 nook 自己寫的那一整行

`inspectSharing` 做的是**整行字串比對**，刻意不實作 gitignore 的 pattern 與優先序規則（目錄排除、否定 `!`、後行覆蓋前行）。

理由是**讀取熱路徑不能 spawn git**。`list` / `show` 每一次都要問「這塊 board 是 shared 還是 private」（shared 才警告缺少 `merge=union`），而實測一次 `git rev-parse` 子行程約 8ms、讀一次 `info/exclude` 約 0.01ms —— 在一個總共約 25ms 的 `nook --version` 旁邊，那是三成的冷啟時間換一個布林值。`src/cli/run.ts` 的 `boardDir` 與 `warnIfUnguarded` 把「list 不 spawn git」當承諾在守，所以那條路徑上唯一的問法是純 fs 的 `inspectSharing`。

而那套規則只有 git 自己說得準。**所以那份權威放在 doctor**：它用 `git ls-files --error-unmatch`（index 是共享狀態的權威）與 `git check-ignore -v`（ignore 的權威）去問，並把 git 自己指出的 `<file>:<line>:<pattern>` 原封不動帶進 Diagnostic —— 那個行號是上層編不出來的東西。doctor 本來就 spawn 一個 `git rev-parse`，而它不在冷啟預算的情境裡。

手寫成別的形狀的 ignore 規則因此不算 private。那是**保守的失敗**（照舊警告、照舊回報），不是靜默的失敗，而且 doctor 問得出真相並說出來。

那個比對**左右不對稱**，而不對稱是必要的。實測（git 2.50.1）：

| exclude 裡的那一行 | git 是否生效 |
|---|---|
| `/.issues/` | 生效 |
| `/.issues/` + 尾端空白 | 生效（git 忽略尾端空白） |
| `/.issues/` + `\r` | 生效 |
| `/.issues/` + tab | **不生效** |
| 前導空白 + `/.issues/` | **不生效**（前導空白是 pattern 的一部分） |
| tab + `/.issues/` | **不生效** |

所以比對收尾端的空白與 CR，左側一個字元都不收。拿 `trim()` 比對會把 ` /.issues/` 當成 nook 的那一行：`inspectSharing` 回答 private、`excludeBoard` 回答 unchanged，於是使用者永遠等不到一條生效的規則，而 `list` / `show` 還順手停止警告 —— 一塊使用者以為藏起來了、git 卻看得一清二楚的 board。那正是這裡要避開的靜默失敗。反方向（漏收尾端的 tab）的代價只是答 shared，而 git 對那一行的答案也是不生效，兩邊剛好一致。

認得與移除共用**同一個**判斷（`isLine`），含它不對稱的那一面。兩邊各寫一套會長出兩種不一致：寬的一邊會刪掉使用者自己寫的 ` /.issues/`，窄的一邊會留下一條 git 仍然承認的 `/.issues/   ` —— 那時 `share` 報告成功、board 卻還被 ignore。

## 這不推翻 ADR-0002

ADR-0002 的 Consequences 寫著：「`.issues/` 底下**零本機狀態、零衍生資料、零需要 gitignore 的東西** …… 連使用者的 `.gitignore` 都不需要修改。」措辭與這份 ADR 重疊得足以讓人誤讀，所以把它講清楚：

**那句話講的是衍生狀態。** 它的論點是「沒有快取、沒有索引、沒有 `config.json`，所以沒有東西需要被 ignore」—— 描述的是一類**不存在的衍生物**，不是「權威資料一定要進 git」這條規則。

**private mode ignore 的是權威資料本身**，而且是使用者刻意要它不進 git。兩者不是同一件事：一個是「沒有垃圾要掃到地毯下」，一個是「這份資料我現在還不想交給團隊」。

ADR-0002 的每一項結論在 private board 上照樣成立：`.issues/` 底下仍然沒有快取、沒有索引、沒有 config 檔，Actor 仍然由 `git config user.email` 推導，lamport clock 仍然只讀那一個單檔 —— 連 Sharing 自己都是推導的而不是儲存的，那正是 0002 的紀律延伸到這個新功能上。

那句話的字面也仍然成立：**nook 從不寫使用者的 `.gitignore`。** 規則寫在 `$GIT_DIR/info/exclude`，那個檔案不進 git；而 `nook share` 之後若 git 仍然 ignore 這塊 board（committed 的 `.gitignore` 也有一條是最常見的形狀），nook 只說出是哪個檔案第幾行在擋，並要使用者自己移除那一行。

## Consequences

**private board 是一份沒有備份的資料，`git clean -xdf` 會把它整塊刪掉。** 實測：`git clean -xdn` 回報 `Would remove .issues/`。這是四條代價裡最嚴重的一條 —— git 平常是這個工具的備份機制，而 private mode 的全部內容就是放棄那個機制。所以 `init --private` 每一次都把這句話印出來（包含什麼都沒做的那一次：重跑 init 的人正是在問「我這塊 board 現在是什麼狀態」）。README 列出全部四條。

**fs 與 git 不一致時 `list` / `show` 是盲的。** 熱路徑問不起 git（上面那條理由），所以這兩種狀態它一個都看不到：

- **排除規則在、op-log 卻已被 git 追蹤。** 那塊 board 實際上是共享的，而且真的沒有 `merge=union` —— 正在靜默累積衝突風險，而 `list` 不會警告，因為純 fs 的那一問回答 private。進到這個狀態要一次刻意的 `git add -f`（實測：ignore 中的路徑不加 `-f` 會被 git 擋下，並提示 `Use -f if you really want to add them`），所以它不會自己發生。
- **沒有 nook 寫的規則、git 卻 ignore 了 op-log**（例如 committed `.gitignore` 裡一條 `*.ndjson`）。那塊 board 看起來是共享的，同事 clone 下來卻會是空的，而 `list` 一句話都不會說 —— 它唯一講得出的那句是缺少 `merge=union`，而那一行通常好端端地在。

**只有 doctor 看得到，而它看得到是因為它去問 git。** 兩種狀態共用一個 Diagnostic kind `SharingMismatch` —— 要修的是同一件事（讓兩邊一致），而訊息說得出是哪一種：前者指向 `nook share`，後者帶上 `git check-ignore -v` 自己指出的 `<file>:<line>:<pattern>`。成本是 private board 上多一個 `git ls-files`、shared board 上多一個 `git check-ignore`；讀取路徑仍然是零子行程。

**零衝突保證在 private board 上是「不需要」，不是「缺少」**，所以 doctor 在健康的 private board 上**完全沉默**、exit 0（它會進 CI，所以正確行為是沉默，不是換一句溫和的提醒）。但**兩個條件都成立才沉默**：fs 說 private，而 index 也同意 op-log 沒出去。index 有否決權，因為**被追蹤的路徑勝過 ignore 規則** —— 實測：`git add -f` 之後 `git check-ignore` 對那條路徑回報 not ignored。這也是 `init --private` 在已共享的 board 上**拒絕**（`AlreadySharedBoard`）而不是照寫一條規則的理由：那條規則對 tracked 路徑一點效果都沒有，而使用者會以為成功了。

**git worktree 之間互相看不到。** ignore 規則是共用的（它住在 common dir），但 untracked 的檔案不是 —— 實測：在 linked worktree 裡 `nook list` 說這裡不是一個 board，而 `nook init --private` 在那裡只印 `Created  .issues/issues/`（規則已經在了，所以沒有 `Ignored` 那一行），於是每個 worktree 各有一塊**空的** board。對並行 agent worktree 流程這是地雷。

**降級（shared → private）不做。** 要 `git rm -r --cached` 才做得到，而那會從同事的 clone 裡刪掉這塊 board —— 破壞性，由使用者自己決定並自己執行。`init --private` 撞到已共享的 board 時把那條指令講出來（帶完整路徑，因為 board 可能不在 repo 根目錄），但 nook 不替他跑：**nook 沒有任何一個會寫入的 git 指令**，`nook share` 印出的 `git add` 也一樣是使用者自己跑的 —— 把一塊 board 交給整個團隊是一個社交決定，而那個決定連同它的 commit message 都屬於使用者。

**跨機器同步不做。** 換機器或重新 clone 就沒有了。要解它得有一個獨立的 ref（`refs/nook/issues` 之類）與一整層新的儲存管線，而那會打破「issue 是工作目錄裡的純文字檔」這個前提。
