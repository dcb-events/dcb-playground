# Explicit tags, aliases, and an experimental flag

2026-10-05. Background for the v8.0 wire format and the changes to
`app/dsl.js`, `app/model.js`, `app/evaluate.js` and `app/index.html` that
go with it.

## Question

A first review round with developers liked the notation but found too much
of it implicit, and parts of it misleading:

- **Which events a projection reads was hidden.** A projection's
  parameters were its tags, and an event property typed with a `tag type`
  silently tagged every event carrying it. Neither the reference nor the
  event said "tag".
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
  `with` arguments, command scenarios, the Consistency boundary step,
  Sandbox, the code view.
- Experimental: entities, lifecycles, derived projections, guarded
  emissions (`emit … when`), optional reads, `excluding`, `currentValue`,
  projection scenarios, annotations (`@feature`, `@icon`), and the
  Coupling, Rule map, Event model and Lifecycles views.

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

### Tags are declared on events and chosen at the reference

- An event lists its tags: `tags courseId, items.productId`. No clause,
  no tags — with an advisory for an event carrying none, and one per
  tag-typed property left unlisted.
- A tag's key is still its `tag type` (`course:c1`), and `tags` may name
  only properties of a tag type.
- A projection declares **no partition**. The reference picks the tags:
  `CourseStatus tagged courseId`, `X tagged (tenantId, courseId)` for
  several (AND, as in any DCB query item). One fold can therefore be read
  per course and per student.
- `tagged` takes exactly one primary — a name or path, a typed literal,
  or a parenthesised group (a tag list or a nested reference) — and binds
  tighter than any comparison.
- A value whose type is not a tag type needs one: `tagged CourseId("c1")`.
  The wire stores only the operand; the key follows from it.
- Fan-out is visible: `tagged each items.productId`.
- "This handled event does not carry that tag" moves from the projection
  to an advisory on each reference.
- Non-tag arguments stay `with (…)`, and only scripted projections take
  them. Tags select events, `with` feeds the fold.
- Scripted projections lose `tagFilter`; a handler reads the reference's
  tag values as `tags.<TagType>`, and `args` holds the `with` arguments only.
- Derived projections (experimental) have operands that inherit every tag
  of their reference.
- Projection scenarios: `then X tagged CourseId("c1") …`; without
  `tagged` the fold is unfiltered.
- Entities (experimental): `entity Course tagged CourseId { … }`, used as
  `alias course = Course tagged courseId`. Nothing uses brackets for
  lookups any more.

### `alias`, and inline references

- `read` becomes `alias`, the wire format's own word for it, in the code
  and in how the pages name a declaration. "Reads N types / queries" stays:
  that one does describe a read.
- A projection reference may be written inline in a `require`, an emit
  field or another reference's tag, stored as a first-class operand and
  nestable. An alias is an optional name, stored as written, so printing
  stays lossless.
- The rule wizard writes inline references ("which projection", then
  "tagged by which value") and never invents an alias. Unreferenced
  aliases are still pruned on page edits, never on import or apply.

### No migration

Nothing is public yet, so v8 is a clean break: a fresh `EVENT_LOG_KEY`,
an importer that reads 8.x only, no upgrader. Old spellings get a quick
fix only where someone who never saw them might write them anyway —
`X(arg)` and `X for arg` suggest `X tagged arg`; `read`, `X[id]` and
`tagFilter` are ordinary syntax errors.

### Help is the documentation

The help modal and `help.js` go. The help button and shortcut open the
docs in a new tab — at the reference anchor for the construct under the
cursor in the code view, at the guide otherwise. The `ⓘ` hints keep their
short text and link to the docs. The anchor list stays callable as
`helpReferenceLinks()`, because the website's build reads it.

### Sandbox

State cards are watched projections with their tags, in the same
`tagged` spelling as the code; entity instance cards return with the flag.

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
- **An operand-level `tagged` inside derived projections.** No shipped
  model mixes tags across operands; it can be added later without a break.

## Owed to the website

Out of scope for now; the pinned submodule keeps dcb.events on the
previous playground until it is bumped. When it is:

- Every ```` ```dcb ```` block on the example and notation pages is
  rewritten in v8 (`scripts/dcb-render/render.js` parses with this repo's
  code).
- The Course subscriptions and Dynamic product price examples drop
  entities.
- Reference anchors renamed or added: `read` → `alias`, `read-entity`,
  `with`, `fan-out` (`each`), and new ones for `tagged`, event `tags`,
  inline references and typed tag literals. `helpReferenceLinks()` is the
  list the build checks.
- The notation guide's "Advanced" section is labelled experimental, and
  its "Open in Playground" links carry `&experimental`.
- `scripts/dcb-render/help-links.js` reads `helpReferenceLinks()` from
  `shared.js` now — `help.js` is gone. shared.js loads in an empty
  context, as help.js did.
- The playground's help button and `ⓘ` links open the reference by
  anchor (`NOTATION_ANCHORS` in shared.js); new anchors join that list
  only once the website defines them.
