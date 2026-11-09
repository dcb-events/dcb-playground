// ============================================================
// DCB Playground – model layer.
//
// The semantics behind `index.html`. Nothing here touches the DOM: it
// is the event log, the projection over it, type resolution, reference
// tracking, validation, DCB derivation, the editing commands and the
// predefined models.
//
// **Validation is split in two.** The write path refuses only what
// could not be stored as a definition at all – a missing key, a name
// collision, a body whose containers are not the lists they claim, a
// construct 11.0 removed (`assertStorableBody`). Everything semantic – dangling references,
// write coverage, enum membership, name idiom – is an *advisory*:
// computed from the stored state by `modelAdvisories`, surfaced by the
// interface and the agent tools, never thrown at a writer. A defective
// model loads, renders and evaluates; whatever its defects break
// surfaces where it breaks, as the ordinary error outcome.
//
// Loaded as a classic script (not a module) so the playground opens
// straight from the filesystem without a server.
//
// **Everything is declared** (11.0): a projection is folded by its
// handlers' operations or derived from other projections, and nothing
// a model holds is code. Scripted projections, `currentValue`, guarded
// emissions and optional reads were removed; `removedConstructIn` is
// where a body that still says one is caught, on the write path and on
// import.
//
// **Groups** (11.0): a group owns projections that share its one
// partition tag – `group Course (tag courseId: CourseId) { capacity … }`.
// They are stored inside it, declare no tag of their own and have local
// names; from outside they are named qualified, `Course.capacity`. A
// group means nothing for consistency: reading `course.capacity` reads
// that one projection. So below the write path nothing knows about
// groups at all – `projectionsOf` is every projection by the name it is
// read by, a grouped one flattened to an ordinary body (the group's tag
// as its tag, a derived one's sibling reads spelled from outside), and
// type resolution, DCB derivation, validation and the fold all read
// that. Only the editing commands and the reference rewriting see the
// nesting, because that is what is stored.
//
// **Commands run top-down** (11.0): a command's body is one ordered
// list, `steps` – rules, emissions, branches, and `reject`s inside a
// branch – walked by `forEachStep` and the helpers beside it. Anything
// that reads or rewrites a command goes through them, into every
// branch. The pages edit the top-level rules and emissions as two
// lists (`commandLists` / `withCommandLists`), which leave every
// branch where it is.
//
// **A handler may branch** (11.0): `on E { if c => op  else => op }`,
// stored as `{event, steps: [{branches: [{condition, operation,
// value}], otherwise?: {operation, value}}]}` beside the unconditional
// `{event, operation, value}`. Anything that reads a handler's
// operations or operands goes through `handlerArms`, so it sees every
// branch; a condition reads the event and the projection's own tags,
// never a projection or the state.
//
// Command bodies carry an optional `feature`, naming the set a command
// belongs to. Nothing in the model reads it – it rides along untouched
// through validation, references and renames – and it is the one field
// a DCB Model carries that the modelled system does not read. See
// `CommandDefinition.feature` in dcb-model.schema.json.
// ============================================================

// ============================================================
// Constants.
// ============================================================
// Bumped whenever a stored definition changes shape. The log is the
// whole state, so an old log replayed against new validation would
// produce models this build refuses to save – a fresh key is honest
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
// so far that changes no shape at all – only names – which is exactly
// why it needs a fresh key rather than a quiet coexistence.
// v14 unified projections: an entity property is now a *binding* –
// `{name, projection}` – pointing at an ordinary `projection-definition`,
// every projection declares its partition as explicit `parameters`,
// `isOptional` is gone, and an initial value may be any typed literal
// including a non-empty list. v15 generalised property scenarios into
// projection scenarios: one asserts over a list of `reads` rather than
// over one entity instance's properties, which is the same
// generalisation v14 made to the thing being asserted about. v16
// narrowed a projection scenario back to a single subject: the list of
// aliased `reads` became one `projection` plus its `arguments`, and the
// Then asserts that one fold's value rather than a keyed set. v17 let
// a boundary binding declare `isOptional`: an unset identifier binds
// nothing instead of erroring. Additive in shape, but a v16 reader
// errors on the case the flag declares expected, so the key moves.
// v18 added guarded emissions (`when` on a publishes entry) and
// derived projections (`derived` in place of handlers): a v17 reader
// would publish an emission its author made conditional and has no
// fold for a handlerless projection – both misreads, so the key moves.
// v19 made an entity's lifecycle an explicit designation: the entity
// carries `lifecycle`, naming one of its own property bindings, and the
// two-state case is an ordinary `boolean` projection rather than a
// `NonExistent`/`Existent` enum. The `status` convention is gone – no
// reader keys off the name any more – so a v18 log replayed here would
// produce entities whose lifecycle nothing designates.
// v20 gave every rule a rejection message (`rejection` on a command's
// conditions) and made a refusal known by it: a scenario's Then holds
// the message as `rejection`, in place of a `failedRule` naming the
// condition's text and index and the values it read. A v19 log has
// neither, and there is no message to invent for it.
// v21 made an event's tags explicit (`tags` on the event, 8.0): a v20
// log's events list none, so replayed here every one of them would be
// untagged.
// v22 moved the tags back onto the projection, named (`tags: [{name,
// tagType}]`, empty for an untagged one), and made a read supply a value
// per name (`tags: {courseId: …}`) where it had listed operands; a
// derived operand passes its owner's tags on by name, and an entity's
// fan-out is marked (`id: {each: …}`). A v21 read has no names to match.
// v23 moved a script's `arguments` onto the projection (10.0), where a
// derived projection declares them too; a v22 script's arguments would
// read as none.
// v24 replaced entities by groups (11.0): `entity-definition` and its
// bindings, lifecycles and `excluding` are gone, and a `group-definition`
// owns the projections it names. A v23 log's entities have nowhere to go.
const EVENT_LOG_KEY = 'dcb-playground:events:v24';

const DEF_KINDS = [
  'group-definition',
  'event-definition',
  'projection-definition',
  'command-definition',
  'custom-type-definition',
  'scenario-definition',
  'projection-scenario-definition',
];
const DEF_COLLECTIONS = {
  'group-definition': 'group-definitions',
  'event-definition': 'event-definitions',
  'projection-definition': 'projection-definitions',
  'command-definition': 'command-definitions',
  'custom-type-definition': 'custom-type-definitions',
  'scenario-definition': 'scenario-definitions',
  'projection-scenario-definition': 'projection-scenario-definitions',
};
const KIND_COLOR_CLASS = {
  'group-definition': 'projection',
  'event-definition': 'event',
  'projection-definition': 'projection',
  'command-definition': 'command',
  'custom-type-definition': 'custom-type',
  'scenario-definition': 'scenario',
  'projection-scenario-definition': 'scenario',
};

const KIND_SECTION_TITLE = {
  'group-definition': 'Groups',
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
// reason, one level down: it belongs to a projection rather than a
// command, but its name is still derived from what it found, not
// chosen up front.
const ID_KEYED_KINDS = ['scenario-definition', 'projection-scenario-definition'];

function isIdKeyed(kind) { return ID_KEYED_KINDS.includes(kind); }

const SIMPLE_TYPES = ['boolean', 'integer', 'string', 'datetime', 'duration'];

const PASCAL_RE = /^\p{Lu}[\p{L}\p{M}\p{Nd}]+$/u;
const CAMEL_RE = /^\p{Ll}[\p{L}\p{M}\p{Nd}]+$/u;

const UNARY_PREDICATES = ['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'];
const BINARY_PREDICATES = [
  'equals',
  'equalsAny',
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

// What a derived projection may state: the binary vocabulary minus
// `equalsAny`, whose literal-list spelling belongs to command rules.
// Whatever the predicate, the derived value is one boolean.
const DERIVED_PREDICATES = BINARY_PREDICATES.filter((p) => p !== 'equalsAny');

// What a derived projection may compute instead (9.0): one operator
// over two numbers, yielding a number. No `divide` – an integer stays
// an integer, and there is no division by zero to define. A longer
// expression is a chain of derived projections, each one value the
// sandbox can watch.
const DERIVED_OPERATORS = ['add', 'subtract', 'multiply', 'min', 'max'];
const DERIVED_OPERATOR_SYMBOL = { add: '+', subtract: '-', multiply: '*' };

const OPERATIONS = ['set', 'increment', 'decrement', 'append', 'remove'];

// ============================================================
// Event store (localStorage-backed append-only log).
// ============================================================

// A log that is not storage's: while `inScratchLog` runs, every read
// and write of the log goes to this array instead, nobody is told of
// an append, nothing compacts, and the revision stays where it was –
// `projectState` folds the scratch log uncached instead – so every
// cache of the real log survives it. It exists so a model can be built
// by the very command functions an import uses – retries, the
// structural gate and all – without that model
// ever reaching the log, the undo history or another tab.
let scratchLog = null;

function inScratchLog(build) {
  const saved = scratchLog;
  scratchLog = [];
  try {
    return build(scratchLog);
  } finally {
    scratchLog = saved;
  }
}

function loadEvents() {
  if (scratchLog) return scratchLog;
  const raw = localStorage.getItem(EVENT_LOG_KEY);
  if (raw === null) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch { /* handled below: unparseable is corrupt */ }
  if (Array.isArray(parsed)) return parsed;
  // The log is the whole state, so an unreadable one – bad JSON or the
  // wrong shape – is never left where the next append would overwrite
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

// Bumped by every writer of the log – `appendEvents` here, undo and
// redo in the page, the corrupt-log move-aside below – so a cache can
// ask "has anything changed?" without parsing the log to find out.
// A writer that skips its bump is the one way the caches below go
// stale; nothing re-reads storage to double-check. Another tab's write
// is a writer too: the page bumps on its `storage` event.
let logRevision = 0;
function bumpLogRevision() { logRevision += 1; }
function logRevisionNow() { return logRevision; }

// Told after every append, with where it began and what landed. This
// is the one seam every write funnels through – command functions
// behind buttons and agent tools alike – which is what lets the
// interface take undo marks here rather than wrapping each of the
// hundred call sites. Undo and redo restore the log by writing the
// storage key directly, so they never renotify.
const appendListeners = [];
function onAppend(listener) { appendListeners.push(listener); }

function appendEvents(newEvents) {
  if (scratchLog) {
    scratchLog.push(...stampEvents(newEvents, scratchLog.length));
    return;
  }
  let log = loadEvents();
  const append = () => {
    const startSeq = log.length;
    const stamped = stampEvents(newEvents, startSeq);
    const size = writeEventLog([...log, ...stamped]);
    return { startSeq, stamped, size };
  };
  let written;
  try {
    written = append();
  } catch (error) {
    if (!(error instanceof StorageFullError)) throw error;
    // Full: make room and try again – first by folding what no undo
    // step reaches, then, if that is not enough, everything. Only a
    // change that does not fit even then is refused.
    for (const keepFrom of [compactionFloor(log), log.length]) {
      const compacted = compactedLog(log, keepFrom);
      if (!compacted) continue;
      try {
        log = compacted.events;
        written = append();
      } catch (retry) {
        if (!(retry instanceof StorageFullError)) throw retry;
        continue;
      }
      notifyCompacted(compacted);
      break;
    }
    if (!written) throw error;
  }
  for (const listener of appendListeners) listener(written.startSeq, written.stamped);
  if (written.size > logCompactAt) compactLog();
}

function stampEvents(events, from) {
  const timestamp = new Date().toISOString();
  return events.map((e, i) => ({ sequence: from + i, timestamp, type: e.type, data: e.data }));
}

// The one way the whole log is written – an append, undo and redo, a
// compaction – so the revision is bumped by every writer, and a full
// storage is reported the same way to each. The quota is the browser's
// for the whole site (on dcb.events, shared with the website), and the
// log is rewritten whole on every edit: past it, every edit would fail
// with nothing said but the browser's error name.
// Returns the length written, in characters.
function writeEventLog(events) {
  if (scratchLog) {
    scratchLog.splice(0, scratchLog.length, ...events);
    return 0;
  }
  const text = JSON.stringify(events);
  try {
    localStorage.setItem(EVENT_LOG_KEY, text);
  } catch (error) {
    if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      throw new StorageFullError();
    }
    throw error;
  }
  bumpLogRevision();
  return text.length;
}

// ---------- compaction ----------
//
// The log keeps every edit ever made, and is rewritten whole on every
// append, so left alone it grows into the quota – a few megabytes for
// the whole site, on dcb.events shared with the website. Past a size it
// is compacted, unasked: the events up to a point are replaced by the
// shortest history that builds the same state – per model, its
// creation and one add per definition, in order; deleted models leave
// nothing – and the events after it are kept as they were, renumbered.
// Nobody is asked because nothing they can see changes: the point is
// the page's oldest undo step (`setCompactionFloor`), so every step it
// can still undo survives, moved by the same distance (`onCompact`).
// Only when storage is full and folding that much is not enough does
// compaction take everything, undo history included – and says so.

// A megabyte of log: far past any model's own size, and a fifth of the
// smallest quota a browser gives a site.
let logCompactAt = 1000 * 1000;
function setLogCompactionThreshold(chars) { logCompactAt = chars; }

// The first position compaction must keep as it is. Without a page
// keeping undo marks, nothing needs keeping.
let compactionFloor = (events) => events.length;
function setCompactionFloor(floor) { compactionFloor = floor; }

// Told after a compaction: `{ shift, events, dropped }` – an event kept
// at position `p` is now at `p + shift` of `events`; `dropped` when the
// fold had to take everything, so no earlier position means anything.
const compactListeners = [];
function onCompact(listener) { compactListeners.push(listener); }

function projectEvents(events) {
  const models = {};
  for (const event of events) apply(models, event);
  return models;
}

// `events` with everything before `keepFrom` folded, and the distance
// the rest moved – or null when folding would not shorten anything (it
// already is the shortest history of that state).
function compactedLog(events, keepFrom) {
  const head = [];
  for (const model of Object.values(projectEvents(events.slice(0, keepFrom)))) {
    head.push({ type: 'dcb-model-created', data: { 'dcb-model-id': model.id, name: model.name } });
    if (model.description) head.push({ type: 'dcb-model-described', data: { 'dcb-model-id': model.id, description: model.description } });
    for (const kind of DEF_KINDS) {
      for (const [name, body] of Object.entries(model[DEF_COLLECTIONS[kind]])) {
        head.push({ type: `${kind}-added`, data: { 'dcb-model-id': model.id, name, body } });
      }
    }
  }
  if (head.length >= keepFrom) return null;
  const tail = events.slice(keepFrom).map((event, i) => ({ ...event, sequence: head.length + i }));
  return {
    events: [...stampEvents(head, 0), ...tail],
    shift: head.length - keepFrom,
    dropped: keepFrom >= events.length,
  };
}

function notifyCompacted(compacted) {
  for (const listener of compactListeners) listener(compacted);
}

// Compacts the stored log up to the floor, when that shortens it. A
// compaction that does not fit is no failure – the log as it was is
// still there, and the next append tries again.
function compactLog() {
  const compacted = compactedLog(loadEvents(), compactionFloor(loadEvents()));
  if (!compacted) return;
  try {
    writeEventLog(compacted.events);
  } catch (error) {
    if (error instanceof StorageFullError) return;
    throw error;
  }
  notifyCompacted(compacted);
}

// ---------- undo histories ----------
//
// What a model's undo history is and how it moves, over plain values:
// a tab's histories, `{ models: { [id]: { done, undone, trimmed } },
// restarted }`, and the log's events. Nothing here stores, toasts or
// repaints – the page keeps the histories in sessionStorage and says
// what happened (see _History and undo_). Each function changes the
// histories value it is handed, which the caller then stores.
//
// A step is not a position but a count: the model's last `n` events,
// the newest of which still has to be the one the step ended with
// (`stamp`). Positions move whenever another model's step is taken out
// or the log is compacted; a model's own tail moves only when the model
// itself changes. That is the one case a step is refused: the model was
// changed elsewhere since, and undoing here would take that change too.

// Steps kept per model; the oldest falls off.
const HISTORY_LIMIT = 60;

// An event as a step remembers it – by when it was written and what it
// was, not by its sequence number, which a compaction or another
// model's undo renumbers while the event itself is kept.
function eventStamp(event) {
  return event ? `${event.timestamp} ${event.type} ${event.data && event.data.name || ''}` : '';
}
function ofModel(event, modelId) {
  return !!event.data && event.data['dcb-model-id'] === modelId;
}
// Where in the log each of a model's events sits, oldest first.
function modelPositions(events, modelId) {
  const at = [];
  events.forEach((event, i) => { if (ofModel(event, modelId)) at.push(i); });
  return at;
}

function historyOf(histories, modelId) {
  return histories.models[modelId] || (histories.models[modelId] = { done: [], undone: [] });
}

// What a step changed, as the History page lists it – capped, since a
// whole model applied as code can be hundreds of events.
function changesOfStep(group) {
  return group.slice(0, 40).map((event) => ({
    type: event.type, name: event.data.name || null, from: event.data['previous-name'] || null,
  }));
}

// One gesture's appends, as one step per model they touched. Creating a
// model starts its history rather than being a step in it; deleting one
// ends it, and the deletions come back – `[[id, event]]` – for the page
// to offer to take back. `label` names a step from its events.
function markHistories(histories, appended, { agent = false, via = null, label }) {
  const byModel = new Map();
  for (const event of appended) {
    const id = event.data && event.data['dcb-model-id'];
    if (!id) continue;
    if (!byModel.has(id)) byModel.set(id, []);
    byModel.get(id).push(event);
  }
  const deleted = [];
  for (const [id, group] of byModel) {
    const deletion = group.find((event) => event.type === 'dcb-model-deleted');
    if (deletion) {
      delete histories.models[id];
      deleted.push([id, deletion]);
      continue;
    }
    if (group.some((event) => event.type === 'dcb-model-created')) {
      delete histories.models[id];
      continue;
    }
    const history = historyOf(histories, id);
    const last = group[group.length - 1];
    history.done.push({
      n: group.length, stamp: eventStamp(last), label: label(group),
      time: last.timestamp, agent: !!agent, via: via || null, changes: changesOfStep(group),
    });
    // Redoing after a new change would mean putting back entries the
    // model has moved on from, so the branch is dropped – on an agent's
    // append exactly as on a button's.
    history.undone = [];
    if (history.done.length > HISTORY_LIMIT) {
      history.done.shift();
      history.trimmed = true;
    }
  }
  return deleted;
}

// One model's history as a reader takes it: its steps, oldest first,
// what was undone, newest last, whether the oldest fell off the limit,
// and when it last started again after a change elsewhere – the same
// shape whether or not the model has a history at all.
function historySteps(histories, modelId) {
  const history = histories.models[modelId];
  return {
    done: history ? history.done : [],
    undone: history ? history.undone : [],
    trimmed: !!(history && history.trimmed),
    restarted: (histories.restarted && histories.restarted[modelId]) || null,
  };
}

// Moves a model's history `delta` steps – back when negative, forward
// when positive – over `events`, however far it goes: `{ events, moved }`,
// the log as it then is and how many steps it moved. A model changed
// elsewhere since is `{ refused: true }`: its history is dropped and
// the time noted in `restarted`, and the log is left as it was.
function travelHistory(histories, events, modelId, delta, now = new Date().toISOString()) {
  const history = histories.models[modelId];
  if (!history) return { events, moved: 0 };
  let moved = 0;
  const refuse = () => {
    delete histories.models[modelId];
    histories.restarted = { ...histories.restarted, [modelId]: now };
    return { refused: true };
  };
  while (delta < 0 && history.done.length) {
    const mark = history.done[history.done.length - 1];
    const at = modelPositions(events, modelId);
    if (at.length < mark.n || eventStamp(events[at[at.length - 1]]) !== mark.stamp) return refuse();
    const out = new Set(at.slice(-mark.n));
    const removed = events.filter((event, i) => out.has(i));
    events = events.filter((event, i) => !out.has(i));
    const left = at.length > mark.n ? events[modelPositions(events, modelId).pop()] : null;
    history.done.pop();
    const { n, stamp, ...about } = mark;
    history.undone.push({
      events: removed.map(({ timestamp, type, data }) => ({ timestamp, type, data })),
      base: eventStamp(left), ...about,
    });
    delta++; moved--;
  }
  while (delta > 0 && history.undone.length) {
    const step = history.undone[history.undone.length - 1];
    const at = modelPositions(events, modelId);
    const newest = at.length ? eventStamp(events[at[at.length - 1]]) : '';
    if (newest !== step.base) return refuse();
    events = [...events, ...step.events];
    history.undone.pop();
    const { events: replayed, base, ...about } = step;
    history.done.push({ n: replayed.length, stamp: eventStamp(replayed[replayed.length - 1]), ...about });
    delta--; moved++;
  }
  return { events: moved ? events.map((event, i) => ({ ...event, sequence: i })) : events, moved };
}

// The first position of `events` some history still needs – the first
// of a model's oldest step, or, with only redo left, the event its redo
// has to find in place: how far compaction may fold.
function historyFloor(histories, events) {
  const ats = [events.length];
  for (const [id, history] of Object.entries(histories.models)) {
    const at = modelPositions(events, id);
    const steps = history.done.reduce((sum, mark) => sum + mark.n, 0);
    if (history.done.length && at.length >= steps) ats.push(at[at.length - steps]);
    else if (history.undone.length && at.length) ats.push(at[at.length - 1]);
  }
  return Math.min(...ats);
}

// A model's undo steps, oldest first, each with how many of the model's
// events came after it began – each one a point it can be compared
// with. None once the model was changed elsewhere: the history no
// longer stands, and its next undo drops it.
function historyVersions(histories, events, modelId) {
  const history = histories.models[modelId];
  if (!history || !history.done.length) return [];
  const at = modelPositions(events, modelId);
  const newest = history.done[history.done.length - 1];
  if (!at.length || eventStamp(events[at[at.length - 1]]) !== newest.stamp) return [];
  let since = 0;
  return history.done.slice().reverse().map((mark) => ({ ...mark, since: since += mark.n })).reverse();
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

// A collection is keyed by names an author writes, and `constructor`
// or `toString` is one an author may write: on a plain object every
// lookup of a name the model does not define would find what Object
// inherits under it instead. The projection's collections have no
// prototype, so a missing name reads as missing everywhere.
function emptyCollection() {
  return Object.create(null);
}

function emptyModel(id, name) {
  const model = { id, name };
  for (const kind of DEF_KINDS) model[DEF_COLLECTIONS[kind]] = emptyCollection();
  return model;
}

// Folded once per log revision, not once per call – `activeModel` and
// the render path ask many times per paint. Callers get one shared
// object and must not mutate it: every editor already works on a
// `deepClone` and every change goes through a command function.
let projectionCache = null;

function projectState() {
  if (scratchLog) return projectEvents(scratchLog);
  if (projectionCache && projectionCache.revision === logRevision) return projectionCache.models;
  const models = {};
  for (const event of loadEvents()) apply(models, event);
  // Read *after* the fold: a corrupt log discovered by `loadEvents`
  // bumps the revision while we are standing here.
  projectionCache = { revision: logRevision, models };
  return models;
}

// A `null` entry in a body's list says nothing, and the structural
// gate lets it through. Every reader would otherwise have to step
// over it – the ones that did not crashed the fold and the render – so
// it is dropped once, here, for every writer and every log already
// stored. The event itself keeps what was written.
function withoutNullEntries(body) {
  if (body === null || typeof body !== 'object') return body;
  let out = body;
  for (const field of STORABLE_LIST_FIELDS) {
    if (!Array.isArray(body[field]) || !body[field].includes(null)) continue;
    if (out === body) out = { ...body };
    out[field] = body[field].filter((entry) => entry !== null);
  }
  // A group's projections are bodies of their own, with lists of their own.
  if (Array.isArray(out.projections)) {
    const inner = out.projections.map(withoutNullEntries);
    if (inner.some((p, i) => p !== out.projections[i])) out = { ...out, projections: inner };
  }
  return out;
}

function apply(models, event) {
  const { type, data } = event;
  const modelId = data['dcb-model-id'];

  if (type === 'dcb-model-created') {
    models[modelId] = emptyModel(modelId, data.name);
    return;
  }
  // Appended by `replaceDefinitions` when the code view's `model "…"`
  // header changed, and by `renameDcbModel` from the bar's name field.
  if (type === 'dcb-model-renamed') {
    if (models[modelId]) models[modelId].name = data.name;
    return;
  }
  // The model's description (11.0), the doc comment above the code
  // view's `model "…"` line; null takes it away.
  if (type === 'dcb-model-described') {
    if (!models[modelId]) return;
    if (typeof data.description === 'string' && data.description) models[modelId].description = data.description;
    else delete models[modelId].description;
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
    if (type === `${kind}-added`) { coll[data.name] = withoutNullEntries(data.body); return; }
    if (type === `${kind}-updated`) {
      if (coll[data.name] !== undefined) coll[data.name] = withoutNullEntries(data.body);
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
      const next = emptyCollection();
      for (const key of data.order) if (coll[key] !== undefined) next[key] = coll[key];
      model[DEF_COLLECTIONS[kind]] = next;
      return;
    }
  }
}

// ============================================================
// Groups, and every projection by the name it is read by.
//
// A group is stored as what it is: a name, an optional icon, its one
// partition tag `{name, tagType}` and the projections it owns, each a
// projection body under a local, lowerCamel `name` and with no `tags`
// of its own. Everything that reads a model rather than editing it
// asks `projectionsOf` instead – the top-level projections by their own
// names, then every grouped one under its qualified name
// (`Course.capacity`) as the body it amounts to: tagged by the group's
// tag, and, when derived, reading its siblings the way a reader outside
// would (`capacity` → `Course.capacity` tagged by the group's tag passed
// on). That one flattening is why a grouped projection folds, derives
// its query, type-checks and is advised exactly like a top-level one,
// with no second copy of any of it.
//
// The view is cached per pair of collections, so its bodies keep their
// identity for as long as the model does – evaluate.js compiles a fold
// once per body, and a new object per lookup would compile it per read.
// ============================================================

// A group's partition tag, `{name, tagType}`, or null while it has none.
function groupTagOf(group) {
  const tag = group && group.tag;
  return tag && typeof tag === 'object' && !Array.isArray(tag) ? tag : null;
}

// The projections a group owns, as stored – entries that are not
// objects skipped, the way every list is read.
function groupProjections(group) {
  return (group && Array.isArray(group.projections) ? group.projections : [])
    .filter((inner) => inner && typeof inner === 'object');
}

function qualifiedProjectionName(groupName, localName) {
  return `${groupName}.${localName}`;
}

// `Course.capacity` → `{group: 'Course', local: 'capacity'}`; null for a
// name that is not qualified.
function splitQualifiedName(name) {
  if (typeof name !== 'string') return null;
  const at = name.indexOf('.');
  if (at <= 0 || at === name.length - 1) return null;
  return { group: name.slice(0, at), local: name.slice(at + 1) };
}

// A lowercase name in a projection's place is a sibling's local name –
// only ever written inside a group, by a derived projection.
function isLocalProjectionName(name) {
  return typeof name === 'string' && /^\p{Ll}/u.test(name);
}

// What a projection is called once it is in `groupName`: the group's
// name dropped where it leads (`CourseCapacity` in Course → `capacity`),
// the first letter lowered either way (`SubscriptionCount` →
// `subscriptionCount`). A projection named after nothing but the group
// keeps its whole name.
function groupLocalName(groupName, projectionName) {
  let rest = String(projectionName || '');
  if (groupName && rest.startsWith(groupName) && /^\p{Lu}/u.test(rest.slice(groupName.length))) {
    rest = rest.slice(groupName.length);
  }
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

// The reverse, for a projection moved out: `capacity` of Course →
// `CourseCapacity`.
function ungroupedProjectionName(groupName, localName) {
  const local = String(localName || '');
  return groupName + local.charAt(0).toUpperCase() + local.slice(1);
}

// The stored entry behind a qualified name – `{groupName, group, inner,
// index}` – or null.
function groupProjectionEntry(model, name) {
  const split = splitQualifiedName(name);
  if (!split) return null;
  const groups = (model && model['group-definitions']) || {};
  if (!Object.prototype.hasOwnProperty.call(groups, split.group)) return null;
  const group = groups[split.group];
  const list = group && Array.isArray(group.projections) ? group.projections : [];
  const index = list.findIndex((inner) => inner && inner.name === split.local);
  if (index < 0) return null;
  return { groupName: split.group, group, inner: list[index], index, local: split.local };
}

// A derived operand as a reader outside the group spells it: a sibling
// named locally becomes its qualified read, tagged by this group's tag
// passed on. Anything else is left as written.
function siblingReadOutside(operand, groupName, tag) {
  if (operandSource(operand) !== 'projection-read' || !isLocalProjectionName(operand.projection)) return operand;
  const read = { ...operand, projection: qualifiedProjectionName(groupName, operand.projection) };
  read.tags = tag ? { [tag.name]: { parameterName: tag.name } } : {};
  return read;
}

// One grouped projection as the body it amounts to (see the section).
function effectiveGroupProjection(groupName, group, inner) {
  const { name, tags, ...rest } = inner;
  const tag = groupTagOf(group);
  const body = { ...rest, tags: tag ? [{ name: tag.name, tagType: tag.tagType }] : [] };
  if (rest.derived && typeof rest.derived === 'object') {
    body.derived = { ...rest.derived };
    for (const side of ['leftHandSide', 'rightHandSide']) {
      if (rest.derived[side] !== undefined) body.derived[side] = siblingReadOutside(rest.derived[side], groupName, tag);
    }
  }
  return body;
}

const projectionViews = new WeakMap();

// Every projection by the name it is read by – see the section. A
// collection without a prototype, like the stored ones.
function projectionsOf(model) {
  const top = (model && model['projection-definitions']) || emptyCollection();
  const groups = (model && model['group-definitions']) || emptyCollection();
  let perTop = projectionViews.get(top);
  if (!perTop) projectionViews.set(top, perTop = new WeakMap());
  let view = perTop.get(groups);
  if (view) return view;
  view = emptyCollection();
  for (const [name, body] of Object.entries(top)) view[name] = body;
  for (const [groupName, group] of Object.entries(groups)) {
    for (const inner of groupProjections(group)) {
      if (typeof inner.name !== 'string' || !inner.name) continue;
      view[qualifiedProjectionName(groupName, inner.name)] = effectiveGroupProjection(groupName, group, inner);
    }
  }
  perTop.set(groups, view);
  return view;
}

// The group a projection name belongs to, or null for a top-level one.
function groupOfProjection(model, name) {
  const entry = groupProjectionEntry(model, name);
  return entry ? entry.groupName : null;
}

// The groups a projection could move into: those whose tag is of the
// type of its one tag. A projection tagged by several, or by none,
// stays where it is.
function groupsAccepting(model, projectionName) {
  const projection = (model['projection-definitions'] || {})[projectionName];
  const tags = projectionTagParams(projection);
  if (tags.length !== 1) return [];
  return Object.entries(model['group-definitions'] || {})
    .filter(([, group]) => { const tag = groupTagOf(group); return tag && tag.tagType === tags[0].tagType; })
    .map(([name]) => name);
}

// Classifies a type name against a model: simple, a declared value
// type, or unresolved.
function classifyType(model, typeName) {
  if (!typeName) return { kind: 'unresolved' };
  if (SIMPLE_TYPES.includes(typeName)) return { kind: 'simple' };
  const valueType = model['custom-type-definitions'][typeName];
  if (valueType !== undefined) {
    return {
      kind: 'value',
      composite: Array.isArray(valueType.properties),
      isTag: !!valueType.isTag,
    };
  }
  return { kind: 'unresolved' };
}

// The scalar, tag-marked value type a name resolves to, in the shape a
// tag is rendered from, or null for anything else (unresolved, not a
// value type, composite, or not marked `isTag`).
function identifierTypeOf(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || cls.composite || !cls.isTag) return null;
  const body = model['custom-type-definitions'][typeName];
  return { name: typeName, composite: false, tagSchema: (body && body.tagSchema) || '{type}:{value}' };
}

// Renders one identifier's value into its tag, through that
// identifier's own `tagSchema` – `{type}` and `{value}`, in whichever
// order the template states them. Replaced through functions: a string
// replacement reads `$'` or `$&` in the value as a pattern, and course
// `a$'` would have been tagged – and read – as course `a`.
function renderTag(identifierType, valueText) {
  return identifierType.tagSchema
    .replace('{type}', () => identifierType.name)
    .replace('{value}', () => valueText);
}

// A tag's value as a planned query shows it (_DCB queries, shown_):
// a tag literal's value as it is – `CourseId:c1` – and anything else,
// not known until a run supplies it, in braces: `{courseId}`, and a
// fan-out `{each course.subscribedStudentIds}`. A value missing
// mid-edit stays `?`.
function plannedTagValue(operand, shown, each = false) {
  if (shown === '?' || operandSource(operand) === 'tag-literal') return shown;
  return `{${each ? `each ${shown}` : shown}}`;
}

// The fields of a composite value type, or null for anything else.
// Universal – a composite's fields may be any value type, tag-marked
// or not; `idLeavesOfType` is what picks out the tag-marked ones.
function compositeFieldsOf(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || !cls.composite) return null;
  return model['custom-type-definitions'][typeName].properties || [];
}

// Whether a type carries at least one tag – a tag-marked scalar, or a
// composite with at least one tag-marked field. Used wherever something
// must be able to narrow a query: a projection's tag, a group's.
function isTagBearing(model, typeName) {
  return idLeavesOfType(model, typeName).length > 0;
}

// Tag derivation, looking *through* a composite to its fields.
//
// Every tag reachable from a type, as `{ field, identifierType }` –
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

// The tags an event carries are the ones it lists (8.0). Each entry of
// `tags` is a path: a property typed with a tag type, or
// `property.field` into a record whose field is one – a list of either
// contributing one tag per element. Nothing is implied any more: a
// tag-typed property left off the list is an ordinary value, and an
// event with no list carries no tag at all. The advisories say both
// (`eventTagAdvisories`), because the author asked to be told rather
// than guessed for.
//
// Resolves one path to the leaf `idLeavesOfType` would have produced
// for it – `{ path, property, field, isList, identifierType }` – or to
// `{ problem }` saying why it is not a tag.
function resolveEventTagPath(model, event, path) {
  if (typeof path !== 'string' || !path) return { problem: 'a tag entry must name a property' };
  const [propertyName, fieldName, ...rest] = path.split('.');
  if (rest.length) return { problem: `"${path}" reaches deeper than a record field` };
  const property = ((event && event.properties) || []).find((p) => p && p.name === propertyName);
  if (!property) return { problem: `"${path}" names no property of the event` };
  const leaves = idLeavesOfType(model, property.propertyType);
  const leaf = leaves.find((l) => l.field === (fieldName === undefined ? null : fieldName));
  if (!leaf) {
    if (fieldName === undefined && leaves.length) {
      return { problem: `"${path}" is a record – name its tag field (${leaves.map((l) => `${propertyName}.${l.field}`).join(', ')})` };
    }
    return { problem: `"${path}" is not of a tag type` };
  }
  return { path, property: propertyName, field: leaf.field, isList: !!property.isList, identifierType: leaf.identifierType };
}

function eventTagLeaves(model, event) {
  const seen = new Set();
  const out = [];
  for (const path of (event && event.tags) || []) {
    const leaf = resolveEventTagPath(model, event, path);
    if (leaf.problem || seen.has(leaf.path)) continue;
    seen.add(leaf.path);
    out.push(leaf);
  }
  return out;
}

// What the advisories say about an event's tags: an entry that is not
// a tag, one listed twice, no tags at all, and a tag-typed value left
// off the list – the last two because nothing is implied any more, so
// a forgotten tag is an event no query by that tag will ever reach.
function eventTagAdvisories(model, event) {
  const messages = [];
  const tags = (event && event.tags) || [];
  const seen = new Set();
  for (const path of tags) {
    if (seen.has(path)) { messages.push(`Tag "${path}" is listed twice.`); continue; }
    seen.add(path);
    const resolved = resolveEventTagPath(model, event, path);
    if (resolved.problem) messages.push(`Tag ${resolved.problem}.`);
  }
  if (!tags.length) messages.push('Carries no tags, so a query by tag never reaches it.');
  for (const path of tagPathsOf(model, (event && event.properties) || [])) {
    if (seen.has(path)) continue;
    messages.push(`"${path}" is of a tag type but not one of this event's tags – a query by it does not reach this event.`);
  }
  return messages;
}

// Every path in `properties` that could be listed as a tag, in property
// order. What an authoring gesture offers, and what a new event made
// from a command's payload starts with listed – the stored list is the
// fact, this is only a default someone can see and change.
function tagPathsOf(model, properties) {
  return (properties || []).flatMap((p) => (p && p.propertyType
    ? idLeavesOfType(model, p.propertyType).map((leaf) => (leaf.field === null ? p.name : `${p.name}.${leaf.field}`))
    : []));
}

// An event body after a page edit, with its tags kept in step: a
// tag-typed value the edit introduced – a new property, or one retyped
// into a tag type – is listed, and a path the edit left meaning nothing
// (its property removed, or retyped out of a tag type) is dropped. The
// pages' authoring default, visible and undoable like the edit itself;
// a body arriving whole (a file, the code view, an agent) is stored as
// it says and never passes through here.
function withEditedTags(model, previous, next) {
  const before = new Set(tagPathsOf(model, (previous && previous.properties) || []));
  const kept = ((next && next.tags) || []).filter((path) => !resolveEventTagPath(model, next, path).problem);
  const added = tagPathsOf(model, next.properties || [])
    .filter((path) => !before.has(path) && !kept.includes(path));
  return { ...next, tags: [...kept, ...added] };
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
// resolves to an enum" – the one keyword that unambiguously means
// "these are the only legal values".
function enumMembersFor(model, typeName) {
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || cls.composite) return null;
  const valueType = model['custom-type-definitions'][typeName];
  const members = valueType && valueType.schema && valueType.schema.enum;
  return Array.isArray(members) && members.length ? members : null;
}

// Whether an enum's members are all plain strings – the shape the
// chip-based member editor (add/rename/remove, with rewrite-on-rename
// across every reference) is built for. A numeric, boolean or mixed
// enum still evaluates correctly through the ordinary operand
// machinery; it just does not get that authoring convenience, and is
// edited as raw JSON Schema instead.
function isStringEnumType(model, typeName) {
  const members = enumMembersFor(model, typeName);
  return !!members && members.every((m) => typeof m === 'string');
}

// A model with one definition overlaid – used so that a body being
// validated can reference the very definition it belongs to (a derived
// projection may read itself, which its advisory then says).
function withPending(model, kind, name, body) {
  const next = { ...model };
  const collName = DEF_COLLECTIONS[kind];
  next[collName] = { ...model[collName], [name]: body };
  return next;
}

function defaultAlias(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
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
// schema) – never stored alongside it. A group's projections live in
// its body, so whatever they name – events, types, other projections –
// the group references, and a rename reaches them through the same
// generic machinery as any top-level projection. A qualified name
// (`Course.capacity`) references the group; which of its projections it
// means is a local name, moved by `renameMember` like any other member.
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
// site added to one is a reference site added to the other – the
// drift that used to be possible (compute sees it, rename leaves it
// dangling, or the reverse) has nowhere left to live.
//
// `slot(targetKind, {flavor, get, set})` is called per site:
//   - flavor 'type': a property-type name. Counted as a reference
//     only when it classifies as a value type; rewritten on equality
//     (the rename target being a custom type guarantees the class).
//   - flavor 'name': a definition named outright.
function forEachReferenceSlot(kind, name, body, slot) {
  const at = (holder, key, targetKind, flavor) => {
    if (!holder) return;
    slot(targetKind, {
      flavor,
      get: () => holder[key],
      set: (v) => { holder[key] = v; },
    });
  };
  // A projection named in a read: a top-level one by its name, a
  // grouped one by its group – the part before the dot, which is all a
  // group rename moves. A sibling's local name references nothing.
  const projectionAt = (holder, key) => {
    if (!holder) return;
    const value = holder[key];
    if (splitQualifiedName(value)) {
      slot('group-definition', {
        flavor: 'name',
        get: () => splitQualifiedName(holder[key]).group,
        set: (v) => { holder[key] = qualifiedProjectionName(v, splitQualifiedName(holder[key]).local); },
      });
      return;
    }
    if (isLocalProjectionName(value)) return;
    at(holder, key, 'projection-definition', 'name');
  };
  const typeSlots = (properties) => {
    for (const p of properties || []) {
      if (!p) continue;
      at(p, 'propertyType', 'custom-type-definition', 'type');
    }
  };
  // A tag literal carries its tag type by bare name (`CourseId("c1")`),
  // and so does a projection's declared tag – the places a type is
  // referenced outside a property type.
  const tagLiteralSlots = (tags) => {
    const values = tags && typeof tags === 'object' ? Object.values(tags) : [];
    for (const tag of values) {
      if (tag && typeof tag === 'object' && tag.tagType !== undefined) {
        at(tag, 'tagType', 'custom-type-definition', 'type');
      }
    }
  };
  const givenSlots = (given) => {
    for (const step of given || []) at(step, 'event', 'event-definition', 'name');
  };
  // One projection body – top-level, or one a group owns.
  const projectionSlots_ = (projection) => {
    if (!projection || typeof projection !== 'object') return;
    at(projection, 'valueType', 'custom-type-definition', 'type');
    tagLiteralSlots(projection.tags);
    typeSlots(projection.arguments);
    for (const handler of projection.handlers || []) at(handler, 'event', 'event-definition', 'name');
    // A derived predicate names the projections it reads.
    for (const operand of derivedReads(projection.derived)) {
      if (operand && typeof operand === 'object' && operand.projection !== undefined) {
        projectionAt(operand, 'projection');
        tagLiteralSlots(operand.tags);
      }
    }
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
    case 'group-definition':
      // Its tag's type, and everything its projections name.
      at(groupTagOf(body), 'tagType', 'custom-type-definition', 'type');
      for (const inner of groupProjections(body)) projectionSlots_(inner);
      break;
    case 'projection-definition':
      projectionSlots_(body);
      break;
    case 'command-definition':
      typeSlots(body.properties);
      // Only `group` and `projection` are references. An alias is local
      // to its command and was the modeler's to choose.
      for (const binding of body.boundary || []) {
        if (!binding) continue;
        at(binding, 'group', 'group-definition', 'name');
        projectionAt(binding, 'projection');
        tagLiteralSlots(binding.tags);
      }
      // An inline read names its projection, and its literals their tag
      // types, wherever an operand sits.
      forEachCommandOperand(body, (operand) => {
        if (operandSource(operand) !== 'projection-read') return;
        projectionAt(operand, 'projection');
        tagLiteralSlots(operand.tags);
      });
      for (const emission of commandEmissions(body)) at(emission, 'name', 'event-definition', 'name');
      break;
    case 'scenario-definition':
      // A scenario names the command it exercises, every event its
      // Given is written from, and every event its expected outcome
      // holds. All three have to move when one of them is renamed –
      // and none of them may stop one from being deleted; a scenario
      // exists to report what a change broke, not to prevent it.
      at(body, 'command', 'command-definition', 'name');
      givenSlots(body.given);
      for (const event of (body.then || {}).events || []) at(event, 'type', 'event-definition', 'name');
      break;
    case 'projection-scenario-definition':
      // Names the projection it is about, every event its Given is
      // written from, and the tag type of each tag it reads by. Its Then
      // is a bare value and its `arguments` are values too.
      projectionAt(body, 'projection');
      givenSlots(body.given);
      tagLiteralSlots(body.tags);
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
// Command operands:  {parameterName} | {alias, property?, arguments?} | {enumMember} | literal
//                    | {projection, tags?, arguments?} (a read in place)
//                    | {duration} | {operator, leftHandSide, rightHandSide} (11.0)
// Handler operands:  {eventProperty} | {successor} | {enumMember} | literal
// Derived operands:  {projection, tags?, arguments?} | {parameterName} | {enumMember} | literal
//                    | {duration} (11.0)
// Tag operands:      a command operand | {tagType, tagValue} | {each: operand}
//
// `{alias}` with no `property` reads a bound projection's value: a
// projection holds exactly one value and has no name for it. On a group
// alias the property is required – it is the local name of the one
// projection of the group being read, `course.capacity` – and so are
// the arguments that projection takes, `course.seatsOn(slot: s)`: they
// belong to the projection, never to the group's read. A read in place
// of a grouped projection names it qualified, `{projection:
// 'Course.capacity', tags: {courseId: …}}`, spelled
// `Course(courseId).capacity`.
//
// A projection declares its tags by name (8.0, `tags: [{name,
// tagType}]`), and a read supplies one value per name – `tags:
// {courseId: …}`, written `CourseStatus(courseId)`. The declared type is
// the tag's key; the value has to be of it. A literal states its type
// anyway – `{tagType, tagValue}`, spelled `CourseId("c1")` – because the
// text shows it and a mismatch is then visible. It is allowed only
// where a tag is, and its two keys keep it apart from any record
// literal. `{each: operand}` is the fan-out, said where it happens: the
// read is made once per element of a list, and a rule over it holds for
// every one (`ProductExists(each items.productId)`).
//
// **Open tags and collection functions** (11.0). A read may leave a tag
// open, `{open: true}` in its `tags`, spelled `*`: `ReservationSeats(
// courseId, *)` reads every *present* instance matching the tags it
// binds – one whose value differs from the projection's initial value,
// so setting the initial value acts as delete. An open read is no value
// of its own: it is read only as the `read` of a collection function,
// `{collect, read, where?}` – `count`, `sum`, `min`, `max`, `average`,
// `any` or `all` (`COLLECTION_FUNCTIONS`) – whose `where` is a condition
// over `{instanceValue: true}` (`value`, or `value.field` with `field`),
// the parameters in scope and literals, and never reads a projection.
// `list` (`{collect: 'list'}`, G1 of the acceptance) collects the one
// tag the read leaves open: the values of the present instances, in
// the order of each one's first event – a list of that tag's type,
// usable wherever a list is (an emission, `contains`, `count`, a `for
// each`'s source).
// At least one tag stays bound, and a group's one tag never opens. Its
// query is the handled types by the bound tags alone; the fold groups
// the events by the open tags' values, and an event without one belongs
// to no instance. Every walker that sees reads sees the open one: a
// collection's `read` is an ordinary projection read to them.
//
// **Time and arithmetic** (11.0): `{duration: 'PT15M'}` is a duration
// literal, `15m`, and `{operator: 'add' | 'subtract', leftHandSide,
// rightHandSide}` adds or subtracts two operands where a rule compares
// or an emission writes – `CourseCapacity(courseId) - sum(…)`, `now +
// 15m` – never in a read's tag or a where. Walkers see both sides as
// operands in the same place (`forEachCommandOperand`); its type is
// what `arithmeticOperandType` says. See _Time_.
//
// **A record value's field** (11.0): a read of a projection holding a
// record – in place or through an alias, a group member included – may
// name one field, `field`: `CustomerAddress(customerId).city`,
// `address.city`, `course.address.city`. It is the same read as the
// whole value; only what the operand takes from it differs. A handler
// sets such a projection whole – an event field of the record's type,
// or a record of event fields and literals, `{record: {street: …}}`.
// ============================================================

// The collection functions an open read is reduced by (11.0), and what
// each gives over no instance at all – `list` the open tag's values.
const COLLECTION_FUNCTIONS = ['count', 'sum', 'min', 'max', 'average', 'any', 'all', 'list'];

function operandSource(operand) {
  if (operand === null || operand === undefined) return 'static';
  if (typeof operand !== 'object') return 'static';
  if (operand.collect !== undefined) return 'collection';
  if (operand.count !== undefined && Object.keys(operand).length === 1) return 'count';
  if (operand.operator !== undefined && operand.leftHandSide !== undefined) return 'arithmetic';
  if (operand.duration !== undefined && Object.keys(operand).length === 1) return 'duration';
  if (operand.open === true) return 'open';
  if (operand.instanceValue === true) return 'instance-value';
  if (operand.record !== undefined && !Array.isArray(operand) && Object.keys(operand).length === 1) return 'record';
  if (operand.parameterName !== undefined) return 'parameter';
  if (operand.alias !== undefined) return 'alias-property';
  if (operand.enumMember !== undefined) return 'enum-member';
  if (operand.eventProperty !== undefined) return 'event-property';
  if (operand.successor !== undefined) return 'successor';
  if (operand.projection !== undefined) return 'projection-read';
  if (operand.tagType !== undefined) return 'tag-literal';
  if (operand.each !== undefined) return 'each';
  return 'static';
}

function operandText(operand) {
  switch (operandSource(operand)) {
    case 'parameter':
      return operand.property
        ? `${operand.parameterName || '?'}.${operand.property}`
        : (operand.parameterName || '?');
    case 'alias-property': {
      const read = operand.property
        ? `${operand.alias || '?'}.${operand.property}`
        : (operand.alias || '?');
      const args = Object.values(operand.arguments || {});
      return (args.length ? `${read}(${args.map(operandText).join(', ')})` : read) + fieldText(operand);
    }
    case 'enum-member': return operand.enumMember || '?';
    case 'event-property': return `event.data.${operand.eventProperty || '?'}${operand.property !== undefined ? '.' + operand.property : ''}`;
    case 'successor': return `successor(${operandText(operand.successor)})`;
    // The values in the order they are held, which is the order the
    // projection declares them in wherever a writer built the read. A
    // grouped projection is read through its group – the tags on the
    // group, the arguments on the projection: `Course(courseId).capacity`.
    case 'projection-read': {
      const tags = readTagOperands(operand).map(operandText);
      const args = Object.values(operand.arguments || {}).map(operandText);
      const split = splitQualifiedName(operand.projection);
      if (split) return `${split.group}(${tags.join(', ')}).${split.local}${args.length ? `(${args.join(', ')})` : ''}${fieldText(operand)}`;
      return `${operand.projection || '?'}(${[...tags, ...args].join(', ')})${fieldText(operand)}`;
    }
    case 'tag-literal': return `${operand.tagType || '?'}(${JSON.stringify(operand.tagValue)})`;
    case 'each': return `each ${operandText(operand.each)}`;
    case 'open': return '*';
    case 'collection':
      return `${operand.collect || '?'}(${operandText(operand.read)}`
        + `${operand.where !== undefined ? ` where ${conditionText(operand.where)}` : ''})`;
    case 'count': return `count(${operandText(operand.count)})`;
    case 'instance-value': return `value${operand.field !== undefined ? '.' + operand.field : ''}`;
    case 'duration': return durationLiteralText(operand.duration) || JSON.stringify(operand.duration);
    case 'arithmetic': return arithmeticText(operand);
    case 'record': {
      const fields = operand.record && typeof operand.record === 'object' ? Object.entries(operand.record) : [];
      return `{ ${fields.map(([key, value]) => `${key}: ${operandText(value)}`).join(', ')} }`;
    }
    default:
      if (operand === null || operand === undefined) return 'null';
      if (Array.isArray(operand)) return `[${operand.map(operandText).join(', ')}]`;
      return typeof operand === 'string' ? `"${operand}"` : String(operand);
  }
}

// `a - b`, `now + 15m` (11.0): a left side that is itself a sum is
// written bare, `a - b + c`, as it was read; a right side that is one
// is no spelling the text has, and is bracketed.
const ARITHMETIC_SYMBOLS = { add: '+', subtract: '-' };
function arithmeticText(operand) {
  const symbol = ARITHMETIC_SYMBOLS[operand.operator] || operand.operator;
  const right = operandSource(operand.rightHandSide) === 'arithmetic'
    ? `(${operandText(operand.rightHandSide)})` : operandText(operand.rightHandSide);
  return `${operandText(operand.leftHandSide)} ${symbol} ${right}`;
}

// `.field` after a read of a record value (11.0), or nothing.
function fieldText(operand) {
  return operand && operand.field !== undefined ? `.${operand.field}` : '';
}

// An operand is unresolved when the name its kind requires is absent –
// the gap `operandText` papers over with a '?' placeholder. Checked
// structurally, because a literal that merely *contains* a question
// mark is a value, not a gap.
function operandIncomplete(operand) {
  if (Array.isArray(operand)) return operand.some(operandIncomplete);
  switch (operandSource(operand)) {
    case 'parameter': return !operand.parameterName;
    case 'alias-property': return !operand.alias;
    case 'enum-member': return !operand.enumMember;
    case 'event-property': return !operand.eventProperty;
    case 'successor': return operandIncomplete(operand.successor);
    case 'projection-read': return !operand.projection;
    case 'tag-literal': return !operand.tagType;
    case 'each': return operandIncomplete(operand.each);
    case 'collection': return !operand.collect || operandIncomplete(operand.read);
    case 'count': return operandIncomplete(operand.count);
    case 'arithmetic': return operandIncomplete(operand.leftHandSide) || operandIncomplete(operand.rightHandSide);
    default: return false;
  }
}

function sameOperand(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// `operandSource` falls back to "static" for anything it does not
// recognise, so a misspelt or retired operand key would be stored as a
// literal and rendered as "[object Object]". A literal is a string, a
// number or a boolean – never an object – so an object that classifies
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
  if (isCompoundCondition(condition)) {
    const and = Array.isArray(condition.all);
    return conditionMembers(condition).map((part) => {
      const text = conditionText(part);
      // `and` binds tighter, so only an `or` inside an `and` needs its
      // brackets.
      return and && part && Array.isArray(part.any) ? `(${text})` : text;
    }).join(and ? ' and ' : ' or ');
  }
  const left = operandText(condition.leftHandSide);
  const core = condition.rightHandSide === undefined
    ? `${left} ${predicateText(condition.predicate)}`
    : `${left} ${predicateText(condition.predicate)} ${operandText(condition.rightHandSide)}`;
  return condition.negate ? `not(${core})` : core;
}

// A derived value as one line: its comparison, or its computation –
// `a - b`, `min(a, b)`.
function derivedText(derived) {
  if (!derived) return '';
  if (derivedHolds(derived)) return operandText(derived.leftHandSide);
  if (derived.operator === undefined) return conditionText(derived);
  const left = operandText(derived.leftHandSide);
  const right = operandText(derived.rightHandSide);
  const symbol = DERIVED_OPERATOR_SYMBOL[derived.operator];
  return symbol ? `${left} ${symbol} ${right}` : `${derived.operator}(${left}, ${right})`;
}

// A scenario as the page's save stores it: every optional property a
// draft left unset spelt out as the explicit null, in each Given step,
// a command's arguments and a published Then – an optional list too,
// whose null is its absence (11.0). A text applied as code (`partial`)
// is stored as written instead: since 11.0 a property it leaves out is
// *unspecified*, not null – the scenario does not depend on it, a Then
// does not compare it, and a run that reads it is broken
// (`evScenarioPayload`, evaluate.js). Fills `body` in place and
// returns it.
function canonicalScenario(model, kind, body, { partial = false } = {}) {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fill = (data, properties) => {
    if (partial || !data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const property of properties || []) {
      if (!property || !property.isOptional) continue;
      if (!own(data, property.name) || data[property.name] === undefined) data[property.name] = null;
    }
  };
  const eventProperties = (name) => {
    const event = own(model['event-definitions'], name) ? model['event-definitions'][name] : null;
    return event && event.properties;
  };
  for (const step of body.given || []) {
    if (!step) continue;
    step.data = step.data || {};
    fill(step.data, eventProperties(step.event));
  }
  if (kind === 'scenario-definition') {
    body.when = body.when || {};
    body.when.arguments = body.when.arguments || {};
    const commands = model['command-definitions'];
    fill(body.when.arguments, own(commands, body.command) ? commands[body.command].properties : null);
  }
  if (body.then && body.then.outcome === 'published') {
    for (const event of body.then.events || []) if (event) fill(event.data, eventProperties(event.type));
  }
  return body;
}

// What a scenario is called. The stored name wins; without one it is
// read off the outcome, which is why it changes when the outcome does –
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
    return then.rejection ? `is refused: ${then.rejection}` : 'is refused';
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

// The predicate a projection is *derived* by, or null when it is
// folded the ordinary way.
function derivedOf(target) {
  return target && target.derived ? target.derived : null;
}

// Whether a derived value computes a number (`operator`, 9.0) rather
// than comparing (`predicate`, always a boolean). A body carrying both
// reads as a comparison, and the advisory says both are there.
function derivedComputes(derived) {
  return !!derived && derived.operator !== undefined && derived.predicate === undefined;
}

// Whether a derived value holds its one operand as it is (11.0) – a
// collection function's result, `sum(ReservationSeats(courseId, *))`,
// or a record's field – with neither a comparison nor a computation:
// `{leftHandSide}` alone.
function derivedHolds(derived) {
  return !!derived && derived.predicate === undefined && derived.operator === undefined
    && derived.rightHandSide === undefined && derived.negate === undefined;
}

// ============================================================
// Time (11.0).
//
// Time is data. No event carries a recorded time – the DCB spec has
// none – so time that matters to the domain is an event field the
// command writes, and the clock is a parameter like any other, `now:
// datetime`, supplied by the layer around the commands. A scenario
// passes it as it passes any value, and needs no clock of its own.
//
// **`datetime`** is an RFC 3339 date-time *with* an offset –
// `2026-01-01T10:00:00+02:00`, `…Z` – the JSON Schema `date-time`
// format, and it is compared as the instant it names: `11:30+02:00`
// comes before `10:00Z`. Without an offset it names no instant, and
// is no datetime at all.
//
// **`duration`** is a length of time, stored as an ISO 8601 duration
// string of whole days, hours, minutes and seconds – `PT15M`, `P7D`,
// `PT1H30M` – and spelled in the notation `15m`, `7d`, `1h30m`: a
// day is exactly 24 hours, and there are no years, months or weeks
// (no fixed length), no fractions and no sign. A literal keeps the
// units it was written in, `PT24H` for `24h`, so the text reads back
// as written; two durations are equal when they are as long.
//
// **Arithmetic** (`arithmeticResultBase`): `datetime ± duration` is a
// datetime, written in UTC (`…Z`, milliseconds only when there are
// some); `duration ± duration` a duration in its largest units
// (`P1DT2H`); and numbers add and subtract as numbers. A duration
// never goes below zero, and nothing subtracts one datetime from
// another. A custom scalar type is one of them when its schema says
// the format, `{type: 'string', format: 'date-time'}` – what `type
// Deadline = datetime` stores.
//
// Nothing in the evaluator carries types, so it knows a time value by
// its value: two that both read as datetimes are ordered as instants,
// two that both read as durations by length.
// ============================================================

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/;
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const DURATION_RE = /^P(?!$)(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
// The units a duration literal counts, largest first, and the seconds in each.
const DURATION_UNITS = [['d', 'D', 86400], ['h', 'H', 3600], ['m', 'M', 60], ['s', 'S', 1]];

// The instant a datetime names, in milliseconds since the epoch – or
// null when the value is no RFC 3339 date-time with an offset.
function datetimeInstant(value) {
  if (typeof value !== 'string') return null;
  const match = DATETIME_RE.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction, , sign, oh, om] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  if (oh !== undefined && (Number(oh) > 23 || Number(om) > 59)) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0);
  if (date.getUTCDate() !== day) return null;
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
  return date.getTime() - offset * 60000;
}

// An instant written as a datetime, in UTC: `2026-01-01T08:15:00Z`.
function datetimeText(instant) {
  return new Date(instant).toISOString().replace('.000Z', 'Z');
}

// How long an ISO 8601 duration is, in seconds – or null when the
// value is not one of the durations this notation has.
function durationSeconds(value) {
  if (typeof value !== 'string') return null;
  const match = DURATION_RE.exec(value);
  if (!match) return null;
  return DURATION_UNITS.reduce((sum, [, , seconds], i) => sum + (match[i + 1] ? Number(match[i + 1]) * seconds : 0), 0);
}

// A length in seconds as a duration, in its largest units: `P1DT2H`.
function durationText(seconds) {
  let rest = seconds;
  const parts = DURATION_UNITS.map(([, unit, size]) => {
    const count = Math.floor(rest / size);
    rest -= count * size;
    return count ? `${count}${unit}` : '';
  });
  const time = parts.slice(1).join('');
  if (!parts[0] && !time) return 'PT0S';
  return `P${parts[0]}${time ? `T${time}` : ''}`;
}

// A duration literal as the notation spells it – `15m`, `7d`, `1h30m`
// – read into the ISO 8601 duration it stores, keeping its units:
// `{value: 'PT15M'}`, or `{error}` saying what is wrong with it.
function durationFromLiteral(text) {
  if (String(text).includes('.')) return { error: `"${text}" is no duration – write a whole number and a unit: 30s, 15m, 24h, 7d.` };
  const parts = String(text).match(/\d+[^\d]*/g);
  if (!parts || parts.join('') !== String(text)) return { error: `"${text}" is no duration – write a whole number and a unit: 30s, 15m, 24h, 7d.` };
  const counts = {};
  let last = -1;
  for (const part of parts) {
    const [, count, unit] = /^(\d+)(.*)$/.exec(part);
    const at = DURATION_UNITS.findIndex(([word]) => word === unit);
    if (at < 0) {
      if (['mo', 'M', 'y', 'Y', 'w', 'W'].includes(unit)) {
        return { error: `"${part}" – a duration has no years, months or weeks, which have no fixed length; count days: 30d.` };
      }
      return { error: unit ? `"${unit}" is no duration unit – a duration counts d, h, m and s: 30s, 15m, 24h, 7d.`
        : `"${part}" needs a unit – 30s, 15m, 24h, 7d.` };
    }
    if (at <= last) return { error: `"${text}" – write each unit once, largest first: 1d2h30m.` };
    last = at;
    counts[at] = count;
  }
  const day = counts[0] !== undefined ? `${counts[0]}D` : '';
  const time = [1, 2, 3].map((at) => (counts[at] !== undefined ? `${counts[at]}${DURATION_UNITS[at][1]}` : '')).join('');
  return { value: `P${day}${time ? `T${time}` : ''}` };
}

// The literal a stored duration is spelled as – the inverse of
// `durationFromLiteral` – or null for a value that is no duration.
function durationLiteralText(value) {
  if (durationSeconds(value) === null) return null;
  const match = DURATION_RE.exec(value);
  return DURATION_UNITS.map(([word], i) => (match[i + 1] !== undefined ? `${match[i + 1]}${word}` : '')).join('');
}

// Whether a type is a time: 'datetime', 'duration' – the built-ins, or
// a custom scalar type whose schema states the format – or null.
function timeBaseOf(model, typeName) {
  if (typeName === 'datetime' || typeName === 'duration') return typeName;
  const body = model && model['custom-type-definitions'] && model['custom-type-definitions'][typeName];
  if (!body || !body.schema || Array.isArray(body.properties) || body.schema.enum) return null;
  if (body.schema.format === 'date-time') return 'datetime';
  if (body.schema.format === 'duration') return 'duration';
  return null;
}

// What a type is underneath, as arithmetic sees it: a number's base or
// a time's – 'integer', 'number', 'datetime', 'duration' – or null.
function arithmeticBaseOf(model, typeName) {
  return numericBaseOf(model, typeName) || timeBaseOf(model, typeName);
}

// What `left operator right` yields, by the bases of its sides – or
// null when it means nothing. Numbers compute as before; a duration
// moves a datetime either way and adds to or takes from another
// duration; `min` and `max` pick one of two of a kind.
function arithmeticResultBase(operator, left, right) {
  const numeric = (base) => base === 'integer' || base === 'number';
  if (numeric(left) && numeric(right)) return left === 'integer' && right === 'integer' ? 'integer' : 'number';
  if (operator === 'min' || operator === 'max') return left && left === right ? left : null;
  if (operator === 'add' && left === 'duration' && right === 'datetime') return 'datetime';
  if ((operator === 'add' || operator === 'subtract') && right === 'duration' && (left === 'datetime' || left === 'duration')) return left;
  return null;
}

// Why a value is no value of a time type – or null, also for a type
// that is no time and for no value at all (null is "no value" here as
// everywhere).
function timeValueProblem(model, typeName, value) {
  const base = timeBaseOf(model, typeName);
  if (!base || value === null || value === undefined) return null;
  if (base === 'datetime') {
    if (datetimeInstant(value) !== null) return null;
    if (typeof value === 'string' && DATETIME_LOCAL_RE.test(value)) {
      return `${JSON.stringify(value)} has no offset, so it names no instant – add one: …Z or …+02:00.`;
    }
    return `${JSON.stringify(value)} is no datetime – RFC 3339 with an offset: 2026-01-01T10:00:00Z.`;
  }
  if (durationSeconds(value) !== null) return null;
  return `${JSON.stringify(value)} is no duration – ISO 8601 in days, hours, minutes and seconds: PT15M, P7D.`;
}

// The time values in a payload that are none – `[{name, problem}]`, a
// list's elements and a record's fields included – for whatever checks
// stored or given values: a scenario's, `replay`'s.
function payloadTimeProblems(model, properties, data) {
  const out = [];
  for (const property of properties || []) {
    if (!property || !property.name) continue;
    const held = data && typeof data === 'object' ? data[property.name] : undefined;
    const values = property.isList && Array.isArray(held) ? held : [held];
    const fields = compositeFieldsOf(model, property.propertyType);
    for (const value of values) {
      if (fields) {
        for (const field of fields) {
          const problem = value && typeof value === 'object' ? timeValueProblem(model, field.propertyType, value[field.name]) : null;
          if (problem) out.push({ name: `${property.name}.${field.name}`, problem });
        }
        continue;
      }
      const problem = timeValueProblem(model, property.propertyType, value);
      if (problem) out.push({ name: property.name, problem });
    }
  }
  return out;
}

// A value's JSON type, as a JSON Schema `type` names it: 'null',
// 'array', 'integer' (a whole number), 'number', 'string', 'boolean'
// or 'object' – never `typeof`'s word, which calls an array and null
// objects.
function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

// Whether a value is of a JSON Schema `type` – one name or a list of
// them; an integer is a number, and no type admits anything.
function fitsJsonType(type, value) {
  if (type === undefined) return true;
  const actual = jsonTypeOf(value);
  return [].concat(type).some((name) => name === actual || (name === 'number' && actual === 'integer'));
}

// The values in a payload its types refuse – `[{name, value,
// problem, type}]`, `problem` finishing "…, which <problem>.", `type`
// the type refusing it – a list's
// elements and a record's fields included (11.0). The one check of a
// value against its type: a scenario's values are held to it as a
// stored event is (`replay`, dcb.js), since a value no type admits
// would make the scenario show what cannot happen. A key the payload
// leaves out, and null, are no value to check – an optional value's
// absence, a required one's `replay` says apart; a time's format is
// `payloadTimeProblems`' to say. `wholeRecords` holds a record to
// every field it requires – a scenario's Given and When give one
// whole, its optional fields aside (11.0); a Then compares the fields
// it lists.
function payloadValueProblems(model, properties, data, { wholeRecords = false } = {}) {
  const out = [];
  const scalar = (typeName, value) => {
    const body = model['custom-type-definitions'][typeName];
    const schema = body && !Array.isArray(body.properties) ? (body.schema || { type: 'string' })
      : ['string', 'integer', 'number', 'boolean'].includes(typeName) ? { type: typeName } : null;
    if (!schema) return null;
    const type = schema.type;
    if (!fitsJsonType(type, value)) return `is no ${[].concat(type).join(' or ')}`;
    if (schema.enum !== undefined && !schema.enum.includes(value)) return `is no member of ${typeName}`;
    if (schema.minimum !== undefined && value < schema.minimum) return `is below ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `is above ${schema.maximum}`;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return `is not above ${schema.exclusiveMinimum}`;
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return `is not below ${schema.exclusiveMaximum}`;
    if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) return `is shorter than ${schema.minLength}`;
    if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) return `is longer than ${schema.maxLength}`;
    if (Array.isArray(value) && schema.minItems !== undefined && value.length < schema.minItems) return `has fewer than ${schema.minItems} items`;
    if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems) return `has more than ${schema.maxItems} items`;
    if (typeof value === 'string' && schema.pattern !== undefined) {
      let matches = true;
      try { matches = new RegExp(schema.pattern, 'u').test(value); } catch (error) { /* a broken pattern is advised elsewhere */ }
      if (!matches) return `does not match ${schema.pattern}`;
    }
    return null;
  };
  const check = (name, typeName, value) => {
    if (value === null || value === undefined) return;
    const fields = compositeFieldsOf(model, typeName);
    if (fields) {
      if (jsonTypeOf(value) !== 'object') { out.push({ name, value, problem: 'is no record', type: typeName }); return; }
      for (const field of fields) {
        const held = Object.prototype.hasOwnProperty.call(value, field.name) ? value[field.name] : undefined;
        if (wholeRecords && held === undefined && !field.isOptional) {
          out.push({ name, value, problem: `has no field "${field.name}"`, type: typeName });
          continue;
        }
        checkHeld(`${name}.${field.name}`, field, held);
      }
      return;
    }
    const problem = scalar(typeName, value);
    if (problem) out.push({ name, value, problem, type: typeName });
  };
  // A property's value: a list's each element, once it is a list.
  const checkHeld = (name, property, held) => {
    if (!property.isList) { check(name, property.propertyType, held); return; }
    if (held === null || held === undefined) return;
    if (!Array.isArray(held)) { out.push({ name, value: held, problem: 'is no list', type: `${property.propertyType}[]` }); return; }
    for (const element of held) check(name, property.propertyType, element);
  };
  for (const property of properties || []) {
    if (!property || !property.name || !data || typeof data !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(data, property.name)) continue;
    checkHeld(property.name, property, data[property.name]);
  }
  return out;
}

// What a type is underneath, as arithmetic sees it: 'integer',
// 'number', or null for anything that is no number. A scalar value
// type counts as its schema's base, as `operationsFor` counts it – an
// enum is a set of members, not a number, whatever they are spelled as.
function numericBaseOf(model, typeName) {
  if (typeName === 'integer' || typeName === 'number') return typeName;
  const body = model['custom-type-definitions'][typeName];
  if (!body || !body.schema || Array.isArray(body.properties) || body.schema.enum) return null;
  return body.schema.type === 'integer' || body.schema.type === 'number' ? body.schema.type : null;
}

// What one side of a computation is, as `{base, nullable}` – or null
// when it is no single number. A literal is what it is; a read is what
// its projection holds, and may be null while that projection starts
// at null (declared) or computes from something that may (derived). A parameter is what
// `owner` – the derived projection it belongs to – declares it as; a
// reader's null is the reader's to be warned about.
function derivedInputOf(model, operand, seen = [], owner = null) {
  if (typeof operand === 'number') return { base: Number.isInteger(operand) ? 'integer' : 'number', nullable: false };
  if (operand === null) return { base: null, nullable: true };
  // A duration literal, `24h`, and a datetime spelled as a string (11.0).
  if (operandSource(operand) === 'duration') return durationSeconds(operand.duration) === null ? null : { base: 'duration', nullable: false };
  if (typeof operand === 'string') return datetimeInstant(operand) === null ? null : { base: 'datetime', nullable: false };
  if (operandSource(operand) === 'parameter') {
    const parameter = projectionParameters(owner).find((p) => p.name === operand.parameterName);
    const base = parameter && operand.property === undefined && arithmeticBaseOf(model, parameter.type);
    return base ? { base, nullable: false } : null;
  }
  // A collection function (11.0): a count is an integer, a sum what the
  // projection holds and 0 over nothing; min, max and average are null
  // over nothing, and an average is a number.
  // A count of a list (G3) is an integer, 0 over nothing.
  if (operandSource(operand) === 'count') return { base: 'integer', nullable: false };
  if (operandSource(operand) === 'collection') {
    const read = operandRead(operand);
    const target = read && projectionsOf(model)[read.projection];
    if (operand.collect === 'count') return { base: 'integer', nullable: false };
    if (!target || target.isList || !['sum', 'min', 'max', 'average'].includes(operand.collect)) return null;
    const field = read.field !== undefined ? recordFieldType(model, target.valueType, read.field) : null;
    const held = numericBaseOf(model, field ? field.propertyType : target.valueType);
    if (!held) return null;
    return { base: operand.collect === 'average' ? 'number' : held, nullable: operand.collect !== 'sum' };
  }
  if (operandSource(operand) !== 'projection-read') return null;
  const target = projectionsOf(model)[operand.projection];
  if (!target || target.isList) return null;
  // A record's field: what that field holds, null until the record is set.
  if (operand.field !== undefined) {
    const field = recordFieldType(model, target.valueType, operand.field);
    const base = field && !field.isList && arithmeticBaseOf(model, field.propertyType);
    return base ? { base, nullable: true } : null;
  }
  const base = arithmeticBaseOf(model, target.valueType);
  if (!base) return null;
  const inner = derivedOf(target);
  if (inner) {
    if (!derivedComputes(inner) || seen.includes(operand.projection)) return { base, nullable: false };
    const sides = derivedOperands(inner).map((o) => derivedInputOf(model, o, [...seen, operand.projection], target));
    return { base, nullable: sides.some((side) => side && side.nullable) };
  }
  return { base, nullable: target.initialValue === null || target.initialValue === undefined };
}

// The type a computation yields from its two sides: an integer from two
// integers, a number from other numbers, a datetime moved by a
// duration, a duration from two (`arithmeticResultBase`) – or null
// when the sides do not compute. `owner` is the derived projection,
// whose parameters a side may name.
function derivedResultBase(model, derived, owner = null) {
  const sides = derivedOperands(derived).map((o) => derivedInputOf(model, o, [], owner));
  if (sides.some((side) => !side || !side.base)) return null;
  return arithmeticResultBase(derived.operator, sides[0].base, sides[1].base);
}

// Which experimental features a model uses, as `{feature, where}`
// pairs in a stable order – `feature` one of EXPERIMENTAL_FEATURES'
// keys, `where` the definition it was found on. The flag (shared.js)
// gates authoring them, never reading them: this is what lets a page
// say "this model uses …" instead of hiding what is stored. The line
// is drawn at what the examples on dcb.events need, see
// docs/research/2026-10-05-explicit-tags-and-aliases.md. Groups are not
// on it: a naming device with no consistency meaning has nothing to
// hide (docs/research/2026-10-28-groups-replace-entities.md). Since
// 11.0 removed scripts, guards, optional reads and `currentValue`, no
// construct of the language is on it: the flag gates views only, and
// stays as the way to stage what comes next.
const EXPERIMENTAL_FEATURES = {};

// A construct staged behind the flag is looked for here, each use
// once, in the order EXPERIMENTAL_FEATURES lists them. None is.
function experimentalFeatures(model) {
  return [];
}

// What `after` uses that `before` did not, by feature and definition –
// the experimental features an edit would introduce. A use the model
// already has is not introduced by keeping it, so an editor that does
// not offer them (WebMCP) can still edit a model that uses them.
function introducedExperimentalFeatures(before, after) {
  const keyOf = ({ feature, where }) => feature + '\u0000' + where;
  const had = new Set(experimentalFeatures(before).map(keyOf));
  return experimentalFeatures(after).filter((use) => !had.has(keyOf(use)));
}

// Both sides of a derived predicate, in evaluation order – the derived
// analogue of `conditionOperands`.
function derivedOperands(derived) {
  if (!derived) return [];
  return derivedHolds(derived) ? [derived.leftHandSide] : [derived.leftHandSide, derived.rightHandSide];
}

// Every projection read a derived value makes – a side that is one,
// and a collection function's open read (11.0) – which is what its
// query, its references and its cycles are made of.
function derivedReads(derived) {
  return derivedOperands(derived).map(operandRead).filter(Boolean);
}

// The projection read an operand makes, if any: a read in place – the
// open read of a collection function included – or none.
function operandRead(operand) {
  const source = operandSource(operand);
  if (source === 'projection-read') return operand;
  if (source === 'collection' && operandSource(operand.read) === 'projection-read') return operand.read;
  if (source === 'count') return operandRead(operand.count);
  return null;
}

// What a `count(…)` counts (11.0, G3), unwrapped – or the operand
// itself: where a walker looks for reads, names and fields, a count is
// what it counts.
function uncounted(operand) {
  return operandSource(operand) === 'count' ? uncounted(operand.count) : operand;
}

// A read's tags that are left open (`*`, 11.0), by name.
function openTagNames(read) {
  return readTagEntries(read).filter(([, value]) => operandSource(value) === 'open').map(([name]) => name);
}

// What a reader of this projection supplies besides tags: its
// arguments, `{name, propertyType}` – the values after the tags in
// `X(courseId, 14)` (10.0). A derived projection compares or computes
// with them or passes them on; a declared projection's handlers cannot
// see them, which the advisories say.
function projectionSlots(projection) {
  return (projection && Array.isArray(projection.arguments) ? projection.arguments : [])
    .filter((argument) => argument && typeof argument === 'object');
}

// Every parameter a read of this projection gives, tags then
// arguments, as `{name, type, isTag}` – the one list the editor and the
// text show, and what a derived operand's `{parameterName}` may name.
function projectionParameters(projection) {
  return [
    ...projectionTagParams(projection).map((tag) => ({ name: tag.name, type: tag.tagType, isTag: true })),
    ...projectionSlots(projection).map((slot) => ({ name: slot.name, type: slot.propertyType, isTag: false })),
  ];
}

// The tags a projection is read by, `[{name, tagType}]`, in declaration
// order – one value per entry in every read of it, each keyed by its
// declared type. Empty is an *untagged* projection, which folds the
// whole log: a numbering is the case. Several are ANDed, as a DCB query
// item's tags are. A body that states none reads as untagged; every
// writer here states the list, and the text says `untagged` outright.
function projectionTagParams(projection) {
  return (projection && Array.isArray(projection.tags) ? projection.tags : [])
    .filter((tag) => tag && typeof tag === 'object');
}

// The tag types one projection's query is narrowed by – the leaves of
// its declared tag types, a record's tag-marked fields included.
function projectionTagTypes(model, projectionName) {
  const projection = projectionsOf(model)[projectionName];
  return uniq(projectionTagParams(projection)
    .flatMap((tag) => idLeavesOfType(model, tag.tagType).map((leaf) => leaf.identifierType)));
}

// A read's values, `[[name, operand]]` in the order held – the tags,
// keyed by the names the projection declares.
function readTagEntries(read) {
  const tags = read && read.tags;
  return tags && typeof tags === 'object' && !Array.isArray(tags) ? Object.entries(tags) : [];
}

function readTagOperands(read) {
  return readTagEntries(read).map(([, operand]) => operand);
}

// The read a group alias's member stands for: `course.capacity`, with
// `course` bound as `Course(courseId)`, is `Course(courseId).capacity` –
// the qualified projection, the binding's tags, the operand's own
// arguments. Validation, the derived query and the fold all go through
// this, so a member read and a read in place cannot disagree.
function groupMemberRead(binding, operand) {
  return {
    projection: qualifiedProjectionName(binding.group, operand.property),
    tags: (binding && binding.tags && typeof binding.tags === 'object' && !Array.isArray(binding.tags)) ? binding.tags : {},
    arguments: (operand.arguments && typeof operand.arguments === 'object') ? operand.arguments : {},
  };
}

// What a bare literal of this type looks like at runtime – the shape an
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

// The operations that make sense for a projection's type. A scalar
// value type counts as what its schema says it is underneath, so
// `Hours` over an integer counts like the integer it replaced – wrapping
// a primitive in a named type must not cost it its operations.
function operationsFor(model, target) {
  if (target.isList) return ['set', 'append', 'remove'];
  if (literalKindOf(model, target.valueType) === 'number') return ['set', 'increment', 'decrement'];
  return ['set'];
}

// Whether a value of this type has a *next* one – which is what decides
// whether "the one after …" is worth offering as a handler operand.
//
// A scalar value type, tag-marked or not, is a string underneath, so it
// counts up. An enum does not: its members are a set, and "the next
// member" means nothing. Neither does a boolean.
//
// Extracted so the editors offering the operand and the validator
// refusing it read the same rule off the same line. They did not, and
// the projection editor offered "the one after true" on a boolean fold –
// a choice that stored fine and then failed validation.
function hasSuccessor(model, valueType) {
  const cls = classifyType(model, valueType);
  const underlying = cls.kind === 'simple' ? valueType
    : (enumMembersFor(model, valueType) ? 'enum' : 'string');
  return underlying === 'integer' || underlying === 'string';
}

// Whether an editor *offers* "successor" for a value of this type –
// narrower than `hasSuccessor`, which is what the validator accepts.
// Every successor the shipped models carry numbers something: the next
// course id, the next course number. A plain `string` has one only by
// accident of ending in digits, and offering it put "the one after the
// title" beside every text field; an integer or a named scalar value
// type – an id, a number – is what a numbering is made of. A stored
// successor outside this rule still validates and still runs.
function offersSuccessor(model, valueType) {
  if (!hasSuccessor(model, valueType)) return false;
  if (valueType === 'integer') return true;
  const cls = classifyType(model, valueType);
  return cls.kind === 'value' && !cls.composite;
}

// ============================================================
// Command steps (11.0).
//
// A command's body is one ordered list, `steps`, run top-down:
//
//   {condition, rejection}            a rule – `require c else reject "m"`
//   {name, parameters}                an emission – `emit E { … }`
//   {branches: [{condition, steps}], otherwise?: steps}
//                                     `if c => … else if c => … else => …`
//   {reject: "m"}                     `reject "m"`, inside a branch
//   {forEach: [names], in: source, steps}
//                                     `for each x in source => …` – a
//                                     fan-out emit, below
//
// Any rejection – a rule that does not hold, or a `reject` reached –
// aborts the command with no events; the emissions reached on the way
// form its one append, and reaching none is publishing nothing. Separate
// branch steps all run; one branch step runs its first arm whose
// condition holds, else `otherwise`, else nothing. A rule is the
// shorthand `if not c => reject "m"`, kept as its own step because it
// is the common case and reads as one.
//
// A condition is a predicate (`UnaryCondition` / `BinaryCondition`, the
// leaf) or a combination, `{all: [c, …]}` (`and`) or `{any: [c, …]}`
// (`or`). The leaf is what every analysis of one comparison – types,
// fan roots, zipping, enum members – reads (`conditionLeaves`).
//
// Before 11.0 a command had `conditions` (every rule, all checked first)
// and `publishes` (every emission, published together); `stepsFrom`
// writes that as steps – the rules in order, then the emissions in
// order – which is exactly how it evaluated.
//
// **A fan-out emit** (`{forEach, in, steps}`, a *loop*) runs its steps
// once per element of its source – an open read `P(x, *)`, a list
// projection or a list parameter – in source order: list order, or
// the order of each instance's first event. `forEach` names the
// element, one name per open tag of an open read and one for a list;
// inside, each name is in scope as a parameter is (`{parameterName}`),
// and over an open read `value` (`{instanceValue}`) is the instance's
// value. Its steps are emissions and branches whose arms each hold one
// emission or one `reject` – which refuses the whole command, as any
// does. Zero elements emit nothing, and a loop never nests in another.
// A read inside reads by the element, so each element adds its own
// reads to the run's boundary; walkers see the loop's steps as the
// steps of an arm keyed `each` (`[2, 'each', 0]`).
// ============================================================

// What a step is, by the key that tells it apart – the way a binding is
// told apart by `group` or `projection`. Null for anything else.
function stepKind(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
  if (step.forEach !== undefined) return 'loop';
  if (step.branches !== undefined) return 'branch';
  if (step.reject !== undefined) return 'reject';
  if (step.condition !== undefined) return 'rule';
  if (step.name !== undefined) return 'emit';
  return null;
}

function commandSteps(body) {
  return (body && Array.isArray(body.steps)) ? body.steps : [];
}

// A branch step's arms, `otherwise` last as an arm without a condition.
function stepArms(step) {
  const arms = (Array.isArray(step && step.branches) ? step.branches : [])
    .filter((arm) => arm && typeof arm === 'object')
    .map((arm, index) => ({ index, condition: arm.condition, steps: Array.isArray(arm.steps) ? arm.steps : [] }));
  if (step && step.otherwise !== undefined) {
    arms.push({ index: 'otherwise', condition: undefined, steps: Array.isArray(step.otherwise) ? step.otherwise : [] });
  }
  return arms;
}

// A loop's parts: the names it binds, its source and its steps.
function loopNames(step) {
  return (step && Array.isArray(step.forEach) ? step.forEach : []).filter((name) => typeof name === 'string');
}
function loopSteps(step) {
  return (step && Array.isArray(step.steps)) ? step.steps : [];
}

// Every step, depth first in written order: `visit(step, at)`, `at` the
// step's path (`[2, 0, 1]`: the first arm of step 2, its step 1 –
// `'otherwise'` for the else arm, `'each'` for a loop's steps), `depth`,
// 0 at the top, and `loop`, the loop it runs in, or null.
function forEachStep(steps, visit, path = [], loop = null) {
  (Array.isArray(steps) ? steps : []).forEach((step, index) => {
    const at = [...path, index];
    visit(step, { path: at, depth: path.length / 2, loop });
    const kind = stepKind(step);
    if (kind === 'loop') { forEachStep(loopSteps(step), visit, [...at, 'each'], step); return; }
    if (kind !== 'branch') return;
    for (const arm of stepArms(step)) forEachStep(arm.steps, visit, [...at, arm.index], loop);
  });
}

function stepsOfKind(body, kind) {
  const out = [];
  forEachStep(commandSteps(body), (step) => { if (stepKind(step) === kind) out.push(step); });
  return out;
}

// Every rule, emission and branch step, wherever it sits.
function commandRules(body) { return stepsOfKind(body, 'rule'); }
function commandEmissions(body) { return stepsOfKind(body, 'emit'); }
function commandBranchSteps(body) { return stepsOfKind(body, 'branch'); }
function commandLoops(body) { return stepsOfKind(body, 'loop'); }

// What a loop's names hold, `[{name, propertyType, isOptional: false,
// isList: false}]` – a payload property's shape, since inside the loop
// each is read as one: the tag type of each open tag of an open read,
// in the projection's order, or the element type of a list. A name
// whose type cannot be worked out is left out.
function loopVariables(model, body, loop) {
  const names = loopNames(loop);
  const source = loop && loop.in;
  const as = (name, propertyType) => ({ name, propertyType, isOptional: false, isList: false });
  if (operandSource(source) === 'projection-read' && openTagNames(source).length) {
    const projection = projectionsOf(model)[source.projection];
    const open = projectionTagParams(projection).filter((tag) => openTagNames(source).includes(tag.name));
    return names.map((name, i) => (open[i] ? as(name, open[i].tagType) : null)).filter(Boolean);
  }
  const resolved = resolveOperandType(source, { boundary: (body && body.boundary) || [], commandProperties: (body && body.properties) || [], model });
  if (!resolved || !resolved.isList || names.length !== 1) return [];
  return [as(names[0], resolved.propertyType)];
}

// The type `value` holds inside a loop over an open read – the
// projection's value type – or null where there is no `value`.
function loopValueType(model, loop) {
  const source = loop && loop.in;
  if (operandSource(source) !== 'projection-read' || !openTagNames(source).length) return null;
  const projection = projectionsOf(model)[source.projection];
  return projection ? { propertyType: projection.valueType, isList: !!projection.isList } : null;
}

// The names a command's operands may read as parameters: its payload,
// and inside `loop` that loop's names too. Without a loop, every
// loop's – for a caller that types an operand without knowing where it
// sits; a name is one loop's only (an advisory says so otherwise).
function commandScopeProperties(model, body, loop) {
  const own = (body && Array.isArray(body.properties)) ? body.properties : [];
  const loops = loop === undefined ? commandLoops(body) : loop ? [loop] : [];
  const extra = loops.flatMap((one) => loopVariables(model, body, one))
    .filter((variable) => !own.some((p) => p && p.name === variable.name));
  return extra.length ? [...own, ...extra] : own;
}

// Whether a parameter operand names a loop's element rather than the
// payload.
function namesLoopVariable(body, operand) {
  if (operandSource(operand) !== 'parameter') return false;
  if ((body && body.properties || []).some((p) => p && p.name === operand.parameterName)) return false;
  return commandLoops(body).some((loop) => loopNames(loop).includes(operand.parameterName));
}

// The steps written at the top, of one kind – what the pages edit.
function topLevelSteps(body, kind) {
  return commandSteps(body).filter((step) => stepKind(step) === kind);
}

function commandHasBranches(body) {
  return commandSteps(body).some((step) => stepKind(step) === 'branch');
}

// An arm's key, as evaluation reports the arms it took: the branch
// step's path, then the arm – `2/0`, `2/otherwise`, `2/0/1/1`.
function armKey(path, arm) {
  return [...path, arm].join('/');
}

// The pre-11.0 body, as steps: the rules in order, then the emissions.
// A rule moves its message out of the condition beside it.
function stepsFrom(conditions, publishes) {
  const rules = (Array.isArray(conditions) ? conditions : []).filter(Boolean).map((rule) => {
    const { rejection, ...condition } = rule;
    return rejection === undefined ? { condition } : { condition, rejection };
  });
  // An empty guard said nothing, and was read as none.
  const emissions = (Array.isArray(publishes) ? publishes : []).filter(Boolean).map((emission) => {
    if (!Array.isArray(emission.when) || emission.when.length) return emission;
    const { when, ...rest } = emission;
    return rest;
  });
  return [...rules, ...emissions];
}

// The pages' view of a command, and its way back (11.0). The visual
// editors edit two lists, as before steps: the rules written at the top
// – each flat, its condition with the `rejection` beside it – and the
// emissions written at the top. Everything else stays where it is:
// `withCommandLists` puts the edited lists back into the slots they
// came from, in order, so a branch is never flattened or dropped by an
// edit that did not touch it. A rule added goes after the last rule (or
// first, when there was none), an emission added goes last, and a
// removed one gives up the last slot of its kind.
function commandLists(body) {
  const steps = commandSteps(body);
  return {
    conditions: steps.filter((step) => stepKind(step) === 'rule')
      .map((rule) => (rule.rejection === undefined ? { ...rule.condition } : { ...rule.condition, rejection: rule.rejection })),
    publishes: steps.filter((step) => stepKind(step) === 'emit'),
  };
}

function withCommandLists(steps, conditions, publishes) {
  const rules = (conditions || []).filter(Boolean).map((flat) => {
    const { rejection, ...condition } = flat;
    return rejection === undefined ? { condition } : { condition, rejection };
  });
  const emissions = (publishes || []).filter(Boolean);
  const out = [];
  let lastRule = -1;
  for (const step of Array.isArray(steps) ? steps : []) {
    const kind = stepKind(step);
    if (kind === 'rule') {
      if (rules.length) { out.push(rules.shift()); lastRule = out.length - 1; }
      continue;
    }
    if (kind === 'emit') {
      if (emissions.length) out.push(emissions.shift());
      continue;
    }
    out.push(step);
  }
  out.splice(lastRule + 1, 0, ...rules);
  out.push(...emissions);
  return out;
}

// ---------- editing steps where they sit ----------
//
// The pages edit a branch, its arms and a loop in place (11.0): each
// edit names where it acts by a *path* – a step's, `[2]` or `[2, 0, 1]`
// (the first arm of step 2, its step 1), or a list's, the same path
// without the last index (`[]` the top, `[2, 'otherwise']`, `[3,
// 'each']`), which is how `forEachStep` names them – and changes that
// one place in a body the caller already cloned. Everything else stays
// as it was, so an edit never flattens or reorders what it did not
// touch. These are the editors' half; the write is `updateDefinition`,
// one append like any edit.

// The list of steps `listPath` names, created where a list was missing
// – or null where the path leads nowhere.
function stepListAt(body, listPath) {
  if (!Array.isArray(body.steps)) body.steps = [];
  let list = body.steps;
  for (let k = 0; k < listPath.length; k += 2) {
    const step = list[listPath[k]];
    const arm = listPath[k + 1];
    const kind = stepKind(step);
    if (arm === 'each' && kind === 'loop') {
      if (!Array.isArray(step.steps)) step.steps = [];
      list = step.steps;
    } else if (arm === 'otherwise' && kind === 'branch' && step.otherwise !== undefined) {
      if (!Array.isArray(step.otherwise)) step.otherwise = [];
      list = step.otherwise;
    } else if (typeof arm === 'number' && kind === 'branch' && step.branches[arm]) {
      if (!Array.isArray(step.branches[arm].steps)) step.branches[arm].steps = [];
      list = step.branches[arm].steps;
    } else {
      return null;
    }
  }
  return list;
}

function stepAtPath(body, path) {
  const list = stepListAt(body, path.slice(0, -1));
  return list ? list[path[path.length - 1]] || null : null;
}

// Adds `step` to the list at `listPath`, at `index` (the end without
// one).
function insertStepAt(body, listPath, step, index) {
  const list = stepListAt(body, listPath);
  if (!list) return;
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, step);
}

function replaceStepAt(body, path, step) {
  const list = stepListAt(body, path.slice(0, -1));
  if (list && list[path[path.length - 1]] !== undefined) list[path[path.length - 1]] = step;
}

function removeStepAt(body, path) {
  const list = stepListAt(body, path.slice(0, -1));
  if (list) list.splice(path[path.length - 1], 1);
}

// One place earlier (`delta` -1) or later (+1) in its own list.
function moveStepAt(body, path, delta) {
  const list = stepListAt(body, path.slice(0, -1));
  const from = path[path.length - 1];
  const to = from + delta;
  if (!list || to < 0 || to >= list.length) return;
  const [step] = list.splice(from, 1);
  list.splice(to, 0, step);
}

// The arms of the branch at `path`: a condition and the steps it
// runs. Added before `else`, which stays last; the last conditional
// arm removed takes the branch with it – an `else` alone is no branch.
function addBranchArm(body, path, condition, steps = []) {
  const branch = stepAtPath(body, path);
  if (stepKind(branch) !== 'branch') return;
  branch.branches.push({ condition, steps });
}

function setArmCondition(body, path, arm, condition) {
  const branch = stepAtPath(body, path);
  if (stepKind(branch) === 'branch' && branch.branches[arm]) branch.branches[arm].condition = condition;
}

function removeBranchArm(body, path, arm) {
  const branch = stepAtPath(body, path);
  if (stepKind(branch) !== 'branch') return;
  if (arm === 'otherwise') { delete branch.otherwise; return; }
  branch.branches.splice(arm, 1);
  if (!branch.branches.length) removeStepAt(body, path);
}

function moveBranchArm(body, path, arm, delta) {
  const branch = stepAtPath(body, path);
  if (stepKind(branch) !== 'branch') return;
  const to = arm + delta;
  if (to < 0 || to >= branch.branches.length) return;
  const [moved] = branch.branches.splice(arm, 1);
  branch.branches.splice(to, 0, moved);
}

// `else` added with nothing in it yet, or taken away.
function setBranchOtherwise(body, path, present) {
  const branch = stepAtPath(body, path);
  if (stepKind(branch) !== 'branch') return;
  if (present && branch.otherwise === undefined) branch.otherwise = [];
  if (!present) delete branch.otherwise;
}

// A step moved into an arm, or out of one, everything else staying
// where it was (11.0). The lists are found before the step leaves its
// own, so a path that shifts as it leaves still names the same list,
// and a step is never moved into itself. Into an arm, a step from
// before the branch goes first in the arm and one from after it last –
// in and back out again, it lands where it was; out of one, the arm's
// first step goes just before the branch and any other just after it
// (a lone one by its kind: a rule before, the rest after), so moving
// several out one by one keeps their order.
function moveStepIntoArm(body, fromPath, armListPath) {
  const from = fromPath.slice(0, -1);
  const at = fromPath[fromPath.length - 1];
  if (armListPath.length >= fromPath.length && fromPath.every((index, k) => armListPath[k] === index)) return;
  const target = stepListAt(body, armListPath);
  const source = stepListAt(body, from);
  if (!target || !source || source[at] === undefined) return;
  const holds = armListPath.length > from.length && from.every((index, k) => armListPath[k] === index);
  const first = holds && at < armListPath[from.length];
  const [step] = source.splice(at, 1);
  if (first) target.unshift(step); else target.push(step);
}

function moveStepOutOfArm(body, fromPath) {
  const branchPath = fromPath.slice(0, -2);
  if (!branchPath.length || stepKind(stepAtPath(body, branchPath)) !== 'branch') return;
  const arm = stepListAt(body, fromPath.slice(0, -1));
  const outer = stepListAt(body, branchPath.slice(0, -1));
  const at = fromPath[fromPath.length - 1];
  if (!arm || !outer || arm[at] === undefined) return;
  const branch = stepAtPath(body, branchPath);
  const before = arm.length === 1 ? stepKind(arm[at]) === 'rule' : at === 0;
  const [step] = arm.splice(at, 1);
  outer.splice(outer.indexOf(branch) + (before ? 0 : 1), 0, step);
}

// The arms a top-level step may move into: every arm of a branch not
// inside a loop – a loop's arms hold one emit or one reject – as the
// path of its list and its words.
function armTargets(body) {
  const out = [];
  forEachStep(commandSteps(body), (step, { path, loop }) => {
    if (loop || stepKind(step) !== 'branch') return;
    for (const arm of stepArms(step)) {
      const words = arm.index === 'otherwise' ? 'else' : `${arm.index ? 'else if' : 'if'} ${conditionText(arm.condition)}`;
      out.push({ listPath: [...path, arm.index], words, depth: path.length / 2 });
    }
  });
  return out;
}

// A loop's head changed where it stands (11.0): its source, its names,
// or both. Each element is stored as a parameter reference
// (`{parameterName}`), so a name renamed is the command property's
// rename held to the loop: every reference its steps make follows –
// in a condition, an emission's field, a read's tags, a `where` – and
// one outside the loop, which reads a payload property of that name,
// stays. `names` are the new names in the loop's order; one missing
// keeps its name.
function setLoopHead(body, path, { names, source } = {}) {
  const loop = stepAtPath(body, path);
  if (stepKind(loop) !== 'loop') return;
  if (Array.isArray(names)) {
    const previous = loopNames(loop);
    const renames = new Map(previous.map((name, i) => [name, names[i]]).filter(([from, to]) => to && from !== to));
    if (renames.size) {
      forEachCommandOperand(body, (operand, meta) => {
        if (meta.loop !== loop || meta.loopSource) return;
        if (operandSource(operand) === 'parameter' && renames.has(operand.parameterName)) {
          operand.parameterName = renames.get(operand.parameterName);
        }
      });
    }
    loop.forEach = names.map((name, i) => name || previous[i]).filter(Boolean);
  }
  if (source !== undefined) loop.in = source;
}

// The names a loop's steps read, of those it gives – a name no step
// reads may go when its source changes; one read may not.
function loopNamesRead(body, path) {
  const loop = stepAtPath(body, path);
  const read = new Set();
  if (stepKind(loop) !== 'loop') return read;
  const names = loopNames(loop);
  forEachCommandOperand(body, (operand, meta) => {
    if (meta.loop === loop && !meta.loopSource && operandSource(operand) === 'parameter' && names.includes(operand.parameterName)) {
      read.add(operand.parameterName);
    }
  });
  return read;
}

// Where a new branch or loop goes at the top: after every step that
// decides – before the first emission written after them – so it reads
// in the order the code view prints: rules, then branches, then what
// is recorded.
function newStepIndex(body, kind) {
  const steps = commandSteps(body);
  if (kind === 'loop') return steps.length;
  let at = steps.length;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (stepKind(steps[i]) === 'emit') at = i; else break;
  }
  return at;
}

// A condition as the pages edit it: its comparisons in one list, and
// what joins them – `all` (and), `any` (or), null for one comparison.
// Null for a condition that nests a group in a group – the tree
// helpers below (`withConditionNode`) edit that.
function flatCondition(condition) {
  if (!condition || typeof condition !== 'object') return null;
  if (!isCompoundCondition(condition)) return { joiner: null, members: [condition] };
  const members = conditionMembers(condition);
  if (members.some(isCompoundCondition)) return null;
  return { joiner: Array.isArray(condition.all) ? 'all' : 'any', members };
}

// And back: one comparison stands alone, more are joined. A joiner is
// given whenever there is more than one.
function joinedCondition(joiner, members) {
  const kept = members.filter(Boolean);
  if (kept.length === 1) return kept[0];
  return { [joiner || 'all']: kept };
}

// The condition with one comparison replaced, added (with `joiner`
// when it was one comparison) or removed.
function withConditionMember(condition, index, member, joiner) {
  const flat = flatCondition(condition);
  if (!flat) return condition;
  const members = [...flat.members];
  if (index === null || index >= members.length) members.push(member);
  else members[index] = member;
  return joinedCondition(flat.joiner || joiner, members);
}

function withoutConditionMember(condition, index) {
  const flat = flatCondition(condition);
  if (!flat || flat.members.length < 2) return condition;
  return joinedCondition(flat.joiner, flat.members.filter((_, i) => i !== index));
}

// A condition as a tree, for the editors that write a group inside a
// group (`a and (b or c)`): a node is named by the member indices
// leading to it – `[]` the whole, `[1, 0]` the first member of its
// second. Each returns a new condition and leaves the one given alone.
// The tree is never normalised behind the author's back: a group stays
// the group it was written as, and only a group left with one member
// becomes that member – `(b)` says nothing `b` does not, and the code
// view cannot print it.
function conditionJoiner(node) {
  return isCompoundCondition(node) ? (Array.isArray(node.all) ? 'all' : 'any') : null;
}

function conditionNodeAt(condition, path) {
  let node = condition;
  for (const index of path) {
    if (!isCompoundCondition(node)) return null;
    node = conditionMembers(node)[index];
    if (node === undefined) return null;
  }
  return node;
}

// The node at `path` replaced by `node`, or removed with null – a group
// left with one member becomes it, one left with none goes too.
function withConditionNode(condition, path, node) {
  if (!path.length) return node === undefined ? null : node;
  if (!isCompoundCondition(condition)) return condition;
  const [head, ...rest] = path;
  const members = [...conditionMembers(condition)];
  if (members[head] === undefined) return condition;
  const replaced = withConditionNode(members[head], rest, node);
  if (replaced === null) members.splice(head, 1); else members[head] = replaced;
  if (!members.length) return null;
  if (members.length === 1) return members[0];
  return { [conditionJoiner(condition)]: members };
}

// A comparison joined to the node at `path` by `joiner`: added to it
// when it is a group joined that way, else bracketed with it in a new
// group – `[]` joins the whole condition, a comparison's path brackets
// that comparison (`a and (b or c)`).
function withConditionJoined(condition, path, joiner, leaf) {
  const node = conditionNodeAt(condition, path);
  if (node === null || node === undefined) return condition;
  const joined = conditionJoiner(node) === joiner
    ? { [joiner]: [...conditionMembers(node), leaf] }
    : { [joiner]: [node, leaf] };
  return withConditionNode(condition, path, joined);
}

// ---------- conditions ----------

function isCompoundCondition(condition) {
  return !!condition && typeof condition === 'object' && !Array.isArray(condition)
    && (Array.isArray(condition.all) || Array.isArray(condition.any));
}

function conditionMembers(condition) {
  if (!isCompoundCondition(condition)) return [];
  return (Array.isArray(condition.all) ? condition.all : condition.any).filter(Boolean);
}

// The predicates a condition is made of, in written order.
function conditionLeaves(condition, out = []) {
  if (!condition || typeof condition !== 'object') return out;
  if (isCompoundCondition(condition)) {
    for (const part of conditionMembers(condition)) conditionLeaves(part, out);
    return out;
  }
  out.push(condition);
  return out;
}

// A rule step's condition, or a pre-11.0 rule (the condition itself,
// carrying its `rejection`) – the editors still hold that flat shape.
function ruleCondition(rule) {
  if (!rule || typeof rule !== 'object') return null;
  return rule.condition !== undefined ? rule.condition : rule;
}

// Every condition a command states – its rules' and its arms' – as
// `visit(condition, where)`, `where` the rule or the arm it guards.
function forEachCommandCondition(body, visit) {
  forEachStep(commandSteps(body), (step, at) => {
    const kind = stepKind(step);
    if (kind === 'rule' && step.condition) visit(step.condition, { step, ...at });
    if (kind !== 'branch') return;
    (step.branches || []).forEach((arm) => {
      if (arm && arm.condition) visit(arm.condition, { step, arm, ...at });
    });
  });
}

// Every predicate a command states, whichever condition holds it.
function commandConditionLeaves(body) {
  const out = [];
  forEachCommandCondition(body, (condition) => conditionLeaves(condition, out));
  return out;
}

// Every rejection message a command can be refused with, in written
// order – its rules' and its `reject`s'.
function commandRejectionSteps(body) {
  const out = [];
  forEachStep(commandSteps(body), (step) => {
    const kind = stepKind(step);
    if (kind === 'rule') out.push({ step, rejection: step.rejection, text: conditionText(step.condition) });
    if (kind === 'reject') out.push({ step, rejection: step.reject, text: `reject ${JSON.stringify(step.reject)}` });
  });
  return out;
}

// A body's steps rebuilt by `map(step) → step`, depth first – the
// rewrites that rename an event or move a read go through here, so a
// branch is never left behind.
function mapSteps(steps, map) {
  return (Array.isArray(steps) ? steps : []).map((step) => {
    if (stepKind(step) === 'loop') return map({ ...step, steps: mapSteps(loopSteps(step), map) });
    if (stepKind(step) !== 'branch') return map(step);
    const out = { ...step };
    if (Array.isArray(step.branches)) {
      out.branches = step.branches.map((arm) => (arm && typeof arm === 'object'
        ? { ...arm, steps: mapSteps(arm.steps, map) } : arm));
    }
    if (step.otherwise !== undefined) out.otherwise = mapSteps(step.otherwise, map);
    return map(out);
  });
}

// A condition rebuilt leaf by leaf.
function mapConditionLeaves(condition, map) {
  if (isCompoundCondition(condition)) {
    const key = Array.isArray(condition.all) ? 'all' : 'any';
    return { ...condition, [key]: condition[key].map((part) => mapConditionLeaves(part, map)) };
  }
  return condition ? map(condition) : condition;
}

// ---------- a handler's branches (11.0) ----------
//
// `on E => op` is `{event, operation, value}`. `on E { … }` is `{event,
// steps}`: each step one `if` chain, `{branches: [{condition,
// operation, value}], otherwise?: {operation, value}}` – the command's
// branch step with one operation where a command's arm holds steps.
// Separate steps all apply, in order (a self-transfer decrements, then
// increments); a chain applies its first arm whose condition holds, or
// `otherwise`, or nothing. One operation per arm: a second would act on
// the same value, so it is a second `if`.
//
// A condition is a command's condition over a narrower vocabulary: a
// leaf compares an event field – `{eventProperty}`, or `{eventProperty,
// property}` for a field of a record – with `equals` (negated: `!=`)
// against one of the projection's own tags, `{parameterName}`, or a
// literal, and leaves join with `all` / `any`. It reads neither another
// projection nor the projection's own state, so a fold stays
// self-contained – and it never narrows the query: the events a
// projection is read from are the same, branched or not.

function isConditionalHandler(handler) {
  return !!handler && typeof handler === 'object' && handler.steps !== undefined;
}

// A conditional handler's chains, as stored – those that are objects.
function handlerChains(handler) {
  if (!isConditionalHandler(handler) || !Array.isArray(handler.steps)) return [];
  return handler.steps.filter((step) => step && typeof step === 'object' && !Array.isArray(step));
}

// Every operation a handler may apply, in written order, as arms:
// `{event, operation, value, condition, chain, index, otherwise,
// guard}` – `chain` the step's index (null for an unconditional
// handler), `index` the arm's in its chain or 'otherwise', `guard` the
// words it is applied under (`if …`, `else if …`, `else`, or '' for
// none), `holder` the stored object carrying `operation` and `value`.
function handlerArms(handler) {
  if (!handler || typeof handler !== 'object') return [];
  if (!isConditionalHandler(handler)) {
    return [{ event: handler.event, operation: handler.operation, value: handler.value, condition: undefined,
      chain: null, index: null, otherwise: false, guard: '', holder: handler }];
  }
  const out = [];
  handlerChains(handler).forEach((step, chain) => {
    (Array.isArray(step.branches) ? step.branches : []).forEach((arm, index) => {
      if (!arm || typeof arm !== 'object') return;
      out.push({ event: handler.event, operation: arm.operation, value: arm.value, condition: arm.condition,
        chain, index, otherwise: false,
        guard: `${index ? 'else if' : 'if'} ${conditionText(arm.condition)}`, holder: arm });
    });
    const other = step.otherwise;
    if (other && typeof other === 'object' && !Array.isArray(other)) {
      out.push({ event: handler.event, operation: other.operation, value: other.value, condition: undefined,
        chain, index: 'otherwise', otherwise: true, guard: 'else', holder: other });
    }
  });
  return out;
}

// Every condition a handler states, chain by chain.
function handlerConditions(handler) {
  return handlerArms(handler).map((arm) => arm.condition).filter((condition) => condition !== undefined);
}

// Every comparison a handler's conditions are made of.
function handlerConditionLeaves(handler) {
  const out = [];
  for (const condition of handlerConditions(handler)) conditionLeaves(condition, out);
  return out;
}

// Whether a projection's handlers branch anywhere – what the pages show
// read-only and leave the code view to edit.
function handlersBranch(handlers) {
  return (Array.isArray(handlers) ? handlers : []).some(isConditionalHandler);
}

// The type of the event field a handler's condition reads – a
// property's, or a record field's one hop in – or null.
function handlerFieldType(model, eventName, operand) {
  if (operandSource(operand) !== 'event-property') return null;
  const event = model['event-definitions'][eventName];
  const property = event && (event.properties || []).find((p) => p && p.name === operand.eventProperty);
  if (!property) return null;
  if (operand.property === undefined) return property.propertyType;
  const field = (compositeFieldsOf(model, property.propertyType) || []).find((f) => f && f.name === operand.property);
  return field ? field.propertyType : null;
}

// ---------- what a condition says about optional parameters ----------
//
// Inside `if x is not empty`, and after `require x is not empty`, an
// optional parameter `x` holds a value – so emitting it into a required
// field, or reading by it, is no hazard there. `conditionPresence` is
// what holding a condition says (`x is not empty`), `conditionAbsence`
// what failing it says (`x is empty` failing): both the parameters they
// prove present. `and` proves what any part proves, `or` only what
// every part does – and the reverse when the condition fails.
function presentWhen(leaf, holds) {
  if (!leaf || operandSource(leaf.leftHandSide) !== 'parameter' || leaf.leftHandSide.property !== undefined) return [];
  const notEmpty = leaf.predicate === 'isNotEmpty' ? !leaf.negate
    : leaf.predicate === 'isEmpty' ? !!leaf.negate : null;
  if (notEmpty === null) return [];
  return notEmpty === holds ? [leaf.leftHandSide.parameterName] : [];
}

function conditionPresence(condition, holds = true) {
  if (!isCompoundCondition(condition)) return new Set(presentWhen(condition, holds));
  const parts = conditionMembers(condition).map((part) => conditionPresence(part, holds));
  // and-holds and or-fails: every part did; or-holds and and-fails: one did.
  const every = Array.isArray(condition.all) === holds;
  if (every) return new Set(parts.flatMap((set) => [...set]));
  if (!parts.length) return new Set();
  return new Set([...parts[0]].filter((name) => parts.every((set) => set.has(name))));
}

// Each predicate of a condition with what is present when it is
// checked: an `and` checks its parts in order and stops at the first
// that fails, so a later part leans on what the earlier ones proved.
function forEachLeafPresence(condition, present, visit) {
  if (!isCompoundCondition(condition)) { if (condition) visit(condition, present); return; }
  let now = new Set(present);
  for (const part of conditionMembers(condition)) {
    forEachLeafPresence(part, now, visit);
    if (Array.isArray(condition.all)) now = new Set([...now, ...conditionPresence(part, true)]);
    else now = new Set([...now, ...conditionPresence(part, false)]);
  }
}

// Walks the steps with what is known present at each one:
// `visit(step, present, at)`, and `onCondition(condition, present)` for
// each condition as it is reached. Returns what is present after the
// steps, or null when every path through them rejects.
function walkPresence(steps, visit, present = new Set(), onCondition = () => {}, path = []) {
  let now = new Set(present);
  for (let index = 0; index < (Array.isArray(steps) ? steps.length : 0); index++) {
    const step = steps[index];
    const at = [...path, index];
    const kind = stepKind(step);
    visit(step, now, at);
    if (kind === 'reject') return null;
    if (kind === 'rule') {
      onCondition(step.condition, now);
      // A rule's own `and`: what its earlier parts prove, its later parts
      // may lean on – checked in written order, and stopped at the first
      // that fails.
      for (const name of conditionPresence(step.condition, true)) now.add(name);
      continue;
    }
    // A loop may run no time at all: what it proves stays inside it.
    if (kind === 'loop') { walkPresence(loopSteps(step), visit, now, onCondition, [...at, 'each']); continue; }
    if (kind !== 'branch') continue;
    const outcomes = [];
    let fallThrough = new Set(now);
    for (const arm of stepArms(step)) {
      const entering = new Set(fallThrough);
      if (arm.condition !== undefined) {
        onCondition(arm.condition, fallThrough);
        for (const name of conditionPresence(arm.condition, true)) entering.add(name);
        for (const name of conditionPresence(arm.condition, false)) fallThrough.add(name);
      }
      const after = walkPresence(arm.steps, visit, entering, onCondition, [...at, arm.index]);
      if (after) outcomes.push(after);
    }
    if (step.otherwise === undefined) outcomes.push(fallThrough);
    if (!outcomes.length) return null;
    now = new Set([...outcomes[0]].filter((name) => outcomes.every((set) => set.has(name))));
  }
  return now;
}

// Walks every operand inside a command body – and into every inline
// projection read (8.0), whose tags and arguments are operands in the
// same scope: `CourseStatus(course.id)` names `course` exactly as a
// rule does – and into a group member's arguments, `course.seatsOn(s)`,
// likewise. A walker sees the read first, then what is inside it.
function forEachCommandOperand(body, outerVisit) {
  const visit = (operand, meta) => {
    outerVisit(operand, meta);
    if (operandSource(operand) === 'each') { visit(operand.each, meta); return; }
    // Arithmetic (11.0): both sides, each an operand in the same place.
    if (operandSource(operand) === 'arithmetic') {
      visit(operand.leftHandSide, { ...meta, arithmetic: operand });
      visit(operand.rightHandSide, { ...meta, arithmetic: operand });
      return;
    }
    // A count (G3): the list it counts, in the same place.
    if (operandSource(operand) === 'count') {
      visit(operand.count, { ...meta, counted: operand });
      return;
    }
    // A collection function (11.0): its open read, then its `where`'s
    // sides – `value`, parameters, aliases already bound and literals, never a read.
    if (operandSource(operand) === 'collection') {
      visit(operand.read, { ...meta, collection: operand });
      if (operand.where && typeof operand.where === 'object') {
        for (const leaf of conditionLeaves(operand.where)) {
          for (const side of conditionOperands(leaf)) {
            for (const one of Array.isArray(side) ? side : [side]) visit(one, { ...meta, where: `${meta.where} (where)`, inWhere: operand });
          }
        }
      }
      return;
    }
    if (operandSource(operand) === 'alias-property') {
      for (const [key, argument] of Object.entries(operand.arguments || {})) {
        visit(argument, { ...meta, where: `${meta.where} (${operandText(operand)} argument ${key})`, tag: false });
      }
      return;
    }
    if (operandSource(operand) !== 'projection-read') return;
    for (const [key, tag] of readTagEntries(operand)) {
      visit(tag, { ...meta, where: `${meta.where} (${operand.projection} tag ${key})`, tag: true });
    }
    for (const [key, argument] of Object.entries(operand.arguments || {})) {
      visit(argument, { ...meta, where: `${meta.where} (${operand.projection} argument ${key})`, tag: false });
    }
  };
  // A group binding gives its tag and nothing else: what it reads, and
  // with which arguments, is said where a member is read.
  for (const binding of body.boundary || []) {
    if (!binding) continue;
    for (const [key, operand] of readTagEntries(binding)) {
      visit(operand, { where: `binding "${binding.alias || '?'}" (tag ${key})`, tag: true });
    }
    for (const [key, operand] of Object.entries(binding.arguments || {})) {
      visit(operand, { where: `binding "${binding.alias || '?'}" (argument ${key})` });
    }
  }
  // `loop` (11.0): the loop an operand sits in, whose names it may
  // read; `loopSource`: the loop whose source it is.
  const visitCondition = (condition, where, loop) => {
    visit(condition.leftHandSide, { where, loop });
    if (condition.rightHandSide !== undefined) {
      // `equalsAny` spells its right-hand side as a literal list. The
      // entries are the operands; the array is only their container.
      const rights = Array.isArray(condition.rightHandSide)
        ? condition.rightHandSide : [condition.rightHandSide];
      for (const operand of rights) visit(operand, { where, loop });
    }
  };
  // The steps, in written order and into every branch and loop: a
  // rule's and an arm's predicates, an emission's fields, a loop's
  // source.
  forEachStep(commandSteps(body), (step, { loop }) => {
    const kind = stepKind(step);
    if (kind === 'rule' && step.condition) {
      const text = conditionText(step.condition);
      for (const leaf of conditionLeaves(step.condition)) visitCondition(leaf, `condition "${text}"`, loop);
    }
    if (kind === 'branch') {
      for (const arm of step.branches || []) {
        if (!arm || !arm.condition) continue;
        const text = conditionText(arm.condition);
        for (const leaf of conditionLeaves(arm.condition)) visitCondition(leaf, `condition "if ${text}"`, loop);
      }
    }
    if (kind === 'emit') {
      for (const [key, operand] of Object.entries(step.parameters || {})) {
        visit(operand, { where: `emission "${step.name}.${key}"`, loop });
      }
    }
    if (kind === 'loop' && step.in !== undefined) {
      visit(step.in, { where: `for each ${loopNames(step).join(', ')}`, loop, loopSource: step });
    }
  });
}

// ============================================================
// DCB derivation.
//
// A command's boundary *is* its dynamic consistency boundary, and
// holds every read. A projection read contributes one query item: the
// tags it declares, with the values the read gives them – none at all
// for an untagged one – and the event types it handles. A group
// binding contributes exactly what its members are read for: each
// projection of the group a rule or an emission reads is that
// read (`groupMemberRead`), and one nobody reads is no part of the
// query – the group is a name, not a boundary.
//
// Items carry `tags` rather than one tag because a read may name
// several. Tags within an item are ANDed; the items themselves are
// ORed, which is the ordinary DCB query shape.
// ============================================================

// The type an operand resolves to, or null when it cannot be worked out
// (a literal, or a reference that does not resolve).
function resolveOperandType(operand, scope) {
  const resolved = resolveOperandTypeWhole(operand, scope);
  // A record value's field (11.0) is what that field holds.
  if (resolved && operand && typeof operand === 'object' && operand.field !== undefined
    && ['alias-property', 'projection-read'].includes(operandSource(operand))) {
    return resolved.isList ? null : recordFieldType(scope.model, resolved.propertyType, operand.field);
  }
  if (operandSource(operand) === 'collection') return collectionResultType(scope.model, operand);
  if (operandSource(operand) === 'count') return { propertyType: 'integer', isList: false };
  if (operandSource(operand) === 'duration') return { propertyType: 'duration', isList: false };
  if (operandSource(operand) === 'arithmetic') return arithmeticOperandType(operand, scope);
  // `value` inside a loop over an open read (11.0), given its type.
  if (operandSource(operand) === 'instance-value') {
    const held = scope.instanceValue;
    if (!held || operand.field === undefined) return held || null;
    return held.isList ? null : recordFieldType(scope.model, held.propertyType, operand.field);
  }
  return resolved;
}

// Why an arithmetic operand in a command cannot compute as written –
// or null (11.0): `add` or `subtract`, in a rule, a branch's condition
// or an emission, over two single values that compute
// (`arithmeticResultBase`) – a datetime and a duration, two durations,
// two numbers. A side whose type cannot be worked out is left to
// evaluation, as everywhere.
function arithmeticProblem(model, operand, meta, scope) {
  const text = operandText(operand);
  if (meta.inWhere) return `${meta.where} computes ${text} – a where compares value with what is in scope, and computes nothing.`;
  if (meta.tag) return `${meta.where} computes ${text} – a tag's value is read, never computed.`;
  if (!['add', 'subtract'].includes(operand.operator)) {
    return `${meta.where} computes "${operand.operator}" – a command adds (+) and subtracts (-); anything more is a derived projection's.`;
  }
  if (operand.rightHandSide === undefined) return `${meta.where} computes ${text} with no right-hand side.`;
  const sides = [operand.leftHandSide, operand.rightHandSide].map((side) => {
    if (typeof side === 'string' && datetimeInstant(side) === null) return { problem: timeValueProblem(model, 'datetime', side) };
    return { type: arithmeticSideType(side, scope) };
  });
  const broken = sides.find((side) => side.problem);
  if (broken) return `${meta.where} computes ${text}, but ${broken.problem}`;
  if (sides.some((side) => side.type && side.type.isList)) return `${meta.where} computes ${text} over a list – arithmetic takes one value on each side.`;
  if (sides.some((side) => !side.type)) return null;
  const [left, right] = sides.map((side) => arithmeticBaseOf(model, side.type.propertyType));
  if (arithmeticResultBase(operand.operator, left, right)) return null;
  const what = (base, type) => (base ? `${typeArticle(base)} ${base}` : `${typeArticle(type)} ${type}`);
  return `${meta.where} computes ${text} – ${what(left, sides[0].type.propertyType)} ${operand.operator === 'add' ? 'plus' : 'minus'} `
    + `${what(right, sides[1].type.propertyType)} means nothing: numbers add up, a datetime moves by a duration, and durations add up.`;
}

// Why a comparison sets a time against what is no time of its kind –
// or null (11.0). `typeOf(operand)` resolves a side; a string literal
// opposite a datetime must read as one, offset and all.
function timeComparisonProblem(model, condition, typeOf) {
  const sides = [condition.leftHandSide, condition.rightHandSide];
  const bases = sides.map((side) => {
    const resolved = typeof side === 'string' || typeof side === 'number' ? null : typeOf(side);
    return resolved && !resolved.isList ? arithmeticBaseOf(model, resolved.propertyType) : null;
  });
  for (const [i, j] of [[0, 1], [1, 0]]) {
    const time = bases[i] === 'datetime' || bases[i] === 'duration' ? bases[i] : null;
    if (!time) continue;
    if (typeof sides[j] === 'string') {
      const problem = timeValueProblem(model, time, sides[j]);
      if (problem) return `"${conditionText(condition)}" compares ${typeArticle(time)} ${time} with ${problem}`;
    }
    if (typeof sides[j] === 'number') {
      return `"${conditionText(condition)}" compares ${typeArticle(time)} ${time} with the number ${sides[j]}`
        + `${time === 'duration' ? ' – a duration literal says its unit: 15m, 24h' : ''}.`;
    }
    if (bases[j] && bases[j] !== time) {
      return `"${conditionText(condition)}" compares ${typeArticle(time)} ${time} with ${typeArticle(bases[j])} ${bases[j]} – they are no values of one kind.`;
    }
  }
  return null;
}

// What one side of an arithmetic operand is (11.0): a resolved type,
// or a literal's – a number, or a string that reads as a datetime –
// marked `literal`, since a literal takes the other side's type.
function arithmeticSideType(operand, scope) {
  if (typeof operand === 'number') return { propertyType: Number.isInteger(operand) ? 'integer' : 'number', isList: false, literal: true };
  if (typeof operand === 'string' && datetimeInstant(operand) !== null) return { propertyType: 'datetime', isList: false, literal: true };
  return resolveOperandType(operand, scope);
}

// What an arithmetic operand yields, as a type name – or null when that
// cannot be worked out or the sides do not compute. The type is
// nominal, as everywhere: `now + 15m` is what `now` is, `a - b` of two
// `Seats` is `Seats`, and a literal takes the other side's type. Two
// differing number types yield the plain `integer`, or nothing a type
// names.
function arithmeticOperandType(operand, scope) {
  const left = arithmeticSideType(operand.leftHandSide, scope);
  const right = arithmeticSideType(operand.rightHandSide, scope);
  if (!left || !right || left.isList || right.isList) return null;
  const leftBase = arithmeticBaseOf(scope.model, left.propertyType);
  const rightBase = arithmeticBaseOf(scope.model, right.propertyType);
  const base = arithmeticResultBase(operand.operator, leftBase, rightBase);
  if (!base) return null;
  const named = (type) => ({ propertyType: type, isList: false });
  if (base === 'datetime') return named(leftBase === 'datetime' ? left.propertyType : right.propertyType);
  if (left.propertyType === right.propertyType) return named(left.propertyType);
  if (left.literal && !right.literal && rightBase === base) return named(right.propertyType);
  if (right.literal && !left.literal && leftBase === base) return named(left.propertyType);
  return base === 'number' ? null : named(base);
}

function resolveOperandTypeWhole(operand, { boundary, commandProperties, model }) {
  const source = operandSource(operand);
  if (source === 'alias-property') {
    const binding = (boundary || []).find((b) => b.alias === operand.alias);
    if (!binding) return null;
    if (binding.projection) {
      // A projection holds one value, so the alias alone names it.
      const projection = projectionsOf(model)[binding.projection];
      if (!projection || operand.property) return null;
      return { propertyType: projection.valueType, isList: !!projection.isList };
    }
    if (binding.group === undefined || !operand.property) return null;
    // A member is the group's projection of that name.
    const projection = projectionsOf(model)[qualifiedProjectionName(binding.group, operand.property)];
    if (!projection) return null;
    return { propertyType: projection.valueType, isList: !!projection.isList };
  }
  if (source === 'tag-literal') {
    return operand.tagType ? { propertyType: operand.tagType, isList: false } : null;
  }
  // One element of the list it fans out over.
  if (source === 'each') {
    const inner = resolveOperandType(operand.each, { boundary, commandProperties, model });
    return inner ? { propertyType: inner.propertyType, isList: false } : null;
  }
  // An inline read holds its projection's value, the same as an alias
  // bound to it does.
  if (source === 'projection-read') {
    const projection = projectionsOf(model)[operand.projection];
    return projection ? { propertyType: projection.valueType, isList: !!projection.isList } : null;
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

// The predicates that make sense against a resolved operand type – a
// rule editor offers these rather than the full predicate list, so
// "starts with" never turns up against an integer. `null` (the type
// could not be worked out, e.g. an untyped literal) leaves every
// predicate on the table rather than guessing.
//
// Given the model, a scalar value type counts as what it is underneath,
// the way `operationsFor` counts it: `Hours` over an integer is ordered
// like the integer it wraps – naming a primitive must not cost it its
// predicates. An identifier (a tag type) and an enum are not: they are
// compared for identity, whatever they are spelled in.
function predicatesForType(resolved, model) {
  if (!resolved) return [...BINARY_PREDICATES, ...UNARY_PREDICATES];
  if (resolved.isList) {
    return ['equals', 'countEquals', 'countLessThan', 'countGreaterThan',
      'contains', 'containsAny', 'isEmpty', 'isNotEmpty'];
  }
  const underlying = underlyingScalarType(model, resolved.propertyType);
  if (underlying) return predicatesForType({ propertyType: underlying, isList: false });
  if (resolved.propertyType === 'boolean') return ['equals', 'equalsAny', 'isTrue', 'isFalse'];
  if (['integer', 'datetime', 'duration'].includes(resolved.propertyType)) {
    return ['equals', 'equalsAny', 'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals'];
  }
  if (resolved.propertyType === 'string') {
    return ['equals', 'equalsAny', 'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals',
      'startsWith', 'endsWith'];
  }
  // Enum, id and composite types: nothing
  // but identity means anything without a declared ordering –
  // `equalsAny` is that same identity, taken against each entry of a
  // literal list, so it is admitted wherever `equals` is (and, like
  // `equals`, only against a scalar left-hand side: "this list is one
  // of these lists" is authorable noise).
  return ['equals', 'equalsAny'];
}

// The simple type a plain scalar value type wraps (`integer`,
// `string`, `boolean`, `datetime`, `duration`), or null for anything else – a simple type
// itself, a composite, an enum, an identifier, an unknown name.
function underlyingScalarType(model, typeName) {
  if (!model || !model['custom-type-definitions']) return null;
  const cls = classifyType(model, typeName);
  if (cls.kind !== 'value' || cls.composite || cls.isTag || enumMembersFor(model, typeName)) return null;
  if (timeBaseOf(model, typeName)) return timeBaseOf(model, typeName);
  const kind = literalKindOf(model, typeName);
  return kind === 'number' ? 'integer' : kind;
}

// The type a rule's right-hand side has to hold for a given predicate
// against a left-hand side of `leftType` – `null` once `leftType`
// itself is unknown, since nothing can be filtered against it then.
function rightHandExpectedType(predicate, leftType) {
  if (!leftType) return null;
  if (predicate === 'countEquals' || predicate === 'countLessThan' || predicate === 'countGreaterThan') {
    return { propertyType: 'integer', isList: false };
  }
  if (predicate === 'contains') return { propertyType: leftType.propertyType, isList: false };
  if (predicate === 'containsAny') return { propertyType: leftType.propertyType, isList: true };
  // `equalsAny` compares against a literal list of the left's own type.
  if (predicate === 'equalsAny') return { propertyType: leftType.propertyType, isList: true };
  return { propertyType: leftType.propertyType, isList: leftType.isList };
}

// The tag a projection read fans out over – its `{each: …}` – or null.
function readFanTag(read) {
  return readTagOperands(read).find((tag) => operandSource(tag) === 'each') || null;
}

// Whether an operand holds many values in the command's scope: a list,
// or a property read off a binding that fans out (one per instance).
function operandIsPlural(model, body, operand) {
  const resolved = resolveOperandType(operand, {
    boundary: body.boundary || [], commandProperties: commandScopeProperties(model, body), model,
  });
  if (resolved && resolved.isList) return true;
  if (operandSource(operand) !== 'alias-property') return false;
  const source = (body.boundary || []).find((b) => b && b.alias === operand.alias);
  return !!source && isFannedOut(model, body, source);
}

// A read fans out where it says so: a projection read, or a group's,
// at the tag that is `each …` (`Course(each student.subscribedCourseIds)`).
// The list it fans over may itself be read off a plural alias – a list
// of lists, which flattens.
function isFannedOut(model, body, binding) {
  if (!binding) return false;
  return !!readFanTag(binding);
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
  // What it fans over: the `each` of its tag.
  const over = readFanTag(binding).each;
  if (operandSource(over) === 'parameter') {
    return `parameter:${over.parameterName}`;
  }
  if (operandSource(over) === 'alias-property') {
    const source = (body.boundary || []).find((b) => b && b.alias === over.alias);
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
  // A read in place that fans out has the root of what it fans over –
  // a payload list, or a list read off a binding.
  if (source === 'projection-read') {
    const fan = readFanTag(operand);
    if (!fan) return null;
    const over = resolveOperandType(fan.each, { boundary: body.boundary || [], commandProperties: commandScopeProperties(model, body), model });
    if (over && !over.isList && operandSource(fan.each) !== 'alias-property') return null;
    if (operandSource(fan.each) === 'parameter') return `parameter:${fan.each.parameterName}`;
    if (operandSource(fan.each) === 'alias-property') {
      return bindingFanRoot(model, body, (body.boundary || []).find((b) => b && b.alias === fan.each.alias))
        || `binding:${fan.each.alias}`;
    }
    return null;
  }
  if (source === 'parameter') {
    // A list parameter is a fan root only when something actually fans
    // out over it. A list nobody iterates – the new schedule handed to
    // a reschedule command, say – is an ordinary list value, and
    // reading it alongside a fanned alias is not a second quantifier.
    const root = `parameter:${operand.parameterName}`;
    const iterated = (body.boundary || []).some((b) => bindingFanRoot(model, body, b) === root)
      || inlineReads(body).some(({ read }) => fanRootOf(model, body, read) === root);
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
// very list the operand is rooted at – that alias is what supplies the
// index. An operand rooted at a list nothing else iterates stays a
// plain list, and is quantified over on its own.
function isZipped(model, body, condition, operand) {
  const root = fanRootOf(model, body, operand);
  if (!root || operandSource(operand) !== 'parameter') return false;
  return conditionOperands(condition).some((other) =>
    other !== operand
    && (operandSource(other) === 'alias-property' || operandSource(other) === 'projection-read')
    && fanRootOf(model, body, other) === root);
}

// An operand's type as the condition actually reads it: zipping drops
// the list, because the index has already been applied.
function conditionOperandType(model, body, condition, operand) {
  const resolved = resolveOperandType(operand, {
    boundary: body.boundary || [],
    commandProperties: commandScopeProperties(model, body),
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

// The operand that reaches one leaf of a composite identifier's value –
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

// The tag(s) an identifier-typed value renders as – one per leaf,
// scalar and composite alike, each through that leaf's own `tagSchema`.
// Shared by every DCB preview (a projection binding's arguments, an
// event's published properties): all of them read the same union of
// component tags that `eventDefinitions` describes.
function tagsForIdentifierValue(model, identifierTypeName, operand, { each } = {}) {
  const leaves = idLeavesOfType(model, identifierTypeName);
  // A tag literal shows its value, not its own spelling: the tag it
  // renders is `CourseId:c1`, never `CourseId:CourseId("c1")`; anything
  // else is a placeholder (`plannedTagValue`).
  const literal = operandSource(operand) === 'tag-literal';
  const placeholder = (shown) => plannedTagValue(operand, shown, !!each);
  const shownFor = (leaf) => {
    if (operand === undefined) return '?';
    if (literal) {
      const held = leaf && leaf.field !== null ? (operand.tagValue || {})[leaf.field] : operand.tagValue;
      return String(held);
    }
    return operandText(leaf ? operandForLeaf(operand, leaf) : operand);
  };
  if (!leaves.length) {
    // Unresolved mid-edit – nothing to render through, so fall back to
    // the type name literally rather than showing nothing at all.
    return [`${identifierTypeName}:${placeholder(shownFor(null))}`];
  }
  return leaves.map((leaf) => renderTag(identifierTypeOf(model, leaf.identifierType), placeholder(shownFor(leaf))));
}

// The type a tag operand holds – `{propertyType, isList}` – in the
// scope of the command `body` it sits in, or null where that cannot be
// worked out (a dangling reference, an untyped literal). It has to be
// the type the projection declares for that tag, which is the key.
function tagOperandType(model, body, operand) {
  // `each` is resolved through `resolveOperandType` too: one element.
  return resolveOperandType(operand, {
    boundary: (body && body.boundary) || [],
    commandProperties: commandScopeProperties(model, body),
    model,
  });
}

// The tags one projection read contributes, for display – one per leaf
// of each declared tag type, with the value in the caller's terms
// (`CourseId:courseId`). A tag the read leaves out shows as `?`.
function readTagTexts(model, body, read) {
  const projection = projectionsOf(model)[read && read.projection];
  const held = (read && read.tags && typeof read.tags === 'object') ? read.tags : {};
  return uniq(projectionTagParams(projection).flatMap((tag) => {
    const operand = held[tag.name];
    // An open tag (11.0) narrows nothing: the query is the bound tags'.
    if (operandSource(operand) === 'open') return [];
    if (operandSource(operand) === 'each') {
      return tagsForIdentifierValue(model, tag.tagType, operand.each, { each: true });
    }
    // A loop's element (11.0) is read once per element, as `each` is.
    return tagsForIdentifierValue(model, tag.tagType, operand, { each: namesLoopVariable(body, operand) });
  }));
}

// Whether a read is made once per element of a loop (11.0): one of its
// tags is a loop's name.
function readsPerElement(body, read) {
  return readTagOperands(read).some((operand) => namesLoopVariable(body, operand));
}

// The tag-type sets a projection is read by – one, its own declared
// tags (8.0): `[['CourseId']]`, or `[[]]` for an untagged one. Kept as
// a list of sets because that is what every caller asks about.
function projectionReadTagSets(model, projectionName) {
  if (!projectionsOf(model)[projectionName]) return [];
  return [[...projectionTagTypes(model, projectionName)].sort()];
}

// The events a read of `projectionName` by `tagTypes` – its own
// declared ones unless given – can never see: each handled event that
// does not list a tag of every one of those types (`eventTagLeaves`).
// Tag matching is by value – a query by CourseId finds only events
// tagged by one – so such a handler never fires. `[{event, missing}]`,
// empty when every handled event is reachable. A derived projection
// has no handlers of its own: each operand is read by its own tags and
// answers for itself.
function readTagsMissing(model, projectionName, tagTypes = projectionTagTypes(model, projectionName)) {
  const out = [];
  if (derivedOf(projectionsOf(model)[projectionName])) return out;
  for (const eventName of projectionHandledTypes(model, projectionName)) {
    const event = model['event-definitions'][eventName];
    if (!event) continue;
    const carried = new Set(eventTagLeaves(model, event).map((leaf) => leaf.identifierType));
    const missing = (tagTypes || []).filter((type) => !carried.has(type));
    if (missing.length) out.push({ event: eventName, missing });
  }
  return out;
}

// The event types a projection's query covers: its handlers' events –
// or, for a derived one, the union of its operands', walked
// recursively. `seen` stops a cycle from recursing forever; the cycle
// itself is the advisory's (and evaluation's) to report.
function projectionHandledTypes(model, projectionName, seen = []) {
  const projection = projectionsOf(model)[projectionName];
  if (!projection || seen.includes(projectionName)) return [];
  const derived = derivedOf(projection);
  if (!derived) {
    return uniq((projection.handlers || []).map((h) => h && h.event).filter(Boolean));
  }
  const out = [];
  for (const operand of derivedReads(derived)) {
    if (operandSource(operand) !== 'projection-read') continue;
    out.push(...projectionHandledTypes(model, operand.projection, [...seen, projectionName]));
  }
  return uniq(out);
}

// The reads a read of `read.projection` comes down to, as `[{read,
// via}]`: itself for a folded projection, and for a derived one each
// projection it folds in the end, read by the values this read gave –
// an operand's `{parameterName}` is one of the derived projection's own
// parameters, so it takes whatever this read gave it – as a tag or an
// argument; a literal stays itself. A derived projection's query is its operands' queries, each
// under its *own* tags: the weekly budget is kept per developer, the
// week's allocations per developer and week, and one query ANDing both
// would miss the registration. `seen` stops a cycle, which the advisory
// and evaluation report.
function foldedReads(model, read, seen = []) {
  const projection = projectionsOf(model)[read.projection];
  const derived = projection && derivedOf(projection);
  if (!derived) return [{ read, via: seen.length ? read.projection : null }];
  if (seen.includes(read.projection)) return [];
  const held = {
    ...((read.arguments && typeof read.arguments === 'object') ? read.arguments : {}),
    ...((read.tags && typeof read.tags === 'object') ? read.tags : {}),
  };
  const out = [];
  for (const operand of derivedReads(derived)) {
    if (operandSource(operand) !== 'projection-read') continue;
    const passed = (values) => {
      const out_ = {};
      for (const [name, value] of Object.entries(values || {})) {
        out_[name] = operandSource(value) === 'parameter' ? held[value.parameterName] : value;
      }
      return out_;
    };
    const next = { projection: operand.projection, tags: passed(operand.tags), arguments: passed(operand.arguments) };
    out.push(...foldedReads(model, next, [...seen, read.projection]));
  }
  return out;
}

// One query item per read a command makes – or, for a derived
// projection, one per projection it folds (`via`), each written under
// that projection's own tags; the same query reached twice is one.
function readItems(model, body, read, base) {
  const items = [];
  const seen = new Set();
  for (const { read: folded, via } of foldedReads(model, read)) {
    const item = {
      projection: read.projection,
      ...base,
      ...(via ? { via } : {}),
      fannedOut: !!readFanTag(folded) || readsPerElement(body, folded),
      tags: readTagTexts(model, body, folded),
      types: projectionHandledTypes(model, folded.projection).sort(),
      readProperties: [],
    };
    const key = JSON.stringify([item.tags, item.types, item.fannedOut]);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function deriveDcb(model, body) {
  const items = [];

  for (const binding of body.boundary || []) {
    if (!binding) continue;

    if (binding.projection) {
      const projection = projectionsOf(model)[binding.projection];
      if (!projection) continue;
      // The projection declares its tags and the read gives their
      // values, so the query is written from both – one tag per scalar
      // tag value, one per component for a record – whatever kind of
      // projection it reads: declared or derived, neither can hide what
      // it reads.
      items.push(...readItems(model, body, binding, { alias: binding.alias }));
      continue;
    }
    if (binding.group !== undefined) items.push(...groupBindingItems(model, body, binding));
  }

  // Every inline read (8.0) is a query item too, once however often it
  // is written: two rules about `CourseStatus(courseId)` read it once.
  // It has no alias, so its item is known by its spelling.
  for (const { key, read } of inlineReads(body)) {
    items.push(...readItems(model, body, read, { alias: null, inline: key }));
  }

  // What it writes, over every emission any run might reach.
  const writes = [];
  for (const emission of commandEmissions(body)) {
    if (!emission) continue;
    const event = model['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      const listed = property.isList || namesLoopVariable(body, operand) || (operand !== undefined && operandSource(operand) === 'parameter'
        && (body.properties || []).some((p) => p.name === operand.parameterName && p.isList));
      for (const leaf of eventTagLeaves(model, event).filter((l) => l.property === property.name)) {
        const shown = operand === undefined ? '?' : operandText(operandForLeaf(operand, leaf));
        writes.push(renderTag(identifierTypeOf(model, leaf.identifierType), plannedTagValue(operand, shown, listed)));
      }
    }
  }

  return { items, writes: uniq(writes) };
}

// What a group binding contributes: each member read, once per distinct
// spelling (`course.capacity` written in two rules is one read), as the
// read it stands for – and the items those reads share a tag set with
// merged into one, `readProperties` naming the members behind it, so a
// course read for its status and its capacity is one item of both
// types, as it always was. What a derived member folds by other tags –
// a limit kept for all courses – keeps an item of its own, under that
// projection's tags (`via`); never ANDed with the instance's.
function groupBindingItems(model, body, binding) {
  const reads = new Map();
  forEachCommandOperand(body, (operand) => {
    if (operandSource(operand) !== 'alias-property' || operand.alias !== binding.alias || !operand.property) return;
    const key = JSON.stringify(canonicalOperand({ property: operand.property, arguments: operand.arguments }));
    if (!reads.has(key)) reads.set(key, operand);
  });
  const merged = new Map();
  for (const operand of reads.values()) {
    const read = groupMemberRead(binding, operand);
    if (!projectionsOf(model)[read.projection]) continue;
    for (const item of readItems(model, body, read, { alias: binding.alias, group: binding.group })) {
      const key = JSON.stringify([item.tags, item.fannedOut]);
      const into = merged.get(key);
      if (!into) {
        const { projection, ...rest } = item;
        merged.set(key, { ...rest, types: [...item.types], readProperties: [operand.property] });
        continue;
      }
      if (into.via !== item.via) delete into.via;
      into.types = uniq([...into.types, ...item.types]).sort();
      if (!into.readProperties.includes(operand.property)) into.readProperties.push(operand.property);
    }
  }
  return [...merged.values()].map((item) => ({ ...item, readProperties: item.readProperties.sort() }));
}

// Every inline projection read in a command, once per distinct
// spelling – `{ key, read }`, `key` the read's canonical JSON – in the
// order first written. Two rules reading `CourseStatus(courseId)` read
// it once.
function inlineReads(body) {
  const out = [];
  const seen = new Set();
  forEachCommandOperand(body, (operand) => {
    if (operandSource(operand) !== 'projection-read') return;
    const key = readKey(operand);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, read: operand });
  });
  return out;
}

// What a read in place is known by: its canonical JSON, without the
// record field it may take (11.0) – `P(x).city` and `P(x).street` are
// one read of P(x).
function readKey(read) {
  if (!read || typeof read !== 'object' || read.field === undefined) return JSON.stringify(canonicalOperand(read));
  const { field, ...whole } = read;
  return JSON.stringify(canonicalOperand(whole));
}

// Naming a read in place, and taking the name back – the rule adder
// writes a projection read in place, and the page offers the alias
// afterwards. Both rewrite one command body in place and return it.
//
// Naming binds the read under `alias` and points every spelling of
// it in the command at the alias: they are one read already
// (`inlineReads`), so naming one names them all. The binding goes last,
// since its tags can only name what is bound before it.
function aliasInlineRead(body, key, alias) {
  const found = inlineReads(body).find((r) => r.key === key);
  if (!found) return body;
  const { field, ...read } = deepClone(found.read);
  (body.boundary = body.boundary || []).push({ alias, ...read });
  mapConditionOperands(body, (operand) => (operandSource(operand) === 'projection-read' && readKey(operand) === key
    ? { alias, ...(operand.field !== undefined ? { field: operand.field } : {}) } : operand));
  return body;
}

// Whether a projection alias can be read in place again: only while
// every use is the read's whole value, written where a read in place
// may stand – a rule or an emission field. A property of it
// (`alias.field`) or a use inside another read has no in-place
// spelling to go back to.
function aliasInlinable(body, alias) {
  const binding = (body.boundary || []).find((b) => b && b.alias === alias);
  if (!binding || !binding.projection) return false;
  const names = (operand) => operandSource(operand) === 'alias-property' && operand.alias === alias;
  let uses = 0;
  forEachCommandOperand(body, (operand) => { if (names(operand)) uses += 1; });
  let wholeValues = 0;
  mapConditionOperands(deepClone(body), (operand) => {
    if (names(operand) && operand.property === undefined) wholeValues += 1;
    return operand;
  });
  return uses === wholeValues;
}

function inlineAliasedRead(body, alias) {
  const binding = (body.boundary || []).find((b) => b && b.alias === alias);
  if (!binding || !binding.projection) return body;
  const read = { projection: binding.projection };
  if (readTagEntries(binding).length) read.tags = deepClone(binding.tags);
  if (binding.arguments && Object.keys(binding.arguments).length) read.arguments = deepClone(binding.arguments);
  body.boundary = body.boundary.filter((b) => b !== binding);
  mapConditionOperands(body, (operand) => (operandSource(operand) === 'alias-property'
    && operand.alias === alias && operand.property === undefined
    ? { ...deepClone(read), ...(operand.field !== undefined ? { field: operand.field } : {}) } : operand));
  return body;
}

// Replaces the top-level operands of every rule and emission
// field with what `replace` returns for each – the places a read in
// place or an alias's whole value can stand.
function mapConditionOperands(body, replace) {
  const mapCondition = (condition) => {
    if (!condition) return;
    condition.leftHandSide = replace(condition.leftHandSide);
    if (Array.isArray(condition.rightHandSide)) condition.rightHandSide = condition.rightHandSide.map(replace);
    else if (condition.rightHandSide !== undefined) condition.rightHandSide = replace(condition.rightHandSide);
  };
  for (const leaf of commandConditionLeaves(body)) mapCondition(leaf);
  for (const emission of commandEmissions(body)) {
    for (const key of Object.keys(emission.parameters || {})) {
      emission.parameters[key] = replace(emission.parameters[key]);
    }
  }
}

// The operands one binding is read with – its tags and arguments.
function bindingOperands(binding) {
  if (!binding) return [];
  return [...readTagOperands(binding), ...Object.values(binding.arguments || {})];
}

// The aliases an operand names, looking into inline reads and into a
// group member's arguments.
function operandAliases(operand, out = []) {
  if (operandSource(operand) === 'alias-property') {
    if (!out.includes(operand.alias)) out.push(operand.alias);
    for (const argument of Object.values(operand.arguments || {})) operandAliases(argument, out);
  } else if (operandSource(operand) === 'each') {
    operandAliases(operand.each, out);
  } else if (operandSource(operand) === 'collection') {
    operandAliases(operand.read, out);
    // A where's alias (11.0) is a value compared, consulted as any is.
    if (operand.where && typeof operand.where === 'object') {
      for (const leaf of conditionLeaves(operand.where)) {
        for (const side of conditionOperands(leaf)) for (const one of Array.isArray(side) ? side : [side]) operandAliases(one, out);
      }
    }
  } else if (operandSource(operand) === 'arithmetic') {
    operandAliases(operand.leftHandSide, out);
    operandAliases(operand.rightHandSide, out);
  } else if (operandSource(operand) === 'count') {
    operandAliases(operand.count, out);
  } else if (operandSource(operand) === 'projection-read') {
    for (const inner of [...readTagOperands(operand), ...Object.values(operand.arguments || {})]) operandAliases(inner, out);
  }
  return out;
}

// The aliases a binding waits for – every binding its own operands
// name, inline reads included. A graph, not a tree: a tag and an
// argument may point somewhere different, and arguments may point at
// several bindings at once.
function bindingDependsOn(body, binding) {
  if (!binding) return [];
  const aliases = [];
  for (const operand of bindingOperands(binding)) operandAliases(operand, aliases);
  return aliases.filter((alias) => alias !== binding.alias);
}

// The query an operand waits for, as a depth: a bound alias waits for
// its binding's round, an inline read is one query after whatever its
// own tags wait for, and anything else waits for nothing.
function operandDepth(operand, roundOf) {
  switch (operandSource(operand)) {
    case 'alias-property':
      return Math.max(roundOf.get(operand.alias) || 0,
        ...Object.values(operand.arguments || {}).map((o) => operandDepth(o, roundOf)));
    case 'each': return operandDepth(operand.each, roundOf);
    case 'projection-read': {
      const inner = [...readTagOperands(operand), ...Object.values(operand.arguments || {})];
      return 1 + Math.max(0, ...inner.map((o) => operandDepth(o, roundOf)));
    }
    default: return 0;
  }
}

// Groups the boundary into the queries it actually resolves in – one
// per level of the chain (the identifier says "rounds"; every view
// says "queries").
//
// A binding waits only for the bindings it names, so the number of
// queries to the store is the *depth* of that graph and not the length
// of the list: two bindings both reading from the payload come back
// in one query. Because a binding may only name one declared above it, the
// list is already topologically sorted and one left-to-right pass does
// it.
//
// Derived, never authored – which is also what keeps it honest about
// shape. A binding with two parents has no place in a written
// hierarchy without being duplicated.
function deriveRounds(body) {
  const boundary = (body.boundary || []).filter(Boolean);
  const roundOf = new Map();
  const rounds = [];

  for (const binding of boundary) {
    const waitsFor = bindingDependsOn(body, binding).filter((a) => roundOf.has(a));
    // An inline read among its operands is a query of its own, so the
    // binding waits for it as it would for an alias.
    const round = Math.max(0, ...bindingOperands(binding).map((o) => operandDepth(o, roundOf))) + 1;
    roundOf.set(binding.alias, round);
    while (rounds.length < round) rounds.push([]);
    rounds[round - 1].push({ binding, waitsFor });
  }
  return rounds;
}

// The consistency boundary, summed up and laid out the way every view
// says it: how wide (`words` – "reads 5 types, 2 tags, in 2 queries")
// and the queries in the order they run. A chained read cannot share a
// query with the read it waits for – its tags are answers from that
// one – so the boundary is read in as many queries as the chain is
// deep (`deriveRounds`), and the append condition is all of them,
// ORed. A read whose properties nothing uses queries any type under
// its tag, which no count of types could say. The code view's command
// line and the Consistency boundary step both speak from here, so they
// cannot disagree.
function boundarySummary(model, body) {
  const dcb = deriveDcb(model, body);
  const rounds = deriveRounds(body);
  const queries = rounds.map((round) =>
    round.flatMap((entry) => dcb.items.filter((item) => item.alias && item.alias === entry.binding.alias)));
  // An inline read sits in the query its depth says: one after the
  // aliases and reads its tags wait for.
  const roundOf = new Map(rounds.flatMap((round, r) => round.map((entry) => [entry.binding.alias, r + 1])));
  for (const { key, read } of inlineReads(body)) {
    const depth = operandDepth(read, roundOf);
    while (queries.length < depth) queries.push([]);
    queries[depth - 1].push(...dcb.items.filter((i) => i.inline === key));
  }
  for (let i = queries.length - 1; i >= 0; i--) if (!queries[i].length) queries.splice(i, 1);
  const items = dcb.items;
  const types = uniq(items.flatMap((item) => item.types)).sort();
  const anyType = items.some((item) => !item.types.length);
  const tags = uniq(items.flatMap((item) => item.tags));
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const words = !items.length ? 'reads nothing'
    : `reads ${anyType ? 'any type' : count(types.length, 'type')}, `
      + `${tags.length ? count(tags.length, 'tag') : 'no tag'}`
      + (queries.length > 1 ? `, in ${queries.length} queries` : '');
  return { items, queries, types, tags, anyType, writes: dcb.writes, words };
}

// The boundary as the store is asked it (_DCB queries, shown_), and the
// one place that says how a command's cycle runs:
//
//   { calls: [[item]], after: 'head' | 'read' }
//
// `calls` is one query per call, in the order they run, each item a tag
// set and every type read under it. `boundarySummary` lists one item
// per read; the store is asked one per tag set (`evDecideThroughPort`
// merges them), so two reads of the same course are one item here –
// `from` names the reads that contributed. A read of any type makes its
// item any type: `types` left out. An empty list is never written – the
// specification reads it as matching nothing (`memoryStore`).
//
// `after` is where the append condition's position comes from. A chain
// – more than one call – takes head first, since no one read's last
// position covers the others; a single call uses the last position it
// read. `handleCommand` runs by this, and every page that draws the
// condition says it from this.
function commandPlan(summary) {
  const rounds = summary.queries.length ? summary.queries : (summary.items.length ? [summary.items] : []);
  const calls = rounds.map((round) => {
    const byTags = new Map();
    for (const item of round) {
      const tags = [...item.tags].sort();
      const key = JSON.stringify(tags);
      if (!byTags.has(key)) byTags.set(key, { types: new Set(), anyType: false, tags, from: [], fannedOut: false });
      const merged = byTags.get(key);
      if (!item.types.length) merged.anyType = true;
      for (const type of item.types) merged.types.add(type);
      const from = item.alias || item.projection;
      if (from && !merged.from.includes(from)) merged.from.push(from);
      if (item.fannedOut) merged.fannedOut = true;
    }
    return [...byTags.values()].map(({ types, anyType, ...rest }) => (anyType ? rest : { types: [...types].sort(), ...rest }));
  });
  return { calls, after: calls.length > 1 ? 'head' : 'read' };
}

// A projection's query as its readers fill it in (_DCB queries, shown_):
// `{ calls }`, one query per read its fold makes of the store, each
// value a placeholder for the projection's own parameter –
// `CourseId:{courseId}`. A folded projection reads once; a derived one
// reads each projection it folds, under that one's own tags
// (`foldedReads`). A command reading it asks the same items with its
// values in place of the placeholders (`readItems`, which this is). A
// fold that handles no event reads nothing, so it has no call.
function projectionPlan(model, projectionName) {
  const projection = projectionsOf(model)[projectionName];
  if (!projection) return { calls: [] };
  const ownParameters = (list) => Object.fromEntries((list || [])
    .filter((parameter) => parameter && parameter.name)
    .map((parameter) => [parameter.name, { parameterName: parameter.name }]));
  const read = {
    projection: projectionName,
    tags: ownParameters(projectionTagParams(projection)),
    arguments: ownParameters(projection.arguments),
  };
  return {
    calls: readItems(model, {}, read, {})
      .filter((item) => item.types.length)
      .map(({ types, tags, fannedOut }) => [{ types, tags, fannedOut }]),
  };
}

// ---------- what consults a read ----------
//
// A boundary binding is no longer authored. It comes into existence as
// the side-effect of a gesture that needs it – a rule, an emission
// field, a tag the emission writes, or another binding's
// identifier – and it goes when the last of those goes. The list is
// still stored, and still authoritative: a rule names its alias and
// nothing else records the path that alias stands for, so the boundary
// cannot be recomputed from the rules. What is maintained instead is
// the invariant that every binding is consulted by something, which
// reference counting gives exactly.
//
// The first three reasons are the three places an alias can be named, all
// of them operands (`forEachCommandOperand` walks the same set). Write
// coverage was a fifth while entities named the instance an emitted tag
// wrote; a group names nothing of the kind, so it went with them.
//
// The last names no alias at all: a binding to a projection that takes
// no tags is the read of every event that projection folds, so it
// serialises the command against all of them – the way a command with
// no conditions is made strictly serial, which the schema promises.
// Nothing else need consult it for it to matter, so it is never pruned
// as unreferenced.
const REFERENCE_REASONS = ['rule', 'emission', 'chain', 'serialisation'];

function bindingReferences(model, body) {
  const found = new Map();
  for (const binding of body.boundary || []) {
    if (binding && binding.alias) found.set(binding.alias, new Set());
  }
  const note = (alias, reason) => {
    const reasons = found.get(alias);
    if (reasons) reasons.add(reason);
  };
  // An operand naming an alias consults it whatever else it does, so
  // the walk is over operand *shape*, not over the position it sits in.
  const noteOperand = (operand, reason) => {
    for (const alias of operandAliases(operand)) note(alias, reason);
  };
  const noteCondition = (condition, reason) => {
    if (!condition) return;
    noteOperand(condition.leftHandSide, reason);
    const rights = Array.isArray(condition.rightHandSide)
      ? condition.rightHandSide : [condition.rightHandSide];
    for (const operand of rights) noteOperand(operand, reason);
  };

  // A branch's condition decides as a rule's does, and so does what a
  // loop runs over (11.0): it decides how many times it runs.
  for (const leaf of commandConditionLeaves(body)) noteCondition(leaf, 'rule');
  for (const loop of commandLoops(body)) noteOperand(loop.in, 'rule');
  for (const emission of commandEmissions(body)) {
    for (const operand of Object.values(emission.parameters || {})) {
      noteOperand(operand, 'emission');
    }
  }
  // A binding reached *through* another is the chain: `theirs` is why
  // `students` is read, and `students` is consulted by nothing else.
  // `arguments` count for the same reason tags do – they are operands
  // resolved in the same scope, which is what `forEachCommandOperand`
  // already treats them as.
  for (const binding of body.boundary || []) {
    if (!binding) continue;
    for (const operand of readTagOperands(binding)) noteOperand(operand, 'chain');
    for (const operand of Object.values(binding.arguments || {})) {
      noteOperand(operand, 'chain');
    }
  }
  for (const binding of body.boundary || []) {
    if (!binding || binding.projection === undefined) continue;
    const projection = projectionsOf(model)[binding.projection];
    if (projection && !projectionTagParams(projection).length) note(binding.alias, 'serialisation');
  }
  return found;
}

// The aliases nothing consults, in declaration order. Transitive: a
// binding kept alive only by one that is itself unreferenced is
// unreferenced too, which is what makes deleting the last rule about
// `theirs` take `students` with it.
function unreferencedBindings(model, body) {
  const bindings = (body.boundary || []).filter((b) => b && b.alias);
  let live = bindings.map((b) => b.alias);
  for (;;) {
    const refs = bindingReferences(model, { ...body, boundary: bindings.filter((b) => live.includes(b.alias)) });
    const next = live.filter((alias) => (refs.get(alias) || new Set()).size > 0);
    if (next.length === live.length) break;
    live = next;
  }
  return bindings.map((b) => b.alias).filter((alias) => !live.includes(alias));
}

// Which reads the *decision* walks, as against the ones an emission
// causes. A read a rule names is tested; so is every read it
// had to be reached through, because a hop exists only to get to the
// thing being tested.
//
// Everything else is read because an event records its value or writes
// its tag – `CourseNumbering`, whose value becomes the new course's id,
// and the student `StudentUnsubscribedFromCourse` tags. That is a fact
// about what the command *records*, not about what it *decides*, so it
// belongs beside the emission and not under "it is only allowed if".
// A command with no tested reads at all is plainly always allowed, and
// says so, with the reads it still makes shown where they come from.
//
// The split is presentation only: both halves are the same `boundary`,
// and the derived DCB is their union either way.
function decisionAliases(model, body) {
  const references = bindingReferences(model, body);
  const byAlias = new Map((body.boundary || [])
    .filter((b) => b && b.alias).map((b) => [b.alias, b]));
  const kept = new Set();
  const visit = (alias) => {
    if (!alias || kept.has(alias) || !byAlias.has(alias)) return;
    kept.add(alias);
    const binding = byAlias.get(alias);
    const walk = (operand) => { for (const alias of operandAliases(operand)) visit(alias); };
    for (const operand of bindingOperands(binding)) walk(operand);
  };
  for (const [alias, reasons] of references) {
    if (reasons.has('rule')) visit(alias);
  }
  return kept;
}

// Pruning is what "reads are determined by the rules" means on the
// write path: every gesture that removes the last thing consulting a
// read removes the read in the same append, so there is no moment at
// which the boundary holds something nothing looks at. A body arriving
// from elsewhere – a hand-written file, an agent writing a whole
// body – may hold one, and keeps it until this runs: it is reported as
// an advisory first and dropped at the next edit, never silently.
function pruneUnreferencedBindings(model, body) {
  const dropped = unreferencedBindings(model, body);
  if (!dropped.length) return dropped;
  body.boundary = (body.boundary || []).filter((b) => !(b && dropped.includes(b.alias)));
  return dropped;
}

// ============================================================
// Commands – DCB-style consult-and-check, then append.
// ============================================================

class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainError';
  }
}

// A refusal like any other, of its own kind so the append can tell a
// full storage from a broken one and make room before giving up.
class StorageFullError extends DomainError {
  constructor() {
    super('The browser\'s storage for this site is full, so that change was not saved – '
      + 'it does not fit even with the history compacted. Removing a model you no longer need makes room.');
    this.name = 'StorageFullError';
  }
}

// Only structure is refused here – empty or unbounded, a key cannot
// address a definition. Idiom (PascalCase) is an advisory computed by
// `modelAdvisories`, never a refusal: an unidiomatic name still keys,
// renders and evaluates, and the Problems panel says so.
function validateName(value, label = 'Name') {
  const trimmed = (value || '').trim();
  if (!trimmed) throw new DomainError(`${label} must not be empty.`);
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

// The same event the code view's `model "…"` header appends (see
// `replaceDefinitions`), for the bar's name field. A name that is
// already the model's appends nothing.
function renameDcbModel(id, name) {
  const model = getCtxOrThrow(id);
  const trimmed = validateModelName(name);
  if (trimmed === model.name) return;
  appendEvents([{ type: 'dcb-model-renamed', data: { 'dcb-model-id': id, name: trimmed } }]);
}

// The model's description (11.0): free text about the whole model,
// documentation only. Empty or null takes it away; one the model
// already has appends nothing.
function describeDcbModel(id, description) {
  const model = getCtxOrThrow(id);
  const next = normalizedDescription(description);
  if (next === (model.description === undefined ? null : model.description)) return;
  appendEvents([{ type: 'dcb-model-described', data: { 'dcb-model-id': id, description: next } }]);
}

// A description as stored: text, or null for none.
function normalizedDescription(description) {
  if (description === undefined || description === null) return null;
  if (typeof description !== 'string') throw new DomainError('A description is text.');
  return description.trim() ? description.replace(/\s+$/, '') : null;
}

// Definitions ------------------------------------------------------------

// The stored definitions of one kind – refused for a kind this build
// does not have (an entity, since 11.0) rather than failing on it.
function collectionOfKind(model, kind) {
  if (!Object.prototype.hasOwnProperty.call(DEF_COLLECTIONS, kind)) {
    throw new DomainError(`"${kind}" is no kind of definition this playground has.`);
  }
  return model[DEF_COLLECTIONS[kind]];
}

function getCtxOrThrow(modelId) {
  const model = projectState()[modelId];
  if (!model) throw new DomainError('Model does not exist (it may have been deleted).');
  return model;
}

// The semantic checker – dangling references, unresolved types, write
// coverage, enum membership, everything a definition can get *wrong*
// while still being a definition. It throws the way it always has, but
// nothing on the write path calls it any more: `modelAdvisories` below
// runs it against the stored state and reports what it finds, so a
// defective definition loads, renders and evaluates (to the ordinary
// *error* outcome where it must) instead of being refused at the door.
function validateReferences(model, kind, name, body) {
  const resolved = withPending(model, kind, name, body);
  // What a group's projections name is checked on each of them, under
  // its qualified name (`checkedDefinitions`); said on the group as well,
  // every dangling handler would be reported twice.
  const refs = kind === 'group-definition' ? emptyRefs() : computeReferences(resolved, kind, name, body);
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
        throw new DomainError(`${label} property name "${p.name}" must be camelCase, at least two characters.`);
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
  if (kind === 'group-definition') validateGroupBody(resolved, name, body);
  if (kind === 'projection-definition') validateProjectionBody(resolved, name, body);
  if (kind === 'command-definition') validateCommandBody(resolved, body);
  if (kind === 'scenario-definition') validateScenarioBody(resolved, body);
  if (kind === 'projection-scenario-definition') validateProjectionScenarioBody(resolved, body);
}

// ============================================================
// Advisories.
//
// The demoted validations. A definition that names what does not
// exist, writes a tag its boundary never consults, compares against a
// member its enum does not hold – all of it is representable state
// now, and this is where it gets said. One advisory per finding,
// recomputed from the stored model and cached per log revision like
// every other derived view; a writer never sees these as a refusal.
//
// Scenarios are deliberately absent: a scenario's trouble already
// surfaces through its own run/status channel (`scenarioTrouble`),
// and reporting the same breakage twice would say less, not more.
// ============================================================

const ADVISORY_KINDS = DEF_KINDS.filter((kind) => !isIdKeyed(kind));

// Everything advisory about one definition, first semantic failure
// only – `validateReferences` throws at the first thing it finds, and
// fixing that one re-runs the rest. Anything unexpected a defective
// body makes the checker itself throw is reported the same way: to a
// reader an advisory is an advisory, whichever guard tripped.
// A rule's rejection message is the outcome a refusal is known by: what
// the person reads, and what a scenario expecting the refusal names. So
// it is static, one line, and short enough to stand in a toast – the
// values a refusal saw are reported beside it, never spliced into it.
const REJECTION_MAX_LENGTH = 200;

// Why `text` cannot be a rejection message, or '' when it can.
function rejectionProblem(text) {
  if (typeof text !== 'string' || !text.trim()) return 'is empty';
  if (/[\r\n]/.test(text)) return 'spans several lines';
  if (text.length > REJECTION_MAX_LENGTH) return `is longer than ${REJECTION_MAX_LENGTH} characters`;
  return '';
}

// Required on every rule – but only ever advised, never refused: a rule without one still evaluates, and a
// refusal by it is what a scenario cannot name (`deriveThen`).
// A `reject` statement is held to the same.
function rejectionAdvisories(body) {
  const messages = [];
  for (const { step, rejection, text } of commandRejectionSteps(body)) {
    if (rejection === undefined) {
      messages.push(`The rule "${text}" has no rejection message – `
        + 'say what the command is refused with when it does not hold.');
      continue;
    }
    const problem = rejectionProblem(rejection);
    if (problem) messages.push(`The rejection message of "${stepKind(step) === 'reject' ? 'reject' : text}" ${problem}.`);
  }
  return messages;
}

// The messages a command can be refused with, in written order, each
// once, with the steps that lead to it – rules, and `reject`s in
// branches (`{index, condition}` for a rule, `index` its place among
// the rules; `{reject}` for a statement). Steps sharing a message are
// one outcome. One without a message is left out – it is an advisory.
function commandRejections(body) {
  const outcomes = [];
  let ruleIndex = -1;
  for (const { step, rejection } of commandRejectionSteps(body)) {
    const isRule = stepKind(step) === 'rule';
    if (isRule) ruleIndex += 1;
    if (rejectionProblem(rejection)) continue;
    let outcome = outcomes.find((o) => o.rejection === rejection);
    if (!outcome) outcomes.push(outcome = { rejection, rules: [] });
    outcome.rules.push(isRule ? { index: ruleIndex, condition: step.condition } : { reject: step });
  }
  return outcomes;
}

// What a command's scenarios owe it (11.0): one scenario per refusal –
// each rejection message, `commandRejections` – and one per way it
// succeeds. A command without branches succeeds one way; with them,
// each arm that emits is a way of its own (`{arm, events}`, `arm` the
// key evaluation reports it under, `armKey`), and so is getting through
// with no arm emitting when emissions stand outside every branch. An
// arm inside a loop counts the same; a loop's own emissions are part
// of the one way a command without arms succeeds.
function commandSuccessesOwed(body) {
  const arms = [];
  forEachStep(commandSteps(body), (step, at) => {
    if (stepKind(step) !== 'branch') return;
    for (const arm of stepArms(step)) {
      const events = arm.steps.filter((inner) => stepKind(inner) === 'emit').map((inner) => inner.name);
      if (events.length) arms.push({ arm: armKey(at.path, arm.index), events, condition: arm.condition });
    }
  });
  if (!arms.length) {
    const events = commandSteps(body).flatMap((step) => (stepKind(step) === 'emit' ? [step]
      : stepKind(step) === 'loop' ? loopSteps(step).filter((inner) => stepKind(inner) === 'emit') : []));
    return [{ arm: null, events: events.map((e) => e.name) }];
  }
  return arms;
}

// A grouped projection is advised under its qualified name, as the body
// it amounts to (`projectionsOf`); its local name's idiom is its group's
// to advise, so the PascalCase check passes it by.
function definitionAdvisories(model, kind, name, body) {
  const messages = [];
  if (!isIdKeyed(kind) && !splitQualifiedName(name) && !PASCAL_RE.test(name)) {
    messages.push(`${humanize(kind)} name "${name}" is not PascalCase (e.g. "CourseDefined").`);
  }
  try {
    validateReferences(model, kind, name, body);
  } catch (error) {
    messages.push(error && error.message ? error.message : String(error));
  }
  // A read nothing consults. The app cannot author one – a read exists
  // because a rule, emission, emitted tag or another read wanted
  // it – so this only ever comes from outside: a hand-written file, or
  // an agent writing a whole body. It still bounds the append, so it is
  // never dropped behind anyone's back; it is reported here and pruned
  // by the next edit to this command, which is what the message says.
  messages.push(...noteAdvisories(kind, body));
  if (kind === 'event-definition') {
    messages.push(...eventTagAdvisories(model, body));
    // An event no command emits (11.0): a definition the model can
    // never record – unless it says it is only stored (`@deprecated`).
    if (body && body.isDeprecated !== true && !emittedEvents(model).has(name)) {
      messages.push('No command emits it. Mark it @deprecated if it is only stored, or emit it from the command that records it.');
    }
  }
  if (kind === 'projection-definition') messages.push(...handlerAdvisories(`Projection "${name}"`, body));
  if (kind === 'command-definition') {
    messages.push(...rejectionAdvisories(body));
    const deprecated = [];
    forEachStep(commandSteps(body), (step) => {
      if (stepKind(step) !== 'emit' || deprecated.includes(step.name)) return;
      const event = model['event-definitions'][step.name];
      if (event && event.isDeprecated === true) deprecated.push(step.name);
    });
    for (const event of deprecated) {
      messages.push(`Emits ${event}, which is @deprecated – it is stored, but no longer recorded. Emit what replaced it.`);
    }
    const stranded = unreferencedBindings(model, body);
    if (stranded.length) {
      messages.push(`Reads nothing consults: ${stranded.join(', ')}. `
        + `${stranded.length === 1 ? 'It still widens' : 'They still widen'} the consistency `
        + `boundary, so nothing is dropped now – the next edit to this command will remove `
        + `${stranded.length === 1 ? 'it' : 'them'}.`);
    }
  }
  return messages;
}

let advisoriesCache = null;

// The events some command emits, anywhere in its steps. Not cached:
// a model's collections are folded into in place.
function emittedEvents(model) {
  const found = new Set();
  for (const body of Object.values(model['command-definitions'] || {})) {
    forEachStep(commandSteps(body), (step) => { if (stepKind(step) === 'emit') found.add(step.name); });
  }
  return found;
}

// The fields a definition's description and notes fill (11.0), in the
// order the schema declares them – what an editor that rebuilds a body
// carries over untouched.
const DEFINITION_NOTE_FIELDS = ['description', 'assumptions', 'externalRules', 'unresolved', 'isDeprecated', 'isSensitive'];

// A definition's description and notes (11.0) are documentation: they
// are only advised on when they are not what they say – text, lists of
// text, a marker that is true – or sit where they mean nothing.
const NOTE_LISTS = ['assumptions', 'externalRules', 'unresolved'];
function noteAdvisories(kind, body) {
  const out = [];
  if (!body || typeof body !== 'object') return out;
  if (body.description !== undefined && typeof body.description !== 'string') out.push('Its description is not text.');
  for (const field of NOTE_LISTS) {
    const held = body[field];
    if (held !== undefined && (!Array.isArray(held) || held.some((note) => typeof note !== 'string' || !note.trim()))) {
      out.push(`Its ${field} are not a list of text.`);
    }
  }
  if (body.isDeprecated !== undefined && (kind !== 'event-definition' || body.isDeprecated !== true)) {
    out.push('Only an event is @deprecated, and isDeprecated is true when it is.');
  }
  if (body.isSensitive !== undefined && (kind !== 'custom-type-definition' || body.isSensitive !== true)) {
    out.push('Only a type is @sensitive, and isSensitive is true when it is.');
  }
  return out;
}

function modelAdvisories(model) {
  if (advisoriesCache && advisoriesCache.revision === logRevisionNow() && advisoriesCache.model === model) {
    return advisoriesCache.found;
  }
  const found = [];
  for (const { kind, name, body } of checkedDefinitions(model, ADVISORY_KINDS)) {
    for (const message of definitionAdvisories(model, kind, name, body)) {
      found.push({ kind, name, message });
    }
  }
  advisoriesCache = { revision: logRevisionNow(), model, found };
  return found;
}

// Every definition a check reads, as `{kind, name, body}`: each stored
// one of `kinds`, and – right after its group – every grouped
// projection, as a `projection-definition` under its qualified name and
// in the body it amounts to. So a grouped projection is advised, and
// blocks a run, exactly as a top-level one does.
function checkedDefinitions(model, kinds) {
  const out = [];
  const view = projectionsOf(model);
  for (const kind of kinds) {
    for (const [name, body] of Object.entries(model[DEF_COLLECTIONS[kind]] || {})) {
      out.push({ kind, name, body });
      if (kind !== 'group-definition') continue;
      for (const inner of groupProjections(body)) {
        const qualified = qualifiedProjectionName(name, inner.name);
        if (typeof inner.name === 'string' && view[qualified]) {
          out.push({ kind: 'projection-definition', name: qualified, body: view[qualified] });
        }
      }
    }
  }
  return out;
}

// What keeps a model from running anywhere but here, as `{kind, name,
// message}`. The playground loads, renders and evaluates a defective
// model, and says what is wrong as advisories; something that decides
// for real – dcb-runtime – refuses it instead, and this is its list,
// so the two cannot disagree on what is runnable. A definition an
// import skipped (`skipped`, from `modelFromEnvelope`), one that fails
// the semantic check (`validateReferences`: a command publishing
// nothing, a dangling reference), and a projection whose tag and
// argument share a name – they would be one parameter.
function executionBlockers(model, skipped = []) {
  const found = skipped.map(({ kind, name, reason }) => ({ kind, name, message: reason }));
  for (const { kind, name, body } of checkedDefinitions(model, DEF_KINDS)) {
    try {
      validateReferences(model, kind, name, body);
    } catch (error) {
      found.push({ kind, name, message: error && error.message ? error.message : String(error) });
    }
  }
  for (const [name, body] of Object.entries(projectionsOf(model))) {
    const tags = new Set(projectionTagParams(body).map((tag) => tag.name));
    for (const argument of body.arguments || []) {
      if (argument && tags.has(argument.name)) {
        found.push({ kind: 'projection-definition', name, message: `"${argument.name}" is a tag and an argument` });
      }
    }
  }
  return found;
}

// Why a tag operand cannot fill a projection's tag `tag` (`{name,
// tagType}`) – or null. It must be one value of the declared type,
// which is the tag's key: a literal states its type (`CourseId("c1")`),
// any other value has one in the command's scope. A list is read once
// per element only with `each`.
function tagOperandProblem(model, body, operand, tag) {
  const source = operandSource(operand);
  const declared = tag && tag.tagType;
  const mismatch = (held) => (declared && held && held !== declared
    ? `is tagged ${operandText(operand)}, ${typeArticle(held)} ${held} – but its "${tag.name}" tag is ${typeArticle(declared)} ${declared}.`
    : null);
  if (source === 'static' || source === 'enum-member') {
    return `is tagged ${operandText(operand)}, which says no tag type – write the literal with its type, `
      + `${declared || 'CourseId'}(${JSON.stringify(source === 'static' ? operand : operand.enumMember)}).`;
  }
  if (source === 'tag-literal') {
    if (operand.tagValue === null || operand.tagValue === undefined) return `is tagged ${operand.tagType} with no value – a tag has one.`;
    return mismatch(operand.tagType);
  }
  // `each` fans out over a list; over one value there is nothing to fan.
  if (source === 'each') {
    const over = tagOperandType(model, body, operand.each);
    if (over && !over.isList) {
      return `is tagged ${operandText(operand)}, but ${operandText(operand.each)} is one value – ` +
        `"each" fans out over a list; drop it.`;
    }
    if (operandSource(operand.each) === 'each') return 'is tagged each of each';
    const element = tagOperandType(model, body, operand);
    return element ? mismatch(element.propertyType) : null;
  }
  const resolved = tagOperandType(model, body, operand);
  if (resolved && resolved.isList) {
    return `is tagged ${operandText(operand)}, which is a list – a tag takes one value; ` +
      `"each ${operandText(operand)}" reads it once per element.`;
  }
  return resolved ? mismatch(resolved.propertyType) : null;
}

// ---------- loops (11.0) ----------

// Why a loop cannot run as written – or null: it runs over an open
// read, naming each open tag, or over a list, naming its element; and
// its names are its own, no payload property's or alias's.
function loopProblem(model, body, loop) {
  const names = loopNames(loop);
  const label = `"for each ${names.join(', ')}"`;
  if (names.length !== (Array.isArray(loop.forEach) ? loop.forEach.length : 0) || !names.length) {
    return `${label} names nothing – a loop names the element it runs over.`;
  }
  for (const name of names) {
    if ((body.properties || []).some((p) => p && p.name === name)) return `${label} already names a payload property, "${name}" – a loop's name is its own.`;
    if ((body.boundary || []).some((b) => b && b.alias === name)) return `${label} already names an alias, "${name}" – a loop's name is its own.`;
  }
  if (uniq(names).length !== names.length) return `${label} names one thing twice.`;
  const source = loop.in;
  const text = `${label} in ${operandText(source)}`;
  if (operandSource(source) === 'projection-read' && openTagNames(source).length) {
    const open = openTagNames(source).length;
    if (open !== names.length) {
      return `${text} leaves ${open} tag${open === 1 ? '' : 's'} open but names ${names.length} – one name per open tag.`;
    }
    return null;
  }
  // `list(P(x, *))` (G1) is a list like any other – one name.
  const listed = operandSource(source) === 'collection' && source.collect === 'list';
  if (!listed && !['projection-read', 'parameter', 'alias-property'].includes(operandSource(source))) {
    return `${text}: a loop runs over an open read P(x, *), list(P(x, *)), a list projection or a list parameter.`;
  }
  const resolved = resolveOperandType(source, { boundary: body.boundary || [], commandProperties: body.properties || [], model });
  if (resolved && !resolved.isList) {
    return `${text}: ${operandText(source)} is not a list – a loop runs over an open read P(x, *), list(P(x, *)), a list projection or a list parameter.`;
  }
  if (names.length !== 1) {
    return `${text} names ${names.length} – a list's element takes one name; two names are for two open tags.`;
  }
  return null;
}

// Why a step cannot stand inside a loop – or null. A loop emits: its
// steps are emissions and branches, each arm one emission or one
// `reject`; a loop never nests.
function loopStepProblem(step, at) {
  const kind = stepKind(step);
  const where = `Inside "for each ${loopNames(at.loop).join(', ')}"`;
  if (kind === 'loop') return `${where}, another "for each" – a loop does not nest.`;
  if (kind === 'rule') return `${where}, a rule – a loop emits; "if not … => reject" refuses from inside one.`;
  if (kind === 'reject' && at.path[at.path.length - 2] === 'each') return `${where}, a "reject" outside any branch refuses whenever there is an element.`;
  if (kind === 'branch' && stepArms(step).some((arm) => arm.steps.length !== 1 || !['emit', 'reject'].includes(stepKind(arm.steps[0])))) {
    return `${where}, each branch holds one emit or one reject.`;
  }
  return null;
}

// ---------- open reads, collections, record fields (11.0) ----------

// Why a read's open tags (`*`) cannot be read as written – or null. An
// open read is read only as a collection function's (`inCollection`)
// or as what a loop runs over (`inLoop`, 11.0), of a folded, top-level
// projection, with at least one tag left bound; a read inside a
// collection leaves at least one open.
function openReadProblem(model, read, inCollection, inLoop = false) {
  const open = openTagNames(read);
  const text = operandText(read);
  if (!open.length) {
    return inCollection ? `${text} leaves no tag open – a collection function reads every instance of one, ${read.projection}(…, *).` : null;
  }
  if (!inCollection && !inLoop) return `${text} leaves a tag open – it is read inside count, sum, min, max, average, any or all, or by a for each.`;
  if (splitQualifiedName(read.projection) || isLocalProjectionName(read.projection)) {
    return `${text} leaves the tag of a group open – a group's projections are read by its one tag, so an open read is of a top-level projection tagged by several.`;
  }
  const target = projectionsOf(model)[read.projection];
  if (!target) return null;
  if (derivedOf(target)) return `${text} leaves a tag of ${read.projection} open, which is derived – an open read collects a folded projection's instances.`;
  if (open.length >= projectionTagParams(target).length) {
    return `${text} leaves every tag open – at least one stays bound; a projection read by none is untagged.`;
  }
  return null;
}

// Why a collection function cannot be read as written – or null: a
// function of the set, over a read in place, whose `where` reads
// `value` (a record's field of it), parameters, in a command an alias
// already bound (`aliases`, its value or its record's field – a value,
// no read) and literals – never a projection. `parameterSide(operand,
// where)` checks a parameter in the owner's scope, throwing or
// returning a problem; the command's own walk checks the aliases.
function collectionProblem(model, operand, where, parameterSide = () => null, aliases = false) {
  if (!COLLECTION_FUNCTIONS.includes(operand.collect)) {
    return `${where}: "${operand.collect}" is not a collection function (${COLLECTION_FUNCTIONS.join(', ')}).`;
  }
  if (operandSource(operand.read) !== 'projection-read') {
    return `${where} collects ${operandText(operand.read)} – a collection function reads a projection with a tag left open, P(x, *).`;
  }
  const target = projectionsOf(model)[operand.read.projection];
  // `list` (G1) collects the one tag left open – with two, a list of
  // what would be ambiguous.
  if (operand.collect === 'list') {
    const open = openTagNames(operand.read);
    if (open.length !== 1) {
      return `${where}: list(…) collects the one tag a read leaves open – ${operandText(operand.read)} leaves ${open.length}.`;
    }
  }
  // A record's field (11.0), `sum(P(x, *).seats)`: what a numeric one
  // computes over, while its where still sees the whole value.
  if (operand.read.field !== undefined) {
    if (!['sum', 'min', 'max', 'average'].includes(operand.collect)) {
      return `${where} takes .${operand.read.field} – only sum, min, max and average compute over a field; ${operand.collect} keeps whole instances.`;
    }
    const problem = recordFieldProblem(model, target, operand.read);
    if (problem) return `${where} collects ${operandText(operand.read)}, but ${problem}`;
  }
  if (operand.where === undefined) return null;
  for (const leaf of conditionLeaves(operand.where)) {
    for (const side of conditionOperands(leaf).flatMap((o) => (Array.isArray(o) ? o : [o]))) {
      const source = operandSource(side);
      const aliasValue = aliases && source === 'alias-property' && side.property === undefined && side.arguments === undefined;
      if (['projection-read', 'alias-property', 'collection'].includes(source) && !aliasValue) {
        return `${where} has a where that reads ${operandText(side)} – a where reads value, parameters, aliases and literals, never a projection.`;
      }
      if (source === 'instance-value' && side.field !== undefined && target) {
        const fields = compositeFieldsOf(model, target.valueType);
        if (!fields || !fields.some((f) => f.name === side.field)) {
          return `${where} reads value.${side.field}, but ${target.valueType} has no field "${side.field}".`;
        }
      }
      if (source === 'parameter') {
        const problem = parameterSide(side, where);
        if (problem) return problem;
      }
      if (source === 'enum-member') {
        const found = whereEnumMembers(model, operand).find((pair) => pair.operand === side);
        const members = found && enumMembersFor(model, found.type);
        if (members && !members.includes(side.enumMember)) return `${where}: "${side.enumMember}" is not a member of ${found.type}.`;
      }
      if (!['instance-value', 'parameter', 'enum-member', 'static', 'duration'].includes(source) && !aliasValue) {
        return `${where} has a where that reads ${operandText(side)} – a where reads value, parameters, aliases and literals.`;
      }
    }
    // `value.expiresAt` against a literal (11.0): a time of its kind.
    if (leaf.rightHandSide !== undefined && !Array.isArray(leaf.rightHandSide) && target) {
      const problem = timeComparisonProblem(model, leaf, (side) => {
        if (operandSource(side) === 'duration') return { propertyType: 'duration', isList: false };
        if (operandSource(side) !== 'instance-value') return null;
        return side.field === undefined ? { propertyType: target.valueType, isList: !!target.isList }
          : recordFieldType(model, target.valueType, side.field);
      });
      if (problem) return `${where}: ${problem}`;
    }
  }
  return null;
}

// The enum members a collection's where compares `value` (or a record
// value's field) with, each with the type it is a member of:
// `[{operand, type}]` – what a member rename follows and validation
// checks.
function whereEnumMembers(model, collection) {
  const read = operandRead(collection);
  const target = read && projectionsOf(model)[read.projection];
  if (!target || !collection.where) return [];
  const typeOf = (operand) => (operandSource(operand) !== 'instance-value' ? null
    : operand.field === undefined ? target.valueType : (recordFieldType(model, target.valueType, operand.field) || {}).propertyType);
  const out = [];
  for (const leaf of conditionLeaves(collection.where)) {
    const rights = Array.isArray(leaf.rightHandSide) ? leaf.rightHandSide : [leaf.rightHandSide];
    for (const right of rights) {
      for (const [maybe, other] of [[right, leaf.leftHandSide], [leaf.leftHandSide, right]]) {
        const type = typeOf(other);
        if (operandSource(maybe) === 'enum-member' && type) out.push({ operand: maybe, type });
      }
    }
  }
  return out;
}

// Why a read's `field` cannot be taken from what `target` holds – or
// null: it names a field of the record the projection holds.
function recordFieldProblem(model, target, operand) {
  if (!operand || operand.field === undefined || !target) return null;
  const fields = !target.isList ? compositeFieldsOf(model, target.valueType) : null;
  if (!fields) return `it holds ${typeArticle(target.valueType)} ${target.valueType}, which has no fields.`;
  if (!fields.some((f) => f.name === operand.field)) return `${target.valueType} has no field "${operand.field}".`;
  return null;
}

// The type a field of a record type holds, `{propertyType, isList}`.
function recordFieldType(model, typeName, field) {
  const found = (compositeFieldsOf(model, typeName) || []).find((f) => f && f.name === field);
  return found ? { propertyType: found.propertyType, isList: !!found.isList } : null;
}

// What a collection function yields, as `resolveOperandType` says a
// type: count an integer, any and all a boolean, sum, min and max what
// the projection holds – or null for average, a number no declared type
// names, and for what cannot be worked out.
function collectionResultType(model, operand) {
  const read = operandRead(operand);
  const target = read && projectionsOf(model)[read.projection];
  if (read && read.field !== undefined && ['sum', 'min', 'max'].includes(operand.collect)) {
    return target && !target.isList ? recordFieldType(model, target.valueType, read.field) : null;
  }
  switch (operand.collect) {
    case 'count': return { propertyType: 'integer', isList: false };
    case 'any': case 'all': return { propertyType: 'boolean', isList: false };
    // The one open tag's values (G1): a list of its type.
    case 'list': {
      const open = target && read ? projectionTagParams(target).filter((tag) => openTagNames(read).includes(tag.name)) : [];
      return open.length === 1 ? { propertyType: open[0].tagType, isList: true } : null;
    }
    case 'sum': case 'min': case 'max':
      return target && !target.isList ? { propertyType: target.valueType, isList: false } : null;
    default: return null;
  }
}

// Why a `count(…)` (G3) cannot count what it names – or null: it
// counts a list, one whose type `scope` (`resolveOperandType`'s, or
// null for a derived projection's) resolves – a list parameter or
// record field, a list projection, `list(…)` – and is an integer.
function countProblem(model, operand, where, scope, typeOf = null) {
  const inner = operand.count;
  if (operandSource(inner) === 'collection' && inner.collect !== 'list') {
    return `${where}: count(${operandText(inner)}) counts a list – ${inner.collect}(…) gives one value; count(P(x, *)) counts instances.`;
  }
  const resolved = typeOf ? typeOf(inner) : resolveOperandType(inner, scope);
  if (!resolved || resolved.isList) return null;
  return `${where}: count(${operandText(inner)}) counts a list – ${operandText(inner)} is ${typeArticle(resolved.propertyType)} ${resolved.propertyType}.`;
}

// What a derived side yields, `{propertyType, isList}` – a read's value
// or its field, a collection's result, a parameter's type – or null.
function derivedOperandType(model, operand, owner) {
  const source = operandSource(operand);
  if (source === 'count') return { propertyType: 'integer', isList: false };
  if (source === 'collection') {
    if (operand.collect === 'average') return { propertyType: 'number', isList: false };
    return collectionResultType(model, operand);
  }
  if (source === 'projection-read') {
    const target = projectionsOf(model)[operand.projection];
    if (!target) return null;
    if (operand.field !== undefined) return recordFieldType(model, target.valueType, operand.field);
    return { propertyType: target.valueType, isList: !!target.isList };
  }
  if (source === 'parameter') {
    const parameter = projectionParameters(owner).find((p) => p.name === operand.parameterName);
    return parameter ? { propertyType: parameter.type, isList: false } : null;
  }
  return null;
}

// Whether a value of type `held` may be held as `declared`: the same
// type, or two numbers – an integer held as any number, a number only as
// one that is not an integer.
function sameValueKind(model, held, declared) {
  if (held === declared) return true;
  const a = held === 'number' ? 'number' : numericBaseOf(model, held);
  const b = numericBaseOf(model, declared);
  if (a && b) return a === 'integer' || b === 'number';
  return false;
}

// "a" or "an", for a type name in a sentence.
function typeArticle(word) {
  return /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a';
}

// Why a read cannot be read as written – or null: a projection that
// exists, one value for each tag it declares and none it does not, each
// of the declared type, one fan-out at most, and the arguments it
// takes and no others. Shared by an alias's read and a read in
// place, which are the same read. `chained(operand, what)` lets a
// binding add its own rule – a value from a binding below it.
function readProblem(model, body, read, where, chained = () => null) {
  const projection = projectionsOf(model)[read.projection];
  if (!projection) return `${where} reads "${read.projection}", which this model does not define.`;
  const label = `${where} reads ${read.projection}`;
  return readTagsProblem(model, body, projectionTagParams(projection), read, label, chained)
    || readArgumentsProblem(projection, read, label, chained);
}

// The tags half of `readProblem`, shared with a group binding, whose
// one declared tag is its group's.
function readTagsProblem(model, body, declared, read, label, chained = () => null) {
  if (read.tags !== undefined && (read.tags === null || typeof read.tags !== 'object' || Array.isArray(read.tags))) {
    return `${label} with tags that are not named – each value belongs to one of its tags.`;
  }
  const held = read.tags || {};
  for (const tag of declared) {
    if (!Object.prototype.hasOwnProperty.call(held, tag.name)) {
      return `${label} without a value for its "${tag.name}" tag (${tag.tagType}).`;
    }
  }
  for (const key of Object.keys(held)) {
    if (!declared.some((tag) => tag.name === key)) {
      return declared.length
        ? `${label} with "${key}", which is not one of its tags (${declared.map((tag) => tag.name).join(', ')}).`
        : `${label} with "${key}", but it is untagged – it is read by no tag.`;
    }
  }
  const fans = readTagOperands(read).filter((operand) => operandSource(operand) === 'each');
  if (fans.length > 1) return `${label}, which fans out over ${fans.length} lists – a read fans out over one.`;
  for (const tag of declared) {
    const operand = held[tag.name];
    // An open tag (11.0) is the open read's to judge (`openReadProblem`).
    if (operandSource(operand) === 'open') continue;
    if (operand === undefined || operand === null || operandIncomplete(operand)) {
      return `${label} with no value for its "${tag.name}" tag.`;
    }
    const outside = chained(operand, `its "${tag.name}" tag`);
    if (outside) return outside;
    const problem = tagOperandProblem(model, body, operand, tag);
    if (problem) return `${label}, which ${problem}`;
  }
  return null;
}

// The arguments half: the ones the projection takes, and no others.
// A group member's are its own, `course.seatsOn(slot: s)`.
function readArgumentsProblem(projection, read, label, chained = () => null) {
  if (read.arguments !== undefined && (read.arguments === null || typeof read.arguments !== 'object' || Array.isArray(read.arguments))) {
    return `${label} with arguments that are not named.`;
  }
  const slots = projectionSlots(projection);
  const supplied = Object.keys(read.arguments || {});
  const missing = slots.find((slot) => !supplied.includes(slot.name));
  if (missing) return `${label} without "${missing.name}", which it takes as an argument.`;
  const extra = supplied.find((key) => !slots.some((slot) => slot.name === key));
  if (extra) return `${label} with "${extra}", which it does not take as an argument.`;
  for (const key of supplied) {
    const outside = chained(read.arguments[key], `"${key}"`);
    if (outside) return outside;
  }
  return null;
}

// What a projection's own tags cannot do, as the advisory that says so
// – or null. Two ways a handler and the tags fail to meet, both decided
// by the tags an event lists:
//
// - a handled event lists no tag of some type the projection is tagged
//   by, so its query never returns it and that handler never fires
//   (`CopyExists (tag copyId: CopyId)` moved by a `BookCatalogued` that
//   lists only an isbn);
// - a handled event lists one of those types twice (an assignment
//   naming both the new holder and the one replaced), so it reaches
//   both instances and an unconditional handler fires for both: the
//   instructor being replaced would "gain" the course their successor
//   was just assigned. A branched handler (11.0) whose every chain
//   compares a carrying field with the tag tells them apart, and clears
//   it (`handlerTellsCarriersApart`).
function projectionTagProblem(model, projectionName) {
  const projection = projectionsOf(model)[projectionName];
  const tagTypes = projectionTagTypes(model, projectionName);
  if (!projection || !tagTypes.length || derivedOf(projection)) return null;
  const label = `Projection "${projectionName}"`;
  const [unreached] = readTagsMissing(model, projectionName, tagTypes);
  if (unreached) {
    return `${label} is tagged by ${unreached.missing.join(' and ')}, but ` +
      `"${unreached.event}", which it handles, is tagged by no ${unreached.missing.join(' or ')} – ` +
      'so that handler never fires.';
  }
  const tags = projectionTagParams(projection);
  for (const eventName of projectionHandledTypes(model, projectionName)) {
    const leaves = eventTagLeaves(model, model['event-definitions'][eventName]);
    const handler = (projection.handlers || []).find((h) => h && h.event === eventName);
    for (const type of tagTypes) {
      const carriers = leaves.filter((leaf) => leaf.identifierType === type);
      if (carriers.length > 1 && !handlerTellsCarriersApart(handler, carriers, tags.filter((tag) => tag.tagType === type))) {
        const tag = (tags.find((t) => t.tagType === type) || {}).name || '…';
        return `${label} is tagged by ${type}, and "${eventName}" is tagged by ` +
          `${type} in ${carriers.map((leaf) => `"${leaf.path}"`).join(' and ')}, so its handler ` +
          'fires for both and cannot tell them apart. Give its handler a condition on one of them ' +
          `(if event.data.${carriers[0].path} == ${tag} => …), split the event so each records one fact, ` +
          'or tag it by one.';
      }
    }
  }
  return null;
}

// Whether a branched handler (11.0) tells apart the fields that carry
// one of the projection's tags: every chain it has compares one of them
// with that tag somewhere in its conditions. Simple and safe – an
// `else` after such an `if` counts, being in a chain that names one; a
// chain that names none applies whichever instance is read.
function handlerTellsCarriersApart(handler, carriers, tags) {
  if (!isConditionalHandler(handler)) return false;
  const paths = new Set(carriers.map((leaf) => leaf.path));
  const names = new Set(tags.map((tag) => tag.name));
  const chains = handlerChains(handler);
  return chains.length > 0 && chains.every((step) => handlerConditionLeaves({ steps: [step] }).some((leaf) => {
    const left = leaf.leftHandSide;
    const right = leaf.rightHandSide;
    return operandSource(left) === 'event-property'
      && paths.has(left.property === undefined ? left.eventProperty : `${left.eventProperty}.${left.property}`)
      && operandSource(right) === 'parameter' && names.has(right.parameterName);
  }));
}

// Handler validation. `target` is a projection body: `valueType`,
// `isList` – a grouped one included, so there is exactly one shape to
// validate.
function validateHandlers(model, label, target, handlers) {
  const allowedOperations = operationsFor(model, target);
  const members = enumMembersFor(model, target.valueType);
  const handledEvents = new Set();

  // `successor` wraps another operand, so recognising an operand means
  // walking into it. It is where numbering lives: a value set to the
  // successor of what an event carried *is* the next value to issue,
  // at every point in its life.
  const checkOperand = (operand, where) => {
    if (operandSource(operand) === 'successor') {
      // `hasSuccessor` is the rule; this is where breaking it is
      // refused. A record (11.0) has none either: it is replaced whole.
      if (compositeFieldsOf(model, target.valueType)) {
        throw new DomainError(
          `${where} takes a successor, but ${label} holds ${target.valueType}, which is a composite – ` +
          'a record has no successor; it is replaced whole.'
        );
      }
      if (!hasSuccessor(model, target.valueType)) {
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

  // An event field a handler takes (11.0): a property the event
  // carries, or one field of a record-typed one, one hop in –
  // `event.data.signUp.emailAddress`, as a condition and a tag path
  // read it.
  const eventFieldProblem = (operand, event, arm) => {
    const property = (event.properties || []).find((p) => p && p.name === operand.eventProperty);
    if (!property) {
      throw new DomainError(`Handler on ${label} reads "${operand.eventProperty}", which "${arm.event}" does not carry.`);
    }
    if (operand.property === undefined) return;
    const fields = !property.isList && compositeFieldsOf(model, property.propertyType);
    if (!fields) {
      throw new DomainError(`Handler on ${label} reads "${operandText(operand)}", but "${operand.eventProperty}" of "${arm.event}" is `
        + `${typeArticle(property.propertyType)} ${property.propertyType}${property.isList ? '[]' : ''}, which has no fields.`);
    }
    if (!fields.some((f) => f && f.name === operand.property)) {
      throw new DomainError(`Handler on ${label} reads "${operandText(operand)}", but ${property.propertyType} has no field "${operand.property}".`);
    }
  };

  // One operation – an unconditional handler's, or one arm's.
  const checkArm = (arm, event, where) => {
    if (!allowedOperations.includes(arm.operation)) {
      throw new DomainError(
        `Operation "${arm.operation}" is not available for ${label} ` +
        `(allowed: ${allowedOperations.join(', ')}).`
      );
    }
    // `undefined` is not a value an operand can have – JSON cannot even
    // carry it – but `operandSource` reads it as a static literal, so
    // without this a handler that says what it does without saying
    // what *from* slips through and renders as "undefined" everywhere
    // the effect is spoken. `null` stays legal: "no value yet" is a
    // value.
    if (arm.value === undefined) {
      throw new DomainError(`${where} says what it does but not what value it takes.`);
    }
    const leaf = checkOperand(arm.value, where);
    if (operandSource(leaf) === 'event-property') eventFieldProblem(leaf, event, arm);
    if (members && operandSource(leaf) === 'enum-member'
        && !members.includes(leaf.enumMember)) {
      throw new DomainError(
        `Handler on ${label} sets "${leaf.enumMember}", which is not a member of ${target.valueType}.`
      );
    }
    recordValueProblem(arm, event, where);
    nominalProblem(arm, event, where);
  };

  // What a handler writes is held to nominal types (11.0, package 8),
  // as an emission and a read's tag are: an event field fills a
  // projection – or a record's field, or a list's element – only of
  // the type it is declared as. A CustomerId does not fill a
  // ShareInviteeId, an integer does not fill a Seats. A literal fits
  // any type of its base, and is checked elsewhere. There is no cast:
  // the leniency served only the role-casting projections, which
  // conditional handlers made unnecessary. `increment` and `decrement`
  // are arithmetic, which mixes number types as a command's does.
  const nominalProblem = (arm, event, where) => {
    if (!['set', 'append', 'remove'].includes(arm.operation)) return;
    const unwrapped = operandSource(arm.value) === 'successor' ? arm.value.successor : arm.value;
    const mismatch = (operand, declared, declaredList, holder) => {
      if (operandSource(operand) !== 'event-property') return null;
      const property = (event.properties || []).find((p) => p && p.name === operand.eventProperty);
      if (!property) return null;
      const type = handlerFieldType(model, arm.event || event.name, operand)
        || (operand.property === undefined ? property.propertyType : null);
      if (!type) return null;
      const isList = operand.property === undefined ? !!property.isList : false;
      const listFits = declaredList === null || isList === declaredList;
      if (type === declared && listFits) return null;
      const held = `${typeArticle(type)} ${type}${isList ? '[]' : ''}`;
      // An identifier comes by a tag of its type; any other value by a
      // field declared as it.
      const declaredBody = model['custom-type-definitions'][declared];
      const field = `"${operand.eventProperty}${operand.property !== undefined ? '.' + operand.property : ''}"`;
      const remedy = declaredBody && declaredBody.isTag === true
        ? `tag the event by ${typeArticle(declared)} ${declared}`
        : `declare ${field} of ${arm.event || event.name} as ${typeArticle(declared)} ${declared}`;
      return `${where} sets ${holder} to "${operandText(operand)}", ${held} – but it holds `
        + `${typeArticle(declared)} ${declared}${declaredList ? '[]' : ''}. Nothing converts one into the other: `
        + `${remedy}, or hold ${typeArticle(type)} ${type}.`;
    };
    let problem = null;
    if (operandSource(unwrapped) === 'record') {
      const fields = compositeFieldsOf(model, target.valueType) || [];
      for (const [key, operand] of Object.entries((unwrapped.record && typeof unwrapped.record === 'object') ? unwrapped.record : {})) {
        const field = fields.find((f) => f && f.name === key);
        problem = problem || (field ? mismatch(operand, field.propertyType, !!field.isList, `"${key}"`) : null);
      }
    } else if (arm.operation === 'set') {
      problem = mismatch(unwrapped, target.valueType, !!target.isList, 'it');
    } else {
      // A list takes its element type; append also takes a list of it.
      problem = mismatch(unwrapped, target.valueType, arm.operation === 'append' ? null : false, 'an element');
    }
    if (problem) throw new DomainError(problem);
  };

  // A record value (11.0) is replaced whole: by an event field holding
  // one of its type, by a record of event fields and literals naming
  // every field it requires, or by null. Setting it from one field –
  // or from a record that leaves one out – would merge independent
  // facts into one value, composite state, which stays refused.
  const recordFields = !target.isList ? compositeFieldsOf(model, target.valueType) : null;
  const wholly = recordFields
    ? `a record is replaced whole: set it to an event field holding ${typeArticle(target.valueType)} ${target.valueType}, `
      + `or to { ${recordFields.map((f) => `${f.name}: …`).join(', ')} }.`
    : '';
  const recordValueProblem = (arm, event, where) => {
    const value = arm.value;
    if (operandSource(value) === 'record') {
      if (!recordFields) throw new DomainError(`${where} sets a record, but ${label} holds ${typeArticle(target.valueType)} ${target.valueType}.`);
      const given = value.record && typeof value.record === 'object' && !Array.isArray(value.record) ? value.record : {};
      for (const key of Object.keys(given)) {
        if (!recordFields.some((f) => f.name === key)) throw new DomainError(`${where} sets "${key}", which ${target.valueType} has no field of.`);
        const field = given[key];
        const source = operandSource(field);
        if (source === 'event-property') {
          eventFieldProblem(field, event, arm);
        } else if (source !== 'static' && source !== 'enum-member') {
          throw new DomainError(`${where} sets "${key}" to ${operandText(field)} – a record's field takes an event field or a literal.`);
        } else assertRecognisedOperand(field, where);
      }
      const missing = recordFields.find((f) => !f.isOptional && !(f.name in given));
      if (missing) throw new DomainError(`${where} leaves out "${missing.name}" – ${wholly}`);
      return;
    }
    if (!recordFields || value === null) return;
    if (operandSource(value) === 'event-property') {
      const property = (event.properties || []).find((p) => p.name === value.eventProperty);
      if (!property) return;
      const type = handlerFieldType(model, arm.event, value);
      const field = value.property === undefined ? property
        : (compositeFieldsOf(model, property.propertyType) || []).find((f) => f && f.name === value.property);
      if (!type || !field || (type === target.valueType && !field.isList)) return;
      throw new DomainError(`${where} sets it to "${operandText(value).replace(/^event\.data\./, '')}", ${typeArticle(type)} `
        + `${type}${field.isList ? '[]' : ''} – ${wholly}`);
    }
    throw new DomainError(`${where} sets it to ${operandText(value)} – ${wholly}`);
  };

  // A condition's comparison (11.0): an event field, `==` or `!=`, one
  // of the projection's own tags or a literal. Nothing else is in scope
  // while one event is folded – no other projection, not the state.
  const tagNames = projectionTagParams(target).map((tag) => tag.name);
  const checkLeaf = (leaf, eventName, event, where) => {
    const sides = [leaf.leftHandSide, leaf.rightHandSide];
    if (sides.some((side) => ['projection-read', 'alias-property'].includes(operandSource(side)))) {
      throw new DomainError(`${where} has a condition that reads a projection – a condition reads the event and the projection's tags, nothing else.`);
    }
    if (leaf.predicate !== 'equals') {
      throw new DomainError(`${where} has a condition "${conditionText(leaf)}" – a handler's condition compares with == or !=.`);
    }
    const left = leaf.leftHandSide;
    if (operandSource(left) !== 'event-property') {
      throw new DomainError(`${where} has a condition "${conditionText(leaf)}" – a handler's condition compares an event field (event.data.x) with a tag or a literal.`);
    }
    const property = (event.properties || []).find((p) => p && p.name === left.eventProperty);
    if (!property) {
      throw new DomainError(`${where} has a condition on "${left.eventProperty}", but "${eventName}" does not carry "${left.eventProperty}".`);
    }
    if (left.property !== undefined) {
      const fields = compositeFieldsOf(model, property.propertyType);
      if (!fields || property.isList || !fields.some((field) => field && field.name === left.property)) {
        throw new DomainError(`${where} has a condition on "${left.eventProperty}.${left.property}", which "${eventName}" does not carry.`);
      }
    }
    const right = leaf.rightHandSide;
    const source = operandSource(right);
    if (source === 'parameter') {
      if (right.property !== undefined || !tagNames.includes(right.parameterName)) {
        throw new DomainError(`${where} compares with "${right.parameterName}", which is no tag of ${label}` +
          (tagNames.length ? ` (${tagNames.join(', ')}).` : ' – it has none.'));
      }
    } else if (source !== 'static' && source !== 'enum-member' && source !== 'duration') {
      throw new DomainError(`${where} has a condition "${conditionText(leaf)}" – a handler's condition compares an event field with a tag or a literal.`);
    } else {
      assertRecognisedOperand(right, where);
    }
    // A time against a literal of its kind (11.0): a datetime literal
    // with its offset, a duration against a duration.
    const fieldType = left.property !== undefined
      ? (recordFieldType(model, property.propertyType, left.property) || {}).propertyType : property.propertyType;
    const time = timeBaseOf(model, fieldType);
    if (time && (source === 'static' || source === 'duration')) {
      const problem = source === 'duration' ? (time === 'duration' ? null : `${operandText(right)}, a duration`)
        : timeValueProblem(model, time, right);
      if (problem) throw new DomainError(`${where} compares ${typeArticle(time)} ${time} with ${problem}`);
    } else if (source === 'duration') {
      throw new DomainError(`${where} compares ${operandText(left)}, ${typeArticle(fieldType)} ${fieldType}, with the duration ${operandText(right)}.`);
    }
  };
  for (const handler of handlers || []) {
    if (!handler || !handler.event) {
      throw new DomainError(`A handler on ${label} has no event.`);
    }
    if (handledEvents.has(handler.event)) {
      throw new DomainError(`${label} handles "${handler.event}" twice.`);
    }
    handledEvents.add(handler.event);
    const event = model['event-definitions'][handler.event];
    if (!event) {
      throw new DomainError(`${label} handles "${handler.event}", which this model does not define.`);
    }
    const where = `The handler for "${handler.event}" on ${label}`;
    if (!isConditionalHandler(handler)) {
      checkArm(handler, event, where);
      continue;
    }
    if (handler.operation !== undefined || handler.value !== undefined) {
      throw new DomainError(`${where} states both branches and an operation – the operations go into the branches.`);
    }
    const chains = handlerChains(handler);
    if (!chains.length) throw new DomainError(`${where} has no branches – it applies nothing.`);
    for (const chain of chains) {
      if (!Array.isArray(chain.branches) || !chain.branches.length) {
        throw new DomainError(`${where} has an if chain with no "if" – each starts with one.`);
      }
    }
    for (const arm of handlerArms(handler)) {
      if (!arm.otherwise) {
        if (!arm.condition || typeof arm.condition !== 'object') throw new DomainError(`${where} has a branch with no condition.`);
        for (const leaf of conditionLeaves(arm.condition)) checkLeaf(leaf, handler.event, event, where);
      }
      checkArm(arm, event, where);
    }
  }
}

// What a projection's branched handlers may do that a reader would not
// expect (11.0): two separate `if`s that both `set` it on one event may
// both match, and then the last one wins – an `else if` says which one
// applies. Said whether or not their conditions could both hold:
// telling would take more than a glance.
function handlerAdvisories(label, body) {
  const out = [];
  for (const handler of (body && Array.isArray(body.handlers)) ? body.handlers : []) {
    if (!isConditionalHandler(handler)) continue;
    const setting = handlerChains(handler).filter((step) =>
      handlerArms({ event: handler.event, steps: [step] }).some((arm) => arm.operation === 'set'));
    if (setting.length > 1) {
      out.push(`${label}: the handler for "${handler.event}" sets it in separate ifs that may both match – ` +
        'the last one wins. Join them with else if to say which one applies.');
    }
  }
  return out;
}

// The initial value, checked against the declared type and its
// constraints (`minimum`, `pattern`, …, 11.0). `null` is
// legal for any type – it is the state before anything has happened,
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
        `${where} is not a literal – a list element is a value of the list's type, never null ` +
        'and never a record.'
      );
    }
    if (members) {
      throw new DomainError(
        `${where} is a bare literal, but "${body.valueType}" is an enum – name the member as ` +
        '{"enumMember": "..."} so renaming it rewrites this too.'
      );
    }
    if (typeof element !== expected) {
      throw new DomainError(
        `${where} is ${JSON.stringify(element)}, which is not a ${body.valueType}.`
      );
    }
    const problem = timeValueProblem(model, body.valueType, element);
    if (problem) throw new DomainError(`${where}: ${problem}`);
    // Its type's own constraints, as a scenario's values are held to.
    const refused = payloadValueProblems(model, [{ name: 'value', propertyType: body.valueType, isList: false }], { value: element })[0];
    if (refused) throw new DomainError(`${where} is ${JSON.stringify(element)}, which ${refused.problem}.`);
  };

  const value = body.initialValue;
  if (value === null) return;
  if (body.isList) {
    if (!Array.isArray(value)) {
      throw new DomainError(
        `${label} holds a list, so its initial value is one – empty, or holding typed elements.`
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

// One projection – the one shape behind a grouped projection and a
// top-level one alike: same handlers, same operations, same
// operands. It declares the tags it is read by (8.0), each named and
// of a tag type; none at all is an untagged projection, which folds
// the whole log – what a global numbering is.
function validateProjectionBody(model, projectionName, body) {
  validateProjectionTags(model, projectionName, body);
  const valueCls = classifyType(model, body.valueType);
  if (valueCls.kind === 'unresolved') {
    throw new DomainError(
      `Type "${body.valueType}" (projection "${projectionName}") does not resolve in this model.`
    );
  }
  if (derivedOf(body)) {
    // A derived projection is nothing but its predicate or computation:
    // no initial value (before any event it derives from its operands'
    // initial values), no handlers (its operands' handlers are its
    // query), and one value – a comparison's boolean, or a number.
    if (body.derived.predicate !== undefined && body.derived.operator !== undefined) {
      throw new DomainError(
        `Projection "${projectionName}" states both a predicate and an operator – it compares or it ` +
        'computes, not both. It reads as a comparison until one goes.'
      );
    }
    if (!derivedComputes(body.derived) && !derivedHolds(body.derived) && (body.valueType !== 'boolean' || body.isList)) {
      throw new DomainError(
        `Projection "${projectionName}" is derived by a comparison, so it holds its outcome – ` +
        `one boolean, never ${body.isList ? 'a list' : `${typeArticle(body.valueType)} ${body.valueType}`}.`
      );
    }
    if (body.initialValue !== undefined) {
      throw new DomainError(
        `Projection "${projectionName}" is derived and declares an initial value. Before any ` +
        'event it already derives from its operands\' own initial values – a second start would disagree.'
      );
    }
    if ((body.handlers || []).length) {
      throw new DomainError(
        `Projection "${projectionName}" is derived and declares handlers. Nothing advances a ` +
        'derived projection – its operands\' handlers are its query.'
      );
    }
    validateDerived(model, projectionName, body);
    return;
  }

  // A record (11.0) is held as one value its handlers replace whole –
  // `validateHandlers` says what a whole replacement is. A list of
  // records has no operation that keeps an element whole.
  if (valueCls.kind === 'value' && valueCls.composite && body.isList) {
    throw new DomainError(
      `Projection "${projectionName}" holds a list of "${body.valueType}", a record – a projection ` +
      'holds one record, replaced whole; a list holds single values.'
    );
  }

  if (body.initialValue === undefined) {
    throw new DomainError(
      `Projection "${projectionName}" needs an initial value – it is the value before any event ` +
      'has been applied, and for a numbering it is where the prefix is stated. ' +
      '"null" is a value: no value yet.'
    );
  }
  validateInitialValue(model, `Projection "${projectionName}"`, body);

  // Zero handlers is a legitimate draft: a projection nothing moves
  // yet reads as its initial value, and the interface says so.
  validateHandlers(model, `projection "${projectionName}"`, body, body.handlers);
}

// A projection's parameters. Its tags: each a camelCase name, once, of
// a tag type – the key a read's value is rendered under. Its arguments:
// a camelCase name each, of any type that resolves, and none a tag also
// has, since a read gives both in one list. An argument is not a tag
// and can never narrow a query: the store returns the same events
// either way – which is why a tag-typed value may still be one, and
// why a declared projection, whose handlers see only the event, has no
// use for any. Then whether the events it handles carry the tags
// (`projectionTagProblem`).
function validateProjectionTags(model, projectionName, body) {
  const label = `Projection "${projectionName}"`;
  const seen = new Set();
  for (const tag of projectionTagParams(body)) {
    if (!CAMEL_RE.test(tag.name || '')) {
      throw new DomainError(`${label} has a tag named "${tag.name}", which is not a camelCase name of at least two characters.`);
    }
    if (seen.has(tag.name)) throw new DomainError(`${label} declares the tag "${tag.name}" twice.`);
    seen.add(tag.name);
    if (classifyType(model, tag.tagType).kind === 'unresolved') {
      throw new DomainError(`${label}'s tag "${tag.name}" is typed "${tag.tagType}", which does not resolve in this model.`);
    }
    if (!isTagBearing(model, tag.tagType)) {
      throw new DomainError(
        `${label}'s tag "${tag.name}" is typed ${tag.tagType}, which is no tag type – nothing is ` +
        'tagged by it, so no event would reach this projection.'
      );
    }
  }
  const arguments_ = new Set();
  for (const argument of projectionSlots(body)) {
    if (!CAMEL_RE.test(argument.name || '')) {
      throw new DomainError(`${label} has an argument named "${argument.name}", which is not a camelCase name of at least two characters.`);
    }
    if (seen.has(argument.name)) {
      throw new DomainError(`${label} names both a tag and an argument "${argument.name}".`);
    }
    if (arguments_.has(argument.name)) {
      throw new DomainError(`${label} declares the argument "${argument.name}" twice.`);
    }
    arguments_.add(argument.name);
    if (classifyType(model, argument.propertyType).kind === 'unresolved') {
      throw new DomainError(
        `${label}'s argument "${argument.name}" is typed "${argument.propertyType}", ` +
        'which does not resolve in this model.'
      );
    }
  }
  if (arguments_.size && !derivedOf(body)) {
    throw new DomainError(
      `${label} takes ${[...arguments_].map((n) => `"${n}"`).join(', ')} as ` +
      `${arguments_.size === 1 ? 'an argument' : 'arguments'}, but its handlers see only the event – ` +
      'nothing uses them. Make each a tag, or drop it.'
    );
  }
  const problem = projectionTagProblem(model, projectionName);
  if (problem) throw new DomainError(problem);
}

// The derived predicate: both operands recognised, at least one of
// them a projection read, every read's arguments covering exactly the
// arguments its target takes, enum members belonging to the type they
// sit opposite – and no cycle, since a value derived through itself has
// nowhere to start. A side may be one of the derived projection's own
// parameters (10.0), and so may an operand's tag or argument
// (`{parameterName}`), of the type the slot declares; otherwise a tag
// is a typed literal and an argument a literal.
function validateDerived(model, projectionName, body) {
  const derived = body.derived;
  const label = `projection "${projectionName}"`;
  if (derivedComputes(derived)) {
    if (!DERIVED_OPERATORS.includes(derived.operator)) {
      throw new DomainError(
        `${label} computes through "${derived.operator}", which is not an operator a derived ` +
        `projection knows (${DERIVED_OPERATORS.join(', ')}).`
      );
    }
    if (derived.negate !== undefined) {
      throw new DomainError(`${label} negates a computation – "negate" belongs to a comparison.`);
    }
  } else if (!derivedHolds(derived) && !DERIVED_PREDICATES.includes(derived.predicate)) {
    throw new DomainError(
      `${label} derives through "${derived.predicate}", which is not a predicate a derived ` +
      'projection can state.'
    );
  }

  const reads = derivedReads(derived);
  if (!reads.length) {
    throw new DomainError(
      `${label} derives from no projection – at least one side of its predicate must read one.`
    );
  }

  const own = projectionParameters(body);
  const ownText = own.map((p) => p.name).join(', ') || 'it takes none';
  // A `{parameterName}` – a side, an operand's tag or its argument –
  // names one of this projection's own parameters, whether it is read
  // by it as a tag or takes it as an argument: either way the reader
  // gave its value. Returns the parameter, or throws.
  const ownParameter = (value, where) => {
    const parameter = own.find((p) => p.name === value.parameterName);
    if (!parameter || value.property !== undefined) {
      throw new DomainError(`${where} ${operandText(value)}, which is none of ${projectionName}'s own parameters (${ownText}).`);
    }
    return parameter;
  };

  const checkRead = (operand, collection = null) => {
    const target = projectionsOf(model)[operand.projection];
    if (!target) {
      throw new DomainError(
        `${label} derives from "${operand.projection}", which this model does not define.`
      );
    }
    const held = operand.tags && typeof operand.tags === 'object' && !Array.isArray(operand.tags) ? operand.tags : {};
    const openProblem = openReadProblem(model, operand, !!collection);
    if (openProblem) throw new DomainError(`${label}: ${openProblem}`);
    for (const tag of projectionTagParams(target)) {
      const value = held[tag.name];
      const where = `${label} reads ${operand.projection}`;
      if (value === undefined) {
        throw new DomainError(`${where} without a value for its "${tag.name}" tag (${tag.tagType}).`);
      }
      if (operandSource(value) === 'open') continue;
      if (operandSource(value) === 'parameter') {
        const parameter = ownParameter(value, `${where} tagged`);
        if (parameter.type !== tag.tagType) {
          throw new DomainError(
            `${where} tagged ${value.parameterName}, ${typeArticle(parameter.type)} ${parameter.type} – ` +
            `but its "${tag.name}" tag is ${typeArticle(tag.tagType)} ${tag.tagType}.`
          );
        }
        continue;
      }
      if (operandSource(value) === 'tag-literal') {
        if (value.tagType !== tag.tagType) {
          throw new DomainError(
            `${where} tagged ${operandText(value)} – but its "${tag.name}" tag is ` +
            `${typeArticle(tag.tagType)} ${tag.tagType}.`
          );
        }
        continue;
      }
      throw new DomainError(
        `${where} tagged ${operandText(value)} – an operand's tag is one of ${projectionName}'s own ` +
        'parameters or a typed literal.'
      );
    }
    for (const key of Object.keys(held)) {
      if (!projectionTagParams(target).some((tag) => tag.name === key)) {
        throw new DomainError(`${label} reads ${operand.projection} with "${key}", which is not one of its tags.`);
      }
    }
    const slots = projectionSlots(target);
    const supplied = Object.keys(operand.arguments || {});
    for (const slot of slots) {
      if (!supplied.includes(slot.name)) {
        throw new DomainError(
          `${label} reads "${operand.projection}" without "${slot.name}", which it takes as an argument.`
        );
      }
    }
    for (const key of supplied) {
      const slot = slots.find((s) => s.name === key);
      if (!slot) {
        throw new DomainError(
          `${label} reads "${operand.projection}" with "${key}", which it does not take as an argument.`
        );
      }
      const argument = operand.arguments[key];
      const argumentSource = operandSource(argument);
      if (argumentSource === 'parameter') {
        const parameter = ownParameter(argument, `${label} supplies "${key}" as`);
        if (parameter.type !== slot.propertyType) {
          throw new DomainError(
            `${label} supplies "${key}" as ${argument.parameterName}, ${typeArticle(parameter.type)} ` +
            `${parameter.type} – but ${operand.projection} takes it as ${typeArticle(slot.propertyType)} ${slot.propertyType}.`
          );
        }
        continue;
      }
      if (argumentSource !== 'enum-member' && argumentSource !== 'static') {
        throw new DomainError(
          `${label} supplies "${key}" as "${operandText(argument)}" – an operand's ` +
          `argument is a literal or one of ${projectionName}'s own parameters.`
        );
      }
    }
    const fieldProblem = recordFieldProblem(model, target, operand);
    if (fieldProblem) throw new DomainError(`${label} reads ${operandText(operand)}, but ${fieldProblem}`);
  };

  // A side: a read, a collection function over an open read (11.0),
  // one of its own parameters, an enum member or a literal – or a
  // count of a list one gives (G3), checked as that side is.
  for (let operand of derivedOperands(derived)) {
    assertRecognisedOperand(operand, `An operand of ${label}`);
    if (operandSource(operand) === 'count') {
      const problem = countProblem(model, operand, label, null, (inner) => derivedOperandType(model, inner, body));
      if (problem) throw new DomainError(problem);
      operand = uncounted(operand);
      assertRecognisedOperand(operand, `An operand of ${label}`);
    }
    const source = operandSource(operand);
    if (source === 'parameter') {
      ownParameter(operand, `An operand of ${label} is`);
      continue;
    }
    if (source === 'collection') {
      const problem = collectionProblem(model, operand, `${label}'s ${operandText(operand)}`, (side, where) => {
        if (operandSource(side) === 'parameter') ownParameter(side, `${where} reads`);
      });
      if (problem) throw new DomainError(problem);
      checkRead(operand.read, operand);
      continue;
    }
    if (source !== 'projection-read' && source !== 'static' && source !== 'enum-member' && source !== 'duration') {
      throw new DomainError(
        `An operand of ${label} is "${operandText(operand)}" – a derived projection reads other ` +
        'projections, its own parameters, enum members and literals; nothing else is in scope.'
      );
    }
    if (source === 'projection-read') checkRead(operand);
  }

  // A derived value that holds its operand holds what it yields: a
  // collection's number or boolean, a field, another projection's value.
  if (derivedHolds(derived)) {
    const yielded = derivedOperandType(model, derived.leftHandSide, body);
    if (yielded && (body.isList !== yielded.isList || !sameValueKind(model, yielded.propertyType, body.valueType))) {
      throw new DomainError(
        `${label} holds ${operandText(derived.leftHandSide)}, ${typeArticle(yielded.propertyType)} ` +
        `${yielded.propertyType}${yielded.isList ? '[]' : ''} – but it is declared ` +
        `${body.isList ? `a list of ${body.valueType}` : `${typeArticle(body.valueType)} ${body.valueType}`}.`
      );
    }
  }

  // An enum member is checked against the projection or parameter it
  // sits opposite, the same way a condition's is checked against its
  // alias property.
  const typeOfSide = (operand) => {
    if (operandSource(operand) === 'projection-read' || operandSource(operand) === 'collection') {
      const yielded = derivedOperandType(model, operand, body);
      return yielded ? { type: yielded.propertyType, isList: yielded.isList } : null;
    }
    if (operandSource(operand) === 'parameter') {
      const parameter = own.find((p) => p.name === operand.parameterName);
      return parameter ? { type: parameter.type, isList: false } : null;
    }
    return null;
  };
  const sides = [
    [derived.leftHandSide, derived.rightHandSide],
    [derived.rightHandSide, derived.leftHandSide],
  ];
  for (const [maybeEnum, other] of sides) {
    if (operandSource(maybeEnum) !== 'enum-member') continue;
    const opposite = typeOfSide(other);
    if (!opposite) continue;
    const members = enumMembersFor(model, opposite.type);
    if (members && !members.includes(maybeEnum.enumMember)) {
      throw new DomainError(
        `"${maybeEnum.enumMember}" is not a member of ${opposite.type} (${label}'s predicate).`
      );
    }
  }

  // A parameter compared with a single value is compared as that kind
  // of value: an hour count against a count, a title against a title.
  // A read against a read, or a literal, was always left to evaluation.
  const ordinary = ['equals', 'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals'];
  if (!derivedComputes(derived) && ordinary.includes(derived.predicate)) {
    for (const [side, other] of sides) {
      if (operandSource(side) !== 'parameter') continue;
      const mine = typeOfSide(side);
      const theirs = typeOfSide(other);
      if (!mine || !theirs || theirs.isList) continue;
      if (literalKindOf(model, mine.type) !== literalKindOf(model, theirs.type)) {
        throw new DomainError(
          `${label} compares ${side.parameterName}, ${typeArticle(mine.type)} ${mine.type}, with ` +
          `${operandText(other)}, ${typeArticle(theirs.type)} ${theirs.type} – they are no values of one kind.`
        );
      }
    }
  }

  // A computation takes two single numbers and yields one: an integer
  // from two integers, a number otherwise – and null from a null side,
  // which an ordering against it then errors on, so a side that may be
  // null is said here first.
  if (derivedComputes(derived)) {
    for (const operand of derivedOperands(derived)) {
      if (!derivedInputOf(model, operand, [], body)) {
        throw new DomainError(
          `${label} computes from "${operandText(operand)}", which is not a single number, datetime or duration – ` +
          `"${derived.operator}" takes one on each side.`
        );
      }
    }
    // A time computes with a duration (11.0): a datetime moved by one,
    // two durations added – never two datetimes, never a time and a number.
    const result = derivedResultBase(model, derived, body);
    if (!result) {
      const [left, right] = derivedOperands(derived).map((o) => derivedInputOf(model, o, [], body).base);
      throw new DomainError(
        `${label} computes "${derivedText(derived)}" – ${typeArticle(left)} ${left} ${derived.operator === 'subtract' ? 'minus' : derived.operator} ` +
        `${typeArticle(right)} ${right} means nothing: a datetime moves by a duration, and durations add up.`
      );
    }
    const declared = arithmeticBaseOf(model, body.valueType);
    const numeric = (base) => base === 'integer' || base === 'number';
    const holds = declared === result || (numeric(declared) && numeric(result) && !(result === 'number' && declared === 'integer'));
    if (!declared || body.isList || !holds) {
      throw new DomainError(
        `${label} computes ${typeArticle(result)} ${result}, but holds ` +
        `${body.isList ? `a list of ${body.valueType}` : `${typeArticle(body.valueType)} ${body.valueType}`} – ` +
        `declare it ${numeric(result) ? (result === 'integer' ? 'an integer' : 'a number') : `${typeArticle(result)} ${result}`}.`
      );
    }
    // A time has no value to start at but null – "not yet" – so a
    // computed time may be null, and its reader is the one to guard.
    const nullable = derivedOperands(derived)
      .find((operand) => (derivedInputOf(model, operand, [], body) || {}).nullable);
    if (nullable !== undefined && (result === 'integer' || result === 'number')) {
      throw new DomainError(
        `${label} computes from ${operandText(nullable)}, which can be null – a projection it ` +
        `reads starts at null – so ${projectionName} is null then too, and a rule ordering ` +
        'against it errors. Start that projection at a number.'
      );
    }
  }

  const visit = (name, trail) => {
    const target = projectionsOf(model)[name];
    const inner = target && derivedOf(target);
    if (!inner) return;
    for (const operand of derivedReads(inner)) {
      if (operand.projection === projectionName) {
        throw new DomainError(
          `${label} derives from itself through ${trail.join(' → ')} – a cycle has no value to start from.`
        );
      }
      if (trail.includes(operand.projection)) continue;
      visit(operand.projection, [...trail, operand.projection]);
    }
  };
  for (const operand of reads) {
    if (operand.projection === projectionName) {
      throw new DomainError(`${label} derives from itself – a cycle has no value to start from.`);
    }
    visit(operand.projection, [operand.projection]);
  }
}

// A value type is scalar (an opaque JSON Schema) or composite (typed
// fields) – never both and never neither. `isTag` is meaningful only
// on the scalar form: a composite is never itself a tag, so it may not
// combine with fields.
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
      `Value type "${typeName}" declares both a schema and fields – it is either scalar or composite, not both.`
    );
  }
  if (!hasSchema && !hasFields) {
    throw new DomainError(`Value type "${typeName}" declares neither a schema nor fields.`);
  }

  if (hasFields) {
    if (body.isTag) {
      throw new DomainError(
        `Value type "${typeName}" is composite and marked "represented as a tag" – only a scalar ` +
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
        throw new DomainError(`Field name "${field.name}" on "${typeName}" must be camelCase, at least two characters.`);
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
      // Composites do not nest – an operand reaches one field, never a path.
      if (cls.kind === 'value' && cls.composite) {
        throw new DomainError(
          `Field "${typeName}.${field.name}" is typed with the composite "${field.propertyType}". ` +
          `Composites do not nest – an operand reaches one field, never a path.`
        );
      }
      if (field.isList) {
        throw new DomainError(
          `Field "${typeName}.${field.name}" is a list. A composite's fields are singular, ` +
          `because a list field flattens and would break the index a zipped condition reads by.`
        );
      }
      // An optional field (11.0) is a value that may be absent, read as
      // null – but never a tag: a missing tag field would contribute no
      // tag and shift every later index.
      if (field.isOptional && cls.kind === 'value' && cls.isTag) {
        throw new DomainError(
          `Field "${typeName}.${field.name}" is an optional tag. A composite's tag fields are required, ` +
          `because a missing tag field would contribute no tag and shift every later index.`
        );
      }
    }
  }
}

// A group: one partition tag, named and of a tag type, which its
// projections inherit and so never declare; local names, lowerCamel and
// each once; and a name no top-level projection has, since outside the
// group both are read by that name. An empty group is legal – it is
// where projections are moved into – and advised all the same. What a
// grouped projection gets wrong is advised on it, under its qualified
// name (`checkedDefinitions`).
function validateGroupBody(model, groupName, body) {
  const label = `Group "${groupName}"`;
  if (Object.prototype.hasOwnProperty.call(model['projection-definitions'] || {}, groupName)) {
    throw new DomainError(
      `${label} has the name of a projection – a group and a top-level projection are both read by ` +
      'their name, so one of them has to be renamed.'
    );
  }
  const tag = groupTagOf(body);
  if (!tag) {
    throw new DomainError(`${label} declares no tag – its projections are all read by the one it declares.`);
  }
  if (!CAMEL_RE.test(tag.name || '')) {
    throw new DomainError(`${label}'s tag is named "${tag.name}", which is not a camelCase name of at least two characters.`);
  }
  if (classifyType(model, tag.tagType).kind === 'unresolved') {
    throw new DomainError(`${label}'s tag "${tag.name}" is typed "${tag.tagType}", which does not resolve in this model.`);
  }
  if (!isTagBearing(model, tag.tagType)) {
    throw new DomainError(
      `${label}'s tag "${tag.name}" is typed ${tag.tagType}, which is no tag type – nothing is tagged ` +
      'by it, so no event would reach its projections.'
    );
  }
  const seen = new Set();
  for (const inner of groupProjections(body)) {
    if (!CAMEL_RE.test(inner.name || '')) {
      throw new DomainError(
        `${label} has a projection named "${inner.name}" – a grouped projection's name is local and ` +
        `lowerCamel of at least two characters, read as ${groupName}.${groupLocalName(groupName, inner.name || 'name')}.`
      );
    }
    if (seen.has(inner.name)) throw new DomainError(`${label} has two projections named "${inner.name}".`);
    seen.add(inner.name);
    if (inner.tags !== undefined && !(Array.isArray(inner.tags) && !inner.tags.length)) {
      throw new DomainError(
        `${groupName}.${inner.name} declares tags of its own – a grouped projection is read by its ` +
        `group's tag (${tag.name}: ${tag.tagType}) and by nothing else, so they are ignored. Drop them, ` +
        'or move the projection out of the group.'
      );
    }
  }
  if (!seen.size) {
    throw new DomainError(`${label} has no projections yet – add one, or move one into it.`);
  }
}

function validateCommandBody(model, body) {
  const boundary = body.boundary || [];
  const aliases = new Set();
  // Declaration order *is* the chain: a binding may take a tag from a
  // read bound above it, never from one bound below. One left-to-right
  // pass therefore both resolves the chain and makes a cycle impossible
  // to write.
  const declaredAbove = [];
  for (const binding of boundary) {
    if (!CAMEL_RE.test(binding.alias || '')) {
      throw new DomainError(`Boundary alias "${binding.alias}" must be camelCase, at least two characters.`);
    }
    if (aliases.has(binding.alias)) throw new DomainError(`Boundary alias "${binding.alias}" is bound twice.`);
    aliases.add(binding.alias);
    const chained = (operand, what) => {
      for (const alias of operandAliases(operand)) {
        if (alias === binding.alias) return `Boundary binding "${binding.alias}" takes ${what} from itself.`;
        if (!declaredAbove.includes(alias)) {
          return `Boundary binding "${binding.alias}" takes ${what} from "${operandText(operand)}", ` +
            `but "${alias}" is not bound above it – a binding may only read what is declared earlier.`;
        }
      }
      return null;
    };

    // A projection binding is a read like any other, which is why it
    // lives here: its tags put it in the chain, and its query belongs in
    // the append condition. A grouped projection may be bound too, by
    // its qualified name – `Course(courseId).capacity`.
    if (binding.projection !== undefined) {
      const projection = projectionsOf(model)[binding.projection];
      if (!projection) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" names unknown projection "${binding.projection}".`
        );
      }
      if (binding.group !== undefined) {
        throw new DomainError(`Boundary binding "${binding.alias}" names both a projection and a group.`);
      }
      // A read gives a value for each tag the projection declares – of
      // the declared type, which is the tag's key – and the arguments it
      // takes. What differs is what each does: a tag selects events, an
      // argument reaches the code or the derivation.
      const problem = readProblem(model, body, binding, `Boundary binding "${binding.alias}"`, chained);
      if (problem) throw new DomainError(problem);
      declaredAbove.push(binding.alias);
      continue;
    }

    // A group binding names one instance – or, `each`, many – by the
    // group's one tag, and reads nothing yet: each member a rule reads is
    // its own read (`groupMemberRead`), with its own arguments.
    if (binding.group !== undefined) {
      const group = model['group-definitions'][binding.group];
      if (!group) {
        throw new DomainError(`Boundary binding "${binding.alias}" names unknown group "${binding.group}".`);
      }
      const tag = groupTagOf(group);
      const problem = readTagsProblem(model, body, tag ? [tag] : [], binding,
        `Boundary binding "${binding.alias}" reads ${binding.group}`, chained);
      if (problem) throw new DomainError(problem);
      if (binding.arguments !== undefined && Object.keys(binding.arguments || {}).length) {
        throw new DomainError(
          `Boundary binding "${binding.alias}" gives ${binding.group} arguments – a group takes none; ` +
          `the projection read takes its own, ${binding.alias}.member(…).`
        );
      }
      declaredAbove.push(binding.alias);
      continue;
    }

    throw new DomainError(`Boundary binding "${binding.alias}" reads neither a projection nor a group.`);
  }

  // The steps are what the language can say: rules, emissions, branches
  // whose arms each have a condition, and `reject`s – and a `reject`
  // only inside a branch, since one standing at the top refuses always.
  let stepProblem = null;
  forEachStep(commandSteps(body), (step, at) => {
    if (stepProblem) return;
    const kind = stepKind(step);
    if (!kind) stepProblem = `Step ${at.path.join('.')} is neither a rule, an emission, a branch, a loop nor a reject.`;
    else if (kind === 'reject' && at.depth === 0) {
      stepProblem = `"reject ${JSON.stringify(step.reject)}" stands outside any branch, so the command is always refused.`;
    } else if (kind === 'reject' && rejectionProblem(step.reject)) {
      stepProblem = `The rejection message of "reject" ${rejectionProblem(step.reject)}.`;
    } else if (kind === 'branch' && (!Array.isArray(step.branches) || !step.branches.length)) {
      stepProblem = 'A branch step has no "if" arm.';
    } else if (kind === 'branch' && step.branches.some((arm) => !arm || !arm.condition)) {
      stepProblem = 'A branch arm has no condition – only "else" goes without one.';
    } else if (at.loop) {
      stepProblem = loopStepProblem(step, at);
    }
    if (!stepProblem && kind === 'loop') stepProblem = loopProblem(model, body, step);
  });
  if (stepProblem) throw new DomainError(stepProblem);

  // Every predicate, wherever it decides – a rule, or an arm of a
  // branch. Each is quantified on its own.
  const allConditions = commandConditionLeaves(body);

  // A plural alias cannot supply a single value, so it may be read by a
  // condition – which quantifies over it – but never emitted. Nor may a
  // read in place that fans out.
  for (const emission of commandEmissions(body)) {
    if (!emission.parameters) continue;
    for (const [key, operand] of Object.entries(emission.parameters)) {
      if (operandSource(operand) === 'projection-read' && readFanTag(operand)) {
        throw new DomainError(
          `"${emission.name}.${key}" takes its value from "${operandText(operand)}", which reads many. ` +
          `A fanned-out read can be checked, not emitted.`
        );
      }
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
  // lengths are unrelated – nothing here can assert otherwise, and the
  // zipped and crossed readings look identical on the page.
  for (const condition of allConditions) {
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

  for (const condition of allConditions) {
    if (!condition || condition.predicate !== 'containsAny') continue;
    const left = conditionOperandType(model, body, condition, condition.leftHandSide);
    const right = conditionOperandType(model, body, condition, condition.rightHandSide);
    for (const [side, label] of [[left, 'Left'], [right, 'Right']]) {
      if (side && !side.isList) {
        throw new DomainError(
          `${label} side of "${conditionText(condition)}" is not a list – ` +
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
  for (const condition of allConditions) {
    if (!condition || condition.predicate !== 'contains') continue;
    const left = conditionOperandType(model, body, condition, condition.leftHandSide);
    const right = conditionOperandType(model, body, condition, condition.rightHandSide);
    if (left && !left.isList) {
      throw new DomainError(
        `Left side of "${conditionText(condition)}" is not a list – ` +
        `"contains" asks whether a list holds one value.`
      );
    }
    if (right && right.isList) {
      throw new DomainError(
        `Right side of "${conditionText(condition)}" is a list – "contains" looks for one value. ` +
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

  // `equalsAny` compares one scalar against a literal list – the one
  // operand position that is an array, and the one predicate that
  // reads one. Its entries are literals or enum-member references,
  // never a reference to data (that is `contains`/`containsAny` over a
  // list-typed source) and never null (a membership list may not hold
  // "no value").
  for (const condition of allConditions) {
    if (!condition) continue;
    const isValueList = Array.isArray(condition.rightHandSide);
    if (condition.predicate !== 'equalsAny') {
      if (isValueList) {
        throw new DomainError(
          `"${conditionText(condition)}" compares against a literal list, ` +
          `which only "equalsAny" reads.`
        );
      }
      continue;
    }
    if (!isValueList) {
      throw new DomainError(
        `"${conditionText(condition)}" – "equalsAny" compares against a literal list ` +
        `of values ("equals" is the one-value comparison).`
      );
    }
    const left = conditionOperandType(model, body, condition, condition.leftHandSide);
    if (left && left.isList) {
      throw new DomainError(
        `Left side of "${conditionText(condition)}" is a list – "equalsAny" compares one ` +
        `value against the listed ones ("contains"/"containsAny" read a list).`
      );
    }
    if (!condition.rightHandSide.length) {
      throw new DomainError(
        `"${conditionText(condition)}" lists no values – membership over an empty list is ` +
        `constant: it ${condition.negate ? 'always' : 'never'} holds.`
      );
    }
    for (const entry of condition.rightHandSide) {
      if (entry === null) {
        throw new DomainError(
          `"${conditionText(condition)}" lists null – a membership list may not hold ` +
          `"no value". Spell "unset or one of these" as a separate condition.`
        );
      }
      const source = operandSource(entry);
      if (source !== 'enum-member' && source !== 'static') {
        throw new DomainError(
          `"${conditionText(condition)}" lists "${operandText(entry)}" – an "equalsAny" ` +
          `list holds literals or enum members; membership against data is ` +
          `"contains"/"containsAny" over a list-typed source.`
        );
      }
    }
  }

  let failure = null;
  forEachCommandOperand(body, (operand, meta) => {
    if (failure) return;
    assertRecognisedOperand(operand, meta.where);
    const source = operandSource(operand);
    // Inside a loop its names are in scope beside the payload (11.0).
    const inScope = commandScopeProperties(model, body, meta.loop || null);
    if (source === 'parameter' && !inScope.some((p) => p.name === operand.parameterName)) {
      failure = `${meta.where} reads parameter "${operand.parameterName}", which the command does not declare.`;
      return;
    }
    if (source === 'parameter' && operand.property) {
      const parameter = inScope.find((p) => p.name === operand.parameterName);
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
    // A where (11.0) reads value, the command's parameters, an alias
    // already bound – its value or a field of its record, a value and
    // no read made inside the where – and literals; `value` means
    // nothing outside one; a record is built only by a handler.
    if (meta.inWhere && (['projection-read', 'collection'].includes(source)
      || (source === 'alias-property' && (operand.property !== undefined || operand.arguments !== undefined)))) {
      failure = `${meta.where} reads ${operandText(operand)} – a where reads value, parameters, aliases and literals, never a projection.`;
      return;
    }
    if (source === 'instance-value' && !meta.inWhere) {
      const held = loopValueType(model, meta.loop);
      if (!held) {
        failure = `${meta.where} reads ${operandText(operand)}, which only a collection function's where has, or a for each over an open read.`;
        return;
      }
      const field = operand.field === undefined ? null : recordFieldProblem(model, { valueType: held.propertyType, isList: held.isList }, operand);
      if (field) { failure = `${meta.where} reads ${operandText(operand)}, but ${field}`; return; }
    }
    if (source === 'record') {
      failure = `${meta.where} builds a record – only a handler sets one.`;
      return;
    }
    if (source === 'duration') {
      failure = timeValueProblem(model, 'duration', operand.duration);
      if (failure) failure = `${meta.where}: ${failure}`;
      return;
    }
    if (source === 'arithmetic') {
      failure = arithmeticProblem(model, operand, meta, {
        boundary, commandProperties: inScope, model, instanceValue: loopValueType(model, meta.loop || null),
      });
      return;
    }
    if (source === 'collection') {
      failure = collectionProblem(model, operand, `${meta.where} ${operandText(operand)}`, undefined, true);
      return;
    }
    // A count (G3) counts a list: a list parameter or record field, a
    // list projection, `list(…)`. Never in a read's tag or a where.
    if (source === 'count') {
      if (meta.inWhere || meta.tag) {
        failure = `${meta.where} counts ${operandText(operand.count)} – ${meta.inWhere ? 'a where compares value with what is in scope, and computes nothing' : 'a tag\'s value is read, never computed'}.`;
        return;
      }
      failure = countProblem(model, operand, `${meta.where}`, {
        boundary, commandProperties: inScope, model, instanceValue: loopValueType(model, meta.loop || null),
      });
      return;
    }
    if (source === 'projection-read') {
      failure = openReadProblem(model, operand, !!meta.collection && meta.collection.read === operand,
        !!meta.loopSource && meta.loopSource.in === operand)
        || readProblem(model, body, operand, meta.where)
        || (() => {
          const problem = recordFieldProblem(model, projectionsOf(model)[operand.projection], operand);
          return problem ? `${meta.where} reads ${operandText(operand)}, but ${problem}` : null;
        })();
      return;
    }
    if (source === 'alias-property' && operand.field !== undefined) {
      const binding = boundary.find((b) => b.alias === operand.alias);
      const target = binding && (binding.projection ? projectionsOf(model)[binding.projection]
        : binding.group !== undefined && operand.property ? projectionsOf(model)[qualifiedProjectionName(binding.group, operand.property)] : null);
      const problem = recordFieldProblem(model, target, operand);
      if (problem) { failure = `${meta.where} reads ${operandText(operand)}, but ${problem}`; return; }
    }
    if (source === 'alias-property') {
      const binding = boundary.find((b) => b.alias === operand.alias);
      if (!binding) {
        failure = `${meta.where} reads "${operandText(operand)}", but "${operand.alias}" is not bound in the boundary.`;
        return;
      }
      // A projection holds one value and has no name for it, so the
      // alias alone names it. A group holds many, so it cannot – and the
      // member it names is a read of its own, arguments and all.
      if (binding.projection) {
        if (operand.property) {
          failure = `${meta.where} reads "${operandText(operand)}", but "${operand.alias}" binds the `
            + `projection "${binding.projection}", which holds one value and no property "${operand.property}".`;
        } else if (operand.arguments !== undefined) {
          failure = `${meta.where} gives "${operand.alias}" arguments – its read already gave them.`;
        }
        return;
      }
      if (binding.group === undefined) return;
      if (!operand.property) {
        failure = `${meta.where} reads "${operand.alias}" with no projection, but "${operand.alias}" binds `
          + `${binding.group}, which holds many – name the one it means.`;
        return;
      }
      const read = groupMemberRead(binding, operand);
      const projection = projectionsOf(model)[read.projection];
      if (!projection) {
        failure = model['group-definitions'][binding.group]
          ? `${meta.where} reads "${operandText(operand)}", but ${binding.group} has no projection "${operand.property}".`
          : null;
        return;
      }
      failure = readArgumentsProblem(projection, read, `${meta.where} reads ${operandText(operand)}`);
    }
  });
  if (failure) throw new DomainError(failure);

  // A time is compared with a time of its kind (11.0): a datetime with a
  // datetime – a string opposite one has to read as one, offset and all
  // – and a duration with a duration.
  for (const condition of allConditions) {
    if (!condition || condition.rightHandSide === undefined || Array.isArray(condition.rightHandSide)) continue;
    const problem = timeComparisonProblem(model, condition,
      (operand) => conditionOperandType(model, body, condition, operand));
    if (problem) throw new DomainError(problem);
  }

  // Enum members are checked against the alias property they sit
  // opposite, which is where a status comparison always appears. In an
  // `equalsAny` list every entry sits opposite the left-hand side.
  for (const condition of allConditions) {
    if (!condition || condition.rightHandSide === undefined) continue;
    const sides = Array.isArray(condition.rightHandSide)
      ? condition.rightHandSide.map((entry) => [entry, condition.leftHandSide])
      : [[condition.leftHandSide, condition.rightHandSide], [condition.rightHandSide, condition.leftHandSide]];
    for (const [maybeEnum, other] of sides) {
      if (operandSource(maybeEnum) !== 'enum-member') continue;
      if (operandSource(other) === 'projection-read') {
        const read = projectionsOf(model)[other.projection];
        const members = read && enumMembersFor(model, read.valueType);
        if (members && !members.includes(maybeEnum.enumMember)) {
          throw new DomainError(
            `"${maybeEnum.enumMember}" is not a member of ${read.valueType} (condition "${conditionText(condition)}").`
          );
        }
        continue;
      }
      if (operandSource(other) !== 'alias-property') continue;
      const binding = boundary.find((b) => b.alias === other.alias);
      // A projection binding's value type is not examined here; a group
      // member is checked against its projection – the same resolution
      // the rename rewrite walks.
      if (!binding || binding.group === undefined || !other.property) continue;
      const projection = projectionsOf(model)[qualifiedProjectionName(binding.group, other.property)];
      if (!projection) continue;
      const members = enumMembersFor(model, projection.valueType);
      if (members && !members.includes(maybeEnum.enumMember)) {
        throw new DomainError(
          `"${maybeEnum.enumMember}" is not a member of ${projection.valueType} ` +
          `(condition "${conditionText(condition)}").`
        );
      }
    }
  }

  // Optional-parameter hazards. Neither is a structural fault – the
  // model loads and evaluates – but each is a surprise waiting on the
  // first unset value, and this (an advisory, like every semantic
  // finding) is where it gets said before that value arrives. Where a
  // branch or an earlier rule has made sure of the value – inside `if x
  // is not empty`, after `require x is not empty` – there is none
  // (`walkPresence`).
  const readsOptionalParameter = (operand, present = new Set()) =>
    operandSource(operand) === 'parameter'
    && !present.has(operand.parameterName)
    && (body.properties || []).some(
      (p) => p.name === operand.parameterName && p.isOptional
    );
  // Where each alias is used, and what is present there: a read made
  // lazily is made only where it is used, so it is safe from an unset
  // tag wherever every use is.
  const usedWith = new Map();
  const noteUses = (operand, present) => {
    for (const alias of operandAliases(operand)) {
      if (!usedWith.has(alias)) usedWith.set(alias, []);
      usedWith.get(alias).push(present);
    }
  };
  let emissionHazard = null;
  walkPresence(commandSteps(body), (step, present) => {
    if (stepKind(step) !== 'emit') return;
    for (const operand of Object.values(step.parameters || {})) noteUses(operand, present);
    const event = model['event-definitions'][step.name];
    if (!event || emissionHazard) return;
    for (const property of event.properties || []) {
      if (property.isOptional) continue;
      const operand = (step.parameters || {})[property.name];
      if (operand !== undefined && readsOptionalParameter(operand, present)) {
        emissionHazard =
          `"${step.name}.${property.name}" is required, but takes its value from optional ` +
          `parameter "${operand.parameterName}" – when that is unset, this publishes null into ` +
          `a property every reader may assume present. Emit it inside "if ${operand.parameterName} ` +
          `is not empty", mark the event property optional too, or make the parameter required.`;
        return;
      }
    }
  }, new Set(), (condition, present) => forEachLeafPresence(condition, present, (leaf, here) => {
    for (const operand of conditionOperands(leaf)) noteUses(operand, here);
  }));
  if (emissionHazard) throw new DomainError(emissionHazard);
  // What an emission writes into a field has to be what the event
  // declares there. Nothing converts on the way: an emission copies the
  // value it reads, so a `CartLine[]` mapped into an `Item[]` field
  // publishes cart lines under the item type's name, and every reader of
  // the event folds a shape it was never told about. Operands whose type
  // cannot be worked out (literals, dangling references) are left alone.
  // Inside a loop, what its names and `value` hold (11.0).
  const emissionsAt = [];
  forEachStep(commandSteps(body), (step, { loop }) => { if (stepKind(step) === 'emit') emissionsAt.push({ emission: step, loop }); });
  for (const { emission, loop } of emissionsAt) {
    const event = model['event-definitions'][emission.name];
    if (!event) continue;
    for (const property of event.properties || []) {
      const operand = (emission.parameters || {})[property.name];
      if (operand === undefined) continue;
      const resolved = resolveOperandType(operand, {
        boundary, commandProperties: commandScopeProperties(model, body, loop), model,
        instanceValue: loopValueType(model, loop),
      });
      if (!resolved) continue;
      if (resolved.propertyType !== property.propertyType || resolved.isList !== !!property.isList) {
        throw new DomainError(
          `"${emission.name}.${property.name}" is declared ` +
          `${property.propertyType}${property.isList ? '[]' : ''}, but takes its value from ` +
          `"${operandText(operand)}", which is ${resolved.propertyType}${resolved.isList ? '[]' : ''}.`
        );
      }
    }
  }
  // Arguments are deliberately exempt: they reach a derivation as
  // ordinary values, and null is one. A read's tag becomes
  // a tag, and null has no tag – evaluation errors when it is unset, and
  // this says so first, unless every use of the read is where the value
  // is present. A read another read is reached through is used where
  // that one is.
  for (const binding of [...boundary].reverse()) {
    for (const alias of bindingDependsOn(body, binding)) {
      if (!usedWith.has(alias)) usedWith.set(alias, []);
      usedWith.get(alias).push(...(usedWith.get(binding.alias) || [new Set()]));
    }
  }
  for (const binding of boundary) {
    const uses = usedWith.get(binding.alias) || [];
    const feed = readTagEntries(binding).find(([, operand]) => (uses.length
      ? uses.some((present) => readsOptionalParameter(operand, present)) : readsOptionalParameter(operand)));
    if (feed) {
      const [name, operand] = feed;
      throw new DomainError(
        `Boundary binding "${binding.alias}" takes its "${name}" tag from optional parameter ` +
        `"${operand.parameterName}" – evaluation errors when it is unset. ` +
        `Make the parameter required, or take the boundary off it.`
      );
    }
  }

  // The derived cousin of the same hazard: a group's tag read off
  // another binding's value can be unset too – a projection that starts
  // at null reads null until something sets it, and the binding then
  // errors on exactly the first interesting case (nothing assigned
  // yet). Statically knowable only from the initial value.
  for (const binding of boundary) {
    if (binding.group === undefined) continue;
    if (isFannedOut(model, body, binding)) continue;
    const [entry] = readTagEntries(binding);
    const tagged = entry && entry[1];
    if (operandSource(tagged) !== 'alias-property') continue;
    const source = boundary.find((b) => b && b.alias === tagged.alias);
    if (!source) continue;
    const projection = source.projection !== undefined
      ? projectionsOf(model)[source.projection]
      : (source.group !== undefined && tagged.property
        ? projectionsOf(model)[qualifiedProjectionName(source.group, tagged.property)]
        : null);
    if (!projection || derivedOf(projection)) continue;
    if (projection.initialValue === null) {
      throw new DomainError(
        `Boundary binding "${binding.alias}" takes its tag from ${operandText(tagged)}, ` +
        `which starts at null – evaluation errors until something sets it.`
      );
    }
  }

  if (!commandEmissions(body).length) {
    throw new DomainError('A command must publish at least one event: a command without an event is a query, outside the model.');
  }
}

// ============================================================
// Scenarios.
//
// One command, exercised. `given` is a log written by hand rather than
// driven – events with their payloads and the instant each was
// recorded; `when` is the command and the arguments it is called with;
// `then` is what the current definitions make of that, frozen at the
// moment it was accepted.
//
// The freezing is the whole mechanism. `then` is *derived* – nothing
// here asks a modeler to predict it – but it is stored, so the next
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
// stored as whatever was typed, and a run says so (11.0,
// `evScenarioPayload`). Structure is checked – no property invented, a
// list where a list is declared – and the rest is the evaluator's to
// discover.
// ============================================================

// Checks a stored payload against the properties it is written from.
// An invented property is a reference nothing would ever rewrite. A
// property left out is unspecified (11.0, partial scenarios) – the
// scenario does not depend on it – except a tag of an event (`tags`,
// the event's list): tags decide which reads see an event, so a
// scenario always gives them, an optional one as its null. Shared by
// both scenario kinds, so the two never disagree about what a payload
// owes.
function checkScenarioPayload(values, properties, label, tags = []) {
  const held = values || {};
  const declared = new Set();
  const tagged = new Set((tags || []).map((path) => String(path).split('.')[0]));
  for (const property of properties || []) {
    declared.add(property.name);
    if (!(property.name in held)) {
      if (property.isOptional || !tagged.has(property.name)) continue;
      throw new DomainError(`${label} leaves out the tag "${property.name}" – a scenario gives every tag.`);
    }
    if (property.isList && !Array.isArray(held[property.name]) && !(property.isOptional && held[property.name] === null)) {
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
    const event = model['event-definitions'][step.event] || {};
    checkScenarioPayload(step.data, event.properties, `${where} ("${step.event}")`, event.tags);
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
    const definition = model['event-definitions'][event.type] || {};
    checkScenarioPayload(event.data, definition.properties, `Expected event ${index + 1} ("${event.type}")`, definition.tags);
  });
  if (then.outcome === 'rejected' && typeof then.rejection !== 'string') {
    throw new DomainError('A scenario that expects a refusal has to say which message it was refused with.');
  }
}

// One projection, exercised by replay rather than by a command: `given`
// is the same shape a scenario's is, but there is no `when` to call and
// no boundary to infer an instance from, so its tags name it outright.
// `then` is *derived*, exactly like a scenario's, frozen at the moment
// it was accepted. A grouped projection is named qualified.
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
    const event = model['event-definitions'][step.event] || {};
    checkScenarioPayload(step.data, event.properties, `${where} ("${step.event}")`, event.tags);
  });

  const projection = projectionsOf(model)[body.projection];
  if (!projection) {
    throw new DomainError(
      `This scenario is about projection "${body.projection}", which this model does not define.`
    );
  }
  // It reads the projection the way a command does: one value for each
  // tag it declares – literals here, each stating its type,
  // `CourseId("c1")` – and with the arguments it takes, required
  // there and rejected anywhere else: an argument that means nothing is
  // a mistake, not a no-op.
  if (body.tags !== undefined && (body.tags === null || typeof body.tags !== 'object' || Array.isArray(body.tags))) {
    throw new DomainError('A projection scenario\'s tags are named – one value per tag the projection declares.');
  }
  const held = body.tags || {};
  const declared = projectionTagParams(projection);
  for (const tag of declared) {
    const value = held[tag.name];
    if (value === undefined) {
      throw new DomainError(`This scenario gives no value for ${body.projection}'s "${tag.name}" tag (${tag.tagType}).`);
    }
    if (operandSource(value) !== 'tag-literal' || operandIncomplete(value)) {
      throw new DomainError(
        `This scenario is tagged ${operandText(value)}, which is not a tag literal – write it with its ` +
        `type, ${tag.tagType}("…").`
      );
    }
    if (value.tagType !== tag.tagType) {
      throw new DomainError(
        `This scenario is tagged ${operandText(value)}, but ${body.projection}'s "${tag.name}" tag is ` +
        `${typeArticle(tag.tagType)} ${tag.tagType}.`
      );
    }
    if (value.tagValue === null || value.tagValue === undefined) {
      throw new DomainError(`This scenario is tagged ${value.tagType} with no value – a tag has one.`);
    }
  }
  for (const key of Object.keys(held)) {
    if (!declared.some((tag) => tag.name === key)) {
      throw new DomainError(`This scenario gives "${key}", which is not one of ${body.projection}'s tags.`);
    }
  }
  const expected = projectionSlots(projection);
  const supplied = Object.keys(body.arguments || {});
  for (const parameter of expected) {
    if (!supplied.includes(parameter.name)) {
      throw new DomainError(
        `This scenario supplies no "${parameter.name}", which "${body.projection}" takes as an argument.`
      );
    }
  }
  for (const key of supplied) {
    if (!expected.some((p) => p.name === key)) {
      throw new DomainError(
        `This scenario supplies "${key}", which "${body.projection}" does not take as an argument.`
      );
    }
  }
  // `then` is the projection's own value, so every shape one can hold
  // is legal here – `null` and `[]` included. There is nothing left to
  // check that the fold itself does not.
  if (!('then' in body)) {
    throw new DomainError('A projection scenario\'s Then is what the projection folded to.');
  }
}

// The structural gate – the one refusal left on the write path. A
// body that is not an object, or whose container fields are not the
// lists they claim to be, is not a defective definition but no
// definition at all: storing it would crash the projection and the
// renderer rather than merely mislead them. So is a body saying what
// 11.0 removed (`removedConstructIn`). Everything semantic – what the
// containers *say* – is an advisory now, never a refusal.
const STORABLE_LIST_FIELDS = [
  'properties', 'handlers', 'boundary', 'steps', 'parameters', 'given', 'projections',
];

// What 11.0 removed, where a body still says it: the first such
// construct, as `{construct, what}` – `what` the clause naming it,
// after the definition's name – or null. A grouped projection is
// found under its local name (`local`). Nothing below the write path
// knows these constructs any more, so a body saying one is no
// definition this build can mean: the write path refuses it, and the
// importer refuses, or leaves out, what says one
// (`refuseRemovedConstructs`).
const REMOVED_CONSTRUCTS = {
  scripted: '11.0 has no scripted projections',
  currentValue: '11.0 has no currentValue',
  guard: '11.0 has no guarded emissions',
  optional: '11.0 has no optional reads',
};

function removedConstructIn(kind, body) {
  if (!body || typeof body !== 'object') return null;
  const list = (value) => (Array.isArray(value) ? value : []);
  const mentions = (value, key) => !!value && typeof value === 'object'
    && (Object.prototype.hasOwnProperty.call(value, key) || Object.values(value).some((inner) => mentions(inner, key)));
  if (kind === 'group-definition') {
    for (const inner of list(body.projections)) {
      const found = removedConstructIn('projection-definition', inner);
      if (found) return { ...found, local: inner.name };
    }
    return null;
  }
  if (kind === 'projection-definition') {
    if (body.script !== undefined || list(body.handlers).some((h) => h && h.code !== undefined)) {
      return { construct: 'scripted', what: 'is scripted' };
    }
    if (list(body.handlers).some((h) => h && handlerArms(h).some((arm) => mentions(arm.value, 'currentValue')))) {
      return { construct: 'currentValue', what: 'sets a value from currentValue' };
    }
  }
  if (kind === 'command-definition') {
    // In a document from before steps, or in a step.
    const guarded = [...list(body.publishes), ...commandEmissions(body)].find((e) => e && e.when !== undefined
      && !(Array.isArray(e.when) && !e.when.length));
    if (guarded) return { construct: 'guard', what: `guards its emission of "${guarded.name}" (when …)`, emission: guarded.name };
    const optional = list(body.boundary).find((b) => b && b.isOptional === true);
    if (optional) return { construct: 'optional', what: `reads "${optional.alias}" optionally (${optional.alias}?)`, alias: optional.alias };
  }
  return null;
}

// The sentence a removed construct is refused with, naming its
// definition – a grouped projection by its qualified name.
function removedConstructMessage(kind, name, found) {
  const label = kind === 'command-definition' ? 'Command' : 'Projection';
  const subject = found.local !== undefined ? `${name}.${found.local}` : name;
  return `${label} ${subject ? `"${subject}" ` : ''}${found.what} – ${REMOVED_CONSTRUCTS[found.construct]}`;
}

function assertStorableBody(kind, body, name = null) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError(`A ${humanize(kind)} body must be an object.`);
  }
  const removed = removedConstructIn(kind, body);
  if (removed) {
    throw new DomainError(`${removedConstructMessage(kind, name, removed)}.`);
  }
  for (const field of STORABLE_LIST_FIELDS) {
    if (body[field] === undefined) continue;
    if (!Array.isArray(body[field])) {
      throw new DomainError(`A ${humanize(kind)}'s "${field}" must be a list.`);
    }
    for (const element of body[field]) {
      if (element !== null && typeof element !== 'object') {
        throw new DomainError(
          `A ${humanize(kind)}'s "${field}" must hold objects – got ${JSON.stringify(element)}.`
        );
      }
    }
  }
  // A command says what it does as one list, `steps` (11.0): the two
  // lists it had before are a shape this build no longer means. Inside
  // a branch, each arm's steps and `otherwise` are lists of objects too.
  if (kind === 'command-definition') {
    for (const field of ['conditions', 'publishes']) {
      if (body[field] !== undefined) {
        throw new DomainError(`A command's "${field}" is gone – 11.0 says its rules and emissions in order, as "steps".`);
      }
    }
    const steps = (list, where, inLoop = false) => {
      if (!Array.isArray(list)) throw new DomainError(`A command's ${where} must be a list.`);
      for (const step of list) {
        if (step === null || typeof step !== 'object' || Array.isArray(step)) {
          throw new DomainError(`A command's ${where} must hold objects – got ${JSON.stringify(step)}.`);
        }
        // A loop (11.0): its names, a source to read and steps – and
        // never one loop inside another.
        if (step.forEach !== undefined) {
          if (inLoop) throw new DomainError('A "for each" stands inside another – a loop does not nest.');
          if (!Array.isArray(step.forEach) || !step.forEach.length || step.forEach.some((n) => typeof n !== 'string')) {
            throw new DomainError('A loop\'s "forEach" must be a non-empty list of the names it binds.');
          }
          if (step.in === null || typeof step.in !== 'object' || Array.isArray(step.in)) {
            throw new DomainError('A loop\'s "in" must be the operand it runs over.');
          }
          steps(step.steps === undefined ? [] : step.steps, 'loop\'s "steps"', true);
          continue;
        }
        if (step.branches === undefined) continue;
        if (!Array.isArray(step.branches) || step.branches.some((arm) => arm === null || typeof arm !== 'object')) {
          throw new DomainError('A branch step\'s "branches" must be a list of {condition, steps}.');
        }
        for (const arm of step.branches) steps(arm.steps === undefined ? [] : arm.steps, 'branch arm\'s "steps"', inLoop);
        if (step.otherwise !== undefined) steps(step.otherwise, 'branch\'s "otherwise"', inLoop);
      }
    };
    if (body.steps !== undefined) steps(body.steps, '"steps"');
  }
  // An event's tags are paths, not objects – the one list of strings.
  if (kind === 'event-definition' && body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      throw new DomainError('An event\'s "tags" must be a list of property paths.');
    }
  }
  // A branched handler's chains are objects, each arm an object and
  // `otherwise` one (11.0) – whatever they say is the advisories' to
  // judge.
  if (kind === 'projection-definition') {
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    for (const handler of Array.isArray(body.handlers) ? body.handlers : []) {
      if (!handler || handler.steps === undefined) continue;
      if (!Array.isArray(handler.steps) || !handler.steps.every(object)) {
        throw new DomainError('A handler\'s "steps" must be a list of {branches, otherwise}.');
      }
      for (const step of handler.steps) {
        if (step.branches !== undefined && (!Array.isArray(step.branches) || !step.branches.every(object))) {
          throw new DomainError('A handler\'s "branches" must be a list of {condition, operation, value}.');
        }
        if (step.otherwise !== undefined && !object(step.otherwise)) {
          throw new DomainError('A handler\'s "otherwise" must be one {operation, value}.');
        }
      }
    }
  }
  // A projection's are its declared tags, `{name, tagType}` each.
  if (kind === 'projection-definition' && body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => tag === null || typeof tag !== 'object')) {
      throw new DomainError('A projection\'s "tags" must be a list of {name, tagType}.');
    }
  }
  // A group's one tag is an object, and its projections are keyed by
  // their local names – `Course.capacity` has to mean one of them – so a
  // missing or repeated name is a key collision, refused like any other.
  if (kind === 'group-definition') {
    if (body.tag !== undefined && (body.tag === null || typeof body.tag !== 'object' || Array.isArray(body.tag))) {
      throw new DomainError('A group\'s "tag" must be one {name, tagType}.');
    }
    const names = new Set();
    for (const inner of body.projections || []) {
      if (!inner) continue;
      if (typeof inner.name !== 'string' || !inner.name.trim()) {
        throw new DomainError('Every projection of a group has a name.');
      }
      if (names.has(inner.name)) throw new DomainError(`A group has two projections named "${inner.name}".`);
      names.add(inner.name);
      assertStorableBody('projection-definition', inner);
    }
  }
}

// A group and a top-level projection are both read by their names, so
// they share one namespace: the one collision across two collections.
function assertNoNameClash(model, kind, name) {
  const other = kind === 'group-definition' ? 'projection-definition'
    : kind === 'projection-definition' ? 'group-definition' : null;
  if (other && Object.prototype.hasOwnProperty.call(model[DEF_COLLECTIONS[other]], name)) {
    throw new DomainError(`A ${humanize(other).toLowerCase()} named "${name}" already exists – a group and a `
      + 'projection are both read by their names, so they cannot share one.');
  }
}

// A grouped projection as its group stores it: the body without a
// `name` or `tags` of its own, under its local name.
function storedGroupProjection(localName, body) {
  const { name, tags, ...rest } = body || {};
  return { name: localName, ...rest };
}

function addDefinition(kind, modelId, name, body) {
  const model = getCtxOrThrow(modelId);
  const trimmed = validateDefinitionKey(kind, name, `${humanize(kind)} name`);
  // A grouped projection is added the way it is read: `Course.capacity`.
  const split = kind === 'projection-definition' ? splitQualifiedName(trimmed) : null;
  if (split) {
    addGroupProjection(modelId, split.group, split.local, body);
    return;
  }
  assertStorableBody(kind, body, trimmed);
  const coll = collectionOfKind(model, kind);
  if (trimmed in coll) {
    throw new DomainError(`A ${humanize(kind)} named "${trimmed}" already exists in this model.`);
  }
  assertNoNameClash(model, kind, trimmed);
  appendEvents([{ type: `${kind}-added`, data: { 'dcb-model-id': modelId, name: trimmed, body } }]);
}

// An update may leave *other* definitions broken – a dropped projection
// a command still reads, a reshaped tag under a read of it, a type
// nothing created. All of it used to be refused here; all of it is
// representable now, and the resulting breakage surfaces as advisories
// on whichever definitions it lands on. The rename functions below
// remain the way to move a name *and* its references in one append.
function validateDefinitionUpdate(model, kind, name, body) {
  const coll = collectionOfKind(model, kind);
  if (!(name in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${name}" exists in this model.`);
  }
  assertStorableBody(kind, body, name);
}

function updateDefinition(kind, modelId, name, body) {
  updateDefinitions(modelId, [{ kind, name, body }]);
}

// Several updates as one append: a gesture that touches every command
// in a feature grows the log by one step and writes storage once.
// Each change is validated against the model as it stood before the
// gesture – sound because the callers touch a different definition
// each, so no change needs to see another one applied. A grouped
// projection is updated by its qualified name, as it is read; the
// change lands on its group, `tags` dropped – it has none of its own –
// and several to one group are one update of it.
function updateDefinitions(modelId, changes) {
  const model = getCtxOrThrow(modelId);
  const groups = new Map();
  const direct = [];
  for (const change of changes) {
    const entry = change.kind === 'projection-definition' ? groupProjectionEntry(model, change.name) : null;
    if (!entry) { direct.push(change); continue; }
    assertStorableBody('projection-definition', change.body, change.name);
    if (!groups.has(entry.groupName)) groups.set(entry.groupName, deepClone(entry.group));
    // A body read off `projectionsOf` spells its siblings from outside
    // (`Course.capacity` by the group's tag passed on); stored, they are
    // the bare siblings again, so an edit made on that view round-trips.
    const stored = storedGroupProjection(entry.local, deepClone(change.body));
    siblingReadsInside(stored.derived, entry.groupName, groupTagOf(entry.group));
    groups.get(entry.groupName).projections[entry.index] = stored;
  }
  const all = [...direct, ...[...groups].map(([name, body]) => ({ kind: 'group-definition', name, body }))];
  // Reads follow the rules, and this is the one place that is true.
  // Pruning here rather than in every caller means one gesture is one
  // append: deleting the last rule about a read deletes the read in the
  // same event, and a rule that brought a read with it stored both at
  // once. It is deliberately not in `addDefinition` – a body arriving
  // whole, from a file or an agent, keeps what it came with until
  // someone edits it, and `modelAdvisories` says so meanwhile.
  for (const change of all) {
    if (change.kind === 'command-definition' && change.body) {
      pruneUnreferencedBindings(model, change.body);
    }
  }
  for (const { kind, name, body } of all) validateDefinitionUpdate(model, kind, name, body);
  appendEvents(all.map(({ kind, name, body }) => (
    { type: `${kind}-updated`, data: { 'dcb-model-id': modelId, name, body } }
  )));
}

function renameDefinition(kind, modelId, previousName, newName) {
  const model = getCtxOrThrow(modelId);
  if (isIdKeyed(kind)) {
    throw new DomainError(
      `A ${humanize(kind)} is identified by a generated id and its name lives in its body, ` +
      'so renaming one is an ordinary update rather than a rename.'
    );
  }
  // A grouped projection keeps its group: renaming `Course.capacity` is
  // renaming the local name, given bare or qualified by the same group.
  // Leaving the group is `moveProjectionOutOfGroup`.
  const entry = kind === 'projection-definition' ? groupProjectionEntry(model, previousName) : null;
  if (entry) {
    const target = splitQualifiedName(String(newName || '').trim());
    if (target && target.group !== entry.groupName) {
      throw new DomainError(`Renaming keeps ${previousName} in ${entry.groupName} – moving it out or into another group is a move.`);
    }
    renameMember('group-definition', modelId, entry.groupName, 'projection', entry.local,
      target ? target.local : newName);
    return;
  }
  const trimmed = validateName(newName, `New ${humanize(kind)} name`);
  const coll = collectionOfKind(model, kind);
  if (!(previousName in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${previousName}" exists in this model.`);
  }
  if (trimmed === previousName) return;
  if (trimmed in coll) {
    throw new DomainError(`A ${humanize(kind)} named "${trimmed}" already exists in this model.`);
  }
  assertNoNameClash(model, kind, trimmed);

  const referencers = findReferencers(model, kind, previousName);
  const events = [{
    type: `${kind}-renamed`,
    data: { 'dcb-model-id': modelId, 'previous-name': previousName, name: trimmed },
  }];
  for (const ref of referencers) {
    // A definition can reference itself – a derived projection reading
    // itself, a group whose projections read their siblings qualified.
    // That rewrite lands on the new name, since the rename event is
    // applied first.
    const isSelf = ref.kind === kind && ref.name === previousName;
    const rewritten = rewriteReferences(ref.kind, ref.body, kind, previousName, trimmed);
    events.push({
      type: `${ref.kind}-updated`,
      data: { 'dcb-model-id': modelId, name: isSelf ? trimmed : ref.name, body: rewritten },
    });
  }
  appendEvents(events);
}

// ------------------------------------------------------------
// Groups.
//
// Making one, filling it, and moving a projection in or out – each one
// append, so one undo step. Moving is a refactoring: the projection
// changes its name (`CourseCapacity` ⇄ `Course.capacity`), drops or
// regains its tag, and every read of it is rewritten in the same
// append – a command's alias or read in place, a derived operand, a
// projection scenario – so a model reads the same before and after. A
// group alias's member read, moved out, becomes the read in place it
// stood for; a group binding left reading nothing goes with it.
// ------------------------------------------------------------

// A new, empty group – `tag` its partition tag, `{name, tagType}`. A
// tag type that does not exist yet is created alongside it, a plain
// string marked as a tag, so naming a new one is one gesture.
function createGroup(modelId, name, tag, { icon } = {}) {
  const model = getCtxOrThrow(modelId);
  const trimmed = validateName(name, 'Group name');
  if (trimmed in model['group-definitions']) {
    throw new DomainError(`A group named "${trimmed}" already exists in this model.`);
  }
  assertNoNameClash(model, 'group-definition', trimmed);
  const tagName = String((tag && tag.name) || '').trim();
  const tagType = String((tag && tag.tagType) || '').trim();
  if (!tagName || !tagType) throw new DomainError('A group needs a tag – a name and a tag type.');
  const events = [];
  if (!SIMPLE_TYPES.includes(tagType) && !(tagType in model['custom-type-definitions'])) {
    validateDefinitionKey('custom-type-definition', tagType, 'Tag type name');
    events.push({ type: 'custom-type-definition-added', data: {
      'dcb-model-id': modelId, name: tagType, body: { schema: { type: 'string' }, isTag: true },
    } });
  }
  const body = { ...(icon ? { icon } : {}), tag: { name: tagName, tagType }, projections: [] };
  events.push({ type: 'group-definition-added', data: { 'dcb-model-id': modelId, name: trimmed, body } });
  appendEvents(events);
}

// A projection made inside a group – `body` an ordinary projection
// body, its `tags` dropped: it is read by the group's.
function addGroupProjection(modelId, groupName, localName, body) {
  const model = getCtxOrThrow(modelId);
  const group = model['group-definitions'][groupName];
  if (!group) throw new DomainError(`No group named "${groupName}" exists in this model.`);
  const local = validateName(localName, 'Projection name');
  if (groupProjections(group).some((inner) => inner.name === local)) {
    throw new DomainError(`${groupName} already has a projection named "${local}".`);
  }
  assertStorableBody('projection-definition', body, `${groupName}.${local}`);
  const next = deepClone(group);
  next.projections = [...(Array.isArray(next.projections) ? next.projections : []), storedGroupProjection(local, body)];
  assertStorableBody('group-definition', next, groupName);
  appendEvents([{ type: 'group-definition-updated', data: { 'dcb-model-id': modelId, name: groupName, body: next } }]);
}

// A derived projection's reads of its own group's projections, written
// the way the group writes them: `Course.capacity` tagged by nothing but
// the group's tag passed on becomes the sibling `capacity`. Any other
// read – another instance's, by a literal – stays qualified.
function siblingReadsInside(derived, groupName, tag) {
  if (!derived || typeof derived !== 'object' || !tag) return derived;
  for (const side of ['leftHandSide', 'rightHandSide']) {
    const operand = derived[side];
    if (operandSource(operand) !== 'projection-read') continue;
    const split = splitQualifiedName(operand.projection);
    if (!split || split.group !== groupName) continue;
    const held = readTagEntries(operand);
    if (held.length !== 1 || held[0][0] !== tag.name || operandSource(held[0][1]) !== 'parameter'
      || held[0][1].parameterName !== tag.name || held[0][1].property !== undefined) continue;
    const sibling = { projection: split.local };
    if (operand.arguments && Object.keys(operand.arguments).length) sibling.arguments = operand.arguments;
    derived[side] = sibling;
  }
  return derived;
}

// A command's reads of a projection that just moved into a group, said
// the way one would write them by hand: through an alias of the group.
// `Course(courseId).exists` becomes `course.exists` beside `alias course
// = Course(courseId)`, and an alias bound to the projection itself
// (`alias exists = Course(courseId).exists`) folds into the group's, its
// uses becoming `course.exists`. Writing `Course(courseId)` in front of
// every member a rule reads is the repetition an alias exists to save.
//
// An alias of the group with the same tags is reused – moving several
// projections in one after another gathers them under one. A new alias is
// named off the value it is read by (`aliasBaseFor`) and appended;
// where it sits does not matter, the boundary is resolved in rounds.
// An alias whose value is used by a field (`exists.x`) stays as it is:
// no member read says that. `moved(name)` picks the qualified reads to
// rewrite. Mutates `body`.
function aliasGroupReads(body, moved) {
  if (!body || !Array.isArray(body.boundary)) return;
  const taken = new Set([
    ...body.boundary.map((b) => b && b.alias),
    ...(Array.isArray(body.properties) ? body.properties : []).map((p) => p && p.name),
  ].filter(Boolean));
  const sameTags = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  const groupAlias = (group, tags, at) => {
    const found = body.boundary.find((b) => b && b.group === group && sameTags(b.tags, tags));
    if (found) return found.alias;
    const alias = uniqueAlias(aliasBaseFor(group, tags), [...taken]);
    taken.add(alias);
    const binding = { alias, group, tags };
    if (at === undefined) body.boundary.push(binding);
    else body.boundary.splice(at, 0, binding);
    return alias;
  };
  const operands = (keep) => {
    const out = [];
    forEachCommandOperand(body, (operand) => { if (keep(operand)) out.push(operand); });
    return out;
  };

  for (const binding of [...body.boundary]) {
    if (!binding || binding.projection === undefined || !moved(binding.projection)) continue;
    const split = splitQualifiedName(binding.projection);
    if (!split) continue;
    const uses = operands((o) => operandSource(o) === 'alias-property' && o.alias === binding.alias);
    if (uses.some((o) => o.property !== undefined)) continue;
    const at = body.boundary.indexOf(binding);
    body.boundary.splice(at, 1);
    taken.delete(binding.alias);
    const alias = groupAlias(split.group, binding.tags || {}, at);
    const args = binding.arguments && Object.keys(binding.arguments).length ? binding.arguments : null;
    for (const use of uses) {
      use.alias = alias;
      use.property = split.local;
      if (args) use.arguments = deepClone(args);
    }
  }

  for (const read of operands((o) => operandSource(o) === 'projection-read' && moved(o.projection))) {
    const split = splitQualifiedName(read.projection);
    if (!split) continue;
    const { tags, arguments: args } = read;
    const alias = groupAlias(split.group, tags || {});
    for (const key of Object.keys(read)) delete read[key];
    read.alias = alias;
    read.property = split.local;
    if (args && Object.keys(args).length) read.arguments = args;
  }
}

// What a new alias of `group` is called, off the value it is read by:
// `courseId` reads as `course`, `otherCourseId` as `otherCourse`, and a
// fan-out over `subscribedCourseIds` as `subscribedCourses`. Anything
// else is the group's name – `course`, or `courses` for a fan-out.
function aliasBaseFor(group, tags) {
  const operand = Object.values(tags || {})[0];
  const fallback = defaultAlias(group);
  const nameOf = (o) => {
    if (operandSource(o) === 'parameter') return o.property || o.parameterName;
    if (operandSource(o) === 'alias-property') return o.property || o.alias;
    return null;
  };
  if (operandSource(operand) === 'each') {
    const name = nameOf(operand.each);
    return name && /.Ids$/.test(name) ? name.slice(0, -3) + 's' : fallback + 's';
  }
  const name = nameOf(operand);
  return name && /.Id$/.test(name) ? name.slice(0, -2) : fallback;
}

// Moves a top-level projection into `groupName`. It has to be tagged by
// exactly one tag, of the group's tag type: the group's tag is the one
// it is read by from now on. `localName` defaults to `groupLocalName`.
function moveProjectionIntoGroup(modelId, projectionName, groupName, localName) {
  const model = getCtxOrThrow(modelId);
  const projection = model['projection-definitions'][projectionName];
  if (!projection) throw new DomainError(`No projection named "${projectionName}" exists in this model.`);
  const group = model['group-definitions'][groupName];
  if (!group) throw new DomainError(`No group named "${groupName}" exists in this model.`);
  const tag = groupTagOf(group);
  if (!tag) throw new DomainError(`${groupName} declares no tag, so nothing can be read through it yet.`);
  const tags = projectionTagParams(projection);
  if (tags.length !== 1 || tags[0].tagType !== tag.tagType) {
    throw new DomainError(
      `${projectionName} is ${tags.length ? `tagged by ${tags.map((t) => `${t.name}: ${t.tagType}`).join(', ')}` : 'untagged'}, `
      + `and ${groupName}'s projections are read by one ${tag.tagType} – only a projection tagged by exactly that moves in.`
    );
  }
  const local = validateName(localName === undefined ? groupLocalName(groupName, projectionName) : localName, 'Projection name');
  if (groupProjections(group).some((inner) => inner.name === local)) {
    throw new DomainError(`${groupName} already has a projection named "${local}".`);
  }
  const oldTag = tags[0].name;
  const to = qualifiedProjectionName(groupName, local);

  const rewrites = rewriteProjectionReads(model, projectionName, (read, kind) => {
    read.projection = to;
    if (read.tags && typeof read.tags === 'object' && oldTag !== tag.name) read.tags = renameKey(read.tags, oldTag, tag.name);
    return true;
  });
  const own = rewrites.find((r) => r.kind === 'projection-definition' && r.name === projectionName);
  const inner = storedGroupProjection(local, own ? own.body : deepClone(projection));
  forEachOwnParameterRefOf(inner, (ref) => { if (ref.parameterName === oldTag) ref.parameterName = tag.name; });
  let groupRewrite = rewrites.find((r) => r.kind === 'group-definition' && r.name === groupName);
  if (!groupRewrite) rewrites.push(groupRewrite = { kind: 'group-definition', name: groupName, body: deepClone(group) });
  groupRewrite.body.projections = [...(groupRewrite.body.projections || []), inner];
  for (const sibling of groupProjections(groupRewrite.body)) siblingReadsInside(sibling.derived, groupName, tag);
  for (const r of rewrites) if (r.kind === 'command-definition') aliasGroupReads(r.body, (name) => name === to);

  appendEvents([
    { type: 'projection-definition-removed', data: { 'dcb-model-id': modelId, name: projectionName } },
    ...rewrites.filter((r) => r !== own).map((r) => (
      { type: `${r.kind}-updated`, data: { 'dcb-model-id': modelId, name: r.name, body: r.body } })),
  ]);
  return to;
}

// Moves a grouped projection out, to the top level, as `newName`
// (`ungroupedProjectionName` by default): it regains the group's tag as
// its own, a derived one's sibling reads are spelled from outside, and
// every read of it moves – a group alias's member read becoming the
// read in place it stood for.
function moveProjectionOutOfGroup(modelId, qualifiedName, newName) {
  const model = getCtxOrThrow(modelId);
  const entry = groupProjectionEntry(model, qualifiedName);
  if (!entry) throw new DomainError(`No grouped projection "${qualifiedName}" exists in this model.`);
  const name = validateName(newName === undefined ? ungroupedProjectionName(entry.groupName, entry.local) : newName,
    'Projection name');
  if (name in model['projection-definitions']) {
    throw new DomainError(`A projection named "${name}" already exists in this model.`);
  }
  assertNoNameClash(model, 'projection-definition', name);
  const tag = groupTagOf(entry.group);
  const { tags: effectiveTags, ...rest } = deepClone(projectionsOf(model)[qualifiedName]);
  const body = { tags: effectiveTags, ...rest };

  const moveArguments = (read) => {
    if (read.arguments === undefined) return;
    const args = read.arguments;
    delete read.arguments;
    if (args && Object.keys(args).length) read.arguments = args;
  };
  const rewrites = rewriteProjectionReads(model, qualifiedName, (read, kind, binding) => {
    if (kind === 'member') {
      delete read.alias;
      delete read.property;
      read.projection = name;
      read.tags = deepClone((binding && binding.tags) || {});
      moveArguments(read);
      return true;
    }
    read.projection = name;
    if (kind === 'sibling') {
      read.tags = tag ? { [tag.name]: { parameterName: tag.name } } : {};
      moveArguments(read);
    }
    return true;
  });
  for (const r of rewrites) if (r.kind === 'command-definition') pruneUnreferencedBindings(model, r.body);
  let groupRewrite = rewrites.find((r) => r.kind === 'group-definition' && r.name === entry.groupName);
  if (!groupRewrite) rewrites.push(groupRewrite = { kind: 'group-definition', name: entry.groupName, body: deepClone(entry.group) });
  groupRewrite.body.projections = (groupRewrite.body.projections || []).filter((inner) => !(inner && inner.name === entry.local));

  appendEvents([
    { type: 'projection-definition-added', data: { 'dcb-model-id': modelId, name, body } },
    ...rewrites.map((r) => ({ type: `${r.kind}-updated`, data: { 'dcb-model-id': modelId, name: r.name, body: r.body } })),
  ]);
  return name;
}

// ------------------------------------------------------------
// Member renames.
//
// A definition's *members* – a group's projections, an enum's members,
// an event's properties, a command's payload, a composite's fields, a
// projection's parameters – are referenced by name just as definitions
// are, so renaming one has to rewrite those references in the same
// append. Doing it as a plain update would leave every reader of the
// old name dangling – representable now, and reported as advisories,
// but a rename is a rename: the references are the point.
//
// Unlike a definition rename there is no `-renamed` event to emit. A
// member lives inside a body, so the whole thing is a set of
// `<kind>-updated` events – one for the owner, one per referrer.
// ------------------------------------------------------------

// Walks a handler value, stepping through `successor` to whatever it
// wraps, and rewrites in place.
function rewriteHandlerOperand(operand, visit) {
  if (!operand || typeof operand !== 'object') return;
  if (operand.successor !== undefined) return rewriteHandlerOperand(operand.successor, visit);
  // A record's fields (11.0), each an operand of its own.
  if (operandSource(operand) === 'record') {
    for (const field of Object.values(operand.record || {})) rewriteHandlerOperand(field, visit);
    return;
  }
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
// string) – model.js and index.html share one global scope as classic
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
// An event's tag paths with `rename(property, field)` applied – it
// returns the new `[property, field]` or null to leave a path alone.
// Null when nothing moved, so a rewrite only lands where it changed.
function renameTagPaths(tags, rename) {
  if (!Array.isArray(tags)) return null;
  let moved = false;
  const out = tags.map((path) => {
    if (typeof path !== 'string') return path;
    const [property, field] = path.split('.');
    const renamed = rename(property, field === undefined ? null : field);
    if (!renamed) return path;
    moved = true;
    return renamed[1] === null ? renamed[0] : `${renamed[0]}.${renamed[1]}`;
  });
  return moved ? out : null;
}

const MEMBER_REWRITES = {
  // A grouped projection is read by its qualified name everywhere outside
  // its group – a command's alias or read in place, a derived operand, a
  // projection scenario – as a member of a group alias, `course.capacity`,
  // and by its siblings under its local name. All of them move;
  // `renameMember` folds the group's own rewrite (its siblings' reads)
  // together with the rename of the entry itself.
  'group-definition:projection': (model, groupName, previous, next) => {
    const to = qualifiedProjectionName(groupName, next);
    return rewriteProjectionReads(model, qualifiedProjectionName(groupName, previous), (read, kind) => {
      if (kind === 'member') read.property = next;
      else if (kind === 'sibling') read.projection = next;
      else read.projection = to;
      return true;
    });
  },

  // An enum member is an `{enumMember}` operand. The type it belongs to
  // may be held by any number of projections, so this reaches every one
  // of them rather than one private owner.
  'custom-type-definition:member': (model, typeName, previous, next) => {
    const out = [];

    // Every projection typed with this enum refers to its members
    // through its initial value – scalar or an element of a list – and
    // its handler values. A derived predicate compares a projection's
    // value against a member the same way a condition does – resolved
    // through the operand it sits opposite. Grouped projections alike.
    const view = projectionsOf(model);
    out.push(...rewriteProjections(model, (body, name, groupName) => {
      let touched = false;
      if (body.valueType === typeName) {
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
          for (const arm of handlerArms(handler)) {
            rewriteHandlerOperand(arm.value, (operand) => {
              if (operand.enumMember === previous) { operand.enumMember = next; touched = true; }
            });
          }
        }
      }
      // A branched handler's condition compares an event field of this
      // enum with a member (11.0).
      for (const handler of body.handlers || []) {
        for (const leaf of handlerConditionLeaves(handler)) {
          if (operandSource(leaf.rightHandSide) !== 'enum-member' || leaf.rightHandSide.enumMember !== previous) continue;
          if (handlerFieldType(model, handler.event, leaf.leftHandSide) !== typeName) continue;
          leaf.rightHandSide.enumMember = next;
          touched = true;
        }
      }
      if (derivedOf(body)) {
        // A collection's where compares value with a member (11.0).
        for (const operand of derivedOperands(body.derived).map(uncounted)) {
          if (operandSource(operand) !== 'collection') continue;
          for (const { operand: member, type } of whereEnumMembers(model, operand)) {
            if (member.enumMember === previous && type === typeName) { member.enumMember = next; touched = true; }
          }
        }
        const sides = [
          [body.derived.leftHandSide, body.derived.rightHandSide],
          [body.derived.rightHandSide, body.derived.leftHandSide],
        ];
        for (const [maybeEnum, other] of sides) {
          if (operandSource(maybeEnum) !== 'enum-member' || maybeEnum.enumMember !== previous) continue;
          if (operandSource(other) !== 'projection-read') continue;
          const target = view[groupName && isLocalProjectionName(other.projection)
            ? qualifiedProjectionName(groupName, other.projection) : other.projection];
          if (!target || target.valueType !== typeName) continue;
          maybeEnum.enumMember = next;
          touched = true;
        }
      }
      return touched;
    }));

    // A command condition compares a read's enum-typed value against a
    // member by value – resolved through the boundary rather than
    // assumed, since what is read is whichever the alias names.
    out.push(...rewriteCommands(model, (command) => {
      let touched = false;
      // Each comparison with the loop it sits in: inside one over an
      // open read (11.0), `value` is the instance's, of its projection's type.
      const leaves = [];
      forEachStep(commandSteps(command), (step, { loop }) => {
        const stated = stepKind(step) === 'rule' ? [step.condition]
          : stepKind(step) === 'branch' ? (step.branches || []).map((arm) => arm && arm.condition) : [];
        for (const one of stated) for (const leaf of conditionLeaves(one)) leaves.push({ condition: leaf, loop });
      });
      for (const { condition, loop } of leaves) {
        // In an `equalsAny` list every entry sits opposite the left-hand
        // side; the entry objects are mutated in place like any operand.
        const sides = Array.isArray(condition.rightHandSide)
          ? condition.rightHandSide.map((entry) => [entry, condition.leftHandSide])
          : [
            [condition.leftHandSide, condition.rightHandSide],
            [condition.rightHandSide, condition.leftHandSide],
          ];
        for (const [maybeEnum, other] of sides) {
          if (operandSource(maybeEnum) !== 'enum-member' || maybeEnum.enumMember !== previous) continue;
          if (!['alias-property', 'projection-read', 'instance-value'].includes(operandSource(other))) continue;
          const resolved = resolveOperandType(other, {
            boundary: command.boundary || [],
            commandProperties: commandScopeProperties(model, command),
            model,
            instanceValue: loopValueType(model, loop),
          });
          if (!resolved || resolved.propertyType !== typeName) continue;
          maybeEnum.enumMember = next;
          touched = true;
        }
      }
      forEachCommandOperand(command, (operand) => {
        if (operandSource(operand) !== 'collection') return;
        for (const { operand: member, type } of whereEnumMembers(model, operand)) {
          if (member.enumMember === previous && type === typeName) { member.enumMember = next; touched = true; }
        }
      });
      return touched;
    }));

    return out;
  },

  // An event property is read by whatever handles the event, and written
  // by whatever emits it.
  'event-definition:property': (model, eventName, previous, next) => {
    const out = [];
    const handlesIt = (handlers) => (handlers || []).some((h) => h && h.event === eventName);

    // Handlers live only on projections, grouped ones included.
    out.push(...rewriteProjections(model, (body) => {
      if (!handlesIt(body.handlers)) return false;
      let touched = false;
      for (const handler of body.handlers || []) {
        if (!handler || handler.event !== eventName) continue;
        for (const arm of handlerArms(handler)) {
          rewriteHandlerOperand(arm.value, (operand) => {
            if (operand.eventProperty === previous) { operand.eventProperty = next; touched = true; }
          });
        }
        for (const leaf of handlerConditionLeaves(handler)) {
          for (const side of [leaf.leftHandSide, leaf.rightHandSide]) {
            if (operandSource(side) === 'event-property' && side.eventProperty === previous) { side.eventProperty = next; touched = true; }
          }
        }
      }
      return touched;
    }));

    // An emission binds by *key*, so this is a key rename rather than
    // an operand rewrite.
    out.push(...rewriteCommands(model, (command) => {
      let touched = false;
      for (const emission of commandEmissions(command)) {
        if (emission.name !== eventName) continue;
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

    // The event's own tags name the property by path – a local name,
    // so it moves on the owner.
    const event = model['event-definitions'][eventName];
    const retagged = renameTagPaths(event && event.tags, (property, field) =>
      (property === previous ? [next, field] : null));
    if (retagged) out.push({ kind: 'event-definition', name: eventName, body: { ...deepClone(event), tags: retagged } });
    return out;
  },

  // A command's payload is local to it – except that every scenario
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
  // that composite – `{parameterName: items, property: productId}`.
  'custom-type-definition:field': (model, typeName, previous, next) => [
    // A branched handler's condition reaches a record's field one hop
    // into the event, `event.data.address.city` (11.0).
    // So does what a handler takes from the event (11.0), `set
    // event.data.signUp.emailAddress`, a record's field among them.
    ...rewriteProjections(model, (body) => {
      let touched = false;
      for (const handler of body.handlers || []) {
        const event = handler && model['event-definitions'][handler.event];
        const rename = (operand) => {
          if (operandSource(operand) !== 'event-property' || operand.property !== previous) return;
          const property = event && (event.properties || []).find((p) => p && p.name === operand.eventProperty);
          if (!property || property.propertyType !== typeName) return;
          operand.property = next;
          touched = true;
        };
        for (const leaf of handlerConditionLeaves(handler)) rename(leaf.leftHandSide);
        for (const arm of handlerArms(handler)) {
          const value = operandSource(arm.value) === 'successor' ? arm.value.successor : arm.value;
          if (operandSource(value) === 'record') Object.values(value.record || {}).forEach(rename);
          else rename(value);
        }
      }
      return touched;
    }),
    // An event lists a record's tag field by path, `items.productId`.
    ...Object.entries(model['event-definitions']).flatMap(([name, event]) => {
      const typed = new Set((event.properties || [])
        .filter((p) => p && p.propertyType === typeName).map((p) => p.name));
      const retagged = renameTagPaths(event.tags, (property, field) =>
        (typed.has(property) && field === previous ? [property, next] : null));
      return retagged ? [{ kind: 'event-definition', name, body: { ...deepClone(event), tags: retagged } }] : [];
    }),
    // A projection holding the record (11.0): a handler sets it from a
    // record of fields, a derived one reads one of its fields, a where
    // compares value.field; and its initial value is one.
    ...rewriteProjections(model, (body) => {
      let touched = false;
      if (body.valueType === typeName && !body.isList) {
        for (const handler of body.handlers || []) {
          for (const arm of handlerArms(handler)) {
            const value = arm.value;
            if (operandSource(value) === 'record' && value.record && previous in value.record) {
              arm.holder.value = { record: renameKey(value.record, previous, next) };
              touched = true;
            }
          }
        }
        if (body.initialValue && typeof body.initialValue === 'object' && previous in body.initialValue) {
          body.initialValue = renameKey(body.initialValue, previous, next);
          touched = true;
        }
      }
      for (const operand of derivedOperands(body.derived).map(uncounted)) {
        const read = operandRead(operand);
        const target = read && projectionsOf(model)[read.projection];
        if (!target || target.valueType !== typeName) continue;
        if (operand.field === previous) { operand.field = next; touched = true; }
        if (operandSource(operand) === 'collection' && renameWhereField(operand, previous, next)) touched = true;
      }
      return touched;
    }),
    ...rewriteCommands(model, (command) => {
      const parameters = new Set(commandScopeProperties(model, command)
        .filter((p) => p.propertyType === typeName).map((p) => p.name));
      let touched = false;
      const holds = (operand) => {
        const whole = resolveOperandTypeWhole(operand, { boundary: command.boundary || [], commandProperties: commandScopeProperties(model, command), model });
        return !!whole && whole.propertyType === typeName && !whole.isList;
      };
      forEachCommandOperand(command, (operand, meta) => {
        const source = operandSource(operand);
        if (source === 'parameter'
            && parameters.has(operand.parameterName) && operand.property === previous) {
          operand.property = next;
          touched = true;
        }
        // `value.field` inside a loop over an open read (11.0).
        const held = source === 'instance-value' && !meta.inWhere ? loopValueType(model, meta.loop) : null;
        if (held && !held.isList && held.propertyType === typeName && operand.field === previous) {
          operand.field = next;
          touched = true;
        }
        if ((source === 'projection-read' || source === 'alias-property') && operand.field === previous && holds(operand)) {
          operand.field = next;
          touched = true;
        }
        if (source === 'collection' && operandRead(operand) && holds(operandRead(operand))
          && renameWhereField(operand, previous, next)) touched = true;
      });
      return touched;
    }),
    ...Object.entries(model['projection-scenario-definitions'] || {}).flatMap(([key, scenario]) => {
      const target = scenario && projectionsOf(model)[scenario.projection];
      if (!target || target.valueType !== typeName || target.isList || !scenario.then
        || typeof scenario.then !== 'object' || !(previous in scenario.then)) return [];
      return [{ kind: 'projection-scenario-definition', name: key, body: { ...deepClone(scenario), then: renameKey(scenario.then, previous, next) } }];
    }),
    // A scenario holds composites as values, so the field name is a key
    // inside the payload rather than a reference beside it – one level
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

  // A read gives a projection's tags by name, so renaming one moves that
  // key in every read of it – an alias's, one in place, a derived
  // operand's, a projection scenario's – and, on a derived projection,
  // in its own operands wherever they pass the tag on (`{parameterName}`).
  // A projection's parameter is read by name everywhere it is given –
  // a read's `tags` or `arguments`, a projection scenario's, a derived
  // operand's – and named by its own derived predicate
  // (`{parameterName}`). Tags and arguments move the same way, each in
  // its own map.
  'projection-definition:tag': (model, projectionName, previous, next) =>
    renameProjectionParameter(model, projectionName, 'tags', previous, next),
  'projection-definition:argument': (model, projectionName, previous, next) =>
    renameProjectionParameter(model, projectionName, 'arguments', previous, next),

  // A group's tag is every one of its projections' tag: each read of
  // one keys its value by it – a group binding, a read in place, a
  // derived operand, a projection scenario – and each names it inside,
  // in a branched handler's conditions and in what a derived one
  // compares or passes on (`forEachOwnParameterRefOf`). A sibling read
  // gives no tag, so it has nothing to move.
  'group-definition:tag': (model, groupName, previous, next) => {
    const ours = (name) => {
      const split = typeof name === 'string' ? splitQualifiedName(name) : null;
      return !!split && split.group === groupName;
    };
    const rekey = (read) => {
      if (!read || !read.tags || typeof read.tags !== 'object' || Array.isArray(read.tags) || !(previous in read.tags)) return false;
      read.tags = renameKey(read.tags, previous, next);
      return true;
    };
    const out = rewriteCommands(model, (command) => {
      let touched = false;
      for (const binding of command.boundary || []) {
        if (binding && (binding.group === groupName || ours(binding.projection)) && rekey(binding)) touched = true;
      }
      forEachCommandOperand(command, (operand) => {
        if (operandSource(operand) === 'projection-read' && ours(operand.projection) && rekey(operand)) touched = true;
      });
      return touched;
    });
    out.push(...rewriteProjections(model, (body, name, owner) => {
      let touched = false;
      for (const operand of derivedReads(body.derived)) {
        if (operandSource(operand) === 'projection-read' && ours(operand.projection) && rekey(operand)) touched = true;
      }
      if (owner === groupName) {
        forEachOwnParameterRefOf(body, (ref) => {
          if (ref.parameterName === previous) { ref.parameterName = next; touched = true; }
        });
      }
      return touched;
    }));
    for (const [key, scenario] of Object.entries(model['projection-scenario-definitions'] || {})) {
      const body = deepClone(scenario);
      if (ours(body.projection) && rekey(body)) out.push({ kind: 'projection-scenario-definition', name: key, body });
    }
    return out;
  },
};

// Renames `value.previous` in a collection's where (11.0).
function renameWhereField(collection, previous, next) {
  let touched = false;
  for (const leaf of conditionLeaves(collection.where)) {
    for (const side of conditionOperands(leaf).flat()) {
      if (operandSource(side) === 'instance-value' && side.field === previous) { side.field = next; touched = true; }
    }
  }
  return touched;
}

// Every `{parameterName}` a projection names one of its own
// parameters by: its derived predicate's, and its branched handlers'
// conditions' (11.0), which compare with its tags.
function forEachOwnParameterRefOf(body, visit) {
  if (!body || typeof body !== 'object') return;
  forEachOwnParameterRef(body.derived, visit);
  for (const handler of Array.isArray(body.handlers) ? body.handlers : []) {
    for (const leaf of handlerConditionLeaves(handler)) {
      for (const side of [leaf.leftHandSide, leaf.rightHandSide]) if (operandSource(side) === 'parameter') visit(side);
    }
  }
}

// Every `{parameterName}` a derived predicate names one of its owner's
// parameters by: a side, an operand's tag, an operand's argument.
function forEachOwnParameterRef(derived, visit) {
  for (const operand of derivedOperands(derived).map(uncounted)) {
    if (operandSource(operand) === 'parameter') visit(operand);
    // A collection's where compares with them too (11.0).
    if (operandSource(operand) === 'collection') {
      for (const leaf of conditionLeaves(operand.where)) {
        for (const side of conditionOperands(leaf).flat()) if (operandSource(side) === 'parameter') visit(side);
      }
    }
  }
  for (const read of derivedReads(derived)) {
    for (const value of [...readTagOperands(read), ...Object.values(read.arguments || {})]) {
      if (operandSource(value) === 'parameter') visit(value);
    }
  }
}

// Every read of `projectionName`, wherever one is stored, over a deep
// copy, handed to `mutate(read, kind, binding)`: a command's binding
// and read in place (`'command'`), a group alias's member read – the
// operand `{alias, property, arguments}`, its binding beside it, since
// the tags live there (`'member'`) – a derived operand (`'derived'`),
// or, inside the projection's own group, a sibling's read by local name
// (`'sibling'`), and a projection scenario (`'scenario'`). The
// projection's own body goes to `mutateOwner(body, groupName)`, so a
// caller can also rewrite a derived projection's references to itself.
// `mutate` returns whether it changed the read; the changed definitions
// come back once each, as rewrites – a grouped projection as its group.
function rewriteProjectionReads(model, projectionName, mutate, mutateOwner = () => false) {
  const changes = (read, kind, binding) => !!read && mutate(read, kind, binding);
  const out = rewriteCommands(model, (command) => {
    let touched = false;
    const groupAliases = new Map();
    for (const binding of command.boundary || []) {
      if (!binding) continue;
      if (binding.projection === projectionName && changes(binding, 'command')) touched = true;
      if (binding.group !== undefined && binding.alias) groupAliases.set(binding.alias, binding);
    }
    forEachCommandOperand(command, (operand) => {
      if (operandSource(operand) === 'projection-read' && operand.projection === projectionName
        && changes(operand, 'command')) touched = true;
      if (operandSource(operand) !== 'alias-property' || !operand.property) return;
      const binding = groupAliases.get(operand.alias);
      if (binding && qualifiedProjectionName(binding.group, operand.property) === projectionName
        && changes(operand, 'member', binding)) touched = true;
    });
    return touched;
  });
  out.push(...rewriteProjections(model, (body, name, groupName) => {
    let touched = false;
    if (body.derived && typeof body.derived === 'object') {
      for (const operand of derivedReads(body.derived)) {
        if (operandSource(operand) !== 'projection-read') continue;
        if (operand.projection === projectionName) {
          if (changes(operand, 'derived')) touched = true;
        } else if (groupName && isLocalProjectionName(operand.projection)
          && qualifiedProjectionName(groupName, operand.projection) === projectionName) {
          if (changes(operand, 'sibling')) touched = true;
        }
      }
    }
    if (name === projectionName && mutateOwner(body, groupName)) touched = true;
    return touched;
  }));
  for (const [key, scenario] of Object.entries(model['projection-scenario-definitions'] || {})) {
    const body = deepClone(scenario);
    if (body.projection === projectionName && changes(body, 'scenario')) {
      out.push({ kind: 'projection-scenario-definition', name: key, body });
    }
  }
  return out;
}

// Applies `mutate(body, name, groupName)` to a deep copy of every
// projection – a top-level one under its name, a grouped one, as its
// group stores it, under its qualified name – and returns the
// definitions it changed: a top-level projection as itself, a group
// once however many of its projections changed.
function rewriteProjections(model, mutate) {
  const out = [];
  for (const [name, projection] of Object.entries(model['projection-definitions'])) {
    if (!projection) continue;
    const body = deepClone(projection);
    if (mutate(body, name, null)) out.push({ kind: 'projection-definition', name, body });
  }
  for (const [groupName, group] of Object.entries(model['group-definitions'] || {})) {
    if (!group) continue;
    const body = deepClone(group);
    let touched = false;
    for (const inner of groupProjections(body)) {
      if (mutate(inner, qualifiedProjectionName(groupName, inner.name), groupName)) touched = true;
    }
    if (touched) out.push({ kind: 'group-definition', name: groupName, body });
  }
  return out;
}

function renameProjectionParameter(model, projectionName, map, previous, next) {
  return rewriteProjectionReads(model, projectionName, (read) => {
    if (!read[map] || typeof read[map] !== 'object' || !(previous in read[map])) return false;
    read[map] = renameKey(read[map], previous, next);
    return true;
  }, (body) => {
    let touched = false;
    forEachOwnParameterRefOf(body, (ref) => {
      if (ref.parameterName === previous) { ref.parameterName = next; touched = true; }
    });
    return touched;
  });
}

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

// Where a member of each kind lives inside its body. `list` is a
// dotted path – flat for most kinds, but an enum's members sit at
// `schema.enum`, one level into the custom type's JSON Schema.
const MEMBER_SHAPE = {
  projection: { list: 'projections', named: true, label: 'Projection' },
  property: { list: 'properties', named: true, label: 'Property' },
  member: { list: 'schema.enum', named: false, label: 'Member' },
  field: { list: 'properties', named: true, label: 'Field' },
  tag: { list: 'tags', named: true, label: 'Tag' },
  argument: { list: 'arguments', named: true, label: 'Argument' },
};
const GROUP_TAG_SHAPE = { list: 'tag', named: true, single: true, label: 'Tag' };

// A grouped projection's parameters are renamed by its qualified name,
// like any projection's; what lands is its group, the entry renamed in
// place. Its tag is its group's, renamed on the group
// (`group-definition` + `tag`), which moves it for every projection
// the group owns at once.
function renameMember(kind, modelId, definitionName, memberKind, previousName, newName) {
  const model = getCtxOrThrow(modelId);
  const entry = kind === 'projection-definition' ? groupProjectionEntry(model, definitionName) : null;
  const body = entry ? entry.inner : (model[DEF_COLLECTIONS[kind]] || {})[definitionName];
  if (!body) {
    throw new DomainError(`No ${humanize(kind)} named "${definitionName}" exists in this model.`);
  }
  if (entry && memberKind === 'tag') {
    throw new DomainError(`${definitionName} is read by its group's tag – it has none of its own; rename the group's.`);
  }
  // A group has one tag, held whole rather than in a list.
  const shape = kind === 'group-definition' && memberKind === 'tag' ? GROUP_TAG_SHAPE : MEMBER_SHAPE[memberKind];
  const rewrite = MEMBER_REWRITES[`${kind}:${memberKind}`];
  if (!shape || !rewrite) {
    throw new DomainError(`A ${humanize(kind)} has no ${memberKind} to rename.`);
  }

  // Only emptiness refuses – an unidiomatic member name renames fine,
  // and the idiom is the advisories' to point out, not this gesture's
  // to refuse.
  const trimmed = (newName || '').trim();
  if (!trimmed) {
    throw new DomainError(`${shape.label} name must not be empty.`);
  }
  if (trimmed === previousName) return;

  const members = shape.single ? [getAtDottedPath(body, shape.list)].filter(Boolean) : getAtDottedPath(body, shape.list) || [];
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
  // A projection's tags and arguments are one list to a read.
  if (kind === 'projection-definition'
    && projectionParameters(projectionsOf(model)[definitionName]).some((p) => p.name === trimmed)) {
    throw new DomainError(`Projection "${definitionName}" already has a parameter named "${trimmed}".`);
  }
  // And a group's tag is one of each of its projections' parameters.
  if (kind === 'group-definition' && memberKind === 'tag') {
    const clash = groupProjections(body).find((inner) => projectionParameters(inner).some((p) => p.name === trimmed));
    if (clash) throw new DomainError(`${definitionName}.${clash.name} already has a parameter named "${trimmed}".`);
  }

  // A rewrite fixes *references*; the member list itself is renamed
  // here, uniformly, so each rewrite has one job. When a rewrite also
  // lands on the owning definition, its body is the one the list
  // rename is applied to.
  const ownerKind = entry ? 'group-definition' : kind;
  const ownerName = entry ? entry.groupName : definitionName;
  const rewrites = rewrite(model, definitionName, previousName, trimmed);
  const ownerRewrite = rewrites.find((r) => r.kind === ownerKind && r.name === ownerName);
  const ownerBody = deepClone(ownerRewrite ? ownerRewrite.body : (entry ? entry.group : body));
  const listOwner = entry ? ownerBody.projections[entry.index] : ownerBody;
  if (shape.single) setAtDottedPath(listOwner, shape.list, { ...getAtDottedPath(listOwner, shape.list), name: trimmed });
  else setAtDottedPath(listOwner, shape.list, (getAtDottedPath(listOwner, shape.list) || []).map((m) => {
    if (!shape.named) return m === previousName ? trimmed : m;
    return m && m.name === previousName ? { ...m, name: trimmed } : m;
  }));

  const events = [{
    type: `${ownerKind}-updated`,
    data: { 'dcb-model-id': modelId, name: ownerName, body: ownerBody },
  }];
  for (const r of rewrites) {
    if (r.kind === ownerKind && r.name === ownerName) continue;
    events.push({
      type: `${r.kind}-updated`,
      data: { 'dcb-model-id': modelId, name: r.name, body: r.body },
    });
  }
  appendEvents(events);
}

// A parameter's `tag` toggle (10.0): ticked, it is one of the tags the
// projection is read by, and narrows its query; unticked, an argument,
// which narrows nothing. The member moves between the two lists – an
// argument becomes the last tag, a tag the first argument, so the order
// a read gives them in holds – and every read's value moves with it,
// in one append. A literal changes spelling as it moves: a tag states
// its type (`CourseId("c1")`), an argument is the bare value. Ticking a
// value that is no tag type is not refused; the advisory says so.
function setProjectionParameterIsTag(modelId, projectionName, parameterName, isTag) {
  const model = getCtxOrThrow(modelId);
  if (groupProjectionEntry(model, projectionName)) {
    throw new DomainError(`${projectionName} is read by its group's tag alone – a parameter of it can only be an argument.`);
  }
  const projection = model['projection-definitions'][projectionName];
  if (!projection) {
    throw new DomainError(`No projection named "${projectionName}" exists in this model.`);
  }
  const tags = projectionTagParams(projection);
  const slots = projectionSlots(projection);
  const tag = tags.find((t) => t.name === parameterName);
  const slot = slots.find((a) => a.name === parameterName);
  if (!tag && !slot) {
    throw new DomainError(`Projection "${projectionName}" has no parameter "${parameterName}".`);
  }
  if (isTag ? tag : slot) return;

  const type = isTag ? slot.propertyType : tag.tagType;
  const body = deepClone(projection);
  body.tags = isTag ? [...tags, { name: parameterName, tagType: type }] : tags.filter((t) => t !== tag);
  const nextSlots = isTag ? slots.filter((a) => a !== slot) : [{ name: parameterName, propertyType: type }, ...slots];
  if (nextSlots.length) body.arguments = nextSlots;
  else delete body.arguments;

  const [from, to] = isTag ? ['arguments', 'tags'] : ['tags', 'arguments'];
  const respelled = (value, kind) => {
    if (isTag) {
      const literal = kind === 'scenario' || operandSource(value) === 'static';
      return literal ? { tagType: type, tagValue: value } : value;
    }
    return operandSource(value) === 'tag-literal' ? value.tagValue : value;
  };
  const rewrites = rewriteProjectionReads(model, projectionName, (read, kind) => {
    const held = read[from];
    if (!held || typeof held !== 'object' || !(parameterName in held)) return false;
    const { [parameterName]: value, ...rest } = held;
    read[from] = rest;
    read[to] = { ...(read[to] && typeof read[to] === 'object' ? read[to] : {}), [parameterName]: respelled(value, kind) };
    if (from === 'arguments' && !Object.keys(rest).length) delete read.arguments;
    return true;
  });
  const own = rewrites.find((r) => r.kind === 'projection-definition' && r.name === projectionName);
  const ownerBody = own ? { ...own.body, tags: body.tags } : body;
  if (own) {
    if (body.arguments) ownerBody.arguments = body.arguments;
    else delete ownerBody.arguments;
  }
  const events = [{
    type: 'projection-definition-updated',
    data: { 'dcb-model-id': modelId, name: projectionName, body: ownerBody },
  }];
  for (const r of rewrites) {
    if (r === own) continue;
    events.push({ type: `${r.kind}-updated`, data: { 'dcb-model-id': modelId, name: r.name, body: r.body } });
  }
  appendEvents(events);
}

function removeDefinition(kind, modelId, name) {
  const model = getCtxOrThrow(modelId);
  // A grouped projection goes from its group – removed by the name it is
  // read by, like any projection.
  const entry = kind === 'projection-definition' ? groupProjectionEntry(model, name) : null;
  if (entry) {
    const group = deepClone(entry.group);
    group.projections = group.projections.filter((inner) => !(inner && inner.name === entry.local));
    appendEvents([{ type: 'group-definition-updated', data: { 'dcb-model-id': modelId, name: entry.groupName, body: group } }]);
    return;
  }
  const coll = collectionOfKind(model, kind);
  if (!(name in coll)) {
    throw new DomainError(`No ${humanize(kind)} named "${name}" exists in this model.`);
  }
  // Whatever still references this definition is left dangling and
  // says so – the rule scenarios always lived by ("a test exists to
  // report what a change broke, not to prevent it") now applied to
  // every kind: the dangling reference surfaces as an advisory on the
  // definition holding it, not as a refusal here. A group takes the
  // projections it owns with it.
  appendEvents([{ type: `${kind}-removed`, data: { 'dcb-model-id': modelId, name } }]);
}

// Changes the order this collection's members are stored in – the order
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

// Two bodies that say the same thing. Stored bodies spell their
// defaults inconsistently – `isList: false` here, absent there, an
// empty list on one body and nothing on the next – and a writer that
// compared them literally would rewrite half a model to change one
// rule. So the defaults the schema names are dropped before comparing,
// as are key order and empty containers.
//
// Only on the schema's own keys, though. An operand, and the
// author-keyed maps of them (an emission's `parameters`, a read's
// `tags` and `arguments`), hold values rather than definition – `false`,
// `[]` and a property that happens to be called `isList` are content
// there – so they are compared as written, key order aside; the one
// thing dropped inside them is an empty `tags` or `arguments`, which
// says "none" the same way its absence does. An event's `tags` are a
// set of paths, so their order is not compared either. Data (`schema`,
// `initialValue`) is compared as written too. `rightHandSide` and
// `derived` keep their empties: `equalsAny []` holds for nothing, and
// an empty `derived` still decides what kind of projection this is.
const DEFAULT_FLAGS = ['isOptional', 'isList', 'negate', 'isTag'];
const DATA_FIELDS = ['schema', 'initialValue'];
const OPERAND_FIELDS = ['leftHandSide', 'rightHandSide', 'value', 'successor'];
const OPERAND_MAPS = ['parameters', 'arguments', 'tags'];
const KEEPS_EMPTY = ['rightHandSide', 'derived'];

// Keys are set as own properties: a key called `__proto__` is a key.
function normalizedPut(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

function isEmptyContainer(value) {
  if (Array.isArray(value)) return !value.length;
  return value !== null && typeof value === 'object' && !Object.keys(value).length;
}

function canonicalData(value) {
  if (Array.isArray(value)) return value.map(canonicalData);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) normalizedPut(out, key, canonicalData(value[key]));
  return out;
}

function canonicalOperand(value) {
  if (Array.isArray(value)) return value.map(canonicalOperand);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    if (key === 'arguments' && isEmptyContainer(value[key])) continue;
    if (key === 'tags' && value.projection !== undefined && isEmptyContainer(value[key])) continue;
    normalizedPut(out, key, canonicalOperand(value[key]));
  }
  return out;
}

function normalizedDefinition(value) {
  if (Array.isArray(value)) return value.map(normalizedDefinition);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const field = value[key];
    if (field === undefined) continue;
    if (DEFAULT_FLAGS.includes(key) && field === false) continue;
    if (key === 'tagSchema' && field === '{type}:{value}') continue;
    if (DATA_FIELDS.includes(key)) { normalizedPut(out, key, canonicalData(field)); continue; }
    if (OPERAND_FIELDS.includes(key)) { normalizedPut(out, key, canonicalOperand(field)); continue; }
    if (isEmptyContainer(field) && !KEEPS_EMPTY.includes(key)) continue;
    if (OPERAND_MAPS.includes(key) && field !== null && typeof field === 'object' && !Array.isArray(field)) {
      normalizedPut(out, key, canonicalOperand(field));
      continue;
    }
    if (key === 'tags' && Array.isArray(field) && field.every((tag) => typeof tag === 'string')) {
      normalizedPut(out, key, [...field].sort());
      continue;
    }
    normalizedPut(out, key, normalizedDefinition(field));
  }
  return out;
}

function sameDefinition(a, b) {
  return JSON.stringify(normalizedDefinition(a)) === JSON.stringify(normalizedDefinition(b));
}

// One collection against another, `{ name: body }` each: what the
// newer side added and changed (in its order), what it removed (in the
// older side's order), what it kept as it was, and whether it orders
// the survivors differently from where the fold would leave them –
// survivors where they were, additions at the end. Sameness is
// `sameDefinition`'s, so a body respelled is unchanged. The one notion
// of "the same definition" both Apply and Compare go by.
function diffCollection(older, newer) {
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const out = { added: [], changed: [], removed: [], unchanged: [], reordered: false };
  const order = Object.keys(older);
  for (const name of order) if (!has(newer, name)) out.removed.push(name);
  for (const [name, body] of Object.entries(newer)) {
    if (!has(older, name)) out.added.push(name);
    else if (sameDefinition(older[name], body)) out.unchanged.push(name);
    else out.changed.push(name);
  }
  const landed = [
    ...order.filter((name) => has(newer, name)),
    ...Object.keys(newer).filter((name) => !has(older, name)),
  ];
  out.reordered = landed.join('\n') !== Object.keys(newer).join('\n');
  return out;
}

// Two models, every stored kind – scenarios included, keyed by id –
// and the name: what reading `newer` against `older` shows. Pure and
// read-only, for models that need not be in the log at all (an earlier
// revision, a file read for comparing). `name` is null when it is the
// same.
function diffDefinitions(older, newer) {
  const kinds = {};
  for (const kind of DEF_KINDS) {
    kinds[kind] = diffCollection((older && older[DEF_COLLECTIONS[kind]]) || {}, (newer && newer[DEF_COLLECTIONS[kind]]) || {});
  }
  const from = (older && older.name) || '';
  const to = (newer && newer.name) || '';
  return { name: from === to ? null : { from, to }, kinds };
}

// Each command's derived boundary on both sides, query item by query
// item and round by round (`boundarySummary`), every item marked
// `same`, `added` or `removed`. An item is its types and tags, sorted –
// the alias or projection that brought it is not part of what is read.
// `lostTags` is the one finding named: an event type the older side
// read by a tag and the newer side reads untagged – the boundary grew
// from one instance to all of them. A body the derivation throws on
// reads as reading nothing; its problem is the advisories' to tell.
function compareBoundaries(older, newer) {
  const commandsOf = (model) => (model && model['command-definitions']) || {};
  const roundsOf = (model, body) => {
    if (!body) return [];
    let summary;
    try { summary = boundarySummary(model, body); } catch { return []; }
    const rounds = summary.queries.length ? summary.queries : (summary.items.length ? [summary.items] : []);
    return rounds.map((round) => {
      const seen = new Map();
      for (const item of round) {
        const types = [...item.types].sort();
        const tags = [...item.tags].sort();
        const key = `${types.join(',')}|${tags.join(',')}`;
        if (!seen.has(key)) seen.set(key, { key, types, tags });
      }
      return [...seen.values()];
    });
  };
  const olderCommands = commandsOf(older);
  const newerCommands = commandsOf(newer);
  const names = [...Object.keys(newerCommands), ...Object.keys(olderCommands).filter((name) => !(name in newerCommands))];
  return names.map((name) => {
    const before = roundsOf(older, olderCommands[name]);
    const after = roundsOf(newer, newerCommands[name]);
    const items = [];
    for (let r = 0; r < Math.max(before.length, after.length); r++) {
      const was = before[r] || [];
      const now = after[r] || [];
      const nowKeys = new Set(now.map((item) => item.key));
      const wasKeys = new Set(was.map((item) => item.key));
      for (const item of was) items.push({ round: r, types: item.types, tags: item.tags, mark: nowKeys.has(item.key) ? 'same' : 'removed' });
      for (const item of now) if (!wasKeys.has(item.key)) items.push({ round: r, types: item.types, tags: item.tags, mark: 'added' });
    }
    const wasItems = before.flat();
    const taggedBefore = new Set(wasItems.filter((item) => item.tags.length).flatMap((item) => item.types));
    const untaggedBefore = new Set(wasItems.filter((item) => !item.tags.length).flatMap((item) => item.types));
    const lostTags = after.flat()
      .filter((item) => !item.tags.length)
      .map((item) => (item.types.length ? item.types : [...taggedBefore].sort())
        .filter((type) => taggedBefore.has(type) && !untaggedBefore.has(type)))
      .filter((types) => types.length);
    const status = !(name in olderCommands) ? 'added'
      : !(name in newerCommands) ? 'removed'
      : items.some((item) => item.mark !== 'same') ? 'changed' : 'same';
    return { name, status, items, lostTags };
  });
}

// The Problems panel on both sides: what the newer side reports that
// the older did not (`introduced`) and the reverse (`fixed`), each
// advisory known by its kind, name and message.
function compareProblems(older, newer) {
  const key = (problem) => `${problem.kind}\n${problem.name}\n${problem.message}`;
  const was = older ? modelAdvisories(older) : [];
  const now = newer ? modelAdvisories(newer) : [];
  const wasKeys = new Set(was.map(key));
  const nowKeys = new Set(now.map(key));
  return {
    introduced: now.filter((problem) => !wasKeys.has(key(problem))),
    fixed: was.filter((problem) => !nowKeys.has(key(problem))),
  };
}

// The whole model at once – every definition kind but the two scenario
// kinds, as ordered `{ name: body }` maps – written as the difference
// from what is stored: an added, updated, removed or reordered event
// for exactly what changed, and all of them in one append, so a
// gesture that rewrote the model from a text is one undo step and one
// that changed nothing appends nothing. A body equal to its stored one
// up to `sameDefinition` keeps the stored spelling.
//
// The code view is the writer this exists for, and it is why this is
// a replacement and not a merge: a definition missing from the text is
// one the author deleted. The scenario kinds are replaced the same way
// when `next.collections` carries them, and left alone when it does not.
//
// Only structure is refused, the same as every other writer (see
// `assertStorableBody`); a body arriving whole keeps every read it came
// with – pruning is the next *edit's* business, as for an import. Names
// are trimmed like everywhere else, and a name the fold could not key
// a collection by (`constructor`, `__proto__`) is refused.
function replaceDefinitions(modelId, next) {
  const model = getCtxOrThrow(modelId);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const events = [];
  const summary = { added: [], updated: [], removed: [], reordered: [], renamed: null };
  if (next.name !== undefined && next.name !== null) {
    const name = validateModelName(next.name);
    if (name !== model.name) {
      events.push({ type: 'dcb-model-renamed', data: { 'dcb-model-id': modelId, name } });
      summary.renamed = name;
    }
  }
  // A text is the whole model, its description included: said only by
  // a caller that passes `description` (null for none).
  if (next.description !== undefined) {
    const description = normalizedDescription(next.description);
    if (description !== (model.description === undefined ? null : model.description)) {
      events.push({ type: 'dcb-model-described', data: { 'dcb-model-id': modelId, description } });
    }
  }
  // The two scenario kinds are written only when asked for – a caller
  // that says nothing about them leaves them as they are.
  const kinds = [...ADVISORY_KINDS, ...ID_KEYED_KINDS.filter((kind) => next.collections[kind] !== undefined)];
  // A group and a top-level projection are read by their names alike –
  // the one collision across two collections (`assertNoNameClash`).
  const groupNames = Object.keys(next.collections['group-definition'] || {}).map((key) => String(key).trim());
  const clash = Object.keys(next.collections['projection-definition'] || {})
    .find((key) => groupNames.includes(String(key).trim()));
  if (clash !== undefined) {
    throw new DomainError(`A group and a projection are both named "${String(clash).trim()}" – they are read by their `
      + 'names alike, so they cannot share one.');
  }
  for (const kind of kinds) {
    const current = model[DEF_COLLECTIONS[kind]];
    const wanted = {};
    for (const [key, body] of Object.entries(next.collections[kind] || {})) {
      const name = validateDefinitionKey(kind, key, `${humanize(kind)} name`);
      if (name in Object.prototype) throw new DomainError(`"${name}" cannot name a ${humanize(kind).toLowerCase()}.`);
      if (has(wanted, name)) throw new DomainError(`Two ${humanize(kind).toLowerCase()}s are named "${name}".`);
      assertStorableBody(kind, body, name);
      wanted[name] = body;
    }
    const diff = diffCollection(current, wanted);
    for (const name of diff.removed) {
      events.push({ type: `${kind}-removed`, data: { 'dcb-model-id': modelId, name } });
      summary.removed.push({ kind, name });
    }
    for (const [name, body] of Object.entries(wanted)) {
      if (diff.added.includes(name)) {
        events.push({ type: `${kind}-added`, data: { 'dcb-model-id': modelId, name, body } });
        summary.added.push({ kind, name });
      } else if (diff.changed.includes(name)) {
        events.push({ type: `${kind}-updated`, data: { 'dcb-model-id': modelId, name, body } });
        summary.updated.push({ kind, name });
      }
    }
    if (diff.reordered) {
      events.push({ type: `${kind}-reordered`, data: { 'dcb-model-id': modelId, order: Object.keys(wanted) } });
      summary.reordered.push({ kind });
    }
  }
  // A caller that may not remove – an agent that did not say it means
  // to – is refused whole, told what the text left out.
  if (next.refuseRemovals && summary.removed.length) {
    const error = new DomainError(`This would remove ${removalWords(summary.removed)}, which the text leaves out `
      + '– nothing was applied.');
    error.removed = summary.removed;
    throw error;
  }
  if (events.length) appendEvents(events);
  return summary;
}

// `event A, command B and 3 scenarios`, for a refusal to say what goes.
function removalWords(removed) {
  const named = removed.filter((item) => !isIdKeyed(item.kind))
    .map((item) => `${item.kind.replace(/-definition$/, '').replace(/-/g, ' ')} ${item.name}`);
  const scenarios = removed.length - named.length;
  const parts = [...named, ...(scenarios ? [`${scenarios} scenario${scenarios === 1 ? '' : 's'}`] : [])];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

// ============================================================
// Utilities the model layer leans on.
// ============================================================

// The value a freshly created projection starts from, chosen from its
// type so the editor can pre-fill one – the stored value is always
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
// the definition arrays themselves – the six kinds, plus
// `projectionScenarioDefinitions?` and `sandbox?` – and it is exactly what
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
// hangs off a projection rather than being one of them.
//
// Two markers say what a document is, and they are not
// interchangeable. `dcbModelVersion` is the one an importer
// dispatches on. `$schema` is for editors – it is what makes a
// hand-edited export complete and validate in place – and nothing here
// ever reads it, deliberately: repointing it at a local copy to work
// offline is a legitimate thing to do to a document, and a reader that
// checked it would reject exactly the files someone had been careful
// with.
//
// Both ride in both directions out of the playground – readable JSON
// and the gzipped payload of a share link – because a marker one
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
// ignores – which the validation in this file makes possible by
// checking only what it knows about and never rejecting a key it has
// not heard of (`CommandDefinition.feature` has ridden along that way
// from the start). What counts as additive is judged from the reader's
// side, though, not the schema's: another member of a closed vocabulary
// – a condition operator, an operand shape, a handler operation – is a
// *major* change even where the schema merely grows an enum, because
// `operationsFor` fails on the value rather than passing it through.
// 2.0 unified projections: entity properties became bindings to
// ordinary projection definitions, partitions became explicit
// parameters, `isOptional` was dropped and initial values grew typed
// (possibly non-empty) lists, and property scenarios became projection
// scenarios asserting over a list of reads – every one of them a change
// a 1.x reader would misread rather than ignore.
// 4.0 added `isOptional` on boundary bindings: an unset identifier
// binds nothing instead of erroring, conditions over the alias hold
// vacuously, and reading a property of it yields null. Additive in
// shape – which is exactly the trap the reader-side rule exists for: a
// 3.x reader ignores the flag and errors on the very case the author
// declared expected, so this is a major. The other direction is safe:
// a 3.x document never says it, so this build reads 3.x whole
// (`READABLE_MAJORS`).
// 4.1 lifted a documented restriction rather than adding anything: a
// *scripted* projection's `valueType` may be a composite value type.
// No shape changed, and a 4.0 reader loads and evaluates such a
// document correctly – equality was always deep, a composite was
// always offered identity predicates only, and a scripted fold is
// opaque code either way. The one thing it does wrong is flag the
// projection with the advisory that used to guard the restriction,
// which is exactly the non-blocking miss `envelopeVersionWarning`
// exists to explain.
// 5.0 is the closed-vocabulary kind the reader-side rule names
// outright: `equalsAny` joined the binary predicates – one scalar
// against a literal list, spelled as a bare array of literals and
// enum-member references in `rightHandSide`, the same list spelling
// initial values already had. A 4.x reader fails on the predicate in
// `evApplyPredicate` rather than passing it through, so this is a
// major even though nothing a 4.x document says changed; this build
// reads 3.x and 4.x whole.
// 6.0 added two members at once, each the closed-vocabulary kind: an
// emission may carry `when` (conditions under which it publishes –
// failing a guard skips the emission, never rejects the command), and
// a projection may be derived (`derived` in place of handlers: one
// declared predicate over other projections, always a boolean). A 5.x
// reader would publish what an author made conditional and has no
// fold for a handlerless projection – both misreads, so this is a
// major; this build reads 3.x, 4.x and 5.x whole.
// 6.1 gave an entity an optional `lifecycle`, naming which of its own
// properties is the state it is in – and made the two-state case an
// ordinary `boolean` projection rather than a `NonExistent`/`Existent`
// enum. Judged from the reader's side this is a minor, which is the
// distinction 4.0 is here to sharpen: a 6.0 reader that ignores
// `lifecycle` loses a diagram, and a boolean-typed projection was
// always readable – no condition changed shape, `evaluate.js` did not
// change, and nothing evaluates differently. Contrast 4.0, where the
// ignored flag made the old reader error on exactly the case the flag
// declared expected. So the schema URL stays at v6 and `READABLE_MAJORS`
// is untouched. What a 6.0 reader misses is what the version warning
// exists to say.
// 7.0 gave every rule a rejection message – `rejection` on each of a
// command's conditions, the sentence it is refused with – and made a
// refusal known by it: a scenario's Then carries the message as
// `rejection`, and nothing else about the refusal – not the condition's
// text or index, nor the values it read. Required on both sides, so a 6.x
// reader cannot read a 7.0 document, and this build reads no earlier
// major: a 6.x rule has no message, and inventing one would put words
// in the author's mouth that every scenario then asserts.
// 8.0 made tags explicit: an event lists the values it is tagged by
// (`tags`, property paths), and one without the list carries none; a
// projection names the tags it is read by, and a read gives a value per
// name. A 7.x reader would tag what this document leaves untagged, and
// a 7.x document read here would carry no tag at all – so this build
// reads 8.x only. Nothing is public yet; there is no upgrader.
// 9.0 let a derived projection compute as well as compare: `operator`
// (`add`, `subtract`, `multiply`, `min`, `max`) in place of `predicate`,
// over two numbers, yielding a number. A new member of a closed
// vocabulary – an 8.x reader finds no predicate and errors – so a
// major; every 8.x document is a 9.0 document unchanged, so this build
// reads 8.x whole.
// 10.0 gave every kind of projection arguments – values a read gives
// besides its tags, which narrow nothing – where only a script had
// them: `arguments` moved from `script` onto the projection, and a
// derived projection compares or computes with its own parameters
// (`{parameterName}` as a side, or passed on as an operand's tag or
// argument). A new operand member and a moved field: a 9.x reader would
// find a derived side it cannot read and a script with no arguments.
// A 9.x document read here whole, its scripts' arguments lifted on
// import, until 11.0 refused scripts altogether.
// 11.0 replaced entities by groups: `entityDefinitions` – with its
// property bindings, `lifecycle` and a binding's `excluding` – is gone,
// and `groupDefinitions` holds groups that own their projections, read
// by a group binding (`{alias, group, tags}`) member by member
// (`{alias, property, arguments}`) or in place by a qualified name
// (`Course.capacity`). A removed field and a new member of the operand
// vocabulary both ways, so a major. An 8.x to 10.x document is read
// still, its entities lifted into groups where that says the same thing
// and restated as plain reads where it does not (`groupsFromEntities`).
// 11.0 also removed what the language kept for what it could not say:
// scripted projections, `currentValue`, guarded emissions and optional
// reads – members gone from closed vocabularies, so within the major.
// A document saying one is read as far as it can be read correctly
// (`refuseRemovedConstructs`): a script or `currentValue` refuses it
// whole, a guarded emission or an optional read leaves its command out.
const MODEL_VERSION = '11.0';
const MODEL_SCHEMA_URL = 'https://dcb.events/schemas/model/v11.json';
const READABLE_MAJORS = [8, 9, 10, 11];

const SCHEMA_FIELD = {
  'custom-type-definition': 'customTypeDefinitions',
  'event-definition': 'eventDefinitions',
  'group-definition': 'groupDefinitions',
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
  'custom-type-definition', 'event-definition', 'group-definition',
  'projection-definition', 'command-definition', 'scenario-definition',
];

function definitionsToSchemaArray(kind, coll) {
  const idField = isIdKeyed(kind) ? 'id' : 'name';
  return Object.entries(coll || {}).map(([key, body]) => {
    // A projection always says what it is tagged by, if only that it is
    // untagged: a body stored without the list writes the empty one.
    if (kind === 'projection-definition' && body && body.tags === undefined) {
      return { [idField]: key, tags: [], ...body };
    }
    return { [idField]: key, ...body };
  });
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

// ============================================================
// Value schemas.
//
// The values a model's definitions describe – a command's arguments, an
// event's payload – as JSON Schema 2020-12, for whatever has to state
// or check them outside the playground: an API contract, a validator.
// Nothing here enforces anything; the evaluator stays as lenient as it
// is, because a defective model must still run.
//
// A custom scalar type already *is* a JSON Schema (its `schema`), so it
// is carried over whole; a composite is an object of its fields, each
// singular, and required unless optional (11.0) – which may be absent. `refOf(typeName)` says how a property
// names a custom type – a `$ref` into wherever the caller keeps
// `customTypeSchemas`, or, left out, the type's schema inline. An
// unresolved type allows any value; its advisory already says so.
// ============================================================

function customTypeSchema(model, typeName, refOf) {
  const body = model['custom-type-definitions'][typeName];
  if (!body) return {};
  if (Array.isArray(body.properties)) {
    return propertiesSchema(model, body.properties, refOf);
  }
  return deepClone(body.schema || {});
}

function customTypeSchemas(model, refOf) {
  const out = {};
  for (const typeName of Object.keys(model['custom-type-definitions'])) {
    out[typeName] = customTypeSchema(model, typeName, refOf);
  }
  return out;
}

// A time is a string of its JSON Schema format (11.0), its pattern
// stated too, since a validator need not assert formats: a datetime
// with an offset, a duration in days, hours, minutes and seconds.
const TIME_SCHEMAS = {
  datetime: { type: 'string', format: 'date-time', pattern: DATETIME_RE.source },
  duration: { type: 'string', format: 'duration', pattern: DURATION_RE.source },
};

function valueTypeSchema(model, typeName, refOf) {
  const cls = classifyType(model, typeName);
  if (TIME_SCHEMAS[typeName]) return deepClone(TIME_SCHEMAS[typeName]);
  if (cls.kind === 'simple') return { type: typeName };
  if (cls.kind !== 'value') return {};
  return refOf ? refOf(typeName) : customTypeSchema(model, typeName);
}

// One property: its type, a list of it, and `null` when it is optional
// – the one spelling of "no value", an optional list's absence too.
function propertySchema(model, property, refOf) {
  let schema = valueTypeSchema(model, property.propertyType, refOf);
  if (property.isList) schema = { type: 'array', items: schema };
  if (property.isOptional) schema = { anyOf: [schema, { type: 'null' }] };
  return schema;
}

// An object of `properties`, closed: a key no property declares is
// refused, so a misspelt optional argument is an error rather than a
// silent null. An optional property may be left out (`requireAll`
// false – what a command accepts) or must be spelt out, null or not
// (`requireAll` – what an event payload always carries).
function propertiesSchema(model, properties, refOf, { requireAll = false } = {}) {
  const out = { type: 'object', properties: {}, required: [], additionalProperties: false };
  for (const property of properties || []) {
    if (!property || !property.name) continue;
    out.properties[property.name] = propertySchema(model, property, refOf);
    if (requireAll || !property.isOptional) out.required.push(property.name);
  }
  return out;
}

function commandArgumentsSchema(model, commandName, refOf) {
  const body = model['command-definitions'][commandName];
  return propertiesSchema(model, body ? body.properties : [], refOf);
}

function eventPayloadSchema(model, eventName, refOf) {
  const body = model['event-definitions'][eventName];
  return propertiesSchema(model, body ? body.properties : [], refOf, { requireAll: true });
}

// `sandboxSteps` – `[{ command, args }]` – comes in from the caller
// rather than being read off a global here: this file knows nothing of
// the interactive session index.html keeps.
function buildShareEnvelope(model, sandboxSteps) {
  const envelope = {
    $schema: MODEL_SCHEMA_URL,
    dcbModelVersion: MODEL_VERSION,
    name: model.name,
    ...(model.description ? { description: model.description } : {}),
    ...definitionsToSchema(model),
  };
  const propertyScenarios = definitionsToSchemaArray(
    'projection-scenario-definition', model['projection-scenario-definitions']
  );
  if (propertyScenarios.length) envelope.projectionScenarioDefinitions = propertyScenarios;
  if (sandboxSteps && sandboxSteps.length) envelope.sandbox = { steps: sandboxSteps };
  return envelope;
}

// The stored model a shared envelope would import as again, if there
// is one: the same example opened twice from dcb.events, a link pasted
// a second time. Compared as the envelope that model would share now,
// so a copy edited since is not mistaken for the original – an export
// is stable once imported, which a test holds. A sandbox session rides
// along only with a link that carries one, and such a link is always
// imported, so its steps replay.
function modelMatchingEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return null;
  if (envelope.sandbox && envelope.sandbox.steps && envelope.sandbox.steps.length) return null;
  const wanted = JSON.stringify({ ...envelope, sandbox: undefined });
  const models = projectState();
  return Object.keys(models).find((id) => JSON.stringify(buildShareEnvelope(models[id])) === wanted) || null;
}

// The wire format's two markers, checked. Only `dcbModelVersion` is
// read: `$schema` has to be *present*, because a document without one
// was not written by anything that knows this format and its shape is
// a guess from there – but what it points at is the author's business,
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
  // Earlier majors stay readable where the newer format only *added* –
  // a 3.x document never said `via` or a binding's `isOptional`, so
  // 6.x builds read it whole. 7.0 *required* something (a rule's
  // rejection message) that no earlier document has, so this build
  // reads 7.x only. What is refused is a major this build does not
  // read, in either direction.
  if (!READABLE_MAJORS.includes(version.major)) {
    const readable_ = READABLE_MAJORS.map((m) => `${m}.x`).join(' and ');
    throw new DomainError(
      `That file is DCB model ${version.raw}, and this playground reads `
      + `${readable_} (currently ${MODEL_VERSION}). Nothing here would `
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
// is the sixth and is optional, the same way the schema has it. A
// document from before 11.0 declares `entityDefinitions` where a newer
// one declares `groupDefinitions`.
const REQUIRED_SCHEMA_KINDS = SCHEMA_KINDS.filter((kind) => kind !== 'scenario-definition');
const LEGACY_ENTITY_FIELD = 'entityDefinitions';

// An 8.x to 10.x document's entities, read as 11.0 says them. Pure: the
// collections in, `{customTypes, groups, projections, commands,
// projectionScenarios, notes}` out, nothing stored.
//
// An entity becomes a group when that says the same thing: every
// projection it binds is tagged by exactly its identifier and bound by
// no other entity, and no projection carries its name. The bindings'
// names become the local names, the projections move inside, and every
// read of one – a command's read in place or alias, a derived operand,
// a projection scenario – is rewritten to read it through the group,
// its tag renamed to the group's where the two differed. An entity
// binding becomes a group binding, `{alias, group, tags}`, and the
// arguments it gave go to the member reads whose projections take them.
// Any other entity is restated as plain reads, the way the shipped
// models were in 8.0: each property read becomes the read in place of
// the projection it bound, by the identifier the entity was read by,
// and the binding goes. Either way a lifecycle designation goes
// without a trace – it decided nothing. A command whose binding said
// `excluding` is left out: reading every instance instead would change
// what its rules decide, silently. `notes` says each time it dropped
// or left out something, and what became of every entity. An identifier type the document
// never listed is created, a plain string marked as a tag.
function groupsFromEntities({ customTypes = {}, entities = {}, projections = {}, commands = {}, projectionScenarios = {} }) {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const out = deepClone({ customTypes, projections, commands, projectionScenarios });
  const groups = {};
  const notes = [];
  const bound = new Map();
  for (const entity of Object.values(entities)) {
    for (const p of (entity && entity.properties) || []) {
      if (p && p.projection) bound.set(p.projection, (bound.get(p.projection) || 0) + 1);
    }
  }

  const shapes = {};
  for (const [name, entity] of Object.entries(entities)) {
    const idType = (entity && entity.identifierType) || `${name}Id`;
    const tag = { name: (entity && entity.identifierName) || defaultAlias(idType), tagType: idType };
    if (!own(out.customTypes, idType)) out.customTypes[idType] = { schema: { type: 'string' }, isTag: true };
    const members = new Map();
    let why = own(projections, name) ? `a projection is named ${name} too` : null;
    for (const p of (entity && entity.properties) || []) {
      if (why) break;
      const projection = p && own(projections, p.projection) ? projections[p.projection] : null;
      const tags = projectionTagParams(projection);
      if (!p || typeof p.name !== 'string' || !/^\p{Ll}[\p{L}\p{M}\p{Nd}]*$/u.test(p.name)) why = `a property is not named in lowerCamel`;
      else if (members.has(p.name)) why = `it binds "${p.name}" twice`;
      else if (!projection) why = `"${p.name}" binds ${p.projection}, which the document does not define`;
      else if (tags.length !== 1 || tags[0].tagType !== idType) why = `${p.projection} is not tagged by exactly one ${idType}`;
      else if (bound.get(p.projection) > 1) why = `${p.projection} is bound more than once`;
      else members.set(p.name, p.projection);
    }
    const propertyOf = new Map(((entity && entity.properties) || []).filter(Boolean).map((p) => [p.name, p.projection]));
    shapes[name] = { tag, idType, members, propertyOf, clean: !why };
    notes.push(why
      ? { kind: 'command-definition', name, note: `Entity ${name} was restated as plain reads – ${why}.` }
      : { kind: 'group-definition', name, note: `Entity ${name} became the group ${name}.` });
  }

  // The projections a clean entity bound, moved into its group.
  const moved = new Map();
  for (const [name, entity] of Object.entries(entities)) {
    const shape = shapes[name];
    if (!shape.clean) continue;
    groups[name] = { ...(entity && entity.icon ? { icon: entity.icon } : {}), tag: shape.tag, projections: [] };
    for (const [local, projectionName] of shape.members) {
      const oldTag = projectionTagParams(projections[projectionName])[0].name;
      moved.set(projectionName, { group: name, local, oldTag, tag: shape.tag });
      const inner = storedGroupProjection(local, out.projections[projectionName]);
      if (inner.derived) {
        forEachOwnParameterRefOf(inner, (ref) => { if (ref.parameterName === oldTag) ref.parameterName = shape.tag.name; });
      }
      groups[name].projections.push(inner);
      delete out.projections[projectionName];
    }
  }
  const movedRead = (read) => {
    const m = read && moved.get(read.projection);
    if (!m) return;
    read.projection = qualifiedProjectionName(m.group, m.local);
    if (read.tags && typeof read.tags === 'object' && !Array.isArray(read.tags) && m.oldTag !== m.tag.name) {
      read.tags = renameKey(read.tags, m.oldTag, m.tag.name);
    }
  };
  const bodies = [...Object.values(out.projections), ...Object.values(groups).flatMap((g) => g.projections)];
  for (const body of bodies) {
    for (const operand of derivedReads(body && body.derived)) {
      if (operandSource(operand) === 'projection-read') movedRead(operand);
    }
  }
  for (const [name, group] of Object.entries(groups)) {
    for (const inner of group.projections) siblingReadsInside(inner.derived, name, group.tag);
  }
  for (const scenario of Object.values(out.projectionScenarios)) if (scenario) movedRead(scenario);

  for (const [commandName, command] of Object.entries(out.commands)) {
    if (!command || !Array.isArray(command.boundary)) continue;
    const excluded = command.boundary.find((b) => b && b.entity !== undefined && b.excluding !== undefined);
    if (excluded) {
      notes.push({ kind: 'command-definition', name: commandName, note: `"${excluded.alias}" excluded `
        + `${operandText(excluded.excluding)}, which nothing can say any more – the command was not imported, `
        + 'since reading every instance would change what its rules decide.' });
      delete out.commands[commandName];
      continue;
    }
    const entityAliases = new Map(command.boundary
      .filter((b) => b && b.entity !== undefined && own(shapes, b.entity)).map((b) => [b.alias, b]));
    const convert = (operand) => {
      if (Array.isArray(operand)) return operand.map(convert);
      if (!operand || typeof operand !== 'object') return operand;
      if (operandSource(operand) === 'alias-property' && entityAliases.has(operand.alias)) {
        const binding = entityAliases.get(operand.alias);
        const shape = shapes[binding.entity];
        const projectionName = shape.propertyOf.get(operand.property);
        const projection = projectionName && own(projections, projectionName) ? projections[projectionName] : null;
        if (!projection) return { ...operand };
        let args = null;
        for (const slot of projectionSlots(projection)) {
          if (binding.arguments && own(binding.arguments, slot.name)) {
            (args = args || {})[slot.name] = convert(binding.arguments[slot.name]);
          }
        }
        if (shape.clean) return { alias: operand.alias, property: operand.property, ...(args ? { arguments: args } : {}) };
        const tags = {};
        for (const tag of projectionTagParams(projection)) {
          if (tag.tagType === shape.idType) tags[tag.name] = convert(binding.id);
        }
        return { projection: projectionName, tags, ...(args ? { arguments: args } : {}) };
      }
      const copy = {};
      for (const [key, value] of Object.entries(operand)) copy[key] = convert(value);
      return copy;
    };
    const convertRead = (binding) => {
      const copy = { ...binding };
      if (binding.tags && typeof binding.tags === 'object') copy.tags = convert(binding.tags);
      if (binding.arguments && typeof binding.arguments === 'object') copy.arguments = convert(binding.arguments);
      return copy;
    };
    command.boundary = command.boundary.map((binding) => {
      if (!binding || binding.entity === undefined) return binding ? convertRead(binding) : binding;
      const shape = own(shapes, binding.entity) ? shapes[binding.entity] : null;
      if (!shape || !shape.clean) return null;
      return {
        alias: binding.alias,
        group: binding.entity,
        tags: { [shape.tag.name]: convert(binding.id) },
      };
    }).filter((binding) => binding !== null);
    if (Array.isArray(command.steps)) command.steps = convert(command.steps);
    for (const binding of command.boundary) if (binding && binding.projection !== undefined) movedRead(binding);
    forEachCommandOperand(command, (operand) => { if (operandSource(operand) === 'projection-read') movedRead(operand); });
    // Before 11.0 nothing was grouped, so every qualified read here is
    // one this conversion moved.
    aliasGroupReads(command, (name) => !!splitQualifiedName(name));
  }
  return { ...out, groups, notes };
}

// What a document still says that 11.0 removed (`removedConstructIn`),
// read before anything is stored. A projection that is scripted or sets
// from `currentValue` refuses the whole document: its value decides
// rules, and no other spelling of it is there to read – nor is a
// script's code something an import can safely run, or translate. A
// command that guards an emission or reads optionally is left out, and
// said – the rest of it is readable, but publishing every time or
// requiring the read would change what it decides, silently. `commands` loses the
// ones left out; the notes are returned, beside `groupsFromEntities`'.
function refuseRemovedConstructs({ groups, projections, commands }) {
  for (const [kind, coll] of [['group-definition', groups], ['projection-definition', projections]]) {
    for (const [name, body] of Object.entries(coll)) {
      const found = removedConstructIn(kind, body);
      if (found) throw new DomainError(`${removedConstructMessage(kind, name, found)}, so this model cannot be imported.`);
    }
  }
  const notes = [];
  for (const [name, body] of Object.entries(commands)) {
    const found = removedConstructIn('command-definition', body);
    if (!found || !REMOVED_COMMAND_NOTES[found.construct]) continue;
    notes.push({ kind: 'command-definition', name, note: REMOVED_COMMAND_NOTES[found.construct](name, found) });
    delete commands[name];
  }
  return notes;
}

// A command as a document before steps wrote it, lifted in place: its
// `conditions` and `publishes` become `steps` (`stepsFrom`). One that
// has `steps` already is left as it is.
function liftCommandSteps(command) {
  if (!command || typeof command !== 'object') return command;
  if (command.conditions === undefined && command.publishes === undefined) return command;
  if (command.steps === undefined) command.steps = stepsFrom(command.conditions, command.publishes);
  delete command.conditions;
  delete command.publishes;
  return command;
}

const REMOVED_COMMAND_NOTES = {
  guard: (command, { emission }) => `${command}'s emission of "${emission}" was guarded (when …), which nothing can `
    + 'say any more – the command was not imported, since publishing it every time would change what it decides.',
  optional: (command, { alias }) => `${command}'s "${alias}" was an optional read (${alias}?), which nothing can say `
    + 'any more – the command was not imported, since an unset identifier would now be an error where it used to '
    + 'read nothing.',
};

// The synthesizer: rebuilds a shared model into a brand-new one by
// replaying it through the same commands manual editing uses, so an
// untrusted export can never land in a state those commands would have
// refused. The commands refuse little now – structure, collisions –
// and what one does refuse is *skipped* rather than aborting the
// import: the rest of the model loads, and the skips come back to the
// caller to report, beside what a document from before 11.0 had
// `converted` (`groupsFromEntities`). Semantic defects in what did load
// are the advisories' to surface, the same as for any other edit.
function importModelFromEnvelope(envelope) {
  const version = assertEnvelopeVersion(envelope);
  const legacy = version.major < 11;
  // There is no wrapper object to look for any more – the definition
  // arrays sit directly on the envelope – so what identifies a model is
  // that the kinds one must declare are actually there and are lists.
  const required = REQUIRED_SCHEMA_KINDS.map((kind) => (legacy && kind === 'group-definition'
    ? LEGACY_ENTITY_FIELD : SCHEMA_FIELD[kind]));
  for (const field of required) {
    if (!Array.isArray(envelope[field])) {
      throw new DomainError('That does not look like a shared DCB model.');
    }
  }
  // Required, and deliberately not defaulted: inventing a name for a
  // document that has none buries the fact that it was malformed under
  // a model called something plausible.
  if (typeof envelope.name !== 'string' || !envelope.name) {
    throw new DomainError('That model has no name.');
  }
  let customTypes = schemaArrayToDefinitions('custom-type-definition', envelope.customTypeDefinitions);
  const events = schemaArrayToDefinitions('event-definition', envelope.eventDefinitions);
  let groups = schemaArrayToDefinitions('group-definition', legacy ? [] : envelope.groupDefinitions);
  let projections = schemaArrayToDefinitions('projection-definition', envelope.projectionDefinitions);
  let commands = schemaArrayToDefinitions('command-definition', envelope.commandDefinitions);
  const scenarios = schemaArrayToDefinitions('scenario-definition', envelope.scenarioDefinitions);
  let propertyScenarios = schemaArrayToDefinitions(
    'projection-scenario-definition', envelope.projectionScenarioDefinitions
  );
  let converted = refuseRemovedConstructs({ groups, projections, commands });
  // Before this revision of 11.0 a command held `conditions` and
  // `publishes`; it evaluated them as the rules, then the emissions, and
  // that is the order its steps take (`stepsFrom`) – nothing changes.
  for (const command of Object.values(commands)) liftCommandSteps(command);
  if (legacy) {
    const lifted = groupsFromEntities({
      customTypes,
      entities: schemaArrayToDefinitions('group-definition', envelope[LEGACY_ENTITY_FIELD]),
      projections,
      commands,
      projectionScenarios: propertyScenarios,
    });
    ({ customTypes, groups, projections, commands } = lifted);
    propertyScenarios = lifted.projectionScenarios;
    converted = [...converted, ...lifted.notes];
  }

  const modelId = createDcbModel(envelope.name);
  if (typeof envelope.description === 'string') describeDcbModel(modelId, envelope.description);

  const skipped = [];
  const attempt = (kind, name, write) => {
    try {
      write();
    } catch (error) {
      skipped.push({ kind, name, reason: error && error.message ? error.message : String(error) });
    }
  };

  // In the order the document lists them: nothing is checked against
  // anything else on the way in, so no kind has to wait for another –
  // a reference that never resolves is an advisory afterwards. A group
  // and a projection sharing a name are the one collision across kinds;
  // the projection that comes second is skipped.
  for (const [name, body] of Object.entries(customTypes)) {
    attempt('custom-type-definition', name, () => addDefinition('custom-type-definition', modelId, name, body));
  }
  for (const [name, body] of Object.entries(events)) {
    attempt('event-definition', name, () => addDefinition('event-definition', modelId, name, body));
  }
  for (const [name, body] of Object.entries(groups)) {
    attempt('group-definition', name, () => addDefinition('group-definition', modelId, name, body));
  }
  for (const [name, body] of Object.entries(projections)) {
    attempt('projection-definition', name, () => addDefinition('projection-definition', modelId, name, body));
  }
  for (const [name, body] of Object.entries(commands)) {
    attempt('command-definition', name, () => addDefinition('command-definition', modelId, name, body));
  }
  // Scenario ids come across as they were exported rather than being
  // reissued here, so that a model survives a round trip unchanged and
  // a re-import can be diffed against what was sent. `generateId` is the
  // fallback for a hand-written file that reached this point without one.
  for (const [id, body] of Object.entries(scenarios)) {
    attempt('scenario-definition', id, () => addDefinition('scenario-definition', modelId, id || generateId(), body));
  }
  for (const [id, body] of Object.entries(propertyScenarios)) {
    attempt('projection-scenario-definition', id,
      () => addDefinition('projection-scenario-definition', modelId, id || generateId(), body));
  }
  return { modelId, skipped, converted };
}

// An envelope read as a model to compare against, never stored: the
// import above, run against a scratch log (`inScratchLog`). The same
// refusals, the same skipped list and the same conversion notes as an
// import – a command left out among them; the model returned is a fold
// of the scratch log and belongs to no one.
function modelFromEnvelope(envelope) {
  return inScratchLog((log) => {
    const { modelId, skipped, converted } = importModelFromEnvelope(envelope);
    return { model: projectEvents(log)[modelId], skipped, converted };
  });
}

// A stored model without its last `count` events – as it was before
// its latest undo steps, say – or null if it did not exist yet. A fold
// of the model's own events only: every event belongs to one model, so
// what other models appended in between changes nothing here.
function modelWithoutLast(modelId, count) {
  const own = loadEvents().filter((event) => event.data && event.data['dcb-model-id'] === modelId);
  return projectEvents(own.slice(0, Math.max(0, own.length - count)))[modelId] || null;
}

// ============================================================
// Predefined models.
//
// The suites' fixtures and what `print-model.js` prints; the examples
// themselves live on dcb.events. Most are built in layers, because that
// is the order the design was arrived at: a course-subscription model
// as the plain thing, then generated identifiers, then tenancy; a
// content model in several spellings of one decision. Each layer is
// applied through the ordinary commands, so loading one exercises
// exactly the write path an author would hit typing it in – and ships
// advisory-clean, which the tests hold it to.
//
// They are stated without groups, as the examples on dcb.events are:
// every rule reads the projection it is about in place, by the tag it
// is kept per (`seedRead`). The course and content models were designed
// with entities, and were restated this way in 8.0; since 11.0 they are
// built so directly.
// ============================================================

// An enum is an ordinary scalar custom type whose schema carries
// `enum`. Only a state with three or more values needs one; two are a
// `boolean` projection and no type.
const seedEnumType = (name, members) => ({ schema: { type: 'string', enum: members } });
// An identifier: a plain string, marked as a tag.
const seedTagType = () => ({ schema: { type: 'string' }, isTag: true });
const seedProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: false });
const seedListProp = (name, type) => ({ name, propertyType: type, isOptional: false, isList: true });
const seedHandler = (event, operation, value) => ({ event, operation, value });
const seedParam = (name) => ({ parameterName: name });
// `{alias}` with no property reads a bound projection's single value.
const seedOf = (alias, property) => (property === undefined ? { alias } : { alias, property });
const seedReadProjection = (alias, projection, tags = {}) =>
  ({ alias, projection, tags });
// A read in place, `CourseStatus(courseId)`: the projection and a value
// for each tag it declares, by name.
const seedRead = (projection, tags, args) => ({ projection, tags, ...(args ? { arguments: args } : {}) });
// The one tag a projection about one thing is tagged by – its
// identifier, named after it: `courseId: CourseId`.
const seedThingTag = (thing) => ({
  name: thing.charAt(0).toLowerCase() + thing.slice(1) + 'Id',
  tagType: thing + 'Id',
});
// A projection about one thing, tagged by its identifier.
const seedThingProjection = (thing, valueType, initialValue, handlers, extra = {}) => ({
  tags: [seedThingTag(thing)], valueType, isList: false, initialValue, handlers, ...extra,
});
// An event's tags, written out: every tag-typed value its properties
// hold. A seed states them like any author would – nothing is implied
// on the way in – and this only saves restating each list by hand.
const seedTags = (modelId, properties) => tagPathsOf(getCtxOrThrow(modelId), properties);

// A scenario a seed ships with. The id is written out rather than
// generated so that regenerating an example produces the same file –
// a fresh id on every run would make every regeneration a diff.
function seedProjectionScenario(modelId, id, body) {
  addDefinition('projection-scenario-definition', modelId, id, body);
}

// A seed states a command the way it reads – its rules, then what it
// emits – and stores it as the steps that are (`liftCommandSteps`).
// None of them branches, so nothing is lost either way.
function seedCommand(modelId, name, body) {
  addDefinition('command-definition', modelId, name, liftCommandSteps(deepClone(body)));
}

// Reads a definition back and writes the modified copy, so a later
// layer never has to restate the shape an earlier one produced.
function seedPatch(kind, modelId, name, mutate) {
  const body = deepClone(getCtxOrThrow(modelId)[DEF_COLLECTIONS[kind]][name]);
  mutate(body);
  updateDefinition(kind, modelId, name, body);
}

// A later layer's change to a seed command, made to the same two lists.
function seedPatchCommand(modelId, name, mutate) {
  seedPatch('command-definition', modelId, name, (body) => {
    const steps = commandSteps(body);
    body.conditions = steps.filter((step) => stepKind(step) === 'rule')
      .map((rule) => ({ ...rule.condition, rejection: rule.rejection }));
    body.publishes = steps.filter((step) => stepKind(step) === 'emit');
    delete body.steps;
    mutate(body);
    liftCommandSteps(body);
  });
}

function seedBase(modelId) {
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const course = (projection) => seedRead(projection, { courseId: param('courseId') });
  const student = (projection) => seedRead(projection, { studentId: param('studentId') });

  // 1. One enum – the course's, because a course has three states to
  //    be in. A student has two, so it needs no enum and gets none: it
  //    either exists or it does not, a plain boolean. Then the two
  //    identifiers – Student first, since a course's subscriber list is
  //    typed StudentId.
  addDefinition('custom-type-definition', modelId, 'CourseStatus', seedEnumType('CourseStatus', ['NonExistent', 'Existent', 'Archived']));
  addDefinition('custom-type-definition', modelId, 'StudentId', seedTagType());
  addDefinition('custom-type-definition', modelId, 'CourseId', seedTagType());

  // 2. Events. Their identifier properties are what carry the tags.
  const event = (name, properties) =>
    addDefinition('event-definition', modelId, name, { properties, tags: seedTags(modelId, properties) });

  event('CourseDefined', [prop('courseId', 'CourseId'), prop('capacity', 'integer')]);
  event('CourseCapacityChanged', [prop('courseId', 'CourseId'), prop('newCapacity', 'integer')]);
  event('CourseArchived', [prop('courseId', 'CourseId')]);
  event('StudentRegistered', [prop('studentId', 'StudentId')]);
  event('StudentSubscribedToCourse', [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')]);
  event('StudentUnsubscribedFromCourse', [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')]);

  // 3. The projections – each tagged by the identifier of what it is
  //    about, which is what a rule reads it by. A course's subscription
  //    count and a student's are two folds, each kept per its own tag.
  const projection = (name, body) =>
    addDefinition('projection-definition', modelId, name, body);

  projection('StudentExists', seedThingProjection('Student', 'boolean',
    false,
    [handler('StudentRegistered', 'set', true)]));
  projection('StudentSubscriptionCount', seedThingProjection('Student', 'integer', 0, [
    handler('StudentSubscribedToCourse', 'increment', 1),
    handler('StudentUnsubscribedFromCourse', 'decrement', 1),
  ]));

  projection('CourseStatus', seedThingProjection('Course', 'CourseStatus',
    { enumMember: 'NonExistent' }, [
      handler('CourseDefined', 'set', { enumMember: 'Existent' }),
      handler('CourseArchived', 'set', { enumMember: 'Archived' }),
    ]));
  projection('CourseCapacity', seedThingProjection('Course', 'integer', 0, [
    handler('CourseDefined', 'set', { eventProperty: 'capacity' }),
    handler('CourseCapacityChanged', 'set', { eventProperty: 'newCapacity' }),
  ]));
  projection('CourseSubscriptionCount', seedThingProjection('Course', 'integer', 0, [
    handler('StudentSubscribedToCourse', 'increment', 1),
    handler('StudentUnsubscribedFromCourse', 'decrement', 1),
  ]));
  projection('CourseSubscribedStudentIds', seedThingProjection('Course', 'StudentId', [], [
    handler('StudentSubscribedToCourse', 'append', { eventProperty: 'studentId' }),
    handler('StudentUnsubscribedFromCourse', 'remove', { eventProperty: 'studentId' }),
  ], { isList: true }));

  // 4. Commands. Every rule reads what it is about in place; those reads
  //    are the DCB.
  const command = (name, body) => seedCommand(modelId, name, body);

  command('DefineCourse', {
    properties: [prop('courseId', 'CourseId'), prop('capacity', 'integer')],
    boundary: [],
    conditions: [
      { leftHandSide: course('CourseStatus'), predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' },
        rejection: 'Course already exists' },
    ],
    publishes: [{
      name: 'CourseDefined',
      parameters: { courseId: param('courseId'), capacity: param('capacity') },
    }],
  });

  command('ChangeCourseCapacity', {
    properties: [prop('courseId', 'CourseId'), prop('newCapacity', 'integer')],
    boundary: [],
    conditions: [
      { leftHandSide: course('CourseStatus'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
        rejection: 'Course is not active' },
      { leftHandSide: course('CourseSubscriptionCount'), predicate: 'lessThanOrEquals', rightHandSide: param('newCapacity'),
        rejection: 'Course has more subscriptions than that' },
    ],
    publishes: [{
      name: 'CourseCapacityChanged',
      parameters: { courseId: param('courseId'), newCapacity: param('newCapacity') },
    }],
  });

  command('ArchiveCourse', {
    properties: [prop('courseId', 'CourseId')],
    boundary: [],
    conditions: [
      { leftHandSide: course('CourseStatus'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
        rejection: 'Course is not active' },
    ],
    publishes: [{ name: 'CourseArchived', parameters: { courseId: param('courseId') } }],
  });

  command('RegisterStudent', {
    properties: [prop('studentId', 'StudentId')],
    boundary: [],
    conditions: [
      { leftHandSide: student('StudentExists'), predicate: 'isFalse',
        rejection: 'Student is already registered' },
    ],
    publishes: [{ name: 'StudentRegistered', parameters: { studentId: param('studentId') } }],
  });

  command('SubscribeStudentToCourse', {
    properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')],
    boundary: [],
    conditions: [
      { leftHandSide: course('CourseStatus'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
        rejection: 'Course is not active' },
      { leftHandSide: student('StudentExists'), predicate: 'isTrue',
        rejection: 'Student is not registered' },
      { leftHandSide: course('CourseSubscriptionCount'), predicate: 'lessThan', rightHandSide: course('CourseCapacity'),
        rejection: 'Course is full' },
      { leftHandSide: course('CourseSubscribedStudentIds'), predicate: 'contains', rightHandSide: param('studentId'), negate: true,
        rejection: 'Student is already subscribed' },
      { leftHandSide: student('StudentSubscriptionCount'), predicate: 'lessThan', rightHandSide: 10,
        rejection: 'Student is subscribed to too many courses' },
    ],
    publishes: [{
      name: 'StudentSubscribedToCourse',
      parameters: { courseId: param('courseId'), studentId: param('studentId') },
    }],
  });

  command('UnsubscribeStudentFromCourse', {
    properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')],
    // The course only. Which student is asserted by the caller, and
    // whether they are in this course is answered off the course – the
    // student's own state decides nothing here, so reading it would
    // widen the boundary and buy nothing. The event still carries the
    // student's tag, which is what makes a concurrent command that
    // *did* read this student conflict with it.
    boundary: [],
    conditions: [
      { leftHandSide: course('CourseStatus'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
        rejection: 'Course is not active' },
      { leftHandSide: course('CourseSubscribedStudentIds'), predicate: 'contains', rightHandSide: param('studentId'),
        rejection: 'Student is not subscribed' },
    ],
    publishes: [{
      name: 'StudentUnsubscribedFromCourse',
      parameters: { courseId: param('courseId'), studentId: param('studentId') },
    }],
  });
}

// Layer 2: course identifiers stop being supplied and start being
// issued. DefineCourse loses its identifier parameter and its "not
// already used" check, and gains a binding in their place – reading
// the projection contributes `types CourseDefined` to the append
// condition, which is what makes the numbering monotonic and what
// makes the check redundant.
//
// The numbering is an ordinary projection, untagged: its
// value is set to the *successor* of the id each CourseDefined
// carried, so it holds the next number to issue at every point in its
// life – `c1` before anything has happened, `successor(last)` after.
// Project to the last id instead and `initialValue` would have to mean
// two different things depending on whether anything had happened yet.
function seedAddSequence(modelId) {
  seedPatch('custom-type-definition', modelId, 'CourseId', (courseId) => {
    courseId.schema = { type: 'string', pattern: '^c[0-9]+$' };
  });

  addDefinition('projection-definition', modelId, 'CourseNumbering', {
    tags: [],
    valueType: 'CourseId',
    isList: false,
    initialValue: 'c1',
    handlers: [
      seedHandler('CourseDefined', 'set', { successor: { eventProperty: 'courseId' } }),
    ],
  });

  updateDefinition('command-definition', modelId, 'DefineCourse', liftCommandSteps({
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
  }));

}

// Two scenarios over the numbering itself – the thing no command page
// shows in isolation. A numbering is exactly the case worth asserting
// directly: its whole contract is "the next value to issue", at every
// point in its life, and that is a claim about the fold rather than
// about any decision made from it.
//
// A layer of its own rather than part of `seedAddSequence`, because a
// Given is written against the events as they are *now*: the tenancy
// layer adds properties to `CourseDefined`, and a scenario written
// before it is broken by it. That is the mechanism reporting honestly,
// and the models that go on to grow the event should not ship already
// saying so.
//
// The Then is stated here rather than derived, because a seed runs
// against `model.js` alone and the evaluator is not loaded. A test
// (`ui.test.js`) runs every shipped scenario to keep that honest.
function seedSequenceScenarios(modelId) {
  seedProjectionScenario(modelId, 'a29c2e1f-6b04-4f5a-9d13-5f0a2d7c8e41', {
    name: 'issues c1 before anything has happened',
    projection: 'CourseNumbering',
    given: [],
    then: 'c1',
  });
  seedProjectionScenario(modelId, 'f47b9c30-2a8d-4e16-b5c7-9e3a1d604f28', {
    name: 'issues c3 once two courses exist',
    projection: 'CourseNumbering',
    given: [
      { event: 'CourseDefined', data: { courseId: 'c1', capacity: 10 } },
      { event: 'CourseDefined', data: { courseId: 'c2', capacity: 10 } },
    ],
    then: 'c3',
  });
}

// Layer 3: tenancy, and with it a numbering *tagged* by something.
//
// This is the case the old design could not express. It called
// numbering "global by nature" and gave a sequence no tag at all –
// which a numbering per tenant simply falsifies. A projection declares
// the tags it is read by, so restarting the numbering per tenant is a
// numbering tagged by the tenant and nothing else.
//
// Number is not identity. `CourseId` stays globally minted by the
// parameterless `CourseNumbering`, and the per-tenant projection
// issues a human-facing `CourseNumber` that restarts at 1 for each
// tenant. Doing it the other way – minting the id per tenant – would
// have two tenants both writing `Course:c1`, and tags are flat, so
// those two courses would be one instance. It is also how real systems
// work: invoice numbers restart, invoice ids never do.
function seedAddTenancy(modelId) {
  addDefinition('custom-type-definition', modelId, 'TenantId', seedTagType());
  addDefinition('custom-type-definition', modelId, 'CourseNumber', {
    schema: { type: 'string', pattern: '^[0-9]+$' },
  });

  addDefinition('event-definition', modelId, 'TenantRegistered', {
    properties: [seedProp('tenantId', 'TenantId')], tags: ['tenantId'],
  });
  seedPatch('event-definition', modelId, 'CourseDefined', (event) => {
    event.properties.unshift(seedProp('tenantId', 'TenantId'));
    event.properties.push(seedProp('courseNumber', 'CourseNumber'));
    event.tags = ['tenantId', ...event.tags];
  });

  addDefinition('projection-definition', modelId, 'TenantExists',
    seedThingProjection('Tenant', 'boolean', false,
      [seedHandler('TenantRegistered', 'set', true)]));

  // Tagged by the tenant, so one tag: `Tenant:<id> AND type
  // CourseDefined`. Untagged, this would be a global numbering – that
  // is the whole difference.
  addDefinition('projection-definition', modelId, 'TenantCourseNumbering', {
    tags: [seedThingTag('Tenant')],
    valueType: 'CourseNumber',
    isList: false,
    initialValue: '1',
    handlers: [
      seedHandler('CourseDefined', 'set', { successor: { eventProperty: 'courseNumber' } }),
    ],
  });

  const tenantExists = seedRead('TenantExists', { tenantId: seedParam('tenantId') });
  seedCommand(modelId, 'RegisterTenant', {
    properties: [seedProp('tenantId', 'TenantId')],
    boundary: [],
    conditions: [
      { leftHandSide: tenantExists, predicate: 'isFalse',
        rejection: 'Tenant is already registered' },
    ],
    publishes: [{ name: 'TenantRegistered', parameters: { tenantId: seedParam('tenantId') } }],
  });

  // Two reads and a rule, all in one query: none of them names another,
  // so they come back together. This is why queries are counted by the
  // depth of the dependency graph and not by the number of reads.
  seedPatchCommand(modelId, 'DefineCourse', (define) => {
    define.properties.unshift(seedProp('tenantId', 'TenantId'));
    define.boundary.push(seedReadProjection('tenantCourseNumbering', 'TenantCourseNumbering',
      { tenantId: seedParam('tenantId') }));
    define.conditions.push({
      leftHandSide: tenantExists,
      predicate: 'isTrue',
      rejection: 'Tenant is not registered',
    });
    define.publishes[0].parameters.tenantId = seedParam('tenantId');
    define.publishes[0].parameters.courseNumber = seedOf('tenantCourseNumbering');
  });
}

// A command that acts on a *list* of instances at once.
//
// `OrderProducts` submits a cart: each line names a product and the
// price the customer was shown. Two things have to hold for every line
// – the product exists, and the price shown is still the price – and
// they hold or fail together, in one append.
//
// The list is what makes this different from every other example here:
//
//   - `Item` is a composite value type. Because one of its fields is a
//     `ProductId`, a property typed `Item[]` carries one Product tag
//     per element, and `ProductsOrdered` ends up tagged with every
//     product in the cart.
//   - the product reads take `each items.productId`, a list, so each
//     is made once per line.
//   - the price condition reads `items.price` alongside the fanned
//     price read. Both are rooted at `items`, so they are read at the
//     same index: each product is checked against the price submitted
//     *for that product*, not against any price in the cart.
//
// The order is read singularly beside it, so the same command reads one
// instance and many, and the derived DCB shows both shapes at once.
function seedProductPricing(modelId) {
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const product = (projection) => seedRead(projection,
    { productId: { each: { parameterName: 'items', property: 'productId' } } });

  // 1. Value types. Money is scalar; Item is composite, and its
  //    productId field is what turns a list of them into tags.
  addDefinition('custom-type-definition', modelId, 'Money', {
    schema: { type: 'number', minimum: 0 },
  });
  addDefinition('custom-type-definition', modelId, 'ProductId', seedTagType());
  addDefinition('custom-type-definition', modelId, 'OrderId', seedTagType());

  addDefinition('custom-type-definition', modelId, 'Item', {
    properties: [
      { name: 'productId', propertyType: 'ProductId' },
      { name: 'price', propertyType: 'Money' },
    ],
  });

  // 2. Events.
  const event = (name, properties) =>
    addDefinition('event-definition', modelId, name, { properties, tags: seedTags(modelId, properties) });

  event('ProductDefined', [prop('productId', 'ProductId'), prop('price', 'Money')]);
  event('ProductPriceChanged', [prop('productId', 'ProductId'), prop('newPrice', 'Money')]);
  // One event, many tags: Order:<orderId> plus one Product per item.
  event('ProductsOrdered', [prop('orderId', 'OrderId'), seedListProp('items', 'Item')]);

  // 3. The projections. Neither product projection handles
  //    ProductsOrdered: a value-style handler would need to pick *this*
  //    product's line out of the event, which the model cannot yet
  //    express.
  addDefinition('projection-definition', modelId, 'ProductExists',
    seedThingProjection('Product', 'boolean', false,
      [handler('ProductDefined', 'set', true)]));
  // Starts at null – no value yet. A price of 0 on a product that does
  // not exist would be a lie the model then has to defend, and null is
  // a different answer from both 0 and "".
  addDefinition('projection-definition', modelId, 'ProductCurrentPrice',
    seedThingProjection('Product', 'Money', null, [
      handler('ProductDefined', 'set', { eventProperty: 'price' }),
      handler('ProductPriceChanged', 'set', { eventProperty: 'newPrice' }),
    ]));
  addDefinition('projection-definition', modelId, 'OrderExists',
    seedThingProjection('Order', 'boolean', false,
      [handler('ProductsOrdered', 'set', true)]));

  // 4. Commands defining and repricing a single product, so the
  //    example can be exercised before anything is ordered.
  const one = (projection) => seedRead(projection, { productId: param('productId') });
  seedCommand(modelId, 'DefineProduct', {
    properties: [prop('productId', 'ProductId'), prop('price', 'Money')],
    boundary: [],
    conditions: [{
      leftHandSide: one('ProductExists'),
      predicate: 'isFalse',
      rejection: 'Product already exists',
    }],
    publishes: [{
      name: 'ProductDefined',
      parameters: { productId: param('productId'), price: param('price') },
    }],
  });
  seedCommand(modelId, 'ChangeProductPrice', {
    properties: [prop('productId', 'ProductId'), prop('newPrice', 'Money')],
    boundary: [],
    conditions: [
      {
        leftHandSide: one('ProductExists'),
        predicate: 'isTrue',
        rejection: 'Product does not exist',
      },
      // Repricing to the price already in force is a no-op, and saying
      // so does more than tidy the log: reading the current price pulls
      // ProductPriceChanged into this command's query, where the state
      // check alone would have covered only ProductDefined. Without it
      // two concurrent repricings both see an untouched product and
      // both succeed.
      {
        leftHandSide: one('ProductCurrentPrice'),
        predicate: 'equals',
        rightHandSide: param('newPrice'),
        negate: true,
        rejection: 'Price is unchanged',
      },
    ],
    publishes: [{
      name: 'ProductPriceChanged',
      parameters: { productId: param('productId'), newPrice: param('newPrice') },
    }],
  });

  // 5. The command the example exists for.
  seedCommand(modelId, 'OrderProducts', {
    properties: [prop('orderId', 'OrderId'), seedListProp('items', 'Item')],
    boundary: [],
    conditions: [
      // Singular: the order must not already have been placed.
      {
        leftHandSide: seedRead('OrderExists', { orderId: param('orderId') }),
        predicate: 'isFalse',
        rejection: 'Order was already placed',
      },
      // Universal over the fanned read: every product must exist.
      {
        leftHandSide: product('ProductExists'),
        predicate: 'isTrue',
        rejection: 'Product does not exist',
      },
      // Zipped: price[i] against items[i].price.
      {
        leftHandSide: product('ProductCurrentPrice'),
        predicate: 'equals',
        rightHandSide: { parameterName: 'items', property: 'price' },
        rejection: 'Price has changed',
      },
    ],
    publishes: [{
      name: 'ProductsOrdered',
      parameters: { orderId: param('orderId'), items: param('items') },
    }],
  });
}

// ============================================================
// Content based decisions – one domain, three spellings.
//
// A document's Published/PendingChanges distinction depends on whether
// its current text equals the last published one: a decision made from
// *content*, not from a recorded status. The declared handler
// vocabulary cannot compare two values, so this family exists to
// compare the ways out: the comparison moved into command conditions
// over two plain text projections (`seedDocumentAuthoring`), the client
// echoing the text it saw for the command to verify
// (`seedVerifiedPublish`), and the comparison declared once as a
// derived projection (`seedDerivedPending`). The baseline they were
// measured against, a scripted projection, and a fourth spelling
// through guarded emissions left with those constructs in 11.0.
// docs/research/2026-09-19-content-based-decision-alternatives.md
// holds the primary sources; the comparison note beside it holds the
// verdict.
// ============================================================

// A document's projection read in place, by the document a command
// names in `parameter`.
const seedDocument = (projection, parameter = 'docId') =>
  seedRead(projection, { documentId: seedParam(parameter) });

// The comparison moved to decision time. Two plain `set` projections
// hold the texts – `DocumentPublished` carries the text it publishes,
// read off the boundary, so the log is self-contained – and the
// publish guard compares them: `not(currentText == publishedText)`.
// The stored status shrinks to a four-state lifecycle in which
// Published means *has been published*; pending-ness is never stored,
// only visible where the two read texts differ. Initial values do
// real work here: `currentText` becomes "" on add while
// `publishedText` stays null, which is exactly what makes a fresh
// Draft publishable without ever comparing against null explicitly.
function seedDocumentAuthoring(modelId) {
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const lifecycle = (parameter) => seedDocument('DocumentLifecycle', parameter);

  addDefinition('custom-type-definition', modelId, 'DocumentLifecycle', seedEnumType('DocumentLifecycle',
    ['NonExistent', 'Draft', 'Published', 'Archived']));
  addDefinition('custom-type-definition', modelId, 'DocumentId', seedTagType());

  const event = (name, properties) =>
    addDefinition('event-definition', modelId, name, { properties, tags: seedTags(modelId, properties) });

  event('DocumentAdded', [prop('id', 'DocumentId')]);
  event('TextUpdated', [prop('docId', 'DocumentId'), prop('text', 'string')]);
  // The published text is a fact of the publication, so the event carries it and a plain
  // handler can read it back.
  event('DocumentPublished', [prop('docId', 'DocumentId'), prop('text', 'string')]);
  event('DocumentArchived', [prop('docId', 'DocumentId')]);

  const projection = (name, body) =>
    addDefinition('projection-definition', modelId, name, body);

  projection('DocumentLifecycle', seedThingProjection('Document', 'DocumentLifecycle',
    { enumMember: 'NonExistent' }, [
      handler('DocumentAdded', 'set', { enumMember: 'Draft' }),
      handler('DocumentPublished', 'set', { enumMember: 'Published' }),
      handler('DocumentArchived', 'set', { enumMember: 'Archived' }),
    ]));
  projection('DocumentCurrentText', seedThingProjection('Document', 'string', null, [
    handler('DocumentAdded', 'set', ''),
    handler('TextUpdated', 'set', { eventProperty: 'text' }),
  ]));
  projection('DocumentPublishedText', seedThingProjection('Document', 'string', null, [
    handler('DocumentPublished', 'set', { eventProperty: 'text' }),
  ]));

  const command = (name, body) => seedCommand(modelId, name, body);

  command('AddDocument', {
    properties: [prop('id', 'DocumentId')],
    boundary: [],
    conditions: [
      { leftHandSide: lifecycle('id'), predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' },
        rejection: 'Document already exists' },
    ],
    publishes: [{ name: 'DocumentAdded', parameters: { id: param('id') } }],
  });

  command('UpdateText', {
    properties: [prop('docId', 'DocumentId'), prop('text', 'string')],
    boundary: [],
    conditions: [
      { leftHandSide: lifecycle(), predicate: 'equalsAny',
        rightHandSide: [{ enumMember: 'Draft' }, { enumMember: 'Published' }],
        rejection: 'Document is not editable' },
      // Recording an unchanged text is a no-op, and saying so pulls
      // TextUpdated into this command's query – the same move
      // ChangeProductPrice documents in the pricing example.
      { leftHandSide: seedDocument('DocumentCurrentText'), predicate: 'equals',
        rightHandSide: param('text'), negate: true,
        rejection: 'Text is unchanged' },
    ],
    publishes: [{
      name: 'TextUpdated',
      parameters: { docId: param('docId'), text: param('text') },
    }],
  });

  command('PublishDocument', {
    properties: [prop('docId', 'DocumentId')],
    boundary: [],
    conditions: [
      { leftHandSide: lifecycle(), predicate: 'equalsAny',
        rightHandSide: [{ enumMember: 'Draft' }, { enumMember: 'Published' }],
        rejection: 'Document cannot be published' },
      // The content-based decision, in the boundary: publishing is
      // refused exactly while nothing differs – a fresh Draft ("" vs
      // null) differs, a republish does not, and re-typing the
      // published text makes the two equal again, so the revert needs
      // no event and no stored status to hold.
      { leftHandSide: seedDocument('DocumentCurrentText'), predicate: 'equals',
        rightHandSide: seedDocument('DocumentPublishedText'), negate: true,
        rejection: 'No changes to publish' },
    ],
    publishes: [{
      name: 'DocumentPublished',
      parameters: { docId: param('docId'), text: seedDocument('DocumentCurrentText') },
    }],
  });

  command('ArchiveDocument', {
    properties: [prop('docId', 'DocumentId')],
    boundary: [],
    conditions: [
      { leftHandSide: lifecycle(), predicate: 'equalsAny',
        rightHandSide: [{ enumMember: 'Draft' }, { enumMember: 'Published' }],
        rejection: 'Document cannot be archived' },
    ],
    publishes: [{ name: 'DocumentArchived', parameters: { docId: param('docId') } }],
  });
}

// Layer: the client sends proof. `PublishDocument` gains the text as a
// parameter and verifies it against the boundary – the same pattern
// `OrderProducts` applies to prices, and the one the DCB canon's
// dynamic-product-price example blesses verbatim (`displayedPrice`).
// The published event carries the parameter, now proven identical to
// the current text; the pending-changes comparison stays, restated
// against the proven value.
function seedVerifiedPublish(modelId) {
  updateDefinition('command-definition', modelId, 'PublishDocument', liftCommandSteps({
    properties: [seedProp('docId', 'DocumentId'), seedProp('text', 'string')],
    boundary: [],
    conditions: [
      { leftHandSide: seedDocument('DocumentLifecycle'), predicate: 'equalsAny',
        rightHandSide: [{ enumMember: 'Draft' }, { enumMember: 'Published' }],
        rejection: 'Document cannot be published' },
      // The proof: what the caller believes it is publishing must be
      // the current text – a stale echo is rejected, which is the
      // optimistic check made a domain rule.
      { leftHandSide: seedDocument('DocumentCurrentText'), predicate: 'equals',
        rightHandSide: seedParam('text'),
        rejection: 'Text is not the current one' },
      { leftHandSide: seedParam('text'), predicate: 'equals',
        rightHandSide: seedDocument('DocumentPublishedText'), negate: true,
        rejection: 'No changes to publish' },
    ],
    publishes: [{
      name: 'DocumentPublished',
      parameters: { docId: seedParam('docId'), text: seedParam('text') },
    }],
  }));
}

// Layer: the comparison declared once. `DocumentHasPendingChanges` is
// a *derived* projection – no handlers, one predicate over the two
// text projections – read by the publish guard, so the logic lives in
// exactly one declaration and a real application's read side could
// interpret the same data. Its query is its operands' union, so reading
// it guards the append exactly as reading both texts would.
function seedDerivedPending(modelId) {
  // Tagged by the document like the two it compares, and passing that
  // tag on to each of them by name.
  const own = { documentId: { parameterName: 'documentId' } };
  addDefinition('projection-definition', modelId, 'DocumentHasPendingChanges', {
    tags: [seedThingTag('Document')],
    valueType: 'boolean',
    isList: false,
    derived: {
      leftHandSide: { projection: 'DocumentCurrentText', tags: own },
      predicate: 'equals',
      rightHandSide: { projection: 'DocumentPublishedText', tags: own },
      negate: true,
    },
  });

  seedPatchCommand(modelId, 'PublishDocument', (publish) => {
    publish.conditions = [
      publish.conditions[0],
      { leftHandSide: seedDocument('DocumentHasPendingChanges'), predicate: 'isTrue',
        rejection: 'No changes to publish' },
    ];
  });
}

// Weekly developer hours: a developer registers with the hours they
// have per week, and every allocation is subtracted from that week's
// budget. What is left is *computed*, not folded – a derived
// projection subtracting the hours allocated that week from the weekly
// budget – and whether it covers a request is derived too, with the
// hours asked for as an argument (10.0): `AllocateHours` reads one
// boolean, and its boundary is still both queries: the developer's
// registration and that week's allocations.
function seedDeveloperHours(modelId) {
  const prop = seedProp;
  const handler = seedHandler;
  const param = seedParam;
  const read = (projection, tags, args) => ({ projection, tags, ...(args ? { arguments: args } : {}) });

  addDefinition('custom-type-definition', modelId, 'ProjectId', { schema: { type: 'string' }, isTag: true });
  addDefinition('custom-type-definition', modelId, 'ProjectStatus', seedEnumType('ProjectStatus', ['Active', 'Archived']));
  addDefinition('custom-type-definition', modelId, 'DeveloperId', { schema: { type: 'string' }, isTag: true });
  addDefinition('custom-type-definition', modelId, 'WeekNumber', { schema: { type: 'integer' }, isTag: true });

  const event = (name, properties) =>
    addDefinition('event-definition', modelId, name, { properties, tags: seedTags(modelId, properties) });
  event('ProjectAdded', [prop('projectId', 'ProjectId'), prop('requiredSeniorityLevel', 'integer')]);
  event('ProjectArchived', [prop('projectId', 'ProjectId')]);
  event('DeveloperRegistered', [
    prop('developerId', 'DeveloperId'), prop('seniorityLevel', 'integer'), prop('availableHoursPerWeek', 'integer'),
  ]);
  event('HoursAllocated', [
    prop('projectId', 'ProjectId'), prop('developerId', 'DeveloperId'), prop('week', 'WeekNumber'),
    prop('requestedHours', 'integer'),
  ]);

  const project = [{ name: 'projectId', tagType: 'ProjectId' }];
  const developer = [{ name: 'developerId', tagType: 'DeveloperId' }];
  const developerWeek = [...developer, { name: 'week', tagType: 'WeekNumber' }];
  const projection = (name, tags, valueType, initialValue, handlers) =>
    addDefinition('projection-definition', modelId, name, { tags, valueType, isList: false, initialValue, handlers });
  projection('ProjectStatus', project, 'ProjectStatus', null, [
    handler('ProjectAdded', 'set', { enumMember: 'Active' }),
    handler('ProjectArchived', 'set', { enumMember: 'Archived' }),
  ]);
  projection('ProjectRequiredSeniorityLevel', project, 'integer', null, [
    handler('ProjectAdded', 'set', { eventProperty: 'requiredSeniorityLevel' }),
  ]);
  projection('DeveloperExists', developer, 'boolean', false, [handler('DeveloperRegistered', 'set', true)]);
  projection('DeveloperSeniorityLevel', developer, 'integer', null, [
    handler('DeveloperRegistered', 'set', { eventProperty: 'seniorityLevel' }),
  ]);
  // Starts at 0, not null: a computation over null is null, and the
  // remaining hours of a developer nobody registered are better zero
  // than an ordering that errors.
  projection('DeveloperAvailableHoursPerWeek', developer, 'integer', 0, [
    handler('DeveloperRegistered', 'set', { eventProperty: 'availableHoursPerWeek' }),
  ]);
  projection('DeveloperAllocatedHoursForWeek', developerWeek, 'integer', 0, [
    handler('HoursAllocated', 'increment', { eventProperty: 'requestedHours' }),
  ]);
  const own = { developerId: param('developerId') };
  addDefinition('projection-definition', modelId, 'DeveloperRemainingHoursForWeek', {
    tags: developerWeek,
    valueType: 'integer',
    isList: false,
    derived: {
      leftHandSide: read('DeveloperAvailableHoursPerWeek', own),
      operator: 'subtract',
      rightHandSide: read('DeveloperAllocatedHoursForWeek', { ...own, week: param('week') }),
    },
  });
  addDefinition('projection-definition', modelId, 'DeveloperHasHoursForWeek', {
    tags: developerWeek,
    arguments: [{ name: 'hours', propertyType: 'integer' }],
    valueType: 'boolean',
    isList: false,
    derived: {
      leftHandSide: read('DeveloperRemainingHoursForWeek', { ...own, week: param('week') }),
      predicate: 'greaterThanOrEquals',
      rightHandSide: param('hours'),
    },
  });

  seedCommand(modelId, 'AddProject', {
    feature: 'Projects',
    properties: [prop('projectId', 'ProjectId'), prop('requiredSeniorityLevel', 'integer')],
    boundary: [],
    conditions: [{
      leftHandSide: read('ProjectStatus', { projectId: param('projectId') }),
      predicate: 'equals', rightHandSide: null,
      rejection: 'Project already exists',
    }],
    publishes: [{
      name: 'ProjectAdded',
      parameters: { projectId: param('projectId'), requiredSeniorityLevel: param('requiredSeniorityLevel') },
    }],
  });
  seedCommand(modelId, 'ArchiveProject', {
    feature: 'Projects',
    properties: [prop('projectId', 'ProjectId')],
    boundary: [],
    conditions: [{
      leftHandSide: read('ProjectStatus', { projectId: param('projectId') }),
      predicate: 'equals', rightHandSide: { enumMember: 'Active' },
      rejection: 'Project is not active',
    }],
    publishes: [{ name: 'ProjectArchived', parameters: { projectId: param('projectId') } }],
  });
  seedCommand(modelId, 'RegisterDeveloper', {
    feature: 'Developers',
    properties: [
      prop('developerId', 'DeveloperId'), prop('seniorityLevel', 'integer'), prop('availableHoursPerWeek', 'integer'),
    ],
    boundary: [],
    conditions: [{
      leftHandSide: read('DeveloperExists', { developerId: param('developerId') }),
      predicate: 'isFalse',
      rejection: 'Developer is already registered',
    }],
    publishes: [{
      name: 'DeveloperRegistered',
      parameters: {
        developerId: param('developerId'), seniorityLevel: param('seniorityLevel'),
        availableHoursPerWeek: param('availableHoursPerWeek'),
      },
    }],
  });
  seedCommand(modelId, 'AllocateHours', {
    feature: 'Projects',
    properties: [
      prop('projectId', 'ProjectId'), prop('developerId', 'DeveloperId'), prop('week', 'WeekNumber'),
      prop('requestedHours', 'integer'),
    ],
    boundary: [],
    conditions: [
      {
        leftHandSide: read('ProjectStatus', { projectId: param('projectId') }),
        predicate: 'equals', rightHandSide: { enumMember: 'Active' },
        rejection: 'Project is not active',
      },
      {
        leftHandSide: read('DeveloperExists', { developerId: param('developerId') }),
        predicate: 'isTrue',
        rejection: 'Developer is not registered',
      },
      {
        leftHandSide: read('DeveloperSeniorityLevel', { developerId: param('developerId') }),
        predicate: 'greaterThanOrEquals',
        rightHandSide: read('ProjectRequiredSeniorityLevel', { projectId: param('projectId') }),
        rejection: 'Developer seniority level too low',
      },
      {
        leftHandSide: read('DeveloperHasHoursForWeek', { developerId: param('developerId'), week: param('week') },
          { hours: param('requestedHours') }),
        predicate: 'isTrue',
        rejection: 'Developer does not have enough hours left that week',
      },
    ],
    publishes: [{
      name: 'HoursAllocated',
      parameters: {
        projectId: param('projectId'), developerId: param('developerId'), week: param('week'),
        requestedHours: param('requestedHours'),
      },
    }],
  });

  const added = { event: 'ProjectAdded', data: { projectId: 'p1', requiredSeniorityLevel: 2 } };
  const registered = { event: 'DeveloperRegistered', data: { developerId: 'd1', seniorityLevel: 3, availableHoursPerWeek: 40 } };
  const allocated = (week, requestedHours) =>
    ({ projectId: 'p1', developerId: 'd1', week, requestedHours });
  const scenario = (id, body) => addDefinition('scenario-definition', modelId, id, { command: 'AllocateHours', ...body });
  scenario('3b0f6c52-8d1e-4a7f-9c24-6e5d1a8b7f03', {
    name: 'allocates hours the developer has left that week',
    given: [added, registered, { event: 'HoursAllocated', data: allocated(12, 30) }],
    when: { arguments: allocated(12, 10) },
    then: { outcome: 'published', events: [{ type: 'HoursAllocated', data: allocated(12, 10) }] },
  });
  scenario('9e41d7a3-2c6b-4f58-b0e1-7a3c5d9f2e64', {
    name: 'refuses more hours than are left that week',
    given: [added, registered, { event: 'HoursAllocated', data: allocated(12, 30) }],
    when: { arguments: allocated(12, 11) },
    then: { outcome: 'rejected', events: [], rejection: 'Developer does not have enough hours left that week' },
  });
  scenario('c7a2e9f1-5b3d-4e86-a1f4-0d8b6c2e9a75', {
    name: 'another week starts from the whole weekly budget',
    given: [added, registered, { event: 'HoursAllocated', data: allocated(12, 40) }],
    when: { arguments: allocated(13, 40) },
    then: { outcome: 'published', events: [{ type: 'HoursAllocated', data: allocated(13, 40) }] },
  });
  scenario('5d8c1b46-e7f2-4a93-8c05-b2f6e4a1d387', {
    name: 'refuses a developer nobody registered',
    given: [added],
    when: { arguments: allocated(12, 10) },
    then: { outcome: 'rejected', events: [], rejection: 'Developer is not registered' },
  });
  seedProjectionScenario(modelId, '1f6e3a9d-4b72-4c08-9e5a-d3c7b8f2a160', {
    name: 'is the weekly budget less what that week has allocated',
    projection: 'DeveloperRemainingHoursForWeek',
    given: [registered, { event: 'HoursAllocated', data: allocated(12, 30) }],
    tags: {
      developerId: { tagType: 'DeveloperId', tagValue: 'd1' },
      week: { tagType: 'WeekNumber', tagValue: 12 },
    },
    then: 10,
  });
  seedProjectionScenario(modelId, '8a4d2f71-c6e9-4b30-a5d8-2e7f1c9b4a06', {
    name: 'covers a request no larger than what is left',
    projection: 'DeveloperHasHoursForWeek',
    given: [registered, { event: 'HoursAllocated', data: allocated(12, 30) }],
    tags: {
      developerId: { tagType: 'DeveloperId', tagValue: 'd1' },
      week: { tagType: 'WeekNumber', tagValue: 12 },
    },
    arguments: { hours: 11 },
    then: false,
  });
}

// `experimental` marks the entries that use what the experimental flag
// keeps off the pages (none does, since 11.0); the model list shows
// those only with the flag on. A test holds the mark to the built model's own
// `experimentalFeatures`.
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
      + 'parameter and its conditions – reading the numbering guards it instead.',
    build: (modelId) => { seedBase(modelId); seedAddSequence(modelId); seedSequenceScenarios(modelId); },
  },
  {
    name: 'Course Example (with sequence and tenant)',
    slug: 'course-tenant',
    description: 'The numbering restarts per tenant – the case a tagless sequence could not '
      + 'express. Identity stays globally minted; what restarts is the number, so no two '
      + 'tenants ever write the same Course tag.',
    build: (modelId) => { seedBase(modelId); seedAddSequence(modelId); seedAddTenancy(modelId); },
  },
  {
    name: 'Dynamic Product Price (simple)',
    slug: 'pricing-simple',
    description: 'A cart ordered in one append. Each line names a product and the price shown '
      + 'to the customer; the boundary fans out over the lines and checks each price against '
      + 'the product it belongs to.',
    build: (modelId) => { seedProductPricing(modelId); },
  },
  {
    name: 'Content based decisions (boundary comparison)',
    slug: 'content-decisions-boundary',
    description: 'The comparison moved into the boundary: two plain text projections, '
      + 'DocumentPublished carrying the text it publishes, and a publish guard comparing them. '
      + 'Pending-ness is never stored, only visible where the texts differ.',
    build: (modelId) => { seedDocumentAuthoring(modelId); },
  },
  {
    name: 'Content based decisions (client-verified)',
    slug: 'content-decisions-verified',
    description: 'Publishing takes the text the caller saw and verifies it against the current '
      + 'one – the optimistic check OrderProducts applies to prices, made a domain rule. A stale '
      + 'echo is rejected; the published event carries the proven text.',
    build: (modelId) => { seedDocumentAuthoring(modelId); seedVerifiedPublish(modelId); },
  },
  {
    name: 'Content based decisions (derived projection)',
    slug: 'content-decisions-derived',
    description: 'The comparison declared once: hasPendingChanges is a derived projection – no '
      + 'handlers, one predicate over the two text projections – read by the publish guard, so '
      + 'a frontend could interpret the same declaration.',
    build: (modelId) => { seedDocumentAuthoring(modelId); seedDerivedPending(modelId); },
  },
  {
    name: 'Developer hours (derived computation)',
    slug: 'developer-hours',
    description: 'Developers register the hours they have per week, and allocations to '
      + 'projects are subtracted from that week\'s budget. The hours left are a derived '
      + 'projection – the weekly budget less that week\'s allocations – so allocating reads '
      + 'one value, and its boundary is still both queries.',
    build: (modelId) => { seedDeveloperHours(modelId); },
  },
];

function loadPredefinedModel(index) {
  const entry = PREDEFINED_MODELS[index];
  if (!entry) throw new DomainError('No such predefined model.');
  const modelId = createDcbModel(entry.name);
  entry.build(modelId);
  return modelId;
}
