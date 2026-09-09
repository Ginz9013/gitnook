# nook

A git-native, agent-first issue tracker. Issues are plain text files inside your
repository, they travel with your branches, and **two people editing the same
issue on two branches merge without a conflict**.

```bash
npm i -D gitnook
npx nook init                                     # .issues/ + the .gitattributes line
npx nook new "Fix login redirect loop on Safari"
npx nook list
```

No database. No native binary. No daemon. No account. **The CLI has zero runtime
dependencies** — every import in `nook`'s shipped bundle is either a `node:`
builtin or a file inside the package.

`npm i -D gitnook` installs **zero transitive packages**. `dependencies` is
empty and stays empty: studio's frontend (React 19, Radix, Tailwind) is a set of
`devDependencies` compiled ahead of time into two static files —
`dist/studio/studio.js` and `studio.css`, 413 KB together — that ship inside the
tarball and are read from disk when a browser asks for them. Nothing resolves,
downloads or executes at install time.

The half of that claim which genuinely weakened: **React's and Radix's CVE
surface now lives inside our tarball.** Your `npm audit` cannot see it and no
Dependabot PR will open in your repo, because as far as npm is concerned there
is nothing there. Keeping that bundle current is *our* job, and shipping a fixed
one means cutting a nook release — not an `npm update` on your side. If you only
use the CLI, `nook studio` is the only thing that ever loads those bytes.

## Why another one

