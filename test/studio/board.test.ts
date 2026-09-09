import { describe, it, expect } from 'vitest';
import { STATUSES } from '../../src/core/types.js';
import type { Status } from '../../src/core/types.js';
import { STATUS_ORDER } from '../../src/studio/statuses.js';
import { STATUS_LANES, isStatus, dropEffect, groupByStatus } from '../../src/studio/board/lanes.js';
import {
  dragInstructions,
  announceGrab,
  announceOver,
  announceDrop,
  announceCancel,
  pendingParts,
  pendingLabel,
  announceIssueState,
} from '../../src/studio/board/announce.js';
import type { OptimisticField, UnconfirmedComment } from '../../src/studio/reconcile.js';

// 純函式，environment: 'node'。不 import React、不碰 DOM。
//
// spec.md 的測試策略是「**React 組件**不寫測試」，不是「board/ 底下不寫測試」。
// 可判定的規則被推進 `board/lanes.ts` 與 `board/announce.ts` 正是為了讓它們
// 測得到 —— 邏輯放對了位置，這個檔案是把網子張開。

describe('STATUS_ORDER —— 與 core 的 STATUSES 同一份順序', () => {
  // `statuses.ts` 的 `_members` / `_ordered` 是編譯期守衛。這是執行期的第二道：
  // 它在 `npx vitest run` 就會響，不必等到有人跑 `tsc`。
  it('八個 Status 的內容與順序都與 core 一致', () => {
    expect([...STATUS_ORDER]).toEqual([...STATUSES]);
  });

  it('看板由左到右的順序就是那一份 —— 看板與 core 不會各排各的', () => {
    expect(STATUS_LANES.map((l) => l.status)).toEqual([...STATUSES]);
  });
});

describe('STATUS_LANES —— 人與 agent 的交接線', () => {
  // CONTEXT.md：`backlog`/`todo` 是人的車道，`queued` 之後是 agent 的車道。
  // 這條線是 Board 上最重要的分界，而分界只出現在換手的那一格。
  it('交接線只畫一條，就在 queued 前面', () => {
    const opens = STATUS_LANES.filter((l) => l.opensLane).map((l) => l.status);

    expect(opens).toEqual(['queued']);
  });

  it('最左邊那一格左側不畫線 —— 那裡沒有換手', () => {
    expect(STATUS_LANES[0]?.opensLane).toBe(false);
  });

  it('每個 Status 都恰好出現一次', () => {
    const seen = new Set<Status>(STATUS_LANES.map((l) => l.status));

    expect(seen.size).toBe(STATUS_LANES.length);
  });
});

describe('isStatus —— 只認那八個 Status', () => {
  it('八個 Status 全部認得', () => {
    expect(STATUSES.filter(isStatus)).toEqual([...STATUSES]);
  });

  // `archived` 是 Issue 的一個欄位（見 reconcile 的 OptimisticField），不是 Status。
  // 它是最容易被誤當成第九個 Status 的字，所以特地釘住。
  it('擋得掉不是 Status 的 Issue 欄位名', () => {
    for (const notAStatus of ['archived', 'title', 'description', 'labels', 'comment']) {
      expect(isStatus(notAStatus)).toBe(false);
    }
  });

  // 判斷是查一張以 Status 為鍵的表，所以 Object.prototype 上的名字必須擋掉 ——
  // 否則 `?to=toString` 這種 query 就變成一個合法的 Status。
  it('擋得掉 Object.prototype 上的名字', () => {
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      expect(isStatus(inherited)).toBe(false);
    }
  });

  it('不是字串的東西一律不是 Status', () => {
    for (const notAString of [null, undefined, 42, {}, ['todo'], new String('todo')]) {
      expect(isStatus(notAString)).toBe(false);
    }
  });

  // `resolveStatus` 收無歧義前綴（`in_p` → `in_progress`），那是 CLI 的便利。
  // 看板收到的是拖放目標的 id，必須是完整值 —— 這裡不做任何猜測。
  it('前綴與大小寫都不算 —— 猜測是 CLI 的事，不是看板的', () => {
    for (const notExact of ['in_p', 'q', 'TODO', 'Blocked', 'todo ', ' todo']) {
      expect(isStatus(notExact)).toBe(false);
    }
  });
});

