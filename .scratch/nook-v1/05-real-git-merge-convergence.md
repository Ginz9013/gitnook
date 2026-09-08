# 05 真實 git 合併的收斂性與黏合行防禦

## Outcome

這張票把 spike 的手工驗證變成**永久的迴歸閘門**。真實 git repo、真實分支、真實 `git merge` 與 `git rebase`，證明四個硬指標中的「並行 merge 零衝突」。

同時實作 spike 逼出的三條硬規則的防禦面。

## Acceptance criteria

**真實 git 整合（每個測試建立臨時 git repo，執行真實 `git` 指令）**

- [ ] 兩分支各自 `apply` 不同變更 → `git merge` **exit 0、無衝突標記**，且雙方變更皆存活
- [ ] `git rebase` 路徑同樣無衝突（spike T4）
- [ ] 分支 A 移除 label、分支 B 並行新增同一 label → 合併後 **add 勝出**
- [ ] ⚠️ **上一條必須涵蓋兩種 actor 排序**（票 03 用變異測試發現）。全序是 `(t, a, id)`：當移除方的 actor 排在並行新增方**之前**時，一個完全不看 `seen`、單純「以值移除」的天真實作**也會通過測試**。只測單一 actor 排序等於沒測。票 03 的 `test/core/board.labels.test.ts` 有 `ACTOR_ORDERS` 常數與理由註解，請沿用同一套
- [ ] 兩分支並行 `set status` → 合併後結果依 `(t, a, id)` 確定，且**兩個 op 都留在檔案裡**
- [ ] 兩分支各自新增 comment → 合併後兩則都在

**黏合行防禦（spike T2）**

- [ ] 手工構造缺少 trailing newline 而被黏合的檔案（`{"id":"b1"}{"id":"b2"}`），`reduce()` 不崩潰，該行被記錄為診斷而非丟失整個檔案
- [ ] `health()` 回報黏合行，指出檔案與行號
- [ ] 修復能將黏合行還原為多行且不遺失 op

**向前相容（硬規則 2）**

- [ ] 含未知 `op` 型別的行被**忽略而非崩潰**，同檔案的其他 op 仍正確 fold
- [ ] 未知 op 的偵測請使用 `src/core/ops.ts` 既有的 `OP_KINDS`，不要另建一份清單（票 03 已補齊該集合的五個值；目前它還沒有任何消費者）
- [ ] ⚠️ **壞資料測試要避開字串陷阱**（票 03 發現）：`label.rm` 的 `seen` 若寫成 `seen: 'bug'`，字串**是可迭代的**，`Array.isArray` 守衛不會被觸發，測試形同虛設。要用 `seen: 42` / `seen: null` / `seen` 缺漏這類真正不可迭代的形狀
- [ ] 含未知欄位的已知 op 仍正確 fold

## Test seam

真實 git 子行程 + `openBoard()` + `reduce()`。**不得以 in-memory fake 取代 git** —— 這張票的全部價值就在於打真實的 git。

## Write ownership

- `src/core/reduce.ts`
- `src/core/ops.ts`
- `src/core/health.ts`
- `test/integration/git-merge.test.ts`
- `test/core/reduce.malformed.test.ts`

## Shared resources

暫存目錄 + 真實 `git` 執行檔。測試需自行 `git config user.email/user.name` 並關閉 `commit.gpgsign`，不得依賴或修改使用者的全域 git 設定。

## Blocked by

04, 06

## Status

done

## Done when

- A failing behavior test was observed before implementation, per slice.
- Focused tests and relevant static checks pass.
- The broader regression suite appropriate to the change passes.
- Standards and spec review blockers are resolved.
