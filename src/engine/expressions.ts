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
// behavior, in every form an expression may use for it (its name, the member types of a
// family); `selfClasses` are the objectClass values for which `Self` means that owner.
export interface MemberRename { kind: "var" | "behavior"; old: string; new: string; owner: Set<string>; selfClasses: Set<string> }
export interface RenameSet { types: Record<string, string>; members: MemberRename[] }

export interface RenameResult { text: string; changed: boolean; uncertain: string | null }

// Rename references in one expression. `objectClass` is the object the action or condition
// belongs to (what `Self` means), undefined when there is none (System, function calls).
export function renameExpression(expr: string, objectClass: string | undefined, set: RenameSet): RenameResult {
  const same = (reason: string | null): RenameResult => ({ text: expr, changed: false, uncertain: reason });
  const oldNames = new Set([...Object.keys(set.types), ...set.members.map((m) => m.old)]);
  const lower = new Set([...oldNames].map((n) => n.toLowerCase()));
  // Cheap exit: none of the names occur at all (outside or inside strings).
  if (![...lower].some((n) => expr.toLowerCase().includes(n))) return same(null);
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
  const rewrite = new Map<number, string>(); // token index → new text
  for (let k = 0; k < sig.length; k++) {
    const tok = at(k)!;
    if (tok.kind !== "name") continue;
    // A name after a dot is a member, handled with its chain's head.
    if (at(k - 1)?.text === ".") continue;
    // Chain: Head [ ( ... ) ] . m1 [ . m2 ]
    let next = k + 1;
    if (at(next)?.text === "(") {
      const c = close(next);
      if (c < 0) return same("unbalanced parentheses");
      next = c + 1;
    }
    const isChain = at(next)?.text === "." && at(next + 1)?.kind === "name";
    const head = tok.text;
    if (!isChain) {
      // Variables and behaviors are always written after their object, so a bare name that
      // spells one is something else (an event variable, a function). An object type's name
      // on its own isn't something we can place.
      if (Object.keys(set.types).some((n) => n.toLowerCase() === head.toLowerCase())) return same(`"${head}" is used on its own`);
      continue;
    }
    const m1 = at(next + 1)!.text, afterM1 = at(next + 2)?.text;
    if (head in set.types) rewrite.set(sig[k].i, set.types[head]);
    else if (lower.has(head.toLowerCase()) && !(head in set.types) && Object.keys(set.types).some((n) => n.toLowerCase() === head.toLowerCase())) {
      return same(`"${head}" differs from a renamed object only by case`);
    }
    // Members: which owners does the head stand for?
    const renamedHead = set.types[head] ?? head;
    for (const mr of set.members) {
      if (m1.toLowerCase() !== mr.old.toLowerCase()) continue;
      const isSelf = head === "Self";
      if (isSelf && objectClass === undefined) return same(`"Self.${m1}" outside an object's action`);
      const denotes = isSelf ? mr.selfClasses.has(objectClass!) : mr.owner.has(head) || mr.owner.has(renamedHead);
      if (!denotes) continue;
      if (m1 !== mr.old) return same(`"${head}.${m1}" differs from "${mr.old}" only by case`);
      // A variable is never followed by a dot (that's a behavior) or parameters.
      if (mr.kind === "var") {
        if (afterM1 === ".") continue; // Head.m1.X: m1 is a behavior with the variable's name
        if (afterM1 === "(") return same(`"${head}.${m1}(" can't be a variable`);
      } else if (afterM1 !== ".") continue; // a behavior is always followed by its expression
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