describe('dropEffect —— 一次放下會發生什麼', () => {
  const others = (self: Status): readonly Status[] => STATUSES.filter((s) => s !== self);

  // op-log 是 append-only：一次什麼都沒改的放下不該在 .ndjson 上留下痕跡。
  // 這一條排在最前面，所以連 queued 與 blocked 放回自己身上也還是 none。
  it('放回原本的 Status 什麼都不是', () => {
    for (const s of STATUSES) expect(dropEffect(s, s)).toBe('none');
  });

  // CONTEXT.md：進 queued 表示需求已釐清、已授權 agent 不再詢問直接動手。
  // 它是授權邊界，不是第三欄，所以不能與一般搬移共用同一個結果。
  it('進 queued 是一次授權，不是一次搬移', () => {
    for (const from of others('queued')) expect(dropEffect(from, 'queued')).toBe('authorize');
  });

  // blocked 就只是一個 Status（ADR-0003）：它不帶任何額外效果，所以拖進去與
  // 拖進 review 是同一件事。這裡釘的正是「沒有第四種效果」——'needs-reason'
  // 曾經是它的回答，而閘門就開在那個值上。
  it('進 blocked 只是一次搬移', () => {
    for (const from of others('blocked')) expect(dropEffect(from, 'blocked')).toBe('move');
  });

  it('其餘每一種換 Status 都只是一次搬移', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (from === to || to === 'queued') continue;
        expect(dropEffect(from, to)).toBe('move');
      }
    }
  });

  // 授權發生在進去的那一下。從 queued 出來 —— agent 開始動工 —— 不需要再授權一次。
  it('從 queued 出來只是一次搬移', () => {
    expect(dropEffect('queued', 'in_progress')).toBe('move');
    expect(dropEffect('queued', 'todo')).toBe('move');
  });
});

