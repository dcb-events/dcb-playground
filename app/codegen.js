// ============================================================
// DCB Playground — code export (experimental).
//
// Turns a model into implementation source someone can take away: the
// decision each command makes against a DCB-capable event store, the
// projections it folds, and the model's scenarios as tests. No DOM, no
// localStorage; `generateCode(model, options)` in, text out.
//
// **Two halves: a plan, then a printer.** `codePlan` reads the model
// once and decides everything that is semantics — which reads a command
// makes and in which query round, what each rule compares, which
// emissions a guard skips, what is not exportable and why. A printer
// (`CODE_TARGETS`) only spells that plan in one language. A second
// language is a second printer, and cannot disagree with the first
// about what a model means.
//
// **A third copy of the semantics, held to the first.** The evaluator
// (evaluate.js) deliberately compiles to closures and never emits
// source; this file is the exception it does not make for itself — an
// export, never run by the playground. What keeps it honest is
// codegen.test.js: every scenario of every shipped model and fixture,
// run through the generated code and through `runScenario`, must agree.
// A semantic change in evaluate.js that is not mirrored here fails
// there.
//
// **What cannot be translated says so.** A construct the plan does not
// cover yet — entities, a fan-out over a fan-out, a scripted projection
// for a target that cannot run JavaScript — makes
// its definition a stub that throws `NotExported` with the reason, and
// the generated file's header lists every stub. Nothing is approximated:
// a stub fails loudly where a guess would fail wrongly.
//
// **Faithful where it is cheap, not where it is not.** The generated
// code reads eagerly, one store query per round; the evaluator folds an
// inline read lazily, where a rule first needs it. The two agree on
// every outcome except an *error* in a read no earlier rule reached —
// the generated code raises it, the evaluator never got there.
// ============================================================

// Thrown while planning when a definition uses something this export
// does not translate; caught per definition and turned into a stub.
class CodeUnsupported extends Error {}

function codeUnsupported(reason) {
  throw new CodeUnsupported(reason);
}

const CODE_DEFAULT_TAG_SCHEMA = '{type}:{value}';

// ============================================================
// The plan.
//
// Plain data, language-neutral. Expressions are small trees:
//   { k: 'lit', value }                 a literal, already normalized
//   { k: 'arg', name, property? }       a command argument
//   { k: 'read', name }                 the value of a command's read
//   { k: 'eventProperty', name }        a handler's event payload field
//   { k: 'state' }                      a handler's current value
//   { k: 'successor', of }              the next identifier after `of`
//   { k: 'tag', name }                  a derived projection's own tag
// ============================================================

function codePlan(model, options = {}) {
  const stubs = [];
  const plan = {
    name: model.name || 'Untitled model',
    types: codePlanTypes(model),
    events: codePlanEvents(model),
    tagSchemas: codePlanTagSchemas(model),
    projections: [],
    commands: [],
    commandScenarios: [],
    projectionScenarios: [],
    sandboxSteps: (options.sandboxSteps || []).map((step) => ({
      command: step.command,
      args: evNormalize(step.args || {}),
    })),
    stubs,
  };

  const projections = model['projection-definitions'] || {};
  for (const [name, body] of Object.entries(projections)) {
    try {
      plan.projections.push(codePlanProjection(model, name, body, !!options.scripts));
    } catch (error) {
      if (!(error instanceof CodeUnsupported)) throw error;
      plan.projections.push({ kind: 'stub', name, reason: error.message });
      stubs.push({ kind: 'projection', name, reason: error.message });
    }
  }
  // A derived projection over a stubbed one is stubbed too, until
  // nothing more falls.
  for (let changed = true; changed;) {
    changed = false;
    for (const [i, p] of plan.projections.entries()) {
      if (p.kind !== 'derived') continue;
      const gone = [p.left, p.right].find((o) => o.k === 'projectionRead'
        && plan.projections.some((q) => q.name === o.projection && q.kind === 'stub'));
      if (!gone) continue;
      const reason = `it reads ${gone.projection}, which is not exported`;
      plan.projections[i] = { kind: 'stub', name: p.name, reason };
      stubs.push({ kind: 'projection', name: p.name, reason });
      changed = true;
    }
  }
  const stubbed = new Set(stubs.map((s) => s.name));

  for (const [name, body] of Object.entries(model['command-definitions'] || {})) {
    try {
      plan.commands.push(codePlanCommand(model, name, body, stubbed));
    } catch (error) {
      if (!(error instanceof CodeUnsupported)) throw error;
      plan.commands.push({ kind: 'stub', name, reason: error.message });
      stubs.push({ kind: 'command', name, reason: error.message });
    }
  }

  if (options.includeTests) {
    const stubReason = (kind, name) => {
      const stub = stubs.find((s) => s.kind === kind && s.name === name);
      return stub ? `${name} is not exported: ${stub.reason}` : null;
    };
    for (const scenario of Object.values(model['scenario-definitions'] || {})) {
      if (!scenario) continue;
      plan.commandScenarios.push({
        name: scenarioName(scenario),
        command: scenario.command,
        given: codeGivenEvents(scenario),
        args: evNormalize((scenario.when || {}).arguments || {}),
        then: scenario.then ? evNormalize(scenario.then) : null,
        skip: !(model['command-definitions'] || {})[scenario.command]
          ? `the model defines no command "${scenario.command}"`
          : stubReason('command', scenario.command),
      });
    }
    for (const scenario of Object.values(model['projection-scenario-definitions'] || {})) {
      if (!scenario) continue;
      const tags = {};
      for (const [name, tag] of Object.entries(scenario.tags || {})) tags[name] = evNormalize(tag && tag.tagValue);
      plan.projectionScenarios.push({
        name: projectionScenarioName(scenario),
        projection: scenario.projection,
        given: codeGivenEvents(scenario),
        tags,
        args: evNormalize(scenario.arguments || {}),
        then: 'then' in scenario ? evNormalize(scenario.then) : undefined,
        skip: !projections[scenario.projection]
          ? `the model defines no projection "${scenario.projection}"`
          : stubReason('projection', scenario.projection),
      });
    }
  }
  return plan;
}

function codeGivenEvents(scenario) {
  return (scenario.given || []).filter(Boolean).map((step) => ({
    type: step.event,
    data: evNormalize(step.data || {}),
  }));
}

// A property's or field's type, as `{ type, isList, isOptional }`.
function codeTypeRef(property) {
  return {
    type: property.propertyType,
    isList: !!property.isList,
    isOptional: !!property.isOptional,
  };
}

function codePlanTypes(model) {
  return Object.entries(model['custom-type-definitions'] || {}).map(([name, body]) => {
    if (body && Array.isArray(body.properties)) {
      return { name, kind: 'record', fields: body.properties.filter(Boolean).map((f) => ({ name: f.name, ...codeTypeRef(f) })) };
    }
    const members = enumMembersFor(model, name);
    if (members) return { name, kind: 'enum', members };
    return { name, kind: 'scalar', base: literalKindOf(model, name) };
  });
}

// Every tag type whose tag is written other than `{type}:{value}`.
function codePlanTagSchemas(model) {
  const out = {};
  for (const name of Object.keys(model['custom-type-definitions'] || {})) {
    const identifier = identifierTypeOf(model, name);
    if (identifier && identifier.tagSchema !== CODE_DEFAULT_TAG_SCHEMA) out[name] = identifier.tagSchema;
  }
  return out;
}

function codePlanEvents(model) {
  return Object.entries(model['event-definitions'] || {}).map(([name, body]) => {
    const properties = ((body && body.properties) || []).filter(Boolean);
    return {
      name,
      properties: properties.map((p) => ({ name: p.name, ...codeTypeRef(p) })),
      tags: eventTagLeaves(model, body).map((leaf) => ({
        tagType: leaf.identifierType,
        property: leaf.property,
        field: leaf.field,
        isList: leaf.isList,
      })),
      // Folded with an explicit null when unset — `evWithExplicitOptionals`.
      optional: properties.filter((p) => p.isOptional && !p.isList).map((p) => p.name),
    };
  });
}

// A projection's declared tags, each with the leaves it renders to: one
// for a scalar tag type, one per tag-marked field of a record.
function codeProjectionTags(model, name, body) {
  return projectionTagParams(body).map((tag) => {
    const leaves = idLeavesOfType(model, tag.tagType);
    if (!leaves.length) codeUnsupported(`its "${tag.name}" tag is a ${tag.tagType}, which is no tag type`);
    return { name: tag.name, leaves: leaves.map((leaf) => ({ tagType: leaf.identifierType, field: leaf.field })) };
  });
}

function codePlanProjection(model, name, body, scripts) {
  const script = scriptOf(body);
  if (script) return codePlanScript(model, name, body, script, scripts);
  const derived = derivedOf(body);
  if (derived) return codePlanDerived(model, name, body, derived);

  const tags = codeProjectionTags(model, name, body);
  // One step per event type, the last handler for a type winning — the
  // evaluator's `steps` map, in its order.
  const steps = new Map();
  for (const handler of body.handlers || []) {
    if (!handler || !handler.event) continue;
    if (!['set', 'increment', 'decrement', 'append', 'remove'].includes(handler.operation)) {
      codeUnsupported(`the handler for ${handler.event} has no operation this can run`);
    }
    steps.set(handler.event, { event: handler.event, operation: handler.operation, value: codeHandlerExpr(handler.value) });
  }
  return {
    kind: 'fold',
    name,
    tags,
    initial: evNormalize(body.initialValue === undefined ? defaultInitialValue(model, body) : body.initialValue),
    handlers: [...steps.values()],
  };
}

// A scripted projection's handlers are JavaScript expressions, taken
// verbatim by a target that runs JavaScript — `scripts` says whether
// this one does — under the contract the evaluator compiles them to:
// `(state, event, args, tags) => nextState`.
function codePlanScript(model, name, body, script, scripts) {
  if (!scripts) codeUnsupported('its handlers are JavaScript, which this language cannot run');
  const handlers = new Map();
  for (const handler of body.handlers || []) {
    if (!handler || !handler.event) continue;
    if (handler.code === undefined) codeUnsupported(`its handler for ${handler.event} has no script`);
    handlers.set(handler.event, { event: handler.event, code: String(handler.code) });
  }
  return {
    kind: 'script',
    name,
    tags: codeProjectionTags(model, name, body),
    initial: script.initialState ?? null,
    exposes: script.exposes === undefined ? null : script.exposes,
    handlers: [...handlers.values()],
  };
}

function codeHandlerExpr(operand) {
  switch (operandSource(operand)) {
    case 'event-property': return { k: 'eventProperty', name: operand.eventProperty };
    case 'current-value': return { k: 'state' };
    case 'successor': return { k: 'successor', of: codeHandlerExpr(operand.successor) };
    case 'enum-member': return { k: 'lit', value: operand.enumMember };
    default: return { k: 'lit', value: evNormalize(operand) };
  }
}

// A derived projection is two operands and what is made of them; each
// operand reads a projection by tags of this one's own, or literals.
function codePlanDerived(model, name, body, derived) {
  const projections = model['projection-definitions'];
  const reaches = (from, seen) => {
    const target = projections[from];
    const inner = target && derivedOf(target);
    if (!inner) return false;
    return derivedOperands(inner).some((operand) => operandSource(operand) === 'projection-read'
      && (operand.projection === name || (!seen.includes(operand.projection) && reaches(operand.projection, [...seen, from]))));
  };
  if (reaches(name, [])) codeUnsupported('it derives from itself — a cycle has no value to start from');

  const operand = (value) => {
    if (operandSource(value) !== 'projection-read') return { k: 'lit', value: evNormalize(value) };
    const target = projections[value.projection];
    if (!target) codeUnsupported(`it reads "${value.projection}", which this model does not define`);
    const held = Object.fromEntries(readTagEntries(value));
    return {
      k: 'projectionRead',
      projection: value.projection,
      args: Object.entries(value.arguments || {}).map(([argName, arg]) => ({ name: argName, value: { k: 'lit', value: evNormalize(arg) } })),
      tags: projectionTagParams(target).map((tag) => {
        const given = held[tag.name];
        let expr;
        if (operandSource(given) === 'parameter') expr = { k: 'tag', name: given.parameterName };
        else if (operandSource(given) === 'tag-literal') expr = { k: 'lit', value: given.tagValue };
        else expr = { k: 'lit', value: evNormalize(given) };
        return { name: tag.name, value: expr };
      }),
    };
  };

  const computes = derivedComputes(derived);
  if (computes && !['add', 'subtract', 'multiply', 'min', 'max'].includes(derived.operator)) {
    codeUnsupported(`"${derived.operator}" is not an operator this can compute`);
  }
  if (!computes) codeCheckPredicate(derived.predicate);
  return {
    kind: 'derived',
    name,
    tags: codeProjectionTags(model, name, body),
    left: operand(derived.leftHandSide),
    right: operand(derived.rightHandSide),
    ...(computes
      ? { operator: derived.operator }
      : { predicate: derived.predicate, negate: !!derived.negate }),
  };
}

