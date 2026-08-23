// ============================================================
// DCB Playground — evaluation layer.
//
// `model.js` says what a definition *means*; this says what it *does*.
// Given a context, a log of events and a command with its arguments,
// it resolves the boundary, folds every projection the boundary reads,
// checks the conditions and returns either the events the command
// publishes or the rule that refused it.
//
// Nothing here touches the DOM, `localStorage` or the event log the
// playground stores its own history in. It takes a context object and
// a list of events and returns a value — which is what makes it usable
// from a scenario, from the sandbox, and eventually from a worker,
// without any of them knowing about the others.
//
// **Closures, not generated code.** Every handler compiles to a small
// JavaScript function `(state, event, args) => state`, one per handler
// per projection, built by walking the declarative operand tree and
// closing over it. A scripted handler compiles to a function of the
// *same signature* through `new Function`, so the fold engine never
// branches on whether a projection is scripted — the difference is
// gone by the time anything folds. What this deliberately avoids is
// emitting source: a generated fold would be a third copy of semantics
// that `deriveDcb` and validation already hold, and the only copy of
// the three you could not read, grep or breakpoint.
//
// **Scripts run on the main thread, unsandboxed.** The contract is the
// one the schema states: each body is an expression over `state`,
// `event` and `args` returning the next state. A body that loops
// forever hangs the tab, and nothing here can stop it — the whole
// model lives in `localStorage`, so the cost of that is a reload
// rather than lost work. What follows from it is a rule the *callers*
// have to keep: never evaluate a scripted projection unprompted. An
// automatic run at startup that hangs leaves no way back in to fix the
// script that hung it.
//
// **Failure has two kinds and they are not the same.** A command whose
// conditions do not hold is *rejected* — an ordinary, expected outcome
// this returns. A scenario that cannot be run at all — an event that no
// longer exists, an argument the command never got, a script that threw
// — is *broken*, and comes back as an `EvaluationError`. Real bugs in
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

// ============================================================
// Values.
//
// One normal form, applied at every edge. A status is stored as
// `{enumMember: 'Existent'}` in initial values, in handler operands and
// in conditions alike; carrying that wrapper into the fold would mean
// every predicate unwrapping it again, so it is unwrapped once, here,
// and a status is a string everywhere downstream.
// ============================================================

function evNormalize(value) {
  if (value !== null && typeof value === 'object' && value.enumMember !== undefined) {
    return value.enumMember;
  }
  return value;
}

function evDeepEqual(a, b) {
  const x = evNormalize(a);
  const y = evNormalize(b);
  if (x === y) return true;
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false;
  return JSON.stringify(x) === JSON.stringify(y);
}

