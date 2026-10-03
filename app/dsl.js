// ============================================================
// DCB Playground — the code view's language.
//
// The same definitions the pages edit, as text a developer can read top
// to bottom, grep, diff and paste: `modelToSource` prints a model,
// `parseModelSource` reads one back, `applyModelSource` writes the
// difference through `replaceDefinitions`. No DOM — the editor around
// it lives in index.html; the grammar Monaco highlights with is here,
// as data, so it cannot drift from the parser it describes.
//
//   model "Course Example (simple)"
//
//   tag type CourseId = string
//   enum CourseStatus { NonExistent, Existent, Archived }
//
//   event CourseDefined { courseId: CourseId, capacity: integer }
//
//   @icon("📚")
//   entity Course {
//     lifecycle status
//     status = CourseStatus
//     capacity = CourseCapacity
//   }
//
//   projection CourseCapacity(courseId: CourseId): integer = 0 {
//     on CourseDefined => set event.data.capacity
//   }
//
//   @feature("Course management")
//   command ChangeCourseCapacity(courseId: CourseId, newCapacity: integer) {
//     read course = Course[courseId]
//     require course.status == Existent
//     require course.capacity != newCapacity
//     emit CourseCapacityChanged { courseId, newCapacity }
//   }
//
// **It is a spelling of the wire format, not a second model.** Every
// construct maps to exactly one schema shape, which is what lets the
// two directions be each other's inverse; nothing is inferred that the
// JSON does not store. Where a convenience would have needed inference
// it was left out: a fan-out is not marked (it follows from the
// operand's type, as in the schema), and a read's alias is always
// written, since the schema stores it.
//
// **Borrowed, deliberately.** heklang (git.tqwewe.com/tephra/heklang)
// is DCB-native, and its `emit Event { field }` shorthand and `on
// Event => …` fold arms are taken as they are. Weltenwanderer
// (weltenwanderer.dev) contributes `require` and `type X = string`.
// Where both disagree with the wire format, the wire format wins:
// heklang's `fold` is a read *and* its accumulator in one place, here
// the accumulator is a named projection the read points at, because
// that is how the model stores it and how the pages show it. The
// research note is docs/research/2026-10-03-code-view-language.md.
//
// **A few spellings are the schema's own tokens**, matching the
// interface's technical register: `currentValue`, `successor(x)`,
// `event.data.x` (the path a scripted handler writes), the predicate
// words `contains` / `containsAny` / `startsWith` / `endsWith`, and the
// script fields `tagFilter` / `initialState` / `exposes`. The rest are
// what a developer would type: `==`, `<`, `in [..]`, `count(x)`,
// `is empty`, `X[]` for a list, `name?:` for an optional property, and
// `Course[courseId]` for an entity instance — brackets for "look one
// up by identifier", parentheses for a projection's arguments.
//
// **Operand names resolve per command.** A bare or dotted lowercase
// name is a read when some `read` in the same command declares it and
// a payload property otherwise — the schema keeps the two apart, a
// text can only do so by scope. A name that is neither (a dangling
// reference, which the model allows and advises about) reads as a
// property when bare and as a read when dotted, the common case of
// each.
//
// **Nothing is ever lost by printing.** Each definition is printed and
// then parsed back on the spot, and one that does not come back equal
// (`sameDefinition`) — a defective body, a name the grammar cannot
// write, a parameter and a read sharing a name — is printed as its
// stored JSON instead (`command Foo json { … }`), under a comment
// saying why. So the text always says everything the model does, and
// an untouched text applies as no change at all.
//
// **Scenarios sit in the block of what they exercise**, after its
// definition — a command's runs it, a projection's asserts its value:
//
//   scenario "a second definition is refused" {
//     given CourseDefined { courseId: "c1", capacity: 123 }
//     when DefineCourse { courseId: "c1", capacity: 123 }
//     then rejected by course.status == NonExistent saw Existent, NonExistent
//   }
//   scenario {
//     given CourseDefined { courseId: "c1", capacity: 1 }
//     then CourseStatus("c1") == Existent
//   }
//
// The subject is named (`when DefineCourse`, `then CourseStatus(…)`)
// and must be the block's — a scenario moved into the wrong block is an
// error, not a reassignment; one whose subject is gone sits at the top
// level. A Then is the scenario's assertion and is stored as written;
// leave it out and an apply records what the text's definitions make
// of it, the way the page's save does — and a refusal written without
// `saw` takes the values it was refused on. A Then that disagrees with
// the text is drift: shown, with a fix that accepts it, and never
// accepted by applying. Payload values are JSON, an enum member bare.
// The id a scenario is keyed by is not in the text: an apply matches
// blocks to stored scenarios by content, then by place, so an edited or
// renamed-along scenario keeps its id (`sourceScenarioCollections`).
//
// Comments are not stored — the model has nowhere to keep them — so
// they survive as long as the text in the editor does and no longer.
// ============================================================

const SOURCE_EXTENSION = '.dcb';

const SOURCE_KINDS = [
  'custom-type-definition',
  'event-definition',
  'entity-definition',
  'projection-definition',
  'command-definition',
];

const SOURCE_KEYWORD = {
  'custom-type-definition': 'type',
  'event-definition': 'event',
  'entity-definition': 'entity',
  'projection-definition': 'projection',
  'command-definition': 'command',
};

const SOURCE_SECTION = {
  'custom-type-definition': 'Types',
  'event-definition': 'Events',
  'entity-definition': 'Entities',
  'projection-definition': 'Projections',
  'command-definition': 'Commands',
};

// What the `= …` of `type X = …` may name without spelling a schema
// object out: JSON Schema's own `type` keywords.
const SOURCE_BASE_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];

// Which annotation goes on which kind, and the body field it fills.
const SOURCE_ANNOTATIONS = {
  icon: ['entity-definition', 'event-definition', 'command-definition'],
  feature: ['command-definition'],
  tagSchema: ['custom-type-definition'],
};

const SOURCE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_MEMBER_RE = /^[A-Z][A-Za-z0-9_]*$/;
const SOURCE_DECL_STARTS = ['@', 'model', 'type', 'tag', 'enum', 'record', 'event', 'entity', 'projection', 'command'];
const SOURCE_WORD_PREDICATES = ['contains', 'containsAny', 'startsWith', 'endsWith'];
const SOURCE_SYMBOL_PREDICATES = { '==': 'equals', '<': 'lessThan', '<=': 'lessThanOrEquals', '>': 'greaterThan', '>=': 'greaterThanOrEquals' };
const SOURCE_COUNT_PREDICATES = { '==': 'countEquals', '<': 'countLessThan', '>': 'countGreaterThan' };
const SOURCE_UNARY_WORDS = { isEmpty: 'is empty', isNotEmpty: 'is not empty', isTrue: 'is true', isFalse: 'is false' };

// A definition with no IDENT-safe name, or an object key that is not
// one, can still be put — `__proto__` is a legal identifier, and an
// assignment would set a prototype instead of a key.
function sourcePut(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// ============================================================
// Lexing.
// ============================================================

const SOURCE_PUNCT = ['=>', '==', '!=', '<=', '>=', '<', '>', '=', '{', '}', '(', ')', '[', ']', ',', ':', '.', '?', '@'];
const SOURCE_NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const SOURCE_WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

function lexSource(text) {
  const tokens = [];
  const diagnostics = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let lastLine = 0;
  const advanceTo = (stop) => {
    while (i < stop) {
      if (text[i] === '\n') { line += 1; col = 1; } else col += 1;
      i += 1;
    }
  };
  const report = (message, at) => diagnostics.push({
    severity: 'error', message, line: at.line, col: at.col, endLine: line, endCol: Math.max(col, at.col + 1),
  });
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { advanceTo(i + 1); continue; }
    const start = { line, col };
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      advanceTo(end < 0 ? text.length : end);
      continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      advanceTo(end < 0 ? text.length : end + 2);
      if (end < 0) report('This comment is never closed with */.', start);
      continue;
    }
    let token;
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3);
      const value = text.slice(i + 3, end < 0 ? text.length : end);
      advanceTo(end < 0 ? text.length : end + 3);
      if (end < 0) report('This code block is never closed with ```.', start);
      token = { t: 'code', v: value };
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (text[j] !== '"') {
        const value = text.slice(i + 1, j);
        advanceTo(j);
        report('This string is never closed with ".', start);
        token = { t: 'string', v: value };
      } else {
        const raw = text.slice(i, j + 1);
        advanceTo(j + 1);
        let value = raw.slice(1, -1);
        try { value = JSON.parse(raw); } catch { report('This string has an escape JSON does not know.', start); }
        token = { t: 'string', v: value };
      }
    } else if ((c >= '0' && c <= '9') || (c === '-' && text[i + 1] >= '0' && text[i + 1] <= '9')) {
      SOURCE_NUMBER_RE.lastIndex = i;
      const match = SOURCE_NUMBER_RE.exec(text);
      advanceTo(i + match[0].length);
      token = { t: 'number', v: Number(match[0]) };
    } else if (/[A-Za-z_]/.test(c)) {
      SOURCE_WORD_RE.lastIndex = i;
      const match = SOURCE_WORD_RE.exec(text);
      advanceTo(i + match[0].length);
      token = { t: 'ident', v: match[0] };
    } else {
      const punct = SOURCE_PUNCT.find((p) => text.startsWith(p, i));
      advanceTo(i + (punct ? punct.length : 1));
      if (!punct) { report(`"${c}" means nothing here.`, start); continue; }
      token = { t: 'punct', v: punct };
    }
    token.line = start.line;
    token.col = start.col;
    token.endLine = line;
    token.endCol = col;
    token.first = start.line !== lastLine;
    lastLine = line;
    tokens.push(token);
  }
  tokens.push({ t: 'eof', v: '', line, col, endLine: line, endCol: col, first: true });
  return { tokens, diagnostics };
}

// ============================================================
// Parsing.
// ============================================================

class SourceError extends Error {
  constructor(message, token) {
    super(message);
    this.token = token;
  }
}

function describeToken(token) {
  if (token.t === 'eof') return 'the end of the text';
  if (token.t === 'string') return 'a string';
  if (token.t === 'code') return 'a code block';
  return `"${token.v}"`;
}

