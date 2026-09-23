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
type Item = Entry | { ours: Entry[]; theirs: Entry[]; labels?: [string, string] };
const isHunk = (i: Item): i is { ours: Entry[]; theirs: Entry[] } => "ours" in i;

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
  // A hunk at the end where one side is empty: the comma of the item before it depends on
  // the side taken, so that item goes into the hunk too.
  const last = items.at(-1)!;
  if (isHunk(last) && (last.ours.length === 0) !== (last.theirs.length === 0) && items.length > 1 && !isHunk(items.at(-2)!)) {
    const prev = items.splice(-2, 1)[0] as Entry;
    last.ours.unshift(prev); last.theirs.unshift(prev);
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

// Resolve every hunk to one side (tests, and `c3merge resolve` later).
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
