import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkProject, invariants } from "../src/check/index.ts";
import { encodeTiles, tileRuns } from "../src/engine/tiles.ts";
import { corruptions } from "../lab/corruptions.ts";

const BASE = path.resolve(import.meta.dirname, "../fixtures/lab-base");

test("the untouched lab base has no errors or warnings", async () => {
  const r = await checkProject(BASE);
  assert.deepEqual(r.findings.filter((f) => f.severity === "error" || f.severity === "warning"), []);
});

// Every lab corruption that an invariant covers must be caught by that invariant.
// Rows no static check can see: 11 (needs each addon's action list), 18/20/26/27 (C3
// repairs or they're about the editor, not the project).
const covered = new Map(invariants.flatMap((inv) => inv.labRows.map((row) => [row, inv.id] as const)));
for (const c of corruptions) {
  const inv = covered.get(c.row);
  test(`lab row ${c.row} (${c.title}) → ${inv ?? "not statically checkable"}`, { skip: !inv }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "c3merge-test-"));
    try {
      await cp(BASE, dir, { recursive: true });
      await c.apply(dir);
      const r = await checkProject(dir, { all: true });
      const hits = r.findings.filter((f) => f.invariant === inv);
      assert.ok(hits.length > 0, `expected ${inv}; got ${r.findings.map((f) => f.invariant).join(", ") || "nothing"}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("tile runs: counts, flip flags, malformed runs, written back as C3 writes them", () => {
  const cells = (d: string) => tileRuns(d)!.flatMap((r) => Array<string>(r.count).fill(r.tile));
  assert.equal(cells("67x0,13,3x23").length, 71);
  assert.deepEqual(cells("2x1hv,11vd,5"), ["1hv", "1hv", "11vd", "5"]);
  assert.deepEqual(cells("1vh"), ["1hv"]);
  assert.equal(tileRuns("3x23,2x"), null);
  assert.equal(tileRuns("3x23,x5"), null);
  for (const d of ["67x0,13,3x23", "2x1hv,11vd,5,5x0", ""]) assert.equal(encodeTiles(cells(d)), d);
});

// Hidden cells (max-width × max-height past width × height) and flipped tiles are what real
// projects hold (83% and 28% of 3,070 tilemaps in 6 projects): not findings.
test("tilemaps with hidden cells and flipped tiles are fine", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "c3merge-test-"));
  try {
    await cp(BASE, dir, { recursive: true });
    await corruptions.find((c) => c.row === "29c")!.apply(dir);
    const r = await checkProject(dir, { all: true });
    assert.deepEqual(r.findings.filter((f) => f.invariant.startsWith("tilemap")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Real projects that C3 opens must not get errors or warnings. Uses c3cli's local fixture
// copies when they exist (not in the repo: they're skymen's projects).
const CORPUS = path.resolve(import.meta.dirname, "../../c3cli/fixtures/folder");
const hasCorpus = await stat(CORPUS).then(() => true, () => false);
test("no false positives on the real-project corpus", { skip: !hasCorpus && "no corpus at ../c3cli/fixtures/folder" }, async () => {
  const noisy: string[] = [];
  for (const d of await readdir(CORPUS)) {
    const r = await checkProject(path.join(CORPUS, d));
    for (const f of r.findings.filter((f) => f.severity === "error" || f.severity === "warning")) noisy.push(`${d}: ${f.file}: ${f.message}`);
  }
  assert.deepEqual(noisy, []);
});