// The text, read back: `{ name, collections, spans, diagnostics,
// implicit }`. `collections` holds one ordered `{ name: body }` map per
// source kind — the shape `replaceDefinitions` takes. `spans` says
// where each definition sits (1-based, Monaco's convention), for
// markers, navigation and the outline. `implicit` names the identifier
// types synthesized for entities whose type the text never declared:
// writing `entity Tenant {}` should not also require `tag type TenantId
// = string`, any more than creating one on its page does.
//
// Errors never stop the read: a declaration that fails is reported
// and skipped to the next line that starts one, so a typo in one
// command does not hide every other problem below it.
function parseModelSource(text, options = {}) {
  const { tokens, diagnostics } = lexSource(String(text));
  const collections = {};
  for (const kind of SOURCE_KINDS) collections[kind] = {};
  const result = { name: null, collections, spans: [], diagnostics, implicit: [], scenarios: [] };
  let at = 0;

  const peek = (k = 0) => tokens[Math.min(at + k, tokens.length - 1)];
  const next = () => {
    const token = tokens[at];
    if (at < tokens.length - 1) at += 1;
    return token;
  };
  const last = () => tokens[Math.max(0, at - 1)];
  const is = (v, k = 0) => {
    const token = peek(k);
    return (token.t === 'punct' || token.t === 'ident') && token.v === v;
  };
  const accept = (v) => (is(v) ? next() : null);
  const fail = (message, token = peek()) => { throw new SourceError(message, token); };
  const expect = (v, what) => accept(v) || fail(`Expected ${what || `"${v}"`}, found ${describeToken(peek())}.`);
  const ident = (what) => (peek().t === 'ident' ? next() : fail(`Expected ${what}, found ${describeToken(peek())}.`));
  const declName = (what) => (peek().t === 'ident' || peek().t === 'string'
    ? next() : fail(`Expected ${what}, found ${describeToken(peek())}.`));
  // A line that plainly opens the next declaration — a declaration
  // word followed by a name, or an annotation — ends whatever block is
  // still open, so a missing "}" is reported where it is missing
  // rather than as nonsense about the declaration below it. "Plainly",
  // because `type: string` is a property called type.
  const startsDeclaration = () => {
    const token = peek();
    if (!token.first) return false;
    if (token.t === 'punct') return token.v === '@' && peek(1).t === 'ident';
    return token.t === 'ident' && SOURCE_DECL_STARTS.includes(token.v)
      && (peek(1).t === 'ident' || peek(1).t === 'string');
  };
  const guardBlock = (close) => {
    if (!startsDeclaration()) return;
    const end = last();
    fail(`Expected "${close}" before the next declaration.`,
      { line: end.endLine, col: end.endCol, endLine: end.endLine, endCol: end.endCol + 1 });
  };
  const string = (what) => (peek().t === 'string' ? next().v : fail(`Expected ${what}, found ${describeToken(peek())}.`));

  // ---------- values ----------

  // JSON, read off the token stream — the schema object of a `type`,
  // a script's `initialState`, a definition's fallback body. Keys may
  // be bare words as well as strings; the printer writes them bare.
  const jsonValue = () => {
    const token = peek();
    if (token.t === 'string' || token.t === 'number') return next().v;
    if (accept('true')) return true;
    if (accept('false')) return false;
    if (accept('null')) return null;
    if (accept('{')) {
      const out = {};
      while (!is('}')) {
        const key = peek().t === 'string' || peek().t === 'ident'
          ? next().v : fail(`Expected a key, found ${describeToken(peek())}.`);
        expect(':');
        sourcePut(out, key, jsonValue());
        if (!accept(',')) break;
      }
      expect('}', '"}" or ","');
      return out;
    }
    if (accept('[')) {
      const out = [];
      while (!is(']')) {
        out.push(jsonValue());
        if (!accept(',')) break;
      }
      expect(']', '"]" or ","');
      return out;
    }
    return fail(`Expected a JSON value, found ${describeToken(token)}.`);
  };

  // A literal, an enum member, or a list of those — what an initial
  // value, an `in [..]` list and the literal side of any rule hold.
  const literalValue = () => {
    const token = peek();
    if (token.t === 'string' || token.t === 'number') return next().v;
    if (token.t === 'ident') {
      if (accept('true')) return true;
      if (accept('false')) return false;
      if (accept('null')) return null;
      if (token.v === 'enum' && is('(', 1)) {
        next(); next();
        const member = literalValue();
        expect(')');
        return { enumMember: member };
      }
      if (SOURCE_MEMBER_RE.test(token.v)) return { enumMember: next().v };
    }
    if (accept('[')) {
      const out = [];
      while (!is(']')) {
        out.push(literalValue());
        if (!accept(',')) break;
      }
      expect(']', '"]" or ","');
      return out;
    }
    return fail(`Expected a value, found ${describeToken(token)}.`);
  };
  const startsLiteral = () => {
    const token = peek();
    if (token.t === 'string' || token.t === 'number' || is('[')) return true;
    return token.t === 'ident'
      && (['true', 'false', 'null', 'enum'].includes(token.v) || SOURCE_MEMBER_RE.test(token.v));
  };

  // A name in a command, resolved once the whole command is read —
  // which `read` declares it is not known until then.
  const nameRef = () => {
    const head = next().v;
    if (accept('.')) return { '%ref': [head, ident('a property name').v] };
    return { '%ref': [head] };
  };

  const commandOperand = () => {
    const token = peek();
    if (token.t === 'ident' && !startsLiteral()) return nameRef();
    return literalValue();
  };

  // A derived projection's operand: another projection's value, read at
  // the arguments given, or a parameter of the owning projection.
  const derivedOperand = () => {
    const token = peek();
    if (token.t === 'ident' && SOURCE_MEMBER_RE.test(token.v) && is('(', 1)) {
      const projection = next().v;
      expect('(');
      return { projection, arguments: argumentList(')', derivedOperand) };
    }
    if (token.t === 'ident' && !startsLiteral()) {
      const head = next().v;
      if (accept('.')) return { parameterName: head, property: ident('a property name').v };
      return { parameterName: head };
    }
    return literalValue();
  };

  const handlerOperand = () => {
    if (is('event')) {
      next(); expect('.'); expect('data', '"data" — an event value is read as event.data.<property>'); expect('.');
      return { eventProperty: ident('an event property').v };
    }
    if (accept('currentValue')) return { currentValue: true };
    if (is('successor') && is('(', 1)) {
      next(); next();
      const inner = handlerOperand();
      expect(')');
      return { successor: inner };
    }
    return literalValue();
  };
  const startsHandlerOperand = () => startsLiteral() || is('event') || is('currentValue') || is('successor');

  // `name: operand` pairs — or a bare `name`, short for `name: name`.
  const argumentList = (close, operand) => {
    const out = {};
    while (!is(close)) {
      guardBlock(close);
      const key = ident('an argument name');
      if (accept(':')) sourcePut(out, key.v, operand());
      else {
        // The shorthand is the operand the bare name would have been.
        at -= 1;
        sourcePut(out, key.v, operand());
      }
      if (!accept(',')) break;
    }
    expect(close, `"${close}" or ","`);
    return out;
  };

  // ---------- rules ----------

  const condition = (operand) => {
    let negate = false;
    while (accept('not')) negate = !negate;
    if (is('count') && is('(', 1)) {
      next(); next();
      const leftHandSide = operand();
      expect(')');
      const op = peek();
      let predicate = SOURCE_COUNT_PREDICATES[op.v];
      if (op.t === 'punct' && op.v === '!=') { predicate = 'countEquals'; negate = !negate; }
      if (op.t !== 'punct' || !predicate) fail(`Expected ==, !=, < or > after count(…), found ${describeToken(op)}.`);
      next();
      return finish({ leftHandSide, predicate, rightHandSide: operand() }, negate);
    }
    const leftHandSide = operand();
    if (accept('is')) {
      let predicate;
      if (accept('not')) { expect('empty', '"empty" — the one thing "is not" is followed by'); predicate = 'isNotEmpty'; }
      else if (accept('empty')) predicate = 'isEmpty';
      else if (accept('true')) predicate = 'isTrue';
      else if (accept('false')) predicate = 'isFalse';
      else fail(`Expected empty, not empty, true or false after "is", found ${describeToken(peek())}.`);
      return finish({ leftHandSide, predicate }, negate);
    }
    const op = peek();
    if (op.t === 'punct' && (SOURCE_SYMBOL_PREDICATES[op.v] || op.v === '!=')) {
      next();
      if (op.v === '!=') negate = !negate;
      return finish({ leftHandSide, predicate: SOURCE_SYMBOL_PREDICATES[op.v] || 'equals', rightHandSide: operand() }, negate);
    }
    if (accept('not')) negate = !negate;
    if (accept('in')) {
      if (!is('[')) fail(`Expected a list after "in", found ${describeToken(peek())}.`);
      return finish({ leftHandSide, predicate: 'equalsAny', rightHandSide: literalValue() }, negate);
    }
    const word = peek();
    if (word.t === 'ident' && SOURCE_WORD_PREDICATES.includes(word.v)) {
      next();
      return finish({ leftHandSide, predicate: word.v, rightHandSide: operand() }, negate);
    }
    return fail(`Expected a comparison (==, !=, <, <=, >, >=, in, contains, containsAny, startsWith, `
      + `endsWith, is …), found ${describeToken(word)}.`);
  };
  const finish = (rule, negate) => (negate ? { ...rule, negate: true } : rule);

  // ---------- declarations ----------

  const propertyList = (close) => {
    const out = [];
    while (!is(close)) {
      guardBlock(close);
      const name = ident('a property name').v;
      const isOptional = !!accept('?');
      expect(':');
      const propertyType = ident('a type').v;
      const isList = !!(accept('[') && expect(']'));
      out.push({ name, propertyType, isOptional, isList });
      if (!accept(',') && !is(close) && peek().t !== 'ident') break;
    }
    expect(close, `"${close}"`);
    return out;
  };

  const parameterList = (close) => {
    const out = [];
    while (!is(close)) {
      guardBlock(close);
      const name = ident('a parameter name').v;
      expect(':');
      out.push({ name, propertyType: ident('a type').v });
      if (!accept(',')) break;
    }
    expect(close, `"${close}" or ","`);
    return out;
  };

  const define = (kind, nameToken, body, startToken) => {
    const coll = collections[kind];
    const name = nameToken.v;
    if (Object.prototype.hasOwnProperty.call(coll, name)) {
      diagnostics.push({
        severity: 'error',
        message: `A ${SOURCE_KEYWORD[kind]} named "${name}" is already defined above — one of the two has to go.`,
        line: nameToken.line, col: nameToken.col, endLine: nameToken.endLine, endCol: nameToken.endCol,
      });
      return;
    }
    sourcePut(coll, name, body);
    const end = last();
    result.spans.push({
      kind, name,
      line: startToken.line, col: startToken.col, endLine: end.endLine, endCol: end.endCol,
      nameLine: nameToken.line, nameCol: nameToken.col, nameEndCol: nameToken.endCol,
    });
  };

  // `kind NAME json { … }` — the stored body, whole. What the printer
  // falls back to for anything it cannot say, and a way to write what
  // the grammar does not cover yet.
  const jsonBody = () => {
    next();
    const body = jsonValue();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail('A json body must be an object.', last());
    return body;
  };

  const annotate = (kind, body, annotations) => {
    for (const { name, value, token } of annotations) {
      const allowed = Object.prototype.hasOwnProperty.call(SOURCE_ANNOTATIONS, name) ? SOURCE_ANNOTATIONS[name] : null;
      if (!allowed) fail(`There is no @${name} — the annotations are @icon, @feature and @tagSchema.`, token);
      if (!allowed.includes(kind)) fail(`A ${SOURCE_KEYWORD[kind]} carries no @${name}.`, token);
      if (body[name] !== undefined) fail(`@${name} is given twice.`, token);
      body[name] = value;
    }
    return body;
  };

  const customType = (start, annotations, isTag) => {
    const keyword = next().v;
    const nameToken = declName('a type name');
    let body;
    if (is('json')) body = jsonBody();
    else if (keyword === 'enum') {
      expect('{');
      const members = [];
      while (!is('}')) {
        guardBlock('}');
        members.push(peek().t === 'string' ? next().v : ident('an enum member').v);
        if (!accept(',') && peek().t !== 'ident' && peek().t !== 'string') break;
      }
      expect('}', '"}" or ","');
      body = { schema: { type: 'string', enum: members } };
    } else if (keyword === 'record') {
      expect('{');
      const properties = [];
      while (!is('}')) {
        guardBlock('}');
        const name = ident('a field name').v;
        expect(':');
        properties.push({ name, propertyType: ident('a type').v });
        if (is('[') || is('?')) fail('A record field is always one required value — a list or an optional field cannot be zipped.');
        if (!accept(',') && peek().t !== 'ident') break;
      }
      expect('}', '"}" or ","');
      body = { properties };
    } else {
      expect('=');
      if (is('{')) body = { schema: jsonValue() };
      else {
        const base = ident('a base type');
        if (!SOURCE_BASE_TYPES.includes(base.v)) {
          fail(`A value type is one of ${SOURCE_BASE_TYPES.join(', ')} — or a JSON Schema object — `
            + `not "${base.v}". (A record of fields is written "record ${nameToken.v} { … }".)`, base);
        }
        const schema = { type: base.v };
        if (is('{')) {
          const rest = jsonValue();
          for (const key of Object.keys(rest)) sourcePut(schema, key, rest[key]);
        }
        body = { schema };
      }
    }
    if (isTag) body.isTag = true;
    define('custom-type-definition', nameToken, annotate('custom-type-definition', body, annotations), start);
  };

  const eventDecl = (start, annotations) => {
    next();
    const nameToken = declName('an event name');
    if (is('json')) return define('event-definition', nameToken, annotate('event-definition', jsonBody(), annotations), start);
    expect('{');
    const body = { properties: propertyList('}') };
    return define('event-definition', nameToken, annotate('event-definition', body, annotations), start);
  };

  const entityDecl = (start, annotations) => {
    next();
    const nameToken = declName('an entity name');
    if (is('json')) return define('entity-definition', nameToken, annotate('entity-definition', jsonBody(), annotations), start);
    const body = {};
    if (accept('[')) {
      body.identifierType = ident('the identifier type').v;
      expect(']');
    }
    expect('{');
    body.properties = [];
    while (!is('}')) {
      guardBlock('}');
      if (is('lifecycle') && peek(1).t === 'ident' && !is('=', 1)) {
        next();
        if (body.lifecycle !== undefined) fail('An entity has one lifecycle.', last());
        body.lifecycle = ident('the lifecycle property').v;
      } else {
        const name = ident('a property name, or "lifecycle"').v;
        expect('=', '"=" and the projection this property is');
        body.properties.push({ name, projection: ident('a projection name').v });
      }
      accept(',');
    }
    expect('}');
    return define('entity-definition', nameToken, annotate('entity-definition', body, annotations), start);
  };

  const projectionDecl = (start, annotations) => {
    next();
    const nameToken = declName('a projection name');
    if (is('json')) return define('projection-definition', nameToken, annotate('projection-definition', jsonBody(), annotations), start);
    annotate('projection-definition', {}, annotations);
    const body = {};
    if (accept('(')) body.parameters = parameterList(')');
    expect(':', '":" and the type it holds');
    body.valueType = ident('the type it holds').v;
    body.isList = !!(accept('[') && expect(']'));
    if (accept('=')) body.initialValue = literalValue();
    if (accept('derived')) body.derived = condition(derivedOperand);
    if (accept('{')) {
      const handlers = [];
      let script = null;
      const scriptField = (key, value) => {
        script = script || {};
        if (script[key] !== undefined) fail(`${key} is given twice.`, last());
        script[key] = value;
      };
      while (!is('}')) {
        guardBlock('}');
        if (accept('on')) {
          const event = ident('an event name').v;
          expect('=>');
          if (peek().t === 'code') handlers.push({ event, code: next().v });
          else {
            const op = ident('an operation (set, increment, decrement, append, remove) or a ```code``` block');
            if (!OPERATIONS.includes(op.v)) {
              fail(`"${op.v}" is not an operation — set, increment, decrement, append or remove.`, op);
            }
            const handler = { event, operation: op.v };
            if (startsHandlerOperand()) handler.value = handlerOperand();
            handlers.push(handler);
          }
        } else if (accept('script')) {
          expect('(');
          scriptField('arguments', parameterList(')'));
        } else if (accept('tagFilter')) {
          const filter = jsonValue();
          if (!Array.isArray(filter)) fail('tagFilter is a list of strings.', last());
          scriptField('tagFilter', filter);
        } else if (accept('initialState')) {
          scriptField('initialState', jsonValue());
        } else if (accept('exposes')) {
          scriptField('exposes', ident('the exposed field').v);
        } else if (is('scenario')) {
          scenarioDecl(peek(), { kind: 'projection-definition', name: nameToken.v });
        } else {
          fail(`Expected "on", scenario, or one of script, tagFilter, initialState, exposes, found ${describeToken(peek())}.`);
        }
      }
      expect('}');
      body.handlers = handlers;
      if (script) body.script = script;
    }
    return define('projection-definition', nameToken, body, start);
  };

  const commandDecl = (start, annotations) => {
    next();
    const nameToken = declName('a command name');
    if (is('json')) return define('command-definition', nameToken, annotate('command-definition', jsonBody(), annotations), start);
    const body = annotate('command-definition', {}, annotations);
    expect('(', '"(" and the payload');
    body.properties = propertyList(')');
    expect('{');
    body.boundary = [];
    body.conditions = [];
    body.publishes = [];
    while (!is('}')) {
      guardBlock('}');
      if (accept('read')) {
        const alias = ident('the name it is read as').v;
        const isOptional = !!accept('?');
        expect('=');
        const target = ident('an entity or a projection');
        let binding;
        if (accept('[')) {
          binding = { alias, entity: target.v, id: commandOperand() };
          expect(']');
          if (accept('excluding')) binding.excluding = commandOperand();
          if (accept('with')) {
            expect('(');
            binding.arguments = argumentList(')', commandOperand);
          }
        } else {
          expect('(', '"[" and an identifier (an entity), or "(" (a projection)');
          binding = { alias, projection: target.v, arguments: argumentList(')', commandOperand) };
        }
        if (isOptional) binding.isOptional = true;
        body.boundary.push(binding);
      } else if (accept('require')) {
        body.conditions.push(condition(commandOperand));
      } else if (accept('emit')) {
        const emission = { name: ident('an event name').v };
        if (accept('{')) emission.parameters = argumentList('}', commandOperand);
        if (accept('when')) {
          emission.when = [condition(commandOperand)];
          while (accept('and')) emission.when.push(condition(commandOperand));
        }
        body.publishes.push(emission);
      } else if (is('scenario')) {
        scenarioDecl(peek(), { kind: 'command-definition', name: nameToken.v });
      } else {
        fail(`Expected read, require, emit or scenario, found ${describeToken(peek())}.`);
      }
    }
    expect('}');
    resolveCommandNames(body);
    return define('command-definition', nameToken, body, start);
  };

  const resolveCommandNames = (body) => {
    const aliases = new Set(body.boundary.map((b) => b.alias));
    const parameters = new Set(body.properties.map((p) => p.name));
    const resolve = (value) => {
      if (Array.isArray(value)) return value.map(resolve);
      if (value === null || typeof value !== 'object') return value;
      if (value['%ref']) {
        const [head, property] = value['%ref'];
        const asRead = aliases.has(head) || (!parameters.has(head) && property !== undefined);
        if (asRead) return property === undefined ? { alias: head } : { alias: head, property };
        return property === undefined ? { parameterName: head } : { parameterName: head, property };
      }
      const out = {};
      for (const key of Object.keys(value)) sourcePut(out, key, resolve(value[key]));
      return out;
    };
    for (const key of ['boundary', 'conditions', 'publishes']) body[key] = resolve(body[key]);
  };

  // ---------- scenarios ----------

  // A payload value: JSON, except that a bare capitalised word is an
  // enum member and reads as the string it is stored as.
  const scenarioValue = () => {
    const token = peek();
    if (token.t === 'ident' && SOURCE_MEMBER_RE.test(token.v)) return next().v;
    if (accept('{')) {
      const out = {};
      while (!is('}')) {
        const key = peek().t === 'string' || peek().t === 'ident'
          ? next().v : fail(`Expected a property name, found ${describeToken(peek())}.`);
        expect(':');
        sourcePut(out, key, scenarioValue());
        if (!accept(',')) break;
      }
      expect('}', '"}" or ","');
      return out;
    }
    if (accept('[')) {
      const out = [];
      while (!is(']')) {
        out.push(scenarioValue());
        if (!accept(',')) break;
      }
      expect(']', '"]" or ","');
      return out;
    }
    return jsonValue();
  };
  const payload = (what) => (is('{') ? scenarioValue() : fail(`Expected "{" and ${what}, found ${describeToken(peek())}.`));

  // A rule as its stored text — what a refusal records. The text does
  // not tell a read from a payload property apart (both print as
  // `a.b`), so names need no resolving to produce it.
  const ruleText = () => {
    const rule = condition(commandOperand);
    const plain = (value) => {
      if (Array.isArray(value)) return value.map(plain);
      if (value === null || typeof value !== 'object') return value;
      if (value['%ref']) {
        const [parameterName, property] = value['%ref'];
        return property === undefined ? { parameterName } : { parameterName, property };
      }
      const out = {};
      for (const key of Object.keys(value)) sourcePut(out, key, plain(value[key]));
      return out;
    };
    return conditionText(plain(rule));
  };

  const thenItem = () => {
    if (accept('nothing')) return { nothing: true };
    if (accept('rejected')) {
      expect('by', '"by" and the rule that refused');
      const text = peek().t === 'string' ? next().v : ruleText();
      const item = { rejected: { text } };
      if (accept('saw')) {
        item.rejected.leftValue = scenarioValue();
        item.rejected.rightValue = accept(',') ? scenarioValue() : null;
        item.saw = true;
      }
      if (accept('at')) {
        if (peek().t !== 'number') fail(`Expected which instance refused, a number, found ${describeToken(peek())}.`);
        item.rejected.atInstance = next().v;
        item.at = true;
      }
      return item;
    }
    const name = ident('an event, a projection, nothing or rejected');
    if (is('{')) return { event: name.v, data: scenarioValue() };
    const item = { projection: name.v, arguments: {}, positional: null, argsToken: peek(), subjectToken: name };
    if (accept('(')) {
      const named = {};
      const values = [];
      while (!is(')')) {
        if (peek().t === 'ident' && is(':', 1)) {
          const key = next().v;
          next();
          sourcePut(named, key, scenarioValue());
        } else values.push(scenarioValue());
        if (!accept(',')) break;
      }
      expect(')', '")" or ","');
      if (values.length && Object.keys(named).length) fail('Name every argument, or none of them.', item.argsToken);
      if (values.length) item.positional = values;
      else item.arguments = named;
    }
    if (accept('==')) item.value = scenarioValue();
    return item;
  };

  // `scenario ["name"] { given … when … then … }` — see the header. The
  // record keeps what an apply needs beyond the body: where it sits,
  // where its then lines are, and which parts were left to evaluation.
  const scenarioDecl = (start, block) => {
    next();
    const nameToken = peek().t === 'string' ? next() : null;
    const record = {
      block, head: start, thenRange: null, positional: null, argsToken: null,
      valuesMissing: false, atWritten: false,
    };
    let subjectToken = nameToken || start;
    if (is('json')) {
      const body = jsonBody();
      if (nameToken) body.name = nameToken.v;
      record.kind = body.projection !== undefined && body.command === undefined
        ? 'projection-scenario-definition' : 'scenario-definition';
      record.subject = record.kind === 'scenario-definition' ? body.command : body.projection;
      record.body = body;
    } else {
      expect('{');
      const given = [];
      let when = null;
      const thens = [];
      while (!is('}')) {
        guardBlock('}');
        if (accept('given')) {
          const event = ident('the event it was given').v;
          given.push({ event, data: payload('the event\'s payload') });
        } else if (is('when')) {
          const token = next();
          if (when) fail('A scenario runs one command — one when.', token);
          const command = ident('the command it runs');
          when = { command: command.v, arguments: payload('the command\'s arguments'), token: command };
        } else if (is('then')) {
          const token = next();
          const item = thenItem();
          thens.push({ ...item, token, end: last() });
        } else {
          fail(`Expected given, when or then, found ${describeToken(peek())}.`);
        }
      }
      expect('}');
      if (thens.length) {
        const first = thens[0].token;
        const end = thens[thens.length - 1].end;
        record.thenRange = { line: first.line, col: first.col, endLine: end.endLine, endCol: end.endCol };
      }
      const body = {};
      if (nameToken) body.name = nameToken.v;
      const projections = thens.filter((t) => t.projection !== undefined);
      if (when) {
        if (projections.length) fail('A scenario that runs a command ends in events, nothing or a rejection — not in a projection\'s value.', projections[0].token);
        record.kind = 'scenario-definition';
        record.subject = when.command;
        subjectToken = when.token;
        Object.assign(body, { command: when.command, given, when: { arguments: when.arguments } });
        const rejections = thens.filter((t) => t.rejected);
        if (rejections.length && thens.length > 1) fail('A rejection is the whole outcome — it stands alone.', rejections[0].token);
        if (thens.some((t) => t.nothing) && thens.length > 1) fail('"then nothing" is the whole outcome — it stands alone.', thens[1].token);
        if (rejections.length) {
          const { rejected, saw, at: atWritten } = rejections[0];
          body.then = { outcome: 'rejected', events: [], failedRule: { ...rejected } };
          if (!atWritten) body.then.failedRule.atInstance = null;
          record.valuesMissing = !saw;
          record.atWritten = !!atWritten;
        } else if (thens.length) {
          body.then = {
            outcome: 'published',
            events: thens.filter((t) => t.event !== undefined).map((t) => ({ type: t.event, data: t.data })),
          };
        }
      } else {
        if (thens.length > 1) fail('A projection scenario asserts one value — one then.', thens[1].token);
        if (thens.length && !projections.length) fail('A scenario ending in events, nothing or a rejection needs a when — the command it runs.', thens[0].token);
        record.kind = 'projection-scenario-definition';
        if (projections.length) {
          const item = projections[0];
          record.subject = item.projection;
          subjectToken = item.subjectToken;
          record.positional = item.positional;
          record.argsToken = item.argsToken;
          Object.assign(body, { projection: item.projection, arguments: item.arguments, given });
          if ('value' in item) body.then = item.value;
        } else if (block && block.kind === 'projection-definition') {
          record.subject = block.name;
          Object.assign(body, { projection: block.name, arguments: {}, given });
        } else {
          fail('Say what this scenario runs (when …) or what it asserts (then …).', start);
        }
      }
      record.body = body;
    }
    if (block) {
      const wanted = block.kind === 'command-definition' ? 'scenario-definition' : 'projection-scenario-definition';
      if (record.kind !== wanted || record.subject !== block.name) {
        fail(`This scenario sits in ${block.name} but is about ${record.subject} — move it there, or make it about ${block.name}.`, subjectToken);
      }
    }
    const end = last();
    record.span = { line: start.line, col: start.col, endLine: end.endLine, endCol: end.endCol };
    result.scenarios.push(record);
  };

  const declaration = () => {
    const start = peek();
    const annotations = [];
    while (accept('@')) {
      const token = ident('an annotation name');
      expect('(');
      const value = string('a string');
      expect(')');
      annotations.push({ name: token.v, value, token });
    }
    if (accept('model')) {
      if (annotations.length) fail('A model carries no annotations.', annotations[0].token);
      if (result.name !== null) fail('The model is named once.', last());
      result.name = string('the model\'s name, in quotes');
      return;
    }
    if (is('scenario')) {
      if (annotations.length) fail('A scenario carries no annotations.', annotations[0].token);
      return scenarioDecl(start, null);
    }
    const isTag = !!accept('tag');
    if (isTag && !is('type') && !is('enum') && !is('record')) {
      fail(`Expected type, enum or record after "tag", found ${describeToken(peek())}.`);
    }
    if (is('type') || is('enum') || is('record')) return customType(start, annotations, isTag);
    if (is('event')) return eventDecl(start, annotations);
    if (is('entity')) return entityDecl(start, annotations);
    if (is('projection')) return projectionDecl(start, annotations);
    if (is('command')) return commandDecl(start, annotations);
    return fail(`Expected a declaration — type, enum, record, event, entity, projection or command — `
      + `found ${describeToken(peek())}.`);
  };

  while (peek().t !== 'eof') {
    const from = at;
    try {
      declaration();
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      const token = error.token;
      diagnostics.push({
        severity: 'error', message: error.message,
        line: token.line, col: token.col, endLine: token.endLine, endCol: Math.max(token.endCol, token.col + 1),
      });
      if (at === from) next();
      while (peek().t !== 'eof' && !startsDeclaration() && !(peek().first && is('scenario'))) next();
    }
  }

  // Positional projection arguments take their names from the
  // projection — declared in this text, or (for a fragment) handed in.
  for (const record of result.scenarios) {
    if (!record.positional) continue;
    const name = record.subject;
    const own = Object.prototype.hasOwnProperty.call(collections['projection-definition'], name)
      ? collections['projection-definition'][name]
      : options.projections && Object.prototype.hasOwnProperty.call(options.projections, name)
        ? options.projections[name] : null;
    const declared = own && (own.script ? own.script.arguments : own.parameters);
    const names = Array.isArray(declared) ? declared.map((p) => p && p.name) : null;
    const token = record.argsToken;
    const problem = !names
      ? `${name} is not defined here, so its arguments have to be named — ${name}(argument: …).`
      : names.length !== record.positional.length
        ? `${name} takes ${names.length} argument${names.length === 1 ? '' : 's'} (${names.join(', ') || 'none'}), not ${record.positional.length}.`
        : null;
    if (problem) {
      diagnostics.push({
        severity: 'error', message: problem,
        line: token.line, col: token.col, endLine: token.endLine, endCol: Math.max(token.endCol, token.col + 1),
      });
      continue;
    }
    const args = {};
    names.forEach((key, index) => sourcePut(args, key, record.positional[index]));
    record.body.arguments = args;
  }

  // Every entity's identifier type, declared or not — see above.
  const types = collections['custom-type-definition'];
  for (const [name, body] of Object.entries(collections['entity-definition'])) {
    const idType = (body && typeof body.identifierType === 'string' && body.identifierType) || name + 'Id';
    if (Object.prototype.hasOwnProperty.call(types, idType)) continue;
    sourcePut(types, idType, { schema: { type: 'string' }, isTag: true });
    result.implicit.push(idType);
  }
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return result;
}

