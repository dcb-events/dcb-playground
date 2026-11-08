#!/usr/bin/env node
// ============================================================
// Checks and converts DCB models from the shell, with the playground's
// own code (playground-core.js), so what passes here is what the
// playground and dcb.events accept. Plain Node, nothing to install.
//
//   node dcb.js check <file> [--cover A,B]   # problems, then each command's boundary
//   node dcb.js conflicts <file>             # for each command, which commands can invalidate it
//   node dcb.js replay <file> <export> [--map Old=New,…] [--read Projection=value,…]
//                                            # stored events (NDJSON) against the model
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
    const { modelId, skipped, converted } = playground.importModelFromEnvelope(envelope);
    for (const skip of skipped) problems.push(`skipped on import: ${JSON.stringify(skip)}`);
    // What an older document said differently, or said that 11.0 cannot
    // – a command left out among them – never silently.
    for (const note of converted) problems.push(`converted on import: ${note.name}: ${note.note}`);
    model = playground.projectState()[modelId];
    text = playground.modelToSource(model);
  }
  const parsed = playground.parseModelSource(text);
  for (const d of parsed.diagnostics) {
    if (d.severity === 'error') problems.push(`${file}:${d.line}:${d.col} ${d.message}`);
  }
  if (!parsed.name) problems.push(`${file}: no model "…" line`);
  const onImport = (p) => p.startsWith('skipped') || p.startsWith('converted');
  if (problems.some((p) => !onImport(p)) || !parsed.name) return { model: null, text, parsed, problems, sandboxSteps };
  if (!model) {
    const id = playground.createDcbModel(parsed.name);
    // Scenarios are judged below, with their lines, not refused here.
    playground.applyModelSource(id, text, { recordOutcomes: true });
    model = playground.projectState()[id];
  }
  return { model, text, parsed, problems, sandboxSteps };
}

