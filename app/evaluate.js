// ============================================================
// DCB Playground – evaluation layer.
//
// `model.js` says what a definition *means*; this says what it *does*.
// Given a model, a log of events and a command with its arguments,
// it runs the command's steps top-down (11.0) – its rules, its
// branches, its emissions – folding each read the first time a step
// reached needs it, and returns either the events the command
// publishes or the step that refused it.
//
// Nothing here touches the DOM, `localStorage` or the event log the
// playground stores its own history in. It takes a model object and
// a list of events and returns a value – which is what makes it usable
// from a scenario, from the sandbox, and eventually from a worker,
// without any of them knowing about the others.
//
// **A log or a read port.** Where a log goes in, a function may go in
// instead: `read(items) → events`, `items` one DCB query – a list of
// `{ types, tags }`, ORed – answered with the matching events in order.
// The playground passes its log; a runtime over a real event store
// passes the port. A command asks it once per round of reads, its
// folds' items merged (`evDecideThroughPort`), and returns the `query`
// it decided on – what the runtime's append condition has to cover.
// The port is synchronous, as everything here is; an asynchronous
// store is the caller's to block on.
// Around it, the cycle against a whole DCB event store – head, reads,
// the append and its condition – is `handleCommand` and
// `projectFromStore`, one attempt each (_Through a store_, below).
//
// **Closures, not generated code.** Every handler compiles to a small
// JavaScript function `(state, event, tags) => state`, one per handler
// per projection, built by walking the declarative operand tree and
// closing over it – a branched one (11.0) over its chains, its
// conditions reading the event and the values the read gave the
// projection's tags, nothing else. What this deliberately avoids is emitting source: a
// generated fold would be a third copy of semantics that `deriveDcb`
// and validation already hold, and the only copy of the three you
// could not read, grep or breakpoint. No authored code runs here at
// all: 11.0 removed scripted projections, and with them every reason
// to sandbox, gate or switch off a fold.
//
// **Groups are invisible here.** A grouped projection is folded by its
// qualified name, `Course.capacity`, as the body `projectionsOf`
// (model.js) flattens it to – tagged by its group's tag, its sibling
// reads spelled from outside – so the fold, the derivation and the
// query below never ask whether a projection is grouped. What a group
// adds is only a way of *reading*: a group binding names an instance
// (or, `each`, many) by the group's tag, and each member a rule reads,
// `course.capacity`, is folded on first use as the read it stands for.
//
// **An open read is folded per instance** (11.0). `sum(P(c1, *))`
// asks for P's handled types by the bound tags alone – on a store, the
// same one item the derivation shows – and groups what comes back by
// the open tags' values, folding each instance once and keeping those
// not at the initial value (`evOpenRead`). A command folds one open
// read once per spelling, like any read in place.
//
// **A loop runs its steps once per element** (11.0, `for each`): of
// an open read – one per present instance, in the order of each one's
// first event – a list projection or a list parameter. Each element is
// in scope by the loop's names, as a parameter is, and an instance's
// value as `value`; a read that names an element is made once per
// element (`evInlineKey`), so the append condition holds the reads
// each element made. A `reject` reached inside refuses the whole
// command, as anywhere.
//
// **Failure has two kinds and they are not the same.** A command whose
// conditions do not hold is *rejected* – an ordinary, expected outcome
// this returns. A scenario that cannot be run at all – an event that no
// longer exists, an argument the command never got, a value of the
// wrong shape – is *broken*, and comes back as an `EvaluationError`. Real bugs in
// this file are neither: they propagate as ordinary exceptions, so a
// mistake here can never be mistaken for a modelling mistake.
// ============================================================

// ============================================================
// Errors.
// ============================================================

// Thrown when the inputs cannot be evaluated at all. Callers map this
// to the "broken" status; anything else escaping this file is a bug in
// it.
class EvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluationError';
  }
}

function fail(message) {
  throw new EvaluationError(message);
}

// What a thrown thing says. A store port may throw anything at all –
// `throw null` included – and reading `.message` off that must not be
// the second, unexplained failure.
function evErrorText(error) {
  return String((error && error.message) || error);
}

// ============================================================
// Values.
//
// One normal form, applied at every edge. A status is stored as
// `{enumMember: 'Existent'}` in initial values, in handler operands and
// in conditions alike; carrying that wrapper into the fold would mean
// every predicate unwrapping it again, so it is unwrapped once, here,
// and a status is a string everywhere downstream. The unwrapping goes
// all the way down – a list of statuses, a record holding one – and
// hands a value back untouched when there was nothing to unwrap.
// ============================================================

function evNormalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value.enumMember !== undefined) return value.enumMember;
  if (Array.isArray(value)) {
    let out = value;
    value.forEach((item, i) => {
      const normal = evNormalize(item);
      if (normal !== item) {
        if (out === value) out = value.slice();
        out[i] = normal;
      }
    });
    return out;
  }
  let out = value;
  for (const key of Object.keys(value)) {
    const normal = evNormalize(value[key]);
    if (normal !== value[key]) {
      if (out === value) out = { ...value };
      out[key] = normal;
    }
  }
  return out;
}

// A value held under a key the object itself has – a definition in a
// collection, a field of a payload, an argument supplied. Never what
// Object inherits under `constructor` or `toString`; see emptyCollection
// (model.js) for the projection's side of the same rule.
function evOwn(object, key) {
  return object !== null && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined;
}

function evDeepEqual(a, b) {
  const x = evNormalize(a);
  const y = evNormalize(b);
  if (x === y) return true;
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false;
  // Canonicalised first: two records carrying the same fields are the
  // same value no matter what order they were authored in – the rule
  // evSameOutcome already applies to scenario comparison.
  return JSON.stringify(evCanonical(x)) === JSON.stringify(evCanonical(y));
}

// The successor of a value, for the operand that mints identifiers.
// Integers step by one; a string ending in digits steps its trailing
// run and keeps the width it was written with, so `c1` becomes `c2` and
// `inv-009` becomes `inv-010`. Anything else has no successor, which
// validation already refuses – reaching it here means a body was
// written past the validator.
function evSuccessor(value) {
  const v = evNormalize(value);
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return fail(
      'A composite identifier has no successor – auto-incrementing makes sense for a single ' +
      'value, and a composite is a record of them.'
    );
  }
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'string') {
    const match = /^(.*?)(\d+)$/.exec(v);
    if (match) {
      // BigInt: past 2^53 a Number rounds, and the successor of
      // inv-12345678901234567891 came out as …7000.
      const next = String(BigInt(match[2]) + 1n);
      return match[1] + next.padStart(match[2].length, '0');
    }
  }
  return fail(`No successor is defined for ${JSON.stringify(v)}.`);
}

function evIsEmpty(value) {
  const v = evNormalize(value);
  if (v === null || v === undefined) return true;
  if (Array.isArray(v) || typeof v === 'string') return v.length === 0;
  return false;
}