// ============================================================
// Printing.
// ============================================================

// Thrown by the printer for something the grammar cannot say; caught
// per definition, which then prints as JSON with the message above it.
class SourceUnprintable extends Error {}

const unprintable = (message) => { throw new SourceUnprintable(message); };

function sourceRef(name, what) {
  if (typeof name !== 'string' || !SOURCE_IDENT_RE.test(name)) {
    unprintable(`its ${what} ${JSON.stringify(name)} is not a name the code form can write`);
  }
  return name;
}

function sourceDeclName(name) {
  return SOURCE_IDENT_RE.test(name) ? name : JSON.stringify(name);
}

// JSON, on one line when it is short — keys bare where they can be,
// the way the parser reads them.
function sourceJson(value, indent = '') {
  const flat = sourceJsonFlat(value);
  if (flat.length <= 72 || value === null || typeof value !== 'object') return flat;
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((v) => inner + sourceJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  return `{\n${keys.map((k) => `${inner}${sourceJsonKey(k)}: ${sourceJson(value[k], inner)}`).join(',\n')}\n${indent}}`;
}

function sourceJsonKey(key) {
  return SOURCE_IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function sourceJsonFlat(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unprintable('it holds a number JSON cannot write');
    return String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sourceJsonFlat).join(', ')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return `{ ${keys.map((k) => `${sourceJsonKey(k)}: ${sourceJsonFlat(value[k])}`).join(', ')} }`;
  }
  return unprintable(`it holds a ${typeof value}`);
}

