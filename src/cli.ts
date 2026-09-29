#!/usr/bin/env node
// c3merge: structural merge and validation for Construct 3 projects.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { checkProject, invariants, severityOf } from "./check/index.ts";
import { c3mergeCommand, doctor, HOOKS, init, install, installHooks, mergeDriver, runningFromNpx } from "./driver.ts";
import { resolveBranches } from "./engine/render.ts";
import { describe, finishWithCheck } from "./finish.ts";

const [command, ...rest] = process.argv.slice(2);

async function main(): Promise<number> {
  // Both write c3merge's own path into git config or hooks.
  if ((command === "install" || command === "init") && runningFromNpx()) {
    console.error(`c3merge ${command}: npx runs c3merge from a temporary cache that npm cleans up, and git would keep calling it there. Install it instead:\n  npm install -g @skymen75/c3merge`);
    return 2;
  }
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
  if (command === "merge-driver") {
    if (rest.length < 4) { console.error("usage: c3merge merge-driver %O %A %B %P  (called by git)"); return 2; }
    return mergeDriver(rest[0], rest[1], rest[2], rest[3]);
  }
  if (command === "install") {
    const { values } = parseArgs({ args: rest, options: { local: { type: "boolean" } } });
    const changed = install({ local: values.local });
    const where = values.local ? "this repository's .git/config" : "~/.gitconfig";
    console.log(changed.length ? `${where}:\n${changed.map((c) => `  added ${c}`).join("\n")}` : `${where}: already set up`);
    console.log("Each repository also needs the attributes: run `c3merge init` in it and commit .gitattributes.");
    return 0;
  }
  if (command === "init") {
    const root = execGitRoot();
    if (!root) { console.error("c3merge init: not inside a git repository"); return 2; }
    const r = init(root);
    console.log(r === "unchanged" ? ".gitattributes already has the c3merge block" : `.gitattributes ${r}: commit it so everyone gets the same merges`);
    const hooks = installHooks(root);
    if ("hooksPath" in hooks) {
      console.log(`hooks: this repo uses its own hooks folder (${hooks.hooksPath}), which c3merge doesn't write to. Add these to its hooks:`);
      for (const [hook, block] of Object.entries(HOOKS(c3mergeCommand()))) console.log(`\n# ${hook}\n${block}`);
    }
    else for (const h of hooks) if (h.result !== "unchanged") console.log(`.git/hooks/${h.hook} ${h.result}: renames reach every file after merges and rebases (this clone only)`);
    return 0;
  }
  if (command === "finish") {
    const { values } = parseArgs({ args: rest, options: { after: { type: "string", default: "manual" } } });
    const after = values.after as "merge" | "rebase" | "manual";
    const lines = describe(await finishWithCheck(after));
    for (const l of lines) (after === "manual" ? console.log : console.error)(l);
    if (after === "manual" && !lines.length) console.log("c3merge finish: no renames to replay");
    return 0;
  }
  if (command === "resolve") {
    // Take one side at every ours/theirs hunk of a conflicted file, keeping what merged
    // cleanly (unlike `git checkout --ours`). Not staged: the person looks, then `git add`.
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { ours: { type: "boolean" }, theirs: { type: "boolean" } } });
    if (!positionals.length || !!values.ours === !!values.theirs) { console.error("usage: c3merge resolve <file>... --ours | --theirs"); return 2; }
    const which = values.ours ? "ours" : "theirs";
    let gitDir: string | null = null;
    try { gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not in a repo */ }
    if (gitDir && ["rebase-merge", "rebase-apply"].some((d) => existsSync(path.join(gitDir!, d)))) {
      console.log("c3merge resolve: a rebase is in progress, so ours is the branch being rebased onto and theirs the commits being replayed");
    }
    let code = 0;
    for (const file of positionals) {
      const r = resolveBranches(readFileSync(file, "utf8"), which);
      if (!r.resolved && !r.left.length) { console.log(`${file}: no conflict markers`); continue; }
      if (!r.left.length && /\.(json|c3proj)$/i.test(file)) {
        try { JSON.parse(r.text); } catch (e) { console.error(`${file}: taking ${which} everywhere doesn't give valid JSON (${(e as Error).message}); left as it is`); code = 2; continue; }
      }
      writeFileSync(file, r.text);
      console.log(`${file}: took ${which} at ${r.resolved} conflict(s)` + (r.left.length
        ? `; ${r.left.length} left for you (${[...new Set(r.left)].join(", ")}): see .git/c3merge/conflicts.md`
        : "; `git add` it, then run `c3merge finish`"));
      if (r.left.length && code === 0) code = 1;
    }
    return code;
  }
  if (command === "doctor") {
    const lines = doctor();
    for (const l of lines) console.log(`${l.warn ? "!  " : l.ok ? "ok " : "!! "} ${l.text}${l.fix ? `\n     fix: ${l.fix}` : ""}`);
    return lines.every((l) => l.ok) ? 0 : 1;
  }
  if (command === "invariants") {
    for (const inv of invariants) {
      const s = severityOf(inv);
      console.log(`${s.severity.padEnd(7)} ${inv.id.padEnd(26)} ${inv.title}\n        ${s.basis}`);
    }
    return 0;
  }
  console.error([
    "usage: c3merge install [--local]      set up the merge driver in git config (once per machine)",
    "       c3merge init                   .gitattributes (committed) and hooks (this clone)",
    "       c3merge doctor                 check the setup",
    "       c3merge finish                 replay renames after a merge (hooks run it for you)",
    "       c3merge resolve <file>... --ours | --theirs   one side at every ours/theirs conflict, the rest kept",
    "       c3merge check <project> [--json | --github] [--all]",
    "       c3merge invariants",
    "       c3merge merge-driver %O %A %B %P   (called by git)",
  ].join("\n"));
  return 2;
}

function execGitRoot(): string | null {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(); } catch { return null; }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(`c3merge: ${(e as Error).message}`); process.exitCode = 2; });
