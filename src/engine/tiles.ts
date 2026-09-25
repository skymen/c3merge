// Tilemap tiles (a Tilemap instance's ownData.tilemapData), merged tile by tile.
//
// C3 keeps a grid of max-width × max-height cells and saves all of it, column by column
// (cell x·max-height + y), run-length encoded: "67x0,13,3x23" = 67 empty cells, tile 12,
// three of tile 22 ("0" is empty, n is tile n−1; "h"/"v"/"d" after it = flipped). Only
// width × height shows; the rest are hidden cells, left by shrinking, by growing after a
// shrink (growing appends new columns past the old max) and by brush strokes at the edge.
// r449-5 keeps them forever, so the stored grid can grow huge (a 69×60 tilemap storing
// 10,411×3,077 cells in a real project); r495+ drops them the first time it reads a tilemap
// after loading the project. Read from the r449-5 and r500 editor code and checked in the
// editor (tasks/profiles.md#tilemaps). The merge works on runs, never on single cells.
import { eq, type Json } from "./merge.ts";

export interface TileRun { tile: string; count: number }

// Parse `data` into runs; null when a run is malformed ("2x"): r449-5 refuses to open the
// project and r495+ can't preview it (lab row 29).
export function tileRuns(data: string): TileRun[] | null {
  const runs: TileRun[] = [];
  for (const run of data.split(",")) {
    if (run === "") continue;
    const m = /^(?:(\d+)x)?(-?\d+)([hvd]*)$/.exec(run);
    if (!m) return null;
    // C3 writes the flags in this order whatever order it read them in.
    const tile = String(Number(m[2])) + ["h", "v", "d"].filter((f) => m[3].includes(f)).join("");
    runs.push({ tile, count: m[1] === undefined ? 1 : Number(m[1]) });
  }
  return runs;
}

// Runs as C3 writes them: equal neighbours joined, "n" alone, "countxn" otherwise.
export function encodeRuns(runs: TileRun[]): string {
  const out: TileRun[] = [];
  for (const r of runs) {
    if (!r.count) continue;
    const last = out.at(-1);
    if (last?.tile === r.tile) last.count += r.count;
    else out.push({ ...r });
  }
  return out.map((r) => (r.count === 1 ? r.tile : `${r.count}x${r.tile}`)).join(",");
}

export const encodeTiles = (cells: string[]) => encodeRuns(cells.map((tile) => ({ tile, count: 1 })));

interface Grid { width: number; height: number; maxWidth: number; maxHeight: number; runs: TileRun[] }
const GRID_KEYS = ["width", "height", "max-width", "max-height", "data"];
// Columns walked per merge at most (the widest stored grid in 3,070 real tilemaps: 10,411).
export const MAX_COLUMNS = 1_000_000;
const isNat = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function grid(v: Json): Grid | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.data !== "string") return null;
  const { width, height } = v, maxWidth = v["max-width"] ?? width, maxHeight = v["max-height"] ?? height;
  if (!isNat(width) || !isNat(height) || !isNat(maxWidth) || !isNat(maxHeight)) return null;
  const runs = tileRuns(v.data as string);
  return runs && { width, height, maxWidth, maxHeight, runs };
}

// Reads a grid's cells in storage order (positions never go back). Past the data, cells are
// empty (what C3 loads).
function reader(runs: TileRun[]) {
  let i = 0, start = 0;
  return (p: number): { tile: string; left: number } => {
    while (i < runs.length && start + runs[i].count <= p) start += runs[i++].count;
    return i < runs.length ? { tile: runs[i].tile, left: start + runs[i].count - p } : { tile: "0", left: Infinity };
  };
}

export type TileMerge =
  | { merged: Json }
  // `ours`/`theirs`: every tile merged except the `clashes` tiles changed differently on both
  // sides (`first`: where the first few are, as x, y), which take that side's tile.
  | { ours: Json; theirs: Json; clashes: number; first: [number, number][] }
  | { conflict: string };

