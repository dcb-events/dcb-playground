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
// Run with `node app/ui.test.js`.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSandbox, loadApp, makeChecker, textOf, findAll } = require('./test-harness.js');

const APP = __dirname;

const { sandbox, store } = createSandbox();

// `state` and the page's own functions live in the script's lexical
// scope, not as properties of the context object — the same as they
// would on `window` in a browser. The trailer hands out the few this
// drives, the way `generate-examples.js` reaches `PREDEFINED_MODELS`.
loadApp(sandbox, ['model.js', 'evaluate.js', 'shared.js'], {
  withPage: true,
  trailer: 'globalThis.state = state; globalThis.render = render; globalThis.session = session;'
    + ' globalThis.closeForms = closeForms;',
});
const { check, eq, finish } = makeChecker();

const {
  loadPredefinedModel, projectState, addDefinition, updateDefinition,
  projectionDraftFrom, cleanProjectionBody, blankProjectionDraft, projectionNameFor,
  initialValueWords, defaultInitialValue, operationsFor,
  projectionTypeOptions, handlerValueChoices, boundAs, entityPropertyTarget,
  propertyUsage, projectionReaders, effectsOf, typeLabel, literalOfType, blankSlotValue,
  createDcbModel, partitionCells, projectionScenariosFor,
} = sandbox;