// The successor of a value, for the operand that mints identifiers.
// Integers step by one; a string ending in digits steps its trailing
// run and keeps the width it was written with, so `c1` becomes `c2` and
// `inv-009` becomes `inv-010`. Anything else has no successor, which
// validation already refuses — reaching it here means a body was
// written past the validator.
function evSuccessor(value) {
  const v = evNormalize(value);
  if (typeof v === 'number') return v + 1;
  if (typeof v === 'string') {
    const match = /^(.*?)(\d+)$/.exec(v);
    if (match) {
      const next = String(Number(match[2]) + 1);
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

// ============================================================
// Tags.
//
// Which events belong to an instance. Tags are never declared: an event
// property typed with an entity's identifier *is* a tag on that event,
// a composite contributes one per identifier field, and a list of
// composites one per identifier field per element. That is exactly what
// `idLeavesOfType` already computes for the derived DCB, so the query
// a boundary displays and the query a fold actually runs come from one
// place and cannot drift apart.
// ============================================================

function tagsOfEvent(ctx, eventName, data) {
  const definition = ctx['event-definitions'][eventName];
  if (!definition) return [];
  const tags = new Set();
  for (const property of definition.properties || []) {
    const leaves = idLeavesOfType(ctx, property.propertyType);
    if (!leaves.length) continue;
    const held = (data || {})[property.name];
    const elements = property.isList ? evAsList(held) : [held];
    for (const element of elements) {
      if (element === null || element === undefined) continue;
      for (const leaf of leaves) {
        const value = leaf.field === null ? element : (element || {})[leaf.field];
        if (value === null || value === undefined) continue;
        tags.add(`${leaf.entity}:${value}`);
      }
    }
  }
  return [...tags];
}

function evMatchesTags(ctx, event, tags) {
  if (!tags.length) return true;
  const carried = tagsOfEvent(ctx, event.type, event.data);
  return tags.every((tag) => carried.includes(tag));
}

// ============================================================
// Compiling a fold.
//
// A projection — an entity property or a standalone one — becomes three
// things: the state it starts from, a step function per event type, and
// the reading a condition sees. Declared and scripted projections
// produce the same three, which is the point: below this line nothing
// knows the difference.
// ============================================================

// A handler operand, as a function of the state and the event it is
// folding. These are the operands only a handler may use — a condition
// gets a different set, because a condition may not read the envelope.
function evCompileHandlerOperand(operand) {
  switch (operandSource(operand)) {
    case 'event-property':
      return (state, event) => (event.data || {})[operand.eventProperty];
    case 'event-metadata':
      return (state, event) => (event.metadata || {})[operand.eventMetadata];
    case 'current-value':
      return (state) => state;
    case 'successor': {
      const inner = evCompileHandlerOperand(operand.successor);
      return (state, event) => evSuccessor(inner(state, event));
    }
    case 'enum-member':
      return () => operand.enumMember;
    default:
      return () => evNormalize(operand);
  }
}

// One handler, as `(state, event, args) => nextState`.
function evCompileHandler(handler, label) {
  if (handler.code !== undefined) {
    // The contract the schema states, and the only place in this file
    // where authored JavaScript runs.
    let body;
    try {
      body = new Function('state', 'event', 'args', `return (${handler.code}\n);`);
    } catch (error) {
      fail(`The script for "${handler.event}" on ${label} does not parse: ${error.message}`);
    }
    return (state, event, args) => {
      try {
        return body(state, event, args);
      } catch (error) {
        return fail(`The script for "${handler.event}" on ${label} threw: ${error.message}`);
      }
    };
  }

  const valueOf = evCompileHandlerOperand(handler.value);
  const where = `The handler for "${handler.event}" on ${label}`;

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

// A projection or entity property, compiled once and folded many times.
function evCompileTarget(ctx, target, label) {
  const script = scriptOf(target);
  const steps = new Map();
  for (const handler of target.handlers || []) {
    if (!handler || !handler.event) continue;
    steps.set(handler.event, evCompileHandler(handler, label));
  }

  const initial = script
    ? deepClone(script.initialState)
    : (target.initialValue === undefined
      ? evNormalize(defaultInitialValue(ctx, target))
      : evNormalize(target.initialValue));

  // What a condition reads. A script may keep bookkeeping the boundary
  // never sees; `exposes` names the one field that reaches it.
  const expose = script && script.exposes !== undefined
    ? (state) => (state === null || state === undefined ? state : state[script.exposes])
    : (state) => state;

  return {
    types: [...steps.keys()],
    fold(events, args) {
      let state = initial;
      for (const event of events) {
        const step = steps.get(event.type);
        if (step) state = step(state, event, args || {});
      }
      return evNormalize(expose(state));
    },
  };
}

// ============================================================
// Folding.
//
// Both entries replay from the start of the log every time. That is the
// same choice the playground already makes for its own state, and it
// stays until something measured says otherwise — an incremental fold
// only helps scrubbing forwards, and pays for it with a snapshot
// regime that a replay does not need.
// ============================================================

// One property of one entity instance. The events are those carrying
// the instance's tag; the compiled steps ignore the rest.
function foldEntityProperty(ctx, events, entityName, propertyName, instanceId, args) {
  const entity = ctx['entity-definitions'][entityName];
  if (!entity) fail(`This context has no entity "${entityName}".`);
  const property = (entity.properties || []).find((p) => p.name === propertyName);
  if (!property) fail(`"${entityName}" has no property "${propertyName}".`);

  const compiled = evCompileTarget(ctx, property, `${entityName}.${propertyName}`);
  const tag = `${entityName}:${instanceId}`;
  return compiled.fold(
    events.filter((event) => evMatchesTags(ctx, event, [tag])),
    args
  );
}

// One standalone projection, at one partition. A declared projection's
// parameters *are* its tags, so the arguments a command supplied for
// them select the events; a scripted one states its tags itself, with
// those same arguments interpolated. Declare no parameters and there is
// no tag, which is what a global numbering is.
function foldProjection(ctx, events, projectionName, argumentValues) {
  const projection = ctx['projection-definitions'][projectionName];
  if (!projection) fail(`This context has no projection "${projectionName}".`);

  const values = argumentValues || {};
  const script = scriptOf(projection);
  const tags = script
    ? (script.tagFilter || []).map((template) =>
      String(template).replace(TAG_PLACEHOLDER_RE, (whole, name) =>
        (values[name] === undefined ? whole : String(evNormalize(values[name])))))
    : (projection.parameters || []).map((parameter) => {
      const entity = entityOfIdType(ctx, parameter.propertyType);
      const value = values[parameter.name];
      if (value === undefined) {
        fail(`Projection "${projectionName}" was read without its parameter "${parameter.name}".`);
      }
      return `${entity || parameter.propertyType}:${evNormalize(value)}`;
    });

  const compiled = evCompileTarget(ctx, projection, `projection "${projectionName}"`);
  return compiled.fold(
    events.filter((event) => evMatchesTags(ctx, event, tags)),
    values
  );
}

// ============================================================
// Command scope.
//
// What a command's operands can see: its own arguments, and whatever
// the boundary has bound so far. An entity binding may hold one
// instance or many — the boundary is resolved in rounds, and a later
// round may read an earlier one, so this grows as the rounds run.
// ============================================================

function evEntityInstance(ctx, events, entityName, id, args) {
  const cache = new Map();
  return {
    id,
    // Exposed so the boundary can be reported afterwards as the set of
    // properties the decision actually depended on.
    cache,
    read(propertyName) {
      if (!cache.has(propertyName)) {
        cache.set(propertyName, foldEntityProperty(ctx, events, entityName, propertyName, id, args));
      }
      return cache.get(propertyName);
    },
  };
}

// An operand as a command reads it: whole, with no iteration index
// applied. Reading a property off a plural alias yields one value per
// instance, and a list read that way flattens — a list of lists is not
// a shape anything downstream can use.
function evReadOperand(operand, scope) {
  switch (operandSource(operand)) {
    case 'parameter': {
      const held = scope.args[operand.parameterName];
      if (held === undefined) {
        fail(`This command was given no value for "${operand.parameterName}".`);
      }
      if (!operand.property) return evNormalize(held);
      const value = evNormalize(held);
      return Array.isArray(value)
        ? value.map((element) => (element || {})[operand.property])
        : (value || {})[operand.property];
    }
    case 'alias-property': {
      const binding = scope.bound[operand.alias];
      if (!binding) fail(`Nothing in this boundary is bound as "${operand.alias}".`);
      if (binding.kind === 'projection') {
        if (operand.property) {
          fail(`"${operand.alias}" reads a projection, which holds one value and has no properties.`);
        }
        return binding.value;
      }
      if (!operand.property) {
        fail(`"${operand.alias}" is an entity, so reading it needs a property.`);
      }
      if (!binding.fanned) return binding.instances[0].read(operand.property);
      const each = binding.instances.map((instance) => instance.read(operand.property));
      return each.some(Array.isArray) ? each.flat() : each;
    }
    case 'enum-member':
      return operand.enumMember;
    default:
      return evNormalize(operand);
  }
}

// ============================================================
// The boundary.
// ============================================================

function evResolveBinding(ctx, events, body, binding, scope) {
  if (binding.projection) {
    const values = {};
    for (const [name, operand] of Object.entries(binding.arguments || {})) {
      values[name] = evReadOperand(operand, scope);
    }
    scope.bound[binding.alias] = {
      kind: 'projection',
      projection: binding.projection,
      value: foldProjection(ctx, events, binding.projection, values),
    };
    return;
  }

  if (!ctx['entity-definitions'][binding.entity]) {
    fail(`Binding "${binding.alias}" reads entity "${binding.entity}", which this context does not define.`);
  }

  const values = {};
  for (const [name, operand] of Object.entries(binding.arguments || {})) {
    values[name] = evReadOperand(operand, scope);
  }

  const fanned = isFannedOut(ctx, body, binding);
  const held = evReadOperand(binding.id, scope);
  // Order is preserved and duplicates are kept: a binding fanned from a
  // list parameter is read at the same index as that parameter, and
  // collapsing it would silently pair a line of the cart with the wrong
  // one's price.
  let ids = fanned ? evAsList(held) : [held];

  if (binding.excluding !== undefined) {
    const excluded = evAsList(evReadOperand(binding.excluding, scope));
    ids = ids.filter((id) => !excluded.some((other) => evDeepEqual(id, other)));
  }

  scope.bound[binding.alias] = {
    kind: 'entity',
    entity: binding.entity,
    fanned,
    instances: ids.map((id) => evEntityInstance(ctx, events, binding.entity, evNormalize(id), values)),
  };
}

// ============================================================
// Conditions.
//
// A condition over a plural alias holds when it holds for every
// instance. Where a list parameter is read beside an alias fanned out
// from that very list, the two are read at the same index — `zipped`,
// in the language `model.js` uses for it — so each product is checked
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
    case 'equals': held = evDeepEqual(l, r); break;
    case 'countEquals': held = evAsList(l).length === r; break;
    case 'countLessThan': held = evAsList(l).length < r; break;
    case 'countGreaterThan': held = evAsList(l).length > r; break;
    case 'contains':
      held = typeof l === 'string'
        ? l.includes(String(r))
        : evAsList(l).some((element) => evDeepEqual(element, r));
      break;
    case 'containsAny': {
      const right_ = evAsList(r);
      held = evAsList(l).some((element) => right_.some((other) => evDeepEqual(element, other)));
      break;
    }
    case 'lessThan': held = l < r; break;
    case 'lessThanOrEquals': held = l <= r; break;
    case 'greaterThan': held = l > r; break;
    case 'greaterThanOrEquals': held = l >= r; break;
    case 'startsWith': held = String(l).startsWith(String(r)); break;
    case 'endsWith': held = String(l).endsWith(String(r)); break;
    default:
      return fail(`"${condition.predicate}" is not a predicate this can check.`);
  }

  return condition.negate ? !held : held;
}

// The aliases a condition reads that hold more than one instance. All
// of them share one fan root — validation refuses a condition
// quantified over two unrelated lists — so they are read side by side.
function evFannedAliasesOf(condition, scope) {
  const out = [];
  for (const operand of conditionOperands(condition)) {
    if (operandSource(operand) !== 'alias-property') continue;
    const binding = scope.bound[operand.alias];
    if (binding && binding.kind === 'entity' && binding.fanned && !out.includes(operand.alias)) {
      out.push(operand.alias);
    }
  }
  return out;
}

function evCheckCondition(ctx, body, condition, scope) {
  const fannedAliases = evFannedAliasesOf(condition, scope);

  const readAt = (operand, index) => {
    if (index === null) return evReadOperand(operand, scope);
    const source = operandSource(operand);
    if (source === 'alias-property' && fannedAliases.includes(operand.alias)) {
      return scope.bound[operand.alias].instances[index].read(operand.property);
    }
    if (source === 'parameter' && isZipped(ctx, body, condition, operand)) {
      return evAsList(evReadOperand(operand, scope))[index];
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

  if (!fannedAliases.length) return check(null);

  const lengths = fannedAliases.map((alias) => scope.bound[alias].instances.length);
  if (uniq(lengths).length > 1) {
    fail(
      `Condition "${conditionText(condition)}" reads ${fannedAliases.join(' and ')} together, ` +
      'but they hold different numbers of instances, so there is no pairing to check.'
    );
  }
  // Quantified over nothing is vacuously true — a course with no
  // subscribers cannot double-book any of them.
  for (let index = 0; index < lengths[0]; index++) {
    const outcome = check(index);
    if (!outcome.held) return outcome;
  }
  return { held: true, index: null };
}

// ============================================================
// Evaluating a command.
// ============================================================

// `(ctx, events, commandName, args)` in, one outcome out:
//
//   { outcome: 'published', events, reads }
//   { outcome: 'rejected', failedRule, reads }
//
// The discriminator is there from the start so that publishing an
// alternative event on refusal — a rejection that also carries events —
// is a change to what a `rejected` outcome holds rather than a change
// to the shape every stored scenario was written in.
//
// `reads` is what the boundary resolved to. Nothing stored in a
// scenario's expected outcome keeps it; the sandbox shows it, because
// "what did this command see when it decided" is the question a step
// raises.
function evaluateCommand(ctx, events, commandName, args, options) {
  const body = ctx['command-definitions'][commandName];
  if (!body) fail(`This context has no command "${commandName}".`);

  const supplied = args || {};
  const scope = { args: {}, bound: {} };
  for (const property of body.properties || []) {
    if (supplied[property.name] === undefined) {
      fail(`"${commandName}" needs a value for "${property.name}".`);
    }
    scope.args[property.name] = evNormalize(supplied[property.name]);
  }

  const log = events || [];
  for (const round of deriveRounds(body)) {
    for (const { binding } of round) evResolveBinding(ctx, log, body, binding, scope);
  }

  // Described at each way out rather than here, because a binding
  // reports the properties the decision *depended on* — and it has not
  // depended on any of them until the conditions have run.
  const conditions = body.conditions || [];
  for (let index = 0; index < conditions.length; index++) {
    const condition = conditions[index];
    if (!condition) continue;
    const outcome = evCheckCondition(ctx, body, condition, scope);
    if (outcome.held) continue;
    return {
      outcome: 'rejected',
      events: [],
      failedRule: {
        index,
        text: conditionText(condition),
        leftValue: outcome.left === undefined ? null : outcome.left,
        rightValue: outcome.right === undefined ? null : outcome.right,
        // Which instance refused it, when the rule was quantified.
        atInstance: outcome.index === null ? null : outcome.index,
      },
      reads: evDescribeReads(scope),
    };
  }

  const published = [];
  for (const emission of body.publishes || []) {
    if (!emission || !emission.name) continue;
    const definition = ctx['event-definitions'][emission.name];
    if (!definition) {
      fail(`"${commandName}" publishes "${emission.name}", which this context does not define.`);
    }
    const data = {};
    for (const property of definition.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      if (operand === undefined) {
        fail(`"${commandName}" publishes "${emission.name}" without a value for "${property.name}".`);
      }
      data[property.name] = evReadOperand(operand, scope);
    }
    const event = { type: emission.name, data };
    if (options && options.recordedAt !== undefined) {
      event.metadata = { recordedAt: options.recordedAt };
    }
    published.push(event);
  }

  return { outcome: 'published', events: published, reads: evDescribeReads(scope) };
}

// The boundary as a plain value — every instance it bound and every
// property that was actually read while deciding. Only what the fold
// touched appears, because that is what the command consulted.
function evDescribeReads(scope) {
  const out = {};
  for (const [alias, binding] of Object.entries(scope.bound)) {
    if (binding.kind === 'projection') {
      out[alias] = { kind: 'projection', projection: binding.projection, value: binding.value };
      continue;
    }
    out[alias] = {
      kind: 'entity',
      entity: binding.entity,
      fanned: binding.fanned,
      instances: binding.instances.map((instance) => {
        const properties = {};
        // `read` memoises, so re-reading here costs nothing and reports
        // exactly the properties the decision depended on.
        for (const [name, value] of instance.cache || []) properties[name] = value;
        return { id: instance.id, properties };
      }),
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

function evSameOutcome(a, b) {
  return JSON.stringify(evCanonical(a)) === JSON.stringify(evCanonical(b));
}

// The Given, as the evaluator reads a log. The stored instant becomes
// the envelope, which is what makes a projection that reads
// `recordedAt` replay to the same state every time.
function scenarioLog(scenario) {
  return (scenario.given || []).map((step) => ({
    type: step.event,
    data: step.data || {},
    metadata: { recordedAt: step.recordedAt },
  }));
}

// What the current definitions make of this scenario — the same shape
// that gets stored as its Then. Published events carry no envelope:
// the instant one would be appended at is not a property of the
// decision, and comparing it would report the clock as drift.
function deriveThen(ctx, scenario) {
  // A Given written against definitions that have since moved is not a
  // scenario that fails — it is one that cannot be run. Without this
  // the fold would simply not match an event it no longer recognises,
  // and a deleted event would report as agreement rather than as the
  // repair it actually needs.
  (scenario.given || []).forEach((step, index) => {
    const definition = ctx['event-definitions'][(step || {}).event];
    if (!definition) {
      fail(`Given step ${index + 1} records "${(step || {}).event}", which this context no longer defines.`);
    }
    for (const property of definition.properties || []) {
      if (!((step.data || {})[property.name] !== undefined)) {
        fail(
          `Given step ${index + 1} ("${step.event}") carries no value for "${property.name}", ` +
          'which that event has gained since this scenario was written.'
        );
      }
    }
  });

  const result = evaluateCommand(
    ctx, scenarioLog(scenario), scenario.command, (scenario.when || {}).arguments
  );
  return result.outcome === 'published'
    ? { outcome: 'published', events: result.events.map((e) => ({ type: e.type, data: e.data })) }
    : { outcome: 'rejected', events: [], failedRule: result.failedRule };
}

// Whether anything this scenario would run is scripted. Callers use it
// to decide what may run unprompted: a script that loops forever hangs
// the tab, and a hang while running scenarios on load leaves no way
// back in to fix the script that caused it.
function scenarioTouchesScript(ctx, scenario) {
  const command = ctx['command-definitions'][scenario.command];
  if (!command) return false;
  for (const item of deriveDcb(ctx, command).items) {
    if (item.projection) {
      if (scriptOf(ctx['projection-definitions'][item.projection])) return true;
      continue;
    }
    const binding = (command.boundary || []).find((b) => b && b.alias === item.alias);
    const entity = binding && ctx['entity-definitions'][binding.entity];
    if (!entity) continue;
    for (const property of entity.properties || []) {
      if (item.readProperties.includes(property.name) && scriptOf(property)) return true;
    }
  }
  return false;
}

// `{ status, expected, actual, reason }`. `reason` is set only when the
// scenario is broken, and is the sentence to show instead of a
// difference.
function runScenario(ctx, scenario) {
  const expected = scenario.then || null;
  let actual;
  try {
    actual = deriveThen(ctx, scenario);
  } catch (error) {
    if (error instanceof EvaluationError) {
      return { status: 'broken', expected, actual: null, reason: error.message };
    }
    throw error;
  }
  return {
    status: evSameOutcome(actual, expected) ? 'current' : 'drifted',
    expected,
    actual,
  };
}

// What the current definitions make of this property scenario — the
// same shape that gets stored as its Then: one value per property a
// modeler chose to check, folded from the Given for the one instance
// `forInstance` names. `scenarioLog` reads it unchanged — a property
// scenario's Given is the same shape a command scenario's is.
function derivePropertyScenarioThen(ctx, spec, propertyNames) {
  // A Given written against definitions that have since moved is not a
  // property scenario that fails — it is one that cannot be run. See
  // deriveThen for why this is checked ahead of the fold rather than
  // left to fall out of it as a silent, empty match.
  (spec.given || []).forEach((step, index) => {
    const definition = ctx['event-definitions'][(step || {}).event];
    if (!definition) {
      fail(`Given step ${index + 1} records "${(step || {}).event}", which this context no longer defines.`);
    }
    for (const property of definition.properties || []) {
      if (!((step.data || {})[property.name] !== undefined)) {
        fail(
          `Given step ${index + 1} ("${step.event}") carries no value for "${property.name}", ` +
          'which that event has gained since this property scenario was written.'
        );
      }
    }
  });

  const events = scenarioLog(spec);
  const then = {};
  for (const propertyName of propertyNames) {
    then[propertyName] = foldEntityProperty(ctx, events, spec.entity, propertyName, spec.forInstance, {});
  }
  return then;
}

// Whether anything this property scenario would run is scripted — the
// entity-property analogue of scenarioTouchesScript, simpler because a
// property scenario names its entity directly rather than reaching one
// through a command's boundary.
function propertyScenarioTouchesScript(ctx, spec) {
  const entity = ctx['entity-definitions'][spec.entity];
  if (!entity) return false;
  return Object.keys(spec.then || {}).some((propertyName) => {
    const property = (entity.properties || []).find((p) => p.name === propertyName);
    return property && scriptOf(property);
  });
}

// `{ status, expected, actual, reason }` — the entity-property analogue
// of runScenario. `actual` is derived over the same property set the
// last accepted Then checked, so a property deleted since surfaces as
// broken rather than silently changing what is compared.
function runPropertyScenario(ctx, spec) {
  const expected = spec.then || null;
  let actual;
  try {
    actual = derivePropertyScenarioThen(ctx, spec, Object.keys(expected || {}));
  } catch (error) {
    if (error instanceof EvaluationError) {
      return { status: 'broken', expected, actual: null, reason: error.message };
    }
    throw error;
  }
  return {
    status: evSameOutcome(actual, expected) ? 'current' : 'drifted',
    expected,
    actual,
  };
}

// Loadable both as a classic script — the way the playground loads
// everything, so it opens from the filesystem without a server — and as
// a module, so this can be exercised outside a browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EvaluationError,
    evaluateCommand,
    foldEntityProperty,
    foldProjection,
    tagsOfEvent,
    deriveThen,
    runScenario,
    scenarioLog,
    scenarioTouchesScript,
    derivePropertyScenarioThen,
    runPropertyScenario,
    propertyScenarioTouchesScript,
  };
}
