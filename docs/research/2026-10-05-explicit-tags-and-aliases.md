# Explicit tags, aliases, and an experimental flag

2026-10-05. Background for the v8.0 wire format and the changes to
`app/dsl.js`, `app/model.js`, `app/evaluate.js` and `app/index.html` that
go with it.

## Question

A first review round with developers liked the notation but found too much
of it implicit, and parts of it misleading:

- **Which events a projection reads was hidden.** A projection's
  parameters were its tags, and an event property typed with a `tag type`
  silently tagged every event carrying it. Neither the projection, the
  reference nor the event said "tag".
- **`read` reads as an action.** `read course = Course[courseId]` suggests
  a read happening at that line; it only names an instance for the rules
  below it.
- **Every rule needed a named read.** A one-off check could not be
  written in place.
- **Entities and lifecycles are a second concept on top of DCB** that a
  first-time reader has to learn before the examples make sense.

## Decisions

### An experimental flag replaces Advanced

Advanced hid custom types, projections and the consistency boundary — the
parts that *are* DCB — behind entities, the part that is not. That is
reversed: everything Advanced gated is always on, and what the examples on
dcb.events do not need goes behind an **experimental features** flag
(per browser, like Advanced was):

- Core: custom types (constrained, record, list), enums, events,
  declared, scripted and parameterless projections, `successor`,
  `require` / `emit`, aliases and inline references, multiple tags, fan-out,
  `with` arguments, command and projection scenarios, the Consistency
  boundary step, Sandbox, the code view.
- Experimental: entities, lifecycles, derived projections, guarded
  emissions (`emit … when`), optional reads, `excluding`, `currentValue`,
  annotations (`@feature`, `@icon`), and the Coupling, Rule map, Event
  model and Lifecycles views.

Projection scenarios were first on the experimental side and moved back:
they are how a projection is tested, as command scenarios test a
command, and the core examples carry thirty authored ones.

Enums are not strictly needed by the examples, but status projections
replace lifecycles in the rewritten models and a type system without them
would be odd.

The flag gates **authoring**, never reading: a model using experimental
features loads and renders them read-only with an "enable" banner; the
code view parses them, stops offering them in completion, and marks them
at info level. WebMCP is not gated — one wire format regardless. A share
link may carry `&experimental` to switch the flag on for that session
only. Which shipped models are listed with the flag off is derived from
the features each uses, never hand-picked.

### Tags are declared on events and on projections

Revised on 2026-10-06, before 8.0 left its branch. The first cut moved
the tags off the projection entirely, onto each read; that is in
*Rejected* below.

- An event marks its tags in place: `tag courseId: CourseId`, and
  `items: Item[] tag each productId` (`tag productId` on one record) for
  a field of a record. The wire format keeps the list of paths, `tags:
  ["courseId", "items.productId"]`. No mark, no tag — with an advisory
  for an event carrying none, and one per tag-typed property left
  unmarked.
- A tag's key is still its `tag type` (`course:c1`), and only a value
  of a tag type can be one. `tag type` stays: the key is a name the
  whole log shares, and saying so once is worth the word.
- A projection names the tags it is read by, in its header:
  `projection CourseStatus (tag courseId: CourseId): CourseStatus =
  NonExistent`. Several are ANDed, as in a DCB query item. One with
  none says so: `untagged projection CourseNumbering: CourseId = "c1"`.
  Saying neither is an error with both fixes, because the partition is
  too easy to forget for the text to assume one; the pages' new
  projection asks the same. Wire format: `tags: [{name, tagType}]`,
  empty for an untagged one.
- A read gives a value per tag, in the declared order, in parentheses:
  `CourseStatus(courseId)`, `CourseNumbering()`. Stored by name —
  `tags: {courseId: …}` — so reordering two tags of one type can never
  silently swap them; renaming one rewrites every read.
- The value has to be of the declared type. A mismatch is an advisory,
  and a run refuses to fold rather than fold the wrong instance. A
  literal keeps its type, `CourseStatus(CourseId("c1"))`, so the text
  shows which tag it fills.
- Fan-out is visible: `ProductExists(each items.productId)`. An entity
  read fans out the same way now, `Course(each student.courseIds)`.
- A scripted projection declares what it takes besides its tags after
  them, `(tag courseId: CourseId, days: integer)`, and a read gives
  those after the tags; `with (…)` is gone. A handler reads
  `tags.courseId` (by name, since two tags may share a type) and
  `args.days`.
- A derived projection declares its tags and passes them on by name:
  `derived DocumentCurrentText(documentId) != DocumentPublishedText(documentId)`.
- Projection scenarios: `then CourseStatus(CourseId("c1")) == Existent`.
- Entities (experimental): `entity Course (tag courseId: CourseId)`,
  read `Course(courseId)`; a property binds a projection tagged by
  exactly that identifier.
