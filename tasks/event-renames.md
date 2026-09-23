# Event variable and function renames

**Status:** explored (2026-09-24), not built. Design below waits on skymen for the scope rules.

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
- **Global variable**: bare names in expressions and `variable` parameters, project-wide,
  except inside a scope that declares a local with the same name.
- **Local variable**: the same, only in its scope (the parent event's children after the
  declaration, and their sub-events), found by the parent's sid on the other side. Parent
  gone there: nothing to rename.
- **Function**: `callFunction` and `Functions.name(` in expressions.
- **Function parameter renamed**: bare names inside the function block, like a local.
- **Parameter added**: the other side's calls that still have the old argument count get
  the default inserted at its position, written the way C3 writes it. Any other count:
  conflict with a tip.
- **Parameter removed or reordered, custom action moved to another object**: the other
  side's new or edited calls become conflicts with a tip ("`f` lost parameter `x` on the
  other side; this call still passes it"). skymen: fine to flag these.
- **Custom action renamed** (same object): `customAction` on actions of that object.
- Unsure (unreadable expression, a name that could be either scope): flagged, as today.

Already built: two variables with the same name in one scope after a merge → conflict.

Verification, as for object renames: `rename-truth.ts` extended to these kinds against
C3's own commits (20 function renames, 16 variable renames, 9 parameter renames, 23
parameter additions), plus unit tests for scopes and shadowing.

## Questions for skymen
1. Scope of a local variable: its parent event's children **after** the declaration and
   their sub-events? Or all the children, before it too? Not the parent's own conditions
   and actions?
2. Function parameters: visible in the function block's own conditions and actions and in
   all its sub-events?
3. Can a local have the same name as a global, or as a local in an enclosing scope
   (shadowing)? If C3 forbids it, any bare name inside the scope is that local, which is
   simpler and certain.
