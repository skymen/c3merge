// Renames made on one side (object types, families, instance variables, behaviors: same sid,
// new name) applied to the base and to the other side before merging, so what the other
// side added or kept follows the rename. C3 already renamed everything on the renaming side.
//
// Structured references are rewritten: instance `type`, variable keys and template flags,
// behavior keys, event `objectClass` / `behaviorType` / `instance-variable`, parameters naming
// the object, family members, project folders and containers. Expressions go through
// expressions.ts and are only rewritten when it is sure; after the merge, any expression
// that may still use a renamed-away name becomes a conflict (flagLeftovers).
import { changes, type ProjectContext, type Table } from "../context.ts";
import { renameExpression, tokenize, type MemberRename, type RenameSet } from "./expressions.ts";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Parameters holding a variable or timeline name, never an expression or an object.
const NAMES_ONLY = new Set(["instance-variable", "variable", "timeline"]);

export function applyRenames(kind: string, b: unknown, o: unknown, t: unknown, ctx: ProjectContext) {
  const fromOurs = renameSet(ctx, "ours"), fromTheirs = renameSet(ctx, "theirs");
  apply(kind, b, merge(fromOurs, fromTheirs));
  apply(kind, o, fromTheirs);
  apply(kind, t, fromOurs);
}

// After merging: expressions in the result that may still use a renamed-away name. Sure
// cases are fixed; the others become a conflict between the expression as merged and a
// best guess, for a person to check in C3.
export function flagLeftovers(kind: string, merged: unknown, ctx: ProjectContext, onConflict: (ace: any, key: string, guess: string, reason: string) => void) {
  if (kind !== "eventSheet") return;
  const set = merge(renameSet(ctx, "ours"), renameSet(ctx, "theirs"));
  if (!Object.keys(set.types).length && !set.members.length) return;
  forEachAce(merged, (ace) => {
    const params = ace.parameters;
    if (!params || typeof params !== "object") return;
    for (const key of Object.keys(params)) {
      const v = (params as any)[key];
      if (typeof v !== "string" || NAMES_ONLY.has(key) || Object.keys(set.types).some((n) => same(n, v))) continue;
      const r = renameExpression(v, ace.objectClass, set);
      if (r.changed) (params as any)[key] = r.text;
      else if (r.uncertain) onConflict(ace, key, guess(v, set), r.uncertain);
    }
  });
}

// ── which renames, as seen from the other side ───────────────────────────────────────

function renameSet(ctx: ProjectContext, renamer: "ours" | "theirs"): RenameSet {
  const B = ctx.base, R = ctx[renamer], O = ctx[renamer === "ours" ? "theirs" : "ours"];
  const chR = changes(B, R), chO = changes(B, O);
  const sidNamed = (tbl: Table, name: string) => Object.entries(tbl).filter(([, x]) => same(x.name, name)).map(([s]) => s);
  const types: Record<string, string> = {};
  for (const [old, now] of Object.entries(chR.types)) {
    const sid = sidNamed(B, old)[0];
    if (chO.types[old] && chO.types[old] !== now) continue; // renamed differently on each side: the type's file conflicts
    if (sidNamed(O, old).some((s) => s !== sid)) continue;  // the other side made a new type with the old name
    types[old] = now;
  }
  // Every name an owner (type or family) goes by in any version, plus a family's member types.
  const names = (sid: string) => {
    const out = new Set<string>();
    for (const tbl of [B, R, O]) {
      const x = tbl[sid];
      if (!x) continue;
      out.add(x.name);
      if (x.kind === "family") for (const m of x.members) { out.add(m); if (types[m]) out.add(types[m]); }
    }
    return out;
  };
  const members: MemberRename[] = [];
  for (const [kind, list] of [["var", chR.vars], ["behavior", chR.behaviors]] as const) {
    const field = kind === "var" ? "vars" : "behaviors";
    for (const c of list) {
      const renamedSid = B[c.owner]?.[field].find((x) => x.name === c.old)?.sid;
      const other = O[c.owner]?.[field] ?? [];
      if (other.some((x) => same(x.name, c.old) && x.sid !== renamedSid)) continue; // a new one with the old name
      if (other.some((x) => x.sid === renamedSid && x.name !== c.old && x.name !== c.new)) continue; // renamed differently
      const owner = names(c.owner);
      members.push({ kind, old: c.old, new: c.new, owner, selfClasses: owner });
    }
  }
  return { types, members };
}

