# `handler`, not `command`

2026-10-07. Background for the keyword change in `app/dsl.js`.

## Question

In the code view, `command DefineCourse(courseId: CourseId) { … }`
named a message, but the block went on to define what *decides* it:
the reads, the rules, the events appended. Everywhere else a command is
a message, as an event is. How should the text say that the block is
more than the payload?

## Tried first: two definitions

The branch `feature/command-handler-split` split the command in the
wire format (9.0): a `command` declared the payload alone, the way an
`event` does, and a separate `handle DefineCourse as command { … }`
held the decision. The symmetry with events was right. What was wrong
was the distance: a command and what decides it became two blocks, the
handler had to repeat the command's name and introduce a name for the
payload, and the pages, which edit a command whole, had to join the two
halves for almost everything they read. Variants that nested the
handler inside the command block, after heklang's and Weltenwanderer's
shapes, brought the two back together but kept the split's cost in the
format.

## Decision

Keep one block and one `CommandDefinition`, and change the word:

```
handler ChangeCourseCapacity(courseId: CourseId, newCapacity: integer) {
  alias capacity = CourseCapacity(courseId)
  require CourseStatus(courseId) == Existent
    else reject "Course does not exist"
  emit CourseCapacityChanged { courseId, newCapacity }
}
```

- The header still declares the payload, so bare names in the body are
  payload properties or aliases as before, and `emit E { courseId }`
  keeps its shorthand.
- `handler`, not `handle`: the declaration names a thing, like every
  other keyword (`event`, `projection`), and `handle X(` would read as
  a call. Not `commandHandler`: the language's one two-word keyword is
  written as two words (`untagged projection`), and camel case would be
  the only one of its kind.
- `decide` stays rejected for the reason the split gave: it brings in
  the Decider pattern, with an `evolve` and a state the handler owns.
- Scenarios still write `when DefineCourse { … }`: what they run is the
  command, which the handler's header declares.
- The printed section comment reads `// Command handlers`.
- `command` at the start of a declaration is an error that names the
  fix. Nothing is stored as text, so no model needs migrating; only a
  text pasted from before reads differently.

The wire format, the pages and the docs anchors (`command`, keyed by
definition kind) are unchanged. The notation guide on dcb.events still
spells the old keyword and has to follow.
