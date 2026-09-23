# Per-file-kind profiles

**Status:** written from data (2026-09-23): [`src/profiles/profiles.json`](../src/profiles/profiles.json),
evidence in [reports/profile-survey.md](../reports/profile-survey.md) (`scripts/profile-survey.ts`
over 49 projects, 2,268 files: c3cli's fixtures, lab-base, Under The Red Sky). Engine not
written yet, so the rules are untested against real merges.

## Principles (DESIGN.md "Engine")
- Only merge what is certainly right; anything else is a conflict with localized markers.
- Ambiguous **order** is merged anyway (ours first) and reported as a warning to fix in
  the editor, except when both sides replaced the same element.
- Profiles are data, so a new C3 release or file kind doesn't need code. Unknown lists get
  a conservative default: matched by `uid` or `sid` when every element has one, otherwise
  merged as one value.

## Kind detection
By the repo path git passes (`%P`): `*.c3proj`, `eventSheets/`, `layouts/`, `objectTypes/`
and `families/`, `timelines/`, `flowcharts/`. Anything else under the project → default
rules. `*.uistate.json` never reaches the engine (`merge=ours` in `.gitattributes`).

## What the survey and the editor showed
- **Project bar order** (checked with c3cli on r495-2, lab-base with the lists reversed):
  object types, event sheets, families and timelines are shown **sorted by name** whatever
  the file says; **layouts keep the file order** (you can drag them). So folder `items` are
  sets except for layouts, which are ordered. In the files the lists are mostly unsorted
  (object types 3/44 sorted): insertion order, meaningless.
- Folder `items` are unique strings in every list seen; `subfolders` are keyed by `name`,
  except the unnamed special folder (timeline transitions): missing name counts as a name.
- `usedAddons`: `id` is unique in 48/48 projects; keyed by `type+id` to be safe.
- Event sheets: `events`/`children` have `sid` except comments (content) and includes
  (`includeSheet`); conditions always have a sid; ~4% of actions have none (script
  actions: matched by content, so an edit is a replacement). `functionParameters` sid,
  ordered (parameter order is the call signature).
- Layouts: layers and sublayers `sid` (always); instances `uid` (always; `sid` is missing
  or repeated in 3/670 lists); `instanceFolderItem.sid` and `scene-graphs-folder-root`
  repeat instance sids (references, not identities); `sceneGraphData.children` keyed by
  `uid`; effect types by `name` (`effectId` repeats when an effect is used twice).
- Object types: `instanceVariables` sid (a set: order is only the Properties bar);
  `behaviorTypes` sid, ordered (behaviors tick in order); `effectTypes` name, ordered
  (render chain); animations sid, ordered; frames `imageSpriteId` (always unique; lab
  row 22), ordered; image points name, ordered (events refer to them by number too).
- Tilemap `tilemapData` (`width`, `height`, `data` string): one value, since the three
  only make sense together.
- 3D mesh points, colours, vectors, script lines, call-function parameters, template
  components state, timeline tracks and keyframes: no identity → one value each.

## Second keys and moves (2026-09-23)
- `also`: instances also match by `sid` when a side renumbered the uid.
- `moves`: instances can move between layer lists of one layout; the engine replays a
  move made on one side before merging (tasks/core-merge-engine.md).

## Duplicates after a merge
Two elements that end up with the same identity, or the same `name` in a list where names
were unique in all three versions, are a conflict (two branches both created an instance
variable `hp`, a layer `Background`...). C3 refuses most of these (lab rows 24, 25, 32).

## Later
- Script lines: `script[]` arrays get the line-by-line merge (done); script events that
  store their code as one string (`"script": "…\n…"`) should get it too.
- Timelines: key tracks by the instance/property they animate, once real timeline merges
  show up.
- Profiles for new kinds (scene graphs, 3D models) as they appear in the survey.
