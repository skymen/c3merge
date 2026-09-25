// The lab's corruptions: each one applies exactly one change to a copy of fixtures/lab-base
// (see tasks/lab-experiments.md for the matrix). Rows whose `needs` isn't in the base
// project yet are skipped with that reason.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Corruption {
  row: string;
  title: string;
  // Content the base project must have for this row; checked before applying.
  needs?: (dir: string) => Promise<string | null>;
  apply(dir: string): Promise<void>;
  // Is the corruption still there in a project C3 saved? The verdict rests on this, not on
  // byte-comparing with what one release saves: C3 may repair differently (e.g. renumber).
  present?: (dir: string) => Promise<boolean>;
}

type Json = any;

// C3 writes JSON as JSON.stringify(v, null, "\t") (uistate/brush files: compact), with no
// trailing newline; verified on 2,121 files. Rewriting in the same style means an edit
// changes only the edited field.
export async function editJson(dir: string, rel: string, fn: (v: Json) => Json | void) {
  const file = path.join(dir, rel);
  const raw = await readFile(file, "utf8");
  const v = JSON.parse(raw);
  const out = fn(v) ?? v;
  const compact = !raw.includes("\n");
  await writeFile(file, compact ? JSON.stringify(out) : JSON.stringify(out, null, "\t"));
}

export async function readJson(dir: string, rel: string): Promise<Json> {
  return JSON.parse(await readFile(path.join(dir, rel), "utf8"));
}

// Reference copy for presence checks that compare with the original (e.g. key order).
const BASE_FOR_PRESENCE = path.resolve(import.meta.dirname, "../fixtures/lab-base");

const L1 = "layouts/Layout 1.json";
const L2 = "layouts/Layout 2.json";
const ES1 = "eventSheets/Event sheet 1.json";
const ES2 = "eventSheets/Event sheet 2.json";
const C3PROJ = "project.c3proj";

const inst = (layout: Json, type: string) => layout.layers.flatMap((l: Json) => l.instances).find((i: Json) => i.type === type);
const findEvent = (events: Json[], pred: (e: Json) => boolean): Json | undefined => {
  for (const e of events ?? []) {
    if (pred(e)) return e;
    const c = findEvent(e.children, pred);
    if (c) return c;
  }
};
const firstAction = (sheet: Json) => findEvent(sheet.events, (e) => (e.actions ?? []).some((a: Json) => a.objectClass && a.id))!
  .actions.find((a: Json) => a.objectClass && a.id);

const allInstances = async (d: string) => {
  const p = await readJson(d, C3PROJ);
  const out: Json[] = [];
  for (const name of p.layouts.items) {
    const l = await readJson(d, `layouts/${name}.json`).catch(() => null);
    if (l) out.push(...l.layers.flatMap((x: Json) => x.instances));
  }
  return out;
};
const hasDup = (xs: unknown[]) => new Set(xs).size !== xs.length;
const allEvents = (events: Json[]): Json[] => (events ?? []).flatMap((e) => [e, ...allEvents(e.children)]);
const text = (d: string, rel: string) => readFile(path.join(d, rel), "utf8");

// A "needs" check that looks for a JSON fragment anywhere in a file.
const has = (rel: string, re: RegExp, what: string) => async (dir: string) =>
  re.test(await readFile(path.join(dir, rel), "utf8").catch(() => "")) ? null : what;

