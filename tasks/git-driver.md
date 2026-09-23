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
**Decided 2026-09-23 (skymen):** anything c3merge can't be sure of is a conflict, shown
with localized markers (see DESIGN.md "Engine"):
1. Driver writes the merged file to `%A`: C3-formatted JSON, clean parts merged, each
   conflicting member/element wrapped in `<<<<<<< ours` / `=======` / `>>>>>>> theirs`
   lines. Picking either side (or both, for list elements) leaves valid JSON.
2. A readable summary (file, JSON path in C3 terms, what each side did) is appended to
   `.git/c3merge/conflicts.md` and printed to stderr.
3. Exit 1 when there are conflicts → git leaves the path unmerged. Exit 0 otherwise.
4. Parse failure on any side → git's own text merge (`git merge-file`), forwarding its
   exit code, so broken files behave exactly as without c3merge.
No `--prefer ours|theirs`: c3merge never picks a side for the user.

## rebase / cherry-pick / stash
All go through the same ll-merge path, so the driver fires. Verify: the collision log path
must be resolvable when cwd is the worktree root during rebase (it is). Add an integration
test that scripts `git rebase` over a fixture repo.

## Per-project vs per-machine (decided)
Attributes: per project, committed. Driver config: per machine (one line) or `--local`.
No global attributes file ever.
