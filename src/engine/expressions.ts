// Construct expressions, just enough to rename what they reference: object types and
// families (`Sprite.X`, `Sprite(0).X`), instance variables (`Sprite.hp`, `Self.hp`) and
// behaviors (`Sprite.Bullet.Speed`). Never a guess: anything the tokenizer or the resolver
// isn't sure about makes the whole expression `uncertain`, and the caller leaves it as is
// and flags it (DESIGN.md "Engine": expressions).
//
// Syntax (C3 manual, and the operator table in the editor): strings in "" with "" as an
// escaped quote; numbers; names (any run of characters that aren't spaces or operators, so
// `3DShape` is a name); operators + - * / % ^ & | = <> < <= > >= ? : ( ) , .

export type Token = { kind: "space" | "string" | "number" | "name" | "op"; text: string };

const OPS = ["<>", "<=", ">=", "+", "-", "*", "/", "%", "^", "&", "|", "=", "<", ">", "?", ":", "(", ")", ",", "."];
// Characters that end a name. Anything else outside this set and spaces is part of a name,
// except these, which C3 doesn't allow in expressions at all: seeing one means we don't
// understand the expression.
const NOT_NAME = new Set([..."\"+-*/%^&|=<>?:(),. \t\r\n"]);
const UNKNOWN = new Set([..."[]{};'`!@#~$\\"]);

// Tokens whose texts join back to exactly `expr`, or null if it can't be tokenized.
export function tokenize(expr: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      let j = i; while (j < expr.length && /\s/.test(expr[j])) j++;
      out.push({ kind: "space", text: expr.slice(i, j) }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= expr.length) return null; // unclosed string
        if (expr[j] === '"') { if (expr[j + 1] === '"') { j += 2; continue; } break; }
        j++;
      }
      out.push({ kind: "string", text: expr.slice(i, j + 1) }); i = j + 1; continue;
    }
    // A number that starts with a dot (.5), when a dot can't be member access here.
    const prev = out.filter((t) => t.kind !== "space").at(-1);
    if (c === "." && /\d/.test(expr[i + 1] ?? "") && !(prev && (prev.kind === "name" || prev.text === ")"))) {
      const m = /^\.\d+/.exec(expr.slice(i))!;
      out.push({ kind: "number", text: m[0] }); i += m[0].length; continue;
    }
    const op = OPS.find((o) => expr.startsWith(o, i));
    if (op) { out.push({ kind: "op", text: op }); i += op.length; continue; }
    if (UNKNOWN.has(c)) return null;
    let j = i; while (j < expr.length && !NOT_NAME.has(expr[j]) && !UNKNOWN.has(expr[j])) j++;
    const word = expr.slice(i, j);
    // Digits with an optional fraction: a number (1, 1.5). Otherwise a name (3DShape, x2).
    const num = /^\d+$/.exec(word) && /^\.\d+/.exec(expr.slice(j));
    if (num) { out.push({ kind: "number", text: word + num[0] }); i = j + num[0].length; continue; }
    out.push({ kind: /^\d+$/.test(word) ? "number" : "name", text: word }); i = j;
  }
  return out;
}

export const print = (tokens: Token[]) => tokens.map((t) => t.text).join("");

// One rename to apply. `owner` names the object type or family that has the variable or
// behavior, in every form an expression may use for it (its names, the member types of a
// family); `selfClasses` are the objectClass values for which `Self` means that owner.
export interface MemberRename { kind: "var" | "behavior"; old: string; new: string; owner: Set<string>; selfClasses: Set<string> }
// `vars`: event variables in scope for this expression (bare names), `functions`: function
// renames (`Functions.name(...)`); both old → new.
export interface RenameSet { types: Record<string, string>; members: MemberRename[]; vars?: Record<string, string>; functions?: Record<string, string> }

export interface RenameResult { text: string; changed: boolean; uncertain: string | null }

