import { describe, it, expect } from 'vitest';
import { renderTable } from '../../src/render/table.js';
import { renderJson } from '../../src/render/json.js';
import { SHORT_ID_MIN, shortIdLength } from '../../src/core/ids.js';
import type { Comment, Issue, Status } from '../../src/core/types.js';

/**
 * spec.md 四個硬指標之一：agent token。
 *
 * 情境（spec.md「token 情境」）：40 張 Issue 的專案 → `list` → `show` 一張 → `mv`
 * → `comment`，量測「skill 文件 + 全部 CLI 輸出」的總 byte 數，上限見 LIMIT。
 * 用 byte 數而非 tokenizer 的理由見 docs/adr/0005。
 *
 * 接縫是 renderTable() 這個純函數 —— 不 spawn nook 子行程。每一段都必須與
 * src/cli/run.ts 實際走的那一條對齊，否則閘門守的是一份沒人會看到的輸出：
 *   list     renderTable(全部 40 張)              cmdList，最保守：不假設任何一張被隱藏
 *   show     renderTable(單張)                    cmdShow，不傳長度（見該處註解）
 *   mv       renderTable([更新後那張], 整批長度)  cmdMv，回印該張的一行
 *   comment  renderTable([更新後那張], 整批長度)  cmdComment，同上
 * 每段輸出各加一個結尾換行，代表 CLI 實際寫到 stdout 的樣子。
 */
/**
 * 4096 是規劃階段憑空訂的，情境則量測了一個現實中不會出現的最有利形狀
 * （每張票不同的 6 碼前綴）。改用真實 ULID 後同一份程式碼量到 4030B ——
 * 程式碼沒有變差，是量測變準了。
 *
 * 4608 = 4.5KB ≈ 1150 tokens，給約 14% 的餘裕，讓它是迴歸偵測器而不是
 * 誤觸的絆線。情境本身維持最壞的真實情況（批次匯入，短 ID 14 碼），
 * 那才是這個閘門的重點。
 */
const LIMIT = 4608;

/** 教 agent 用預設格式而非 `--json` 的說明文件草稿，見 docs/adr/0005。 */
const SKILL_DOC = `# nook

Git-native issue tracker. Issues are plain text files in the repo.

nook list [--all]          one line per issue: <ref> <status> <title> [labels]
nook show <ref>            title line, description, comments
nook new "<title>"         create an issue
nook mv <ref> <status>     backlog todo queued in_progress review blocked done cancelled
nook comment <ref> "<body>"
nook label <ref> +bug -ui
nook set <ref> archived true

<ref> is any unambiguous ID prefix. Status takes prefixes too (que -> queued).
queued means requirements are settled: act without asking.
blocked requires a comment saying why.
list hides archived, done and cancelled unless --all.
--json exists for scripts; the default table is cheaper to read.
`;

const issue = (
  shortId: string,
  status: Status,
  title: string,
  labels: readonly string[],
  extra: { description?: string; comments?: readonly Comment[] } = {},
): Issue => ({
  id: realisticId(shortId),
  title,
  status,
  description: extra.description ?? '',
  labels,
  archived: false,
  comments: extra.comments ?? [],
});

/**
 * 真實形狀的 ULID：前 10 碼是時間高位，**前 6 碼每 17.5 分鐘才變一次**。
 * 批次匯入（從別的 tracker 遷移）會讓 40 張 Issue 落在同一毫秒，shortIdLength
 * 因此被推到 14 碼。閘門必須量測會先壞掉的那個情況，而不是最有利的那個 ——
 * 原本的 fixture 給每張 Issue 一個不同的 6 碼前綴，那是現實中不會出現的形狀。
 */
const SHARED_TIME_PREFIX = '01M20QTC4R';
function realisticId(seed: string): string {
  return (SHARED_TIME_PREFIX + seed.slice(2)).padEnd(26, 'Z').slice(0, 26);
}