function build(index) {
  // Clearing the store is a write `appendEvents` never sees, so the
  // projection cache is told the world moved underneath it.
  store.clear();
  sandbox.bumpLogRevision();
  const id = loadPredefinedModel(index);
  return { id, model: () => projectState()[id] };
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

  check('a row says what a projection is kept per, as the tag it is', () => {
    const cells = partitionCells(model(), model()['projection-definitions'].ProductCurrentPrice);
    eq(cells.length, 1, 'one parameter, one tag');
    eq(textOf(cells[0]).includes('product id'), true, `got: ${textOf(cells[0])}`);
    eq(cells[0].className, 'chip tag', 'drawn as a tag');
  });

  check('a projection kept once says so as an absence, not as a tag', () => {
    const cells = partitionCells(model(), { valueType: 'string', parameters: [], handlers: [] });
    eq(cells.length, 1, 'one cell');
    eq(cells[0].className, 'chip unset', 'dashed and unfilled, like every other nothing here');
    eq(textOf(cells[0]), 'kept once', 'and says what it is');
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
  const schema = JSON.parse(fs.readFileSync(path.join(APP, '..', 'dcb-model.schema.json'), 'utf8'));
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
    const file = path.join(APP, 'examples', slug + '.json');
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
      }

      if (problems.length) throw new Error(problems.join('; '));
    });

    check(`${slug} scenarios name a projection that exists, with the arguments it takes`, () => {
      const projections = new Map(envelope.projectionDefinitions.map((p) => [p.name, p]));
      const problems = [];
      for (const spec of envelope.projectionScenarioDefinitions || []) {
        const projection = projections.get(spec.projection);
        if (!projection) {
          problems.push(`${spec.id} is about the unknown ${spec.projection}`);
          continue;
        }
        const slots = projection.script
          ? (projection.script.arguments || []) : (projection.parameters || []);
        const supplied = Object.keys(spec.arguments || {}).sort();
        const expected = slots.map((s) => s.name).sort();
        if (JSON.stringify(supplied) !== JSON.stringify(expected)) {
          problems.push(`${spec.id} reads ${spec.projection} with [${supplied}], which takes [${expected}]`);
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
        .map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n;\n'), local, { filename: 'p.js' });

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
    // The same editor mounted from both sides — the whole claim this
    // change makes. Which projection each side shows is now decided by
    // the binding: an entity's page holds the ones it calls something,
    // Projections holds the rest.
    const open = (name) => {
      sandbox.state.projDraft = {
        name, body: projectionDraftFrom(model()['projection-definitions'][name]),
      };
      sandbox.state.projTab = 'definition';
    };
    const painted = (view, name) => {
      const main = sandbox.document.createElement('div');
      sandbox.state.view = view;
      sandbox.state.entity = 'Course';
      open(name);
      if (view === 'entity') sandbox.renderEntity(model(), main);
      else sandbox.renderProjections(model(), main);
      return textOf(main);
    };
    // This model binds every projection it has, so the page for the
    // unbound ones needs one to show.
    sandbox.addDefinition('projection-definition', id, 'CourseNumbering', {
      parameters: [], valueType: 'CourseId', isList: false, initialValue: 'c1',
      handlers: [{
        event: 'CourseDefined', operation: 'set',
        value: { successor: { eventProperty: 'courseId' } },
      }],
    });
    const property = model()['entity-definitions'].Course.properties[1];
    eq(painted('entity', property.projection).includes('it holds'), true,
      'the editor, on the entity that binds it');
    eq(painted('projections', 'CourseNumbering').includes('it holds'), true,
      'and the same editor, on the page for the ones nothing binds');
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
    sandbox.state.entity = 'Course';
    sandbox.render();
    // And it survives the round trip a save puts it through.
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
    const key = sandbox.generateId();
    sandbox.addDefinition('projection-scenario-definition', id, key, {
      ...body, then: sandbox.deriveProjectionScenarioThen(model(), body),
    });
    return key;
  };

  check('a scenario is listed under the one projection it is about', () => {
    const given = [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 4 } }];
    const key = add({ projection: 'CourseCapacity', arguments: { courseId: 'c1' }, given });
    eq(projectionScenariosFor(model(), 'CourseCapacity').map((e) => e.key).includes(key), true,
      'under the projection it names');
    eq(projectionScenariosFor(model(), 'CourseStatus').map((e) => e.key).includes(key), false,
      'and under no other, however much they share a Given');
  });

  check('several projections over one Given are several scenarios', () => {
    const given = [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 4 } }];
    const capacity = add({ projection: 'CourseCapacity', arguments: { courseId: 'c1' }, given });
    const status = add({ projection: 'CourseStatus', arguments: { courseId: 'c1' }, given });
    const stored = (k) => model()['projection-scenario-definitions'][k];
    eq(stored(capacity).then, 4, 'each holds its own projection\'s value');
    eq(stored(status).then, 'Existent', 'and nothing else\'s');
    // Which is what makes them answerable apart: one can drift alone.
    eq(sandbox.runProjectionScenario(model(), stored(capacity)).status, 'current', 'both current');
    eq(sandbox.runProjectionScenario(model(), stored(status)).status, 'current', 'to start with');
  });

  check('a scenario over a standalone projection lands on Projections', () => {
    const key = add({ projection: 'CourseNumbering', arguments: {}, given: [] });
    eq(projectionScenariosFor(model(), 'CourseNumbering').map((e) => e.key).includes(key), true,
      'listed on the projection');
    sandbox.goToProjectionScenario(model(), key);
    eq(sandbox.state.view, 'projections', 'which nothing binds, so it opens there');
    eq(sandbox.state.projTab, 'checks', 'with the row open on its checks');
    eq(sandbox.state.projDraft.name, 'CourseNumbering', 'and that row is the projection it reads');
  });

  check('a scenario over a bound projection opens on its entity', () => {
    const key = add({
      projection: 'CourseCapacity', arguments: { courseId: 'c1' },
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 4 } }],
    });
    sandbox.goToProjectionScenario(model(), key);
    eq(sandbox.state.view, 'entity', 'a bound projection is edited on its entity');
    eq(sandbox.state.entity, 'Course', 'the one that binds it');
    eq(sandbox.state.projTab, 'checks', 'with the row open on its checks');
    sandbox.render();
  });

  check('a fresh scenario asks only for the partition it is about', () => {
    eq(sandbox.blankScenarioArguments(model(), 'CourseCapacity'), { courseId: '' },
      'one blank per parameter');
    eq(sandbox.blankScenarioArguments(model(), 'CourseNumbering'), {},
      'and none at all for one that reads the whole log');
  });

  check('copying a scenario leaves the row it was copied in open', () => {
    // `+ copy` is drawn inside an open ledger row. It used to go through
    // closeForms(), which folded that row away under the cursor — so the
    // button vanished mid-click and the focus on it went with it.
    const key = add({ projection: 'CourseNumbering', arguments: {}, given: [] });
    sandbox.goToProjectionScenario(model(), key);
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseNumbering', 'the row is open');
    const before = Object.keys(model()['projection-scenario-definitions']).length;

    sandbox.copyProjectionScenario(model(), key);

    eq(Object.keys(model()['projection-scenario-definitions']).length, before + 1, 'the copy is stored');
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseNumbering',
      'and the row it was copied in is still open');
    eq(sandbox.state.projTab, 'checks', 'still on its checks');
    const draft = sandbox.state.projectionScenarioDraft;
    eq(!!draft && draft.key !== key, true, 'with the copy, not the original, open to tweak');
    sandbox.render();
    sandbox.state.projectionScenarioDraft = null;
    sandbox.state.projDraft = null;
  });

  check('an argument field holds the value, not the object holding it', () => {
    // `valueEditor` reads and writes exactly where it is pointed. Aimed
    // at ['arguments'] instead of ['arguments', name] it read the whole
    // object — rendering "[object Object]" into the field, and writing
    // a scalar over every argument at once on the way back out.
    sandbox.startProjectionScenario(model(), { projection: 'CourseCapacity' });
    sandbox.state.projectionScenarioDraft.body.arguments.courseId = 'c1';
    const main = sandbox.document.createElement('div');
    sandbox.state.view = 'entity';
    sandbox.state.entity = 'Course';
    sandbox.renderEntity(model(), main);

    const fields = findAll(main, (n) => n.tag === 'input' && n.className === 'vin');
    eq(fields.length, 1, 'one field, for the one parameter it is partitioned by');
    eq(fields[0].value, 'c1', 'showing the identifier it was given');

    // And writing back lands on that argument alone.
    sandbox.setAtPath(sandbox.state.projectionScenarioDraft.body, ['arguments', 'courseId'], 'c2');
    eq(sandbox.state.projectionScenarioDraft.body.arguments, { courseId: 'c2' },
      'the arguments object survives the write');
    sandbox.state.projectionScenarioDraft = null;
    sandbox.state.projDraft = null;
  });

  check('a watched projection asks for its arguments the same way', () => {
    sandbox.state.watchDraft = { projection: 'CourseCapacity', arguments: { courseId: 'c1' } };
    const card = sandbox.watchProjectionAdder(model(), ['CourseCapacity', 'CourseNumbering']);
    const fields = findAll(card, (n) => n.tag === 'input' && n.className === 'vin');
    eq(fields.length, 1, 'one field');
    eq(fields[0].value, 'c1', 'holding the identifier, not the object around it');
    sandbox.state.watchDraft = null;
  });

  check('both pages render the checks tab', () => {
    store.set('dcb-playground:mode', 'advanced');
    sandbox.startProjectionScenario(model(), { projection: 'CourseNumbering' });
    eq(sandbox.state.view, 'projections', 'started where the projection lives');
    sandbox.render();
    sandbox.startProjectionScenario(model(), { projection: 'CourseCapacity' });
    eq(sandbox.state.entity, 'Course', 'and this one on the entity that binds it');
    sandbox.render();
    sandbox.state.projectionScenarioDraft = null;
    sandbox.state.projDraft = null;
    sandbox.state.projTab = 'definition';
  });
}