- The rule wizard asks for a value per declared tag; where the command
  holds none of the type, it offers a new command input, named after
  the tag.

### `alias`, and inline references

- `read` becomes `alias`, the wire format's own word for it, in the code
  and in how the pages name a declaration. "Reads N types / queries" stays:
  that one does describe a read.
- A projection read may be written inline in a `require`, an emit
  field or another read's value, stored as a first-class operand and
  nestable: `OwnedCourses(CourseOwner(courseId))`. An alias is an optional name, stored as written, so printing
  stays lossless.
- The rule wizard writes inline references ("which projection", then
  a value for each of its tags) and never invents an alias. Unreferenced
  aliases are still pruned on page edits, never on import or apply.

### No migration

Nothing is public yet, so v8 is a clean break: a fresh `EVENT_LOG_KEY`,
an importer that reads 8.x only, no upgrader. Old spellings get a quick
fix only where someone who never saw them might write them anyway.
The draft's `X tagged arg` and `with (…)` are errors that name the
spelling that replaced them; `read`, `X[id]` and `tagFilter` are
ordinary syntax errors.

### Help is the documentation

The help modal and `help.js` go. The help button and shortcut open the
docs in a new tab — at the reference anchor for the construct under the
cursor in the code view, at the guide otherwise. The `ⓘ` hints keep their
short text and link to the docs. The anchor list stays callable as
`helpReferenceLinks()`, because the website's build reads it.

### Sandbox

State cards are watched projections with a value for each of their
tags, the literals in the spelling the code uses (`CourseId("c1")`);
entity instance cards return with the flag.

## Rejected

- **`CourseExists for courseId`.** `for` reads as a loop to a developer —
  and the language has a real loop (fan-out), so it would be a loop in one
  place and a filter in another. Its comma list also collides with emit
  fields and argument lists, and does not say AND.
- **`CourseExists[courseId]`.** Clean in an expression, but it reads as an
  index lookup — the implicitness the review objected to.
- **`CourseExists where course = courseId`.** Honest, too verbose inline,
  and the key already follows from the value's type.
- **`let` for `alias`.** Familiar, but `alias` is the wire format's word.
- **Keeping the implicit tags of tag-typed properties as a fallback.** It
  is the implicitness being removed.
- **Tagless projections, tags chosen at each read** (`CourseStatus
  tagged courseId`, the first cut of 8.0). It let one fold be read per
  course and per student alike, which looked like a feature and was
  coupling: what a projection is kept per became every reader's to
  decide, readers could disagree, and nothing at the projection said
  which events reach which reader. A count per course and a count per
  student are two projections, each saying what it is about.
- **`CourseExists[courseId]` for a read**, again. Brackets read as an
  index into a stored table — the read model DCB moves away from — and
  a script's arguments would need a second kind (`X[courseId](14)`).
  A read is a pure function of the log, its tags and its arguments, so
  it is spelled as an application. What neither spelling can say, that
  the read becomes part of the boundary, the editor says per command.
- **`CourseExists tagged courseId` beside declared tags.** With the
  type declared, the read needs only the value; `tagged` between the
  name and the value was hard to parse as one operand inside a rule.
- **Named values at a read** (`CourseStatus(courseId: courseId)`).
  Noise outside the rare case of two tags of one type, and the
  declaration fixes the order.
- **Keys from the value's type.** A read's value has to be of the
  declared type; the literal keeps its type only so the text shows it.

## Owed to the website

Out of scope for now; the pinned submodule keeps dcb.events on the
previous playground until it is bumped. When it is:

- Every ```` ```dcb ```` block on the example and notation pages is
  rewritten in v8 (`scripts/dcb-render/render.js` parses with this repo's
  code): events mark their tags (`tag courseId: CourseId`), projections
  name theirs or say `untagged`, and reads are calls
  (`CourseStatus(courseId)`).
- The Course subscriptions and Dynamic product price examples drop
  entities.
- Reference anchors renamed or added: `read` → `alias`, `read-entity`,
  `fan-out` (`each`), and new ones for a projection's and an event's
  `tag`, `untagged`, reads as calls, inline references and typed tag
  literals; `with` is gone. `helpReferenceLinks()` is the
  list the build checks.
- The notation guide's "Advanced" section is labelled experimental, and
  its "Open in Playground" links carry `&experimental`.
- `scripts/dcb-render/help-links.js` reads `helpReferenceLinks()` from
  `shared.js` now — `help.js` is gone. shared.js loads in an empty
  context, as help.js did.
- The playground's help button and `ⓘ` links open the reference by
  anchor (`NOTATION_ANCHORS` in shared.js); new anchors join that list
  only once the website defines them.
