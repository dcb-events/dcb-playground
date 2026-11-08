---
name: dcb-notation
description: Author DCB models in the DCB notation (`.dcb`), the text form of the DCB model JSON schema (`.dcb.json`). Use when writing or changing a model's events, projections, commands or scenarios, turning business rules into Dynamic Consistency Boundaries, converting a model between notation and JSON, converting an existing Event Sourcing app to a DCB model, or redesigning a model to simplify it.
---

# DCB notation

The notation is the authored form. The JSON document is its output: every construct is exactly one shape of the JSON, so write notation and generate JSON, even when JSON is what was asked for. An existing `.dcb.json` becomes editable with `print`.

`scripts/dcb.js` runs the playground's own code. Paths below are relative to this skill's folder; it needs only Node.

| Command | Does |
|---|---|
| `node scripts/dcb.js check <file> [--cover A,B]` | Lists every problem on stderr (exit 1), then each command's derived boundary on stdout |
| `node scripts/dcb.js conflicts <file>` | For each command, which commands invalidate its decision, through which event and tags |
| `node scripts/dcb.js replay <file> <export> [--map Old=New,…] [--read Projection=value,…]` | Compares stored events (NDJSON) with the model: unknown types, missing or undeclared fields, values outside their type (exit 1). `--read` folds a projection over them; repeatable |
| `node scripts/dcb.js print <file>` | The model as canonical notation |
| `node scripts/dcb.js json <file>` | The model as its JSON document; its `$schema` names the schema |
| `node scripts/dcb.js link <file>` | A link opening the model in the hosted playground |

`<file>` is `.dcb` or `.json`.

## Before the steps

- **Converting an Event Sourcing app?** Read [references/from-event-sourcing.md](references/from-event-sourcing.md) now. It replaces steps 2 and 7.
- **Simplifying a model or an app, with its events free to change?** Read [references/redesign.md](references/redesign.md) now. It replaces steps 2 and 7.
- **Changing an existing model?** `print` it and edit the whole text. A JSON document that uses something the notation removed in 11.0 cannot be carried over whole: a scripted projection or `currentValue` refuses the file, and a command with a guarded emission or an optional read is left out, with a `converted on import` line saying so. Stop and name these to the user: write a guarded emission again as `if … => emit …`, and an optional read inside `if x is not empty => …`, since nothing converts them for you. The notation has no spelling for a document's `sandbox` session, so `print` warns and that session stays behind in the original. Generated JSON also has new scenario ids and the current minor version. Say both at hand-over.

## Steps

1. **Read [references/language.md](references/language.md) in full.** It is this skill's version of the language and wins over any web page.
2. **List the rules.** Write down every rule of the brief as "reject when …", each with its rejection message. A rule the brief leaves open is a question for the user; if nobody can answer, take the simplest reading and record it as an assumption. A validation the brief does not state, such as a non-empty title, is an assumption to record, not a rule to add. Ask too what an event does to related things (the bookings of a cancelled workshop), since nothing downstream will flag it: the answer is usually a `for each` in the command that causes it. Done when every sentence of the brief maps to a rule, an event or an assumption.
3. **Write the model** to `<name>.dcb`, following _Modelling_.
4. **Write the scenarios from the brief**, inside each command: one that succeeds and one per rejection message, each stating its `then`. Conditions sharing a message get one per condition, and a projection whose handlers changed gets its own scenario. A scenario is a prediction, so write it before running anything; `check` prints what the model does, and that output is evidence to judge, not text to paste.
5. **Run `check` until it exits 0.** When a scenario fails, decide from the brief which side is wrong and fix that one. In an existing model, pass `--cover` with the commands whose rules or events you changed, so scenarios are owed for those only; the gaps it lists elsewhere go in the hand-over. Adding a required property to an event means adding it to every scenario that holds that event, which does not make those commands changed ones.
6. **Audit the boundary.** Scenarios run one command at a time, so they cannot catch a wrong boundary. `conflicts` lists who can invalidate whom; check each pair against the rules. For each rule, name the concurrent event that would break it, and find its type and tag in that command's boundary; a rule over arguments alone, or one that no event can undo, has no such event. For each boundary line, name the rule it serves; each read contributes its own line, so duplicate and overlapping lines are normal. In an existing model, audit the commands that read a changed projection. Done when every rule and every line is accounted for. A gap is a missing read or a missing tag on an event; an orphan line is a read to remove or a projection to split.
7. **Hand over** the `.dcb` file, the JSON or link if wanted, the assumptions from step 2, what the audit made you fix, and any surprising boundary (every booking conflicting because of a gapless number).

