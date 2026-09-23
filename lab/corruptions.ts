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

// A "needs" check that looks for a JSON fragment anywhere in a file.
const has = (rel: string, re: RegExp, what: string) => async (dir: string) =>
  re.test(await readFile(path.join(dir, rel), "utf8").catch(() => "")) ? null : what;

export const corruptions: Corruption[] = [
  { row: "1", title: "layout instance `type` → nonexistent object type",
    apply: (d) => editJson(d, L1, (l) => { inst(l, "Sprite").type = "NoSuchType"; }) },
  { row: "2", title: "layout instance `uid` duplicated within layout",
    apply: (d) => editJson(d, L2, (l) => { inst(l, "3DShape").uid = inst(l, "Text").uid; }) },
  { row: "3", title: "uid duplicated across layouts",
    apply: async (d) => { const uid = inst(await readJson(d, L1), "Sprite").uid; await editJson(d, L2, (l) => { inst(l, "Text").uid = uid; }); } },
  { row: "4", title: "event `sid` duplicated",
    apply: (d) => editJson(d, ES2, (s) => {
      const fn = findEvent(s.events, (e) => e.eventType === "function-block");
      findEvent(s.events, (e) => e.eventType === "block")!.sid = fn!.sid;
    }) },
  { row: "5", title: "event `sid` missing",
    apply: (d) => editJson(d, ES2, (s) => { delete findEvent(s.events, (e) => e.eventType === "block")!.sid; }) },
  { row: "6", title: "object type `sid` duplicated",
    apply: async (d) => { const sid = (await readJson(d, "objectTypes/Sprite.json")).sid; await editJson(d, "objectTypes/Text.json", (t) => { t.sid = sid; }); } },
  { row: "7", title: "c3proj folder tree lists a layout with no file",
    apply: (d) => editJson(d, C3PROJ, (p) => { p.layouts.items.push("Layout 3"); }) },
  { row: "8", title: "layout file exists but not listed in c3proj",
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
    }) },
  { row: "13", title: "call-function → nonexistent function",
    needs: async (d) => /"callFunction"|"call-function"|"function-name"|Function1\(/.test(await readFile(path.join(d, ES1), "utf8") + await readFile(path.join(d, ES2), "utf8")) ? null : "an action that calls Function1",
    apply: async () => { throw new Error("not written yet: needs a real call-function action to learn its shape"); } },
  { row: "14", title: "instance variable on instance not declared on type",
    apply: (d) => editJson(d, L1, (l) => { inst(l, "Sprite").instanceVariables = { ...inst(l, "Sprite").instanceVariables, c3mergeUndeclared: 5 }; }) },
  { row: "15", title: "type declares variable, instance lacks it",
    needs: async (d) => (await readJson(d, "objectTypes/Sprite.json")).instanceVariables.length ? null : "an instance variable declared on Sprite (e.g. hp = 10)",
    apply: (d) => editJson(d, L1, (l) => { inst(l, "Sprite").instanceVariables = {}; }) },
  { row: "16", title: "family member → nonexistent type",
    apply: (d) => editJson(d, "families/Family1.json", (f) => { f.members.push("NoSuchType"); }) },
  { row: "17", title: "family members of mixed plugins",
    apply: (d) => editJson(d, "families/Family1.json", (f) => { f.members.push("Text"); }) },
  { row: "18", title: "`usedAddons` missing an addon that a type uses",
    apply: (d) => editJson(d, C3PROJ, (p) => { p.usedAddons = p.usedAddons.filter((a: Json) => a.id !== "Tilemap"); }) },
  { row: "19", title: "`usedAddons` entry claims a different version / bundled",
    apply: (d) => editJson(d, C3PROJ, (p) => { const a = p.usedAddons.find((x: Json) => x.id === "Sprite"); a.version = "0.0.1"; a.bundled = true; }) },
  { row: "20", title: "`savedWithRelease` newer than editor",
    apply: (d) => editJson(d, C3PROJ, (p) => { p.savedWithRelease = 99900; }) },
  { row: "21", title: "`savedWithRelease` much older",
    // Faking the number makes C3 expect the lowercase file names old releases used
    // ("objectTypes\\sprite.json"), so it only tests the fake. Needs a real old project.
    needs: async () => "a real project saved by an old release (faking savedWithRelease makes C3 look for old lowercase file names)",
    apply: (d) => editJson(d, C3PROJ, (p) => { p.savedWithRelease = 30000; }) },
  { row: "22", title: "animation frame `imageSpriteId` duplicated",
    apply: (d) => editJson(d, "objectTypes/3DShape.json", (t) => { const f = t.animations.items[0].frames; f[1].imageSpriteId = f[0].imageSpriteId; }) },
  { row: "23", title: "image file missing for a frame",
    apply: (d) => rm(path.join(d, "images/sprite-animation 1-000.png")) },
  { row: "24", title: "layer `name` duplicated in a layout",
    apply: (d) => editJson(d, L2, (l) => { l.layers.push({ ...l.layers[0], instances: [], sid: 111111111111111 }); }) },
  { row: "25", title: "object type name duplicated (two files)",
    apply: (d) => editJson(d, "objectTypes/TiledBackground.json", (t) => { t.name = "Text"; }) },
  { row: "26a", title: "key order changed (Layout 1 top level reversed)",
    apply: (d) => editJson(d, L1, (l) => Object.fromEntries(Object.entries(l).reverse())) },
  { row: "26b", title: "tabs → 2 spaces (Layout 1)",
    apply: async (d) => { const f = path.join(d, L1); await writeFile(f, JSON.stringify(JSON.parse(await readFile(f, "utf8")), null, 2)); } },
  { row: "26c", title: "LF → CRLF (Layout 1)",
    apply: async (d) => { const f = path.join(d, L1); await writeFile(f, (await readFile(f, "utf8")).replace(/\n/g, "\r\n")); } },
  { row: "27a", title: "unknown extra key at top level (Layout 1)",
    apply: (d) => editJson(d, L1, (l) => { l.c3mergeExtra = { note: "unknown" }; }) },
  { row: "27b", title: "unknown extra key inside an event",
    apply: (d) => editJson(d, ES2, (s) => { findEvent(s.events, (e) => e.eventType === "block")!.c3mergeExtra = true; }) },
  { row: "28", title: "required key missing (instance `world`)",
    apply: (d) => editJson(d, L1, (l) => { delete inst(l, "Sprite").world; }) },
  { row: "29", title: "tilemap tile data truncated",
    apply: (d) => editJson(d, L2, (l) => { const t = inst(l, "Tilemap").ownData.tilemapData; t.data = t.data.slice(0, Math.floor(t.data.length / 2)); }) },
  { row: "30", title: "timeline references deleted instance uid",
    needs: async (d) => (await readJson(d, "timelines/Timeline 1.json")).tracks.length ? null : "a timeline track animating an instance",
    apply: (d) => editJson(d, "timelines/Timeline 1.json", (t) => { for (const k of ["instanceUid", "instance-uid", "uid"]) if (t.tracks[0][k] !== undefined) t.tracks[0][k] = 999999; }) },
  { row: "31", title: "hierarchy child references missing uid",
    needs: has(L1, /"children"|"hierarchy"|"sceneGraph"/i, "a hierarchy (e.g. TiledBackground as a child of Sprite)"),
    apply: async () => { throw new Error("not written yet: needs a real hierarchy to learn its shape"); } },
  { row: "32", title: "global variable name duplicated",
    needs: has(ES1, /"eventType":\s*"variable"/, "a global variable in Event sheet 1"),
    apply: (d) => editJson(d, ES1, (s) => { const v = s.events.find((e: Json) => e.eventType === "variable"); s.events.push({ ...v, sid: 222222222222222 }); }) },
  { row: "33", title: "event with 0 conditions + 0 actions (empty block)",
    apply: (d) => editJson(d, ES1, (s) => { s.events.push({ eventType: "block", conditions: [], actions: [], sid: 333333333333333 }); }) },
  { row: "34", title: "two effects with same name on one type",
    needs: async (d) => (await readJson(d, "objectTypes/Sprite.json")).effectTypes.length ? null : "an effect on Sprite (e.g. Grayscale)",
    apply: (d) => editJson(d, "objectTypes/Sprite.json", (t) => { t.effectTypes.push({ ...t.effectTypes[0] }); }) },
];
