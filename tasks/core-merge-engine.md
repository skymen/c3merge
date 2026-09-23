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
- `also` (instances: `sid`): an element whose primary id (uid) changed on one side is still
  matched through the second exact key, when the base element's uid is gone on that side.
- `moves` (instances): a move to another layer on one side is replayed on the base and the
  other side before merging (`moves.ts`), so both sides' changes merge in the new place.
  Moved to different layers on each side, or moved on one side and deleted on the other:
  a conflict around each copy, so taking either side leaves exactly one.

## Project context (`src/context.ts`, skymen 2026-09-23)
The driver reads object types and families at base, ours and theirs from git (`git merge`:
`GITHEAD_<sha>`; rebase: `.git/rebase-merge/done`; a single cherry-pick gets none) and
passes the engine each side's changes:
- **Renames** (same sid, new name): applied to the base and the other side before merging
  (`renames.ts`): instance `type`, event `objectClass`, parameters naming the object (all
  but variable and timeline parameters, which can hold an equal name), `Name.` in
  expressions outside strings, family members, project folders and containers.
- **C3's automatic changes don't count as edits** when the other side deleted the
  instance: what its type or a family gained on that side (variables, behaviors, effects,
  template flags for those variables), and keys every element of the list gained on that
  side while none had them at base (opening in a newer release gives every instance a
  `sid` and `tags`).
### How a change is known to be automatic
Each rule is about *what* changed and *where it comes from*, checked on the project's own
files, never a guess on content:
- a reference now naming Y where base named X, when object type/family sid S is named X at
  base and Y on that side (the rename is in the object type's file);
- an instance variable, behavior or effect key that the instance's object type (or a family
  it belongs to) doesn't have at base and has on that side, plus the template flags for
  those variables. Values aren't checked (kept simple, skymen 2026-09-23); in the real
  merges all 154 were the default or the same on every other instance of the type;
- a key that every element of the list has on that side and no element had at base (a
  person editing instances can change values, not add a key to all of them; a newer
  release does). Values aren't checked (new sids are random).
Only used to decide "deleted on one side vs changed on the other"; anywhere else these
changes merge like any other.

Limit: git only calls the driver for files both sides changed. A file only one side
changed is taken as is, even if it names a type the other side renamed (`85c85d2a`:
MT2-2, Subhub-Trials1, Subhub-Trials2, fixed by hand in "merge fix" `46e44c7f`). Needs a
step after the merge (backlog).

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
414 conflicts before project context. Where the instance went on the deleting side:
- **Moved to another layer, same uid: 61** → move detection.
- **Re-created (same content, new uid and sid): 15**: nothing exact links them, still
  conflicts (or the deletion wins when the other side's change was automatic).
- **Really deleted: the rest**, where the other side's change was mostly C3's own:
  - 150 in `cad4249b`: theirs opened the project in a newer release ("update to beta"),
    which gave every instance a `sid` and `tags`; ours redesigned levels (4-1: 422 → 380
    instances). An earlier count called these "same sid, new uid": wrong, the base had no
    sids at all and `undefined === undefined` matched.
  - 44: the object type was **renamed** on that side (`TiledShapeDark` → `woodPlanksShape`,
    same sid `875094639770084`, `6c2397cc`), and C3 updated the instances' `type`.
  - ~150: variables a **family** gained on that side (e.g. `scatterShape` +`animationType`),
    added by C3 to every member instance, values from the instances' template.
  - ~45: real edits (`world`, `showing`/`locked`, properties): real conflicts.

With uid-or-sid matching, moves and project context: **506 conflicts → 162**, and files
git conflicts on that c3merge resolves: 28 → 41 of 86 (`replay-triples.ts --repo`). What's
left: the real edits above, the 3D Object float bug (78, conflicts on purpose: skymen),
addon versions (7), 8 instances moved to different layers on each side (`0e9870e1`
Tower), same file/type created on both sides (4), replaced events (8).

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

### Instance variable renames
**Status:** not handled (2026-09-23). Instances store values by variable name. Ours renames
`myVar` → `speed` (C3 renames the key on every instance), theirs sets `myVar = 42` on one
instance: conflict, taking ours loses the 42, taking theirs leaves an undeclared `myVar`
that C3 refuses (lab row 14). Theirs adding a new instance with `myVar` merges cleanly and
breaks the project. Fix: same as object type renames, from the variable's sid in the type or
family file, but only for structured references (instance keys, template flags,
`instance-variable` parameters with that `objectClass`). Expressions are never rewritten
(skymen): C3 rewrote them on the renaming side, an expression edited on both sides is a
conflict, and the other side's new or edited expressions still using `Type.old` (or
`Self.old`, `Family.old`) are flagged as conflicts. Detection can err towards a false
conflict; rewriting can't err safely. Test set: 17 variable renames in the Under The Red
Sky history (e.g. `98622988` player: walkSpeed → groundSpeed), where C3's own rewrite is
the reference.