## Modelling

- **The boundary is derived.** A command's Query is what it reads, nothing more. So the model's consistency is decided by which projections exist, which events they handle, and how those events are tagged.
- **One fact, one projection.** `CourseStatus` and `CourseCapacity`, rather than one `CourseState`: a command reading a wide projection conflicts with every event it handles, including those its rules do not care about.
- **Tag events with every identifier they hold.** A projection sees only events carrying all of its tags, so an event needs the tags of every projection handling it, and `check` treats an untagged property of a tag type as a problem. `StudentSubscribedToCourse` carries both `courseId` and `studentId` because rules about courses and rules about students both read it. A tag matches by its type, so a projection's `tag title: CourseTitle` also sees an event's `tag newTitle: CourseTitle`.
- **Make a value that must be unique a tag.** A taken username is a fact about that username: `tag type Username`, an event tagged with it, and a boolean projection per username. Two registrations then conflict only when they claim the same name. A value that can be given up is released by the event that gives it up. A handler applies to every tag of its event, so a rename tagged with both titles says which side it is on: `on CourseRenamed { if event.data.newTitle == title => set true  else if event.data.oldTitle == title => set false }`.
- **Number with an `untagged` projection only when a gapless sequence is the rule.** It reads every event of its types, so all its writers conflict with each other. An identifier the caller can supply needs no numbering. `successor` keeps padding and grows past it: `B-009` → `B-010`, `B-999` → `B-1000`.
- **State is a plain projection**: `boolean` for two states, an enum for more, read by the rules that depend on it. A handler can add a value as well as a constant: `increment event.data.seats`.
- **An event naming two of one identifier type needs a conditional handler.** A transfer tagged `from` and `to` reaches both balances, so `on MoneyTransferred { if event.data.from == accountId => decrement event.data.amount  if event.data.to == accountId => increment event.data.amount }`. Separate `if`s all apply, an `else` chain its first match. A condition reads only the event and the projection's tags, and never narrows the boundary: reading one balance still conflicts with every transfer naming that account.
- **A total over many instances is a collection function, not a counter.** Keep the value per instance, `projection ReservationSeats (tag courseId: CourseId, tag reservationId: ReservationId): Seats = 0`, and read `sum(ReservationSeats(courseId, *))`: `*` leaves a tag open, and the read collects every instance not at its initial value, so setting it back to 0 removes one. A running total would need every cancellation to carry the amount it subtracts. `count`, `min`, `max`, `average`, `any` and `all` work the same way, each with an optional `where value …`. The boundary is the bound tags alone, so reading the course's total conflicts with every reservation of that course.
- **A cascade is one command with `for each`.** What one decision does to many related things happens in the same append: `for each shareId in ShareActiveAsOwner(customerId, *) => emit ContractShareEnded { shareId, contractId: ShareContract(shareId), reason: "ownerAccountDeleted" }`. The notation has no reactions, so a follow-up command per element would leave the cascade to a layer outside the model, and a command per element would reject where the domain skips. A loop runs over an open read, a list projection or a list parameter; skip an element with `if`, and a `reject` inside refuses the whole command. Each read by the element adds a boundary line per element, so the loop conflicts with every element it touched. A command acting for many recipients at once, such as marking a list of notifications read, is the same `for each` over its list parameter.
- **A projection may hold a record when every handler replaces it whole**: `set event.data.address`, or `set { street: event.data.street, city: event.data.city }`. A read takes one field, `CustomerAddress(customerId).city`. Facts that change separately are separate projections, since a record set field by field is refused.
- **Declare a type for fractional values.** `integer`, `string` and `boolean` work bare, while `number` needs `type Amount = number`.
- **Order `require`s deliberately.** The first that fails is the rejection, so "Title is unchanged" goes before "Title is already taken".
- **State a format rule as a `require`.** A type's constraints (`pattern`, `minimum`) describe the value, and scenarios do not enforce them.
- **Name for the domain.** Events in the past tense (`CourseDefined`), commands in the imperative (`DefineCourse`). A rejection message is static, one line, sentence case, no full stop, and names the outcome the caller sees; conditions may share one.