// Only called when both sides changed the tilemap differently.
export function mergeTilemap(b: Json, o: Json, t: Json): TileMerge {
  const [gb, go, gt] = [b, o, t].map(grid);
  if (!gb || !go || !gt) return { conflict: "changed on both sides (tile data C3 can't read)" };
  const CLASH = Symbol("clash");
  const same = (x: unknown, y: unknown) => eq((x ?? null) as Json, (y ?? null) as Json) && (x === undefined) === (y === undefined);
  const pick = <T>(x: T, y: T, z: T): T | typeof CLASH => (same(y, z) || same(x, z) ? y : same(x, y) ? z : CLASH);

  const width = pick(gb.width, go.width, gt.width), height = pick(gb.height, go.height, gt.height);
  if (width === CLASH || height === CLASH) return { conflict: "resized differently on both sides" };
  // The stored grid: at least what shows; hidden cells a side dropped (r495+ trims) stay dropped.
  const keep = (x: number, y: number, z: number) => { const v = pick(x, y, z); return v === CLASH ? Math.max(y, z) : v; };
  const maxWidth = Math.max(width, keep(gb.maxWidth, go.maxWidth, gt.maxWidth));
  const maxHeight = Math.max(height, keep(gb.maxHeight, go.maxHeight, gt.maxHeight));

  // Other keys (none today but C3 may add some): changed on one side only, or the same.
  const rest = new Map<string, Json | undefined>();
  for (const k of new Set([...Object.keys(b as object), ...Object.keys(o as object), ...Object.keys(t as object)])) {
    if (GRID_KEYS.includes(k)) continue;
    const v = pick((b as any)[k], (o as any)[k], (t as any)[k]);
    if (v === CLASH) return { conflict: `"${k}" changed on both sides` };
    rest.set(k, v);
  }

  // Walk the cells by position, column by column, a stretch at a time: each stretch is cut
  // wherever a side's run, stored column or visible area ends, so everything is constant in
  // it (the merged grid's edges are always some side's edges). Also walks the columns and rows a side shows past the merged grid, to catch painting
  // the other side's resize would drop. A cell a side doesn't store (r495+ trimmed it) is
  // unchanged on that side, not erased. The editor writes hidden cells too (a brush stroke at
  // the edge), so they're merged like the rest.
  const sides = [gb, go, gt].map((g) => ({ g, read: reader(g.runs) }));
  const X = Math.max(maxWidth, go.width, gt.width), Y = Math.max(maxHeight, go.height, gt.height);
  if (X > MAX_COLUMNS) return { conflict: "changed on both sides (stored grid too wide to merge tile by tile)" };
  const outO: TileRun[] = [], outT: TileRun[] = [], first: [number, number][] = [];
  let clashes = 0, lost = 0;
  const emit = (out: TileRun[], tile: string, count: number) => { const last = out.at(-1); if (last?.tile === tile) last.count += count; else out.push({ tile, count }); };
  const shows = (g: Grid, x: number, y: number) => x < g.width && y < g.height;
  for (let x = 0; x < X; x++) {
    for (let y = 0; y < Y;) {
      let n = Y - y;
      const cut = (end: number) => { if (end > y && end - y < n) n = end - y; };
      const [vb, vo, vt] = sides.map(({ g, read }) => {
        cut(g.height);
        if (x >= g.maxWidth || y >= g.maxHeight) return undefined;
        cut(g.maxHeight);
        const r = read(x * g.maxHeight + y);
        if (r.left < n) n = r.left;
        return r.tile;
      });
      const base = vb ?? "0", ours = vo ?? base, theirs = vt ?? base;
      const visible = x < width && y < height;
      let mo = ours, mt = ours;
      if (ours === theirs || base === theirs) mo = mt = ours;
      else if (base === ours) mo = mt = theirs;
      // Both changed a cell that doesn't show once merged: nobody sees it, ours is kept.
      else if (visible) {
        mt = theirs;
        clashes += n;
        for (let k = 0; k < n && first.length < 5; k++) first.push([x, y + k]);
      }
      // Painted where it showed on one side, hidden (or dropped) by the other side's resize.
      if (!visible && ((ours !== base && shows(go, x, y)) || (theirs !== base && shows(gt, x, y)))) lost += n;
      if (x < maxWidth && y < maxHeight) { emit(outO, mo, n); emit(outT, mt, n); }
      y += n;
    }
  }
  if (lost) return { conflict: `${lost} tile${lost === 1 ? "" : "s"} painted on one side where the other side's resize hides them` };

  const build = (runs: TileRun[]) => {
    const out: Record<string, Json> = {};
    const hasMax = "max-width" in (o as object) || "max-width" in (t as object);
    const values: Record<string, Json> = { width, height, ...(hasMax ? { "max-width": maxWidth, "max-height": maxHeight } : {}), data: encodeRuns(runs) };
    for (const k of new Set([...Object.keys(o as object), ...Object.keys(t as object), ...Object.keys(values)])) {
      if (k in values) out[k] = values[k];
      else if (rest.get(k) !== undefined) out[k] = rest.get(k)!;
    }
    return out;
  };
  return clashes ? { ours: build(outO), theirs: build(outT), clashes, first } : { merged: build(outO) };
}
