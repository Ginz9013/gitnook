import { existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Board, CreateInput, Change, Filter, Issue, Diagnostic, OpenBoardOptions, IdSource } from './types.js';
import { BoardNotInitialized, RefNotFound, NotImplemented, resolveStatus } from './types.js';
import { serialize, parseLine, nextLamport, type Op, type SetKey } from './ops.js';
import { reduce } from './reduce.js';
import { systemIds } from './ids.js';
import { deriveActor } from './actor.js';
import { diagnose } from './health.js';

export function openBoard(opts: OpenBoardOptions = {}): Board {
  const dir = opts.dir ?? process.cwd();
  const issuesDir = join(dir, '.issues', 'issues');
  const ids: IdSource = opts.ids ?? systemIds;
  let actor: string | undefined = opts.actor;

  const actorId = (): string => (actor ??= deriveActor(dir));

  const requireInitialized = (): void => {
    if (!existsSync(issuesDir)) throw new BoardNotInitialized(dir);
  };

  const pathOf = (id: string): string => join(issuesDir, `${id}.ndjson`);

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
      const file = pathOf(ref);
      if (!existsSync(file)) throw new RefNotFound(ref);
      return reduce(ref, readOps(file));
    },
    list(_filter?: Filter): Issue[] {
      throw new NotImplemented('list');
    },
    apply(ref: string, change: Change): Issue {
      requireInitialized();
      const file = pathOf(ref);
      if (!existsSync(file)) throw new RefNotFound(ref);

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

      return reduce(ref, [...existing, ...fresh]);
    },
    health(): Diagnostic[] {
      return diagnose(dir);
    },
  };
}
