// ============================================================
// Prints a model the way the code view would show it — for looking at
// a shipped model, an example file or an exported envelope from the
// shell, without a browser and without writing a sandbox by hand.
//
//   node app/print-model.js                    # lists the predefined slugs
//   node app/print-model.js course-simple      # a predefined model, as code
//   node app/print-model.js path/to/model.json # an envelope file, as code
//   node app/print-model.js course-simple --json   # the stored definitions
//
// A slug builds through `PREDEFINED_MODELS` (the seed builders, so it
// shows the working tree's seeds, not app/examples/); a path imports
// the envelope the way the page does. Diagnostics of the printed text
// parsed back go to stderr, so a syntax change that breaks a model's
// round trip shows here before it shows in a suite.
// ============================================================
const fs = require('fs');
const { createSandbox, loadApp } = require('./test-harness.js');

const args = process.argv.slice(2);
const json = args.includes('--json');
const target = args.find((arg) => !arg.startsWith('--'));

const { sandbox } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js', 'dsl.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS;',
});
const { PREDEFINED_MODELS, loadPredefinedModel, importModelFromEnvelope, projectState, modelToSource, parseModelSource } = sandbox;

if (!target) {
  for (const entry of PREDEFINED_MODELS) console.log(`${entry.slug}${entry.experimental ? '  (experimental)' : ''}`);
  process.exit(0);
}

let id;
const index = PREDEFINED_MODELS.findIndex((entry) => entry.slug === target);
if (index >= 0) {
  id = loadPredefinedModel(index);
} else if (fs.existsSync(target)) {
  const { modelId, skipped } = importModelFromEnvelope(JSON.parse(fs.readFileSync(target, 'utf8')));
  for (const skip of skipped) console.error(`skipped on import: ${JSON.stringify(skip)}`);
  id = modelId;
} else {
  console.error(`No predefined model "${target}" and no such file. Run without arguments for the slugs.`);
  process.exit(1);
}

const model = projectState()[id];
if (json) {
  console.log(JSON.stringify(model, null, 2));
} else {
  const text = modelToSource(model);
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  for (const d of parseModelSource(text).diagnostics) console.error(`${d.severity} ${d.line}:${d.column} ${d.message}`);
}
