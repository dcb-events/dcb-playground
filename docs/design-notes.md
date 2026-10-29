# Design notes

The reasoning behind the playground's design, by area: what each part
does, why it is that way, and what was tried and dropped. A section
here is the record to read before changing that area; AGENTS.md points
at it. The dated investigations behind many of these live in
`docs/research/`. Keep a section current when its behaviour changes,
and prune what no longer holds.

## Shipped models

- **The shipped models use no groups**: the examples on dcb.events
  read projections in place, and a group is a naming device they do
  not need. The suites build their grouped course models from code
  view text (`FIXTURE_TEXTS` in ui.test.js: `course-groups`, and
  `course-schedules` with a chain of three reads) or by moving a
  shipped model's projections into a group (`grouped(...)`) — what
  the retired `course-entities` and `course-schedules` became (11.0).
  A model from seed layers alone is `seeded(...)`. A `PREDEFINED_MODELS` entry's
  `experimental` mark says whether it uses anything experimental, and
  a test holds the mark to the built model's `experimentalFeatures`.
- **The playground ships no examples.** The examples live on
  dcb.events, each page opening its model here through a share link;
  the models dialog links there (`EXAMPLES_URL`). `PREDEFINED_MODELS`
  and the seed builders stay as the suites' fixtures and as what
  `print-model.js` prints; the former example files that carry
  authored scenarios, which no builder produces, live on in
  `fixtures/` for `dsl.test.js`.

## The experimental flag

