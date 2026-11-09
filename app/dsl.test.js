// ============================================================
// DCB Playground – code view language tests.
//
// `dsl.js` claims two things, and this holds it to both: that the text
// it prints says everything the model does (print, parse, compare –
// for every shipped model and every fixture file, with no definition
// falling back to JSON), and that applying a text writes exactly the
// difference, as one append. The rest pins down the grammar's
// spellings, its diagnostics, the JSON fallback that keeps printing
// lossless for bodies the grammar cannot say, and the language service
// over it: every name resolving to the one thing it means, a rename
// that is exact or refused, and completion that knows the cursor.
//
// Run with `node app/dsl.test.js`.
// ============================================================
const fs = require('fs');
const path = require('path');
const { createSandbox, loadApp, makeChecker, swap } = require('./test-harness.js');

const APP = __dirname;
// Models with scenarios authored in the playground, which no seed
// builder produces – test data only, kept outside app/ so none of it
// is served.
const FIXTURES = path.join(APP, '..', 'fixtures');
const { sandbox, store } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js', 'dsl.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS; globalThis.SOURCE_KINDS = SOURCE_KINDS;'
    + ' globalThis.DEF_COLLECTIONS = DEF_COLLECTIONS; globalThis.DomainError = DomainError;'
    + ' globalThis.SOURCE_KEYWORDS = SOURCE_KEYWORDS; globalThis.SOURCE_BASE_TYPES = SOURCE_BASE_TYPES;'
    + ' globalThis.SOURCE_REFERENCE_TOUR = SOURCE_REFERENCE_TOUR; globalThis.SOURCE_REFERENCE_FORMS = SOURCE_REFERENCE_FORMS;'
    + ' globalThis.SOURCE_REFERENCE_EXAMPLE = SOURCE_REFERENCE_EXAMPLE; globalThis.SOURCE_ANNOTATIONS = SOURCE_ANNOTATIONS;'
    + ' globalThis.SOURCE_REFERENCE_EXAMPLE_SLUG = SOURCE_REFERENCE_EXAMPLE_SLUG; globalThis.SOURCE_MONARCH = SOURCE_MONARCH;'
    + '',
});
const { check, eq, finish } = makeChecker();

// Many fixtures here record events by hand that no command of theirs
// emits, so the advisory saying so (11.0) is left out where a check is
// about something else; the shipped models are held to it whole.
const UNEMITTED = /^No command emits it\./;
const advisedOtherwise = (model) => sandbox.modelAdvisories(model).filter((a) => !UNEMITTED.test(a.message));
const {
  loadPredefinedModel, projectState, modelToSource, parseModelSource, applyModelSource,
  importModelFromEnvelope, sameDefinition, loadEvents, onAppend,
  sourceAdvisories, sourceSpanAt, PREDEFINED_MODELS, SOURCE_KINDS, DEF_COLLECTIONS, deepClone,
} = sandbox;

// Many fixtures here state a command the way it reads without branches
// – its rules, then what it emits. `lists` gives a stored or parsed
// command that way (a copy, its `steps` kept), and `unlists` and the
// writers below put the two lists back into the steps they came from
// (`withCommandLists`).
function lists(body) {
  const copy = deepClone(body);
  return Object.assign(copy, sandbox.commandLists(copy));
}
function unlists(kind, body) {
  if (kind !== 'command-definition' || !body || (body.conditions === undefined && body.publishes === undefined)) return body;
  const { conditions, publishes, ...rest } = body;
  const kept = sandbox.commandLists(rest);
  return { ...rest, steps: sandbox.withCommandLists(rest.steps, conditions || kept.conditions, publishes || kept.publishes) };
}
const addDefinition = (kind, id, name, body) => sandbox.addDefinition(kind, id, name, unlists(kind, body));
const updateDefinition = (kind, id, name, body) => sandbox.updateDefinition(kind, id, name, unlists(kind, body));

function fresh() {
  store.clear();
  sandbox.bumpLogRevision();
}

// The course example with groups – what `course-entities` was, its
// entities restated as groups (11.0). Tests about groups and the reads
// through them build this one, from its text.
const GROUPS = [
  'model "Course Example (with groups)"',
  '',
  '// Types',
  'enum CourseStatus { NonExistent, Existent, Archived }',
  'tag type StudentId = string',
  'tag type CourseId = string',
  '',
  '// Events',
  'event CourseDefined { tag courseId: CourseId, capacity: integer }',
  'event CourseCapacityChanged { tag courseId: CourseId, newCapacity: integer }',
  'event CourseArchived { tag courseId: CourseId }',
  'event StudentRegistered { tag studentId: StudentId }',
  'event StudentSubscribedToCourse { tag courseId: CourseId, tag studentId: StudentId }',
  'event StudentUnsubscribedFromCourse { tag courseId: CourseId, tag studentId: StudentId }',
  '',
  '// Groups',
  '@icon("🧑‍🎓")',
  'group Student (tag studentId: StudentId) {',
  '  projection exists: boolean = false {',
  '    on StudentRegistered => set true',
  '  }',
  '',
  '  projection subscriptionCount: integer = 0 {',
  '    on StudentSubscribedToCourse => increment 1',
  '    on StudentUnsubscribedFromCourse => decrement 1',
  '  }',
  '}',
  '',
  '@icon("📚")',
  'group Course (tag courseId: CourseId) {',
  '  projection status: CourseStatus = NonExistent {',
  '    on CourseDefined => set Existent',
  '    on CourseArchived => set Archived',
  '  }',
  '',
  '  projection capacity: integer = 0 {',
  '    on CourseDefined => set event.data.capacity',
  '    on CourseCapacityChanged => set event.data.newCapacity',
  '  }',
  '',
  '  projection subscriptionCount: integer = 0 {',
  '    on StudentSubscribedToCourse => increment 1',
  '    on StudentUnsubscribedFromCourse => decrement 1',
  '  }',
  '',
  '  projection subscribedStudentIds: StudentId[] = [] {',
  '    on StudentSubscribedToCourse => append event.data.studentId',
  '    on StudentUnsubscribedFromCourse => remove event.data.studentId',
  '  }',
  '}',
  '',
  '// Commands',
  '@feature("Course management")',
  'command DefineCourse(courseId: CourseId, capacity: integer) {',
  '  alias course = Course(courseId)',
  '',
  '  require course.status == NonExistent',
  '    else reject "Course already exists"',
  '',
  '  emit CourseDefined { courseId, capacity }',
  '}',
  '',
  '@feature("Course management")',
  'command ChangeCourseCapacity(courseId: CourseId, newCapacity: integer) {',
  '  alias course = Course(courseId)',
  '',
  '  require course.status == Existent',
  '    else reject "Course is not active"',
  '  require course.subscriptionCount <= newCapacity',
  '    else reject "Course has more subscriptions than that"',
  '',
  '  emit CourseCapacityChanged { courseId, newCapacity }',
  '}',
  '',
  '@feature("Course management")',
  'command ArchiveCourse(courseId: CourseId) {',
  '  alias course = Course(courseId)',
  '',
  '  require course.status == Existent',
  '    else reject "Course is not active"',
  '',
  '  emit CourseArchived { courseId }',
  '}',
  '',
  '@feature("Student registration")',
  'command RegisterStudent(studentId: StudentId) {',
  '  alias student = Student(studentId)',
  '',
  '  require student.exists is false',
  '    else reject "Student is already registered"',
  '',
  '  emit StudentRegistered { studentId }',
  '}',
  '',
  '@feature("Enrolment")',
  'command SubscribeStudentToCourse(courseId: CourseId, studentId: StudentId) {',
  '  alias course = Course(courseId)',
  '  alias student = Student(studentId)',
  '',
  '  require course.status == Existent',
  '    else reject "Course is not active"',
  '  require student.exists is true',
  '    else reject "Student is not registered"',
  '  require course.subscriptionCount < course.capacity',
  '    else reject "Course is full"',
  '  require course.subscribedStudentIds not contains studentId',
  '    else reject "Student is already subscribed"',
  '  require student.subscriptionCount < 10',
  '    else reject "Student is subscribed to too many courses"',
  '',
  '  emit StudentSubscribedToCourse { courseId, studentId }',
  '}',
  '',
  '@feature("Enrolment")',
  'command UnsubscribeStudentFromCourse(courseId: CourseId, studentId: StudentId) {',
  '  alias course = Course(courseId)',
  '',
  '  require course.status == Existent',
  '    else reject "Course is not active"',
  '  require course.subscribedStudentIds contains studentId',
  '    else reject "Student is not subscribed"',
  '',
  '  emit StudentUnsubscribedFromCourse { courseId, studentId }',
  '}',
  '',
].join('\n');

// Groups using every read they have: a derived projection naming its
// siblings and a top-level projection, a projection taking arguments by
// name, a fan-out, a grouped projection bound on its own, a read in
// place, and a projection scenario inside the group.
const GROUPS_MORE = [
  'model "Course Example (grouped, with schedules)"',
  '',
  '// Types',
  'enum CourseStatus { NonExistent, Existent, Archived }',
  'tag type StudentId = string',
  'tag type CourseId = string',
  'type TimeSlot = string',
  '',
  '// Events',
  'event CourseDefined { tag courseId: CourseId, capacity: integer, slots: TimeSlot[] }',
  'event CourseCapacityChanged { tag courseId: CourseId, newCapacity: integer }',
  'event CourseArchived { tag courseId: CourseId }',
  'event StudentRegistered { tag studentId: StudentId }',
  'event StudentSubscribedToCourse { tag courseId: CourseId, tag studentId: StudentId }',
  'event StudentUnsubscribedFromCourse { tag courseId: CourseId, tag studentId: StudentId }',
  '',
  '// Groups',
  '@icon("🧑‍🎓")',
  'group Student (tag studentId: StudentId) {',
  '  projection exists: boolean = false {',
  '    on StudentRegistered => set true',
  '  }',
  '',
  '  projection subscriptionCount: integer = 0 {',
  '    on StudentSubscribedToCourse => increment 1',
  '    on StudentUnsubscribedFromCourse => decrement 1',
  '  }',
  '',
  '  projection subscribedCourseIds: CourseId[] = [] {',
  '    on StudentSubscribedToCourse => append event.data.courseId',
  '    on StudentUnsubscribedFromCourse => remove event.data.courseId',
  '  }',
  '}',
  '',
  '@icon("📚")',
  'group Course (tag courseId: CourseId) {',
  '  projection status: CourseStatus = NonExistent {',
  '    on CourseDefined => set Existent',
  '    on CourseArchived => set Archived',
  '',
  '    scenarios {',
  '      scenario "a defined course exists" {',
  '        given CourseDefined { courseId: "c1", capacity: 3, slots: [] }',
  '        then Course(CourseId("c1")).status == Existent',
  '      }',
  '    }',
  '  }',
  '',
  '  projection capacity: integer = 0 {',
  '    on CourseDefined => set event.data.capacity',
  '    on CourseCapacityChanged => set event.data.newCapacity',
  '  }',
  '',
  '  projection subscriptionCount: integer = 0 {',
  '    on StudentSubscribedToCourse => increment 1',
  '    on StudentUnsubscribedFromCourse => decrement 1',
  '  }',
  '',
  '  projection slots: TimeSlot[] = [] {',
  '    on CourseDefined => set event.data.slots',
  '  }',
  '',
  '  derived projection remaining: integer {',
  '    capacity - subscriptionCount',
  '  }',
  '',
  '  derived projection hasRoomFor (seats: integer): boolean {',
  '    remaining >= seats',
  '  }',
  '',
  '  derived projection studentsAtLimit: boolean {',
  '    StudentSubscriptionTotal(courseId) > 100',
  '  }',
  '}',
  '',
  '// Projections',
  'projection StudentSubscriptionTotal (tag courseId: CourseId): integer = 0 {',
  '  on StudentSubscribedToCourse => increment 1',
  '}',
  '',
  '// Commands',
  'command DefineCourse(courseId: CourseId, capacity: integer, slots: TimeSlot[]) {',
  '  require Course(courseId).status == NonExistent',
  '    else reject "Course already exists"',
  '',
  '  emit CourseDefined { courseId, capacity, slots }',
  '}',
  '',
  'command SubscribeStudentToCourse(courseId: CourseId, studentId: StudentId) {',
  '  alias course = Course(courseId)',
  '  alias student = Student(studentId)',
  '  alias others = Course(each student.subscribedCourseIds)',
  '  alias left = Course(courseId).remaining',
  '',
  '  require course.status == Existent',
  '    else reject "Course is not active"',
  '  require student.exists is true',
  '    else reject "Student is not registered"',
  '  require course.hasRoomFor(seats: 1) is true',
  '    else reject "Course is full"',
  '  require left > 0',
  '    else reject "No seats left"',
  '  require others.slots not containsAny course.slots',
  '    else reject "Course clashes with the student\'s schedule"',
  '',
  '  emit StudentSubscribedToCourse { courseId, studentId }',
  '',
  '  scenarios {',
  '    scenario {  // is refused: Course is not active',
  '      when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }',
  '      then rejected "Course is not active"',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

function build(index) {
  fresh();
  const id = loadPredefinedModel(index);
  return { id, model: () => projectState()[id] };
}

const bySlug = (slug) => build(PREDEFINED_MODELS.findIndex((m) => m.slug === slug));

// A model applied from a text, the way the code view writes one.
function buildText(text = GROUPS) {
  fresh();
  const id = sandbox.createDcbModel('Text');
  applyModelSource(id, text);
  return { id, model: () => projectState()[id] };
}

// Every definition of every source kind came back equal, in order.
function assertSameModel(model, parsed, label) {
  for (const kind of SOURCE_KINDS) {
    const stored = model[DEF_COLLECTIONS[kind]];
    const read = parsed.collections[kind];
    eq(Object.keys(read), Object.keys(stored), `${label}: ${kind} order`);
    for (const name of Object.keys(stored)) {
      if (!sameDefinition(stored[name], read[name])) {
        throw new Error(`${label}: ${kind} ${name} differs\n  stored ${JSON.stringify(stored[name])}`
          + `\n  parsed ${JSON.stringify(read[name])}`);
      }
    }
  }
}

let appends = 0;
onAppend(() => { appends += 1; });

// ---------------------------------------------------------------
// The round trip.
// ---------------------------------------------------------------

check('every predefined model prints without a JSON fallback and parses back equal', () => {
  PREDEFINED_MODELS.forEach((entry, index) => {
    const { model } = build(index);
    const text = modelToSource(model());
    eq(text.includes(' json {'), false, `${entry.slug} falls back to JSON`);
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], `${entry.slug} diagnostics`);
    eq(parsed.name, model().name, `${entry.slug} name`);
    assertSameModel(model(), parsed, entry.slug);
  });
});

check('a text with groups prints back exactly as written, and applies again as nothing', () => {
  for (const text of [GROUPS, GROUPS_MORE]) {
    const { id, model } = buildText(text);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    eq(modelToSource(model()), text, 'printed as written');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'groups');
    const before = loadEvents().length;
    applyModelSource(id, text);
    eq(loadEvents().length, before, 'an untouched text applies as nothing');
  }
});

// The class of bug the fallback comment once was: a stored string that
// the printed text does not keep inside its quotes, comment or code
// fence, and that reads back as something else – a declaration the
// model never had. Every free-text slot of every shipped model and
// fixture is filled with what would break out of each of those, and the
// text must still read back as exactly the model.
const BREAKOUT = 'x\n}\r\u2028\u2029// "quoted" \\ ``` */ ```\ncommand Smuggled() {}\n';

function withBreakouts(model) {
  const out = deepClone(model);
  out.name = 'M ' + BREAKOUT;
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === 'string' && ['rejection', 'code'].includes(key)) value[key] = inner + BREAKOUT;
      else walk(inner);
    }
  };
  for (const kind of SOURCE_KINDS) walk(out[DEF_COLLECTIONS[kind]]);
  for (const kind of ['scenario-definition', 'projection-scenario-definition']) {
    for (const body of Object.values(out[DEF_COLLECTIONS[kind]] || {})) if (typeof body.name === 'string') body.name += BREAKOUT;
  }
  return out;
}

function importFixture(slug) {
  fresh();
  const { modelId, skipped } = importModelFromEnvelope(
    JSON.parse(fs.readFileSync(path.join(FIXTURES, slug + '.dcb.json'), 'utf8'))
  );
  eq(skipped, [], `${slug} imported whole`);
  return { id: modelId, model: () => projectState()[modelId] };
}

check('every fixture file round-trips, scenarios included', () => {
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.dcb.json'))) {
    const { id, model } = importFixture(file.replace(/\.dcb\.json$/, ''));
    const text = modelToSource(model());
    eq(text.includes(' json {'), false, `${file} falls back to JSON`);
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], `${file} diagnostics`);
    assertSameModel(model(), parsed, file);
    for (const kind of ['scenario-definition', 'projection-scenario-definition']) {
      const stored = Object.values(model()[DEF_COLLECTIONS[kind]]);
      const read = parsed.scenarios.filter((r) => r.kind === kind);
      eq(read.length, stored.length, `${file}: ${kind} count`);
      eq(read.every((r) => r.block !== null), true, `${file}: every ${kind} nested`);
      for (const body of stored) {
        eq(read.some((r) => sandbox.sameDefinition(r.body, body)), true, `${file}: ${JSON.stringify(body).slice(0, 120)}`);
      }
    }
    const report = sandbox.sourceScenarioReport(model(), parsed);
    eq([report.errors.length, report.warnings.length], [0, 0], `${file}: scenarios as stored`);
    const before = loadEvents().length;
    applyModelSource(id, text);
    eq(loadEvents().length, before, `${file}: an untouched text, scenarios and all, applies as nothing`);
  }
});

check('no stored string breaks out of the printed text, in any model', () => {
  const models = PREDEFINED_MODELS.map((entry, index) => [entry.slug, build(index).model()]);
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.dcb.json'))) {
    models.push([file, importFixture(file.replace(/\.dcb\.json$/, '')).model()]);
  }
  models.push(['groups', buildText(GROUPS).model()], ['more groups', buildText(GROUPS_MORE).model()]);
  for (const [label, original] of models) {
    const model = withBreakouts(original);
    const parsed = parseModelSource(modelToSource(model));
    eq(parsed.diagnostics, [], `${label} diagnostics`);
    eq(parsed.name, model.name, `${label} name`);
    eq(Object.keys(parsed.collections['command-definition']).includes('Smuggled'), false, `${label}: nothing smuggled`);
    assertSameModel(model, parsed, label);
    for (const kind of ['scenario-definition', 'projection-scenario-definition']) {
      const stored = Object.values(model[DEF_COLLECTIONS[kind]] || {});
      const read = parsed.scenarios.filter((r) => r.kind === kind);
      eq(read.length, stored.length, `${label}: ${kind} count`);
      for (const body of stored) {
        eq(read.some((r) => sandbox.sameDefinition(r.body, body)), true, `${label}: ${JSON.stringify(body).slice(0, 120)}`);
      }
    }
  }
});

check('applying an untouched text appends nothing', () => {
  PREDEFINED_MODELS.forEach((entry, index) => {
    const { id, model } = build(index);
    const before = loadEvents().length;
    const summary = applyModelSource(id, modelToSource(model()));
    eq(loadEvents().length, before, `${entry.slug} appended`);
    eq(sandbox.sourceApplySummary(summary), 'nothing changed', entry.slug);
  });
});

// ---------------------------------------------------------------
// The spellings, pinned on the shipped models.
// ---------------------------------------------------------------

check('a command reads as reads, rules and emissions', () => {
  const { model } = buildText();
  const text = modelToSource(model());
  const expected = [
    '@feature("Enrolment")',
    'command SubscribeStudentToCourse(courseId: CourseId, studentId: StudentId) {',
    '  alias course = Course(courseId)',
    '  alias student = Student(studentId)',
    '',
    '  require course.status == Existent',
    '    else reject "Course is not active"',
    '  require student.exists is true',
    '    else reject "Student is not registered"',
    '  require course.subscriptionCount < course.capacity',
    '    else reject "Course is full"',
    '  require course.subscribedStudentIds not contains studentId',
    '    else reject "Student is already subscribed"',
    '  require student.subscriptionCount < 10',
    '    else reject "Student is subscribed to too many courses"',
    '',
    '  emit StudentSubscribedToCourse { courseId, studentId }',
    '}',
  ].join('\n');
  eq(text.includes(expected), true, 'SubscribeStudentToCourse as printed:\n' + text);
});

check('fan-out, numbering, membership and derived values have spellings', () => {
  const grouped = modelToSource(buildText(GROUPS_MORE).model());
  eq(grouped.includes('alias others = Course(each student.subscribedCourseIds)'), true, 'a group fanned out');
  eq(grouped.includes('group Course (tag courseId: CourseId) {'), true, 'a group\'s tag');
  eq(grouped.includes('require others.slots not containsAny course.slots'), true, 'containsAny');
  const sequence = modelToSource(bySlug('course-sequence').model());
  eq(sequence.includes('alias courseNumbering = CourseNumbering()'), true, 'an untagged read');
  eq(sequence.includes('untagged projection CourseNumbering: CourseId = "c1" {'), true, 'an untagged projection');
  eq(sequence.includes('emit CourseDefined { courseId: courseNumbering, capacity }'), true, 'minted id');
  eq(sequence.includes('on CourseDefined => set successor(event.data.courseId)'), true, 'successor');
  const tenant = modelToSource(bySlug('course-tenant').model());
  eq(tenant.includes('alias tenantCourseNumbering = TenantCourseNumbering(tenantId)'), true, 'a tagged read');
  eq(tenant.includes('projection TenantCourseNumbering (tag tenantId: TenantId): CourseNumber = "1" {'), true, 'its tag');
  const boundary = modelToSource(bySlug('content-decisions-boundary').model());
  eq(boundary.includes('require DocumentLifecycle(docId) in [Draft, Published]'), true, 'equalsAny');
  const derived = modelToSource(bySlug('content-decisions-derived').model());
  eq(derived.includes('derived projection DocumentHasPendingChanges (tag documentId: DocumentId): boolean {\n'
    + '  DocumentCurrentText(documentId) != DocumentPublishedText(documentId)\n}'), true, 'derived, passing its tag on');
  const hours = modelToSource(build(PREDEFINED_MODELS.findIndex((m) => m.slug === 'developer-hours')).model());
  eq(hours.includes('derived projection DeveloperRemainingHoursForWeek (tag developerId: DeveloperId, tag week: WeekNumber): integer {\n'
    + '  DeveloperAvailableHoursPerWeek(developerId) - DeveloperAllocatedHoursForWeek(developerId, week)\n'), true,
    'a derived computation, its scenarios after it');
  const pricing = modelToSource(bySlug('pricing-simple').model());
  eq(pricing.includes('record Item { productId: ProductId, price: Money }'), true, 'record');
  eq(pricing.includes('event ProductsOrdered { tag orderId: OrderId, items: Item[] tag each productId }'), true,
    'a tagged property, and a tag in each element of a list');
  eq(pricing.includes('require ProductCurrentPrice(each items.productId) == items.price'), true,
    'a fan-out, paired with a parameter field');
  eq(pricing.includes('type Money = number { minimum: 0 }'), true, 'schema constraints');
});

check('every rule shape reads back as the rule it was', () => {
  const rules = [
    ['a == b', { predicate: 'equals' }],
    ['a != b', { predicate: 'equals', negate: true }],
    ['not a < b', { predicate: 'lessThan', negate: true }],
    ['a >= b', { predicate: 'greaterThanOrEquals' }],
    ['count(a) == 3', { predicate: 'countEquals', rightHandSide: 3 }],
    ['count(a) != 3', { predicate: 'countEquals', negate: true, rightHandSide: 3 }],
    ['not count(a) > 3', { predicate: 'countGreaterThan', negate: true, rightHandSide: 3 }],
    ['a in [X, "y", 2]', { predicate: 'equalsAny', rightHandSide: [{ enumMember: 'X' }, 'y', 2] }],
    ['a not in []', { predicate: 'equalsAny', negate: true, rightHandSide: [] }],
    ['a not startsWith "c"', { predicate: 'startsWith', negate: true, rightHandSide: 'c' }],
    ['a is empty', { predicate: 'isEmpty' }],
    ['a is not empty', { predicate: 'isNotEmpty' }],
    ['not a is true', { predicate: 'isTrue', negate: true }],
    ['a is false', { predicate: 'isFalse' }],
  ];
  for (const [text, expected] of rules) {
    const source = `command C(a: integer, b: integer) {\n  require ${text}\n    else reject "No"\n}`;
    const parsed = parseModelSource(source);
    eq(parsed.diagnostics, [], text);
    const rule = lists(parsed.collections['command-definition'].C).conditions[0];
    const want = { leftHandSide: { parameterName: 'a' }, ...expected, rejection: 'No' };
    if (want.rightHandSide === undefined && !['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(want.predicate)) {
      want.rightHandSide = { parameterName: 'b' };
    }
    eq(sameDefinition(rule, want), true, `${text} read as ${JSON.stringify(rule)}`);
    const printed = modelToSource({ name: 'm', ...emptyCollections({ 'command-definition': { C: parsed.collections['command-definition'].C } }) });
    eq(printed.includes(`require ${text}\n    else reject "No"`), true, `${text} printed as\n${printed}`);
  }
});

check('every rule says what it is refused with, on its line or the next', () => {
  const ruleOf = (text) => {
    const parsed = parseModelSource(`command C(a: integer) {\n${text}\n}`);
    return { diagnostics: parsed.diagnostics.map((d) => d.message), rule: lists(parsed.collections['command-definition'].C || {}).conditions };
  };
  const next = ruleOf('  require a > 1\n    else reject "Too small"');
  eq(next.diagnostics, [], 'on the next line');
  eq(next.rule, [{ leftHandSide: { parameterName: 'a' }, predicate: 'greaterThan', rightHandSide: 1, rejection: 'Too small' }],
    'the message is the rule\'s');
  eq(ruleOf('  require a > 1 else reject "Too small"').rule, next.rule, 'or on the same one');
  eq(ruleOf('  require a > 1').diagnostics,
    ['Expected "else reject" and the message the command is refused with, found "}".'], 'it is required');
  eq(ruleOf('  require a > 1 else reject Small').diagnostics,
    ['Expected the message the command is refused with, in quotes, found "Small".'], 'and it is text');
  const scenario = parseModelSource('command C(a: integer) {\n  require a > 1 else reject "No"\n'
    + '  scenarios {\n    scenario {\n      when C { a: 0 }\n      then rejected by a > 1\n    }\n  }\n}');
  eq(scenario.diagnostics.map((d) => d.message),
    ['A refusal is named by the message it was refused with: then rejected "…".'], 'a refusal names the message');
  eq(parseModelSource('command C(a: integer) {\n  require a > 1 else reject "No"\n'
    + '  scenarios {\n    scenario {\n      when C { a: 0 }\n      then rejected "No" saw 0, 1\n    }\n  }\n}').diagnostics.map((d) => d.message),
    ['A refusal is named by its message alone – what the rule read is not asserted.'], 'and by nothing else');
  const bare = { name: 'm', ...emptyCollections({ 'command-definition': { C: {
    properties: [], boundary: [], steps: [{ condition: { leftHandSide: { parameterName: 'a' }, predicate: 'isTrue' } }],
  } } }) };
  eq(modelToSource(bare).includes('// Written as JSON: a rule has no rejection message.\ncommand C json {'), true,
    'a stored rule without one is written as JSON');
});

check('membership in data reads either way round, and prints as contains', () => {
  const source = (rule) => `command C(a: integer, b: integer[]) {\n  require ${rule}\n    else reject "No"\n}`;
  const ruleOf = (rule) => {
    const parsed = parseModelSource(source(rule));
    eq(parsed.diagnostics, [], rule);
    return lists(parsed.collections['command-definition'].C).conditions[0];
  };
  const contains = { leftHandSide: { parameterName: 'b' }, predicate: 'contains', rightHandSide: { parameterName: 'a' }, rejection: 'No' };
  eq(sameDefinition(ruleOf('a in b'), contains), true, 'a in b');
  eq(sameDefinition(ruleOf('a not in b'), { ...contains, negate: true }), true, 'a not in b');
  eq(sameDefinition(ruleOf('not a in b'), { ...contains, negate: true }), true, 'not a in b');
  eq(sameDefinition(ruleOf('3 in b'), { ...contains, rightHandSide: 3 }), true, 'a literal in b');
  const printed = modelToSource({ name: 'm', ...emptyCollections({ 'command-definition': { C: unlists('command-definition', { properties: [], conditions: [ruleOf('a not in b')] }) } }) });
  eq(printed.includes('require b not contains a'), true, `printed as\n${printed}`);

  // A rule written the other way round still resolves and renames: the
  // marks travel with the operands, whichever side they land on.
  const text = modelToSource(buildText().model());
  const swapped = swap(text, 'course.subscribedStudentIds not contains studentId', 'studentId not in course.subscribedStudentIds');
  eq(swapped === text, false, 'the course model states membership');
  const parsed = parseModelSource(swapped);
  eq(parsed.diagnostics, [], 'swapped parses');
  const model = buildText().model();
  const stored = { name: model.name };
  for (const kind of SOURCE_KINDS) stored[DEF_COLLECTIONS[kind]] = model[DEF_COLLECTIONS[kind]];
  assertSameModel(stored, parsed, 'x in xs');
  const renamed = renameAt(swapped, 'studentId not in', 0, 'learnerId');
  eq(renamed.error, undefined, 'renamed from the swapped side');
  eq(renamed.text.includes('learnerId not in course.subscribedStudentIds'), true, 'the rule follows the rename');
});

function emptyCollections(overrides) {
  const out = {};
  for (const kind of SOURCE_KINDS) out[DEF_COLLECTIONS[kind]] = overrides[kind] || {};
  return out;
}

check('a name resolves to a read when one declares it, and to the payload otherwise', () => {
  const parsed = parseModelSource([
    'group Course (tag courseId: CourseId) {}',
    'untagged projection CourseNumbering: CourseId = "c1" {}',
    'command C(courseId: CourseId, items: Item[]) {',
    '  alias course = Course(courseId)',
    '  alias numbering = CourseNumbering()',
    '  require course.status == items.price else reject "a"',
    '  require numbering == gone else reject "b"',
    '  require ghost.status is true else reject "c"',
    '}',
  ].join('\n'));
  const body = lists(parsed.collections['command-definition'].C);
  eq(body.conditions[0].leftHandSide, { alias: 'course', property: 'status' }, 'read property');
  eq(body.conditions[0].rightHandSide, { parameterName: 'items', property: 'price' }, 'payload field');
  eq(body.conditions[1].leftHandSide, { alias: 'numbering' }, 'projection read');
  eq(body.conditions[1].rightHandSide, { parameterName: 'gone' }, 'dangling bare name is a property');
  eq(body.conditions[2].leftHandSide, { alias: 'ghost', property: 'status' }, 'dangling dotted name is a read');
});

// ---------------------------------------------------------------
// The fallback that keeps printing lossless.
// ---------------------------------------------------------------

check('what the grammar cannot say is written as JSON, says why, and still round-trips', () => {
  const { id, model } = buildText();
  const body = lists((model()['command-definitions'].ArchiveCourse));
  body.conditions.push({ leftHandSide: { parameterName: 'courseId' }, predicate: 'resemblesStrongly', rightHandSide: 1, rejection: 'No' });
  updateDefinition('command-definition', id, 'ArchiveCourse', body);
  const shadowed = lists((model()['command-definitions'].DefineCourse));
  shadowed.boundary[0].alias = 'courseId';
  shadowed.conditions[0].leftHandSide.alias = 'courseId';
  updateDefinition('command-definition', id, 'DefineCourse', shadowed);
  const text = modelToSource(model());
  eq(text.includes('// Written as JSON: a rule\'s predicate "resemblesStrongly" is not one the code form knows.\n'
    + 'command ArchiveCourse json {'), true, 'unknown predicate');
  eq(text.includes('// Written as JSON: "courseId" names both a payload property and an alias.\n'
    + 'command DefineCourse json {'), true, 'a parameter and a read sharing a name');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'diagnostics');
  assertSameModel(model(), parsed, 'fallbacks');
  const before = loadEvents().length;
  applyModelSource(id, text);
  eq(loadEvents().length, before, 'an untouched fallback applies as no change');
});

