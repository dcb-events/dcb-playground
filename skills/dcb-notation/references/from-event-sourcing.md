# Converting an Event Sourcing app

This path turns the app's code into a checked model and a migration report, `<model>.migration.md` beside the `.dcb` file. It replaces steps 2 and 7 of `SKILL.md`, and leaves the app's code untouched.

The stored events are history, so the model describes them as they are. **Every change to an event, field or tag is the user's decision**: propose it, and apply it only on a yes. That includes names the Modelling section would write differently.

## Inventory

List from the code, each with where it was found:

- every stored event type, with its fields, its stream, and any tags or metadata it is written with
- every command handler, and the aggregate or decider it runs against
- every place a decision is enforced outside the aggregate: unique database indexes, reservation tables, sagas and process managers, checks against read models
- every rule that reads another aggregate's state, with the identifier it reads by

Done when every event type and handler in the code appears in the list.

## Invariants

Every guard becomes one entry: a thrown error, a rejected result, a validation, an index, a compensating step. For each, read what actually protects it today, then classify it:

- **Rule**: a business rule, which becomes a `require`. A rule protected only eventually or only by a read model is still a rule, on the command that enforces it today; say so in the report.
- **Accidental**: a side effect of the aggregate's shape. The stream's version check makes every command on an aggregate conflict with all the others, whether or not any rule needs it. Record what stops being serialized, and which commands that frees.
- **Question**: the code does not settle it. A disabled guard, a catch that swallows a failure and a comment contradicting the code all belong here.

A step doing two things gets one entry for each: a saga's check is a rule, and its catch-all a question. The notation has no way to react to an event. A step that only fans one decision out to related things, such as a process manager ending every share of a deleted customer, becomes a `for each` in the command that triggers it; say in the report that the cascade now commits with that decision instead of after it. Any other compensating step is unresolved, on the command it would run.

Then look for what is missing, since no guard marks it: a handler that checks nothing where a rule seems expected, and what an event should do to related things (the seats of a cancelled order). Each is a question.

Done when every guard has exactly one classification.

## History

If an export of the stored events exists, it is the best evidence available. It holds customer data, so report counts and leave values out.

- **Schema:** run `node scripts/dcb.js replay <model> <export>` once a model exists. It lists fields the model and the history disagree on, such as a field old events lack because the code gives it a default.
- **Backfills:** for each field you would add, walk the history and count the events whose value can be derived and those it cannot.
- **Usage:** count what follows each lifecycle step and how often each variant occurs. These counts settle questions and support the suggested redesigns.

Done when every proposed field has its count, and every question the history can answer quotes one.

## Mapping

- **Events**: names and fields unchanged.
- **Commands**: one per handler. Merging handlers, such as making a saga's two steps one strict command, is a proposal: it goes under _Asking_ and in the suggested redesigns. A handler looping over identifiers it was given, such as marking a list of notifications read, stays one command with `for each` over its list parameter; one that rejects the whole batch over a single element the code would skip is a question.
- **Existing tags**: keep them. `@tagSchema` carries a prefix and a value, and `{type}` in it renders the type's name, so a stored `concert=c1` on a `ConcertId` is `@tagSchema("concert={value}")`.
- **A stream key**: the natural tag, when the event holds it as a field.
- **An identifier with no stored tag**: stays a plain `string`, since `check` requires a tag type to be tagged. Tagging it is a proposal, listed under migration cost.
- **An identifier a command reads by and also stores**: the Inventory's cross-aggregate rules are these. A read needs the tag type and a plain `string` field cannot take it, so tagging the event is the clean answer. Each is a question in the first round. Without a yes, the command takes two parameters with the same value, `course: CourseId` to read and `courseId: string` to emit, and the report lists them.
- **Field types**: the closest match to the code, `integer` only where the code guarantees whole numbers. Any narrowing is listed under migration cost.
- **An event naming two identifiers of one type**, such as a transfer's sender and receiver, or a share's owner and invitee: keep it as stored and tag it with both. The projection's handler says which side it is on, `on MoneyTransferred { if event.data.from == accountId => decrement event.data.amount  if event.data.to == accountId => increment event.data.amount }`, so no role tag types or split events are needed. Adding a role tag type is a proposal, only for a narrower boundary.
- **Aggregate state**: one projection per fact a rule reads. Fields no rule reads stay out. A value the aggregate keeps per item, such as seats per reservation, is a projection tagged by both identifiers, and a rule reads its total as `sum(ReservationSeats(courseId, *))`. A field the code added to an event only so a running total can be subtracted again is then not needed, and neither is its backfill. A composite the aggregate sets field by field becomes one projection per fact; one replaced whole may stay a record.
- **Names**: say what the fact means in the domain, `CourseTemplateKnown` for an id that stays taken after removal. The model has events, tags and projections, so the old implementation's aggregates, streams and sagas appear only in the report.

The notation requires a tag to be a property of its event. So a tag or stream key that lives only in metadata, or a tag format `@tagSchema` cannot carry, cannot be modelled faithfully. Each is a question, offered with its choices, such as adding the property.

An event may hold other identifiers but not its stream key: keep the event, and mark the rules needing that key unresolved. A stored event holding no identifier at all cannot pass `check`, which refuses an event without tags: leave it and its handlers out of the model, and mark what depends on them unresolved.

## Asking

Finish the analysis first, then ask everything in one round before writing the model: the questions above, each tag to add, each field to add, each classification left open.

Write each question so someone who has not read the code can answer it:

- **The situation**, with concrete values from this app: "a customer holds 2 seats while staff book 1".
- **What each choice does** in that example. For a field or tag to add, show the value it holds in each case.
- **Your recommendation**, with its reason.

Trace a claim about why a change is needed through the code or the history before you make it.

If nobody can answer, change nothing. Model what stays faithful, leave the rest out, and mark **unresolved** each rule that depends on it and each question about a rule, including the missing ones. A question no rule hangs on stays open without counting. A conversion with anything unresolved is incomplete, whatever `check` says, and the hand-over says so first.

## Steps 3 to 6, then the report

Continue with steps 3 to 6 of `SKILL.md`, with the rules above as the brief. Then write the report:

1. **Status**: complete, or incomplete with the count of unresolved entries
2. **Inventory**: the list from above
3. **Invariants**: every entry, as the rule it became, dropped with its reason, or unresolved
4. **Open questions**: each with its choices
5. **Boundary**: for each rule, the concurrent event that would break it and its boundary line, from step 6, plus any surprising conflict
6. **What gets stricter, what gets looser**: rules whose protection changes, and commands no longer serialized against each other
7. **Migration cost**: each tag and field existing events need added or backfilled, and whether the value can be derived from history
8. **Suggested redesigns**: events worth renaming, merging or splitting, and commands worth merging, none of them applied

Done when every invariant from the classification appears in section 3. Hand over the `.dcb` file, the report, and the JSON or link if wanted.
