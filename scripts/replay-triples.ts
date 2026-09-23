// Replay real merges (from scripts/extract-triples.ts) through the engine and compare with
// git's line merge and with what people committed.
//   tsx scripts/replay-triples.ts [fixtures/real/utrs] [--show <outcome>] [--diff]
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import { mergeFile, eq } from "../src/engine/merge.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { show: { type: "string" } } });
const root = positionals[0] ?? "fixtures/real/utrs";
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const read = (d: string, k: string) => (existsSync(path.join(d, `${k}.json`)) ? readFileSync(path.join(d, `${k}.json`), "utf8") : null);
const parse = (s: string | null) => { try { return s === null ? undefined : JSON.parse(s); } catch { return undefined; } };

const outcomes = new Map<string, string[]>();
const add = (k: string, v: string) => outcomes.set(k, [...(outcomes.get(k) ?? []), v]);
let warnings = 0, ms = 0;
for (const m of manifest) for (const f of m.files) {
  const d = path.join(root, m.merge, f.path);
  const [base, ours, theirs, actual] = ["base", "ours", "theirs", "actual"].map((k) => read(d, k));
  if (ours === null || theirs === null) continue; // deleted on one side: git handles it without the driver
  const tag = `${m.merge} ${f.path}`;
  const t0 = performance.now();
  let r;
  try { r = mergeFile(f.path, base, ours, theirs); } catch (e) { add("engine error", `${tag}: ${(e as Error).message}`); continue; }
  ms += performance.now() - t0;
  warnings += r.warnings.length;
  const git = f.gitConflicts === null ? "added on both" : f.gitConflicts ? "git conflict" : "git clean";
  if (r.conflicts.length) {
    add(`${git} → c3merge conflict`, `${tag}: ${r.conflicts.slice(0, 3).map((c) => `${c.path} (${c.message})`).join("; ")}${r.conflicts.length > 3 ? ` +${r.conflicts.length - 3}` : ""}`);
    continue;
  }
  const merged = JSON.parse(r.text);
  const vsActual = actual === null ? "file deleted in the commit" : eq(merged, parse(actual)) ? "same as committed" : "differs from committed";
  let vsGit = "";
  if (git === "git clean") {
    const g = spawnSync("git", ["merge-file", "-p", "--diff-algorithm=histogram", ...["ours", "base", "theirs"].map((k) => path.join(d, `${k}.json`))], { encoding: "utf8", maxBuffer: 1 << 30 }).stdout;
    vsGit = eq(merged, parse(g)) ? ", same as git" : ", differs from git";
  }
  add(`${git} → c3merge clean${vsGit}, ${vsActual}`, `${tag}${r.warnings.length ? ` [${r.warnings.length} order warning(s)]` : ""}`);
}

console.log(`engine time: ${Math.round(ms)} ms total, ${warnings} order warnings\n`);
for (const [k, v] of [...outcomes].sort()) console.log(`${String(v.length).padStart(4)}  ${k}`);
if (values.show) for (const [k, v] of outcomes) if (k.includes(values.show)) console.log(`\n## ${k}\n${v.join("\n")}`);
