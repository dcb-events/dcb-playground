// ============================================================
// DCB Playground — model layer.
//
// The semantics behind `index.html`. Nothing here touches the DOM: it
// is the event log, the projection over it, type resolution, reference
// tracking, validation, DCB derivation, the editing commands and the
// predefined models.
//
// Loaded as a classic script (not a module) so the playground opens
// straight from the filesystem without a server.
//
// One thing here is not in the declarative language proper and is
// worth finding before reading anything else.
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
// one field a DCB Model carries that the modelled system does not
// read. See `CommandDefinition.feature` in dcb-model.schema.json.
// ============================================================

// ============================================================
// Constants.
// ============================================================
// Bumped whenever a stored definition changes shape. The log is the
// whole state, so an old log replayed against new validation would
// produce models this build refuses to save — a fresh key is honest
// about that where a silent migration would not be. v8 dropped
// property retention and a binding's `asOf`. v9 dropped the reserved
// `status` property and its entity-derived enum: a lifecycle is now an
// ordinary enum custom type plus an ordinary property, like any other.
// v10 merged identifier types into custom types: `isTag` now lives on
// a custom type directly, an entity's derived identifier is an
// ordinary custom type created alongside it, and there is no longer a
// separate identifier-type-definition kind. v12 dropped the `timestamp`
// type and the event envelope (`recordedAt`) entirely: no definition
// referenced them structurally, but the envelope's asymmetry machinery
// and the required instant on every Given step are gone. v13 renamed
// the artifact from "DCB Context" to "DCB Model": the three lifecycle
// event types and the `dcb-context-id` they carried are spelled with
// `model` now, and nothing reads the old spelling. This is the one bump
// so far that changes no shape at all — only names — which is exactly
// why it needs a fresh key rather than a quiet coexistence.
// v14 unified projections: an entity property is now a *binding* —
// `{name, projection}` — pointing at an ordinary `projection-definition`,
// every projection declares its partition as explicit `parameters`,
// `isOptional` is gone, and an initial value may be any typed literal
// including a non-empty list. v15 generalised property scenarios into
// projection scenarios: one asserts over a list of `reads` rather than
// over one entity instance's properties, which is the same
// generalisation v14 made to the thing being asserted about. v16
// narrowed a projection scenario back to a single subject: the list of
// aliased `reads` became one `projection` plus its `arguments`, and the
// Then asserts that one fold's value rather than a keyed set.
const EVENT_LOG_KEY = 'dcb-playground:events:v16';

const DEF_KINDS = [
  'entity-definition',
  'event-definition',
  'projection-definition',
  'command-definition',
  'custom-type-definition',
  'scenario-definition',
  'projection-scenario-definition',
];
const DEF_COLLECTIONS = {
  'entity-definition': 'entity-definitions',
  'event-definition': 'event-definitions',
  'projection-definition': 'projection-definitions',
  'command-definition': 'command-definitions',
  'custom-type-definition': 'custom-type-definitions',
  'scenario-definition': 'scenario-definitions',
  'projection-scenario-definition': 'projection-scenario-definitions',
};
const KIND_COLOR_CLASS = {
  'entity-definition': 'entity',
  'event-definition': 'event',
  'projection-definition': 'projection',
  'command-definition': 'command',
  'custom-type-definition': 'custom-type',
  'scenario-definition': 'scenario',
  'projection-scenario-definition': 'scenario',
};

const KIND_SECTION_TITLE = {
  'entity-definition': 'Entities',
  'event-definition': 'Events',
  'projection-definition': 'Projections',
  'command-definition': 'Commands',
  'custom-type-definition': 'Custom Types',
  'scenario-definition': 'Scenarios',
  'projection-scenario-definition': 'Projection scenarios',
};

// A scenario is identified by a generated id rather than by its name,
// which is the same shape a DCB Model itself has and for the same
// reason: its name is derived from what the command did and is the
// modeler's to overwrite, so two scenarios of one command may well want
// to be called the same thing. Every other definition kind is keyed by
// a name that *is* its identity, and renaming one is what moves every
// reference to it. A projection scenario is the same shape for the same
// reason, one level down: it belongs to an entity rather than a
// command, but its name is still derived from what it found, not
// chosen up front.
const ID_KEYED_KINDS = ['scenario-definition', 'projection-scenario-definition'];

function isIdKeyed(kind) { return ID_KEYED_KINDS.includes(kind); }

const SIMPLE_TYPES = ['boolean', 'integer', 'string'];

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
  const raw = localStorage.getItem(EVENT_LOG_KEY);
  if (raw === null) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch { /* handled below: unparseable is corrupt */ }
  if (Array.isArray(parsed)) return parsed;
  // The log is the whole state, so an unreadable one — bad JSON or the
  // wrong shape — is never left where the next append would overwrite
  // the only copy. It is moved aside, where a hand or a future build
  // can still reach it, and the app starts over honestly empty.
  localStorage.setItem(EVENT_LOG_KEY + ':corrupt', raw);
  localStorage.removeItem(EVENT_LOG_KEY);
  bumpLogRevision();
  if (typeof toast === 'function') {
    toast(
      'The stored event log could not be read. The raw value was kept under '
      + `"${EVENT_LOG_KEY}:corrupt" and the playground started over.`, true
    );
  }
  return [];
}

// Bumped by every writer of the log — `appendEvents` here, undo and
// redo in the page, the corrupt-log move-aside below — so a cache can
// ask "has anything changed?" without parsing the log to find out.
// A writer that skips its bump is the one way the caches below go
// stale; nothing re-reads storage to double-check, which also means a
// second tab's writes are unseen until this one writes (the two were
// never coordinated before either — each replayed its own reads).
let logRevision = 0;
function bumpLogRevision() { logRevision += 1; }
function logRevisionNow() { return logRevision; }

// Told after every append, with where it began and what landed. This
// is the one seam every write funnels through — command functions
// behind buttons and agent tools alike — which is what lets the
// interface take undo marks here rather than wrapping each of the
// hundred call sites. Undo and redo restore the log by writing the
// storage key directly, so they never renotify.
const appendListeners = [];
function onAppend(listener) { appendListeners.push(listener); }

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
  bumpLogRevision();
  for (const listener of appendListeners) listener(startSeq, stamped);
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
// Mirrors `dcb-model-overview` in the ESDM model.
// ============================================================

function emptyModel(id, name) {
  const model = { id, name };
  for (const kind of DEF_KINDS) model[DEF_COLLECTIONS[kind]] = {};
  return model;
}

// Folded once per log revision, not once per call — `activeModel` and
// the render path ask many times per paint. Callers get one shared
// object and must not mutate it: every editor already works on a
// `deepClone` and every change goes through a command function.
let projectionCache = null;

function projectState() {
  if (projectionCache && projectionCache.revision === logRevision) return projectionCache.models;
  const models = {};
  for (const event of loadEvents()) apply(models, event);
  // Read *after* the fold: a corrupt log discovered by `loadEvents`
  // bumps the revision while we are standing here.
  projectionCache = { revision: logRevision, models };
  return models;
}

function apply(models, event) {
  const { type, data } = event;
  const modelId = data['dcb-model-id'];

  if (type === 'dcb-model-created') {
    models[modelId] = emptyModel(modelId, data.name);
    return;
  }
  // Nothing appends this any more — the command that did was removed
  // unused — but a stored log may still carry one, so it stays foldable.
  if (type === 'dcb-model-renamed') {
    if (models[modelId]) models[modelId].name = data.name;
    return;
  }
  if (type === 'dcb-model-deleted') {
    delete models[modelId];
    return;
  }

  const model = models[modelId];
  if (!model) return;

  for (const kind of DEF_KINDS) {
    const coll = model[DEF_COLLECTIONS[kind]];
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
    if (type === `${kind}-reordered`) {
      const next = {};
      for (const key of data.order) if (coll[key] !== undefined) next[key] = coll[key];
      model[DEF_COLLECTIONS[kind]] = next;
      return;
    }
  }
}

// ============================================================
// Derived types.
//
// An entity brings an identifier type into existence — `<Entity>Id`
// unless `identifierType` overrides the name — as an ordinary
// `custom-type-definition`, created alongside the entity and stored
// like any other. A lifecycle is not a derived type — a modeller who
// wants one declares an ordinary enum value type and an ordinary
// property typed with it, by convention named `status`.
// ============================================================

// `entityName`'s derived identifier type name — `identifierType` when
// the entity gives one, otherwise `<name>Id`, tracking the entity's own
// name for as long as nothing overrides it. Reads straight off `model`,
// so renaming the entity moves this automatically: the name is
// recomputed fresh every time, never stored on the entity itself.
function idTypeOf(model, entityName) {
  const entity = model['entity-definitions'][entityName];
  return (entity && entity.identifierType) || (entityName + 'Id');
}

// The entity that owns a value type as its derived identifier, or null.
// Ownership is discovered by asking every entity what it currently
// derives, not stored on the value type itself — which is what lets a
// rename of the entity (while its identifier type is still tracking)
// move the ownership along with the recomputed name, for free.
function entityOfIdType(model, typeName) {
  for (const entityName of Object.keys(model['entity-definitions'])) {
    if (idTypeOf(model, entityName) === typeName) return entityName;
  }
  return null;
}

// Classifies a type name against a model: simple, a declared value
// type (entity-owned or standalone — same shape either way), or
// unresolved.
function classifyType(model, typeName) {
  if (!typeName) return { kind: 'unresolved' };
  if (SIMPLE_TYPES.includes(typeName)) return { kind: 'simple' };
  const valueType = model['custom-type-definitions'][typeName];
  if (valueType !== undefined) {
    return {
      kind: 'value',
      composite: Array.isArray(valueType.properties),
      isTag: !!valueType.isTag,
      ownerEntity: entityOfIdType(model, typeName),
    };
  }
  return { kind: 'unresolved' };
}

// The scalar, tag-marked value type a name resolves to, in the shape a
// tag is rendered from — entity-owned or standalone alike — or null
// for anything else (unresolved, not a value type, composite, or not
// marked `isTag`).
function identifierTypeOf(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || cls.composite || !cls.isTag) return null;
  const body = model['custom-type-definitions'][typeName];
  return { name: typeName, composite: false, ownerEntity: cls.ownerEntity, tagSchema: (body && body.tagSchema) || '{type}:{value}' };
}

// Renders one identifier's value into its tag, through that
// identifier's own `tagSchema` — `{type}` and `{value}`, in whichever
// order the template states them.
function renderTag(identifierType, valueText) {
  return identifierType.tagSchema
    .replace('{type}', identifierType.name)
    .replace('{value}', valueText);
}

// The fields of a composite value type, or null for anything else.
// Universal — a composite's fields may be any value type, tag-marked
// or not; `idLeavesOfType` is what picks out the tag-marked ones.
function compositeFieldsOf(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || !cls.composite) return null;
  return model['custom-type-definitions'][typeName].properties || [];
}

// Whether a type carries at least one tag — a tag-marked scalar, or a
// composite with at least one tag-marked field. Used wherever something
// must be able to narrow a query: a projection parameter, a tag filter,
// an entity's own derived identifier.
function isTagBearing(model, typeName) {
  return idLeavesOfType(model, typeName).length > 0;
}

// Tag derivation, looking *through* a composite to its fields.
//
// Every tag reachable from a type, as `{ field, identifierType }` —
// `field` is null when the type is itself a tag-marked scalar (used
// whole), and names the composite's field otherwise. A property typed
// with a composite therefore contributes one tag per tag-marked field
// it has (a field that is not itself tag-marked contributes nothing),
// and a *list* of composites one such tag per element.
//
// A composite's fields may not themselves be composite, so this is
// always one hop and cannot recurse further.
function idLeavesOfType(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value') return [];
  if (!cls.composite) {
    return cls.isTag ? [{ field: null, identifierType: typeName }] : [];
  }
  const fields = compositeFieldsOf(model, typeName) || [];
  const out = [];
  for (const field of fields) {
    const fieldCls = classifyType(model, field.propertyType);
    if (fieldCls.kind === 'value' && !fieldCls.composite && fieldCls.isTag) {
      out.push({ field: field.name, identifierType: field.propertyType });
    }
  }
  return out;
}

function allTypeNames(model) {
  return [
    ...SIMPLE_TYPES,
    ...Object.keys(model['custom-type-definitions']).sort(),
  ];
}

// An enum is not a distinct form of value type: it is a scalar value
// type whose `schema` carries the JSON Schema `enum` keyword. Presence
// of a non-empty `enum` array is what the tooling treats as "this
// resolves to an enum" — the one keyword that unambiguously means
// "these are the only legal values".
function enumMembersFor(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || cls.composite) return null;
  const valueType = model['custom-type-definitions'][typeName];
  const members = valueType && valueType.schema && valueType.schema.enum;
  return Array.isArray(members) && members.length ? members : null;
}

// Whether an enum's members are all plain strings — the shape the
// chip-based member editor (add/rename/remove, with rewrite-on-rename
// across every reference) is built for. A numeric, boolean or mixed
// enum still evaluates correctly through the ordinary operand
// machinery; it just does not get that authoring convenience, and is
// edited as raw JSON Schema instead.
function isStringEnumType(model, typeName) {
  const members = enumMembersFor(model, typeName);
  return !!members && members.every((m) => typeof m === 'string');
}

// A model with one definition overlaid — used so that a body being
// validated can reference the very definition it belongs to (an
// entity's own properties may reference its own derived `<Entity>Id`).
function withPending(model, kind, name, body) {
  const next = { ...model };
  const collName = DEF_COLLECTIONS[kind];
  next[collName] = { ...model[collName], [name]: body };
  return next;
}

