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
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS;',
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
          value = await app.project(scenario.projection, tags);
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

main();
