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
`app/test-harness.js`, `require`d by all four suites.

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

- **The help is the documentation on dcb.events** — the notation guide
  and its reference, opened in a new tab (`openDocs`, shared.js) at the
  anchor for what the page is about (`docsHere`: the construct under the
  cursor in the code view, the page's kind elsewhere, the guide
  otherwise). There is no help modal any more; an `ⓘ` keeps its one
  line and links the reference. The anchors (`NOTATION_ANCHORS`) are a
  contract with the website: its build fails on a link
  `helpReferenceLinks()` lists that it does not define, so an anchor is
  added or renamed on both sides — until the website catches up with
  8.0, new constructs link the nearest existing one.
- **The experimental flag gates authoring, never reading**
  (`experimental()`, shared.js; it replaced the simple/advanced mode).
  What DCB is made of — types, events, projections, commands, the
  derived boundary — is always on screen; what the examples on
  dcb.events do not need is behind the flag: entities and lifecycles,
  derived projections, guarded emissions, optional reads, `excluding`,
  `currentValue`, projection scenarios, annotations, and the Coupling /
  Rule map / Event model / Lifecycles views. A model that uses any of
  it still loads, renders and evaluates whole; `experimentalFeatures`
  (model.js) names what it uses and `experimentalNotice` says so on
  every page. Gate an *offer* (an adder, a picker row, a tab), never
  the display of something stored. WebMCP is not gated. A share link's
  `&experimental` turns it on for the session without storing it. The
  decisions are in
  `docs/research/2026-10-05-explicit-tags-and-aliases.md`.
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
- **A read is never authored** — the merged step ("Rules")
  is one step where there were two, because a boundary binding is not a
  thing anyone wants to declare: it is what a rule, a guard, an emission
  field, an emitted tag or another read *needs*. Since 8.0 a projection
  read need not be a binding at all: an operand may be a read in place
  (`{projection, tags, arguments}`, `require CourseStatus tagged
  courseId == …`), and the rule adder writes a rule about a projection
  that way — it never invents an alias, which is the author's to write
  in the code view (`inlineReadOf`, swapped in at commit). Entity reads
  are still bindings. Inline reads are walked by `forEachCommandOperand`
  (it descends into their tags), counted once per spelling
  (`inlineReads`), placed in the query their tags wait for
  (`operandDepth`), and folded once per evaluation (`scope.inline`). So the rule adder
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
  could identify, and every projection (none declares a partition;
  "tagged by which value" is asked beside it, offering values whose
  tag type every handled event lists, defaulting to how the model
  already reads it) — and inventing an entity there also gives the
  command the input that says *which* one, since a fresh identifier
  type is reachable from nothing. A projection an entity property
  binds is not offered: it is read through the entity
  (`course.capacity`), and offering it bare too would make one fact
  reachable as two different reads. The others are what lets a model
  without entities or lifecycles state its rules on the pages, not
  only in the code view (`alias label = Label tagged documentId`).
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

- **An editor offers what the held type admits.** `operationsFor` and
  `hasSuccessor` (model.js) are the two rules, and both the change adder
  and the projection's handler editor read them — `operationControl`
  renders the verb as plain text where there is only one, since a
  one-option `<select>` is a control that looks like a choice. This was
  wrong in both directions once: the change adder offered the whole
  `OPERATION_WORDS` table regardless of type (a boolean was offered
  "goes up by" and "gains"), and both editors offered "the one after …"
  for booleans and enums, which stores fine and then fails validation.
  `hasSuccessor` exists so the editor offering an operand and the
  validator refusing it cannot read different rules. A boolean's two
  values are picked like an enum's members, but *beside* the literal row
  rather than instead of it — `draftFromOperand` turns any stored
  primitive back into a literal, so removing that row would strand every
  boolean fold the shipped models carry.
  Handler values are narrower still than validation: `successor` is
  offered only to `set` an integer or a named scalar value type
  (`offersSuccessor` — a numbering, never a plain string, never beside
  another verb), and `currentValue` is not offered at all (`set` to it
  is a no-op, `increment` by it doubles). Both stay in the wire format
  and still run when stored.
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
- **An event carries the tags it lists, and nothing else** (8.0,
  `tags` on the event, `eventTagLeaves` in model.js): a property of a
  tag type, or `items.productId` into a record, one tag per element of
  a list. Nothing is implied by a property's type — a tag-typed value
  left off the list is an ordinary value, and an event with no list
  carries no tag. The advisories say both (`eventTagAdvisories`): no
  tags, and each tag-typed value left unlisted. The pages keep the
  list in step with a field edit (`withEditedTags`, applied in
  `patch`) and show it on the event's row; a body arriving whole — a
  file, the code view, an agent — is stored as it says. Seeds and test
  fixtures write their lists with `tagPathsOf`, which is a convenience
  for stating them, not an inference at read time.