function evAsList(value) {
  const v = evNormalize(value);
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function evAsNumber(value, where) {
  const v = evNormalize(value);
  if (typeof v !== 'number') {
    fail(`${where} needs a number but got ${JSON.stringify(v)}.`);
  }
  return v;
}

// Two times in order (11.0): -1, 0 or 1 when both are datetimes –
// ordered as the instants they name, whatever their offsets – or both
// durations, by length; null for anything else, which compares as it
// always did. Nothing here knows a type, so a time is known by its value
// (see _Time_, model.js).
function evTimeOrder(l, r) {
  let a = datetimeInstant(l);
  let b = a === null ? null : datetimeInstant(r);
  if (a === null || b === null) {
    a = durationSeconds(l);
    b = a === null ? null : durationSeconds(r);
  }
  if (a === null || b === null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

// `left operator right` over two values (11.0): numbers as numbers, a
// datetime moved by a duration – written in UTC – and two durations
// added or taken apart. A null side yields null: "not known yet" stays
// unknown rather than counting as zero. `label` names what computes.
function evArithmetic(operator, left, right, label) {
  const l = evNormalize(left);
  const r = evNormalize(right);
  if (l === null || l === undefined || r === null || r === undefined) return null;
  if (typeof l === 'number' && typeof r === 'number') {
    switch (operator) {
      case 'add': return l + r;
      case 'subtract': return l - r;
      case 'multiply': return l * r;
      case 'min': return Math.min(l, r);
      case 'max': return Math.max(l, r);
      default: return fail(`"${operator}" is not an operator this can compute.`);
    }
  }
  const at = { datetime: datetimeInstant, duration: durationSeconds };
  const kind = (value) => (at.datetime(value) !== null ? 'datetime' : at.duration(value) !== null ? 'duration' : null);
  const [lk, rk] = [kind(l), kind(r)];
  const result = arithmeticResultBase(operator, lk, rk);
  if (!result) {
    const odd = !lk ? l : !rk ? r : null;
    return fail(odd !== null
      ? `${label} computes over ${JSON.stringify(odd)}, which is no number, datetime or duration.`
      : `${label} computes ${typeArticle(lk)} ${lk} ${operator} ${typeArticle(rk)} ${rk}, which means nothing.`);
  }
  if (operator === 'min' || operator === 'max') {
    const order = evTimeOrder(l, r);
    return (operator === 'min') === (order <= 0) ? l : r;
  }
  if (result === 'datetime') {
    const [instant, seconds] = lk === 'datetime' ? [at.datetime(l), at.duration(r)] : [at.datetime(r), at.duration(l)];
    return datetimeText(instant + (operator === 'subtract' ? -1 : 1) * seconds * 1000);
  }
  const seconds = at.duration(l) + (operator === 'subtract' ? -1 : 1) * at.duration(r);
  if (seconds < 0) fail(`${label} takes ${r} from ${l} – a duration is never below zero.`);
  return durationText(seconds);
}

// ============================================================
// Tags.
//
// Which events belong to an instance. An event carries the tags it
// lists (`eventTagLeaves`, model.js): a property typed with a tag type,
// or one field of a record, one tag per element when the property is a
// list. That is the same walk the derived DCB reads, so the query a
// boundary displays and the query a fold actually runs come from one
// place and cannot drift apart.
// ============================================================

function tagsOfEvent(model, eventName, data) {
  const definition = evOwn(model['event-definitions'], eventName);
  if (!definition) return [];
  const tags = new Set();
  for (const leaf of eventTagLeaves(model, definition)) {
    const held = evOwn(data, leaf.property);
    const elements = leaf.isList ? evAsList(held) : [held];
    for (const element of elements) {
      if (element === null || element === undefined) continue;
      const value = leaf.field === null ? element : (element || {})[leaf.field];
      if (value === null || value === undefined) continue;
      tags.add(renderTag(identifierTypeOf(model, leaf.identifierType), String(value)));
    }
  }
  return [...tags];
}

// The tags an event carries, worked out once per model and event. A
// fold reads the whole log, and a fan-out folds once per instance, so
// working them out per read made a command over a few thousand events
// cost seconds. Both keys are stable: the model is the projection's
// shared object for its revision, and an event in a log is never
// changed.
const evTagSets = new WeakMap();

function evTagSetOf(model, event) {
  let perModel = evTagSets.get(model);
  if (!perModel) evTagSets.set(model, perModel = new WeakMap());
  let set = perModel.get(event);
  if (!set) perModel.set(event, set = new Set(tagsOfEvent(model, event.type, event.data)));
  return set;
}

function evMatchesTags(model, event, tags) {
  if (!tags.length) return true;
  const carried = evTagSetOf(model, event);
  return tags.every((tag) => carried.has(tag));
}

// Which of a log's events carry a tag, as positions – so a read starts
// from the events carrying its rarest tag instead of scanning the log.
// Kept per model and log array, and rebuilt when the log is no longer
// the one it was built over – longer, or ending elsewhere (the
// sandbox's log is appended to in place).
const evTagIndexes = new WeakMap();

function evTagIndex(model, events) {
  let perModel = evTagIndexes.get(model);
  if (!perModel) evTagIndexes.set(model, perModel = new WeakMap());
  let entry = perModel.get(events);
  const last = events[events.length - 1];
  if (!entry || entry.length !== events.length || entry.last !== last) {
    const index = new Map();
    events.forEach((event, at) => {
      for (const tag of evTagSetOf(model, event)) {
        if (!index.has(tag)) index.set(tag, []);
        index.get(tag).push(at);
      }
    });
    perModel.set(events, entry = { length: events.length, last, index });
  }
  return entry.index;
}

// The events a fold reads: those carrying every one of `tags`, of the
// `types` it handles. `events` is a log – an array – or a *read port*
// (see the header), asked here with the one item this fold needs.
// A command does not ask fold by fold: `evDecideThroughPort` hands its
// folds a port of its own that answers from what it fetched per round.
// A log keeps the other types in: the fold skips what it has no
// handler for, and filtering here would cost a pass for nothing.
function evSelectEvents(model, events, types, tags) {
  if (typeof events !== 'function') return evEventsTagged(model, events, tags);
  // A fold that handles nothing reads nothing – an empty `types` is no
  // query a store takes (`memoryStore`), and leaving it out would mean
  // any type.
  if (!types.length) return [];
  return events([{ types: [...types], tags: [...tags] }]) || [];
}

// The events carrying every one of `tags`, in log order.
function evEventsTagged(model, events, tags) {
  if (!tags.length) return events;
  const index = evTagIndex(model, events);
  let rarest = null;
  for (const tag of tags) {
    const at = index.get(tag) || [];
    if (!rarest || at.length < rarest.length) rarest = at;
  }
  return rarest.map((at) => events[at]).filter((event) => evMatchesTags(model, event, tags));
}

// ============================================================
// Compiling a fold.
//
// A projection – grouped or top-level – becomes two things: the state
// it starts from, and a step function per event type.
// ============================================================

// A handler operand, as a function of the state and the event it is
// folding. `event-property` is only available to a handler – a
// condition gets a different operand set.
function evCompileHandlerOperand(operand) {
  switch (operandSource(operand)) {
    case 'event-property':
      return (state, event) => evOwn(event.data, operand.eventProperty);
    case 'successor': {
      const inner = evCompileHandlerOperand(operand.successor);
      return (state, event) => evSuccessor(inner(state, event));
    }
    case 'enum-member':
      return () => operand.enumMember;
    // A record built whole from the event (11.0): each field its own
    // operand, in the order written.
    case 'record': {
      const fields = Object.entries(operand.record || {}).map(([key, value]) => [key, evCompileHandlerOperand(value)]);
      return (state, event) => Object.fromEntries(fields.map(([key, value]) => [key, evNormalize(value(state, event))]));
    }
    default:
      return () => evNormalize(operand);
  }
}

// One handler, as `(state, event, tags) => nextState` – `tags` the
// values the read gave the projection's tags, by name, which is all a
// branched handler's condition reads besides the event.
function evCompileHandler(handler, label) {
  if (isConditionalHandler(handler)) return evCompileBranchedHandler(handler, label);
  return evCompileOperation(handler, handler.event, label);
}

// A branched handler (11.0): its chains in written order, each applying
// its first arm whose condition holds, or `otherwise`, or nothing – so
// separate `if`s all apply, one after the other, and a self-transfer
// decrements and then increments.
function evCompileBranchedHandler(handler, label) {
  const chains = handlerChains(handler).map((step) => ({
    arms: (Array.isArray(step.branches) ? step.branches : []).filter((arm) => arm && typeof arm === 'object')
      .map((arm) => ({ holds: evCompileHandlerCondition(arm.condition), apply: evCompileOperation(arm, handler.event, label) })),
    otherwise: step.otherwise && typeof step.otherwise === 'object'
      ? evCompileOperation(step.otherwise, handler.event, label) : null,
  }));
  return (state, event, tags) => {
    let next = state;
    for (const chain of chains) {
      const arm = chain.arms.find((candidate) => candidate.holds(event, tags));
      if (arm) next = arm.apply(next, event);
      else if (chain.otherwise) next = chain.otherwise(next, event);
    }
    return next;
  };
}

// A handler's condition, as `(event, tags) => boolean`: an event field
// – a record's field one hop in – compared with a tag's value or a
// literal, joined by and / or. Nothing else is in scope.
function evCompileHandlerCondition(condition) {
  if (isCompoundCondition(condition)) {
    const parts = conditionMembers(condition).map(evCompileHandlerCondition);
    return Array.isArray(condition.all)
      ? (event, tags) => parts.every((part) => part(event, tags))
      : (event, tags) => parts.some((part) => part(event, tags));
  }
  if (!condition || typeof condition !== 'object') return () => false;
  const side = (operand) => {
    switch (operandSource(operand)) {
      case 'event-property':
        return operand.property === undefined
          ? (event) => evOwn(event.data, operand.eventProperty)
          : (event) => evOwn(evOwn(event.data, operand.eventProperty), operand.property);
      case 'parameter':
        return (event, tags) => {
          const value = evOwn(tags, operand.parameterName);
          if (value === undefined) fail(`A handler's condition compares with "${operand.parameterName}", which the read gave no value.`);
          return value;
        };
      case 'enum-member':
        return () => operand.enumMember;
      case 'duration':
        return () => operand.duration;
      case 'static':
        return () => evNormalize(operand);
      default:
        return () => fail(`A handler's condition "${conditionText(condition)}" reads something only the event and the projection's tags can give.`);
    }
  };
  const left = side(condition.leftHandSide);
  const right = side(condition.rightHandSide);
  return (event, tags) => evApplyPredicate(condition, left(event, tags), right(event, tags));
}

// One operation – a handler's, or one arm's – as `(state, event) =>
// nextState`.
function evCompileOperation(handler, eventName, label) {
  const valueOf = evCompileHandlerOperand(handler.value);
  const where = `The handler for "${eventName}" on ${label}`;

  switch (handler.operation) {
    case 'set':
      return (state, event) => evNormalize(valueOf(state, event));
    case 'increment':
      return (state, event) =>
        evAsNumber(state, where) + evAsNumber(valueOf(state, event), where);
    case 'decrement':
      return (state, event) =>
        evAsNumber(state, where) - evAsNumber(valueOf(state, event), where);
    case 'append':
      return (state, event) => {
        const value = evNormalize(valueOf(state, event));
        // Appending a list appends its elements: a handler that reads a
        // list-typed event property is adding those items, not adding
        // one item that happens to be a list.
        return [...evAsList(state), ...(Array.isArray(value) ? value : [value])];
      };
    case 'remove':
      return (state, event) => {
        const value = evNormalize(valueOf(state, event));
        const out = [...evAsList(state)];
        // The first match only. Where duplicates cannot occur this is
        // indistinguishable from removing every match; where they can,
        // one event undoing one earlier event is what the operation
        // means.
        const at = out.findIndex((element) => evDeepEqual(element, value));
        if (at >= 0) out.splice(at, 1);
        return out;
      };
    default:
      return fail(`${where} has no operation this can run.`);
  }
}

// A projection, grouped or not, compiled once and folded many times –
// once per model and target, so a fan-out reading the same projection
// two hundred times compiles it once.
const evCompiled = new WeakMap();

function evCompileTarget(model, target, label) {
  let perModel = evCompiled.get(model);
  if (!perModel) evCompiled.set(model, perModel = new WeakMap());
  let perTarget = perModel.get(target);
  if (!perTarget) perModel.set(target, perTarget = new Map());
  if (!perTarget.has(label)) perTarget.set(label, evCompileTargetAfresh(model, target, label));
  return perTarget.get(label);
}

function evCompileTargetAfresh(model, target, label) {
  const steps = new Map();
  for (const handler of target.handlers || []) {
    if (!handler || !handler.event) continue;
    steps.set(handler.event, evCompileHandler(handler, label));
  }

  const initial = target.initialValue === undefined
    ? evNormalize(defaultInitialValue(model, target))
    : evNormalize(target.initialValue);

  return {
    types: [...steps.keys()],
    initial,
    // Every step returns a new value, so the initial one is shared by
    // every fold of this compiled target untouched.
    fold: (events, tags = {}) => {
      let state = initial;
      for (const event of events) {
        const step = steps.get(event.type);
        if (step) state = step(state, event, tags);
      }
      return evNormalize(state);
    },
  };
}

// ============================================================
// Folding.
//
// There is one fold, `foldProjection`, and one way into it: a *read* –
// `{ tags: { courseId: 'c1' }, args }`, a value for each tag the
// projection declares (8.0), keyed by its name, and the arguments it
// takes. The declared type of each tag is its key, so the
// projection and the read together say which events it folds. Reading
// a group member is the same read, its one tag the group's: nothing
// left for two paths to disagree about.
//
// It replays from the start of the log every time. That is the same
// choice the playground already makes for its own state, and it stays
// until something measured says otherwise – an incremental fold only
// helps scrubbing forwards, and pays for it with a snapshot regime that
// a replay does not need.
// ============================================================

// The value a read gives one declared tag (`{name, tagType}`), as the
// leaves it renders to – a scalar tag type renders one tag, a record
// one per tag-marked field – paired with the type each leaf is keyed by.
function evReadTagLeaves(model, projectionName, tag, value) {
  const normalized = evNormalize(value);
  if (value === undefined) {
    fail(`Projection "${projectionName}" was read without a value for its "${tag.name}" tag.`);
  }
  // null has no tag – "Type:null" would be one phantom read every unset
  // value shares.
  if (normalized === null) {
    fail(`Projection "${projectionName}" was read tagged by no value (null) for its "${tag.name}" tag.`);
  }
  const leaves = idLeavesOfType(model, tag.tagType);
  if (!leaves.length) fail(`Projection "${projectionName}"'s "${tag.name}" tag is a ${tag.tagType}, which is no tag type.`);
  return leaves.map((leaf) => ({
    type: leaf.identifierType,
    value: leaf.field === null ? normalized : (normalized || {})[leaf.field],
  }));
}

// The tags a read's query carries, rendered. A derived projection's
// operands are read by the tags it passes them, so its query is
// theirs. The interface does not call this to say what a fold reads:
// it traces the fold's reads (`projectFromStore`), so what it shows is
// what was asked.
function projectionQueryTags(model, projectionName, read) {
  const projection = evOwn(projectionsOf(model), projectionName);
  if (!projection) fail(`This model has no projection "${projectionName}".`);
  const held = (read && read.tags) || {};
  return [...new Set(projectionTagParams(projection)
    .flatMap((tag) => evReadTagLeaves(model, projectionName, tag, evOwn(held, tag.name)))
    .map((leaf) => renderTag(identifierTypeOf(model, leaf.type), String(leaf.value))))];
}

// Events reach a fold carrying an explicit key for every optional
// property their definition declares – null when unset. One spelling
// of "no value" downstream: a Given step may omit the key, an emission
// writes the null out, and a handler reads the same thing
// either way. Optional lists are exempt (they evaluate as plain
// lists; the advisories point the combination out).
function evWithExplicitOptionals(model, event) {
  const definition = evOwn(model['event-definitions'], event.type);
  let data = event.data;
  for (const property of (definition || {}).properties || []) {
    if (!property.isOptional || property.isList) continue;
    if (evOwn(data, property.name) !== undefined) continue;
    data = { ...(data || {}), [property.name]: null };
  }
  return data === event.data ? event : { ...event, data };
}

function foldProjection(model, events, projectionName, read, seen = []) {
  const projection = evOwn(projectionsOf(model), projectionName);
  if (projection && derivedOf(projection)) {
    return evDeriveProjection(model, events, projectionName, read, seen);
  }
  const { compiled, selected } = evProjectionFold(model, events, projectionName, read);
  return compiled.fold(selected, (read && read.tags) || {});
}

// A derived projection is not folded but computed: each operand that
// reads a projection folds it – by the tags and arguments the operand
// gives it, each a literal or one of this read's own parameters
// (`{parameterName}`, a tag or an argument) – a side that names a
// parameter is the value the read gave it, and the predicate decides,
// or the operator computes. `seen` is the cycle guard – a value derived through itself
// has nowhere to start, and the advisory said so before this error does.
function evDeriveProjection(model, events, projectionName, read, seen = []) {
  if (seen.includes(projectionName)) {
    fail(`Projection "${projectionName}" derives from itself – a cycle has no value to start from.`);
  }
  const projection = evOwn(projectionsOf(model), projectionName);
  const derived = derivedOf(projection);

  // One of this projection's own parameters, as the read gave it – a
  // tag or an argument, by name.
  const parameter = (value) => {
    const name = value.parameterName;
    const given = evOwn((read && read.tags) || {}, name) !== undefined
      ? evOwn(read.tags, name) : evOwn((read && read.args) || {}, name);
    if (given === undefined) {
      fail(`Projection "${projectionName}" was read without a value for "${name}".`);
    }
    return evNormalize(given);
  };
  const literal = (value) => (operandSource(value) === 'parameter' ? parameter(value)
    : operandSource(value) === 'tag-literal' ? value.tagValue : evNormalize(value));
  const readOperand = (operand) => {
    if (operandSource(operand) === 'parameter') return parameter(operand);
    if (operandSource(operand) === 'duration') return operand.duration;
    if (operandSource(operand) === 'collection') {
      const read = operand.read || {};
      const tags = {};
      for (const [name, value] of readTagEntries(read)) if (operandSource(value) !== 'open') tags[name] = literal(value);
      const instances = evOpenRead(model, events, read.projection, tags, `"${operandText(read)}"`);
      return evCollect(operand, instances, parameter);
    }
    if (operandSource(operand) !== 'projection-read') return evNormalize(operand);
    if (openTagNames(operand).length) evOpenReadOutside(operand);
    const args = {};
    for (const [name, argument] of Object.entries(operand.arguments || {})) args[name] = literal(argument);
    const tags = {};
    for (const [name, value] of readTagEntries(operand)) tags[name] = literal(value);
    return evField(foldProjection(model, events, operand.projection, { tags, args }, [...seen, projectionName]), operand.field);
  };

  const left = readOperand(derived.leftHandSide);
  if (derivedHolds(derived)) return left;
  const right = readOperand(derived.rightHandSide);
  if (derivedComputes(derived)) return evApplyOperator(projectionName, derived, left, right);
  return evApplyPredicate(derived, left, right);
}

// One computation over two numbers, or a time and a duration (11.0;
// `evArithmetic`). A null side yields null, and a side that computes
// with nothing is an error the advisory named first.
function evApplyOperator(projectionName, derived, left, right) {
  return evArithmetic(derived.operator, left, right, `Projection "${projectionName}"'s "${derivedText(derived)}"`);
}

// ============================================================
// Open reads and collection functions (11.0).
//
// `P(c1, *)` reads every present instance of P whose bound tags match:
// the query is the handled types by the bound tags alone – the same
// on a store as in the derivation – and the fold groups what comes back
// by the open tags' values, each group folded once as the instance it
// is, its condition-bearing handlers seeing every tag's value. An event
// carrying no value for an open tag belongs to no instance; one
// carrying two (a transfer's `from` and `to` of one type) belongs to
// each. An instance at the projection's initial value is absent – that
// is how setting the initial value deletes. Instances come in the order
// of their first event.
// ============================================================

// A record value's field, or the whole value when no field is named; a
// value with no such field (null, before anything set it) gives null.
// Read off many values – a fanned read – it is one field per value.
function evField(value, field) {
  if (field === undefined) return value;
  if (Array.isArray(value)) return value.map((element) => evField(element, field));
  const held = evOwn(value, field);
  return held === undefined ? null : held;
}

function evOpenReadOutside(read) {
  fail(`${operandText(read)} leaves a tag open – it is read inside count, sum, min, max, average, any or all.`);
}

// The present instances of `projectionName` matching `bound` – its
// bound tags' values by name – as `[{tags, value}]`, `tags` every tag's
// value by name.
function evOpenRead(model, events, projectionName, bound, label) {
  const projection = evOwn(projectionsOf(model), projectionName);
  if (!projection) fail(`${label} reads "${projectionName}", which this model does not define.`);
  if (derivedOf(projection)) fail(`${label} leaves a tag of ${projectionName} open, which is derived – an open read collects a folded projection's instances.`);
  const declared = projectionTagParams(projection);
  const open = declared.filter((tag) => evOwn(bound, tag.name) === undefined);
  if (!open.length) fail(`${label} leaves no tag open.`);
  if (open.length === declared.length) fail(`${label} leaves every tag open – at least one stays bound.`);
  const queryTags = [...new Set(declared.filter((tag) => !open.includes(tag))
    .flatMap((tag) => evReadTagLeaves(model, projectionName, tag, evOwn(bound, tag.name)))
    .map((leaf) => renderTag(identifierTypeOf(model, leaf.type), String(leaf.value))))];
  const compiled = evCompileTarget(model, projection, `projection "${projectionName}"`);
  const selected = evSelectEvents(model, events, compiled.types, queryTags);
  // The identifier type each open tag is keyed by: one, for a scalar
  // tag type – a record's tag fields would make an instance of several.
  const keyed = open.map((tag) => {
    const leaves = idLeavesOfType(model, tag.tagType);
    if (leaves.length !== 1 || leaves[0].field !== null) {
      fail(`${label} leaves "${tag.name}" open, a ${tag.tagType} – an open tag is of a scalar tag type.`);
    }
    return { name: tag.name, type: leaves[0].identifierType };
  });
  const instances = new Map();
  for (const raw of selected) {
    const event = evWithExplicitOptionals(model, raw);
    const definition = evOwn(model['event-definitions'], event.type);
    if (!definition || !compiled.types.includes(event.type)) continue;
    const leaves = eventTagLeaves(model, definition);
    // Each open tag's values in this event; none for one leaves it out.
    let combos = [{}];
    for (const { name, type } of keyed) {
      const values = [];
      for (const leaf of leaves.filter((l) => l.identifierType === type)) {
        const held = evOwn(event.data, leaf.property);
        for (const element of leaf.isList ? evAsList(held) : [held]) {
          const value = evNormalize(leaf.field === null ? element : evOwn(element, leaf.field));
          if (value !== null && value !== undefined && !values.some((v) => evDeepEqual(v, value))) values.push(value);
        }
      }
      combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [name]: value })));
    }
    for (const combo of combos) {
      const key = JSON.stringify(keyed.map(({ name }) => combo[name]));
      if (!instances.has(key)) instances.set(key, { tags: { ...bound, ...combo }, events: [] });
      instances.get(key).events.push(event);
    }
  }
  const out = [];
  for (const instance of instances.values()) {
    const value = compiled.fold(instance.events, instance.tags);
    if (!evDeepEqual(value, compiled.initial)) out.push({ tags: instance.tags, value });
  }
  return out;
}