function sourceLiteral(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unprintable('it holds a number JSON cannot write');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(sourceLiteral).join(', ')}]`;
  if (typeof value === 'object' && Object.keys(value).length === 1 && value.enumMember !== undefined) {
    const member = value.enumMember;
    if (typeof member === 'string' && SOURCE_MEMBER_RE.test(member)) return member;
    if (['string', 'number', 'boolean'].includes(typeof member)) return `enum(${sourceLiteral(member)})`;
  }
  return unprintable(`it holds a value the code form has no spelling for: ${JSON.stringify(value)}`);
}

function sourceProperty(property) {
  return `${sourceRef(property.name, 'property')}${property.isOptional ? '?' : ''}: `
    + `${sourceRef(property.propertyType, 'type')}${property.isList ? '[]' : ''}`;
}

function sourceAnnotations(body, names) {
  return names
    .filter((name) => body[name] !== undefined)
    .map((name) => {
      if (typeof body[name] !== 'string') unprintable(`its ${name} is not a string`);
      return `@${name}(${JSON.stringify(body[name])})\n`;
    })
    .join('');
}

// Fields one per line once they stop fitting on one.
function sourceBlock(head, items, { inline = 3, width = 90, separator = ', ' } = {}) {
  if (!items.length) return `${head} {}`;
  const flat = `${head} { ${items.join(separator)} }`;
  if (items.length <= inline && flat.length <= width && !items.some((i) => i.includes('\n'))) return flat;
  return `${head} {\n${items.map((i) => '  ' + i.replace(/\n/g, '\n  ')).join('\n')}\n}`;
}

function sourceCondition(condition, operand) {
  if (!condition || typeof condition !== 'object') unprintable('a rule is not an object');
  if (condition.leftHandSide === undefined) unprintable('a rule has no left-hand side');
  const left = operand(condition.leftHandSide);
  const negate = condition.negate === true;
  const not = (core) => (negate ? `not ${core}` : core);
  const { predicate } = condition;
  if (SOURCE_UNARY_WORDS[predicate]) {
    if (condition.rightHandSide !== undefined) unprintable(`a "${predicate}" rule carries a right-hand side`);
    return not(`${left} ${SOURCE_UNARY_WORDS[predicate]}`);
  }
  if (condition.rightHandSide === undefined) unprintable(`a "${predicate}" rule has no right-hand side`);
  const right = () => operand(condition.rightHandSide);
  switch (predicate) {
    case 'equals': return `${left} ${negate ? '!=' : '=='} ${right()}`;
    case 'lessThan': return not(`${left} < ${right()}`);
    case 'lessThanOrEquals': return not(`${left} <= ${right()}`);
    case 'greaterThan': return not(`${left} > ${right()}`);
    case 'greaterThanOrEquals': return not(`${left} >= ${right()}`);
    case 'countEquals': return `count(${left}) ${negate ? '!=' : '=='} ${right()}`;
    case 'countLessThan': return not(`count(${left}) < ${right()}`);
    case 'countGreaterThan': return not(`count(${left}) > ${right()}`);
    case 'equalsAny':
      if (!Array.isArray(condition.rightHandSide)) unprintable('an equalsAny rule is not against a list');
      return `${left} ${negate ? 'not in' : 'in'} ${sourceLiteral(condition.rightHandSide)}`;
    default:
      if (SOURCE_WORD_PREDICATES.includes(predicate)) return `${left} ${negate ? 'not ' : ''}${predicate} ${right()}`;
      return unprintable(`a rule's predicate ${JSON.stringify(predicate)} is not one the code form knows`);
  }
}

