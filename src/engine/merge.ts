// Structural 3-way merge of one C3 JSON file (DESIGN.md "Engine"). Only merges what is
// certainly right; everything else becomes a Conflict (a value) or a Run (a stretch of
// list elements) that render.ts writes out between conflict markers. Ambiguous order is
// merged anyway and reported as a warning.
import { changes, type Changes, type ProjectContext } from "../context.ts";
import { profileFor, ruleFor, type Profile, type Rule } from "../profiles/index.ts";
import { mergeLines } from "./lines.ts";
import { reconcileMoves, type ForcedConflict } from "./moves.ts";
import { aceLabel, applyRenames, flagLeftovers } from "./renames.ts";
import { detectStyle, render } from "./render.ts";
import { mergeTilemap } from "./tiles.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export const ABSENT: unique symbol = Symbol("absent");
export type Maybe = Json | typeof ABSENT;

// A value both sides changed differently. ABSENT = deleted (or never added) on that side.
// `labels` replace "ours"/"theirs" on the markers when the sides aren't the two branches
// (an expression as merged vs the renamed guess).
export class Conflict { constructor(readonly ours: Maybe, readonly theirs: Maybe, readonly labels?: [string, string]) {} }
// A stretch of list elements the two sides disagree on.
export class Run { constructor(readonly ours: Json[], readonly theirs: Json[], readonly labels?: [string, string]) {} }

// `path` identifies the spot exactly (layers[sid=…]); `where` is for people (layers[Background]).
export interface Issue { path: string; where: string; message: string }
export interface MergeResult { text: string; conflicts: Issue[]; warnings: Issue[] }

export class ParseError extends Error {}

// `context` (what changed across the project on each side, from context.ts) lets renames
// reach this file and tells C3's automatic changes from edits; without it, per file only.
export function mergeFile(repoPath: string, base: string | null, ours: string, theirs: string, context?: ProjectContext): MergeResult {
  const clean = (text: string): MergeResult => ({ text, conflicts: [], warnings: [] });
  if (ours === theirs || base === theirs) return clean(ours);
  if (base === ours) return clean(theirs);
  const parse = (side: string, text: string | null): Maybe => {
    if (text === null) return ABSENT;
    try { return JSON.parse(text); } catch (e) { throw new ParseError(`${side}: ${(e as Error).message}`); }
  };
  const b = parse("base", base), o = parse("ours", ours), t = parse("theirs", theirs);
  const [oAsIs, tAsIs] = [JSON.stringify(o), JSON.stringify(t)];
  const profile = profileFor(repoPath);
  if (context) applyRenames(profile.kind, b, o, t, context);
  const forced = reconcileMoves(profile, b, o, t);
  const sides = context && { ours: changes(context.base, context.ours), theirs: changes(context.base, context.theirs) };
  const m = new Merger(profile, sides);
  const merged = m.merge(b, o, t, "", "", "");
  m.applyForced(merged, forced);
  if (context) flagLeftovers(profile.kind, merged, context, (ace, key, guess, reason) => {
    const where = aceLabel(ace, key);
    // A call with the wrong number of arguments: no guess, the hunk only marks the spot.
    if (guess === undefined) {
      m.flag(where, `${reason}: fix the call in C3`);
      if (key === "parameters") ace.parameters = new Conflict(ace.parameters, ace.parameters, ["as merged", "fix in C3"]);
      return;
    }
    m.flag(where, `may still use a name renamed on the other side (${reason}): check the guess in C3`);
    const v = ace.parameters[key];
    if (v instanceof Conflict || v instanceof Run) return; // already marked
    const labels: [string, string] = ["as merged", "renamed (check)"];
    ace.parameters[key] = Array.isArray(ace.parameters) ? new Run([v], [guess], labels) : new Conflict(v, guess, labels);
  });
  const result = { conflicts: m.conflicts, warnings: m.warnings };
  // Keep the exact bytes of a side when the merge is that side (formatting of non-C3 JSON).
  if (!m.conflicts.length) {
    const s = JSON.stringify(merged);
    if (s === oAsIs) return { text: ours, ...result };
    if (s === tAsIs) return { text: theirs, ...result };
  }
  return { text: render(merged, detectStyle(ours)), ...result };
}

