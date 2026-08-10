// ============================================================
// Shared by the interface alternatives: DOM helpers, the simple /
// advanced mode, and the *slice* view — everything one feature touches,
// gathered in one place so no alternative has to walk the definition
// graph itself.
//
// The slice is the idea the alternatives are all trying to serve: a
// command, what it reads, what it decides, what it emits, and what
// those events change. The model layer stores none of that as a unit;
// it is derived here, from the definitions.
// ============================================================

// ---------- DOM ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el[k.toLowerCase()] = v;
    else if (k === 'value') el.value = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}

let toastTimer = null;
function toast(message, isError) {
  document.querySelectorAll('#toast').forEach((n) => n.remove());
  const el = h('div', { id: 'toast', class: isError ? 'err' : '' }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

// Runs a model command, reports a domain error rather than throwing it
// at the console, and repaints on success.
function run(fn) {
  try {
    const out = fn();
    if (typeof render === 'function') render();
    return out;
  } catch (err) {
    if (err instanceof DomainError) toast(err.message, true);
    else { console.error(err); toast('Unexpected error: ' + err.message, true); }
  }
}

// ---------- simple / advanced ----------
//
// Advanced hides nothing structural — it only decides whether the parts
// a first model never needs are on screen: identifier schemas, custom
// types, sequences, and the derived consistency boundary.

const MODE_KEY = 'dcb-playground:alternatives:mode';
function mode() { return localStorage.getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'simple'; }
function advanced() { return mode() === 'advanced'; }
function setMode(next) { localStorage.setItem(MODE_KEY, next); if (typeof render === 'function') render(); }

function modeSwitch() {
  const button = (value, label, title) => h('button', {
    class: mode() === value ? 'on' : '', title, onclick: () => setMode(value),
  }, label);
  return h('div', { class: 'mode-switch' },
    button('simple', 'Simple', 'Features, state and events only'),
    button('advanced', 'Advanced', 'Also identifier schemas, custom types, sequences and the derived DCB')
  );
}

// ---------- which context is open ----------

const CONTEXT_KEY = 'dcb-playground:alternatives:context';

function activeContextId() {
  const stored = localStorage.getItem(CONTEXT_KEY);
  if (stored && projectState()[stored]) return stored;
  const id = loadPredefinedContext(2);
  localStorage.setItem(CONTEXT_KEY, id);
  return id;
}
function activeContext() {
  // Resolve the id first: it may create the context, and evaluating
  // projectState() alongside it would snapshot the log too early.
  const id = activeContextId();
  return projectState()[id];
}

function contextPicker() {
  const contexts = Object.values(projectState());
  const select = h('select', {
    onchange: (e) => {
      const v = e.target.value;
      // The page owns the naming form; this only asks for it.
      if (v === 'new:') {
        if (typeof onNewContext === 'function') onNewContext();
        else if (typeof render === 'function') render();
        return;
      }
      if (v.startsWith('load:')) {
        run(() => localStorage.setItem(CONTEXT_KEY, loadPredefinedContext(Number(v.slice(5)))));
      } else {
        localStorage.setItem(CONTEXT_KEY, v);
        if (typeof render === 'function') render();
      }
    },
  });
  for (const ctx of contexts.sort((a, b) => a.name.localeCompare(b.name))) {
    select.appendChild(h('option', { value: ctx.id, selected: ctx.id === activeContextId() }, ctx.name));
  }
  const fresh = h('optgroup', { label: 'Load a fresh copy' });
  PREDEFINED_CONTEXTS.forEach((entry, i) =>
    fresh.appendChild(h('option', { value: 'load:' + i }, entry.name)));
  select.appendChild(fresh);
  const start = h('optgroup', { label: 'Start over' });
  start.appendChild(h('option', { value: 'new:' }, '+ New empty context…'));
  select.appendChild(start);
  return select;
}

// A context with nothing in it at all — no entities, no events, no
// commands. Everything downstream has to cope with that, because it is
// where a real model actually starts.
//
// The name is collected by the page (there are no browser dialogs in
// here); this only does the creating.
function createNamedContext(name) {
  if (!name || !name.trim()) return null;
  return run(() => {
    const id = createDcbContext(name.trim());
    localStorage.setItem(CONTEXT_KEY, id);
    setPendingFeatures([]);
    return id;
  });
}

// ---------- the slice ----------

// Every entity property that folds this event — i.e. everything the
// event changes. This is the link the original interface made you go
// and find for yourself, one entity at a time.
function effectsOf(ctx, eventName) {
  const out = [];
  for (const [entityName, entity] of Object.entries(ctx['entity-definitions'])) {
    for (const property of entity.properties || []) {
      for (const handler of property.handlers || []) {
        if (handler && handler.event === eventName) {
          out.push({ entity: entityName, property, handler });
        }
      }
    }
  }
  return out;
}

// Everything one feature touches, in the order a reader meets it.
function sliceOf(ctx, commandName) {
  const body = ctx['command-definitions'][commandName];
  if (!body) return null;
  return {
    name: commandName,
    body,
    payload: body.properties || [],
    reads: body.boundary || [],
    rules: body.conditions || [],
    emits: (body.publishes || []).map((emission) => ({
      emission,
      event: ctx['event-definitions'][emission.name] || null,
      effects: effectsOf(ctx, emission.name),
    })),
    sequences: sequencesRead(body),
    dcb: deriveDcb(ctx, body),
    coverage: coverageIssues(ctx, body),
  };
}

function allSlices(ctx) {
  return Object.keys(ctx['command-definitions']).map((n) => sliceOf(ctx, n));
}

// ---------- features ----------
//
// A feature groups the commands that make it up. It is not a definition
// of its own: it exists because commands name it, which means a feature
// cannot be empty. Groups you have named but not filled yet are held
// here in the interface until they earn a command.

const UNGROUPED = 'Ungrouped';
const GROUPS_KEY = 'dcb-playground:alternatives:pending-features';

function pendingFeatures() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY)) || []; } catch (e) { return []; }
}
function setPendingFeatures(list) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify([...new Set(list)]));
}
function addPendingFeature(name) { setPendingFeatures([...pendingFeatures(), name]); }