// Renames between a merge's common ancestor and its result (the finish step): every sid
// whose name changed, whichever side did it. The result is the reference for owner names.
export function resultRenameSet(base: Table, result: Table): RenameSet {
  const set = renameSet({ base, ours: result, theirs: base }, "ours");
  // A different type, variable or behavior that now carries the old name: references to it
  // are valid, leave them.
  const sidOf = (name: string) => Object.entries(base).find(([, x]) => same(x.name, name))?.[0];
  for (const old of Object.keys(set.types)) {
    if (Object.entries(result).some(([sid, x]) => same(x.name, old) && sid !== sidOf(old))) delete set.types[old];
  }
  set.members = set.members.filter((m) => !Object.values(result).some((x) => [...m.owner].some((o) => same(o, x.name)) &&
    (m.kind === "var" ? x.vars : x.behaviors).some((v) => same(v.name, m.old))));
  return set;
}

// Apply a set to one parsed file (the finish step). Expressions the resolver isn't sure about
// are left as they are and reported.
export function applyRenameSet(kind: string, v: unknown, set: RenameSet, onUnsure: (where: string, expr: string, reason: string) => void) {
  apply(kind, v, set);
  if (kind !== "eventSheet") return;
  forEachAce(v, (ace) => {
    const params = ace.parameters;
    if (!params || typeof params !== "object") return;
    for (const key of Object.keys(params)) {
      const p = (params as any)[key];
      if (typeof p !== "string" || NAMES_ONLY.has(key) || Object.keys(set.types).some((n) => same(n, p))) continue;
      const r = renameExpression(p, typeof ace.objectClass === "string" ? ace.objectClass : undefined, set);
      if (r.uncertain) onUnsure(`${ace.objectClass ?? "function"} ${ace.id ?? ace.callFunction ?? ""} (sid ${ace.sid}) parameter ${key}`, p, r.uncertain);
    }
  });
}

const merge = (a: RenameSet, b: RenameSet): RenameSet => ({ types: { ...a.types, ...b.types }, members: [...a.members, ...b.members] });

// ── applying a set to one version ─────────────────────────────────────────────────────