// A collection function over an open read's instances. `where` keeps
// the instances it holds for, reading `value` (`value.field` of a
// record), the parameters in scope – `parameter(operand)` – and
// literals. Over nothing: count and sum 0; min, max and average null;
// any false; all true. Without a `where`, any says whether an instance
// is present at all and all holds – every present instance is there.
// A null value holds no number, and the numeric ones skip it.
function evCollect(operand, instances, parameter) {
  const label = `"${operandText(operand)}"`;
  const holds = operand.where === undefined ? null : evCompileWhere(operand.where, parameter, label);
  const kept = holds ? instances.filter((instance) => holds(instance.value)) : instances;
  // Over a record's field (11.0), `sum(P(x, *).seats)`: that field of each.
  const field = operand.read && operand.read.field;
  const numbers = () => kept.map((instance) => evNormalize(evField(instance.value, field))).filter((value) => value !== null).map((value) => {
    if (typeof value !== 'number') fail(`${label} computes over ${JSON.stringify(value)}, which is no number.`);
    return value;
  });
  switch (operand.collect) {
    case 'count': return kept.length;
    case 'sum': return numbers().reduce((a, b) => a + b, 0);
    case 'min': { const n = numbers(); return n.length ? Math.min(...n) : null; }
    case 'max': { const n = numbers(); return n.length ? Math.max(...n) : null; }
    case 'average': { const n = numbers(); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; }
    case 'any': return kept.length > 0;
    case 'all': return kept.length === instances.length;
    default: return fail(`"${operand.collect}" is not a collection function (${COLLECTION_FUNCTIONS.join(', ')}).`);
  }
}