function featureOf(body) {
  return (body && typeof body.feature === 'string' && body.feature.trim()) || UNGROUPED;
}

// Features in the order their first command appears, then the ones still
// waiting for one, then the catch-all — so the rail never reshuffles
// under you as you edit.
function featureGroups(ctx) {
  const order = [];
  const byFeature = {};
  for (const [name, body] of Object.entries(ctx['command-definitions'])) {
    const feature = featureOf(body);
    if (!byFeature[feature]) { byFeature[feature] = []; if (feature !== UNGROUPED) order.push(feature); }
    byFeature[feature].push(name);
  }
  const live = new Set(order);
  for (const name of pendingFeatures()) {
    if (!live.has(name) && name !== UNGROUPED) { order.push(name); byFeature[name] = []; }
  }
  if (byFeature[UNGROUPED]) order.push(UNGROUPED);
  return order.map((name) => ({ name, commands: byFeature[name] || [] }));
}

function featureNames(ctx) {
  return featureGroups(ctx).map((g) => g.name).filter((n) => n !== UNGROUPED);
}

// Events no feature emits, and entities nothing reads — the loose ends
// a command-centred view would otherwise hide.
function orphans(ctx) {
  const emitted = new Set();
  const boundEntities = new Set();
  for (const body of Object.values(ctx['command-definitions'])) {
    for (const e of body.publishes || []) emitted.add(e.name);
    for (const b of body.boundary || []) boundEntities.add(b.entity);
  }
  return {
    events: Object.keys(ctx['event-definitions']).filter((n) => !emitted.has(n)),
    entities: Object.keys(ctx['entity-definitions']).filter((n) => !boundEntities.has(n)),
  };
}

// Everything that happens to one property: which features move it, and
// which features consult it. The inspector needs both halves to answer
// "is this still earning its place?".
function propertyUsage(ctx, entityName, propertyName) {
  const entity = ctx['entity-definitions'][entityName];
  const property = (entity ? entity.properties : []).find((p) => p.name === propertyName);
  const changedBy = [];
  const readBy = [];
  for (const [command, body] of Object.entries(ctx['command-definitions'])) {
    for (const emission of body.publishes || []) {
      const handler = ((property && property.handlers) || []).find((x) => x.event === emission.name);
      if (handler) changedBy.push({ command, event: emission.name, handler });
    }
    const aliases = (body.boundary || []).filter((b) => b.entity === entityName).map((b) => b.alias);
    let reads = false;
    forEachCommandOperand(body, (operand) => {
      if (operandSource(operand) === 'alias-property'
          && aliases.includes(operand.alias) && operand.property === propertyName) reads = true;
    });
    if (reads) readBy.push(command);
  }
  return { property, changedBy, readBy };
}

