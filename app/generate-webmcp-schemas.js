// ============================================================
// Writes webmcp-schemas.js — the per-kind definition schemas the
// WebMCP tools hand to an agent — out of dcb-model.schema.json, the
// canonical schema one directory up. Each kind gets its own schema:
// the definition's object shape (`{name, …body}`, exactly what a
// share envelope stores per definition) with every `$ref` inlined,
// because the consumers on the other side of WebMCP (Gemini's
// function calling, for one) do not resolve references — a schema
// has to say everything where it stands.
//
// Three references cannot be inlined and are cut deliberately:
//   - the external draft-2020-12 ref behind a custom type's opaque
//     `schema` becomes a permissive object, described in words;
//   - a cycle (a successor operand nests another handler operand) is
//     broken with a described permissive object at the point of
//     recursion;
//   - a projection read in place is written compactly, its shape said
//     in words rather than inlined: any operand of a command may be
//     one, its tags are operands in turn, and inlining that at every
//     operand more than doubled a command's schema.
//
// The experimental members are cut before anything is inlined, since
// WebMCP does not offer them (see webmcp.js): no entity kind, and no
// schema so much as mentions an entity binding, a guard, a derived
// projection or `currentValue`. The
// canonical schema keeps them — a model using them still imports.
//
// Run with `node app/generate-webmcp-schemas.js` after changing
// dcb-model.schema.json. Nothing here runs in the browser; it is a
// one-time-per-change build step.
// ============================================================
const fs = require('fs');
const path = require('path');

const APP = __dirname;
const schema = JSON.parse(fs.readFileSync(path.join(APP, '..', 'dcb-model.schema.json'), 'utf8'));
const defs = schema.$defs;

// What the experimental flag keeps off the pages, as schema members:
// properties of a $def, and branches of a $def's choice. A name that
// is not there stops the build — the schema moved, and so must this.
const EXPERIMENTAL_PROPERTIES = {
  ProjectionDefinition: ['derived'],
  EventEmission: ['when'],
};
const EXPERIMENTAL_BRANCHES = {
  Binding: ['EntityBinding'],
  HandlerOperand: ['CurrentValue'],
};
for (const [name, properties] of Object.entries(EXPERIMENTAL_PROPERTIES)) {
  for (const property of properties) {
    if (!defs[name] || !defs[name].properties || !(property in defs[name].properties)) {
      throw new Error(`dcb-model.schema.json has no ${name}.${property} to cut`);
    }
    delete defs[name].properties[property];
    if (defs[name].required) defs[name].required = defs[name].required.filter((r) => r !== property);
  }
}
for (const [name, branches] of Object.entries(EXPERIMENTAL_BRANCHES)) {
  const choice = defs[name] && (defs[name].oneOf ? 'oneOf' : defs[name].anyOf ? 'anyOf' : null);
  if (!choice) throw new Error(`dcb-model.schema.json has no choice in ${name} to cut from`);
  const kept = defs[name][choice].filter((branch) => !branches.includes((branch.$ref || '').slice('#/$defs/'.length)));
  if (kept.length !== defs[name][choice].length - branches.length) {
    throw new Error(`${name} does not offer all of ${branches.join(', ')} to cut`);
  }
  // A choice of one is that one — its description, written to tell
  // the branches apart, would only mention what was cut.
  defs[name] = kept.length === 1 ? kept[0] : { ...defs[name], [choice]: kept };
}

// The six kinds an agent may author, each rooted at its $def.
const ROOTS = {
  'event-definition': 'EventDefinition',
  'projection-definition': 'ProjectionDefinition',
  'command-definition': 'CommandDefinition',
  'custom-type-definition': 'CustomTypeDefinition',
  'scenario-definition': 'ScenarioDefinition',
  'projection-scenario-definition': 'ProjectionScenarioDefinition',
};

