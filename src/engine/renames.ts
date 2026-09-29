// Renames made on one side (same sid, new name) applied to the base and to the other side
// before merging, so what the other side added or kept follows the rename. C3 already
// renamed everything on the renaming side (skymen: after any rename, that side is right).
//
// Object types, families, instance variables, behaviors: instance `type`, variable keys and
// template flags, behavior keys, event `objectClass` / `behaviorType` / `instance-variable`,
// parameters naming the object, family members, project folders and containers.
// Event variables, functions, custom actions (tasks/event-renames.md): `variable` parameters
// and bare names in expressions, in the variable's scope (a global: everywhere; a local: all
// the children of its parent event and their sub-events; a function parameter: the function
// block, its own conditions and actions included), `callFunction`, `Functions.name(...)`,
// `customAction`. A parameter added on the renaming side is added to the other side's
// `callFunction` calls the way C3 does it. Other signature changes are flagged.
// Expressions go through expressions.ts and are only rewritten when it is sure; after the
// merge, any expression that may still use a renamed-away name, and any call with the wrong
// number of arguments, becomes a conflict (flagLeftovers).
import { changes, type EventTable, type Param, type ProjectContext, type Table } from "../context.ts";
import { renameExpression, tokenize, type MemberRename, type RenameSet } from "./expressions.ts";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Parameters holding a variable or timeline name, never an expression or an object.
const NAMES_ONLY = new Set(["instance-variable", "variable", "timeline"]);

// A function or custom action whose parameter list changed on the renaming side.
interface Signature { kind: "function" | "custom"; name: string; owner: string; old: number[]; params: Param[] }
interface EventRenames {
  globals: Record<string, string>;
  locals: { scope: number; old: string; new: string; chain?: boolean }[];
  params: { block: number; old: string; new: string; chain?: boolean }[];
  functions: Record<string, string>;
  customs: { owner: string; old: string; new: string; chain?: boolean }[];
  signatures: Signature[];
}
// Renames whose old name another object (variable, function…) carries on the renaming side:
// X → Y while Z → X, or a swap. References follow their object (skymen, 2026-09-29): such a
// rename is applied once, before the merge, to the other side (by object, since each name is
// looked up once). Never again on text that may already use the new names (after the merge,
// the finish step): there, applying it twice would turn the new X into Y too. Entries of the
// lists carry `chain` themselves.
interface Chains { types: Set<string>; globals: Set<string>; functions: Set<string> }
export interface Renames { objects: RenameSet; events: EventRenames; chains: Chains }

const noEvents = (): EventRenames => ({ globals: {}, locals: [], params: [], functions: {}, customs: [], signatures: [] });
const noChains = (): Chains => ({ types: new Set(), globals: new Set(), functions: new Set() });

export function applyRenames(kind: string, b: unknown, o: unknown, t: unknown, ctx: ProjectContext) {
  const fromOurs = renames(ctx, "ours"), fromTheirs = renames(ctx, "theirs");
  apply(kind, b, merge(fromOurs, fromTheirs));
  apply(kind, o, fromTheirs);
  apply(kind, t, fromOurs);
}

// After merging: what may still use a renamed-away name, and calls with the wrong number of
// arguments. Sure fixes are made; the rest become conflicts for a person to check in C3.
// Calls still written for a signature's old parameters aren't rewritten here: after the merge
// they can't be told from the renaming side's own calls (same argument count), so they're
// only reported (onWarn).
export function flagLeftovers(kind: string, merged: unknown, ctx: ProjectContext,
  onConflict: (ace: any, key: string, guess: string | undefined, reason: string) => void, onWarn: (ace: any, key: string, message: string) => void) {
  if (kind !== "eventSheet") return;
  const all = sure(merge(renames(ctx, "ours"), renames(ctx, "theirs")));
  if (isEmpty(all)) return;
  apply(kind, merged, all, (ace, key, reason, set) => {
    const v = key === "parameters" ? undefined : ace.parameters?.[key];
    // A wrong argument count has no guess; an unsure rename shows the renamed version.
    onConflict(ace, key, typeof v === "string" && !/ now takes /.test(reason) ? guess(v, set) : undefined, reason);
  }, onWarn);
}

// ── which renames, as seen from the other side ───────────────────────────────────────

