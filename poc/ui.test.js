// ============================================================
// DCB Playground — interface tests.
//
// `evaluate.test.js` exercises what a model *means*; this exercises the
// small pure layer the interface is built out of — the draft a
// projection is edited as, the body that draft becomes, the words a
// card reads. Everything here is a function of its arguments, which is
// why it can be tested at all: the rendering around it is not, and is
// deliberately not reached.
//
// The page's script is loaded into the same `vm` context as the model,
// behind a DOM stub thin enough to be obviously inert. Nothing in it
// runs at load: the app boots on `DOMContentLoaded`, and the stub never
// fires one.
//
// Run with `node poc/ui.test.js`.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const POC = __dirname;

const store = new Map();
const noop = () => {};
const element = () => ({
  appendChild: noop, removeChild: noop, remove: noop, setAttribute: noop,
  addEventListener: noop, removeAttribute: noop, focus: noop, blur: noop,
  scrollIntoView: noop, contains: () => false, closest: () => null,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {}, dataset: {}, children: [], childNodes: [],
  querySelector: () => null, querySelectorAll: () => [],
  getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
});

const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  document: {
    createElement: element, createTextNode: element, body: element(),
    documentElement: element(),
    // Every lookup answers with an inert element rather than null: the
    // page wires a handful of listeners at load, and a stub that said
    // "not there" would only be testing that.
    getElementById: element,
    querySelector: element,
    querySelectorAll: () => [],
    addEventListener: noop,
  },
  location: { hash: '', pathname: '/', search: '' },
  history: { replaceState: noop },
  navigator: { clipboard: {} },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: noop,
  TextEncoder, TextDecoder, URL, Blob: class {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);