| | Where issues live | Merges cleanly | Ships as |
|---|---|---|---|
| Linear / Jira + MCP | someone else's server | n/a | SaaS |
| [git-bug](https://github.com/git-bug/git-bug) (10,023★) | `refs/bugs/*`, outside the working tree | yes | Go binary |
| [backlog.md](https://github.com/MrLesk/Backlog.md) (6,668★) | markdown, `## Status` headings as database columns | **no** | 67.5 MB Bun binary, one per platform |
| **nook** | `.issues/issues/*.ndjson`, in the working tree | **yes** | ~543 KB npm package, 413 KB of it studio's prebuilt frontend |

git-bug's issues are not in the working tree, so GitHub's web UI does not show
them, `grep` does not find them, and an agent cannot `cat` them. backlog.md's
issues *are* files, but markdown is its storage format — parsing headings back
into fields is a recurring bug source, and two branches touching one issue
produce a hand-merged conflict every time.

nook stores an **append-only op-log** per issue instead, and lets git's built-in
`union` merge driver do the merging.

## How it works

```
.issues/issues/01JBX7A9Q3.ndjson    committed, merge=union
.gitattributes                      committed, contains the merge=union line
```

One issue, one file, one JSON object per line. Every line is an immutable
operation:

```jsonl
{"id":"01JBX7A9Q3","t":1,"a":"k3f9","op":"create","title":"Fix login redirect"}
{"id":"01JBX7B2K9","t":2,"a":"k3f9","op":"set","k":"status","v":"in_progress"}
{"id":"01JBX7C5R1","t":3,"a":"k3f9","op":"label.add","v":"bug"}
{"id":"01JBX9F3M2","t":4,"a":"m8q2","op":"label.rm","v":"bug","seen":["01JBX7C5R1"]}
```

Reading an issue means: parse the lines, sort them into a total order by
`(t, actor, id)`, drop duplicates by op id, then fold. **The result depends only
on the *set* of operations, never on their order in the file.** That is why
`merge=union` — which simply keeps every line from both sides — always
converges. Nothing has to be resolved by hand.

`merge=union` is a driver that ships *inside* git. Committing the
`.gitattributes` line is enough: every clone gets the behaviour, and nobody has
to run `git config`. That is the whole reason nook is not built on Automerge or
Yjs, whose custom merge drivers cannot be enabled by a committed file alone.

- **Actor identity** is derived from `git config user.email`; nothing is stored.
- **Labels** are an add-wins OR-Set, so a concurrent `+bug` and `-bug` keep the label.
- **Nothing is ever deleted** — modify/delete is the one conflict `union` cannot cover.
- **Zero local state.** No cache, no index, no `config.json`, nothing to gitignore.

There is no cache because there is nothing to cache: a full scan and fold of 100
issues takes 3 ms, 2,000 takes 53 ms, 10,000 takes 266 ms. Node's own startup is
10–20 ms.

## The four hard metrics

These are gates, not aspirations. `npm run bench` prints all four — plus the two
structural rows below them — and exits non-zero if any is over budget.

| Metric | Budget | Measured |
|---|---|---|
| Package size, unpacked | < 3 MB | **542,919 B** (17% of the gate) |
| Cold start, `nook --version` from the packed tarball | < 500 ms | **≈26 ms** |
| Concurrent merge of one issue on two branches | zero conflicts | **0** |
| Agent tokens, 40-issue scenario | < 4.5 KB | **4,065 B** |

The size and cold-start numbers are measured against the tarball `npm pack`
produces, not against `src/` — only the tarball reflects what you actually
install. The merge number comes from a real `git merge` / `git pull --rebase`
integration test. The token number is the total bytes of the agent
instructions plus every command's output for a 40-issue project doing
`list → show → mv → comment`; the budget is bound to that scenario, because
output grows linearly with issue count.

(Measured on node 22.22.1 / darwin-arm64, from a clean `dist/`. Cold start
varies by machine; run `npm run bench` for yours.)

Two more rows exist because those four cannot see what they need to see:

| Row | Budget | Measured |
|---|---|---|
| studio assets, `dist/studio/` | < 768 KB | **412,686 B** |
| React markers in `dist/cli/run.js` | 0 | **0** |

studio is three quarters of the package, so it could grow by half and package
size would still read as comfortable — its own row is what makes that growth
visible. The marker row enforces ADR-0008's hard constraint directly: the studio
bundle must never reach `src/cli/run.ts`'s import chain. Cold start was guarding
that only by proxy, and timing drifts — on a noisy machine it says "a bit slower"
where counting `react` / `createRoot` / `radix` / `tailwind` in the shipped CLI
bundle says "React is in the CLI bundle".

## What nook refuses to do

The moat is the ability to **refuse to become a project management tool**. Being
small and being correct are consequences of that refusal, not features bolted on
beside it. So, explicitly and permanently out of scope:

- **assignees** — an Actor is who wrote an operation, not who owns the work
- **priority, milestone, due date, estimate** — use a label
- **configurable statuses** — the eight are fixed, so an agent never has to ask
  what this project's statuses are before it can act
- **sub-tasks** — `- [ ]` in a description is text, and stays text
- **search / filter UI, a TUI** — `nook studio` is a GUI and it does edit
  (ADR-0007), but it has no search, no filtering, and no terminal UI, and it
  cannot create issues
- **an MCP server** — the CLI is the interface
- **op-log compaction**
- **issue deletion** — `git merge` cannot resolve modify/delete
- **`nook next`** and other primitives shaped around one particular agent workflow

Some teams will want a ninth status. The answer is a label. Saying no to that
request *is* the product.

## The model

**Statuses** — eight, fixed:

```
backlog  todo  queued  in_progress  review  blocked  done  cancelled
```

`backlog` and `todo` are the **human lane**; `queued` onward is the **agent
lane**. `queued` is the handoff gate: moving an issue into `queued` means the
requirements are settled and **the agent is authorised to act without asking**.
It is an authorisation boundary, not a bucket.

`blocked` requires a comment saying why — that comment carries the "what was I
doing before I got stuck" that a flat status list would lose.

**`archived` is a field, not a status.** Archiving is *visibility*;
`done`/`cancelled` are *outcome*. They are orthogonal, and collapsing them would
permanently lose whether an archived issue was finished or abandoned.

**Refs** are ULIDs. Anywhere an id is accepted, any unambiguous prefix works,
exactly like a git short hash; ambiguity is an error that lists the candidates,
never a silent guess. Statuses take prefixes too (`que` → `queued`).

## Commands

```
init                                   create .issues/ and the .gitattributes line
new <title> [--description <text|->] [--label <l>] [--editor]
list [--all] [--status <s>] [--label <l>] [--json]
show <ref> [--json]
set <ref> <title|description|status|archived> <value|->  [--editor]
mv <ref> <status>
comment <ref> <body|->
label <ref> +bug -ui
doctor [--fix]                         data health check; --fix repairs glued lines
studio [--port <n>]                    board on localhost; drag, edit, comment
```

`-` as a value reads the value from stdin.

## For agents

Paste this into your agent's instructions, skill file, or `CLAUDE.md`. It is the
exact text the token budget gate measures, so it will not silently drift away
from what the CLI does:

```
# nook

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
list hides archived, done and cancelled unless --all.
--json exists for scripts; the default table is cheaper to read.
```

The default output is a compact table **for humans and agents alike**. The
reflex is to hand an agent JSON; measuring says the opposite:

```
{"id":"01JBX7A9Q3","title":"Fix login redirect","status":"queued","labels":["bug"]}   83 bytes
01JBX7  queued  Fix login redirect  [bug]                                            41 bytes
```

Same information, half the bytes, and no model has trouble reading it. `--json`
stays for scripts that genuinely need to parse.

### Agent usage guide

`AGENT.md` ships with the package. The block above is the minimum an agent needs
in every interaction; `AGENT.md` is the complete reference — every command, the
`queued` authorization boundary, how refs work, and what nook refuses to do.

It is plain Markdown with a YAML header, so point any agent at it:

```
node_modules/gitnook/AGENT.md
```

For Claude Code, symlink it in so it loads on demand:

```sh
mkdir -p ~/.claude/skills/nook
ln -s "$PWD/node_modules/gitnook/AGENT.md" ~/.claude/skills/nook/SKILL.md
```

## Library first

The CLI is one caller of a public API, not the other way round:

```ts
import { openBoard } from 'gitnook';

const board = openBoard();                  // defaults to ./.issues
const issue = board.create({ title: 'Fix login redirect', labels: ['bug'] });

board.apply(issue.id, { status: 'queued', labels: { add: ['p1'] } });
board.list({ status: 'queued' });
board.health();                             // what `nook doctor` reports
```

`Board` owns the whole CRDT: op generation, the lamport clock, ULIDs, the
trailing-newline discipline, dedupe, total ordering, the fold, OR-Set bookkeeping
and prefix resolution. **A caller never sees an operation.** You say
`{ labels: { add: ['bug'] } }`; add-wins is nook's problem.

Also exported: `initBoard`, `diagnose`, `repair`, `serve`, `STATUSES`, every
type in that API, and the error types (`RefNotFound`, `AmbiguousRef`,
`InvalidStatus`, `BoardNotInitialized`, `ConflictingGitAttributes`,
`NestedBoard`, `PortInUse`) — so a caller can tell "you can fix this" from
"report a bug" with `instanceof`.

That list is deliberately short. The renderers and the studio request handler
are **not** exported: they are presentation and plumbing, and every export is a
permanent compatibility liability. Adding one later is a compatible change;
taking one away is not, so this package starts narrow.

## studio

```bash
npx nook studio
```

The **human** interface, on `127.0.0.1`. The CLI is the agent's: composable,
parseable, cheap in tokens. Dragging six issues into `todo` and ordering them is
six `nook mv`s there and six seconds here (ADR-0007).

Eight columns you drag issues between, and a drawer per issue for editing the
title, the description, labels, status and comments. It **cannot create
issues** — that stays in `nook new`. Writes go through `POST /i/<ref>` into the
same append-only op-log the CLI writes, so the CLI and studio can be open at
once. There is no rollback on failure and none is needed: an op that lands is
permanent, and a card that ends up somewhere else lost a last-writer-wins tie to
whoever wrote later. A two-second poll applies changes in place rather than
reloading the page, and an issue you are holding the pointer on never moves
underneath you.

**Loopback-only is now the entire security model, not a conservative default.**
studio has no authentication, so anything that can reach it can write to the
whole board. That is why it binds `127.0.0.1` and why `--host` is not "not yet"
but **never** (ADR-0007). Every op studio writes is attributed to the actor from
your `git config user.email`, which is the second reason it must not be shared:
a shared studio would file everyone's work under one actor and break the
tiebreak that merging depends on.

The frontend is a React SPA (`src/studio/`, built by Vite into `dist/studio/`).
Markdown is still rendered to safe HTML on the server, by the same escape-first
renderer as before — the browser is handed strings that are already safe rather
than being trusted to sanitise them.

## doctor

The `.gitattributes` line is the single point of failure: delete it and issues
start conflicting silently. `nook doctor` checks for it, and reading commands
warn when it is missing.

`doctor` also reports unparsable lines, unknown operation types (which are
ignored rather than fatal — a teammate on a newer version must never make your
data unreadable), and **glued lines**: if a write ever lands without a trailing
newline, `union` merge can splice two JSON objects into one. `doctor --fix`
repairs them.

## Requirements

Node >= 22. That is the entire list. No native module, no SQLite, no postinstall
script, no `git config` for anyone on the team.

## Known limits

- **`description` is last-writer-wins.** Concurrent edits of the same
  description keep one version; the loser is still in the op-log, but v1 has no
  interface to fetch it back.
- **No cross-branch atomicity.** Two agents in two worktrees can pick up the
  same issue. Both operations survive and converge — but the work may be
  duplicated.
- **Short ids are unambiguous when printed.** A later issue can extend a shared
  ULID prefix, exactly as with git short hashes. Print the full 26 characters if
  you need permanence.

## Contributing

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run bench         # the four hard metrics, plus the two structural rows
npm run build         # tsup bundle + declarations + the studio assets
```

The first three run in CI (`.github/workflows/ci.yml`) on every push and pull
request.

**Always build with `npm run build`. Never run `npx tsup` on its own.** There are
two build targets in this repo — tsup for the node side, Vite for studio — and
tsup cleans the *whole* of `dist/`, including `dist/studio/`, which only
`vite build` writes. Run tsup alone and the build looks like it succeeded while
`nook studio` has no assets left to serve.

For the same reason, read the package size off `npm run bench` and never off
`dist/` directly. bench packs the tarball through `prepack`, so it always
measures a freshly built tree; a `dist/` you happen to be looking at may be
carrying artifacts from an earlier build and reads far larger than what ships.

One test needs a non-loopback IPv4 interface: `test/server/serve.test.ts`
asserts that `studio` refuses to bind anything but loopback, and it **throws
rather than skips** when no external interface exists. That is deliberate — a
silent skip would let a `0.0.0.0` regression pass in CI. The workflow therefore
checks for an interface up front and fails with a pointed message instead of
quietly neutralising the test; a runner without one has to compensate for that
guarantee elsewhere.

## License

MIT
