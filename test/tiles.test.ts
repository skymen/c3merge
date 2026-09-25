// The tile merge works on runs (tiles.ts); this checks it against the same rules applied one
// cell at a time, on random small tilemaps: painted, flipped, resized, trimmed, with hidden
// cells and short data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeTiles, mergeTilemap, tileRuns } from "../src/engine/tiles.ts";

type T = { width: number; height: number; "max-width": number; "max-height": number; data: string };
const cellsOf = (t: T) => {
  const c = tileRuns(t.data)!.flatMap((r) => Array<string>(r.count).fill(r.tile));
  return (x: number, y: number) => (x < t["max-width"] && y < t["max-height"] ? c[x * t["max-height"] + y] ?? "0" : undefined);
};

// The rules, one cell at a time.
function reference(b: T, o: T, t: T) {
  const pick = (x: number, y: number, z: number) => (y === z || x === z ? y : x === y ? z : null);
  const width = pick(b.width, o.width, t.width), height = pick(b.height, o.height, t.height);
  if (width === null || height === null) return { conflict: "resized" };
  const keep = (x: number, y: number, z: number) => pick(x, y, z) ?? Math.max(y, z);
  const mw = Math.max(width, keep(b["max-width"], o["max-width"], t["max-width"]));
  const mh = Math.max(height, keep(b["max-height"], o["max-height"], t["max-height"]));
  const [cb, co, ct] = [b, o, t].map(cellsOf);
  const shows = (g: T, x: number, y: number) => x < g.width && y < g.height;
  const outO: string[] = [], outT: string[] = [];
  let clashes = 0, lost = 0;
  for (let x = 0; x < Math.max(mw, o.width, t.width); x++) for (let y = 0; y < Math.max(mh, o.height, t.height); y++) {
    const vb = cb(x, y) ?? "0", vo = co(x, y) ?? vb, vt = ct(x, y) ?? vb;
    const visible = x < width && y < height;
    let mo = vo, mt = vo;
    if (vo === vt || vb === vt) mo = mt = vo;
    else if (vb === vo) mo = mt = vt;
    else if (visible) { mt = vt; clashes++; }
    if (!visible && ((vo !== vb && shows(o, x, y)) || (vt !== vb && shows(t, x, y)))) lost++;
    if (x < mw && y < mh) { outO.push(mo); outT.push(mt); }
  }
  if (lost) return { conflict: "lost" };
  const v = (cells: string[]) => ({ width, height, "max-width": mw, "max-height": mh, data: encodeTiles(cells) });
  return clashes ? { ours: v(outO), theirs: v(outT), clashes } : { merged: v(outO) };
}

// mergeTilemap's result without where the first clashes are (the reference doesn't say).
const outcome = (r: any) => ("first" in r ? { ours: r.ours, theirs: r.theirs, clashes: r.clashes } : r);

// Small deterministic PRNG so a failure can be replayed.
function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000); }

