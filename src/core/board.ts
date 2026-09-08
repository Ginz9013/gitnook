import { existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Board, CreateInput, Change, Filter, Issue, Diagnostic, OpenBoardOptions, IdSource } from './types.js';
import { BoardNotInitialized, RefNotFound, NotImplemented } from './types.js';
import { serialize, parseLine, type Op } from './ops.js';
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
      const id = ids.ulid();
      const op: Op = { id: ids.ulid(), t: 1, a: actorId(), op: 'create', title: input.title };
      appendFileSync(pathOf(id), serialize(op), 'utf8');
      return reduce(id, [op]);
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
    apply(_ref: string, _change: Change): Issue {
      throw new NotImplemented('apply');
    },
    health(): Diagnostic[] {
      return diagnose(dir);
    },
  };
}
