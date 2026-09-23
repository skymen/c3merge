# `c3merge check` — cross-file validator

**Status:** implemented (2026-09-23): `c3merge check <folder|.c3p> [--json | --github] [--all]`,
`c3merge invariants` (lists each invariant with the lab measurement behind its severity).
Code: `src/model/project.ts` (loader), `src/check/` (invariants, severity, runner).
Tests: every lab corruption must trip its invariant; the untouched base and all 47 real
projects of the corpus must stay clean. Not covered: row 11 (invalid action id needs each
addon's action list). Severities for all 37 lab rows come from the run of
2026-09-23 on r449-5 (LTS), r495-2 (stable) and r503 (beta):
[reports/lab-matrix.md](../reports/lab-matrix.md), data in `src/check/lab-matrix.json`.

**Rule across releases:** severity = the worst behaviour among measured releases, since a
team's project must open in whatever release each member runs. Only 2 of 37 rows differ
between r449 and r503 (19 and 29, both worse on r449).

## Severity from the lab

C3's loader is strict: almost every dangling reference makes the whole project fail to
open, behind the generic dialog "Failed to open project" (the real reason is only in the
console). `check` has to catch these, because the user sees nothing useful.

**error: C3 refuses to open the project** (editor exception in brackets)
- instance `type` → missing object type (`cannot find object type named`), row 1
- object type `sid` duplicated (`object class sid already in use`), row 6
- c3proj lists a layout/sheet/type with no file (`Failed to read file`), row 7
- event sheet `include` → missing sheet (`cannot find event sheet include`), row 9
- event `objectClass` → missing type (`cannot find object`), row 10
- action/condition `id` not valid for the plugin (`missing action id`), row 11
- instance has an instance variable its type doesn't declare (`cannot find instance variable`), row 14
- family member → missing type (`cannot find family member with name`), row 16
- family members from different plugins (`wrong plugin`), row 17
- animation frame `imageSpriteId` duplicated (`id already in use`), row 22
- image file missing for a frame (`Failed to read file 'images\…'`), row 23
- layer name duplicated within a layout (`layer name '…' already used`), row 24
- two object type files with the same `name` (`unexpected object type name`), row 25
- required key missing, e.g. instance `world` (a crash inside the loader), row 28
- call-function action → function that doesn't exist (`invalid function name`), row 13
- timeline track → instance uid that doesn't exist (`no compatible instance found for timeline track`), row 30
- `usedAddons` entry marked `bundled: true` without its `.c3addon` in `addons/` (r449
  refuses: `Failed to read file 'addons/plugin/Sprite.c3addon'`; newer releases ignore it
  for built-in plugins), row 19
- (environment, not a project error) `savedWithRelease` newer than the editor, row 20

**error: silent data loss**
- a layout file on disk that the c3proj doesn't list: the project opens without it, no
  dialog, and Save as writes a project without that layout, row 8. A merge that keeps a new
  file but loses its list entry makes content vanish.

**error: loads in the editor, fails at runtime**
- tilemap `tilemapData.data` inconsistent with width × height: r495+ open it but the
  preview doesn't start ("Failed to start preview", `expected finite number`); r449
  refuses to open it with the same error, row 29.

**warning: C3 keeps it as-is (loads, previews, and writes it back unchanged)**
- event `sid` duplicated, row 4: Save as writes both events with the same sid.
- action parameter naming a layer that doesn't exist, row 12 (preview runs).
- global variable name duplicated, row 32 (preview runs; which one wins is unknown).
- two effects with the same name on one type, row 34 (preview runs; instances key effect
  settings by name, so one set is ambiguous).
- empty event block (0 conditions, 0 actions), row 33. Probably harmless: info at most.

**none: C3 repairs it, don't check**
- instance `uid` duplicated within a layout or across layouts, rows 2 and 3: C3 renumbers
  one of them (e.g. `Text#4 3DShape#4` → `Text#5 3DShape#4`). An earlier run said "kept";
  that came from comparing bytes with the control's save, which the renumbering changes.
- event `sid` missing, row 5: regenerated.
- `savedWithRelease` older than the editor: every stable and beta run opens the
  r449-saved lab-base, which upgrades normally (row 21 dropped).
- instance missing a variable its type declares, row 15: added back with the default.
- hierarchy parent listing a child uid that doesn't exist, or a child whose `parent-uid`
  doesn't exist, rows 31 and 31b: the dangling link is dropped.
- `usedAddons` missing an addon, or a wrong version/bundled flag, rows 18 and 19: rebuilt
  on save.
- key order, indentation, CRLF, unknown keys (top level or in events), rows 26 and 27:
  normalized when C3 writes the file. But Ctrl+S only rewrites files C3 considers changed,
  so a badly formatted file stays that way on disk. c3merge's own output must still be
  canonical ([core-merge-engine.md](core-merge-engine.md#output-fidelity)).

**Not overfitting to one release (skymen, 2026-09-23).** c3merge has to keep working on
future C3 releases without code changes. So:
- invariants are defined by meaning (dangling reference, duplicate id...), never by
  release number or by the editor's exception text;
- severities come from data (`src/check/lab-matrix.json`), regenerated by re-running the lab
  on new releases (`npm run lab -- --releases stable,beta,lts`);
- a release the lab hasn't measured uses the most recent measured behaviour, and an
  invariant with no measurement is a warning.

## What the corpus taught (2026-09-23, 47 real projects)
- Built-in object classes besides `System`: `Functions` (the only other one).
- Variables inside a group are scoped to the group; only top-level sheet variables are
  global.
- Layer names in action parameters that no layout has are normal (layers created at
  runtime), so `layer-param-exists` is info despite the lab's "keeps it".
- Project-bar subfolders are disk subfolders; special folders (timeline transitions) have
  no name in the c3proj, and the model matches them by the file's location instead.
- Frame images are `images/<type>-<animation>-<NNN>.<ext>`, lowercase (1,228 of 1,228);
  bundled addons are `addons/<type>/<id>.c3addon` (71 of 71).

## Model
Load the project (folder or `.c3p`): c3proj + all JSON, indexed by kind and by name/sid.
Build a reference graph. Shared package with c3cli (`packages/c3-model`).

## Invariants (initial list — extend from the matrix)

References
- every layout / event sheet / object type / family / timeline listed in the c3proj folder trees exists on disk, and vice versa (file on disk not listed)
- layout `instances[].type` → existing object type (or family? no, instances are of types)
- object type `plugin-id`, behavior `behaviorId`, effect `effectId` → present in `usedAddons`
- family `members[]` → existing object types, all same plugin
- event sheet `include` → existing event sheet; layout's assigned event sheet exists
- event `objectClass` → existing object type / family / `System`
- action/condition `id` is valid for that plugin (needs an ACE table per addon — later; for Scirra plugins can be scraped once from the SDK docs or the editor bundle)
- action parameters referencing layers by name/number, layouts by name, animations by name, instance variables by name, functions by name (`functionName` in call-function actions), global variables by name
- `instanceVariables` on an instance ⊆ variables declared on its type (+ family variables)
- `behaviors` on an instance ⊆ behaviorTypes on its type (+ family)
- `imageSpriteId` / image files referenced exist in `images/`
- `usedAddons` bundled versions: `version` present iff `bundled: true`

Uniqueness
- sids unique project-wide (C3 regenerates — but references by sid? verify what breaks)
- uids unique project-wide
- object type names unique (case?), layout names, event sheet names, layer names within a layout, animation names within a type, instance variable names within a type
- function names unique across all event sheets

Structural
- JSON parses; `projectFormatVersion` equal across files? (only c3proj has it)
- every object has the keys its kind requires (learn required-key sets from the corpus)

## When to run
- Driver mode: git calls the driver per file; it cannot know when the merge is done. Options:
  (a) `post-merge` hook — but hooks need local install too; `c3merge install` can set
  `core.hooksPath`? No — that would hijack the user's hooks. Instead: the driver writes a
  marker; `c3merge check` is invoked by the Action and by the user; `doctor` suggests
  adding `[alias] c3 = !c3merge check` — decide.
  (b) The driver runs `check` itself when it detects it's merging the *last* c3 file of the
  merge — impossible to know reliably. Skip.
  Decision: driver never runs full `check`; it prints "run `c3merge check` before opening
  the project" once per merge (marker file in `.git/c3merge/`).
- CI: always.

## Output
Human: grouped by severity, `path: message`, exit 1 on errors. Machine: `--json`, and
`--github` for workflow annotations (`::error file=...`).
