# Acceptance: the DCB notation 11.0 against two migrations

Date: 2026-11-08
Scope: the acceptance step of [The DCB notation 11.0](2026-11-08-notation-11.md).
Copies of the two migrated models from the extensions handoff were checked
with the 11.0 CLI unchanged, then re-expressed with 11.0 features, and the
results counted against the handoff's list. The originals were not changed.
Counts only: no customer data, and the private models are paraphrased.

Tooling: `skills/dcb-notation/scripts/dcb.js` on `v11` at `0da0d6c`. The
re-expressed copies stay outside the repository.

## Summary

- **10.1 → 11.0 cost:** no model used a removed construct. Without the
  array defect below, the portal needs 10 fixes (4 events to mark
  `@deprecated`, 6 cast projections the strict `set` refuses), courses 2
  and `courses-simple` 1 (a `set` from a constrained integer type into
  `integer`). A defect in scenario value checking adds 20, 114 and 31
  problems, which is every model with a `type X = array`.
- **Portal:** unresolved 8 → 1. Workarounds removed: 2 role tag types, 6
  cast projections, the email event split (2 model-only events), 6 of 12
  backfilled fields, 2 revision projections with their 8 parameters and 8
  rejections, all 30 caller-supplied capability booleans, 9 no-op
  rejections, 15 split commands, and 4 model-only guard rules.
- **Courses:** unresolved 7 → 0. Both backfilled fields are gone, and
  `replay` against the 12,110 stored events finds nothing; before, it found
  2 missing-field kinds over 2,076 events. Also removed: 7 split or chained
  commands, all 4 duplicate parameter pairs (by tag backfill), and the
  running sum. All 3 "changed by decision" behaviours now match the code
  again.
- **Boundaries** change where expected. Conditional handlers widen
  role-specific reads to the shared tag type. Dropping the revision pattern
  narrows the contract commands. Merged branches show the union statically.
  The atomic booking makes `InitiateBooking` conflict with itself on
  seats, which closes the race the migration report described.
- **Defects found:** 3 in the CLI or evaluator, plus 3 minor
  inconsistencies and 4 language gaps. See _Defects and gaps_.
- **After the fixes** (see _After the fixes_): D1–D6 are fixed, and
  G1–G3 added; G4 is deferred. The portal checks with 0 problems and 0
  unresolved, after its last item was re-expressed with `list(…)`.
  Courses checks with 1 problem, which the D6 fix found in the copy.

## Customer portal

| | 10.1 model | 11.0 copy |
|---|---|---|
| Events | 71 | 69 |
| Commands | 80 | 68 (−15 merged, +3 previously unmodelled) |
| Projections | 66 | 66 (−11, +11) |
| Scenarios | 314 | 227 (about 90 rewritten as partial scenarios) |
| Lines | 3,148 | 2,474 |
| Tag types | 19 | 16 |
| `@unresolved` | 8 in the report, 0 marked | 1 (0 with `list(…)`, G1) |
| `@external` / `@assumption` / `@deprecated` | 0 / 0 / 0 | 14 / 6 / 4 |
| `check` problems on 11.0 | 30 (10 without the array defect) | 20, all from the array defect (0 with it patched, and after the fixes) |

Workarounds:

| Workaround | Before | After | How |
|---|---|---|---|
| Role tag types on share events | 2 types on 3 events | 0 | Both roles tagged `CustomerId`, which restores the stored `customer:` tag. Handlers pick the role with `if event.data.inviteeCustomerId == …` |
| Cast projections | 6 | 0 | 3 role casts are unnecessary. 3 value casts went with typed tags, among them the target-group tag backfill below |
| Email change split into 2 model-only events | 2 events, 1 event stripped of its 2 email tags | 0, stored tags kept | Conditional handlers on the old and new address |
| Fields added only to carry a stored tag or a kind | 12 field additions on 12 events | 6 | `emailAddress` (3 events) via the nested tag path `signUp: SignUp tag emailAddress`. `modificationKind` dropped from 3 of 4 events. `contractId`, `documentId` and `meterId` stay, because their source is an opaque payload |
| `modificationKind` tag | on 4 events | 0 | `count(PendingModificationKind(contractId, *) where value == kind) == 0` |
| Revision projections (`ContractRevision`, `InvoiceRevision`) | 2, with 8 parameters and 8 rejections | 0 | Capabilities are `@external`. The invoice list rule is now a real rule over a per-invoice open read |
| Caller-supplied booleans (capabilities, diffs, expiry) | 30 parameters on 18 commands | 0 | 14 `@external` notes. Data diffs became rules: `ContractData(contractId) != contract`, `ContractStateOf(…) != state` |
| No-op modelled as a rejection | 9 | 0 | `if … => emit`, `then nothing` |
| Commands split per outcome or role | 28 commands in 13 handlers | 13 | Branches, `or`, lazy reads, optional parameters |
| Model-only rules guarding a null-tag read | 4 | 0 | Lazy reads |
| Stored tags omitted | `invoice:` on `InvoicesWereUnassigned` | restored | `tag invoiceIds: AssignedInvoiceId[]` |
| Comments carrying meaning | `// model:`, `// legacy:`, `// unresolved:` | 0 | `///`, `@deprecated`, `@unresolved`, `@external`, `@assumption`, `@sensitive` |

