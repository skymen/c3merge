// Run `check` over a corpus of real projects and group what it finds. Projects C3 opens
// cleanly must not get errors: anything it flags there is a false positive.
//   tsx scripts/corpus-check.ts <dir containing project folders> [c3cli sweep .jsonl]
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { checkProject } from "../src/check/index.ts";

const [dir, sweepFile] = process.argv.slice(2);
const outcome = new Map<string, string>();
if (sweepFile) for (const l of (await readFile(sweepFile, "utf8")).trim().split("\n")) {
  const r = JSON.parse(l);
  outcome.set(path.basename(r.target), r.outcome);
}
const byInvariant = new Map<string, string[]>();
let clean = 0, total = 0;
for (const d of (await readdir(dir)).sort()) {
  total++;
  const c3 = outcome.get(d) ?? "?";
  try {
    const r = await checkProject(path.join(dir, d));
    const serious = r.findings.filter((f) => f.severity === "error" || f.severity === "warning");
    if (!serious.length) clean++;
    for (const f of serious) {
      const k = `${f.severity} ${f.invariant}`;
      byInvariant.set(k, [...(byInvariant.get(k) ?? []), `${d} [C3: ${c3}] ${f.file}: ${f.message}`]);
    }
  } catch (e) { console.log(`${d}: could not load: ${(e as Error).message}`); }
}
console.log(`${clean} of ${total} projects clean`);
for (const [k, v] of [...byInvariant].sort()) {
  console.log(`\n== ${k}: ${v.length}`);
  console.log(v.slice(0, 8).map((x) => "   " + x).join("\n"));
}
