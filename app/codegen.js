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
// options) }`. Only the plan is read: a printer that needed the model
// would be deciding semantics.
// ============================================================

const CODE_TARGETS = {
  js: { label: 'JavaScript', extension: '.js', runsScripts: true, print: (plan, options) => codePrintJs(plan, options) },
};

// The export: `{ text, extension, stubs }`. Options, all optional:
//   target          'js' (the only one so far)
//   includeTests    the model's scenarios as node:test tests
//   includeAdapter  the in-memory event store (implied by tests)
//   docComments     each command's derived boundary, as a comment
//   sandboxSteps    `[{ command, args }]` to replay into a store
function generateCode(model, options = {}) {
  const target = CODE_TARGETS[options.target || 'js'];
  if (!target) throw new Error(`No code target "${options.target}".`);
  const plan = codePlan(model, { ...options, scripts: !!target.runsScripts });
  return { text: target.print(plan, options), extension: target.extension, stubs: plan.stubs };
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { codePlan, generateCode, CODE_TARGETS };
}
