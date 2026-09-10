# gitNook

*[繁體中文](README.zh-TW.md)*

A git-native, agent-first issue tracker. Issues are plain text files inside your
repository, they travel with your branches, and **two people editing the same
issue on two branches merge without a conflict**.

```bash
npm i -D gitnook
npx nook init                                     # .issues/ + the .gitattributes line
npx nook new "Fix login redirect loop on Safari"
npx nook list
```

Adopting this in a repository that is not yours to change? `npx nook init
--private` gives you the same board with **zero committed bytes** — nothing in
anyone's diff, review or clone, so nobody has to be told about it yet. It
guarantees strictly less, and [private mode](#private-mode) spells out exactly
what it gives up.

No database. No native binary. No daemon. No account. **The CLI has zero runtime
dependencies** — every import in `nook`'s shipped bundle is either a `node:`
builtin or a file inside the package.

`npm i -D gitnook` installs **zero transitive packages**. `dependencies` is
empty and stays empty: studio's frontend (React 19, Radix, Tailwind) is a set of
`devDependencies` compiled ahead of time into two static files —
`dist/studio/studio.js` and `studio.css`, 431 KB together — that ship inside the
tarball and are read from disk when a browser asks for them. Nothing resolves,
downloads or executes at install time.

The half of that claim which genuinely weakened: **React's and Radix's CVE
surface now lives inside our tarball.** Your `npm audit` cannot see it and no
Dependabot PR will open in your repo, because as far as npm is concerned there
is nothing there. Keeping that bundle current is *our* job, and shipping a fixed
one means cutting a gitNook release — not an `npm update` on your side. If you only
use the CLI, `nook studio` is the only thing that ever loads those bytes.

## Why gitNook

**Issues live in the working tree.** `.issues/issues/*.ndjson` are ordinary
committed files. GitHub's web UI shows them in the diff, `grep` finds them, an
agent can `cat` one without a tool call to anywhere, and a branch carries its
issues along with the code that closes them.

**Two branches editing one issue merge without a conflict.** Each issue is an
**append-only op-log**, one immutable operation per line, and reading it folds
the *set* of operations — order in the file is irrelevant. That is what lets
git's built-in `union` merge driver do the merging, and `union` ships inside
git: committing one `.gitattributes` line is the entire setup, for every clone,
with no `git config` for anyone on the team.

**The storage format is the data model.** One JSON object per line, with typed
fields — not prose to be parsed back into fields, so there is no heading
convention to break and no round-trip to lose information.

**It installs like a normal dev dependency.** One `npm i -D gitnook`, ~675 KB
unpacked, zero runtime dependencies, no native binary per platform, no daemon,
no account, no *derived* local state to gitignore. (There is one thing you can
deliberately keep out of git — the board itself, with `nook init --private`
below — and even that writes to `$GIT_DIR/info/exclude`, never to your
`.gitignore`.)

**Both interfaces read the same files.** The CLI is composable and terse enough
to stay inside an agent's token budget (a measured gate, below); `nook studio`
is a local board for humans. Neither is a cache of the other.

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
to run `git config`. That is the whole reason gitNook is not built on Automerge or
Yjs, whose custom merge drivers cannot be enabled by a committed file alone.

- **Actor identity** is derived from `git config user.email`; nothing is stored.
- **Labels** are an add-wins OR-Set, so a concurrent `+bug` and `-bug` keep the label.
- **Deleting never unlinks a file.** `nook rm` appends a `deleted` tombstone and
  stops there: the issue leaves every listing, and its `.ndjson` stays on disk,
  byte for byte, recoverable with `nook set <ref> deleted false`. Reclaiming the
  bytes is a separate, unimplemented operation. modify/delete is the one conflict
  `union` cannot cover, so gitNook never creates one (ADR-0009).
- **Zero local state.** No cache, no index, no `config.json` — nothing *derived*
  that a `.gitignore` entry would have to cover. The one exception is a thing you
  ask for: `nook init --private` keeps the **authoritative data itself** out of
  git (next section). That is a different claim from this one, and the rule that
  nook never writes your `.gitignore` survives it.

There is no cache because there is nothing to cache: a full scan and fold of 100
issues takes 3 ms, 2,000 takes 53 ms, 10,000 takes 266 ms. Node's own startup is
10–20 ms.

## private mode

```bash
npx nook init --private      # a board with zero committed bytes
```

This creates `.issues/issues/` and writes one line — `/.issues/` — into
`$GIT_DIR/info/exclude`. It does not touch `.gitattributes` at all. Afterwards
`git status --porcelain` is empty and `git ls-files .issues` is empty: **zero
committed bytes**, so nothing appears in anyone's diff, review or clone.

**What that buys is a social footprint of zero, not technical compatibility.**
Adopting gitNook was never technically hard — `nook init` adds one directory and
one line. The problem is that those bytes are *committed*: if you are the only
person on the team who wants to try this, there is no way to start without first
having the "what is this thing in our repo" conversation. private mode postpones
that conversation, and that is the whole of what it is for.

So it is **not a second, equal way to run gitNook.** It is a trial / single-user
mode that guarantees strictly *less* — and specifically, the first two reasons in
*Why gitNook* above are switched off under it:

- **Issues live in the working tree** — still true, but they no longer **travel
  with your branches**. An excluded file is the same file on every branch, so
  checking out another branch does not change your board, and an issue can never
  arrive in a clone alongside the code that closes it.
- **Two branches editing one issue merge without a conflict** — there is no
  merge at all. The board never reaches git, so `merge=union` has nothing to
  guarantee. The guarantee is *unneeded* here rather than missing, which is why
  `nook doctor` is silent and exits 0 on a healthy private board, and why
  `list` / `show` stop warning about the `.gitattributes` line.

Everything else works unchanged: `new`, `list`, `show`, `history`, `set`, `mv`,
`comment`, `label`, `studio`.

### The four costs

1. **`git clean -xdf` deletes the whole board, and there is no backup.**
   Measured: `git clean -xdn` reports `Would remove .issues/`. git is normally
   this tool's backup, and private mode is the decision to go without it — which
   is why `init --private` prints this cost every single time it runs, including
   the runs where it did nothing else.
2. **Issues no longer follow a branch.** One board, visible from every branch in
   this working tree; a branch cannot carry its own issues, and a merge or rebase
   moves none of them.
3. **git worktrees cannot see each other's board.** The ignore rule *is* shared
   — it lives in the common git dir, so every linked worktree inherits it — but
   untracked files are not. Measured: in a freshly added linked worktree `nook
   list` says there is no board, and `nook init --private` there prints only
   `Created  .issues/issues/` (the rule is already in place), leaving that
   worktree with its own **empty** board. If you run parallel agents in
   worktrees, this is a landmine.
4. **A new machine, or a fresh clone, has nothing.** There is no sync mechanism:
   the board exists in exactly one working tree, on one disk.

### Upgrading: `nook share`

```
$ nook share
Shared  .issues/  已從 $GIT_DIR/info/exclude 移除（這塊 board 從現在起會進 git）
Created  .gitattributes  .issues/issues/*.ndjson merge=union
Next  nook 不替你跑任何會寫入的 git 指令，請自己執行：
  git add "<repo>/.issues" "<repo>/.gitattributes"
  git commit -m "Share the nook board"
```

`share` removes exactly the one line nook borrowed — your other exclude entries,
and the file itself, are left untouched — restores the `merge=union` line, prints
the `git add` **you** run (with absolute paths, because the board need not sit at
the repo root), and then stops. Those two git lines are printed only while the
op-logs are still outside the index: on a board already committed, `share` says it
changed nothing and stops there, because `git commit` is not idempotent — it would
either fail or sweep your pending issue edits into a commit claiming to share the
board. **nook runs no git command that writes**, and
`git add` is not going to be the first: handing a board to the whole team is a
social decision, and that decision, along with its commit message, is yours.
If something *still* ignores
the board at that point (a committed `.gitignore` with its own rule is the usual
shape), `share` names the file and line that is blocking and exits 1, rather than
printing a `git add` that git would refuse.

There is no `nook unshare`. Going the other way requires `git rm -r --cached`,
which deletes the board from your teammates' clones — destructive, so you run it
yourself. `init --private` on an already-shared board refuses and prints that
command for you; it does not run it. The reasoning for all of this, including why
the rule goes in `$GIT_DIR/info/exclude` rather than a committed `.gitignore`, is
in ADR-0011.

## The four hard metrics

These are gates, not aspirations. `npm run bench` prints all four — plus the two
structural rows below them — and exits non-zero if any is over budget.

| Metric | Budget | Measured |
|---|---|---|
| Package size, unpacked | < 3 MB | **675,267 B** (21% of the gate) |
| Cold start, `nook --version` from the packed tarball | < 500 ms | **≈25 ms** |
| Concurrent merge of one issue on two branches | zero conflicts | **0** |
| Agent tokens, 40-issue scenario | < 4.5 KB | **4,102 B** |

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
| studio assets, `dist/studio/` | < 768 KB | **441,497 B** |
| React markers in `dist/cli/run.js` | 0 | **0** |

studio is three quarters of the package, so it could grow by half and package
size would still read as comfortable — its own row is what makes that growth
visible. The marker row enforces ADR-0008's hard constraint directly: the studio
bundle must never reach `src/cli/run.ts`'s import chain. Cold start was guarding
that only by proxy, and timing drifts — on a noisy machine it says "a bit slower"
where counting `react` / `createRoot` / `radix` / `tailwind` in the shipped CLI
bundle says "React is in the CLI bundle".

## What gitNook refuses to do

The moat is the ability to **refuse to become a project management tool**. Being
small and being correct are consequences of that refusal, not features bolted on
beside it. So, explicitly and permanently out of scope:

- **assignees** — an Actor is who wrote an operation, not who owns the work
- **priority, milestone, due date, estimate** — use a label
- **configurable statuses** — the eight are fixed, so an agent never has to ask
  what this project's statuses are before it can act
- **sub-tasks** — `- [ ]` in a description is text, and stays text
- **search / filter UI, a TUI** — `nook studio` is a GUI and it does edit
  (ADR-0007), but it has no search, no filtering, and no terminal UI
- **an MCP server** — the CLI is the interface
- **op-log compaction**
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

**`blocked` is just a status**, with nothing attached: no required comment, no
gate. A flat status list does lose "what was I doing before I got stuck", and
ADR-0003 accepts that loss — leaving a comment is a choice anyone can make, not
a rule the tool enforces.

**`archived` is a field, not a status.** Archiving is *visibility*;
`done`/`cancelled` are *outcome*. They are orthogonal, and collapsing them would
permanently lose whether an archived issue was finished or abandoned.

**Refs** are ULIDs. Anywhere an id is accepted, any unambiguous prefix works,
exactly like a git short hash; ambiguity is an error that lists the candidates,
never a silent guess. Statuses take prefixes too (`que` → `queued`).

## Commands

```
init [--private]                       create .issues/ and the .gitattributes line;
                                       --private leaves zero committed bytes instead
new <title> [--description <text|->] [--label <l>] [--editor]
list [--all] [--status <s>] [--label <l>] [--json]
show <ref> [--json]
history <ref> [<field>]                every write to an LWW field, read-only
set <ref> <title|description|status|archived|deleted> <value|->  [--editor]
mv <ref> <status>
rm <ref> [--yes]                       delete: writes a tombstone, never unlinks
comment <ref> <body|->
label <ref> +bug -ui
share                                  upgrade a private board back to a shared one
doctor [--fix]                         data health check; --fix repairs glued lines
studio [--port <n>]                    board on localhost; create, drag, edit, comment
workspace <list|doctor|studio>         cross-repo, read-only — see workspace below
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
nook history <ref>         every write to a field, with actor and lamport t
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
`queued` authorization boundary, how refs work, and what gitNook refuses to do.

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
`{ labels: { add: ['bug'] } }`; add-wins is gitNook's problem.

Also exported: `initBoard`, `diagnose`, `repair`, `serve`, `STATUSES`, every
type in that API, and the error types (`RefNotFound`, `AmbiguousRef`,
`InvalidStatus`, `BoardNotInitialized`, `IssueDeleted`, `ConflictingGitAttributes`,
`NestedBoard`, `AlreadySharedBoard`, `NoGitDir`, `PortInUse`) — so a caller can
tell "you can fix this" from "report a bug" with `instanceof`. That list is pinned
by `test/index.test.ts`, which is the one that will tell you when this sentence
goes stale.

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
title, the description, labels, status and comments. **The eight columns are the
eight statuses and nothing more** — no lanes, no gates, no column that means
something the status does not (ADR-0010). What a column means is whatever you
and your team grow it into.

You can **create** an issue without going back to the terminal — a button in the
header and a `+` on each of the eight columns, both asking for a title and
nothing else. From the drawer you can **archive** and un-archive an issue, or
**delete** it behind a confirmation; deleting writes the same tombstone `nook rm`
writes, so the card leaves the board and the file stays on disk (ADR-0009). A
**theme** switch offers light, dark and follow-the-system, remembered in
`localStorage` — how you look at the board is a property of this machine, not of
the op-log. Writes go through `POST /i/<ref>`, and creation through
`POST /api/issues`, into the same append-only op-log the CLI writes, so the CLI
and studio can be open at once. There is no rollback on failure and none is
needed: an op that lands is permanent, and a card that ends up somewhere else
lost a last-writer-wins tie to whoever wrote later. A two-second poll applies
changes in place rather than reloading the page, and an issue you are holding
the pointer on never moves underneath you.

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

## workspace

```bash
cd path/to/the/parent/folder
npx nook workspace list
```

A monorepo's packages, or a folder where a few unrelated repos just happen to
sit side by side — either way, `nook workspace` gives you one read-only view
across however many boards it finds under the current directory, instead of
`cd`-ing into each one and running `nook list` by hand. It is a **view**, not a
new kind of storage: nothing is created, merged, or cached, and every member
board keeps its own op-log, actor identity and sharing state exactly as if you
had opened it alone.

**Discovery is a filesystem scan, not a config file.** `openWorkspace()` walks
the current directory looking for `.issues/issues/`; the first one found on a
given branch of the tree stops that branch — the directory holding it is a
member, and nothing beneath it is scanned. It skips directories named `.git`
and `node_modules`, matched by name only, and never follows a symlinked
directory, so a symlink cycle back up the tree terminates instead of hanging
or double-counting a member. The starting directory itself counts as a member
if it has a board of its own. It does **not** read `.gitmodules` — whether a
folder is a git submodule is irrelevant; only `.issues/issues/` existing
decides membership (ADR-0012).
There is no depth limit, and nothing is cached: every call re-scans the tree.
A folder with no boards under it is not an error — `members` is simply empty,
unlike `openBoard()`, which throws when there is no board at all.

- `nook workspace list [--all] [--status <s>] [--label <l>] [--json]` — every
  member's issues, grouped by that member's path relative to the workspace
  root, one table per member with a blank line between groups. The filter
  flags mean exactly what they mean for plain `list`, applied independently
  per member; a member that filters down to nothing is left out of the output
  entirely rather than printed as an empty group.
- `nook workspace doctor [--fix]` — runs the same `health()` (and, with
  `--fix`, `repair()`) that `nook doctor` runs, once per member, and labels
  every line with that member's path so a diagnostic is never mistaken for the
  parent folder's own problem. Any member being unhealthy exits 1; `--fix`
  repairs every member that needs it.
- `nook workspace studio [--port <n>]` — opens a small landing page listing
  every member found; clicking one starts (or reuses) that member's own,
  completely unmodified `nook studio`, on its own port. Boards are never
  merged into one screen — each member's studio is exactly as independent as
  running it directly, drag-and-drop included.

**This cannot write anything.** There is no `nook workspace new`, `set`, or
`mv` — deciding which member a write belongs to is a real design question
that this round of work deliberately leaves open. `workspace` only ever reads
what already exists on disk; every single-board command works exactly as
documented above, unaffected.

## doctor

The `.gitattributes` line is the single point of failure: delete it and issues
start conflicting silently. `nook doctor` checks for it, and reading commands
warn when it is missing. On a **shared** board that warning is never noise; on a
private board neither the warning nor the check applies, and the silence there is
the correct output rather than a swallowed problem (see private mode above).

`doctor` is also the only place that can see the board's **sharing state being
inconsistent** — the exclude rule present while git already tracks the op-log, or
no rule of nook's while git ignores the op-log anyway. `list` and `show` are
blind to both, because answering that question properly means asking git and they
are not allowed to spawn a subprocess. `doctor` does ask, and says which file and
line git itself pointed at (ADR-0011).

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
  description keep one version. The loser is not lost — every write is still in
  the op-log, and `nook history <ref>` (or `Board.opLog()`) prints it back with
  its actor and lamport clock — but the fold shows one value, and re-instating
  the other one is a copy-paste by hand.
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
