---
name: nook
description: Operate the nook CLI — a git-native issue tracker whose issues are plain text files in the repo. Use when the working directory (or any parent) has a .issues/ directory, when the user asks to create, list, update, comment on, or close issues, when they mention a board, a ticket, or nook itself, or when a task should be recorded rather than only done. Covers every command, the queued authorization boundary, ref handling, and what nook deliberately refuses to do.
---

# nook

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
| `nook set <ref> <title\|description\|status\|archived> <value\|-> [--editor]` | update one field |
| `nook mv <ref> <status>` | status transition (the common case) |
| `nook comment <ref> <body\|->` | append a comment |
| `nook label <ref> +bug -ui` | add and remove labels |
| `nook doctor [--fix]` | data health; `--fix` repairs glued lines |
| `nook studio [--port <n>]` | localhost read-only board for meetings |

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

**`blocked` requires a comment saying why.** Setting it without one prints a reminder. Always pair them:

```bash
nook comment <ref> "waiting on the upstream API fix"
nook mv <ref> blocked
```

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

There is no assignee, priority, milestone, due date, estimate, sub-task, custom status, search UI, or editable GUI. **Do not simulate them.** Priority is expressed with labels (`+p1`). Ownership is in `git log`. Refusing to become a project-management tool is the design, not a gap — if the user wants one of these, say so rather than inventing a convention.

Checkboxes inside a description are plain text. They are not sub-tasks and nothing tracks them.

## When something is wrong

`nook doctor` reports data health and exits non-zero when it finds anything. `--fix` repairs glued lines.

The line `.issues/issues/*.ndjson merge=union` in `.gitattributes` is the **single point of failure** — without it, concurrent edits start conflicting silently. `doctor` checks it and `list`/`show` warn when it is missing. That warning is never noise; `nook init` restores the line.
