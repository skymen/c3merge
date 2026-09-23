// Load a C3 project (folder or .c3p) as plain data: every file by path, JSON parsed, and
// the c3proj folder trees resolved to file paths. No editor involved.
import yauzl from "yauzl";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Kinds whose items the c3proj lists in a folder tree, stored as <kind>/<subfolders…>/<name>.json.
export const LISTED_KINDS = ["objectTypes", "families", "layouts", "eventSheets", "timelines", "flowcharts"] as const;
export type ListedKind = (typeof LISTED_KINDS)[number];

export interface ProjectFile { rel: string; json?: any; parseError?: string }
export interface Listed { kind: ListedKind; name: string; rel: string }

export interface Project {
  source: string;
  // Every file in the project by relative path ("/" separators). JSON files are parsed.
  files: Map<string, ProjectFile>;
  c3proj: any;
  listed: Listed[];
  // Parsed items of a listed kind that exist on disk.
  items(kind: ListedKind): { name: string; rel: string; json: any }[];
}

const isJson = (rel: string) => /\.(json|c3proj)$/i.test(rel);

export async function loadProject(source: string): Promise<Project> {
  const raw = (await stat(source)).isDirectory() ? await readFolder(source) : await readZip(source);
  const files = new Map<string, ProjectFile>();
  for (const [rel, buf] of raw) {
    const f: ProjectFile = { rel };
    if (isJson(rel) && buf) {
      try { f.json = JSON.parse(buf.toString("utf8")); } catch (e) { f.parseError = (e as Error).message; }
    }
    files.set(rel, f);
  }
  const c3proj = files.get("project.c3proj")?.json;
  if (!c3proj) throw new Error(`${source}: no readable project.c3proj`);

  const listed: Listed[] = [];
  for (const kind of LISTED_KINDS) {
    const walk = (folder: any, dirs: (string | null)[]) => {
      for (const name of folder?.items ?? []) listed.push({ kind, name, rel: resolveListed(files, kind, dirs, name) });
      // Special folders have no name in the c3proj (timeline transitions live in
      // timelines/transitions/): null = "whatever the disk calls it".
      for (const sub of folder?.subfolders ?? []) walk(sub, [...dirs, sub.name ?? null]);
    };
    walk(c3proj[kind], []);
  }
  return {
    source, files, c3proj, listed,
    items: (kind) => listed.filter((l) => l.kind === kind && files.get(l.rel)?.json)
      .map((l) => ({ name: l.name, rel: l.rel, json: files.get(l.rel)!.json })),
  };
}

// <kind>/<subfolders…>/<name>.json. An unnamed subfolder matches any single directory
// that holds the file, so special folders work without knowing their disk names.
function resolveListed(files: Map<string, ProjectFile>, kind: string, dirs: (string | null)[], name: string): string {
  if (!dirs.includes(null)) return [kind, ...dirs, `${name}.json`].join("/");
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${[kind, ...dirs.map((d) => (d === null ? "[^/]+" : esc(d))), esc(`${name}.json`)].join("/")}$`);
  return [...files.keys()].find((rel) => re.test(rel)) ?? [kind, ...dirs.map((d) => d ?? "?"), `${name}.json`].join("/");
}

// Only JSON contents are kept; other files just need to exist (images, addons, audio).
async function readFolder(root: string): Promise<Map<string, Buffer | null>> {
  const out = new Map<string, Buffer | null>();
  for (const e of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    out.set(rel, isJson(rel) ? await readFile(abs) : null);
  }
  return out;
}

// .c3p is a zip; C3 on Windows writes backslash separators.
function readZip(file: string): Promise<Map<string, Buffer | null>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer | null>();
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip!.on("error", reject);
      zip!.on("end", () => resolve(out));
      zip!.on("entry", (entry: yauzl.Entry) => {
        const rel = entry.fileName.replace(/\\/g, "/");
        if (rel.endsWith("/")) return zip!.readEntry();
        if (!isJson(rel)) { out.set(rel, null); return zip!.readEntry(); }
        zip!.openReadStream(entry, async (e2, stream) => {
          if (e2) return reject(e2);
          const chunks: Buffer[] = [];
          for await (const c of stream!) chunks.push(c as Buffer);
          out.set(rel, Buffer.concat(chunks));
          zip!.readEntry();
        });
      });
      zip!.readEntry();
    });
  });
}
