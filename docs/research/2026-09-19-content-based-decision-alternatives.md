# Primary-source grounding for content-based decision building blocks

Date: 2026-09-19
Scope: two proposed declarative building blocks for the "Content based decisions"
predefined model (`seedContentDecisionsScripted` in `app/model.js`), which today
needs a scripted projection to compare `currentText` against `publishedText`:

1. **Guarded emissions** — an optional `when: [conditions]` clause on each of a
   command's published events, so one command conditionally emits `TextChanged` vs
   `TextRevertedToPublished` (decision made at write time, recorded in the log).
2. **Derived projections** — a projection with no handlers whose value is a declared
   predicate over two other projections (`hasPendingChanges = not(currentText equals
   publishedText)`), defined once as data and reusable by a real app's frontend.

Also weighed: the comparison living in command *conditions* (append condition /
consistency boundary), and the client echoing a value the command verifies
(optimistic-check style).

## What counts as a primary source here

| Tier | Sources used | Status |
|---|---|---|
| The DCB canon | dcb.events — specification, topics (projections, aggregates), examples, FAQ; quotes verified against the site's markdown source (`dcb-events/dcb-events.github.io`) | First-party, the reference the playground models itself on |
| Pattern originators | Jérémie Chassaing, *Functional Event Sourcing — Decider* (thinkbeforecoding.com, 2021); Sara Pellegrini, *Kill the Aggregate* series + *A name for an idea: Dynamic Consistency Boundary* (sara.event-thinking.io, 2023) | First-party writing by the originators of the decider pattern and of DCB |
| Library source code | wwwision/dcb-example-courses (PHP), @dcb-es/event-store examples (TypeScript), gember/event-sourcing (PHP), Axon Framework 5 docs (Java) | Code and first-party docs; code read at the repos' `main` branches on 2026-09-19 |
| Client-side derivation | Redux Style Guide (redux.js.org, first-party), eventmodeling.org (first-party) | First-party documentation, opinionated, not ES-specific (Redux) |

No secondary write-ups. Where a source is silent, the silence is recorded as a finding.

---

## Q1. The DCB canon: where does decision logic live, and does anything decide from event content?

### The Decision Model, as defined

The canonical definition sits in the projections topic page —
<https://dcb.events/topics/projections/>:

> The result is commonly used for persistent Read Models. In Event Sourcing, however,
> projections are also used to build the Decision Model needed to enforce consistency
> constraints.

with the inline glossary defining Decision Model as:

> Representation of the system's current state, used to enforce integrity constraints
> before moving the system to a new state

and, on scope and minimality:

> in the context of DCB, projections are typically used to reconstruct the minimal model
> required to validate the constraints the system needs to enforce — usually in response
> to a command issued by the user.

The aggregates topic page — <https://dcb.events/topics/aggregates/> — names the concept's
role explicitly:

> we often refer to this construct as a **Decision Model**, emphasizing its role in
> evaluating business rules and producing decisions in a specific context.

> In essence, DCB makes it possible to construct a Decision Model dynamically, just for
> the duration of an operation, to guard the relevant invariants.

And the FAQ — <https://dcb.events/faq/> — leaves placement of logic open:

> DCB enables you to structure code around use cases in order to focus on the behavior
> rather than the data models.
>
> However, DCB does not dictate how you design your application.

### The specification is silent on all of this — deliberately

The spec — <https://dcb.events/specification/> — defines only the Event Store surface.
Queries filter "by their Type and/or Tags"; payload is out of scope by definition
(section *Event Data*):

> Opaque payload of an Event

So *nothing* about decision models, conditional emission, or projections is specified.
Everything below comes from the canon's informative pages and examples, not from the
spec — a fact that cuts both ways: the playground cannot violate the spec with either
proposed block, and cannot cite it in support either.

### Decisions from event content: yes, pervasively

Content-based decisions are not exotic in the canon — most examples fold payload values
into the Decision Model and compare them:

- **Dynamic product price** — <https://dcb.events/examples/dynamic-product-price/> —
  folds prices out of event payloads (`ProductDefined: (state, event) => event.data.price`)
  and the handler compares folded content against a command value:

  > ```js
  > if (state.productPrice !== command.displayedPrice) {
  >   throw new Error(`invalid price for product "${command.productId}"`)
  > }
  > ```

  This is also the canon's **optimistic-check / client-echo example**: the requirement is
  "The product prices that are shown to the customer must be used for processing the
  order", the command carries `displayedPrice: 123`, and the handler verifies the echoed
  value against state folded from event content. The pattern the design question calls
  "the client echoes a value the command verifies" is therefore canon-blessed, verbatim.

