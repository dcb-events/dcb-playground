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
// required — the sandbox, the loader and the assertions live in
// `test-harness.js`, shared with the other two suites.
// ============================================================
const { createSandbox, loadApp, makeChecker } = require('./test-harness.js');

const { sandbox, store } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js']);
const { check, eq, finish } = makeChecker();

// Clearing the store is a write `appendEvents` never sees, so the
// projection cache is told the world moved underneath it.
function resetStore() {
  store.clear();
  sandbox.bumpLogRevision();
}

function build(index) {
  resetStore();
  const id = sandbox.loadPredefinedModel(index);
  return sandbox.projectState()[id];
}

// The same, but keeping the id, so a test can drive the editing
// commands and read the model back after each one.
function open_(index) {
  resetStore();
  const id = sandbox.loadPredefinedModel(index);
  return { id, model: () => sandbox.projectState()[id] };
}

const {
  evaluateCommand, foldEntityProperty, foldProjection, foldProjectionState, tagsOfEvent,
  deriveThen, runScenario, setScriptsDisabled,
  deriveProjectionScenarioThen, runProjectionScenario,
  addDefinition, updateDefinition, removeDefinition, renameDefinition, renameMember, reorderDefinitions,
  createDcbModel,
  generateId, scenarioName, deepClone, evSuccessor,
  definitionsToSchema, buildShareEnvelope, importModelFromEnvelope, envelopeHasScript,
  envelopeVersionWarning, modelMatchingEnvelope, commandRejections,
} = sandbox;

// An event a fixture adds, tagged by every tag-typed value it holds —
// what an author listing them all would write. Events are tagged only
// by what they list (8.0); fixtures that test the list itself spell
// `tags` out, and this leaves a given list alone.
function addTaggedEvent(id, name, body) {
  const tags = body.tags || sandbox.tagPathsOf(sandbox.projectState()[id], body.properties);
  return sandbox.addDefinition('event-definition', id, name, { ...body, tags });
}

// A fresh, empty model — for the ad-hoc identifier-type fixtures
// below, which want a minimal model rather than one of the five shipped
// models.
function openBlank(name) {
  resetStore();
  const id = createDcbModel(name || 'Ad-hoc');
  return { id, model: () => sandbox.projectState()[id] };
}

