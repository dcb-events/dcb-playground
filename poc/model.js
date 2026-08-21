// ============================================================
// DCB Playground — model layer.
//
// The semantics behind `index.html`. Nothing here touches the DOM: it
// is the event log, the projection over it, type resolution, reference
// tracking, validation, DCB derivation, the editing commands and the
// predefined contexts.
//
// Loaded as a classic script (not a module) so the playground opens
// straight from the filesystem without a server.
//
// Two things here are not in the declarative language proper and are
// worth finding before reading anything else.
//
// The **event envelope**: every event carries metadata the modeller
// does not author and cannot remove — currently `recordedAt`, the
// instant it was appended. A handler may read it; a condition may not.
// A decision that consulted the clock would replay to a different
// verdict than it reached, so the envelope stays on the projecting
// side of the line and never reaches a boundary.
//
// **Scripted projections**: a property or a projection may replace its
// declarative handlers with code, one body per event type. This is the
// escape hatch for state whose accumulation cannot be declared —
// windows, running comparisons, anything needing a value the previous
// events implied rather than carried. It costs real validation: the
// code is stored and displayed but nothing here parses or runs it, so
// a scripted handler is checked for the events it claims and nothing
// more. What it deliberately does *not* cost is the derived DCB: the
// query still comes from the handler keys and the tags from the
// binding, so a scripted projection reads exactly as legibly in a
// boundary as a declared one.
//
// Command bodies carry an optional `feature`, naming the group a
// command belongs to. Nothing in the model reads it — it rides along
// untouched through validation, references and renames — and it is the
// one field a DCB Context carries that the modelled system does not
// read. See `CommandDefinition.feature` in dcb-context.schema.yaml.
// ============================================================

// ============================================================
// Constants.
// ============================================================
// Bumped whenever a stored definition changes shape. The log is the
// whole state, so an old log replayed against new validation would
// produce contexts this build refuses to save — a fresh key is honest
// about that where a silent migration would not be. v8 dropped
// property retention and a binding's `asOf`. v9 dropped the reserved
// `status` property and its entity-derived enum: a lifecycle is now an
// ordinary enum custom type plus an ordinary property, like any other.
const EVENT_LOG_KEY = 'dcb-playground:events:v10';

const DEF_KINDS = [
  'entity-definition',
  'event-definition',
  'projection-definition',
  'command-definition',
  'custom-type-definition',
  'scenario-definition',
  'specification-definition',
];
const DEF_COLLECTIONS = {
  'entity-definition': 'entity-definitions',
  'event-definition': 'event-definitions',
  'projection-definition': 'projection-definitions',
  'command-definition': 'command-definitions',
  'custom-type-definition': 'custom-type-definitions',
  'scenario-definition': 'scenario-definitions',
  'specification-definition': 'specification-definitions',
};
const KIND_COLOR_CLASS = {
  'entity-definition': 'entity',
  'event-definition': 'event',
  'projection-definition': 'projection',
  'command-definition': 'command',
  'custom-type-definition': 'custom-type',
  'scenario-definition': 'scenario',
  'specification-definition': 'scenario',
};

const KIND_SECTION_TITLE = {
  'entity-definition': 'Entities',
  'event-definition': 'Events',
  'projection-definition': 'Projections',
  'command-definition': 'Commands',
  'custom-type-definition': 'Custom Types',
  'scenario-definition': 'Scenarios',
  'specification-definition': 'Specifications',
};

// A scenario is identified by a generated id rather than by its name,
// which is the same shape a DCB Context itself has and for the same
// reason: its name is derived from what the command did and is the
// modeler's to overwrite, so two scenarios of one command may well want
// to be called the same thing. Every other definition kind is keyed by
// a name that *is* its identity, and renaming one is what moves every
// reference to it. A specification is the same shape for the same
// reason, one level down: it belongs to an entity rather than a
// command, but its name is still derived from what it found, not
// chosen up front.
const ID_KEYED_KINDS = ['scenario-definition', 'specification-definition'];

function isIdKeyed(kind) { return ID_KEYED_KINDS.includes(kind); }

// `timestamp` is an instant in whole seconds since the epoch. It is
// built in rather than a custom type because the tooling has to know a
// clock reading when it sees one — to type the envelope's `recordedAt`,
// and to offer date affordances over what is otherwise an anonymous
// integer. A context-declared `Timestamp` would make that recognition
// hang on a name the modeller happened to choose.
const SIMPLE_TYPES = ['boolean', 'integer', 'string', 'timestamp'];

// The envelope. Every event carries these alongside its payload,
// supplied by the store rather than by whatever emitted it, and no
// definition declares or removes them.
//
// A handler may read one; a condition may not. That asymmetry is the
// whole point: a projection that consults the clock still replays to
// the same state, because it reads the instant an event *was written*.
// A condition consulting the clock would decide differently on replay
// than it decided originally, which is the one thing a boundary may
// never do.
const EVENT_METADATA = [
  { name: 'recordedAt', propertyType: 'timestamp' },
];
// Nothing below enforces either of these: a lifecycle is an ordinary
// enum custom type plus an ordinary property, like any other. They
// exist purely as the convention the "new entity" scaffold offers —
// most entities want exactly this, and typing it out is the same
// every time.
const DEFAULT_STATUSES = ['NonExistent', 'Existent'];
const STATUS_PROPERTY = 'status';

const PASCAL_RE = /^[A-Z][A-Za-z0-9]+$/;
const CAMEL_RE = /^[a-z][A-Za-z0-9]+$/;

const UNARY_PREDICATES = ['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'];
const BINARY_PREDICATES = [
  'equals',
  'countEquals',
  'countLessThan',
  'countGreaterThan',
  'contains',
  'containsAny',
  'lessThan',
  'lessThanOrEquals',
  'greaterThan',
  'greaterThanOrEquals',
  'startsWith',
  'endsWith',
];
const PREDICATE_SYMBOL = {
  equals: '==',
  lessThan: '<',
  lessThanOrEquals: '<=',
  greaterThan: '>',
  greaterThanOrEquals: '>=',
};

const OPERATIONS = ['set', 'increment', 'decrement', 'append', 'remove'];

// ============================================================
// Event store (localStorage-backed append-only log).
// ============================================================

function loadEvents() {
  try {
    return JSON.parse(localStorage.getItem(EVENT_LOG_KEY) || '[]');
  } catch {
    return [];
  }
}

function appendEvents(newEvents) {
  const log = loadEvents();
  const startSeq = log.length;
  const stamped = newEvents.map((e, i) => ({
    sequence: startSeq + i,
    timestamp: new Date().toISOString(),
    type: e.type,
    data: e.data,
  }));
  localStorage.setItem(EVENT_LOG_KEY, JSON.stringify([...log, ...stamped]));
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================
// Projection: derive current state from the event log.
// Mirrors `dcb-context-overview` in the ESDM model.
// ============================================================

function emptyContext(id, name) {
  const ctx = { id, name };
  for (const kind of DEF_KINDS) ctx[DEF_COLLECTIONS[kind]] = {};
  return ctx;
}

function projectState() {
  const contexts = {};
  for (const event of loadEvents()) apply(contexts, event);
  return contexts;
}

function apply(contexts, event) {
  const { type, data } = event;
  const ctxId = data['dcb-context-id'];

  if (type === 'dcb-context-created') {
    contexts[ctxId] = emptyContext(ctxId, data.name);
    return;
  }
  if (type === 'dcb-context-renamed') {
    if (contexts[ctxId]) contexts[ctxId].name = data.name;
    return;
  }
  if (type === 'dcb-context-deleted') {
    delete contexts[ctxId];
    return;
  }

  const ctx = contexts[ctxId];
  if (!ctx) return;

  for (const kind of DEF_KINDS) {
    const coll = ctx[DEF_COLLECTIONS[kind]];
    if (type === `${kind}-added`) { coll[data.name] = data.body; return; }
    if (type === `${kind}-updated`) {
      if (coll[data.name] !== undefined) coll[data.name] = data.body;
      return;
    }
    if (type === `${kind}-renamed`) {
      const prev = coll[data['previous-name']];
      if (prev !== undefined) {
        delete coll[data['previous-name']];
        coll[data.name] = prev;
      }
      return;
    }
    if (type === `${kind}-removed`) { delete coll[data.name]; return; }
  }
}

// ============================================================
// Derived types.
//
// An entity brings `<Entity>Id` into existence. It is not stored
// anywhere: it is computed from the entity and resolved in the same
// namespace as declared custom (value) types. A lifecycle is not a
// derived type — a modeller who wants one declares an ordinary enum
// custom type and an ordinary property typed with it, by convention
// named `status`.
// ============================================================

function idTypeOf(entityName) { return entityName + 'Id'; }

function derivedTypes(ctx) {
  const out = {};
  for (const entityName of Object.keys(ctx['entity-definitions'])) {
    out[idTypeOf(entityName)] = { entity: entityName, role: 'id' };
  }
  return out;
}

// Classifies a type name against a context: simple, declared custom
// type, entity-derived, or unresolved.
function classifyType(ctx, typeName) {
  if (!typeName) return { kind: 'unresolved' };
  if (SIMPLE_TYPES.includes(typeName)) return { kind: 'simple' };
  const derived = derivedTypes(ctx)[typeName];
  if (derived) return { kind: 'derived', entity: derived.entity, role: derived.role };
  const custom = ctx['custom-type-definitions'][typeName];
  if (custom !== undefined) {
    return { kind: 'custom', composite: Array.isArray(custom && custom.properties) };
  }
  return { kind: 'unresolved' };
}

// The entity a type is the identifier of, or null. A projection
// parameter is always one of these — only an identifier is a tag.
function entityOfIdType(ctx, typeName) {
  const cls = classifyType(ctx, typeName);
  return cls.kind === 'derived' && cls.role === 'id' ? cls.entity : null;
}

// The fields of a composite value type, or null for anything else.
function compositeFieldsOf(ctx, typeName) {
  const cls = classifyType(ctx, typeName);
  if (cls.kind !== 'custom' || !cls.composite) return null;
  return ctx['custom-type-definitions'][typeName].properties || [];
}

// Tag derivation, looking *through* composites.
//
// Every identifier reachable from a type, as `{ field, entity }` —
// `field` is null when the type is itself an entity id, and names the
// composite's field otherwise. A property typed with a composite
// therefore contributes one tag per identifier field, and a *list* of
// composites one such tag per element.
//
// Composites do not nest, so this is one hop and cannot recurse
// further.
function idLeavesOfType(ctx, typeName) {
  const cls = classifyType(ctx, typeName);
  if (cls.kind === 'derived' && cls.role === 'id') return [{ field: null, entity: cls.entity }];
  const fields = compositeFieldsOf(ctx, typeName);
  if (!fields) return [];
  const out = [];
  for (const field of fields) {
    const fieldCls = classifyType(ctx, field.propertyType);
    if (fieldCls.kind === 'derived' && fieldCls.role === 'id') {
      out.push({ field: field.name, entity: fieldCls.entity });
    }
  }
  return out;
}

function allTypeNames(ctx) {
  return [
    ...SIMPLE_TYPES,
    ...Object.keys(derivedTypes(ctx)).sort(),
    ...Object.keys(ctx['custom-type-definitions']).sort(),
  ];
}

// An enum is not a distinct form of custom type: it is a scalar custom
// type whose `schema` carries the JSON Schema `enum` keyword. Presence
// of a non-empty `enum` array is what the tooling treats as "this
// resolves to an enum" — the one keyword that unambiguously means
// "these are the only legal values".
function enumMembersFor(ctx, typeName) {
  const cls = classifyType(ctx, typeName);
  if (cls.kind !== 'custom' || cls.composite) return null;
  const custom = ctx['custom-type-definitions'][typeName];
  const members = custom && custom.schema && custom.schema.enum;
  return Array.isArray(members) && members.length ? members : null;
}

// Whether an enum's members are all plain strings — the shape the
// chip-based member editor (add/rename/remove, with rewrite-on-rename
// across every reference) is built for. A numeric, boolean or mixed
// enum still evaluates correctly through the ordinary operand
// machinery; it just does not get that authoring convenience, and is
// edited as raw JSON Schema instead.
function isStringEnumType(ctx, typeName) {
  const members = enumMembersFor(ctx, typeName);
  return !!members && members.every((m) => typeof m === 'string');
}

// A context with one definition overlaid — used so that a body being
// validated can reference the very definition it belongs to (an
// entity's own properties may reference its own derived `<Entity>Id`).
function withPending(ctx, kind, name, body) {
  const next = { ...ctx };
  const collName = DEF_COLLECTIONS[kind];
  next[collName] = { ...ctx[collName], [name]: body };
  return next;
}

function defaultAlias(entityName) {
  return entityName.charAt(0).toLowerCase() + entityName.slice(1);
}

// `courseId` -> `course`, `sourceCourseId` -> `sourceCourse`, `idFrom` ->
// `idFrom`. Falls back to the property name whenever stripping would leave
// something that is not a usable alias.
function aliasFromProperty(propertyName) {
  const name = propertyName || '';
  const stripped = name.length > 2 && name.endsWith('Id') ? name.slice(0, -2) : name;
  return CAMEL_RE.test(stripped) ? stripped : name;
}

function uniqueAlias(base, taken) {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = base + i;
    if (!taken.includes(candidate)) return candidate;
  }
}

// ============================================================
// Reference computation and rewriting.
//
// References are derived from the body shape (per the DCB Context
// schema) — never stored alongside it. A property type naming an
// entity's derived type is a reference to that *entity*, which is what
// makes tags fall out of property types.
// ============================================================

function emptyRefs() {
  const out = {};
  for (const k of DEF_KINDS) out[k] = [];
  return out;
}

function uniq(arr) { return [...new Set(arr)]; }

function pushTypeRef(ctx, refs, typeName) {
  const cls = classifyType(ctx, typeName);
  if (cls.kind === 'custom') refs['custom-type-definition'].push(typeName);
  else if (cls.kind === 'derived') refs['entity-definition'].push(cls.entity);
}

function computeReferences(ctx, kind, body) {
  const refs = emptyRefs();
  if (!body || typeof body !== 'object') return refs;

  switch (kind) {
    case 'custom-type-definition':
      // A scalar type's schema is opaque and references nothing. A
      // composite's fields are typed against the shared universe, so
      // they reference exactly like any other property list does.
      for (const f of body.properties || []) pushTypeRef(ctx, refs, f.propertyType);
      break;
    case 'event-definition':
      for (const p of body.properties || []) pushTypeRef(ctx, refs, p.propertyType);
      break;
    case 'entity-definition':
      for (const p of body.properties || []) {
        pushTypeRef(ctx, refs, p.propertyType);
        // A script's arguments are typed like anything else. Its code
        // is not walked: it is a string this model does not parse, and
        // guessing at names inside it is how a rename corrupts a script.
        for (const a of (scriptOf(p) || {}).arguments || []) pushTypeRef(ctx, refs, a.propertyType);
        for (const handler of p.handlers || []) {
          if (handler && handler.event) refs['event-definition'].push(handler.event);
        }
      }
      break;
    case 'projection-definition':
      pushTypeRef(ctx, refs, body.valueType);
      // A parameter is always an entity-derived identifier, so it
      // reaches the entity the same way a property type does.
      for (const p of body.parameters || []) pushTypeRef(ctx, refs, p.propertyType);
      for (const a of (scriptOf(body) || {}).arguments || []) pushTypeRef(ctx, refs, a.propertyType);
      // A tag filter names entities outright, which is the one place in
      // this model an entity is referenced by bare name.
      for (const t of (scriptOf(body) || {}).tagFilter || []) {
        const match = TAG_FILTER_RE.exec(String(t || ''));
        if (match && ctx['entity-definitions'][match[1]]) refs['entity-definition'].push(match[1]);
      }
      for (const handler of body.handlers || []) {
        if (handler && handler.event) refs['event-definition'].push(handler.event);
      }
      break;
    case 'command-definition':
      for (const p of body.properties || []) pushTypeRef(ctx, refs, p.propertyType);
      for (const binding of body.boundary || []) {
        if (!binding) continue;
        if (binding.entity) refs['entity-definition'].push(binding.entity);
        if (binding.projection) refs['projection-definition'].push(binding.projection);
      }
      for (const emission of body.publishes || []) {
        if (emission && emission.name) refs['event-definition'].push(emission.name);
      }
      break;
    case 'scenario-definition':
      // A scenario names the command it exercises, every event its
      // Given is written from, and every event its expected outcome
      // holds. All three have to move when one of them is renamed —
      // and none of them may stop one from being deleted.
      if (body.command) refs['command-definition'].push(body.command);
      for (const step of body.given || []) {
        if (step && step.event) refs['event-definition'].push(step.event);
      }
      for (const event of (body.then || {}).events || []) {
        if (event && event.type) refs['event-definition'].push(event.type);
      }
      break;
    case 'specification-definition':
      // A specification names the entity it tests and every event its
      // Given is written from. Neither may stop one from being deleted
      // — a specification exists to report what that broke, not to
      // prevent it. Its Then holds property names, not references:
      // nothing else in the model is identified by one.
      if (body.entity) refs['entity-definition'].push(body.entity);
      for (const step of body.given || []) {
        if (step && step.event) refs['event-definition'].push(step.event);
      }
      break;
  }

  for (const k of DEF_KINDS) refs[k] = uniq(refs[k]);
  return refs;
}

