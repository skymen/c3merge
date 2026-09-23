// Line-by-line 3-way merge (what git does for text), for lists of text lines such as the
// lines of a script action. Returns the merged lines, with conflicting stretches as
// { ours, theirs } runs.

export type LineChunk = string | { ours: string[]; theirs: string[] };

// Pairs (i, j) of equal lines in a and b, from a longest common subsequence.
function matches(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const len = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  }
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return out;
}

// Scripts are short; beyond this the quadratic LCS isn't worth it: treat as one value.
export const MAX_CELLS = 4_000_000;

export function mergeLines(base: string[], ours: string[], theirs: string[]): LineChunk[] | null {
  if (base.length * Math.max(ours.length, theirs.length) > MAX_CELLS) return null;
  const inOurs = new Map(matches(base, ours));
  const inTheirs = new Map(matches(base, theirs));
  // Base lines kept unchanged on both sides are the stable anchors.
  const anchors: [number, number, number][] = [];
  for (let i = 0; i < base.length; i++) {
    if (inOurs.has(i) && inTheirs.has(i)) anchors.push([i, inOurs.get(i)!, inTheirs.get(i)!]);
  }
  anchors.push([base.length, ours.length, theirs.length]);
  const out: LineChunk[] = [];
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every((l, k) => l === y[k]);
  let b = 0, o = 0, t = 0;
  for (const [bi, oi, ti] of anchors) {
    const B = base.slice(b, bi), O = ours.slice(o, oi), T = theirs.slice(t, ti);
    if (eq(O, T) || eq(B, T)) for (const l of O) out.push(l);
    else if (eq(B, O)) for (const l of T) out.push(l);
    else out.push({ ours: O, theirs: T });
    if (bi < base.length) out.push(base[bi]);
    b = bi + 1; o = oi + 1; t = ti + 1;
  }
  return out;
}
