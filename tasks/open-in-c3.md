# Open the merged project in C3

**Status:** designed from measurements (2026-09-27), not started. Runs through c3cli.

## Why
- Catch what a merge broke that C3 refuses and `check` may not see. Real case: biogun's
  `main` tip (`e07972370`) lists `ScirraArcade` in `project.c3proj` while the other side had
  deleted its file; C3 refuses to open it ([test-corpus.md](test-corpus.md)).
- Settle merges across C3 releases: re-saving every version in one release first removed 173
  of 174 deleted-vs-changed conflicts on con-sule ([release-migrations.md](release-migrations.md)).

Maybe on by default, with an opt-out (skymen, 2026-09-26).

## Cost (each project's latest commit, its own release)
| Project | Size | Files | Fresh profile, bundled addons trusted | Error in project.c3proj | Conflict markers in a layout |
|---|---|---|---|---|---|
| Flechita (r449-4) | 117 MB | 2,552 | 2.7 s | 3.1 s | 4.0 s |
| Vicky (r445) | 329 MB | 3,025 | 5.1 s (warm) | 3.0 s | 4.3 s |
| UTRS (r449-5) | 281 MB | 2,420 | 4.0 s | 3.1 s | 5.4 s |
| Stardiver (r449-5) | 258 MB | 7,376 | 9.7 s | 3.1 s | 8.1 s |
| con-sule (r495-2) | 168 MB | 9,393 | 33.8 s | 3.3 s | 6.3 s |
| biogun (r449-5) | 2.3 GB | 32,567 | 70.6 s (warm) | 4.2 s | 53.5 s |

Plus about 2–3 s to start the editor. Error columns: with the editor running and addons
already accepted. Scripts in `fixtures/real/common/` (`timing.ts`, `timing-warm.ts`,
`seed-remembered.ts`, `biogun-lts.ts`, `biogun-errors.ts`).

- Bundled addons cost nothing now: c3cli trusts them before opening (their SHA-256 in C3's
  `c3-remembered-addons`), so there are no install prompts, even in a fresh profile (c3cli
  `src/remember.ts`, uncommitted). Before that, answering the prompts was most of the time
  (UTRS: 161 s → 4 s). No shared profile needed.
- The project's size sets the rest: errors in `project.c3proj` show in 3–4 s, errors inside
  layouts only once C3 reaches them (53 s on biogun).
- Don't use c3cli's Save as for the re-save: it rewrites `bundleAddons` and unbundles every
  addon (c3cli backlog). Plain save, or fix it first.
- c3cli opens by drop, which old editors don't take (biogun's r336, trubija's r351, Astral
  Ascent's r2xx): no C3 step for projects that can't open on their own release.

## Addons that aren't bundled (skymen, 2026-09-27)
When the open fails because of missing addons, warn and say how to fix it:
- put their `.c3addon` files in `extraAddons/` **next to the project's `project.c3proj`**
  (for Stardiver that's `Construct Project/extraAddons/`, not the repo root);
- or say where to find them in a `.c3mergeconfig`.

c3merge then passes those files to c3cli (`addons`), which installs them before opening.
C3 doesn't mind the folder: a project with `extraAddons/` opens with no dialog, and a save
keeps it (r449-5, 2026-09-27).

Warning, roughly: "Couldn't open the merged project in Construct to check it: it uses addons
that aren't bundled with it (Spriter by BrashMonkey). Put their .c3addon files in
`Construct Project/extraAddons/`, or list where to find them in `.c3mergeconfig`, then run
the check again. To skip this check, set it off in `.c3mergeconfig`."

Seen in the replays: biogun needs Spriter (not bundled); older UTRS commits list 1–3 addons
their `addons/` folder didn't have yet.

`.c3mergeconfig` is a JSON file next to the project's `project.c3proj`, like `extraAddons/`
(skymen, 2026-09-27), e.g. `{ "extraAddons": ["../shared/addons"], "openInC3": true }`, paths
relative to the file. It also holds the opt-out.

Legacy SDK v1 addons: c3cli installs them unchanged through the Addon manager ("Install new
addon…"), like a user; dropping them didn't work because the editor's drop handler skips SDK
v1 plugins and behaviors (c3cli, 2026-09-27). On r449-5 a project using an unbundled SDK v1
addon then opens and previews. After r449 C3 refuses SDK v1 addons however they come, so
those projects only open on the LTS. (Relabelling a copy as SDK v2 was tried and dropped: it
broke preview.)

## Several projects in one repo (skymen, 2026-09-27)
Only open the projects the merge changed. A project is affected when a file under its folder
(the folder holding its `project.c3proj`, deepest match) differs between ours and the merge
result: `git diff -z --name-only <ours> <result>`, each path mapped to its project. A project
the merge left as ours had it has nothing new to check. Example: Stardiver's repo holds
`Construct Project/` and `Tools/Palette Generator/`; a merge touching only the game opens only
the game.

The finish step (`src/finish.ts`) runs over every project in the repo today (static checks,
cheap); the C3 step shouldn't.

## Open questions
- When it runs: after the driver merged every file (the finish step already runs then), and
  on `c3merge check --open`.
- Which release: the project's own; for a merge across releases, the newer side's.
