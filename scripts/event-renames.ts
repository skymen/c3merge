// Exploration: how often event variables and functions get renamed or change signature in a
// project's history (matched by sid, commit vs parent). Read-only.
//   tsx scripts/event-renames.ts <repo> [--root .]
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { root: { type: "string", default: "." } } });
const repo = positionals[0];
const prefix = values.root === "." ? "" : `${values.root}/`;
const git = (args: string[], input?: string) => execFileSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });

function read(pairs: [string, string][]): (any | null)[] {
  if (!pairs.length) return [];
  const out = git(["cat-file", "--batch"], pairs.map(([rev, f]) => `${rev}:${f}`).join("\n") + "\n");
  const res: (any | null)[] = [];
  let pos = 0;
  for (const _ of pairs) {
    const nl = out.indexOf(10, pos);
    const header = out.subarray(pos, nl).toString();
    if (header.endsWith("missing")) { res.push(null); pos = nl + 1; continue; }
    const size = Number(header.split(" ")[2]);
    try { res.push(JSON.parse(out.subarray(nl + 1, nl + 1 + size).toString("utf8"))); } catch { res.push(null); }
    pos = nl + 1 + size + 1;
  }
  return res;
}

// Variables (global = top level of the sheet, local = anywhere else), function blocks and
// custom action blocks, by sid.
function index(sheet: any) {
  const vars = new Map<number, { name: string; local: boolean }>();
  const fns = new Map<number, { name: string; params: { sid: number; name: string; initialValue: unknown }[] }>();
  const aces = new Map<number, string>();
  const walk = (list: any[], depth: number) => {
    for (const e of list ?? []) {
      if (!e || typeof e !== "object") continue;
      if (e.eventType === "variable") vars.set(e.sid, { name: e.name, local: depth > 0 });
      if (typeof e.functionName === "string") fns.set(e.sid, { name: e.functionName, params: (e.functionParameters ?? []).map((p: any) => ({ sid: p.sid, name: p.name, initialValue: p.initialValue })) });
      if (typeof e.aceName === "string") aces.set(e.sid, `${e.objectClass}.${e.aceName}`);
      walk(e.children, depth + 1);
    }
  };
  walk(sheet?.events, 0);
  return { vars, fns, aces };
}

const commits = git(["log", "--no-merges", "--format=%H", "--", `${prefix}eventSheets`]).toString().trim().split("\n");
const counts: Record<string, number> = {};
const examples: Record<string, string[]> = {};
const add = (k: string, ex: string) => { counts[k] = (counts[k] ?? 0) + 1; (examples[k] ??= []).length < 4 && examples[k].push(ex); };
for (const c of commits) {
  const files = git(["diff-tree", "-r", "--no-commit-id", "--name-only", `${c}^`, c, "--", `${prefix}eventSheets`]).toString().trim().split("\n").filter((f) => f.endsWith(".json"));
  const before = read(files.map((f) => [`${c}^`, f])), after = read(files.map((f) => [c, f]));
  files.forEach((f, i) => {
    if (!before[i] || !after[i]) return;
    const [a, b] = [index(before[i]), index(after[i])];
    const tag = `${c.slice(0, 8)} ${f.split("/").pop()}`;
    for (const [sid, v] of b.vars) { const o = a.vars.get(sid); if (o && o.name !== v.name) add(v.local ? "local variable renamed" : "global variable renamed", `${tag}: ${o.name} → ${v.name}`); }
    for (const [sid, fn] of b.fns) {
      const o = a.fns.get(sid);
      if (!o) continue;
      if (o.name !== fn.name) add("function renamed", `${tag}: ${o.name} → ${fn.name}`);
      const [ps, qs] = [o.params.map((p) => p.sid), fn.params.map((p) => p.sid)];
      const added = qs.filter((s) => !ps.includes(s)), removed = ps.filter((s) => !qs.includes(s));
      if (added.length) add("function parameter added", `${tag}: ${fn.name} +${fn.params.filter((p) => added.includes(p.sid)).map((p) => p.name)}`);
      if (removed.length) add("function parameter removed", `${tag}: ${fn.name} -${o.params.filter((p) => removed.includes(p.sid)).map((p) => p.name)}`);
      const kept = ps.filter((s) => qs.includes(s));
      if (kept.join() !== qs.filter((s) => ps.includes(s)).join()) add("function parameters reordered", `${tag}: ${fn.name}`);
      for (const p of fn.params) { const op = o.params.find((x) => x.sid === p.sid); if (op && op.name !== p.name) add("function parameter renamed", `${tag}: ${fn.name}(${op.name} → ${p.name})`); }
    }
    for (const [sid, n] of b.aces) { const o = a.aces.get(sid); if (o && o !== n) add("custom action renamed", `${tag}: ${o} → ${n}`); }
  });
}
console.log(`${commits.length} commits changed event sheets`);
for (const [k, n] of Object.entries(counts).sort((x, y) => y[1] - x[1])) console.log(`${String(n).padStart(4)} ${k}\n       ${examples[k].join("\n       ")}`);
