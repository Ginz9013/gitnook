import { STATUS_ORDER } from '@/statuses';

/**
 * 第一份快照還沒到的那一刻。
 *
 * 在這之前這裡是一行「載入中…」，然後整塊看板一次長出來 —— 在 loopback 上
 * 那是一次閃爍：文字、八欄、卡片全部重排。骨架把**已經知道的東西先畫出來**
 * （八欄、欄名、卡片的位置），資料到達時只有卡片的內容換掉，版面不動。
 *
 * 八個欄名不是佔位圖案而是真的欄名：`STATUS_ORDER` 是固定的八個 Status
 * （ADR-0003），不必等伺服器就說得出來。畫成灰條反而是把已知的事情藏起來。
 *
 * **這裡沒有自動化測試**（spec.md：React 組件不寫測試）。它是一份沒有任何判斷
 * 的版面 —— 沒有 props、沒有 state、沒有分支。
 *
 * 版面刻意鏡射 `Board.tsx` 與 `Column.tsx` 的外框（`h-dvh`／`gap-3 p-4`、
 * `w-64` 的欄、`rounded-lg border`），因為**不跳版就是它存在的唯一理由**；
 * 兩邊哪天分岔了，症狀就是資料到達時畫面跳一下，也就是這個檔案要修的那件事。
 */
export function BoardSkeleton(): React.JSX.Element {
  return (
    <main
      className="flex h-dvh flex-col gap-3 p-4"
      // 「還在載入」對讀螢幕的人要說得出來 —— 原本那一行「載入中…」是他們
      // 唯一的線索，換成骨架之後不能只剩下一堆沒有名字的灰塊。
      aria-busy="true"
      aria-label="Nook 看板（載入中）"
    >
      {/* header 的位置先佔著：logo 方塊 + 兩行字。真的 header 到達時它就在這。 */}
      <div aria-hidden className="flex shrink-0 items-center gap-3">
        <div className="bg-muted size-10.5 shrink-0 animate-pulse rounded-md" />
        {/*
          16 + 6 + 14 = 36px，剛好是真 header 那兩行字（`Git Nook` 與底下那條
          mono 小字）的高度。**這三個數字就是這個檔案的重點** —— 差 8px，資料
          到達時整條看板就往下跳 8px，而那正是骨架要消掉的東西。

          左邊那個方塊放大成 42px（`size-10.5`）之後，**這一列的高度改由它
          決定**，不再是這 36px。兩邊的方塊因此必須一起改：這裡小一號，跳的
          就換成 6px。
        */}
        <div className="flex flex-col gap-1.5">
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          <div className="bg-muted h-3.5 w-56 animate-pulse rounded" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-2">
        {STATUS_ORDER.map((status) => (
          <section
            key={status}
            aria-hidden
            className="bg-muted/40 flex w-64 shrink-0 flex-col rounded-lg border"
          >
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <h2 className="text-muted-foreground font-mono text-xs font-medium">{status}</h2>
            </header>
            <ul className="flex min-h-16 flex-1 flex-col gap-2 p-2">
              {/* 兩張。**每欄一樣多** —— 骨架不知道哪一欄比較滿，
                  假裝知道只會在資料到達時多跳一次。 */}
              {[0, 1].map((i) => (
                <li key={i} className="bg-card animate-pulse rounded-md border p-2 shadow-xs">
                  <div className="bg-muted h-2.5 w-16 rounded" />
                  <div className="bg-muted mt-2 h-3 w-full rounded" />
                  <div className="bg-muted mt-1.5 h-3 w-2/3 rounded" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
