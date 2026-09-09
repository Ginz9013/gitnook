import { describe, it, expect } from 'vitest';

import type { Diagnostic } from '../../src/core/types.js';
import { boardAlerts } from '../../src/studio/board/health.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM。
//
// 票 B5 本身**沒有自動化測試** —— 警示條、空看板、載入骨架都是版面，而
// spec.md 的測試策略是「React 組件不寫測試」。這個檔案裝的是那張票裡唯一
// 可判定的規則：一條 `Diagnostic` 該不該講出來、講的時候人要讀到哪一句、
// 以及下一步該打哪個指令。它被推進 `board/health.ts` 正是為了測得到，
// 同 `board/path.ts` 與 `board/collapse.ts`。

describe('boardAlerts —— 不是 git repo 不是警示', () => {
  // nook 不要求 git（AGENT.md：`.gitattributes` 只在 git 底下生效，
  // 而 `diagnose()` 仍然回報 NotAGitRepo 讓 `doctor` 說得出話）。把它畫成
  // 一條紅色警示條，等於對一個正常的工作狀態拉警報 —— 而拉過一次假警報的
  // 警示條，下一次真的紅起來時沒有人會讀。
  it('NotAGitRepo 不產生任何警示', () => {
    expect(
      boardAlerts([{ kind: 'NotAGitRepo', message: '/tmp/x 不在 git work tree 內：merge=union 不會生效' }]),
    ).toEqual([]);
  });
});

describe('boardAlerts —— 缺了 merge=union 要說出缺什麼與下一步', () => {
  // 整個系統的唯一單點失效（ADR-0001）：這一行不在，並行編輯會靜默開始衝突。
  // CLI 的 `list`／`show` 會警告、`doctor` 會擋，studio 在這張票之前一聲不吭。
  const missing: Diagnostic = {
    kind: 'MissingMergeDriver',
    file: '.gitattributes',
    message: '缺少零衝突保證：.issues/issues/*.ndjson merge=union（執行 nook init 補回）',
  };

  // **core 自己說的那句話原封不動送上畫面** —— 同 `App.tsx` 的 `StatusBanner`：
  // 它裡面帶著缺的到底是哪一行，那是我們在這裡編不出來的東西。
  it('引用 diagnose() 的原話', () => {
    expect(boardAlerts([missing])[0]?.said).toBe(missing.message);
  });

  it('下一步是 nook init —— 它會把那一行補回來', () => {
    expect(boardAlerts([missing])[0]?.fix).toBe('nook init');
  });

  // 指到哪個檔案要看得見：`.gitattributes` 可能有好幾個（子目錄各一份）。
  it('說得出是哪個檔案', () => {
    expect(boardAlerts([missing])[0]?.where).toBe('.gitattributes');
  });

  // 我們自己也要有一句話，因為原話說的是「缺了什麼」而不是「這件事有多嚴重」。
  it('除了原話還有一句我們自己的話', () => {
    expect(boardAlerts([missing])[0]?.headline.length ?? 0).toBeGreaterThan(0);
  });
});

describe('boardAlerts —— 其餘的 Diagnostic 指向 nook doctor --fix', () => {
  const glued: Diagnostic = {
    kind: 'GluedLine',
    file: '.issues/issues/01JBX.ndjson',
    line: 12,
    message: '2 個 op 被黏成一行（寫入時缺少 trailing newline），可修復：{"op":"crea…',
  };

  // 黏合行、讀不懂的行、不認得的 op —— 三種的下一步是同一個指令，而那個指令
  // **不是 `nook init`**：`init` 補的是 `.gitattributes` 那一行，對已經寫進
  // op-log 的資料一點作用都沒有。指錯指令的警示條比不講話更糟。
  it('黏合行的下一步是 doctor 而不是 init', () => {
    expect(boardAlerts([glued])[0]?.fix).toBe('nook doctor --fix');
  });

  it('讀不懂的行也是', () => {
    expect(
      boardAlerts([{ ...glued, kind: 'UnparsableLine', message: '無法解析，reducer 會丟棄這一行' }])[0]
        ?.fix,
    ).toBe('nook doctor --fix');
  });

  it('不認得的 op 也是', () => {
    expect(
      boardAlerts([{ ...glued, kind: 'UnknownOp', message: '未知的 op 型別 zap：reducer 會忽略這一行' }])[0]
        ?.fix,
    ).toBe('nook doctor --fix');
  });

  // 行號要跟著檔名走：一個 op-log 有上千行，只說檔名等於叫人自己找。
  it('說得出是哪個檔案的第幾行', () => {
    expect(boardAlerts([glued])[0]?.where).toBe('.issues/issues/01JBX.ndjson:12');
  });
});

describe('boardAlerts —— 同一種問題只佔一條', () => {
  const glued = (line: number): Diagnostic => ({
    kind: 'GluedLine',
    file: '.issues/issues/01JBX.ndjson',
    line,
    message: `第 ${line} 行有 2 個 op 被黏成一行`,
  });

  // 一次沒有 trailing newline 的合併會黏掉整個檔案。一條一列的話，header 底下
  // 會長出幾百條一模一樣的紅色橫幅，把看板整個推出畫面 —— 而它們的下一步是
  // 同一個指令。第一條說得出「長什麼樣」，數字說得出「有多大片」。
  it('三條黏合行只產生一條警示', () => {
    expect(boardAlerts([glued(3), glued(9), glued(41)])).toHaveLength(1);
  });

  it('列出來的是第一條的原話', () => {
    expect(boardAlerts([glued(3), glued(9), glued(41)])[0]?.said).toBe(glued(3).message);
  });

  it('沒列出來的那幾條算數 —— 說得出還有幾條', () => {
    expect(boardAlerts([glued(3), glued(9), glued(41)])[0]?.more).toBe(2);
  });

  it('只有一條時沒有「還有幾條」', () => {
    expect(boardAlerts([glued(3)])[0]?.more).toBe(0);
  });

  // 種類不同就是不同的問題，各自佔一條 —— 讀不懂的行修不回來，黏合行修得回來。
  it('不同種類各佔一條', () => {
    expect(
      boardAlerts([glued(3), { kind: 'UnparsableLine', file: 'a.ndjson', line: 1, message: '讀不懂' }]),
    ).toHaveLength(2);
  });
});

describe('boardAlerts —— 唯一的單點失效排在最前面', () => {
  // `diagnose()` 的順序是它掃描的順序（先 git、再 .gitattributes、再逐個
  // op-log），不是嚴重程度的順序。而讀的人是由上往下讀：黏合行修得回來
  // （`doctor --fix`），少了 merge=union 則是**接下來每一次合併都會靜默壞掉**
  // （ADR-0001 的唯一單點失效）。後者要排在看得到的那一行。
  it('缺 merge=union 排在資料層的問題前面', () => {
    const alerts = boardAlerts([
      { kind: 'GluedLine', file: 'a.ndjson', line: 1, message: '黏合' },
      { kind: 'MissingMergeDriver', file: '.gitattributes', message: '缺少零衝突保證' },
    ]);
    expect(alerts.map((a) => a.kind)).toEqual(['MissingMergeDriver', 'GluedLine']);
  });
});
