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
  (`https://dcb.events/schemas/model/v6.json`). Source of truth for what a
  DCB Model file contains; `app/webmcp-schemas.js` is generated from it.
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
- `shared.js` — DOM helpers (`h(...)`), simple/advanced mode, the scripted-
  handler editor (Monaco behind a synthesized per-handler TypeScript preamble
  — the synthesis is pure and tested, the widget is not), and the _slice_
  view (everything one command touches, derived from the definitions — the
  idea the page is built around). `shared.css` is its stylesheet.
- `index.html` — the entire UI, one page. Renders from the projected state and
  re-renders after every editing command.
- `webmcp.js` — registers WebMCP tools on `document.modelContext` so an
  in-browser agent can inspect and edit the open model through the same
  command functions the buttons call. Inert without the API or an open model.

All classic scripts sharing one global scope — **not** ES modules: the tests
depend on it, concatenating the files into one `vm` context. (The vendored
Monaco loads itself through its own AMD loader, outside that scope.)

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
node app/generate-vendor-monaco.js    # re-fetches app/vendor/monaco/ — only on a version bump (needs network)
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
- **A read is never authored** — the merged step ("It is only allowed if")
  is one step where there were two, because a boundary binding is not a
  thing anyone wants to declare: it is what a rule, a guard, an emission
  field, an emitted tag or another read *needs*. So the rule adder
  carries the read with it (`pendingBinding` in index.html builds the
  provisional binding; `record` appends binding and rule in one
  `patchSlice`, because a binding stored without its rule would be
  pruned by its own write), and the read card has no delete button.
  `bindingReferences` / `unreferencedBindings` (model.js) name the five
  reasons a read is consulted — rule, guard, emission, coverage, chain —
  and `updateDefinitions` prunes what nothing consults, transitively, in
  the same append: deleting the last rule about `theirs` takes the
  `students` hop with it. Pruning is deliberately *not* in
  `addDefinition`: a body arriving whole, from a file or a WebMCP tool,
  keeps what it came with and earns an advisory instead, and the next
  edit to that command is what drops it. All five reasons are
  load-bearing in the shipped models, and a test holds them free of
  unreferenced reads. The `boundary` stays authoritative in the wire
  format and cannot be recomputed from the rules — a rule names an
  alias, and only the binding records the path that alias stands for —
  which is why this is reference counting and not derivation.
  The rule adder is itself staged (`ruleEditor`): what it is about,
  which of that thing's values, what must be true of it — because a
  rule now spans what used to be two steps, and asking it all at once
  put five pickers in a row nobody could read as a sentence. A rule
  added from a read's own card, and every guard, starts at the second
  question; a rule opened for editing opens whole. There is no Next
  button: **which questions are on screen is derived from what has been
  answered**, never accumulated by the act of answering. That is the
  row's correctness, not a style choice — gate a question on a change
  event and any pre-filled picker deadlocks, because a `<select>`
  already showing the value you want fires nothing when you pick it,
  which is what stranded an entity whose single property was filled in
  for you. The first question is deliberately *not* pre-answered, or the
  row would answer itself and put every control on screen at once.
  Its picker offers only reads the command does not have yet — a read it
  already makes carries its own "+ rule about …" button, which is the
  other door into the same wizard and opens on the second question. A test authors
  `SubscribeStudentToCourse` through the three questions and compares
  the result to the shipped definition. Its first question offers only
  what the command can reach — entities some operand already in scope
  could identify, never projections (a rule is not about a folded
  value) — and inventing an entity there also gives the command the
  input that says *which* one, since a fresh identifier type is
  reachable from nothing.
- **Reads split by their reason** (`decisionAliases`, model.js): a read
  a rule or guard names, and every hop it was reached through, belongs
  to the decide step; everything else is read in order to *record*
  something — a projection whose value becomes an id, an instance whose
  tag the event writes — and is shown under the emission instead. So
  `DefineCourse` is plainly "Always allowed" with its numbering beside
  the event, and `UnsubscribeStudentFromCourse` shows the student it
  never tests where the tag that demands it is. The split is
  presentation only: both halves are one `boundary`, and the derived
  DCB is their union. Reads stay removable, and removing one takes the
  rules and guards about it while leaving reads further down the chain
  to dangle with an advisory — narrowing the boundary is never silent.
