import type { IssueView } from '@/api';
import type { DrawerChange } from './pending';

/**
 * Drawer 的寫入面 —— `POST /i/<ref>`（票 03）。
 *
 * body 是一份 `Change`，回應是套用後的整張 `IssueView`。端點直接鏡射
 * `board.apply(ref, change)`，所以這裡不發明任何新詞彙，也不做「部分更新」
 * 之外的任何包裝。
 *
 * **只送 `Change` 定義的鍵。** 票 03 對不認得的欄位回 400 而不是忽略：
 * append-only 之下沒有「被拒絕的寫入」可以事後翻查，一個打錯的欄位名若被
 * 靜靜吃掉，呼叫端看到的是 200 加上一張沒有變化的 Issue。`DrawerChange`
 * 的型別已經把這件事釘住。
 */
export async function postChange(ref: string, change: DrawerChange): Promise<IssueView> {
  // ref 是 server 給的 ULID（只有 [0-9A-Z]），編碼對它是恆等變換；寫出來是
  // 為了讓「路徑片段就是路徑片段」這件事不必靠 id 的字元集來成立。
  const url = `/i/${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!res.ok) throw new Error(`${url} 回了 ${res.status}：${await res.text()}`);
  return (await res.json()) as IssueView;
}
