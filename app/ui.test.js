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
loadApp(sandbox, ['model.js', 'evaluate.js', 'dsl.js', 'shared.js'], {
  withPage: true,
  trailer: 'globalThis.state = state; globalThis.render = render; globalThis.session = session;'
    + ' globalThis.closeForms = closeForms; globalThis.codeView = codeView;',
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
// The operand picker never shows a row its draft does not hold.
// A `<select>` already showing a row fires nothing when it is picked,
// so the mismatch is a row no one can choose — which is how a
// projection handler over an event with no field of its type got
// stuck on "a value…" with no box to type in.
// ---------------------------------------------------------------
{
  const { operandPicker, draftOperand, eventFieldChoice } = sandbox;
  const capacity = eventFieldChoice({ name: 'capacity' });

  check('a lone literal row is just its box, and the draft is a literal', () => {
    const draft = { value: '' };
    const out = operandPicker([], draft, 'value');
    eq(out.map((n) => n.tag), ['input'], 'no one-option select in front of it');
    eq(out[0].attributes.placeholder, 'a value…', 'the box says what it wants');
    out[0].oninput({ target: { value: '5' } });
    eq(draftOperand(draft, 'value'), 5, 'what is typed is the operand');
  });

  check('a lone operand reads as itself, and is the draft', () => {
    const draft = { value: '' };
    const out = operandPicker([capacity], draft, 'value', { allowLiteral: false });
    eq(out.length, 1, 'one node');
    eq(out[0].tag, 'span', 'text, not a control');
    eq(textOf(out[0]), 'event.data.capacity', 'the whole path, as the closed face would');
    eq(draftOperand(draft, 'value'), { eventProperty: 'capacity' }, 'and the draft holds it');
  });

  check('with a choice, the draft holds the row on show', () => {
    const draft = { value: '' };
    const out = operandPicker([capacity], draft, 'value');
    eq(out.map((n) => n.tag), ['select'], 'a picker, the first row showing');
    eq(draft.value, capacity[0], 'and the first row picked');
  });

  check('a "+ New…" door is never taken while a value is on offer', () => {
    const draft = { value: '' };
    const out = operandPicker([], draft, 'value', { onNew: () => {} });
    eq(draft.value, ' literal', 'the literal, not the door');
    eq(out.map((n) => n.tag), ['select', 'input'], 'and its box is there');
  });

  check('a picker with a placeholder is asking, and is left unanswered', () => {
    const draft = { right: '' };
    const out = operandPicker([], draft, 'right', { placeholder: '— what? —' });
    eq(out.map((n) => n.tag), ['select'], 'still a picker');
    eq(draft.right, '', 'nothing answered for the author');
  });
}

// ---------------------------------------------------------------
// The same seam, for a derived projection.
// ---------------------------------------------------------------
{
  const { model } = build(9);

  check('a draft round-trips a derived projection unchanged', () => {
    const stored = model()['projection-definitions'].DocumentHasPendingChanges;
    eq(cleanProjectionBody(projectionDraftFrom(stored)), stored, 'through the editor and back');
  });

  check('a derived body always stores as one boolean, whatever the draft says', () => {
    const draft = projectionDraftFrom(model()['projection-definitions'].DocumentHasPendingChanges);
    draft.valueType = 'string';
    draft.isList = true;
    const body = cleanProjectionBody(draft);
    eq(body.valueType, 'boolean', 'the predicate\'s outcome');
    eq(body.isList, false, 'and one of it');
  });

  check('the ledger says what kind of value it is', () => {
    eq(sandbox.scriptLabel(model()['projection-definitions'].DocumentHasPendingChanges),
      'derived', 'beside the type, like "scripted"');
  });
}

// ---------------------------------------------------------------
// The new editors, exercised as far as "it ran": the guard rows and
// their open rule editor on the guarded variant, the derived detail
// and its open editor on the derived one. A stub cannot say what they
// looked like; it can say every branch painted.
// ---------------------------------------------------------------
{
  check('the guard rows and their editor render without throwing', () => {
    const { id, model } = build(8);
    store.set('dcb-playground:model', id);
    store.set('dcb-playground:mode', 'advanced');
    sandbox.state.view = 'slice';
    sandbox.state.slice = 'UpdateText';
    sandbox.render();

    // A guard being edited, seeded the way the Edit button seeds it.
    const guarded = model()['command-definitions'].UpdateText.publishes[0].when[0];
    sandbox.state.editGuard = { at: 0, index: 0 };
    sandbox.state.ruleDraft = null;
    sandbox.render();
    eq(!!guarded, true, 'and the guard is still there afterwards');

    // A fresh guard row on the second emission.
    sandbox.closeForms();
    sandbox.state.editGuard = { at: 1, index: null };
    sandbox.render();
    sandbox.closeForms();
  });

  check('the derived detail and its editor render without throwing', () => {
    const { id, model } = build(9);
    store.set('dcb-playground:model', id);
    store.set('dcb-playground:mode', 'advanced');
    sandbox.state.view = 'entity';
    sandbox.state.entity = 'Document';
    sandbox.state.projDraft = {
      name: 'DocumentHasPendingChanges',
      body: sandbox.projectionDraftFrom(model()['projection-definitions'].DocumentHasPendingChanges),
    };
    sandbox.render();
    // Half-written too: an operand with no projection picked yet is
    // the state every keystroke passes through.
    sandbox.state.projDraft.body.derived.rightHandSide = '';
    sandbox.render();
    sandbox.closeForms();
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

  check('null, "" and [] each keep their own spelling', () => {
    eq(initialValueWords(null), 'null', 'null');
    eq(initialValueWords(''), '""', 'the empty string, visibly a value');
    eq(initialValueWords([]), '[]', 'an empty list');
    eq(initialValueWords(['a', 'b']), '"a", "b"', 'a list with things in it');
    eq(initialValueWords({ enumMember: 'Existent' }), 'Existent', 'an enum member');
    eq(initialValueWords({ count: 2, odd: false }), '{"count":2,"odd":false}',
      'a record a scripted projection folded to, as the JSON it is');
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
    const choices = handlerValueChoices(model(), draft, model()['event-definitions'].CourseRescheduled, 'set')
      .map(([v]) => v);
    eq(choices.includes(JSON.stringify({ eventProperty: 'slots' })), true, `got: ${choices.join(' | ')}`);
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
// A record is a value only code can advance: held by a declared
// projection it is the advisory that used to be a refusal, held by a
// scripted one it is legal.
// ---------------------------------------------------------------
{
  const { id, model } = build(4);

  check('a scripted projection may hold a record', () => {
    const declared = projectionTypeOptions(model()).map(([t]) => t);
    eq(declared.includes('Item'), false, 'declared, the composite stays off the list');
    const scripted = projectionTypeOptions(model(), { scripted: true }).map(([t]) => t);
    eq(scripted.includes('Item'), true, 'scripted, it joins it');
  });

  check('a declared projection holding a composite is advisory-flagged', () => {
    addDefinition('projection-definition', id, 'ItemSnapshot', {
      valueType: 'Item', isList: false, initialValue: null, parameters: [], handlers: [],
    });
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'ItemSnapshot' && /composite/.test(a.message)
    ), true, 'stored, and reported');
  });

  check('the same composite held by a scripted projection is legal', () => {
    updateDefinition('projection-definition', id, 'ItemSnapshot', {
      valueType: 'Item', isList: false,
      script: { initialState: null, tagFilter: [], arguments: [] },
      handlers: [],
    });
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'ItemSnapshot' && /composite/.test(a.message)
    ), false, 'nothing left to report');
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

  for (const slug of ['course-simple', 'course-sequence', 'course-tenant', 'course-schedules',
    'pricing-simple', 'content-decisions-scripted', 'content-decisions-boundary',
    'content-decisions-verified', 'content-decisions-guarded', 'content-decisions-derived']) {
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
      const loadedId = local.importModelFromEnvelope(envelope).modelId;
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
      for (const view of ['overview', 'slice', 'entity', 'types', 'projections', 'events', 'eventmodel', 'map']) {
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

  check('creating an entity makes it bare — no lifecycle unasked', () => {
    sandbox.createEntity(active(), 'venue');
    const after = model();
    eq(after['entity-definitions'].Venue.properties, [], 'no properties');
    eq(after['entity-definitions'].Venue.lifecycle, undefined, 'nothing designated');
    eq('VenueExists' in after['projection-definitions'], false, 'and no fold made for one');
    eq(sandbox.lifecycleOf(after, 'Venue'), null, 'so no existence wording can resolve');
    eq(sandbox.existenceLifecycleOffer(after, 'Venue'), 'create', 'the one-click lifecycle is on offer');
  });

  check('adding the existence lifecycle gives it a boolean and designates it', () => {
    eq(sandbox.addExistenceLifecycle(active(), 'Venue'), 'exists', 'added');
    const after = model();
    eq(after['entity-definitions'].Venue.properties, [{ name: 'exists', projection: 'VenueExists' }], 'bound');
    eq(after['entity-definitions'].Venue.lifecycle, 'exists', 'and designated');
    const projection = after['projection-definitions'].VenueExists;
    eq(projection.valueType, 'boolean', 'a boolean — no enum, no custom type');
    eq(after['custom-type-definitions'].VenueStatus, undefined, 'nothing named VenueStatus exists');
    eq(projection.parameters, [{ name: 'venueId', propertyType: 'VenueId' }], 'kept per venue');
    eq(sandbox.foldEntityProperty(after, [], 'Venue', 'exists', 'v1'), false, 'and folds');
  });

  check('the designated lifecycle resolves, whatever it is called', () => {
    const lifecycle = sandbox.lifecycleOf(model(), 'Venue');
    eq(lifecycle.property, 'exists', 'the designation names the property');
    eq(lifecycle.isBoolean, true, 'spelled as a boolean');
    eq(lifecycle.states, ['false', 'true'], 'two states, as strings like an enum\'s');
    // The whole point of the designation: the name is free.
    sandbox.renameMember('entity-definition', active().id, 'Venue', 'property', 'exists', 'isThere');
    const moved = sandbox.lifecycleOf(model(), 'Venue');
    eq(moved.property, 'isThere', 'renaming the property moves the designation with it');
    eq(model()['entity-definitions'].Venue.lifecycle, 'isThere', 'stored, not guessed');
    sandbox.renameMember('entity-definition', active().id, 'Venue', 'property', 'isThere', 'exists');
  });

  check('an entity designating a property it does not have is an advisory, not a refusal', () => {
    const id = active().id;
    sandbox.updateDefinition('entity-definition', id, 'Venue', {
      properties: [{ name: 'exists', projection: 'VenueExists' }],
      lifecycle: 'phase',
    });
    eq(model()['entity-definitions'].Venue.lifecycle, 'phase', 'it stored');
    const said = sandbox.modelAdvisories(model())
      .filter((a) => a.kind === 'entity-definition' && a.name === 'Venue');
    eq(said.length, 1, 'and is reported once');
    eq(/designates "phase"/.test(said[0].message), true, 'naming what is missing');
    eq(sandbox.lifecycleOf(model(), 'Venue'), null, 'no lifecycle resolves');
    eq(sandbox.lifecycleRefusal(model(), 'Venue'), 'dangling', 'and the page can say why');
    sandbox.updateDefinition('entity-definition', id, 'Venue', {
      properties: [{ name: 'exists', projection: 'VenueExists' }],
      lifecycle: 'exists',
    });
  });

  check('removing a lifecycle drops the designation and keeps the property', () => {
    sandbox.removeLifecycle(active(), 'Venue');
    const after = model();
    eq(after['entity-definitions'].Venue.lifecycle, undefined, 'undesignated');
    eq(after['entity-definitions'].Venue.properties, [{ name: 'exists', projection: 'VenueExists' }],
      'the property stays — a rule may still read it');
    eq('VenueExists' in after['projection-definitions'], true, 'and so does its fold');
    eq(sandbox.existenceLifecycleOffer(after, 'Venue'), 'designate',
      'adding it again would designate the one that is there');
    sandbox.addExistenceLifecycle(active(), 'Venue');
    eq(model()['entity-definitions'].Venue.properties.length, 1, 'not a second `exists`');
    eq(model()['entity-definitions'].Venue.lifecycle, 'exists', 'designated again');
    eq(Object.keys(model()['projection-definitions']).filter((n) => /^VenueExists/.test(n)),
      ['VenueExists'], 'and no second fold');
  });

  check('an `exists` that cannot be a lifecycle withdraws the one-click offer', () => {
    const id = active().id;
    sandbox.createEntity(active(), 'stage');
    sandbox.addDefinition('projection-definition', id, 'StageExistsCount', {
      parameters: [{ name: 'stageId', propertyType: 'StageId' }],
      valueType: 'integer', isList: false, initialValue: 0, handlers: [],
    });
    sandbox.updateDefinition('entity-definition', id, 'Stage', {
      properties: [{ name: 'exists', projection: 'StageExistsCount' }],
    });
    eq(sandbox.existenceLifecycleOffer(model(), 'Stage'), null, 'not offered');
    sandbox.addExistenceLifecycle(active(), 'Stage');
    eq(model()['entity-definitions'].Stage.lifecycle, undefined, 'and refused if asked anyway');
    sandbox.removeDefinition('entity-definition', id, 'Stage');
    sandbox.removeDefinition('projection-definition', id, 'StageExistsCount');
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

  check('watching a second partition keeps the first — the form closes with the pin', () => {
    // Driven the way the browser drives it: `togglePinned` repaints,
    // and what that paint leaves on screen is what the next click
    // lands on. A paint with the draft still set used to leave the
    // submitted form open holding a stale closure — resubmitting it
    // carried the old arguments and unpinned the watch it had just
    // added, so watching two partitions ended with neither watched.
    sandbox.sessionReset();
    const names = ['CourseCapacity'];
    const realRender = sandbox.render;
    let screen = null;
    sandbox.render = () => { screen = sandbox.watchProjectionAdder(active(), names); };
    try {
      const watchAt = (id) => {
        sandbox.state.watchDraft = { projection: 'CourseCapacity', arguments: {} };
        sandbox.render();
        findAll(screen, (n) => n.tag === 'input')[0].onchange({ target: { value: id } });
        findAll(screen, (n) => n.tag === 'button' && textOf(n) === 'Watch it')[0].onclick();
      };
      watchAt('c1');
      eq(session.pinned.map((w) => w.arguments), [{ courseId: 'c1' }], 'the first is watched');
      eq(findAll(screen, (n) => n.tag === 'input').length, 0,
        'and the paint the pin triggered no longer shows the form');
      watchAt('c2');
      eq(session.pinned.map((w) => w.arguments), [{ courseId: 'c1' }, { courseId: 'c2' }],
        'both partitions stay watched');
    } finally {
      sandbox.render = realRender;
      sandbox.sessionReset();
    }
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
    // A select's own face is a <button> too (see `pick`); the one that
    // commits is the one with a handler.
    const button = findAll(adder, (n) => n.tag === 'button' && n.onclick)[0];
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
    // Give it a payload, and a read the way the merged step would
    // produce one: with the rule that wanted it. A boundary written
    // without one would be pruned by this very write — nothing would
    // consult it — which is the whole point of the merge.
    sandbox.updateDefinition('command-definition', id, 'CertifyCourse', {
      ...model()['command-definitions'].CertifyCourse,
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
      boundary: [{ alias: 'course', entity: 'Course', id: { parameterName: 'courseId' } }],
      conditions: [{
        leftHandSide: { alias: 'course', property: 'status' },
        predicate: 'equals',
        rightHandSide: { enumMember: 'Existent' },
      }],
    });
    sandbox.advanceWizard(model(), slice());   // the merged decide step revealed
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

  check('an entity created mid-rule resumes the rule, holding it as the pending read', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.view = 'slice';
    sandbox.state.newEntityAt = 'rules';
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'DefineCourse'));
    drive(step, 'room', 'Add');
    eq(!!model()['entity-definitions'].Room, true, 'the entity exists');
    eq(sandbox.state.adder, 'rule', 'the rule adder came back, not a read adder');
    // A brand-new entity derives a brand-new identifier type, so
    // nothing already in scope could identify one. The command gains
    // the input that says which, in the same gesture — otherwise the
    // entity is unreachable the instant it exists and the rule has
    // nowhere to go.
    eq(model()['command-definitions'].DefineCourse.properties.map((p) => p.name).includes('roomId'),
      true, 'the command now takes the id that says which room');
    eq(sandbox.state.ruleDraft.newRead.entity, 'Room',
      'holding the thing that was just made as the read the rule will bring with it');
    // A brand-new entity has no properties, so the rule's left side has
    // nothing to name yet — the property form opens on it straight away
    // rather than leaving the row in a dead end.
    eq(sandbox.state.addingProp && sandbox.state.addingProp.only, 'Room',
      'and the first property is what it asks for next');
    sandbox.closeForms();
  });

  // Under the merge a read is never committed on its own: nothing
  // consults it, so the write path would prune it in the same append
  // that stored it. The row holds out for the whole rule.
  check('a rule row with a read but no rule commits nothing on leaving', () => {
    sandbox.state.slice = 'ChangeCourseCapacity';
    sandbox.state.adder = 'rule';
    const before = model()['command-definitions'].ChangeCourseCapacity.boundary.length;
    sandbox.state.ruleDraft = {
      predicate: 'equals', negate: false, left: '', right: '',
      target: 'entity:Course', touched: true,
    };
    sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'ChangeCourseCapacity'));
    sandbox.closeForms();
    eq(model()['command-definitions'].ChangeCourseCapacity.boundary.length, before,
      'no read landed, because no rule wanted one yet');
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

  check('an entity created mid-change asks for its first property, not a lifecycle', () => {
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.newEntityAt = 'changes:CourseDefined';
    drive(sandbox.changeAdder(model(), 'CourseDefined'), 'venue', 'Add');
    eq(model()['entity-definitions'].Venue.properties, [], 'the entity arrived bare');
    eq(sandbox.state.addingProp, { eventName: 'CourseDefined', only: 'Venue' },
      'and the property form opened for it');
    sandbox.changeAdder(model(), 'CourseDefined');
    eq(sandbox.state.fieldDraft.entity, 'Venue', 'on the entity just made, not the first by name');
    eq(sandbox.state.changeDraft && sandbox.state.changeDraft.target
      === JSON.stringify(['Venue', 'exists']), false, 'and nothing proposes setting `exists`');
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

  // The read half of the merged row narrows exactly as the old read
  // adder did — it is the same question, asked inside the rule that
  // wants the answer. The target picker is the row's first select, so
  // the identifier or argument picker is its second.
  const readRow = (command, target) => {
    sandbox.state.slice = command;
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '', target };
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), command));
    const select = findAll(step, (n) => n.tag === 'select')[1];
    return findAll(select, (n) => n.tag === 'option').map((n) => n.value);
  };

  check('the identifier picker offers the id type only, first match pre-picked', () => {
    const values = readRow('SubscribeStudentToCourse', 'entity:Course');
    eq(values.includes(JSON.stringify({ parameterName: 'courseId' })), true,
      'the course id the payload carries is offered');
    eq(values.includes(JSON.stringify({ parameterName: 'studentId' })), false,
      'the student id beside it is not — wrong type');
    eq(sandbox.state.ruleDraft.newRead.source, JSON.stringify({ parameterName: 'courseId' }),
      'and the matching source is already picked');
    sandbox.closeForms();
  });

  check('a list of the right type stays offered — that is the fan-out', () => {
    const values = readRow('SubscribeStudentToCourse', 'entity:Student');
    eq(values.includes(JSON.stringify({ alias: 'course', property: 'subscribedStudentIds' })), true,
      'a StudentId list identifies many students at once');
    eq(values.includes(JSON.stringify({ parameterName: 'courseId' })), false,
      'the course id is still the wrong type');
    sandbox.closeForms();
  });

  // What the first question offers is what this command could actually
  // reach. An entity nothing in scope can identify is a dead end, and a
  // projection an entity property binds is read through that entity —
  // every projection in this model is one.
  // The target picker is the first question's own select.
  const targetOptions = (command) => {
    sandbox.state.slice = command;
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '' };
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), command));
    const select = findAll(step, (n) => n.tag === 'select')[0];
    return findAll(select, (n) => n.tag === 'option').map((n) => n.value);
  };

  check('the first question offers only what this command can reach', () => {
    const values = targetOptions('SubscribeStudentToCourse');
    eq(values.some((v) => v.startsWith('projection:')), false,
      'no projection an entity binds — course.capacity is read through the course');
    eq(values.some((v) => v.startsWith('alias:')), false,
      'and no read it already makes — those carry their own "+ rule about …" button');
    eq(values.includes('entity:Course'), true, 'another Course — the payload carries a course id');
    eq(values.includes('entity:Student'), true, 'another Student — and a student id');
    sandbox.closeForms();
  });

  check('an entity nothing in scope can identify is not offered', () => {
    sandbox.addDefinition('entity-definition', id, 'Room', { properties: [] });
    eq(targetOptions('SubscribeStudentToCourse').includes('entity:Room'), false,
      'nothing here carries a RoomId, so a rule about a room could never be finished');
    sandbox.removeDefinition('entity-definition', id, 'Room');
    sandbox.closeForms();
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

  check('a body the model once refused stores now, advisory-flagged until repaired', () => {
    sandbox.toggleProjectionRow(model(), 'CourseStatus');
    // An enum-valued projection whose initial value names no member —
    // stored as typed, reported rather than refused.
    sandbox.state.projDraft.body.initialValue = { enumMember: 'NoSuchMember' };
    sandbox.autoSaveProjectionDraft();
    eq(model()['projection-definitions'].CourseStatus.initialValue,
      { enumMember: 'NoSuchMember' }, 'stored as typed');
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'CourseStatus' && /NoSuchMember/.test(a.message)
    ), true, 'and reported as an advisory');
    // Repairing the draft clears the advisory.
    sandbox.state.projDraft.body.initialValue = { enumMember: 'Existent' };
    sandbox.autoSaveProjectionDraft();
    eq(model()['projection-definitions'].CourseStatus.initialValue,
      { enumMember: 'Existent' }, 'repaired');
    eq(sandbox.modelAdvisories(model()).some((a) => a.name === 'CourseStatus'), false,
      'nothing left to report');
    sandbox.state.projDraft = null;
  });

  check('"+ member" inside an open row keeps the row open, form shown', () => {
    sandbox.state.projDraft = null;
    sandbox.toggleProjectionRow(model(), 'CourseStatus');
    const chips = sandbox.enumMemberChips(model(), 'CourseStatus');
    const root = { children: chips };
    findAll(root, (n) => n.tag === 'button' && textOf(n) === '+ member')[0].onclick();
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseStatus',
      'the hosting row survived the click');
    eq(sandbox.state.addingMember, { type: 'CourseStatus' }, 'and the member form is on');
    const after = { children: sandbox.enumMemberChips(model(), 'CourseStatus') };
    eq(findAll(after, (n) => /inline-form/.test(n.className || '')).length, 1,
      'so the form actually renders where the chips are');
    sandbox.closeForms();
  });

  check('renaming a member from inside the row keeps it open the same way', () => {
    sandbox.state.projDraft = null;
    sandbox.toggleProjectionRow(model(), 'CourseStatus');
    const chips = { children: sandbox.enumMemberChips(model(), 'CourseStatus') };
    findAll(chips, (n) => n.className === 'editable' && textOf(n) === 'Existent')[0].onclick();
    eq(sandbox.state.projDraft && sandbox.state.projDraft.name, 'CourseStatus',
      'the hosting row survived the click');
    eq(sandbox.state.editMember, { where: 'member:CourseStatus', name: 'Existent' },
      'and the rename form is on');
    sandbox.closeForms();
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
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    const panels = findAll(step, (n) => /\bqpanel\b/.test(n.className || '')).map(textOf);
    eq(panels.length, 2, 'one per read');
    eq(panels[0].includes('CourseId:courseId') && panels[0].includes('CourseDefined'),
      true, 'the course read: its tag and the events its read properties fold');
    eq(panels[1].includes('StudentId:studentId') && panels[1].includes('StudentRegistered'),
      true, 'the student read likewise');
  });

  check('clicking the glyph pins the popover; Escape state clears it', () => {
    sandbox.state.slice = 'SubscribeStudentToCourse';
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
    const button = findAll(step, (n) => /\bqbtn\b/.test(n.className || ''))[0];
    button.onclick({ stopPropagation() {} });
    eq(sandbox.state.queryPop, 'read:course', 'pinned under its own key');
    const again = sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
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
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse'));
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

  check('a valueless handler stores, and the advisory says what is missing', () => {
    updateDefinition('projection-definition', id, 'CourseStartingWeek', {
      parameters: [{ name: 'courseId', propertyType: 'CourseId' }],
      valueType: 'integer', isList: false, initialValue: 0,
      handlers: [{ event: 'CourseDefined', operation: 'set' }],
    });
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'CourseStartingWeek'
        && /says what it does but not what value it takes/.test(a.message)
    ), true, 'undefined is not a literal, whatever operandSource thinks');
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
// The lenient regime's other half: a model full of what validation
// used to refuse — dangling references of every kind, unidiomatic
// names — must still *render*, on every page, and still say what is
// wrong through `problems`. This is the stress test that keeps the
// interface honest about what the write path now lets in.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);

  check('a model full of dangling references still renders every page', () => {
    // Every class of representable defect, injected through the same
    // command functions any editor or agent would use.
    sandbox.removeDefinition('projection-definition', id, 'CourseCapacity');
    sandbox.removeDefinition('event-definition', id, 'CourseDefined');
    sandbox.removeDefinition('entity-definition', id, 'Student');
    sandbox.addDefinition('event-definition', id, 'weird_thing', { properties: [] });
    sandbox.updateDefinition('command-definition', id, 'DefineCourse', {
      properties: [{ name: 'courseId', propertyType: 'NoSuchType', isOptional: false, isList: false }],
      boundary: [{ alias: 'ghost', entity: 'NoSuchEntity', id: { parameterName: 'courseId' } }],
      conditions: [{ leftHandSide: { alias: 'ghost', property: 'gone' }, predicate: 'equals',
        rightHandSide: { enumMember: 'Never' } }],
      publishes: [{ name: 'NoSuchEvent', parameters: {} }],
    });

    const current = model();
    eq(sandbox.modelAdvisories(current).length > 0, true, 'the defects are all reported');

    // Every view, the way `render` reaches them.
    const paint = (fn) => {
      const main = sandbox.document.createElement('div');
      fn(current, main);
      return textOf(main);
    };
    paint(sandbox.renderEvents);
    paint(sandbox.renderProjections);
    paint(sandbox.renderCustomTypes);
    sandbox.state.entity = 'Course';
    paint(sandbox.renderEntity);

    // The slice view of the broken command, step by step — in simple
    // mode and in advanced mode, which additionally derives and prints
    // each binding's DCB query.
    sandbox.state.slice = 'DefineCourse';
    for (const mode of ['simple', 'advanced']) {
      store.set('dcb-playground:mode', mode);
      const slice = sandbox.sliceOf(current, 'DefineCourse');
      textOf(sandbox.stepTrigger(current, slice));
      textOf(sandbox.stepDecision(current, slice));
      textOf(sandbox.stepChanges(current, slice));
      textOf(sandbox.stepConsistency(current, slice));
    }
    paint(sandbox.renderCoupling);
    paint(sandbox.renderRuleMap);
    store.set('dcb-playground:mode', 'simple');

    // And the problems list still stands behind all of it.
    eq(sandbox.problems(current).length > 0, true, 'problems lists the fallout');
  });

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

// ---------------------------------------------------------------
// Optional properties in the payload editors. "No value" is a state
// the interface shows — the explicit null — and never the empty
// string; the save path spells the null out into everything a draft
// left unset.
// ---------------------------------------------------------------
{
  const id = sandbox.createDcbModel('Optional Probe');
  const model = () => sandbox.projectState()[id];
  const property = { name: 'notiz', propertyType: 'string', isOptional: true, isList: false };

  // The stub's `setAttribute` is inert, so the checkbox is findable
  // only as the input `h` gave no class — which the one real text
  // input always has.
  const toggleOf = (card) => findAll(card, (n) => n.tag === 'input' && !n.className)[0];

  check('an unset optional field is a "no value" chip, not an input', () => {
    const draft = { notiz: null };
    const where = { root: () => draft, suggest: () => [] };
    const card = sandbox.valueEditor(model(), property, ['notiz'], where);
    eq(findAll(card, (n) => n.tag === 'input' && n.className === 'vin').length, 0, 'nothing to type into');
    eq(textOf(card).includes('no value'), true, 'and it says so');
    eq(!!toggleOf(card), true, 'with the toggle there to change that');
  });

  check('ticking it opens the editor; unticking writes the null back', () => {
    const draft = { notiz: null };
    const where = { root: () => draft, suggest: () => [] };
    let card = sandbox.valueEditor(model(), property, ['notiz'], where);
    toggleOf(card).onchange({ target: { checked: true } });
    eq(draft.notiz, '', 'set, as the blank it starts from — a value now, not the null');
    card = sandbox.valueEditor(model(), property, ['notiz'], where);
    eq(findAll(card, (n) => n.tag === 'input' && n.className === 'vin').length, 1, 'the ordinary editor is back');
    toggleOf(card).onchange({ target: { checked: false } });
    eq(draft.notiz, null, 'null, distinct from the empty string it just held');
  });

  check('saving spells the null into whatever a draft left unset', () => {
    sandbox.addDefinition('event-definition', id, 'NotizErfasst', {
      properties: [
        { name: 'anordnungId', propertyType: 'string', isOptional: false, isList: false },
        property,
      ],
    });
    const values = { anordnungId: 'a1' };
    sandbox.fillUnsetOptionals(values, model()['event-definitions'].NotizErfasst.properties);
    eq(values, { anordnungId: 'a1', notiz: null }, 'the unset optional is now the explicit null');

    const body = { given: [{ event: 'NotizErfasst', data: { anordnungId: 'a2' } }] };
    sandbox.fillGivenOptionals(model(), body);
    eq(body.given[0].data, { anordnungId: 'a2', notiz: null }, 'a Given step gets the same spelling');

    const set = { anordnungId: 'a1', notiz: '' };
    sandbox.fillUnsetOptionals(set, model()['event-definitions'].NotizErfasst.properties);
    eq(set.notiz, '', 'the empty string is a value and stays one');
  });
}

// ---------------------------------------------------------------
// A mark reaches `pick` as an option's own third element, never
// detected out of the text: only the caller knows where a mark ends,
// so a modifier sequence ("👮🏻‍♀️") stays whole and a non-emoji mark
// ("﹟") is carried the same way. In the option itself the name leads
// the text — native type-ahead searches option text and nothing else,
// so this is what keeps a select keyboard-searchable — and the mark
// trails in its own span for the customizable-select CSS to re-front.
// ---------------------------------------------------------------
{
  const spansOf = (option) => (option.children || []).map((s) => [s.className, textOf(s)]);

  check('a passed mark trails the name in its own span, whole', () => {
    const sel = sandbox.pick(
      [['A', 'Anordnung', '👮🏻‍♀️'], ['K', 'Course Capacity Changed', '﹟'], ['C', 'Course']],
      'A', () => {});
    const options = findAll(sel, (n) => n.tag === 'option');
    eq(spansOf(options[0]), [['label', 'Anordnung'], ['icon', '👮🏻‍♀️']],
      'name first for type-ahead, the emoji cluster untouched in the icon span');
    eq(spansOf(options[1]), [['label', 'Course Capacity Changed'], ['icon', '﹟']],
      'a non-emoji mark is a mark like any other');
    eq(textOf(options[2]), 'Course', 'an option without a mark stays plain text');
    eq(sel.children[0].tag, 'button',
      'and the customizable-select face is in place for browsers that render it');
  });

  check('grouped rows lift their shared mark into the group label', () => {
    const sel = sandbox.pick([
      ['a', 'course · capacity', '📚'],
      ['b', 'course · seats', '📚'],
      ['c', 'student · name', '🧑‍🎓'],
    ], 'a', () => {});
    const groups = findAll(sel, (n) => n.tag === 'optgroup');
    eq(groups.map((g) => g.label), ['📚 course'],
      'the two-row alias groups under a mark-led label, outside type-ahead');
    eq(findAll(groups[0], (n) => n.tag === 'option').map(textOf), ['capacity', 'seats'],
      'its rows stay plain suffixes');
    const single = findAll(sel, (n) => n.tag === 'option' && textOf(n).includes('student'));
    eq(spansOf(single[0]), [['label', 'student · name'], ['icon', '🧑‍🎓']],
      'a group of one stays a full-text option, mark trailing');
  });
}

// ---------------------------------------------------------------
// A command's place within a feature is never chosen — the groups list
// their commands alphabetically, by the name they are shown under.
// Dropping a command anywhere in a group relies on this: it can only
// mean "into this group", never "at this position".
// ---------------------------------------------------------------
{
  const { id, model } = build(0);

  check('commands within a feature sit alphabetically, wherever they were added', () => {
    const feature = sandbox.featureOf(Object.values(model()['command-definitions'])[0]);
    addDefinition('command-definition', id, 'AaaFirstByName', {
      feature, properties: [], boundary: [], conditions: [], publishes: [],
    });
    for (const group of sandbox.featureGroups(model())) {
      const shown = group.commands.map(sandbox.readable);
      eq(shown, [...shown].sort((a, b) => a.localeCompare(b)),
        'group "' + group.name + '" reads in display order');
    }
    const home = sandbox.featureGroups(model()).find((g) => g.name === feature);
    eq(home.commands[0], 'AaaFirstByName', 'the latecomer sorts to the front, not the end');
  });
}

// ---------------------------------------------------------------
// One handler per event type is enforced by omission: the projection
// editor's event picker offers only events no other handler row has
// already claimed — a row's own event stays, or the picker could not
// render its current choice.
// ---------------------------------------------------------------
{
  check('an event another handler row claims is not offered again', () => {
    const names = ['Assigned', 'Unassigned', 'Archived'];
    const handlers = [
      { event: 'Assigned', operation: 'append', value: { eventProperty: 'courseId' } },
      { event: '', operation: 'set', value: '' },
    ];
    eq(sandbox.unhandledEventChoices(names, handlers, handlers[1]),
      ['Unassigned', 'Archived'], 'the fresh row sees only what is free');
    eq(sandbox.unhandledEventChoices(names, handlers, handlers[0]),
      ['Assigned', 'Unassigned', 'Archived'], 'a row keeps its own event on offer');
    eq(sandbox.unhandledEventChoices(names, [], null), names, 'nothing claimed, everything offered');
  });
}

// ---------------------------------------------------------------
// What a scripted handler can see comes from the definitions alone —
// the handled event's properties, the shape of the initial state, the
// script's arguments — and is synthesized into the TypeScript preamble
// the editor prefixes to the code. Pure model → text; the Monaco
// widget around it is DOM and deliberately not reached here.
// ---------------------------------------------------------------
{
  const { scriptHandlerPreamble } = sandbox;
  const has = (text, part, why) =>
    eq(text.includes(part), true, why + ' — expected the preamble to contain: ' + part);
  const model = {
    'custom-type-definitions': {
      CourseId: { schema: { type: 'string' }, isTag: true },
      StudentStatus: { schema: { type: 'string', enum: ['NonExistent', 'Existent'] } },
      Money: { properties: [
        { name: 'amount', propertyType: 'integer' },
        { name: 'currency', propertyType: 'string' }] },
    },
    'event-definitions': {
      CoursePriced: { properties: [
        { name: 'courseId', propertyType: 'CourseId' },
        { name: 'price', propertyType: 'Money' },
        { name: 'seats', propertyType: 'integer', isList: true },
        { name: 'note', propertyType: 'string', isOptional: true },
        { name: 'status', propertyType: 'StudentStatus' },
        { name: 'ghost', propertyType: 'NoSuchType' }] },
    },
  };
  const body = {
    valueType: 'integer',
    script: {
      initialState: { count: 0, open: true, ids: [], seats: { taken: 0 } },
      arguments: [{ name: 'courseId', propertyType: 'CourseId' }, { name: '', propertyType: 'CourseId' }],
    },
  };

  check('the preamble types exactly what the handler can see', () => {
    const text = scriptHandlerPreamble(model, body, { event: 'CoursePriced' });
    eq(text.split('\n')[0], 'export {};', 'each handler is its own file scope');
    eq(text.split('\n').pop(), '__check(', 'and ends opening the checked expression the code is');
    has(text, 'type CourseId = string & { readonly __type: "CourseId" };',
      'identifier types are branded, so mixing two of them squiggles');
    has(text, 'type StudentStatus = "NonExistent" | "Existent";',
      'enums are literal unions');
    has(text, 'type Money = { amount: number; currency: string };',
      'a composite type carries its fields');
    has(text, 'type: "CoursePriced";', 'event.type is the name itself');
    has(text, 'courseId: CourseId;', 'event data is typed from the definition');
    has(text, 'seats: number[];', 'a list property is a list');
    has(text, 'note: string | null;', 'an optional property may be the null it publishes');
    has(text, 'ghost: any;', 'a dangling type reference stays permissive, never fatal');
    has(text, 'count: number', 'state keys are typed from the initial state');
    has(text, '/** starts at 0 */', 'and hint where they start');
    has(text, 'ids: any[]', 'an empty initial list promises nothing about elements');
    has(text, '[key: string]: any', 'state stays loose — scripts may grow keys');
    has(text, 'declare const args: { courseId: CourseId };',
      'arguments are typed, unnamed rows are not offered');
  });

  check('what a handler returns is held to what the projection holds', () => {
    const returned = (over) => {
      const text = scriptHandlerPreamble(model, over, { event: 'CoursePriced' });
      return text.match(/__check\(nextState: ([\s\S]*?)\): void;/)[1];
    };
    eq(returned({ valueType: 'boolean', script: { initialState: false } }), 'boolean',
      'a boolean projection wants a boolean back');
    eq(returned({ valueType: 'boolean', script: { initialState: null } }), 'boolean | null',
      'a null start is how nullable is spelled, so null stays returnable');
    eq(returned({ valueType: 'CourseId', script: { initialState: null } }), 'string | null',
      'brands widen in return position — code can compare ids, never mint one');
    eq(returned({ valueType: 'StudentStatus', script: { initialState: null } }),
      '"NonExistent" | "Existent" | null', 'an enum wants one of its members back');
    eq(returned({ valueType: 'StudentStatus', isList: true, script: { initialState: [] } }),
      '("NonExistent" | "Existent")[] | any[]', 'a list projection wants the list');
    eq(returned({ valueType: 'NoSuchType', script: { initialState: null } }), 'any',
      'an unresolved held type checks nothing rather than everything wrongly');
    eq(returned({ valueType: 'integer', script: { initialState: 7, exposes: 'total' } }),
      '{ total: number } & { [key: string]: any } | number',
      'with exposes the value type constrains the exposed field of the record');
  });

  check('no event chosen (or a renamed-away one) leaves the data open', () => {
    const text = scriptHandlerPreamble(model, body, { event: '' });
    has(text, 'declare const event: { type: string; data: { [key: string]: any } };',
      'unknown event, unknowable data');
  });

  check('the predefined models synthesize cleanly', () => {
    const { model: projected } = build(0);
    const [eventName] = Object.keys(projected()['event-definitions']);
    const text = scriptHandlerPreamble(projected(),
      { valueType: 'integer', script: { initialState: null, arguments: [] } },
      { event: eventName });
    has(text, 'type: ' + JSON.stringify(eventName) + ';', 'a real event types by name');
    has(text, 'declare const state: any;', 'a null initial state promises nothing');
    has(text, '__check(nextState: number | null): void;', 'and stays returnable');
  });
}

// ---------------------------------------------------------------
// Lifecycles — each entity's status derived as a state machine.
// ---------------------------------------------------------------
{
  const { lifecycleMachines } = sandbox;
  const machineOf = (model, entity) =>
    lifecycleMachines(model).machines.find((m) => m.entity === entity);

  check('the base course model derives both machines', () => {
    const { model } = build(0);
    const course = machineOf(model(), 'Course');
    eq(course.states, ['NonExistent', 'Existent', 'Archived'], 'the enum is the states');
    eq(course.initial, 'NonExistent', 'the projection initial value is the entry state');
    eq(course.terminal, ['Archived'], 'nothing guarded leaves Archived');
    const defined = course.transitions.find((t) => t.event === 'CourseDefined');
    eq(defined.target, 'Existent', 'the handler value is the arrow head');
    eq(defined.sources, ['NonExistent'], 'DefineCourse is guarded, so the arrow starts there');
    eq(defined.unguarded, false, 'and the base model guards it');
    const archived = course.transitions.find((t) => t.event === 'CourseArchived');
    eq(archived.sources, ['Existent'], 'ArchiveCourse requires Existent');
    eq(course.perState.Existent.map((e) => e.command).sort(), [
      'ArchiveCourse', 'ChangeCourseCapacity', 'SubscribeStudentToCourse',
      'UnsubscribeStudentFromCourse',
    ], 'every command guarded to Existent lands there');
    eq(course.perState.Existent.find((e) => e.command === 'ArchiveCourse').movesTo,
      'Archived', 'a command publishing a transitioning event knows where it moves');
    eq(course.perState.Archived, [], 'nothing is guarded to run at Archived');
  });

  check('a command with no rule over a lifecycle it binds is unguarded', () => {
    const { id, model } = build(0);
    // Built for the purpose rather than borrowed from a shipped model:
    // a command that *binds* a student and never tests whether it
    // exists. The shipped Unsubscribe used to be that example, until it
    // stopped reading the student it never tested.
    sandbox.addDefinition('command-definition', id, 'NudgeStudent', {
      properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
      boundary: [{ alias: 'student', entity: 'Student', id: { parameterName: 'studentId' } }],
      conditions: [{
        leftHandSide: { alias: 'student', property: 'subscriptionCount' },
        predicate: 'greaterThan', rightHandSide: 0,
      }],
      publishes: [{ name: 'StudentRegistered', parameters: { studentId: { parameterName: 'studentId' } } }],
    });
    const student = machineOf(model(), 'Student');
    for (const state of student.states) {
      const entry = student.perState[state].find((e) => e.command === 'NudgeStudent');
      eq(entry.unguarded, true, 'flagged unguarded at ' + state);
    }
    eq(student.perState.true.find((e) => e.command === 'SubscribeStudentToCourse').unguarded,
      false, 'Subscribe carries a student · exists rule and is pinned');
    eq(student.perState.true.some((e) => e.command === 'UnsubscribeStudentFromCourse'), false,
      'and Unsubscribe is absent — it no longer reads a student, so it is not in this machine');
    sandbox.removeDefinition('command-definition', id, 'NudgeStudent');
    eq(student.terminal, ['true'], 'nothing leaves existing — a derived dead end');
  });

  check('an unguarded transition is drawn from the initial state, by convention', () => {
    const { model } = build(1); // the sequence layer drops DefineCourse's status rule
    const course = machineOf(model(), 'Course');
    const defined = course.transitions.find((t) => t.event === 'CourseDefined');
    eq(defined.unguarded, true, 'the numbering guards it, the status does not');
    eq(defined.conventional, true, 'so its source is convention, not derivation');
    eq(defined.sources, ['NonExistent'], 'and the convention is the initial state');
    eq(course.terminal, ['Archived'], 'the conventional arrow still counts as a way out');
  });

  check('the pricing model derives across both entities', () => {
    const { model } = build(4);
    const order = machineOf(model(), 'Order');
    eq(order.states, ['false', 'true'], 'a boolean lifecycle is a two-state machine');
    eq(order.compact, true, 'and the page draws it as a row, not a diagram');
    eq(order.transitions.find((t) => t.event === 'ProductsOrdered').sources, ['false'],
      'OrderProducts requires the order not to exist yet — read off isFalse');
    const product = machineOf(model(), 'Product');
    eq(product.perState.true.map((e) => e.command).sort(),
      ['ChangeProductPrice', 'OrderProducts'],
      'a fanned-out binding still pins the command by its isTrue rule');
  });

  check('an entity designating no lifecycle is excluded with its reason', () => {
    const { id, model } = build(0);
    addDefinition('entity-definition', id, 'Room', { properties: [] });
    const { machines, excluded } = lifecycleMachines(model());
    eq(machines.some((m) => m.entity === 'Room'), false, 'no machine without a designation');
    eq(excluded.find((e) => e.entity === 'Room').reason, 'none', 'and the page can say why');
  });

  check('a scripted lifecycle is excluded, not advised against', () => {
    const { model } = build(5);   // content-decisions-scripted
    const { machines, excluded } = lifecycleMachines(model());
    eq(machines.some((m) => m.entity === 'Document'), false, 'no machine can be read from a script');
    eq(excluded.find((e) => e.entity === 'Document').reason, 'scripted', 'the page says why');
    // The designation is right even though the diagram is impossible, so
    // nothing complains about it.
    eq(sandbox.modelAdvisories(model())
      .filter((a) => a.kind === 'entity-definition' && a.name === 'Document').length, 0,
      'and it is not an advisory');
  });

  check('a negated status rule allows the complement', () => {
    const { id, model } = build(0);
    const body = sandbox.deepClone(model()['command-definitions'].ArchiveCourse);
    body.conditions[0].negate = true;
    updateDefinition('command-definition', id, 'ArchiveCourse', body);
    const course = machineOf(model(), 'Course');
    eq(course.transitions.find((t) => t.event === 'CourseArchived').sources.sort(),
      ['Archived', 'NonExistent'], 'everything but Existent');
  });

  // `equalsAny` over the status is a set of allowed states, so the
  // derivation reads it — but only a list of member references; a bare
  // literal makes the rule unreadable, not guessed at.
  const archiveGuardedBy = (rightHandSide, negate) => {
    const { id, model } = build(0);
    const body = sandbox.deepClone(model()['command-definitions'].ArchiveCourse);
    body.conditions = [{
      leftHandSide: { alias: 'course', property: 'status' },
      predicate: 'equalsAny',
      rightHandSide,
      ...(negate ? { negate: true } : {}),
    }];
    updateDefinition('command-definition', id, 'ArchiveCourse', body);
    return machineOf(model(), 'Course').transitions.find((t) => t.event === 'CourseArchived');
  };

  check('an equalsAny status rule allows the listed set', () => {
    const archived = archiveGuardedBy([{ enumMember: 'NonExistent' }, { enumMember: 'Existent' }]);
    eq(archived.sources, ['NonExistent', 'Existent'], 'allowed exactly where listed');
    eq(archived.unguarded, false, 'and read as a guard');
  });

  check('a negated equalsAny allows the complement of the listed set', () => {
    const archived = archiveGuardedBy([{ enumMember: 'Existent' }], true);
    eq(archived.sources.sort(), ['Archived', 'NonExistent'], 'everything but the listed');
  });

  check('a bare literal in the list leaves the command unguarded, not guessed at', () => {
    const archived = archiveGuardedBy([{ enumMember: 'Existent' }, 'Archived']);
    eq(archived.unguarded, true, 'unreadable, so unguarded');
  });

  check('an empty list reads as "allowed nowhere", which is what it evaluates to', () => {
    const archived = archiveGuardedBy([]);
    eq(archived.sources, [], 'no state allows it');
    eq(archived.unguarded, false, 'a read guard, not a missing one');
  });
}

// ---------------------------------------------------------------
// Promoting a boolean lifecycle into a real one, and the suggestion
// that offers to.
// ---------------------------------------------------------------
{
  const { lifecycleMachines, lifecycleMergeSuggestion, isMonotoneBoolean } = sandbox;

  // A student is the two-state case in every shipped model, so it is
  // what a promotion is exercised against.
  const promoted = () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    sandbox.mergeIntoLifecycle(model(), 'Student', {
      typeName: 'StudentStatus', property: 'status', initialState: 'NonExistent',
      steps: [{ state: 'Existent', from: 'exists' }, { state: 'Graduated', from: null }],
    });
    return { id, model };
  };

  check('promotion invents the enum, renames the property and moves the designation', () => {
    const { model } = promoted();
    const student = model()['entity-definitions'].Student;
    eq(student.lifecycle, 'status', 'the designation followed the rename');
    eq(student.properties.some((p) => p.name === 'status'), true, 'the property is renamed');
    eq(student.properties.some((p) => p.name === 'exists'), false, 'and `exists` is gone');
    eq(model()['custom-type-definitions'].StudentStatus.schema.enum,
      ['NonExistent', 'Existent', 'Graduated'], 'the enum holds all three, in order');
    const projection = model()['projection-definitions'].StudentStatus;
    eq(projection.valueType, 'StudentStatus', 'the projection holds the enum');
    eq(projection.initialValue, { enumMember: 'NonExistent' }, 'and starts where false did');
    eq(projection.handlers.find((h) => h.event === 'StudentRegistered').value,
      { enumMember: 'Existent' }, 'set true became set Existent');
    eq(model()['projection-definitions'].StudentExists, undefined,
      'the absorbed fold is gone, nothing referencing it');
  });

  check('promotion rewrites every rule that guarded the boolean', () => {
    const { model } = promoted();
    const register = model()['command-definitions'].RegisterStudent.conditions[0];
    eq(register, {
      leftHandSide: { alias: 'student', property: 'status' },
      predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' },
    }, 'isFalse became equals NonExistent');
    // The part worth being exact about: a graduated student still
    // exists, so "student exists" is every state the boolean was
    // true in — not just the one named after it. Narrowing this to
    // `equals Existent` would silently change what the rule means, and
    // an earlier cut of this did exactly that.
    const subscribe = model()['command-definitions'].SubscribeStudentToCourse.conditions
      .find((c) => c.leftHandSide && c.leftHandSide.alias === 'student');
    eq(subscribe, {
      leftHandSide: { alias: 'student', property: 'status' },
      predicate: 'equalsAny',
      rightHandSide: [{ enumMember: 'Existent' }, { enumMember: 'Graduated' }],
    }, 'isTrue became every state it held in');
  });

  check('two hand-added booleans merge into one lifecycle', () => {
    // The case the first cut of the suggestion missed entirely: neither
    // boolean is the designated lifecycle, and both were added by hand.
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    addDefinition('event-definition', id, 'StudentExpelled', {
      properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'StudentExpulsion', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'StudentExpelled', operation: 'set', value: true }],
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'expelled', projection: 'StudentExpulsion' });
    updateDefinition('entity-definition', id, 'Student', student);
    const body = sandbox.deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    body.conditions.push({
      leftHandSide: { alias: 'student', property: 'expelled' }, predicate: 'isFalse',
    });
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', body);

    eq(sandbox.entityMergeCandidates(model(), 'Student'), ['exists', 'expelled'],
      'both are offered, in progression order');
    const suggestion = sandbox.lifecycleMergeSuggestion(
      model(), model()['command-definitions'].SubscribeStudentToCourse
    );
    eq(suggestion.booleans, ['exists', 'expelled'], 'and the command asks for it');

    sandbox.mergeIntoLifecycle(model(), 'Student', {
      typeName: 'StudentStatus', property: 'status', initialState: 'NonExistent',
      steps: [{ state: 'Registered', from: 'exists' }, { state: 'Expelled', from: 'expelled' }],
    });
    const after = model()['entity-definitions'].Student;
    eq(after.lifecycle, 'status', 'one designated lifecycle');
    eq(after.properties.map((p) => p.name), ['status', 'subscriptionCount'],
      'both booleans absorbed, the merged one where the first of them was');
    eq(model()['projection-definitions'].StudentStatus.handlers, [
      { event: 'StudentRegistered', operation: 'set', value: { enumMember: 'Registered' } },
      { event: 'StudentExpelled', operation: 'set', value: { enumMember: 'Expelled' } },
    ], 'one handler per absorbed setter, each into its own state');
    eq(model()['projection-definitions'].StudentExpulsion, undefined, 'the absorbed folds are gone');

    const rules = model()['command-definitions'].SubscribeStudentToCourse.conditions
      .filter((c) => c.leftHandSide && c.leftHandSide.alias === 'student'
        && c.leftHandSide.property === 'status');
    eq(rules, [
      { leftHandSide: { alias: 'student', property: 'status' }, predicate: 'equalsAny',
        rightHandSide: [{ enumMember: 'Registered' }, { enumMember: 'Expelled' }] },
      { leftHandSide: { alias: 'student', property: 'status' }, predicate: 'equalsAny',
        rightHandSide: [{ enumMember: 'NonExistent' }, { enumMember: 'Registered' }] },
    ], 'exists became both later states; not-expelled became both earlier ones');
    eq(sandbox.modelAdvisories(model()).filter((a) => a.name === 'SubscribeStudentToCourse'), [],
      'and the command is clean afterwards');
  });

  check('two booleans one event moves cannot become one lifecycle', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    // Both set by StudentRegistered, so the merged fold would need two
    // handlers for one event — refused before anything is written.
    addDefinition('projection-definition', id, 'StudentGreeted', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'StudentRegistered', operation: 'set', value: true }],
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'greeted', projection: 'StudentGreeted' });
    updateDefinition('entity-definition', id, 'Student', student);
    const before = JSON.stringify(model()['entity-definitions'].Student);
    sandbox.mergeIntoLifecycle(model(), 'Student', {
      typeName: 'StudentStatus', property: 'status', initialState: 'NonExistent',
      steps: [{ state: 'Registered', from: 'exists' }, { state: 'Greeted', from: 'greeted' }],
    });
    eq(JSON.stringify(model()['entity-definitions'].Student), before, 'nothing was written');
    eq(model()['custom-type-definitions'].StudentStatus, undefined, 'not even the enum');
  });

  check('a non-monotone boolean is refused as a stage', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    addDefinition('event-definition', id, 'StudentPaused', {
      properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
    });
    addDefinition('event-definition', id, 'StudentResumed', {
      properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'StudentPause', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [
        { event: 'StudentPaused', operation: 'set', value: true },
        { event: 'StudentResumed', operation: 'set', value: false },
      ],
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'paused', projection: 'StudentPause' });
    updateDefinition('entity-definition', id, 'Student', student);
    eq(sandbox.entityMergeCandidates(model(), 'Student'), ['exists'],
      'a two-way boolean is not a stage, so it is not offered');
    sandbox.mergeIntoLifecycle(model(), 'Student', {
      typeName: 'StudentStatus', property: 'status', initialState: 'NonExistent',
      steps: [{ state: 'Registered', from: 'exists' }, { state: 'Paused', from: 'paused' }],
    });
    eq(model()['custom-type-definitions'].StudentStatus, undefined,
      'and asking for it anyway is refused');
  });

  check('a promotion is one undo step', () => {
    const { model } = promoted();
    eq(model()['entity-definitions'].Student.lifecycle, 'status', 'promoted');
    sandbox.undo();
    const student = model()['entity-definitions'].Student;
    eq(student.lifecycle, 'exists', 'and one undo puts the whole thing back');
    eq(model()['custom-type-definitions'].StudentStatus, undefined, 'enum and all');
    eq(model()['command-definitions'].RegisterStudent.conditions[0].predicate, 'isFalse',
      'with the rules as they were');
  });

  check('the promoted machine is drawn as a real lifecycle, not a compact row', () => {
    const { model } = promoted();
    const student = lifecycleMachines(model()).machines.find((m) => m.entity === 'Student');
    eq(student.states, ['NonExistent', 'Existent', 'Graduated'], 'three states');
    eq(student.compact, false, 'so it earns the band');
    eq(student.transitions.find((t) => t.event === 'StudentRegistered').sources, ['NonExistent'],
      'and the rewritten rule still pins the arrow');
  });

  // The discriminator. A one-way boolean folds into a lifecycle; an
  // orthogonal one must not, because collapsing it destroys a dimension.
  const withSecondBoolean = (handlers) => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    addDefinition('event-definition', id, 'CourseFlagged', {
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
    });
    addDefinition('event-definition', id, 'CourseUnflagged', {
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'StudentFlag', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false, handlers,
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'isFlagged', projection: 'StudentFlag' });
    updateDefinition('entity-definition', id, 'Student', student);
    const body = sandbox.deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    body.conditions.push({
      leftHandSide: { alias: 'student', property: 'isFlagged' }, predicate: 'isFalse',
    });
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', body);
    return { id, model };
  };

  check('a one-way boolean is monotone, and the merge is offered', () => {
    const { model } = withSecondBoolean([
      { event: 'CourseFlagged', operation: 'set', value: true },
    ]);
    eq(isMonotoneBoolean(model(), 'Student', 'isFlagged'), true, 'nothing sets it back');
    const suggestion = lifecycleMergeSuggestion(
      model(), model()['command-definitions'].SubscribeStudentToCourse
    );
    eq(suggestion && suggestion.entity, 'Student', 'the entity to promote');
    eq(suggestion.booleans, ['exists', 'isFlagged'],
      'both booleans, lifecycle first — existence is always the first stage');
  });

  check('a boolean that goes both ways is not monotone, and nothing is offered', () => {
    // The `exists && !isPublic` shape: a student can be flagged and
    // unflagged, so these are not stages of one life. Merging them into
    // one enum would lose the ability to be existent-and-unflagged.
    const { model } = withSecondBoolean([
      { event: 'CourseFlagged', operation: 'set', value: true },
      { event: 'CourseUnflagged', operation: 'set', value: false },
    ]);
    eq(isMonotoneBoolean(model(), 'Student', 'isFlagged'), false, 'one handler sets it back');
    eq(lifecycleMergeSuggestion(
      model(), model()['command-definitions'].SubscribeStudentToCourse
    ), null, 'so the suggestion stays silent');
  });

  check('a boolean nothing ever sets is not a door either way', () => {
    const { model } = withSecondBoolean([]);
    eq(isMonotoneBoolean(model(), 'Student', 'isFlagged'), false, 'no handlers, no direction');
  });

  check('two rules over one lifecycle alone suggest nothing', () => {
    const { model } = build(0);
    eq(lifecycleMergeSuggestion(
      model(), model()['command-definitions'].SubscribeStudentToCourse
    ), null, 'the shipped command guards a lifecycle and no second boolean');
  });
}

