# A code view for DCB models — language design

2026-10-03. Background for `app/dsl.js` and the Code view in `app/index.html`.

## Question

Developers are the audience, and some of them would rather read and write a
model as text than click through pages. What should that text look like,
given two existing event-sourcing DSLs whose authors are open to small
suggestions, and given that the playground's wire format
(`dcb-model.schema.json`) is the source of truth?

## Sources

- **heklang** — <https://git.tqwewe.com/tephra/heklang>, README and
  `docs/commands.md`, `docs/guards.md`, `docs/testing.md`,
  `docs/declarations.md` (read 2026-10-03). A total language for
  event-sourced application logic, explicitly DCB-native: "the slices a
  command folded *are* the condition its append is checked against".
- **Weltenwanderer** — <https://www.weltenwanderer.dev/>, the Decider, Event
  and Command language pages (read 2026-10-03). A `.ddd` specification
  language compiled to verified TypeScript, organised around deciders
  (`decide` / `evolve` over an algebraic state).

## What each one does that matters here

| Concern | heklang | Weltenwanderer | Playground wire format |
| --- | --- | --- | --- |
| Unit of decision | `command Name(params) { … }` | `decide(Command, State)` inside a `decider` | `commandDefinitions[]` |
| What is read | `fold x: T = init on @ev(field) => expr` — a read and its accumulator in one place, inline in the command; `guard Name { … }` shares one | the decider's whole state, by construction | `boundary[]` bindings to *named* entities / projections, folded elsewhere |
| Condition | `if cond { reject Refusal }` | `require cond else reject "msg"` | `conditions[]`, no message |
| Emit | `emit @ev { field, other: x }` (shorthand when names match) | `-> [Ev { fields }]` | `publishes[]` with a parameter map |
| Boundary | derived from the folds | the decider / context | derived from the bindings (`deriveDcb`) |
| Tests | `test "…" { given …; run …; expect … }` | — | scenarios with a frozen, derived Then |

The fundamental difference: heklang folds *inline* (a fold belongs to the
command that reads it, shared through guards), Weltenwanderer folds *per
decider* (an aggregate-shaped state). The playground does neither — a fold is
a named projection, bound by entities and commands alike. A text for the
playground has to say that, or it is not the same model.

## Decision

A language of its own that is **a spelling of the wire format**: every
construct is exactly one schema shape, so printing and parsing are inverses
and nothing is inferred. What was borrowed:

- from heklang: `emit Event { field, other: value }` with the shorthand, and
  `on Event => …` for a projection's handlers;
- from Weltenwanderer: `require` for a rule, `type X = string`, `X[]` lists;
- from both: `@annotation(...)` for presentation-only fields (`@icon`,
  `@feature`) and `@tagSchema`.

What is the playground's own:

- `read course = Course[courseId]` — brackets look an entity up by
  identifier, parentheses pass a projection its arguments
  (`CourseNumbering()`, `TenantCourseNumbering(tenantId)`). The alias is
  always written because the schema stores it. A fan-out is not marked: it
  follows from the operand's type, as in the schema.
- `tag type CourseId = string` — `isTag` as a modifier; `enum` and `record`
  for the two common custom-type shapes, `type X = <base> { …schema… }` for
  the rest.
- Schema tokens where the interface already uses them (its technical
  register): `currentValue`, `successor(x)`, `event.data.x`, `contains`,
  `containsAny`, `startsWith`, `endsWith`, `tagFilter`, `initialState`,
  `exposes`. Everything else is what a developer types: `==`, `!=`, `<`,
  `in [A, B]`, `count(x) < 3`, `is empty`, `is true`.
- Scripted handlers as fenced code (`on Ev => ```expr```  `), so the code
  needs no escaping; the editor highlights the fence as JavaScript.
- `derived A(x) != B(x)` for a derived projection.

### The guarantee that made the rest cheap

