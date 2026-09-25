# What happens during a merge

Git calls c3merge for each C3 file that **both** branches changed. c3merge merges the file
by its structure, writes the result, and tells git whether it's clean. Files that only one
branch changed are taken as they are, as git always does. The finish step then applies
renames to them (see [below](#renames-and-the-finish-step)).

"Ours" is the branch you're on. "Theirs" is the one you're merging in. During a rebase git
swaps them: ours is the branch you're rebasing onto.

## The rule

c3merge only merges what is certainly right. When two changes can't both be kept, or it
can't tell whether a change is safe, the file becomes a conflict for you to resolve. The
exception is **order**. When both sides insert at the same spot, both are kept, ours first,
and you get a warning, because fixing order is quick in the editor and painful in JSON.

## Reading a conflict

A conflicted file has markers only around the part that conflicts, not around whole
screens of JSON:

```
"world": {
	"x": 95.42788220259692,
<<<<<<< ours
	"y": 111,
=======
	"y": 222,
>>>>>>> theirs
	"width": 162.85576440519384,
```

Keeping either side, or both for list items, leaves valid JSON. VS Code's "Accept Current
Change / Accept Incoming Change / Accept Both Changes" and any other git tool work as
usual. When done, run `git add` on the file. The project won't open in C3 until every
marker is gone, on purpose.

`.git/c3merge/conflicts.md` lists every conflict and order warning of the current merge,
with locations in C3 terms:

```
## game/layouts/Level 1.json

1 conflict(s): pick a side at each <<<<<<< marker in the file, then `git add` it.
- layers[Layer 0].instances[Sprite#2].world.y: changed on both sides

Merged, but check the order in the editor:
- layers[Layer 0].instances: added at the same place on both sides: kept ours first, check the order in the editor
```

`Sprite#2` is the Sprite instance with UID 2. The same lines are printed during the merge,
but some git GUIs hide them.

Some markers carry other labels than `ours` / `theirs`, when the two choices aren't the two
branches:

| Labels | Meaning |
|---|---|
| `as merged` / `renamed (check)` | A rename c3merge wasn't sure how to apply here. The first is the text as it was, the second c3merge's guess. |
| `as merged` / `fix in C3` | A function call whose argument count doesn't match the function any more. Fix the call in C3. |
| `keep both, then rename one in C3` / `drop this one` | Both branches created an event variable with the same name in one scope. |

## Case by case

### Things added on both sides
Instances, layers, events, event variables, instance variables, behaviors, animations,
object types, families, layouts, event sheets, project bar folders, files and addons.
Git conflicts when both sides add lines at the same place. c3merge keeps both.

Where order matters, such as the z-order of instances in a layer, event order, or the
layout list, and both inserted at the same spot, ours goes first and you get an order
warning. Where C3 doesn't care about order, no warning is given. Examples are the project
bar (C3 sorts it by name, except layouts) and the `usedAddons` list.

### Different edits to the same thing
One side moves an instance and the other changes its instance variable. Or one edits an
event's condition and the other adds an action to it. Each element is matched by its
identity: `uid` for instances, `sid` for events, layers and variables, and the name for
effects and folders. Then each is merged field by field. The same change on both sides is
fine.

**Conflict** when the same value was changed to two different things.

### An instance moved to another layer
Instances are matched across the layers of a layout. When one side moves an instance to
another layer and the other edits it, c3merge applies the move and keeps the edit.
An instance matches by `sid` when one side renumbered its `uid`.

**Conflict** when each side moved it to a different layer.

### Deleted on one side, edited on the other
**Conflict**, as in git. The marker has the edited element on one side and nothing on the
other: keep it, or delete it.

The exception is changes that C3 makes by itself. They aren't edits, so the deletion wins:
- the instance only gained variables, behaviors or effects because its object type (or a
  family) gained them on that side, with the matching template flags;
- every element of the list gained the same new keys, which is what opening the project in
  a newer release does;
- the only change is a rename made elsewhere (below).

### Renames
C3 identifies object types, variables, functions and most other things by a `sid` that
never changes, so a rename is easy to see. When one side renames something, c3merge
applies the rename to the other side's changes, as C3 would have done had both people
worked in one project:

| Renamed | Updated on the other side |
|---|---|
| Object type or family | Instances, family members, containers, project bar folders, event `objectClass`, object parameters, expressions (`Player.X`), images of new animation frames |
| Instance variable or behavior | Instances and their template flags, action and condition parameters, expressions (`Player.hp`, `Player.Platform.Speed`) |
| Global variable | Every event sheet: `variable` parameters and expressions |
| Local variable | Only inside its scope: all the children of the event that declares it, and their sub-events |
| Function | `Call function` actions, `Functions.name(…)` in expressions |
| Function parameter | Inside that function |
| Custom action | Calls on that object type |

Names are matched ignoring case, like C3. A rename that only changes case updates the
structured fields and leaves expressions alone, since C3 accepts either.

**Parameters added or removed**: the other side's calls that still use the old parameter
count are fixed like C3 fixes them. A removed parameter's argument is dropped. An added
parameter gets its default value, quoted when it's a string.

**Conflict** when:
- the parameters were reordered;
- a call has an unexpected argument count;
- a `Functions.f(…)` call in an expression is affected by a signature change;
- a custom action moved to another object;
- an expression couldn't be read with certainty.

Expressions are only rewritten through a tokenizer that has to reproduce the expression
exactly. When it can't, or when a name could mean two things, the expression is left as
written and marked `renamed (check)` with the guess next to it. On Under The Red Sky's
history, the tokenizer reproduces all 29,886 expressions exactly. Replaying every rename
C3 made there changed the same 1,854 fields C3 changed. The only two differences were a
condition someone repointed by hand and a name that differed only in case.

### Two things with the same name
Two instance variables `hp` added on both sides, two layers `Background`, or two object
types with one name: **conflict**, since C3 refuses to open most of these. For event
variables, the marker lets you keep both (then rename one in C3) or drop one.

A rename can also cause this. One side adds a local variable `foo` next to `bar`, while
the other renames `bar` to `foo`: **conflict**.

### The same element replaced on both sides
Both sides deleted the same event or action and put a different one in its place. Keeping
both would change what the event does, not just its order: **conflict**.

### Script lines
The `script` lines of script actions are merged line by line, like git merges a text file.
Different lines changed on each side merge cleanly. **Conflict** when the same lines
changed.

### Files in `files/` and `scripts/`
JavaScript, images and other files there are merged by git as usual. JSON files get git's
merge when it's clean and still valid JSON. Otherwise c3merge merges them as plain JSON
objects and lists.

### Tilemaps
A tilemap painted on both sides is merged tile by tile: tiles painted on one side only are
kept, flips included, and so are tiles both sides painted the same way. It still merges
when one side resized the tilemap (added rows or columns, or shrank it) and the other
painted it.

**Conflict** when:
- the same tile was painted differently on each side. The marker's two versions both hold
  every other tile already merged, so taking either side keeps the rest of both sides'
  painting. The conflict names the tiles: "2 tiles changed differently on both sides at
  (34, 9), (35, 10)".
- each side resized the tilemap differently.
- one side painted tiles where the other side's resize hides them.

C3 also saves cells a tilemap doesn't show (left by shrinking it, or by growing it after a
shrink). They're merged like the rest, but never make a conflict. Releases after r449 (the
LTS) drop them when they load a tilemap (r495 does); r449 keeps them.