/** 40 張 Issue 的專案。標題長度取自真實 issue 的分佈，不是最短的樣本。 */
const board: readonly Issue[] = [
  issue('01JBX7', 'queued', 'Fix login redirect loop on Safari 17', ['bug']),
  issue('01JBX8', 'in_progress', 'Add dark mode to the studio board', ['ui']),
  issue('01JBX9', 'backlog', 'Rename ready to queued everywhere', ['docs']),
  issue('01JBXA', 'todo', 'Detect glued lines after union merge', ['bug', 'p1']),
  issue('01JBXB', 'review', 'Property test for fold commutativity', []),
  issue('01JBXC', 'done', 'Write the merge=union spike findings', ['docs']),
  issue('01JBXD', 'blocked', 'Publish under the @nook scope', ['release']),
  issue('01JBXE', 'queued', 'doctor should repair unparsable lines', ['bug']),
  issue('01JBXF', 'todo', 'Bind studio to 127.0.0.1 only', ['security']),
  issue('01JBXG', 'backlog', 'Poll /hash every two seconds', []),
  issue('01JBXH', 'in_progress', 'Ambiguous ref should list candidates', ['dx']),
  issue('01JBXJ', 'review', 'Lamport clock is per issue file', []),
  issue('01JBXK', 'todo', 'Reject .gitattributes conflict rules', ['bug']),
  issue('01JBXM', 'queued', 'Cold start under 500ms from tarball', ['perf']),
  issue('01JBXN', 'backlog', 'Drop the slug from issue file names', []),
  issue('01JBXP', 'done', 'Add-wins OR-Set for labels', ['crdt']),
  issue('01JBXQ', 'todo', 'Ignore unknown op types on read', ['crdt']),
  issue('01JBXR', 'review', 'Trailing newline on every append', ['bug']),
  issue('01JBXS', 'blocked', 'Decide the v2 history restore API', ['design']),
  issue('01JBXT', 'queued', 'Markdown render must drop raw HTML', ['security']),
  issue('01JBXV', 'backlog', 'Bench 10000 issues fold time', ['perf']),
  issue('01JBXW', 'todo', 'Actor id from git config user.email', []),
  issue('01JBXX', 'in_progress', 'Eight column board in the studio', ['ui']),
  issue('01JBXY', 'review', 'Warn when merge driver is missing', ['dx']),
  issue('01JBXZ', 'todo', 'Package must stay under 3MB', ['perf']),
  issue('01JBY0', 'queued', 'Status prefix resolution', ['dx']),
  issue('01JBY1', 'backlog', 'Document the four hard metrics', ['docs']),
  issue('01JBY2', 'done', 'Set up vitest and tsconfig', []),
  issue('01JBY3', 'todo', 'Rebase path must stay conflict free', ['crdt']),
  issue('01JBY4', 'review', 'Dedupe ops by id keeps the first', ['crdt']),
  issue('01JBY5', 'blocked', 'Name dispute with the nook package', ['release']),
  issue('01JBY6', 'queued', 'Hide archived issues by default', []),
  issue('01JBY7', 'backlog', 'Show HN launch checklist', ['docs']),
  issue('01JBY8', 'todo', 'Exit codes for every CLI command', ['dx']),
  issue('01JBY9', 'in_progress', 'Detail view for a single issue', ['ui']),
  issue('01JBYA', 'review', 'Refuse to delete issue files', []),
  issue('01JBYB', 'todo', 'Snapshot op needs supersedes', ['crdt']),
  issue('01JBYC', 'queued', 'README rejects project management', ['docs']),
  issue('01JBYD', 'backlog', 'Import from GitHub issues', ['later']),
  issue('01JBYE', 'done', 'Choose NDJSON over markdown', ['design']),
];

const shown = issue('01JBXA', 'todo', 'Detect glued lines after union merge', ['bug', 'p1'], {
  description:
    'Union merge glues two lines together when the previous write had no trailing newline.\nThe reducer must detect the glued line and doctor must repair it.',
  comments: [
    { id: '01JBXC5R10000000000000000', actor: 'k3f9', t: 3, body: 'Reproduced with git 2.50.1' },
    { id: '01JBXD7T40000000000000000', actor: 'm8q2', t: 5, body: 'Splitting on }{ is enough' },
  ],
});
const moved: Issue = { ...shown, status: 'in_progress' };
const commented: Issue = {
  ...moved,
  comments: [
    ...moved.comments,
    { id: '01JBXE9V60000000000000000', actor: 'k3f9', t: 7, body: 'Patch is up for review' },
  ],
};

/**
 * 顯示用短 ID 的長度，對**整個 Board** 算 —— CLI 的 cmdMv / cmdComment 走的就是
 * 這條（`displayLength(board)`）。回印那一行手上只有一張 Issue，長度卻是整批的
 * 性質，所以必須由呼叫端算好傳進去。
 */
