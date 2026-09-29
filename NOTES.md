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


## Normal

- [core] A wrong `Functions.f(…)` argument count inside an expression (the function's parameters changed on the other side) is reported as a conflict but gets no marker: the `flagLeftovers` callback in `src/engine/merge.ts` only writes a hunk for the `parameters` key. Git marks the file conflicted while it looks clean. Mark the expression (`as merged` / `fix in C3`) (found in review, 2026-09-29)
- [driver] `c3merge finish` after a cherry-pick stops with "no merge in progress, and HEAD isn't a merge commit" (exit 2), yet README and `docs/merging.md` say to run it by hand after one: `mergePoints("manual")` in `src/finish.ts` only knows `GITHEAD_*`, `MERGE_HEAD` and a merge commit at HEAD. During a cherry-pick `CHERRY_PICK_HEAD` exists (its parent is the base); after one, git records nothing. Support the first, or fix the docs (reproduced 2026-09-28)

- [action] Release watch: a scheduled job tests each new C3 release once (lab rows + fidelity, against the last release that passed, in the same run) and opens an issue on a break, or comments on the open one ([tasks/release-watch.md](tasks/release-watch.md))

## Later

- [profiles] `rootFileFolders` (sounds, music, scripts, files…): an item added into a different folder on each side still comes out listed twice (the folder pass only covers the object, layout, sheet… trees): items get a different sid per side, and where their files live on disk isn't checked. An item moved between folders on one side and edited on the other gives a deleted/changed hunk plus a plain copy, and taking theirs lists it twice; `moves: true` on `**.items[]` would replay the move (2026-09-29)
- [profiles] A project-bar folder deleted on one side (its items moved to the parent) while the other side adds to it: taking theirs lists those items twice; `src/engine/folders.ts` doesn't see it (the folder is inside a hunk) (2026-09-29)
- [profiles] An addon's `usedAddons[].version` changed on both sides (upgraded to different versions): take the higher version, and when the addon is bundled, take that same side's `.c3addon` under `addons/` (a binary file git can't merge; the driver only sees JSON today, so this needs a rule for bundled addon files or the finish step). 6 conflicts in UTRS (`Mikal_3DObject`, `mikal_rotate_shape`) (skymen, 2026-09-27)
- [core] A set list with duplicate entries (family `members`, `usedAddons`) falls back to one whole-list conflict. Merge it as a set instead (duplicates collapse), at most a warning: C3 loads such a project and de-duplicates silently on r449-5, r495-2 and r503 (lab rows 36, 36b). 5 conflicts in Astral Ascent, 3 in con-sule (skymen, 2026-09-26)

- [action] Reusable workflow: `check` as a PR status + auto-resolve conflicts with the driver + "install c3merge" nudge comment (skymen will do it later, 2026-09-26) ([tasks/github-action.md](tasks/github-action.md))
- [driver] "Open it in C3" step after a merge, maybe on by default with an opt-out: catches what C3 refuses (biogun's `main` tip) and can settle merges across releases. 3–10 s on most projects with bundled addons trusted by c3cli (biogun: about a minute). Addons that aren't bundled: warn and point to `extraAddons/` next to the project's `project.c3proj`, or a `.c3mergeconfig`. Only the projects the merge changed, when a repo has several (skymen, 2026-09-27) ([tasks/open-in-c3.md](tasks/open-in-c3.md))
- [lab] After the next c3cli release: bump the c3cli dev dependency and drop `scripts/replay-merge.ts`'s workarounds (a worktree per open, a new `C3Editor` per open). c3cli now drops the real path on the editor instead of copying it into the browser, so a clone's `.git` costs nothing, and two opens on one editor work (UTRS repo root, 2026-09-26). The lab's rare `saveAs` failures on several tabs should go too (c3cli `check-saveas.ts`: 0 of 40)
- [driver] Add `git stash pop` to `test/driver.test.ts` (merge, rebase and cherry-pick are covered). Low stakes: merges are the case that matters (skymen, 2026-09-26)
- [dist] Plain binaries per OS (no Node needed), maybe a Homebrew tap: when c3merge is ready to ship to non-developers (skymen, 2026-09-26). No gh extension: it adds nothing over npm or a binary ([tasks/dist.md](tasks/dist.md))

## Ideas

- Real merges as golden files: store c3merge's output for every real merge (UTRS's 103 and the others) and fail when an engine change alters one. Local only (game content, gitignored). No need for now (skymen, 2026-09-26) ([tasks/test-corpus.md](tasks/test-corpus.md#golden-tests))
- `c3merge diff a.json b.json`: structural diff in C3 terms ("instance Player moved", "event 12 condition changed") — reuse the matching engine, useful in PRs. Together with a better conflict-resolution tool (visual or CLI): hugely important, future work (skymen, 2026-09-26)
- The resolver tool could bring both sides to the same C3 release first (open and save each side in C3 via c3cli), then reapply the diff: that catches the release format changes that make most of c3merge's conflicts on con-sule (403 → 159 once known), and the modify/delete files that are only a newer-release re-save ([tasks/release-migrations.md](tasks/release-migrations.md))
- `c3merge blame`-style: which branch introduced which event
- A tiny VS Code / GitHub PR renderer for the collision log
- Detect C3 "repaired on load" from the editor log and feed it back into the tolerance matrix automatically

## Notes

- A name reused on the renaming side (`X → Y` while `Z → X`, a swap, a new object with the old name) follows the object everywhere, no conflict: the other side's references meant their object (skymen, 2026-09-29).
- No CI on purpose: `npm test` runs before every publish (`prepublishOnly`), which is enough (skymen, 2026-09-26).
- The game's own version (`properties.version` in project.c3proj) changed on both sides stays a conflict (skymen, 2026-09-26).
- No parameter-by-parameter merge of an action or condition edited on both sides (C3 gives it a new sid each time, so c3merge sees "replaced differently"): too dangerous (skymen, 2026-09-26).
- c3merge won't learn C3's file-format changes between releases: no general rule exists short of tracking every release. Teams that stay on one release and upgrade together don't hit them (skymen, 2026-09-26; findings in [tasks/release-migrations.md](tasks/release-migrations.md)).
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
