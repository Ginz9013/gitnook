import { describe, it, expect } from 'vitest';
import { STATUSES } from '../../src/core/types.js';
import type { Status } from '../../src/core/types.js';
import { STATUS_ORDER, isStatus, groupByStatus } from '../../src/studio/statuses.js';
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
// 可判定的規則被推進 `statuses.ts` 與 `board/announce.ts` 正是為了讓它們
// 測得到 —— 邏輯放對了位置，這個檔案是把網子張開。
//
// `board/lanes.ts` 消失了（ADR-0010）：`isStatus` 與 `groupByStatus` 與車道無關，
// 搬去 `@/statuses` —— 那裡已經有 `STATUS_ORDER`，而 drawer 也要用同一份。

describe('STATUS_ORDER —— 與 core 的 STATUSES 同一份順序', () => {
  // `statuses.ts` 的 `_members` / `_ordered` 是編譯期守衛。這是執行期的第二道：
  // 它在 `npx vitest run` 就會響，不必等到有人跑 `tsc`。
  it('八個 Status 的內容與順序都與 core 一致', () => {
    expect([...STATUS_ORDER]).toEqual([...STATUSES]);
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

  // Object.prototype 上的名字必須擋掉 —— 否則 `?to=toString` 這種 query 就變成
  // 一個合法的 Status。（判斷曾經是查一張以 Status 為鍵的表，靠 hasOwnProperty
  // 擋；現在比對 STATUS_ORDER，這一條釘的是換了作法之後性質沒有掉。）
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

describe('dragInstructions —— Tab 到一張 Issue 就聽得到的操作說明', () => {
  it('四個鍵都講：抓起、移動、放下、取消', () => {
    expect(dragInstructions).toMatch(/Space/);
    expect(dragInstructions).toMatch(/left\/right/);
    expect(dragInstructions).toMatch(/Esc/);
  });

  // 看不見畫面的人沒有那八個直排，聽到的是 backlog、queued 這些 Status 值本身。
  // 說「欄位」等於多發明一個他們對不上的東西。
  it('用 Status 講，不講「欄」', () => {
    expect(dragInstructions).toMatch(/Status/);
    expect(dragInstructions).not.toMatch(/column|lane/i);
  });

  // ADR-0003 只定義八個 Status，同一個 Status 裡沒有順序。上下鍵若沉默不語，
  // 使用者會以為自己按壞了；若真的移動，等於發明一個不存在的排序。
  it('明講同一個 Status 裡沒有順序，上下鍵不會移動 Issue', () => {
    expect(dragInstructions).toMatch(/up\/down/);
    expect(dragInstructions).toMatch(/no order/i);
  });
});

describe('announceGrab —— 抓起來的那一下', () => {
  it('念出是哪一張、現在在哪個 Status', () => {
    const said = announceGrab(TITLE, 'todo');

    expect(said).toContain(TITLE);
    expect(said).toContain('todo');
  });

  it('接著告訴使用者能用什麼鍵換 Status', () => {
    expect(announceGrab(TITLE, 'todo')).toMatch(/left\/right/);
  });
});

describe('停在 Status 之外 —— 放開不會有事', () => {
  it('停在任何 Status 之外時，先說放開不會移動', () => {
    expect(announceOver(TITLE, 'todo', null)).toMatch(/will not move/);
  });

  it('真的放開在 Status 之外時，說它維持在原本的 Status', () => {
    const said = announceDrop(TITLE, 'review', null);

    expect(said).toContain('review');
    expect(said).toMatch(/stays/);
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
    expect(said).toMatch(/still/);
    expect(said).not.toBe(announceDrop(TITLE, 'backlog', 'todo'));
  });
});

/**
 * **看板不替任何 Status 預設解讀（ADR-0010）的可執行版本。**
 *
 * ADR-0010 說「這是減法，因此沒有辦法用測試釘住」—— 對畫面那一面是的，但對
 * 播報這一面不是：一個 Status 有沒有被偷偷加上解讀，會在它的措辭上露出來。
 * 所以這裡釘的是**同一個模板**：換欄的那句話從頭到尾只有 Status 名不同，
 * 任何一個 Status 都不准有專屬的字。曾經 queued 有（授權閘門的兩句），
 * 而下一個想替某一格加解讀的人會先撞上這一組。
 *
 * `from === to` 不在範圍內：放回原處是一次**沒有變化的拖曳**，不是某個 Status
 * 的特別待遇，它由上面「放回原處」那一組管。
 */
describe('看板不替任何 Status 預設解讀 —— 措辭是同一個模板', () => {
  // 'review' 當基準的 Status 名。來源固定 'todo'：它與被檢查的 Status 都不會
  // 與 'review' 撞名，`asOrdinaryWordingFor` 的 replaceAll 才不會換錯地方。
  it('停在任何一個 Status 上，都是同一個模板換一個 Status 名', () => {
    const ordinary = announceOver(TITLE, 'todo', 'review');

    for (const to of STATUSES.filter((s) => s !== 'todo')) {
      expect(announceOver(TITLE, 'todo', to)).toBe(asOrdinaryWordingFor(ordinary, 'review', to));
    }
  });

  // 'review' 不當來源：那句話裡會出現兩次 'review'（來源與去處），
  // replaceAll 會把來源也一起換掉。
  it('從任何 Status 放下到任何 Status，也都是同一個模板', () => {
    for (const from of STATUSES.filter((s) => s !== 'review')) {
      const ordinary = announceDrop(TITLE, from, 'review');

      for (const to of STATUSES.filter((s) => s !== from)) {
        expect(announceDrop(TITLE, from, to)).toBe(asOrdinaryWordingFor(ordinary, 'review', to));
      }
    }
  });

  // 點名 queued：它是被拆掉的那一個，也是最可能被加回去的那一個。上面兩條已經
  // 涵蓋它，這一條是為了讓「queued 在看板上沒有任何特別待遇」講得出名字來。
  it('queued 也一樣 —— 它在播報上與其他七個沒有任何區別', () => {
    expect(announceOver(TITLE, 'todo', 'queued')).toBe(
      asOrdinaryWordingFor(announceOver(TITLE, 'todo', 'review'), 'review', 'queued'),
    );
    expect(announceDrop(TITLE, 'todo', 'queued')).toBe(
      asOrdinaryWordingFor(announceDrop(TITLE, 'todo', 'review'), 'review', 'queued'),
    );
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
    expect(blockedOver).not.toMatch(/reason/i);
    expect(blockedDrop).not.toMatch(/reason/i);
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

  // 放下只有兩種結果：換了欄，或沒換。播報必須分得出來 —— 兩種講成同一句，
  // 鍵盤使用者就少了一個區別。（第三種 'authorize' 拆掉了，見 ADR-0010。）
  it('兩種放下結果念出兩句不同的話', () => {
    const byEffect = [
      announceDrop(TITLE, 'todo', 'todo'), // 沒換欄
      announceDrop(TITLE, 'todo', 'review'), // 換了欄
    ];

    expect(new Set(byEffect).size).toBe(2);
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
    expect(said).not.toMatch(/held|grab/i);
  });

  // 「畫面停著不動」對指標使用者是自己按著造成的，對鍵盤使用者則是一個
  // 看不出原因的靜止 —— 所以被抓著這件事必須講出來（reconcile.ts 的 GRAB）。
  it('沒有變更、被抓著：講出伺服器的更新為什麼沒套用', () => {
    const said = announceIssueState(NOTHING_FLYING, NO_COMMENTS, true);

    expect(said).not.toBeNull();
    expect(said).toMatch(/held/i);
    expect(said).toMatch(/will not/i);
  });

  it('又有變更又被抓著：兩件事都講', () => {
    const said = announceIssueState(flying('title'), comments(1), true);

    expect(said).toContain('title');
    expect(said).toMatch(/Comment/);
    expect(said).toMatch(/held/i);
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
