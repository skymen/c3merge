// The merge engine against the hand-made cases (test/cases.ts) and basic properties.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ABSENT, Conflict, mergeFile, Run } from "../src/engine/merge.ts";
import { detectStyle, render, resolveBranches, takeSide } from "../src/engine/render.ts";
import { CASES, read, type Edit } from "./cases.ts";

const c3 = (v: unknown) => JSON.stringify(v, null, "\t");
const edited = (base: any, e: Edit) => { const v = structuredClone(base); e(v); return v; };

for (const c of CASES) {
  test(c.name, () => {
    let base: any = JSON.parse(read(c.file));
    if (c.base) c.base(base);
    const baseText = c.base === null ? null : c3(base);
    const r = mergeFile(c.file, baseText, c3(edited(base, c.ours)), c3(edited(base, c.theirs)), c.context);
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

// A hunk at the end with one side empty: the commas before it depend on the side taken, even
// when what comes before is another hunk (with other labels).
test("trailing one-sided hunks: either side of every hunk parses", () => {
  const style = detectStyle("{\n\t\"a\": 1\n}");
  const renamed: [string, string] = ["as merged", "renamed (check)"];
  const cases: [unknown, unknown, unknown][] = [
    [{ list: [1, new Run([2], [3], renamed), new Run([4], [])] }, { list: [1, 2, 4] }, { list: [1, 3] }],
    [{ list: [new Run([2], [3], renamed), new Run([4], [])] }, { list: [2, 4] }, { list: [3] }],
    [{ list: [1, new Run([], [3], renamed), new Run([4], [])] }, { list: [1, 4] }, { list: [1, 3] }],
    [{ a: new Conflict(1, 2, renamed), b: new Conflict(3, ABSENT) }, { a: 1, b: 3 }, { a: 2 }],
  ];
  for (const [v, ours, theirs] of cases) {
    const text = render(v, style);
    assert.deepEqual(JSON.parse(takeSide(text, "ours")), ours, text);
    assert.deepEqual(JSON.parse(takeSide(text, "theirs")), theirs, text);
  }
});

test("resolve: one side at every ours/theirs hunk, other hunks kept for a person", () => {
  const text = ["{", '\t"a": [', "<<<<<<< ours", "\t\t1,", "=======", "\t\t2,", ">>>>>>> theirs", "\t\t3", "\t],",
    "<<<<<<< as merged", '\t"b": "X.hp"', "=======", '\t"b": "Y.hp"', ">>>>>>> renamed (check)", "}"].join("\r\n") + "\r\n";
  const r = resolveBranches(text, "theirs");
  assert.equal(r.resolved, 1);
  assert.deepEqual(r.left, ["as merged / renamed (check)"]);
  assert.equal(r.text, ["{", '\t"a": [', "\t\t2,", "\t\t3", "\t],", "<<<<<<< as merged", '\t"b": "X.hp"', "=======", '\t"b": "Y.hp"', ">>>>>>> renamed (check)", "}"].join("\r\n") + "\r\n", "CRLF and the final newline kept");
  // git's diff3 style: the base section goes.
  const diff3 = ["[", "<<<<<<< ours", "1", "||||||| base", "0", "=======", "2", ">>>>>>> theirs", "]"].join("\n");
  assert.deepEqual(JSON.parse(resolveBranches(diff3, "ours").text), [1]);
  assert.deepEqual(JSON.parse(resolveBranches(diff3, "theirs").text), [2]);
  // A labelled hunk inside an ours/theirs one: kept only on the side taken.
  const nested = ["[", "<<<<<<< ours", "<<<<<<< keep both, then rename one in C3", "1", "=======", ">>>>>>> drop this one", "=======", "2", ">>>>>>> theirs", "]"].join("\n");
  assert.deepEqual(resolveBranches(nested, "theirs"), { text: "[\n2\n]", resolved: 1, left: [] });
  assert.equal(resolveBranches(nested, "ours").left.length, 1);
});
