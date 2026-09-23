# Core 3-way merge engine

**Status:** implemented (2026-09-23): `src/engine/` (`merge.ts`, `render.ts`, `lines.ts`), rules
in `src/profiles/profiles.json`. Tests: `test/engine.test.ts` (42 hand-made cases from
`test/cases.ts`, byte fidelity). Real merges: `scripts/replay-triples.ts` (see below).

## Rules (DESIGN.md "Engine")
Only merge what is certainly right; anything else is a conflict with localized markers.
Ambiguous order is merged (ours first) and reported as a warning.

- Values: changed on one side → that side; same change on both → it; both containers →
  recurse; otherwise conflict. Deleted on one side and changed on the other → conflict.
- Objects: ours' key order; a key only theirs added goes after the key it follows there.
- Lists, per profile rule:
  - `id` + `order`: elements matched by identity (no fuzzy matching). Elements added on one
    side are kept; deleted on one side and untouched on the other are removed; deleted vs
    changed → conflict. Order: the side that reordered the shared elements wins (ours by
    default); the other side's additions go after the element they follow there. For
    ordered lists, both sides adding at the same spot or reordering differently is a
    warning; both sides *replacing* the same element (deleted in both, each inserted
    something) is a conflict. Identities missing or repeated in a version → the list is one
    value.
  - `lines`: text lines (script actions), merged line by line like git.
  - `atomic` / no rule and no uid or sid: one value.
- Two elements with the same `name` after the merge, where every version had unique names
  → conflict.
- `savedWithRelease`: the larger one.

## Output
- Clean: `JSON.stringify(v, null, indent)` in the style of ours' file (C3: tabs, `\n`, no
  final newline; compact stays compact). If the result equals one side, that side's exact
  bytes.
- Conflicts: hunks `<<<<<<< ours` / `=======` / `>>>>>>> theirs` around whole object
  members or list elements. Commas are placed per side, and a hunk at the end of a
  container where one side is empty takes the item before it, so taking either side of
  any hunk gives valid JSON. Adjacent conflicting items share one hunk.

## Replay of real merges (Under The Red Sky, 103 merges, 2026-09-23)
`npx tsx scripts/replay-triples.ts` (data from `scripts/extract-triples.ts`, gitignored). "git"
here is `git merge-file --diff-algorithm=histogram`, which gives the same result as a real
`git merge` (merge-ort uses histogram; plain `merge-file` defaults to Myers and can place an
insertion one element off, which first showed up as a false c3merge/git difference in
`896d8b8c` Subhub-Desert).

972 files changed on both sides: 850 git merges cleanly, 86 git conflicts, 34 deleted on
one side (git settles modify/delete itself, the driver isn't called), 2 added on both.
- git clean (850): c3merge clean on 846, identical to git on 845. The other one
  (`76c5052b` levelEditorBank) differs only in the order of template override flags, a set.
  4 new conflicts: layers or instances deleted on one side and changed on the other, which
  git dropped silently because the lines didn't overlap.
- git conflict (86): c3merge clean on 28 (5 identical to the commit; the rest differ where
  the person took one side whole and lost work, edited by hand, or committed invalid JSON).
- Still conflicting: 58 + 4 + 2 files.

### The "deleted on one side, changed on the other" instances (2026-09-23)
Where the instance went on the deleting side:
- **Same sid, new uid: 150** (all `cad4249b`): not deleted. One side renumbered uids, the
  other changed sids. Matching an element by uid *or* sid (both exact keys) pairs them.
- **Moved to another layer, same uid: 61**: a move, not a deletion. Today it's a conflict,
  and resolving it can leave the uid twice. Needs move detection across lists of a file.
- **Same content, new uid and sid: 15** (cut/paste): only a content match finds them, so
  they stay conflicts.
- **Really deleted: 239**, and the other side's change is usually automatic:
  - 44: the object type was **renamed** on that side (`TiledShapeDark` → `woodPlanksShape`,
    same sid `875094639770084`, `6c2397cc`), and C3 updated the instances' `type`.
  - ~150: variables a **family** gained on that side (e.g. `scatterShape` +`animationType`),
    added by C3 to every member instance, values from the instances' template.
  - the rest (~45) are real edits (`world`, `showing`/`locked`, properties).

### Renames need the whole project
The rename in `85c85d2a`: theirs renamed `TiledShapeDark`, ours added 49 new instances with
the old name. Each file merges correctly and the project doesn't open; the right merge
applies theirs' rename to ours' new references, which is what the person did by hand.
Renames are exact to detect (same sid, new name) but only from the object type files, not
from the layout being merged. What the driver can see (tested, git 2.50):
- `git merge`: HEAD = ours, `GITHEAD_<sha>` env = theirs, so the base is `git merge-base`.
- `git rebase`: HEAD = upstream, last line of `.git/rebase-merge/done` = the commit being
  picked.
- single `git cherry-pick` / `revert`: nothing identifies the picked commit while the
  driver runs → no project context, fall back to per-file.

### Other conflicts left (not instance deletions)
- Floats that differ in the 5th-8th significant digit on both sides: `staticCharacter`
  width/height/originX (C3 recomputing 3D model bounds): 3 merges, 15 instances.
- Addon versions changed on both sides (`3D Object` 2.71.1 vs 2.67.1, `Rotate 3D`...): 7.
- Same file/object created on both sides, only the generated sid differs (`zh.json`,
  `ptbr.json` in the c3proj; `Text`, `decal2` object types): 4.
- Real edits on both sides: replaced actions/conditions (8, all different content),
  instance moved to different places (x/y, originY: 3), an effect added on both with
  different parameters (1), a language list extended differently (1), layers/events
  deleted vs edited (5), an animation frame, a scene-graph folder item.
