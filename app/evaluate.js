// ============================================================
// DCB Playground — evaluation layer.
//
// `model.js` says what a definition *means*; this says what it *does*.
// Given a model, a log of events and a command with its arguments,
// it resolves the boundary, folds every projection the boundary reads,
// checks the conditions and returns either the events the command
// publishes or the rule that refused it.
//
// Nothing here touches the DOM, `localStorage` or the event log the
// playground stores its own history in. It takes a model object and
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
// **Scripts run on the main thread, unsandboxed — and unprompted.**
// The contract is the one the schema states: each body is an
// expression over `state`, `event` and `args` returning the next
// state. A scripted projection folds wherever and whenever a declared
// one would, repaints included. What stands between an untrusted
// model and that is the import gate (nothing external loads without a
// confirmation — index.html), and what stands between a hanging
// script and a page that hangs again on every reload is safe mode:
// `setScriptsDisabled(true)` — flipped by the interface for a `?safe`
// URL — compiles every script handler to a thrower instead, so the
// model still loads and the script can be reached and fixed.
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
  // Canonicalised first: two records carrying the same fields are the
  // same value no matter what order they were authored in — the rule
  // evSameOutcome already applies to scenario comparison.
  return JSON.stringify(evCanonical(x)) === JSON.stringify(evCanonical(y));
}

// The successor of a value, for the operand that mints identifiers.
// Integers step by one; a string ending in digits steps its trailing
// run and keeps the width it was written with, so `c1` becomes `c2` and
// `inv-009` becomes `inv-010`. Anything else has no successor, which
// validation already refuses — reaching it here means a body was
// written past the validator.
function evSuccessor(value) {
  const v = evNormalize(value);
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return fail(
      'A composite identifier has no successor — auto-incrementing makes sense for a single ' +
      'value, and a composite is a record of them.'
    );
  }
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

function tagsOfEvent(model, eventName, data) {
  const definition = model['event-definitions'][eventName];
  if (!definition) return [];
  const tags = new Set();
  for (const property of definition.properties || []) {
    const leaves = idLeavesOfType(model, property.propertyType);
    if (!leaves.length) continue;
    const held = (data || {})[property.name];
    const elements = property.isList ? evAsList(held) : [held];
    for (const element of elements) {
      if (element === null || element === undefined) continue;
      for (const leaf of leaves) {
        const value = leaf.field === null ? element : (element || {})[leaf.field];
        if (value === null || value === undefined) continue;
        tags.add(renderTag(identifierTypeOf(model, leaf.identifierType), String(value)));
      }
    }
  }
  return [...tags];
}