// Rewrites every reference to `oldName` of `targetKind` into `newName`.
// Renaming an entity also rewrites its derived id type name.
function rewriteReferences(kind, body, targetKind, oldName, newName) {
  const next = deepClone(body);

  const rewriteType = (typeName) => {
    if (targetKind === 'custom-type-definition') {
      return typeName === oldName ? newName : typeName;
    }
    if (targetKind === 'entity-definition') {
      if (typeName === idTypeOf(oldName)) return idTypeOf(newName);
    }
    return typeName;
  };

  const rewriteProperties = (properties) => {
    for (const p of properties || []) {
      p.propertyType = rewriteType(p.propertyType);
      rewriteProperties((p.script || {}).arguments);
    }
  };

  // A tag filter carries an entity by bare name, so renaming the entity
  // has to move it. The placeholder inside is an argument name and is
  // untouched by anything happening outside the script.
  const rewriteTagFilter = (script) => {
    if (!script || !script.tagFilter || targetKind !== 'entity-definition') return;
    script.tagFilter = script.tagFilter.map((template) => {
      const match = TAG_FILTER_RE.exec(String(template || ''));
      return match && match[1] === oldName ? `${newName}:${match[2]}` : template;
    });
  };

  switch (kind) {
    case 'custom-type-definition':
      // Composite fields only; a scalar type has no `properties` and
      // its opaque schema names nothing this model can rewrite.
      rewriteProperties(next.properties);
      break;
    case 'event-definition':
      rewriteProperties(next.properties);
      break;
    case 'entity-definition':
      rewriteProperties(next.properties);
      if (targetKind === 'event-definition') {
        for (const p of next.properties || []) {
          for (const handler of p.handlers || []) {
            if (handler && handler.event === oldName) handler.event = newName;
          }
        }
      }
      break;
    case 'projection-definition':
      next.valueType = rewriteType(next.valueType);
      rewriteProperties(next.parameters);
      rewriteProperties((next.script || {}).arguments);
      rewriteTagFilter(next.script);
      if (targetKind === 'event-definition') {
        for (const handler of next.handlers || []) {
          if (handler && handler.event === oldName) handler.event = newName;
        }
      }
      break;
    case 'command-definition':
      rewriteProperties(next.properties);
      if (targetKind === 'entity-definition') {
        for (const binding of next.boundary || []) {
          if (binding && binding.entity === oldName) binding.entity = newName;
        }
      }
      if (targetKind === 'event-definition') {
        next.publishes = (next.publishes || []).map((e) =>
          e && e.name === oldName ? { ...e, name: newName } : e
        );
      }
      if (targetKind === 'projection-definition') {
        // Only the `projection` reference moves. An alias is local to
        // its command and was the modeler's to choose after binding.
        for (const binding of next.boundary || []) {
          if (binding && binding.projection === oldName) binding.projection = newName;
        }
      }
      break;
    case 'scenario-definition':
      if (targetKind === 'command-definition' && next.command === oldName) {
        next.command = newName;
      }
      if (targetKind === 'event-definition') {
        for (const step of next.given || []) {
          if (step && step.event === oldName) step.event = newName;
        }
        // The expected outcome moves with it. Leaving it behind would
        // report the rename as drift, which is exactly the signal a
        // rename must not produce.
        for (const event of (next.then || {}).events || []) {
          if (event && event.type === oldName) event.type = newName;
        }
      }
      break;
    case 'specification-definition':
      if (targetKind === 'entity-definition' && next.entity === oldName) {
        next.entity = newName;
      }
      if (targetKind === 'event-definition') {
        for (const step of next.given || []) {
          if (step && step.event === oldName) step.event = newName;
        }
      }
      // Then holds property names, not references — nothing to rewrite
      // there for either target kind.
      break;
  }
  return next;
}

function findReferencers(ctx, targetKind, targetName) {
  const out = [];
  for (const referrerKind of DEF_KINDS) {
    const coll = ctx[DEF_COLLECTIONS[referrerKind]];
    for (const [name, body] of Object.entries(coll)) {
      const refs = computeReferences(ctx, referrerKind, body);
      if (refs[targetKind].includes(targetName)) {
        out.push({ kind: referrerKind, name, body });
      }
    }
  }
  return out;
}

// ============================================================
// Operands.
//
// Command operands:  {parameterName} | {alias, property?} | {enumMember} | literal
// Handler operands:  {eventProperty} | {currentValue} | {successor} | {enumMember} | literal
//
// `{alias}` with no `property` reads a bound projection's value: a
// projection holds exactly one value and has no name for it. On an
// entity alias the property is required, since an entity has many.
// ============================================================

function operandSource(operand) {
  if (operand === null || operand === undefined) return 'static';
  if (typeof operand !== 'object') return 'static';
  if (operand.parameterName !== undefined) return 'parameter';
  if (operand.alias !== undefined) return 'alias-property';
  if (operand.enumMember !== undefined) return 'enum-member';
  if (operand.eventProperty !== undefined) return 'event-property';
  if (operand.eventMetadata !== undefined) return 'event-metadata';
  if (operand.currentValue !== undefined) return 'current-value';
  if (operand.successor !== undefined) return 'successor';
  return 'static';
}

function operandText(operand) {
  switch (operandSource(operand)) {
    case 'parameter':
      return operand.property
        ? `${operand.parameterName || '?'}.${operand.property}`
        : (operand.parameterName || '?');
    case 'alias-property':
      return operand.property
        ? `${operand.alias || '?'}.${operand.property}`
        : (operand.alias || '?');
    case 'enum-member': return operand.enumMember || '?';
    case 'event-property': return `event.${operand.eventProperty || '?'}`;
    case 'event-metadata': return `event.metadata.${operand.eventMetadata || '?'}`;
    case 'current-value': return 'current';
    case 'successor': return `next(${operandText(operand.successor)})`;
    default:
      if (operand === null || operand === undefined) return 'null';
      if (Array.isArray(operand)) return '[]';
      return typeof operand === 'string' ? `"${operand}"` : String(operand);
  }
}

function sameOperand(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// `operandSource` falls back to "static" for anything it does not
// recognise, so a misspelt or retired operand key would be stored as a
// literal and rendered as "[object Object]". A literal is a string, a
// number or a boolean — never an object — so an object that classifies
// as static is simply not an operand.
function assertRecognisedOperand(operand, where) {
  if (operandSource(operand) !== 'static') return;
  if (operand !== null && typeof operand === 'object') {
    throw new DomainError(
      `${where} is not a recognised operand: ${JSON.stringify(operand)}. ` +
      `A literal must be a string, a number or a boolean.`
    );
  }
}

function predicateText(predicate) { return PREDICATE_SYMBOL[predicate] || predicate; }

function conditionText(condition) {
  if (!condition) return '';
  const left = operandText(condition.leftHandSide);
  const core = condition.rightHandSide === undefined
    ? `${left} ${predicateText(condition.predicate)}`
    : `${left} ${predicateText(condition.predicate)} ${operandText(condition.rightHandSide)}`;
  return condition.negate ? `not(${core})` : core;
}

// What a scenario is called. The stored name wins; without one it is
// read off the outcome, which is why it changes when the outcome does —
// and why the interface freezes it the moment a scenario drifts, rather
// than letting the label move under the reader.
// `spell` turns a stored name into the words the reader is used to
// seeing; the model layer has no opinion about that, so it defaults to
// leaving them alone and the interface passes its own.
function scenarioName(body, spell = (n) => n) {
  if (body && typeof body.name === 'string' && body.name.trim()) return body.name.trim();
  const then = (body || {}).then;
  if (!then) return 'an unrun scenario';
  if (then.outcome === 'rejected') {
    return `is refused by ${(then.failedRule || {}).text || 'a rule'}`;
  }
  const types = (then.events || []).map((e) => e && e.type).filter(Boolean);
  return types.length ? `records ${types.map(spell).join(' and ')}` : 'is accepted';
}

// The same derivation as scenarioName, one level down: a specification
// has no outcome to name itself after, only the properties a modeler
// chose to check and what they folded to.
function specificationName(body, spell = (n) => n) {
  if (body && typeof body.name === 'string' && body.name.trim()) return body.name.trim();
  const then = (body || {}).then;
  if (!then || !Object.keys(then).length) return 'an unrun specification';
  const parts = Object.entries(then).map(([k, v]) => `${spell(k)} ${JSON.stringify(v)}`);
  return `ends up with ${parts.join(', ')}`;
}

function handlerText(handler) {
  if (!handler) return '';
  if (handler.code !== undefined) return `${handler.event || '?'} → script`;
  return `${handler.event || '?'} → ${handler.operation || '?'} ${operandText(handler.value)}`;
}

// The script a property or projection is advanced by, or null when its
// handlers are declared the ordinary way.
function scriptOf(target) {
  return target && target.script ? target.script : null;
}

// A scripted *standalone* projection states its own tags, because
// nothing else can: it has no owning entity to take one from and no
// parameter list to derive one from. The form is `Entity:{argument}` —
// an entity name, and either a placeholder naming one of the script's
// arguments or a literal value.
const TAG_FILTER_RE = /^([A-Z][A-Za-z0-9]*):(.+)$/;
const TAG_PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function tagFilterPlaceholders(template) {
  return [...String(template || '').matchAll(TAG_PLACEHOLDER_RE)].map((m) => m[1]);
}

function resolveTagFilter(template, args) {
  return String(template || '').replace(TAG_PLACEHOLDER_RE, (whole, name) =>
    args[name] === undefined ? whole : operandText(args[name]));
}

// Every scripted property an alias is read through, which is what
// decides the arguments its binding has to supply.
function scriptedPropertiesRead(ctx, body, binding) {
  const entity = ctx['entity-definitions'][binding.entity];
  if (!entity) return [];
  const found = [];
  forEachCommandOperand(body, (operand) => {
    if (operandSource(operand) !== 'alias-property' || operand.alias !== binding.alias) return;
    const property = (entity.properties || []).find((p) => p.name === operand.property);
    if (property && scriptOf(property) && !found.includes(property)) found.push(property);
  });
  return found;
}

// The arguments a binding owes, gathered from everything it reads. Two
// scripted properties asking for the same name ask for the same value —
// they are read at one instant, through one binding.
function argumentsExpected(ctx, body, binding) {
  const out = [];
  for (const property of scriptedPropertiesRead(ctx, body, binding)) {
    for (const argument of scriptOf(property).arguments || []) {
      if (!out.some((a) => a.name === argument.name)) out.push(argument);
    }
  }
  return out;
}

// The operations that make sense for a property's type. `timestamp` is
// `set`-only — an instant has no meaningful increment here.
function operationsFor(ctx, property) {
  if (property.isList) return ['set', 'append', 'remove'];
  if (property.propertyType === 'integer') return ['set', 'increment', 'decrement'];
  return ['set'];
}

// Walks every operand inside a command body.
function forEachCommandOperand(body, visit) {
  for (const binding of body.boundary || []) {
    if (!binding) continue;
    if (binding.projection) {
      for (const [key, operand] of Object.entries(binding.arguments || {})) {
        visit(operand, { where: `binding "${binding.alias || '?'}" (argument ${key})` });
      }
      continue;
    }
    visit(binding.id, { where: `boundary binding "${binding.alias || '?'}"` });
    if (binding.excluding !== undefined) {
      visit(binding.excluding, { where: `boundary binding "${binding.alias || '?'}" (excluding)` });
    }
    // An entity binding carries arguments for the same reason a
    // projection binding does: a scripted property it reads may ask for
    // values only the command has.
    for (const [key, operand] of Object.entries(binding.arguments || {})) {
      visit(operand, { where: `boundary binding "${binding.alias || '?'}" (argument ${key})` });
    }
  }
  for (const condition of body.conditions || []) {
    if (!condition) continue;
    visit(condition.leftHandSide, { where: `condition "${conditionText(condition)}"` });
    if (condition.rightHandSide !== undefined) {
      visit(condition.rightHandSide, { where: `condition "${conditionText(condition)}"` });
    }
  }
  for (const emission of body.publishes || []) {
    if (!emission || !emission.parameters) continue;
    for (const [key, operand] of Object.entries(emission.parameters)) {
      visit(operand, { where: `emission "${emission.name}.${key}"` });
    }
  }
}

// ============================================================
// DCB derivation.
//
// A command's boundary *is* its dynamic consistency boundary, and
// holds every read. An entity binding contributes one query item: its
// tag, restricted to the event types reachable through the properties
// the conditions actually read. A projection binding contributes one
// item too: its arguments as tags — none at all when it declares no
// parameters — and the event types it handles.
//
// Items carry `tags` rather than one tag because a projection may
// declare several parameters. Tags within an item are ANDed; the items
// themselves are ORed, which is the ordinary DCB query shape.
// ============================================================


// The type an operand resolves to, or null when it cannot be worked out
// (a literal, or a reference that does not resolve).
function resolveOperandType(operand, { boundary, commandProperties, ctx }) {
  const source = operandSource(operand);
  if (source === 'alias-property') {
    const binding = (boundary || []).find((b) => b.alias === operand.alias);
    if (!binding) return null;
    if (binding.projection) {
      // A projection holds one value, so the alias alone names it.
      const projection = ctx['projection-definitions'][binding.projection];
      if (!projection || operand.property) return null;
      return { propertyType: projection.valueType, isList: !!projection.isList };
    }
    const entity = ctx['entity-definitions'][binding.entity];
    if (!entity) return null;
    const property = (entity.properties || []).find((p) => p.name === operand.property);
    if (!property) return null;
    // A scripted property is no different here: `propertyType` and
    // `isList` describe the value a condition reads, whatever shape the
    // code carries internally to arrive at it.
    return { propertyType: property.propertyType, isList: !!property.isList };
  }
  if (source === 'parameter') {
    const property = (commandProperties || []).find((p) => p.name === operand.parameterName);
    if (!property) return null;
    if (!operand.property) {
      return { propertyType: property.propertyType, isList: !!property.isList };
    }
    // A field of a composite parameter. Fields are never lists
    // themselves, so the arity is entirely the parameter's: reading a
    // field of `Item[]` yields one value per element.
    const fields = compositeFieldsOf(ctx, property.propertyType);
    if (!fields) return null;
    const field = fields.find((f) => f.name === operand.property);
    return field ? { propertyType: field.propertyType, isList: !!property.isList } : null;
  }
  return null;
}

// The predicates that make sense against a resolved operand type — a
// rule editor offers these rather than the full predicate list, so
// "starts with" never turns up against an integer. `null` (the type
// could not be worked out, e.g. an untyped literal) leaves every
// predicate on the table rather than guessing.
function predicatesForType(resolved) {
  if (!resolved) return [...BINARY_PREDICATES, ...UNARY_PREDICATES];
  if (resolved.isList) {
    return ['equals', 'countEquals', 'countLessThan', 'countGreaterThan',
      'contains', 'containsAny', 'isEmpty', 'isNotEmpty'];
  }
  if (resolved.propertyType === 'boolean') return ['equals', 'isTrue', 'isFalse'];
  if (resolved.propertyType === 'integer' || resolved.propertyType === 'timestamp') {
    return ['equals', 'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals'];
  }
  if (resolved.propertyType === 'string') {
    return ['equals', 'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals',
      'startsWith', 'endsWith'];
  }
  // Enum, id and composite types (custom or entity-derived): nothing
  // but identity means anything without a declared ordering.
  return ['equals'];
}

// The type a rule's right-hand side has to hold for a given predicate
// against a left-hand side of `leftType` — `null` once `leftType`
// itself is unknown, since nothing can be filtered against it then.
function rightHandExpectedType(predicate, leftType) {
  if (!leftType) return null;
  if (predicate === 'countEquals' || predicate === 'countLessThan' || predicate === 'countGreaterThan') {
    return { propertyType: 'integer', isList: false };
  }
  if (predicate === 'contains') return { propertyType: leftType.propertyType, isList: false };
  if (predicate === 'containsAny') return { propertyType: leftType.propertyType, isList: true };
  return { propertyType: leftType.propertyType, isList: leftType.isList };
}

// A binding whose identifier operand is a list covers one instance per
// element — nothing declares it, it follows from the operand's type. A
// list read off an already-fanned-out alias is a list of lists, which
// flattens; either way the binding is plural.
function isFannedOut(ctx, body, binding) {
  if (!binding) return false;
  // A projection binding reads one partition: every argument is a
  // single tag, so there is nothing for it to fan over.
  if (binding.projection) return false;
  const resolved = resolveOperandType(binding.id, {
    boundary: body.boundary || [],
    commandProperties: body.properties || [],
    ctx,
  });
  if (resolved && resolved.isList) return true;
  // Reading a scalar property off a plural alias is itself plural.
  if (operandSource(binding.id) === 'alias-property') {
    const source = (body.boundary || []).find((b) => b && b.alias === binding.id.alias);
    if (source && source !== binding) return isFannedOut(ctx, body, source);
  }
  return false;
}

// The list an operand is quantified over, as an identity string, or
// null when the operand is singular.
//
// This is what makes zipping decidable: two operands are correlated
// exactly when they carry the same root, because that is what "they
// came from the same list" means.
function bindingFanRoot(ctx, body, binding, seen = []) {
  if (!binding || !isFannedOut(ctx, body, binding)) return null;
  if (seen.includes(binding.alias)) return null;
  if (operandSource(binding.id) === 'parameter') {
    return `parameter:${binding.id.parameterName}`;
  }
  if (operandSource(binding.id) === 'alias-property') {
    const source = (body.boundary || []).find((b) => b && b.alias === binding.id.alias);
    // A binding fanned from a plural *projection* has no list
    // parameter behind it, so it is its own root.
    const inherited = source && source !== binding
      ? bindingFanRoot(ctx, body, source, [...seen, binding.alias])
      : null;
    return inherited || `binding:${binding.alias}`;
  }
  return `binding:${binding.alias}`;
}

function fanRootOf(ctx, body, operand) {
  const source = operandSource(operand);
  if (source === 'alias-property') {
    return bindingFanRoot(ctx, body,
      (body.boundary || []).find((b) => b && b.alias === operand.alias));
  }
  if (source === 'parameter') {
    // A list parameter is a fan root only when something actually fans
    // out over it. A list nobody iterates — the new schedule handed to
    // a reschedule command, say — is an ordinary list value, and
    // reading it alongside a fanned alias is not a second quantifier.
    const root = `parameter:${operand.parameterName}`;
    const iterated = (body.boundary || []).some(
      (b) => bindingFanRoot(ctx, body, b) === root);
    return iterated ? root : null;
  }
  return null;
}

// Operands of one condition, in evaluation order.
function conditionOperands(condition) {
  if (!condition) return [];
  const out = [condition.leftHandSide];
  if (condition.rightHandSide !== undefined) out.push(condition.rightHandSide);
  return out;
}

// The distinct roots a condition quantifies over. More than one is
// rejected: the lengths are unrelated and nothing can assert otherwise.
function conditionFanRoots(ctx, body, condition) {
  return uniq(
    conditionOperands(condition)
      .map((operand) => fanRootOf(ctx, body, operand))
      .filter(Boolean)
  );
}

// Whether an operand is read at the iteration index rather than whole.
//
// It is zipped when some *alias* in the same condition fans from the
// very list the operand is rooted at — that alias is what supplies the
// index. An operand rooted at a list nothing else iterates stays a
// plain list, and is quantified over on its own.
function isZipped(ctx, body, condition, operand) {
  const root = fanRootOf(ctx, body, operand);
  if (!root || operandSource(operand) !== 'parameter') return false;
  return conditionOperands(condition).some((other) =>
    other !== operand
    && operandSource(other) === 'alias-property'
    && fanRootOf(ctx, body, other) === root);
}

// An operand's type as the condition actually reads it: zipping drops
// the list, because the index has already been applied.
function conditionOperandType(ctx, body, condition, operand) {
  const resolved = resolveOperandType(operand, {
    boundary: body.boundary || [],
    commandProperties: body.properties || [],
    ctx,
  });
  if (!resolved) return null;
  if (resolved.isList && isZipped(ctx, body, condition, operand)) {
    return { ...resolved, isList: false };
  }
  return resolved;
}

// Every projection the command binds, in declaration order.
function projectionsRead(body) {
  return (body.boundary || [])
    .filter((b) => b && b.projection)
    .map((b) => b.projection);
}

function deriveDcb(ctx, body) {
  const items = [];

  for (const binding of body.boundary || []) {
    if (!binding) continue;

    if (binding.projection) {
      const projection = ctx['projection-definitions'][binding.projection];
      if (!projection) continue;
      // A declared projection's parameters *are* its tags, so the query
      // is written from the parameter list rather than from anything
      // about the value. A scripted one states its tags itself, with
      // argument names interpolated — the one thing the escape hatch is
      // not allowed to hide is what it reads.
      const script = scriptOf(projection);
      const tags = script
        ? (script.tagFilter || []).map((t) => resolveTagFilter(t, binding.arguments || {}))
        : (projection.parameters || []).map((p) => {
            const entity = entityOfIdType(ctx, p.propertyType);
            const operand = (binding.arguments || {})[p.name];
            return `${entity || p.propertyType}:${operandText(operand)}`;
          });
      items.push({
        projection: binding.projection,
        alias: binding.alias,
        tags,
        types: uniq((projection.handlers || []).map((h) => h && h.event).filter(Boolean)).sort(),
        readProperties: [],
      });
      continue;
    }

    const readProperties = new Set();
    forEachCommandOperand(body, (operand) => {
      if (operandSource(operand) === 'alias-property' && operand.alias === binding.alias
          && operand.property) {
        readProperties.add(operand.property);
      }
    });
    // The boundary binding's own id operand is not a read of the entity.
    const entity = ctx['entity-definitions'][binding.entity];
    const types = new Set();
    if (entity) {
      for (const property of entity.properties || []) {
        if (!readProperties.has(property.name)) continue;
        for (const handler of property.handlers || []) {
          if (handler && handler.event) types.add(handler.event);
        }
      }
    }
    const fannedOut = isFannedOut(ctx, body, binding);
    items.push({
      alias: binding.alias,
      tags: [fannedOut
        ? `${binding.entity}:each(${operandText(binding.id)}${
            binding.excluding !== undefined ? ` except ${operandText(binding.excluding)}` : ''})`
        : `${binding.entity}:${operandText(binding.id)}`],
      fannedOut,
      types: [...types].sort(),
      readProperties: [...readProperties].sort(),
    });
  }

  const writes = [];
  for (const emission of body.publishes || []) {
    if (!emission) continue;
    const event = ctx['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      const listed = property.isList || (operand !== undefined && operandSource(operand) === 'parameter'
        && (body.properties || []).some((p) => p.name === operand.parameterName && p.isList));
      for (const leaf of idLeavesOfType(ctx, property.propertyType)) {
        const shown = operand === undefined
          ? '?'
          : operandText(leaf.field === null
            ? operand
            : (operandSource(operand) === 'parameter'
              ? { parameterName: operand.parameterName, property: leaf.field }
              : operand));
        writes.push(`${leaf.entity}:${listed ? `each(${shown})` : shown}`);
      }
    }
  }

  return { items, writes: uniq(writes) };
}

