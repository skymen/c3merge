// The finish step: right after a merge (or rebase) writes its result, before anything is
// committed, replay renames in every file. Git only calls the driver for files both sides
// changed, so a file only one side changed may still use a name the other side renamed
// (85c85d2a: new instances of TiledShapeDark next to its rename to woodPlanksShape).
// Renames = sids whose name changed between the common ancestor and the files on disk.
// Fixes are left uncommitted, for review in C3; then `check` runs.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkProject } from "./check/index.ts";
import { readEvents, readEventsFromDisk, readTypes, readTypesFromDisk } from "./context.ts";
import { applyRenameSet, resultRenames } from "./engine/renames.ts";
import { detectStyle, render } from "./engine/render.ts";
import { profileFor } from "./profiles/index.ts";

export interface FinishReport {
  project: string;
  renames: string[];
  fixed: string[];                                    // files rewritten (uncommitted)
  unsure: { file: string; where: string; expr: string; reason: string }[];
  conflicted: string[];                               // not touched: still has conflict markers
  images: string[];                                   // image files renamed after their type (uncommitted)
  check?: { errors: number; warnings: number };
}

const git = (args: string[], cwd = ".") => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 }).trim();

// The merge's common ancestor, from what's in progress or just done.
export function mergeBase(after: "merge" | "rebase" | "manual"): string {
  const gitDir = git(["rev-parse", "--absolute-git-dir"]);
  if (after === "rebase") return git(["merge-base", "ORIG_HEAD", "HEAD"]);
  const theirs = Object.keys(process.env).find((k) => /^GITHEAD_[0-9a-f]{40,64}$/.test(k))?.slice("GITHEAD_".length)
    ?? (existsSync(path.join(gitDir, "MERGE_HEAD")) ? readFileSync(path.join(gitDir, "MERGE_HEAD"), "utf8").trim().split("\n")[0] : undefined);
  if (theirs) return git(["merge-base", "HEAD", theirs]);
  const parents = git(["rev-list", "--parents", "-n1", "HEAD"]).split(" ").slice(1);
  if (parents.length === 2) return git(["merge-base", parents[0], parents[1]]);
  throw new Error("no merge in progress, and HEAD isn't a merge commit");
}

export function finish(after: "merge" | "rebase" | "manual"): FinishReport[] {
  const top = git(["rev-parse", "--show-toplevel"]);
  const base = mergeBase(after);
  const roots = git(["ls-files", "--", "*.c3proj"], top).split("\n").filter(Boolean).map((f) => path.posix.dirname(f));
  return [...new Set(roots)].map((root) => finishProject(top, root, base));
}

function finishProject(top: string, root: string, base: string): FinishReport {
  const dir = path.join(top, root);
  const set = resultRenames(readTypes(top, base, root), readTypesFromDisk(dir), readEvents(top, base, root), readEventsFromDisk(dir));
  const ev = set.events;
  const report: FinishReport = {
    project: root, fixed: [], unsure: [], conflicted: [], images: [],
    renames: [
      ...Object.entries(set.objects.types).map(([a, b]) => `${a} → ${b}`),
      ...set.objects.members.map((m) => `${[...m.owner][0]}.${m.old} → ${m.new}${m.kind === "behavior" ? " (behavior)" : ""}`),
      ...Object.entries(ev.globals).map(([a, b]) => `${a} → ${b} (global variable)`),
      ...ev.locals.map((l) => `${l.old} → ${l.new} (local variable)`),
      ...ev.params.map((l) => `${l.old} → ${l.new} (parameter)`),
      ...Object.entries(ev.functions).map(([a, b]) => `${a} → ${b} (function)`),
      ...ev.customs.map((c) => `${c.owner}.${c.old} → ${c.new} (custom action)`),
      ...ev.signatures.map((g) => `${g.name}(${g.params.map((p) => p.name).join(", ")}) (parameters)`),
    ],
  };
  if (report.renames.length) renameImages(dir, set.objects.types, report);
  if (report.renames.length) {
    for (const rel of c3Files(dir)) {
      const file = path.join(dir, rel);
      const text = readFileSync(file, "utf8");
      if (/^<<<<<<< /m.test(text)) { report.conflicted.push(rel); continue; }
      let v: unknown;
      try { v = JSON.parse(text); } catch { continue; }
      const before = JSON.stringify(v);
      applyRenameSet(profileFor(rel).kind, v, set, (where, expr, reason) => report.unsure.push({ file: rel, where, expr, reason }));
      if (JSON.stringify(v) === before) continue;
      writeFileSync(file, render(v, detectStyle(text)));
      report.fixed.push(rel);
    }
  }
  return report;
}

