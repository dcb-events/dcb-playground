# Content based decisions — five spellings, compared

Date: 2026-09-19
Scope: the five shipped "Content based decisions" predefined models and the
two wire-format-6.0 building blocks (guarded emissions, derived projections)
implemented to make two of them expressible. Companion to
`2026-09-19-content-based-decision-alternatives.md`, which holds the
primary-source grounding cited here; this note holds the comparison and the
recommendation.

## The problem, restated once

A document's Published/PendingChanges distinction depends on whether its
current text equals the last-published text — a decision made from *content*,
not from any recorded status. Re-typing the published text must count as
Published again. The declared handler vocabulary cannot compare two values,
so the original model scripted the status projection. The owner's criterion
for judging alternatives, stated during design: **implement the logic once,
in a form a real application's frontend could reuse.**

## The five variants

| | scripted (baseline) | boundary comparison | client-verified | guarded emissions | derived projection |
|---|---|---|---|---|---|
| slug | `content-decisions-scripted` | `content-decisions-boundary` | `content-decisions-verified` | `content-decisions-guarded` | `content-decisions-derived` |
| seed | `seedContentDecisionsScripted` | `seedDocumentAuthoring` | `…Authoring` + `seedVerifiedPublish` | `seedGuardedAuthoring` | `…Authoring` + `seedDerivedPending` |
| the comparison lives in | script code, hidden two-text state | `PublishDocument`'s conditions | the caller, verified by a condition | `UpdateText`'s emission guards | one `derived` declaration |
| stated how many times | once, as code | once, as a guard — but unreadable elsewhere | once per verifying command | once, at write time | once, as data |
| stored status | 5-state | 4-state lifecycle | 4-state lifecycle | 5-state, fully declarative | 4-state + derived boolean |
| the log says a revert happened | no — and `DocumentPublished` carries no text, so the log cannot even *reconstruct* the comparison | no (but reconstructable) | no (but reconstructable) | **yes** — `TextRevertedToPublished` is a recorded fact | no (but derivable at any point) |
| frontend reuse | eval the script (unsafe, opaque) | re-implement the comparison | re-implement (must compute what to echo anyway) | fold plain declared handlers — pure data | interpret the same `derived` declaration — pure data |
| new vocabulary needed | none (script is the escape hatch) | none | none | `when` on emissions (6.0) | `derived` on projections (6.0) |
| canon / primary-source standing | scripts are this playground's own device | most-precedented: content comparisons in conditions are pervasive on dcb.events | **canon-blessed verbatim** (dynamic-product-price's `displayedPrice`) | absent from the DCB canon; strongly precedented by the decider pattern (Chassaing) | novel; composition is precedented, the handler-less predicate is not — Redux would call it a *selector* |
| import gate | trips it | clean | clean | clean | clean |

Every variant ships scenario sets whose Thens were derived by actually
running them (`app/examples/*.json`), held current by `ui.test.js`, and every
seed is held advisory-clean by `evaluate.test.js`.

## What each one teaches

**Scripted (baseline).** The comparison is stated once — but as code nothing
parses, checks, or rewrites, holding state nobody else can read. Its deepest
defect surfaced only under comparison: `DocumentPublished` carries no text,
so the published text exists *only* inside the script's private fold. The
log is not self-contained; every alternative fixes that first, by making the
published text a fact of the publication event.

**Boundary comparison.** The honest minimum. Two plain `set` projections,
initial values doing real work (`""` after add vs `null` never-published
makes a fresh draft publishable without ever spelling null), and the guard
`not(currentText == publishedText)` on publish. Zero new vocabulary. Its
failure against the criterion: "is there anything pending?" is not a value
anywhere — a frontend, an entity page, or a second command each re-derive it.
The 5-state status is simply gone; Published means *has been published*.

**Client-verified.** The same base with the `OrderProducts` philosophy:
`PublishDocument(docId, text)` proves the caller published what it saw. This
is the one spelling with verbatim canon precedent. It reframes rather than
answers the reuse question: the client owns a copy of the value by
construction, so "define once" is traded for an explicit optimistic check —
a stale echo becomes a domain rejection, which is a feature in itself.

