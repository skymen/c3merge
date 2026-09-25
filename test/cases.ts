// Hand-made merge cases, one per engine rule, built on the real lab-base files. Each case
// edits a copy of a base file for ours and for theirs, then says what the merge must give:
// - `merged`: a clean merge; the expected file is base with that edit, byte for byte in C3's
//   format;
// - `warnings`: order the engine couldn't be sure of (the merge is still clean);
// - `conflicts`: the conflict paths the engine must report, plus `takeOurs` / `takeTheirs`,
//   the file you get by resolving every marker hunk to that side (must be valid JSON equal
//   to base with that edit).
// Rule (DESIGN.md "Engine"): only merge what is certainly right, anything else is a conflict.
import { readFileSync } from "node:fs";
import path from "node:path";
import { eventTable, type ProjectContext, type Table } from "../src/context.ts";

export type Edit = (v: any) => void;
export interface Case {
  name: string;
  file: string; // lab-base file, also the repo path (%P) that picks the profile
  base?: Edit | null; // edit the base first (null: file absent in base, added on both sides)
  ours: Edit;
  theirs: Edit;
  merged?: Edit;
  conflicts?: string[];
  warnings?: string[]; // ambiguous order: merged anyway, reported (paths of the lists)
  takeOurs?: Edit;
  takeTheirs?: Edit;
  context?: ProjectContext; // what changed across the project on each side (renames, gains)
}

const LAB = path.join(import.meta.dirname, "..", "fixtures", "lab-base");
export const read = (file: string) => readFileSync(path.join(LAB, file), "utf8");

const L1 = "layouts/Layout 1.json";
const L2 = "layouts/Layout 2.json";
const ES1 = "eventSheets/Event sheet 1.json";
const PROJ = "project.c3proj";
const SPRITE = "objectTypes/Sprite.json";
const FAM = "families/Family1.json";

const both = (...edits: Edit[]): Edit => (v) => { for (const e of edits) e(v); };
const clone = <T>(v: T): T => structuredClone(v);
// Insert key k after key `after` (null: first), keeping the rest of the order.
export function insertKey(obj: any, after: string | null, k: string, value: unknown) {
  const entries = Object.entries(obj).filter(([key]) => key !== k);
  const i = after === null ? 0 : entries.findIndex(([key]) => key === after) + 1;
  entries.splice(i, 0, [k, value]);
  for (const key of Object.keys(obj)) delete obj[key];
  Object.assign(obj, Object.fromEntries(entries));
}

// Layout 1 has one layer ("Layer 0") with instances Sprite#2, TiledBackground#3, Sprite#7.
const layer0 = (v: any) => v.layers[0];
const LAYER0 = (v: any) => `layers[sid=${layer0(v).sid}]`;
const inst = (v: any, uid: number) => layer0(v).instances.find((i: any) => i.uid === uid);
const newInst = (v: any, uid: number, x: number) => {
  const i = clone(inst(v, 2));
  i.uid = uid; i.sid = 100000000000000 + uid; i.instanceFolderItem && (i.instanceFolderItem.sid = i.sid);
  i.world.x = x;
  return i;
};
const addInst = (uid: number, at: number | "end", x = 10): Edit => (v) => {
  const list = layer0(v).instances;
  list.splice(at === "end" ? list.length : at, 0, newInst(v, uid, x));
};
const delInst = (uid: number): Edit => (v) => { layer0(v).instances = layer0(v).instances.filter((i: any) => i.uid !== uid); };
const moveInst = (uid: number, to: number): Edit => (v) => {
  const list = layer0(v).instances; const i = list.findIndex((x: any) => x.uid === uid);
  list.splice(to, 0, list.splice(i, 1)[0]);
};
const layerPath = (base: string) => { const v = JSON.parse(read(base)); return LAYER0(v); };
// A second (and third) empty layer, for moves between layers.
const addLayer = (name: string, sid: number): Edit => (v) => {
  const l = clone(layer0(v)); Object.assign(l, { name, sid, instances: [] }); v.layers.push(l);
};
const layer = (v: any, sid: number) => v.layers.find((l: any) => l.sid === sid);
const moveToLayer = (uid: number, sid: number): Edit => (v) => {
  const i = inst(v, uid); delInst(uid)(v); layer(v, sid).instances.push(i);
};
// Object types and families as the project context sees them (context.ts), per version.
interface T { sid: number; name: string; plugin?: string; family?: string[]; vars?: [number, string][]; behaviors?: [number, string][] }
const table = (...ts: T[]): Table => Object.fromEntries(ts.map((t) => [t.sid, {
  kind: t.family ? "family" : "objectType", name: t.name, plugin: t.plugin ?? (t.family ? "" : "Sprite"), members: t.family ?? [], effects: [],
  vars: (t.vars ?? []).map(([sid, name]) => ({ sid, name })), behaviors: (t.behaviors ?? []).map(([sid, name]) => ({ sid, name })),
}]));
const ctx = (base: T[], ours: T[], theirs: T[]): ProjectContext => ({ base: table(...base), ours: table(...ours), theirs: table(...theirs) });
const SPRITE_T: T = { sid: 1, name: "Sprite", vars: [[11, "myVar"], [12, "myVarToo"], [13, "myBool"]], behaviors: [[21, "Bullet"]] };
const TB_T: T = { sid: 2, name: "TiledBackground" };
const FAM_T: T = { sid: 3, name: "Family1", family: ["Sprite"], vars: [[31, "fv"]] };
const with_ = (t: T, change: Partial<T>): T => ({ ...t, ...change });
const SPRITE_RENAMED_VAR = with_(SPRITE_T, { vars: [[11, "speed"], [12, "myVarToo"], [13, "myBool"]] });
const SPRITE_RENAMED_BEH = with_(SPRITE_T, { behaviors: [[21, "Mover"]] });
// What C3 does on the renaming side: every Sprite instance's key.
const renameVarOnInstances = (v: any) => {
  for (const l of v.layers) for (const i of l.instances) if (i.type === "Sprite") {
    i.instanceVariables = Object.fromEntries(Object.entries(i.instanceVariables).map(([k, x]) => [k === "myVar" ? "speed" : k, x]));
  }
};
const addAction = (a: object): Edit => (v) => { block(v).actions.push(a); };
const touchSheet: Edit = (v) => { block(v).actions[0].parameters.shape = "prism"; }; // so both sides changed the file
// Event contexts: each version's event sheets (Event sheet 1 and 2), edited.
const ES2 = "eventSheets/Event sheet 2.json";
const sheet = (file: string, edit: Edit = () => {}) => { const v = JSON.parse(read(file)); edit(v); return v; };
const evCtx = (base: [Edit?, Edit?], ours: [Edit?, Edit?], theirs: [Edit?, Edit?]): ProjectContext => ({
  base: {}, ours: {}, theirs: {},
  events: Object.fromEntries(([["base", base], ["ours", ours], ["theirs", theirs]] as const).map(([k, [e1, e2]]) => [k, eventTable([sheet(ES1, e1), sheet(ES2, e2)])])) as any,
});
const group1 = (v: any) => v.events.find((e: any) => e.eventType === "group");
const fn1 = (v: any) => v.events.find((e: any) => e.functionName);
const EMPTY_COMMENT = { eventType: "comment", text: "" };
// Event sheet 2 with an empty comment after the include and another after the block.
const twoEmptyComments: Edit = (v) => { v.events.splice(3, 0, clone(EMPTY_COMMENT)); v.events.splice(1, 0, clone(EMPTY_COMMENT)); };
const renameGlobal: Edit = (v) => { v.events[0].name = "Speed"; };             // Event sheet 1: Variable1 → Speed
const renameLocal: Edit = (v) => { group1(v).children[0].name = "Count"; };    // Event sheet 2: Variable3 → Count
const renameFn: Edit = (v) => { fn1(v).functionName = "doThing"; };           // Event sheet 2: Function1 → doThing
const renameParam: Edit = (v) => { fn1(v).functionParameters[0].name = "amount"; };
const addParam: Edit = (v) => { fn1(v).functionParameters.push({ name: "speed", type: "number", initialValue: "5", comment: "", sid: 777 }); };
const dropParam: Edit = (v) => { fn1(v).functionParameters = []; };
const call1 = (v: any) => block(v).actions[1]; // Event sheet 1: callFunction Function1 ["67"]
const blockWith = (sid: number, actions: object[]) => ({ eventType: "block", conditions: [], actions, sid });
const renameSprite = (v: any) => { for (const l of v.layers) for (const i of l.instances) if (i.type === "Sprite") i.type = "Hero"; };
const L1_LAYER = layerPath(L1);