- **Write coverage is narrow, and advice only** (`emittedTagRequirements`,
  model.js): it flags a tag whose value this command *derived* — read
  off some instance it bound — and is silent for one taken straight
  from a command property, which the caller asserted. The reason is
  that an uncovered tag is not unsound: the append condition is the
  union of the bindings' queries, so the tag this command writes is
  what makes every *other* command that read that instance conflict
  with it, read or not. What an uncovered tag gives up is only this
  command's own protection against concurrent change, and where the
  decision never depended on that instance there was nothing to
  protect. One walk decides both what the advisory says and which reads
  a tag keeps alive, so pruning and the advisory cannot disagree about
  what a read is for. `UnsubscribeStudentFromCourse` therefore binds
  the course only: which student is asserted by the caller, and whether
  they are in the course is answered off the course.

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
  _error_, and so is a null boundary identifier _unless the binding is
  marked `isOptional`_ — then it binds zero instances, conditions over
  the alias hold vacuously, and reading a property of it yields null.
  The optional-parameter and derived-null advisories say all of this
  ahead of time.
- **One handler per event type, per projection** — and it is a real
  constraint, not a convenience: tag matching is by _value_, whichever
  property carries it, so an event holding one identifier type in two
  properties reaches both partitions and a handler fires for both. A
  declarative handler cannot tell them apart; the fix is to split the
  event (one fact each) or script the projection, and an advisory
  points at the ambiguity. The editors offer only unhandled events.
- **Wire format majors**: a new member of a closed vocabulary is a
  _major_, judged from the reader's side (see the versioning notes in
  `dcb-model.schema.json` and `model.js`). 4.0 added binding
  `isOptional` (additive in shape, but a 3.x reader errors where the
  flag declares the absence expected); 5.0 added the `equalsAny`
  predicate — one scalar against a literal list, spelled as a bare
  array of literals / `{enumMember}` references in `rightHandSide`, a
  spelling only initial values had before; 6.0 added guarded emissions
  and derived projections (below). The importer reads 3.x–6.x
  (`READABLE_MAJORS`) and always writes the current `MODEL_VERSION`.
- **Guarded emissions (6.0)**: a `publishes` entry may carry
  `when: [conditions]` — same operand and predicate vocabulary as
  `conditions`, evaluated in the same scope. A failing guard _skips_
  its emission, never rejects the command; every guard failing
  publishes nothing, which is still a `published` outcome. Guard reads
  count toward the derived DCB like condition reads (both flow through
  `forEachCommandOperand` — anything walking a command's conditions
  must walk each emission's `when` too, see `allConditions` in
  `validateCommandBody`).
- **Derived projections (6.0)**: a third projection kind — no handlers,
  no initial value, one declared predicate over other projections
  (`derived`), always a single boolean. Its query is its operands'
  union (`projectionHandledTypes` / `projectionReadTags`); a cycle is
  an advisory and an evaluation _error_; a body carrying both `script`
  and `derived` reads as scripted (`derivedOf` is null then) and the
  advisory says so. Derived is data, not code: it never trips the
  script import gate. The exploration that produced both blocks, and
  the case for keeping or dropping them, lives in
  `docs/research/2026-09-19-content-decisions-variant-comparison.md`.
- **Comment style**: file headers and block comments carry design rationale,
  not line-by-line narration. Match that register; keep headers truthful when
  behaviour changes.
- Near-zero dependencies is a feature. Monaco is the one deliberate
  exception — vendored, pinned, lazy-loaded, regenerated by script, and the
  plain textarea remains the fallback if it ever fails to load. Anything
  else that would introduce a package, bundler or test runner still needs a
  strong reason.