const DISPLAY_LEN = shortIdLength(board.map((i) => i.id));

const parts = (): ReadonlyArray<readonly [string, string]> => [
  ['skill doc', SKILL_DOC],
  ['list', renderTable(board) + '\n'],
  // show 不傳長度：CLI 的 cmdShow 只讀被點名的那一個 op-log（票 13），拿不到整塊
  // Board，因此詳情實際印的就是 SHORT_ID_MIN 碼。這裡照著量，不高估也不低估。
  ['show', renderTable(shown, DISPLAY_LEN) + '\n'],
  ['mv', renderTable([moved], DISPLAY_LEN) + '\n'],
  ['comment', renderTable([commented], DISPLAY_LEN) + '\n'],
];

/** 逐項 byte 數 + 總計 + 餘裕。超標時要一眼看得出是哪一部分膨脹。 */
const budgetReport = (
  measured: ReadonlyArray<readonly [string, number]>,
  total: number,
): string =>
  [
    `40 票情境總計 ${total}B / 上限 ${LIMIT}B，餘裕 ${LIMIT - total}B`,
    ...measured.map(([name, bytes]) => `  ${name}: ${bytes}B`),
  ].join('\n');

describe('agent token 預算閘門（40 票情境）', () => {
  it('skill 文件用 <ref>，與 CLI 的 --help 一致', () => {
    // CONTEXT.md 的 Ref 把 `id` 明列為 _Avoid_，而 CLI 的 --help 用的就是 <ref>。
    // 教給 agent 的詞彙若寫 <id>，是同時違反詞彙表、又與它實際要打的指令不一致。
    expect(SKILL_DOC).not.toContain('<id>');
    expect(SKILL_DOC).toContain('<ref>');
  });

  it('mv 與 comment 兩段量的是與 list 同一批 Issue 的真實短 ID 長度', () => {
    const measured = new Map(parts());
    const refOf = (text: string): string => text.split('\n')[0]!.split('  ')[0]!;
    const listRef = refOf(measured.get('list')!);

    // 回印一行的 CLI 路徑（cmdMv / cmdComment）手上只有一個單元素陣列，靠渲染層
    // 自己算永遠得到下限 6。用 6 碼計量，閘門守的就是一個 CLI 不會產生的、偏小的
    // 輸出 —— 而閘門的用途正是抓「輸出變大」。
    expect(listRef.length).toBeGreaterThan(SHORT_ID_MIN);
    expect(refOf(measured.get('mv')!)).toHaveLength(listRef.length);
    expect(refOf(measured.get('comment')!)).toHaveLength(listRef.length);
  });

  it('報告逐項 byte 數、總計與餘裕，讓超標時看得出是哪一部分膨脹', () => {
    const report = budgetReport(
      [
        ['skill doc', 700],
        ['list', 3000],
      ],
      3700,
    );

    expect(report).toBe(
      '40 票情境總計 3700B / 上限 4608B，餘裕 908B\n  skill doc: 700B\n  list: 3000B',
    );
  });

  it('skill 文件與全部輸出的總 byte 數低於 4KB', () => {
    const measured = parts().map(([name, text]) => [name, Buffer.byteLength(text, 'utf8')] as const);
    const total = measured.reduce((sum, [, bytes]) => sum + bytes, 0);
    const report = budgetReport(measured, total);

    // 上限綁定「40 張 Issue」這個前提（spec.md）；縮小情境不算過關。
    expect(board).toHaveLength(40);
    // 餘裕會隨時間縮水，所以每次執行都印出來，不必等到失敗才看得到。
    console.log(report);
    expect(total, report).toBeLessThan(LIMIT);
  });

  // Characterization：pin 住 ADR-0005 選擇緊湊表格而非 JSON 的量測依據，首次執行即為綠。
  it('同一份清單改用 --json 會直接爆掉整個預算', () => {
    const table = Buffer.byteLength(renderTable(board), 'utf8');
    const json = Buffer.byteLength(renderJson(board), 'utf8');

    expect(json).toBeGreaterThan(LIMIT);
    // ADR-0005：「同樣的資訊，緊湊表格是 JSON 的一半」。
    expect(json).toBeGreaterThan(table * 2);
  });
});
