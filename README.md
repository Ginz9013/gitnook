# gitNook

*[繁體中文](README.zh-TW.md)*

A git-native, agent-first issue tracker. Issues are plain text files inside your
repository, they travel with your branches, and **two people editing the same
issue on two branches merge without a conflict**.

```bash
npm i -D gitnook
npx nook init                                           # .gitnook/ + both .gitattributes lines
npx nook issue new "Fix login redirect loop on Safari"
npx nook issue list
```

Adopting this in a repository that is not yours to change? `npx nook init
--private` gives you the same board with **zero committed bytes** — nothing in
anyone's diff, review or clone, so nobody has to be told about it yet. See
[private mode](#private-mode).

No database. No native binary. No daemon. No account. **The CLI has zero
runtime dependencies**, and installs with zero transitive packages.

## Why gitNook

**Issues live in the working tree.** `.gitnook/issues/*.ndjson` are ordinary
committed files. GitHub's web UI shows them in the diff, `grep` finds them, an
agent can `cat` one without a tool call to anywhere, and a branch carries its
issues along with the code that closes them.

**Two branches editing one issue merge without a conflict.** Each issue is an
append-only log of small operations, and reading one just folds the *set* of
operations — their order in the file never matters. That's what lets git's
built-in `union` merge driver do the merging: committing one `.gitattributes`
line is the entire setup, for every clone, with no `git config` for anyone on
the team.

**The storage format is the data model.** One JSON object per line, with typed
fields — not prose to be parsed back into fields, so there's no heading
convention to break and no round-trip to lose information.

**It installs like a normal dev dependency.** No native binary per platform,
no daemon, no account, no derived local state to gitignore.

**Both interfaces read the same files.** The CLI is composable and terse
enough to stay inside an agent's token budget; `nook studio` is a local board
for humans. Neither is a cache of the other.

**It refuses to become a project management tool.** No assignees (an Actor is
who wrote an operation, not who owns the work), no priority/milestone/due date
(use a label), no configurable statuses, no sub-tasks, no search UI, no MCP
server. Some teams will want a ninth status — the answer is a label. Saying no
to that request *is* the product.

## The model

**Statuses** — eight, fixed:

```
backlog  todo  queued  in_progress  review  blocked  done  cancelled
```

`backlog` and `todo` are the **human lane**; `queued` onward is the **agent
lane**. `queued` is the handoff gate: moving an issue into `queued` means the
requirements are settled and **the agent is authorised to act without
asking**. It's an authorisation boundary, not a bucket.

`blocked` is just a status, with nothing attached — no required comment, no
gate. `archived` is a field, not a status: archiving is *visibility*,
`done`/`cancelled` is *outcome*, and the two are orthogonal.

**Refs** are ULIDs. Anywhere an id is accepted, any unambiguous prefix works,
exactly like a git short hash; ambiguity is an error that lists the
candidates, never a silent guess. Statuses take prefixes too (`que` →
`queued`).

## private mode

```bash
npx nook init --private            # a board with zero committed bytes
```

This keeps the board out of git entirely (via `$GIT_DIR/info/exclude`, never
your `.gitignore`). Afterwards `git status` and `git ls-files` show nothing:
zero committed bytes, so nothing appears in anyone's diff, review or clone.

It buys a social footprint of zero, not technical compatibility — a way to
try gitNook in a repo that isn't yours to change without first having the
"what is this thing" conversation. It is a trial / single-user mode, not a
second equal way to run gitNook, and it gives up real things:

- `git clean -xdf` deletes the whole board, with no backup.
- Issues no longer travel with a branch — one board, shared by every branch
  in the working tree.
- git worktrees don't see each other's board.
- A new machine or a fresh clone starts with nothing; there's no sync.

`nook issue share` upgrades a private board back to shared: it restores the
`merge=union` line and prints the `git add`/`git commit` for you to run
yourself — nook never runs a git command that writes.

Everything else works unchanged under `nook issue <verb>` — see
[Commands](#commands).

## Commands

```
init [--private] [--workspace]         create .gitnook/issues/ and .gitnook/decisions/
                                        (both modules, one shot) plus their .gitattributes
                                        lines; --private leaves zero committed bytes instead;
                                        --workspace marks this directory so a recursive scan
                                        keeps going past it instead of stopping here
issue new <title> [--description <text|->] [--label <l>] [--editor]
issue list [--all] [--status <s>] [--label <l>] [--json]
issue show <ref> [--json]
issue history <ref> [<field>]          every write to an LWW field, read-only
issue set <ref> <title|description|status|archived|deleted> <value|->  [--editor]
issue mv <ref> <status>
issue rm <ref> [--yes]                 delete: writes a tombstone, never unlinks
issue comment <ref> <body|->
issue label <ref> +bug -ui
issue share                            upgrade a private board back to a shared one
decision new --title <t> [--body <b>] [--disposition <d>]
decision list [--disposition <d>] [--json]
decision show <ref> [--json]
decision set <ref> <title|body|disposition|supersededBy> <value|-> [--editor]
decision history <ref> [<field>]       every write to a field, read-only
doctor [--fix]                         data health check; --fix repairs glued lines
studio [--port <n>]                    board on localhost; create, drag, edit, comment
workspace list|doctor|studio           cross-repo, read-only — see workspace below
workspace new <title> --in <path> [--description <text|->] [--label <l>] [--editor]
workspace set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
workspace mv <ref> <status>            <ref> full ULID only — see workspace below
workspace comment <ref> <body|->       <ref> full ULID only — see workspace below
workspace label <ref> +bug -ui         <ref> full ULID only — see workspace below
workspace rm <ref> [--yes]             <ref> full ULID only — see workspace below
workspace decision list|new|set|show|history   cross-repo Decisions — see workspace below
```

`nook decision` is a second, parallel log for Architecture Decision Records —
same append-only shape and `merge=union` guarantee, living in
`.gitnook/decisions/` alongside `.gitnook/issues/`, deliberately smaller (no
labels, comments, or archiving). It does not have a private mode of its own —
Sharing is one state for the whole `.gitnook/` directory, so `nook init
--private` and `nook issue share` cover both modules together. A Decision has
a `disposition` (`proposed`/`accepted`/`superseded`/`rejected`), not a
workflow `status`.

`-` as a value reads the value from stdin.

## studio

```bash
npx nook studio
```

The human interface, on `127.0.0.1`. Eight columns you drag issues between —
one per status, nothing more — and a drawer per issue for editing the title,
description, labels, status and comments. A header button and a `+` on each
column create an issue by title alone; the drawer lets you archive or delete
(delete writes the same tombstone `nook issue rm` does — the card leaves the
board, the file stays on disk). A theme switch offers light, dark and
follow-the-system.

Writes go through the same append-only log the CLI writes, so the CLI and
studio can be open at once; a two-second poll applies changes in place rather
than reloading the page. studio has no authentication and binds loopback
only — it is a single-machine, single-user tool, never meant to be shared
across a network.

## workspace

```bash
cd path/to/the/parent/folder
npx nook workspace list
```

A monorepo's packages, or a folder where a few unrelated repos just happen to
sit side by side — either way, `nook workspace` gives you one read-only view
across however many boards it finds under the current directory. It's a
**view**, not a new kind of storage: nothing is created, merged, or cached,
and every member board keeps its own log, actor identity and sharing state
exactly as if you'd opened it alone.

- `nook workspace list [--all] [--status <s>] [--label <l>] [--json]` — every
  member's issues, grouped by path, one table per member.
- `nook workspace doctor [--fix]` — the same health check `nook doctor` runs,
  once per member.
- `nook workspace studio [--port <n>]` — a landing page listing every member;
  clicking one starts that member's own, unmodified `nook studio`.

Six more subcommands write, each routed to the member it belongs to:

```
nook workspace new <title> --in <path> [--description <text|->] [--label <l>] [--editor]
nook workspace set <ref> <title|description|status|archived|deleted> <value|-> [--editor]
nook workspace mv <ref> <status>
nook workspace comment <ref> <body|->
nook workspace label <ref> +bug -ui
nook workspace rm <ref> [--yes]
```

`new` takes `--in <path>` since there's no existing ref to route by. The
other five take a ref — the **full 26-character ULID**, since a short prefix
that's unambiguous in one member's board can collide with an unrelated issue
in another. Semantics otherwise match the single-board commands exactly.

`nook workspace decision <list|new|set|show|history>` is the same idea
applied to Decisions instead of Issues:

- `nook workspace decision list [--disposition <d>] [--json]` — every
  member's decisions, grouped by path; same filter and empty-group semantics
  as `nook workspace list`.
- `nook workspace decision new --title <t> [--body <b>] [--disposition <d>]
  --in <path>` — create in the member at `<path>`; `--in` is required, no
  fallback to cwd, same as `nook workspace new`.
- `nook workspace decision set <ref> <title|body|disposition|supersededBy>
  <value|-> [--editor]` — write to whichever member owns `<ref>`; the full
  26-character ULID is required, same as `nook workspace set`.
- `nook workspace decision show <ref> [--json]` and `nook workspace decision
  history <ref> [<field>]` — detail view and write history for whichever
  member owns `<ref>`. These two have no single-board-`workspace` equivalent
  (there's no `nook workspace history`) — Decisions get both because looking
  up one ADR, or its write history, is a common cross-repo need.

## doctor

`nook doctor` checks the `.gitattributes` line that makes merging work —
delete it and issues start conflicting silently — and reports unparsable
lines, unknown operation types (ignored, not fatal), and **glued lines** (two
JSON objects spliced into one by a missing trailing newline). `doctor --fix`
repairs what it can.

## For agents

Paste this into your agent's instructions, skill file, or `CLAUDE.md`:

```
# nook

Git-native issue tracker. Issues are plain text files in the repo.

nook issue list [--all]          one line per issue: <ref> <status> <title> [labels]
nook issue show <ref>            title line, description, comments
nook issue history <ref>         every write to a field, with actor and lamport t
nook issue new "<title>"         create an issue
nook issue mv <ref> <status>     backlog todo queued in_progress review blocked done cancelled
nook issue comment <ref> "<body>"
nook issue label <ref> +bug -ui
nook issue set <ref> archived true

<ref> is any unambiguous ID prefix. Status takes prefixes too (que -> queued).
queued means requirements are settled: act without asking.
list hides archived, done and cancelled unless --all.
--json exists for scripts; the default table is cheaper to read.
```

The default output is a compact table, cheaper in tokens than the equivalent
JSON and just as easy for a model to read; `--json` stays for scripts that
genuinely need to parse.

`AGENT.md` ships with the package as the complete reference. Point any agent
at `node_modules/gitnook/AGENT.md`, or for Claude Code:

```sh
mkdir -p ~/.claude/skills/nook
ln -s "$PWD/node_modules/gitnook/AGENT.md" ~/.claude/skills/nook/SKILL.md
```

## Library first

The CLI is one caller of a public API, not the other way round:

```ts
import { openBoard } from 'gitnook';

const board = openBoard();                  // searches upward from cwd for .gitnook/issues/
const issue = board.create({ title: 'Fix login redirect', labels: ['bug'] });

board.apply(issue.id, { status: 'queued', labels: { add: ['p1'] } });
board.list({ status: 'queued' });
board.health();                             // what `nook doctor` reports
```

`Board` owns the whole CRDT — op generation, ordering, dedupe, OR-Set
bookkeeping, prefix resolution. A caller never sees an operation; you say
`{ labels: { add: ['bug'] } }` and add-wins is gitNook's problem. Also
exported: `openWorkspace`, `initBoard`, `diagnose`, `repair`, `serve`,
`serveWorkspace`, `STATUSES`, and a set of typed errors
(`RefNotFound`, `AmbiguousRef`, `InvalidStatus`, `BoardNotInitialized`, ...)
so a caller can tell "you can fix this" from "report a bug" with
`instanceof`.

## Known limits

- **`description` is last-writer-wins.** Concurrent edits keep one version;
  the loser is still in `nook issue history <ref>`, but re-instating it is a
  copy-paste by hand.
- **No cross-branch atomicity.** Two agents in two worktrees can pick up the
  same issue; both operations converge, but the work may be duplicated.
- **Short ids are unambiguous when printed.** A later issue can extend a
  shared ULID prefix, exactly as with git short hashes.

## Requirements

Node >= 22. No native module, no SQLite, no postinstall script, no
`git config` for anyone on the team.

## Contributing

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run bench         # size, cold start, merge and token-budget gates
npm run build         # tsup bundle + declarations + the studio assets
```

Always build with `npm run build` — never `npx tsup` on its own; it cleans
`dist/studio/`, which only `vite build` writes.

## License

MIT
