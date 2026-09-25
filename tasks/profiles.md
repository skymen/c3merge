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
- Tilemap `tilemapData`: first one value; tile by tile since 2026-09-25 (Tilemaps below).
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

## Tilemaps
**Status:** done 2026-09-25: `tiles` rule (`src/engine/tiles.ts`), `check` invariants
`tilemap-data-runs` / `tilemap-data-size` / `tilemap-grid-size`, lab rows 29–29d.

**The format**, read from the tile grid class in r449-5's and r500's `projectResources.js`
(identical but for the trim below) and checked in the editor (`lab/out/tilemap-experiment/`):
- `width` × `height` is what shows; `max-width` × `max-height` is the grid the editor keeps (the stored grid).
  `data` covers the whole stored grid, column by column (cell x·max-height + y), run-length
  encoded: `n` or `countxn`, 0 = empty, n = tile n−1, `h`/`v`/`d` after it = flipped.
  The preview's `getTileAt(x, y)` matched that reading on all 900 cells of a tilemap with a
  40×40 stored grid and 30×30 showing, on r449-5 and r500 (read row by row, 118 differ).
- Hidden cells (kept but not shown): shrinking keeps them; growing appends new columns or
  rows past the stored grid, so shrinking and growing again makes it grow without end; brush
  strokes at the edge write them. The runtime only gets what shows.
- **r449-5 keeps hidden cells forever. Later releases drop them**: the first time the
  editor reads a tilemap after loading the project (opening its layout, a preview, an
  export), it trims the grid to width × height; a tilemap it never reads is saved back as
  it was. The trim is in the code of r496, r497 and r500 and not in r449-5; lab row 29c
  shows it on r495-2 and r503 too (a 40×40 grid saved as 30×30 after a preview), so it
  came in between r449-5 and r495-2. The release notes don't mention it.
- Real projects (3,070 tilemaps in 6 projects, saved with r225 to r483): every one stores
  exactly max-width × max-height cells. Hidden cells: all tilemaps of every project saved
  before r449-5 (plus 1,890 of 2,195 in StarDiver, r449-5), 6 of 211 in the one saved by
  r483. 28% have flipped tiles. 51 keep over a million cells, up to 10,411 × 3,077 for a
  69 × 60 tilemap (Zombiehood): the leak the trim fixes.

**The merge** (`mergeTilemap`), when both sides changed a tilemap differently:
- `width`/`height`: 3-way; changed differently on each side → conflict ("resized
  differently"). Kept grid: 3-way on max-width/max-height (both changed differently: the
  larger), never smaller than width/height.
- Cells by position (x, y), 3-way. A cell a side doesn't keep (trimmed) is unchanged on
  that side, not erased; a cell base doesn't keep is empty. Hidden cells are merged like
  the rest: one real merge had a side's brush write two flipped tiles just outside an
  18 × 8 tilemap.
- Changed differently on both sides and showing → one conflict for the tilemap; its two
  versions hold every other tile merged, so either side keeps both sides' other painting.
  Hidden → ours, no conflict (nobody sees it; later releases drop it anyway).
- A tile one side changed where it showed but the merged size hides → conflict.
- Works on runs, column by column, never cell by cell: the 10,411 × 3,077 grid merges in
  about 0.1 s. `test/tiles.test.ts` checks it against the same rules applied cell by cell
  on 20,000 random tilemaps (resized, trimmed, hidden cells, short data), and each cut of
  the walk is covered by a case that fails without it.

**On real histories:** Astral Ascent (1,289 merges) and Under The Red Sky (103) never had
a tilemap changed differently on both sides. StarDiver's Desert-Tweaks-6/21 branch merged
into main: Desert Landing 21 → 19 conflicts; 2 of its 3 tilemaps merge (cell for cell what
a plain merge of the stored grids gives), the third has 2 tiles painted differently.

## Later
- Script lines: `script[]` arrays get the line-by-line merge (done); script events that
  store their code as one string (`"script": "…\n…"`) should get it too.
- Timelines: key tracks by the instance/property they animate, once real timeline merges
  show up.
- Profiles for new kinds (scene graphs, 3D models) as they appear in the survey.