const CODE_PREDICATES = [
  'isEmpty', 'isNotEmpty', 'isTrue', 'isFalse', 'equals', 'equalsAny',
  'countEquals', 'countLessThan', 'countGreaterThan', 'contains', 'containsAny',
  'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals', 'startsWith', 'endsWith',
];

function codeCheckPredicate(predicate) {
  if (!CODE_PREDICATES.includes(predicate)) codeUnsupported(`"${predicate}" is not a predicate this can check`);
}

// A command: its arguments, the reads it makes in rounds, its rules in
// order, and its emissions — each read named once, the way the
// evaluator folds an inline read once per spelling.
function codePlanCommand(model, name, body, stubbedProjections) {
  const projections = model['projection-definitions'] || {};
  const params = (body.properties || []).filter(Boolean).map((p) => ({
    name: p.name,
    ...codeTypeRef(p),
    // An absent optional (non-list) argument reads as null; any other
    // absent one is an error — `evaluateCommand`.
    defaultsToNull: !!p.isOptional && !p.isList,
  }));
  const paramNames = new Set(params.map((p) => p.name));

  const rounds = deriveRounds(body);
  const roundOf = new Map(rounds.flatMap((round, r) => round.map((entry) => [entry.binding.alias, r + 1])));
  const reads = [];
  const aliases = new Map();
  const inline = new Map();

  const compileRead = (read, label, alias) => {
    const target = projections[read.projection];
    if (!target) codeUnsupported(`${label} reads "${read.projection}", which this model does not define`);
    if (stubbedProjections.has(read.projection)) codeUnsupported(`${label} reads ${read.projection}, which is not exported`);
    const held = (read.tags && typeof read.tags === 'object' && !Array.isArray(read.tags)) ? read.tags : {};
    const tags = projectionTagParams(target).map((tag) => {
      const operand = evOwn(held, tag.name);
      if (operand === undefined) codeUnsupported(`${label} gives no value for ${read.projection}'s "${tag.name}" tag`);
      if (operandSource(operand) === 'each') {
        const over = operand.each;
        if (operandSource(over) === 'alias-property' && aliases.has(over.alias) && aliases.get(over.alias).fan) {
          codeUnsupported(`${label} fans out over ${operandText(over)}, itself fanned out — not exported yet`);
        }
        return { name: tag.name, each: expr(over) };
      }
      const resolved = tagOperandType(model, body, operand);
      if (resolved && resolved.propertyType !== tag.tagType) {
        codeUnsupported(`${label} is tagged by ${operandText(operand)}, a ${resolved.propertyType} — `
          + `but ${read.projection}'s "${tag.name}" tag is a ${tag.tagType}`);
      }
      if (resolved && resolved.isList) codeUnsupported(`${label} is tagged by ${operandText(operand)}, a list`);
      const value = operandSource(operand) === 'tag-literal' ? { k: 'lit', value: operand.tagValue } : expr(operand);
      return { name: tag.name, value };
    });
    const args = Object.entries(read.arguments || {}).map(([argName, operand]) => ({ name: argName, value: expr(operand) }));
    const round = alias ? roundOf.get(alias) : operandDepth(read, roundOf);
    const entry = { name: alias || null, projection: read.projection, tags, args, round, label, fan: tags.some((t) => t.each) };
    reads.push(entry);
    return entry;
  };

  const expr = (operand) => {
    if (Array.isArray(operand)) return { k: 'lit', value: operand.map(evNormalize) };
    switch (operandSource(operand)) {
      case 'parameter':
        if (!paramNames.has(operand.parameterName)) {
          codeUnsupported(`it reads "${operand.parameterName}", which is none of its arguments`);
        }
        return { k: 'arg', name: operand.parameterName, ...(operand.property ? { property: operand.property } : {}) };
      case 'alias-property': {
        const bound = aliases.get(operand.alias);
        if (!bound) codeUnsupported(`nothing in its boundary is bound as "${operand.alias}"`);
        if (operand.property) codeUnsupported(`"${operand.alias}" reads a projection, which holds one value and has no properties`);
        // Read whole, a fanned alias is one value per element, a list
        // of lists flattened — `evReadOperand`.
        return bound.fan ? { k: 'read', read: bound, flatten: true } : { k: 'read', read: bound };
      }
      case 'enum-member': return { k: 'lit', value: operand.enumMember };
      case 'projection-read': {
        const key = JSON.stringify(canonicalOperand(operand));
        if (!inline.has(key)) inline.set(key, compileRead(operand, `"${operandText(operand)}"`, null));
        return { k: 'read', read: inline.get(key) };
      }
      case 'each': return codeUnsupported('it fans out over a list (each), which is not exported yet');
      default: return { k: 'lit', value: evNormalize(operand) };
    }
  };

  for (const round of rounds) {
    for (const { binding } of round) {
      if (!binding.projection) codeUnsupported(`it reads entity ${binding.entity} — entities are not exported yet`);
      aliases.set(binding.alias, compileRead(binding, `Binding "${binding.alias}"`, binding.alias));
    }
  }

  // A condition over a fanned read holds when it holds for every
  // instance, a list parameter fanned from the same list read at the
  // same index (`evCheckCondition`, `isZipped`).
  const condition = (c) => {
    codeCheckPredicate(c.predicate);
    const quantified = [];
    const side = (operand) => {
      if (operand === undefined) return null;
      const compiled = expr(operand);
      if (compiled.k === 'read' && compiled.read.fan) {
        if (!quantified.includes(compiled.read)) quantified.push(compiled.read);
        return { k: 'readAt', read: compiled.read };
      }
      if (compiled.k === 'arg' && isZipped(model, body, c, operand)) return { ...compiled, k: 'argAt' };
      return compiled;
    };
    const left = side(c.leftHandSide);
    const right = side(c.rightHandSide);
    return {
      predicate: c.predicate,
      negate: !!c.negate,
      left,
      right,
      quantified,
      text: conditionText(c),
    };
  };
  const rules = (body.conditions || []).filter(Boolean).map((c) => ({
    ...condition(c),
    rejection: c.rejection === undefined ? null : c.rejection,
  }));

  const emissions = (body.publishes || []).filter((e) => e && e.name).map((emission) => {
    const definition = (model['event-definitions'] || {})[emission.name];
    if (!definition) return { event: emission.name, error: `"${name}" publishes "${emission.name}", which this model does not define.` };
    const guards = (emission.when || []).filter(Boolean).map(condition);
    const data = [];
    for (const property of definition.properties || []) {
      const operand = evOwn(emission.parameters, property.name);
      if (operand === undefined) {
        if (property.isOptional && !property.isList) { data.push({ name: property.name, value: { k: 'lit', value: null } }); continue; }
        return { event: emission.name, guards, error: `"${name}" publishes "${emission.name}" without a value for "${property.name}".` };
      }
      data.push({ name: property.name, value: expr(operand) });
    }
    return { event: emission.name, guards, data };
  });

  // The rounds in the order they run; an inline read sits in the round
  // its depth says.
  const roundCount = Math.max(0, ...reads.map((r) => r.round));
  const byRound = [];
  for (let r = 1; r <= roundCount; r++) {
    const these = reads.filter((read) => read.round === r);
    if (these.length) byRound.push(these);
  }

  let boundary = null;
  try {
    const summary = boundarySummary(model, body);
    boundary = {
      words: summary.words,
      queries: summary.queries.map((items) => items.map((item) => ({
        label: item.alias || item.projection,
        types: item.types,
        tags: item.tags,
      }))),
    };
  } catch {
    boundary = null;
  }

  return { kind: 'command', name, params, rounds: byRound, rules, emissions, boundary };
}

// ============================================================
// Printers.
//
// One per target language, each `{ label, extension, print(plan,
// options) }` and what the interface asks of it: whether it can run a
// scripted handler, whether its in-memory store is an option, how its
// tests are run. Only the plan is read: a printer that needed the model
// would be deciding semantics.
// ============================================================

const CODE_TARGETS = {
  js: {
    label: 'JavaScript', extension: '.js', mediaType: 'text/javascript', runsScripts: true,
    // The in-memory store is the export's own and can be left out.
    adapterOption: true, testsRun: 'node --test on the file',
    print: (plan, options) => codePrintJs(plan, options),
  },
  php: {
    label: 'PHP', extension: '.php', mediaType: 'text/x-php', runsScripts: false,
    adapterOption: false, testsRun: 'php on the file',
    print: (plan, options) => codePrintPhp(plan, options),
  },
};

// The export: `{ text, extension, stubs }`. Options, all optional:
//   target          'js' or 'php'
//   includeTests    the model's scenarios as node:test tests
//   includeAdapter  the in-memory event store (JS; implied by tests)
//   docComments     each command's derived boundary, as a comment
//   sandboxSteps    `[{ command, args }]` to replay into a store
function generateCode(model, options = {}) {
  const target = CODE_TARGETS[options.target || 'js'];
  if (!target) throw new Error(`No code target "${options.target}".`);
  const plan = codePlan(model, { ...options, scripts: !!target.runsScripts });
  return { text: target.print(plan, options), extension: target.extension, mediaType: target.mediaType, stubs: plan.stubs };
}

// ============================================================
// The JavaScript printer.
// ============================================================

const CODE_JS_RESERVED = new Set((
  'break case catch class const continue debugger default delete do else enum export extends false finally for '
  + 'function if import in instanceof let new null return super switch this throw true try typeof var void while '
  + 'with yield await implements interface package private protected public static arguments eval undefined '
  + 'NaN Infinity Object Array String Number Boolean JSON Math BigInt Set Map Error Symbol Promise'
).split(' '));

// What the runtime defines at the top level of the generated file; a
// model's own name never takes one of these.
const CODE_JS_RUNTIME_NAMES = [
  'EvaluationError', 'NotExported', 'AppendConditionFailed', 'own', 'canonical', 'equals', 'asList', 'isEmpty',
  'number', 'increment', 'decrement', 'successor', 'append', 'remove', 'field', 'equalsAny', 'count', 'contains',
  'containsAny', 'ordered', 'lessThan', 'lessThanOrEquals', 'greaterThan', 'greaterThanOrEquals', 'startsWith',
  'endsWith', 'add', 'subtract', 'multiply', 'min', 'max', 'TAG_SCHEMAS', 'tag', 'EVENT_TAGS', 'tagsOf',
  'OPTIONAL_PROPERTIES', 'withOptionals', 'projection', 'derived', 'read', 'READ', 'notExported', 'decisionModel',
  'argument', 'event', 'projections', 'readEach', 'every', 'flat', 'each', 'i', 'commands', 'createApp', 'createInMemoryEventStore', 'sandboxSteps',
  'replaySandbox', 'store', 'scripted', 'freeze', 'args', 'decision', 'events', 'state', 't', 'left', 'right',
];

const CODE_JS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function codeJsIdentifier(wanted) {
  let name = String(wanted || '_').replace(/[^\w$]/g, '_');
  if (/^\d/.test(name)) name = '_' + name;
  return name;
}

// Names handed out within one scope: the wanted name, made an
// identifier, with `_` appended while it collides (Q7 of the design:
// verbatim, suffixed only when it must be).
function codeJsNamer(reserved) {
  const taken = new Set([...CODE_JS_RESERVED, ...reserved]);
  return (wanted) => {
    let name = codeJsIdentifier(wanted);
    while (taken.has(name)) name += '_';
    taken.add(name);
    return name;
  };
}

function codeJsString(text) {
  return "'" + JSON.stringify(String(text)).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'";
}

function codeJsKey(key) {
  return CODE_JS_IDENTIFIER.test(key) ? key : codeJsString(key);
}

