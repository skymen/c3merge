// Structural 3-way merge of one C3 JSON file (DESIGN.md "Engine"). Only merges what is
// certainly right; everything else becomes a Conflict (a value) or a Run (a stretch of
// list elements) that render.ts writes out between conflict markers. Ambiguous order is
// merged anyway and reported as a warning.
import { profileFor, ruleFor, type Profile, type Rule } from "../profiles/index.ts";
import { mergeLines } from "./lines.ts";
import { detectStyle, render } from "./render.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export const ABSENT: unique symbol = Symbol("absent");
export type Maybe = Json | typeof ABSENT;

// A value both sides changed differently. ABSENT = deleted (or never added) on that side.
export class Conflict { constructor(readonly ours: Maybe, readonly theirs: Maybe) {} }
// A stretch of list elements the two sides disagree on.
export class Run { constructor(readonly ours: Json[], readonly theirs: Json[]) {} }

// `path` identifies the spot exactly (layers[sid=…]); `where` is for people (layers[Background]).
export interface Issue { path: string; where: string; message: string }
export interface MergeResult { text: string; conflicts: Issue[]; warnings: Issue[] }

export class ParseError extends Error {}

export function mergeFile(repoPath: string, base: string | null, ours: string, theirs: string): MergeResult {
  const clean = (text: string): MergeResult => ({ text, conflicts: [], warnings: [] });
  if (ours === theirs || base === theirs) return clean(ours);
  if (base === ours) return clean(theirs);
  const parse = (side: string, text: string | null): Maybe => {
    if (text === null) return ABSENT;
    try { return JSON.parse(text); } catch (e) { throw new ParseError(`${side}: ${(e as Error).message}`); }
  };
  const b = parse("base", base), o = parse("ours", ours), t = parse("theirs", theirs);
  const m = new Merger(profileFor(repoPath));
  const merged = m.merge(b, o, t, "", "", "");
  const result = { conflicts: m.conflicts, warnings: m.warnings };
  // Keep the exact bytes of a side when the merge is that side (formatting of non-C3 JSON).
  if (!m.conflicts.length) {
    const s = JSON.stringify(merged);
    if (s === JSON.stringify(o)) return { text: ours, ...result };
    if (s === JSON.stringify(t)) return { text: theirs, ...result };
  }
  return { text: render(merged, detectStyle(ours)), ...result };
}

const isObj = (v: unknown): v is { [k: string]: Json } => v !== null && typeof v === "object" && !Array.isArray(v);
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

type ListRule = { id: string[]; order: "ordered" | "set" };

class Merger {
  conflicts: Issue[] = [];
  warnings: Issue[] = [];
  constructor(private profile: Profile) {}

  // `path` is for people (layers[sid=…].parallaxX); `pattern` for profile lookup (layers[].parallaxX).
  merge(b: Maybe, o: Maybe, t: Maybe, path: string, pattern: string, where: string): any {
    if (eq(o, t)) return o;
    if (eq(b, o)) return t;
    if (eq(b, t)) return o;
    const rule = ruleFor(this.profile, pattern);
    if (rule && "scalar" in rule && typeof o === "number" && typeof t === "number") return Math.max(o, t);
    if (!(rule && "atomic" in rule)) {
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
    if (!rule || "atomic" in rule || "scalar" in rule) return null;
    if ("lines" in rule) return this.mergeLineList(b, o, t, path, where);
    return this.mergeKeyed(b, o, t, rule, path, pattern, where);
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
    // Elements we can't tell apart: merge the list as one value.
    for (const l of [ib, io, it]) if (l.some((x) => x === null) || new Set(l).size !== l.length) return null;
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
        else if (!eq(B.get(id)!, mine)) {
          this.conflict(elPath(id), elWhere(id), `deleted on ${side === "ours" ? "theirs" : "ours"}, changed on ${side}`);
          kept.set(id, inO ? new Run([mine], []) : new Run([], [mine]));
        } // else: deleted on the other side and untouched here → gone
      }
    }

    // Order. Primary = the side that reordered the elements all three share (ours by default).
    const common = (l: (string | null)[]) => (l as string[]).filter((id) => B.has(id) && O.has(id) && T.has(id));
    const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
    const [cb, co, ct] = [common(ib), common(io), common(it)];
    const ordered = rule.order === "ordered";
    if (ordered && !same(co, cb) && !same(ct, cb) && !same(co, ct)) this.warn(path, where, "reordered on both sides: kept ours' order, check it in the editor");
    const primaryIsOurs = !same(co, cb) || same(ct, cb);
    const [P, other, Pmap] = primaryIsOurs ? [io as string[], it as string[], O] : [it as string[], io as string[], T];
    let seq = P.filter((id) => kept.has(id));
    const otherOnly = (id: string) => !Pmap.has(id);

    // Insert the other side's extra elements after the element they follow there.
    const inSeq = new Set(seq);
    let anchor: string | null = null;
    const groups: { anchor: string | null; ids: string[] }[] = [];
    for (let i = 0; i < other.length; i++) {
      const id = other[i];
      if (inSeq.has(id)) { anchor = id; continue; }
      if (!kept.has(id) || !otherOnly(id)) continue;
      const g = groups.at(-1);
      if (g && g.anchor === anchor) g.ids.push(id);
      else groups.push({ anchor, ids: [id] });
    }
    const primaryAdded = (id: string) => !B.has(id) && !(primaryIsOurs ? T : O).has(id);
    for (const g of groups) {
      let at = g.anchor === null ? 0 : seq.indexOf(g.anchor) + 1;
      let run = 0; // primary's own additions at the same spot
      while (at + run < seq.length && primaryAdded(seq[at + run])) run++;
      if (run && ordered) {
        const mine = seq.slice(at, at + run), theirsIds = g.ids;
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

    const out = seq.map((id) => kept.get(id));
    this.checkDuplicateNames(out, [b, o, t], path, where);
    return out;
  }

  // Base elements in the gap after `anchor` that both sides deleted: both replaced them.
  private replacedOnBoth(anchor: string | null, ib: string[], kept: Map<string, unknown>, O: Map<string, Json>, T: Map<string, Json>) {
    let i = anchor === null ? 0 : ib.indexOf(anchor) + 1;
    if (anchor !== null && i === 0) return false; // anchor not in base
    for (; i < ib.length && !kept.has(ib[i]); i++) if (!O.has(ib[i]) && !T.has(ib[i])) return true;
    return false;
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

function defaultRule(b: Json[], o: Json[], t: Json[]): ListRule | undefined {
  const all = [...b, ...o, ...t];
  if (!all.every(isObj)) return undefined;
  for (const k of ["uid", "sid"]) if (all.every((e) => has(e as object, k))) return { id: [k], order: "ordered" };
  return undefined;
}

function identity(e: Json, keys: string[]): string | null {
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
