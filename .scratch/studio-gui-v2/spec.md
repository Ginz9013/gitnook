# Spec —— studio GUI v2：可刪除的資料層、自己的 design token、看板拿掉預設解讀

> **執行模式：parallel。** worker 看不到規劃時的對話，board 因此寫成檔案。
> **儲存位置**：`.scratch/studio-gui-v2/`（本檔 + 一票一檔）。
> **發布目標**：nook 自己的 board（`.issues/`），**票一律開在 `backlog`** ——
> 進 `queued` 是人的授權，規劃不代勞。
> **分兩批出**：批 A（地基）與批 B（版面），spec 是同一份。

## 問題

`nook studio` 在 ADR-0007 之後成為人的主要操作介面，但它目前**做不到人最常做的兩件事**：

- **新增**：`board.create()` 在 core 裡，但**沒有任何 HTTP 端點通到它**。要開一張 Issue 只能回終端機打 `nook new`。
- **刪除／封存**：op-log 是 append-only，v1 因此完全不提供刪除（ADR-0001 規則 4）。而 `archived` 雖然是既有欄位，drawer 卻**只把它畫成一個 Badge，沒有任何地方切得動**（`IssueDetail.tsx:51`）。

視覺上，`index.css` 是原封不動的 shadcn 預設值：18 個中性灰 token，**有一個 `.dark` 區塊但沒有任何地方會加上那個 class**，也沒有切換器 —— dark mode 寫了一半沒接線。註解宣稱「欄位本身用 `--surface` 系列」，而 `--surface*` 這組 token 根本不存在。

版面上，八欄 × 256px 加間距已經超過多數筆電的寬度，而**滑鼠使用者沒有辦法把卡片拖進畫面外的欄位**（鍵盤反而可以 —— `columnKeyboardCoordinates` 有處理）。

最後一件是這次要**拆掉**的：看板目前在八個 Status 上疊了一層「人的車道／agent 的車道」的解讀，並替 `queued` 畫了一個常駐的授權閘門。那是規劃時擅自加上的詮釋，不是使用者要的 —— **欄位的意思應該由使用者自己在用的過程裡長出來。**

## 已定案，不得重新討論

### 沿用既有

| 決定 | 出處 |
|---|---|
| loopback-only 是**唯一**的安全機制；`--host` 永遠不做 | ADR-0007 |
| actor 是跑 studio 的那個人 | ADR-0007 |
| append-only 之下沒有「被拒絕的寫入」，只有 LWW 決勝落敗 | ADR-0007 |
| React 19 + Tailwind v4 + shadcn；不用 preact；不裝 vaul | ADR-0008 |
| markdown → 安全 HTML 只在 server 做，前端不得有第二份渲染器 | ADR-0008 |
| studio bundle 不得被 CLI 進入點 import；`npm run bench` 是閘門 | ADR-0008 |
| 八個 Status 固定、不可自訂；`archived` 是欄位不是 Status | ADR-0003 |
| 沒有快取、沒有索引，全量掃描加摺疊 | ADR-0002 |
| 不設 storage 接縫，打真實檔案系統與真實 git | ADR-0004 |
| 排序必須在 dedupe 之前；未知 Op／未知欄位忽略而非崩潰；寫入必須以 `\n` 結尾 | ADR-0001 |

### 本次新定（規劃對話，四輪）