// ---------------------------------------------------------------
// Saying "the course exists" — rendering only, never storage.
// ---------------------------------------------------------------
{
  const { model } = build(0);
  const body = () => model()['command-definitions'].SubscribeStudentToCourse;
  const partsOf = (condition) => sandbox.conditionParts(condition, model(), body());

  check('a read of a designated boolean lifecycle reads as existence', () => {
    const exists = { leftHandSide: { alias: 'student', property: 'exists' }, predicate: 'isTrue' };
    eq(partsOf(exists), { left: 'student', verb: 'exists', right: null }, 'affirmative');
    eq(partsOf({ ...exists, predicate: 'isFalse' }),
      { left: 'student', verb: 'does not exist', right: null }, 'and denied');
    eq(partsOf({ ...exists, negate: true }),
      { left: 'student', verb: 'does not exist', right: null }, 'negation flips it too');
  });

  check('the sugar is rendering only — nothing is stored differently', () => {
    const stored = body().conditions.find((c) => c.leftHandSide.alias === 'student');
    eq(stored, { leftHandSide: { alias: 'student', property: 'exists' }, predicate: 'isTrue' },
      'an ordinary unary condition over an ordinary property');
    eq(sandbox.ruleSentence(model(), body(), stored), 'student exists', 'said in words');
  });

  check('an enum lifecycle is left to say itself', () => {
    const status = {
      leftHandSide: { alias: 'course', property: 'status' },
      predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
    };
    eq(partsOf(status), { left: 'course · status', verb: 'is', right: 'Existent' },
      'its states are named, and those names are the sentence');
  });

  check('without a model the reading is literal, and still correct', () => {
    const exists = { leftHandSide: { alias: 'student', property: 'exists' }, predicate: 'isTrue' };
    eq(sandbox.conditionParts(exists),
      { left: 'student · exists', verb: 'holds', right: null }, 'no context, no sugar');
  });

  check('a boolean machine labels its states off the property', () => {
    const student = sandbox.lifecycleMachines(model()).machines
      .find((m) => m.entity === 'Student');
    eq(sandbox.lifecycleStateWords(student, 'true'), 'exists', 'the true state');
    eq(sandbox.lifecycleStateWords(student, 'false'), 'does not exist', 'and the false one');
    eq(sandbox.lifecycleStateWords({ isBoolean: true, property: 'isArchived' }, 'false'),
      'is not archived', 'an is-prefixed predicate negates in place');
  });
}

