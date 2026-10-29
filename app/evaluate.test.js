// ============================================================
// DCB Playground – evaluation tests.
//
// Exercises `evaluate.js` against the five models the playground
// ships, because those are the models the language was designed
// against: a command driven here is the command a modeller would drive
// in the interface, and a rule that fails here is the rule they would
// see fail.
//
// Run with `node app/evaluate.test.js`. No dependencies and no runner –
// the playground has neither, and a test suite that needed a build step
// would be the first thing in this project to need one.
//
// `model.js` and `evaluate.js` are classic scripts, so they are loaded
// into one `vm` context with a stubbed `localStorage` rather than
// required – the sandbox, the loader and the assertions live in
// `test-harness.js`, shared with the other two suites.
// ============================================================
const { createSandbox, loadApp, makeChecker } = require('./test-harness.js');

const { sandbox, store } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS; globalThis.DEF_COLLECTIONS = DEF_COLLECTIONS;'
    + ' globalThis.DomainError = DomainError; globalThis.EVENT_LOG_KEY = EVENT_LOG_KEY;',
});
const { check, eq, finish } = makeChecker();

// Clearing the store is a write `appendEvents` never sees, so the
// projection cache is told the world moved underneath it.
function resetStore() {
  store.clear();
  sandbox.bumpLogRevision();
}

const PREDEFINED_INDEX = (slug) => sandbox.PREDEFINED_MODELS.findIndex((m) => m.slug === slug);

// The course example as a 10.x document stated it with entities – what
// `course-entities` shipped as until 11.0: `course-simple` with each of
// its projections bound by the entity it is about, and every rule
// reading the entity's property where the shipped model reads the
// projection in place. Imported, it is the course example in groups,
// `course.status` and all (`GROUPED`) – which is also what the import
// conversion is tested against.
const LEGACY_ENTITIES = {
  Student: { icon: '🧑‍🎓', lifecycle: 'exists', properties: [
    ['exists', 'StudentExists'], ['subscriptionCount', 'StudentSubscriptionCount']] },
  Course: { icon: '📚', lifecycle: 'status', properties: [
    ['status', 'CourseStatus'], ['capacity', 'CourseCapacity'],
    ['subscriptionCount', 'CourseSubscriptionCount'], ['subscribedStudentIds', 'CourseSubscribedStudentIds']] },
};
function legacyEnvelope(index = PREDEFINED_INDEX('course-simple'), entities = LEGACY_ENTITIES) {
  resetStore();
  const id = sandbox.loadPredefinedModel(index);
  const envelope = deepClone(buildShareEnvelope(sandbox.projectState()[id], []));
  envelope.$schema = 'https://dcb.events/schemas/model/v10.json';
  envelope.dcbModelVersion = '10.0';
  delete envelope.groupDefinitions;
  envelope.entityDefinitions = Object.entries(entities).map(([name, { icon, lifecycle, properties, identifierType }]) => ({
    name, icon, ...(identifierType ? { identifierType } : {}),
    properties: properties.map(([property, projection]) => ({ name: property, projection })), lifecycle,
  }));
  const owner = new Map();
  for (const [name, { properties }] of Object.entries(entities)) {
    for (const [property, projection] of properties) owner.set(projection, [name, property]);
  }
  for (const command of envelope.commandDefinitions) {
    const bindings = [];
    const toEntity = (operand) => {
      if (Array.isArray(operand)) return operand.map(toEntity);
      if (!operand || typeof operand !== 'object') return operand;
      if (operand.projection !== undefined && owner.has(operand.projection)) {
        const [entity, property] = owner.get(operand.projection);
        const alias = entity.charAt(0).toLowerCase() + entity.slice(1);
        if (!bindings.some((b) => b.alias === alias)) bindings.push({ alias, entity, id: Object.values(operand.tags)[0] });
        return { alias, property };
      }
      return Object.fromEntries(Object.entries(operand).map(([key, value]) => [key, toEntity(value)]));
    };
    command.conditions = toEntity(command.conditions);
    command.publishes = toEntity(command.publishes);
    command.boundary = [...bindings, ...command.boundary];
  }
  return envelope;
}
const GROUPED = 'grouped';

function open_(index) {
  if (index === GROUPED) {
    const envelope = legacyEnvelope();
    resetStore();
    const { modelId } = importModelFromEnvelope(envelope);
    return { id: modelId, model: () => sandbox.projectState()[modelId] };
  }
  resetStore();
  const id = sandbox.loadPredefinedModel(index);
  return { id, model: () => sandbox.projectState()[id] };
}

function build(index) {
  return open_(index).model();
}

// A group member's value, read the way a group binding reads it: the
// qualified projection, by the group's tag.
function foldMember(model, log, group, member, id, args) {
  const tag = model['group-definitions'][group].tag;
  return foldProjection(model, log, `${group}.${member}`, { tags: { [tag.name]: id }, args: args || {} });
}

const SIMPLE = PREDEFINED_INDEX('course-simple');
const SEQUENCE = PREDEFINED_INDEX('course-sequence');
const TENANT = PREDEFINED_INDEX('course-tenant');
const PRICING = PREDEFINED_INDEX('pricing-simple');

const {
  evaluateCommand, foldProjection, foldProjectionState, tagsOfEvent,
  deriveThen, runScenario, setScriptsDisabled,
  deriveProjectionScenarioThen, runProjectionScenario,
  addDefinition, updateDefinition, removeDefinition, renameDefinition, renameMember, reorderDefinitions,
  createDcbModel,
  generateId, scenarioName, deepClone, evSuccessor,
  definitionsToSchema, buildShareEnvelope, importModelFromEnvelope, envelopeHasScript, envelopeScripts,
  envelopeVersionWarning, modelMatchingEnvelope, commandRejections,
} = sandbox;

// An event a fixture adds, tagged by every tag-typed value it holds –
// what an author listing them all would write. Events are tagged only
// by what they list (8.0); fixtures that test the list itself spell
// `tags` out, and this leaves a given list alone.
function addTaggedEvent(id, name, body) {
  const tags = body.tags || sandbox.tagPathsOf(sandbox.projectState()[id], body.properties);
  return sandbox.addDefinition('event-definition', id, name, { ...body, tags });
}

// A fresh, empty model – for the ad-hoc identifier-type fixtures
// below, which want a minimal model rather than one of the five shipped
// models.
function openBlank(name) {
  resetStore();
  const id = createDcbModel(name || 'Ad-hoc');
  return { id, model: () => sandbox.projectState()[id] };
}

// A fresh model with a scripted projection in a group – for
// scripted-content tests (script round-tripping, `envelopeHasScript`,
// safe mode) that need a fixture no PREDEFINED_MODELS example carries.
// `Tick` reads the script through its boundary, as `counter.total`.
function openScripted() {
  const { id, model } = openBlank('Scripted');
  sandbox.createGroup(id, 'Counter', { name: 'counterId', tagType: 'CounterId' });
  addTaggedEvent(id, 'Ticked', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'Counter.total', {
    valueType: 'integer',
    isList: false,
    script: { initialState: 0 },
    handlers: [{ event: 'Ticked', code: '(state || 0) + 1' }],
  });
  addDefinition('command-definition', id, 'Tick', {
    properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
    boundary: [{ alias: 'counter', group: 'Counter', tags: { counterId: { parameterName: 'counterId' } } }],
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
  const model = build(GROUPED);

  check('define a course, then a student, then subscribe', () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 2 });
    eq(log[0], { type: 'CourseDefined', data: { courseId: 'c1', capacity: 2 } });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(log.length, 3, 'log length');
    eq(foldMember(model, log, 'Course', 'subscriptionCount', 'c1'), 1, 'subscriptionCount');
    eq(foldMember(model, log, 'Course', 'subscribedStudentIds', 'c1'), ['s1'], 'subscribers');
    eq(foldMember(model, log, 'Student', 'exists', 's1'), true, 'the student exists');
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
    eq(foldMember(model, log, 'Course', 'subscriptionCount', 'c1'), 0, 'count');
    eq(foldMember(model, log, 'Course', 'subscribedStudentIds', 'c1'), [], 'subscribers');
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
    eq(foldMember(model, log, 'Course', 'capacity', 'c1'), 5, 'c1 capacity');
    eq(foldMember(model, log, 'Course', 'capacity', 'c2'), 7, 'c2 capacity');
    eq(foldMember(model, log, 'Course', 'status', 'c3'), 'NonExistent', 'unseen instance');
  });
}

// ---------------------------------------------------------------
// 2. Identifiers minted by a parameterless projection.
// ---------------------------------------------------------------
{
  const model = build(SEQUENCE);

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
  const model = build(TENANT);

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
    eq(foldProjection(model, log, 'TenantCourseNumbering', { tags: { tenantId: 't1' } }), '3', 't1 next');
    eq(foldProjection(model, log, 'TenantCourseNumbering', { tags: { tenantId: 't2' } }), '2', 't2 next');
  });

  check('a course cannot be defined for an unregistered tenant', () => {
    const result = evaluateCommand(model, [], 'DefineCourse', { tenantId: 't9', capacity: 5 });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'TenantExists(tenantId) isTrue', 'rule');
  });
}

// ---------------------------------------------------------------
// 4. Schedules: chained group bindings and fan-out.
//
// What `course-schedules` was until 11.0, in groups: a slot is an hour,
// a course occupies some, and a student is never in two courses at
// once – checked against each course's current schedule, read through
// a group binding fanned out over the student's courses. Rescheduling
// reads the subscribers, then all of their courses; with `excluding`
// gone, those include the course being rescheduled, as of its old
// slots.
// ---------------------------------------------------------------
function openSchedules() {
  const { id, model } = open_(GROUPED);
  const list = (name, propertyType) => ({ name, propertyType, isOptional: false, isList: true });
  const one = (name, propertyType) => ({ name, propertyType, isOptional: false, isList: false });
  const of = (alias, property) => ({ alias, property });
  addDefinition('custom-type-definition', id, 'TimeSlot', {
    schema: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$' },
  });
  const defined = deepClone(model()['event-definitions'].CourseDefined);
  defined.properties.push(list('slots', 'TimeSlot'));
  updateDefinition('event-definition', id, 'CourseDefined', defined);
  addTaggedEvent(id, 'CourseRescheduled', { properties: [one('courseId', 'CourseId'), list('slots', 'TimeSlot')] });
  addDefinition('projection-definition', id, 'Course.slots', {
    valueType: 'TimeSlot', isList: true, initialValue: [],
    handlers: [
      { event: 'CourseDefined', operation: 'set', value: { eventProperty: 'slots' } },
      { event: 'CourseRescheduled', operation: 'set', value: { eventProperty: 'slots' } },
    ],
  });
  addDefinition('projection-definition', id, 'Student.subscribedCourseIds', {
    valueType: 'CourseId', isList: true, initialValue: [],
    handlers: [
      { event: 'StudentSubscribedToCourse', operation: 'append', value: { eventProperty: 'courseId' } },
      { event: 'StudentUnsubscribedFromCourse', operation: 'remove', value: { eventProperty: 'courseId' } },
    ],
  });
  const define = deepClone(model()['command-definitions'].DefineCourse);
  define.properties.push(list('slots', 'TimeSlot'));
  define.publishes[0].parameters.slots = { parameterName: 'slots' };
  updateDefinition('command-definition', id, 'DefineCourse', define);
  const subscribe = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
  subscribe.boundary.push({ alias: 'others', group: 'Course',
    tags: { courseId: { each: of('student', 'subscribedCourseIds') } } });
  subscribe.conditions.push({ leftHandSide: of('others', 'slots'), predicate: 'containsAny',
    rightHandSide: of('course', 'slots'), negate: true, rejection: 'Course clashes with the student\'s schedule' });
  updateDefinition('command-definition', id, 'SubscribeStudentToCourse', subscribe);
  addDefinition('command-definition', id, 'RescheduleCourse', {
    properties: [one('courseId', 'CourseId'), list('slots', 'TimeSlot')],
    boundary: [
      { alias: 'course', group: 'Course', tags: { courseId: { parameterName: 'courseId' } } },
      { alias: 'students', group: 'Student', tags: { studentId: { each: of('course', 'subscribedStudentIds') } } },
      { alias: 'theirs', group: 'Course', tags: { courseId: { each: of('students', 'subscribedCourseIds') } } },
    ],
    conditions: [
      { leftHandSide: of('course', 'status'), predicate: 'equals', rightHandSide: { enumMember: 'Existent' },
        rejection: 'Course is not active' },
      { leftHandSide: of('theirs', 'slots'), predicate: 'containsAny', rightHandSide: { parameterName: 'slots' },
        negate: true, rejection: 'Slots clash with a subscriber\'s course' },
    ],
    publishes: [{ name: 'CourseRescheduled',
      parameters: { courseId: { parameterName: 'courseId' }, slots: { parameterName: 'slots' } } }],
  });
  return { id, model };
}

{
  const { model: current } = openSchedules();
  const model = current();

  const setUp = () => {
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 9, slots: ['2026-03-01T09'] });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 9, slots: ['2026-03-01T09'] });
    drive(model, log, 'DefineCourse', { courseId: 'c3', capacity: 9, slots: ['2026-03-01T11'] });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    return log;
  };

  check('the schedules model is advisory-clean', () => {
    eq(sandbox.modelAdvisories(model), [], 'advisories');
  });

  check('a student cannot join two courses in the same slot', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const result = evaluateCommand(model, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(others.slots containsAny course.slots)', 'rule');
    eq(result.reads.others.fanned, true, 'others fanned out');
    eq(result.reads.others.instances.map((i) => [i.id, Object.keys(i.properties)]), [['c1', ['slots']]],
      'one instance per course the student holds, each read for its slots alone');
  });

  check('a free slot is accepted', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c3', studentId: 's1' });
    eq(foldMember(model, log, 'Student', 'subscribedCourseIds', 's1'), ['c1', 'c3'], 'courses');
  });

  check('a fanned group binding is one query item, of the members its rules read', () => {
    const items = sandbox.deriveDcb(model, model['command-definitions'].SubscribeStudentToCourse).items;
    const others = items.filter((item) => item.alias === 'others');
    eq(others.length, 1, 'one item');
    eq(others[0].fannedOut, true, 'fanned out');
    eq(others[0].tags, ['CourseId:{each student.subscribedCourseIds}'], 'by each of the student\'s courses');
    eq(others[0].types, ['CourseDefined', 'CourseRescheduled'], 'and only the slots\' events');
    eq(others[0].readProperties, ['slots'], 'which it says');
    const course = items.find((item) => item.alias === 'course');
    eq(course.readProperties, ['capacity', 'slots', 'status', 'subscribedStudentIds', 'subscriptionCount'],
      'the course, for what its rules read of it');
  });

  check('rescheduling onto a subscriber\'s other course is refused', () => {
    const log = setUp();
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c3', studentId: 's1' });
    const result = evaluateCommand(model, log, 'RescheduleCourse',
      { courseId: 'c1', slots: ['2026-03-01T11'] });
    eq(result.outcome, 'rejected', 'outcome');
    eq(result.failedRule.text, 'not(theirs.slots containsAny slots)', 'rule');
  });

  check('a course with no subscribers reschedules freely', () => {
    const log = setUp();
    drive(model, log, 'RescheduleCourse', { courseId: 'c2', slots: ['2026-03-01T11'] });
    eq(foldMember(model, log, 'Course', 'slots', 'c2'), ['2026-03-01T11'], 'slots');
  });
}

// ---------------------------------------------------------------
// 5. A cart: composite list values, fan-out and zipping.
// ---------------------------------------------------------------
{
  const model = build(PRICING);

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
  const model = build(GROUPED);

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
  broken('an unknown group member is broken',
    () => foldMember(model, [], 'Course', 'nope', 'c1'));
  broken('a projection read tagged by no value is broken',
    () => foldProjection(build(TENANT), [], 'TenantCourseNumbering', { tags: [{ type: 'TenantId', value: null }] }));
}

// ---------------------------------------------------------------
// 8. The predicates and operands the shipped models do not reach.
//
// Six of the sixteen predicates appear in a seed. The rest are checked
// by swapping a condition into a command in memory – the model is a
// plain object, so this is the same body the interface would have
// written, without needing a seventh example model to hold it.
// ---------------------------------------------------------------
{
  const model = build(GROUPED);

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

  check('a string predicate over null holds for nothing', () => {
    // String(null) is "null": "annulled" contained it, and it started
    // "nu". No value is no text, so nothing is in it or begins it.
    const apply = (predicate, left, right) => sandbox.evApplyPredicate({ predicate }, left, right);
    eq(apply('contains', 'annulled', null), false, 'contains null');
    eq(apply('startsWith', null, 'nu'), false, 'null startsWith');
    eq(apply('endsWith', 'null', null), false, 'endsWith null');
    eq(apply('startsWith', 'nu', null), false, 'startsWith null');
    eq(apply('contains', null, 'x'), false, 'null contains');
    eq(apply('contains', ['a', null], null), true, 'a list may still hold a null');
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
  const model = build(TENANT);

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
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    const stored = model()['scenario-definitions'][key];
    eq(stored.then.outcome, 'published', 'derived outcome');
    eq(stored.then.events, [{ type: 'StudentSubscribedToCourse', data: { courseId: 'c1', studentId: 's1' } }], 'derived events');
    eq(runScenario(model(), stored).status, 'current', 'status');
  });

  check('a scenario is named from its outcome unless it says otherwise', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    eq(scenarioName(model()['scenario-definitions'][key]), 'records StudentSubscribedToCourse', 'derived');
    eq(scenarioName({ name: 'the happy path', then: { outcome: 'published', events: [] } }), 'the happy path', 'override');
    eq(scenarioName({ then: { outcome: 'rejected', rejection: 'Course is not active' } }),
      'is refused: Course is not active', 'rejected');
  });

  check('changing a rule the command checks is reported as drift', () => {
    const { id, model } = open_(GROUPED);
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
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), refused());
    const before = model()['scenario-definitions'][key].then;
    moveToFront(model, id, (c) => c.leftHandSide.alias === 'student'
      && c.leftHandSide.property === 'subscriptionCount');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.actual.rejection, before.rejection, 'the same rule still refuses');
    eq(result.status, 'current', 'and that is not a change in behaviour');
  });

  check('moving rules so another refuses first is drift', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), refused());
    const before = model()['scenario-definitions'][key].then;
    moveToFront(model, id, (c) => c.leftHandSide.alias === 'student'
      && c.leftHandSide.property !== 'subscriptionCount');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.actual.rejection === before.rejection, false, 'a different message refuses now');
    eq(result.status, 'drifted', 'which is what a refusal names, so it drifts');
  });

  check('rules sharing a message are one outcome, whichever of them refuses', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), refused());
    eq(model()['scenario-definitions'][key].then.rejection, 'Course is not active', 'the course rule refuses');
    // The student rule now says the same thing, and is moved ahead, so
    // it refuses first – but the outcome is the one the scenario names.
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
    const { id, model } = open_(GROUPED);
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
    const { id, model } = open_(GROUPED);
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
    const { id, model } = open_(GROUPED);
    store_(id, model(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    // Nothing but the scenario references the command, and the
    // scenario is not allowed to be the thing that refuses.
    removeDefinition('command-definition', id, 'ArchiveCourse');
    eq('ArchiveCourse' in model()['command-definitions'], false, 'gone');
  });

  check('deleting what a scenario tests leaves it broken, not passing', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    removeDefinition('command-definition', id, 'ArchiveCourse');
    const result = runScenario(model(), model()['scenario-definitions'][key]);
    eq(result.status, 'broken', 'status');
    eq(result.actual, null, 'nothing to compare');
  });

  check('an event gaining a property breaks the scenarios written before it', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    const event = deepClone(model()['event-definitions'].CourseDefined);
    event.properties.push({ name: 'title', propertyType: 'string', isOptional: false, isList: false });
    updateDefinition('event-definition', id, 'CourseDefined', event);
    eq(runScenario(model(), model()['scenario-definitions'][key]).status, 'broken', 'status');
  });

  check('renaming an event carries the Given and the expected outcome with it', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    renameDefinition('event-definition', id, 'StudentSubscribedToCourse', 'StudentEnrolled');
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseOpened');
    const stored = model()['scenario-definitions'][key];
    eq(stored.given[0].event, 'CourseOpened', 'the Given followed');
    eq(stored.then.events[0].type, 'StudentEnrolled', 'the Then followed');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming an event property moves the key in every payload', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    renameMember('event-definition', id, 'CourseDefined', 'property', 'capacity', 'seats');
    const stored = model()['scenario-definitions'][key];
    eq(stored.given[0].data, { courseId: 'c1', seats: 2 }, 'the Given payload');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming a command property moves the key in the When', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    renameMember('command-definition', id, 'SubscribeStudentToCourse', 'property', 'studentId', 'enrolleeId');
    const stored = model()['scenario-definitions'][key];
    eq(stored.when.arguments, { courseId: 'c1', enrolleeId: 's1' }, 'the When');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming the command it tests carries the scenario', () => {
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    renameDefinition('command-definition', id, 'SubscribeStudentToCourse', 'EnrolStudent');
    const stored = model()['scenario-definitions'][key];
    eq(stored.command, 'EnrolStudent', 'the reference followed');
    eq(runScenario(model(), stored).status, 'current', 'still current');
  });

  check('renaming a composite field reaches inside the stored values', () => {
    const { id, model } = open_(PRICING);
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
    const { id, model } = open_(GROUPED);
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
    // The lenient regime: an invented payload property is inert – the
    // folds never read it – so storing it beats refusing the scenario.
    const { id, model } = open_(GROUPED);
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
    const { id, model } = open_(GROUPED);
    const key = store_(id, model(), scenarioBody());
    const original = model()['scenario-definitions'][key];
    const copyKey = generateId();
    addDefinition('scenario-definition', id, copyKey, deepClone(original));
    eq(copyKey === key, false, 'a fresh id');
    eq(model()['scenario-definitions'][copyKey], original, 'same body');
    eq(Object.keys(model()['scenario-definitions']), [key, copyKey], 'appended after the original');
  });

  check('reordering carries the swap through to how scenarios list', () => {
    const { id, model } = open_(GROUPED);
    const first = store_(id, model(), scenarioBody());
    const second = store_(id, model(), { ...scenarioBody(), command: 'ArchiveCourse',
      when: { arguments: { courseId: 'c1' } } });
    eq(Object.keys(model()['scenario-definitions']), [first, second], 'as written');
    reorderDefinitions('scenario-definition', id, [second, first]);
    eq(Object.keys(model()['scenario-definitions']), [second, first], 'swapped');
  });

  check('reordering refuses an order that drops or invents a member', () => {
    const { id, model } = open_(GROUPED);
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
// report has to be taken after the conditions have run – described
// before them it would say a command read nothing, which is what the
// sandbox showed when it did.
// ---------------------------------------------------------------
{
  const model = build(GROUPED);

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
    // reported – not every property the command could have read.
    eq(Object.keys(result.reads.course.instances[0].properties), ['status'], 'only what it got to');
    eq(result.reads.course.instances[0].properties.status, 'NonExistent', 'the value that refused it');
  });

  check('a projection binding reports the value it issued', () => {
    const seq = build(SEQUENCE);
    const result = evaluateCommand(seq, [], 'DefineCourse', { capacity: 3 });
    eq(result.reads.courseNumbering, {
      // The arguments ride along with the value: a partition is half of
      // what a read was, and a reader following it needs both.
      kind: 'projection', projection: 'CourseNumbering', tags: [], arguments: {}, value: 'c1',
    }, 'the numbering');
  });
}