function sourceArguments(args, operand) {
  if (args === undefined) return '';
  if (args === null || typeof args !== 'object' || Array.isArray(args)) unprintable('its arguments are not an object');
  return Object.entries(args).map(([key, value]) => {
    const text = operand(value);
    return text === sourceRef(key, 'argument') ? key : `${key}: ${text}`;
  }).join(', ');
}

function sourceHandlerOperand(operand) {
  if (operand && typeof operand === 'object' && !Array.isArray(operand)) {
    const keys = Object.keys(operand);
    if (keys.length === 1 && operand.eventProperty !== undefined) {
      return `event.data.${sourceRef(operand.eventProperty, 'event property')}`;
    }
    if (keys.length === 1 && operand.currentValue === true) return 'currentValue';
    if (keys.length === 1 && operand.successor !== undefined) return `successor(${sourceHandlerOperand(operand.successor)})`;
  }
  return sourceLiteral(operand);
}

function sourceDerivedOperand(operand) {
  if (operand && typeof operand === 'object' && !Array.isArray(operand)) {
    if (operand.projection !== undefined) {
      if (Object.keys(operand).some((k) => k !== 'projection' && k !== 'arguments')) unprintable('a derived operand carries extra fields');
      if (!SOURCE_MEMBER_RE.test(sourceRef(operand.projection, 'projection'))) {
        unprintable(`the projection ${JSON.stringify(operand.projection)} does not start with a capital`);
      }
      return `${operand.projection}(${sourceArguments(operand.arguments, sourceDerivedOperand)})`;
    }
    if (operand.parameterName !== undefined) {
      const head = sourceRef(operand.parameterName, 'parameter');
      return operand.property === undefined ? head : `${head}.${sourceRef(operand.property, 'property')}`;
    }
  }
  return sourceLiteral(operand);
}

function printCustomType(name, body) {
  const tagSchema = body.tagSchema !== undefined && body.tagSchema !== '{type}:{value}'
    ? sourceAnnotations(body, ['tagSchema']) : '';
  const tag = body.isTag === true ? 'tag ' : '';
  const declared = sourceDeclName(name);
  if (body.properties !== undefined) {
    if (body.schema !== undefined) unprintable('it has both a schema and fields');
    if (!Array.isArray(body.properties)) unprintable('its fields are not a list');
    const fields = body.properties.map((f) => `${sourceRef(f.name, 'field')}: ${sourceRef(f.propertyType, 'type')}`);
    return tagSchema + sourceBlock(`${tag}record ${declared}`, fields);
  }
  const schema = body.schema;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) unprintable('its schema is not an object');
  const keys = Object.keys(schema);
  const plainEnum = keys.length === 2 && schema.type === 'string' && Array.isArray(schema.enum) && schema.enum.length
    && schema.enum.every((m) => typeof m === 'string' && SOURCE_IDENT_RE.test(m) && !['true', 'false', 'null'].includes(m));
  if (plainEnum) return tagSchema + `${tag}enum ${declared} { ${schema.enum.join(', ')} }`;
  if (typeof schema.type === 'string' && SOURCE_BASE_TYPES.includes(schema.type)) {
    const rest = {};
    for (const key of keys) if (key !== 'type') rest[key] = schema[key];
    return tagSchema + `${tag}type ${declared} = ${schema.type}`
      + (Object.keys(rest).length ? ' ' + sourceJson(rest) : '');
  }
  return tagSchema + `${tag}type ${declared} = ${sourceJson(schema)}`;
}

function printEvent(name, body) {
  const properties = (body.properties || []).map(sourceProperty);
  return sourceAnnotations(body, ['icon']) + sourceBlock(`event ${sourceDeclName(name)}`, properties);
}

function printEntity(name, body) {
  const head = `entity ${sourceDeclName(name)}`
    + (body.identifierType !== undefined ? `[${sourceRef(body.identifierType, 'identifier type')}]` : '');
  const items = [];
  if (body.lifecycle !== undefined && body.lifecycle !== null) items.push(`lifecycle ${sourceRef(body.lifecycle, 'lifecycle')}`);
  for (const p of body.properties || []) {
    items.push(`${sourceRef(p.name, 'property')} = ${sourceRef(p.projection, 'projection')}`);
  }
  return sourceAnnotations(body, ['icon']) + sourceBlock(head, items, { inline: 0 });
}

function printProjection(name, body) {
  const parameters = body.parameters || [];
  if (!Array.isArray(parameters)) unprintable('its parameters are not a list');
  const parameterText = (list) => list
    .map((p) => `${sourceRef(p.name, 'parameter')}: ${sourceRef(p.propertyType, 'type')}`).join(', ');
  let head = `projection ${sourceDeclName(name)}`
    + (parameters.length ? `(${parameterText(parameters)})` : '')
    + `: ${sourceRef(body.valueType, 'value type')}${body.isList ? '[]' : ''}`;
  if (body.initialValue !== undefined) head += ` = ${sourceLiteral(body.initialValue)}`;
  const lines = [head];
  if (body.derived !== undefined) lines.push(`  derived ${sourceCondition(body.derived, sourceDerivedOperand)}`);
  const script = body.script;
  if (body.handlers === undefined && script === undefined) return lines.join('\n');
  const items = [];
  if (script !== undefined) {
    if (script === null || typeof script !== 'object' || Array.isArray(script)) unprintable('its script is not an object');
    items.push(`script(${parameterText(script.arguments || [])})`);
    if (script.tagFilter !== undefined) items.push(`tagFilter ${sourceJson(script.tagFilter, '  ')}`);
    if (script.initialState !== undefined) items.push(`initialState ${sourceJson(script.initialState, '  ')}`);
    if (script.exposes !== undefined) items.push(`exposes ${sourceRef(script.exposes, 'exposed field')}`);
  }
  for (const handler of body.handlers || []) {
    const event = sourceRef(handler.event, 'event');
    if (handler.code !== undefined) {
      if (handler.operation !== undefined || handler.value !== undefined) unprintable('a handler has both code and an operation');
      if (typeof handler.code !== 'string' || handler.code.includes('```')) unprintable('a handler\'s code cannot be fenced');
      items.push(`on ${event} => \`\`\`${handler.code}\`\`\``);
    } else {
      if (!OPERATIONS.includes(handler.operation)) unprintable(`a handler's operation ${JSON.stringify(handler.operation)} is not one the code form knows`);
      items.push(`on ${event} => ${handler.operation}`
        + (handler.value !== undefined ? ' ' + sourceHandlerOperand(handler.value) : ''));
    }
  }
  const tail = lines.length - 1;
  lines[tail] += items.length ? ` {\n${items.map((i) => '  ' + i).join('\n')}\n}` : ' {}';
  return lines.join('\n');
}