// The aliases a binding waits for — every binding its own operands
// name. A graph, not a tree: `id` and `excluding` may point somewhere
// different, and arguments may point at several bindings at once.
function bindingDependsOn(body, binding) {
  if (!binding) return [];
  const operands = binding.projection
    ? Object.values(binding.arguments || {})
    : [binding.id, binding.excluding, ...Object.values(binding.arguments || {})];
  const aliases = [];
  for (const operand of operands) {
    if (operandSource(operand) !== 'alias-property') continue;
    if (operand.alias === binding.alias) continue;
    if (!aliases.includes(operand.alias)) aliases.push(operand.alias);
  }
  return aliases;
}

// Groups the boundary into the rounds it actually resolves in.
//
// A binding waits only for the bindings it names, so the number of
// trips to the store is the *depth* of that graph and not the length
// of the list: two bindings both reading from the payload come back
// together. Because a binding may only name one declared above it, the
// list is already topologically sorted and one left-to-right pass does
// it.
//
// Derived, never authored — which is also what keeps it honest about
// shape. A binding with two parents has no place in a written
// hierarchy without being duplicated.
function deriveRounds(body) {
  const boundary = (body.boundary || []).filter(Boolean);
  const roundOf = new Map();
  const rounds = [];

  for (const binding of boundary) {
    const waitsFor = bindingDependsOn(body, binding).filter((a) => roundOf.has(a));
    const round = waitsFor.reduce((max, alias) => Math.max(max, roundOf.get(alias)), 0) + 1;
    roundOf.set(binding.alias, round);
    while (rounds.length < round) rounds.push([]);
    rounds[round - 1].push({ binding, waitsFor });
  }
  return rounds;
}

// Every entity-id property of every published event must resolve to a
// binding in the boundary — a command may not write a tag it did not
// consult. A value read from a projection binding is exempt when that
// projection handles the event being published: its query then already
// covers every event that could have issued the value, and a freshly
// minted identifier has no history to consult.
//
// The exemption ignores the partition on purpose. A projection scoped
// so narrowly that two partitions can mint the same identifier is a
// modelling error of the same class as handling the wrong event, and
// catching it is not this check's job.
function mintsFromProjection(ctx, body, operand, eventName) {
  if (operandSource(operand) !== 'alias-property' || operand.property) return false;
  const binding = (body.boundary || []).find((b) => b && b.alias === operand.alias);
  if (!binding || !binding.projection) return false;
  const projection = ctx['projection-definitions'][binding.projection];
  return !!projection && (projection.handlers || []).some((h) => h && h.event === eventName);
}

function coverageIssues(ctx, body) {
  const issues = [];
  for (const emission of body.publishes || []) {
    if (!emission) continue;
    const event = ctx['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      if (mintsFromProjection(ctx, body, operand, emission.name)) continue;
      // Checked against the identifier *leaves* of the property's
      // type, not its surface: a property typed `Item[]` writes one
      // tag per element, and each has to have been consulted.
      for (const leaf of idLeavesOfType(ctx, property.propertyType)) {
        const required = leaf.field === null
          ? operand
          : (operandSource(operand) === 'parameter'
            ? { parameterName: operand.parameterName, property: leaf.field }
            : undefined);
        const covered = required !== undefined && (body.boundary || []).some(
          (binding) => binding && binding.entity === leaf.entity && sameOperand(binding.id, required)
        );
        if (!covered) {
          issues.push({
            event: emission.name,
            property: leaf.field === null ? property.name : `${property.name}.${leaf.field}`,
            entity: leaf.entity,
            operand: required === undefined ? operand : required,
          });
        }
      }
    }
  }
  return issues;
}

// ============================================================
// Commands — DCB-style consult-and-check, then append.
// ============================================================

class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainError';
  }
}

function validateName(value, label = 'Name') {
  const trimmed = (value || '').trim();
  if (!trimmed) throw new DomainError(`${label} must not be empty.`);
  if (!PASCAL_RE.test(trimmed)) {
    throw new DomainError(`${label} must be PascalCase (e.g. "CourseDefined") — got "${trimmed}".`);
  }
  if (trimmed.length > 100) throw new DomainError(`${label} must be 100 characters or fewer.`);
  return trimmed;
}

// The key a definition is stored under. For every kind but one that is
// the name the modeler typed, and validating it is validating the
// name. A scenario is keyed by a generated id instead, so there is
// nothing here for a modeler to get wrong.
function validateDefinitionKey(kind, value, label) {
  if (!isIdKeyed(kind)) return validateName(value, label);
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new DomainError(`A ${humanize(kind)} needs an id.`);
  return trimmed;
}

function validateContextName(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) throw new DomainError('Context name must not be empty.');
  return trimmed;
}

// Context lifecycle ------------------------------------------------------

function createDcbContext(name) {
  const trimmed = validateContextName(name);
  const id = generateId();
  appendEvents([{ type: 'dcb-context-created', data: { 'dcb-context-id': id, name: trimmed } }]);
  return id;
}

function renameDcbContext(id, newName) {
  const trimmed = validateContextName(newName);
  if (!projectState()[id]) throw new DomainError('Context does not exist.');
  appendEvents([{ type: 'dcb-context-renamed', data: { 'dcb-context-id': id, name: trimmed } }]);
}

function deleteDcbContext(id) {
  if (!projectState()[id]) throw new DomainError('Context does not exist.');
  appendEvents([{ type: 'dcb-context-deleted', data: { 'dcb-context-id': id } }]);
}

// Definitions ------------------------------------------------------------

function getCtxOrThrow(ctxId) {
  const ctx = projectState()[ctxId];
  if (!ctx) throw new DomainError('Context does not exist (it may have been deleted).');
  return ctx;
}

function assertDerivedNamesFree(ctx, entityName, exceptEntity) {
  const derived = idTypeOf(entityName);
  if (ctx['custom-type-definitions'][derived] !== undefined) {
    throw new DomainError(
      `Entity "${entityName}" would derive the type "${derived}", but a custom type by that name already exists.`
    );
  }
  for (const other of Object.keys(ctx['entity-definitions'])) {
    if (other === exceptEntity) continue;
    if (idTypeOf(other) === derived) {
      throw new DomainError(
        `Entity "${entityName}" would derive the type "${derived}", which entity "${other}" already derives.`
      );
    }
  }
}

function assertCustomTypeNameFree(ctx, typeName) {
  const derived = derivedTypes(ctx)[typeName];
  if (derived) {
    throw new DomainError(
      `"${typeName}" is derived from entity "${derived.entity}" — custom types share that namespace.`
    );
  }
}

function validateReferences(ctx, kind, name, body) {
  const resolved = withPending(ctx, kind, name, body);
  const refs = computeReferences(resolved, kind, body);
  for (const targetKind of DEF_KINDS) {
    const coll = resolved[DEF_COLLECTIONS[targetKind]];
    for (const targetName of refs[targetKind]) {
      if (!(targetName in coll)) {
        throw new DomainError(
          `Reference does not resolve: ${humanize(targetKind)} "${targetName}" does not exist in this context.`
        );
      }
    }
  }

  const checkPropertyTypes = (properties, label) => {
    const seen = new Set();
    for (const p of properties || []) {
      if (!CAMEL_RE.test(p.name || '')) {
        throw new DomainError(`${label} property name "${p.name}" must be camelCase.`);
      }
      if (seen.has(p.name)) throw new DomainError(`${label} declares "${p.name}" twice.`);
      seen.add(p.name);
      if (classifyType(resolved, p.propertyType).kind === 'unresolved') {
        throw new DomainError(`Type "${p.propertyType}" (property "${p.name}") does not resolve in this context.`);
      }
    }
  };

  if (kind === 'event-definition') checkPropertyTypes(body.properties, 'Event');
  if (kind === 'command-definition') checkPropertyTypes(body.properties, 'Command');

  if (kind === 'custom-type-definition') validateCustomTypeBody(resolved, name, body);
  if (kind === 'entity-definition') validateEntityBody(resolved, name, body);
  if (kind === 'projection-definition') validateProjectionBody(resolved, name, body);
  if (kind === 'command-definition') validateCommandBody(resolved, body);
  if (kind === 'scenario-definition') validateScenarioBody(resolved, body);
  if (kind === 'specification-definition') validateSpecificationBody(resolved, body);
}

// Handler validation, shared by entity properties and projections —
// the two project identically, and the only difference is whose value
// is advanced. `target` is a property-shaped object: `name`,
// `propertyType`, `isList`, `script`.
function validateHandlers(ctx, label, target, handlers) {
  if (scriptOf(target)) return validateScriptedHandlers(ctx, label, handlers);
  const allowedOperations = operationsFor(ctx, target);
  const members = enumMembersFor(ctx, target.propertyType);
  const handledEvents = new Set();

  // `successor` wraps another operand, so recognising an operand means
  // walking into it. It is where numbering lives: a value set to the
  // successor of what an event carried *is* the next value to issue,
  // at every point in its life.
  const successorTypes = ['integer', 'string'];
  const checkOperand = (operand, where) => {
    if (operandSource(operand) === 'successor') {
      // A custom scalar and an entity identifier are both strings
      // underneath, so both have a successor. An enum does not: its
      // members are a set, and "the next member" means nothing.
      const cls = classifyType(ctx, target.propertyType);
      const underlying = cls.kind === 'simple' ? target.propertyType
        : (enumMembersFor(ctx, target.propertyType) ? 'enum' : 'string');
      if (!successorTypes.includes(underlying)) {
        throw new DomainError(
          `${where} takes a successor, but ${label} is typed ${target.propertyType}. ` +
          'A successor is defined on integers and on strings ending in digits.'
        );
      }
      return checkOperand(operand.successor, where);
    }
    assertRecognisedOperand(operand, where);
    return operand;
  };

  for (const handler of handlers || []) {
    if (!handler || !handler.event) {
      throw new DomainError(`A handler on ${label} has no event.`);
    }
    if (handledEvents.has(handler.event)) {
      throw new DomainError(`${label} handles "${handler.event}" twice.`);
    }
    handledEvents.add(handler.event);
    if (!allowedOperations.includes(handler.operation)) {
      throw new DomainError(
        `Operation "${handler.operation}" is not available for ${label} ` +
        `(allowed: ${allowedOperations.join(', ')}).`
      );
    }
    const event = ctx['event-definitions'][handler.event];
    if (!event) {
      throw new DomainError(`${label} handles "${handler.event}", which this context does not define.`);
    }
    const where = `The handler for "${handler.event}" on ${label}`;
    const leaf = checkOperand(handler.value, where);
    if (operandSource(leaf) === 'event-property') {
      const known = (event.properties || []).some((p) => p.name === leaf.eventProperty);
      if (!known) {
        throw new DomainError(
          `Handler on ${label} reads "${leaf.eventProperty}", which "${handler.event}" does not carry.`
        );
      }
    }
    // The envelope is the same on every event, so this checks a name
    // against the store's vocabulary rather than the event's.
    if (operandSource(leaf) === 'event-metadata'
        && !EVENT_METADATA.some((m) => m.name === leaf.eventMetadata)) {
      throw new DomainError(
        `Handler on ${label} reads "event.metadata.${leaf.eventMetadata}", which is not envelope ` +
        `metadata (${EVENT_METADATA.map((m) => m.name).join(', ')}).`
      );
    }
    if (members && operandSource(leaf) === 'enum-member'
        && !members.includes(leaf.enumMember)) {
      throw new DomainError(
        `Handler on ${label} sets "${leaf.enumMember}", which is not a member of ${target.propertyType}.`
      );
    }
  }
}

