// ============================================================
// DCB Playground — model layer.
//
// Lifted verbatim from poc/index.html so the interface alternatives in
// this directory share one set of semantics. Nothing here touches the
// DOM: it is the event log, the projection over it, type resolution,
// reference tracking, validation, DCB derivation, the editing commands
// and the predefined contexts.
//
// Loaded as a classic script (not a module) so the alternatives open
// straight from the filesystem without a server.
//
// Two deliberate deviations from the original:
//   - the storage key is the alternatives' own, so clicking around in
//     here cannot disturb the main PoC's contexts;
//   - `resolveOperandType` moved in from the original's operand-editor
//     section. Validation already called it, so it belonged here;
//   - command bodies carry an optional `feature`, naming the group a
//     command belongs to. Nothing in the model reads it — it rides
//     along untouched through validation, references and renames. It
//     is prototype-only: making it real means allowing `feature` on
//     CommandDefinition in dcb-context.schema.yaml, which currently
//     sets additionalProperties: false.
// ============================================================

// ============================================================
// Constants.
// ============================================================
const EVENT_LOG_KEY = 'dcb-playground:alternatives:v1';

const DEF_KINDS = [
  'entity-definition',
  'event-definition',
  'sequence-definition',
  'command-definition',
  'custom-type-definition',
];
const DEF_COLLECTIONS = {
  'entity-definition': 'entity-definitions',
  'event-definition': 'event-definitions',
  'sequence-definition': 'sequence-definitions',
  'command-definition': 'command-definitions',
  'custom-type-definition': 'custom-type-definitions',
};
const KIND_COLOR_CLASS = {
  'entity-definition': 'entity',
  'event-definition': 'event',
  'sequence-definition': 'sequence',
  'command-definition': 'command',
  'custom-type-definition': 'custom-type',
};

const KIND_SECTION_TITLE = {
  'entity-definition': 'Entities',
  'event-definition': 'Events',
  'sequence-definition': 'Sequences',
  'command-definition': 'Commands',
  'custom-type-definition': 'Custom Types',
};

const SIMPLE_TYPES = ['boolean', 'integer', 'string'];
const DEFAULT_STATES = ['NonExistent', 'Existent'];
const STATE_PROPERTY = 'state';

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
// An entity brings `<Entity>Id` and `<Entity>State` into existence.
// Neither is stored anywhere: both are computed from the entity and
// resolved in the same namespace as declared custom (value) types.
// ============================================================

function idTypeOf(entityName) { return entityName + 'Id'; }
function stateTypeOf(entityName) { return entityName + 'State'; }

function derivedTypes(ctx) {
  const out = {};
  for (const entityName of Object.keys(ctx['entity-definitions'])) {
    out[idTypeOf(entityName)] = { entity: entityName, role: 'id' };
    out[stateTypeOf(entityName)] = { entity: entityName, role: 'state' };
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
  if (ctx['custom-type-definitions'][typeName] !== undefined) return { kind: 'custom' };
  return { kind: 'unresolved' };
}

function allTypeNames(ctx) {
  return [
    ...SIMPLE_TYPES,
    ...Object.keys(derivedTypes(ctx)).sort(),
    ...Object.keys(ctx['custom-type-definitions']).sort(),
  ];
}

// The state members of the enum a property is typed with, or null.
function enumMembersFor(ctx, typeName) {
  const cls = classifyType(ctx, typeName);
  if (cls.kind !== 'derived' || cls.role !== 'state') return null;
  const entity = ctx['entity-definitions'][cls.entity];
  return entity ? (entity.states || []) : [];
}

// A context with one definition overlaid — used so that a body being
// validated can reference the very definition it belongs to (an
// entity's `state` property is typed with its own derived enum).
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
      // Outbound refs not modeled (the schema is opaque JSON Schema).
      break;
    case 'event-definition':
      for (const p of body.properties || []) pushTypeRef(ctx, refs, p.propertyType);
      break;
    case 'entity-definition':
      for (const p of body.properties || []) {
        pushTypeRef(ctx, refs, p.propertyType);
        for (const handler of p.handlers || []) {
          if (handler && handler.event) refs['event-definition'].push(handler.event);
        }
      }
      break;
    case 'sequence-definition':
      pushTypeRef(ctx, refs, body.valueType);
      for (const advance of body.advancedBy || []) {
        if (advance && advance.event) refs['event-definition'].push(advance.event);
      }
      break;
    case 'command-definition':
      for (const p of body.properties || []) pushTypeRef(ctx, refs, p.propertyType);
      for (const binding of body.boundary || []) {
        if (binding && binding.entity) refs['entity-definition'].push(binding.entity);
      }
      for (const emission of body.publishes || []) {
        if (emission && emission.name) refs['event-definition'].push(emission.name);
      }
      forEachCommandOperand(body, (operand) => {
        if (operandSource(operand) === 'sequence' && operand.sequence) {
          refs['sequence-definition'].push(operand.sequence);
        }
      });
      break;
  }

  for (const k of DEF_KINDS) refs[k] = uniq(refs[k]);
  return refs;
}

