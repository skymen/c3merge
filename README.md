# c3merge

A git merge driver and a validator for Construct 3 projects saved as folders.

Git merges C3's JSON files line by line. That fails on the most common team situation:
two people both add something at the same place. Both add an instance at the end of a
layer, both add an object to the project bar, or both add an addon. The right result is
obvious, but git produces a conflict in the middle of a JSON file. c3merge merges those
files by structure: instances by `uid`, events by `sid`, project bar items by name. It
also follows renames made on the other branch.

**Rule: it only merges what is certainly right.** Anything it can't be sure of becomes a
normal git conflict, marked only around the part that conflicts, for you to resolve. It
never picks a side for you.

```
$ git merge feature/new-level
c3merge: game/layouts/Level 1.json: 1 conflict(s), 1 order warning(s); details in .git/c3merge/conflicts.md
Auto-merging game/layouts/Level 1.json
CONFLICT (content): Merge conflict in game/layouts/Level 1.json
```

```
## game/layouts/Level 1.json

1 conflict(s): pick a side at each <<<<<<< marker in the file, then `git add` it.
- layers[Layer 0].instances[Sprite#2].world.y: changed on both sides

Merged, but check the order in the editor:
- layers[Layer 0].instances: added at the same place on both sides: kept ours first, check the order in the editor
```

On the 103 real merges in one team project's history (Under The Red Sky), with git alone
84 files ended in conflict; with c3merge, 45 did. 11 of the 39 conflicted merges became
fully clean. A known bug in one third-party addon (3D Object recomputing its bounds) is
left out of these numbers, on both sides.

## Install

You need **Node 22+** and **git** (2.44+ recommended).

```sh
npm install -g @skymen75/c3merge
```

This also sets up git on your machine: it adds the merge driver to `~/.gitconfig`. With
another package manager, or with `--ignore-scripts`, run `c3merge install` yourself once.

Install it globally rather than running it through `npx`. Git keeps calling c3merge at the
path it was set up with, and npx's cache gets cleaned up. `c3merge install` and
`c3merge init` refuse to run from npx.

## Add it to a Construct 3 project

In the git repository that holds the project (the project folder can be the repository
root or any subfolder):

```sh
cd my-game
c3merge init             # writes .gitattributes, installs two hooks in this clone
git add .gitattributes
git commit -m "Merge Construct 3 files with c3merge"
c3merge doctor           # checks the setup
```

Every teammate runs `npm install -g @skymen75/c3merge` once on their machine and `c3merge init`
once in their clone. A teammate without c3merge is unaffected: git ignores the attributes
and merges as usual.

The full guide, including GUI git clients, existing hooks, removal and troubleshooting,
is in [docs/install.md](docs/install.md).

## After a merge

1. Open `.git/c3merge/conflicts.md` if git reported conflicts. It lists each one with a
   location you can find in C3 (layout, layer, instance, event).
2. In each conflicted file, keep one side at each `<<<<<<<` marker. Your editor's
   "Accept Current / Incoming" buttons work, and either choice leaves valid JSON. Then run
   `git add` on the file.
3. Run `c3merge check <project folder>` to find problems that span several files, such
   as an instance whose object type the other branch deleted.
4. Open the project in C3 and look at anything listed under "check the order". Commit
   when it looks right.

Renames made on the other branch are applied to every file right after the merge, not
only to the files git asked c3merge to merge. These fixes are left uncommitted so you can
review them in C3 first. See [docs/merging.md](docs/merging.md).

## What it merges, and what stays a conflict

Merged automatically:
- Things added on both sides: instances, layers, events, variables, object types,
  project bar items, files, addons.
- Different edits to the same instance, event or object (one moves it, the other changes
  a variable).
- An instance moved to another layer on one side and edited on the other.
- Renames made on one side: object types, families, instance variables, behaviors, event
  variables (with their scope), functions, function parameters and custom actions. These
  are applied to the other side's new instances, events and expressions. Calls are fixed
  the way C3 fixes them when a parameter is added or removed.
- Script lines, line by line.
- Deleted on one side while the other side only has changes C3 made by itself
  (variables added to the object type, new keys from a newer release, a rename).

Always a conflict:
- A value changed differently on both sides.
- Deleted on one side and really edited on the other.
- The same event element replaced by different ones on each side.
- Two things created with the same name (two instance variables `hp`, two layers
  `Background`, two event variables `score` in one scope).
- Tilemap data and other opaque data changed on both sides.
- An instance moved to different layers on each side.
- A rename that can't be applied with certainty. The unsure expression is left as it was
  and marked, with the guess next to it.

Not handled by c3merge: images, sounds and other binary files, which git merges as
usual; `.c3p` files, which are single zip files, so use folder projects; GitHub's merge
button, which never runs merge drivers, so resolve locally.

## Commands

| Command | What it does |
|---|---|
| `c3merge install [--local]` | Set up the merge driver in git config (once per machine) |
| `c3merge init` | Write `.gitattributes` (commit it) and install the hooks (this clone) |
| `c3merge doctor` | Check the setup and print fixes |
| `c3merge check <project> [--json \| --github] [--all]` | Find cross-file problems that stop C3 from opening the project |
| `c3merge finish` | Apply renames after a merge by hand (the hooks run it for you) |
| `c3merge invariants` | List what `check` looks for, with the measured C3 behaviour behind each severity |
| `c3merge merge-driver %O %A %B %P` | The driver itself, called by git |

## Docs

- [docs/install.md](docs/install.md): setting it up in a project, for a team, and removing it
- [docs/merging.md](docs/merging.md): what happens during a merge, case by case, and how to resolve
- [docs/check.md](docs/check.md): the validator, and running it in CI
- [docs/how-it-works.md](docs/how-it-works.md): the engine, for contributors
- [DESIGN.md](DESIGN.md) for decisions, [NOTES.md](NOTES.md) for the backlog, [`tasks/`](tasks/) for the detailed notes

## Development

```sh
git clone <this repository> && cd c3merge
npm install
npm test                 # engine, expressions, driver (real git merges in temp repos), check
npm run build
npm link                 # use this checkout as the global `c3merge` (sets up git like a global install)
```

Scripts in `scripts/` replay a real project's history against the engine. They are
read-only on that project, and their copies go to `fixtures/real/`, which is gitignored:
- `extract-triples.ts`, `replay-triples.ts`: every merge's base, ours and theirs, with
  and without c3merge.
- `success-report.ts`: per-file results against git.
- `rename-truth.ts`: renames checked against the ones C3 itself made.
- `replay-merge.ts`: replays one merge in a clone and opens the result in C3 through
  c3cli.

c3cli is a dev dependency only, used for these checks and the lab. c3merge runs without it.

Tested on macOS with git 2.50. Windows hasn't been tested yet.
