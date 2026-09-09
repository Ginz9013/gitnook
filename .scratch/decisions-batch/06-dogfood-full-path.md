# 06 dogfood 一律用完整路徑

nook ref：`01M233A9WPS7AVTXTRHT9ZHF0Y`

## Outcome

dogfood 規則說「使用的一律是 npm 上發布的版本」，但 `npx nook` 跑的是工作
目錄的 build —— **整條規則一直靜默失效，而且不會被察覺**，因為兩份輸出看
起來都像對的。

原因：npx 優先跑專案自己在 `package.json` 宣告的 bin，於是
`import from '../dist/cli/run.js'` 的 `../dist` 指到工作目錄。

## 決定（已定案）

**一律用 `node node_modules/gitnook/bin/nook.js`。** 醜但明確，零設定、
零魔法。不改成 alias —— 那多一層間接且行為靠 npm 版本。

## Acceptance criteria

- [ ] `AGENT.md` 寫進這條規則，並說明**為什麼** `npx nook` 不行 ——
      沒有那個理由，下一個人（含 agent）會覺得完整路徑很蠢而改回去
- [ ] 可以配一個 npm script 把它包起來（例如 `npm run nook -- list`），
      但**規則本身要寫清楚**，script 只是方便
- [ ] 一併確認 `AGENT.md` 現有的 dogfood 相關描述沒有其他地方在教人用
      `npx nook`

## Test seam

無自動化測試 —— 這是文件與一個 npm script。

## Write ownership

- `AGENT.md`
- `package.json`

**不得碰**：`src/**`、`test/**`、`README.md`、`package-lock.json`
（加 script 不需要動 lock）。

## Blocked by

票 01（已完成，它動過 `AGENT.md`）。

## Status

queued
