# gh extension

**Status:** not started (2026-09-21)

Repo `skymen/gh-c3merge` (gh requires the `gh-` prefix). Install:
`gh extension install skymen/gh-c3merge`. Then `gh c3merge <cmd>` = `c3merge <cmd>`.

- If the core is TypeScript: publish precompiled binaries per OS/arch in GitHub Releases
  (`bun build --compile` or `pkg`); gh's precompiled-extension convention downloads the
  matching asset. The extension repo can be just release assets + README, or a thin shell
  script that finds/downloads the binary.
- If Go: `gh extension create --precompiled=go`, done.
- `gh c3merge install` is the only command most people run; make its output say exactly
  what changed (`~/.gitconfig: added [merge "c3"]`).
- `gh extension upgrade` keeps it current; `doctor` warns when the driver config points at
  an old path.
- gh is GitHub's CLI, but the installed binary works with any git host; document that.