function evMatchesTags(model, event, tags) {
  if (!tags.length) return true;
  const carried = tagsOfEvent(model, event.type, event.data);
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
// folding. `event-property` is only available to a handler — a
// condition gets a different operand set.
function evCompileHandlerOperand(operand) {
  switch (operandSource(operand)) {
    case 'event-property':
      return (state, event) => (event.data || {})[operand.eventProperty];
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

// Safe mode. Flipped by the interface for a `?safe` URL (and by tests
// directly): every script handler compiles to a thrower, so a model
// whose script hangs the tab on load can still be opened, edited and
// repaired. Declared handlers are untouched — this is a way back in,
// not a mode the app runs in.
let evScriptsDisabled = false;
function setScriptsDisabled(disabled) { evScriptsDisabled = !!disabled; }

// One handler, as `(state, event, args) => nextState`.
function evCompileHandler(handler, label) {
  if (handler.code !== undefined) {
    if (evScriptsDisabled) {
      return () => fail(
        `The script for "${handler.event}" on ${label} did not run: scripts are off in safe mode. ` +
        'Remove "?safe" from the address to run them.'
      );
    }
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
function evCompileTarget(model, target, label) {
  const script = scriptOf(target);
  const steps = new Map();
  for (const handler of target.handlers || []) {
    if (!handler || !handler.event) continue;
    steps.set(handler.event, evCompileHandler(handler, label));
  }

  const initial = script
    ? deepClone(script.initialState)
    : (target.initialValue === undefined
      ? evNormalize(defaultInitialValue(model, target))
      : evNormalize(target.initialValue));

  // What a condition reads. A script may keep bookkeeping the boundary
  // never sees; `exposes` names the one field that reaches it.
  const expose = script && script.exposes !== undefined
    ? (state) => (state === null || state === undefined ? state : state[script.exposes])
    : (state) => state;

  const run = (events, args) => {
    let state = initial;
    for (const event of events) {
      const step = steps.get(event.type);
      if (step) state = step(state, event, args || {});
    }
    return state;
  };

  return {
    types: [...steps.keys()],
    fold: (events, args) => evNormalize(expose(run(events, args))),
    // The same fold read before `exposes` trims it: the whole state,
    // bookkeeping included. Hidden from conditions — a statement about
    // the boundary, not about the person watching the script work.
    foldState: (events, args) => evNormalize(run(events, args)),
  };
}

// ============================================================
// Folding.
//
// There is one fold, `foldProjection`, and one way into it. Reading an
// entity's property used to be a second entry with a partition of its
// own — derived from the entity rather than supplied — and the two
// agreeing was a thing that had to keep being true. Now the property is
// a binding, so it fills in an argument and calls the same function:
// nothing left to disagree.
//
// `foldProjectionState` is not a second fold but a second reading of
// the same one: the state before `exposes` trims it to the exposed
// field. Without `exposes` the two answers coincide.
//
// It replays from the start of the log every time. That is the same
// choice the playground already makes for its own state, and it stays
// until something measured says otherwise — an incremental fold only
// helps scrubbing forwards, and pays for it with a snapshot regime that
// a replay does not need.
// ============================================================

// One property of one entity instance — which is one projection, read
// at the partition this instance names. The binding supplies the
// instance as the projection's identifier-typed parameter (or, for a
// scripted one, its identifier-typed argument), so this is
// `foldProjection` with that one argument filled in and nothing else
// different. There is no second fold path: an entity property and a
// standalone read reach the same code by the same route.
function foldEntityProperty(model, events, entityName, propertyName, instanceId, args) {
  const entity = model['entity-definitions'][entityName];
  if (!entity) fail(`This model has no entity "${entityName}".`);
  const binding = (entity.properties || []).find((p) => p && p.name === propertyName);
  if (!binding) fail(`"${entityName}" has no property "${propertyName}".`);

  const projection = model['projection-definitions'][binding.projection];
  if (!projection) {
    fail(`"${entityName}.${propertyName}" binds projection "${binding.projection}", which this model no longer defines.`);
  }
  const slot = entityIdSlotOf(model, entityName, projection);
  if (!slot) {
    fail(
      `"${entityName}.${propertyName}" binds "${binding.projection}", which has no ` +
      `${idTypeOf(model, entityName)}-typed slot for the instance.`
    );
  }
  return foldProjection(model, events, binding.projection, {
    ...(args || {}),
    [slot.name]: instanceId,
  });
}

// One standalone projection, at one partition. A declared projection's
// parameters *are* its tags, so the arguments a command supplied for
// them select the events; a scripted one states its tags itself, with
// those same arguments interpolated. Declare no parameters and there is
// no tag, which is what a global numbering is.
// The tags a projection's query carries for one concrete set of
// argument values. Extracted from `foldProjection` so the interface
// can *say* what a fold will read — a watched projection's query, with
// the actual values in it — without running the fold to find out.
function projectionQueryTags(model, projectionName, argumentValues) {
  const projection = model['projection-definitions'][projectionName];
  if (!projection) fail(`This model has no projection "${projectionName}".`);

  const values = argumentValues || {};
  const script = scriptOf(projection);
  // A tag filter's `:` is authoring syntax splitting "which identifier"
  // from "what value" — not the tag's actual separator, which is that
  // identifier type's own `tagSchema` and may differ. So the value half
  // is interpolated first, then rendered through `renderTag`, the same
  // path a declared parameter's tag takes below.
  return script
    ? (script.tagFilter || []).map((template) => {
      const match = TAG_FILTER_RE.exec(String(template || ''));
      if (!match) return String(template);
      // A placeholder names an argument, optionally reaching one field
      // into it — `{courseId.tenant}` for a composite identifier whose
      // tag comes from one of its leaves.
      const valueText = match[2].replace(TAG_PLACEHOLDER_RE, (whole, path) => {
        const [root, ...fields] = path.split('.');
        if (values[root] === undefined) return whole;
        const held = fields.reduce(
          (value, field) => (value === null || value === undefined ? value : value[field]),
          evNormalize(values[root])
        );
        return String(evNormalize(held));
      });
      const identifierType = identifierTypeOf(model, match[1]);
      return identifierType ? renderTag(identifierType, valueText) : `${match[1]}:${valueText}`;
    })
    : (projection.parameters || []).flatMap((parameter) => {
      const value = values[parameter.name];
      if (value === undefined) {
        fail(`Projection "${projectionName}" was read without its parameter "${parameter.name}".`);
      }
      const normalized = evNormalize(value);
      // A parameter is a tag, and null has no tag — "Type:null" would
      // be one phantom partition every unset value shares.
      if (normalized === null) {
        fail(`Projection "${projectionName}" was read with no value (null) for its parameter "${parameter.name}".`);
      }
      const leaves = idLeavesOfType(model, parameter.propertyType);
      if (!leaves.length) return [`${parameter.propertyType}:${normalized}`];
      // A composite parameter contributes the union of its components'
      // own tags — one per leaf, each rendered through that leaf's own
      // tagSchema, never renamespaced under the parameter's type.
      return leaves.map((leaf) => {
        const leafValue = leaf.field === null ? normalized : (normalized || {})[leaf.field];
        return renderTag(identifierTypeOf(model, leaf.identifierType), String(leafValue));
      });
    });
}

// Events reach a fold carrying an explicit key for every optional
// property their definition declares — null when unset. One spelling
// of "no value" downstream: a Given step may omit the key, an emission
// writes the null out, and a handler or script reads the same thing
// either way. Optional lists are exempt (they evaluate as plain
// lists; the advisories point the combination out).
function evWithExplicitOptionals(model, event) {
  const definition = model['event-definitions'][event.type];
  let data = event.data;
  for (const property of (definition || {}).properties || []) {
    if (!property.isOptional || property.isList) continue;
    if ((data || {})[property.name] !== undefined) continue;
    data = { ...(data || {}), [property.name]: null };
  }
  return data === event.data ? event : { ...event, data };
}

function foldProjection(model, events, projectionName, argumentValues) {
  const { compiled, selected, values } = evProjectionFold(model, events, projectionName, argumentValues);
  return compiled.fold(selected, values);
}

function foldProjectionState(model, events, projectionName, argumentValues) {
  const { compiled, selected, values } = evProjectionFold(model, events, projectionName, argumentValues);
  return compiled.foldState(selected, values);
}

function evProjectionFold(model, events, projectionName, argumentValues) {
  const projection = model['projection-definitions'][projectionName];
  if (!projection) fail(`This model has no projection "${projectionName}".`);

  const values = argumentValues || {};
  const tags = projectionQueryTags(model, projectionName, values);

  const compiled = evCompileTarget(model, projection, `projection "${projectionName}"`);
  const selected = events.filter((event) => evMatchesTags(model, event, tags))
    .map((event) => evWithExplicitOptionals(model, event));
  return { compiled, selected, values };
}

// ============================================================
// Command scope.
//
// What a command's operands can see: its own arguments, and whatever
// the boundary has bound so far. An entity binding may hold one
// instance or many — the boundary is resolved in rounds, and a later
// round may read an earlier one, so this grows as the rounds run.
// ============================================================

function evEntityInstance(model, events, entityName, id, args) {
  const cache = new Map();
  return {
    id,
    // Exposed so the boundary can be reported afterwards as the set of
    // properties the decision actually depended on.
    cache,
    read(propertyName) {
      if (!cache.has(propertyName)) {
        cache.set(propertyName, foldEntityProperty(model, events, entityName, propertyName, id, args));
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
  // The one array operand — `equalsAny`'s literal list — reads as its
  // entries, each normalized like any other literal.
  if (Array.isArray(operand)) return operand.map(evNormalize);
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
      if (!binding.fanned) {
        // An absent optional binding bound nothing; reading it yields
        // null — the one spelling of "no value" — rather than erroring.
        if (!binding.instances.length) return null;
        return binding.instances[0].read(operand.property);
      }
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

function evResolveBinding(model, events, body, binding, scope) {
  if (binding.projection) {
    const values = {};
    for (const [name, operand] of Object.entries(binding.arguments || {})) {
      values[name] = evReadOperand(operand, scope);
    }
    scope.bound[binding.alias] = {
      kind: 'projection',
      projection: binding.projection,
      // Kept beside the value because they are what makes it
      // reproducible: the value alone says what was read, and the
      // arguments say at which partition, which is the half a reader
      // needs to go and look at it themselves.
      arguments: values,
      value: foldProjection(model, events, binding.projection, values),
    };
    return;
  }

  if (!model['entity-definitions'][binding.entity]) {
    fail(`Binding "${binding.alias}" reads entity "${binding.entity}", which this model does not define.`);
  }

  const values = {};
  for (const [name, operand] of Object.entries(binding.arguments || {})) {
    values[name] = evReadOperand(operand, scope);
  }

  const fanned = isFannedOut(model, body, binding);
  const held = evReadOperand(binding.id, scope);
  // A null identifier binds nothing. Folding at "Entity:null" would
  // invent one phantom instance every unset value shares. A binding
  // flagged `isOptional` declares the absence expected and binds zero
  // instances instead: conditions over it hold vacuously and reading a
  // property of it yields null. Without the flag the error stays — an
  // unset identifier nobody declared possible is an accident, and this
  // is the error the optional-parameter advisory promises.
  if (!fanned && evNormalize(held) === null) {
    if (binding.isOptional) {
      scope.bound[binding.alias] = {
        kind: 'entity',
        entity: binding.entity,
        fanned: false,
        absent: true,
        sourceIndexes: [],
        instances: [],
      };
      return;
    }
    fail(`Binding "${binding.alias}" has no instance to read: ${operandText(binding.id)} is unset (null).`);
  }
  // Order is preserved and duplicates are kept: a binding fanned from a
  // list parameter is read at the same index as that parameter, and
  // collapsing it would silently pair a line of the cart with the wrong
  // one's price.
  const ids = fanned ? evAsList(held) : [held];

  // Each instance remembers the index it was fanned out from, because
  // a zipped parameter is read at *that* index — `excluding` compacts
  // the instance list, but it must not shift the pairing against the
  // list the fan came from.
  let entries = ids.map((id, sourceIndex) => ({ id, sourceIndex }));
  if (binding.excluding !== undefined) {
    const excludedHeld = evReadOperand(binding.excluding, scope);
    // Same rule as the identifier above: null is not "exclude
    // nothing", it is a value that never got supplied.
    if (evNormalize(excludedHeld) === null) {
      fail(`Binding "${binding.alias}" excludes ${operandText(binding.excluding)}, which is unset (null).`);
    }
    const excluded = evAsList(excludedHeld);
    entries = entries.filter(({ id }) => !excluded.some((other) => evDeepEqual(id, other)));
  }

  scope.bound[binding.alias] = {
    kind: 'entity',
    entity: binding.entity,
    fanned,
    sourceIndexes: entries.map((entry) => entry.sourceIndex),
    instances: entries.map(({ id }) => evEntityInstance(model, events, binding.entity, evNormalize(id), values)),
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
    case 'equalsAny':
      // Membership is repeated equality — a null left is simply not a
      // member unless listed — and an empty list holds for nothing
      // (negated: for everything), which the advisory said ahead of
      // time. A non-list right (a defect the advisories flag) wraps to
      // one entry rather than erroring: a defective model evaluates.
      held = evAsList(r).some((entry) => evDeepEqual(l, entry));
      break;
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
    case 'lessThan':
    case 'lessThanOrEquals':
    case 'greaterThan':
    case 'greaterThanOrEquals':
      // `null < 3` would coerce to `0 < 3` and quietly hold — an unset
      // optional has no place in an ordering, and saying so beats
      // ranking it as zero.
      if (l === null || l === undefined || r === null || r === undefined) {
        return fail(`"${conditionText(condition)}" orders against no value (null) — an ordering needs both sides.`);
      }
      if (condition.predicate === 'lessThan') held = l < r;
      else if (condition.predicate === 'lessThanOrEquals') held = l <= r;
      else if (condition.predicate === 'greaterThan') held = l > r;
      else held = l >= r;
      break;
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

function evCheckCondition(model, body, condition, scope) {
  // A condition reading an alias the boundary flagged optional and
  // could not bind holds vacuously — the same reading a fanned alias
  // with zero instances already gets. `skippedFor` names the alias, so
  // an interface can say the rule stepped aside rather than passed.
  for (const operand of conditionOperands(condition)) {
    if (operandSource(operand) !== 'alias-property') continue;
    const binding = scope.bound[operand.alias];
    if (binding && binding.kind === 'entity' && binding.absent) {
      return { held: true, index: null, skippedFor: operand.alias };
    }
  }

  const fannedAliases = evFannedAliasesOf(condition, scope);

  // The instance list may be compacted by `excluding`, so a zipped
  // parameter is read at the instance's original fan-out index, never
  // at its position in the compacted list.
  const sourceIndexAt = (index) => {
    const indexes = scope.bound[fannedAliases[0]].sourceIndexes;
    return indexes && indexes[index] !== undefined ? indexes[index] : index;
  };

  const readAt = (operand, index) => {
    if (index === null) return evReadOperand(operand, scope);
    const source = operandSource(operand);
    if (source === 'alias-property' && fannedAliases.includes(operand.alias)) {
      return scope.bound[operand.alias].instances[index].read(operand.property);
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

// `(model, events, commandName, args)` in, one outcome out:
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
function evaluateCommand(model, events, commandName, args) {
  const body = model['command-definitions'][commandName];
  if (!body) fail(`This model has no command "${commandName}".`);

  const supplied = args || {};
  const scope = { args: {}, bound: {} };
  for (const property of body.properties || []) {
    if (supplied[property.name] === undefined) {
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
    scope.args[property.name] = evNormalize(supplied[property.name]);
  }

  const log = events || [];
  for (const round of deriveRounds(body)) {
    for (const { binding } of round) evResolveBinding(model, log, body, binding, scope);
  }

  // Described at each way out rather than here, because a binding
  // reports the properties the decision *depended on* — and it has not
  // depended on any of them until the conditions have run.
  const conditions = body.conditions || [];
  for (let index = 0; index < conditions.length; index++) {
    const condition = conditions[index];
    if (!condition) continue;
    const outcome = evCheckCondition(model, body, condition, scope);
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
    const definition = model['event-definitions'][emission.name];
    if (!definition) {
      fail(`"${commandName}" publishes "${emission.name}", which this model does not define.`);
    }
    const data = {};
    for (const property of definition.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      if (operand === undefined) {
        // An optional event property needs no mapping. The published
        // payload still carries the key, holding the explicit null —
        // canonical form, so a stored event always spells out every
        // property its definition declares.
        if (property.isOptional && !property.isList) {
          data[property.name] = null;
          continue;
        }
        fail(`"${commandName}" publishes "${emission.name}" without a value for "${property.name}".`);
      }
      data[property.name] = evReadOperand(operand, scope);
    }
    published.push({ type: emission.name, data });
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
      out[alias] = {
        kind: 'projection',
        projection: binding.projection,
        arguments: binding.arguments || {},
        value: binding.value,
      };
      continue;
    }
    out[alias] = {
      kind: 'entity',
      entity: binding.entity,
      fanned: binding.fanned,
      // An optional binding whose identifier was unset — it bound
      // nothing, and the reader deserves to see that said, not an
      // empty list that looks like a fan-out over nothing.
      ...(binding.absent ? { absent: true } : {}),
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

// The Given, as the evaluator reads a log.
function scenarioLog(scenario) {
  return (scenario.given || []).map((step) => ({
    type: step.event,
    data: step.data || {},
  }));
}

// What the current definitions make of this scenario — the same shape
// that gets stored as its Then.
function deriveThen(model, scenario) {
  // A Given written against definitions that have since moved is not a
  // scenario that fails — it is one that cannot be run. Without this
  // the fold would simply not match an event it no longer recognises,
  // and a deleted event would report as agreement rather than as the
  // repair it actually needs.
  (scenario.given || []).forEach((step, index) => {
    const definition = model['event-definitions'][(step || {}).event];
    if (!definition) {
      fail(`Given step ${index + 1} records "${(step || {}).event}", which this model no longer defines.`);
    }
    for (const property of definition.properties || []) {
      // An optional property legitimately absent is not an event the
      // scenario has fallen behind — the fold reads it as undefined.
      if (property.isOptional) continue;
      if (!((step.data || {})[property.name] !== undefined)) {
        fail(
          `Given step ${index + 1} ("${step.event}") carries no value for "${property.name}", ` +
          'which that event has gained since this scenario was written.'
        );
      }
    }
  });

  const result = evaluateCommand(
    model, scenarioLog(scenario), scenario.command, (scenario.when || {}).arguments
  );
  return result.outcome === 'published'
    ? { outcome: 'published', events: result.events.map((e) => ({ type: e.type, data: e.data })) }
    : { outcome: 'rejected', events: [], failedRule: result.failedRule };
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

// What the current definitions make of this projection scenario — the
// same shape that gets stored as its Then: the value its one projection
// folds to, over the Given. `scenarioLog` reads the Given unchanged — a
// projection scenario's is the same shape a command scenario's is.
//
// There is nothing to say about *which* of several reads to fold any
// more: a scenario is about one projection, and its Then is that
// projection's value. What used to be a scenario asserting four
// properties of a course is four scenarios sharing a Given, each
// answerable and each drifting on its own.
function deriveProjectionScenarioThen(model, spec) {
  // A Given written against definitions that have since moved is not a
  // scenario that fails — it is one that cannot be run. See deriveThen
  // for why this is checked ahead of the fold rather than left to fall
  // out of it as a silent, empty match.
  (spec.given || []).forEach((step, index) => {
    const definition = model['event-definitions'][(step || {}).event];
    if (!definition) {
      fail(`Given step ${index + 1} records "${(step || {}).event}", which this model no longer defines.`);
    }
    for (const property of definition.properties || []) {
      // An optional property legitimately absent is not an event the
      // scenario has fallen behind — the fold reads it as undefined.
      if (property.isOptional) continue;
      if (!((step.data || {})[property.name] !== undefined)) {
        fail(
          `Given step ${index + 1} ("${step.event}") carries no value for "${property.name}", ` +
          'which that event has gained since this scenario was written.'
        );
      }
    }
  });

  if (!model['projection-definitions'][spec.projection]) {
    fail(`This scenario is about "${spec.projection}", which this model no longer defines.`);
  }
  return foldProjection(model, scenarioLog(spec), spec.projection, spec.arguments || {});
}

// `{ status, expected, actual, reason }` — the projection analogue of
// runScenario.
function runProjectionScenario(model, spec) {
  // `null` and `[]` are values a projection really holds, so what the
  // scenario expects is read with `in` rather than by truthiness.
  const expected = 'then' in spec ? spec.then : null;
  let actual;
  try {
    actual = deriveProjectionScenarioThen(model, spec);
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
    deriveProjectionScenarioThen,
    runProjectionScenario,
    projectionScenarioTouchesScript,
  };
}