// Event sheet 1: variable, variable, block (on start of layout; 3 actions).
const newEvent = (sid: number) => ({
  eventType: "block",
  conditions: [{ id: "every-tick", objectClass: "System", sid: sid + 1 }],
  actions: [{ id: "set-shape", objectClass: "3DShape", sid: sid + 2, parameters: { shape: "box" } }],
  sid,
});
const addEvent = (sid: number, at: number | "end"): Edit => (v) => { v.events.splice(at === "end" ? v.events.length : at, 0, newEvent(sid)); };
const block = (v: any) => v.events[2];
const BLOCK = `events[sid=928488326739039]`;

const scriptAction = (script: string[]) => ({ type: "script", script, sid: 555 });
const ivar = (name: string, sid: number) => ({ name, type: "number", initialValue: 0, desc: "", show: true, sid });
// An action using an object in each way C3 references one.
const usesSprite = (name: string) => ({
  id: "set-x", objectClass: name, sid: 777,
  parameters: { x: `${name}.X + 1`, text: '"Sprite.X"', object: name, "instance-variable": "Sprite" },
});
const addon = (id: string, version = "1.0.0.0") => ({ type: "plugin", id, name: id, author: "someone", bundled: true, version });

export const CASES: Case[] = [
  // ── objects and scalars ─────────────────────────────────────────────────────────────
  {
    name: "different keys changed on each side",
    file: L1, ours: (v) => { v.width = 1000; }, theirs: (v) => { v.height = 900; },
    merged: (v) => { v.width = 1000; v.height = 900; },
  },
  {
    name: "same change on both sides",
    file: L1, ours: (v) => { layer0(v).parallaxX = 50; }, theirs: (v) => { layer0(v).parallaxX = 50; },
    merged: (v) => { layer0(v).parallaxX = 50; },
  },
  {
    name: "same scalar changed differently",
    file: L1, ours: (v) => { layer0(v).parallaxX = 50; }, theirs: (v) => { layer0(v).parallaxX = 80; },
    conflicts: [`${L1_LAYER}.parallaxX`],
    takeOurs: (v) => { layer0(v).parallaxX = 50; }, takeTheirs: (v) => { layer0(v).parallaxX = 80; },
  },
  {
    name: "key added on one side keeps its position",
    file: L1, ours: (v) => { v.width = 1000; }, theirs: (v) => { insertKey(v, "sid", "newKey", 1); },
    merged: (v) => { v.width = 1000; insertKey(v, "sid", "newKey", 1); },
  },
  {
    name: "key added on both sides with different values",
    file: L1, ours: (v) => { insertKey(v, "sid", "newKey", 1); }, theirs: (v) => { insertKey(v, "sid", "newKey", 2); },
    conflicts: ["newKey"],
    takeOurs: (v) => { insertKey(v, "sid", "newKey", 1); }, takeTheirs: (v) => { insertKey(v, "sid", "newKey", 2); },
  },
  {
    name: "key deleted on one side, untouched on the other",
    file: L1, ours: (v) => { delete v.vpX; }, theirs: (v) => { v.width = 1000; },
    merged: (v) => { delete v.vpX; v.width = 1000; },
  },
  {
    name: "key deleted on one side, changed on the other",
    file: L1, ours: (v) => { delete v.vpX; }, theirs: (v) => { v.vpX = 0.25; },
    conflicts: ["vpX"],
    takeOurs: (v) => { delete v.vpX; }, takeTheirs: (v) => { v.vpX = 0.25; },
  },
  {
    name: "last key deleted on one side, changed on the other (comma handling)",
    file: L1, ours: (v) => { delete v.eventSheet; }, theirs: (v) => { v.eventSheet = "Event sheet 2"; },
    conflicts: ["eventSheet"],
    takeOurs: (v) => { delete v.eventSheet; }, takeTheirs: (v) => { v.eventSheet = "Event sheet 2"; },
  },
  {
    name: "a list without identity (color) changed on both sides is one value",
    file: L1, ours: (v) => { inst(v, 2).world.color = [1, 0, 0, 1]; }, theirs: (v) => { inst(v, 2).world.color = [1, 1, 1, 0.5]; },
    conflicts: [`${L1_LAYER}.instances[uid=2].world.color`],
    takeOurs: (v) => { inst(v, 2).world.color = [1, 0, 0, 1]; }, takeTheirs: (v) => { inst(v, 2).world.color = [1, 1, 1, 0.5]; },
  },

  // ── keyed, ordered lists: layout instances ──────────────────────────────────────────
  {
    name: "same instance, different fields",
    file: L1, ours: (v) => { inst(v, 2).world.x = 1; }, theirs: (v) => { inst(v, 2).world.y = 2; },
    merged: (v) => { inst(v, 2).world.x = 1; inst(v, 2).world.y = 2; },
  },
  {
    name: "instances added at different spots",
    file: L1, ours: addInst(50, 1), theirs: addInst(60, "end"),
    merged: both(addInst(50, 1), addInst(60, "end")),
  },
  {
    name: "instances added at the same spot on both sides (z-order unknown)",
    file: L1, ours: addInst(50, "end", 11), theirs: addInst(60, "end", 12),
    merged: both(addInst(50, "end", 11), addInst(60, "end", 12)),
    warnings: [`${L1_LAYER}.instances`],
  },
  {
    name: "the same instance added on both sides, identical",
    file: L1, ours: addInst(50, "end"), theirs: addInst(50, "end"),
    merged: addInst(50, "end"),
  },
  {
    name: "instance deleted on one side, untouched on the other",
    file: L1, ours: delInst(3), theirs: (v) => { inst(v, 2).world.x = 1; },
    merged: both(delInst(3), (v) => { inst(v, 2).world.x = 1; }),
  },
  {
    name: "instance deleted on one side, edited on the other",
    file: L1, ours: delInst(3), theirs: (v) => { inst(v, 3).world.x = 1; },
    conflicts: [`${L1_LAYER}.instances[uid=3]`],
    takeOurs: delInst(3), takeTheirs: (v) => { inst(v, 3).world.x = 1; },
  },
  {
    name: "last instance deleted on one side, edited on the other (comma handling)",
    file: L1, ours: delInst(7), theirs: (v) => { inst(v, 7).world.x = 1; },
    conflicts: [`${L1_LAYER}.instances[uid=7]`],
    takeOurs: delInst(7), takeTheirs: (v) => { inst(v, 7).world.x = 1; },
  },
  {
    name: "instance deleted on both sides",
    file: L1, ours: delInst(3), theirs: delInst(3),
    merged: delInst(3),
  },
  {
    name: "moved on one side, edited on the other",
    file: L1, ours: moveInst(7, 0), theirs: (v) => { inst(v, 7).world.x = 1; },
    merged: both(moveInst(7, 0), (v) => { inst(v, 7).world.x = 1; }),
  },
  {
    name: "moved differently on both sides",
    file: L1, ours: moveInst(7, 0), theirs: moveInst(2, 2),
    merged: moveInst(7, 0),
    warnings: [`${L1_LAYER}.instances`],
  },

  // ── ids that change, moves between layers ────────────────────────────────────────────
  {
    // Real merge cad4249b: one side renumbered uids, the other gave new sids.
    name: "uid renumbered on one side, sid changed and edited on the other",
    file: L1,
    ours: (v) => { inst(v, 3).uid = 30; },
    theirs: (v) => { inst(v, 3).sid = 999; inst(v, 3).world.x = 5; },
    merged: (v) => { Object.assign(inst(v, 3), { uid: 30, sid: 999 }); inst(v, 30).world.x = 5; },
  },
  {
    name: "moved to another layer on one side, edited on the other",
    file: L1, base: addLayer("Layer 1", 111),
    ours: (v) => { inst(v, 7).world.x = 1; },
    theirs: moveToLayer(7, 111),
    merged: both((v) => { inst(v, 7).world.x = 1; }, moveToLayer(7, 111)),
  },
  {
    name: "moved to a different layer on each side",
    file: L1, base: both(addLayer("Layer 1", 111), addLayer("Layer 2", 222)),
    ours: moveToLayer(7, 111), theirs: moveToLayer(7, 222),
    conflicts: [`${L1_LAYER}.instances[Sprite#7]`],
    takeOurs: moveToLayer(7, 111), takeTheirs: moveToLayer(7, 222),
  },
  {
    name: "deleted on one side, moved to another layer on the other",
    file: L1, base: addLayer("Layer 1", 111),
    ours: delInst(7), theirs: moveToLayer(7, 111),
    conflicts: [`${L1_LAYER}.instances[Sprite#7]`],
    takeOurs: delInst(7), takeTheirs: moveToLayer(7, 111),
  },

  // ── changes made across the project (context) ───────────────────────────────────────
  {
    // Real merge 85c85d2a: theirs renamed TiledShapeDark, ours added instances of it.
    name: "object type renamed on one side, new instances of it on the other",
    file: L1, context: ctx([SPRITE_T], [SPRITE_T], [with_(SPRITE_T, { name: "Hero" })]),
    ours: addInst(50, "end"), theirs: renameSprite,
    merged: both(renameSprite, addInst(50, "end"), (v) => { inst(v, 50).type = "Hero"; }),
  },
  {
    name: "object type renamed on one side, new events using it on the other",
    file: ES1, context: ctx([SPRITE_T], [SPRITE_T], [with_(SPRITE_T, { name: "Hero" })]),
    ours: (v) => { block(v).actions.push(usesSprite("Sprite")); },
    theirs: (v) => { block(v).actions[2].objectClass = "Hero"; },
    merged: (v) => { block(v).actions[2].objectClass = "Hero"; block(v).actions.push(usesSprite("Hero")); },
  },
  {
    // Real merges: C3 fills in a variable the type gained on one side; the other side
    // deleted the instance. Only an automatic change: the deletion wins.
    name: "deleted on one side, only given its type's new variable on the other",
    file: L1, context: ctx([TB_T], [TB_T], [with_(TB_T, { vars: [[41, "hp"]] })]),
    ours: delInst(3), theirs: (v) => { inst(v, 3).instanceVariables = { hp: 0 }; },
    merged: delInst(3),
  },
  {
    // Real merge cad4249b: opening the project in a newer release gave every instance a
    // sid and tags on one side; the other side deleted some of them.
    name: "deleted on one side, only migrated by a newer release on the other",
    file: L1, base: (v) => { for (const i of layer0(v).instances) delete i.tags; },
    ours: delInst(3), theirs: (v) => { for (const i of layer0(v).instances) i.tags = ""; },
    merged: both(delInst(3), (v) => { for (const i of layer0(v).instances) i.tags = ""; }),
  },
  {
    name: "deleted on one side, new variable and a real edit on the other",
    file: L1, context: ctx([TB_T], [TB_T], [with_(TB_T, { vars: [[41, "hp"]] })]),
    ours: delInst(3), theirs: (v) => { inst(v, 3).instanceVariables = { hp: 0 }; inst(v, 3).world.x = 1; },
    conflicts: [`${L1_LAYER}.instances[uid=3]`],
    takeOurs: delInst(3), takeTheirs: (v) => { inst(v, 3).instanceVariables = { hp: 0 }; inst(v, 3).world.x = 1; },
  },

  // ── renamed variables and behaviors (context + expressions) ────────────────────────
  {
    name: "instance variable renamed on one side, its value edited on the other",
    file: L1, context: ctx([SPRITE_T], [SPRITE_RENAMED_VAR], [SPRITE_T]),
    ours: renameVarOnInstances, theirs: (v) => { inst(v, 2).instanceVariables.myVar = 42; },
    merged: both(renameVarOnInstances, (v) => { inst(v, 2).instanceVariables.speed = 42; }),
  },
  {
    name: "instance variable renamed on one side, a new instance with the old name on the other",
    file: L1, context: ctx([SPRITE_T], [SPRITE_RENAMED_VAR], [SPRITE_T]),
    ours: renameVarOnInstances, theirs: (v) => { addInst(50, "end")(v); inst(v, 50).instanceVariables.myVar = 7; },
    merged: both(addInst(50, "end"), (v) => { inst(v, 50).instanceVariables.myVar = 7; }, renameVarOnInstances),
  },
  {
    name: "instance variable renamed on one side, new events using it on the other",
    file: ES1, context: ctx([SPRITE_T], [SPRITE_RENAMED_VAR], [SPRITE_T]),
    ours: touchSheet,
    theirs: addAction({ id: "set-instvar-value", objectClass: "Sprite", sid: 901, parameters: { "instance-variable": "myVar", value: "Self.myVar + Sprite(0).myVar + Other.myVar", text: '"Sprite.myVar"' } }),
    merged: both(touchSheet, addAction({ id: "set-instvar-value", objectClass: "Sprite", sid: 901, parameters: { "instance-variable": "speed", value: "Self.speed + Sprite(0).speed + Other.myVar", text: '"Sprite.myVar"' } })),
  },
  {
    // `Self` in a function call: no object to say what it is. Left as is and flagged, with
    // the renamed version next to it.
    name: "instance variable renamed, an expression we can't be sure about on the other side",
    file: ES1, context: ctx([SPRITE_T], [SPRITE_RENAMED_VAR], [SPRITE_T]),
    ours: touchSheet, theirs: addAction({ callFunction: "doIt", sid: 902, parameters: ["Self.myVar"] }),
    conflicts: ["function doIt (sid 902) parameter 0"],
    takeOurs: both(touchSheet, addAction({ callFunction: "doIt", sid: 902, parameters: ["Self.myVar"] })),
    takeTheirs: both(touchSheet, addAction({ callFunction: "doIt", sid: 902, parameters: ["Self.speed"] })),
  },
  {
    name: "the other side made a new variable with the old name: left alone",
    file: ES1, context: ctx([SPRITE_T], [SPRITE_RENAMED_VAR], [with_(SPRITE_T, { vars: [[99, "myVar"], [12, "myVarToo"], [13, "myBool"]] })]),
    ours: touchSheet, theirs: addAction({ id: "x", objectClass: "Sprite", sid: 904, parameters: { value: "Sprite.myVar" } }),
    merged: both(touchSheet, addAction({ id: "x", objectClass: "Sprite", sid: 904, parameters: { value: "Sprite.myVar" } })),
  },
  {
    // C3 updates structured references (objectClass) but leaves expressions: they still resolve.
    name: "a rename that only changes case: structured references follow, expressions stay",
    file: ES1, context: ctx([SPRITE_T], [with_(SPRITE_T, { name: "sprite" })], [SPRITE_T]),
    ours: both(touchSheet, (v) => { block(v).actions[2].objectClass = "sprite"; }), // what C3 does on the renaming side
    theirs: addAction({ id: "x", objectClass: "Sprite", sid: 907, parameters: { value: "Sprite.X" } }),
    merged: both(touchSheet, (v) => { block(v).actions[2].objectClass = "sprite"; }, addAction({ id: "x", objectClass: "sprite", sid: 907, parameters: { value: "Sprite.X" } })),
  },
  {
    // skymen: one side adds a local `foo` next to `bar`, the other renames `bar` to `foo`.
    name: "two variables end up with the same name in one scope",
    file: ES1,
    ours: (v) => { v.events[0].name = "foo"; },
    theirs: (v) => { v.events.splice(2, 0, { eventType: "variable", name: "Foo", type: "number", initialValue: "0", comment: "", isStatic: false, isConstant: false, sid: 908 }); },
    conflicts: ["events[variable Foo]"],
    takeOurs: (v) => { v.events[0].name = "foo"; v.events.splice(2, 0, { eventType: "variable", name: "Foo", type: "number", initialValue: "0", comment: "", isStatic: false, isConstant: false, sid: 908 }); },
    takeTheirs: (v) => { v.events[0].name = "foo"; },
  },
  {
    name: "behavior renamed on one side, its properties edited on the other",
    file: L1, base: (v) => { inst(v, 2).behaviors = { Bullet: { properties: { speed: 1 } } }; },
    context: ctx([SPRITE_T], [SPRITE_RENAMED_BEH], [SPRITE_T]),
    ours: (v) => { inst(v, 2).behaviors = { Mover: { properties: { speed: 1 } } }; },
    theirs: (v) => { inst(v, 2).behaviors.Bullet.properties.speed = 5; },
    merged: (v) => { inst(v, 2).behaviors = { Mover: { properties: { speed: 5 } } }; },
  },
  {
    name: "behavior renamed on one side, new events using it on the other",
    file: ES1, context: ctx([SPRITE_T], [SPRITE_RENAMED_BEH], [SPRITE_T]),
    ours: touchSheet,
    theirs: addAction({ id: "set-speed", objectClass: "Sprite", behaviorType: "Bullet", sid: 903, parameters: { speed: "Sprite.Bullet.Speed * 2" } }),
    merged: both(touchSheet, addAction({ id: "set-speed", objectClass: "Sprite", behaviorType: "Mover", sid: 903, parameters: { speed: "Sprite.Mover.Speed * 2" } })),
  },
  {
    name: "family variable renamed on one side, used through the family and a member on the other",
    file: ES1, context: ctx([SPRITE_T, FAM_T], [SPRITE_T, with_(FAM_T, { vars: [[31, "fvar"]] })], [SPRITE_T, FAM_T]),
    ours: touchSheet, theirs: addAction({ id: "x", objectClass: "Sprite", sid: 905, parameters: { value: "Sprite.fv + Family1.fv + Self.fv" } }),
    merged: both(touchSheet, addAction({ id: "x", objectClass: "Sprite", sid: 905, parameters: { value: "Sprite.fvar + Family1.fvar + Self.fvar" } })),
  },

  // ── event variables and functions (tasks/event-renames.md) ─────────────────────────
  {
    name: "global variable renamed in another sheet, used on the other side",
    file: ES1, context: evCtx([], [renameGlobal], []),
    ours: renameGlobal,
    theirs: addAction({ id: "set-eventvar-value", objectClass: "System", sid: 910, parameters: { variable: "Variable1", value: "Variable1 + 1" } }),
    merged: both(renameGlobal, addAction({ id: "set-eventvar-value", objectClass: "System", sid: 910, parameters: { variable: "Speed", value: "Speed + 1" } })),
  },
  {
    // A local's rename only reaches its scope; another group may have its own Variable3.
    name: "local variable renamed: only its scope follows",
    file: ES2, context: evCtx([], [undefined, renameLocal], [undefined, (v) => { v.events.push({ eventType: "group", title: "Group2", disabled: false, description: "", isActiveOnStart: true, sid: 920, children: [{ eventType: "variable", name: "Variable3", type: "number", initialValue: "0", comment: "", isStatic: false, isConstant: false, sid: 921 }] }); }]),
    ours: renameLocal,
    theirs: (v) => {
      group1(v).children.push(blockWith(911, [{ id: "set-eventvar-value", objectClass: "System", sid: 912, parameters: { variable: "Variable3", value: "Variable3 * 2" } }]));
      v.events.push({ eventType: "group", title: "Group2", disabled: false, description: "", isActiveOnStart: true, sid: 920, children: [
        { eventType: "variable", name: "Variable3", type: "number", initialValue: "0", comment: "", isStatic: false, isConstant: false, sid: 921 },
        blockWith(922, [{ id: "set-eventvar-value", objectClass: "System", sid: 923, parameters: { variable: "Variable3", value: "Variable3 + 1" } }]),
      ] });
    },
    merged: (v) => {
      renameLocal(v);
      group1(v).children.push(blockWith(911, [{ id: "set-eventvar-value", objectClass: "System", sid: 912, parameters: { variable: "Count", value: "Count * 2" } }]));
      v.events.push({ eventType: "group", title: "Group2", disabled: false, description: "", isActiveOnStart: true, sid: 920, children: [
        { eventType: "variable", name: "Variable3", type: "number", initialValue: "0", comment: "", isStatic: false, isConstant: false, sid: 921 },
        blockWith(922, [{ id: "set-eventvar-value", objectClass: "System", sid: 923, parameters: { variable: "Variable3", value: "Variable3 + 1" } }]),
      ] });
    },
  },
  {
    name: "function parameter renamed: its uses inside the function follow",
    file: ES2, context: evCtx([], [undefined, renameParam], []),
    ours: renameParam,
    theirs: (v) => { fn1(v).actions = [{ id: "set-eventvar-value", objectClass: "System", sid: 913, parameters: { variable: "Variable1", value: "test * 2" } }]; },
    merged: (v) => { renameParam(v); fn1(v).actions = [{ id: "set-eventvar-value", objectClass: "System", sid: 913, parameters: { variable: "Variable1", value: "amount * 2" } }]; },
  },
  {
    name: "function renamed: the other side's new calls follow",
    file: ES1, context: evCtx([], [undefined, renameFn], []),
    ours: (v) => { call1(v).callFunction = "doThing"; }, // C3 renames the existing call
    theirs: both(addAction({ callFunction: "Function1", sid: 914, parameters: ["1"] }), addAction({ id: "set-eventvar-value", objectClass: "System", sid: 915, parameters: { variable: "Variable1", value: "Functions.Function1(2) + 1" } })),
    merged: both((v) => { call1(v).callFunction = "doThing"; }, addAction({ callFunction: "doThing", sid: 914, parameters: ["1"] }), addAction({ id: "set-eventvar-value", objectClass: "System", sid: 915, parameters: { variable: "Variable1", value: "Functions.doThing(2) + 1" } })),
  },
  {
    // What C3 does to existing calls: the new parameter's default added.
    name: "function parameter added: the other side's new calls get its default",
    file: ES1, context: evCtx([], [undefined, addParam], []),
    ours: (v) => { call1(v).parameters = ["67", "5"]; },
    theirs: addAction({ callFunction: "Function1", sid: 916, parameters: ["1"] }),
    merged: both((v) => { call1(v).parameters = ["67", "5"]; }, addAction({ callFunction: "Function1", sid: 916, parameters: ["1", "5"] })),
  },
  {
    // C3 drops a removed parameter's argument from every call (6c2dba68: closeDialog).
    name: "function parameter removed: the other side's new calls drop its argument",
    file: ES1, context: evCtx([], [undefined, dropParam], []),
    ours: (v) => { call1(v).parameters = []; },
    theirs: addAction({ callFunction: "Function1", sid: 917, parameters: ["3"] }),
    merged: both((v) => { call1(v).parameters = []; }, addAction({ callFunction: "Function1", sid: 917, parameters: [] })),
  },
  {
    name: "function parameters changed, a call with an unexpected count: flagged",
    file: ES1, context: evCtx([], [undefined, addParam], []),
    ours: (v) => { call1(v).parameters = ["67", "5"]; },
    theirs: addAction({ callFunction: "Function1", sid: 918, parameters: ["1", "2", "3"] }),
    conflicts: ["function Function1 (sid 918) parameter parameters"],
    takeOurs: both((v) => { call1(v).parameters = ["67", "5"]; }, addAction({ callFunction: "Function1", sid: 918, parameters: ["1", "2", "3"] })),
    takeTheirs: both((v) => { call1(v).parameters = ["67", "5"]; }, addAction({ callFunction: "Function1", sid: 918, parameters: ["1", "2", "3"] })),
  },

  // ── event sheets (execution order) ──────────────────────────────────────────────────
  {
    name: "events added at different spots",
    file: ES1, ours: addEvent(111, 0), theirs: addEvent(222, "end"),
    merged: both(addEvent(111, 0), addEvent(222, "end")),
  },
  {
    name: "events appended on both sides (execution order unknown)",
    file: ES1, ours: addEvent(111, "end"), theirs: addEvent(222, "end"),
    merged: both(addEvent(111, "end"), addEvent(222, "end")),
    warnings: ["events"],
  },
  {
    name: "different actions of one event edited",
    file: ES1,
    ours: (v) => { block(v).actions[0].parameters.shape = "prism"; },
    theirs: (v) => { block(v).actions[2].parameters.layer = "\"Layer 1\""; },
    merged: (v) => { block(v).actions[0].parameters.shape = "prism"; block(v).actions[2].parameters.layer = "\"Layer 1\""; },
  },
  {
    // Seen in real merges: both sides replaced the same condition, each with a new sid.
    // Not an order question: keeping both would AND them.
    name: "the same condition replaced on both sides (new sids)",
    file: ES1,
    ours: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 1 }; },
    theirs: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 2 }; },
    conflicts: [`${BLOCK}.conditions`],
    takeOurs: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 1 }; },
    takeTheirs: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 2 }; },
  },

  // Comments have no sid: two identical ones at one level share an id. Seen a lot in a real
  // project (empty comments, one header comment repeated before similar events).
  {
    name: "identical comments at one level don't make the event list one value",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { group1(v).disabled = true; }, theirs: (v) => { fn1(v).functionDescription = "hi"; },
    merged: (v) => { group1(v).disabled = true; fn1(v).functionDescription = "hi"; },
  },
  {
    name: "a copy of an identical comment added on one side is kept",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { group1(v).disabled = true; }, theirs: (v) => { v.events.push(clone(EMPTY_COMMENT)); },
    merged: (v) => { group1(v).disabled = true; v.events.push(clone(EMPTY_COMMENT)); },
  },
  {
    name: "a copy of an identical comment deleted on one side stays deleted",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { v.events.splice(4, 1); }, theirs: (v) => { fn1(v).functionDescription = "hi"; },
    merged: (v) => { v.events.splice(4, 1); fn1(v).functionDescription = "hi"; },
  },
  {
    // Ours' order is kept, so theirs is the side whose deletions have to be found.
    name: "a copy of an identical comment deleted on the other side stays deleted",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { group1(v).disabled = true; }, theirs: (v) => { v.events.splice(1, 1); },
    merged: (v) => { group1(v).disabled = true; v.events.splice(1, 1); },
  },
  {
    // The new event goes right above the second comment, so its neighbour above changes.
    name: "a copy whose neighbour above changed is still the same copy",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { group1(v).disabled = true; },
    theirs: (v) => { v.events.splice(4, 0, { eventType: "block", conditions: [], actions: [], sid: 940 }); },
    merged: (v) => { group1(v).disabled = true; v.events.splice(4, 0, { eventType: "block", conditions: [], actions: [], sid: 940 }); },
  },
  {
    // The base has 2 empty comments; the new copy is the first one on that side, after the
    // include. Counting copies from the top would call it the old first copy.
    name: "a copy of a repeated comment added above the others lands where it was added",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { group1(v).disabled = true; },
    theirs: (v) => { v.events.splice(0, 0, clone(EMPTY_COMMENT), { eventType: "block", conditions: [], actions: [], sid: 931 }); },
    merged: (v) => { group1(v).disabled = true; v.events.splice(0, 0, clone(EMPTY_COMMENT), { eventType: "block", conditions: [], actions: [], sid: 931 }); },
  },
  {
    name: "identical comments among an event's actions",
    file: ES2, base: (v) => { twoEmptyComments(v); v.events[3].actions.push({ type: "comment", text: "whatever" }); },
    ours: (v) => { v.events[3].actions.push({ type: "comment", text: "whatever" }); }, theirs: (v) => { v.events[3].conditions[0].id = "on-end-of-layout"; },
    merged: (v) => { v.events[3].actions.push({ type: "comment", text: "whatever" }); v.events[3].conditions[0].id = "on-end-of-layout"; },
  },
  {
    name: "a new event with its own copy of a repeated comment stays together",
    file: ES2, base: twoEmptyComments,
    ours: (v) => { group1(v).disabled = true; },
    theirs: (v) => { v.events.splice(5, 0, clone(EMPTY_COMMENT), { eventType: "block", conditions: [], actions: [], sid: 930 }); },
    merged: (v) => { group1(v).disabled = true; v.events.splice(5, 0, clone(EMPTY_COMMENT), { eventType: "block", conditions: [], actions: [], sid: 930 }); },
  },

  {
    name: "script action: different lines edited",
    file: ES1,
    base: (v) => { block(v).actions.push(scriptAction(["const a = 1;", "const b = 2;", "const c = 3;"])); },
    ours: (v) => { block(v).actions[3].script[0] = "const a = 10;"; },
    theirs: (v) => { block(v).actions[3].script[2] = "const c = 30;"; },
    merged: (v) => { block(v).actions[3].script[0] = "const a = 10;"; block(v).actions[3].script[2] = "const c = 30;"; },
  },
  {
    name: "script action: the same line edited differently",
    file: ES1,
    base: (v) => { block(v).actions.push(scriptAction(["const a = 1;", "const b = 2;"])); },
    ours: (v) => { block(v).actions[3].script[1] = "const b = 20;"; },
    theirs: (v) => { block(v).actions[3].script[1] = "const b = 200;"; },
    conflicts: [`${BLOCK}.actions[sid=555].script`],
    takeOurs: (v) => { block(v).actions[3].script[1] = "const b = 20;"; },
    takeTheirs: (v) => { block(v).actions[3].script[1] = "const b = 200;"; },
  },

  // ── c3proj: unordered lists merge as sets ───────────────────────────────────────────
  {
    // The most common real conflict: two branches create objects, git fails on the list.
    name: "object types created on both sides",
    file: PROJ,
    ours: (v) => { v.objectTypes.items.push("Player", "Enemy"); },
    theirs: (v) => { v.objectTypes.items.push("Door"); },
    merged: (v) => { v.objectTypes.items.push("Player", "Enemy", "Door"); },
  },
  {
    name: "object type created on one side, another removed on the other",
    file: PROJ,
    ours: (v) => { v.objectTypes.items.push("Player"); },
    theirs: (v) => { v.objectTypes.items = v.objectTypes.items.filter((n: string) => n !== "Text"); },
    merged: (v) => { v.objectTypes.items = v.objectTypes.items.filter((n: string) => n !== "Text"); v.objectTypes.items.push("Player"); },
  },
  {
    name: "layouts and subfolders created on both sides",
    file: PROJ,
    ours: (v) => { v.layouts.items.push("Menu"); v.layouts.subfolders.push({ items: ["Level 1"], subfolders: [], name: "Levels" }); },
    theirs: (v) => { v.layouts.items.push("Credits"); v.layouts.subfolders.push({ items: ["Boss"], subfolders: [], name: "Bosses" }); },
    merged: (v) => {
      v.layouts.items.push("Menu", "Credits");
      v.layouts.subfolders.push({ items: ["Level 1"], subfolders: [], name: "Levels" }, { items: ["Boss"], subfolders: [], name: "Bosses" });
    },
    // Layouts keep their project-bar order (checked in the editor), so it's ambiguous.
    warnings: ["layouts.items", "layouts.subfolders"],
  },
  {
    name: "the same subfolder gets different items on each side",
    file: PROJ,
    base: (v) => { v.objectTypes.subfolders.push({ items: [], subfolders: [], name: "Enemies" }); },
    ours: (v) => { v.objectTypes.subfolders[0].items.push("Bat"); },
    theirs: (v) => { v.objectTypes.subfolders[0].items.push("Rat"); },
    merged: (v) => { v.objectTypes.subfolders[0].items.push("Bat", "Rat"); },
  },
  {
    name: "addons added on both sides",
    file: PROJ,
    ours: (v) => { v.usedAddons.push(addon("MyPlugin")); },
    theirs: (v) => { v.usedAddons.push(addon("OtherPlugin")); },
    merged: (v) => { v.usedAddons.push(addon("MyPlugin"), addon("OtherPlugin")); },
  },
  {
    name: "the same addon added on both sides with different versions",
    file: PROJ,
    ours: (v) => { v.usedAddons.push(addon("MyPlugin", "1.0.0.0")); },
    theirs: (v) => { v.usedAddons.push(addon("MyPlugin", "1.1.0.0")); },
    conflicts: ["usedAddons[type=plugin,id=MyPlugin].version"],
    takeOurs: (v) => { v.usedAddons.push(addon("MyPlugin", "1.0.0.0")); },
    takeTheirs: (v) => { v.usedAddons.push(addon("MyPlugin", "1.1.0.0")); },
  },
  {
    name: "saved with different releases: the newer one",
    file: PROJ,
    ours: (v) => { v.savedWithRelease = 49502; v.objectTypes.items.push("Player"); },
    theirs: (v) => { v.savedWithRelease = 50300; },
    merged: (v) => { v.savedWithRelease = 50300; v.objectTypes.items.push("Player"); },
  },

  // ── object types and families ───────────────────────────────────────────────────────
  {
    // Their order is only the order of the Properties bar: a set.
    name: "instance variables added on both sides",
    file: SPRITE,
    ours: (v) => { v.instanceVariables.push(ivar("hp", 11)); },
    theirs: (v) => { v.instanceVariables.push(ivar("speed", 22)); },
    merged: (v) => { v.instanceVariables.push(ivar("hp", 11), ivar("speed", 22)); },
  },
  {
    name: "an instance variable with the same name created on both sides",
    file: SPRITE,
    ours: (v) => { v.instanceVariables.push(ivar("hp", 11)); },
    theirs: (v) => { v.instanceVariables.push(ivar("hp", 22)); },
    conflicts: ["instanceVariables[name=hp]"],
    takeOurs: (v) => { v.instanceVariables.push(ivar("hp", 11)); },
    takeTheirs: (v) => { v.instanceVariables.push(ivar("hp", 22)); },
  },
  {
    name: "family members added on one side, removed on the other",
    file: FAM,
    base: (v) => { v.members.push("Sprite2"); },
    ours: (v) => { v.members.push("Sprite3"); },
    theirs: (v) => { v.members = v.members.filter((m: string) => m !== "Sprite2"); },
    merged: (v) => { v.members = v.members.filter((m: string) => m !== "Sprite2"); v.members.push("Sprite3"); },
  },

  // ── opaque data ─────────────────────────────────────────────────────────────────────
  // Tilemap data: column by column over max-width × max-height (cell x·max-height + y), run-
  // length encoded; "0" empty, n = tile n−1, h/v/d = flipped. The lab base tilemap is 30×30.
  {
    name: "tilemap painted on both sides, the same tiles differently",
    file: L2,
    base: (v) => { tilemap(v).data = "900x0"; },
    ours: (v) => { tilemap(v).data = "900x1"; },
    theirs: (v) => { tilemap(v).data = "900x2"; },
    conflicts: [`${layerPath(L2)}.instances[uid=6].ownData.tilemapData`],
    takeOurs: (v) => { tilemap(v).data = "900x1"; }, takeTheirs: (v) => { tilemap(v).data = "900x2"; },
  },
  {
    name: "tilemap painted on both sides, different tiles",
    file: L2,
    base: (v) => { tilemap(v).data = "900x0"; },
    ours: (v) => { tilemap(v).data = "5,899x0"; }, // (0, 0)
    theirs: (v) => { tilemap(v).data = "899x0,7hv"; }, // (29, 29), flipped
    merged: (v) => { tilemap(v).data = "5,898x0,7hv"; },
  },
  {
    // Both versions of the conflict keep the tile only one side painted.
    name: "tilemap: one tile painted differently on both sides",
    file: L2,
    base: (v) => { tilemap(v).data = "900x0"; },
    ours: (v) => { tilemap(v).data = "5,898x0,3"; },
    theirs: (v) => { tilemap(v).data = "6,899x0"; },
    conflicts: [`${layerPath(L2)}.instances[uid=6].ownData.tilemapData`],
    takeOurs: (v) => { tilemap(v).data = "5,898x0,3"; }, takeTheirs: (v) => { tilemap(v).data = "6,898x0,3"; },
  },
  {
    name: "tilemap widened on one side, painted on the other",
    file: L2,
    ours: (v) => { Object.assign(tilemap(v), { width: 31, "max-width": 31, data: `${tilemap(v).data},30x0` }); },
    theirs: (v) => { tilemap(v).data = "900x2"; },
    merged: (v) => { Object.assign(tilemap(v), { width: 31, "max-width": 31, data: "900x2,30x0" }); },
  },
  {
    // A row more: every column gets a cell, so every tile after the first column moves in `data`.
    name: "tilemap made taller on one side, painted on the other",
    file: L2,
    base: (v) => { tilemap(v).data = "900x0"; },
    ours: (v) => { Object.assign(tilemap(v), { height: 31, "max-height": 31, data: "930x0" }); },
    theirs: (v) => { tilemap(v).data = "30x0,4,869x0"; }, // (1, 0)
    merged: (v) => { Object.assign(tilemap(v), { height: 31, "max-height": 31, data: "31x0,4,898x0" }); },
  },
  {
    // r495+ drops cells outside width × height when it loads a tilemap.
    name: "tilemap: hidden cells dropped on one side, painted on the other",
    file: L2,
    base: (v) => { Object.assign(tilemap(v), { width: 20, data: "750x0,9,149x0" }); }, // hidden (25, 0)
    ours: (v) => { Object.assign(tilemap(v), { "max-width": 20, data: "600x0" }); },
    theirs: (v) => { tilemap(v).data = "5,749x0,9,149x0"; },
    merged: (v) => { Object.assign(tilemap(v), { width: 20, "max-width": 20, data: "5,599x0" }); },
  },
  {
    name: "tilemap narrowed on one side, painted where it narrowed on the other",
    file: L2,
    base: (v) => { tilemap(v).data = "900x0"; },
    ours: (v) => { tilemap(v).width = 20; },
    theirs: (v) => { tilemap(v).data = "750x0,9,149x0"; }, // (25, 0)
    conflicts: [`${layerPath(L2)}.instances[uid=6].ownData.tilemapData`],
    takeOurs: (v) => { tilemap(v).width = 20; }, takeTheirs: (v) => { tilemap(v).data = "750x0,9,149x0"; },
  },
  {
    name: "tilemap resized differently on both sides",
    file: L2,
    ours: (v) => { Object.assign(tilemap(v), { width: 31, "max-width": 31 }); },
    theirs: (v) => { Object.assign(tilemap(v), { width: 32, "max-width": 32 }); },
    conflicts: [`${layerPath(L2)}.instances[uid=6].ownData.tilemapData`],
    takeOurs: (v) => { Object.assign(tilemap(v), { width: 31, "max-width": 31 }); },
    takeTheirs: (v) => { Object.assign(tilemap(v), { width: 32, "max-width": 32 }); },
  },
  {
    name: "tilemap painted on one side only",
    file: L2, ours: (v) => { tilemap(v).data = "900x1"; }, theirs: (v) => { v.width = 1000; },
    merged: (v) => { tilemap(v).data = "900x1"; v.width = 1000; },
  },

  // ── whole files ─────────────────────────────────────────────────────────────────────
  {
    name: "untouched on both sides",
    file: L1, ours: () => {}, theirs: () => {},
    merged: () => {},
  },
  {
    name: "file added on both sides, identical",
    file: L1, base: null, ours: () => {}, theirs: () => {},
    merged: () => {},
  },
  {
    name: "file added on both sides, different",
    file: L1, base: null, ours: (v) => { v.width = 1000; }, theirs: (v) => { v.width = 2000; },
    conflicts: ["width"],
    takeOurs: (v) => { v.width = 1000; }, takeTheirs: (v) => { v.width = 2000; },
  },
];

function tilemap(v: any) {
  for (const l of v.layers) for (const i of l.instances) if (i.ownData?.tilemapData) return i.ownData.tilemapData;
  throw new Error("no tilemap");
}
