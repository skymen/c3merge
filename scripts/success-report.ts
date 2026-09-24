// c3merge vs git on a project's real merges (data from scripts/extract-triples.ts), with the
// project context the driver builds. Per file and per merge: who conflicts; for what c3merge
// doesn't settle, how many conflicts and of what kind; for what it settles, what git's
// conflicts were about (by the JSON path where each git hunk starts).
//   tsx scripts/success-report.ts <repo> [fixtures/real/utrs] > report.json
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mergeFile } from "../src/engine/merge.ts";
import { buildContext } from "../src/context.ts";

const [repo, root = "fixtures/real/utrs"] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const read = (d: string, k: string) => (existsSync(path.join(d, `${k}.json`)) ? readFileSync(path.join(d, `${k}.json`), "utf8") : null);

// Git's line merge with conflict markers, like `git merge` (histogram).
function gitMerge(d: string): string {
  return spawnSync("git", ["merge-file", "-p", "--diff-algorithm=histogram", "-L", "ours", "-L", "base", "-L", "theirs", ...["ours", "base", "theirs"].map((k) => path.join(d, `${k}.json`))], { encoding: "utf8", maxBuffer: 1 << 30 }).stdout;
}

// The JSON path where each git hunk starts, from C3's one-token-per-line format.
function hunkPaths(text: string): string[] {
  const stack: string[] = [];
  const out: string[] = [];
  let inHunk = false;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("<<<<<<< ")) { out.push(stack.join(".")); inHunk = true; continue; }
    if (raw.startsWith(">>>>>>> ")) { inHunk = false; continue; }
    if (inHunk) continue; // only track the path through lines both sides agree on
    if (raw.startsWith("=======")) continue;
    const line = raw.trim();
    const key = /^"([^"]+)":\s*([[{])?/.exec(line);
    const opensBlock = key && key[2] && !/[\]}],?$/.test(line); // `"k": [` opens; `"k": []` doesn't
    if (opensBlock) stack.push(key![1] + (key![2] === "[" ? "[]" : ""));
    else if (!key && (line === "{" || line === "{,")) stack.push("{}");
    else if (!key && (line === "[" || line === "[,")) stack.push("[]");
    if (/^[}\]],?$/.test(line)) stack.pop();
  }
  return out;
}

// A readable kind for a hunk path.
function kind(file: string, p: string): string {
  const q = p.replace(/(^|\.)\{\}/g, "").replace(/^\./, "").replace(/(\.subLayers\[\])+/g, "").replace(/(\.children\[\])+/g, ".children[]");
  if (file.endsWith(".c3proj")) {
    if (/usedAddons/.test(q)) return "project: addons used";
    if (/rootFileFolders/.test(q)) return "project: files, sounds, fonts added";
    if (/^(objectTypes|families|layouts|eventSheets|timelines|flowcharts)(\.subfolders\[\])*(\.items\[\])?$/.test(q)) return "project: objects, layouts, sheets added to the project bar";
    return `project: ${q || "top level"}`;
  }
  if (file.startsWith("layouts")) {
    const m = /instances\[\](.*)$/.exec(q);
    if (m) {
      const rest = m[1];
      if (!rest) return "layout: instances added, removed or moved";
      if (/^\.template/.test(rest)) return "layout: instance template flags";
      if (/^\.instanceVariables/.test(rest)) return "layout: instance variables";
      if (/^\.world/.test(rest)) return "layout: instance position, size, angle";
      if (/^\.(behaviors|effects)/.test(rest)) return "layout: instance behaviors, effects";
      if (/^\.sceneGraphData/.test(rest)) return "layout: hierarchy links";
      if (/^\.(properties)/.test(rest)) return "layout: instance properties";
      if (/^\.instanceFolderItem/.test(rest)) return "layout: instance folder (editor)";
      return `layout: instance ${rest.slice(1).split(".")[0]}`;
    }
    if (/scene-graphs-folder-root|instanceFolder/.test(q)) return "layout: editor folders";
    if (/layers\[\]$/.test(q) || /^layers\[\]$/.test(q)) return "layout: layers";
    return `layout: ${q || "top level"}`;
  }
  if (file.startsWith("eventSheets")) {
    if (/(actions|conditions)\[\]/.test(q)) return "events: actions, conditions";
    if (/children\[\]$|^events\[\]$/.test(q)) return "events: events added, removed or moved";
    return `events: ${q || "top level"}`;
  }
  return `${file.split("/")[0]}: ${q || "top level"}`;
}

// A readable kind for a c3merge conflict.
function c3kind(c: { path: string; message: string }): string {
  if (/renamed on the other side|now takes/.test(c.message)) return "a rename or signature change that can't be applied for sure";
  if (/moved to a different layer|moved to another layer|moved to a new layer/.test(c.message)) return "an instance moved differently on each side";
  if (/deleted on/.test(c.message)) return /instances\[uid=/.test(c.path) ? "an instance deleted on one side, really edited on the other" : "something deleted on one side, edited on the other";
  if (/replaced/.test(c.message)) return "the same event element replaced on both sides";
  if (/same name|same scope/.test(c.message)) return "the same name created on both sides";
  if (/usedAddons/.test(c.path)) return "an addon version changed on both sides";
  if (/world\.(width|height|originX|originY)/.test(c.path)) return "an instance's size or origin changed on both sides";
  if (/world\.(x|y)/.test(c.path)) return "an instance moved to different spots";
  if (/sid$/.test(c.path) && /added on both/.test(c.message)) return "the same file created on both sides";
  if (/lines/.test(c.message)) return "the same script lines changed on both sides";
  return "a value changed on both sides";
}

const files: any[] = [];
for (const m of manifest) {
  const context = buildContext(repo, ".", { base: m.base, ours: m.ours, theirs: m.theirs });
  for (const f of m.files) {
    const d = path.join(root, m.merge, f.path);
    const [b, o, t] = ["base", "ours", "theirs"].map((k) => read(d, k));
    if (!o || !t) continue; // deleted on one side: git's modify/delete, the driver isn't called
    const gitText = b ? gitMerge(d) : null;
    const gitHunks = b ? hunkPaths(gitText!) : null;
    const gitConflicted = b ? gitHunks!.length > 0 : o !== t; // added on both: git conflicts unless identical
    const r = mergeFile(f.path, b, o, t, context);
    files.push({
      merge: m.merge, file: f.path, gitConflicted, gitHunks: gitHunks?.length ?? (gitConflicted ? 1 : 0),
      gitKinds: (gitHunks ?? []).map((p) => kind(f.path, p)),
      c3: r.conflicts.length, c3Kinds: r.conflicts.map(c3kind), warnings: r.warnings.length,
    });
  }
}
console.log(JSON.stringify({ merges: manifest.length, files }, null, 1));
