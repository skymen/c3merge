// End to end on lab-base: two branches edit the same files, git merges them with the
// c3merge driver, then C3 (via c3cli) opens the result and saves it as a folder. The merged
// project must open cleanly, and C3's save should only differ by its own normalizations.
//   tsx scripts/fidelity.ts [--release beta]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { C3Editor } from "c3cli";
import { ATTRIBUTES, install } from "../src/driver.ts";
import { checkProject } from "../src/check/index.ts";

const { values } = parseArgs({ options: { release: { type: "string" } } });
const ROOT = path.join(import.meta.dirname, "..");
const COMMAND = `'${process.execPath}' --import '${import.meta.resolve("tsx")}' '${path.join(ROOT, "src", "cli.ts")}' merge-driver %O %A %B %P`;
const dir = mkdtempSync(path.join(os.tmpdir(), "c3merge-fidelity-"));
const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
const file = (rel: string) => path.join(dir, rel);
const edit = (rel: string, fn: (v: any) => void) => {
  const v = JSON.parse(readFileSync(file(rel), "utf8")); fn(v); writeFileSync(file(rel), JSON.stringify(v, null, "\t"));
};
const newInstance = (v: any, uid: number, x: number) => {
  const i = structuredClone(v.layers[0].instances.find((i: any) => i.uid === 2));
  Object.assign(i, { uid, sid: 100000000000000 + uid }); i.world.x = x;
  return i;
};

cpSync(path.join(ROOT, "fixtures", "lab-base"), dir, { recursive: true, filter: (p) => !p.endsWith(".uistate.json") });
git("init", "-q", "-b", "main");
git("config", "user.email", "t@example.com"); git("config", "user.name", "t");
writeFileSync(file(".gitattributes"), ATTRIBUTES + "\n");
{ const cwd = process.cwd(); process.chdir(dir); try { install({ local: true, command: COMMAND }); } finally { process.chdir(cwd); } }
git("add", "-A"); git("commit", "-qm", "base");

git("checkout", "-qb", "feature");
edit("layouts/Layout 1.json", (v) => { v.layers[0].instances.push(newInstance(v, 60, 300)); v.layers[0].parallaxX = 80; });
edit("eventSheets/Event sheet 1.json", (v) => { v.events[2].actions[0].parameters.shape = "prism"; });
edit("project.c3proj", (v) => { v.layouts.items.push("Layout 1"); v.layouts.items.pop(); v.viewportWidth = 1280; });
git("commit", "-qam", "theirs");
git("checkout", "-q", "main");
edit("layouts/Layout 1.json", (v) => { v.layers[0].instances.push(newInstance(v, 50, 200)); v.width = 1500; });
edit("eventSheets/Event sheet 1.json", (v) => { v.events[2].actions[2].parameters.layer = "\"Layer 0\""; v.events[2].conditions[0].sid = v.events[2].conditions[0].sid; });
edit("project.c3proj", (v) => { v.viewportHeight = 720; });
git("commit", "-qam", "ours");

const m = spawnSync("git", ["merge", "--no-edit", "feature"], { cwd: dir, encoding: "utf8" });
console.log(`git merge: exit ${m.status}\n${m.stderr.trim()}`);
if (m.status !== 0) process.exit(1);
const r = await checkProject(dir);
console.log(`c3merge check: ${r.counts.error} error(s), ${r.counts.warning} warning(s)`);

const editor = await C3Editor.launch({});
const saved = mkdtempSync(path.join(os.tmpdir(), "c3merge-saved-"));
rmSync(saved, { recursive: true });
try {
  const p = await editor.open(dir, { branch: values.release as any, timeoutMs: 120_000 });
  console.log(`C3 opens the merged project: ${p.report.outcome} (${p.report.release})`);
  const layout = await p.page.evaluate(() => document.title);
  console.log(`title: ${layout}`);
  await p.saveAs(saved);
  await p.close();
} finally { await editor.close().catch(() => {}); }

// What C3 changed when it wrote the project back, per file.
const list = (root: string) => readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(json|c3proj)$/.test(e.name) && !e.name.endsWith(".uistate.json"))
  .map((e) => path.relative(root, path.join(e.parentPath, e.name)));
for (const rel of list(dir).filter((f) => !f.startsWith(".git"))) {
  let a: any, b: any;
  try { a = JSON.parse(readFileSync(path.join(dir, rel), "utf8")); b = JSON.parse(readFileSync(path.join(saved, rel), "utf8")); }
  catch { console.log(`  ${rel}: missing from C3's save`); continue; }
  const diffs: string[] = [];
  const walk = (x: any, y: any, p: string) => {
    if (diffs.length > 5 || JSON.stringify(x) === JSON.stringify(y)) return;
    if (x && y && typeof x === "object" && typeof y === "object") for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${k}`);
    else diffs.push(`${p}: ${JSON.stringify(x)?.slice(0, 50)} → ${JSON.stringify(y)?.slice(0, 50)}`);
  };
  walk(a, b, "");
  if (diffs.length) console.log(`  ${rel}:\n    ${diffs.join("\n    ")}`);
}
console.log(`merged: ${dir}\nC3's save: ${saved}`);