check('a fallback\'s reason stays a comment, whatever the stored strings it quotes', () => {
  // A reason quotes stored strings. A line break in one used to end the
  // comment and print the rest as code, so a crafted predicate could
  // smuggle in a projection nobody declared, added the moment the
  // untouched text was applied.
  const { id, model } = buildText();
  const body = lists((model()['command-definitions'].ArchiveCourse));
  body.conditions.push({
    leftHandSide: 1, rejection: 'No', // no right-hand side: the reason quotes the predicate raw
    predicate: 'x\nuntagged projection Smuggled: integer = 0 {\n'
      + '  on CourseDefined => increment 1\n}\r\u2028//',
  });
  updateDefinition('command-definition', id, 'ArchiveCourse', body);
  const text = modelToSource(model());
  const reason = text.split('\n').find((line) => line.startsWith('// Written as JSON: a "x '));
  eq(reason !== undefined && reason.includes('Smuggled'), true, 'the predicate is quoted on the comment\'s line');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'diagnostics');
  eq(Object.keys(parsed.collections['projection-definition']).includes('Smuggled'), false, 'nothing is declared by it');
  assertSameModel(model(), parsed, 'fallback');
  const before = loadEvents().length;
  applyModelSource(id, text);
  eq(loadEvents().length, before, 'an untouched text applies as no change');
  eq(model()['projection-definitions'].Smuggled, undefined, 'and adds no projection');
});

// ---------------------------------------------------------------
// Applying a text.
// ---------------------------------------------------------------

check('an edit is written as exactly the definitions it changed, in one append', () => {
  const { id, model } = buildText();
  const text = swap(modelToSource(model()), 'require student.subscriptionCount < 10', 'require student.subscriptionCount < 12');
  const before = appends;
  const log = loadEvents().length;
  const summary = applyModelSource(id, text);
  eq(appends - before, 1, 'one append');
  eq(loadEvents().length - log, 1, 'one event');
  eq(summary.updated, [{ kind: 'command-definition', name: 'SubscribeStudentToCourse' }], 'updated');
  eq(lists(model()['command-definitions'].SubscribeStudentToCourse).conditions[4].rightHandSide, 12, 'the new limit');
});

check('adding, removing, reordering and renaming the model are one append together', () => {
  const { id, model } = buildText();
  const scenarios = JSON.stringify(model()['scenario-definitions']);
  let text = swap(modelToSource(model()), 'model "Course Example (with groups)"', 'model "Renamed"');
  text = swap(text, /@feature\("Course management"\)\ncommand ArchiveCourse[\s\S]*?\n}\n/, '')
    + '\ntag type RoomId = string\ngroup Room (tag roomId: RoomId) {}\n';
  // Two events trade places.
  text = swap(text, 'event CourseArchived { tag courseId: CourseId }\n', '');
  text = swap(text, 'event CourseDefined', 'event CourseArchived { tag courseId: CourseId }\nevent CourseDefined');
  const before = appends;
  const summary = applyModelSource(id, text);
  eq(appends - before, 1, 'one append');
  eq(model().name, 'Renamed', 'model name');
  eq('ArchiveCourse' in model()['command-definitions'], false, 'removed');
  eq(model()['group-definitions'].Room, { tag: { name: 'roomId', tagType: 'RoomId' }, projections: [] }, 'added, empty');
  eq(model()['custom-type-definitions'].RoomId, { schema: { type: 'string' }, isTag: true }, 'its tag type, as written');
  eq(Object.keys(model()['event-definitions'])[0], 'CourseArchived', 'reordered');
  eq(summary.reordered.map((r) => r.kind), ['event-definition'], 'reorder reported');
  eq(JSON.stringify(model()['scenario-definitions']), scenarios, 'scenarios untouched');
});

check('a group\'s tag type is written, never implied', () => {
  const parsed = parseModelSource('group Room (tag roomId: RoomId) {}\n');
  eq(parsed.diagnostics, [], 'it reads');
  eq(Object.keys(parsed.collections['custom-type-definition']), [], 'no type synthesized');
  fresh();
  const id = sandbox.createDcbModel('Rooms');
  applyModelSource(id, 'group Room (tag roomId: RoomId) {}\n');
  eq(sandbox.modelAdvisories(projectState()[id]).map((a) => a.message).some((m) => /RoomId/.test(m)), true,
    'a dangling tag type is advised on');
});

check('a text with an error applies nothing and says where', () => {
  const { id, model } = buildText();
  const text = swap(modelToSource(model()), 'require course.status == Existent', 'require course.status === Existent');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics.length, 1, 'one error');
  const line = text.split('\n').findIndex((l) => l.includes('===')) + 1;
  eq(parsed.diagnostics[0].line, line, 'on its line');
  const before = loadEvents().length;
  let refused = null;
  try { applyModelSource(id, text); } catch (error) { refused = error; }
  eq(refused instanceof sandbox.DomainError, true, 'refused as a domain error');
  eq(refused.message.startsWith(`1 error in the code – nothing was applied. Line ${line}:`), true, refused.message);
  eq(loadEvents().length, before, 'nothing appended');
});

check('an error in one declaration does not hide the next', () => {
  const parsed = parseModelSource([
    'event A { id: AId',
    'event B { id: }',
    'enum C { X, Y }',
    'command A(',
  ].join('\n'));
  eq(parsed.diagnostics.map((d) => d.line), [1, 2, 4], JSON.stringify(parsed.diagnostics));
  eq(parsed.diagnostics[0].message, 'Expected "}" before the next declaration.', 'where the brace is missing');
  eq(Object.keys(parsed.collections['custom-type-definition']), ['C'], 'the good one still read');
});

check('a name defined twice is an error on the second', () => {
  const parsed = parseModelSource('event A {}\nevent A { x: string }\n');
  eq(parsed.diagnostics.length, 1, 'one');
  eq(parsed.diagnostics[0].line, 2, 'the second');
  eq(parsed.collections['event-definition'].A, { properties: [] }, 'the first kept');
});

check('annotations go only where they mean something', () => {
  eq(parseModelSource('@feature("x")\nevent A {}').diagnostics[0].message, 'An event carries no @feature.', 'misplaced');
  eq(parseModelSource('@colour("x")\nevent A {}').diagnostics[0].message.startsWith('There is no @colour'), true, 'unknown');
});

// ---------------------------------------------------------------
// What review found – each pinned so it stays found.
// ---------------------------------------------------------------

check('a body the write path stores but no printer expects shows as JSON, never as a crash', () => {
  const { id, model } = buildText();
  addDefinition('event-definition', id, 'Holey', { properties: [null] });
  addDefinition('command-definition', id, 'Hollow', { properties: [], boundary: [], conditions: [], publishes: [null] });
  addDefinition('command-definition', id, 'Mapless', {
    properties: [], boundary: [], conditions: [], publishes: [{ name: 'CourseArchived', parameters: null }],
  });
  const text = modelToSource(model());
  for (const name of ['Holey', 'Hollow', 'Mapless']) {
    eq(text.includes(`// Written as JSON: it is not shaped the way the code form expects.\n`), true, name);
  }
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'diagnostics');
  assertSameModel(model(), parsed, 'odd bodies');
});

check('an annotation named like an Object member is an error, not a crash', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    const parsed = parseModelSource(`@${name}("x")\nevent E {}`);
    eq(parsed.diagnostics.length, 1, name);
  }
});

check('false, [] and look-alike keys inside operands are content, not defaults', () => {
  const emission = (parameters) => ({ properties: [], boundary: [], conditions: [], publishes: [{ name: 'E', parameters }] });
  eq(sameDefinition(emission({ a: { parameterName: 'a' } }), emission({ a: { parameterName: 'a' }, tags: [] })), false, 'an empty list published');
  eq(sameDefinition(emission({}), emission({ isList: false })), false, 'a property called isList');
  const handler = (value) => ({ valueType: 'string', isList: true, handlers: [{ event: 'E', operation: 'set', ...value }] });
  eq(sameDefinition(handler({}), handler({ value: [] })), false, 'set [] against set nothing');
  eq(sameDefinition({ valueType: 'boolean' }, { valueType: 'boolean', derived: {} }), false, 'an empty derived');
  eq(sameDefinition(emission({}), emission(undefined)), true, 'no parameters is still no parameters');
  eq(sameDefinition({ schema: { pattern: 'x', type: 'string' } }, { schema: { type: 'string', pattern: 'x' } }), true, 'schema key order');
});

check('a dangling tag type stays dangling through an untouched apply', () => {
  const { id, model } = buildText();
  const course = JSON.parse(JSON.stringify(model()['group-definitions'].Course));
  updateDefinition('group-definition', id, 'Course', { ...course, tag: { name: 'courseId', tagType: 'GhostId' } });
  const before = loadEvents().length;
  const summary = applyModelSource(id, modelToSource(model()));
  eq(loadEvents().length, before, sandbox.sourceApplySummary(summary));
  eq('GhostId' in model()['custom-type-definitions'], false, 'not invented');
});

check('names no collection can be keyed by are refused, and padded ones trimmed', () => {
  for (const name of ['constructor', '__proto__']) {
    const { id, model } = buildText();
    const before = loadEvents().length;
    let refused = null;
    try { applyModelSource(id, modelToSource(model()) + `\nevent ${name} { a: string }\n`); } catch (error) { refused = error; }
    eq(refused instanceof sandbox.DomainError, true, name);
    eq(loadEvents().length, before, `${name}: nothing appended`);
  }
  const { id, model } = buildText();
  applyModelSource(id, modelToSource(model()) + '\nevent " Padded " {}\n');
  eq(Object.keys(model()['event-definitions']).includes('Padded'), true, 'trimmed');
});

check('the model name is compared trimmed, and a rename is reported', () => {
  const { id, model } = buildText();
  const before = loadEvents().length;
  applyModelSource(id, swap(modelToSource(model()), 'model "Course Example (with groups)"', 'model " Course Example (with groups) "'));
  eq(loadEvents().length, before, 'padding is no rename');
  const summary = applyModelSource(id, swap(modelToSource(model()), 'model "Course Example (with groups)"', 'model "Courses"'));
  eq(sandbox.sourceApplySummary(summary), 'renamed the model to "Courses"', 'reported');
});

// ---------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------

check('a scenario reads as given, when and then, nested in its command', () => {
  const { model } = importFixture('course-simple');
  const text = modelToSource(model());
  eq(text.includes([
    '    scenario {  // is refused: Course is not active',
    '      when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }',
    '      then rejected "Course is not active"',
    '    }',
  ].join('\n')), true, 'a refusal, enum members bare');
  eq(text.includes([
    '    scenario {  // records StudentSubscribedToCourse',
    '      given CourseDefined { courseId: "c1", capacity: 123 }',
    '      when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }',
    '      then StudentSubscribedToCourse { courseId: "c1", studentId: "s1" }',
    '    }',
  ].join('\n')), true, 'a publish');
  eq(/\n  emit CourseArchived \{ courseId \}\n\n  scenarios \{\n    scenario /.test(text), true, 'in one group, ending the block');
  const subjects = new Set([...Object.values(model()['scenario-definitions']).map((b) => b.command),
    ...Object.values(model()['projection-scenario-definitions']).map((b) => b.projection)]);
  eq(text.split('\n  scenarios {\n').length - 1, subjects.size, 'one per block with scenarios');
  const sequence = modelToSource(importFixture('course-sequence').model());
  eq(sequence.includes('scenario "issues c1 before anything has happened" {\n      then CourseNumbering() == "c1"\n    }'), true,
    'an untagged projection, read');
  const boundary = modelToSource(importFixture('content-decisions-boundary').model());
  eq(boundary.includes('then DocumentLifecycle(DocumentId("d1")) == NonExistent'), true, 'a tag literal');
});

// A text with its edits made, last first – what a fix with `edits` does.
const withEdits = (text, edits) => {
  const lines = text.split('\n');
  const offset = (line, col) => lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + col - 1;
  let out = text;
  for (const e of [...edits].sort((a, b) => offset(b.line, b.col) - offset(a.line, a.col))) {
    out = out.slice(0, offset(e.line, e.col)) + e.text + out.slice(offset(e.endLine, e.endCol));
  }
  return out;
};

check('a scenario written without a then is an error whose fix writes the outcome in', () => {
  const { id, model } = importFixture('course-simple');
  const text = swap(modelToSource(model()), '  emit CourseArchived { courseId }\n\n  scenarios {\n', [
    '  emit CourseArchived { courseId }',
    '',
    '  scenarios {',
    '    scenario "archiving a defined course" {',
    '      given CourseDefined { courseId: "c9", capacity: 3 }',
    '      when ArchiveCourse { courseId: "c9" }',
    '    }',
    '',
    '    scenario "archiving nothing" {',
    '      when ArchiveCourse { courseId: "c8" }',
    '    }',
    '',
  ].join('\n'));
  const report = sandbox.sourceScenarioReport(model(), parseModelSource(text));
  eq(report.errors.map((e) => e.message), [
    'No outcome yet – the model now does:\nthen CourseArchived { courseId: "c9" }',
    'No outcome yet – the model now does:\nthen rejected "Course is not active"',
  ], 'each says what it would be');
  eq(report.errors.map((e) => e.fix.title), ['Write actual outcome', 'Write actual outcome'], 'each with its fix');
  const before = loadEvents().length;
  let refused = null;
  try { applyModelSource(id, text); } catch (error) { refused = error; }
  eq(refused instanceof sandbox.DomainError && /2 scenarios have no then/.test(refused.message), true, String(refused));
  eq(loadEvents().length, before, 'nothing appended');

  const one = withEdits(text, [report.errors[0].fix]);
  eq(one.includes('      when ArchiveCourse { courseId: "c9" }\n      then CourseArchived { courseId: "c9" }\n    }'), true,
    'written under the last line, at its indent');
  eq(sandbox.sourceScenarioReport(model(), parseModelSource(one)).errors.length, 1, 'the other still missing');

  eq(report.errors[0].fixAll.title, 'Write all actual outcomes', 'and a fix for all of them');
  const all = withEdits(text, report.errors[0].fixAll.edits);
  const after = sandbox.sourceScenarioReport(model(), parseModelSource(all));
  eq([after.errors, after.warnings], [[], []], 'clean');
  applyModelSource(id, all);
  const stored = Object.values(model()['scenario-definitions']).find((b) => b.name === 'archiving nothing');
  eq(stored.then, { outcome: 'rejected', events: [], rejection: 'Course is not active' }, 'stored as written');
});

check('a projection scenario without its value is fixed the same way', () => {
  const { model } = importFixture('course-sequence');
  const text = swap(modelToSource(model()), 'then CourseNumbering() == "c1"', 'then CourseNumbering()');
  const [error] = sandbox.sourceScenarioReport(model(), parseModelSource(text)).errors;
  eq(error.message, 'No outcome yet – the model now does:\nthen CourseNumbering() == "c1"', error.message);
  eq(withEdits(text, [error.fix]), modelToSource(model()), 'the line written whole');
  eq(error.fixAll, undefined, 'one missing, no fix for all');
});

check('a keyword said twice is joined with and', () => {
  const head = 'command A() {\n  scenarios {\n    scenario {\n';
  const tail = '\n    }\n  }\n}';
  const text = head + '      given E {}\n      given F {}\n      when A {}' + tail;
  const [d] = parseModelSource(text).diagnostics;
  eq(d.message, 'A scenario says given once – what follows continues with "and".', 'reported');
  eq([d.line, d.col, d.fix.title], [5, 7, 'Join with and'], 'on the second');
  eq(withEdits(text, [d.fix]), head + '      given E {}\n      and F {}\n      when A {}' + tail, 'fixed');
  const apart = parseModelSource(head + '      given E {}\n      when A {}\n      given F {}' + tail).diagnostics;
  eq([apart.length, apart[0].fix], [1, undefined], 'no fix where it does not follow its own kind');
});

check('an agent\'s scenario written without a then is recorded with what the model does', () => {
  const { id, model } = importFixture('course-simple');
  const text = swap(modelToSource(model()), '  emit CourseArchived { courseId }\n\n  scenarios {\n', [
    '  emit CourseArchived { courseId }',
    '',
    '  scenarios {',
    '    scenario "archiving a defined course" {',
    '      given CourseDefined { courseId: "c9", capacity: 3 }',
    '      when ArchiveCourse { courseId: "c9" }',
    '    }',
    '',
    '    scenario "archiving nothing" {',
    '      when ArchiveCourse { courseId: "c8" }',
    '      then rejected "Course is not active"',
    '    }',
    '',
  ].join('\n'));
  const before = appends;
  eq(sandbox.sourceScenarioReport(model(), parseModelSource(text), { recordOutcomes: true }).errors, [], 'no error for an agent');
  const summary = applyModelSource(id, text, { recordOutcomes: true });
  eq(appends - before, 1, 'one append');
  // Written ahead of the command's other scenarios, so they move up.
  eq(sandbox.sourceApplySummary(summary), 'added 2 scenarios, reordered, recorded the outcome of the scenario written '
    + 'without a then (line 208, ArchiveCourse "archiving a defined course")', 'reported');
  const stored = Object.values(model()['scenario-definitions']);
  const recorded = stored.find((b) => b.name === 'archiving a defined course');
  eq(recorded.then, { outcome: 'published', events: [{ type: 'CourseArchived', data: { courseId: 'c9' } }] }, 'recorded');
  const refused = stored.find((b) => b.name === 'archiving nothing');
  eq(refused.then, { outcome: 'rejected', events: [], rejection: 'Course is not active' }, 'the message, and nothing else');
  const back = modelToSource(model());
  eq(back.includes('    scenario "archiving nothing" {\n      when ArchiveCourse { courseId: "c8" }\n'
    + '      then rejected "Course is not active"\n    }'), true, 'and printed back whole');
});

check('a written then is asserted: a drift is reported with its fix, and applying does not accept it', () => {
  const { id, model } = importFixture('course-simple');
  const text = swap(modelToSource(model()), 'when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }\n      then rejected "Course is not active"',
    'when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }\n      then rejected "Course is closed"',
  );
  const parsed = parseModelSource(text);
  const { warnings } = sandbox.sourceScenarioReport(model(), parsed);
  eq(warnings.length, 1, 'one drift');
  const archived = () => Object.values(model()['scenario-definitions'])
    .filter((b) => b.then.rejection === 'Course is closed').length;
  const already = archived();
  eq(warnings[0].message, 'Drifted – the model now does:\nthen rejected "Course is not active"', 'what it does');
  applyModelSource(id, text);
  eq(archived(), already + 1, 'stored as written – drifted, as on the pages');
  const { fix } = warnings[0];
  const lines = text.split('\n');
  const offset = (line, col) => lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + col - 1;
  const fixed = text.slice(0, offset(fix.line, fix.col)) + fix.text + text.slice(offset(fix.endLine, fix.endCol));
  eq(sandbox.sourceScenarioReport(model(), parseModelSource(fixed)).warnings, [], 'the fix accepts it');
});

check('an edited scenario keeps its id and place; a renamed command takes its scenarios along', () => {
  const { id, model } = importFixture('course-simple');
  const ids = Object.keys(model()['scenario-definitions']);
  const text = swap(modelToSource(model()), 'and CourseDefined { courseId: "c11", capacity: 123 }',
    'and CourseDefined { courseId: "c11", capacity: 124 }');
  let summary = applyModelSource(id, text);
  eq(sandbox.sourceApplySummary(summary), 'updated 1 scenario', 'one scenario');
  eq(Object.keys(model()['scenario-definitions']), ids, 'same ids, same order');
  summary = applyModelSource(id, modelToSource(model()).split('SubscribeStudentToCourse').join('EnrolStudent'));
  eq(Object.keys(model()['scenario-definitions']), ids, 'the rename kept every id');
  eq(Object.values(model()['scenario-definitions']).filter((b) => b.command === 'EnrolStudent').length, 5, 'and moved them');
});

check('a scenario left out of the text is removed', () => {
  const { id, model } = importFixture('course-sequence');
  const text = swap(modelToSource(model()), /\n    scenario "issues c3[\s\S]*?\n    }\n/, '\n');
  applyModelSource(id, text);
  eq(Object.values(model()['projection-scenario-definitions']).map((b) => b.name), ['issues c1 before anything has happened'], 'one left');
});

// A text as it was written before groups: each group's lines lifted
// out, its scenarios moved back up to the block's own indentation.
function ungroup(text) {
  const out = [];
  let indent = null;
  for (const line of text.split('\n')) {
    const head = /^(\s*)scenarios \{$/.exec(line);
    if (indent === null && head) { indent = head[1]; continue; }
    if (indent !== null && line === indent + '}') { indent = null; continue; }
    out.push(indent !== null && line.startsWith(indent + '  ') ? indent + line.slice(indent.length + 2) : line);
  }
  return out.join('\n');
}

function applyFixes(text) {
  for (;;) {
    const fixes = parseModelSource(text).diagnostics.filter((d) => d.fix).map((d) => d.fix);
    if (!fixes.length) return text;
    const fix = fixes[fixes.length - 1];
    text = text.slice(0, sandbox.sourceOffset(text, fix.line, fix.col)) + fix.text
      + text.slice(sandbox.sourceOffset(text, fix.endLine, fix.endCol));
  }
}

check('scenarios sit in one group per block, and a text from before groups is one fix away', () => {
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.dcb.json'))) {
    const text = modelToSource(importFixture(file.replace(/\.dcb\.json$/, '')).model());
    const old = ungroup(text);
    if (old === text) continue; // no scenarios
    const diagnostics = parseModelSource(old).diagnostics;
    eq(diagnostics.length > 0 && diagnostics.every((d) => d.message === 'A scenario sits in a "scenarios { … }" group.' && d.fix),
      true, `${file}: the old spelling is refused, with a fix`);
    eq(applyFixes(old), text, `${file}: the fix writes it as printed`);
  }
  const messages = (text) => parseModelSource(text).diagnostics.map((d) => d.message);
  const command = (inner) => `command A() {\n  emit E\n${inner}\n}\nevent E {}`;
  const group = '  scenarios {\n    scenario {\n      when A {}\n    }\n  }';
  eq(messages(command(group)), [], 'a group');
  eq(messages(command(`${group}\n${group}`)), ['A block has one scenarios group – move these scenarios into the first.'], 'one group');
  eq(messages(command(`${group}\n  emit E`)), ['The scenarios group comes last – nothing follows it in the block.'], 'and last');
  eq(messages(command('  scenarios {\n    emit E\n  }')), ['Expected scenario, found "emit".'], 'holding scenarios only');
  eq(messages(command('  scenarios {}')), [], 'empty is no error');
  const early = parseModelSource('command A() {\n  scenario {\n    when A {}\n  }\n  emit E\n}\nevent E {}').diagnostics;
  eq([early.length, early[0].fix], [1, undefined], 'a scenario before a statement is refused without a wrap that would not read');
  const looseOnes = parseModelSource('scenario {\n  when A {}\n}\n\n// between\nscenario {\n  when A {}\n}\ncommand A() {}\nscenario {\n  when A {}\n}');
  eq(looseOnes.diagnostics.length, 2, 'a run at the top level is one error, and the next run another');
  eq(looseOnes.scenarios.length, 3, 'and every one of them is still read');
});

check('the editor folds a scenarios group whole, every other block to its closing line', () => {
  const ranges = sandbox.sourceFoldingRanges([
    'command A(', //            1
    '  a: integer', //          2
    ') {', //                   3
    '  emit E { a }', //        4
    '', //                      5
    '  scenarios {', //         6
    '    scenario {', //        7
    '      when A { a: 1 }', // 8
    '    }', //                 9
    '  }', //                   10
    '}', //                     11
  ].join('\n'));
  eq(ranges, [
    { start: 1, end: 2, scenarios: false },
    { start: 3, end: 10, scenarios: false },
    { start: 6, end: 10, scenarios: true },
    { start: 7, end: 8, scenarios: false },
  ], 'ranges');
  eq(sandbox.sourceFoldingRanges('command A() {\n  scenarios {\n    scenario { when A {').length, 0, 'an unclosed text folds nothing it cannot close');
});

check('scenarios refuse what they cannot mean', () => {
  const errors = (text) => parseModelSource(text).diagnostics.map((d) => d.message);
  const loose = (scenario) => errors(`scenarios {\n${scenario}\n}`);
  eq(errors('command A() {\n  scenarios {\n    scenario {\n      when B {}\n    }\n  }\n}')[0],
    'This scenario sits in A but is about B – move it there, or make it about A.', 'in the wrong block');
  eq(loose('scenario {\n  then Ghost tagged CourseId("x") == 1\n}')[0],
    'A read gives its values in parentheses, in the order Ghost declares them: Ghost(…).', 'the draft spelling');
  eq(loose('scenario {\n  then Ghost == 1\n}')[0],
    'A projection is read with its values in parentheses: Ghost(…) – empty for an untagged one.', 'parentheses, always');
  eq(loose('scenario {\n  when A {}\n  then nothing\n  and E {}\n}')[0], '"then nothing" is the whole outcome – it stands alone.', 'nothing and more');
  eq(loose('scenario {\n  when A {}\n  then rejected "no"\n  and E {}\n}')[0], 'A rejection is the whole outcome – it stands alone.', 'a rejection and more');
  eq(loose('scenario {\n  when A {}\n  and B {}\n}')[0], 'A scenario runs one command – one when.', 'one when, even by and');
  eq(loose('scenario {\n  and E {}\n}')[0], 'Expected given, when or then, found "and".', 'and continues something');
  eq(loose('scenario {\n  given E {}\n  then P() == 1\n  and P() == 2\n}')[0], 'A projection scenario asserts one value – one then.', 'one value, even by and');
  eq(loose('scenario {\n  then E {}\n}')[0], 'A scenario ending in events, nothing or a rejection needs a when – the command it runs.', 'no when');
  eq(loose('scenario {\n  then Ghost(GhostId("1"), 1) == 1\n}'), [], 'an orphan, read');
  const { id, model } = importFixture('course-simple');
  const text = swap(modelToSource(model()), '  emit CourseArchived { courseId }\n\n  scenarios {\n',
    '  emit CourseArchived { courseId }\n\n  scenarios {\n    scenario {\n      given CourseBurnt { courseId: "c1" }\n      when ArchiveCourse { courseId: "c1" }\n    }\n\n');
  const report = sandbox.sourceScenarioReport(model(), parseModelSource(text));
  eq(report.errors.length, 1, 'a scenario with nothing to record');
  eq(report.errors[0].message.startsWith('No outcome – cannot run: Given step 1 records "CourseBurnt"'), true, report.errors[0].message);
  eq(report.errors[0].fix, undefined, 'nothing to write in');
  const before = loadEvents().length;
  let refused = null;
  try { applyModelSource(id, text); } catch (error) { refused = error; }
  eq(refused instanceof sandbox.DomainError, true, 'refused');
  eq(loadEvents().length, before, 'nothing appended');
});

check('the draft is advised on before it is applied', () => {
  const { model } = buildText();
  const text = swap(modelToSource(model()), 'emit CourseArchived { courseId }', 'emit CourseBurnt { courseId }');
  const parsed = parseModelSource(text);
  const all = sourceAdvisories(model(), parsed);
  eq(all.filter((a) => UNEMITTED.test(a.message)).map((a) => a.name), ['CourseArchived'], 'nothing emits CourseArchived now');
  const found = all.filter((a) => !UNEMITTED.test(a.message));
  eq(found.length, 1, JSON.stringify(found));
  eq(found[0].name, 'ArchiveCourse', 'on the command');
  const span = sourceSpanAt(parsed, text.split('\n').findIndex((l) => l.includes('CourseBurnt')) + 1);
  eq([span.kind, span.name], ['command-definition', 'ArchiveCourse'], 'the line belongs to it');
});

// ---------------------------------------------------------------
// Groups.
// ---------------------------------------------------------------

check('a group owns its projections, and they read as the stored shape', () => {
  const parsed = parseModelSource(GROUPS_MORE);
  eq(parsed.diagnostics, [], 'it reads');
  const course = parsed.collections['group-definition'].Course;
  eq([course.icon, course.tag], ['📚', { name: 'courseId', tagType: 'CourseId' }], 'its icon and its one tag');
  eq(course.projections.map((p) => p.name), ['status', 'capacity', 'subscriptionCount', 'slots', 'remaining', 'hasRoomFor', 'studentsAtLimit'],
    'its projections, by local name, in order');
  eq(course.projections.some((p) => p.tags !== undefined), false, 'none with tags of its own');
  const inner = (name) => course.projections.find((p) => p.name === name);
  eq(inner('remaining').derived, { leftHandSide: { projection: 'capacity' }, operator: 'subtract', rightHandSide: { projection: 'subscriptionCount' } },
    'siblings, named bare');
  eq(inner('hasRoomFor').derived.rightHandSide, { parameterName: 'seats' }, 'beside its own argument');
  eq(inner('studentsAtLimit').derived.leftHandSide,
    { projection: 'StudentSubscriptionTotal', tags: { courseId: { parameterName: 'courseId' } } }, 'the group\'s tag passed on');
  eq(Object.keys(parsed.collections['projection-definition']), ['StudentSubscriptionTotal'], 'no grouped projection at the top level');
  eq(parsed.spans.filter((span) => span.group === 'Course').map((span) => span.name).slice(0, 2), ['Course.status', 'Course.capacity'],
    'each has a span, by its qualified name');
  const line = GROUPS_MORE.split('\n').findIndex((l) => l.includes('capacity - subscriptionCount')) + 1;
  eq(sourceSpanAt(parsed, line).name, 'Course.remaining', 'found before its group\'s');

  const subscribe = lists(parsed.collections['command-definition'].SubscribeStudentToCourse);
  eq(subscribe.boundary, [
    { alias: 'course', group: 'Course', tags: { courseId: { parameterName: 'courseId' } } },
    { alias: 'student', group: 'Student', tags: { studentId: { parameterName: 'studentId' } } },
    { alias: 'others', group: 'Course', tags: { courseId: { each: { alias: 'student', property: 'subscribedCourseIds' } } } },
    { alias: 'left', projection: 'Course.remaining', tags: { courseId: { parameterName: 'courseId' } } },
  ], 'a group read, fanned out, and a grouped projection bound on its own');
  eq(subscribe.conditions[2].leftHandSide, { alias: 'course', property: 'hasRoomFor', arguments: { seats: 1 } },
    'its arguments on the projection, by name');
  eq(lists(parsed.collections['command-definition'].DefineCourse).conditions[0].leftHandSide,
    { projection: 'Course.status', tags: { courseId: { parameterName: 'courseId' } } }, 'read in place');
  const scenario = parsed.scenarios.find((r) => r.kind === 'projection-scenario-definition');
  eq([scenario.block.name, scenario.body.projection, scenario.body.tags],
    ['Course.status', 'Course.status', { courseId: { tagType: 'CourseId', tagValue: 'c1' } }], 'a scenario in its block, in the group');
  eq(parseModelSource('tag type XId = string\ngroup X (tag xId: XId) {}\n').collections['group-definition'].X,
    { tag: { name: 'xId', tagType: 'XId' }, projections: [] }, 'an empty group');
});

check('a group, read wrongly or in an old spelling, says what to write', () => {
  const head = 'tag type CourseId = string\nevent E { tag courseId: CourseId }\n';
  const group = 'group Course (tag courseId: CourseId) {\n  projection seats (slot: string): integer = 0 {}\n}\n';
  const errors = (body) => parseModelSource(head + body).diagnostics.map((d) => d.message);
  const rule = (operand) => errors(`${group}command C(courseId: CourseId) {\n  alias course = Course(courseId)\n`
    + `  require ${operand} > 1 else reject "No"\n  emit E { courseId }\n}\n`);
  eq(rule('course.seats(slot: "a")'), [], 'a projection\'s arguments, by name');
  eq(rule('Course(courseId).seats(slot: "a")'), [], 'in place too');
  eq(rule('course.seats("a")'), ['A group\'s projection takes its arguments by name: seats(name: …).'], 'never in order');
  eq(rule('Course(courseId, slot: "a").seats'), ['Arguments go on the projection, not on the group: Course(…).seats(name: …).'],
    'nor on the group');
  eq(rule('Course(courseId)'), ['Course is a group – read one of its projections: Course(…).name.'], 'a group is no value');
  eq(rule('Course(courseId, courseId).seats'), ['Course is read by its one tag, courseId – this gives 2 values.'], 'one tag');
  eq(rule('courseId.x(a: 1)'), ['courseId is a payload property – only a group\'s projection takes arguments.'], 'a field takes none');
  eq(errors('group Course {}'), ['Say what Course\'s projections are read by – one tag: group Course (tag courseId: CourseId).'], 'its tag, said');
  eq(errors('group Course (tag courseId: CourseId, tag x: X) {}'),
    ['A group has one tag – a projection read by several stays outside any group.'], 'one tag');
  eq(errors('group Course (tag courseId: CourseId) {\n  projection p (tag x: CourseId): integer = 0 {}\n}'),
    ['Course.p is read by its group\'s tag, courseId – it declares none of its own. A projection read by other tags stays outside the group.'],
    'no tag of its own');
  eq(errors('group Course (tag courseId: CourseId) {\n  projection Seats: integer = 0 {}\n}'),
    ['Seats is capitalised – a projection in a group is named in lowerCamel, as it is read (projection seats …); a top-level one goes after the group\'s "}".'],
    'lowercase');
  eq(errors('group Course (tag courseId: CourseId) {\n  untagged projection p: integer = 0 {}\n}'),
    ['A group\'s projections are read by its tag, courseId – an untagged projection stays outside it.'], 'never untagged');
  eq(errors('group Course (tag courseId: CourseId) {\n  projection p: integer = 0 {}\n  projection p: integer = 1 {}\n}'),
    ['Course already has a projection named p – one of the two has to go.'], 'a local name once');
  eq(errors('group Course (tag courseId: CourseId) {\n  projection p: integer = 0 {\n}\nprojection Q (tag courseId: CourseId): integer = 0 {}\n'),
    ['Expected "}" before the next declaration.'], 'a group left open ends where the next declaration starts');
  eq(errors('derived projection P (tag courseId: CourseId): integer {\n  seats(slot: "a") - 1\n}'),
    ['seats(…) would read a sibling, and only a projection in a group has siblings.'], 'a sibling only in a group');

  // 10.0's spellings, each answered with what replaced it.
  eq(errors('entity Course (tag courseId: CourseId) {\n  status = CourseStatus\n}'),
    ['"entity" is gone – a group owns the projections it names: group Course (tag courseId: CourseId) { projection status: … }.'], 'entity');
  eq(errors('group Course (tag courseId: CourseId) {\n  lifecycle status\n}'),
    ['A group has no lifecycle – a lifecycle is an ordinary projection its rules read: projection status: … { … }.'], 'lifecycle');
  eq(errors('group Course (tag courseId: CourseId) {\n  status = CourseStatus\n}'),
    ['A group owns its projections – declare status in it: projection status: … { … }.'], 'a binding of a top-level projection');
  eq(errors(`${group}command C(courseIds: CourseId[], courseId: CourseId) {\n  alias others = Course(each courseIds) excluding courseId\n  emit E { courseId }\n}\n`),
    ['"excluding" is gone – a fan-out reads every element of its list; a rule over it says what to leave out.'], 'excluding');
});

check('what 11.0 removed is an error where it is written, saying so', () => {
  const head = 'tag type CourseId = string\nevent E { tag courseId: CourseId }\n';
  const errors = (body) => parseModelSource(head + body).diagnostics.map((d) => d.message);
  const at = (body) => parseModelSource(head + body).diagnostics.map((d) => [d.line, d.col]);
  const scripted = 'scripted projection P (tag courseId: CourseId): integer {\n  initialState 0\n  on E => ```state + 1```\n}\n';
  eq(errors(scripted), ['"scripted" is gone – 11.0 runs no code: a projection is folded by its handlers\' operations, or derived.'],
    'a scripted projection');
  eq(at(scripted), [[3, 1]], 'at the keyword');
  eq(errors('group G (tag courseId: CourseId) {\n  scripted projection p: integer {}\n}\n'),
    ['"scripted" is gone – 11.0 runs no code: a projection is folded by its handlers\' operations, or derived.'], 'in a group too');
  eq(errors('projection P (tag courseId: CourseId): integer = 0 {\n  on E => ```state + 1```\n}\n'),
    ['A handler runs no code in 11.0 – it is an operation: set, increment, decrement, append or remove.'], 'a code handler');
  eq(errors('projection P (tag courseId: CourseId): integer = 0 {\n  on E => set currentValue\n}\n'),
    ['"currentValue" is gone – a handler\'s value comes from the event (event.data.x), a literal or successor(…).'], 'currentValue');
  eq(errors('command C(courseId: CourseId) {\n  emit E { courseId }\n    when courseId == "c1"\n}\n'),
    ['"when" on an emission is gone – 11.0 has no guarded emissions: "if … => emit …" emits under a condition.'],
    'a guarded emission');
  eq(errors('projection P (tag courseId: CourseId): integer = 0 {}\ncommand C(courseId: CourseId) {\n  alias p? = P(courseId)\n  emit E { courseId }\n}\n'),
    ['"p?" is gone – 11.0 has no optional reads: a read needs a value for each of its tags.'], 'an optional read');
});

check('an edit inside a group is one update of the group', () => {
  const { id, model } = buildText(GROUPS_MORE);
  const text = swap(modelToSource(model()), '    remaining >= seats', '    remaining > seats');
  const summary = applyModelSource(id, text);
  eq(summary.updated, [{ kind: 'group-definition', name: 'Course' }], 'the group, updated');
  eq(model()['group-definitions'].Course.projections.find((p) => p.name === 'hasRoomFor').derived.predicate, 'greaterThan', 'as written');
  const moved = swap(modelToSource(model()), '  projection slots: TimeSlot[] = [] {\n    on CourseDefined => set event.data.slots\n  }\n\n', '');
  let refused = null;
  try { applyModelSource(id, moved); } catch (error) { refused = error; }
  eq(refused, null, 'a projection taken out of a group applies');
  eq(sandbox.modelAdvisories(model()).some((a) => /slots/.test(a.message)), true, 'and its reads dangle, as advisories');
  const clash = parseModelSource(GROUPS_MORE + '\nprojection Course (tag courseId: CourseId): integer = 0 {}\n');
  eq(clash.diagnostics, [], 'a group and a projection sharing a name read');
  let shared = null;
  try { applyModelSource(id, GROUPS_MORE + '\nprojection Course (tag courseId: CourseId): integer = 0 {}\n'); } catch (error) { shared = error; }
  eq(shared instanceof sandbox.DomainError && /both named "Course"/.test(shared.message), true, 'and are refused together: ' + shared);
});

check('a read of a group\'s projection in place becomes an alias of it', () => {
  const out = introduceAt(GROUPS_MORE, 'require Course(courseId).status', 'require Cou'.length);
  eq(out.error, undefined, 'offered');
  eq(out.name, 'status', 'named by its local name');
  eq(out.text.includes('  alias status = Course(courseId).status\n  require status == NonExistent'), true, 'declared, and used');
  eq(parseModelSource(out.text).collections['command-definition'].DefineCourse.boundary,
    [{ alias: 'status', projection: 'Course.status', tags: { courseId: { parameterName: 'courseId' } } }], 'bound on its own');
});

check('a group\'s projection scenario completes and fixes like any other', () => {
  const { model } = buildText(GROUPS_MORE);
  const text = swap(modelToSource(model()), 'then Course(CourseId("c1")).status == Existent', 'then Course(CourseId("c1")).status');
  const [error] = sandbox.sourceScenarioReport(model(), parseModelSource(text)).errors;
  eq(error.message, 'No outcome yet – the model now does:\nthen Course(CourseId("c1")).status == Existent', error.message);
  eq(withEdits(text, [error.fix]), modelToSource(model()), 'the line written whole');
  const offered = completeAt(swap(modelToSource(model()), '        then Course(CourseId("c1")).status == Existent', '        |'), { model: model() })
    .items.filter((i) => i.detail === 'what the model does').map((i) => i.insert);
  eq(offered, ['then Course(CourseId("c1")).status == Existent'], 'offered with each tag value the given events carry');
});

// ---------------------------------------------------------------
// The language service.
// ---------------------------------------------------------------

// Every shipped text, printed: the predefined models and the fixtures.
function shippedTexts() {
  const texts = PREDEFINED_MODELS.map((entry, index) => [entry.slug, modelToSource(build(index).model())]);
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.dcb.json'))) {
    texts.push([file, modelToSource(importFixture(file.replace(/\.dcb\.json$/, '')).model())]);
  }
  texts.push(['groups', GROUPS], ['more groups', GROUPS_MORE]);
  return texts;
}

// 1-based line and column of `needle` (plus `offset`) in a text.
function positionOf(text, needle, offset = 0) {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`"${needle}" is not in the text`);
  const before = text.slice(0, index + offset);
  return [before.split('\n').length, before.length - before.lastIndexOf('\n')];
}

