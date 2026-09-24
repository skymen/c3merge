// Git integration: the merge driver git calls for each file, and the commands that set it
// up (install, init, doctor). See tasks/git-driver.md.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { driverContext } from "./context.ts";
import { mergeFile, ParseError, type Issue } from "./engine/merge.ts";
import { profileFor } from "./profiles/index.ts";

const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const tryGit = (args: string[], cwd?: string) => { try { return git(args, cwd); } catch { return null; } };

// ── the driver ────────────────────────────────────────────────────────────────────────
// git runs: c3merge merge-driver %O %A %B %P  (cwd = worktree root). The result goes to %A.
// Exit 0: merged. Exit 1: conflicts (markers in the file), git marks the path unmerged.
export function mergeDriver(basePath: string, oursPath: string, theirsPath: string, repoPath: string): number {
  const read = (p: string) => readFileSync(p, "utf8");
  // Git passes an empty file as the base when both sides added the file.
  const base = read(basePath) === "" ? null : read(basePath);
  const ours = read(oursPath), theirs = read(theirsPath);

  // JSON that isn't a C3 file (files/, scripts/): git's line merge is fine when it's clean
  // and still valid JSON; only otherwise merge it structurally.
  if (profileFor(repoPath).kind === "json") {
    const text = gitTextMerge(oursPath, basePath, theirsPath);
    if (text.conflicts === 0 && isJson(text.output)) { writeFileSync(oursPath, text.output); return 0; }
  }
  let result;
  try {
    // The whole project's changes on each side (renames, what types gained), when git says
    // which commits are being merged (merge, rebase); otherwise this file alone.
    result = mergeFile(repoPath, base, ours, theirs, driverContext(repoPath));
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    // A side isn't valid JSON: behave exactly like git without c3merge.
    const text = gitTextMerge(oursPath, basePath, theirsPath);
    writeFileSync(oursPath, text.output);
    process.stderr.write(`c3merge: ${repoPath}: not valid JSON (${e.message}); merged as text by git${text.conflicts ? ", with conflicts" : ""}\n`);
    return text.conflicts ? 1 : 0;
  }
  writeFileSync(oursPath, result.text);
  report(repoPath, result.conflicts, result.warnings);
  return result.conflicts.length ? 1 : 0;
}

// Like git's own merge: `git merge` uses the histogram diff (merge-file defaults to Myers,
// which can place an insertion one element off). --diff-algorithm needs git 2.44+.
function gitTextMerge(ours: string, base: string, theirs: string) {
  const run = (algo: string[]) => spawnSync("git", ["merge-file", "-p", ...algo, "-L", "ours", "-L", "base", "-L", "theirs", ours, base, theirs], { encoding: "utf8", maxBuffer: 1 << 30 });
  let r = run(["--diff-algorithm=histogram"]);
  if (r.status !== null && r.status > 127) r = run([]);
  if (r.status === null || r.status < 0) throw new Error(`git merge-file failed: ${r.stderr}`);
  return { output: r.stdout, conflicts: r.status };
}
const isJson = (s: string) => { try { JSON.parse(s); return true; } catch { return false; } };

// Conflicts and order warnings go to stderr (git shows it) and to .git/c3merge/conflicts.md,
// which starts over for each new merge/rebase/cherry-pick.
function report(repoPath: string, conflicts: Issue[], warnings: Issue[]) {
  if (!conflicts.length && !warnings.length) { remindCheck(); return; }
  const lines = [`## ${repoPath}`];
  if (conflicts.length) {
    lines.push("", `${conflicts.length} conflict(s): pick a side at each <<<<<<< marker in the file, then \`git add\` it.`);
    for (const c of conflicts) lines.push(`- ${c.where}: ${c.message}`);
  }
  if (warnings.length) {
    lines.push("", "Merged, but check the order in the editor:");
    for (const w of warnings) lines.push(`- ${w.where}: ${w.message}`);
  }
  const text = lines.join("\n") + "\n\n";
  process.stderr.write(`c3merge: ${repoPath}: ${conflicts.length} conflict(s), ${warnings.length} order warning(s); details in .git/c3merge/conflicts.md\n`);
  const log = logFile();
  if (log) appendFileSync(log, text);
  remindCheck();
}

