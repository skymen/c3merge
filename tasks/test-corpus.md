# Fixture corpus and golden tests

**Status:** step 1 done (2026-09-23).
- Hand-made: `test/cases.ts`, 39 cases on the real lab-base files (edits for ours/theirs,
  expected result, or expected conflicts plus what taking ours/theirs must give). They
  pin the engine rules down before the engine exists.
- Real: `scripts/extract-triples.ts <repo> --name utrs` extracts every merge's
  base/ours/theirs/actual for C3 files changed on both sides, read-only. Output in
  `fixtures/real/` (gitignored: game content). UTRS: 103 merges, 972 files.

## What git does on the UTRS history (2026-09-23)
Of the 972 files changed on both sides, 36 were added on both sides (no base). Of the 936
with a base, git's line merge conflicts on 96: layouts 62/521, c3proj 17/67, event sheets
13/75, families 2/4, object types 2/269. Every clean git merge was valid JSON with no
duplicate instance uids. Typical conflicts:
- c3proj: both branches added object types/layouts at the end of the same folder `items`
  list (the dominant case).
- event sheets: both sides replaced the same condition, each with a new sid.
- layouts: mass sid changes (e.g. 855 hunks in `mainHub.json` from `instanceFolderItem`
  sids).
### What went wrong when people resolved them (2026-09-23)
Git doesn't record conflicts, so this compares git's merge of each triple with what was
committed, plus the later "merge fix" commits:
- 4 merges committed an **invalid** `project.c3proj` (`0373af85`, `bed9c447`, `685afb0b`,
  `9d716e63`): a comma lost while hand-resolving an `items` conflict. Fixed later by
  `7cd4557b`, `85b36d91`, `b371a45e`, `f2a6dbd7`.
- Duplicated or stale folder items after a merge (`SpecialSpawner` twice in `a96c8918`;
  `redFlah`, `testSkin`, `footstepDecal*` removed later by hand).
- 18 conflicted files were resolved by taking one side whole, several losing the other
  side's work: a script action (`4574bec8` E_game), an include (`e4beedbc` I_game), a
  layout entry (`3ddb5929`), effect settings, 3D instance values (`17afe017`, followed by
  "merge fix" `46e44c7f`).
- Big layout rewrites in "merge fix" commits (`0aff1bfb`, `a5708d20`, `06d14f43`, all
  `Testing Grounds.json`).
Of 936 files, git merged 836 cleanly and they were kept as is; 78 conflicts were merged
by hand, 18 by taking one side, 4 clean merges were edited during the merge.
Every one of the c3proj failures is the set-union case c3merge resolves by itself.

Things the survey must know: `instanceFolderItem.sid` repeats its instance's sid;
`sceneGraphData` and `scene-graphs-folder-root.items` hold uid/sid references, not
identities.

## What git and c3merge do on the con-sule history (2026-09-26)
con-sule (SuperOctoColor, BluePinStudio, 7 devs). Copy with push disabled at
`~/Documents/con-sule-c3merge-test`; scripts and results in `fixtures/real/con-sule/`.
- The team squash-merges PRs (214 of main's 260 first-parent commits), and GitHub only
  squashes what git merges cleanly, so conflicts are resolved inside PR branches by merging
  main into them. The scan fetches every PR head (`refs/pull/*/head`) and replays all 162
  merge commits reachable from any ref; the 37 squashes that touch C3 files on both sides are
  replayed too, as a check (c3merge: all clean and equal to what GitHub committed).
- 135 merges with C3 files changed on both sides, 839 files (8 more deleted on both sides).
  git: 47 merges / 152 files / 460 hunks need a person; c3merge: 31 / 86 / 403. Never worse:
  the 2 merges where c3merge conflicts and git doesn't are git writing `DrawingCanvas` into
  `usedAddons` twice ([addon-names.md](addon-names.md)).
- Most of c3merge's conflicts are C3 release format changes seen as edits, not user work:
  with the formats known it would be 29 / 60 / 159 ([release-migrations.md](release-migrations.md)).
- About 60 conflicts are on elements both sides have but the merge base doesn't (22 layout
  instances, 38 event elements). Squash merges cause them: the event sid 151113305759819 in
  `290b956ab` reached main through the squash commit "Pigpud 3 (#96)" and the next branch
  through its own commit "Pigpud_4" (the same event copied over), so the base predates both and
  any later edit makes them "added on both sides with different values". Merge commits
  instead of squashes would put the element in the base.
- **Dropped work was deliberate.** In 48 files c3merge merges cleanly, the committed file kept
  one side whole. The merging was done by two experienced devs, and skymen says to assume any
  dropped work was dropped on purpose: some branches overwrote work belonging to another
  game by mistake, and the resolvers cleaned that up. So on con-sule "committed ≠ c3merge's
  clean result" is a resolver's decision, not a loss.