// ---------------------------------------------------------------
// The ledger: one component, two pages.
// ---------------------------------------------------------------
{
  const { id, model } = build(1);
  store.set('dcb-playground:model', id);
  const page = () => {
    const main = sandbox.document.createElement('div');
    return main;
  };

  check('Projections lists only what no entity binds', () => {
    const main = page();
    sandbox.state.projDraft = null;
    sandbox.renderProjections(model(), main);
    const text = textOf(main);
    eq(text.includes('Course numbering'), true, 'the one nothing binds is listed');
    eq(text.includes('Course capacity'), false,
      'and the ones an entity calls something are not — they are edited on its page');
  });

  check('what the entity pages own is still findable, as an index', () => {
    const main = page();
    sandbox.renderProjections(model(), main);
    const text = textOf(main);
    eq(text.includes('Also defined, on their entities'), true, 'the index is there');
    eq(text.includes('subscribed student ids'), true,
      'under the name its entity calls it, not the projection name');
  });

  check('the two pages differ by exactly one column', () => {
    const free = sandbox.projectionLedger(model(), {
      owner: null, nameHead: 'projection', entries: [], add: null,
    });
    const owned = sandbox.projectionLedger(model(), {
      owner: 'Course', nameHead: 'property', entries: [], add: null,
    });
    eq(textOf(free.children[0]), 'projectionone perholdsstarts at', 'Projections says what each is kept per');
    eq(textOf(owned.children[0]), 'propertyholdsstarts at',
      'an entity does not, because Identity above it already has');
  });

  check('a row says the four things that differ, and nothing else', () => {
    sandbox.state.projDraft = null;
    const ledger = sandbox.projectionLedger(model(), {
      owner: 'Course', nameHead: 'property', add: null,
      entries: [{ projection: 'CourseCapacity', label: 'capacity',
                  binding: { name: 'capacity', projection: 'CourseCapacity' } }],
    });
    const text = textOf(ledger);
    eq(text.includes('capacity'), true, 'the property');
    eq(text.includes('Integer'), true, 'what it holds');
    eq(text.includes('0'), true, 'and where it starts');
    eq(/moved by|read by|Course defined/.test(text), false,
      'who moves it and who reads it wait until the row is opened');
  });

  check('opening a row opens its editor against the same definition', () => {
    sandbox.state.projDraft = null;
    sandbox.toggleProjectionRow(model(), 'CourseCapacity');
    eq(sandbox.state.projDraft.name, 'CourseCapacity', 'the row being edited is the row that is open');
    eq(sandbox.state.projDraft.body.valueType, 'integer', 'holding the projection body');
    eq(sandbox.state.projTab, 'definition', 'on its definition');
    sandbox.toggleProjectionRow(model(), 'CourseCapacity');
    eq(sandbox.state.projDraft, null, 'and clicking it again folds it shut');
  });

  check('an opened row renders both of its tabs', () => {
    store.set('dcb-playground:mode', 'advanced');
    const open = (name) => {
      const body = model()['projection-definitions'][name];
      sandbox.state.projDraft = { name, body: projectionDraftFrom(body) };
    };
    for (const tab of ['definition', 'checks']) {
      const main = page();
      sandbox.state.view = 'entity';
      sandbox.state.entity = 'Course';
      open('CourseCapacity');
      sandbox.state.projTab = tab;
      sandbox.renderEntity(model(), main);
      const text = textOf(main);
      eq(text.includes('Definition') && text.includes('Checks'), true,
        `the ${tab} tab still offers the other`);
      eq(text.includes('it holds'), tab === 'definition',
        'and only one of them is showing at a time');
    }
    // The same row, on the page for the ones nothing binds.
    const main = page();
    open('CourseNumbering');
    sandbox.state.projTab = 'checks';
    sandbox.renderProjections(model(), main);
    eq(textOf(main).includes('issues c1 before anything has happened'), true,
      'the checks tab lists what checks it');
    sandbox.state.projDraft = null;
    sandbox.state.projTab = 'definition';
    store.set('dcb-playground:mode', 'simple');
  });

  check('both names a bound projection has can be changed from its row', () => {
    store.set('dcb-playground:mode', 'advanced');
    sandbox.state.view = 'entity';
    sandbox.state.entity = 'Course';
    sandbox.toggleProjectionRow(model(), 'CourseCapacity');
    // Starting a rename closes every other form — the row it is drawn
    // inside must survive that, or the form has nowhere to appear.
    sandbox.startRenameInRow(() => { sandbox.state.renamingProjection = 'CourseCapacity'; });
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseCapacity',
      'the row stays open while what it is about is being renamed');
    const main = sandbox.document.createElement('div');
    sandbox.renderEntity(model(), main);
    eq(textOf(main).includes('Rename — every reference is rewritten with it'), true, 'and the form is in it');
    sandbox.state.renamingProjection = null;

    sandbox.startRenameInRow(() => sandbox.openMember('entity:Course', 'capacity'));
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseCapacity',
      'the same for the other of its two names');
    const other = sandbox.document.createElement('div');
    sandbox.renderEntity(model(), other);
    eq(textOf(other).includes('what this entity calls'), true, 'which is the binding');
    sandbox.state.editMember = null;
    sandbox.state.projDraft = null;
    store.set('dcb-playground:mode', 'simple');
  });

  check('a projection knows who reads it, bound or not', () => {
    eq(projectionReaders(model(), 'CourseNumbering'), ['DefineCourse'],
      'read directly by name, because nothing binds it');
    eq(projectionReaders(model(), 'CourseCapacity'), ['SubscribeStudentToCourse'],
      'and this one through the alias of the entity that does');
  });
}

