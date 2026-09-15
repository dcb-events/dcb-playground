// ============================================================
// DCB Playground — evaluation tests.
//
// Exercises `evaluate.js` against the five models the playground
// ships, because those are the models the language was designed
// against: a command driven here is the command a modeller would drive
// in the interface, and a rule that fails here is the rule they would
// see fail.
//
// Run with `node app/evaluate.test.js`. No dependencies and no runner —
// the playground has neither, and a test suite that needed a build step
// would be the first thing in this project to need one.
//
// `model.js` and `evaluate.js` are classic scripts, so they are loaded
// into one `vm` context with a stubbed `localStorage` rather than
// required — and concatenated first, so that the second can see the
// constants the first declares.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

const store = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const source = ['model.js', 'evaluate.js']
  .map((file) => fs.readFileSync(path.join(APP, file), 'utf8'))
  .join('\n;\n');
vm.runInContext(source, sandbox, { filename: 'app.js' });

function build(index) {
  store.clear();
  const id = sandbox.loadPredefinedModel(index);
  return sandbox.projectState()[id];
}

// The same, but keeping the id, so a test can drive the editing
// commands and read the model back after each one.
function open_(index) {
  store.clear();
  const id = sandbox.loadPredefinedModel(index);
  return { id, model: () => sandbox.projectState()[id] };
}

const {
  evaluateCommand, foldEntityProperty, foldProjection, tagsOfEvent,
  deriveThen, runScenario, scenarioTouchesScript,
  deriveProjectionScenarioThen, runProjectionScenario, projectionScenarioTouchesScript,
  addDefinition, updateDefinition, removeDefinition, renameDefinition, renameMember, reorderDefinitions,
  createDcbModel,
  generateId, scenarioName, deepClone, evSuccessor,
  definitionsToSchema, buildShareEnvelope, importModelFromEnvelope, envelopeHasScript,
  envelopeVersionWarning,
} = sandbox;

// A fresh, empty model — for the ad-hoc identifier-type fixtures
// below, which want a minimal model rather than one of the five shipped
// models.
function openBlank(name) {
  store.clear();
  const id = createDcbModel(name || 'Ad-hoc');
  return { id, model: () => sandbox.projectState()[id] };
}

// A fresh model with a scripted projection bound as an entity property
// — for scripted-content tests (script round-tripping,
// `envelopeHasScript`, `scenarioTouchesScript`) that need a fixture no
// PREDEFINED_MODELS example carries. `Tick` reads the script through its
// boundary; `Ping` publishes the same event without reading it, so both
// sides of "does this command touch a script" exist.
//
// The script scopes itself the way every scripted projection does: an
// identifier-typed argument interpolated into its tag filter. Binding it
// as `Counter.total` is what supplies that argument.
function openScripted() {
  const { id, model } = openBlank('Scripted');
  addDefinition('entity-definition', id, 'Counter', { properties: [] });
  addDefinition('event-definition', id, 'Ticked', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'CounterTotal', {
    valueType: 'integer',
    isList: false,
    script: {
      initialState: 0,
      tagFilter: ['CounterId:{counterId}'],
      arguments: [{ name: 'counterId', propertyType: 'CounterId' }],
    },
    handlers: [{ event: 'Ticked', code: '(state || 0) + 1' }],
  });
  updateDefinition('entity-definition', id, 'Counter', {
    properties: [{ name: 'total', projection: 'CounterTotal' }],
  });
  addDefinition('command-definition', id, 'Tick', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
    boundary: [{ alias: 'counter', entity: 'Counter', id: { parameterName: 'counterId' } }],
    conditions: [{ leftHandSide: { alias: 'counter', property: 'total' }, predicate: 'lessThan', rightHandSide: 3 }],
    publishes: [{ name: 'Ticked', parameters: { counterId: { parameterName: 'counterId' } } }],
  });
  addDefinition('command-definition', id, 'Ping', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
    boundary: [{ alias: 'counter', entity: 'Counter', id: { parameterName: 'counterId' } }],
    conditions: [],
    publishes: [{ name: 'Ticked', parameters: { counterId: { parameterName: 'counterId' } } }],
  });
  return { id, model };
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

// Drives a command and appends what it published, so a fixture is built
// the way the sandbox will build one.
function drive(model, log, command, args) {
  const result = evaluateCommand(model, log, command, args);
  if (result.outcome !== 'published') {
    throw new Error(`${command} was refused by ${result.failedRule.text}`);
  }
  log.push(...result.events);
  return result;
}

// ---------------------------------------------------------------
// 1. Course example, identifiers supplied by the caller.
// ---------------------------------------------------------------
{
  const model = build(0);

  check('define a course, then a student, then subscribe', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    eq(log[0], { type: 'CourseDefined', data: { courseId: 'c1', capacity: 2 } });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(log.length, 3, 'log length');
    eq(foldEntityProperty(model, log, 'Course', 'subscriptionCount', 'c1'), 1, 'subscriptionCount');
    eq(foldEntityProperty(model, log, 'Course', 'subscribedStudentIds', 'c1'), ['s1'], 'subscribers');
    eq(foldEntityProperty(model, log, 'Student', 'status', 's1'), 'Existent', 'student status');
  });

  check('a course cannot be defined twice', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    const result = evaluateCommand(model, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'course.status == NonExistent', 'rule');
    eq(result.failedRule.leftValue, 'Existent', 'left value');
  });

  check('a full course refuses the next subscription', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    for (const id of ['s1', 's2']) drive(model, log, 'RegisterStudent', { studentId: id });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's2' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'course.subscriptionCount < course.capacity', 'rule');
    eq([result.failedRule.leftValue, result.failedRule.rightValue], [1, 1], 'values');
  });

  check('the same student cannot subscribe twice', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 9 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(course.subscribedStudentIds contains studentId)', 'rule');
  });

  check('unsubscribing puts the capacity back', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    for (const id of ['s1', 's2']) drive(model, log, 'RegisterStudent', { studentId: id });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'UnsubscribeStudentFromCourse', { courseId: 'c1', studentId: 's1' });
    eq(foldEntityProperty(model, log, 'Course', 'subscriptionCount', 'c1'), 0, 'count');
    eq(foldEntityProperty(model, log, 'Course', 'subscribedStudentIds', 'c1'), [], 'subscribers');
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's2' });
  });

  check('tags come from identifier-typed properties', () => {
    eq(tagsOfEvent(model, 'StudentSubscribedToCourse', { courseId: 'c1', studentId: 's1' }),
      ['CourseId:c1', 'StudentId:s1'], 'tags');
    eq(tagsOfEvent(model, 'CourseDefined', { courseId: 'c1', capacity: 3 }), ['CourseId:c1'], 'tags');
  });

  check('one instance never sees another instance events', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 7 });
    eq(foldEntityProperty(model, log, 'Course', 'capacity', 'c1'), 5, 'c1 capacity');
    eq(foldEntityProperty(model, log, 'Course', 'capacity', 'c2'), 7, 'c2 capacity');
    eq(foldEntityProperty(model, log, 'Course', 'status', 'c3'), 'NonExistent', 'unseen instance');
  });
}

// ---------------------------------------------------------------
// 2. Identifiers minted by a parameterless projection.
// ---------------------------------------------------------------
{
  const model = build(1);

  check('the numbering issues c1, c2, c3', () => {
    const log = [];
    eq(foldProjection(model, log, 'CourseNumbering', {}), 'c1', 'before anything');
    drive(model, log, 'DefineCourse', { capacity: 10 });
    eq(log[0].data.courseId, 'c1', 'first id');
    eq(foldProjection(model, log, 'CourseNumbering', {}), 'c2', 'after one');
    drive(model, log, 'DefineCourse', { capacity: 10 });
    drive(model, log, 'DefineCourse', { capacity: 10 });
    eq(log.map((e) => e.data.courseId), ['c1', 'c2', 'c3'], 'ids');
  });

  check('a minted command has no conditions left to fail', () => {
    const log = [];
    const result = evaluateCommand(model, log, 'DefineCourse', { capacity: 1 });
    eq(result.outcome, 'published', 'outcome');
    eq(result.reads.courseNumbering,
      { kind: 'projection', projection: 'CourseNumbering', arguments: {}, value: 'c1' }, 'reads');
  });
}