export const corruptions: Corruption[] = [
  { row: "1", title: "layout instance `type` → nonexistent object type",
    apply: (d) => editJson(d, L1, (l) => { inst(l, "Sprite").type = "NoSuchType"; }) },
  { row: "2", title: "layout instance `uid` duplicated within layout",
    present: async (d) => hasDup((await readJson(d, L2)).layers.flatMap((l: Json) => l.instances).map((i: Json) => i.uid)),
    apply: (d) => editJson(d, L2, (l) => { inst(l, "3DShape").uid = inst(l, "Text").uid; }) },
  { row: "3", title: "uid duplicated across layouts",
    present: async (d) => hasDup((await allInstances(d)).map((i) => i.uid)),
    apply: async (d) => { const uid = inst(await readJson(d, L1), "Sprite").uid; await editJson(d, L2, (l) => { inst(l, "Text").uid = uid; }); } },
  { row: "4", title: "event `sid` duplicated",
    present: async (d) => hasDup(allEvents((await readJson(d, ES2)).events).map((e) => e.sid).filter((x) => x !== undefined)),
    apply: (d) => editJson(d, ES2, (s) => {
      const fn = findEvent(s.events, (e) => e.eventType === "function-block");
      findEvent(s.events, (e) => e.eventType === "block")!.sid = fn!.sid;
    }) },
  { row: "5", title: "event `sid` missing",
    present: async (d) => allEvents((await readJson(d, ES2)).events).some((e) => e.eventType === "block" && e.sid === undefined),
    apply: (d) => editJson(d, ES2, (s) => { delete findEvent(s.events, (e) => e.eventType === "block")!.sid; }) },
  { row: "6", title: "object type `sid` duplicated",
    apply: async (d) => { const sid = (await readJson(d, "objectTypes/Sprite.json")).sid; await editJson(d, "objectTypes/Text.json", (t) => { t.sid = sid; }); } },
  { row: "7", title: "c3proj folder tree lists a layout with no file",
    apply: (d) => editJson(d, C3PROJ, (p) => { p.layouts.items.push("Layout 3"); }) },
  { row: "8", title: "layout file exists but not listed in c3proj",
    present: async (d) => !(await readJson(d, C3PROJ)).layouts.items.includes("Layout 2"),
    apply: (d) => editJson(d, C3PROJ, (p) => { p.layouts.items = p.layouts.items.filter((n: string) => n !== "Layout 2"); }) },
  { row: "9", title: "event sheet `include` → nonexistent sheet",
    apply: (d) => editJson(d, ES2, (s) => { findEvent(s.events, (e) => e.eventType === "include")!.includeSheet = "No such sheet"; }) },
  { row: "10", title: "event `objectClass` → nonexistent type",
    apply: (d) => editJson(d, ES1, (s) => { firstAction(s).objectClass = "NoSuchType"; }) },
  { row: "11", title: "action `id` invalid for plugin",
    apply: (d) => editJson(d, ES1, (s) => { firstAction(s).id = "no-such-action"; }) },
  { row: "12", title: "action parameter references missing layer name",
    needs: has(ES1, /"layer"/, "an action with a layer parameter (e.g. Sprite › Move to layer)"),
    apply: (d) => editJson(d, ES1, (s) => {
      const a = findEvent(s.events, (e) => (e.actions ?? []).some((x: Json) => x.parameters?.layer))!.actions.find((x: Json) => x.parameters?.layer);
      a.parameters.layer = "\"No such layer\"";
    }),
    present: async (d) => (await text(d, ES1)).includes("No such layer") },
  { row: "13", title: "call-function → nonexistent function",
    needs: has(ES1, /"callFunction"/, "an action that calls Function1"),
    apply: (d) => editJson(d, ES1, (s) => {
      const a = allEvents(s.events).flatMap((e) => e.actions ?? []).find((x: Json) => x.callFunction);
      a.callFunction = "NoSuchFunction";
    }),
    present: async (d) => (await text(d, ES1)).includes("NoSuchFunction") },
  { row: "14", title: "instance variable on instance not declared on type",
    apply: (d) => editJson(d, L1, (l) => { inst(l, "Sprite").instanceVariables = { ...inst(l, "Sprite").instanceVariables, c3mergeUndeclared: 5 }; }) },
  { row: "15", title: "type declares variable, instance lacks it",
    needs: async (d) => (await readJson(d, "objectTypes/Sprite.json")).instanceVariables.length ? null : "an instance variable declared on Sprite (e.g. hp = 10)",
    apply: async (d) => {
      const declared = (await readJson(d, "objectTypes/Sprite.json")).instanceVariables[0].name;
      await editJson(d, L1, (l) => { delete inst(l, "Sprite").instanceVariables[declared]; });
    },
    present: async (d) => {
      const declared = (await readJson(d, "objectTypes/Sprite.json")).instanceVariables[0].name;
      return !(declared in inst(await readJson(d, L1), "Sprite").instanceVariables);
    } },
  { row: "16", title: "family member → nonexistent type",
    apply: (d) => editJson(d, "families/Family1.json", (f) => { f.members.push("NoSuchType"); }) },
  { row: "17", title: "family members of mixed plugins",
    apply: (d) => editJson(d, "families/Family1.json", (f) => { f.members.push("Text"); }) },
  { row: "18", title: "`usedAddons` missing an addon that a type uses",
    present: async (d) => !(await readJson(d, C3PROJ)).usedAddons.some((a: Json) => a.id === "Tilemap"),
    apply: (d) => editJson(d, C3PROJ, (p) => { p.usedAddons = p.usedAddons.filter((a: Json) => a.id !== "Tilemap"); }) },
  { row: "19", title: "`usedAddons` entry claims a different version / bundled",
    present: async (d) => (await readJson(d, C3PROJ)).usedAddons.some((a: Json) => a.id === "Sprite" && (a.version === "0.0.1" || a.bundled)),
    apply: (d) => editJson(d, C3PROJ, (p) => { const a = p.usedAddons.find((x: Json) => x.id === "Sprite"); a.version = "0.0.1"; a.bundled = true; }) },
  { row: "20", title: "`savedWithRelease` newer than editor",
    apply: (d) => editJson(d, C3PROJ, (p) => { p.savedWithRelease = 99900; }) },
  { row: "22", title: "animation frame `imageSpriteId` duplicated",
    apply: (d) => editJson(d, "objectTypes/3DShape.json", (t) => { const f = t.animations.items[0].frames; f[1].imageSpriteId = f[0].imageSpriteId; }) },
  { row: "23", title: "image file missing for a frame",
    apply: (d) => rm(path.join(d, "images/sprite-animation 1-000.png")) },
  { row: "24", title: "layer `name` duplicated in a layout",
    apply: (d) => editJson(d, L2, (l) => { l.layers.push({ ...l.layers[0], instances: [], sid: 111111111111111 }); }) },
  { row: "25", title: "object type name duplicated (two files)",
    apply: (d) => editJson(d, "objectTypes/TiledBackground.json", (t) => { t.name = "Text"; }) },
  { row: "26a", title: "key order changed (Layout 1 top level reversed)",
    present: async (d) => Object.keys(await readJson(d, L1))[0] !== Object.keys(await readJson(BASE_FOR_PRESENCE, L1))[0],
    apply: (d) => editJson(d, L1, (l) => Object.fromEntries(Object.entries(l).reverse())) },
  { row: "26b", title: "tabs → 2 spaces (Layout 1)",
    present: async (d) => (await text(d, L1)).includes("\n  \""),
    apply: async (d) => { const f = path.join(d, L1); await writeFile(f, JSON.stringify(JSON.parse(await readFile(f, "utf8")), null, 2)); } },
  { row: "26c", title: "LF → CRLF (Layout 1)",
    present: async (d) => (await text(d, L1)).includes("\r\n"),
    apply: async (d) => { const f = path.join(d, L1); await writeFile(f, (await readFile(f, "utf8")).replace(/\n/g, "\r\n")); } },
  { row: "27a", title: "unknown extra key at top level (Layout 1)",
    present: async (d) => (await text(d, L1)).includes("c3mergeExtra"),
    apply: (d) => editJson(d, L1, (l) => { l.c3mergeExtra = { note: "unknown" }; }) },
  { row: "27b", title: "unknown extra key inside an event",
    present: async (d) => (await text(d, ES2)).includes("c3mergeExtra"),
    apply: (d) => editJson(d, ES2, (s) => { findEvent(s.events, (e) => e.eventType === "block")!.c3mergeExtra = true; }) },
  { row: "28", title: "required key missing (instance `world`)",
    apply: (d) => editJson(d, L1, (l) => { delete inst(l, "Sprite").world; }) },
  { row: "29", title: "tilemap tile data truncated",
    present: async (d) => { const t = inst(await readJson(d, L2), "Tilemap").ownData.tilemapData; const n = t.data.split(",").reduce((a: number, run: string) => a + (run.includes("x") ? Number(run.split("x")[0]) : 1), 0); return n !== t.width * t.height; },
    apply: (d) => editJson(d, L2, (l) => { const t = inst(l, "Tilemap").ownData.tilemapData; t.data = t.data.slice(0, Math.floor(t.data.length / 2)); }) },
  { row: "30", title: "timeline references deleted instance uid",
    needs: async (d) => (await readJson(d, "timelines/Timeline 1.json")).tracks.some((t: Json) => "worldInstance" in t) ? null : "a timeline track animating an instance",
    apply: (d) => editJson(d, "timelines/Timeline 1.json", (t) => { t.tracks.find((x: Json) => "worldInstance" in x).worldInstance = 999999; }),
    present: async (d) => (await readJson(d, "timelines/Timeline 1.json")).tracks.some((t: Json) => t.worldInstance === 999999) },
  { row: "31", title: "hierarchy parent lists a child uid that doesn't exist",
    needs: has(L1, /"sceneGraphData"/, "a hierarchy (e.g. TiledBackground as a child of Sprite)"),
    apply: (d) => editJson(d, L1, (l) => {
      l.layers.flatMap((x: Json) => x.instances).find((i: Json) => i.sceneGraphData?.children?.length).sceneGraphData.children[0].uid = 999999;
    }),
    present: async (d) => (await text(d, L1)).includes("999999") },
  { row: "31b", title: "hierarchy child's parent-uid doesn't exist",
    needs: has(L1, /"sceneGraphData"/, "a hierarchy (e.g. TiledBackground as a child of Sprite)"),
    apply: (d) => editJson(d, L1, (l) => {
      l.layers.flatMap((x: Json) => x.instances).find((i: Json) => i.sceneGraphData?.["parent-uid"] != null).sceneGraphData["parent-uid"] = 999999;
    }),
    present: async (d) => (await text(d, L1)).includes("999999") },
  { row: "32", title: "global variable name duplicated",
    needs: has(ES1, /"eventType":\s*"variable"/, "a global variable in Event sheet 1"),
    apply: (d) => editJson(d, ES1, (s) => { const v = s.events.find((e: Json) => e.eventType === "variable"); s.events.push({ ...v, sid: 222222222222222 }); }),
    present: async (d) => hasDup(allEvents((await readJson(d, ES1)).events).filter((e) => e.eventType === "variable").map((e) => e.name)) },
  { row: "33", title: "event with 0 conditions + 0 actions (empty block)",
    present: async (d) => allEvents((await readJson(d, ES1)).events).some((e) => e.eventType === "block" && !e.conditions?.length && !e.actions?.length),
    apply: (d) => editJson(d, ES1, (s) => { s.events.push({ eventType: "block", conditions: [], actions: [], sid: 333333333333333 }); }) },
  { row: "34", title: "two effects with same name on one type",
    needs: async (d) => (await readJson(d, "objectTypes/Sprite.json")).effectTypes.length ? null : "an effect on Sprite (e.g. Grayscale)",
    apply: (d) => editJson(d, "objectTypes/Sprite.json", (t) => { t.effectTypes.push({ ...t.effectTypes[0] }); }),
    present: async (d) => hasDup((await readJson(d, "objectTypes/Sprite.json")).effectTypes.map((e: Json) => e.name)) },
  // The editor refuses a second group with an existing name; a merge can still produce one.
  // The runtime keys groups by lowercased name, so "Set group active" reaches only one of them.
  { row: "35", title: "group name duplicated (in another sheet)",
    needs: has(ES2, /"eventType":\s*"group"/, "a group in Event sheet 2"),
    apply: (d) => addGroupNamed(d, (t) => t),
    present: groupNamesDuplicated },
  { row: "35b", title: "group names differ only in case",
    needs: has(ES2, /"eventType":\s*"group"/, "a group in Event sheet 2"),
    apply: (d) => addGroupNamed(d, (t) => t.toLowerCase()),
    present: groupNamesDuplicated },
];

async function addGroupNamed(d: string, name: (title: string) => string) {
  const title = findEvent((await readJson(d, ES2)).events, (e) => e.eventType === "group")!.title;
  await editJson(d, ES1, (s) => { s.events.push({ eventType: "group", disabled: false, title: name(title), description: "", isActiveOnStart: true, children: [], sid: 353535353535353 }); });
}
async function groupNamesDuplicated(d: string) {
  const titles = [ES1, ES2].map(async (f) => allEvents((await readJson(d, f)).events).filter((e) => e.eventType === "group").map((e) => String(e.title).toLowerCase()));
  return hasDup((await Promise.all(titles)).flat());
}
