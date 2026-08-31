// ============================================================
// Writes each predefined context (see `PREDEFINED_CONTEXTS` in
// model.js) out to examples/<slug>.json — the same envelope shape a
// share link carries, just uncompressed and readable, so the app can
// load an example the same way it loads any other shared model: a
// relative fetch, no special case.
//
// Run with `node poc/generate-examples.js` after changing a `seed*`
// builder or adding a predefined context. Nothing here runs in the
// browser; it is a one-time (well, one-time-per-change) build step.
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
// `const PREDEFINED_CONTEXTS` lives in the script's own lexical scope,
// not as a property of the context object — same as it would on
// `window` in a browser. The trailer pulls it out so this driver can
// see it too.
const source = fs.readFileSync(path.join(POC, 'model.js'), 'utf8')
  + '\n;\nglobalThis.PREDEFINED_CONTEXTS = PREDEFINED_CONTEXTS;';
vm.runInContext(source, sandbox, { filename: 'model.js' });

const outDir = path.join(POC, 'examples');
fs.mkdirSync(outDir, { recursive: true });

sandbox.PREDEFINED_CONTEXTS.forEach((entry, index) => {
  store.clear();
  const ctxId = sandbox.loadPredefinedContext(index);
  const ctx = sandbox.projectState()[ctxId];
  const envelope = sandbox.buildShareEnvelope(ctx, []);
  const file = path.join(outDir, entry.slug + '.json');
  fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + '\n');
  console.log('wrote', path.relative(POC, file));
});
