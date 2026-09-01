// ============================================================
// Everything the interface needs that is not the model: DOM helpers,
// the simple / advanced mode, and the *slice* view — everything one
// feature touches, gathered here so the page never has to walk the
// definition graph itself.
//
// The slice is the idea the page is built around: a command, what it
// reads, in how many trips to the log, what it decides, what it emits,
// and what those events change. The model layer stores none of that as
// a unit; it is derived here, from the definitions.
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
// types, projections, and the derived consistency boundary.
//
// How it is offered is the page's business, not this file's: it is one
// of the interface's own settings, and they are collected in one place
// rather than scattered along the top of the window.

const MODE_KEY = 'dcb-playground:mode';
function mode() { return localStorage.getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'simple'; }
function advanced() { return mode() === 'advanced'; }
function setMode(next) { localStorage.setItem(MODE_KEY, next); if (typeof render === 'function') render(); }

// ---------- light / dark ----------
//
// Defaults to whatever the system says, same as any other well-behaved
// page; Settings can override that per browser. `isDark` is the one
// question the rest of the page asks — nothing downstream needs to know
// whether that answer came from the system or from a stored choice.

const THEME_KEY = 'dcb-playground:theme';
function theme() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
function setTheme(next) { localStorage.setItem(THEME_KEY, next); if (typeof render === 'function') render(); }
function isDark() {
  const t = theme();
  if (t !== 'system') return t === 'dark';
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
// Only "system" cares about this firing — an explicit choice already
// repaints itself the moment it is made.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme() === 'system' && typeof render === 'function') render();
  });
}

// ---------- which model is open ----------

const MODEL_KEY = 'dcb-playground:model';

// `null` is a real answer here, not an edge case to work around: a
// browser that has never loaded anything has nothing stored, and the
// Models modal is what asks the question rather than the page silently
// picking an example on someone's behalf.
function activeModelId() {
  const stored = localStorage.getItem(MODEL_KEY);
  return stored && projectState()[stored] ? stored : null;
}
function activeModel() {
  const id = activeModelId();
  return id ? projectState()[id] : null;
}

// A model with nothing in it at all — no entities, no events, no
// commands. Everything downstream has to cope with that, because it is
// where a real model actually starts.
//
// The name is collected by the page (there are no browser dialogs in
// here); this only does the creating.
function createNamedModel(name) {
  if (!name || !name.trim()) return null;
  return run(() => {
    const id = createDcbModel(name.trim());
    localStorage.setItem(MODEL_KEY, id);
    setPendingFeatures([]);
    return id;
  });
}

// ---------- sharing a model ----------
//
// Two ways a model leaves or enters this browser: a self-contained
// link (`#model=<gzipped, base64url-encoded envelope>`, so a static
// page with no backend can still hand someone a working copy of what
// it built) and a URL someone else hosts, fetched and inflated on
// demand. Both carry the same envelope — see `buildShareEnvelope` in
// model.js. Compression is the native Streams API only, matching the
// rest of this project's lack of a dependency story; there is no
// fallback for a browser that lacks it.

