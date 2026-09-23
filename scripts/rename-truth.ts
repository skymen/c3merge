// Check the renamer against C3 itself. For every commit in a project's history where an
// object type, family, instance variable or behavior was renamed (same sid, new name), apply
// the renamer to the parent's event sheets and layouts and compare, field by field, with
// what C3 wrote in that commit. Read-only.
//   tsx scripts/rename-truth.ts <repo> [--root .] [--limit N]
// match     C3 renamed it, and so did we
// miss      C3 renamed it, we didn't (the expression would be flagged, or left)
// extra     we changed something C3 didn't: harm, must be 0
// wrong     both changed it, differently: harm, must be 0
// uncertain the renamer declined (would be a flagged conflict in a merge)
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { changes, readTypes, type ProjectContext } from "../src/context.ts";
import { applyRenames } from "../src/engine/renames.ts";
import { renameExpression, tokenize, type RenameSet } from "../src/engine/expressions.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { root: { type: "string", default: "." }, limit: { type: "string" } } });
const repo = positionals[0];
const root = values.root!;
const git = (args: string[], input?: string) => execFileSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });
const prefix = root === "." ? "" : `${root}/`;

function readAll(rev: string, dirs: string[]): Map<string, any> {
  const files = git(["ls-tree", "-r", "--name-only", rev, "--", ...dirs.map((d) => prefix + d)]).toString()
    .split("\n").filter((f) => f.endsWith(".json") && !f.endsWith(".uistate.json"));
  const out = new Map<string, any>();
  if (!files.length) return out;
  const batch = git(["cat-file", "--batch"], files.map((f) => `${rev}:${f}`).join("\n") + "\n");
  let pos = 0;
  for (const f of files) {
    const nl = batch.indexOf(10, pos);
    const size = Number(batch.subarray(pos, nl).toString().split(" ")[2]);
    try { out.set(f, JSON.parse(batch.subarray(nl + 1, nl + 1 + size).toString("utf8"))); } catch { /* skip */ }
    pos = nl + 1 + size + 1;
  }
  return out;
}

// Field-level view of a file: key → value, for the places renames touch.
function fields(kind: string, v: any): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (x: any, key: string) => {
    if (Array.isArray(x)) {
      if (kind === "layout" && (key === "instances" || key === "nonworld-instances")) {
        for (const i of x) if (i && typeof i === "object") {
          const id = `#${i.uid}`;
          out.set(`${id} type`, String(i.type));
          out.set(`${id} vars`, Object.keys(i.instanceVariables ?? {}).join(","));
          out.set(`${id} behaviors`, Object.keys(i.behaviors ?? {}).join(","));
          const tpl = (i.template?.components ?? []).flatMap((c: any) => (c.component ?? []).map((p: any) => `${c.id}:${p.key}:${(p.state ?? []).map((s: any) => s?.iv ?? "").join("|")}`));
          if (tpl.length) out.set(`${id} template`, tpl.join(" "));
        }
      }
      x.forEach((e) => walk(e, ""));
    } else if (x && typeof x === "object") {
      if (kind === "eventSheet" && ("objectClass" in x || "callFunction" in x)) {
        const id = `sid ${x.sid}`;
        if (typeof x.objectClass === "string") out.set(`${id} objectClass`, x.objectClass);
        if (typeof x.behaviorType === "string") out.set(`${id} behaviorType`, x.behaviorType);
        const p = x.parameters;
        if (p && typeof p === "object") for (const [k, val] of Object.entries(p)) if (typeof val === "string") out.set(`${id} ${k}`, val);
      }
      for (const [k, e] of Object.entries(x)) walk(e, k);
    }
  };
  walk(v, "");
  return out;
}

// Is b exactly a with some renamed names swapped (and nothing else)?
function onlyRenamed(a: string, b: string, set: RenameSet): boolean {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta || !tb || ta.length !== tb.length) return false;
  const renames = new Map<string, string>([...Object.entries(set.types), ...set.members.map((m) => [m.old, m.new] as [string, string])]);
  let swapped = false;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i].text === tb[i].text) continue;
    if (renames.get(ta[i].text) !== tb[i].text) return false;
    swapped = true;
  }
  return swapped;
}

// Layout fields are lists of names (variables, behaviors, template flags, a type): a rename
// only if the lists differ exactly by renamed names.
function listRenamed(a: string, b: string, set: RenameSet): boolean {
  const renames = new Map<string, string>([...Object.entries(set.types), ...set.members.map((m) => [m.old, m.new] as [string, string])]);
  const [la, lb] = [a.split(/([,| :])/), b.split(/([,| :])/)];
  if (la.length !== lb.length) return false;
  let swapped = false;
  for (let i = 0; i < la.length; i++) {
    if (la[i] === lb[i]) continue;
    if (renames.get(la[i]) !== lb[i]) return false;
    swapped = true;
  }
  return swapped;
}

