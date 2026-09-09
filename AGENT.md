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
| `nook set <ref> <title\|description\|status\|archived> <value\|-> [--editor]` | update one field |
| `nook mv <ref> <status>` | status transition (the common case) |
| `nook comment <ref> <body\|->` | append a comment |
| `nook label <ref> +bug -ui` | add and remove labels |
| `nook doctor [--fix]` | data health; `--fix` repairs glued lines |
| `nook studio [--port <n>]` | localhost board for a human: drag, edit, comment |

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

**`queued` is an authorization boundary, not a category.** `backlog` and `todo` are the human lane; `queued` onward is the agent lane. An issue in `queued` means requirements are settled and **the agent may act without asking**. Do not move an issue into `queued` on your own initiative — that is the human granting permission.

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

## studio is the human's interface

`nook studio` opens a board on `127.0.0.1` where a person drags issues between the eight columns and edits them in a drawer. It writes into the same op-log the CLI writes, so both can be open at once — but it is **the human's lane**, not yours. Keep using the CLI.

It binds loopback only. It has no authentication, so reachability *is* write access; `--host` will never exist. Every op it writes is attributed to whoever's `git config user.email` is running it, so it must never be shared between people.

**If you are changing nook itself, three rules that break silently:**

- **The studio bundle must never be imported by the CLI entry point.** `dist/studio/studio.js` is ~380 KB. It is a static file on disk, read at request time by the server, and nothing on `src/cli/run.ts`'s import chain may reach it — not as a module, not as an inlined string. Import it and every single `nook list` pays to parse 380 KB it will never use, which is the whole cold-start budget (ADR-0008). `npm run bench` counts `react` / `createRoot` / `radix` / `tailwind` in the built `dist/cli/run.js` and must find zero.
- **Build with `npm run build`, never `npx tsup` alone.** tsup cleans the whole of `dist/`, including `dist/studio/`, which only `vite build` writes. Alone, it leaves a build that looks fine and a server with no assets to serve.
- **Dogfood nook with `node node_modules/gitnook/bin/nook.js`, never `npx nook`.** nook's own development is tracked on nook's own board, and the rule is that it uses the *published* version pinned in `devDependencies` — so the packaging path gets exercised too, not just the source. `npx nook` defeats that rule invisibly: npx prefers the bin **this project declares in its own `package.json`**, so `bin/nook.js`'s `import '../dist/cli/run.js'` resolves against the **working tree's** `dist/`, not `node_modules/gitnook/dist/`. The two `bin/nook.js` files are byte-identical and both outputs look plausible, so nothing signals the substitution — you exercise unreleased code while believing you are exercising the release. Run the two on a working tree that is ahead of the published version and they print different output; that difference is the whole reason the path is spelled out in full. The commands elsewhere in this guide are written as `nook …` for the general case — inside nook's own repo, run them through that full path. `npm run nook -- list --all` wraps it for convenience, but the rule is the path, not the script. An alias is deliberately not used: it adds a layer of indirection whose behaviour depends on the npm version.

## When something is wrong

`nook doctor` reports data health and exits non-zero when it finds anything. `--fix` repairs glued lines.

The line `.issues/issues/*.ndjson merge=union` in `.gitattributes` is the **single point of failure** — without it, concurrent edits start conflicting silently. `doctor` checks it and `list`/`show` warn when it is missing. That warning is never noise; `nook init` restores the line.
