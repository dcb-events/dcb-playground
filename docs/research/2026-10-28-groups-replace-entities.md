# Groups replace entities

Date: 2026-10-28
Scope: removing `entity` (and with it `lifecycle` and `excluding`) and
adding `group`, a non-experimental way to give projections that share one
partition tag one name. Touches `dcb-model.schema.json` (a major wire
version), `app/dsl.js`, `app/model.js`, `app/evaluate.js`, the projections
list and the slice in `app/index.html` / `app/shared.js`, and
`app/webmcp.js`.

A design decision reached in discussion, not a primary-source
investigation. Not built yet.

## Why entities go

"Entity" kept being read as an aggregate: a thing that is loaded whole,
stored, and guards its own consistency. None of that was true. An entity
was a name over projections declared elsewhere, each already tagged by the
same identifier, and a command's Query held only the projections it used.
The word asked readers to unlearn exactly what DCB teaches. On top of that
the binding layer (an entity property pointing at a top-level projection)
made two names for one thing, `capacity` and `CourseCapacity`, and the
lifecycle designation added a concept only entities had.

The shipped models had already been restated without entities (8.0), so
the feature carried its weight only in experimental models.

## The decision

- **A group owns its projections.** They are declared inside it, carry no
  tag of their own and inherit the group's one partition tag. A projection
  is in at most one group. Referencing top-level projections, as entities
  did, was rejected: it is the second layer that made entities confusing.
- **A group means nothing for consistency.** Reading `course.capacity`
  puts only `capacity`'s events into the Query. It is a naming device, not
  a boundary.
- **One partition tag per group.** Projections tagged by several tags, and
  untagged ones, stay top-level. Composite keys wait for a model that needs
  them. Ungrouped projections stay first-class, and the examples on
  dcb.events need no groups.
- **`group`, not `projectionGroup`, `partition` or `view`.** It is short,
  reads well as `group Course (tag courseId: CourseId) { … }`, and carries
  no aggregate baggage. The header's tag is explicit, with no inferred
  default.
- **Inner names are local and lowercase.** Inside the group a projection is
  `capacity`. Outside it is `Course.capacity`, and it is read as
  `Course(courseId).capacity` or `alias course = Course(courseId)` followed
  by `course.capacity`. Group names share one namespace with top-level
  projections.
- **The casing rule, stated once:** a capitalised name is a declaration
  that can be named from anywhere (types, events, groups, top-level
  projections, enum members). A lowercase name is reached through something
  in scope (aliases, fields, tag and parameter names, members of a group
  instance). Capitalised inner names (`course.Capacity`) were rejected
  because bare sibling references in a derived projection would collide
  with enum members, and because `x.Y` appears nowhere else in the
  language. Their one advantage, no rename when moving a projection in or
  out, is covered by the move commands.
- **Inner projections keep every kind.** `projection`, `derived projection`
  and (experimental) `scripted projection` are allowed, spelled as at top
  level minus the tag header. A derived inner projection names its siblings
  bare (`capacity - subscriptionCount`), and the tag name is in scope for
  reads of top-level projections (`Other(courseId)`).
- **Arguments go on the projection, not on the group call:**
  `course.seatsOn(slot: s)`, not `Course(courseId, slot: s)`.
- **Fan-out stays, `excluding` goes:** `Course(each courseIds).capacity`.
- **The wire format nests:** a `group-definitions` entry holds its
  `projections`, which mirrors ownership. A `group` field on top-level
  projections was rejected because nothing in it would stop one projection
  from claiming two groups.
- **Empty groups are allowed**, with an advisory, so that an author can
  create one and then move projections in.
- **`lifecycle` is dropped**, along with the designation, the promote and
  merge offers, and the entity Identity row. A lifecycle is an ordinary
  boolean or enum projection that conditions already read. Drawing a lifecycle for every enum-typed projection was decided
  separately: docs/research/2026-10-28-lifecycles-for-enum-projections.md.
- **Entities are removed, not deprecated.** That means the DSL keyword, the
  schema's `entity-definitions`, the UI, and `course-entities` /
  `course-schedules`, under a major wire-format bump. On import, an entity
  becomes a group when every projection it binds is tagged by exactly its
  identifier and bound by no other entity. The local names are the entity's
  binding names, and direct reads elsewhere are rewritten to go through the
  group. Any other entity is restated as plain reads, the way
  `seedWithoutEntities` does.

## Around it

- **Display:** in the projections list a group is a section headed by its
  name, icon and one tag chip, **collapsed by default**. Its projections
  render as usual but without a tag chip. A group has no page of its own,
  and reads show as `course.capacity`.
- **Creating one in the visual mode:** `+ group` sits next to
  `+ projection` in the projections list header and asks for a name, a
  tag (an existing tag name and type, or a new one) and an optional icon.
  The new group is empty and shown expanded. Each group section has its
  own `+ projection`, which creates a projection inside it with no tag
  step. "Move into group" on a tagged projection also offers
  "New group…", with the tag prefilled and the name suggested from the
  tag type (`CourseId` → `Course`). A projection created inline from a
  command may go into an existing group, but a command never creates a
  group.
- **Refactoring:** "Move into group" is offered when a projection's only
  tag matches a group's. It drops the tag, renames the projection to a
  local name and rewrites its reads. "Move out of group" does the reverse.
  A command's reads move in through an alias of the group (`alias course
  = Course(courseId)` … `course.exists`) rather than as
  `Course(courseId).exists` in every rule, which read as repetition. The
  rewrite reuses an alias with the same tags and optionality, folds an
  alias of the projection itself into the group's, names a new one off
  its value (`courseId` → `course`), and is shared with the import of
  10.x entities. Derived projections and scenarios keep the read in
  place. (Added after the first build.)
- **Agents:** groups are not experimental, so WebMCP gets tools for them,
  built on the same command functions as the UI.
- **Deferred:** the notation guide and reference on dcb.events, which still
  document entities.
