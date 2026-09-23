// What changed across the whole project on each side, for the merges that need more than
// the file being merged (tasks/core-merge-engine.md "Renames need the whole project"):
// - object types and families renamed on a side (same sid, new name);
// - what an object type gained on a side, itself or through a family, which C3 then adds
//   to every instance by itself (variables, behaviors, effects).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Gained { vars: string[]; behaviors: string[]; effects: string[] }
export interface Named { sid: number; name: string }
export interface TypeInfo { kind: "objectType" | "family"; name: string; vars: Named[]; behaviors: Named[]; effects: string[]; members: string[] }
// Object types and families by sid, at one commit.
export type Table = Record<string, TypeInfo>;
export interface ProjectContext { base: Table; ours: Table; theirs: Table }

// What one side changed, derived from the tables.
export interface Changes {
  types: Record<string, string>; // object types and families renamed: old name → new name
  vars: MemberChange[];          // instance variables renamed (same sid, new name)
  behaviors: MemberChange[];     // behaviors renamed
  gained: Record<string, Gained>; // by object type name on this side
}
export interface MemberChange { owner: string; old: string; new: string } // owner: type/family sid

const git = (repo: string, args: string[], input?: string) =>
  execFileSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });
const named = (l: unknown): Named[] => (Array.isArray(l) ? l.filter((x) => typeof x?.name === "string" && typeof x?.sid === "number").map((x) => ({ sid: x.sid, name: x.name })) : []);

// Object types and families of the project at `root` in commit `rev`.
export function readTypes(repo: string, rev: string, root: string): Table {
  const dirs = ["objectTypes", "families"].map((d) => (root === "." ? d : `${root}/${d}`));
  const files = git(repo, ["ls-tree", "-r", "--name-only", rev, "--", ...dirs]).toString("utf8")
    .split("\n").filter((f) => f.endsWith(".json") && !f.endsWith(".uistate.json"));
  const out: Table = {};
  if (!files.length) return out;
  const batch = git(repo, ["cat-file", "--batch"], files.map((f) => `${rev}:${f}`).join("\n") + "\n");
  let pos = 0;
  for (const f of files) {
    const nl = batch.indexOf(10, pos);
    const header = batch.subarray(pos, nl).toString();
    if (header.endsWith("missing")) { pos = nl + 1; continue; }
    const size = Number(header.split(" ")[2]);
    const body = batch.subarray(nl + 1, nl + 1 + size).toString("utf8");
    pos = nl + 1 + size + 1;
    try {
      const v = JSON.parse(body);
      if (typeof v.sid !== "number" || typeof v.name !== "string") continue;
      out[v.sid] = {
        kind: `/${f}`.includes("/families/") ? "family" : "objectType", name: v.name,
        vars: named(v.instanceVariables), behaviors: named(v.behaviorTypes),
        effects: Array.isArray(v.effectTypes) ? v.effectTypes.map((e: any) => e?.name).filter((n: unknown) => typeof n === "string") : [],
        members: Array.isArray(v.members) ? v.members : [],
      };
    } catch { /* not JSON: ignore */ }
  }
  return out;
}

export function changes(base: Table, side: Table): Changes {
  const types: Record<string, string> = {};
  const vars: MemberChange[] = [], behaviors: MemberChange[] = [];
  for (const [sid, s] of Object.entries(side)) {
    const b = base[sid];
    if (!b || b.kind !== s.kind) continue;
    if (b.name !== s.name) types[b.name] = s.name;
    for (const [list, out] of [["vars", vars], ["behaviors", behaviors]] as const) {
      const before = new Map(b[list].map((x) => [x.sid, x.name]));
      for (const x of s[list]) { const old = before.get(x.sid); if (old && old !== x.name) out.push({ owner: sid, old, new: x.name }); }
    }
  }
  const gained: Record<string, Gained> = {};
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const add = (type: string, g: Gained) => {
    const cur = (gained[type] ??= { vars: [], behaviors: [], effects: [] });
    for (const k of ["vars", "behaviors", "effects"] as const) for (const x of g[k]) if (!cur[k].includes(x)) cur[k].push(x);
  };
  const names = (l: Named[]) => l.map((x) => x.name);
  const diff = (s: TypeInfo, b: TypeInfo): Gained => ({ vars: minus(names(s.vars), names(b.vars)), behaviors: minus(names(s.behaviors), names(b.behaviors)), effects: minus(s.effects, b.effects) });
  const all = (s: TypeInfo): Gained => ({ vars: names(s.vars), behaviors: names(s.behaviors), effects: s.effects });
  // Object types that existed at base, by their name on this side (new types have only new instances).
  const oldTypes = new Set(Object.values(base).filter((x) => x.kind === "objectType").map((x) => types[x.name] ?? x.name));
  for (const [sid, s] of Object.entries(side)) {
    const b = base[sid];
    if (s.kind === "objectType") { if (b) add(s.name, diff(s, b)); continue; }
    // A family: members it already had get what it gained; members it gained get all of it.
    const baseMembers = (b?.members ?? []).map((m) => types[m] ?? m);
    for (const m of s.members) {
      if (!oldTypes.has(m)) continue;
      add(m, b && baseMembers.includes(m) ? diff(s, b) : all(s));
    }
  }
  for (const [k, g] of Object.entries(gained)) if (!g.vars.length && !g.behaviors.length && !g.effects.length) delete gained[k];
  return { types, vars, behaviors, gained };
}

