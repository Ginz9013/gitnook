# A3 —— CLI：`nook rm`、`set deleted`、`show` 對已刪 Issue 說得出話

**批次**：A ｜ **阻擋**：A2（core 的 `deleted`）、A1（AGENT.md 散文先改完）

## 目標

刪除要一路做到底。**不做成只有 GUI 有的能力** —— `blocked` 曾經在三個介面上
長成三種行為，那張票還在 board 上（`01M22PKRS`）。

## 介面

```
nook rm <ref> [--yes]           刪除。預設互動確認；非 TTY 且沒有 --yes 時拒絕。
nook set <ref> deleted <bool>   同一條 op 的直接寫法；復原走 deleted false。
nook show <已刪>                明說「這張已被刪除」，exit 1。
nook history <ref> deleted      免費 —— deleted 進了 SETTABLE。
```

`rm` 的定義是「**`set deleted true` 加上一次確認**」，不是第二條路徑。
agent 誤刪比人誤刪容易，所以確認是預設而不是選項；`--yes` 是 agent 的出口。

## 先寫紅燈

1. `rm <ref> --yes` 之後 `list --all` 不含它，exit 0。
2. `rm <ref>` 在非 TTY 且無 `--yes` → exit 1，訊息說得出要加 `--yes`。
3. `set <ref> deleted true` / `false` 兩向都成立；非 `true`/`false` 的值報錯
   （沿用 `asChange` 對 `archived` 既有的守衛）。
4. `show <已刪>` → exit 1，輸出含「已被刪除」，**並且指出 `nook history` 撈得回來**。
5. `history <已刪>` → exit 0，列得出 op（救生索）。
6. `history <ref> deleted` → 只列 `deleted` 的寫入。
7. `comment` / `mv` / `label` 對已刪的 Issue → exit 1，訊息來自 `IssueDeleted`。
8. **`test/agent-doc.test.ts` 的兩條斷言都要綠** —— 見下。

## 綠燈

- `run.ts`：`case 'rm'`、`cmdRm`、`RM_FLAGS`（`--yes`）、`SETTABLE` 加 `'deleted'`、
  `asChange` 對 `deleted` 比照 `archived`、`--help` 的指令表加一行。
- 認得 `IssueDeleted` 並對應成 exit 1 的使用者錯誤（不是 exit 2 的內部錯誤）。

## ⚠️ 隱藏耦合 —— 這張票必須同時改 AGENT.md 的指令表

`test/agent-doc.test.ts` 是**雙向**的：AGENT.md 提到的指令必須存在，**而且**
`--help` 有的指令 AGENT.md 必須提。所以 `--help` 一加上 `rm`，AGENT.md 沒同步
就當場紅燈。**同一張票裡一起改。** A1 已經改完散文，這裡只動指令表那一列
（以及「What nook deliberately refuses」那段 —— 它現在要說「有刪除，但刪除
不 unlink 檔案」）。

## 寫入所有權

```
src/cli/run.ts
test/cli/run.test.ts
AGENT.md          （只動指令表與 refuses 那段；散文歸 A1）
```

## 驗證

```bash
npx vitest run test/cli test/agent-doc.test.ts
npm test
npm run nook -- --help     # dogfood 走完整路徑，不用 npx nook
```
