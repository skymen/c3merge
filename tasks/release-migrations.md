# Release format changes look like edits

**Status:** findings only; won't do in c3merge (skymen, 2026-09-26). Simulated in
`fixtures/real/con-sule/simulate.ts` (normalizer: `fixtures/real/con-sule/migrations.ts`).

**Decision (skymen, 2026-09-26):** there's no good general rule short of learning every C3
format change, which c3merge won't do. Teams that stay on one release and upgrade together
never hit this. The place to handle it is a future conflict-resolution tool: bring both sides
to the same release (open and save each in C3), then reapply the diff (NOTES.md, Ideas).

## The problem
When devs work on different C3 releases, saving a file with a newer release rewrites every
element whose format changed. c3merge sees each of those as an edit. The damage is worst
when the other side deleted the element: "deleted on one side, changed on the other", for
an element nobody touched. con-sule's sides were saved with r43900, r45802, r46602 and
r47600.

Format changes seen so far (all value-preserving):
- r45802: default folder fields no longer saved on instances and scene-graph folder items
  (`folderName: ""`, `indexInFolder: -1`, `folderNestingLevel: -1`, in `instanceFolderItem`
  and in `scene-graphs-folder-root.items[]`).
- after r43900, by r46602: script actions and script events: `"script": "a\nb"` →
  `"language": "javascript", "script": ["a", "b"]`.
- r47600: `world.zElevation` → `world.z`, `sceneGraphData.preview.transformZElevation` →
  `transformZ`; `"sampling": "auto"` (layouts and layers) no longer saved.

The engine already has the idea in `onlyAutomatic` (merge.ts): a change that only adds keys
every element of that side gained, or members a type gained, doesn't count, so a delete on
the other side wins. It only looks at top-level keys, so none of these are caught.

## What it costs on con-sule (135 merges)
| | git | c3merge now | c3merge knowing these formats |
|---|---|---|---|
| Merges needing a person | 47 | 31 | 29 |
| Files with conflicts | 152 | 86 | 60 (51 with modify/delete below) |
| Conflicts | 460 hunks | 403 | 159 |

Deleted-vs-changed conflicts go from 274 to about 36. Of the 274, the "change" was
`instanceFolderItem` defaults (74), scene-graph folder item defaults (72) and z renames
(83). The ~36 left are real edits (event scripts, hierarchy parents, instance variables).

## Modify/delete: files git never hands to the driver
9 files in 3 merges were deleted on one side and "modified" on the other, and in all 9 the
modification is only these format changes (e.g. `fed_levelZones.json`: 354 changed paths,
0 after normalizing). git stops at the tree level ("CONFLICT (modify/delete)") and never runs
a merge driver, so c3merge can't see them from the driver.

## Experiment: re-save every version in one release, then merge (2026-09-26)
`fixtures/real/common/resave.ts`: for each past merge whose sides were saved with different
releases and where c3merge stops on a deleted-vs-changed, open base, ours and theirs in one
release through c3cli 0.2.0 (the local build: it opens by drop, which old editors like r328
don't take, so the target is a current release, r495-2, or the LTS r449-5 as a fallback),
Save as, commit the three to a scratch repo, and merge the files that conflicted again with
c3merge (same project context).

con-sule (6 of 7 merges ran; releases r439 to r487, all re-saved in r495-2):
- deleted-vs-changed conflicts: 174 → 1; the one left is a real edit (an event changed on one
  side, deleted on the other).
- all conflicts on those files: 209 → 31; the rest are real: 29 in files created on both sides
  (`4ce7cd9f6`), one field changed differently on both sides, and that event.
- `9c7f1438e` couldn't run: its ours commit lists `vim_Back_Wall` under
  `GameObjects/GreenGame` while the file is at `objectTypes/vim_Back_Wall.json`, so C3 refuses
  to open that commit at all (same as lab row 36c).

So the resolver-tool idea holds: bringing every version to one release first removes the
release noise and leaves the real conflicts.

What got in the way, for whoever runs this again:
- Repos made on Windows hold files whose case differs from their name in the project (and
  image files not in lowercase); the editor's file system is case-sensitive. The script renames
  them first.
- c3cli 0.1.0 (the dev dependency) stages projects into the browser, which failed at random
  on big projects; 0.2.0 opens by drop but only in recent editors.
- Addons: projects that don't bundle theirs need the .c3addon files (index of the ones on
  this machine: `addon-index.json`); effects C3 later removed (pulse, bulge) can't be supplied,
  so Astral Ascent (r225) can't open in a current release. trubija (r319) neither: an instance
  variable named like an expression added later, and legacy SDK v1 addons that r495 refuses.
- One browser profile per open, persistent (an ephemeral one has too small a storage quota for
  a 230 MB project) and never shared between browsers.

## Options considered (not taken)
- A table of known format changes per release, applied when comparing (normalize base and
  both sides before deciding "changed?", keep the originals for the output), kept up to date
  from the release watch. Rejected: it means tracking every release's format.
- A generic rule: a nested key renamed or dropped in every element of a side's list with the
  same value. Rejected: a real edit of the same field hides behind it, and it still misses
  shape changes like script `string → lines`.
- For modify/delete: a step after the merge (`finish`/`resolve`) that `git rm`s a file whose
  modified side equals the base modulo format changes. Needs the table above.
