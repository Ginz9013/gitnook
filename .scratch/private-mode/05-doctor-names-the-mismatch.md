# 05 doctor 說出 fs 與 git 不一致的那兩種狀態

nook ref：`01M2522HR3XD9460B5BQTDZSNW`

## Outcome

兩種真實存在、而且會靜默傷人的狀態，變成一句說得出下一步的 Diagnostic：

1. **exclude 規則在、op-log 卻被 tracked。** 這塊 board 實際上是共享的，而且
   **沒有 merge=union** —— 也就是正在靜默累積衝突風險。進到這個狀態要一次刻意
   的 `git add -f`（ignore 中的路徑不加 `-f` 會被擋下），但一旦進去就沒有任何
   東西會提示。
2. **沒有 nook 寫的那條規則、git 卻說 op-log 被 ignore。** 例如 monorepo 的
   committed `.gitignore` 有一條廣泛的規則吃到了 `.issues/`。board 看起來是
   共享的，但同事 clone 下來會是空的。

## Acceptance criteria

- [ ] 新的 `DiagnosticKind`：`SharingMismatch`（單一 kind，兩種訊息）
- [ ] 狀態 1：同時回報 `SharingMismatch` 與 `MissingMergeDriver`，exit 1。
      **`MissingMergeDriver` 在這裡不得被壓掉** —— 那塊 board 真的是共享的，
      也真的缺那一行。訊息要講出下一步是 `nook share`
- [ ] 狀態 2：回報 `SharingMismatch`，訊息**帶上 git 自己指出的來源**
      （`git check-ignore -v` 給的 `<file>:<line>:<pattern>`）。我們這一層編不出
      那個行號，所以原封不動帶著走（同 `health.ts` 既有的做法）
- [ ] 狀態 2 的下一步要講清楚有兩條：確認意圖就 `nook init --private`，
      不是故意的就去拿掉那條 ignore 規則
- [ ] 健康的 private board 與健康的 shared board 都**不得**冒出這一條
- [ ] `src/studio/board/health.ts` 的 `boardAlerts()` 要認得新 kind：給它對的
      一句 headline 與對的 `fix`。**現在的實作只分 `MissingMergeDriver` 與
      其他**，所以新 kind 會掉進「op-log 上有 reducer 讀不動的資料」＋
      `nook doctor --fix` —— 兩句都是錯的，而那是看板上唯一會講話的地方
- [ ] `test/studio/health.test.ts` 補上那一條的對應（純函數，照既有形狀）
- [ ] 排序：`MissingMergeDriver` 仍然排第一（既有規則），新 kind 不得把它擠下去

## Test seam

`diagnose(dir)`（`test/core/health.test.ts`，真實 git repo、真實 `git add -f`
與真實 committed `.gitignore`）與純函數 `boardAlerts()`
（`test/studio/health.test.ts`）。React 組件不寫測試。

## Write ownership

- `src/core/types.ts`
- `src/core/health.ts`
- `src/studio/board/health.ts`
- `test/core/health.test.ts`
- `test/studio/health.test.ts`

`DiagnosticKind` 是 `src/index.ts` 已經匯出的型別，**新增一個成員不必改
`src/index.ts`**。若你發現非得改它，回報 blocked —— 那是票 02 的檔案。

**不得碰**：`src/cli/run.ts`（票 03 同批）、任何文件。

## Shared resources

暫存 git repo。不得寫入這個 repo 的 `.issues/`。

## Blocked by

票 04（同一個 `src/core/health.ts`，且壓制規則必須先在那裡定案）。

## Status

todo
