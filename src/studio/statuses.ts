// `Status` 從 `@/api` 拿 —— studio 對 server／core 的型別一律走那一面。
import type { Status } from '@/api';
// **型別位置的 import，打包時整條被抹掉**，所以這不是值的 import，core 不會
// 因為它進到 studio 的 bundle（ADR-0008），Vite 也不必去解析這個 `.js`。
// 不從 `@/api` 拿：那裡只轉出 `Status` 這個聯集，而聯集沒有順序，下面的
// `_ordered` 需要的是 `STATUSES` 那個 tuple 本身的型別。
import type { STATUSES as CoreStatuses } from '../core/types.js';

/**
 * 八個 Status 的固定順序（ADR-0003）。**`src/studio/` 底下只有這一份。**
 *
 * 之前 `board/lanes.ts` 的 `ORDER` 與 `drawer/changes.ts` 的 `STATUS_INDEX`
 * 是兩份各自手抄的清單。兩份各有自己的完整性守衛，所以「數量」不會漂，但
 * 「順序」沒有任何東西守著 —— 兩邊排出不同的順序仍然編得過，而看板與 drawer
 * 的選單從此以不同的順序列出同八個 Status。
 *
 * 檔案放在 `src/studio/` 而不是 `board/`：看板與 drawer 都 import 它，而
 * `board/` 底下的東西是看板的財產。八個 Status 是 studio 共有的詞彙，
 * drawer 不該為了那八個字串去 import 看板的目錄。
 *
 * 這裡刻意抄一份而不是 `import { STATUSES } from '../core/types.js'`：
 * 那會是第一個從 core 進 studio bundle 的**值** import，而且 Vite 不會把這個
 * repo 的 `.js` specifier 重新對應到 `.ts`，build 當場就壞（ADR-0008）。
 * 抄寫的代價由下面兩道編譯期守衛補起來。
 */
export const STATUS_ORDER = [
  'backlog',
  'todo',
  'queued',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled',
] as const;

type Missing = Exclude<Status, (typeof STATUS_ORDER)[number]>;
type Extra = Exclude<(typeof STATUS_ORDER)[number], Status>;
/** 成員必須恰好是八個 Status。少一個或多一個時這一行編不過。 */
const _members: [Missing | Extra] extends [never] ? true : ['成員與 Status 不一致'] = true;
void _members;

/** 兩個 tuple 互相可指派，等於長度、成員與**位置**都相同。 */
type SameSequence<A extends readonly unknown[], B extends readonly unknown[]> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/**
 * 順序也必須與 core 的 `STATUSES` 一致 —— 上面的成員守衛看不出交換兩個位置，
 * 而順序就是使用者在看板上從左到右看到的東西。調換任何兩個時這一行編不過。
 */
const _ordered: SameSequence<typeof STATUS_ORDER, typeof CoreStatuses> extends true
  ? true
  : ['順序與 core 的 STATUSES 不一致'] = true;
void _ordered;

/**
 * 這個字串是不是那八個 Status 之一。**不猜**：前綴（`in_p`）與大小寫（`TODO`）
 * 都不算 —— `resolveStatus` 收無歧義前綴是 CLI 給人打字的便利，而看板收到的是
 * 拖放目標的 id，那本來就是完整值。
 *
 * 用 `STATUS_ORDER` 逐一比對，而不是查一張以 Status 為鍵的表：查表得記得加
 * `hasOwnProperty` 守衛，否則 `toString`、`__proto__` 這些 `Object.prototype`
 * 上的名字會變成合法的 Status。陣列從頭到尾只認它自己裝的那八個字串，那道
 * 守衛因此不必存在 —— 少一個「忘了就靜靜壞掉」的地方。
 *
 * `typeof` 那一半也不是多的：它擋掉 `new String('todo')` 這種包裝物件，
 * 而型別述詞（`value is Status`）本來就得先確定它是字串。
 */
export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUS_ORDER as readonly string[]).includes(value);
}

/**
 * 每個 Status 各自的 Issue。沒有 Issue 的 Status 也要在 map 裡，否則它會從畫面上消失。
 *
 * Status 用 `statusOf` 取而不是直接讀 `item.status`：看板拿的是 `project()` 的
 * 投影，而投影把 Issue 包了一層（Status 在 `shown` 裡）。用取值函式而不是要求
 * 呼叫端先攤平成 `IssueView[]`——攤平就是把 `optimistic` 與 `held` 丟掉，那正是
 * 這一版要停止做的事。
 */
export function groupByStatus<T>(
  items: readonly T[],
  statusOf: (item: T) => Status,
): ReadonlyMap<Status, readonly T[]> {
  const groups = new Map<Status, T[]>(STATUS_ORDER.map((s) => [s, []]));
  for (const item of items) groups.get(statusOf(item))?.push(item);
  return groups;
}