const commits = git(["log", "--no-merges", "--format=%H", "--", `${prefix}objectTypes`, `${prefix}families`]).toString().trim().split("\n");
const totals = { match: 0, miss: 0, extra: 0, wrong: 0, uncertain: 0, unrelated: 0 };
const problems: string[] = [];
let seen = 0;
for (const c of commits) {
  const [P, C] = [readTypes(repo, `${c}^`, root), readTypes(repo, c, root)];
  const ch = changes(P, C);
  if (!Object.keys(ch.types).length && !ch.vars.length && !ch.behaviors.length) continue;
  if (values.limit && ++seen > Number(values.limit)) break;
  const ctx: ProjectContext = { base: P, ours: C, theirs: P };
  const label = [...Object.entries(ch.types).map(([a, b]) => `${a}→${b}`), ...ch.vars.map((v) => `${C[v.owner].name}.${v.old}→${v.new}`), ...ch.behaviors.map((v) => `${C[v.owner].name}.${v.old}→${v.new} (behavior)`)].join(", ");
  const counts = { match: 0, miss: 0, extra: 0, wrong: 0, uncertain: 0, unrelated: 0 };
  const [before, after] = [readAll(`${c}^`, ["eventSheets", "layouts"]), readAll(c, ["eventSheets", "layouts"])];
  // The set as the renamer sees it, for classifying C3's changes.
  const set: RenameSet = { types: ch.types, members: [] };
  for (const [kind, list] of [["var", ch.vars], ["behavior", ch.behaviors]] as const) for (const m of list) set.members.push({ kind, old: m.old, new: m.new, owner: new Set(), selfClasses: new Set() });
  for (const [file, p] of before) {
    const q = after.get(file);
    if (!q) continue;
    const kind = file.includes("eventSheets/") ? "eventSheet" : "layout";
    const mine = structuredClone(p);
    applyRenames(kind, structuredClone(p), structuredClone(p), mine, ctx); // theirs = the parent, renamed with ours' changes
    const [fp, fq, fr] = [fields(kind, p), fields(kind, q), fields(kind, mine)];
    for (const [k, pv] of fp) {
      const qv = fq.get(k), rv = fr.get(k);
      if (qv === undefined) continue; // gone in the commit: not comparable
      const c3Renamed = pv !== qv && (kind === "layout" ? listRenamed(pv, qv, set) : onlyRenamed(pv, qv, set));
      if (pv === qv) {
        if (rv !== pv) { counts.extra++; problems.push(`EXTRA ${c.slice(0, 8)} ${file} ${k}: ${JSON.stringify(pv)} → ${JSON.stringify(rv)}`); }
        continue;
      }
      if (!c3Renamed) {
        // Also edited by hand in the same commit: can't compare exactly, but every name we
        // produced must be in C3's result.
        counts.unrelated++;
        if (rv !== pv && rv !== undefined) {
          const words = (x: string) => new Set(x.split(/[^A-Za-z0-9_]+/).filter(Boolean));
          const [wp, wq] = [words(pv), words(qv)];
          const introduced = [...words(rv)].filter((w) => !wp.has(w));
          if (introduced.some((w) => !wq.has(w))) { counts.wrong++; problems.push(`WRONG (mixed) ${c.slice(0, 8)} ${file} ${k}: ours ${JSON.stringify(rv)}, C3 ${JSON.stringify(qv)}`); }
        }
        continue;
      }
      if (rv === qv) counts.match++;
      else if (rv === pv) {
        // Would the renamer have flagged it? (Uncertain, rather than silently left.)
        const ace = kind === "eventSheet" ? /^sid \S+ (.+)$/.exec(k)?.[1] : undefined;
        if (ace && !["objectClass", "behaviorType", "instance-variable"].includes(ace) && renameExpression(pv, undefined, set).uncertain) counts.uncertain++;
        counts.miss++;
        problems.push(`miss ${c.slice(0, 8)} ${file} ${k}: C3 ${JSON.stringify(pv)} → ${JSON.stringify(qv)}`);
      } else { counts.wrong++; problems.push(`WRONG ${c.slice(0, 8)} ${file} ${k}: C3 ${JSON.stringify(qv)}, ours ${JSON.stringify(rv)}`); }
    }
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += counts[k];
  console.log(`${c.slice(0, 8)} ${label}: ${counts.match} match, ${counts.miss} miss, ${counts.extra} extra, ${counts.wrong} wrong (${counts.unrelated} unrelated edits)`);
}
console.log("\ntotal:", totals);
console.log(problems.join("\n"));
