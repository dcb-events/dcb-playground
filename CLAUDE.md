# DCB Playground

An in-browser modeling tool for designing and testing event-sourced systems
built on Dynamic Consistency Boundaries (DCB, see https://dcb.events). Authors
build *DCB Models* — collections of custom-type, event, entity, projection and
command definitions — drive commands against a hypothetical event log, and see
which consistency boundary each command derives.

Zero dependencies, no build step, no framework. The app opens straight from
the filesystem: open `app/index.html` in a browser and it runs.

## Layout

- `app/` — the application. Everything that runs.
- `dcb-model.schema.json` — canonical JSON Schema for the interchange format
  (`https://dcb.events/schemas/model/v3.json`). Source of truth for what a
  DCB Model file contains; `app/webmcp-schemas.js` is generated from it.
- `docs/research/` — dated primary-source research notes backing design
  decisions (one file per investigation, `YYYY-MM-DD-topic.md`).
- `design/` — design-canvas artboards from UI exploration rounds; historical
  reference, not loaded by the app.

## Architecture (app/)

Layers, strictly ordered — each file's header comment is its real
documentation; read it before editing the file:

- `model.js` — what a definition *means*. The playground's own event log
  (localStorage-backed, append-only), the projection over it, validation,
  DCB derivation, editing commands, and the predefined models
  (`PREDEFINED_MODELS`). No DOM.
- `evaluate.js` — what a definition *does*. Given a model, an event log and a
  command, resolves the boundary, folds projections, checks conditions,
  returns published events or the refusing rule. No DOM, no localStorage.
  Handlers compile to closures, never to generated source.
- `shared.js` — DOM helpers (`h(...)`), simple/advanced mode, and the *slice*
  view (everything one command touches, derived from the definitions — the
  idea the page is built around). `shared.css` is its stylesheet.
- `index.html` — the entire UI, one page. Renders from the projected state and
  re-renders after every editing command.
- `webmcp.js` — registers WebMCP tools on `document.modelContext` so an
  in-browser agent can inspect and edit the open model through the same
  command functions the buttons call. Inert without the API or an open model.

All classic scripts sharing one global scope — **not** ES modules, so the page
keeps working from a `file:` origin. Tests exploit this by concatenating files
into one `vm` context.

## Commands

Tests (plain Node, no runner — run all three after any change):

```
node app/evaluate.test.js   # semantics, against the shipped example models
node app/ui.test.js         # the pure layer under the interface
node app/webmcp.test.js     # WebMCP tool seam
```

The DOM stub, sandbox, script loader and assertions live once in
`app/test-harness.js`, `require`d by all three suites.

Generated files — regenerate, never hand-edit:

```
node app/generate-webmcp-schemas.js   # rewrites app/webmcp-schemas.js after a dcb-model.schema.json change
node app/generate-examples.js         # rewrites app/examples/*.json after a seed* builder change
```

`app/examples/course-simple.json` is deliberately hand-edited; the generator
detects and skips it.

WebMCP tool execution needs a real origin — serve `app/` (e.g. `npx serve`);
it never works from `file:`.

## Conventions and gotchas

- **Storage versioning**: `EVENT_LOG_KEY` in `model.js` (`dcb-playground:events:vN`)
  must be bumped whenever a stored definition changes shape. The log is the
  whole state; there are no migrations — a fresh key is the honest move. Keep
  the changelog comment above the constant current.
- **Scripted projections are unsandboxed** and run on the main thread. Never
  evaluate one unprompted (e.g. automatically at startup) — a hanging script
  must leave a way back into the app to fix it.
- **Two failure kinds** in evaluation, never conflated: a command whose
  conditions do not hold is *rejected* (an ordinary outcome); a scenario that
  cannot run at all (missing event, missing argument, throwing script) is an
  *error*.
- **Every edit goes through a command function** in `model.js`, and every
  command funnels into `appendEvents` — the seam where undo marks are taken
  (`onAppend`), so buttons and agent tools are undoable alike. New editing
  features follow the same path; WebMCP tools already do.
- **Every writer of `EVENT_LOG_KEY` must call `bumpLogRevision()`** —
  `appendEvents` does, undo/redo do. The projected state, held scenario runs
  and the problems list are all cached per revision; a writer that skips its
  bump is the one way those caches go stale.
- **`projectState()` returns one shared object per revision** — never mutate
  it. Editors work on a `deepClone` and route changes through a command
  function (`patch` in index.html is the pattern).
- **Scenario-kind machinery lives in `SCENARIO_KINDS`** (index.html): command
  scenarios and projection scenarios share one held/run, staleness, save and
  status mechanism, parameterized by that table. A behavior change belongs in
  the generic functions, not in a per-kind copy.
- **Comment style**: file headers and block comments carry design rationale,
  not line-by-line narration. Match that register; keep headers truthful when
  behaviour changes.
- No dependencies is a feature. Anything that would introduce a package,
  bundler or test runner needs a strong reason.
