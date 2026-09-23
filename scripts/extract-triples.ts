// Extract real merge triples from a C3 project's git history, read-only (git log / show /
// merge-base only; the repo is never modified). For every merge commit and every C3 JSON
// file changed on both sides, writes base/ours/theirs (what the merge had to combine) and
// actual (what the person committed) under fixtures/real/<name>/<merge>/<path>/, plus a
// manifest with git's own text-merge verdict for comparison.
//
//   npx tsx scripts/extract-triples.ts <repo> [--name utrs] [--merges 115db4b4,...] [--out fixtures/real]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { name: { type: "string" }, merges: { type: "string" }, out: { type: "string", default: "fixtures/real" } },
});
const repo = positionals[0];
if (!repo) throw new Error("usage: extract-triples <repo> [--name n] [--merges a,b] [--out dir]");
const name = values.name ?? path.basename(repo).toLowerCase().replace(/\W+/g, "-");
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
const show = (rev: string, file: string): string | null => {
  const r = spawnSync("git", ["-C", repo, "show", `${rev}:${file}`], { encoding: "utf8", maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : null;
};

// Files c3merge merges structurally (same set as the .gitattributes template).
const MERGED = /(^|\/)[^/]*\.c3proj$|^(.*\/)?(eventSheets|layouts|objectTypes|families|timelines|flowcharts)\/.*\.json$/;
const isC3Json = (f: string) => MERGED.test(f) && !f.endsWith(".uistate.json");
// The project root inside the repo: where the .c3proj lives.
const root = git("ls-files", "*.c3proj").split("\n").filter(Boolean).map((f) => path.posix.dirname(f))[0] ?? ".";
const rel = (f: string) => (root === "." ? f : f.slice(root.length + 1));

const merges = values.merges
  ? values.merges.split(",")
  : git("log", "--merges", "--format=%h").split("\n").filter(Boolean);

const manifest: object[] = [];
for (const m of merges) {
  const [p1, p2, ...more] = git("rev-list", "--parents", "-n1", m).trim().split(" ").slice(1);
  if (more.length) continue; // octopus merges: skip
  const bases = git("merge-base", "--all", p1, p2).split("\n").filter(Boolean);
  if (bases.length !== 1) continue; // criss-cross: no single base, skip
  const base = bases[0];
  const changed = (a: string, b: string) => new Set(git("diff", "--name-only", "--no-renames", a, b).split("\n").filter(isC3Json));
  const ours = changed(base, p1);
  const both = [...changed(base, p2)].filter((f) => ours.has(f));
  if (!both.length) continue;

  const files = [];
  for (const f of both) {
    const dir = path.join(values.out!, name, m, rel(f));
    await mkdir(dir, { recursive: true });
    const sides = { base: show(base, f), ours: show(p1, f), theirs: show(p2, f), actual: show(m, f) };
    for (const [k, v] of Object.entries(sides)) if (v !== null) await writeFile(path.join(dir, `${k}.json`), v);
    // What git's line merge does with it (histogram, like `git merge`): exit code = number of conflict hunks.
    let gitConflicts: number | null = null;
    if (sides.base !== null && sides.ours !== null && sides.theirs !== null) {
      const r = spawnSync("git", ["merge-file", "-p", "--diff-algorithm=histogram", ...["ours", "base", "theirs"].map((k) => path.join(dir, `${k}.json`))], { maxBuffer: 1 << 30 });
      gitConflicts = r.status;
    }
    files.push({ path: rel(f), present: Object.fromEntries(Object.entries(sides).map(([k, v]) => [k, v !== null])), gitConflicts });
  }
  const subject = git("log", "-1", "--format=%s", m).trim();
  manifest.push({ merge: m, base, ours: p1, theirs: p2, subject, files });
  const conflicted = files.filter((f) => f.gitConflicts !== 0).length;
  console.log(`${m} ${files.length} file(s) changed on both sides, git conflicts on ${conflicted}: ${subject}`);
}
await writeFile(path.join(values.out!, name, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} merge(s) → ${path.join(values.out!, name)}`);