function defaultAlias(entityName) {
  return entityName.charAt(0).toLowerCase() + entityName.slice(1);
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
// References are derived from the body shape (per the DCB Model
// schema) — never stored alongside it. An entity's own derived
// identifier is an ordinary custom-type-definition, referenced by the
// entity through `identifierType` exactly like any property type
// references one — which is what lets renaming or removing it go
// through the same generic machinery as any other value type, with no
// entity-specific case needed.
// ============================================================

function emptyRefs() {
  const out = {};
  for (const k of DEF_KINDS) out[k] = [];
  return out;
}

function uniq(arr) { return [...new Set(arr)]; }

function pushTypeRef(model, refs, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind === 'value') refs['custom-type-definition'].push(typeName);
}

// Every place a body names another definition, enumerated exactly
// once for both directions: `computeReferences` reads through these
// slots and `rewriteReferences` writes through them, so a reference
// site added to one is a reference site added to the other — the
// drift that used to be possible (compute sees it, rename leaves it
// dangling, or the reverse) has nowhere left to live.
//
// `slot(targetKind, {flavor, get, set})` is called per site:
//   - flavor 'type': a property-type name. Counted as a reference
//     only when it classifies as a value type; rewritten on equality
//     (the rename target being a custom type guarantees the class).
//   - flavor 'name': a definition named outright.
// A slot whose reference is derived rather than stored guards its own
// `set` — see the entity identifier below.
function forEachReferenceSlot(kind, name, body, slot) {
  const at = (holder, key, targetKind, flavor) => {
    if (!holder) return;
    slot(targetKind, {
      flavor,
      get: () => holder[key],
      set: (v) => { holder[key] = v; },
    });
  };
  const typeSlots = (properties) => {
    for (const p of properties || []) {
      if (!p) continue;
      at(p, 'propertyType', 'custom-type-definition', 'type');
      typeSlots((p.script || {}).arguments);
    }
  };
  // A tag filter carries a value type by bare name — the one place a
  // type is referenced outside a property type. The placeholder inside
  // is an argument name and stays untouched.
  const tagFilterSlots = (script) => {
    if (!script || !script.tagFilter) return;
    script.tagFilter.forEach((template, i) => {
      const match = TAG_FILTER_RE.exec(String(template || ''));
      if (!match) return;
      slot('custom-type-definition', {
        flavor: 'type',
        get: () => match[1],
        set: (v) => { script.tagFilter[i] = `${v}:${match[2]}`; },
      });
    });
  };
  const givenSlots = (given) => {
    for (const step of given || []) at(step, 'event', 'event-definition', 'name');
  };

  switch (kind) {
    case 'custom-type-definition':
      // A scalar type's schema is opaque and references nothing. A
      // composite's fields are typed against the shared universe, so
      // they reference exactly like any other property list does.
      typeSlots(body.properties);
      break;
    case 'event-definition':
      typeSlots(body.properties);
      break;
    case 'entity-definition':
      // A property is a binding `{name, projection}`: everything the
      // fold needs lives on the projection it names, so the binding
      // references exactly one thing.
      for (const p of body.properties || []) at(p, 'projection', 'projection-definition', 'name');
      // An entity references its own derived identifier by name —
      // whatever it currently resolves to, tracking or overridden —
      // which is what lets renaming or removing that value type go
      // through the same generic machinery as any property type.
      // Writing moves only an *explicit* `identifierType`: while it is
      // absent (still tracking `<name>Id`), recomputing the default
      // off the entity's own name is what `idTypeOf` already does.
      slot('custom-type-definition', {
        flavor: 'name',
        get: () => body.identifierType || (name ? name + 'Id' : undefined),
        set: (v) => { if (body.identifierType !== undefined) body.identifierType = v; },
      });
      break;
    case 'projection-definition':
      at(body, 'valueType', 'custom-type-definition', 'type');
      // A parameter is always a tag-bearing value type, so it
      // references it the same way a property type does.
      typeSlots(body.parameters);
      typeSlots((scriptOf(body) || {}).arguments);
      tagFilterSlots(scriptOf(body));
      for (const handler of body.handlers || []) at(handler, 'event', 'event-definition', 'name');
      break;
    case 'command-definition':
      typeSlots(body.properties);
      // Only `entity` and `projection` are references. An alias is
      // local to its command and was the modeler's to choose.
      for (const binding of body.boundary || []) {
        at(binding, 'entity', 'entity-definition', 'name');
        at(binding, 'projection', 'projection-definition', 'name');
      }
      for (const emission of body.publishes || []) at(emission, 'name', 'event-definition', 'name');
      break;
    case 'scenario-definition':
      // A scenario names the command it exercises, every event its
      // Given is written from, and every event its expected outcome
      // holds. All three have to move when one of them is renamed —
      // and none of them may stop one from being deleted; a scenario
      // exists to report what a change broke, not to prevent it.
      at(body, 'command', 'command-definition', 'name');
      givenSlots(body.given);
      for (const event of (body.then || {}).events || []) at(event, 'type', 'event-definition', 'name');
      break;
    case 'projection-scenario-definition':
      // Names the projection it is about and every event its Given is
      // written from. Its Then is a bare value and its `arguments` are
      // values too — nothing in the model is identified by either.
      at(body, 'projection', 'projection-definition', 'name');
      givenSlots(body.given);
      break;
  }
}

function computeReferences(model, kind, name, body) {
  const refs = emptyRefs();
  if (!body || typeof body !== 'object') return refs;
  forEachReferenceSlot(kind, name, body, (targetKind, site) => {
    const value = site.get();
    if (!value) return;
    if (site.flavor === 'type') pushTypeRef(model, refs, value);
    else refs[targetKind].push(value);
  });
  for (const k of DEF_KINDS) refs[k] = uniq(refs[k]);
  return refs;
}

// Rewrites every reference to `oldName` of `targetKind` into `newName`.
function rewriteReferences(kind, body, targetKind, oldName, newName) {
  const next = deepClone(body);
  forEachReferenceSlot(kind, undefined, next, (slotKind, site) => {
    if (slotKind !== targetKind) return;
    if (site.get() === oldName) site.set(newName);
  });
  return next;
}