function renameAt(text, needle, offset, to) {
  const [line, col] = positionOf(text, needle, offset);
  const result = sandbox.sourceRename(text, line, col, to);
  return result.error ? result : { text: sandbox.sourceApplyEdits(text, result.edits) };
}

// The text up to a cursor written as `|`, completed there.
function completeAt(source, options) {
  const at = source.indexOf('|');
  const text = source.slice(0, at) + source.slice(at + 1);
  const before = text.slice(0, at);
  const result = sandbox.sourceCompletions(text, before.split('\n').length, at - before.lastIndexOf('\n'), options);
  return { labels: result.items.map((i) => i.label), items: result.items, slot: result.slot };
}

check('an event marks its tags in place, and a rename follows them', () => {
  const text = [
    'model "Tags"',
    'tag type ProductId = string',
    'tag type OrderId = string',
    'record Line { productId: ProductId, qty: integer }',
    'event Ordered { tag orderId: OrderId, lines: Line[] tag each productId, first: Line tag productId }',
    '',
  ].join('\n');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'it reads');
  eq(parsed.collections['event-definition'].Ordered.tags, ['orderId', 'lines.productId', 'first.productId'], 'as paths');
  eq(renameAt(text, 'lines: Line', 0, 'items').text.includes('items: Line[] tag each productId'), true,
    'the property, renamed, keeps its mark');
  eq(parseModelSource(renameAt(text, 'lines: Line', 0, 'items').text).collections['event-definition'].Ordered.tags,
    ['orderId', 'items.productId', 'first.productId'], 'and its path moves');
  eq(renameAt(text, 'Line { productId', 'Line { '.length, 'product').text.includes('lines: Line[] tag each product,'), true,
    'and so does the record field');
  eq(modelToSource({ name: 'T', 'custom-type-definitions': {}, 'event-definitions': { E: { properties: [], tags: [] } },
    'group-definitions': {}, 'projection-definitions': {}, 'command-definitions': {},
    'scenario-definitions': {}, 'projection-scenario-definitions': {} }).includes('event E {}\n'), true,
    'no tags, no marks');
  const errors = (source) => parseModelSource(source).diagnostics.map((d) => d.message);
  eq(errors('event E { lines: Line[] tag productId }'), ['lines holds a list, so it is tagged by each element: tag each <field>.'], 'each, for a list');
  eq(errors('event E { line: Line tag each productId }'), ['line holds one record – "each" is for a list: tag <field>.'], 'and only there');
  eq(errors('event E { courseId: CourseId } tags courseId'), ['An event marks its tags in place: tag courseId: CourseId.'], 'the draft spelling');
  eq(parseModelSource('event E { tag: string, tag tagged: CourseId }').collections['event-definition'].E,
    { properties: [{ name: 'tag', propertyType: 'string', isOptional: false, isList: false },
      { name: 'tagged', propertyType: 'CourseId', isOptional: false, isList: false }], tags: ['tagged'] },
    'a property called tag is a property');
});

check('a read gives its values in parentheses – in declared order, a literal with its type', () => {
  const text = [
    'model "Tags"',
    'tag type CourseId = string',
    'tag type StudentId = string',
    'event Subscribed { tag courseId: CourseId, tag studentId: StudentId }',
    'projection Both (tag courseId: CourseId, tag studentId: StudentId): integer = 0 {',
    '  on Subscribed => increment 1',
    '}',
    'projection PerCourse (tag courseId: CourseId): integer = 0 {',
    '  on Subscribed => increment 1',
    '}',
    'untagged projection All: integer = 0 {',
    '  on Subscribed => increment 1',
    '}',
    'command C(courseId: CourseId, studentId: StudentId) {',
    '  alias both = Both(courseId, studentId)',
    '  alias one = PerCourse(CourseId("c1"))',
    '  alias all = All()',
    '  require both < one',
    '    else reject "No"',
    '  require all < 100',
    '    else reject "Full"',
    '  emit Subscribed { courseId, studentId }',
    '}',
    '',
  ].join('\n');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'it reads');
  eq(parsed.collections['projection-definition'].Both.tags,
    [{ name: 'courseId', tagType: 'CourseId' }, { name: 'studentId', tagType: 'StudentId' }], 'a projection names its tags');
  eq(parsed.collections['projection-definition'].All.tags, [], 'and untagged, none');
  const boundary = parsed.collections['command-definition'].C.boundary;
  eq(boundary[0].tags, { courseId: { parameterName: 'courseId' }, studentId: { parameterName: 'studentId' } }, 'two tags, by name');
  eq(boundary[1].tags, { courseId: { tagType: 'CourseId', tagValue: 'c1' } }, 'a literal with its type');
  eq('tags' in boundary[2], false, 'and none: the whole log');
  const renamed = renameAt(text, 'tag type CourseId', 'tag type '.length, 'CourseKey').text;
  eq(renamed.includes('alias one = PerCourse(CourseKey("c1"))'), true, 'a literal\'s type renames with the type');
  eq(renamed.includes('projection PerCourse (tag courseId: CourseKey)'), true, 'and so does a declared tag');
  const tag = renameAt(text, 'PerCourse (tag courseId', 'PerCourse (tag '.length, 'course').text;
  eq(parseModelSource(tag).collections['command-definition'].C.boundary[1].tags, { course: { tagType: 'CourseId', tagValue: 'c1' } },
    'a tag renamed in its declaration names the reads\' values anew');
  const errors = (source) => parseModelSource(swap(text, 'alias one = PerCourse(CourseId("c1"))', source)).diagnostics.map((d) => d.message);
  eq(errors('alias one = PerCourse(courseId, studentId)'), ['PerCourse takes 1 value (courseId) – this gives 2.'], 'as many values as it declares');
  eq(errors('alias one = PerCourse'), ['PerCourse is read with its values in parentheses – PerCourse(…), empty for an untagged projection.'], 'parentheses, always');
  eq(errors('alias one = PerCourse(courseId: courseId)'), ['A read gives its values in order, as PerCourse declares them – no names.'], 'in order');
});

check('a projection says what it is tagged by, or that it is untagged', () => {
  const text = 'event E {}\nprojection P: integer = 0 {}\n';
  const { diagnostics } = parseModelSource(text);
  eq(diagnostics.map((d) => d.message), ['Say what P is tagged by – projection P (tag pId: …) – or that it is untagged.'], 'neither is an error');
  eq(parseModelSource(sandbox.sourceApplyEdits(text, [diagnostics[0].fix])).diagnostics, [], 'whose fix declares it untagged');
  const errors = (source) => parseModelSource(source).diagnostics.map((d) => d.message);
  eq(errors('untagged projection P (tag id: CourseId): integer = 0 {}'), ['P is declared untagged and tagged by id – one or the other.'], 'not both');
  eq(errors('projection P (days: integer, tag id: CourseId): integer = 0 {}'), ['Tags come first – a read gives the tags, then the arguments.'], 'tags first');
  // A declared projection's handlers cannot see an argument; that is
  // the advisories' to say, so the text still reads it.
  eq(errors('projection P (tag id: CourseId, days: integer): integer = 0 {}'), [], 'arguments parse on any projection');
  eq(errors('projection P (tag id: CourseId): integer = 0 {\n  initialState 0\n}'),
    ['Expected "on" or scenarios, found "initialState".'], 'a script\'s state is no word of the block');
  eq(errors('command C(courseId: CourseId) {\n  require P tagged courseId == 1 else reject "No"\n}'),
    ['A read gives its values in parentheses, in the order P declares them: P(…).'], 'the draft spelling');
  eq(errors('group Course {}'), ['Say what Course\'s projections are read by – one tag: group Course (tag courseId: CourseId).'], 'a group too');
  const derived = parseModelSource('tag type CourseId = string\nprojection Q (tag id: CourseId): integer = 0 {}\n'
    + 'derived projection P (tag id: CourseId, days: integer): integer {\n  Q(id) - days\n}\n');
  eq(derived.diagnostics, [], 'arguments follow the tags');
  eq(derived.collections['projection-definition'].P.arguments, [{ name: 'days', propertyType: 'integer' }], 'and are stored as the projection\'s arguments');
});

check('a derived projection compares, computes and passes on its own parameters by name', () => {
  const text = 'tag type CourseId = string\n'
    + 'projection Taken (tag courseId: CourseId): integer = 0 {}\n'
    + 'derived projection FreeAfter (tag courseId: CourseId, taken: integer): integer {\n  20 - taken\n}\n'
    + 'derived projection Fits (tag courseId: CourseId, seats: integer): boolean {\n  FreeAfter(courseId, seats) >= Taken(courseId)\n}\n'
    + 'derived projection Wants (tag courseId: CourseId, seats: integer): boolean {\n  Taken(courseId) < seats\n}\n';
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'parses');
  const projections = parsed.collections['projection-definition'];
  eq(projections.Fits.arguments, [{ name: 'seats', propertyType: 'integer' }], 'an argument on a derived projection');
  eq(projections.Fits.derived.leftHandSide,
    { projection: 'FreeAfter', tags: { courseId: { parameterName: 'courseId' } }, arguments: { taken: { parameterName: 'seats' } } },
    'passed on as an operand\'s argument');
  eq(projections.Wants.derived.rightHandSide, { parameterName: 'seats' }, 'a side');
  eq(projections.FreeAfter.derived, { leftHandSide: 20, operator: 'subtract', rightHandSide: { parameterName: 'taken' } },
    'computed with');
  fresh();
  const id = sandbox.createDcbModel('Parameters');
  applyModelSource(id, text);
  const model = projectState()[id];
  eq(Object.keys(model['projection-definitions']).sort(), ['Fits', 'FreeAfter', 'Taken', 'Wants'], 'applied');
  eq(modelToSource(model).includes('derived projection Fits (tag courseId: CourseId, seats: integer): boolean {\n'
    + '  FreeAfter(courseId, seats) >= Taken(courseId)\n}'), true, 'and printed back the same');
});

check('a derived projection says so in front, and holds one expression', () => {
  const head = 'tag type CourseId = string\nprojection Cap (tag courseId: CourseId): integer = 0 {}\n'
    + 'projection Taken (tag courseId: CourseId): integer = 0 {}\n';
  const derived = (expression, type = 'integer') => parseModelSource(head
    + `derived projection Left (tag courseId: CourseId): ${type} {\n  ${expression}\n}\n`);
  const own = { courseId: { parameterName: 'courseId' } };
  const read = (projection) => ({ projection, tags: own });
  for (const [symbol, operator] of [['+', 'add'], ['-', 'subtract'], ['*', 'multiply']]) {
    const parsed = derived(`Cap(courseId) ${symbol} Taken(courseId)`);
    eq(parsed.diagnostics, [], `${symbol} parses`);
    eq(parsed.collections['projection-definition'].Left.derived,
      { leftHandSide: read('Cap'), operator, rightHandSide: read('Taken') }, `${symbol} is ${operator}`);
  }
  for (const operator of ['min', 'max']) {
    eq(derived(`${operator}(Cap(courseId), 10)`).collections['projection-definition'].Left.derived,
      { leftHandSide: read('Cap'), operator, rightHandSide: 10 }, `${operator}(…) is ${operator}`);
  }
  eq(derived('Cap(courseId) -1').collections['projection-definition'].Left.derived.operator, 'subtract',
    'a minus straight after a value subtracts');
  eq(derived('Cap(courseId) == -1', 'boolean').collections['projection-definition'].Left.derived,
    { leftHandSide: read('Cap'), predicate: 'equals', rightHandSide: -1 }, 'and after a comparison it is a sign');
  eq(derived('not Cap(courseId) > Taken(courseId)', 'boolean').collections['projection-definition'].Left.derived,
    { leftHandSide: read('Cap'), predicate: 'greaterThan', rightHandSide: read('Taken'), negate: true }, 'a comparison');
  const body = derived('Cap(courseId) - Taken(courseId)').collections['projection-definition'].Left;
  eq(body.handlers, undefined, 'a derived projection has no handlers');
  eq(body.initialValue, undefined, 'and no initial value');
  const errors = (source) => parseModelSource(head + source).diagnostics.map((d) => d.message);
  eq(errors('projection Left (tag courseId: CourseId): boolean\n  derived Cap(courseId) > 1\n'),
    ['"derived" goes in front, and what it derives in the block: derived projection Left (…): boolean { … }.'], 'the old spelling');
  eq(errors('derived projection Left (tag courseId: CourseId): integer = 0 {\n  Cap(courseId) - 1\n}\n'),
    ['A derived projection has no initial value – before any event it is what its operands start at.'], 'no initial value');
  eq(errors('derived projection Left (tag courseId: CourseId): integer {\n  Cap(courseId) - 1\n  on E => set 1\n}\n'),
    ['A derived projection\'s block holds what it derives, then its scenarios – found "on".'], 'nothing else in its block');
  eq(errors('derived untagged projection Left: integer {\n  max(1, 2)\n}\n'),
    ['"untagged" comes first: untagged derived projection …'], 'untagged leads');
  eq(parseModelSource('untagged derived projection Total: integer {\n  max(1, 2)\n}\n').diagnostics, [], 'untagged, then derived');
  const untagged = parseModelSource(head + 'derived projection Left: integer {\n  min(1, 2)\n}\n');
  eq(parseModelSource(sandbox.sourceApplyEdits(head + 'derived projection Left: integer {\n  min(1, 2)\n}\n',
    [untagged.diagnostics[0].fix])).diagnostics, [], 'the untagged fix goes in front of the kind');
});

check('a rule reads a projection in place – no alias needed', () => {
  const text = [
    'model "Inline"',
    'enum CourseStatus { NonExistent, Existent }',
    'tag type CourseId = string',
    'tag type OwnerId = string',
    'event CourseDefined { tag courseId: CourseId, tag ownerId: OwnerId }',
    'projection CourseStatus (tag courseId: CourseId): CourseStatus = NonExistent {',
    '  on CourseDefined => set Existent',
    '}',
    'projection CourseOwner (tag courseId: CourseId): OwnerId = null {',
    '  on CourseDefined => set event.data.ownerId',
    '}',
    'projection OwnedCourses (tag ownerId: OwnerId): integer = 0 {',
    '  on CourseDefined => increment 1',
    '}',
    'untagged projection CourseNumbering: CourseId = "c1" {',
    '  on CourseDefined => set successor(event.data.courseId)',
    '}',
    'command Define(ownerId: OwnerId) {',
    '  require OwnedCourses(ownerId) < 3',
    '    else reject "Too many"',
    '  emit CourseDefined { courseId: CourseNumbering(), ownerId }',
    '}',
    'command Check(courseId: CourseId) {',
    '  require CourseStatus(courseId) == Existent',
    '    else reject "No such course"',
    '  require OwnedCourses(CourseOwner(courseId)) < 3',
    '    else reject "Its owner has too many"',
    '  emit CourseDefined { courseId, ownerId: CourseOwner(courseId) }',
    '}',
    '',
  ].join('\n');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'it reads');
  const check = lists(parsed.collections['command-definition'].Check);
  eq(check.conditions[0].leftHandSide, { projection: 'CourseStatus', tags: { courseId: { parameterName: 'courseId' } } }, 'a read in place');
  eq(check.conditions[0].rightHandSide, { enumMember: 'Existent' }, 'beside an enum member, which is not a projection');
  eq(check.conditions[1].leftHandSide.tags.ownerId, { projection: 'CourseOwner', tags: { courseId: { parameterName: 'courseId' } } }, 'nested');
  eq(lists(parsed.collections['command-definition'].Define).publishes[0].parameters.courseId, { projection: 'CourseNumbering' },
    'an untagged read');
  eq(parseModelSource(swap(text, 'courseId: CourseNumbering()', 'courseId: CourseNumbering')).diagnostics.map((d) => d.message),
    ['CourseNumbering is a projection – read it as CourseNumbering(…).'], 'a projection bare is an error, with its fix');
  // Round trip: printed as it was written.
  const { id, model } = (() => {
    const modelId = sandbox.createDcbModel('Inline');
    applyModelSource(modelId, text);
    return { id: modelId, model: () => projectState()[modelId] };
  })();
  const printed = modelToSource(model());
  eq(printed.includes(' json {'), false, 'no fallback');
  eq(printed.includes('require OwnedCourses(CourseOwner(courseId)) < 3'), true, 'nested');
  eq(printed.includes('emit CourseDefined { courseId: CourseNumbering(), ownerId }'), true, 'in an emission');
  // Evaluated: the rules read what they name.
  let log = [];
  const run = (command, args) => {
    const result = sandbox.evaluateCommand(model(), log, command, args);
    if (result.outcome === 'published') log = [...log, ...result.events];
    return result;
  };
  eq(run('Define', { ownerId: 'o1' }).events[0].data.courseId, 'c1', 'minted inline');
  eq(run('Check', { courseId: 'c1' }).outcome, 'published', 'the course exists, its owner has one');
  eq(run('Check', { courseId: 'c9' }).failedRule.rejection, 'No such course', 'and refused by the inline read');
  // The boundary: the nested read is a query after the one it waits for.
  const summary = sandbox.boundarySummary(model(), model()['command-definitions'].Check);
  eq(summary.queries.length, 2, 'two queries: the owner, then what it owns');
  eq(summary.queries[0].map((i) => i.projection).sort(), ['CourseOwner', 'CourseStatus'], 'the first');
  eq(summary.queries[1].map((i) => i.projection), ['OwnedCourses'], 'the second');
  // A rename reaches into it.
  const renamed = renameAt(printed, 'projection CourseOwner', 'projection '.length, 'CourseHolder').text;
  eq(renamed.includes('OwnedCourses(CourseHolder(courseId))'), true, 'renamed in place');
});