- **The experimental flag gates authoring, never reading**
  (`experimental()`, shared.js; it replaced the simple/advanced mode).
  What DCB is made of — types, events, projections, commands, the
  derived boundary — is always on screen; what the examples on
  dcb.events do not need is behind the flag: scripted projections,
  guarded emissions, optional reads, `currentValue`, and the Coupling /
  Rule map / Event model views. Groups are not on the list: a naming
  device with no consistency meaning has nothing to hide. Entities,
  lifecycles and `excluding` were on it until 11.0 removed them. A model that uses any of
  it still loads, renders and evaluates whole; `experimentalFeatures`
  (model.js) names what it uses and `experimentalNotice` says so on
  every page. Gate an *offer* (an adder, a picker row, a tab), never
  the display of something stored. The code view does the same: with
  the flag off, completion leaves those constructs out
  (`sourceCompletions(…, { experimental })`) and the editor marks the
  ones a text uses at info level (`sourceExperimentalMarks`, read off
  the tokens) — never an error, the text applies whole. A share link's
  `&experimental` turns it on for the session without storing it. The
  decisions are in
  `docs/research/2026-10-05-explicit-tags-and-aliases.md`.
  **Derived and scripted swapped places** (9.0, 2026-10-11): derived
  projections left the flag when they learned to compute — they are
  data, analysable, and they cover the case that most often sent an
  author to a script (a value worked out from two others, e.g. a weekly
  budget less that week's allocations). Scripts took their place: the
  escape hatch stays for what neither the operations nor a derivation
  can say, and stays readable and editable on a model that has one —
  but it is no longer offered, to authors without the flag or to
  agents at all. `content-decisions-scripted` ships on as the
  experimental baseline of the 2026-09-19 comparison; its script-free
  variants (`-derived`, `-guarded`) already ship beside it, and it is
  not rewritten — its five-state status needs a case expression, which
  no real model has asked for yet.
- **WebMCP offers nothing experimental, flag or no flag.** No
  experimental member in a tool schema (cut by
  `generate-webmcp-schemas.js`), nothing experimental in the language
  reference (`sourceLanguageReference`), and an agent's edit that would
  introduce a use is refused (`introducedExperimentalFeatures`). Following
  the flag would have meant re-registering the tools on every toggle and
  an agent API that changes with browser state. Gating stays an offer:
  a model already using those constructs reads whole over WebMCP and
  stays editable, since only a use the model does not already have is
  refused — hiding them from `get_model_source` would have made an
  apply delete them.

## Reads, rules and the rule adder

- **A read is never authored** — the merged step ("Rules")
  is one step where there were two, because a boundary binding is not a
  thing anyone wants to declare: it is what a rule, a guard, an emission
  field, an emitted tag or another read *needs*. Since 8.0 a projection
  read need not be a binding at all: an operand may be a read in place
  (`{projection, tags, arguments}`, `require CourseStatus(courseId)
  == …`), and the rule adder always writes a rule about a projection
  that way (`inlineReadOf`, swapped in at commit). It used to offer an
  optional "as" beside the projection's tags; that was removed, because
  a name field in the middle of the first question was one more thing
  to answer before the rule existed, and since the right side reads
  projections in place too, a name is rarely needed. A read is named
  afterwards instead: a selected rule or guard offers "Add alias" (one
  button per read in place it names, labelled with the read when there
  are two), which swaps the read's name in the sentence for a field
  (`state.aliasing`); Enter binds the read under the name and points
  every spelling of it in the command at the alias (`aliasInlineRead`,
  model.js), since those are one read already. The read card's "Remove
  alias" goes back (`inlineAliasedRead`), offered only while every use
  is the read's whole value in a rule, guard or emission field
  (`aliasInlinable`). The pages never pick an alias for a projection
  themselves. A name the command already uses for a read or an input
  is refused in the field (`aliasNameProblem`), not left to an
  advisory: an alias sharing a name with an input is what the code
  view cannot print back. A read in place reads as a call, `Developer
  seniority (developer)`: the name in the projection colour, the
  brackets muted, and each value an `opRef` of its own, so a tag lights
  the input it came from (`projectionReadRef`). It replaced "Developer
  seniority tagged developer", which was too long to scan in a rule. A
  grouped projection is read the same way, `Course(courseId).capacity`,
  or through a group alias (`alias course = Course(courseId)`, then
  `course.capacity`), which is a binding. Inline reads are walked by `forEachCommandOperand`
  (it descends into their tags), counted once per spelling
  (`inlineReads`), placed in the query their tags wait for
  (`operandDepth`), and folded once per evaluation (`scope.inline`). So the rule adder
  carries the read with it (`pendingBinding` in index.html builds the
  provisional binding; `record` appends binding and rule in one
  `patchSlice`, because a binding stored without its rule would be
  pruned by its own write), and the read card has no delete button.
  The right side offers a projection nothing reads yet the same way, read
  in place, once per way the scope can fill its tags
  (`projectionReadChoices`): with no bindings to put a second projection
  in scope, two projections could otherwise never be compared
  (`DeveloperSeniority(developerId) >= RequiredSeniority(projectId)`).
  `bindingReferences` / `unreferencedBindings` (model.js) name the five
  reasons a read is consulted — rule, guard, emission, chain,
  serialisation —
  and `updateDefinitions` prunes what nothing consults, transitively, in
  the same append: deleting the last rule about `theirs` takes the
  `students` hop with it. Pruning is deliberately *not* in
  `addDefinition`: a body arriving whole, from a file or a WebMCP tool,
  keeps what it came with and earns an advisory instead, and the next
  edit to that command is what drops it. All five reasons are
  load-bearing in the shipped models, and a test holds them free of
  unreferenced reads. Serialisation is the one that names no alias: a
  binding to a projection that takes no tags reads every event that
  projection folds, so it serialises the command against all of them —
  which is how a command with no conditions is made strictly serial, as
  the schema promises. It was once pruned as unreferenced on the next
  edit, leaving an empty append condition where the schema said there
  would be one; such a binding is now kept whatever else consults it. The `boundary` stays authoritative in the wire
  format and cannot be recomputed from the rules — a rule names an
  alias, and only the binding records the path that alias stands for —
  which is why this is reference counting and not derivation.
  The rule adder is itself staged (`ruleEditor`): what it is about,
  which of that thing's values, what must be true of it — because a
  rule now spans what used to be two steps, and asking it all at once
  put five pickers in a row nobody could read as a sentence. Every
  guard starts at the second question; a rule opened for editing opens
  whole. There is no Next
  button: **which questions are on screen is derived from what has been
  answered**, never accumulated by the act of answering. That is the
  row's correctness, not a style choice — gate a question on a change
  event and any pre-filled picker deadlocks, because a `<select>`
  already showing the value you want fires nothing when you pick it,
  which is what stranded a group whose single projection was filled in
  for you. The first question is deliberately *not* pre-answered, or the
  row would answer itself and put every control on screen at once.
  Its picker lists the reads the command already makes first, by
  alias, then the ones it could start. Reads used to carry their own
  "+ rule about …" button instead, with the rules nested in the read's
  card; that was reverted because a rule about two aliases, or about a
  read in place, had no card to sit in. Now the read cards come first
  and every rule follows in one `--rule` card, in the order they are
  checked and can be dragged into — the order the code view prints. Each
  rule's message trails it, muted, as ` — else "…"`. A test authors
  `SubscribeStudentToCourse` through the three questions and compares
  the result to the shipped definition. Its first question offers only
  what the command can reach — groups (`group:Course`, read through a
  new alias, the group's tag a picker beside it), and every top-level
  projection, with a picker per tag it declares beside it — values in
  scope of that tag's type, `each` of a list of them, and `+ new input
  …`, the only offer when nothing in scope has the type: committing
  adds a command property named after the tag (`newReadInputs`). A
  grouped projection is not offered on its own: it is read through
  its group (`course.capacity`), and offering it bare too would make
  one fact reachable as two different reads. A rule never creates a
  group. The top-level projections are what lets a model without
  groups state its rules on the pages, not only in the code view
  (`require Label(documentId) == …`). Existence rows ("the student
  exists" as one pick) went with lifecycles: `student.exists is true`
  is an ordinary rule about a boolean.
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
- **No write coverage** (gone with entities, 11.0). It flagged an
  emitted tag whose value was read off an entity instance the command
  had not bound; a group names no instance an event writes, so there is
  nothing to cover. An uncovered tag was never unsound anyway — the
  append condition is the union of the reads' queries, and the tag this
  command writes is what makes every *other* command that read that
  instance conflict with it. `UnsubscribeStudentFromCourse` binds the
  course only: which student is asserted by the caller.

- **An editor offers what the held type admits.** `operationsFor` and
  `hasSuccessor` (model.js) are the two rules, and both the change adder
  and the projection's handler editor read them — `operationControl`
  renders the verb as plain text where there is only one, since a
  one-option `<select>` is a control that looks like a choice. This was
  wrong in both directions once: the change adder offered the whole
  operation list regardless of type (a boolean was offered
  `increment` and `append`), and both editors offered "the one after …"
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
  A plain scalar value type counts as what it wraps, for predicates as
  for operations (`underlyingScalarType`, `predicatesForType` given the
  model): `Hours` over an integer is ordered and decremented like one.
  Predicates used to go by the type's name alone, so wrapping an
  integer in a named type left it only `equals`. An identifier (a tag
  type) and an enum stay identity-only, whatever they are spelled in.

## Tags: events, projections, handlers

- **An event carries the tags it lists, and nothing else** (8.0,
  `tags` on the event, `eventTagLeaves` in model.js): a property of a
  tag type, or `items.productId` into a record, one tag per element of
  a list. Nothing is implied by a property's type — a tag-typed value
  left off the list is an ordinary value, and an event with no list
  carries no tag. The advisories say both (`eventTagAdvisories`): no
  tags, and each tag-typed value left unlisted. The pages keep the
  list in step with a field edit (`withEditedTags`, applied in
  `patch`) and show it as a `tag` toggle on each field's row
  (`eventTagToggles`) — the code view marks it in place too, `tag
  courseId: CourseId`, `items: Item[] tag each productId`; a body
  arriving whole — a file, the code view, an agent — is stored as it
  says. Seeds and test
  fixtures write their lists with `tagPathsOf`, which is a convenience
  for stating them, not an inference at read time.
- **A projection declares the tags it is read by; a read gives their
  values** (8.0). `tags: [{name, tagType}]` on the projection — empty
  is an *untagged* one, which folds the whole log, and the code view
  makes that a decision (`untagged projection …`; neither is an error
  with both fixes, and the pages' new-projection form will not save
  until one is taken). A read is `{alias?, projection, tags,
  arguments}` with `tags` keyed by the declared names
  (`readTagEntries`) — values in scope of the declared
  type, or a typed literal `{tagType, tagValue}`, `CourseId("c1")`.
  The declared type is the key; a value of another type is an advisory
  (`readProblem`) and an evaluation *error*, never a fold of the wrong
  instance. The text writes reads positionally, `CourseStatus(courseId)`
  — tags then its arguments, in declaration order, always with
  parentheses (`CourseNumbering()`) — so the printer and the parser
  need each projection's declaration (`sourceNamesOf`,
  `options.projectionParameters`), and a call is a read or a tag
  literal by whether a projection has its name (`settle`). The call
  form is deliberate: a read is a pure function of the log, its tags
  and arguments; brackets were rejected as reading like a stored
  table. What a projection is kept per is its own to say, so a count
  per course and per student are two projections — the reuse the
  tagless draft allowed was dropped for the coupling it caused. A
  grouped projection declares no tags: it is read by its group's one
  (`projectionsOf` gives it its effective body, `tags: [group.tag]`).
  A derived operand gives its target's
  tags by name, each one of the owner's own (`{parameterName}`) or a
  literal. Scripts see `tags.<name>` and `args.<name>`, and have no
  `tagFilter`. Evaluation takes a *read* —
  `foldProjection(model, events, name, { tags: { courseId: 'c1' }, args })`.
  Renaming a projection's tag is a member rename
  (`MEMBER_REWRITES['projection-definition:tag']`) that moves every read
  keyed by it. A read fans out where it says so, `each` on the value
  (`{each: operand}`): it is made once per element, and a rule over it
  holds for every one, paired by index with values read from the same
  list (`fanRootOf` / `isZipped`). A group read fans out the same way,
  `Course(each …)`, and a list read without `each` is an advisory and
  an error. An emission cannot take a fanned read.
- **A projection's parameters are its tags, then its arguments**
  (10.0). An argument (`arguments: [{name, propertyType}]`) is a value
  a read gives besides its tags — after them, positionally, in the
  text — and it narrows nothing: the store returns the same events
  either way. Until 10.0 only a script had them (`script.arguments`);
  now any projection does, and a derived one is what they are for
  (below). A declared projection's handlers see only the event, so an
  argument there is an advisory, never a refusal. **Tag-ness is
  declared, not read off the type**: the editor shows one `parameters`
  list with a `tag` toggle per row, as an event's fields have — offered
  only for a tag type, ticked as one is picked, locked on for a
  declared projection. Inferring it from the type was the first idea
  and was dropped: flipping `isTag` on a custom type would silently
  change every projection's query, and a value of a tag type that is
  deliberately not a tag (one student, asked about within a course's
  fold) would have no spelling. The text keeps the `tag` keyword for
  the same reason, and a tag after an argument is a parse error
  (reads are positional). Toggling a saved parameter moves it between
  the lists and every read's value with it, a literal respelled
  (`setProjectionParameterIsTag`); renaming one is a member rename
  (`projection-definition:argument` beside `:tag`), and a tag and an
  argument share one namespace. Through a group, arguments go on the
  member read, never the group call: `course.seatsOn(slot: s)`.
- **One handler per event type, per projection** — and it is a real
  constraint, not a convenience: tag matching is by _value_, whichever
  listed property carries it, so an event listing one identifier type
  in two properties reaches both reads by that type and a handler fires
  for both. A declarative handler cannot tell them apart; the fix is to
  list only one, split the event (one fact each) or script the
  projection, and an advisory on the projection points at the ambiguity
  (`projectionTagProblem`). The editors offer only unhandled events.
  The opposite case is zero carriers: a handled event listing no tag of
  a type the projection is tagged by never reaches it. That is an
  advisory on the *projection* too (`projectionTagProblem`, via
  `readTagsMissing`), since it is the projection that declared the
  tags. The State changes adder does not offer a projection the event
  cannot reach; a State changes row about a standalone projection
  names the instance it moves in the command's terms
  (`changeArguments`: `Book exists tagged isbn`).

## Wire format versions

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
  9.0 added `operator` on a derived value (below): a new member of a
  closed vocabulary, so a major, but nothing an 8.x document says
  changed, so this build reads 8.x and 9.x (`READABLE_MAJORS = [8,
  9]`), the first time since 7.0 that an older major is read. No
  stored shape changed either, so `EVENT_LOG_KEY` did not move.
  10.0 moved `arguments` from a script onto the projection and let a
  derived operand be one of its owner's parameters (`{parameterName}`,
  below): a moved field and a new operand member. The one 9.x shape
  that moved is lifted on import (`liftScriptArguments`), so this build
  reads 8.x to 10.x; the stored shape moved, so `EVENT_LOG_KEY` did.
  10.1 accepts names in any alphabet (dcb-events.github.io#92): every
  name rule tests Unicode letters (`\p{Lu}`, `\p{Ll}`, `\p{L}`, marks,
  digits) where it tested ASCII, casing unchanged – so a script without
  case (CJK) still cannot write a PascalCase name. A minor: a 10.0
  reader skips such a definition with a reason and misreads nothing.
  11.0 removed entities (and `lifecycle`, `excluding`) and added
  `groupDefinitions`, which own their projections. This build reads
  8.x to 11.x: an entity is converted on import
  (`groupsFromEntities`, see _Groups_), and the import's toast says
  what became of each.
  **6.1 is the contrast worth knowing**: entity `lifecycle` was additive
  in shape *and* a minor, because a 6.0 reader that ignores it loses a
  derived diagram and misreads nothing — where 4.0's equally additive
  flag made the old reader error on the case it declared expected.

## Groups

- **A group names projections that share one partition tag** (11.0).
  `group Course (tag courseId: CourseId) { … }` owns its projections:
  they are declared inside it, carry no tag of their own, inherit its
  one, and have lowercase local names — `Course.capacity` outside,
  `Course(courseId).capacity` or `alias course = Course(courseId)` then
  `course.capacity` in a command. It means nothing for consistency
  (reading `course.capacity` queries only `capacity`'s events), so it
  is not experimental and nothing about it is gated. It replaced
  entities, which kept being read as aggregates, and their lifecycles;
  the decision and what was rejected are in
  `docs/research/2026-10-28-groups-replace-entities.md`.
- **Everything reads the flattened view** (`projectionsOf`, model.js):
  top-level projections and every group's under its qualified name,
  with effective bodies. The interface asks it for any projection by
  name, so a grouped one opens the ordinary projection editor
  (`state.projDraft.name` is `Course.capacity`), autosaves into its
  group (`updateDefinition` takes the qualified name), and is renamed
  by its local name.
- **On Projections a group is a section, not a page** (`groupSection`,
  index.html): a heading with its mark, name, one tag chip and size,
  over a ledger of what it owns — the top-level rows minus the tag
  column, named locally. **Folded by default** (`state.groupOpen`,
  session-only): a model with several groups reads as their headings
  first. The heading's actions — its own `+ projection`, Icon, Rename,
  Remove — show only once it is open; folded, it is only the way in.
  Anything that goes to a group (a chip, a problem, the code view)
  unfolds it and lands on its heading (`goToGroup`).
- **Making one.** `+ group` beside `+ projection` (`newGroupForm`) asks
  a name, the one tag — a tag the model already reads by
  (`groupTagChoices`) or a new name and type — and an optional mark;
  the group is made empty (an advisory says so) and shown open. A
  group's own `+ projection` makes one inside it, whose wizard skips
  the partition step. A projection made from a command's modal may go
  into an existing group (`newProjectionQuestion`'s `in` picker), but
  nothing on a command page creates a group.
- **Moving in and out are refactorings, one append each.** A
  projection with exactly one tag offers "Move into group…"
  (`projectionMoveChoices`): every group whose tag it matches
  (`groupsAccepting`), and "New group…", which prefills that tag and
  suggests the name from its type (`suggestGroupName`, `CourseId` →
  `Course`), then moves it in. Offering "New group…" even when no group
  accepts it is what makes the first group reachable from a
  projection. A grouped projection offers "Move out of group". Both
  rewrite every read (`moveProjectionIntoGroup` /
  `moveProjectionOutOfGroup`) and keep the row open under the new name.
  **A command's reads move in through an alias** (`aliasGroupReads`,
  shared with the import of 10.x entities): `CourseExists(courseId)`
  becomes `course.exists` beside `alias course = Course(courseId)`,
  not `Course(courseId).exists` repeated in every rule. An alias bound
  to the projection itself folds into the group's. An alias of the group
  with the same tags and optionality is reused, so moving several in
  gathers them under one; an optional read never merges with a
  required one, since that would change when the command refuses. A
  new alias is named off its value (`aliasBaseFor`: `courseId` →
  `course`, `each subscribedCourseIds` → `subscribedCourses`) and
  numbered past the command's names. Derived projections and scenarios
  have no aliases and keep the read in place. Moving out goes back to a
  read in place, and drops an alias nothing reads any more.
- **Agents get groups too** (webmcp.js). `group-definition` is one of
  the generic definition kinds (`add_`/`update_group_definition`,
  `remove_definition`, `rename_definition`, `rename_member` with
  memberKind `projection`), and the projection tools take a qualified
  `Course.capacity` the way `addDefinition` / `updateDefinition` do —
  so the generator widens the projection kinds' `name` pattern to a
  qualified name and requires `tags` only in words (top-level only).
  The page's gestures are tools of their own, on the same functions:
  `create_group` (`createGroup`, tag type made alongside),
  `add_group_projection` (`addGroupProjection`, its schema the group's
  inner projection shape) and `move_projection_into_group` /
  `move_projection_out_of_group`. A scripted grouped projection is
  cut from the schemas and refused like any experimental use.
- **A grouped read shows the group, then the member**: `Course (course
  id) · capacity` with the group's mark, wherever a read is shown
  (`projectionReadRef`, `operandWords`); a group alias reads as
  `course · capacity`. The event model's read columns are per group.
- **Old files convert on import** (`groupsFromEntities`): an entity
  becomes a group when every projection it binds is tagged by exactly
  its identifier and bound by no other entity, under its binding names,
  with direct reads rewritten to go through the group; any other is
  restated as plain reads. `importModelFromEnvelope` reports each as
  `converted`, and `finishImport` says so in the import toast, as news
  rather than an error — nothing was lost.
- **No designated lifecycle replaces the old one.** A lifecycle is an
  ordinary boolean or enum projection that conditions read; the
  Lifecycles view, the Identity row, the designation and the
  promote/merge offers went with entities. What came back is the
  drawing, for every enum projection and with nothing designated (see
  _The projection editor_, the Lifecycle tab). The event model orders commands by feature and, within
  one, as they were written (`eventModel`, shared.js), which puts the
  creating command first in practice; it used to follow the lifecycles.

## The projection editor

`projectionFields` (index.html) is the one editor for a projection —
on Projections, inside a group's section, and in the definition modals.

- **Sections, with what it works out to beside them.** On the left:
  `partition` (its tags, then its arguments – `tags` until 10.0),
  `initial state` (type, cardinality, `starts at` – `value` for a
  derived projection, which has none), `handlers` (or the
  derived predicate) and `advanced`, each headed in monospace with its
  one `ⓘ`; on the right, `projectionUsage`: the query as one line
  ("1 call · 2 types · 1 tag") with the query itself behind the query
  glyph, the checks count (a way to the
  Checks tab on an open row) and, behind the switch, who reads it and
  what binds it. The two columns wrap into one where they do not fit,
  which is the modal and a phone. This replaced one column of
  sentence-labels ("it holds", "starting at", "and it moves when one of
  these is recorded") whose explanations sat inline as prose.
- **`null` is a value of the initial picker**, beside the type's own
  values (`false`, `true`; an enum's members), or beside `value…` /
  `list…` for a type typed in or a list (`initialValueControl`). It
  used to be a null/value radio pair in front of the value; one picker
  says the same, and `null` still never hides behind an empty box.
- **The Advanced switch** (`projectionAdvanced`, remembered per
  browser) holds what most projections never need: making it derived
  (`derived projection`) or scripted (`scripted projection`, behind the
  experimental flag too), and the `read by` / `bound as` facts. It hides
  offers, never what is stored — a scripted or derived projection shows
  its section with the switch off, the way the experimental flag
  works.

- **A new projection is a name, then a wizard**
  (`PROJECTION_WIZARD_STEPS`), the command wizard's treatment: the name
  is stored at once, and its editor is revealed one section at a time –
  what produces its value (three answers, `From events` / `From other
  projections` / `From code`, the last behind the experimental flag;
  the Advanced switches once the wizard is over), its partition, its
  initial state (not for a derived projection), what moves it, and a
  proposed first check. Partition comes before the initial state
  because it decides which events can reach it; kind comes first
  because it decides what a parameter may be. An empty step is skipped
  by name (`Skip – untagged …`, `Skip – nothing moves it yet`), and
  skipping the partition *is* the untagged answer, which retired the
  `undecided –` door for a new projection. `Show all steps` ends it, and
  so does folding the row away. Earlier drafts asked "What is this
  projection of?" with the whole editor under it; a simpler
  reveal-only variant (no kind step, no guesses) was weighed and
  dropped for this one.
- **The name proposes, the steps show it** (`projectionGuess`,
  `handlerGuesses`, `projectionCheckGuess`): a tag type the name starts
  with (or a trailing `For<X>`) is its partition, `…Count` an integer at
  0, `…Exists` a boolean at false, `…Status` the enum it ends with,
  `…Ids` a list of that id, `Has…` / `Can…` / `…Remaining…` / `…Left`
  derived. Handlers are proposed on reaching that step, one per event
  that reaches it and shares a word with the name, the verb read off
  the event (`Un…`, `…Removed`, `…Archived` undo). A step holding a
  guess says so ("Guessed from its name"); a guess it cannot make is
  left out rather than made badly. The check folds the *first* handled
  event – one of each would let a subscribe and an unsubscribe cancel
  out. Asked from a command (the definition modal), a name that says no
  partition takes the command's one tag-typed input. A projection made
  inside a group skips the partition step: its tag is the group's.
- **A handler is one line** however long the event's name: the pickers
  give way and end in an ellipsis, the event's first, then the value's
  (the end of `event.data.…` is the part that says anything); the
  operation keeps its width. A phone lets the row wrap again.
- **A handler's event reads as the event** (`select.kind-event`): the
  picker wears the event chip's colours while it rests, and is a
  picker again once pointed at or focused – the rows read as which
  events move the value, not as a stack of controls.
- **`+ handler` sits under the handlers**, not in the section's
  heading: with a few rows the heading's button read as belonging to
  none of them, and the next handler goes at the bottom anyway.
- **A projection with handlers has a Lifecycle tab** (`projectionLifecycle`
  and `projectionMovements`, index.html; `lifecycleOf`, shared.js),
  beside Definition and Checks: how its value moves. Nothing is stored
  or designated; it is worked out from the draft, so an edit shows the
  moment the tab is switched. Derived and scripted projections have
  none. A single-valued enum or boolean is a machine
  (`lifecycleMachine`); anything else – a number, a string, a list – is
  its movements (`lifecycleMovements`): where it starts, each handler
  with the commands appending its event and their rules over the value,
  then the commands that only read it. No states are invented for
  those, and no command is marked unguarded there: a counter is guarded
  through other projections as a rule. In the machine, states are the
  members or `false`/`true` (`null` first when it starts or can be set
  there); a handler setting
  a member is an arrow, starting where its publishers' rules allow
  (`require` and the emission's own `when`, read as a direct read or a
  group alias alike). A command nothing guards gets the pink dot, and
  its arrow starts at the initial state, dashed – or, when it leads
  back there, at every other state reached. What cannot be read
  is said under the machine, not drawn: a state taken from event data,
  a rule comparing with a parameter, a command reading two instances
  or `each`. While any of that is there no state is called terminal.
  A tab, not a section of Definition: it answers a different question
  from what the projection is, the way Checks does. Decided in
  docs/research/2026-10-28-lifecycles-for-enum-projections.md.
- **The mindmap where it fits, a list where it does not.** Both views
  are built and a container query on the tab's width shows one: the
  mindmap of design/lifecycles/Main.dc.html when its computed width
  fits, else the states down a spine with the arrows leaving each one
  as rows (`lifecycleList`). The detail is never wider than about
  700px, so a machine of five states is a list on any screen. Curves
  were tried for the narrow view and dropped: a few transitions back
  and forth piled their labels onto each other. The commands allowed
  in a state open on hover, focus or a tap that pins them, and close
  on Escape or a press anywhere else. Nothing in it navigates – events
  and commands are kept free to become draggable.

## Guarded emissions, rejection messages, derived projections

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
  scenario coverage counts by it (`uncoveredRejections`). The Rules
  step used to list the set as well ("Can be refused with"); it was
  dropped, since each rule already ends in its message. The rule wizard asks for the message last,
  and it is optional there: left empty, the rule is refused with what it
  requires, said from the rule (`derivedRejection`, shared.js) —
  `Developer seniority must be at least Required seniority`, reads
  named without their tags, cut at the length limit — and the field's
  placeholder shows that message while it is empty. This reverses an
  earlier decision (required, never pre-filled, since the condition's
  text is what a message is there to replace): having to write a
  sentence before the rule was saved got in the way of modelling, and
  a derived message is still a valid, static outcome a scenario can
  name. Editing a rule whose message equals its derivation opens the
  field empty, so the message follows the edited rule; a message the
  author wrote is never touched. Only the wizard derives — the wire
  format, the code view and WebMCP still require the message.
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
- **Derived computations (9.0)**: a derived projection may compute
  instead of compare — `operator` (`add`, `subtract`, `multiply`,
  `min`, `max`) in place of `predicate`, never both, over two single
  numbers (reads or literals), holding a number: an integer from two
  integers (`derivedResultBase`), declared as such or wider. **One
  operator per projection**: a longer expression is a chain of derived
  projections, so every intermediate value has a name the sandbox can
  watch and an editor needs no expression tree. **No `divide`**: an
  integer stays an integer and there is no division by zero to define.
  **No internal/external split**: a derived projection keeps no state,
  so the "private bookkeeping, public value" shape a script gets from
  `exposes` is composition here — the operands are the bookkeeping.
  **Null in, null out** (`evApplyOperator`): an unknown side is not
  zero, and a rule ordering against the null is an evaluation error as
  any null ordering is; the advisory says so ahead of time when a side
  may be null (`derivedInputOf` — a declared projection starting at
  null, or a computation over one), which is why `developer-hours`
  starts the weekly budget at 0. Picking an operator in the editor
  sets the type from the operands; a comparison is always `boolean`.
  No case/conditional expression: it is the one thing that would turn
  `content-decisions-scripted` into data, and no real model has needed
  it yet.
- **Derived projections compare and compute with their parameters
  (10.0)**: a side may be one of the owner's own parameters, by name
  (`{parameterName}`; `Free(courseId) >= seats` in the text), and so
  may an operand's tag or argument — whether the owner reads it as a
  tag or takes it as an argument, checked by type alone. That is what
  lets the request be part of the declared decision:
  `developer-hours`' `DeveloperHasHoursForWeek(developerId, week,
  hours)` holds the comparison `AllocateHours` used to state itself.
  An owner's argument given as an operand's *tag* does narrow that
  operand's query — `foldedReads` takes a read's arguments with its
  tags, so the boundary still names it. A parameter compared with a
  single value must be of its kind (`literalKindOf`), an advisory;
  a parameter is never assumed null, since a reader's null is the
  reader's advisory to raise. At least one side still reads a
  projection: a predicate over parameters alone reads nothing.
- **A derived read is its operands' queries, each under its own tags**
  (`foldedReads` / `readItems`, model.js). Until 9.0 a derived read was
  one query item: the derived projection's own tags ANDed with the
  union of its operands' event types — right only while every operand
  is kept per the same tags. A computation made the other case the
  ordinary one: `DeveloperRemainingHoursForWeek(developer, week)` folds
  a budget kept per developer and allocations kept per developer *and*
  week, and one AND of both would never match a registration, leaving
  it out of the boundary. So `deriveDcb` now emits one item per
  projection a read folds in the end (`via` names it), each operand's
  tags filled in from the read through the `{parameterName}`s it passes
  on; consumers that looked one item up per alias take all of them
  (the read's query popover, the code view's hint, `boundarySummary`).
  The sandbox's watch card says the same.

## The interface register

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
  **A picker row that is not a value does not look like one.** The
  placeholder names what goes there — `event`, `type`, `which one?`,
  muted, lower case, no `— x —` dashes — and is out of the open list,
  since choosing it would answer nothing. A deliberate no-value
  (`none`, `nothing`, `unset`) is a real row valued `''`: first, muted
  italic, ruled off. `+ New…` rows are actions, ruled off and in the
  accent. A picker with nothing to offer is disabled, its placeholder
  saying what it waits on (`pick an event first`). Type pickers split
  into Built-in and Custom, each custom type trailed by its form (`tag`,
  `enum`, `record`, `value`) — but only once a custom type exists: a
  heading over everything tells nothing apart. Every group heading —
  an alias's too — is small muted capitals, aligned with the names.
  **Conditions stay English sentences** — `PREDICATE_WORDS` is
  untouched, the `·` separates alias from property, and the existence
  sugar still reads `course exists` (minus its article). Understanding
  what a command is guarded by is the point of the tool, and an author
  never typed a predicate to begin with, so there is no stored spelling
  being hidden. **Operations are their tokens** — `set`, `increment`,
  `decrement`, `append`, `remove` — in the handler editor, the change
  adder and the State changes sentences alike (`Course capacity set
  event.data.capacity`). They used to be English too ("becomes", "goes
  up by", `OPERATION_WORDS`); that was dropped when the projection
  editor was made technical, because an operation is something the
  author picks and the Code view writes, and one word per operation in
  both places is one spelling to learn.
  Explanations live in `hint(...)` — one `ⓘ` per section, never one per
  row, in both modes, linking dcb.events only where a page exists.
  Inline field hints are deleted; *derived facts* stay on the page,
  terse (`untagged`, `scripted fold`, `appended by: —`), because
  hiding a fact about the model behind a popover is the opposite of what
  the register is for. A group carries a mark only if one was
  authored — there is no hashed fallback, and `iconPrefix` is what
  keeps an unmarked name from rendering behind a stray space. A command
  or event does carry one either way: unmarked, it shows its kind's
  mark (➜ command, ↯ event), so the kinds stay told apart at a
  glance; the fallback is drawn, never stored. The glyph says what the
  thing is and the stylesheet colours it — a text glyph, not an emoji,
  so it takes the kind's colour (`fallbackIconClass`). Coloured squares
  (🟦/🟧) were tried first: they ignored the theme and said only what
  the chip's background already did.
  Icons left the experimental flag with it — an icon is one line of
  legibility, not a modelling construct. Feature groups followed: a
  group is how a model with more than a handful of commands stays
  navigable, not a modelling construct either, and a rail that showed
  Features and Ungrouped but offered no way to add one read as broken.
- **Ungrouped is not drawn as a feature.** It is what is left over,
  not a group anyone made, so its heading is a muted label with no
  caret (it never folds), no "+" (+ Command is that) and no rename or
  remove, set off from the features above by a rule when there are
  any. It stays a drop target — dropping there is the way out of a
  feature.
- **Naming a new command is a page of its own** (`renderNewCommand`),
  in the main area, whichever way in asked — the empty model's
  "+ First command", the rail's "+ Command", a feature heading's "+",
  the palette. It used to be a form in the rail, under the heading
  that asked ("the answer lands where the question was asked"); that
  was reverted because on a phone the rail is a drawer kept closed, so
  every button outside it opened a form nobody could see, and because
  the first step of a command should look the same from every door.
  What the heading's position used to say, the page says in words —
  `in <feature>` — and asking from the rail closes the drawer. The page
  sits over the current view without moving it, so Cancel is only
  forgetting the question.

## Inline definitions from a command

A use case is designed on its command's page, start to finish. The
custom type an input needs and the projection a rule or a change reads
are created, and corrected, from the picker that noticed they were
missing: "+ New custom type…" in the payload's type pickers, "+ New
projection…" in a rule's (or guard's) first question and in the change
adder, a pencil beside every referenced projection a command page
shows, and "Edit the type …" in an input's (or an event field's) edit
mode (`openDefinitionModal`, index.html). Events keep the inline forms
they already had.

- **A modal, not a page or an inline form.** Naming a new command is a
  page because nothing is half-built yet; here something is — the rule
  whose first question is being answered, the input whose name is
  typed. A page would replace it, and an inline form cannot hold a
  projection's editor. The modal shows the very editor the definition's
  own page shows (`customTypeEditor`, `projectionFields`), so there is
  one way to edit each kind.
- **The page's forms are set aside, not closed.** The editors inside
  open and close their own forms through `closeForms` as anywhere
  else; opening the modal moves the page's forms and drafts into the
  frame (`frameKeys`) and closing it puts them back, so none of that
  reaches the command. The page behind is painted from what was set
  aside, so the rule stays visible through the backdrop. Before this,
  the change adder's "+ New projection" navigated to Projections and
  dropped whatever was being entered.
- **Created is chosen.** Creating a definition selects it in the
  picker that asked, in the same gesture — one undo step — and the
  modal stays open on its full editor, since a new record's `value`
  field or a new projection's handlers are rarely right first time.
  Closing before Create changes nothing. A rename inside the modal
  carries the selection with it.
- **Edits commit as they are made**, as on the pages: Close, × and
  Escape only close. Escape backs out of a field, then a form inside
  the modal, then the modal — the top one only.
- **One stacked level, and only projection → custom type.** The other
  dialogs never stack, because a stack is a way down with no way back
  (`renderModals`). This one is allowed once, because a projection's
  value is so often a type not yet written, and its header names what
  is underneath ("‹ Back to …"). Nothing deeper is offered.
- **What the modal leaves out.** Removal — the command behind it may be
  using the definition; it stays on the page. Groups: a new projection
  may go into one the model has, picked beside its name, but the modal
  never makes a group or moves a projection in or out. "Open its page" is the one way out to the definition's page,
  and it goes through ordinary navigation, which commits or drops the
  command's pending forms as any other move does.
- **A member's type is edited from the member's edit mode, not its
  row.** A pencil beside an input's type chip opened the custom type,
  and read as "edit this input" — which was the click people wanted
  and was a different one (the type chip, or now `Edit` in the row's
  reveal). The way to the type now sits inside `memberEditor`, on its
  own line, worded as the type's ("its type, Course id, is a custom
  type — Edit the type Course id…"), since a change there reaches
  every use of it.
- **New types start in the form they are for.** The forms offered are
  tag type, record, enum and single value (`newCustomTypeButtons`); a
  tag type is a single value with `isTag` already set — what a model
  built from scratch needs first, and a checkbox nothing pointed at
  before — so it is first and the primary button. A single value's card (`singleValueEditor`) shows
  its base type, picked (string, integer, number, boolean) — or an
  enum's members — and, for a tag type, the tag it writes. The JSON
  Schema, the tag schema and the form (single value | tag type) sit behind an Advanced switch — per card
  and session-only, unlike the projection editor's: every card opens
  collapsed, and opening one opens no other. The form replaced a
  "represented as a tag" checkbox on every card, which asked a question
  most types never need asked. A schema saying more than `type` is
  named beside the picker with the switch off (`+ minimum — see
  Advanced`), so a keyword never hides under a picker that cannot
  show it.
- **Other dialogs win.** Help, Problems, Settings, Import & export,
  the models dialog, quick open and the import gate close the
  definition modal (its edits are stored already) and give the page
  its forms back, rather than stacking over it. A modal whose page
  went away underneath it is dropped.

## Narrow screens

One breakpoint, 760px (shared.css, _narrow screens_), and a floor of
320px: at or above it, nothing runs past the right edge of the page.

- **The bar keeps what is used while modelling.** Below the breakpoint
  it holds the rail's toggle, the model's name, the Problems count (no
  word) and quick open. Import & export, help, theme and Settings fold
  behind ⋯ (`moreMenu`) — a dropdown, four rows, each doing exactly what
  its desktop button does. The dcb.events mark is hidden; the footer
  links the site. The Visual/Code switch is not in the bar at all (see
  _The surface switch_); in a page's header it keeps its icons only, and
  the name beside it ellipsizes first.
- **The name is the part of the bar that gives.** It ellipsizes into
  whatever the rest leaves, by flex shrinking. It used to be a
  `100vw - 266px` budget; controls were added after it was written,
  the budget was never updated, and at 360px the bar ran 190px past the
  edge — which also widened the page under every dialog, so the dialogs
  were cut off on the right. A budget written down once drifts; shrinking
  cannot. At 320px the name keeps about 70px.
- **Every dialog is fullscreen on a phone**, Settings and quick open
  included: a card with a margin round it spends width the content
  needs. Heights are `100dvh` — `100vh` is taller than what a phone
  shows. The header with the × is sticky, because with no backdrop
  left to tap the × (and Escape) is the way out; quick open gains a ×
  of its own, shown only there, and drops its keyboard hints. Settings
  loses its see-through backdrop, which on a fullscreen sheet has
  nothing to show through — the setting most worth watching land, the
  theme, is in ⋯.
- **Pages are not given phone layouts.** A strip that is wider than the
  window (the overview table, Coupling's matrix, an event-model band)
  scrolls inside itself, as on desktop; only overflow of the page
  itself is a bug.

## The sandbox

The page is the viewport, in three fixed bands (`renderSandbox`): the
header holding the driver, the timeline, and a panel of three tabs –
Watched, Decision, Store. Only the panel scrolls.

- **A reload loses nothing (2026-10).** The session used to live in
  a variable and be gone on reload, on the ground that an experiment
  outliving its question is history the model would have to carry.
  But a reload is rarely a decision to throw a run away, and the run
  never touches the model anyway. It is kept per tab and per model in
  sessionStorage (`SANDBOX_KEY`), like the undo histories: the log,
  its steps, the playhead, the watches and the driver's draft.
  Switching models puts a session aside instead of discarding it;
  Start over is the one way to throw it away.
- **One panel, three tabs (2026-10).** Until then the watches were a
  strip of their own and the step's Append, Reads, Now and Store sat
  side by side under it: everything at once, and with the Store column
  added it read as clutter. Four layouts were drawn (on a design
  canvas, outside the repo): a watch table beside a step inspector,
  these tabs, the watches as rows on the timeline's own axis, and the
  run as a log with the watches beside it. The rows were built first
  and dropped for the tabs (kept on the `sandbox-grid-c` branch). Each
  of the three gets the whole width, one at a time. Watched is the
  default, since a run is watched through it, and its tab counts how
  many the step at the playhead changed, so a change is noticed from
  the other two; Store counts its calls.

- **Fixed bands, because a run gets long.** It used to be one column:
  driver, a row of event icons that wrapped, every visible event as a
  line, the step's reads, then the watches last. Each event pushed the
  watches further down, and scrubbing moved them, so the thing you came
  to watch was the thing you had to scroll to. Three directions were
  drawn before choosing (on a design canvas, outside the repo): three
  fixed columns with a log in the middle; this one; and a ledger with
  steps as rows and watches as columns. The ledger reads a watch's
  history best but turns the timeline into a table. This one keeps a
  timeline and still gives every watch its history.
  The timeline was first docked at the bottom, and was read last: the
  thing that decides what every band above shows sat under all of
  them. It moved under the header, above the watches, in the order
  cause and effect run. Four placements were drawn (on a design
  canvas, outside the repo): on top; the run as a filmstrip of step
  cards, the most obvious but one card per step repeats the Append
  column; a slim scrubber inside the header, the least height but the
  other lane modes would need a pop-over; and the dock kept and made
  louder, still where the eye arrives last. On top won. It is marked
  as a timeline by name, by a handle on the playhead and by a tint
  over the part already played, and the transport says in words what
  the playhead is just after — the marks are icons, and the one that
  matters should not need a hover.
  Below the narrow breakpoint the bands flow with the page again: a
  phone has no height to split four ways. Above it, the site footer is
  hidden on this page; it was the one thing below the viewport, and so
  the reason the page had a scrollbar at all.
- **Compact by default; lanes are tags.** Compact is the whole run on
  one lane, in order, which is how a log is first thought of. With
  one lane there is no label column, so its marks are bigger
  (`SANDBOX_PITCH_COMPACT`), and since there is no bold label to say a
  watch follows a tag, the marks carrying one get a dot in the
  projection colour. By tag is one lane per tag any event carries
  (`sandboxLanes`). A lane holds exactly the events a query for that tag
  gets back, so it is how a boundary sees the log. An event with
  several tags sits on several lanes, and so a subscription shows up on
  both the course and the student. "By event type" is a third reading,
  for a model whose tags say little. Lanes a projection watch is tagged
  by are bold.
- **One event is one fixed width** (`SANDBOX_PITCH`). A long run
  scrolls sideways, with the lane labels sticky on the left. The first
  version spread the whole run across the track: marks narrowed as
  events were added and turned into dots past 80, so one run looked
  different from one minute to the next. The ruler, the band over the
  current step and the playhead are all placed by index times the
  pitch, and scrubbing turns the pointer's x back into an index the
  same way. A repaint rebuilds the lanes, so their scroll is kept
  (`keepLanesInView`). A playhead that moves out of view is scrolled
  back to the middle; scrolling along the run without moving it leaves
  the view alone.
- **Marks have no fill, and the playhead is drawn over them.** A
  filled mark hid the playhead wherever the two met. Rows are told
  apart by a rule between lanes, not a line through the marks. There
  is no "Latest" button: `End` and the lanes do the same.
- **A watch is a tile with a history**, in a grid that fills the
  Watched tab's width, so many stay one screen. It is the card it always was,
  plus "was …" when the step at the playhead changed it, and its value
  at the end of every step drawn under it. A number (a list, by its
  length) is drawn as a level that holds between steps; anything else
  is a tick wherever it changed. It is the whole run squeezed to the
  tile's width — a shape at a glance, not the lanes' axis. That is a fold from zero per step, so
  `watchSeries` caches it per model, log and watch: scrubbing repaints
  on every pointer move and changes none of those.
- **The driver is always there, and its draft survives a run.** It used
  to open per command and clear after it. The next step is usually the
  same command with one identifier changed. It is not a `<form>`: the
  value editors carry their own buttons, and any of them would submit
  it. Enter in a field runs it instead.
  An identifier field offers every value of its type the run has
  used so far (`sessionIdentifiers`), read from the events' payloads
  and the commands' arguments. These are keyed by tag type, not by
  group: keyed by group, a model without groups (every shipped one)
  would be offered nothing — as it was when they were keyed by entity.
  Scenarios use the same keying (`identifiersInUse`).
- **The playhead can sit inside a step.** `session.stepAt` is the step
  the last visible event belongs to, even when only some of its events
  are visible. The Decision tab shows those; the rest are faint.
- **Now folds the read again; it does not decide again.** The Now
  column used to evaluate the command again over the visible log and
  take its reads. At the end of the command's own step that usually
  refuses (the course is already defined), and a refusal stops short
  of later reads, which crashed the page. Each projection read is now
  folded on its own, with the tags and arguments the step resolved.

## The surface switch

- **It sits in the header of the pages the code follows** — command,
  events, projections, types (`CODE_FOLLOWS`) — on the right,
  and nowhere else. It used to be in the bar, which said every page had
  a code form; the Overview, the sandbox and the cross-cutting pages
  showed it muted, doing nothing. A strip of its own above the content
  was sketched and dropped: every one of those pages already has a
  sticky header, so the switch joins it.
- **Both surfaces share that header**, so the switch stays put when the
  code is on screen — a switch on the page alone would vanish exactly
  when someone wants to switch back. In the code the header is the
  page's less what only the page can do: the kind and name, no mark,
  Rename or Remove (F2 renames in the code). The code's ⓘ moved into
  its toolbar. The switch stands beside the header's selectable row
  (`qrow`), not in it: a click repaints, and the focus would come back
  to the row as if the row had been chosen.
- **Unapplied code leaves one trace in the bar**: while a text is typed
  and not applied and the code is not on screen, an *Unapplied code*
  button (`unappliedCodeButton`) leads back to it where it was left
  (`resumeCode`). The switch's dot says the same where the switch is.
- **The Overview's Commands card always opens the commands**, in
  whichever surface is current — it was the way into the code from
  the Overview once Code there had no switch to press.
- **Three surfaces, one control**: Visual · Split · Code. Two
  independent toggles (Page, Code; both on is the split) were sketched
  and dropped — they can both be off, which has to be refused, and the
  refusal needs explaining. A drawer the code slides out of was the
  runner-up, the pick if the split ever becomes the usual way to work.
- **The split is the page's header over both columns**, the page on
  the left as anywhere (`paintView` paints into its column), the code
  toolbar and text on the right, sticky under the header
  (`renderSplit`). The columns are half each, no max-width; a
  draggable divider is not there yet.
- **Split needs the room** (`SPLIT_MEDIA`, about 1100px beside the
  rail). Narrower, the button is not offered and a split surface shows
  the pages; the choice is kept and comes back with the width.
- **Two editors, one model.** In the code alone, a page edit under an
  unapplied text marks it stale; side by side that would be constant.
  So clicking into the page applies a text that parses — on
  `pointerdown`, before the page acts, so the page's edit lands on the
  model the text says. That click does nothing else: the repaint takes
  what it was aimed at. A text that does not parse stays as typed, and
  a page edit then marks it stale, as it would anywhere. Applying on
  every typing pause was weighed and not taken: it fills the history
  with half-typed steps.
- **The page follows the cursor**, a beat after it stops
  (`followCodeCursor`), never the other way round by surprise: a page
  already showing that definition — or the kind's page, for any of its
  kind — stays, so the cursor a page put there never moves the page.
  The text keeps the keyboard when the page moves (`codeView.following`),
  and a reveal the page caused does not take it (`revealCodeAt`'s
  `focus`). After a switch the keyboard stays on the switch.

## The code view's language

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
  A command is declared with `command`. Spelling it `handler` was
  tried and reverted the same day
  (`docs/research/2026-10-07-handler-keyword.md`).
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
  assertion stored as written, and drift is reported with a fix but
  never accepted by applying — the pages' rules, in text. **An omitted
  Then is an error**, not something an apply records unseen: it says
  what the model now does, and its fix writes that in, for one scenario
  or for all of them at once. Completion offers the same lines where
  the Then is being written (`sourceOutcomesAt`), so it needs no trip to
  the `scenario` keyword the error sits on. A projection's outcome is a
  read with tag values, which the text may not have yet: completion
  tries each read the given events can tag (their properties of each
  tag's type), and once the read is written, offers its value. Recording it at apply was the first
  design; it let a text store an assertion it never showed. Agents are
  the exception (`recordOutcomes`): the schema asks no one to predict
  an outcome, so their apply records it and its result names each
  scenario it recorded.
  **Given, when and then are each said once**, and what follows
  continues with `and` (`given A … and B … when C … then D … and E …`),
  so a scenario reads as a sentence; a keyword said again is an error
  whose fix is `and`. `when C and D` was weighed and left out: a
  scenario runs one command in the wire format, and several would be a
  major — earlier commands are written as given events.
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
  proves itself by re-reading the result. *Introduce alias*, a
  refactor offered on a read in place (`sourceIntroduceAlias`), proves
  itself the same way: an inline read and an alias derive the same
  query, so the result, its alias put back at each use, must read as
  the command it was — the alias is spelling, never a boundary change.
  It names every equal read in the command at once and picks the
  projection's own name, lowercased, and opens a rename on it at once
  — the default is rarely the name wanted, so it is named as it is
  introduced.
  A test holds every name in
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
  arithmetic between values is a derived projection's, a script is the
  door for the rest, and the reasoning is in the `dsl.js` header — read
  it before adding `=> state + 1`.
- **A projection's kind is said in front** (9.0): `derived projection
  X (…): T { <expression> }` and `scripted projection X (…): T {
  initialState … }`, after `untagged` when both apply. The inner
  `derived …` line and `script` line are gone; the old spellings are
  errors naming the new one. In front, the header knows what the
  block may hold before reading it, and a derived projection, whose body
  is one expression and its scenarios, prints with a block like
  every other one. The operators are `+`, `-`, `*` and the calls
  `min(a, b)` / `max(a, b)`; a `-` straight after a value (`)`, `]`, a
  number) subtracts, anywhere else it starts a negative number
  (`endsValue`).

## Scripts and the origin

- **What a script can reach.** A scripted handler is compiled with
  `new Function` and runs on the main thread, in the page's own
  origin (`evCompileHandler`, evaluate.js). It can read and rewrite
  all of localStorage, call the registered WebMCP tools, call
  `window.DCB_PLAYGROUND_HOST.theme`, and fetch anywhere. On
  dcb.events the playground is served at `/playground/` of the
  website's origin, so its storage, and its quota, are the website's
  too. What stands between an imported model and that is the import
  gate and `?safe` (AGENTS.md); there is no sandbox.
- **No Content-Security-Policy, for now.** One was weighed and
  dropped (2026-10). Scripts need `'unsafe-eval'`, so a CSP does not
  stop one from running. The one restriction worth having,
  `connect-src 'self'` (no sending data elsewhere), would break
  "From a URL" and `#url=` links, which fetch whatever URL the reader
  types or the link names. The page
  also needs `style-src 'unsafe-inline'` (inline `style` attributes,
  Monaco's runtime `<style>`). And the host's theme hook is an inline
  `<script>` whose content depends on the site's configuration
  (`hooks/playground.py` in the website), so it cannot be hashed; it
  would only run because a `<meta>` CSP does not reach back to
  content before it. What would be left — `object-src`, `base-uri`,
  `form-action` — guards nothing this page does.
- **The real fix is a sandbox, not a policy.** Compile and run
  handlers in a Worker, or in an iframe sandboxed without
  `allow-same-origin`, posting plain JSON in and out: a handler's
  inputs (state, a frozen event, arguments, tags) and its output are
  JSON already. The cost is that evaluation becomes asynchronous,
  and every render path that evaluates — the scenario runners, the
  sandbox's decision card, the watches — calls it synchronously
  today. That is a change of the evaluation seam, not a patch.
- **Not now (2026-10).** Weighed and shelved. A Worker is
  feasible: `evaluate.js` is pure, and a data:-URL worker's opaque
  origin would shut out storage, WebMCP and the host hook, and could
  be terminated on a hang (it would still have `fetch`). But handlers
  cannot be sent over one at a time — a fold calls them in sequence —
  so a whole evaluation moves, and with it some seventeen synchronous
  render paths and the code view's apply. If reopened, the shape
  settled on was one evaluation API that answers at once for a
  declared-only model and through the worker for a scripted one, with
  render drawing from a cache ("running…" until the answer, then an
  ordinary repaint; stale answers dropped in that one place), and a
  switch to force the worker everywhere so its path stays exercised.
  Against that cost the exposure is small: authoring a script is
  experimental, and no external script loads without the gate.
  Reopen when scripts leave the experimental flag, or on a real
  report of a hang or of abuse.
- **What stands in for it.** The gate lists every scripted
  projection with its handlers' code (`envelopeScripts`, model.js),
  so the reader consents to something they can read, and names
  `?safe`. And a load that never finished turns safe mode on for the
  next one by itself (`boot`, index.html): a flag in sessionStorage
  is set before the first render and cleared after it, and found still
  set means the last load hung. One load only, so a reload that merely
  interrupted a slow page costs a reload.

## DCB queries, shown

Artboards: `design/dcb-queries/` (2026-10).

- **One notation, wherever a query is shown**: the command page's
  Consistency boundary step, the code view's hover over a command's
  summary, the sandbox and the projection editor. A query is drawn in the specification's
  own words – items of `types` and `tags`, ORed – not paraphrased, so
  what is learned here is what any DCB event store's API says. Every
  term (`head`, `failIfEventsMatch`, `after`, a query item) carries a
  one-line ⓘ; until the reference has anchors for them, they link the
  nearest one there is (`consistency-boundary`).
- **A query is one box; a chain is several.** One call to the store
  is one outlined box, its items inside it split by an OR divider. A
  chained boundary is one box per call, numbered "call 1 of 3",
  joined by arrows that say where the next one's tags come from, with
  the head it starts from above them. Drawing the items of a chain as
  one long OR list – the first sketch – made three calls look like
  one, which is exactly the difference the append condition's `after`
  turns on.
- **The code view's hover is the JSON alone**: the queries, as a store
  is sent them. Text in a text view; the Consistency boundary step a
  click away has the rest. A plain-text rendering of the boxes was
  tried first, and read as noise beside the code.
- **Planned and resolved.** Where no run supplied the values – the
  command page, the code view – a tag's value is a placeholder,
  `CourseId:{courseId}`, a fan-out `{each course.subscribedStudentIds}`
  marked "× each"; the sandbox shows the values it asked with.
- **Items are merged by tag set, as the store is asked.** The planned
  view listed one item per alias, the store is asked one item per tag
  set (`evDecideThroughPort`): six items planned, two asked, for the
  same command. The command page names the reads that contributed to
  an item ("from"), which keeps what the per-alias list said.
- **A watch's query is the fold's own reads.** The popover on a
  watched projection shows the calls `projectFromStore` makes for it,
  traced, at the playhead. It used to rebuild them from
  `foldedReads` and the handlers: a second derivation of the query that
  nothing kept in step with the one that runs.
- **A projection's query, one line and a glyph (2026-10).** The
  editor used to spell the query out in words of its own (`tag
  CourseId:<courseId> and CourseDefined, …`), always open – the one
  page with a notation of its own, and a block of the side column. It
  is now a line saying how much it reads, and the boxes behind the
  query glyph, as on a command's read cards. A Query tab beside
  Definition and Checks, and a dialog, were drawn and passed over: a
  tab for one box, a dialog for what a popover already does
  elsewhere. The plan is `projectionPlan` (model.js) – the items a
  command reading it asks, its own parameters as placeholders – and
  a test holds it to the reads `projectFromStore` makes for every
  projection scenario.
- **Rows or JSON**, one remembered choice for every query on every
  page. JSON is the specification's shape, coloured; a planned one
  keeps its placeholders, so Copy is offered only where values are
  resolved. The append condition stays in words either way: as JSON
  it is the queries' items again, and repeating them buried the one
  thing it adds, `after`.
- **The sandbox runs through the cycle** (`handleCommand` against a
  `memoryStore` of its log), and its panel has a **Store** tab: the
  step's calls – head, each read with its query and the
  events it returned, the append with its condition and where it
  landed. Hovering a read lights its events up on the timeline: the
  slice of the log the boundary really is. Reads, Now and Store render
  one replay of the step (`stepReplay`): one `handleCommand` with its
  calls traced, so what Reads says was read is what Store says was
  asked. It is worked out again for every revision of the model, not
  remembered across one, so an edit shows at once; within a revision
  it is kept, so scrubbing inside a step does not decide it again. A
  step that would be refused now shows its calls as far as they got,
  under the note Reads gives. The Decision tab and Now used to call
  `evaluateCommand` each, beside the Store tab's `handleCommand`: three
  decisions of one step per repaint, two of them not the one that ran.

## The read port

- **What it is.** Wherever `evaluate.js` takes a log, it also takes
  a function `read(items) → events`, `items` one DCB query: a list of
  `{ types, tags }`, ORed. The playground keeps passing its log;
  nothing in the interface changed.
- **Why.** A runtime that executes a model against a real DCB event
  store (`docs/research/2026-10-15-dcb-runtime-wasm.md`) must fetch
  only what a decision reads, and a chained binding's query is known
  only after the read it waits for has been folded – so the store has
  to be asked from inside evaluation, not before it.
- **Once per round, not once per fold.** A query to a store has an
  overhead, so a command asks as few as its boundary allows: all its
  reads that hang off its arguments in one call, then one call per
  link of a chain (`evDecideThroughPort`). `course-simple`'s
  `SubscribeStudentToCourse` folds six projections and asks once, with
  two items; `course-schedules`' `RescheduleCourse` asks three times.
  The result carries the `query` it decided on, for the runtime's
  append condition.
- **Found by dry runs, not derived.** What a round reads is a
  question of values – arguments fanned out, excluded, answers from
  the round before – which `deriveDcb` describes but does not compute.
  Computing it beside the evaluator would be a second copy of its
  operand semantics, so the evaluator answers it itself: a dry run
  (`evDecide` collecting) reads through every rule, instance, guard
  and emission without stopping at a refusal, records what nothing
  fetched yet answers, and gets nothing back for it. The records,
  merged by tag set (types are ORed within an item, so that is
  exact), are one call; the next dry run sees the round they unlock.
  The deciding run comes after, over fetched events only – a dry run's
  wrong guesses can cost bandwidth, never correctness.
- **Planned rounds were weighed and deferred (2026-10).** The
  definitions know every read's shape and order (`deriveDcb`,
  `deriveRounds`); only the tag values are missing, and those could be
  computed per round from the arguments and the aliases bound so far –
  no dry run, no wasted folds, and the store asked for exactly the
  displayed DCB. It needs `evResolveBinding` split into resolving
  identifiers and folding, so the two share one resolution. Store
  calls and correctness are the same either way, so it waits for
  something that needs the query *before* evaluating: reading an
  untagged, state-blind projection as `backwards, limit 1`, a view
  of the exact query a command with given arguments will run, or
  dry runs showing in a profile.