export const isObj = (v: unknown): v is { [k: string]: Json } => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// Deep equality where object key order doesn't matter (it doesn't for C3).
export function eq(a: Maybe, b: Maybe): boolean {
  if (a === b) return true;
  if (a === ABSENT || b === ABSENT || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as Json[]).length && a.every((x, i) => eq(x, (b as Json[])[i]));
  const ka = Object.keys(a), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => has(b as object, k) && eq((a as any)[k], (b as any)[k]));
}
const canon = (v: Json): string =>
  isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : JSON.stringify(v);

type ListRule = { id: string[]; also?: string[]; repeats?: boolean; order: "ordered" | "set" };

class Merger {
  conflicts: Issue[] = [];
  warnings: Issue[] = [];
  constructor(private profile: Profile, private sides?: { ours: Changes; theirs: Changes }) {}

  flag(where: string, message: string) { this.conflict(where, where, message); }

  // Moves that couldn't be settled (moves.ts): each side's copy becomes that side of a hunk.
  applyForced(v: unknown, forced: Map<object, ForcedConflict>) {
    if (!forced.size) return;
    const walk = (x: unknown) => {
      if (Array.isArray(x)) {
        for (let i = 0; i < x.length; i++) {
          const f = forced.get(x[i]);
          if (f) {
            x[i] = f.side === "ours" ? new Run([x[i]], []) : new Run([], [x[i]]);
            if (!this.conflicts.some((c) => c.where === f.where)) this.conflict(f.where, f.where, f.message);
          } else walk(x[i]);
        }
      } else if (isObj(x)) Object.values(x).forEach(walk);
    };
    walk(v);
  }

  // `path` is for people (layers[sid=…].parallaxX); `pattern` for profile lookup (layers[].parallaxX).
  merge(b: Maybe, o: Maybe, t: Maybe, path: string, pattern: string, where: string): any {
    if (eq(o, t)) return o;
    if (eq(b, o)) return t;
    if (eq(b, t)) return o;
    const rule = ruleFor(this.profile, pattern);
    if (rule && "scalar" in rule && typeof o === "number" && typeof t === "number") return Math.max(o, t);
    if (rule && "tiles" in rule && b !== ABSENT && o !== ABSENT && t !== ABSENT) return this.mergeTiles(b, o, t, path, where);
    if (!(rule && ("atomic" in rule || "tiles" in rule))) {
      if (isObj(o) && isObj(t) && (isObj(b) || b === ABSENT)) return this.mergeObject(b === ABSENT ? {} : b, o, t, path, pattern, where);
      if (Array.isArray(o) && Array.isArray(t) && (Array.isArray(b) || b === ABSENT)) {
        const r = this.mergeList(b === ABSENT ? [] : b, o, t, path, pattern, where);
        if (r) return r;
      }
    }
    this.conflict(path, where, o === ABSENT || t === ABSENT ? "deleted on one side, changed on the other"
      : b === ABSENT ? "added on both sides with different values" : "changed on both sides");
    return new Conflict(o, t);
  }

  private conflict(path: string, where: string, message: string) { this.conflicts.push({ path: path || "(whole file)", where: where || "(whole file)", message }); }
  private warn(path: string, where: string, message: string) { this.warnings.push({ path: path || "(whole file)", where: where || "(whole file)", message }); }

  private mergeObject(b: { [k: string]: Json }, o: { [k: string]: Json }, t: { [k: string]: Json }, path: string, pattern: string, where: string) {
    // Ours' key order; a key only theirs added goes after the key it follows in theirs
    // (after ours' own new keys there: ours first).
    const keys = Object.keys(o);
    const oursNew = (k: string) => !has(t, k) && !has(b, k);
    let after = -1;
    for (const k of Object.keys(t)) {
      if (keys.includes(k)) { after = keys.indexOf(k); continue; }
      while (after + 1 < keys.length && oursNew(keys[after + 1])) after++;
      keys.splice(++after, 0, k);
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const get = (x: object) => (has(x, k) ? (x as any)[k] : ABSENT);
      const v = this.merge(get(b), get(o), get(t), path ? `${path}.${k}` : k, pattern ? `${pattern}.${k}` : k, where ? `${where}.${k}` : k);
      if (v !== ABSENT) out[k] = v;
    }
    return out;
  }

