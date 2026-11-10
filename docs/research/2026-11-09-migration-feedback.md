# Migration feedback on the DCB notation 11.0

Date: 2026-11-09
Scope: the proposals from re-migrating a PHP app with the `dcb-notation`
skill on `v11`, each with its decision. Builds on
[The DCB notation 11.0](2026-11-08-notation-11.md) and its standing
principles.

A set of design decisions reached in discussion, not a primary-source
investigation. The app is paraphrased: no names, privileges or values
from it appear here.

## Summary

- **Accepted:** unspecified values pass through a plain copy (3),
  optional record fields and a record built in an emission (5), and a
  check output a boundary audit can read (8).
- **Reshaped:** the 10 → 11 upgrade path becomes clearer messages (1),
  and check summarises a cause many broken scenarios share (10).
- **Rejected,** with a guidance line at most: named scenario values
  (2), check-only commands (4), notes on feature groups (6), a marker
  for layer-supplied values (7) and model comparison tooling (9).
- **Considered, not proposed:** conflicts from no-op transitions (N13)
  and string or date functions (N14).

## Decisions

| # | Proposal | Decision | Reason |
|---|---|---|---|
| 1 | An upgrade path from 10.x: a version on the model line, `dcb.js upgrade`, auto-fixes | Reshaped: a broken-scenario value names its type and says it is new in 11.0; `check` counts a shared cause (with 10) | A one-time cost of 11.0 holding scenario values to their types, not a recurring one; a model-line version waits for the first same-syntax, different-meaning change |
| 2 | Named values (`const`) for scenario identifiers | Rejected; one line in `from-event-sourcing.md`: one scheme for fixed-format identifiers, varying only the last digits, the same value per role | Shortens scenarios without changing what they mean, which fails the greenfield bar; identifier types keep their uuid constraints |
| 3 | A parameter a scenario leaves out, passed into an event | Accepted: a plain copy (a parameter, a loop's name, a record field of one) into a property that is no tag keeps it unspecified; a Then listing it is an error naming it; a recorded Then leaves it out | Computing, comparing, tagging, looping over or branching on it still reads it, so a scenario still says what its outcome depends on |
| 4 | Commands that only check, appending nothing | Rejected; the refusal says why ("a command without an event is a query, outside the model"); one line in `from-event-sourcing.md` | No append means no boundary and no conflict to model; a read-only endpoint is a query, and one the app audits is a command emitting that event |
| 5 | Optional record fields, and record literals in commands | Accepted both: `field?: T`, an absent one null; `set { … }` names every required field; `{ … }` in an emission field, each field any emission value, reads joining the boundary, one level, emission fields only; scenarios give records whole but for optional fields | Both remove workarounds a greenfield model would also need; an optional tag field stays refused, since it would shift a zipped binding's index |
| 6 | Notes shared by a feature group | Rejected | The repeated note spans several features, so folding it would split features by authorisation; named notes fail as 2 does; per-command repetition is honest, and the real issue goes to 7 |
| 7 | A `context` marker for values the layer supplies, `authorize … else deny`, event metadata | Rejected; one line in `from-event-sourcing.md`: the acting user is an ordinary parameter, and a privilege that depends on in-boundary state and must not race is one command per scope | Every parameter comes from the layer already; the layer maps messages to API statuses; a privilege race is accepted as `@external`, as for any external decision; no metadata, as for timestamps |
| 8 | A boundary output an audit can read | Accepted, reshaped: `check` prints one line per read, labelled with its projection (qualified for a group's) and what reads it (`← "message"`, `← emit`, `nothing`); no `--rule` flag | Merging a group's members into one line was a code artifact and contradicted the skill's audit step; the derived query and the playground's view are unchanged |
| 9 | `dcb.js diff` to compare two models | Rejected; the `print` row in `SKILL.md` says to diff two prints | Real but rare, mostly around majors; a text diff of canonical prints, or of two `check`s, already answers it |
| 10 | Check output: `--quiet`, a "not supported" list, grouped causes | Mostly rejected: one summary line per repeated broken-scenario cause; the tour shows `tag f` on a record-typed property (N5); "A lowercase name has at least two characters" (N6) | stderr and stdout already split problems from the boundary; a list of what is unsupported goes stale |
| N13 | Conflicts from an event that changes a projection only sometimes | Not proposed; one line in `redesign.md`: split such an event where the conflict matters | A reassignment leaving the status as it is still conflicts with every reader; tooling cannot know which changes matter |
| N14 | String and date functions | Not proposed | The layer normalises and formats, and time is data (11.0 standing decisions) |

## Implementation

On `v11`, schema revision `11.0.16`:

- **1, 10:** `evScenarioPayload` (evaluate.js) names the refusing type
  (`payloadValueProblems` returns it); `check` groups broken causes
  (`brokenCause`, dcb.js).
- **3:** `evCopiesUnspecified` and `evThenListsUnspecified`
  (evaluate.js); a tag is never unspecified, so a copy into a tag still
  reads.
- **5:** `isOptional` on `CompositeFieldDefinition`; a record built in
  an emission is `EmissionRecordValue`, the shape a handler's
  `RecordValue` has, its fields `CommandOperand`s rather than a
  handler's operands. The command page builds one with a picker per
  field; a field holding a literal or a read in place is edited in the
  code view.
- **8:** `boundaryReads` (model.js). A branch arm's condition is
  listed under its own arm's refusal (or `if`) and every later arm's,
  since an `else => reject` refuses on what came before.