- **A projection declares no partition; the read names its tags**
  (8.0). A command's read is `{alias, projection, tags, arguments}` —
  `tags` the values it is read by (operands in scope, or a typed
  literal `{tagType, tagValue}`, `CourseId("c1")`), each keyed by its
  own type; `arguments` only what a script takes besides (`with`). An
  entity reads its properties tagged by its identifier, a projection
  scenario by literals, and a derived projection's operands by their
  reader's tags. So one fold is read per course and per student alike;
  a read by no tag is the whole log. Scripts see the tags as `tags`
  and have no `tagFilter`. Evaluation takes a *read* —
  `foldProjection(model, events, name, { tags: [{type, value}], args })`.
  What the model reads a projection by is derived
  (`projectionReads` / `projectionReadTagSets`), and is what the
  ledger row, the editor's "read by" and the State changes step say.
- **One handler per event type, per projection** — and it is a real
  constraint, not a convenience: tag matching is by _value_, whichever
  listed property carries it, so an event listing one identifier type
  in two properties reaches both reads by that type and a handler fires
  for both. A declarative handler cannot tell them apart; the fix is to
  list only one, split the event (one fact each) or script the
  projection, and an advisory on the read points at the ambiguity
  (`readTagProblem`). The editors offer only unhandled events.
  The opposite case is zero carriers: a handled event listing no tag of
  a type a read is by never reaches that read. That is an advisory on
  the *read* (`readTagProblem`, via `readTagsMissing`) — on the command,
  entity or scenario that reads it — since the projection itself has
  no partition to be wrong about. The State changes adder does not
  offer a projection whose every read the event misses; a State
  changes row about a standalone projection names the reads it moves
  in the command's terms (`changeArguments`: `Book exists tagged isbn`)
  and says which ones it misses.
- **Wire format majors**: a new member of a closed vocabulary is a
  _major_, judged from the reader's side (see the versioning notes in
  `dcb-model.schema.json` and `model.js`). 4.0 added binding
  `isOptional` (additive in shape, but a 3.x reader errors where the
  flag declares the absence expected); 5.0 added the `equalsAny`
  predicate — one scalar against a literal list, spelled as a bare
  array of literals / `{enumMember}` references in `rightHandSide`, a
  spelling only initial values had before; 6.0 added guarded emissions
  and derived projections (below); 7.0 made every rule carry a
  rejection message and a refusal be known by it (below) — required on
  both sides, so the importer reads 7.x only (`READABLE_MAJORS`): a
  6.x rule has no message, and none can be invented for it. It always
  writes the current `MODEL_VERSION`.
  **6.1 is the contrast worth knowing**: entity `lifecycle` is additive
  in shape *and* a minor, because a 6.0 reader that ignores it loses a
  derived diagram and misreads nothing — where 4.0's equally additive
  flag made the old reader error on the case it declared expected.
