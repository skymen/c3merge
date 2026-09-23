// Apply object type and family renames made on one side to the other side (and to the
// base), so references the other side added or kept follow the rename. Only references
// C3 itself updates when renaming, and only where they can be found for certain:
// instance types, event object classes, object parameters, `Name.` in expressions (never
// inside strings), family members, project folders and containers.
import type { ProjectContext } from "../context.ts";

type Map_ = Record<string, string>;

export function applyRenames(kind: string, b: unknown, o: unknown, t: unknown, ctx: ProjectContext) {
  const ours = { ...ctx.ours.renames }, theirs = { ...ctx.theirs.renames };
  // Renamed differently on each side: leave it to the conflict in the object type's file.
  for (const k of Object.keys(ours)) if (k in theirs && theirs[k] !== ours[k]) { delete ours[k]; delete theirs[k]; }
  rename(kind, b, { ...ours, ...theirs });
  rename(kind, o, theirs);
  rename(kind, t, ours);
}

// Parameters holding a variable or timeline name, which can equal an object type's name.
const NOT_OBJECTS = new Set(["instance-variable", "variable", "timeline"]);

function rename(kind: string, v: unknown, map: Map_) {
  if (!Object.keys(map).length || !v || typeof v !== "object") return;
  const swap = (x: unknown) => (typeof x === "string" && x in map ? map[x] : x);
  const walk = (x: any, key: string) => {
    if (Array.isArray(x)) {
      if (kind === "layout" && (key === "instances" || key === "nonworld-instances")) {
        for (const i of x) if (i && typeof i.type === "string") i.type = swap(i.type);
      }
      x.forEach((e) => walk(e, ""));
      return;
    }
    if (!x || typeof x !== "object") return;
    if (kind === "eventSheet") {
      if (typeof x.objectClass === "string") x.objectClass = swap(x.objectClass);
      if (Array.isArray(x.parameters)) x.parameters = x.parameters.map((p: unknown) => (typeof p === "string" ? renameInExpression(p, map) : p));
      else if (x.parameters && typeof x.parameters === "object") {
        for (const [k, p] of Object.entries(x.parameters)) {
          if (typeof p !== "string") continue;
          x.parameters[k] = p in map ? (NOT_OBJECTS.has(k) ? p : map[p]) : renameInExpression(p, map);
        }
      }
    }
    for (const [k, e] of Object.entries(x)) walk(e, k);
  };
  if (kind === "objectType" && Array.isArray((v as any).members)) (v as any).members = (v as any).members.map(swap);
  if (kind === "project") {
    const folder = (f: any) => { if (!f) return; if (Array.isArray(f.items)) f.items = f.items.map(swap); (f.subfolders ?? []).forEach(folder); };
    folder((v as any).objectTypes);
    folder((v as any).families);
    for (const c of (v as any).containers ?? []) if (Array.isArray(c.members)) c.members = c.members.map(swap);
    return;
  }
  walk(v, "");
}

// `Old.X` → `New.X` in an expression, skipping string literals ("..." with "" escapes).
export function renameInExpression(expr: string, map: Map_): string {
  let out = "";
  for (let i = 0; i < expr.length;) {
    if (expr[i] === '"') {
      let j = i + 1;
      while (j < expr.length && !(expr[j] === '"' && expr[j + 1] !== '"')) j += expr[j] === '"' ? 2 : 1;
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const m = /^[A-Za-z0-9_]+/.exec(expr.slice(i));
    if (m) {
      const name = m[0];
      const dotAfter = /^\s*\./.test(expr.slice(i + name.length));
      const dotBefore = /\.\s*$/.test(out);
      out += name in map && dotAfter && !dotBefore ? map[name] : name;
      i += name.length;
      continue;
    }
    out += expr[i++];
  }
  return out;
}
