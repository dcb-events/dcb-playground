# Redesigning a model

This path produces a simpler model whose events may differ from the stored history: `<name>.dcb` and `<name>.decisions.md`. It replaces steps 2 and 7 of `SKILL.md`, and leaves the app's code untouched. The request itself is the licence to change events, so decide and document, and ask only when a choice cannot be undone by editing the model.

## Find the core

List every rule, then name the invariants that cost the business something when broken: overbooking, double payment. State the idea the model is built around in one sentence, such as "only a reservation takes seats".

Done when every rule is marked core or removable, each with a one-line reason.

## Gather usage

If an export of the stored events exists, count how each feature is used, as in _History_ in [from-event-sourcing.md](from-event-sourcing.md).

Done when every lifecycle step and variant you might cut has a count.

## Cut

Apply each move wherever it fits, and quote the evidence:

- **A chain of events that always runs together** becomes one event: the saga and its intermediate states go with it.
- **A reaction chain that fans out** becomes one command: deleting a customer emits `CustomerWasDeleted` and, `for each shareId in ShareActiveAsOwner(customerId, *)`, a `ContractShareEnded`. The cascade then commits with the decision. A command repeated per recipient or per id becomes one with `for each` over a list parameter, skipping with `if` rather than rejecting.
- **A state no rule reads** moves to a read model. Calculate it from what remains: paid from payments.
- **A lifecycle step that exists to reach another step** goes: look at what follows it in the history.
- **Events no rule tells apart** merge: name, email and phone become contact details.
- **Events split only to name a role** merge back: a projection's handler tells the sides of one event apart, `if event.data.owner == customerId => …`. Keep a role tag type only where a narrower boundary is worth it, since a condition never narrows the query.
- **A rare variant** folds into the common path when it can take that path: an optional reservation becomes a required one.
- **Commands split per case** merge into one with branches when they decide on the same reads: `if … => emit A { … }  else if … => emit B { … }  else => reject "…"`. A case that takes other parameters keeps them optional, read inside `if x is not empty => …`.
- **A running total kept beside per-item values** goes: read `sum(ReservationSeats(courseId, *))` over the per-item projection instead, and drop the fields events carried only to subtract from the total again.
- **A value fixed at the point of decision** is stored there, so later commands read less.
- **An event that changes a projection only sometimes**, such as a reassignment that leaves the status as it is, still conflicts with every command reading that projection. Where that matters, split the event.
- **An expiry job that flips state** goes when the state only gates a rule: store the end, `expiresAt: now + 15m`, and read `where value.expiresAt > now` with `now` a parameter. A job stays only where something must happen at that time, outside the model, calling a command.
- **Definitions no core rule reads** split out, along with their side effects: catalogue data, notes, emails.

Done when each remaining event is read by a rule or carries data the business must keep.

## Write and audit

Follow steps 3 to 6 of `SKILL.md`, with the remaining rules as the brief. A rule the redesign relies on but the old system lacked is added here, and it goes under _Worth reviewing_.

## Decisions document

1. **Comparison**: events, commands and scenarios before and after, if an earlier model exists
2. **The core idea**: the sentence from above and what follows from it
3. **Decisions**: each with why and its evidence
4. **Left out**: what, where it could go, and what changes as a result
5. **Rules**: each command and what rejects it
6. **Boundary audit**: for each rule, the concurrent event that would break it and what covers it
7. **Worth reviewing**: what each decision costs, with the numbers, most severe first
8. **Moving existing data**: old event to new, and whether it was run

Hand over the `.dcb` file and the document, and open with _Worth reviewing_ alongside the core idea. Say plainly that old events have not been replayed, if they have not.
