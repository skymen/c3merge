# Release watch: does a new C3 release break c3merge?

**Status:** designed (2026-09-26), not started. A scheduled GitHub Actions job, **weekly**
(skymen may move it to monthly if it costs too much), that tests each new C3 release once
and reports breaks as issues (skymen, 2026-09-26).

## What it runs
Only what involves C3. `npm test` never touches the editor, so its result can't change
with a C3 release. (It runs before every publish; no CI on purpose.)
- **Lab** (`npm run lab -- --releases <rX>`): every corruption row, about 75 s per release
  on the 3-tab c3cli pool. Each row's verdict (editor: loads / repairs / refuses…, and
  preview) is decided by the row's own presence check, not by bytes, and lands in
  `results.json`.
- **Fidelity** (`scripts/fidelity.ts --release <rX>`): a real merge on lab-base; C3 must
  open the merged project with no dialog, and `check` must be clean. 10 s on r503. The
  field differences it prints (C3's own normalizations, e.g. new timeline keys) never
  count: they change with every release.

## What counts as broken
Each run tests the **candidate** (newest release, beta or stable) and a **baseline** (the
last release that passed; at first, the newest release in `src/check/lab-matrix.json`) in
the same job, so a bad runner, a network problem or the editor site being down can't
pass for a C3 change:
- Baseline control row fails → environment problem: the run fails, no issue, the candidate
  isn't marked as tested (tried again next time).
- Candidate control fails while the baseline's passes, still after one retry → "c3cli can't
  open the lab project in rX" (C3 changed its UI or loader) → issue.
- A row's verdict differs between candidate and baseline, still after one retry of that
  row → issue with each row's before → after. It means `check`'s severities are out of
  date for rX (e.g. C3 now refuses something `check` calls a warning).
- Fidelity: the merged project doesn't open, or `check` isn't clean on C3's save → issue.

## State and issues
- Nothing is committed to the repo. Each run uploads its lab and fidelity output as an
  artifact named `c3-watch-<release>-pass` or `-fail` (kept 90 days). The job first lists
  the repo's artifacts and stops unless the candidate is newer than every release tested
  so far. The newest `-pass` is the next baseline.
- Break, no open issue labelled `c3-release` → new issue "C3 rX breaks c3merge": what
  failed, the run link, the artifact, and a hidden `<!-- c3-watch rX -->` marker.
- Break while such an issue is open → a comment on it instead ("rY also breaks: …").
- A newer release passes while such an issue is open → a comment "rY passes", nothing
  else. The job never closes issues: skymen closes them once they're safe (2026-09-26).
- Closing the issue (after fixing c3merge) means the next break opens a new one.
- `workflow_dispatch` with a `release` input re-tests one release by hand, e.g. to confirm
  a fix; the "never test a release ≤ the last tested" rule only applies to scheduled runs.

## Cost
- No new release: one small job (two HTTP requests for the release numbers, one API call
  for the artifacts), no `npm ci`, well under a minute.
- New release: setup about 2 min (estimate), lab on two releases about 2.5 min,
  fidelity 10 s: about 5 min. C3 ships a beta every week or two, so roughly 10–20 min a
  month. Standard runners are free on public repos anyway (skymen/c3merge is public).

## Gotchas
- GitHub disables scheduled workflows in a public repo after 60 days with no activity in the
  repo; re-enable from the Actions tab.
- The job uses c3cli from npm (the devDependency), so a c3cli fix only reaches it after a
  c3merge dependency bump.