// A fresh model with a scripted projection bound as an entity property
// — for scripted-content tests (script round-tripping,
// `envelopeHasScript`, safe mode) that need a fixture no
// PREDEFINED_MODELS example carries. `Tick` reads the script through
// its boundary.
//
// The script declares no partition, like every projection: binding it
// as `Counter.total` reads it tagged by the counter's identifier.
function openScripted() {
  const { id, model } = openBlank('Scripted');
  addDefinition('entity-definition', id, 'Counter', { properties: [] });
  addTaggedEvent(id, 'Ticked', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'CounterTotal', {
    valueType: 'integer',
    isList: false,
    script: { initialState: 0 },
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
  return { id, model };
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
    eq(foldEntityProperty(model, log, 'Student', 'exists', 's1'), true, 'the student exists');
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
      { kind: 'projection', projection: 'CourseNumbering', tags: [], arguments: {}, value: 'c1' }, 'reads');
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
    eq(foldProjection(model, log, 'TenantCourseNumbering', { tags: [{ type: 'TenantId', value: 't1' }] }), '3', 't1 next');
    eq(foldProjection(model, log, 'TenantCourseNumbering', { tags: [{ type: 'TenantId', value: 't2' }] }), '2', 't2 next');
  });

  check('a course cannot be defined for an unregistered tenant', () => {
    const result = evaluateCommand(model, [], 'DefineCourse', { tenantId: 't9', capacity: 5 });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'tenant.exists isTrue', 'rule');
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
  broken('a projection read tagged by no value is broken',
    () => foldProjection(build(2), [], 'TenantCourseNumbering', { tags: [{ type: 'TenantId', value: null }] }));
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
    eq(scenarioName({ then: { outcome: 'rejected', rejection: 'Course is not active' } }),
      'is refused: Course is not active', 'rejected');
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
    eq(result.actual, { outcome: 'rejected', events: [], rejection: 'Student is subscribed to too many courses' },
      'the message it is refused with now, and nothing else');
  });

  // Nothing has happened, so the course rule refuses first; the
  // student's course count holds (no subscriptions yet), and the
  // student's existence would refuse too if it were asked first.
  const refused = () => ({ ...scenarioBody(), given: [] });
  const moveToFront = (model, id, pick) => {
    const command = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    const at = command.conditions.findIndex(pick);
    command.conditions.unshift(...command.conditions.splice(at, 1));
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', command);
  };

  check('moving rules is not drift while the same rule refuses', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), refused());
    const before = model()['scenario-definitions'][key].then;
    moveToFront(model, id, (c) => c.leftHandSide.alias === 'student'
      && c.leftHandSide.property === 'subscriptionCount');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.actual.rejection, before.rejection, 'the same rule still refuses');
    eq(result.status, 'current', 'and that is not a change in behaviour');
  });

  check('moving rules so another refuses first is drift', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), refused());
    const before = model()['scenario-definitions'][key].then;
    moveToFront(model, id, (c) => c.leftHandSide.alias === 'student'
      && c.leftHandSide.property !== 'subscriptionCount');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.actual.rejection === before.rejection, false, 'a different message refuses now');
    eq(result.status, 'drifted', 'which is what a refusal names, so it drifts');
  });

  check('rules sharing a message are one outcome, whichever of them refuses', () => {
    const { id, model } = open_(0);
    const key = store_(id, model(), refused());
    eq(model()['scenario-definitions'][key].then.rejection, 'Course is not active', 'the course rule refuses');
    // The student rule now says the same thing, and is moved ahead, so
    // it refuses first — but the outcome is the one the scenario names.
    const command = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    command.conditions.find((c) => c.leftHandSide.alias === 'student' && c.predicate === 'isTrue')
      .rejection = 'Course is not active';
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', command);
    moveToFront(model, id, (c) => c.leftHandSide.alias === 'student' && c.predicate === 'isTrue');
    const run = evaluateCommand(model(), [], 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(run.failedRule.text, 'student.exists isTrue', 'another rule refuses now');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.actual.rejection, 'Course is not active', 'with the same message');
    eq(result.status, 'current', 'so the outcome is the same, whatever that rule read');
    eq(commandRejections(model()['command-definitions'].SubscribeStudentToCourse)
      .find((o) => o.rejection === 'Course is not active').rules.length, 2, 'listed once, with both rules');
  });

  check('a refusal by a rule without a message is not an outcome a scenario can name', () => {
    const { id, model } = open_(0);
    const command = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    delete command.conditions[0].rejection;
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', command);
    const result = runScenario(model(), { ...refused(), then: { outcome: 'rejected', events: [],
      rejection: 'Course is not active' } });
    eq(result.status, 'broken', 'broken, since the repair is the rule\'s');
    eq(/has no rejection message/.test(result.reason), true, result.reason);
    const run = evaluateCommand(model(), [], 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq([run.failedRule.rejection, run.failedRule.text], [null, 'course.status == Existent'],
      'a run still says which rule it was');
    eq(sandbox.modelAdvisories(model()).some((a) => /has no rejection message/.test(a.message)), true, 'and it is advised');
  });

  check('a rejection message is advised where it is missing, malformed, or on a guard', () => {
    const { id, model } = open_(0);
    const command = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    command.conditions[1].rejection = '';
    command.conditions[2].rejection = 'two\nlines';
    command.publishes[0].when = [{ leftHandSide: { alias: 'course', property: 'subscriptionCount' },
      predicate: 'lessThan', rightHandSide: 5, rejection: 'Never shown' }];
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', command);
    const found = sandbox.modelAdvisories(model()).filter((a) => a.name === 'SubscribeStudentToCourse')
      .map((a) => a.message);
    eq(found.some((m) => /rejection message of "student.exists isTrue" is empty/.test(m)), true, 'empty: ' + found);
    eq(found.some((m) => /spans several lines/.test(m)), true, 'several lines');
    eq(found.some((m) => /a guard never rejects/.test(m)), true, 'on a guard');
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

  check('a payload with a property the event does not have is stored, not refused', () => {
    // The lenient regime: an invented payload property is inert — the
    // folds never read it — so storing it beats refusing the scenario.
    const { id, model } = open_(0);
    const body = scenarioBody();
    body.then = deriveThen(model(), body);
    body.given[0].data.colour = 'blue';
    const key = generateId();
    addDefinition('scenario-definition', id, key, body);
    const stored = model()['scenario-definitions'][key];
    eq(stored.given[0].data.colour, 'blue', 'kept as written');
    eq(runScenario(model(), stored).status, 'current', 'and ignored by the run');
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
      kind: 'projection', projection: 'CourseNumbering', tags: [], arguments: {}, value: 'c1',
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
  addTaggedEvent(id, 'WidgetDefined', {
    properties: [{ name: 'widgetId', propertyType: 'WidgetId', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'WidgetIsDefined', {
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
  addTaggedEvent(id, 'CourseDefined', {
    properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
  });
  addTaggedEvent(id, 'InvoiceRaised', {
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

  check('a successor over a composite saves, and the advisory says why it cannot work', () => {
    addDefinition('projection-definition', id, 'LastCourseId', {
      parameters: [],
      valueType: 'CourseId',
      isList: false,
      initialValue: null,
      handlers: [{ event: 'CourseDefined', operation: 'set', value: { successor: { eventProperty: 'courseId' } } }],
    });
    const flagged = sandbox.modelAdvisories(model())
      .filter((a) => a.name === 'LastCourseId');
    eq(flagged.length, 1, 'one advisory on the projection');
    eq(/which is a composite/.test(flagged[0].message), true, 'the old refusal, now advice');
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
    addTaggedEvent(id, 'GadgetDefined', {
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
    addTaggedEvent(id, 'GizmoDefined', {
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
    addTaggedEvent(id, 'SprocketDefined', {
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
    addTaggedEvent(id, 'CourseNumberIssued', {
      properties: [{ name: 'number', propertyType: 'CourseNumber', isOptional: false, isList: false }],
    });
    renameDefinition('custom-type-definition', id, 'CourseNumber', 'CourseRef');
    eq('CourseRef' in model()['custom-type-definitions'], true, 'renamed');
    eq('CourseNumber' in model()['custom-type-definitions'], false, 'old name gone');
    eq(model()['event-definitions'].CourseNumberIssued.properties[0].propertyType, 'CourseRef',
      'the reference followed the rename');
    eq(tagsOfEvent(model(), 'CourseNumberIssued', { number: 'c1' }), ['CourseRef:c1'], 'tag follows too');
  });

  check('an ordinary update may change identifierType, and the dangling type is an advisory', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Anvil', { properties: [] });
    updateDefinition('entity-definition', id, 'Anvil', {
      identifierType: 'AnvilRef', properties: [],
    });
    eq(model()['entity-definitions'].Anvil.identifierType, 'AnvilRef', 'the update went through');
    // Nothing created "AnvilRef", and that is now the entity's problem
    // to report rather than the update's to refuse.
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'Anvil' && /AnvilRef/.test(a.message)
    ), true, 'the unresolved identifier type is reported');
  });

  check('removing an entity-owned value type directly leaves the entity advisory-flagged', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Bolt', { properties: [] });
    removeDefinition('custom-type-definition', id, 'BoltId');
    eq('BoltId' in model()['custom-type-definitions'], false, 'removed, not refused');
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'Bolt' && /BoltId/.test(a.message)
    ), true, 'the entity reports its missing identifier type');
    removeDefinition('entity-definition', id, 'Bolt');
    eq('Bolt' in model()['entity-definitions'], false, 'entity removed');
  });

  check('an emission copying a differently typed value into an event field is an advisory', () => {
    const { id, model } = openBlank();
    addDefinition('custom-type-definition', id, 'ProductId', { schema: { type: 'string' }, isTag: true });
    addDefinition('custom-type-definition', id, 'Money', { schema: { type: 'number' } });
    const fields = (price) => [
      { name: 'productId', propertyType: 'ProductId' }, { name: price, propertyType: 'Money' },
    ];
    addDefinition('custom-type-definition', id, 'CartLine', { properties: fields('displayedPrice') });
    addDefinition('custom-type-definition', id, 'Item', { properties: fields('price') });
    addTaggedEvent(id, 'ProductsOrdered', {
      properties: [{ name: 'items', propertyType: 'Item', isOptional: false, isList: true }],
    });
    const command = (propertyType) => ({
      properties: [{ name: 'items', propertyType, isOptional: false, isList: true }],
      boundary: [], conditions: [],
      publishes: [{ name: 'ProductsOrdered', parameters: { items: { parameterName: 'items' } } }],
    });
    addDefinition('command-definition', id, 'OrderProducts', command('CartLine'));
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'OrderProducts' && /ProductsOrdered\.items" is declared Item\[\].*CartLine\[\]/.test(a.message)
    ), true, 'the mismatch is reported, not refused');
    updateDefinition('command-definition', id, 'OrderProducts', command('Item'));
    eq(sandbox.modelAdvisories(model()).filter((a) => a.name === 'OrderProducts'), [], 'matching types are clean');
  });
}

// ---------------------------------------------------------------
// 17. A read's tag is rendered through its tag type's own `tagSchema`,
// which need not use `:` at all. A read that spelled the tag
// `Type:value` verbatim would silently match nothing once a
// `tagSchema` diverges from the default.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();

  addDefinition('custom-type-definition', id, 'RegionCode', {
    schema: { type: 'string' }, isTag: true, tagSchema: '{type}={value}',
  });
  addTaggedEvent(id, 'RegionOpened', {
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
    script: { initialState: 0 },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });

  check('a read\'s tag resolves through a non-default tagSchema', () => {
    const log = [];
    drive(model(), log, 'OpenRegion', { regionCode: 'eu' });
    drive(model(), log, 'OpenRegion', { regionCode: 'us' });
    const eu = { tags: [{ type: 'RegionCode', value: 'eu' }] };
    eq(sandbox.projectionQueryTags(model(), 'OpenRegionCount', eu), ['RegionCode=eu'], 'rendered through "="');
    eq(foldProjection(model(), log, 'OpenRegionCount', eu), 1,
      'matched through RegionCode\'s "=" tagSchema, not a hardcoded "RegionCode:eu"');
    eq(foldProjection(model(), log, 'OpenRegionCount', { tags: [{ type: 'RegionCode', value: 'us' }] }), 1,
      'us counted separately');
    eq(foldProjection(model(), log, 'OpenRegionCount', {}), 2, 'and read by no tag, every region');
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
  const { modelId: importedId } = importModelFromEnvelope(envelope);
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
  const { modelId: importedId } = importModelFromEnvelope(buildShareEnvelope(original, []));
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
  // Opening a link twice finds the model the first opening made — which
  // only works if an imported model shares exactly what it was imported
  // from, for every shipped model.
  const envelopes = [0, 1, 2, 3, 4].map((index) => buildShareEnvelope(build(index), []));
  const imported = envelopes.map((envelope) => importModelFromEnvelope(envelope).modelId);

  check('an imported model is found again by the envelope it came from', () => {
    envelopes.forEach((envelope, i) => {
      const shared = JSON.parse(JSON.stringify(envelope));
      eq(JSON.stringify(buildShareEnvelope(sandbox.projectState()[imported[i]], [])), JSON.stringify(shared), `model ${i} exports what it imported`);
      eq(modelMatchingEnvelope(shared) !== null, true, `model ${i} is matched`);
    });
  });

  check('an edited copy, or a link carrying a sandbox session, is not matched', () => {
    const edited = JSON.parse(JSON.stringify(envelopes[4]));
    edited.name += ' (edited)';
    eq(modelMatchingEnvelope(edited), null, 'a renamed envelope');
    const withSteps = { ...JSON.parse(JSON.stringify(envelopes[4])), sandbox: { steps: [{ command: 'DefineProduct', args: {} }] } };
    eq(modelMatchingEnvelope(withSteps), null, 'an envelope with sandbox steps');
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
  addTaggedEvent(id, 'RegionOpened', {
    properties: [{ name: 'regionCode', propertyType: 'RegionCode', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'OpenRegionCount', {
    valueType: 'integer',
    isList: false,
    script: { initialState: 0 },
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
  addTaggedEvent(id, 'ThingHappened', { properties: [] });
  addDefinition('command-definition', id, 'DoThing', {
    properties: [], boundary: [], conditions: [],
    publishes: [{ name: 'ThingHappened', parameters: {} }],
  });
  const body = { command: 'DoThing', given: [], when: { arguments: {} } };
  body.then = deriveThen(model(), body);
  const originalScenarioId = generateId();
  addDefinition('scenario-definition', id, originalScenarioId, body);

  const envelope = buildShareEnvelope(model(), []);
  const { modelId: importedId } = importModelFromEnvelope(envelope);
  const imported = sandbox.projectState()[importedId];
  const importedScenarioIds = Object.keys(imported['scenario-definitions']);

  check('an imported scenario keeps both its content and its id', () => {
    eq(importedScenarioIds.length, 1, 'exactly one scenario carried over');
    eq(importedScenarioIds[0], originalScenarioId, 'the exported id, not a fresh one');
    eq(imported['scenario-definitions'][importedScenarioIds[0]].command, 'DoThing', 'the scenario body itself');
  });
}

{
  // The case this regime exists for: a file whose command writes a tag
  // its boundary never consults — valid JSON, defective model. It must
  // load whole, the defect must come back as an advisory, and the
  // command must still evaluate: an unguarded write is legal DCB.
  //
  // The tag has to be a *derived* one. A tag whose value came off the
  // command payload is asserted by the caller and wants no read — only
  // a value this command read somewhere is a claim about state, and
  // only that is worth flagging.
  const { id, model } = openBlank('Lenient');
  addDefinition('entity-definition', id, 'Festlegung', { properties: [] });
  addTaggedEvent(id, 'FestlegungErzeugt', {
    properties: [{ name: 'festlegungId', propertyType: 'FestlegungId', isOptional: false, isList: false }],
  });
  addTaggedEvent(id, 'FestlegungVermerkt', {
    properties: [{ name: 'festlegungId', propertyType: 'FestlegungId', isOptional: false, isList: false }],
  });
  // Folds a different event, so it is not the minting exemption: this
  // is a value read from the log and then written as a tag.
  addDefinition('projection-definition', id, 'LetzteFestlegung', {
    parameters: [], valueType: 'FestlegungId', isList: false, initialValue: null,
    handlers: [{ event: 'FestlegungVermerkt', operation: 'set', value: { eventProperty: 'festlegungId' } }],
  });
  const envelope = buildShareEnvelope(model(), []);
  envelope.commandDefinitions.push({
    name: 'ErzeugeFestlegung',
    properties: [],
    boundary: [{ alias: 'letzte', projection: 'LetzteFestlegung', arguments: {} }],
    conditions: [],
    publishes: [{ name: 'FestlegungErzeugt', parameters: { festlegungId: { alias: 'letzte' } } }],
  });

  check('an import with a write-coverage gap loads whole, advisory-flagged', () => {
    const { modelId, skipped } = importModelFromEnvelope(envelope);
    eq(skipped, [], 'nothing skipped');
    const imported = sandbox.projectState()[modelId];
    eq('ErzeugeFestlegung' in imported['command-definitions'], true, 'the command loaded');
    eq(sandbox.modelAdvisories(imported).some(
      (a) => a.name === 'ErzeugeFestlegung' && /without reading that Festlegung/.test(a.message)
    ), true, 'and carries the coverage advisory');
    const outcome = evaluateCommand(imported, [], 'ErzeugeFestlegung', {});
    eq(outcome.outcome, 'published', 'the unguarded write still evaluates');
  });

  check('a structurally-broken definition is skipped; the rest of the file loads', () => {
    const bad = deepClone(envelope);
    bad.eventDefinitions.push({ name: 'Broken', properties: 42 });
    const { modelId, skipped } = importModelFromEnvelope(bad);
    eq(skipped.length, 1, 'exactly the one that is not a definition at all');
    eq(skipped[0].kind, 'event-definition', 'named by kind');
    eq(skipped[0].name, 'Broken', 'and by name');
    eq(/must be a list/.test(skipped[0].reason), true, 'with the structural reason');
    const imported = sandbox.projectState()[modelId];
    eq('FestlegungErzeugt' in imported['event-definitions'], true, 'the sound one loaded');
    eq('Broken' in imported['event-definitions'], false, 'the broken one did not');
  });
}

// ---------------------------------------------------------------
// `equalsAny` — membership over a literal list. One scalar against
// the listed values, `negate` for "is not one of"; the list is the
// one operand position that is an array.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank('Membership');
  addTaggedEvent(id, 'Filed', { properties: [] });
  addDefinition('command-definition', id, 'File', {
    properties: [{ name: 'status', propertyType: 'string', isOptional: true, isList: false }],
    boundary: [],
    conditions: [{
      leftHandSide: { parameterName: 'status' },
      predicate: 'equalsAny',
      rightHandSide: ['Draft', 'Submitted'],
    }],
    publishes: [{ name: 'Filed', parameters: {} }],
  });
  const membership = (rightHandSide, negate) => [{
    leftHandSide: { parameterName: 'status' },
    predicate: 'equalsAny',
    rightHandSide,
    ...(negate ? { negate: true } : {}),
  }];
  const outcomeWith = (conditions, args) => {
    const body = deepClone(model()['command-definitions'].File);
    body.conditions = conditions;
    updateDefinition('command-definition', id, 'File', body);
    return evaluateCommand(model(), [], 'File', args);
  };

  check('equalsAny holds exactly when the value is listed', () => {
    eq(evaluateCommand(model(), [], 'File', { status: 'Draft' }).outcome, 'published', 'a listed value');
    const refused = evaluateCommand(model(), [], 'File', { status: 'Archived' });
    eq(refused.outcome, 'rejected', 'an unlisted one');
    eq(refused.failedRule.text, 'status equalsAny ["Draft", "Submitted"]', 'named in the rule');
  });

  check('negate reads as "is not one of"', () => {
    eq(outcomeWith(membership(['Draft', 'Submitted'], true), { status: 'Archived' }).outcome,
      'published', 'unlisted passes');
    eq(outcomeWith(membership(['Draft', 'Submitted'], true), { status: 'Draft' }).outcome,
      'rejected', 'listed is refused');
  });

  check('membership is repeated equality, so null is simply not a member', () => {
    eq(outcomeWith(membership(['Draft', 'Submitted']), {}).outcome, 'rejected',
      'an unset optional matches nothing');
    eq(outcomeWith(membership(['Draft', 'Submitted'], true), {}).outcome, 'published',
      'and so passes the negation');
  });

  check('an empty list holds for nothing — negated, for everything', () => {
    eq(outcomeWith(membership([]), { status: 'Draft' }).outcome, 'rejected', 'one of nothing');
    eq(outcomeWith(membership([], true), { status: 'Draft' }).outcome, 'published', 'not one of nothing');
  });

  check('enum-member entries unwrap like every other spelling of a member', () => {
    eq(outcomeWith(membership([{ enumMember: 'Draft' }]), { status: 'Draft' }).outcome,
      'published', 'the reference matches the value it names');
  });

  check('the defects an equalsAny list can carry are advisories, not refusals', () => {
    const flagged = (conditions, pattern) => {
      const body = deepClone(model()['command-definitions'].File);
      body.conditions = conditions;
      updateDefinition('command-definition', id, 'File', body);
      eq(sandbox.modelAdvisories(model()).some(
        (a) => a.name === 'File' && pattern.test(a.message)), true, String(pattern));
    };
    flagged(membership([]), /lists no values/);
    flagged(membership(['Draft', null]), /lists null/);
    flagged(membership([{ parameterName: 'status' }]), /literals or enum members/);
    flagged([{ leftHandSide: { parameterName: 'status' }, predicate: 'equals', rightHandSide: ['Draft'] }],
      /only "equalsAny" reads/);
    flagged(membership('Draft'), /against a literal list\s+of values/);
  });
}

// A listed enum member is checked against the enum the left-hand side
// resolves to, and renaming that member rewrites the entries — the same
// promises the single-value comparison already keeps.
{
  const { id, model } = open_(0);
  const guardArchiveWith = (rightHandSide) => {
    const body = deepClone(model()['command-definitions'].ArchiveCourse);
    body.conditions = [{
      leftHandSide: { alias: 'course', property: 'status' },
      predicate: 'equalsAny',
      rightHandSide,
    }];
    updateDefinition('command-definition', id, 'ArchiveCourse', body);
  };

  check('a listed member the enum does not hold is flagged', () => {
    guardArchiveWith([{ enumMember: 'Existent' }, { enumMember: 'Retired' }]);
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'ArchiveCourse' && /"Retired" is not a member of CourseStatus/.test(a.message)
    ), true, 'the dangling entry is named');
  });

  check('renaming an enum member rewrites the references inside a list', () => {
    guardArchiveWith([{ enumMember: 'Existent' }, { enumMember: 'Archived' }]);
    renameMember('custom-type-definition', id, 'CourseStatus', 'member', 'Existent', 'Active');
    eq(model()['command-definitions'].ArchiveCourse.conditions[0].rightHandSide,
      [{ enumMember: 'Active' }, { enumMember: 'Archived' }], 'the listed entry repointed');
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
    eq(good.$schema, 'https://dcb.events/schemas/model/v8.json', '$schema');
    eq(/^8\.\d+$/.test(good.dcbModelVersion), true, 'dcbModelVersion is an 8.x');
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
    refuses({ ...good, dcbModelVersion: '9.0' }, 'a newer major');
    // 7.x tagged events by property type; read here, it would carry none.
    refuses({ ...good, dcbModelVersion: '7.0' }, 'the last major with implied tags');
    // 6.x has no rejection messages, and none can be invented for it.
    refuses({ ...good, dcbModelVersion: '6.1' }, 'the last major before messages');
    // 2.x is where a projection scenario read several projections under
    // aliases — readable as JSON, and misread as a model.
    refuses({ ...good, dcbModelVersion: '2.0' }, 'the last unreadable major');
    refuses({ ...good, dcbModelVersion: '1.0' }, 'and the one before that');
  });

  check('$schema is required but never read, so a repointed one still imports', () => {
    const local = { ...good, $schema: './dcb-model.schema.json' };
    eq(typeof importModelFromEnvelope(local).modelId, 'string', 'imported anyway');
  });

  check('a newer minor imports, and says what it is dropping', () => {
    const newer = { ...good, dcbModelVersion: '8.99' };
    eq(typeof importModelFromEnvelope(newer).modelId, 'string', 'imported');
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
  // The write goes through and the defect is reported instead: `fn`
  // performs the edit and returns the model accessor, and the check is
  // that `name` now carries an advisory saying `pattern`.
  const advises = (name, pattern, what, fn) => check(what, () => {
    const model = fn();
    const flagged = sandbox.modelAdvisories(model())
      .filter((a) => a.name === name && pattern.test(a.message));
    if (!flagged.length) {
      const all = sandbox.modelAdvisories(model()).map((a) => `${a.name}: ${a.message}`);
      throw new Error(`no advisory ${pattern} on ${name}; got ${JSON.stringify(all)}`);
    }
  });

  check('a property and a direct read of the same projection agree', () => {
    const model = build(0);
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 7 });
    // Through the entity, and through the projection it binds. Same
    // fold, reached two ways.
    eq(foldEntityProperty(model, log, 'Course', 'capacity', 'c1'), 7, 'as a property');
    eq(foldProjection(model, log, 'CourseCapacity', { tags: [{ type: 'CourseId', value: 'c1' }] }), 7, 'as a projection');
  });

  check('one projection may be bound by two entities that share an identifier', () => {
    const { id, model } = openBlank();
    addDefinition('entity-definition', id, 'Course', { properties: [] });
    addTaggedEvent(id, 'CourseDefined', {
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'CourseExists', {
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

  check('deleting a bound projection leaves the binding advisory-flagged, not refused', () => {
    const { id, model } = open_(0);
    removeDefinition('projection-definition', id, 'CourseCapacity');
    eq('CourseCapacity' in model()['projection-definitions'], false, 'removed');
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'Course' && /CourseCapacity/.test(a.message)
    ), true, 'the entity reports its dangling binding');
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

  advises('Course', /reads "TenantExists" by CourseId, but "TenantRegistered", which it handles, is tagged by no CourseId/,
    'a property whose events no instance can see binds, with an advisory', () => {
      const { id, model } = open_(2);
      // A course reads its properties tagged by its CourseId; a
      // tenant's registration lists only a TenantId, so no course would
      // ever see it — the entity says so instead of the update refusing.
      updateDefinition('entity-definition', id, 'Course', {
        icon: '📚', properties: [{ name: 'tenantExists', projection: 'TenantExists' }],
      });
      return model;
    });

  advises('CourseCapacity', /declares parameters/,
    'a projection that declares a partition of its own saves, with an advisory', () => {
      const { id, model } = open_(0);
      const body = {
        ...deepClone(model()['projection-definitions'].CourseCapacity),
        parameters: [{ name: 'courseId', propertyType: 'CourseId' }],
      };
      updateDefinition('projection-definition', id, 'CourseCapacity', body);
      return model;
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

  check('a scripted projection may hold a record, and a condition reads it whole', () => {
    const { id, model } = openScripted();
    addDefinition('custom-type-definition', id, 'CounterStats', {
      properties: [
        { name: 'count', propertyType: 'integer' },
        { name: 'odd', propertyType: 'boolean' },
      ],
    });
    addDefinition('projection-definition', id, 'CounterStatsView', {
      valueType: 'CounterStats', isList: false,
      script: { initialState: null },
      handlers: [{
        event: 'Ticked',
        code: '{ count: ((state && state.count) || 0) + 1, odd: !(state && state.odd) }',
      }],
    });
    updateDefinition('entity-definition', id, 'Counter', {
      properties: [
        { name: 'total', projection: 'CounterTotal' },
        { name: 'stats', projection: 'CounterStatsView' },
      ],
    });
    addDefinition('command-definition', id, 'TickAtStats', {
      properties: [
        { name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false },
        { name: 'expected', propertyType: 'CounterStats', isOptional: false, isList: false },
      ],
      boundary: [{ alias: 'counter', entity: 'Counter', id: { parameterName: 'counterId' } }],
      conditions: [{
        leftHandSide: { alias: 'counter', property: 'stats' },
        predicate: 'equals',
        rightHandSide: { parameterName: 'expected' },
      }],
      publishes: [{ name: 'Ticked', parameters: { counterId: { parameterName: 'counterId' } } }],
    });

    const log = [
      { type: 'Ticked', data: { counterId: 'x1' } },
      { type: 'Ticked', data: { counterId: 'x2' } },
      { type: 'Ticked', data: { counterId: 'x1' } },
    ];
    eq(foldEntityProperty(model(), log, 'Counter', 'stats', 'x1'),
      { count: 2, odd: false }, 'the record, whole');
    const held = evaluateCommand(model(), log, 'TickAtStats',
      { counterId: 'x1', expected: { count: 2, odd: false } });
    eq(held.outcome, 'published', 'equality on a record is deep');
    const refused = evaluateCommand(model(), log, 'TickAtStats',
      { counterId: 'x1', expected: { count: 2, odd: true } });
    eq(refused.outcome, 'rejected', 'and one differing field refuses');
  });

  check('`exposes` trims a reader to one field; the state fold keeps the record', () => {
    const { id, model } = openScripted();
    addDefinition('projection-definition', id, 'CounterAudit', {
      valueType: 'integer', isList: false,
      script: {
        initialState: { total: 0, last: null },
        exposes: 'total',
      },
      handlers: [{
        event: 'Ticked',
        code: '{ total: state.total + 1, last: event.data.counterId }',
      }],
    });

    const log = [
      { type: 'Ticked', data: { counterId: 'x1' } },
      { type: 'Ticked', data: { counterId: 'x2' } },
      { type: 'Ticked', data: { counterId: 'x1' } },
    ];
    eq(foldProjection(model(), log, 'CounterAudit', { tags: [{ type: 'CounterId', value: 'x1' }] }),
      2, 'a reader sees the exposed field');
    eq(foldProjectionState(model(), log, 'CounterAudit', { tags: [{ type: 'CounterId', value: 'x1' }] }),
      { total: 2, last: 'x1' }, 'the state fold keeps the bookkeeping');
    eq(foldProjectionState(model(), [], 'CounterAudit', { tags: [{ type: 'CounterId', value: 'x1' }] }),
      { total: 0, last: null }, 'before anything happens, it is the initial state');
    eq(foldProjectionState(model(), log, 'CounterTotal', { tags: [{ type: 'CounterId', value: 'x1' }] }),
      foldProjection(model(), log, 'CounterTotal', { tags: [{ type: 'CounterId', value: 'x1' }] }),
      'without `exposes` the two readings coincide');
  });

  advises('GlobalTicks', /states a tag filter/,
    'a script with a tag filter of its own saves, with an advisory', () => {
      const { id, model } = openScripted();
      addDefinition('projection-definition', id, 'GlobalTicks', {
        valueType: 'integer', isList: false,
        script: { initialState: 0, tagFilter: [] },
        handlers: [{ event: 'Ticked', code: '(state || 0) + 1' }],
      });
      return model;
    });

  check('a script sees the tags it is read by, and the arguments it is given', () => {
    const { id, model } = openScripted();
    addDefinition('projection-definition', id, 'TicksSeen', {
      valueType: 'string', isList: false,
      script: { initialState: '', arguments: [{ name: 'prefix', propertyType: 'string' }] },
      handlers: [{ event: 'Ticked', code: 'args.prefix + tags.CounterId' }],
    });
    const log = [{ type: 'Ticked', data: { counterId: 'x1' } }];
    eq(foldProjection(model(), log, 'TicksSeen', { tags: [{ type: 'CounterId', value: 'x1' }], args: { prefix: '#' } }),
      '#x1', 'tags.CounterId and args.prefix');
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
  addTaggedEvent(id, 'Nudged', { properties: [] });

  const add = (name, body) => addDefinition('projection-definition', id, name, {
    parameters: [], isList: false, handlers: [], ...body,
  });
  // A mistyped initial value saves and comes back as an advisory on
  // the projection — this returns that advisory's message, or null
  // when the add produced a clean definition.
  const advisoryOf = (body) => {
    const name = 'Attempt' + Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, 'x');
    add(name, body);
    const found = sandbox.modelAdvisories(model()).find((a) => a.name === name);
    return found ? found.message : null;
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

  check('a mistyped initial value saves, and the advisory names the mismatch', () => {
    eq(/is not a integer/.test(advisoryOf({ valueType: 'integer', initialValue: 'lots' })), true, 'text for an integer');
    eq(/is not a boolean/.test(advisoryOf({ valueType: 'boolean', initialValue: 1 })), true, 'a number for a boolean');
    eq(/not a literal/.test(advisoryOf({ valueType: 'Slot', isList: true, initialValue: ['a', null] })), true,
      'null inside a list');
    eq(/is a list/.test(advisoryOf({ valueType: 'Slot', initialValue: ['a'] })), true, 'a list for a single value');
    eq(/its initial value is one/.test(advisoryOf({ valueType: 'Slot', isList: true, initialValue: 'a' })), true,
      'a single value for a list');
    eq(/not a member of Colour/.test(advisoryOf({ valueType: 'Colour', initialValue: { enumMember: 'Blue' } })), true,
      'an enum member that does not exist');
    eq(/is an enum/.test(advisoryOf({ valueType: 'Colour', initialValue: 'Red' })), true,
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
      const key = store_(id, model(), {
        projection: 'TenantCourseNumbering', tags: [{ tagType: 'TenantId', tagValue: tenantId }], given,
      });
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
      projection: 'CourseCapacity', tags: [{ tagType: 'CourseId', tagValue: 'c1' }], given,
    });
    const numbering = store_(id, model(), {
      projection: 'CourseNumbering', given,
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
      projection: 'CourseSubscribedStudentIds', tags: [{ tagType: 'CourseId', tagValue: 'c1' }], given: [],
    });
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.then, [], 'an empty list is what it folds to');
    eq(runProjectionScenario(model(), stored).status, 'current', 'and it runs current, not broken');
  });

  check('changing what a projection does is reported as drift', () => {
    const { id, model } = open_(1);
    const key = store_(id, model(), {
      projection: 'CourseNumbering',
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
      projection: 'CourseNumbering', given: [],
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
      projection: 'CourseNumbering',
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
      projection: 'CourseNumbering',
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } }],
    });
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseOpened');
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.given[0].event, 'CourseOpened', 'the Given followed');
    eq(runProjectionScenario(model(), stored).status, 'current', 'still current');
  });

  check('a scenario with wrong arguments saves, and the break is its run\'s to report', () => {
    const { id, model } = open_(2);
    const stored = (body) => {
      const key = generateId();
      addDefinition('projection-scenario-definition', id, key, { given: [], then: null, ...body });
      return model()['projection-scenario-definitions'][key];
    };
    eq(runProjectionScenario(model(), stored({
      projection: 'TenantCourseNumbering', tags: [{ tagType: 'TenantId', tagValue: null }],
    })).status, 'broken', 'read tagged by no value');
    eq(runProjectionScenario(model(), stored({ projection: 'NoSuchThing' })).status,
      'broken', 'a projection this model does not define');
    // An extra argument is inert — the fold never reads it — so that
    // scenario stores as written and is judged only on its Then.
    stored({ projection: 'CourseNumbering', arguments: { tenantId: 't1' } });
  });

  check('safe mode compiles a script to a thrower and leaves declared folds alone', () => {
    // The model as a plain object: `build(1)` below resets the store,
    // but the fold only ever reads the object it is handed.
    const scripted = openScripted().model();
    const log = [{ type: 'Ticked', data: { counterId: 'x1' } }];
    eq(foldEntityProperty(scripted, log, 'Counter', 'total', 'x1'), 1, 'runs when scripts are on');
    setScriptsDisabled(true);
    try {
      let failure = null;
      try {
        foldEntityProperty(scripted, log, 'Counter', 'total', 'x1');
      } catch (error) {
        failure = error;
      }
      eq((failure || {}).name, 'EvaluationError', 'an evaluation error, not a crash');
      eq(/safe mode/.test((failure || {}).message), true, 'which says why');
      eq(foldProjection(build(1), [], 'CourseNumbering', {}), 'c1', 'a declared fold is untouched');
    } finally {
      setScriptsDisabled(false);
    }
    eq(foldEntityProperty(scripted, log, 'Counter', 'total', 'x1'), 1, 'and back on afterwards');
  });

  check('a scenario over a scripted projection folds through its tag filter', () => {
    const { id, model } = openScripted();
    const given = [
      { event: 'Ticked', data: { counterId: 'x1' } },
      { event: 'Ticked', data: { counterId: 'x2' } },
      { event: 'Ticked', data: { counterId: 'x1' } },
    ];
    const at = (counterId) => {
      const key = store_(id, model(), {
        projection: 'CounterTotal', tags: [{ tagType: 'CounterId', tagValue: counterId }], given,
      });
      return model()['projection-scenario-definitions'][key].then;
    };
    eq([at('x1'), at('x2')], [2, 1], 'each counter counted its own');
  });

  check('a projection scenario round-trips through an export', () => {
    const { id, model } = open_(1);
    store_(id, model(), {
      projection: 'CourseNumbering',
      given: [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } }],
    });
    const envelope = buildShareEnvelope(model(), []);
    // Two ship with this model, and this is the third.
    eq(envelope.projectionScenarioDefinitions.length, 3, 'exported');
    const before = definitionsToSchema(model());
    const importedId = importModelFromEnvelope(envelope).modelId;
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
    // A write from outside `appendEvents` — another tab, a hand in
    // devtools — is only seen once the revision moves, which is what
    // this simulates.
    sandbox.bumpLogRevision();
    eq(sandbox.projectState(), {}, 'projects empty');
    eq(store.get(logKey + ':corrupt'), '{not json', 'raw value preserved');
    eq(store.has(logKey), false, 'live key cleared');
    const id = sandbox.createDcbModel('Fresh');
    eq(Object.keys(sandbox.projectState()), [id], 'append starts a fresh log');
    eq(store.get(logKey + ':corrupt'), '{not json', 'backup untouched');
  });

  check('a stored value that is not an array is treated the same', () => {
    store.set(logKey, '{}');
    sandbox.bumpLogRevision();
    eq(sandbox.projectState(), {}, 'projects empty');
    eq(store.get(logKey + ':corrupt'), '{}', 'raw value preserved');
  });
}

// ---------------------------------------------------------------
// Reference symmetry: whatever computeReferences sees, a rename must
// move. Walked over every reference in every shipped model — a
// reference site visible to one direction and not the other leaves a
// dangling name here.
// ---------------------------------------------------------------
{
  const KINDS = [
    'entity-definition', 'event-definition', 'projection-definition', 'command-definition',
    'custom-type-definition', 'scenario-definition', 'projection-scenario-definition',
  ];
  const collOf = (kind) => kind + 's';

  const dangling = (m) => {
    const out = [];
    for (const kind of KINDS) {
      for (const [n, b] of Object.entries(m[collOf(kind)])) {
        const refs = sandbox.computeReferences(m, kind, n, b);
        for (const targetKind of KINDS) {
          for (const r of refs[targetKind]) {
            if (!(r in m[collOf(targetKind)])) out.push(`${kind} ${n} -> ${targetKind} ${r}`);
          }
        }
      }
    }
    return out;
  };

  for (let i = 0; i < 5; i++) {
    check(`shipped model ${i}: every computed reference survives renaming its target`, () => {
      const { id, model } = open_(i);
      eq(dangling(model()), [], 'baseline has no dangling references');
      // Every (kind, name) anything references — renamed one by one.
      const targets = [];
      const seen = new Set();
      for (const kind of KINDS) {
        for (const [n, b] of Object.entries(model()[collOf(kind)])) {
          const refs = sandbox.computeReferences(model(), kind, n, b);
          for (const targetKind of KINDS) {
            for (const r of refs[targetKind]) {
              const tag = targetKind + ':' + r;
              if (!seen.has(tag)) { seen.add(tag); targets.push({ kind: targetKind, name: r }); }
            }
          }
        }
      }
      for (const target of targets) {
        // A cascade from an earlier rename (an entity moving its
        // derived identifier) may have renamed this one already.
        if (!(target.name in model()[collOf(target.kind)])) continue;
        renameDefinition(target.kind, id, target.name, target.name + 'X');
      }
      eq(dangling(model()), [], 'no reference was left behind');
    });
  }
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

  check('an identifier operand missing its name saves, and the advisory names the gap', () => {
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary[0].id = { parameterName: '' };
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'ChangeCourseCapacity' && /no identifier operand/.test(a.message)
    ), true, 'the incomplete operand is reported');
  });
}

// ---------------------------------------------------------------
// Optional properties. `null` is the one spelling of "no value": an
// unset optional command property reaches everything as null, an
// unmapped optional event property publishes the explicit null, and
// the empty string stays a value of its own. Where a null would
// become a tag — a binding's identifier, an exclusion, a partition —
// evaluation errors instead, and an advisory says so ahead of time.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank('Optional');
  const broken = (what, fn) => check(what, () => {
    try {
      fn();
    } catch (error) {
      if (error.name !== 'EvaluationError') throw new Error(`threw ${error.name}: ${error.message}`);
      return;
    }
    throw new Error('did not fail');
  });

  addDefinition('entity-definition', id, 'Anordnung', { properties: [] });
  addTaggedEvent(id, 'AnordnungErzeugt', {
    properties: [
      { name: 'anordnungId', propertyType: 'AnordnungId', isOptional: false, isList: false },
      { name: 'notiz', propertyType: 'string', isOptional: true, isList: false },
    ],
  });
  addDefinition('command-definition', id, 'ErzeugeAnordnung', {
    properties: [
      { name: 'anordnungId', propertyType: 'AnordnungId', isOptional: false, isList: false },
      { name: 'notiz', propertyType: 'string', isOptional: true, isList: false },
    ],
    // No boundary: the caller says which Anordnung, and nothing here
    // tests its state — a read would widen the append condition and
    // decide nothing.
    boundary: [],
    conditions: [],
    publishes: [{
      name: 'AnordnungErzeugt',
      parameters: { anordnungId: { parameterName: 'anordnungId' }, notiz: { parameterName: 'notiz' } },
    }],
  });
  // The same event without the optional mapping: the null is published
  // without anything having to say so.
  addDefinition('command-definition', id, 'ErzeugeOhneNotiz', {
    properties: [{ name: 'anordnungId', propertyType: 'AnordnungId', isOptional: false, isList: false }],
    boundary: [],
    conditions: [],
    publishes: [{ name: 'AnordnungErzeugt', parameters: { anordnungId: { parameterName: 'anordnungId' } } }],
  });

  check('an unset optional property publishes the explicit null', () => {
    const outcome = evaluateCommand(model(), [], 'ErzeugeAnordnung', { anordnungId: 'a1' });
    eq(outcome.outcome, 'published', 'runs, not broken');
    eq(outcome.events[0].data, { anordnungId: 'a1', notiz: null }, 'the key is there, holding null');
  });

  check('an explicit null and an absent key are the same call', () => {
    const absent = evaluateCommand(model(), [], 'ErzeugeAnordnung', { anordnungId: 'a1' });
    const explicit = evaluateCommand(model(), [], 'ErzeugeAnordnung', { anordnungId: 'a1', notiz: null });
    eq(absent.events, explicit.events, 'same publication');
  });

  check('the empty string is a value, not the null', () => {
    const outcome = evaluateCommand(model(), [], 'ErzeugeAnordnung', { anordnungId: 'a1', notiz: '' });
    eq(outcome.events[0].data.notiz, '', 'kept as typed');
  });

  broken('a required property is still required',
    () => evaluateCommand(model(), [], 'ErzeugeAnordnung', { notiz: 'n' }));

  check('an unmapped optional event property publishes null, advisory-free', () => {
    const outcome = evaluateCommand(model(), [], 'ErzeugeOhneNotiz', { anordnungId: 'a1' });
    eq(outcome.events[0].data, { anordnungId: 'a1', notiz: null }, 'the omission is the null');
    eq(sandbox.modelAdvisories(model()).length, 0, 'nothing here is a hazard');
  });

  check('a condition reads the null; isEmpty holds, ordering breaks', () => {
    const body = deepClone(model()['command-definitions'].ErzeugeAnordnung);
    body.conditions = [{ leftHandSide: { parameterName: 'notiz' }, predicate: 'isNotEmpty' }];
    updateDefinition('command-definition', id, 'ErzeugeAnordnung', body);
    const outcome = evaluateCommand(model(), [], 'ErzeugeAnordnung', { anordnungId: 'a1' });
    eq(outcome.outcome, 'rejected', 'an ordinary rejection, not an error');
    body.conditions = [{ leftHandSide: { parameterName: 'notiz' }, predicate: 'lessThan', rightHandSide: 3 }];
    updateDefinition('command-definition', id, 'ErzeugeAnordnung', body);
    let name = null;
    try { evaluateCommand(model(), [], 'ErzeugeAnordnung', { anordnungId: 'a1' }); } catch (error) { name = error.name; }
    eq(name, 'EvaluationError', 'null has no place in an ordering');
    body.conditions = [];
    updateDefinition('command-definition', id, 'ErzeugeAnordnung', body);
  });

  // A projection reading the optional property, bound as an entity
  // property — the fold sees the same null whether the Given spelled
  // it out or left the key off.
  addDefinition('projection-definition', id, 'AnordnungNotiz', {
    valueType: 'string', isList: false,
    initialValue: null,
    handlers: [{ event: 'AnordnungErzeugt', operation: 'set', value: { eventProperty: 'notiz' } }],
  });
  updateDefinition('entity-definition', id, 'Anordnung', {
    properties: [{ name: 'notiz', projection: 'AnordnungNotiz' }],
  });

  check('the fold reads an omitted optional event property as null', () => {
    const log = [{ type: 'AnordnungErzeugt', data: { anordnungId: 'a1' } }];
    eq(foldEntityProperty(model(), log, 'Anordnung', 'notiz', 'a1'), null, 'null, not undefined');
    eq(foldEntityProperty(model(), [
      { type: 'AnordnungErzeugt', data: { anordnungId: 'a1', notiz: 'da' } },
    ], 'Anordnung', 'notiz', 'a1'), 'da', 'and a value when one is there');
  });

  check('a Given step may leave an optional property out', () => {
    const scenario = {
      command: 'ErzeugeOhneNotiz',
      given: [{ event: 'AnordnungErzeugt', data: { anordnungId: 'a0' } }],
      when: { arguments: { anordnungId: 'a1' } },
    };
    eq(deriveThen(model(), scenario).outcome, 'published', 'the scenario runs');
  });

  check('an unset optional tag-marked property writes no tag', () => {
    addDefinition('entity-definition', id, 'Festlegung', { properties: [] });
    addTaggedEvent(id, 'FestlegungGeprueft', {
      properties: [{ name: 'festlegungId', propertyType: 'FestlegungId', isOptional: true, isList: false }],
    });
    eq(tagsOfEvent(model(), 'FestlegungGeprueft', { festlegungId: null }), [], 'no phantom instance');
    eq(tagsOfEvent(model(), 'FestlegungGeprueft', { festlegungId: 'f1' }),
      ['FestlegungId:f1'], 'the tag is back the moment the value is');
  });

  check('a boundary identifier from an unset optional errors, and the advisory said so', () => {
    addDefinition('command-definition', id, 'PruefeFestlegung', {
      properties: [{ name: 'festlegungId', propertyType: 'FestlegungId', isOptional: true, isList: false }],
      boundary: [{ alias: 'festlegung', entity: 'Festlegung', id: { parameterName: 'festlegungId' } }],
      conditions: [],
      publishes: [{ name: 'FestlegungGeprueft', parameters: { festlegungId: { parameterName: 'festlegungId' } } }],
    });
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'PruefeFestlegung' && /optional parameter "festlegungId"/.test(a.message)
    ), true, 'the hazard is advised before any value is unset');
    let name = null;
    try { evaluateCommand(model(), [], 'PruefeFestlegung', {}); } catch (error) { name = error.name; }
    eq(name, 'EvaluationError', 'unset at the boundary is the promised error');
    eq(evaluateCommand(model(), [], 'PruefeFestlegung', { festlegungId: 'f1' }).outcome,
      'published', 'and with a value it runs as ever');
    removeDefinition('command-definition', id, 'PruefeFestlegung');
  });

  check('a required event property fed from an optional parameter is advised', () => {
    const body = deepClone(model()['command-definitions'].ErzeugeAnordnung);
    body.properties = body.properties.map((p) => p.name === 'anordnungId' ? { ...p, isOptional: true } : p);
    addDefinition('command-definition', id, 'WackligErzeugen', body);
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'WackligErzeugen' && /publishes null into/.test(a.message)
    ), true, 'null into a required property is a hazard worth a line');
    removeDefinition('command-definition', id, 'WackligErzeugen');
  });

  check('optional and list together is advised, and evaluates as a plain list', () => {
    addTaggedEvent(id, 'Doppelt', {
      properties: [{ name: 'notizen', propertyType: 'string', isOptional: true, isList: true }],
    });
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'Doppelt' && /both optional and a list/.test(a.message)
    ), true, 'two spellings of none');
    removeDefinition('event-definition', id, 'Doppelt');
  });
}

// ---------------------------------------------------------------
// The demoted validations still hold the shipped models to the old
// standard: every predefined model loads without a single advisory.
// ---------------------------------------------------------------
check('every predefined model ships advisory-clean', () => {
  // `PREDEFINED_MODELS` is a top-level const, invisible on the vm's
  // global — walked by index until the loader runs out instead.
  let count = 0;
  for (let i = 0; ; i++) {
    let model;
    try { model = build(i); } catch { break; }
    count += 1;
    const found = sandbox.modelAdvisories(model);
    if (found.length) {
      throw new Error(`model ${i}: ${found.map((a) => `${a.name}: ${a.message}`).join('; ')}`);
    }
  }
  eq(count >= 5, true, 'all shipped models were actually checked');
});

// ---------------------------------------------------------------
// Optional bindings, and one fact per event.
//
// A binding derived from a value nothing has set yet may declare the
// absence expected and bind nothing instead of erroring. And the
// reassignment shape — one command moving two instructors' partitions
// in opposite directions — is expressed by *splitting the event*: an
// Assigned and an Unassigned each carry one instructor tag, so one
// plain handler per event type is enough; an event that names two
// instances of one type is the ambiguity the advisory points out.
// ---------------------------------------------------------------
{
  function openAssignment() {
    const { id, model } = openBlank('Assignment');
    addDefinition('entity-definition', id, 'Course', { properties: [] });
    addDefinition('entity-definition', id, 'Instructor', { properties: [] });
    addTaggedEvent(id, 'Assigned', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: false, isList: false },
      ],
    });
    // The predecessor's own fact. Its identifier is optional: a first
    // assignment replaces nobody, and a null identifier carries no tag,
    // so that event reaches no partition at all — a recorded no-op.
    addTaggedEvent(id, 'Unassigned', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: true, isList: false },
      ],
    });
    addDefinition('projection-definition', id, 'CourseInstructorId', {
      valueType: 'InstructorId', isList: false, initialValue: null,
      handlers: [{ event: 'Assigned', operation: 'set', value: { eventProperty: 'instructorId' } }],
    });
    addDefinition('projection-definition', id, 'InstructedCourses', {
      valueType: 'CourseId', isList: true, initialValue: [],
      handlers: [
        { event: 'Assigned', operation: 'append', value: { eventProperty: 'courseId' } },
        { event: 'Unassigned', operation: 'remove', value: { eventProperty: 'courseId' } },
      ],
    });
    updateDefinition('entity-definition', id, 'Course', {
      properties: [{ name: 'instructorId', projection: 'CourseInstructorId' }],
    });
    updateDefinition('entity-definition', id, 'Instructor', {
      properties: [{ name: 'instructedCourses', projection: 'InstructedCourses' }],
    });
    addDefinition('command-definition', id, 'Assign', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: false, isList: false },
      ],
      // The new instructor is asserted by the caller and tested by
      // nothing, so it is not read. The *previous* one is read, because
      // the rule is about it — and because the `Unassigned` tag is
      // derived from `course.instructorId`, which is a claim about
      // state this command looked at.
      boundary: [
        { alias: 'course', entity: 'Course', id: { parameterName: 'courseId' } },
        { alias: 'previousInstructor', entity: 'Instructor',
          id: { alias: 'course', property: 'instructorId' }, isOptional: true },
      ],
      conditions: [
        { leftHandSide: { alias: 'previousInstructor', property: 'instructedCourses' },
          predicate: 'contains', rightHandSide: { parameterName: 'courseId' },
          rejection: 'Previous instructor does not teach this course' },
      ],
      publishes: [
        { name: 'Assigned', parameters: {
          courseId: { parameterName: 'courseId' },
          instructorId: { parameterName: 'instructorId' },
        } },
        { name: 'Unassigned', parameters: {
          courseId: { parameterName: 'courseId' },
          instructorId: { alias: 'course', property: 'instructorId' },
        } },
      ],
    });
    return { id, model };
  }

  const assigned = (courseId, instructorId) =>
    ({ type: 'Assigned', data: { courseId, instructorId } });
  const unassigned = (courseId, instructorId) =>
    ({ type: 'Unassigned', data: { courseId, instructorId } });

  check('the split events move the two partitions in opposite directions', () => {
    const { model } = openAssignment();
    const log = [assigned('c1', 'i1'), assigned('c1', 'i2'), unassigned('c1', 'i1')];
    eq(foldEntityProperty(model(), log, 'Instructor', 'instructedCourses', 'i2'), ['c1'],
      'the new instructor gains the course');
    eq(foldEntityProperty(model(), log, 'Instructor', 'instructedCourses', 'i1'), [],
      'the previous instructor loses it');
  });

  check('an Unassigned with a null identifier carries no tag and reaches nobody', () => {
    const { model } = openAssignment();
    const log = [assigned('c1', 'i1'), unassigned('c1', null)];
    eq(foldEntityProperty(model(), log, 'Instructor', 'instructedCourses', 'i1'), ['c1'],
      'a first assignment removes nothing from anyone');
  });

  check('an optional binding with an unset identifier binds nothing', () => {
    const { model } = openAssignment();
    const result = evaluateCommand(model(), [], 'Assign', { courseId: 'c1', instructorId: 'i1' });
    eq(result.outcome, 'published', 'no error, and the condition over the absent alias held vacuously');
    eq(result.events.map((e) => e.type), ['Assigned', 'Unassigned'], 'both facts recorded');
    eq(result.events[1].data.instructorId, null, 'the no-predecessor case publishes the explicit null');
    eq(result.reads.previousInstructor.absent, true, 'the reads say the alias bound nothing');
    eq(result.reads.previousInstructor.instances, [], 'zero instances, not a phantom');
  });

  check('the condition over the bound previous instructor still decides', () => {
    const { model } = openAssignment();
    const log = [assigned('c1', 'i1')];
    const result = evaluateCommand(model(), log, 'Assign', { courseId: 'c1', instructorId: 'i2' });
    eq(result.outcome, 'published', 'i1 instructs c1, so the contains condition holds');
    eq(result.events[1].data.instructorId, 'i1', 'and the Unassigned names the predecessor');
  });

  check('without the flag, an unset identifier stays the loud error', () => {
    const { id, model } = openAssignment();
    const body = deepClone(model()['command-definitions'].Assign);
    delete body.boundary[1].isOptional;
    updateDefinition('command-definition', id, 'Assign', body);
    let message = '';
    try { evaluateCommand(model(), [], 'Assign', { courseId: 'c1', instructorId: 'i1' }); }
    catch (error) { message = error.message; }
    eq(/unset \(null\)/.test(message), true, 'errored: ' + message);
  });

  check('reading a property of an absent alias yields null', () => {
    const { id, model } = openAssignment();
    const body = deepClone(model()['command-definitions'].Assign);
    body.conditions = [];
    // Route the read through the absent alias itself rather than
    // through `course` — nothing was read at all, so the value is
    // null, the one spelling of no value.
    body.publishes[1].parameters.instructorId = {
      alias: 'previousInstructor', property: 'instructedCourses',
    };
    updateDefinition('command-definition', id, 'Assign', body);
    const result = evaluateCommand(model(), [], 'Assign', { courseId: 'c1', instructorId: 'i1' });
    eq(result.outcome, 'published', 'published');
    eq(result.events[1].data.instructorId, null, 'null, not an empty list and not an error');
  });

  check('an event naming two instances of one type is flagged as ambiguous', () => {
    const { id, model } = openAssignment();
    eq(sandbox.modelAdvisories(model()).length, 0, 'the split-event shape is clean');
    // The unsplit shape: one event carrying both the new holder and
    // the one replaced — a handler on it fires for both partitions.
    addTaggedEvent(id, 'Reassigned', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: false, isList: false },
        { name: 'previousInstructorId', propertyType: 'InstructorId', isOptional: true, isList: false },
      ],
    });
    const body = deepClone(model()['projection-definitions'].InstructedCourses);
    body.handlers.push({ event: 'Reassigned', operation: 'append', value: { eventProperty: 'courseId' } });
    updateDefinition('projection-definition', id, 'InstructedCourses', body);
    const found = sandbox.modelAdvisories(model()).map((a) => a.message).join('; ');
    eq(/Tag it by one, split the event/.test(found), true, 'the advisory names the fixes: ' + found);
  });

  check('an unflagged binding off a null-starting projection is advised ahead of time', () => {
    const { id, model } = openAssignment();
    const body = deepClone(model()['command-definitions'].Assign);
    delete body.boundary[1].isOptional;
    updateDefinition('command-definition', id, 'Assign', body);
    const found = sandbox.modelAdvisories(model()).map((a) => a.message).join('; ');
    eq(/may be absent/.test(found), true, 'the advisory names the fix: ' + found);
  });
}

