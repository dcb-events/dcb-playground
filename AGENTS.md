# DCB Playground

An in-browser modeling tool for designing and testing event-sourced systems
built on Dynamic Consistency Boundaries (DCB, see https://dcb.events). Authors
build _DCB Models_ — collections of custom-type, event, entity, projection and
command definitions — drive commands against a hypothetical event log, and see
which consistency boundary each command derives.

No build step, no framework, and one vendored dependency: Monaco, pinned and
checked in under `app/vendor/monaco/`, lazy-loaded only when a scripted
handler's editor is on screen. The app runs from any static server —
`npx serve app` locally; it never fetches anything at runtime.

## Layout

- `app/` — the application. Everything that runs.
- `dcb-model.schema.json` — canonical JSON Schema for the interchange format
  (`https://dcb.events/schemas/model/v8.json`). Source of truth for what a
  DCB Model file contains; `app/webmcp-schemas.js` is generated from it.
- `fixtures/` — test data only: models carrying scenarios authored in
  the playground, which no seed builder produces; `dsl.test.js` reads
  them. Hand-edited, never served.
- `docs/design-notes.md` — the design rationale by area; see _Before
  changing an area_ below.
- `docs/research/` — dated primary-source research notes backing design
  decisions (one file per investigation, `YYYY-MM-DD-topic.md`).
- `design/` — design-canvas artboards from UI exploration rounds; historical
  reference, not loaded by the app.

## Architecture (app/)

Layers, strictly ordered — each file's header comment is its real
documentation; read it before editing the file:

- `model.js` — what a definition _means_. The playground's own event log
  (localStorage-backed, append-only), the projection over it, validation,
  DCB derivation, editing commands, and the predefined models
  (`PREDEFINED_MODELS`). No DOM.
- `evaluate.js` — what a definition _does_. Given a model, an event log and a
  command, resolves the boundary, folds projections, checks conditions,
  returns published events or the refusing rule. No DOM, no localStorage.
  Handlers compile to closures, never to generated source.
- `dsl.js` — the model as _code_: prints a model in the playground's own
  language, parses it back with positioned diagnostics, and applies a text
  as the difference (`replaceDefinitions`, model.js — one append). Also the
  Monaco grammar, as data. No DOM. The Code view in index.html is its UI.
- `shared.js` — DOM helpers (`h(...)`), the experimental flag, the links
  into the documentation, the scripted-
  handler editor (Monaco behind a synthesized per-handler TypeScript preamble
  — the synthesis is pure and tested, the widget is not), and the _slice_
  view (everything one command touches, derived from the definitions — the
  idea the page is built around). `shared.css` is its stylesheet.
- `index.html` — the entire UI, one page. Renders from the projected state and
  re-renders after every editing command.
- `webmcp.js` — registers WebMCP tools on `document.modelContext` so an
  in-browser agent can inspect and edit the open model through the same
  command functions the buttons call. Inert without the API or an open model.
  Agents are steered to write whole models as code: `get_model_language`
  serves the reference kept in `dsl.js` (`sourceLanguageReference`).

All classic scripts sharing one global scope — **not** ES modules: the tests
depend on it, concatenating the files into one `vm` context. (The vendored
Monaco loads itself through its own AMD loader, outside that scope.)

## Commands

Tests (plain Node, no runner — run all four after any change):

```
node app/evaluate.test.js   # semantics, against the shipped example models
node app/ui.test.js         # the pure layer under the interface
node app/webmcp.test.js     # WebMCP tool seam
node app/dsl.test.js        # the code view's language: round trips, apply
```

The DOM stub, sandbox, script loader and assertions live once in
`app/test-harness.js`, `require`d by all four suites. A test edits a
fixture text with `swap(text, from, to)`, which throws when `from` is
gone — a bare `.replace()` that misses leaves the test checking nothing.

`.githooks/pre-commit` runs the four suites, checks the generated files
are current and refuses a bare `.replace()` in a suite. Enable it once
per clone: `git config core.hooksPath .githooks`.

To see a model as the code view prints it:

```
node app/print-model.js                  # lists the predefined slugs
node app/print-model.js course-simple    # a predefined model as code (--json: stored definitions)
node app/print-model.js some-file.json   # an envelope file as code
```

Generated files — regenerate, never hand-edit:

```
node app/generate-webmcp-schemas.js   # rewrites app/webmcp-schemas.js after a dcb-model.schema.json change
node app/generate-vendor-monaco.js    # re-fetches app/vendor/monaco/ — only on a version bump (needs network)
```

WebMCP tool execution needs a real origin — serve `app/` (e.g. `npx serve`);
it never works from `file:`.

## Before changing an area

Read its section of `docs/design-notes.md` first — each records what
was decided, why, and what was tried and reverted:

- the shipped models or `PREDEFINED_MODELS` — _Shipped models_
- what the experimental flag hides — _The experimental flag_
- bindings, rules, the rule adder, read pruning, write coverage, the
  operations an editor offers — _Reads, rules and the rule adder_
- event or projection tags, projection reads, handlers per event —
  _Tags: events, projections, handlers_
- the wire format's version — _Wire format versions_
- entity lifecycles or their UI — _Entity lifecycles_
- guards, rejection messages, derived projections — _Guarded emissions…_
- wording on any page — _The interface register_
- the bar, dialogs or layout at phone width — _Narrow screens_
- the code view's language, its editor or language service — _The code
  view's language_, and the `dsl.js` header

## Conventions and gotchas

- **The help modal explains the playground, not the notation**
  (`helpModal`, index.html): the bar's button, the `?` key and the
  models dialog open it, and its one link is the notation reference on
  dcb.events, in a new tab. An `ⓘ` keeps its one line and links the
  reference's anchor for it. The anchors (`NOTATION_ANCHORS`) are a
  contract with the website: its build fails on a link
  `helpReferenceLinks()` lists that it does not define, so an anchor is
  added or renamed on both sides — until the website catches up with
  8.0, new constructs link the nearest existing one.
- **The experimental flag gates authoring, never reading**
  (`experimental()`, shared.js): gate an *offer* — an adder, a picker
  row, a tab, a completion — never the display of something stored. A
  model that uses a gated construct still loads, renders and evaluates
  whole. WebMCP offers nothing experimental, flag or no flag: no entity
  tools or schema members, and an agent's edit that would introduce a
  use is refused — a model already using one stays editable.
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
  conditions do not hold is _rejected_ (an ordinary outcome); a scenario that
  cannot run at all (missing event, missing argument, throwing script) is an
  _error_.
- **The write path refuses only structure** — a missing key, a name
  collision, a body whose containers are not lists (`assertStorableBody`).
  Everything semantic (dangling references, write coverage, name idiom,
  mistyped values) is an _advisory_: computed per revision by
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
  ordering: a null exclusion or tag of a projection read is an
  evaluation _error_, and so is a null boundary identifier _unless the binding is
  marked `isOptional`_ — then it binds zero instances, conditions over
  the alias hold vacuously, and reading a property of it yields null.
  The optional-parameter and derived-null advisories say all of this
  ahead of time.
- **Wire format majors**: a new member of a closed vocabulary is a
  _major_, judged from the reader's side; a field an old reader can
  ignore without misreading anything is a minor. The importer reads
  only `READABLE_MAJORS` and always writes the current `MODEL_VERSION`.
- **Anything walking a command's conditions must walk each emission's
  `when` too**: guard reads count toward the derived DCB like condition
  reads (both flow through `forEachCommandOperand`; see `allConditions`
  in `validateCommandBody`).
- **The code view's language is a spelling of the wire format**: print
  and parse are each other's inverse, and a definition that does not
  survive the round trip is printed as JSON. So a new wire-format
  construct needs a spelling in the printer and the parser, its parser
  marks and a case in `sourceSymbols`, or the dsl suite fails.
- **Kind colours mean kinds; chrome is `--accent`.** `--command`,
  `--event`, `--entity`/`--projection` and `--rule` colour only the thing
  they name (chips, cards, lanes, marks). Buttons, focus rings, hover,
  selected tabs and pickers use `--accent` (dcb.events teal) — painting
  chrome command blue made every control read as "about a command".
- **Hosted on dcb.events** at `/playground/`, copied there from a pinned
  submodule by the website's build; every path stays relative so any
  sub-path works. The host may define `window.DCB_PLAYGROUND_HOST.theme`
  (`get`/`set`/`onChange`, see `shared.js`) to own the light/dark choice;
  the website injects that to share its own setting. Nothing in `app/`
  may know how the host stores it.
- **Comment style**: file headers and block comments carry design rationale,
  not line-by-line narration. Match that register; keep headers truthful when
  behaviour changes.
- Near-zero dependencies is a feature. Monaco is the one deliberate
  exception — vendored, pinned, lazy-loaded, regenerated by script, and the
  plain textarea remains the fallback if it ever fails to load. Anything
  else that would introduce a package, bundler or test runner still needs a
  strong reason.
