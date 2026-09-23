# c3merge — design

Status: pre-code, 2026-09-21. Decisions marked **(decided)** or **(recommendation)**.

## What it is

Three things sharing one core:

1. **Merge driver** — git calls `c3merge merge-driver %O %A %B %P` for files matched by
   `.gitattributes`. Structural 3-way merge, writes result over `%A`, exit 0 clean / 1 conflicts (marked in the file).
2. **Validator** — `c3merge check <project-dir>`: cross-file invariants C3 does not repair.
   Runs post-merge (all files merged), in CI on every PR, and on demand.
3. **Distribution/automation** — `gh` extension (install + commands), reusable GitHub Action
   (check status, auto-resolve, nudge).

Everything host-agnostic except the gh/Action layer.

## Layers

```
.gitattributes (per repo, committed)     which files → merge=c3
~/.gitconfig   (per machine, one line)   merge.c3.driver = c3merge merge-driver %O %A %B %P
c3merge binary                            engine + profiles + check
gh-c3merge     (thin)                     install / doctor / check wrappers
Action         (thin)                     runs the binary in CI
```

**(decided)** attributes live in the project, never in a global attributes file.
**(decided)** the per-machine config line is the only unavoidable setup; `c3merge install`
writes it (`--local` variant for people who refuse global config).

## Engine

**(decided 2026-09-23, skymen) Only merge what is certainly right.** c3merge is not meant
to resolve every merge. It handles the cases where git's line merge fails but the right
answer is unambiguous (typically both sides adding things to the same list: new objects,
files, addons, folder items). Anything it can't be 100% sure of is a **conflict for the
user**, never a best-effort pick. Delete-vs-modify is a conflict (as in git).

Generic keyed 3-way merge over JSON values, driven by a **profile** chosen from the file path
(`%P`) with content sniffing as fallback:

- objects: merge key by key; changed on one side → take it; same change on both → take it;
  different changes → recurse if both are containers, else conflict. Deleted on one side and
  changed on the other → conflict.
- lists of objects: elements matched by an identity key from the profile
  (`uid` > `sid` > `name` > `id` in the fallback profile), then merged element-wise. No
  fuzzy matching: an element whose key changed is a delete plus an add.
- unordered lists (folder `items`, `usedAddons`, family members...: order means nothing or
  C3 sorts them): set union, removals applied. Only if the survey shows the order really
  carries no meaning.
- ordered lists (events, instances, layers): position is merged too. An element added on
  one side goes after its predecessor. **Ambiguous order is a warning, not a conflict**
  (skymen, 2026-09-23): fixing order in JSON is miserable, fixing it in the editor is easy.
  Both sides inserting at the same spot (including both appending) → ours first, then
  theirs; the same element moved differently on both sides → ours' order. The file merges
  cleanly and the warning names where to look ("Layout 1 › Layer 0: check the z-order of
  Sprite#50, Sprite#60"). Exception: both sides *replaced* the same element (deleted it and
  inserted something different in its place) → conflict, since keeping both changes the
  logic, not just the order.
- opaque values (tile data, mesh data): changed on both sides → conflict, never elementwise.
- two surviving elements with the same identity or name → conflict.

**(decided 2026-09-23, skymen)** Renames and C3's automatic changes use the whole project
(tasks/core-merge-engine.md "Project context"): the other side's object type renames are
applied to references, and changes C3 makes by itself (variables a type gained, a release's
new keys on every element) don't count as edits against a deletion. Float noise from the
3D Object bug stays a conflict.

**(decided 2026-09-23, skymen)** Only C3's own files go through the structural merge.
Files under `files/` and `scripts/` are left to git, except JSON, which gets git's merge when
that's clean and valid, and a plain JSON merge otherwise.

**(decided 2026-09-23) Conflict representation: localized markers.** The merged file is
C3-formatted JSON where only the conflicting members/elements are wrapped in
`<<<<<<< ours` / `=======` / `>>>>>>> theirs` lines, so every git tool (VS Code accept
current/incoming/both) works, and choosing either side gives valid JSON. The file doesn't
open in C3 until resolved, on purpose. The driver exits 1 so git marks the path conflicted,
and appends a readable summary (JSON path, what each side did) to
`<repo>/.git/c3merge/conflicts.md` and stderr. Order warnings go to the same file and
stderr, but don't make the merge fail.

## Profiles

One per file kind, as data (JSON), with a fallback for unknown kinds. See
`tasks/profiles.md` for the table. A profile says, per JSON path pattern: identity key(s),
ordered or not, opaque or not, scalar conflict policy.

## Validator

Loads the whole project (c3proj + every JSON), builds the reference graph, checks invariants
listed in `tasks/check-validator.md`. Severity per invariant comes from the lab matrix
(`tasks/lab-experiments.md`): `refuses` → error, `repairs silently` → warning, `fine` → none.

## Language

**(decided 2026-09-23)** TypeScript on Node, **single package** (`src/engine`, `profiles`,
`check`, `driver`, `cli`). c3cli is a **dev dependency only** (`"c3cli": "file:../c3cli"`,
npm later) for the lab and fidelity tests; c3merge itself must run without it, since
merging is plain JSON. The shared `c3-model` package idea is dropped: c3cli barely reads
project files. The notes below are the original reasoning.

**(recommendation)** TypeScript on Node.

- c3cli is Playwright, so Node anyway; c3merge and c3cli share a C3 project file model
  (load project dir / .c3p, walk, resolve references) — one package, two consumers.
- You (skymen) already ship JS tooling (CAW); contributors from the C3 community are JS.
- gh extensions can ship precompiled binaries; build with `bun build --compile` or `pkg` so
  users without Node still get a single file. npm for everyone else. Homebrew tap later.
- Alternative considered: Go (nicest for gh extensions, single static binary, fast). Rejected
  only because of the shared model with c3cli; revisit if the shared-model idea dies.

## Repo layout (recommendation)

```
c3merge/
  packages/c3-model/     load/walk/reference-graph for a C3 project (shared with c3cli)
  packages/c3merge/      engine, profiles, check, driver, cli
  packages/gh-c3merge/   gh extension shim + release binaries
  action/                reusable workflow + composite action
  fixtures/              corpus (see tasks/test-corpus.md)
  docs/
```

## Future releases

**(decided 2026-09-23)** c3merge must keep working on C3 releases that don't exist yet,
without a code change. No logic keyed on release numbers or on the editor's error text.
Profiles have a fallback for unknown keys and file kinds, and validator severities are data
from the lab (`src/check/lab-matrix.json`), refreshed by re-running it on new releases.

**(decided 2026-09-23)** No tool here ever saves a project with an older release than it
was saved with, or lowers `savedWithRelease` to make an older editor accept it. Going back
a release can silently lose data (r495 → r449 turned 3D `depth` into the default
`z-height` and dropped layer `sampling`). It stays a manual decision for people.

## Non-goals

- Merging binary assets (PNG, audio, fonts). Git handles those as usual.
- Being a general JSON merger. Fallback profile exists for robustness, not as a product.
- Running inside the C3 editor. The editor cannot run shell commands; nothing to do there.
- Replacing GitHub's merge button. Conflicts resolve locally or via the Action.