// ---------------------------------------------------------------
// 3. A parameterised projection: numbering restarts per tenant.
// ---------------------------------------------------------------
{
  const model = build(2);

  check('course numbers restart per tenant, ids do not', () => {
    const log = [];
    drive(model, log, 'RegisterTenant', { tenantId: 't1' });
    drive(model, log, 'RegisterTenant', { tenantId: 't2' });
    drive(model, log, 'DefineCourse', { tenantId: 't1', capacity: 5 });
    drive(model, log, 'DefineCourse', { tenantId: 't1', capacity: 5 });
    drive(model, log, 'DefineCourse', { tenantId: 't2', capacity: 5 });

    const defined = log.filter((e) => e.type === 'CourseDefined');
    eq(defined.map((e) => e.data.courseId), ['c1', 'c2', 'c3'], 'ids stay global');
    eq(defined.map((e) => e.data.courseNumber), ['1', '2', '1'], 'numbers restart');
    eq(foldProjection(model, log, 'TenantCourseNumbering', { tenantId: 't1' }), '3', 't1 next');
    eq(foldProjection(model, log, 'TenantCourseNumbering', { tenantId: 't2' }), '2', 't2 next');
  });

  check('a course cannot be defined for an unregistered tenant', () => {
    const result = evaluateCommand(model, [], 'DefineCourse', { tenantId: 't9', capacity: 5 });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'tenant.status == Existent', 'rule');
  });
}

// ---------------------------------------------------------------
// 4. Schedules: chained bindings, fan-out and `excluding`.
// ---------------------------------------------------------------
{
  const model = build(3);

  const setUp = () => {
    const log = [];
    drive(model, log, 'DefineCourse', { capacity: 9, slots: ['2026-03-01T09'] });          // c1
    drive(model, log, 'DefineCourse', { capacity: 9, slots: ['2026-03-01T09'] });          // c2
    drive(model, log, 'DefineCourse', { capacity: 9, slots: ['2026-03-01T11'] });          // c3
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    return log;
  };

  check('a student cannot join two courses in the same slot', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(model, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(others.slots containsAny course.slots)', 'rule');
  });

  check('a free slot is accepted', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c3', studentId: 's1' });
    eq(foldEntityProperty(model, log, 'Student', 'subscribedCourseIds', 's1'), ['c1', 'c3'], 'courses');
  });

  check('rescheduling onto a subscriber other course is refused', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c3', studentId: 's1' });
    const result = evaluateCommand(model, log, 'RescheduleCourse',
      { courseId: 'c1', slots: ['2026-03-01T11'] });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(theirs.slots containsAny slots)', 'rule');
  });

  check('excluding keeps a course from clashing with itself', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    // Same slots it already occupies: `theirs` excludes c1, so there is
    // nothing left to clash with.
    drive(model, log, 'RescheduleCourse', { courseId: 'c1', slots: ['2026-03-01T09'] });
    eq(foldEntityProperty(model, log, 'Course', 'slots', 'c1'), ['2026-03-01T09'], 'slots');
  });

  check('a course with no subscribers reschedules freely', () => {
    const log = setUp();
    drive(model, log, 'RescheduleCourse', { courseId: 'c2', slots: ['2026-03-01T11'] });
    eq(foldEntityProperty(model, log, 'Course', 'slots', 'c2'), ['2026-03-01T11'], 'slots');
  });
}

// ---------------------------------------------------------------
// 5. A cart: composite list values, fan-out and zipping.
// ---------------------------------------------------------------
{
  const model = build(4);

  const setUp = () => {
    const log = [];
    drive(model, log, 'DefineProduct', { productId: 'p1', price: 100 });
    drive(model, log, 'DefineProduct', { productId: 'p2', price: 250 });
    return log;
  };

  check('an order at the current prices is accepted', () => {
    const log = setUp();
    const result = drive(model, log, 'OrderProducts', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 100 }, { productId: 'p2', price: 250 }],
    });
    eq(result.events[0].type, 'ProductsOrdered', 'event');
    eq(result.events[0].data.items.length, 2, 'items');
  });

  check('one stale line refuses the whole cart', () => {
    const log = setUp();
    const result = evaluateCommand(model, log, 'OrderProducts', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 100 }, { productId: 'p2', price: 999 }],
    });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.atInstance, 1, 'which line');
    eq(result.failedRule.leftValue, 250, 'the real price');
    eq(result.failedRule.rightValue, 999, 'the price shown');
  });

  check('prices are checked line by line, not against any price in the cart', () => {
    const log = setUp();
    // Both prices are real, but swapped between the products.
    const result = evaluateCommand(model, log, 'OrderProducts', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 250 }, { productId: 'p2', price: 100 }],
    });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.atInstance, 0, 'the first line');
  });

  check('an order tags every product in the cart', () => {
    eq(tagsOfEvent(model, 'ProductsOrdered', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 1 }, { productId: 'p2', price: 2 }],
    }), ['OrderId:o1', 'ProductId:p1', 'ProductId:p2'], 'tags');
  });
}

// ---------------------------------------------------------------
// 7. Broken inputs are not rejections.
// ---------------------------------------------------------------
{
  const model = build(0);

  const broken = (what, fn) => check(what, () => {
    try {
      fn();
    } catch (error) {
      if (error.name !== 'EvaluationError') throw new Error(`threw ${error.name}: ${error.message}`);
      return;
    }
    throw new Error('did not fail');
  });

  broken('a missing argument is broken, not rejected',
    () => evaluateCommand(model, [], 'DefineCourse', { courseId: 'c1' }));
  broken('an unknown command is broken',
    () => evaluateCommand(model, [], 'NoSuchCommand', {}));
  broken('an unknown entity property is broken',
    () => foldEntityProperty(model, [], 'Course', 'nope', 'c1'));
  broken('a projection read without its parameter is broken',
    () => foldProjection(build(2), [], 'TenantCourseNumbering', {}));
}

// ---------------------------------------------------------------
// 8. The predicates and operands the shipped models do not reach.
//
// Six of the sixteen predicates appear in a seed. The rest are checked
// by swapping a condition into a command in memory — the model is a
// plain object, so this is the same body the interface would have
// written, without needing a seventh example model to hold it.
// ---------------------------------------------------------------
{
  const model = build(0);

  // One course at capacity 5 with a single subscriber.
  const log = [];
  drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
  drive(model, log, 'RegisterStudent', { studentId: 's1' });
  drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });

  const archive = model['command-definitions'].ArchiveCourse;
  const original = archive.conditions;

  // ArchiveCourse binds `course` and takes `courseId`, so any condition
  // over the course's state can stand in for its own.
  const holds = (condition) => {
    archive.conditions = [condition];
    try {
      return evaluateCommand(model, log, 'ArchiveCourse', { courseId: 'c1' }).outcome === 'published';
    } finally {
      archive.conditions = original;
    }
  };

  const of = (property) => ({ alias: 'course', property });

  check('unary predicates', () => {
    eq(holds({ leftHandSide: of('subscribedStudentIds'), predicate: 'isNotEmpty' }), true, 'isNotEmpty');
    eq(holds({ leftHandSide: of('subscribedStudentIds'), predicate: 'isEmpty' }), false, 'isEmpty');
    eq(holds({ leftHandSide: true, predicate: 'isTrue' }), true, 'isTrue on a literal');
    eq(holds({ leftHandSide: false, predicate: 'isFalse' }), true, 'isFalse on a literal');
  });

  check('counting predicates count the list, not compare it', () => {
    eq(holds({ leftHandSide: of('subscribedStudentIds'), predicate: 'countEquals', rightHandSide: 1 }), true, 'countEquals');
    eq(holds({ leftHandSide: of('subscribedStudentIds'), predicate: 'countGreaterThan', rightHandSide: 0 }), true, 'countGreaterThan');
    eq(holds({ leftHandSide: of('subscribedStudentIds'), predicate: 'countLessThan', rightHandSide: 1 }), false, 'countLessThan');
  });

  check('ordering predicates', () => {
    eq(holds({ leftHandSide: of('capacity'), predicate: 'greaterThan', rightHandSide: 4 }), true, 'greaterThan');
    eq(holds({ leftHandSide: of('capacity'), predicate: 'greaterThanOrEquals', rightHandSide: 5 }), true, 'greaterThanOrEquals');
    eq(holds({ leftHandSide: of('capacity'), predicate: 'lessThanOrEquals', rightHandSide: 5 }), true, 'lessThanOrEquals');
    eq(holds({ leftHandSide: of('capacity'), predicate: 'lessThan', rightHandSide: 5 }), false, 'lessThan');
  });

  check('string predicates', () => {
    eq(holds({ leftHandSide: of('status'), predicate: 'startsWith', rightHandSide: 'Exist' }), true, 'startsWith');
    eq(holds({ leftHandSide: of('status'), predicate: 'endsWith', rightHandSide: 'tent' }), true, 'endsWith');
    eq(holds({ leftHandSide: of('status'), predicate: 'startsWith', rightHandSide: 'Non' }), false, 'startsWith, not');
  });

  check('negate inverts whatever it wraps', () => {
    eq(holds({ leftHandSide: of('capacity'), predicate: 'equals', rightHandSide: 5, negate: true }), false, 'negated equals');
    eq(holds({ leftHandSide: of('capacity'), predicate: 'equals', rightHandSide: 9, negate: true }), true, 'negated equals, not');
  });

  check('a status compares as its member name, wrapped or bare', () => {
    eq(holds({ leftHandSide: of('status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' } }), true, 'wrapped');
    eq(holds({ leftHandSide: of('status'), predicate: 'equals', rightHandSide: 'Existent' }), true, 'bare');
  });
}