// A `where`, as `(value) => boolean`.
function evCompileWhere(condition, parameter, label) {
  if (isCompoundCondition(condition)) {
    const parts = conditionMembers(condition).map((part) => evCompileWhere(part, parameter, label));
    return Array.isArray(condition.all)
      ? (value) => parts.every((part) => part(value))
      : (value) => parts.some((part) => part(value));
  }
  if (!condition || typeof condition !== 'object') return () => false;
  const side = (operand) => {
    if (operand === undefined) return () => undefined;
    if (Array.isArray(operand)) return () => operand.map(evNormalize);
    switch (operandSource(operand)) {
      case 'instance-value': return (value) => evField(evNormalize(value), operand.field);
      case 'parameter': return () => evField(parameter(operand), operand.property);
      case 'enum-member': return () => operand.enumMember;
      case 'duration': return () => operand.duration;
      case 'static': return () => evNormalize(operand);
      default:
        return () => fail(`${label} has a where that reads ${operandText(operand)} – a where reads value, parameters and literals, never a projection.`);
    }
  };
  const left = side(condition.leftHandSide);
  const right = side(condition.rightHandSide);
  return (value) => evApplyPredicate(condition, left(value), right(value));
}

function evProjectionFold(model, events, projectionName, read) {
  const projection = evOwn(projectionsOf(model), projectionName);
  if (!projection) fail(`This model has no projection "${projectionName}".`);

  const queryTags = projectionQueryTags(model, projectionName, read);
  const compiled = evCompileTarget(model, projection, `projection "${projectionName}"`);
  const selected = evSelectEvents(model, events, compiled.types, queryTags)
    .map((event) => evWithExplicitOptionals(model, event));
  return { compiled, selected };
}

// ============================================================
// Command scope.
//
// What a command's operands can see: its own arguments, and whatever
// the boundary has bound so far. A group binding may hold one instance
// or many – the boundary is resolved in rounds, and a later round may
// read an earlier one, so this grows as the rounds run.
// ============================================================

// One instance of a group, by its tag's value. A member is folded when
// a rule first reads it, once per spelling – `seatsOn(slot: s1)` and
// `seatsOn(slot: s2)` are two reads – as the qualified projection read
// by this instance's tag and the member's own arguments.
function evGroupInstance(model, events, groupName, tag, id) {
  const cache = new Map();
  return {
    id,
    // Exposed so the boundary can be reported afterwards as the
    // members the decision actually depended on, keyed as they read.
    cache,
    read(operand, scope) {
      const args = {};
      for (const [name, argument] of Object.entries(operand.arguments || {})) args[name] = evReadOperand(argument, scope);
      const key = Object.keys(args).length
        ? `${operand.property}(${Object.values(args).map((v) => JSON.stringify(v)).join(', ')})`
        : operand.property;
      if (!cache.has(key)) {
        const name = qualifiedProjectionName(groupName, operand.property);
        if (!evOwn(projectionsOf(model), name)) fail(`${groupName} has no projection "${operand.property}".`);
        cache.set(key, foldProjection(model, events, name, { tags: { [tag.name]: id }, args }));
      }
      return cache.get(key);
    },
  };
}

// An operand as a command reads it: whole, with no iteration index
// applied. Reading a property off a plural alias yields one value per
// instance, and a list read that way flattens – a list of lists is not
// a shape anything downstream can use.
function evReadOperand(operand, scope) {
  // The one array operand – `equalsAny`'s literal list – reads as its
  // entries, each normalized like any other literal.
  if (Array.isArray(operand)) return operand.map(evNormalize);
  switch (operandSource(operand)) {
    case 'parameter': {
      const held = evOwn(scope.args, operand.parameterName);
      if (held === undefined) {
        fail(`This command was given no value for "${operand.parameterName}".`);
      }
      if (!operand.property) return evNormalize(held);
      const value = evNormalize(held);
      return Array.isArray(value)
        ? value.map((element) => evOwn(element, operand.property))
        : evOwn(value, operand.property);
    }
    case 'alias-property': {
      const binding = evBound(operand.alias, scope);
      if (binding.kind === 'projection') {
        if (operand.property) {
          fail(`"${operand.alias}" reads a projection, which holds one value and has no properties.`);
        }
        // Fanned out, it is one value per element; read whole, a list
        // of lists flattens, as a fanned group member's does.
        if (binding.fanned) {
          const each = binding.value.map((value) => evField(value, operand.field));
          return each.some(Array.isArray) ? each.flat() : each;
        }
        return evField(binding.value, operand.field);
      }
      if (!operand.property) {
        fail(`"${operand.alias}" reads the group ${binding.group}, so reading it needs one of its projections.`);
      }
      if (!binding.fanned) return evField(binding.instances[0].read(operand, scope), operand.field);
      const each = binding.instances.map((instance) => evField(instance.read(operand, scope), operand.field));
      return each.some(Array.isArray) ? each.flat() : each;
    }
    // `value` inside a loop over an open read (11.0).
    case 'instance-value':
      if (!scope.loop || !scope.loop.hasValue) fail(`${operandText(operand)} is read outside a for each over an open read.`);
      return evField(evNormalize(scope.loop.value), operand.field);
    // A collection function (11.0): its open read made once per
    // spelling, like any read in place, and reduced.
    case 'collection': {
      const read = operand.read || {};
      const key = evInlineKey(read, scope);
      if (!scope.inline.has(key)) scope.inline.set(key, evOpenReadInScope(read, scope));
      return evCollect(operand, scope.inline.get(key).instances, (parameter) => evReadOperand({ parameterName: parameter.parameterName }, scope));
    }
    case 'enum-member':
      return operand.enumMember;
    // A duration literal (11.0), `15m`: the ISO 8601 duration it stores.
    case 'duration':
      return operand.duration;
    // Arithmetic (11.0): both sides read, left first – a read in either
    // made as anywhere – and computed.
    case 'arithmetic':
      return evArithmetic(operand.operator, evReadOperand(operand.leftHandSide, scope),
        evReadOperand(operand.rightHandSide, scope), `"${operandText(operand)}"`);
    // An inline read is folded where it is first needed and once per
    // spelling – the same read written in two rules is one query – and
    // reported beside the aliases, under how it reads.
    case 'projection-read': {
      if (openTagNames(operand).length) evOpenReadOutside(operand);
      const key = evInlineKey(operand, scope);
      if (!scope.inline.has(key)) {
        scope.inline.set(key, evProjectionRead(scope.model, scope.events, scope.body, operand, scope,
          `"${operandText(operand)}"`));
      }
      const read = scope.inline.get(key);
      return read.fanned ? read.value.map((value) => evField(value, operand.field)) : evField(read.value, operand.field);
    }
    default:
      return evNormalize(operand);
  }
}

// What a read in place is cached under: its spelling (`readKey`) –
// and, inside a loop, the values of the loop's names it reads, so a
// read by the element is made once per element and one that does not
// name it once in all.
function evInlineKey(read, scope) {
  const key = readKey(read);
  if (!scope.loop) return key;
  const named = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.parameterName === 'string' && scope.loop.names.includes(value.parameterName)) named.add(value.parameterName);
    if (value.instanceValue === true) named.add('value');
    Object.values(value).forEach(walk);
  };
  walk(read);
  if (!named.size) return key;
  return key + JSON.stringify([...named].sort().map((name) => (name === 'value' ? scope.loop.value : scope.args[name])));
}

// A loop's elements (11.0), in source order, as `[{names, value?}]`:
// `names` the value each of the loop's names takes. An open read gives
// one per present instance, each open tag's value to its name in the
// projection's order of tags, and the instance's `value`; a list – a
// projection's or a parameter's – one per entry, to the one name.
function evLoopElements(model, loop, scope) {
  const names = loopNames(loop);
  const source = loop.in;
  const label = `"for each ${names.join(', ')}"`;
  if (operandSource(source) === 'projection-read' && openTagNames(source).length) {
    const key = evInlineKey(source, scope);
    if (!scope.inline.has(key)) scope.inline.set(key, evOpenReadInScope(source, scope));
    const read = scope.inline.get(key);
    const open = read.tags.filter((tag) => tag.open).map((tag) => tag.name);
    if (open.length !== names.length) fail(`${label} names ${names.length}, but ${operandText(source)} leaves ${open.length} open.`);
    return read.instances.map((instance) => ({
      names: Object.fromEntries(names.map((name, i) => [name, instance.tags[open[i]]])),
      value: instance.value,
      hasValue: true,
    }));
  }
  const held = evNormalize(evReadOperand(source, scope));
  if (held === null || held === undefined) return [];
  if (!Array.isArray(held)) fail(`${label} runs over ${operandText(source)}, which is no list.`);
  if (names.length !== 1) fail(`${label} names ${names.length}, but a list's element takes one.`);
  return held.map((element) => ({ names: { [names[0]]: element }, hasValue: false }));
}

// ============================================================
// The boundary.
// ============================================================

// Where each element of a fan came from, as an index into the list the
// fan is rooted in – what a zipped parameter is read at. Fanned from a
// list, an element is its own index. Fanned from an alias that is
// itself fanned out (`Course(each student.courses)`), it is the index
// the instance it was read off came from: every course of the first
// student pairs with the first element the students were fanned from,
// however many courses each holds. The values are flattened the way
// reading the alias whole flattens them, a list per instance into its
// elements.
function evFanSourceIndexes(operand, scope, count) {
  const parent = operandSource(operand) === 'alias-property' ? evBound(operand.alias, scope) : null;
  if (parent && parent.fanned && parent.instances) {
    const out = [];
    parent.instances.forEach((instance, j) => {
      const value = parent.kind === 'projection' ? instance.value : instance.read(operand, scope);
      const root = parent.sourceIndexes && parent.sourceIndexes[j] !== undefined ? parent.sourceIndexes[j] : j;
      const many = Array.isArray(value) ? value.length : 1;
      for (let k = 0; k < many; k++) out.push(root);
    });
    if (out.length === count) return out;
  }
  return Array.from({ length: count }, (_, i) => i);
}

