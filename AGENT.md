---
name: nook
description: Operate the nook CLI — a git-native issue tracker whose issues are plain text files in the repo. Use when the working directory (or any parent) has a .issues/ directory, when the user asks to create, list, update, comment on, or close issues, when they mention a board, a ticket, or nook itself, or when a task should be recorded rather than only done. Covers every command, the queued authorization boundary, ref handling, and what nook deliberately refuses to do.
---

# nook — agent usage guide

Point any coding agent at this file. It is plain Markdown; the YAML header above
is metadata some tools read and others ignore.

Issues are plain text files in the repo. They travel with the branch, merge without conflicts, and are readable by `cat`. There is no server and no account.

`nook --help` is the live syntax reference — prefer it over this file when they disagree.

## Before anything

`nook` finds the board by searching **upward** from the current directory, so any subdirectory of the repo works. If a command says `不是一個 Nook board`, the repo genuinely has no board — run `nook init` **at the repo root**, never in a subdirectory (it refuses there, but do not make it refuse).

## Commands

| | |
|---|---|
| `nook init` | create `.issues/` and the `.gitattributes` line |
| `nook new <title> [--description <text\|->] [--label <l>] [--editor]` | create; prints the **full 26-char ref** |
| `nook list [--all] [--status <s>] [--label <l>] [--json]` | one line per issue |
| `nook show <ref> [--json]` | title, description, comments |
| `nook history <ref> [<field>]` | every write to a LWW field, with actor and lamport `t` — read-only |
| `nook set <ref> <title\|description\|status\|archived\|deleted> <value\|-> [--editor]` | update one field |
| `nook rm <ref> [--yes]` | delete; confirms first, so `--yes` is required off a TTY |
| `nook mv <ref> <status>` | status transition (the common case) |
| `nook comment <ref> <body\|->` | append a comment |
| `nook label <ref> +bug -ui` | add and remove labels |
| `nook share` | upgrade a private board back to a shared one; prints the `git add` **you** run (or exits 1 naming the rule that still ignores it) |
| `nook doctor [--fix]` | data health; `--fix` repairs glued lines |
| `nook studio [--port <n>]` | localhost board for a human: drag, edit, comment |
| `nook workspace list\|doctor\|studio` | cross-repo, read-only — see "workspace: writes route to a member" below |
| `nook workspace new <title> --in <path> [--description <text\|->] [--label <l>] [--editor]` | create in the member at `<path>`; prints the full 26-char ref |
| `nook workspace set\|mv\|comment\|label\|rm <ref> ...` | write to whichever member owns `<ref>` — **`<ref>` must be the full 26-char ULID**, no short prefix; see below |

**Whether a board is shared or private is the human's decision, not yours.** `nook init --private` keeps a board out of git entirely — zero committed bytes, so nobody on the team has to be told about it yet — and `nook share` puts it back. Both change what everyone else can see, so never run either on your own initiative — the same rule as `queued`, though not the same shape: `queued` is a grant the human makes, while here there is no granting form at all, just the prohibition. If the human asks for one of them, run it and hand them what it prints, because nook runs no git command that writes. `share` exits 1 without printing any `git add` when a rule outside nook's control (a committed `.gitignore`, usually) still ignores the board — that message names the file and line, and removing it is the human's call too.

`<value>` and `<body>` accept `-` to read stdin — **use this for anything multi-line**. Shell-escaping a markdown body is a bug source; piping is not.

## Refs — the thing that trips agents up

Two representations, deliberately different:

- **`nook new` prints the full 26-character ULID.** That is the only permanently valid ref. **Store this one**, pass it to later commands, put it in commit messages.
- **`list` / `show` / the board print a short prefix** computed against the board *at that moment*. It is correct on screen and may stop being unique later.

A ULID's first 10 characters encode the timestamp, so **everything created in the same ~17-minute window shares its first 6 characters**. A short ref copied out of `list` and used an hour later can resolve to several issues.

> Anything stored, pasted elsewhere, or passed across time must be the full ULID.

`<ref>` accepts any unambiguous prefix and is case-insensitive. Ambiguity is a clean error listing the candidates — never a silent wrong match.

## Status

```
backlog  todo  queued  in_progress  review  blocked  done  cancelled
```

Fixed; not configurable. Prefixes work (`que` → `queued`, `in_p` → `in_progress`).

**`queued` is an authorization boundary, not a category.** An issue in `queued` means requirements are settled and **the agent may act without asking**. Do not move an issue into `queued` on your own initiative — that is the human granting permission.