// ---------------------------------------------------------------
// 12. A group with an integer tag: tagging and successor, end to end.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();

  sandbox.createGroup(id, 'Widget', { name: 'widgetId', tagType: 'WidgetId' });
  updateDefinition('custom-type-definition', id, 'WidgetId', { schema: { type: 'integer' }, isTag: true });
  addTaggedEvent(id, 'WidgetDefined', {
    properties: [{ name: 'widgetId', propertyType: 'WidgetId', isOptional: false, isList: false }],
  });
  addDefinition('projection-definition', id, 'Widget.defined', {
    valueType: 'boolean',
    isList: false,
    initialValue: false,
    handlers: [{ event: 'WidgetDefined', operation: 'set', value: true }],
  });
  addDefinition('projection-definition', id, 'WidgetNumbering', {
    tags: [],
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
    eq(foldMember(model(), log, 'Widget', 'defined', 1), true, 'the grouped projection, by its integer tag');
    drive(model(), log, 'DefineWidget', {});
    eq(foldProjection(model(), log, 'WidgetNumbering', {}), 3, 'numbering advances by successor');
  });
}

// ---------------------------------------------------------------
// 13 & 14. Composite identifiers: union-of-component tags, and a tag
// type shared across two composite ids.
//
// `CourseId` and `InvoiceId` each compose a shared `TenantTag` with a
// component of their own (`CourseNumber`, `InvoiceSeriesId`). Tag
// derivation looks *through* the composite: the tags are the union of
// the components' own tags, never renamespaced under
// `CourseId`/`InvoiceId` – and because both compose in the very same
// `TenantTag`, their events end up sharing that one tag.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank();

  addDefinition('custom-type-definition', id, 'TenantTag', { schema: { type: 'string' }, isTag: true });
  addDefinition('custom-type-definition', id, 'CourseNumber', { schema: { type: 'string' }, isTag: true });
  addDefinition('custom-type-definition', id, 'InvoiceSeriesId', { schema: { type: 'string' }, isTag: true });
  addDefinition('custom-type-definition', id, 'CourseId', {
    properties: [
      { name: 'tenant', propertyType: 'TenantTag' },
      { name: 'number', propertyType: 'CourseNumber' },
    ],
  });
  addDefinition('custom-type-definition', id, 'InvoiceId', {
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

  check('two composite identifiers sharing a tag-type component share its tag', () => {
    const courseTags = tagsOfEvent(model(), 'CourseDefined', { courseId: { tenant: 't1', number: 'c1' } });
    const invoiceTags = tagsOfEvent(model(), 'InvoiceRaised', { invoiceId: { tenant: 't1', series: 'i1' } });
    eq(courseTags.includes('TenantTag:t1'), true, 'course carries the shared tag');
    eq(invoiceTags.includes('TenantTag:t1'), true, 'invoice carries the same shared tag');
    eq(invoiceTags, ['TenantTag:t1', 'InvoiceSeriesId:i1'], 'invoice tags, its own component included');
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
// 16. Renaming a tag type, and what an emission may copy.
// ---------------------------------------------------------------
{
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
    tags: [{ name: 'regionCode', tagType: 'RegionCode' }],
    valueType: 'integer',
    isList: false,
    script: { initialState: 0 },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });
  addDefinition('projection-definition', id, 'OpenRegionTotal', {
    tags: [],
    valueType: 'integer',
    isList: false,
    script: { initialState: 0 },
    handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }],
  });

  check('a read\'s tag resolves through a non-default tagSchema', () => {
    const log = [];
    drive(model(), log, 'OpenRegion', { regionCode: 'eu' });
    drive(model(), log, 'OpenRegion', { regionCode: 'us' });
    const eu = { tags: { regionCode: 'eu' } };
    eq(sandbox.projectionQueryTags(model(), 'OpenRegionCount', eu), ['RegionCode=eu'], 'rendered through "="');
    eq(foldProjection(model(), log, 'OpenRegionCount', eu), 1,
      'matched through RegionCode\'s "=" tagSchema, not a hardcoded "RegionCode:eu"');
    eq(foldProjection(model(), log, 'OpenRegionCount', { tags: { regionCode: 'us' } }), 1,
      'us counted separately');
    eq(foldProjection(model(), log, 'OpenRegionTotal', {}), 2, 'and untagged, every region');
  });
}

// ---------------------------------------------------------------
// Sharing: export to the schema shape, and the import synthesizer that
// rebuilds a model from it.
// ---------------------------------------------------------------
{
  // Dynamic Product Price (simple): `Item`, a composite custom type,
  // names `ProductId`, a tag type declared before it.
  const original = build(PRICING);
  const envelope = buildShareEnvelope(original, []);
  const { modelId: importedId } = importModelFromEnvelope(envelope);
  const imported = sandbox.projectState()[importedId];

  check('a model with a composite type naming a tag type round-trips', () => {
    eq(definitionsToSchema(imported), definitionsToSchema(original), 'the reconstructed model');
  });

  check('the imported model is independently valid – its own commands still run', () => {
    const log = [];
    drive(imported, log, 'DefineProduct', { productId: 'p1', price: 500 });
    eq(foldProjection(imported, log, 'ProductCurrentPrice', { tags: { productId: 'p1' } }), 500,
      'the price DefineProduct set');
  });
}

{
  // A scripted projection inside a group goes out and comes back inside
  // it, and still folds through the group's tag.
  const original = openScripted().model();
  const { modelId: importedId } = importModelFromEnvelope(buildShareEnvelope(original, []));
  const imported = sandbox.projectState()[importedId];

  check('a model with a scripted grouped projection round-trips', () => {
    eq(definitionsToSchema(imported), definitionsToSchema(original), 'the reconstructed model');
  });

  check('the imported scripted grouped projection still folds', () => {
    const log = [];
    drive(imported, log, 'Tick', { counterId: 'x1' });
    eq(foldMember(imported, log, 'Counter', 'total', 'x1'), 1, 'one tick folded');
  });
}

{
  // Opening a link twice finds the model the first opening made – which
  // only works if an imported model shares exactly what it was imported
  // from, for every shipped model.
  const envelopes = [0, 1, 2, 3, 4].map((index) => buildShareEnvelope(build(index), []));
  envelopes.push(buildShareEnvelope(build(GROUPED), []));
  const imported = envelopes.map((envelope) => importModelFromEnvelope(envelope).modelId);

  check('an imported model is found again by the envelope it came from', () => {
    envelopes.forEach((envelope, i) => {
      const shared = JSON.parse(JSON.stringify(envelope));
      eq(JSON.stringify(buildShareEnvelope(sandbox.projectState()[imported[i]], [])), JSON.stringify(shared), `model ${i} exports what it imported`);
      eq(modelMatchingEnvelope(shared) !== null, true, `model ${i} is matched`);
    });
  });

  check('an edited copy, or a link carrying a sandbox session, is not matched', () => {
    const edited = JSON.parse(JSON.stringify(envelopes[PRICING]));
    edited.name += ' (edited)';
    eq(modelMatchingEnvelope(edited), null, 'a renamed envelope');
    const withSteps = { ...JSON.parse(JSON.stringify(envelopes[PRICING])), sandbox: { steps: [{ command: 'DefineProduct', args: {} }] } };
    eq(modelMatchingEnvelope(withSteps), null, 'an envelope with sandbox steps');
  });
}

{
  const plain = build(PRICING);
  const scripted = openScripted().model(); // a scripted grouped projection

  check('envelopeHasScript is false for a model with no scripts', () => {
    eq(envelopeHasScript(buildShareEnvelope(plain, [])), false, 'plain model');
  });
  check('envelopeHasScript is true for a scripted grouped projection', () => {
    eq(envelopeHasScript(buildShareEnvelope(scripted, [])), true, 'scripted model');
    eq(envelopeScripts(buildShareEnvelope(scripted, [])).map((s) => s.projection), ['Counter.total'],
      'named qualified');
  });

  // And a top-level scripted projection, with a small ad-hoc model.
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
  check('envelopeScripts lists the code the gate asks about, and nothing else', () => {
    eq(envelopeScripts(buildShareEnvelope(model(), [])),
      [{ projection: 'OpenRegionCount', handlers: [{ event: 'RegionOpened', code: '(state || 0) + 1' }] }],
      'the one scripted projection, with its handler');
    eq(envelopeScripts(buildShareEnvelope(plain, [])), [], 'nothing for a plain model');
  });
}