// One projection read – an alias's or an inline one – resolved in the
// command's scope: a value for each tag the projection declares, which
// has to be of the declared type (the tag's key – the advisory said so
// first), the arguments it takes, and the value folded from them.
// The tags and arguments are kept beside the value because they are
// what makes it reproducible: the value alone says what was read, and
// they say how, which is the half a reader needs to go and look at it.
// `tags` is reported as `[{name, type, value}]`, in declaration order.
//
// A read fanned out (`ProductExists(each items.productId)`) is made once
// per element of that list – `instances`, each with its tags and value,
// in the list's order so a zipped parameter pairs by index – and `value`
// is then every one of them, in order.
function evProjectionRead(model, events, body, read, scope, label) {
  const projection = evOwn(projectionsOf(model), read.projection);
  if (!projection) fail(`${label} reads "${read.projection}", which this model does not define.`);
  const held = (read.tags && typeof read.tags === 'object' && !Array.isArray(read.tags)) ? read.tags : {};
  let fanned = null;
  const tags = projectionTagParams(projection).map((tag) => {
    const operand = evOwn(held, tag.name);
    if (operand === undefined) fail(`${label} gives no value for ${read.projection}'s "${tag.name}" tag.`);
    const resolved = tagOperandType(model, body, operand);
    if (resolved && resolved.propertyType !== tag.tagType) {
      fail(`${label} is tagged by ${operandText(operand)}, ${typeArticle(resolved.propertyType)} ` +
        `${resolved.propertyType} – but ${read.projection}'s "${tag.name}" tag is ` +
        `${typeArticle(tag.tagType)} ${tag.tagType}.`);
    }
    if (operandSource(operand) === 'each') {
      const values = evAsList(evReadOperand(operand.each, scope));
      fanned = { name: tag.name, values, roots: evFanSourceIndexes(operand.each, scope, values.length) };
      return { name: tag.name, type: tag.tagType, value: null };
    }
    const value = operandSource(operand) === 'tag-literal' ? operand.tagValue : evReadOperand(operand, scope);
    if ((resolved && resolved.isList) || Array.isArray(value)) {
      fail(`${label} is tagged by ${operandText(operand)}, a list – its "${tag.name}" tag takes one value.`);
    }
    return { name: tag.name, type: tag.tagType, value };
  });
  const args = {};
  for (const [name, operand] of Object.entries(read.arguments || {})) {
    args[name] = evReadOperand(operand, scope);
  }
  const byName = (list) => Object.fromEntries(list.map((tag) => [tag.name, tag.value]));
  if (!fanned) {
    return {
      kind: 'projection',
      projection: read.projection,
      tags,
      arguments: args,
      value: foldProjection(model, events, read.projection, { tags: byName(tags), args }),
    };
  }
  const instances = fanned.values.map((element) => {
    const own = tags.map((tag) => (tag.name === fanned.name ? { ...tag, value: element } : tag));
    return { tags: own, value: foldProjection(model, events, read.projection, { tags: byName(own), args }) };
  });
  return {
    kind: 'projection',
    projection: read.projection,
    fanned: true,
    tags,
    arguments: args,
    instances,
    sourceIndexes: fanned.roots,
    value: instances.map((instance) => instance.value),
  };
}

// An open read in a command's scope (11.0): its bound tags read like
// any read's – of the declared type, one value each, never null – and
// its instances collected (`evOpenRead`). Reported beside the reads in
// place, under how it reads, `P(c1, *)`.
function evOpenReadInScope(read, scope) {
  const { model, body } = scope;
  const label = `"${operandText(read)}"`;
  const projection = evOwn(projectionsOf(model), read.projection);
  if (!projection) fail(`${label} reads "${read.projection}", which this model does not define.`);
  const held = (read.tags && typeof read.tags === 'object' && !Array.isArray(read.tags)) ? read.tags : {};
  const bound = {};
  const tags = projectionTagParams(projection).map((tag) => {
    const operand = evOwn(held, tag.name);
    if (operand === undefined) fail(`${label} gives no value for ${read.projection}'s "${tag.name}" tag.`);
    if (operandSource(operand) === 'open') return { name: tag.name, type: tag.tagType, open: true, value: null };
    if (operandSource(operand) === 'each') fail(`${label} fans out and leaves a tag open – an open read collects one set of instances.`);
    const value = operandSource(operand) === 'tag-literal' ? operand.tagValue : evReadOperand(operand, scope);
    const resolved = tagOperandType(model, body, operand);
    if ((resolved && resolved.isList) || Array.isArray(value)) {
      fail(`${label} is tagged by ${operandText(operand)}, a list – its "${tag.name}" tag takes one value.`);
    }
    bound[tag.name] = value;
    return { name: tag.name, type: tag.tagType, value };
  });
  const instances = evOpenRead(model, scope.events, read.projection, bound, label);
  return { kind: 'projection', projection: read.projection, open: true, tags, arguments: {}, instances,
    value: instances.map((instance) => instance.value) };
}

// An alias's read, made the first time something needs it (11.0): a
// read no step reaches is never made, so a read guarded by an earlier
// rule or branch cannot fail on what that rule ruled out – and the
// append condition covers only the reads the decision made. A read that
// is reached with a tag it cannot read by is still an error.
function evBound(alias, scope) {
  if (scope.bound[alias]) return scope.bound[alias];
  const binding = (scope.body.boundary || []).find((b) => b && b.alias === alias);
  if (!binding) fail(`Nothing in this boundary is bound as "${alias}".`);
  if (scope.resolving.has(alias)) fail(`Binding "${alias}" is read through itself.`);
  scope.resolving.add(alias);
  try {
    evResolveBinding(scope.model, scope.events, scope.body, binding, scope);
  } finally {
    scope.resolving.delete(alias);
  }
  return scope.bound[alias];
}

function evResolveBinding(model, events, body, binding, scope) {
  if (binding.projection) {
    scope.bound[binding.alias] = evProjectionRead(model, events, body, binding, scope, `Binding "${binding.alias}"`);
    return;
  }
  if (binding.group === undefined) {
    fail(`Binding "${binding.alias}" reads neither a projection nor a group.`);
  }
  const group = evOwn(model['group-definitions'], binding.group);
  if (!group) fail(`Binding "${binding.alias}" reads group "${binding.group}", which this model does not define.`);
  const tag = groupTagOf(group);
  if (!tag) fail(`Group "${binding.group}" declares no tag, so "${binding.alias}" has nothing to read it by.`);
  const label = `Binding "${binding.alias}"`;
  const operand = evOwn((binding.tags && typeof binding.tags === 'object') ? binding.tags : {}, tag.name);
  if (operand === undefined) fail(`${label} gives no value for ${binding.group}'s "${tag.name}" tag.`);
  const resolved = tagOperandType(model, body, operand);
  if (resolved && resolved.propertyType !== tag.tagType) {
    fail(`${label} is tagged by ${operandText(operand)}, ${typeArticle(resolved.propertyType)} ` +
      `${resolved.propertyType} – but ${binding.group}'s "${tag.name}" tag is ` +
      `${typeArticle(tag.tagType)} ${tag.tagType}.`);
  }

  // Many instances are read where the binding says so, `each`; a list
  // read as one value has no one instance to be.
  const fanned = operandSource(operand) === 'each';
  const held = fanned ? evReadOperand(operand.each, scope)
    : operandSource(operand) === 'tag-literal' ? operand.tagValue : evReadOperand(operand, scope);
  if (!fanned && Array.isArray(evNormalize(held))) {
    fail(`${label} reads ${binding.group} by ${operandText(operand)}, which holds ` +
      `many – ${binding.group}(each ${operandText(operand)}) reads one instance per element.`);
  }
  // A null tag binds nothing. Folding at "Type:null" would invent one
  // phantom instance every unset value shares, so it is an error – the
  // one the optional-parameter advisory promises.
  if (!fanned && evNormalize(held) === null) {
    fail(`${label} has no instance to read: ${operandText(operand)} is unset (null).`);
  }
  // Order is preserved and duplicates are kept: a binding fanned from a
  // list parameter is read at the same index as that parameter, and
  // collapsing it would silently pair a line of the cart with the wrong
  // one's price.
  const ids = fanned ? evAsList(held) : [held];
  scope.bound[binding.alias] = {
    kind: 'group',
    group: binding.group,
    tag,
    fanned,
    sourceIndexes: fanned ? evFanSourceIndexes(operand.each, scope, ids.length) : [0],
    instances: ids.map((id) => evGroupInstance(model, events, binding.group, tag, evNormalize(id))),
  };
}

// ============================================================
// Conditions.
//
// A condition over a plural alias holds when it holds for every
// instance. Where a list parameter is read beside an alias fanned out
// from that very list, the two are read at the same index – `zipped`,
// in the language `model.js` uses for it – so each product is checked
// against the price submitted for that product.
// ============================================================

function evApplyPredicate(condition, left, right) {
  const l = evNormalize(left);
  const r = evNormalize(right);
  let held;

  switch (condition.predicate) {
    case 'isEmpty': held = evIsEmpty(l); break;
    case 'isNotEmpty': held = !evIsEmpty(l); break;
    case 'isTrue': held = l === true; break;
    case 'isFalse': held = l === false; break;
    // Two times are equal when they name one instant, or are as long.
    case 'equals': held = evTimeOrder(l, r) === 0 || evDeepEqual(l, r); break;
    case 'equalsAny':
      // Membership is repeated equality – a null left is simply not a
      // member unless listed – and an empty list holds for nothing
      // (negated: for everything), which the advisory said ahead of
      // time. A non-list right (a defect the advisories flag) wraps to
      // one entry rather than erroring: a defective model evaluates.
      held = evAsList(r).some((entry) => evTimeOrder(l, entry) === 0 || evDeepEqual(l, entry));
      break;
    case 'countEquals': held = evAsList(l).length === r; break;
    case 'countLessThan': held = evAsList(l).length < r; break;
    case 'countGreaterThan': held = evAsList(l).length > r; break;
    case 'contains':
      // No value is no text: a string holds no null in it (String(null)
      // is "null", which "annulled" did). A list may hold one.
      held = typeof l === 'string'
        ? r !== null && r !== undefined && l.includes(String(r))
        : evAsList(l).some((element) => evDeepEqual(element, r));
      break;
    case 'containsAny': {
      const right_ = evAsList(r);
      held = evAsList(l).some((element) => right_.some((other) => evDeepEqual(element, other)));
      break;
    }
    case 'lessThan':
    case 'lessThanOrEquals':
    case 'greaterThan':
    case 'greaterThanOrEquals':
      // `null < 3` would coerce to `0 < 3` and quietly hold – an unset
      // optional has no place in an ordering, and saying so beats
      // ranking it as zero.
      if (l === null || l === undefined || r === null || r === undefined) {
        return fail(`"${conditionText(condition)}" orders against no value (null) – an ordering needs both sides.`);
      }
      {
        // Two times by the instants they name or by length (11.0) – a
        // datetime's text would order `11:30+02:00` after `10:00Z`.
        const order = evTimeOrder(l, r);
        const [a, b] = order === null ? [l, r] : [order, 0];
        if (condition.predicate === 'lessThan') held = a < b;
        else if (condition.predicate === 'lessThanOrEquals') held = a <= b;
        else if (condition.predicate === 'greaterThan') held = a > b;
        else held = a >= b;
      }
      break;
    case 'startsWith':
    case 'endsWith':
      held = l !== null && l !== undefined && r !== null && r !== undefined
        && String(l)[condition.predicate](String(r));
      break;
    default:
      return fail(`"${condition.predicate}" is not a predicate this can check.`);
  }

  return condition.negate ? !held : held;
}

// The aliases a condition reads that hold more than one instance. All
// of them share one fan root – validation refuses a condition
// quantified over two unrelated lists – so they are read side by side.
function evFannedAliasesOf(condition, scope) {
  const out = [];
  for (const operand of conditionOperands(condition)) {
    if (operandSource(operand) !== 'alias-property') continue;
    const binding = evBound(operand.alias, scope);
    if (binding && binding.fanned && !out.includes(operand.alias)) out.push(operand.alias);
  }
  return out;
}

