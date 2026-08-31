// ============================================================
// DCB Playground — evaluation tests.
//
// Exercises `evaluate.js` against the five contexts the playground
// ships, because those are the models the language was designed
// against: a command driven here is the command a modeller would drive
// in the interface, and a rule that fails here is the rule they would
// see fail.
//
// Run with `node poc/evaluate.test.js`. No dependencies and no runner —
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

const POC = __dirname;

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
  .map((file) => fs.readFileSync(path.join(POC, file), 'utf8'))
  .join('\n;\n');
vm.runInContext(source, sandbox, { filename: 'poc.js' });

function build(index) {
  store.clear();
  const id = sandbox.loadPredefinedContext(index);
  return sandbox.projectState()[id];
}

// The same, but keeping the id, so a test can drive the editing
// commands and read the context back after each one.
function open_(index) {
  store.clear();
  const id = sandbox.loadPredefinedContext(index);
  return { id, ctx: () => sandbox.projectState()[id] };
}

const {
  evaluateCommand, foldEntityProperty, foldProjection, tagsOfEvent,
  deriveThen, runScenario, scenarioTouchesScript,
  addDefinition, updateDefinition, removeDefinition, renameDefinition, renameMember, reorderDefinitions,
  createDcbContext,
  generateId, scenarioName, deepClone, evSuccessor,
  contextToSchema, buildShareEnvelope, importContextFromEnvelope, envelopeHasScript,
} = sandbox;

// A fresh, empty context — for the ad-hoc identifier-type fixtures
// below, which want a minimal model rather than one of the five shipped
// contexts.
function openBlank(name) {
  store.clear();
  const id = createDcbContext(name || 'Ad-hoc');
  return { id, ctx: () => sandbox.projectState()[id] };
}

// A fresh context with a scripted entity property — for scripted-content
// tests (script round-tripping, `envelopeHasScript`, `scenarioTouchesScript`)
// that need a fixture no PREDEFINED_CONTEXTS example carries. `Tick` reads
// the script through its boundary; `Ping` publishes the same event without
// reading it, so both sides of "does this command touch a script" exist.
function openScripted() {
  const { id, ctx } = openBlank('Scripted');
  addDefinition('entity-definition', id, 'Counter', { properties: [] });
  addDefinition('event-definition', id, 'Ticked', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
  });
  updateDefinition('entity-definition', id, 'Counter', {
    properties: [{
      name: 'total',
      propertyType: 'integer',
      script: { initialState: 0, arguments: [] },
      handlers: [{ event: 'Ticked', code: '(state || 0) + 1' }],
    }],
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
  return { id, ctx };
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
function drive(ctx, log, command, args) {
  const result = evaluateCommand(ctx, log, command, args);
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
  const ctx = build(0);

  check('define a course, then a student, then subscribe', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    eq(log[0], { type: 'CourseDefined', data: { courseId: 'c1', capacity: 2 } });
    drive(ctx, log, 'RegisterStudent', { studentId: 's1' });
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(log.length, 3, 'log length');
    eq(foldEntityProperty(ctx, log, 'Course', 'subscriptionCount', 'c1'), 1, 'subscriptionCount');
    eq(foldEntityProperty(ctx, log, 'Course', 'subscribedStudentIds', 'c1'), ['s1'], 'subscribers');
    eq(foldEntityProperty(ctx, log, 'Student', 'status', 's1'), 'Existent', 'student status');
  });

  check('a course cannot be defined twice', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    const result = evaluateCommand(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'course.status == NonExistent', 'rule');
    eq(result.failedRule.leftValue, 'Existent', 'left value');
  });

  check('a full course refuses the next subscription', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    for (const id of ['s1', 's2']) drive(ctx, log, 'RegisterStudent', { studentId: id });
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's2' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'course.subscriptionCount < course.capacity', 'rule');
    eq([result.failedRule.leftValue, result.failedRule.rightValue], [1, 1], 'values');
  });

  check('the same student cannot subscribe twice', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 9 });
    drive(ctx, log, 'RegisterStudent', { studentId: 's1' });
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(course.subscribedStudentIds contains studentId)', 'rule');
  });

  check('unsubscribing puts the capacity back', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    for (const id of ['s1', 's2']) drive(ctx, log, 'RegisterStudent', { studentId: id });
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(ctx, log, 'UnsubscribeStudentFromCourse', { courseId: 'c1', studentId: 's1' });
    eq(foldEntityProperty(ctx, log, 'Course', 'subscriptionCount', 'c1'), 0, 'count');
    eq(foldEntityProperty(ctx, log, 'Course', 'subscribedStudentIds', 'c1'), [], 'subscribers');
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's2' });
  });

  check('tags come from identifier-typed properties', () => {
    eq(tagsOfEvent(ctx, 'StudentSubscribedToCourse', { courseId: 'c1', studentId: 's1' }),
      ['CourseId:c1', 'StudentId:s1'], 'tags');
    eq(tagsOfEvent(ctx, 'CourseDefined', { courseId: 'c1', capacity: 3 }), ['CourseId:c1'], 'tags');
  });

  check('one instance never sees another instance events', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
    drive(ctx, log, 'DefineCourse', { courseId: 'c2', capacity: 7 });
    eq(foldEntityProperty(ctx, log, 'Course', 'capacity', 'c1'), 5, 'c1 capacity');
    eq(foldEntityProperty(ctx, log, 'Course', 'capacity', 'c2'), 7, 'c2 capacity');
    eq(foldEntityProperty(ctx, log, 'Course', 'status', 'c3'), 'NonExistent', 'unseen instance');
  });
}