{
  // The gate asks about `script`, so `script` alone decides whether
  // code runs. A `code` slipped onto a declared handler – by a crafted
  // link, an agent's edit or a JSON body in the code view – is inert:
  // the gate rightly lets the envelope through, the declared operation
  // is what folds, and the validator says the code is there.
  const envelope = JSON.parse(JSON.stringify(buildShareEnvelope(build(SEQUENCE), [])));
  const numbering = envelope.projectionDefinitions.find((p) => p.name === 'CourseNumbering');
  numbering.handlers[0].code = '(globalThis.__declaredCodeRan = true, "x9")';

  check('code on a declared handler does not pass for a script', () => {
    eq(envelopeHasScript(envelope), false, 'no script, so no question at import');
    const id = importModelFromEnvelope(envelope).modelId;
    const model = sandbox.projectState()[id];
    eq(model['projection-definitions'].CourseNumbering.handlers[0].code !== undefined, true, 'stored as authored');
    const log = [];
    drive(model, log, 'DefineCourse', { capacity: 10 });
    eq(foldProjection(model, log, 'CourseNumbering', {}), 'c2', 'the declared successor folds');
    eq(sandbox.__declaredCodeRan, undefined, 'the code never ran');
    eq(sandbox.modelAdvisories(model).some(
      (a) => a.name === 'CourseNumbering' && /also carries code/.test(a.message)
    ), true, 'and it is advised');
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
  const envelope = buildShareEnvelope(build(SIMPLE), []);

  check('a structurally-broken definition is skipped; the rest of the file loads', () => {
    const bad = deepClone(envelope);
    bad.eventDefinitions.push({ name: 'Broken', properties: 42 });
    const { modelId, skipped } = importModelFromEnvelope(bad);
    eq(skipped.length, 1, 'exactly the one that is not a definition at all');
    eq(skipped[0].kind, 'event-definition', 'named by kind');
    eq(skipped[0].name, 'Broken', 'and by name');
    eq(/must be a list/.test(skipped[0].reason), true, 'with the structural reason');
    const imported = sandbox.projectState()[modelId];
    eq('CourseDefined' in imported['event-definitions'], true, 'the sound one loaded');
    eq('Broken' in imported['event-definitions'], false, 'the broken one did not');
  });
}

// ---------------------------------------------------------------
// `equalsAny` – membership over a literal list. One scalar against
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

  check('an empty list holds for nothing – negated, for everything', () => {
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
// resolves to, and renaming that member rewrites the entries – the same
// promises the single-value comparison already keeps.
{
  const { id, model } = open_(GROUPED);
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
// minor is read rather than refused – the one rung that lets the format
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
    eq(good.$schema, 'https://dcb.events/schemas/model/v11.json', '$schema');
    eq(/^11\.\d+$/.test(good.dcbModelVersion), true, 'dcbModelVersion is an 11.x');
  });

  check('the definition arrays sit at the top level, under no wrapper', () => {
    eq(good.context, undefined, 'no `context` wrapper');
    eq(good.model, undefined, 'no `model` wrapper either');
    eq(Array.isArray(good.eventDefinitions), true, 'eventDefinitions is a top-level list');
    eq(Array.isArray(good.commandDefinitions), true, 'commandDefinitions is a top-level list');
  });

  check('an import missing a required definition kind is refused', () => {
    refuses({ ...good, eventDefinitions: undefined }, 'no eventDefinitions');
    refuses({ ...good, groupDefinitions: undefined }, 'no groupDefinitions');
    const legacy = { ...good, dcbModelVersion: '10.0', groupDefinitions: undefined };
    refuses(legacy, 'a 10.x document without entityDefinitions');
    eq(typeof importModelFromEnvelope({ ...legacy, entityDefinitions: [] }).modelId, 'string',
      'and with them, it reads');
    refuses({ ...good, commandDefinitions: 'nope' }, 'commandDefinitions not a list');
  });

  check('an import without either marker is refused', () => {
    refuses({ ...good, $schema: undefined }, 'no $schema');
    refuses({ ...good, dcbModelVersion: undefined }, 'no dcbModelVersion');
    refuses({ ...good, dcbModelVersion: 'v1' }, 'an unparseable version');
  });

  check('an import from an unknown major is refused', () => {
    refuses({ ...good, dcbModelVersion: '12.0' }, 'a newer major');
    // 7.x tagged events by property type; read here, it would carry none.
    refuses({ ...good, dcbModelVersion: '7.0' }, 'the last major with implied tags');
    // 6.x has no rejection messages, and none can be invented for it.
    refuses({ ...good, dcbModelVersion: '6.1' }, 'the last major before messages');
    // 2.x is where a projection scenario read several projections under
    // aliases – readable as JSON, and misread as a model.
    refuses({ ...good, dcbModelVersion: '2.0' }, 'the last unreadable major');
    refuses({ ...good, dcbModelVersion: '1.0' }, 'and the one before that');
  });

  // 9.0 added computing derived projections and changed nothing an 8.x
  // document says; 10.0 moved a script's arguments, which an import
  // lifts; 11.0 replaced entities, which an import lifts into groups.
  // So 8.x to 10.x read whole – and with nothing to warn about.
  check('an 8.x, 9.x and 10.x import still read', () => {
    for (const major of [8, 9, 10]) {
      const older = { ...good, $schema: `https://dcb.events/schemas/model/v${major}.json`, dcbModelVersion: `${major}.0`,
        groupDefinitions: undefined, entityDefinitions: [] };
      eq(typeof importModelFromEnvelope(older).modelId, 'string', `${major}.x imported`);
      eq(envelopeVersionWarning(older), '', `${major}.x: nothing dropped`);
    }
  });

  check('$schema is required but never read, so a repointed one still imports', () => {
    const local = { ...good, $schema: './dcb-model.schema.json' };
    eq(typeof importModelFromEnvelope(local).modelId, 'string', 'imported anyway');
  });

  check('a newer minor imports, and says what it is dropping', () => {
    const newer = { ...good, dcbModelVersion: '11.99' };
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
// A grouped projection is an ordinary projection that its group owns:
// read through a group alias, in place by its qualified name, or bound
// by it, it is the same fold – and what is true of a top-level one is
// true of it.
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

  check('a member read and a read in place of the same projection agree', () => {
    const model = build(GROUPED);
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 7 });
    eq(foldMember(model, log, 'Course', 'capacity', 'c1'), 7, 'by the group\'s tag');
    const body = deepClone(model['command-definitions'].ChangeCourseCapacity);
    body.conditions = [{ leftHandSide: { projection: 'Course.capacity', tags: { courseId: { parameterName: 'courseId' } } },
      predicate: 'equals', rightHandSide: 7, rejection: 'Not seven' }];
    body.boundary = [];
    model['command-definitions'].ChangeCourseCapacity = body;
    eq(evaluateCommand(model, log, 'ChangeCourseCapacity', { courseId: 'c1', newCapacity: 3 }).outcome,
      'published', 'Course(courseId).capacity, in place');
  });

  check('deleting a grouped projection leaves its reads advisory-flagged, not refused', () => {
    const { id, model } = open_(GROUPED);
    removeDefinition('projection-definition', id, 'Course.capacity');
    eq(model()['group-definitions'].Course.projections.some((p) => p.name === 'capacity'), false, 'removed');
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'SubscribeStudentToCourse' && /Course has no projection "capacity"/.test(a.message)
    ), true, 'the command reports its dangling read');
  });

  check('renaming a grouped projection moves every read of it', () => {
    const { id, model } = open_(GROUPED);
    renameDefinition('projection-definition', id, 'Course.capacity', 'seats');
    const rule = model()['command-definitions'].SubscribeStudentToCourse.conditions
      .find((c) => c.rejection === 'Course is full');
    eq(rule.rightHandSide, { alias: 'course', property: 'seats' }, 'the member read followed');
    const log = [];
    drive(model(), log, 'DefineCourse', { courseId: 'c1', capacity: 4 });
    eq(foldMember(model(), log, 'Course', 'seats', 'c1'), 4, 'still folds');
    eq(sandbox.modelAdvisories(model()), [], 'and nothing dangles');
  });

  advises('Course', /Course\.capacity declares tags of its own/,
    'a grouped projection declaring tags of its own saves, with an advisory', () => {
      const { id, model } = open_(GROUPED);
      const group = deepClone(model()['group-definitions'].Course);
      group.projections.find((p) => p.name === 'capacity').tags = [{ name: 'studentId', tagType: 'StudentId' }];
      updateDefinition('group-definition', id, 'Course', group);
      return model;
    });

  advises('CourseCapacity', /is tagged by StudentId, but "CourseDefined", which it handles, is tagged by no StudentId/,
    'a projection tagged by what its events do not carry saves, with an advisory', () => {
      const { id, model } = open_(SIMPLE);
      const body = {
        ...deepClone(model()['projection-definitions'].CourseCapacity),
        tags: [{ name: 'studentId', tagType: 'StudentId' }],
      };
      updateDefinition('projection-definition', id, 'CourseCapacity', body);
      return model;
    });

  check('a scripted grouped projection is scoped by the instance', () => {
    const { model } = openScripted();
    const log = [
      { type: 'Ticked', data: { counterId: 'x1' } },
      { type: 'Ticked', data: { counterId: 'x2' } },
      { type: 'Ticked', data: { counterId: 'x1' } },
    ];
    eq(foldMember(model(), log, 'Counter', 'total', 'x1'), 2, 'x1 counted its own');
    eq(foldMember(model(), log, 'Counter', 'total', 'x2'), 1, 'x2 counted its own');
  });

  check('a scripted projection may hold a record, and a condition reads it whole', () => {
    const { id, model } = openScripted();
    addDefinition('custom-type-definition', id, 'CounterStats', {
      properties: [
        { name: 'count', propertyType: 'integer' },
        { name: 'odd', propertyType: 'boolean' },
      ],
    });
    addDefinition('projection-definition', id, 'Counter.stats', {
      valueType: 'CounterStats', isList: false,
      script: { initialState: null },
      handlers: [{
        event: 'Ticked',
        code: '{ count: ((state && state.count) || 0) + 1, odd: !(state && state.odd) }',
      }],
    });
    addDefinition('command-definition', id, 'TickAtStats', {
      properties: [
        { name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false },
        { name: 'expected', propertyType: 'CounterStats', isOptional: false, isList: false },
      ],
      boundary: [{ alias: 'counter', group: 'Counter', tags: { counterId: { parameterName: 'counterId' } } }],
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
    eq(foldMember(model(), log, 'Counter', 'stats', 'x1'),
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
      tags: [{ name: 'counterId', tagType: 'CounterId' }],
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
    eq(foldProjection(model(), log, 'CounterAudit', { tags: { counterId: 'x1' } }),
      2, 'a reader sees the exposed field');
    eq(foldProjectionState(model(), log, 'CounterAudit', { tags: { counterId: 'x1' } }),
      { total: 2, last: 'x1' }, 'the state fold keeps the bookkeeping');
    eq(foldProjectionState(model(), [], 'CounterAudit', { tags: { counterId: 'x1' } }),
      { total: 0, last: null }, 'before anything happens, it is the initial state');
    eq(foldProjectionState(model(), log, 'Counter.total', { tags: { counterId: 'x1' } }),
      foldProjection(model(), log, 'Counter.total', { tags: { counterId: 'x1' } }),
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
      tags: [{ name: 'counterId', tagType: 'CounterId' }],
      arguments: [{ name: 'prefix', propertyType: 'string' }],
      valueType: 'string', isList: false,
      script: { initialState: '' },
      handlers: [{ event: 'Ticked', code: 'args.prefix + tags.counterId' }],
    });
    const log = [{ type: 'Ticked', data: { counterId: 'x1' } }];
    eq(foldProjection(model(), log, 'TicksSeen', { tags: { counterId: 'x1' }, args: { prefix: '#' } }),
      '#x1', 'tags.counterId – by its name – and args.prefix');
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
    tags: [], isList: false, handlers: [], ...body,
  });
  // A mistyped initial value saves and comes back as an advisory on
  // the projection – this returns that advisory's message, or null
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

  check('a list of members starts as plain members, the way a handler builds one', () => {
    // Unwrapped at the top only, `[{enumMember}]` never equalled the
    // `['Red']` a handler produces, and a rule comparing them refused.
    add('Palette', { valueType: 'Colour', isList: true, initialValue: [{ enumMember: 'Red' }] });
    eq(foldProjection(model(), [], 'Palette', {}), ['Red'], 'unwrapped inside the list');
    eq(sandbox.evDeepEqual([{ enumMember: 'Red' }], ['Red']), true, 'and equal to the built one');
  });

  check('a projection nothing moves yet is legal and reads as where it starts', () => {
    add('Untouched', { valueType: 'integer', initialValue: 41, handlers: [] });
    eq(foldProjection(model(), [{ type: 'Nudged', data: {} }], 'Untouched', {}), 41, 'nothing moved it');
  });

  check('an integer projection is offered increment and decrement', () => {
    // The operations a projection may use come from its own declared
    // type, wherever it lives.
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
// scenarios sharing that Given – each answerable, each drifting alone.
// ---------------------------------------------------------------
{
  const store_ = (id, model, body) => {
    const complete = { ...body, then: deriveProjectionScenarioThen(model, body) };
    const key = generateId();
    addDefinition('projection-scenario-definition', id, key, complete);
    return key;
  };

  check('a scenario over a global numbering derives what it issues next', () => {
    const { id, model } = open_(SEQUENCE);
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
    const { id, model } = open_(TENANT);
    const given = [
      { event: 'TenantRegistered', data: { tenantId: 't1' } },
      { event: 'CourseDefined', data: { tenantId: 't1', courseId: 'c1', capacity: 1, courseNumber: '1' } },
      { event: 'CourseDefined', data: { tenantId: 't2', courseId: 'c2', capacity: 1, courseNumber: '1' } },
    ];
    // Three scenarios rather than three reads: the same Given, asked
    // three questions, each of which can drift without the others.
    const at = (tenantId) => {
      const key = store_(id, model(), {
        projection: 'TenantCourseNumbering', tags: { tenantId: { tagType: 'TenantId', tagValue: tenantId } }, given,
      });
      // Read the model *after* the write: a member expression evaluates
      // its object before its key, so indexing model() inline would
      // look in the snapshot taken before this scenario was added.
      return model()['projection-scenario-definitions'][key].then;
    };
    eq([at('t1'), at('t2'), at('t3')], ['2', '2', '1'], 'each tenant counted on its own');
  });

  check('a grouped projection and a top-level one are asserted the same way', () => {
    const { id, model } = open_(SEQUENCE);
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    sandbox.moveProjectionIntoGroup(id, 'CourseCapacity', 'Course');
    const given = [{ event: 'CourseDefined', data: { courseId: 'c1', capacity: 9 } }];
    const capacity = store_(id, model(), {
      projection: 'Course.capacity', tags: { courseId: { tagType: 'CourseId', tagValue: 'c1' } }, given,
    });
    const numbering = store_(id, model(), {
      projection: 'CourseNumbering', given,
    });
    eq(model()['projection-scenario-definitions'][capacity].then, 9, 'the grouped one, by its qualified name');
    eq(model()['projection-scenario-definitions'][numbering].then, 'c2',
      'and the standalone one, in the same shape');
  });

  check('a value a projection really holds is not mistaken for an absent Then', () => {
    const { id, model } = open_(SEQUENCE);
    // `null`, `0` and `[]` are answers. A Then read by truthiness would
    // call all three "not run yet".
    const key = store_(id, model(), {
      projection: 'CourseSubscribedStudentIds', tags: { courseId: { tagType: 'CourseId', tagValue: 'c1' } }, given: [],
    });
    const stored = model()['projection-scenario-definitions'][key];
    eq(stored.then, [], 'an empty list is what it folds to');
    eq(runProjectionScenario(model(), stored).status, 'current', 'and it runs current, not broken');
  });

  check('changing what a projection does is reported as drift', () => {
    const { id, model } = open_(SEQUENCE);
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
    const { id, model } = open_(SEQUENCE);
    const key = store_(id, model(), {
      projection: 'CourseNumbering', given: [],
    });
    // Only the scenario and the command read it; drop the command first,
    // and the scenario must not be what refuses.
    const define = deepClone(model()['command-definitions'].DefineCourse);
    define.properties = [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
      { name: 'capacity', propertyType: 'integer', isOptional: false, isList: false }];
    // Supplying the id instead of minting it – which is what makes the
    // numbering unreferenced, and the point of the check.
    define.boundary = [];
    define.publishes[0].parameters.courseId = { parameterName: 'courseId' };
    updateDefinition('command-definition', id, 'DefineCourse', define);
    removeDefinition('projection-definition', id, 'CourseNumbering');
    eq('CourseNumbering' in model()['projection-definitions'], false, 'gone');
    eq(runProjectionScenario(model(), model()['projection-scenario-definitions'][key]).status,
      'broken', 'and the scenario says so rather than passing');
  });

  check('renaming a projection carries every scenario about it', () => {
    const { id, model } = open_(SEQUENCE);
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
    const { id, model } = open_(SEQUENCE);
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
    const { id, model } = open_(TENANT);
    const stored = (body) => {
      const key = generateId();
      addDefinition('projection-scenario-definition', id, key, { given: [], then: null, ...body });
      return model()['projection-scenario-definitions'][key];
    };
    eq(runProjectionScenario(model(), stored({
      projection: 'TenantCourseNumbering', tags: { tenantId: { tagType: 'TenantId', tagValue: null } },
    })).status, 'broken', 'read tagged by no value');
    eq(runProjectionScenario(model(), stored({ projection: 'NoSuchThing' })).status,
      'broken', 'a projection this model does not define');
    // An extra argument is inert – the fold never reads it – so that
    // scenario stores as written and is judged only on its Then.
    stored({ projection: 'CourseNumbering', arguments: { tenantId: 't1' } });
  });

  check('safe mode compiles a script to a thrower and leaves declared folds alone', () => {
    // The model as a plain object: `build(SEQUENCE)` below resets the store,
    // but the fold only ever reads the object it is handed.
    const scripted = openScripted().model();
    const log = [{ type: 'Ticked', data: { counterId: 'x1' } }];
    eq(foldMember(scripted, log, 'Counter', 'total', 'x1'), 1, 'runs when scripts are on');
    setScriptsDisabled(true);
    try {
      let failure = null;
      try {
        foldMember(scripted, log, 'Counter', 'total', 'x1');
      } catch (error) {
        failure = error;
      }
      eq((failure || {}).name, 'EvaluationError', 'an evaluation error, not a crash');
      eq(/safe mode/.test((failure || {}).message), true, 'which says why');
      eq(foldProjection(build(SEQUENCE), [], 'CourseNumbering', {}), 'c1', 'a declared fold is untouched');
    } finally {
      setScriptsDisabled(false);
    }
    eq(foldMember(scripted, log, 'Counter', 'total', 'x1'), 1, 'and back on afterwards');
  });

  check('a scenario over a scripted projection is read by its tags', () => {
    const { id, model } = openScripted();
    const given = [
      { event: 'Ticked', data: { counterId: 'x1' } },
      { event: 'Ticked', data: { counterId: 'x2' } },
      { event: 'Ticked', data: { counterId: 'x1' } },
    ];
    const at = (counterId) => {
      const key = store_(id, model(), {
        projection: 'Counter.total', tags: { counterId: { tagType: 'CounterId', tagValue: counterId } }, given,
      });
      return model()['projection-scenario-definitions'][key].then;
    };
    eq([at('x1'), at('x2')], [2, 1], 'each counter counted its own');
  });

  check('a projection scenario round-trips through an export', () => {
    const { id, model } = open_(SEQUENCE);
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
// A fan chained off another fan (`Course(each student.courses)`)
// inherits its list: a parameter zipped with it pairs each course with
// the element its *student* came from – not with the course's own
// position in the flattened list, which runs past the list as soon as
// a student holds more than one course.
// ---------------------------------------------------------------
{
  const { id, model } = openBlank('Chained fan');
  sandbox.createGroup(id, 'Student', { name: 'studentId', tagType: 'StudentId' });
  sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
  addDefinition('custom-type-definition', id, 'Requirement', {
    properties: [{ name: 'studentId', propertyType: 'StudentId' }, { name: 'minimum', propertyType: 'integer' }],
  });
  const prop = (name, propertyType, isList = false) => ({ name, propertyType, isOptional: false, isList });
  addTaggedEvent(id, 'Enrolled', { properties: [prop('studentId', 'StudentId'), prop('courseId', 'CourseId')] });
  addTaggedEvent(id, 'CapacitySet', { properties: [prop('courseId', 'CourseId'), prop('capacity', 'integer')] });
  addTaggedEvent(id, 'Checked', { properties: [prop('requirements', 'Requirement', true)] });
  addDefinition('projection-definition', id, 'Student.courses', {
    valueType: 'CourseId', isList: true, initialValue: [],
    handlers: [{ event: 'Enrolled', operation: 'append', value: { eventProperty: 'courseId' } }],
  });
  addDefinition('projection-definition', id, 'Course.capacity', {
    valueType: 'integer', isList: false, initialValue: 0,
    handlers: [{ event: 'CapacitySet', operation: 'set', value: { eventProperty: 'capacity' } }],
  });
  addDefinition('command-definition', id, 'Check', {
    properties: [prop('requirements', 'Requirement', true)],
    boundary: [
      { alias: 'student', group: 'Student', tags: { studentId: { each: { parameterName: 'requirements', property: 'studentId' } } } },
      { alias: 'course', group: 'Course', tags: { courseId: { each: { alias: 'student', property: 'courses' } } } },
    ],
    conditions: [{
      leftHandSide: { alias: 'course', property: 'capacity' }, predicate: 'greaterThanOrEquals',
      rightHandSide: { parameterName: 'requirements', property: 'minimum' }, rejection: 'A course is too small.',
    }],
    publishes: [{ name: 'Checked', parameters: { requirements: { parameterName: 'requirements' } } }],
  });
  const log = [
    { type: 'Enrolled', data: { studentId: 's1', courseId: 'cA' } },
    { type: 'Enrolled', data: { studentId: 's1', courseId: 'cB' } },
    { type: 'Enrolled', data: { studentId: 's3', courseId: 'cA' } },
    { type: 'CapacitySet', data: { courseId: 'cA', capacity: 10 } },
    { type: 'CapacitySet', data: { courseId: 'cB', capacity: 3 } },
  ];

  check('a chained fan pairs a zipped parameter by the element it came from', () => {
    eq(sandbox.isZipped(model(), model()['command-definitions'].Check, model()['command-definitions'].Check.conditions[0],
      { parameterName: 'requirements', property: 'minimum' }), true, 'the minimum is zipped with the courses');
    // s1's courses are cA (10) and cB (3) and s1 asks for 5; s2 holds none.
    const result = evaluateCommand(model(), log, 'Check', {
      requirements: [{ studentId: 's1', minimum: 5 }, { studentId: 's2', minimum: 1 }],
    });
    eq(result.outcome, 'rejected', 'cB is checked against s1\'s minimum, not s2\'s');
    eq(result.failedRule.atInstance, 1, 'the second course bound, cB');
    const fine = evaluateCommand(model(), log, 'Check', {
      requirements: [{ studentId: 's2', minimum: 100 }, { studentId: 's3', minimum: 5 }],
    });
    eq(fine.outcome, 'published', 's3\'s one course, cA (10), meets s3\'s 5 – s2 holds none');
    eq(fine.reads.course.instances.map((i) => i.id), ['cA'], 'a group fanned off a group, one instance per course');
    eq(sandbox.modelAdvisories(model()), [], 'and the model is clean');
  });
}

// ---------------------------------------------------------------
// The event store: an unreadable log is moved aside, never sat on
// where the next append would overwrite the only copy.
// ---------------------------------------------------------------
{
  open_(GROUPED);
  const logKey = [...store.keys()].find((k) => /:events:v\d+$/.test(k));

  check('a corrupt log is moved aside rather than erased on the next append', () => {
    store.set(logKey, '{not json');
    // A write from outside `appendEvents` – another tab, a hand in
    // devtools – is only seen once the revision moves, which is what
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
// move. Walked over every reference in every shipped model – a
// reference site visible to one direction and not the other leaves a
// dangling name here.
// ---------------------------------------------------------------
{
  const KINDS = [
    'group-definition', 'event-definition', 'projection-definition', 'command-definition',
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

  for (const i of [0, 1, 2, 3, 4, GROUPED]) {
    check(`shipped model ${i}: every computed reference survives renaming its target`, () => {
      const { id, model } = open_(i);
      eq(dangling(model()), [], 'baseline has no dangling references');
      // Every (kind, name) anything references – renamed one by one.
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
        if (!(target.name in model()[collOf(target.kind)])) continue;
        renameDefinition(target.kind, id, target.name, target.name + 'X');
      }
      eq(dangling(model()), [], 'no reference was left behind');
      eq(sandbox.modelAdvisories(model()).filter((a) => /does not define|has no projection/.test(a.message)), [],
        'and no read lost what it reads');
    });
  }
}

// ---------------------------------------------------------------
// Validation: identifier operands are judged by structure, not by
// their rendered text – a literal may contain '?' and still be a
// value, while an operand missing its name is a gap however it prints.
// ---------------------------------------------------------------
{
  const { id, model } = open_(GROUPED);

  check('a literal tag containing "?" is a value, not a gap', () => {
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary[0].tags.courseId = { tagType: 'CourseId', tagValue: 'what?' };
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    eq(model()['command-definitions'].ChangeCourseCapacity.boundary[0].tags.courseId.tagValue, 'what?', 'stored');
    eq(sandbox.modelAdvisories(model()).filter((a) => a.name === 'ChangeCourseCapacity'), [], 'and no gap advised');
  });

  check('a tag operand missing its name saves, and the advisory names the gap', () => {
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary[0].tags.courseId = { parameterName: '' };
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    eq(sandbox.modelAdvisories(model()).some(
      (a) => a.name === 'ChangeCourseCapacity' && /with no value for its "courseId" tag/.test(a.message)
    ), true, 'the incomplete operand is reported');
  });
}

// ---------------------------------------------------------------
// Optional properties. `null` is the one spelling of "no value": an
// unset optional command property reaches everything as null, an
// unmapped optional event property publishes the explicit null, and
// the empty string stays a value of its own. Where a null would
// become a tag – a binding's identifier, an exclusion, a partition –
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

  sandbox.createGroup(id, 'Anordnung', { name: 'anordnungId', tagType: 'AnordnungId' });
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
    // tests its state – a read would widen the append condition and
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
    eq(sandbox.modelAdvisories(model()).filter((a) => a.kind !== 'group-definition').length, 0,
      'nothing here is a hazard');
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

  // A projection reading the optional property, in a group – the fold
  // sees the same null whether the Given spelled it out or left the key
  // off.
  addDefinition('projection-definition', id, 'Anordnung.notiz', {
    valueType: 'string', isList: false,
    initialValue: null,
    handlers: [{ event: 'AnordnungErzeugt', operation: 'set', value: { eventProperty: 'notiz' } }],
  });

  check('the fold reads an omitted optional event property as null', () => {
    const log = [{ type: 'AnordnungErzeugt', data: { anordnungId: 'a1' } }];
    eq(foldMember(model(), log, 'Anordnung', 'notiz', 'a1'), null, 'null, not undefined');
    eq(foldMember(model(), [
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
    sandbox.createGroup(id, 'Festlegung', { name: 'festlegungId', tagType: 'FestlegungId' });
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
      boundary: [{ alias: 'festlegung', group: 'Festlegung', tags: { festlegungId: { parameterName: 'festlegungId' } } }],
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
  // global – walked by index until the loader runs out instead.
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
// reassignment shape – one command moving two instructors' partitions
// in opposite directions – is expressed by *splitting the event*: an
// Assigned and an Unassigned each carry one instructor tag, so one
// plain handler per event type is enough; an event that names two
// instances of one type is the ambiguity the advisory points out.
// ---------------------------------------------------------------
{
  function openAssignment() {
    const { id, model } = openBlank('Assignment');
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    sandbox.createGroup(id, 'Instructor', { name: 'instructorId', tagType: 'InstructorId' });
    addTaggedEvent(id, 'Assigned', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: false, isList: false },
      ],
    });
    // The predecessor's own fact. Its identifier is optional: a first
    // assignment replaces nobody, and a null identifier carries no tag,
    // so that event reaches no partition at all – a recorded no-op.
    addTaggedEvent(id, 'Unassigned', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: true, isList: false },
      ],
    });
    addDefinition('projection-definition', id, 'Course.instructorId', {
      valueType: 'InstructorId', isList: false, initialValue: null,
      handlers: [{ event: 'Assigned', operation: 'set', value: { eventProperty: 'instructorId' } }],
    });
    addDefinition('projection-definition', id, 'Instructor.instructedCourses', {
      valueType: 'CourseId', isList: true, initialValue: [],
      handlers: [
        { event: 'Assigned', operation: 'append', value: { eventProperty: 'courseId' } },
        { event: 'Unassigned', operation: 'remove', value: { eventProperty: 'courseId' } },
      ],
    });
    addDefinition('command-definition', id, 'Assign', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: false, isList: false },
      ],
      // The new instructor is asserted by the caller and tested by
      // nothing, so it is not read. The *previous* one is read, because
      // the rule is about it – and because the `Unassigned` tag is
      // derived from `course.instructorId`, which is a claim about
      // state this command looked at.
      boundary: [
        { alias: 'course', group: 'Course', tags: { courseId: { parameterName: 'courseId' } } },
        { alias: 'previousInstructor', group: 'Instructor',
          tags: { instructorId: { alias: 'course', property: 'instructorId' } }, isOptional: true },
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
    eq(foldMember(model(), log, 'Instructor', 'instructedCourses', 'i2'), ['c1'],
      'the new instructor gains the course');
    eq(foldMember(model(), log, 'Instructor', 'instructedCourses', 'i1'), [],
      'the previous instructor loses it');
  });

  check('an Unassigned with a null identifier carries no tag and reaches nobody', () => {
    const { model } = openAssignment();
    const log = [assigned('c1', 'i1'), unassigned('c1', null)];
    eq(foldMember(model(), log, 'Instructor', 'instructedCourses', 'i1'), ['c1'],
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

  check('an inline read tagged by an optional binding is advised: absent, it is an error', () => {
    const { id, model } = openAssignment();
    // An instructor's mentor, another instructor – a value read off the
    // optional binding, and the tag of a read.
    addDefinition('projection-definition', id, 'Instructor.mentorId', {
      valueType: 'InstructorId', isList: false, initialValue: null, handlers: [],
    });
    const body = deepClone(model()['command-definitions'].Assign);
    body.conditions.push({
      leftHandSide: { projection: 'Instructor.instructedCourses',
        tags: { instructorId: { alias: 'previousInstructor', property: 'mentorId' } } },
      predicate: 'isNotEmpty', rejection: 'The previous instructor teaches nothing',
    });
    updateDefinition('command-definition', id, 'Assign', body);
    const advisories = sandbox.modelAdvisories(model()).filter((a) => a.name === 'Assign');
    const advisory = advisories.find((a) => /may be absent/.test(a.message));
    eq(!!advisory, true, 'advised ahead of time: ' + JSON.stringify(advisories));
    eq(/previousInstructor/.test(advisory.message) && /instructedCourses/.test(advisory.message), true, advisory.message);
    let message = '';
    try { evaluateCommand(model(), [], 'Assign', { courseId: 'c1', instructorId: 'i1' }); } catch (error) { message = error.message; }
    eq(message !== '', true, 'and, absent, the evaluation error it said would come');
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
    // through `course` – nothing was read at all, so the value is
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
    // the one replaced – a handler on it fires for both partitions.
    addTaggedEvent(id, 'Reassigned', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'instructorId', propertyType: 'InstructorId', isOptional: false, isList: false },
        { name: 'previousInstructorId', propertyType: 'InstructorId', isOptional: true, isList: false },
      ],
    });
    const body = deepClone(model()['group-definitions'].Instructor.projections.find((p) => p.name === 'instructedCourses'));
    body.handlers.push({ event: 'Reassigned', operation: 'append', value: { eventProperty: 'courseId' } });
    updateDefinition('projection-definition', id, 'Instructor.instructedCourses', body);
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
// – still a `published` outcome. Exercised against the shipped
// guarded-emissions variant of the content-decisions family, whose
// UpdateText carries the complementary pair.
// ---------------------------------------------------------------
{
  const GUARDED = PREDEFINED_INDEX('content-decisions-guarded');
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

  check('every guard failing publishes nothing – an accepted command, not a rejection', () => {
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

  check('a guard read joins the derived DCB – it may hide nothing from the query', () => {
    const model = build(GUARDED);
    const dcb = sandbox.deriveDcb(model, model['command-definitions'].UpdateText);
    const published = dcb.items.find((item) => item.projection === 'DocumentPublishedText');
    eq(!!published, true, 'the projection only the guards read is a read');
    eq(published.types.includes('DocumentPublished'), true,
      'so its events are in the query');
  });

  check('renaming an enum member rewrites emission guards too', () => {
    const { id, model } = open_(GUARDED);
    const body = deepClone(model()['command-definitions'].PublishDocument);
    body.publishes[0].when = [{
      leftHandSide: { projection: 'DocumentStatus', tags: { documentId: { parameterName: 'docId' } } },
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
// Derived projections (6.0). One predicate over other projections –
// no handlers, no initial value, one boolean – declared once, read by
// command guards, and contributing its
// operands' queries to any boundary that binds it. Exercised against
// the shipped derived variant of the content-decisions family.
// ---------------------------------------------------------------
{
  const DERIVED = PREDEFINED_INDEX('content-decisions-derived');
  const added = { type: 'DocumentAdded', data: { id: 'd1' } };
  const updated = (text) => ({ type: 'TextUpdated', data: { docId: 'd1', text } });
  const published = (text) => ({ type: 'DocumentPublished', data: { docId: 'd1', text } });

  check('a derived projection is its predicate, at every point in the log', () => {
    const model = build(DERIVED);
    const pending = (log) => foldProjection(model, log, 'DocumentHasPendingChanges', { tags: { documentId: 'd1' } });
    eq(pending([]), false, 'null equals null before anything happened');
    eq(pending([added]), true, 'a fresh draft: "" differs from never-published');
    eq(pending([added, updated('a'), published('a')]), false, 'published, nothing since');
    eq(pending([added, updated('a'), published('a'), updated('b'), updated('a')]), false,
      're-typing the published text clears it, with no event saying so');
  });

  check('read in place by a rule, like any projection', () => {
    const model = build(DERIVED);
    eq(foldProjection(model, [added], 'DocumentHasPendingChanges', { tags: { documentId: 'd1' } }), true,
      'read by its tag');
    const refused = evaluateCommand(model, [added, updated('a'), published('a')],
      'PublishDocument', { docId: 'd1' });
    eq(refused.outcome, 'rejected', 'nothing to publish');
    eq(refused.failedRule.text, 'DocumentHasPendingChanges(docId) isTrue', 'refused by the derived read');
    eq(refused.failedRule.leftValue, false, 'and the value it derived is reported');
  });

  check('its query is its operands\' union – the predicate hides nothing', () => {
    const model = build(DERIVED);
    const dcb = sandbox.deriveDcb(model, model['command-definitions'].PublishDocument);
    const derived = dcb.items.filter((item) => item.projection === 'DocumentHasPendingChanges');
    eq(derived.map((item) => item.via).sort(), ['DocumentCurrentText', 'DocumentPublishedText'],
      'one query per projection it folds');
    for (const type of ['TextUpdated', 'DocumentPublished']) {
      eq(derived.some((item) => item.types.includes(type)), true, `${type} reached the query through the derivation`);
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

  check('derived is data, not code – the import gate stays closed', () => {
    const model = build(DERIVED);
    eq(envelopeHasScript(buildShareEnvelope(model, [])), false, 'nothing to confirm');
  });
}

// ---------------------------------------------------------------
// Derived computations (9.0). A derived projection may compute one
// number from two – add, subtract, multiply, min, max – in place of
// comparing. Exercised against the shipped developer-hours model,
// whose remaining hours are the weekly budget less the week's
// allocations: two operands kept per different tags.
// ---------------------------------------------------------------
{
  const HOURS = PREDEFINED_INDEX('developer-hours');
  const registered = { type: 'DeveloperRegistered', data: { developerId: 'd1', seniorityLevel: 3, availableHoursPerWeek: 40 } };
  const allocated = (week, requestedHours) =>
    ({ type: 'HoursAllocated', data: { projectId: 'p1', developerId: 'd1', week, requestedHours } });
  const remaining = (model, log, week) =>
    foldProjection(model, log, 'DeveloperRemainingHoursForWeek', { tags: { developerId: 'd1', week } });

  check('a computation is its operator over its operands, at every point in the log', () => {
    const model = build(HOURS);
    eq(remaining(model, [], 12), 0, 'nothing registered, nothing allocated');
    eq(remaining(model, [registered], 12), 40, 'the whole weekly budget');
    eq(remaining(model, [registered, allocated(12, 30)], 12), 10, 'less that week\'s allocations');
    eq(remaining(model, [registered, allocated(12, 30)], 13), 40, 'another week is untouched');
  });

  check('each operator computes, and a null side yields null', () => {
    const { id, model } = openBlank('Arithmetic');
    addDefinition('custom-type-definition', id, 'AccountId', { schema: { type: 'string' }, isTag: true });
    addTaggedEvent(id, 'Credited', { properties: [
      { name: 'accountId', propertyType: 'AccountId', isOptional: false, isList: false },
      { name: 'amount', propertyType: 'integer', isOptional: false, isList: false },
    ] });
    const tags = [{ name: 'accountId', tagType: 'AccountId' }];
    const own = { accountId: { parameterName: 'accountId' } };
    addDefinition('projection-definition', id, 'Balance', {
      tags, valueType: 'integer', isList: false, initialValue: 0,
      handlers: [{ event: 'Credited', operation: 'increment', value: { eventProperty: 'amount' } }],
    });
    addDefinition('projection-definition', id, 'LastCredit', {
      tags, valueType: 'integer', isList: false, initialValue: null,
      handlers: [{ event: 'Credited', operation: 'set', value: { eventProperty: 'amount' } }],
    });
    const compute = (operator, right) => {
      addDefinition('projection-definition', id, `By${operator}`, {
        tags, valueType: 'integer', isList: false,
        derived: { leftHandSide: { projection: 'Balance', tags: own }, operator, rightHandSide: right },
      });
      return (log) => foldProjection(model(), log, `By${operator}`, { tags: { accountId: 'a1' } });
    };
    const credit = (amount) => ({ type: 'Credited', data: { accountId: 'a1', amount } });
    eq(compute('add', 3)([credit(5)]), 8, 'add');
    eq(compute('subtract', 3)([credit(5)]), 2, 'subtract');
    eq(compute('multiply', 3)([credit(5)]), 15, 'multiply');
    eq(compute('min', 3)([credit(5)]), 3, 'min');
    eq(compute('max', 3)([credit(5)]), 5, 'max');
    const withLast = (log) => {
      addDefinition('projection-definition', id, 'BalanceAndLast', {
        tags, valueType: 'integer', isList: false,
        derived: { leftHandSide: { projection: 'Balance', tags: own }, operator: 'add',
          rightHandSide: { projection: 'LastCredit', tags: own } },
      });
      return foldProjection(model(), log, 'BalanceAndLast', { tags: { accountId: 'a1' } });
    };
    eq(withLast([]), null, 'nothing credited yet: null in, null out');
    const found = sandbox.modelAdvisories(model()).filter((a) => a.name === 'BalanceAndLast').map((a) => a.message).join('; ');
    eq(/can be null/.test(found), true, 'and the advisory said so ahead of time: ' + found);
  });

  check('a rule ordering against a computed null is an error, never a rejection', () => {
    const { id, model } = open_(HOURS);
    const body = deepClone(model()['projection-definitions'].DeveloperAvailableHoursPerWeek);
    body.initialValue = null;
    updateDefinition('projection-definition', id, 'DeveloperAvailableHoursPerWeek', body);
    const command = deepClone(model()['command-definitions'].AllocateHours);
    command.conditions = command.conditions.slice(3);
    updateDefinition('command-definition', id, 'AllocateHours', command);
    let broke = null;
    try {
      evaluateCommand(model(), [], 'AllocateHours', { projectId: 'p1', developerId: 'd1', week: 12, requestedHours: 1 });
    } catch (error) { broke = error; }
    eq(broke && broke.name, 'EvaluationError', 'an ordering needs both sides');
  });

  check('its boundary is each operand\'s query, under that operand\'s own tags', () => {
    const model = build(HOURS);
    const dcb = sandbox.deriveDcb(model, model['command-definitions'].AllocateHours);
    const derived = dcb.items.filter((item) => item.projection === 'DeveloperHasHoursForWeek');
    eq(derived.map((item) => [item.via, item.tags, item.types]), [
      ['DeveloperAvailableHoursPerWeek', ['DeveloperId:{developerId}'], ['DeveloperRegistered']],
      ['DeveloperAllocatedHoursForWeek', ['DeveloperId:{developerId}', 'WeekNumber:{week}'], ['HoursAllocated']],
    ], 'the registration is not tagged by the week, and is still in the boundary');
  });

  check('a derived projection in a group reads its siblings by local name, and others by its tag', () => {
    // `Course.full` compares the course's subscriptions – its sibling,
    // read bare, by the group's tag implied – with a limit kept for all
    // courses, a top-level projection read untagged. Read through the
    // group or bound by its qualified name, it is the same queries: the
    // limit a query of its own, never ANDed with the course's tag.
    const { id, model } = openBlank('Derived in a group');
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    const courseId = { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false };
    addTaggedEvent(id, 'Subscribed', { properties: [courseId] });
    addTaggedEvent(id, 'LimitSet', { properties: [{ name: 'max', propertyType: 'integer', isOptional: false, isList: false }] });
    addDefinition('projection-definition', id, 'Course.subscriptionCount', {
      valueType: 'integer', isList: false, initialValue: 0,
      handlers: [{ event: 'Subscribed', operation: 'increment', value: 1 }],
    });
    addDefinition('projection-definition', id, 'Limit', {
      tags: [], valueType: 'integer', isList: false, initialValue: 10,
      handlers: [{ event: 'LimitSet', operation: 'set', value: { eventProperty: 'max' } }],
    });
    addDefinition('projection-definition', id, 'Course.full', {
      valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'subscriptionCount' }, predicate: 'greaterThanOrEquals',
        rightHandSide: { projection: 'Limit', tags: {} } },
    });
    const subscribe = (boundary, leftHandSide) => ({
      properties: [courseId], boundary,
      conditions: [{ leftHandSide, predicate: 'isFalse', rejection: 'The course is full.' }],
      publishes: [{ name: 'Subscribed', parameters: { courseId: { parameterName: 'courseId' } } }],
    });
    const own = { courseId: { parameterName: 'courseId' } };
    addDefinition('command-definition', id, 'SubscribeThroughGroup',
      subscribe([{ alias: 'course', group: 'Course', tags: own }], { alias: 'course', property: 'full' }));
    addDefinition('command-definition', id, 'SubscribeThroughProjection',
      subscribe([{ alias: 'full', projection: 'Course.full', tags: own }], { alias: 'full' }));
    eq(sandbox.modelAdvisories(model()).filter((a) => a.kind !== 'event-definition'), [], 'advisory-clean');

    const queries = (name) => sandbox.deriveDcb(model(), model()['command-definitions'][name]).items
      .map((item) => JSON.stringify([item.tags, item.types])).sort();
    eq(queries('SubscribeThroughGroup'), queries('SubscribeThroughProjection'), 'one boundary, however it is read');
    eq(queries('SubscribeThroughGroup'), [JSON.stringify([['CourseId:{courseId}'], ['Subscribed']]), JSON.stringify([[], ['LimitSet']])],
      'the sibling under the course\'s tag, the limit untagged');

    const log = [{ type: 'Subscribed', data: { courseId: 'c1' } }, { type: 'LimitSet', data: { max: 1 } }];
    eq(evaluateCommand(model(), log, 'SubscribeThroughGroup', { courseId: 'c1' }).outcome, 'rejected',
      'and the decision does depend on it');
    eq(evaluateCommand(model(), log, 'SubscribeThroughGroup', { courseId: 'c2' }).outcome, 'published',
      'another course has its own count');
    eq(foldMember(model(), log, 'Course', 'full', 'c1'), true, 'folded by the group\'s tag alone');
  });

  // A course's free seats, and derived projections over them that take
  // what the reader asks about as an argument (10.0).
  const seatsModel = (title) => {
    const { id, model } = openBlank(title);
    addDefinition('custom-type-definition', id, 'CourseId', { schema: { type: 'string' }, isTag: true });
    addDefinition('custom-type-definition', id, 'StudentId', { schema: { type: 'string' }, isTag: true });
    const prop = (name, propertyType) => ({ name, propertyType, isOptional: false, isList: false });
    addTaggedEvent(id, 'Subscribed', { properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')] });
    const course = [{ name: 'courseId', tagType: 'CourseId' }];
    addDefinition('projection-definition', id, 'Free', {
      tags: course, valueType: 'integer', isList: false, initialValue: 3,
      handlers: [{ event: 'Subscribed', operation: 'decrement', value: 1 }],
    });
    addDefinition('projection-definition', id, 'HasSeats', {
      tags: course, arguments: [{ name: 'seats', propertyType: 'integer' }], valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'Free', tags: { courseId: { parameterName: 'courseId' } } },
        predicate: 'greaterThanOrEquals', rightHandSide: { parameterName: 'seats' } },
    });
    const subscribe = (title) => ({ type: 'Subscribed', data: { courseId: 'c1', studentId: title } });
    return { id, model, prop, course, subscribe };
  };

  check('a side may be one of its own parameters, as the read gave it', () => {
    const { model, subscribe } = seatsModel('Seats');
    const has = (log, seats) => foldProjection(model(), log, 'HasSeats', { tags: { courseId: 'c1' }, args: { seats } });
    eq(has([], 3), true, 'three free, three asked');
    eq(has([subscribe('s1')], 3), false, 'two free, three asked');
    eq(has([subscribe('s1')], 2), true, 'the argument is the read\'s to give');
    eq(sandbox.modelAdvisories(model()), [], 'advisory-clean');
  });

  check('a command reads it with an argument from its payload, and its boundary is the operand\'s', () => {
    const { id, model, prop, subscribe } = seatsModel('Seats from a command');
    addDefinition('command-definition', id, 'Book', {
      properties: [prop('courseId', 'CourseId'), prop('seats', 'integer')],
      conditions: [{
        leftHandSide: { projection: 'HasSeats', tags: { courseId: { parameterName: 'courseId' } },
          arguments: { seats: { parameterName: 'seats' } } },
        predicate: 'isTrue', rejection: 'Not enough seats',
      }],
      publishes: [],
    });
    eq(sandbox.modelAdvisories(model()).filter((a) => a.kind === 'projection-definition'), [], 'advisory-clean');
    const log = [subscribe('s1'), subscribe('s2')];
    eq(evaluateCommand(model(), log, 'Book', { courseId: 'c1', seats: 1 }).outcome, 'published', 'one is left');
    eq(evaluateCommand(model(), log, 'Book', { courseId: 'c1', seats: 2 }).outcome, 'rejected', 'two are not');
    const dcb = sandbox.deriveDcb(model(), model()['command-definitions'].Book);
    eq(dcb.items.map((item) => [item.via, item.tags, item.types]),
      [['Free', ['CourseId:{courseId}'], ['Subscribed']]], 'the argument narrows nothing');
  });

  check('an argument passes on – as an operand\'s argument, or as its tag', () => {
    const { id, model, course, subscribe } = seatsModel('Passed on');
    addDefinition('projection-definition', id, 'FreeAfter', {
      tags: course, arguments: [{ name: 'taken', propertyType: 'integer' }], valueType: 'integer', isList: false,
      derived: { leftHandSide: { projection: 'Free', tags: { courseId: { parameterName: 'courseId' } } },
        operator: 'subtract', rightHandSide: { parameterName: 'taken' } },
    });
    addDefinition('projection-definition', id, 'FreeAfterTwice', {
      tags: course, arguments: [{ name: 'each', propertyType: 'integer' }], valueType: 'integer', isList: false,
      derived: { leftHandSide: { projection: 'FreeAfter', tags: { courseId: { parameterName: 'courseId' } },
        arguments: { taken: { parameterName: 'each' } } }, operator: 'subtract', rightHandSide: { parameterName: 'each' } },
    });
    addDefinition('projection-definition', id, 'Subscribed', {
      tags: [...course, { name: 'studentId', tagType: 'StudentId' }], valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'Subscribed', operation: 'set', value: true }],
    });
    // The student is a value of a tag type taken as an argument: this
    // projection is kept per course, and what it asks about one
    // student is the operand's to narrow.
    addDefinition('projection-definition', id, 'IsSubscribed', {
      tags: course, arguments: [{ name: 'studentId', propertyType: 'StudentId' }], valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'Subscribed', tags: {
        courseId: { parameterName: 'courseId' }, studentId: { parameterName: 'studentId' } } },
      predicate: 'equals', rightHandSide: true },
    });
    eq(sandbox.modelAdvisories(model()).map((a) => a.message), [], 'advisory-clean');
    eq(foldProjection(model(), [], 'FreeAfterTwice', { tags: { courseId: 'c1' }, args: { each: 1 } }), 1, 'passed on and computed with');
    const is = (studentId) => foldProjection(model(), [subscribe('s1')], 'IsSubscribed',
      { tags: { courseId: 'c1' }, args: { studentId } });
    eq([is('s1'), is('s2')], [true, false], 'the argument narrowed the operand\'s read');

    addDefinition('command-definition', id, 'Check', {
      properties: [{ name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'studentId', propertyType: 'StudentId', isOptional: false, isList: false }],
      conditions: [{
        leftHandSide: { projection: 'IsSubscribed', tags: { courseId: { parameterName: 'courseId' } },
          arguments: { studentId: { parameterName: 'studentId' } } },
        predicate: 'isFalse', rejection: 'Already subscribed',
      }],
      publishes: [],
    });
    const dcb = sandbox.deriveDcb(model(), model()['command-definitions'].Check);
    eq(dcb.items.map((item) => item.tags), [['CourseId:{courseId}', 'StudentId:{studentId}']],
      'the operand\'s query carries the tag its argument gave');
  });

  check('a parameter that is not there, or not of the kind it meets, is an advisory', () => {
    const { id, model, course } = seatsModel('Wrong parameters');
    const advice = (name) => sandbox.modelAdvisories(model()).filter((a) => a.name === name).map((a) => a.message).join('; ');
    const derive = (name, body) => addDefinition('projection-definition', id, name, {
      tags: course, valueType: 'boolean', isList: false, ...body,
    });
    const free = { projection: 'Free', tags: { courseId: { parameterName: 'courseId' } } };
    derive('Unknown', { derived: { leftHandSide: free, predicate: 'equals', rightHandSide: { parameterName: 'seats' } } });
    eq(/none of Unknown's own parameters/.test(advice('Unknown')), true, advice('Unknown'));
    derive('Mismatched', {
      arguments: [{ name: 'title', propertyType: 'string' }],
      derived: { leftHandSide: free, predicate: 'lessThan', rightHandSide: { parameterName: 'title' } },
    });
    eq(/no values of one kind/.test(advice('Mismatched')), true, advice('Mismatched'));
    addDefinition('projection-definition', id, 'Declared', {
      tags: course, arguments: [{ name: 'seats', propertyType: 'integer' }], valueType: 'integer', isList: false,
      initialValue: 0, handlers: [],
    });
    eq(/nothing uses them/.test(advice('Declared')), true, advice('Declared'));
  });

  check('renaming an argument moves every read of it, and its own predicate\'s reference', () => {
    const { id, model, prop } = seatsModel('Renamed');
    addDefinition('command-definition', id, 'Book', {
      properties: [prop('courseId', 'CourseId'), prop('seats', 'integer')],
      conditions: [{
        leftHandSide: { projection: 'HasSeats', tags: { courseId: { parameterName: 'courseId' } },
          arguments: { seats: { parameterName: 'seats' } } },
        predicate: 'isTrue', rejection: 'Not enough seats',
      }],
      publishes: [],
    });
    sandbox.renameMember('projection-definition', id, 'HasSeats', 'argument', 'seats', 'wanted');
    const body = model()['projection-definitions'].HasSeats;
    eq(body.arguments, [{ name: 'wanted', propertyType: 'integer' }], 'the declaration');
    eq(body.derived.rightHandSide, { parameterName: 'wanted' }, 'its own side');
    eq(model()['command-definitions'].Book.conditions[0].leftHandSide.arguments,
      { wanted: { parameterName: 'seats' } }, 'the command\'s read, keyed by the new name');
  });

  check('the tag toggle moves a parameter, and every read\'s value, between tags and arguments', () => {
    const { id, model, prop, subscribe } = seatsModel('Toggled');
    addDefinition('projection-definition', id, 'IsSubscribed', {
      tags: [{ name: 'courseId', tagType: 'CourseId' }, { name: 'studentId', tagType: 'StudentId' }],
      valueType: 'boolean', isList: false, initialValue: false,
      handlers: [{ event: 'Subscribed', operation: 'set', value: true }],
    });
    addDefinition('projection-definition', id, 'NotSubscribed', {
      tags: [{ name: 'courseId', tagType: 'CourseId' }, { name: 'studentId', tagType: 'StudentId' }],
      valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'IsSubscribed', tags: {
        courseId: { parameterName: 'courseId' }, studentId: { parameterName: 'studentId' } } },
      predicate: 'equals', rightHandSide: false },
    });
    addDefinition('command-definition', id, 'Subscribe', {
      properties: [prop('courseId', 'CourseId'), prop('studentId', 'StudentId')],
      conditions: [{
        leftHandSide: { projection: 'NotSubscribed', tags: { courseId: { parameterName: 'courseId' },
          studentId: { tagType: 'StudentId', tagValue: 's1' } } },
        predicate: 'isTrue', rejection: 'Already subscribed',
      }],
      publishes: [{ name: 'Subscribed', parameters: { courseId: { parameterName: 'courseId' }, studentId: { parameterName: 'studentId' } } }],
    });
    sandbox.setProjectionParameterIsTag(id, 'NotSubscribed', 'studentId', false);
    const body = model()['projection-definitions'].NotSubscribed;
    eq([body.tags, body.arguments], [[{ name: 'courseId', tagType: 'CourseId' }], [{ name: 'studentId', propertyType: 'StudentId' }]],
      'an argument now, first among them');
    const read = model()['command-definitions'].Subscribe.conditions[0].leftHandSide;
    eq([read.tags, read.arguments], [{ courseId: { parameterName: 'courseId' } }, { studentId: 's1' }],
      'the read gives it as an argument, as a bare literal');
    eq(sandbox.modelAdvisories(model()).map((a) => a.message), [], 'advisory-clean');
    eq(evaluateCommand(model(), [subscribe('s1')], 'Subscribe', { courseId: 'c1', studentId: 's1' }).outcome,
      'rejected', 'and it reads the same');

    sandbox.setProjectionParameterIsTag(id, 'NotSubscribed', 'studentId', true);
    const back = model()['command-definitions'].Subscribe.conditions[0].leftHandSide;
    eq([back.tags, back.arguments], [{ courseId: { parameterName: 'courseId' }, studentId: { tagType: 'StudentId', tagValue: 's1' } }, undefined],
      'and back, the literal typed again');
    eq(model()['projection-definitions'].NotSubscribed.arguments, undefined, 'no empty list left behind');
  });

  check('a 9.x script\'s arguments are lifted onto its projection on import', () => {
    const { model } = seatsModel('Lifted');
    const envelope = buildShareEnvelope(model(), []);
    envelope.dcbModelVersion = '9.0';
    delete envelope.groupDefinitions;
    envelope.entityDefinitions = [];
    envelope.projectionDefinitions.push({
      name: 'Prefixed', tags: [], valueType: 'string', isList: false,
      script: { initialState: '', arguments: [{ name: 'prefix', propertyType: 'string' }] },
      handlers: [],
    });
    const { modelId } = importModelFromEnvelope(envelope);
    const body = sandbox.projectState()[modelId]['projection-definitions'].Prefixed;
    eq([body.arguments, body.script.arguments], [[{ name: 'prefix', propertyType: 'string' }], undefined], 'lifted');
  });

  check('the shipped model is advisory-clean and its scenarios hold', () => {
    const model = build(HOURS);
    eq(sandbox.modelAdvisories(model), [], 'no advisories');
    for (const scenario of Object.values(model['scenario-definitions'])) {
      eq(sandbox.runScenario(model, scenario).status, 'current', scenario.name);
    }
    for (const scenario of Object.values(model['projection-scenario-definitions'])) {
      eq(sandbox.runProjectionScenario(model, scenario).status, 'current', scenario.name);
    }
  });

  const advises = (pattern, what, edit) => check(what, () => {
    const { id, model } = open_(HOURS);
    const body = deepClone(model()['projection-definitions'].DeveloperRemainingHoursForWeek);
    edit(body);
    updateDefinition('projection-definition', id, 'DeveloperRemainingHoursForWeek', body);
    const found = sandbox.modelAdvisories(model())
      .filter((a) => a.name === 'DeveloperRemainingHoursForWeek').map((a) => a.message).join('; ');
    eq(pattern.test(found), true, `the advisory says so: ${found}`);
  });
  advises(/not a single number/, 'a computation over something that is no number is an advisory', (body) => {
    body.derived.rightHandSide = 'eight';
  });
  advises(/computes a number, but holds an integer/, 'a number held as an integer is an advisory', (body) => {
    body.derived.rightHandSide = 1.5;
  });
  advises(/computes an integer, but holds a boolean/, 'a computation held as a boolean is an advisory', (body) => {
    body.valueType = 'boolean';
  });
  advises(/negates a computation/, 'negating a computation is an advisory', (body) => {
    body.derived.negate = true;
  });
  advises(/both a predicate and an operator/, 'a predicate beside an operator is an advisory', (body) => {
    body.derived.predicate = 'equals';
  });
  advises(/not an operator/, 'an unknown operator is an advisory', (body) => {
    body.derived.operator = 'divide';
  });

  check('a computation survives an export and an import', () => {
    const model = build(HOURS);
    const { modelId } = importModelFromEnvelope(buildShareEnvelope(model, []));
    eq(sandbox.projectState()[modelId]['projection-definitions'].DeveloperRemainingHoursForWeek.derived.operator,
      'subtract', 'the operator is carried');
  });
}

// ---------------------------------------------------------------
// Tags are what an event lists (8.0) – a tag-typed value left off the
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
    eq(odd.some((m) => /"line" is a record – name its tag field \(line\.productId\)/.test(m)), true, 'a record, whole');
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
// A projection declares the tags it is read by (8.0), each named and
// typed, and a read gives a value for each – of the declared type,
// which is the tag's key.
// ---------------------------------------------------------------
{
  check('a projection is read by the tags it declares, and only by them', () => {
    const model = build(SIMPLE);
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 5 });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 5 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    eq(foldProjection(model, log, 'CourseSubscriptionCount', { tags: { courseId: 'c1' } }), 1, 'per course');
    eq(foldProjection(model, log, 'StudentSubscriptionCount', { tags: { studentId: 's1' } }), 2, 'per student, its own fold');
    let message = '';
    try { foldProjection(model, log, 'CourseSubscriptionCount', {}); } catch (error) { message = error.message; }
    eq(message, 'Projection "CourseSubscriptionCount" was read without a value for its "courseId" tag.', 'a tag left out');
  });

  check('renaming a projection\'s tag moves every read keyed by it', () => {
    const { id, model } = open_(PREDEFINED_INDEX('content-decisions-derived'));
    renameMember('projection-definition', id, 'DocumentCurrentText', 'tag', 'documentId', 'docId');
    eq(model()['projection-definitions'].DocumentCurrentText.tags, [{ name: 'docId', tagType: 'DocumentId' }], 'declared');
    eq(model()['command-definitions'].UpdateText.conditions[1].leftHandSide.tags,
      { docId: { parameterName: 'docId' } }, 'a read in place');
    eq(model()['projection-definitions'].DocumentHasPendingChanges.derived.leftHandSide.tags,
      { docId: { parameterName: 'documentId' } }, 'a derived operand, which still passes its own tag on');
    renameMember('projection-definition', id, 'DocumentHasPendingChanges', 'tag', 'documentId', 'doc');
    eq(model()['projection-definitions'].DocumentHasPendingChanges.derived.rightHandSide.tags,
      { documentId: { parameterName: 'doc' } }, 'and an owner\'s rename reaches what its operands are given');
    eq(sandbox.modelAdvisories(model()), [], 'nothing left dangling');
  });

  check('a group read over a list says each, or is advised and refused', () => {
    const { id, model } = openSchedules();
    const body = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    body.boundary.find((b) => b.alias === 'others').tags.courseId = { alias: 'student', property: 'subscribedCourseIds' };
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', body);
    const found = sandbox.modelAdvisories(model()).map((a) => a.message);
    eq(found.some((m) => /"each student\.subscribedCourseIds" reads it once per element/.test(m)), true, found.join('; '));
    const log = [];
    drive(model(), log, 'DefineCourse', { courseId: 'c1', capacity: 9, slots: [] });
    drive(model(), log, 'RegisterStudent', { studentId: 's1' });
    let message = '';
    try { evaluateCommand(model(), log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' }); }
    catch (error) { message = error.message; }
    eq(/holds many – Course\(each student\.subscribedCourseIds\)/.test(message), true, message);
  });

  check('a read by a tag literal folds what the literal names', () => {
    const { id, model } = open_(SEQUENCE);
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary.push({ alias: 'first', projection: 'CourseCapacity', tags: { courseId: { tagType: 'CourseId', tagValue: 'c1' } } });
    body.conditions.push({ leftHandSide: { alias: 'first' }, predicate: 'greaterThan', rightHandSide: 0, rejection: 'The first course has no seats' });
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    const log = [];
    drive(model(), log, 'DefineCourse', { capacity: 5 });
    drive(model(), log, 'DefineCourse', { capacity: 7 });
    const result = evaluateCommand(model(), log, 'ChangeCourseCapacity', { courseId: 'c2', newCapacity: 9 });
    eq(result.outcome, 'published', 'it ran');
    eq(result.reads.first, {
      kind: 'projection', projection: 'CourseCapacity',
      tags: [{ name: 'courseId', type: 'CourseId', value: 'c1' }], arguments: {}, value: 5,
    }, 'the course the literal names, and the tag it was read by');
    eq(sandbox.deriveDcb(model(), body).items.find((i) => i.alias === 'first').tags, ['CourseId:c1'],
      'and the query says so');
  });

  check('a read by a value of another type, by an untyped literal or unnamed is advised – and a run refuses it', () => {
    const { id, model } = open_(SIMPLE);
    const body = deepClone(model()['command-definitions'].ChangeCourseCapacity);
    body.boundary.push({ alias: 'odd', projection: 'CourseCapacity', tags: { courseId: { parameterName: 'newCapacity' } } });
    body.conditions.push({ leftHandSide: { alias: 'odd' }, predicate: 'greaterThan', rightHandSide: 0, rejection: 'Odd' });
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    const advised = () => sandbox.modelAdvisories(model()).filter((a) => a.name === 'ChangeCourseCapacity').map((a) => a.message);
    let found = advised();
    eq(found.some((m) => /newCapacity, an integer – but its "courseId" tag is a CourseId/.test(m)), true, found.join('; '));
    let message = '';
    try { evaluateCommand(model(), [], 'ChangeCourseCapacity', { courseId: 'c1', newCapacity: 3 }); } catch (error) { message = error.message; }
    eq(/is tagged by newCapacity, an integer – but CourseCapacity's "courseId" tag is a CourseId/.test(message), true,
      'the run refuses to fold the wrong instance: ' + message);
    body.boundary[body.boundary.length - 1].tags = { courseId: 'c1' };
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    found = advised();
    eq(found.some((m) => /which says no tag type – write the literal with its type, CourseId\("c1"\)/.test(m)), true, found.join('; '));
    body.boundary[body.boundary.length - 1].tags = [{ parameterName: 'courseId' }];
    updateDefinition('command-definition', id, 'ChangeCourseCapacity', body);
    found = advised();
    eq(found.some((m) => /with tags that are not named/.test(m)), true, found.join('; '));
  });
}

// ---------------------------------------------------------------
// A defective model evaluates to an error, never to a crash: the
// scenario runners are called while the page renders, so anything
// that escapes them as a TypeError takes the page down with it.
// ---------------------------------------------------------------
{
  check('a null entry among an event\'s or a command\'s properties is skipped', () => {
    const { id, model } = openScripted();
    const event = model()['event-definitions'].Ticked;
    updateDefinition('event-definition', id, 'Ticked', { ...event, properties: [null, ...event.properties] });
    const command = model()['command-definitions'].Tick;
    updateDefinition('command-definition', id, 'Tick', { ...command, properties: [null, ...command.properties] });
    eq(evaluateCommand(model(), [], 'Tick', { counterId: 'x1' }).outcome, 'published', 'evaluates');
    eq(foldProjection(model(), [{ type: 'Ticked', data: { counterId: 'x1' } }], 'Counter.total', { tags: { counterId: 'x1' } }),
      1, 'folds');
    eq(runScenario(model(), {
      given: [{ event: 'Ticked', data: { counterId: 'x1' } }], command: 'Tick',
      when: { arguments: { counterId: 'x1' } }, then: null,
    }).status, 'drifted', 'and a scenario runs');
  });

  check('a script with no initial state starts from null', () => {
    const { id, model } = openScripted();
    addDefinition('projection-definition', id, 'Unstarted', {
      valueType: 'integer', isList: false, script: {},
      handlers: [{ event: 'Ticked', code: '(state || 0) + 1' }],
    });
    eq(foldProjection(model(), [], 'Unstarted', {}), null, 'nothing folded');
  });

  check('a script cannot change the events it folds', () => {
    // The log is shared – by every fold, every read, every repaint – so
    // an event a script changed would change what the next fold sees.
    const { id, model } = openScripted();
    addDefinition('projection-definition', id, 'Tamperer', {
      valueType: 'integer', isList: false, script: { initialState: 0 },
      handlers: [{ event: 'Ticked', code: '(event.data.counterId = "forged", state + 1)' }],
    });
    const log = [{ type: 'Ticked', data: { counterId: 'x1' } }];
    let message = '';
    try { foldProjection(model(), log, 'Tamperer', {}); } catch (error) { message = error.message; }
    eq(/threw/.test(message), true, message || 'refused');
    eq(log[0].data.counterId, 'x1', 'the log as it was');
    eq(foldProjection(model(), log, 'Counter.total', { tags: { counterId: 'x1' } }), 1, 'and other folds read it so');
  });

  check('a script that throws something other than an Error is an evaluation error', () => {
    const { id, model } = openScripted();
    addDefinition('projection-definition', id, 'Thrower', {
      valueType: 'integer', isList: false, script: { initialState: 0 },
      handlers: [{ event: 'Ticked', code: '(() => { throw null; })()' }],
    });
    let caught;
    try { foldProjection(model(), [{ type: 'Ticked', data: { counterId: 'x1' } }], 'Thrower', {}); } catch (error) { caught = error; }
    eq(caught && caught.constructor.name, 'EvaluationError', 'an EvaluationError');
    eq(/threw: null/.test(caught.message), true, caught.message);
  });

  check('anything unforeseen in a scenario run is that scenario\'s error, not the page\'s', () => {
    const { model } = openScripted();
    const broken = deepClone(model());
    // A shape the write path would never let through, standing in for
    // whatever a defect the point fixes do not foresee looks like.
    broken['command-definitions'].Tick.boundary = 7;
    const run = runScenario(broken, { given: [], command: 'Tick', when: { arguments: { counterId: 'x1' } }, then: null });
    eq(run.status, 'broken', 'broken, not thrown');
    eq(typeof run.reason, 'string', 'with a reason');
    broken['group-definitions'].Counter.projections[0].handlers = 7;
    const projected = runProjectionScenario(broken, { given: [], projection: 'Counter.total', tags: { counterId: { tagValue: 'x1' } }, then: 0 });
    eq(projected.status, 'broken', 'a projection scenario too');
  });
}

// ---------------------------------------------------------------
// Names are looked up as a model's own, never through Object's
// prototype: `constructor`, `toString` and `hasOwnProperty` are names
// an author may write, and what an empty object inherits under them
// is not a value anyone supplied.
// ---------------------------------------------------------------
{
  check('a required argument named like a prototype key is still required', () => {
    const { id, model } = openScripted();
    addTaggedEvent(id, 'Built', {
      properties: [{ name: 'constructor', propertyType: 'string', isOptional: false, isList: false }],
    });
    addDefinition('command-definition', id, 'Build', {
      properties: [{ name: 'constructor', propertyType: 'string', isOptional: false, isList: false }],
      boundary: [], conditions: [],
      publishes: [{ name: 'Built', parameters: { constructor: { parameterName: 'constructor' } } }],
    });
    let message = '';
    try { evaluateCommand(model(), [], 'Build', {}); } catch (error) { message = error.message; }
    eq(message, '"Build" needs a value for "constructor".', 'not supplied by Object');
    eq(evaluateCommand(model(), [], 'Build', { constructor: 'Ada' }).events[0].data, { constructor: 'Ada' },
      'and published when it is supplied');
  });

  check('a command or a Given event named like a prototype key is not in the model', () => {
    const { model } = openScripted();
    let message = '';
    try { evaluateCommand(model(), [], 'hasOwnProperty', {}); } catch (error) { message = error.message; }
    eq(message, 'This model has no command "hasOwnProperty".', 'no such command');
    const run = runScenario(model(), {
      given: [{ event: 'toString', data: {} }], command: 'Tick',
      when: { arguments: { counterId: 'x1' } }, then: null,
    });
    eq(run.status, 'broken', 'a Given naming no event is broken, not drifted');
  });

  check('an event without a field reads nothing there, whatever the field is called', () => {
    const { id, model } = openScripted();
    addDefinition('projection-definition', id, 'LastMaker', {
      valueType: 'string', isList: false, initialValue: null,
      handlers: [{ event: 'Ticked', operation: 'set', value: { eventProperty: 'constructor' } }],
    });
    eq(typeof foldProjection(model(), [{ type: 'Ticked', data: { counterId: 'x1' } }], 'LastMaker', {}), 'undefined',
      'what any absent field reads as, not Object');
  });
}

// ---------------------------------------------------------------
// The log grows with every edit and lives in the browser's storage,
// whose quota the site shares. Past a size it compacts itself – the
// history up to the floor folded into what it built – and a full
// storage makes room the same way before it refuses anything.
// ---------------------------------------------------------------
{
  const quotaAbove = (chars) => {
    const setItem = sandbox.localStorage.setItem;
    sandbox.localStorage.setItem = (key, value) => {
      if (String(value).length <= chars) return setItem(key, value);
      const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error;
    };
    return () => { sandbox.localStorage.setItem = setItem; };
  };
  const definitionCount = (model) => Object.values(sandbox.DEF_COLLECTIONS)
    .reduce((n, collection) => n + Object.keys(model[collection]).length, 0);

  check('past the threshold the log compacts itself, and every model stays as it is', () => {
    const { id } = open_(GROUPED);
    const doomed = createDcbModel('Doomed');
    sandbox.deleteDcbModel(doomed);
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseCreated');
    const before = JSON.stringify(sandbox.projectState());
    const length = sandbox.loadEvents().length;
    sandbox.setLogCompactionThreshold(1);
    try {
      renameDefinition('event-definition', id, 'CourseCreated', 'CourseDefined');
    } finally {
      sandbox.setLogCompactionThreshold(1000 * 1000);
    }
    const model = sandbox.projectState()[id];
    eq('CourseDefined' in model['event-definitions'], true, 'the edit landed');
    eq(JSON.stringify(sandbox.projectState()), before.split('CourseCreated').join('CourseDefined'), 'the same models');
    eq(sandbox.loadEvents().length, 1 + definitionCount(model), 'a creation and one add per definition');
    eq(sandbox.loadEvents().length < length, true, 'shorter than the history it replaced');
    eq(sandbox.loadEvents().map((e) => e.sequence), sandbox.loadEvents().map((_, i) => i), 'numbered afresh');
  });

  check('compaction keeps the events from the floor on, as they were, and says how far they moved', () => {
    const { id } = open_(GROUPED);
    renameDefinition('event-definition', id, 'CourseDefined', 'CourseCreated');
    const floor = sandbox.loadEvents().length;
    renameDefinition('event-definition', id, 'CourseCreated', 'CourseOpened');
    const kept = sandbox.loadEvents().slice(floor);
    let told = null;
    sandbox.onCompact((compacted) => { told = compacted; });
    sandbox.setCompactionFloor(() => floor);
    sandbox.setLogCompactionThreshold(1);
    try {
      renameDefinition('event-definition', id, 'CourseOpened', 'CourseDefined');
    } finally {
      sandbox.setLogCompactionThreshold(1000 * 1000);
      sandbox.setCompactionFloor((events) => events.length);
    }
    const events = sandbox.loadEvents();
    eq(told !== null && told.dropped, false, 'told, and nothing dropped');
    const moved = events.slice(floor + told.shift, floor + told.shift + kept.length);
    eq(moved.map((e) => [e.type, e.data]), kept.map((e) => [e.type, e.data]), 'the kept events, moved by shift');
    eq('CourseDefined' in sandbox.projectState()[id]['event-definitions'], true, 'and the state they build');
  });

  check('a full storage compacts and tries again before refusing', () => {
    const { id, model } = open_(GROUPED);
    // History worth folding: four renames that end where they started.
    const names = ['CourseDefined', 'CourseCreated', 'CourseOpened', 'CourseStarted', 'CourseDefined'];
    names.slice(1).forEach((name, i) => renameDefinition('event-definition', id, names[i], name));
    // Room for the log as it is, not for one more event on top of it.
    const size = (sandbox.localStorage.getItem(sandbox.EVENT_LOG_KEY) || '').length;
    const restore = quotaAbove(size);
    try {
      renameDefinition('event-definition', id, 'CourseDefined', 'CourseCreated');
    } finally {
      restore();
    }
    eq('CourseCreated' in model()['event-definitions'], true, 'the edit landed, in the room compaction made');
  });

  check('a change that does not fit even compacted is refused, and nothing is written', () => {
    const { id, model } = open_(GROUPED);
    const length = sandbox.loadEvents().length;
    const restore = quotaAbove(0);
    let caught;
    try { renameDefinition('event-definition', id, 'CourseDefined', 'CourseCreated'); } catch (error) { caught = error; } finally { restore(); }
    eq(caught && caught.name, 'StorageFullError', 'a domain error of its own');
    eq(caught instanceof sandbox.DomainError, true, 'shown like any refusal');
    eq(sandbox.loadEvents().length, length, 'nothing written');
    eq('CourseDefined' in model()['event-definitions'], true, 'nothing changed');
  });
}

// ---------------------------------------------------------------
// A fan-out over a long log: each instance is a read, and a read must
// not cost a pass over every event's tags. The sandbox evaluates on
// every repaint, scrubbing included.
// ---------------------------------------------------------------
{
  const pricing = PREDEFINED_INDEX('pricing-simple');

  check('two hundred fanned reads over five thousand events do not rescan the log per read', () => {
    const model = build(pricing);
    const log = [];
    for (let i = 0; i < 200; i++) log.push({ type: 'ProductDefined', data: { productId: 'p' + i, price: 1 } });
    for (let i = 0; i < 4800; i++) {
      log.push({ type: 'ProductPriceChanged', data: { productId: 'p' + (i % 200), newPrice: 2 + (i % 7) } });
    }
    const items = [];
    for (let i = 0; i < 200; i++) items.push({ productId: 'p' + i, price: 2 + ((4600 + i) % 7) });
    const started = Date.now();
    const result = evaluateCommand(model, log, 'OrderProducts', { orderId: 'o1', items });
    const took = Date.now() - started;
    eq(result.outcome, 'published', 'every price read right');
    // Seconds before the tags were cached and indexed; a bound loose
    // enough for a slow CI machine.
    eq(took < 1500, true, `took ${took} ms`);
  });

  check('a log appended to in place is read whole on the next fold', () => {
    const model = build(pricing);
    const log = [{ type: 'ProductDefined', data: { productId: 'p1', price: 1 } }];
    eq(foldProjection(model, log, 'ProductCurrentPrice', { tags: { productId: 'p1' } }), 1, 'before');
    log.push({ type: 'ProductPriceChanged', data: { productId: 'p1', newPrice: 3 } });
    eq(foldProjection(model, log, 'ProductCurrentPrice', { tags: { productId: 'p1' } }), 3, 'after');
  });
}

// ---------------------------------------------------------------
// Small semantic edges: values that look like syntax somewhere else.
// ---------------------------------------------------------------
{
  check('a long digit run steps by exactly one', () => {
    eq(evSuccessor('inv-12345678901234567891'), 'inv-12345678901234567892', 'past 2^53');
    eq(evSuccessor('inv-99999999999999999999'), 'inv-100000000000000000000', 'carried');
    eq(evSuccessor('inv-009'), 'inv-010', 'width kept');
  });

  check('a tag value with a dollar sign is that value, not a replacement pattern', () => {
    eq(sandbox.renderTag({ name: 'CourseId', tagSchema: '{type}:{value}' }, "a$'"), "CourseId:a$'", '$\' kept');
    eq(sandbox.renderTag({ name: 'CourseId', tagSchema: '{type}:{value}' }, 'a$&b'), 'CourseId:a$&b', '$& kept');
    const model = build(GROUPED);
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'a', capacity: 1 });
    eq(foldMember(model, log, 'Course', 'status', "a$'"), 'NonExistent', 'course a$\' is not course a');
  });
}

// ---------------------------------------------------------------
// Binding a projection that takes no tags is how a command with no
// conditions is strictly serialised (dcb-model.schema.json says so):
// its read is the append condition, and nothing else need consult it.
// ---------------------------------------------------------------
{
  check('a binding to a parameterless projection is kept, as the command\'s serialisation', () => {
    const { id, model } = openBlank('Serialised');
    addTaggedEvent(id, 'Ticked', { properties: [] });
    addDefinition('projection-definition', id, 'TickCount', {
      tags: [], valueType: 'integer', isList: false, initialValue: 0,
      handlers: [{ event: 'Ticked', operation: 'increment', value: 1 }],
    });
    addDefinition('command-definition', id, 'Tick', {
      properties: [], boundary: [{ alias: 'ticks', projection: 'TickCount' }], conditions: [],
      publishes: [{ name: 'Ticked', parameters: {} }],
    });
    const body = model()['command-definitions'].Tick;
    eq([...sandbox.bindingReferences(model(), body).get('ticks')], ['serialisation'], 'consulted as the serialisation');
    updateDefinition('command-definition', id, 'Tick', { ...body, properties: [] });
    eq(model()['command-definitions'].Tick.boundary.map((b) => b.alias), ['ticks'], 'not pruned by the next edit');
    eq(sandbox.modelAdvisories(model()).filter((a) => /nothing consults/.test(a.message)), [], 'and not advised against');
    eq(sandbox.deriveDcb(model(), model()['command-definitions'].Tick).items.some((item) => item.alias === 'ticks'), true,
      'the read is in the append condition');
  });
}

// The shipped models and the fixtures, whose scenarios cover scripted,
// guarded and derived reads.
function modelsWithScenarios() {
  return [
    ...sandbox.PREDEFINED_MODELS.map((shipped, index) => ({ name: shipped.slug, model: build(index) })),
    ...require('fs').readdirSync(require('path').join(__dirname, '..', 'fixtures')).map((file) => {
      resetStore();
      const envelope = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'fixtures', file), 'utf8'));
      const imported = importModelFromEnvelope(envelope).modelId;
      return { name: file, model: sandbox.projectState()[imported] };
    }),
  ];
}

// ---------------------------------------------------------------
// A read port in place of the log: a runtime over a real event store
// hands the evaluator a function that answers a query per round, and
// must get the very outcome the log gives.
// ---------------------------------------------------------------
{
  // A store as the DCB specification describes one: an event matches
  // an item when its type is one of the item's and it carries all its
  // tags, and a query when it matches any of its items.
  const portOver = (model, log, calls) => (items) => {
    calls.push(items);
    return log.filter((event) => items.some((item) => item.types.includes(event.type)
      && item.tags.every((tag) => tagsOfEvent(model, event.type, event.data).includes(tag))));
  };

  // The outcome through a port, its calls, and the query it decided on.
  const sameThroughPort = (model, log, command, args, what) => {
    const outcome = (events) => {
      try { return evaluateCommand(model, events, command, args); } catch (e) { return { error: e.message }; }
    };
    const calls = [];
    const { query, ...through } = outcome(portOver(model, log, calls));
    eq(through, outcome(log), what);
    eq(calls.flat().every((item) => item.types.length > 0), true, `${what} – every item names its types`);
    return { calls, query };
  };

  check('every command scenario decides the same through a read port', () => {
    let compared = 0;
    for (const { name, model } of modelsWithScenarios()) {
      for (const scenario of Object.values(model['scenario-definitions'] || {})) {
        sameThroughPort(model, sandbox.scenarioLog(scenario), scenario.command,
          (scenario.when && scenario.when.arguments) || {}, `${name}: ${scenario.name}`);
        compared++;
      }
    }
    eq(compared > 50, true, `${compared} scenarios compared`);
  });

  check('a chained boundary reads by what the read it waits for answered', () => {
    const model = openSchedules().model();
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 9, slots: ['2026-03-01T09'] });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 9, slots: ['2026-03-01T11'] });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    eq(sandbox.deriveRounds(model['command-definitions'].RescheduleCourse).length > 1, true, 'chained');
    const { calls, query } = sameThroughPort(model, log, 'RescheduleCourse', { courseId: 'c1', slots: ['2026-03-01T11'] },
      'rescheduling onto a subscriber\'s other course');
    // Without `excluding`, the subscribers' courses include c1 itself –
    // asked again for its slots, which the first call did not fetch.
    eq(calls.map((items) => items.map((item) => item.tags)), [
      [['CourseId:c1']],
      [['StudentId:s1']],
      [['CourseId:c1'], ['CourseId:c2']],
    ], 'one call per link of the chain, c2 known only from c1\'s subscribers');
  });

  check('reads that hang off the arguments alone are asked in one call, merged by their tags', () => {
    const model = build(PREDEFINED_INDEX('course-simple'));
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 10 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    const { calls, query } = sameThroughPort(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' },
      'subscribing');
    eq(calls.length, 1, 'one call');
    eq(calls[0].map((item) => item.tags), [['CourseId:c1'], ['StudentId:s1']], 'one item per tag set');
    eq(query, calls[0], 'and every item asked was read');
  });

  check('a command refused at its first rule still asked once for every rule', () => {
    const model = build(PREDEFINED_INDEX('course-simple'));
    const { calls } = sameThroughPort(model, [], 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' },
      'subscribing to no course');
    eq(calls.length, 1, 'one call');
    eq(calls[0].length, 2, 'both tag sets');
  });

  check('a fold that handles no event reads nothing', () => {
    const { id, model } = open_(GROUPED);
    addDefinition('projection-definition', id, 'Nothing', {
      tags: [], valueType: 'integer', isList: false, initialValue: 7, handlers: [],
    });
    const calls = [];
    eq(foldProjection(model(), portOver(model(), [], calls), 'Nothing', { tags: {}, args: {} }), 7, 'initial value');
    eq(calls, [], 'no query');
  });
}

// ---------------------------------------------------------------
// Through a store: the cycle around a decision – head, reads, the
// append and its condition – one attempt at a time.
// ---------------------------------------------------------------
{
  const { handleCommand, projectFromStore, memoryStore } = sandbox;
  const stored = (model, type, data) => ({ type, data, tags: tagsOfEvent(model, type, data) });
  const storeOf = (model, log) => memoryStore(log.map((e) => stored(model, e.type, e.data)));
  // A store that lets someone else append while it is read – the n-th
  // read calls `during(n)` after answering.
  const racing = (store, during) => {
    let reads = 0;
    return { ...store, read: (query) => { const answer = store.read(query); during(++reads); return answer; } };
  };
  const calls = (trace) => trace.map((entry) => entry.call || `restart:${entry.restart}`);

  check('every command scenario decides through a store as it does over the log', () => {
    let compared = 0;
    for (const { name, model } of modelsWithScenarios()) {
      for (const scenario of Object.values(model['scenario-definitions'] || {})) {
        const log = sandbox.scenarioLog(scenario);
        const args = (scenario.when && scenario.when.arguments) || {};
        let expected;
        try { expected = evaluateCommand(model, log, scenario.command, args); } catch (e) { expected = { error: e.message }; }
        const store = storeOf(model, log);
        const outcome = handleCommand(model, store, scenario.command, args);
        const what = `${name}: ${scenario.name}`;
        if (expected.error) {
          eq([outcome.outcome, outcome.message], ['error', expected.error], what);
        } else if (expected.outcome === 'rejected') {
          eq([outcome.outcome, outcome.failedRule], ['rejected', expected.failedRule], what);
        } else {
          eq([outcome.outcome, outcome.events.map(({ type, data }) => ({ type, data }))],
            ['published', expected.events.map(({ type, data }) => ({ type, data }))], what);
          eq(store.events.length, log.length + expected.events.length, `${what} – appended`);
        }
        compared++;
      }
    }
    eq(compared > 50, true, `${compared} scenarios compared`);
  });

  check('every command scenario asks the store as its plan says: head when chained, never a call too many', () => {
    let compared = 0;
    for (const { name, model } of modelsWithScenarios()) {
      for (const scenario of Object.values(model['scenario-definitions'] || {})) {
        const body = model['command-definitions'][scenario.command];
        if (!body) continue;
        const plan = sandbox.commandPlan(sandbox.boundarySummary(model, body));
        const trace = [];
        const outcome = handleCommand(model, storeOf(model, sandbox.scenarioLog(scenario)), scenario.command,
          (scenario.when && scenario.when.arguments) || {}, { trace });
        if (outcome.outcome === 'error') continue;
        const what = `${name}: ${scenario.name}`;
        const reads = trace.filter((entry) => entry.call === 'read').length;
        eq(trace.some((entry) => entry.restart), false, `${what} – no read the plan did not expect`);
        eq(trace.some((entry) => entry.call === 'head'), plan.after === 'head', `${what} – head exactly when the plan says`);
        eq(reads <= plan.calls.length, true, `${what} – ${reads} reads, ${plan.calls.length} planned`);
        if (outcome.outcome === 'published' && outcome.events.length && plan.calls.length) {
          const append = trace.find((entry) => entry.call === 'append');
          eq(!!append.condition, true, `${what} – a command that reads appends on a condition`);
        }
        compared++;
      }
    }
    eq(compared > 50, true, `${compared} scenarios compared`);
  });

  check('a query item names at least one type, or leaves types out to match any type', () => {
    const tagged = (type, tags) => ({ type, data: {}, tags });
    const store = sandbox.memoryStore([tagged('A', ['X:1']), tagged('B', ['X:1']), tagged('A', ['X:2'])]);
    eq(store.read([{ types: ['A'], tags: ['X:1'] }]).map((e) => e.position), [1], 'types given: one of them');
    eq(store.read([{ tags: ['X:1'] }]).map((e) => e.position), [1, 2], 'types left out: any type');
    let refused = null;
    try { store.read([{ types: [], tags: ['X:1'] }]); } catch (error) { refused = error.message; }
    eq(/empty types list matches nothing/.test(refused || ''), true, `an empty list is refused, not read as any type: ${refused}`);
    refused = null;
    try { store.append([tagged('A', [])], { failIfEventsMatch: [{ types: [], tags: [] }], after: 3 }); } catch (error) { refused = error.message; }
    eq(/empty types list/.test(refused || ''), true, 'in an append condition too');
    eq(store.events.length, 3, 'and nothing appended');
  });

  check('no plan, read or append condition ever carries an empty types list', () => {
    const empty = (item) => Array.isArray(item.types) && !item.types.length;
    let looked = 0;
    for (const { name, model } of modelsWithScenarios()) {
      for (const [command, body] of Object.entries(model['command-definitions'])) {
        const plan = sandbox.commandPlan(sandbox.boundarySummary(model, body));
        eq(plan.calls.flat().filter(empty), [], `${name}: ${command} – planned`);
        looked++;
      }
      for (const scenario of Object.values(model['scenario-definitions'] || {})) {
        const trace = [];
        handleCommand(model, storeOf(model, sandbox.scenarioLog(scenario)), scenario.command,
          (scenario.when && scenario.when.arguments) || {}, { trace });
        const items = trace.flatMap((entry) => (entry.call === 'read' ? entry.query
          : entry.call === 'append' && entry.condition ? entry.condition.failIfEventsMatch : []));
        eq(items.filter(empty), [], `${name}: ${scenario.name} – asked`);
        eq(trace.some((entry) => entry.failed), false, `${name}: ${scenario.name} – the store took every call`);
      }
    }
    eq(looked > 20, true, `${looked} commands planned`);
  });

  check('a group bound and read for nothing adds nothing to the query', () => {
    const { id, model } = openBlank('Bound for nothing');
    sandbox.createGroup(id, 'Counter', { name: 'counterId', tagType: 'CounterId' });
    addTaggedEvent(id, 'Ticked', {
      properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
    });
    addDefinition('projection-definition', id, 'Counter.total', {
      valueType: 'integer', isList: false, initialValue: 0, handlers: [{ event: 'Ticked', operation: 'increment', value: 1 }],
    });
    // Bound, and nothing of it read: a group is a name, not a boundary,
    // so there is nothing to ask the store – an entity bound like this
    // used to read any type under its tag.
    addDefinition('command-definition', id, 'Tick', {
      properties: [{ name: 'counterId', propertyType: 'CounterId', isOptional: false, isList: false }],
      boundary: [{ alias: 'counter', group: 'Counter', tags: { counterId: { parameterName: 'counterId' } } }],
      conditions: [],
      publishes: [{ name: 'Ticked', parameters: { counterId: { parameterName: 'counterId' } } }],
    });
    eq(sandbox.commandPlan(sandbox.boundarySummary(model(), model()['command-definitions'].Tick)).calls, [], 'no call');
    eq(sandbox.modelAdvisories(model()).some((a) => a.name === 'Tick' && /Reads nothing consults: counter/.test(a.message)),
      true, 'and the read is advised as one nothing consults');
  });

  check('a projection\'s plan is the reads its fold makes: a call each, of the types planned', () => {
    let compared = 0;
    for (const { name, model } of modelsWithScenarios()) {
      for (const scenario of Object.values(model['projection-scenario-definitions'] || {})) {
        const plan = sandbox.projectionPlan(model, scenario.projection);
        const params = { ...(scenario.arguments || {}) };
        for (const [tag, value] of Object.entries(scenario.tags || {})) params[tag] = value && value.tagValue;
        const trace = [];
        const outcome = projectFromStore(model, storeOf(model, sandbox.scenarioLog(scenario)), scenario.projection, params, { trace });
        if (outcome.outcome !== 'projected') continue;
        const reads = trace.filter((entry) => entry.call === 'read');
        const sorted = (types) => [...types].sort();
        eq(reads.map((entry) => entry.query.map((item) => sorted(item.types))), plan.calls.map((call) => call.map((item) => sorted(item.types))),
          `${name}: ${scenario.projection}`);
        compared++;
      }
    }
    eq(compared > 10, true, `${compared} projection scenarios compared`);
  });

  const simple = () => {
    const model = build(PREDEFINED_INDEX('course-simple'));
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 10 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    return { model, log };
  };

  check('reads that hang off the arguments are one read, no head, and the append comes after the last position read', () => {
    const { model, log } = simple();
    const store = storeOf(model, log);
    const trace = [];
    const outcome = handleCommand(model, store, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' }, { trace });
    eq([outcome.outcome, outcome.position], ['published', 3], 'published at 3');
    eq(outcome.events[0].tags, ['CourseId:c1', 'StudentId:s1'], 'tagged from the model');
    eq(calls(trace), ['read', 'append'], 'one read, one append');
    eq(trace[0].events.map((e) => e.position), [1, 2], 'what the read answered, with positions');
    eq(trace[1].condition, { failIfEventsMatch: trace[0].query, after: 2 }, 'the condition: what was read, after it');
    eq(trace[1].position, 3, 'and where it landed');
  });

  check('an append that lost the race is a conflict, and deciding again sees what won', () => {
    const { model } = simple();
    const store = memoryStore();
    const contested = racing(store, (n) => { if (n === 1) store.push(stored(model, 'CourseDefined', { courseId: 'c1', capacity: 5 })); });
    const trace = [];
    const first = handleCommand(model, contested, 'DefineCourse', { courseId: 'c1', capacity: 10 }, { trace });
    eq(first.outcome, 'conflict', 'conflict');
    eq(trace[trace.length - 1].integrity, true, 'the append said so');
    eq(store.events.length, 1, 'nothing of ours appended');
    const second = handleCommand(model, store, 'DefineCourse', { courseId: 'c1', capacity: 10 });
    eq([second.outcome, second.failedRule.rejection], ['rejected', 'Course already exists'], 'the second attempt is refused');
  });

  check('a command that publishes nothing appends nothing, and a failing store says at which call', () => {
    const { model, log } = simple();
    const store = storeOf(model, log);
    eq(handleCommand(model, store, 'DefineCourse', { courseId: 'c1', capacity: 10 }).outcome, 'rejected', 'rejected');
    eq(store.events.length, log.length, 'no append');
    for (const failing of ['read', 'append']) {
      const broken = { ...memoryStore(), [failing]: () => { throw new Error('unavailable'); } };
      const trace = [];
      const outcome = handleCommand(model, broken, 'DefineCourse', { courseId: 'c2', capacity: 1 }, { trace });
      eq([outcome.outcome, outcome.message], ['store', `${failing}: unavailable`], failing);
      eq(trace[trace.length - 1].failed, 'unavailable', `${failing} – traced`);
    }
    eq(handleCommand(model, memoryStore(), 'Nope', {}).outcome, 'error', 'no such command');
  });

  const scheduled = () => {
    const model = openSchedules().model();
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 9, slots: ['2026-03-01T09'] });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 9, slots: ['2026-03-01T11'] });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    drive(model, log, 'SubscribeStudentToCourse', { courseId: 'c2', studentId: 's1' });
    return { model, log };
  };

  check('a chained boundary takes head first, reads once per link, and appends after head', () => {
    const { model, log } = scheduled();
    const trace = [];
    const outcome = handleCommand(model, storeOf(model, log), 'RescheduleCourse', { courseId: 'c1', slots: ['2026-03-01T13'] }, { trace });
    eq(outcome.outcome, 'published', 'published');
    eq(calls(trace), ['head', 'read', 'read', 'read', 'append'], 'head, three reads, the append');
    eq(trace[4].condition.after, log.length, 'after head');
    eq(trace[4].condition.failIfEventsMatch.length, 3, 'covering every read');
  });

  check('an event matching the first read is not lost below a later read\'s answer', () => {
    const { model, log } = scheduled();
    const store = storeOf(model, log);
    // While c1 is read, s2 subscribes to c1 – which the first read
    // covers – and then c2 is rescheduled, which the third read returns.
    // An `after` taken from the reads would sit above the subscription.
    const contested = racing(store, (n) => {
      if (n !== 1) return;
      store.push(stored(model, 'StudentSubscribedToCourse', { courseId: 'c1', studentId: 's2' }));
      store.push(stored(model, 'CourseRescheduled', { courseId: 'c2', slots: ['2026-03-01T11'] }));
    });
    eq(handleCommand(model, contested, 'RescheduleCourse', { courseId: 'c1', slots: ['2026-03-01T13'] }).outcome,
      'conflict', 'refused, not appended over the subscription');
    eq(handleCommand(model, store, 'RescheduleCourse', { courseId: 'c1', slots: ['2026-03-01T13'] }).outcome,
      'published', 'and decided again');
  });

  // course-tenant, and a command whose inline read is tagged by an
  // alias's value: a query the chain of aliases alone does not count.
  const nextCourse = () => {
    const { id, model } = open_(PREDEFINED_INDEX('course-tenant'));
    addDefinition('command-definition', id, 'DefineNextCourse', {
      properties: [
        { name: 'tenantId', propertyType: 'TenantId', isOptional: false, isList: false },
        { name: 'capacity', propertyType: 'integer', isOptional: false, isList: false },
      ],
      boundary: [
        { alias: 'next', projection: 'CourseNumbering' },
        { alias: 'number', projection: 'TenantCourseNumbering', tags: { tenantId: { parameterName: 'tenantId' } } },
      ],
      conditions: [{
        leftHandSide: { projection: 'CourseStatus', tags: { courseId: { alias: 'next' } } },
        predicate: 'equals', rightHandSide: { enumMember: 'NonExistent' }, rejection: 'That course exists',
      }],
      publishes: [{ name: 'CourseDefined', parameters: {
        courseId: { alias: 'next' }, capacity: { parameterName: 'capacity' },
        tenantId: { parameterName: 'tenantId' }, courseNumber: { alias: 'number' },
      } }],
    });
    const m = model();
    eq(sandbox.deriveRounds(m['command-definitions'].DefineNextCourse).length, 1, 'one level of aliases');
    // With c1 defined, the dry run's first guess – the numbering's
    // initial "c1" – is wrong, so CourseStatus is asked a second time.
    const store = memoryStore([
      stored(m, 'TenantRegistered', { tenantId: 't1' }),
      stored(m, 'CourseDefined', { tenantId: 't1', courseId: 'c1', capacity: 5, courseNumber: '1' }),
    ]);
    return { model: m, store };
  };

  check('an inline read tagged by an alias is a second query, so head comes first', () => {
    const { model, store } = nextCourse();
    const trace = [];
    const outcome = handleCommand(model, store, 'DefineNextCourse', { tenantId: 't1', capacity: 5 }, { trace });
    eq(outcome.outcome, 'published', 'published');
    eq(outcome.events[0].data.courseId, 'c2', 'the next course');
    eq(calls(trace), ['head', 'read', 'read', 'append'], 'no restart');
    eq(trace[3].condition.after, 2, 'after head');
  });

  check('a second read nobody planned for restarts the decision with head', () => {
    const { model, store } = nextCourse();
    // Should the planned count ever fall short, the cycle must still not
    // take `after` from the reads.
    const planned = sandbox.boundarySummary;
    sandbox.boundarySummary = (...args) => ({ ...planned(...args), queries: [[]] });
    const trace = [];
    let outcome;
    try {
      outcome = handleCommand(model, store, 'DefineNextCourse', { tenantId: 't1', capacity: 5 }, { trace });
    } finally {
      sandbox.boundarySummary = planned;
    }
    eq(outcome.outcome, 'published', 'published');
    eq(calls(trace), ['read', 'restart:head', 'head', 'read', 'read', 'append'], 'restarted with head');
    eq(trace[5].condition.after, 2, 'after head, not after the reads');
  });

  check('a projection is one read, no head, at the last position it folds', () => {
    const { model, log } = simple();
    drive(model, log, 'ChangeCourseCapacity', { courseId: 'c1', newCapacity: 12 });
    drive(model, log, 'DefineCourse', { courseId: 'c2', capacity: 5 });
    const trace = [];
    eq(projectFromStore(model, storeOf(model, log), 'CourseCapacity', { courseId: 'c1' }, { trace }),
      { outcome: 'projected', value: 12, position: 3 }, 'value and position');
    eq(calls(trace), ['read'], 'one read');
    eq(projectFromStore(model, memoryStore(), 'CourseCapacity', { courseId: 'c1' }),
      { outcome: 'projected', value: 0, position: undefined }, 'folding nothing is at no position');
    eq(projectFromStore(model, memoryStore(), 'Nope', {}).outcome, 'error', 'no such projection');
  });

  check('a derived projection takes head and folds nothing after it', () => {
    const { model } = modelsWithScenarios().find((m) => m.name === 'content-decisions-derived.dcb.json');
    const store = memoryStore([
      stored(model, 'DocumentAdded', { id: 'd1' }),
      stored(model, 'TextUpdated', { docId: 'd1', text: 'a' }),
    ]);
    // While the current text is read, the document is published: the
    // published text, read next, would be newer than the current one.
    const contested = racing(store, (n) => { if (n === 1) store.push(stored(model, 'DocumentPublished', { docId: 'd1', text: 'a' })); });
    const trace = [];
    eq(projectFromStore(model, contested, 'DocumentHasPendingChanges', { documentId: 'd1' }, { trace }),
      { outcome: 'projected', value: true, position: 2 }, 'as of head');
    eq(calls(trace)[0], 'head', 'head first');
  });
}

// ---------------------------------------------------------------
// Value schemas: what a command accepts and an event carries, as JSON
// Schema. Checked by validating every scenario's arguments, and every
// event the evaluator publishes for it, against them – with a validator
// for the keywords the generator writes and the shipped types use, as
// this suite takes no dependency.
// ---------------------------------------------------------------
{
  const errorsOf = (schema, value, defs, at = '$') => {
    if (schema.$ref) return errorsOf(defs[schema.$ref.split('/').pop()], value, defs, at);
    if (schema.anyOf) {
      return schema.anyOf.some((s) => !errorsOf(s, value, defs, at).length) ? [] : [`${at}: matches no alternative`];
    }
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array'
      : Number.isInteger(value) ? 'integer' : typeof value;
    if (schema.type && schema.type !== kind && !(schema.type === 'number' && kind === 'integer')) {
      return [`${at}: ${kind}, not ${schema.type}`];
    }
    if (schema.enum && !schema.enum.some((m) => JSON.stringify(m) === JSON.stringify(value))) return [`${at}: not a member`];
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return [`${at}: does not match ${schema.pattern}`];
    if (schema.minimum !== undefined && value < schema.minimum) return [`${at}: below ${schema.minimum}`];
    if (kind === 'array' && schema.items) return value.flatMap((v, i) => errorsOf(schema.items, v, defs, `${at}[${i}]`));
    if (kind === 'object' && schema.properties) {
      return [
        ...(schema.required || []).filter((k) => !(k in value)).map((k) => `${at}.${k}: missing`),
        ...Object.keys(value).filter((k) => !(k in schema.properties)).map((k) => `${at}.${k}: not declared`),
        ...Object.entries(value).filter(([k]) => k in schema.properties)
          .flatMap(([k, v]) => errorsOf(schema.properties[k], v, defs, `${at}.${k}`)),
      ];
    }
    return [];
  };
  const refOf = (typeName) => ({ $ref: `#/components/schemas/${typeName}` });

  check('every scenario\'s arguments and published events fit their schemas', () => {
    let checked = 0;
    for (const { name, model } of modelsWithScenarios()) {
      const defs = sandbox.customTypeSchemas(model, refOf);
      for (const scenario of Object.values(model['scenario-definitions'] || {})) {
        const args = (scenario.when && scenario.when.arguments) || {};
        eq(errorsOf(sandbox.commandArgumentsSchema(model, scenario.command, refOf), args, defs), [],
          `${name}: ${scenario.name} – arguments`);
        let result = null;
        try { result = evaluateCommand(model, sandbox.scenarioLog(scenario), scenario.command, args); } catch (e) { /* broken */ }
        for (const event of (result && result.events) || []) {
          eq(errorsOf(sandbox.eventPayloadSchema(model, event.type, refOf), event.data, defs), [],
            `${name}: ${scenario.name} – ${event.type}`);
        }
        checked++;
      }
    }
    eq(checked > 50, true, `${checked} scenarios checked`);
  });

  check('a command\'s schema is closed, and an optional argument may be left out or null', () => {
    const model = build(PREDEFINED_INDEX('course-simple'));
    const defs = sandbox.customTypeSchemas(model, refOf);
    const schema = sandbox.commandArgumentsSchema(model, 'DefineCourse', refOf);
    eq(schema.additionalProperties, false, 'closed');
    eq(errorsOf(schema, { courseId: 'c1', capacity: 2, capacityy: 3 }, defs), ['$.capacityy: not declared'], 'a misspelt key');
    eq(errorsOf(schema, { courseId: 'c1' }, defs), ['$.capacity: missing'], 'a required one missing');
    const optional = { name: 'note', propertyType: 'string', isOptional: true };
    const withOptional = sandbox.propertiesSchema(model, [optional]);
    eq([errorsOf(withOptional, {}, {}), errorsOf(withOptional, { note: null }, {})], [[], []], 'absent or null');
    eq(sandbox.propertiesSchema(model, [optional], undefined, { requireAll: true }).required, ['note'],
      'but an event always spells it out');
  });

  check('a custom type is its own schema, a composite its fields', () => {
    const model = build(SEQUENCE);
    const types = model['custom-type-definitions'];
    const scalar = Object.keys(types).find((t) => types[t].schema && types[t].schema.pattern);
    eq(sandbox.customTypeSchema(model, scalar), types[scalar].schema, `${scalar} carried over whole`);
    const cart = build(PREDEFINED_INDEX('pricing-simple'));
    const composite = Object.keys(cart['custom-type-definitions'])
      .find((t) => Array.isArray(cart['custom-type-definitions'][t].properties));
    const schema = sandbox.customTypeSchema(cart, composite);
    eq([schema.type, schema.additionalProperties, schema.required.length],
      ['object', false, cart['custom-type-definitions'][composite].properties.length], `${composite} as an object`);
    eq(sandbox.valueTypeSchema(cart, 'NoSuchType'), {}, 'an unresolved type allows anything');
  });
}

// ---------------------------------------------------------------
// Groups (11.0).
//
// A group owns projections that share its one tag; it is a name, not a
// boundary. Reading `course.capacity` reads that projection and
// nothing else, a projection moves in and out with every read of it
// rewritten, and a document from before 11.0 has its entities lifted
// into groups where that says the same thing.
// ---------------------------------------------------------------
{
  check('a grouped name is local inside the group and qualified outside', () => {
    eq(sandbox.groupLocalName('Course', 'CourseCapacity'), 'capacity', 'the group\'s name dropped where it leads');
    eq(sandbox.groupLocalName('Course', 'SubscriptionCount'), 'subscriptionCount', 'lowered either way');
    eq(sandbox.groupLocalName('Course', 'Coursework'), 'coursework', 'only a whole word is dropped');
    eq(sandbox.ungroupedProjectionName('Course', 'capacity'), 'CourseCapacity', 'and back');
    eq(sandbox.operandText({ projection: 'Course.capacity', tags: { courseId: { parameterName: 'courseId' } } }),
      'Course(courseId).capacity', 'a read in place, spelled through its group');
    eq(sandbox.operandText({ alias: 'course', property: 'seatsOn', arguments: { slot: { parameterName: 's' } } }),
      'course.seatsOn(s)', 'a member read with its own arguments');
  });

  check('an empty group is legal, and advised', () => {
    const { id, model } = openBlank('Empty');
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' }, { icon: '📚' });
    eq(model()['custom-type-definitions'].CourseId, { schema: { type: 'string' }, isTag: true },
      'a tag type named for the first time is created alongside it');
    eq(model()['group-definitions'].Course, { icon: '📚', tag: { name: 'courseId', tagType: 'CourseId' }, projections: [] },
      'stored');
    eq(sandbox.modelAdvisories(model()).map((a) => [a.kind, a.name, /no projections yet/.test(a.message)]),
      [['group-definition', 'Course', true]], 'one advisory: it is empty');
    eq(sandbox.experimentalFeatures(model()), [], 'and nothing experimental');
  });

  check('a group and a top-level projection share one namespace', () => {
    const { id, model } = open_(SIMPLE);
    const refused = (fn) => { try { fn(); return ''; } catch (error) { return error.message; } };
    eq(/already exists/.test(refused(() => sandbox.createGroup(id, 'CourseStatus', { name: 'courseId', tagType: 'CourseId' }))),
      true, 'a group named like a projection');
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    eq(/already exists/.test(refused(() => addDefinition('projection-definition', id, 'Course',
      { tags: [], valueType: 'integer', isList: false, initialValue: 0, handlers: [] }))), true, 'a projection named like a group');
    eq(/already exists/.test(refused(() => renameDefinition('projection-definition', id, 'CourseStatus', 'Course'))),
      true, 'a projection renamed into a group\'s name');
    eq(/already exists/.test(refused(() => renameDefinition('group-definition', id, 'Course', 'CourseCapacity'))),
      true, 'a group renamed into a projection\'s name');
    const imported = deepClone(buildShareEnvelope(model(), []));
    imported.projectionDefinitions.push({ ...imported.projectionDefinitions[0], name: 'Course' });
    const { skipped } = importModelFromEnvelope(imported);
    eq(skipped.map((s) => [s.kind, s.name]), [['projection-definition', 'Course']], 'and on import the second is skipped');
    const collections = {};
    for (const kind of ['group-definition', 'event-definition', 'projection-definition', 'command-definition', 'custom-type-definition']) {
      collections[kind] = deepClone(model()[sandbox.DEF_COLLECTIONS[kind]]);
    }
    collections['projection-definition'].Course = collections['projection-definition'].CourseStatus;
    eq(/both named "Course"/.test(refused(() => sandbox.replaceDefinitions(id, { collections }))), true,
      'and a text naming both is refused whole');
  });

  check('moving a projection in drops its tag, names it locally and rewrites every read', () => {
    const { id, model } = open_(PREDEFINED_INDEX('content-decisions-derived'));
    sandbox.createGroup(id, 'Document', { name: 'docId', tagType: 'DocumentId' });
    // Tagged `documentId`, moved into a group whose tag is `docId`: the
    // tag goes, and every read keyed by the old name is keyed by the new.
    eq(sandbox.groupsAccepting(model(), 'DocumentCurrentText'), ['Document'], 'offered where the tag type matches');
    eq(sandbox.moveProjectionIntoGroup(id, 'DocumentCurrentText', 'Document'), 'Document.currentText', 'named locally');
    const inner = model()['group-definitions'].Document.projections[0];
    eq([inner.name, inner.tags], ['currentText', undefined], 'no tag of its own');
    eq('DocumentCurrentText' in model()['projection-definitions'], false, 'gone from the top level');
    // A read in place is said through an alias of the group, named off
    // the value it is read by – not `Document(docId).currentText` in
    // front of every rule.
    eq(model()['command-definitions'].UpdateText.conditions[1].leftHandSide,
      { alias: 'doc', property: 'currentText' }, 'a read in place, through an alias of the group');
    const docAlias = { alias: 'doc', group: 'Document', tags: { docId: { parameterName: 'docId' } } };
    eq(model()['command-definitions'].UpdateText.boundary.filter((b) => b.group), [docAlias], 'bound once');
    eq(model()['projection-definitions'].DocumentHasPendingChanges.derived.leftHandSide,
      { projection: 'Document.currentText', tags: { docId: { parameterName: 'documentId' } } }, 'a derived operand outside');
    eq(sandbox.modelAdvisories(model()), [], 'advisory-clean');

    // The derived one moved in too reads its sibling bare, and its own
    // tag reference follows the group's name.
    sandbox.moveProjectionIntoGroup(id, 'DocumentPublishedText', 'Document');
    sandbox.moveProjectionIntoGroup(id, 'DocumentHasPendingChanges', 'Document');
    const pending = model()['group-definitions'].Document.projections.find((p) => p.name === 'hasPendingChanges');
    eq(pending.derived.leftHandSide, { projection: 'currentText' }, 'a sibling, by local name');
    eq(pending.derived.rightHandSide, { projection: 'publishedText' }, 'both sides');
    eq(model()['command-definitions'].UpdateText.boundary.filter((b) => b.group), [docAlias],
      'the commands\' reads of the later ones gathered under the same alias');
    eq(sandbox.modelAdvisories(model()), [], 'still clean');
    const log = [{ type: 'DocumentAdded', data: { id: 'd1' } }, { type: 'TextUpdated', data: { docId: 'd1', text: 'a' } }];
    eq(foldMember(model(), log, 'Document', 'hasPendingChanges', 'd1'), true, 'and it derives as before');
    eq(evaluateCommand(model(), log, 'PublishDocument', { docId: 'd1' }).outcome, 'published', 'and commands decide as before');
  });

  check('a projection whose tag does not match is not moved in', () => {
    const { id } = open_(SIMPLE);
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    let message = '';
    try { sandbox.moveProjectionIntoGroup(id, 'StudentExists', 'Course'); } catch (error) { message = error.message; }
    eq(/only a projection tagged by exactly that moves in/.test(message), true, message);
    sandbox.moveProjectionIntoGroup(id, 'CourseStatus', 'Course');
    message = '';
    try { sandbox.moveProjectionIntoGroup(id, 'CourseCapacity', 'Course', 'status'); } catch (error) { message = error.message; }
    eq(/already has a projection named "status"/.test(message), true, message);
  });

  check('moving every projection in and out again is the model it was', () => {
    const { id, model } = open_(SEQUENCE);
    const before = definitionsToSchema(model());
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    for (const name of ['CourseStatus', 'CourseCapacity', 'CourseSubscriptionCount', 'CourseSubscribedStudentIds']) {
      sandbox.moveProjectionIntoGroup(id, name, 'Course');
    }
    eq(sandbox.modelAdvisories(model()), [], 'clean in a group');
    for (const local of ['status', 'capacity', 'subscriptionCount', 'subscribedStudentIds']) {
      sandbox.moveProjectionOutOfGroup(id, `Course.${local}`);
    }
    removeDefinition('group-definition', id, 'Course');
    const after = definitionsToSchema(model());
    eq(after.commandDefinitions, before.commandDefinitions, 'every read where it was');
    eq(after.projectionDefinitions.map((p) => p.name).sort(), before.projectionDefinitions.map((p) => p.name).sort(),
      'every projection back under its name');
    eq(after.projectionDefinitions.find((p) => p.name === 'CourseCapacity').tags, [{ name: 'courseId', tagType: 'CourseId' }],
      'its tag restored');
  });

  check('moving a projection out turns a member read into the read it stood for', () => {
    const { id, model } = open_(GROUPED);
    eq(sandbox.moveProjectionOutOfGroup(id, 'Student.subscriptionCount'), 'StudentSubscriptionCount', 'named from its group');
    const subscribe = model()['command-definitions'].SubscribeStudentToCourse;
    eq(subscribe.conditions.find((c) => c.rejection === 'Student is subscribed to too many courses').leftHandSide,
      { projection: 'StudentSubscriptionCount', tags: { studentId: { parameterName: 'studentId' } } }, 'read in place');
    eq(subscribe.boundary.some((b) => b.alias === 'student'), true, 'the group binding stays while a rule still reads it');
    sandbox.moveProjectionOutOfGroup(id, 'Student.exists');
    eq(model()['command-definitions'].SubscribeStudentToCourse.boundary.some((b) => b.alias === 'student'), false,
      'and goes with the last member it was read for');
    eq(sandbox.modelAdvisories(model()).filter((a) => a.kind !== 'group-definition'), [], 'clean');
    const log = [];
    drive(model(), log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    drive(model(), log, 'RegisterStudent', { studentId: 's1' });
    drive(model(), log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    eq(foldProjection(model(), log, 'StudentSubscriptionCount', { tags: { studentId: 's1' } }), 1, 'and folds');
  });

  check('renaming a group moves its bindings and every qualified read', () => {
    const { id, model } = open_(GROUPED);
    const body = deepClone(model()['command-definitions'].ArchiveCourse);
    body.conditions.push({ leftHandSide: { projection: 'Course.capacity', tags: { courseId: { parameterName: 'courseId' } } },
      predicate: 'greaterThan', rightHandSide: 0, rejection: 'No seats' });
    updateDefinition('command-definition', id, 'ArchiveCourse', body);
    renameDefinition('group-definition', id, 'Course', 'Lecture');
    const archive = model()['command-definitions'].ArchiveCourse;
    eq(archive.boundary[0].group, 'Lecture', 'the binding');
    eq(archive.conditions[1].leftHandSide.projection, 'Lecture.capacity', 'the read in place');
    eq(sandbox.modelAdvisories(model()), [], 'nothing dangles');
  });

  check('a member takes its own arguments, and each is its own read', () => {
    const { id, model } = open_(GROUPED);
    addDefinition('projection-definition', id, 'Course.hasRoomFor', {
      arguments: [{ name: 'seats', propertyType: 'integer' }],
      valueType: 'boolean', isList: false,
      derived: { leftHandSide: { projection: 'free' }, predicate: 'greaterThanOrEquals', rightHandSide: { parameterName: 'seats' } },
    });
    addDefinition('projection-definition', id, 'Course.free', {
      valueType: 'integer', isList: false,
      derived: { leftHandSide: { projection: 'capacity' }, operator: 'subtract', rightHandSide: { projection: 'subscriptionCount' } },
    });
    const body = deepClone(model()['command-definitions'].SubscribeStudentToCourse);
    body.conditions = body.conditions.filter((c) => c.rejection !== 'Course is full');
    body.conditions.push({ leftHandSide: { alias: 'course', property: 'hasRoomFor', arguments: { seats: 1 } },
      predicate: 'isTrue', rejection: 'Course is full' });
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', body);
    eq(sandbox.modelAdvisories(model()), [], 'clean');
    const log = [];
    drive(model(), log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    drive(model(), log, 'RegisterStudent', { studentId: 's1' });
    drive(model(), log, 'RegisterStudent', { studentId: 's2' });
    drive(model(), log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' });
    const refused = evaluateCommand(model(), log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's2' });
    eq([refused.outcome, refused.failedRule.text], ['rejected', 'course.hasRoomFor(1) isTrue'], 'refused by it');
    eq(refused.reads.course.instances[0].properties['hasRoomFor(1)'], false, 'reported under its arguments');
    const types = sandbox.deriveDcb(model(), model()['command-definitions'].SubscribeStudentToCourse).items
      .find((item) => item.alias === 'course').types;
    eq(types.includes('CourseCapacityChanged'), true, 'its siblings\' events are in the query');

    const missing = deepClone(body);
    delete missing.conditions[missing.conditions.length - 1].leftHandSide.arguments;
    updateDefinition('command-definition', id, 'SubscribeStudentToCourse', missing);
    eq(sandbox.modelAdvisories(model()).some((a) => /without "seats", which it takes as an argument/.test(a.message)), true,
      'a member read without its argument is advised');
  });

  check('moving in folds a command\'s reads into aliases of the group, as one would write them', () => {
    const { id, model } = open_(PREDEFINED_INDEX('course-simple'));
    const byCourse = () => ({ courseId: { parameterName: 'courseId' } });
    sandbox.addDefinition('command-definition', id, 'Probe', {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'course', propertyType: 'string', isOptional: false, isList: false },
        { name: 'courseIds', propertyType: 'CourseId', isOptional: false, isList: true },
      ],
      boundary: [
        { alias: 'cap', projection: 'CourseCapacity', tags: byCourse() },
        { alias: 'maybe', projection: 'CourseStatus', tags: byCourse(), isOptional: true },
      ],
      conditions: [
        { leftHandSide: { alias: 'cap' }, predicate: 'lessThan', rightHandSide: 100, rejection: 'a' },
        { leftHandSide: { alias: 'maybe' }, predicate: 'equals', rightHandSide: { enumMember: 'Existent' }, rejection: 'b' },
        { leftHandSide: { projection: 'CourseSubscriptionCount', tags: byCourse() }, predicate: 'lessThan',
          rightHandSide: 10, rejection: 'c' },
        { leftHandSide: { projection: 'CourseSubscriptionCount', tags: { courseId: { each: { parameterName: 'courseIds' } } } },
          predicate: 'lessThan', rightHandSide: 10, rejection: 'd' },
      ],
      publishes: [],
    });
    sandbox.createGroup(id, 'Course', { name: 'courseId', tagType: 'CourseId' });
    for (const name of ['CourseCapacity', 'CourseStatus', 'CourseSubscriptionCount']) sandbox.moveProjectionIntoGroup(id, name, 'Course');
    const probe = model()['command-definitions'].Probe;
    // `course` is a payload property, so the alias is numbered past it.
    eq(probe.boundary, [
      { alias: 'course2', group: 'Course', tags: byCourse() },
      { alias: 'course3', group: 'Course', tags: byCourse(), isOptional: true },
      { alias: 'courses', group: 'Course', tags: { courseId: { each: { parameterName: 'courseIds' } } } },
    ], 'an alias of the projection folds into one of the group, an optional one kept apart, a fan-out named off its list');
    eq(probe.conditions.map((c) => c.leftHandSide), [
      { alias: 'course2', property: 'capacity' },
      { alias: 'course3', property: 'status' },
      { alias: 'course2', property: 'subscriptionCount' },
      { alias: 'courses', property: 'subscriptionCount' },
    ], 'every use a member read; a read in place reuses the alias with the same tags');
    eq(sandbox.aliasBaseFor('Course', { courseId: { parameterName: 'otherCourseId' } }), 'otherCourse', 'named off the value');
    eq(sandbox.aliasBaseFor('Course', { courseId: { tagType: 'CourseId', tagValue: 'c1' } }), 'course', 'or the group');
    eq(sandbox.aliasBaseFor('Course', { courseId: { each: { alias: 'student', property: 'subscribedCourseIds' } } }),
      'subscribedCourses', 'a fan-out off its list');
  });

  check('a 10.x entity becomes a group where every projection it binds is its own', () => {
    resetStore();
    const envelope = legacyEnvelope();
    // A read in place of a bound projection, and a scenario about one:
    // both are rewritten to go through the group.
    envelope.commandDefinitions.find((c) => c.name === 'ArchiveCourse').conditions.push({
      leftHandSide: { projection: 'CourseCapacity', tags: { courseId: { parameterName: 'courseId' } } },
      predicate: 'greaterThan', rightHandSide: 0, rejection: 'No seats' });
    envelope.projectionScenarioDefinitions = [{ id: 'cap', projection: 'CourseCapacity',
      tags: { courseId: { tagType: 'CourseId', tagValue: 'c1' } }, given: [], then: 0 }];
    resetStore();
    const { modelId, skipped, converted } = importModelFromEnvelope(envelope);
    const model = sandbox.projectState()[modelId];
    eq(skipped, [], 'nothing skipped');
    eq(converted.map((c) => c.note), ['Entity Student became the group Student.', 'Entity Course became the group Course.'],
      'what became of each entity');
    eq(Object.keys(model['projection-definitions']), [], 'every projection moved into its group');
    eq(model['group-definitions'].Course.projections.map((p) => p.name),
      ['status', 'capacity', 'subscriptionCount', 'subscribedStudentIds'], 'under the names it bound them by');
    eq([model['group-definitions'].Course.icon, model['group-definitions'].Course.tag], ['📚', { name: 'courseId', tagType: 'CourseId' }],
      'its icon kept, its tag its identifier\'s');
    eq(model['command-definitions'].ArchiveCourse.boundary, [{ alias: 'course', group: 'Course', tags: { courseId: { parameterName: 'courseId' } } }],
      'an entity binding is a group binding');
    eq(model['command-definitions'].ArchiveCourse.conditions[1].leftHandSide, { alias: 'course', property: 'capacity' },
      'a read in place, through the alias the entity was read by');
    eq(model['projection-scenario-definitions'].cap.projection, 'Course.capacity', 'a scenario');
    eq(sandbox.modelAdvisories(model), [], 'advisory-clean');
    eq(sandbox.experimentalFeatures(model), [], 'and nothing experimental is left');
  });

  check('a 10.x entity that would not say the same as a group is restated as plain reads', () => {
    // Course binds `CourseCapacity`, and so does Lecture: one projection
    // cannot be owned by two groups.
    const entities = { ...LEGACY_ENTITIES,
      Lecture: { icon: '🎓', identifierType: 'CourseId', properties: [['seats', 'CourseCapacity']] } };
    const envelope = legacyEnvelope(SIMPLE, entities);
    const subscribe = envelope.commandDefinitions.find((c) => c.name === 'SubscribeStudentToCourse');
    subscribe.boundary.push({ alias: 'lecture', entity: 'Lecture', id: { parameterName: 'courseId' } });
    subscribe.conditions.push({ leftHandSide: { alias: 'lecture', property: 'seats' }, predicate: 'greaterThan',
      rightHandSide: 0, rejection: 'No seats' });
    resetStore();
    const { modelId, converted } = importModelFromEnvelope(envelope);
    const model = sandbox.projectState()[modelId];
    eq(converted.map((c) => c.note), [
      'Entity Student became the group Student.',
      'Entity Course was restated as plain reads – CourseCapacity is bound more than once.',
      'Entity Lecture was restated as plain reads – CourseCapacity is bound more than once.',
    ], 'said, with the reason');
    eq(Object.keys(model['group-definitions']), ['Student'], 'only the clean one is a group');
    const body = model['command-definitions'].SubscribeStudentToCourse;
    eq(body.boundary.map((b) => b.alias), ['student'], 'the restated bindings are gone');
    eq(body.conditions[0].leftHandSide, { projection: 'CourseStatus', tags: { courseId: { parameterName: 'courseId' } } },
      'a property read is the read in place it stood for');
    eq(body.conditions[1].leftHandSide, { alias: 'student', property: 'exists' }, 'a clean group\'s read stays a member read');
    eq(sandbox.modelAdvisories(model), [], 'advisory-clean');
    const log = [];
    drive(model, log, 'DefineCourse', { courseId: 'c1', capacity: 1 });
    drive(model, log, 'RegisterStudent', { studentId: 's1' });
    eq(evaluateCommand(model, log, 'SubscribeStudentToCourse', { courseId: 'c1', studentId: 's1' }).outcome, 'published',
      'and it decides as it did');
  });

  check('a 10.x excluding is dropped on import, and said', () => {
    const envelope = legacyEnvelope();
    const course = envelope.commandDefinitions.find((c) => c.name === 'SubscribeStudentToCourse');
    course.boundary.push({ alias: 'others', entity: 'Course', id: { each: { parameterName: 'courseIds' } },
      excluding: { parameterName: 'courseId' } });
    course.properties.push({ name: 'courseIds', propertyType: 'CourseId', isOptional: false, isList: true });
    course.conditions.push({ leftHandSide: { alias: 'others', property: 'status' }, predicate: 'equals',
      rightHandSide: { enumMember: 'Existent' }, rejection: 'Another course is not active' });
    resetStore();
    const { modelId, converted } = importModelFromEnvelope(envelope);
    const model = sandbox.projectState()[modelId];
    eq(converted.some((c) => c.name === 'SubscribeStudentToCourse' && /"others" excluded courseId/.test(c.note)), true,
      'the note says what was dropped');
    eq(model['command-definitions'].SubscribeStudentToCourse.boundary.find((b) => b.alias === 'others'),
      { alias: 'others', group: 'Course', tags: { courseId: { each: { parameterName: 'courseIds' } } } }, 'a fanned group binding');
    eq(sandbox.modelAdvisories(model), [], 'advisory-clean');
  });

  check('a 10.x derived projection bound by an entity reads its siblings bare once lifted', () => {
    const entities = { Document: { icon: '📄', lifecycle: 'status', properties: [
      ['status', 'DocumentLifecycle'], ['currentText', 'DocumentCurrentText'], ['publishedText', 'DocumentPublishedText'],
      ['hasPendingChanges', 'DocumentHasPendingChanges']] } };
    const envelope = legacyEnvelope(PREDEFINED_INDEX('content-decisions-derived'), entities);
    resetStore();
    const { modelId } = importModelFromEnvelope(envelope);
    const model = sandbox.projectState()[modelId];
    const pending = model['group-definitions'].Document.projections.find((p) => p.name === 'hasPendingChanges');
    eq([pending.derived.leftHandSide, pending.derived.rightHandSide],
      [{ projection: 'currentText' }, { projection: 'publishedText' }], 'siblings, by local name');
    eq(sandbox.modelAdvisories(model), [], 'advisory-clean');
    const log = [{ type: 'DocumentAdded', data: { id: 'd1' } }];
    eq(evaluateCommand(model, log, 'PublishDocument', { docId: 'd1' }).outcome, 'published', 'it decides');
    eq(foldMember(model, log, 'Document', 'hasPendingChanges', 'd1'), true, 'and derives');
  });
}

finish();
