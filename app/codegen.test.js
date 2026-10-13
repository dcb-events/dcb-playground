// ============================================================
// DCB Playground — code export tests.
//
// codegen.js is a third copy of the semantics (see its header), and
// this is what holds it to the first: every scenario of every shipped
// model and every fixture is run twice — by the evaluator
// (`runScenario`, `runProjectionScenario`) and by the exported code,
// against its in-memory store — and the two must agree. Accepted with
// the same events, refused with the same message, folded to the same
// value; a scenario the evaluator cannot run must throw in the export.
// A definition the export stubs is counted, not compared — and the
// models without experimental constructs must have none.
//
// Then the export's own pieces: the append condition really guards
// (a concurrent write fails the append), the tests it prints pass
// under `node --test`, and the options change what they say.
//
// Run with `node app/codegen.test.js`.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { createSandbox, loadApp, makeChecker } = require('./test-harness.js');

const APP = __dirname;
const FIXTURES = path.join(APP, '..', 'fixtures');
const { sandbox, store } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js', 'codegen.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS; globalThis.CODE_PHP_LIBRARY = CODE_PHP_LIBRARY;',
});
const { check, eq, finish } = makeChecker();
const {
  PREDEFINED_MODELS, loadPredefinedModel, importModelFromEnvelope, projectState,
  generateCode, runScenario, runProjectionScenario,
} = sandbox;

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb-codegen-'));
process.on('exit', () => fs.rmSync(OUT, { recursive: true, force: true }));

function fresh() {
  store.clear();
  sandbox.bumpLogRevision();
}

// Every model the suite holds the export to: the predefined ones, and
// the fixtures that carry scenarios no builder produces.
function models() {
  const out = PREDEFINED_MODELS.map((entry, index) => ({
    label: entry.slug,
    experimental: !!entry.experimental,
    load: () => loadPredefinedModel(index),
  }));
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()) {
    const slug = file.replace(/\.json$/, '');
    const entry = PREDEFINED_MODELS.find((m) => m.slug === slug);
    out.push({
      label: `fixtures/${file}`,
      experimental: entry ? !!entry.experimental : true,
      load: () => importModelFromEnvelope(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'))).modelId,
    });
  }
  return out;
}

let written = 0;
async function importExport(text) {
  const file = path.join(OUT, `export-${++written}.mjs`);
  fs.writeFileSync(file, text);
  return import(pathToFileURL(file).href);
}

// Plain data out of the vm context, so deep comparison is by value.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value === undefined ? null : value;
};
const same = (a, b, what) => eq(canonical(plain(a)), canonical(plain(b)), what);

// A command whose second read is tagged by its first's answer — two
// query rounds, which no shipped model exported without a stub has.
const CHAINED = {
  name: 'Chained',
  'custom-type-definitions': { CourseId: { schema: { type: 'string' }, isTag: true } },
  'entity-definitions': {},
  'event-definitions': {
    CourseDefined: {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'capacity', propertyType: 'integer', isOptional: false, isList: false },
      ],
      tags: ['courseId'],
    },
    CourseCapacityChanged: {
      properties: [
        { name: 'courseId', propertyType: 'CourseId', isOptional: false, isList: false },
        { name: 'newCapacity', propertyType: 'integer', isOptional: false, isList: false },
      ],
      tags: ['courseId'],
    },
  },
  'projection-definitions': {
    LatestCourse: {
      tags: [], valueType: 'CourseId', isList: false, initialValue: null,
      handlers: [{ event: 'CourseDefined', operation: 'set', value: { eventProperty: 'courseId' } }],
    },
    CourseCapacity: {
      tags: [{ name: 'courseId', tagType: 'CourseId' }], valueType: 'integer', isList: false, initialValue: 0,
      handlers: [
        { event: 'CourseDefined', operation: 'set', value: { eventProperty: 'capacity' } },
        { event: 'CourseCapacityChanged', operation: 'set', value: { eventProperty: 'newCapacity' } },
      ],
    },
  },
  'command-definitions': {
    GrowLatestCourse: {
      properties: [{ name: 'newCapacity', propertyType: 'integer', isOptional: false, isList: false }],
      boundary: [
        { alias: 'latest', projection: 'LatestCourse', tags: {} },
        { alias: 'capacity', projection: 'CourseCapacity', tags: { courseId: { alias: 'latest' } } },
      ],
      conditions: [{ leftHandSide: { alias: 'capacity' }, predicate: 'lessThan', rightHandSide: { parameterName: 'newCapacity' }, rejection: 'Not larger' }],
      publishes: [{ name: 'CourseCapacityChanged', parameters: { courseId: { alias: 'latest' }, newCapacity: { parameterName: 'newCapacity' } } }],
    },
  },
};
const CHAINED_LOG = [
  { type: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } },
  { type: 'CourseDefined', data: { courseId: 'c2', capacity: 8 } },
  { type: 'CourseCapacityChanged', data: { courseId: 'c1', newCapacity: 6 } },
];