// ---------------------------------------------------------------
// 2. Identifiers minted by a parameterless projection.
// ---------------------------------------------------------------
{
  const ctx = build(1);

  check('the numbering issues c1, c2, c3', () => {
    const log = [];
    eq(foldProjection(ctx, log, 'CourseNumbering', {}), 'c1', 'before anything');
    drive(ctx, log, 'DefineCourse', { capacity: 10 });
    eq(log[0].data.courseId, 'c1', 'first id');
    eq(foldProjection(ctx, log, 'CourseNumbering', {}), 'c2', 'after one');
    drive(ctx, log, 'DefineCourse', { capacity: 10 });
    drive(ctx, log, 'DefineCourse', { capacity: 10 });
    eq(log.map((e) => e.data.courseId), ['c1', 'c2', 'c3'], 'ids');
  });

  check('a minted command has no conditions left to fail', () => {
    const log = [];
    const result = evaluateCommand(ctx, log, 'DefineCourse', { capacity: 1 });
    eq(result.outcome, 'published', 'outcome');
    eq(result.reads.courseNumbering, { kind: 'projection', projection: 'CourseNumbering', value: 'c1' }, 'reads');
  });
}

// ---------------------------------------------------------------
// 3. A parameterised projection: numbering restarts per tenant.
// ---------------------------------------------------------------
{
  const ctx = build(2);

  check('course numbers restart per tenant, ids do not', () => {
    const log = [];
    drive(ctx, log, 'RegisterTenant', { tenantId: 't1' });
    drive(ctx, log, 'RegisterTenant', { tenantId: 't2' });
    drive(ctx, log, 'DefineCourse', { tenantId: 't1', capacity: 5 });
    drive(ctx, log, 'DefineCourse', { tenantId: 't1', capacity: 5 });
    drive(ctx, log, 'DefineCourse', { tenantId: 't2', capacity: 5 });

    const defined = log.filter((e) => e.type === 'CourseDefined');
    eq(defined.map((e) => e.data.courseId), ['c1', 'c2', 'c3'], 'ids stay global');
    eq(defined.map((e) => e.data.courseNumber), ['1', '2', '1'], 'numbers restart');
    eq(foldProjection(ctx, log, 'TenantCourseNumbering', { tenantId: 't1' }), '3', 't1 next');
    eq(foldProjection(ctx, log, 'TenantCourseNumbering', { tenantId: 't2' }), '2', 't2 next');
  });

  check('a course cannot be defined for an unregistered tenant', () => {
    const result = evaluateCommand(ctx, [], 'DefineCourse', { tenantId: 't9', capacity: 5 });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'tenant.status == Existent', 'rule');
  });
}