New migration cost: the `target-group:` tag backfilled on 2 promotion
events, where the value is already stored. 11.0 forbids an untagged
identifier field and has no cast, and the alternative cast projection is
refused.

Unresolved items from section 4 of the migration report:

| # | Item | After |
|---|---|---|
| 1 | `deleteCustomer`: unassign contracts and invoices | Contracts resolved with `for each … IsContractAssignedToCustomer(customerId, *)`. Invoices were unresolved: `InvoicesWereUnassigned` holds the ids as a list, and no list could be built from an open read (gap G1). **Resolved after G1**: per contract, `invoiceIds: list(InvoiceAssigned(contractId, *))` |
| 2 | `deleteCustomer`: end shares, revoke invitations, both roles | Resolved: 4 loops over owner shares, invitee shares, issued invitations (with an `if` on status) and pending invitations to the address |
| 3 | `unassignCustomerContract`: end the contract's shares | Resolved, `for each` over `ShareActiveOnContract(contractId, *)` |
| 4 | `endAllContractSharesForContract` | Resolved, new command |
| 5 | `changeContractSharePermissionForRecipient` | Resolved, new command |
| 6 | `endContractSharingWithRecipient` | Resolved, new command |
| 7 | `setShareRecipientNickname`: "nothing shared with recipient" | Resolved without new tags. `PendingInvitationToEmail(email, *)` holds the owner, so `where value == actingCustomerId`, and `ShareActiveBetween(owner, invitee, *)` is a projection tagged by `CustomerId` twice |
| 8 | `markNotificationsAsRead` with several ids | Resolved, `for each` over the list parameter, skipping read ones |

Not resolved by 11.0, now documented as `@external`, by decision: token
expiry (3 commands), the contract match retry window and "newer finalized
request". All three depend on the recorded time, and 11.0 has no event
timestamp. `DateAndTime` became `datetime`, which fixes the cross-offset
string comparison on invitation expiry. Reading dates stay strings with a
pattern, since there is no date type (G4).

## Courses

| | 10.1 model | 11.0 copy |
|---|---|---|
| Events | 45 | 45 (1 `@deprecated`) |
| Commands | 47 | 40 |
| Projections | 20 (4 derived) | 19 (4 derived) |
| Scenarios | 146 | 123 (partial: `given` payloads shortened throughout) |
| Lines | 1,606 | 1,390 |
| Unresolved | 7 in the report, 0 marked | 0 |
| `@external` / `@assumption` | 0 / 0 | 7 / 1 |
| `check` problems on 11.0 | 116 (2 without the array defect) | 16, all from the array defect (0 with it patched); 1 after the fixes (D6) |

Shortening the payloads also cut the array defect's hits from 114 to 16,
because most scenarios no longer give the array-typed fields.

| Workaround | Before | After | How |
|---|---|---|---|
| Fields added for a running sum | `SeatReservationWasCancelled.numberOfSeatsReserved` (818 events), `SeatsWereMarkedBooked.numberOfSeatsReservationReleased` (1,258) | 0 | `Reservation(courseId, reservationId)` holds a record `{ seats, expiresAt }` that cancel and book set back to null. `sum(Reservation(courseId, *).seats where value.expiresAt > now)` |
| Running-sum projection | `CourseSeatsReserved` with 3 arithmetic handlers, plus `ReservationSeats` and `CourseSeatsAvailableWithReservation` | one record projection, `Reservation`, and a derived sum | as above |
| Duplicate parameter pairs | 4 pairs on 3 commands | 0 | Tag backfill: `CourseWasAdded.templateId` (380 events), `courseId` on 5 booking event types (2,862), `reservationId` on `BookingWasInitiated` (1,101 non-null), `bookingId` on both seat events (1,467). Every value is already stored, and `replay` shows all of them fit their types |
| Commands split per outcome | `InitiateBooking*`, `MarkSeatsBooked*`, `AddPayment*`, `Send`/`SkipBookingConfirmationEmail` | merged | Branches with an optional `reservationId`, and `if markAsPaid is true => emit …` |
| No-op modelled as a rejection | `CancelSeatReservation` on a non-pending reservation | 0 | `if Reservation(…) is not empty => emit …` |
| "Changed by decision" | 3 (expired reservations keep their seats, the no-op became a rejection, send/skip as a flag rule) | 0 | All 3 now behave as the code does |
| Type workaround | `NumberOfSeatsOrZero` so a per-reservation projection can hold 0 | unused by projections | record value, absent when null |