// ---------------------------------------------------------------
// A named field commits when the row is left. The button stays, but it
// is a convenience now, not the gate — `closeForms` rides every
// gesture that moves on, and a name is what makes a field real.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);

  const type = (adder, text) => {
    const input = findAll(adder, (n) => n.tag === 'input')[0];
    input.oninput({ target: { value: text } });
    return input;
  };

  check('a named field survives leaving the row without the button', () => {
    sandbox.state.slice = 'DefineCourse';
    const before = model()['command-definitions'].DefineCourse.properties.length;
    const adder = sandbox.propertyAdder(model(), {
      draftKey: 'in:DefineCourse',
      onAdd: (property) => sandbox.updateDefinition('command-definition', id, 'DefineCourse', {
        ...model()['command-definitions'].DefineCourse,
        properties: [...model()['command-definitions'].DefineCourse.properties, property],
      }),
    });
    type(adder, 'starting week');
    sandbox.closeForms();
    const properties = model()['command-definitions'].DefineCourse.properties;
    eq(properties.length, before + 1, 'the field was added by leaving, not by a button');
    eq(properties[properties.length - 1].name, 'startingWeek', 'under the name that was typed');
  });

  check('an empty row is abandoned, not committed and not complained about', () => {
    const before = model()['command-definitions'].DefineCourse.properties.length;
    const adder = sandbox.propertyAdder(model(), {
      draftKey: 'in:DefineCourse', onAdd: () => { throw new Error('nothing to add'); },
    });
    type(adder, '   ');
    sandbox.closeForms();
    eq(model()['command-definitions'].DefineCourse.properties.length, before,
      'an unnamed row is "never mind"');
  });

  check('the button commits once, and leaving afterwards does not double it', () => {
    let added = 0;
    const adder = sandbox.propertyAdder(model(), {
      draftKey: 'x', onAdd: () => { added += 1; },
    });
    type(adder, 'seat count');
    const button = findAll(adder, (n) => n.tag === 'button')[0];
    button.onclick();
    sandbox.closeForms();
    eq(added, 1, 'one field, however many ways out were taken');
  });

  check('Escape discards the half-typed name so leaving cannot commit it', () => {
    let added = 0;
    const adder = sandbox.propertyAdder(model(), {
      draftKey: 'x', onAdd: () => { added += 1; },
    });
    const input = type(adder, 'oops');
    input.onkeydown({ key: 'Escape', preventDefault() {}, target: { value: 'oops', blur() {} } });
    sandbox.closeForms();
    eq(added, 0, 'Escape means never mind');
  });

  check('Escape from any control in the row discards, not just from the name field', () => {
    let added = 0;
    const adder = sandbox.propertyAdder(model(), {
      draftKey: 'x', onAdd: () => { added += 1; },
    });
    type(adder, 'oops');
    // The row-level handler — what fires when Escape lands on the type
    // select or a checkbox rather than the name input.
    adder.onkeydown({ key: 'Escape', target: { tagName: 'SELECT' } });
    sandbox.closeForms();
    eq(added, 0, 'backing out through the select commits nothing');
  });

  check('the draft lives in state, so an unrelated repaint keeps the typed text', () => {
    const first = sandbox.propertyAdder(model(), { draftKey: 'x', onAdd: () => {} });
    type(first, 'half a nam');
    const second = sandbox.propertyAdder(model(), { draftKey: 'x', onAdd: () => {} });
    const input = findAll(second, (n) => n.tag === 'input')[0];
    eq(input.value, 'half a nam', 'remounting the row does not eat the name');
    sandbox.state.fieldDraft = null;
  });

  check('an entity property adder follows the same rule', () => {
    const before = (model()['entity-definitions'].Course.properties || []).length;
    const adder = sandbox.entityPropertyAdder(model(), 'Course');
    type(adder, 'starting week');
    sandbox.closeForms();
    const properties = model()['entity-definitions'].Course.properties;
    eq(properties.length, before + 1, 'the property landed on leaving');
    eq(properties[properties.length - 1].name, 'startingWeek', 'named as typed');
    eq(!!model()['projection-definitions'].CourseStartingWeek, true,
      'and brought its projection with it, same as the button always did');
  });

  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// A brand-new command reveals its steps as they are answered. The
