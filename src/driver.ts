// Git integration: the merge driver git calls for each file, and the commands that set it
// up (install, init, doctor). See tasks/git-driver.md.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
    result = mergeFile(repoPath, base, ours, theirs);
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

// The command git runs. Absolute paths, because git GUIs often don't have the user's PATH.
export function driverCommand(): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [process.execPath, ...process.execArgv, process.argv[1]].map(q).join(" ") + " merge-driver %O %A %B %P";
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
export const ATTRIBUTES = `${BEGIN}: structural merges of Construct 3 projects (https://github.com/skymen/c3merge)
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

// Write or refresh the c3merge block in the repo's .gitattributes, keeping everything else.
export function init(repoRoot: string): "created" | "updated" | "unchanged" {
  const file = path.join(repoRoot, ".gitattributes");
  const old = existsSync(file) ? readFileSync(file, "utf8") : null;
  let next: string;
  if (old === null) next = `${ATTRIBUTES}\n`;
  else {
    const i = old.indexOf(BEGIN), j = old.indexOf(END);
    next = i >= 0 && j > i ? old.slice(0, i) + ATTRIBUTES + old.slice(j + END.length) : `${old}${old.endsWith("\n") || !old ? "" : "\n"}${ATTRIBUTES}\n`;
  }
  if (next === old) return "unchanged";
  writeFileSync(file, next);
  return old === null ? "created" : "updated";
}

export interface DoctorLine { ok: boolean; text: string; fix?: string }
export function doctor(cwd = process.cwd()): DoctorLine[] {
  const out: DoctorLine[] = [];
  const version = tryGit(["--version"]);
  out.push(version ? { ok: true, text: version } : { ok: false, text: "git not found", fix: "install git" });
  const driver = tryGit(["config", "--get", "merge.c3.driver"], cwd);
  if (!driver) out.push({ ok: false, text: "merge driver not configured", fix: "c3merge install" });
  else {
    const script = /'([^']+)' merge-driver/.exec(driver)?.[1];
    const exists = !script || existsSync(script);
    out.push(exists ? { ok: true, text: `merge driver: ${driver}` } : { ok: false, text: `merge driver points at a missing file: ${script}`, fix: "c3merge install" });
  }
  const root = tryGit(["rev-parse", "--show-toplevel"], cwd);
  if (!root) { out.push({ ok: false, text: "not inside a git repository" }); return out; }
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
