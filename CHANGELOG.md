# Changelog

All notable changes to gitNook are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is `0`, a minor bump may contain changes that would be
breaking after `1.0.0`. Any such change is listed under **Changed** or
**Removed** with what it means for you.

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
