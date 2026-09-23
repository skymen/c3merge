# Event variable and function renames

**Status:** built (2026-09-24): `src/context.ts` (event tables), `src/engine/renames.ts`
(scoped tree walk, calls), `src/engine/expressions.ts` (bare names, `Functions.name(`), finish
step included. Verified against C3's own commits (below).

## How often (Under The Red Sky, 889 commits that changed event sheets, by sid)
`scripts/event-renames.ts`:

| change | count | examples |
|---|---|---|
| function parameter added | 23 | `enableGamepadKBM` +`inputType`, `resetLevel` +`noFade` |
| function renamed | 20 | `enableKBM` → `enableGamepadKBM` |
| local variable renamed | 14 | `index` → `i`, `team_0_lives` → `team_0_score` |
| function parameter renamed | 9 | `photoModeWheel(wheelDeltaY → delta)` |
| custom action renamed or moved | 7 | `remotePlayerModel.PlayEmote` → `hasSkin.PlayEmote` |
| function parameter removed | 4 | `updateRemotePlayer` -14 params |
| global variable renamed | 2 | `timer` → `timerTime` |
| parameters reordered | 0 | |

## What C3 does (from those commits)
- A parameter added: every existing call gets the parameter's default, written as an
  expression (`inputType` string default `KBM` → `"KBM"` in each `callFunction` call).
  skymen: after any rename the renaming side is correct.
- A local variable renamed: references in the later siblings of its declaration and in
  their sub-events were renamed (`/2/1/0` declared, `/2/1/1` renamed; `/7/1/1` declared,
  `/7/1/2/0/1` renamed). Few clean examples: most local renames came with other edits.

## Name rules (skymen)
Object and variable names ignore case. A bare name is an event variable or a system
expression (`pi`, `floor(...)`); event variables and objects can't take a system
expression's name, but an object and an event variable can share one (`text.text & text`).
A local variable's rename only reaches its scope; different scopes can reuse a name.

## Design
Context gains the event sheets at base, ours and theirs: global variables (sid → name),
local variables (sid → name, parent event sid), functions (sid → name, parameters by sid
with name, type, default), custom actions (sid → object, name, parameters).

Renames applied to the base and the other side, like object renames:
- **Global variable**: bare names in expressions and `variable` parameters, project-wide
  (no local can share its name).
- **Local variable**: the same, only in its scope (all the parent event's children and their
  sub-events), found by the parent's sid on the other side. Parent
  gone there: nothing to rename.
- **Function**: `callFunction` and `Functions.name(` in expressions.
- **Function parameter renamed**: bare names inside the function block, like a local.
- **Parameters added or removed** (`callFunction` and custom action calls): the other
  side's calls that still have the old argument count get what C3 does to existing calls:
  a removed parameter's argument dropped (`6c2dba68`, 7 of 7 calls), an added one's default
  inserted at its position, a string quoted, a number as text, a boolean as `true`/`false`
  (`c449f363`, `11eb6bc1`, `59c7d303`...). A call already matching is left.
- **Reordered parameters (never seen), another argument count, `Functions.f(...)` calls in
  expressions with a changed signature, a custom action moved to another object**: a
  conflict marking the call, with the reason ("`f` now takes 2 parameters (a, b), changed on
  the other side; this call passes 3"). skymen: fine to flag these.
- **Custom action renamed** (same object): `customAction` on actions of that object.
- Unsure (unreadable expression, a name that could be either scope): flagged, as today.

Already built: two variables with the same name in one scope after a merge → conflict.

Verification (2026-09-24):
- `scripts/rename-truth.ts` against every rename and signature change in the Under The Red
  Sky history, object and event kinds together: **1,854 fields changed exactly as C3 did, 0
  missed, 0 changed that C3 didn't** (plus the two known non-errors: a condition repointed
  by hand, `Secrets.UID` vs `secrets.UID`). A custom action *block* carries its own
  `objectClass` (`6c2dba68` `skinView`): renamed too.
- 8 engine cases (a global renamed in another sheet, a local only in its scope with another
  group's same-named local untouched, a parameter inside its function, a function and its
  `Functions.f()` uses, parameters added and removed, an unexpected argument count flagged)
  and a finish-step test (a new event sheet using a renamed global).
- Replay of the 103 real merges: 162 conflicts as before, no rename flag.

## Scope rules (skymen, 2026-09-24)
1. A local variable is visible to **all** the children of its parent event (before and after
   the declaration) and their sub-events; not to the parent's own conditions and actions.
2. Function parameters are visible in the function block's own conditions and actions and
   in all its sub-events.
3. No shadowing: a local can't share a name with any event variable accessible there, local
   or global. So a bare name inside a scope is that scope's variable, for certain.
