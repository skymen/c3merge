// Severity of each invariant, derived from the lab's measurements (lab-matrix.json, written
// by `npm run lab`): what C3 does when the invariant is broken, worst across the measured
// releases, because a team's project has to open in whichever release each member runs.
import lab from "./lab-matrix.json" with { type: "json" };
import type { Invariant } from "./invariants.ts";

export type Severity = "error" | "warning" | "info" | "none";

interface LabRow { row: string; release: string; editor: string; previewStarts: boolean; previewErrors: boolean }

const RANK: Record<Severity, number> = { none: 0, info: 1, warning: 2, error: 3 };

// Not measurable by corrupting a project, or measured as harmless but still worth a word.
const FIXED: Record<string, { severity: Severity; why: string }> = {
  "json-parse": { severity: "error", why: "C3 can't read a file that isn't JSON" },
  "empty-event": { severity: "info", why: "C3 keeps it and it runs; it's just clutter" },
  // The lab measured "keeps it" (warning), but real projects create layers at runtime
  // (e.g. "letterbox", "fade"), so a name no layout has is usually intended.
  "layer-param-exists": { severity: "info", why: "layers can be created at runtime; 48 hits in real projects were all intended" },
};

export function verdictSeverity(r: LabRow): Severity {
  if (r.editor === "refuses" || r.editor === "crashes" || r.editor === "loads, drops content" || !r.previewStarts) return "error";
  if (r.editor === "loads, keeps it" || r.editor === "loads with notice") return "warning";
  if (r.editor === "repairs silently") return "none";
  return "warning";
}

export interface Rated { severity: Severity; basis: string }

export function severityOf(inv: Invariant, data: LabRow[] = lab as LabRow[]): Rated {
  const fixed = FIXED[inv.id];
  if (fixed) return { severity: fixed.severity, basis: fixed.why };
  const rows = data.filter((r) => inv.labRows.includes(r.row));
  // Not measured yet: say something, but don't block.
  if (!rows.length) return { severity: "warning", basis: "not measured by the lab yet" };
  const worst = rows.reduce((a, r) => (RANK[verdictSeverity(r)] > RANK[verdictSeverity(a)] ? r : a));
  const sev = verdictSeverity(worst);
  const releases = [...new Set(rows.map((r) => r.release))].join(", ");
  return { severity: sev, basis: `lab row ${worst.row} on ${worst.release}: ${worst.editor}${worst.previewStarts ? "" : ", preview doesn't start"} (measured on ${releases})` };
}
