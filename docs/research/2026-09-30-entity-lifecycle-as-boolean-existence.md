# Entity lifecycle — from a reserved "status" enum to a designated boolean

Date: 2026-09-30
Scope: how an entity's lifecycle is spelled, scaffolded, designated, displayed
and promoted. Touches `EntityDefinition` in `dcb-model.schema.json` (wire
format 6.1), `createEntity` and the entity page in `app/index.html`,
`lifecycleMachines` in `app/shared.js`, the seed builders in `app/model.js`,
and the Lifecycles view.

Prompted by reviewer pushback on the `status` convention. This note records
the decisions and the reasoning; it is not a primary-source investigation.

## The pushback

Three objections, from reviewers modelling with the tool:

1. When modelling an entity they did not think in terms of a status enum.
   Entities often have only one state, at least at first.
2. It is a new concept to learn whose benefit is not immediately visible —
   it slows down first exploration.
3. "Status" may already mean something domain-specific that is not the
   discrete state the entity is in.

## What was actually there

Worth stating precisely, because two of the three objections turn out to be
about presentation rather than structure.

`status` had already stopped being a reserved concept. Log key v9 dropped the
reserved property and its entity-derived enum; from then on `model.js:140`
said plainly that nothing enforces the convention, and
`EntityDefinition`'s own description said "a lifecycle is not a distinct
concept here". What remained was three things:

- a **scaffold**: `createEntity` wrote a `<Entity>Status` enum custom type with
  members `NonExistent` / `Existent`, a projection initialised to the first,
  and a property named `status` bound to it;
- **three readers keyed off the literal string** `'status'` —
  `lifecycleMachines` (and through it the whole Lifecycles page),
  `prefillChangeAdder`, and the change adder's reopen after an inline
  `createEntity`;
- every shipped model, authored that way.

So objection 1 describes what the scaffold already produced: the default
two-member enum's entire content *is* existence. Objection 3, by contrast, was
exactly right and had teeth — a modeller wanting `status` for a domain string
was silently absorbed into the Lifecycles page.

One incidental correction: the comment at `index.html:5796` claimed that in
Simple mode neither the enum nor the property is ever named. That is true of
the *creation gesture* only. A rule still renders through `readable()` as
`course · status == Non Existent`, so Simple mode hid the declaration, not the
concept. Custom Types and Lifecycles are Advanced-only views, which is why the
objection most likely arose while reading a shipped example in Advanced mode.

## The decision, in one line

Keep the structure — one projection, folded, feeding the boundary — and change
what the author types and reads.

## Decisions

### 1. A two-state lifecycle is a boolean, not an enum

`valueType: 'boolean'`, initial `false`, `set true` on the creating event,
guarded with the existing `isTrue` / `isFalse` unary predicates. No custom
type at first contact.

Rejected: an **inline enum schema** on the projection, which would give
`valueType` a second shape and change every reader, for cosmetics. Also
rejected: **keeping the named enum but hiding it** until it has three members.
That looked attractive — no type change ever, adding `Archived` is purely
additive — but the cliff it avoids is not the real cliff. A modeller who wants
archiving will not think "add a member to my lifecycle enum"; they cannot even
see it. They will add an `isArchived` boolean and write a second rule. That is
precisely the case the promotion suggestion exists to catch, so **the
promotion refactor is needed either way**, and once it exists, boolean → enum
promotion is the same machinery.

Two consequences accepted deliberately: `lifecycleMachines` must special-case
boolean as the two-state machine `[false, true]` or every two-state entity
drops off the Lifecycles page, and those two states have no names, so the page
labels them off the property instead.

### 2. The entity designates its lifecycle by property name

`EntityDefinition` gains an optional `lifecycle`, naming one of the entity's
own property bindings.

Rejected: a **flag on the binding or the projection**, because nothing would
stop two properties of one entity from setting it. Rejected: pointing at a
**projection** rather than a property — a condition reads `{alias, property}`
(`AliasPropertyValue`), so a lifecycle projection not bound as a property
could never be named by any rule, which is the one thing a lifecycle is for.