function renames(ctx: ProjectContext, renamer: "ours" | "theirs"): Renames {
  const other = renamer === "ours" ? "theirs" : "ours";
  const chains = noChains();
  return {
    objects: objectRenames(ctx.base, ctx[renamer], ctx[other], chains),
    events: ctx.events ? eventRenames(ctx.events.base, ctx.events[renamer], ctx.events[other], chains) : noEvents(),
    chains,
  };
}

const sidNamed = (tbl: Table, name: string) => Object.entries(tbl).filter(([, x]) => same(x.name, name)).map(([s]) => s);

function objectRenames(B: Table, R: Table, O: Table, chains: Chains): RenameSet {
  const chR = changes(B, R), chO = changes(B, O);
  const types: Record<string, string> = {};
  for (const [old, now] of Object.entries(chR.types)) {
    const sid = sidNamed(B, old)[0];
    if (chO.types[old] && chO.types[old] !== now) continue; // renamed differently on each side: the type's file conflicts
    if (sidNamed(O, old).some((s) => s !== sid)) continue;  // the other side made a new type with the old name
    types[old] = now;
    if (sidNamed(R, old).some((s) => s !== sid)) chains.types.add(old);
  }
  // Every name an owner (type or family) goes by in any version, plus a family's member types;
  // minus the names another object carries in some version (X → Y while Z → X): those don't
  // say which object they mean, and the owner's other names still do.
  const names = (sid: string) => {
    const owners = new Set([sid]), out = new Set<string>();
    for (const tbl of [B, R, O]) {
      const x = tbl[sid];
      if (!x) continue;
      out.add(x.name);
      if (x.kind === "family") for (const m of x.members) { out.add(m); if (types[m]) out.add(types[m]); for (const s of sidNamed(tbl, m)) owners.add(s); }
    }
    for (const tbl of [B, R, O]) for (const [s, x] of Object.entries(tbl)) {
      if (!owners.has(s)) for (const n of [...out]) if (same(n, x.name)) out.delete(n);
    }
    return out;
  };
  const members: MemberRename[] = [];
  for (const [kind, list] of [["var", chR.vars], ["behavior", chR.behaviors]] as const) {
    const field = kind === "var" ? "vars" : "behaviors";
    for (const c of list) {
      const renamedSid = B[c.owner]?.[field].find((x) => x.name === c.old)?.sid;
      const others = O[c.owner]?.[field] ?? [];
      if (others.some((x) => same(x.name, c.old) && x.sid !== renamedSid)) continue; // a new one with the old name
      if (others.some((x) => x.sid === renamedSid && x.name !== c.old && x.name !== c.new)) continue; // renamed differently
      const owner = names(c.owner);
      const chain = (R[c.owner]?.[field] ?? []).some((x) => same(x.name, c.old) && x.sid !== renamedSid);
      members.push({ kind, old: c.old, new: c.new, owner, selfClasses: owner, ...(chain ? { chain } : {}) });
    }
  }
  return { types, members };
}

function eventRenames(B: EventTable, R: EventTable, O: EventTable, chains: Chains): EventRenames {
  const out = noEvents();
  for (const [sid, v] of Object.entries(R.vars)) {
    const b = B.vars[sid], o = O.vars[sid];
    if (!b || b.name === v.name) continue;
    if (o && o.name !== b.name && o.name !== v.name) continue; // renamed differently on each side
    // Another variable with the old name where this one is visible: on the other side, leave;
    // on the renaming side, a chain.
    const carried = (T: EventTable) => Object.entries(T.vars).some(([s, x]) => s !== sid && same(x.name, b.name) && (b.scope === null || x.scope === b.scope || x.scope === null));
    if (carried(O)) continue;
    const chain = carried(R);
    if (b.scope === null) { out.globals[b.name] = v.name; if (chain) chains.globals.add(b.name); }
    else out.locals.push({ scope: b.scope, old: b.name, new: v.name, ...(chain ? { chain } : {}) });
  }
  for (const [sid, f] of Object.entries(R.fns)) {
    const b = B.fns[sid], o = O.fns[sid];
    if (!b) continue;
    if (b.name !== f.name && !(o && o.name !== b.name && o.name !== f.name)) {
      // Another function (custom action of the same object) with the old name.
      const carried = (T: EventTable) => Object.entries(T.fns).some(([s, x]) => s !== sid && x.kind === f.kind && same(x.name, b.name) && (f.kind === "function" || same(x.owner, b.owner)));
      if (!carried(O)) {
        if (f.kind === "function") { out.functions[b.name] = f.name; if (carried(R)) chains.functions.add(b.name); }
        else out.customs.push({ owner: b.owner, old: b.name, new: f.name, ...(carried(R) ? { chain: true } : {}) });
      }
    }
    for (const p of f.params) {
      const bp = b.params.find((x) => x.sid === p.sid);
      if (!bp || bp.name === p.name) continue;
      const carried = (params: Param[] | undefined) => (params ?? []).some((x) => x.sid !== p.sid && same(x.name, bp.name));
      if (carried(o?.params)) continue; // the other side made a new parameter with the old name
      out.params.push({ block: Number(sid), old: bp.name, new: p.name, ...(carried(f.params) ? { chain: true } : {}) });
    }
    const [bs, rs] = [b.params.map((p) => p.sid), f.params.map((p) => p.sid)];
    const otherChanged = o && o.params.map((p) => p.sid).join() !== bs.join();
    if (bs.join() !== rs.join() && !otherChanged) out.signatures.push({ kind: f.kind, name: f.name, owner: f.owner, old: bs, params: f.params });
  }
  return out;
}

