# How c3merge works

For contributors. Decisions and their reasons are in [DESIGN.md](../DESIGN.md), and the
detailed notes and findings are in [`tasks/`](../tasks/).

## Layout

```
src/
  cli.ts                 commands
  driver.ts              the merge driver git calls, install / init / doctor, the hooks
  context.ts             what changed across the whole project on each side (from git)
  finish.ts              the finish step: renames applied to every file after a merge
  engine/
    merge.ts             mergeFile(): the structural 3-way merge of one file
    moves.ts             instances moved between layers
    renames.ts           renames: detection, application, leftovers
    expressions.ts       C3 expression tokenizer and renamer
    lines.ts             line-by-line merge (script lines)
    render.ts            output in C3's format, conflict markers
  profiles/
    profiles.json        per file kind: how each list is matched and merged
  model/project.ts       loads a project (folder or .c3p) for check
  check/                 invariants, severities from the lab (lab-matrix.json)
```

## One file: `mergeFile(path, base, ours, theirs, context?)`

1. **Shortcuts.** If one side is unchanged, or both are identical, that side's bytes are
   returned as they are.
2. **Parse.** A side that isn't JSON throws `ParseError`, and the driver hands the file
   to `git merge-file` instead.
3. **Renames** (`applyRenames`, with the project context). Renames on one side are applied
   to the base and to the other side before merging. The merge then sees the same names
   everywhere, and a reference the other side added under the old name comes out renamed.
4. **Moves** (`reconcileMoves`). An instance that one side moved to another layer is moved
   the same way in the base and the other side, so the merge sees it in one place. Moved
   differently on each side gives a forced conflict.
5. **Merge** (`Merger`), recursively:
   - Objects: key by key. A key changed on one side takes that side's value. Changed the
     same way on both sides is fine. Changed differently: recurse into containers, or
     conflict on scalars (except `scalar: max` rules, used for `savedWithRelease`).
   - Lists with an identity rule: elements are matched by `id` keys, with `also` as a
     second key (instances: `uid`, then `sid`). Each element is merged, then the order.
     Added on both sides at the same spot: ours first, plus a warning. Both sides replaced
     the same base element with different ones: a conflict.
   - Deleted on one side, changed on the other: a conflict, unless the change was only
     automatic (`onlyAutomatic`).
   - Lists without identity, and `atomic` values such as tilemap data: one value.
   - `lines` rules (script lines): `mergeLines`, a diff3 line merge.
   - After merging a list: two elements with the same name where every version had
     unique names gives a conflict (`checkDuplicateNames`, `checkDuplicateVariables`).
6. **Leftovers** (`flagLeftovers`). Expressions the renamer wasn't sure about, and calls
   with the wrong argument count, become conflicts with their own labels.
7. **Render.** A merge result without conflicts is written in C3's format: tabs, `\n`,
   no final newline. Conflicts become marker hunks placed so that keeping either side
   leaves valid JSON. A hunk at the end of a list or object takes in the element before it,
   so the commas stay right on both sides.

Conflicts and warnings carry a `path` (exact: `layers[sid=…]`) and a `where` for people
(`layers[Layer 0].instances[Sprite#2]`).

## Profiles

`src/profiles/profiles.json` has one entry per file kind, chosen from the path git passes.
Each maps JSON path patterns to a rule:

```json
"**.instances[]": { "id": ["uid"], "also": ["sid"], "moves": true, "order": "ordered" }
```

| Rule | Meaning |
|---|---|
| `id`, `also` | Match list elements by these keys |
| `order: "ordered"` | Position matters: merge it, warn when ambiguous |
| `order: "set"` | Position doesn't matter (C3 sorts it, or it's meaningless) |
| `moves` | Elements can move between lists of the same kind in one file (layers) |
| `atomic` | One value, never merged inside |
| `scalar: "max"` | Both changed: keep the larger |
| `lines` | Merge line by line |

The rules come from a survey of 49 real projects ([reports/profile-survey.md](../reports/profile-survey.md),
[tasks/profiles.md](../tasks/profiles.md)). Unknown lists fall back to matching by `uid` or
`sid` when every element has one, and otherwise to one value. A new C3 release needs no
code change.