That boundary lives in this convention and nowhere else. **The board draws nothing for it** — in `nook studio` the `queued` column looks and behaves exactly like the other seven, and moving a card into it is an ordinary drag. Columns carry no meaning beyond the one you and the human agree on (ADR-0010). So do not read a status as permission to do anything other than what this file says.

`archived` is a separate boolean field, not a status — it is visibility, orthogonal to `done`/`cancelled`. Use `nook set <ref> archived true`.

## Output and exit codes

Data goes to **stdout**, errors and warnings to **stderr**.

| exit | meaning |
|---|---|
| 0 | success |
| 1 | user error — the message says what to fix |
| 2 | internal error — a nook bug worth reporting |

`list` hides `archived`, `done` and `cancelled` by default; `--all` shows everything, and naming a status explicitly overrides the default hiding.

**Read the default table, not `--json`.** The table carries the same information in about half the bytes and parses fine. `--json` exists for programs that need structured fields.

## Working patterns

**Pick up work**: `nook list --status queued` → take one → `nook mv <full-ref> in_progress`.

**Record progress worth keeping**: `nook comment <ref> -` with the body on stdin. Comments are the only discussion surface and they survive merges.

**Finish**: `nook mv <ref> review` for human sign-off, or `done` when the work speaks for itself.

**A task the user described but nobody wrote down**: `nook new` it. That is the whole point of the tool being in the repo.

## What nook deliberately refuses

There is no assignee, priority, milestone, due date, estimate, sub-task, custom status, or search UI. **Do not simulate them.** Priority is expressed with labels (`+p1`). Ownership is in `git log`. Refusing to become a project-management tool is the design, not a gap — if the user wants one of these, say so rather than inventing a convention.

Checkboxes inside a description are plain text. They are not sub-tasks and nothing tracks them.

**Deleting never removes a file.** `nook rm <ref>` — and its plain form `nook set <ref> deleted true` — appends a tombstone to the op-log and stops there. The `.ndjson` file stays on disk, `nook list` and `nook list --all` both stop listing the issue, `nook show` on it exits 1, and `nook set <ref> deleted false` brings it back. Nothing in nook unlinks an issue file. That is deliberate: a modify/delete pair is the one conflict `merge=union` cannot resolve, so a branch that edits an issue another branch deleted would conflict — which is the exact failure this tracker exists to avoid (ADR-0009).

**`nook rm` confirms before it writes**, and off a TTY it refuses rather than waiting — an agent pipeline is never a TTY, so pass `--yes` when you mean it. Deleting the wrong ref is cheap to make and expensive to notice; the content is still recoverable with `nook history <ref>`, which lists every write to a field — including the title the create op wrote, and including on a deleted issue. Comments and labels are not fields, so they are not in that listing; they are still in the `.ndjson`.

## studio is the human's interface

`nook studio` opens a board on `127.0.0.1` where a person drags issues between the eight columns and edits them in a drawer. The eight columns are the eight statuses and nothing more — no lanes, no gates, no column that means something the status does not (ADR-0010). It writes into the same op-log the CLI writes, so both can be open at once — but it is **the human's surface**, not yours. Keep using the CLI.

It binds loopback only. It has no authentication, so reachability *is* write access; `--host` will never exist. Every op it writes is attributed to whoever's `git config user.email` is running it, so it must never be shared between people.

**If you are changing nook itself, three rules that break silently:**

- **The studio bundle must never be imported by the CLI entry point.** `dist/studio/studio.js` is ~380 KB. It is a static file on disk, read at request time by the server, and nothing on `src/cli/run.ts`'s import chain may reach it — not as a module, not as an inlined string. Import it and every single `nook list` pays to parse 380 KB it will never use, which is the whole cold-start budget (ADR-0008). `npm run bench` counts `react` / `createRoot` / `radix` / `tailwind` in the built `dist/cli/run.js` and must find zero.
- **Build with `npm run build`, never `npx tsup` alone.** tsup cleans the whole of `dist/`, including `dist/studio/`, which only `vite build` writes. Alone, it leaves a build that looks fine and a server with no assets to serve.
- **Dogfood nook with `node node_modules/gitnook/bin/nook.js`, never `npx nook`.** nook's own development is tracked on nook's own board, and the rule is that it uses the *published* version pinned in `devDependencies` — so the packaging path gets exercised too, not just the source. `npx nook` defeats that rule invisibly: npx prefers the bin **this project declares in its own `package.json`**, so `bin/nook.js`'s `import '../dist/cli/run.js'` resolves against the **working tree's** `dist/`, not `node_modules/gitnook/dist/`. The two `bin/nook.js` files are byte-identical and both outputs look plausible, so nothing signals the substitution — you exercise unreleased code while believing you are exercising the release. Run the two on a working tree that is ahead of the published version and they print different output; that difference is the whole reason the path is spelled out in full. The commands elsewhere in this guide are written as `nook …` for the general case — inside nook's own repo, run them through that full path. `npm run nook -- list --all` wraps it for convenience, but the rule is the path, not the script. An alias is deliberately not used: it adds a layer of indirection whose behaviour depends on the npm version. **That rule inverts for `studio`.** `node_modules/gitnook` is a symlink to the published package, so that path serves the *published* studio bundle: change anything under `src/studio/` and it shows you the old frontend while looking entirely normal — you verify nothing about your own work. To see your own studio changes, run `npm run build` and then `node bin/nook.js studio`.

