# DCB Playground

An in-browser tool for modelling event-sourced systems built on Dynamic
Consistency Boundaries: authors define events, projections and commands, and
see which consistency boundary each command derives.

## Language

**Projection**:
A fold over the events matching its tags (and arguments), yielding one value.
_Avoid_: read model, view

**Partition tag**:
The tag that selects which instance of a projection is read, e.g. `courseId`.
_Avoid_: partition key, identifier

**Group**:
A named set of projections that share one partition tag, which they inherit
from the group instead of declaring their own. Purely a naming device: it has
no consistency meaning, and reading one of its projections reads only that
projection.
_Avoid_: entity, aggregate, projection group

**Entity**:
Retired term. What it named is now a **Group**.

**Lifecycle**:
How a projection's value moves over time. Where its values are finite (an
enum, a boolean) it is a state machine: values as states, handlers as
transitions, the rules that read it as where each command may run.
Otherwise it is its movements: each handler, the commands appending its
event, and their rules over the value. A view of the projection, worked
out and never declared: there is no `lifecycle` keyword.
_Avoid_: status, state machine (as a declared thing)

**Fan-out emit**:
A command step, `for each x in source`, that runs once per element of an
open read, a list projection or a list parameter, emitting zero or more
events into the command's one append. What a cascade or a per-recipient
command is.
_Avoid_: reaction, saga, batch command

**Instance**:
One value of a projection, identified by a value for each of its tags
(`ReservationSeats(c1, r1)`). An instance at the projection's initial value is
absent.

**Open tag**:
A tag left unbound in a read (`ReservationSeats(courseId, *)`), so the read
returns every present instance that matches the bound tags.

**Collection function**:
A function that computes one value from the instances an open tag reads, such
as `sum` or `count`.
_Avoid_: aggregate, aggregate function, reduction

**Record value**:
A projection value with fields that every handler replaces as a whole. It is
still one fact.

**Composite state**:
A projection value whose parts different handlers update separately. It merges
independent facts, so the notation refuses it.
_Avoid_: record value

**Branch**:
One arm of an `if` / `else if` / `else` in a handler, a loop or a command.
Separate `if`s each run; an `else` chain runs its first match.
_Avoid_: guard, guarded emission

**Role**:
The field through which an event carries a tag type it carries more than once,
such as `from` and `to` of `MoneyTransferred`.

**Role tag type**:
A tag type that exists only to name one role of an identifier (`ShareInviteeId`
for a `CustomerId`), so that a query can select that role. Since 11.0 a
conditional handler tells roles apart, so one is needed only for a narrower
boundary; a value never converts from one type into another (no cast).

**now**:
The time a command acts at, an ordinary `datetime` parameter the layer around
the commands supplies. There is no clock and no event timestamp: time the
domain needs is event data.
_Avoid_: recorded at, event time, clock

**Duration**:
A length of time, `15m`, `24h`, `7d`, stored as ISO 8601 (`PT15M`). A day is
exactly 24 hours; there are no months.
_Avoid_: interval, period

**Aggregate**:
The consistency unit of a DDD or stream-based Event Sourcing app, as found in an
app being converted. Not a concept of the notation.
_Avoid_: using it for computations over many values (see Collection function)
