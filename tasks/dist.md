# Distribution / releases

**Status:** not started (2026-09-21)

- Channels: npm (`npx c3merge`), gh extension, Homebrew tap (`skymen/tap/c3merge`), raw
  release binaries. All from one release workflow.
- Versioning: semver for the tool. Profiles carry a `c3Release` range they were validated
  against; `check` warns when the project's `savedWithRelease` is outside it.
- Track C3 releases: a scheduled job that opens the fixture project in the newest beta via
  c3cli, saves, diffs — detects format changes early.
- Windows: driver path with spaces; test on a Windows runner (many C3 users).
