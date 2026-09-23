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
Things the survey must know: `instanceFolderItem.sid` repeats its instance's sid;
`sceneGraphData` and `scene-graphs-folder-root.items` hold uid/sid references, not
identities.

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
