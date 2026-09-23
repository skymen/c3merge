// Elements that move between lists of one file (an instance moved to another layer). Each
// list is merged on its own, so a move would look like a deletion in one list and an
// addition in another. Before merging, a move made on one side is replayed on the base and
// on the other side, so the element merges in its new place. Moves that can't be settled
// (moved to different lists on each side, or moved on one side and deleted on the other)
// become conflicts around each copy, so taking either side leaves exactly one.
import { ruleFor, type Profile } from "../profiles/index.ts";
import { identity, isObj, type Json } from "./merge.ts";

export interface ForcedConflict { side: "ours" | "theirs"; where: string; message: string }

interface Loc { list: string; arr: Json[]; el: Json }
interface Version { lists: Map<string, { arr: Json[]; id: string[]; also?: string[] }>; byId: Map<string, Loc>; byAlt: Map<string, string> }

// Movable lists by their keyed path (layers[sid=…].subLayers[sid=…].instances), and their elements.
function index(v: unknown, profile: Profile): Version {
  const version: Version = { lists: new Map(), byId: new Map(), byAlt: new Map() };
  const walk = (x: unknown, pattern: string, key: string) => {
    if (Array.isArray(x)) {
      const rule = ruleFor(profile, `${pattern}[]`);
      const idKeys = rule && "id" in rule ? rule.id : null;
      if (rule && "moves" in rule && rule.moves && idKeys) {
        version.lists.set(key, { arr: x, id: idKeys, also: rule.also });
        for (const el of x) {
          const id = identity(el, idKeys);
          if (id === null) continue;
          version.byId.set(id, { list: key, arr: x, el });
          const alt = rule.also ? identity(el, rule.also) : null;
          if (alt) version.byAlt.set(alt, id);
        }
      }
      x.forEach((e, i) => walk(e, `${pattern}[]`, `${key}[${(idKeys && identity(e, idKeys)) ?? i}]`));
    } else if (isObj(x)) {
      for (const [k, e] of Object.entries(x)) walk(e, pattern ? `${pattern}.${k}` : k, key ? `${key}.${k}` : k);
    }
  };
  walk(v, "", "");
  return version;
}

export function reconcileMoves(profile: Profile, b: unknown, o: unknown, t: unknown): Map<object, ForcedConflict> {
  const forced = new Map<object, ForcedConflict>();
  if (!b || !o || !t || typeof b !== "object") return forced;
  const [B, O, T] = [b, o, t].map((v) => index(v, profile));
  if (!B.lists.size) return forced;

  // The side's element for a base element: same id, or same alternate id (sid) when the
  // side changed the id (uid renumbered).
  const find = (side: Version, id: string, baseEl: Json): Loc | undefined => {
    const direct = side.byId.get(id);
    if (direct) return direct;
    const list = B.byId.get(id)!;
    const also = B.lists.get(list.list)?.also;
    const alt = also ? identity(baseEl, also) : null;
    const otherId = alt ? side.byAlt.get(alt) : undefined;
    return otherId && !B.byId.has(otherId) ? side.byId.get(otherId) : undefined;
  };
  const place = (version: Version, from: Loc, toList: string, mover: Loc): boolean => {
    const target = version.lists.get(toList);
    if (!target) return false;
    from.arr.splice(from.arr.indexOf(from.el), 1);
    // After the element that precedes it in the mover's list, if this version has it.
    const ids = target.arr.map((e) => identity(e, target.id));
    let at = 0;
    for (let j = mover.arr.indexOf(mover.el) - 1; j >= 0; j--) {
      const k = ids.indexOf(identity(mover.arr[j], target.id));
      if (k >= 0) { at = k + 1; break; }
    }
    target.arr.splice(at, 0, from.el);
    return true;
  };
  const label = (l: Loc) => (isObj(l.el) && typeof l.el.type === "string" ? `${l.el.type}#${l.el.uid}` : String(identity(l.el, ["uid", "sid"])));

  for (const [id, lb] of [...B.byId]) {
    const lo = find(O, id, lb.el), lt = find(T, id, lb.el);
    const movedO = !!lo && lo.list !== lb.list, movedT = !!lt && lt.list !== lb.list;
    if (!movedO && !movedT) continue;
    const where = `${lb.list}[${label(lb)}]`;
    if (movedO && movedT) {
      if (lo!.list === lt!.list) place(B, lb, lo!.list, lo!);
      else {
        forced.set(lo!.el as object, { side: "ours", where, message: "moved to a different layer on each side" });
        forced.set(lt!.el as object, { side: "theirs", where, message: "moved to a different layer on each side" });
      }
      continue;
    }
    const [mover, stayer, stayerV, moverSide] = movedT ? [lt!, lo, O, "theirs"] as const : [lo!, lt, T, "ours"] as const;
    if (!stayer) {
      forced.set(mover.el as object, { side: moverSide, where, message: `deleted on ${moverSide === "ours" ? "theirs" : "ours"}, moved to another layer on ${moverSide}` });
      continue;
    }
    // Replay the move on the base and on the other side. If the target layer is missing
    // there (created on the moving side), the element can't follow: if the other side
    // changed it, both copies become a conflict.
    if (B.lists.has(mover.list) && stayerV.lists.has(mover.list)) {
      place(B, lb, mover.list, mover);
      place(stayerV, stayer, mover.list, mover);
    } else if (JSON.stringify(stayer.el) !== JSON.stringify(lb.el)) {
      forced.set(mover.el as object, { side: moverSide, where, message: `moved to a new layer on ${moverSide}, changed on the other side` });
    }
  }
  return forced;
}
