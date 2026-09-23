# Git merge driver integration

**Status:** implemented (2026-09-23): `src/driver.ts`, commands `merge-driver`, `install
[--local]`, `init`, `doctor`. Tests: `test/driver.test.ts` runs real `git merge`, `rebase` and
`cherry-pick` in throwaway repos (driver installed `--local`). End to end:
`scripts/replay-merge.ts <repo> <merge>` replays a real merge in a clone, with and without
the driver, then runs `check` on both parents and the result; `scripts/fidelity.ts` merges
two lab-base branches and has C3 open and re-save the result (opens cleanly on r495-2; the
save differs only by C3's own r449 → r495 upgrade).

## As built (2026-09-23)
- Project context (renames, what types gained): built from git when the driver can tell
  which commits are merged (`GITHEAD_<sha>` for merge, `.git/rebase-merge/done` for rebase),
  cached in `.git/c3merge/context.json` per (base, ours, theirs). Tested with a real merge
  and rebase where one branch renames an object type and the other adds instances of it.
  `85c85d2a` replayed: 9 conflicted files with git alone, 3 with c3merge (8 conflicts on
  one layout, all C3 float noise; 2 layouts ours deleted, git's own modify/delete).
- JSON outside the C3 kinds (`files/`, `scripts/`, skymen): git's line merge first; kept
  when clean and still valid JSON, otherwise the structural merge with default rules, in
  the file's own style. Other files there (JS, images...) are never routed to c3merge.
- A side that isn't valid JSON: git's own text merge (`git merge-file`), same as without
  c3merge.
- `.git/c3merge/conflicts.md` starts over for each operation (HEAD + MERGE_HEAD etc.), and
  lists conflicts and order warnings with readable locations
  (`layers[Layer 0].instances[Sprite#2].world.x`). The reminder to run `c3merge check` is
  printed once per operation.
- `install` writes an absolute command (node + script), since git GUIs often lack PATH.
  Attributes patterns use `**/` so the project can live in a subfolder of the repo.
- Real replays (Under The Red Sky): merges c3merge finishes cleanly introduced 0 new
  `check` problems (a87cb1fc, c11d069e, 26e23f58, 10048c82, 76c5052b, 6c29f099; every
  problem found was already on a parent). `85c85d2a` shows why `check` must run after a
  merge: an object type renamed on one side (same sid), new instances with the old name on
  the other.
- In C3: `a87cb1fc` merged by c3merge opens on r449-5 exactly like its first parent (Under
  The Red Sky is LTS-only: SDK v1 addons; on stable it stops at missing addons). Open from
  a worktree, not a clone's root: c3cli stages the `.git` directory too (c3cli backlog).

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

## Finish step
**Status:** implemented (2026-09-24): `src/finish.ts`, `c3merge finish [--after merge|rebase]`;
`c3merge init` installs the hooks in the clone; `doctor` reports missing hooks.
A rename on one side must reach every file, but git only calls the driver for files both
sides changed; a file only one side changed is taken as is (skymen: fix it right after the
merge, before any commit, since they reopen C3 to check before committing).
- Hooks (git 2.50 has no config-based hooks, so they go in each clone's `.git/hooks`, as a
  `# c3merge begin/end` block appended to any existing hook):
  - `post-index-change`: runs right after a merge writes its result, clean or conflicted,
    with `1` as first argument and `GITHEAD_<theirs>` in the environment (MERGE_HEAD isn't
    written yet). Other index writes (`status`, `add`) have neither: the shell test skips
    them without starting node.
  - `post-rewrite` with `rebase`: once at the end of a rebase.
  - A repo with `core.hooksPath` (husky and co., often committed): `init` doesn't write
    there and prints the lines to add.
  - A single cherry-pick is not covered (nothing identifies it); `c3merge finish` by hand.
- `finish`: renames = sids whose name changed between the common ancestor (merge-base of
  HEAD and GITHEAD/MERGE_HEAD, of ORIG_HEAD and HEAD after a rebase, or of a merge commit's
  parents) and the object types on disk; applied to every event sheet, layout, family and
  the project file that isn't still conflicted (same rules as the engine; unsure
  expressions are listed, not touched). Rewritten files stay uncommitted. Then `check`.
- Images: C3 names them after their object (`<type>-<animation>-<NNN>.<ext>`, `<type>.<ext>`,
  lowercase). Git already follows an image the renaming side renamed, with the other side's
  pixel edits (tested); frames the other side *added* keep the old prefix, so `finish`
  renames them (never over an existing file; that case is reported).
- On a clean merge git commits its own result first, so the fixes come on top of the merge
  commit, uncommitted.
- Verified: `test/driver.test.ts` (clean merge, rebase, merge stopped on a conflict: a new
  layout with instances of a type the other side renamed). Replay of `85c85d2a`: the step
  fixed MT2-2, Subhub-Trials1 and Subhub-Trials2, the three files the person repaired by
  hand in "merge fix" `46e44c7f`; no reference to `TiledShapeDark` left.