- **Synchronous, deliberately.** An asynchronous port would make the
  whole fold asynchronous, and every render path that evaluates with
  it (see _Scripts and the origin_). A WebAssembly host import is a
  blocking call anyway; a host over an asynchronous client blocks.
- **A log passes every type; the port asks for the handled ones.**
  Over a log, filtering by type would be a pass for nothing – the fold
  skips what it has no handler for. A fold that handles no event reads
  nothing through the port.
- **`types` is left out, or names at least one type (2026-10).** The
  specification asks that an event's type match one of an item's
  types, so `types: []` matches nothing; a store reading it as "any
  type" would turn a fold that reads nothing into a condition on every
  event. So an empty list is refused (`memoryStore`), an item without
  `types` matches any type, and a plan that reads any type under a tag
  leaves `types` out rather than writing it empty. A test holds every
  plan, read and append condition of the shipped models and fixtures
  to it.
- **Held by a test.** Every command scenario of the shipped models
  and the fixtures decides the same through a port as over the log,
  and the call counts above are asserted (evaluate.test.js).

## Value schemas

- **What they are.** `commandArgumentsSchema` and
  `eventPayloadSchema` (model.js) state what a command accepts and an
  event carries as JSON Schema 2020-12, with `customTypeSchemas` for
  the types they name. Written for what states or checks values outside
  the playground – the runtime's API contract and its request
  validation (`docs/research/2026-10-15-dcb-runtime-wasm.md`).