// ---------------------------------------------------------------
// Guarded emissions (6.0). A guard decides what an accepted command
// *records*, never whether it happens: a failing guard skips its
// emission silently, and every guard failing publishes nothing at all
// — still a `published` outcome. Exercised against the shipped
// guarded-emissions variant of the content-decisions family, whose
// UpdateText carries the complementary pair.
// ---------------------------------------------------------------
{
  const GUARDED = 8;
  const added = { type: 'DocumentAdded', data: { id: 'd1' } };
  const changed = (text) => ({ type: 'TextChanged', data: { docId: 'd1', text } });
  const published = (text) => ({ type: 'DocumentPublished', data: { docId: 'd1', text } });

  check('complementary guards fire exactly one of the two emissions', () => {
    const model = build(GUARDED);
    const differs = evaluateCommand(model, [added], 'UpdateText', { docId: 'd1', text: 'x' });
    eq(differs.outcome, 'published', 'accepted');
    eq(differs.events.map((e) => e.type), ['TextChanged'], 'the text differs from the published one');

    const reverts = evaluateCommand(
      model, [added, changed('a'), published('a'), changed('b')],
      'UpdateText', { docId: 'd1', text: 'a' });
    eq(reverts.outcome, 'published', 'accepted');
    eq(reverts.events.map((e) => e.type), ['TextRevertedToPublished'],
      're-typing the published text is recorded as the fact it is');
  });

  check('every guard failing publishes nothing — an accepted command, not a rejection', () => {
    const { id, model } = openBlank('Guarded');
    addTaggedEvent(id, 'Pinged', { properties: [] });
    addDefinition('command-definition', id, 'Ping', {
      properties: [{ name: 'loud', propertyType: 'boolean', isOptional: false, isList: false }],
      boundary: [],
      conditions: [],
      publishes: [{
        name: 'Pinged',
        when: [{ leftHandSide: { parameterName: 'loud' }, predicate: 'isTrue' }],
        parameters: {},
      }],
    });
    const quiet = evaluateCommand(model(), [], 'Ping', { loud: false });
    eq(quiet.outcome, 'published', 'accepted either way');
    eq(quiet.events, [], 'nothing recorded');
    eq(evaluateCommand(model(), [], 'Ping', { loud: true }).events.map((e) => e.type),
      ['Pinged'], 'and the guard holding publishes');
  });

  check('a guard read joins the derived DCB — it may hide nothing from the query', () => {
    const model = build(GUARDED);
    const dcb = sandbox.deriveDcb(model, model['command-definitions'].UpdateText);
    const document = dcb.items.find((item) => item.alias === 'document');
    eq(document.readProperties.includes('publishedText'), true,
      'the property only the guards read is a read');
    eq(document.types.includes('DocumentPublished'), true,
      'so its projection\'s events are in the query');
  });

  check('renaming an enum member rewrites emission guards too', () => {
    const { id, model } = open_(GUARDED);
    const body = deepClone(model()['command-definitions'].PublishDocument);
    body.publishes[0].when = [{
      leftHandSide: { alias: 'document', property: 'status' },
      predicate: 'equals',
      rightHandSide: { enumMember: 'PendingChanges' },
    }];
    updateDefinition('command-definition', id, 'PublishDocument', body);
    renameMember('custom-type-definition', id, 'DocumentStatus', 'member', 'PendingChanges', 'Dirty');
    const guard = model()['command-definitions'].PublishDocument.publishes[0].when[0];
    eq(guard.rightHandSide.enumMember, 'Dirty', 'the guard moved with the member');
  });
}