// ---------------------------------------------------------------
// 9. Successors keep the width they were written with.
// ---------------------------------------------------------------
{
  const model = build(2);

  check('a zero-padded numbering keeps its padding until it outgrows it', () => {
    model['projection-definitions'].TenantCourseNumbering.initialValue = '008';
    const log = [];
    drive(model, log, 'RegisterTenant', { tenantId: 't1' });
    for (let i = 0; i < 3; i++) drive(model, log, 'DefineCourse', { tenantId: 't1', capacity: 1 });
    eq(log.filter((e) => e.type === 'CourseDefined').map((e) => e.data.courseNumber),
      ['008', '009', '010'], 'numbers');
  });
}


// ---------------------------------------------------------------
// 10. Scenarios: storage, drift, and what a rename has to carry.
// ---------------------------------------------------------------
{
  // A scenario over the simple course model: one course defined, one
  // student registered, and a subscription that succeeds.
  const scenarioBody = () => ({
    command: 'SubscribeStudentToCourse',
    given: [
      { event: 'CourseDefined', data: { courseId: 'c1', capacity: 2 } },
      { event: 'StudentRegistered', data: { studentId: 's1' } },
    ],
    when: { arguments: { courseId: 'c1', studentId: 's1' } },
  });

  const store_ = (id, model, body) => {
    const complete = { ...body, then: deriveThen(model, body) };
    const key = generateId();
    addDefinition('scenario-definition', id, key, complete);
    return key;
  };

  check('a scenario is stored, derived and runs current', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    const stored = model()['scenario-definitions'][key];
    eq(stored.then.outcome, 'published', 'derived outcome');
    eq(stored.then.events, [{ type: 'StudentSubscribedToCourse', data: { courseId: 'c1', studentId: 's1' } }], 'derived events');
    eq(runScenario(model(), stored).status, 'current', 'status');
  });

  check('a scenario is named from its outcome unless it says otherwise', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    eq(scenarioName(model()['scenario-definitions'][key]), 'records StudentSubscribedToCourse', 'derived');
    eq(scenarioName({ name: 'the happy path', then: { outcome: 'published', events: [] } }), 'the happy path', 'override');
    eq(scenarioName({ then: { outcome: 'rejected', failedRule: { text: 'course.status == Existent' } } }),
      'is refused by course.status == Existent', 'rejected');
  });

  check('changing a rule the command checks is reported as drift', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());

    // A student may now be in at most zero courses, so what published
    // before is refused now.
    const command = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    command.conditions.find((c) => c.leftHandSide.property === 'subscriptionCount'
      && c.leftHandSide.alias === 'student').rightHandSide = 0;
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', command);

    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.status, 'drifted', 'status');
    eq(result.expected.outcome, 'published', 'expected');
    eq(result.actual.outcome, 'rejected', 'actual');
    eq(result.actual.failedRule.text, 'student.subscriptionCount < 0', 'the rule that now refuses it');
  });

  check('a scenario never stops you deleting what it tests', () => {
    const { id, model } = open_(0);
    store_(id, model(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    // Nothing but the scenario references the command, and the
    // scenario is not allowed to be the thing that refuses.
    removeDefinition('command-definition', id, 'ArchiveCourse');
    eq('ArchiveCourse' in model()['command-definitions'], false, 'gone');
  });

  check('deleting what a scenario tests leaves it broken, not passing', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    removeDefinition('command-definition', id, 'ArchiveCourse');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.status, 'broken', 'status');
    eq(result.actual, null, 'nothing to compare');
  });

  check('an event gaining a property breaks the scenarios written before it', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    const event = deepClone(model()['event-definitions'].CourseDefined);
    event.properties.push({ name: 'title', propertyType: 'string', isOptional: false, isList: false });
    updateDefinition('event-definition', id, 'CourseDefined', event);
    eq(runScenario(model(), model()['scenario-definitions'][key]).status, 'broken', 'status');
  });

  check('renaming an event carries the Given and the expected outcome with it', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    renameDefinition('event-definition', id, 'StudentSubscribedToCourse', 'StudentEnrolled');
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseOpened');
    const stored = model()['scenario-definitions'][key];
    eq(stored.given[0].event, 'CourseOpened', 'the Given followed');
    eq(stored.then.events[0].type, 'StudentEnrolled', 'the Then followed');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming an event property moves the key in every payload', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    renameMember('event-definition', id, 'CourseDefined', 'property', 'capacity', 'seats');
    const stored = model()['scenario-definitions'][key];
    eq(stored.given[0].data, { courseId: 'c1', seats: 2 }, 'the Given payload');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming a command property moves the key in the When', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    renameMember('command-definition', id, 'SubscribeStudentToCourse', 'property', 'studentId', 'enrolleeId');
    const stored = model()['scenario-definitions'][key];
    eq(stored.when.arguments, { courseId: 'c1', enrolleeId: 's1' }, 'the When');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming the command it tests carries the scenario', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    renameDefinition('command-definition', id, 'SubscribeStudentToCourse', 'EnrolStudent');
    const stored = model()['scenario-definitions'][key];
    eq(stored.command, 'EnrolStudent', 'the reference followed');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming a composite field reaches inside the stored values', () => {
    const { id, model } = open_(4);
    const key = store_(id, model(), {
      command: 'OrderProducts',
      given: [
        { event: 'ProductDefined', data: { productId: 'p1', price: 100 } },
      ],
      when: { arguments: { orderId: 'o1', items: [{ productId: 'p1', price: 100 }] } },
    });
    renameMember('custom-type-definition', id, 'Item', 'field', 'price', 'shownPrice');
    const stored = model()['scenario-definitions'][key];
    eq(stored.when.arguments.items, [{ productId: 'p1', shownPrice: 100 }], 'the When');
    eq(stored.then.events[0].data.items, [{ productId: 'p1', shownPrice: 100 }], 'the Then');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('a scenario is identified by an id, so it is updated rather than renamed', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    try {
      renameDefinition('scenario-definition', id, key, 'SomethingElse');
      throw new Error('did not refuse');
    } catch (error) {
      if (!/generated id/.test(error.message)) throw error;
    }
    const body = { ...model()['scenario-definitions'][key], name: 'the happy path' };
    updateDefinition('scenario-definition', id, key, body);
    eq(scenarioName(model()['scenario-definitions'][key]), 'the happy path', 'renamed by update');
  });

  check('a payload with a property the event does not have is refused', () => {
    const { id, model } = open_(0);
    const body = scenarioBody();
    body.then = deriveThen(model(), body);
    body.given[0].data.colour = 'blue';
    try {
      addDefinition('scenario-definition', id, generateId(), body);
      throw new Error('did not refuse');
    } catch (error) {
      if (!/not one of its properties/.test(error.message)) throw error;
    }
  });

  check('a scenario knows whether running it would execute a script', () => {
    const plain = build(0);
    eq(scenarioTouchesScript(plain, { command: 'SubscribeStudentToCourse' }), false, 'declared only');
    const scripted = openScripted().model();
    eq(scenarioTouchesScript(scripted, { command: 'Tick' }), true, 'reads a scripted property');
    eq(scenarioTouchesScript(scripted, { command: 'Ping' }), false, 'does not');
  });

  check('duplicating a scenario is a plain copy under a new id', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    const original = model()['scenario-definitions'][key];
    const copyKey = generateId();
    addDefinition('scenario-definition', id, copyKey, deepClone(original));
    eq(copyKey === key, false, 'a fresh id');
    eq(model()['scenario-definitions'][copyKey], original, 'same body');
    eq(Object.keys(model()['scenario-definitions']), [key, copyKey], 'appended after the original');
  });

  check('reordering carries the swap through to how scenarios list', () => {
    const { id, model } = open_(0);
    const first = store_(id, model(), scenarioBody());
    const second = store_(id, model(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    eq(Object.keys(model()['scenario-definitions']), [first, second], 'as written');
    reorderDefinitions('scenario-definition', id, [second, first]);
    eq(Object.keys(model()['scenario-definitions']), [second, first], 'swapped');
  });

  check('reordering refuses an order that drops or invents a member', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), scenarioBody());
    try {
      reorderDefinitions('scenario-definition', id, [key, generateId()]);
      throw new Error('did not refuse');
    } catch (error) {
      if (!/name every one of them, exactly once/.test(error.message)) throw error;
    }
  });
}