## Project context

The driver sees one file at a time, but renames and automatic changes are project-wide.
`driverContext` works out which commits are being merged:
- `git merge` sets `GITHEAD_<sha>` for the other side;
- a rebase has the commit being replayed as the last line of `.git/rebase-merge/done`;
- a single cherry-pick gives nothing to go on.

It then reads, at base, ours and theirs:
- every object type and family (sid, name, plugin, variables, behaviors, effects);
- every event sheet's variables (with their scope), functions and custom actions (with
  their parameters).

The result is cached in `.git/c3merge/context-v3.json` for the rest of the merge. Without a
context (cherry-pick, or a criss-cross merge with several merge bases) each file is merged
on its own. Renames then aren't followed during the merge, and C3's automatic changes
count as edits. That means more conflicts, never wrong merges.

`changes(base, side)` gives, per side, what each type gained (variables, behaviors,
effects) and the renames by sid. `onlyAutomatic` uses it to tell C3's own changes from
edits.

## Renames and expressions

`renames.ts` finds renames by sid:
- object types and families;
- instance variables and behaviors;
- global and local variables, with their scope;
- functions and their parameters;
- custom actions.

Each rename is applied to structured fields (instance `type`, `objectClass`, parameters
naming a variable, `callFunction`, family members, containers, project folders) and to
expressions. The event tree walk keeps track of which locals and parameters are visible
where: a local reaches all the children of its parent event, and a parameter its function
block. C3 doesn't allow shadowing, so a bare name inside a scope is certainly that scope's
variable.

`expressions.ts` tokenizes an expression exactly. Printing the tokens must give back the
same text, and an unknown character makes it give up. It then renames:
- `Type.member` and `Type.Behavior.member`, with `Self` resolved from the action's object;
- bare names, which are event variables or system expressions, never objects;
- `Functions.name(`.

Names ignore case. After renaming, the result is tokenized again and must still be
well-formed. Anything unsure comes back `uncertain`, and the expression is left as written
and flagged. Checked against 29,886 real expressions (`scripts/expression-corpus.ts`).

Signature changes mirror what C3 does to existing calls: a removed parameter's argument is
dropped, and an added one gets its default (`"text"` quoted, numbers as text, booleans as
JSON). Anything else is flagged.

## The driver and the finish step

`mergeDriver` (called as `c3merge merge-driver %O %A %B %P`) writes the result over `%A`
and exits 0 when merged, 1 on conflicts. Conflicts and warnings go to stderr and to
`.git/c3merge/conflicts.md`, which starts over for each operation. JSON outside C3's own
folders (`files/`, `scripts/`) gets `git merge-file` first, with the histogram diff like
`git merge`, and the structural merge only if that conflicts or isn't valid JSON.

`finish` runs after the merge from the `post-index-change` hook (with `1` and `GITHEAD_*`
set, which only a merge writing its result has) and from `post-rewrite` after a rebase:
- it compares names by sid between the merge base and the files on disk;
- it applies the renames to every C3 file that isn't still conflicted, and renames new
  frames' image files;
- it leaves the changes uncommitted, then runs `check`.

## Testing

```sh
npm test
```

- `test/engine.test.ts` and `test/cases.ts`: merge cases (base, ours, theirs, context →
  expected result, conflicts and warnings).
- `test/expressions.test.ts`: the tokenizer and renamer.
- `test/driver.test.ts`: real `git merge`, `rebase` and `cherry-pick` in temporary
  repositories, with the driver installed `--local`, including the finish step.
- `test/check.test.ts`: every lab corruption trips its invariant; real projects stay
  clean.

Against a real project's history (read-only; copies go to `fixtures/real/`, which is
gitignored):

```sh
npx tsx scripts/extract-triples.ts <repo>          # base/ours/theirs of every merge
npx tsx scripts/replay-triples.ts --repo <repo>    # c3merge vs git on each file
npx tsx scripts/success-report.ts <repo> > report.json
npx tsx scripts/rename-truth.ts <repo>             # renames vs the ones C3 made
npx tsx scripts/replay-merge.ts <repo> <merge> --open --branch lts   # replay one merge, open the result in C3 (c3cli)
```
