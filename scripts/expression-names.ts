// Generate src/engine/expression-names.json: the expression names of every built-in plugin
// (lowercase), from a C3 editor's language file. Only names (the documented scripting
// surface), used to spot instance variables named like one of their object's expressions,
// which a rename can't tell apart (`obj.z`: the variable z or the Z expression?).
//   tsx scripts/expression-names.ts <.../loader/lang/precompiled-en-US.json>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const lang = JSON.parse(readFileSync(process.argv[2], "utf8")).text.plugins as Record<string, { expressions?: Record<string, unknown> }>;
const out: Record<string, string[]> = {};
for (const [id, p] of Object.entries(lang)) {
  const names = Object.entries(p.expressions ?? {}).map(([id, e]) => String((e as any)?.["translated-name"] ?? id).toLowerCase()).sort();
  if (names.length) out[id] = names;
}
const file = path.join(import.meta.dirname, "..", "src", "engine", "expression-names.json");
writeFileSync(file, JSON.stringify(out, null, "\t"));
console.log(`${Object.keys(out).length} plugins, ${Object.values(out).flat().length} expression names → ${file}`);