// ---------------------------------------------------------------
// Importing a model written before the designation existed.
// ---------------------------------------------------------------
{
  const envelope = (entities, projections, customTypes) => ({
    $schema: 'https://dcb.events/schemas/model/v6.json',
    dcbModelVersion: '6.0',
    name: 'Imported',
    customTypeDefinitions: customTypes,
    eventDefinitions: [{ name: 'ThingMade', properties: [
      { name: 'thingId', propertyType: 'ThingId', isOptional: false, isList: false }] }],
    entityDefinitions: entities,
    projectionDefinitions: projections,
    commandDefinitions: [],
  });
  const enumType = { name: 'ThingStatus', schema: { type: 'string', enum: ['NonExistent', 'Existent'] } };
  const statusProjection = (name) => ({
    name, parameters: [{ name: 'thingId', propertyType: 'ThingId' }],
    valueType: 'ThingStatus', isList: false,
    initialValue: { enumMember: 'NonExistent' },
    handlers: [{ event: 'ThingMade', operation: 'set', value: { enumMember: 'Existent' } }],
  });

  const imported = (doc) => {
    store.clear();
    sandbox.bumpLogRevision();
    const result = sandbox.importModelFromEnvelope(doc);
    const id = typeof result === 'string' ? result : result.modelId;
    return projectState()[id];
  };

  check('a pre-6.1 model with a status enum gets the designation, once, at the gate', () => {
    const model = imported(envelope(
      [{ name: 'Thing', properties: [{ name: 'status', projection: 'ThingStatus' }] }],
      [statusProjection('ThingStatus')], [enumType]
    ));
    eq(model['entity-definitions'].Thing.lifecycle, 'status', 'inferred and stored');
    eq(sandbox.lifecycleOf(model, 'Thing').states, ['NonExistent', 'Existent'],
      'and it resolves as the enum it already was — nothing was converted');
  });

  check('a property called something else is left alone', () => {
    // The old convention had one spelling. Guessing past it would be
    // inventing a designation its author never made.
    const model = imported(envelope(
      [{ name: 'Thing', properties: [{ name: 'state', projection: 'ThingState' }] }],
      [statusProjection('ThingState')], [enumType]
    ));
    eq(model['entity-definitions'].Thing.lifecycle, undefined, 'no designation');
    eq(sandbox.lifecycleRefusal(model, 'Thing'), 'none', 'and the page says so plainly');
  });

  check('a status that was never an enum is left alone too', () => {
    const model = imported(envelope(
      [{ name: 'Thing', properties: [{ name: 'status', projection: 'ThingNote' }] }],
      [{ name: 'ThingNote', parameters: [{ name: 'thingId', propertyType: 'ThingId' }],
        valueType: 'string', isList: false, initialValue: null, handlers: [] }],
      []
    ));
    eq(model['entity-definitions'].Thing.lifecycle, undefined,
      'a string property named status is not a lifecycle');
  });

  check('a designation already present is never overwritten', () => {
    const model = imported(envelope(
      [{ name: 'Thing', lifecycle: 'status', properties: [{ name: 'status', projection: 'ThingStatus' }] }],
      [statusProjection('ThingStatus')], [enumType]
    ));
    eq(model['entity-definitions'].Thing.lifecycle, 'status', 'it came across as written');
  });
}

