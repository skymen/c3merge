#!/usr/bin/env node
// c3merge: structural merge and validation for Construct 3 projects.
import { parseArgs } from "node:util";
import { checkProject, invariants, severityOf } from "./check/index.ts";

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<number> {
  if (command === "check") {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true,
      options: { json: { type: "boolean" }, github: { type: "boolean" }, all: { type: "boolean" } },
    });
    if (positionals.length !== 1) { console.error("usage: c3merge check <project folder or .c3p> [--json | --github] [--all]"); return 2; }
    const r = await checkProject(positionals[0], { all: values.all });
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else if (values.github) {
      // Workflow annotations: https://docs.github.com/actions/reference/workflow-commands-for-github-actions
      for (const f of r.findings) {
        const level = f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "notice";
        console.log(`::${level} file=${f.file},title=${f.invariant}::${f.message}`);
      }
    } else {
      for (const f of r.findings) console.log(`${f.severity.padEnd(7)} ${f.file}: ${f.message}  [${f.invariant}]`);
      const { error, warning, info } = r.counts;
      console.log(r.findings.length ? `\n${error} error(s), ${warning} warning(s), ${info} info` : "no problems found");
    }
    return r.counts.error ? 1 : 0;
  }
  if (command === "invariants") {
    for (const inv of invariants) {
      const s = severityOf(inv);
      console.log(`${s.severity.padEnd(7)} ${inv.id.padEnd(26)} ${inv.title}\n        ${s.basis}`);
    }
    return 0;
  }
  console.error("usage: c3merge check <project> [--json | --github] [--all]\n       c3merge invariants");
  return 2;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(`c3merge: ${(e as Error).message}`); process.exitCode = 2; });