- **Nothing in the playground enforces them.** The evaluator checks
  presence and nothing more, and stays that way: a mistyped value is
  for the model's author to see, not a reason a model stops running.
- **A custom scalar type is its own schema.** Its `schema` is already
  JSON Schema 2020-12 – OpenAPI 3.1's dialect – so it is carried over
  whole, patterns and enums included. A composite is an object of its
  fields, all required. How a property names a type is the caller's
  (`refOf`): a `$ref` into its own components, or the schema inline.
- **Closed, and null is the one "no value".** An unknown key is
  refused, so a misspelt optional argument is an error instead of a
  silent null. A command may leave an optional argument out or send
  null; an event payload always spells it out, as the evaluator
  publishes it.
- **Not in WebMCP.** Its tool schemas are fixed when the tools
  register; a command's arguments depend on the command named in the
  call, so a tool cannot declare them.
- **Held by a test.** Every scenario's arguments, and every event the
  evaluator publishes for it, validate against these schemas
  (evaluate.test.js, with a validator for the keywords in use).

## Comparing models

- **A view, not a mode.** Compare sits in the rail under *Review*,
  behind the experimental flag, and needs no commands to show. A
  page-level mode like Code (entered from ⋯, left with an exit) was
  agreed first and reversed: a view keeps the rail, links leave it like
  any other page, and coming back finds the same comparison. It is not
  in `CODE_FOLLOWS` – two models' text is not something to edit.