// A value with every reference inlined. A `$ref`'s siblings (usually a
// site-specific description) win over what the referenced definition
// says for the same key — the words closest to the use are the ones
// written for it.
function inline(value, stack) {
  if (Array.isArray(value)) return value.map((item) => inline(item, stack));
  if (!value || typeof value !== 'object') return value;

  const { $ref, ...siblings } = value;
  if ($ref === undefined) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        // `const` and a one-member `enum` say the same thing, and the
        // consumers that choke on references tend to choke on `const`
        // too — say it the widely understood way.
        (k === 'const' ? ['enum', [v]] : [k, inline(v, stack)]))
    );
  }
  if (!$ref.startsWith('#/$defs/')) {
    // The one external ref — a custom type's `schema` is any JSON
    // Schema. Nothing downstream of WebMCP could fetch it anyway.
    return {
      type: 'object',
      description: ((siblings.description || '') + ' A JSON Schema object '
        + '(draft 2020-12) describing one value, e.g. {"type": "string"}.').trim(),
    };
  }
  const name = $ref.slice('#/$defs/'.length);
  if (!defs[name]) throw new Error(`dcb-model.schema.json has no $def "${name}"`);
  if (name === 'ProjectionRead') {
    return {
      type: 'object',
      description: ((siblings.description || '') + ' ' + defs[name].description.trim()
        + ' `tags`: one value per tag the projection declares, keyed by its name — an operand of'
        + ' the tag\'s type, a tag literal {tagType, tagValue}, or {each: operand}. `arguments`:'
        + ' the values a script takes, keyed by name.').trim(),
      properties: {
        projection: { type: 'string' },
        tags: { type: 'object' },
        arguments: { type: 'object' },
      },
      required: ['projection'],
    };
  }
  if (stack.includes(name)) {
    return {
      type: 'object',
      description: ((siblings.description || '') + ` Recursive: a nested ${name}, `
        + 'the same shape as the one this appears inside.').trim(),
    };
  }
  return { ...inline(defs[name], [...stack, name]), ...inline(siblings, stack) };
}

// The Anthropic API refuses oneOf/anyOf/allOf at the *top level* of a
// tool's input schema (nested is fine). The one place the model schema
// has one — a custom type is scalar (`schema`) xor composite
// (`properties`) — alternates only the `required` list, so it flattens
// losslessly: keep what every branch requires, say the alternation in
// words. Anything more elaborate arriving here should stop the build
// rather than be silently mistranslated.
function flattenTopLevelChoice(schema, kind) {
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const branches = schema[key];
    if (!branches) continue;
    if (key === 'allOf'
        || !branches.every((b) => Object.keys(b).every((k) => k === 'required'))) {
      throw new Error(`${kind}: top-level ${key} is more than a required-alternation — `
        + 'decide how to flatten it before regenerating');
    }
    const common = branches.map((b) => b.required)
      .reduce((a, b) => a.filter((r) => b.includes(r)));
    const alternates = branches
      .map((b) => b.required.filter((r) => !common.includes(r)))
      .map((extra) => extra.map((r) => '`' + r + '`').join(' + '));
    const { [key]: _, ...rest } = schema;
    return {
      ...rest,
      required: common,
      description: ((rest.description || '') + '\n'
        + `${key === 'oneOf' ? 'Exactly' : 'At least'} one of ${alternates.join(' or ')} `
        + 'is required as well.').trim(),
    };
  }
  return schema;
}

// WebMCP auditors (and the stricter function-calling consumers) read a
// tool argument's `type` and nothing else, so a top-level property
// that says what it admits only through `oneOf`/`anyOf` — an initial
// value — or not at all — what a projection scenario expects — reads
// as having no type. Each such property is given the union of what it
// admits, beside the choice it already states: a restatement, never a
// narrowing. Nested properties are left alone; nothing reads them that
// way.
const ANY_TYPE = ['string', 'number', 'boolean', 'array', 'object', 'null'];
function admittedTypes(node) {
  if (node.type !== undefined) return [].concat(node.type);
  const branches = node.oneOf || node.anyOf;
  if (!branches) return ANY_TYPE;
  const types = new Set(branches.flatMap(admittedTypes));
  return ANY_TYPE.filter((t) => types.has(t))
    .concat(types.has('integer') && !types.has('number') ? ['integer'] : []);
}
function typeTopLevelProperties(schema) {
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(schema.properties).map(([name, prop]) =>
      [name, prop.type !== undefined ? prop : { type: admittedTypes(prop), ...prop }])),
  };
}

const out = {};
for (const [kind, rootName] of Object.entries(ROOTS)) {
  const root = defs[rootName];
  if (!root) throw new Error(`dcb-model.schema.json has no $def "${rootName}"`);
  out[kind] = typeTopLevelProperties(flattenTopLevelChoice(inline(root, [rootName]), kind));
}

// What this exists to guarantee: nothing referencing anything.
const flat = JSON.stringify(out);
if (flat.includes('"$ref"') || flat.includes('"$defs"')) {
  throw new Error('a $ref or $defs survived inlining — the consumers cannot resolve them');
}

const file = path.join(APP, 'webmcp-schemas.js');
const banner = [
  '// Generated by generate-webmcp-schemas.js from ../dcb-model.schema.json',
  '// — do not edit by hand; change the schema and regenerate.',
  '// Each entry is one definition kind\'s object shape ({name, …body} —',
  '// or {id, …body} for the id-keyed scenario kinds), every reference',
  '// inlined, ready to serve as a WebMCP tool\'s inputSchema.',
].join('\n');
fs.writeFileSync(file,
  banner + '\nconst WEBMCP_DEFINITION_SCHEMAS = ' + JSON.stringify(out, null, 2) + ';\n');
console.log('wrote', path.relative(APP, file),
  `(${Object.keys(out).length} kinds, ${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