Additive, and **not** a wire major: a 6.0 reader that ignores `lifecycle`
loses a diagram, it does not misread a model. Unlike binding `isOptional`
(4.0), where the old reader errored on exactly the case the flag declared
expected. Hence 6.1, schema URL unchanged.

### 3. "The course exists" is rendered, not stored

The stored condition is ordinary — `{alias, property}` plus `isTrue` /
`isFalse`. The designation is what licenses rendering it as existence
language.

Rejected: an `exists` predicate in the wire vocabulary. A new member of a
closed vocabulary is a major by this project's own rule, and it buys nothing —
the evaluation is identical. `evaluate.js` does not change.

### 4. `exists`, and the concept is called "lifecycle"

The scaffolded property is `exists`, which reads correctly as a boolean at the
moment a newcomer meets it. It is renamed by the promotion, which has to ask
for names anyway. "Status" leaves the vocabulary entirely: it is the word that
collides with a domain field, and "lifecycle" is already the word in the code,
the page and the schema. ("Distinct state" was considered and dropped — nobody
says it out loud.)

### 5. `exists` lives in the Identity block

This **overturns the comment at `index.html:6131`**, which said a lifecycle,
unlike the identifier, is not part of identity: "it is an ordinary enum
property, listed below with everything else a modeler chose to track."

That was right when a lifecycle was one arbitrary enum among possibly several.
It is not right once the entity designates exactly one and it is called
`exists`. Existence is not something a modeller chose to track — it is the
precondition of everything else they track, and it belongs beside the
identifier for the same reason the identifier is there: nobody authored it, it
comes with being a thing at all. On a blank model this makes the first entity
page two rows that read as a sentence, one of which is an open question
("exists once — ").

Rejected: creating the entity **bare** and materialising `exists` on first
need. The change adder's flow is "create the entity, land on the change that
makes it exist"; saying "it exists" by recording a change needs something to
record into.

### 6. Promotion is a guided form, in one `run`

Forced rather than chosen: the promotion must invent a named enum type, name
its members, and name the property the states are held in. No tool can know
that `false`/`true` should become `NonExistent`/`Existent`, or that the third
state is `Archived` rather than `Retired`.

It executes inside one `run`, so the whole promotion is a single undo step —
a half-promoted model whose conditions still say `isTrue` while the projection
is an enum is exactly the incoherent state the log has no migration for.

**Generalised 2026-09-30** from "one boolean plus a new state" to
"*n* monotone booleans absorbed into one enum" (`mergeIntoLifecycle`). The
form is a list of steps; each step names a state and optionally the boolean
whose becoming-true is the arrow into it. The boolean is a picker, so the
author sets the progression order and can leave a boolean out of the merge —
neither of which the offer can guess.

Generalising it exposed a **soundness bug in the single-boolean version**. A
boolean absorbed at step *i* was true in every state from *i* onward — a
graduated student still exists — so `exists isTrue` must become
`equalsAny [Existent, Graduated]`, not `equals Existent`. The first cut
narrowed it to the one state named after the boolean, silently strengthening
every rule that mentioned it. `statesWhereHeld` is that translation and is the
main reason a merge is worth doing for the author rather than leaving them to
it. Two guards also come out of the general case: two booleans moved by the
same event cannot merge (one event moves a lifecycle to one state, and the
merged fold would need two handlers for it), and a non-monotone boolean is
refused as a stage even if asked for directly.

### 7. The suggestion fires in the rule wizard, and only for monotone booleans

Not in Problems. Advisories are defects; two separate correct checks are not a
defect, and a standing suggestion becomes noise the moment it is declined once
— which would need a dismissal store, i.e. UI state in a log whose whole
design is that it holds definitions. In-place has no persistence problem
because the moment passes, and it is where the information is best.

