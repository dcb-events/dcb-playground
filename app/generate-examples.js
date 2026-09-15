// ============================================================
// Writes each predefined model (see `PREDEFINED_MODELS` in
// model.js) out to examples/<slug>.json — the same envelope shape a
// share link carries, just uncompressed and readable, so the app can
// load an example the same way it loads any other shared model: a
// relative fetch, no special case.
//
// Run with `node app/generate-examples.js` after changing a `seed*`
// builder or adding a predefined model. Nothing here runs in the
// browser; it is a one-time (well, one-time-per-change) build step.
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
// `const PREDEFINED_MODELS` lives in the script's own lexical scope,
// not as a property of the context object — same as it would on
// `window` in a browser. The trailer pulls it out so this driver can
// see it too.
const source = fs.readFileSync(path.join(APP, 'model.js'), 'utf8')
  + '\n;\nglobalThis.PREDEFINED_MODELS = PREDEFINED_MODELS;';
vm.runInContext(source, sandbox, { filename: 'model.js' });

const outDir = path.join(APP, 'examples');
fs.mkdirSync(outDir, { recursive: true });

// What a builder cannot produce and this must not destroy.
//
// The definitions in an example are derived from its `seed*` builder,
// so rewriting them is the whole point. Scenarios are not: they are
// authored in the playground and exported, and one of these files
// carries nineteen of them plus a walkthrough. They are carried across
// rather than regenerated, because nothing here could regenerate them.
const KEPT = ['scenarioDefinitions', 'propertyScenarioDefinitions', 'sandbox'];

// The parts a builder *does* own. If a file's copy of these no longer
// matches what its builder produces, the file has been edited by hand
// since — and overwriting it would throw that away while keeping the
// scenarios written against it, which is worse than either: every one
// of them would then be measured against definitions they were never
// written for, and drift for a reason nobody changed.
//
// So a diverged file is reported and left alone. Whoever diverged it
// knows whether it is a stale copy to refresh or a variant to keep;
// this does not, and guessing is how the work went missing the first
// time.
const DERIVED = [
  'customTypeDefinitions', 'eventDefinitions', 'entityDefinitions',
  'projectionDefinitions', 'commandDefinitions',
];

let skipped = 0;

sandbox.PREDEFINED_MODELS.forEach((entry, index) => {
  store.clear();
  const modelId = sandbox.loadPredefinedModel(index);
  const model = sandbox.projectState()[modelId];
  const envelope = sandbox.buildShareEnvelope(model, []);
  const file = path.join(outDir, entry.slug + '.json');

  let carried = 0;
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diverged = DERIVED.filter(
      (key) => JSON.stringify(existing[key]) !== JSON.stringify(envelope[key])
    );
    const authored = KEPT.filter((key) => existing[key] !== undefined);
    if (diverged.length && authored.length) {
      console.log('skipped', path.relative(APP, file),
        `— hand-edited (${diverged.join(', ')}) and carrying authored scenarios.`,
        'Refresh it by deleting the file, or leave it as the variant it now is.');
      skipped++;
      return;
    }
    for (const key of authored) {
      envelope[key] = existing[key];
      carried += Array.isArray(existing[key]) ? existing[key].length : 1;
    }
  }

  fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n');
  console.log('wrote', path.relative(APP, file), carried ? `(kept ${carried} authored)` : '');
});

if (skipped) console.log(`\n${skipped} file(s) left alone. See above.`);