**Guarded emissions.** The decider pattern's shape: state and command in,
one of several event types out. The comparison runs once, at write time, and
the *log carries its outcome* — `TextRevertedToPublished` is the only
spelling in the family where the revert is a recorded fact rather than a
re-derivation. Downstream everything is plain declared handlers again: the
5-state status folds one `set` per event type, which is exactly the fold a
frontend can interpret as data. Guards read the boundary like conditions do
(the derived DCB shows `publishedText` in `UpdateText`'s query), and a
failing guard skips, never rejects. The cost: the decision is frozen into
the event vocabulary — a distinction you did not think to record at write
time cannot be guarded into existence retroactively (though here the events
carry the texts, so history stays reconstructable).

**Derived projection.** The owner's criterion, satisfied most literally:
`hasPendingChanges = not(DocumentCurrentText == DocumentPublishedText)`, one
JSON declaration, bound as an entity property, read by the publish guard as
`document.hasPendingChanges isTrue`, and interpretable by any read side that
can already interpret the declared folds. Its query is its operands' union,
so binding it guards the append exactly as reading both texts would. The
cost: it is the genuinely novel block — no primary source has a handler-less
predicate projection — and the naming caution from the research note stands:
under the canon's own fold definition it is not a projection but a
*selector*. It also deliberately stops at one boolean: the 5-state status is
still assembled by the reader (4-state lifecycle + the boolean), because a
case-expression vocabulary was judged not yet earned.

## Against the criterion: logic once, frontend-reusable

Only two variants pass both halves, and they pass differently:

- **Guarded emissions** put the logic in one place *upstream* and hand the
  frontend a log so expressive that the remaining fold is trivial data.
- **Derived projections** put the logic in one place *as data* and hand the
  frontend the derivation itself.

The two are complementary, not competing: B1 is for distinctions that are
*facts worth recording* (a revert happened), B4 for distinctions that are
*views* (is anything pending right now?) and would be noise as events. The
boundary-comparison variant remains the right teaching baseline for "you
need no new vocabulary at all", and client-verified stays as the canon's own
answer where the caller naturally holds the value.

## What the blocks cost — the ledger for a later elimination

Both blocks together were one wire-format major (5.0 → 6.0: schema `$id`
moved to `/v6.json`, `READABLE_MAJORS` gained 6, `EVENT_LOG_KEY` bumped to
v18) plus:

- **Guarded emissions**: `when` on `EventEmission`; evaluation is one loop
  reusing `evCheckCondition`; validation, rename rewrites, DCB derivation
  and the operand walker all reuse the existing condition machinery
  (`allConditions` in `validateCommandBody`, a second loop in
  `forEachCommandOperand`); the editor is the existing rule editor pointed
  at a different list. Marginal surface: small. Deliberately *not* added: a
  "guards may all fail" advisory — complementary guards are the normal
  pattern and publishing nothing is a legitimate outcome.
- **Derived projections**: a third projection kind touching `foldProjection`
  (with a cycle guard), `projectionQueryTags`, DCB derivation
  (`projectionHandledTypes` / `projectionReadTags`), validation
  (`validateDerived`), reference slots, two member-rename rewrites, and its
  own editor mode. Marginal surface: the larger of the two by a factor of
  three or so. Deliberately not added: case expressions, `equalsAny`,
  unary predicates, derived-of-derived beyond what cycle detection allows.

Both are pinned by dedicated tests (`evaluate.test.js` sections "Guarded
emissions (6.0)" and "Derived projections (6.0)", plus draft round-trips and
render smokes in `ui.test.js`), so eliminating either later is a revert with
a red test suite naming everything it breaks.

## Recommendation

Keep both blocks. Guarded emissions have the stronger external footing
(decider precedent, and they make the log say more); derived projections are
the block the stated criterion actually asks for, and the one that removes
the last structural excuse for scripting this family. If pressure ever
forces a choice, derived projections are the more speculative half — novel,
larger surface, and re-expressible (less elegantly) as guarded emissions
recording the distinction — but nothing today argues for dropping either.

Grow a case-expression vocabulary for derived projections only if a real
model demonstrates that composing "lifecycle + boolean" in the reader is a
recurring burden; the research note records that no primary source ships
anything like it, so it would be a second novelty on top of the first.