// ---------------------------------------------------------------
// Derived projections (6.0). One predicate over other projections —
// no handlers, no initial value, one boolean — declared once, bound
// as an entity property, read by command guards, and contributing its
// operands' queries to any boundary that binds it. Exercised against
// the shipped derived variant of the content-decisions family.
// ---------------------------------------------------------------
{
  const DERIVED = 9;
  const added = { type: 'DocumentAdded', data: { id: 'd1' } };
  const updated = (text) => ({ type: 'TextUpdated', data: { docId: 'd1', text } });
  const published = (text) => ({ type: 'DocumentPublished', data: { docId: 'd1', text } });

  check('a derived projection is its predicate, at every point in the log', () => {
    const model = build(DERIVED);
    const pending = (log) => foldProjection(model, log, 'DocumentHasPendingChanges', { tags: [{ type: 'DocumentId', value: 'd1' }] });
    eq(pending([]), false, 'null equals null before anything happened');
    eq(pending([added]), true, 'a fresh draft: "" differs from never-published');
    eq(pending([added, updated('a'), published('a')]), false, 'published, nothing since');
    eq(pending([added, updated('a'), published('a'), updated('b'), updated('a')]), false,
      're-typing the published text clears it, with no event saying so');
  });

  check('bound as a property and read by a guard, like any projection', () => {
    const model = build(DERIVED);
    eq(foldEntityProperty(model, [added], 'Document', 'hasPendingChanges', 'd1'), true,
      'read through the entity binding');
    const refused = evaluateCommand(model, [added, updated('a'), published('a')],
      'PublishDocument', { docId: 'd1' });
    eq(refused.outcome, 'rejected', 'nothing to publish');
    eq(refused.failedRule.text, 'document.hasPendingChanges isTrue', 'refused by the derived read');
    eq(refused.failedRule.leftValue, false, 'and the value it derived is reported');
  });

  check('its query is its operands\' union — the predicate hides nothing', () => {
    const model = build(DERIVED);
    const dcb = sandbox.deriveDcb(model, model['command-definitions'].PublishDocument);
    const document = dcb.items.find((item) => item.alias === 'document');
    for (const type of ['TextUpdated', 'DocumentPublished']) {
      eq(document.types.includes(type), true, `${type} reached the query through the derivation`);
    }
  });

  check('a cycle is an advisory and a broken run, never a crash or a hang', () => {
    const { id, model } = openBlank('Cyclic');
    addDefinition('projection-definition', id, 'Chicken', {
      parameters: [], valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'Egg', arguments: {} }, predicate: 'equals', rightHandSide: true },
    });
    addDefinition('projection-definition', id, 'Egg', {
      parameters: [], valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'Chicken', arguments: {} }, predicate: 'equals', rightHandSide: true },
    });
    const found = sandbox.modelAdvisories(model()).map((a) => a.message).join('; ');
    eq(/derives from itself/.test(found), true, 'the advisory says so: ' + found);
    let broke = null;
    try { foldProjection(model(), [], 'Chicken', {}); } catch (error) { broke = error; }
    eq(broke && broke.name, 'EvaluationError', 'and running it is the error kind, not a bug');
  });

  check('a non-boolean derived projection is an advisory, not a refusal', () => {
    const { id, model } = open_(DERIVED);
    const body = deepClone(model()['projection-definitions'].DocumentHasPendingChanges);
    body.valueType = 'string';
    updateDefinition('projection-definition', id, 'DocumentHasPendingChanges', body);
    const found = sandbox.modelAdvisories(model()).map((a) => a.message).join('; ');
    eq(/one boolean/.test(found), true, 'the advisory says what it holds: ' + found);
  });

  check('renaming an operand projection rewrites the derived reference', () => {
    const { id, model } = open_(DERIVED);
    renameDefinition('projection-definition', id, 'DocumentCurrentText', 'DocumentDraftText');
    const derived = model()['projection-definitions'].DocumentHasPendingChanges.derived;
    eq(derived.leftHandSide.projection, 'DocumentDraftText', 'the operand moved with the rename');
  });

  check('derived is data, not code — the import gate stays closed', () => {
    const model = build(DERIVED);
    eq(envelopeHasScript(buildShareEnvelope(model, [])), false, 'nothing to confirm');
  });
}

