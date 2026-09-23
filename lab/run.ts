// Lab runner: apply each corruption to a copy of fixtures/lab-base, open it in the real
// editor through c3cli, preview it, save it, and classify what C3 did.
//
//   npm run lab -- [--releases stable,beta] [--rows 1,2,26a] [--tabs 3] [--seconds 3]
//
// Output: lab/out/<stamp>/ (inputs, saved copies, raw JSON; gitignored) and
// reports/lab-matrix.md (the table, committed).
import { C3Editor, resolveRelease } from "c3cli";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { corruptions, type Corruption } from "./corruptions.ts";

const { values: args } = parseArgs({
  options: {
    releases: { type: "string", default: "stable,beta" },
    rows: { type: "string" },
    tabs: { type: "string", default: "3" },
    seconds: { type: "string", default: "3" },
  },
});

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = path.join(ROOT, "fixtures/lab-base");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join(ROOT, "lab/out", stamp);

type EditorVerdict = "loads, keeps it" | "loads, drops content" | "repairs silently" | "loads with notice" | "refuses" | "crashes" | "skipped" | "error";

interface RowResult {
  row: string;
  title: string;
  release: string;
  editor: EditorVerdict;
  // Lang keys or ids of dialogs the editor showed.
  dialogs: string[];
  // Files whose saved content differs from the saved control (the corruption survived there).
  survivedIn: string[];
  // Files the control's Save as wrote but this row's didn't: content C3 silently dropped.
  dropped: string[];
  // Whether the corruption is still in C3's Save as output (null: row has no check).
  present: boolean | null;
  preview: string;
  // Why it refused: the editor's own exception (the dialog is usually generic).
  cause: string;
  detail: string;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, base)));
    else out.push(path.relative(base, p));
  }
  return out;
}

// Files that differ between two saved projects, ignoring UI state (not project content).
async function differingFiles(a: string, b: string): Promise<string[]> {
  const content = (f: string) => !/uistate|instancesBar/.test(f);
  const [fa, fb] = [(await listFiles(a)).filter(content), (await listFiles(b)).filter(content)];
  const all = [...new Set([...fa, ...fb])].sort();
  const out: string[] = [];
  for (const f of all) {
    const [x, y] = await Promise.all([readFile(path.join(a, f)).catch(() => null), readFile(path.join(b, f)).catch(() => null)]);
    if (!x || !y || !x.equals(y)) out.push(f);
  }
  return out;
}