// ---------------------------------------------------------------
// 4. Schedules: chained bindings, fan-out and `excluding`.
// ---------------------------------------------------------------
{
  const ctx = build(3);

  const setUp = () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { capacity: 9, slots: ['2026-03-01T09'] });          // c1
    drive(ctx, log, 'DefineCourse', { capacity: 9, slots: ['2026-03-01T09'] });          // c2
    drive(ctx, log, 'DefineCourse', { capacity: 9, slots: ['2026-03-01T11'] });          // c3
    drive(ctx, log, 'RegisterStudent', { studentId: 's1' });
    return log;
  };

  check('a student cannot join two courses in the same slot', () => {
    const log = setUp();
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(others.slots containsAny course.slots)', 'rule');
  });

  check('a free slot is accepted', () => {
    const log = setUp();
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c3', studentId: 's1' });
    eq(foldEntityProperty(ctx, log, 'Student', 'subscribedCourseIds', 's1'), ['c1', 'c3'], 'courses');
  });

  check('rescheduling onto a subscriber other course is refused', () => {
    const log = setUp();
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c3', studentId: 's1' });
    const result = evaluateCommand(ctx, log, 'RescheduleCourse',
      { courseId: 'c1', slots: ['2026-03-01T11'] });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(theirs.slots containsAny slots)', 'rule');
  });

  check('excluding keeps a course from clashing with itself', () => {
    const log = setUp();
    drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    // Same slots it already occupies: `theirs` excludes c1, so there is
    // nothing left to clash with.
    drive(ctx, log, 'RescheduleCourse', { courseId: 'c1', slots: ['2026-03-01T09'] });
    eq(foldEntityProperty(ctx, log, 'Course', 'slots', 'c1'), ['2026-03-01T09'], 'slots');
  });

  check('a course with no subscribers reschedules freely', () => {
    const log = setUp();
    drive(ctx, log, 'RescheduleCourse', { courseId: 'c2', slots: ['2026-03-01T11'] });
    eq(foldEntityProperty(ctx, log, 'Course', 'slots', 'c2'), ['2026-03-01T11'], 'slots');
  });
}

// ---------------------------------------------------------------
// 5. A cart: composite list values, fan-out and zipping.
// ---------------------------------------------------------------
{
  const ctx = build(4);

  const setUp = () => {
    const log = [];
    drive(ctx, log, 'DefineProduct', { productId: 'p1', price: 100 });
    drive(ctx, log, 'DefineProduct', { productId: 'p2', price: 250 });
    return log;
  };

  check('an order at the current prices is accepted', () => {
    const log = setUp();
    const result = drive(ctx, log, 'OrderProducts', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 100 }, { productId: 'p2', price: 250 }],
    });
    eq(result.events[0].type, 'ProductsOrdered', 'event');
    eq(result.events[0].data.items.length, 2, 'items');
  });

  check('one stale line refuses the whole cart', () => {
    const log = setUp();
    const result = evaluateCommand(ctx, log, 'OrderProducts', {
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
    const result = evaluateCommand(ctx, log, 'OrderProducts', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 250 }, { productId: 'p2', price: 100 }],
    });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.atInstance, 0, 'the first line');
  });

  check('an order tags every product in the cart', () => {
    eq(tagsOfEvent(ctx, 'ProductsOrdered', {
      orderId: 'o1',
      items: [{ productId: 'p1', price: 1 }, { productId: 'p2', price: 2 }],
    }), ['OrderId:o1', 'ProductId:p1', 'ProductId:p2'], 'tags');
  });
}

// ---------------------------------------------------------------
// 7. Broken inputs are not rejections.
// ---------------------------------------------------------------
{
  const ctx = build(0);

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
    () => evaluateCommand(ctx, [], 'DefineCourse', { courseId: 'c1' }));
  broken('an unknown command is broken',
    () => evaluateCommand(ctx, [], 'NoSuchCommand', {}));
  broken('an unknown entity property is broken',
    () => foldEntityProperty(ctx, [], 'Course', 'nope', 'c1'));
  broken('a projection read without its parameter is broken',
    () => foldProjection(build(2), [], 'TenantCourseNumbering', {}));
}

