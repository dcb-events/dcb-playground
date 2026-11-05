---
name: dcb-notation
description: Author DCB models in the DCB notation (`.dcb`), the text form of the DCB model JSON schema (`.dcb.json`). Use when writing or changing a model's events, projections, commands or scenarios, turning business rules into Dynamic Consistency Boundaries, converting a model between notation and JSON, or converting an existing Event Sourcing app to a DCB model.
---

# DCB notation

The notation is the authored form. The JSON document is its output: every construct is exactly one shape of the JSON, so write notation and generate JSON, even when JSON is what was asked for. An existing `.dcb.json` becomes editable with `print`.

`scripts/dcb.js` runs the playground's own code. Paths below are relative to this skill's folder; it needs only Node.

| Command | Does |
|---|---|
| `node scripts/dcb.js check <file> [--cover A,B]` | Lists every problem on stderr (exit 1), then each command's derived boundary on stdout |
| `node scripts/dcb.js print <file>` | The model as canonical notation |
| `node scripts/dcb.js json <file>` | The model as its JSON document; its `$schema` names the schema |
| `node scripts/dcb.js link <file>` | A link opening the model in the hosted playground |

`<file>` is `.dcb` or `.json`.

## Before the steps

- **Converting an Event Sourcing app?** Read [references/from-event-sourcing.md](references/from-event-sourcing.md) now. It replaces steps 2 and 7.
- **Changing an existing model?** `print` it and edit the whole text. If `check` reports it uses experimental constructs, stop and name them to the user: this skill does not support such a model, though `print` and `json` still work on it. The notation has no spelling for a document's `sandbox` session, so `print` warns and that session stays behind in the original. Generated JSON also has new scenario ids and the current minor version. Say both at hand-over.

## Steps

1. **Read [references/language.md](references/language.md) in full.** It is this skill's version of the language and wins over any web page.
2. **List the rules.** Write down every rule of the brief as "reject when …", each with its rejection message. A rule the brief leaves open is a question for the user; if nobody can answer, take the simplest reading and record it as an assumption. A validation the brief does not state, such as a non-empty title, is an assumption to record, not a rule to add. Ask too what an event does to related things (the bookings of a cancelled workshop), since nothing downstream will flag it. Done when every sentence of the brief maps to a rule, an event or an assumption.
3. **Write the model** to `<name>.dcb`, following _Modelling_.
4. **Write the scenarios from the brief**, inside each command: one that succeeds and one per rejection message, each stating its `then`. Conditions sharing a message get one per condition, and a projection whose handlers changed gets its own scenario. A scenario is a prediction, so write it before running anything; `check` prints what the model does, and that output is evidence to judge, not text to paste.
5. **Run `check` until it exits 0.** When a scenario fails, decide from the brief which side is wrong and fix that one. In an existing model, pass `--cover` with the commands whose rules or events you changed, so scenarios are owed for those only; the gaps it lists elsewhere go in the hand-over. Adding a required property to an event means adding it to every scenario that holds that event, which does not make those commands changed ones.
6. **Audit the boundary.** Scenarios run one command at a time, so they cannot catch a wrong boundary. For each rule, name the concurrent event that would break it, and find its type and tag in that command's boundary; a rule over arguments alone, or one that no event can undo, has no such event. For each boundary line, name the rule it serves; each read contributes its own line, so duplicate and overlapping lines are normal. In an existing model, audit the commands that read a changed projection. Done when every rule and every line is accounted for. A gap is a missing read or a missing tag on an event; an orphan line is a read to remove or a projection to split.
7. **Hand over** the `.dcb` file, the JSON or link if wanted, the assumptions from step 2, what the audit made you fix, and any surprising boundary (every booking conflicting because of a gapless number).

## Modelling

- **The boundary is derived.** A command's Query is what it reads, nothing more. So the model's consistency is decided by which projections exist, which events they handle, and how those events are tagged.
- **One fact, one projection.** `CourseStatus` and `CourseCapacity`, rather than one `CourseState`: a command reading a wide projection conflicts with every event it handles, including those its rules do not care about.
- **Tag events with every identifier they hold.** A projection sees only events carrying all of its tags, so an event needs the tags of every projection handling it, and `check` treats an untagged property of a tag type as a problem. `StudentSubscribedToCourse` carries both `courseId` and `studentId` because rules about courses and rules about students both read it. A tag matches by its type, so a projection's `tag title: CourseTitle` also sees an event's `tag newTitle: CourseTitle`.
- **Make a value that must be unique a tag.** A taken username is a fact about that username: `tag type Username`, an event tagged with it, and a boolean projection per username. Two registrations then conflict only when they claim the same name. A value that can be given up needs its own event: a handler applies to every tag of its event, so a rename emits `CourseRenamed` for the new title and `CourseTitleReleased` for the old one, and a command may emit both.
- **Number with an `untagged` projection only when a gapless sequence is the rule.** It reads every event of its types, so all its writers conflict with each other. An identifier the caller can supply needs no numbering. `successor` keeps padding and grows past it: `B-009` → `B-010`, `B-999` → `B-1000`.
- **State is a plain projection**: `boolean` for two states, an enum for more, read by the rules that depend on it. A handler can add a value as well as a constant: `increment event.data.seats`.
- **Declare a type for fractional values.** `integer`, `string` and `boolean` work bare, while `number` needs `type Amount = number`.
- **Order `require`s deliberately.** The first that fails is the rejection, so "Title is unchanged" goes before "Title is already taken".
- **State a format rule as a `require`.** A type's constraints (`pattern`, `minimum`) describe the value, and scenarios do not enforce them.
- **Name for the domain.** Events in the past tense (`CourseDefined`), commands in the imperative (`DefineCourse`). A rejection message is static, one line, sentence case, no full stop, and names the outcome the caller sees; conditions may share one.