// A scripted handler is a body of code, and nothing here parses it.
// What can still be checked is what it *claims*: the event exists and
// is claimed once. That is exactly the part the derived DCB reads, so
// the boundary stays trustworthy while the accumulation does not.
function validateScriptedHandlers(ctx, label, handlers) {
  const handledEvents = new Set();
  for (const handler of handlers || []) {
    if (!handler || !handler.event) {
      throw new DomainError(`A handler on ${label} has no event.`);
    }
    if (handledEvents.has(handler.event)) {
      throw new DomainError(`${label} handles "${handler.event}" twice.`);
    }
    handledEvents.add(handler.event);
    if (!ctx['event-definitions'][handler.event]) {
      throw new DomainError(`${label} handles "${handler.event}", which this context does not define.`);
    }
    if (typeof handler.code !== 'string' || !handler.code.trim()) {
      throw new DomainError(
        `The handler for "${handler.event}" on ${label} is scripted but carries no code.`
      );
    }
    if (handler.operation !== undefined || handler.value !== undefined) {
      throw new DomainError(
        `The handler for "${handler.event}" on ${label} is scripted and also declares an ` +
        'operation. A handler is one or the other: the code is the operation.'
      );
    }
  }
}

// What a script may state, wherever it appears. `initialState` is the
// state before any event; `exposes` names the field of it a condition
// reads, and is what keeps a composite accumulation from leaking into
// the boundary — `propertyType`/`isList` still describe that exposed
// value, so conditions type-check exactly as they always did.
//
// `arguments` are values the command supplies at read time. They are
// not tags and can never narrow a query: the store returns the same
// events either way, and the code discards what it does not want. That
// is the whole difference between an argument and a tag, and it is why
// a tag must still be an identifier.
function validateScript(ctx, label, target, { standalone }) {
  const script = scriptOf(target);
  if ((target.handlers || []).length === 0) {
    throw new DomainError(`${label} is scripted but handles no events, so nothing would ever run.`);
  }
  if (script.initialState === undefined) {
    throw new DomainError(`${label} needs an initial state — it is the state before any event.`);
  }
  if (target.initialValue !== undefined) {
    throw new DomainError(
      `${label} declares both an initial value and a script. The script's "initialState" is the ` +
      'one that starts it; two of them would disagree.'
    );
  }
  if (script.exposes !== undefined) {
    if (!CAMEL_RE.test(script.exposes)) {
      throw new DomainError(`${label} exposes "${script.exposes}", which is not a camelCase field name.`);
    }
    const state = script.initialState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new DomainError(
        `${label} exposes the field "${script.exposes}", but its initial state is not a record — ` +
        'a script that exposes one field of its state must keep that state in fields.'
      );
    }
    if (!(script.exposes in state)) {
      throw new DomainError(
        `${label} exposes "${script.exposes}", which its initial state does not hold. ` +
        `It starts with: ${Object.keys(state).join(', ') || 'nothing'}.`
      );
    }
  }

  const seen = new Set();
  for (const argument of script.arguments || []) {
    if (!argument || !CAMEL_RE.test(argument.name || '')) {
      throw new DomainError(`An argument on ${label} needs a camelCase name.`);
    }
    if (seen.has(argument.name)) {
      throw new DomainError(`${label} declares argument "${argument.name}" twice.`);
    }
    seen.add(argument.name);
    if (classifyType(ctx, argument.propertyType).kind === 'unresolved') {
      throw new DomainError(
        `Argument "${argument.name}" on ${label} is typed "${argument.propertyType}", ` +
        'which does not resolve in this context.'
      );
    }
  }

  // An entity property is read through a binding that already names the
  // instance, so a tag filter there would be a second answer to a
  // question already settled — and the binding is the one that wins.
  if (!standalone && script.tagFilter !== undefined) {
    throw new DomainError(
      `${label} states a tag filter, but it belongs to an entity: the binding that reads it ` +
      'already names the instance, and a second answer could only disagree with the first.'
    );
  }
  if (!standalone) return;

  const tagFilter = script.tagFilter || [];
  if (!tagFilter.length) {
    throw new DomainError(
      `${label} is a scripted projection and states no tag filter. A declared projection derives ` +
      'its tags from its parameters; a scripted one has none, so it must say what it reads.'
    );
  }
  for (const template of tagFilter) {
    const match = TAG_FILTER_RE.exec(String(template || ''));
    if (!match) {
      throw new DomainError(
        `Tag filter "${template}" on ${label} is not a tag. A tag is "Entity:value", and the ` +
        'value may be a "{argument}" placeholder.'
      );
    }
    if (!ctx['entity-definitions'][match[1]]) {
      throw new DomainError(`Tag filter "${template}" on ${label} names unknown entity "${match[1]}".`);
    }
    for (const placeholder of tagFilterPlaceholders(template)) {
      if (!seen.has(placeholder)) {
        throw new DomainError(
          `Tag filter "${template}" on ${label} interpolates "{${placeholder}}", which it does ` +
          'not declare as an argument.'
        );
      }
    }
  }
}

// A projection is an entity property that lost its entity: same
// handlers, same operations, same operands. What replaces the owning
// entity is `parameters` — the tags a command supplies when it binds
// it. No parameters means no tag, which is what a global numbering is.
function validateProjectionBody(ctx, projectionName, body) {
  const valueCls = classifyType(ctx, body.valueType);
  if (valueCls.kind === 'unresolved') {
    throw new DomainError(
      `Type "${body.valueType}" (projection "${projectionName}") does not resolve in this context.`
    );
  }
  if (valueCls.kind === 'custom' && valueCls.composite) {
    throw new DomainError(
      `Projection "${projectionName}" holds "${body.valueType}", which is a composite. ` +
      'A projection holds a single value, and the operations that advance one have nothing ' +
      'to act on in a record of fields.'
    );
  }

  const script = scriptOf(body);
  if (script) {
    // A scripted projection replaces `parameters` with `arguments` and
    // a tag filter: its arguments are read-time values rather than
    // tags, so the partition can no longer be inferred from them.
    if ((body.parameters || []).length) {
      throw new DomainError(
        `Projection "${projectionName}" is scripted and also declares parameters. A scripted ` +
        'projection states its tags in its tag filter and takes arguments instead.'
      );
    }
    validateScript(ctx, `projection "${projectionName}"`, body, { standalone: true });
    validateHandlers(ctx, `projection "${projectionName}"`, body, body.handlers);
    return;
  }

  if (body.initialValue === undefined) {
    throw new DomainError(
      `Projection "${projectionName}" needs an initial value — it is the value before any event ` +
      'has been applied, and for a numbering it is where the prefix is stated.'
    );
  }

  // Only an identifier is a tag, and only a tag can narrow a query. A
  // parameter of any other type could not restrict what the store
  // returns — it could only discard events after reading them, which
  // is a predicate, and predicates live in conditions. A script is
  // exactly the place where discarding after reading is legitimate,
  // which is why that one takes arguments and not parameters.
  const seenParameters = new Set();
  for (const parameter of body.parameters || []) {
    if (!parameter || !CAMEL_RE.test(parameter.name || '')) {
      throw new DomainError(`A parameter on projection "${projectionName}" needs a camelCase name.`);
    }
    if (seenParameters.has(parameter.name)) {
      throw new DomainError(`Projection "${projectionName}" declares parameter "${parameter.name}" twice.`);
    }
    seenParameters.add(parameter.name);
    if (!entityOfIdType(ctx, parameter.propertyType)) {
      throw new DomainError(
        `Parameter "${parameter.name}" on projection "${projectionName}" is typed ` +
        `"${parameter.propertyType}", which is not an entity identifier. A parameter becomes a ` +
        'tag, and only an identifier is a tag.'
      );
    }
  }

  if ((body.handlers || []).length === 0) {
    throw new DomainError(
      `Projection "${projectionName}" handles no events, so it could only ever read its initial value.`
    );
  }
  validateHandlers(ctx, `projection "${projectionName}"`, body, body.handlers);
}

// A custom type is scalar (an opaque JSON Schema) or composite (typed
// fields) — never both and never neither.
//
// A composite's fields are singular, required and never composite
// themselves. All three keep zipping honest: zipping correlates a
// fanned-out binding with the list it fanned from by index, and it only
// means anything while the two have the same length. A list field
// flattens, an optional identifier field contributes a variable number
// of tags, and either way the index drifts with nothing on the page to
// show it.
function validateCustomTypeBody(ctx, typeName, body) {
  const hasSchema = body.schema !== undefined;
  const hasFields = body.properties !== undefined;
  if (hasSchema && hasFields) {
    throw new DomainError(
      `Custom type "${typeName}" declares both a schema and fields — it is either scalar or composite, not both.`
    );
  }
  if (!hasSchema && !hasFields) {
    throw new DomainError(`Custom type "${typeName}" declares neither a schema nor fields.`);
  }
  if (!hasFields) return;

  const fields = body.properties || [];
  if (fields.length === 0) {
    throw new DomainError(`Composite type "${typeName}" declares no fields.`);
  }
  const seen = new Set();
  for (const field of fields) {
    if (!CAMEL_RE.test(field.name || '')) {
      throw new DomainError(`Field name "${field.name}" on "${typeName}" must be camelCase.`);
    }
    if (seen.has(field.name)) {
      throw new DomainError(`Composite type "${typeName}" declares field "${field.name}" twice.`);
    }
    seen.add(field.name);
    const cls = classifyType(ctx, field.propertyType);
    if (cls.kind === 'unresolved') {
      throw new DomainError(
        `Type "${field.propertyType}" (field "${typeName}.${field.name}") does not resolve in this context.`
      );
    }
    if (cls.kind === 'custom' && cls.composite) {
      throw new DomainError(
        `Field "${typeName}.${field.name}" is typed with the composite "${field.propertyType}". ` +
        `Composites do not nest — an operand reaches one field, never a path.`
      );
    }
    if (field.isList) {
      throw new DomainError(
        `Field "${typeName}.${field.name}" is a list. A composite's fields are singular, ` +
        `because a list field flattens and would break the index a zipped condition reads by.`
      );
    }
    if (field.isOptional) {
      throw new DomainError(
        `Field "${typeName}.${field.name}" is optional. A composite's fields are required, ` +
        `because a missing identifier would contribute no tag and shift every later index.`
      );
    }
  }
}

function validateEntityBody(ctx, entityName, body) {
  const properties = body.properties || [];

  const seen = new Set();
  for (const property of properties) {
    if (!CAMEL_RE.test(property.name || '')) {
      throw new DomainError(`Property name "${property.name}" must be camelCase.`);
    }
    if (seen.has(property.name)) throw new DomainError(`Entity declares property "${property.name}" twice.`);
    seen.add(property.name);
    if (classifyType(ctx, property.propertyType).kind === 'unresolved') {
      throw new DomainError(`Type "${property.propertyType}" (property "${property.name}") does not resolve.`);
    }

    if (scriptOf(property)) {
      validateScript(ctx, `property "${property.name}"`, property, { standalone: false });
    }

    const members = enumMembersFor(ctx, property.propertyType);
    if (members && operandSource(property.initialValue) === 'enum-member'
        && !members.includes(property.initialValue.enumMember)) {
      throw new DomainError(
        `Property "${property.name}" starts in "${property.initialValue.enumMember}", which is not a member of ${property.propertyType}.`
      );
    }

    validateHandlers(ctx, `property "${property.name}"`, property, property.handlers);
  }
}

