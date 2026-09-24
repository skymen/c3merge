# Installing c3merge in a Construct 3 project

c3merge works on projects saved as a **folder** (Menu → Project → Save as → Save as project
folder), tracked in git. A `.c3p` file is a single zip, and git can't merge it.

There are three setup steps, each at a different level:

| Where | Command | How often | Shared? |
|---|---|---|---|
| Your machine | `npm install -g @skymen75/c3merge` | Once | No: in `~/.gitconfig` |
| The repository | `c3merge init`, then commit `.gitattributes` | Once per project | Yes: committed |
| Your clone | `c3merge init` | Once per clone | No: in `.git/hooks` |

## Requirements

- Node 22 or newer
- git; 2.44 or newer gives the same line merges as `git merge` for files c3merge hands back
  to git; older versions still work
- macOS and Linux. Windows hasn't been tested yet.

## 1. Install it on your machine

```sh
npm install -g @skymen75/c3merge
```

To update, run the same command again.

A global install with npm also sets up git by running `c3merge install` for you. With
another package manager, or `--ignore-scripts`, that step may not run. `c3merge doctor`
tells you, and this does it:

```sh
c3merge install
```

This adds three lines to `~/.gitconfig`:

```ini
[merge "c3"]
	name = c3merge: structural merge for Construct 3 projects
	driver = '/path/to/node' '/path/to/c3merge' merge-driver %O %A %B %P
[merge "ours"]
	driver = true
```

`merge.ours` keeps your own copy of C3's `.uistate.json` files (open tabs, scroll positions)
instead of merging them.

- `c3merge install --local` writes the same lines to the current repository's `.git/config`
  instead, for people who don't want global settings.
- The paths are absolute on purpose. Git GUIs (GitHub Desktop, Fork, Sourcetree...) often
  run without your shell's PATH, and absolute paths still work there.
- Run `c3merge install` again if you remove the Node version it recorded (for example with
  nvm). `c3merge doctor` tells you when either path is missing.
- Don't set it up through `npx`: npx runs c3merge from a cache that npm cleans up, and git
  would keep calling the old path. `c3merge install` and `c3merge init` refuse to run from
  npx. Commands that don't record a path, such as `npx @skymen75/c3merge check`, work fine.

## 2. Set up the project

In the repository that contains the project:

```sh
cd my-game
c3merge init
git add .gitattributes
git commit -m "Merge Construct 3 files with c3merge"
```

`init` does two things.

**`.gitattributes`** (commit it). It tells git which files go through c3merge:

```gitattributes
# c3merge begin: structural merges of Construct 3 projects
*.c3proj                  merge=c3
**/eventSheets/**/*.json  merge=c3
**/layouts/**/*.json      merge=c3
**/objectTypes/**/*.json  merge=c3
**/families/**/*.json     merge=c3
**/timelines/**/*.json    merge=c3
**/flowcharts/**/*.json   merge=c3
**/files/**/*.json        merge=c3
**/scripts/**/*.json      merge=c3
*.uistate.json            merge=ours
# c3merge end
```

The patterns match at any depth. The project can be the repository root or a subfolder,
and a repository can hold several projects. Your own lines in `.gitattributes` are kept;
running `init` again only refreshes the block between `c3merge begin` and `c3merge end`.

Only JSON goes through c3merge. Images, sounds, fonts and scripts under `files/` and
`scripts/` are merged by git as usual. JSON files under those folders get git's merge
first. c3merge only steps in when git conflicts or produces invalid JSON.

**Two hooks in this clone** (`.git/hooks/post-index-change` and `post-rewrite`). They
run `c3merge finish` right after a merge or a rebase writes its result, before anything is
committed. Git only calls a merge driver for files that both branches changed. A layout
that only you changed can still use the old name of an object the other branch renamed.
`finish` applies those renames to every file and leaves the changes uncommitted for you to
check (see [merging.md](merging.md#renames-and-the-finish-step)). Hooks can't be committed
in git, so every clone needs its own `c3merge init`.

- An existing hook is kept: c3merge adds its block to the end of it.
- A repository that uses its own hooks folder (`core.hooksPath`, as husky does) isn't
  written to. `init` prints the lines to add to that folder's `post-index-change` and
  `post-rewrite` instead.
- Without the hooks, merges still work. You run `c3merge finish` yourself after merging.

## 3. Check the setup

```sh
$ c3merge doctor
ok  git version 2.50.1
ok  merge driver: '/usr/local/bin/node' '/usr/local/lib/node_modules/c3merge/bin/c3merge.js' merge-driver %O %A %B %P
ok  hooks: finish step after merges and rebases
ok  .gitattributes: game/project.c3proj uses the c3 driver
```

Each line that isn't `ok` comes with the command that fixes it. The exit code is 0 when
everything is ok.

## Teammates

Each person runs, once:

```sh
npm install -g @skymen75/c3merge   # on their machine
c3merge init             # in their clone of the project
```

Someone who hasn't installed c3merge isn't blocked. Git silently ignores `merge=c3` when
no driver is configured, and falls back to its normal line merge for them.

GitHub's "Merge pull request" button doesn't run merge drivers. When a pull request has
conflicts, merge locally (for example, merge `main` into the branch), where c3merge runs.

## Removing it

```sh
git config --global --remove-section merge.c3
git config --global --remove-section merge.ours   # only if nothing else of yours uses merge=ours
npm uninstall -g @skymen75/c3merge
```

In each project, delete the block between `# c3merge begin` and `# c3merge end` from
`.gitattributes` (and commit), and delete the same block from `.git/hooks/post-index-change`
and `.git/hooks/post-rewrite`.

## Troubleshooting

- **A merge didn't go through c3merge.** Run `git check-attr merge -- path/to/project.c3proj`.
  It should say `merge: c3`. If not, run `c3merge init` and commit `.gitattributes`.
  Also run `c3merge doctor` to confirm the driver is configured on this machine.
- **"not valid JSON … merged as text by git".** One side of the file wasn't valid JSON
  (for example, conflict markers committed by mistake). c3merge then does exactly what git
  would do without it.
- **Markers labelled `<<<<<<< HEAD` / `>>>>>>> branch-name`, and no `c3merge:` line in
  the output.** Those are git's own line merge: the driver didn't run, for example because
  the Node version it recorded was removed. c3merge's markers say `ours` and `theirs`.
  Run `c3merge doctor`, then `c3merge install` (or `npm install -g @skymen75/c3merge` again), and
  redo the merge (`git merge --abort`, then merge again).
- **Where did the messages go?** Git GUIs don't always show what the driver prints. The
  same text is always in `.git/c3merge/conflicts.md`, which starts over at each merge.
