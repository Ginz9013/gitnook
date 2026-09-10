# 08 exclude 規則必須是字面路徑，不是 glob

> **Review 軸在票 01 之後追加（2026-09-10）。狀態 backlog —— 未授權執行。**

## Outcome

`boardPattern()` 把 board 的相對路徑直接拼進 gitignore pattern，**沒有轉義
gitignore 的 metacharacter**。board 在 `a[b]/` 或 `weird*dir/` 底下時，寫進
`info/exclude` 的不是那條路徑，而是一個 glob —— 它可能比對到別的東西，也可能
什麼都比對不到（那就是一塊使用者以為 private、git 卻照樣看得見的 board）。

## Acceptance criteria

- [ ] board 路徑含 `*`、`?`、`[`、`]` 時，寫進 `info/exclude` 的規則以 `\` 轉義，
      且 `git check-ignore` 確認它真的只比對那一個目錄
- [ ] 路徑以 `#` 或 `!` 開頭的那一段也要處理 —— 那兩個字元只在**行首**有特殊
      意義，而我們寫的行以 `/` 開頭，所以實際上安全；**以真實 git 驗證這個推論**，
      不要靠記憶就跳過
- [ ] 路徑含尾端空白時要轉義（git 會吃掉未轉義的尾端空白 —— 這與票 01 修掉的
      `hasLine` 是同一件事的另一半：寫出去的與讀回來的必須是同一條規則）
- [ ] `inspectSharing` 的整行比對在轉義後仍然一致（寫什麼就認什麼）
- [ ] 既有行為不變：不含 metacharacter 的路徑寫出來的那一行與現在一字不差

## Test seam

`excludeBoard` / `inspectSharing` + 真實 `git check-ignore`，
`test/integration/private-mode.test.ts`。

## Write ownership

- `src/core/sharing.ts`
- `test/integration/private-mode.test.ts`

## Shared resources

暫存 git repo（mkdtemp）。

## Blocked by

票 01（已完成）。與票 02、06 搶 `src/core/sharing.ts`，不得同批。

## Status

backlog（Review 追加的範圍，未經授權 —— 要做請移進 queued）
