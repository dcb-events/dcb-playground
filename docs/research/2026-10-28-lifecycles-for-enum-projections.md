# Lifecycles for enum projections (and the rest)

Date: 2026-10-28
Scope: a Lifecycle tab on every enum-typed projection, which brings back
the drawing that went with entities (see
2026-10-28-groups-replace-entities.md) but without the designation. It
touches `app/shared.js` (`lifecycleOf`, `lifecycleMachine`) and
`app/index.html` (`projectionLifecycle`). There is no wire format or
language change.

This is a design decision reached in discussion, not a primary-source
investigation.

## The decision

- **A view, not a construct.** A lifecycle is worked out from the
  model: nothing is declared, there is no `lifecycle` keyword, no wire
  field and no schema bump. Every qualifying projection has one. That
  keeps out the second layer the groups decision removed. Because it
  is read-only and adds nothing to author, it is not experimental.
- **Which projections:** single-valued enum projections, top-level or
  in a group. Scripted ones are left out (their handlers are opaque
  code), and so are list-valued ones (they hold no single state).
  Derived ones cannot be enums. Booleans are left out for now (see
  _Deferred_).
- **Where:** a third tab in the projection detail, `Lifecycle`, shown
  only on qualifying projections. Definition stays the default. A
  section inside Definition was the first proposal; a tab won, because
  the machine answers a different question from what the projection
  is, the way Checks does. A Lifecycles overview of every machine is
  not built.
- **Drawn from the draft**, so an edit on Definition is on the machine
  the moment the tab is switched.

## How the machine is read

- **States** are the enum's members in declared order. The initial
  state comes first, and `null` (spelled `null`) comes first when the
  projection starts there or a handler sets it. `== null` is read as
  that state, and `!=` / `not in` include it, as evaluation does.
- **Transitions** are the handlers that `set` a member, each an arrow
  into it, labelled with its event.
- **Sources** are where the publishing commands may emit that event:
  their `require` conditions, intersected with that emission's own
  `when` guard. The projection is matched whether it is read directly
  (`{projection, tags}`) or through a group alias (`course.status`),
  whatever arguments the read passes. A machine is drawn per
  projection, not per argument. The old reader ignored `when`; this
  one does not.
- **Unguarded:** a command that moves the projection with no readable
  rule over it gets the pink dot. An arrow that has no readable source
  starts at the initial state, dashed, by convention. If it leads back
  to the initial state, it starts at every other state reached instead
  (`set false` after `set true`).
- **Said, not drawn:**
  - a handler whose state comes from event data (`Also set by X, to a
    state taken from event data.`);
  - a command whose rule compares the projection with a value only
    known at run time (`unreadable`);
  - a command that reads more than one instance of it, or reads it
    through `each` (`ambiguous`).

  While any of these is present, no state is called terminal, because
  the unread arrow may be the one that leaves it.
- **Never set:** a member that is neither the initial state nor any
  arrow's target is drawn greyed and dashed.
- **Not brought back:** the promote/merge offers for monotone booleans,
  the "course exists" wording, `+ lifecycle`, and the event model's
  ordering by lifecycle. All of them only made sense with a
  designation.

## Drawing

- **The mindmap of design/lifecycles/Main.dc.html where it fits:** state
  pills, curved arrows labelled with events, a badge counting the
  commands allowed in a state, and those commands behind the state.
- **A list where it does not:** the states down a spine, each followed
  by the arrows that leave it as rows (`↯ event → Target`). Both views
  are built, and a container query on the tab's width picks one. The
  detail is never wider than about 700px, so this is not only the
  phone layout: a five-state machine is a list on any screen.
  - A top-to-bottom version of the mindmap, with arcs on the right, was
    built first. It was dropped because a few transitions back and
    forth piled their labels onto each other.
  - No sideways scroll at 320px.
- **The popover** opens on hover, focus or a tap that pins it, and
  closes on Escape or a press anywhere else.
- **No navigation:** clicking an event or a command does nothing. They
  are kept free to become draggable later, and no layout is stored.
- **Agents:** WebMCP gets no lifecycle tool. Agents can read the
  handlers and rules the machine is worked out from.

## Extended the same day: every projection with handlers

- **Booleans are machines too:** `false`/`true` (and `null`), guarded by
  `is true`, `is false`, `== true/false`, negated or not, and drawn the
  same way as enums.
- **Everything else gets its movements, not a machine:** numbers,
  strings, ids, records, and lists (list-valued enums and booleans
  included).
  - It reads top to bottom: `starts at …`, then one block per handler,
    showing the event and its effect in the handler editor's tokens
    (`increment 1`, `append event.data.studentId`). Under each block
    come the commands appending that event, with their rules over the
    value as the command page's sentences.
  - A "Read by rules" block lists the commands that only read the value.
  - The view uses blocks, not columns, so a phone reads it the same way.
  - Inferred states ("empty / not empty", "0 / more") were rejected:
    they are buckets the model does not state.
  - Unguarded is not marked here, because a counter is ordinarily
    guarded through another projection (subscribing, by the capacity).
- **One tab, one name:** "Lifecycle" covers both shapes, since only one
  ever applies to a projection. The glossary entry was widened to match.
- **Still none for:** derived projections, which have no handlers of
  their own (their operands are one click away), and scripted ones,
  whose handlers are opaque code.

## Deferred

- **The Lifecycles overview**, and "unguarded command" as an advisory
  (the Grid board, design/lifecycles/Grid.dc.html, would be its natural
  home).
- **Dragging** events and commands on the machine.
- **The `group` anchor** in `NOTATION_ANCHORS`. The site's reference
  defines no `#group` yet, and its build fails on an anchor it does not
  define. `entity`, `lifecycle` and `read-entity` were dropped from the
  playground's list; the reference page still documents entities.