function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(text.length + (4 - (text.length % 4)) % 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function gzipToBase64Url(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return base64UrlEncode(new Uint8Array(buffer));
}

async function gunzipFromBase64Url(encoded) {
  const stream = new Blob([base64UrlDecode(encoded)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function buildShareLink(model) {
  const steps = session.steps.map(({ command, args }) => ({ command, args }));
  const envelope = buildShareEnvelope(model, steps);
  const encoded = await gzipToBase64Url(JSON.stringify(envelope));
  return location.origin + location.pathname + '#model=' + encoded;
}

function decodeShareLink(encoded) {
  return gunzipFromBase64Url(encoded).then((json) => JSON.parse(json));
}

// A URL someone else hosts — a gist, a bucket, another tool's export.
// `fetch` only auto-decompresses a gzip `Content-Encoding`; a file whose
// *content type* says gzip (a plain `.json.gz` sitting on a static
// host) arrives untouched over the wire and has to be inflated by hand.
async function loadModelFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get('Content-Type') || '';
  const text = contentType.includes('gzip')
    ? await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text()
    : await response.text();
  return JSON.parse(text);
}

// The async twin of `run`: same error reporting, for a flow that has to
// await a fetch or a compression stream before it knows whether it
// worked.
async function runAsync(fn) {
  try {
    const out = await fn();
    if (typeof render === 'function') render();
    return out;
  } catch (err) {
    if (err instanceof DomainError) toast(err.message, true);
    else { console.error(err); toast('Unexpected error: ' + err.message, true); }
  }
}

// ---------- the slice ----------

// Every entity property that handles this event — i.e. everything the
// event changes. This is the link the original interface made you go
// and find for yourself, one entity at a time.
function effectsOf(model, eventName) {
  const out = [];
  for (const [entityName, entity] of Object.entries(model['entity-definitions'])) {
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

// Every command that publishes this event — zero, one, or many. An
// event has no single owner the way an entity does, so this answers
// "who records this" instead of a boundary binding.
function publishersOf(model, eventName) {
  const out = [];
  for (const [name, body] of Object.entries(model['command-definitions'])) {
    for (const emission of body.publishes || []) {
      if (emission && emission.name === eventName) out.push({ command: name, emission });
    }
  }
  return out;
}

// Every standalone projection that handles this event — the same
// relationship `effectsOf` gives for an entity's own properties, one
// level over.
function projectionsHandling(model, eventName) {
  const out = [];
  for (const [name, body] of Object.entries(model['projection-definitions'])) {
    for (const handler of body.handlers || []) {
      if (handler && handler.event === eventName) out.push({ projection: name, body, handler });
    }
  }
  return out;
}

// Every scenario — ordinary or property — whose Given or Then names
// this event.
function scenariosReferencingEvent(model, eventName) {
  const scenarios = Object.entries(model['scenario-definitions'] || {})
    .filter(([, body]) =>
      (body.given || []).some((s) => s && s.event === eventName)
      || ((body.then || {}).events || []).some((e) => e && e.type === eventName))
    .map(([key, body]) => ({ key, body, property: false }));
  const propertyScenarios = Object.entries(model['property-scenario-definitions'] || {})
    .filter(([, body]) => (body.given || []).some((s) => s && s.event === eventName))
    .map(([key, body]) => ({ key, body, property: true }));
  return [...scenarios, ...propertyScenarios];
}

// Everything one feature touches, in the order a reader meets it.
function sliceOf(model, commandName) {
  const body = model['command-definitions'][commandName];
  if (!body) return null;
  return {
    name: commandName,
    body,
    payload: body.properties || [],
    reads: body.boundary || [],
    rules: body.conditions || [],
    emits: (body.publishes || []).map((emission) => ({
      emission,
      event: model['event-definitions'][emission.name] || null,
      effects: effectsOf(model, emission.name),
    })),
    projections: projectionsRead(body),
    // Grouped by the trip to the store each read actually happens on,
    // which is the depth of the boundary's dependency graph and not
    // its length. Derived here so nothing has to author it.
    rounds: deriveRounds(body),
    dcb: deriveDcb(model, body),
    coverage: coverageIssues(model, body),
  };
}

function allSlices(model) {
  return Object.keys(model['command-definitions']).map((n) => sliceOf(model, n));
}

// ---------- coupling ----------
//
// Every command against every event type it writes (`publishes`) or
// reads back to decide — the same relationship each command's own page
// already shows one at a time (its derived boundary), gathered once
// into a matrix. "Consumes" is read straight off `deriveDcb`: an event
// type is in a command's boundary the moment some read property's
// handler names it, whether or not that command ever publishes it —
// which is what lets a cell be produce-only, consume-only, or both.
function couplingMatrix(model) {
  const events = Object.keys(model['event-definitions']).sort();
  const groups = featureGroups(model)
    .map((group) => ({ name: group.name, commands: group.commands.map((n) => couplingRow(model, n, events)) }))
    .filter((group) => group.commands.length);
  return { events, groups };
}

function couplingRow(model, name, events) {
  const slice = sliceOf(model, name);
  const produces = new Set((slice.body.publishes || []).map((e) => e && e.name).filter(Boolean));
  // event type -> Set of readable "where from" text.
  const via = {};
  for (const item of slice.dcb.items) {
    if (!item.types.length) continue;
    const binding = !item.projection && (slice.body.boundary || []).find((b) => b.alias === item.alias);
    const entity = binding && model['entity-definitions'][binding.entity];
    for (const eventType of item.types) {
      if (!via[eventType]) via[eventType] = new Set();
      if (item.projection) {
        via[eventType].add(readable(item.projection));
        continue;
      }
      const sources = (item.readProperties || []).filter((propName) => {
        const property = entity && (entity.properties || []).find((p) => p.name === propName);
        return property && (property.handlers || []).some((h) => h && h.event === eventType);
      });
      if (sources.length) sources.forEach((propName) => via[eventType].add(memberWords(item.alias, propName)));
      else via[eventType].add(item.alias);
    }
  }
  return {
    name,
    cells: events.map((event) => ({
      event,
      produces: produces.has(event),
      consumes: !!via[event],
      via: via[event] ? [...via[event]] : [],
    })),
  };
}

// ---------- coupling clusters ----------
//
// The matrix as a plain undirected graph — one node per command and
// per event, an edge wherever a cell has any coupling at all (produce
// or consume; direction does not matter for reachability). Two things
// fall out of that graph for free: which commands and events could be
// lifted into their own bounded context together (a connected
// component), and which single command or event is the one thing
// still holding two such components together (an articulation point —
// sever that one coupling and the model splits along the seam it
// names).
function couplingGraph(matrix) {
  const adj = new Map(); // id -> Set(id)
  const commandId = (name) => 'cmd:' + name;
  const eventId = (name) => 'evt:' + name;
  const addNode = (id) => { if (!adj.has(id)) adj.set(id, new Set()); };
  const addEdge = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };

  for (const event of matrix.events) addNode(eventId(event));
  for (const group of matrix.groups) {
    for (const row of group.commands) {
      addNode(commandId(row.name));
      for (const cell of row.cells) {
        if (cell.produces || cell.consumes) addEdge(commandId(row.name), eventId(cell.event));
      }
    }
  }
  return adj;
}

// Every node's connected-component index, assigned in the order
// `nodeOrder` first meets each component — so the numbering is stable
// and reproducible rather than an artefact of `Map` iteration order.
function connectedComponentsOf(adj, nodeOrder) {
  const componentOf = new Map();
  let next = 0;
  for (const start of nodeOrder) {
    if (componentOf.has(start)) continue;
    const stack = [start];
    componentOf.set(start, next);
    while (stack.length) {
      const id = stack.pop();
      for (const neighbor of adj.get(id)) {
        if (!componentOf.has(neighbor)) { componentOf.set(neighbor, next); stack.push(neighbor); }
      }
    }
    next += 1;
  }
  return componentOf;
}

// Articulation points (Tarjan): nodes whose removal would split the
// component they belong to into two or more pieces. Standard
// discovery/low-link DFS — recursive, since a DCB model's coupling
// graph is small enough that the call depth never approaches what
// would trouble the interpreter.
function articulationPointsOf(adj) {
  const disc = new Map();
  const low = new Map();
  const cut = new Set();
  let timer = 0;

  function dfs(id, parent) {
    disc.set(id, timer); low.set(id, timer); timer += 1;
    let children = 0;
    for (const neighbor of adj.get(id)) {
      if (neighbor === parent) continue;
      if (disc.has(neighbor)) {
        low.set(id, Math.min(low.get(id), disc.get(neighbor)));
      } else {
        children += 1;
        dfs(neighbor, id);
        low.set(id, Math.min(low.get(id), low.get(neighbor)));
        if (parent !== null && low.get(neighbor) >= disc.get(id)) cut.add(id);
      }
    }
    if (parent === null && children > 1) cut.add(id);
  }

  for (const id of adj.keys()) {
    if (!disc.has(id)) dfs(id, null);
  }
  return cut;
}

// Commands and events reordered so that coupled clusters sit together
// and, within a cluster, the most-coupled things — the likeliest
// bridges — settle toward the far edge. Clusters are numbered by size,
// largest first, so the model's core sits at the top-left and its
// loosest ends trail off toward the bottom-right.
function couplingClusters(matrix) {
  const adj = couplingGraph(matrix);
  const commandIds = matrix.groups.flatMap((g) => g.commands.map((r) => 'cmd:' + r.name));
  const eventIds = matrix.events.map((e) => 'evt:' + e);
  const nodeOrder = [...commandIds, ...eventIds];

  const componentOf = connectedComponentsOf(adj, nodeOrder);
  const bridges = articulationPointsOf(adj);

  const commandCount = new Map();
  const eventCount = new Map();
  const firstSeen = new Map();
  nodeOrder.forEach((id, i) => {
    const c = componentOf.get(id);
    if (!firstSeen.has(c)) firstSeen.set(c, i);
    (id.startsWith('cmd:') ? commandCount : eventCount).set(c, ((id.startsWith('cmd:') ? commandCount : eventCount).get(c) || 0) + 1);
  });
  const rankOrder = [...firstSeen.keys()].sort((a, b) => {
    const sizeA = (commandCount.get(a) || 0) + (eventCount.get(a) || 0);
    const sizeB = (commandCount.get(b) || 0) + (eventCount.get(b) || 0);
    return sizeB - sizeA || firstSeen.get(a) - firstSeen.get(b);
  });
  const rankOf = new Map(rankOrder.map((c, i) => [c, i]));

  const degree = (id) => adj.get(id).size;
  const byClusterThenDegree = (a, b) =>
    rankOf.get(componentOf.get(a)) - rankOf.get(componentOf.get(b))
    || (bridges.has(a) === bridges.has(b) ? degree(b) - degree(a) : bridges.has(a) ? 1 : -1);

  const commandOrder = [...commandIds].sort(byClusterThenDegree).map((id) => id.slice(4));
  const eventOrder = [...eventIds].sort(byClusterThenDegree).map((id) => id.slice(4));

  const clusters = rankOrder.map((c, rank) => ({
    rank, commands: commandCount.get(c) || 0, events: eventCount.get(c) || 0,
  }));

  return {
    commandOrder,
    eventOrder,
    clusterOfCommand: (name) => rankOf.get(componentOf.get('cmd:' + name)),
    clusterOfEvent: (name) => rankOf.get(componentOf.get('evt:' + name)),
    isBridgeCommand: (name) => bridges.has('cmd:' + name),
    isBridgeEvent: (name) => bridges.has('evt:' + name),
    clusters,
  };
}

// ---------- features ----------
//
// A feature groups the commands that make it up. It is not a definition
// of its own: it exists because commands name it, which means a feature
// cannot be empty. Groups you have named but not filled yet are held
// here in the interface until they earn a command.

const UNGROUPED = 'Ungrouped';
const GROUPS_KEY = 'dcb-playground:pending-features';

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
function featureGroups(model) {
  const order = [];
  const byFeature = {};
  for (const [name, body] of Object.entries(model['command-definitions'])) {
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

function featureNames(model) {
  return featureGroups(model).map((g) => g.name).filter((n) => n !== UNGROUPED);
}

// Events no feature emits, and entities nothing reads — the loose ends
// a command-centred view would otherwise hide.
function orphans(model) {
  const emitted = new Set();
  const boundEntities = new Set();
  for (const body of Object.values(model['command-definitions'])) {
    for (const e of body.publishes || []) emitted.add(e.name);
    for (const b of body.boundary || []) boundEntities.add(b.entity);
  }
  return {
    events: Object.keys(model['event-definitions']).filter((n) => !emitted.has(n)),
    entities: Object.keys(model['entity-definitions']).filter((n) => !boundEntities.has(n)),
  };
}

// Everything that happens to one property: which features move it, and
// which features consult it. The inspector needs both halves to answer
// "is this still earning its place?".
function propertyUsage(model, entityName, propertyName) {
  const entity = model['entity-definitions'][entityName];
  const property = (entity ? entity.properties : []).find((p) => p.name === propertyName);
  const changedBy = [];
  const readBy = [];
  for (const [command, body] of Object.entries(model['command-definitions'])) {
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

// `CourseDefined` -> "Course defined". For things with a name of their
// own: a command, an event, an entity, a value type, a status.
function readable(name) {
  const words = splitWords(name);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
}

// `courseId` -> "course id". For the things that belong to something
// else — a property, a parameter, a field. They are never capitalised,
// and they read the same wherever they turn up: in the list that
// declares them and in the sentence that refers back to them.
function propertyWords(name) {
  return splitWords(name).map((w) => w.toLowerCase()).join(' ');
}

// A property reached through the alias it was bound under.
function memberWords(alias, property) {
  return `${alias} · ${propertyWords(property)}`;
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
      // No property means a bound projection's single value, which the
      // alias already names.
      if (!operand.property) return propertyWords(operand.alias);
      return memberWords(operand.alias, operand.property);
    case 'parameter':
      return operand.property
        ? memberWords(propertyWords(operand.parameterName), operand.property)
        : propertyWords(operand.parameterName);
    case 'enum-member': return readable(operand.enumMember);
    case 'event-property': return propertyWords(operand.eventProperty);
    case 'current-value': return 'its current value';
    case 'successor': return `the one after ${operandWords(operand.successor)}`;
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

// A condition as one plain sentence — the same words `conditionParts`
// hands the slice page's rule editor, joined into a string for a
// read-only overview that has nowhere to hang per-operand styling.
function ruleSentence(model, body, condition) {
  const p = conditionParts(condition);
  const quantifier = quantifierWords(model, body, condition);
  return (quantifier ? quantifier + ', ' : '') + p.left + ' ' + p.verb + (p.right ? ' ' + p.right : '');
}

const OPERATION_WORDS = {
  set: 'becomes', increment: 'goes up by', decrement: 'goes down by',
  append: 'gains', remove: 'loses',
};

function effectParts(effect) {
  // A scripted handler has no operation and no operand to name — the
  // code is both, and nothing here reads it.
  if (effect.handler.code !== undefined) {
    return {
      subject: memberWords(readable(effect.entity), effect.property.name),
      verb: 'is worked out by',
      object: 'a script',
    };
  }
  return {
    subject: memberWords(readable(effect.entity), effect.property.name),
    verb: OPERATION_WORDS[effect.handler.operation] || effect.handler.operation,
    object: operandWords(effect.handler.value),
  };
}

// A binding, in words: what it is and how the command found it.
function readParts(model, body, binding) {
  if (binding.projection) {
    const projection = model['projection-definitions'][binding.projection] || {};
    return {
      alias: binding.alias,
      projection: binding.projection,
      plural: false,
      // One entry per name the projection declares, in its order. For
      // a declared projection these arguments *are* the tags of its
      // query; for a scripted one they are values its code reads, and
      // the tags are stated in the script itself.
      arguments: ((projection.script ? projection.script.arguments : projection.parameters) || [])
        .map((p) => ({
          name: p.name,
          words: operandWords((binding.arguments || {})[p.name]),
        })),
    };
  }
  return {
    alias: binding.alias,
    entity: binding.entity,
    plural: isFannedOut(model, body, binding),
    from: operandWords(binding.id),
    excluding: binding.excluding !== undefined ? operandWords(binding.excluding) : null,
    // What the command hands a scripted property it reads.
    arguments: Object.entries(binding.arguments || {})
      .map(([name, operand]) => ({ name, words: operandWords(operand) })),
  };
}

function typeLabel(property) {
  return `${property.propertyType}${property.isList ? '[]' : ''}${property.isOptional ? '?' : ''}`;
}

// ---------- what a thing looks like ----------
//
// An entity is named in a dozen places — the rail, a read, a change, a
// loose end — and a page with five kinds of thing on it is scanned by
// shape long before it is read by name. So every entity carries one
// mark, and the mark goes wherever the entity does.
//
// It is authored rather than derived: only the modeler knows whether a
// Course is a book or a lecture hall. Until one is chosen a neutral
// glyph stands in — different per entity, so the page is legible
// straight away, but never claiming a meaning nobody gave it.
const ENTITY_MARKS = ['◆', '●', '■', '▲', '★', '◇', '○', '□', '△', '✦'];

function defaultEntityIcon(name) {
  let sum = 0;
  for (const ch of String(name || '')) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return ENTITY_MARKS[sum % ENTITY_MARKS.length];
}

function entityIcon(model, name) {
  const body = model && model['entity-definitions'] ? model['entity-definitions'][name] : null;
  const chosen = body && typeof body.icon === 'string' ? body.icon.trim() : '';
  return chosen || defaultEntityIcon(name);
}

// An event earns the same legibility once it appears as more than a
// line of text — the sandbox lays a whole session out as a strip of
// these. But an event is a moment, not a thing, so its neutral mark
// comes from a different family than an entity's: a spark rather than
// a shape, so a page holding both never reads an unmarked glyph as the
// wrong kind of thing.
const EVENT_MARKS = ['✱', '✲', '✳', '✴', '✵', '✶', '✷', '✸', '✹', '✺'];

function defaultEventIcon(name) {
  let sum = 0;
  for (const ch of String(name || '')) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return EVENT_MARKS[sum % EVENT_MARKS.length];
}

// A command earns the same legibility, from a third family again — a
// tool, not a shape or a spark, since a page can hold all three kinds
// at once and an unmarked glyph should never read as the wrong one.
const COMMAND_MARKS = ['▶', '▷', '◈', '◉', '◐', '◑', '◒', '◓', '⬖', '⬗'];

function defaultCommandIcon(name) {
  let sum = 0;
  for (const ch of String(name || '')) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return COMMAND_MARKS[sum % COMMAND_MARKS.length];
}

function commandIcon(model, name) {
  const body = model && model['command-definitions'] ? model['command-definitions'][name] : null;
  const chosen = body && typeof body.icon === 'string' ? body.icon.trim() : '';
  return chosen || defaultCommandIcon(name);
}

// Every command that publishes this event — usually none or one, since
// every shipped example records one event per command, but nothing
// stops two commands recording the same fact.
function commandsPublishing(model, eventName) {
  return Object.entries(model['command-definitions'] || {})
    .filter(([, body]) => (body.publishes || []).some((emission) => emission.name === eventName))
    .map(([name]) => name);
}

function eventIcon(model, name) {
  const body = model && model['event-definitions'] ? model['event-definitions'][name] : null;
  const chosen = body && typeof body.icon === 'string' ? body.icon.trim() : '';
  if (chosen) return chosen;
  // Unmarked, and the outcome of exactly one command: read as that
  // command's doing by default, the same mark and all — a modeler who
  // wants this event to look like its own thing gives it its own icon,
  // same as always. Two commands recording the same event agree on
  // nothing this way, so that case falls back to the neutral mark.
  const commands = commandsPublishing(model, name);
  if (commands.length === 1) return commandIcon(model, commands[0]);
  return defaultEventIcon(name);
}

// Shown beside the type, never behind the Advanced gate: a value
// arrived at by code is a different kind of claim from one arrived at
// by a declaration, and a rule reading it should say so on the page.
function scriptLabel(property) {
  return property && property.script ? 'scripted' : null;
}

// The payload as operand choices, expanded one level into composite
// fields. A composite is offered whole *and* field by field: the whole
// value is what an emission wants, a field is what a boundary binding
// or a rule wants.
function payloadChoices(model, payload) {
  const out = [];
  for (const p of payload || []) {
    const label = 'given · ' + propertyWords(p.name);
    const fields = compositeFieldsOf(model, p.propertyType);
    if (!fields) {
      out.push([JSON.stringify({ parameterName: p.name }), label]);
      continue;
    }
    out.push([JSON.stringify({ parameterName: p.name }), label + ' (all of it)']);
    for (const f of fields) {
      out.push([
        JSON.stringify({ parameterName: p.name, property: f.name }),
        `${label} · ${propertyWords(f.name)}`,
      ]);
    }
  }
  return out;
}

// The quantifier a condition carries but never states. A fanned-out
// alias makes it universal; an operand rooted at the same list makes
// the pairing by index. Both follow from the operands' types, so the
// reader is told rather than left to work it out.
function quantifierWords(model, body, condition) {
  const roots = conditionFanRoots(model, body, condition);
  if (roots.length !== 1) return '';
  const operands = conditionOperands(condition);
  if (operands.some((o) => isZipped(model, body, condition, o))) {
    return `for each entry of ${roots[0].replace(/^parameter:/, '')}`;
  }
  const alias = operands.find((o) =>
    operandSource(o) === 'alias-property' && fanRootOf(model, body, o) === roots[0]);
  return `for every ${alias ? alias.alias : roots[0].replace(/^binding:|^parameter:/, '')}`;
}