test("tile merge on runs = the same rules cell by cell (20,000 random tilemaps)", () => {
  const r = rng(42), int = (n: number) => Math.floor(r() * n);
  // Few kinds of tile and small grids: long runs that cross column and resize boundaries.
  const tiles = ["0", "0", "1", "2", "3hv"];
  const make = (w: number, h: number, mw: number, mh: number, fill: (x: number, y: number) => string, short = false): T => {
    const cells: string[] = [];
    for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) cells.push(fill(x, y));
    return { width: w, height: h, "max-width": mw, "max-height": mh, data: encodeTiles(short ? cells.slice(0, int(cells.length)) : cells) };
  };
  // A side, as the editor does it: maybe trim (r495+ on load), maybe resize (growing appends
  // columns / rows past the stored grid, as r449-5 does; shrinking keeps them), then paint a
  // few cells anywhere it stores (brushes reach hidden cells). Resizes come from a small set
  // so both sides often make the same one.
  const edit = (b: T): T => {
    const at = cellsOf(b);
    let { width: w, height: h, "max-width": mw, "max-height": mh } = b;
    if (r() < 0.2) { mw = w; mh = h; }
    if (r() < 0.4) { const nw = Math.max(1, w + int(4) - 1); if (nw > w) mw += nw - w; w = nw; }
    if (r() < 0.4) { const nh = Math.max(1, h + int(4) - 1); if (nh > h) mh += nh - h; h = nh; }
    const painted = new Map<string, string>();
    for (let k = int(5); k > 0; k--) painted.set(`${int(mw)},${int(mh)}`, tiles[int(tiles.length)]);
    const kept = (x: number, y: number) => x < Math.min(mw, b["max-width"]) && y < Math.min(mh, b["max-height"]);
    return make(w, h, mw, mh, (x, y) => painted.get(`${x},${y}`) ?? (kept(x, y) ? at(x, y) ?? "0" : "0"));
  };
  let checked = 0;
  for (let i = 0; i < 20000; i++) {
    const w = 1 + int(4), h = 1 + int(4);
    const b = make(w, h, w + int(3), h + int(3), () => tiles[int(tiles.length)], r() < 0.1);
    const o = edit(b), t = edit(b);
    if (JSON.stringify(o) === JSON.stringify(t) || JSON.stringify(o) === JSON.stringify(b) || JSON.stringify(t) === JSON.stringify(b)) continue;
    const got = mergeTilemap(b, o, t) as any, want = reference(b, o, t) as any;
    const label = `case ${i}: ${JSON.stringify({ b, o, t })}`;
    if ("conflict" in want) assert.ok("conflict" in got, `${label}\nwant a conflict (${want.conflict}), got ${JSON.stringify(got)}`);
    else if ("merged" in want) assert.deepEqual(got.merged, want.merged, label);
    else { assert.deepEqual([got.ours, got.theirs, got.clashes], [want.ours, want.theirs, want.clashes], label); }
    checked++;
  }
  assert.ok(checked > 10000, `only ${checked} cases changed on both sides`);
});

// Stretches the random cases rarely produce: each needs its cut or the merge goes wrong.
test("tile merge: stretches end where a side's stored column or visible area ends", () => {
  const col = (w: number, h: number, mw: number, mh: number, cells: string[]): T => ({ width: w, height: h, "max-width": mw, "max-height": mh, data: encodeTiles(cells) });
  // Base's run "1" crosses from its column 0 into column 1, right above a row both sides
  // added (r449-5 growth) and painted differently: (0, 2) is a clash, not theirs' tile.
  const b = col(2, 1, 2, 2, ["0", "1", "1", "0"]);
  const o = col(2, 3, 2, 4, ["0", "1", "1", "0", "1", "0", "0", "0"]);
  const t = col(2, 3, 2, 4, ["0", "2", "2", "0", "1", "0", "0", "0"]);
  assert.deepEqual(outcome(mergeTilemap(b, o, t)), reference(b, o, t));
  assert.equal((mergeTilemap(b, o, t) as any).clashes, 1);
  // Both sides paint across the edge of what shows: only the visible cell is a clash.
  const b2 = col(1, 1, 1, 2, ["0", "0"]), o2 = col(1, 1, 1, 2, ["1", "1"]), t2 = col(1, 1, 1, 2, ["2", "2"]);
  assert.deepEqual(outcome(mergeTilemap(b2, o2, t2)), reference(b2, o2, t2));
  assert.equal((mergeTilemap(b2, o2, t2) as any).clashes, 1);
});

// The leak r495+ fixes: a 69×60 tilemap storing 10,411×3,077 cells (a real project's). Merged
// on runs: fast, and nothing expanded.
test("tile merge on a huge stored grid", () => {
  const mw = 10411, mh = 3077, base = { width: 69, height: 60, "max-width": mw, "max-height": mh, data: `${mw * mh}x0` };
  const paint = (x: number, y: number, tile: string) => ({ ...base, data: `${x * mh + y}x0,${tile},${mw * mh - x * mh - y - 1}x0` });
  const t0 = performance.now();
  const r = mergeTilemap(base, paint(3, 4, "5"), paint(60, 50, "6hv")) as any;
  assert.ok(performance.now() - t0 < 2000);
  assert.equal(r.merged.data, `${3 * mh + 4}x0,5,${60 * mh + 50 - 3 * mh - 4 - 1}x0,6hv,${mw * mh - 60 * mh - 50 - 1}x0`);
});