const merge = (a: Renames, b: Renames): Renames => ({
  objects: { types: { ...a.objects.types, ...b.objects.types }, members: [...a.objects.members, ...b.objects.members] },
  events: {
    globals: { ...a.events.globals, ...b.events.globals }, locals: [...a.events.locals, ...b.events.locals],
    params: [...a.events.params, ...b.events.params], functions: { ...a.events.functions, ...b.events.functions },
    customs: [...a.events.customs, ...b.events.customs], signatures: [...a.events.signatures, ...b.events.signatures],
  },
  chains: {
    types: new Set([...a.chains.types, ...b.chains.types]), globals: new Set([...a.chains.globals, ...b.chains.globals]),
    functions: new Set([...a.chains.functions, ...b.chains.functions]),
  },
});
// Without the chain renames: what can be applied again to text that may use the new names.
function sure(r: Renames): Renames {
  const keep = (m: Record<string, string>, drop: Set<string>) => Object.fromEntries(Object.entries(m).filter(([old]) => !drop.has(old)));
  return {
    objects: { types: keep(r.objects.types, r.chains.types), members: r.objects.members.filter((m) => !m.chain) },
    events: {
      ...r.events, globals: keep(r.events.globals, r.chains.globals), functions: keep(r.events.functions, r.chains.functions),
      locals: r.events.locals.filter((x) => !x.chain), params: r.events.params.filter((x) => !x.chain), customs: r.events.customs.filter((x) => !x.chain),
    },
    chains: noChains(),
  };
}
const isEmpty = (r: Renames) => !Object.keys(r.objects.types).length && !r.objects.members.length &&
  !Object.keys(r.events.globals).length && !r.events.locals.length && !r.events.params.length &&
  !Object.keys(r.events.functions).length && !r.events.customs.length && !r.events.signatures.length;

// ── the finish step: between a merge's common ancestor and its result ─────────────────

// Every sid whose name changed, whichever side did it; the result is the reference. Chain
// renames are marked.
export function resultRenames(base: Table, result: Table, baseEvents?: EventTable, resultEvents?: EventTable): Renames {
  const chains = noChains();
  const objects = objectRenames(base, result, base, chains);
  const events = baseEvents && resultEvents ? eventRenames(baseEvents, resultEvents, baseEvents, chains) : noEvents();
  return { objects, events, chains };
}