export function buildContext(repo: string, root: string, revs: { base: string; ours: string; theirs: string }): ProjectContext {
  return { base: readTypes(repo, revs.base, root), ours: readTypes(repo, revs.ours, root), theirs: readTypes(repo, revs.theirs, root) };
}

// ── inside the merge driver ───────────────────────────────────────────────────────────
// What git tells a driver (checked on git 2.50): `git merge` sets GITHEAD_<theirs sha> in the
// environment and HEAD is ours; `git rebase` lists the commit being picked last in
// .git/rebase-merge/done. A single cherry-pick or revert leaves no trace: no context.
export function driverContext(repoPath: string): ProjectContext | undefined {
  try {
    const gitDir = git(".", ["rev-parse", "--absolute-git-dir"]).toString().trim();
    const ours = git(".", ["rev-parse", "HEAD"]).toString().trim();
    const picked = theirsCommit(gitDir);
    if (!picked) return undefined;
    let base: string;
    if (picked.rebase) base = git(".", ["rev-parse", `${picked.sha}^`]).toString().trim();
    else {
      const bases = git(".", ["merge-base", "--all", ours, picked.sha]).toString().trim().split("\n");
      if (bases.length !== 1) return undefined; // criss-cross merge: git uses a virtual base
      base = bases[0];
    }
    const root = projectRoot(repoPath, ours);
    if (root === null) return undefined;
    const key = `${base} ${ours} ${picked.sha} ${root}`;
    const cache = path.join(gitDir, "c3merge", "context-v2.json");
    if (existsSync(cache)) {
      const c = JSON.parse(readFileSync(cache, "utf8"));
      if (c.key === key) return c.context;
    }
    const context = buildContext(".", root, { base, ours, theirs: picked.sha });
    mkdirSync(path.dirname(cache), { recursive: true });
    writeFileSync(cache, JSON.stringify({ key, context }));
    return context;
  } catch {
    return undefined;
  }
}

function theirsCommit(gitDir: string): { sha: string; rebase: boolean } | null {
  const heads = Object.keys(process.env).filter((k) => /^GITHEAD_[0-9a-f]{40,64}$/.test(k));
  if (heads.length === 1) return { sha: heads[0].slice("GITHEAD_".length), rebase: false };
  if (heads.length > 1) return null; // octopus
  const done = path.join(gitDir, "rebase-merge", "done");
  if (!existsSync(done)) return null;
  const last = readFileSync(done, "utf8").trim().split("\n").at(-1) ?? "";
  const m = /^\S+\s+([0-9a-f]{4,})/.exec(last);
  if (!m) return null;
  return { sha: git(".", ["rev-parse", m[1]]).toString().trim(), rebase: true };
}

// The folder of the .c3proj that contains `repoPath` ("." for the repo root).
function projectRoot(repoPath: string, rev: string): string | null {
  const projects = git(".", ["ls-tree", "-r", "--name-only", rev]).toString().split("\n")
    .filter((f) => f.endsWith(".c3proj")).map((f) => path.posix.dirname(f));
  const p = repoPath.split(path.sep).join("/");
  const inside = projects.filter((d) => d === "." || p.startsWith(`${d}/`)).sort((a, b) => b.length - a.length);
  return inside[0] ?? null;
}
