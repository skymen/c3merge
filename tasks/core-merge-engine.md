# Core 3-way merge engine

**Status:** not started (2026-09-21)

## Inputs / outputs

- Inputs: base, ours, theirs (parsed JSON), a profile, the repo-relative path.
- Output: merged value + list of collisions. Never throws on content; only on unparseable
  JSON (then exit 2 = "let git do a text merge", see git-driver.md).
- Missing base (both sides added the file) → treat base as `null`; objects still merge.

## Algorithm

```
merge(b, o, t, path):
  if eq(o, t)           → o
  if eq(b, o)           → t
  if eq(b, t)           → o
  rule = profile.lookup(path)
  if rule.opaque        → pick(rule.policy), collision("opaque")
  if all objects        → mergeObject
  if all lists          → rule.identity ? mergeKeyedList : (all scalars ? unionScalars : positional-or-collision)
  else                  → pick(rule.policy), collision("scalar")
```

`eq` compares canonical JSON (sorted keys). Keep it — object key order is not semantic for
C3, but see "output fidelity" for why we still preserve it on output.

### mergeObject
Key order: ours' order, then theirs-only keys. Delete-vs-modify: profile policy per path,
default = **modify wins** (keep the element, log a collision). Note this is the opposite of the
Sep 2026 script, which let delete win; delete-wins lost work in practice because a deleted
instance on one side usually meant "moved to another layer/layout" on the other.

### mergeKeyedList
1. Build `id → element` maps for b/o/t using the rule's identity keys in order; first key
   present wins. Elements with no identity key: content hash (comments, includes).
2. Element-wise merge for ids in both o and t.
3. Added on one side: keep. Deleted on one side + changed on the other: modify wins + collision.
4. **Ordering** (only if `rule.ordered`): start from ours' order; for each theirs-only
   element insert after its nearest predecessor in theirs that survived. If an element's
   position changed on both sides relative to base (different neighbours) → collision
   `"moved on both sides"`, keep ours' position.
5. Duplicate check: two surviving elements sharing a `name` (or a sid) → collision
   `"duplicate after merge"`; `check` will flag it too.

### sid fallback
When an element's sid exists only in ours (or only theirs) and not in base, before calling it
an addition: look for a base element with no match on that side whose secondary signature
matches (profile-defined: e.g. events `{eventType, conditions[0].id, objectClass}`, instances
`{type, world.x, world.y}`, layers `{name}`). If exactly one candidate → treat as the same
element with a regenerated sid; keep ours' sid. Log as `"sid regenerated"` (info, not a
collision).

### unionScalars
Ordered union: ours' order, theirs-only inserted after nearest surviving theirs predecessor,
removed-on-either-side stays removed.

## Output fidelity

**Verified 2026-09-23** on 2,121 JSON files from 47 real projects (lab-base plus c3cli's
fixtures): every file C3 writes is byte-for-byte one of two things.
- `JSON.stringify(value, null, "\t")`: every project file (c3proj, layouts, event sheets,
  object types, families, timelines...). Tabs, `\n`, **no trailing newline**.
- `JSON.stringify(value)` (compact, one line): `*.uistate.json`, `tilemapBrushes/*.brush.json`.
- The only exceptions were user files under `files/` (Spine exports, i18n with CRLF), which
  C3 doesn't format and c3merge doesn't merge structurally.

So the earlier worries go away: C3 is JavaScript, so numbers are whatever
`JSON.stringify` prints (it never writes `1.0`) and no token-level preservation is needed.
Rules:
- Serialize with `JSON.stringify(v, null, "\t")`, or compact if the input had no newline.
  No trailing newline.
- Key order for objects present in both sides: ours' order, then theirs-only keys (C3 keeps
  insertion order, so this round-trips).
- Lab row 26 (spaces, CRLF, reordered keys) shows C3 rewrites to its own formatting on
  save; see reports/lab-matrix.md.
- Fidelity test: c3cli `save` of the merged project, then diff; expect no changes beyond
  C3's own normalisations (release bump, new default keys, llm-context.md...).

## Exit codes (driver mode)
- 0 clean, 1 collisions (file written, git marks conflicted), 2 could not parse → git falls
  back to text merge for that file (driver exits non-zero without writing, git keeps the
  built-in result? — no: git treats any non-zero as conflict. So on 2 we run git's text merge
  ourselves via `git merge-file` and forward its exit code).

## Tests
Golden triples per rule (tasks/test-corpus.md). Property test: `merge(b, o, o) == o`,
`merge(b, b, t) == t`, `merge(b, o, t)` symmetric up to ordering when no collisions.