function codeJsLiteral(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return codeJsString(value);
  if (Array.isArray(value)) return `[${value.map(codeJsLiteral).join(', ')}]`;
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{ ${entries.map(([k, v]) => `${codeJsKey(k)}: ${codeJsLiteral(v)}`).join(', ')} }`;
}

// `{ a, b: x }` — shorthand where the value is the key's own name.
function codeJsObject(entries) {
  if (!entries.length) return '{}';
  return `{ ${entries.map(([key, code]) => (code === key && CODE_JS_IDENTIFIER.test(key) ? key : `${codeJsKey(key)}: ${code}`)).join(', ')} }`;
}

function codeJsMember(object, key) {
  return CODE_JS_IDENTIFIER.test(key) ? `${object}.${key}` : `${object}[${codeJsString(key)}]`;
}

// A JSDoc type for a property.
function codeJsDocType(ref, typeNames) {
  const base = ref.type === 'integer' ? 'number'
    : ref.type === 'string' || ref.type === 'boolean' || ref.type === 'number' ? ref.type
    : typeNames.has(ref.type) ? ref.type : '*';
  const list = ref.isList ? `${base}[]` : base;
  return ref.isOptional && !ref.isList ? `${list} | null` : list;
}

function codeJsDocRecord(fields, typeNames) {
  if (!fields.length) return '{}';
  return `{ ${fields.map((f) => `${codeJsKey(f.name)}${f.isOptional && !f.isList ? '?' : ''}: ${codeJsDocType(f, typeNames)}`).join(', ')} }`;
}

// An expression's source. `scope` maps a read entry or an argument to
// its local name.
function codeJsExpr(expr, scope) {
  switch (expr.k) {
    case 'lit': return codeJsLiteral(expr.value);
    case 'arg': {
      const name = scope.args.get(expr.name);
      return expr.property ? `field(${name}, ${codeJsString(expr.property)})` : name;
    }
    case 'read': return expr.flatten ? `flat(${scope.reads.get(expr.read)})` : scope.reads.get(expr.read);
    case 'readAt': return `${scope.reads.get(expr.read)}[i]`;
    case 'argAt': return `asList(${codeJsExpr({ ...expr, k: 'arg' }, scope)})[i]`;
    case 'eventProperty': return codeJsMember('event.data', expr.name);
    case 'state': return 'state';
    case 'successor': return `successor(${codeJsExpr(expr.of, scope)})`;
    case 'tag': return codeJsMember('t', expr.name);
    default: throw new Error(`No JavaScript for expression "${expr.k}".`);
  }
}

// A predicate over two sources, as `{ code, atomic, inner? }` so that
// negating twice reads plainly and a call needs no parentheses.
function codeJsPredicate(predicate, l, r) {
  const call = (fn, ...a) => ({ code: `${fn}(${a.join(', ')})`, atomic: true });
  const op = (code) => ({ code, atomic: false });
  switch (predicate) {
    case 'isEmpty': return call('isEmpty', l);
    case 'isNotEmpty': return codeJsNot(call('isEmpty', l));
    case 'isTrue': return op(`${l} === true`);
    case 'isFalse': return op(`${l} === false`);
    case 'countEquals': return op(`count(${l}) === ${r}`);
    case 'countLessThan': return op(`count(${l}) < ${r}`);
    case 'countGreaterThan': return op(`count(${l}) > ${r}`);
    default: return call(predicate, l, r);
  }
}

function codeJsNot(e) {
  if (e.inner) return e.inner;
  return { code: e.atomic ? `!${e.code}` : `!(${e.code})`, atomic: true, inner: e };
}

function codeJsHeld(c, scope) {
  const l = codeJsExpr(c.left, scope);
  const r = c.right ? codeJsExpr(c.right, scope) : null;
  const base = codeJsPredicate(c.predicate, l, r);
  const held = c.negate ? codeJsNot(base) : base;
  if (!c.quantified || !c.quantified.length) return held;
  const lists = c.quantified.map((read) => scope.reads.get(read));
  return { code: `every([${lists.join(', ')}], (i) => ${held.code})`, atomic: true };
}

function codeJsComment(lines, indent = '') {
  return lines.map((line) => `${indent}//${line ? ' ' + line : ''}`).join('\n');
}

function codePrintJs(plan, options) {
  const withTests = !!options.includeTests;
  const withAdapter = withTests || options.includeAdapter !== false;
  const withDocs = options.docComments !== false;
  const out = [];
  const typeNames = new Set(plan.types.map((t) => t.name));

  // Top-level names: projections and nothing else of the model's.
  const topName = codeJsNamer(CODE_JS_RUNTIME_NAMES);
  const projectionVar = new Map(plan.projections.map((p) => [p.name, topName(p.name)]));

  out.push(codeJsHeader(plan, withAdapter, withTests));
  out.push(CODE_JS_PORT);
  out.push(CODE_JS_RUNTIME);

  // Types, for the reader and the editor; nothing checks them at run time.
  if (plan.types.length) {
    out.push(codeJsSection('Types'));
    for (const type of plan.types) {
      if (type.kind === 'enum') out.push(`/** @typedef {${type.members.map(codeJsLiteral).join(' | ')}} ${type.name} */`);
      else if (type.kind === 'record') out.push(`/** @typedef {${codeJsDocRecord(type.fields, typeNames)}} ${type.name} */`);
      else out.push(`/** @typedef {${type.base}} ${type.name} */`);
    }
  }

  out.push(codeJsSection('Events'));
  for (const event of plan.events) {
    out.push(`/** @typedef {${codeJsDocRecord(event.properties, typeNames)}} ${codeJsIdentifier(event.name)} */`);
  }
  out.push('');
  out.push(`const TAG_SCHEMAS = ${codeJsLiteral(plan.tagSchemas)};`);
  out.push('');
  out.push('// The tags each event carries, read off its payload when it is appended.');
  out.push('const EVENT_TAGS = {');
  for (const event of plan.events) {
    const leaves = event.tags.map((leaf) => codeJsLiteral({
      tagType: leaf.tagType, property: leaf.property,
      ...(leaf.field ? { field: leaf.field } : {}), ...(leaf.isList ? { isList: true } : {}),
    }));
    out.push(`  ${codeJsKey(event.name)}: [${leaves.join(', ')}],`);
  }
  out.push('};');
  out.push('');
  out.push('// Optional properties an event holds as an explicit null when unset.');
  const optional = plan.events.filter((e) => e.optional.length);
  out.push(`const OPTIONAL_PROPERTIES = ${optional.length ? codeJsLiteral(Object.fromEntries(optional.map((e) => [e.name, e.optional]))) : '{}'};`);

  out.push(codeJsSection('Projections'));
  for (const p of plan.projections) {
    out.push(codeJsProjection(p, projectionVar));
    out.push('');
  }
  out.push('export const projections = ' + codeJsObject(plan.projections.map((p) => [p.name, projectionVar.get(p.name)])) + ';');

  out.push(codeJsSection('Commands'));
  out.push([
    '// Each decides against the store and returns what it decided — nothing',
    '// is appended here (`createApp().handle` does that):',
    '//   { published: Event[], appendCondition }   the command was accepted',
    '//   { rejected: string }                      a rule refused it',
    '// Anything that cannot be decided at all throws an EvaluationError.',
  ].join('\n'));
  out.push('export const commands = {');
  for (const command of plan.commands) out.push(codeJsCommand(command, projectionVar, withDocs, typeNames));
  out.push('};');

  out.push(CODE_JS_APP);
  if (withAdapter) out.push(CODE_JS_IN_MEMORY);
  if (plan.sandboxSteps.length) out.push(codeJsSandbox(plan));
  if (withTests) out.push(codeJsTests(plan));
  return out.join('\n') + '\n';
}

function codeJsSection(title) {
  return `\n// ---- ${title} ${'-'.repeat(Math.max(4, 66 - title.length))}\n`;
}

function codeJsHeader(plan, withAdapter, withTests) {
  const lines = [
    '='.repeat(60),
    `${plan.name} — exported from the DCB Playground as JavaScript.`,
    '',
    'Experimental, and generated: change the model and export again rather',
    'than editing this. One ES module, no dependencies. Each command decides',
    'against a DCB-capable event store (the EventStore port below) and',
    'appends what it publishes under the append condition its reads made:',
    'every query it ran, ORed.',
    '',
    'Usage:',
    withAdapter
      ? '  const app = createApp(createInMemoryEventStore());'
      : '  const app = createApp(yourEventStore);',
    "  await app.handle('<Command>', { ...arguments });  // { published } or { rejected }",
    "  await app.project('<Projection>', { ...tags });     // its current value",
  ];
  if (withTests) lines.push('', 'Run the model\'s scenarios as tests with `node --test <this file>`', '(Node 24 or later).');
  lines.push(
    '',
    'An append whose condition fails throws AppendConditionFailed: someone',
    'else wrote into this decision\'s boundary first. Deciding again on the',
    'new state is usually right, and left to the caller:',
    '  for (let attempt = 1; ; attempt++) {',
    '    try { return await app.handle(command, args); }',
    '    catch (e) { if (!(e instanceof AppendConditionFailed) || attempt === 3) throw e; }',
    '  }',
  );
  if (plan.stubs.length) {
    lines.push('', 'Not exported — each throws NotExported when used:');
    for (const stub of plan.stubs) lines.push(`  - ${stub.kind} ${stub.name}: ${stub.reason}`);
  }
  lines.push('='.repeat(60));
  return codeJsComment(lines);
}

function codeJsProjection(p, projectionVar) {
  const v = projectionVar.get(p.name);
  if (p.kind === 'stub') {
    return `const ${v} = notExported(${codeJsString(`projection ${p.name}`)}, ${codeJsString(p.reason)});`;
  }
  const tagList = p.tags.flatMap((tag) => tag.leaves.map((leaf) =>
    `tag(${codeJsString(leaf.tagType)}, ${codeJsMember('t', tag.name)}, ${codeJsString(`${p.name}'s "${tag.name}" tag`)}`
    + `${leaf.field ? ', ' + codeJsString(leaf.field) : ''})`));
  const tags = `(t) => [${tagList.join(', ')}]`;
  const lines = [];
  if (p.kind === 'script') {
    lines.push(`const ${v} = scripted({`);
    lines.push(`  name: ${codeJsString(p.name)},`);
    lines.push(`  tags: ${tags},`);
    lines.push(`  initialState: ${codeJsLiteral(p.initial)},`);
    if (p.exposes !== null) lines.push(`  exposes: ${codeJsString(p.exposes)},`);
    lines.push('  // The model\'s own scripts, verbatim.');
    lines.push('  when: {');
    for (const h of p.handlers) {
      const code = h.code.includes('\n') ? h.code.split('\n').join('\n      ') : h.code;
      lines.push(`    ${codeJsKey(h.event)}: (state, event, args, tags) => (${code}),`);
    }
    lines.push('  },');
    lines.push('});');
    return lines.join('\n');
  }
  if (p.kind === 'fold') {
    lines.push(`const ${v} = projection({`);
    lines.push(`  name: ${codeJsString(p.name)},`);
    lines.push(`  tags: ${tags},`);
    lines.push(`  initialState: ${codeJsLiteral(p.initial)},`);
    lines.push('  when: {');
    for (const h of p.handlers) {
      const value = codeJsExpr(h.value, null);
      const body = h.operation === 'set' ? value : `${h.operation}(state, ${value})`;
      lines.push(`    ${codeJsKey(h.event)}: (state, event) => ${body},`);
    }
    lines.push('  },');
    lines.push('});');
    return lines.join('\n');
  }
  const operand = (o) => (o.k === 'projectionRead'
    ? `read(${projectionVar.get(o.projection)}, ${codeJsObject(o.tags.map((tag) => [tag.name, codeJsExpr(tag.value, null)]))}`
      + `${o.args.length ? ', ' + codeJsObject(o.args.map((a) => [a.name, codeJsExpr(a.value, null)])) : ''})`
    : codeJsExpr(o, null));
  lines.push(`const ${v} = derived({`);
  lines.push(`  name: ${codeJsString(p.name)},`);
  lines.push(`  tags: ${tags},`);
  lines.push(`  operands: (t) => [${operand(p.left)}, ${operand(p.right)}],`);
  lines.push(`  value: (left, right) => ${p.operator ? `${p.operator}(left, right)` : codeJsDerivedHeld(p)},`);
  lines.push('});');
  return lines.join('\n');
}

function codeJsDerivedHeld(p) {
  const base = codeJsPredicate(p.predicate, 'left', 'right');
  return (p.negate ? codeJsNot(base) : base).code;
}