// The operation in progress, so the log and the reminder start over once per merge.
// HEAD doesn't move while one `git merge` runs (MERGE_HEAD is only written at the end).
function currentOperation(gitDir: string): string {
  const heads = ["HEAD", "MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]
    .map((f) => path.join(gitDir, f)).filter(existsSync).map((p) => readFileSync(p, "utf8").trim());
  return `${heads.join(" ")} ${tryGit(["rev-parse", "HEAD"]) ?? ""}`;
}

function logFile(): string | null {
  const gitDir = tryGit(["rev-parse", "--absolute-git-dir"]);
  if (!gitDir) return null;
  const dir = path.join(gitDir, "c3merge");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "conflicts.md"), stamp = path.join(dir, "operation");
  const op = currentOperation(gitDir);
  if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== op) {
    writeFileSync(stamp, op);
    writeFileSync(file, `# c3merge: ${new Date().toISOString()}\n\n`);
  }
  return file;
}

function remindCheck() {
  const gitDir = tryGit(["rev-parse", "--absolute-git-dir"]);
  if (!gitDir) return;
  const dir = path.join(gitDir, "c3merge"), file = path.join(dir, "reminded");
  mkdirSync(dir, { recursive: true });
  const op = currentOperation(gitDir);
  if (existsSync(file) && readFileSync(file, "utf8") === op) return;
  writeFileSync(file, op);
  process.stderr.write("c3merge: when the merge is done, run `c3merge check <project folder>`: some problems only show across files.\n");
}

// ── setup ─────────────────────────────────────────────────────────────────────────────

// How git (and hooks) run c3merge. Absolute paths, because git GUIs often don't have the
// user's PATH.
export function c3mergeCommand(): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [process.execPath, ...process.execArgv, process.argv[1]].map(q).join(" ");
}
export const driverCommand = () => `${c3mergeCommand()} merge-driver %O %A %B %P`;

// npx runs c3merge from its cache (~/.npm/_npx/…), which npm cleans up: git and the hooks
// would be left calling a path that's gone.
export function runningFromNpx(): boolean {
  let script = process.argv[1] ?? "";
  try { script = realpathSync(script); } catch {}
  return script.split(/[\\/]/).includes("_npx");
}

export function install(opts: { local?: boolean; command?: string }): string[] {
  const scope = opts.local ? "--local" : "--global";
  const set: [string, string][] = [
    ["merge.c3.name", "c3merge: structural merge for Construct 3 projects"],
    ["merge.c3.driver", opts.command ?? driverCommand()],
    ["merge.ours.driver", "true"],
  ];
  const changed: string[] = [];
  for (const [k, v] of set) {
    if (tryGit(["config", scope, "--get", k]) === v) continue;
    git(["config", scope, k, v]);
    changed.push(`${k} = ${v}`);
  }
  return changed;
}

const BEGIN = "# c3merge begin", END = "# c3merge end";
export const ATTRIBUTES = `${BEGIN}: structural merges of Construct 3 projects (https://www.npmjs.com/package/@skymen75/c3merge)
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
${END}`;

// Write or refresh a c3merge block (BEGIN..END) in a file, keeping everything else.
function writeBlock(file: string, block: string, header = ""): "created" | "updated" | "unchanged" {
  const old = existsSync(file) ? readFileSync(file, "utf8") : null;
  let next: string;
  if (old === null) next = `${header}${block}\n`;
  else {
    const i = old.indexOf(BEGIN), j = old.indexOf(END);
    next = i >= 0 && j > i ? old.slice(0, i) + block + old.slice(j + END.length) : `${old}${old.endsWith("\n") || !old ? "" : "\n"}${block}\n`;
  }
  if (next === old) return "unchanged";
  writeFileSync(file, next);
  return old === null ? "created" : "updated";
}