// wizard is session state: nothing of it is written to the model, and
// every step it holds back is one click from being shown.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);

  const slice = () => sandbox.sliceOf(model(), 'CertifyCourse');

  check('creating a command starts its wizard at the first step', () => {
    sandbox.state.slice = null;
    sandbox.createCommand(model(), 'certify course');
    eq(!!model()['command-definitions'].CertifyCourse, true, 'the command exists');
    eq(sandbox.state.wizard, { slice: 'CertifyCourse', upto: 0 }, 'and its page starts at step one');
    eq((model()['command-definitions'].CertifyCourse.publishes || []).map((p) => p.name),
      ['CourseCertified'], 'the success event exists from the start — the model requires one');
    eq(model()['event-definitions'].CourseCertified.properties, [],
      'but it is bare: its fields wait for the step that shows it');
  });

  check('the event takes the command properties when its step is revealed', () => {
    // Give it a payload and a read first, the way the wizard would.
    sandbox.updateDefinition('command-definition', id, 'CertifyCourse', {
      ...model()['command-definitions'].CertifyCourse,
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
      boundary: [{ alias: 'course', entity: 'Course', id: { parameterName: 'courseId' } }],
    });
    sandbox.advanceWizard(model(), slice());   // reads revealed
    sandbox.advanceWizard(model(), slice());   // rules revealed
    eq(model()['event-definitions'].CourseCertified.properties, [],
      'nothing is copied while the event is still unrevealed');
    sandbox.advanceWizard(model(), slice());   // emits revealed — the default fires
    const event = model()['event-definitions'].CourseCertified;
    eq(event.properties.map((p) => p.name), ['courseId'],
      'the event now records what the command was given');
    const emission = model()['command-definitions'].CertifyCourse.publishes[0];
    eq(emission.parameters, { courseId: { parameterName: 'courseId' } },
      'wired through unchanged, not merely declared');
    eq(sandbox.state.openEvent, 'CourseCertified', 'and its fields are on screen');
  });

  check('revealing the changes step ends the wizard with a proposal, not a write', () => {
    const handlersBefore = model()['projection-definitions'].CourseStatus.handlers.length;
    sandbox.advanceWizard(model(), slice());   // changes revealed — wizard over
    eq(sandbox.state.wizard, null, 'everything is on screen, so the page is just the page');
    eq(sandbox.state.adder, 'chg:CourseCertified', 'the change adder is open');
    eq(sandbox.state.changeDraft.target, JSON.stringify(['Course', 'status']),
      'proposing the read entity\'s status');
    eq(sandbox.state.changeDraft.value, JSON.stringify({ enumMember: 'Existent' }),
      'set to the first member that is not where it starts');
    eq(model()['projection-definitions'].CourseStatus.handlers.length, handlersBefore,
      'and nothing was written — a proposal waits to be submitted');
    sandbox.state.adder = null;
    sandbox.state.changeDraft = null;
  });

  check('Enter on an empty input row is the wizard\'s Continue', () => {
    sandbox.createCommand(model(), 'retire course');
    sandbox.state.adder = 'in';
    const step = sandbox.stepTrigger(model(), sandbox.sliceOf(model(), 'RetireCourse'));
    const row = findAll(step, (n) => /\badder\b/.test(n.className || '') && n.onkeydown)[0];
    row.onkeydown({ key: 'Enter', preventDefault() {}, target: { tagName: 'INPUT' } });
    eq(sandbox.state.wizard, { slice: 'RetireCourse', upto: 1 },
      '"done with these" reveals the next step instead of jumping into a hidden one');
    sandbox.state.wizard = null;
    sandbox.closeForms();
  });

  check('an opened existing command shows every step at once', () => {
    // The gate is the wizard's slice matching; any other command — or
    // this one, once the wizard ended — renders whole.
    eq(sandbox.state.wizard, null, 'no wizard is running');
  });

  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// Inline creation continues the gesture it interrupted: the thing just