const pageScript = (() => {
  const html = fs.readFileSync(path.join(POC, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  // The page's own code is the long one; the others are the tiny
  // loaders that pull in the files already concatenated below.
  return blocks.sort((a, b) => b.length - a.length)[0];
})();

// `state` and the page's own functions live in the script's lexical
// scope, not as properties of the context object — the same as they
// would on `window` in a browser. The trailer hands out the few this
// drives, the way `generate-examples.js` reaches `PREDEFINED_MODELS`.
const source = ['model.js', 'evaluate.js', 'shared.js']
  .map((file) => fs.readFileSync(path.join(POC, file), 'utf8'))
  .concat(pageScript)
  .concat('globalThis.state = state; globalThis.render = render; globalThis.session = session;')
  .join('\n;\n');
vm.runInContext(source, sandbox, { filename: 'page.js' });

const {
  loadPredefinedModel, projectState, addDefinition, updateDefinition,
  projectionDraftFrom, cleanProjectionBody, blankProjectionDraft, projectionNameFor,
  projectionWords, initialValueWords, defaultInitialValue, operationsFor,
  projectionTypeOptions, handlerValueChoices, boundAs, entityPropertyTarget,
  propertyUsage, effectsOf, typeLabel, literalOfType, blankSlotValue, createDcbModel,
} = sandbox;

function build(index) {
  store.clear();
  const id = loadPredefinedModel(index);
  return { id, model: () => projectState()[id] };
}

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures.push(`${name}\n    ${error.message}`);
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what || 'value'}: expected ${b}, got ${a}`);
}

// ---------------------------------------------------------------
// The draft a projection is edited as, and the body it becomes.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);

  check('a draft round-trips a declared projection unchanged', () => {
    const stored = model()['projection-definitions'].CourseCapacity;
    const draft = projectionDraftFrom(stored);
    eq(cleanProjectionBody(draft), stored, 'through the editor and back');
  });

  check('a draft round-trips an enum-valued projection unchanged', () => {
    const stored = model()['projection-definitions'].CourseStatus;
    eq(cleanProjectionBody(projectionDraftFrom(stored)), stored, 'enum members survive');
  });

  check('a draft round-trips a list projection unchanged', () => {
    const stored = model()['projection-definitions'].CourseSubscribedStudentIds;
    eq(cleanProjectionBody(projectionDraftFrom(stored)), stored, 'a list survives');
  });

  check('a round-tripped draft is still accepted by the model', () => {
    const stored = model()['projection-definitions'].CourseSubscriptionCount;
    updateDefinition('projection-definition', id, 'CourseSubscriptionCount',
      cleanProjectionBody(projectionDraftFrom(stored)));
    eq(model()['projection-definitions'].CourseSubscriptionCount, stored, 'unchanged after a save');
  });

  check('the sanitiser drops whatever the editor kept for itself', () => {
    const draft = projectionDraftFrom(model()['projection-definitions'].CourseCapacity);
    draft.advancedBy = [{ event: '', property: '' }];   // the stray key that used to ship
    draft.handlers[0].valueText = '42';
    const body = cleanProjectionBody(draft);
    eq('advancedBy' in body, false, 'no stray key reaches the model');
    eq(Object.keys(body.handlers[0]).sort(), ['event', 'operation', 'value'], 'a handler is three fields');
  });

  check('a literal typed into a handler becomes that literal', () => {
    const draft = projectionDraftFrom(model()['projection-definitions'].CourseSubscriptionCount);
    // What `operandPicker` writes when someone picks "a value…" and
    // types into the box beside it.
    draft.handlers[0].value = ' literal';
    draft.handlers[0].valueText = '5';
    eq(cleanProjectionBody(draft).handlers[0].value, 5, 'a number, not the string "5"');
  });

  check('a half-written handler is dropped rather than stored', () => {
    const draft = projectionDraftFrom(model()['projection-definitions'].CourseCapacity);
    draft.handlers.push({ event: '', operation: 'set', value: '' });
    eq(cleanProjectionBody(draft).handlers.length, 2, 'the two that name an event');
  });
}

// ---------------------------------------------------------------
// A new projection's draft, and the name a new property gives one.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);

  check('a blank draft is valid the moment it is created', () => {
    const draft = blankProjectionDraft(model());
    addDefinition('projection-definition', id, 'Untouched', cleanProjectionBody(draft));
    eq(model()['projection-definitions'].Untouched.handlers, [], 'nothing moves it yet');
  });

  check("a blank entity property's draft is partitioned by that entity", () => {
    const draft = blankProjectionDraft(model(), 'Course');
    eq(draft.parameters, [{ name: 'courseId', propertyType: 'CourseId' }], 'the instance it is kept for');
  });

  check('a blank draft starts where its type starts, explicitly', () => {
    const draft = blankProjectionDraft(model(), 'Course');
    draft.valueType = 'integer';
    eq(defaultInitialValue(model(), draft), 0, 'an integer');
    draft.valueType = 'boolean';
    eq(defaultInitialValue(model(), draft), false, 'a boolean');
    draft.isList = true;
    eq(defaultInitialValue(model(), draft), [], 'a list');
  });

  check('a new property names its projection after the two of them', () => {
    eq(projectionNameFor(model(), 'Course', 'seatCount'), 'CourseSeatCount', 'entity and property');
    // `CourseCapacity` is taken by the property already called capacity.
    eq(projectionNameFor(model(), 'Course', 'capacity'), 'CourseCapacity2', 'uniquified, never silently shared');
  });
}

// ---------------------------------------------------------------
// What a card says.
// ---------------------------------------------------------------
{
  const { model } = build(4);

  check('nothing yet is never rendered as an empty value', () => {
    eq(initialValueWords(null), 'nothing yet', 'null');
    eq(initialValueWords(''), '""', 'the empty string, visibly a value');
    eq(initialValueWords([]), 'an empty list', 'an empty list');
    eq(initialValueWords(['a', 'b']), '"a", "b"', 'a list with things in it');
    eq(initialValueWords({ enumMember: 'Existent' }), 'Existent', 'an enum member');
  });

  check('a projection that starts at nothing says so', () => {
    const words = projectionWords(model(), model()['projection-definitions'].ProductCurrentPrice);
    eq(/starting at nothing yet/.test(words), true, `got: ${words}`);
  });

  check('a type reads the same whether it is a member or a projection', () => {
    eq(typeLabel({ propertyType: 'Money', isList: false }), 'Money', 'an event field');
    eq(typeLabel({ valueType: 'Money', isList: false }), 'Money', 'a projection');
    eq(typeLabel({ valueType: 'StudentId', isList: true }), 'StudentId[]', 'a list of them');
  });
}

// ---------------------------------------------------------------
// What the editor offers.
// ---------------------------------------------------------------
{
  const { model } = build(3);

  check('an integer projection is offered increment and decrement', () => {
    eq(operationsFor(model(), { valueType: 'integer', isList: false }),
      ['set', 'increment', 'decrement'], 'the arithmetic ones');
  });

  check('a list projection is offered append and remove', () => {
    eq(operationsFor(model(), { valueType: 'StudentId', isList: true }),
      ['set', 'append', 'remove'], 'the list ones');
  });

  check('boolean is a type a projection may hold', () => {
    const offered = projectionTypeOptions(model()).map(([t]) => t);
    eq(offered.includes('boolean'), true, 'boolean is on the list');
    eq(offered.includes('Item'), false, 'a composite is not');
  });

  check('a list-typed event property is offerable to a list projection', () => {
    const draft = { valueType: 'TimeSlot', isList: true };
    const choices = handlerValueChoices(model(), draft, model()['event-definitions'].CourseRescheduled)
      .map(([, label]) => label);
    eq(choices.includes('all of its slots'), true, `got: ${choices.join(' | ')}`);
  });

  check('a literal is read as the type it is typed into', () => {
    eq(literalOfType(model(), 'integer', '7'), 7, 'an integer');
    eq(literalOfType(model(), 'integer', 'seven'), undefined, 'refused, not coerced');
    eq(literalOfType(model(), 'boolean', 'yes'), true, 'a boolean');
    eq(literalOfType(model(), 'string', ''), '', 'the empty string is a string');
  });

  check('a fresh slot holds a value of its own type', () => {
    eq(blankSlotValue(model(), 'integer'), 0, 'an integer');
    eq(blankSlotValue(model(), 'boolean'), false, 'a boolean');
    eq(blankSlotValue(model(), 'CourseStatus'), { enumMember: 'NonExistent' }, 'the first member');
  });
}

// ---------------------------------------------------------------
// Properties and projections, seen from either side.
// ---------------------------------------------------------------
{
  const { model } = build(0);

  check('a property resolves to the projection it binds', () => {
    const { binding, projection } = entityPropertyTarget(model(), 'Course', 'capacity');
    eq(binding.projection, 'CourseCapacity', 'the binding');
    eq(projection.valueType, 'integer', 'and what it holds');
  });

  check('a projection knows which properties bind it', () => {
    eq(boundAs(model(), 'CourseCapacity'), [{ entity: 'Course', property: 'capacity' }], 'one binding');
    eq(boundAs(model(), 'CourseStatus'), [{ entity: 'Course', property: 'status' }], 'and another');
  });

  check('a property still reports who moves it and who reads it', () => {
    const usage = propertyUsage(model(), 'Course', 'subscriptionCount');
    eq(usage.property.valueType, 'integer', 'the shape comes from the projection');
    eq(usage.property.name, 'subscriptionCount', 'the name comes from the binding');
    eq(usage.changedBy.map((u) => u.event).sort(),
      ['StudentSubscribedToCourse', 'StudentUnsubscribedFromCourse'], 'what moves it');
    eq(usage.readBy.includes('SubscribeStudentToCourse'), true, 'and what reads it');
  });

  check('an event still knows every property it changes', () => {
    const effects = effectsOf(model(), 'StudentSubscribedToCourse');
    eq(effects.map((e) => `${e.entity}.${e.property.name}`).sort(),
      ['Course.subscribedStudentIds', 'Course.subscriptionCount', 'Student.subscriptionCount'],
      'across both entities');
    eq(effects.map((e) => e.projectionName).sort(),
      ['CourseSubscribedStudentIds', 'CourseSubscriptionCount', 'StudentSubscriptionCount'],
      'and names the projection behind each');
  });
}

// `build` clears the store, so a model built mid-block would pull the
// ground out from under the one the block is already holding.
{
  const { model } = build(1);

  check('a global projection is bound by nothing, which is not a lesser state', () => {
    eq(boundAs(model(), 'CourseNumbering'), [], 'no entity claims a name for it');
  });
}

// ---------------------------------------------------------------
// The shipped examples, against the schema they claim.
//
// Not a JSON Schema validator — there is none here, and a playground
// that needed one to run its own tests would be the first thing in this
// project to need a dependency. What it does check is the part that
// actually drifts: every `additionalProperties: false` object, against
// the keys the schema declares. A stray key rode out of the editor into
// every export once (`advancedBy`), and this is the check that would
// have caught it in the file rather than in someone's importer.
// ---------------------------------------------------------------
{
  const schema = JSON.parse(fs.readFileSync(path.join(POC, '..', 'dcb-model.schema.json'), 'utf8'));
  const defs = schema.$defs;

  const allowed = (defName) => Object.keys(defs[defName].properties || {});
  const requiredOf = (defName) => defs[defName].required || [];

  const conforms = (value, defName, where, report) => {
    const extra = Object.keys(value).filter((k) => !allowed(defName).includes(k));
    if (extra.length) report(`${where} carries ${extra.join(', ')}, which ${defName} does not declare`);
    for (const key of requiredOf(defName)) {
      if (!(key in value)) report(`${where} is missing ${key}, which ${defName} requires`);
    }
  };

  for (const slug of ['course-simple', 'course-sequence', 'course-tenant', 'course-schedules', 'pricing-simple']) {
    const file = path.join(POC, 'examples', slug + '.json');
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));

    check(`${slug} conforms to the schema's closed objects`, () => {
      const problems = [];
      const report = (message) => problems.push(message);

      const topExtra = Object.keys(envelope).filter((k) => !(k in schema.properties));
      if (topExtra.length) report(`the document carries ${topExtra.join(', ')}`);
      for (const key of schema.required) {
        if (!(key in envelope)) report(`the document is missing ${key}`);
      }
      if (!new RegExp(schema.properties.dcbModelVersion.pattern).test(envelope.dcbModelVersion)) {
        report(`dcbModelVersion "${envelope.dcbModelVersion}" is not the major this schema describes`);
      }
      if (envelope.$schema !== schema.$id) {
        report(`$schema "${envelope.$schema}" is not this schema's $id`);
      }

      for (const entity of envelope.entityDefinitions) {
        conforms(entity, 'EntityDefinition', `entity ${entity.name}`, report);
        for (const binding of entity.properties || []) {
          conforms(binding, 'EntityPropertyBinding', `${entity.name}.${binding.name}`, report);
        }
      }
      for (const projection of envelope.projectionDefinitions) {
        conforms(projection, 'ProjectionDefinition', `projection ${projection.name}`, report);
        for (const parameter of projection.parameters || []) {
          conforms(parameter, 'ProjectionParameter', `${projection.name}(${parameter.name})`, report);
        }
        if (projection.script) {
          conforms(projection.script, 'ProjectionScript', `${projection.name}'s script`, report);
        }
        for (const handler of projection.handlers || []) {
          conforms(handler, 'PropertyHandler', `${projection.name} on ${handler.event}`, report);
        }
      }
      for (const event of envelope.eventDefinitions) {
        conforms(event, 'EventDefinition', `event ${event.name}`, report);
        for (const p of event.properties || []) {
          conforms(p, 'PropertyDefinition', `${event.name}.${p.name}`, report);
        }
      }
      for (const command of envelope.commandDefinitions) {
        conforms(command, 'CommandDefinition', `command ${command.name}`, report);
      }
      for (const type of envelope.customTypeDefinitions) {
        conforms(type, 'CustomTypeDefinition', `type ${type.name}`, report);
      }
      for (const spec of envelope.projectionScenarioDefinitions || []) {
        conforms(spec, 'ProjectionScenarioDefinition', `scenario ${spec.id}`, report);
        for (const read of spec.reads || []) {
          conforms(read, 'ProjectionScenarioRead', `${spec.id} reading ${read.alias}`, report);
        }
      }

      if (problems.length) throw new Error(problems.join('; '));
    });

    check(`${slug} scenarios read projections that exist, with the arguments they take`, () => {
      const projections = new Map(envelope.projectionDefinitions.map((p) => [p.name, p]));
      const problems = [];
      for (const spec of envelope.projectionScenarioDefinitions || []) {
        for (const read of spec.reads || []) {
          const projection = projections.get(read.projection);
          if (!projection) {
            problems.push(`${spec.id} reads the unknown ${read.projection}`);
            continue;
          }
          const slots = projection.script
            ? (projection.script.arguments || []) : (projection.parameters || []);
          const supplied = Object.keys(read.arguments || {}).sort();
          const expected = slots.map((s) => s.name).sort();
          if (JSON.stringify(supplied) !== JSON.stringify(expected)) {
            problems.push(`${spec.id} reads ${read.projection} with [${supplied}], which takes [${expected}]`);
          }
        }
        for (const alias of Object.keys(spec.then || {})) {
          if (!(spec.reads || []).some((r) => r.alias === alias)) {
            problems.push(`${spec.id} checks "${alias}", which it does not read`);
          }
        }
      }
      if (problems.length) throw new Error(problems.join('; '));
    });

    // The scenarios a file ships with, actually run. A stored Then that
    // was right when it was written and is wrong now is exactly what a
    // scenario exists to report — but one shipped wrong from the start
    // reports nothing, it just cries wolf on first open. This is the
    // check that a seed's hand-written Then is the real one.
    check(`${slug} ships no scenario that is already drifted or broken`, () => {
      const held = new Map();
      const local = {
        console,
        localStorage: {
          getItem: (k) => (held.has(k) ? held.get(k) : null),
          setItem: (k, v) => held.set(k, String(v)),
          removeItem: (k) => held.delete(k),
        },
      };
      local.globalThis = local;
      vm.createContext(local);
      vm.runInContext(['model.js', 'evaluate.js']
        .map((f) => fs.readFileSync(path.join(POC, f), 'utf8')).join('\n;\n'), local, { filename: 'p.js' });

      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Two statements, not one: a member expression evaluates its
      // object before its key, so importing *inside* the brackets would
      // index a snapshot taken before the import ran.
      const loadedId = local.importModelFromEnvelope(envelope);
      const loaded = local.projectState()[loadedId];
      const problems = [];
      for (const [key, body] of Object.entries(loaded['scenario-definitions'] || {})) {
        const result = local.runScenario(loaded, body);
        if (result.status !== 'current') problems.push(`command scenario ${key}: ${result.status}`);
      }
      for (const [key, body] of Object.entries(loaded['projection-scenario-definitions'] || {})) {
        const result = local.runProjectionScenario(loaded, body);
        if (result.status !== 'current') {
          problems.push(`projection scenario ${key}: ${result.status} `
            + (result.reason || `expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`));
        }
      }
      if (problems.length) throw new Error(problems.join('; '));
    });

    check(`${slug} binds every property to a projection that exists and fits`, () => {
      const projections = new Map(envelope.projectionDefinitions.map((p) => [p.name, p]));
      const problems = [];
      for (const entity of envelope.entityDefinitions) {
        const idType = entity.identifierType || (entity.name + 'Id');
        for (const binding of entity.properties || []) {
          const projection = projections.get(binding.projection);
          if (!projection) {
            problems.push(`${entity.name}.${binding.name} binds the unknown ${binding.projection}`);
            continue;
          }
          const slots = projection.script ? projection.script.arguments : projection.parameters;
          if (!(slots || []).some((s) => s.propertyType === idType)) {
            problems.push(`${entity.name}.${binding.name} binds ${binding.projection}, which has no ${idType}`);
          }
        }
      }
      if (problems.length) throw new Error(problems.join('; '));
    });
  }
}