// How a command writes an operand — the inverse of `resolveCommandNames`,
// refusing whatever it would resolve differently.
function sourceCommandOperand(body) {
  const aliases = new Set((body.boundary || []).map((b) => b && b.alias));
  const parameters = new Set((body.properties || []).map((p) => p && p.name));
  return (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.parameterName !== undefined) {
        const head = sourceRef(value.parameterName, 'parameter');
        if (aliases.has(head)) unprintable(`"${head}" names both a payload property and a read`);
        if (value.property === undefined) return head;
        if (!parameters.has(head)) unprintable(`it reads "${head}.${value.property}" from a payload property it does not declare`);
        return `${head}.${sourceRef(value.property, 'property')}`;
      }
      if (value.alias !== undefined) {
        const head = sourceRef(value.alias, 'read');
        const declared = aliases.has(head);
        if (!declared && parameters.has(head)) unprintable(`"${head}" names both a payload property and a read`);
        if (value.property === undefined) {
          if (!declared) unprintable(`it reads "${head}", which no read here declares`);
          return head;
        }
        return `${head}.${sourceRef(value.property, 'property')}`;
      }
    }
    return sourceLiteral(value);
  };
}

function printCommand(name, body) {
  const properties = body.properties || [];
  const boundary = body.boundary || [];
  const operand = sourceCommandOperand(body);

  const signature = properties.map(sourceProperty);
  const flat = `command ${sourceDeclName(name)}(${signature.join(', ')})`;
  const head = flat.length <= 96 ? flat
    : `command ${sourceDeclName(name)}(\n${signature.map((s) => '  ' + s + ',').join('\n')}\n)`;

  const reads = boundary.map((binding) => {
    if (!binding || typeof binding !== 'object') unprintable('a read is not an object');
    const alias = sourceRef(binding.alias, 'read alias') + (binding.isOptional === true ? '?' : '');
    if (binding.entity !== undefined && binding.projection === undefined) {
      if (binding.id === undefined) unprintable(`the read "${binding.alias}" has no identifier`);
      let text = `read ${alias} = ${sourceRef(binding.entity, 'entity')}[${operand(binding.id)}]`;
      if (binding.excluding !== undefined) text += ` excluding ${operand(binding.excluding)}`;
      if (binding.arguments !== undefined && Object.keys(binding.arguments).length) {
        text += ` with (${sourceArguments(binding.arguments, operand)})`;
      }
      return text;
    }
    if (binding.projection !== undefined && binding.entity === undefined) {
      return `read ${alias} = ${sourceRef(binding.projection, 'projection')}(${sourceArguments(binding.arguments, operand)})`;
    }
    return unprintable(`the read "${binding.alias}" is neither an entity nor a projection`);
  });
  const rules = (body.conditions || []).map((c) => `require ${sourceCondition(c, operand)}`);
  const emits = (body.publishes || []).map((emission) => {
    const event = sourceRef(emission.name, 'event');
    let text = `emit ${event}`;
    if (emission.parameters !== undefined) {
      const fields = Object.entries(emission.parameters).map(([key, value]) => {
        const valueText = operand(value);
        return valueText === sourceRef(key, 'event property') ? key : `${key}: ${valueText}`;
      });
      const inline = `${text} { ${fields.join(', ')} }`;
      text = !fields.length ? `${text} {}`
        : inline.length <= 88 ? inline
          : `${text} {\n${fields.map((f) => '  ' + f + ',').join('\n')}\n}`;
    }
    const guards = emission.when || [];
    if (guards.length) text += `\n  when ${guards.map((c) => sourceCondition(c, operand)).join('\n   and ')}`;
    return text;
  });
  const groups = [reads, rules, emits].filter((group) => group.length);
  const annotations = sourceAnnotations(body, ['feature', 'icon']);
  if (!groups.length) return `${annotations}${head} {}`;
  const inner = groups.map((group) => group.map((line) => '  ' + line.replace(/\n/g, '\n  ')).join('\n')).join('\n\n');
  return `${annotations}${head} {\n${inner}\n}`;
}

const SOURCE_PRINTERS = {
  'custom-type-definition': printCustomType,
  'event-definition': printEvent,
  'entity-definition': printEntity,
  'projection-definition': printProjection,
  'command-definition': printCommand,
};

function printJsonDefinition(kind, name, body) {
  return `${SOURCE_KEYWORD[kind]} ${sourceDeclName(name)} json ${JSON.stringify(body, null, 2)}`;
}

// One definition, in the grammar when it survives the trip back and as
// JSON under a comment saying why when it does not. Anything the
// printer trips over counts as "does not": the write path stores bodies
// of shapes no printer expects (a `null` in a list, a map that is not
// one), and a defective model must still show as code.
function printDefinitionSource(kind, name, body) {
  let reason;
  try {
    const text = SOURCE_PRINTERS[kind](name, body);
    const back = parseModelSource(text);
    const parsed = back.collections[kind];
    const keys = Object.keys(parsed);
    if (back.diagnostics.length || keys.length !== 1 || keys[0] !== name || !sameDefinition(parsed[name], body)) {
      reason = 'it holds something the code form does not say exactly';
    } else {
      return text;
    }
  } catch (error) {
    reason = error instanceof SourceUnprintable ? error.message : 'it is not shaped the way the code form expects';
  }
  return `// Written as JSON: ${reason}.\n${printJsonDefinition(kind, name, body)}`;
}

// ---------- scenarios ----------

// A payload value, written the way its type reads: an enum member bare,
// anything else as JSON. The parser reads a bare capitalised word back
// as the same string, so the type only decides the look, never what
// comes back.
function sourceScenarioValue(model, value, type) {
  if (Array.isArray(value)) {
    const element = type ? { typeName: type.typeName, isList: false } : null;
    return `[${value.map((v) => sourceScenarioValue(model, v, element)).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const fields = type && !type.isList ? compositeFieldsOf(model, type.typeName) : null;
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return `{ ${keys.map((key) => {
      const field = fields && fields.find((f) => f && f.name === key);
      const fieldType = field ? { typeName: field.propertyType, isList: false } : null;
      return `${sourceJsonKey(key)}: ${sourceScenarioValue(model, value[key], fieldType)}`;
    }).join(', ')} }`;
  }
  if (typeof value === 'string' && type && SOURCE_MEMBER_RE.test(value) && !['true', 'false', 'null'].includes(value)) {
    const members = enumMembersFor(model, type.typeName);
    if (members && members.includes(value)) return value;
  }
  return sourceJsonFlat(value);
}

// `{ key: value, … }` against the properties that type it.
function sourceScenarioPayload(model, properties, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) unprintable('a payload is not an object');
  const typeOf = (key) => {
    const property = (properties || []).find((p) => p && p.name === key);
    return property ? { typeName: property.propertyType, isList: !!property.isList } : null;
  };
  const keys = Object.keys(data);
  if (!keys.length) return '{}';
  return `{ ${keys.map((key) => `${sourceJsonKey(key)}: ${sourceScenarioValue(model, data[key], typeOf(key))}`).join(', ')} }`;
}

function sourceEventPayload(model, eventName, data) {
  const event = model['event-definitions'][eventName];
  return sourceScenarioPayload(model, event && event.properties, data);
}

// A command scenario's outcome as `then` lines. A refusal names its rule
// in the rule's own syntax when the command still has a rule reading
// that way, and as the stored text in quotes when it does not — the
// scenario that drifted because its rule changed has to print too.
function sourceCommandThen(model, commandName, then) {
  if (!then || typeof then !== 'object' || Array.isArray(then)) unprintable('its outcome is not an object');
  if (then.outcome === 'published') {
    const events = then.events || [];
    if (!events.length) return ['then nothing'];
    return events.map((e) => {
      if (!e || typeof e !== 'object' || Object.keys(e).some((k) => k !== 'type' && k !== 'data')) unprintable('an event of its outcome is not { type, data }');
      return `then ${sourceRef(e.type, 'event')} ${sourceEventPayload(model, e.type, e.data)}`;
    });
  }
  if (then.outcome !== 'rejected') unprintable(`its outcome ${JSON.stringify(then.outcome)} is not one the code form knows`);
  const failed = then.failedRule;
  if (!failed || typeof failed.text !== 'string') unprintable('its refusal names no rule');
  const command = model['command-definitions'][commandName];
  const rule = command && (command.conditions || []).find((c) => {
    try { return conditionText(c) === failed.text; } catch { return false; }
  });
  let ruleText = JSON.stringify(failed.text);
  let types = [null, null];
  if (rule) {
    try {
      ruleText = sourceCondition(rule, sourceCommandOperand(command));
      types = [rule.leftHandSide, rule.rightHandSide].map((operand) => {
        const type = operand === undefined ? null : conditionOperandType(model, command, rule, operand);
        return type ? { typeName: type.propertyType, isList: !!type.isList } : null;
      });
      // A literal has no type of its own; it is compared with the left.
      if (!types[1] && types[0]) types[1] = rule.predicate === 'equalsAny' ? { ...types[0], isList: true } : types[0];
    } catch { /* a rule the grammar cannot say is named by its text */ }
  }
  let text = `then rejected by ${ruleText}`;
  if (failed.leftValue !== undefined || failed.rightValue !== undefined) {
    text += ` saw ${sourceScenarioValue(model, failed.leftValue, types[0])}`;
    if (failed.rightValue !== null && failed.rightValue !== undefined) {
      text += `, ${sourceScenarioValue(model, failed.rightValue, types[1])}`;
    }
  }
  if (failed.atInstance !== null && failed.atInstance !== undefined) text += ` at ${sourceJsonFlat(failed.atInstance)}`;
  return [text];
}

// A projection scenario's `then`: the projection, read at its
// arguments — positional where the projection is right there to give
// their order, named where it is not — and the value it folds to.
function sourceProjectionThen(model, body, { positional }) {
  const name = sourceRef(body.projection, 'projection');
  const projection = model['projection-definitions'][body.projection];
  const args = body.arguments === undefined ? {} : body.arguments;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) unprintable('its arguments are not an object');
  const keys = Object.keys(args);
  const declared = projection && (projection.script ? projection.script.arguments : projection.parameters);
  const parameters = Array.isArray(declared) ? declared : null;
  const typeOf = (key) => {
    const parameter = (parameters || []).find((p) => p && p.name === key);
    return parameter ? { typeName: parameter.propertyType, isList: false } : null;
  };
  let call;
  if (positional && parameters && keys.length === parameters.length && parameters.every((p) => p && keys.includes(p.name))) {
    call = parameters.length
      ? `${name}(${parameters.map((p) => sourceScenarioValue(model, args[p.name], typeOf(p.name))).join(', ')})`
      : name;
  } else {
    call = `${name}(${keys.map((key) => `${sourceRef(key, 'argument')}: ${sourceScenarioValue(model, args[key], typeOf(key))}`).join(', ')})`;
  }
  if (!('then' in body)) return `then ${call}`;
  const valueType = projection ? { typeName: projection.valueType, isList: !!projection.isList } : null;
  return `then ${call} == ${sourceScenarioValue(model, body.then, valueType)}`;
}

function printScenario(model, kind, body, { positional }) {
  const known = ['name', 'given', kind === 'scenario-definition' ? 'command' : 'projection',
    kind === 'scenario-definition' ? 'when' : 'arguments', 'then'];
  if (Object.keys(body).some((key) => !known.includes(key))) unprintable('it carries fields the code form does not know');
  if (body.name !== undefined && typeof body.name !== 'string') unprintable('its name is not a string');
  const lines = (body.given || []).map((step) => {
    if (!step || typeof step !== 'object' || Object.keys(step).some((k) => k !== 'event' && k !== 'data')) {
      unprintable('a Given step is not { event, data }');
    }
    return `given ${sourceRef(step.event, 'event')} ${sourceEventPayload(model, step.event, step.data)}`;
  });
  let label = '';
  if (kind === 'scenario-definition') {
    if (!body.when || typeof body.when !== 'object' || Object.keys(body.when).some((k) => k !== 'arguments')) {
      unprintable('its When is not { arguments }');
    }
    const command = model['command-definitions'][body.command];
    lines.push(`when ${sourceRef(body.command, 'command')} `
      + sourceScenarioPayload(model, command && command.properties, body.when.arguments));
    if (body.then !== undefined) lines.push(...sourceCommandThen(model, body.command, body.then));
    if (body.name === undefined && body.then !== undefined) label = `  // ${scenarioName(body)}`;
  } else {
    lines.push(sourceProjectionThen(model, body, { positional }));
  }
  const head = body.name === undefined ? 'scenario' : `scenario ${JSON.stringify(body.name)}`;
  return `${head} {${label}\n${lines.map((line) => '  ' + line).join('\n')}\n}`;
}