function validateCommandBody(ctx, body) {
  const boundary = body.boundary || [];
  const aliases = new Set();
  // Declaration order *is* the chain: a binding may take its identifier
  // from an instance bound above it, never from one bound below. One
  // left-to-right pass therefore both resolves the chain and makes a
  // cycle impossible to write.
  const declaredAbove = [];
  for (const binding of boundary) {
    if (!CAMEL_RE.test(binding.alias || '')) {
      throw new DomainError(`Boundary alias "${binding.alias}" must be camelCase.`);
    }
    if (aliases.has(binding.alias)) throw new DomainError(`Boundary alias "${binding.alias}" is bound twice.`);
    aliases.add(binding.alias);

    // A projection binding is a read like any other, which is why it
    // lives here: its arguments put it in the chain, and its query
    // belongs in the append condition.
    if (binding.projection !== undefined) {
      const projection = ctx['projection-definitions'][binding.projection];
      if (!projection) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" names unknown projection "${binding.projection}".`
        );
      }
      // `id` and `excluding` both belong to an entity binding. A
      // projection binding reads one partition named by its arguments
      // and never fans out.
      for (const field of ['id', 'excluding']) {
        if (binding[field] !== undefined) {
          throw new DomainError(
            `Boundary binding "${binding.alias}" reads a projection but carries "${field}", ` +
            'which only an entity binding has.'
          );
        }
      }
      // Declared and scripted projections take the same thing on the
      // calling side — one argument per declared name. What differs is
      // what they do with it: a parameter becomes a tag, an argument
      // reaches the code.
      const script = scriptOf(projection);
      const parameters = script ? (script.arguments || []) : (projection.parameters || []);
      const supplied = Object.keys(binding.arguments || {});
      for (const parameter of parameters) {
        if (!supplied.includes(parameter.name)) {
          throw new DomainError(
            `Boundary binding "${binding.alias}" supplies no "${parameter.name}", which ` +
            `"${binding.projection}" ${script ? 'takes as an argument' : 'is partitioned by'}.`
          );
        }
      }
      for (const key of supplied) {
        if (!parameters.some((p) => p.name === key)) {
          throw new DomainError(
            `Boundary binding "${binding.alias}" supplies "${key}", which "${binding.projection}" ` +
            `does not declare as ${script ? 'an argument' : 'a parameter'}.`
          );
        }
        const operand = binding.arguments[key];
        if (operandSource(operand) !== 'alias-property') continue;
        if (operand.alias === binding.alias) {
          throw new DomainError(`Boundary binding "${binding.alias}" takes an argument from itself.`);
        }
        if (!declaredAbove.includes(operand.alias)) {
          throw new DomainError(
            `Boundary binding "${binding.alias}" takes "${key}" from "${operandText(operand)}", ` +
            `but "${operand.alias}" is not bound above it — a binding may only read what is declared earlier.`
          );
        }
      }
      declaredAbove.push(binding.alias);
      continue;
    }

    if (!ctx['entity-definitions'][binding.entity]) {
      throw new DomainError(`Boundary binding "${binding.alias}" names unknown entity "${binding.entity}".`);
    }
    if (binding.id === undefined || binding.id === null || operandText(binding.id).includes('?')) {
      throw new DomainError(`Boundary binding "${binding.alias}" has no identifier operand.`);
    }
    if (operandSource(binding.id) === 'alias-property') {
      if (binding.id.alias === binding.alias) {
        throw new DomainError(`Boundary binding "${binding.alias}" takes its identifier from itself.`);
      }
      if (!declaredAbove.includes(binding.id.alias)) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" takes its identifier from "${operandText(binding.id)}", ` +
          `but "${binding.id.alias}" is not bound above it — a binding may only read instances declared earlier.`
        );
      }
    }
    if (binding.excluding !== undefined && !isFannedOut(ctx, body, binding)) {
      throw new DomainError(
        `Boundary binding "${binding.alias}" excludes ${operandText(binding.excluding)}, ` +
        `but it binds a single instance — there is nothing to exclude it from.`
      );
    }
    declaredAbove.push(binding.alias);
  }

  // A plural alias cannot supply a single value, so it may be read by a
  // condition — which quantifies over it — but never emitted.
  for (const emission of body.publishes || []) {
    if (!emission || !emission.parameters) continue;
    for (const [key, operand] of Object.entries(emission.parameters)) {
      if (operandSource(operand) !== 'alias-property') continue;
      const binding = boundary.find((b) => b.alias === operand.alias);
      if (binding && isFannedOut(ctx, body, binding)) {
        throw new DomainError(
          `"${emission.name}.${key}" takes its value from "${operandText(operand)}", but "${operand.alias}" ` +
          `binds many instances. A fanned-out instance can be checked, not emitted.`
        );
      }
    }
  }

  // A condition may quantify over at most one fanned-out root. Two
  // distinct roots would have to be read as a cross product, and their
  // lengths are unrelated — nothing here can assert otherwise, and the
  // zipped and crossed readings look identical on the page.
  for (const condition of body.conditions || []) {
    if (!condition) continue;
    const roots = conditionFanRoots(ctx, body, condition);
    if (roots.length > 1) {
      throw new DomainError(
        `Condition "${conditionText(condition)}" quantifies over ${roots.length} different lists ` +
        `(${roots.map((r) => r.replace(/^(parameter|binding):/, '')).join(' and ')}). ` +
        `A condition may iterate one list: nothing states that two lists are the same length.`
      );
    }
  }

  for (const condition of body.conditions || []) {
    if (!condition || condition.predicate !== 'containsAny') continue;
    const left = conditionOperandType(ctx, body, condition, condition.leftHandSide);
    const right = conditionOperandType(ctx, body, condition, condition.rightHandSide);
    for (const [side, label] of [[left, 'Left'], [right, 'Right']]) {
      if (side && !side.isList) {
        throw new DomainError(
          `${label} side of "${conditionText(condition)}" is not a list — ` +
          `"containsAny" asks whether two lists intersect.`
        );
      }
    }
    if (left && right && left.propertyType !== right.propertyType) {
      throw new DomainError(
        `"${conditionText(condition)}" compares ${left.propertyType} with ${right.propertyType}; ` +
        `"containsAny" needs both sides to hold the same type.`
      );
    }
  }

  // `contains` asks one thing of its two sides, and it is worth
  // stating: a list on the left, one value on the right.
  for (const condition of body.conditions || []) {
    if (!condition || condition.predicate !== 'contains') continue;
    const left = conditionOperandType(ctx, body, condition, condition.leftHandSide);
    const right = conditionOperandType(ctx, body, condition, condition.rightHandSide);
    if (left && !left.isList) {
      throw new DomainError(
        `Left side of "${conditionText(condition)}" is not a list — ` +
        `"contains" asks whether a list holds one value.`
      );
    }
    if (right && right.isList) {
      throw new DomainError(
        `Right side of "${conditionText(condition)}" is a list — "contains" looks for one value. ` +
        `"containsAny" is the one that intersects two lists.`
      );
    }
    if (left && right && left.propertyType !== right.propertyType) {
      throw new DomainError(
        `"${conditionText(condition)}" looks for ${right.propertyType} ` +
        `in a list of ${left.propertyType}.`
      );
    }
  }

  const commandProperties = new Set((body.properties || []).map((p) => p.name));
  let failure = null;
  forEachCommandOperand(body, (operand, meta) => {
    if (failure) return;
    assertRecognisedOperand(operand, meta.where);
    const source = operandSource(operand);
    if (source === 'parameter' && !commandProperties.has(operand.parameterName)) {
      failure = `${meta.where} reads parameter "${operand.parameterName}", which the command does not declare.`;
      return;
    }
    if (source === 'parameter' && operand.property) {
      const parameter = (body.properties || []).find((p) => p.name === operand.parameterName);
      const fields = parameter && compositeFieldsOf(ctx, parameter.propertyType);
      if (!fields) {
        failure = `${meta.where} reads "${operandText(operand)}", but "${operand.parameterName}" is typed `
          + `${parameter ? `"${parameter.propertyType}"` : '?'}, which has no fields.`;
        return;
      }
      if (!fields.some((f) => f.name === operand.property)) {
        failure = `${meta.where} reads "${operandText(operand)}", but `
          + `"${parameter.propertyType}" has no field "${operand.property}".`;
        return;
      }
    }
    if (source === 'alias-property') {
      const binding = boundary.find((b) => b.alias === operand.alias);
      if (!binding) {
        failure = `${meta.where} reads "${operandText(operand)}", but "${operand.alias}" is not bound in the boundary.`;
        return;
      }
      // A projection holds one value and has no name for it, so the
      // alias alone names it. An entity holds many, so it cannot.
      if (binding.projection) {
        if (operand.property) {
          failure = `${meta.where} reads "${operandText(operand)}", but "${operand.alias}" binds the `
            + `projection "${binding.projection}", which holds one value and no property "${operand.property}".`;
        }
        return;
      }
      if (!operand.property) {
        failure = `${meta.where} reads "${operand.alias}" with no property, but "${operand.alias}" binds `
          + `${binding.entity}, which holds many — name the one it means.`;
        return;
      }
      const entity = ctx['entity-definitions'][binding.entity];
      const known = entity && (entity.properties || []).some((p) => p.name === operand.property);
      if (!known) {
        failure = `${meta.where} reads "${operandText(operand)}", but ${binding.entity} has no property "${operand.property}".`;
      }
    }
  });
  if (failure) throw new DomainError(failure);

  // A scripted property is read with the arguments its script asks
  // for, so the binding that reads one has to supply them. The converse
  // is an error too, exactly as `excluding` on a singular binding is: a
  // field that cannot apply here was written under a misunderstanding,
  // and saying so is more use than quietly ignoring it.
  for (const binding of boundary) {
    if (binding.projection !== undefined) continue;
    const entity = ctx['entity-definitions'][binding.entity];
    if (!entity) continue;
    const expected = argumentsExpected(ctx, body, binding);
    const supplied = Object.keys(binding.arguments || {});
    for (const argument of expected) {
      if (!supplied.includes(argument.name)) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" supplies no "${argument.name}", which a scripted ` +
          `${binding.entity} property it reads asks for.`
        );
      }
    }
    for (const key of supplied) {
      const argument = expected.find((a) => a.name === key);
      if (!argument) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" supplies "${key}", but nothing it reads asks for ` +
          `it — every ${binding.entity} property it consults is declared, not scripted.`
        );
      }
      const operand = binding.arguments[key];
      const resolved = resolveOperandType(operand, {
        boundary, commandProperties: body.properties || [], ctx,
      });
      if (resolved && (resolved.propertyType !== argument.propertyType || resolved.isList)) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" supplies "${key}" as ` +
          `${resolved.propertyType}${resolved.isList ? '[]' : ''}, but it is declared ` +
          `${argument.propertyType}.`
        );
      }
      if (operandSource(operand) !== 'alias-property') continue;
      if (operand.alias === binding.alias) {
        throw new DomainError(`Boundary binding "${binding.alias}" takes an argument from itself.`);
      }
    }
  }

  // Enum members are checked against the alias property they sit
  // opposite, which is where a status comparison always appears.
  for (const condition of body.conditions || []) {
    if (!condition || condition.rightHandSide === undefined) continue;
    const sides = [[condition.leftHandSide, condition.rightHandSide], [condition.rightHandSide, condition.leftHandSide]];
    for (const [maybeEnum, other] of sides) {
      if (operandSource(maybeEnum) !== 'enum-member') continue;
      if (operandSource(other) !== 'alias-property') continue;
      const binding = boundary.find((b) => b.alias === other.alias);
      if (!binding) continue;
      const entity = ctx['entity-definitions'][binding.entity];
      const property = (entity.properties || []).find((p) => p.name === other.property);
      if (!property) continue;
      const members = enumMembersFor(ctx, property.propertyType);
      if (members && !members.includes(maybeEnum.enumMember)) {
        throw new DomainError(
          `"${maybeEnum.enumMember}" is not a member of ${property.propertyType} ` +
          `(condition "${conditionText(condition)}").`
        );
      }
    }
  }

  if (!body.publishes || body.publishes.length === 0) {
    throw new DomainError('A command must publish at least one event.');
  }

  const issues = coverageIssues(ctx, body);
  if (issues.length > 0) {
    const first = issues[0];
    // Two different failures wear the same name. Either the emission
    // gives the tag field no value at all — in which case there is no
    // instance to talk about yet — or it gives one the boundary never
    // consulted. Saying "writes the tag Course:null" for the first is
    // an answer to a question nobody asked.
    throw new DomainError(
      first.operand === undefined
        ? `Write coverage: "${first.event}.${first.property}" is a ${first.entity} tag, and this ` +
          `command gives it no value. Say where it comes from, then bind that instance in the boundary.`
        : `Write coverage: "${first.event}.${first.property}" writes the tag ` +
          `${first.entity}:${operandText(first.operand)}, which the boundary does not consult. ` +
          `Bind that instance in the boundary first.`
    );
  }
}

// ============================================================
// Scenarios.
//
// One command, exercised. `given` is a log written by hand rather than
// driven — events with their payloads and the instant each was
// recorded; `when` is the command and the arguments it is called with;
// `then` is what the current definitions make of that, frozen at the
// moment it was accepted.
//
// The freezing is the whole mechanism. `then` is *derived* — nothing
// here asks a modeler to predict it — but it is stored, so the next
// evaluation either agrees with it or does not, and a disagreement is
// the report that some edit changed this command's behaviour.
//
// `outcome` is a discriminator rather than a union, so publishing an
// alternative event on refusal later is a change to what a `rejected`
// outcome carries rather than a change to the shape every stored
// scenario was written in.
//
// What is deliberately *not* checked here is the value in a payload
// against the type it is declared with: a `CourseId` with a pattern is
// stored as whatever was typed. Structure is checked — every property
// present, no property invented, a list where a list is declared — and
// the rest is the evaluator's to discover.
// ============================================================

function validateScenarioBody(ctx, body) {
  if (body.name !== undefined && typeof body.name !== 'string') {
    throw new DomainError('A scenario name is text, or absent when the derived one will do.');
  }
  if (!body.command) throw new DomainError('A scenario has to name the command it exercises.');
  const command = ctx['command-definitions'][body.command];

  // Checks a stored payload against the properties it is written from.
  // Both directions matter: a missing one cannot be evaluated, and an
  // invented one is a reference nothing would ever rewrite.
  const checkPayload = (values, properties, label) => {
    const held = values || {};
    const declared = new Set();
    for (const property of properties || []) {
      declared.add(property.name);
      if (!(property.name in held)) {
        throw new DomainError(`${label} carries no value for "${property.name}".`);
      }
      if (property.isList && !Array.isArray(held[property.name])) {
        throw new DomainError(`${label} declares "${property.name}" as a list, so its value must be one.`);
      }
    }
    for (const name of Object.keys(held)) {
      if (!declared.has(name)) {
        throw new DomainError(`${label} carries "${name}", which is not one of its properties.`);
      }
    }
  };

  if (!Array.isArray(body.given)) {
    throw new DomainError('A scenario\'s Given is a list of events, empty when nothing has happened yet.');
  }
  body.given.forEach((step, index) => {
    const where = `Given step ${index + 1}`;
    if (!step || !step.event) throw new DomainError(`${where} names no event.`);
    if (!Number.isInteger(step.recordedAt)) {
      throw new DomainError(
        `${where} has no instant it was recorded at. Every Given event carries one, or a ` +
        'projection that reads the envelope would replay differently every time.'
      );
    }
    checkPayload(step.data, (ctx['event-definitions'][step.event] || {}).properties,
      `${where} ("${step.event}")`);
  });

  const when = body.when || {};
  checkPayload(when.arguments, (command || {}).properties, `The When ("${body.command}")`);

  const then = body.then;
  if (!then || (then.outcome !== 'published' && then.outcome !== 'rejected')) {
    throw new DomainError('A scenario\'s Then is either published or rejected.');
  }
  if (!Array.isArray(then.events)) {
    throw new DomainError('A scenario\'s Then holds the events it expects, empty when it expects none.');
  }
  then.events.forEach((event, index) => {
    if (!event || !event.type) throw new DomainError(`Expected event ${index + 1} names no type.`);
    checkPayload(event.data, (ctx['event-definitions'][event.type] || {}).properties,
      `Expected event ${index + 1} ("${event.type}")`);
  });
  if (then.outcome === 'rejected' && !then.failedRule) {
    throw new DomainError('A scenario that expects a refusal has to say which rule refused it.');
  }
}

// One entity instance, exercised by replay rather than by a command:
// `given` is the same shape a scenario's is, but there is no `when` to
// call and no boundary to infer an instance from, so `forInstance`
// names it outright. `then` is *derived*, exactly like a scenario's,
// but partial — only the properties a modeler chose to check appear,
// each frozen at the moment it was accepted.
function validateSpecificationBody(ctx, body) {
  if (body.name !== undefined && typeof body.name !== 'string') {
    throw new DomainError('A specification name is text, or absent when the derived one will do.');
  }
  if (!body.entity) throw new DomainError('A specification has to name the entity it tests.');
  const entity = ctx['entity-definitions'][body.entity];
  if (typeof body.forInstance !== 'string' || !body.forInstance.trim()) {
    throw new DomainError('A specification has to say which instance it tests.');
  }

  const checkPayload = (values, properties, label) => {
    const held = values || {};
    const declared = new Set();
    for (const property of properties || []) {
      declared.add(property.name);
      if (!(property.name in held)) {
        throw new DomainError(`${label} carries no value for "${property.name}".`);
      }
      if (property.isList && !Array.isArray(held[property.name])) {
        throw new DomainError(`${label} declares "${property.name}" as a list, so its value must be one.`);
      }
    }
    for (const name of Object.keys(held)) {
      if (!declared.has(name)) {
        throw new DomainError(`${label} carries "${name}", which is not one of its properties.`);
      }
    }
  };

  if (!Array.isArray(body.given)) {
    throw new DomainError('A specification\'s Given is a list of events, empty when nothing has happened yet.');
  }
  body.given.forEach((step, index) => {
    const where = `Given step ${index + 1}`;
    if (!step || !step.event) throw new DomainError(`${where} names no event.`);
    if (!Number.isInteger(step.recordedAt)) {
      throw new DomainError(
        `${where} has no instant it was recorded at. Every Given event carries one, or a ` +
        'projection that reads the envelope would replay differently every time.'
      );
    }
    checkPayload(step.data, (ctx['event-definitions'][step.event] || {}).properties,
      `${where} ("${step.event}")`);
  });

  const then = body.then;
  if (!then || typeof then !== 'object' || Array.isArray(then)) {
    throw new DomainError('A specification\'s Then holds the properties it checks, empty when it checks none.');
  }
  const propertyNames = new Set((entity ? entity.properties : []).map((p) => p.name));
  for (const propertyName of Object.keys(then)) {
    if (!propertyNames.has(propertyName)) {
      throw new DomainError(`Then checks "${propertyName}", which "${body.entity}" has no property called.`);
    }
  }
}

function addDefinition(kind, ctxId, name, body) {
  const ctx = getCtxOrThrow(ctxId);
  const trimmed = validateDefinitionKey(kind, name, `${humanize(kind)} name`);
  const coll = ctx[DEF_COLLECTIONS[kind]];
  if (trimmed in coll) {
    throw new DomainError(`A ${humanize(kind)} named "${trimmed}" already exists in this context.`);
  }
  if (kind === 'entity-definition') assertDerivedNamesFree(ctx, trimmed, null);
  if (kind === 'custom-type-definition') assertCustomTypeNameFree(ctx, trimmed);
  validateReferences(ctx, kind, trimmed, body);
  appendEvents([{ type: `${kind}-added`, data: { 'dcb-context-id': ctxId, name: trimmed, body } }]);
}

