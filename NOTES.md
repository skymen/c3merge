# c3merge — backlog

Structural, schema-aware 3-way merge + cross-file validator for Construct 3 projects,
shipped as a git merge driver, a `gh` extension and a reusable GitHub Action.
Design decisions live in [DESIGN.md](DESIGN.md). Each item links a detail doc in
[`tasks/`](tasks/) where one exists. Sibling project: `~/Documents/c3cli` (drives the C3
editor; c3merge's lab experiments and CI checks depend on it).

Tags: `[core]` generic keyed 3-way merge engine · `[profiles]` per-file-kind schema knowledge ·
`[check]` cross-file validator · `[driver]` git integration · `[cli]` command surface ·
`[gh]` gh extension packaging · `[action]` GitHub Actions workflow · `[lab]` experiments
against the real editor (via c3cli) · `[corpus]` fixtures and golden tests · `[dist]`
packaging/release · `[docs]`

## Now

- [corpus] Build the fixture corpus: tiny hand-made projects + one real base/ours/theirs triple per file kind ([tasks/test-corpus.md](tasks/test-corpus.md))
- [profiles] Write the per-kind profile table from real files before writing the engine ([tasks/profiles.md](tasks/profiles.md))
- [core] Generic keyed 3-way merge engine: identity matching, sid fallback, order-semantic lists, delete-vs-modify, collision log, exit codes ([tasks/core-merge-engine.md](tasks/core-merge-engine.md))
- [core] Output must be byte-identical to what C3 writes: `JSON.stringify(v, null, "\t")` (compact for uistate/brushes), no trailing newline, verified on 2,121 files ([tasks/core-merge-engine.md](tasks/core-merge-engine.md#output-fidelity))
- [driver] Git merge driver: `%O %A %B %P` protocol, `.gitattributes` template, `install` / `init` / `doctor` commands ([tasks/git-driver.md](tasks/git-driver.md))

## Normal

- [check] Action/condition ids per addon (lab row 11): needs each addon's ACE list; maybe from the editor via c3cli, per release ([tasks/check-validator.md](tasks/check-validator.md))
- [check] Post-merge hook: driver runs `check` on the whole project once all files are merged, not per file ([tasks/check-validator.md](tasks/check-validator.md#when-to-run))
- [profiles] Order-semantic lists: events (execution order), layer instances (z-order), layers, animations frames — define insert-position rule and when a reorder is a real conflict ([tasks/profiles.md](tasks/profiles.md#ordering))
- [core] Secondary matching when a sid exists on only one side (C3 regenerated it): match by name/type/objectClass+position before treating as delete+add ([tasks/core-merge-engine.md](tasks/core-merge-engine.md#sid-fallback))
- [driver] Conflict representation: JSON can't hold `<<<<<<<` markers. Best-effort merged file + collision log + exit 1 so git marks the path conflicted ([tasks/git-driver.md](tasks/git-driver.md#conflicts))
- [driver] `merge=ours` fallback attribute for `*.uistate.json` (normally gitignored) ([tasks/git-driver.md](tasks/git-driver.md#attributes-template))
- [action] Reusable workflow: `check` as a PR status + auto-resolve conflicts with the driver + "install c3merge" nudge comment ([tasks/github-action.md](tasks/github-action.md))
- [gh] `gh extension install skymen/gh-c3merge`, `gh c3merge install|init|doctor|check` ([tasks/gh-extension.md](tasks/gh-extension.md))
- [corpus] Golden tests: for every fixture triple, expected merged output + expected collision list; run in CI ([tasks/test-corpus.md](tasks/test-corpus.md#golden-tests))
- [lab] Mine real history for merge triples: the Under The Red Sky `New-web-build` merge (`115db4b4`) has base/ours/theirs for hundreds of files — read-only extraction, never modify that repo ([tasks/test-corpus.md](tasks/test-corpus.md#real-triples))

## Later

- [profiles] Timelines, tilemap tile data, 3D mesh data, Flowcharts, Hierarchies/templates: opaque-blob policy vs partial merge ([tasks/profiles.md](tasks/profiles.md#opaque))
- [profiles] Profiles as data (JSON/YAML) so a new C3 file kind or release doesn't need a rebuild; fallback profile for unknown files
- [check] Repair mode: `check --fix` for the classes C3 does *not* repair itself (dedupe sids, drop dangling references with a report)
- [driver] `git rebase` / `cherry-pick` / `stash pop` behavior: verify driver fires and collision log is still reachable
- [driver] Binary assets (PNG, audio) stay ordinary git conflicts — document, don't try to merge
- [dist] npm package, Homebrew tap, gh extension binaries per OS, version scheme tracking C3 releases (`savedWithRelease`) ([tasks/dist.md](tasks/dist.md))
- [action] GitLab CI equivalent (only if asked)
- [docs] README: install in 2 commands, what it does/doesn't merge, how to read the collision log

## Ideas

- `c3merge diff a.json b.json`: structural diff in C3 terms ("instance Player moved", "event 12 condition changed") — reuse the matching engine, useful in PRs
- `c3merge blame`-style: which branch introduced which event
- A tiny VS Code / GitHub PR renderer for the collision log
- Detect C3 "repaired on load" from the editor log and feed it back into the tolerance matrix automatically

## Notes

- Verified in the r500 editor bundle: the only URL params are `project`/`layout`/`eventsheet`
  (dev-mode only, loads `exampleProjects/debug/*.capx`), `#open-example-browser`, and flags
  (`safe-mode`, `debug`, `log-pane`, `perf`, `firstrun`, `slow-animations`, ...). There is no
  public open-from-URL. Opening must go through drop / file pickers / launchQueue / internal
  API — that's c3cli's job.
- Git never prompts for a missing merge driver: unknown `merge=c3` silently falls back to
  text merge. So `.gitattributes` is safe to commit everywhere; the one-time per-machine step
  is the `merge.c3.driver` config line. The GitHub Action nudge comment is the "recommended
  extension" equivalent.
- GitHub's PR merge button does not run merge drivers; conflicts resolve locally or via the
  Action.
- Existing prior art to read once, then ignore: `Under The Red Sky/tools/c3merge/c3merge.py`
  (one-off, Sep 2026). Confirms uid/sid/name keying works on real data; has one-off rules
  (BFC, OURS_KEYS) that must not carry over.
