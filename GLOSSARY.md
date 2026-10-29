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
