// ============================================================
// Exports a model as code from the shell — what the Export dialog's
// "As code" offers, for looking at the output without a browser
// (experimental; see codegen.js).
//
//   node app/generate-code.js                         # lists the predefined slugs
//   node app/generate-code.js course-simple           # a predefined model, as JavaScript
//   node app/generate-code.js path/to/model.json      # an envelope file
//   node app/generate-code.js course-simple --tests   # with its scenarios as node:test tests
//   node app/generate-code.js course-simple --no-adapter --no-docs
//   node app/generate-code.js course-simple --target=php
//
// An envelope's sandbox steps, when it carries any, are replayable with
// --sandbox. Stubs — what the export could not translate — go to stderr.
// ============================================================
const fs = require('fs');
const { createSandbox, loadApp } = require('./test-harness.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const target = args.find((arg) => !arg.startsWith('--'));

const { sandbox } = createSandbox();
loadApp(sandbox, ['model.js', 'evaluate.js', 'codegen.js'], {
  trailer: 'globalThis.PREDEFINED_MODELS = PREDEFINED_MODELS;',
});
const { PREDEFINED_MODELS, loadPredefinedModel, importModelFromEnvelope, projectState, generateCode } = sandbox;

if (!target) {
  for (const entry of PREDEFINED_MODELS) console.log(`${entry.slug}${entry.experimental ? '  (experimental)' : ''}`);
  process.exit(0);
}

let id;
let sandboxSteps = [];
const index = PREDEFINED_MODELS.findIndex((entry) => entry.slug === target);
if (index >= 0) {
  id = loadPredefinedModel(index);
} else if (fs.existsSync(target)) {
  const envelope = JSON.parse(fs.readFileSync(target, 'utf8'));
  const { modelId, skipped } = importModelFromEnvelope(envelope);
  for (const skip of skipped) console.error(`skipped on import: ${JSON.stringify(skip)}`);
  id = modelId;
  sandboxSteps = (envelope.sandbox && envelope.sandbox.steps) || [];
} else {
  console.error(`No predefined model "${target}" and no such file. Run without arguments for the slugs.`);
  process.exit(1);
}

const { text, stubs } = generateCode(projectState()[id], {
  includeTests: flag('--tests'),
  target: (args.find((arg) => arg.startsWith('--target=')) || '--target=js').slice(9),
  includeAdapter: !flag('--no-adapter'),
  docComments: !flag('--no-docs'),
  sandboxSteps: flag('--sandbox') ? sandboxSteps : [],
});
process.stdout.write(text);
for (const stub of stubs) console.error(`not exported: ${stub.kind} ${stub.name} — ${stub.reason}`);