// ---------------------------------------------------------------
// What a change may do to a fold, and what it may set it to — offered
// per type rather than as one table for everything.
// ---------------------------------------------------------------
{
  const { operationsFor, hasSuccessor, offersSuccessor, handlerValueChoices } = sandbox;

  check('the operations offered follow the type held', () => {
    const { model } = build(0);
    eq(operationsFor(model(), { valueType: 'boolean', isList: false }), ['set'],
      'a boolean only ever becomes something — it does not go up by or gain');
    eq(operationsFor(model(), { valueType: 'CourseStatus', isList: false }), ['set'],
      'nor does an enum');
    eq(operationsFor(model(), { valueType: 'integer', isList: false }),
      ['set', 'increment', 'decrement'], 'an integer counts');
    eq(operationsFor(model(), { valueType: 'StudentId', isList: true }),
      ['set', 'append', 'remove'], 'and a list gains and loses');
  });

  check('the change adder offers only the operations the target admits', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    const painted = (entity, property) => {
      sandbox.state.adder = 'chg:StudentRegistered';
      sandbox.state.changeDraft = {
        eventName: 'StudentRegistered',
        target: JSON.stringify([entity, property]),
        operation: 'set', value: '',
      };
      const main = sandbox.document.createElement('div');
      main.appendChild(sandbox.changeAdder(model(), 'StudentRegistered'));
      return main;
    };
    // The reported bug: a boolean was offered every operation there is.
    const bool = textOf(painted('Student', 'exists'));
    eq(/goes up by|goes down by|gains|loses/.test(bool), false,
      'nothing an existence flag cannot do is on screen');
    eq(bool.includes('becomes'), true, 'only "becomes", and it is said rather than picked');

    const counted = painted('Student', 'subscriptionCount');
    const ops = findAll(counted, (n) => n.tag === 'select')
      .map((sel) => (sel.children || []).map(textOf).join('|'))
      .find((text) => text.includes('goes up by'));
    eq(!!ops, true, 'an integer still gets the picker, because it has a choice');
    sandbox.closeForms();
  });

  check('a boolean target offers true and false as values', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    sandbox.state.adder = 'chg:StudentRegistered';
    sandbox.state.changeDraft = {
      eventName: 'StudentRegistered',
      target: JSON.stringify(['Student', 'exists']),
      operation: 'set', value: '',
    };
    const main = sandbox.document.createElement('div');
    main.appendChild(sandbox.changeAdder(model(), 'StudentRegistered'));
    const text = textOf(main);
    eq(text.includes('true') && text.includes('false'), true, 'both are pickable');
    // Picked, they are the values themselves — the picker row is the
    // JSON, so it round-trips through `draftOperand` untouched.
    eq(sandbox.draftOperand({ value: 'true' }, 'value'), true, 'true parses to true');
    eq(sandbox.draftOperand({ value: 'false' }, 'value'), false, 'and false to false');
    sandbox.closeForms();
  });

  check('"the one after" is offered only where a next value exists', () => {
    const { model } = build(0);
    eq(hasSuccessor(model(), 'integer'), true, 'integers count up');
    eq(hasSuccessor(model(), 'CourseId'), true, 'and so do scalar identifiers');
    eq(hasSuccessor(model(), 'boolean'), false, 'there is no value after true');
    eq(hasSuccessor(model(), 'CourseStatus'), false, 'and an enum is a set, not a sequence');

    const event = { properties: [{ name: 'flag', propertyType: 'boolean', isList: false }] };
    const offered = handlerValueChoices(model(), { valueType: 'boolean', isList: false }, event, 'set')
      .map(([, label]) => label);
    eq(offered.includes('flag'), true, 'the event field is offered');
    eq(handlerValueChoices(model(), { valueType: 'boolean', isList: false }, event, 'set')
      .some(([v]) => v.includes('successor')), false,
      'so the editor does not propose what validation would then refuse');
    eq(offered.includes('true') && offered.includes('false'), true,
      'it proposes the two values instead');
  });

  // Narrower than validation on purpose: a successor numbers something,
  // so it is offered to `set` an integer or a named value type, never a
  // plain string, never beside another verb — and `currentValue`, which
  // only ever repeats or doubles what is held, is not offered at all.
  check('a successor is offered only to set a numbering, and currentValue never', () => {
    const { model } = build(0);
    eq(offersSuccessor(model(), 'integer'), true, 'an integer counts');
    eq(offersSuccessor(model(), 'CourseId'), true, 'and so does a named scalar type');
    eq(offersSuccessor(model(), 'string'), false, 'a plain string does not, digits or not');
    eq(hasSuccessor(model(), 'string'), true, 'though validation still accepts one');

    const event = { properties: [
      { name: 'title', propertyType: 'string', isList: false },
      { name: 'count', propertyType: 'integer', isList: false },
    ] };
    const values = (valueType, operation) =>
      handlerValueChoices(model(), { valueType, isList: false }, event, operation).map(([v]) => v);
    const next = JSON.stringify({ successor: { eventProperty: 'count' } });
    eq(values('integer', 'set').includes(next), true, 'set an integer: offered');
    eq(values('integer', 'increment').includes(next), false, 'increment by it: not');
    eq(values('string', 'set').some((v) => v.includes('successor')), false, 'set a string: not');
    for (const [type, op] of [['integer', 'set'], ['integer', 'increment'], ['string', 'set']]) {
      eq(values(type, op).some((v) => v.includes('currentValue')), false, `no currentValue for ${type} ${op}`);
    }
  });

  check('an event field reads as its path once picked', () => {
    const { model } = build(0);
    const event = { properties: [{ name: 'courseId', propertyType: 'CourseId', isList: false }] };
    const choices = handlerValueChoices(model(), { valueType: 'CourseId', isList: false }, event, 'set');
    const sel = sandbox.pick(choices, choices[1][0], () => {});
    const groups = findAll(sel, (n) => n.tag === 'optgroup');
    eq(groups.map((g) => g.label), ['event', 'successor'], 'one heading per kind, even for a single row');
    eq(findAll(groups[1], (n) => n.tag === 'option').map(textOf), ['successor(event.data.courseId)'],
      'the option text is the whole token, for type-ahead and the native fallback');
    eq(findAll(groups[1], (n) => n.className === 'ctx').map(textOf), ['successor(event.data.', ')'],
      'with the context in spans the open list hides');
    eq(sandbox.operandWords({ successor: { eventProperty: 'courseId' } }),
      'successor(event.data.courseId)', 'and the rendered operand says the same');
  });

  check('a successor the editor no longer offers is still refused if written', () => {
    const { id } = build(0);
    let refused = null;
    try {
      sandbox.updateDefinition('projection-definition', id, 'StudentExists', {
        parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
        valueType: 'boolean', isList: false, initialValue: false,
        handlers: [{ event: 'StudentRegistered', operation: 'set',
          value: { successor: { eventProperty: 'studentId' } } }],
      });
    } catch (error) { refused = error.message; }
    // The write path takes it (only structure refuses there); the
    // advisory is where it is said.
    const said = sandbox.modelAdvisories(sandbox.projectState()[id])
      .filter((a) => a.name === 'StudentExists');
    eq(refused !== null || said.length > 0, true,
      'the editor and the checker agree, whichever one gets there first');
  });
}