check('a read fans out where it says so – each, paired by index with its list', () => {
  const text = [
    'model "Fan"',
    'type Money = number { minimum: 0 }',
    'tag type ProductId = string',
    'tag type OrderId = string',
    'record Item { productId: ProductId, price: Money }',
    'event ProductDefined { tag productId: ProductId, price: Money }',
    'event ProductsOrdered { tag orderId: OrderId, items: Item[] tag each productId }',
    'projection ProductExists (tag productId: ProductId): boolean = false {',
    '  on ProductDefined => set true',
    '}',
    'projection ProductPrice (tag productId: ProductId): Money = null {',
    '  on ProductDefined => set event.data.price',
    '}',
    'command OrderProducts(orderId: OrderId, items: Item[]) {',
    '  alias exists = ProductExists(each items.productId)',
    '  require exists is true',
    '    else reject "Product does not exist"',
    '  require ProductPrice(each items.productId) == items.price',
    '    else reject "Price has changed"',
    '  emit ProductsOrdered { orderId, items }',
    '}',
    '',
  ].join('\n');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'it reads');
  const body = parsed.collections['command-definition'].OrderProducts;
  eq(body.boundary[0].tags, { productId: { each: { parameterName: 'items', property: 'productId' } } }, 'each, stored on the tag');
  const id = sandbox.createDcbModel('Fan');
  applyModelSource(id, text);
  const model = () => projectState()[id];
  eq(advisedOtherwise(model()), [], 'advisory-clean');
  const printed = modelToSource(model());
  eq(printed.includes('alias exists = ProductExists(each items.productId)'), true, 'printed as written');
  eq(printed.includes('require ProductPrice(each items.productId) == items.price'), true, 'in place too');
  const log = [
    { type: 'ProductDefined', data: { productId: 'p1', price: 10 } },
    { type: 'ProductDefined', data: { productId: 'p2', price: 20 } },
  ];
  const order = (items) => sandbox.evaluateCommand(model(), log, 'OrderProducts', { orderId: 'o1', items });
  eq(order([{ productId: 'p1', price: 10 }, { productId: 'p2', price: 20 }]).outcome, 'published', 'every price holds');
  eq(order([{ productId: 'p1', price: 10 }, { productId: 'p2', price: 25 }]).failedRule.rejection, 'Price has changed',
    'one wrong price refuses – paired with its own line');
  eq(order([{ productId: 'p1', price: 10 }, { productId: 'p9', price: 1 }]).failedRule.rejection, 'Product does not exist',
    'one unknown product refuses');
  eq(order([]).outcome, 'published', 'and over no lines, it holds vacuously');
  const items = sandbox.deriveDcb(model(), model()['command-definitions'].OrderProducts).items;
  eq(items.every((item) => item.fannedOut && item.tags[0] === 'ProductId:{each items.productId}'), true,
    'the query says it fans out');
  const bad = sandbox.createDcbModel('Bad');
  applyModelSource(bad, swap(text, 'require ProductPrice(each items.productId)', 'require ProductPrice(each orderId)'));
  eq(advisedOtherwise(projectState()[bad]).some((a) => /orderId is one value – "each" fans out over a list/.test(a.message)),
    true, 'each over one value is advised: ' + advisedOtherwise(projectState()[bad]).map((a) => a.message).join('; '));
  const mistyped = sandbox.createDcbModel('Mistyped');
  applyModelSource(mistyped, swap(text, 'require ProductPrice(each items.productId)', 'require ProductPrice(orderId)'));
  eq(advisedOtherwise(projectState()[mistyped]).some((a) => /orderId, an OrderId – but its "productId" tag is a ProductId/.test(a.message)),
    true, 'a value of another tag type is advised: ' + advisedOtherwise(projectState()[mistyped]).map((a) => a.message).join('; '));
});

check('the code view says what is experimental, and offers none of it with the flag off', () => {
  const grouped = modelToSource(buildText().model());
  eq(sandbox.sourceExperimentalMarks(grouped), [], 'a group is nothing experimental');
  eq(grouped.includes('@feature('), true, 'the model has feature groups');
  for (const slug of ['course-simple', 'pricing-simple', 'content-decisions-derived', 'developer-hours']) {
    eq(sandbox.sourceExperimentalMarks(modelToSource(build(PREDEFINED_MODELS.findIndex((m) => m.slug === slug)).model())), [],
      `${slug} uses nothing experimental`);
  }
  const at = (text, options) => {
    const offset = text.indexOf('|');
    const clean = text.slice(0, offset) + text.slice(offset + 1);
    const before = clean.slice(0, offset);
    return sandbox.sourceCompletions(clean, before.split('\n').length, offset - before.lastIndexOf('\n'), options)
      .items.map((i) => i.label);
  };
  eq(at('|', { experimental: false }).includes('group'), true, 'a group is offered with the flag off');
  const groupBody = 'tag type XId = string\ngroup X (tag xId: XId) {\n  |\n}\n';
  eq(at(groupBody, { experimental: false }), ['projection', 'derived projection'], 'and its projections');
  eq(at(groupBody, { experimental: true }), ['projection', 'derived projection'], 'the same with the flag on');
  eq(at('@|', { experimental: false }), ['icon', 'feature', 'tagSchema', 'sensitive', 'deprecated', 'assumption', 'external', 'unresolved'], 'no annotation is experimental');
  eq(at('|', { experimental: false }).includes('derived projection'), true, 'derived projections are offered');
  eq(at('|', { experimental: true }).includes('scripted projection'), false, 'and nothing scripted, flag or not');
  const head = 'tag type CourseId = string\nprojection Cap (tag courseId: CourseId): integer = 0 {}\n';
  const derived = (body) => `${head}derived projection Left (tag courseId: CourseId): integer {\n  ${body}\n}\n`;
  eq(at(derived('|')), ['min', 'max', 'scenarios', 'Cap', 'courseId'], 'a derived block opens with what it derives from');
  eq(at(derived('Cap(courseId) - |')), ['Cap', 'courseId'], 'either side of an operator is a read, or its own parameter');
  eq(at(derived('min(|')), ['Cap', 'courseId'], 'and either side of min(…)');
  eq(at(derived('Cap(|')), ['courseId'], 'a read takes this projection\'s own parameters');
  const withSeats = (body) => `${head}derived projection Left (tag courseId: CourseId, seats: integer): integer {\n  ${body}\n}\n`;
  eq(at(withSeats('Cap(courseId) - |')), ['Cap', 'courseId', 'seats'], 'an argument is one of them');
  eq(at(`${head}projection S (tag courseId: CourseId): integer = 0 {\n  |\n}\n`), ['on', 'scenarios'],
    'a projection\'s block holds handlers and scenarios');
});

check('every name in every shipped text resolves to a symbol', () => {
  // JSON Schema keywords are not model names.
  const notNames = new Set([...sandbox.SOURCE_KEYWORDS, ...sandbox.SOURCE_BASE_TYPES, 'number', 'icon', 'feature', 'tagSchema',
    'data', 'pattern', 'minimum']);
  for (const [slug, text] of shippedTexts()) {
    const parsed = parseModelSource(text);
    const { occurrences, ambiguous } = sandbox.sourceSymbols(parsed);
    const key = (t) => `${t.line}:${t.col}`;
    const resolved = new Set([...occurrences, ...ambiguous].map((o) => key(o.token)));
    const missed = sandbox.lexSource(text).tokens
      .filter((t) => t.t === 'ident' && !notNames.has(t.v) && !resolved.has(key(t)))
      .map((t) => `${t.v} at ${key(t)}`);
    eq(missed, [], `${slug}: names nothing resolves`);
    eq(ambiguous.length, 0, `${slug}: members whose enum cannot be told`);
  }
});

check('renaming any declared name and back changes nothing, or is refused over JSON', () => {
  for (const [slug, text] of shippedTexts()) {
    const parsed = parseModelSource(text);
    for (const declaration of sandbox.sourceSymbols(parsed).occurrences.filter((o) => o.decl)) {
      const { token, symbol } = declaration;
      const fresh = (/^[A-Z]/.test(token.v) ? 'Zz' : 'zz') + token.v;
      // The parses this test already holds are handed on rather than
      // redone by sourceRename – a few thousand of them were most of
      // the suite's time.
      const there = sandbox.sourceRenameSymbol(text, parsed, symbol, fresh);
      if (there.error) {
        eq(/in the JSON/.test(there.error), true, `${slug} ${symbol}: ${there.error}`);
        continue;
      }
      const renamed = sandbox.sourceApplyEdits(text, there.edits);
      const read = parseModelSource(renamed);
      eq(read.diagnostics, [], `${slug} ${symbol} renamed`);
      const back = sandbox.sourceSymbols(read).occurrences.find((o) => o.decl && o.symbol.endsWith(' ' + fresh)
        && o.symbol.split(' ')[0] === symbol.split(' ')[0]);
      const again = sandbox.sourceRenameSymbol(renamed, read, back.symbol, token.v);
      eq(again.error, undefined, `${slug} ${symbol} renamed back`);
      const restored = parseModelSource(sandbox.sourceApplyEdits(renamed, again.edits));
      const model = { name: parsed.name };
      for (const kind of SOURCE_KINDS) model[DEF_COLLECTIONS[kind]] = parsed.collections[kind];
      assertSameModel(model, restored, `${slug} ${symbol} there and back`);
    }
  }
});

check('a rename is exact: a member, not its look-alikes', () => {
  const text = modelToSource(buildText().model());
  const { text: out } = renameAt(text, 'NonExistent, Existent', 'NonExistent, '.length, 'Active');
  eq((out.match(/\bActive\b/g) || []).length, 6, 'the declaration, a handler and four rules');
  eq((out.match(/\bNonExistent\b/g) || []).length, (text.match(/\bNonExistent\b/g) || []).length, 'NonExistent untouched');
  eq(out.includes('enum CourseStatus { NonExistent, Active, Archived }'), true, 'declared');
});

check('a projection and an enum sharing a name are two names', () => {
  const text = modelToSource(bySlug('course-simple').model());
  const { text: out } = renameAt(text, 'require CourseStatus(', 'require '.length, 'CourseState');
  eq(out.includes('projection CourseState (tag courseId: CourseId): CourseStatus = NonExistent {'), true, 'the projection, not its type');
  eq(out.includes('enum CourseStatus {'), true, 'the enum kept');
  const parsed = parseModelSource(text);
  const [line, col] = positionOf(text, 'require CourseStatus(', 'require '.length);
  const at = sandbox.sourceSymbolAt(parsed, line, col);
  eq(at.symbol, 'projection CourseStatus', 'resolved');
  eq(sandbox.sourceDeclarationOf(parsed, at.symbol).token.line,
    text.split('\n').findIndex((l) => l.startsWith('projection CourseStatus (')) + 1, 'goes to the projection');
});

check('a shorthand splits when either of its names is renamed', () => {
  const text = modelToSource(buildText().model());
  const param = renameAt(text, 'emit CourseDefined { courseId', 'emit CourseDefined { '.length, 'id').text;
  eq(param.includes('command DefineCourse(id: CourseId, capacity: integer) {'), true, 'the parameter');
  eq(param.includes('emit CourseDefined { courseId: id, capacity }'), true, 'the shorthand, as the value');
  const property = renameAt(text, 'event CourseDefined { tag courseId', 'event CourseDefined { tag '.length, 'id').text;
  eq(property.includes('emit CourseDefined { id: courseId, capacity }'), true, 'the shorthand, as the key');
  eq(property.includes('command DefineCourse(courseId: CourseId, capacity: integer) {'), true, 'the parameter kept');
});

// ---------------------------------------------------------------
// Introduce alias.
// ---------------------------------------------------------------

const ALIAS_TEXT = [
  'model "Aliases"',
  'enum CourseStatus { NonExistent, Existent }',
  'tag type CourseId = string',
  'tag type OwnerId = string',
  'event CourseDefined { tag courseId: CourseId, tag ownerId: OwnerId, capacity: integer }',
  'projection CourseStatus (tag courseId: CourseId): CourseStatus = NonExistent {',
  '  on CourseDefined => set Existent',
  '}',
  'projection CourseOwner (tag courseId: CourseId): OwnerId = null {',
  '  on CourseDefined => set event.data.ownerId',
  '}',
  'projection OwnedCourses (tag ownerId: OwnerId): integer = 0 {',
  '  on CourseDefined => increment 1',
  '}',
  'command Change(courseId: CourseId, capacity: integer) {',
  '  require CourseStatus(courseId) == Existent',
  '    else reject "No such course"',
  '  require OwnedCourses(CourseOwner(courseId)) < 3',
  '    else reject "Its owner has too many"',
  '  require CourseStatus(courseId) != NonExistent',
  '    else reject "Never defined"',
  '  emit CourseDefined { courseId, ownerId: CourseOwner(courseId), capacity }',
  '}',
  '',
].join('\n');

function introduceAt(text, needle, offset = 0) {
  const [line, col] = positionOf(text, needle, offset);
  const result = sandbox.sourceIntroduceAlias(text, line, col);
  return result.error ? result : { ...result, text: sandbox.sourceApplyEdits(text, result.edits) };
}

check('a read in place becomes an alias, every equal read in the command with it', () => {
  const out = introduceAt(ALIAS_TEXT, 'require CourseStatus', 'require Course'.length);
  eq(out.error, undefined, 'offered');
  eq(out.name, 'courseStatus', 'named after the projection');
  eq(out.title, 'Introduce alias courseStatus', 'and says so');
  const [line, col] = positionOf(out.text, 'alias courseStatus', 'alias '.length);
  eq(out.at, { line, col }, 'where its name lands, for the rename that follows');
  eq(renameAt(out.text, 'alias courseStatus', 'alias '.length, 'status').text.includes('require status == Existent'), true,
    'and the name is a rename away');
  eq(out.text.includes([
    'command Change(courseId: CourseId, capacity: integer) {',
    '  alias courseStatus = CourseStatus(courseId)',
    '  require courseStatus == Existent',
  ].join('\n')), true, 'declared at the top, used in the rule');
  eq(out.text.includes('require courseStatus != NonExistent'), true, 'and in the other rule');
  const parsed = parseModelSource(out.text);
  eq(parsed.diagnostics, [], 'it reads');
  const body = lists(parsed.collections['command-definition'].Change);
  eq(body.boundary, [{ alias: 'courseStatus', projection: 'CourseStatus', tags: { courseId: { parameterName: 'courseId' } } }],
    'one binding');
  eq(body.conditions[0].leftHandSide, { alias: 'courseStatus' }, 'read through it');
});

check('the innermost read under the cursor is the one introduced', () => {
  const inner = introduceAt(ALIAS_TEXT, 'OwnedCourses(CourseOwner', 'OwnedCourses(Course'.length);
  eq(inner.name, 'courseOwner', 'the nested read');
  eq(inner.text.includes('require OwnedCourses(courseOwner) < 3'), true, 'replaced inside the outer read');
  eq(inner.text.includes('ownerId: courseOwner,'), true, 'and in the emission');
  const outer = introduceAt(ALIAS_TEXT, 'OwnedCourses(CourseOwner', 'Owned'.length);
  eq(outer.text.includes('  alias ownedCourses = OwnedCourses(CourseOwner(courseId))\n'), true, 'the outer read, whole');
  eq(outer.text.includes('ownerId: CourseOwner(courseId)'), true, 'its inner read elsewhere untouched');
});

check('a new alias goes after the others, under a name nothing in the command holds', () => {
  const text = swap(swap(ALIAS_TEXT, 'command Change(courseId: CourseId, capacity: integer) {',
    'command Change(courseId: CourseId, capacity: integer, courseStatus: integer) {\n  alias owner = CourseOwner(courseId)'),
  'emit CourseDefined { courseId, ownerId: CourseOwner(courseId), capacity }', 'emit CourseDefined { courseId, ownerId: owner, capacity }');
  const out = introduceAt(text, 'require CourseStatus', 'require '.length);
  eq(out.name, 'courseStatus2', 'a parameter holds the plain name');
  eq(out.text.includes('  alias owner = CourseOwner(courseId)\n  alias courseStatus2 = CourseStatus(courseId)\n'), true, 'after the last alias');
  eq(out.at, { line: positionOf(out.text, 'alias courseStatus2')[0], col: 9 }, 'its name found there too');
  eq(parseModelSource(out.text).diagnostics, [], 'it reads');
  const inAlias = introduceAt(text, '= CourseOwner(courseId)', '= Course'.length);
  eq(inAlias.error !== undefined, true, 'an alias\'s own read is not a read in place');
});

check('introducing an alias is offered only on a read in place', () => {
  eq(introduceAt(ALIAS_TEXT, 'projection CourseStatus', 'projection '.length).error !== undefined, true, 'a declaration');
  eq(introduceAt(ALIAS_TEXT, '== Existent', '== '.length).error !== undefined, true, 'an enum member');
  eq(introduceAt(ALIAS_TEXT, 'require CourseStatus', 0).error !== undefined, true, 'a keyword');
});