// made is the thing selected, and the command never leaves the screen.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);

  const drive = (form, text, buttonLabel) => {
    const input = findAll(form, (n) => n.tag === 'input')[0];
    input.oninput({ target: { value: text } });
    const button = findAll(form, (n) => n.tag === 'button' && textOf(n) === buttonLabel)[0];
    if (!button) throw new Error(`no "${buttonLabel}" button in the form`);
    button.onclick();
  };

  check('an entity created from the reads step is the next read, already picked', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.view = 'slice';
    sandbox.state.newEntityAt = 'reads';
    const step = sandbox.stepReads(model(), sandbox.sliceOf(model(), 'DefineCourse'));
    drive(step, 'room', 'Add');
    eq(!!model()['entity-definitions'].Room, true, 'the entity exists');
    eq(sandbox.state.adder, 'read', 'the read adder came back');
    eq(sandbox.state.readDraft && sandbox.state.readDraft.entity, 'Room',
      'holding the thing that was just made');
    sandbox.closeForms();
  });

  check('a property created from inside a rule becomes the rule\'s subject', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.addingProp = { at: 'rule' };
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '' };
    const editor = sandbox.ruleEditor(model(), sandbox.sliceOf(model(), 'DefineCourse'), null);
    const form = findAll(editor, (n) => /inline-form/.test(n.className || ''))[0];
    if (!form) throw new Error('the property form is not under the rule row');
    drive(form, 'starting week', 'Add');
    eq(!!model()['projection-definitions'].CourseStartingWeek, true, 'the property exists');
    eq(sandbox.state.ruleDraft.left,
      JSON.stringify({ alias: 'course', property: 'startingWeek' }),
      'and the rule is already about it, through the alias the command reads');
    eq(sandbox.state.addingProp, null, 'the form is gone');
    sandbox.closeForms();
  });

  check('a new event is born recording what the command was given', () => {
    sandbox.state.slice = 'SubscribeStudentToCourse';
    sandbox.state.newEntityAt = 'event';
    const step = sandbox.stepEmits(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    drive(step, 'course waitlisted', 'Add');
    const event = model()['event-definitions'].CourseWaitlisted;
    eq(event.properties.map((p) => p.name), ['courseId', 'studentId'],
      'field for field from the payload');
    const emission = model()['command-definitions'].SubscribeStudentToCourse.publishes
      .find((e) => e.name === 'CourseWaitlisted');
    eq(emission.parameters, {
      courseId: { parameterName: 'courseId' },
      studentId: { parameterName: 'studentId' },
    }, 'each wired through unchanged');
    sandbox.closeForms();
  });

  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// The leave-the-row rule for picker rows: touched and complete
// commits, untouched defaults are a proposal that leaving declines,
// and Escape discards whatever state the row was in.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);
  const LITERAL = ' literal';

  check('a touched, complete change row is recorded by leaving it', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.adder = 'chg:CourseDefined';
    sandbox.state.changeDraft = {
      eventName: 'CourseDefined',
      target: JSON.stringify(['Course', 'subscriptionCount']),
      operation: 'set', value: LITERAL, valueText: '5',
      touched: true,
    };
    sandbox.stepChanges(model(), sandbox.sliceOf(model(), 'DefineCourse'));
    sandbox.closeForms();
    const handler = model()['projection-definitions'].CourseSubscriptionCount.handlers
      .find((x) => x.event === 'CourseDefined');
    eq(handler, { event: 'CourseDefined', operation: 'set', value: 5 },
      'the change landed without its button');
  });

  check('an untouched change row is a proposal, and leaving declines it', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.adder = 'chg:CourseDefined';
    sandbox.state.changeDraft = null;
    // Painting the step plants the default draft — which is exactly
    // the shape the wizard proposes, and must not commit on its own.
    sandbox.stepChanges(model(), sandbox.sliceOf(model(), 'DefineCourse'));
    const before = JSON.stringify(model()['projection-definitions']);
    sandbox.closeForms();
    eq(JSON.stringify(model()['projection-definitions']), before,
      'walking away from untouched defaults writes nothing');
  });

  check('a touched, complete rule is added by leaving it', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.adder = 'rule';
    const count = model()['command-definitions'].DefineCourse.conditions.length;
    sandbox.state.ruleDraft = {
      predicate: 'equals', negate: true,
      left: JSON.stringify({ alias: 'course', property: 'status' }),
      right: JSON.stringify({ enumMember: 'Archived' }),
      touched: true,
    };
    sandbox.ruleEditor(model(), sandbox.sliceOf(model(), 'DefineCourse'), null);
    sandbox.closeForms();
    const conditions = model()['command-definitions'].DefineCourse.conditions;
    eq(conditions.length, count + 1, 'the rule landed without its button');
    eq(conditions[conditions.length - 1], {
      leftHandSide: { alias: 'course', property: 'status' },
      predicate: 'equals',
      rightHandSide: { enumMember: 'Archived' },
      negate: true,
    }, 'exactly as picked');
  });

  check('a touched, complete read is bound by leaving it', () => {
    sandbox.state.slice = 'ChangeCourseCapacity';
    sandbox.state.adder = 'read';
    const before = model()['command-definitions'].ChangeCourseCapacity.boundary.length;
    sandbox.state.readDraft = {
      slice: 'ChangeCourseCapacity', entity: 'Course',
      source: JSON.stringify({ parameterName: 'courseId' }),
      touched: true,
    };
    sandbox.stepReads(model(), sandbox.sliceOf(model(), 'ChangeCourseCapacity'));
    sandbox.closeForms();
    const boundary = model()['command-definitions'].ChangeCourseCapacity.boundary;
    eq(boundary.length, before + 1, 'the read landed without its button');
    eq(boundary[boundary.length - 1].alias, 'course2',
      'aliased apart from the course already bound');
  });

  check('Escape discards a touched row instead of committing it', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.adder = 'chg:CourseDefined';
    sandbox.state.changeDraft = {
      eventName: 'CourseDefined',
      target: JSON.stringify(['Course', 'subscribedStudentIds']),
      operation: 'set', value: LITERAL, valueText: 'oops',
      touched: true,
    };
    sandbox.stepChanges(model(), sandbox.sliceOf(model(), 'DefineCourse'));
    const before = JSON.stringify(model()['projection-definitions']);
    // What the global Escape handler does, in order.
    sandbox.discardPendingEdits();
    sandbox.closeForms();
    eq(JSON.stringify(model()['projection-definitions']), before,
      '"never mind" is never the gesture that writes');
  });

  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// An open projection row saves itself, and stays open. The Checks