// ---------------------------------------------------------------
// The gestures, end to end.
//
// These call what the buttons call. The DOM they paint into is inert,
// so what is being checked is the model afterwards — that adding a
// property really writes both halves, that wiring an event reaches the
// projection, that removing one takes the projection with it. The
// rendering is exercised too, but only as far as "it ran": a stub
// cannot tell you what it looked like, and pretending otherwise would
// be the worst kind of passing test.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  // `run` repaints on success, and a repaint reads whichever model is
  // open — which is stored, not held — so a gesture cannot be driven
  // until one has been opened.
  store.set('dcb-playground:model', id);
  const active = () => sandbox.activeModel();

  check('the page renders every view without throwing', () => {
    // Both modes: Advanced is where the projection editor, the derived
    // boundary and the stored names live, so a simple-mode-only render
    // would leave most of what changed untouched.
    for (const mode of ['simple', 'advanced']) {
      store.set('dcb-playground:mode', mode);
      for (const view of ['slice', 'entity', 'types', 'projections', 'events', 'map']) {
        sandbox.state.view = view;
        sandbox.state.entity = 'Course';
        sandbox.state.slice = 'SubscribeStudentToCourse';
        sandbox.render();
      }
    }
    sandbox.state.view = 'entity';
  });

  check('adding a property writes the projection and the binding together', () => {
    sandbox.addEntityProperty(active(), 'Course', { name: 'seat count', valueType: 'integer', isList: false });
    const after = model();
    eq(after['entity-definitions'].Course.properties.slice(-1),
      [{ name: 'seatCount', projection: 'CourseSeatCount' }], 'the binding');
    const projection = after['projection-definitions'].CourseSeatCount;
    eq(projection.parameters, [{ name: 'courseId', propertyType: 'CourseId' }], 'partitioned by the instance');
    eq(projection.initialValue, 0, 'starting where an integer starts');
    eq(projection.handlers, [], 'nothing moves it yet');
  });

  check('a property added that way folds immediately', () => {
    eq(sandbox.foldEntityProperty(model(), [], 'Course', 'seatCount', 'c1'), 0, 'its initial value');
  });

  check('wiring an event reaches the projection, not the binding', () => {
    sandbox.patch('projection-definition', 'CourseSeatCount', (b) => {
      b.handlers = [{ event: 'CourseDefined', operation: 'set', value: { eventProperty: 'capacity' } }];
    });
    const log = [{ type: 'CourseDefined', data: { courseId: 'c1', capacity: 12 } }];
    eq(sandbox.foldEntityProperty(model(), log, 'Course', 'seatCount', 'c1'), 12, 'folded through the binding');
    eq(sandbox.foldProjection(model(), log, 'CourseSeatCount', { courseId: 'c1' }), 12, 'and read directly');
  });

  check('renaming a property moves what reads it, not the projection', () => {
    sandbox.renameMember('entity-definition', id, 'Course', 'property', 'seatCount', 'seats');
    const course = model()['entity-definitions'].Course;
    eq(course.properties.slice(-1), [{ name: 'seats', projection: 'CourseSeatCount' }], 'the binding renamed');
    eq('CourseSeatCount' in model()['projection-definitions'], true, 'the projection kept its own name');
  });

  check('removing a property takes its projection with it', () => {
    const property = model()['entity-definitions'].Course.properties.slice(-1)[0];
    sandbox.removeEntityProperty(active(), 'Course', property);
    eq(model()['entity-definitions'].Course.properties.some((p) => p.name === 'seats'), false, 'unbound');
    eq('CourseSeatCount' in model()['projection-definitions'], false, 'and gone');
  });

  check('removing a property leaves a projection something else still reads', () => {
    // Bound twice, so unbinding one name is not the end of it.
    sandbox.patch('entity-definition', 'Course', (b) => {
      b.properties.push({ name: 'howFull', projection: 'CourseSubscriptionCount' });
    });
    const property = model()['entity-definitions'].Course.properties.slice(-1)[0];
    sandbox.removeEntityProperty(active(), 'Course', property);
    eq(model()['entity-definitions'].Course.properties.some((p) => p.name === 'howFull'), false, 'unbound');
    eq('CourseSubscriptionCount' in model()['projection-definitions'], true,
      'kept — the property that shares it still reads it');
  });

  check('creating an entity gives it a status that is an ordinary projection', () => {
    sandbox.createEntity(active(), 'venue');
    const after = model();
    eq(after['entity-definitions'].Venue.properties, [{ name: 'status', projection: 'VenueStatus' }], 'bound');
    const projection = after['projection-definitions'].VenueStatus;
    eq(projection.valueType, 'VenueStatus', 'typed with the enum of the same name');
    eq(projection.parameters, [{ name: 'venueId', propertyType: 'VenueId' }], 'kept per venue');
    eq(sandbox.foldEntityProperty(after, [], 'Venue', 'status', 'v1'), 'NonExistent', 'and folds');
  });

  check('the shared editor renders on an entity page and on the projections page', () => {
    store.set('dcb-playground:mode', 'advanced');
    // The same draft, mounted from both sides — which is the whole
    // claim this change makes, so it is the one worth painting twice.
    const property = model()['entity-definitions'].Course.properties[1];
    const open = () => {
      sandbox.state.projDraft = {
        name: property.projection,
        body: projectionDraftFrom(model()['projection-definitions'][property.projection]),
      };
    };
    sandbox.state.view = 'entity';
    sandbox.state.entity = 'Course';
    open();
    sandbox.render();
    sandbox.state.view = 'projections';
    open();
    sandbox.render();
    // And a brand-new one, which is the form with no stored definition
    // behind it.
    sandbox.state.projDraft = null;
    sandbox.state.newProjection = { name: '', body: sandbox.blankProjectionDraft(model()) };
    sandbox.render();
    sandbox.state.newProjection = null;
  });

  check('the editor renders a scripted projection from either side', () => {
    sandbox.addDefinition('projection-definition', id, 'CourseTouches', {
      valueType: 'integer',
      isList: false,
      // Written in the order the schema declares, which is the order
      // the editor writes it back in.
      script: {
        initialState: 0,
        arguments: [{ name: 'courseId', propertyType: 'CourseId' }],
        tagFilter: ['CourseId:{courseId}'],
      },
      handlers: [{ event: 'CourseDefined', code: '(state || 0) + 1' }],
    });
    sandbox.patch('entity-definition', 'Course', (b) => {
      b.properties.push({ name: 'touches', projection: 'CourseTouches' });
    });
    sandbox.state.projDraft = {
      name: 'CourseTouches',
      body: projectionDraftFrom(model()['projection-definitions'].CourseTouches),
    };
    sandbox.state.view = 'entity';
    sandbox.render();
    sandbox.state.view = 'projections';
    sandbox.render();
    // And it survives the round trip the Save button puts it through.
    eq(cleanProjectionBody(sandbox.state.projDraft.body),
      model()['projection-definitions'].CourseTouches, 'unchanged through the editor');
    sandbox.state.projDraft = null;
  });
}