// ---------------------------------------------------------------
// 11. What a command reports having read.
//
// A binding reports the properties the decision depended on, so the
// report has to be taken after the conditions have run — described
// before them it would say a command read nothing, which is what the
// sandbox showed when it did.
// ---------------------------------------------------------------
{
  const model = build(0);

  check('a published command reports what its conditions consulted', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    const result = evaluateCommand(model, log, 'SubscribeStudentToCourse',
      { courseId: 'c1', studentId: 's1' });
    eq(result.outcome, 'published', 'outcome');
    eq(Object.keys(result.reads).sort(), ['course', 'student'], 'aliases');
    eq(Object.keys(result.reads.course.instances[0].properties).sort(),
      ['capacity', 'status', 'subscribedStudentIds', 'subscriptionCount'], 'course properties');
    eq(result.reads.course.instances[0].properties.capacity, 2, 'a value it read');
    eq(result.reads.student.instances[0].id, 's1', 'the student it bound');
  });

  check('a refused command reports what it had read when it refused', () => {
    const result = evaluateCommand(model, [], 'SubscribeStudentToCourse',
      { courseId: 'c1', studentId: 's1' });
    eq(result.outcome, 'rejected', 'outcome');
    // It stopped at the first rule, so only what that rule needed is
    // reported — not every property the command could have read.
    eq(Object.keys(result.reads.course.instances[0].properties), ['status'], 'only what it got to');
    eq(result.reads.course.instances[0].properties.status, 'NonExistent', 'the value that refused it');
  });

  check('a projection binding reports the value it issued', () => {
    const seq = build(1);
    const result = evaluateCommand(seq, [], 'DefineCourse', { capacity: 3 });
    eq(result.reads.courseNumbering, {
      // The arguments ride along with the value: a partition is half of
      // what a read was, and a reader following it needs both.
      kind: 'projection', projection: 'CourseNumbering', arguments: {}, value: 'c1',
    }, 'the numbering');
  });
}

// ---------------------------------------------------------------
// 12. An entity with an integer identifier: tagging and successor,
// end to end.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();

  addDefinition('entity-definition', id, 'Widget', { properties: [] });
  updateDefinition('custom-type-definition', id, 'WidgetId', { schema: { type: 'integer' }, isTag: true });
  addDefinition('event-definition', id, 'WidgetDefined', {
    properties: [{ name: 'widgetId', propertyType: 'WidgetId', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'WidgetIsDefined', {
    parameters: [{ name: 'widgetId', propertyType: 'WidgetId' }],
    valueType: 'boolean',
    isList: false,
    initialValue: false,
    handlers: [{ event: 'WidgetDefined', operation: 'set', value: true }],
  });
  updateDefinition('entity-definition', id, 'Widget', {
    properties: [{ name: 'defined', projection: 'WidgetIsDefined' }],
  });
  addDefinition('projection-definition', id, 'WidgetNumbering', {
    parameters: [],
    valueType: 'WidgetId',
    isList: false,
    initialValue: 1,
    handlers: [{ event: 'WidgetDefined', operation: 'set', value: { successor: { eventProperty: 'widgetId' } } }],
  });
  addDefinition('command-definition', id, 'DefineWidget', {
    properties: [],
    boundary: [{ alias: 'widgetNumbering', projection: 'WidgetNumbering', arguments: {} }],
    conditions: [],
    publishes: [{ name: 'WidgetDefined', parameters: { widgetId: { alias: 'widgetNumbering' } } }],
  });

  check('an integer identifier tags and numbers correctly, end to end', () => {
    const log = [];
    eq(foldProjection(model(), log, 'WidgetNumbering', {}), 1, 'before anything');
    drive(model(), log, 'DefineWidget', {});
    eq(log[0].data.widgetId, 1, 'first id is a number');
    eq(tagsOfEvent(model(), 'WidgetDefined', { widgetId: 1 }), ['WidgetId:1'], 'tag');
    eq(foldEntityProperty(model(), log, 'Widget', 'defined', 1), true, 'entity state');
    drive(model(), log, 'DefineWidget', {});
    eq(foldProjection(model(), log, 'WidgetNumbering', {}), 3, 'numbering advances by successor');
  });
}

// ---------------------------------------------------------------
// 13 & 14. Composite identifiers: union-of-component tags, and a
// standalone identifier type shared across two entities' composite ids.
//
// `Course` and `Invoice` each compose a shared standalone `TenantTag`
// with a component of their own (`CourseNumber`, `InvoiceNumber` — one
// entity-derived, one standalone, exercising both origins in the same
// composite). Tag derivation looks *through* the composite: the tags
// are the union of the components' own tags, never renamespaced under
// `CourseId`/`InvoiceId` — and because both entities compose in the
// very same `TenantTag`, their events end up sharing that one tag.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();

  addDefinition('custom-type-definition', id, 'TenantTag', { schema: { type: 'string' }, isTag: true });
  addDefinition('custom-type-definition', id, 'CourseNumber', { schema: { type: 'string' }, isTag: true });
  addDefinition('entity-definition', id, 'InvoiceSeries', { properties: [] });
  addDefinition('entity-definition', id, 'Course', { properties: [] });
  updateDefinition('custom-type-definition', id, 'CourseId', {
    properties: [
      { name: 'tenant', propertyType: 'TenantTag' },
      { name: 'number', propertyType: 'CourseNumber' },
    ],
  });
  addDefinition('entity-definition', id, 'Invoice', { properties: [] });
  updateDefinition('custom-type-definition', id, 'InvoiceId', {
    properties: [
      { name: 'tenant', propertyType: 'TenantTag' },
      { name: 'series', propertyType: 'InvoiceSeriesId' },
    ],
  });
  addDefinition('event-definition', id, 'CourseDefined', {
    properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
  });
  addDefinition('event-definition', id, 'InvoiceRaised', {
    properties: [{ name: 'invoiceId', propertyType: 'InvoiceId', isOptional: false, isList: false }],
  });

  check('a composite identifier tags as the union of its components, not renamespaced', () => {
    eq(
      tagsOfEvent(model(), 'CourseDefined', { courseId: { tenant: 't1', number: 'c1' } }),
      ['TenantTag:t1', 'CourseNumber:c1'],
      'tags are the bare component tags, never "CourseId.tenant:..." or similar'
    );
  });

  check('two entities sharing a standalone identifier-type component share its tag', () => {
    const courseTags = tagsOfEvent(model(), 'CourseDefined', { courseId: { tenant: 't1', number: 'c1' } });
    const invoiceTags = tagsOfEvent(model(), 'InvoiceRaised', { invoiceId: { tenant: 't1', series: 'i1' } });
    eq(courseTags.includes('TenantTag:t1'), true, 'course carries the shared tag');
    eq(invoiceTags.includes('TenantTag:t1'), true, 'invoice carries the same shared tag');
    eq(invoiceTags, ['TenantTag:t1', 'InvoiceSeriesId:i1'], 'invoice tags, entity-derived component included');
  });

  check('a projection may not hold a composite, so no successor over one can be declared', () => {
    try {
      addDefinition('projection-definition', id, 'LastCourseId', {
        parameters: [],
        valueType: 'CourseId',
        isList: false,
        initialValue: null,
        handlers: [{ event: 'CourseDefined', operation: 'set', value: { successor: { eventProperty: 'courseId' } } }],
      });
      throw new Error('did not refuse');
    } catch (error) {
      if (!/which is a composite/.test(error.message)) throw error;
    }
  });
}

// ---------------------------------------------------------------
// 15. Successor on a composite value is a broken evaluation, not a
// silent fallthrough to the generic "no successor" message.
// ---------------------------------------------------------------
{
  check('evSuccessor on a composite (object) value fails with a specific message', () => {
    try {
      evSuccessor({ tenant: 't1', number: 'c1' });
      throw new Error('did not fail');
    } catch (error) {
      if (error.name !== 'EvaluationError') throw error;
      if (!/composite identifier has no successor/.test(error.message)) {
        throw new Error(`wrong message: ${error.message}`);
      }
    }
  });
}

// ---------------------------------------------------------------
// 16. Rename tracking for an entity's derived identifier — now an
// ordinary custom-type-definition, auto-created alongside the entity.
//
// Three shapes: an entity whose identifier still tracks it (renaming
// the entity moves the derived type's name along with it, both still
// tracking afterward), an entity created with an explicit
// `identifierType` (the rename leaves the type name alone), and a
// direct rename of the value type itself (which pins a previously
// tracking owner's `identifierType` explicit, since its default would
// otherwise point at a name that no longer exists).
// ---------------------------------------------------------------
{
  check('renaming an entity that still tracks its identifier moves the derived type', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Gadget', { properties: [] });
    addDefinition('event-definition', id, 'GadgetDefined', {
      properties: [{ name: 'gadgetId', propertyType: 'GadgetId', isOptional: false, isList: false }],
    });
    renameDefinition('entity-definition', id, 'Gadget', 'Widget');
    eq('WidgetId' in model()['custom-type-definitions'], true, 'the derived type renamed too');
    eq('GadgetId' in model()['custom-type-definitions'], false, 'old name gone');
    eq('identifierType' in model()['entity-definitions'].Widget, false, 'still tracking, nothing pinned');
    eq(model()['event-definitions'].GadgetDefined.properties[0].propertyType, 'WidgetId',
      'the property type followed the rename');
    eq(tagsOfEvent(model(), 'GadgetDefined', { gadgetId: 'g1' }), ['WidgetId:g1'], 'tags follow too');
  });

  check('renaming an entity whose identifier type was customised leaves the derived type alone', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Gizmo', {
      identifierType: 'GizmoRef', properties: [],
    });
    addDefinition('event-definition', id, 'GizmoDefined', {
      properties: [{ name: 'gizmoId', propertyType: 'GizmoRef', isOptional: false, isList: false }],
    });
    renameDefinition('entity-definition', id, 'Gizmo', 'Doohickey');
    eq('Doohickey' in model()['entity-definitions'], true, 'entity renamed');
    eq('Gizmo' in model()['entity-definitions'], false, 'old name gone');
    eq(model()['entity-definitions'].Doohickey.identifierType, 'GizmoRef', 'the override stayed put');
    eq(model()['event-definitions'].GizmoDefined.properties[0].propertyType, 'GizmoRef',
      'the customised identifier type did not move');
    eq(tagsOfEvent(model(), 'GizmoDefined', { gizmoId: 'g1' }), ['GizmoRef:g1'], 'tag unaffected by the rename');
  });

  check('renaming a tracking entity\'s derived value type directly pins it explicit', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Sprocket', { properties: [] });
    addDefinition('event-definition', id, 'SprocketDefined', {
      properties: [{ name: 'sprocketId', propertyType: 'SprocketId', isOptional: false, isList: false }],
    });

    renameDefinition('custom-type-definition', id, 'SprocketId', 'SprocketRef');
    eq(model()['entity-definitions'].Sprocket.identifierType, 'SprocketRef',
      'tracking is replaced by an explicit pointer at the new name');
    eq(model()['event-definitions'].SprocketDefined.properties[0].propertyType, 'SprocketRef',
      'the property type followed the rename');
    eq(tagsOfEvent(model(), 'SprocketDefined', { sprocketId: 's1' }), ['SprocketRef:s1'], 'tag follows too');

    // Now pinned, so renaming the *entity* no longer touches the type.
    renameDefinition('entity-definition', id, 'Sprocket', 'Cog');
    eq(model()['entity-definitions'].Cog.identifierType, 'SprocketRef', 'pin survives an entity rename');
    eq('SprocketRef' in model()['custom-type-definitions'], true, 'the value type keeps its own name');
  });

  check('renaming a standalone tag-marked custom type cascades like any other', () => {
    const { id, model } = openBlank();
    addDefinition('custom-type-definition', id, 'CourseNumber', { schema: { type: 'string' }, isTag: true });
    addDefinition('event-definition', id, 'CourseNumberIssued', {
      properties: [{ name: 'number', propertyType: 'CourseNumber', isOptional: false, isList: false }],
    });
    renameDefinition('custom-type-definition', id, 'CourseNumber', 'CourseRef');
    eq('CourseRef' in model()['custom-type-definitions'], true, 'renamed');
    eq('CourseNumber' in model()['custom-type-definitions'], false, 'old name gone');
    eq(model()['event-definitions'].CourseNumberIssued.properties[0].propertyType, 'CourseRef',
      'the reference followed the rename');
    eq(tagsOfEvent(model(), 'CourseNumberIssued', { number: 'c1' }), ['CourseRef:c1'], 'tag follows too');
  });

  check('an ordinary update cannot change identifierType', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Anvil', { properties: [] });
    try {
      updateDefinition('entity-definition', id, 'Anvil', {
        identifierType: 'AnvilRef', properties: [],
      });
      throw new Error('did not refuse');
    } catch (error) {
      if (!/ordinary update/.test(error.message)) throw error;
    }
    eq('identifierType' in model()['entity-definitions'].Anvil, false, 'unchanged');
  });

  check('an entity-owned value type cannot be removed directly, only by removing its entity', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Bolt', { properties: [] });
    try {
      removeDefinition('custom-type-definition', id, 'BoltId');
      throw new Error('did not refuse');
    } catch (error) {
      if (!/still referenced by/.test(error.message)) throw error;
    }
    removeDefinition('entity-definition', id, 'Bolt');
    eq('Bolt' in model()['entity-definitions'], false, 'entity removed');
    eq('BoltId' in model()['custom-type-definitions'], false, 'its derived type cascaded with it');
  });
}

