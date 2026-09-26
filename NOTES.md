# c3merge — backlog

Structural, schema-aware 3-way merge + cross-file validator for Construct 3 projects,
shipped as a git merge driver, a `gh` extension and a reusable GitHub Action.
Design decisions live in [DESIGN.md](DESIGN.md). Each item links a detail doc in
[`tasks/`](tasks/) where one exists. Sibling project: `~/Documents/c3cli` (drives the C3
editor; c3merge's lab experiments and CI checks depend on it).

Tags: `[core]` generic keyed 3-way merge engine · `[profiles]` per-file-kind schema knowledge ·
`[check]` cross-file validator · `[driver]` git integration · `[cli]` command surface ·
`[gh]` gh extension packaging · `[action]` GitHub Actions workflow · `[lab]` experiments
against the real editor (via c3cli) · `[corpus]` fixtures and golden tests · `[dist]`
packaging/release · `[docs]`

## Now

- [core] Renames carried across sides: when a renamed type's old name is reused on the same side (`X → Y` and `Z → X`), the other side's new `X` references are ambiguous → make it a conflict (skymen, 2026-09-24; important, needs investigating first, 2026-09-26). Signature changes adapt calls neither side touched (a stale extra argument dropped): maybe warn

## Normal

- [check] After a merge: the driver only reminds people to run `check` (it can't tell which file is last). Group "type X doesn't exist" findings (one per instance today) ([tasks/check-validator.md](tasks/check-validator.md#when-to-run))
- [driver] `c3merge resolve <file> --ours|--theirs`: take one side at every ours/theirs marker, keeping everything that merged cleanly (VS Code's "Accept All Current/Incoming" from the command line). Leave markers with other labels (`renamed (check)`, `fix in C3`, `keep both`). Small: a wrapper over `takeSide`, which every engine test case already runs; add one CLI test, since skymen won't test it by hand (2026-09-26)
- [action] Release watch: a scheduled job tests each new C3 release once (lab rows + fidelity, against the last release that passed, in the same run) and opens an issue on a break, or comments on the open one ([tasks/release-watch.md](tasks/release-watch.md))

## Later

- [action] Reusable workflow: `check` as a PR status + auto-resolve conflicts with the driver + "install c3merge" nudge comment (skymen will do it later, 2026-09-26) ([tasks/github-action.md](tasks/github-action.md))
- [action] Optional "open it in C3" step (c3cli) after the merge, for what `check` can't see (lab row 11, action/condition ids per addon: too much work to check statically). Too slow for the local driver (10 s to minutes, usually to find nothing): Action only, or opt-in. Low priority (skymen, 2026-09-26)
- [driver] Add `git stash pop` to `test/driver.test.ts` (merge, rebase and cherry-pick are covered). Low stakes: merges are the case that matters (skymen, 2026-09-26)
- [dist] Plain binaries per OS (no Node needed), maybe a Homebrew tap: when c3merge is ready to ship to non-developers (skymen, 2026-09-26). No gh extension: it adds nothing over npm or a binary ([tasks/dist.md](tasks/dist.md))

## Ideas

- Real merges as golden files: store c3merge's output for every real merge (UTRS's 103 and the others) and fail when an engine change alters one. Local only (game content, gitignored). No need for now (skymen, 2026-09-26) ([tasks/test-corpus.md](tasks/test-corpus.md#golden-tests))
- `c3merge diff a.json b.json`: structural diff in C3 terms ("instance Player moved", "event 12 condition changed") — reuse the matching engine, useful in PRs. Together with a better conflict-resolution tool (visual or CLI): hugely important, future work (skymen, 2026-09-26)
- `c3merge blame`-style: which branch introduced which event
- A tiny VS Code / GitHub PR renderer for the collision log
- Detect C3 "repaired on load" from the editor log and feed it back into the tolerance matrix automatically

## Notes

- No CI on purpose: `npm test` runs before every publish (`prepublishOnly`), which is enough (skymen, 2026-09-26).
- Merges are the case that matters: that's where real work on both sides meets and git fails. Rebase, cherry-pick and stash are usually done where git already does fine (skymen, 2026-09-26).
- UID collisions (both branches handing out the same next uid) and the renumbering they cause are legacy: current C3 gives new instances random UIDs (skymen, 2026-09-24). Don't design around them: if two different instances ever share a uid, C3 keeps both and gives the one it loads first a free uid (lab, all three releases, `tasks/lab-experiments.md`). `check` doesn't need to support the old flat, lowercased project layout either.
- Verified in the r500 editor bundle: the only URL params are `project`/`layout`/`eventsheet`
  (dev-mode only, loads `exampleProjects/debug/*.capx`), `#open-example-browser`, and flags
  (`safe-mode`, `debug`, `log-pane`, `perf`, `firstrun`, `slow-animations`, ...). There is no
  public open-from-URL. Opening must go through drop / file pickers / launchQueue / internal
  API — that's c3cli's job.
- Git never prompts for a missing merge driver: unknown `merge=c3` silently falls back to
  text merge. So `.gitattributes` is safe to commit everywhere; the one-time per-machine step
  is the `merge.c3.driver` config line. The GitHub Action nudge comment is the "recommended
  extension" equivalent.
- GitHub's PR merge button does not run merge drivers; conflicts resolve locally or via the
  Action.
- Existing prior art to read once, then ignore: `Under The Red Sky/tools/c3merge/c3merge.py`
  (one-off, Sep 2026). Confirms uid/sid/name keying works on real data; has one-off rules
  (BFC, OURS_KEYS) that must not carry over.
