// Cross-file invariants of a C3 project. Each one is defined by what it means (a dangling
// reference, a duplicate id…), never by release, and names the lab rows that measured
// what C3 does when it's broken; severity comes from that data (severity.ts).
import type { Project } from "../model/project.ts";

export interface Finding { invariant: string; file: string; message: string }

export interface Invariant {
  id: string;
  title: string;
  // Rows of tasks/lab-experiments.md that measured this invariant.
  labRows: string[];
  check(p: Project): Finding[];
}

type Json = any;

// ---------- helpers over the project model ----------

const allEvents = (events: Json[] | undefined): Json[] => (events ?? []).flatMap((e) => [e, ...allEvents(e.children)]);
const acesOf = (e: Json): Json[] => [...(e.conditions ?? []), ...(e.actions ?? [])];

function layers(layout: Json): Json[] {
  const walk = (ls: Json[]): Json[] => (ls ?? []).flatMap((l) => [l, ...walk(l.subLayers)]);
  return walk(layout.layers);
}

function instances(p: Project): { file: string; layout: string; inst: Json }[] {
  return p.items("layouts").flatMap((l) => layers(l.json).flatMap((layer) =>
    (layer.instances ?? []).map((inst: Json) => ({ file: l.rel, layout: l.name, inst }))));
}

// Global variables are the ones at a sheet's top level. Variables inside a group are scoped
// to that group (the same name in two groups is fine: seen in the corpus).
function globalVariables(sheet: Json): Json[] {
  return (sheet.events ?? []).filter((e: Json) => e.eventType === "variable");
}

function duplicates<T>(xs: T[]): Set<T> {
  const seen = new Set<T>(), dup = new Set<T>();
  for (const x of xs) (seen.has(x) ? dup : seen).add(x);
  return dup;
}

// Families a type belongs to, for variables/effects/behaviors inherited from a family.
function familiesOf(p: Project, typeName: string): Json[] {
  return p.items("families").map((f) => f.json).filter((f) => (f.members ?? []).includes(typeName));
}

// Tilemap data is run-length encoded: "67x0,13,3x23" = 67 zeros, 13, three 23s.
export function tileCount(data: string): number {
  let n = 0;
  for (const run of data.split(",")) {
    if (run === "") continue;
    const m = /^(?:(\d+)x)?(-?\d+)$/.exec(run);
    if (!m) return NaN;
    n += m[1] ? Number(m[1]) : 1;
  }
  return n;
}

// ---------- the invariants ----------