- **Course subscriptions** — <https://dcb.events/examples/course-subscriptions/> — the
  `changeCourseCapacity` handler's constraint compares payload-derived state to a command
  value: `"condition": "state.courseCapacity === command.newCapacity"` with error
  "New capacity {command.newCapacity} is the same as the current capacity".

- **Opt-in token** — <https://dcb.events/examples/opt-in-token/> — conditions over folded
  content: `"condition": "state.pendingSignUp.otpUsed"`, and the success event copies
  folded content back out: `"name": "{state.pendingSignUp.data.name}"`.

- **Invoice number** — <https://dcb.events/examples/invoice-number/> — the strongest
  "write-time decision recorded in the log" case: the projection folds payload
  (`InvoiceCreated: "event.data.invoiceNumber + 1"`) and the emitted event's *content* is
  computed from it (`"invoiceNumber": "{state.nextInvoiceNumber}"`). The decision (which
  number this invoice gets) is made at write time and recorded, guarded by the append
  condition.

So "decisions from event content" needs no new precedent — the canon does it everywhere.
What is genuinely new in the proposals is *where the comparison is declared* and *what it
selects*.

### Conditional emission: absent from the canon

Every command handler in every dcb.events example — both the JS code listings and the
embedded `application/dcb+json` models — has exactly one outcome shape: a list of
constraint checks that *reject*, and a **single, fixed** success event. The dcb+json
`commandHandlerDefinitions` field is literally singular:

> ```json
> "constraintChecks": [ { "condition": "...", "errorMessage": "..." } ],
> "successEvent": { "type": "...", "data": { ... } }
> ```