function evCheckCondition(model, body, condition, scope) {
  const fannedAliases = evFannedAliasesOf(condition, scope);
  // A read in place that fans out quantifies the same way an alias
  // does: folded once (`scope.inline`), then read at the index.
  const fannedReads = conditionOperands(condition)
    .filter((operand) => operandSource(operand) === 'projection-read' && readFanTag(operand));
  for (const read of fannedReads) evReadOperand(read, scope);
  const inlineOf = (read) => scope.inline.get(evInlineKey(read, scope));
  const fannedSources = [
    ...fannedAliases.map((alias) => scope.bound[alias]),
    ...fannedReads.map(inlineOf),
  ];

  // A zipped parameter is read at the index the instance was fanned out
  // from – the instance's own position for a fan over a list, the
  // index of the element it was reached through for a chained one.
  const sourceIndexAt = (index) => {
    const indexes = fannedSources[0].sourceIndexes;
    return indexes && indexes[index] !== undefined ? indexes[index] : index;
  };

  const readAt = (operand, index) => {
    if (index === null) return evReadOperand(operand, scope);
    const source = operandSource(operand);
    if (source === 'alias-property' && fannedAliases.includes(operand.alias)) {
      const bound = scope.bound[operand.alias];
      return evField(bound.kind === 'projection' ? bound.instances[index].value : bound.instances[index].read(operand, scope),
        operand.field);
    }
    if (source === 'projection-read' && fannedReads.includes(operand)) {
      return evField(inlineOf(operand).instances[index].value, operand.field);
    }
    if (source === 'parameter' && isZipped(model, body, condition, operand)) {
      return evAsList(evReadOperand(operand, scope))[sourceIndexAt(index)];
    }
    return evReadOperand(operand, scope);
  };

  const check = (index) => {
    const left = readAt(condition.leftHandSide, index);
    const right = condition.rightHandSide === undefined
      ? undefined
      : readAt(condition.rightHandSide, index);
    return { held: evApplyPredicate(condition, left, right), left, right, index };
  };

  if (!fannedSources.length) return check(null);

  const lengths = fannedSources.map((source) => source.instances.length);
  if (uniq(lengths).length > 1) {
    fail(
      `Condition "${conditionText(condition)}" reads ${[...fannedAliases, ...fannedReads.map(operandText)].join(' and ')} ` +
      'together, but they hold different numbers of instances, so there is no pairing to check.'
    );
  }
  // Quantified over nothing is vacuously true – a course with no
  // subscribers cannot double-book any of them.
  for (let index = 0; index < lengths[0]; index++) {
    // The dry run reads every instance; see `evDecide`.
    if (scope.collect) {
      try { check(index); } catch (error) { /* stepped over */ }
      continue;
    }
    const outcome = check(index);
    if (!outcome.held) return outcome;
  }
  return { held: true, index: null };
}

// A condition: a predicate, checked as above, or a combination of
// them. `and` checks its parts in written order and stops at the first
// that fails; `or` stops at the first that holds – so a read in a later
// part is made only when the earlier ones leave the answer open, as
// a read in a later step is. A refusal by a combination reports the
// part that decided it: the failing part of an `and`, and nothing of
// an `or`, where every part failed. The dry run checks every part.
function evCheck(model, body, condition, scope) {
  if (!isCompoundCondition(condition)) return evCheckCondition(model, body, condition, scope);
  const all = Array.isArray(condition.all);
  for (const part of conditionMembers(condition)) {
    if (scope.collect) {
      try { evCheck(model, body, part, scope); } catch (error) { /* stepped over */ }
      continue;
    }
    const outcome = evCheck(model, body, part, scope);
    if (outcome.held !== all) return all ? outcome : { held: true, index: null };
  }
  return all ? { held: true, index: null } : { held: false, index: null };
}

// ============================================================
// Evaluating a command.
// ============================================================

// `(model, events, commandName, args)` in, one outcome out:
//
//   { outcome: 'published', events, reads, arms }
//   { outcome: 'rejected', failedRule, reads, arms }
//
// The discriminator is there from the start so that publishing an
// alternative event on refusal – a rejection that also carries events –
// is a change to what a `rejected` outcome holds rather than a change
// to the shape every stored scenario was written in.
//
// `reads` is what the decision read – the reads it *made*, which since
// reads are lazy (11.0) are the ones its path through the steps
// reached, not every read the command might make: the boundary of this
// run, where `deriveDcb` (model.js) is the boundary of every run.
// Nothing stored in a scenario's expected outcome keeps it; the sandbox
// shows it, because "what did this command see when it decided" is the
// question a step raises. `arms` names each branch arm the run took
// (`armKey`, model.js) – what tells the scenarios that show each way a
// command succeeds apart (`commandSuccessesOwed`).
function evaluateCommand(model, events, commandName, args) {
  if (typeof events === 'function') return evDecideThroughPort(model, events, commandName, args);
  return evDecide(model, events || [], commandName, args, false);
}

// One decision over `events` – a log, or the fold-by-fold port
// `evDecideThroughPort` serves. `collect` is that driver's dry run: it
// only wants to see which reads the decision might make, so it walks
// all of them – every step, every arm of every branch, past every
// refusal, every instance of a quantified rule – and steps over
// whatever fails. Its outcome is discarded.
//
// The steps run top-down (11.0): a rule that does not hold, or a
// `reject` reached, ends the run refused and with no events; an
// emission reached joins the one append; a branch runs its first arm
// whose condition holds, or `otherwise`.
function evDecide(model, events, commandName, args, collect) {
  const body = evOwn(model['command-definitions'], commandName);
  if (!body) fail(`This model has no command "${commandName}".`);

  const supplied = args || {};
  const log = events;
  // `model`, `body` and `events` ride along for a read made from inside
  // an operand; `inline` holds what a read in place folded, `bound` what
  // an alias did. `args` and `bound` are keyed by authored names, so
  // have no prototype (see evOwn).
  const scope = {
    args: Object.create(null), bound: Object.create(null), inline: new Map(), resolving: new Set(),
    model, body, events: log, collect, loop: null,
  };
  // In the dry run a step that fails is stepped over, not reported.
  const attempt = (step) => {
    if (!collect) return step();
    try { return step(); } catch (error) { return undefined; }
  };
  for (const property of body.properties || []) {
    if (evOwn(supplied, property.name) === undefined) {
      // An optional property may be unset. `null` is the one spelling
      // of "no value" downstream, so the lenient read normalizes here:
      // an absent key and an explicit null reach every condition and
      // emission identically. An optional *list* is a modelling slip
      // the advisories point out; it evaluates as a plain list.
      if (property.isOptional && !property.isList) {
        scope.args[property.name] = null;
        continue;
      }
      fail(`"${commandName}" needs a value for "${property.name}".`);
    }
    scope.args[property.name] = evNormalize(evOwn(supplied, property.name));
  }
  // A time given is a time (11.0): a datetime without an offset names
  // no instant, and nothing could compare it.
  const untimely = payloadTimeProblems(model, body.properties, scope.args)[0];
  if (untimely) fail(`"${commandName}" was given ${untimely.name}: ${untimely.problem}`);

  // A read nothing consults – the parameterless projection a command
  // binds to be serialised – is made up front: it is there for its
  // boundary, and no step would ever ask for it.
  const references = bindingReferences(model, body);
  for (const binding of body.boundary || []) {
    if (!binding || !binding.alias) continue;
    const reasons = references.get(binding.alias) || new Set();
    if (['rule', 'emission', 'chain'].some((reason) => reasons.has(reason))) continue;
    attempt(() => evBound(binding.alias, scope));
  }

  const ruleIndex = new Map(commandRules(body).map((rule, index) => [rule, index]));
  const published = [];
  const arms = [];
  // `failedRule` describes the refusal: `rejection` is what it is known
  // by; `index` (among the command's rules, in written order), `path`
  // (the step's place, `forEachStep`) and `text` say which step it was,
  // for the interface – a scenario keeps none of them (`deriveThen`).
  const refusal = (step, path, outcome) => ({
    index: stepKind(step) === 'rule' ? ruleIndex.get(step) : null,
    path,
    rejection: stepKind(step) === 'reject' ? step.reject
      : step.rejection === undefined ? null : step.rejection,
    text: stepKind(step) === 'reject' ? `reject ${JSON.stringify(step.reject)}` : conditionText(step.condition),
    leftValue: outcome.left === undefined ? null : outcome.left,
    rightValue: outcome.right === undefined ? null : outcome.right,
    // Which instance refused it, when the rule was quantified.
    atInstance: outcome.index === null || outcome.index === undefined ? null : outcome.index,
  });

  const emit = (emission) => {
    if (!emission.name) return;
    const definition = evOwn(model['event-definitions'], emission.name);
    if (!definition) {
      fail(`"${commandName}" publishes "${emission.name}", which this model does not define.`);
    }
    const data = {};
    for (const property of definition.properties || []) {
      const operand = evOwn(emission.parameters, property.name);
      if (operand === undefined) {
        // An optional event property needs no mapping. The published
        // payload still carries the key, holding the explicit null –
        // canonical form, so a stored event always spells out every
        // property its definition declares.
        if (property.isOptional && !property.isList) {
          data[property.name] = null;
          continue;
        }
        fail(`"${commandName}" publishes "${emission.name}" without a value for "${property.name}".`);
      }
      data[property.name] = attempt(() => evReadOperand(operand, scope));
    }
    published.push({ type: emission.name, data });
  };

  // Runs `steps`; a refusal comes back, getting through is null.
  const run = (steps, path) => {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const at = [...path, index];
      switch (stepKind(step)) {
        case 'rule': {
          const outcome = attempt(() => evCheck(model, body, step.condition, scope));
          if (collect || outcome.held) break;
          return refusal(step, at, outcome);
        }
        case 'reject':
          if (collect) break;
          return refusal(step, at, {});
        case 'emit':
          if (collect) attempt(() => emit(step));
          else emit(step);
          break;
        case 'branch': {
          for (const arm of stepArms(step)) {
            if (collect) {
              if (arm.condition !== undefined) attempt(() => evCheck(model, body, arm.condition, scope));
              run(arm.steps, [...at, arm.index]);
              continue;
            }
            if (arm.condition !== undefined && !evCheck(model, body, arm.condition, scope).held) continue;
            if (!arms.includes(armKey(at, arm.index))) arms.push(armKey(at, arm.index));
            const refused = run(arm.steps, [...at, arm.index]);
            if (refused) return refused;
            break;
          }
          break;
        }
        // Once per element, each in scope by the loop's names; the
        // payload and an enclosing scope come back after.
        case 'loop': {
          const elements = attempt(() => evLoopElements(model, step, scope)) || [];
          const outer = { args: scope.args, loop: scope.loop };
          for (const element of elements) {
            scope.args = Object.assign(Object.create(null), outer.args, element.names);
            scope.loop = { names: Object.keys(element.names), value: element.value, hasValue: element.hasValue };
            let refused;
            try {
              refused = run(loopSteps(step), [...at, 'each']);
            } finally {
              scope.args = outer.args;
              scope.loop = outer.loop;
            }
            if (refused) return refused;
          }
          break;
        }
        default:
          break;
      }
    }
    return null;
  };

  // Described at each way out rather than here, because a binding
  // reports the properties the decision *depended on* – and it has not
  // depended on any of them until the steps have run.
  const refused = run(commandSteps(body), []);
  if (refused) {
    return { outcome: 'rejected', events: [], failedRule: refused, reads: evDescribeReads(scope), arms };
  }
  return { outcome: 'published', events: published, reads: evDescribeReads(scope), arms };
}