// What the commands' scenarios leave unshown: one scenario is owed per
// way a command succeeds – each branch that emits, or plain success
// without branches – and one per rejection message (`commandCoverageGaps`).
function coverageGaps(playground, model) {
  const gaps = [];
  for (const name of Object.keys(model['command-definitions'])) {
    const { succeeds, rejections } = playground.commandCoverageGaps(model, name);
    for (const owed of succeeds) gaps.push({ name, gap: `no scenario shows it ${playground.successOwedText(owed)}` });
    for (const message of rejections) gaps.push({ name, gap: `no scenario shows "${message}"` });
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
  const gaps = coverageGaps(playground, model);
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

// Words of the implementation a model replaces, inside a definition's
// name. A note rather than a problem: `VideoStreamAdded` can be the domain.
const IMPLEMENTATION_WORDS = ['Stream', 'Aggregate', 'Saga'];

function vocabularyNotes(model) {
  const notes = [];
  const kinds = [['event-definitions', 'event'], ['projection-definitions', 'projection'], ['command-definitions', 'command'], ['custom-type-definitions', 'type']];
  for (const [kind, label] of kinds) {
    for (const name of Object.keys(model[kind] || {})) {
      const word = (name.match(/\p{Lu}[^\p{Lu}]*/gu) || []).find((part) => IMPLEMENTATION_WORDS.includes(part));
      if (word) notes.push(`${label} ${name}: "${word}" names an implementation concept; name what the fact means`);
    }
  }
  return notes;
}

// The tag types a query item names: its tags are rendered through each
// type's tagSchema, so a type is known by the text around the value.
function itemTagTypes(playground, model, item) {
  const types = Object.keys(model['custom-type-definitions'] || {}).filter((name) => model['custom-type-definitions'][name].isTag);
  return item.tags.map((tag) => types.find((name) => {
    const [before, after] = playground.renderTag(playground.identifierTypeOf(model, name), '\u0000').split('\u0000');
    return tag.startsWith(before) && tag.endsWith(after);
  }) || tag);
}

// B can invalidate A when B appends an event A's boundary selects: of a
// type A reads, carrying every tag type of that read. Whether the two
// meet depends on the tag values they run with.
function conflictLines(playground, model) {
  const commands = Object.entries(model['command-definitions']);
  const lines = [];
  for (const [name, body] of commands) {
    const items = playground.boundarySummary(model, body).items;
    const found = new Set();
    for (const [other, otherBody] of commands) {
      for (const eventName of new Set(playground.commandEmissions(otherBody).map((emission) => emission.name))) {
        const event = model['event-definitions'][eventName];
        if (!event) continue;
        const carried = new Set(playground.eventTagLeaves(model, event).map((leaf) => leaf.identifierType));
        for (const item of items) {
          if (item.types.length && !item.types.includes(eventName)) continue;
          const tagTypes = itemTagTypes(playground, model, item);
          if (tagTypes.every((type) => carried.has(type))) {
            found.add(`${other === name ? 'itself' : other} via ${eventName} [${tagTypes.join(', ') || 'no tag'}]`);
          }
        }
      }
    }
    lines.push(`${name}: ${found.size ? '' : 'nothing can invalidate it'}`.trimEnd());
    for (const line of [...found].sort()) lines.push(`  ${line}`);
  }
  return lines;
}

// One stored event as `{ type, data }`: a CloudEvent, or one wrapped the
// way EventSourcingDB's export wraps it, `data` possibly JSON in a string.
function exportedEvent(line) {
  let row = JSON.parse(line);
  if (row && row.type === 'row' && row.payload) row = row.payload;
  if (!row || typeof row.type !== 'string') return null;
  let data = row.data;
  if (typeof data === 'string') data = JSON.parse(data);
  return { type: row.type, data: data || {} };
}

// An exported type's name in the model: as it stands, or its last segment
// in PascalCase: `Wwwision.Courses:SeatsWereReserved`, `seats-were-reserved`.
function modelEventName(model, type, map) {
  if (map[type]) return map[type];
  const definitions = model['event-definitions'];
  if (definitions[type]) return type;
  const last = type.split(/[:./]/).pop();
  if (map[last]) return map[last];
  if (definitions[last]) return last;
  const pascal = last.split(/[-_]/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return map[pascal] || pascal;
}

// Why a value does not fit a property's declared type, or null. The type's
// own constraints count here: stored values, unlike scenario values, are real.
// A datetime or a duration is a string, whose time `replay` checks apart.
function valueProblem(model, property, value) {
  if (property.isList) return Array.isArray(value) ? null : 'not a list';
  const custom = (model['custom-type-definitions'] || {})[property.propertyType];
  const time = ['datetime', 'duration'].includes(property.propertyType);
  const schema = custom ? (custom.schema || {}) : { type: time ? 'string' : property.propertyType };
  const type = schema.type;
  const actual = Array.isArray(value) ? 'array' : typeof value;
  if (type === 'integer' ? !Number.isInteger(value) : (type && type !== actual)) return `not of type ${type}`;
  if (schema.minimum !== undefined && value < schema.minimum) return `below ${schema.minimum}`;
  if (schema.maximum !== undefined && value > schema.maximum) return `above ${schema.maximum}`;
  if (schema.minLength !== undefined && value.length < schema.minLength) return `shorter than ${schema.minLength}`;
  if (schema.maxLength !== undefined && value.length > schema.maxLength) return `longer than ${schema.maxLength}`;
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return `does not match ${schema.pattern}`;
  if (schema.enum !== undefined && !schema.enum.includes(value)) return 'not in its enum';
  return null;
}

function replay(playground, model, exportFile, map, reads) {
  const definitions = model['event-definitions'];
  const counts = {};
  const unknown = {};
  const mismatches = {};
  const mismatch = (text) => { mismatches[text] = (mismatches[text] || 0) + 1; };
  const events = [];
  let unreadable = 0;
  for (const line of fs.readFileSync(exportFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let exported = null;
    try { exported = exportedEvent(line); } catch { /* counted below */ }
    if (!exported) { unreadable++; continue; }
    const name = modelEventName(model, exported.type, map);
    const definition = definitions[name];
    if (!definition) { unknown[exported.type] = (unknown[exported.type] || 0) + 1; continue; }
    counts[name] = (counts[name] || 0) + 1;
    events.push({ type: name, data: exported.data });
    const declared = new Set((definition.properties || []).map((property) => property.name));
    for (const field of Object.keys(exported.data)) {
      if (!declared.has(field)) mismatch(`${name}.${field}: not in the model`);
    }
    for (const property of definition.properties || []) {
      const value = exported.data[property.name];
      if (value === undefined || value === null) {
        if (!property.isOptional) mismatch(`${name}.${property.name}: required, but ${value === null ? 'null' : 'missing'}`);
        continue;
      }
      const problem = valueProblem(model, property, value);
      if (problem) mismatch(`${name}.${property.name}: ${problem}`);
    }
    // A datetime without its offset names no instant; a duration is ISO
    // 8601 in days, hours, minutes and seconds (11.0).
    for (const { name: field, problem } of playground.payloadTimeProblems(model, definition.properties, exported.data)) {
      mismatch(`${name}.${field}: ${problem.replace(/"[^"]*"/, 'a value')}`);
    }
  }
  const out = [`${events.length} event(s) of ${Object.keys(counts).length} model type(s)`];
  const section = (title, entries) => {
    if (entries.length) out.push('', title, ...entries.map(([text, count]) => `  ${text}${count === undefined ? '' : ` (${count})`}`));
  };
  section('Types not in the model:', Object.entries(unknown));
  section('Fields that disagree:', Object.entries(mismatches));
  section('Model events not in the export:', Object.keys(definitions).filter((name) => !counts[name]).map((name) => [name]));
  if (unreadable) out.push('', `${unreadable} line(s) unreadable`);
  const reported = reads.length ? ['', 'Reads:'] : [];
  for (const spec of reads) {
    const [projection, values = ''] = spec.split(/=(.*)/s);
    const definition = model['projection-definitions'][projection];
    if (!definition) { reported.push(`  ${spec}: no such projection`); continue; }
    const params = playground.projectionTagParams(definition);
    const given = values ? values.split(',') : [];
    if (given.length !== params.length) { reported.push(`  ${spec}: needs ${params.length} tag value(s)`); continue; }
    const tags = Object.fromEntries(params.map((param, at) => [param.name, given[at]]));
    reported.push(`  ${spec}: ${JSON.stringify(playground.foldProjection(model, events, projection, { tags }))}`);
  }
  console.log([...out, ...reported].join('\n'));
  return Object.keys(unknown).length || Object.keys(mismatches).length || unreadable ? 1 : 0;
}

// Takes each `--name value` out of the arguments.
function takeOption(args, name) {
  const values = [];
  for (let at = args.indexOf(name); at >= 0; at = args.indexOf(name)) values.push(args.splice(at, 2)[1] || '');
  return values;
}

function main() {
  const args = process.argv.slice(2);
  const reads = takeOption(args, '--read');
  const map = Object.fromEntries(takeOption(args, '--map').flatMap((pairs) => pairs.split(',')).map((pair) => pair.split('=')));
  const coverAt = args.indexOf('--cover');
  const cover = coverAt < 0 ? null : (args.splice(coverAt, 2)[1] || '').split(',').filter(Boolean);
  const [verb, file, ...rest] = args;
  const replaying = verb === 'replay';
  if (!['check', 'print', 'json', 'link', 'conflicts', 'replay'].includes(verb) || !file || rest.length !== (replaying ? 1 : 0) || (cover && !cover.length)) {
    console.error('usage: dcb.js check <file> [--cover Command,…] | print|json|link|conflicts <file> | replay <file> <export> [--map Old=New,…] [--read Projection=value,…]');
    return 2;
  }
  const playground = loadPlayground(fs.readFileSync(file, 'utf8'));
  const loaded = load(playground, file);
  const { model, sandboxSteps } = loaded;
  if (!model) {
    console.error(loaded.problems.join('\n'));
    return 1;
  }
  if (verb !== 'check' && loaded.problems.length) console.error(loaded.problems.join('\n'));
  if (verb === 'conflicts') {
    console.log(conflictLines(playground, model).join('\n'));
  } else if (replaying) {
    return replay(playground, model, rest[0], map, reads);
  } else if (verb === 'print') {
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
    const notes = vocabularyNotes(model);
    if (notes.length) console.log('Worth a look:\n' + notes.map((note) => `  ${note}`).join('\n') + '\n');
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