// ---------------------------------------------------------------
// Watching a projection in the sandbox.
//
// The sandbox drives commands against a throwaway log and lets you
// scrub back through it. A watched projection is folded at whatever
// position you are looking at — which is what makes a numbering
// legible: you see the value it would issue at every point, not just
// where some command happened to read it.
// ---------------------------------------------------------------
{
  const { id, model } = build(1);
  store.set('dcb-playground:model', id);
  const active = () => sandbox.activeModel();
  const session = sandbox.session;

  check('driving a command fills the sandbox log', () => {
    sandbox.sessionReset();
    sandbox.sessionRun(active(), 'DefineCourse', { capacity: 5 });
    sandbox.sessionRun(active(), 'DefineCourse', { capacity: 5 });
    eq(session.log.map((e) => e.data.courseId), ['c1', 'c2'], 'two courses, minted');
  });

  check('a watched projection folds at the position being looked at', () => {
    const watch = sandbox.projectionWatch('CourseNumbering', {});
    session.at = null;
    eq(sandbox.foldWatch(active(), watch), { value: 'c3' }, 'at the end, the next to issue');
    session.at = 1;
    eq(sandbox.foldWatch(active(), watch), { value: 'c2' }, 'one event in');
    session.at = 0;
    eq(sandbox.foldWatch(active(), watch), { value: 'c1' }, 'before anything');
    session.at = null;
  });

  check('watching is toggled by one identity, arguments included', () => {
    const global_ = sandbox.projectionWatch('CourseNumbering', {});
    eq(sandbox.isPinned(global_), false, 'not watched to begin with');
    sandbox.togglePinned(global_);
    eq(sandbox.isPinned(global_), true, 'watched');
    // The same projection at a different partition is a different watch.
    eq(sandbox.isPinned(sandbox.projectionWatch('CourseNumbering', { tenantId: 't1' })), false,
      'another partition is another thing to watch');
    sandbox.togglePinned(global_);
    eq(sandbox.isPinned(global_), false, 'unwatched');
  });

  check('an entity instance and a projection are both watchable, side by side', () => {
    sandbox.togglePinned(sandbox.entityWatch('CourseId:c1'));
    sandbox.togglePinned(sandbox.projectionWatch('CourseNumbering', {}));
    eq(session.pinned.map((w) => w.kind), ['entity', 'projection'], 'one of each');
    sandbox.render();
  });

  check('a command reports the arguments it folded a projection at', () => {
    const result = sandbox.evaluateCommand(active(), [], 'DefineCourse', { capacity: 1 });
    eq(result.reads.courseNumbering.arguments, {}, 'the whole log, and it says so');
  });

  check('a projection can be watched before anything has happened', () => {
    sandbox.sessionReset();
    eq(sandbox.foldWatch(active(), sandbox.projectionWatch('CourseNumbering', {})), { value: 'c1' },
      'its initial value, which is the whole of what it states');
    sandbox.state.view = 'sandbox';
    sandbox.render();
    sandbox.sessionRun(active(), 'DefineCourse', { capacity: 5 });
  });

  check('the sandbox renders with things watched', () => {
    store.set('dcb-playground:mode', 'advanced');
    sandbox.togglePinned(sandbox.projectionWatch('CourseNumbering', {}));
    sandbox.state.view = 'sandbox';
    sandbox.render();
    // And with the watch picker open, which is the path a projection
    // nothing read is added through.
    sandbox.state.watchDraft = { projection: 'CourseNumbering', arguments: {} };
    sandbox.render();
    sandbox.state.watchDraft = null;
    sandbox.sessionReset();
  });
}

