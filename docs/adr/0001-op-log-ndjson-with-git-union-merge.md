# Op-log NDJSON，靠 git 內建的 `merge=union` 達成零衝突

同類工具（backlog.md 等）把 markdown 當**儲存格式**，用 `## Status` 這樣的 heading 當資料庫欄位；並行分支修改同一張 Issue 時必然產生人工衝突，而且 heading 解析本身就是持續的 bug 來源。我們改以 op-based CRDT 儲存：每張 Issue 一個 append-only NDJSON 檔，一行一個 Op；`.gitattributes` 中的 `.issues/issues/*.ndjson merge=union` 讓 git 在合併時保留雙方所有行，而摺疊結果只取決於 Op 的**集合**（先以 `(t, actor, id)` 全序排序、再 dedupe by id）而非行的順序，因此合併必然收斂。

## Considered Options

- **markdown + frontmatter** —— 在 GitHub 上可讀，但沒有任何合併語意，且 heading 邊界解析會反覆出錯。
- **Automerge / Yjs / Loro** —— 成熟的 CRDT，但都是 binary blob：git diff 不可讀（等於放棄相對 git-bug 的最大優勢），git 預設合併會直接損毀檔案，需要自訂 merge driver；而 `.gitattributes` 只能指定 driver **名稱**，實際命令必須每位開發者在 local `git config` 註冊（git 的安全設計），靠 postinstall 代勞在 `--ignore-scripts` 與 CI 下會失效，「開箱即用」的承諾隨之破功。三者又都是 Rust→WASM，1MB 起跳，與輕量定位衝突。
- **git 內建的 `union`** —— 選這個。它是內建 driver，`.gitattributes` 提交後對所有 clone 自動生效，**不需要任何人執行 `git config`**。

## Consequences

實測（git 2.50.1，記錄於 board 的 `spike-findings.md`）逼出三條不可協商的規則：

1. **每次寫入必須以 `\n` 結尾。** 缺少時 union merge 會把兩行黏成非法 JSON 並複製前一行。reducer 必須偵測黏合行，`doctor` 必須能修復。
2. **未知的 Op 型別必須忽略而非崩潰。** 資料活在 git 裡，隊友的版本不同步是常態；向前相容在這裡是資料安全問題。
3. **排序必須在 dedupe 之前。** 實測只證實 git 會去重位元組完全相同的行；同 id 而內容不同的行會兩行都留下。先 dedupe 等於把「第一次出現」定義在行順序上，收斂性即告破功。
4. **不得真的刪除 Issue 檔。** modify/delete 是 union 不涵蓋的固有衝突。v1 因此完全不提供刪除。

代價：NDJSON 在 GitHub 網頁上不如 markdown 好讀。緩解方式是讓 Op 的 JSON 單行可讀，加上由 studio 提供給人看的檢視。**原本規劃的另一半 —— `show` 的 markdown 輸出 —— 評估後決定不做。**那句是 v1 規劃時寫的，當時除了換一種輸出格式沒有別的解；v1 之後 studio 出現，ADR-0007 讓它成為人的介面（而且能直接編輯），「op-log 難讀」的答案因此從「多一種輸出」變成「在本機開 studio 看」，而需要程式化串接的場景 `--json` 已經覆蓋 —— 再加一個輸出格式旗標，會把目前唯一的 `--json` 變成一組必須一起維護、一起量 token 的家族（ADR-0005）。放棄的是：把一張 Issue 貼進 PR 描述或 Slack 時沒有現成的 markdown，得自己從表格或 `--json` 轉；而且 studio 這個答案要求對方有 clone 並能在本機把它跑起來 —— 純粹在 GitHub 網頁上瀏覽這個 repo 的人，看到的仍然是 NDJSON。

**絕不可同時提交一份產生出來的 markdown 當「可讀版本」** —— 那會製造第二個衝突來源，把剛解決的問題原地加倍。

`.gitattributes` 中的那一行是整個系統的**唯一單點失效**，被誤刪時資料會靜默開始衝突。`doctor` 必須檢查它，讀取類指令在偵測到缺失時必須警告。