  // null: can't be merged element by element, the caller makes it one conflict.
  private mergeList(b: Json[], o: Json[], t: Json[], path: string, pattern: string, where: string): unknown[] | null {
    const rule: Rule | undefined = ruleFor(this.profile, `${pattern}[]`) ?? defaultRule(b, o, t);
    if (!rule || "atomic" in rule || "scalar" in rule || "tiles" in rule) return null;
    if ("lines" in rule) return this.mergeLineList(b, o, t, path, where);
    return this.mergeKeyed(b, o, t, rule, path, pattern, where);
  }

  // A tilemap painted on both sides: tile by tile (tiles.ts). Tiles changed differently on
  // both sides make one conflict whose two versions have every other tile merged, so taking
  // either keeps the rest of both sides' painting.
  private mergeTiles(b: Json, o: Json, t: Json, path: string, where: string) {
    const r = mergeTilemap(b, o, t);
    if ("merged" in r) return r.merged;
    if ("conflict" in r) { this.conflict(path, where, r.conflict); return new Conflict(o, t); }
    const n = r.clashes, shown = r.first.map(([x, y]) => `(${x}, ${y})`).join(", ");
    this.conflict(path, where, `${n} tile${n === 1 ? "" : "s"} changed differently on both sides at ${shown}${n > 5 ? ", …" : ""}; both versions have every other tile merged`);
    return new Conflict(r.ours, r.theirs);
  }

  private mergeLineList(b: Json[], o: Json[], t: Json[], path: string, where: string) {
    const strings = (l: Json[]): l is string[] => l.every((x) => typeof x === "string");
    if (!strings(b) || !strings(o) || !strings(t)) return null;
    const chunks = mergeLines(b, o, t);
    if (!chunks) return null;
    if (chunks.some((c) => typeof c !== "string")) this.conflict(path, where, "the same lines were changed on both sides");
    return chunks.map((c) => (typeof c === "string" ? c : new Run(c.ours, c.theirs)));
  }