- **A lifecycle is designated, not named** (6.1): an entity carries
  `lifecycle`, naming one of its *own* property bindings — a local name
  like a command's alias, so it is not a reference slot and
  `MEMBER_REWRITES['entity-definition:property']` is what moves it on a
  rename. Nothing keys off the property's spelling any more: `exists` is
  what the one-click lifecycle types, `course-simple`'s Course calls its
  `status`, and both read the same.
  **No entity gets one unasked** (reversed 2026-10-01): `createEntity`
  makes a bare entity, from every place one is created, and a lifecycle
  is added only from the Identity block's `+ lifecycle` (`lifecycleAdder`)
  — *Exists (boolean)* in one click (`addExistenceLifecycle`, which
  re-designates a leftover usable `exists` rather than adding a second,
  and is withdrawn when `exists` is taken: `existenceLifecycleOffer`),
  *Named states (enum)* (the promotion form in `scratch` mode, where two
  states suffice), or an existing property. Since the existence wording
  keys off the designation, an entity without one never says "exists"
  anywhere. **Remove lifecycle** (`⋮`, `removeLifecycle`) drops only the
  designation; the property stays. Don't reintroduce a lifecycle from
  the change adder or the rule wizard — that is the scaffold back
  through another door. Pointing at a *projection* instead was
  rejected because a condition reads `{alias, property}`, so a lifecycle
  not bound as a property could never be guarded — which is the one
  thing a lifecycle is for.
  **The two-state case is a `boolean`**, not a two-member enum: no
  custom type, no vocabulary, nothing to learn before writing "the
  course must exist". `lifecycleOf` (model.js) flattens both spellings
  into one `states` list of strings (`['false','true']` for a boolean),
  so the machine, the constraint reader and the diagram never ask which
  they got; `isBoolean` is for the one thing that differs, how a
  condition names a state. A third state is a **promotion**
  (`promoteLifecycle`, index.html): it must invent an enum and name its
  members, so it is a form, never inferred, and it runs in one `run` —
  a model whose conditions still say `isTrue` while the projection has
  become an enum is the incoherent state the log has no migration for.
  Existence conditions are stored as ordinary `isTrue`/`isFalse` over an
  ordinary property and only *read* as "course exists"
  (`existenceRead` / `conditionParts`, shared.js) — no new predicate,
  and `evaluate.js` did not change. The rule wizard *writes* them the
  same way: its value picker offers `exists` / `does not exist` in
  place of the bare property, and that one pick stores `isTrue` /
  `isFalse` (never a negated `isTrue`) and skips the predicate
  question. The bare row comes back only for a rule opened with
  another spelling, so editing never silently rewrites one. A **dangling** designation is an
  advisory; scripted, derived, list or stateless ones are not — they are
  legitimate models (`content-decisions-scripted` ships one) whose
  machine cannot be drawn, which is the Lifecycles page's business to
  say (`lifecycleRefusal`). That page now shows every entity, compact
  for existence-only and the full band for three states or more,
  because the unguarded dot matters most in the simplest machine.
  The offer to promote is made in **two places, never in Problems**: the
  rule wizard, at the moment a rule brings two of them together, and the
  entity's own Identity block, where an author who just added two
  booleans is actually looking and no command need exist yet
  (`lifecycleMergeSuggestion` / `entityMergeCandidates`). It fires for
  **two or more monotone booleans of one entity** — whether one is the
  designation is irrelevant and requiring it was a bug: `registered` and
  `expelled` added by hand are exactly the shape, and neither is
  designated. **Monotonicity is the gate that matters**
  (`isMonotoneBoolean`): `registered`/`expelled` are stages,
  `registered`/`isPublic` are not, and collapsing the second pair
  destroys a dimension.
  `mergeIntoLifecycle` absorbs *n* booleans into one enum, and the
  condition translation is the subtle part: a boolean absorbed at step
  *i* held in **every state from *i* onward**, so `exists isTrue` becomes
  `equalsAny [Existent, Graduated]` — narrowing it to `equals Existent`
  silently strengthens the rule, which an earlier cut did.
  `statesWhereHeld` is that translation. Two guards fall out of it: two
  booleans moved by one event cannot merge (the merged fold would need
  two handlers for that event), and a non-monotone boolean is refused as
  a stage even when asked for directly.
  **Which property is the lifecycle is author-settable** from the
  Identity row (`designationPicker` / `lifecycleCandidates`) — offering
  only single-valued boolean and enum properties, plus "none". This
  reverses an earlier "no picker" decision: it left an author who builds
  a state property by hand unable to say so, and the promotion is no
  door to that, since it invents an enum rather than adopting one. A
  designation is never inferred — imports from before it existed did
  that once, at the gate, until 7.0 stopped reading them. The
  decisions and what was rejected are in
  `docs/research/2026-09-30-entity-lifecycle-as-boolean-existence.md`.
  **The Identity row is folded, not hidden**: with no lifecycle there
  is no row and no `not designated` — the identifier line carries
  `+ lifecycle` and nothing else. A lifecycle that exists was asked
  for, so it always shows, even unmoved (`set by —` is the next step);
  the old "quiet" case hid a boolean nobody had requested. The row draws
  the machine rather than describing it (`lifecycleTrack`, off
  `lifecycleMachines`, so the row and the Lifecycles band cannot
  disagree about what moves what). That row **starts folded**
  (`lifecycleFold`, `state.lcOpen`, session-only): folded, it rides on
  the identifier line — `state exists · set by …`, or `state status ·
  3 states` for an enum — and the `⋮` lives on that line in both
  states, so unfolding moves nothing. A refused lifecycle never folds;
  a fault is not hidden.
  The track is drawable only as a
  *chain* — up to three states, short names, every transition the step
  from one state to the next — and gives up to `lifecycleShapeWords`
  rather than wrapping; a jump or a way back is a machine, and a machine
  belongs on the Lifecycles page. The chip is the **property** in every
  branch: it used to be the setters when there were any and the property
  when there were none, which is why the empty case read worst, naming
  itself twice beside a label saying `exists once`. The actions sit
  behind one `⋮` (`lifecycleMenu`, faded not hidden, so it keeps its
  place in the tab order); `+ lifecycle` opens the same kind of panel
  (`lifecyclePanel`) but is never faded — with nothing designated it is
  the only lifecycle control on the page.
