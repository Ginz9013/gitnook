# 14 ref 的識別契約

## Outcome

CLI 交給使用者的每一個 ref 都是**可以拿去用的**。目前有三條路徑各自壞在不同的方向，根因相同：ULID 前 10 碼是時間高位，**前 6 碼每 17.5 分鐘才變一次**。

## 背景（實測）

```
A=$(nook new "Fix login...")   # 印出 01M20V —— 當下無歧義
B=$(nook new "Add dark...")    # 印出 01M20V2SB
nook label $A +bug             # 前綴 01M20V 對應到 3 張 issue
```

第一張票印出的 ref 在建立第二張時就失效。票 10 把契約定成「印出的當下無歧義」並類比 git short hash —— **該類比不成立**：git 的 hash 是全域隨機、衝突要幾百萬個 object；ULID 前綴必然共用。

## Acceptance criteria

### `new` 交付永久有效的 ref

- [ ] `nook new` 印出**完整的 26 碼 ULID**，那是唯一永久有效的 ref
- [ ] 分工寫進註解：**顯示用短的（`list`/`show`/看板，每次對當下 board 重算），交付用完整的**
- [ ] 測試釘住：建立三張票後，第一張印出的 ref 仍然解析得到

### 四個回印路徑不得恆為 6 碼

- [ ] `set` / `mv` / `comment` / `label` 目前都走 `renderTable([updated])` —— **單元素陣列讓 `shortIdLength` 直接回下限 6**。在批次匯入情境下那個 ref 對應全部 40 張票
- [ ] 改為對**整個 board** 算長度（`new` 已經這樣做，見 `shortId(board, issue)`）
- [ ] 測試釘住：同一塊 board 上 `list` 與 `mv` 印出的短 ID **長度相同**

### `table.ts` 的 comment 重排（硬性違規，原地復發）

- [ ] `src/render/table.ts:59` 的 `timeline()` 用 `(a,b)=>a.t-b.t` 重排，而 `reduce()` 給的已是 `(t, a, id)` 全序
- [ ] **同一個檔案第 15-19 行**才剛引用 commit `463343d` 說明不得複製比較器
- [ ] 移除該排序，信任 core。`html.ts` 已於 `463343d` 這樣改過，照抄同一個做法與註解

### token 閘門的三段改用真實長度

- [ ] `mv` / `comment` / `show` 三段目前用 6 碼計量，**低估了真實 byte 數**（`list` 已改用真實形狀，這三段沒有）
- [ ] 改用與 `list` 同一批 Issue 的真實短 ID 長度
- [ ] 若因此撞破 4608B，那是要回報的發現。**上限不會再調**

### 詞彙一致（CONTEXT.md 的硬性違規）

- [ ] `SKILL_DOC` 與 README 用 `<id>`，而 CLI 的 `--help` 用 `<ref>` —— **教給 agent 的詞彙同時違反詞彙表且與 CLI 不一致**。統一為 `<ref>`
- [ ] `README.md` 的 agent 段落與 `SKILL_DOC` 必須維持逐字相同（`packed-smoke.test.ts` 有測試守住）
- [ ] `src/cli/run.ts` 註解中用「票」指 Issue 之處改為 Issue（`CONTEXT.md` 的 `_Avoid_` 明列）

## Test seam

`run(argv, io)` 注入的 `Io`；`renderTable()` 純函數。不得 spawn `nook` 子行程。

## Write ownership

- `src/cli/run.ts`
- `src/render/table.ts`
- `test/cli/run.test.ts`
- `test/render/table.test.ts`
- `test/render/token-budget.test.ts`
- `README.md`（僅 agent 指令說明段落與 `<id>`→`<ref>`）

## Blocked by

None（票 15、16 排在其後，三者都碰 `src/cli/run.ts`）

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