  private mergeKeyed(b: Json[], o: Json[], t: Json[], rule: ListRule, path: string, pattern: string, where: string) {
    const ids = (l: Json[]) => l.map((e) => identity(e, rule.id));
    const [ib, io, it] = [ids(b), ids(o), ids(t)];
    // Elements we can't tell apart: merge the list as one value. Except identical elements
    // identified by their content where the rule allows it (`repeats`: comments): copies are
    // interchangeable, so they share one id (placed by their neighbours, below).
    for (const l of [ib, io, it]) {
      if (l.some((x) => x === null)) return null;
      const dup = repeated(l as string[]);
      if (dup.size && !(rule.repeats && [...dup].every((id) => id.startsWith("content:")))) return null;
    }
    const counts = (l: string[]) => { const c = new Map<string, number>(); for (const id of l) c.set(id, (c.get(id) ?? 0) + 1); return c; };
    const [nb, no, nt] = [ib, io, it].map((l) => counts(l as string[]));
    const once = (id: string) => (nb.get(id) ?? 0) <= 1 && (no.get(id) ?? 0) <= 1 && (nt.get(id) ?? 0) <= 1;
    // An element whose id isn't in the base but whose alternate id (sid) is: the same element
    // with a new id (uid renumbered), as long as that base element's id is gone on that side.
    if (rule.also) {
      const alt = new Map<string, string>();
      b.forEach((e, i) => { const a = identity(e, rule.also!); if (a) alt.set(a, ib[i]!); });
      const baseIds = new Set(ib);
      for (const [l, ids] of [[o, io], [t, it]] as const) {
        const present = new Set(ids);
        l.forEach((e, i) => {
          if (baseIds.has(ids[i])) return;
          const a = identity(e, rule.also!), baseId = a ? alt.get(a) : undefined;
          if (baseId && !present.has(baseId)) { ids[i] = baseId; present.add(baseId); }
        });
      }
    }
    const B = new Map(ib.map((id, i) => [id!, b[i]])), O = new Map(io.map((id, i) => [id!, o[i]])), T = new Map(it.map((id, i) => [id!, t[i]]));
    const elPath = (id: string) => `${path}[${label(id)}]`;
    const elWhere = (id: string) => `${where}[${friendly(O.get(id) ?? T.get(id) ?? B.get(id)) ?? label(id)}]`;

    // Merge each element; `kept` holds what survives (a value or a Run).
    const kept = new Map<string, unknown>();
    for (const id of new Set([...ib, ...io, ...it] as string[])) {
      const [inB, inO, inT] = [B.has(id), O.has(id), T.has(id)];
      if (inO && inT) {
        const v = this.merge(inB ? B.get(id)! : ABSENT, O.get(id)!, T.get(id)!, elPath(id), `${pattern}[]`, elWhere(id));
        kept.set(id, v instanceof Conflict ? new Run([O.get(id)!], [T.get(id)!]) : v);
      } else if (inO || inT) {
        const [mine, side] = inO ? [O.get(id)!, "ours"] : [T.get(id)!, "theirs"];
        if (!inB) kept.set(id, mine); // added on one side
        else if (!this.onlyAutomatic(B.get(id)!, mine, migrated(b, inO ? o : t), side === "ours" ? this.sides?.ours : this.sides?.theirs)) {
          this.conflict(elPath(id), elWhere(id), `deleted on ${side === "ours" ? "theirs" : "ours"}, changed on ${side}`);
          kept.set(id, inO ? new Run([mine], []) : new Run([], [mine]));
        } // else: deleted on the other side and untouched here → gone
      }
    }

    // Order. Primary = the side that reordered the elements all three share (ours by default).
    const common = (l: (string | null)[]) => (l as string[]).filter((id) => B.has(id) && O.has(id) && T.has(id) && once(id));
    const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
    const [cb, co, ct] = [common(ib), common(io), common(it)];
    const ordered = rule.order === "ordered";
    if (ordered && !same(co, cb) && !same(ct, cb) && !same(co, ct)) this.warn(path, where, "reordered on both sides: kept ours' order, check it in the editor");
    const primaryIsOurs = !same(co, cb) || same(ct, cb);
    const [P, other, Pmap] = primaryIsOurs ? [io as string[], it as string[], O] : [it as string[], io as string[], T];
    const otherOnly = (id: string) => !Pmap.has(id);

    // Insert the other side's extra elements after the element they follow there.
    // Copies of a repeated element (identical comments) share an id, so a copy is told apart
    // by where it sits: the nearest element above it that isn't repeated. In `seq` each copy
    // gets its own token, so what follows a copy is inserted after that copy.
    // Places come from the primary's whole list: what the other side deleted still says where
    // a copy was.
    const idOf = new Map<string, string>();
    const primary = P.map((id, i) => { if (once(id)) return id; const tok = `${id}\0${i}`; idOf.set(tok, id); return tok; });
    const real = (x: string) => idOf.get(x) ?? x;
    const places = (l: string[]) => { let above = "^"; return l.map((x) => { const id = real(x), key = `${id}\0${above}`; if (once(id)) above = id; return key; }); };
    let seq = primary.filter((x) => kept.has(real(x)));
    const placeOf = new Map<string, string>(), copies = new Map<string, string[]>(), copiesOf = new Map<string, string[]>();
    places(primary).forEach((key, i) => {
      const tok = primary[i], id = real(tok);
      if (once(id) || !kept.has(id)) return;
      placeOf.set(tok, key);
      copies.set(key, [...(copies.get(key) ?? []), tok]);
      copiesOf.set(id, [...(copiesOf.get(id) ?? []), tok]);
    });
    const inBase = counts(places(ib as string[]).filter((_, i) => !once(ib[i]!)));
    const [nSeq, nOther] = [counts(seq.map(real)), counts(other)];
    const used = new Set<string>();
    const take = (toks: string[] | undefined) => { const tok = toks?.find((x) => !used.has(x)); if (tok) used.add(tok); return tok; };
    const fromBase = (key: string) => { const n = inBase.get(key) ?? 0; if (n) inBase.set(key, n - 1); return n > 0; };
    const inSeq = new Set(seq.map(real));
    const otherPlaces = places(other);
    let anchor: string | null = null;
    const groups: { anchor: string | null; ids: string[] }[] = [];
    for (let i = 0; i < other.length; i++) {
      const id = other[i];
      if (!once(id) && inSeq.has(id)) {
        const key = otherPlaces[i];
        let tok = take(copies.get(key));
        if (tok) { fromBase(key); anchor = tok; continue; }   // the same copy, in the same place
        if (fromBase(key)) continue;                          // the base had it here: the primary deleted it
        // Elsewhere than in the base (something was added or moved around it): one of the
        // primary's copies, unless the other side really has more of them.
        if ((nOther.get(id) ?? 0) <= (nSeq.get(id) ?? 0) && (tok = take(copiesOf.get(id)))) { fromBase(placeOf.get(tok)!); anchor = tok; continue; }
        // else a copy the other side added: inserted like any new element
      } else if (inSeq.has(id)) { anchor = id; continue; }
      else if (!kept.has(id) || !otherOnly(id)) continue;
      const g = groups.at(-1);
      if (g && g.anchor === anchor) g.ids.push(id);
      else groups.push({ anchor, ids: [id] });
    }
    // The primary's copies the other side didn't have where the base did: deleted there, as far
    // as the other side really has fewer copies than the base.
    const dropped = new Map<string, number>();
    for (const tok of [...placeOf.keys()]) {
      const id = real(tok);
      if (used.has(tok) || (dropped.get(id) ?? 0) >= (nb.get(id) ?? 0) - (nOther.get(id) ?? 0) || !fromBase(placeOf.get(tok)!)) continue;
      dropped.set(id, (dropped.get(id) ?? 0) + 1);
      seq.splice(seq.indexOf(tok), 1);
    }
    const primaryAdded = (x: string) => !B.has(real(x)) && !(primaryIsOurs ? T : O).has(real(x));
    for (const g of groups) {
      let at = g.anchor === null ? 0 : seq.indexOf(g.anchor) + 1;
      let run = 0; // primary's own additions at the same spot
      while (at + run < seq.length && primaryAdded(seq[at + run])) run++;
      if (run && ordered) {
        const mine = seq.slice(at, at + run).map(real), theirsIds = g.ids;
        if (this.replacedOnBoth(g.anchor, ib as string[], kept, O, T)) {
          const [oi, ti] = primaryIsOurs ? [mine, theirsIds] : [theirsIds, mine];
          this.conflict(path, where, "the same element was replaced differently on both sides");
          const runId = `\0run${at}`;
          kept.set(runId, new Run(oi.map((id) => O.get(id)!), ti.map((id) => T.get(id)!)));
          seq.splice(at, run, runId);
          continue;
        }
        this.warn(path, where, "added at the same place on both sides: kept ours first, check the order in the editor");
      }
      if (primaryIsOurs) at += run; // ours first, then theirs
      seq = [...seq.slice(0, at), ...g.ids, ...seq.slice(at)];
    }

    const out = seq.map((x) => kept.get(real(x)));
    this.checkDuplicateNames(out, [b, o, t], path, where);
    this.checkDuplicateVariables(out, [b, o, t], path, where);
    return out;
  }