| # | 決定 |
|---|---|
| D1 | **刪除是 `set deleted=<bool>`，一個新的 LWW 欄位** —— 不是新的 op 型別，不是 unlink 檔案。ADR-0009 記錄，supersede ADR-0001 規則 4 的「v1 不提供刪除」。 |
| D2 | **檔案永遠不 unlink。** 真的清掉位元組留給日後的 `nook gc`（**本批不做**，ADR-0009 寫成「已規劃、未實作」）。理由：modify/delete 是 union 不涵蓋的固有衝突，而「並行分支合併時不衝突」是 CONTEXT.md 的第一句話。 |
| D3 | **刪除一路做到底**：core `Change.deleted` + CLI `nook rm` + studio。不做成只有 GUI 有的能力 —— `blocked` 曾經在三個介面上長成三種行為，那張票還在 board 上。 |
| D4 | **封存與刪除是兩件事，都要有按鈕**；`cancelled` 不做按鈕，拖過去就好。 |
| D5 | **看板不替任何 Status 預設解讀。** 車道線、`queued` 的閘門 Badge、拖入 `queued` 的特別視覺、以及對應的播報用字 —— **四處全拆**，`dropEffect` 只剩「有沒有換欄」，`lanes.ts` 整個消失。ADR-0010 記錄，並改寫 CONTEXT.md 的 Lane 條目與 AGENT.md。**`queued` 對 agent 的授權語意留著**（那是 CLI 與工作流的約定），只是看板不再替使用者畫它。 |
| D6 | **八個 Status 維持固定**（ADR-0003 不動）。「讓使用者自行定義」指的是不要替固定的欄位加解讀，不是欄位可自訂。 |
| D7 | **design token 沿用 shadcn 的 18 格架構，換成 nook 自己的顏色**，另加 `--success` / `--success-foreground` 兩格。**不做 per-Status 的顏色** —— 重點在卡片，欄位顏色會搶戲。 |
| D8 | **四階深淺，卡片最浮**：頁面底（最沉）→ 欄位底（凹槽）→ 卡片（最亮，唯一有 shadow）→ drawer／popover（同卡片階，靠 shadow 分開）。dark mode **階序不變**，卡片仍然是最亮的那一階。 |
| D9 | **回饋色三格**：`--destructive`（紅，危險與錯誤）、`--success`（綠，通過）、`--ring`（高亮／焦點，從中性灰換成看得出來的顏色）。**不開 `--warning`** —— 現在沒有「不算錯但要注意」的狀態，開一格沒有使用者的 token，下一個人就會拿它去畫別的東西。 |
| D10 | 主色 `--primary` 走青綠：`oklch(0.55 0.10 200)`（light）／`oklch(0.72 0.11 200)`（dark）。它**不再背負任何語意**，就是按鈕與連結的顏色。 |
| D11 | **主題偏好記在 `localStorage`**（亮／暗／跟隨系統），不記在 board 目錄 —— studio 是本機單人工具，那是它的正確歸屬。欄位折疊狀態同樣記在 `localStorage`。 |
| D12 | **篩選不持久化**，且生效時 header 必須顯眼地說「篩選中，N 張被隱藏」並提供一鍵清除。一個活過重新整理、又把 Issue 藏起來的篩選器，是讓人以為自己弄丟資料的最快方法。 |
| D13 | **`Card.tsx` 的「還沒落地 = 虛線邊框」不得改成顏色。** 形狀在任何主題、任何色覺底下都成立。 |
| D14 | **「被抓著」改用 shadow 抬高一階 + 游標**，不再用 `ring-primary` —— D5 之後主色沒有語意，拿它當反白會把它的意思稀釋掉。 |
| D15 | 新增 Issue 的表單**只收標題**（單行、Enter 送出、Esc 取消），其餘留給 drawer。入口是 header 一顆按鈕 **＋ 八欄各一個 `+`**（含 `queued` —— 使用者明確裁決）。 |
| D16 | **`nook gc` 與「GUI 儲存按鈕自動 git commit」都排到 v3**，不在這兩批裡。 |

## 測試策略（沿用 `.scratch/studio-write/spec.md`，一字不改）