async function runOne(editor: C3Editor, release: string, c: Corruption | null, controlSaved: string | null): Promise<RowResult & { savedDir: string | null }> {
  const row = c?.row ?? "control";
  const dir = path.join(OUT, release, row);
  const input = path.join(dir, "input");
  const saved = path.join(dir, "saved");
  const r: RowResult & { savedDir: string | null } = {
    row, title: c?.title ?? "untouched base project", release, editor: "error", dialogs: [], survivedIn: [], dropped: [], present: null, preview: "n/a", cause: "", detail: "", savedDir: null,
  };
  await cp(BASE, input, { recursive: true });
  if (c) {
    const missing = await c.needs?.(input);
    if (missing) return { ...r, editor: "skipped", detail: `base project needs ${missing}` };
    try { await c.apply(input); } catch (e) { return { ...r, detail: `could not apply: ${(e as Error).message}` }; }
  }

  const project = await editor.open(input, { release, timeoutMs: 60_000 });
  try {
    const rep = project.report;
    r.dialogs = rep.dialogs.map((d) => d.langKey ?? d.id);
    const firstDialog = rep.dialogs[0] ? `${rep.dialogs[0].title}: ${rep.dialogs[0].body.replace(/\s+/g, " ").slice(0, 160)}` : "";
    if (rep.outcome !== "opened") {
      r.editor = ["crashed", "timeout", "editor-error"].includes(rep.outcome) ? "crashes" : "refuses";
      // The dialog is often generic ("Failed to open project"); the reason is in the console.
      const cause = [...rep.pageErrors, ...rep.consoleErrors, ...rep.log.filter((l) => /error|exception|fail|invalid|missing/i.test(l))]
        .map((e) => e.split("\n")[0]).filter((e) => !/Failed to load resource|No available adapters/.test(e));
      r.cause = (cause[0] ?? "").replace(/^\[Project\] Exception opening:\s*/, "").slice(0, 160);
      r.detail = `${rep.outcome}${firstDialog ? ` — ${firstDialog}` : ""}${rep.error ? ` — ${rep.error}` : ""}${cause.length ? ` — cause: ${cause.slice(0, 2).join(" / ").slice(0, 300)}` : ""}`;
      return r;
    }
    const pv = await project.runPreview({ seconds: Number(args.seconds) });
    const errors = [...pv.pageErrors, ...pv.consoleErrors];
    r.preview = !pv.started ? `doesn't start: ${pv.error}` : errors.length ? `runs, ${errors.length} error(s): ${errors[0].split("\n")[0].slice(0, 120)}` : "ok";
    // Save as (every file from the editor's memory), not Ctrl+S (only files C3 considers
    // changed): shows what C3 really holds after loading the corrupted project.
    const s = await project.saveAs(saved);
    if (!s.ok) { r.detail = `save failed: ${s.error}`; return r; }
    r.savedDir = saved;
    if (controlSaved) {
      r.survivedIn = await differingFiles(saved, controlSaved);
      const have = new Set(await listFiles(saved));
      r.dropped = (await listFiles(controlSaved)).filter((f) => !have.has(f) && !/uistate|instancesBar/.test(f));
    }
    r.present = c?.present ? await c.present(saved).catch(() => null) : null;
    // Prefer the row's own presence check; fall back to "differs from the control".
    const kept = r.present ?? r.survivedIn.length > 0;
    r.editor = rep.dialogs.length ? "loads with notice"
      : r.dropped.length ? "loads, drops content"
      : c && !kept ? "repairs silently" : "loads, keeps it";
    r.detail = [firstDialog, rep.pageErrors.length ? `${rep.pageErrors.length} editor page error(s)` : ""].filter(Boolean).join(" — ");
    return r;
  } finally {
    await project.close();
  }
}

// Run `fn` over `items` with at most `n` in flight.
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const wanted = args.rows?.split(",").map((s) => s.trim());
const rows = corruptions.filter((c) => !wanted || wanted.includes(c.row));
const tabs = Number(args.tabs);
const results: RowResult[] = [];