export const invariants: Invariant[] = [
  {
    id: "json-parse", title: "every JSON file parses", labRows: [],
    check: (p) => [...p.files.values()].filter((f) => f.parseError)
      .map((f) => ({ invariant: "json-parse", file: f.rel, message: `not valid JSON: ${f.parseError}` })),
  },
  {
    id: "listed-file-missing", title: "every item the c3proj lists has its file", labRows: ["7"],
    check: (p) => p.listed.filter((l) => !p.files.has(l.rel))
      .map((l) => ({ invariant: "listed-file-missing", file: "project.c3proj", message: `${l.kind} "${l.name}" is listed but ${l.rel} doesn't exist` })),
  },
  {
    id: "unlisted-file", title: "every item file is listed in the c3proj", labRows: ["8"],
    check: (p) => {
      const listed = new Set(p.listed.map((l) => l.rel));
      return [...p.files.keys()]
        .filter((rel) => /^(objectTypes|families|layouts|eventSheets|timelines|flowcharts)\/.+\.json$/.test(rel) && !/\.uistate\.json$|\/uistate\//.test(rel) && !listed.has(rel))
        .map((rel) => ({ invariant: "unlisted-file", file: rel, message: "not listed in project.c3proj: C3 ignores it, and saving the project drops it" }));
    },
  },
  {
    id: "instance-type-exists", title: "every instance's type exists", labRows: ["1"],
    check: (p) => {
      const types = new Set(p.items("objectTypes").map((t) => t.json.name));
      return instances(p).filter(({ inst }) => !types.has(inst.type))
        .map(({ file, inst }) => ({ invariant: "instance-type-exists", file, message: `instance uid ${inst.uid} has type "${inst.type}", which doesn't exist` }));
    },
  },
  {
    id: "instance-uid-unique", title: "instance uids are unique project-wide", labRows: ["2", "3"],
    check: (p) => {
      const all = instances(p);
      const dup = duplicates(all.map(({ inst }) => inst.uid));
      return all.filter(({ inst }) => dup.has(inst.uid))
        .map(({ file, inst }) => ({ invariant: "instance-uid-unique", file, message: `uid ${inst.uid} (${inst.type}) is used more than once` }));
    },
  },
  {
    id: "instance-world-present", title: "every layout instance has world data", labRows: ["28"],
    check: (p) => instances(p).filter(({ inst }) => !inst.world)
      .map(({ file, inst }) => ({ invariant: "instance-world-present", file, message: `instance uid ${inst.uid} (${inst.type}) has no "world" data` })),
  },
  {
    id: "event-sid-unique", title: "event sids are unique project-wide", labRows: ["4"],
    check: (p) => {
      const all = p.items("eventSheets").flatMap((s) => allEvents(s.json.events).filter((e) => e.sid !== undefined).map((e) => ({ file: s.rel, sid: e.sid })));
      const dup = duplicates(all.map((x) => x.sid));
      return all.filter((x) => dup.has(x.sid)).map((x) => ({ invariant: "event-sid-unique", file: x.file, message: `event sid ${x.sid} is used more than once` }));
    },
  },
  {
    id: "event-sid-present", title: "every event block has a sid", labRows: ["5"],
    check: (p) => p.items("eventSheets").flatMap((s) => allEvents(s.json.events)
      .filter((e) => ["block", "function-block", "group"].includes(e.eventType) && e.sid === undefined)
      .map(() => ({ invariant: "event-sid-present", file: s.rel, message: "an event has no sid" }))),
  },
  {
    id: "object-type-sid-unique", title: "object type and family sids are unique", labRows: ["6"],
    check: (p) => {
      const all = [...p.items("objectTypes"), ...p.items("families")].map((t) => ({ file: t.rel, name: t.json.name, sid: t.json.sid }));
      const dup = duplicates(all.map((t) => t.sid));
      return all.filter((t) => dup.has(t.sid)).map((t) => ({ invariant: "object-type-sid-unique", file: t.file, message: `"${t.name}" shares sid ${t.sid} with another type or family` }));
    },
  },
  {
    id: "object-type-name-unique", title: "object type and family names are unique", labRows: ["25"],
    check: (p) => {
      const all = [...p.items("objectTypes"), ...p.items("families")].map((t) => ({ file: t.rel, name: t.json.name }));
      const dup = duplicates(all.map((t) => t.name));
      return all.filter((t) => dup.has(t.name)).map((t) => ({ invariant: "object-type-name-unique", file: t.file, message: `name "${t.name}" is used by more than one type or family` }));
    },
  },
  {
    id: "include-exists", title: "event sheet includes point to existing sheets", labRows: ["9"],
    check: (p) => {
      const sheets = new Set(p.items("eventSheets").map((s) => s.json.name ?? s.name));
      return p.items("eventSheets").flatMap((s) => allEvents(s.json.events)
        .filter((e) => e.eventType === "include" && !sheets.has(e.includeSheet))
        .map((e) => ({ invariant: "include-exists", file: s.rel, message: `includes "${e.includeSheet}", which doesn't exist` })));
    },
  },
  {
    id: "object-class-exists", title: "conditions and actions use existing object types", labRows: ["10"],
    check: (p) => {
      // Built-in objects that aren't project types: the only two across the 47-project corpus.
      const known = new Set(["System", "Functions", ...p.items("objectTypes").map((t) => t.json.name), ...p.items("families").map((f) => f.json.name)]);
      return p.items("eventSheets").flatMap((s) => allEvents(s.json.events).flatMap(acesOf)
        .filter((a) => a.objectClass !== undefined && !known.has(a.objectClass))
        .map((a) => ({ invariant: "object-class-exists", file: s.rel, message: `${a.id ?? "an ACE"} uses object "${a.objectClass}", which doesn't exist` })));
    },
  },
  {
    id: "function-exists", title: "function calls point to existing functions", labRows: ["13"],
    check: (p) => {
      const fns = new Set(p.items("eventSheets").flatMap((s) => allEvents(s.json.events).filter((e) => e.eventType === "function-block").map((e) => e.functionName)));
      return p.items("eventSheets").flatMap((s) => allEvents(s.json.events).flatMap(acesOf)
        .filter((a) => a.callFunction !== undefined && !fns.has(a.callFunction))
        .map((a) => ({ invariant: "function-exists", file: s.rel, message: `calls function "${a.callFunction}", which doesn't exist` })));
    },
  },
  {
    id: "layer-param-exists", title: "layer names in action parameters exist", labRows: ["12"],
    check: (p) => {
      const names = new Set(p.items("layouts").flatMap((l) => layers(l.json).map((x) => x.name)));
      // Only literal names ("\"Layer 0\""); numbers and expressions can't be checked statically.
      return p.items("eventSheets").flatMap((s) => allEvents(s.json.events).flatMap(acesOf).flatMap((a) => {
        const v = a.parameters?.layer;
        const m = typeof v === "string" ? /^"((?:[^"\\]|\\.)*)"$/.exec(v) : null;
        return m && !names.has(m[1]) ? [{ invariant: "layer-param-exists", file: s.rel, message: `${a.id ?? "an action"} refers to layer "${m[1]}", which no layout has` }] : [];
      }));
    },
  },
  {
    id: "instance-vars-declared", title: "instances only have variables their type (or family) declares", labRows: ["14"],
    check: (p) => {
      const declared = new Map(p.items("objectTypes").map((t) => [t.json.name, new Set([
        ...(t.json.instanceVariables ?? []).map((v: Json) => v.name),
        ...familiesOf(p, t.json.name).flatMap((f) => (f.instanceVariables ?? []).map((v: Json) => v.name)),
      ])]));
      return instances(p).flatMap(({ file, inst }) => Object.keys(inst.instanceVariables ?? {})
        .filter((v) => declared.has(inst.type) && !declared.get(inst.type)!.has(v))
        .map((v) => ({ invariant: "instance-vars-declared", file, message: `instance uid ${inst.uid} (${inst.type}) has variable "${v}", which its type doesn't declare` })));
    },
  },
  {
    id: "instance-vars-complete", title: "instances have every variable their type declares", labRows: ["15"],
    check: (p) => {
      const declared = new Map(p.items("objectTypes").map((t) => [t.json.name, (t.json.instanceVariables ?? []).map((v: Json) => v.name)]));
      return instances(p).flatMap(({ file, inst }) => (declared.get(inst.type) ?? [])
        .filter((v: string) => !(v in (inst.instanceVariables ?? {})))
        .map((v: string) => ({ invariant: "instance-vars-complete", file, message: `instance uid ${inst.uid} (${inst.type}) lacks variable "${v}"` })));
    },
  },
  {
    id: "family-members-exist", title: "family members are existing types", labRows: ["16"],
    check: (p) => {
      const types = new Set(p.items("objectTypes").map((t) => t.json.name));
      return p.items("families").flatMap((f) => (f.json.members ?? []).filter((m: string) => !types.has(m))
        .map((m: string) => ({ invariant: "family-members-exist", file: f.rel, message: `member "${m}" doesn't exist` })));
    },
  },
  {
    id: "family-same-plugin", title: "family members all use the family's plugin", labRows: ["17"],
    check: (p) => {
      const plugin = new Map(p.items("objectTypes").map((t) => [t.json.name, t.json["plugin-id"]]));
      return p.items("families").flatMap((f) => (f.json.members ?? [])
        .filter((m: string) => plugin.has(m) && plugin.get(m) !== f.json["plugin-id"])
        .map((m: string) => ({ invariant: "family-same-plugin", file: f.rel, message: `member "${m}" is a ${plugin.get(m)}, but the family is ${f.json["plugin-id"]}` })));
    },
  },
  {
    id: "bundled-addon-file", title: "bundled addons have their .c3addon in the project", labRows: ["19"],
    check: (p) => (p.c3proj.usedAddons ?? []).filter((a: Json) => a.bundled && !p.files.has(`addons/${a.type}/${a.id}.c3addon`))
      .map((a: Json) => ({ invariant: "bundled-addon-file", file: "project.c3proj", message: `${a.type} "${a.id}" is marked bundled, but addons/${a.type}/${a.id}.c3addon is missing` })),
  },
  {
    id: "image-id-unique", title: "animation frame image ids are unique", labRows: ["22"],
    check: (p) => {
      const all = p.items("objectTypes").flatMap((t) => (t.json.animations?.items ?? []).flatMap((a: Json) => (a.frames ?? [])
        .map((f: Json) => ({ file: t.rel, type: t.json.name, id: f.imageSpriteId }))));
      const dup = duplicates(all.map((x) => x.id));
      return all.filter((x) => dup.has(x.id)).map((x) => ({ invariant: "image-id-unique", file: x.file, message: `${x.type}: frame image id ${x.id} is used more than once` }));
    },
  },
  {
    id: "frame-image-exists", title: "every animation frame has its image file", labRows: ["23"],
    check: (p) => p.items("objectTypes").flatMap((t) => (t.json.animations?.items ?? []).flatMap((a: Json) => (a.frames ?? []).flatMap((f: Json, i: number) => {
      // images/<type>-<animation>-<NNN>.<ext>, lowercase (all 1,228 frames of the corpus).
      const ext = String(f.fileType ?? "image/png").split("/")[1].replace("jpeg", "jpg");
      const rel = `images/${t.json.name.toLowerCase()}-${a.name.toLowerCase()}-${String(i).padStart(3, "0")}.${ext}`;
      return p.files.has(rel) ? [] : [{ invariant: "frame-image-exists", file: t.rel, message: `${t.json.name} "${a.name}" frame ${i}: ${rel} is missing` }];
    }))),
  },
  {
    id: "layer-name-unique", title: "layer names are unique within a layout", labRows: ["24"],
    check: (p) => p.items("layouts").flatMap((l) => [...duplicates(layers(l.json).map((x) => x.name))]
      .map((n) => ({ invariant: "layer-name-unique", file: l.rel, message: `layer name "${n}" is used more than once` }))),
  },
  {
    id: "tilemap-data-size", title: "tilemap data matches the tilemap's size", labRows: ["29"],
    check: (p) => instances(p).flatMap(({ file, inst }) => {
      const t = inst.ownData?.tilemapData;
      if (!t || typeof t.data !== "string") return [];
      const n = tileCount(t.data);
      return n === t.width * t.height ? [] : [{ invariant: "tilemap-data-size", file, message: `tilemap uid ${inst.uid}: data has ${Number.isNaN(n) ? "malformed runs" : `${n} tiles`}, expected ${t.width}×${t.height} = ${t.width * t.height}` }];
    }),
  },
  {
    id: "timeline-instance-exists", title: "timeline tracks point to existing instances", labRows: ["30"],
    check: (p) => {
      const uids = new Set(instances(p).map(({ inst }) => inst.uid));
      const found: Finding[] = [];
      const walk = (o: Json, file: string) => {
        if (!o || typeof o !== "object") return;
        if (typeof o.worldInstance === "number" && !uids.has(o.worldInstance))
          found.push({ invariant: "timeline-instance-exists", file, message: `a track animates instance uid ${o.worldInstance}, which doesn't exist` });
        for (const v of Object.values(o)) walk(v, file);
      };
      for (const t of p.items("timelines")) walk(t.json, t.rel);
      return found;
    },
  },
  {
    id: "hierarchy-links", title: "hierarchy parent/child links point to existing instances", labRows: ["31", "31b"],
    check: (p) => {
      const all = instances(p);
      const uids = new Set(all.map(({ inst }) => inst.uid));
      return all.flatMap(({ file, inst }) => {
        const g = inst.sceneGraphData;
        if (!g) return [];
        const bad = [
          ...(g["parent-uid"] != null && !uids.has(g["parent-uid"]) ? [`parent uid ${g["parent-uid"]}`] : []),
          ...(g.children ?? []).filter((c: Json) => !uids.has(c.uid)).map((c: Json) => `child uid ${c.uid}`),
        ];
        return bad.map((b) => ({ invariant: "hierarchy-links", file, message: `instance uid ${inst.uid}: ${b} doesn't exist` }));
      });
    },
  },
  {
    id: "global-var-unique", title: "global variable names are unique", labRows: ["32"],
    check: (p) => {
      const all = p.items("eventSheets").flatMap((s) => globalVariables(s.json).map((v) => ({ file: s.rel, name: v.name })));
      const dup = duplicates(all.map((v) => v.name));
      return all.filter((v) => dup.has(v.name)).map((v) => ({ invariant: "global-var-unique", file: v.file, message: `global variable "${v.name}" is declared more than once` }));
    },
  },
  {
    id: "effect-name-unique", title: "effect names are unique per type, family, layer and layout", labRows: ["34"],
    check: (p) => {
      const owners: { file: string; what: string; effects: Json[] }[] = [
        ...[...p.items("objectTypes"), ...p.items("families")].map((t) => ({ file: t.rel, what: t.json.name, effects: t.json.effectTypes ?? [] })),
        ...p.items("layouts").flatMap((l) => [
          { file: l.rel, what: `layout ${l.name}`, effects: l.json.effectTypes ?? [] },
          ...layers(l.json).map((x) => ({ file: l.rel, what: `layer ${x.name}`, effects: x.effectTypes ?? [] })),
        ]),
      ];
      return owners.flatMap((o) => [...duplicates(o.effects.map((e: Json) => e.name))]
        .map((n) => ({ invariant: "effect-name-unique", file: o.file, message: `${o.what}: effect name "${n}" is used more than once` })));
    },
  },
  {
    id: "empty-event", title: "events have at least one condition or action", labRows: ["33"],
    check: (p) => p.items("eventSheets").flatMap((s) => allEvents(s.json.events)
      .filter((e) => e.eventType === "block" && !e.conditions?.length && !e.actions?.length && !e.children?.length)
      .map(() => ({ invariant: "empty-event", file: s.rel, message: "an event has no conditions, actions or sub-events" }))),
  },
];
