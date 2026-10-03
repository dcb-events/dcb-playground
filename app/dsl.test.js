// ============================================================
// DCB Playground — code view language tests.
//
// `dsl.js` claims two things, and this holds it to both: that the text
// it prints says everything the model does (print, parse, compare —
// for every shipped model and every example file, with no definition
// falling back to JSON), and that applying a text writes exactly the
// difference, as one append. The rest pins down the grammar's
// spellings, its diagnostics, and the JSON fallback that keeps
// printing lossless for bodies the grammar cannot say.
//
// Run with `node app/dsl.test.js`.
// ============================================================
const fs = require('fs');
const path = require('path');
const { createSandbox, loadApp, makeChecker } = require('./test-harness.js');

const APP = __dirname;
const { sandbox, store } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js', 'dsl.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS; globalThis.SOURCE_KINDS = SOURCE_KINDS;'
    + ' globalThis.DEF_COLLECTIONS = DEF_COLLECTIONS; globalThis.DomainError = DomainError;',
});
const { check, eq, finish } = makeChecker();
const {
  loadPredefinedModel, projectState, modelToSource, parseModelSource, applyModelSource,
  importModelFromEnvelope, sameDefinition, loadEvents, onAppend, addDefinition, updateDefinition,
  sourceAdvisories, sourceSpanAt, PREDEFINED_MODELS, SOURCE_KINDS, DEF_COLLECTIONS,
} = sandbox;

function fresh() {
  store.clear();
  sandbox.bumpLogRevision();
}

function build(index) {
  fresh();
  const id = loadPredefinedModel(index);
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
    eq(parsed.implicit, [], `${entry.slug} implicit types`);
    assertSameModel(model(), parsed, entry.slug);
  });
});

check('every example file round-trips, the hand-edited one included', () => {
  const dir = path.join(APP, 'examples');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    fresh();
    const { modelId, skipped } = importModelFromEnvelope(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    eq(skipped, [], `${file} imported whole`);
    const model = projectState()[modelId];
    const text = modelToSource(model);
    eq(text.includes(' json {'), false, `${file} falls back to JSON`);
    const parsed = parseModelSource(text);
    eq(parsed.diagnostics, [], `${file} diagnostics`);
    assertSameModel(model, parsed, file);
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
  const { model } = build(0);
  const text = modelToSource(model());
  const expected = [
    '@feature("Enrolment")',
    'command SubscribeStudentToCourse(courseId: CourseId, studentId: StudentId) {',
    '  read course = Course[courseId]',
    '  read student = Student[studentId]',
    '',
    '  require course.status == Existent',
    '  require student.exists is true',
    '  require course.subscriptionCount < course.capacity',
    '  require course.subscribedStudentIds not contains studentId',
    '  require student.subscriptionCount < 10',
    '',
    '  emit StudentSubscribedToCourse { courseId, studentId }',
    '}',
  ].join('\n');
  eq(text.includes(expected), true, 'SubscribeStudentToCourse as printed:\n' + text);
});

check('fan-out, exclusion, numbering, membership, guards and derived values have spellings', () => {
  const schedules = modelToSource(build(3).model());
  eq(schedules.includes('read theirs = Course[students.subscribedCourseIds] excluding courseId'), true, 'excluding');
  eq(schedules.includes('read courseNumbering = CourseNumbering()'), true, 'projection read');
  eq(schedules.includes('emit CourseDefined { courseId: courseNumbering, capacity, slots }'), true, 'minted id');
  eq(schedules.includes('on CourseDefined => set successor(event.data.courseId)'), true, 'successor');
  eq(schedules.includes('require theirs.slots not containsAny slots'), true, 'containsAny');
  const tenant = modelToSource(build(2).model());
  eq(tenant.includes('read tenantCourseNumbering = TenantCourseNumbering(tenantId)'), true, 'argument shorthand');
  const guarded = modelToSource(build(8).model());
  eq(guarded.includes('require document.status in [Draft, Published, PendingChanges]'), true, 'equalsAny');
  eq(guarded.includes('emit TextChanged { docId, text }\n    when text != document.publishedText'), true, 'when');
  const derived = modelToSource(build(9).model());
  eq(derived.includes('derived DocumentCurrentText(documentId) != DocumentPublishedText(documentId)'), true, 'derived');
  const scripted = modelToSource(build(5).model());
  eq(scripted.includes('  script(documentId: DocumentId)\n  tagFilter ["DocumentId:{documentId}"]'), true, 'script');
  eq(scripted.includes('on DocumentAdded => ```{"currentText":"","publishedText":"","status":"Draft"}```'), true, 'code');
  const pricing = modelToSource(build(4).model());
  eq(pricing.includes('record Item { productId: ProductId, price: Money }'), true, 'record');
  eq(pricing.includes('require product.currentPrice == items.price'), true, 'parameter field');
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
    const source = `command C(a: integer, b: integer) {\n  require ${text}\n}`;
    const parsed = parseModelSource(source);
    eq(parsed.diagnostics, [], text);
    const rule = parsed.collections['command-definition'].C.conditions[0];
    const want = { leftHandSide: { parameterName: 'a' }, ...expected };
    if (want.rightHandSide === undefined && !['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'].includes(want.predicate)) {
      want.rightHandSide = { parameterName: 'b' };
    }
    eq(sameDefinition(rule, want), true, `${text} read as ${JSON.stringify(rule)}`);
    const printed = modelToSource({ name: 'm', ...emptyCollections({ 'command-definition': { C: parsed.collections['command-definition'].C } }) });
    eq(printed.includes(`require ${text}`), true, `${text} printed as\n${printed}`);
  }
});