The trigger is: **two or more monotone booleans of one entity**, guarded
together — where monotone means never set back to its initial value by any
handler.

> **Amended 2026-09-30, after the first test of it.** The trigger originally
> also required that one of the two booleans be the *designated* lifecycle.
> That was wrong, and the first hands-on attempt found it immediately: an
> author added `registered` and `expelled` to Student by hand, and nothing
> offered a merge, because neither was the designation. Whether one of them
> happens to be designated says nothing about whether they are successive
> stages — which is the only question that matters. The monotonicity gate,
> which is the part that does the work, is unchanged.

This check is the load-bearing part. `exists && !archived` merges soundly,
because archiving is a one-way door and the three states are genuinely
successive. `exists && !isPublic` must **not** merge: a course can be
existent-and-public or existent-and-private, those are not states in a
sequence, and merging them destroys a dimension. Monotonicity is the readable
difference between the two, and without it the suggestion fires on every
boolean pair and trains the author to dismiss it.

### 8. Shipped models migrate selectively

Two-state entities become boolean `exists`; three-state ones stay enums with a
`lifecycle` designation.

`course-simple` already has a two-state Student and a three-state Course, so
migrated this way the first model a newcomer opens demonstrates both forms and
the relationship between them on one page — the promotion is taught without a
word of prose.

### 9. The designation is set from the entity page

**Reversed 2026-09-30, on the same day it was deferred.** The original
decision was that the scaffold writes the designation and the promotion moves
it, with no picker — on the argument that a control whose only job is to
declare which property is the lifecycle *is* objection 2, reintroduced at the
spot it was removed from, and that there is precedent for a read-only Identity
row.

That argument held only for the case it imagined. The case it did not: an
author who builds a state property by hand has no way to say it is the
lifecycle, and the promotion is not a door to that — the promotion invents an
enum, it does not adopt one. The unserved case was named in the original
decision and judged rare; the first session of real use hit it. So the
Identity lifecycle row is editable: a picker over the entity's own
single-valued boolean and enum properties, plus "none", because un-saying it
has to be possible wherever saying it is (`designationPicker`,
`lifecycleCandidates`).

The deferral did leave the right door open, which is the part that held up:
because `lifecycle` is a property *pointer* rather than a boolean
`hasLifecycle`, the picker is new UI over an unchanged wire format — no second
migration, no version bump.

### 10. Imports infer the designation once, at the gate

A 3.x–6.0 file has no `lifecycle` key. At import, a property named exactly
`status` and typed with an enum becomes the designation, and it is stored.

The inference is deliberately narrow — not `state`, not `exists`, not "the
first enum property". The old convention had one spelling and inferring past
it is guessing at a designation the author never made. Import is already
best-effort and already reports what it did, so this fits the existing gate.

Rejected: inferring at read time and storing nothing. A designation that is
sometimes stored and sometimes derived is two sources of truth and every
reader has to know which — the same reasoning that keeps `boundary`
authoritative rather than recomputed.

### 11. Lifecycles shows every entity, in two weights

Every scaffolded entity now has a designation and boolean counts as a machine,
so the page goes from "the few entities with an enum" to essentially all of
them. Existence-only entities get a compact row; three-or-more-state
lifecycles get the full machine. Both carry the unguarded dot.

Rejected: filtering existence-only entities off the page. The page's most
valuable output is the dot marking a command with no rule over the lifecycle,
and that applies hardest to two-state entities — a command that creates a
course without guarding "the course does not exist yet" is exactly the bug the
page should catch, and a filter makes it invisible in the likeliest case.
Rejected too: drawing them identically, which turns the page into a wall of
two-arrow diagrams and destroys the readability that makes the real machines
worth looking at. The distinction is visual, not a filter.

Exclusions shrink to `scripted`, `not-enum-or-boolean` (a designated property
typed string or integer — reachable only by hand-editing or a WebMCP tool) and
`dangling` (a designation naming a property that is gone, which is also an
advisory).