// What the finish step applies where. `everywhere`: renames that can't chain, for every file
// (applying one again changes nothing). Chain renames and signature changes only reach the
// files still written the old way, the other side's: `tip` holds the ones the tip made (from
// base to the tip), `other` the rest.
export interface FinishRenames { everywhere: Renames; tip: Renames; other: Renames }
export function finishRenames(all: Renames, fromTip: Renames): FinishRenames {
  const plain = sure(all);
  const everywhere: Renames = { ...plain, events: { ...plain.events, signatures: [] } };
  const t = fromTip, sameEntry = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
  const byTip = {
    type: (old: string) => t.objects.types[old] === all.objects.types[old],
    member: (m: MemberRename) => t.objects.members.some((x) => x.kind === m.kind && x.old === m.old && x.new === m.new && [...x.owner].some((o) => m.owner.has(o))),
    global: (old: string) => t.events.globals[old] === all.events.globals[old],
    fn: (old: string) => t.events.functions[old] === all.events.functions[old],
    local: (l: EventRenames["locals"][number]) => t.events.locals.some((x) => x.scope === l.scope && x.old === l.old && x.new === l.new),
    param: (p: EventRenames["params"][number]) => t.events.params.some((x) => x.block === p.block && x.old === p.old && x.new === p.new),
    custom: (c: EventRenames["customs"][number]) => t.events.customs.some((x) => x.owner === c.owner && x.old === c.old && x.new === c.new),
    signature: (g: Signature) => t.events.signatures.some((x) => sameEntry({ ...x, params: x.params.map((p) => p.sid) }, { ...g, params: g.params.map((p) => p.sid) })),
  };
  const side = (tip: boolean): Renames => {
    const mine = (made: boolean) => made === tip;
    const pickMap = (m: Record<string, string>, chained: Set<string>, made: (old: string) => boolean) =>
      Object.fromEntries(Object.entries(m).filter(([old]) => chained.has(old) && mine(made(old))));
    return {
      objects: { types: pickMap(all.objects.types, all.chains.types, byTip.type), members: all.objects.members.filter((m) => m.chain && mine(byTip.member(m))) },
      events: {
        globals: pickMap(all.events.globals, all.chains.globals, byTip.global), functions: pickMap(all.events.functions, all.chains.functions, byTip.fn),
        locals: all.events.locals.filter((l) => l.chain && mine(byTip.local(l))), params: all.events.params.filter((p) => p.chain && mine(byTip.param(p))),
        customs: all.events.customs.filter((c) => c.chain && mine(byTip.custom(c))), signatures: all.events.signatures.filter((g) => mine(byTip.signature(g))),
      },
      chains: noChains(),
    };
  };
  return { everywhere, tip: side(true), other: side(false) };
}
export { merge as mergeRenames };

// Apply to one parsed file (the finish step); what can't be done for sure is reported.
export function applyRenameSet(kind: string, v: unknown, r: Renames, onUnsure: (where: string, expr: string, reason: string) => void) {
  apply(kind, v, r, (ace, key, reason) => onUnsure(aceLabel(ace, key), JSON.stringify(ace.parameters?.[key] ?? ace.parameters), reason));
}
export const aceLabel = (ace: any, key: string) => `${ace.objectClass ?? "function"} ${ace.id ?? ace.callFunction ?? ace.customAction ?? ""} (sid ${ace.sid}) parameter ${key}`;

// ── applying to one version ───────────────────────────────────────────────────────────

type Unsure = (ace: any, key: string, reason: string, set: RenameSet) => void;
type Warn = (ace: any, key: string, message: string) => void;