function codeJsCommand(command, projectionVar, withDocs, typeNames) {
  const lines = [];
  const ind = '    ';
  if (command.kind === 'stub') {
    lines.push(`  // Not exported: ${command.reason}`);
    lines.push(`  async ${codeJsKey(command.name)}() {`);
    lines.push(`    throw new NotExported(${codeJsString(`command ${command.name}`)}, ${codeJsString(command.reason)});`);
    lines.push('  },');
    return lines.join('\n');
  }

  const local = codeJsNamer(CODE_JS_RUNTIME_NAMES);
  const scope = { args: new Map(), reads: new Map() };
  for (const param of command.params) scope.args.set(param.name, local(param.name));
  for (const round of command.rounds) {
    for (const read of round) {
      scope.reads.set(read, local(read.name || read.projection.charAt(0).toLowerCase() + read.projection.slice(1)));
    }
  }

  const doc = [];
  if (withDocs && command.boundary) {
    doc.push(`${command.name} — ${command.boundary.words}.`);
    command.boundary.queries.forEach((items, i) => {
      if (command.boundary.queries.length > 1) doc.push(`Query ${i + 1}:`);
      for (const item of items) {
        doc.push(`  ${item.label}: ${item.types.length ? item.types.join(', ') : 'any type'}`
          + `${item.tags.length ? ` tagged ${item.tags.join(' & ')}` : ''}`);
      }
    });
  }
  doc.push('@param {EventStore} store');
  doc.push(`@param {${codeJsDocRecord(command.params, typeNames)}} args`);
  doc.push('@returns {Promise<Decision>}');
  lines.push('  /**');
  for (const line of doc) lines.push(`   * ${line}`.trimEnd());
  lines.push('   */');
  lines.push(`  async ${codeJsKey(command.name)}(store, args) {`);

  for (const param of command.params) {
    const fn = param.defaultsToNull ? 'argument(args, ' + codeJsString(param.name) + ', null)'
      : `argument(args, ${codeJsString(param.name)}, ${codeJsString(command.name)})`;
    lines.push(`${ind}const ${scope.args.get(param.name)} = ${fn};`);
  }
  if (command.rounds.length) lines.push(`${ind}const decision = decisionModel(store);`);
  for (const round of command.rounds) {
    const names = round.map((read) => scope.reads.get(read));
    lines.push(`${ind}const { ${names.join(', ')} } = await decision.read({`);
    for (const read of round) {
      const fanned = read.tags.find((tag) => tag.each);
      const tags = codeJsObject(read.tags.map((tag) => [tag.name, tag.each ? 'each' : codeJsExpr(tag.value, scope)]));
      const args = read.args.length ? ', ' + codeJsObject(read.args.map((a) => [a.name, codeJsExpr(a.value, scope)])) : '';
      const call = fanned
        ? `readEach(${projectionVar.get(read.projection)}, ${codeJsExpr(fanned.each, scope)}, (each) => (${tags})${args})`
        : `read(${projectionVar.get(read.projection)}, ${tags}${args})`;
      lines.push(`${ind}  ${scope.reads.get(read)}: ${call},`);
    }
    lines.push(`${ind}});`);
  }

  for (const rule of command.rules) {
    const failing = codeJsNot(codeJsHeld(rule, scope));
    lines.push(`${ind}if (${failing.code}) return { rejected: ${rule.rejection === null ? 'null' : codeJsString(rule.rejection)} };`);
  }

  lines.push(`${ind}const events = [];`);
  for (const emission of command.emissions) {
    if (emission.error && !emission.guards) {
      lines.push(`${ind}throw new EvaluationError(${codeJsString(emission.error)});`);
      continue;
    }
    const push = emission.error
      ? `throw new EvaluationError(${codeJsString(emission.error)});`
      : `events.push(event(${codeJsString(emission.event)}, ${codeJsObject(emission.data.map((d) => [d.name, codeJsExpr(d.value, scope)]))}));`;
    if (!emission.guards.length) { lines.push(`${ind}${push}`); continue; }
    const guard = emission.guards.map((g) => {
      const held = codeJsHeld(g, scope);
      return emission.guards.length > 1 && !held.atomic ? `(${held.code})` : held.code;
    }).join(' && ');
    lines.push(`${ind}if (${guard}) ${push}`);
  }
  lines.push(`${ind}return { published: events, appendCondition: ${command.rounds.length ? 'decision.appendCondition()' : 'undefined'} };`);
  lines.push('  },');
  return lines.join('\n');
}

function codeJsSandbox(plan) {
  return [
    codeJsSection('Sandbox'),
    '// The steps the playground\'s sandbox ran, in order — replay them into a',
    '// store to start from the same state: `await replaySandbox(app)`.',
    'export const sandboxSteps = [',
    ...plan.sandboxSteps.map((step) => `  { command: ${codeJsString(step.command)}, args: ${codeJsLiteral(step.args)} },`),
    '];',
    '',
    'export async function replaySandbox(app) {',
    '  const outcomes = [];',
    '  for (const step of sandboxSteps) outcomes.push(await app.handle(step.command, step.args));',
    '  return outcomes;',
    '}',
  ].join('\n');
}

function codeJsEvents(events, indent) {
  if (!events.length) return '[]';
  return `[\n${events.map((e) => `${indent}  { type: ${codeJsString(e.type)}, data: ${codeJsLiteral(e.data)} },`).join('\n')}\n${indent}]`;
}

function codeJsTests(plan) {
  const lines = [
    codeJsSection('Tests'),
    '// The model\'s scenarios. Run only when this file is the entry point',
    '// (`node --test <this file>`), never when it is imported.',
    'if (import.meta.main) {',
    "  const { test } = await import('node:test');",
    "  const assert = await import('node:assert/strict');",
    '  const same = (actual, expected) => assert.deepEqual(canonical(actual), canonical(expected));',
    '  const given = (events) => createApp(createInMemoryEventStore(events));',
    '  // What a command decided, without the tags the store needs.',
    '  const decided = async (app, command, args) => {',
    '    const outcome = await app.handle(command, args);',
    "    return 'published' in outcome ? { published: outcome.published.map(({ type, data }) => ({ type, data })) } : outcome;",
    '  };',
  ];
  const head = (name, skip) => (skip
    ? `  test(${codeJsString(name)}, { skip: ${codeJsString(skip)} }, async () => {`
    : `  test(${codeJsString(name)}, async () => {`);
  for (const s of plan.commandScenarios) {
    const name = `${s.command}: ${s.name}`;
    if (!s.then) { lines.push('', `  test.todo(${codeJsString(name + ' (never run in the playground)')});`); continue; }
    const expected = s.then.outcome === 'rejected'
      ? { rejected: s.then.rejection === undefined ? null : s.then.rejection }
      : { published: (s.then.events || []).map((e) => ({ type: e.type, data: e.data })) };
    lines.push('');
    lines.push(head(name, s.skip));
    lines.push(`    const app = given(${codeJsEvents(s.given, '    ')});`);
    lines.push(`    same(await decided(app, ${codeJsString(s.command)}, ${codeJsLiteral(s.args)}), ${codeJsLiteral(expected)});`);
    lines.push('  });');
  }
  for (const s of plan.projectionScenarios) {
    const name = `${s.projection}: ${s.name}`;
    if (s.then === undefined) { lines.push('', `  test.todo(${codeJsString(name + ' (never run in the playground)')});`); continue; }
    lines.push('');
    lines.push(head(name, s.skip));
    lines.push(`    const app = given(${codeJsEvents(s.given, '    ')});`);
    const args = Object.keys(s.args).length ? `, ${codeJsLiteral(s.args)}` : '';
    lines.push(`    same(await app.project(${codeJsString(s.projection)}, ${codeJsLiteral(s.tags)}${args}), ${codeJsLiteral(s.then)});`);
    lines.push('  });');
  }
  lines.push('}');
  return lines.join('\n');
}

// ============================================================
// The fixed parts of the JavaScript output — the same in every export.
// Kept as text, and run by codegen.test.js through every model's
// scenarios, so a mistake here is a failing test, not a silent one.
// ============================================================

const CODE_JS_PORT = `
// ---- The EventStore port ------------------------------------------
// What this code needs of an event store, in the shape of the DCB
// specification (https://dcb.events/specification/). An item matches
// an event whose type is one of its types (any type, when there are
// none) and that carries every one of its tags; a query is its items,
// ORed. Positions only need to compare.
//
/** @typedef {{ types: string[], tags: string[] }} QueryItem */
/** @typedef {{ items: QueryItem[] }} Query */
/** @typedef {{ type: string, data: object, tags: string[] }} Event */
/** @typedef {{ event: Event, position: number }} SequencedEvent */
/** @typedef {{ failIfEventsMatch: Query, after?: number }} AppendCondition */
/**
 * @typedef {object} EventStore
 * @property {(query: Query) => Promise<{ events: SequencedEvent[], position: number | null }>} read
 *   the matching events in position order, and the store's head
 *   position as of the read (null while it is empty)
 * @property {(events: Event[], condition?: AppendCondition) => Promise<void>} append
 *   throws AppendConditionFailed when an event matching the condition's
 *   query was appended after its position
 */
/** @typedef {{ published: Event[], appendCondition?: AppendCondition } | { rejected: string }} Decision */`;

const CODE_JS_RUNTIME = `
// ---- Runtime ------------------------------------------------------

/** A command or read that cannot be decided at all. A rule refusing a command is no error: it is returned. */
export class EvaluationError extends Error {
  constructor(message) { super(message); this.name = 'EvaluationError'; }
}

/** A definition the export could not translate (see the list at the top). */
export class NotExported extends Error {
  constructor(what, reason) { super(\`\${what} is not exported: \${reason}\`); this.name = 'NotExported'; }
}

/** Someone else appended into this decision's boundary first. */
export class AppendConditionFailed extends Error {
  constructor() { super('The append condition failed: an event matching it was appended since the decision read.'); this.name = 'AppendConditionFailed'; }
}

const own = (object, key) => (object !== null && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined);

// Values compare by content, a record's key order aside.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value === undefined ? null : value;
}
const equals = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const asList = (value) => (value === null || value === undefined ? [] : Array.isArray(value) ? value : [value]);
const isEmpty = (value) => value === null || value === undefined || ((Array.isArray(value) || typeof value === 'string') && value.length === 0);

function number(value, what) {
  if (typeof value !== 'number') throw new EvaluationError(\`\${what} needs a number but got \${JSON.stringify(value)}.\`);
  return value;
}
const increment = (state, by) => number(state, 'An increment') + number(by, 'An increment');
const decrement = (state, by) => number(state, 'A decrement') - number(by, 'A decrement');

// The next identifier: a number plus one, or a string's trailing digits
// stepped at the width they were written with (c1 → c2, inv-009 → inv-010).
function successor(value) {
  if (typeof value === 'number') return value + 1;
  const match = typeof value === 'string' ? /^(.*?)(\\d+)$/.exec(value) : null;
  if (!match) throw new EvaluationError(\`No successor is defined for \${JSON.stringify(value)}.\`);
  return match[1] + String(BigInt(match[2]) + 1n).padStart(match[2].length, '0');
}

// Appending a list appends its elements; removing takes the first match only.
const append = (list, value) => [...asList(list), ...(Array.isArray(value) ? value : [value])];
function remove(list, value) {
  const out = [...asList(list)];
  const at = out.findIndex((element) => equals(element, value));
  if (at >= 0) out.splice(at, 1);
  return out;
}

// A field of a record — of each record, read off a list.
// A rule over fanned reads holds for every instance — vacuously for
// none; lists of different lengths have no pairing to check.
function every(lists, held) {
  if (new Set(lists.map((list) => list.length)).size > 1) {
    throw new EvaluationError('A rule reads fanned-out lists of different lengths, so there is no pairing to check.');
  }
  for (let i = 0; i < (lists[0]?.length ?? 0); i++) if (!held(i)) return false;
  return true;
}
const flat = (values) => (values.some(Array.isArray) ? values.flat() : values);

const field = (value, name) => (Array.isArray(value) ? value.map((element) => own(element, name)) : own(value, name));

const equalsAny = (value, list) => asList(list).some((entry) => equals(value, entry));
const count = (value) => asList(value).length;
const contains = (value, part) => (typeof value === 'string'
  ? part !== null && part !== undefined && value.includes(String(part))
  : asList(value).some((element) => equals(element, part)));
const containsAny = (value, parts) => asList(value).some((element) => asList(parts).some((other) => equals(element, other)));

// An ordering needs both sides: null is not zero.
function ordered(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) {
    throw new EvaluationError('An ordering against no value (null) — it needs both sides.');
  }
  return true;
}
const lessThan = (a, b) => ordered(a, b) && a < b;
const lessThanOrEquals = (a, b) => ordered(a, b) && a <= b;
const greaterThan = (a, b) => ordered(a, b) && a > b;
const greaterThanOrEquals = (a, b) => ordered(a, b) && a >= b;
const startsWith = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a).startsWith(String(b));
const endsWith = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a).endsWith(String(b));

// Arithmetic of a derived projection: an unknown side keeps it unknown.
function arithmetic(a, b, fn) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return fn(number(a, 'A computation'), number(b, 'A computation'));
}
const add = (a, b) => arithmetic(a, b, (x, y) => x + y);
const subtract = (a, b) => arithmetic(a, b, (x, y) => x - y);
const multiply = (a, b) => arithmetic(a, b, (x, y) => x * y);
const min = (a, b) => arithmetic(a, b, Math.min);
const max = (a, b) => arithmetic(a, b, Math.max);

// One tag, written through its type's tag schema. A read needs a value
// for every tag it is narrowed by — null would be a phantom instance.
function tag(type, value, what, fieldName) {
  if (value === undefined || value === null) throw new EvaluationError(\`\${what} has no value (\${value}).\`);
  if (Array.isArray(value)) throw new EvaluationError(\`\${what} takes one value, not a list.\`);
  const leaf = fieldName ? value[fieldName] : value;
  return (TAG_SCHEMAS[type] ?? '{type}:{value}').replace('{type}', () => type).replace('{value}', () => String(leaf));
}

/** The tags an event of \`type\` carries, read off its payload. */
export function tagsOf(type, data) {
  const out = new Set();
  for (const leaf of EVENT_TAGS[type] ?? []) {
    const held = own(data, leaf.property);
    for (const element of leaf.isList ? asList(held) : [held]) {
      const value = leaf.field ? own(element, leaf.field) : element;
      if (value === null || value === undefined) continue;
      out.add((TAG_SCHEMAS[leaf.tagType] ?? '{type}:{value}').replace('{type}', () => leaf.tagType).replace('{value}', () => String(value)));
    }
  }
  return [...out];
}

const event = (type, data) => ({ type, data, tags: tagsOf(type, data) });

function withOptionals(event) {
  let data = event.data;
  for (const name of OPTIONAL_PROPERTIES[event.type] ?? []) {
    if (own(data, name) === undefined) data = { ...data, [name]: null };
  }
  return data === event.data ? event : { ...event, data };
}

// A projection folds the events its own query matches: one of its
// handled types, carrying all of its tags.
function projection({ name, tags, initialState, when }) {
  const types = Object.keys(when);
  return {
    name,
    query: (values) => [{ types, tags: tags(values) }],
    fold(events, values) {
      const wanted = tags(values);
      let state = initialState;
      for (const event of events) {
        if (!Object.hasOwn(when, event.type) || !wanted.every((t) => event.tags.includes(t))) continue;
        state = when[event.type](state, withOptionals(event));
      }
      return state;
    },
  };
}

// A derived projection reads its operands and makes one value of them;
// its query is theirs, each under its own tags.
const READ = Symbol('read');
const read = (projection, tags, args = {}) => ({ [READ]: true, projection, tags, args });
// A read made once per element of a list — one fold, and one query
// item, each.
const readEach = (projection, elements, tagsOf, args = {}) => ({ [READ]: true, projection, each: asList(elements).map(tagsOf), args });
function derived({ name, tags, operands, value }) {
  return {
    name,
    query: (values) => (tags(values), operands(values).flatMap((o) => (o?.[READ] ? o.projection.query(o.tags) : []))),
    fold: (events, values) => (tags(values), value(...operands(values).map((o) => (o?.[READ] ? o.projection.fold(events, o.tags, o.args) : o)))),
  };
}

// A scripted projection: the model's own JavaScript, one expression per
// event, \`(state, event, args, tags) => nextState\`. Each fold starts
// from a copy of the initial state, a script sees a frozen copy of the
// event, and \`exposes\` names the one field of the state a rule reads.
function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
function scripted({ name, tags, initialState, exposes, when }) {
  const types = Object.keys(when);
  return {
    name,
    query: (values) => [{ types, tags: tags(values) }],
    fold(events, values, args = {}) {
      const wanted = tags(values);
      let state = structuredClone(initialState);
      for (const event of events) {
        if (!Object.hasOwn(when, event.type) || !wanted.every((t) => event.tags.includes(t))) continue;
        const { type, data } = withOptionals(event);
        try {
          state = when[type](state, freeze(structuredClone({ type, data })), args, values);
        } catch (error) {
          throw new EvaluationError(\`The script for "\${type}" on projection "\${name}" threw: \${error?.message ?? error}\`);
        }
      }
      return exposes === undefined || state === null || state === undefined ? state : state[exposes];
    },
  };
}

function notExported(what, reason) {
  const fail = () => { throw new NotExported(what, reason); };
  return { name: what, query: fail, fold: fail };
}

function argument(args, name, command) {
  const value = own(args, name);
  if (value !== undefined) return value;
  if (command === null) return null;
  throw new EvaluationError(\`"\${command}" needs a value for "\${name}".\`);
}

// The reads of one decision, made in rounds — a later round's tags may
// be an earlier round's answers. All rounds see the store as the first
// one found it (its head position then), so the decision reads one
// state; every query it ran becomes the append condition, ORed, after
// that position.
function decisionModel(store) {
  const items = [];
  let head;
  return {
    async read(reads) {
      const entries = Object.entries(reads);
      const query = { items: entries.flatMap(([, r]) => (r.each ?? [r.tags]).flatMap((t) => r.projection.query(t))) };
      let events = [];
      if (query.items.length) {
        const result = await store.read(query);
        if (head === undefined) head = result.position;
        items.push(...query.items);
        events = result.events
          .filter((s) => head === null || s.position <= head)
          .map((s) => s.event);
      }
      return Object.fromEntries(entries.map(([key, r]) => [key,
        r.each ? r.each.map((t) => r.projection.fold(events, t, r.args)) : r.projection.fold(events, r.tags, r.args)]));
    },
    appendCondition() {
      if (!items.length) return undefined;
      return head === null || head === undefined ? { failIfEventsMatch: { items } } : { failIfEventsMatch: { items }, after: head };
    },
  };
}`;