// Rewrites every reference to `oldName` of `targetKind` into `newName`.
// Renaming an entity also rewrites its two derived type names.
function rewriteReferences(kind, body, targetKind, oldName, newName) {
  const next = deepClone(body);

  const rewriteType = (typeName) => {
    if (targetKind === 'custom-type-definition') {
      return typeName === oldName ? newName : typeName;
    }
    if (targetKind === 'entity-definition') {
      if (typeName === idTypeOf(oldName)) return idTypeOf(newName);
      if (typeName === stateTypeOf(oldName)) return stateTypeOf(newName);
    }
    return typeName;
  };

  const rewriteProperties = (properties) => {
    for (const p of properties || []) p.propertyType = rewriteType(p.propertyType);
  };

  switch (kind) {
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
    case 'sequence-definition':
      next.valueType = rewriteType(next.valueType);
      if (targetKind === 'event-definition') {
        for (const advance of next.advancedBy || []) {
          if (advance && advance.event === oldName) advance.event = newName;
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
      if (targetKind === 'sequence-definition') {
        forEachCommandOperand(next, (operand) => {
          if (operandSource(operand) === 'sequence' && operand.sequence === oldName) {
            operand.sequence = newName;
          }
        });
      }
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
// Command operands:  {parameterName} | {alias, property} | {enumMember} | literal
// Handler operands:  {eventProperty} | {currentValue} | {enumMember} | literal
// ============================================================

function operandSource(operand) {
  if (operand === null || operand === undefined) return 'static';
  if (typeof operand !== 'object') return 'static';
  if (operand.parameterName !== undefined) return 'parameter';
  if (operand.alias !== undefined) return 'alias-property';
  if (operand.enumMember !== undefined) return 'enum-member';
  if (operand.eventProperty !== undefined) return 'event-property';
  if (operand.currentValue !== undefined) return 'current-value';
  if (operand.sequence !== undefined) return 'sequence';
  return 'static';
}

function operandText(operand) {
  switch (operandSource(operand)) {
    case 'parameter': return operand.parameterName || '?';
    case 'alias-property': return `${operand.alias || '?'}.${operand.property || '?'}`;
    case 'enum-member': return operand.enumMember || '?';
    case 'event-property': return `event.${operand.eventProperty || '?'}`;
    case 'current-value': return 'current';
    case 'sequence': return `next(${operand.sequence || '?'})`;
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

function handlerText(handler) {
  if (!handler) return '';
  return `${handler.event || '?'} → ${handler.operation || '?'} ${operandText(handler.value)}`;
}

// The operations that make sense for a property's type.
function operationsFor(ctx, property) {
  if (property.isList) return ['set', 'append', 'remove'];
  if (property.propertyType === 'integer') return ['set', 'increment', 'decrement'];
  return ['set'];
}

// Walks every operand inside a command body.
function forEachCommandOperand(body, visit) {
  for (const binding of body.boundary || []) {
    if (!binding) continue;
    visit(binding.id, { where: `boundary binding "${binding.alias || '?'}"` });
    if (binding.excluding !== undefined) {
      visit(binding.excluding, { where: `boundary binding "${binding.alias || '?'}" (excluding)` });
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
// A command's boundary *is* its dynamic consistency boundary. Each
// bound instance contributes one query item: its tag, restricted to
// the event types reachable through the properties the conditions
// actually read.
//
// Sequences contribute too, and are the only items with no tag: a
// numbering is global, so its query is scoped by event type alone.
// ============================================================


// The type an operand resolves to, or null when it cannot be worked out
// (a literal, or a reference that does not resolve).
function resolveOperandType(operand, { boundary, commandProperties, ctx }) {
  const source = operandSource(operand);
  if (source === 'alias-property') {
    const binding = (boundary || []).find((b) => b.alias === operand.alias);
    if (!binding) return null;
    const entity = ctx['entity-definitions'][binding.entity];
    if (!entity) return null;
    const property = (entity.properties || []).find((p) => p.name === operand.property);
    return property ? { propertyType: property.propertyType, isList: !!property.isList } : null;
  }
  if (source === 'parameter') {
    const property = (commandProperties || []).find((p) => p.name === operand.parameterName);
    return property ? { propertyType: property.propertyType, isList: !!property.isList } : null;
  }
  if (source === 'sequence') {
    const sequence = ctx['sequence-definitions'][operand.sequence];
    return sequence ? { propertyType: sequence.valueType, isList: false } : null;
  }
  return null;
}

// A binding whose identifier operand is a list covers one instance per
// element — nothing declares it, it follows from the operand's type. A
// list read off an already-fanned-out alias is a list of lists, which
// flattens; either way the binding is plural.
function isFannedOut(ctx, body, binding) {
  if (!binding) return false;
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

// Every sequence the command reads, in first-mention order.
function sequencesRead(body) {
  const names = [];
  forEachCommandOperand(body, (operand) => {
    if (operandSource(operand) === 'sequence' && !names.includes(operand.sequence)) {
      names.push(operand.sequence);
    }
  });
  return names;
}

function deriveDcb(ctx, body) {
  const items = [];

  for (const name of sequencesRead(body)) {
    const sequence = ctx['sequence-definitions'][name];
    if (!sequence) continue;
    items.push({
      sequence: name,
      tag: null,
      types: uniq((sequence.advancedBy || []).map((a) => a && a.event).filter(Boolean)).sort(),
      readProperties: [],
    });
  }

  for (const binding of body.boundary || []) {
    if (!binding) continue;
    const readProperties = new Set();
    forEachCommandOperand(body, (operand) => {
      if (operandSource(operand) === 'alias-property' && operand.alias === binding.alias) {
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
      tag: fannedOut
        ? `${binding.entity}:each(${operandText(binding.id)}${
            binding.excluding !== undefined ? ` except ${operandText(binding.excluding)}` : ''})`
        : `${binding.entity}:${operandText(binding.id)}`,
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
      const cls = classifyType(ctx, property.propertyType);
      if (cls.kind !== 'derived' || cls.role !== 'id') continue;
      const operand = (emission.parameters || {})[property.name];
      writes.push(`${cls.entity}:${operand === undefined ? '?' : operandText(operand)}`);
    }
  }

  return { items, writes: uniq(writes) };
}

// Every entity-id property of every published event must resolve to a
// binding in the boundary — a command may not write a tag it did not
// consult. A value drawn from a sequence is exempt: the sequence's own
// query already covers every event that could have issued it, and a
// freshly minted identifier has no history to consult.
function coverageIssues(ctx, body) {
  const issues = [];
  for (const emission of body.publishes || []) {
    if (!emission) continue;
    const event = ctx['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const cls = classifyType(ctx, property.propertyType);
      if (cls.kind !== 'derived' || cls.role !== 'id') continue;
      const operand = (emission.parameters || {})[property.name];
      if (operandSource(operand) === 'sequence') continue;
      const covered = (body.boundary || []).some(
        (binding) => binding && binding.entity === cls.entity && sameOperand(binding.id, operand)
      );
      if (!covered) {
        issues.push({ event: emission.name, property: property.name, entity: cls.entity, operand });
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
  for (const derived of [idTypeOf(entityName), stateTypeOf(entityName)]) {
    if (ctx['custom-type-definitions'][derived] !== undefined) {
      throw new DomainError(
        `Entity "${entityName}" would derive the type "${derived}", but a custom type by that name already exists.`
      );
    }
    for (const other of Object.keys(ctx['entity-definitions'])) {
      if (other === exceptEntity) continue;
      if (idTypeOf(other) === derived || stateTypeOf(other) === derived) {
        throw new DomainError(
          `Entity "${entityName}" would derive the type "${derived}", which entity "${other}" already derives.`
        );
      }
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

  if (kind === 'entity-definition') validateEntityBody(resolved, name, body);
  if (kind === 'sequence-definition') validateSequenceBody(resolved, name, body);
  if (kind === 'command-definition') validateCommandBody(resolved, body);
}

function validateSequenceBody(ctx, sequenceName, body) {
  if (classifyType(ctx, body.valueType).kind === 'unresolved') {
    throw new DomainError(`Type "${body.valueType}" (sequence "${sequenceName}") does not resolve in this context.`);
  }
  if (body.initialValue === undefined || body.initialValue === null || body.initialValue === '') {
    throw new DomainError(`Sequence "${sequenceName}" needs an initial value — it is where the prefix is stated.`);
  }
  const advancedBy = body.advancedBy || [];
  if (advancedBy.length === 0) {
    throw new DomainError(`Sequence "${sequenceName}" must be advanced by at least one event.`);
  }
  const seen = new Set();
  for (const advance of advancedBy) {
    if (!advance || !advance.event) {
      throw new DomainError(`An "advanced by" entry on sequence "${sequenceName}" has no event.`);
    }
    if (seen.has(advance.event)) {
      throw new DomainError(`Sequence "${sequenceName}" names "${advance.event}" twice.`);
    }
    seen.add(advance.event);
    const event = ctx['event-definitions'][advance.event];
    const property = event && (event.properties || []).find((p) => p.name === advance.property);
    if (!property) {
      throw new DomainError(
        `Sequence "${sequenceName}" reads "${advance.property}", which "${advance.event}" does not carry.`
      );
    }
    // The event has to carry the value the sequence issued, or the next
    // read cannot find where the numbering got to.
    if (property.propertyType !== body.valueType) {
      throw new DomainError(
        `Sequence "${sequenceName}" issues ${body.valueType}, but "${advance.event}.${advance.property}" ` +
        `is typed ${property.propertyType}.`
      );
    }
    if (property.isList || property.isOptional) {
      throw new DomainError(
        `"${advance.event}.${advance.property}" must be a single required value to advance a sequence.`
      );
    }
  }
}

function validateEntityBody(ctx, entityName, body) {
  const states = body.states || [];
  if (states.length < 2) throw new DomainError('An entity must declare at least two states.');
  if (uniq(states).length !== states.length) throw new DomainError('State members must be unique.');
  for (const member of states) validateName(member, 'State member');

  const properties = body.properties || [];
  const stateProperties = properties.filter((p) => p.name === STATE_PROPERTY);
  if (stateProperties.length !== 1) {
    throw new DomainError('An entity must have exactly one reserved "state" property.');
  }
  const stateProperty = stateProperties[0];
  if (stateProperty.propertyType !== stateTypeOf(entityName)) {
    throw new DomainError(`The reserved "state" property must be typed "${stateTypeOf(entityName)}".`);
  }
  if (stateProperty.isOptional || stateProperty.isList) {
    throw new DomainError('The reserved "state" property may be neither optional nor a list.');
  }
  if (operandSource(stateProperty.initialValue) !== 'enum-member'
      || stateProperty.initialValue.enumMember !== states[0]) {
    throw new DomainError(`The reserved "state" property must start in "${states[0]}", the first declared state.`);
  }

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

    const allowedOperations = operationsFor(ctx, property);
    const members = enumMembersFor(ctx, property.propertyType);
    const handledEvents = new Set();

    if (members && operandSource(property.initialValue) === 'enum-member'
        && !members.includes(property.initialValue.enumMember)) {
      throw new DomainError(
        `Property "${property.name}" starts in "${property.initialValue.enumMember}", which is not a member of ${property.propertyType}.`
      );
    }

    for (const handler of property.handlers || []) {
      if (!handler || !handler.event) {
        throw new DomainError(`A handler on property "${property.name}" has no event.`);
      }
      if (handledEvents.has(handler.event)) {
        throw new DomainError(`Property "${property.name}" handles "${handler.event}" twice.`);
      }
      handledEvents.add(handler.event);
      if (!allowedOperations.includes(handler.operation)) {
        throw new DomainError(
          `Operation "${handler.operation}" is not available for property "${property.name}" ` +
          `(allowed: ${allowedOperations.join(', ')}).`
        );
      }
      const event = ctx['event-definitions'][handler.event];
      assertRecognisedOperand(handler.value, `The handler for "${handler.event}" on "${property.name}"`);
      if (operandSource(handler.value) === 'event-property') {
        const known = (event.properties || []).some((p) => p.name === handler.value.eventProperty);
        if (!known) {
          throw new DomainError(
            `Handler on "${property.name}" reads "${handler.value.eventProperty}", which "${handler.event}" does not carry.`
          );
        }
      }
      if (members && operandSource(handler.value) === 'enum-member'
          && !members.includes(handler.value.enumMember)) {
        throw new DomainError(
          `Handler on "${property.name}" sets "${handler.value.enumMember}", which is not a member of ${property.propertyType}.`
        );
      }
    }
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

  for (const condition of body.conditions || []) {
    if (!condition || condition.predicate !== 'containsAny') continue;
    const args = { boundary, commandProperties: body.properties || [], ctx };
    const left = resolveOperandType(condition.leftHandSide, args);
    const right = resolveOperandType(condition.rightHandSide, args);
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

  const commandProperties = new Set((body.properties || []).map((p) => p.name));
  let failure = null;
  forEachCommandOperand(body, (operand, meta) => {
    if (failure) return;
    assertRecognisedOperand(operand, meta.where);
    const source = operandSource(operand);
    if (source === 'parameter' && !commandProperties.has(operand.parameterName)) {
      failure = `${meta.where} reads parameter "${operand.parameterName}", which the command does not declare.`;
    }
    if (source === 'sequence' && !ctx['sequence-definitions'][operand.sequence]) {
      failure = `${meta.where} draws from sequence "${operand.sequence}", which this context does not define.`;
    }
    if (source === 'alias-property') {
      const binding = boundary.find((b) => b.alias === operand.alias);
      if (!binding) {
        failure = `${meta.where} reads "${operandText(operand)}", but "${operand.alias}" is not bound in the boundary.`;
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

  // Enum members are checked against the alias property they sit
  // opposite, which is where a state comparison always appears.
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
    throw new DomainError(
      `Write coverage: "${first.event}.${first.property}" writes the tag ` +
      `${first.entity}:${operandText(first.operand)}, which the boundary does not consult. ` +
      `Bind that instance in the boundary first.`
    );
  }
}

function addDefinition(kind, ctxId, name, body) {
  const ctx = getCtxOrThrow(ctxId);
  const trimmed = validateName(name, `${humanize(kind)} name`);
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
  appendEvents([{ type: `${kind}-updated`, data: { 'dcb-context-id': ctxId, name, body } }]);
}

// Dropping a property or a state member that a command still reads is
// refused rather than silently breaking the command.
function assertEntityUpdateKeepsInboundReferences(ctx, entityName, body) {
  const propertyNames = new Set((body.properties || []).map((p) => p.name));
  const states = new Set(body.states || []);
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

    for (const condition of command.conditions || []) {
      if (!condition) continue;
      for (const side of [condition.leftHandSide, condition.rightHandSide]) {
        if (operandSource(side) !== 'enum-member') continue;
        const other = side === condition.leftHandSide ? condition.rightHandSide : condition.leftHandSide;
        if (operandSource(other) !== 'alias-property' || !aliases.includes(other.alias)) continue;
        if (!states.has(side.enumMember)) {
          throw new DomainError(
            `Cannot drop state "${side.enumMember}" from "${entityName}" — command "${commandName}" still compares against it.`
          );
        }
      }
    }
  }
}

function renameDefinition(kind, ctxId, previousName, newName) {
  const ctx = getCtxOrThrow(ctxId);
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
    // An entity references itself: its reserved `state` property is
    // typed with its own derived enum. That rewrite lands on the new
    // name, since the rename event is applied first.
    const isSelf = ref.kind === kind && ref.name === previousName;
    const rewritten = rewriteReferences(ref.kind, ref.body, kind, previousName, trimmed);
    events.push({
      type: `${ref.kind}-updated`,
      data: { 'dcb-context-id': ctxId, name: isSelf ? trimmed : ref.name, body: rewritten },
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
    .filter((r) => !(r.kind === kind && r.name === name));
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
  if (property.propertyType === 'integer') return 0;
  if (property.propertyType === 'boolean') return false;
  return '';
}

// Every state member declared by any entity, for pickers that compare
// against one.
function allStateMembers(ctx) {
  const out = [];
  for (const entity of Object.values(ctx['entity-definitions'])) {
    for (const member of entity.states || []) out.push(member);
  }
  return uniq(out).sort();
}

function humanize(kind) {
  return kind.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
}

function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

// ============================================================
// Predefined contexts.
//
// One course-subscription model in three layers, because that is the
// order the design was arrived at: the plain model, then generated
// identifiers, then schedules. Each layer is applied through the
// ordinary commands, so loading one exercises exactly the same
// validation an author would hit typing it in.
//
// Every layer keeps references resolvable at each step — entities
// first without handlers (nothing to reference yet), then the events,
// then the entities again with their handlers, then the commands.
// ============================================================

const seedProperty = (name, type, initialValue, extra = {}) => ({
  name, propertyType: type, isOptional: false, isList: false,
  initialValue, handlers: [], ...extra,
});
const seedStateProperty = (entity, first) =>
  seedProperty(STATE_PROPERTY, stateTypeOf(entity), { enumMember: first });
const seedProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: false });
const seedListProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: true });
const seedHandler = (event, operation, value) => ({ event, operation, value });
const seedParam = (name) => ({ parameterName: name });
const seedOf = (alias, property) => ({ alias, property });
const seedBind = (alias, entity, idParam) => ({ alias, entity, id: seedParam(idParam) });

// Reads a definition back and writes the modified copy, so a later
// layer never has to restate the shape an earlier one produced.
function seedPatch(kind, ctxId, name, mutate) {
  const body = deepClone(getCtxOrThrow(ctxId)[DEF_COLLECTIONS[kind]][name]);
  mutate(body);
  updateDefinition(kind, ctxId, name, body);
}

function seedBase(ctxId) {
  const property = seedProperty;
  const stateProperty = seedStateProperty;
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const of = seedOf;
  const bind = seedBind;

  // 1. Entities without handlers. Student first, since Course refers
  //    to StudentId.
  addDefinition('entity-definition', ctxId, 'Student', {
    identifierSchema: { type: 'string' },
    states: ['NonExistent', 'Existent'],
    properties: [
      stateProperty('Student', 'NonExistent'),
      property('subscriptionCount', 'integer', 0),
    ],
  });
  addDefinition('entity-definition', ctxId, 'Course', {
    identifierSchema: { type: 'string' },
    states: ['NonExistent', 'Existent', 'Archived'],
    properties: [
      stateProperty('Course', 'NonExistent'),
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
    identifierSchema: { type: 'string' },
    states: ['NonExistent', 'Existent'],
    properties: [
      { ...stateProperty('Student', 'NonExistent'),
        handlers: [handler('StudentRegistered', 'set', { enumMember: 'Existent' })] },
      { ...property('subscriptionCount', 'integer', 0),
        handlers: [
          handler('StudentSubscribedToCourse', 'increment', 1),
          handler('StudentUnsubscribedFromCourse', 'decrement', 1),
        ] },
    ],
  });
  updateDefinition('entity-definition', ctxId, 'Course', {
    identifierSchema: { type: 'string' },
    states: ['NonExistent', 'Existent', 'Archived'],
    properties: [
      { ...stateProperty('Course', 'NonExistent'),
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
      { leftHandSide: of('course', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' } },
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
      { leftHandSide: of('course', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
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
      { leftHandSide: of('course', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
    ],
    publishes: [{ name: 'CourseArchived', parameters: { courseId: param('courseId') } }],
  });

  command('RegisterStudent', {
    feature: 'Student registration',
    properties: [prop('studentId', 'StudentId')],
    boundary: [bind('student', 'Student', 'studentId')],
    conditions: [
      { leftHandSide: of('student', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' } },
    ],
    publishes: [{ name: 'StudentRegistered', parameters: { studentId: param('studentId') } }],
  });

  command('SubscribeStudentToCourse', {
    feature: 'Enrolment',
    properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')],
    boundary: [bind('course', 'Course', 'courseId'), bind('student', 'Student', 'studentId')],
    conditions: [
      { leftHandSide: of('course', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: of('student', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
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
      { leftHandSide: of('course', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
      { leftHandSide: of('course', 'subscribedStudentIds'), predicate: 'contains', rightHandSide: param('studentId') },
    ],
    publishes: [{
      name: 'StudentUnsubscribedFromCourse',
      parameters: { courseId: param('courseId'), studentId: param('studentId') },
    }],
  });
}

// Layer 2: course identifiers stop being supplied and start being
// issued. DefineCourse loses its identifier parameter, its binding and
// its "not already used" check all at once — reading the sequence
// contributes `types CourseDefined` to the append condition, which is
// what makes the numbering monotonic and what makes the check
// redundant.
function seedAddSequence(ctxId) {
  seedPatch('entity-definition', ctxId, 'Course', (course) => {
    course.identifierSchema = { type: 'string', pattern: '^c[0-9]+$' };
  });

  addDefinition('sequence-definition', ctxId, 'CourseNumbering', {
    valueType: 'CourseId',
    initialValue: 'c1',
    advancedBy: [{ event: 'CourseDefined', property: 'courseId' }],
  });

  updateDefinition('command-definition', ctxId, 'DefineCourse', {
    feature: 'Course management',
    properties: [seedProp('capacity', 'integer')],
    boundary: [],
    conditions: [],
    publishes: [{
      name: 'CourseDefined',
      parameters: {
        courseId: { sequence: 'CourseNumbering' },
        capacity: seedParam('capacity'),
      },
    }],
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
      { leftHandSide: seedOf('course', 'state'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } },
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

const PREDEFINED_CONTEXTS = [
  {
    name: 'Course Example (simple)',
    description: 'Courses and students, capacity and subscriptions. '
      + 'Identifiers are supplied by the caller and checked with a state condition.',
    build: (ctxId) => { seedBase(ctxId); },
  },
  {
    name: 'Course Example (with sequence)',
    description: 'Adds a sequence issuing c1, c2, c3… DefineCourse loses its identifier '
      + 'parameter, its binding and its conditions — the sequence guards it instead.',
    build: (ctxId) => { seedBase(ctxId); seedAddSequence(ctxId); },
  },
  {
    name: 'Course Example (with schedules)',
    description: 'Adds hourly slots and the rule that a student is never in two courses at '
      + 'once, checked against live schedules so courses can be rescheduled under subscribers.',
    build: (ctxId) => { seedBase(ctxId); seedAddSequence(ctxId); seedAddSchedules(ctxId); },
  },
];

function loadPredefinedContext(index) {
  const entry = PREDEFINED_CONTEXTS[index];
  if (!entry) throw new DomainError('No such predefined context.');
  const ctxId = createDcbContext(entry.name);
  entry.build(ctxId);
  return ctxId;
}