- **What it compares with.** This model at one of this tab's undo
  steps (`modelWithoutLast`, a fold of the model's own events), another stored
  model, or a file – a URL or pasted JSON – read and never stored
  (`modelFromEnvelope`). The choice is kept per tab and per model in
  sessionStorage and dropped silently once it no longer resolves. The
  picker opens first, *As you opened it* highlighted, so the common
  question is one click and nothing is chosen unasked.
- **A file is built by the import, in a scratch log.** Re-deriving an
  envelope → model step beside the import would drift from it
  (converted entities, retries, custom-type order); `inScratchLog` runs
  the real import against an array instead – no append listener, no
  compaction, no revision bump, so no cache of the real log moves.
- **No import gate for a file.** The gate exists because scripts run
  unprompted; Compare prints a script and derives boundaries from
  declared tags, and compiles nothing.
- **Read-only, and the open model is the one you go to.** "Open" leads
  to the definition's page in the open model, only when it has it; the
  other side is often not in the log, so it is read on this page only.
  Swap turns the reading round and nothing else.
- **Identity is kind + name** (scenarios: their id), with sameness
  `sameDefinition`'s – the one notion Apply uses too, through
  `diffCollection`. A rename reads as a removal and an addition.
- **Boundaries per command, one named finding.** `compareBoundaries`
  diffs `boundarySummary`'s query items round by round; the summary
  line alone can read the same either side while the query changed
  (`reads 2 types, 1 tag`). The finding is *a read lost its tags* –
  a type read by a tag before and untagged now, a lock grown to every
  instance. More findings wait until one has earned its place.
- **The Code tab is a per-definition line diff** (`diffLines`, dsl.js:
  a plain LCS, words compared inside a replaced line), over each side's
  own printing – no dependency for it.
- **Deferred:** side-by-side and matrix views, replaying one side's
  scenarios against the other, taking a definition across, a WebMCP
  tool, rename hints, an arbitrary point in the log.

## History and undo

- **One history per model, not per tab.** Undo used to cut the shared
  log back to a position: exact by construction, but one history across
  every model – undoing in model A took back the edit just made in B –
  and voided by any write from another tab. Every event belongs to one
  model and a model's state folds only its own events, so a model's
  last step can be taken out of the log wherever it sits, leaving what
  other models appended since untouched. Still exact: nothing is
  computed, the events come out and go back in as they were.
- **A step is a count, not a position.** The model's last `n` events,
  the newest of which must still be the one the step ended with
  (`eventStamp`: timestamp, type, name – not the sequence number, which
  every take-out and compaction renumbers). Positions move under
  another model's undo or another tab's; a model's own tail moves only
  when the model changes. That is the one refusal left: the model was
  changed elsewhere since, so undoing would take that change too. The
  model's history is dropped and starts again from there.
- **Weighed and rejected: restore by append.** Jumping back by
  appending a change that sets the model to an earlier version
  (`replaceDefinitions`) would never refuse, but undo would only be as
  complete as that diff, the log would grow on every undo, every
  append hook would fire on it, and a restore of the whole model would
  silently wipe another tab's later edits to it.
- **Weighed and rejected: a working copy per tab.** It makes per-tab
  history fall out for free, but brings a save step, unsaved work to
  lose on close, and a conflict when two tabs save one model – too
  much of a change to how the playground keeps models.
- **What a step is.** A gesture (`run`) or an agent's tool call
  (`asAgent`, marked as the agent's) makes one step in each model it
  touched. Creating, importing or duplicating a model is where its
  history starts, not a step in it. A deleted model has no page to
  undo from: its deletion is offered back once, in a toast
  (`restoreDeleted`). Sixty steps per model; the oldest falls off.
- **The open model is per tab too.** It was one browser-wide choice,
  so opening B in one tab switched every other tab to it. Each tab
  keeps its own; localStorage holds only the last one opened, where a
  fresh tab starts.
- **Compaction keeps what the histories need.** The floor is the
  oldest event any of this tab's histories still points at; steps
  count from a model's end, so nothing moves after a compaction.
  Another tab's histories are not considered: a step that loses its
  events is refused like any change made elsewhere.
- **History is a page, under Review, flag or no flag.** Going back is
  ordinary undo, so it is offered to everyone; Compare stays behind
  the flag and is reached from a row ("Compare with current version").
  It replaced *Compare*'s role as the way to see what changed in this
  tab, and split from it: a list of steps and a diff of two models are
  different questions.
- **A row reads off what the step remembered**, never the log: the
  first change's kind, verb and name (a rename's follow-on updates come
  after it), and the rest behind "and N more". A text applied as code
  (`markStepVia`) is one row of many changes. An agent's step is
  hatched, badged and labelled. Clicking a row jumps there in one move
  (`travel`); what was jumped past waits above "Now", dimmed, until a
  new change drops it – the same rule as redo, because it is redo.
- **The bottom row says where the history begins**: *Opened*, *From
  here* after a change elsewhere dropped it, or *Earlier changes* once
  the oldest fell off the sixty.
- **The algorithm is model.js's; the page keeps the rest.** What a
  step is, how a history moves, how far compaction may fold and which
  steps Compare offers (`markHistories`, `travelHistory`,
  `historyFloor`, `historyVersions`) take a tab's histories and the
  log's events and return what follows, so they are tested over plain
  arrays. The page stores the histories, batches a gesture's appends,
  writes the log and says what happened. Its readers – the History
  page, the rail's count, undo and redo – take a model's history
  through `historySteps`, the same shape whether it has one or not.
  Before, all of it lived in the page, and the history's shape was
  read in four places.

## The core and its other consumers

- **What the core is.** The semantic half of `model.js` (types,
  references, operands, validation and advisories, DCB derivation,
  value schemas, reading the wire format), `evaluate.js`, and the
  parse/print half of `dsl.js`. Not in it: the playground's own event
  log, undo and compaction, the editing commands, `PREDEFINED_MODELS`,
  anything touching the DOM, the Monaco widget. It is not a directory
  yet – it is the set of functions the other consumers call, until
  the log can come out of it (the last phase below).
- **Why (2026-10).** dcb-runtime already runs the playground's
  semantics: its build concatenates `model.js` and `evaluate.js` from
  the submodule into one component. But it did so through an
  undeclared seam – global names, a fake `localStorage`, an import
  replayed into a log – and carried every editing command into the
  WebAssembly. Further tools (a CLI that verifies, a language server,
  generators for other languages) would each need the same fakes. One
  explicit seam keeps one copy of the semantics, so no consumer can
  disagree with the playground.
- **What drives it.** Headless reuse, and the playground showing the
  traffic between a command and an event store: every `head`, `read`
  and `append`, the append condition, a conflict and its retry. Shown
  against an in-memory store over the sandbox's log; a real store is
  reached only through a runtime host that reports a trace, so the
  evaluator stays synchronous (_The read port_).
- **Stays here, stays JavaScript, stays classic scripts.** The
  semantics change in lockstep with the interface (wire-format majors,
  `EVENT_LOG_KEY` bumps), so a third repository would only add version
  skew; dcb-runtime keeps consuming it through the submodule, and
  nothing goes to npm until a consumer outside the two repositories
  exists. A second implementation in another language would be the
  drift the runtime promises cannot happen. Node and npm consumers get
  a small generated wrapper exporting the public names, so the app
  keeps needing no build step.
- **No language in it, and no IR yet.** Nothing in the playground or
  the runtime knows a target language. A generator is a separate
  package on top of the core's functions; the public API is whatever
  the real consumers – the OpenAPI builder, the slice view, the
  runtime's adapter, the sandbox – call, documented in the file
  headers. A resolved-model format comes only when a generator misses
  something the functions do not give. A model with scripted handlers
  is refused by any generator (`envelopeHasScript`): translating
  JavaScript is not on offer.
- **The phases.** Each leaves both repositories green, and the
  runtime's conformance test guards the first three as they happen.
  1. `modelFromEnvelope` (the import inside `inScratchLog`) and
     `executionBlockers` – what makes a model unrunnable outside the
     playground: a definition the import skipped, a defective
     definition, a tag and an argument of one name. The runtime loads
     through them and drops its storage shim.
  2. A store port in the DCB specification's shapes (query items,
     sequenced events, an append condition with `after`, an integrity
     failure), and the decision cycle around `evDecideThroughPort` –
     head or reads, the condition, a derived projection cut off at
     head – as `handleCommand` and `projectFromStore` (evaluate.js),
     with a trace, and `memoryStore`. The runtime's `runtime.js`
     shrinks to the adapter (positions as BigInt, field names, jco's
     error payloads).
  3. The OpenAPI builder (the runtime's `contract.js`) moves here.
  4. The playground: the store trace per command, Export OpenAPI, and
     `executionBlockers` as a severity of its own above the
     advisories – "would not run outside the playground".
  5. Conformance cases as data – model, given events, command,
     expected outcome and store calls – runnable by the core, the
     runtime and anything generated.
  6. A simulated concurrent append: a store that slips an event in
     before `append`, showing the integrity failure and the retry.
  7. `modelFromEnvelope` as a pure reader, without the log, so the
     core can shed the log and the editing commands. Held by a test
     that every fixture and shipped model reads the same both ways –
     editing commands and the reader are two routes to one model.
- **One attempt; the retry is the caller's (2026-10).** A lost race
  comes back as `conflict` rather than being decided again in here.
  Retrying well means waiting – a backoff, jitter – and this layer is
  synchronous and owns no clock; inside the WebAssembly a wait would
  block the instance. What has to have one owner is all within one
  attempt: where `after` comes from, the restart with head, the
  condition. So dcb-runtime's host loops, with its own backoff, and
  the playground loops without one. Where `after` comes from is
  `commandPlan`'s (model.js): `handleCommand` runs by it, and the
  pages that draw the condition say it from it, rather than each
  counting the calls again. A test holds every scenario's trace to its
  plan – head exactly when the plan says, no restart, no call beyond
  the planned ones. The plan shares the calls' shape, not their
  values: it is not the planned rounds deferred below.
- **Weighed and deferred.** An asynchronous evaluator, or planned
  rounds computed before evaluating, so a browser could talk to a
  real store directly: only if that becomes a goal.