// ---------------------------------------------------------------
// 8. The predicates and operands the shipped models do not reach.
//
// Six of the sixteen predicates appear in a seed. The rest are checked
// by swapping a condition into a command in memory — the context is a
// plain object, so this is the same body the interface would have
// written, without needing a seventh example model to hold it.
// ---------------------------------------------------------------
{
  const ctx = build(0);

  // One course at capacity 5 with a single subscriber.
  const log = [];
  drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
  drive(ctx, log, 'RegisterStudent', { studentId: 's1' });
  drive(ctx, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });

  const archive = ctx['command-definitions'].ArchiveCourse;
  const original = archive.conditions;

  // ArchiveCourse binds `course` and takes `courseId`, so any condition
  // over the course's state can stand in for its own.
  const holds = (condition) => {
    archive.conditions = [condition];
    try {
      return evaluateCommand(ctx, log, 'ArchiveCourse', { courseId: 'c1' }).outcome === 'published';
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
  const ctx = build(2);

  check('a zero-padded numbering keeps its padding until it outgrows it', () => {
    ctx['projection-definitions'].TenantCourseNumbering.initialValue = '008';
    const log = [];
    drive(ctx, log, 'RegisterTenant', { tenantId: 't1' });
    for (let i = 0; i < 3; i++) drive(ctx, log, 'DefineCourse', { tenantId: 't1', capacity: 1 });
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

  const store_ = (id, ctx, body) => {
    const complete = { ...body, then: deriveThen(ctx, body) };
    const key = generateId();
    addDefinition('scenario-definition', id, key, complete);
    return key;
  };

  check('a scenario is stored, derived and runs current', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    const stored = ctx()['scenario-definitions'][key];
    eq(stored.then.outcome, 'published', 'derived outcome');
    eq(stored.then.events, [{ type: 'StudentSubscribedToCourse', data: { courseId: 'c1', studentId: 's1' } }], 'derived events');
    eq(runScenario(ctx(), stored).status, 'current', 'status');
  });

  check('a scenario is named from its outcome unless it says otherwise', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    eq(scenarioName(ctx()['scenario-definitions'][key]), 'records StudentSubscribedToCourse', 'derived');
    eq(scenarioName({ name: 'the happy path', then: { outcome: 'published', events: [] } }), 'the happy path', 'override');
    eq(scenarioName({ then: { outcome: 'rejected', failedRule: { text: 'course.status == Existent' } } }),
      'is refused by course.status == Existent', 'rejected');
  });

  check('changing a rule the command checks is reported as drift', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());

    // A student may now be in at most zero courses, so what published
    // before is refused now.
    const command = deepClone(ctx()['command-definitions'].SubscribeStudentToCourse);
    command.conditions.find((c) => c.leftHandSide.property === 'subscriptionCount'
      && c.leftHandSide.alias === 'student').rightHandSide = 0;
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', command);

    const result = runScenario(ctx(), ctx()['scenario-definitions'][key]);
    eq(result.status, 'drifted', 'status');
    eq(result.expected.outcome, 'published', 'expected');
    eq(result.actual.outcome, 'rejected', 'actual');
    eq(result.actual.failedRule.text, 'student.subscriptionCount < 0', 'the rule that now refuses it');
  });

  check('a scenario never stops you deleting what it tests', () => {
    const { id, ctx } = open_(0);
    store_(id, ctx(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    // Nothing but the scenario references the command, and the
    // scenario is not allowed to be the thing that refuses.
    removeDefinition('command-definition', id, 'ArchiveCourse');
    eq('ArchiveCourse' in ctx()['command-definitions'], false, 'gone');
  });

  check('deleting what a scenario tests leaves it broken, not passing', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    removeDefinition('command-definition', id, 'ArchiveCourse');
    const result = runScenario(ctx(), ctx()['scenario-definitions'][key]);
    eq(result.status, 'broken', 'status');
    eq(result.actual, null, 'nothing to compare');
  });

  check('an event gaining a property breaks the scenarios written before it', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    const event = deepClone(ctx()['event-definitions'].CourseDefined);
    event.properties.push({ name: 'title', propertyType: 'string', isOptional: false, isList: false });
    updateDefinition('event-definition', id, 'CourseDefined', event);
    eq(runScenario(ctx(), ctx()['scenario-definitions'][key]).status, 'broken', 'status');
  });

  check('renaming an event carries the Given and the expected outcome with it', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    renameDefinition('event-definition', id, 'StudentSubscribedToCourse', 'StudentEnrolled');
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseOpened');
    const stored = ctx()['scenario-definitions'][key];
    eq(stored.given[0].event, 'CourseOpened', 'the Given followed');
    eq(stored.then.events[0].type, 'StudentEnrolled', 'the Then followed');
    eq(runScenario(ctx(), stored).status, 'current', 'still current');
  });

  check('renaming an event property moves the key in every payload', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    renameMember('event-definition', id, 'CourseDefined', 'property', 'capacity', 'seats');
    const stored = ctx()['scenario-definitions'][key];
    eq(stored.given[0].data, { courseId: 'c1', seats: 2 }, 'the Given payload');
    eq(runScenario(ctx(), stored).status, 'current', 'still current');
  });

  check('renaming a command property moves the key in the When', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    renameMember('command-definition', id, 'SubscribeStudentToCourse', 'property', 'studentId', 'enrolleeId');
    const stored = ctx()['scenario-definitions'][key];
    eq(stored.when.arguments, { courseId: 'c1', enrolleeId: 's1' }, 'the When');
    eq(runScenario(ctx(), stored).status, 'current', 'still current');
  });

  check('renaming the command it tests carries the scenario', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    renameDefinition('command-definition', id, 'SubscribeStudentToCourse', 'EnrolStudent');
    const stored = ctx()['scenario-definitions'][key];
    eq(stored.command, 'EnrolStudent', 'the reference followed');
    eq(runScenario(ctx(), stored).status, 'current', 'still current');
  });

  check('renaming a composite field reaches inside the stored values', () => {
    const { id, ctx } = open_(4);
    const key = store_(id, ctx(), {
      command: 'OrderProducts',
      given: [
        { event: 'ProductDefined', data: { productId: 'p1', price: 100 } },
      ],
      when: { arguments: { orderId: 'o1', items: [{ productId: 'p1', price: 100 }] } },
    });
    renameMember('custom-type-definition', id, 'Item', 'field', 'price', 'shownPrice');
    const stored = ctx()['scenario-definitions'][key];
    eq(stored.when.arguments.items, [{ productId: 'p1', shownPrice: 100 }], 'the When');
    eq(stored.then.events[0].data.items, [{ productId: 'p1', shownPrice: 100 }], 'the Then');
    eq(runScenario(ctx(), stored).status, 'current', 'still current');
  });

  check('a scenario is identified by an id, so it is updated rather than renamed', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    try {
      renameDefinition('scenario-definition', id, key, 'SomethingElse');
      throw new Error('did not refuse');
    } catch (error) {
      if (!/generated id/.test(error.message)) throw error;
    }
    const body = { ...ctx()['scenario-definitions'][key], name: 'the happy path' };
    updateDefinition('scenario-definition', id, key, body);
    eq(scenarioName(ctx()['scenario-definitions'][key]), 'the happy path', 'renamed by update');
  });

  check('a payload with a property the event does not have is refused', () => {
    const { id, ctx } = open_(0);
    const body = scenarioBody();
    body.then = deriveThen(ctx(), body);
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
    const scripted = openScripted().ctx();
    eq(scenarioTouchesScript(scripted, { command: 'Tick' }), true, 'reads a scripted property');
    eq(scenarioTouchesScript(scripted, { command: 'Ping' }), false, 'does not');
  });

  check('duplicating a scenario is a plain copy under a new id', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
    const original = ctx()['scenario-definitions'][key];
    const copyKey = generateId();
    addDefinition('scenario-definition', id, copyKey, deepClone(original));
    eq(copyKey === key, false, 'a fresh id');
    eq(ctx()['scenario-definitions'][copyKey], original, 'same body');
    eq(Object.keys(ctx()['scenario-definitions']), [key, copyKey], 'appended after the original');
  });

  check('reordering carries the swap through to how scenarios list', () => {
    const { id, ctx } = open_(0);
    const first = store_(id, ctx(), scenarioBody());
    const second = store_(id, ctx(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    eq(Object.keys(ctx()['scenario-definitions']), [first, second], 'as written');
    reorderDefinitions('scenario-definition', id, [second, first]);
    eq(Object.keys(ctx()['scenario-definitions']), [second, first], 'swapped');
  });

  check('reordering refuses an order that drops or invents a member', () => {
    const { id, ctx } = open_(0);
    const key = store_(id, ctx(), scenarioBody());
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
  const ctx = build(0);

  check('a published command reports what its conditions consulted', () => {
    const log = [];
    drive(ctx, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    drive(ctx, log, 'RegisterStudent', { studentId: 's1' });
    const result = evaluateCommand(ctx, log, 'SubscribeStudentToCourse',
      { courseId: 'c1', studentId: 's1' });
    eq(result.outcome, 'published', 'outcome');
    eq(Object.keys(result.reads).sort(), ['course', 'student'], 'aliases');
    eq(Object.keys(result.reads.course.instances[0].properties).sort(),
      ['capacity', 'status', 'subscribedStudentIds', 'subscriptionCount'], 'course properties');
    eq(result.reads.course.instances[0].properties.capacity, 2, 'a value it read');
    eq(result.reads.student.instances[0].id, 's1', 'the student it bound');
  });

  check('a refused command reports what it had read when it refused', () => {
    const result = evaluateCommand(ctx, [], 'SubscribeStudentToCourse',
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
      kind: 'projection', projection: 'CourseNumbering', value: 'c1',
    }, 'the numbering');
  });
}

// ---------------------------------------------------------------
// 12. An entity with an integer identifier: tagging and successor,
// end to end.
// ---------------------------------------------------------------
{
  const { id, ctx } = openBlank();

  addDefinition('entity-definition', id, 'Widget', { properties: [] });
  updateDefinition('custom-type-definition', id, 'WidgetId', { schema: { type: 'integer' }, isTag: true });
  addDefinition('event-definition', id, 'WidgetDefined', {
    properties: [{ name: 'widgetId', propertyType: 'WidgetId', isOptional: false, isList: false }],
  });
  updateDefinition('entity-definition', id, 'Widget', {
    properties: [{
      name: 'defined', propertyType: 'boolean', isOptional: false, isList: false,
      initialValue: false,
      handlers: [{ event: 'WidgetDefined', operation: 'set', value: true }],
    }],
  });
  addDefinition('projection-definition', id, 'WidgetNumbering', {
    parameters: [],
    valueType: 'WidgetId',
    isOptional: false,
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
    eq(foldProjection(ctx(), log, 'WidgetNumbering', {}), 1, 'before anything');
    drive(ctx(), log, 'DefineWidget', {});
    eq(log[0].data.widgetId, 1, 'first id is a number');
    eq(tagsOfEvent(ctx(), 'WidgetDefined', { widgetId: 1 }), ['WidgetId:1'], 'tag');
    eq(foldEntityProperty(ctx(), log, 'Widget', 'defined', 1), true, 'entity state');
    drive(ctx(), log, 'DefineWidget', {});
    eq(foldProjection(ctx(), log, 'WidgetNumbering', {}), 3, 'numbering advances by successor');
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
  const { id, ctx } = openBlank();

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
      tagsOfEvent(ctx(), 'CourseDefined', { courseId: { tenant: 't1', number: 'c1' } }),
      ['TenantTag:t1', 'CourseNumber:c1'],
      'tags are the bare component tags, never "CourseId.tenant:..." or similar'
    );
  });

  check('two entities sharing a standalone identifier-type component share its tag', () => {
    const courseTags = tagsOfEvent(ctx(), 'CourseDefined', { courseId: { tenant: 't1', number: 'c1' } });
    const invoiceTags = tagsOfEvent(ctx(), 'InvoiceRaised', { invoiceId: { tenant: 't1', series: 'i1' } });
    eq(courseTags.includes('TenantTag:t1'), true, 'course carries the shared tag');
    eq(invoiceTags.includes('TenantTag:t1'), true, 'invoice carries the same shared tag');
    eq(invoiceTags, ['TenantTag:t1', 'InvoiceSeriesId:i1'], 'invoice tags, entity-derived component included');
  });

  check('declaring a successor over a composite identifier is refused at validation time', () => {
    try {
      addDefinition('entity-definition', id, 'Ledger', {
        properties: [{
          name: 'lastCourseId', propertyType: 'CourseId', isOptional: true, isList: false,
          initialValue: null,
          handlers: [{ event: 'CourseDefined', operation: 'set', value: { successor: { eventProperty: 'courseId' } } }],
        }],
      });
      throw new Error('did not refuse');
    } catch (error) {
      if (!/composite identifier has no successor/.test(error.message)) throw error;
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
    const { id, ctx } = openBlank();
    addDefinition('entity-definition', id, 'Gadget', { properties: [] });
    addDefinition('event-definition', id, 'GadgetDefined', {
      properties: [{ name: 'gadgetId', propertyType: 'GadgetId', isOptional: false, isList: false }],
    });
    renameDefinition('entity-definition', id, 'Gadget', 'Widget');
    eq('WidgetId' in ctx()['custom-type-definitions'], true, 'the derived type renamed too');
    eq('GadgetId' in ctx()['custom-type-definitions'], false, 'old name gone');
    eq('identifierType' in ctx()['entity-definitions'].Widget, false, 'still tracking, nothing pinned');
    eq(ctx()['event-definitions'].GadgetDefined.properties[0].propertyType, 'WidgetId',
      'the property type followed the rename');
    eq(tagsOfEvent(ctx(), 'GadgetDefined', { gadgetId: 'g1' }), ['WidgetId:g1'], 'tags follow too');
  });

  check('renaming an entity whose identifier type was customised leaves the derived type alone', () => {
    const { id, ctx } = openBlank();
    addDefinition('entity-definition', id, 'Gizmo', {
      identifierType: 'GizmoRef', properties: [],
    });
    addDefinition('event-definition', id, 'GizmoDefined', {
      properties: [{ name: 'gizmoId', propertyType: 'GizmoRef', isOptional: false, isList: false }],
    });
    renameDefinition('entity-definition', id, 'Gizmo', 'Doohickey');
    eq('Doohickey' in ctx()['entity-definitions'], true, 'entity renamed');
    eq('Gizmo' in ctx()['entity-definitions'], false, 'old name gone');
    eq(ctx()['entity-definitions'].Doohickey.identifierType, 'GizmoRef', 'the override stayed put');
    eq(ctx()['event-definitions'].GizmoDefined.properties[0].propertyType, 'GizmoRef',
      'the customised identifier type did not move');
    eq(tagsOfEvent(ctx(), 'GizmoDefined', { gizmoId: 'g1' }), ['GizmoRef:g1'], 'tag unaffected by the rename');
  });

  check('renaming a tracking entity\'s derived value type directly pins it explicit', () => {
    const { id, ctx } = openBlank();
    addDefinition('entity-definition', id, 'Sprocket', { properties: [] });
    addDefinition('event-definition', id, 'SprocketDefined', {
      properties: [{ name: 'sprocketId', propertyType: 'SprocketId', isOptional: false, isList: false }],
    });

    renameDefinition('custom-type-definition', id, 'SprocketId', 'SprocketRef');
    eq(ctx()['entity-definitions'].Sprocket.identifierType, 'SprocketRef',
      'tracking is replaced by an explicit pointer at the new name');
    eq(ctx()['event-definitions'].SprocketDefined.properties[0].propertyType, 'SprocketRef',
      'the property type followed the rename');
    eq(tagsOfEvent(ctx(), 'SprocketDefined', { sprocketId: 's1' }), ['SprocketRef:s1'], 'tag follows too');

    // Now pinned, so renaming the *entity* no longer touches the type.
    renameDefinition('entity-definition', id, 'Sprocket', 'Cog');
    eq(ctx()['entity-definitions'].Cog.identifierType, 'SprocketRef', 'pin survives an entity rename');
    eq('SprocketRef' in ctx()['custom-type-definitions'], true, 'the value type keeps its own name');
  });

  check('renaming a standalone tag-marked custom type cascades like any other', () => {
    const { id, ctx } = openBlank();
    addDefinition('custom-type-definition', id, 'CourseNumber', { schema: { type: 'string' }, isTag: true });
    addDefinition('event-definition', id, 'CourseNumberIssued', {
      properties: [{ name: 'number', propertyType: 'CourseNumber', isOptional: false, isList: false }],
    });
    renameDefinition('custom-type-definition', id, 'CourseNumber', 'CourseRef');
    eq('CourseRef' in ctx()['custom-type-definitions'], true, 'renamed');
    eq('CourseNumber' in ctx()['custom-type-definitions'], false, 'old name gone');
    eq(ctx()['event-definitions'].CourseNumberIssued.properties[0].propertyType, 'CourseRef',
      'the reference followed the rename');
    eq(tagsOfEvent(ctx(), 'CourseNumberIssued', { number: 'c1' }), ['CourseRef:c1'], 'tag follows too');
  });

  check('an ordinary update cannot change identifierType', () => {
    const { id, ctx } = openBlank();
    addDefinition('entity-definition', id, 'Anvil', { properties: [] });
    try {
      updateDefinition('entity-definition', id, 'Anvil', {
        identifierType: 'AnvilRef', properties: [],
      });
      throw new Error('did not refuse');
    } catch (error) {
      if (!/ordinary update/.test(error.message)) throw error;
    }
    eq('identifierType' in ctx()['entity-definitions'].Anvil, false, 'unchanged');
  });

  check('an entity-owned value type cannot be removed directly, only by removing its entity', () => {
    const { id, ctx } = openBlank();
    addDefinition('entity-definition', id, 'Bolt', { properties: [] });
    try {
      removeDefinition('custom-type-definition', id, 'BoltId');
      throw new Error('did not refuse');
    } catch (error) {
      if (!/still referenced by/.test(error.message)) throw error;
    }
    removeDefinition('entity-definition', id, 'Bolt');
    eq('Bolt' in ctx()['entity-definitions'], false, 'entity removed');
    eq('BoltId' in ctx()['custom-type-definitions'], false, 'its derived type cascaded with it');
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
  const { id, ctx } = openBlank();

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
    script: {
      initialState: 0,
      tagFilter: ['RegionCode:{region}'],
      arguments: [{ name: 'region', propertyType: 'RegionCode' }],
    },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });

  check("a scripted projection's tagFilter resolves through a non-default tagSchema", () => {
    const log = [];
    drive(ctx(), log, 'OpenRegion', { regionCode: 'eu' });
    drive(ctx(), log, 'OpenRegion', { regionCode: 'us' });
    eq(foldProjection(ctx(), log, 'OpenRegionCount', { region: 'eu' }), 1,
      'matched through RegionCode\'s "=" tagSchema, not a hardcoded "RegionCode:eu"');
    eq(foldProjection(ctx(), log, 'OpenRegionCount', { region: 'us' }), 1, 'us counted separately');
  });
}

// ---------------------------------------------------------------
// Sharing: export to the schema shape, and the import synthesizer that
// rebuilds a context from it.
// ---------------------------------------------------------------
{
  // Dynamic Product Price (simple) is the case that actually needs the
  // retry pool: `Item`, a standalone composite custom type, names
  // `ProductId` — the identifier type `Product` derives, which does not
  // exist until the entity does. A synthesizer that added every custom
  // type before any entity would refuse this context.
  const original = build(4);
  const envelope = buildShareEnvelope(original, []);
  const importedId = importContextFromEnvelope(envelope);
  const imported = sandbox.projectState()[importedId];

  check('a context with a standalone type naming an entity-derived id round-trips', () => {
    eq(contextToSchema(imported), contextToSchema(original), 'the reconstructed context');
  });

  check('the imported context is independently valid — its own commands still run', () => {
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
  const original = openScripted().ctx();
  const importedId = importContextFromEnvelope(buildShareEnvelope(original, []));
  const imported = sandbox.projectState()[importedId];

  check('a context with a scripted entity property round-trips', () => {
    eq(contextToSchema(imported), contextToSchema(original), 'the reconstructed context');
  });

  check('the imported scripted property still folds', () => {
    const log = [];
    drive(imported, log, 'Tick', { counterId: 'x1' });
    eq(foldEntityProperty(imported, log, 'Counter', 'total', 'x1'), 1, 'one tick folded');
  });
}

{
  const plain = build(4);
  const scripted = openScripted().ctx(); // a scripted entity property

  check('envelopeHasScript is false for a context with no scripts', () => {
    eq(envelopeHasScript(buildShareEnvelope(plain, [])), false, 'plain context');
  });
  check('envelopeHasScript is true for a scripted entity property', () => {
    eq(envelopeHasScript(buildShareEnvelope(scripted, [])), true, 'scripted context');
  });

  // None of the shipped contexts have a scripted *projection* (only the
  // scripted property above), so this checks that side with a small
  // ad-hoc one instead.
  const { id, ctx } = openBlank();
  addDefinition('custom-type-definition', id, 'RegionCode', { schema: { type: 'string' }, isTag: true });
  addDefinition('event-definition', id, 'RegionOpened', {
    properties: [{ name: 'regionCode', propertyType: 'RegionCode', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'OpenRegionCount', {
    valueType: 'integer',
    script: { initialState: 0, tagFilter: ['RegionCode:{region}'], arguments: [{ name: 'region', propertyType: 'RegionCode' }] },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });
  check('envelopeHasScript is true for a scripted (standalone) projection', () => {
    eq(envelopeHasScript(buildShareEnvelope(ctx(), [])), true, 'scripted projection');
  });
}

{
  // Scenarios are the one kind identified by a generated id rather than
  // a name — importing has to mint a fresh one rather than reuse
  // whatever the export carried, the same way `saveScenario` does.
  const { id, ctx } = openBlank();
  addDefinition('event-definition', id, 'ThingHappened', { properties: [] });
  addDefinition('command-definition', id, 'DoThing', {
    properties: [], boundary: [], conditions: [],
    publishes: [{ name: 'ThingHappened', parameters: {} }],
  });
  const body = { command: 'DoThing', given: [], when: { arguments: {} } };
  body.then = deriveThen(ctx(), body);
  const originalScenarioId = generateId();
  addDefinition('scenario-definition', id, originalScenarioId, body);

  const envelope = buildShareEnvelope(ctx(), []);
  const importedId = importContextFromEnvelope(envelope);
  const imported = sandbox.projectState()[importedId];
  const importedScenarioIds = Object.keys(imported['scenario-definitions']);

  check('an imported scenario keeps its content but gets a fresh id', () => {
    eq(importedScenarioIds.length, 1, 'exactly one scenario carried over');
    eq(importedScenarioIds[0] === originalScenarioId, false, 'a new id, not the exported one');
    eq(imported['scenario-definitions'][importedScenarioIds[0]].command, 'DoThing', 'the scenario body itself');
  });
}

check('an import missing the schema-shaped context is refused, not silently accepted', () => {
  let threw = false;
  try { importContextFromEnvelope({ name: 'Bad' }); } catch (error) { threw = !!error; }
  eq(threw, true, 'importContextFromEnvelope without a context field');
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