const given = (scenario) => (scenario.given || []).map((step) => ({ type: step.event, data: step.data || {} }));

async function main() {
  for (const entry of models()) {
    fresh();
    const id = entry.load();
    const model = projectState()[id];
    const { text, stubs } = generateCode(model, {});
    const stubbed = new Set(stubs.map((s) => `${s.kind}:${s.name}`));

    if (!entry.experimental) {
      check(`${entry.label}: exports without a stub`, () => eq(stubs.map((s) => `${s.kind} ${s.name}: ${s.reason}`), [], 'stubs'));
    }

    let mod;
    await check(`${entry.label}: the export loads as a module`, async () => { mod = await importExport(text); });
    if (!mod) continue;

    for (const scenario of Object.values(model['scenario-definitions'] || {})) {
      if (stubbed.has(`command:${scenario.command}`)) continue;
      const label = `${entry.label}: ${scenario.command} ${sandbox.scenarioName(scenario)}`;
      await check(label, async () => {
        const evaluated = runScenario(model, scenario);
        const app = mod.createApp(mod.createInMemoryEventStore(given(scenario)));
        let outcome;
        let thrown = null;
        try {
          outcome = await app.handle(scenario.command, plain((scenario.when || {}).arguments || {}));
        } catch (error) {
          thrown = error;
        }
        if (evaluated.status === 'broken') {
          // A Given that has fallen behind the definitions is the
          // evaluator's to refuse; the export takes events as they come.
          if (/^Given step/.test(evaluated.reason)) return;
          if (!thrown) throw new Error(`the evaluator could not run it (${evaluated.reason}), the export returned ${JSON.stringify(outcome)}`);
          return;
        }
        if (thrown) throw new Error(`the export threw: ${thrown.message}`);
        const actual = evaluated.actual;
        if (actual.outcome === 'rejected') same(outcome, { rejected: actual.rejection }, 'outcome');
        else same({ published: outcome.published.map(({ type, data }) => ({ type, data })) }, { published: actual.events }, 'outcome');
      });
    }

    for (const scenario of Object.values(model['projection-scenario-definitions'] || {})) {
      if (stubbed.has(`projection:${scenario.projection}`)) continue;
      const label = `${entry.label}: ${scenario.projection} ${sandbox.projectionScenarioName(scenario)}`;
      await check(label, async () => {
        const evaluated = runProjectionScenario(model, scenario);
        const tags = {};
        for (const [name, tag] of Object.entries(scenario.tags || {})) tags[name] = plain(tag && tag.tagValue);
        const app = mod.createApp(mod.createInMemoryEventStore(given(scenario)));
        let value;
        let thrown = null;
        try {
          value = await app.project(scenario.projection, tags, plain(scenario.arguments || {}));
        } catch (error) {
          thrown = error;
        }
        if (evaluated.status === 'broken') {
          if (/^Given step/.test(evaluated.reason)) return;
          if (!thrown) throw new Error(`the evaluator could not run it (${evaluated.reason}), the export folded ${JSON.stringify(value)}`);
          return;
        }
        if (thrown) throw new Error(`the export threw: ${thrown.message}`);
        same(value, evaluated.actual, 'value');
      });
    }
  }

  // ---- The export's own guarantees -----------------------------------

  const simple = PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-simple');
  fresh();
  const courseId = loadPredefinedModel(simple);
  const course = projectState()[courseId];

  await check('the append condition fails a decision someone else wrote into', async () => {
    const mod = await importExport(generateCode(course, {}).text);
    const memory = mod.createInMemoryEventStore([
      { type: 'CourseDefined', data: { courseId: 'c1', capacity: 1 } },
      { type: 'StudentRegistered', data: { studentId: 's1' } },
      { type: 'StudentRegistered', data: { studentId: 's2' } },
    ]);
    const decision = await mod.commands.SubscribeStudentToCourse(memory, { courseId: 'c1', studentId: 's1' });
    same(decision.appendCondition.after, 3, 'after');
    await mod.createApp(memory).handle('SubscribeStudentToCourse', { courseId: 'c1', studentId: 's2' });
    let failed = false;
    try {
      await memory.append(decision.published, decision.appendCondition);
    } catch (error) {
      failed = error instanceof mod.AppendConditionFailed;
    }
    eq(failed, true, 'failed with AppendConditionFailed');
  });

  await check('a write outside the boundary does not fail the append', async () => {
    const mod = await importExport(generateCode(course, {}).text);
    const memory = mod.createInMemoryEventStore([
      { type: 'CourseDefined', data: { courseId: 'c1', capacity: 5 } },
      { type: 'StudentRegistered', data: { studentId: 's1' } },
    ]);
    const decision = await mod.commands.SubscribeStudentToCourse(memory, { courseId: 'c1', studentId: 's1' });
    await mod.createApp(memory).handle('DefineCourse', { courseId: 'c2', capacity: 3 });
    await memory.append(decision.published, decision.appendCondition);
    eq(memory.events.length, 4, 'events');
  });

  await check('a rejection is returned and an argument missing throws', async () => {
    const mod = await importExport(generateCode(course, {}).text);
    const app = mod.createApp(mod.createInMemoryEventStore());
    same(await app.handle('ArchiveCourse', { courseId: 'c1' }), { rejected: 'Course is not active' }, 'outcome');
    let thrown = null;
    try { await app.handle('ArchiveCourse', {}); } catch (error) { thrown = error; }
    eq(thrown instanceof mod.EvaluationError, true, 'EvaluationError');
  });

  // The printed tests, run the way the header says to run them — over
  // the fixtures, which are the models that carry scenarios.
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()) {
    check(`fixtures/${file}: the printed tests pass under node --test`, () => {
      fresh();
      const { modelId } = importModelFromEnvelope(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')));
      const out = path.join(OUT, file.replace(/\.json$/, '.test.mjs'));
      fs.writeFileSync(out, generateCode(projectState()[modelId], { includeTests: true }).text);
      const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', out], { encoding: 'utf8' });
      if (run.status !== 0) throw new Error(`node --test failed:\n${(run.stdout + run.stderr).slice(-2000)}`);
      // import.meta.main false would run nothing, and pass.
      const ran = Number((/# tests (\d+)/.exec(run.stdout) || [])[1] || 0);
      const total = Object.keys(projectState()[modelId]['scenario-definitions'] || {}).length
        + Object.keys(projectState()[modelId]['projection-scenario-definitions'] || {}).length;
      eq(ran, total, 'tests run');
    });
  }

  // pricing-simple ships no scenarios, so its fan-out is held to the
  // evaluator here, case by case.
  await check('a fan-out decides as the evaluator does, a zipped price included', async () => {
    fresh();
    const id = loadPredefinedModel(PREDEFINED_MODELS.findIndex((m) => m.slug === 'pricing-simple'));
    const model = projectState()[id];
    const mod = await importExport(generateCode(model, {}).text);
    const log = [
      { type: 'ProductDefined', data: { productId: 'p1', price: 10 } },
      { type: 'ProductDefined', data: { productId: 'p2', price: 20 } },
      { type: 'ProductPriceChanged', data: { productId: 'p2', newPrice: 25 } },
    ];
    const cases = [
      { orderId: 'o1', items: [{ productId: 'p1', price: 10 }, { productId: 'p2', price: 25 }] },
      { orderId: 'o1', items: [{ productId: 'p1', price: 10 }, { productId: 'p2', price: 20 }] },
      { orderId: 'o1', items: [{ productId: 'p3', price: 10 }] },
      { orderId: 'o1', items: [] },
    ];
    for (const args of cases) {
      const evaluated = sandbox.evaluateCommand(model, log, 'OrderProducts', args);
      const expected = evaluated.outcome === 'rejected'
        ? { rejected: evaluated.failedRule.rejection }
        : { published: evaluated.events.map(({ type, data }) => ({ type, data })) };
      const outcome = await mod.createApp(mod.createInMemoryEventStore(log)).handle('OrderProducts', args);
      const actual = 'rejected' in outcome ? outcome : { published: outcome.published.map(({ type, data }) => ({ type, data })) };
      same(actual, expected, JSON.stringify(args.items));
    }
  });

  check('what the export cannot translate is a stub that says why', () => {
    fresh();
    const id = loadPredefinedModel(PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-entities'));
    const { text, stubs } = generateCode(projectState()[id], {});
    if (!stubs.length) throw new Error('no stubs');
    for (const stub of stubs) {
      if (!text.includes(`${stub.kind} ${stub.name}: ${stub.reason}`)) throw new Error(`the header does not list ${stub.name}`);
    }
    if (!stubs.some((s) => /entities are not exported yet/.test(s.reason))) throw new Error('no entity stub');
  });

  // Scripts go into the export verbatim, under the evaluator's
  // contract: a frozen event, a fresh state per fold, `exposes`.
  await check('a scripted projection runs its own code, and an event it writes to throws', async () => {
    const model = {
      name: 'Scripts',
      'custom-type-definitions': { DocumentId: { schema: { type: 'string' }, isTag: true } },
      'entity-definitions': {},
      'event-definitions': {
        Touched: { properties: [{ name: 'documentId', propertyType: 'DocumentId', isOptional: false, isList: false }], tags: ['documentId'] },
      },
      'projection-definitions': {
        Touches: {
          tags: [{ name: 'documentId', tagType: 'DocumentId' }], valueType: 'integer', isList: false,
          script: { initialState: { n: 0, seen: [] }, exposes: 'n' },
          handlers: [{ event: 'Touched', code: '(state.seen.push(tags.documentId), { ...state, n: state.n + 1 })' }],
        },
        Vandal: {
          tags: [], valueType: 'integer', isList: false,
          script: { initialState: 0 },
          handlers: [{ event: 'Touched', code: '(event.data.documentId = "x", 1)' }],
        },
      },
      'command-definitions': {},
    };
    const { text, stubs } = generateCode(model, {});
    eq(stubs, [], 'stubs');
    const mod = await importExport(text);
    const app = mod.createApp(mod.createInMemoryEventStore([
      { type: 'Touched', data: { documentId: 'd1' } }, { type: 'Touched', data: { documentId: 'd1' } },
    ]));
    eq(await app.project('Touches', { documentId: 'd1' }), 2, 'exposed');
    eq(await app.project('Touches', { documentId: 'd1' }), 2, 'from a fresh state');
    let thrown = null;
    try { await app.project('Vandal', {}); } catch (error) { thrown = error; }
    eq(thrown instanceof mod.EvaluationError, true, 'the frozen event refused the write');
  });

  await check('a chained read decides in two rounds, and its append condition covers both', async () => {
    const { text, stubs } = generateCode(CHAINED, {});
    eq(stubs, [], 'stubs');
    const mod = await importExport(text);
    for (const newCapacity of [9, 7]) {
      const evaluated = sandbox.evaluateCommand(CHAINED, CHAINED_LOG, 'GrowLatestCourse', { newCapacity });
      const outcome = await mod.createApp(mod.createInMemoryEventStore(CHAINED_LOG)).handle('GrowLatestCourse', { newCapacity });
      const actual = 'rejected' in outcome ? outcome : { published: outcome.published.map(({ type, data }) => ({ type, data })) };
      same(actual, evaluated.outcome === 'rejected' ? { rejected: evaluated.failedRule.rejection } : { published: evaluated.events }, `to ${newCapacity}`);
    }
    const memory = mod.createInMemoryEventStore(CHAINED_LOG);
    const decision = await mod.commands.GrowLatestCourse(memory, { newCapacity: 9 });
    same(decision.appendCondition.after, 3, 'after the head both rounds saw');
    eq(decision.appendCondition.failIfEventsMatch.items.length, 2, 'both rounds\' queries');
    await mod.createApp(memory).handle('GrowLatestCourse', { newCapacity: 10 });
    let failed = false;
    try { await memory.append(decision.published, decision.appendCondition); } catch (error) { failed = error instanceof mod.AppendConditionFailed; }
    eq(failed, true, 'a write into the second round\'s query fails it');
  });

  check('a target that cannot run JavaScript stubs a scripted projection, and what reads it', () => {
    fresh();
    const id = importModelFromEnvelope(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'content-decisions-scripted.json'), 'utf8'))).modelId;
    const plan = sandbox.codePlan(projectState()[id], { scripts: false });
    eq(plan.stubs.some((s) => s.kind === 'projection' && /JavaScript/.test(s.reason)), true, 'the script');
    eq(plan.stubs.some((s) => s.kind === 'command'), true, 'and a command reading it');
  });

  await phpChecks();

  check('options: no adapter, no doc comments, sandbox steps', () => {
    const bare = generateCode(course, { includeAdapter: false, docComments: false }).text;
    eq(bare.includes('createInMemoryEventStore'), false, 'adapter left out');
    eq(bare.includes('reads 2 types'), false, 'doc comments left out');
    const seeded = generateCode(course, { sandboxSteps: [{ command: 'DefineCourse', args: { courseId: 'c1', capacity: 3 } }] }).text;
    eq(seeded.includes("{ command: 'DefineCourse', args: { courseId: 'c1', capacity: 3 } }"), true, 'sandbox step');
  });

  check('names that would collide with the runtime are suffixed', () => {
    const model = {
      name: 'Collisions',
      'custom-type-definitions': {},
      'entity-definitions': {},
      'event-definitions': {},
      'projection-definitions': {
        tag: { tags: [], valueType: 'integer', isList: false, initialValue: 0, handlers: [] },
      },
      'command-definitions': {},
    };
    const { text } = generateCode(model, {});
    eq(/const tag_ = projection\(/.test(text), true, 'suffixed');
    eq(text.includes('export const projections = { tag: tag_ };'), true, 'keyed by its own name');
  });

  finish();
}

// ---- PHP -----------------------------------------------------------
//
// The same comparison for the PHP target, run by a PHP process against
// wwwision/dcb-eventstore. It needs `php` and the library: the
// library is installed once with composer into a cache under the
// system's temporary directory, or found at $DCB_PHP_AUTOLOAD. Without
// either the PHP checks are skipped with a note — unless
// $DCB_REQUIRE_PHP is set, as CI sets it, and then that is a failure.

function phpAutoload() {
  if (spawnSync('php', ['--version']).status !== 0) return { missing: 'no php on the PATH' };
  if (process.env.DCB_PHP_AUTOLOAD) return { autoload: process.env.DCB_PHP_AUTOLOAD };
  const dir = path.join(os.tmpdir(), 'dcb-playground-php-deps');
  const autoload = path.join(dir, 'vendor', 'autoload.php');
  if (!fs.existsSync(autoload)) {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, 'composer.json'))) fs.writeFileSync(path.join(dir, 'composer.json'), '{}');
    const library = sandbox.CODE_PHP_LIBRARY;
    const run = spawnSync('composer', ['require', '-n', '-q', '-d', dir, library], { encoding: 'utf8' });
    if (run.status !== 0 || !fs.existsSync(autoload)) return { missing: `composer could not install ${library}: ${(run.stderr || '').trim().slice(-300)}` };
  }
  return { autoload };
}