// ---------------------------------------------------------------
// `equalsAny` — the membership predicate across the pure UI layer.
// ---------------------------------------------------------------
{
  check('equalsAny is offered wherever equals is, and only for scalars', () => {
    eq(sandbox.predicatesForType({ propertyType: 'CourseStatus', isList: false }),
      ['equals', 'equalsAny'], 'identity types get both identity predicates');
    eq(sandbox.predicatesForType({ propertyType: 'string', isList: true }).includes('equalsAny'),
      false, 'a list left-hand side is not offered membership');
    eq(sandbox.rightHandExpectedType('equalsAny', { propertyType: 'CourseStatus', isList: false }),
      { propertyType: 'CourseStatus', isList: true }, 'the right side is a list of the left type');
  });

  check('an equalsAny rule reads as "is one of"', () => {
    const condition = {
      leftHandSide: { alias: 'course', property: 'status' },
      predicate: 'equalsAny',
      rightHandSide: [{ enumMember: 'Existent' }, 'x'],
    };
    eq(sandbox.conditionParts(condition).verb, 'is one of', 'the verb');
    eq(sandbox.conditionParts(condition).right, 'Existent, "x"', 'the entries, said in order');
    eq(sandbox.conditionParts({ ...condition, negate: true }).verb, 'is not one of', 'negated');
  });

  check('a touched, complete equalsAny rule is added by leaving it', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    sandbox.state.slice = 'DefineCourse';
    sandbox.state.adder = 'rule';
    const count = model()['command-definitions'].DefineCourse.conditions.length;
    sandbox.state.ruleDraft = {
      predicate: 'equalsAny', negate: false,
      left: JSON.stringify({ alias: 'course', property: 'status' }),
      right: '',
      rightEntries: [{ enumMember: 'NonExistent' }, { enumMember: 'Archived' }],
      touched: true,
    };
    sandbox.ruleEditor(model(), sandbox.sliceOf(model(), 'DefineCourse'), null);
    sandbox.closeForms();
    const conditions = model()['command-definitions'].DefineCourse.conditions;
    eq(conditions.length, count + 1, 'the rule landed without its button');
    eq(conditions[conditions.length - 1], {
      leftHandSide: { alias: 'course', property: 'status' },
      predicate: 'equalsAny',
      rightHandSide: [{ enumMember: 'NonExistent' }, { enumMember: 'Archived' }],
    }, 'the checked members, as the list');
  });
}

// ---------------------------------------------------------------
// The merged step. "To decide, it looks at" and "It is only allowed
// if" are one step, and the reason is a rule about ownership: a read
// is not something anyone declares. It arrives with the rule, guard,
// emission or chain that wanted it, and leaves with the last of them.
// These hold the seam where that is true — the write path — and the
// one gesture that now spans both halves.
// ---------------------------------------------------------------
{
  const { id, model } = build(3);   // Course Example (with schedules)
  store.set('dcb-playground:model', id);
  const command = (name) => model()['command-definitions'][name];

  check('the five reasons a read is consulted, on the shipped models', () => {
    const refs = sandbox.bindingReferences(model(), command('RescheduleCourse'));
    eq([...refs.get('theirs')], ['rule'], 'a read a rule is about');
    eq([...refs.get('students')], ['chain'],
      'an intermediate hop, wanted only so the next read can be reached');
    const numbering = sandbox.bindingReferences(model(), command('DefineCourse'));
    eq([...numbering.get('courseNumbering')], ['emission'],
      'a projection read whose value the event records, with no rule at all');
    // Coverage is the fifth reason, and it holds only for a *derived*
    // tag. `Assign`'s previous instructor is one: the `Unassigned` tag
    // is taken from `course.instructorId`, a claim about state that was
    // read. A tag straight off the payload asserts nothing about state
    // and keeps no read alive — which is why the shipped Unsubscribe no
    // longer binds the student it never tests.
    eq(command('UnsubscribeStudentFromCourse').boundary.map((b) => b.alias), ['course'],
      'the course only — the student id is asserted by the caller');
  });

  check('no shipped command reads anything nothing consults', () => {
    for (const [name, body] of Object.entries(model()['command-definitions'])) {
      eq(sandbox.unreferencedBindings(model(), body), [],
        `${name} binds only what something looks at`);
    }
  });

  check('deleting the last rule about a read deletes the read, in one append', () => {
    const before = command('RescheduleCourse');
    eq(before.boundary.map((b) => b.alias), ['course', 'students', 'theirs'],
      'three reads, chained');
    const ruleIndex = before.conditions
      .findIndex((c) => c.leftHandSide && c.leftHandSide.alias === 'theirs');
    const revisionBefore = sandbox.logRevisionNow();
    sandbox.state.slice = 'RescheduleCourse';
    sandbox.patch('command-definition', 'RescheduleCourse', (b) => { b.conditions.splice(ruleIndex, 1); });
    const after = command('RescheduleCourse');
    // `theirs` went because its only rule went; `students` went with it
    // because `theirs` was the only thing that wanted it. The cascade is
    // transitive, and it is one event, not three.
    eq(after.boundary.map((b) => b.alias), ['course'],
      'the read and the hop that only served it both went');
    eq(sandbox.logRevisionNow() - revisionBefore, 1, 'one gesture, one append');
  });

  check('a read with another reason survives its rule being dropped', () => {
    // `course` in SubscribeStudentToCourse is read by a rule *and* is
    // where `others` gets its identifier from. Losing the rule leaves
    // the chain, so the read stays.
    const body = command('SubscribeStudentToCourse');
    const index = body.conditions.findIndex((c) => c.leftHandSide
      && c.leftHandSide.alias === 'student' && c.leftHandSide.property === 'exists');
    eq(index >= 0, true, 'the rule about the student is there to drop');
    sandbox.patch('command-definition', 'SubscribeStudentToCourse', (b) => {
      b.conditions.splice(index, 1);
    });
    eq(command('SubscribeStudentToCourse').boundary.map((b) => b.alias).includes('student'), true,
      'the student stays: `others` takes its identifier from it');
  });
}

