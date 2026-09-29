// Write a merged value back as text in the file's own style (C3: tabs, "\n", no final
// newline). Conflicts become git-style marker hunks around whole members or elements,
// placed so that taking either side of any hunk leaves valid JSON.
import { ABSENT, Conflict, Run, type Json } from "./merge.ts";

export interface Style { indent: string; eol: string; finalEol: boolean; compact: boolean }

export function detectStyle(text: string): Style {
  return {
    compact: !text.includes("\n"),
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    indent: /\n([ \t]+)\S/.exec(text)?.[1] ?? "\t",
    finalEol: text.endsWith("\n"),
  };
}

export const MARKER = { ours: "<<<<<<< ours", sep: "=======", theirs: ">>>>>>> theirs" };

export function render(v: unknown, style: Style): string {
  const end = style.finalEol ? style.eol : "";
  if (!hasConflict(v)) {
    const text = style.compact ? JSON.stringify(v) : JSON.stringify(v, null, style.indent);
    return text.split("\n").join(style.eol) + end;
  }
  // Conflicts are rendered expanded, even in a compact file: the file is getting fixed anyway.
  const [lo, lt] = markers(v instanceof Conflict ? v.labels : undefined);
  const lines = v instanceof Conflict
    ? [lo, ...side(v.ours, style, 0), MARKER.sep, ...side(v.theirs, style, 0), lt]
    : valueLines(v, style, 0, "", "");
  return lines.join(style.eol) + end;
}

const side = (v: Json | typeof ABSENT, style: Style, depth: number) => (v === ABSENT ? [] : valueLines(v, style, depth, "", ""));

function hasConflict(v: unknown): boolean {
  if (v instanceof Conflict || v instanceof Run) return true;
  if (Array.isArray(v)) return v.some(hasConflict);
  if (v && typeof v === "object") return Object.values(v).some(hasConflict);
  return false;
}

const markers = (labels?: [string, string]) => (labels ? [`<<<<<<< ${labels[0]}`, `>>>>>>> ${labels[1]}`] : [MARKER.ours, MARKER.theirs]);

interface Entry { key?: string; value: unknown }
interface Hunk { ours: Entry[]; theirs: Entry[]; labels?: [string, string] }
type Item = Entry | Hunk;
const isHunk = (i: Item): i is Hunk => "ours" in i;
const oneSided = (i: Item) => isHunk(i) && (i.ours.length === 0) !== (i.theirs.length === 0);
// Hunks with different labels made into one: each side's labels, joined.
function joinLabels(hunks: Hunk[]): [string, string] | undefined {
  if (hunks.every((h) => String(h.labels) === String(hunks[0].labels))) return hunks[0].labels;
  const side = (i: 0 | 1) => [...new Set(hunks.map((h) => (h.labels ?? [MARKER.ours.slice(8), MARKER.theirs.slice(8)])[i]))].join(" + ");
  return [side(0), side(1)];
}

