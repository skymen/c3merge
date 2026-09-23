# Git merge driver integration

**Status:** not started (2026-09-21)

## Protocol
Git runs `driver` with `%O` base, `%A` ours (result written here), `%B` theirs, `%P` path,
`%L` conflict-marker size (unused), cwd = worktree root. Temp files, no extension; kind
detection must use `%P`, not the temp names.

## Commands
- `c3merge merge-driver O A B P` — the driver.
- `c3merge install [--local]` — writes `merge.c3.name` and `merge.c3.driver` to global (or
  local) git config, plus `merge.ours.driver true` for the uistate fallback. Idempotent.
- `c3merge init` — writes/updates `.gitattributes` in the current repo from the template
  below (merges into existing file, keeps user lines) and adds the Action workflow file if
  `.github/workflows` exists and the user says yes. Also `.gitignore` suggestion for uistate.
- `c3merge doctor` — checks: binary on PATH, config line present and pointing at this
  binary, `.gitattributes` present in repo, git version ≥ 2.x, prints fixes.

## Attributes template
```gitattributes
# Construct 3 — structural merges via c3merge (https://github.com/skymen/c3merge)
*.c3proj              merge=c3
eventSheets/**/*.json merge=c3
layouts/**/*.json     merge=c3
objectTypes/**/*.json merge=c3
families/**/*.json    merge=c3
timelines/**/*.json   merge=c3
*.uistate.json        merge=ours
```
Also worth shipping in the template: `*.png binary` etc. (git detects, but explicit is
cheap), and `* text=auto eol=lf` so C3's `\n` output doesn't get CRLF-mangled on Windows —
this alone removes a class of spurious whole-file diffs.

## Conflicts
JSON can't carry conflict markers and still be a project C3 can open. Contract:
1. Driver always writes a **loadable** best-effort merge to `%A`.
2. Collisions appended to `.git/c3merge/collisions.md` with JSON path, kind, base/ours/theirs
   excerpt, and which side was chosen. Summary line on stderr.
3. Exit 1 when collisions exist → git leaves the path unmerged in the index. User reads the
   log, optionally edits in C3 (the file loads!), then `git add`.
4. Exit 0 otherwise.
5. Parse failure on any side → run `git merge-file -p` semantics ourselves (text merge) and
   forward its exit code, so behaviour equals git's default for broken files.

`--prefer ours|theirs` env/config (`c3merge.prefer`) for scripted merges (the Action uses
`theirs`? no — the Action resolves base→PR, so PR side is ours; it uses `ours`).

## rebase / cherry-pick / stash
All go through the same ll-merge path, so the driver fires. Verify: the collision log path
must be resolvable when cwd is the worktree root during rebase (it is). Add an integration
test that scripts `git rebase` over a fixture repo.

## Per-project vs per-machine (decided)
Attributes: per project, committed. Driver config: per machine (one line) or `--local`.
No global attributes file ever.
