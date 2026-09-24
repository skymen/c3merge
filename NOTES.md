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


## Normal

- [check] Action/condition ids per addon (lab row 11): needs each addon's ACE list; maybe from the editor via c3cli, per release ([tasks/check-validator.md](tasks/check-validator.md))
- [check] After a merge: the driver only reminds people to run `check` (it can't tell which file is last). Group "type X doesn't exist" findings (one per instance today) ([tasks/check-validator.md](tasks/check-validator.md#when-to-run))
- [action] Reusable workflow: `check` as a PR status + auto-resolve conflicts with the driver + "install c3merge" nudge comment ([tasks/github-action.md](tasks/github-action.md))
- [gh] `gh extension install skymen/gh-c3merge`, `gh c3merge install|init|doctor|check` ([tasks/gh-extension.md](tasks/gh-extension.md))
- [corpus] Golden tests: for every fixture triple, expected merged output + expected collision list; run in CI ([tasks/test-corpus.md](tasks/test-corpus.md#golden-tests))

## Later


- [profiles] Script events that store their code as one string (`"script": "…\n…"`) should get the line merge too; key timeline tracks by what they animate ([tasks/profiles.md](tasks/profiles.md#later))
- [check] Repair mode: `check --fix` for the classes C3 does *not* repair itself (dedupe sids, drop dangling references with a report)
- [driver] `git rebase` / `cherry-pick` / `stash pop` behavior: verify driver fires and collision log is still reachable
- [driver] Binary assets (PNG, audio) stay ordinary git conflicts — document, don't try to merge
- [dist] npm package, Homebrew tap, gh extension binaries per OS, version scheme tracking C3 releases (`savedWithRelease`) ([tasks/dist.md](tasks/dist.md))
- [action] GitLab CI equivalent (only if asked)
- [driver] `c3merge resolve <file> --ours|--theirs`: take one side of every hunk in a file (`takeSide` exists)

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