{
  const { id, model } = build(3);   // its own copy: this one strips a command down
  store.set('dcb-playground:model', id);
  const command = (name) => model()['command-definitions'][name];

  check('removing a read takes the rules about it, and leaves the chain to dangle', () => {
    // `course` is the root of this command's chain: `students` draws
    // its identifier from it, and `theirs` from `students`. Removing it
    // takes its own rule with it — a rule whose subject is gone is not
    // a rule — but not the reads below, which the author can see and
    // repoint. They dangle, and the Problems panel says so.
    const before = command('RescheduleCourse');
    eq(before.boundary.map((b) => b.alias), ['course', 'students', 'theirs'], 'three, chained');
    const rulesAboutCourse = before.conditions
      .filter((c) => c.leftHandSide && c.leftHandSide.alias === 'course').length;
    eq(rulesAboutCourse > 0, true, 'and a rule about the one being removed');
    sandbox.state.slice = 'RescheduleCourse';
    sandbox.patch('command-definition', 'RescheduleCourse', (b) => {
      b.boundary = b.boundary.filter((x) => x.alias !== 'course');
      b.conditions = b.conditions.filter((c) => !(c.leftHandSide && c.leftHandSide.alias === 'course'));
    });
    const after = command('RescheduleCourse');
    eq(after.boundary.map((b) => b.alias), ['students', 'theirs'],
      'the reads below it stay — deleting a subtree nobody pointed at would narrow the boundary');
    eq(after.conditions.length, before.conditions.length - rulesAboutCourse, 'its rules went with it');
    eq(sandbox.modelAdvisories(model()).some((a) => a.name === 'RescheduleCourse'), true,
      'and the dangling identifier is reported rather than repaired behind the author');
  });

}

{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);
  const command = (name) => model()['command-definitions'][name];

  check('a rule brings its read with it, in a single append', () => {
    const before = command('ChangeCourseCapacity');
    const revisionBefore = sandbox.logRevisionNow();
    sandbox.state.slice = 'ChangeCourseCapacity';
    sandbox.state.adder = 'rule';
    // The step-level adder, opened on a read that does not exist yet:
    // another Course, identified by the id the payload carries.
    sandbox.state.ruleDraft = {
      predicate: 'equals', negate: false, target: 'entity:Course', touched: true,
      left: JSON.stringify({ alias: 'course2', property: 'status' }),
      right: JSON.stringify({ enumMember: 'Existent' }),
    };
    sandbox.ruleEditor(model(), sandbox.sliceOf(model(), 'ChangeCourseCapacity'), null);
    sandbox.closeForms();
    const after = command('ChangeCourseCapacity');
    eq(after.boundary.length, before.boundary.length + 1, 'the read landed');
    eq(after.boundary[after.boundary.length - 1], {
      alias: 'course2', entity: 'Course', id: { parameterName: 'courseId' },
    }, 'aliased apart from the course already bound, identified as picked');
    eq(after.conditions.length, before.conditions.length + 1, 'and the rule that wanted it');
    eq(sandbox.logRevisionNow() - revisionBefore, 1,
      'one append — a read stored without its rule would be pruned by its own write');
  });

  check('a read arriving from outside is reported, not silently dropped', () => {
    // What an agent writing a whole body, or a hand-written file, can
    // still produce. It bounds the append, so it stays until someone
    // edits this command — and says so meanwhile.
    sandbox.addDefinition('command-definition', id, 'TouchCourse', {
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
      boundary: [
        { alias: 'course', entity: 'Course', id: { parameterName: 'courseId' } },
        // A projection read: no rule names it, no emission takes its
        // value, and coverage has nothing to say about it — the one
        // shape of read that really is consulted by nothing.
        { alias: 'spare', projection: 'CourseCapacity', arguments: { courseId: { parameterName: 'courseId' } } },
      ],
      conditions: [{
        leftHandSide: { alias: 'course', property: 'status' },
        predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
      }],
      publishes: [{ name: 'CourseDefined', parameters: { courseId: { parameterName: 'courseId' } } }],
    });
    eq(command('TouchCourse').boundary.map((b) => b.alias), ['course', 'spare'],
      'added whole, kept whole — nothing is pruned on the way in');
    const advisory = sandbox.modelAdvisories(model())
      .find((a) => a.name === 'TouchCourse' && /nothing consults/.test(a.message));
    eq(!!advisory, true, 'and the Problems panel says which read that is');
    eq(/spare/.test(advisory.message), true, 'naming it');
    // The next edit is what drops it, which is what the advisory promised.
    sandbox.patch('command-definition', 'TouchCourse', (b) => { b.icon = '👆'; });
    eq(command('TouchCourse').boundary.map((b) => b.alias), ['course'],
      'the next edit removes it');
  });
}

// ---------------------------------------------------------------
// The rule wizard, end to end. A rule spans what used to be two steps,
// and asking all of it at once put five pickers in one row — so it is
// staged: what it is about, which of its values, what must be true.
// This drives the three questions the way a person does, and rebuilds
// a shipped command from an empty boundary to prove the merged step
// can still author everything the old two could.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);
  const cmd = () => model()['command-definitions'].SubscribeStudentToCourse;
  const shipped = JSON.parse(JSON.stringify(cmd()));
  const slice = () => sandbox.sliceOf(model(), 'SubscribeStudentToCourse');

  // Answering advances; there is no Next to press. So this drives the
  // selects themselves — a stage that stopped revealing the next one
  // fails here rather than passing quietly, because the control it
  // needs would never be on screen.
  // `target` names a read the command does not have yet — the step's own
  // "+ rule" wizard. `onAlias` is the other door: the "+ rule about …"
  // button on a read's card, which knows the first answer already and
  // opens on the second question.
  const addRule = ({ target, onAlias, left, existence, predicate, right, rightText, negate }) => {
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = {
      predicate: 'equals', negate: false, left: '', right: '', ...(onAlias ? { onAlias } : {}),
    };
    const paint = () => sandbox.stepDecision(model(), slice());
    const selects = () => findAll(paint(), (n) => n.tag === 'select');
    const draft = () => sandbox.state.ruleDraft;
    const valueQuestion = () => {
      const step = paint();
      eq(/Which of its values\?/.test(textOf(step)), true, 'the second question is on screen');
      // The property picker is the last control of the second question;
      // the third question's own pickers come after it only once it is
      // answered, which it is not yet.
      const all = findAll(step, (n) => n.tag === 'select');
      return all[all.length - 1];
    };

    if (target) {
      // Nothing is pre-picked, or the row would answer its own first
      // question and put every control on screen at once.
      eq(draft().target || '', '', 'the first question opens unanswered');
      eq(selects().length, 1, 'and it is the only one on screen');
      selects()[0].onchange({ target: { value: target } });
    }
    if (existence) {
      // An existence row answers the third question with the second, so
      // it is never asked — the button is already there.
      valueQuestion().onchange({ target: { value: ' ' + existence + ':' + left } });
      eq(/What must be true of it\?/.test(textOf(paint())), false,
        'existence picked: no third question');
    } else {
      valueQuestion().onchange({ target: { value: left } });
      eq(/What must be true of it\?/.test(textOf(paint())), true,
        'answering that revealed the third question — no Next was pressed');
      draft().predicate = predicate;
    }
    if (negate) draft().negate = true;
    if (right !== undefined) draft().right = right;
    if (rightText !== undefined) { draft().right = ' literal'; draft().rightText = rightText; }
    paint();
    const button = findAll(paint(), (n) => n.tag === 'button' && textOf(n) === 'Add rule')[0];
    if (!button) throw new Error('no "Add rule" button on screen');
    button.onclick();
  };

  check('the first question is asked on its own — two pickers, not five', () => {
    sandbox.state.slice = 'SubscribeStudentToCourse';
    sandbox.updateDefinition('command-definition', id, 'SubscribeStudentToCourse', {
      ...cmd(), boundary: [], conditions: [],
    });
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '' };
    const step = sandbox.stepDecision(model(), slice());
    eq(findAll(step, (n) => n.tag === 'select').length, 1,
      'one question, unanswered — nothing else is on screen yet');
    eq(/What is this rule about\?/.test(textOf(step)), true, 'asked as a question');
    // Answering it is what reveals the next: the row never asks for a
    // Next to be pressed.
    findAll(step, (n) => n.tag === 'select')[0].onchange({ target: { value: 'entity:Course' } });
    const after = sandbox.stepDecision(model(), slice());
    eq(findAll(after, (n) => n.tag === 'select').length, 3,
      'what it is about, where its id comes from, and which of its values');
    sandbox.closeForms();
  });

  check('a command is authored through the wizard, rule for rule', () => {
    const A = (alias, property) => JSON.stringify({ alias, property });
    // Two rules that each bring a read with them, then three more about
    // reads that already exist — including one whose two sides are the
    // same read, and one compared against a number nobody declared.
    addRule({ target: 'entity:Course', left: A('course', 'status'),
      predicate: 'equals', right: JSON.stringify({ enumMember: 'Existent' }) });
    // A boolean lifecycle: "exists" is a row of the second question,
    // and picking it is the whole rule.
    addRule({ target: 'entity:Student', left: A('student', 'exists'), existence: 'exists' });
    addRule({ onAlias: 'course', left: A('course', 'subscriptionCount'),
      predicate: 'lessThan', right: A('course', 'capacity') });
    addRule({ onAlias: 'course', left: A('course', 'subscribedStudentIds'),
      predicate: 'contains', right: JSON.stringify({ parameterName: 'studentId' }), negate: true });
    addRule({ onAlias: 'student', left: A('student', 'subscriptionCount'),
      predicate: 'lessThan', rightText: '10' });

    eq(cmd().boundary, shipped.boundary,
      'the reads the rules brought with them are the reads the model ships');
    eq(cmd().conditions, shipped.conditions, 'and so are the rules, in order');
  });

  check('existence is two rows of the value question, not a property and a predicate', () => {
    const A = (alias, property) => JSON.stringify({ alias, property });
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '', onAlias: 'student' };
    const picker = () => findAll(sandbox.stepDecision(model(), slice()), (n) => n.tag === 'select')[0];
    const values = findAll(picker(), (n) => n.tag === 'option').map((o) => o.value);
    eq(values.includes(' exists:' + A('student', 'exists')), true, 'the present state is offered');
    eq(values.includes(' absent:' + A('student', 'exists')), true, 'and the absent one');
    eq(/does not exist/.test(textOf(picker())), true, 'said as a state');
    eq(values.includes(A('student', 'exists')), false,
      'and the bare property is not, so there is no "not … is true" to assemble');
    picker().onchange({ target: { value: ' absent:' + A('student', 'exists') } });
    eq(sandbox.state.ruleDraft.predicate, 'isFalse', '"does not exist" is isFalse');
    eq(!!sandbox.state.ruleDraft.negate, false, 'never a negated isTrue');
    sandbox.closeForms();

    // Opened for editing, another spelling of the same thing keeps its
    // own row and the third question — it is shown as stored.
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = {
      predicate: 'isTrue', negate: true, left: A('student', 'exists'), right: '', onAlias: 'student',
    };
    const step = sandbox.stepDecision(model(), slice());
    eq(/What must be true of it\?/.test(textOf(step)), true, 'a negated isTrue opens whole');
    sandbox.closeForms();
  });
}

// ---------------------------------------------------------------
// A model with no entity at all states its rules over projections: the
// first question offers one this command can supply the arguments of,
// and the read it brings is the plain `read label = Label(documentId)`.
// ---------------------------------------------------------------
{
  const id = sandbox.createDcbModel('Entity Free Probe');
  store.set('dcb-playground:model', id);
  sandbox.applyModelSource(id, [
    'model "Entity Free Probe"',
    'tag type DocumentId = string',
    'tag type FolderId = string',
    'event Labelled { documentId: DocumentId, label: string }',
    'event Done { documentId: DocumentId }',
    'projection Label(documentId: DocumentId): string = "" {',
    '  on Labelled => set event.data.label',
    '}',
    'projection DoneCount: integer = 0 {',
    '  on Done => increment 1',
    '}',
    'projection FolderSize(folderId: FolderId): integer = 0 {}',
    'command Finish(documentId: DocumentId) {',
    '  emit Done { documentId }',
    '}',
  ].join('\n'));
  const model = () => projectState()[id];
  const slice = () => sandbox.sliceOf(model(), 'Finish');
  const paint = () => sandbox.stepDecision(model(), slice());
  const selects = () => findAll(paint(), (n) => n.tag === 'select');

  check('with no entity, the first question offers the projections it can reach', () => {
    sandbox.state.slice = 'Finish';
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '' };
    const values = findAll(selects()[0], (n) => n.tag === 'option').map((n) => n.value);
    eq(values.includes('projection:Label'), true, 'its argument is the payload\'s document id');
    eq(values.includes('projection:DoneCount'), true, 'no parameters: the whole log');
    eq(values.includes('projection:FolderSize'), false, 'nothing here carries a FolderId');
    sandbox.closeForms();
  });

  check('a rule about a projection is written through the same three questions', () => {
    sandbox.state.slice = 'Finish';
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '' };
    selects()[0].onchange({ target: { value: 'projection:Label' } });
    // The argument is picked for it, and a projection has one value, so
    // the second question has answered itself.
    eq(/What must be true of it\?/.test(textOf(paint())), true, 'straight to the test');
    eq(/Which of its values\?/.test(textOf(paint())), false, 'one value: the question is not asked');
    sandbox.state.ruleDraft.right = ' literal';
    sandbox.state.ruleDraft.rightText = 'foo';
    const button = findAll(paint(), (n) => n.tag === 'button' && textOf(n) === 'Add rule')[0];
    button.onclick();
    const body = model()['command-definitions'].Finish;
    eq(body.boundary, [{ alias: 'label', projection: 'Label', arguments: { documentId: { parameterName: 'documentId' } } }],
      'the read it brought');
    eq(body.conditions, [{ leftHandSide: { alias: 'label' }, predicate: 'equals', rightHandSide: 'foo' }],
      'and the rule about it');
    eq(sandbox.modelAdvisories(model()).length, 0, 'advisory-clean');
  });

  check('a projection read is never asked which of its values — from its card, or reopened', () => {
    sandbox.state.slice = 'Finish';
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '', onAlias: 'label' };
    eq(/Which of its values\?/.test(textOf(paint())), false, '"+ rule about label"');
    eq(/What must be true of it\?/.test(textOf(paint())), true, 'opens on the test');
    sandbox.closeForms();

    // Reopened, the picker would list every read's values — the rule
    // is about the one it names.
    sandbox.state.editRule = 0;
    sandbox.state.ruleDraft = {
      predicate: 'equals', negate: false, left: JSON.stringify({ alias: 'label' }), right: ' literal', rightText: 'foo',
    };
    eq(/Which of its values\?/.test(textOf(paint())), false, 'an existing rule, opened');
    eq(/What must be true of it\?/.test(textOf(paint())), true, 'opens whole otherwise');
    sandbox.closeForms();
  });
}