### Opaque data
Values that only make sense as a whole, such as mesh points, colour arrays and timeline
keyframes, are one value: **conflict** when both sides changed them.
The same goes for addon versions changed on both sides.

### Invalid JSON
When one side isn't valid JSON, for example because conflict markers were committed by
mistake, c3merge steps aside and git does its normal line merge.

### Editor state
`*.uistate.json` files hold open tabs, scroll positions and zoom. Your copy is kept and
they never conflict.

## Renames and the finish step

Git only calls the driver for files both sides changed. Say one branch renames
`TiledShapeDark` to `woodPlanksShape`, and the other adds a new layout with `TiledShapeDark`
instances. The new layout is only on one side, so the driver never sees it, and the
merged project refers to an object type that no longer exists. C3 refuses to open it.

The finish step closes that gap. The hooks from `c3merge init` run it right after a merge
or rebase writes its result, before anything is committed:

```
c3merge (game): applied TiledShapeDark → woodPlanksShape to 3 file(s) the merge didn't reach; not committed, check them in C3:
  layouts/MT2-2.json
  layouts/Subhub-Trials1.json
  layouts/Subhub-Trials2.json
c3merge (game): check: 0 error(s), 0 warning(s)
```

It compares names by `sid` between the common ancestor and the merged files, applies every
rename to every event sheet, layout, family and the project file, and renames image files
of new animation frames after their renamed object. The changes are left **uncommitted**,
so you can open the project in C3 and look before committing. When git committed a clean
merge right away, the fixes sit on top of that merge commit. Files still conflicted are
skipped: run `c3merge finish` again once you've resolved them.

Run it by hand after a cherry-pick, since git gives no way to tell which commits a single
cherry-pick came from, or when the hooks aren't installed:

```sh
c3merge finish
```

## When c3merge only sees one file

Following renames and recognizing C3's automatic changes needs the whole project on both
sides, so c3merge needs to know which commits are being merged. `git merge` and
`git rebase` tell it. A single `git cherry-pick` doesn't, and a criss-cross merge (several
merge bases) has no single base to compare with. c3merge then merges each file on its own. Renames made
elsewhere aren't followed during the merge, and automatic changes count as edits. You get
more conflicts, never a wrong merge. Run `c3merge finish` afterwards for the renames.

## After resolving

```sh
c3merge check game       # the project folder
```

`check` loads the whole project and finds problems that span files, such as an instance
of a type the other branch deleted, or a function called in one sheet and removed in
another. It lists the ones that stop C3 from opening the project as errors. See
[check.md](check.md). Then open the project in C3, look at anything listed under "check the
order", and commit.