check('every read in place in every shipped text can be introduced as an alias', () => {
  let tried = 0;
  for (const [slug, text] of shippedTexts()) {
    const lines = text.split('\n');
    lines.forEach((source, index) => {
      if (!/^\s+(require|emit)\b/.test(source)) return;
      for (const match of source.matchAll(/\b[A-Z][A-Za-z0-9_]*\(/g)) {
        const result = sandbox.sourceIntroduceAlias(text, index + 1, match.index + 1);
        if (result.error) continue;
        tried += 1;
        eq(parseModelSource(sandbox.sourceApplyEdits(text, result.edits)).diagnostics, [], `${slug}:${index + 1} ${match[0]}`);
      }
    });
  }
  eq(tried > 10, true, 'the shipped models read in place');
});

check('a group and its projections are renamed wherever they are named', () => {
  const text = modelToSource(buildText().model());
  const group = renameAt(text, 'group Course (', 'group '.length, 'Class').text;
  eq(group.includes('group Class (tag courseId: CourseId) {'), true, 'the group');
  eq(group.includes('alias course = Class(courseId)'), true, 'its reads');
  eq(/\bCourse\(/.test(group), false, 'nothing read by the old name');
  const inner = renameAt(text, 'projection capacity', 'projection '.length, 'seats').text;
  eq(inner.includes('  projection seats: integer = 0 {'), true, 'a projection, by its local name');
  eq(inner.includes('require course.subscriptionCount < course.seats'), true, 'read through an alias');
  eq(renameAt(text, 'course.capacity', 'course.'.length, 'seats').text, inner, 'from where it is read, the same');
  eq(renameAt(text, 'student.subscriptionCount', 'student.'.length, 'tally').text.includes('require course.subscriptionCount < '),
    true, 'a projection of another group with the same name is another projection');

  const more = GROUPS_MORE;
  const sibling = renameAt(more, 'projection remaining', 'projection '.length, 'free').text;
  eq(sibling.includes('    free >= seats'), true, 'a sibling, named bare');
  eq(sibling.includes('alias left = Course(courseId).free'), true, 'bound on its own');
  const tag = renameAt(more, 'group Course (tag courseId', 'group Course (tag '.length, 'id').text;
  eq(tag.includes('group Course (tag id: CourseId) {'), true, 'a group\'s tag');
  eq(tag.includes('StudentSubscriptionTotal(id) > 100'), true, 'passed on by a derived projection');
  eq(lists(parseModelSource(tag).collections['command-definition'].DefineCourse).conditions[0].leftHandSide.tags,
    { id: { parameterName: 'courseId' } }, 'and a read gives its value anew');
  const argument = renameAt(more, 'hasRoomFor (seats', 'hasRoomFor ('.length, 'places').text;
  eq(argument.includes('require course.hasRoomFor(places: 1) is true'), true, 'an argument, where it is given');
  eq(argument.includes('remaining >= places'), true, 'and where it is used');

  eq(renameAt(more, 'group Course (', 'group '.length, 'StudentSubscriptionTotal').error,
    'There already is a projection named StudentSubscriptionTotal.', 'a group and a projection share a namespace');
  eq(renameAt(more, 'projection remaining', 'projection '.length, 'capacity').error,
    'There already is a projection named capacity in Course.', 'siblings are one namespace');
  eq(renameAt(more, 'projection remaining', 'projection '.length, 'Remaining').error,
    '"Remaining" cannot name a projection: a projection in a group is lowerCamel, letters and digits.', 'and lowercase');
});

check('a rename refuses what it cannot do exactly', () => {
  const text = modelToSource(buildText().model());
  eq(renameAt(text, 'alias course = Course', 'alias '.length, 'courseId').error,
    'There already is a command property named courseId in DefineCourse.', 'an alias and a parameter share a namespace');
  eq(renameAt(text, 'NonExistent, Existent', 'NonExistent, '.length, 'Archived').error,
    'There already is an enum member named Archived in CourseStatus.', 'a member collision');
  eq(renameAt(text, 'NonExistent, Existent', 'NonExistent, '.length, 'active').error,
    '"active" cannot name an enum member: an enum member starts with a capital letter.', 'a member is capitalised');
  eq(renameAt(text, 'alias course = Course', 'alias '.length, 'Course').error,
    '"Course" cannot name an alias: an alias starts with a lowercase letter.', 'a name is not');
  eq(renameAt(text, '// Types', 3, 'X').error, 'There is nothing here to rename.', 'a comment');
  const json = 'model "M"\nenum S { Draft, Done }\nevent E {}\nevent F {}\ncommand C json { "properties": [], "boundary": [], '
    + '"conditions": [{ "leftHandSide": { "enumMember": "Draft" }, "predicate": "isTrue", "rejection": "No" }], '
    + '"publishes": [{ "name": "E" }] }\n';
  eq(/also appears in the JSON at line \d+/.test(renameAt(json, 'Draft, Done', 0, 'Concept').error), true,
    'a member a json body spells as a string');
  eq(renameAt(json, 'event F', 'event '.length, 'G').error, undefined, 'a name it does not hold renames');
  const shared = 'enum A { Open, Closed }\nenum B { Open, Shut }\nprojection P: Unknown = Open\n'
    + 'command C(a: A) {\n  require a == Open\n    else reject "Not open"\n}\n';
  eq(/Open at line 3 could be a member of A or B/.test(renameAt(shared, 'A { Open', 4, 'Opened').error), true,
    'a member where its enum cannot be told');
  eq(renameAt(shared, 'Unknown = Open', 'Unknown = '.length, 'X').error,
    'Open is a member of A and B, and nothing here says which – rename it at its declaration.', 'from there');
  const typed = renameAt(swap(shared, 'projection P: Unknown = Open\n', ''), 'A { Open', 4, 'Opened').text;
  eq(typed.includes('require a == Opened') && typed.includes('enum B { Open, Shut }'), true, 'typed by the rule\'s other side');
});

check('a rename reaches into scenarios', () => {
  const { model } = importFixture('course-simple');
  const text = modelToSource(model());
  const out = renameAt(text, 'event CourseDefined', 'event '.length, 'CourseCreated').text;
  eq(/given CourseDefined\b/.test(out), false, 'a given event');
  eq(out.includes('given CourseCreated {'), true, 'renamed there');
  const projection = renameAt(text, 'projection CourseStatus (', 'projection '.length, 'CourseState').text;
  eq(projection.includes('require CourseState(courseId) == NonExistent'), true, 'the rule reading it in place');
  eq(/then CourseState\(CourseId\("c1"\)\)/.test(projection), true, 'a projection scenario about it');
  eq(projection.includes('then rejected "Course already exists"'), true, 'a refusal names its message, which no rename touches');
});

check('completion knows an event\'s payload in a handler', () => {
  const text = modelToSource(buildText().model());
  const handler = swap(text, 'on CourseDefined => set event.data.capacity', 'on CourseDefined => set event.|');
  eq(completeAt(handler).labels, ['data'], 'event.');
  eq(completeAt(swap(handler, 'event.|', 'event.data.|')).labels, ['courseId', 'capacity'], 'event.data.');
  eq(completeAt(swap(handler, 'event.|', 'event.data.ca|')).labels, ['courseId', 'capacity'], 'with a word begun');
  const operand = completeAt(swap(handler, 'event.|', '|'));
  eq(operand.labels.slice(0, 2), ['event.data', 'successor'], 'an integer fold');
  eq(completeAt(swap(text, 'on CourseArchived => set Archived', 'on CourseArchived => set |')).labels,
    ['event.data', 'NonExistent', 'Existent', 'Archived'], 'an enum fold offers its members');
  eq(completeAt(swap(text, 'on CourseArchived => set Archived', 'on |')).labels.includes('CourseDefined'), false,
    'an event already handled');
});

check('completion knows a command\'s reads and payload', () => {
  const text = modelToSource(buildText().model());
  const rule = (insert) => completeAt(swap(text, '    else reject "Course has more subscriptions than that"',
    `    else reject "Course has more subscriptions than that"\n  ${insert}`));
  eq(rule('require |').labels, ['course', 'courseId', 'newCapacity', 'Student', 'Course', 'count', 'sum', 'min', 'max', 'average', 'any', 'all', 'list', 'not'],
    'what a rule can be about – its reads and payload, then any group or projection, read in place');
  eq(rule('require |').items.find((i) => i.label === 'Course').insert, 'Course($1).', 'a group, for one of its projections');
  eq(rule('require course.|').labels, ['status', 'capacity', 'subscriptionCount', 'subscribedStudentIds'], 'the group\'s projections');
  eq(rule('require Course(courseId).|').labels, ['status', 'capacity', 'subscriptionCount', 'subscribedStudentIds'],
    'and after a read of it in place');
  eq(rule('require course.status == |').labels.slice(0, 3), ['NonExistent', 'Existent', 'Archived'], 'members first');
  eq(rule('require course.status in [|]').labels, ['NonExistent', 'Existent', 'Archived'], 'in a list');
  eq(rule('require course.status |').labels, ['==', '!=', 'in', 'not in'], 'what an enum admits');
  eq(rule('require courseId in |').labels, ['[…]', 'course', 'courseId', 'newCapacity'], 'a literal list or data');
  eq(rule('alias other = |').items.find((i) => i.label === 'Course').insert, 'Course($1)', 'a group read');
  eq(rule('alias other = Course(|)').labels.includes('courseId'), true, 'what it is read by');
  eq(rule('alias other = Course(|)').labels.includes('other'), false, 'not the read being written');
  const value = rule('require Course(|)').items;
  eq(value.filter((i) => i.sort === '0').map((i) => i.label), ['course', 'courseId'], 'a value of the declared tag type first');
  eq(value.some((i) => i.label === 'each'), true, 'or each of a list');
  eq(rule('emit CourseCapacityChanged { courseId, |}').labels, ['newCapacity'], 'an event\'s remaining properties');
  eq(rule('emit CourseCapacityChanged { |}').items.map((i) => i.insert), ['courseId', 'newCapacity'], 'as shorthands');
  const start = rule('|');
  eq([start.labels, start.slot], [['alias', 'require', 'emit', 'if', 'for each', 'scenarios'], false], 'a statement, not on a space');
});

check('completion knows scenarios, declarations, and when to stay quiet', () => {
  const { model } = importFixture('course-simple');
  const text = modelToSource(model());
  const block = (insert) => completeAt(swap(text, '  emit CourseArchived { courseId }\n\n  scenarios {\n',
    `  emit CourseArchived { courseId }\n\n  scenarios {\n    scenario {\n      ${insert}\n    }\n\n`));
  const group = completeAt(swap(text, '  emit CourseArchived { courseId }\n\n  scenarios {\n',
    '  emit CourseArchived { courseId }\n\n  scenarios {\n    |\n'));
  eq(group.labels, ['scenario'], 'a group holds scenarios, nothing else');
  eq(block('given CourseDefined { |}').labels, ['courseId', 'capacity'], 'a payload\'s keys');
  eq(block('when |').labels[0], 'ArchiveCourse', 'the block\'s command first');
  eq(block('then |').items.filter((i) => i.sort === '0').map((i) => i.label), ['CourseArchived'], 'what it emits, first');
  eq(block('then rejected |').labels, ['"Course is not active"'], 'a refusal, by the messages the command has');
  eq(block('given CourseDefined { courseId: "c1", capacity: 1 }\n      |').labels, ['when', 'then', 'and'], 'what is said is continued');
  eq(block('when ArchiveCourse { courseId: "c1" }\n      |').labels, ['given', 'then'], 'a when is not');
  eq(block('given CourseDefined { courseId: "c1", capacity: 1 }\n      and CourseDefined { |}').labels, ['courseId', 'capacity'],
    'an and line, by the keyword above');
  eq(block('when ArchiveCourse { courseId: "c1" }\n      then CourseArchived { courseId: "c1" }\n      and |').items
    .filter((i) => i.sort === '0').map((i) => i.label), ['CourseArchived'], 'a then continued');
  const outcome = (insert, source = text) => completeAt(swap(source, '  emit CourseArchived { courseId }\n\n  scenarios {\n',
    `  emit CourseArchived { courseId }\n\n  scenarios {\n    scenario {\n      when ArchiveCourse { courseId: "c8" }\n      ${insert}\n    }\n\n`),
  { model: model() }).items[0];
  eq([outcome('then |').label, outcome('then |').insert], ['rejected "Course is not active"', 'rejected "Course is not active"'],
    'what the model does, first, where the then is written');
  eq(outcome('|').insert, 'then rejected "Course is not active"', 'and on the line after the when, keyword and all');
  eq(outcome('th|').insert, 'then rejected "Course is not active"', 'or once it is begun');
  const two = swap(text, 'emit CourseArchived { courseId }\n', 'emit CourseArchived { courseId }\n  emit CourseArchived { courseId }\n');
  const both = completeAt(swap(two, '  emit CourseArchived { courseId }\n\n  scenarios {\n',
    '  emit CourseArchived { courseId }\n\n  scenarios {\n    scenario {\n      given CourseDefined { courseId: "c9", capacity: 3 }\n'
    + '      when ArchiveCourse { courseId: "c9" }\n      |\n    }\n\n'), { model: model() }).items[0];
  eq([both.label, both.insert], ['then CourseArchived { courseId: "c9" } …',
    'then CourseArchived { courseId: "c9" }\nand CourseArchived { courseId: "c9" }'], 'several events, their and lines included');
  const read = (insert) => completeAt(swap(text, /(projection CourseStatus [^\n]*\n(?:  on [^\n]*\n)+)/,
    `$1\n  scenarios {\n    scenario {\n      given CourseDefined { courseId: "c1", capacity: 3 }\n      and CourseArchived { courseId: "c2" }\n${insert}\n    }\n  }\n`),
  { model: model() }).items.filter((i) => i.detail === 'what the model does').map((i) => i.insert);
  eq(read('      |'), ['then CourseStatus(CourseId("c1")) == Existent', 'then CourseStatus(CourseId("c2")) == Archived'],
    'a projection read with each tag value the given events carry');
  eq(read('      then |'), ['CourseStatus(CourseId("c1")) == Existent', 'CourseStatus(CourseId("c2")) == Archived'], 'after then');
  eq(read('      then CourseStatus(CourseId("c2")) |'), ['== Archived'], 'after a read written out');
  eq(read('      then CourseStatus(CourseId("c2")) == |'), ['Archived'], 'and after its ==');
  const sequence = importFixture('course-sequence').model();
  const untagged = completeAt(swap(modelToSource(sequence), 'then CourseNumbering() == "c1"', 'then CourseNumbering() == |'),
    { model: sequence }).items[0];
  eq(untagged && untagged.insert, '"c1"', 'an untagged one');
  eq(completeAt(swap(text, '// Commands', '// Commands\n@|')).labels, ['icon', 'feature', 'tagSchema', 'sensitive', 'deprecated', 'assumption', 'external', 'unresolved'], 'annotations');
  eq(completeAt(swap(text, 'command DefineCourse(courseId: CourseId', 'command DefineCourse(courseId: |')).labels
    .slice(0, 3), ['boolean', 'integer', 'string'], 'a type');
  eq(completeAt(swap(text, '// Commands', '// Commands |')).labels, [], 'in a comment');
  eq(completeAt(swap(text, 'else reject "Course is not active"', 'else reject "Course is| not active"')).labels, [], 'in a string');
  const grouped = modelToSource(buildText().model());
  eq(completeAt(swap(grouped, '  projection capacity: integer = 0 {', '  projection capacity: |')).labels.slice(0, 3),
    ['boolean', 'integer', 'string'], 'a group\'s projection, its type');
  const more = buildText(GROUPS_MORE).model();
  const derived = completeAt(swap(GROUPS_MORE, '    capacity - subscriptionCount', '    capacity - |'), { model: more }).labels;
  eq(derived.slice(0, 6), ['status', 'capacity', 'subscriptionCount', 'slots', 'hasRoomFor', 'studentsAtLimit'],
    'a derived projection in a group: its siblings first');
  eq(['StudentSubscriptionTotal', 'Course', 'courseId'].every((l) => derived.includes(l)), true,
    'then what it reads outside, and the group\'s tag: ' + derived.join(', '));
  eq(derived.includes('remaining'), false, 'never itself');
  eq(completeAt(swap(GROUPS_MORE, '    remaining >= seats', '    remaining >= |')).labels.includes('seats'), true, 'and its own arguments');
});

// ---------------------------------------------------------------
// What a read queries.
// ---------------------------------------------------------------

check('a read says which events it adds – only those of the projections used', () => {
  const { model } = buildText();
  const text = modelToSource(model());
  const queries = (source) => sandbox.sourceReadQueries(model(), parseModelSource(source));
  const of = (list, command) => list.find((q) => q.command === command);

  const archive = of(queries(text), 'ArchiveCourse');
  eq(archive.hint, '‹reads 2 types›', 'status only, no capacity events');
  eq(archive.types, ['CourseArchived', 'CourseDefined'], 'which the hover names');
  eq(archive.properties, [{ name: 'status', types: ['CourseArchived', 'CourseDefined'] }], 'per property');
  eq(archive.unread, ['capacity', 'subscriptionCount', 'subscribedStudentIds'], 'what it leaves out');
  eq(archive.reasons, ['rule'], 'why it is read');
  const line = text.split('\n')[archive.start.line - 1];
  eq(line.slice(archive.start.col - 1, archive.end.endCol - 1), 'alias course = Course(courseId)', 'the statement');

  eq(of(queries(text), 'SubscribeStudentToCourse').types.includes('CourseCapacityChanged'), true,
    'a rule on capacity brings its events in');

  // Nothing uses it: a group is a name, and queries nothing.
  const unused = of(queries(swap(text, '  require course.status == Existent\n    else reject "Course is not active"\n\n  emit CourseArchived',
    '  emit CourseArchived')), 'ArchiveCourse');
  eq([unused.hint, unused.reasons, unused.properties], ['‹reads nothing – unused›', [], []], 'an unused group read');
});

check('a command says what it reads in all, on its header line', () => {
  const at = (slug) => {
    const { model } = build(PREDEFINED_MODELS.findIndex((m) => m.slug === slug));
    const text = modelToSource(model());
    return { text, all: sandbox.sourceCommandQueries(model(), parseModelSource(text)) };
  };
  const of = (list, command) => list.find((q) => q.command === command);

  const simple = at('course-simple');
  const archive = of(simple.all, 'ArchiveCourse');
  eq(archive.hint, '‹reads 2 types, 1 tag›', 'one read, one query');
  const line = simple.text.split('\n')[archive.end.line - 1];
  eq([line.slice(archive.end.col - 1, archive.end.endCol - 1), archive.start.line], ['{', archive.end.line],
    'the header, up to its brace');
  eq(of(simple.all, 'SubscribeStudentToCourse').hint, '‹reads 6 types, 2 tags›', 'types and tags are distinct counts');

  const { model: grouped } = buildText(GROUPS_MORE);
  const subscribe = of(sandbox.sourceCommandQueries(grouped(), parseModelSource(GROUPS_MORE)), 'SubscribeStudentToCourse');
  eq(subscribe.hint, '‹reads 6 types, 3 tags, in 2 queries›', 'a chain is read in as many queries as it is deep');
  eq(subscribe.queries.length, 2, 'and they are laid out in order');
  eq(of(at('course-sequence').all, 'DefineCourse').hint, '‹reads 1 type, no tag›', 'a global numbering');

  // Unused, a projection read queries every event under its tag; a
  // group read queries nothing; with no reads, the append is
  // unconditional.
  const bare = (body) => sandbox.boundarySummary(bySlug('course-simple').model(), body).words;
  eq(bare({ boundary: [{ alias: 'status', projection: 'CourseStatus', tags: { courseId: { parameterName: 'courseId' } } }] }),
    'reads 2 types, 1 tag', 'a projection nothing uses: its own types');
  eq(sandbox.boundarySummary(buildText().model(), { boundary: [{ alias: 'course', group: 'Course', tags: { courseId: { parameterName: 'courseId' } } }] }).words,
    'reads nothing', 'a group nothing reads through');
  eq(bare({ boundary: [] }), 'reads nothing', 'no reads');
});

check('a fanned-out read is marked, a projection read lists its events', () => {
  PREDEFINED_MODELS.forEach((entry, index) => {
    const { model } = build(index);
    const text = modelToSource(model());
    const all = sandbox.sourceReadQueries(model(), parseModelSource(text));
    const reads = (text.match(/^\s+alias /gm) || []).length;
    eq(all.length, reads, `${entry.slug}: every alias has a query`);
    for (const q of all) {
      eq(q.hint.includes('unused'), false, `${entry.slug} ${q.command} ${q.alias} is used`);
      eq(q.hint.includes(', one per element'), q.fannedOut, `${entry.slug} ${q.command} ${q.alias} fan-out`);
    }
  });
  const { model } = build(PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-sequence'));
  const numbering = sandbox.sourceReadQueries(model(), parseModelSource(modelToSource(model())))
    .find((q) => q.alias === 'courseNumbering');
  eq([numbering.hint, numbering.tags, numbering.unread], ['‹reads 1 type›', [], []], 'a projection read');
});

// ---------------------------------------------------------------
// The language, for an agent (get_model_language).
// ---------------------------------------------------------------

check('the reference tour is a model that applies clean, with nothing experimental', () => {
  fresh();
  const { SOURCE_REFERENCE_TOUR: tour } = sandbox;
  eq(parseModelSource(tour).diagnostics, [], 'it parses');
  const id = sandbox.createDcbModel('Tour');
  applyModelSource(id, tour);
  const model = projectState()[id];
  eq(sandbox.modelAdvisories(model), [], 'no advisories');
  eq(sandbox.experimentalFeatures(model), [], 'nothing experimental');
  eq(sandbox.sourceExperimentalMarks(tour), [], 'not even in passing');
  eq(Object.keys(model['scenario-definitions']).length + Object.keys(model['projection-scenario-definitions']).length,
    3, 'its scenarios recorded');
  eq(modelToSource(model).includes(' json {'), false, 'every definition spelled in the language');
});

check('the reference example is the shipped model as printed', () => {
  const index = PREDEFINED_MODELS.findIndex((m) => m.slug === sandbox.SOURCE_REFERENCE_EXAMPLE_SLUG);
  eq(index >= 0 && !PREDEFINED_MODELS[index].experimental, true, 'a shipped model, not an experimental one');
  eq(sandbox.SOURCE_REFERENCE_EXAMPLE, modelToSource(build(index).model()),
    'reprint it into SOURCE_REFERENCE_EXAMPLE with node app/print-model.js');
});

check('every keyword outside the experimental ones is shown to an agent', () => {
  // None is experimental since 11.0; one staged behind the flag would
  // be listed here, as WebMCP does not offer it.
  const experimental = [];
  const shown = new Set((sandbox.SOURCE_REFERENCE_TOUR + '\n' + sandbox.SOURCE_REFERENCE_FORMS).match(/[A-Za-z]+/g));
  eq(sandbox.SOURCE_KEYWORDS.filter((word) => !experimental.includes(word) && !shown.has(word)), [],
    'add each to the tour or the forms in dsl.js');
  const reference = sandbox.sourceLanguageReference();
  eq(Object.keys(sandbox.SOURCE_ANNOTATIONS).filter((name) => !reference.includes('@' + name)), [], 'every annotation');
  eq(sandbox.SOURCE_REFERENCE_TOUR.includes('///'), true, 'a doc comment, in the tour');
});

// Errors never stop the read – nesting included. Past a depth no model
// is written at, the parser says so where it happens, instead of
// running out of stack and taking the code view with it.
{
  const nestingDiagnostics = (text) => parseModelSource(text).diagnostics.filter((d) => /nested/.test(d.message));

  check('a JSON value nested past the limit is a diagnostic, not a stack overflow', () => {
    const deep = 'model "M"\ncommand C json ' + '['.repeat(7033) + ']'.repeat(7033) + '\n';
    let read;
    try { read = parseModelSource(deep); } catch (error) { throw new Error('threw ' + error.name); }
    eq(read.diagnostics.some((d) => /nested/.test(d.message)), true, 'said where');
    eq(nestingDiagnostics('model "M"\ncommand C json ' + '['.repeat(150) + ']'.repeat(150) + '\n').length, 0,
      'and a depth anyone writes reads on');
  });

  check('a scenario payload nested past the limit is a diagnostic too', () => {
    fresh();
    const { modelId } = importModelFromEnvelope(
      JSON.parse(fs.readFileSync(path.join(FIXTURES, 'content-decisions-boundary.dcb.json'), 'utf8')));
    const deep = swap(modelToSource(projectState()[modelId]), 'given DocumentAdded { id: "d1" }',
      'given DocumentAdded { id: "d1", extra: ' + '['.repeat(3000) + ']'.repeat(3000) + ' }');
    eq(nestingDiagnostics(deep).length > 0, true, 'reported');
  });

  check('a read nested past the limit is a diagnostic', () => {
    const text = modelToSource(build(PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-simple')).model());
    const deep = swap(text, 'require CourseStatus(courseId) == NonExistent',
      'require ' + 'CourseStatus('.repeat(3000) + 'courseId' + ')'.repeat(3000) + ' == NonExistent');
    eq(nestingDiagnostics(deep).length > 0, true, 'reported');
  });
}

// The lexer and the messages, at their edges.
{
  const messages = (text) => parseModelSource(text).diagnostics.map((d) => d.message);

  check('a number too large to store is a diagnostic, not a silent null', () => {
    const huge = messages('model "M"\nuntagged projection P: integer = 1e400\n');
    eq(huge.some((m) => /too large/.test(m)), true, huge.join(' | '));
    eq(messages('model "M"\nuntagged projection P: integer = 1e300\n'), [], 'a large one is fine');
  });

  check('a backslash before a line break does not carry a string onto the next line', () => {
    const text = 'model "M"\nevent A { note: string }\ncommand C { emit A { note: "x\\\nevent B {}\n';
    const read = parseModelSource(text);
    eq(read.diagnostics.some((d) => /never closed/.test(d.message) && d.line === 3), true,
      read.diagnostics.map((d) => `${d.line}: ${d.message}`).join(' | '));
    eq('B' in read.collections['event-definition'], true, 'the next line is read as the declaration it is');
  });

  check('a duplicate is named with the right article', () => {
    eq(messages('model "M"\nevent A {}\nevent A {}\n').some((m) => m.startsWith('An event named "A"')), true,
      messages('model "M"\nevent A {}\nevent A {}\n').join(' | '));
    eq(messages('model "M"\ncommand C() {}\ncommand C() {}\n').some((m) => m.startsWith('A command named "C"')), true,
      'and a consonant keeps "A"');
  });
}

// ---------- comparing two models as text ----------
{
  const rowsOf = (rows) => rows.map((r) => `${r.k} ${r.o || ''}/${r.n || ''} ${r.text}`);

  check('two texts are compared line by line, each numbered on its own side', () => {
    eq(rowsOf(sandbox.diffLines('a\nb\nc', 'a\nx\nc')), ['same 1/1 a', 'del 2/ b', 'add /2 x', 'same 3/3 c'], 'a line replaced');
    eq(rowsOf(sandbox.diffLines('', 'a\nb')), ['add /1 a', 'add /2 b'], 'nothing before');
    eq(rowsOf(sandbox.diffLines('a', '')), ['del 1/ a'], 'nothing after');
  });

  check('a line replaced by another says which words changed', () => {
    const [row, other] = sandbox.diffLines('command C(courseId: CourseId) {', 'command C(tenantId: TenantId) {').filter((r) => r.k !== 'same');
    const changed = (r) => r.parts.filter((p) => p.changed).map((p) => p.text).join('');
    eq([changed(row), changed(other)], ['courseIdCourseId', 'tenantIdTenantId'], 'only the words that differ');
    eq(row.parts.map((p) => p.text).join(''), row.text, 'the parts spell the line');
  });

  check('a definition compared as it prints on each side', () => {
    store.clear();
    sandbox.bumpLogRevision();
    const ids = ['course-simple', 'course-tenant'].map((slug) => loadPredefinedModel(PREDEFINED_MODELS.findIndex((m) => m.slug === slug)));
    const [simple, tenant] = ids.map((id) => projectState()[id]);
    const rows = sandbox.definitionSourceDiff(simple, tenant, 'command-definition', 'DefineCourse');
    eq(rows.some((r) => r.k === 'del' && r.text.includes('require CourseStatus(courseId) == NonExistent')), true, 'the rule it dropped');
    eq(rows.some((r) => r.k === 'add' && r.text.includes('alias courseNumbering = CourseNumbering()')), true, 'the read it gained');
    eq(sandbox.definitionSourceDiff(simple, tenant, 'command-definition', 'ArchiveCourse').every((r) => r.k === 'same'), true, 'unchanged');
    eq(sandbox.definitionSourceDiff(simple, tenant, 'command-definition', 'RegisterTenant').every((r) => r.k === 'add'), true, 'added');
  });
}

// The skill's checker runs the generated copy of the core, so the
// pre-commit hook's staleness check is what ties this to the sources.
{
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const CLI = path.join(APP, '..', 'skills', 'dcb-notation', 'scripts', 'dcb.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb-skill-'));
  const run = (verb, file) => spawnSync(process.execPath, [CLI, verb, file], { encoding: 'utf8' });
  const write = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return file; };
  const MODEL = `model "Usernames"
tag type Username = string
event UsernameClaimed { tag username: Username }
projection UsernameTaken (tag username: Username): boolean = false {
  on UsernameClaimed => set true
}
command ClaimUsername(username: Username) {
  require UsernameTaken(username) is false
    else reject "Username is taken"
  emit UsernameClaimed { username }
  scenarios {
    scenario "free" {
      when ClaimUsername { username: "a" }
      then UsernameClaimed { username: "a" }
    }
    scenario "taken" {
      given UsernameClaimed { username: "a" }
      when ClaimUsername { username: "a" }
      then rejected "Username is taken"
    }
  }
}
`;

  check('the skill\'s check passes a covered model and says what ran', () => {
    const { status, stdout } = run('check', write('ok.dcb', MODEL));
    eq(status, 0, 'exit');
    eq(stdout.includes('2 scenario(s) hold'), true, 'the count');
    eq(stdout.includes('UsernameClaimed [Username:{username}]'), true, 'the boundary');
  });

  check('the skill\'s check fails what the playground only advises on', () => {
    const fails = (name, text, expected) => {
      const { status, stderr } = run('check', write(name, text));
      eq(status, 1, name);
      eq(stderr.includes(expected), true, `${name}: ${stderr}`);
    };
    fails('wrong.dcb', swap(MODEL, 'then rejected "Username is taken"', 'then UsernameClaimed { username: "a" }'), 'scenario: Does not hold');
    fails('uncovered.dcb', swap(MODEL, 'then rejected "Username is taken"', 'then nothing'), 'no scenario shows "Username is taken"');
    fails('untagged.dcb', swap(MODEL, 'event UsernameClaimed { tag username', 'event UsernameClaimed { username'), 'not one of this event\'s tags');
    fails('syntax.dcb', swap(MODEL, 'event UsernameClaimed {', 'event {'), 'Expected an event name');
  });

  check('the skill\'s --cover narrows coverage and nothing else', () => {
    const text = MODEL + `command ReleaseUsername(username: Username) {
  require UsernameTaken(username) is true
    else reject "Username is free"
  emit UsernameClaimed { username }
}
`;
    const file = write('two.dcb', text);
    eq(run('check', file).status, 1, 'strict without it');
    const covered = spawnSync(process.execPath, [CLI, 'check', file, '--cover', 'ClaimUsername'], { encoding: 'utf8' });
    eq(covered.status, 0, covered.stderr);
    eq(covered.stdout.includes('command ReleaseUsername: no scenario shows it succeed'), true, 'the gap is listed');
    const uncovered = spawnSync(process.execPath, [CLI, 'check', file, '--cover', 'ReleaseUsername'], { encoding: 'utf8' });
    eq(uncovered.status, 1, 'a named command still has to be covered');
    const unknown = spawnSync(process.execPath, [CLI, 'check', file, '--cover', 'Nope'], { encoding: 'utf8' });
    eq(unknown.stderr.includes('"Nope"'), true, 'a mistyped name is a problem');
    const wrong = write('wrong-cover.dcb', swap(text, 'then rejected "Username is taken"', 'then nothing'));
    const failing = spawnSync(process.execPath, [CLI, 'check', wrong, '--cover', 'ReleaseUsername'], { encoding: 'utf8' });
    eq(failing.stderr.includes('scenario: Does not hold'), true, 'a failing scenario fails outside it too');
  });

  check('the skill\'s check refuses what 11.0 removed', () => {
    const text = swap(MODEL, 'emit UsernameClaimed { username }', 'emit UsernameClaimed { username }\n    when UsernameTaken(username) is false');
    const { status, stderr } = run('check', write('guarded.dcb', text));
    eq(status, 1, 'exit');
    eq(stderr.includes('"when" on an emission is gone'), true, stderr);
    const json = JSON.parse(run('json', write('plain.dcb', MODEL)).stdout);
    json.commandDefinitions[0].steps.find((step) => step.name)['when'] = [{ leftHandSide: { parameterName: 'username' }, predicate: 'isNotEmpty' }];
    const guarded = run('print', write('guarded.json', JSON.stringify(json)));
    eq(guarded.stderr.includes('converted on import: ClaimUsername:') && guarded.stderr.includes('not imported'), true,
      'a command left out is said, even where the model still prints: ' + guarded.stderr);
    delete json.commandDefinitions[0].steps.find((step) => step.name)['when'];
    json.projectionDefinitions[0].script = { initialState: false };
    const scripted = run('check', write('scripted.json', JSON.stringify(json)));
    eq([scripted.status, scripted.stderr.trim()],
      [1, 'Projection "UsernameTaken" is scripted – 11.0 has no scripted projections, so this model cannot be imported.'],
      'a script refuses the file');
  });

  check('the skill\'s check notes implementation words without failing', () => {
    const text = swap(swap(MODEL, 'projection UsernameTaken', 'projection UsernameStreamTaken'), 'require UsernameTaken', 'require UsernameStreamTaken');
    const { status, stdout } = run('check', write('stream.dcb', text));
    eq(status, 0, 'a note, not a problem');
    eq(stdout.includes('projection UsernameStreamTaken: "Stream"'), true, stdout);
    eq(run('check', write('upstream.dcb', swap(swap(MODEL, 'projection UsernameTaken', 'projection UpstreamTaken'), 'require UsernameTaken', 'require UpstreamTaken'))).stdout.includes('Worth a look'), false, 'inside a word is no word');
  });

  check('the skill\'s conflicts names who invalidates whom, through what', () => {
    const text = MODEL + `event UsernameNoted { tag username: Username, note: string }
event AuditLogged { note: string }
command NoteUsername(username: Username) {
  emit UsernameNoted { username, note: "n" }
}
`;
    const { status, stdout } = run('conflicts', write('conflicts.dcb', text));
    eq(status, 0, 'exit');
    eq(stdout.includes('ClaimUsername:\n  itself via UsernameClaimed [Username]'), true, stdout);
    eq(stdout.includes('NoteUsername: nothing can invalidate it'), true, 'an event no read selects');
    eq(stdout.includes('via UsernameNoted'), false, 'an event no boundary selects');
  });

  check('the skill\'s replay compares stored events with the model and folds them', () => {
    const typed = `model "Stored"
tag type CourseId = string
type Seats = integer { minimum: 1, maximum: 5 }
event SeatsTaken { tag courseId: CourseId, seats: Seats, note?: string }
projection Taken (tag courseId: CourseId): integer = 0 {
  on SeatsTaken => increment event.data.seats
}
`;
    const model = write('stored.dcb', typed);
    const lines = (...events) => write('export.ndjson', events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const replay = (file, ...more) => spawnSync(process.execPath, [CLI, 'replay', model, file, ...more], { encoding: 'utf8' });
    const clean = lines(
      { type: 'row', payload: { type: 'tag:x:seats-taken', data: JSON.stringify({ courseId: 'c1', seats: 2 }) } },
      { type: 'SeatsTaken', data: { courseId: 'c1', seats: 3, note: null } },
    );
    const ok = replay(clean, '--read', 'Taken=c1');
    eq(ok.status, 0, ok.stdout);
    eq(ok.stdout.includes('2 event(s) of 1 model type(s)'), true, ok.stdout);
    eq(ok.stdout.includes('Taken=c1: 5'), true, ok.stdout);
    const off = replay(lines(
      { type: 'seats-taken', data: { courseId: 'c1', seats: 9, extra: 1 } },
      { type: 'seats-taken', data: { courseId: 'c1' } },
      { type: 'other-thing', data: {} },
      { nonsense: true },
    ));
    eq(off.status, 1, 'a disagreement fails');
    for (const expected of ['SeatsTaken.seats: a value is above 5 (1)', 'SeatsTaken.extra: not in the model (1)', 'SeatsTaken.seats: required, but missing (1)', 'other-thing (1)', '1 line(s) unreadable']) {
      eq(off.stdout.includes(expected), true, `${expected}: ${off.stdout}`);
    }
    const mapped = replay(lines({ type: 'old-name', data: { courseId: 'c1', seats: 1 } }), '--map', 'old-name=SeatsTaken');
    eq(mapped.status, 0, mapped.stdout);
  });

  check('the skill\'s replay holds stored values to their types as a scenario\'s are', () => {
    const model = write('shaped.dcb', `model "Shaped"
tag type CourseId = string
type Sessions = array
type Seats = integer { minimum: 1 }
record Slot { seats: Seats }
event CourseAdded { tag courseId: CourseId, sessions: Sessions, slots: Slot[], counts: Seats[] }
`);
    const lines = write('shaped.ndjson', [
      { type: 'CourseAdded', data: { courseId: 'c1', sessions: [{ day: 1 }], slots: [{ seats: 2 }], counts: [1] } },
      { type: 'CourseAdded', data: { courseId: 'c1', sessions: {}, slots: [{ seats: 0 }], counts: [1, 0] } },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const result = spawnSync(process.execPath, [CLI, 'replay', model, lines], { encoding: 'utf8' });
    eq(result.status, 1, result.stdout);
    for (const expected of ['CourseAdded.sessions: a value is no array (1)', 'CourseAdded.slots.seats: a value is below 1 (1)',
      'CourseAdded.counts: a value is below 1 (1)']) {
      eq(result.stdout.includes(expected), true, `${expected}: ${result.stdout}`);
    }
  });

  check('the skill\'s replay flags a datetime without an offset and a duration that is none', () => {
    const model = write('timed.dcb', `model "Timed"
tag type CourseId = string
record Slot { startsAt: datetime, length: duration }
event SeatsReserved { tag courseId: CourseId, expiresAt: datetime, hold: duration, slots: Slot[] }
`);
    const lines = write('timed.ndjson', [
      { type: 'SeatsReserved', data: { courseId: 'c1', expiresAt: '2026-01-01T10:15:00+02:00', hold: 'PT15M', slots: [] } },
      { type: 'SeatsReserved', data: { courseId: 'c1', expiresAt: '2026-01-01T10:15:00', hold: '15m',
        slots: [{ startsAt: '2026-01-01T10:00:00Z', length: 'P1M' }] } },
    ].map((e) => JSON.stringify(e)).join('\n') + '\n');
    const result = spawnSync(process.execPath, [CLI, 'replay', model, lines], { encoding: 'utf8' });
    eq(result.status, 1, result.stdout);
    for (const expected of ['SeatsReserved.expiresAt: a value has no offset, so it names no instant', 'SeatsReserved.hold: a value is no duration',
      'SeatsReserved.slots.length: a value is no duration']) {
      eq(result.stdout.includes(expected), true, `${expected}: ${result.stdout}`);
    }
    eq(result.stdout.includes('not of type'), false, 'a time is a string');
  });

  check('the skill\'s check counts what is unresolved, fails it with --strict, and lists notes per command', () => {
    const noted = write('noted.dcb', swap(swap(MODEL, 'command ClaimUsername(',
      '@assumption("A username is never released")\n@external("The username is not on the block list")\n'
      + '@unresolved("Are usernames case-sensitive?")\ncommand ClaimUsername('),
    'event UsernameClaimed', '@unresolved("Should claims expire?")\nevent UsernameClaimed'));
    const plain = spawnSync(process.execPath, [CLI, 'check', noted], { encoding: 'utf8' });
    eq(plain.status, 0, plain.stderr);
    eq(plain.stdout.includes('Model is incomplete: 2 unresolved'), true, plain.stdout);
    eq(plain.stdout.includes('Notes per command:\n  ClaimUsername:\n    assumption: A username is never released\n    external: The username is not on the block list'), true, plain.stdout);
    eq(plain.stdout.includes('unresolved: Are usernames case-sensitive?'), true, 'each unresolved note');
    const strict = spawnSync(process.execPath, [CLI, 'check', noted, '--strict'], { encoding: 'utf8' });
    eq(strict.status, 1, strict.stdout);
    eq(strict.stderr.includes('Model is incomplete: 2 unresolved'), true, strict.stderr);
    const clean = spawnSync(process.execPath, [CLI, 'check', write('clean.dcb', MODEL), '--strict'], { encoding: 'utf8' });
    eq([clean.status, clean.stdout.includes('incomplete')], [0, false], 'nothing unresolved');
  });

  check('the skill\'s replay masks a sensitive value it folds', () => {
    const model = write('sensitive.dcb', `model "Sensitive"
tag type CustomerId = string
@sensitive
tag type EmailAddress = string
event EmailClaimed { tag customerId: CustomerId, tag email: EmailAddress }
projection CustomerEmail (tag customerId: CustomerId): EmailAddress = null {
  on EmailClaimed => set event.data.email
}
command Claim(customerId: CustomerId, email: EmailAddress) {
  emit EmailClaimed { customerId, email }
}
`);
    const lines = write('sensitive.ndjson', JSON.stringify({ type: 'EmailClaimed', data: { customerId: 'c1', email: 'a@x.test' } }) + '\n');
    const result = spawnSync(process.execPath, [CLI, 'replay', model, lines, '--read', 'CustomerEmail=c1'], { encoding: 'utf8' });
    eq(result.status, 0, result.stdout);
    eq(result.stdout.includes('a@x.test'), false, result.stdout);
    eq(result.stdout.includes('CustomerEmail=c1: "•••"'), true, result.stdout);
  });

  check('the skill\'s JSON is stable, round trips and keeps a sandbox', () => {
    const notation = write('m.dcb', MODEL);
    const json = run('json', notation).stdout;
    eq(json, run('json', notation).stdout, 'the same model, the same document');
    const document = JSON.parse(json);
    document.sandbox = { steps: [{ command: 'ClaimUsername', args: { username: 'a' } }] };
    const file = write('m.dcb.json', JSON.stringify(document));
    eq(JSON.parse(run('json', file).stdout).sandbox, document.sandbox, 'json keeps it');
    const printed = run('print', file);
    eq(printed.stderr.includes('1 sandbox step(s) not printed'), true, 'print says it leaves it');
    eq(printed.stdout, run('print', notation).stdout, 'the same notation back');
  });
}


// ---------------------------------------------------------------
// Commands run top-down (11.0): branches, `reject`, `or`, lazy reads.
// ---------------------------------------------------------------
{
  const SHARES = `model "Shares"

// Types
enum EndReason { OwnerEnded, InviteeEnded }
tag type CustomerId = string
tag type ShareId = string

// Events
event ShareOpened { tag shareId: ShareId, tag owner: CustomerId }
event ShareInvited { tag shareId: ShareId, tag invitee: CustomerId }
event ContractShareEnded { tag shareId: ShareId, reason: EndReason }
event ShareNoted { tag shareId: ShareId, note: string }

// Projections
projection ShareActive (tag shareId: ShareId): boolean = false {
  on ShareOpened => set true
  on ContractShareEnded => set false
}

projection ShareOwner (tag shareId: ShareId): CustomerId = null {
  on ShareOpened => set event.data.owner
}

projection ShareInvitee (tag shareId: ShareId): CustomerId = null {
  on ShareInvited => set event.data.invitee
}

// Commands
command EndContractShare(shareId: ShareId, actor: CustomerId, note?: string) {
  require ShareActive(shareId) is true
    else reject "Share is not active"

  if ShareOwner(shareId) == actor => emit ContractShareEnded { shareId, reason: OwnerEnded }
  else if ShareInvitee(shareId) == actor => {
    require note is not empty
      else reject "An invitee says why"
    emit ContractShareEnded { shareId, reason: InviteeEnded }
    emit ShareNoted { shareId, note }
  }
  else => reject "Customer is not owner or invitee of this share"
}

command NoteShare(shareId: ShareId, actor: CustomerId) {
  if ShareActive(shareId) is true and (ShareOwner(shareId) == actor or ShareInvitee(shareId) == actor) => emit ShareNoted { shareId, note: "seen" }
  if ShareActive(shareId) is true => emit ShareNoted { shareId, note: "active" }
}

command RenameShare(shareId?: ShareId, note: string) {
  alias active = ShareActive(shareId)

  require shareId is not empty
    else reject "No share"
  require active is true
    else reject "Share is not active"

  emit ShareNoted { shareId, note }
}
`;
  const shares = () => buildText(SHARES).model();
  const opened = [
    { type: 'ShareOpened', data: { shareId: 's1', owner: 'alice' } },
    { type: 'ShareInvited', data: { shareId: 's1', invitee: 'bob' } },
  ];
  const run = (model, command, args, log = opened) => sandbox.evaluateCommand(model, log, command, args);

  check('a command with branches prints as written and parses back equal', () => {
    const { model } = buildText(SHARES);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    const text = modelToSource(model());
    eq(text.includes('// Written as JSON'), false, text);
    eq(text.slice(text.indexOf('// Commands')), SHARES.slice(SHARES.indexOf('// Commands')), 'printed as written');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'branches');
    const branch = model()['command-definitions'].EndContractShare.steps[1];
    eq([branch.branches.length, branch.otherwise], [2, [{ reject: 'Customer is not owner or invitee of this share' }]],
      'two arms and an else that rejects');
    eq(model()['command-definitions'].NoteShare.steps[0].branches[0].condition.all[1].any.length, 2,
      '`and` binds tighter, brackets group');
  });

  check('an else chain runs its first arm that holds; the else arm rejects', () => {
    const model = shares();
    const byOwner = run(model, 'EndContractShare', { shareId: 's1', actor: 'alice' });
    eq([byOwner.outcome, byOwner.events.map((e) => e.data.reason)], ['published', ['OwnerEnded']], 'the owner');
    eq(byOwner.arms, ['1/0'], 'the arm it took');
    const byInvitee = run(model, 'EndContractShare', { shareId: 's1', actor: 'bob', note: 'moving out' });
    eq(byInvitee.events.map((e) => e.type), ['ContractShareEnded', 'ShareNoted'], 'a block: two emits, one append');
    eq(byInvitee.events[0].data.reason, 'InviteeEnded', 'the invitee');
    const silent = run(model, 'EndContractShare', { shareId: 's1', actor: 'bob' });
    eq([silent.outcome, silent.failedRule.rejection], ['rejected', 'An invitee says why'], 'a require inside the block refuses');
    const stranger = run(model, 'EndContractShare', { shareId: 's1', actor: 'carol' });
    eq([stranger.outcome, stranger.failedRule.rejection, stranger.events],
      ['rejected', 'Customer is not owner or invitee of this share', []], 'else => reject');
    const closed = run(model, 'EndContractShare', { shareId: 's1', actor: 'alice' },
      [...opened, { type: 'ContractShareEnded', data: { shareId: 's1', reason: 'OwnerEnded' } }]);
    eq(closed.failedRule.rejection, 'Share is not active', 'the require above every arm');
  });

  check('separate ifs all run, and or holds when one side does', () => {
    const model = shares();
    eq(run(model, 'NoteShare', { shareId: 's1', actor: 'alice' }).events.map((e) => e.data.note), ['seen', 'active'],
      'both fire, in written order');
    eq(run(model, 'NoteShare', { shareId: 's1', actor: 'bob' }).events.map((e) => e.data.note), ['seen', 'active'],
      'the bracketed or holds for the invitee');
    eq(run(model, 'NoteShare', { shareId: 's1', actor: 'carol' }).events.map((e) => e.data.note), ['active'],
      'for neither, only the second');
    const ended = [...opened, { type: 'ContractShareEnded', data: { shareId: 's1', reason: 'OwnerEnded' } }];
    eq(run(model, 'NoteShare', { shareId: 's1', actor: 'alice' }, ended).events, [], 'neither: nothing emitted');
    eq(run(model, 'NoteShare', { shareId: 's1', actor: 'alice' }, ended).outcome, 'published', 'then nothing');
  });

  check('a read behind a rule that refused is never made', () => {
    const model = shares();
    // The regression: `alias active = ShareActive(shareId)` with
    // shareId unset errored, though the rule above it refuses first.
    const refused = run(model, 'RenameShare', { note: 'x' });
    eq([refused.outcome, refused.failedRule.rejection], ['rejected', 'No share'], 'refused, not broken');
    eq(Object.keys(refused.reads), [], 'and nothing was read');
    eq(run(model, 'RenameShare', { shareId: 's1', note: 'x' }).outcome, 'published', 'with a share, read and decided');
    // A read reached with a null tag is still an error.
    const moved = JSON.parse(JSON.stringify(model['command-definitions'].RenameShare));
    moved.steps = [moved.steps[1], moved.steps[0], moved.steps[2]];
    const reached = { ...model, 'command-definitions': { ...model['command-definitions'], RenameShare: moved } };
    let error = '';
    try { run(reached, 'RenameShare', { note: 'x' }); } catch (e) { error = e.message; }
    eq(/null/.test(error), true, error);
  });

  check('a run reports the reads it made; the boundary is every read any run might make', () => {
    const model = shares();
    const owner = run(model, 'EndContractShare', { shareId: 's1', actor: 'alice' });
    eq(Object.keys(owner.reads).map((key) => owner.reads[key].projection).sort(), ['ShareActive', 'ShareOwner'],
      'the owner arm never read the invitee');
    const typesOf = (body) => sandbox.deriveDcb(model, body).items.flatMap((item) => item.types);
    eq(typesOf(model['command-definitions'].EndContractShare).includes('ShareInvited'), true, 'statically, the invitee is read');
    const trace = [];
    const seeded = opened.map((event) => ({ ...event, tags: sandbox.tagsOfEvent(model, event.type, event.data) }));
    const handled = sandbox.handleCommand(model, sandbox.memoryStore(seeded), 'EndContractShare',
      { shareId: 's1', actor: 'alice' }, { trace });
    eq(handled.outcome, 'published', 'through a store: ' + JSON.stringify(handled));
    const { condition } = trace.find((entry) => entry.call === 'append');
    eq(condition.failIfEventsMatch.flatMap((item) => item.types).includes('ShareInvited'), false,
      'at runtime the append condition covers only the reads made');
    eq(condition.failIfEventsMatch.flatMap((item) => item.types).includes('ShareOpened'), true, 'and every read it did make');
  });

  check('inside if x is not empty, and after require x is not empty, an optional parameter is present', () => {
    const advised = (text) => sandbox.modelAdvisories(buildText(text).model())
      .filter((a) => /optional/.test(a.message)).map((a) => `${a.name}: ${a.message}`);
    eq(advised(SHARES), [], 'narrowed by the require in the arm, and by the require before the read');
    eq(advised(swap(SHARES, '    require note is not empty\n      else reject "An invitee says why"\n', '')).length, 1,
      'without it, emitting the optional note into a required field is advised');
    eq(advised(swap(SHARES, '  require shareId is not empty\n    else reject "No share"\n', '')).length, 1,
      'and so is reading by it and emitting it, unguarded');
    const inIf = swap(SHARES, '    require note is not empty\n      else reject "An invitee says why"\n    emit ContractShareEnded { shareId, reason: InviteeEnded }\n    emit ShareNoted { shareId, note }\n',
      '    emit ContractShareEnded { shareId, reason: InviteeEnded }\n    if note is not empty => emit ShareNoted { shareId, note }\n');
    eq(advised(inIf), [], 'inside if note is not empty');
  });

  check('one scenario is owed per arm that emits and per rejection message', () => {
    const model = shares();
    eq(sandbox.commandSuccessesOwed(model['command-definitions'].EndContractShare).map((owed) => owed.arm), ['1/0', '1/1'],
      'two arms emit');
    eq(sandbox.commandRejections(model['command-definitions'].EndContractShare).map((o) => o.rejection),
      ['Share is not active', 'An invitee says why', 'Customer is not owner or invitee of this share'], 'three messages');
    eq(sandbox.commandSuccessesOwed(model['command-definitions'].RenameShare), [{ arm: null, events: ['ShareNoted'] }],
      'without branches, succeeding once');
    const scenarios = swap(SHARES, '  else => reject "Customer is not owner or invitee of this share"\n}',
      '  else => reject "Customer is not owner or invitee of this share"\n\n  scenarios {\n'
      + '    scenario "the owner ends it" {\n      given ShareOpened { shareId: "s1", owner: "alice" }\n'
      + '      when EndContractShare { shareId: "s1", actor: "alice", note: null }\n'
      + '      then ContractShareEnded { shareId: "s1", reason: OwnerEnded }\n    }\n\n'
      + '    scenario "a stranger cannot" {\n      given ShareOpened { shareId: "s1", owner: "alice" }\n'
      + '      when EndContractShare { shareId: "s1", actor: "carol", note: null }\n'
      + '      then rejected "Customer is not owner or invitee of this share"\n    }\n  }\n}');
    const covered = buildText(scenarios).model();
    const gaps = sandbox.commandCoverageGaps(covered, 'EndContractShare');
    eq(gaps.succeeds.map((owed) => sandbox.successOwedText(owed)),
      [`emit ContractShareEnded, ShareNoted when ${sandbox.conditionText(covered['command-definitions'].EndContractShare.steps[1].branches[1].condition)}`],
      'the invitee arm is unshown');
    eq(gaps.rejections, ['Share is not active', 'An invitee says why'], 'and two messages');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dcb-branches-'));
    const file = path.join(dir, 'shares.dcb');
    fs.writeFileSync(file, scenarios);
    const cli = path.join(APP, '..', 'skills', 'dcb-notation', 'scripts', 'dcb.js');
    const { status, stderr } = require('child_process').spawnSync(process.execPath, [cli, 'check', file], { encoding: 'utf8' });
    eq(status, 1, 'the skill\'s check fails on it');
    eq(stderr.includes('command EndContractShare: no scenario shows it emit ContractShareEnded, ShareNoted when'), true, stderr);
    eq(stderr.includes('command EndContractShare: no scenario shows "An invitee says why"'), true, stderr);
    eq(stderr.includes('the owner ends it'), false, 'nothing about the arm that is shown');
  });

  check('completion offers if, and after its arrow an emit or a reject', () => {
    const at = (text) => {
      const lines = text.split('\n');
      return sandbox.sourceCompletions(text, lines.length, lines[lines.length - 1].length + 1, { model: shares() });
    };
    const head = SHARES.slice(0, SHARES.indexOf('command NoteShare'));
    const labels = (result) => (result.items || result).map((item) => item.label);
    eq(labels(at(head + 'command X(a: ShareId) {\n  if a == a => ')).includes('emit'), true, 'emit after the arrow');
    eq(labels(at(head + 'command X(a: ShareId) {\n  if a == a => ')).includes('reject'), true, 'and reject');
  });
}

// ---------------------------------------------------------------
// Conditional handlers (11.0): `on E { if … => op  else … }`.
// ---------------------------------------------------------------
{
  const BANK = `model "Bank"

// Types
tag type AccountId = string
enum State { Released, Booked }
record Address { city: string }

// Events
event MoneyTransferred { tag from: AccountId, tag to: AccountId, amount: integer }
event SeatsMarked { tag accountId: AccountId, seats: integer }
event AccountMoved { tag accountId: AccountId, address: Address }

// Projections
projection Balance (tag accountId: AccountId): integer = 0 {
  on MoneyTransferred {
    if event.data.from == accountId => decrement event.data.amount
    if event.data.to == accountId => increment event.data.amount
  }
}

projection Reservation (tag accountId: AccountId): State = null {
  on SeatsMarked {
    if event.data.seats == 0 => set Released
    else if event.data.seats != 1 and (event.data.seats == 2 or event.data.seats == 3) => set Booked
    else => set Booked
  }
}

projection Moves (tag accountId: AccountId): integer = 0 {
  on AccountMoved {
    if event.data.address.city == "Berlin" => increment 1
  }
  on SeatsMarked => set 0
}
`;

  check('a conditional handler prints as written and parses back equal', () => {
    const { model } = buildText(BANK);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    const text = modelToSource(model());
    eq(text.slice(text.indexOf('// Projections')), BANK.slice(BANK.indexOf('// Projections')), 'printed as written');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'handler branches');
    const balance = model()['projection-definitions'].Balance.handlers[0];
    eq(balance.steps.length, 2, 'two separate ifs: two chains');
    eq(balance.steps[0].branches[0].condition,
      { leftHandSide: { eventProperty: 'from' }, predicate: 'equals', rightHandSide: { parameterName: 'accountId' } }, 'the stored leaf');
    const reservation = model()['projection-definitions'].Reservation.handlers[0].steps[0];
    eq([reservation.branches.length, reservation.otherwise], [2, { operation: 'set', value: { enumMember: 'Booked' } }], 'one chain with an else');
    eq(model()['projection-definitions'].Moves.handlers[0].steps[0].branches[0].condition.leftHandSide,
      { eventProperty: 'address', property: 'city' }, 'a record field one hop in');
    const log = [{ type: 'MoneyTransferred', data: { from: 'a1', to: 'a1', amount: 9 } }];
    eq(sandbox.foldProjection(model(), log, 'Balance', { tags: { accountId: 'a1' } }), 0, 'a self-transfer nets 0');
  });

  const errorOf = (from, to) => {
    const { diagnostics } = parseModelSource(swap(BANK, from, to));
    return diagnostics.map((d) => `${d.line}:${d.col} ${d.message}`);
  };
  const lineOf = (needle) => BANK.split('\n').findIndex((line) => line.includes(needle)) + 1;

  check('a condition that reads a projection or the state is a positioned error', () => {
    eq(errorOf('if event.data.from == accountId =>', 'if event.data.from == Balance(accountId) =>'),
      [`${lineOf('event.data.from ==')}:27 A handler's condition reads the event and the projection's tags – never another projection.`],
      'a read');
    eq(errorOf('if event.data.to == accountId =>', 'if state == accountId =>'),
      [`${lineOf('event.data.to ==')}:8 A handler's condition never reads the projection's own state – only the event and its tags.`],
      'the state');
    eq(errorOf('if event.data.to == accountId =>', 'if event.data.to == nope =>'),
      [`${lineOf('event.data.to ==')}:25 "nope" is no tag of Balance – a condition compares with accountId or a literal.`],
      'an unknown name');
    eq(errorOf('if event.data.to == accountId =>', 'if event.data.to < accountId =>')[0].endsWith(
      'A handler\'s condition compares with == or != – found "<".'), true, 'an ordering');
  });

  check('one operation per branch, as a positioned error', () => {
    eq(errorOf('=> decrement event.data.amount', '=> decrement event.data.amount increment 1'),
      [`${lineOf('decrement event.data.amount')}:68 One operation per branch – a second one is a second if.`], 'two ops');
    eq(errorOf('=> decrement event.data.amount', '=> { decrement event.data.amount }')[0].endsWith(
      'One operation per branch – a second one is a second if, so a branch holds no block.'), true, 'a block');
    eq(errorOf('    if event.data.to == accountId', '    else if event.data.to == accountId'), [],
      'an else if after an if continues its chain');
    eq(errorOf('  on MoneyTransferred {\n    if', '  on MoneyTransferred {\n    else =>  increment 1\n    if')[0].endsWith(
      '"else" follows an if – this one has none before it.'), true, 'a leading else');
  });

  check('completion offers if, an event field, a tag and an operation inside a handler\'s branches', () => {
    const head = BANK.slice(0, BANK.indexOf('projection Reservation'));
    const labels = (text) => {
      const lines = text.split('\n');
      const result = sandbox.sourceCompletions(text, lines.length, lines[lines.length - 1].length + 1, {});
      return (result.items || result).map((item) => item.label);
    };
    const open = head + 'projection X (tag accountId: AccountId): integer = 0 {\n  on MoneyTransferred {\n    ';
    eq(labels(open).includes('if'), true, 'if to start a branch');
    eq(labels(open + 'if ').includes('event.data'), true, 'the event to test');
    eq(labels(open + 'if event.data.from == ').includes('accountId'), true, 'a tag to test it against');
    eq(labels(open + 'if event.data.from == accountId => ').includes('increment'), true, 'an operation after the arrow');
  });

  check('the code view names what a condition reads', () => {
    const parsed = parseModelSource(BANK);
    const symbols = sandbox.sourceSymbols(parsed).occurrences.filter((o) => !o.decl);
    const at = (symbol) => symbols.filter((o) => o.symbol === symbol).map((o) => `${o.token.line}:${o.token.col}`);
    eq(at('eventProperty MoneyTransferred from'), [`${lineOf('event.data.from ==')}:19`], 'the event field');
    eq(at('projectionTag Balance accountId'), [`${lineOf("event.data.from ==")}:27`, `${lineOf("event.data.to ==")}:25`],
      'the tag it compares with');
    eq(at('member State Released'), [`${lineOf("set Released")}:37`], 'a member set in a branch');
    eq(at('field Address city'), [`${lineOf("address.city")}:27`], 'a record field');
  });
}


// ---------------------------------------------------------------
// Open tags, collection functions and record values (11.0).
// ---------------------------------------------------------------
{
  const SEATS = `model "Seats"

// Types
tag type CourseId = string
tag type ReservationId = string
tag type CustomerId = string
type Seats = integer
enum Kind { Single, Group }
record Address { street: string, city: string }

// Events
event SeatsWereReserved { tag courseId: CourseId, tag reservationId: ReservationId, numberOfSeatsReserved: Seats, kind: Kind }
event SeatReservationWasCancelled { tag courseId: CourseId, tag reservationId: ReservationId }
event CustomerMoved { tag customerId: CustomerId, address: Address }
event CustomerRelocated { tag customerId: CustomerId, street: string, city: string }
event ParcelSent { tag customerId: CustomerId, city: string, total: Seats }

// Projections
projection ReservationSeats (tag courseId: CourseId, tag reservationId: ReservationId): Seats = 0 {
  on SeatsWereReserved => set event.data.numberOfSeatsReserved
  on SeatReservationWasCancelled => set 0
}

projection ReservationKind (tag courseId: CourseId, tag reservationId: ReservationId): Kind = null {
  on SeatsWereReserved => set event.data.kind
  on SeatReservationWasCancelled => set null
}

derived projection CourseSeatsReserved (tag courseId: CourseId): integer {
  sum(ReservationSeats(courseId, *))
}

derived projection BigReservations (tag courseId: CourseId, least: Seats): integer {
  count(ReservationSeats(courseId, *) where value >= least and (value < 100 or value == 1000))
}

derived projection SeatsLeft (tag courseId: CourseId): integer {
  10 - sum(ReservationSeats(courseId, *))
}

derived projection AnyGroup (tag courseId: CourseId): boolean {
  any(ReservationKind(courseId, *) where value == Group)
}

projection CustomerAddress (tag customerId: CustomerId): Address = null {
  on CustomerMoved => set event.data.address
  on CustomerRelocated => set { street: event.data.street, city: event.data.city }
}

derived projection CustomerCity (tag customerId: CustomerId): string {
  CustomerAddress(customerId).city
}

// Commands
command SendParcel(customerId: CustomerId, courseId: CourseId, city: string, least: Seats) {
  alias address = CustomerAddress(customerId)

  require address.city == city
    else reject "Wrong city"
  require CustomerAddress(customerId).street is not empty
    else reject "No street"
  require count(ReservationSeats(courseId, *) where value >= least) == 0
    else reject "Too many big ones"

  if max(ReservationSeats(courseId, *)) > 5 or all(ReservationKind(courseId, *) where value != Single) is true => reject "Too big"

  emit ParcelSent {
    customerId,
    city: address.city,
    total: sum(ReservationSeats(courseId, *)),
  }
}
`;

  check('open reads, collection functions and record fields print as written and parse back equal', () => {
    const { model } = buildText(SEATS);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    const text = modelToSource(model());
    eq(text.slice(text.indexOf('// Projections')), SEATS.slice(SEATS.indexOf('// Projections')), 'printed as written');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'package 5');
    const projections = model()['projection-definitions'];
    eq(projections.CourseSeatsReserved.derived, { leftHandSide: { collect: 'sum', read: { projection: 'ReservationSeats',
      tags: { courseId: { parameterName: 'courseId' }, reservationId: { open: true } } } } }, 'the stored collection');
    eq(projections.BigReservations.derived.leftHandSide.where.all[0],
      { leftHandSide: { instanceValue: true }, predicate: 'greaterThanOrEquals', rightHandSide: { parameterName: 'least' } }, 'a where');
    eq(projections.CustomerAddress.handlers[1].value,
      { record: { street: { eventProperty: 'street' }, city: { eventProperty: 'city' } } }, 'a record set whole');
    const steps = model()['command-definitions'].SendParcel.steps;
    eq(steps[0].condition.leftHandSide, { alias: 'address', field: 'city' }, 'an alias\'s field');
    eq(steps[1].condition.leftHandSide.field, 'street', 'a read\'s field');
  });

  const errorOf = (from, to) => {
    const { diagnostics } = parseModelSource(swap(SEATS, from, to));
    return diagnostics.map((d) => `${d.line}:${d.col} ${d.message}`);
  };
  const lineOf = (needle) => SEATS.split('\n').findIndex((line) => line.includes(needle)) + 1;

  check('an open read outside a collection function, and a where that reads a projection, are positioned errors', () => {
    eq(errorOf('require address.city == city', 'require ReservationSeats(courseId, *) == city'),
      [`${lineOf('require address.city')}:38 An open read is no value of its own – ReservationSeats(…, *) goes inside count, sum, min, max, average, any or all.`],
      'in a rule');
    eq(errorOf('where value >= least)', 'where CustomerCity(customerId) == city)'),
      [`${lineOf('where value >= least)')}:53 A where reads value, parameters, aliases and literals – never a projection.`], 'a read in a where');
    eq(errorOf('sum(ReservationSeats(courseId, *))\n}', 'sum(ReservationSeats(*, *))\n}'),
      [`${lineOf('  sum(ReservationSeats(courseId, *))')}:7 ReservationSeats(*, *) leaves every tag open – at least one stays bound.`],
      'every tag open');
    eq(errorOf('set { street: event.data.street, city: event.data.city }', 'set address.city = event.data.city').slice(0, 1),
      [`${lineOf('set { street')}:31 A record is replaced whole – set it to an event field holding one, or to { field: …, … } naming every field.`],
      'a partial update');
  });

  check('the code view names what an open read, a where and a record field read', () => {
    const parsed = parseModelSource(SEATS);
    const symbols = sandbox.sourceSymbols(parsed).occurrences.filter((o) => !o.decl);
    const at = (symbol) => symbols.filter((o) => o.symbol === symbol).map((o) => o.token.line);
    eq(at('projection ReservationSeats').length, 6, 'the projection an open read reads');
    eq(at('projectionParameter BigReservations least'), [lineOf('where value >= least and')], 'a parameter in a where');
    eq(at('commandProperty SendParcel least'), [lineOf('where value >= least)')], 'and a command\'s');
    eq(at('member Kind Group'), [lineOf('value == Group')], 'a member compared with value');
    eq(at('field Address city').sort(), [lineOf('CustomerAddress(customerId).city'), lineOf('set { street'),
      lineOf('address.city == city'), lineOf('city: address.city')].sort(), 'a record field, read and set');
    const renamed = renameAt(SEATS, 'record Address { street: string, city', 'record Address { street: string, '.length, 'town');
    eq(parseModelSource(renamed.text).diagnostics, [], `a field rename reads back: ${renamed.error || ''}`);
    eq(renamed.text.includes('address.town == city') && renamed.text.includes('town: event.data.city'), true, 'and follows every use');
  });
}


// ---------------------------------------------------------------
// Fan-out emits (11.0): `for each x in source => emit …`, or a block of
// branches, run once per element.
// ---------------------------------------------------------------
{
  const PORTAL = `model "Portal"

// Types
tag type CustomerId = string
tag type ShareId = string
tag type ContractId = string
tag type NotificationId = string
record ShareInfo { contractId: ContractId, note: string }

// Events
event CustomerRegistered { tag customerId: CustomerId }
event CustomerWasDeleted { tag customerId: CustomerId }
event ContractShareStarted { tag ownerId: CustomerId, tag shareId: ShareId, tag contractId: ContractId, note: string }
event ContractShareEnded { tag ownerId: CustomerId, tag shareId: ShareId, tag contractId: ContractId, reason: string }
event NotificationSent { tag customerId: CustomerId, tag notificationId: NotificationId }
event NotificationWasMarkedAsRead { tag notificationId: NotificationId, tag customerId: CustomerId }

// Projections
projection CustomerExists (tag customerId: CustomerId): boolean = false {
  on CustomerRegistered => set true
  on CustomerWasDeleted => set false
}

projection ShareActiveAsOwner (tag ownerId: CustomerId, tag shareId: ShareId): boolean = false {
  on ContractShareStarted => set true
  on ContractShareEnded => set false
}

projection ShareContract (tag shareId: ShareId): ContractId = null {
  on ContractShareStarted => set event.data.contractId
}

projection ShareDetails (tag ownerId: CustomerId, tag shareId: ShareId): ShareInfo = null {
  on ContractShareStarted => set { contractId: event.data.contractId, note: event.data.note }
  on ContractShareEnded => set null
}

projection ShareContractOf (tag ownerId: CustomerId, tag shareId: ShareId, tag contractId: ContractId): boolean = false {
  on ContractShareStarted => set true
  on ContractShareEnded => set false
}

projection UnreadNotificationIds (tag customerId: CustomerId): NotificationId[] = [] {
  on NotificationSent => append event.data.notificationId
  on NotificationWasMarkedAsRead => remove event.data.notificationId
}

// Commands
command DeleteCustomer(customerId: CustomerId) {
  require CustomerExists(customerId) is true
    else reject "Customer not found"

  emit CustomerWasDeleted { customerId }

  for each shareId in ShareActiveAsOwner(customerId, *) => emit ContractShareEnded {
    ownerId: customerId,
    shareId,
    contractId: ShareContract(shareId),
    reason: "ownerAccountDeleted",
  }
}

command MarkNotificationsAsRead(customerId: CustomerId, notificationIds: NotificationId[]) {
  for each notificationId in notificationIds {
    if UnreadNotificationIds(customerId) contains notificationId => emit NotificationWasMarkedAsRead { notificationId, customerId }
  }
}

command EndShares(customerId: CustomerId, note: string, locked: ContractId) {
  for each (shareId, contractId) in ShareContractOf(customerId, *, *) {
    if contractId == locked => reject "A share is locked"
  }

  for each shareId in ShareDetails(customerId, *) {
    if value.note == note => emit ContractShareEnded {
      ownerId: customerId,
      shareId,
      contractId: value.contractId,
      reason: "byNote",
    }
    else if value is not empty => emit ContractShareEnded {
      ownerId: customerId,
      shareId,
      contractId: value.contractId,
      reason: "other",
    }
    else => reject "Unreachable"
  }
}
`;

  check('a for each prints as written and parses back equal', () => {
    const { model } = buildText(PORTAL);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    const text = modelToSource(model());
    eq(text.slice(text.indexOf('// Commands')), PORTAL.slice(PORTAL.indexOf('// Commands')), 'printed as written');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'package 6');
    const steps = model()['command-definitions'].DeleteCustomer.steps;
    eq(steps[2].forEach, ['shareId'], 'the name');
    eq(steps[2].in, { projection: 'ShareActiveAsOwner', tags: { ownerId: { parameterName: 'customerId' }, shareId: { open: true } } }, 'an open read');
    eq(steps[2].steps[0].parameters.shareId, { parameterName: 'shareId' }, 'the element, read as a name in scope');
    eq(model()['command-definitions'].MarkNotificationsAsRead.steps[0].in, { parameterName: 'notificationIds' }, 'a list parameter');
    const ends = model()['command-definitions'].EndShares.steps;
    eq(ends[0].forEach, ['shareId', 'contractId'], 'two names');
    eq(ends[1].steps[0].branches[0].steps[0].parameters.contractId, { instanceValue: true, field: 'contractId' }, 'value.field');
  });

  const errorOf = (from, to) => {
    const { diagnostics } = parseModelSource(swap(PORTAL, from, to));
    return diagnostics.map((d) => `${d.line}:${d.col} ${d.message}`);
  };
  const lineOf = (needle) => PORTAL.split('\n').findIndex((line) => line.includes(needle)) + 1;

  check('a nested for each, a rule inside one and a block arm are positioned errors', () => {
    const at = lineOf('for each notificationId in');
    eq(errorOf('    if UnreadNotificationIds(customerId) contains', '    for each x in notificationIds => emit CustomerWasDeleted { customerId }\n    if UnreadNotificationIds(customerId) contains'),
      [`${at + 1}:5 A for each inside another is refused – a loop does not nest.`], 'nested');
    eq(errorOf('    if UnreadNotificationIds(customerId) contains', '    require notificationIds is not empty else reject "x"\n    if UnreadNotificationIds(customerId) contains'),
      [`${at + 1}:5 A for each holds emit and if … => emit – a loop emits; "if not … => reject" refuses from inside one.`], 'a rule');
    eq(errorOf('contains notificationId => emit', 'contains notificationId => { emit'),
      [`${at + 1}:69 A branch inside a for each holds one emit or one reject.`], 'a block arm');
    eq(errorOf('for each shareId in ShareActiveAsOwner(customerId, *) => emit', 'for each shareId in ShareActiveAsOwner(customerId, *) => reject "x" emit'),
      [`${lineOf('for each shareId in ShareActive')}:60 Expected emit after "=>" – a for each emits once per element, or runs a block "{ … }" of if branches.`], 'a bare reject');
    eq(errorOf('for each shareId in ShareActive', 'for each customerId in ShareActive').slice(0, 1),
      [`${lineOf('for each shareId in ShareActive')}:12 customerId already names a payload property – a loop's name is its own.`], 'a shadowing name');
  });

  check('the code view names a loop\'s names, its source and value', () => {
    const parsed = parseModelSource(PORTAL);
    const symbols = sandbox.sourceSymbols(parsed).occurrences;
    const at = (symbol, decl = false) => symbols.filter((o) => o.symbol === symbol && !!o.decl === decl).map((o) => o.token.line);
    eq(at('loopVariable DeleteCustomer shareId', true), [lineOf('for each shareId in ShareActive')], 'the name, declared');
    eq(at('loopVariable DeleteCustomer shareId'), [lineOf('    shareId,'), lineOf('contractId: ShareContract(shareId)')], 'and read');
    eq(at('projection ShareActiveAsOwner').includes(lineOf('for each shareId in ShareActive')), true, 'the source');
    eq(at('field ShareInfo contractId').filter((l) => l > lineOf('command EndShares')).length, 2, 'value.field');
    const renamed = renameAt(PORTAL, 'for each shareId in ShareActive', 'for each '.length, 'share');
    eq(parseModelSource(renamed.text).diagnostics, [], `a loop name renames: ${renamed.error || ''}`);
    eq(renamed.text.includes('contractId: ShareContract(share)') && renamed.text.includes('    shareId: share,'), true, 'and follows its uses');
  });

  check('a scenario lists the events a loop emits, in order, with then … and …', () => {
    const scenario = (first, second) => swap(PORTAL, '    reason: "ownerAccountDeleted",\n  }\n}',
      '    reason: "ownerAccountDeleted",\n  }\n\n  scenarios {\n'
      + '    scenario "each active share ends" {\n'
      + '      given CustomerRegistered { customerId: "u1" }\n'
      + '      and ContractShareStarted { ownerId: "u1", shareId: "s1", contractId: "k1", note: "" }\n'
      + '      and ContractShareStarted { ownerId: "u1", shareId: "s2", contractId: "k2", note: "" }\n'
      + '      when DeleteCustomer { customerId: "u1" }\n'
      + '      then CustomerWasDeleted { customerId: "u1" }\n'
      + `      and ContractShareEnded { ownerId: "u1", shareId: "${first}", contractId: "k${first.slice(1)}", reason: "ownerAccountDeleted" }\n`
      + `      and ContractShareEnded { ownerId: "u1", shareId: "${second}", contractId: "k${second.slice(1)}", reason: "ownerAccountDeleted" }\n`
      + '    }\n  }\n}');
    const statusOf = (text) => {
      const model = buildText(text).model();
      return Object.values(model['scenario-definitions']).map((body) => sandbox.runScenario(model, body).status);
    };
    eq(statusOf(scenario('s1', 's2')), ['current'], 'in first-event order');
    eq(statusOf(scenario('s2', 's1')), ['drifted'], 'compared in that order');
    const gaps = sandbox.commandCoverageGaps(buildText(scenario('s1', 's2')).model(), 'DeleteCustomer');
    eq([gaps.succeeds, gaps.rejections], [[], ['Customer not found']], 'its success shown');
  });

  check('completion offers for each and in', () => {
    const head = PORTAL.slice(0, PORTAL.indexOf('// Commands')) + 'command X(customerId: CustomerId, ids: NotificationId[]) {\n  ';
    const labels = (text) => completeAt(text + '|\n}').labels;
    eq(labels(head).includes('for each'), true, 'a for each to start a step');
    eq(labels(head + 'for each id in ').includes('ids'), true, 'a list to run over');
    eq(labels(head + 'for each id in ids => ').includes('emit'), true, 'emit after the arrow');
  });
}

// ---------------------------------------------------------------
// Time (11.0): `datetime` and `duration`, duration literals, and values
// added and subtracted in rules, emissions and derived projections.
// ---------------------------------------------------------------
{
  const TIME = `model "Time"

// Types
tag type CourseId = string
tag type ReservationId = string
tag type OptInToken = string
type Deadline = datetime
type RetryWindow = duration
record ReservationInfo { seats: integer, expiresAt: datetime }

// Events
event CourseDefined { tag courseId: CourseId, capacity: integer }

event SeatsWereReserved {
  tag courseId: CourseId
  tag reservationId: ReservationId
  seats: integer
  expiresAt: datetime
}

event OptInIssued { tag token: OptInToken, issuedAt: datetime, window: duration }
event SignUpConfirmed { tag token: OptInToken }

// Projections
projection CourseCapacity (tag courseId: CourseId): integer = 0 {
  on CourseDefined => set event.data.capacity
}

projection Reservation (tag courseId: CourseId, tag reservationId: ReservationId): ReservationInfo = null {
  on SeatsWereReserved => set { seats: event.data.seats, expiresAt: event.data.expiresAt }
}

projection OptInIssuedAt (tag token: OptInToken): datetime = null {
  on OptInIssued => set event.data.issuedAt
}

projection WeekLongWindows (tag token: OptInToken): integer = 0 {
  on OptInIssued {
    if event.data.window == 7d => increment 1
  }
}

derived projection OptInExpiresAt (tag token: OptInToken): datetime {
  OptInIssuedAt(token) + 24h
}

derived projection ActiveSeats (tag courseId: CourseId, now: datetime): integer {
  sum(Reservation(courseId, *).seats where value.expiresAt > now)
}

// Commands
command ReserveSeats(
  courseId: CourseId,
  reservationId: ReservationId,
  seats: integer,
  now: datetime,
) {
  require CourseCapacity(courseId) - sum(Reservation(courseId, *).seats where value.expiresAt > now) >= seats
    else reject "Not enough seats"

  emit SeatsWereReserved { courseId, reservationId, seats, expiresAt: now + 15m }
}

command ConfirmSignUp(token: OptInToken, now: datetime) {
  require OptInIssuedAt(token) + 24h > now
    else reject "Token expired"
  require OptInIssuedAt(token) - 1h30m < now - 30s + 1d
    else reject "Not yet"

  emit SignUpConfirmed { token }
}
`;

  check('completion knows collections, open reads, where, durations and loop bodies', () => {
    const head = TIME.slice(0, TIME.indexOf('// Commands')) + '// Commands\ncommand X(courseId: CourseId, ids: ReservationId[], now: datetime) {\n  ';
    const labels = (text) => completeAt(text + '|\n}').labels;
    eq(labels(head + 'require sum(').includes('Reservation'), true, 'a projection tagged by several, inside sum(');
    const read = completeAt(head + 'require sum(|\n}').items.find((i) => i.label === 'Reservation');
    eq(read.insert, 'Reservation($1, *)', 'read with its last tag open');
    eq(labels(head + 'require sum(Reservation(courseId, ').includes('*'), true, 'an open tag in a collection\'s read');
    eq(labels(head + 'require sum(Reservation(courseId, *)) ').includes('where') || labels(head + 'require sum(Reservation(courseId, *) ').includes('where'), true, 'where after the read');
    eq(labels(head + 'require sum(Reservation(courseId, *).').includes('seats'), true, 'a record field to sum');
    const where = labels(head + 'require sum(Reservation(courseId, *).seats where ');
    eq(['value', 'value.seats', 'value.expiresAt'].every((l) => where.includes(l)), true, 'value and its fields: ' + where);
    eq(labels(head + 'require sum(Reservation(courseId, *).seats where value.expiresAt > ').includes('now'), true, 'a name in scope');
    eq(labels(head + 'require sum(Reservation(courseId, *).seats where value.expiresAt > now ').includes('and'), true, 'and / or');
    eq(labels(head + 'require CourseCapacity(courseId) > ').includes('sum'), true, 'a collection where a value fits');
    eq(labels(head + 'emit SeatsWereReserved { seats: ').includes('sum'), true, 'and in an emission');
    eq(labels(head + 'emit SeatsWereReserved { expiresAt: now + 15'), ['15s', '15m', '15h', '15d'], 'duration units after a number');
    eq(labels(head + 'require now > 15').length, 0, 'not after any number');
    const source = labels(head + 'for each id in ');
    eq(source.includes('ids') && source.includes('Reservation') && !source.includes('now'), true, 'lists and open reads to run over: ' + source);
    eq(labels(head + 'for each id in ids {\n    '), ['emit', 'if'], 'a loop\'s steps');
    eq(labels(head + 'for each (c, r) in Reservation(courseId, *) {\n    if CourseCapacity(courseId) > ').includes('value'), true, 'value in a loop over an open read');
  });

  check('completion knows a handler branch\'s nested fields and enum members, and annotations in a group', () => {
    const text = [
      'model "H"', 'tag type AccountId = string', 'enum Kind { Debit, Credit }', 'record Party { accountId: AccountId, kind: Kind }',
      'event Moved { tag accountId: AccountId, from: Party }',
      'group Account (tag accountId: AccountId) {',
      '  @',
    ].join('\n');
    eq(completeAt(text + '|\n}').labels, ['assumption', 'external', 'unresolved'], 'a grouped projection\'s notes');
    const handler = [
      'model "H"', 'tag type AccountId = string', 'enum Kind { Debit, Credit }', 'record Party { accountId: AccountId, kind: Kind }',
      'event Moved { tag accountId: AccountId, from: Party }',
      'projection Count (tag accountId: AccountId): integer = 0 {',
      '  on Moved {',
      '    if event.data.from.',
    ].join('\n');
    eq(completeAt(handler + '|\n  }\n}').labels, ['accountId', 'kind'], 'a record field one hop in');
    eq(completeAt(handler + 'kind == |\n  }\n}').labels.includes('Debit'), true, 'the field\'s enum members');
    eq(completeAt(handler + 'accountId == |\n  }\n}').labels.includes('accountId'), true, 'the projection\'s tag');
  });

  check('time prints as written and parses back equal', () => {
    const { model } = buildText(TIME);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    const text = modelToSource(model());
    eq(text, TIME, 'printed as written');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'package 7');
    const reserve = model()['command-definitions'].ReserveSeats.steps;
    eq(reserve[0].condition.leftHandSide.operator, 'subtract', 'a rule computes');
    eq(reserve[1].parameters.expiresAt, { operator: 'add', leftHandSide: { parameterName: 'now' }, rightHandSide: { duration: 'PT15M' } }, 'now + 15m');
    const later = model()['command-definitions'].ConfirmSignUp.steps[1].condition.rightHandSide;
    eq([later.operator, later.leftHandSide.operator, later.rightHandSide], ['add', 'subtract', { duration: 'P1D' }], 'left to right');
    eq(model()['custom-type-definitions'].Deadline.schema, { type: 'string', format: 'date-time' }, 'a type that is a datetime');
    eq(model()['projection-definitions'].OptInExpiresAt.derived.rightHandSide, { duration: 'PT24H' }, 'a duration in a derived projection');
  });

  const errorOf = (from, to) => {
    const { diagnostics } = parseModelSource(swap(TIME, from, to));
    return diagnostics.map((d) => `${d.line}:${d.col} ${d.message}`);
  };
  const lineOf = (needle) => TIME.split('\n').findIndex((line) => line.includes(needle)) + 1;

  check('a misspelt duration is a positioned error', () => {
    const at = lineOf('expiresAt: now + 15m');
    eq(errorOf('now + 15m', 'now + 15x'), [`${at}:77 "x" is no duration unit – a duration counts d, h, m and s: 30s, 15m, 24h, 7d.`], 'an unknown unit');
    eq(errorOf('now + 15m', 'now + 1mo'), [`${at}:77 "1mo" – a duration has no years, months or weeks, which have no fixed length; count days: 30d.`], 'a month');
    eq(errorOf('now + 15m', 'now + 1.5h'), [`${at}:77 "1.5h" is no duration – write a whole number and a unit: 30s, 15m, 24h, 7d.`], 'a fraction');
    eq(errorOf('now + 15m', 'now + 30m1h'), [`${at}:77 "30m1h" – write each unit once, largest first: 1d2h30m.`], 'units out of order');
  });

  check('the code view names what arithmetic reads', () => {
    const parsed = parseModelSource(TIME);
    const symbols = sandbox.sourceSymbols(parsed).occurrences;
    const at = (symbol) => symbols.filter((o) => o.symbol === symbol && !o.decl).map((o) => o.token.line);
    eq(at('projection CourseCapacity').includes(lineOf('require CourseCapacity(courseId) -')), true, 'a read on the left');
    eq(at('projection Reservation').includes(lineOf('require CourseCapacity(courseId) -')), true, 'and the collection on the right');
    eq(at('commandProperty ReserveSeats now').includes(lineOf('expiresAt: now + 15m')), true, 'a parameter inside a sum');
    const renamed = renameAt(TIME, 'expiresAt: now + 15m', 'expiresAt: '.length + 2, 'at');
    eq(parseModelSource(renamed.text).diagnostics, [], `now renames: ${renamed.error || ''}`);
    eq(renamed.text.includes('expiresAt: at + 15m') && renamed.text.includes('where value.expiresAt > at'), true, 'and follows its uses');
  });

  check('completion offers datetime and duration as types', () => {
    const labels = completeAt(TIME.slice(0, TIME.indexOf('// Commands')) + 'command X(when: |) {}\n').labels;
    eq(labels.includes('datetime') && labels.includes('duration'), true, 'both built-in');
  });

  check('the editor colours a duration as one literal and the time types as types', () => {
    const { SOURCE_MONARCH: grammar } = sandbox;
    const rule = grammar.tokenizer.root.find((r) => Array.isArray(r) && r[1] === 'number.duration');
    eq(!!rule && new RegExp(rule[0].source, 'u').exec('1h30m)')[0], '1h30m', 'a duration token');
    eq(new RegExp(rule[0].source, 'u').test('15mx'), false, 'not the start of a word');
    eq(['datetime', 'duration'].every((type) => grammar.baseTypes.includes(type)), true, 'types');
  });

  check('the language reference covers time', () => {
    const reference = sandbox.sourceLanguageReference();
    for (const word of ['datetime', 'duration', 'now + 15m', '24h']) eq(reference.includes(word), true, word);
  });
}

// ---------------------------------------------------------------
// Strict handler assignments (11.0, package 8): what a handler writes
// is held to nominal types, as an emission and a read's tag are. A
// CustomerId does not fill a ShareInviteeId; a literal fits any type of
// its base. Advised, never refused.
// ---------------------------------------------------------------
{
  const STRICT = `model "Strict"

tag type CustomerId = string
tag type ShareId = string
tag type ShareInviteeId = string
type Seats = integer
record Hold { seats: Seats, note: string }

event ShareStarted { tag shareId: ShareId, tag owner: CustomerId, tag invitee: CustomerId, seats: integer, note: string, held: Hold }
event InviteeNamed { tag shareId: ShareId, tag invitee: ShareInviteeId }

projection Invitee (tag shareId: ShareId): ShareInviteeId = null {
  on InviteeNamed => set event.data.invitee
}

projection Seated (tag shareId: ShareId): Seats = 0 {
  on ShareStarted => set 3
}

projection Owners (tag shareId: ShareId): CustomerId[] = [] {
  on ShareStarted => append event.data.owner
}

projection Held (tag shareId: ShareId): Hold = null {
  on ShareStarted => set event.data.held
}

command Start(shareId: ShareId, owner: CustomerId, invitee: CustomerId, held: Hold) {
  emit ShareStarted { shareId, owner, invitee, seats: 1, note: "", held }
}
`;
  const advised = (text) => {
    const { model } = buildText(text);
    return advisedOtherwise(model()).map((a) => `${a.name}: ${a.message}`);
  };

  check('a handler writing its own type, or a literal, is advisory-clean', () => {
    eq(advised(STRICT), [], 'clean');
  });

  check('a handler setting another nominal type is advised, not refused', () => {
    const found = advised(swap(STRICT, 'on InviteeNamed => set event.data.invitee', 'on ShareStarted => set event.data.invitee'));
    eq(found.length, 1, found.join('; '));
    eq(found[0], 'Invitee: The handler for "ShareStarted" on projection "Invitee" sets it to "event.data.invitee", a CustomerId '
      + '– but it holds a ShareInviteeId. Nothing converts one into the other: tag the event by a ShareInviteeId, '
      + 'or hold a CustomerId.', 'the message');
  });

  check('an integer does not fill a Seats, a list takes its element type, a record field its declared type', () => {
    eq(advised(swap(STRICT, 'on ShareStarted => set 3', 'on ShareStarted => set event.data.seats')).length, 1, 'integer into Seats');
    // D4: the advice for a value type is the field's type, not a tag.
    eq(advised(swap(STRICT, 'on ShareStarted => set 3', 'on ShareStarted => set event.data.seats'))[0].endsWith(
      'Nothing converts one into the other: declare "seats" of ShareStarted as a Seats, or hold an integer.'), true, 'a value type\'s advice');
    eq(advised(swap(STRICT, 'append event.data.owner', 'append event.data.shareId')).length, 1, 'a ShareId into CustomerId[]');
    eq(advised(swap(STRICT, 'on ShareStarted => set event.data.held', 'on ShareStarted => set { seats: event.data.seats, note: event.data.note }')).length,
      1, 'an integer into a Seats field');
    eq(advised(swap(STRICT, 'on ShareStarted => set event.data.held', 'on ShareStarted => set { seats: 2, note: event.data.note }')), [],
      'a literal and a matching field');
  });

  check('a branched handler is held to the same', () => {
    const found = advised(swap(STRICT, 'on InviteeNamed => set event.data.invitee',
      'on ShareStarted {\n    if event.data.shareId == shareId => set event.data.owner\n  }'));
    eq(found.some((m) => /a CustomerId – but it holds a ShareInviteeId/.test(m)), true, found.join('; '));
  });
}

// ---------------------------------------------------------------
// Partial scenarios (11.0, package 9): a scenario leaves out what its
// outcome does not depend on. Tags are always given; a field left out
// is unspecified, and reading one breaks the scenario, naming it. A
// then compares what it lists. The values given are held to their
// types' constraints, and an optional list is allowed.
// ---------------------------------------------------------------
{
  const PARTIAL = `model "Partial"

tag type CustomerId = string { pattern: "^cu[0-9]+$" }
tag type ContractId = string
type Installment = integer { minimum: 1 }

event CustomerWasAdded { tag customerId: CustomerId, name: string, emailAddress: string }
event ContractWasImported { tag customerId: CustomerId, tag contractId: ContractId, title: string }
event InstallmentSet { tag contractId: ContractId, tag actor: CustomerId, installment: Installment, note: string }
event Greeted { tag customerId: CustomerId }
event LabelsSet { tag contractId: ContractId, labels?: string[] }

projection ContractOwner (tag contractId: ContractId): CustomerId = null {
  on ContractWasImported => set event.data.customerId
}

projection CustomerName (tag customerId: CustomerId): string = null {
  on CustomerWasAdded => set event.data.name
}

command SetInstallment(contractId: ContractId, actor: CustomerId, installment: Installment, note: string) {
  require ContractOwner(contractId) == actor
    else reject "Share does not permit this action"

  emit InstallmentSet { contractId, actor, installment, note }

  scenarios {
    scenario "another customer" {
      given CustomerWasAdded { customerId: "cu1" }
      and ContractWasImported { customerId: "cu1", contractId: "co1" }
      when SetInstallment { contractId: "co1", actor: "cu2" }
      then rejected "Share does not permit this action"
    }

    scenario "the owner" {
      given ContractWasImported { customerId: "cu1", contractId: "co1" }
      when SetInstallment { contractId: "co1", actor: "cu1", installment: 50, note: "n" }
      then InstallmentSet { contractId: "co1", actor: "cu1", installment: 50 }
    }
  }
}

command Greet(customerId: CustomerId) {
  require CustomerName(customerId) != ""
    else reject "Nameless"

  emit Greeted { customerId }
}

command SetLabels(contractId: ContractId, labels?: string[]) {
  emit LabelsSet { contractId, labels }
}
`;
  const statuses = (text) => {
    const model = buildText(text).model();
    return Object.values(model['scenario-definitions']).map((body) => {
      const run = sandbox.runScenario(model, body);
      return run.status === 'broken' ? run.reason : run.status;
    });
  };
  const EMITS = { Greet: '  emit Greeted { customerId }\n', SetLabels: '  emit LabelsSet { contractId, labels }\n' };
  const withScenario = (command, scenario) => swap(PARTIAL, `${EMITS[command]}}`, `${EMITS[command]}\n  scenarios {\n${scenario}\n  }\n}`);

  check('a scenario leaves out what its outcome does not depend on', () => {
    const { model } = buildText(PARTIAL);
    eq(advisedOtherwise(model()), [], 'advisory-clean, an optional list included');
    const printed = modelToSource(model());
    eq(printed.includes('given CustomerWasAdded { customerId: "cu1" }'), true, 'printed as written');
    eq(printed.includes('when SetInstallment { contractId: "co1", actor: "cu2" }'), true, 'a partial when');
    eq(printed.includes('Written as JSON'), false, 'no definition falls back');
    eq(Object.values(model()['scenario-definitions'])[0].given[0].data, { customerId: 'cu1' }, 'stored as written');
    eq(statuses(PARTIAL), ['current', 'current'], 'both hold');
  });

  check('a then compares the fields it lists, and only those', () => {
    eq(statuses(swap(PARTIAL, 'then InstallmentSet { contractId: "co1", actor: "cu1", installment: 50 }',
      'then InstallmentSet { contractId: "co1", actor: "cu1", installment: 51 }')), ['current', 'drifted'], 'a listed field differs');
    eq(statuses(swap(PARTIAL, 'then InstallmentSet { contractId: "co1", actor: "cu1", installment: 50 }',
      'then InstallmentSet { contractId: "co1", actor: "cu1", note: "n" }')), ['current', 'current'], 'another field listed');
  });

  check('reading a field left out breaks the scenario, naming it', () => {
    eq(statuses(swap(PARTIAL, 'actor: "cu1", installment: 50, note: "n" }', 'actor: "cu1", installment: 50 }')),
      ['current', 'Reads unspecified field "note" of SetInstallment – the outcome depends on it, so the scenario gives it.'], 'a parameter emitted');
    const greet = withScenario('Greet', '    scenario {\n      given CustomerWasAdded { customerId: "cu1" }\n'
      + '      when Greet { customerId: "cu1" }\n      then Greeted { customerId: "cu1" }\n    }');
    eq(statuses(greet).slice(2), ['Reads unspecified field "name" of CustomerWasAdded – the outcome depends on it, so the scenario gives it.'], 'a field a handler sets');
  });

  check('a tag left out is an error', () => {
    eq(statuses(swap(PARTIAL, 'given ContractWasImported { customerId: "cu1", contractId: "co1" }', 'given ContractWasImported { contractId: "co1" }'))[1],
      'Given step 1 ("ContractWasImported") leaves out the tag "customerId" – a scenario gives every tag, since tags decide which reads see an event.', 'in a given');
    eq(statuses(swap(PARTIAL, 'then InstallmentSet { contractId: "co1", actor: "cu1", installment: 50 }', 'then InstallmentSet { contractId: "co1", installment: 50 }'))[1],
      'Expected event 1 ("InstallmentSet") leaves out the tag "actor" – a scenario gives every tag, since tags decide which reads see an event.', 'in a then');
  });

  check('the values a scenario gives are held to their types\' constraints', () => {
    eq(statuses(swap(PARTIAL, 'given CustomerWasAdded { customerId: "cu1" }', 'given CustomerWasAdded { customerId: "x1" }')),
      ['Given step 1 ("CustomerWasAdded") gives customerId "x1", which CustomerId does not admit: not matching ^cu[0-9]+$ (scenario values are held to their types since 11.0).', 'current'], 'a pattern in a given');
    eq(statuses(swap(PARTIAL, 'installment: 50, note: "n" }', 'installment: 0, note: "n" }'))[1],
      'The When ("SetInstallment") gives installment 0, which Installment does not admit: below 1 (scenario values are held to their types since 11.0).', 'a minimum in a when');
    eq(statuses(swap(PARTIAL, 'then InstallmentSet { contractId: "co1", actor: "cu1", installment: 50 }',
      'then InstallmentSet { contractId: "co1", actor: "cu1", installment: -5 }'))[1],
      'Expected event 1 ("InstallmentSet") gives installment -5, which Installment does not admit: below 1 (scenario values are held to their types since 11.0).', 'a minimum in a then');
  });

  check('a command emitting nothing is advised as a query, outside the model', () => {
    const { model } = buildText(PARTIAL + `
command MayEdit(contractId: ContractId, actor: CustomerId) {
  require ContractOwner(contractId) == actor
    else reject "Share does not permit this action"
}
`);
    eq(advisedOtherwise(model()).map((a) => `${a.name}: ${a.message}`),
      ['MayEdit: A command must publish at least one event: a command without an event is a query, outside the model.'], 'the reason given');
  });

  check('an optional list is allowed, and null is its absence', () => {
    const labels = withScenario('SetLabels', '    scenario {\n      when SetLabels { contractId: "co1", labels: null }\n'
      + '      then LabelsSet { contractId: "co1", labels: null }\n    }\n\n    scenario {\n      when SetLabels { contractId: "co1", labels: ["a"] }\n'
      + '      then LabelsSet { contractId: "co1", labels: ["a"] }\n    }');
    eq(statuses(labels).slice(2), ['current', 'current'], 'both hold');
  });
}

// ---------------------------------------------------------------
// Descriptions, notes and @sensitive (11.0, package 10): a /// doc
// comment above a definition or the model line is its stored
// description; @assumption, @unresolved and @external are repeatable
// notes on any definition, @deprecated marks an event, @sensitive a
// type. Documentation only: none changes a boundary.
// ---------------------------------------------------------------
{
  const NOTES = `/// The customer portal.
/// Second line.
model "Notes"

// Types
/// An email address, lower case.
@sensitive
tag type EmailAddress = string { pattern: "^[^A-Z]*$" }

tag type CustomerId = string

@sensitive
type FullName = string

// Events
/// A customer's sign-up.
event CustomerSignedUp {
  tag customerId: CustomerId
  tag email: EmailAddress
  name: FullName
}

/// Stored before 2024. Replaced by CustomerSignedUp.
@deprecated
event EmailAddressWasRegistered { tag customerId: CustomerId, tag email: EmailAddress }

// Groups
/// Everything about one customer.
@unresolved("Does a deleted customer keep the group?")
group Customer (tag customerId: CustomerId) {
  /// Whether the customer exists.
  @assumption("A deleted customer counts as existing")
  projection exists: boolean = false {
    on CustomerSignedUp => set true
    on EmailAddressWasRegistered => set true
  }
}

// Projections
/// Whether an email address is taken.
projection EmailTaken (tag email: EmailAddress): boolean = false {
  on CustomerSignedUp => set true
  on EmailAddressWasRegistered => set true
}

/// Free when not taken.
derived projection EmailFree (tag email: EmailAddress): boolean {
  EmailTaken(email) == false
}

// Commands
/// A customer's sign-up, confirmed later.
@feature("Sign-up")
@assumption("A deleted customer's email can be reused at once")
@assumption("Names are not unique")
@external("Email domain is not on the block list")
@unresolved("Sign-up after deletion should restore the old customer?")
command SignUp(customerId: CustomerId, email: EmailAddress, name: FullName) {
  require EmailFree(email) is true
    else reject "Email address is taken"

  emit CustomerSignedUp { customerId, email, name }
}
`;

  check('descriptions and notes print as written and parse back equal', () => {
    const { model } = buildText(NOTES);
    eq(sandbox.modelAdvisories(model()), [], 'advisory-clean');
    eq(modelToSource(model()), NOTES, 'printed as written');
    const parsed = parseModelSource(NOTES);
    eq(parsed.diagnostics, [], 'it reads');
    assertSameModel(model(), parsed, 'package 10');
    eq(model().description, 'The customer portal.\nSecond line.', 'the model\'s description');
    const types = model()['custom-type-definitions'];
    eq([types.EmailAddress.description, types.EmailAddress.isSensitive, types.FullName.isSensitive, types.CustomerId.isSensitive],
      ['An email address, lower case.', true, true, undefined], 'types');
    const events = model()['event-definitions'];
    eq([events.EmailAddressWasRegistered.isDeprecated, events.CustomerSignedUp.isDeprecated], [true, undefined], 'deprecated');
    const command = model()['command-definitions'].SignUp;
    eq([command.description, command.assumptions, command.externalRules, command.unresolved],
      ['A customer\'s sign-up, confirmed later.', ['A deleted customer\'s email can be reused at once', 'Names are not unique'],
        ['Email domain is not on the block list'], ['Sign-up after deletion should restore the old customer?']], 'a command\'s notes');
    const group = model()['group-definitions'].Customer;
    eq([group.description, group.unresolved, group.projections[0].description, group.projections[0].assumptions],
      ['Everything about one customer.', ['Does a deleted customer keep the group?'], 'Whether the customer exists.', ['A deleted customer counts as existing']], 'a group and its projection');
    eq(model()['projection-definitions'].EmailFree.description, 'Free when not taken.', 'a derived projection');
  });

  check('notes change no boundary', () => {
    const plain = buildText(NOTES.split('\n').filter((line) => !/^\s*(\/\/\/|@(assumption|unresolved|external|deprecated|sensitive))/.test(line)).join('\n'));
    const before = sandbox.deriveDcb(plain.model(), plain.model()['command-definitions'].SignUp);
    const noted = buildText(NOTES);
    eq(sandbox.deriveDcb(noted.model(), noted.model()['command-definitions'].SignUp), before, 'the same query');
  });

  check('descriptions and notes travel in the JSON document', () => {
    const { model } = buildText(NOTES);
    const envelope = JSON.parse(JSON.stringify(sandbox.buildShareEnvelope(model(), [])));
    eq(envelope.description, 'The customer portal.\nSecond line.', 'the model\'s');
    eq(envelope.customTypeDefinitions.find((t) => t.name === 'EmailAddress').isSensitive, true, 'isSensitive');
    eq(envelope.eventDefinitions.find((e) => e.name === 'EmailAddressWasRegistered').isDeprecated, true, 'isDeprecated');
    eq(envelope.commandDefinitions[0].externalRules, ['Email domain is not on the block list'], 'externalRules');
    fresh();
    const { modelId } = importModelFromEnvelope(envelope);
    eq(modelToSource(projectState()[modelId]), NOTES, 'imported back whole');
  });

  check('an annotation where it does not belong is a positioned error', () => {
    const errorOf = (from, to) => parseModelSource(swap(NOTES, from, to)).diagnostics.map((d) => d.message);
    eq(errorOf('@feature("Sign-up")', '@deprecated'), ['A command carries no @deprecated.'], 'deprecated is an event\'s');
    eq(errorOf('/// A customer\'s sign-up.\nevent', '@sensitive\nevent'), ['An event carries no @sensitive.'], 'sensitive is a type\'s');
    eq(errorOf('@deprecated\nevent', '@deprecated\n@deprecated\nevent'), ['@deprecated is given twice.'], 'once');
    eq(errorOf('@feature("Sign-up")', '@note("x")')[0].startsWith('There is no @note'), true, 'unknown');
    eq(errorOf('@deprecated\nevent', '@deprecated("x")\nevent'), ['@deprecated takes nothing: @deprecated.'], 'a flag takes no text');
    eq(errorOf('@assumption("Names are not unique")', '@assumption'), ['@assumption takes its text: @assumption("…").'], 'a note takes text');
  });

  check('a /// line anywhere else is an ordinary comment', () => {
    const { model } = buildText(swap(NOTES, '  require EmailFree(email) is true', '  /// not stored\n  require EmailFree(email) is true'));
    eq(JSON.stringify(model()['command-definitions'].SignUp).includes('not stored'), false, 'not stored');
  });

  check('a deprecated event a command emits is advised, and an event nothing emits is advised unless deprecated', () => {
    const advised = (text) => { const { model } = buildText(text); return sandbox.modelAdvisories(model()).map((a) => `${a.name}: ${a.message}`); };
    eq(advised(swap(NOTES, '@deprecated\nevent', 'event')),
      ['EmailAddressWasRegistered: No command emits it. Mark it @deprecated if it is only stored, or emit it from the command that records it.'], 'never emitted');
    eq(advised(swap(NOTES, '  emit CustomerSignedUp { customerId, email, name }', '  emit CustomerSignedUp { customerId, email, name }\n  emit EmailAddressWasRegistered { customerId, email }')),
      ['SignUp: Emits EmailAddressWasRegistered, which is @deprecated – it is stored, but no longer recorded. Emit what replaced it.'], 'deprecated, emitted');
  });

  check('the language reference covers descriptions, notes and @sensitive', () => {
    const reference = sandbox.sourceLanguageReference();
    for (const word of ['///', '@assumption', '@unresolved', '@external', '@deprecated', '@sensitive']) eq(reference.includes(word), true, word);
  });
}


// ---------------------------------------------------------------
// The 11.0 acceptance run's defects, each held by its minimal repro
// (docs/research/2026-11-08-notation-11-acceptance.md, "Defects").
// ---------------------------------------------------------------
{
  const runAll = (text) => {
    const { model } = buildText(text);
    return Object.values(model()['scenario-definitions']).map((body) => {
      const run = sandbox.runScenario(model(), body);
      return run.status === 'broken' ? run.reason : run.status;
    });
  };

  // D1: a value's JSON type is what the type's schema names – an array
  // an array, a record an object – not what `typeof` calls it.
  const ARRAYS = `model "Arrays"

type Items = array { minItems: 1 }
type Meta = object
tag type ThingId = string
type Count = integer { minimum: 1 }

event ThingAdded { tag id: ThingId, items: Items, meta: Meta, counts?: Count[] }

command AddThing(id: ThingId, items: Items, meta: Meta) {
  emit ThingAdded { id, items, meta, counts: null }

  scenarios {
    scenario "ok" {
      when AddThing { id: "t1", items: [1], meta: { a: 1 } }
      then ThingAdded { id: "t1", items: [1], meta: { a: 1 } }
    }
  }
}
`;

  check('D1: an array value fits an array type, and an object an object type', () => {
    eq(runAll(ARRAYS), ['current'], 'the repro holds');
    eq(runAll(swap(ARRAYS, 'when AddThing { id: "t1", items: [1]', 'when AddThing { id: "t1", items: { a: 1 }')),
      ['The When ("AddThing") gives items {"a":1}, which Items does not admit: no array (scenario values are held to their types since 11.0).'], 'an object is no array');
    eq(runAll(swap(ARRAYS, 'meta: { a: 1 } }\n      then', 'meta: [1] }\n      then')),
      ['The When ("AddThing") gives meta [1], which Meta does not admit: no object (scenario values are held to their types since 11.0).'], 'an array is no object');
  });

  check('D1: one check of a value against its type, shared by scenarios and replay', () => {
    const { model } = buildText(ARRAYS);
    const properties = model()['event-definitions'].ThingAdded.properties;
    const problems = (data) => sandbox.payloadValueProblems(model(), properties, data).map((p) => `${p.name}: ${p.problem}`);
    eq(problems({ id: 't1', items: [1], meta: {}, counts: null }), [], 'null is the absence of an optional value');
    eq(problems({ id: 't1', items: [], meta: {} }), ['items: has fewer than 1 items'], 'an array type\'s own constraints');
    eq(problems({ id: 't1', items: [1], meta: null, counts: [1, 2] }), [], 'null is no value to check');
    eq(problems({ id: 1, items: 'x', meta: 2, counts: 3 }),
      ['id: is no string', 'items: is no array', 'meta: is no object', 'counts: is no list'], 'base types');
    eq(problems({ id: 't1', items: [1], meta: {}, counts: [0, 1.5] }), ['counts: is below 1', 'counts: is no integer'], 'a list\'s elements');
  });

  // D2: an alias may read by another alias's record field, as a read
  // in place does.
  const ADDRESS = `model "Shipping"

// Types
tag type UserId = string
tag type City = string
record Address { city: City, zip: string }

// Events
event Moved { tag userId: UserId, address: Address tag city }
event Shipped { tag userId: UserId }

// Projections
projection AddressOf (tag userId: UserId): Address = null {
  on Moved => set event.data.address
}

projection Residents (tag city: City): integer = 0 {
  on Moved => increment 1
}

// Commands
command Move(userId: UserId, address: Address) {
  emit Moved { userId, address }
}

command Ship(userId: UserId) {
  alias address = AddressOf(userId)
  alias residents = Residents(address.city)

  require residents < 2
    else reject "Crowded"

  emit Shipped { userId }

  scenarios {
    scenario "room" {
      given Moved { userId: "u1", address: { city: "c1", zip: "1" } }
      when Ship { userId: "u1" }
      then Shipped { userId: "u1" }
    }

    scenario "crowded" {
      given Moved { userId: "u1", address: { city: "c1", zip: "1" } }
      and Moved { userId: "u2", address: { city: "c1", zip: "2" } }
      when Ship { userId: "u1" }
      then rejected "Crowded"
    }
  }
}
`;

  check('D2: an alias reads by another alias\'s record field', () => {
    eq(runAll(ADDRESS), ['current', 'current'], 'both hold');
    const { model } = buildText(ADDRESS);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    eq(model()['command-definitions'].Ship.boundary[1].tags, { city: { alias: 'address', field: 'city' } }, 'stored as a field');
    eq(modelToSource(model()), ADDRESS, 'printed as written');
    assertSameModel(model(), parseModelSource(ADDRESS), 'round trip');
  });

  // D3: a where may compare with an alias already bound – a value, not
  // a read made inside the where – and that counts as consulting it.
  const PARTNERS = `model "Partners"

// Types
tag type UserId = string
tag type HolderId = string
type Person = string

// Events
event Partnered { tag userId: UserId, partner: Person }
event Held { tag userId: UserId, tag holderId: HolderId, by: Person }
event Checked { tag userId: UserId }

// Projections
projection Partner (tag userId: UserId): Person = null {
  on Partnered => set event.data.partner
}

projection Holder (tag userId: UserId, tag holderId: HolderId): Person = null {
  on Held => set event.data.by
}

// Commands
command Pair(userId: UserId, partner: Person) {
  emit Partnered { userId, partner }
}

command Hold(userId: UserId, holderId: HolderId, by: Person) {
  emit Held { userId, holderId, by }
}

command Check(userId: UserId) {
  alias partner = Partner(userId)

  require count(Holder(userId, *) where value == partner) > 0
    else reject "None"

  emit Checked { userId }

  scenarios {
    scenario "held by the partner" {
      given Partnered { userId: "u1", partner: "u2" }
      and Held { userId: "u1", holderId: "h1", by: "u2" }
      when Check { userId: "u1" }
      then Checked { userId: "u1" }
    }

    scenario "held by another" {
      given Partnered { userId: "u1", partner: "u2" }
      and Held { userId: "u1", holderId: "h1", by: "u3" }
      when Check { userId: "u1" }
      then rejected "None"
    }
  }
}
`;

  check('D3: a where compares with an alias in scope, which counts as consulting it', () => {
    eq(runAll(PARTNERS), ['current', 'current'], 'both hold');
    const { id, model } = buildText(PARTNERS);
    eq(advisedOtherwise(model()), [], 'advisory-clean: no undeclared parameter, no unused read');
    const where = model()['command-definitions'].Check.steps[0].condition.leftHandSide.where;
    eq(where.rightHandSide, { alias: 'partner' }, 'stored as the alias');
    eq(modelToSource(model()), PARTNERS, 'printed as written');
    assertSameModel(model(), parseModelSource(PARTNERS), 'round trip');
    const renamed = renameAt(PARTNERS, 'alias partner', 'alias '.length, 'mate');
    eq([renamed.text.includes('alias mate = Partner(userId)'), renamed.text.includes('where value == mate')], [true, true], 'a rename follows it into the where');
    applyModelSource(id, swap(PARTNERS, 'else reject "None"', 'else reject "Nobody"'));
    eq(model()['command-definitions'].Check.boundary.map((b) => b.alias), ['partner'], 'the next edit keeps the read');
  });

  check('D3: a where still never reads a projection, nor a group\'s projection through an alias', () => {
    const errors = (text) => parseModelSource(text).diagnostics.map((d) => d.message);
    eq(errors(swap(PARTNERS, 'where value == partner', 'where value == Partner(userId)'))[0],
      'A where reads value, parameters, aliases and literals – never a projection.', 'a read in place');
    const grouped = swap(PARTNERS, 'projection Partner (tag userId: UserId): Person = null {\n  on Partnered => set event.data.partner\n}',
      'group Pairing (tag userId: UserId) {\n  projection partner: Person = null {\n    on Partnered => set event.data.partner\n  }\n}');
    const text = swap(swap(grouped, 'alias partner = Partner(userId)', 'alias pairing = Pairing(userId)'), 'where value == partner', 'where value == pairing.partner');
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], 'it reads');
    eq(advisedOtherwise(buildText(text).model()).map((a) => a.message)
      .filter((m) => /a where reads value, parameters, aliases and literals, never a projection/.test(m)).length, 1, 'a group\'s projection');
  });

  // D5: a partial then compares a nested record's listed fields, and
  // ignores the ones it leaves out.
  const SIGNUPS = `model "Signups"

// Types
tag type CustomerId = string
tag type EmailAddress = string
type Meta = object
record SignUp { emailAddress: EmailAddress, name: string }

// Events
event SignedUp { tag customerId: CustomerId, signUp: SignUp tag emailAddress, meta: Meta }

// Commands
command SignUpCustomer(customerId: CustomerId, signUp: SignUp, meta: Meta) {
  emit SignedUp { customerId, signUp, meta }

  scenarios {
    scenario {
      when SignUpCustomer { customerId: "c1", signUp: { emailAddress: "a@x.test", name: "Ann" }, meta: { a: 1, b: 2 } }
      then SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }
    }
  }
}
`;

  check('D5: a partial then compares a nested record by the fields it lists', () => {
    eq(runAll(SIGNUPS), ['current'], 'the name left out is ignored');
    eq(runAll(swap(SIGNUPS, 'then SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }',
      'then SignedUp { customerId: "c1", signUp: { emailAddress: "b@x.test" } }')), ['drifted'], 'a listed field differs');
    eq(runAll(swap(SIGNUPS, 'then SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }',
      'then SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" }, meta: { a: 1 } }')), ['drifted'], 'an opaque object is compared whole');
    eq(runAll(swap(SIGNUPS, 'then SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }',
      'then SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" }, meta: { b: 2, a: 1 } }')), ['current'], 'whole, in any key order');
  });

  // D6: a projection's initial value is held to its type's constraints,
  // as a scenario's values are.
  check('D6: an initial value outside its type\'s constraints is advised', () => {
    const text = `model "Seats"

tag type CourseId = string
type NumberOfSeats = integer { minimum: 1 }
type Code = string { pattern: "^[A-Z]+$" }

event SeatsSet { tag courseId: CourseId, seats: NumberOfSeats }

projection Seats (tag courseId: CourseId): NumberOfSeats = 1 {
  on SeatsSet => set event.data.seats
}

projection Codes (tag courseId: CourseId): Code[] = ["AB"] {
  on SeatsSet => append "CD"
}

command SetSeats(courseId: CourseId, seats: NumberOfSeats) {
  emit SeatsSet { courseId, seats }
}
`;
    const advised = (t) => advisedOtherwise(buildText(t).model()).map((a) => `${a.name}: ${a.message}`);
    eq(advised(text), [], 'clean');
    eq(advised(swap(text, 'NumberOfSeats = 1 {', 'NumberOfSeats = 0 {')),
      ['Seats: Projection "Seats"\'s initial value is 0, which is below 1.'], 'a minimum');
    eq(advised(swap(text, 'Code[] = ["AB"]', 'Code[] = ["AB", "x"]')),
      ['Codes: Projection "Codes"\'s initial element 2 is "x", which does not match ^[A-Z]+$.'], 'a list\'s element');
  });
}

