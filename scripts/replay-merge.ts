// Replay one real merge end to end: clone the repo (read-only for the original), check out
// the merge's first parent, merge the second parent with plain git and with the c3merge
// driver, then run `c3merge check` on the result and optionally open it in C3 via c3cli.
//   tsx scripts/replay-merge.ts <repo> <merge commit> [--open [--branch lts]] [--keep]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ATTRIBUTES, install, installHooks } from "../src/driver.ts";
import { checkProject } from "../src/check/index.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { open: { type: "boolean" }, keep: { type: "boolean" }, branch: { type: "string" } } });
const [repo, merge] = positionals;
if (!repo || !merge) throw new Error("usage: replay-merge <repo> <merge commit> [--open] [--keep]");
const [p1, p2] = execFileSync("git", ["-C", repo, "rev-list", "--parents", "-n1", merge], { encoding: "utf8" }).trim().split(" ").slice(1);
const CLI = path.join(import.meta.dirname, "..", "src", "cli.ts");
const COMMAND = `'${process.execPath}' --import '${import.meta.resolve("tsx")}' '${CLI}' merge-driver %O %A %B %P`;

function attempt(withDriver: boolean) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "c3merge-replay-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 30 });
  execFileSync("git", ["clone", "-q", "--local", "--no-checkout", repo, dir]);
  git("config", "user.email", "replay@example.com");
  git("config", "user.name", "replay");
  git("checkout", "-q", p1);
  if (withDriver) {
    // Attributes only in this clone (.git/info/attributes), never committed anywhere.
    writeFileSync(path.join(dir, ".git", "info", "attributes"), ATTRIBUTES + "\n");
    const cwd = process.cwd(); process.chdir(dir);
    try { install({ local: true, command: COMMAND }); } finally { process.chdir(cwd); }
    installHooks(dir, COMMAND.replace(" merge-driver %O %A %B %P", ""));
  }
  const t0 = Date.now();
  const m = spawnSync("git", ["merge", "--no-edit", "--no-ff", p2], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 30 });
  const unmerged = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  return { dir, status: m.status, unmerged, seconds: (Date.now() - t0) / 1000, stderr: m.stderr };
}

const plain = attempt(false);
console.log(`plain git: exit ${plain.status}, ${plain.unmerged.length} conflicted file(s)`);
for (const f of plain.unmerged) console.log(`  ${f}`);
rmSync(plain.dir, { recursive: true, force: true });

const c3 = attempt(true);
console.log(`\nwith c3merge: exit ${c3.status}, ${c3.unmerged.length} conflicted file(s), ${c3.seconds.toFixed(1)} s`);
for (const f of c3.unmerged) console.log(`  ${f}`);
console.log(c3.stderr.split("\n").filter((l) => l.startsWith("c3merge") || l.startsWith("  ")).map((l) => `  ${l}`).join("\n"));

if (!c3.unmerged.length) {
  // Only what the merge introduced: problems already on one of the parents aren't its fault.
  const key = (f: { file: string; message: string }) => `${f.file}: ${f.message}`;
  const serious = async (dir: string) => (await checkProject(dir)).findings.filter((x) => x.severity !== "info");
  const before = new Set<string>();
  for (const rev of [p1, p2]) {
    const wt = mkdtempSync(path.join(os.tmpdir(), "c3merge-parent-"));
    execFileSync("git", ["-C", c3.dir, "worktree", "add", "-q", "--detach", wt, rev]);
    for (const f of await serious(wt)) before.add(key(f));
    execFileSync("git", ["-C", c3.dir, "worktree", "remove", "--force", wt]);
  }
  const after = await serious(c3.dir);
  const introduced = after.filter((f) => !before.has(key(f)));
  console.log(`\nc3merge check: ${after.length} problem(s), ${after.length - introduced.length} already on a parent, ${introduced.length} introduced by the merge`);
  for (const f of introduced.slice(0, 10)) console.log(`  ${f.severity} ${f.file}: ${f.message}`);
  if (values.open) {
    const { C3Editor } = await import("c3cli");
    // Both from worktrees: c3cli stages everything in the folder, and a clone's root has the
    // whole .git directory in it (c3cli backlog).
    for (const [name, rev] of [["first parent", p1], ["c3merge result", "HEAD"]] as const) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "c3merge-open-"));
      execFileSync("git", ["-C", c3.dir, "worktree", "add", "-q", "--detach", dir, rev]);
      // One editor per open: a second open() on the same C3Editor fails (c3cli backlog).
      const editor = await C3Editor.launch({});
      try {
        const p = await editor.open(dir, { branch: values.branch as any, useProjectRelease: true, timeoutMs: 300_000 });
        console.log(`C3 opens ${name}: ${p.report.outcome} on ${p.report.release}${p.report.dialogs?.length ? ` (${p.report.dialogs.map((d: any) => d.id).join(", ")})` : ""}`);
        await p.close();
      } catch (e) { console.log(`C3 opens ${name}: failed: ${(e as Error).message.split("\n")[0]}`); }
      finally { await editor.close().catch(() => {}); }
    }
  }
}
if (values.keep) console.log(`\nkept: ${c3.dir}`); else rmSync(c3.dir, { recursive: true, force: true });
