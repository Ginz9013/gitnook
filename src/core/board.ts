import { existsSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Board, CreateInput, Change, Filter, Issue, Diagnostic, OpenBoardOptions, IdSource } from './types.js';
import { BoardNotInitialized, resolveStatus } from './types.js';
import { serialize, parseLine, nextLamport, type Op, type SetKey } from './ops.js';
import { reduce } from './reduce.js';
import { systemIds, resolvePrefix } from './ids.js';
import { deriveActor } from './actor.js';
import { diagnose } from './health.js';

/** 預設檢視隱藏的工作結果。archived 另外處理 —— 它是可見性，兩者正交（ADR-0003）。 */
const HIDDEN_BY_DEFAULT: ReadonlySet<string> = new Set(['done', 'cancelled']);

/** 一張 Issue 一個檔，檔名是純 ULID —— 改標題不該造成 rename，rename 會讓 merge=union 失效。 */
const LOG_SUFFIX = '.ndjson';

export function openBoard(opts: OpenBoardOptions = {}): Board {
  const dir = opts.dir ?? process.cwd();
  const issuesDir = join(dir, '.issues', 'issues');
  const ids: IdSource = opts.ids ?? systemIds;
  let actor: string | undefined = opts.actor;

  const actorId = (): string => (actor ??= deriveActor(dir));

  const requireInitialized = (): void => {
    if (!existsSync(issuesDir)) throw new BoardNotInitialized(dir);
  };

  const pathOf = (id: string): string => join(issuesDir, `${id}${LOG_SUFFIX}`);

  /** 掃描出全部 Issue 的識別碼。ADR-0002：沒有索引，這就是唯一的來源。 */
  const logIds = (): string[] =>
    readdirSync(issuesDir)
      // 資料活在 repo 裡，旁邊出現 .DS_Store 或 README 是常態 —— 忽略而非崩潰。
      .filter((f) => f.endsWith(LOG_SUFFIX))
      .map((f) => f.slice(0, -LOG_SUFFIX.length))
      .sort();

  /** 完整識別碼走檔案系統直達；其餘交給前綴解析。 */
  const resolve = (ref: string): string =>
    existsSync(pathOf(ref)) ? ref : resolvePrefix(ref, logIds());

  const readOps = (file: string): Op[] => {
    const out: Op[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line === '') continue;
      const op = parseLine(line);
      if (op !== null) out.push(op);
    }
    return out;
  };

  return {
    create(input: CreateInput): Issue {
      requireInitialized();
      // 驗證先於任何寫入：被拒絕的輸入不得留下一個半成品的檔案。
      const status = input.status === undefined ? undefined : resolveStatus(input.status);

      const id = ids.ulid();
      // 新檔沒有既有 Op，lamport 從 max(t)+1 = 1 起算。
      let t = 1;
      const ops: Op[] = [{ id: ids.ulid(), t: t++, a: actorId(), op: 'create', title: input.title }];

      if (status !== undefined) {
        ops.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'set', k: 'status', v: status });
      }
      if (input.description !== undefined) {
        ops.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'set', k: 'description', v: input.description });
      }
      for (const v of input.labels ?? []) {
        ops.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'label.add', v });
      }

      appendFileSync(pathOf(id), ops.map(serialize).join(''), 'utf8');
      return reduce(id, ops);
    },
    get(ref: string): Issue {
      requireInitialized();
      const id = resolve(ref);
      return reduce(id, readOps(pathOf(id)));
    },
    list(filter: Filter = {}): Issue[] {
      requireInitialized();
      // 過濾條件先驗證再掃描：不合法的 status 不該讓呼叫端等完一次全量掃描才報錯。
      // 沿用票 02 的 resolveStatus —— 前綴解析只有一份。
      const status = filter.status === undefined ? undefined : resolveStatus(filter.status);

      // ADR-0002：沒有索引也沒有快取，list() 就是全量掃描 + 摺疊。
      const issues = logIds().map((id) => reduce(id, readOps(pathOf(id))));

      // 點名了 done 卻回傳空清單是沒有意義的答案，所以明確指定 status 時
      // 就不再套用 done/cancelled 的預設隱藏。archived 是另一個維度，只有 all 能打開。
      const isVisible = (i: Issue): boolean =>
        filter.all === true ||
        (!i.archived && (status !== undefined || !HIDDEN_BY_DEFAULT.has(i.status)));

      // 多個 label 是收斂條件（AND）：過濾應該越加越窄。
      const labels = filter.labels ?? [];
      const hasLabels = (i: Issue): boolean => labels.every((l) => i.labels.includes(l));

      const matches = (i: Issue): boolean =>
        isVisible(i) && hasLabels(i) && (status === undefined || i.status === status);

      return issues.filter(matches);
    },
    apply(ref: string, change: Change): Issue {
      requireInitialized();
      const id = resolve(ref);
      const file = pathOf(id);

      const existing = readOps(file);
      let t = nextLamport(existing);
      const fresh: Op[] = [];

      // 驗證先於任何寫入：被拒絕的 Change 不得留下半個 Op。
      const status = change.status === undefined ? undefined : resolveStatus(change.status);

      const fields: [SetKey, string | boolean][] = [];
      if (change.title !== undefined) fields.push(['title', change.title]);
      if (status !== undefined) fields.push(['status', status]);
      if (change.description !== undefined) fields.push(['description', change.description]);
      if (change.archived !== undefined) fields.push(['archived', change.archived]);

      for (const [k, v] of fields) {
        fresh.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'set', k, v });
      }

      for (const v of change.labels?.add ?? []) {
        fresh.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'label.add', v });
      }

      // seen 記錄「此刻在本檔中觀察到的、該值的全部 add tag」。同一個 Change 內
      // 一併 add 又 remove 時，新 tag 不在 seen 內，依 add-wins 該 label 存活。
      for (const v of change.labels?.remove ?? []) {
        const seen = existing.filter((o) => o.op === 'label.add' && o.v === v).map((o) => o.id);
        fresh.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'label.rm', v, seen });
      }

      if (change.comment !== undefined) {
        fresh.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'comment', body: change.comment });
      }

      // 一次寫入，且每個 Op 各自以 \n 結尾 —— docs/adr/0001 硬規則 1。
      if (fresh.length > 0) appendFileSync(file, fresh.map(serialize).join(''), 'utf8');

      return reduce(id, [...existing, ...fresh]);
    },
    health(): Diagnostic[] {
      return diagnose(dir);
    },
  };
}