// ---------------------------------------------------------------
// The language additions the 11.0 acceptance asked for: a handler
// setting from a record's field (G2), `list(P(x, *))` (G1) and
// `count(xs)` as a value (G3).
// ---------------------------------------------------------------
{
  const runAll = (text) => {
    const { model } = buildText(text);
    return Object.values(model()['scenario-definitions']).map((body) => {
      const run = sandbox.runScenario(model(), body);
      return run.status === 'broken' ? run.reason : run.status;
    });
  };
  const advised = (text) => advisedOtherwise(buildText(text).model()).map((a) => `${a.name}: ${a.message}`);

  const NESTED = `model "Emails"

// Types
tag type CustomerId = string
tag type EmailAddress = string
record SignUp { emailAddress: EmailAddress, name: string }

// Events
event SignedUp { tag customerId: CustomerId, signUp: SignUp tag emailAddress }
event EmailChanged { tag customerId: CustomerId, tag email: EmailAddress }

// Projections
projection CustomerEmail (tag customerId: CustomerId): EmailAddress = null {
  on SignedUp => set event.data.signUp.emailAddress
  on EmailChanged => set event.data.email
}

projection EmailsUsed (tag customerId: CustomerId): EmailAddress[] = [] {
  on SignedUp => append event.data.signUp.emailAddress
  on EmailChanged => append event.data.email
}

// Commands
command SignUpCustomer(customerId: CustomerId, signUp: SignUp) {
  emit SignedUp { customerId, signUp }
}

command ChangeEmail(customerId: CustomerId, email: EmailAddress) {
  require CustomerEmail(customerId) != email
    else reject "Same address"
  require EmailsUsed(customerId) not contains email
    else reject "Used before"

  emit EmailChanged { customerId, email }

  scenarios {
    scenario "same" {
      given SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }
      when ChangeEmail { customerId: "c1", email: "a@x.test" }
      then rejected "Same address"
    }

    scenario "used before" {
      given SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }
      and EmailChanged { customerId: "c1", email: "b@x.test" }
      when ChangeEmail { customerId: "c1", email: "a@x.test" }
      then rejected "Used before"
    }

    scenario "new" {
      given SignedUp { customerId: "c1", signUp: { emailAddress: "a@x.test" } }
      when ChangeEmail { customerId: "c1", email: "b@x.test" }
      then EmailChanged { customerId: "c1", email: "b@x.test" }
    }
  }
}
`;

  check('G2: a handler sets and appends from a record\'s field', () => {
    eq(runAll(NESTED), ['current', 'current', 'current'], 'all hold');
    const { model } = buildText(NESTED);
    eq(advisedOtherwise(model()), [], 'advisory-clean');
    eq(model()['projection-definitions'].CustomerEmail.handlers[0].value, { eventProperty: 'signUp', property: 'emailAddress' }, 'stored as a field');
    eq(modelToSource(model()), NESTED, 'printed as written');
    assertSameModel(model(), parseModelSource(NESTED), 'round trip');
    const renamed = renameAt(NESTED, 'emailAddress: EmailAddress, name', 0, 'email');
    eq(renamed.text.includes('set event.data.signUp.email\n'), true, 'a rename of the field follows it');
    const { id, model: again } = buildText(NESTED);
    sandbox.renameMember('custom-type-definition', id, 'SignUp', 'field', 'emailAddress', 'email');
    eq(again()['projection-definitions'].EmailsUsed.handlers[0].value, { eventProperty: 'signUp', property: 'email' }, 'and so does the editor\'s rename');
  });

  check('G2: a record\'s field is held to the projection\'s type, and one hop only', () => {
    eq(advised(swap(NESTED, 'on SignedUp => set event.data.signUp.emailAddress', 'on SignedUp => set event.data.signUp.name')),
      ['CustomerEmail: The handler for "SignedUp" on projection "CustomerEmail" sets it to "event.data.signUp.name", a string – but it holds '
        + 'an EmailAddress. Nothing converts one into the other: tag the event by an EmailAddress, or hold a string.'], 'strict');
    eq(advised(swap(NESTED, 'on SignedUp => set event.data.signUp.emailAddress', 'on SignedUp => set event.data.signUp.nope'))
      .some((m) => /SignUp has no field "nope"/.test(m)), true, 'an unknown field');
    eq(parseModelSource(swap(NESTED, 'on SignedUp => set event.data.signUp.emailAddress', 'on SignedUp => set event.data.signUp.emailAddress.x'))
      .diagnostics.map((d) => d.message)[0], 'A handler reads one field of a record-typed property – event.data.<property>.<field>, one hop.', 'one hop');
  });

  // G1 and G3: `list(P(x, *))` builds a list from an open read – the
  // open tag's values, in instance order – and `count(xs)` is a value.
  const LIBRARY = `model "Library"

// Types
tag type MemberId = string
tag type BookId = string

// Events
event BookLent { tag memberId: MemberId, tag bookId: BookId, late: boolean }
event BookReturned { tag memberId: MemberId, tag bookId: BookId }
event MemberLeft { tag memberId: MemberId, tag bookIds: BookId[], lent: integer }
event BooksCounted { tag memberId: MemberId, lent: integer, free: integer }

// Projections
projection Lent (tag memberId: MemberId, tag bookId: BookId): boolean = false {
  on BookLent => set true
  on BookReturned => set false
}

projection Late (tag memberId: MemberId, tag bookId: BookId): boolean = false {
  on BookLent => set event.data.late
  on BookReturned => set false
}

projection Wishlist (tag memberId: MemberId): BookId[] = [] {
  on BookLent => append event.data.bookId
}

derived projection LentCount (tag memberId: MemberId): integer {
  count(Wishlist(memberId))
}

// Commands
command Lend(memberId: MemberId, bookIds: BookId[]) {
  require count(Lent(memberId, *)) + count(bookIds) <= 3
    else reject "Too many books"
  require count(bookIds) > 0
    else reject "No books"
  require count(bookIds) >= 1 and 3 >= count(bookIds)
    else reject "Out of range"

  for each bookId in bookIds => emit BookLent { memberId, bookId, late: false }

  emit BooksCounted {
    memberId,
    lent: count(list(Lent(memberId, *))) + count(bookIds),
    free: 3 - count(bookIds),
  }
}

command Leave(memberId: MemberId) {
  if list(Lent(memberId, *)) contains "b9" => reject "The rare book is still out"

  for each bookId in list(Lent(memberId, *)) => emit BookReturned { memberId, bookId }

  emit MemberLeft {
    memberId,
    bookIds: list(Lent(memberId, *) where value == true),
    lent: LentCount(memberId),
  }
}

command ReturnLate(memberId: MemberId) {
  emit MemberLeft {
    memberId,
    bookIds: list(Late(memberId, *)),
    lent: count(list(Late(memberId, *))),
  }
}

command Return(memberId: MemberId, bookId: BookId) {
  emit BookReturned { memberId, bookId }
}
`;
  // A command's scenarios, after the last line of its body (`end`).
  const ENDS = { Lend: '    free: 3 - count(bookIds),\n  }\n', Leave: '    lent: LentCount(memberId),\n  }\n' };
  const withScenarios = (text, command, scenarios) => swap(text, `${ENDS[command]}}\n`, `${ENDS[command]}\n  scenarios {\n${scenarios}\n  }\n}\n`);
  const LEND = withScenarios(LIBRARY, 'Lend', `    scenario "two" {
      given BookLent { memberId: "m1", bookId: "b1" }
      when Lend { memberId: "m1", bookIds: ["b2", "b3"] }
      then BookLent { memberId: "m1", bookId: "b2" }
      and BookLent { memberId: "m1", bookId: "b3" }
      and BooksCounted { memberId: "m1", lent: 3, free: 1 }
    }

    scenario "too many" {
      given BookLent { memberId: "m1", bookId: "b1" }
      and BookLent { memberId: "m1", bookId: "b2" }
      when Lend { memberId: "m1", bookIds: ["b3", "b4"] }
      then rejected "Too many books"
    }

    scenario "none" {
      when Lend { memberId: "m1", bookIds: [] }
      then rejected "No books"
    }`);
  const LEAVE = withScenarios(LIBRARY, 'Leave', `    scenario "returns what is out, in order" {
      given BookLent { memberId: "m1", bookId: "b2" }
      and BookLent { memberId: "m1", bookId: "b1" }
      and BookLent { memberId: "m1", bookId: "b3" }
      and BookReturned { memberId: "m1", bookId: "b1" }
      when Leave { memberId: "m1" }
      then BookReturned { memberId: "m1", bookId: "b2" }
      and BookReturned { memberId: "m1", bookId: "b3" }
      and MemberLeft { memberId: "m1", bookIds: ["b2", "b3"], lent: 3 }
    }

    scenario "nothing out" {
      when Leave { memberId: "m1" }
      then MemberLeft { memberId: "m1", bookIds: [], lent: 0 }
    }

    scenario "the rare book" {
      given BookLent { memberId: "m1", bookId: "b9" }
      when Leave { memberId: "m1" }
      then rejected "The rare book is still out"
    }`);

  check('G1: list(…) holds an open read\'s tag values, in instance order, present instances only', () => {
    eq(runAll(LEAVE), ['current', 'current', 'current'], 'all hold');
    const { model } = buildText(LEAVE);
    const emission = model()['command-definitions'].Leave.steps.find((step) => step.name === 'MemberLeft');
    eq(emission.parameters.bookIds, { collect: 'list', read: { projection: 'Lent', tags: { memberId: { parameterName: 'memberId' }, bookId: { open: true } } },
      where: { leftHandSide: { instanceValue: true }, predicate: 'equals', rightHandSide: true } }, 'stored as a collection function');
  });

  check('G3: count(xs) is a value – in arithmetic, on either side, emitted, derived', () => {
    eq(runAll(LEND), ['current', 'current', 'current'], 'all hold');
    const { model } = buildText(LEND);
    const rules = model()['command-definitions'].Lend.steps.filter((step) => step.condition);
    eq(rules[0].condition.leftHandSide, { operator: 'add', leftHandSide: { collect: 'count', read: { projection: 'Lent', tags: { memberId: { parameterName: 'memberId' }, bookId: { open: true } } } },
      rightHandSide: { count: { parameterName: 'bookIds' } } }, 'an operand in arithmetic');
    eq(rules[1].condition, { leftHandSide: { parameterName: 'bookIds' }, predicate: 'countGreaterThan', rightHandSide: 0 }, 'the rule form stays as it was stored');
    eq(rules[2].condition.all[1], { leftHandSide: 3, predicate: 'greaterThanOrEquals', rightHandSide: { count: { parameterName: 'bookIds' } } }, 'on the right');
    eq(model()['projection-definitions'].LentCount.derived, { leftHandSide: { count: { projection: 'Wishlist', tags: { memberId: { parameterName: 'memberId' } } } } }, 'derived');
  });

  check('G1, G3: advisory-clean, printed as written, and read back equal', () => {
    for (const text of [LIBRARY, LEND, LEAVE]) {
      const { model } = buildText(text);
      eq(advisedOtherwise(model()), [], 'advisory-clean');
      eq(modelToSource(model()), text, 'printed as written');
      assertSameModel(model(), parseModelSource(text), 'round trip');
    }
  });

  check('G1: list(…) takes exactly one open tag, and is a list of its type', () => {
    const errors = (text) => advisedOtherwise(buildText(text).model()).map((a) => a.message);
    const twoOpen = `projection Pair (tag memberId: MemberId, tag bookId: BookId, tag otherId: BookId): boolean = false {
  on BookLent {
    if event.data.bookId == bookId => set true
  }
}
`;
    eq(errors(swap(swap(LIBRARY, 'derived projection LentCount', twoOpen + '\nderived projection LentCount'),
      'bookIds: list(Late(memberId, *))', 'bookIds: list(Pair(memberId, *, *))'))
      .filter((m) => /list\(…\) collects the one tag a read leaves open – Pair\(memberId, \*, \*\) leaves 2/.test(m)).length, 1, 'two open tags');
    eq(errors(swap(LIBRARY, 'lent: count(list(Late(memberId, *))),', 'lent: list(Late(memberId, *)),'))
      .some((m) => /takes its value from "list\(Late\(memberId, \*\)\)", which is BookId\[\]/.test(m)), true, 'a list where one value goes');
    eq(errors(swap(LIBRARY, 'require count(bookIds) > 0', 'require sum(Lent(memberId, *)) > count(memberId)'))
      .some((m) => /count\(memberId\) counts a list – memberId is a MemberId/.test(m)), true, 'count of no list');
  });

  check('G1, G3: older documents import unchanged', () => {
    const { model } = buildText(LEND);
    const envelope = JSON.parse(JSON.stringify(sandbox.buildShareEnvelope(model(), [])));
    fresh();
    const { modelId } = importModelFromEnvelope(envelope);
    eq(modelToSource(projectState()[modelId]), LEND, 'the same model back');
  });

  check('G1, G3: the language reference and completion know list and count', () => {
    const reference = sandbox.sourceLanguageReference();
    eq(/list\(P\(x, \*\)\)/.test(reference), true, 'list in the reference');
    eq(/count\(xs\) is a value/.test(reference), true, 'count as a value in the reference');
    const { labels } = completeAt(swap(LIBRARY, '    bookIds: list(Late(memberId, *)),', '    bookIds: |'));
    eq(labels.includes('list'), true, labels.join(' '));
  });

  check('G1, G2, G3: every name resolves to a symbol, and a rename follows it inside list and count', () => {
    const notNames = new Set([...sandbox.SOURCE_KEYWORDS, ...sandbox.SOURCE_BASE_TYPES, 'number', 'pattern', 'minimum', 'data', 'value', 'duration', ...Object.keys(sandbox.SOURCE_ANNOTATIONS)]);
    for (const [label, text] of [['lend', LEND], ['leave', LEAVE], ['nested', NESTED], ['tour', sandbox.SOURCE_REFERENCE_TOUR]]) {
      const { occurrences, ambiguous } = sandbox.sourceSymbols(parseModelSource(text));
      const key = (t) => `${t.line}:${t.col}`;
      const resolved = new Set([...occurrences, ...ambiguous].map((o) => key(o.token)));
      const missed = sandbox.lexSource(text).tokens
        .filter((t) => t.t === 'ident' && !notNames.has(t.v) && !resolved.has(key(t)))
        .map((t) => `${t.v} at ${key(t)}`);
      eq(missed, [], `${label}: names nothing resolves`);
    }
    const renamed = renameAt(LEND, 'bookIds: BookId[]) {', 0, 'books').text;
    eq([renamed.includes('count(Lent(memberId, *)) + count(books) <= 3'), renamed.includes('free: 3 - count(books)')], [true, true], 'into count');
    const lent = renameAt(LEAVE, 'projection Lent ', 'projection '.length, 'OnLoan').text;
    eq(lent.includes('list(OnLoan(memberId, *) where value == true)'), true, 'into list');
    const { id, model } = buildText(LEND);
    sandbox.renameDefinition('projection-definition', id, 'Lent', 'OnLoan');
    sandbox.renameDefinition('projection-definition', id, 'Wishlist', 'Wished');
    sandbox.renameMember('command-definition', id, 'Lend', 'property', 'bookIds', 'books');
    const printed = modelToSource(model());
    eq([printed.includes('lent: count(list(OnLoan(memberId, *))) + count(books)'), printed.includes('count(Wished(memberId))'),
      printed.includes('Written as JSON')], [true, true, false], 'the editors\' renames too');
  });
}

finish();
