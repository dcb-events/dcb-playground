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
- **Scripted projections are unsandboxed**, run on the main thread, and run
  unprompted — everywhere a declared projection would, repaints included.
  What stands between an untrusted model and that is the import gate (every
  external load pauses on `envelopeHasScript`; cancelling loads nothing), and
  the way back into a page a hanging script would otherwise brick on every
  reload is `?safe` on the URL: `setScriptsDisabled` (evaluate.js) compiles
  every script handler to a thrower, so the model loads and the script can be
  fixed. Keep both intact — together they are why unprompted is safe.
- **Two failure kinds** in evaluation, never conflated: a command whose
  conditions do not hold is *rejected* (an ordinary outcome); a scenario that
  cannot run at all (missing event, missing argument, throwing script) is an
  *error*.
- **The write path refuses only structure** — a missing key, a name
  collision, a body whose containers are not lists (`assertStorableBody`).
  Everything semantic (dangling references, write coverage, name idiom,
  mistyped values) is an *advisory*: computed per revision by
  `modelAdvisories` (model.js), folded into the Problems panel, shown as a
  banner on the affected page, and echoed in mutating WebMCP tool results.
  Never promote an advisory back into a write-path throw — a defective model
  must load, render and evaluate. Import is best-effort: what fails the
  structural gate is skipped and reported once, in a toast. Scenario kinds
  are excluded from advisories; their run/status channel already reports.
  The predefined models are held advisory-clean by a test.
- **Every edit goes through a command function** in `model.js`, and every
  command funnels into `appendEvents` — the seam where undo marks are taken
  (`onAppend`), so buttons and agent tools are undoable alike. New editing
  features follow the same path; WebMCP tools already do.
- **Every writer of `EVENT_LOG_KEY` must call `bumpLogRevision()`** —
  `appendEvents` does, undo/redo do. The projected state and the problems
  list are cached per revision; a writer that skips its bump is the one way
  those caches go stale.
- **`projectState()` returns one shared object per revision** — never mutate
  it. Editors work on a `deepClone` and route changes through a command
  function (`patch` in index.html is the pattern).
- **Scenario-kind machinery lives in `SCENARIO_KINDS`** (index.html): command
  scenarios and projection scenarios share one held/run, staleness, save and
  status mechanism, parameterized by that table. A behavior change belongs in
  the generic functions, not in a per-kind copy.
- **`null` is the one spelling of "no value"** on optional properties, and
  it is never the empty string. Writers spell it out (the payload editors
  and the scenario save path store the explicit null; an unmapped optional
  event property publishes it); readers are lenient (an absent key on an
  optional property reads as null). Downstream it is an ordinary value —
  equality and emptiness work — except where it would become a tag or an
  ordering: a null exclusion or projection parameter is an evaluation
  *error*, and so is a null boundary identifier *unless the binding is
  marked `isOptional`* — then it binds zero instances, conditions over
  the alias hold vacuously, and reading a property of it yields null.
  The optional-parameter and derived-null advisories say all of this
  ahead of time.
- **One handler per event type, per projection** — and it is a real
  constraint, not a convenience: tag matching is by *value*, whichever
  property carries it, so an event holding one identifier type in two
  properties reaches both partitions and a handler fires for both. A
  declarative handler cannot tell them apart; the fix is to split the
  event (one fact each) or script the projection, and an advisory
  points at the ambiguity. The editors offer only unhandled events.
- **Wire format 4.0 vs 3.x**: binding `isOptional` is additive in shape
  but a 3.x reader errors where the flag declares the absence expected,
  so it is a *major* (see the versioning notes in
  `dcb-model.schema.json` and `model.js`). The importer reads 3.x and
  4.x (`READABLE_MAJORS`) and always writes 4.0.
- **Comment style**: file headers and block comments carry design rationale,
  not line-by-line narration. Match that register; keep headers truthful when
  behaviour changes.
- No dependencies is a feature. Anything that would introduce a package,
  bundler or test runner needs a strong reason.