// .gitattributes in the repo (committed, shared).
export const init = (repoRoot: string) => writeBlock(path.join(repoRoot, ".gitattributes"), ATTRIBUTES);

// Hooks in this clone (never committed): the finish step when a merge writes its result
// (post-index-change with 1 and GITHEAD_* set, which only `git merge` does) and after a
// rebase (post-rewrite). The shell test keeps every other index write free.
export const HOOKS = (command: string): Record<string, string> => ({
  "post-index-change": `${BEGIN}: replay renames the merge couldn't reach, before anything is committed
if [ "$1" = 1 ] && env | grep -q '^GITHEAD_'; then ${command} finish --after merge || true; fi
${END}`,
  "post-rewrite": `${BEGIN}: replay renames after a rebase
if [ "$1" = rebase ]; then ${command} finish --after rebase < /dev/null || true; fi
${END}`,
});

export function installHooks(repoRoot: string, command = c3mergeCommand()): { hook: string; result: string }[] | { hooksPath: string } {
  const custom = tryGit(["config", "--get", "core.hooksPath"], repoRoot);
  if (custom) return { hooksPath: custom }; // a managed hooks folder (often committed): don't write into it
  const dir = path.resolve(repoRoot, git(["rev-parse", "--git-path", "hooks"], repoRoot));
  mkdirSync(dir, { recursive: true });
  return Object.entries(HOOKS(command)).map(([hook, block]) => {
    const file = path.join(dir, hook);
    const result = writeBlock(file, block, "#!/bin/sh\n");
    chmodSync(file, 0o755);
    return { hook, result };
  });
}

export interface DoctorLine { ok: boolean; text: string; fix?: string }
export function doctor(cwd = process.cwd()): DoctorLine[] {
  const out: DoctorLine[] = [];
  const version = tryGit(["--version"]);
  out.push(version ? { ok: true, text: version } : { ok: false, text: "git not found", fix: "install git" });
  const driver = tryGit(["config", "--get", "merge.c3.driver"], cwd);
  if (!driver) out.push({ ok: false, text: "merge driver not configured", fix: "c3merge install" });
  else {
    // Node and the script, as `install` wrote them (a removed Node version, a moved checkout).
    const paths = [...driver.split(" merge-driver")[0].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => path.isAbsolute(p));
    const missing = paths.find((p) => !existsSync(p));
    out.push(!missing ? { ok: true, text: `merge driver: ${driver}` } : { ok: false, text: `merge driver points at a missing file: ${missing}`, fix: "c3merge install" });
  }
  const root = tryGit(["rev-parse", "--show-toplevel"], cwd);
  if (!root) { out.push({ ok: false, text: "not inside a git repository" }); return out; }
  const hooksDir = path.resolve(root, git(["rev-parse", "--git-path", "hooks"], root));
  const missing = Object.keys(HOOKS("")).filter((h) => !(existsSync(path.join(hooksDir, h)) && readFileSync(path.join(hooksDir, h), "utf8").includes(BEGIN)));
  out.push(missing.length
    ? { ok: false, text: `hooks missing in this clone: ${missing.join(", ")} (renames won't reach files the merge didn't touch)`, fix: "c3merge init" }
    : { ok: true, text: "hooks: finish step after merges and rebases" });
  const proj = git(["ls-files", "*.c3proj"], root).split("\n").filter(Boolean)[0];
  if (!proj) out.push({ ok: false, text: "no .c3proj tracked in this repository (folder projects only; .c3p files can't be merged)" });
  else {
    const attr = git(["check-attr", "merge", "--", proj], root);
    out.push(attr.endsWith(": c3")
      ? { ok: true, text: `.gitattributes: ${proj} uses the c3 driver` }
      : { ok: false, text: `.gitattributes: ${proj} doesn't use the c3 driver`, fix: "c3merge init (then commit .gitattributes)" });
  }
  return out;
}
