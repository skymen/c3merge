// Hand-made merge cases, one per engine rule, built on the real lab-base files. Each case
// edits a copy of a base file for ours and for theirs, then says what the merge must give:
// - `merged`: a clean merge; the expected file is base with that edit, byte for byte in C3's
//   format;
// - `conflicts`: the conflict paths the engine must report, plus `takeOurs` / `takeTheirs`,
//   the file you get by resolving every marker hunk to that side (must be valid JSON equal
//   to base with that edit).
// Rule (DESIGN.md "Engine"): only merge what is certainly right, anything else is a conflict.
import { readFileSync } from "node:fs";
import path from "node:path";

export type Edit = (v: any) => void;
export interface Case {
  name: string;
  file: string; // lab-base file, also the repo path (%P) that picks the profile
  base?: Edit | null; // edit the base first (null: file absent in base, added on both sides)
  ours: Edit;
  theirs: Edit;
  merged?: Edit;
  conflicts?: string[];
  takeOurs?: Edit;
  takeTheirs?: Edit;
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

const ivar = (name: string, sid: number) => ({ name, type: "number", initialValue: 0, desc: "", show: true, sid });
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
    conflicts: [`${L1_LAYER}.instances`],
    takeOurs: addInst(50, "end", 11), takeTheirs: addInst(60, "end", 12),
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
    conflicts: [`${L1_LAYER}.instances`],
    takeOurs: moveInst(7, 0), takeTheirs: moveInst(2, 2),
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
    conflicts: ["events"],
    takeOurs: addEvent(111, "end"), takeTheirs: addEvent(222, "end"),
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
    name: "the same condition replaced on both sides (new sids)",
    file: ES1,
    ours: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 1 }; },
    theirs: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 2 }; },
    conflicts: [`${BLOCK}.conditions`],
    takeOurs: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 1 }; },
    takeTheirs: (v) => { block(v).conditions[0] = { id: "every-tick", objectClass: "System", sid: 2 }; },
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
  },
  {
    name: "the same subfolder gets different items on each side",
    file: PROJ,
    base: (v) => { v.layouts.subfolders.push({ items: [], subfolders: [], name: "Levels" }); },
    ours: (v) => { v.layouts.subfolders[0].items.push("Level 1"); },
    theirs: (v) => { v.layouts.subfolders[0].items.push("Level 2"); },
    merged: (v) => { v.layouts.subfolders[0].items.push("Level 1", "Level 2"); },
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
  {
    name: "tilemap painted on both sides",
    file: L2,
    ours: (v) => { tilemap(v).data = "900x1"; },
    theirs: (v) => { tilemap(v).data = "900x2"; },
    conflicts: [`${layerPath(L2)}.instances[uid=6].ownData.tilemapData`],
    takeOurs: (v) => { tilemap(v).data = "900x1"; }, takeTheirs: (v) => { tilemap(v).data = "900x2"; },
  },
  {
    // width/height/data only make sense together: never merge them key by key.
    name: "tilemap resized on one side, painted on the other",
    file: L2,
    ours: (v) => { Object.assign(tilemap(v), { width: 31, "max-width": 31 }); },
    theirs: (v) => { tilemap(v).data = "900x2"; },
    conflicts: [`${layerPath(L2)}.instances[uid=6].ownData.tilemapData`],
    takeOurs: (v) => { Object.assign(tilemap(v), { width: 31, "max-width": 31 }); },
    takeTheirs: (v) => { tilemap(v).data = "900x2"; },
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