describe('groupByStatus —— 每一欄都要在', () => {
  // 看板拿的是 `project()` 的投影，Status 包在 `shown` 裡 —— 所以用取值函式而不是
  // 要求呼叫端先攤平（攤平就會把 optimistic 與 held 丟掉）。
  const projected = (id: string, status: Status) => ({ id, shown: { status } });
  const statusOf = (p: { shown: { status: Status } }): Status => p.shown.status;

  it('沒有 Issue 的 Status 也有一組空的 —— 否則那一欄會從畫面上消失', () => {
    const groups = groupByStatus([projected('a', 'todo')], statusOf);

    expect([...groups.keys()]).toEqual([...STATUSES]);
    expect(groups.get('review')).toEqual([]);
    expect(groups.get('cancelled')).toEqual([]);
  });

  it('一張 Issue 都沒有時，八欄仍然全部在', () => {
    const groups = groupByStatus([], statusOf);

    expect([...groups.keys()]).toEqual([...STATUSES]);
    expect([...groups.values()].every((v) => v.length === 0)).toBe(true);
  });

  it('每張 Issue 進到它自己那一欄', () => {
    const a = projected('a', 'todo');
    const b = projected('b', 'queued');
    const c = projected('c', 'todo');

    const groups = groupByStatus([a, b, c], statusOf);

    expect(groups.get('todo')).toEqual([a, c]);
    expect(groups.get('queued')).toEqual([b]);
  });

  // 同一個 Status 裡沒有順序（ADR-0003），所以這裡也不得排 —— 前端放第二個
  // 比較器正是 reconcile.ts 記下的那個 bug 的成因。傳進來什麼順序就是什麼順序。
  it('同一欄裡維持傳進來的順序，不另外排', () => {
    const items = ['c', 'a', 'b'].map((id) => projected(id, 'in_progress'));

    const groups = groupByStatus(items, statusOf);

    expect(groups.get('in_progress')?.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
});

/**
 * 播報是這個看板對看不見畫面的人講的全部內容。ADR-0008 選 React 的唯一理由
 * 就是 @dnd-kit 的鍵盤拖曳與播報 —— 所以下面斷言的是**意圖**（有沒有把該講的
 * 那件事講出來），不是逐字的中文。改寫措辭不該讓這些測試變紅，漏講才該。
 */
const TITLE = '把 op-log 摺疊成快照';

/**
 * 一般搬移的那句話，把目的地的 Status 名換成特別的那一個之後長什麼樣。
 *
 * 用它來排除「特別的情形其實只是同一句話換個 Status 名」—— 那正是鍵盤使用者
 * 收不到區別的樣子：畫面上 queued 有它自己的視覺處理，聽的人只有這串字。
 */
const asOrdinaryWordingFor = (ordinary: string, from: Status, to: Status): string =>
  ordinary.replaceAll(from, to);

/**
 * 這則播報有沒有把「授權」那件事講出來。
 *
 * CONTEXT.md 對 queued 的定義是「已授權 agent 不再詢問、直接動手」。收的是那個
 * **概念**而不是某一句話：兩半的詞任一半都算數（現行的實作停留時說「授權」、
 * 放下時說「不再詢問」），措辭改寫不該讓這裡變紅 —— 不再提到 agent 可以自行
 * 動手才該。
 */
const speaksOfAuthorization = (said: string): boolean =>
  /agent/.test(said) && /授權|不再詢問/.test(said);

describe('dragInstructions —— Tab 到一張 Issue 就聽得到的操作說明', () => {
  it('四個鍵都講：抓起、移動、放下、取消', () => {
    expect(dragInstructions).toMatch(/Space/);
    expect(dragInstructions).toMatch(/左右/);
    expect(dragInstructions).toMatch(/Esc/);
  });

  // 看不見畫面的人沒有那八個直排，聽到的是 backlog、queued 這些 Status 值本身。
  // 說「欄位」等於多發明一個他們對不上的東西。
  it('用 Status 講，不講「欄」', () => {
    expect(dragInstructions).toMatch(/Status/);
    expect(dragInstructions).not.toMatch(/欄/);
  });

  // ADR-0003 只定義八個 Status，同一個 Status 裡沒有順序。上下鍵若沉默不語，
  // 使用者會以為自己按壞了；若真的移動，等於發明一個不存在的排序。
  it('明講同一個 Status 裡沒有順序，上下鍵不會移動 Issue', () => {
    expect(dragInstructions).toMatch(/上下/);
    expect(dragInstructions).toMatch(/沒有順序/);
  });
});

describe('announceGrab —— 抓起來的那一下', () => {
  it('念出是哪一張、現在在哪個 Status', () => {
    const said = announceGrab(TITLE, 'todo');

    expect(said).toContain(TITLE);
    expect(said).toContain('todo');
  });

  it('接著告訴使用者能用什麼鍵換 Status', () => {
    expect(announceGrab(TITLE, 'todo')).toMatch(/左右/);
  });
});

describe('停在 Status 之外 —— 放開不會有事', () => {
  it('停在任何 Status 之外時，先說放開不會移動', () => {
    expect(announceOver(TITLE, 'todo', null)).toMatch(/不會移動/);
  });

  it('真的放開在 Status 之外時，說它維持在原本的 Status', () => {
    const said = announceDrop(TITLE, 'review', null);

    expect(said).toContain('review');
    expect(said).toMatch(/維持/);
  });
});

describe('放回原處 —— 沒有變化就不是一次搬移', () => {
  it('停在原本的 Status 上時不講成搬移', () => {
    expect(announceOver(TITLE, 'todo', 'todo')).toContain('todo');
    expect(announceOver(TITLE, 'todo', 'todo')).not.toBe(announceOver(TITLE, 'backlog', 'todo'));
  });

  it('放回原處時說它仍然在原本的 Status', () => {
    const said = announceDrop(TITLE, 'todo', 'todo');

    expect(said).toContain('todo');
    expect(said).toMatch(/仍然/);
    expect(said).not.toBe(announceDrop(TITLE, 'backlog', 'todo'));
  });
});

/**
 * queued 不是第三欄，是人與 agent 之間的**授權邊界**：一張 Issue 進 queued
 * 表示需求已釐清，且已授權 agent 不再詢問、直接動手（CONTEXT.md）。
 *
 * 畫面上它有自己的視覺處理，但鍵盤使用者看不到那個 —— 對他們來說**這串字就是
 * 全部的 affordance**。所以下面釘的是兩件事：它與一般搬移不是同一句話，而且
 * 它講的是授權。措辭本身可以改寫。
 */
describe('進 queued —— 授權邊界要念得出來', () => {
  const ordinaryOver = announceOver(TITLE, 'todo', 'review');
  const queuedOver = announceOver(TITLE, 'todo', 'queued');
  const ordinaryDrop = announceDrop(TITLE, 'todo', 'review');
  const queuedDrop = announceDrop(TITLE, 'todo', 'queued');

  it('停在 queued 上的措辭不是把一般搬移換個 Status 名', () => {
    expect(queuedOver).not.toBe(asOrdinaryWordingFor(ordinaryOver, 'review', 'queued'));
  });

  it('放下到 queued 的措辭不是把一般搬移換個 Status 名', () => {
    expect(queuedDrop).not.toBe(asOrdinaryWordingFor(ordinaryDrop, 'review', 'queued'));
  });

  it('停在 queued 與放下到 queued，兩則都講出授權這件事', () => {
    expect(speaksOfAuthorization(queuedOver)).toBe(true);
    expect(speaksOfAuthorization(queuedDrop)).toBe(true);
  });

  it('一般搬移不提授權 —— 否則那件事就不再有區別', () => {
    expect(speaksOfAuthorization(ordinaryOver)).toBe(false);
    expect(speaksOfAuthorization(ordinaryDrop)).toBe(false);
  });

  it('從任何 Status 進 queued 都講授權，不只從 todo', () => {
    for (const from of STATUSES.filter((s) => s !== 'queued')) {
      expect(speaksOfAuthorization(announceDrop(TITLE, from, 'queued'))).toBe(true);
      expect(speaksOfAuthorization(announceOver(TITLE, from, 'queued'))).toBe(true);
    }
  });
});

/**
 * blocked 只是一個 Status，不帶額外效果（ADR-0003）。看得見的那一面早就沒有
 * 閘門了，這裡釘的是**念出來的那一面也不能還留著它**：多一句只有 blocked 才
 * 聽得到的提示，鍵盤與 screen reader 使用者收到的就是另一個看板 —— 一個仍然
 * 要求他們說明原因、但實際上不會問的看板。
 */
describe('進 blocked —— 就是一次普通搬移', () => {
  const ordinaryOver = announceOver(TITLE, 'todo', 'review');
  const blockedOver = announceOver(TITLE, 'todo', 'blocked');
  const ordinaryDrop = announceDrop(TITLE, 'todo', 'review');
  const blockedDrop = announceDrop(TITLE, 'todo', 'blocked');

  it('停在 blocked 上與放下到 blocked 都不再提原因', () => {
    expect(blockedOver).not.toMatch(/原因/);
    expect(blockedDrop).not.toMatch(/原因/);
  });

  it('措辭就是一般搬移換一個 Status 名 —— 沒有任何 blocked 專屬的字', () => {
    expect(blockedOver).toBe(asOrdinaryWordingFor(ordinaryOver, 'review', 'blocked'));
    expect(blockedDrop).toBe(asOrdinaryWordingFor(ordinaryDrop, 'review', 'blocked'));
  });

  // 'review' 不當來源：那句話裡會出現兩次 'review'（來源與去處），
  // `asOrdinaryWordingFor` 的 replaceAll 會把來源也一起換掉。
  it('從任何 Status 進 blocked 都與進別的 Status 是同一個模子', () => {
    for (const from of STATUSES.filter((s) => s !== 'blocked' && s !== 'review')) {
      const ordinary = announceDrop(TITLE, from, 'review');

      expect(announceDrop(TITLE, from, 'blocked')).toBe(
        asOrdinaryWordingFor(ordinary, 'review', 'blocked'),
      );
    }
  });
});

describe('一般搬移與取消', () => {
  it('放下之後念出從哪裡到哪裡 —— 看不到卡片飛過去的人要知道它去了哪', () => {
    const said = announceDrop(TITLE, 'todo', 'review');

    expect(said).toContain('todo');
    expect(said).toContain('review');
  });

  it('取消之後明說 Issue 還在原處', () => {
    const said = announceCancel(TITLE, 'in_progress');

    expect(said).toContain(TITLE);
    expect(said).toContain('in_progress');
  });
});

describe('播報的通則', () => {
  it('每一則都念得出是哪一張 Issue —— 同時有兩張在動時要分得出來', () => {
    const said = [
      announceGrab(TITLE, 'todo'),
      announceCancel(TITLE, 'todo'),
      announceOver(TITLE, 'todo', null),
      announceDrop(TITLE, 'todo', null),
      ...STATUSES.flatMap((to) => [
        announceOver(TITLE, 'todo', to),
        announceDrop(TITLE, 'todo', to),
      ]),
    ];

    for (const line of said) expect(line).toContain(TITLE);
  });

  // 三種 DropEffect 是三件不同的事，播報必須分得出來 —— 兩種講成同一句，
  // 鍵盤使用者就少了一個區別。
  it('三種放下結果念出三句不同的話', () => {
    const byEffect = [
      announceDrop(TITLE, 'todo', 'todo'), // none
      announceDrop(TITLE, 'todo', 'review'), // move
      announceDrop(TITLE, 'todo', 'queued'), // authorize
    ];

    expect(new Set(byEffect).size).toBe(3);
  });
});

const flying = (...f: OptimisticField[]): ReadonlySet<OptimisticField> => new Set(f);
const NOTHING_FLYING = flying();
const NO_COMMENTS: readonly UnconfirmedComment[] = [];
const comments = (n: number): readonly UnconfirmedComment[] =>
  Array.from({ length: n }, (_, i) => ({ seq: i + 1, body: `第 ${i + 1} 則` }));

describe('pendingParts —— 還沒落地的東西列出來', () => {
  it('全部落地時是空的', () => {
    expect(pendingParts(NOTHING_FLYING, NO_COMMENTS)).toEqual([]);
  });

  /**
   * 這是本組最重要的一條。`optimistic` 是 Set，它的迭代順序是「哪個欄位先被
   * 覆蓋」—— 同樣兩個欄位在飛，先改標題與先搬 Status 會念出不同的句子。
   * 同一個狀態必須念出同一句話，所以順序得是固定的，不能是插入順序。
   */
  it('同樣的欄位，不論誰先被覆蓋，都念出同一句話', () => {
    const titleFirst = pendingParts(flying('title', 'status', 'labels'), NO_COMMENTS);
    const statusFirst = pendingParts(flying('labels', 'status', 'title'), NO_COMMENTS);

    expect(titleFirst).toEqual(statusFirst);
    expect(titleFirst).toHaveLength(3);
  });

  it('五個欄位全部在飛時，五個都念得出來', () => {
    const all = pendingParts(
      flying('archived', 'description', 'labels', 'title', 'status'),
      NO_COMMENTS,
    );

    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
  });

  // Status 是搬移 —— 卡片換了一欄是使用者最先想知道的那一件事。
  it('Status 念在最前面', () => {
    const said = pendingParts(flying('archived', 'description', 'title', 'status'), NO_COMMENTS);

    expect(said[0]).toBe('Status');
  });

  // 留言是附加不是覆蓋，所以它不進 optimistic —— 但使用者要知道的是「這張
  // Issue 上有東西還沒落地」，一則還沒被確認的留言正是那樣的東西。
  it('還沒確認的 Comment 也算一件還沒落地的事', () => {
    const said = pendingParts(NOTHING_FLYING, comments(1));

    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Comment/);
  });

  it('念出還沒確認的 Comment 有幾則', () => {
    expect(pendingParts(NOTHING_FLYING, comments(3))[0]).toMatch(/3/);
  });

  it('Comment 念在欄位後面', () => {
    const said = pendingParts(flying('status', 'title'), comments(2));

    expect(said).toHaveLength(3);
    expect(said[0]).toBe('Status');
    expect(said[2]).toMatch(/Comment/);
  });
});

describe('pendingLabel —— 卡片上看得見的那一行', () => {
  // null 而不是空字串：空字串會在卡片上留下一條看不出原因的空行。
  it('沒有東西在飛時不顯示', () => {
    expect(pendingLabel(NOTHING_FLYING, NO_COMMENTS)).toBeNull();
  });

  it('把每一件還沒落地的事都列出來', () => {
    const parts = pendingParts(flying('status', 'labels'), comments(1));
    const label = pendingLabel(flying('status', 'labels'), comments(1));

    expect(label).not.toBeNull();
    for (const part of parts) expect(label).toContain(part);
  });

  it('只有一則沒確認的留言時也顯示', () => {
    expect(pendingLabel(NOTHING_FLYING, comments(1))).not.toBeNull();
  });
});

/**
 * 掛在卡片上的敘述，Tab 過去就連著標題一起聽到 —— 不是拖曳過程中的即時播報。
 * 虛線邊框與 ring 對看不見畫面的人不存在，而「這張還沒落地」正是拖完之後最
 * 需要知道的一件事。
 */
describe('announceIssueState —— held × pending 四種組合', () => {
  it('沒有變更也沒被抓著時，什麼都不多念', () => {
    expect(announceIssueState(NOTHING_FLYING, NO_COMMENTS, false)).toBeNull();
  });

  it('有變更、沒被抓著：只講變更', () => {
    const said = announceIssueState(flying('status'), NO_COMMENTS, false);

    expect(said).toContain('Status');
    expect(said).not.toMatch(/抓/);
  });

  // 「畫面停著不動」對指標使用者是自己按著造成的，對鍵盤使用者則是一個
  // 看不出原因的靜止 —— 所以被抓著這件事必須講出來（reconcile.ts 的 GRAB）。
  it('沒有變更、被抓著：講出伺服器的更新為什麼沒套用', () => {
    const said = announceIssueState(NOTHING_FLYING, NO_COMMENTS, true);

    expect(said).not.toBeNull();
    expect(said).toMatch(/抓/);
    expect(said).toMatch(/不會|沒有/);
  });

  it('又有變更又被抓著：兩件事都講', () => {
    const said = announceIssueState(flying('title'), comments(1), true);

    expect(said).toContain('標題');
    expect(said).toMatch(/Comment/);
    expect(said).toMatch(/抓/);
  });

  it('與卡片上那一行講的是同一件事 —— 兩邊各列一次遲早會分岔', () => {
    for (const fields of [flying('status'), flying('title', 'labels'), flying('archived')]) {
      for (const unconfirmed of [NO_COMMENTS, comments(2)]) {
        const said = announceIssueState(fields, unconfirmed, false);

        for (const part of pendingParts(fields, unconfirmed)) {
          expect(pendingLabel(fields, unconfirmed)).toContain(part);
          expect(said).toContain(part);
        }
      }
    }
  });
});
