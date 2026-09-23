// What changed across the whole project on each side, for the merges that need more than
// the file being merged (tasks/core-merge-engine.md "Renames need the whole project"):
// - object types and families renamed on a side (same sid, new name);
// - what an object type gained on a side, itself or through a family, which C3 then adds
//   to every instance by itself (variables, behaviors, effects).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Gained { vars: string[]; behaviors: string[]; effects: string[] }
export interface SideChanges { renames: Record<string, string>; gained: Record<string, Gained> }
export interface ProjectContext { ours: SideChanges; theirs: SideChanges }

interface TypeInfo { kind: "objectType" | "family"; name: string; vars: string[]; behaviors: string[]; effects: string[]; members: string[] }
type Types = Map<number, TypeInfo>;

const git = (repo: string, args: string[], input?: string) =>
  execFileSync("git", ["-C", repo, ...args], { input, maxBuffer: 1 << 30 });
const names = (l: unknown) => (Array.isArray(l) ? l.map((x) => x?.name).filter((n) => typeof n === "string") : []);

// Object types and families of the project at `root` in commit `rev`.
export function readTypes(repo: string, rev: string, root: string): Types {
  const dirs = ["objectTypes", "families"].map((d) => (root === "." ? d : `${root}/${d}`));
  const files = git(repo, ["ls-tree", "-r", "--name-only", rev, "--", ...dirs]).toString("utf8")
    .split("\n").filter((f) => f.endsWith(".json") && !f.endsWith(".uistate.json"));
  const out: Types = new Map();
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
      out.set(v.sid, {
        kind: `/${f}`.includes("/families/") ? "family" : "objectType", name: v.name,
        vars: names(v.instanceVariables), behaviors: names(v.behaviorTypes), effects: names(v.effectTypes),
        members: Array.isArray(v.members) ? v.members : [],
      });
    } catch { /* not JSON: ignore */ }
  }
  return out;
}

export function sideChanges(base: Types, side: Types): SideChanges {
  const renames: Record<string, string> = {};
  for (const [sid, s] of side) {
    const b = base.get(sid);
    if (b && b.kind === s.kind && b.name !== s.name) renames[b.name] = s.name;
  }
  const gained: Record<string, Gained> = {};
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const add = (type: string, g: Gained) => {
    const cur = (gained[type] ??= { vars: [], behaviors: [], effects: [] });
    for (const k of ["vars", "behaviors", "effects"] as const) for (const x of g[k]) if (!cur[k].includes(x)) cur[k].push(x);
  };
  const diff = (s: TypeInfo, b: TypeInfo): Gained => ({ vars: minus(s.vars, b.vars), behaviors: minus(s.behaviors, b.behaviors), effects: minus(s.effects, b.effects) });
  const all = (s: TypeInfo): Gained => ({ vars: s.vars, behaviors: s.behaviors, effects: s.effects });
  // Object types that existed at base, by their name on this side (new types have only new instances).
  const oldTypes = new Set([...base.values()].filter((x) => x.kind === "objectType").map((x) => renames[x.name] ?? x.name));
  for (const [sid, s] of side) {
    const b = base.get(sid);
    if (s.kind === "objectType") { if (b) add(s.name, diff(s, b)); continue; }
    // A family: members it already had get what it gained; members it gained get all of it.
    const baseMembers = (b?.members ?? []).map((m) => renames[m] ?? m);
    for (const m of s.members) {
      if (!oldTypes.has(m)) continue;
      add(m, b && baseMembers.includes(m) ? diff(s, b) : all(s));
    }
  }
  for (const [k, g] of Object.entries(gained)) if (!g.vars.length && !g.behaviors.length && !g.effects.length) delete gained[k];
  return { renames, gained };
}

export function buildContext(repo: string, root: string, revs: { base: string; ours: string; theirs: string }): ProjectContext {
  const [b, o, t] = [revs.base, revs.ours, revs.theirs].map((r) => readTypes(repo, r, root));
  return { ours: sideChanges(b, o), theirs: sideChanges(b, t) };
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
    const cache = path.join(gitDir, "c3merge", "context.json");
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