Unresolved items (all reactions):

| # | Reaction | After |
|---|---|---|
| 1 | `BookingWasInitiated` → `MarkSeatsBooked*` | One append in `InitiateBooking`: `BookingWasInitiated`, `SeatsWereMarkedBooked`, `BookingWasConfirmed` |
| 2 | `SeatsWereMarkedBooked` → `ConfirmBooking` | as 1 |
| 3 | `BookingWasConfirmed` → send or skip email | Outer layer: one branched command with `@external` |
| 4 | `BookingWasCancelled` → `MarkSeatsReleased` | One append in `CancelBooking`, which carries the "released ≤ booked" rule |
| 5 | Saga catch-all → `FailBooking` | Gone with the chain. `BookingHasFailed` is `@deprecated` (11 stored events) |
| 6 | Email failure → `FailBookingConfirmation` | Outer layer, `@external` |
| 7 | Cron: expired reservation → cancel | Expiry is data. An expired reservation stops counting at once, and the cron's cancel is an outer-layer call to an optional command |

Still `@external`, as in 10.1, but now recorded in the model: session overlap
(2 commands) and "no running or upcoming courses" (3). They need course end
times, which the stored events hold only inside an opaque sessions array.

One `@assumption` was added: a booking with an expired reservation is
rejected as not pending, because the code was not consulted on this.

### Replay

| Model | Findings | Exit |
|---|---|---|
| 10.1 copy | 2 kinds of required-but-missing field: 1,258 + 818 events | 1 |
| 11.0 copy | none, besides 2 model event types absent from the export (informational, same as before) | 0 |

The 11.0 copy also types `expirationDateTime` as `datetime`. All 1,940
stored values carry an offset, which an independent count confirmed. The
removed fields are therefore unnecessary, and the type change costs
nothing. `replay` does not check tags, so the tag backfills above are
counted from the payload fields only.

## Boundaries

`conflicts` was run on both versions of each model. The changes, per
re-expressed command:

| Change | Commands | Expected? |
|---|---|---|
| Role reads widen from `ShareInviteeId`/`ShareOwnerId` to `CustomerId` | share and installment commands, `EndContractShareForContract`, invites | Yes. A condition filters the fold, never the query |
| The pending-modification check widens from contract + kind to contract | `RequestContractBankingInformationModification`, `SetInvoiceDeliveryMethod`, `AddMeterReading` | Yes. A `where` over an open read has only the bound tags. All requests of one contract now conflict |
| `ContractStateWasChanged` and `ContractWasSynchronized` lines are gone | the 6 commands that compared a contract revision | Yes, by decision. The capability race between check and append is accepted |
| `InvoiceRevision` (contract-wide) replaced by per-invoice lines | `UnassignCustomerContract` | Yes, an ordinary rule now protects it |
| Merged commands show the union of their branches | `SetInstallment`, `AddMeterReading` (owner path shows invitee share lines) | Yes. Lazy reads narrow only the runtime append condition |
| Cascades add element lines | `DeleteCustomer` 2 → 19, `UnassignCustomerContract` 6 → 11, `SetShareRecipientNickname` 1 → 10 | Yes. The cascades and the new rule have to read what they end |
| Email: `EmailAddressWasReleased`/`Claimed` lines become `EmailAddressWasChanged` lines | sign-up, password reset, email change, invites | Same width |
| `InitiateBooking` now conflicts with itself, `CancelBooking` and the seat commands via `SeatsWereMarkedBooked [CourseId]` | courses | Yes. The atomic chain closes the race where two bookings both took the last seat |
| `CourseSeatsReserved`'s lines are unchanged: `[CourseId]` on the 3 seat events | `ReserveSeats`, `InitiateBooking` | Yes. Open-tag sums keep the running sum's boundary |

## The handoff's list