**只測純邏輯，React 組件不寫測試。** `vitest.config.ts` 維持 `environment: 'node'`，
**不得**新增 jsdom、@testing-library/*、playwright。

- **可測**：core 的摺疊與寫入（真實 fs）、CLI 的路由與輸出、server 的路由與寫入（真實 fs）、
  調和 reducer、`prefs.ts` 的主題與折疊解析（storage 注入）、篩選、**token 的對比度**
- **不可測，靠型別與人工驗收**：React 組件的渲染、DND 的指標互動、橫向平移、
  自動捲動、drawer 的 focus trap、顏色好不好看

寫不出 red-green 的部分，票面明說「本片段無自動化測試」，**不要為了湊紅燈而發明假接縫**。

**新增一種可測的東西：對比度。** design token 的驗收條件（WCAG AA：文字 4.5:1、
UI 元件 3:1，light 與 dark 兩邊都成立）**可以自動化** —— 解析 `src/studio/index.css`
的 `oklch()` 值、轉 sRGB、算對比、斷言。不需要瀏覽器，因此不違反上面那條。
色彩數學放在測試檔裡，**不要為它在 `src/` 開一個沒有第二個使用者的模組**。

## 公開介面與測試接縫

### 1. core：`deleted` 進入既有的 LWW 機器（票 A2）

**這是整份設計的樞紐 —— 它讓刪除幾乎不新增任何機器。**

```ts
// src/core/ops.ts
export type SetKey = 'title' | 'status' | 'description' | 'archived' | 'deleted';  // +1 個字

// src/core/types.ts
export interface Issue {
  // …既有欄位不動
  readonly deleted: boolean;      // 摺疊出來的狀態，與 archived 同一種東西
}
export interface Change {
  // …既有欄位不動
  readonly deleted?: boolean;
}
export class IssueDeleted extends Error { constructor(readonly ref: string) {…} }
```

得到的東西（**一行都不用另外寫**）：收斂、LWW 決勝、`orderOps`、`dedupe`、
`parseLine`、黏合行修復、`doctor`、`nook history <ref> deleted`。

**向前相容的方向是安全的**：`reduce()` 明確忽略未知的 `set` 欄位（`reduce.ts:38-46`，
ADR-0001 規則 2），所以舊版 nook 讀到 `set deleted=true` 會**仍然看得見那張 Issue**。
失敗的方向是「看得到不該看的」而不是「東西不見了」。這一句要寫進 ADR-0009。

行為契約，**三條，各自只住在一個地方**：

| 呼叫 | 對一張已刪的 Issue |
|---|---|
| `board.list()`（含 `all: true`） | 當它不存在。**board 成員資格的唯一決定點。** |
| `board.get(ref)` | **正常回傳**，`deleted: true`。不拋 —— 呼叫端要說得出「這張已被刪除」。 |
| `board.apply(ref, change)` | 拋 `IssueDeleted`，**除非** `change.deleted === false`（復原）。**寫入安全的唯一決定點**，CLI／server／studio 三邊因此一律繼承。 |
| `board.opLog(ref)` / `board.refs()` | 照常。前者是誤刪的救生索；後者不能縮短，否則既有的短 Ref 會突然變有歧義。 |

### 2. CLI（票 A3）

```
nook rm <ref> [--yes]          刪除。預設互動確認；非 TTY 且沒有 --yes 時拒絕。
nook set <ref> deleted <bool>  同一條 op 的直接寫法；復原走 deleted false。
nook show <已刪>               明說「這張已被刪除」，exit 1。
nook history <ref> deleted     免費（deleted 進了 SETTABLE）。
```

`rm` 定義為「`set deleted true` **加上一次確認**」——不是第二條路徑，是安全包裝。
agent 誤刪比人誤刪容易，所以確認是預設而不是選項。

### 3. server（票 A4 / B1）

**刪除不新增任何端點** —— `Change` 多了 `deleted`，既有的 `POST /i/<ref>` 就通了。
405 白名單一個字都不動。

```
POST   /i/<ref>           body: Change（現在含 deleted） → 200 + IssueView
POST   /api/issues        body: { title, status? }      → 201 + IssueView      ← 新（A4）
GET    /api/board-info    → { root, branch, actor, diagnostics }               ← 新（B1）
GET    /api/history/<ref> → { writes: [{ field, value, actor, t }] }            ← 新（B1）
```

`IssueView` 加一格 `readonly deleted: boolean` —— client 收到 `deleted: true` 的 ACK
才知道要把它從快照上拿掉。

錯誤對應（延伸既有那張表）：

| 情況 | 回應 |
|---|---|
| `IssueDeleted` | **410 Gone** |
| `POST /api/issues` 沒有 title、title 是空字串、或 status 不是合法 Status | 400 |
| 其餘 | 沿用票 03 既有的 404 / 400 / 405 |

`/api/board-info` **獨立於快照**，只在開場抓一次：`board.health()` 會 spawn 一個
`git rev-parse`（`health.ts:167`），掛進 `/api/board` 等於每次全量讀取都多一個子行程
—— 而快照在 `unmatchedAck` 落空時還會被重抓。

### 4. `reconcile.ts`：兩條新規則（票 A5）

```ts
export type ClientAction<I> =
  | …既有七種
  | { readonly type: 'CREATED'; readonly issue: I };   // 新
```

- **`CREATED`**：把 server 回來的那張**接進快照**。新增**不做樂觀更新** —— 新 Issue 的
  ULID 由 server 產生，client 沒有 id 可以先畫；而 loopback 上一次全量摺疊是 14ms
  （ADR-0002 實測）。發明一個暫時 id 再回頭認領，買到的是十幾毫秒，付的是調和
  模型上第二種「這張還不存在」的狀態。
- **`ACK` 收到 `deleted: true` 的 issue → 從快照移除，而不是蓋回那一格。**
  現行的 ACK 是「用回應覆蓋那一格」，照做會留下一張已刪但仍在畫面上的卡片。

兩條都是純 reducer 的行為，**兩條都要有測試**。

### 5. `src/studio/prefs.ts`：本機檢視偏好（票 A6）

主題與欄位折疊是同一種東西：**只影響這台機器上這個人怎麼看，不進 op-log。**
一個模組、一道 storage 接縫、兩個使用者。

```ts
export type ThemePreference = 'light' | 'dark' | 'system';
export interface PrefStorage {                       // 注入 —— 因此不需要 jsdom
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readTheme(s: PrefStorage): ThemePreference;          // 壞值 → 'system'
export function writeTheme(s: PrefStorage, p: ThemePreference): void;
export function resolveTheme(p: ThemePreference, systemDark: boolean): 'light' | 'dark';
export function readCollapsed(s: PrefStorage): ReadonlySet<Status>;  // 壞值 → 空集合
export function writeCollapsed(s: PrefStorage, c: ReadonlySet<Status>): void;
```

**壞掉的儲存值一律退回預設而不是拋錯**：`localStorage` 裡的東西是使用者的瀏覽器
說了算，一個手改過的值不該讓整個看板開不起來。

### 6. `lanes.ts` 消失（票 A7）

`LANE_OF` / `Lane` / `StatusLane` / `STATUS_LANES` / `DropEffect` / `dropEffect` **全部刪除**。
存活的兩個函式搬家 —— 它們與車道無關：

- `isStatus` → `@/statuses`（`STATUS_ORDER` 已經在那裡）
- `groupByStatus` → `@/statuses`

`dnd.ts` 的 `columnKeyboardCoordinates` 改讀 `STATUS_ORDER`。
`Board.tsx` 刪掉 `LaneBoundary` 與 `dropEffect` 的 switch，放下就是
「有換欄就送 `onMove`，沒換就送 `onRelease`」。
`Column.tsx` 刪掉 `TARGET_STYLE.authorize`、`TARGET_HINT` 整份、與閘門 Badge。
`announce.ts` 刪掉 `authorize` 的兩處措辭。
`test/studio/board.test.ts` 的 `STATUS_LANES` 與 `dropEffect` 兩個 describe 一併刪除。

### 7. `src/studio/board/filter.ts`：篩選（票 B6）

```ts
export function allLabels(issues: readonly { labels: readonly string[] }[]): readonly string[];
export function matchesLabels(issue: { labels: readonly string[] }, selected: readonly string[]): boolean;
```

多選之間是 **AND**，與 core `Filter.labels` 的收斂語意一致 —— 過濾應該越加越窄。
純前端，不打 server。

## 非目標

- **`nook gc`**（把有墓碑的檔案真的 unlink）。ADR-0009 記錄為已規劃、未實作。
- **GUI 儲存按鈕自動 git commit**。v3。
- **可自訂欄位／Status**。ADR-0003 不動（D6）。
- **全文搜尋**。AGENT.md 明寫「沒有 search UI」是設計而不是缺口；依 label 篩選是
  用既有詞彙收攏看板，與那句話不衝突。
- **樂觀新增**。見第 4 節。
- **jsdom / 元件測試 / e2e**。
- **`--warning` token**。
- **通知、多人、認證、`--host`**。

## 驗收條件

批 A 做完時：

1. 在 studio 上可以新增一張 Issue（header 與八個欄頂各一個入口），**不必回終端機**。
2. 在 drawer 上可以封存、取消封存、刪除；刪除有確認框，按下之後那張從看板上消失。
3. `nook rm <ref>` 有同樣的效果；`nook list --all` 不再列它；`nook history <ref>` 仍撈得回來；`nook show <ref>` 說得出「已被刪除」。
4. 舊版 nook（`node_modules/gitnook`）讀同一塊 board 時，被刪的那張**仍然看得見**——失敗方向正確。
5. 主題可切亮／暗／跟隨系統，重新整理後記得；兩個主題下 token 對比度都過 WCAG AA，且有測試證明。
6. 看板上找不到任何一處把 `queued` 或車道講成特別的東西；`grep -r "車道\|授權閘門\|LANE_OF\|STATUS_LANES\|authorize" src/` 只在 CLI／文件的授權語意處有結果。

批 B 做完時：

7. 八欄可個別折疊成只剩標題的直立條，重新整理後記得；折起來的欄位仍然收得下拖過來的卡片。
8. 滑鼠可以抓看板空白處橫向平移；拖著卡片走到畫面邊緣時看板自動捲動 —— 也就是**滑鼠使用者拖得進畫面外的欄位**。
9. header 有 logo 佔位 + 「Git Nook」文字 logo、board 路徑、分支、actor、以及新增／篩選／顯示已封存／主題切換。
10. `.gitattributes` 少了 `merge=union` 時 studio 會顯眼地講出來。
11. drawer 底部有一個預設收合的變更歷史區塊。
12. 零張 Issue 與載入中都有像樣的畫面，不是一行「載入中…」。

## 驗證指令

```bash
npm run typecheck            # tsc --noEmit
npm test                     # vitest run，全套
npx vitest run test/core     # 聚焦：core
npx vitest run test/cli      # 聚焦：CLI
npx vitest run test/server   # 聚焦：server
npx vitest run test/studio   # 聚焦：studio 純模組
npm run build                # 絕不可只跑 npx tsup —— 它會清掉 dist/studio/
npm run bench                # studio bundle 未進 CLI 鏈的閘門
npm run nook -- list --all   # dogfood 一律走這條，不用 npx nook
```

## 已知基準線（2026-09-10 實測，非假設）

- `npm run typecheck`：**乾淨**。
- `npm test`：**26 個檔案 / 416 個測試，全過**。
- 既有缺陷，**不是這批的工作，不要順手修**：
  - `@radix-ui/react-alert-dialog` 宣告在 `devDependencies` 但**沒有任何一行 import 它**。
    票 A9 的刪除確認框正好是它的第一個使用者 —— 那張票會讓它從死相依變成活的。
- `src/studio/index.css` 的註解宣稱「欄位本身用 `--surface` 系列」，而 `--surface*`
  不存在。票 A6 一併改掉那句話。

## 平行執行的共用資源

- **沒有 port 衝突**：`test/server/serve.test.ts` 用 port 0（由核心配）。
- **沒有共用暫存目錄**：core 與 server 的測試各自 `mkdtemp`。
- **`.issues/` 是共用的**，但 worker 只讀不寫；board 狀態的更新由主流程做。
- **`src/studio/index.css` 是熱點**：票 A6（token）獨佔它。其他票不得碰。
- **`src/core/types.ts` 是熱點**：票 A2 獨佔它。
- **`src/studio/board/Board.tsx` 是批 B 的大熱點**：B2–B6 全部落在它與
  `BoardHeader.tsx` 上。批 B 因此幾乎是 serial 的 —— 見 `README.md`，
  不要為了湊平行度把它們排在同一輪。
