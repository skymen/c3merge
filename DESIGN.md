# c3merge — design

Status: pre-code, 2026-09-21. Decisions marked **(decided)** or **(recommendation)**.

## What it is

Three things sharing one core:

1. **Merge driver** — git calls `c3merge merge-driver %O %A %B %P` for files matched by
   `.gitattributes`. Structural 3-way merge, writes result over `%A`, exit 0 clean / 1 collisions.
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

Generic keyed 3-way merge over JSON values, driven by a **profile** chosen from the file path
(`%P`) with content sniffing as fallback:

- objects: merge key by key; added-on-one-side keeps; deleted-on-one-side + unchanged-other
  deletes; both-changed → recurse or collision.
- lists of objects: elements matched by an identity key from the profile
  (`uid` > `sid` > `name` > `id` in the fallback profile), then merged element-wise.
  Secondary matching for elements whose sid exists on one side only.
- lists of scalars: ordered set union (family members, folder trees).
- ordered-semantic lists (events, instances, layers): element identity as above, but the
  *position* is merged too: other side's new elements go after their nearest surviving
  predecessor; a move on one side + edit on the other is fine; a move on both sides to
  different places is a collision.
- opaque values (tile data, mesh data): pick a side, log a collision, never elementwise.
- scalars changed differently: collision. Best-effort pick (profile may say `ours`, `theirs`,
  `max`) so the file stays loadable, and exit 1 so git marks it.

Collision = `{path, kind, base, ours, theirs, chosen}`. Written to
`<repo>/.git/c3merge/collisions.md` (appended per file, cleared on `c3merge clear`) and
summarised on stderr, which git shows during the merge.

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
from the lab (`reports/lab-matrix.json`), refreshed by re-running it on new releases.

**(decided 2026-09-23)** No tool here ever saves a project with an older release than it
was saved with, or lowers `savedWithRelease` to make an older editor accept it. Going back
a release can silently lose data (r495 → r449 turned 3D `depth` into the default
`z-height` and dropped layer `sampling`). It stays a manual decision for people.

## Non-goals

- Merging binary assets (PNG, audio, fonts). Git handles those as usual.
- Being a general JSON merger. Fallback profile exists for robustness, not as a product.
- Running inside the C3 editor. The editor cannot run shell commands; nothing to do there.
- Replacing GitHub's merge button. Conflicts resolve locally or via the Action.
