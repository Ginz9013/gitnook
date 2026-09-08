# Spike：`merge=union` 實測結果

執行環境：git 2.50.1 (Apple Git-155)、node v22.22.1、2026-09-08
結果：**7 pass / 1 fail**。核心論點成立，並發現 3 個必須進設計的約束。

## T1 ✅ 核心假設成立

兩分支各自 append 不同 op → merge 零衝突、三個 op 全數保留、順序合理。

```
{"id":"a1","op":"create","t":1}
{"id":"a2","op":"set","k":"status","v":"doing","t":2}
{"id":"a3","op":"label.add","v":"bug","t":3}
```

`.gitattributes` 內的 `*.ndjson merge=union` 提交後即對所有 clone 生效，**無需任何人執行 `git config`** —— union 是 git 內建 driver，不是自訂 driver（自訂 driver 的命令必須每位開發者在 local 註冊，那是 git 的安全設計，會讓「開箱即用」的承諾破功）。

## T2 ❌ 資料毀損路徑：缺少 trailing newline

最後一行無 `\n` 時，union merge 把兩行黏成一行，且複製了前一行：

```
{"id":"b1","t":1}{"id":"b2","t":2}     ← 非法 JSON
{"id":"b1","t":1}{"id":"b3","t":3}
```

**→ 硬規則 1：每次寫入強制 trailing newline；reducer 偵測黏合行；`doctor` 能修復。**

## T3 ⚠️ 位元組完全相同的行會自然去重

實測 count=1。但那是因為 git 三方合併把「雙方做了同樣的修改」視為單一修改，**與 union 無關**。同 `id` 但 `t` 不同的 op 不會去重。

**→ reducer 的 dedupe-by-id 仍然必要。**

## T4 ✅ `git pull --rebase` 路徑同樣套用 union

rebase 乾淨，三行都在。重要，因為 rebase 是多數團隊的日常。

## T5 ⚠️ 壓縮會產生語意垃圾

一邊重寫整檔（壓縮），一邊 append —— merge 沒有衝突，但結果同時含有 snapshot 和它取代掉的 op，reducer 會重複套用：

```
{"id":"e1","t":1}     ← 應已被 snapshot 取代
{"id":"e2","t":2}
{"id":"e3","t":3}
{"id":"snap","op":"snapshot","t":2}
```

**→ snapshot op 必須攜帶 `supersedes: <lamport>`，reducer 據此丟棄被取代的 op。v1 不實作壓縮，但格式需預留。**

## T6 ⚠️ modify/delete 是 union 不涵蓋的固有衝突

一邊 `git rm`、一邊 append → 衝突。

**→ 硬規則 3：不得真的刪除 issue 檔。v1 不提供刪除；未來以 tombstone op 實作。**

## 效能實測（決定不使用 SQLite 的依據）

全量掃描 + fold（每票 40 個 op，中位數 of 5）：

| issues | op-log 總大小 | 掃描 + fold |
|---|---|---|
| 100 | 0.3 MB | 3 ms |
| 500 | 1.7 MB | 14 ms |
| 2000 | 6.8 MB | 53 ms |
| 10000 | 34.0 MB | 266 ms |

Node 本身冷啟 10–20ms。**重新考慮快取的門檻：~5000 張票。**