// C3 names images after their object type, lowercase: `<type>-<animation>-<NNN>.<ext>` for
// frames, `<type>.<ext>` for single-image objects. Git follows images the renaming side
// renamed (with the other side's pixel edits); new frames the other side added keep the
// old prefix and C3 can't find them. Rename those (never over an existing file).
function renameImages(dir: string, types: Record<string, string>, report: FinishReport) {
  const images = path.join(dir, "images");
  if (!existsSync(images)) return;
  const renames = new Map(Object.entries(types).filter(([a, b]) => a.toLowerCase() !== b.toLowerCase()).map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]));
  for (const e of readdirSync(images, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const m = /^([^-.]+)([-.].*)$/.exec(e.name);
    const to = m && renames.get(m[1].toLowerCase());
    if (!to) continue;
    const from = path.join(e.parentPath, e.name), target = path.join(e.parentPath, to + m![2]);
    const rel = (f: string) => path.relative(dir, f).split(path.sep).join("/");
    if (existsSync(target)) { report.unsure.push({ file: rel(from), where: "image", expr: rel(target), reason: "both the old and the new name exist" }); continue; }
    renameSync(from, target);
    report.images.push(`${rel(from)} → ${rel(target)}`);
  }
}

// The C3 files renames can reach: the project file, event sheets, layouts, families.
function c3Files(dir: string): string[] {
  const out = readdirSync(dir).filter((f) => f.endsWith(".c3proj"));
  for (const sub of ["eventSheets", "layouts", "families"]) {
    const abs = path.join(dir, sub);
    if (!existsSync(abs)) continue;
    for (const e of readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".uistate.json")) out.push(path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
    }
  }
  return out;
}

export async function finishWithCheck(after: "merge" | "rebase" | "manual"): Promise<FinishReport[]> {
  const reports = finish(after);
  const top = git(["rev-parse", "--show-toplevel"]);
  for (const r of reports) {
    const c = await checkProject(path.join(top, r.project)).catch(() => null);
    if (c) r.check = { errors: c.counts.error, warnings: c.counts.warning };
  }
  return reports;
}

export function describe(reports: FinishReport[]): string[] {
  const lines: string[] = [];
  for (const r of reports) {
    const where = r.project === "." ? "" : ` (${r.project})`;
    if (r.fixed.length) lines.push(`c3merge${where}: applied ${r.renames.join(", ")} to ${r.fixed.length} file(s) the merge didn't reach; not committed, check them in C3:`, ...r.fixed.map((f) => `  ${f}`));
    if (r.images.length) lines.push(`c3merge${where}: renamed ${r.images.length} image file(s) after their object (new frames from the other side):`, ...r.images.map((f) => `  ${f}`));
    for (const u of r.unsure) lines.push(`c3merge${where}: not sure how to rename in ${u.file}, ${u.where}: ${u.expr} (${u.reason}); fix it in C3`);
    if (r.conflicted.length && r.renames.length) lines.push(`c3merge${where}: ${r.conflicted.length} conflicted file(s) not checked for renames yet: run \`c3merge finish\` again after resolving them`);
    if (r.check) lines.push(`c3merge${where}: check: ${r.check.errors} error(s), ${r.check.warnings} warning(s)${r.check.errors ? " (run `c3merge check` for details)" : ""}`);
  }
  return lines;
}