// A decision through a read port, asking the store as few times as the
// boundary allows: once per round of reads, never once per fold. The
// dry runs fetch what any way through the steps might read; the query
// the result carries is what the deciding run read, so the append
// condition follows the reads made, not the reads fetched.
//
// Which reads a round makes is a question only evaluation answers – a
// read's tags are the command's arguments, fanned out, excluded, or an
// answer from the round before – so it is answered by evaluating. A dry
// run (`evDecide` collecting) records every query its folds ask that
// nothing fetched yet answers, and gets nothing back for them; the
// queries are merged by their tags – types are ORed within a DCB query
// item, so two items with the same tags are exactly one with both type
// lists – and asked in one call. The next dry run then reads the round
// those answers unlock, and so on until a run asks for nothing new: a
// command whose reads all hang off its arguments asks once, a chained
// one once per link. A dry run's guesses cost bandwidth, never
// correctness: the decision is the run after them, over fetched events
// only.
//
// The result carries `query`, the items the deciding run read – what an
// append condition has to cover.
const EV_MAX_READ_ROUNDS = 64;

function evDecideThroughPort(model, read, commandName, args) {
  const keyOf = (tags) => JSON.stringify([...tags].sort());
  const fetched = new Map();
  let asked = new Map();
  let missing = new Map();
  const note = (into, tags, types) => {
    const key = keyOf(tags);
    if (!into.has(key)) into.set(key, { tags: [...tags].sort(), types: new Set() });
    for (const type of types) into.get(key).types.add(type);
  };
  const port = (items) => items.flatMap(({ types, tags }) => {
    note(asked, tags, types);
    const have = fetched.get(keyOf(tags));
    if (have && types.every((type) => have.types.has(type))) {
      return have.events.filter((event) => types.includes(event.type));
    }
    note(missing, tags, types);
    return [];
  });

  for (let rounds = 0; ; rounds++) {
    missing = new Map();
    try { evDecide(model, port, commandName, args, true); } catch (error) { /* the deciding run reports it */ }
    if (!missing.size) break;
    if (rounds === EV_MAX_READ_ROUNDS) fail(`"${commandName}" kept asking for more reads.`);
    // A tag set asked again with more types is fetched again whole, so
    // every fold over it reads one answer.
    const items = [...missing.values()].map(({ tags, types }) => ({
      tags,
      types: [...new Set([...((fetched.get(keyOf(tags)) || {}).types || []), ...types])].sort(),
    }));
    const answered = read(items) || [];
    for (const item of items) {
      fetched.set(keyOf(item.tags), {
        types: new Set(item.types),
        events: answered.filter((event) => item.types.includes(event.type) && evMatchesTags(model, event, item.tags)),
      });
    }
  }

  asked = new Map();
  missing = new Map();
  const result = evDecide(model, port, commandName, args, false);
  if (missing.size) throw new Error(`"${commandName}" read past what its dry runs fetched.`);
  return { ...result, query: [...asked.values()].map(({ tags, types }) => ({ tags, types: [...types].sort() })) };
}

// The boundary as a plain value – every instance it bound and every
// property that was actually read while deciding. Only what the fold
// touched appears, because that is what the command consulted.
function evDescribeReads(scope) {
  const out = {};
  for (const [alias, binding] of Object.entries(scope.bound)) {
    if (binding.kind === 'projection') {
      out[alias] = {
        kind: 'projection',
        projection: binding.projection,
        tags: binding.tags || [],
        arguments: binding.arguments || {},
        value: binding.value,
      };
      continue;
    }
    // A group's instances, each with the members the decision read –
    // keyed by local name, or `name(args…)` where the member took
    // arguments – and nothing it did not.
    out[alias] = {
      kind: 'group',
      group: binding.group,
      ...(binding.tag ? { tag: { name: binding.tag.name, type: binding.tag.tagType } } : {}),
      fanned: binding.fanned,
      instances: binding.instances.map((instance) => {
        const properties = {};
        for (const [name, value] of instance.cache || []) properties[name] = value;
        return { id: instance.id, properties };
      }),
    };
  }
  // An inline read has no alias; it is reported under how it reads.
  for (const read of scope.inline.values()) {
    const said = Object.fromEntries(read.tags.map((t) => [t.name, t.open ? { open: true } : { tagType: t.type, tagValue: t.value }]));
    out[operandText({ projection: read.projection, tags: said })] = {
      kind: 'projection',
      projection: read.projection,
      inline: true,
      tags: read.tags,
      arguments: read.arguments,
      value: read.value,
      ...(read.open ? { open: true, instances: read.instances } : {}),
    };
  }
  return out;
}


// ============================================================
// Scenarios.
//
// A scenario stores what the definitions made of its Given and When at
// the moment it was accepted. Running one derives that again and
// compares: agreement is `current`, disagreement is `drifted`, and a
// scenario that cannot be run at all is `broken`.
//
// The three are not degrees of the same thing. Drift is answerable by
// reading the difference and accepting it; broken is answerable only by
// repairing the scenario, because there was no answer to compare. A
// count that mixed them would say less the more of them there were.
// ============================================================

// Key order is not information. A payload built here follows the order
// the event declares its properties in; one edited by hand may not, and
// nothing about the outcome changed because two keys swapped places.
function evCanonical(value) {
  if (Array.isArray(value)) return value.map(evCanonical);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = evCanonical(value[key]);
    return out;
  }
  return value === undefined ? null : value;
}

// A refusal is compared by its message alone (`deriveThen`): a rule
// moved by hand still refuses with what the scenario named. If the move
// made a rule with a *different* message refuse first, that is drift.
function evSameOutcome(a, b) {
  return JSON.stringify(evCanonical(a)) === JSON.stringify(evCanonical(b));
}

// The Given, as the evaluator reads a log.
function scenarioLog(scenario) {
  return (scenario.given || []).map((step) => ({
    type: step.event,
    data: step.data || {},
  }));
}

// What the current definitions make of this scenario – the same shape
// that gets stored as its Then.
function deriveThen(model, scenario) {
  // A Given written against definitions that have since moved is not a
  // scenario that fails – it is one that cannot be run. Without this
  // the fold would simply not match an event it no longer recognises,
  // and a deleted event would report as agreement rather than as the
  // repair it actually needs.
  (scenario.given || []).forEach((step, index) => {
    const definition = evOwn(model['event-definitions'], (step || {}).event);
    if (!definition) {
      fail(`Given step ${index + 1} records "${(step || {}).event}", which this model no longer defines.`);
    }
    for (const property of definition.properties || []) {
      // An optional property legitimately absent is not an event the
      // scenario has fallen behind – the fold reads it as undefined.
      if (property.isOptional) continue;
      if (evOwn(step.data, property.name) === undefined) {
        fail(
          `Given step ${index + 1} ("${step.event}") carries no value for "${property.name}", ` +
          'which that event has gained since this scenario was written.'
        );
      }
    }
    const untimely = payloadTimeProblems(model, definition.properties, step.data)[0];
    if (untimely) fail(`Given step ${index + 1} ("${step.event}") carries ${untimely.name}: ${untimely.problem}`);
  });

  const result = evaluateCommand(
    model, scenarioLog(scenario), scenario.command, (scenario.when || {}).arguments
  );
  if (result.outcome === 'published') {
    return { outcome: 'published', events: result.events.map((e) => ({ type: e.type, data: e.data })) };
  }
  // A refusal is its message and nothing else: which rule refused, and
  // what it read, are how the decision was made, not what it was – so
  // rules sharing a message are one outcome, and a projection storing
  // its state differently is no change in behaviour. A refusal a
  // scenario cannot name is not an outcome it can assert: the rule has
  // no message, and the repair is the rule's, so the scenario is broken.
  const { rejection, text } = result.failedRule;
  if (rejectionProblem(rejection)) {
    fail(`"${scenario.command}" was refused by "${text}", which has no rejection message to test against.`);
  }
  return { outcome: 'rejected', events: [], rejection };
}

// What a command's scenarios leave unshown (11.0) – the scenarios it
// owes and has not got: `succeeds`, each way it succeeds that no
// scenario shows (`commandSuccessesOwed`, model.js – one per arm that
// emits, or one in all without branches), and `rejections`, each
// message no scenario is refused with. Only a scenario that holds shows
// anything: one that drifted asserts what the command no longer does,
// and one that cannot run asserts nothing it can show.
function commandCoverageGaps(model, commandName) {
  const body = evOwn(model['command-definitions'], commandName);
  if (!body) return { succeeds: [], rejections: [] };
  const runs = [];
  for (const scenario of Object.values(model['scenario-definitions'] || {})) {
    if (!scenario || scenario.command !== commandName) continue;
    if (runScenario(model, scenario).status !== 'current') continue;
    try {
      runs.push(evaluateCommand(model, scenarioLog(scenario), commandName, (scenario.when || {}).arguments));
    } catch (error) { /* broken – it shows nothing */ }
  }
  const published = runs.filter((run) => run.outcome === 'published');
  const refusedWith = new Set(runs.filter((run) => run.outcome === 'rejected').map((run) => run.failedRule.rejection));
  return {
    succeeds: commandSuccessesOwed(body).filter(({ arm }) => (arm === null
      ? !published.length : !published.some((run) => (run.arms || []).includes(arm)))),
    rejections: commandRejections(body).map(({ rejection }) => rejection).filter((message) => !refusedWith.has(message)),
  };
}

// A way to succeed, as a gap names it: "emit X when …", "emit X
// otherwise", or – without branches – plain success.
function successOwedText(owed) {
  const events = (owed.events || []).join(', ');
  if (owed.arm === null) return 'succeed';
  if (owed.condition === undefined) return `emit ${events} otherwise`;
  return `emit ${events} when ${conditionText(owed.condition)}`;
}

// Why something could not be worked out. An EvaluationError is a
// sentence written for the modeller; anything else is a defect in the
// model this file did not foresee. Both are an *error* – a scenario
// broken, a card saying so – rather than escaping: the scenario runners
// and the sandbox evaluate while the page renders, and an imported
// model must not be able to take that down.
function evaluationFailure(error) {
  if (error instanceof EvaluationError) return error.message;
  return `The model is malformed here: ${evErrorText(error)}`;
}

// `{ status, expected, actual, reason }`. `reason` is set only when the
// scenario is broken, and is the sentence to show instead of a
// difference.
function runScenario(model, scenario) {
  const expected = scenario.then || null;
  let actual;
  try {
    actual = deriveThen(model, scenario);
  } catch (error) {
    return { status: 'broken', expected, actual: null, reason: evaluationFailure(error) };
  }
  return {
    status: evSameOutcome(actual, expected) ? 'current' : 'drifted',
    expected,
    actual,
  };
}