| # | Item | Status | Note |
|---|---|---|---|
| 1 | Conditional handlers | Fixed | Removes role tags, casts and the email split |
| 2 | Tag paths, plain-list tags, computed formats | Changed | Nested tag paths and plain-list tags work, and since G2 a handler can `set` from a nested path. Computed formats are replaced by `@sensitive` with a pattern, and the adapter hashes |
| 3 | Fan-out emits | Fixed | `for each` resolved 7 of the portal's 8 items, and `list(…)` (G1) the eighth |
| 4 | Guarded emits, optional reads, OR | Fixed (in another form) | Branches, `or` and lazy reads. Merging removed 15 portal and 7 courses commands |
| 5 | Keyed projections with aggregates | Fixed | Open tags, collection functions, `where` and record values |
| 6 | `ref` and tag conversions | Changed | No `ref`, by decision: tag backfill instead. Courses needs 5 tag backfills (about 6,200 events), all derivable. The portal needs 1 |
| 7 | Time | Changed | `datetime`, `duration` and `now` work, and expiry is data. Recorded-time rules stay outside, by decision (5 portal rules) |
| 8 | Boundary-only reads | Changed | None, by decision. The revision pattern is dropped, and capabilities are `@external` |
| 9 | Scenario fixtures | Changed | Partial scenarios instead. They cut scenario text by about a third, and no generator is needed. A nested record in `then` was compared whole (D5, fixed) |
| 10 | Stored notes, external rules | Fixed | `///`, `@unresolved` (counted), `@external`, `@assumption`, `@deprecated`, `@sensitive` |
| 11 | Reactions | Changed | No construct, by decision. Chains became one append, and handlers are outer-layer `@external` |

Verified behaviour (10.1 table, rerun on 11.0):

| Case | 11.0 |
|---|---|
| Read on a null tag | Unchanged: an error when reached. Lazy reads avoid reaching it |
| `alias b = Q(a)` with `a` null, after a guarding `require` | Fixed |
| `Q(a)` inline after a guard | Unchanged (works) |
| Projection on a tag type an event carries twice | Changed: allowed with a conditional handler |
| Two tag types with the same `@tagSchema` | Unchanged: accepted, and they match each other |
| `CustomerId` into a read tagged by another type | Unchanged: refused |
| `CustomerId` into a field of another type | Unchanged: refused |
| Handler `set` of another type | Changed: refused (strict) |
| Projection holding a record | Fixed: allowed when set whole |
| Event with no tags | Unchanged: reported |
| Record field of a tag type that is not a tag | Unchanged, but `field: R tag sub` now tags it |
| `[]` literal in `emit` | Unchanged: refused |
| Optional list property | Fixed |
| Object literals, `!=` on objects, `then A and B` | Unchanged (work) |
| Event nothing emits | Fixed: advised, unless `@deprecated` |
| Single-letter name | Unchanged: refused |
| `tag x?: T` | Unchanged (works) |
| `reservationId: null` into an optional tag | Unchanged: the boundary still prints `ReservationId:{null}` |
| Read result as an emitted tag | Unchanged (works) |
| Derived projection with a value type | Unchanged (works) |
| Literal `0` into a constrained integer | Changed: caught when a scenario's `then` holds it, and since D6 in a projection's initial value |
| Type constraints in scenario values | Fixed: enforced, arrays included since D1 |

## Defects and gaps

Defects, each with a generic repro:

**D1. A `type X = array` value is refused in scenarios.** Every array value
is reported as "no array", including `[]`, so the scenarios using one break
and the coverage check then fails. This causes 165 problems across the
three migrated models. `object` passes, and `replay` is not affected. The
cause is in `payloadValueProblems` (`model.js`): `typeof` is compared with
the schema type, and `typeof [] === 'object'`. `null` has the same mismatch.

```
type Items = array
tag type ThingId = string
event ThingAdded { tag id: ThingId, items: Items }
command AddThing(id: ThingId, items: Items) {
  emit ThingAdded { id, items }
  scenarios { scenario "ok" { when AddThing { id: "t1", items: [1] }  then ThingAdded { id: "t1", items: [1] } } }
}
```

`check` reports "gives items [1], which is no array".

**D2. An alias cannot read by another alias's record field.** Inline it
works.

```
record Address { city: City, zip: string }
projection AddressOf (tag userId: UserId): Address = null { on Moved => set event.data.address }
command Ship(userId: UserId) {
  alias address = AddressOf(userId)
  alias residents = Residents(address.city)      // broken
  require residents < 5 else reject "Crowded"    // Residents(address.city) inline works
  …
}
```