const CODE_JS_APP = `
// ---- The application ----------------------------------------------

/**
 * The model, driven against \`store\`.
 * @param {EventStore} store
 */
export function createApp(store) {
  async function decide(command, args = {}) {
    if (!Object.hasOwn(commands, command)) throw new EvaluationError(\`This model has no command "\${command}".\`);
    return commands[command](store, args);
  }
  return {
    decide,
    /** Decides, and appends what was published under the decision's append condition. */
    async handle(command, args = {}) {
      const decision = await decide(command, args);
      if ('rejected' in decision) return { rejected: decision.rejected };
      if (decision.published.length) await store.append(decision.published, decision.appendCondition);
      return { published: decision.published };
    },
    /** A projection's current value, read by its tags (and a script's arguments). */
    async project(name, tags = {}, args = {}) {
      if (!Object.hasOwn(projections, name)) throw new EvaluationError(\`This model has no projection "\${name}".\`);
      const projection = projections[name];
      const query = { items: projection.query(tags) };
      const { events } = query.items.length ? await store.read(query) : { events: [] };
      return projection.fold(events.map((s) => s.event), tags, args);
    },
  };
}`;

const CODE_JS_IN_MEMORY = `
// ---- In-memory event store ----------------------------------------

/**
 * An EventStore in an array — for tests, and to try the model out.
 * Seeded with \`events\`, each tagged from its payload unless it says.
 * @param {{ type: string, data: object, tags?: string[] }[]} [events]
 * @returns {EventStore & { events: SequencedEvent[] }}
 */
export function createInMemoryEventStore(events = []) {
  const log = [];
  const matches = (query, event) => query.items.some((item) =>
    (!item.types?.length || item.types.includes(event.type))
    && (item.tags ?? []).every((t) => event.tags.includes(t)));
  const push = (event) => log.push({
    event: { type: event.type, data: event.data, tags: event.tags ?? tagsOf(event.type, event.data) },
    position: log.length + 1,
  });
  events.forEach(push);
  return {
    events: log,
    async read(query) {
      return { events: log.filter((s) => matches(query, s.event)), position: log.length ? log.length : null };
    },
    async append(appended, condition) {
      if (condition && log.some((s) => (condition.after === undefined || s.position > condition.after)
        && matches(condition.failIfEventsMatch, s.event))) {
        throw new AppendConditionFailed();
      }
      appended.forEach(push);
    },
  };
}`;

// ============================================================
// The PHP printer.
//
// One file per model, in its own namespace, against
// wwwision/dcb-eventstore — its EventStore, queries and append
// conditions, and its in-memory store for the scenarios. An event is a
// final readonly class; a command a static method deciding Accepted or
// Rejected; a projection a fold built once. Scripts are JavaScript, so
// this target stubs them (`runsScripts` is false).
//
// The library reads no head position, so a command reading in one
// round appends after the last event it saw, and one reading in
// several first reads the store's head — every round then sees the
// store as it stood then, and the append is after that head.
// ============================================================

const CODE_PHP_LIBRARY = 'wwwision/dcb-eventstore:^5.0';

// Case-insensitively reserved as class names in PHP, and the names the
// generated file defines or imports itself.
const CODE_PHP_RESERVED = new Set((
  'abstract and array as break callable case catch class clone const continue declare default do echo else elseif '
  + 'empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach '
  + 'function global goto if implements include include_once instanceof insteadof interface isset list match '
  + 'namespace new or print private protected public readonly require require_once return static switch throw trait '
  + 'try unset use var while xor yield int float bool string true false null void iterable object mixed never self '
  + 'parent'
).split(' '));
const CODE_PHP_OWN_CLASSES = [
  'App', 'Model', 'Runtime', 'Projections', 'Commands', 'Scenarios', 'Sandbox', 'DomainEvent', 'ProjectionDefinition',
  'Projection', 'Derived', 'NotExportedProjection', 'Read', 'DecisionModel', 'Accepted', 'Rejected',
  'EvaluationError', 'NotExported', 'Folded',
  'DcbEventStore', 'DcbEvent', 'DcbEvents', 'DcbQuery', 'DcbQueryItem', 'DcbAppendCondition', 'DcbReadOptions',
  'DcbSequencedEvent', 'DcbInMemoryEventStore',
];

function codePhpNamer(reserved, caseless) {
  const key = (name) => (caseless ? name.toLowerCase() : name);
  const taken = new Set([...reserved].map(key));
  return (wanted) => {
    let name = String(wanted || '_').replace(/[^A-Za-z0-9_]/g, '_');
    if (/^\d/.test(name)) name = '_' + name;
    while (taken.has(key(name)) || CODE_PHP_RESERVED.has(name.toLowerCase())) name += '_';
    taken.add(key(name));
    return name;
  };
}

