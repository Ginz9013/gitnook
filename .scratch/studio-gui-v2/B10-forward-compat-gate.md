# B10 —— 向前相容目前只有人工守著

**批次**：B（追加）｜ **阻擋**：無 ｜ **來源**：批 B 的 Spec 軸審查

## 問題

spec 的驗收條件 4：

> 舊版 nook（`node_modules/gitnook`）讀同一塊 board 時，被刪的那張**仍然看得見**
> —— 失敗方向正確。

這是整批工作**最核心的承諾**：資料活在 git 裡，隊友的版本不同步是常態
（ADR-0001 硬規則 2），所以刪除失敗的方向必須是「看到不該看的」，
永遠不能是「東西不見了」。

它被驗過兩次（A10 的驗收走查、批 B 的 Spec 審查），**兩次都是人工**。
`test/core/reduce.malformed.test.ts` 測的是「`reduce` 忽略未知的 `set` 欄位」，
那是機制；沒有任何東西釘住「**那個已發布的二進位檔**讀這塊 board 時看得見它」。

一個未來的改動只要讓 `deleted` 變成新的 op 型別（而不是 LWW 欄位），
機制那條測試照樣綠，而這條承諾當場破掉且沒有人會知道。

## 介面

一條整合測試，住在 `test/integration/`（那裡已經有 `packed-smoke` 與
`git-merge`，兩者都 spawn 真的子行程 —— ADR-0004：打真實檔案系統與真實 git）。

```
1. mkdtemp + git init + 用**工作樹的** core 建一塊 board，開兩張 Issue
2. 用工作樹的 board.apply 把其中一張標成 deleted
3. spawn `node <repo>/node_modules/gitnook/bin/nook.js list --all`
4. 斷言：兩張都在輸出裡
5. 斷言：那個舊二進位檔的 `doctor` exit 0 —— 它不該把墓碑當成資料損壞
```

**用 `node_modules/gitnook` 是刻意的**，與 AGENT.md 對 studio 的告誡相反：
這裡要的正是「已發布的舊版本」這個角色，它就是那個舊讀者。測試裡要有一句
註解講明白，否則下一個人會照著 AGENT.md 把它改成 `bin/nook.js`，而那會讓這
條測試變成拿新版讀新版，什麼都不證明。

## 先寫紅燈

紅燈用注入的方式取得（現況是綠的，這條是守衛）：把 `reduce.ts` 對 `deleted`
的處理改成一個新的 op 型別 —— 也就是 ADR-0009 明確否決的那條路 —— 舊版讀不
懂它，那張 Issue 在舊版眼裡仍然存在……**等一下，那樣反而還是綠的。**

真正會讓它紅的注入是：把 `board.apply` 的刪除改成 `unlinkSync(pathOf(id))`，
也就是 ADR-0009 否決的另一條路（D2）。舊版於是**看不到那張 Issue**，失敗方向
反轉。實作者請用這個注入證明測試有鑑別力，並在報告裡記下來 —— 這條測試守的
是 D2 而不是 D1。

## 寫入所有權

```
test/integration/forward-compat.test.ts   （新）
```

## 注意

`node_modules/gitnook` 是指向已發布 0.1.0 的符號連結。若日後 `devDependencies`
裡的版本被升到含有刪除功能的版本，這條測試就不再測「舊讀者」了 —— 屆時它會
變成一條沒有意義的綠燈。測試裡要斷言那個二進位檔的 `--version`**不是**目前
`package.json` 的 version，讓那一天有人被擋下來。

## 驗證

```bash
npx vitest run test/integration
npm test
```
