// The project bar in project.c3proj: each item is listed once per tree, and its file lives at
// <kind>/<folders…>/<name>.json. Folders are merged one by one, so an item added (or moved)
// into a different folder on each side comes out listed in both (con-sule 4ce7cd9f6: 14
// layouts in "GreenGame🟩" on one side, "GreenGame🟩/Levels" on the other), with a file in
// each; C3 refuses a project that lists an item twice (lab rows 36c, 36d). Each copy becomes
// one side of a hunk, so taking the same side at both places lists it once.
import { Run, isObj, type Json } from "./merge.ts";

const TREES = ["objectTypes", "families", "layouts", "eventSheets", "timelines", "flowcharts", "models3d"];

interface Spot { list: unknown[]; index: number; folder: string }

// Every item of a tree with the folder it's in (names joined by "/", "" at the top). Hunks
// (Run) and unnamed folders (special ones, e.g. timeline transitions) are left out.
function spots(tree: unknown): Map<string, Spot[]> {
  const out = new Map<string, Spot[]>();
  const walk = (folder: unknown, dirs: string[]) => {
    if (!isObj(folder)) return;
    const items = folder.items;
    if (Array.isArray(items)) items.forEach((x, index) => {
      if (typeof x === "string") out.set(x, [...(out.get(x) ?? []), { list: items, index, folder: dirs.join("/") }]);
    });
    if (Array.isArray(folder.subfolders)) for (const sub of folder.subfolders) {
      if (isObj(sub) && typeof sub.name === "string") walk(sub, [...dirs, sub.name]);
    }
  };
  walk(tree, []);
  return out;
}

// After the merge (`b`, `o`, `t` with renames applied). `flag` reports one conflict per pair
// of folders.
export function settleFolders(b: unknown, o: unknown, t: unknown, merged: unknown, flag: (where: string, message: string) => void) {
  if (!isObj(merged) || !isObj(o) || !isObj(t)) return;
  for (const tree of TREES) {
    const got = spots(merged[tree]);
    const [B, O, T] = [isObj(b) ? b[tree] : undefined, o[tree], t[tree]].map(spots);
    const groups = new Map<string, { ours: string; theirs: string; names: string[] }>();
    for (const [name, copies] of got) {
      if (copies.length < 2 || [B, O, T].some((v) => (v.get(name)?.length ?? 0) > 1)) continue;
      const ours = O.get(name)?.[0].folder, theirs = T.get(name)?.[0].folder;
      const side = (c: Spot) => (c.folder === ours ? "ours" : c.folder === theirs ? "theirs" : null);
      if (ours === undefined || theirs === undefined || ours === theirs || !copies.every(side)) continue;
      for (const c of copies) c.list[c.index] = side(c) === "ours" ? new Run([name as Json], []) : new Run([], [name as Json]);
      const key = `${ours}\0${theirs}`;
      if (!groups.has(key)) groups.set(key, { ours, theirs, names: [] });
      groups.get(key)!.names.push(name);
    }
    for (const g of groups.values()) {
      const shown = (f: string) => (f === "" ? "(top)" : f);
      const file = (f: string) => `${[tree, ...(f ? [f] : []), g.names[0]].join("/")}.json`;
      const n = g.names.length;
      flag(`${tree} in "${shown(g.ours)}" and "${shown(g.theirs)}"`,
        `${n} item${n === 1 ? "" : "s"} put in a different folder on each side, now listed twice (${g.names.slice(0, 5).join(", ")}${n > 5 ? ", …" : ""}): take the same side at both places, then delete the files of the side you didn't take (ours: ${file(g.ours)}${n > 1 ? " …" : ""}, theirs: ${file(g.theirs)}${n > 1 ? " …" : ""})`);
    }
  }
}