{
  const { id, model } = build(0);   // its own copy: this one strips an entity down
  store.set('dcb-playground:model', id);
  const slice = () => sandbox.sliceOf(model(), 'SubscribeStudentToCourse');

  // The bug this guards: what is on screen is derived from what has
  // been answered, never accumulated by the act of answering. Gate a
  // question on a change event instead, and an entity with exactly one
  // property deadlocks — its only property is filled in for you, so a
  // `<select>` already showing it fires nothing when you pick it, and
  // there is no event left to advance on.
  check('an entity with one property does not strand the wizard', () => {
    sandbox.updateDefinition('entity-definition', id, 'Student', {
      properties: [{ name: 'subscriptionCount', projection: 'StudentSubscriptionCount' }],
    });
    sandbox.state.slice = 'SubscribeStudentToCourse';
    sandbox.state.adder = 'rule';
    sandbox.state.ruleDraft = { predicate: 'equals', negate: false, left: '', right: '' };
    const paint = () => sandbox.stepDecision(model(), slice());
    paint();
    findAll(paint(), (n) => n.tag === 'select')[0]
      .onchange({ target: { value: 'entity:Student' } });
    const step = paint();
    // The only property is the answer, so the question after it is
    // already there — no second pick, and nothing to get stuck on.
    // `student2`, because this command already reads a student — the
    // picker offered "another Student…", which is a different instance.
    eq(sandbox.state.ruleDraft.left,
      JSON.stringify({ alias: 'student2', property: 'subscriptionCount' }),
      'its one property answered the second question by itself');
    eq(/What must be true of it\?/.test(textOf(step)), true,
      'so the third question is on screen without another event');
    eq(findAll(step, (n) => n.tag === 'button').some((b) => textOf(b) === 'Add rule'), true,
      'and the rule can actually be written');
    sandbox.closeForms();
  });

}