// What the current definitions make of this projection scenario – the
// same shape that gets stored as its Then: the value its one projection
// folds to, over the Given. `scenarioLog` reads the Given unchanged – a
// projection scenario's is the same shape a command scenario's is.
//
// There is nothing to say about *which* of several reads to fold any
// more: a scenario is about one projection, and its Then is that
// projection's value. What used to be a scenario asserting four
// properties of a course is four scenarios sharing a Given, each
// answerable and each drifting on its own.
function deriveProjectionScenarioThen(model, spec) {
  // A Given written against definitions that have since moved is not a
  // scenario that fails – it is one that cannot be run. See deriveThen
  // for why this is checked ahead of the fold rather than left to fall
  // out of it as a silent, empty match.
  (spec.given || []).forEach((step, index) => {
    const definition = evOwn(model['event-definitions'], (step || {}).event);
    if (!definition) {
      fail(`Given step ${index + 1} records "${(step || {}).event}", which this model no longer defines.`);
    }
    for (const property of definition.properties || []) {
      // An optional property legitimately absent is not an event the
      // scenario has fallen behind – the fold reads it as undefined.
      if (property.isOptional) continue;
      if (evOwn(step.data, property.name) === undefined) {
        fail(
          `Given step ${index + 1} ("${step.event}") carries no value for "${property.name}", ` +
          'which that event has gained since this scenario was written.'
        );
      }
    }
    const untimely = payloadTimeProblems(model, definition.properties, step.data)[0];
    if (untimely) fail(`Given step ${index + 1} ("${step.event}") carries ${untimely.name}: ${untimely.problem}`);
  });

  if (!evOwn(projectionsOf(model), spec.projection)) {
    fail(`This scenario is about "${spec.projection}", which this model no longer defines.`);
  }
  const tags = {};
  for (const [name, tag] of Object.entries(spec.tags || {})) tags[name] = tag && tag.tagValue;
  return foldProjection(model, scenarioLog(spec), spec.projection, { tags, args: spec.arguments || {} });
}

// `{ status, expected, actual, reason }` – the projection analogue of
// runScenario.
function runProjectionScenario(model, spec) {
  // `null` and `[]` are values a projection really holds, so what the
  // scenario expects is read with `in` rather than by truthiness.
  const expected = 'then' in spec ? spec.then : null;
  let actual;
  try {
    actual = deriveProjectionScenarioThen(model, spec);
  } catch (error) {
    return { status: 'broken', expected, actual: null, reason: evaluationFailure(error) };
  }
  return {
    status: evSameOutcome(actual, expected) ? 'current' : 'drifted',
    expected,
    actual,
  };
}

// ============================================================
// Through a store.
//
// The read port answers a decision's reads; this is the cycle around
// it against a DCB event store – what dcb-runtime runs, and what the
// playground can show call by call. A store is
//
//   head()                    → the last position, undefined when empty
//   read(query)               → [{ position, event: { type, data, tags } }]
//   append(events, condition) → { position } | { integrity: true }
//
// in the DCB specification's shapes, positions as numbers; any throw is
// the store failing. One attempt:
//
//   one read    read(query) → decide → after = last position read
//               → append(events, failIfEventsMatch: query, after)
//   more        head → after → reads 1…n → decide
//               → append(events, failIfEventsMatch: all reads, after)
//
// Taking `after` from the reads when there are several would lose an
// update: an event matching read 1 that lands before read 2 returns
// would sit below it. Whether a command reads more than once is known
// from its boundary's queries (`boundarySummary` – the chain of aliases
// and the inline reads tagged by them); should a second read come
// unannounced anyway, the decision restarts with head.
//
// **One attempt, no retry.** An append whose condition fails is a
// `conflict`: the caller may decide again. How often, and how long to
// wait in between, is timing – and this file is synchronous and owns no
// clock, so the loop belongs to whoever does.
//
// `trace`, an array, receives every call as it happens – `{ call,
// …what was asked, …what came back }`, `failed` when it threw – and a
// `{ restart: 'head' }` where the decision started over.
// ============================================================

class EvStoreFailure extends Error {}
const EV_RESTART_WITH_HEAD = Symbol('restart with head');

function evStoreCall(record, call, asked, invoke) {
  try {
    return invoke();
  } catch (error) {
    record({ call, ...asked, failed: evErrorText(error) });
    throw new EvStoreFailure(`${call}: ${evErrorText(error)}`);
  }
}

function evHead(store, record) {
  const position = evStoreCall(record, 'head', {}, () => store.head());
  record({ call: 'head', position });
  return position;
}

// A read port over the store; `last` is the highest position it saw,
// `cut` a position nothing after which is folded.
function evStorePort(store, record, { cut, onRead } = {}) {
  const port = (items) => {
    if (onRead) onRead();
    const query = items.map(({ types, tags }) => ({ types: [...types], tags: [...tags] }));
    const answered = evStoreCall(record, 'read', { query }, () => store.read(query));
    record({ call: 'read', query, events: answered });
    return answered
      .filter(({ position }) => !cut || (cut.at !== undefined && position <= cut.at))
      .map(({ position, event }) => {
        if (port.last === undefined || position > port.last) port.last = position;
        return { type: event.type, data: event.data };
      });
  };
  port.last = undefined;
  return port;
}

function evDecideFromStore(model, store, commandName, args, withHead, record) {
  const after = withHead ? evHead(store, record) : undefined;
  let reads = 0;
  const port = evStorePort(store, record, {
    onRead: () => { if (++reads > 1 && !withHead) throw EV_RESTART_WITH_HEAD; },
  });
  const result = evaluateCommand(model, port, commandName, args);
  return { result, after: withHead ? after : port.last };
}

// One attempt at a command against `store`:
//
//   { outcome: 'published', events: [{ type, data, tags }], position, reads }
//   { outcome: 'rejected', failedRule, reads }
//   { outcome: 'conflict', condition }   the append lost the race
//   { outcome: 'error', message }        the command cannot be decided
//   { outcome: 'store', message }        the store failed
//
// A command that publishes nothing is not appended, and one that reads
// nothing appends without a condition: it has nothing to be consistent
// with.
function handleCommand(model, store, commandName, args, { trace } = {}) {
  const record = trace ? (entry) => trace.push(entry) : () => {};
  const body = evOwn(model['command-definitions'], commandName);
  let decided;
  try {
    const chained = !!body && commandPlan(boundarySummary(model, body)).after === 'head';
    try {
      decided = evDecideFromStore(model, store, commandName, args, chained, record);
    } catch (error) {
      if (error !== EV_RESTART_WITH_HEAD) throw error;
      record({ restart: 'head' });
      decided = evDecideFromStore(model, store, commandName, args, true, record);
    }
  } catch (error) {
    if (error instanceof EvStoreFailure) return { outcome: 'store', message: error.message };
    return { outcome: 'error', message: evErrorText(error) };
  }
  const { result, after } = decided;
  if (result.outcome === 'rejected') return { outcome: 'rejected', failedRule: result.failedRule, reads: result.reads };
  const events = result.events.map((event) => ({
    type: event.type,
    data: event.data,
    tags: tagsOfEvent(model, event.type, event.data),
  }));
  if (!events.length) return { outcome: 'published', events, position: undefined, reads: result.reads };
  const query = result.query.map(({ types, tags }) => ({ types, tags }));
  const condition = query.length ? { failIfEventsMatch: query, after } : undefined;
  let appended;
  try {
    appended = evStoreCall(record, 'append', { events, condition }, () => store.append(events, condition));
  } catch (error) {
    return { outcome: 'store', message: error.message };
  }
  record({ call: 'append', events, condition, ...appended });
  if (appended && appended.integrity) return { outcome: 'conflict', condition };
  return { outcome: 'published', events, position: appended.position, reads: result.reads };
}

// A projection folded from `store`, read by `params` – its tags and its
// arguments, by name:
//
//   { outcome: 'projected', value, position }   the last position folded
//   { outcome: 'error', message } | { outcome: 'store', message }
//
// One read – or, a derived projection reading one per operand, head
// first and every read cut off at it, so the operands are folded as of
// one position rather than each as of its own.
function projectFromStore(model, store, projectionName, params, { trace } = {}) {
  const record = trace ? (entry) => trace.push(entry) : () => {};
  const body = evOwn(projectionsOf(model), projectionName);
  if (!body) return { outcome: 'error', message: `This model has no projection "${projectionName}".` };
  try {
    const cut = derivedOf(body) ? { at: evHead(store, record) } : null;
    const port = evStorePort(store, record, { cut });
    const tags = {};
    const args = {};
    for (const tag of projectionTagParams(body)) tags[tag.name] = evOwn(params, tag.name);
    for (const argument of body.arguments || []) args[argument.name] = evOwn(params, argument.name);
    const value = evNormalize(foldProjection(model, port, projectionName, { tags, args }));
    return { outcome: 'projected', value, position: port.last };
  } catch (error) {
    if (error instanceof EvStoreFailure) return { outcome: 'store', message: error.message };
    return { outcome: 'error', message: evErrorText(error) };
  }
}

// A DCB event store in memory – for the playground, and for tests.
//
// A query item's `types`, when it has them, are the types an event may
// have, at least one: the specification asks that an event's type match
// one of the provided types, so an empty list would match nothing, and
// a store taking it for "any type" would turn a fold that reads nothing
// into a condition on everything. It is refused as the mistake it is.
// An item without `types` matches any type. Its tags must all be
// carried.
const EMPTY_TYPES = 'A query item with an empty types list matches nothing – leave types out to match any type.';
function memoryStore(seed = []) {
  const events = [];
  const push = (event) => { events.push({ position: events.length + 1, event }); };
  const checked = (query) => {
    if (query.some((item) => Array.isArray(item.types) && !item.types.length)) throw new Error(EMPTY_TYPES);
    return query;
  };
  const matches = (query, event) => query.some((item) =>
    (!item.types || item.types.includes(event.type))
    && (item.tags || []).every((tag) => event.tags.includes(tag)));
  seed.forEach(push);
  return {
    events,
    push,
    head: () => (events.length ? events[events.length - 1].position : undefined),
    read: (query) => events.filter(({ event }) => matches(checked(query), event)),
    append(newEvents, condition) {
      if (condition) checked(condition.failIfEventsMatch);
      if (condition && events.some(({ position, event }) =>
        (condition.after === undefined || position > condition.after) && matches(condition.failIfEventsMatch, event))) {
        return { integrity: true };
      }
      newEvents.forEach(push);
      return { position: events.length };
    },
  };
}

// Loadable both as a classic script – the way the playground loads
// everything, so it opens from the filesystem without a server – and as
// a module, so this can be exercised outside a browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EvaluationError,
    evaluationFailure,
    evaluateCommand,
    foldProjection,
    tagsOfEvent,
    deriveThen,
    runScenario,
    scenarioLog,
    deriveProjectionScenarioThen,
    runProjectionScenario,
    handleCommand,
    projectFromStore,
    memoryStore,
  };
}