function findReferencers(model, targetKind, targetName) {
  const out = [];
  for (const referrerKind of DEF_KINDS) {
    const coll = model[DEF_COLLECTIONS[referrerKind]];
    for (const [name, body] of Object.entries(coll)) {
      const refs = computeReferences(model, referrerKind, name, body);
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
    case 'current-value': return 'current';
    case 'successor': return `next(${operandText(operand.successor)})`;
    default:
      if (operand === null || operand === undefined) return 'null';
      if (Array.isArray(operand)) return '[]';
      return typeof operand === 'string' ? `"${operand}"` : String(operand);
  }
}

// An operand is unresolved when the name its kind requires is absent —
// the gap `operandText` papers over with a '?' placeholder. Checked
// structurally, because a literal that merely *contains* a question
// mark is a value, not a gap.
function operandIncomplete(operand) {
  switch (operandSource(operand)) {
    case 'parameter': return !operand.parameterName;
    case 'alias-property': return !operand.alias;
    case 'enum-member': return !operand.enumMember;
    case 'event-property': return !operand.eventProperty;
    case 'successor': return operandIncomplete(operand.successor);
    default: return false;
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

// The same derivation as scenarioName, one level down: a projection
// scenario has no outcome to name itself after, only the reads a
// modeler chose to check and what they folded to.
function projectionScenarioName(body) {
  if (body && typeof body.name === 'string' && body.name.trim()) return body.name.trim();
  if (!body || !('then' in body)) return 'an unrun projection scenario';
  return `ends up ${JSON.stringify(body.then)}`;
}

// The script a projection is advanced by, or null when its handlers
// are declared the ordinary way.
function scriptOf(target) {
  return target && target.script ? target.script : null;
}

// The slot of a projection that an entity property binding fills with
// the bound instance's identifier: the parameter (declared) or script
// argument (scripted) typed with the entity's own derived identifier.
// Null when the projection has no such slot — which is what makes it
// unbindable as that entity's property.
function entityIdSlotOf(model, entityName, projection) {
  if (!projection) return null;
  const idType = idTypeOf(model, entityName);
  const script = scriptOf(projection);
  const slots = script ? (script.arguments || []) : (projection.parameters || []);
  return slots.find((slot) => slot && slot.propertyType === idType) || null;
}

// An entity property is a binding `{name, projection}` pointing at an
// ordinary projection definition. This resolves one to the projection
// it names — `{ binding, projection }`, either half null when the name
// does not resolve — so every reader walks the reference the same way.
function entityPropertyTarget(model, entityName, propertyName) {
  const entity = model['entity-definitions'][entityName];
  const binding = entity && (entity.properties || []).find((p) => p && p.name === propertyName);
  if (!binding) return { binding: null, projection: null };
  return {
    binding,
    projection: model['projection-definitions'][binding.projection] || null,
  };
}

// What a bare literal of this type looks like at runtime — the shape an
// initial value element is checked against. A declared value type is
// read through its scalar schema's `type`; anything unstated is a
// string, which is what every identifier is underneath.
function literalKindOf(model, typeName) {
  if (typeName === 'integer') return 'number';
  if (typeName === 'boolean') return 'boolean';
  if (typeName === 'string') return 'string';
  const body = model['custom-type-definitions'][typeName];
  const declared = body && body.schema && body.schema.type;
  if (declared === 'integer' || declared === 'number') return 'number';
  if (declared === 'boolean') return 'boolean';
  return 'string';
}

// A scripted *standalone* projection states its own tags, because
// nothing else can: it has no owning entity to take one from and no
// parameter list to derive one from. The form is
// `IdentifierType:{argument}` — the name of a *scalar* identifier type
// (entity-derived or standalone; a composite one has no tag of its own
// to name — its components do), and either a placeholder naming one of
// the script's arguments or a literal value. The `:` here is purely
// authoring syntax, separating which identifier from what value; the
// actual tag is rendered through that identifier type's own
// `tagSchema`, which may not even use `:` — see `renderTag`.
const TAG_FILTER_RE = /^([A-Z][A-Za-z0-9]*):(.+)$/;
// A placeholder names an argument, optionally reaching one field into
// it — `{courseId}` or `{courseId.tenant}` — for the argument whose
// value is a composite identifier and whose tag comes from one leaf.
const TAG_PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)\}/g;

// The argument names a template interpolates — the root of each
// placeholder, with any field access stripped.
function tagFilterPlaceholders(template) {
  return [...String(template || '').matchAll(TAG_PLACEHOLDER_RE)].map((m) => m[1].split('.')[0]);
}

function resolveTagFilter(model, template, args) {
  const match = TAG_FILTER_RE.exec(String(template || ''));
  if (!match) return String(template || '');
  const valueText = match[2].replace(TAG_PLACEHOLDER_RE, (whole, path) => {
    const [root, ...fields] = path.split('.');
    if (args[root] === undefined) return whole;
    const shown = operandText(args[root]);
    return fields.length ? `${shown}.${fields.join('.')}` : shown;
  });
  const identifierType = identifierTypeOf(model, match[1]);
  return identifierType ? renderTag(identifierType, valueText) : `${match[1]}:${valueText}`;
}

// Every scripted projection an entity alias is read through — resolved
// through the property bindings — which is what decides the arguments
// its binding has to supply.
function scriptedPropertiesRead(model, body, binding) {
  const entity = model['entity-definitions'][binding.entity];
  if (!entity) return [];
  const found = [];
  forEachCommandOperand(body, (operand) => {
    if (operandSource(operand) !== 'alias-property' || operand.alias !== binding.alias) return;
    const { projection } = entityPropertyTarget(model, binding.entity, operand.property);
    if (projection && scriptOf(projection) && !found.includes(projection)) found.push(projection);
  });
  return found;
}

// The arguments a binding owes, gathered from everything it reads. Two
// scripted projections asking for the same name ask for the same value —
// they are read at one instant, through one binding. The entity's own
// identifier slot is never owed: the binding supplies the instance it
// bound, without being asked.
function argumentsExpected(model, body, binding) {
  const idType = idTypeOf(model, binding.entity);
  const out = [];
  for (const projection of scriptedPropertiesRead(model, body, binding)) {
    for (const argument of scriptOf(projection).arguments || []) {
      if (argument.propertyType === idType) continue;
      if (!out.some((a) => a.name === argument.name)) out.push(argument);
    }
  }
  return out;
}

// The operations that make sense for a projection's type.
function operationsFor(model, target) {
  if (target.isList) return ['set', 'append', 'remove'];
  if (target.valueType === 'integer') return ['set', 'increment', 'decrement'];
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
function resolveOperandType(operand, { boundary, commandProperties, model }) {
  const source = operandSource(operand);
  if (source === 'alias-property') {
    const binding = (boundary || []).find((b) => b.alias === operand.alias);
    if (!binding) return null;
    if (binding.projection) {
      // A projection holds one value, so the alias alone names it.
      const projection = model['projection-definitions'][binding.projection];
      if (!projection || operand.property) return null;
      return { propertyType: projection.valueType, isList: !!projection.isList };
    }
    const { projection } = entityPropertyTarget(model, binding.entity, operand.property);
    if (!projection) return null;
    // A property is a binding, so its type is the bound projection's.
    // A scripted projection is no different here: `valueType` and
    // `isList` describe the value a condition reads, whatever shape the
    // code carries internally to arrive at it.
    return { propertyType: projection.valueType, isList: !!projection.isList };
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
    const fields = compositeFieldsOf(model, property.propertyType);
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
  if (resolved.propertyType === 'integer') {
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
function isFannedOut(model, body, binding) {
  if (!binding) return false;
  // A projection binding reads one partition: every argument is a
  // single tag, so there is nothing for it to fan over.
  if (binding.projection) return false;
  const resolved = resolveOperandType(binding.id, {
    boundary: body.boundary || [],
    commandProperties: body.properties || [],
    model,
  });
  if (resolved && resolved.isList) return true;
  // Reading a scalar property off a plural alias is itself plural.
  if (operandSource(binding.id) === 'alias-property') {
    const source = (body.boundary || []).find((b) => b && b.alias === binding.id.alias);
    if (source && source !== binding) return isFannedOut(model, body, source);
  }
  return false;
}

// The list an operand is quantified over, as an identity string, or
// null when the operand is singular.
//
// This is what makes zipping decidable: two operands are correlated
// exactly when they carry the same root, because that is what "they
// came from the same list" means.
function bindingFanRoot(model, body, binding, seen = []) {
  if (!binding || !isFannedOut(model, body, binding)) return null;
  if (seen.includes(binding.alias)) return null;
  if (operandSource(binding.id) === 'parameter') {
    return `parameter:${binding.id.parameterName}`;
  }
  if (operandSource(binding.id) === 'alias-property') {
    const source = (body.boundary || []).find((b) => b && b.alias === binding.id.alias);
    // A binding fanned from a plural *projection* has no list
    // parameter behind it, so it is its own root.
    const inherited = source && source !== binding
      ? bindingFanRoot(model, body, source, [...seen, binding.alias])
      : null;
    return inherited || `binding:${binding.alias}`;
  }
  return `binding:${binding.alias}`;
}

function fanRootOf(model, body, operand) {
  const source = operandSource(operand);
  if (source === 'alias-property') {
    return bindingFanRoot(model, body,
      (body.boundary || []).find((b) => b && b.alias === operand.alias));
  }
  if (source === 'parameter') {
    // A list parameter is a fan root only when something actually fans
    // out over it. A list nobody iterates — the new schedule handed to
    // a reschedule command, say — is an ordinary list value, and
    // reading it alongside a fanned alias is not a second quantifier.
    const root = `parameter:${operand.parameterName}`;
    const iterated = (body.boundary || []).some(
      (b) => bindingFanRoot(model, body, b) === root);
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
function conditionFanRoots(model, body, condition) {
  return uniq(
    conditionOperands(condition)
      .map((operand) => fanRootOf(model, body, operand))
      .filter(Boolean)
  );
}

// Whether an operand is read at the iteration index rather than whole.
//
// It is zipped when some *alias* in the same condition fans from the
// very list the operand is rooted at — that alias is what supplies the
// index. An operand rooted at a list nothing else iterates stays a
// plain list, and is quantified over on its own.
function isZipped(model, body, condition, operand) {
  const root = fanRootOf(model, body, operand);
  if (!root || operandSource(operand) !== 'parameter') return false;
  return conditionOperands(condition).some((other) =>
    other !== operand
    && operandSource(other) === 'alias-property'
    && fanRootOf(model, body, other) === root);
}

// An operand's type as the condition actually reads it: zipping drops
// the list, because the index has already been applied.
function conditionOperandType(model, body, condition, operand) {
  const resolved = resolveOperandType(operand, {
    boundary: body.boundary || [],
    commandProperties: body.properties || [],
    model,
  });
  if (!resolved) return null;
  if (resolved.isList && isZipped(model, body, condition, operand)) {
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

// The operand that reaches one leaf of a composite identifier's value —
// the same one-hop projection write coverage already applies via
// `{parameterName, property}` / `{alias, property}`. `leaf` comes from
// `idLeavesOfType`; `field: null` means the type is already the leaf,
// so the operand is read whole.
function operandForLeaf(operand, leaf) {
  if (leaf.field === null || operand === undefined) return operand;
  const source = operandSource(operand);
  if (source === 'parameter') return { parameterName: operand.parameterName, property: leaf.field };
  if (source === 'alias-property') return { alias: operand.alias, property: leaf.field };
  return operand;
}

// The tag(s) an identifier-typed value renders as — one per leaf,
// scalar and composite alike, each through that leaf's own `tagSchema`.
// Shared by every DCB preview (a projection binding's arguments, an
// event's published properties): all of them read the same union of
// component tags that `eventDefinitions` describes.
function tagsForIdentifierValue(model, identifierTypeName, operand, { each } = {}) {
  const leaves = idLeavesOfType(model, identifierTypeName);
  if (!leaves.length) {
    // Unresolved mid-edit — nothing to render through, so fall back to
    // the type name literally rather than showing nothing at all.
    const shown = operand === undefined ? '?' : operandText(operand);
    return [`${identifierTypeName}:${each ? `each(${shown})` : shown}`];
  }
  return leaves.map((leaf) => {
    const shown = operand === undefined ? '?' : operandText(operandForLeaf(operand, leaf));
    return renderTag(identifierTypeOf(model, leaf.identifierType), each ? `each(${shown})` : shown);
  });
}

// The tag(s) an entity binding contributes — one per leaf of the
// entity's own derived identifier, scalar or composite alike.
function entityBindingTags(model, entityName, idOperand, excludingOperand, fannedOut) {
  const leaves = idLeavesOfType(model, idTypeOf(model, entityName));
  if (!leaves.length) {
    // An unknown entity mid-edit has no derived identifier to look up —
    // fall back to its bare name so a body still being typed renders
    // something rather than nothing.
    const shown = operandText(idOperand);
    return [fannedOut ? `${entityName}:each(${shown})` : `${entityName}:${shown}`];
  }
  return leaves.map((leaf) => {
    const shownValue = operandText(operandForLeaf(idOperand, leaf));
    const shownExcluding = excludingOperand !== undefined
      ? operandText(operandForLeaf(excludingOperand, leaf)) : null;
    const valueText = fannedOut
      ? `each(${shownValue}${shownExcluding !== null ? ` except ${shownExcluding}` : ''})`
      : shownValue;
    return renderTag(identifierTypeOf(model, leaf.identifierType), valueText);
  });
}

function deriveDcb(model, body) {
  const items = [];

  for (const binding of body.boundary || []) {
    if (!binding) continue;

    if (binding.projection) {
      const projection = model['projection-definitions'][binding.projection];
      if (!projection) continue;
      // A declared projection's parameters *are* its tags, so the query
      // is written from the parameter list rather than from anything
      // about the value — one tag for a scalar identifier parameter,
      // one per component for a composite one. A scripted projection
      // states its tags itself, with argument names interpolated — the
      // one thing the escape hatch is not allowed to hide is what it
      // reads.
      const script = scriptOf(projection);
      const tags = script
        ? (script.tagFilter || []).map((t) => resolveTagFilter(model, t, binding.arguments || {}))
        : (projection.parameters || []).flatMap((p) =>
            tagsForIdentifierValue(model, p.propertyType, (binding.arguments || {})[p.name]));
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
    const entity = model['entity-definitions'][binding.entity];
    const types = new Set();
    if (entity) {
      for (const property of entity.properties || []) {
        if (!readProperties.has(property.name)) continue;
        const projection = model['projection-definitions'][property.projection];
        for (const handler of (projection && projection.handlers) || []) {
          if (handler && handler.event) types.add(handler.event);
        }
      }
    }
    const fannedOut = isFannedOut(model, body, binding);
    items.push({
      alias: binding.alias,
      tags: entityBindingTags(model, binding.entity, binding.id, binding.excluding, fannedOut),
      fannedOut,
      types: [...types].sort(),
      readProperties: [...readProperties].sort(),
    });
  }

  const writes = [];
  for (const emission of body.publishes || []) {
    if (!emission) continue;
    const event = model['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      const listed = property.isList || (operand !== undefined && operandSource(operand) === 'parameter'
        && (body.properties || []).some((p) => p.name === operand.parameterName && p.isList));
      for (const leaf of idLeavesOfType(model, property.propertyType)) {
        const shown = operand === undefined ? '?' : operandText(operandForLeaf(operand, leaf));
        writes.push(renderTag(identifierTypeOf(model, leaf.identifierType), listed ? `each(${shown})` : shown));
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
function mintsFromProjection(model, body, operand, eventName) {
  if (operandSource(operand) !== 'alias-property' || operand.property) return false;
  const binding = (body.boundary || []).find((b) => b && b.alias === operand.alias);
  if (!binding || !binding.projection) return false;
  const projection = model['projection-definitions'][binding.projection];
  return !!projection && (projection.handlers || []).some((h) => h && h.event === eventName);
}

function coverageIssues(model, body) {
  const issues = [];
  for (const emission of body.publishes || []) {
    if (!emission) continue;
    const event = model['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      if (mintsFromProjection(model, body, operand, emission.name)) continue;
      // Checked against the identifier *leaves* of the property's
      // type, not its surface: a property typed `Item[]` writes one
      // tag per element, and each has to have been consulted.
      for (const leaf of idLeavesOfType(model, property.propertyType)) {
        // A leaf whose identifier type is standalone — a component with
        // no entity of its own — has no entity binding that could ever
        // cover it, so there is nothing to check here: coverage is
        // stated in terms of the entity instances a command binds.
        const ownerEntity = entityOfIdType(model, leaf.identifierType);
        if (!ownerEntity) continue;
        const required = leaf.field === null
          ? operand
          : (operandSource(operand) === 'parameter'
            ? { parameterName: operand.parameterName, property: leaf.field }
            : undefined);
        const covered = required !== undefined && (body.boundary || []).some(
          (binding) => binding && binding.entity === ownerEntity && sameOperand(binding.id, required)
        );
        if (!covered) {
          issues.push({
            event: emission.name,
            property: leaf.field === null ? property.name : `${property.name}.${leaf.field}`,
            entity: ownerEntity,
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

function validateModelName(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) throw new DomainError('Model name must not be empty.');
  return trimmed;
}

// Model lifecycle ------------------------------------------------------

function createDcbModel(name) {
  const trimmed = validateModelName(name);
  const id = generateId();
  appendEvents([{ type: 'dcb-model-created', data: { 'dcb-model-id': id, name: trimmed } }]);
  return id;
}

function deleteDcbModel(id) {
  if (!projectState()[id]) throw new DomainError('Model does not exist.');
  appendEvents([{ type: 'dcb-model-deleted', data: { 'dcb-model-id': id } }]);
}

// Definitions ------------------------------------------------------------

function getCtxOrThrow(modelId) {
  const model = projectState()[modelId];
  if (!model) throw new DomainError('Model does not exist (it may have been deleted).');
  return model;
}

function validateReferences(model, kind, name, body) {
  const resolved = withPending(model, kind, name, body);
  const refs = computeReferences(resolved, kind, name, body);
  for (const targetKind of DEF_KINDS) {
    const coll = resolved[DEF_COLLECTIONS[targetKind]];
    for (const targetName of refs[targetKind]) {
      if (!(targetName in coll)) {
        throw new DomainError(
          `Reference does not resolve: ${humanize(targetKind)} "${targetName}" does not exist in this model.`
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
        throw new DomainError(`Type "${p.propertyType}" (property "${p.name}") does not resolve in this model.`);
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
  if (kind === 'projection-scenario-definition') validateProjectionScenarioBody(resolved, body);
}

// Handler validation. `target` is a projection body: `valueType`,
// `isList`, `script` — an entity property is a binding to one, so
// there is exactly one shape to validate.
function validateHandlers(model, label, target, handlers) {
  if (scriptOf(target)) return validateScriptedHandlers(model, label, handlers);
  const allowedOperations = operationsFor(model, target);
  const members = enumMembersFor(model, target.valueType);
  const handledEvents = new Set();

  // `successor` wraps another operand, so recognising an operand means
  // walking into it. It is where numbering lives: a value set to the
  // successor of what an event carried *is* the next value to issue,
  // at every point in its life.
  const successorTypes = ['integer', 'string'];
  const checkOperand = (operand, where) => {
    if (operandSource(operand) === 'successor') {
      // A scalar value type, tag-marked or not, is a string underneath,
      // so it has a successor. An enum does not: its members are a
      // set, and "the next member" means nothing. (A composite has no
      // successor either, but a projection never holds one — its
      // valueType is refused before this runs.)
      const cls = classifyType(model, target.valueType);
      const underlying = cls.kind === 'simple' ? target.valueType
        : (enumMembersFor(model, target.valueType) ? 'enum' : 'string');
      if (!successorTypes.includes(underlying)) {
        throw new DomainError(
          `${where} takes a successor, but ${label} is typed ${target.valueType}. ` +
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
    const event = model['event-definitions'][handler.event];
    if (!event) {
      throw new DomainError(`${label} handles "${handler.event}", which this model does not define.`);
    }
    const where = `The handler for "${handler.event}" on ${label}`;
    // `undefined` is not a value an operand can have — JSON cannot even
    // carry it — but `operandSource` reads it as a static literal, so
    // without this a handler that says what it does without saying
    // what *from* slips through and renders as "undefined" everywhere
    // the effect is spoken. `null` stays legal: "no value yet" is a
    // value.
    if (handler.value === undefined) {
      throw new DomainError(`${where} says what it does but not what value it takes.`);
    }
    const leaf = checkOperand(handler.value, where);
    if (operandSource(leaf) === 'event-property') {
      const known = (event.properties || []).some((p) => p.name === leaf.eventProperty);
      if (!known) {
        throw new DomainError(
          `Handler on ${label} reads "${leaf.eventProperty}", which "${handler.event}" does not carry.`
        );
      }
    }
    if (members && operandSource(leaf) === 'enum-member'
        && !members.includes(leaf.enumMember)) {
      throw new DomainError(
        `Handler on ${label} sets "${leaf.enumMember}", which is not a member of ${target.valueType}.`
      );
    }
  }
}

// A scripted handler is a body of code, and nothing here parses it.
// What can still be checked is what it *claims*: the event exists and
// is claimed once. That is exactly the part the derived DCB reads, so
// the boundary stays trustworthy while the accumulation does not.
function validateScriptedHandlers(model, label, handlers) {
  const handledEvents = new Set();
  for (const handler of handlers || []) {
    if (!handler || !handler.event) {
      throw new DomainError(`A handler on ${label} has no event.`);
    }
    if (handledEvents.has(handler.event)) {
      throw new DomainError(`${label} handles "${handler.event}" twice.`);
    }
    handledEvents.add(handler.event);
    if (!model['event-definitions'][handler.event]) {
      throw new DomainError(`${label} handles "${handler.event}", which this model does not define.`);
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
function validateScript(model, label, target) {
  const script = scriptOf(target);
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
    if (classifyType(model, argument.propertyType).kind === 'unresolved') {
      throw new DomainError(
        `Argument "${argument.name}" on ${label} is typed "${argument.propertyType}", ` +
        'which does not resolve in this model.'
      );
    }
  }

  // Every scripted projection states its own tags: a declared one
  // derives them from its parameters, a scripted one has none, so the
  // filter is the only thing that can say what the query reads. An
  // empty list is legal and means the whole log — the same thing zero
  // parameters mean on a declared projection. An entity property that
  // binds a scripted projection scopes it by interpolating the
  // identifier-typed argument the binding supplies.
  if (!Array.isArray(script.tagFilter)) {
    throw new DomainError(
      `${label} is scripted and states no tag filter. A declared projection derives its tags ` +
      'from its parameters; a scripted one must say what it reads — an empty list means the whole log.'
    );
  }
  for (const template of script.tagFilter) {
    const match = TAG_FILTER_RE.exec(String(template || ''));
    if (!match) {
      throw new DomainError(
        `Tag filter "${template}" on ${label} is not a tag. A tag is "TagType:value", and ` +
        'the value may be a "{argument}" placeholder.'
      );
    }
    const cls = classifyType(model, match[1]);
    if (cls.kind !== 'value') {
      throw new DomainError(
        `Tag filter "${template}" on ${label} names "${match[1]}", which is not a value type.`
      );
    }
    if (cls.composite) {
      throw new DomainError(
        `Tag filter "${template}" on ${label} names "${match[1]}", a composite — it has no tag of ` +
        'its own. Name its tag-marked fields\' own types individually instead.'
      );
    }
    if (!cls.isTag) {
      throw new DomainError(
        `Tag filter "${template}" on ${label} names "${match[1]}", which is not marked "represented ` +
        'as a tag".'
      );
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

// The initial value, checked against the declared type. `null` is
// legal for any type — it is the state before anything has happened,
// and distinct from the empty string. A list-typed projection starts
// at a list, empty or not, of typed elements; `null` never appears
// inside one, because a list of nothing-yets says nothing a shorter
// list does not.
function validateInitialValue(model, label, body) {
  const members = enumMembersFor(model, body.valueType);
  const expected = literalKindOf(model, body.valueType);

  const checkElement = (element, where) => {
    if (operandSource(element) === 'enum-member') {
      if (!members) {
        throw new DomainError(
          `${where} names an enum member, but "${body.valueType}" is not an enum.`
        );
      }
      if (!members.includes(element.enumMember)) {
        throw new DomainError(
          `${where} starts in "${element.enumMember}", which is not a member of ${body.valueType}.`
        );
      }
      return;
    }
    if (element === null || (element !== null && typeof element === 'object')) {
      throw new DomainError(
        `${where} is not a literal — a list element is a value of the list's type, never null ` +
        'and never a record.'
      );
    }
    if (members) {
      throw new DomainError(
        `${where} is a bare literal, but "${body.valueType}" is an enum — name the member as ` +
        '{"enumMember": "..."} so renaming it rewrites this too.'
      );
    }
    if (typeof element !== expected) {
      throw new DomainError(
        `${where} is ${JSON.stringify(element)}, which is not a ${body.valueType}.`
      );
    }
  };

  const value = body.initialValue;
  if (value === null) return;
  if (body.isList) {
    if (!Array.isArray(value)) {
      throw new DomainError(
        `${label} holds a list, so its initial value is one — empty, or holding typed elements.`
      );
    }
    value.forEach((element, index) => checkElement(element, `${label}'s initial element ${index + 1}`));
    return;
  }
  if (Array.isArray(value)) {
    throw new DomainError(`${label} holds a single value, but its initial value is a list.`);
  }
  checkElement(value, `${label}'s initial value`);
}

// One projection — the one shape behind an entity property and a
// standalone read alike: same handlers, same operations, same
// operands. The partition is `parameters` — the tags a command (or an
// entity property binding) supplies when it binds it. No parameters
// means no tag, which is what a global numbering is.
function validateProjectionBody(model, projectionName, body) {
  const valueCls = classifyType(model, body.valueType);
  if (valueCls.kind === 'unresolved') {
    throw new DomainError(
      `Type "${body.valueType}" (projection "${projectionName}") does not resolve in this model.`
    );
  }
  if (valueCls.kind === 'value' && valueCls.composite) {
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
    validateScript(model, `projection "${projectionName}"`, body);
    validateHandlers(model, `projection "${projectionName}"`, body, body.handlers);
    return;
  }

  if (body.initialValue === undefined) {
    throw new DomainError(
      `Projection "${projectionName}" needs an initial value — it is the value before any event ` +
      'has been applied, and for a numbering it is where the prefix is stated. ' +
      '"null" is a value: no value yet.'
    );
  }
  validateInitialValue(model, `Projection "${projectionName}"`, body);

  // Only a tag-bearing type can narrow a query. A parameter of any
  // other type could not restrict what the store returns — it could
  // only discard events after reading them, which is a predicate, and
  // predicates live in conditions. A script is exactly the place where
  // discarding after reading is legitimate, which is why that one
  // takes arguments and not parameters.
  const seenParameters = new Set();
  for (const parameter of body.parameters || []) {
    if (!parameter || !CAMEL_RE.test(parameter.name || '')) {
      throw new DomainError(`A parameter on projection "${projectionName}" needs a camelCase name.`);
    }
    if (seenParameters.has(parameter.name)) {
      throw new DomainError(`Projection "${projectionName}" declares parameter "${parameter.name}" twice.`);
    }
    seenParameters.add(parameter.name);
    if (classifyType(model, parameter.propertyType).kind !== 'value' || !isTagBearing(model, parameter.propertyType)) {
      throw new DomainError(
        `Parameter "${parameter.name}" on projection "${projectionName}" is typed ` +
        `"${parameter.propertyType}", which carries no tag. A parameter becomes a tag, and only ` +
        'a value type marked "represented as a tag" (directly, or through a tag-marked field) is one.'
      );
    }
  }

  // Zero handlers is a legitimate draft: a projection nothing moves
  // yet reads as its initial value, and the interface says so.
  validateHandlers(model, `projection "${projectionName}"`, body, body.handlers);
}

// A value type is scalar (an opaque JSON Schema) or composite (typed
// fields) — never both and never neither. `isTag` is meaningful only
// on the scalar form: a composite is never itself a tag, so it may not
// combine with fields. An entity-owned value type carries one further
// invariant, checked here rather than only at the point of change: it
// must stay tag-bearing, since an entity that could not be tagged
// could not be bound in a DCB query.
//
// A composite's fields are singular, required and never composite
// themselves. All three keep zipping honest: zipping correlates a
// fanned-out binding with the list it fanned from by index, and it only
// means anything while the two have the same length. A list field
// flattens, an optional tag-marked field contributes a variable number
// of tags, and either way the index drifts with nothing on the page to
// show it.
function validateCustomTypeBody(model, typeName, body) {
  const hasSchema = body.schema !== undefined;
  const hasFields = body.properties !== undefined;
  if (hasSchema && hasFields) {
    throw new DomainError(
      `Value type "${typeName}" declares both a schema and fields — it is either scalar or composite, not both.`
    );
  }
  if (!hasSchema && !hasFields) {
    throw new DomainError(`Value type "${typeName}" declares neither a schema nor fields.`);
  }

  if (hasFields) {
    if (body.isTag) {
      throw new DomainError(
        `Value type "${typeName}" is composite and marked "represented as a tag" — only a scalar ` +
        'value type can be. A composite\'s tag-ness is derived from its tag-marked fields instead.'
      );
    }
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
      const cls = classifyType(model, field.propertyType);
      if (cls.kind === 'unresolved') {
        throw new DomainError(
          `Type "${field.propertyType}" (field "${typeName}.${field.name}") does not resolve in this model.`
        );
      }
      // Composites do not nest — an operand reaches one field, never a path.
      if (cls.kind === 'value' && cls.composite) {
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
          `because a missing tag field would contribute no tag and shift every later index.`
        );
      }
    }
  }

  const owner = entityOfIdType(model, typeName);
  if (owner && !isTagBearing(model, typeName)) {
    throw new DomainError(
      `"${typeName}" is entity "${owner}"'s derived identifier — it must stay tag-bearing (a scalar ` +
      'marked "represented as a tag", or a composite with at least one tag-marked field).'
    );
  }
}

// An entity's properties are bindings — `{name, projection}` — and
// what makes a projection bindable is its partition: it must carry
// exactly the slot this binding can fill, one parameter (or, scripted,
// one argument) typed with the entity's own derived identifier. A
// scripted projection must also actually scope by it — a tag filter
// that never interpolates the identifier would fold the whole log and
// call it one instance.
function validateEntityBody(model, entityName, body) {
  if (body.identifierType !== undefined && !PASCAL_RE.test(body.identifierType)) {
    throw new DomainError(
      `Entity "${entityName}"'s identifierType "${body.identifierType}" must be PascalCase.`
    );
  }

  const idType = body.identifierType || (entityName + 'Id');
  const seen = new Set();
  for (const property of body.properties || []) {
    if (!property || !CAMEL_RE.test(property.name || '')) {
      throw new DomainError(`Property name "${(property || {}).name}" must be camelCase.`);
    }
    if (seen.has(property.name)) throw new DomainError(`Entity declares property "${property.name}" twice.`);
    seen.add(property.name);

    const projection = model['projection-definitions'][property.projection];
    if (!projection) {
      throw new DomainError(
        `Property "${property.name}" binds projection "${property.projection}", ` +
        'which this model does not define.'
      );
    }
    const script = scriptOf(projection);
    if (script) {
      const slot = (script.arguments || []).find((a) => a && a.propertyType === idType);
      if (!slot) {
        throw new DomainError(
          `Property "${property.name}" binds "${property.projection}", which declares no ` +
          `${idType}-typed argument — nothing would carry the instance into its code.`
        );
      }
      const scoped = (script.tagFilter || []).some((template) =>
        tagFilterPlaceholders(template).includes(slot.name));
      if (!scoped) {
        throw new DomainError(
          `Property "${property.name}" binds "${property.projection}", whose tag filter never ` +
          `interpolates "{${slot.name}}" — it would fold the same events for every instance.`
        );
      }
      continue;
    }
    const parameters = projection.parameters || [];
    if (parameters.length !== 1 || parameters[0].propertyType !== idType) {
      throw new DomainError(
        `Property "${property.name}" binds "${property.projection}", which is partitioned by ` +
        `${parameters.length ? parameters.map((p) => `"${p.name}" (${p.propertyType})`).join(', ')
          : 'nothing'} — an entity property needs exactly one parameter typed ${idType}, ` +
        'so the binding can supply the instance.'
      );
    }
  }
}

function validateCommandBody(model, body) {
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
      const projection = model['projection-definitions'][binding.projection];
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

    if (!model['entity-definitions'][binding.entity]) {
      throw new DomainError(`Boundary binding "${binding.alias}" names unknown entity "${binding.entity}".`);
    }
    if (binding.id === undefined || binding.id === null || operandIncomplete(binding.id)) {
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
    if (binding.excluding !== undefined && !isFannedOut(model, body, binding)) {
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
      if (binding && isFannedOut(model, body, binding)) {
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
    const roots = conditionFanRoots(model, body, condition);
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
    const left = conditionOperandType(model, body, condition, condition.leftHandSide);
    const right = conditionOperandType(model, body, condition, condition.rightHandSide);
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
    const left = conditionOperandType(model, body, condition, condition.leftHandSide);
    const right = conditionOperandType(model, body, condition, condition.rightHandSide);
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
      const fields = parameter && compositeFieldsOf(model, parameter.propertyType);
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
      const entity = model['entity-definitions'][binding.entity];
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
    const entity = model['entity-definitions'][binding.entity];
    if (!entity) continue;
    const expected = argumentsExpected(model, body, binding);
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
        boundary, commandProperties: body.properties || [], model,
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
      // A projection binding has no entity and so no properties to
      // check the member against — its value type is not examined here.
      const entity = binding.entity && model['entity-definitions'][binding.entity];
      if (!entity) continue;
      const property = (entity.properties || []).find((p) => p.name === other.property);
      if (!property) continue;
      const members = enumMembersFor(model, property.propertyType);
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

  const issues = coverageIssues(model, body);
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

// Checks a stored payload against the properties it is written from.
// Both directions matter: a missing one cannot be evaluated, and an
// invented one is a reference nothing would ever rewrite. An optional
// property may simply not be there — that is what optional means, in a
// Given as much as in a When. Shared by both scenario kinds, so the
// two never disagree about what a payload owes.
function checkScenarioPayload(values, properties, label) {
  const held = values || {};
  const declared = new Set();
  for (const property of properties || []) {
    declared.add(property.name);
    if (!(property.name in held)) {
      if (property.isOptional) continue;
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
}

function validateScenarioBody(model, body) {
  if (body.name !== undefined && typeof body.name !== 'string') {
    throw new DomainError('A scenario name is text, or absent when the derived one will do.');
  }
  if (!body.command) throw new DomainError('A scenario has to name the command it exercises.');
  const command = model['command-definitions'][body.command];

  if (!Array.isArray(body.given)) {
    throw new DomainError('A scenario\'s Given is a list of events, empty when nothing has happened yet.');
  }
  body.given.forEach((step, index) => {
    const where = `Given step ${index + 1}`;
    if (!step || !step.event) throw new DomainError(`${where} names no event.`);
    checkScenarioPayload(step.data, (model['event-definitions'][step.event] || {}).properties,
      `${where} ("${step.event}")`);
  });

  const when = body.when || {};
  checkScenarioPayload(when.arguments, (command || {}).properties, `The When ("${body.command}")`);

  const then = body.then;
  if (!then || (then.outcome !== 'published' && then.outcome !== 'rejected')) {
    throw new DomainError('A scenario\'s Then is either published or rejected.');
  }
  if (!Array.isArray(then.events)) {
    throw new DomainError('A scenario\'s Then holds the events it expects, empty when it expects none.');
  }
  then.events.forEach((event, index) => {
    if (!event || !event.type) throw new DomainError(`Expected event ${index + 1} names no type.`);
    checkScenarioPayload(event.data, (model['event-definitions'][event.type] || {}).properties,
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
function validateProjectionScenarioBody(model, body) {
  if (body.name !== undefined && typeof body.name !== 'string') {
    throw new DomainError('A projection scenario name is text, or absent when the derived one will do.');
  }

  if (!Array.isArray(body.given)) {
    throw new DomainError('A projection scenario\'s Given is a list of events, empty when nothing has happened yet.');
  }
  body.given.forEach((step, index) => {
    const where = `Given step ${index + 1}`;
    if (!step || !step.event) throw new DomainError(`${where} names no event.`);
    checkScenarioPayload(step.data, (model['event-definitions'][step.event] || {}).properties,
      `${where} ("${step.event}")`);
  });

  const projection = model['projection-definitions'][body.projection];
  if (!projection) {
    throw new DomainError(
      `This scenario is about projection "${body.projection}", which this model does not define.`
    );
  }
  // The arguments a scenario owes are the projection's own — its
  // parameters when declared, its script's arguments when scripted. The
  // same "required here, rejected there" rule a command binding
  // follows, and for the same reason: an argument that means nothing is
  // a mistake, not a no-op.
  const script = scriptOf(projection);
  const expected = script ? (script.arguments || []) : (projection.parameters || []);
  const supplied = Object.keys(body.arguments || {});
  for (const parameter of expected) {
    if (!supplied.includes(parameter.name)) {
      throw new DomainError(
        `This scenario supplies no "${parameter.name}", which "${body.projection}" ` +
        `${script ? 'takes as an argument' : 'is partitioned by'}.`
      );
    }
  }
  for (const key of supplied) {
    if (!expected.some((p) => p.name === key)) {
      throw new DomainError(
        `This scenario supplies "${key}", which "${body.projection}" does not declare as ` +
        `${script ? 'an argument' : 'a parameter'}.`
      );
    }
  }

  // `then` is the projection's own value, so every shape one can hold
  // is legal here — `null` and `[]` included. There is nothing left to
  // check that the fold itself does not.
  if (!('then' in body)) {
    throw new DomainError('A projection scenario\'s Then is what the projection folded to.');
  }
}

function addDefinition(kind, modelId, name, body) {
  const model = getCtxOrThrow(modelId);
  const trimmed = validateDefinitionKey(kind, name, `${humanize(kind)} name`);
  const coll = model[DEF_COLLECTIONS[kind]];
  if (trimmed in coll) {
    throw new DomainError(`A ${humanize(kind)} named "${trimmed}" already exists in this model.`);
  }
  if (kind === 'entity-definition') {
    // An entity's derived identifier is an ordinary value type, created
    // in the same append so the two never exist without each other —
    // scalar, a plain string, and marked as a tag, which is the
    // ordinary case. Naming it `<name>Id` unless `identifierType`
    // overrides it, and colliding with an existing value type is
    // refused exactly like any other name collision.
    const idTypeName = body.identifierType || (trimmed + 'Id');
    validateDefinitionKey('custom-type-definition', idTypeName, 'Value type name');
    if (model['custom-type-definitions'][idTypeName] !== undefined) {
      throw new DomainError(
        `Entity "${trimmed}" would derive the type "${idTypeName}", but a value type by that name already exists.`
      );
    }
    const idTypeBody = { schema: { type: 'string' }, isTag: true };
    validateReferences(withPending(model, 'custom-type-definition', idTypeName, idTypeBody), kind, trimmed, body);
    appendEvents([
      { type: 'custom-type-definition-added', data: { 'dcb-model-id': modelId, name: idTypeName, body: idTypeBody } },
      { type: 'entity-definition-added', data: { 'dcb-model-id': modelId, name: trimmed, body } },
    ]);
    return;
  }
  validateReferences(model, kind, trimmed, body);
  appendEvents([{ type: `${kind}-added`, data: { 'dcb-model-id': modelId, name: trimmed, body } }]);
}

function validateDefinitionUpdate(model, kind, name, body) {
  const coll = model[DEF_COLLECTIONS[kind]];
  if (!(name in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${name}" exists in this model.`);
  }
  if (kind === 'entity-definition' && (coll[name].identifierType || null) !== (body.identifierType || null)) {
    // Changing `identifierType` moves which value type the entity
    // derives — every reference to the old one has to move with it,
    // the same as any other rename. An ordinary update cannot carry
    // that cascade: renaming the entity's derived identifier happens
    // by renaming the value type itself, in Custom Types.
    throw new DomainError(
      `Cannot change "${name}"'s identifierType through an ordinary update — rename the value type ` +
      'itself instead, which moves this reference along with every other.'
    );
  }
  validateReferences(model, kind, name, body);
  if (kind === 'entity-definition') assertEntityUpdateKeepsInboundReferences(model, name, body);
  if (kind === 'custom-type-definition') assertCustomTypeUpdateKeepsInboundReferences(model, name, body);
  if (kind === 'projection-definition') assertProjectionUpdateKeepsBindingsFitting(model, name, body);
}

function updateDefinition(kind, modelId, name, body) {
  updateDefinitions(modelId, [{ kind, name, body }]);
}

// Several updates as one append: a gesture that touches every command
// in a feature grows the log by one step and writes storage once.
// Each change is validated against the model as it stood before the
// gesture — sound because the callers touch a different definition
// each, so no change needs to see another one applied.
function updateDefinitions(modelId, changes) {
  const model = getCtxOrThrow(modelId);
  for (const { kind, name, body } of changes) validateDefinitionUpdate(model, kind, name, body);
  appendEvents(changes.map(({ kind, name, body }) => (
    { type: `${kind}-updated`, data: { 'dcb-model-id': modelId, name, body } }
  )));
}

// A projection's parameters are supplied by *key*, so changing them
// under a command that binds it would leave that command holding
// arguments for a partition that no longer exists. Renaming one is a
// `renameMember` — which moves the keys in the same append — and this
// is what stops it happening any other way.
function assertProjectionUpdateKeepsBindingsFitting(model, projectionName, body) {
  // An entity property binding fits while the projection keeps the one
  // slot the binding fills — reshaping the partition under a bound
  // property is refused the same way reshaping it under a command is.
  for (const [entityName, entity] of Object.entries(model['entity-definitions'])) {
    for (const property of entity.properties || []) {
      if (!property || property.projection !== projectionName) continue;
      const idType = idTypeOf(model, entityName);
      const script = scriptOf(body);
      const fits = script
        ? (script.arguments || []).some((a) => a && a.propertyType === idType)
        : ((body.parameters || []).length === 1 && body.parameters[0].propertyType === idType);
      if (!fits) {
        throw new DomainError(
          `"${entityName}.${property.name}" binds "${projectionName}", and this change would leave ` +
          `it without the ${idType}-typed slot that binding fills. Unbind the property first.`
        );
      }
    }
  }
  const parameters = (body.parameters || []).map((p) => p && p.name);
  for (const [commandName, command] of Object.entries(model['command-definitions'])) {
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
function assertEntityUpdateKeepsInboundReferences(model, entityName, body) {
  const propertyNames = new Set((body.properties || []).map((p) => p.name));
  for (const [commandName, command] of Object.entries(model['command-definitions'])) {
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

// Dropping a member of an enum value type that a command still
// compares against is refused rather than silently breaking the
// command. Scoped to the type itself rather than to one entity, since
// any number of properties across any number of entities may now
// reference it. Mirrors `assertEntityUpdateKeepsInboundReferences`
// exactly, checking conditions only — the same narrower guarantee the
// reserved status property carried before it.
function assertCustomTypeUpdateKeepsInboundReferences(model, typeName, body) {
  const previousMembers = enumMembersFor(model, typeName);
  if (!previousMembers) return;
  const nextMembers = new Set(
    Array.isArray(body.schema && body.schema.enum) ? body.schema.enum : []
  );
  for (const [commandName, command] of Object.entries(model['command-definitions'])) {
    for (const condition of command.conditions || []) {
      if (!condition) continue;
      for (const side of [condition.leftHandSide, condition.rightHandSide]) {
        if (operandSource(side) !== 'enum-member') continue;
        if (nextMembers.has(side.enumMember) || !previousMembers.includes(side.enumMember)) continue;
        const other = side === condition.leftHandSide ? condition.rightHandSide : condition.leftHandSide;
        const resolved = resolveOperandType(other, {
          boundary: command.boundary || [],
          commandProperties: command.properties || [],
          model,
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
function scriptedHandlersOf(model, eventName) {
  const out = [];
  const handles = (target) => (target.handlers || []).some((h) => h && h.event === eventName);
  for (const [name, projection] of Object.entries(model['projection-definitions'])) {
    if (!scriptOf(projection) || !handles(projection)) continue;
    // Named the way a person would say it: through the property that
    // binds it where one does, bare where none does.
    const labels = [];
    for (const [entityName, entity] of Object.entries(model['entity-definitions'])) {
      for (const property of entity.properties || []) {
        if (property && property.projection === name) labels.push(`${entityName}.${property.name}`);
      }
    }
    out.push(...(labels.length ? labels : [name]));
  }
  return out;
}

// Renaming an entity while its derived identifier is still tracking
// (`identifierType` absent) moves two names in one append: the entity
// itself, and — since the value type is a real stored definition now —
// its still-default-named `<name>Id` alongside it. Neither is pinned
// explicit afterward, so both keep tracking indefinitely. This is kept
// separate from the ordinary rename path below because it merges two
// referencer sets (whoever names the entity, whoever names its id
// type) into one append, and because an entity with an *explicit*
// `identifierType` needs none of this — that case falls through to the
// ordinary path, which renames only the entity.
function renameEntityDefinition(model, modelId, previousName, trimmed) {
  const entityBody = model['entity-definitions'][previousName];
  const oldIdType = previousName + 'Id';
  const newIdType = trimmed + 'Id';
  if (model['custom-type-definitions'][newIdType] !== undefined) {
    throw new DomainError(
      `Entity "${trimmed}" would derive the type "${newIdType}", but a value type by that name already exists.`
    );
  }

  const events = [
    { type: 'entity-definition-renamed', data: { 'dcb-model-id': modelId, 'previous-name': previousName, name: trimmed } },
    { type: 'custom-type-definition-renamed', data: { 'dcb-model-id': modelId, 'previous-name': oldIdType, name: newIdType } },
  ];
  const touched = new Map();
  const addRewrite = (ref) => {
    const key = `${ref.kind}:${ref.name}`;
    if (touched.has(key)) return;
    let body = rewriteReferences(ref.kind, ref.body, 'entity-definition', previousName, trimmed);
    body = rewriteReferences(ref.kind, body, 'custom-type-definition', oldIdType, newIdType);
    touched.set(key, { kind: ref.kind, name: ref.kind === 'entity-definition' && ref.name === previousName ? trimmed : ref.name, body });
  };
  for (const ref of findReferencers(model, 'entity-definition', previousName)) addRewrite(ref);
  for (const ref of findReferencers(model, 'custom-type-definition', oldIdType)) addRewrite(ref);
  for (const { kind: refKind, name, body } of touched.values()) {
    events.push({ type: `${refKind}-updated`, data: { 'dcb-model-id': modelId, name, body } });
  }
  appendEvents(events);
}

function renameDefinition(kind, modelId, previousName, newName) {
  const model = getCtxOrThrow(modelId);
  if (isIdKeyed(kind)) {
    throw new DomainError(
      `A ${humanize(kind)} is identified by a generated id and its name lives in its body, ` +
      'so renaming one is an ordinary update rather than a rename.'
    );
  }
  const trimmed = validateName(newName, `New ${humanize(kind)} name`);
  const coll = model[DEF_COLLECTIONS[kind]];
  if (!(previousName in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${previousName}" exists in this model.`);
  }
  if (trimmed === previousName) return;
  if (trimmed in coll) {
    throw new DomainError(`A ${humanize(kind)} named "${trimmed}" already exists in this model.`);
  }

  if (kind === 'entity-definition' && coll[previousName].identifierType === undefined) {
    renameEntityDefinition(model, modelId, previousName, trimmed);
    return;
  }

  const referencers = findReferencers(model, kind, previousName);
  const events = [{
    type: `${kind}-renamed`,
    data: { 'dcb-model-id': modelId, 'previous-name': previousName, name: trimmed },
  }];
  for (const ref of referencers) {
    // A value type can reference itself — a composite field typed with
    // one of its own siblings' names is not self-reference, but an
    // entity's own self-referencing property is. That rewrite lands on
    // the new name, since the rename event is applied first.
    const isSelf = ref.kind === kind && ref.name === previousName;
    let rewritten = rewriteReferences(ref.kind, ref.body, kind, previousName, trimmed);
    // Renaming a value type directly (not via the entity-rename path
    // above): an entity that was tracking it — no explicit
    // `identifierType` — has to pin the new name explicitly now, or it
    // would silently keep recomputing a default that no longer exists.
    if (kind === 'custom-type-definition' && ref.kind === 'entity-definition'
        && ref.body.identifierType === undefined) {
      rewritten = { ...rewritten, identifierType: trimmed };
    }
    events.push({
      type: `${ref.kind}-updated`,
      data: { 'dcb-model-id': modelId, name: isSelf ? trimmed : ref.name, body: rewritten },
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
// `(model, definitionName, previous, next) => [{kind, name, body}]`.
const MEMBER_REWRITES = {
  // An entity property is read as `{alias, property}` by any command
  // that binds this entity under that alias.
  'entity-definition:property': (model, entityName, previous, next) =>
    rewriteCommands(model, (command) => {
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
  // may be held by any number of projections, so this reaches every one
  // of them rather than one private owner.
  'custom-type-definition:member': (model, typeName, previous, next) => {
    const out = [];

    // Every projection typed with this enum refers to its members
    // through its initial value — scalar or an element of a list — and
    // its handler values.
    for (const [name, projection] of Object.entries(model['projection-definitions'])) {
      if (projection.valueType !== typeName) continue;
      const body = deepClone(projection);
      let touched = false;
      const renamed = (value) => {
        if (operandSource(value) === 'enum-member' && value.enumMember === previous) {
          touched = true;
          return { enumMember: next };
        }
        return value;
      };
      body.initialValue = Array.isArray(body.initialValue)
        ? body.initialValue.map(renamed)
        : renamed(body.initialValue);
      for (const handler of body.handlers || []) {
        rewriteHandlerOperand(handler && handler.value, (operand) => {
          if (operand.enumMember === previous) { operand.enumMember = next; touched = true; }
        });
      }
      if (touched) out.push({ kind: 'projection-definition', name, body });
    }

    // A command condition compares an entity's enum-typed property
    // against a member by value — resolved through the boundary rather
    // than assumed, since the bound entity is whichever the alias names.
    out.push(...rewriteCommands(model, (command) => {
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
            model,
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
  'event-definition:property': (model, eventName, previous, next) => {
    const out = [];
    const handlesIt = (handlers) => (handlers || []).some((h) => h && h.event === eventName);

    // Handlers live only on projections now — an entity property is a
    // binding with nothing inside it for this rename to reach.
    for (const [name, projection] of Object.entries(model['projection-definitions'])) {
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
    out.push(...rewriteCommands(model, (command) => {
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
    out.push(...rewriteScenarios(model, (scenario) => {
      let touched = false;
      for (const payload of scenarioPayloads(model, scenario)) {
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
  'command-definition:property': (model, commandName, previous, next) => [
    ...rewriteCommands(model, (command, name) => {
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
    ...rewriteScenarios(model, (scenario) => {
      if (scenario.command !== commandName) return false;
      const when = scenario.when;
      if (!when || !when.arguments || !(previous in when.arguments)) return false;
      when.arguments = renameKey(when.arguments, previous, next);
      return true;
    }),
  ],

  // A composite's field is reached only through a parameter typed with
  // that composite — `{parameterName: items, property: productId}`.
  'custom-type-definition:field': (model, typeName, previous, next) => [
    ...rewriteCommands(model, (command) => {
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
    ...rewriteScenarios(model, (scenario) => {
      let touched = false;
      for (const payload of scenarioPayloads(model, scenario)) {
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
  'projection-definition:parameter': (model, projectionName, previous, next) =>
    rewriteCommands(model, (command) => {
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
function rewriteScenarios(model, mutate) {
  const out = [];
  for (const [name, scenario] of Object.entries(model['scenario-definitions'] || {})) {
    const body = deepClone(scenario);
    if (mutate(body, name)) out.push({ kind: 'scenario-definition', name, body });
  }
  return out;
}

// Every payload a scenario holds, paired with the definition its keys
// are written from. One walk serves both the event-property rename and
// the composite-field rename, which reach the same objects by different
// routes.
function scenarioPayloads(model, scenario) {
  const out = [];
  for (const step of scenario.given || []) {
    if (!step || !step.event) continue;
    const event = model['event-definitions'][step.event];
    if (event) out.push({ owner: step, key: 'data', event: step.event, properties: event.properties });
  }
  for (const event of (scenario.then || {}).events || []) {
    if (!event || !event.type) continue;
    const definition = model['event-definitions'][event.type];
    if (definition) {
      out.push({ owner: event, key: 'data', event: event.type, properties: definition.properties });
    }
  }
  const command = model['command-definitions'][scenario.command];
  if (command && scenario.when) {
    out.push({ owner: scenario.when, key: 'arguments', command: scenario.command,
      properties: command.properties });
  }
  return out;
}

// Applies `mutate` to a deep copy of every command and returns the ones
// it actually changed.
function rewriteCommands(model, mutate) {
  const out = [];
  for (const [name, command] of Object.entries(model['command-definitions'])) {
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

function renameMember(kind, modelId, definitionName, memberKind, previousName, newName) {
  const model = getCtxOrThrow(modelId);
  const body = (model[DEF_COLLECTIONS[kind]] || {})[definitionName];
  if (!body) {
    throw new DomainError(`No ${humanize(kind)} named "${definitionName}" exists in this model.`);
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
  const rewrites = rewrite(model, definitionName, previousName, trimmed);
  const ownerRewrite = rewrites.find((r) => r.kind === kind && r.name === definitionName);
  const ownerBody = deepClone(ownerRewrite ? ownerRewrite.body : body);
  setAtDottedPath(ownerBody, shape.list, (getAtDottedPath(ownerBody, shape.list) || []).map((m) => {
    if (!shape.named) return m === previousName ? trimmed : m;
    return m && m.name === previousName ? { ...m, name: trimmed } : m;
  }));

  const events = [{
    type: `${kind}-updated`,
    data: { 'dcb-model-id': modelId, name: definitionName, body: ownerBody },
  }];
  for (const r of rewrites) {
    if (r.kind === kind && r.name === definitionName) continue;
    events.push({
      type: `${r.kind}-updated`,
      data: { 'dcb-model-id': modelId, name: r.name, body: r.body },
    });
  }
  appendEvents(events);
}

function removeDefinition(kind, modelId, name) {
  const model = getCtxOrThrow(modelId);
  const coll = model[DEF_COLLECTIONS[kind]];
  if (!(name in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${name}" exists in this model.`);
  }
  const referencers = findReferencers(model, kind, name)
    .filter((r) => !(r.kind === kind && r.name === name))
    // A scenario or projection scenario names what it tests, but it may
    // never refuse the change: a test exists to report what a change
    // broke, not to prevent it. Deleting what one reads leaves it
    // broken and says so, which is the whole point of keeping it.
    .filter((r) => r.kind !== 'scenario-definition' && r.kind !== 'projection-scenario-definition');
  if (referencers.length > 0) {
    const list = referencers.map((r) => `${humanize(r.kind)} "${r.name}"`).join(', ');
    throw new DomainError(`Cannot remove ${humanize(kind)} "${name}" — still referenced by: ${list}.`);
  }

  if (kind === 'entity-definition') {
    // The entity's own derived custom type is removed alongside it —
    // auto-created together, they go together, bypassing that type's
    // own referencer check (a direct removal of *it* would still be
    // blocked — see the collision this creates in `findReferencers`
    // above, which is what makes that block work). Anything else still
    // naming it is left broken, reported the same way this system
    // already reports every other broken reference: a scenario left
    // saying what it used to check, a projection scenario left reporting
    // what it found.
    const idType = idTypeOf(model, name);
    appendEvents([
      { type: 'entity-definition-removed', data: { 'dcb-model-id': modelId, name } },
      { type: 'custom-type-definition-removed', data: { 'dcb-model-id': modelId, name: idType } },
    ]);
    return;
  }
  appendEvents([{ type: `${kind}-removed`, data: { 'dcb-model-id': modelId, name } }]);
}

// Changes the order this collection's members are stored in — the order
// every listing reads directly off the collection, since nothing here
// keeps a separate position field. `order` has to name every current
// member exactly once; it says nothing about *which* moved, so the fold
// just replays the collection in that order.
function reorderDefinitions(kind, modelId, order) {
  const model = getCtxOrThrow(modelId);
  const coll = model[DEF_COLLECTIONS[kind]];
  const current = Object.keys(coll);
  const sameMembers = order.length === current.length && current.every((key) => order.includes(key));
  if (!sameMembers) {
    throw new DomainError(`Reordering ${humanize(kind)}s must name every one of them, exactly once.`);
  }
  appendEvents([{ type: `${kind}-reordered`, data: { 'dcb-model-id': modelId, order } }]);
}

// ============================================================
// Utilities the model layer leans on.
// ============================================================

// The value a freshly created projection starts from, chosen from its
// type so the editor can pre-fill one — the stored value is always
// explicit, this is only the suggestion.
function defaultInitialValue(model, target) {
  if (target.isList) return [];
  const members = enumMembersFor(model, target.valueType);
  if (members) return { enumMember: members[0] || '' };
  if (literalKindOf(model, target.valueType) === 'number') return 0;
  if (literalKindOf(model, target.valueType) === 'boolean') return false;
  return '';
}

function humanize(kind) {
  return kind.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
}

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

// ============================================================
// Sharing a model with the outside world.
//
// The wire format is `{ $schema, dcbModelVersion, name }` followed by
// the definition arrays themselves — the six kinds, plus
// `projectionScenarioDefinitions?` and `sandbox?` — and it is exactly what
// `dcb-model.schema.json` describes, so a file built by another tool
// against that schema drops straight in.
//
// The arrays sit at the top level rather than under a wrapper. They used
// to be nested, back when the published schema described only that inner
// object and an external tool needed something to target; once the
// schema grew to cover the whole document there was nothing left for the
// nesting to do but make the file claim to contain a model rather than
// be one. Flattening also stops `projectionScenarioDefinitions` reading as
// a second-class kind: it is listed apart from the six only because it
// hangs off an entity rather than being one of them.
//
// Two markers say what a document is, and they are not
// interchangeable. `dcbModelVersion` is the one an importer
// dispatches on. `$schema` is for editors — it is what makes a
// hand-edited export complete and validate in place — and nothing here
// ever reads it, deliberately: repointing it at a local copy to work
// offline is a legitimate thing to do to a document, and a reader that
// checked it would reject exactly the files someone had been careful
// with.
//
// Both ride in both directions out of the playground — readable JSON
// and the gzipped payload of a share link — because a marker one
// channel may omit is a marker `importModelFromEnvelope` could not
// insist on.
//
// `sandbox`, if present, is a list of driven commands: never part of
// the model, exactly the ephemeral thing it already is everywhere
// else in this app, and carried only so that a shared link opens on the
// state its sender was looking at.
// ============================================================

// The version of the wire format above, `major.minor`. A major bump
// means a reader built against an earlier one cannot correctly read the
// document; a minor means it can, because the addition is one it
// ignores — which the validation in this file makes possible by
// checking only what it knows about and never rejecting a key it has
// not heard of (`CommandDefinition.feature` has ridden along that way
// from the start). What counts as additive is judged from the reader's
// side, though, not the schema's: another member of a closed vocabulary
// — a condition operator, an operand shape, a handler operation — is a
// *major* change even where the schema merely grows an enum, because
// `operationsFor` fails on the value rather than passing it through.
// 2.0 unified projections: entity properties became bindings to
// ordinary projection definitions, partitions became explicit
// parameters, `isOptional` was dropped and initial values grew typed
// (possibly non-empty) lists, and property scenarios became projection
// scenarios asserting over a list of reads — every one of them a change
// a 1.x reader would misread rather than ignore.
const MODEL_VERSION = '3.0';
const MODEL_SCHEMA_URL = 'https://dcb.events/schemas/model/v3.json';

const SCHEMA_FIELD = {
  'custom-type-definition': 'customTypeDefinitions',
  'event-definition': 'eventDefinitions',
  'entity-definition': 'entityDefinitions',
  'projection-definition': 'projectionDefinitions',
  'command-definition': 'commandDefinitions',
  'scenario-definition': 'scenarioDefinitions',
  'projection-scenario-definition': 'projectionScenarioDefinitions',
};

// The six kinds that carry a definition each. Projection scenarios are
// the seventh the schema documents; they are assembled separately only
// because they are authored against whatever set of projections someone
// wanted to check at once rather than being one of these.
const SCHEMA_KINDS = [
  'custom-type-definition', 'event-definition', 'entity-definition',
  'projection-definition', 'command-definition', 'scenario-definition',
];

function definitionsToSchemaArray(kind, coll) {
  const idField = isIdKeyed(kind) ? 'id' : 'name';
  return Object.entries(coll || {}).map(([key, body]) => ({ [idField]: key, ...body }));
}

function schemaArrayToDefinitions(kind, list) {
  const idField = isIdKeyed(kind) ? 'id' : 'name';
  const coll = {};
  for (const item of list || []) {
    const { [idField]: key, ...body } = item;
    coll[key] = body;
  }
  return coll;
}

function definitionsToSchema(model) {
  const out = {};
  for (const kind of SCHEMA_KINDS) {
    out[SCHEMA_FIELD[kind]] = definitionsToSchemaArray(kind, model[DEF_COLLECTIONS[kind]]);
  }
  return out;
}

// `sandboxSteps` — `[{ command, args }]` — comes in from the caller
// rather than being read off a global here: this file knows nothing of
// the interactive session index.html keeps.
function buildShareEnvelope(model, sandboxSteps) {
  const envelope = {
    $schema: MODEL_SCHEMA_URL,
    dcbModelVersion: MODEL_VERSION,
    name: model.name,
    ...definitionsToSchema(model),
  };
  const propertyScenarios = definitionsToSchemaArray(
    'projection-scenario-definition', model['projection-scenario-definitions']
  );
  if (propertyScenarios.length) envelope.projectionScenarioDefinitions = propertyScenarios;
  if (sandboxSteps && sandboxSteps.length) envelope.sandbox = { steps: sandboxSteps };
  return envelope;
}

// Whether importing this envelope would run authored code the moment
// anything touches it — a property or a projection carrying a `script`
// both compile through the same unsandboxed path (see `evCompileHandler`
// in evaluate.js). This is what gates the confirmation before import.
function envelopeHasScript(envelope) {
  if (!envelope || typeof envelope !== 'object') return false;
  // Scripts live only on projections — an entity property is a binding
  // and carries none of its own.
  return (envelope.projectionDefinitions || []).some((p) => !!p.script);
}

// An entity, stripped down to what can exist before the projections
// its properties bind are added: the bindings are dropped wholesale
// and put back by `updateDefinition` once every projection exists. An
// entity with no properties is legal — one consulted purely by tag —
// so the bare form is always addable.
function bareEntityBody(body) {
  return { ...body, properties: [] };
}

// Adds a mixed batch of custom types and bare entities, retrying
// whatever fails until a full pass makes no progress. The two kinds can
// reference each other in either direction — a composite value type
// naming an entity's derived identifier, or an entity's `identifierType`
// naming a standalone value type — so neither can be finished first in
// general; nothing downstream of this (events, full entities,
// projections, commands, scenarios) has that problem, so it is the only
// phase that needs retrying rather than a single ordered pass.
function addManyWithRetry(modelId, items) {
  let remaining = items;
  let lastError = null;
  while (remaining.length) {
    const next = [];
    let progressed = false;
    for (const item of remaining) {
      try {
        addDefinition(item.kind, modelId, item.name, item.body);
        progressed = true;
      } catch (error) {
        next.push(item);
        lastError = error;
      }
    }
    if (!progressed) throw lastError;
    remaining = next;
  }
}

// The synthesizer: rebuilds a shared model into a brand-new one by
// replaying it through the same validating commands manual editing
// uses, so an untrusted export can never land in a state those commands
// would have refused. A failure partway leaves a partial-but-valid
// model in place, exactly like a manual edit interrupted midway —
// `deleteDcbModel` is the way out, not a rollback this adds.
// The wire format's two markers, checked. Only `dcbModelVersion` is
// read: `$schema` has to be *present*, because a document without one
// was not written by anything that knows this format and its shape is
// a guess from there — but what it points at is the author's business,
// and a reader that insisted on a particular URL would reject exactly
// the file someone had repointed at a local copy to work offline.
//
// A major this build does not know is refused rather than half-read. A
// newer minor is read, since a minor only ever adds what an older
// reader ignores; `envelopeVersionWarning` is how that gets said out
// loud instead of silently.
function parseEnvelopeVersion(envelope) {
  const raw = envelope && envelope.dcbModelVersion;
  const match = typeof raw === 'string' && /^(\d+)\.(\d+)$/.exec(raw);
  if (!match) return null;
  return { raw, major: Number(match[1]), minor: Number(match[2]) };
}

function assertEnvelopeVersion(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new DomainError('That does not look like a shared DCB model.');
  }
  if (typeof envelope.$schema !== 'string' || !envelope.$schema) {
    throw new DomainError(
      'That file declares no "$schema", so it was not written against the DCB '
      + 'model format.'
    );
  }
  const version = parseEnvelopeVersion(envelope);
  if (!version) {
    throw new DomainError(
      'That file declares no readable "dcbModelVersion", so there is no way '
      + 'to tell which format it is in.'
    );
  }
  const expected = parseEnvelopeVersion({ dcbModelVersion: MODEL_VERSION });
  if (version.major !== expected.major) {
    throw new DomainError(
      `That file is DCB model ${version.raw}, and this playground reads `
      + `${expected.major}.x (currently ${MODEL_VERSION}). Nothing here would `
      + 'read it correctly, so it is refused rather than half-read.'
    );
  }
  return version;
}

// Non-empty when a document comes from a newer minor than this build
// knows: readable, because that is what a minor promises, but it may
// carry things this playground drops without ever mentioning them.
function envelopeVersionWarning(envelope) {
  const version = parseEnvelopeVersion(envelope);
  const expected = parseEnvelopeVersion({ dcbModelVersion: MODEL_VERSION });
  if (!version || version.major !== expected.major) return '';
  if (version.minor <= expected.minor) return '';
  return `This model is version ${version.raw}; this playground knows `
    + `${MODEL_VERSION}. It will load, but anything the newer format adds is `
    + 'being ignored.';
}

// The five kinds a model must declare, even if empty. `scenarioDefinitions`
// is the sixth and is optional, the same way the schema has it.
const REQUIRED_SCHEMA_KINDS = SCHEMA_KINDS.filter((kind) => kind !== 'scenario-definition');

function importModelFromEnvelope(envelope) {
  assertEnvelopeVersion(envelope);
  // There is no wrapper object to look for any more — the definition
  // arrays sit directly on the envelope — so what identifies a model is
  // that the kinds one must declare are actually there and are lists.
  for (const kind of REQUIRED_SCHEMA_KINDS) {
    if (!Array.isArray(envelope[SCHEMA_FIELD[kind]])) {
      throw new DomainError('That does not look like a shared DCB model.');
    }
  }
  // Required, and deliberately not defaulted: inventing a name for a
  // document that has none buries the fact that it was malformed under
  // a model called something plausible.
  if (typeof envelope.name !== 'string' || !envelope.name) {
    throw new DomainError('That model has no name.');
  }
  const customTypes = schemaArrayToDefinitions('custom-type-definition', envelope.customTypeDefinitions);
  const events = schemaArrayToDefinitions('event-definition', envelope.eventDefinitions);
  const entities = schemaArrayToDefinitions('entity-definition', envelope.entityDefinitions);
  const projections = schemaArrayToDefinitions('projection-definition', envelope.projectionDefinitions);
  const commands = schemaArrayToDefinitions('command-definition', envelope.commandDefinitions);
  const scenarios = schemaArrayToDefinitions('scenario-definition', envelope.scenarioDefinitions);
  const propertyScenarios = schemaArrayToDefinitions(
    'projection-scenario-definition', envelope.projectionScenarioDefinitions
  );

  const modelId = createDcbModel(envelope.name);

  // Created automatically by `addDefinition('entity-definition', ...)`
  // — never added again here as a standalone value type, only enriched
  // once its exported body is known to carry more than the bare default.
  const derivedIdTypeNames = new Set(
    Object.entries(entities).map(([name, body]) => body.identifierType || (name + 'Id'))
  );

  addManyWithRetry(modelId, [
    ...Object.entries(customTypes)
      .filter(([name]) => !derivedIdTypeNames.has(name))
      .map(([name, body]) => ({ kind: 'custom-type-definition', name, body })),
    ...Object.entries(entities)
      .map(([name, body]) => ({ kind: 'entity-definition', name, body: bareEntityBody(body) })),
  ]);

  for (const [name, body] of Object.entries(events)) {
    addDefinition('event-definition', modelId, name, body);
  }
  for (const [name, body] of Object.entries(customTypes)) {
    if (derivedIdTypeNames.has(name)) updateDefinition('custom-type-definition', modelId, name, body);
  }
  // Projections before the full entities: a property binding names a
  // projection, so every projection has to exist before the bindings do.
  for (const [name, body] of Object.entries(projections)) {
    addDefinition('projection-definition', modelId, name, body);
  }
  for (const [name, body] of Object.entries(entities)) {
    updateDefinition('entity-definition', modelId, name, body);
  }
  for (const [name, body] of Object.entries(commands)) {
    addDefinition('command-definition', modelId, name, body);
  }
  // Scenario ids come across as they were exported rather than being
  // reissued here, so that a model survives a round trip unchanged and
  // a re-import can be diffed against what was sent. `generateId` is the
  // fallback for a hand-written file that reached this point without one.
  for (const [id, body] of Object.entries(scenarios)) {
    addDefinition('scenario-definition', modelId, id || generateId(), body);
  }
  for (const [id, body] of Object.entries(propertyScenarios)) {
    addDefinition('projection-scenario-definition', modelId, id || generateId(), body);
  }
  return modelId;
}

// ============================================================
// Predefined models.
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

// A lifecycle enum is an ordinary scalar custom type whose schema
// carries `enum`, declared once and referenced from an ordinary
// `status` property — the same shape any other enum property has.
const seedEnumType = (name, members) => ({ schema: { type: 'string', enum: members } });
const seedProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: false });
const seedListProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: true });
const seedHandler = (event, operation, value) => ({ event, operation, value });
const seedParam = (name) => ({ parameterName: name });
// `{alias}` with no property reads a bound projection's single value.
const seedOf = (alias, property) => (property === undefined ? { alias } : { alias, property });
const seedBind = (alias, entity, idParam) => ({ alias, entity, id: seedParam(idParam) });
const seedReadProjection = (alias, projection, args = {}) =>
  ({ alias, projection, arguments: args });
// The projection behind one entity property: partitioned by exactly
// the owning entity's identifier, which is what makes it bindable.
const seedPropertyProjection = (entityName, valueType, initialValue, handlers, extra = {}) => ({
  parameters: [{ name: defaultAlias(entityName) + 'Id', propertyType: entityName + 'Id' }],
  valueType, isList: false, initialValue, handlers, ...extra,
});
// The binding itself — everything else lives on the projection.
const seedBindProp = (name, projection) => ({ name, projection });

// A scenario a seed ships with. The id is written out rather than
// generated so that regenerating an example produces the same file —
// a fresh id on every run would make every regeneration a diff.
function seedProjectionScenario(modelId, id, body) {
  addDefinition('projection-scenario-definition', modelId, id, body);
}

// Reads a definition back and writes the modified copy, so a later
// layer never has to restate the shape an earlier one produced.
function seedPatch(kind, modelId, name, mutate) {
  const body = deepClone(getCtxOrThrow(modelId)[DEF_COLLECTIONS[kind]][name]);
  mutate(body);
  updateDefinition(kind, modelId, name, body);
}

function seedBase(modelId) {
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const of = seedOf;
  const bind = seedBind;
  const bindProp = seedBindProp;

  // 1. The lifecycle enums, declared like any other custom type. Then
  //    the entities, bare: a property is a binding to a projection, and
  //    no projection exists yet. Student first, since Course's
  //    subscriber list is typed StudentId.
  addDefinition('custom-type-definition', modelId, 'StudentStatus', seedEnumType('StudentStatus', ['NonExistent', 'Existent']));
  addDefinition('custom-type-definition', modelId, 'CourseStatus', seedEnumType('CourseStatus', ['NonExistent', 'Existent', 'Archived']));

  addDefinition('entity-definition', modelId, 'Student', { icon: '🧑‍🎓', properties: [] });
  addDefinition('entity-definition', modelId, 'Course', { icon: '📚', properties: [] });

  // 2. Events. Their entity-id properties are what carry the tags.
  const event = (name, properties) =>
    addDefinition('event-definition', modelId, name, { properties });

  event('CourseDefined', [prop('courseId', 'CourseId'), prop('capacity', 'integer')]);
  event('CourseCapacityChanged', [prop('courseId', 'CourseId'), prop('newCapacity', 'integer')]);
  event('CourseArchived', [prop('courseId', 'CourseId')]);
  event('StudentRegistered', [prop('studentId', 'StudentId')]);
  event('StudentSubscribedToCourse', [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')]);
  event('StudentUnsubscribedFromCourse', [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')]);

  // 3. The projections themselves — ordinary definitions, each
  //    partitioned by the identifier of the entity whose property will
  //    bind it. Nothing about them says "entity property": that is
  //    entirely the binding's doing.
  const projection = (name, body) =>
    addDefinition('projection-definition', modelId, name, body);

  projection('StudentStatus', seedPropertyProjection('Student', 'StudentStatus',
    { enumMember: 'NonExistent' },
    [handler('StudentRegistered', 'set', { enumMember: 'Existent' })]));
  projection('StudentSubscriptionCount', seedPropertyProjection('Student', 'integer', 0, [
    handler('StudentSubscribedToCourse', 'increment', 1),
    handler('StudentUnsubscribedFromCourse', 'decrement', 1),
  ]));

  projection('CourseStatus', seedPropertyProjection('Course', 'CourseStatus',
    { enumMember: 'NonExistent' }, [
      handler('CourseDefined', 'set', { enumMember: 'Existent' }),
      handler('CourseArchived', 'set', { enumMember: 'Archived' }),
    ]));
  projection('CourseCapacity', seedPropertyProjection('Course', 'integer', 0, [
    handler('CourseDefined', 'set', { eventProperty: 'capacity' }),
    handler('CourseCapacityChanged', 'set', { eventProperty: 'newCapacity' }),
  ]));
  projection('CourseSubscriptionCount', seedPropertyProjection('Course', 'integer', 0, [
    handler('StudentSubscribedToCourse', 'increment', 1),
    handler('StudentUnsubscribedFromCourse', 'decrement', 1),
  ]));
  projection('CourseSubscribedStudentIds', seedPropertyProjection('Course', 'StudentId', [], [
    handler('StudentSubscribedToCourse', 'append', { eventProperty: 'studentId' }),
    handler('StudentUnsubscribedFromCourse', 'remove', { eventProperty: 'studentId' }),
  ], { isList: true }));

  // 4. The entities again, now binding them. A binding names the
  //    projection and nothing else — there is no second place where a
  //    type or an initial value could disagree with the first.
  seedPatch('entity-definition', modelId, 'Student', (student) => {
    student.properties = [
      bindProp(STATUS_PROPERTY, 'StudentStatus'),
      bindProp('subscriptionCount', 'StudentSubscriptionCount'),
    ];
  });
  seedPatch('entity-definition', modelId, 'Course', (course) => {
    course.properties = [
      bindProp(STATUS_PROPERTY, 'CourseStatus'),
      bindProp('capacity', 'CourseCapacity'),
      bindProp('subscriptionCount', 'CourseSubscriptionCount'),
      bindProp('subscribedStudentIds', 'CourseSubscribedStudentIds'),
    ];
  });

  // 5. Commands. The boundary is the DCB.
  const command = (name, body) => addDefinition('command-definition', modelId, name, body);

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
function seedAddSequence(modelId) {
  seedPatch('custom-type-definition', modelId, 'CourseId', (courseId) => {
    courseId.schema = { type: 'string', pattern: '^c[0-9]+$' };
  });

  addDefinition('projection-definition', modelId, 'CourseNumbering', {
    parameters: [],
    valueType: 'CourseId',
    isList: false,
    initialValue: 'c1',
    handlers: [
      seedHandler('CourseDefined', 'set', { successor: { eventProperty: 'courseId' } }),
    ],
  });

  updateDefinition('command-definition', modelId, 'DefineCourse', {
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

// Two scenarios over the numbering itself — the thing no entity owns
// and no command page shows in isolation. A numbering is exactly the
// case worth asserting directly: its whole contract is "the next value
// to issue", at every point in its life, and that is a claim about the
// fold rather than about any decision made from it.
//
// A layer of its own rather than part of `seedAddSequence`, because a
// Given is written against the events as they are *now*: the tenancy
// and schedule layers both add properties to `CourseDefined`, and a
// scenario written before them is broken by them. That is the
// mechanism reporting honestly, and the models that go on to grow the
// event should not ship already saying so.
//
// The Then is stated here rather than derived, because a seed runs
// against `model.js` alone and the evaluator is not loaded. A test
// (`ui.test.js`) runs every shipped scenario to keep that honest.
function seedSequenceScenarios(modelId) {
  seedProjectionScenario(modelId, 'a29c2e1f-6b04-4f5a-9d13-5f0a2d7c8e41', {
    name: 'issues c1 before anything has happened',
    projection: 'CourseNumbering',
    arguments: {},
    given: [],
    then: 'c1',
  });
  seedProjectionScenario(modelId, 'f47b9c30-2a8d-4e16-b5c7-9e3a1d604f28', {
    name: 'issues c3 once two courses exist',
    projection: 'CourseNumbering',
    arguments: {},
    given: [
      { event: 'CourseDefined', data: { courseId: 'c1', capacity: 10 } },
      { event: 'CourseDefined', data: { courseId: 'c2', capacity: 10 } },
    ],
    then: 'c3',
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
function seedAddTenancy(modelId) {
  addDefinition('custom-type-definition', modelId, 'TenantStatus', seedEnumType('TenantStatus', ['NonExistent', 'Existent']));
  addDefinition('entity-definition', modelId, 'Tenant', { icon: '🏢', properties: [] });
  addDefinition('custom-type-definition', modelId, 'CourseNumber', {
    schema: { type: 'string', pattern: '^[0-9]+$' },
  });

  addDefinition('event-definition', modelId, 'TenantRegistered', {
    properties: [seedProp('tenantId', 'TenantId')],
  });
  seedPatch('event-definition', modelId, 'CourseDefined', (event) => {
    event.properties.unshift(seedProp('tenantId', 'TenantId'));
    event.properties.push(seedProp('courseNumber', 'CourseNumber'));
  });

  addDefinition('projection-definition', modelId, 'TenantStatus',
    seedPropertyProjection('Tenant', 'TenantStatus', { enumMember: 'NonExistent' },
      [seedHandler('TenantRegistered', 'set', { enumMember: 'Existent' })]));
  seedPatch('entity-definition', modelId, 'Tenant', (tenant) => {
    tenant.properties = [seedBindProp(STATUS_PROPERTY, 'TenantStatus')];
  });

  // One parameter, so one tag: `Tenant:<id> AND type CourseDefined`.
  // Drop the parameter and this is the global numbering again — that
  // is the whole difference between the two, which is why there is one
  // kind here and not two.
  addDefinition('projection-definition', modelId, 'TenantCourseNumbering', {
    parameters: [{ name: 'tenantId', propertyType: 'TenantId' }],
    valueType: 'CourseNumber',
    isList: false,
    initialValue: '1',
    handlers: [
      seedHandler('CourseDefined', 'set', { successor: { eventProperty: 'courseNumber' } }),
    ],
  });

  addDefinition('command-definition', modelId, 'RegisterTenant', {
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
  seedPatch('command-definition', modelId, 'DefineCourse', (define) => {
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
function seedAddSchedules(modelId) {
  addDefinition('custom-type-definition', modelId, 'TimeSlot', {
    schema: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$' },
  });

  seedPatch('event-definition', modelId, 'CourseDefined', (event) => {
    event.properties.push(seedListProp('slots', 'TimeSlot'));
  });
  addDefinition('event-definition', modelId, 'CourseRescheduled', {
    properties: [seedProp('courseId', 'CourseId'), seedListProp('slots', 'TimeSlot')],
  });

  addDefinition('projection-definition', modelId, 'CourseSlots',
    seedPropertyProjection('Course', 'TimeSlot', [], [
      seedHandler('CourseDefined', 'set', { eventProperty: 'slots' }),
      seedHandler('CourseRescheduled', 'set', { eventProperty: 'slots' }),
    ], { isList: true }));
  // Names the courses whose *current* schedules the overlap check
  // reads. Nothing about time is stored here.
  addDefinition('projection-definition', modelId, 'StudentSubscribedCourseIds',
    seedPropertyProjection('Student', 'CourseId', [], [
      seedHandler('StudentSubscribedToCourse', 'append', { eventProperty: 'courseId' }),
      seedHandler('StudentUnsubscribedFromCourse', 'remove', { eventProperty: 'courseId' }),
    ], { isList: true }));

  seedPatch('entity-definition', modelId, 'Course', (course) => {
    course.properties.push(seedBindProp('slots', 'CourseSlots'));
  });
  seedPatch('entity-definition', modelId, 'Student', (student) => {
    student.properties.push(seedBindProp('subscribedCourseIds', 'StudentSubscribedCourseIds'));
  });

  seedPatch('command-definition', modelId, 'DefineCourse', (define) => {
    define.properties.push(seedListProp('slots', 'TimeSlot'));
    define.publishes[0].parameters.slots = seedParam('slots');
  });

  // Rescheduling is allowed while students are subscribed, so it has to
  // prove that nobody it moves ends up double-booked: bind the
  // subscribers, then every *other* course any of them is in, and
  // require none of those schedules to touch the new slots. `theirs`
  // would otherwise include this very course — every subscriber is in
  // it — and a course almost always overlaps its own old schedule.
  addDefinition('command-definition', modelId, 'RescheduleCourse', {
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
  seedPatch('command-definition', modelId, 'SubscribeStudentToCourse', (subscribe) => {
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
function seedProductPricing(modelId) {
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const of = seedOf;

  // 1. Value types. Money is scalar; Item is composite, and its
  //    productId field is what turns a list of them into tags. The
  //    lifecycle enums are scalar too — just with `enum` instead of a
  //    numeric schema.
  addDefinition('custom-type-definition', modelId, 'Money', {
    schema: { type: 'number', minimum: 0 },
  });
  addDefinition('custom-type-definition', modelId, 'ProductStatus', seedEnumType('ProductStatus', ['NonExistent', 'Existent']));
  addDefinition('custom-type-definition', modelId, 'OrderStatus', seedEnumType('OrderStatus', ['NonExistent', 'Existent']));

  // 2. Entities, bare — Item cannot be declared until ProductId
  //    exists, and ProductId comes from Product.
  addDefinition('entity-definition', modelId, 'Product', { icon: '📦', properties: [] });
  addDefinition('entity-definition', modelId, 'Order', { icon: '🧾', properties: [] });

  addDefinition('custom-type-definition', modelId, 'Item', {
    properties: [
      { name: 'productId', propertyType: 'ProductId' },
      { name: 'price', propertyType: 'Money' },
    ],
  });

  // 3. Events.
  const event = (name, properties) =>
    addDefinition('event-definition', modelId, name, { properties });

  event('ProductDefined', [prop('productId', 'ProductId'), prop('price', 'Money')]);
  event('ProductPriceChanged', [prop('productId', 'ProductId'), prop('newPrice', 'Money')]);
  // One event, many tags: Order:<orderId> plus one Product per item.
  event('ProductsOrdered', [prop('orderId', 'OrderId'), seedListProp('items', 'Item')]);

  // 4. The projections, then the bindings. Neither product projection
  //    handles ProductsOrdered: a value-style handler would need to
  //    pick *this* product's line out of the event, which the model
  //    cannot yet express.
  addDefinition('projection-definition', modelId, 'ProductStatus',
    seedPropertyProjection('Product', 'ProductStatus', { enumMember: 'NonExistent' },
      [handler('ProductDefined', 'set', { enumMember: 'Existent' })]));
  // Starts at null — no value yet. A price of 0 on a product that does
  // not exist would be a lie the model then has to defend, and null is
  // a different answer from both 0 and "".
  addDefinition('projection-definition', modelId, 'ProductCurrentPrice',
    seedPropertyProjection('Product', 'Money', null, [
      handler('ProductDefined', 'set', { eventProperty: 'price' }),
      handler('ProductPriceChanged', 'set', { eventProperty: 'newPrice' }),
    ]));
  addDefinition('projection-definition', modelId, 'OrderStatus',
    seedPropertyProjection('Order', 'OrderStatus', { enumMember: 'NonExistent' },
      [handler('ProductsOrdered', 'set', { enumMember: 'Existent' })]));

  seedPatch('entity-definition', modelId, 'Product', (product) => {
    product.properties = [
      seedBindProp(STATUS_PROPERTY, 'ProductStatus'),
      seedBindProp('currentPrice', 'ProductCurrentPrice'),
    ];
  });
  seedPatch('entity-definition', modelId, 'Order', (order) => {
    order.properties = [seedBindProp(STATUS_PROPERTY, 'OrderStatus')];
  });

  // 5. Commands defining and repricing a single product, so the
  //    example can be exercised before anything is ordered.
  addDefinition('command-definition', modelId, 'DefineProduct', {
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
  addDefinition('command-definition', modelId, 'ChangeProductPrice', {
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
  addDefinition('command-definition', modelId, 'OrderProducts', {
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

const PREDEFINED_MODELS = [
  {
    name: 'Course Example (simple)',
    slug: 'course-simple',
    description: 'Courses and students, capacity and subscriptions. '
      + 'Identifiers are supplied by the caller and checked with a state condition.',
    build: (modelId) => { seedBase(modelId); },
  },
  {
    name: 'Course Example (with sequence)',
    slug: 'course-sequence',
    description: 'Adds a projection issuing c1, c2, c3… DefineCourse loses its identifier '
      + 'parameter and its conditions — binding the numbering guards it instead.',
    build: (modelId) => { seedBase(modelId); seedAddSequence(modelId); seedSequenceScenarios(modelId); },
  },
  {
    name: 'Course Example (with sequence and tenant)',
    slug: 'course-tenant',
    description: 'The numbering restarts per tenant — the case a tagless sequence could not '
      + 'express. Identity stays globally minted; what restarts is the number, so no two '
      + 'tenants ever write the same Course tag.',
    build: (modelId) => { seedBase(modelId); seedAddSequence(modelId); seedAddTenancy(modelId); },
  },
  {
    name: 'Course Example (with schedules)',
    slug: 'course-schedules',
    description: 'Adds hourly slots and the rule that a student is never in two courses at '
      + 'once, checked against live schedules so courses can be rescheduled under subscribers.',
    build: (modelId) => { seedBase(modelId); seedAddSequence(modelId); seedAddSchedules(modelId); },
  },
{
    name: 'Dynamic Product Price (simple)',
    slug: 'pricing-simple',
    description: 'A cart ordered in one append. Each line names a product and the price shown '
      + 'to the customer; the boundary fans out over the lines and checks each price against '
      + 'the product it belongs to.',
    build: (modelId) => { seedProductPricing(modelId); },
  },
];

function loadPredefinedModel(index) {
  const entry = PREDEFINED_MODELS[index];
  if (!entry) throw new DomainError('No such predefined model.');
  const modelId = createDcbModel(entry.name);
  entry.build(modelId);
  return modelId;
}
