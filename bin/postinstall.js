// After `npm install -g @skymen75/c3merge`: set up the merge driver in the global git config, like
// `c3merge install`. Local installs (a dependency, a development checkout) and npx are left
// alone. Never fails the install.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.npm_config_global === "true") {
  const cli = fileURLToPath(new URL("./c3merge.js", import.meta.url));
  if (!existsSync(fileURLToPath(new URL("../dist/cli.js", import.meta.url)))) {
    console.log("c3merge: not built yet: run `npm run build`, then `c3merge install`");
  } else {
    const r = spawnSync(process.execPath, [cli, "install"], { stdio: "inherit" });
    if (r.status !== 0) console.log("c3merge: couldn't set up git: run `c3merge install` yourself");
  }
}