(seen identically in invoice-number, course-subscriptions, unique-username, opt-in-token,
prevent-record-duplication; source markdown at
<https://github.com/dcb-events/dcb-events.github.io/tree/main/docs/examples>). No example
selects between two event types, and no example emits a second event conditionally. The
event-sourced-aggregate example's handlers likewise only throw
(`Course "..." is already fully booked`) or emit their one event.

**Finding: the DCB canon has no conditional emission — absence of precedent, not
counter-precedent.** Nothing on those pages argues against it; the vocabulary simply
stops at reject-or-emit-one.

### Derived/computed projections: composition exists, derivation does not

The projections page has a whole section on composition —
<https://dcb.events/topics/projections/>, "Composing projections":

> the `composeProjections` function allows to combine multiple smaller projections into
> one, depending on the use case

with the motivation that a monolithic projection

> makes the projection more "greedy", i.e. if it was used to make a decision based on
> _parts_ of the state it would consume more events than required and increase the
> consistency boundary needlessly

But the composite's state is a keyed record of the parts
("the state of the composite projection is an object with a key for every projection of
the composition") — the *comparison over the parts still lives in the command handler*.
No page defines a projection whose value is a declared predicate over other projections.
**Finding: composition of projections is canon; a handler-less derived projection is
not.** The proposed block extends `composeProjections`' direction (small, reusable,
per-question projections) one step further than any canon page goes.

---

## Q2. The decider pattern: write-time decisions recorded as distinct event types

Jérémie Chassaing, *Functional Event Sourcing — Decider* —
<https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider>.
Quotes verified against the page text.

### The type, and the conditional emission at its heart

> ```fsharp
> type Decider<'c,'e,'s> =
>     { decide: 'c -> 's -> 'e list
>       evolve: 's -> 'e -> 's
>       initialState: 's
>       isTerminal: 's -> bool }
> ```

The article's own first illustration of `decide` is precisely conditional emission of
*different event types depending on state* (section "Events"):

> A Switch Light On Command will, if valid, produce a Light Switched On Event.
> A Transfer Money Command will produce a Money Transferred Event, or a Money Transfer
> Rejected Event due to insufficient funds.

Note the second example goes further than the playground's proposal: even the *negative*
outcome is an event. (The playground deliberately keeps rejection as an outcome channel,
not a published event — the two-failure-kinds convention — which is a divergence to be
aware of, not a conflict: Chassaing presents the rejected-event as one possibility, not a
requirement.)

### Why the decision is made at write time and recorded

The justification is explicit (section "Events"):

> To avoid these conflicts, we untangle decision making from the changing of the state.
> We'll be explicit about what happens by materializing decision outcomes before changing
> state, and changing state based only on the decision outcome data.

and the meaning of `decide` (section "Decision"):

> The code checks what the situation is and follows the rules defined by the domain to
> modify the State in a consistent way.

> When asked to process this Command in a given State, here is what happens, expressed as
> Events.

The direct answer to "make the decision explicit in the event vs derive it at read time"
is the evolve-side corollary (section "Evolution"):

> The code of the evolve function should be extremely simple; the Decision has already
> been taken. It should probably not be more that setting a field, adding a element to a
> list, incrementing a value, or setting/resetting a flag. [sic]

**This is the strongest primary-source statement found for the guarded-emissions block:**
decisions belong in `decide` (write time, recorded as which events came out), and folds
should be trivial. A scripted projection that re-derives "was this a revert?" on every
fold is exactly the complexity Chassaing pushes out of `evolve`.

### Purity constraints that a declarative `when:` inherits for free

> Its return value should depend only on the input parameters

`decide` is a pure function of `(command, state)`. A `when: [conditions]` clause over the
command payload and the resolved decision-model state is a restricted `decide` — the
restriction (declared predicates instead of arbitrary code) loses generality but keeps
the exact same inputs, which is what makes it honest to call the block a declarative
decider fragment.

### Logic defined once, hosted anywhere

The article's closing sections ("Run in memory", "Run on a database", "Run on an event
store") run the *same* decider record against three different infrastructures:

> We can easily make a decider run in memory on a mutable State variable

This is the functional-ES precedent for "logic defined once, as data, reusable
elsewhere" — though the article's hosts are all server-side; it says nothing about
frontends (see Q5). The article also does not discuss read models or projections at all —
its scope ends at the decider.

---

## Q3. Sara Pellegrini's *Kill the Aggregate*: the origin of the DCB decision model

All quotes verified against the posts' content (sara.event-thinking.io, April–May 2023).

### The decision block, and the model it loads

Chapter 7, *Focus on the behavior* —
<https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-7-focus-on-the-behavior.html>:

> The causal link between them is represented by a decision, taken on the basis of one or
> more business rules. This is precisely the atomic element we need, the block that
> connects a specific trigger to its consequences.

> The important bit here is that the decision block is able to load the model needed to
> do its job.

### How much logic, from what data — including event content

Chapter 8, *The death of the aggregate* —
<https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-8-the-death-of-the-aggregate.html> —
walks `UpdateCourseCapacity` and grounds the decision in event *content*, not just
existence:

> The command handler could only fetch the events it cares about, which are only two:
> the creation event, necessary to verify that the course exists[;] the
> CourseCapacityChanged event, since the new capacity must be different from the previous
> one

("the new capacity must be different from the previous one" is a comparison between a
command value and a payload value — the same shape as the playground's
`currentText equals publishedText`.) The guidance on *how much* logic is entirely about
minimality of the loaded model, not about restricting the decision itself:

> The message handler knows exactly what it needs to load in order to make a decision.

### Decision = events in, events out

The naming post, *A name for an idea: Dynamic Consistency Boundary* —
<https://sara.event-thinking.io/2023/05/dynamic-consistency-boundary.html> — defines the
decision in exactly the functional form:

> While using event sourcing, any decision could be represented by a function that
> receives as input an ordered stream of events and produces as output an additional
> ordered stream of events.

> The output stream represents the future, the evolution of the state that my decision
> causes.

Nothing in that definition fixes the output to one event type — the output stream is
whatever the decision determines.

### The one conditional-emission precedent in the DCB origin texts

Chapter 9, *An Event is just a fact, pure* —
<https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-9-an-event-is-just-a-pure-fact.html>:

> For example, if after a student is subscribed, the course reaches its maximum capacity,
> I may want to publish the CourseFullyBooked Event in the same transaction.

That is a state-dependent, write-time-decided, *conditionally published* event, in the
founding series itself. It is a conditional *additional* event rather than a choice
between two alternatives, but it is the same mechanism a `when:` clause declares: this
event is published only when a predicate over the decision model holds. **This is the
closest thing to direct DCB-lineage precedent for guarded emissions.**

Nothing in the series touches derived projections or frontend reuse; the decision model
is presented throughout as an ephemeral, per-use-case artifact ("just for the duration of
an operation", as dcb.events later phrased it).

---

## Q4. What the DCB libraries actually do when a decision needs folded content

Code is the primary source here. Three implementations read, all listed on
<https://dcb.events/resources/libraries/>.

### wwwision/dcb-example-courses (PHP, companion to wwwision/dcb-eventstore)

<https://github.com/bwaidelich/dcb-example-courses/blob/main/src/CommandHandler.php>
(`main`, 2026-09-19). Every handler is: build a composite decision model from small
projections, then imperative guard clauses over folded content, then append **one fixed
event type**. Content comparisons in host-language code:

> ```php
> if ($decisionModel->state->courseTitle->equals($command->newCourseTitle)) {
>     throw new ConstraintException(sprintf('Failed to rename course ... because this is already the title of this course', ...));
> }
> ```
> (src/CommandHandler.php:88)

> ```php
> if ($decisionModel->state->courseCapacity->equals($command->newCapacity)) { ... }
> if ($decisionModel->state->numberOfCourseSubscriptions > $command->newCapacity->value) { ... }
> ```
> (src/CommandHandler.php:166–171)

The projections themselves are declarative-ish closures folding payload
(`->when(CourseCapacityChanged::class, fn($_, $event) => $event->newCapacity)`,
src/CommandHandler.php:204), composed via `CompositeProjection`
(src/CommandHandler.php:274–288) — the direct ancestor of the site's
`composeProjections`. No handler emits conditionally.

### @dcb-es/event-store (TypeScript, Kraken Tech)

Example app at
<https://github.com/kraken-tech/dcb-event-store/blob/main/examples/course-manager-cli/src/api/Api.ts>
(repo redirects to PaulGrimshaw/dcb-event-store; `main`, 2026-09-19). Identical shape —
`buildDecisionModel`, guards over content, one fixed event:

> ```ts
> if (state.courseTitle === newTitle) throw new Error("New title is the same as the current title.")
> ```
> (Api.ts:82)

And the invoice-number pattern reappears — folded payload becomes emitted payload:
`NextStudentNumber` folds `event.data.studentNumber + 1`
(src/api/DecisionModels.ts:66–73) and the handler records the decision in the event:
`new StudentWasRegistered({ studentId: id, name, studentNumber: state.nextStudentNumber })`
(Api.ts:50). The decision models (DecisionModels.ts) are small named fold definitions —
`CourseTitle`, `CourseCapacity`, `StudentAlreadySubscribed` — but every *comparison* over
them lives in Api.ts as imperative code.

### gember/event-sourcing (PHP)

<https://github.com/GemberPHP/event-sourcing> README, "A simple example": a use-case
object folds state into private fields and the command handler is an ordinary method —
notable for a *third* outcome shape beyond reject/emit:

> ```php
> // 1. Check idempotency
> if ($this->isSubscribed) {
>     return;
> }
> ```

— a state-dependent silent no-op (neither rejection nor event). Decisions over content
are, again, arbitrary host-language code.

### Axon Framework 5 (Java)

The migration notes —
<https://docs.axoniq.io/axon-framework-reference/5.0/migration/understanding-architecture-principles/> —
state only: "Axon Framework 5 moves to a 'Dynamic Consistency Boundary' (DCB) model.
Rather than assuming a single aggregate root per stream, events can be organized by
tags." Command handlers remain ordinary Java methods; nothing constrains or declares
which events they publish. Not examined deeper — the pattern is the same as above by
construction.

### The libraries' collective answer

**When a command must decide based on folded state content, every DCB library expresses
it as imperative guard clauses in host-language code over a composed decision-model
state, and then appends a statically known event (list).** No library offers a
declarative predicate vocabulary, no shipped example emits alternative event types, and
none derives one projection from others — the derivation is always inlined where the
decision is coded. The playground's *scripted* projection today is faithful to this state
of practice; the proposed declarative blocks would be ahead of it, not against it.

---

## Q5. Derived read models defined once and reused client-side

This is where the primary sources thin out fastest.

### The fold definition itself

Greg Young's 2013 minimal definition of a projection, republished as the anchor of
<https://dcb.events/topics/projections/> (original:
<https://x.com/gregyoung/status/313358540821647360>), is transcribed on that page as:

> ```ts
> type Projection<S, E> = (state: S, event: E) => S
> ```

Worth stating plainly: **a handler-less derived projection is not a projection under
this definition** — it consumes no events. It is a function of other projections' states.
The ES literature has a shape for that too, it just lives outside ES:

### Redux's first-party guidance is the exact shape of the proposal

Redux Style Guide, *Keep State Minimal and Derive Additional Values* —
<https://redux.js.org/style-guide/#keep-state-minimal-and-derive-additional-values>:

> Whenever possible, **keep the actual data in the Redux store as minimal as possible,
> and _derive_ additional values from that state as needed**. This includes things like
> calculating filtered lists or summing up values. [...] Similarly, a check for whether
> all todos have been completed, or number of todos remaining, can be calculated outside
> the store as well.

> This has several benefits:
> - The actual state is easier to read
> - Less logic is needed to calculate those additional values and keep them in sync with
>   the rest of the data
> - The original state is still there as a reference and isn't being replaced

> Deriving data is often done in "selector" functions, which can encapsulate the logic
> for doing the derived data calculations.

`hasPendingChanges = not(currentText equals publishedText)` is, in Redux's first-party
vocabulary, a **selector** over two pieces of minimal state — with the listed benefits
mapping one-to-one onto the playground's motivation (the status is never stored, never
stale, and the underlying texts remain inspectable). Redux is a client-side state
container, not an ES framework, but it is the only first-party source found that
describes exactly this construct, and it happens to be *the* frontend-side canon.

### Functional ES: same logic, many hosts — but no frontend claim

Chassaing's "Run in memory / Run on a database / Run on an event store" (Q2) is the
functional-ES precedent for defining decision/fold logic once and hosting it in multiple
runtimes. It stops at server-side hosts. **No functional-ES primary source found claims
"ship the fold/derivation definition to the frontend."**

### Event Modeling

eventmodeling.org (first-party, Adam Dymitruk) describes views as event-derived —
*What is Event Modeling?*, <https://eventmodeling.org/posts/what-is-event-modeling/>:

> A view into the facts already in the system has been changing as these new events were
> being stored.

— but says nothing about derivation logic as a shared, reusable artifact. It documents
*that* views derive from events, not *where the derivation is defined or reused*.

**Finding: "projection/derivation definitions as portable data, consumed by a frontend"
has no precedent in the sources consulted.** The playground's interchange format is doing
something the ES canon describes only as code. The closest supports are Chassaing
(pure logic, multiple hosts) and Redux (derive-don't-store, on the client) — two halves
that no single primary source joins.

---

## What this means for the playground's two proposed blocks

Sticking strictly to what the sources support:

### Guarded emissions (`when:` on published events)

- **Precedented by the decider pattern, explicitly.** Chassaing's canonical illustration
  of `decide` is a command producing "a Money Transferred Event, or a Money Transfer
  Rejected Event" depending on state, and his rationale — "materializing decision
  outcomes before changing state", evolve kept trivial because "the Decision has already
  been taken" — is precisely the argument for recording `TextRevertedToPublished` in the
  log instead of re-deriving revert-ness in every fold.
- **Precedented in the DCB origin series** as conditional *additional* emission: Sara's
  "if after a student is subscribed, the course reaches its maximum capacity, I may want
  to publish the CourseFullyBooked Event in the same transaction" (Chapter 9), and her
  definition of a decision as an events-in → events-out function fixes nothing about the
  output.
- **Unprecedented in the dcb.events examples and every DCB library example read** — all
  of which are reject-or-emit-one with a singular `successEvent` / fixed append. The
  block extends the DCB-example vocabulary; nothing found contradicts it. Guard inputs
  should stay `(command, state)` — the purity constraint `decide` carries ("Its return
  value should depend only on the input parameters") is what keeps a declared `when:`
  equivalent to a restricted decider.
- One divergence to keep deliberate: Chassaing's example records even the *rejection* as
  an event; the playground's two-failure-kinds convention keeps rejection out of the log.
  The sources present both; neither mandates either.

### Derived projections (handler-less predicate over other projections)

- **Half-precedented.** Composition of small projections into a decision model is canon
  (`composeProjections`, dcb.events; `CompositeProjection`, wwwision) — but in every
  source the *predicate over the composed parts* is imperative code in the command
  handler. Declaring that predicate as data goes one step beyond all of them.
- **Naming caution grounded in the canon:** under Greg Young's `(state, event) => state`
  definition — the one dcb.events itself leads with — a handler-less definition is not a
  projection; in Redux's first-party vocabulary it is a *selector* ("derive additional
  values", "selector functions ... encapsulate the logic"). The concept is solidly
  precedented; calling it a *projection* is not. Whatever the UI names it, the
  distinction (folds events vs derives from other state) is one every consulted source
  maintains.
- **The frontend-reuse motivation has no ES primary source.** Chassaing supports
  logic-once-many-hosts (server-side); Redux supports derive-on-the-client; no source
  joins them into "ship the derivation definition as data to the frontend". That part of
  the proposal is novel and should be argued on its own merits, not on precedent.

### The two alternatives, for the record

- **Comparison in command conditions** is the *most* precedented option — it is what
  every canon example and every library does with content (`state.courseCapacity ===
  command.newCapacity`; `courseTitle->equals($command->newCourseTitle)`). Its known limit
  in the playground is the very reason for the proposals: it decides accept/reject, not
  which-event, and it cannot name a reusable derived value.
- **Optimistic check (client echoes, command verifies)** is canon-blessed verbatim: the
  dynamic-product-price example's `displayedPrice` is exactly this, including the
  business framing ("the displayed price is taken into account – if it is valid").

## Gaps: where there is no primary source

1. **No DCB-canon or DCB-library example emits alternative event types from one
   command.** The dcb+json embedded format's `successEvent` is singular by shape.
   Guarded emissions rest on decider-pattern and Chapter-9 precedent only.
2. **No source defines a projection derived from other projections without handlers.**
   Composition (keyed record) is as far as any goes.
3. **No source describes shipping fold/derivation definitions as data to a frontend.**
   The interchange-format reuse story is unprecedented in everything consulted.
4. **Chassaing's decider article does not discuss projections or read models at all** —
   its authority stops at the write side.
5. **Sara's series gives no guidance on how much logic belongs in a decision model**
   beyond minimality of the events loaded; the "how much" question is unaddressed.
6. **Axon Framework 5's DCB docs say nothing about decision logic placement** — only the
   storage-model shift to tags. Not pursued further.

---

## Sources

The DCB canon (quotes verified against
<https://github.com/dcb-events/dcb-events.github.io> `docs/`):

- Specification — <https://dcb.events/specification/>
- Projections topic — <https://dcb.events/topics/projections/>
- Aggregates topic — <https://dcb.events/topics/aggregates/>
- FAQ — <https://dcb.events/faq/>
- Examples: dynamic product price — <https://dcb.events/examples/dynamic-product-price/>;
  course subscriptions — <https://dcb.events/examples/course-subscriptions/>;
  invoice number — <https://dcb.events/examples/invoice-number/>;
  opt-in token — <https://dcb.events/examples/opt-in-token/>;
  unique username — <https://dcb.events/examples/unique-username/>;
  event-sourced aggregate — <https://dcb.events/examples/event-sourced-aggregate/>;
  prevent record duplication — <https://dcb.events/examples/prevent-record-duplication/>

Pattern originators:

- Jérémie Chassaing — *Functional Event Sourcing — Decider* (2021-12-17) —
  <https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider>
- Sara Pellegrini — *Kill the Aggregate*, Chapter 1 —
  <https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-1-I-am-here-to-kill-the-aggregate.html>;
  Chapter 7 — <https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-7-focus-on-the-behavior.html>;
  Chapter 8 — <https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-8-the-death-of-the-aggregate.html>;
  Chapter 9 — <https://sara.event-thinking.io/2023/04/kill-aggregate-chapter-9-an-event-is-just-a-pure-fact.html>
- Sara Pellegrini — *A name for an idea: Dynamic Consistency Boundary* (2023-05-15) —
  <https://sara.event-thinking.io/2023/05/dynamic-consistency-boundary.html>

Library source (read at `main`, 2026-09-19):

- wwwision/dcb-example-courses — src/CommandHandler.php —
  <https://github.com/bwaidelich/dcb-example-courses/blob/main/src/CommandHandler.php>
- @dcb-es/event-store — examples/course-manager-cli/src/api/Api.ts and DecisionModels.ts —
  <https://github.com/kraken-tech/dcb-event-store> (redirects to PaulGrimshaw/dcb-event-store)
- gember/event-sourcing — README —
  <https://github.com/GemberPHP/event-sourcing>
- Axon Framework 5 — architecture principles —
  <https://docs.axoniq.io/axon-framework-reference/5.0/migration/understanding-architecture-principles/>
- Library index — <https://dcb.events/resources/libraries/>

Client-side derivation:

- Redux Style Guide — *Keep State Minimal and Derive Additional Values* —
  <https://redux.js.org/style-guide/#keep-state-minimal-and-derive-additional-values>
- Event Modeling — *What is Event Modeling?* —
  <https://eventmodeling.org/posts/what-is-event-modeling/>
- Greg Young, projection definition (2013), as republished on
  <https://dcb.events/topics/projections/> — original:
  <https://x.com/gregyoung/status/313358540821647360>
