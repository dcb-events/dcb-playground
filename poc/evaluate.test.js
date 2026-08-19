// ============================================================
// DCB Playground — evaluation tests.
//
// Exercises `evaluate.js` against the six contexts the playground
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
  addDefinition, updateDefinition, removeDefinition, renameDefinition, renameMember,
  generateId, scenarioName, deepClone,
} = sandbox;

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
function drive(ctx, log, command, args, at) {
  const result = evaluateCommand(ctx, log, command, args, { recordedAt: at || 0 });
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
    eq(log[0], { type: 'CourseDefined', data: { courseId: 'c1', capacity: 2 }, metadata: { recordedAt: 0 } });
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
      ['Course:c1', 'Student:s1'], 'tags');
    eq(tagsOfEvent(ctx, 'CourseDefined', { courseId: 'c1', capacity: 3 }), ['Course:c1'], 'tags');
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
    }), ['Order:o1', 'Product:p1', 'Product:p2'], 'tags');
  });
}

// ---------------------------------------------------------------
// 6. A scripted property: the grace period on repricing.
// ---------------------------------------------------------------
{
  const ctx = build(5);
  const HOUR = 3600;

  const setUp = () => {
    const log = [];
    drive(ctx, log, 'DefineProduct', { productId: 'p1', price: 100 }, 1000);
    return log;
  };

  check('the script exposes only the prices a condition may see', () => {
    const log = setUp();
    eq(foldEntityProperty(ctx, log, 'Product', 'validPrices', 'p1', { now: 1000 }), [100], 'prices');
  });

  check('a repriced product still honours the old price inside the hour', () => {
    const log = setUp();
    drive(ctx, log, 'ChangeProductPrice', { productId: 'p1', newPrice: 120 }, 1000 + HOUR / 2);
    const now = 1000 + HOUR / 2 + 10;
    eq(foldEntityProperty(ctx, log, 'Product', 'validPrices', 'p1', { now }), [100, 120], 'both');
    drive(ctx, log, 'OrderProducts', { orderId: 'o1', now, items: [{ productId: 'p1', price: 100 }] });
  });

  check('the old price stops being honoured once the window passes it', () => {
    const log = setUp();
    drive(ctx, log, 'ChangeProductPrice', { productId: 'p1', newPrice: 120 }, 1000 + HOUR / 2);
    // The window still covers the repricing, so only the new price is
    // left: 100 was set before the window opened. The comparison is
    // `>=`, so one second past the hour is what puts it outside.
    const now = 1000 + HOUR + 1;
    eq(foldEntityProperty(ctx, log, 'Product', 'validPrices', 'p1', { now }), [120], 'new only');
    const result = evaluateCommand(ctx, log, 'OrderProducts',
      { orderId: 'o1', now, items: [{ productId: 'p1', price: 100 }] });
    eq(result.outcome, 'rejected', 'outcome');
  });

  // Documents a defect in the *seeded model*, not in the evaluator.
  // `lastValidOldPrice` is accumulated exactly as the script's comment
  // describes, but `exposes: 'validNewPrices'` never surfaces it — so
  // once the window has moved past every price event the product has no
  // valid price at all and can never be ordered again. Kept as a test
  // so that fixing the seed announces itself here.
  check('KNOWN SEED DEFECT: a product goes unorderable an hour after its last repricing', () => {
    const log = setUp();
    drive(ctx, log, 'ChangeProductPrice', { productId: 'p1', newPrice: 120 }, 1000 + HOUR / 2);
    const now = 1000 + HOUR * 3;
    eq(foldEntityProperty(ctx, log, 'Product', 'validPrices', 'p1', { now }), [], 'nothing valid');
    for (const price of [100, 120]) {
      const result = evaluateCommand(ctx, log, 'OrderProducts',
        { orderId: 'o1', now, items: [{ productId: 'p1', price }] });
      eq(result.outcome, 'rejected', `ordering at ${price}`);
    }
  });

  check('the instant is read once for the whole cart', () => {
    const log = [];
    drive(ctx, log, 'DefineProduct', { productId: 'p1', price: 100 }, 1000);
    drive(ctx, log, 'DefineProduct', { productId: 'p2', price: 200 }, 1000);
    drive(ctx, log, 'ChangeProductPrice', { productId: 'p1', newPrice: 110 }, 1000 + HOUR / 2);
    drive(ctx, log, 'ChangeProductPrice', { productId: 'p2', newPrice: 210 }, 1000 + HOUR / 2);
    const now = 1000 + HOUR / 2 + 10;
    drive(ctx, log, 'OrderProducts', {
      orderId: 'o1', now,
      items: [{ productId: 'p1', price: 100 }, { productId: 'p2', price: 210 }],
    }, now);
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
      { event: 'CourseDefined', data: { courseId: 'c1', capacity: 2 }, recordedAt: 100 },
      { event: 'StudentRegistered', data: { studentId: 's1' }, recordedAt: 200 },
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
        { event: 'ProductDefined', data: { productId: 'p1', price: 100 }, recordedAt: 10 },
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

  check('a Given event without an instant is refused at save', () => {
    const { id, ctx } = open_(0);
    const body = scenarioBody();
    body.then = deriveThen(ctx(), body);
    delete body.given[0].recordedAt;
    try {
      addDefinition('scenario-definition', id, generateId(), body);
      throw new Error('did not refuse');
    } catch (error) {
      if (!/instant it was recorded at/.test(error.message)) throw error;
    }
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
    const scripted = build(5);
    eq(scenarioTouchesScript(scripted, { command: 'OrderProducts' }), true, 'reads a scripted property');
    eq(scenarioTouchesScript(scripted, { command: 'DefineProduct' }), false, 'does not');
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


console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
