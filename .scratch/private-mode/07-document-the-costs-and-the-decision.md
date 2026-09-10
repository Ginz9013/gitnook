# 07 文件與決策：README、CONTEXT.md、ADR-0011

nook ref：`01M2522HTD8R7BKFGT10PSJ1CS`

## Outcome

private mode 在文件上被定位成**保證明確較少的試用／單人模式**，不是與 shared
對等的第二種玩法；四條代價全部寫下來；以及一份 ADR 交代這個決定為什麼不推翻
ADR-0002。

## Acceptance criteria

- [ ] `README.md` 新增一節：
      - private mode 買到的是**社交足跡為零**，不是技術相容性（`nook init`
        本來就只多一個目錄加一行）
      - 四條代價全列：`git clean -xdf` 會整塊刪掉且沒有備份（最嚴重，排第一）、
        issue 不跟著分支走、worktree 之間互相看不到、換機器或重新 clone 就沒了
      - 明說「Why gitNook」的前兩條（跟著分支走、合併不衝突）在 private 底下
        是**關掉的**
      - 升級路徑 `nook share`
- [ ] 修掉 README 現有「**Zero local state.** No cache, no index, no
      `config.json`, nothing to gitignore」與「no local state to gitignore」
      兩處說法 —— private mode 之後那句話需要一個限定，否則它與新的一節
      互相打臉
- [ ] `CONTEXT.md` 的詞彙加入 **Sharing（共享狀態）**，兩個值 shared / private，
      `_Avoid_`: mode、local、offline、visibility（後者已被 `archived` 佔用）。
      並寫下三條語意：Sharing 是推導而非儲存的、private 是被測的那一側其餘
      一律算 shared、零衝突保證在 private 上是「不需要」而非「缺少」。
      **CONTEXT.md 只放詞彙，不放實作細節**
- [ ] `docs/adr/0011-private-mode-ignored-board.md`，照既有 ADR 的形狀，必須
      交代：
      - 為什麼是 `$GIT_DIR/info/exclude` 而不是 committed 的 `.gitignore`
        （後者本身就是 committed bytes，與這個模式的理由相反）
      - 為什麼模式是推導而非儲存（ADR-0002）
      - 為什麼 `inspectSharing` 刻意只認得 nook 自己寫的那一行，不實作
        gitignore 的優先序規則（讀取熱路徑不能 spawn git；git 自己才是權威，
        那份權威放在 doctor）
      - **正面處理 ADR-0002 Consequences 裡那句「連使用者的 `.gitignore` 都
        不需要修改」**：0002 講的是衍生狀態不需要被 ignore，private mode ignore
        的是權威資料本身，兩者不是同一件事 —— 不交代會讓下一個讀的人以為
        0011 推翻了 0002
      - Consequences 要誠實寫下已知限制：fs 與 git 不一致時 `list` / `show`
        是盲的（只有 doctor 看得到），以及 private board 是一份沒有備份的資料
- [ ] 四處文件彼此不打臉：README 的一節、CONTEXT.md 的詞彙、ADR-0011、
      以及票 06 已經寫好的 AGENT.md

## Test seam

沒有程式碼，所以沒有行為測試。驗證是 `npx vitest run`（`test/agent-doc.test.ts`
確認文件與 CLI 沒漂開）加一次人眼通讀。

## Write ownership

- `README.md`
- `CONTEXT.md`
- `docs/adr/0011-private-mode-ignored-board.md`（新）

**不得碰**：`AGENT.md`（票 06 已經動過它，兩票搶同一個檔案會撞）、
任何 `src/**` 與 `test/**`。

## Shared resources

None.

## Blocked by

票 05（ADR 的 Consequences 要寫進那兩種不一致狀態的最終行為）、
票 06（README 要寫到 `nook share` 的實際輸出與行為）。

## Status

done —— commit fee651b（+ 2421faf 跟上 share 改掉的輸出）