function emptyCollections(overrides) {
  const out = {};
  for (const kind of SOURCE_KINDS) out[DEF_COLLECTIONS[kind]] = overrides[kind] || {};
  return out;
}

check('a name resolves to a read when one declares it, and to the payload otherwise', () => {
  const parsed = parseModelSource([
    'command C(courseId: CourseId, items: Item[]) {',
    '  read course = Course[courseId]',
    '  read numbering = CourseNumbering()',
    '  require course.status == items.price',
    '  require numbering == gone',
    '  require ghost.status is true',
    '}',
  ].join('\n'));
  const body = parsed.collections['command-definition'].C;
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
  const { id, model } = build(0);
  const body = JSON.parse(JSON.stringify(model()['command-definitions'].ArchiveCourse));
  body.conditions.push({ leftHandSide: { parameterName: 'courseId' }, predicate: 'resemblesStrongly', rightHandSide: 1 });
  updateDefinition('command-definition', id, 'ArchiveCourse', body);
  const shadowed = JSON.parse(JSON.stringify(model()['command-definitions'].DefineCourse));
  shadowed.boundary[0].alias = 'courseId';
  shadowed.conditions[0].leftHandSide.alias = 'courseId';
  updateDefinition('command-definition', id, 'DefineCourse', shadowed);
  const text = modelToSource(model());
  eq(text.includes('// Written as JSON: a rule\'s predicate "resemblesStrongly" is not one the code form knows.\n'
    + 'command ArchiveCourse json {'), true, 'unknown predicate');
  eq(text.includes('// Written as JSON: "courseId" names both a payload property and a read.\n'
    + 'command DefineCourse json {'), true, 'a parameter and a read sharing a name');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics, [], 'diagnostics');
  assertSameModel(model(), parsed, 'fallbacks');
  const before = loadEvents().length;
  applyModelSource(id, text);
  eq(loadEvents().length, before, 'an untouched fallback applies as no change');
});

// ---------------------------------------------------------------
// Applying a text.
// ---------------------------------------------------------------

check('an edit is written as exactly the definitions it changed, in one append', () => {
  const { id, model } = build(0);
  const text = modelToSource(model())
    .replace('require student.subscriptionCount < 10', 'require student.subscriptionCount < 12');
  const before = appends;
  const log = loadEvents().length;
  const summary = applyModelSource(id, text);
  eq(appends - before, 1, 'one append');
  eq(loadEvents().length - log, 1, 'one event');
  eq(summary.updated, [{ kind: 'command-definition', name: 'SubscribeStudentToCourse' }], 'updated');
  eq(model()['command-definitions'].SubscribeStudentToCourse.conditions[4].rightHandSide, 12, 'the new limit');
});

check('adding, removing, reordering and renaming the model are one append together', () => {
  const { id, model } = build(0);
  const scenarios = JSON.stringify(model()['scenario-definitions']);
  let text = modelToSource(model())
    .replace('model "Course Example (simple)"', 'model "Renamed"')
    .replace(/@feature\("Course management"\)\ncommand ArchiveCourse[\s\S]*?\n}\n/, '')
    + '\nentity Room {}\n';
  // Two events trade places.
  text = text.replace('event CourseArchived { courseId: CourseId }\n', '')
    .replace('event CourseDefined', 'event CourseArchived { courseId: CourseId }\nevent CourseDefined');
  const before = appends;
  const summary = applyModelSource(id, text);
  eq(appends - before, 1, 'one append');
  eq(model().name, 'Renamed', 'model name');
  eq('ArchiveCourse' in model()['command-definitions'], false, 'removed');
  eq(model()['entity-definitions'].Room, { properties: [] }, 'added');
  eq(model()['custom-type-definitions'].RoomId, { schema: { type: 'string' }, isTag: true }, 'its identifier, implied');
  eq(Object.keys(model()['event-definitions'])[0], 'CourseArchived', 'reordered');
  eq(summary.reordered.map((r) => r.kind), ['event-definition'], 'reorder reported');
  eq(JSON.stringify(model()['scenario-definitions']), scenarios, 'scenarios untouched');
});

