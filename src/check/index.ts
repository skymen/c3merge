// `c3merge check`: load a project and report broken invariants, rated by the lab.
import { loadProject } from "../model/project.ts";
import { invariants, type Finding } from "./invariants.ts";
import { severityOf, type Severity } from "./severity.ts";

export interface RatedFinding extends Finding { severity: Severity }

export interface CheckResult {
  source: string;
  findings: RatedFinding[];
  counts: Record<Severity, number>;
}

export async function checkProject(source: string, opts: { all?: boolean } = {}): Promise<CheckResult> {
  const p = await loadProject(source);
  const findings: RatedFinding[] = [];
  for (const inv of invariants) {
    const { severity } = severityOf(inv);
    // "none" = C3 repairs it by itself; only reported with --all.
    if (severity === "none" && !opts.all) continue;
    for (const f of inv.check(p)) findings.push({ ...f, severity });
  }
  const order: Severity[] = ["error", "warning", "info", "none"];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.file.localeCompare(b.file));
  const counts = { error: 0, warning: 0, info: 0, none: 0 };
  for (const f of findings) counts[f.severity]++;
  return { source, findings, counts };
}

export { invariants, severityOf };
