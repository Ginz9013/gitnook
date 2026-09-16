# Changelog

All notable changes to gitNook are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, a minor bump may contain changes that would be
breaking after `1.0.0`. Any such change is listed under **Changed** or
**Removed** with what it means for you.

## [Unreleased]

The theme of this release is **`.gitnook/` — Issues and Decisions share one
container directory**, plus an opt-in recursive mode for `nook workspace`'s
scan.

### Changed

- **Breaking: the board's container directory is renamed.** `.issues/issues/`
  is now `.gitnook/issues/`, and `.decisions/decisions/` (if you have one) is
  now `.gitnook/decisions/`. Both modules live side by side under one parent
  now, but nothing about how an individual Issue or Decision is stored
  changes — the data format, marker subdirectory, and `merge=union` rule each
  stay independent per module, just relocated.

  **nook does not migrate existing boards for you.** nook never runs a git
  command that writes — an existing, deliberate policy — and a rename is no
  exception.

  **How to migrate:** from your repo root, run:
  ```
  git mv .issues/issues .gitnook/issues
  git mv .decisions/decisions .gitnook/decisions   # only if you have one
  ```
  then `nook init` once so it adds the `.gitnook/`-shaped `.gitattributes`
  lines (idempotent — it will not duplicate a rule that's already correct;
  the old `.issues/`/`.decisions/` lines are harmless leftovers it won't
  touch, remove them by hand if you want to tidy up) and commit the result.
  Until you migrate, `nook` on that repo reports `不是一個 Nook board` and
  points at `nook init`. The reverse also fails cleanly rather than silently:
  a pre-`.gitnook/` client (an older `nook` your teammate hasn't upgraded
  yet) pointed at an already-migrated repo gets the same kind of clean,
  named error (`不是一個 Nook board` from `list`, `MissingMergeDriver` from
  `doctor`) — never a silent misread of an empty board, never a crash.

- **Breaking: `nook issue init` and `nook decision init` are removed.**
  `nook init [--private] [--workspace]` is the single entry point now — one
  call creates (or idempotently completes) both `.gitnook/issues/` and
  `.gitnook/decisions/` and their `.gitattributes` lines, instead of two
  separate commands that were easy to run only one of and easy to get out of
  sync. Running either old form prints a message pointing at `nook init`.

### Added