const PHP_DRIVER = String.raw`<?php
require $argv[1];
require $argv[2];
$ns = $argv[3];
$cases = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($cases as $case) {
    try {
        $store = \Wwwision\DCBEventStore\InMemoryEventStore\InMemoryEventStore::create();
        foreach ($case['given'] as $e) {
            $store->append(\Wwwision\DCBEventStore\Event\Event::create($e['type'], $e['data'] === [] ? '{}' : $e['data'], ($ns . '\Model')::tagsOf($e['type'], $e['data'])));
        }
        $app = new ($ns . '\App')($store);
        if ($case['kind'] === 'command') {
            $decision = $app->handle($case['command'], $case['args']);
            $result = $decision instanceof ($ns . '\Rejected')
                ? ['rejected' => $decision->reason]
                : ['published' => array_map(static fn ($ev) => ['type' => $ev::TYPE, 'data' => $ev->toArray()], $decision->events)];
        } else {
            $result = ['value' => $app->project($case['projection'], $case['tags'], $case['args'])];
        }
        $out[] = ['ok' => $result];
    } catch (\Throwable $e) {
        $out[] = ['error' => get_class($e) . ': ' . $e->getMessage()];
    }
}
echo json_encode($out);
`;

// PHP decodes `{}` and `[]` alike; so does the comparison.
const phpCanonical = (value) => {
  if (Array.isArray(value)) return value.map(phpCanonical);
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return keys.length ? Object.fromEntries(keys.map((k) => [k, phpCanonical(value[k])])) : [];
  }
  return value === undefined ? null : value;
};