const editor = await C3Editor.launch({ tabs });
try {
  for (const branchOrRelease of args.releases!.split(",")) {
    const rel = /^r\d/.test(branchOrRelease)
      ? await resolveRelease({ release: branchOrRelease })
      : await resolveRelease({ branch: branchOrRelease as "stable" | "beta" | "lts" });
    const label = `${branchOrRelease} (${rel.name})`;
    console.log(`\n== ${label}: control`);
    const control = await runOne(editor, rel.name, null, null);
    console.log(`   control: ${control.editor}${control.detail ? ` — ${control.detail}` : ""}, preview ${control.preview}`);
    if (!control.savedDir) { console.log("   control did not save; skipping this release"); continue; }
    results.push(control);
    const t0 = Date.now();
    const rowResults = await pool(rows, tabs, async (c) => {
      const r = await runOne(editor, rel.name, c, control.savedDir).catch((e) => ({ row: c.row, title: c.title, release: rel.name, editor: "error" as const, dialogs: [], survivedIn: [], dropped: [], present: null, preview: "n/a", cause: "", detail: (e as Error).message.split("\n")[0], savedDir: null }));
      console.log(`   ${r.row.padEnd(4)} ${r.editor.padEnd(20)} present: ${String(r.present).padEnd(5)} preview: ${r.preview.slice(0, 40)}`);
      return r;
    });
    results.push(...rowResults);
    console.log(`   ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} finally {
  await editor.close();
}

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, "\t"));
await writeMatrix(results);
console.log(`\nraw results: ${path.relative(ROOT, OUT)}/results.json\ntable: reports/lab-matrix.md`);

async function writeMatrix(results: RowResult[]) {
  const releases = [...new Set(results.map((r) => r.release))];
  const byRow = new Map<string, RowResult[]>();
  for (const r of results) byRow.set(r.row, [...(byRow.get(r.row) ?? []), r]);
  const cell = (r?: RowResult) => {
    if (!r) return "";
    if (r.editor === "skipped") return "skipped";
    const bits = [`**${r.editor}**`];
    if (r.cause) bits.push(r.cause.replace(/\|/g, "/"));
    else if (r.dialogs.length) bits.push(r.dialogs.map((d) => `\`${d}\``).join(", "));
    if (r.dropped.length) bits.push(`dropped ${r.dropped.map((f) => `\`${f}\``).join(", ")}`);
    else if (r.present === null && r.survivedIn.length && r.row !== "control") bits.push(`differs in ${r.survivedIn.map((f) => `\`${f}\``).join(", ")} (no presence check)`);
    return bits.join("<br>");
  };
  const lines = [
    "# Lab matrix: what does C3 tolerate?",
    "",
    `Generated by \`npm run lab\` on ${new Date().toISOString().slice(0, 10)} from \`fixtures/lab-base\`. Raw output: \`lab/out/${stamp}/\`.`,
    "Method and row list: [tasks/lab-experiments.md](../tasks/lab-experiments.md).",
    "",
    "- **loads, keeps it**: opens with no dialog, and \"Save as project folder\" (which writes every file from memory) still contains the corruption (each row checks for its own corruption).",
    "- **loads, drops content**: opens with no dialog, but Save as no longer writes some of the project (listed): silent data loss.",
    "- **repairs silently**: opens with no dialog, and the corruption is gone from the Save as output (C3 may repair differently from the original, e.g. renumber UIDs).",
    "- **loads with notice**: opens, but shows a dialog (listed).",
    "- **refuses** / **crashes**: does not open. The dialog is almost always the generic \"Failed to open project\"; the cell shows the editor's own exception from the console.",
    "- Plain Ctrl+S only rewrites files C3 considers changed (on both releases), so a corruption in an untouched file stays on disk until C3 touches it. That's why this lab uses Save as.",
    "",
    `| # | Corruption | ${releases.map((r) => `Editor ${r} | Preview ${r}`).join(" | ")} |`,
    `|---|---|${releases.map(() => "---|---").join("|")}|`,
  ];
  for (const [row, rs] of byRow) {
    const cols = releases.map((rel) => { const r = rs.find((x) => x.release === rel); return `${cell(r)} | ${r?.editor === "skipped" ? "" : r?.preview ?? ""}`; });
    lines.push(`| ${row} | ${rs[0].title.replace(/\|/g, "/")} | ${cols.join(" | ")} |`);
  }
  const skipped = results.filter((r) => r.editor === "skipped" || r.editor === "error");
  if (skipped.length) {
    lines.push("", "## Not run", "");
    for (const r of skipped.filter((r, i, a) => a.findIndex((x) => x.row === r.row) === i)) lines.push(`- ${r.row}: ${r.detail}`);
  }
  const details = results.filter((r) => r.detail && r.editor !== "skipped");
  if (details.length) {
    lines.push("", "## Details", "");
    for (const r of details) lines.push(`- ${r.row} (${r.release}): ${r.detail.replace(/\n/g, " ")}`);
  }
  await mkdir(path.join(ROOT, "reports"), { recursive: true });
  await writeFile(path.join(ROOT, "reports/lab-matrix.md"), lines.join("\n") + "\n");
  // Machine-readable twin, keyed by row and release: what `check` severities are derived
  // from, so a new C3 release means re-running the lab, not editing code.
  const data = results.filter((r) => r.row !== "control").map(({ row, title, release, editor, present, dropped, preview, cause }) =>
    ({ row, title, release, editor, present, dropped, previewStarts: !preview.startsWith("doesn't start"), previewErrors: preview.startsWith("runs,"), cause }));
  await writeFile(path.join(ROOT, "reports/lab-matrix.json"), JSON.stringify(data, null, "\t"));
}
