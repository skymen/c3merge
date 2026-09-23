# Per-file-kind profiles

**Status:** not started (2026-09-21). First deliverable: the table below filled in from real

**Superseded in part (2026-09-23):** no `policy` picks; opaque changed on both sides and
same-spot inserts in ordered lists are conflicts (DESIGN.md "Engine"). Rewritten with the
survey.

files (UTRS + a fresh empty project per template), *before* engine code.

## Kind detection
By path first, content sniff second (some users rename folders? no — C3 fixes folder names,
but `.c3p` extraction may differ):

| Path | Kind | Sniff |
|---|---|---|
| `*.c3proj` | project | has `projectFormatVersion` |
| `eventSheets/**/*.json` | eventSheet | has `events` + `name` |
| `layouts/**/*.json` | layout | has `layers` + `name` |
| `objectTypes/**/*.json` | objectType | has `plugin-id` |
| `families/**/*.json` | family | has `members` |
| `timelines/**/*.json` | timeline | has `tracks` (verify) |
| `flowcharts/**/*.json` | flowchart | verify |
| `*.uistate.json` | uistate | merge=ours via attributes, profile never used |
| `files/**`, `scripts/**`, `images/**`, `sounds/**`, `fonts/**`, `music/**`, `icons/**` | not ours | git default |

Unknown JSON under the project → fallback profile.

## Profile schema (data, not code)
```json
{
  "kind": "layout",
  "rules": [
    { "path": "layers[]",               "identity": ["sid", "name"], "ordered": true },
    { "path": "layers[].instances[]",   "identity": ["uid", "sid"],  "ordered": true,
      "secondary": ["type", "world.x", "world.y"] },
    { "path": "layers[].instances[].instanceVariables", "scalars": "theirs" },
    { "path": "**.tileData",            "opaque": true, "policy": "ours" }
  ],
  "scalars": "collision"
}
```
`path` uses `[]` for "any element" and `**` for any depth. First matching rule wins;
fallback rule = `identity: [uid, sid, name, id]`, `ordered: false`.

## Table to fill (from real files)

### project (`project.c3proj`)
- `usedAddons[]` — identity `id`+`type`; union; version mismatch on the same addon → collision, take max? (verify what C3 does with a bundled addon version mismatch)
- `savedWithRelease` — take **max**; `projectFormatVersion` — must be equal, else collision
- `uniqueId`, `firstLayout`, `startupScene` (verify names) — scalar policy
- `layoutFolder` / `eventFolder` / `objectTypeFolder` / … folder trees: `items[]` are name strings → union; `subfolders[]` identity `name`, ordered=false
- `globalVariables[]` identity `sid`, secondary `name`
- `properties`, `viewportWidth/Height`, `sampling`, … — scalar collision
- `containers[]`? (verify where containers live)

### eventSheet
- `events[]` identity `sid`; comments (no sid) content-keyed; `include`s keyed by `includeSheet`
- **ordered = true** (execution order)
- `events[].conditions[]` / `actions[]` identity `sid`, ordered=true
- `events[].children[]` (sub-events) same rules, recursive
- `events[].functionParameters[]` identity `sid`, secondary `name`, ordered=true
- secondary signature for events: `{eventType, conditions[0].objectClass, conditions[0].id}`
- `events[].parameters` (object with named keys) → per-key scalar merge
- groups: `eventType: "group"`, `title`, `children` — same
- script blocks: `eventType: "script"`, `script` text → scalar collision (could line-merge with `git merge-file` later)

### layout
- `layers[]` identity `sid` (verify layers have sid; DemoEndScreen shows `name` only at top — check) then `name`; ordered=true (draw order)
- `layers[].subLayers[]` same, recursive
- `layers[].instances[]` identity `uid`; ordered=true (z-order); secondary `{type, world.x, world.y, world.width}`
- `instances[].properties`, `.world`, `.instanceVariables`, `.behaviors.*` → per-key scalar merge
- `instances[].instanceFolderItem` — editor UI state, policy ours
- `instances[].hierarchy` / `children` (hierarchies) — verify shape
- layout-level `properties`, `effectTypes[]` (identity `effectId`+`name`)
- tilemap instances: `properties.tilemap-data`/`tileData` opaque, policy ours + collision
- 3D mesh / mesh points: opaque

### objectType
- top-level scalars; `sid`
- `instanceVariables[]` identity `sid`, secondary `name`
- `behaviorTypes[]` identity `sid`, secondary `behaviorId`+`name`
- `effectTypes[]` identity `effectId`+`name`, ordered=true (effect order matters)
- `image` (single-image types): `imageSpriteId` policy ours, rest scalar
- `animations` / `animationFolder` → `items[]`/`subfolders[]` like project folders; `frames[]` identity `sid`, ordered=true; frame `imageSpriteId` ours
- `containers`? verify

### family
- `members[]` name strings → union
- `instanceVariables[]`, `behaviorTypes[]`, `effectTypes[]` as objectType

### timeline / flowchart / hierarchy templates / scene graph
- inspect real files; until then: fallback profile with `opaque: true` on any array of numbers longer than 16

## Ordering
"ordered" lists merge position as in core-merge-engine.md §mergeKeyedList step 4. Known
hard case: both sides append at the end of `events[]` → both appended, ours first, no
collision. Both sides insert at the *same* index between the same neighbours → same,
no collision (they're different elements). One side reorders a block that the other side
edited → edit applied at ours' position, no collision.

## Opaque
`tileData`, mesh point arrays, timeline keyframe value arrays, any base64 blob. Policy: pick
per profile (default theirs? — no: default **ours** + collision, since the merging user is
sitting at the terminal and can re-do their own change knowingly).
