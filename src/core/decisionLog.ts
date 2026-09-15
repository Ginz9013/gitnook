import { existsSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Decision,
  DecisionChange,
  DecisionFilter,
  DecisionLog,
  CreateDecisionInput,
  OpenDecisionLogOptions,
} from './decisionTypes.js';
import type { Diagnostic } from './types.js';
import { DecisionLogNotInitialized, DecisionNotFound, AmbiguousDecisionRef, resolveDisposition } from './decisionTypes.js';
import { serialize, parseLine, nextLamport, orderOps } from './oplog.js';
import type { DecisionOp, DecisionSetKey } from './decisionOps.js';
import { systemIds, resolvePrefix, isValidRef, normalizeRef } from './ids.js';
import { deriveActor } from './actor.js';
import { findDecisionRoot, inspectMergeGuarantee, DECISION_MERGE_RULE, DECISION_LOG_SAMPLE } from './gitattributes.js';
import { AmbiguousRef, RefNotFound } from './types.js';
import { reduceDecision } from './decisionReduce.js';

/** 一個 Decision 一個檔，檔名是純 ULID —— 同 Board 的既有規則。 */
const LOG_SUFFIX = '.ndjson';

/**
 * `.decisions/decisions/<ULID>.ndjson` 的讀寫入口。同 `openBoard()` 的形狀
 * （尋根、lamport、resolve、requireInitialized 的節奏逐一對應），但欄位換成
 * `title`/`body`/`disposition`/`supersededBy`/`legacyRef`，且沒有 label／
 * comment 那兩種非 LWW 語意。
 */