// ---------------------------------------------------------------
// 17. A scripted standalone projection's `tagFilter` names an
// identifier type, not a literal tag string. Its `:` is authoring
// syntax splitting "which identifier" from "what value" — the actual
// tag is rendered through that identifier type's own `tagSchema`,
// which need not use `:` at all. A filter that just interpolated its
// placeholder into the written template verbatim would silently match
// nothing once a `tagSchema` diverges from the default.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();

  addDefinition('custom-type-definition', id, 'RegionCode', {
    schema: { type: 'string' }, isTag: true, tagSchema: '{type}={value}',
  });
  addDefinition('event-definition', id, 'RegionOpened', {
    properties: [{ name: 'regionCode', propertyType: 'RegionCode', isOptional: false, isList: false }],
  });
  addDefinition('command-definition', id, 'OpenRegion', {
    properties: [{ name: 'regionCode', propertyType: 'RegionCode', isOptional: false, isList: false }],
    boundary: [], conditions: [],
    publishes: [{ name: 'RegionOpened', parameters: { regionCode: { parameterName: 'regionCode' } } }],
  });
  addDefinition('projection-definition', id, 'OpenRegionCount', {
    valueType: 'integer',
    isList: false,
    script: {
      initialState: 0,
      tagFilter: ['RegionCode:{region}'],
      arguments: [{ name: 'region', propertyType: 'RegionCode' }],
    },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });

  check("a scripted projection's tagFilter resolves through a non-default tagSchema", () => {
    const log = [];
    drive(model(), log, 'OpenRegion', { regionCode: 'eu' });
    drive(model(), log, 'OpenRegion', { regionCode: 'us' });
    eq(foldProjection(model(), log, 'OpenRegionCount', { region: 'eu' }), 1,
      'matched through RegionCode\'s "=" tagSchema, not a hardcoded "RegionCode:eu"');
    eq(foldProjection(model(), log, 'OpenRegionCount', { region: 'us' }), 1, 'us counted separately');
  });
}

// ---------------------------------------------------------------
// Sharing: export to the schema shape, and the import synthesizer that
// rebuilds a model from it.
// ---------------------------------------------------------------
{
  // Dynamic Product Price (simple) is the case that actually needs the
  // retry pool: `Item`, a standalone composite custom type, names
  // `ProductId` — the identifier type `Product` derives, which does not
  // exist until the entity does. A synthesizer that added every custom
  // type before any entity would refuse this model.
  const original = build(4);
  const envelope = buildShareEnvelope(original, []);
  const importedId = importModelFromEnvelope(envelope);
  const imported = sandbox.projectState()[importedId];

  check('a model with a standalone type naming an entity-derived id round-trips', () => {
    eq(definitionsToSchema(imported), definitionsToSchema(original), 'the reconstructed model');
  });

  check('the imported model is independently valid — its own commands still run', () => {
    const log = [];
    drive(imported, log, 'DefineProduct', { productId: 'p1', price: 500 });
    eq(foldEntityProperty(imported, log, 'Product', 'currentPrice', 'p1'), 500, 'the price DefineProduct set');
  });
}

{
  // A scripted entity property cannot go through the bare pass with
  // empty handlers the way a declared one can (`validateScript`
  // requires at least one), so it has to be left out of the bare
  // entity entirely and added whole once events exist.
  const original = openScripted().model();
  const importedId = importModelFromEnvelope(buildShareEnvelope(original, []));
  const imported = sandbox.projectState()[importedId];

  check('a model with a scripted entity property round-trips', () => {
    eq(definitionsToSchema(imported), definitionsToSchema(original), 'the reconstructed model');
  });

  check('the imported scripted property still folds', () => {
    const log = [];
    drive(imported, log, 'Tick', { counterId: 'x1' });
    eq(foldEntityProperty(imported, log, 'Counter', 'total', 'x1'), 1, 'one tick folded');
  });
}