function apply(kind: string, v: unknown, set: RenameSet) {
  if (!v || typeof v !== "object" || (!Object.keys(set.types).length && !set.members.length)) return;
  const typeKey = (x: string) => Object.keys(set.types).find((n) => same(n, x));
  const type = (x: unknown) => { if (typeof x !== "string") return x; const k = typeKey(x); return k === undefined ? x : set.types[k]; };
  const vars = set.members.filter((m) => m.kind === "var"), behs = set.members.filter((m) => m.kind === "behavior");
  const ownedBy = (m: MemberRename, cls: unknown) => typeof cls === "string" && [...m.owner].some((o) => same(o, cls) || same(o, String(type(cls))));

  if (kind === "layout") {
    forEachInstance(v, (i) => {
      for (const m of vars) if (ownedBy(m, i.type)) {
        renameKey(i.instanceVariables, m.old, m.new);
        templateState(i, "instance-variable", (part) => part.state?.forEach((s: any) => { if (s?.iv === m.old) s.iv = m.new; }));
      }
      for (const m of behs) if (ownedBy(m, i.type)) {
        renameKey(i.behaviors, m.old, m.new);
        templateState(i, "behavior", (part) => { if (part.key === m.old) part.key = m.new; });
      }
      if (typeof i.type === "string") i.type = type(i.type);
    });
  } else if (kind === "eventSheet") {
    forEachAce(v, (ace) => {
      const cls = ace.objectClass;
      const params = ace.parameters;
      if (params && typeof params === "object") {
        for (const key of Object.keys(params)) {
          const p = (params as any)[key];
          if (typeof p !== "string") continue;
          if (key === "instance-variable") { for (const m of vars) if (same(p, m.old) && ownedBy(m, cls)) (params as any)[key] = m.new; continue; }
          if (NAMES_ONLY.has(key)) continue;
          if (typeKey(p) !== undefined) { (params as any)[key] = type(p); continue; } // a parameter naming the object
          const r = renameExpression(p, typeof cls === "string" ? cls : undefined, set);
          if (r.changed) (params as any)[key] = r.text; // sure: rewrite; unsure: leave, flagged after the merge
        }
      }
      if (typeof ace.behaviorType === "string") for (const m of behs) if (same(ace.behaviorType, m.old) && ownedBy(m, cls)) ace.behaviorType = m.new;
      if (typeof cls === "string") ace.objectClass = type(cls);
    });
  } else if (kind === "objectType") {
    const f = v as any;
    if (Array.isArray(f.members)) f.members = f.members.map(type);
  } else if (kind === "project") {
    const p = v as any;
    const folder = (f: any) => { if (!f) return; if (Array.isArray(f.items)) f.items = f.items.map(type); (f.subfolders ?? []).forEach(folder); };
    folder(p.objectTypes);
    folder(p.families);
    for (const c of p.containers ?? []) if (Array.isArray(c.members)) c.members = c.members.map(type);
  }
}

// Rename a key in place, keeping the key order.
function renameKey(o: unknown, from: string, to: string) {
  if (!o || typeof o !== "object" || !(from in o) || to in o) return;
  const entries = Object.entries(o).map(([k, x]) => [k === from ? to : k, x] as const);
  for (const k of Object.keys(o)) delete (o as any)[k];
  Object.assign(o, Object.fromEntries(entries));
}

function templateState(instance: any, id: string, fn: (part: any) => void) {
  for (const comp of instance?.template?.components ?? []) if (comp?.id === id) for (const part of comp.component ?? []) fn(part);
}

function forEachInstance(v: unknown, fn: (i: any) => void) {
  const walk = (x: any, key: string) => {
    if (Array.isArray(x)) {
      if (key === "instances" || key === "nonworld-instances") x.forEach((i) => { if (i && typeof i === "object") fn(i); });
      x.forEach((e) => walk(e, ""));
    } else if (x && typeof x === "object" && x.constructor === Object) for (const [k, e] of Object.entries(x)) walk(e, k);
  };
  walk(v, "");
}

// Actions and conditions (and function calls): objects with an objectClass or parameters.
// Plain objects only: conflict markers (Conflict/Run) aren't walked into.
function forEachAce(v: unknown, fn: (ace: any) => void) {
  const walk = (x: any) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object" && x.constructor === Object) {
      if ("objectClass" in x || "callFunction" in x || "parameters" in x) fn(x);
      Object.values(x).forEach(walk);
    }
  };
  walk(v);
}

// A best guess for an expression we couldn't be sure about, shown next to it in the
// conflict: every name that spells a renamed one, swapped (strings left alone).
function guess(expr: string, set: RenameSet): string {
  const tokens = tokenize(expr);
  if (!tokens) return expr;
  const member = new Map(set.members.map((m) => [m.old.toLowerCase(), m.new]));
  const types = new Map(Object.entries(set.types).map(([a, b]) => [a.toLowerCase(), b]));
  return tokens.map((t, i) => {
    if (t.kind !== "name") return t.text;
    const afterDot = tokens.slice(0, i).filter((x) => x.kind !== "space").at(-1)?.text === ".";
    return (afterDot ? member : types).get(t.text.toLowerCase()) ?? t.text;
  }).join("");
}