// badge reads the stored definition, so storing on change is what
// keeps it honest — and undo, not a Discard button, is the way back.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);

  check('an edited definition is stored without a Save press, row still open', () => {
    sandbox.toggleProjectionRow(model(), 'CourseCapacity');
    sandbox.state.projDraft.body.initialValue = 7;
    sandbox.autoSaveProjectionDraft();
    eq(model()['projection-definitions'].CourseCapacity.initialValue, 7, 'stored');
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseCapacity',
      'and the row did not fold away');
  });

  check('leaving the row flushes whatever the typing pause had not', () => {
    sandbox.state.projDraft.body.initialValue = 9;
    sandbox.closeForms();
    eq(model()['projection-definitions'].CourseCapacity.initialValue, 9,
      'the last edit went with the gesture that left');
    eq(sandbox.state.projDraft, null, 'closing is the separate gesture it always was');
  });

  check('a body the model refuses is not retried on every repaint', () => {
    sandbox.toggleProjectionRow(model(), 'CourseStatus');
    // An enum-valued projection whose initial value names no member.
    sandbox.state.projDraft.body.initialValue = { enumMember: 'NoSuchMember' };
    const before = JSON.stringify(model()['projection-definitions'].CourseStatus);
    sandbox.autoSaveProjectionDraft();
    eq(JSON.stringify(model()['projection-definitions'].CourseStatus), before,
      'the refusal left the stored definition alone');
    sandbox.autoSaveProjectionDraft();   // the repaint's retry — memoed away
    // Repairing the draft earns a fresh attempt.
    sandbox.state.projDraft.body.initialValue = { enumMember: 'Existent' };
    sandbox.autoSaveProjectionDraft();
    eq(model()['projection-definitions'].CourseStatus.initialValue,
      { enumMember: 'Existent' }, 'a changed body is tried again');
    sandbox.state.projDraft = null;
  });

  check('the foot offers no Save or Discard — saving is not a gesture any more', () => {
    sandbox.state.projDraft = null;
    sandbox.toggleProjectionRow(model(), 'CourseCapacity');
    sandbox.state.view = 'entity';
    sandbox.state.entity = 'Course';
    const main = sandbox.document.createElement('div');
    sandbox.renderEntity(model(), main);
    eq(findAll(main, (n) => n.tag === 'button' && textOf(n) === 'Save').length, 0, 'no Save');
    eq(findAll(main, (n) => n.tag === 'button' && textOf(n) === 'Discard changes').length, 0,
      'no Discard');
    eq(textOf(main).includes('Saves as you edit'), true, 'the foot says how it works instead');
    sandbox.state.projDraft = null;
    sandbox.state.view = 'slice';
  });

  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// Advanced mode states every DCB query where the thing that runs it