function valueLines(v: unknown, style: Style, depth: number, prefix: string, suffix: string): string[] {
  const pad = style.indent.repeat(depth);
  if (!hasConflict(v)) {
    const text = JSON.stringify(v, null, style.indent).split("\n").join(`\n${pad}`);
    return `${pad}${prefix}${text}${suffix}`.split("\n");
  }
  const isArray = Array.isArray(v);
  const items: Item[] = [];
  const push = (i: Item) => {
    const last = items.at(-1);
    if (last && isHunk(last) && isHunk(i) && String(last.labels) === String(i.labels)) { last.ours = last.ours.concat(i.ours); last.theirs = last.theirs.concat(i.theirs); }
    else items.push(i);
  };
  if (isArray) {
    for (const e of v as unknown[]) push(e instanceof Run ? { ours: e.ours.map((value) => ({ value })), theirs: e.theirs.map((value) => ({ value })), labels: e.labels } : { value: e });
  } else {
    for (const [key, e] of Object.entries(v as object)) {
      push(e instanceof Conflict
        ? { ours: e.ours === ABSENT ? [] : [{ key, value: e.ours }], theirs: e.theirs === ABSENT ? [] : [{ key, value: e.theirs }], labels: e.labels }
        : { key, value: e });
    }
  }
  // A hunk at the end where one side is empty: the comma of whatever comes before it depends
  // on the side taken. Hunks right before it (other labels) join it, and if the result still
  // has an empty side, the item before it goes into the hunk too.
  if (oneSided(items.at(-1)!)) {
    let k = items.length - 1;
    while (k > 0 && isHunk(items[k - 1])) k--;
    if (k < items.length - 1) {
      const trail = items.splice(k) as Hunk[];
      items.push({ ours: trail.flatMap((h) => h.ours), theirs: trail.flatMap((h) => h.theirs), labels: joinLabels(trail) });
    }
    const last = items.at(-1) as Hunk;
    if (oneSided(last) && items.length > 1 && !isHunk(items.at(-2)!)) {
      const prev = items.splice(-2, 1)[0] as Entry;
      last.ours.unshift(prev); last.theirs.unshift(prev);
    }
  }
  const entry = (e: Entry, comma: boolean) =>
    valueLines(e.value, style, depth + 1, e.key === undefined ? "" : `${JSON.stringify(e.key)}: `, comma ? "," : "");
  const out = [`${pad}${prefix}${isArray ? "[" : "{"}`];
  items.forEach((item, i) => {
    const more = i < items.length - 1;
    const add = (lines: string[]) => { for (const l of lines) out.push(l); };
    if (!isHunk(item)) { add(entry(item, more)); return; }
    const sideLines = (es: Entry[]) => es.forEach((e, j) => add(entry(e, j < es.length - 1 || more)));
    const [lo, lt] = markers(item.labels);
    out.push(lo); sideLines(item.ours); out.push(MARKER.sep); sideLines(item.theirs); out.push(lt);
  });
  out.push(`${pad}${isArray ? "]" : "}"}${suffix}`);
  return out;
}

// `c3merge resolve`: one side at every plain ours/theirs hunk; hunks with other labels
// ("renamed (check)", "fix in C3", "keep both…") are kept as they are, for a person. A diff3
// base section (||||||| …, git's own merge with merge.conflictStyle=diff3) is dropped. Hunks
// may nest. Line endings and the final newline stay as they were.
export function resolveBranches(text: string, which: "ours" | "theirs"): { text: string; resolved: number; left: string[] } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [], left: string[] = [];
  const stack: { branch: boolean; part: "ours" | "base" | "theirs"; label: string }[] = [];
  let resolved = 0;
  // A line inside the stack shows when every branch hunk around it is on the side taken.
  const shown = (depth = stack.length) => stack.slice(0, depth).every((f) => !f.branch || f.part === which);
  for (const line of text.split(/\r?\n/)) {
    const top = stack.at(-1);
    if (line.startsWith("<<<<<<< ")) {
      const label = line.slice(8);
      stack.push({ branch: label === "ours", part: "ours", label });
      if (label !== "ours" && shown(stack.length - 1)) out.push(line);
    } else if (top && (line === MARKER.sep || line.startsWith("|||||||"))) {
      if (!top.branch && shown(stack.length - 1)) out.push(line);
      top.part = line === MARKER.sep ? "theirs" : "base";
    } else if (top && line.startsWith(">>>>>>> ")) {
      stack.pop();
      if (top.branch) resolved++;
      else if (shown()) { out.push(line); left.push(`${top.label} / ${line.slice(8)}`); }
    } else if (shown()) out.push(line);
  }
  return { text: out.join(eol), resolved, left };
}

// Resolve every hunk to one side, whatever its labels (tests).
export function takeSide(text: string, which: "ours" | "theirs"): string {
  const out: string[] = [];
  let state: "none" | "ours" | "theirs" = "none";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("<<<<<<< ")) state = "ours";
    else if (line === MARKER.sep && state !== "none") state = "theirs";
    else if (line.startsWith(">>>>>>> ") && state !== "none") state = "none";
    else if (state === "none" || state === which) out.push(line);
  }
  return out.join("\n");
}
