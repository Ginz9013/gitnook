import type { Status } from '@/api';

import { dropEffect } from './lanes';

/**
 * 拖曳過程中念給 screen reader 聽的字。純函式 —— 它們是這個看板對看不見畫面
 * 的人講的全部內容。
 *
 * ADR-0008 選 React 的唯一理由是 `@dnd-kit` 的鍵盤拖曳與播報，所以這裡的字不是
 * 裝飾：**看得見的那一套區別（`queued` 的授權邊界、`blocked` 要說明原因）
 * 必須在這裡同樣講出來**，否則鍵盤與 screen reader 使用者收到的是另一個看板。
 */

/**
 * 一張 Issue 取得焦點時念的說明（`aria-describedby`，由 @dnd-kit 掛上）。
 *
 * 用字講 Status 而不是「欄位」：看不見畫面的人沒有那八個直排，聽到的是
 * `backlog`、`queued` 這些 Status 值本身，說「欄位」等於多發明一個他們對不上
 * 的東西。上下鍵不做事，而且這裡明講：Nook 的同一個 Status 裡沒有順序
 * （ADR-0003 只定義八個 Status），讓 Issue 上下動會讓人以為自己改變了什麼。
 */
export const dragInstructions =
  '按 Space 抓起這張 Issue，用左右方向鍵在 Status 之間移動，再按一次 Space 放下，Esc 取消。' +
  '按 Enter 開啟細節。同一個 Status 裡沒有順序，上下鍵不會移動 Issue。';

export function announceGrab(title: string, from: Status): string {
  return `抓起「${title}」，目前在 ${from}。用左右方向鍵換 Status。`;
}

export function announceOver(title: string, from: Status, to: Status | null): string {
  if (to === null) return `「${title}」不在任何 Status 上，放開不會移動。`;
  switch (dropEffect(from, to)) {
    case 'none':
      return `「${title}」回到原本的 ${to}。`;
    case 'authorize':
      return `「${title}」停在 queued。queued 是人與 agent 的交接閘門：放下代表需求已釐清，授權 agent 不再詢問、直接動手。`;
    case 'needs-reason':
      return `「${title}」停在 blocked。放下之後會先要求你說明卡住的原因。`;
    case 'move':
      return `「${title}」停在 ${to}。`;
  }
}

export function announceDrop(title: string, from: Status, to: Status | null): string {
  if (to === null) return `放開「${title}」，沒有放進任何 Status，維持在 ${from}。`;
  switch (dropEffect(from, to)) {
    case 'none':
      return `放回原處，「${title}」仍然在 ${from}。`;
    case 'authorize':
      return `已把「${title}」從 ${from} 移到 queued，agent 現在可以不再詢問、直接動手。`;
    case 'needs-reason':
      return `「${title}」要移到 blocked，請先說明卡住的原因。`;
    case 'move':
      return `已把「${title}」從 ${from} 移到 ${to}。`;
  }
}

export function announceCancel(title: string, from: Status): string {
  return `取消拖曳，「${title}」仍然在 ${from}。`;
}