  // Changes C3 makes by itself are not edits, so a deletion on the other side wins over them
  // (renames were already applied to the base by applyRenames):
  // - keys every element of the list gained on that side and none had at base: a format
  //   change from opening the project in a newer release (e.g. every instance gets a sid
  //   and tags);
  // - on an instance, what its object type (or a family) gained on that side: variables,
  //   behaviors, effects, and the template flags for those variables.
  private onlyAutomatic(base: Json, mine: Json, newKeys: string[], side: Changes | undefined): boolean {
    if (eq(base, mine)) return true;
    if (!isObj(base) || !isObj(mine)) return false;
    const g = side && typeof mine.type === "string" && typeof mine.uid === "number" ? side.gained[mine.type] : undefined;
    if (!newKeys.length && !g) return false;
    const strip = (e: { [k: string]: Json }) => {
      const c = structuredClone(e) as any;
      for (const k of newKeys) delete c[k];
      if (!g) return c;
      for (const v of g.vars) if (c.instanceVariables) delete c.instanceVariables[v];
      for (const x of g.behaviors) if (c.behaviors) delete c.behaviors[x];
      for (const x of g.effects) if (c.effects) delete c.effects[x];
      for (const comp of c.template?.components ?? []) for (const part of comp.component ?? []) {
        if (Array.isArray(part.state)) part.state = part.state.filter((s: any) => !(isObj(s) && g.vars.includes(s.iv as string)));
      }
      return c;
    };
    return eq(strip(base), strip(mine));
  }

  // Base elements in the gap after `anchor` that both sides deleted: both replaced them.
  private replacedOnBoth(anchor: string | null, ib: string[], kept: Map<string, unknown>, O: Map<string, Json>, T: Map<string, Json>) {
    let i = anchor === null ? 0 : ib.indexOf(anchor) + 1;
    if (anchor !== null && i === 0) return false; // anchor not in base
    for (; i < ib.length && !kept.has(ib[i]); i++) if (!O.has(ib[i]) && !T.has(ib[i])) return true;
    return false;
  }