## workspace: writes route to a member

`nook workspace <list|doctor|studio|new|set|mv|comment|label|rm>` operates across however many boards it finds under the current directory, not just the one `nook` would find by searching upward. Use it when you are asked to look across a monorepo's packages, or a parent folder with several repos side by side, instead of `cd`-ing into each one and running the single-board command yourself. It never creates, merges, or infers a board — only boards that already exist (`.issues/issues/` already on disk) show up, grouped by path.

- `nook workspace list [--all] [--status <s>] [--label <l>] [--json]` — every member's issues, grouped by path; the filter flags mean exactly what they mean for plain `list`, applied independently per member.
- `nook workspace doctor [--fix]` — `nook doctor`'s health check run once per member, each line labelled with that member's path; any member unhealthy exits 1.
- `nook workspace studio [--port <n>]` — a landing page listing every member; opening one starts that member's own, unmodified `nook studio` on its own port.
- `nook workspace new <title> --in <path> [--description <text\|->] [--label <l>] [--editor]` — create in the member at `<path>`. `--in` is **required**, with no fallback to the current directory; if you are already inside a member, use plain `nook new` instead.
- `nook workspace set <ref> <field> <value\|-> [--editor]`, `mv <ref> <status>`, `comment <ref> <body\|->`, `label <ref> +bug -ui`, `rm <ref> [--yes]` — same fields, same validation, same TTY rules as the single-board commands, just aimed at whichever member owns `<ref>`.

**`<ref>` must be the full 26-character ULID for `set`/`mv`/`comment`/`label`/`rm` — a short prefix is refused, not guessed at.** A prefix that is unambiguous inside one member's board can still collide with an unrelated issue in a different member, so unlike plain `nook`, `workspace` never resolves a prefix across boards. Always store and pass the full ref here, same discipline as "Refs" above.

`set`/`mv`/`comment`/`label` print exactly what the single-board command would print — no member path attached, because you already named the ref (or, for `new`, the `--in` path) yourself. `rm` is the one exception: its confirmation prompt and its final line both name the member's path, because the rescue step (`nook workspace set <ref> deleted false`) needs that path to `cd` into — there is no workspace `history`, so the message also tells you to `cd` in and run plain `nook history <ref>`.

**The `queued` boundary applies here exactly as it does to plain `nook mv`.** `nook workspace mv <ref> queued` is the same authorization grant as `nook mv <ref> queued` — do not move an issue into `queued` under `workspace` on your own initiative any more than you would in a single board. Nothing about routing through a member changes who is allowed to decide that. `doctor --fix` under `workspace` repairs file-level data integrity the same way `nook doctor --fix` does for one board — that is not the kind of write `queued` is about, and it needs no more asking than the single-board form does.

## When something is wrong

`nook doctor` reports data health and exits non-zero when it finds anything. `--fix` repairs glued lines.

The line `.issues/issues/*.ndjson merge=union` in `.gitattributes` is the **single point of failure** — without it, concurrent edits start conflicting silently. `doctor` checks it and `list`/`show` warn when it is missing. **On a shared board that warning is never noise**; `nook init` restores the line.

It does not apply on a private board, and nook deliberately stays quiet there: a board excluded from git never merges, so there is nothing for `merge=union` to guarantee — the guarantee is *unneeded*, not *missing*. Silence from `list`/`show` and from `doctor` on such a board is the correct output, not a swallowed problem. `nook share` is what makes the guarantee relevant again, and it restores the line as it goes.
