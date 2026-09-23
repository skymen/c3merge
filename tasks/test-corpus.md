# Fixture corpus and golden tests

**Status:** not started (2026-09-21)

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