{
  const plain = build(4);
  const scripted = openScripted().model(); // a scripted entity property

  check('envelopeHasScript is false for a model with no scripts', () => {
    eq(envelopeHasScript(buildShareEnvelope(plain, [])), false, 'plain model');
  });
  check('envelopeHasScript is true for a scripted entity property', () => {
    eq(envelopeHasScript(buildShareEnvelope(scripted, [])), true, 'scripted model');
  });

  // None of the shipped models have a scripted *projection* (only the
  // scripted property above), so this checks that side with a small
  // ad-hoc one instead.
  const { id, model } = openBlank();
  addDefinition('custom-type-definition', id, 'RegionCode', { schema: { type: 'string' }, isTag: true });
  addDefinition('event-definition', id, 'RegionOpened', {
    properties: [{ name: 'regionCode', propertyType: 'RegionCode', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'OpenRegionCount', {
    valueType: 'integer',
    isList: false,
    script: { initialState: 0, tagFilter: ['RegionCode:{region}'], arguments: [{ name: 'region', propertyType: 'RegionCode' }] },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });
  check('envelopeHasScript is true for a scripted (standalone) projection', () => {
    eq(envelopeHasScript(buildShareEnvelope(model(), [])), true, 'scripted projection');
  });
}

{
  // Scenarios are the one kind identified by a generated id rather than
  // a name, so they are the only kind whose identity a round trip could
  // quietly change. It does not: the exported id is what comes back, so
  // a model that goes out and comes in is the same model and a
  // re-import can be diffed against what was sent.
  const { id, model } = openBlank();
  addDefinition('event-definition', id, 'ThingHappened', { properties: [] });
  addDefinition('command-definition', id, 'DoThing', {
    properties: [], boundary: [], conditions: [],
    publishes: [{ name: 'ThingHappened', parameters: {} }],
  });
  const body = { command: 'DoThing', given: [], when: { arguments: {} } };
  body.then = deriveThen(model(), body);
  const originalScenarioId = generateId();
  addDefinition('scenario-definition', id, originalScenarioId, body);

  const envelope = buildShareEnvelope(model(), []);
  const importedId = importModelFromEnvelope(envelope);
  const imported = sandbox.projectState()[importedId];
  const importedScenarioIds = Object.keys(imported['scenario-definitions']);

  check('an imported scenario keeps both its content and its id', () => {
    eq(importedScenarioIds.length, 1, 'exactly one scenario carried over');
    eq(importedScenarioIds[0], originalScenarioId, 'the exported id, not a fresh one');
    eq(imported['scenario-definitions'][importedScenarioIds[0]].command, 'DoThing', 'the scenario body itself');
  });
}

check('an import missing the definition arrays is refused, not silently accepted', () => {
  let threw = false;
  try { importModelFromEnvelope({ name: 'Bad' }); } catch (error) { threw = !!error; }
  eq(threw, true, 'an envelope with nothing but a name');
});

// The two markers on the wire format, and the ladder an importer walks
// down them: both must be there, the major must match, and a newer
// minor is read rather than refused — the one rung that lets the format
// grow without every older playground rejecting the result.
{
  const { model } = openBlank('Marked');
  const good = buildShareEnvelope(model(), []);
  const refuses = (envelope, label) => {
    let threw = false;
    try { importModelFromEnvelope(envelope); } catch (error) { threw = !!error; }
    eq(threw, true, label);
  };

  // Both spelled out rather than read back from the constants they came
  // from: these two strings are the published contract, and a test that
  // derived them from the source could not notice one of them changing.
  check('an export carries both markers', () => {
    eq(good.$schema, 'https://dcb.events/schemas/model/v3.json', '$schema');
    eq(/^3\.\d+$/.test(good.dcbModelVersion), true, 'dcbModelVersion is a 3.x');
  });

  check('the definition arrays sit at the top level, under no wrapper', () => {
    eq(good.context, undefined, 'no `context` wrapper');
    eq(good.model, undefined, 'no `model` wrapper either');
    eq(Array.isArray(good.eventDefinitions), true, 'eventDefinitions is a top-level list');
    eq(Array.isArray(good.commandDefinitions), true, 'commandDefinitions is a top-level list');
  });

  check('an import missing a required definition kind is refused', () => {
    refuses({ ...good, eventDefinitions: undefined }, 'no eventDefinitions');
    refuses({ ...good, entityDefinitions: undefined }, 'no entityDefinitions');
    refuses({ ...good, commandDefinitions: 'nope' }, 'commandDefinitions not a list');
  });

  check('an import without either marker is refused', () => {
    refuses({ ...good, $schema: undefined }, 'no $schema');
    refuses({ ...good, dcbModelVersion: undefined }, 'no dcbModelVersion');
    refuses({ ...good, dcbModelVersion: 'v1' }, 'an unparseable version');
  });

  check('an import from an unknown major is refused', () => {
    refuses({ ...good, dcbModelVersion: '4.0' }, 'a newer major');
    // 2.x is where a projection scenario read several projections under
    // aliases — readable as JSON, and misread as a model.
    refuses({ ...good, dcbModelVersion: '2.0' }, 'the major before this one');
    refuses({ ...good, dcbModelVersion: '1.0' }, 'and the one before that');
  });

  check('$schema is required but never read, so a repointed one still imports', () => {
    const local = { ...good, $schema: './dcb-model.schema.json' };
    eq(typeof importModelFromEnvelope(local), 'string', 'imported anyway');
  });

  check('a newer minor imports, and says what it is dropping', () => {
    const newer = { ...good, dcbModelVersion: '3.99' };
    eq(typeof importModelFromEnvelope(newer), 'string', 'imported');
    eq(envelopeVersionWarning(newer).length > 0, true, 'warned');
    eq(envelopeVersionWarning(good), '', 'nothing to warn about at the current version');
  });

  check('an import with no name is refused rather than named for the user', () => {
    refuses({ ...good, name: undefined }, 'no name');
    refuses({ ...good, name: '' }, 'an empty name');
  });
}

// ---------------------------------------------------------------
// 18. One kind of fold.
//
// An entity property is a binding to an ordinary projection, so the
// things that used to be true of only one of them are now true of
// both — and the things that told them apart are gone.
// ---------------------------------------------------------------
{
  const refuses = (pattern, what, fn) => check(what, () => {
    try {
      fn();
    } catch (error) {
      if (!pattern.test(error.message)) throw new Error(`wrong message: ${error.message}`);
      return;
    }
    throw new Error('did not refuse');
  });

  check('a property and a direct read of the same projection agree', () => {
    const model = build(0);
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 7 });
    // Through the entity, and through the projection it binds. Same
    // fold, reached two ways.
    eq(foldEntityProperty(model, log, 'Course', 'capacity', 'c1'), 7, 'as a property');
    eq(foldProjection(model, log, 'CourseCapacity', { courseId: 'c1' }), 7, 'as a projection');
  });

  check('one projection may be bound by two entities that share an identifier', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Course', { properties: [] });
    addDefinition('event-definition', id, 'CourseDefined', {
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'CourseExists', {
      parameters: [{ name: 'courseId', propertyType: 'CourseId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'CourseDefined', operation: 'set', value: true }],
    });
    // Two names for one fold, on the same entity — legal, and the
    // point of a property being a reference rather than a definition.
    updateDefinition('entity-definition', id, 'Course', {
      properties: [
        { name: 'exists', projection: 'CourseExists' },
        { name: 'isDefined', projection: 'CourseExists' },
      ],
    });
    const log = [{ type: 'CourseDefined', data: { courseId: 'c1' } }];
    eq(foldEntityProperty(model(), log, 'Course', 'exists', 'c1'), true, 'under one name');
    eq(foldEntityProperty(model(), log, 'Course', 'isDefined', 'c1'), true, 'under the other');
  });

  check('a bound projection cannot be deleted out from under its property', () => {
    const { id } = open_(0);
    try {
      removeDefinition('projection-definition', id, 'CourseCapacity');
      throw new Error('did not refuse');
    } catch (error) {
      if (!/still referenced by/.test(error.message)) throw error;
    }
  });

  check('renaming a projection moves every property that binds it', () => {
    const { id, model } = open_(0);
    renameDefinition('projection-definition', id, 'CourseCapacity', 'CourseSeats');
    const course = model()['entity-definitions'].Course;
    eq(course.properties.find((p) => p.name === 'capacity').projection, 'CourseSeats', 'the binding followed');
    const log = [];
    drive(model(), log, 'DefineCourse', { courseId: 'c1', capacity: 4 });
    eq(foldEntityProperty(model(), log, 'Course', 'capacity', 'c1'), 4, 'still folds');
  });

  refuses(/exactly one parameter typed CourseId/,
    'a projection partitioned by nothing cannot be an entity property', () => {
      const { id } = open_(1);
      // CourseNumbering is global — there is no instance for a
      // property binding to name.
      updateDefinition('entity-definition', id, 'Course', {
        icon: '📚', properties: [{ name: 'numbering', projection: 'CourseNumbering' }],
      });
    });

  refuses(/would leave it without the CourseId-typed slot/,
    'a bound projection cannot have its partition reshaped', () => {
      const { id, model } = open_(0);
      const body = { ...deepClone(model()['projection-definitions'].CourseCapacity), parameters: [] };
      updateDefinition('projection-definition', id, 'CourseCapacity', body);
    });

  check('a scripted projection bound as a property is scoped by the instance', () => {
    const { model } = openScripted();
    const log = [
      { type: 'Ticked', data: { counterId: 'x1' } },
      { type: 'Ticked', data: { counterId: 'x2' } },
      { type: 'Ticked', data: { counterId: 'x1' } },
    ];
    eq(foldEntityProperty(model(), log, 'Counter', 'total', 'x1'), 2, 'x1 counted its own');
    eq(foldEntityProperty(model(), log, 'Counter', 'total', 'x2'), 1, 'x2 counted its own');
  });

  refuses(/never interpolates "\{counterId\}"/,
    'a scripted projection that ignores the instance cannot be bound as a property', () => {
      const { id } = openScripted();
      const body = {
        valueType: 'integer', isList: false,
        script: {
          initialState: 0, tagFilter: [],
          arguments: [{ name: 'counterId', propertyType: 'CounterId' }],
        },
        handlers: [{ event: 'Ticked', code: '(state || 0) + 1' }],
      };
      addDefinition('projection-definition', id, 'GlobalTicks', body);
      updateDefinition('entity-definition', id, 'Counter', {
        properties: [{ name: 'ticks', projection: 'GlobalTicks' }],
      });
    });
}

// ---------------------------------------------------------------
// 19. Initial values: typed, and `null` is one of them.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();
  addDefinition('custom-type-definition', id, 'Colour', {
    schema: { type: 'string', enum: ['Red', 'Green'] },
  });
  addDefinition('custom-type-definition', id, 'Slot', { schema: { type: 'string' } });
  addDefinition('event-definition', id, 'Nudged', { properties: [] });

  const add = (name, body) => addDefinition('projection-definition', id, name, {
    parameters: [], isList: false, handlers: [], ...body,
  });
  const refused = (body) => {
    try {
      add('Attempt' + Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, 'x'), body);
    } catch (error) {
      return error.message;
    }
    return null;
  };

  check('null is a legal initial value of every type', () => {
    add('NoNumberYet', { valueType: 'integer', initialValue: null });
    add('NoTextYet', { valueType: 'string', initialValue: null });
    add('NoFlagYet', { valueType: 'boolean', initialValue: null });
    add('NoColourYet', { valueType: 'Colour', initialValue: null });
    eq(model()['projection-definitions'].NoNumberYet.initialValue, null, 'stored as null');
  });

  check('null and the empty string are different stored values', () => {
    add('EmptyText', { valueType: 'string', initialValue: '' });
    const stored = model()['projection-definitions'];
    eq(stored.NoTextYet.initialValue, null, 'no value yet');
    eq(stored.EmptyText.initialValue, '', 'an empty string');
    eq(stored.NoTextYet.initialValue === stored.EmptyText.initialValue, false, 'never conflated');
  });

  check('a list may start non-empty, with typed elements', () => {
    add('Reserved', { valueType: 'Slot', isList: true, initialValue: ['a', 'b'] });
    eq(model()['projection-definitions'].Reserved.initialValue, ['a', 'b'], 'kept whole');
    eq(foldProjection(model(), [], 'Reserved', {}), ['a', 'b'], 'and folds to it');
  });

  check('an initial value is checked against the declared type', () => {
    eq(/is not a integer/.test(refused({ valueType: 'integer', initialValue: 'lots' })), true, 'text for an integer');
    eq(/is not a boolean/.test(refused({ valueType: 'boolean', initialValue: 1 })), true, 'a number for a boolean');
    eq(/not a literal/.test(refused({ valueType: 'Slot', isList: true, initialValue: ['a', null] })), true,
      'null inside a list');
    eq(/is a list/.test(refused({ valueType: 'Slot', initialValue: ['a'] })), true, 'a list for a single value');
    eq(/its initial value is one/.test(refused({ valueType: 'Slot', isList: true, initialValue: 'a' })), true,
      'a single value for a list');
    eq(/not a member of Colour/.test(refused({ valueType: 'Colour', initialValue: { enumMember: 'Blue' } })), true,
      'an enum member that does not exist');
    eq(/is an enum/.test(refused({ valueType: 'Colour', initialValue: 'Red' })), true,
      'a bare literal where a member reference belongs');
  });

  check('a projection nothing moves yet is legal and reads as where it starts', () => {
    add('Untouched', { valueType: 'integer', initialValue: 41, handlers: [] });
    eq(foldProjection(model(), [{ type: 'Nudged', data: {} }], 'Untouched', {}), 41, 'nothing moved it');
  });

  check('an integer projection is offered increment and decrement', () => {
    // The operations a standalone projection may use come from its own
    // declared type, exactly as an entity property's always did.
    add('Nudges', {
      valueType: 'integer', initialValue: 0,
      handlers: [{ event: 'Nudged', operation: 'increment', value: 1 }],
    });
    eq(foldProjection(model(), [{ type: 'Nudged', data: {} }, { type: 'Nudged', data: {} }], 'Nudges', {}),
      2, 'incremented twice');
  });
}

// ---------------------------------------------------------------
// 20. Scenarios over projections.
//
// One projection per scenario, and its Then is that projection's value.
// Asserting four properties of a course over one Given is four
// scenarios sharing that Given — each answerable, each drifting alone.
// ---------------------------------------------------------------
{
  const store_ = (id, model, body) => {
    const complete = { ...body, then: deriveProjectionScenarioThen(model, body) };
    const key = generateId();
    addDefinition('projection-scenario-definition', id, key, complete);
    return key;
  };

  check('a scenario over a global numbering derives what it issues next', () => {
    const { id, model } = open_(1);
    const key = store_(id, model(), {
      projection: 'CourseNumbering',
      arguments: {},
      given: [
        { event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } },
        { event: 'CourseDefined', data: { courseId: 'c2', capacity: 5 } },
      ],
    });
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.then, 'c3', 'the next id to issue');
    eq(runProjectionScenario(model(), stored).status, 'current', 'and it runs current');
  });

  check('a scenario over a parameterised projection is per partition', () => {
    const { id, model } = open_(2);
    const given = [
      { event: 'TenantRegistered', data: { tenantId: 't1' } },
      { event: 'CourseDefined', data: { tenantId: 't1', courseId: 'c1', capacity: 1, courseNumber: '1' } },
      { event: 'CourseDefined', data: { tenantId: 't2', courseId: 'c2', capacity: 1, courseNumber: '1' } },
    ];
    // Three scenarios rather than three reads: the same Given, asked
    // three questions, each of which can drift without the others.
    const at = (tenantId) => {
      const key = store_(id, model(), { projection: 'TenantCourseNumbering', arguments: { tenantId }, given });
      // Read the model *after* the write: a member expression evaluates
      // its object before its key, so indexing model() inline would
      // look in the snapshot taken before this scenario was added.
      return model()['projection-scenario-definitions'][key].then;
    };
    eq([at('t1'), at('t2'), at('t3')], ['2', '2', '1'], 'each tenant counted on its own');
  });

  check('an entity property and a standalone projection are asserted the same way', () => {
    const { id, model } = open_(1);
    const given = [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 9 } }];
    const capacity = store_(id, model(), {
      projection: 'CourseCapacity', arguments: { courseId: 'c1' }, given,
    });
    const numbering = store_(id, model(), {
      projection: 'CourseNumbering', arguments: {}, given,
    });
    eq(model()['projection-scenario-definitions'][capacity].then, 9, 'the bound one');
    eq(model()['projection-scenario-definitions'][numbering].then, 'c2',
      'and the standalone one, in the same shape');
  });

  check('a value a projection really holds is not mistaken for an absent Then', () => {
    const { id, model } = open_(1);
    // `null`, `0` and `[]` are answers. A Then read by truthiness would
    // call all three "not run yet".
    const key = store_(id, model(), {
      projection: 'CourseSubscribedStudentIds', arguments: { courseId: 'c1' }, given: [],
    });
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.then, [], 'an empty list is what it folds to');
    eq(runProjectionScenario(model(), stored).status, 'current', 'and it runs current, not broken');
  });

  check('changing what a projection does is reported as drift', () => {
    const { id, model } = open_(1);
    const key = store_(id, model(), {
      projection: 'CourseNumbering', arguments: {},
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } }],
    });
    // Stop it advancing at all, so the fold is its initial value again
    // rather than the successor of what CourseDefined carried.
    const body = deepClone(model()['projection-definitions'].CourseNumbering);
    body.handlers = [];
    updateDefinition('projection-definition', id, 'CourseNumbering', body);
    const result = runProjectionScenario(model(), model()['projection-scenario-definitions'][key]);
    eq(result.status, 'drifted', 'status');
    eq([result.expected, result.actual], ['c2', 'c1'], 'what it was, and what it is now');
  });

  check('a scenario never stops you deleting the projection it is about', () => {
    const { id, model } = open_(1);
    const key = store_(id, model(), {
      projection: 'CourseNumbering', arguments: {}, given: [],
    });
    // Only the scenario and the command read it; drop the command first,
    // and the scenario must not be what refuses.
    const define = deepClone(model()['command-definitions'].DefineCourse);
    define.properties = [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
      { name: 'capacity', propertyType: 'integer', isOptional: false, isList: false }];
    // Supplying the id instead of minting it — which is what makes the
    // numbering unreferenced, and the point of the check.
    define.boundary = [{ alias: 'course', entity: 'Course', id: { parameterName: 'courseId' } }];
    define.publishes[0].parameters.courseId = { parameterName: 'courseId' };
    updateDefinition('command-definition', id, 'DefineCourse', define);
    removeDefinition('projection-definition', id, 'CourseNumbering');
    eq('CourseNumbering' in model()['projection-definitions'], false, 'gone');
    eq(runProjectionScenario(model(), model()['projection-scenario-definitions'][key]).status,
      'broken', 'and the scenario says so rather than passing');
  });

  check('renaming a projection carries every scenario about it', () => {
    const { id, model } = open_(1);
    const key = store_(id, model(), {
      projection: 'CourseNumbering', arguments: {},
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } }],
    });
    renameDefinition('projection-definition', id, 'CourseNumbering', 'CourseIds');
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.projection, 'CourseIds', 'the reference followed');
    eq(runProjectionScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming an event moves a projection scenario Given with it', () => {
    const { id, model } = open_(1);
    const key = store_(id, model(), {
      projection: 'CourseNumbering', arguments: {},
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } }],
    });
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseOpened');
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.given[0].event, 'CourseOpened', 'the Given followed');
    eq(runProjectionScenario(model(), stored).status, 'current', 'still current');
  });

  check('a scenario that supplies the wrong arguments is refused', () => {
    const { id } = open_(2);
    const bad = (body, pattern) => {
      try {
        addDefinition('projection-scenario-definition', id, generateId(),
          { given: [], then: null, ...body });
        throw new Error('did not refuse');
      } catch (error) {
        if (!pattern.test(error.message)) throw new Error(`wrong message: ${error.message}`);
      }
    };
    bad({ projection: 'TenantCourseNumbering', arguments: {} }, /supplies no "tenantId"/);
    bad({ projection: 'CourseNumbering', arguments: { tenantId: 't1' } },
      /does not declare as a parameter/);
    bad({ projection: 'NoSuchThing', arguments: {} }, /does not exist in this model/);
  });

  check('a scenario knows whether running it would execute a script', () => {
    const { model } = openScripted();
    eq(projectionScenarioTouchesScript(model(), { projection: 'CounterTotal' }), true,
      'is about a scripted one');
    eq(projectionScenarioTouchesScript(build(1), { projection: 'CourseNumbering' }), false,
      'declared only');
  });

  check('a scenario over a scripted projection folds through its tag filter', () => {
    const { id, model } = openScripted();
    const given = [
      { event: 'Ticked', data: { counterId: 'x1' } },
      { event: 'Ticked', data: { counterId: 'x2' } },
      { event: 'Ticked', data: { counterId: 'x1' } },
    ];
    const at = (counterId) => {
      const key = store_(id, model(), { projection: 'CounterTotal', arguments: { counterId }, given });
      return model()['projection-scenario-definitions'][key].then;
    };
    eq([at('x1'), at('x2')], [2, 1], 'each counter counted its own');
  });

  check('a projection scenario round-trips through an export', () => {
    const { id, model } = open_(1);
    store_(id, model(), {
      projection: 'CourseNumbering', arguments: {},
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } }],
    });
    const envelope = buildShareEnvelope(model(), []);
    // Two ship with this model, and this is the third.
    eq(envelope.projectionScenarioDefinitions.length, 3, 'exported');
    const before = definitionsToSchema(model());
    const importedId = importModelFromEnvelope(envelope);
    const imported = sandbox.projectState()[importedId];
    if (!imported) throw new Error('import produced no model for id ' + importedId);
    eq(definitionsToSchema(imported), before, 'the definitions came back');
    const stored = Object.values(imported['projection-scenario-definitions'])[0];
    eq(runProjectionScenario(imported, stored).status, 'current', 'and it still runs current');
  });
}