// ---------- names ----------
//
// A modeler types "define course"; the model stores `DefineCourse`. The
// PascalCase is the schema's business, not the author's, so it is
// derived on the way in and unwound on the way out. Advanced mode shows
// the stored identifier beside the label for anyone who wants it.

function toPascal(label) {
  return String(label || '').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

function toCamel(label) {
  const pascal = toPascal(label);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : '';
}

function splitWords(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/).filter(Boolean);
}

// `CourseDefined` -> "Course defined";  `subscriptionCount` -> "subscription count"
function readable(name) {
  const words = splitWords(name);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
}

function pastTense(verb) {
  if (/e$/i.test(verb)) return verb + 'd';
  if (/[^aeiou]y$/i.test(verb)) return verb.slice(0, -1) + 'ied';
  return verb + 'ed';
}

const PREPOSITIONS = ['To', 'From', 'In', 'On', 'For', 'With', 'At', 'Of'];

// An event is usually the command in the past tense, with the verb
// moved behind the thing it acted on: DefineCourse -> CourseDefined,
// SubscribeStudentToCourse -> StudentSubscribedToCourse. Only ever a
// suggestion — it is offered in an editable field, never imposed.
function suggestEventName(commandName) {
  const words = splitWords(toPascal(commandName));
  if (!words.length) return '';
  if (words.length === 1) return pastTense(words[0]);
  const [verb, ...rest] = words;
  const at = rest.findIndex((w) => PREPOSITIONS.includes(w));
  const past = pastTense(verb);
  if (at > 0) return rest.slice(0, at).join('') + past + rest.slice(at).join('');
  return rest.join('') + past;
}

// ---------- saying it in words ----------

function operandWords(operand) {
  switch (operandSource(operand)) {
    case 'alias-property':
      return operand.property === STATE_PROPERTY ? operand.alias : `${operand.alias}.${operand.property}`;
    case 'parameter': return operand.parameterName;
    case 'enum-member': return operand.enumMember;
    case 'sequence': return `the next ${operand.sequence}`;
    case 'event-property': return operand.eventProperty;
    case 'current-value': return 'its current value';
    default: return typeof operand === 'string' ? `"${operand}"` : String(operand);
  }
}

const PREDICATE_WORDS = {
  equals: ['is', 'is not'],
  lessThan: ['is less than', 'is not less than'],
  lessThanOrEquals: ['is at most', 'is more than'],
  greaterThan: ['is more than', 'is not more than'],
  greaterThanOrEquals: ['is at least', 'is less than'],
  contains: ['contains', 'does not contain'],
  containsAny: ['overlaps', 'does not overlap'],
  countEquals: ['has exactly', 'does not have exactly'],
  countLessThan: ['has fewer than', 'does not have fewer than'],
  countGreaterThan: ['has more than', 'does not have more than'],
  startsWith: ['starts with', 'does not start with'],
  endsWith: ['ends with', 'does not end with'],
  isEmpty: ['is empty', 'is not empty'],
  isNotEmpty: ['is not empty', 'is empty'],
  isTrue: ['holds', 'does not hold'],
  isFalse: ['does not hold', 'holds'],
};

// A condition as a sentence. Returns parts so a renderer can style the
// operands without re-parsing the text.
function conditionParts(condition) {
  const words = PREDICATE_WORDS[condition.predicate] || [condition.predicate, 'not ' + condition.predicate];
  const verb = words[condition.negate ? 1 : 0];
  const left = operandWords(condition.leftHandSide);
  if (condition.rightHandSide === undefined) return { left, verb, right: null };
  return { left, verb, right: operandWords(condition.rightHandSide) };
}

const OPERATION_WORDS = {
  set: 'becomes', increment: 'goes up by', decrement: 'goes down by',
  append: 'gains', remove: 'loses',
};

function effectParts(effect) {
  return {
    subject: `${effect.entity}.${effect.property.name}`,
    verb: OPERATION_WORDS[effect.handler.operation] || effect.handler.operation,
    object: operandWords(effect.handler.value),
  };
}

// A binding, in words: what it is and how the command found it.
function readParts(ctx, body, binding) {
  const plural = isFannedOut(ctx, body, binding);
  return {
    alias: binding.alias,
    entity: binding.entity,
    plural,
    from: operandWords(binding.id),
    excluding: binding.excluding !== undefined ? operandWords(binding.excluding) : null,
  };
}

function typeLabel(property) {
  return `${property.propertyType}${property.isList ? '[]' : ''}${property.isOptional ? '?' : ''}`;
}
