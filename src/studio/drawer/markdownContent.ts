/**
 * `IssueDetail.tsx` 的 description 與 `CommentTimeline.tsx` 的留言 body
 * 共用同一組 class —— 兩處各寫一份字串曾經是這次要修的 bug 的一部分
 * （其中一份的樣式假設從未真正生效），抽成常數讓它們不會再各自漂移。
 *
 * `prose`（基底：顏色、清單、引言、code 區塊的結構樣式，見 `index.css` 對
 * `--tw-prose-*` 的綁定）與 `prose-sm`（字級／間距的縮放）兩個 class 缺一
 * 不可 —— 只有 `prose-sm` 沒有 `prose` 不會產生任何清單符號或引言邊框，
 * 這正是原本壞掉的樣子。`max-w-none` 蓋掉 `prose` 預設的 65ch 版寬限制，
 * 讓內容跟著 drawer 的寬度走，不是額外加的效果。
 */
export const MARKDOWN_CONTENT_CLASS = 'prose prose-sm max-w-none wrap-break-word';