// ---------------------------------------------------------------
// `excluding` on a fanned binding compacts the instance list, but a
// zipped parameter is still read at each instance's original fan-out
// index — the pairing must not shift.
// ---------------------------------------------------------------
{
  const model = build(4);

  check('an excluded line does not shift the price pairing of the rest', () => {
    const log = [];
    drive(model, log, 'DefineProduct', { productId: 'p1', price: 100 });
    drive(model, log, 'DefineProduct', { productId: 'p2', price: 250 });
    drive(model, log, 'DefineProduct', { productId: 'p3', price: 400 });
    const modified = deepClone(model);
    const command = modified['command-definitions'].OrderProducts;
    command.properties.push({ name: 'skipProductId', propertyType: 'ProductId', isOptional: false, isList: false });
    command.boundary.find((b) => b.alias === 'product').excluding = { parameterName: 'skipProductId' };
    // The middle line is excluded and priced wrong on purpose: with the
    // pairing kept by source index, p1 and p3 are each checked against
    // their own submitted price and the order goes through. Read at the
    // compacted index instead, and p3 would be checked against p2's 999.
    const result = evaluateCommand(modified, log, 'OrderProducts', {
      orderId: 'o1',
      skipProductId: 'p2',
      items: [
        { productId: 'p1', price: 100 },
        { productId: 'p2', price: 999 },
        { productId: 'p3', price: 400 },
      ],
    });
    eq(result.outcome, 'published', 'outcome');
  });
}