Replay method, learned the hard way on con-sule. Shared scripts now in `fixtures/real/common/`
(`scan.ts [--branches] [--all] [--exclude]`, `replay.ts`, `summary.mjs`, `conflicts.ts`):
- Run git with `core.quotePath=false` (or `-z`): git quotes non-ASCII paths otherwise, and a
  filter on `.json` silently drops every file under an emoji folder (598 paths here; the
  first con-sule numbers missed half the files).
- Follow renames like merge-ort (`diff -M`): a file moved on one side and edited on the other
  is a normal content merge at the new path, not a skip. Only renamed-differently-on-both is a
  tree conflict. Modify/delete and rename/rename conflicts never reach a merge driver: count
  them as conflicts for both tools. Use `-l7000` (merge-ort's rename limit): git's diff default
  skips rename detection on big diffs (biogun, Astral Ascent hit it).
- Rerun of the earlier replays with the fixed scan (2026-09-26, same engine; old runs skipped
  files missing on one side and counted them nowhere): the numbers barely move. Merges needing
  a person, git → c3merge: Astral Ascent 377 → 258 became 379 → 260 (settled 135 and worse 16
  unchanged); UTRS 39 → 30 became 39 → 31 (a renamed layout git pairs with a different one);
  biogun 8 → 5 unchanged; StarDiver unchanged. Outputs in `<project>/out-v2`.
- biogun's `main` tip can't be opened in C3: its last merge `e07972370` (2025-01-08) kept
  `ScirraArcade` listed in `project.c3proj` (the hand-resolved file took the other side) while
  `0acb36232` had deleted `objectTypes/ScirraArcade.json` ("Failed to read file
  objectTypes/ScirraArcade.json"). `check`'s listed-file-missing rule and an open in C3 both
  catch it.

## Vicky, trubija, Flechita (2026-09-26)
clovelt's repos, cloned with push disabled at `~/Documents/<name>-c3merge-test`, replayed with
`common/` (`--all --branches`). Small: 2–5 devs, plain merge commits.
- Past merges needing a person, git → c3merge: Vicky 2 → 0 (3 merges); trubija 8 → 4 (28).
- Open branches merged now: Flechita `tavo` 8 files / 404 hunks → 3 / 36. The rest are stale
  (Vicky `arte`, Dec 2024, redone as `arte-nuevo`; trubija's 2022 branches), mostly
  modify/delete and moved instances.
- Most of Flechita's and much of Vicky's conflicts are UID collisions: both projects have
  `uidAllocationMode: "increment"` (con-sule and UTRS: "random"). See NOTES.md (`doctor` warning).

## Hand-made fixtures
`fixtures/<kind>/<case>/{base,ours,theirs,expected}.json` + `collisions.expected.json`.
One case per engine rule:
- object: add key both sides / delete-vs-modify / both-change scalar
- keyed list: add both sides / delete one side / modify both sides different fields /
  modify both sides same field / sid regenerated on one side / rename layer
- ordered list: append both / insert same spot / move + edit / move both sides
- scalar union: family members add/remove
- opaque: tileData changed both sides
- output fidelity: untouched file round-trips byte-identical; `1.0` stays `1.0`

## Real triples
Extract from existing history without modifying anything (read-only `git show`):
- Under The Red Sky merge commit `115db4b4` (merge/new-web-build): for each JSON path touched
  on both parents, dump `base = merge-base`, `ours = first parent`, `theirs = second parent`,
  `actual = merge result` (human resolved). Script: `git log --merges`, `git merge-base`,
  `git show <rev>:<path>`. Store under `fixtures/real/utrs-115db4b4/` — check with skymen
  whether these can live in a public repo (they're game content); otherwise keep the
  extraction script only and run it locally.
- The human-resolved result is *not* automatically the golden output (it may contain the
  BFC one-off edits), but the diff between c3merge output and it is the review checklist.

## Golden tests
**Status (2026-09-26):** unit and integration are done (`test/cases.ts`, 81 cases byte for
byte; `test/driver.test.ts`); fidelity is `scripts/fidelity.ts`, run by hand. Real merges as
golden files: not for now (skymen). No CI: tests run before every publish.
- unit: every hand-made fixture must match `expected` exactly (bytes), collisions must match.
- integration: build a temp git repo per scenario, commit base, branch, apply ours/theirs,
  `git merge` with the driver installed `--local`, assert file + exit code + log content;
  same for `rebase` and `cherry-pick`.
- fidelity: open merged project in C3 via c3cli, save, diff → must be empty (or only known
  C3 normalisations).

## Generating branches from a real editor
Nicest fixtures are made *in C3*: open tiny project, make edit A, save as ours; reset, make
edit B, save as theirs. c3cli should be able to script "open, run this editor operation,
save" eventually; until then do it by hand once per case.
