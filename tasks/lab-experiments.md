# Lab: what does C3 tolerate?

**Status:** all 37 rows (33 + variants) measured on r449-5 (LTS), r495-2 (stable) and r503
(beta), 2026-09-23. Only rows 19 and 29 differ between releases. Harness
in `lab/` (`npm run lab -- [--releases stable,beta] [--rows …]`), results in
[reports/lab-matrix.md](../reports/lab-matrix.md), severities in
[check-validator.md](check-validator.md).

## How the harness works (2026-09-23)
- For each release: a control run (the untouched base), then every row in parallel on a
  3-tab c3cli pool (about 75 s per release for 37 rows).
- Each row: copy the base, apply one corruption (`lab/corruptions.ts`, edits keep C3's
  exact JSON style so only the target field changes), open, preview, then **Save as
  project folder**, and compare with the control's Save as.
- Use Save as, not Ctrl+S: Ctrl+S only rewrites files C3 considers changed (on both
  releases), so it can't show what C3 holds in memory. Save as writes every file.
- Refusals show a generic dialog; the harness records the editor's console exception as
  the cause.
- Each row has a `present(savedDir)` check ("are there duplicate uids?"), so the verdict
  doesn't depend on what one release happens to write. Rows without one fall back to a
  byte comparison with the control and are marked "(no presence check)".
- Saving: a `.c3p` save rewrites every file; a folder save (Ctrl+S) only writes what C3
  thinks changed (skymen, confirmed by rows 26–27 before the switch to Save as).

## LTS (r449-5)
`fixtures/lab-base` is saved by r449-5, the LTS, so every release in the table opens it
and newer ones upgrade it like any older project. It was authored in r495-2 by skymen
(using only features r449 has), then re-saved once by r449-5 on his request, 2026-09-23:
r495-2's version is in git (c70d722). That re-save lost r495-only data (3D shape `depth`
120 became `z-height` 15, layer `sampling` and some timeline fields went), none of which
the rows use: all 111 verdicts were unchanged. No tool re-saves with an older release
automatically (DESIGN.md). Row 21 ("saved with an older release") was dropped, since every
stable and beta run now opens an r449 project.

## What the lab corrected
- "C3 regenerates missing/duplicate sids silently": **half true**. Duplicate uids are
  renumbered and a missing event sid is regenerated; a duplicate event sid is kept.
  (The first run got uids wrong by byte-comparing with the control; each row now checks
  its own corruption with a `present` function.)
- "Missing object type for an instance: refuses": true, and nearly every other dangling
  reference refuses too.
- "C3 rewrites the whole file on save": only on Save as, or for files it considers changed.

## Method
1. Start from a tiny project (2 layouts, 2 event sheets, 3 object types, 1 family, 1
   tilemap, 1 timeline) saved as a folder by the current C3 release.
2. For each row, apply exactly one corruption with a script (reproducible, committed under
   `fixtures/corruptions/`), zip to `.c3p`, open via c3cli.
3. Record the outcome: `loads-clean` / `repairs-silently` (project opens, but re-saving
   changes the file) / `repairs-with-notice` (dialog or log line) / `refuses` (error dialog)
   / `crashes` (editor error / hang). Capture the dialog text and the editor log.
4. Also test the *runtime*: preview the layout and check the console — some corruption
   loads in the editor and dies in preview.
5. Repeat on 2 releases (current stable + current beta) to learn what's stable.

## Matrix (fill in)

| # | Corruption | Editor | Preview | Notes |
|---|---|---|---|---|
| 1 | layout instance `type` → nonexistent object type | | | |
| 2 | layout instance `uid` duplicated within layout | | | |
| 3 | uid duplicated across layouts | | | |
| 4 | event `sid` duplicated | | | |
| 5 | event `sid` missing | | | |
| 6 | object type `sid` duplicated | | | |
| 7 | c3proj folder tree lists a layout with no file | | | |
| 8 | layout file exists but not listed in c3proj | | | |
| 9 | event sheet `include` → nonexistent sheet | | | |
| 10 | event `objectClass` → nonexistent type | | | |
| 11 | action `id` invalid for plugin | | | |
| 12 | action parameter references missing layer name | | | |
| 13 | call-function → nonexistent function | | | |
| 14 | instance variable on instance not declared on type | | | |
| 15 | type declares variable, instance lacks it | | | |
| 16 | family member → nonexistent type | | | |
| 17 | family members of mixed plugins | | | |
| 18 | `usedAddons` missing an addon that a type uses | | | |
| 19 | `usedAddons` bundled version differs from installed | | | |
| 20 | `savedWithRelease` newer than editor | | | |
| 21 | `savedWithRelease` much older | | | |
| 22 | animation frame `imageSpriteId` duplicated | | | |
| 23 | image file missing for a frame | | | |
| 24 | layer `name` duplicated in a layout | | | |
| 25 | object type name duplicated (two files) | | | |
| 26 | key order changed / tabs→spaces / CRLF (does C3 rewrite on save? which parts?) | | | |
| 27 | unknown extra key at top level / inside an event | | | |
| 28 | required key missing (e.g. instance `world`) | | | |
| 29 | `tileData` truncated | | | |
| 30 | timeline references deleted instance uid | | | |
| 31 | hierarchy child references missing uid | | | |
| 32 | global variable name duplicated | | | |
| 33 | event with 0 conditions + 0 actions (empty block) | | | |
| 34 | two effects with same name on one type | | | |

## What we already believe (unverified, from experience)
- C3 regenerates missing/duplicate sids silently. Unknown whether references by sid (which
  ones exist?) get updated.
- C3 rewrites the whole file on save with its own formatting → output fidelity matters.
- Missing object type for an instance: believed to refuse to load.

## Deliverable
Filled table → severity per invariant in `check-validator.md`, plus a list of "C3 repairs
this, don't bother" to keep `check` quiet.