async function phpChecks() {
  const found = phpAutoload();
  if (found.missing) {
    if (process.env.DCB_REQUIRE_PHP) check('PHP is available for the PHP export checks', () => { throw new Error(found.missing); });
    else console.log(`(PHP export checks skipped: ${found.missing})`);
    return;
  }
  const driver = path.join(OUT, 'driver.php');
  fs.writeFileSync(driver, PHP_DRIVER);

  for (const entry of models()) {
    fresh();
    const id = entry.load();
    const model = projectState()[id];
    const { text, stubs } = generateCode(model, { target: 'php' });
    const namespace = /^namespace (.+);$/m.exec(text)[1];
    const file = path.join(OUT, `export-${++written}.php`);
    fs.writeFileSync(file, text);
    check(`${entry.label} (PHP): the export lints`, () => {
      const lint = spawnSync('php', ['-l', file], { encoding: 'utf8' });
      if (lint.status !== 0) throw new Error(lint.stdout + lint.stderr);
    });
    const stubbed = new Set(stubs.map((stub) => `${stub.kind}:${stub.name}`));
    if (!entry.experimental) {
      check(`${entry.label} (PHP): exports without a stub`, () => eq(stubs.map((stub) => `${stub.kind} ${stub.name}`), [], 'stubs'));
    }

    const cases = [];
    for (const scenario of Object.values(model['scenario-definitions'] || {})) {
      if (stubbed.has(`command:${scenario.command}`)) continue;
      cases.push({
        label: `${scenario.command} ${sandbox.scenarioName(scenario)}`,
        evaluated: runScenario(model, scenario),
        input: { kind: 'command', given: given(scenario), command: scenario.command, args: plain((scenario.when || {}).arguments || {}) },
      });
    }
    for (const scenario of Object.values(model['projection-scenario-definitions'] || {})) {
      if (stubbed.has(`projection:${scenario.projection}`)) continue;
      const tags = {};
      for (const [name, tag] of Object.entries(scenario.tags || {})) tags[name] = plain(tag && tag.tagValue);
      cases.push({
        label: `${scenario.projection} ${sandbox.projectionScenarioName(scenario)}`,
        evaluated: runProjectionScenario(model, scenario),
        input: { kind: 'projection', given: given(scenario), projection: scenario.projection, tags, args: plain(scenario.arguments || {}) },
      });
    }
    if (!cases.length) continue;
    const run = spawnSync('php', [driver, found.autoload, file, namespace], { input: JSON.stringify(cases.map((c) => c.input)), encoding: 'utf8' });
    let results = null;
    check(`${entry.label} (PHP): the scenarios run`, () => {
      if (run.status !== 0) throw new Error((run.stdout + run.stderr).slice(-1500));
      results = JSON.parse(run.stdout);
    });
    if (!results) continue;
    cases.forEach((c, i) => check(`${entry.label} (PHP): ${c.label}`, () => {
      const result = results[i];
      if (c.evaluated.status === 'broken') {
        if (/^Given step/.test(c.evaluated.reason)) return;
        if (!result.error) throw new Error(`the evaluator could not run it (${c.evaluated.reason}), the export returned ${JSON.stringify(result.ok)}`);
        return;
      }
      if (result.error) throw new Error(`the export threw: ${result.error}`);
      const actual = c.evaluated.actual;
      const expected = c.input.kind === 'projection' ? { value: actual }
        : actual.outcome === 'rejected' ? { rejected: actual.rejection } : { published: actual.events };
      eq(phpCanonical(result.ok), phpCanonical(plain(expected)), 'outcome');
    }));
  }

  // The printed scenarios, run the way the header says to run them.
  for (const file of fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()) {
    check(`fixtures/${file} (PHP): the printed scenarios pass`, () => {
      fresh();
      const { modelId } = importModelFromEnvelope(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')));
      const model = projectState()[modelId];
      const out = path.join(OUT, file.replace(/\.json$/, '.php'));
      fs.writeFileSync(out, generateCode(model, { target: 'php', includeTests: true }).text);
      // The autoloader, where the header says to keep it: vendor/ beside the file.
      const vendor = path.join(OUT, 'vendor');
      if (!fs.existsSync(vendor)) fs.symlinkSync(path.dirname(found.autoload), vendor);
      const run = spawnSync('php', [out], { encoding: 'utf8', cwd: OUT });
      if (run.status !== 0) throw new Error(run.stdout.split('\n').filter((l) => /^not ok|^ {2}#/.test(l)).join('\n') + run.stderr);
      const total = Object.keys(model['scenario-definitions'] || {}).length
        + Object.keys(model['projection-scenario-definitions'] || {}).length;
      eq((run.stdout.match(/^ok /gm) || []).length, total, 'scenarios run');
    });
  }

  check('PHP: a chained read decides as the evaluator does, after the head both rounds saw', () => {
    const text = generateCode(CHAINED, { target: 'php' }).text;
    const file = path.join(OUT, 'chained.php');
    fs.writeFileSync(file, text);
    const ns = /^namespace (.+);$/m.exec(text)[1];
    const cases = [9, 7].map((newCapacity) => ({ kind: 'command', given: CHAINED_LOG, command: 'GrowLatestCourse', args: { newCapacity } }));
    const run = spawnSync('php', [driver, found.autoload, file, ns], { input: JSON.stringify(cases), encoding: 'utf8' });
    const results = JSON.parse(run.stdout);
    [9, 7].forEach((newCapacity, i) => {
      const evaluated = sandbox.evaluateCommand(CHAINED, CHAINED_LOG, 'GrowLatestCourse', { newCapacity });
      eq(phpCanonical(results[i].ok), phpCanonical(plain(evaluated.outcome === 'rejected'
        ? { rejected: evaluated.failedRule.rejection } : { published: evaluated.events })), `to ${newCapacity}`);
    });
    const script = String.raw`<?php
require $argv[1]; require $argv[2];
use Wwwision\DCBEventStore\InMemoryEventStore\InMemoryEventStore;
$commands = '` + ns + String.raw`\Commands';
$store = InMemoryEventStore::create();
foreach ([['c1', 5], ['c2', 8]] as [$id, $capacity]) {
    $store->append(\Wwwision\DCBEventStore\Event\Event::create('CourseDefined', ['courseId' => $id, 'capacity' => $capacity], ['CourseId:' . $id]));
}
$decision = $commands::decide($store, 'GrowLatestCourse', ['newCapacity' => 9]);
echo json_encode(['after' => $decision->appendCondition->after?->value, 'items' => count(iterator_to_array($decision->appendCondition->failIfEventsMatch))]);
`;
    const driverFile = path.join(OUT, 'chained-driver.php');
    fs.writeFileSync(driverFile, script);
    const shape = spawnSync('php', [driverFile, found.autoload, file], { encoding: 'utf8' });
    eq(JSON.parse(shape.stdout), { after: 2, items: 2 }, 'the append condition');
  });

  check('PHP: the append condition fails a decision someone else wrote into', () => {
    fresh();
    const id = loadPredefinedModel(PREDEFINED_MODELS.findIndex((m) => m.slug === 'course-simple'));
    const text = generateCode(projectState()[id], { target: 'php' }).text;
    const file = path.join(OUT, 'concurrency.php');
    fs.writeFileSync(file, text);
    const ns = /^namespace (.+);$/m.exec(text)[1];
    const script = String.raw`<?php
require $argv[1]; require $argv[2];
use Wwwision\DCBEventStore\InMemoryEventStore\InMemoryEventStore;
use Wwwision\DCBEventStore\Exceptions\ConditionalAppendFailed;
$app = '` + ns + String.raw`\App'; $commands = '` + ns + String.raw`\Commands'; $model = '` + ns + String.raw`\Model';
$store = InMemoryEventStore::create();
$a = new $app($store);
$a->handle('DefineCourse', ['courseId' => 'c1', 'capacity' => 2]);
$a->handle('RegisterStudent', ['studentId' => 's1']);
$a->handle('RegisterStudent', ['studentId' => 's2']);
$decision = $commands::decide($store, 'SubscribeStudentToCourse', ['courseId' => 'c1', 'studentId' => 's1']);
$a->handle('DefineCourse', ['courseId' => 'c2', 'capacity' => 1]);
$store->append(\Wwwision\DCBEventStore\Event\Events::fromArray(array_map([$model, 'toStoreEvent'], $decision->events)), $decision->appendCondition);
$second = $commands::decide($store, 'SubscribeStudentToCourse', ['courseId' => 'c1', 'studentId' => 's2']);
$a->handle('ChangeCourseCapacity', ['courseId' => 'c1', 'newCapacity' => 5]);
try {
    $store->append(\Wwwision\DCBEventStore\Event\Events::fromArray(array_map([$model, 'toStoreEvent'], $second->events)), $second->appendCondition);
    echo 'appended';
} catch (ConditionalAppendFailed) {
    echo 'refused';
}
`;
    const driverFile = path.join(OUT, 'concurrency-driver.php');
    fs.writeFileSync(driverFile, script);
    const run = spawnSync('php', [driverFile, found.autoload, file], { encoding: 'utf8' });
    eq((run.stdout + run.stderr).trim(), 'refused', 'a write outside the boundary passed, one inside it refused');
  });
}

main();