function updateDefinition(kind, ctxId, name, body) {
  const ctx = getCtxOrThrow(ctxId);
  const coll = ctx[DEF_COLLECTIONS[kind]];
  if (!(name in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${name}" exists in this context.`);
  }
  validateReferences(ctx, kind, name, body);
  if (kind === 'entity-definition') assertEntityUpdateKeepsInboundReferences(ctx, name, body);
  if (kind === 'custom-type-definition') assertCustomTypeUpdateKeepsInboundReferences(ctx, name, body);
  if (kind === 'projection-definition') assertProjectionUpdateKeepsBindingsFitting(ctx, name, body);
  appendEvents([{ type: `${kind}-updated`, data: { 'dcb-context-id': ctxId, name, body } }]);
}

// A projection's parameters are supplied by *key*, so changing them
// under a command that binds it would leave that command holding
// arguments for a partition that no longer exists. Renaming one is a
// `renameMember` — which moves the keys in the same append — and this
// is what stops it happening any other way.
function assertProjectionUpdateKeepsBindingsFitting(ctx, projectionName, body) {
  const parameters = (body.parameters || []).map((p) => p && p.name);
  for (const [commandName, command] of Object.entries(ctx['command-definitions'])) {
    for (const binding of command.boundary || []) {
      if (!binding || binding.projection !== projectionName) continue;
      const supplied = Object.keys(binding.arguments || {});
      const missing = parameters.filter((p) => !supplied.includes(p));
      const extra = supplied.filter((s) => !parameters.includes(s));
      if (!missing.length && !extra.length) continue;
      throw new DomainError(
        `Command "${commandName}" binds "${projectionName}" as "${binding.alias}" and would be left `
        + (missing.length ? `without ${missing.map((m) => `"${m}"`).join(', ')}` : '')
        + (missing.length && extra.length ? ', and ' : '')
        + (extra.length ? `supplying ${extra.map((e) => `"${e}"`).join(', ')}, which it no longer declares` : '')
        + '. Rename the parameter instead, which moves the binding with it.'
      );
    }
  }
}

// Dropping a property that a command still reads is refused rather
// than silently breaking the command.
function assertEntityUpdateKeepsInboundReferences(ctx, entityName, body) {
  const propertyNames = new Set((body.properties || []).map((p) => p.name));
  for (const [commandName, command] of Object.entries(ctx['command-definitions'])) {
    const aliases = (command.boundary || [])
      .filter((b) => b && b.entity === entityName)
      .map((b) => b.alias);
    if (aliases.length === 0) continue;

    let failure = null;
    forEachCommandOperand(command, (operand) => {
      if (failure) return;
      if (operandSource(operand) === 'alias-property'
          && aliases.includes(operand.alias)
          && !propertyNames.has(operand.property)) {
        failure = `property "${operand.property}"`;
      }
    });
    if (failure) {
      throw new DomainError(
        `Cannot drop ${failure} from "${entityName}" — command "${commandName}" still reads it.`
      );
    }
  }
}

// Dropping a member of an enum custom type that a command still
// compares against is refused rather than silently breaking the
// command. Scoped to the type itself rather than to one entity, since
// any number of properties across any number of entities may now
// reference it. Mirrors `assertEntityUpdateKeepsInboundReferences`
// exactly, checking conditions only — the same narrower guarantee the
// reserved status property carried before it.
function assertCustomTypeUpdateKeepsInboundReferences(ctx, typeName, body) {
  const previousMembers = enumMembersFor(ctx, typeName);
  if (!previousMembers) return;
  const nextMembers = new Set(
    Array.isArray(body.schema && body.schema.enum) ? body.schema.enum : []
  );
  for (const [commandName, command] of Object.entries(ctx['command-definitions'])) {
    for (const condition of command.conditions || []) {
      if (!condition) continue;
      for (const side of [condition.leftHandSide, condition.rightHandSide]) {
        if (operandSource(side) !== 'enum-member') continue;
        if (nextMembers.has(side.enumMember) || !previousMembers.includes(side.enumMember)) continue;
        const other = side === condition.leftHandSide ? condition.rightHandSide : condition.leftHandSide;
        const resolved = resolveOperandType(other, {
          boundary: command.boundary || [],
          commandProperties: command.properties || [],
          ctx,
        });
        if (resolved && resolved.propertyType === typeName) {
          throw new DomainError(
            `Cannot drop member "${side.enumMember}" from "${typeName}" — command "${commandName}" still compares against it.`
          );
        }
      }
    }
  }
}

// Everything scripted that handles this event, named the way a person
// would say it: "Product.validPrices", "ValidPrices".
//
// Renaming an event or one of its properties rewrites every declared
// operand that names it. It cannot rewrite code — the model does not
// parse the body, and a textual pass over an unparsed language would
// eventually rewrite a comment or a string literal and corrupt someone
// else's work. So the rename goes through and this says what to check.
function scriptedHandlersOf(ctx, eventName) {
  const out = [];
  const handles = (target) => (target.handlers || []).some((h) => h && h.event === eventName);
  for (const [name, entity] of Object.entries(ctx['entity-definitions'])) {
    for (const property of entity.properties || []) {
      if (scriptOf(property) && handles(property)) out.push(`${name}.${property.name}`);
    }
  }
  for (const [name, projection] of Object.entries(ctx['projection-definitions'])) {
    if (scriptOf(projection) && handles(projection)) out.push(name);
  }
  return out;
}

function renameDefinition(kind, ctxId, previousName, newName) {
  const ctx = getCtxOrThrow(ctxId);
  if (isIdKeyed(kind)) {
    throw new DomainError(
      `A ${humanize(kind)} is identified by a generated id and its name lives in its body, ` +
      'so renaming one is an ordinary update rather than a rename.'
    );
  }
  const trimmed = validateName(newName, `New ${humanize(kind)} name`);
  const coll = ctx[DEF_COLLECTIONS[kind]];
  if (!(previousName in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${previousName}" exists in this context.`);
  }
  if (trimmed === previousName) return;
  if (trimmed in coll) {
    throw new DomainError(`A ${humanize(kind)} named "${trimmed}" already exists in this context.`);
  }
  if (kind === 'entity-definition') assertDerivedNamesFree(ctx, trimmed, previousName);
  if (kind === 'custom-type-definition') assertCustomTypeNameFree(ctx, trimmed);

  const referencers = findReferencers(ctx, kind, previousName);
  const events = [{
    type: `${kind}-renamed`,
    data: { 'dcb-context-id': ctxId, 'previous-name': previousName, name: trimmed },
  }];
  for (const ref of referencers) {
    // An entity can reference itself — a property typed with its own
    // derived `<Entity>Id`, for a hierarchy. That rewrite lands on the
    // new name, since the rename event is applied first.
    const isSelf = ref.kind === kind && ref.name === previousName;
    const rewritten = rewriteReferences(ref.kind, ref.body, kind, previousName, trimmed);
    events.push({
      type: `${ref.kind}-updated`,
      data: { 'dcb-context-id': ctxId, name: isSelf ? trimmed : ref.name, body: rewritten },
    });
  }
  appendEvents(events);
}

// ------------------------------------------------------------
// Member renames.
//
// A definition's *members* — an entity's properties and statuses, an
// event's properties, a command's payload, a composite's fields, a
// projection's parameters — are referenced by name just as definitions
// are, so renaming one has to rewrite those references in the same
// append. Doing it as a plain update would be refused on the way past
// `assertEntityUpdateKeepsInboundReferences`, and rightly: mid-rename
// the old name is gone while something still reads it.
//
// Unlike a definition rename there is no `-renamed` event to emit. A
// member lives inside a body, so the whole thing is a set of
// `<kind>-updated` events — one for the owner, one per referrer.
// ------------------------------------------------------------

// Walks a handler value, stepping through `successor` to whatever it
// wraps, and rewrites in place.
function rewriteHandlerOperand(operand, visit) {
  if (!operand || typeof operand !== 'object') return;
  if (operand.successor !== undefined) return rewriteHandlerOperand(operand.successor, visit);
  visit(operand);
}

// Renames a key of an object while keeping declaration order, which is
// what makes an emission's parameters and a binding's arguments read
// the same after a rename as before it.
function renameKey(object, previousName, newName) {
  if (!object || !(previousName in object)) return object;
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    out[key === previousName ? newName : key] = value;
  }
  return out;
}

// A member kind's list usually sits at the top of its body
// (`properties`, `parameters`); an enum's sits at `schema.enum`, one
// level in. Read and write through a dotted path so `MEMBER_SHAPE` can
// name either uniformly. Named distinctly from the interface's own
// `atPath`/`setAtPath` (which walk an array of keys, not a dotted
// string) — model.js and index.html share one global scope as classic
// scripts, and a same-named `function` declared in either would
// silently win over the other's.
function getAtDottedPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setAtDottedPath(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (target[keys[i]] == null || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
}

// The rewrites each member kind implies, as
// `(ctx, definitionName, previous, next) => [{kind, name, body}]`.
const MEMBER_REWRITES = {
  // An entity property is read as `{alias, property}` by any command
  // that binds this entity under that alias.
  'entity-definition:property': (ctx, entityName, previous, next) =>
    rewriteCommands(ctx, (command) => {
      const aliases = (command.boundary || [])
        .filter((b) => b && b.entity === entityName).map((b) => b.alias);
      let touched = false;
      forEachCommandOperand(command, (operand) => {
        if (operandSource(operand) === 'alias-property'
            && aliases.includes(operand.alias) && operand.property === previous) {
          operand.property = next;
          touched = true;
        }
      });
      return touched;
    }),

  // An enum member is an `{enumMember}` operand. The type it belongs to
  // may now be referenced by properties on any number of entities, so
  // this reaches every one of them rather than one private owner.
  'custom-type-definition:member': (ctx, typeName, previous, next) => {
    const out = [];

    // Every entity property typed with this enum refers to its own
    // members through its initial value and its handler values.
    for (const [entityName, entity] of Object.entries(ctx['entity-definitions'])) {
      const body = deepClone(entity);
      let touched = false;
      for (const property of body.properties || []) {
        if (property.propertyType !== typeName) continue;
        if (operandSource(property.initialValue) === 'enum-member'
            && property.initialValue.enumMember === previous) {
          property.initialValue = { enumMember: next };
          touched = true;
        }
        for (const handler of property.handlers || []) {
          rewriteHandlerOperand(handler && handler.value, (operand) => {
            if (operand.enumMember === previous) { operand.enumMember = next; touched = true; }
          });
        }
      }
      if (touched) out.push({ kind: 'entity-definition', name: entityName, body });
    }

    // A command condition compares an entity's enum-typed property
    // against a member by value — resolved through the boundary rather
    // than assumed, since the bound entity is whichever the alias names.
    out.push(...rewriteCommands(ctx, (command) => {
      let touched = false;
      for (const condition of command.conditions || []) {
        if (!condition) continue;
        const sides = [
          [condition.leftHandSide, condition.rightHandSide],
          [condition.rightHandSide, condition.leftHandSide],
        ];
        for (const [maybeEnum, other] of sides) {
          if (operandSource(maybeEnum) !== 'enum-member' || maybeEnum.enumMember !== previous) continue;
          if (operandSource(other) !== 'alias-property') continue;
          const resolved = resolveOperandType(other, {
            boundary: command.boundary || [],
            commandProperties: command.properties || [],
            ctx,
          });
          if (!resolved || resolved.propertyType !== typeName) continue;
          maybeEnum.enumMember = next;
          touched = true;
        }
      }
      return touched;
    }));

    return out;
  },

  // An event property is read by whatever handles the event, and written
  // by whatever emits it.
  'event-definition:property': (ctx, eventName, previous, next) => {
    const out = [];
    const handlesIt = (handlers) => (handlers || []).some((h) => h && h.event === eventName);

    for (const [name, entity] of Object.entries(ctx['entity-definitions'])) {
      const body = deepClone(entity);
      let touched = false;
      for (const property of body.properties || []) {
        for (const handler of property.handlers || []) {
          if (!handler || handler.event !== eventName) continue;
          rewriteHandlerOperand(handler.value, (operand) => {
            if (operand.eventProperty === previous) { operand.eventProperty = next; touched = true; }
          });
        }
      }
      if (touched) out.push({ kind: 'entity-definition', name, body });
    }

    for (const [name, projection] of Object.entries(ctx['projection-definitions'])) {
      if (!handlesIt(projection.handlers)) continue;
      const body = deepClone(projection);
      let touched = false;
      for (const handler of body.handlers || []) {
        if (!handler || handler.event !== eventName) continue;
        rewriteHandlerOperand(handler.value, (operand) => {
          if (operand.eventProperty === previous) { operand.eventProperty = next; touched = true; }
        });
      }
      if (touched) out.push({ kind: 'projection-definition', name, body });
    }

    // An emission binds by *key*, so this is a key rename rather than
    // an operand rewrite.
    out.push(...rewriteCommands(ctx, (command) => {
      let touched = false;
      for (const emission of command.publishes || []) {
        if (!emission || emission.name !== eventName) continue;
        if (emission.parameters && previous in emission.parameters) {
          emission.parameters = renameKey(emission.parameters, previous, next);
          touched = true;
        }
      }
      return touched;
    }));

    // A scenario holds this event's payload by key, in its Given and in
    // the outcome it expects.
    out.push(...rewriteScenarios(ctx, (scenario) => {
      let touched = false;
      for (const payload of scenarioPayloads(ctx, scenario)) {
        if (payload.event !== eventName) continue;
        if (payload.owner[payload.key] && previous in payload.owner[payload.key]) {
          payload.owner[payload.key] = renameKey(payload.owner[payload.key], previous, next);
          touched = true;
        }
      }
      return touched;
    }));
    return out;
  },

  // A command's payload is local to it — except that every scenario
  // exercising it supplies that payload by key.
  'command-definition:property': (ctx, commandName, previous, next) => [
    ...rewriteCommands(ctx, (command, name) => {
      if (name !== commandName) return false;
      let touched = false;
      forEachCommandOperand(command, (operand) => {
        if (operandSource(operand) === 'parameter' && operand.parameterName === previous) {
          operand.parameterName = next;
          touched = true;
        }
      });
      return touched;
    }),
    ...rewriteScenarios(ctx, (scenario) => {
      if (scenario.command !== commandName) return false;
      const when = scenario.when;
      if (!when || !when.arguments || !(previous in when.arguments)) return false;
      when.arguments = renameKey(when.arguments, previous, next);
      return true;
    }),
  ],

  // A composite's field is reached only through a parameter typed with
  // that composite — `{parameterName: items, property: productId}`.
  'custom-type-definition:field': (ctx, typeName, previous, next) => [
    ...rewriteCommands(ctx, (command) => {
      const parameters = new Set((command.properties || [])
        .filter((p) => p.propertyType === typeName).map((p) => p.name));
      let touched = false;
      forEachCommandOperand(command, (operand) => {
        if (operandSource(operand) === 'parameter'
            && parameters.has(operand.parameterName) && operand.property === previous) {
          operand.property = next;
          touched = true;
        }
      });
      return touched;
    }),
    // A scenario holds composites as values, so the field name is a key
    // inside the payload rather than a reference beside it — one level
    // deeper than anywhere else this rename reaches.
    ...rewriteScenarios(ctx, (scenario) => {
      let touched = false;
      for (const payload of scenarioPayloads(ctx, scenario)) {
        const held = payload.owner[payload.key] || {};
        for (const property of payload.properties || []) {
          if (property.propertyType !== typeName) continue;
          const value = held[property.name];
          const elements = property.isList ? (Array.isArray(value) ? value : []) : [value];
          elements.forEach((element, index) => {
            if (!element || typeof element !== 'object' || !(previous in element)) return;
            const renamed = renameKey(element, previous, next);
            if (property.isList) value[index] = renamed;
            else held[property.name] = renamed;
            touched = true;
          });
        }
      }
      return touched;
    }),
  ],

  // A projection parameter is supplied by key in a binding.
  'projection-definition:parameter': (ctx, projectionName, previous, next) =>
    rewriteCommands(ctx, (command) => {
      let touched = false;
      for (const binding of command.boundary || []) {
        if (!binding || binding.projection !== projectionName) continue;
        if (binding.arguments && previous in binding.arguments) {
          binding.arguments = renameKey(binding.arguments, previous, next);
          touched = true;
        }
      }
      return touched;
    }),
};

// Applies `mutate` to a deep copy of every scenario and returns the ones
// it actually changed.
//
// A scenario stores *values* where a definition stores references, so
// what a member rename moves here is the keys of a payload rather than
// an operand. Renaming an event's property has to move that key in
// every Given step written from it and in every expected event holding
// it, or the scenario would report the rename as a change in behaviour.
function rewriteScenarios(ctx, mutate) {
  const out = [];
  for (const [name, scenario] of Object.entries(ctx['scenario-definitions'] || {})) {
    const body = deepClone(scenario);
    if (mutate(body, name)) out.push({ kind: 'scenario-definition', name, body });
  }
  return out;
}

// Every payload a scenario holds, paired with the definition its keys
// are written from. One walk serves both the event-property rename and
// the composite-field rename, which reach the same objects by different
// routes.
function scenarioPayloads(ctx, scenario) {
  const out = [];
  for (const step of scenario.given || []) {
    if (!step || !step.event) continue;
    const event = ctx['event-definitions'][step.event];
    if (event) out.push({ owner: step, key: 'data', event: step.event, properties: event.properties });
  }
  for (const event of (scenario.then || {}).events || []) {
    if (!event || !event.type) continue;
    const definition = ctx['event-definitions'][event.type];
    if (definition) {
      out.push({ owner: event, key: 'data', event: event.type, properties: definition.properties });
    }
  }
  const command = ctx['command-definitions'][scenario.command];
  if (command && scenario.when) {
    out.push({ owner: scenario.when, key: 'arguments', command: scenario.command,
      properties: command.properties });
  }
  return out;
}

// Applies `mutate` to a deep copy of every command and returns the ones
// it actually changed.
function rewriteCommands(ctx, mutate) {
  const out = [];
  for (const [name, command] of Object.entries(ctx['command-definitions'])) {
    const body = deepClone(command);
    if (mutate(body, name)) out.push({ kind: 'command-definition', name, body });
  }
  return out;
}

// Where a member of each kind lives inside its body, and what its name
// has to look like. `list` is a dotted path — flat for most kinds, but
// an enum's members sit at `schema.enum`, one level into the custom
// type's JSON Schema. A JSON Schema `enum` may legally hold any value;
// this entry — and the chip editor it drives — only ever runs against
// a string-only enum, so the pattern only has strings to say no to.
const MEMBER_SHAPE = {
  property: { list: 'properties', named: true, label: 'Property', pattern: CAMEL_RE, style: 'camelCase' },
  member: { list: 'schema.enum', named: false, label: 'Member', pattern: /^.+$/, style: 'a non-empty string' },
  field: { list: 'properties', named: true, label: 'Field', pattern: CAMEL_RE, style: 'camelCase' },
  parameter: { list: 'parameters', named: true, label: 'Parameter', pattern: CAMEL_RE, style: 'camelCase' },
};

function renameMember(kind, ctxId, definitionName, memberKind, previousName, newName) {
  const ctx = getCtxOrThrow(ctxId);
  const body = (ctx[DEF_COLLECTIONS[kind]] || {})[definitionName];
  if (!body) {
    throw new DomainError(`No ${humanize(kind)} named "${definitionName}" exists in this context.`);
  }
  const shape = MEMBER_SHAPE[memberKind];
  const rewrite = MEMBER_REWRITES[`${kind}:${memberKind}`];
  if (!shape || !rewrite) {
    throw new DomainError(`A ${humanize(kind)} has no ${memberKind} to rename.`);
  }

  const trimmed = (newName || '').trim();
  if (!shape.pattern.test(trimmed)) {
    throw new DomainError(`${shape.label} name "${trimmed}" must be ${shape.style}.`);
  }
  if (trimmed === previousName) return;

  const members = getAtDottedPath(body, shape.list) || [];
  const nameOf = (m) => (shape.named ? m && m.name : m);
  if (!members.some((m) => nameOf(m) === previousName)) {
    throw new DomainError(
      `${humanize(kind)} "${definitionName}" has no ${memberKind} "${previousName}".`
    );
  }
  if (members.some((m) => nameOf(m) === trimmed)) {
    throw new DomainError(
      `${humanize(kind)} "${definitionName}" already has a ${memberKind} named "${trimmed}".`
    );
  }

  // A rewrite fixes *references*; the member list itself is renamed
  // here, uniformly, so each rewrite has one job. When a rewrite also
  // lands on the owning definition, its body is the one the list
  // rename is applied to.
  const rewrites = rewrite(ctx, definitionName, previousName, trimmed);
  const ownerRewrite = rewrites.find((r) => r.kind === kind && r.name === definitionName);
  const ownerBody = deepClone(ownerRewrite ? ownerRewrite.body : body);
  setAtDottedPath(ownerBody, shape.list, (getAtDottedPath(ownerBody, shape.list) || []).map((m) => {
    if (!shape.named) return m === previousName ? trimmed : m;
    return m && m.name === previousName ? { ...m, name: trimmed } : m;
  }));

  const events = [{
    type: `${kind}-updated`,
    data: { 'dcb-context-id': ctxId, name: definitionName, body: ownerBody },
  }];
  for (const r of rewrites) {
    if (r.kind === kind && r.name === definitionName) continue;
    events.push({
      type: `${r.kind}-updated`,
      data: { 'dcb-context-id': ctxId, name: r.name, body: r.body },
    });
  }
  appendEvents(events);
}

function removeDefinition(kind, ctxId, name) {
  const ctx = getCtxOrThrow(ctxId);
  const coll = ctx[DEF_COLLECTIONS[kind]];
  if (!(name in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${name}" exists in this context.`);
  }
  const referencers = findReferencers(ctx, kind, name)
    .filter((r) => !(r.kind === kind && r.name === name))
    // A scenario or specification names what it tests, but it may
    // never refuse the change: a test exists to report what a change
    // broke, not to prevent it. Deleting what one reads leaves it
    // broken and says so, which is the whole point of keeping it.
    .filter((r) => r.kind !== 'scenario-definition' && r.kind !== 'specification-definition');
  if (referencers.length > 0) {
    const list = referencers.map((r) => `${humanize(r.kind)} "${r.name}"`).join(', ');
    throw new DomainError(`Cannot remove ${humanize(kind)} "${name}" — still referenced by: ${list}.`);
  }
  appendEvents([{ type: `${kind}-removed`, data: { 'dcb-context-id': ctxId, name } }]);
}


// ============================================================
// Utilities the model layer leans on.
// ============================================================

// The value a freshly created property starts from, chosen from its
// type so a modeler never has to state one.
function defaultInitialValue(ctx, property) {
  if (property.isList) return [];
  const members = enumMembersFor(ctx, property.propertyType);
  if (members) return { enumMember: members[0] || '' };
  if (property.isOptional) return null;
  if (property.propertyType === 'integer' || property.propertyType === 'timestamp') return 0;
  if (property.propertyType === 'boolean') return false;
  return '';
}

function humanize(kind) {
  return kind.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
}

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

// ============================================================
// Predefined contexts.
//
// Two models, each built in layers, because that is the order the
// design was arrived at: a course-subscription model as the plain
// thing, then generated identifiers, then schedules; and a product
// pricing model as the plain thing, then a grace period on repricing.
// Each layer is applied through the ordinary commands, so loading one
// exercises exactly the same validation an author would hit typing it
// in.
//
// Every layer keeps references resolvable at each step — entities
// first without handlers (nothing to reference yet), then the events,
// then the entities again with their handlers, then the commands.
// ============================================================

const seedProperty = (name, type, initialValue, extra = {}) => ({
  name, propertyType: type, isOptional: false, isList: false,
  initialValue, handlers: [], ...extra,
});
// A lifecycle enum is an ordinary scalar custom type whose schema
// carries `enum`, declared once and referenced from an ordinary
// `status` property — the same shape any other enum property has.
const seedEnumType = (name, members) => ({ schema: { type: 'string', enum: members } });
const seedStatusProperty = (statusType, first) =>
  seedProperty(STATUS_PROPERTY, statusType, { enumMember: first });
const seedProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: false });
const seedListProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: true });
const seedHandler = (event, operation, value) => ({ event, operation, value });
const seedParam = (name) => ({ parameterName: name });
// `{alias}` with no property reads a bound projection's single value.
const seedOf = (alias, property) => (property === undefined ? { alias } : { alias, property });
const seedBind = (alias, entity, idParam) => ({ alias, entity, id: seedParam(idParam) });
const seedReadProjection = (alias, projection, args = {}) =>
  ({ alias, projection, arguments: args });

