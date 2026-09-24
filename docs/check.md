# `c3merge check`: find what stops C3 from opening a project

A merge can produce files that are each valid on their own but don't fit together. For
example, one branch deletes an object type while the other adds instances of it. C3's loader
is strict. Most of these problems make the whole project fail to open behind a generic
"Failed to open project" dialog, with the real reason only in the browser console.
`check` reads the whole project and names the problem.

```sh
c3merge check game                 # a project folder
c3merge check game.c3p             # or a .c3p
```

```
error   layouts/Level 1.json: instance uid 12 has type "TiledShapeDark", which doesn't exist  [instance-type-exists]
warning eventSheets/Main.json: global variable "score" is declared more than once  [global-var-unique]

1 error(s), 1 warning(s), 0 info
```

The exit code is 1 when there is at least one error, and 0 otherwise.

It runs by itself at the end of the [finish step](merging.md#renames-and-the-finish-step)
after each merge, which only prints the counts. Run it by hand for the details.

## Options

| Option | |
|---|---|
| `--json` | The full result as JSON: `{ source, findings: [{ invariant, file, message, severity }], counts }` |
| `--github` | One GitHub Actions annotation per finding (`::error file=…,title=…::…`), for CI |
| `--all` | Also list what C3 repairs by itself when it opens the project (severity `none`) |

## Severities come from the real editor

Each problem was planted in a test project and opened in C3 on an LTS, a stable and a
beta release (r449-5, r495-2, r503), through c3cli. The severity is the worst
behaviour seen on any of them, since each team member may use a different release:

| Severity | What C3 does |
|---|---|
| error | Refuses to open the project, loses content silently, or opens but can't preview |
| warning | Opens and keeps the problem as it is |
| info | Harmless or often intended |
| none | Repairs it by itself on open (only listed with `--all`) |

`c3merge invariants` prints the whole list with the measurement behind each one:

| Severity | Invariant | |
|---|---|---|
| error | `json-parse` | every JSON file parses |
| error | `listed-file-missing` | every item the `.c3proj` lists has its file |
| error | `unlisted-file` | every item file is listed in the `.c3proj`: C3 opens the project without it and loses it on the next save |
| error | `instance-type-exists` | every instance's type exists |
| error | `instance-world-present` | every layout instance has world data |
| error | `object-type-sid-unique` | object type and family sids are unique |
| error | `object-type-name-unique` | object type and family names are unique |
| error | `include-exists` | event sheet includes point to existing sheets |
| error | `object-class-exists` | conditions and actions use existing object types |
| error | `function-exists` | function calls point to existing functions |
| error | `instance-vars-declared` | instances only have variables their type (or family) declares |
| error | `family-members-exist` | family members are existing types |
| error | `family-same-plugin` | family members all use the family's plugin |
| error | `bundled-addon-file` | bundled addons have their `.c3addon` in the project |
| error | `image-id-unique` | animation frame image ids are unique |
| error | `frame-image-exists` | every animation frame has its image file |
| error | `layer-name-unique` | layer names are unique within a layout |
| error | `tilemap-data-size` | tilemap data matches the tilemap's size |
| error | `timeline-instance-exists` | timeline tracks point to existing instances |
| warning | `event-sid-unique` | event sids are unique project-wide |
| warning | `global-var-unique` | global variable names are unique |
| warning | `effect-name-unique` | effect names are unique per type, family, layer and layout |
| info | `layer-param-exists` | layer names in action parameters exist (layers can be created at runtime) |
| info | `empty-event` | events have at least one condition or action |
| none | `instance-uid-unique` | instance uids are unique (C3 renumbers) |
| none | `event-sid-present` | every event block has a sid (C3 adds one) |
| none | `instance-vars-complete` | instances have every variable their type declares (C3 adds the default) |
| none | `hierarchy-links` | hierarchy links point to existing instances (C3 drops the link) |

Severities are data (`src/check/lab-matrix.json`), not code. When a new C3 release behaves
differently, the lab is re-run on it (`npm run lab -- --releases stable,beta,lts`) and the
table updates. An invariant the lab never measured is a warning.

Not checked yet: action and condition ids that don't exist in their addon, which needs
each addon's list of actions and conditions.

## In CI

`check` itself needs no editor and no network: Node and a checkout are enough. For example, in
a GitHub Actions workflow:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: |
    git clone --depth 1 <c3merge repository> /tmp/c3merge
    cd /tmp/c3merge && npm install && npm run build
- run: node /tmp/c3merge/bin/c3merge.js check game --github
```

Errors show up as annotations on the pull request, and the job fails.