Printing is lossless by construction: each definition is printed, parsed
back and compared (`sameDefinition`); one that does not survive — an unknown
predicate, a name the grammar cannot write, a parameter and a read with the
same name — is printed as its stored JSON (`command Foo json { … }`) under a
comment saying why. So a feature can have no spelling yet without the code
view ever dropping it, and an untouched text applies as no change at all. The
tests hold every shipped model and example free of fallbacks.

### Rejected

- **Inline folds, heklang-style.** Shorter for one command, but a projection
  bound by two entities and read by three commands would have to be written
  five times, or the text would stop being the model.
- **Decider blocks, Weltenwanderer-style.** An entity is deliberately *not*
  a consistency boundary in DCB; grouping commands under one would reintroduce
  the aggregate the schema dissolves.
- **Implicit aliases** (`read Course[courseId]` meaning `course`). The
  schema stores the alias; a default would be a second source of truth.
- **Rename detection** in the diff. A rename in the text is a removal plus
  an addition; `rename_definition` (WebMCP) and the pages remain the way to
  move references with a name.

## Suggestions for the two authors

Offered as small, additive proposals. Neither project's documentation
answered every question below, so each one may already be covered somewhere
I did not find.

**heklang**

1. *Declared tags on events.* A slice filter `on @order.placed(customer_id)`
   says which field a *read* narrows by. A field annotation such as
   `customer_id: Customer @tag` (alongside `@subject`) would say which fields
   an event *writes* as tags. A checker could then flag an emitted tag the
   command never read (the playground's write-coverage advisory), and a
   module could be exported as a DCB model and back without guessing tags
   from fold filters.
2. *Append condition in the digest.* `hek check --boundaries` lists which
   guards a command reaches. If `docs/digest.md`'s s-expressions don't already
   carry it, printing each command's resolved append condition (event types ×
   tag fields) there would let a heklang module and a playground model be
   compared boundary for boundary.

**Weltenwanderer**

1. *Instance identity.* The command and decider pages don't say how a decider
   finds the instance a command is about. A field-level marker — `cartId:
   CartId @key`, or `type CartId = String @tag` — would make the consistency
   boundary of each `decide` derivable as a DCB query, and a `.ddd` decider
   comparable with a playground command.
2. *Reads beyond the decider's own state.* A `decide` that needs another
   decider's state (a student's subscription count while subscribing to a
   course) is the case DCB exists for. Even a read-only `consults Other(id)`
   clause would let such a decision be stated without merging the two
   deciders.

## What would make this better next

- An `else "message"` on `require` (Weltenwanderer's spelling) would need a
  schema change — conditions carry no message today.

## Addendum, same day: scenarios in the text

First left out (a frozen, derived Then and a hidden id looked like noise),
then added after a design round with the maintainer. Decisions:

- **Both kinds, nested** in the block of the command or projection they are
  about, and naming it: `when DefineCourse { … }` for a command,
  `then CourseStatus("c1") == Existent` for a projection (positional
  arguments in declared order; no parentheses without parameters; named
  only where the projection is gone). The name must match the block —
  moving a scenario into the wrong block is an error, not a reassignment.
- **The Then is optional.** Written, it is an assertion stored as written,
  as heklang's `expect` is; left out, an apply records what the model does,
  which is the page's save. A refusal is `then rejected by <rule> saw L, R
  [at n]`, the rule in the language's own syntax while the command still
  has it (quoted stored text otherwise), `saw …` optional on the same
  terms.
- **Drift is a warning with a quick fix** ("Accept actual outcome"),
  computed against the unapplied text; applying never accepts it.
- **No ids in the text.** Blocks are matched to stored scenarios by
  content, then by place within their subject, then by place among the
  leftovers — so an edited scenario, and every scenario of a command
  renamed in the text, keeps its id. Scenario order is display only; an
  apply keeps the stored interleaving and takes each subject's order from
  the text.
- **One `then` per projection scenario**, because the format stores one
  assertion each; grouping several over one Given was left for later, as
  it would make text and storage stop being one-to-one.
- **Enum members print bare** where the type says enum; they are stored as
  strings either way.
