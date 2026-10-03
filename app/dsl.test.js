// ============================================================
// DCB Playground — code view language tests.
//
// `dsl.js` claims two things, and this holds it to both: that the text
// it prints says everything the model does (print, parse, compare —
// for every shipped model and every example file, with no definition
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
const { createSandbox, loadApp, makeChecker } = require('./test-harness.js');

const APP = __dirname;
const { sandbox, store } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js', 'dsl.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS; globalThis.SOURCE_KINDS = SOURCE_KINDS;'
    + ' globalThis.DEF_COLLECTIONS = DEF_COLLECTIONS; globalThis.DomainError = DomainError;'
    + ' globalThis.SOURCE_KEYWORDS = SOURCE_KEYWORDS; globalThis.SOURCE_BASE_TYPES = SOURCE_BASE_TYPES;',
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

function importExample(slug) {
  fresh();
  const { modelId, skipped } = importModelFromEnvelope(
    JSON.parse(fs.readFileSync(path.join(APP, 'examples', slug + '.json'), 'utf8'))
  );
  eq(skipped, [], `${slug} imported whole`);
  return { id: modelId, model: () => projectState()[modelId] };
}

check('every example file round-trips, scenarios and the hand-edited one included', () => {
  for (const file of fs.readdirSync(path.join(APP, 'examples')).filter((f) => f.endsWith('.json'))) {
    const { id, model } = importExample(file.replace(/\.json$/, ''));
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
        eq(read.some((r) => sandbox.sameScenario(r.body, body)), true, `${file}: ${JSON.stringify(body).slice(0, 120)}`);
      }
    }
    const report = sandbox.sourceScenarioReport(model(), parsed);
    eq([report.errors.length, report.warnings.length], [0, 0], `${file}: scenarios as stored`);
    const before = loadEvents().length;
    applyModelSource(id, text);
    eq(loadEvents().length, before, `${file}: an untouched text, scenarios and all, applies as nothing`);
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

// ---------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------

check('a scenario reads as given, when and then, nested in its command', () => {
  const { model } = importExample('course-simple');
  const text = modelToSource(model());
  eq(text.includes([
    '  scenario {  // is refused by course.status == Existent',
    '    when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }',
    '    then rejected by course.status == Existent saw NonExistent, Existent',
    '  }',
  ].join('\n')), true, 'a refusal, enum members bare');
  eq(text.includes([
    '  scenario {  // records StudentSubscribedToCourse',
    '    given CourseDefined { courseId: "c1", capacity: 123 }',
    '    when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }',
    '    then StudentSubscribedToCourse { courseId: "c1", studentId: "s1" }',
    '  }',
  ].join('\n')), true, 'a publish');
  const sequence = modelToSource(importExample('course-sequence').model());
  eq(sequence.includes('scenario "issues c1 before anything has happened" {\n    then CourseNumbering == "c1"\n  }'), true,
    'a projection without parameters, without parentheses');
  const guarded = modelToSource(importExample('content-decisions-guarded').model());
  eq(guarded.includes('then DocumentStatus("d1") == NonExistent'), true, 'positional arguments');
});

check('a scenario written without a then is recorded with what the model does', () => {
  const { id, model } = importExample('course-simple');
  const text = modelToSource(model()).replace('  emit CourseArchived { courseId }\n', [
    '  emit CourseArchived { courseId }',
    '',
    '  scenario "archiving a defined course" {',
    '    given CourseDefined { courseId: "c9", capacity: 3 }',
    '    when ArchiveCourse { courseId: "c9" }',
    '  }',
    '',
    '  scenario "archiving nothing" {',
    '    when ArchiveCourse { courseId: "c8" }',
    '    then rejected by course.status == Existent',
    '  }',
    '',
  ].join('\n'));
  const before = appends;
  const summary = applyModelSource(id, text);
  eq(appends - before, 1, 'one append');
  // Written ahead of the command's other scenarios, so they move up.
  eq(sandbox.sourceApplySummary(summary), 'added 2 scenarios, reordered', 'reported');
  const stored = Object.values(model()['scenario-definitions']);
  const recorded = stored.find((b) => b.name === 'archiving a defined course');
  eq(recorded.then, { outcome: 'published', events: [{ type: 'CourseArchived', data: { courseId: 'c9' } }] }, 'recorded');
  const refused = stored.find((b) => b.name === 'archiving nothing');
  eq(refused.then.failedRule, {
    index: 0, text: 'course.status == Existent', leftValue: 'NonExistent', rightValue: 'Existent', atInstance: null,
  }, 'the values it saw, filled in');
  const back = modelToSource(model());
  eq(back.includes('  scenario "archiving nothing" {\n    when ArchiveCourse { courseId: "c8" }\n'
    + '    then rejected by course.status == Existent saw NonExistent, Existent\n  }'), true, 'and printed back whole');
});

check('a written then is asserted: a drift is reported with its fix, and applying does not accept it', () => {
  const { id, model } = importExample('course-simple');
  const text = modelToSource(model()).replace(
    'when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }\n    then rejected by course.status == Existent saw NonExistent, Existent',
    'when SubscribeStudentToCourse { courseId: "c1", studentId: "s1" }\n    then rejected by course.status == Existent saw Archived, Existent',
  );
  const parsed = parseModelSource(text);
  const { warnings } = sandbox.sourceScenarioReport(model(), parsed);
  eq(warnings.length, 1, 'one drift');
  const archived = () => Object.values(model()['scenario-definitions'])
    .filter((b) => b.then.failedRule && b.then.failedRule.leftValue === 'Archived').length;
  const already = archived();
  eq(warnings[0].message, 'Drifted — the model now does:\nthen rejected by course.status == Existent saw NonExistent, Existent', 'what it does');
  applyModelSource(id, text);
  eq(archived(), already + 1, 'stored as written — drifted, as on the pages');
  const { fix } = warnings[0];
  const lines = text.split('\n');
  const offset = (line, col) => lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + col - 1;
  const fixed = text.slice(0, offset(fix.line, fix.col)) + fix.text + text.slice(offset(fix.endLine, fix.endCol));
  eq(sandbox.sourceScenarioReport(model(), parseModelSource(fixed)).warnings, [], 'the fix accepts it');
});

check('an edited scenario keeps its id and place; a renamed command takes its scenarios along', () => {
  const { id, model } = importExample('course-simple');
  const ids = Object.keys(model()['scenario-definitions']);
  const text = modelToSource(model()).replace('given CourseDefined { courseId: "c11", capacity: 123 }',
    'given CourseDefined { courseId: "c11", capacity: 124 }');
  let summary = applyModelSource(id, text);
  eq(sandbox.sourceApplySummary(summary), 'updated 1 scenario', 'one scenario');
  eq(Object.keys(model()['scenario-definitions']), ids, 'same ids, same order');
  summary = applyModelSource(id, modelToSource(model()).split('SubscribeStudentToCourse').join('EnrolStudent'));
  eq(Object.keys(model()['scenario-definitions']), ids, 'the rename kept every id');
  eq(Object.values(model()['scenario-definitions']).filter((b) => b.command === 'EnrolStudent').length, 5, 'and moved them');
});

check('a scenario left out of the text is removed', () => {
  const { id, model } = importExample('course-sequence');
  const text = modelToSource(model()).replace(/\n  scenario "issues c3[\s\S]*?\n  }\n/, '\n');
  applyModelSource(id, text);
  eq(Object.values(model()['projection-scenario-definitions']).map((b) => b.name), ['issues c1 before anything has happened'], 'one left');
});

check('scenarios refuse what they cannot mean', () => {
  const errors = (text) => parseModelSource(text).diagnostics.map((d) => d.message);
  eq(errors('command A() {\n  scenario {\n    when B {}\n  }\n}')[0],
    'This scenario sits in A but is about B — move it there, or make it about A.', 'in the wrong block');
  eq(errors('scenario {\n  then Ghost("x") == 1\n}')[0],
    'Ghost is not defined here, so its arguments have to be named — Ghost(argument: …).', 'positional with no order to take');
  eq(errors('scenario {\n  when A {}\n  then nothing\n  then E {}\n}')[0], '"then nothing" is the whole outcome — it stands alone.', 'nothing and more');
  eq(errors('scenario {\n  then E {}\n}')[0], 'A scenario ending in events, nothing or a rejection needs a when — the command it runs.', 'no when');
  eq(errors('scenario {\n  then Ghost(x: "1") == 1\n}'), [], 'an orphan, named');
  const { id, model } = importExample('course-simple');
  const text = modelToSource(model()).replace('  emit CourseArchived { courseId }\n',
    '  emit CourseArchived { courseId }\n\n  scenario {\n    given CourseBurnt { courseId: "c1" }\n    when ArchiveCourse { courseId: "c1" }\n  }\n');
  const report = sandbox.sourceScenarioReport(model(), parseModelSource(text));
  eq(report.errors.length, 1, 'a scenario with nothing to record');
  eq(report.errors[0].message.startsWith('This scenario cannot run, so there is no outcome to record'), true, report.errors[0].message);
  const before = loadEvents().length;
  let refused = null;
  try { applyModelSource(id, text); } catch (error) { refused = error; }
  eq(refused instanceof sandbox.DomainError, true, 'refused');
  eq(loadEvents().length, before, 'nothing appended');
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

// ---------------------------------------------------------------
// The language service.
// ---------------------------------------------------------------

// Every shipped text, printed: the predefined models and the examples.
function shippedTexts() {
  const texts = PREDEFINED_MODELS.map((entry, index) => [entry.slug, modelToSource(build(index).model())]);
  for (const file of fs.readdirSync(path.join(APP, 'examples')).filter((f) => f.endsWith('.json'))) {
    texts.push([file, modelToSource(importExample(file.replace(/\.json$/, '')).model())]);
  }
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
function completeAt(source) {
  const at = source.indexOf('|');
  const text = source.slice(0, at) + source.slice(at + 1);
  const before = text.slice(0, at);
  const result = sandbox.sourceCompletions(text, before.split('\n').length, at - before.lastIndexOf('\n'));
  return { labels: result.items.map((i) => i.label), items: result.items, slot: result.slot };
}

check('every name in every shipped text resolves to a symbol', () => {
  // JSON Schema keywords and a script's own state are not model names.
  const notNames = new Set([...sandbox.SOURCE_KEYWORDS, ...sandbox.SOURCE_BASE_TYPES, 'number', 'icon', 'feature', 'tagSchema',
    'data', 'pattern', 'minimum']);
  for (const [slug, text] of shippedTexts()) {
    const parsed = parseModelSource(text);
    const { occurrences, ambiguous } = sandbox.sourceSymbols(parsed);
    const key = (t) => `${t.line}:${t.col}`;
    const resolved = new Set([...occurrences, ...ambiguous].map((o) => key(o.token)));
    const scriptState = new Set(text.split('\n').map((l, i) => (/^\s*(initialState|exposes)\b/.test(l) ? i + 1 : 0)));
    const missed = sandbox.lexSource(text).tokens
      .filter((t) => t.t === 'ident' && !notNames.has(t.v) && !resolved.has(key(t)) && !scriptState.has(t.line))
      .map((t) => `${t.v} at ${key(t)}`);
    eq(missed, [], `${slug}: names nothing resolves`);
    eq(ambiguous.length, 0, `${slug}: members whose enum cannot be told`);
  }
});

check('renaming any declared name and back changes nothing, or is refused over a script', () => {
  for (const [slug, text] of shippedTexts()) {
    const parsed = parseModelSource(text);
    for (const declaration of sandbox.sourceSymbols(parsed).occurrences.filter((o) => o.decl)) {
      const { token, symbol } = declaration;
      const fresh = (/^[A-Z]/.test(token.v) ? 'Zz' : 'zz') + token.v;
      const there = sandbox.sourceRename(text, token.line, token.col, fresh);
      if (there.error) {
        eq(/script or JSON/.test(there.error), true, `${slug} ${symbol}: ${there.error}`);
        continue;
      }
      const renamed = sandbox.sourceApplyEdits(text, there.edits);
      const read = parseModelSource(renamed);
      eq(read.diagnostics, [], `${slug} ${symbol} renamed`);
      const back = sandbox.sourceSymbols(read).occurrences.find((o) => o.decl && o.symbol.endsWith(' ' + fresh)
        && o.symbol.split(' ')[0] === symbol.split(' ')[0]);
      const again = sandbox.sourceRename(renamed, back.token.line, back.token.col, token.v);
      eq(again.error, undefined, `${slug} ${symbol} renamed back`);
      const restored = parseModelSource(sandbox.sourceApplyEdits(renamed, again.edits));
      // A type renamed away from its entity pins it, and an identifier
      // pinned to `<Entity>Id` is the one it tracked: the same model.
      for (const [name, body] of Object.entries(restored.collections['entity-definition'])) {
        if (body.identifierType === name + 'Id' && !parsed.collections['entity-definition'][name].identifierType) {
          delete body.identifierType;
        }
      }
      const model = { name: parsed.name };
      for (const kind of SOURCE_KINDS) model[DEF_COLLECTIONS[kind]] = parsed.collections[kind];
      assertSameModel(model, restored, `${slug} ${symbol} there and back`);
    }
  }
});

check('a rename is exact: a member, not its look-alikes', () => {
  const text = modelToSource(build(0).model());
  const { text: out } = renameAt(text, 'NonExistent, Existent', 'NonExistent, '.length, 'Active');
  eq((out.match(/\bActive\b/g) || []).length, 6, 'the declaration, a handler and four rules');
  eq((out.match(/\bNonExistent\b/g) || []).length, (text.match(/\bNonExistent\b/g) || []).length, 'NonExistent untouched');
  eq(out.includes('enum CourseStatus { NonExistent, Active, Archived }'), true, 'declared');
});

check('a projection and an enum sharing a name are two names', () => {
  const text = modelToSource(build(0).model());
  const { text: out } = renameAt(text, 'status = CourseStatus', 'status = '.length, 'CourseState');
  eq(out.includes('projection CourseState(courseId: CourseId): CourseStatus = NonExistent {'), true, 'the projection, not its type');
  eq(out.includes('enum CourseStatus {'), true, 'the enum kept');
  const parsed = parseModelSource(text);
  const [line, col] = positionOf(text, 'status = CourseStatus', 'status = '.length);
  const at = sandbox.sourceSymbolAt(parsed, line, col);
  eq(at.symbol, 'projection CourseStatus', 'resolved');
  eq(sandbox.sourceDeclarationOf(parsed, at.symbol).token.line,
    text.split('\n').findIndex((l) => l.startsWith('projection CourseStatus(')) + 1, 'goes to the projection');
});

check('a shorthand splits when either of its names is renamed', () => {
  const text = modelToSource(build(0).model());
  const param = renameAt(text, 'emit CourseDefined { courseId', 'emit CourseDefined { '.length, 'id').text;
  eq(param.includes('command DefineCourse(id: CourseId, capacity: integer) {'), true, 'the parameter');
  eq(param.includes('emit CourseDefined { courseId: id, capacity }'), true, 'the shorthand, as the value');
  const property = renameAt(text, 'event CourseDefined { courseId', 'event CourseDefined { '.length, 'id').text;
  eq(property.includes('emit CourseDefined { id: courseId, capacity }'), true, 'the shorthand, as the key');
  eq(property.includes('command DefineCourse(courseId: CourseId, capacity: integer) {'), true, 'the parameter kept');
});

check('an entity takes its tracking identifier type along, and a type renamed under one is pinned', () => {
  const text = modelToSource(build(0).model());
  const entity = renameAt(text, 'entity Course {', 'entity '.length, 'Class').text;
  eq(entity.includes('tag type ClassId = string'), true, 'the type moved');
  eq(entity.includes('read course = Class[courseId]'), true, 'the reads moved');
  eq(/\bCourseId\b/.test(entity), false, 'nothing left on the old type');
  const type = renameAt(text, 'tag type CourseId', 'tag type '.length, 'CourseKey').text;
  eq(type.includes('entity Course[CourseKey] {'), true, 'pinned');
  const parsed = parseModelSource(type);
  eq(parsed.collections['entity-definition'].Course.identifierType, 'CourseKey', 'and so still its identifier');
  eq(parsed.implicit, [], 'no type synthesized');
});

check('a rename refuses what it cannot do exactly', () => {
  const text = modelToSource(build(0).model());
  eq(renameAt(text, 'read course = Course', 'read '.length, 'courseId').error,
    'There already is a command property named courseId in DefineCourse.', 'a read and a parameter share a namespace');
  eq(renameAt(text, 'NonExistent, Existent', 'NonExistent, '.length, 'Archived').error,
    'There already is an enum member named Archived in CourseStatus.', 'a member collision');
  eq(renameAt(text, 'NonExistent, Existent', 'NonExistent, '.length, 'active').error,
    '"active" cannot name an enum member: an enum member starts with a capital letter.', 'a member is capitalised');
  eq(renameAt(text, 'read course = Course', 'read '.length, 'Course').error,
    '"Course" cannot name a read: a read starts with a lowercase letter.', 'a name is not');
  eq(renameAt(text, '// Types', 3, 'X').error, 'There is nothing here to rename.', 'a comment');
  const scripted = modelToSource(build(5).model());
  eq(/also appears in the script or JSON at line \d+/.test(renameAt(scripted, 'Draft, Published', 0, 'Concept').error), true,
    'a member a script spells as a string');
  eq(renameAt(scripted, 'command UpdateText', 'command '.length, 'EditText').error, undefined, 'a script cannot name a command');
  const shared = 'enum A { Open, Closed }\nenum B { Open, Shut }\nprojection P: Unknown = Open\n'
    + 'command C(a: A) {\n  require a == Open\n}\n';
  eq(/Open at line 3 could be a member of A or B/.test(renameAt(shared, 'A { Open', 4, 'Opened').error), true,
    'a member where its enum cannot be told');
  eq(renameAt(shared, 'Unknown = Open', 'Unknown = '.length, 'X').error,
    'Open is a member of A and B, and nothing here says which — rename it at its declaration.', 'from there');
  const typed = renameAt(shared.replace('projection P: Unknown = Open\n', ''), 'A { Open', 4, 'Opened').text;
  eq(typed.includes('require a == Opened') && typed.includes('enum B { Open, Shut }'), true, 'typed by the rule\'s other side');
});

check('a rename reaches into scenarios', () => {
  const { model } = importExample('course-simple');
  const text = modelToSource(model());
  const out = renameAt(text, 'enum CourseStatus { NonExistent', 'enum CourseStatus { '.length, 'Missing').text;
  eq(/saw NonExistent\b/.test(out), false, 'a refusal\'s values');
  eq(out.includes('saw Missing'), true, 'renamed there');
  const alias = renameAt(text, 'read course = Course[courseId]', 'read '.length, 'c').text;
  eq(alias.includes('then rejected by c.status == NonExistent'), true, 'a refusal\'s rule');
});

check('completion knows an event\'s payload in a handler', () => {
  const text = modelToSource(build(0).model());
  const handler = text.replace('on CourseDefined => set event.data.capacity', 'on CourseDefined => set event.|');
  eq(completeAt(handler).labels, ['data'], 'event.');
  eq(completeAt(handler.replace('event.|', 'event.data.|')).labels, ['courseId', 'capacity'], 'event.data.');
  eq(completeAt(handler.replace('event.|', 'event.data.ca|')).labels, ['courseId', 'capacity'], 'with a word begun');
  const operand = completeAt(handler.replace('event.|', '|'));
  eq(operand.labels.slice(0, 2), ['event.data', 'successor'], 'an integer fold');
  eq(completeAt(text.replace('on CourseArchived => set Archived', 'on CourseArchived => set |')).labels,
    ['event.data', 'NonExistent', 'Existent', 'Archived'], 'an enum fold offers its members');
  eq(completeAt(text.replace('on CourseArchived => set Archived', 'on |')).labels.includes('CourseDefined'), false,
    'an event already handled');
});

check('completion knows a command\'s reads and payload', () => {
  const text = modelToSource(build(0).model());
  const rule = (insert) => completeAt(text.replace('  require course.subscriptionCount <= newCapacity',
    `  require course.subscriptionCount <= newCapacity\n  ${insert}`));
  eq(rule('require |').labels, ['course', 'courseId', 'newCapacity', 'count', 'not'], 'what a rule can be about');
  eq(rule('require course.|').labels, ['status', 'capacity', 'subscriptionCount', 'subscribedStudentIds'], 'the read\'s properties');
  eq(rule('require course.status == |').labels.slice(0, 3), ['NonExistent', 'Existent', 'Archived'], 'members first');
  eq(rule('require course.status in [|]').labels, ['NonExistent', 'Existent', 'Archived'], 'in a list');
  eq(rule('require course.status |').labels, ['==', '!=', 'in', 'not in'], 'what an enum admits');
  eq(rule('read other = |').items.find((i) => i.label === 'Course').insert, 'Course[$1]', 'an entity read');
  eq(rule('read other = Course[|]').labels.includes('other'), false, 'not the read being written');
  eq(rule('emit CourseCapacityChanged { courseId, |}').labels, ['newCapacity'], 'an event\'s remaining properties');
  eq(rule('emit CourseCapacityChanged { |}').items.map((i) => i.insert), ['courseId', 'newCapacity'], 'as shorthands');
  eq(rule('emit CourseArchived { courseId } when |').labels.slice(0, 3), ['course', 'courseId', 'newCapacity'], 'a guard');
  const start = rule('|');
  eq([start.labels, start.slot], [['read', 'require', 'emit', 'scenario'], false], 'a statement, not on a space');
});

check('completion knows scenarios, declarations, and when to stay quiet', () => {
  const { model } = importExample('course-simple');
  const text = modelToSource(model());
  const block = (insert) => completeAt(text.replace('  emit CourseArchived { courseId }\n',
    `  emit CourseArchived { courseId }\n\n  scenario {\n    ${insert}\n  }\n`));
  eq(block('given CourseDefined { |}').labels, ['courseId', 'capacity'], 'a payload\'s keys');
  eq(block('when |').labels[0], 'ArchiveCourse', 'the block\'s command first');
  eq(block('then |').items.filter((i) => i.sort === '0').map((i) => i.label), ['CourseArchived'], 'what it emits, first');
  eq(block('then rejected by course.status == |').labels.slice(0, 3), ['NonExistent', 'Existent', 'Archived'], 'a refusal');
  eq(completeAt(text.replace('// Commands', '// Commands\n@|')).labels, ['icon', 'feature', 'tagSchema'], 'annotations');
  eq(completeAt(text.replace('command DefineCourse(courseId: CourseId', 'command DefineCourse(courseId: |')).labels
    .slice(0, 3), ['boolean', 'integer', 'string'], 'a type');
  eq(completeAt(text.replace('// Commands', '// Commands |')).labels, [], 'in a comment');
  eq(completeAt(text.replace('@feature("Enrolment")', '@feature("Enrol|ment")')).labels, [], 'in a string');
  eq(completeAt(text.replace('entity Course {', 'entity Course {\n  lifecycle |')).labels.includes('status'), true,
    'an entity\'s properties, written below');
});

// ---------------------------------------------------------------
// What a read queries.
// ---------------------------------------------------------------

check('a read says which events it adds — only those of the properties used', () => {
  const { model } = build(0);
  const text = modelToSource(model());
  const queries = (source) => sandbox.sourceReadQueries(model(), parseModelSource(source));
  const of = (list, command) => list.find((q) => q.command === command);

  const archive = of(queries(text), 'ArchiveCourse');
  eq(archive.hint, '‹CourseArchived, CourseDefined›', 'status only, no capacity events');
  eq(archive.properties, [{ name: 'status', types: ['CourseArchived', 'CourseDefined'] }], 'per property');
  eq(archive.unread, ['capacity', 'subscriptionCount', 'subscribedStudentIds'], 'what it leaves out');
  eq(archive.reasons, ['rule'], 'why it is read');
  const line = text.split('\n')[archive.start.line - 1];
  eq(line.slice(archive.start.col - 1, archive.end.endCol - 1), 'read course = Course[courseId]', 'the statement');

  eq(of(queries(text), 'SubscribeStudentToCourse').types.includes('CourseCapacityChanged'), true,
    'a rule on capacity brings its events in');

  // Nothing uses it: queried by tag alone, every event under it.
  const unused = of(queries(text.replace('  require course.status == Existent\n\n  emit CourseArchived',
    '  emit CourseArchived')), 'ArchiveCourse');
  eq([unused.hint, unused.reasons, unused.properties], ['‹any type — unused›', [], []], 'an unused read');
});

check('a fanned-out read is marked, a projection read lists its events', () => {
  PREDEFINED_MODELS.forEach((entry, index) => {
    const { model } = build(index);
    const text = modelToSource(model());
    const all = sandbox.sourceReadQueries(model(), parseModelSource(text));
    const reads = (text.match(/^\s+read /gm) || []).length;
    eq(all.length, reads, `${entry.slug}: every read has a query`);
    for (const q of all) {
      eq(q.hint.includes('unused'), false, `${entry.slug} ${q.command} ${q.alias} is used`);
      eq(q.hint.startsWith('‹each · '), q.fannedOut, `${entry.slug} ${q.command} ${q.alias} fan-out`);
    }
  });
  const { model } = build(PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-sequence'));
  const numbering = sandbox.sourceReadQueries(model(), parseModelSource(modelToSource(model())))
    .find((q) => q.alias === 'courseNumbering');
  eq([numbering.hint, numbering.tags, numbering.unread], ['‹CourseDefined›', [], []], 'a projection read');
});

finish();