// `onWarn` given: after the merge, calls written for a signature's old parameters are
// reported instead of rewritten.
function apply(kind: string, v: unknown, r: Renames, onUnsure?: Unsure, onWarn?: Warn) {
  if (!v || typeof v !== "object" || isEmpty(r)) return;
  const set = r.objects;
  const typeKey = (x: string) => Object.keys(set.types).find((n) => same(n, x));
  const type = (x: unknown) => { if (typeof x !== "string") return x; const k = typeKey(x); return k === undefined ? x : set.types[k]; };
  const vars = set.members.filter((m) => m.kind === "var"), behs = set.members.filter((m) => m.kind === "behavior");
  const ownedBy = (m: MemberRename, cls: unknown) => typeof cls === "string" && [...m.owner].some((o) => same(o, cls) || same(o, String(type(cls))));

  // An instance's (or action's) variables and behaviors, each renamed once (a swap works).
  const ownMap = (list: MemberRename[], cls: unknown) => { const out = new Map<string, string>(); for (const m of list) if (ownedBy(m, cls) && !out.has(m.old)) out.set(m.old, m.new); return out; };
  if (kind === "layout") {
    forEachInstance(v, (i) => {
      const iv = ownMap(vars, i.type), bh = ownMap(behs, i.type);
      if (iv.size) {
        renameKeys(i.instanceVariables, iv);
        templateState(i, "instance-variable", (part) => part.state?.forEach((s: any) => { if (iv.has(s?.iv)) s.iv = iv.get(s.iv); }));
      }
      if (bh.size) {
        renameKeys(i.behaviors, bh);
        templateState(i, "behavior", (part) => { if (bh.has(part.key)) part.key = bh.get(part.key); });
      }
      if (typeof i.type === "string") i.type = type(i.type);
    });
  } else if (kind === "eventSheet") {
    const ev = r.events;
    const lookup = (map: Record<string, string>, name: string) => { const k = Object.keys(map).find((n) => same(n, name)); return k === undefined ? undefined : map[k]; };
    forEachEventAce(v, (ace, event, ancestors) => {
      // Event variables visible here: globals, locals of an enclosing event's children,
      // parameters of an enclosing function block (its own conditions and actions too).
      const inScope: Record<string, string> = { ...ev.globals };
      for (const l of ev.locals) if (ancestors.includes(l.scope)) inScope[l.old] = l.new;
      for (const p of ev.params) if (ancestors.includes(p.block) || event.sid === p.block) inScope[p.old] = p.new;
      const scoped: RenameSet = { ...set, vars: inScope, functions: ev.functions };
      const cls = ace.objectClass;
      const params = ace.parameters;
      if (params && typeof params === "object") {
        for (const key of Object.keys(params)) {
          const p = (params as any)[key];
          if (typeof p !== "string") continue;
          if (key === "instance-variable") { const m = vars.find((x) => same(p, x.old) && ownedBy(x, cls)); if (m) (params as any)[key] = m.new; continue; }
          if (key === "variable") { const n = lookup(inScope, p); if (n !== undefined) (params as any)[key] = n; continue; }
          if (NAMES_ONLY.has(key)) continue;
          if (typeKey(p) !== undefined) { (params as any)[key] = type(p); continue; } // a parameter naming the object
          const res = renameExpression(p, typeof cls === "string" ? cls : undefined, scoped);
          if (res.changed) (params as any)[key] = res.text; // sure: rewrite
          else if (res.uncertain) onUnsure?.(ace, key, res.uncertain, scoped);
          const wrong = wrongCalls(res.changed ? res.text : p, ev.signatures);
          if (wrong) onUnsure?.(ace, key, wrong, scoped);
        }
      }
      if (typeof ace.behaviorType === "string") { const m = behs.find((x) => same(ace.behaviorType, x.old) && ownedBy(x, cls)); if (m) ace.behaviorType = m.new; }
      if (typeof ace.callFunction === "string") {
        ace.callFunction = lookup(ev.functions, ace.callFunction) ?? ace.callFunction;
        fixCall(ace, ev.signatures.find((s) => s.kind === "function" && same(s.name, ace.callFunction)), onUnsure, scoped, onWarn);
      }
      if (typeof ace.customAction === "string") {
        const owner = String(ace.customActionObjectClass ?? cls);
        const c = ev.customs.find((x) => same(x.old, ace.customAction) && (same(x.owner, owner) || same(String(type(x.owner)), owner)));
        if (c) ace.customAction = c.new;
        fixCall(ace, ev.signatures.find((s) => s.kind === "custom" && same(s.name, ace.customAction) && (same(s.owner, owner) || same(String(type(s.owner)), owner))), onUnsure, scoped, onWarn);
      }
      if (typeof cls === "string") ace.objectClass = type(cls);
      if (typeof ace.customActionObjectClass === "string") ace.customActionObjectClass = type(ace.customActionObjectClass);
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

// A call to a function (or custom action) whose parameters changed on the renaming side,
// still written for the old ones: do what C3 does to existing calls (checked against its
// own commits): a removed parameter's argument is dropped, an added one gets the default (a
// string quoted, a number as text, a boolean as true/false). A call already matching the new
// parameters is left. Reordered parameters, or any other count: unsure. With `onWarn` (after
// the merge) a call that looks old is only reported.
function fixCall(ace: any, sig: Signature | undefined, onUnsure: Unsure | undefined, set: RenameSet, onWarn?: Warn) {
  if (!sig) return;
  if (ace.parameters !== undefined && !Array.isArray(ace.parameters)) return;
  const args: unknown[] = ace.parameters ?? [];
  const now = sig.params.map((p) => p.sid);
  const kept = sig.old.filter((sid) => now.includes(sid));
  const reordered = now.filter((sid) => sig.old.includes(sid)).join() !== kept.join();
  if (args.length === now.length && (args.length !== sig.old.length || reordered)) return; // already the new form
  const def = (p: Param) => (p.type === "string" ? `"${p.initialValue.replace(/"/g, '""')}"` : p.type === "number" ? p.initialValue : p.type === "boolean" ? p.initialValue === "true" : undefined);
  if (!reordered && args.length === sig.old.length && sig.params.every((p) => sig.old.includes(p.sid) || def(p) !== undefined)) {
    if (onWarn) { onWarn(ace, "parameters", `${sig.name} now takes ${sig.params.length} parameter(s) (${sig.params.map((p) => p.name).join(", ")}), changed on the other side; this call may still be written for the old ones: check it in C3`); return; }
    ace.parameters = sig.params.map((p) => (sig.old.includes(p.sid) ? args[sig.old.indexOf(p.sid)] : def(p)));
    return;
  }
  onUnsure?.(ace, "parameters", `${sig.name} now takes ${sig.params.length} parameter(s) (${sig.params.map((p) => p.name).join(", ")}), changed on the other side; this call passes ${args.length}`, set);
}

// `Functions.f(...)` calls in an expression whose argument count doesn't match f's new
// parameters (changed on the other side). Not rewritten: flagged.
function wrongCalls(expr: string, sigs: Signature[]): string | null {
  const fns = sigs.filter((s) => s.kind === "function");
  if (!fns.length || !/functions/i.test(expr)) return null;
  const t = tokenize(expr)?.filter((x) => x.kind !== "space");
  if (!t) return null;
  for (let i = 0; i + 3 < t.length; i++) {
    if (!(same(t[i].text, "Functions") && t[i + 1].text === "." && t[i + 3].text === "(")) continue;
    const sig = fns.find((s) => same(s.name, t[i + 2].text));
    if (!sig) continue;
    let depth = 0, count = 0, any = false;
    for (let j = i + 3; j < t.length; j++) {
      if (t[j].text === "(") { depth++; continue; }
      if (t[j].text === ")") { if (--depth === 0) break; continue; }
      if (depth === 1 && t[j].text === ",") count++;
      else any = true;
    }
    const n = any ? count + 1 : 0;
    if (n !== sig.params.length) return `${sig.name} now takes ${sig.params.length} parameter(s), changed on the other side; this call passes ${n}`;
  }
  return null;
}

// Rename keys in place, all at once (a swap works), keeping the key order. A key whose new
// name another key keeps (not renamed away) is left as it is.
function renameKeys(o: unknown, map: Map<string, string>) {
  if (!o || typeof o !== "object") return;
  const keys = Object.keys(o), staying = new Set(keys.filter((k) => !map.has(k)));
  const entries = keys.map((k) => { const to = map.get(k); return [to !== undefined && !staying.has(to) ? to : k, (o as any)[k]] as const; });
  if (entries.every(([k], i) => k === keys[i]) || new Set(entries.map(([k]) => k)).size !== entries.length) return;
  for (const k of keys) delete (o as any)[k];
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

// Every condition and action of an event sheet, with its event and the sids of the events
// around it (outermost first). Plain objects only: conflict markers (Conflict/Run) aren't
// walked into.
function forEachEventAce(sheet: unknown, fn: (ace: any, event: any, ancestors: number[]) => void) {
  const plain = (x: any) => x && typeof x === "object" && x.constructor === Object;
  const walk = (list: unknown, ancestors: number[]) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (!plain(e)) continue;
      if (typeof e.objectClass === "string") fn(e, e, ancestors); // a custom action block belongs to an object
      for (const k of ["conditions", "actions"]) if (Array.isArray(e[k])) for (const ace of e[k]) if (plain(ace)) fn(ace, e, ancestors);
      walk(e.children, typeof e.sid === "number" ? [...ancestors, e.sid] : ancestors);
    }
  };
  walk((sheet as any)?.events, []);
}

// A best guess for an expression we couldn't be sure about, shown next to it in the
// conflict: every name that spells a renamed one, swapped (strings left alone).
function guess(expr: string, set: RenameSet): string {
  const tokens = tokenize(expr);
  if (!tokens) return expr;
  const member = new Map(set.members.map((m) => [m.old.toLowerCase(), m.new]));
  const types = new Map(Object.entries(set.types).map(([a, b]) => [a.toLowerCase(), b]));
  const bare = new Map(Object.entries(set.vars ?? {}).map(([a, b]) => [a.toLowerCase(), b]));
  const fns = new Map(Object.entries(set.functions ?? {}).map(([a, b]) => [a.toLowerCase(), b]));
  return tokens.map((t, i) => {
    if (t.kind !== "name") return t.text;
    const prev = tokens.slice(0, i).filter((x) => x.kind !== "space");
    const afterDot = prev.at(-1)?.text === ".";
    const l = t.text.toLowerCase();
    if (afterDot) return (same(prev.at(-2)?.text ?? "", "Functions") ? fns.get(l) : member.get(l)) ?? t.text;
    return types.get(l) ?? bare.get(l) ?? t.text;
  }).join("");
}
