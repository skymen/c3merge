// The merge engine against the hand-made cases (test/cases.ts) and basic properties.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFile } from "../src/engine/merge.ts";
import { takeSide } from "../src/engine/render.ts";
import { CASES, read, type Edit } from "./cases.ts";

const c3 = (v: unknown) => JSON.stringify(v, null, "\t");
const edited = (base: any, e: Edit) => { const v = structuredClone(base); e(v); return v; };

for (const c of CASES) {
  test(c.name, () => {
    let base: any = JSON.parse(read(c.file));
    if (c.base) c.base(base);
    const baseText = c.base === null ? null : c3(base);
    const r = mergeFile(c.file, baseText, c3(edited(base, c.ours)), c3(edited(base, c.theirs)));
    assert.deepEqual(r.warnings.map((w) => w.path), c.warnings ?? [], "warnings");
    if (c.merged) {
      assert.deepEqual(r.conflicts, [], "no conflicts");
      assert.equal(r.text, c3(edited(base, c.merged)), "merged file, byte for byte");
    } else {
      assert.deepEqual(r.conflicts.map((x) => x.path), c.conflicts, "conflict paths");
      assert.deepEqual(JSON.parse(takeSide(r.text, "ours")), edited(base, c.takeOurs!), "taking ours gives valid JSON");
      assert.deepEqual(JSON.parse(takeSide(r.text, "theirs")), edited(base, c.takeTheirs!), "taking theirs gives valid JSON");
    }
  });
}

test("a change on one side only gives that side's exact bytes", () => {
  for (const c of CASES) {
    if (c.base !== undefined) continue;
    const base = read(c.file);
    const ours = c3(edited(JSON.parse(base), c.ours));
    assert.equal(mergeFile(c.file, base, ours, base).text, ours, c.name);
    assert.equal(mergeFile(c.file, base, base, ours).text, ours, c.name);
  }
});