// Reads a definition back and writes the modified copy, so a later
// layer never has to restate the shape an earlier one produced.
function seedPatch(kind, ctxId, name, mutate) {
  const body = deepClone(getCtxOrThrow(ctxId)[DEF_COLLECTIONS[kind]][name]);
  mutate(body);
  updateDefinition(kind, ctxId, name, body);
}

function seedBase(ctxId) {
  const property = seedProperty;
  const statusProperty = seedStatusProperty;
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const of = seedOf;
  const bind = seedBind;

  // 1. The lifecycle enums, declared like any other custom type. Then
  //    entities without handlers. Student first, since Course refers
  //    to StudentId.
  addDefinition('custom-type-definition', ctxId, 'StudentStatus', seedEnumType('StudentStatus', ['NonExistent', 'Existent']));
  addDefinition('custom-type-definition', ctxId, 'CourseStatus', seedEnumType('CourseStatus', ['NonExistent', 'Existent', 'Archived']));

  addDefinition('entity-definition', ctxId, 'Student', {
    icon: '🧑‍🎓',
    identifierSchema: { type: 'string' },
    properties: [
      statusProperty('StudentStatus', 'NonExistent'),
      property('subscriptionCount', 'integer', 0),
    ],
  });
  addDefinition('entity-definition', ctxId, 'Course', {
    icon: '📚',
    identifierSchema: { type: 'string' },
    properties: [
      statusProperty('CourseStatus', 'NonExistent'),
      property('capacity', 'integer', 0),
      property('subscriptionCount', 'integer', 0),
      property('subscribedStudentIds', 'StudentId', [], { isList: true }),
    ],
  });

  // 2. Events. Their entity-id properties are what carry the tags.
  const event = (name, properties) =>
    addDefinition('event-definition', ctxId, name, { properties });

  event('CourseDefined', [prop('courseId', 'CourseId'), prop('capacity', 'integer')]);
  event('CourseCapacityChanged', [prop('courseId', 'CourseId'), prop('newCapacity', 'integer')]);
  event('CourseArchived', [prop('courseId', 'CourseId')]);
  event('StudentRegistered', [prop('studentId', 'StudentId')]);
  event('StudentSubscribedToCourse', [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')]);
  event('StudentUnsubscribedFromCourse', [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')]);

  // 3. Entities again, now with handlers.
  updateDefinition('entity-definition', ctxId, 'Student', {
    icon: '🧑‍🎓',
    identifierSchema: { type: 'string' },
    properties: [
      { ...statusProperty('StudentStatus', 'NonExistent'),
        handlers: [handler('StudentRegistered', 'set', { enumMember: 'Existent' })] },
      { ...property('subscriptionCount', 'integer', 0),
        handlers: [
          handler('StudentSubscribedToCourse', 'increment', 1),
          handler('StudentUnsubscribedFromCourse', 'decrement', 1),
        ] },
    ],
  });
  updateDefinition('entity-definition', ctxId, 'Course', {
    icon: '📚',
    identifierSchema: { type: 'string' },
    properties: [
      { ...statusProperty('CourseStatus', 'NonExistent'),
        handlers: [
          handler('CourseDefined', 'set', { enumMember: 'Existent' }),
          handler('CourseArchived', 'set', { enumMember: 'Archived' }),
        ] },
      { ...property('capacity', 'integer', 0),
        handlers: [
          handler('CourseDefined', 'set', { eventProperty: 'capacity' }),
          handler('CourseCapacityChanged', 'set', { eventProperty: 'newCapacity' }),
        ] },
      { ...property('subscriptionCount', 'integer', 0),
        handlers: [
          handler('StudentSubscribedToCourse', 'increment', 1),
          handler('StudentUnsubscribedFromCourse', 'decrement', 1),
        ] },
      { ...property('subscribedStudentIds', 'StudentId', [], { isList: true }),
        handlers: [
          handler('StudentSubscribedToCourse', 'append', { eventProperty: 'studentId' }),
          handler('StudentUnsubscribedFromCourse', 'remove', { eventProperty: 'studentId' }),
        ] },
    ],
  });

  // 4. Commands. The boundary is the DCB.
  const command = (name, body) => addDefinition('command-definition', ctxId, name, body);

  command('DefineCourse', {
    feature: 'Course management',
    properties: [prop('courseId', 'CourseId'), prop('capacity', 'integer')],
    boundary: [bind('course', 'Course', 'courseId')],
    conditions: [
      { leftHandSide: of('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' } },
    ],
    publishes: [{
      name: 'CourseDefined',
      parameters: { courseId: param('courseId'), capacity: param('capacity') },
    }],
  });

  command('ChangeCourseCapacity', {
    feature: 'Course management',
    properties: [prop('courseId', 'CourseId'), prop('newCapacity', 'integer')],
    boundary: [bind('course', 'Course', 'courseId')],
    conditions: [
      { leftHandSide: of('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: of('course', 'subscriptionCount'), predicate: 'lessThanOrEquals', rightHandSide: param('newCapacity') },
    ],
    publishes: [{
      name: 'CourseCapacityChanged',
      parameters: { courseId: param('courseId'), newCapacity: param('newCapacity') },
    }],
  });

  command('ArchiveCourse', {
    feature: 'Course management',
    properties: [prop('courseId', 'CourseId')],
    boundary: [bind('course', 'Course', 'courseId')],
    conditions: [
      { leftHandSide: of('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
    ],
    publishes: [{ name: 'CourseArchived', parameters: { courseId: param('courseId') } }],
  });

  command('RegisterStudent', {
    feature: 'Student registration',
    properties: [prop('studentId', 'StudentId')],
    boundary: [bind('student', 'Student', 'studentId')],
    conditions: [
      { leftHandSide: of('student', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' } },
    ],
    publishes: [{ name: 'StudentRegistered', parameters: { studentId: param('studentId') } }],
  });

  command('SubscribeStudentToCourse', {
    feature: 'Enrolment',
    properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')],
    boundary: [bind('course', 'Course', 'courseId'), bind('student', 'Student', 'studentId')],
    conditions: [
      { leftHandSide: of('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: of('student', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: of('course', 'subscriptionCount'), predicate: 'lessThan', rightHandSide: of('course', 'capacity') },
      { leftHandSide: of('course', 'subscribedStudentIds'), predicate: 'contains', rightHandSide: param('studentId'), negate: true },
      { leftHandSide: of('student', 'subscriptionCount'), predicate: 'lessThan', rightHandSide: 10 },
    ],
    publishes: [{
      name: 'StudentSubscribedToCourse',
      parameters: { courseId: param('courseId'), studentId: param('studentId') },
    }],
  });

  command('UnsubscribeStudentFromCourse', {
    feature: 'Enrolment',
    properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')],
    boundary: [bind('course', 'Course', 'courseId'), bind('student', 'Student', 'studentId')],
    conditions: [
      { leftHandSide: of('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: of('course', 'subscribedStudentIds'), predicate: 'contains', rightHandSide: param('studentId') },
    ],
    publishes: [{
      name: 'StudentUnsubscribedFromCourse',
      parameters: { courseId: param('courseId'), studentId: param('studentId') },
    }],
  });
}

// Layer 2: course identifiers stop being supplied and start being
// issued. DefineCourse loses its identifier parameter and its "not
// already used" check, and gains a binding in their place — reading
// the projection contributes `types CourseDefined` to the append
// condition, which is what makes the numbering monotonic and what
// makes the check redundant.
//
// The numbering is an ordinary projection with no parameters: its
// value is set to the *successor* of the id each CourseDefined
// carried, so it holds the next number to issue at every point in its
// life — `c1` before anything has happened, `successor(last)` after.
// Project to the last id instead and `initialValue` would have to mean
// two different things depending on whether anything had happened yet.
function seedAddSequence(ctxId) {
  seedPatch('entity-definition', ctxId, 'Course', (course) => {
    course.identifierSchema = { type: 'string', pattern: '^c[0-9]+$' };
  });

  addDefinition('projection-definition', ctxId, 'CourseNumbering', {
    parameters: [],
    valueType: 'CourseId',
    isOptional: false,
    isList: false,
    initialValue: 'c1',
    handlers: [
      seedHandler('CourseDefined', 'set', { successor: { eventProperty: 'courseId' } }),
    ],
  });

  updateDefinition('command-definition', ctxId, 'DefineCourse', {
    feature: 'Course management',
    properties: [seedProp('capacity', 'integer')],
    boundary: [seedReadProjection('courseNumbering', 'CourseNumbering')],
    conditions: [],
    publishes: [{
      name: 'CourseDefined',
      parameters: {
        courseId: seedOf('courseNumbering'),
        capacity: seedParam('capacity'),
      },
    }],
  });
}

// Layer 3a: tenancy, and with it a *parameterised* projection.
//
// This is the case the old design could not express. It called
// numbering "global by nature" and gave a sequence no tag at all —
// which a numbering per tenant simply falsifies. A projection states
// its own partition, so restarting the numbering per tenant is one
// parameter and nothing else.
//
// Number is not identity. `CourseId` stays globally minted by the
// parameterless `CourseNumbering`, and the per-tenant projection
// issues a human-facing `CourseNumber` that restarts at 1 for each
// tenant. Doing it the other way — minting the id per tenant — would
// have two tenants both writing `Course:c1`, and tags are flat, so
// those two courses would be one instance. It is also how real systems
// work: invoice numbers restart, invoice ids never do.
//
// A side effect worth naming: because `CourseNumber` is not an
// identifier type, the minted value is not a tag, so write coverage
// has nothing to exempt here.
function seedAddTenancy(ctxId) {
  addDefinition('custom-type-definition', ctxId, 'TenantStatus', seedEnumType('TenantStatus', ['NonExistent', 'Existent']));
  addDefinition('entity-definition', ctxId, 'Tenant', {
    icon: '🏢',
    identifierSchema: { type: 'string' },
    properties: [seedStatusProperty('TenantStatus', 'NonExistent')],
  });
  addDefinition('custom-type-definition', ctxId, 'CourseNumber', {
    schema: { type: 'string', pattern: '^[0-9]+$' },
  });

  addDefinition('event-definition', ctxId, 'TenantRegistered', {
    properties: [seedProp('tenantId', 'TenantId')],
  });
  seedPatch('event-definition', ctxId, 'CourseDefined', (event) => {
    event.properties.unshift(seedProp('tenantId', 'TenantId'));
    event.properties.push(seedProp('courseNumber', 'CourseNumber'));
  });

  seedPatch('entity-definition', ctxId, 'Tenant', (tenant) => {
    tenant.properties[0].handlers = [
      seedHandler('TenantRegistered', 'set', { enumMember: 'Existent' }),
    ];
  });

  // One parameter, so one tag: `Tenant:<id> AND type CourseDefined`.
  // Drop the parameter and this is the global numbering again — that
  // is the whole difference between the two, which is why there is one
  // kind here and not two.
  addDefinition('projection-definition', ctxId, 'TenantCourseNumbering', {
    parameters: [{ name: 'tenantId', propertyType: 'TenantId' }],
    valueType: 'CourseNumber',
    isOptional: false,
    isList: false,
    initialValue: '1',
    handlers: [
      seedHandler('CourseDefined', 'set', { successor: { eventProperty: 'courseNumber' } }),
    ],
  });

  addDefinition('command-definition', ctxId, 'RegisterTenant', {
    feature: 'Tenancy',
    properties: [seedProp('tenantId', 'TenantId')],
    boundary: [seedBind('tenant', 'Tenant', 'tenantId')],
    conditions: [
      { leftHandSide: seedOf('tenant', 'status'), predicate: 'equals',
        rightHandSide: { enumMember: 'NonExistent' } },
    ],
    publishes: [{ name: 'TenantRegistered', parameters: { tenantId: seedParam('tenantId') } }],
  });

  // Three reads, all in round 1: none of them names another, so they
  // come back together. This is why rounds are counted by the depth of
  // the dependency graph and not by the length of the boundary.
  seedPatch('command-definition', ctxId, 'DefineCourse', (define) => {
    define.properties.unshift(seedProp('tenantId', 'TenantId'));
    define.boundary.unshift(seedBind('tenant', 'Tenant', 'tenantId'));
    define.boundary.push(seedReadProjection('tenantCourseNumbering', 'TenantCourseNumbering', {
      tenantId: seedParam('tenantId'),
    }));
    define.conditions.push({
      leftHandSide: seedOf('tenant', 'status'),
      predicate: 'equals',
      rightHandSide: { enumMember: 'Existent' },
    });
    define.publishes[0].parameters.tenantId = seedParam('tenantId');
    define.publishes[0].parameters.courseNumber = seedOf('tenantCourseNumbering');
  });
}

// Layer 3: schedules, and the rule that a student is never in two
// courses at once. A slot is an hour of wall-clock time and a course is
// scheduled by naming the slots it occupies, so a slot value *is* a
// discretised timestamp and the granularity is stated by the pattern.
//
// Slots are values, never tags. Occupancy is not stored per student —
// it is read from each course's current schedule at check time, which
// is exactly what lets a course be rescheduled underneath its
// subscribers without invalidating anything.
function seedAddSchedules(ctxId) {
  addDefinition('custom-type-definition', ctxId, 'TimeSlot', {
    schema: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$' },
  });

  seedPatch('event-definition', ctxId, 'CourseDefined', (event) => {
    event.properties.push(seedListProp('slots', 'TimeSlot'));
  });
  addDefinition('event-definition', ctxId, 'CourseRescheduled', {
    properties: [seedProp('courseId', 'CourseId'), seedListProp('slots', 'TimeSlot')],
  });

  seedPatch('entity-definition', ctxId, 'Course', (course) => {
    course.properties.push({
      ...seedProperty('slots', 'TimeSlot', [], { isList: true }),
      handlers: [
        seedHandler('CourseDefined', 'set', { eventProperty: 'slots' }),
        seedHandler('CourseRescheduled', 'set', { eventProperty: 'slots' }),
      ],
    });
  });
  // Names the courses whose *current* schedules the overlap check
  // reads. Nothing about time is stored here.
  seedPatch('entity-definition', ctxId, 'Student', (student) => {
    student.properties.push({
      ...seedProperty('subscribedCourseIds', 'CourseId', [], { isList: true }),
      handlers: [
        seedHandler('StudentSubscribedToCourse', 'append', { eventProperty: 'courseId' }),
        seedHandler('StudentUnsubscribedFromCourse', 'remove', { eventProperty: 'courseId' }),
      ],
    });
  });

  seedPatch('command-definition', ctxId, 'DefineCourse', (define) => {
    define.properties.push(seedListProp('slots', 'TimeSlot'));
    define.publishes[0].parameters.slots = seedParam('slots');
  });

  // Rescheduling is allowed while students are subscribed, so it has to
  // prove that nobody it moves ends up double-booked: bind the
  // subscribers, then every *other* course any of them is in, and
  // require none of those schedules to touch the new slots. `theirs`
  // would otherwise include this very course — every subscriber is in
  // it — and a course almost always overlaps its own old schedule.
  addDefinition('command-definition', ctxId, 'RescheduleCourse', {
    feature: 'Course management',
    properties: [seedProp('courseId', 'CourseId'), seedListProp('slots', 'TimeSlot')],
    boundary: [
      seedBind('course', 'Course', 'courseId'),
      { alias: 'students', entity: 'Student', id: seedOf('course', 'subscribedStudentIds') },
      { alias: 'theirs', entity: 'Course', id: seedOf('students', 'subscribedCourseIds'),
        excluding: seedParam('courseId') },
    ],
    conditions: [
      { leftHandSide: seedOf('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: seedOf('theirs', 'slots'), predicate: 'containsAny',
        rightHandSide: seedParam('slots'), negate: true },
    ],
    publishes: [{
      name: 'CourseRescheduled',
      parameters: { courseId: seedParam('courseId'), slots: seedParam('slots') },
    }],
  });

  // `others` is the second link of the chain: the student names its
  // courses, and those courses' current schedules answer whether this
  // one clashes. The condition holds for every course bound.
  seedPatch('command-definition', ctxId, 'SubscribeStudentToCourse', (subscribe) => {
    subscribe.boundary.push({
      alias: 'others', entity: 'Course', id: seedOf('student', 'subscribedCourseIds'),
    });
    subscribe.conditions.push({
      leftHandSide: seedOf('others', 'slots'),
      predicate: 'containsAny',
      rightHandSide: seedOf('course', 'slots'),
      negate: true,
    });
  });
}

// A command that acts on a *list* of instances at once.
//
// `OrderProducts` submits a cart: each line names a product and the
// price the customer was shown. Two things have to hold for every line
// — the product exists, and the price shown is still the price — and
// they hold or fail together, in one append.
//
// The list is what makes this different from every other example here:
//
//   - `Item` is a composite value type. Because one of its fields is a
//     `ProductId`, a property typed `Item[]` carries one Product tag
//     per element, and `ProductsOrdered` ends up tagged with every
//     product in the cart.
//   - `product` binds `items.productId`, which is a list, so it fans
//     out to one instance per line.
//   - the price condition reads `items.price` alongside the fanned
//     `product`. Both are rooted at `items`, so they are read at the
//     same index: each product is checked against the price submitted
//     *for that product*, not against any price in the cart.
//
// `order` is bound singularly beside it, so the same boundary holds one
// instance and many, and the derived DCB shows both shapes at once.
function seedProductPricing(ctxId) {
  const property = seedProperty;
  const statusProperty = seedStatusProperty;
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const of = seedOf;

  // 1. Value types. Money is scalar; Item is composite, and its
  //    productId field is what turns a list of them into tags. The
  //    lifecycle enums are scalar too — just with `enum` instead of a
  //    numeric schema.
  addDefinition('custom-type-definition', ctxId, 'Money', {
    schema: { type: 'number', minimum: 0 },
  });
  addDefinition('custom-type-definition', ctxId, 'ProductStatus', seedEnumType('ProductStatus', ['NonExistent', 'Existent']));
  addDefinition('custom-type-definition', ctxId, 'OrderStatus', seedEnumType('OrderStatus', ['NonExistent', 'Existent']));

  // 2. Entities, first without handlers — Item cannot be declared
  //    until ProductId exists, and ProductId comes from Product.
  addDefinition('entity-definition', ctxId, 'Product', {
    icon: '📦',
    identifierSchema: { type: 'string' },
    properties: [
      statusProperty('ProductStatus', 'NonExistent'),
      // Optional, and null until the product is defined: a price of 0
      // on a product that does not exist would be a lie the model then
      // has to defend.
      property('currentPrice', 'Money', null, { isOptional: true }),
    ],
  });
  addDefinition('entity-definition', ctxId, 'Order', {
    icon: '🧾',
    identifierSchema: { type: 'string' },
    properties: [statusProperty('OrderStatus', 'NonExistent')],
  });

  addDefinition('custom-type-definition', ctxId, 'Item', {
    properties: [
      { name: 'productId', propertyType: 'ProductId' },
      { name: 'price', propertyType: 'Money' },
    ],
  });

  // 3. Events.
  const event = (name, properties) =>
    addDefinition('event-definition', ctxId, name, { properties });

  event('ProductDefined', [prop('productId', 'ProductId'), prop('price', 'Money')]);
  event('ProductPriceChanged', [prop('productId', 'ProductId'), prop('newPrice', 'Money')]);
  // One event, many tags: Order:<orderId> plus one Product per item.
  event('ProductsOrdered', [prop('orderId', 'OrderId'), seedListProp('items', 'Item')]);

  // 4. Product again, now handling the price events. Neither property
  //    handles ProductsOrdered: a value-style handler would need to
  //    pick *this* product's line out of the event, which the model
  //    cannot yet express.
  updateDefinition('entity-definition', ctxId, 'Product', {
    icon: '📦',
    identifierSchema: { type: 'string' },
    properties: [
      { ...statusProperty('ProductStatus', 'NonExistent'),
        handlers: [handler('ProductDefined', 'set', { enumMember: 'Existent' })] },
      { ...property('currentPrice', 'Money', null, { isOptional: true }),
        handlers: [
          handler('ProductDefined', 'set', { eventProperty: 'price' }),
          handler('ProductPriceChanged', 'set', { eventProperty: 'newPrice' }),
        ] },
    ],
  });
  updateDefinition('entity-definition', ctxId, 'Order', {
    icon: '🧾',
    identifierSchema: { type: 'string' },
    properties: [
      { ...statusProperty('OrderStatus', 'NonExistent'),
        handlers: [handler('ProductsOrdered', 'set', { enumMember: 'Existent' })] },
    ],
  });

  // 5. Commands defining and repricing a single product, so the
  //    example can be exercised before anything is ordered.
  addDefinition('command-definition', ctxId, 'DefineProduct', {
    feature: 'Catalogue',
    properties: [prop('productId', 'ProductId'), prop('price', 'Money')],
    boundary: [seedBind('product', 'Product', 'productId')],
    conditions: [{
      leftHandSide: of('product', STATUS_PROPERTY),
      predicate: 'equals',
      rightHandSide: { enumMember: 'NonExistent' },
    }],
    publishes: [{
      name: 'ProductDefined',
      parameters: { productId: param('productId'), price: param('price') },
    }],
  });
  addDefinition('command-definition', ctxId, 'ChangeProductPrice', {
    feature: 'Catalogue',
    properties: [prop('productId', 'ProductId'), prop('newPrice', 'Money')],
    boundary: [seedBind('product', 'Product', 'productId')],
    conditions: [
      {
        leftHandSide: of('product', STATUS_PROPERTY),
        predicate: 'equals',
        rightHandSide: { enumMember: 'Existent' },
      },
      // Repricing to the price already in force is a no-op, and saying
      // so does more than tidy the log: reading `currentPrice` pulls
      // ProductPriceChanged into this command's query, where the state
      // check alone would have covered only ProductDefined. Without it
      // two concurrent repricings both see an untouched product and
      // both succeed.
      {
        leftHandSide: of('product', 'currentPrice'),
        predicate: 'equals',
        rightHandSide: param('newPrice'),
        negate: true,
      },
    ],
    publishes: [{
      name: 'ProductPriceChanged',
      parameters: { productId: param('productId'), newPrice: param('newPrice') },
    }],
  });

  // 6. The command the example exists for.
  addDefinition('command-definition', ctxId, 'OrderProducts', {
    feature: 'Checkout',
    properties: [prop('orderId', 'OrderId'), seedListProp('items', 'Item')],
    boundary: [
      seedBind('order', 'Order', 'orderId'),
      // A list operand, so this binds one Product per line.
      { alias: 'product', entity: 'Product', id: { parameterName: 'items', property: 'productId' } },
    ],
    conditions: [
      // Singular: the order must not already have been placed.
      {
        leftHandSide: of('order', STATUS_PROPERTY),
        predicate: 'equals',
        rightHandSide: { enumMember: 'NonExistent' },
      },
      // Universal over the fanned alias: every product must exist.
      {
        leftHandSide: of('product', STATUS_PROPERTY),
        predicate: 'equals',
        rightHandSide: { enumMember: 'Existent' },
      },
      // Zipped: product[i] against items[i].price.
      {
        leftHandSide: of('product', 'currentPrice'),
        predicate: 'equals',
        rightHandSide: { parameterName: 'items', property: 'price' },
      },
    ],
    publishes: [{
      name: 'ProductsOrdered',
      // `items` is emitted whole. Coverage reads through it to
      // items.productId, which is exactly what `product` bound.
      parameters: { orderId: param('orderId'), items: param('items') },
    }],
  });
}

// Layer 2 of the pricing model, and the one example in this playground
// that a declaration cannot reach: a repriced product honours what it
// used to cost for an hour, so a customer quoted the old price can
// still check out at it.
//
// Every declarative handler answers "what does this event do to the
// value" without looking at anything else. This rule needs more: which
// prices are still valid depends on *when* each was set relative to an
// instant the command supplies, and the price in force an hour ago
// counts even though the event that set it may be a year old. No
// operation in the vocabulary carries that, and inventing one — a
// retention window declared on the property — bought a single example
// three concepts and a typing exception. So `validPrices` is scripted:
// one code body per event type, keeping whatever state it needs.
//
// What the script keeps and what it exposes are different things.
// `lastValidOldPrice` is bookkeeping — the newest price set *before*
// the window opened, which is the one still in force when it did.
// `validNewPrices` is the answer. `exposes` names the second, so a
// condition reads a plain `Money[]` and never sees the accumulator.
//
// Time enters as an argument, never as an ambient clock. `OrderProducts`
// is handed `now` and passes it to the binding; the code compares it
// against `event.metadata.recordedAt`, which is the instant the event
// was written and does not move. The same events and the same `now`
// therefore always reach the same verdict, which is what makes the
// decision replayable — and it is why the envelope is readable here
// and not in a condition.
//
// `currentPrice` stays exactly as it was, declared, handling the same
// two events with no window — it is what a catalogue page shows and
// what ChangeProductPrice compares against. Two properties over one
// history, answering two different questions, and the derived DCB is
// unchanged by one of them being scripted: same tag, same event types,
// still visible on the page.
function seedAddPriceGracePeriod(ctxId) {
  // One hour, in seconds. The grace period lives in the code because
  // the code is the only part of this model that can do arithmetic —
  // making the caller pre-compute a cutoff would move the rule this
  // example exists to show out of the example.
  const GRACE_PERIOD = 3600;

  const keepIfInsideWindow = (priceField) => `
// A price set inside the window is valid, and so is the one that was
// in force when the window opened — keep the latter until something
// newer displaces it.
event.metadata.recordedAt >= args.now - ${GRACE_PERIOD}
  ? {
      lastValidOldPrice: state.lastValidOldPrice,
      validNewPrices: [...state.validNewPrices, event.data.${priceField}],
    }
  : {
      lastValidOldPrice: event.data.${priceField},
      validNewPrices: state.validNewPrices,
    }
`.trim();

  seedPatch('entity-definition', ctxId, 'Product', (product) => {
    product.properties.push({
      name: 'validPrices',
      // The exposed reading, and the only thing a condition sees: the
      // prices this product will still accept.
      propertyType: 'Money',
      isList: true,
      script: {
        initialState: { lastValidOldPrice: null, validNewPrices: [] },
        exposes: 'validNewPrices',
        arguments: [{ name: 'now', propertyType: 'timestamp' }],
      },
      handlers: [
        { event: 'ProductDefined', code: keepIfInsideWindow('price') },
        { event: 'ProductPriceChanged', code: keepIfInsideWindow('newPrice') },
      ],
    });
  });

  seedPatch('command-definition', ctxId, 'OrderProducts', (order) => {
    order.properties.push(seedProp('now', 'timestamp'));
    // Every product in the cart is read at one instant, so a cart that
    // straddles the expiry of a price resolves one way for all of it.
    order.boundary.find((binding) => binding.alias === 'product').arguments = {
      now: seedParam('now'),
    };
    // The zipped check survives intact: still product[i] against
    // items[i].price, still one fan root. Only the arity moves —
    // `validPrices` is a list per product, `items.price` a single value
    // per line — so `equals` becomes `contains`.
    const priceCheck = order.conditions.find((condition) =>
      condition.leftHandSide.alias === 'product'
      && condition.leftHandSide.property === 'currentPrice');
    priceCheck.leftHandSide = seedOf('product', 'validPrices');
    priceCheck.predicate = 'contains';
  });
}

const PREDEFINED_CONTEXTS = [
  {
    name: 'Course Example (simple)',
    description: 'Courses and students, capacity and subscriptions. '
      + 'Identifiers are supplied by the caller and checked with a state condition.',
    build: (ctxId) => { seedBase(ctxId); },
  },
  {
    name: 'Course Example (with sequence)',
    description: 'Adds a projection issuing c1, c2, c3… DefineCourse loses its identifier '
      + 'parameter and its conditions — binding the numbering guards it instead.',
    build: (ctxId) => { seedBase(ctxId); seedAddSequence(ctxId); },
  },
  {
    name: 'Course Example (with sequence and tenant)',
    description: 'The numbering restarts per tenant — the case a tagless sequence could not '
      + 'express. Identity stays globally minted; what restarts is the number, so no two '
      + 'tenants ever write the same Course tag.',
    build: (ctxId) => { seedBase(ctxId); seedAddSequence(ctxId); seedAddTenancy(ctxId); },
  },
  {
    name: 'Course Example (with schedules)',
    description: 'Adds hourly slots and the rule that a student is never in two courses at '
      + 'once, checked against live schedules so courses can be rescheduled under subscribers.',
    build: (ctxId) => { seedBase(ctxId); seedAddSequence(ctxId); seedAddSchedules(ctxId); },
  },
{
    name: 'Dynamic Product Price (simple)',
    description: 'A cart ordered in one append. Each line names a product and the price shown '
      + 'to the customer; the boundary fans out over the lines and checks each price against '
      + 'the product it belongs to.',
    build: (ctxId) => { seedProductPricing(ctxId); },
  },
  {
    name: 'Dynamic Product Price (with grace period)',
    description: 'A repriced product honours its old price for an hour — the one rule here no '
      + 'declaration can express, so the property is scripted. The command is handed the instant '
      + 'to read at, the code compares it against when each event was recorded, and the derived '
      + 'boundary looks exactly as it would without a script.',
    build: (ctxId) => { seedProductPricing(ctxId); seedAddPriceGracePeriod(ctxId); },
  },
];

function loadPredefinedContext(index) {
  const entry = PREDEFINED_CONTEXTS[index];
  if (!entry) throw new DomainError('No such predefined context.');
  const ctxId = createDcbContext(entry.name);
  entry.build(ctxId);
  return ctxId;
}