// ---------------------------------------------------------------
// Tags are what an event lists (8.0) — a tag-typed value left off the
// list is an ordinary value, an event with no list carries none, and
// the advisories say both rather than anything being implied.
// ---------------------------------------------------------------
{
  const blank = () => {
    const { id, model } = openBlank('Tags');
    addDefinition('custom-type-definition', id, 'CourseId', { schema: { type: 'string' }, isTag: true });
    addDefinition('custom-type-definition', id, 'ProductId', { schema: { type: 'string' }, isTag: true });
    addDefinition('custom-type-definition', id, 'Line', {
      properties: [{ name: 'productId', propertyType: 'ProductId' }, { name: 'qty', propertyType: 'integer' }],
    });
    return { id, model };
  };
  const prop = (name, type, isList = false) => ({ name, propertyType: type, isOptional: false, isList });
  const advised = (model, name) => sandbox.modelAdvisories(model)
    .filter((a) => a.kind === 'event-definition' && a.name === name).map((a) => a.message);

  check('an event carries the tags it lists, and only those', () => {
    const { id, model } = blank();
    addDefinition('event-definition', id, 'Untagged', { properties: [prop('courseId', 'CourseId')] });
    addDefinition('event-definition', id, 'Tagged', { properties: [prop('courseId', 'CourseId')], tags: ['courseId'] });
    eq(tagsOfEvent(model(), 'Untagged', { courseId: 'c1' }), [], 'a tag-typed value off the list is not a tag');
    eq(tagsOfEvent(model(), 'Tagged', { courseId: 'c1' }), ['CourseId:c1'], 'one on it is');
  });

  check('a record field is listed by path, one tag per element', () => {
    const { id, model } = blank();
    addDefinition('event-definition', id, 'Ordered', {
      properties: [prop('lines', 'Line', true)], tags: ['lines.productId'],
    });
    eq(tagsOfEvent(model(), 'Ordered', { lines: [{ productId: 'p1', qty: 1 }, { productId: 'p2', qty: 3 }] }),
      ['ProductId:p1', 'ProductId:p2'], 'per element');
  });

  check('the advisories say what is untagged, unlisted, or not a tag', () => {
    const { id, model } = blank();
    addDefinition('event-definition', id, 'Bare', { properties: [prop('courseId', 'CourseId')] });
    addDefinition('event-definition', id, 'Odd', {
      properties: [prop('courseId', 'CourseId'), prop('note', 'string'), prop('line', 'Line')],
      tags: ['courseId', 'courseId', 'note', 'ghost', 'line'],
    });
    const bare = advised(model(), 'Bare');
    eq(bare.some((m) => /Carries no tags/.test(m)), true, 'no tags at all');
    eq(bare.some((m) => /"courseId" is of a tag type but not one of this event's tags/.test(m)), true, 'and what it could list');
    const odd = advised(model(), 'Odd');
    eq(odd.some((m) => /listed twice/.test(m)), true, 'a duplicate');
    eq(odd.some((m) => /"note" is not of a tag type/.test(m)), true, 'a plain value');
    eq(odd.some((m) => /"ghost" names no property/.test(m)), true, 'a missing property');
    eq(odd.some((m) => /"line" is a record — name its tag field \(line\.productId\)/.test(m)), true, 'a record, whole');
    eq(odd.some((m) => /"line\.productId" is of a tag type but not one/.test(m)), true, 'and its field, unlisted');
  });

  check('a tags list that is not a list of paths is refused at the write path', () => {
    const { id } = blank();
    let refused = null;
    try { addDefinition('event-definition', id, 'Bad', { properties: [], tags: [{ path: 'x' }] }); } catch (e) { refused = e.message; }
    eq(/must be a list of property paths/.test(refused || ''), true, 'structure, not semantics');
  });

  check('renaming a property or a record field moves the tag path with it', () => {
    const { id, model } = blank();
    addDefinition('event-definition', id, 'Ordered', {
      properties: [prop('courseId', 'CourseId'), prop('lines', 'Line', true)], tags: ['courseId', 'lines.productId'],
    });
    renameMember('event-definition', id, 'Ordered', 'property', 'courseId', 'course');
    renameMember('event-definition', id, 'Ordered', 'property', 'lines', 'items');
    renameMember('custom-type-definition', id, 'Line', 'field', 'productId', 'product');
    eq(model()['event-definitions'].Ordered.tags, ['course', 'items.product'], 'both paths followed');
    eq(advised(model(), 'Ordered'), [], 'and still mean what they did');
  });

  check('a page edit lists a new tag-typed value and drops a path it emptied', () => {
    const { id, model } = blank();
    addDefinition('event-definition', id, 'E', { properties: [prop('courseId', 'CourseId')], tags: [] });
    const previous = model()['event-definitions'].E;
    const added = sandbox.withEditedTags(model(), previous,
      { ...previous, properties: [...previous.properties, prop('productId', 'ProductId')] });
    eq(added.tags, ['productId'], 'the new one listed, the deliberately unlisted one left alone');
    const tagged = { properties: [prop('courseId', 'CourseId')], tags: ['courseId'] };
    eq(sandbox.withEditedTags(model(), tagged, { properties: [], tags: ['courseId'] }).tags, [], 'removed with its property');
    eq(sandbox.withEditedTags(model(), tagged, { properties: [prop('courseId', 'string')], tags: ['courseId'] }).tags,
      [], 'and with its tag type');
  });
}

// ---------------------------------------------------------------
// A projection declares no partition (8.0): the read names its tags,
// so one fold is read per course and per student alike, and a read's
// tags are keyed by the type of the value it is read by.
// ---------------------------------------------------------------
{
  check('one fold, read by two different tags', () => {
    const model = build(0);
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 5 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    const count = (type, value) => foldProjection(model, log, 'CourseSubscriptionCount', { tags: [{ type, value }] });
    eq(count('CourseId', 'c1'), 1, 'per course');
    eq(count('StudentId', 's1'), 2, 'per student — the same fold');
    eq(foldProjection(model, log, 'CourseSubscriptionCount', {
      tags: [{ type: 'CourseId', value: 'c2' }, { type: 'StudentId', value: 's1' }],
    }), 1, 'and by both, ANDed');
    eq(foldProjection(model, log, 'CourseSubscriptionCount', {}), 2, 'and by none, the whole log');
  });

  check('a read by a tag literal folds what the literal names', () => {
    const { id, model } = open_(1);
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary.push({ alias: 'first', projection: 'CourseCapacity', tags: [{ tagType: 'CourseId', tagValue: 'c1' }] });
    body.conditions.push({ leftHandSide: { alias: 'first' }, predicate: 'greaterThan', rightHandSide: 0, rejection: 'The first course has no seats' });
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    const log = [];
    drive(model(), log, 'DefineCourse', { capacity: 5 });
    drive(model(), log, 'DefineCourse', { capacity: 7 });
    const result = evaluateCommand(model(), log, 'ChangeCourseCapacity', { courseId: 'c2', newCapacity: 9 });
    eq(result.outcome, 'published', 'it ran');
    eq(result.reads.first, {
      kind: 'projection', projection: 'CourseCapacity',
      tags: [{ type: 'CourseId', value: 'c1' }], arguments: {}, value: 5,
    }, 'the course the literal names, and the tag it was read by');
    eq(sandbox.deriveDcb(model(), body).items.find((i) => i.alias === 'first').tags, ['CourseId:c1'],
      'and the query says so');
  });

  check('a read by a value of no tag type, or by an untyped literal, is advised', () => {
    const { id, model } = open_(0);
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary.push({ alias: 'odd', projection: 'CourseCapacity', tags: [{ parameterName: 'newCapacity' }] });
    body.conditions.push({ leftHandSide: { alias: 'odd' }, predicate: 'greaterThan', rightHandSide: 0, rejection: 'Odd' });
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    let found = sandbox.modelAdvisories(model()).filter((a) => a.name === 'ChangeCourseCapacity').map((a) => a.message);
    eq(found.some((m) => /an integer — which is no tag type/.test(m)), true, found.join('; '));
    body.boundary[body.boundary.length - 1].tags = ['c1'];
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    found = sandbox.modelAdvisories(model()).filter((a) => a.name === 'ChangeCourseCapacity').map((a) => a.message);
    eq(found.some((m) => /which says no tag type — write the literal with its type/.test(m)), true, found.join('; '));
  });
}

finish();
