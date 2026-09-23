# GitHub Action

**Status:** not started (2026-09-21)

Reusable workflow in the c3merge repo; projects add one file:
```yaml
# .github/workflows/c3merge.yml
on: [pull_request]
jobs:
  c3:
    uses: skymen/c3merge/.github/workflows/c3merge.yml@v1
    permissions: { contents: write, pull-requests: write }
```
Included by `c3merge init` and by project templates.

## Jobs
1. **check** — `c3merge check .` on the PR's merge ref (`refs/pull/N/merge`), annotate via
   `--github`, fail the job on errors. Runs even when there's no conflict: catches broken
   merges done locally without the driver.
2. **resolve** — only when `pull_request.mergeable == false` (GitHub computes this async:
   poll `GET /pulls/N` until `mergeable` is non-null, up to ~30 s). Steps: checkout PR head,
   `c3merge install --local`, `git merge origin/<base>`; if exit 0 and `check` clean → commit
   "c3merge: merge <base> into <head>" and push to the PR branch. If collisions → don't push;
   post/refresh one comment with the collision log and instructions. Fork PRs: needs
   "allow edits from maintainers" and `pull_request_target`? No — never run untrusted code
   with write perms; for forks just comment.
3. **nudge** — if the PR's merge commits (commits with 2 parents in the PR range) touched C3
   JSON *and* show text-merge fingerprints (a duplicate sid, a broken reference, or literally
   `<<<<<<<` in a JSON file), post one comment: "this repo uses c3merge; install with
   `gh extension install skymen/gh-c3merge && gh c3merge install`". This is the
   "recommended extension" equivalent; without it nobody finds out the driver exists.

## Details
- Binary: download release asset for the runner OS, cache by version. Pin `@v1` major.
- Concurrency group per PR to avoid double pushes.
- Never force-push; if the PR moved while resolving, retry once, then comment.
- Comment marker `<!-- c3merge -->` to find and update the single bot comment.
