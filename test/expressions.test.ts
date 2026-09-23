// expressions.ts: the tokenizer must read expressions back exactly, and renames must only
// touch what they're sure about; anything else is `uncertain` and left unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { print, renameExpression, tokenize, type RenameSet } from "../src/engine/expressions.ts";

test("tokenizer: reads back exactly, and knows strings, numbers and names", () => {
  const cases: [string, string[]][] = [
    ['Sprite.X + 1.5', ["name:Sprite", "op:.", "name:X", "space: ", "op:+", "space: ", "number:1.5"]],
    ['"say ""hi"" to Sprite.X" & a', ['string:"say ""hi"" to Sprite.X"', "space: ", "op:&", "space: ", "name:a"]],
    ["3DShape.Width", ["name:3DShape", "op:.", "name:Width"]],
    ["a<>b <= .5", ["name:a", "op:<>", "name:b", "space: ", "op:<=", "space: ", "number:.5"]],
    ["Sprite(0).X", ["name:Sprite", "op:(", "number:0", "op:)", "op:.", "name:X"]],
    ["x ? -1 : y%2^3", ["name:x", "space: ", "op:?", "space: ", "op:-", "number:1", "space: ", "op::", "space: ", "name:y", "op:%", "number:2", "op:^", "number:3"]],
  ];
  for (const [expr, expected] of cases) {
    const t = tokenize(expr)!;
    assert.deepEqual(t.map((x) => `${x.kind}:${x.text}`), expected, expr);
    assert.equal(print(t), expr);
  }
});

test("tokenizer: refuses what isn't a C3 expression", () => {
  for (const expr of ['"unclosed', "a[0]", "{x}", "a; b", "a ! b", "it's"]) assert.equal(tokenize(expr), null, expr);
});

const owner = (...names: string[]) => new Set(names);
// Sprite: variable myVar → speed, behavior Bullet → Mover; Family1 (members Sprite): fv → fvar;
// object type Enemy → Foe.
const SET: RenameSet = {
  types: { Enemy: "Foe" },
  members: [
    { kind: "var", old: "myVar", new: "speed", owner: owner("Sprite"), selfClasses: owner("Sprite") },
    { kind: "behavior", old: "Bullet", new: "Mover", owner: owner("Sprite"), selfClasses: owner("Sprite") },
    { kind: "var", old: "fv", new: "fvar", owner: owner("Family1", "Sprite"), selfClasses: owner("Family1", "Sprite") },
  ],
};
const renamed = (expr: string, objectClass?: string) => renameExpression(expr, objectClass, SET);

test("renames: what is sure", () => {
  const cases: [string, string | undefined, string][] = [
    ["Sprite.myVar + 1", undefined, "Sprite.speed + 1"],
    ["Self.myVar * 2", "Sprite", "Self.speed * 2"],
    ["Sprite(0).myVar", undefined, "Sprite(0).speed"],
    ["Sprite(Sprite.Count - 1).myVar", undefined, "Sprite(Sprite.Count - 1).speed"],
    ["Sprite.Bullet.Speed", undefined, "Sprite.Mover.Speed"],
    ["Self.Bullet.Speed", "Sprite", "Self.Mover.Speed"],
    ["Family1.fv + Sprite.fv", undefined, "Family1.fvar + Sprite.fvar"],
    ["Enemy.X + Enemy(1).Y", undefined, "Foe.X + Foe(1).Y"],
    ['max(Sprite.myVar, 3) & "Sprite.myVar"', undefined, 'max(Sprite.speed, 3) & "Sprite.myVar"'],
    ["Sprite . myVar", undefined, "Sprite . speed"],
  ];
  for (const [expr, cls, expected] of cases) {
    const r = renamed(expr, cls);
    assert.deepEqual([r.text, r.uncertain], [expected, null], expr);
  }
});

test("renames: what must stay as is", () => {
  const cases: [string, string | undefined][] = [
    ["Other.myVar", undefined],          // another object's variable with the same name
    ["Self.myVar", "Other"],             // Self is another object here
    ["myVar + 1", undefined],            // a bare name: an event variable, not the instance variable
    ["Sprite.myVarToo", undefined],      // longer name
    ["Sprite.Bullet", undefined],        // a variable named like the behavior? no: Bullet isn't myVar; and a behavior needs a dot after it
    ['"Enemy.X"', undefined],            // inside a string
    ["Family1.myVar", undefined],        // myVar is Sprite's own variable, not the family's
  ];
  for (const [expr, cls] of cases) {
    const r = renamed(expr, cls);
    assert.deepEqual([r.text, r.changed, r.uncertain], [expr, false, null], expr);
  }
});

test("renames: unsure → unchanged and uncertain", () => {
  const cases: [string, string | undefined][] = [
    ["Self.myVar", undefined],           // no object to know what Self is
    ["Sprite.myvar", undefined],         // differs only by case
    ["enemy.X", undefined],              // object differs only by case
    ["Sprite.myVar(1)", undefined],      // a variable can't take parameters
    ["Enemy + 1", undefined],            // an object's name on its own
    ["Sprite(0.myVar", undefined],       // unbalanced parentheses
    ['Sprite.myVar & "open', undefined], // unclosed string
    ["Sprite.myVar[0]", undefined],      // not C3 syntax
  ];
  for (const [expr, cls] of cases) {
    const r = renamed(expr, cls);
    assert.equal(r.text, expr, expr);
    assert.equal(r.changed, false, expr);
    assert.ok(r.uncertain, `${expr} should be uncertain`);
  }
});