export function openDecisionLog(opts: OpenDecisionLogOptions = {}): DecisionLog {
  const from = opts.dir ?? process.cwd();
  const ids = opts.ids ?? systemIds;
  let actor: string | undefined = opts.actor;
  let root: string | undefined;

  const rootDir = (): string => (root ??= locate());

  const locate = (): string => {
    const found = findDecisionRoot(from);
    if (!found.found) throw new DecisionLogNotInitialized(from, found.ceiling);
    return found.root;
  };

  const decisionsDir = (): string => join(rootDir(), '.decisions', 'decisions');

  const actorId = (): string => (actor ??= deriveActor(rootDir()));

  /** 同 `board.ts` 的 `requireInitialized`：目錄事後被移除時該說「不是一個
   * decision log」，而不是一個看起來像 nook 內部 bug 的 ENOENT。 */
  const requireInitialized = (): void => {
    if (root !== undefined && !existsSync(decisionsDir())) root = undefined;
    rootDir();
  };

  const pathOf = (id: string): string => join(decisionsDir(), `${id}${LOG_SUFFIX}`);

  const logIds = (): string[] =>
    readdirSync(decisionsDir())
      .filter((f) => f.endsWith(LOG_SUFFIX))
      .map((f) => f.slice(0, -LOG_SUFFIX.length))
      .sort();

  /**
   * 完整識別碼走檔案系統直達；其餘交給 `ids.ts` 既有的前綴解析——那份邏輯
   * 本身就是通用的（只認一串 id 字串，不知道 Issue 或 Decision）。它丟的是
   * Issue 專用的 `RefNotFound`/`AmbiguousRef`，這裡接住轉成 Decision 專用的
   * 型別，不重寫一份比對演算法。
   */
  const resolve = (ref: string): string => {
    if (!isValidRef(ref)) throw new DecisionNotFound(ref);
    const norm = normalizeRef(ref);
    if (existsSync(pathOf(norm))) return norm;
    try {
      return resolvePrefix(norm, logIds());
    } catch (thrown) {
      if (thrown instanceof AmbiguousRef) throw new AmbiguousDecisionRef(ref, thrown.candidates);
      if (thrown instanceof RefNotFound) throw new DecisionNotFound(ref);
      throw thrown;
    }
  };

  const readOps = (file: string): DecisionOp[] => {
    const out: DecisionOp[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line === '') continue;
      const op = parseLine<DecisionOp>(line);
      if (op !== null) out.push(op);
    }
    return out;
  };

  return {
    create(input: CreateDecisionInput): Decision {
      requireInitialized();
      // 驗證先於任何寫入：被拒絕的輸入不得留下一個半成品的檔案。
      const disposition = input.disposition === undefined ? undefined : resolveDisposition(input.disposition);

      const id = ids.ulid();
      let t = 1;
      const ops: DecisionOp[] = [{ id: ids.ulid(), t: t++, a: actorId(), op: 'create', title: input.title }];

      if (input.body !== undefined) {
        ops.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'set', k: 'body', v: input.body });
      }
      if (disposition !== undefined) {
        ops.push({ id: ids.ulid(), t: t++, a: actorId(), op: 'set', k: 'disposition', v: disposition });
      }

      appendFileSync(pathOf(id), ops.map(serialize).join(''), 'utf8');
      return reduceDecision(id, ops);
    },
    get(ref: string): Decision {
      requireInitialized();
      const id = resolve(ref);
      return reduceDecision(id, readOps(pathOf(id)));
    },
    opLog(ref: string): readonly DecisionOp[] {
      requireInitialized();
      const id = resolve(ref);
      return orderOps(readOps(pathOf(id)));
    },
    refs(): readonly string[] {
      requireInitialized();
      return logIds();
    },
    list(filter: DecisionFilter = {}): Decision[] {
      requireInitialized();
      const disposition = filter.disposition === undefined ? undefined : resolveDisposition(filter.disposition);
      const decisions = logIds().map((id) => reduceDecision(id, readOps(pathOf(id))));
      return disposition === undefined ? decisions : decisions.filter((d) => d.disposition === disposition);
    },
    apply(ref: string, change: DecisionChange): Decision {
      requireInitialized();
      const id = resolve(ref);
      const file = pathOf(id);
      const existing = readOps(file);

      // 驗證先於任何寫入：被拒絕的 Change 不得留下半個 Op。
      const disposition = change.disposition === undefined ? undefined : resolveDisposition(change.disposition);

      let t = nextLamport(existing);
      const fields: [DecisionSetKey, string][] = [];
      if (change.title !== undefined) fields.push(['title', change.title]);
      if (change.body !== undefined) fields.push(['body', change.body]);
      if (disposition !== undefined) fields.push(['disposition', disposition]);
      // supersededBy 只驗證形狀不驗證存在——spec.md Non-goals，同 label 的既有態度。
      if (change.supersededBy !== undefined) fields.push(['supersededBy', change.supersededBy]);
      if (change.legacyRef !== undefined) fields.push(['legacyRef', change.legacyRef]);

      const fresh: DecisionOp[] = fields.map(([k, v]) => ({ id: ids.ulid(), t: t++, a: actorId(), op: 'set', k, v }));

      if (fresh.length > 0) appendFileSync(file, fresh.map(serialize).join(''), 'utf8');
      return reduceDecision(id, [...existing, ...fresh]);
    },
    root(): string {
      requireInitialized();
      return rootDir();
    },
    health(): Diagnostic[] {
      // 同 `Board.health()`：找不到根時就地診斷而不是拋錯——doctor 在還不是
      // decision log 的目錄也該答得出話。ticket 06 之後會把這個檢查併進
      // `health.ts` 的 `diagnose()`，取得黏合行／未知 op 那些額外的診斷；
      // 這裡先只覆蓋零衝突保證本身（同 spec.md 的「nook doctor 只覆蓋
      // merge=union 檢查」）。
      const found = findDecisionRoot(from);
      const dir = found.found ? found.root : from;
      const guarantee = inspectMergeGuarantee(dir, DECISION_LOG_SAMPLE);

      if (guarantee.kind === 'union') return [];
      if (guarantee.kind === 'absent') {
        return [
          {
            kind: 'MissingMergeDriver',
            file: '.gitattributes',
            message: `missing the zero-conflict guarantee: ${DECISION_MERGE_RULE} (run nook decision init to restore it)`,
          },
        ];
      }
      return [
        {
          kind: 'MissingMergeDriver',
          file: '.gitattributes',
          line: guarantee.line,
          message: `this line keeps the op-log from getting merge=union: ${guarantee.rule}`,
        },
      ];
    },
  };
}