  // Two event variables with the same name in one scope (the same event list; C3 names ignore
  // case) where every version had unique ones: e.g. one side added `foo` next to `bar`
  // while the other renamed `bar` to `foo`.
  private checkDuplicateVariables(out: unknown[], versions: Json[][], path: string, where: string) {
    const vars = (l: unknown[]) => l.filter((e): e is { [k: string]: Json } => isObj(e) && e.eventType === "variable" && typeof e.name === "string");
    const unique = (l: unknown[]) => { const n = vars(l).map((v) => String(v.name).toLowerCase()); return new Set(n).size === n.length; };
    if (!versions.every(unique) || unique(out)) return;
    const seen = new Map<string, number>();
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (!isObj(e) || e.eventType !== "variable" || typeof e.name !== "string") continue;
      const key = e.name.toLowerCase(), j = seen.get(key);
      if (j === undefined) { seen.set(key, i); continue; }
      this.conflict(`${path}[variable ${e.name}]`, `${where}[variable ${e.name}]`,
        `two variables named "${e.name}" in the same scope: one side added one while the other probably renamed a variable to that name; keep both and rename one in C3`);
      out[i] = new Run([e], [], ["keep both, then rename one in C3", "drop this one"]);
    }
  }

  // Two elements with the same name where every version had unique names: both sides
  // created one (C3 refuses most duplicates).
  private checkDuplicateNames(out: unknown[], versions: Json[][], path: string, where: string) {
    const named = (l: unknown[]) => l.every((e) => isObj(e) && typeof e.name === "string");
    if (!versions.every((l) => named(l) && new Set(l.map((e: any) => e.name)).size === l.length)) return;
    const seen = new Map<string, number>();
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (!isObj(e) || typeof e.name !== "string") continue;
      const j = seen.get(e.name);
      if (j === undefined) { seen.set(e.name, i); continue; }
      this.conflict(`${path}[name=${e.name}]`, `${where}[${e.name}]`, "created on both sides with the same name");
      out[j] = new Run([out[j] as Json], [e]);
      out.splice(i--, 1);
    }
  }
}

// Keys every element of a side's list has and no element of the base list had.
function migrated(base: Json[], side: Json[]): string[] {
  if (!base.length || !side.length || !base.every(isObj) || !side.every(isObj)) return [];
  const first = side[0] as { [k: string]: Json };
  return Object.keys(first).filter((k) => side.every((e) => has(e as object, k)) && base.every((e) => !has(e as object, k)));
}

function defaultRule(b: Json[], o: Json[], t: Json[]): ListRule | undefined {
  const all = [...b, ...o, ...t];
  if (!all.every(isObj)) return undefined;
  for (const k of ["uid", "sid"]) if (all.every((e) => has(e as object, k))) return { id: [k], order: "ordered" };
  return undefined;
}

const repeated = (l: string[]) => { const seen = new Set<string>(), dup = new Set<string>(); for (const x of l) (seen.has(x) ? dup : seen).add(x); return dup; };

export function identity(e: Json, keys: string[]): string | null {
  for (const k of keys) {
    if (k === "content") return `content:${canon(e)}`;
    if (k === "[0]") { if (Array.isArray(e) && e.length) return `0=${canon(e[0])}`; continue; }
    const parts = k.split("+");
    if (isObj(e) && parts.every((p) => has(e, p))) {
      return parts.map((p) => `${p}=${typeof e[p] === "string" ? e[p] : JSON.stringify(e[p])}`).join(",");
    }
  }
  return null;
}

// How people recognise an element: its name, an instance as Type#uid, an event by its sid.
function friendly(e: Json | undefined): string | undefined {
  if (typeof e === "string") return e;
  if (!isObj(e)) return undefined;
  if (typeof e.name === "string") return e.name;
  if (typeof e.type === "string" && typeof e.uid === "number") return `${e.type}#${e.uid}`;
  if (typeof e.includeSheet === "string") return `include ${e.includeSheet}`;
  if (typeof e.eventType === "string") return `${e.eventType} ${e.sid ?? ""}`.trim();
  if (typeof e.id === "string") return e.sid === undefined ? e.id : `${e.id} ${e.sid}`;
  return undefined;
}

const label = (id: string) => {
  if (!id.startsWith("content:")) return id;
  const v = id.slice(8);
  return v.length > 40 ? `${v.slice(0, 37)}...` : v;
};