// What the scenario says once read back — the index a refusal stores is
// not in the text (it is re-derived on apply, see `completeScenario`),
// so it is no part of the comparison.
function sameScenario(a, b) {
  const strip = (body) => {
    const copy = deepClone(body);
    if (copy && copy.then && copy.then.failedRule) delete copy.then.failedRule.index;
    return copy;
  };
  return sameDefinition(strip(a), strip(b));
}

// One scenario, in the grammar when it survives the trip back and as
// JSON under a comment when it does not — `printDefinitionSource`'s
// contract, for a definition keyed by an id the text never shows.
function printScenarioSource(model, kind, body, { positional }) {
  let reason;
  try {
    const text = printScenario(model, kind, body, { positional });
    const back = parseModelSource(text, { projections: model['projection-definitions'] });
    const [record] = back.scenarios;
    if (!back.diagnostics.length && back.scenarios.length === 1 && record.kind === kind && sameScenario(record.body, body)) {
      return text;
    }
    reason = 'it holds something the code form does not say exactly';
  } catch (error) {
    reason = error instanceof SourceUnprintable ? error.message : 'it is not shaped the way the code form expects';
  }
  return `// Written as JSON: ${reason}.\nscenario json ${JSON.stringify(body, null, 2)}`;
}

// A block's text with scenarios added at its end, opening the block if
// the definition printed without one (a derived projection).
function sourceNest(text, scenarios) {
  if (!scenarios.length) return text;
  const inner = scenarios.map((t) => t.split('\n').map((line) => (line ? '  ' + line : line)).join('\n')).join('\n\n');
  if (text.endsWith(' {}')) return `${text.slice(0, -1)}\n${inner}\n}`;
  if (text.endsWith('\n}')) return `${text.slice(0, -1)}\n${inner}\n}`;
  return `${text} {\n${inner}\n}`;
}

// The whole model. Definitions of one kind sit in their stored order —
// the text's order *is* the order an apply stores — and consecutive
// one-liners stay together, so twenty value types read as a table.
// Scenarios sit at the end of their command's or projection's block;
// one whose subject is gone, or printed as JSON, sits at the end of the
// text instead.
function modelToSource(model) {
  const SUBJECT = {
    'scenario-definition': ['command-definition', 'command'],
    'projection-scenario-definition': ['projection-definition', 'projection'],
  };
  const nested = { 'command-definition': new Map(), 'projection-definition': new Map() };
  const loose = [];
  for (const kind of ID_KEYED_KINDS) {
    const [subjectKind, field] = SUBJECT[kind];
    for (const body of Object.values(model[DEF_COLLECTIONS[kind]] || {})) {
      const subject = body && body[field];
      const owner = typeof subject === 'string'
        && Object.prototype.hasOwnProperty.call(model[DEF_COLLECTIONS[subjectKind]], subject);
      if (!owner) { loose.push([kind, body]); continue; }
      const list = nested[subjectKind].get(subject) || [];
      list.push([kind, body]);
      nested[subjectKind].set(subject, list);
    }
  }
  const out = [`model ${JSON.stringify(model.name)}`];
  for (const kind of SOURCE_KINDS) {
    const entries = Object.entries(model[DEF_COLLECTIONS[kind]] || {});
    if (!entries.length) continue;
    out.push('', `// ${SOURCE_SECTION[kind]}`);
    let previousWasLine = false;
    entries.forEach(([name, body], index) => {
      let text = printDefinitionSource(kind, name, body);
      const own = (nested[kind] && nested[kind].get(name)) || [];
      if (text.startsWith('// Written as JSON')) loose.push(...own);
      else text = sourceNest(text, own.map(([k, b]) => printScenarioSource(model, k, b, { positional: true })));
      const oneLine = !text.includes('\n');
      if (index > 0 && !(oneLine && previousWasLine)) out.push('');
      out.push(text);
      previousWasLine = oneLine;
    });
  }
  if (loose.length) {
    out.push('', '// Scenarios');
    for (const [kind, body] of loose) out.push('', printScenarioSource(model, kind, body, { positional: false }));
  }
  return out.join('\n') + '\n';
}

// Printed once per log revision, the way every other derived view is.
let sourceCache = null;
function modelSource(model) {
  if (sourceCache && sourceCache.revision === logRevisionNow() && sourceCache.model === model) return sourceCache.text;
  const text = modelToSource(model);
  sourceCache = { revision: logRevisionNow(), model, text };
  return text;
}

// ============================================================
// Reading a text against the model it would replace.
// ============================================================

// The model the text describes, as if it had been applied: its own
// definitions, with the model's scenarios alongside since the text
// leaves those alone. Never stored — what the editor asks questions of
// (advisories, a command's boundary) before anything is written.
function sourceDraftModel(model, parsed) {
  const draft = { id: model.id, name: parsed.name || model.name };
  for (const kind of DEF_KINDS) {
    draft[DEF_COLLECTIONS[kind]] = SOURCE_KINDS.includes(kind)
      ? parsed.collections[kind] : model[DEF_COLLECTIONS[kind]];
  }
  return draft;
}

// What the advisories would say about the text if it were applied.
function sourceAdvisories(model, parsed) {
  const draft = sourceDraftModel(model, parsed);
  const found = [];
  for (const kind of SOURCE_KINDS) {
    for (const [name, body] of Object.entries(parsed.collections[kind])) {
      for (const message of definitionAdvisories(draft, kind, name, body)) found.push({ kind, name, message });
    }
  }
  return found;
}

// The definition a 1-based line falls in, if any.
function sourceSpanAt(parsed, line) {
  return parsed.spans.find((span) => line >= span.line && line <= span.endLine) || null;
}

function sourceSpanOf(parsed, kind, name) {
  return parsed.spans.find((span) => span.kind === kind && span.name === name) || null;
}

// ---------- scenarios, against the text ----------

// What an apply stores for one written scenario, and what the editor
// says about it while it is still a draft: optional properties left
// out are written as null (as the page's save does), an omitted Then is
// what the text's definitions make of the scenario, and a refusal
// written without `saw` takes the values the evaluation saw — when it
// was refused by the rule the text names; otherwise the values are null
// and the scenario reports drift.
function completeScenario(draft, record) {
  const body = deepClone(record.body);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fill = (properties, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const property of properties || []) {
      if (property && property.isOptional && !has(data, property.name)) data[property.name] = null;
    }
  };
  const eventProperties = (name) => {
    const event = draft['event-definitions'][name];
    return event && event.properties;
  };
  for (const step of body.given || []) if (step) fill(eventProperties(step.event), step.data);
  const command = record.kind === 'scenario-definition' && draft['command-definitions'][body.command];
  if (command && body.when) fill(command.properties, body.when.arguments);
  if (body.then && body.then.outcome === 'published') {
    for (const event of body.then.events || []) if (event) fill(eventProperties(event.type), event.data);
  }

  let actual = null;
  let reason = null;
  try {
    actual = record.kind === 'scenario-definition' ? deriveThen(draft, body) : deriveProjectionScenarioThen(draft, body);
  } catch (error) {
    reason = error && error.message ? error.message : String(error);
  }
  if (!('then' in body)) {
    if (reason) return { body, error: `This scenario cannot run, so there is no outcome to record: ${reason}` };
    body.then = actual;
    return { body, status: 'recorded', actual };
  }
  if (record.valuesMissing && body.then && body.then.failedRule) {
    const failed = body.then.failedRule;
    const seen = actual && actual.outcome === 'rejected' && actual.failedRule
      && actual.failedRule.text === failed.text ? actual.failedRule : null;
    failed.leftValue = seen ? seen.leftValue : null;
    failed.rightValue = seen ? seen.rightValue : null;
    if (!record.atWritten) failed.atInstance = seen ? seen.atInstance : null;
  }
  if (reason) return { body, status: 'broken', reason };
  return { body, status: evSameOutcome(actual, body.then) ? 'current' : 'drifted', actual };
}

const SCENARIO_SUBJECT = { 'scenario-definition': 'command', 'projection-scenario-definition': 'projection' };