- **Guarded emissions (6.0)**: a `publishes` entry may carry
  `when: [conditions]` — same operand and predicate vocabulary as
  `conditions`, evaluated in the same scope. A failing guard _skips_
  its emission, never rejects the command; every guard failing
  publishes nothing, which is still a `published` outcome. Guard reads
  count toward the derived DCB like condition reads (both flow through
  `forEachCommandOperand` — anything walking a command's conditions
  must walk each emission's `when` too, see `allConditions` in
  `validateCommandBody`).
- **Every rule says what it is refused with (7.0)**: a command's
  conditions carry `rejection`, static one-line text (`rejectionProblem`,
  model.js), and a refusal is known by it and nothing else — a
  scenario's Then is `{outcome: 'rejected', events: [], rejection}`,
  without which rule refused or what it read, so rules sharing a
  message are one outcome, reordering them is never drift, and neither
  is a projection that stores its state differently. A run still
  reports the rule and its values (`failedRule`), which the sandbox
  and an open scenario show as detail (`liveRefusal`). The notation
  spells it `require … else reject "…"` (Weltenwanderer's, required as
  there) and `then rejected "…"`. A rule without one is an *advisory*, not a
  write-path refusal: it still evaluates — a run reports its condition
  text instead — but a scenario cannot name its refusal, so `deriveThen`
  reports it broken, and the printer falls back to JSON. A guard never
  rejects, so a message on one is an advisory too. The set of a
  command's messages is derived (`commandRejections`), never declared;
  the Rules step lists it and scenario coverage counts by it
  (`uncoveredRejections`). The rule wizard asks for the message last,
  required and deliberately not pre-filled with the condition's text.
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
- **The interface register is technical, on purpose.** The audience is
  developers who know what an event log is, so the page names things the
  way the wire format does and does not narrate. `null`, `""` and `[]`
  each keep their own spelling (`initialValueWords`); operand kinds read
  as their schema tokens (`currentValue`, `successor(x)`); step headings
  are `Payload` / `Rules` / `Append` / `State changes` /
  `Consistency boundary` / `Scenarios` — `Rules` and not the wire's
  `conditions`, because "rule" is the item word on every page (`+ rule`,
  the Rule map, `Refused with`), and not "Decision model", a term the
  literature uses without ever defining; empty steps are `—`; single-field
  forms carry noun labels (`New command`), not questions.
  Two things are deliberately *not* technicalised, and reversing either
  would be a regression, not a tidy-up. **Identifiers stay humanized** —
  `readable` / `propertyWords` turn `DefineCourse` into "Define course"
  and `courseId` into "course id", because that is what the author
  typed; the stored spelling rides beside it in a `.tech` span.
  The one exception is a value an event carried: it reads as the path
  `event.data.capacity` (stored name, monospace) in pickers and
  sentences alike, because it is a path — the one a scripted handler
  writes — and a humanized name inside a dotted path reads as a typo.
  In the open list it is short under an `event` heading; once picked it
  is whole (`pick`'s token options, `.ctx` spans).
  **Conditions and changes stay English sentences** — `PREDICATE_WORDS`
  and `OPERATION_WORDS` are untouched, the `·` separates alias from
  property, and the existence sugar still reads `course exists` (minus
  its article). Understanding what a command is guarded by is the point
  of the tool, and an author never typed a predicate to begin with, so
  there is no stored spelling being hidden.
  Explanations live in `hint(...)` — one `ⓘ` per section, never one per
  row, in both modes, linking dcb.events only where a page exists.
  Inline field hints are deleted; *derived facts* stay on the page,
  terse (`not designated`, `scripted fold`, `appended by: —`), because
  hiding a fact about the model behind a popover is the opposite of what
  the register is for. An entity, event or command carries a mark only
  if one was authored — there is no hashed fallback, and `iconPrefix`
  is what keeps an unmarked name from rendering behind a stray space.

- **The code view's language is a spelling of the wire format** (`dsl.js`,
  research in `docs/research/2026-10-03-code-view-language.md`): every
  construct is one schema shape, so print and parse are each other's
  inverse and nothing is inferred. The one spelling read but never
  printed is `x in xs` against a list in data (not a literal `[…]`):
  it is `xs contains x`, sides swapped, and prints back that way. The
  rule wizard's "is one of" offers the same — a list in scope beside
  the listed values — and writes the same `contains`; a payload list
  containing a read value reopens as "is one of" (`draftFromCondition`),
  since a payload value can never be a rule's subject there.
  Printing is **lossless by contract**:
  each definition is printed, parsed back and compared
  (`sameDefinition`), and one that does not survive is written as its
  stored JSON (`command Foo json { … }`) under a comment saying why. A
  test holds every shipped model and example file free of fallbacks —
  so **a new wire-format construct needs a spelling in the printer and
  the parser**, or that test fails the moment a predefined model uses
  it. Applying writes only the difference, through `replaceDefinitions`
  (one append, one undo step, nothing for an untouched text); like an
  import it never prunes reads. A rename in the text is a remove plus
  an add — except for scenarios, which carry no id in the text and are
  matched to stored ones by content, then by place in their block, so
  a command renamed in the text keeps them. Scenarios nest in the block
  of their subject (a mismatch is an error); a written Then is an
  assertion stored as written, an omitted one is recorded at apply
  (`completeScenario`), and drift is reported with a fix but never
  accepted by applying — the pages' rules, in text.
  **Scenarios sit in one `scenarios { … }` group**, the block's last
  statement (at the top level too, for those whose subject is gone).
  The group is syntax only, not wire format, and it is required
  because it is what the editor folds: folding comes off the tokens
  (`sourceFoldingRanges`, so it survives a text that does not parse),
  a group folds whole to one line, and the code bar's toggle, remembered
  per browser and folded by default, applies when a model's text opens.
  A group holding an error or a drift is left open by that fold — a
  fault is not folded away. A bare `scenario` is an error whose fix
  wraps its run (`ungrouped`), which is how a pre-group text reads.
  The stripe beside a group is `--scenario-stripe`, deliberately not a
  kind colour; a tint behind the lines was tried and dropped — faint
  enough not to distract, it was invisible.
  Operand names resolve per command — an alias when an `alias`
  declares the name, a payload property otherwise — so a parameter and
  an alias sharing a name is the one ordinary case that falls back to JSON.
  The **language service** (end of `dsl.js`) sits on parser *marks* —
  which token each part of a body came from, kept in a `WeakMap` beside
  the bodies so the parse result is still exactly the stored shape —
  and resolves every name to a symbol (`member CourseStatus Existent`,
  `alias DefineCourse course`): go to definition, references and F2
  rename all read that, never the bare word, which is what keeps
  `Existent` apart from `NonExistent` and the projection CourseStatus
  apart from the enum. Rename refuses rather than guesses (a name a
  script or json body may hide, a member whose enum cannot be told) and
  proves itself by re-reading the result. A test holds every name in
  every shipped text resolved, so **a new construct also needs its
  marks and a case in `sourceSymbols`**. Completion reads the cursor's
  context off the tokens, not the parse — the block being typed rarely
  parses.
  An `alias` names an instance, not what is queried of it — only the
  properties something uses contribute events (`deriveDcb`), which is
  why the keyword is `alias` and not `read` — so the editor says
  beside each alias how many types it adds, naming them
  on hover (`sourceReadQueries`: "reads 2 types"), and beside each
  command's `{` what it reads in all (`sourceCommandQueries`: "reads
  5 types, 2 tags, in 2 queries"),
  off `boundarySummary` (model.js) — the Consistency boundary step
  speaks from the same function, so the two cannot disagree. A chain
  is read in as many *queries* as it is deep; the interface says
  "queries", never "rounds" or "trips" (`deriveRounds` keeps its name);
  don't add syntax that lists them, that is a derived fact authored
  twice. Fold arms stay **keywords, not expressions** (`set`,
  `increment`, …): the vocabulary is closed because it is analysed,
  `script` is the expression door, and the reasoning is in the
  `dsl.js` header — read it before adding `=> state + 1`.
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