// Rename references in one expression. `objectClass` is the object the action or condition
// belongs to (what `Self` means), undefined when there is none (System, function calls).
// How C3 resolves names (skymen): object and variable names ignore case. An object and an
// event variable may share a name (`text.text & text`: object, its variable, event variable),
// but neither may take a system expression's name (floor). An instance variable never shares
// a name with another value of its object. So: a name followed by a dot is an object (or
// Self); a name on its own is an event variable or a system expression (`pi`, `floor(...)`),
// never an object; `Obj.name(...)` is an expression of the object (never a variable);
// `Obj.name.X` is a behavior.
export function renameExpression(expr: string, objectClass: string | undefined, set: RenameSet): RenameResult {
  const same = (reason: string | null): RenameResult => ({ text: expr, changed: false, uncertain: reason });
  // A rename that only changes case needs nothing here: the old spelling still resolves (and
  // C3 leaves such expressions as they are). Structured references do get it.
  const types = new Map(Object.entries(set.types).filter(([a, b]) => a.toLowerCase() !== b.toLowerCase()).map(([a, b]) => [a.toLowerCase(), b]));
  const lowerSet = (s: Set<string>) => new Set([...s].map((x) => x.toLowerCase()));
  const members = set.members.filter((m) => m.old.toLowerCase() !== m.new.toLowerCase())
    .map((m) => ({ ...m, oldL: m.old.toLowerCase(), ownerL: lowerSet(m.owner), selfL: lowerSet(m.selfClasses) }));
  const byOld = (r: Record<string, string> | undefined) => new Map(Object.entries(r ?? {}).filter(([a, b]) => a.toLowerCase() !== b.toLowerCase()).map(([a, b]) => [a.toLowerCase(), b]));
  const vars = byOld(set.vars), functions = byOld(set.functions);
  // Cheap exit: none of the names occur at all (outside or inside strings).
  const low = expr.toLowerCase();
  if (![...types.keys(), ...members.map((m) => m.oldL), ...vars.keys(), ...functions.keys()].some((n) => low.includes(n))) return same(null);
  const tokens = tokenize(expr);
  if (!tokens) return same("can't read the expression");
  const sig = tokens.map((t, i) => ({ t, i })).filter((x) => x.t.kind !== "space");
  const at = (k: number) => sig[k]?.t;
  // Matching close parenthesis for the one at significant position k, or -1.
  const close = (k: number) => {
    let depth = 0;
    for (let j = k; j < sig.length; j++) {
      if (at(j)!.text === "(") depth++;
      else if (at(j)!.text === ")" && --depth === 0) return j;
    }
    return -1;
  };
  const cls = objectClass?.toLowerCase();
  const rewrite = new Map<number, string>(); // token index → new text
  for (let k = 0; k < sig.length; k++) {
    const tok = at(k)!;
    if (tok.kind !== "name" || at(k - 1)?.text === ".") continue; // members are handled with their chain's head
    // Chain: Head [ ( ... ) ] . m1 [ . m2 ]
    let next = k + 1;
    if (at(next)?.text === "(") {
      const c = close(next);
      if (c < 0) return same("unbalanced parentheses");
      next = c + 1;
    }
    if (!(at(next)?.text === "." && at(next + 1)?.kind === "name")) {
      // A name on its own: never an object. Without parentheses, an event variable in scope
      // (or a system expression, whose names variables can't take); with, a call.
      const v = next === k + 1 ? vars.get(tok.text.toLowerCase()) : undefined;
      if (v !== undefined) rewrite.set(sig[k].i, v);
      continue;
    }
    const head = tok.text.toLowerCase();
    if (head === "functions") {
      const f = functions.get(at(next + 1)!.text.toLowerCase());
      if (f !== undefined) rewrite.set(sig[next + 1].i, f);
      continue;
    }
    const newHead = types.get(head);
    if (newHead !== undefined) rewrite.set(sig[k].i, newHead);
    const m1 = at(next + 1)!.text.toLowerCase(), afterM1 = at(next + 2)?.text;
    for (const mr of members) {
      if (m1 !== mr.oldL) continue;
      let denotes: boolean;
      if (head === "self") {
        if (cls === undefined) return same(`"${tok.text}.${at(next + 1)!.text}" outside an object's action`);
        denotes = mr.selfL.has(cls) || mr.selfL.has((types.get(cls) ?? cls).toLowerCase());
      } else denotes = mr.ownerL.has(head) || (newHead !== undefined && mr.ownerL.has(newHead.toLowerCase()));
      if (!denotes) continue;
      if (mr.kind === "var" && (afterM1 === "." || afterM1 === "(")) continue; // a behavior, or an expression call
      if (mr.kind === "behavior" && afterM1 !== ".") continue; // a behavior is always followed by its expression
      rewrite.set(sig[next + 1].i, mr.new);
    }
  }
  if (!rewrite.size) return same(null);
  const text = tokens.map((t, i) => rewrite.get(i) ?? t.text).join("");
  // Must still read back as the same structure, only those names swapped.
  const check = tokenize(text);
  if (!check || check.length !== tokens.length || check.some((t, i) => t.kind !== tokens[i].kind)) return same("the renamed expression doesn't read back");
  return { text, changed: true, uncertain: null };
}