// The scenario collections the text describes, keyed by the ids they
// already have. A scenario carries no id in the text, so which stored
// one a block *is* is matched: an unchanged block by its content, an
// edited one by its place among its subject's scenarios, one whose
// subject was renamed by its place among the leftovers — and whatever
// is still unmatched is new. A refusal's index is not in the text
// either: it is kept where the stored scenario names the same rule, and
// otherwise derived from where that rule sits now.
//
// The collection order keeps the stored interleaving of subjects and
// takes each subject's own order from the text, so an untouched text
// reorders nothing.
function sourceScenarioCollections(model, parsed) {
  const draft = sourceDraftModel(model, parsed);
  const errors = [];
  const collections = {};
  for (const kind of ID_KEYED_KINDS) {
    const field = SCENARIO_SUBJECT[kind];
    const stored = model[DEF_COLLECTIONS[kind]] || {};
    const written = parsed.scenarios.filter((r) => r.kind === kind).map((record) => {
      const done = completeScenario(draft, record);
      if (done.error) errors.push({ record, message: done.error });
      return { record, body: done.body };
    });
    const free = new Set(Object.keys(stored));
    const ids = new Array(written.length).fill(null);
    const claim = (index, id) => { ids[index] = id; free.delete(id); };
    written.forEach((w, i) => {
      const hit = [...free].find((id) => sameScenario(stored[id], w.body));
      if (hit) claim(i, hit);
    });
    const textSubjects = new Set(written.map((w) => w.body[field]));
    const pair = (eligible) => {
      written.forEach((w, i) => {
        if (ids[i]) return;
        const hit = [...free].find((id) => eligible(stored[id], w));
        if (hit) claim(i, hit);
      });
    };
    pair((body, w) => body && body[field] === w.body[field]);
    pair((body) => body && !textSubjects.has(body[field]));
    written.forEach((w, i) => { if (!ids[i]) ids[i] = generateId(); });

    written.forEach((w, i) => {
      const failed = w.body.then && w.body.then.failedRule;
      if (!failed || failed.index !== undefined) return;
      const before = stored[ids[i]];
      const was = before && before.then && before.then.failedRule;
      if (was && was.text === failed.text && was.index !== undefined) { failed.index = was.index; return; }
      const command = draft['command-definitions'][w.body.command];
      const at = command ? (command.conditions || []).findIndex((c) => {
        try { return conditionText(c) === failed.text; } catch { return false; }
      }) : -1;
      failed.index = at >= 0 ? at : 0;
    });
    // Restore the `index`-first key order the evaluator writes, so a
    // completed refusal reads like a recorded one.
    written.forEach((w) => {
      const failed = w.body.then && w.body.then.failedRule;
      if (!failed) return;
      const { index, text, leftValue, rightValue, atInstance, ...rest } = failed;
      w.body.then.failedRule = { index, text, leftValue, rightValue, atInstance, ...rest };
    });

    const queues = new Map();
    written.forEach((w, i) => {
      const queue = queues.get(w.body[field]) || [];
      queue.push(i);
      queues.set(w.body[field], queue);
    });
    const order = [];
    const placed = new Set();
    for (const id of Object.keys(stored)) {
      const index = ids.indexOf(id);
      if (index < 0) continue;
      const queue = queues.get(written[index].body[field]);
      const nextIndex = queue && queue.shift();
      if (nextIndex === undefined) continue;
      order.push(nextIndex);
      placed.add(nextIndex);
    }
    written.forEach((w, i) => { if (!placed.has(i)) order.push(i); });
    const out = {};
    for (const i of order) sourcePut(out, ids[i], written[i].body);
    collections[kind] = out;
  }
  return { collections, errors };
}

// What the editor says about each scenario of a draft: an error where
// one cannot be recorded, a warning where it is broken or drifted, and
// for a drift the `then` lines that would accept what the model now
// does — the quick fix.
function sourceScenarioReport(model, parsed) {
  const draft = sourceDraftModel(model, parsed);
  const errors = [];
  const warnings = [];
  for (const record of parsed.scenarios) {
    const done = completeScenario(draft, record);
    const at = { line: record.head.line, col: record.head.col, endLine: record.head.endLine, endCol: record.head.endCol };
    if (done.error) { errors.push({ severity: 'error', message: done.error, ...at }); continue; }
    if (done.status === 'broken') {
      warnings.push({ message: `Broken — ${done.reason}`, ...at });
      continue;
    }
    if (done.status !== 'drifted') continue;
    let lines = null;
    try {
      lines = record.kind === 'scenario-definition'
        ? sourceCommandThen(draft, done.body.command, done.actual)
        : [sourceProjectionThen(draft, { ...done.body, then: done.actual }, { positional: !!record.positional || !!record.block })];
    } catch { /* no fix to offer when the outcome cannot be written */ }
    const warning = { message: 'Drifted — the model now does:\n' + (lines ? lines.join('\n') : JSON.stringify(done.actual)), ...at };
    if (lines && record.thenRange) {
      warning.fix = {
        ...record.thenRange,
        text: lines.join('\n' + ' '.repeat(record.thenRange.col - 1)),
      };
    }
    warnings.push(warning);
  }
  return { errors, warnings };
}

// Parses, refuses on any error, and writes the difference — one
// append, one undo step, nothing at all when nothing changed. An
// identifier type the text left implicit keeps whatever the model
// already says about it, and its place, so leaving `tag type CourseId
// = string` out of a hand-written file does not reset a pattern
// someone gave it on the Types page. And one is only ever *created*
// for an entity the text adds, the way creating one on its page does:
// an existing entity whose identifier type is missing keeps it missing,
// which is a dangling reference the advisories report, not something an
// apply should quietly repair.
function applyModelSource(modelId, text) {
  const parsed = parseModelSource(text);
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    const first = errors[0];
    throw new DomainError(`${errors.length} error${errors.length === 1 ? '' : 's'} in the code — nothing was `
      + `applied. Line ${first.line}: ${first.message}`);
  }
  const model = getCtxOrThrow(modelId);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const current = model['custom-type-definitions'];
  const types = parsed.collections['custom-type-definition'];
  const entities = parsed.collections['entity-definition'];
  const ownersAreNew = (typeName) => Object.entries(entities)
    .filter(([name, body]) => ((body && body.identifierType) || name + 'Id') === typeName)
    .every(([name]) => !has(model['entity-definitions'], name));
  const dropped = parsed.implicit.filter((name) => !has(current, name) && !ownersAreNew(name));
  const implicit = new Set(parsed.implicit.filter((name) => has(current, name)));
  if (implicit.size || dropped.length) {
    const order = Object.keys(types).filter((name) => !implicit.has(name) && !dropped.includes(name));
    const currentOrder = Object.keys(current);
    for (const name of implicit) {
      let insertAt = 0;
      for (let k = currentOrder.indexOf(name) - 1; k >= 0; k -= 1) {
        const position = order.indexOf(currentOrder[k]);
        if (position >= 0) { insertAt = position + 1; break; }
      }
      order.splice(insertAt, 0, name);
    }
    const merged = {};
    for (const name of order) sourcePut(merged, name, implicit.has(name) ? current[name] : types[name]);
    parsed.collections['custom-type-definition'] = merged;
  }
  const scenarios = sourceScenarioCollections(model, parsed);
  if (scenarios.errors.length) {
    const [first] = scenarios.errors;
    throw new DomainError(`${scenarios.errors.length} scenario${scenarios.errors.length === 1 ? '' : 's'} cannot be `
      + `recorded — nothing was applied. Line ${first.record.head.line}: ${first.message}`);
  }
  return replaceDefinitions(modelId, {
    name: parsed.name,
    collections: { ...parsed.collections, ...scenarios.collections },
  });
}

// What an apply did, in a line.
function sourceApplySummary(summary) {
  const parts = [];
  const count = (list, verb) => {
    const definitions = list.filter((item) => !isIdKeyed(item.kind));
    const scenarios = list.length - definitions.length;
    if (definitions.length === 1) parts.push(`${verb} ${SOURCE_KEYWORD[definitions[0].kind]} ${definitions[0].name}`);
    else if (definitions.length) parts.push(`${verb} ${definitions.length}`);
    if (scenarios) parts.push(`${verb} ${scenarios} scenario${scenarios === 1 ? '' : 's'}`);
  };
  count(summary.added, 'added');
  count(summary.updated, 'updated');
  count(summary.removed, 'removed');
  if (summary.reordered.length) parts.push('reordered');
  if (summary.renamed) parts.push(`renamed the model to "${summary.renamed}"`);
  return parts.length ? parts.join(', ') : 'nothing changed';
}

// ============================================================
// The grammar as Monaco reads it (a Monarch definition). Data, so the
// keyword list sits next to the parser that gives the words meaning.
// ============================================================

const SOURCE_KEYWORDS = [
  'model', 'type', 'tag', 'enum', 'record', 'event', 'entity', 'lifecycle', 'projection', 'derived',
  'script', 'tagFilter', 'initialState', 'exposes', 'on', 'set', 'increment', 'decrement', 'append',
  'remove', 'command', 'read', 'excluding', 'with', 'require', 'emit', 'when', 'and', 'not', 'is',
  'empty', 'in', 'contains', 'containsAny', 'startsWith', 'endsWith', 'count', 'successor',
  'currentValue', 'json', 'true', 'false', 'null', 'scenario', 'given', 'then', 'nothing', 'rejected',
  'by', 'saw', 'at',
];

// The words a block's statements start with, coloured apart so the
// shape of a command — what it reads, requires, emits — shows at a
// glance.
const SOURCE_STATEMENTS = ['read', 'require', 'emit', 'when', 'on', 'derived', 'scenario', 'given', 'then'];

const SOURCE_MONARCH = {
  keywords: SOURCE_KEYWORDS,
  statements: SOURCE_STATEMENTS,
  baseTypes: [...SOURCE_BASE_TYPES],
  tokenizer: {
    root: [
      [/```/, { token: 'string.code', next: '@code', nextEmbedded: 'javascript' }],
      [/@[A-Za-z_]\w*/, 'annotation'],
      [/event(?=\.data\.)/, 'keyword'],
      [/[A-Z]\w*/, 'type.identifier'],
      [/[a-z_]\w*/, { cases: { '@statements': 'keyword.flow', '@keywords': 'keyword', '@baseTypes': 'type', '@default': 'identifier' } }],
      { include: '@whitespace' },
      [/[{}()[\]]/, '@brackets'],
      [/=>|==|!=|<=|>=|[<>=?:.,]/, 'delimiter'],
      [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string'],
    ],
    code: [
      [/```/, { token: 'string.code', next: '@pop', nextEmbedded: '@pop' }],
      [/[^`]+/, ''],
      [/`/, ''],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
};