### 12. Simple/advanced mode is out of scope

The mode question is real and larger than this one. It is held out, under an
explicit test: **nothing above may depend on Advanced mode hiding something.**
As designed nothing does — boolean `exists`, no custom type, no enum, one
designation, display sugar. A blank-model author on a single undifferentiated
surface meets a thing called "exists" and nothing else.

## Mechanics

- `EVENT_LOG_KEY` → `v19`, changelog comment above the constant updated.
- `MODEL_VERSION` → `6.1`; `MODEL_SCHEMA_URL` and `READABLE_MAJORS` unchanged.
- `dcb-model.schema.json`: `EntityDefinition` gains `lifecycle`; its "A
  lifecycle is not a distinct concept here" paragraph is now false and is
  rewritten. Then `node app/generate-webmcp-schemas.js`.
- `node app/generate-examples.js` regenerates `app/examples/*.json` except the
  deliberately hand-edited `course-simple.json`.
- The advisory-clean test over `PREDEFINED_MODELS` is what proves the
  migration was complete.
- All three suites run: `evaluate.test.js`, `ui.test.js`, `webmcp.test.js`.

## Reversed (2026-10-01): no lifecycle unasked

Decision 1 assumed every entity should arrive with `exists` designated, so
that "the course exists" was available from the first rule. In practice that
put "exists" / "does not exist" in front of authors who had never asked for a
lifecycle: in the rule wizard's value picker, in rule sentences, on every
fresh entity page. The vocabulary was cheap, but it was still vocabulary
nobody had chosen.

Now a new entity is **bare**: its identifier type and nothing else, from
every place an entity is created (rail, blank model, rule wizard, change
adder). A lifecycle is added from the entity's Identity block, through a
`+ lifecycle` control with three doors:

- **Exists (boolean)**: one click, the same `exists` boolean the scaffold
  used to make, designated. If the entity still has a usable `exists`
  boolean (for example after its lifecycle was removed), that one is
  designated again instead of a second being created. If `exists` is taken by
  something that cannot be a lifecycle, the door is not offered:
  `existenceLifecycleOffer`.
- **Named states (enum)**: the promotion form in a third mode
  (`scratchLifecycleDraft`). Two states are enough here, because an author
  who chose an enum on purpose (Draft, Published) should not be pushed to a
  third state or back to a boolean. Promoting a boolean still needs three.
- **Existing property**: the designation picker, shown only when there are
  candidates.

The rest follows from the designation, which is the explicit act:

- **The sugar is unchanged.** `existenceRead` already keyed off a designated
  boolean lifecycle, so without one the existence wording simply never
  appears. A hand-built boolean designated by the author gets the same
  treatment (`isActive` → "is active" / "is not active").
- **`not designated` is gone**, and so is the "quiet lifecycle" case
  (`lifecycleIsQuiet`). The first made an absence that is now the default
  read as a fault. The second hid an unmoved boolean because nobody had asked
  for it. Now a lifecycle exists only because somebody added it, so it always
  shows, folded, and `set by —` tells the author the next step.
- **Remove lifecycle** (`⋮`) drops only the designation. The property stays
  an ordinary boolean that a rule may still read, and those conditions go
  back to reading literally (`course · exists holds`). Deleting the property
  goes through the ordinary property delete, with its own guard.
- **The change adder** used to reopen on `set exists → true` after creating
  an entity mid-change. It now opens the new-property form on the fresh
  entity, the same move the rule wizard makes. The rule wizard offers no
  lifecycle shortcut either: one would bring back the automatic lifecycle
  through a different door.

Unchanged: the shipped models (their `exists` designations were written on
purpose), the import inference from `status` + enum, the Lifecycles page, the
merge offer, and the wire format. No stored shape changed, so neither
`EVENT_LOG_KEY` nor the schema moves. Logs written before this change keep
their scaffolded `exists` designations as ordinary authored data.