- **`--workspace` on `nook init`.** Marks the directory in
  `.gitnook/config.json` (`{ "workspace": true }`) so `nook workspace`'s
  recursive scan continues past it instead of stopping the moment it finds a
  board there — for a directory that is itself a board *and* the parent of
  other boards. (The motivating case: a mistaken `nook init` at the root of a
  folder of 8 sibling repos silently hid all 8 from `nook workspace`, because
  the root's own board looked like "found it, stop here" to the scan.) The
  flag is additive-only — passing it sets the value to `true`; omitting it
  never resets an existing `true` back to `false`. There is no flag yet to
  turn it back off. Everywhere the flag isn't set, scanning keeps its
  existing behavior unchanged: find a board, stop looking underneath it.
- **`nook workspace decision list|new|set|show|history`** — the Decision
  side of `nook workspace`, symmetrical with the existing Issue subcommands.
  `list [--disposition <d>] [--json]` groups every member's decisions by
  path, same filter and empty-group semantics as `workspace list`; `new
  --title <t> [--body <b>] [--disposition <d>] --in <path>` creates in the
  member at `<path>` (`--in` required, no cwd fallback, same as `workspace
  new`); `set <ref> <title|body|disposition|supersededBy> <value|->
  [--editor]` writes to whichever member owns `<ref>` (full 26-character
  ULID required, same as `workspace set`); `show <ref> [--json]` and
  `history <ref> [<field>]` have no Issue-side `workspace` equivalent
  (there's no `nook workspace history`) but exist here because looking up
  one ADR, or its write history, across repos is a common cross-repo need.

## [0.5.1] - 2026-09-16

A small patch release: studio header/sidebar changes, no CLI or storage-format
change.

### Added

- **`nook studio`'s header now shows this board's Sharing state (Shared /
  Private) and whether this studio was launched from `nook workspace`
  (Standalone / Workspace).** Both badges sit to the left of the theme
  toggle and are always visible — you no longer have to infer "no badge
  means shared" from silence. `Sharing` is `/api/board-info`'s existing
  `inspectSharing()` answer; `fromWorkspace` is a new field on the same
  endpoint, set by `serveWorkspace()` when it launches a member's studio.

### Changed

- **Studio's sidebar now lists Decisions above Issues** (previously Issues
  above Decisions). No change to which view opens by default or how the
  choice persists.

## [0.5.0] - 2026-09-15

The theme of this release is **Decisions become a first-class peer of
Issues** — a second, parallel op-log for Architecture Decision Records, in
both the CLI and studio.

### Changed

- **Breaking: every Issue command now lives under `nook issue <verb>`.**
  `nook init`, `new`, `list`, `show`, `history`, `set`, `rm`, `mv`, `comment`,
  `label` and `share` are no longer top-level commands — run `nook issue init`,
  `nook issue new`, and so on instead. `doctor`, `studio` and `workspace` are
  unaffected; they stay at the top level. This makes room for `nook decision
  <verb>` (a second, parallel op-log for Architecture Decision Records) to sit
  alongside Issues as an equally first-class citizen, instead of Issue
  monopolizing the flat namespace by historical accident.

  **Why now, and why no alias:** the project is pre-1.0 (`0.x`), and this
  repo's own policy (top of this file) is explicit that a `0.x` minor bump may
  ship a change that would be breaking after `1.0.0`. Adding `nook decision`
  without first freeing up the namespace would have meant permanently
  asymmetric treatment — Issue flat, Decision nested — for two things the
  domain model treats as peers. There is no compatibility shim: a flat call to
  one of the eleven moved verbs (e.g. `nook new`) now fails immediately with a
  message naming the new form (`nook issue new`) rather than falling through to
  a generic "unknown command" guess.

  **How to migrate:** prefix every one of the eleven commands above with
  `issue` — in scripts, aliases, CI, and any agent skill file or `CLAUDE.md`
  snippet that invokes `nook` directly. `nook --help` is, as always, the live
  syntax reference if a flag or argument shape is in doubt.

### Added

- **`nook decision <init|new|list|show|set|history>`** — a second, parallel
  op-log for Architecture Decision Records, alongside Issues. Same
  append-only NDJSON-per-record shape and `merge=union` guarantee, its own
  `.decisions/` directory; deliberately smaller than Issue (no labels,
  comments, archiving, or private mode). `list` prints the same compact-table
  style as `nook issue list`, filterable with `--disposition`, and shows
  every Decision by default — there is no archived/done/cancelled-equivalent
  hidden by default. `set` writes `title`/`body`/`disposition`/
  `supersededBy` (plain-text, unvalidated against an existing ref); `history`
  is read-only, listing every write to a field (including `legacyRef`, set
  once during ADR migration and otherwise not writable through `set`) with
  its actor and lamport clock — there is no restore, matching Issue's own
  `history`. `nook doctor` now also checks `.decisions/`'s `merge=union` line
  whenever that directory exists (silent otherwise). A Decision has a
  `disposition` (`proposed`/`accepted`/`superseded`/`rejected`), not a
  workflow `status` — the two are different axes of meaning and are not
  interchangeable.
- **`nook studio` now has a top-level Issues/Decisions switch.** A
  collapsible sidebar on the left (replacing the single Issues-only header)
  swaps between Issue's existing kanban board and a new flat Decisions list —
  Decisions have no Status/Lane, so there is no kanban view for them. The
  chosen view persists across reloads (`localStorage`, same pattern as the
  theme toggle). Decisions get their own drawer (view/edit
  `title`/`body`/`disposition`/`supersededBy`, a read-only `legacyRef` badge
  when set) and the same change-history panel Issue already had, now
  generalized to serve both. Only one view's composition root is mounted at
  a time, so the view you're not looking at doesn't keep polling the server
  in the background. A fixed top header (logo, board path, branch, actor,
  theme toggle) now sits above the sidebar and is shared by both views.

## [0.4.1] - 2026-09-15

A small patch release: three visual bugs in studio, no behavior change.

### Fixed

- **Rendered markdown in studio (issue descriptions and comments) now has
  real typography styling.** `prose-sm` never did anything — the drawer never
  installed `@tailwindcss/typography`, and Tailwind v4's preflight resets
  headings, lists and blockquotes to plain, unstyled text, leaving only
  bold/italic visibly different. The plugin's colors are bound to the
  existing design tokens instead of `prose-invert`, so light/dark keep
  following the same palette automatically. The parser itself
  (`renderMarkdown`) was already correct; only the CSS was missing.
- **Studio's scrollbars are styled consistently across browsers.** macOS's
  native overlay scrollbar looked fine by default, but Windows' Chrome/Edge
  fell back to the default thick, square scrollbar because nothing
  overrode it. Both the Firefox `scrollbar-*` properties and the
  `::-webkit-scrollbar` pseudo-elements are now set, bound to the same
  `--border`/`--muted-foreground` tokens as everything else.
- **Label badges are visually distinct from the card again.** `--secondary`
  — the badge's only real consumer, in the board card and the drawer's label
  editor — sat within 0.03–0.035 lightness of `--card` in both themes, so a
  label nearly blended into the card it was on. The gap is now wide enough
  to read as a separate chip in both light and dark.

## [0.4.0] - 2026-09-14

The theme of this release is **workspace**: one view — and now one set of
write commands — across every board a parent folder contains, for a
monorepo's packages or a folder where a few unrelated repos just happen to
sit side by side. Nothing is merged or cached; every member board keeps its
own op-log, actor identity and sharing state exactly as if you had opened it
alone.

### Added

- **`nook workspace <list|doctor|studio>`** — read-only aggregation. `list`
  groups every member's issues by path, with the same filter flags as plain
  `list`, applied independently per member. `doctor` runs each member's
  health check once and labels every line with that member's path, so a
  diagnostic is never mistaken for the parent folder's own problem. `studio`
  opens a small landing page listing every member; clicking one starts (or
  reuses) that member's own, completely unmodified `nook studio` on its own
  port — boards are never merged into one screen.
- **`nook workspace <new|set|mv|comment|label|rm>`** — the same six write
  commands as a single board, routed to whichever member they belong to.
  `new` has no existing ref to route by, so it takes `--in <path>` instead —
  required, with no fallback to the current directory. The other five find
  their member by the ref alone, so **the ref must be the full 26-character
  ULID**: a short prefix that would resolve fine inside one board could
  silently mean a different issue in another, so it is refused outright
  rather than guessed at. Only `rm`'s confirmation prompt and final line name
  the member's path — the other five print exactly what the equivalent
  single-board command would, because you just supplied the ref (or `--in`
  path) yourself.
- **Discovery is a filesystem scan, not a config file or `.gitmodules`.** Any
  directory with `.issues/issues/` on disk counts as a member — submodule or
  not — found by walking down from the current directory and stopping at the
  first hit on each branch. It skips `.git` and `node_modules` by name, never
  follows a symlink, and never creates, merges, or infers a board (ADR-0012).
- **`openWorkspace()` and `serveWorkspace()`**, exported from the package
  entry point alongside the `Workspace`, `WorkspaceMember` and
  `OpenWorkspaceOptions` types — the library surface behind the CLI, for
  programmatic use. `locateInWorkspace()` and `memberAt()` — the functions
  that route a write to its owning member — stay internal to the CLI for now:
  they're plain functions taking a `Workspace`, not new methods on the
  `Workspace` type, precisely so that adding them to the already-public
  `Workspace` shape stays a choice for later rather than a commitment made
  today.

### Changed

- **All user-facing UI text is now English.** CLI runtime output (`--help`,
  error messages, `doctor`/`list` diagnostics, interactive prompts) and the
  studio frontend (buttons, `aria-label`s, dialogs, error banners) no longer
  mix in Traditional Chinese. Code comments, `CONTEXT.md`, ADRs and commit
  messages are unaffected — this is a UI-only change, not a project-language
  change. If you were matching on Chinese substrings in `nook`'s output
  (piping `list`/`doctor`/`--help` into something that greps for them), that
  match will now fail; match on the surrounding structure or the English text
  instead.
- **`nook --help`'s `workspace` row stays one line** (`workspace list
  [flags]`) even though nine subcommands exist now — the full command set is
  documented in `AGENT.md` and the README, not in the token-budget-gated
  `--help` text. A few neighbouring lines lost parenthetical asides to make
  room; no information was removed, only re-homed to context you already
  have after reading this file once.

### Internal

- **`CONTEXT.md` gained `Workspace`** as a defined domain term. `workspace`
  used to be listed only as a banned synonym for **Board** — now that ban
  points at this definition instead: a Board is not a workspace, and a
  workspace is not a Board.

## [0.3.0] - 2026-09-10

The theme of this release is **private mode**: a board that never enters git at
all, so you can adopt gitNook inside someone else's repository without asking
anyone first. What it buys is a **social footprint of zero** — not technical
compatibility, which plain `nook init` already had, since it only ever added one
directory and one line.

### Added

- **`nook init --private`** — creates the board and excludes it through
  `$GIT_DIR/info/exclude`, never your `.gitignore`, because that file is itself
  committed bytes. `.gitattributes` is not read and not written: an ignored
  op-log never merges, so `merge=union` is *unneeded* there rather than missing.
  Afterwards `git status --porcelain` and `git ls-files .issues` are both empty.
  It refuses, rather than writing a rule that would do nothing, when the op-logs
  are already tracked (a tracked path beats an ignore rule) or when there is no
  git work tree at all.
- **`nook share`** — the upgrade back to a shared board. Removes exactly the one
  line nook borrowed, leaving the rest of your `info/exclude` untouched, restores
  the `merge=union` line, and prints the `git add` **you** run. nook still runs
  no git command that writes. When a rule outside nook's control still ignores
  the board it exits 1 naming that rule, instead of printing a command git would
  reject.
- **`SharingMismatch`, a new `Diagnostic` kind** — `nook doctor` now speaks when
  the filesystem and git disagree about whether a board is shared. Three states,
  one kind, because the fix is the same in each: make the two agree. Op-logs
  tracked despite the exclude rule; a board that looks shared but is hidden by a
  broad ignore rule, so a colleague's clone would be empty; or nook's own rule
  present but overridden by a higher-precedence one. The last two carry git's own
  `<file>:<line>:<pattern>` verbatim, because that line number is not something
  this layer can invent.
- **`AlreadySharedBoard` and `NoGitDir` are exported from the package entry** —
  the two ways `initBoard(dir, { sharing: 'private' })` refuses, so callers can
  `instanceof` them like the other error types.
- **`initBoard(dir, { sharing })`** — the library entry point gained the
  parameter. There is one way to create a board; sharing is an argument to it.

### Changed

- **`DiagnosticKind` gained a member.** A TypeScript caller that switches
  exhaustively over it will stop compiling until it handles `SharingMismatch`.
  Under the 0.x rule at the top of this file, that is a minor bump.
- **`list`, `show` and `history` stay silent on a private board** about a missing
  `merge=union` line. On a shared board the warning is unchanged, word for word —
  and that is the point: a warning that fires where it does not apply teaches
  people to ignore it, and on a shared board it is never noise.
- **`nook doctor` is silent on a healthy private board**, exit 0. It suppresses
  that diagnostic only when the filesystem *and* git and the index all agree the
  op-logs are out of git; any disagreement is reported instead.
- **`nook --help`'s description column moved 14 characters left** to fit `share`
  inside the byte budget the agent-token gate holds it to. Same information,
  less padding.

### Internal

- **ADR-0011** records why the rule lives in `$GIT_DIR/info/exclude` rather than
  a committed `.gitignore`, why sharing state is derived on every read instead of
  stored, and why the fast path deliberately recognises only the exact line nook
  writes — git's own pattern precedence is the authority, and it lives in
  `doctor`, which may spawn a subprocess where `list` may not.
- The exclude rule is written as a **literal path**: gitignore metacharacters in
  the board's own path are escaped, so a board under `apps/[id]/` is actually
  ignored rather than matching `apps/i/`.

## [0.2.0] - 2026-09-10

The theme of this release is that **studio stopped being a read-only viewer**,
and that **deleting an issue became possible without ever unlinking a file**.

### Added

- **`nook rm <ref> [--yes]`** — deletes an issue by appending a `deleted`
  tombstone. The `.ndjson` file stays on disk byte for byte; `nook set <ref>
  deleted false` brings it back. Nothing is ever unlinked, because modify/delete
  is the one conflict `union` cannot merge (ADR-0009). Interactive runs confirm;
  non-TTY runs require `--yes`.
- **`deleted` as a fifth LWW field**, writable through `nook set <ref> deleted`,
  the library, and studio. Deleted issues leave every listing; `nook show` still
  answers for one, and says how to recover it.
- **`nook history <ref> [<field>]`** — read-only. Prints every write to an LWW
  field with its actor and lamport clock, so a value that lost a concurrent
  last-writer-wins fold is retrievable instead of merely present in the file.
- **`Board.opLog(ref)`** — the raw op-log for one issue, read-only. The only
  place on the public API that hands out `Op`; writing is still `Change`-only.
- **`Board.root()`** — the absolute path of the directory holding `.issues/`.
  Root-finding walks upward, so this can differ from the `dir` passed to
  `openBoard()`; callers no longer need to re-derive it.
- **`IssueDeleted` is exported from the package entry.** `board.apply()` throws
  it when a write targets a deleted issue, so callers can `instanceof` it like
  the other four error types.
- **studio is read-write.** Drag cards between columns (mouse and keyboard, via
  `@dnd-kit`), edit title, description, labels, status and comments in a drawer,
  create issues from the board header or any column, and archive or delete from
  the drawer. The `queued` authorization boundary is enforced in the UI.
- **studio, everything else** — light/dark design tokens, per-label filtering
  with a header that says how many cards it is hiding, collapsible columns
  (40px rails that still accept drops), horizontal panning by dragging empty
  board space, per-issue change history in the drawer, short ids on cards, and
  messages for the three states a board can be silent in.
- **Read-only HTTP endpoints** for studio's own use: `GET /api/board`,
  `/api/board-info`, `/api/history/<ref>`, plus `POST /api/issues` and
  `POST /i/<ref>` on the write side. A deleted issue answers `410 Gone`.
- **`npm run bench` gained two structural rows** — studio asset size and a
  check that no CLI bundle marker leaks into the shipped bundle — alongside the
  four hard metrics.

### Changed

- **`blocked` is now just a status.** The rule that moving an issue to `blocked`
  required a comment explaining why is gone — it was enforced in three places
  with three different behaviours. If you relied on that comment always
  existing, nothing enforces it any more.
- **"Zero runtime dependencies" is now scoped to the CLI**, and the README says
  so plainly: studio's frontend (React 19, Radix, Tailwind) is compiled ahead of
  time into `dist/studio/studio.{js,css}` and ships inside the tarball. Your
  `npm audit` cannot see that surface, so keeping it current is our job and
  shipping a fix means cutting a gitNook release. `dependencies` is still empty
  and still installs zero transitive packages.
- **`nook init` says what it did**, distinguishing its three outcomes instead of
  succeeding silently. `nook doctor` stays quiet when there is nothing wrong.
- **`nook studio` serves a React SPA** instead of server-rendered HTML. Assets
  are read from `dist/studio/` on disk at request time. It still binds
  `127.0.0.1` only, and `--host` is still deliberately absent.

### Fixed

- **CJK titles no longer break `nook list` alignment** — the compact table pads
  by display width, not character count.
- **`nook history` lists the title written by the `create` op**, which was
  previously filtered out, making the recovery path advertised for deletion
  incomplete.
- **`create` folding into a title write lives in one place** (`fieldWrites`),
  instead of being re-derived per reader.
- **Protocol-relative URLs no longer pass the markdown link allowlist.**
- **An unexpected exception in the server returns `500`** and logs one line to
  studio's terminal, instead of taking the process down.
- **studio's frontend distinguishes "cannot connect" from "the server answered
  with an error"**, quotes what the server actually said, and never silently
  drops an acknowledgement that fails to land on a snapshot.
- **Tailwind's scan is limited to `src/studio`**, so prose from the repo's
  markdown no longer leaks class names into the shipped CSS.

### Internal

- `lanes.ts` is gone: the board no longer assigns a default interpretation to
  any status (ADR-0010).
- CI runs `tsc --noEmit`, `vitest run` and `npm run bench` on Node 22 — the
  version in `engines` — so all six gates fail the build rather than a report.
- A forward-compatibility gate installs the published 0.1.0 as a dev dependency
  and proves an older reader still sees deleted issues. That pin must stay at
  `0.1.0`; bumping it turns the gate into "new reads new" and it stops proving
  anything.

## [0.1.0] - 2026-09-08

First published release. Git-native issue tracking with an append-only op-log
per issue, `merge=union` for conflict-free merges, the `nook` CLI, a read-only
`nook studio` board, and `openBoard()` as the library entry point.