`check` reports `binding "residents" … "address" binds the projection
"AddressOf", which holds one value and no property "city"`, and the
scenario breaks.

**D3. An alias is not in scope in `where`.** The reference says `where`
reads "names in scope".

```
command Check(userId: UserId) {
  alias partner = Partner(userId)
  require count(Holder(userId, *) where value == partner) > 0 else reject "None"
  …
}
```

`check` reports `reads parameter "partner", which the command does not
declare`, and the scenario breaks with "given no value for partner". It
also advises that the alias is unused and that "the next edit to this
command will remove it", which would silently drop a read. The portal
needed an extra projection, tagged by both parties, to avoid this.

Minor inconsistencies:

- **D4.** The strict-`set` advisory for value types says "tag the event by
  an integer" (`CourseCapacity` in `courses-simple`, `CourseSeatsTotal`).
  The advice fits tag types only.
- **D5.** A partial `then` compares a nested record whole.
  `then E { signUp: { emailAddress: "a" } }` fails when the record also has
  `name`, although `then` "compares the fields it lists".
- **D6.** A projection's initial value is not held to its type's
  constraints (`: NumberOfSeats = 0` with `minimum: 1` is accepted), while
  scenario values are.

Language gaps that the migrations hit (no change proposed here):

- **G1.** No list can be built from an open read or a loop, and a list
  literal cannot hold a variable (`[invoiceId]`). This is the portal's
  last unresolved item.
- **G2.** A handler cannot `set` from a nested path
  (`event.data.signUp.emailAddress`), although the same path can be a tag.
  The workaround is a record projection read as `.emailAddress`.
- **G3.** `count(listParameter)` is a comparison form, not an operand, so
  `count(P(x, *)) == count(ids)` is refused. The workaround is a loop that
  rejects on a missing element, run in both directions.
- **G4.** There is no date type: a calendar date is a `string` with a
  pattern, compared as text.

## After the fixes

Run with `dcb.js` on `v11` after the defects were fixed and G1–G3
added. The copies were changed only to resolve the portal's last item.

| | Portal | Courses |
|---|---|---|
| `check` problems | 0 (was 20) | 1 (was 16) |
| `@unresolved` | 0 (was 1) | 0 |
| Scenarios holding | 227 of 227 (the cascade scenario now covers invoices) | 123 of 123 |

The one courses problem is new and real: D6 now advises that
`CourseSeatsTotal` starts at 0, below its type's minimum of 1. Fixing
it is a modelling choice (a type admitting 0, or a separate total
type), left to the model's owner.

| Item | Status | How |
|---|---|---|
| D1 | Fixed | One shared value check (`payloadValueProblems`) names a value's JSON type properly; `replay` uses it too, list elements and record fields included |
| D2 | Fixed | A binding's tags settle `address.city` as a record field, as steps do |
| D3 | Fixed | A `where` reads aliases already bound; the read counts as consulted, so pruning keeps it |
| D4 | Fixed | A value type's advice is to declare the event field as that type; a tag type's is still to tag the event |
| D5 | Fixed | A partial `then` compares a nested record by its listed fields; an opaque object and a list compare whole |
| D6 | Fixed | A projection's initial value is advised when its type's constraints refuse it |
| G1 | Added | `list(P(x, *))`, one open tag, instance order |
| G2 | Added | `set event.data.signUp.emailAddress`, one hop, nominal |
| G3 | Added | `count(xs)` as a value; `count(xs) == 3` keeps its stored form |
| G4 | Deferred | ISO dates compare correctly as text, and no rule needs date arithmetic yet |

The portal's last item now reads, per contract in `DeleteCustomer`'s
loop, `if count(InvoiceAssigned(contractId, *)) > 0 => emit
InvoicesWereUnassigned { …, invoiceIds: list(InvoiceAssigned(contractId,
*)) }`. Its boundary gains the per-contract invoice line, which the
cascade has to read anyway.

## Method

1. Ran `check` on unmodified copies with the 11.0 CLI, and again with D1
   patched in a scratch copy of the CLI, to separate the defect from real
   migration cost.
2. Re-expressed the copies, guided by the `// model:` and `// unresolved:`
   comments and the two migration reports. Rewrote every merged or changed
   command's scenarios as partial scenarios, and shortened the courses
   `given` payloads with a script.
3. `check` passes on both copies with D1 patched. The 11.0 CLI reports
   only D1's problems.
4. Ran `conflicts` and `replay` on both versions. History counts came from
   the courses log, as counts only.
