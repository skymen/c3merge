// Refuses to publish while a dependency points at a local folder (c3cli must be on npm
// first, then referenced by version).
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const local = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, v]) => v.startsWith("file:"));
if (local.length) {
  console.error(`not publishing: ${local.map(([k, v]) => `${k} is ${v}`).join(", ")}. Publish it to npm first and depend on its version.`);
  process.exit(1);
}
