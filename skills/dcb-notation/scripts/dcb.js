#!/usr/bin/env node
// ============================================================
// Checks and converts DCB models from the shell, with the playground's
// own code (playground-core.js), so what passes here is what the
// playground and dcb.events accept. Plain Node, nothing to install.
//
//   node dcb.js check <file> [--cover A,B]   # problems, then each command's boundary
//   node dcb.js print <file>                 # the model as canonical notation
//   node dcb.js json  <file>                 # the model as its JSON document
//   node dcb.js link  <file>                 # a link opening it in the hosted playground
//
// A file is notation (`.dcb`) or a JSON document (`.json`). `check` is
// stricter than the playground, which keeps a defective model editable:
// here anything left to fix is a problem and exits 1. `--cover` narrows
// one check only: scenario coverage is required of the commands it names,
// so an edit answers for what it changed, and gaps elsewhere are listed.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const PLAYGROUND_URL = 'https://dcb.events/playground/';

function loadPlayground(seedText) {
  const store = new Map();
  const context = {
    console,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'playground-core.js'), 'utf8'), context, { filename: 'playground-core.js' });
  // Scenario ids come from Math.random. Seeded by the file, the same
  // model generates the same JSON, so a regenerated document diffs clean.
  let seed = 0;
  for (const char of seedText) seed = (Math.imul(seed, 31) + char.codePointAt(0)) | 0;
  vm.runInContext('Math', context).random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return context;
}

// Reads a file into `{ model, text, parsed, problems }`, or – when the
// text does not parse – no model, and the problems saying why.
function load(playground, file) {
  const raw = fs.readFileSync(file, 'utf8');
  const problems = [];
  let model = null;
  let text = raw;
  let sandboxSteps = [];
  if (file.endsWith('.json')) {
    const envelope = JSON.parse(raw);
    sandboxSteps = (envelope.sandbox && envelope.sandbox.steps) || [];
    const { modelId, skipped } = playground.importModelFromEnvelope(envelope);
    for (const skip of skipped) problems.push(`skipped on import: ${JSON.stringify(skip)}`);
    model = playground.projectState()[modelId];
    text = playground.modelToSource(model);
  }
  const parsed = playground.parseModelSource(text);
  for (const d of parsed.diagnostics) {
    if (d.severity === 'error') problems.push(`${file}:${d.line}:${d.col} ${d.message}`);
  }
  if (!parsed.name) problems.push(`${file}: no model "…" line`);
  if (problems.some((p) => !p.startsWith('skipped')) || !parsed.name) return { model: null, text, parsed, problems, sandboxSteps };
  if (!model) {
    const id = playground.createDcbModel(parsed.name);
    // Scenarios are judged below, with their lines, not refused here.
    playground.applyModelSource(id, text, { recordOutcomes: true });
    model = playground.projectState()[id];
  }
  return { model, text, parsed, problems, sandboxSteps };
}

// What the commands' scenarios leave unshown: a command nothing runs to
// success, and a rejection message no scenario reaches.
function coverageGaps(model) {
  const gaps = [];
  const scenarios = Object.values(model['scenario-definitions']);
  for (const [name, body] of Object.entries(model['command-definitions'])) {
    const outcomes = scenarios.filter((s) => s.command === name).map((s) => s.then || {});
    if (!outcomes.some((then) => then.outcome === 'published')) gaps.push({ name, gap: 'no scenario shows it succeed' });
    for (const message of new Set((body.conditions || []).map((rule) => rule.rejection))) {
      if (!outcomes.some((then) => then.rejection === message)) gaps.push({ name, gap: `no scenario shows "${message}"` });
    }
  }
  return gaps;
}

function checkProblems(playground, file, { model, parsed }, cover) {
  const problems = [];
  const report = playground.sourceScenarioReport(model, parsed);
  // "Drifted" is the playground's word for a scenario that once held. Here
  // it may never have: this run may be the first.
  for (const p of [...report.errors, ...report.warnings]) {
    problems.push(`${file}:${p.line}:${p.col} scenario: ${p.message.replace(/^Drifted – the model now does:/, 'Does not hold – the model does:')}`);
  }
  for (const a of playground.modelAdvisories(model)) problems.push(`${a.name}: ${a.message}`);
  for (const line of playground.modelToSource(model).split('\n')) {
    if (line.startsWith('// Written as JSON:')) problems.push(line.slice(3));
  }
  for (const { feature, where } of playground.experimentalFeatures(model)) {
    problems.push(`${where}: uses ${feature}, which is experimental and not supported here`);
  }
  for (const name of cover || []) {
    if (!model['command-definitions'][name]) problems.push(`--cover names "${name}", which this model does not define`);
  }
  const gaps = coverageGaps(model);
  const required = gaps.filter(({ name }) => !cover || cover.includes(name));
  problems.push(...required.map(({ name, gap }) => `command ${name}: ${gap}`));
  return { problems, otherGaps: gaps.filter((gap) => !required.includes(gap)) };
}

function boundaryLines(playground, model) {
  const lines = [];
  for (const [name, body] of Object.entries(model['command-definitions'])) {
    const summary = playground.boundarySummary(model, body);
    lines.push(`${name}: ${summary.words}; appends with tags ${summary.writes.join(', ') || 'none'}`);
    for (const item of summary.items) {
      lines.push(`  ${item.types.join(' | ') || 'any type'} [${item.tags.join(', ') || 'no tag'}]${item.fannedOut ? ' per element' : ''}`);
    }
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const coverAt = args.indexOf('--cover');
  const cover = coverAt < 0 ? null : (args.splice(coverAt, 2)[1] || '').split(',').filter(Boolean);
  const [verb, file, ...rest] = args;
  if (!['check', 'print', 'json', 'link'].includes(verb) || !file || rest.length || (cover && !cover.length)) {
    console.error('usage: dcb.js check <file> [--cover Command,…] | print|json|link <file>');
    return 2;
  }
  const playground = loadPlayground(fs.readFileSync(file, 'utf8'));
  const loaded = load(playground, file);
  const { model, sandboxSteps } = loaded;
  if (!model) {
    console.error(loaded.problems.join('\n'));
    return 1;
  }
  if (verb === 'print') {
    if (sandboxSteps.length) console.error(`${sandboxSteps.length} sandbox step(s) not printed: the notation has no spelling for a sandbox session`);
    const text = playground.modelToSource(model);
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  } else if (verb === 'json') {
    console.log(JSON.stringify(playground.buildShareEnvelope(model, sandboxSteps), null, 2));
  } else if (verb === 'link') {
    console.log(PLAYGROUND_URL + '#model=' + zlib.gzipSync(JSON.stringify(playground.buildShareEnvelope(model, []))).toString('base64url')
      + (playground.experimentalFeatures(model).length ? '&experimental' : ''));
  } else {
    const { problems: found, otherGaps } = checkProblems(playground, file, loaded, cover);
    const problems = [...loaded.problems, ...found];
    if (problems.length) console.error(problems.join('\n') + `\n\n${problems.length} problem(s)\n`);
    if (otherGaps.length) console.log('Not covered, outside --cover:\n' + otherGaps.map(({ name, gap }) => `  command ${name}: ${gap}`).join('\n') + '\n');
    const scenarios = Object.keys(model['scenario-definitions']).length + Object.keys(model['projection-scenario-definitions']).length;
    if (!problems.length) console.log(`${scenarios} scenario(s) hold\n`);
    console.log(boundaryLines(playground, model).join('\n'));
    return problems.length ? 1 : 0;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
