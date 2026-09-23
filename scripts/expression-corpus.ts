// Every expression parameter in real projects must tokenize and print back byte for byte.
// Failures are listed: each one is an expression renames would leave alone and flag.
//   tsx scripts/expression-corpus.ts <project dir | dir of projects>...
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../src/model/project.ts";
import { print, tokenize } from "../src/engine/expressions.ts";

async function projectsIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  if (entries.some((e) => e.endsWith(".c3proj"))) return [dir];
  const out: string[] = [];
  for (const e of entries) if ((await stat(path.join(dir, e))).isDirectory()) out.push(...(await projectsIn(path.join(dir, e)).catch(() => [])));
  return out;
}

// Every expression parameter of every action and condition in an event sheet.
export function* expressions(sheet: unknown): Generator<{ value: string; objectClass?: string }> {
  const stack: unknown[] = [sheet];
  while (stack.length) {
    const x = stack.pop();
    if (Array.isArray(x)) { stack.push(...x); continue; }
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, any>;
    const params = o.parameters;
    if (params && typeof params === "object") {
      for (const v of Array.isArray(params) ? params : Object.values(params)) if (typeof v === "string") yield { value: v, objectClass: o.objectClass };
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let total = 0, ok = 0;
  const failures = new Map<string, number>();
  for (const arg of process.argv.slice(2)) for (const dir of await projectsIn(arg)) {
    const p = await loadProject(dir).catch(() => null);
    if (!p) continue;
    for (const s of p.items("eventSheets")) for (const { value } of expressions(s.json)) {
      total++;
      const t = tokenize(value);
      if (t && print(t) === value) ok++;
      else failures.set(value, (failures.get(value) ?? 0) + 1);
    }
  }
  console.log(`${total} expression parameters, ${ok} read back exactly, ${total - ok} not (${failures.size} distinct)`);
  for (const [v, n] of [...failures].slice(0, 30)) console.log(`  ${n}× ${JSON.stringify(v).slice(0, 160)}`);
}