// ---------------------------------------------------------------
// The pages the lifecycle change added or reshaped, actually painted.
//
// Everything above tests the derivation. These paint it, because a
// render path that throws takes the whole page with it and nothing
// else here would notice.
// ---------------------------------------------------------------
{
  const { readable } = sandbox;
  const has = (text, part, why) =>
    eq(text.includes(part), true, why + ' — expected the page to contain: ' + part);

  const paint = (view, model, before) => {
    const main = sandbox.document.createElement('div');
    sandbox.state.view = view;
    if (before) before();
    if (view === 'lifecycles') sandbox.renderLifecycles(model, main);
    else sandbox.renderEntity(model, main);
    return textOf(main);
  };

  for (const [index, slug] of [[0, 'course-simple'], [4, 'pricing-simple'],
    [5, 'content-decisions-scripted'], [2, 'course-tenant']]) {
    check(`${slug} paints its Lifecycles page`, () => {
      const { model } = build(index);
      store.set('dcb-playground:model', model().id);
      const text = paint('lifecycles', model());
      eq(text.length > 0, true, 'something was drawn');
      const { machines, excluded } = sandbox.lifecycleMachines(model());
      for (const machine of machines) {
        has(text, readable(machine.entity), `${machine.entity} is on the page`);
      }
      for (const e of excluded) {
        has(text, readable(e.entity), `${e.entity} is said to be missing, not dropped`);
      }
    });
  }

  check('a boolean machine is drawn compactly and an enum one is not', () => {
    const { model } = build(0);
    store.set('dcb-playground:model', model().id);
    const text = paint('lifecycles', model());
    has(text, 'Existence only', 'the two weights are separated');
    has(text, 'Student registered', 'and a boolean machine names what brings one into being');
  });

  check('an entity page paints its lifecycle in Identity, not the ledger', () => {
    const { model } = build(0);
    store.set('dcb-playground:model', model().id);
    sandbox.state.lcOpen = {};
    const text = paint('entity', model(), () => { sandbox.state.entity = 'Student'; });
    has(text, 'identified by', 'the Identity row is there');
    // Folded by default: the lifecycle rides on the identifier line, in
    // words, and the track is one click away.
    has(text, 'state exists · set by Student registered', 'folded onto the identifier line');
    eq(text.includes('stateexists'), false, 'with no state row of its own yet');
    // The chip is the property in every branch — it used to be the
    // setters when there were any, which left the empty case naming
    // itself twice.
    const open = paint('entity', model(), () => { sandbox.state.lcOpen = { Student: true }; });
    has(open, 'stateexists', 'opened, the state row names the property');
    has(open, 'Student registered', 'with what moves it drawn on the arrow');
    eq(open.includes('exists once'), false, 'and no longer says the same word twice');
    eq(/What we know about each one[\s\S]*exists/.test(open), false,
      'and `exists` is not also a property row');
    sandbox.state.lcOpen = {};
  });

  check('an enum lifecycle folds to its state count', () => {
    const { model } = build(0);
    store.set('dcb-playground:model', model().id);
    sandbox.state.lcOpen = {};
    const text = paint('entity', model(), () => { sandbox.state.entity = 'Course'; });
    has(text, 'state status · 3 states', 'counted, not listed');
    eq(text.includes('Archived'), false, 'the states wait for the row');
  });

  check('a lifecycle nothing sets still says so, folded', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    const fold = sandbox.lifecycleOf(model(), 'Student').projectionName;
    const body = sandbox.deepClone(model()['projection-definitions'][fold]);
    body.handlers = [];
    updateDefinition('projection-definition', id, fold, body);
    sandbox.state.lcOpen = {};
    const text = paint('entity', model(), () => { sandbox.state.entity = 'Student'; });
    // It is only there because somebody added it, so nothing hides it:
    // `set by —` is the next step, not noise.
    has(text, 'state exists · set by —', 'on the identifier line');
    eq(text.includes('+ lifecycle'), false, 'and no offer to add another');
  });

  check('an entity with no lifecycle offers one and says nothing else about state', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    sandbox.createEntity(model(), 'room');
    sandbox.state.lcMenu = null;
    const text = paint('entity', model(), () => { sandbox.state.entity = 'Room'; });
    has(text, '+ lifecycle', 'the one way to add one');
    eq(/not designated|exists/.test(text), false, 'and no word about existence');
    const open = paint('entity', model(), () => { sandbox.state.lcMenu = 'lc+:Room'; });
    has(open, 'Exists (boolean)', 'the one-click boolean');
    has(open, 'Named states (enum)…', 'the enum');
    eq(open.includes('Existing property…'), false, 'and no designation with nothing to designate');
    sandbox.state.lcMenu = null;
  });

  check('an enum lifecycle named from nothing needs only two states', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    sandbox.createEntity(model(), 'room');
    const text = paint('entity', model(), () => {
      sandbox.state.entity = 'Room';
      sandbox.state.promoting = 'Room';
      sandbox.state.promoteDraft = sandbox.scratchLifecycleDraft('Room');
    });
    has(text, 'Name its states', 'the form opens in its own mode');
    sandbox.closeForms();
    eq(sandbox.mergeIntoLifecycle(model(), 'Room', {
      typeName: 'RoomStatus', property: 'status', initialState: 'Draft',
      steps: [{ from: null, state: 'Published' }],
    }), 'status', 'two states are enough');
    const lifecycle = sandbox.lifecycleOf(model(), 'Room');
    eq(lifecycle.isBoolean, false, 'an enum');
    eq(lifecycle.states, ['Draft', 'Published'], 'with the states as named');
    eq(model()['projection-definitions'].RoomStatus.handlers, [], 'and nothing moving it yet');
    // Promoting a boolean still wants three: two would be the boolean
    // again, with vocabulary.
    eq(sandbox.mergeIntoLifecycle(model(), 'Student', {
      typeName: 'StudentPhase', property: 'phase', initialState: 'Out',
      steps: [{ from: 'exists', state: 'In' }],
    }), undefined, 'a boolean promoted to two states is refused');
    eq(sandbox.lifecycleOf(model(), 'Student').property, 'exists', 'and nothing changed');
  });

  check('an enum lifecycle cannot reuse a property name the entity has', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    sandbox.createEntity(model(), 'room');
    sandbox.addExistenceLifecycle(model(), 'Room');
    sandbox.removeLifecycle(model(), 'Room');
    eq(sandbox.mergeIntoLifecycle(model(), 'Room', {
      typeName: 'RoomPhase', property: 'exists', initialState: 'A', steps: [{ from: null, state: 'B' }],
    }), undefined, 'refused');
    eq('RoomPhase' in model()['custom-type-definitions'], false, 'before anything was written');
  });

  check('the inline track gives up on anything that is not a chain', () => {
    const chain = {
      isBoolean: false, states: ['Draft', 'Live', 'Gone'], initial: 'Draft',
      opaque: [], terminal: ['Gone'],
      transitions: [
        { event: 'Published', target: 'Live', sources: ['Draft'] },
        { event: 'Removed', target: 'Gone', sources: ['Live'] },
      ],
    };
    eq(!!sandbox.lifecycleTrack(chain), true, 'a chain draws');
    eq(sandbox.lifecycleTrack({ ...chain, states: [...chain.states, 'Revived'] }), null,
      'a fourth state does not');
    eq(sandbox.lifecycleTrack({ ...chain, opaque: ['Recomputed'] }), null,
      'nor one with a handler this cannot read');
    eq(sandbox.lifecycleTrack({
      ...chain,
      transitions: [...chain.transitions, { event: 'Restored', target: 'Live', sources: ['Gone'] }],
    }), null, 'nor a way back');
    eq(sandbox.lifecycleTrack({
      ...chain,
      transitions: [...chain.transitions, { event: 'Dropped', target: 'Gone', sources: ['Draft'] }],
    }), null, 'nor a jump the chain would have hidden');
  });

  check('the promotion form paints for a boolean lifecycle', () => {
    const { model } = build(0);
    store.set('dcb-playground:model', model().id);
    const text = paint('entity', model(), () => {
      sandbox.state.entity = 'Student';
      sandbox.state.promoting = 'Student';
    });
    has(text, 'Give it more than two states', 'the form is open');
    has(text, '— none —', 'a state with no boolean behind it is expressible');
    has(text, 'the enum these states belong to', 'and naming is what it asks for');
    sandbox.closeForms();
  });

  check('the merge form can drop a boolean and reorder the stages', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    for (const [prop, event, fold] of [['registered', 'DidRegister', 'DidRegisterFold'],
      ['expelled', 'WasExpelled', 'WasExpelledFold']]) {
      addDefinition('event-definition', id, event, {
        properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
      });
      addDefinition('projection-definition', id, fold, {
        parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
        valueType: 'boolean', isList: false, initialValue: false,
        handlers: [{ event, operation: 'set', value: true }],
      });
      const body = sandbox.deepClone(model()['entity-definitions'].Student);
      body.properties.push({ name: prop, projection: fold });
      updateDefinition('entity-definition', id, 'Student', body);
    }
    eq(sandbox.entityMergeCandidates(model(), 'Student'), ['exists', 'registered', 'expelled'],
      'all three are one-way');

    // Absorb only two of the three, in an order the offer would not have
    // proposed — `exists` stays an ordinary property.
    sandbox.mergeIntoLifecycle(model(), 'Student', {
      typeName: 'StudentStatus', property: 'status', initialState: 'Prospective',
      steps: [{ state: 'Registered', from: 'registered' }, { state: 'Expelled', from: 'expelled' }],
    });
    const after = model()['entity-definitions'].Student;
    eq(after.lifecycle, 'status', 'the merged property is designated');
    eq(after.properties.some((p) => p.name === 'exists'), true,
      'the boolean left out stays as its own property');
    eq(model()['projection-definitions'].StudentExists !== undefined, true,
      'and so does its fold');
    eq(model()['custom-type-definitions'].StudentStatus.schema.enum,
      ['Prospective', 'Registered', 'Expelled'], 'in the order the steps were given');
  });

  check('the designation picker offers only properties with states', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    eq(sandbox.lifecycleCandidates(model(), 'Student'), ['exists'],
      'a count is not a lifecycle; a boolean is');
    eq(sandbox.lifecycleCandidates(model(), 'Course'), ['status'],
      'an enum property is offered too');
    const text = paint('entity', model(), () => {
      sandbox.state.entity = 'Student';
      sandbox.state.designating = 'Student';
    });
    has(text, 'the state is', 'the picker is open');
    has(text, '— none —', 'and un-designating is possible wherever designating is');
    sandbox.closeForms();
  });

  check('designating a different property moves the lifecycle', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    // A hand-built state property, which is the case the picker exists
    // for: nothing about it came from the scaffold or a promotion.
    addDefinition('custom-type-definition', id, 'Standing',
      { schema: { type: 'string', enum: ['Unknown', 'Good', 'Poor'] } });
    addDefinition('projection-definition', id, 'StudentStanding', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'Standing', isList: false, initialValue: { enumMember: 'Unknown' },
      handlers: [{ event: 'StudentRegistered', operation: 'set', value: { enumMember: 'Good' } }],
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'standing', projection: 'StudentStanding' });
    updateDefinition('entity-definition', id, 'Student', student);
    eq(sandbox.lifecycleCandidates(model(), 'Student'), ['exists', 'standing'], 'both eligible');

    const moved = sandbox.deepClone(model()['entity-definitions'].Student);
    moved.lifecycle = 'standing';
    updateDefinition('entity-definition', id, 'Student', moved);
    const lifecycle = sandbox.lifecycleOf(model(), 'Student');
    eq(lifecycle.property, 'standing', 'the designation moved');
    eq(lifecycle.isBoolean, false, 'to an enum');
    eq(lifecycle.states, ['Unknown', 'Good', 'Poor'], 'with its own states');
    eq(sandbox.modelAdvisories(model()).filter((a) => a.name === 'Student'), [],
      'and nothing complains — `exists` is now an ordinary property');
  });

  check('un-designating leaves an entity with no lifecycle, which is allowed', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    const body = sandbox.deepClone(model()['entity-definitions'].Student);
    delete body.lifecycle;
    updateDefinition('entity-definition', id, 'Student', body);
    eq(sandbox.lifecycleOf(model(), 'Student'), null, 'none resolves');
    eq(sandbox.lifecycleRefusal(model(), 'Student'), 'none', 'and that is the reason given');
    eq(sandbox.modelAdvisories(model()).filter((a) => a.name === 'Student'), [],
      'no advisory — an entity need not have one');
    const text = paint('entity', model(), () => { sandbox.state.entity = 'Student'; });
    has(text, '+ lifecycle', 'the page offers one back');
    eq(text.includes('not designated'), false, 'rather than calling the absence a fault');
    const open = paint('entity', model(), () => { sandbox.state.lcMenu = 'lc+:Student'; });
    has(open, 'Exists (boolean)', 'which would designate the `exists` still there');
    has(open, 'Existing property…', 'beside the picker for it');
    sandbox.state.lcMenu = null;
  });

  check('the entity page offers the merge where the booleans are', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    addDefinition('event-definition', id, 'StudentExpelled2', {
      properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'StudentExpelled2Fold', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'StudentExpelled2', operation: 'set', value: true }],
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'expelled', projection: 'StudentExpelled2Fold' });
    updateDefinition('entity-definition', id, 'Student', student);
    // No command guards either of them, so the rule wizard would never
    // get the chance — this is the surface that does.
    const text = paint('entity', model(), () => { sandbox.state.entity = 'Student'; });
    has(text, 'exists, expelled never go back', 'the offer names both booleans, and why');
    has(text, 'Merge', 'and offers to take them');
  });

  check('the merge prompt paints in the decide step', () => {
    const { id, model } = build(0);
    store.set('dcb-playground:model', id);
    addDefinition('event-definition', id, 'StudentSuspended', {
      properties: [{ name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'StudentSuspension', {
      parameters: [{ name: 'studentId', propertyType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'StudentSuspended', operation: 'set', value: true }],
    });
    const student = sandbox.deepClone(model()['entity-definitions'].Student);
    student.properties.push({ name: 'isSuspended', projection: 'StudentSuspension' });
    updateDefinition('entity-definition', id, 'Student', student);
    const body = sandbox.deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    body.conditions.push({
      leftHandSide: { alias: 'student', property: 'isSuspended' }, predicate: 'isFalse',
    });
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', body);

    const main = sandbox.document.createElement('div');
    sandbox.state.slice = 'SubscribeStudentToCourse';
    main.appendChild(sandbox.stepDecision(model(), sandbox.sliceOf(model(), 'SubscribeStudentToCourse')));
    const text = textOf(main);
    has(text, 'stages of one life', 'the offer is made where the rule was written');
    has(text, 'Give Student a lifecycle instead', 'with a way to take it');
  });
}

// ---------------------------------------------------------------
// Rules reorder by drag, within the card of the read they are about.
// Order is meaning — the first failing rule is the refusal — so the
// drop rewrites `conditions`, and only among one alias's rules.
// ---------------------------------------------------------------
{
  check('moveAgainst lands an entry against either edge of another', () => {
    const move = (from, to, before) => {
      const list = ['a', 'b', 'c', 'd'];
      const at = sandbox.moveAgainst(list, from, to, before);
      return list.join('') + at;
    };
    eq(move(3, 0, true), 'dabc0', 'up, before');
    eq(move(0, 2, false), 'bcad2', 'down, after');
    eq(move(0, 2, true), 'bacd1', 'down, before');
    eq(move(2, 0, false), 'acbd1', 'up, after');
  });

  const { id, model } = build(0);
  store.set('dcb-playground:model', id);
  const command = 'SubscribeStudentToCourse';
  const lefts = () => model()['command-definitions'][command].conditions
    .map((c) => c.leftHandSide.alias + '.' + c.leftHandSide.property);
  const rows = () => {
    sandbox.state.slice = command;
    const step = sandbox.stepDecision(model(), sandbox.sliceOf(model(), command));
    return findAll(step, (n) => /\brule-row\b/.test(n.className || ''));
  };

  // A drag, as the pointer would make it: the grip on rule `from`,
  // released over the lower half of rule `to` (or the upper half,
  // `before`). `elementFromPoint` answers with the row under the
  // pointer, the way the browser would.
  const drag = (from, to, before) => {
    const all = rows();
    const at = (i) => all.find((n) => n.attributes['data-rule'] === i);
    const grip = findAll(at(from), (n) => /\bgrip\b/.test(n.className || ''))[0];
    const target = at(to);
    const row = target && {
      getAttribute: (k) => String(target.attributes[k]),
      getBoundingClientRect: () => ({ top: 0, height: 10 }),
      classList: { add() {}, remove() {}, toggle() {} },
    };
    const sameCard = target && target.attributes['data-rule-alias'] === at(from).attributes['data-rule-alias'];
    sandbox.CSS = { escape: (s) => s };
    sandbox.document.elementFromPoint = () => ({ closest: () => (sameCard ? row : null) });
    const e = {
      button: 0, pointerId: 1, clientX: 0, clientY: before ? 2 : 8,
      preventDefault() {}, stopPropagation() {},
      currentTarget: { setPointerCapture() {}, closest: () => ({ classList: { add() {}, remove() {} } }) },
    };
    grip.onpointerdown(e);
    grip.onpointermove(e);
    grip.onpointerup(e);
  };

  check('every rule sharing a card carries a grip', () => {
    const all = rows();
    eq(all.length, 5, 'three about the course, two about the student');
    eq(all.every((n) => findAll(n, (m) => /\bgrip\b/.test(m.className || '')).length === 1), true,
      'one grip each');
    eq(all.map((n) => n.attributes['data-rule-alias']),
      ['course', 'course', 'course', 'student', 'student'], 'each names the card it moves within');
  });

  check('dropping a rule above another moves it there in conditions', () => {
    const [first, second, third] = lefts().filter((l) => l.startsWith('course.'));
    sandbox.state.sel = 'rule:3';
    drag(3, 0, true);
    eq(lefts().filter((l) => l.startsWith('course.')), [third, first, second],
      'the course rules in their new order');
    eq(lefts().filter((l) => l.startsWith('student.')).length, 2, 'the student rules untouched');
    eq(sandbox.state.sel, 'rule:0', 'the open row follows the rule it showed');
  });

  check('a drop onto another card\'s rule does nothing', () => {
    const before = lefts();
    drag(0, 1, true);
    eq(lefts(), before, 'conditions unchanged');
  });
}

// ---------------------------------------------------------------
// A folded scenario card unfolds from anywhere on its row — not only
// from its name — and not from the actions at its right.
// ---------------------------------------------------------------
{
  const { id, model } = build(0);
  store.set('dcb-playground:model', id);
  // Nothing has happened, so the subscription is refused — any
  // scenario will do; what is under test is its row.
  const scenario = {
    command: 'SubscribeStudentToCourse', given: [],
    when: { arguments: { courseId: 'c1', studentId: 's1' } },
  };
  addDefinition('scenario-definition', id, 'row-toggle',
    { ...scenario, then: sandbox.deriveThen(model(), scenario) });
  const entry = { key: 'row-toggle', body: model()['scenario-definitions']['row-toggle'] };
  const head = () => sandbox.scenarioRow(model(), entry).children[0];
  const clickOn = (inReveal) => head().onclick({ target: { closest: () => inReveal } });

  check('the whole row toggles a scenario open and shut', () => {
    sandbox.state.openScenarios.clear();
    clickOn(null);
    eq(sandbox.state.openScenarios.has(entry.key), true, 'unfolded by a click beside the name');
    clickOn(null);
    eq(sandbox.state.openScenarios.has(entry.key), false, 'and folded again');
  });

  check('a click among the row\'s actions is not a click on the row', () => {
    clickOn({});
    eq(sandbox.state.openScenarios.has(entry.key), false, 'Edit and the grip leave it folded');
  });
}

// ---------------------------------------------------------------
// The overview a model opens on: read-only, a row per command, the
// stored name and payload kept out of the text and in the tooltip.
// ---------------------------------------------------------------
{
  const { id, model } = build(3);
  store.set('dcb-playground:model', id);

  const paint = () => {
    const main = sandbox.document.createElement('div');
    sandbox.renderOverview(model(), main);
    return main;
  };

  check('the overview names every command, humanized, and what it reads and appends', () => {
    eq(model().name, 'Course Example (with schedules)', 'the example these expectations are about');
    const text = textOf(paint());
    for (const name of Object.keys(model()['command-definitions'])) {
      eq(text.includes(sandbox.readable(name)), true, 'shows ' + name);
    }
    eq(text.includes('SubscribeStudentToCourse'), false, 'the stored name is not on the page');
    eq(text.includes('Student subscribed to course'), true, 'the event it appends');
    eq(text.includes('others'), true, 'an alias that says more than the entity name');
    eq(text.includes('always allowed'), true, 'DefineCourse has no rules');
    eq(text.includes('6 rules'), true, 'SubscribeStudentToCourse has six');
  });

  check('a command row carries its stored name and payload in the tooltip', () => {
    const links = findAll(paint(), (n) => n.className === 'overview-cmd');
    eq(links.length, Object.keys(model()['command-definitions']).length, 'one link per command');
    const define = links.find((n) => (n.attributes.title || '').startsWith('DefineCourse'));
    eq(define.attributes.title, 'DefineCourse\ncapacity: integer\nslots: TimeSlot[]', 'name, then payload');
  });

  check('opening a model lands on the overview; an empty one on the slice page', () => {
    sandbox.switchToModel(id);
    eq(sandbox.state.view, 'overview', 'a model with commands');
    sandbox.render();
    eq(sandbox.state.view, 'overview', 'and stays there once painted');
    const empty = sandbox.createDcbModel('Overview Probe');
    sandbox.switchToModel(empty);
    sandbox.render();
    eq(sandbox.state.view, 'slice', 'nothing to give an overview of');
  });
}

// ---------------------------------------------------------------
// The event model: an order derived along the lifecycles, event lanes
// by tag, and a read model wherever an event first moves some state.
// ---------------------------------------------------------------
{
  const { model } = build(3);
  const em = () => sandbox.eventModel(model());
  const commandsOf = (columns) => columns.filter((c) => c.kind === 'command').map((c) => c.command);

  check('commands are ordered along the lifecycles, feature order breaking ties', () => {
    eq(model().name, 'Course Example (with schedules)', 'the example these expectations are about');
    eq(commandsOf(em().columns), [
      'DefineCourse', 'RegisterStudent',
      'ChangeCourseCapacity', 'RescheduleCourse', 'SubscribeStudentToCourse', 'UnsubscribeStudentFromCourse',
      'ArchiveCourse',
    ], 'creators first, the command that ends a course last');
  });

  check('event lanes are tags, and an event with two tags spans both', () => {
    const { lanes, columns } = em();
    eq(lanes, ['CourseId', 'StudentId'], 'in the order the timeline first meets them');
    const subscribe = columns.find((c) => c.command === 'SubscribeStudentToCourse');
    eq(subscribe.events[0].lanes, [0, 1], 'one card across both lanes');
  });

  check('a read model follows the first event that moves each piece of state, once', () => {
    const reads = em().columns.filter((c) => c.kind === 'read');
    eq(reads[0], { kind: 'read', entity: 'Course', properties: ['status', 'capacity', 'slots'], from: 'CourseDefined' },
      'what defining a course sets');
    eq(reads.some((r) => r.projection === 'CourseNumbering'), true, 'a standalone projection is a read model too');
    const seen = reads.flatMap((r) => r.properties.map((p) => r.entity + '.' + p));
    eq(seen.length, new Set(seen).size, 'no property introduced twice');
    const fromSubscribe = reads.filter((r) => r.from === 'StudentSubscribedToCourse').map((r) => r.entity);
    eq(fromSubscribe, ['Course', 'Student'], 'in lane order');
  });

  check('the layout places no two cards on top of each other', () => {
    for (const index of [0, 3, 8]) {
      const { model: m } = build(index);
      const layout = sandbox.eventModelLayout(m(), sandbox.eventModel(m()));
      const cards = layout.cards;
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          const a = cards[i];
          const b = cards[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          eq(overlap, false, `${m().name}: ${a.kind} and ${b.kind} at x ${a.x} / ${b.x}`);
        }
      }
    }
  });

  check('the code view paints, and going back to the pages applies what was typed', () => {
    const { id, model: m } = build(0);
    store.set('dcb-playground:model', id);
    const { state } = sandbox;
    Object.assign(state, { view: 'slice', slice: 'ArchiveCourse', code: false });
    sandbox.enterCode();
    eq(state.code, true, 'in the code');
    const main = sandbox.document.createElement('div');
    sandbox.renderCode(m(), main);
    const text = textOf(main);
    eq(text.includes('In step with the model'), true, 'a clean text says so');
    eq(findAll(main, (n) => n.tag === 'textarea').length, 1, 'the textarea, with no Monaco to load');
    const codeView = sandbox.codeView;
    sandbox.onCodeInput(codeView.text.replace('emit CourseArchived { courseId }', 'emit CourseCapacityChanged { courseId }'));
    eq(sandbox.codeDirty(), true, 'edited');
    sandbox.leaveCode();
    eq(state.code, false, 'back on the pages');
    eq(m()['command-definitions'].ArchiveCourse.publishes[0].name, 'CourseCapacityChanged', 'applied on the way');
    eq(sandbox.codeDirty(), false, 'and the text is what the model says');
  });

  check('a text the model moved under stays stale through a model switch, and is never applied', () => {
    const { id, model: m } = build(0);
    const other = createDcbModel('Other');
    const { state, codeView } = sandbox;
    store.set('dcb-playground:model', id);
    Object.assign(state, { view: 'slice', slice: 'ArchiveCourse', code: true });
    const paint = () => sandbox.renderCode(sandbox.activeModel(), sandbox.document.createElement('div'));
    paint();
    sandbox.onCodeInput(codeView.text.replace('student.subscriptionCount < 10', 'student.subscriptionCount < 12'));
    const body = JSON.parse(JSON.stringify(m()['command-definitions'].ArchiveCourse));
    body.publishes[0].name = 'CourseCapacityChanged';
    updateDefinition('command-definition', id, 'ArchiveCourse', body);
    paint();
    eq(codeView.stale, true, 'stale on its own model');
    store.set('dcb-playground:model', other);
    paint();
    eq(sandbox.codeDirty(), false, 'the other model has its own text');
    store.set('dcb-playground:model', id);
    paint();
    eq([codeView.stale, sandbox.codeDirty()], [true, true], 'still stale, still edited, when it comes back');
    sandbox.leaveCode();
    eq(m()['command-definitions'].ArchiveCourse.publishes[0].name, 'CourseCapacityChanged', 'the change it missed survives');
  });

  check('the page paints, guarded emissions and all', () => {
    const { id, model: m } = build(8);
    store.set('dcb-playground:model', id);
    const main = sandbox.document.createElement('div');
    sandbox.renderEventModel(m(), main);
    const text = textOf(main);
    eq(text.includes('Events tagged'), true, 'a tag lane');
    eq(text.includes('guarded'), true, 'an emission with a when');
    eq(text.includes('2 rules · 2 guards'), true, 'UpdateText counts both');
  });
}

finish();
