# Distribution / releases

**Status:** `@skymen75/c3cli` 0.1.0 published (2026-09-24); `@skymen75/c3merge` 0.1.0 ready to
publish (dry run passes). The other channels aren't started.

## npm (2026-09-24)
- Names: `@skymen75/c3cli` and `@skymen75/c3merge`. npm refused the unscoped `c3cli` as too
  similar to `cli` and `cp-cli` (2026-09-24); the commands are still `c3cli` and `c3merge`.
  `publishConfig.access` is `public`, which scoped packages need.
- Both packages are MIT and version 0.1.0. They ship only `dist`, `bin`, `docs`, README
  and LICENSE (`files`). `prepublishOnly` runs the tests and the build.
- c3merge's `postinstall` (`bin/postinstall.js`) runs `c3merge install` on a **global** npm
  install only (`npm_config_global`). Local installs and npx don't touch git config. It
  never fails the install.
- `c3merge install` and `init` refuse to run from npx's cache (`_npx` in the script's real
  path): git and the hooks would keep calling a path npm cleans up. `npx @skymen75/c3merge check`
  works (the CI example uses it).
- Order (skymen): c3cli first. c3merge's `prepublishOnly` refuses while a dependency is a
  `file:` path, so its devDependency on c3cli has to move to the npm version first:
  `"c3cli": "npm:@skymen75/c3cli@^0.1.0"`, an alias that keeps `from "c3cli"` imports working.
- Checked from the packed tarballs (fake HOME): global install sets up git; `init`,
  `doctor` and a real merge work; npx `install`/`init` refused, npx `check` works; a local
  dependency install leaves git config alone; the global c3cli opens a project; the
  library imports from a local install.


- Channels: npm (`npm install -g @skymen75/c3merge`), gh extension, Homebrew tap (`skymen/tap/c3merge`), raw
  release binaries. All from one release workflow.
- Versioning: semver for the tool. Profiles carry a `c3Release` range they were validated
  against; `check` warns when the project's `savedWithRelease` is outside it.
- Track C3 releases: a scheduled job that opens the fixture project in the newest beta via
  c3cli, saves, diffs — detects format changes early.
- Windows: driver path with spaces; test on a Windows runner (many C3 users).