function codePhpString(text) {
  return "'" + String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function codePhpLiteral(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  if (typeof value === 'string') return codePhpString(value);
  if (Array.isArray(value)) return `[${value.map(codePhpLiteral).join(', ')}]`;
  const entries = Object.entries(value);
  return `[${entries.map(([k, v]) => `${codePhpString(k)} => ${codePhpLiteral(v)}`).join(', ')}]`;
}

function codePhpArray(entries) {
  return `[${entries.map(([key, code]) => `${codePhpString(key)} => ${code}`).join(', ')}]`;
}

// A property's PHP type: the base a JSON value of it decodes to.
function codePhpType(ref, model) {
  let base;
  if (ref.isList) base = 'array';
  else if (ref.type === 'integer') base = 'int';
  else if (ref.type === 'string') base = 'string';
  else if (ref.type === 'boolean') base = 'bool';
  else {
    const type = model.types.find((t) => t.name === ref.type);
    if (!type) base = 'mixed';
    else if (type.kind === 'record') base = 'array';
    else if (type.kind === 'enum') {
      const kinds = new Set(type.members.map((m) => typeof m));
      base = kinds.size === 1 && kinds.has('string') ? 'string' : kinds.size === 1 && kinds.has('number') ? 'int|float' : 'mixed';
    } else base = type.base === 'number' ? 'int|float' : type.base === 'boolean' ? 'bool' : 'string';
  }
  if (ref.isOptional && !ref.isList && base !== 'mixed') return base.includes('|') ? `${base}|null` : `?${base}`;
  return base;
}

function codePhpExpr(expr, scope) {
  switch (expr.k) {
    case 'lit': return codePhpLiteral(expr.value);
    case 'arg': {
      const name = '$' + scope.args.get(expr.name);
      return expr.property ? `Runtime::field(${name}, ${codePhpString(expr.property)})` : name;
    }
    case 'argAt': return `(Runtime::asList(${codePhpExpr({ ...expr, k: 'arg' }, scope)})[$i] ?? null)`;
    case 'read': return expr.flatten ? `Runtime::flat($${scope.reads.get(expr.read)})` : '$' + scope.reads.get(expr.read);
    case 'readAt': return `$${scope.reads.get(expr.read)}[$i]`;
    case 'eventProperty': return `$event->${scope.eventProps.get(expr.name) || expr.name}`;
    case 'state': return '$state';
    case 'successor': return `Runtime::successor(${codePhpExpr(expr.of, scope)})`;
    case 'tag': return `($t[${codePhpString(expr.name)}] ?? null)`;
    default: throw new Error(`No PHP for expression "${expr.k}".`);
  }
}

function codePhpPredicate(predicate, l, r) {
  const call = (fn, ...a) => ({ code: `Runtime::${fn}(${a.join(', ')})`, atomic: true });
  const op = (code) => ({ code, atomic: false });
  switch (predicate) {
    case 'isEmpty': return call('isEmpty', l);
    case 'isNotEmpty': return codeJsNot(call('isEmpty', l));
    case 'isTrue': return op(`${l} === true`);
    case 'isFalse': return op(`${l} === false`);
    case 'countEquals': return op(`Runtime::count(${l}) === ${r}`);
    case 'countLessThan': return op(`Runtime::count(${l}) < ${r}`);
    case 'countGreaterThan': return op(`Runtime::count(${l}) > ${r}`);
    default: return call(predicate, l, r);
  }
}

function codePhpHeld(c, scope) {
  const l = codePhpExpr(c.left, scope);
  const r = c.right ? codePhpExpr(c.right, scope) : null;
  const base = codePhpPredicate(c.predicate, l, r);
  const held = c.negate ? codeJsNot(base) : base;
  if (!c.quantified || !c.quantified.length) return held;
  const lists = c.quantified.map((read) => '$' + scope.reads.get(read));
  return { code: `Runtime::every([${lists.join(', ')}], fn (int $i): bool => ${held.code})`, atomic: true };
}

function codePhpNamespace(name) {
  const studly = String(name || '').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return 'DcbModel\\' + (/^[A-Za-z]/.test(studly) ? studly : 'Model' + studly);
}

function codePrintPhp(plan, options) {
  const withTests = !!options.includeTests;
  const withDocs = options.docComments !== false;
  const out = [];
  const className = codePhpNamer(CODE_PHP_OWN_CLASSES, true);
  const eventClass = new Map(plan.events.map((e) => [e.name, className(e.name)]));
  const projectionMethod = codePhpNamer(['get', 'byName'], true);
  const projectionName = new Map(plan.projections.map((p) => [p.name, projectionMethod(p.name)]));
  const commandMethod = codePhpNamer(['decide'], true);
  const commandName = new Map(plan.commands.map((c) => [c.name, commandMethod(c.name)]));
  const eventProps = new Map(plan.events.map((e) => {
    const name = codePhpNamer(['this'], false);
    return [e.name, new Map(e.properties.map((p) => [p.name, name(p.name)]))];
  }));
  const projectionRef = (name) => `Projections::${projectionName.get(name)}()`;

  out.push('<?php');
  out.push('');
  out.push(codePhpHeader(plan, withTests));
  out.push('');
  out.push('declare(strict_types=1);');
  out.push('');
  out.push(`namespace ${codePhpNamespace(plan.name)};`);
  out.push('');
  out.push(CODE_PHP_USES);
  out.push(CODE_PHP_RUNTIME);

  // ---- Events
  out.push(codePhpSection('Events'));
  for (const event of plan.events) {
    const cls = eventClass.get(event.name);
    const props = eventProps.get(event.name);
    const params = event.properties.map((p) => `        public ${codePhpType(p, plan)} $${props.get(p.name)}${p.isOptional && !p.isList ? ' = null' : ''},`);
    const from = event.properties.map((p) => `            ${props.get(p.name)}: $data[${codePhpString(p.name)}]${p.isOptional && !p.isList ? ' ?? null' : ''},`);
    const to = event.properties.map((p) => `${codePhpString(p.name)} => $this->${props.get(p.name)}`);
    out.push(`final readonly class ${cls} implements DomainEvent`);
    out.push('{');
    out.push(`    public const TYPE = ${codePhpString(event.name)};`);
    out.push('');
    if (params.length) {
      out.push('    public function __construct(');
      out.push(...params);
      out.push('    ) {}');
    } else {
      out.push('    public function __construct() {}');
    }
    out.push('');
    out.push('    public static function fromArray(array $data): self');
    out.push('    {');
    if (from.length) {
      out.push('        return new self(');
      out.push(...from);
      out.push('        );');
    } else out.push('        return new self();');
    out.push('    }');
    out.push('');
    out.push('    public function toArray(): array');
    out.push('    {');
    out.push(`        return [${to.join(', ')}];`);
    out.push('    }');
    out.push('}');
    out.push('');
  }

  // ---- The model's tables
  out.push('final class Model');
  out.push('{');
  out.push('    /** Each event type\'s class. */');
  out.push(`    public const EVENT_CLASSES = ${codePhpArray(plan.events.map((e) => [e.name, `${eventClass.get(e.name)}::class`]))};`);
  out.push('');
  out.push('    /** The tags each event carries, read off its payload. */');
  out.push('    public const EVENT_TAGS = [');
  for (const event of plan.events) {
    const leaves = event.tags.map((leaf) => codePhpLiteral({
      tagType: leaf.tagType, property: leaf.property, field: leaf.field || null, isList: !!leaf.isList,
    }));
    out.push(`        ${codePhpString(event.name)} => [${leaves.join(', ')}],`);
  }
  out.push('    ];');
  out.push('');
  out.push(`    public const TAG_SCHEMAS = ${codePhpLiteral(plan.tagSchemas)};`);
  out.push('');
  out.push(CODE_PHP_MODEL_METHODS);
  out.push('}');

  // ---- Projections
  out.push(codePhpSection('Projections'));
  out.push('final class Projections');
  out.push('{');
  out.push('    /** @var array<string, ProjectionDefinition> */');
  out.push('    private static array $built = [];');
  out.push('');
  out.push(`    public const NAMES = ${codePhpArray(plan.projections.map((p) => [p.name, codePhpString(projectionName.get(p.name))]))};`);
  out.push('');
  out.push('    public static function byName(string $name): ProjectionDefinition');
  out.push('    {');
  out.push('        if (!array_key_exists($name, self::NAMES)) {');
  out.push('            throw new EvaluationError(sprintf(\'This model has no projection "%s".\', $name));');
  out.push('        }');
  out.push('        return self::{self::NAMES[$name]}();');
  out.push('    }');
  for (const p of plan.projections) {
    out.push('');
    out.push(codePhpProjection(p, projectionName, projectionRef, eventClass, eventProps));
  }
  out.push('}');

  // ---- Commands
  out.push(codePhpSection('Commands'));
  out.push('/**');
  out.push(' * Each decides against the store and returns what it decided — nothing');
  out.push(' * is appended here (App::handle does that). A rule refusing is a');
  out.push(' * Rejected; anything that cannot be decided at all throws an');
  out.push(' * EvaluationError.');
  out.push(' */');
  out.push('final class Commands');
  out.push('{');
  out.push(`    public const NAMES = ${codePhpArray(plan.commands.map((c) => [c.name, codePhpString(commandName.get(c.name))]))};`);
  out.push('');
  out.push('    public static function decide(DcbEventStore $store, string $command, array $args): Accepted|Rejected');
  out.push('    {');
  out.push('        if (!array_key_exists($command, self::NAMES)) {');
  out.push('            throw new EvaluationError(sprintf(\'This model has no command "%s".\', $command));');
  out.push('        }');
  out.push('        return self::{self::NAMES[$command]}($store, $args);');
  out.push('    }');
  for (const command of plan.commands) {
    out.push('');
    out.push(codePhpCommand(command, plan, commandName, projectionRef, eventClass, eventProps, withDocs));
  }
  out.push('}');

  out.push(CODE_PHP_APP);
  if (plan.sandboxSteps.length) out.push(codePhpSandbox(plan));
  if (withTests) out.push(codePhpTests(plan));
  return out.join('\n') + '\n';
}

function codePhpSection(title) {
  return `\n// ---- ${title} ${'-'.repeat(Math.max(4, 66 - title.length))}\n`;
}

function codePhpHeader(plan, withTests) {
  const lines = [
    `${plan.name} — exported from the DCB Playground as PHP.`,
    '',
    'Experimental, and generated: change the model and export again rather',
    'than editing this. Needs PHP 8.3 and the event store library:',
    `  composer require ${CODE_PHP_LIBRARY}`,
    'Each command decides against its EventStore and appends what it',
    'publishes under the append condition its reads made: every query it',
    'ran, ORed.',
    '',
    'Usage:',
    '  $app = new App(InMemoryEventStore::create());',
    "  $app->handle('<Command>', [...]);   // Accepted or Rejected",
    "  $app->project('<Projection>', [...]); // its current value",
  ];
  if (withTests) lines.push('', 'Run the model\'s scenarios with `php <this file>` from the directory', 'holding vendor/.');
  lines.push(
    '',
    'An append whose condition fails throws ConditionalAppendFailed: someone',
    'else wrote into this decision\'s boundary first. Deciding again on the',
    'new state is usually right, and left to the caller.',
  );
  if (plan.stubs.length) {
    lines.push('', 'Not exported — each throws NotExported when used:');
    for (const stub of plan.stubs) lines.push(`  - ${stub.kind} ${stub.name}: ${stub.reason}`);
  }
  return ['/**', ...lines.map((l) => ` *${l ? ' ' + l : ''}`), ' */'].join('\n');
}

function codePhpProjection(p, projectionName, projectionRef, eventClass, eventProps) {
  const method = projectionName.get(p.name);
  const lines = [];
  const ind = '        ';
  lines.push(`    public static function ${method}(): ProjectionDefinition`);
  lines.push('    {');
  if (p.kind === 'stub') {
    lines.push(`${ind}return self::$built[${codePhpString(p.name)}] ??= new NotExportedProjection(${codePhpString(`projection ${p.name}`)}, ${codePhpString(p.reason)});`);
    lines.push('    }');
    return lines.join('\n');
  }
  const tagList = p.tags.flatMap((tag) => tag.leaves.map((leaf) =>
    `Runtime::tag(${codePhpString(leaf.tagType)}, $t[${codePhpString(tag.name)}] ?? null, ${codePhpString(`${p.name}'s "${tag.name}" tag`)}`
    + `${leaf.field ? ', ' + codePhpString(leaf.field) : ''})`));
  const tags = `static fn (array $t): array => [${tagList.join(', ')}]`;
  if (p.kind === 'fold') {
    lines.push(`${ind}return self::$built[${codePhpString(p.name)}] ??= new Projection(`);
    lines.push(`${ind}    name: ${codePhpString(p.name)},`);
    lines.push(`${ind}    tags: ${tags},`);
    lines.push(`${ind}    initialState: ${codePhpLiteral(p.initial)},`);
    lines.push(`${ind}    when: [`);
    for (const h of p.handlers) {
      const cls = eventClass.get(h.event);
      const scope = { eventProps: eventProps.get(h.event) || new Map() };
      const value = codePhpExpr(h.value, scope);
      const body = h.operation === 'set' ? value : `Runtime::${h.operation}($state, ${value})`;
      lines.push(`${ind}        ${codePhpString(h.event)} => static fn (mixed $state, ${cls || 'DomainEvent'} $event): mixed => ${body},`);
    }
    lines.push(`${ind}    ],`);
    lines.push(`${ind});`);
    lines.push('    }');
    return lines.join('\n');
  }
  // derived
  const scope = { eventProps: new Map() };
  const operand = (o) => (o.k === 'projectionRead'
    ? `Runtime::read(${projectionRef(o.projection)}, ${codePhpArray(o.tags.map((tag) => [tag.name, codePhpExpr(tag.value, scope)]))}`
      + `${o.args.length ? ', ' + codePhpArray(o.args.map((a) => [a.name, codePhpExpr(a.value, scope)])) : ''})`
    : codePhpExpr(o, scope));
  const value = p.operator
    ? `Runtime::${p.operator}($left, $right)`
    : (p.negate ? codeJsNot(codePhpPredicate(p.predicate, '$left', '$right')) : codePhpPredicate(p.predicate, '$left', '$right')).code;
  lines.push(`${ind}return self::$built[${codePhpString(p.name)}] ??= new Derived(`);
  lines.push(`${ind}    name: ${codePhpString(p.name)},`);
  lines.push(`${ind}    tags: ${tags},`);
  lines.push(`${ind}    operands: static fn (array $t): array => [${operand(p.left)}, ${operand(p.right)}],`);
  lines.push(`${ind}    value: static fn (mixed $left, mixed $right): mixed => ${value},`);
  lines.push(`${ind});`);
  lines.push('    }');
  return lines.join('\n');
}

function codePhpCommand(command, plan, commandName, projectionRef, eventClass, eventProps, withDocs) {
  const method = commandName.get(command.name);
  const lines = [];
  const ind = '        ';
  if (command.kind === 'stub') {
    lines.push(`    /** Not exported: ${command.reason.replace(/\*\//g, '* /')} */`);
    lines.push(`    public static function ${method}(DcbEventStore $store, array $args): Accepted|Rejected`);
    lines.push('    {');
    lines.push(`${ind}throw new NotExported(${codePhpString(`command ${command.name}`)}, ${codePhpString(command.reason)});`);
    lines.push('    }');
    return lines.join('\n');
  }
  const local = codePhpNamer(['this', 'store', 'args', 'decision', 'events', 'i', 't', 'state', 'event'], false);
  const scope = { args: new Map(), reads: new Map(), eventProps: new Map() };
  for (const param of command.params) scope.args.set(param.name, local(param.name));
  for (const round of command.rounds) {
    for (const read of round) {
      scope.reads.set(read, local(read.name || read.projection.charAt(0).toLowerCase() + read.projection.slice(1)));
    }
  }

  const doc = [];
  if (withDocs && command.boundary) {
    doc.push(`${command.name} — ${command.boundary.words}.`);
    command.boundary.queries.forEach((items, i) => {
      if (command.boundary.queries.length > 1) doc.push(`Query ${i + 1}:`);
      for (const item of items) {
        doc.push(`  ${item.label}: ${item.types.length ? item.types.join(', ') : 'any type'}`
          + `${item.tags.length ? ` tagged ${item.tags.join(' & ')}` : ''}`);
      }
    });
    doc.push('');
  }
  doc.push(`@param array{${command.params.map((p) => `${p.name}${p.defaultsToNull ? '?' : ''}: ${codePhpType(p, plan)}`).join(', ')}} $args`);
  lines.push('    /**');
  for (const line of doc) lines.push(`     *${line ? ' ' + line.replace(/\*\//g, '* /') : ''}`);
  lines.push('     */');
  lines.push(`    public static function ${method}(DcbEventStore $store, array $args): Accepted|Rejected`);
  lines.push('    {');
  for (const param of command.params) {
    lines.push(`${ind}$${scope.args.get(param.name)} = Runtime::argument($args, ${codePhpString(param.name)}, ${param.defaultsToNull ? 'null' : codePhpString(command.name)});`);
  }
  if (command.rounds.length) lines.push(`${ind}$decision = new DecisionModel($store, rounds: ${command.rounds.length});`);
  for (const round of command.rounds) {
    const names = round.map((read) => `${codePhpString(scope.reads.get(read))} => $${scope.reads.get(read)}`);
    lines.push(`${ind}[${names.join(', ')}] = $decision->read([`);
    for (const read of round) {
      const fanned = read.tags.find((tag) => tag.each);
      const tags = codePhpArray(read.tags.map((tag) => [tag.name, tag.each ? '$each' : codePhpExpr(tag.value, scope)]));
      const args = read.args.length ? ', ' + codePhpArray(read.args.map((a) => [a.name, codePhpExpr(a.value, scope)])) : '';
      const call = fanned
        ? `Runtime::readEach(${projectionRef(read.projection)}, ${codePhpExpr(fanned.each, scope)}, fn (mixed $each): array => ${tags}${args})`
        : `Runtime::read(${projectionRef(read.projection)}, ${tags}${args})`;
      lines.push(`${ind}    ${codePhpString(scope.reads.get(read))} => ${call},`);
    }
    lines.push(`${ind}]);`);
  }
  for (const rule of command.rules) {
    const failing = codeJsNot(codePhpHeld(rule, scope));
    lines.push(`${ind}if (${failing.code}) {`);
    lines.push(`${ind}    return new Rejected(${rule.rejection === null ? 'null' : codePhpString(rule.rejection)});`);
    lines.push(`${ind}}`);
  }
  lines.push(`${ind}$events = [];`);
  for (const emission of command.emissions) {
    if (emission.error && !emission.guards) {
      lines.push(`${ind}throw new EvaluationError(${codePhpString(emission.error)});`);
      continue;
    }
    let push;
    if (emission.error) push = `throw new EvaluationError(${codePhpString(emission.error)});`;
    else {
      const props = eventProps.get(emission.event);
      const named = emission.data.map((d) => `${props.get(d.name)}: ${codePhpExpr(d.value, scope)}`);
      push = `$events[] = new ${eventClass.get(emission.event)}(${named.join(', ')});`;
    }
    if (!emission.guards.length) { lines.push(`${ind}${push}`); continue; }
    const guard = emission.guards.map((g) => {
      const held = codePhpHeld(g, scope);
      return emission.guards.length > 1 && !held.atomic ? `(${held.code})` : held.code;
    }).join(' && ');
    lines.push(`${ind}if (${guard}) {`);
    lines.push(`${ind}    ${push}`);
    lines.push(`${ind}}`);
  }
  lines.push(`${ind}return new Accepted($events, ${command.rounds.length ? '$decision->appendCondition()' : 'null'});`);
  lines.push('    }');
  return lines.join('\n');
}

function codePhpSandbox(plan) {
  return [
    codePhpSection('Sandbox'),
    '/** The steps the playground\'s sandbox ran, in order: `Sandbox::replay($app)`. */',
    'final class Sandbox',
    '{',
    '    public const STEPS = [',
    ...plan.sandboxSteps.map((step) => `        [${codePhpString(step.command)}, ${codePhpLiteral(step.args)}],`),
    '    ];',
    '',
    '    /** @return list<Accepted|Rejected> */',
    '    public static function replay(App $app): array',
    '    {',
    '        return array_map(static fn (array $step) => $app->handle($step[0], $step[1]), self::STEPS);',
    '    }',
    '}',
  ].join('\n');
}

function codePhpGiven(events, indent) {
  if (!events.length) return '[]';
  return `[\n${events.map((e) => `${indent}    [${codePhpString(e.type)}, ${codePhpLiteral(e.data)}],`).join('\n')}\n${indent}]`;
}

function codePhpTests(plan) {
  const lines = [
    codePhpSection('Scenarios'),
    '/** The model\'s scenarios, as checks: `php <this file>` runs them. */',
    'final class Scenarios',
    '{',
    '    /** @return list<array{string, ?string, \\Closure}> name, why skipped, check */',
    '    public static function all(): array',
    '    {',
    '        return [',
  ];
  for (const s of plan.commandScenarios) {
    const name = `${s.command}: ${s.name}`;
    if (!s.then) { lines.push(`            [${codePhpString(name)}, 'never run in the playground', static fn () => null],`); continue; }
    const expected = s.then.outcome === 'rejected'
      ? { rejected: s.then.rejection === undefined ? null : s.then.rejection }
      : { published: (s.then.events || []).map((e) => ({ type: e.type, data: e.data })) };
    lines.push(`            [${codePhpString(name)}, ${s.skip ? codePhpString(s.skip) : 'null'}, static fn () => self::same(`);
    lines.push(`                self::decided(self::given(${codePhpGiven(s.given, '                ')}), ${codePhpString(s.command)}, ${codePhpLiteral(s.args)}),`);
    lines.push(`                ${codePhpLiteral(expected)},`);
    lines.push('            )],');
  }
  for (const s of plan.projectionScenarios) {
    const name = `${s.projection}: ${s.name}`;
    if (s.then === undefined) { lines.push(`            [${codePhpString(name)}, 'never run in the playground', static fn () => null],`); continue; }
    lines.push(`            [${codePhpString(name)}, ${s.skip ? codePhpString(s.skip) : 'null'}, static fn () => self::same(`);
    lines.push(`                self::given(${codePhpGiven(s.given, '                ')})->project(${codePhpString(s.projection)}, ${codePhpLiteral(s.tags)}${Object.keys(s.args).length ? ', ' + codePhpLiteral(s.args) : ''}),`);
    lines.push(`                ${codePhpLiteral(s.then)},`);
    lines.push('            )],');
  }
  lines.push('        ];');
  lines.push('    }');
  lines.push(CODE_PHP_SCENARIO_RUNNER);
  lines.push('}');
  lines.push('');
  lines.push('if (PHP_SAPI === \'cli\' && realpath($_SERVER[\'SCRIPT_FILENAME\'] ?? \'\') === __FILE__) {');
  lines.push('    foreach ([getcwd() . \'/vendor/autoload.php\', __DIR__ . \'/vendor/autoload.php\'] as $autoload) {');
  lines.push('        if (is_file($autoload)) {');
  lines.push('            require_once $autoload;');
  lines.push('            break;');
  lines.push('        }');
  lines.push('    }');
  lines.push('    exit(Scenarios::run());');
  lines.push('}');
  return lines.join('\n');
}

// ============================================================
// The fixed parts of the PHP output.
// ============================================================

const CODE_PHP_USES = `use Wwwision\\DCBEventStore\\AppendCondition\\AppendCondition as DcbAppendCondition;
use Wwwision\\DCBEventStore\\Event\\Event as DcbEvent;
use Wwwision\\DCBEventStore\\Event\\Events as DcbEvents;
use Wwwision\\DCBEventStore\\EventStore as DcbEventStore;
use Wwwision\\DCBEventStore\\InMemoryEventStore\\InMemoryEventStore as DcbInMemoryEventStore;
use Wwwision\\DCBEventStore\\Query\\Query as DcbQuery;
use Wwwision\\DCBEventStore\\Query\\QueryItem as DcbQueryItem;
use Wwwision\\DCBEventStore\\ReadOptions as DcbReadOptions;
use Wwwision\\DCBEventStore\\SequencedEvent\\SequencedEvent as DcbSequencedEvent;`;

const CODE_PHP_RUNTIME = `
// ---- Runtime ------------------------------------------------------

/** A command or read that cannot be decided at all. A rule refusing a command is no error: it is a Rejected. */
final class EvaluationError extends \\RuntimeException {}

/** A definition the export could not translate (see the list at the top). */
final class NotExported extends \\LogicException
{
    public function __construct(string $what, string $reason)
    {
        parent::__construct("{$what} is not exported: {$reason}");
    }
}

interface DomainEvent
{
    public static function fromArray(array $data): self;

    public function toArray(): array;
}

/** The command was accepted: these events, appended under this condition. */
final readonly class Accepted
{
    /** @param list<DomainEvent> $events */
    public function __construct(public array $events, public ?DcbAppendCondition $appendCondition) {}
}

/** A rule refused the command. */
final readonly class Rejected
{
    public function __construct(public ?string $reason) {}
}

final class Runtime
{
    /** Values compare by content, a record's key order aside. */
    public static function canonical(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        $out = array_map(self::canonical(...), $value);
        if (!array_is_list($out)) {
            ksort($out, SORT_STRING);
        }
        return $out;
    }

    public static function equals(mixed $a, mixed $b): bool
    {
        return json_encode(self::canonical($a)) === json_encode(self::canonical($b));
    }

    /** A record (an array with keys) is one value; null is none. */
    public static function asList(mixed $value): array
    {
        if ($value === null) {
            return [];
        }
        return is_array($value) && array_is_list($value) ? $value : [$value];
    }

    public static function isEmpty(mixed $value): bool
    {
        return $value === null || $value === '' || $value === [];
    }

    private static function number(mixed $value, string $what): int|float
    {
        if (!is_int($value) && !is_float($value)) {
            throw new EvaluationError(sprintf('%s needs a number but got %s.', $what, json_encode($value)));
        }
        return $value;
    }

    public static function increment(mixed $state, mixed $by): int|float
    {
        return self::number($state, 'An increment') + self::number($by, 'An increment');
    }

    public static function decrement(mixed $state, mixed $by): int|float
    {
        return self::number($state, 'A decrement') - self::number($by, 'A decrement');
    }

    /** The next identifier: a number plus one, or a string's trailing digits stepped at their width (c1 → c2, inv-009 → inv-010). */
    public static function successor(mixed $value): mixed
    {
        if (is_int($value) || is_float($value)) {
            return $value + 1;
        }
        if (!is_string($value) || preg_match('/^(.*?)(\\d+)$/', $value, $match) !== 1) {
            throw new EvaluationError(sprintf('No successor is defined for %s.', json_encode($value)));
        }
        $digits = $match[2];
        for ($i = strlen($digits) - 1; $i >= 0; $i--) {
            if ($digits[$i] !== '9') {
                $digits[$i] = (string) ((int) $digits[$i] + 1);
                return $match[1] . $digits;
            }
            $digits[$i] = '0';
        }
        return $match[1] . '1' . $digits;
    }

    /** Appending a list appends its elements. */
    public static function append(mixed $list, mixed $value): array
    {
        return [...self::asList($list), ...(is_array($value) && array_is_list($value) ? $value : [$value])];
    }

    /** Removes the first match only. */
    public static function remove(mixed $list, mixed $value): array
    {
        $out = self::asList($list);
        foreach ($out as $i => $element) {
            if (self::equals($element, $value)) {
                array_splice($out, $i, 1);
                break;
            }
        }
        return $out;
    }

    /** A field of a record — of each record, read off a list. */
    public static function field(mixed $value, string $name): mixed
    {
        if (is_array($value) && array_is_list($value)) {
            return array_map(static fn (mixed $element) => is_array($element) ? ($element[$name] ?? null) : null, $value);
        }
        return is_array($value) ? ($value[$name] ?? null) : null;
    }

    public static function equalsAny(mixed $value, mixed $list): bool
    {
        foreach (self::asList($list) as $entry) {
            if (self::equals($value, $entry)) {
                return true;
            }
        }
        return false;
    }

    public static function count(mixed $value): int
    {
        return \\count(self::asList($value));
    }

    public static function contains(mixed $value, mixed $part): bool
    {
        if (is_string($value)) {
            return $part !== null && str_contains($value, self::text($part));
        }
        return self::equalsAny($part, $value);
    }

    public static function containsAny(mixed $value, mixed $parts): bool
    {
        foreach (self::asList($value) as $element) {
            if (self::equalsAny($element, $parts)) {
                return true;
            }
        }
        return false;
    }

    /** An ordering needs both sides (null is not zero); strings order as text. */
    private static function compare(mixed $a, mixed $b): int
    {
        if ($a === null || $b === null) {
            throw new EvaluationError('An ordering against no value (null) — it needs both sides.');
        }
        return is_string($a) && is_string($b) ? strcmp($a, $b) : $a <=> $b;
    }

    public static function lessThan(mixed $a, mixed $b): bool { return self::compare($a, $b) < 0; }
    public static function lessThanOrEquals(mixed $a, mixed $b): bool { return self::compare($a, $b) <= 0; }
    public static function greaterThan(mixed $a, mixed $b): bool { return self::compare($a, $b) > 0; }
    public static function greaterThanOrEquals(mixed $a, mixed $b): bool { return self::compare($a, $b) >= 0; }

    public static function startsWith(mixed $a, mixed $b): bool
    {
        return $a !== null && $b !== null && str_starts_with(self::text($a), self::text($b));
    }

    public static function endsWith(mixed $a, mixed $b): bool
    {
        return $a !== null && $b !== null && str_ends_with(self::text($a), self::text($b));
    }

    /** Arithmetic of a derived projection: an unknown side keeps it unknown. */
    private static function arithmetic(mixed $a, mixed $b, \\Closure $fn): int|float|null
    {
        if ($a === null || $b === null) {
            return null;
        }
        return $fn(self::number($a, 'A computation'), self::number($b, 'A computation'));
    }

    public static function add(mixed $a, mixed $b): int|float|null { return self::arithmetic($a, $b, static fn ($x, $y) => $x + $y); }
    public static function subtract(mixed $a, mixed $b): int|float|null { return self::arithmetic($a, $b, static fn ($x, $y) => $x - $y); }
    public static function multiply(mixed $a, mixed $b): int|float|null { return self::arithmetic($a, $b, static fn ($x, $y) => $x * $y); }
    public static function min(mixed $a, mixed $b): int|float|null { return self::arithmetic($a, $b, static fn ($x, $y) => \\min($x, $y)); }
    public static function max(mixed $a, mixed $b): int|float|null { return self::arithmetic($a, $b, static fn ($x, $y) => \\max($x, $y)); }

    /** A value as text, the way a tag or a string comparison reads it. */
    public static function text(mixed $value): string
    {
        return match (true) {
            is_string($value) => $value,
            is_bool($value) => $value ? 'true' : 'false',
            $value === null => 'null',
            is_int($value), is_float($value) => (string) $value,
            default => (string) json_encode($value),
        };
    }

    /** One tag, written through its type's tag schema — a read needs a value for it. */
    public static function tag(string $type, mixed $value, string $what, ?string $field = null): string
    {
        if ($value === null) {
            throw new EvaluationError("{$what} has no value (null).");
        }
        if (is_array($value) && array_is_list($value)) {
            throw new EvaluationError("{$what} takes one value, not a list.");
        }
        return Model::renderTag($type, $field !== null ? ($value[$field] ?? null) : $value);
    }

    public static function read(ProjectionDefinition $projection, array $tags, array $args = []): Read
    {
        return new Read($projection, $tags, $args);
    }

    /** A read made once per element of a list — one fold, and one query item, each. */
    public static function readEach(ProjectionDefinition $projection, mixed $elements, \\Closure $tagsOf, array $args = []): Read
    {
        return new Read($projection, [], $args, array_map($tagsOf, self::asList($elements)));
    }

    /** A rule over fanned reads holds for every instance — vacuously for none. */
    public static function every(array $lists, \\Closure $held): bool
    {
        if (\\count(array_unique(array_map(\\count(...), $lists))) > 1) {
            throw new EvaluationError('A rule reads fanned-out lists of different lengths, so there is no pairing to check.');
        }
        for ($i = 0; $i < \\count($lists[0] ?? []); $i++) {
            if (!$held($i)) {
                return false;
            }
        }
        return true;
    }

    /** A fanned read, read whole: a list of lists flattens. */
    public static function flat(array $values): array
    {
        foreach ($values as $value) {
            if (is_array($value) && array_is_list($value)) {
                return array_merge(...array_map(self::asList(...), $values));
            }
        }
        return $values;
    }

    public static function argument(array $args, string $name, ?string $command): mixed
    {
        if (array_key_exists($name, $args)) {
            return $args[$name];
        }
        if ($command === null) {
            return null;
        }
        throw new EvaluationError(sprintf('"%s" needs a value for "%s".', $command, $name));
    }
}

/** An event as a fold reads it: its type, its object and its tags. */
final readonly class Folded
{
    /** @param list<string> $tags */
    public function __construct(public string $type, public DomainEvent $event, public array $tags) {}
}

interface ProjectionDefinition
{
    /** @return list<DcbQueryItem> the query a read by these tags makes */
    public function queryItems(array $tags): array;

    /** @param list<Folded> $events */
    public function fold(array $events, array $tags, array $args = []): mixed;
}

/** A projection folds the events its own query matches: one of its handled types, carrying all of its tags. */
final readonly class Projection implements ProjectionDefinition
{
    /** @param array<string, \\Closure(mixed, DomainEvent): mixed> $when */
    public function __construct(
        public string $name,
        private \\Closure $tags,
        private mixed $initialState,
        private array $when,
    ) {}

    public function queryItems(array $tags): array
    {
        $wanted = ($this->tags)($tags);
        if ($this->when === []) {
            return [];
        }
        return [DcbQueryItem::create(eventTypes: array_keys($this->when), tags: $wanted === [] ? null : $wanted)];
    }

    public function fold(array $events, array $tags, array $args = []): mixed
    {
        $wanted = ($this->tags)($tags);
        $state = $this->initialState;
        foreach ($events as $folded) {
            if (!array_key_exists($folded->type, $this->when) || array_diff($wanted, $folded->tags) !== []) {
                continue;
            }
            $state = ($this->when[$folded->type])($state, $folded->event);
        }
        return $state;
    }
}

/** A derived projection reads its operands and makes one value of them; its query is theirs, each under its own tags. */
final readonly class Derived implements ProjectionDefinition
{
    public function __construct(
        public string $name,
        private \\Closure $tags,
        private \\Closure $operands,
        private \\Closure $value,
    ) {}

    public function queryItems(array $tags): array
    {
        ($this->tags)($tags);
        $items = [];
        foreach (($this->operands)($tags) as $operand) {
            if ($operand instanceof Read) {
                array_push($items, ...$operand->queryItems());
            }
        }
        return $items;
    }

    public function fold(array $events, array $tags, array $args = []): mixed
    {
        ($this->tags)($tags);
        $values = array_map(static fn (mixed $o) => $o instanceof Read ? $o->fold($events) : $o, ($this->operands)($tags));
        return ($this->value)(...$values);
    }
}

final readonly class NotExportedProjection implements ProjectionDefinition
{
    public function __construct(private string $what, private string $reason) {}

    public function queryItems(array $tags): array { throw new NotExported($this->what, $this->reason); }

    public function fold(array $events, array $tags, array $args = []): mixed { throw new NotExported($this->what, $this->reason); }
}

/** One read of a projection — by tags, or once per element of a list. */
final readonly class Read
{
    public function __construct(
        public ProjectionDefinition $projection,
        public array $tags,
        public array $args = [],
        public ?array $each = null,
    ) {}

    /** @return list<DcbQueryItem> */
    public function queryItems(): array
    {
        $items = [];
        foreach ($this->each ?? [$this->tags] as $tags) {
            array_push($items, ...$this->projection->queryItems($tags));
        }
        return $items;
    }

    public function fold(array $events): mixed
    {
        if ($this->each === null) {
            return $this->projection->fold($events, $this->tags, $this->args);
        }
        return array_map(fn (array $tags) => $this->projection->fold($events, $tags, $this->args), $this->each);
    }
}

/**
 * The reads of one decision, in rounds — a later round's tags may be an
 * earlier round's answers. Every query it ran becomes the append
 * condition, ORed. One round appends after the last event it saw; more
 * read the store's head first, see the store only up to it, and append
 * after it — so the decision reads one state.
 */
final class DecisionModel
{
    /** @var list<DcbQueryItem> */
    private array $items = [];
    private ?int $after = null;
    private bool $headRead = false;

    public function __construct(private readonly DcbEventStore $store, private readonly int $rounds) {}

    /** @param array<string, Read> $reads */
    public function read(array $reads): array
    {
        $items = [];
        foreach ($reads as $read) {
            array_push($items, ...$read->queryItems());
        }
        $events = [];
        if ($items !== []) {
            if ($this->rounds > 1 && !$this->headRead) {
                $this->headRead = true;
                $this->after = $this->store->read(DcbQuery::all(), DcbReadOptions::create(limit: 1, backwards: true))->first()?->position->value;
            }
            foreach ($this->store->read(DcbQuery::fromItems(...$items)) as $sequenced) {
                $position = $sequenced->position->value;
                if ($this->rounds > 1 && ($this->after === null || $position > $this->after)) {
                    continue;
                }
                if ($this->rounds === 1) {
                    $this->after = max($this->after ?? 0, $position);
                }
                $folded = Model::decode($sequenced);
                if ($folded !== null) {
                    $events[] = $folded;
                }
            }
            array_push($this->items, ...$items);
        }
        return array_map(static fn (Read $read) => $read->fold($events), $reads);
    }

    public function appendCondition(): ?DcbAppendCondition
    {
        return $this->items === [] ? null : DcbAppendCondition::create(DcbQuery::fromItems(...$this->items), $this->after);
    }
}`;

const CODE_PHP_MODEL_METHODS = `    public static function renderTag(string $type, mixed $value): string
    {
        $schema = self::TAG_SCHEMAS[$type] ?? '{type}:{value}';
        foreach (['{type}' => $type, '{value}' => Runtime::text($value)] as $placeholder => $text) {
            $at = strpos($schema, $placeholder);
            if ($at !== false) {
                $schema = substr_replace($schema, $text, $at, strlen($placeholder));
            }
        }
        return $schema;
    }

    /** @return list<string> the tags an event of \`$type\` carries, read off its payload */
    public static function tagsOf(string $type, array $data): array
    {
        $tags = [];
        foreach (self::EVENT_TAGS[$type] ?? [] as $leaf) {
            $held = $data[$leaf['property']] ?? null;
            foreach ($leaf['isList'] ? Runtime::asList($held) : [$held] as $element) {
                $value = $leaf['field'] !== null ? (is_array($element) ? ($element[$leaf['field']] ?? null) : null) : $element;
                if ($value !== null) {
                    $tags[] = self::renderTag($leaf['tagType'], $value);
                }
            }
        }
        return array_values(array_unique($tags));
    }

    public static function toStoreEvent(DomainEvent $event): DcbEvent
    {
        $data = $event->toArray();
        return DcbEvent::create($event::TYPE, $data === [] ? '{}' : $data, self::tagsOf($event::TYPE, $data));
    }

    /** A stored event as a fold reads it, or null for a type this model does not define. */
    public static function decode(DcbSequencedEvent $sequenced): ?Folded
    {
        $type = $sequenced->event->type->value;
        $class = self::EVENT_CLASSES[$type] ?? null;
        if ($class === null) {
            return null;
        }
        return new Folded($type, $class::fromArray($sequenced->event->data->jsonDecode()), $sequenced->event->tags->toStrings());
    }`;

const CODE_PHP_APP = `
// ---- The application ----------------------------------------------

/** The model, driven against an event store. */
final readonly class App
{
    public function __construct(private DcbEventStore $store) {}

    public function decide(string $command, array $args = []): Accepted|Rejected
    {
        return Commands::decide($this->store, $command, $args);
    }

    /** Decides, and appends what was published under the decision's append condition. */
    public function handle(string $command, array $args = []): Accepted|Rejected
    {
        $decision = $this->decide($command, $args);
        if ($decision instanceof Accepted && $decision->events !== []) {
            $this->store->append(DcbEvents::fromArray(array_map(Model::toStoreEvent(...), $decision->events)), $decision->appendCondition);
        }
        return $decision;
    }

    /** A projection's current value, read by its tags. */
    public function project(string $name, array $tags = [], array $args = []): mixed
    {
        $read = Runtime::read(Projections::byName($name), $tags, $args);
        $items = $read->queryItems();
        $events = [];
        if ($items !== []) {
            foreach ($this->store->read(DcbQuery::fromItems(...$items)) as $sequenced) {
                $folded = Model::decode($sequenced);
                if ($folded !== null) {
                    $events[] = $folded;
                }
            }
        }
        return $read->fold($events);
    }
}`;

const CODE_PHP_SCENARIO_RUNNER = `
    private static function given(array $events): App
    {
        $store = DcbInMemoryEventStore::create();
        foreach ($events as [$type, $data]) {
            $store->append(DcbEvent::create($type, $data === [] ? '{}' : $data, Model::tagsOf($type, $data)));
        }
        return new App($store);
    }

    private static function decided(App $app, string $command, array $args): array
    {
        $decision = $app->handle($command, $args);
        if ($decision instanceof Rejected) {
            return ['rejected' => $decision->reason];
        }
        return ['published' => array_map(static fn (DomainEvent $e) => ['type' => $e::TYPE, 'data' => $e->toArray()], $decision->events)];
    }

    private static function same(mixed $actual, mixed $expected): ?string
    {
        return Runtime::equals($actual, $expected) ? null : sprintf('expected %s, got %s', json_encode($expected), json_encode($actual));
    }

    /** Runs every scenario, TAP-style; the exit code is the number that failed. */
    public static function run(): int
    {
        $failed = 0;
        foreach (self::all() as $n => [$name, $skip, $check]) {
            $label = ($n + 1) . ' - ' . $name;
            if ($skip !== null) {
                echo "ok {$label} # SKIP {$skip}\\n";
                continue;
            }
            try {
                $problem = $check();
            } catch (\\Throwable $e) {
                $problem = get_class($e) . ': ' . $e->getMessage();
            }
            if ($problem === null) {
                echo "ok {$label}\\n";
            } else {
                $failed++;
                echo "not ok {$label}\\n  # {$problem}\\n";
            }
        }
        echo '1..' . \\count(self::all()) . "\\n";
        return min($failed, 255);
    }`;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { codePlan, generateCode, CODE_TARGETS };
}