// lives: on each read card, attributed in the union, and — with the
// watched values in it — on a sandbox watch.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);
  store.set('dcb-playground:mode', 'advanced');

  check('each read card carries a query popover, not a query line', () => {
    sandbox.state.slice = 'SubscribeStudentToCourse';
    const step = sandbox.stepReads(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    const panels = findAll(step, (n) => /\bqpanel\b/.test(n.className || '')).map(textOf);
    eq(panels.length, 2, 'one per read');
    eq(panels[0].includes('CourseId:courseId') && panels[0].includes('CourseDefined'),
      true, 'the course read: its tag and the events its read properties fold');
    eq(panels[1].includes('StudentId:studentId') && panels[1].includes('StudentRegistered'),
      true, 'the student read likewise');
  });

  check('clicking the glyph pins the popover; Escape state clears it', () => {
    sandbox.state.slice = 'SubscribeStudentToCourse';
    const step = sandbox.stepReads(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    const button = findAll(step, (n) => /\bqbtn\b/.test(n.className || ''))[0];
    button.onclick({ stopPropagation() {} });
    eq(sandbox.state.queryPop, 'read:course', 'pinned under its own key');
    const again = sandbox.stepReads(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    eq(findAll(again, (n) => /\bqpop on\b/.test(n.className || '')).length, 1,
      'and the pin survives the repaint');
    sandbox.state.queryPop = null;
  });

  check('the consistency step offers the combined query behind one glyph', () => {
    const step = sandbox.stepConsistency(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    const panel = findAll(step, (n) => /\bqpanel\b/.test(n.className || ''))[0];
    const text = textOf(panel);
    eq(text.includes('course · '), true, 'each line names the read it came from');
    eq(text.includes('student · '), true, 'both of them');
    eq(text.includes('or '), true, 'ORed between items');
    eq(text.includes('trip'), false, 'no trips — this boundary is one query');
    eq(textOf(step).includes('2 items, one query'), true, 'the card itself only summarises');
  });

  check('a watched projection shows the query it actually runs', () => {
    const card = sandbox.projectionWatchCard(model(),
      { kind: 'projection', projection: 'CourseCapacity', arguments: { courseId: 'c1' } });
    const text = textOf(card);
    eq(text.includes('CourseId:c1'), true, 'the concrete tag, not a placeholder');
    eq(text.includes('CourseDefined'), true, 'and the events the fold handles');
  });

  check('in Simple mode none of these lines appear', () => {
    store.set('dcb-playground:mode', 'simple');
    sandbox.state.slice = 'SubscribeStudentToCourse';
    const step = sandbox.stepReads(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    eq(findAll(step, (n) => /\bqpop\b/.test(n.className || '')).length, 0,
      'the reads step stays plain');
    const card = sandbox.projectionWatchCard(model(),
      { kind: 'projection', projection: 'CourseCapacity', arguments: { courseId: 'c1' } });
    eq(textOf(card).includes('CourseId:c1'), false, 'and so does the watch');
    store.set('dcb-playground:mode', 'advanced');
  });

  store.set('dcb-playground:mode', 'simple');
  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// A handler mid-edit — event picked, value not yet — is a row still
// being filled in, not a handler. Autosave stores every intermediate
// state, so the intermediate states have to be well-formed: the one
// between the two picks used to be stored valueless and the command
// page read its effect as "undefined".
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);

  check('a half-picked handler is not stored, and the finished one is', () => {
    // Created the way the user does: as a property of Course, so the
    // command page has a reason to speak about it below.
    sandbox.addEntityProperty(model(), 'Course',
      { name: 'starting week', valueType: 'integer', isList: false });
    sandbox.toggleProjectionRow(model(), 'CourseStartingWeek');
    const draft = sandbox.state.projDraft.body;
    // The editor's order of events: the event is picked first, the
    // value after — and the autosave between the two picks.
    draft.handlers.push({ event: 'CourseDefined', operation: 'set', value: '', valueText: '' });
    sandbox.autoSaveProjectionDraft();
    eq(model()['projection-definitions'].CourseStartingWeek.handlers, [],
      'nothing stored while the row is half-way');
    eq(draft.handlers.length, 1, 'but the row is still on screen being edited');
    draft.handlers[0].value = JSON.stringify({ eventProperty: 'capacity' });
    sandbox.autoSaveProjectionDraft();
    eq(model()['projection-definitions'].CourseStartingWeek.handlers,
      [{ event: 'CourseDefined', operation: 'set', value: { eventProperty: 'capacity' } }],
      'and the whole handler lands the moment it is whole');
    sandbox.state.projDraft = null;
  });

  check('the command page speaks the effect, never "undefined"', () => {
    sandbox.state.slice = 'DefineCourse';
    const step = sandbox.stepChanges(model(), sandbox.sliceOf(model(), 'DefineCourse'));
    const text = textOf(step);
    eq(text.includes('undefined'), false, 'no effect reads as undefined');
    eq(text.includes('Starting week') || text.includes('starting week'), true,
      'the fresh property is among what Course defined changes');
  });

  check('the model itself refuses a valueless handler', () => {
    let refused = '';
    try {
      updateDefinition('projection-definition', id, 'CourseStartingWeek', {
        parameters: [{ name: 'courseId', propertyType: 'CourseId' }],
        valueType: 'integer', isList: false, initialValue: 0,
        handlers: [{ event: 'CourseDefined', operation: 'set' }],
      });
    } catch (error) { refused = error.message; }
    eq(/says what it does but not what value it takes/.test(refused), true,
      'undefined is not a literal, whatever operandSource thinks');
  });

  store.delete('dcb-playground:model');
}

// A chained boundary cannot be one query — a later trip's tags are
// answers from an earlier one — so the combined view is one query per
// trip. Its own block, because `build` starts a fresh store.
{
  const { id, model } = build(3);
  store.set('dcb-playground:model', id);
  store.set('dcb-playground:mode', 'advanced');

  check('a chained boundary shows one combined query per trip', () => {
    sandbox.state.slice = 'RescheduleCourse';
    const step = sandbox.stepConsistency(model(), sandbox.sliceOf(model(), 'RescheduleCourse'));
    const panel = findAll(step, (n) => /\bqpanel\b/.test(n.className || ''))[0];
    const text = textOf(panel);
    eq(text.includes('trip 1') && text.includes('trip 2') && text.includes('trip 3'), true,
      'three trips, because each round\'s tags are answers from the one before');
    eq(textOf(step).includes('in 3 trips'), true, 'and the summary says so');
  });

  store.set('dcb-playground:mode', 'simple');
  store.delete('dcb-playground:model');
}

// ---------------------------------------------------------------
// Undo batching: however many appends one gesture makes — nested
// `run` calls included — the gesture is one undo step.
// ---------------------------------------------------------------
{
  const id = sandbox.createDcbModel('Undo Batch Probe');
  store.set('dcb-playground:model', id);

  check('one gesture with several appends is one undo step', () => {
    const before = sandbox.loadEvents().length;
    sandbox.run(() => {
      sandbox.addDefinition('event-definition', id, 'AHappened', { properties: [] });
      sandbox.run(() => sandbox.addDefinition('event-definition', id, 'BHappened', { properties: [] }));
    });
    eq(sandbox.loadEvents().length, before + 2, 'two appends');
    sandbox.undo();
    eq(sandbox.loadEvents().length, before, 'one undo drops the whole gesture');
    const model = sandbox.projectState()[id];
    eq(Object.keys(model['event-definitions']), [], 'both definitions gone');
  });

  store.delete('dcb-playground:model');
}

finish();