// ---------------------------------------------------------------
// Where a projection scenario is listed.
// ---------------------------------------------------------------
{
  const { id, model } = build(1);
  store.set('dcb-playground:model', id);

  const add = (body) => {
    const aliases = (body.reads || []).map((r) => r.alias);
    const key = sandbox.generateId();
    sandbox.addDefinition('projection-scenario-definition', id, key, {
      ...body, then: sandbox.deriveProjectionScenarioThen(model(), body, aliases),
    });
    return key;
  };

  check('a scenario about one instance is listed on that entity', () => {
    const key = add({
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 4 } }],
      reads: [{ alias: 'capacity', projection: 'CourseCapacity', arguments: { courseId: 'c1' } }],
    });
    const about = sandbox.scenarioEntityInstance(model(), model()['projection-scenario-definitions'][key]);
    eq(about && about.entity, 'Course', 'recognised as being about a Course');
    eq(sandbox.projectionScenariosOf(model(), 'Course').map((e) => e.key), [key], 'listed there');
    eq(sandbox.projectionScenariosReading(model(), 'CourseCapacity'), [], 'and not listed twice');
  });

  check('a scenario over a global projection is listed on the projection', () => {
    const key = add({
      given: [],
      reads: [{ alias: 'numbering', projection: 'CourseNumbering', arguments: {} }],
    });
    eq(sandbox.scenarioEntityInstance(model(), model()['projection-scenario-definitions'][key]), null,
      'about no one instance');
    // The model ships two of its own over this numbering; this is the
    // third, and what matters is that it joins them rather than landing
    // on the entity.
    eq(sandbox.projectionScenariosReading(model(), 'CourseNumbering').map((e) => e.key).includes(key),
      true, 'listed on the projection');
    eq(sandbox.projectionScenariosOf(model(), 'Course').some((e) => e.key === key), false,
      'and not on the entity');
  });

  check('a scenario mixing an instance and a global projection is listed on the projection', () => {
    const key = add({
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 4 } }],
      reads: [
        { alias: 'capacity', projection: 'CourseCapacity', arguments: { courseId: 'c1' } },
        { alias: 'numbering', projection: 'CourseNumbering', arguments: {} },
      ],
    });
    eq(sandbox.scenarioEntityInstance(model(), model()['projection-scenario-definitions'][key]), null,
      'it is not about one instance, because it is not only about one');
    eq(sandbox.projectionScenariosReading(model(), 'CourseNumbering').map((e) => e.key).includes(key),
      true, 'so the projection lists it');
  });

  check('a fresh entity scenario reads every property of that entity', () => {
    const reads = sandbox.blankScenarioReads(model(), { entity: 'Course' });
    eq(reads.map((r) => r.alias), ['status', 'capacity', 'subscriptionCount', 'subscribedStudentIds'],
      'one read per property, under its own name');
    eq(reads.every((r) => 'courseId' in r.arguments), true, 'each asking for the instance');
  });

  check('a fresh projection scenario reads just that projection', () => {
    const reads = sandbox.blankScenarioReads(model(), { projection: 'CourseNumbering' });
    eq(reads, [{ alias: 'courseNumbering', projection: 'CourseNumbering', arguments: {} }], 'one read');
  });

  check('both scenario homes render', () => {
    store.set('dcb-playground:mode', 'advanced');
    sandbox.state.view = 'entity';
    sandbox.state.entity = 'Course';
    sandbox.state.entityTab = 'projection-scenarios';
    sandbox.render();
    sandbox.state.view = 'projections';
    sandbox.render();
    // And the editor, from each side.
    sandbox.startProjectionScenario(model(), { projection: 'CourseNumbering' });
    sandbox.render();
    sandbox.startProjectionScenario(model(), { entity: 'Course' });
    sandbox.render();
    sandbox.state.projectionScenarioDraft = null;
    sandbox.state.entityTab = 'definition';
  });
}

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