// ---------------------------------------------------------------
// The event store: an unreadable log is moved aside, never sat on
// where the next append would overwrite the only copy.
// ---------------------------------------------------------------
{
  open_(0);
  const logKey = [...store.keys()].find((k) => /:events:v\d+$/.test(k));

  check('a corrupt log is moved aside rather than erased on the next append', () => {
    store.set(logKey, '{not json');
    eq(sandbox.projectState(), {}, 'projects empty');
    eq(store.get(logKey + ':corrupt'), '{not json', 'raw value preserved');
    eq(store.has(logKey), false, 'live key cleared');
    const id = sandbox.createDcbModel('Fresh');
    eq(Object.keys(sandbox.projectState()), [id], 'append starts a fresh log');
    eq(store.get(logKey + ':corrupt'), '{not json', 'backup untouched');
  });

  check('a stored value that is not an array is treated the same', () => {
    store.set(logKey, '{}');
    eq(sandbox.projectState(), {}, 'projects empty');
    eq(store.get(logKey + ':corrupt'), '{}', 'raw value preserved');
  });
}

// ---------------------------------------------------------------
// Validation: identifier operands are judged by structure, not by
// their rendered text — a literal may contain '?' and still be a
// value, while an operand missing its name is a gap however it prints.
// ---------------------------------------------------------------
{
  const { id, model } = open_(0);

  check('a literal identifier containing "?" is a value, not a gap', () => {
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    // The emission writes the same literal, so write coverage still
    // sees the tag the boundary consults — only the '?' is under test.
    body.boundary[0].id = 'what?';
    body.publishes[0].parameters.courseId = 'what?';
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    eq(model()['command-definitions'].ChangeCourseCapacity.boundary[0].id, 'what?', 'stored');
  });

  check('an identifier operand missing its name is still refused', () => {
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary[0].id = { parameterName: '' };
    try {
      updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    } catch (error) {
      if (error.name !== 'DomainError') throw new Error(`threw ${error.name}: ${error.message}`);
      return;
    }
    throw new Error('did not refuse');
  });
}

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
