// The driver inside real git operations: merge, rebase, cherry-pick, in throwaway repos
// with the driver installed --local (the user's ~/.gitconfig is never touched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { init, install } from "../src/driver.ts";

const ROOT = path.join(import.meta.dirname, "..");
const LAB = path.join(ROOT, "fixtures", "lab-base");
const CLI = path.join(ROOT, "src", "cli.ts");
const TSX = import.meta.resolve("tsx");
const COMMAND = `'${process.execPath}' --import '${TSX}' '${CLI}' merge-driver %O %A %B %P`;
const c3 = (v: unknown) => JSON.stringify(v, null, "\t");

// A repo with lab-base committed on main, the driver installed locally.
function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "c3merge-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const run = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  const cwd = process.cwd();
  process.chdir(dir);
  try { install({ local: true, command: COMMAND }); } finally { process.chdir(cwd); }
  init(dir);
  cpSync(LAB, path.join(dir, "game"), { recursive: true, filter: (p) => !p.endsWith(".uistate.json") });
  git("add", "-A");
  git("commit", "-qm", "base");
  const file = (rel: string) => path.join(dir, "game", rel);
  const edit = (rel: string, fn: (v: any) => void) => {
    const v = JSON.parse(readFileSync(file(rel), "utf8")); fn(v); writeFileSync(file(rel), c3(v));
  };
  const commit = (msg: string) => { git("add", "-A"); git("commit", "-qm", msg); };
  return { dir, git, run, file, edit, commit, read: (rel: string) => readFileSync(file(rel), "utf8"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Two branches that each create an object type: the conflict git can't merge by itself.
function branchesAddingObjects(r: ReturnType<typeof repo>) {
  r.git("checkout", "-qb", "feature");
  r.edit("project.c3proj", (v) => v.objectTypes.items.push("Door"));
  r.commit("add Door");
  r.git("checkout", "-q", "main");
  r.edit("project.c3proj", (v) => v.objectTypes.items.push("Player", "Enemy"));
  r.commit("add Player, Enemy");
}

test("merge: both branches create object types → merged, no conflict", () => {
  const r = repo();
  try {
    branchesAddingObjects(r);
    const m = r.run("merge", "--no-edit", "feature");
    assert.equal(m.status, 0, m.stdout + m.stderr);
    assert.deepEqual(JSON.parse(r.read("project.c3proj")).objectTypes.items.slice(-3), ["Player", "Enemy", "Door"]);
    assert.ok(!r.read("project.c3proj").endsWith("\n"), "still C3's format");
    // Without the driver, git itself conflicts on this.
    r.git("reset", "-q", "--hard", "HEAD~1");
    r.git("config", "--local", "--unset", "merge.c3.driver");
    assert.notEqual(r.run("merge", "--no-edit", "feature").status, 0, "git alone conflicts");
  } finally { r.cleanup(); }
});

test("merge: same layer property changed differently → conflict markers, path unmerged, log", () => {
  const r = repo();
  try {
    r.git("checkout", "-qb", "feature");
    r.edit("layouts/Layout 1.json", (v) => { v.layers[0].parallaxX = 80; });
    r.commit("80");
    r.git("checkout", "-q", "main");
    r.edit("layouts/Layout 1.json", (v) => { v.layers[0].parallaxX = 50; v.width = 1234; });
    r.commit("50");
    const m = r.run("merge", "--no-edit", "feature");
    assert.notEqual(m.status, 0);
    assert.match(m.stdout + m.stderr, /c3merge: game\/layouts\/Layout 1\.json: 1 conflict/);
    assert.match(r.git("ls-files", "-u"), /Layout 1\.json/);
    const text = r.read("layouts/Layout 1.json");
    assert.match(text, /<<<<<<< ours\n\t\t\t"parallaxX": 50,\n=======\n\t\t\t"parallaxX": 80,\n>>>>>>> theirs/);
    assert.match(text, /"width": 1234/, "the clean part is merged");
    const log = readFileSync(path.join(r.dir, ".git", "c3merge", "conflicts.md"), "utf8");
    assert.match(log, /layers\[Layer 0\]\.parallaxX: changed on both sides/);
  } finally { r.cleanup(); }
});

test("rebase and cherry-pick go through the driver too", () => {
  for (const op of ["rebase", "cherry-pick"]) {
    const r = repo();
    try {
      branchesAddingObjects(r);
      const res = op === "rebase" ? (r.git("checkout", "-q", "feature"), r.run("rebase", "main")) : r.run("cherry-pick", "feature");
      assert.equal(res.status, 0, `${op}: ${res.stdout}${res.stderr}`);
      const items = JSON.parse(r.read("project.c3proj")).objectTypes.items;
      assert.ok(["Player", "Enemy", "Door"].every((n) => items.includes(n)), `${op}: ${items}`);
    } finally { r.cleanup(); }
  }
});

// Rename an object type the way C3 does: its file and name, and every reference.
function renameType(r: ReturnType<typeof repo>, from: string, to: string) {
  const fix = (v: any): any => {
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === "object") {
      for (const [k, e] of Object.entries(v)) v[k] = (k === "type" || k === "objectClass") && e === from ? to : fix(e);
      return v;
    }
    return v;
  };
  for (const rel of ["layouts/Layout 1.json", "layouts/Layout 2.json", "eventSheets/Event sheet 1.json", "eventSheets/Event sheet 2.json"]) r.edit(rel, fix);
  r.edit("families/Family1.json", (v) => { v.members = v.members.map((m: string) => (m === from ? to : m)); });
  r.edit("project.c3proj", (v) => { v.objectTypes.items = v.objectTypes.items.map((m: string) => (m === from ? to : m)); });
  r.edit(`objectTypes/${from}.json`, (v) => { v.name = to; });
  r.git("mv", `game/objectTypes/${from}.json`, `game/objectTypes/${to}.json`);
}

test("merge and rebase: an object type renamed on one side reaches the other side's new instances", () => {
  for (const op of ["merge", "rebase"]) {
    const r = repo();
    try {
      r.git("checkout", "-qb", "feature");
      r.edit("layouts/Layout 1.json", (v) => {
        const i = structuredClone(v.layers[0].instances[0]);
        Object.assign(i, { uid: 50, sid: 100000000000050 }); v.layers[0].instances.push(i);
      });
      r.commit("new Sprite instance");
      r.git("checkout", "-q", "main");
      renameType(r, "Sprite", "Hero");
      r.commit("rename Sprite to Hero");
      const res = op === "merge" ? r.run("merge", "--no-edit", "feature") : (r.git("checkout", "-q", "feature"), r.run("rebase", "main"));
      assert.equal(res.status, 0, `${op}: ${res.stdout}${res.stderr}`);
      const types = JSON.parse(r.read("layouts/Layout 1.json")).layers[0].instances.map((i: any) => `${i.type}#${i.uid}`);
      assert.ok(types.includes("Hero#50") && !types.some((t: string) => t.startsWith("Sprite")), `${op}: ${types}`);
    } finally { r.cleanup(); }
  }
});

test("JSON under files/: git's merge when it works, structural when git conflicts", () => {
  const r = repo();
  try {
    const i18n = path.join(r.dir, "game", "files", "i18n.json");
    mkdirSync(path.dirname(i18n), { recursive: true });
    writeFileSync(i18n, JSON.stringify({ hello: "Hello", bye: "Bye" }, null, 2) + "\n");
    r.commit("i18n");
    r.git("checkout", "-qb", "feature");
    writeFileSync(i18n, JSON.stringify({ hello: "Hello", bye: "Bye", yes: "Yes" }, null, 2) + "\n");
    r.commit("yes");
    r.git("checkout", "-q", "main");
    writeFileSync(i18n, JSON.stringify({ hello: "Hello", bye: "Bye", no: "No" }, null, 2) + "\n");
    r.commit("no");
    const m = r.run("merge", "--no-edit", "feature");
    assert.equal(m.status, 0, m.stdout + m.stderr);
    assert.equal(readFileSync(i18n, "utf8"), JSON.stringify({ hello: "Hello", bye: "Bye", no: "No", yes: "Yes" }, null, 2) + "\n", "file's own style kept");
  } finally { r.cleanup(); }
});

test("a side that isn't valid JSON: git's own text merge", () => {
  const r = repo();
  try {
    r.git("checkout", "-qb", "feature");
    writeFileSync(r.file("layouts/Layout 2.json"), r.read("layouts/Layout 2.json").replace('"name": "Layout 2"', '"name": "Layout 2",,'));
    r.commit("broken");
    r.git("checkout", "-q", "main");
    r.edit("layouts/Layout 2.json", (v) => { v.width = 1234; });
    r.commit("width");
    const m = r.run("merge", "--no-edit", "feature");
    assert.match(m.stderr + m.stdout, /not valid JSON/);
    assert.ok(existsSync(r.file("layouts/Layout 2.json")));
  } finally { r.cleanup(); }
});