check('an identifier type left out of the text keeps what the model says about it', () => {
  const { id, model } = build(3);
  const text = modelToSource(model()).replace('tag type CourseId = string { pattern: "^c[0-9]+$" }\n', '');
  const parsed = parseModelSource(text);
  eq(parsed.implicit, ['CourseId'], 'implied');
  const order = Object.keys(model()['custom-type-definitions']);
  const before = loadEvents().length;
  applyModelSource(id, text);
  eq(loadEvents().length, before, 'nothing to write');
  eq(Object.keys(model()['custom-type-definitions']), order, 'kept its place');
});

check('a text with an error applies nothing and says where', () => {
  const { id, model } = build(0);
  const text = modelToSource(model()).replace('require course.status == Existent', 'require course.status === Existent');
  const parsed = parseModelSource(text);
  eq(parsed.diagnostics.length, 1, 'one error');
  const line = text.split('\n').findIndex((l) => l.includes('===')) + 1;
  eq(parsed.diagnostics[0].line, line, 'on its line');
  const before = loadEvents().length;
  let refused = null;
  try { applyModelSource(id, text); } catch (error) { refused = error; }
  eq(refused instanceof sandbox.DomainError, true, 'refused as a domain error');
  eq(refused.message.startsWith(`1 error in the code — nothing was applied. Line ${line}:`), true, refused.message);
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
  eq(parseModelSource('@feature("x")\nevent A {}').diagnostics[0].message, 'A event carries no @feature.', 'misplaced');
  eq(parseModelSource('@colour("x")\nevent A {}').diagnostics[0].message.startsWith('There is no @colour'), true, 'unknown');
});

// ---------------------------------------------------------------
// What review found — each pinned so it stays found.
// ---------------------------------------------------------------

check('a body the write path stores but no printer expects shows as JSON, never as a crash', () => {
  const { id, model } = build(0);
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

check('a dangling identifier type stays dangling through an untouched apply', () => {
  const { id, model } = build(0);
  const course = JSON.parse(JSON.stringify(model()['entity-definitions'].Course));
  updateDefinition('entity-definition', id, 'Course', { ...course, identifierType: 'GhostId' });
  const before = loadEvents().length;
  const summary = applyModelSource(id, modelToSource(model()));
  eq(loadEvents().length, before, sandbox.sourceApplySummary(summary));
  eq('GhostId' in model()['custom-type-definitions'], false, 'not invented');
});

check('names no collection can be keyed by are refused, and padded ones trimmed', () => {
  for (const name of ['constructor', '__proto__']) {
    const { id, model } = build(0);
    const before = loadEvents().length;
    let refused = null;
    try { applyModelSource(id, modelToSource(model()) + `\nevent ${name} { a: string }\n`); } catch (error) { refused = error; }
    eq(refused instanceof sandbox.DomainError, true, name);
    eq(loadEvents().length, before, `${name}: nothing appended`);
  }
  const { id, model } = build(0);
  applyModelSource(id, modelToSource(model()) + '\nevent " Padded " {}\n');
  eq(Object.keys(model()['event-definitions']).includes('Padded'), true, 'trimmed');
});

check('the model name is compared trimmed, and a rename is reported', () => {
  const { id, model } = build(0);
  const before = loadEvents().length;
  applyModelSource(id, modelToSource(model()).replace('model "Course Example (simple)"', 'model " Course Example (simple) "'));
  eq(loadEvents().length, before, 'padding is no rename');
  const summary = applyModelSource(id, modelToSource(model()).replace('model "Course Example (simple)"', 'model "Courses"'));
  eq(sandbox.sourceApplySummary(summary), 'renamed the model to "Courses"', 'reported');
});

check('the draft is advised on before it is applied', () => {
  const { model } = build(0);
  const text = modelToSource(model()).replace('emit CourseArchived { courseId }', 'emit CourseBurnt { courseId }');
  const parsed = parseModelSource(text);
  const found = sourceAdvisories(model(), parsed);
  eq(found.length, 1, JSON.stringify(found));
  eq(found[0].name, 'ArchiveCourse', 'on the command');
  const span = sourceSpanAt(parsed, text.split('\n').findIndex((l) => l.includes('CourseBurnt')) + 1);
  eq([span.kind, span.name], ['command-definition', 'ArchiveCourse'], 'the line belongs to it');
});

finish();
