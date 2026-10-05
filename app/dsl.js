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
//     alias course = Course[courseId]
//     require course.status == Existent
//       else reject "Course does not exist"
//     require course.capacity != newCapacity
//       else reject "Capacity is unchanged"
//     emit CourseCapacityChanged { courseId, newCapacity }
//   }
//
// **It is a spelling of the wire format, not a second model.** Every
// construct maps to exactly one schema shape, which is what lets the
// two directions be each other's inverse; nothing is inferred that the
// JSON does not store. Where a convenience would have needed inference
// it was left out: a fan-out is not marked (it follows from the
// operand's type, as in the schema), and an alias is always written,
// since the schema stores it.
//
// **`alias`, not `read`.** The statement names an instance for the
// rules below it; it reads nothing at that line — the query is derived
// from what the rules use (`deriveDcb`). `read` suggested the opposite,
// and `alias` is the wire format's own word for the name.
//
// One spelling is read but never printed: `x in xs`, where `xs` is a
// list held in data rather than a literal `[..]`, is `xs contains x`
// with its sides swapped. Membership is said both ways round, and a
// rule about one value reads with that value first — but the schema
// has one shape for it, so the text comes back as `contains`. Nothing
// is inferred: which predicate it is follows from the token after
// `in`, never from a type.
//
// **Borrowed, deliberately.** heklang (git.tqwewe.com/tephra/heklang)
// is DCB-native, and its `emit Event { field }` shorthand and `on
// Event => …` fold arms are taken as they are. Weltenwanderer
// (weltenwanderer.dev) contributes `require … else reject "…"` and
// `type X = string` — and with the first, that every rule says what it
// is refused with: the message is required, as it is there.
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
// what a developer would type: `==`, `<`, `in [..]` / `in xs`, `count(x)`,
// `is empty`, `X[]` for a list, `name?:` for an optional property, and
// `Course[courseId]` for an entity instance — brackets for "look one
// up by identifier", parentheses for a projection's arguments.
//
// **A fold arm is a keyword, not an expression.** `on E => set x`,
// `increment` / `decrement` (integers), `append` / `remove` (lists):
// the wire format's closed operation vocabulary, spelled as itself.
// heklang writes `=> expr`, and `=> state + 1` could be parsed into
// `increment 1` without loss; it is not, because an arm that looks
// like an expression invites `state + 2 * event.data.n`, which no
// operation stores. The vocabulary is closed because it is analysed,
// not only run — what an editor offers per type (`operationsFor`),
// whether a boolean only ever moves one way (`isMonotoneBoolean`),
// which event moves a lifecycle — and a keyword shows that edge where
// an expression would hide it. Arithmetic is what `script` is for: its
// arms are expressions over `state`, `event` and `args`, behind a door
// that says analysis stops there. Expect the list to stay short: each
// new operation is a major (a reader fails on one it does not know)
// and has to earn its place by being analysable — `max` / `min` and a
// duplicate-free append are the candidates in sight.
//
// **Operand names resolve per command.** A bare or dotted lowercase
// name is an alias when some `alias` in the same command declares it
// and a payload property otherwise — the schema keeps the two apart, a
// text can only do so by scope. A name that is neither (a dangling
// reference, which the model allows and advises about) reads as a
// property when bare and as an alias when dotted, the common case of
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
// **Scenarios sit in the block of what they exercise**, in one
// `scenarios` group that ends it — a command's run it, a projection's
// assert its value:
//
//   scenarios {
//     scenario "a second definition is refused" {
//       given CourseDefined { courseId: "c1", capacity: 123 }
//       when DefineCourse { courseId: "c1", capacity: 123 }
//       then rejected "Course already exists"
//     }
//
//     scenario {
//       when DefineCourse { courseId: "c1", capacity: 1 }
//       then CourseDefined { courseId: "c1", capacity: 1 }
//     }
//   }
//
// The group is syntax only — the wire format has no such thing — and
// it is required, because it is what the editor folds: a model's
// examples can outweigh its definitions many times over, and one fold
// per block puts them away as one line. A scenario outside a group is
// an error whose fix wraps it (`ungrouped`), so a text from before
// groups is one click from reading.
//
// The subject is named (`when DefineCourse`, `then CourseStatus(…)`)
// and must be the block's — a scenario moved into the wrong block is an
// error, not a reassignment; one whose subject is gone sits in a group
// at the top level. A Then is the scenario's assertion and is stored as written;
// leave it out and an apply records what the text's definitions make
// of it, the way the page's save does. A refusal is named by its
// rule's message and by nothing else — not the condition, not what it
// read: rules sharing a message are one outcome, and the message is
// what the command is refused with. A Then that disagrees with
// the text is drift: shown, with a fix that accepts it, and never
// accepted by applying. Payload values are JSON, an enum member bare.
// The id a scenario is keyed by is not in the text: an apply matches
// blocks to stored scenarios by content, then by place, so an edited or
// renamed-along scenario keeps its id (`sourceScenarioCollections`).
//
// Comments are not stored — the model has nowhere to keep them — so
// they survive as long as the text in the editor does and no longer.
//
// **The editor knows what each name is** (the language service, at the
// end). The parser marks which token every part of a body came from;
// `sourceSymbols` walks the bodies and resolves each marked name to the
// one thing it means — `member CourseStatus Existent`, never a word
// that happens to match — so a rename (`sourceRename`) touches exactly
// those tokens, and refuses rather than guess: over a script or json
// body the name may also hide in, a member whose enum the text cannot
// tell, or a result that would not read back the same. Completion
// (`sourceCompletions`) reads the cursor's place off the tokens before
// it, since a text being typed rarely parses there. And beside every
// `alias` it says how many event types that alias adds to the append
// condition, and names them on hover (`sourceReadQueries`) — only the
// used properties' — since `alias course = Course[courseId]` otherwise
// reads as the whole entity; and beside each command, what it reads in
// all (`sourceCommandQueries`), in the same words.
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
  const result = {
    name: null, collections, spans: [], diagnostics, implicit: [], scenarios: [], groups: [], marks: new WeakMap(),
  };
  let at = 0;

  // Which token each part of a body was read from, keyed by the object
  // that holds it: `mark(binding, 'alias', token)`. Kept beside the
  // bodies rather than in them, so what is parsed is still exactly the
  // stored shape — the language service (references, rename) is the
  // only reader.
  const mark = (object, slot, token) => {
    if (!object || typeof object !== 'object' || !token) return;
    let slots = result.marks.get(object);
    if (!slots) result.marks.set(object, slots = Object.create(null));
    slots[slot] = token;
  };
  const marksOf = (object) => (object && typeof object === 'object' && result.marks.get(object)) || null;
  const copyMarks = (from, to) => {
    const slots = marksOf(from);
    if (slots) for (const slot of Object.keys(slots)) mark(to, slot, slots[slot]);
    return to;
  };

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
      if (SOURCE_MEMBER_RE.test(token.v)) {
        const member = { enumMember: next().v };
        mark(member, 'enumMember', token);
        return member;
      }
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
  // which `alias` declares it is not known until then.
  const nameRef = () => {
    const headToken = next();
    const ref = { '%ref': [headToken.v] };
    mark(ref, 'head', headToken);
    if (accept('.')) {
      const property = ident('a property name');
      ref['%ref'].push(property.v);
      mark(ref, 'property', property);
    }
    return ref;
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
      const call = { projection, arguments: argumentList(')', derivedOperand) };
      mark(call, 'projection', token);
      return call;
    }
    if (token.t === 'ident' && !startsLiteral()) {
      const head = next().v;
      const operand = { parameterName: head };
      mark(operand, 'parameterName', token);
      if (accept('.')) {
        const property = ident('a property name');
        operand.property = property.v;
        mark(operand, 'property', property);
      }
      return operand;
    }
    return literalValue();
  };

  const handlerOperand = () => {
    if (is('event')) {
      next(); expect('.'); expect('data', '"data" — an event value is read as event.data.<property>'); expect('.');
      const property = ident('an event property');
      const operand = { eventProperty: property.v };
      mark(operand, 'eventProperty', property);
      return operand;
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
      mark(out, 'key:' + key.v, key);
      if (accept(':')) sourcePut(out, key.v, operand());
      else {
        // The shorthand is the operand the bare name would have been.
        at -= 1;
        mark(out, 'short:' + key.v, key);
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
      if (is('[')) return finish({ leftHandSide, predicate: 'equalsAny', rightHandSide: literalValue() }, negate);
      // `x in xs` against data is `xs contains x`, sides swapped — the
      // way membership reads when the one value is what the rule is
      // about. It stores, and so prints, as `contains`.
      return finish({ leftHandSide: operand(), predicate: 'contains', rightHandSide: leftHandSide }, negate);
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
      const nameToken = ident('a property name');
      const isOptional = !!accept('?');
      expect(':');
      const typeToken = ident('a type');
      const isList = !!(accept('[') && expect(']'));
      const property = { name: nameToken.v, propertyType: typeToken.v, isOptional, isList };
      mark(property, 'name', nameToken);
      mark(property, 'propertyType', typeToken);
      out.push(property);
      if (!accept(',') && !is(close) && peek().t !== 'ident') break;
    }
    expect(close, `"${close}"`);
    return out;
  };

  const parameterList = (close) => {
    const out = [];
    while (!is(close)) {
      guardBlock(close);
      const nameToken = ident('a parameter name');
      expect(':');
      const typeToken = ident('a type');
      const parameter = { name: nameToken.v, propertyType: typeToken.v };
      mark(parameter, 'name', nameToken);
      mark(parameter, 'propertyType', typeToken);
      out.push(parameter);
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
    mark(body, 'declName', nameToken);
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
    const keyword = next();
    const body = jsonValue();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) fail('A json body must be an object.', last());
    mark(body, 'json', keyword);
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
        const member = peek().t === 'string' ? next() : ident('an enum member');
        mark(members, 'i:' + members.length, member);
        members.push(member.v);
        if (!accept(',') && peek().t !== 'ident' && peek().t !== 'string') break;
      }
      expect('}', '"}" or ","');
      body = { schema: { type: 'string', enum: members } };
    } else if (keyword === 'record') {
      expect('{');
      const properties = [];
      while (!is('}')) {
        guardBlock('}');
        const nameToken = ident('a field name');
        expect(':');
        const typeToken = ident('a type');
        const field = { name: nameToken.v, propertyType: typeToken.v };
        mark(field, 'name', nameToken);
        mark(field, 'propertyType', typeToken);
        properties.push(field);
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
    // `tags courseId, items.productId` — the paths the event is tagged
    // by, after its block. Each part is marked, so a rename of the
    // property or the record field follows it.
    if (accept('tags')) {
      body.tags = [];
      do {
        const propertyToken = ident('a property to tag the event by');
        let path = propertyToken.v;
        mark(body, `tag:${body.tags.length}:property`, propertyToken);
        if (accept('.')) {
          const fieldToken = ident('a record field');
          path += '.' + fieldToken.v;
          mark(body, `tag:${body.tags.length}:field`, fieldToken);
        }
        body.tags.push(path);
      } while (accept(','));
    }
    return define('event-definition', nameToken, annotate('event-definition', body, annotations), start);
  };

  const entityDecl = (start, annotations) => {
    next();
    const nameToken = declName('an entity name');
    if (is('json')) return define('entity-definition', nameToken, annotate('entity-definition', jsonBody(), annotations), start);
    const body = {};
    if (accept('[')) {
      const typeToken = ident('the identifier type');
      body.identifierType = typeToken.v;
      mark(body, 'identifierType', typeToken);
      expect(']');
    }
    expect('{');
    body.properties = [];
    while (!is('}')) {
      guardBlock('}');
      if (is('lifecycle') && peek(1).t === 'ident' && !is('=', 1)) {
        next();
        if (body.lifecycle !== undefined) fail('An entity has one lifecycle.', last());
        const lifecycle = ident('the lifecycle property');
        body.lifecycle = lifecycle.v;
        mark(body, 'lifecycle', lifecycle);
      } else {
        const nameToken = ident('a property name, or "lifecycle"');
        expect('=', '"=" and the projection this property is');
        const projectionToken = ident('a projection name');
        const property = { name: nameToken.v, projection: projectionToken.v };
        mark(property, 'name', nameToken);
        mark(property, 'projection', projectionToken);
        body.properties.push(property);
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
    const valueType = ident('the type it holds');
    body.valueType = valueType.v;
    mark(body, 'valueType', valueType);
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
      const owner = { kind: 'projection-definition', name: nameToken.v };
      let group = null;
      const bare = [];
      while (!is('}')) {
        guardBlock('}');
        if (group && !is('scenarios')) fail('The scenarios group comes last — nothing follows it in the block.');
        if (accept('on')) {
          const eventToken = ident('an event name');
          const event = eventToken.v;
          expect('=>');
          if (peek().t === 'code') {
            const handler = { event, code: next().v };
            mark(handler, 'event', eventToken);
            mark(handler, 'code', last());
            handlers.push(handler);
          } else {
            const op = ident('an operation (set, increment, decrement, append, remove) or a ```code``` block');
            if (!OPERATIONS.includes(op.v)) {
              fail(`"${op.v}" is not an operation — set, increment, decrement, append or remove.`, op);
            }
            const handler = { event, operation: op.v };
            mark(handler, 'event', eventToken);
            if (startsHandlerOperand()) handler.value = handlerOperand();
            handlers.push(handler);
          }
        } else if (accept('script')) {
          expect('(');
          scriptField('arguments', parameterList(')'));
        } else if (accept('tagFilter')) {
          mark(body, 'tagFilter', peek());
          const filter = jsonValue();
          if (!Array.isArray(filter)) fail('tagFilter is a list of strings.', last());
          scriptField('tagFilter', filter);
        } else if (accept('initialState')) {
          mark(body, 'initialState', peek());
          scriptField('initialState', jsonValue());
        } else if (accept('exposes')) {
          const exposed = ident('the exposed field');
          mark(body, 'exposes', exposed);
          scriptField('exposes', exposed.v);
        } else if (is('scenarios')) {
          group = scenariosGroup(owner, group);
        } else if (is('scenario')) {
          bare.push(scenarioDecl(peek(), owner));
        } else {
          fail(`Expected "on", scenarios, or one of script, tagFilter, initialState, exposes, found ${describeToken(peek())}.`);
        }
      }
      const endAt = at;
      expect('}');
      ungrouped(bare, endAt);
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
    // Where the header ends, for what the editor says about the command
    // as a whole (`sourceCommandQueries`) — not a name.
    mark(body, 'open', expect('{'));
    body.boundary = [];
    body.conditions = [];
    body.publishes = [];
    const owner = { kind: 'command-definition', name: nameToken.v };
    let group = null;
    const bare = [];
    while (!is('}')) {
      guardBlock('}');
      if (group && !is('scenarios')) fail('The scenarios group comes last — nothing follows it in the block.');
      const readToken = accept('alias');
      if (readToken) {
        const aliasToken = ident('the name of the alias');
        const alias = aliasToken.v;
        const isOptional = !!accept('?');
        expect('=');
        const target = ident('an entity or a projection');
        let binding;
        if (accept('[')) {
          binding = { alias, entity: target.v, id: commandOperand() };
          mark(binding, 'entity', target);
          expect(']');
          if (accept('excluding')) binding.excluding = commandOperand();
          if (accept('with')) {
            expect('(');
            binding.arguments = argumentList(')', commandOperand);
          }
        } else {
          expect('(', '"[" and an identifier (an entity), or "(" (a projection)');
          binding = { alias, projection: target.v, arguments: argumentList(')', commandOperand) };
          mark(binding, 'projection', target);
        }
        mark(binding, 'alias', aliasToken);
        // The statement's extent, for what the editor says about the
        // read as a whole (`sourceReadQueries`) — not names, so nothing
        // resolves or renames them.
        mark(binding, 'statement', readToken);
        mark(binding, 'statementEnd', last());
        if (isOptional) binding.isOptional = true;
        body.boundary.push(binding);
      } else if (accept('require')) {
        // The message is required, as in Weltenwanderer: it is what the
        // command is refused with, and what a scenario names the refusal by.
        const rule = condition(commandOperand);
        expect('else', '"else reject" and the message the command is refused with');
        expect('reject', '"reject" and the message the command is refused with');
        mark(rule, 'rejection', peek());
        rule.rejection = string('the message the command is refused with, in quotes');
        body.conditions.push(rule);
      } else if (accept('emit')) {
        const eventToken = ident('an event name');
        const emission = { name: eventToken.v };
        mark(emission, 'name', eventToken);
        if (accept('{')) emission.parameters = argumentList('}', commandOperand);
        if (accept('when')) {
          emission.when = [condition(commandOperand)];
          while (accept('and')) emission.when.push(condition(commandOperand));
        }
        body.publishes.push(emission);
      } else if (is('scenarios')) {
        group = scenariosGroup(owner, group);
      } else if (is('scenario')) {
        bare.push(scenarioDecl(peek(), owner));
      } else {
        fail(`Expected alias, require, emit or scenarios, found ${describeToken(peek())}.`);
      }
    }
    const endAt = at;
    expect('}');
    ungrouped(bare, endAt);
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
        const out = asRead
          ? (property === undefined ? { alias: head } : { alias: head, property })
          : (property === undefined ? { parameterName: head } : { parameterName: head, property });
        return copyMarks(value, out);
      }
      const out = {};
      for (const key of Object.keys(value)) sourcePut(out, key, resolve(value[key]));
      return copyMarks(value, out);
    };
    for (const key of ['boundary', 'conditions', 'publishes']) body[key] = resolve(body[key]);
  };

  // ---------- scenarios ----------

  // A payload value: JSON, except that a bare capitalised word is an
  // enum member and reads as the string it is stored as.
  // A bare member is a string by then, so its token is marked on the
  // container that holds it (`value:<key>`, `i:<n>`) — or, at the top,
  // left in `memberToken` for the caller to place.
  let memberToken = null;
  const scenarioValue = () => {
    const token = peek();
    memberToken = null;
    if (token.t === 'ident' && SOURCE_MEMBER_RE.test(token.v)) { memberToken = token; return next().v; }
    if (accept('{')) {
      const out = {};
      while (!is('}')) {
        const keyToken = peek().t === 'string' || peek().t === 'ident'
          ? next() : fail(`Expected a property name, found ${describeToken(peek())}.`);
        expect(':');
        mark(out, 'key:' + keyToken.v, keyToken);
        sourcePut(out, keyToken.v, scenarioValue());
        mark(out, 'value:' + keyToken.v, memberToken);
        if (!accept(',')) break;
      }
      expect('}', '"}" or ","');
      memberToken = null;
      return out;
    }
    if (accept('[')) {
      const out = [];
      while (!is(']')) {
        out.push(scenarioValue());
        mark(out, 'i:' + (out.length - 1), memberToken);
        if (!accept(',')) break;
      }
      memberToken = null;
      expect(']', '"]" or ","');
      return out;
    }
    return jsonValue();
  };
  const payload = (what) => (is('{') ? scenarioValue() : fail(`Expected "{" and ${what}, found ${describeToken(peek())}.`));

  const thenItem = () => {
    if (accept('nothing')) return { nothing: true };
    if (accept('rejected')) {
      // Named by the rule's message, never by the condition.
      if (is('by')) fail('A refusal is named by the message it was refused with: then rejected "…".');
      // The message is the whole assertion: what the rule read is how
      // the decision was made, not what it was.
      const rejected = string('the message the command was refused with, in quotes');
      if (is('saw') || is('at')) fail('A refusal is named by its message alone — what the rule read is not asserted.');
      return { rejected };
    }
    const name = ident('an event, a projection, nothing or rejected');
    if (is('{')) return { event: name.v, data: scenarioValue(), subjectToken: name };
    const item = { projection: name.v, arguments: {}, positional: null, argsToken: peek(), subjectToken: name };
    if (accept('(')) {
      const named = {};
      const values = [];
      while (!is(')')) {
        if (peek().t === 'ident' && is(':', 1)) {
          const key = next();
          next();
          mark(named, 'key:' + key.v, key);
          sourcePut(named, key.v, scenarioValue());
          mark(named, 'value:' + key.v, memberToken);
        } else {
          values.push(scenarioValue());
          mark(values, 'i:' + (values.length - 1), memberToken);
        }
        if (!accept(',')) break;
      }
      expect(')', '")" or ","');
      if (values.length && Object.keys(named).length) fail('Name every argument, or none of them.', item.argsToken);
      if (values.length) item.positional = values;
      else item.arguments = named;
    }
    if (accept('==')) {
      item.value = scenarioValue();
      item.valueToken = memberToken;
    }
    return item;
  };

  // `scenario ["name"] { given … when … then … }` — see the header. The
  // record keeps what an apply needs beyond the body: where it sits,
  // where its then lines are, and which parts were left to evaluation.
  const scenarioDecl = (start, block) => {
    const from = at;
    next();
    const nameToken = peek().t === 'string' ? next() : null;
    const record = {
      block, head: start, thenRange: null, positional: null, argsToken: null, from, to: null,
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
          const event = ident('the event it was given');
          const step = { event: event.v, data: payload('the event\'s payload') };
          mark(step, 'event', event);
          given.push(step);
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
          body.then = { outcome: 'rejected', events: [], rejection: rejections[0].rejected };
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
      if (when) mark(body.when, 'command', when.token);
      if (body.then && body.then.events) {
        thens.filter((t) => t.event !== undefined).forEach((t, i) => mark(body.then.events[i], 'type', t.subjectToken));
      }
      if (projections.length) {
        mark(body, 'projection', projections[0].subjectToken);
        if ('value' in projections[0]) mark(body, 'then', projections[0].valueToken);
        record.positionalMarks = projections[0].positional ? marksOf(projections[0].positional) : null;
      }
    }
    if (block) {
      const wanted = block.kind === 'command-definition' ? 'scenario-definition' : 'projection-scenario-definition';
      if (record.kind !== wanted || record.subject !== block.name) {
        fail(`This scenario sits in ${block.name} but is about ${record.subject} — move it there, or make it about ${block.name}.`, subjectToken);
      }
    }
    const end = last();
    record.span = { line: start.line, col: start.col, endLine: end.endLine, endCol: end.endCol };
    record.to = at;
    result.scenarios.push(record);
    return record;
  };

  // `scenarios { scenario … scenario … }` — a block's scenarios, held
  // together so the editor can fold them as one. A block has at most
  // one group, and it is the block's last statement.
  const scenariosGroup = (block, previous = null) => {
    const head = next();
    // Read rather than refused, so the block's other statements and the
    // scenarios in it are not lost to the error.
    if (previous) {
      diagnostics.push({
        severity: 'error', message: 'A block has one scenarios group — move these scenarios into the first.',
        line: head.line, col: head.col, endLine: head.endLine, endCol: head.endCol,
      });
    }
    expect('{', '"{" and the scenarios');
    const records = [];
    while (!is('}')) {
      guardBlock('}');
      if (!is('scenario')) fail(`Expected scenario, found ${describeToken(peek())}.`);
      records.push(scenarioDecl(peek(), block));
    }
    const end = expect('}');
    const group = { block, head, records, span: { line: head.line, col: head.col, endLine: end.endLine, endCol: end.endCol } };
    result.groups.push(group);
    return group;
  };

  // A scenario written outside a group is read anyway, so that what it
  // says is not lost to the error, and the error carries the fix: the
  // run it belongs to, wrapped. Offered only for a run that stands
  // where a group may — one scenario after another, and at a block's
  // end — which is how every text printed before groups reads.
  const source = String(text);
  const ungrouped = (records, endAt) => {
    const runs = [];
    for (const record of records) {
      const run = runs[runs.length - 1];
      if (run && run[run.length - 1].to === record.from) run.push(record);
      else runs.push([record]);
    }
    for (const run of runs) {
      const first = run[0].head;
      const end = run[run.length - 1].span;
      const indent = source.split('\n')[first.line - 1].slice(0, first.col - 1);
      const fits = !/\S/.test(indent) && (endAt === undefined || run[run.length - 1].to === endAt);
      const body = source.slice(sourceOffset(source, first.line, 1), sourceOffset(source, end.endLine, end.endCol));
      diagnostics.push({
        severity: 'error', message: 'A scenario sits in a "scenarios { … }" group.',
        line: first.line, col: first.col, endLine: first.endLine, endCol: first.endCol,
        fix: fits ? {
          line: first.line, col: 1, endLine: end.endLine, endCol: end.endCol,
          text: `${indent}scenarios {\n${body.split('\n').map((l) => (l ? '  ' + l : l)).join('\n')}\n${indent}}`,
          title: 'Wrap in scenarios { }', label: 'Wrap',
        } : undefined,
      });
    }
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
    if (is('scenarios')) {
      if (annotations.length) fail('Scenarios carry no annotations.', annotations[0].token);
      return scenariosGroup(null);
    }
    if (is('scenario')) {
      if (annotations.length) fail('A scenario carries no annotations.', annotations[0].token);
      return topLevelBare.push(scenarioDecl(start, null));
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

  const topLevelBare = [];
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
      while (peek().t !== 'eof' && !startsDeclaration() && !(peek().first && (is('scenario') || is('scenarios')))) next();
    }
  }
  ungrouped(topLevelBare);

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
    names.forEach((key, index) => {
      sourcePut(args, key, record.positional[index]);
      if (record.positionalMarks) {
        const token = record.positionalMarks['i:' + index];
        if (token) {
          let slots = result.marks.get(args);
          if (!slots) result.marks.set(args, slots = Object.create(null));
          slots['value:' + key] = token;
        }
      }
    });
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
  const tags = body.tags || [];
  if (!Array.isArray(tags)) unprintable('its tags are not a list');
  for (const path of tags) {
    if (typeof path !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(path)) {
      unprintable(`the tag ${JSON.stringify(path)} is not a property path`);
    }
  }
  const clause = tags.length ? ` tags ${tags.join(', ')}` : '';
  return sourceAnnotations(body, ['icon']) + sourceBlock(`event ${sourceDeclName(name)}`, properties) + clause;
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
        if (aliases.has(head)) unprintable(`"${head}" names both a payload property and an alias`);
        if (value.property === undefined) return head;
        if (!parameters.has(head)) unprintable(`it reads "${head}.${value.property}" from a payload property it does not declare`);
        return `${head}.${sourceRef(value.property, 'property')}`;
      }
      if (value.alias !== undefined) {
        const head = sourceRef(value.alias, 'alias');
        const declared = aliases.has(head);
        if (!declared && parameters.has(head)) unprintable(`"${head}" names both a payload property and an alias`);
        if (value.property === undefined) {
          if (!declared) unprintable(`it reads "${head}", which no alias here declares`);
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
    if (!binding || typeof binding !== 'object') unprintable('an alias is not an object');
    const alias = sourceRef(binding.alias, 'alias') + (binding.isOptional === true ? '?' : '');
    if (binding.entity !== undefined && binding.projection === undefined) {
      if (binding.id === undefined) unprintable(`the alias "${binding.alias}" has no identifier`);
      let text = `alias ${alias} = ${sourceRef(binding.entity, 'entity')}[${operand(binding.id)}]`;
      if (binding.excluding !== undefined) text += ` excluding ${operand(binding.excluding)}`;
      if (binding.arguments !== undefined && Object.keys(binding.arguments).length) {
        text += ` with (${sourceArguments(binding.arguments, operand)})`;
      }
      return text;
    }
    if (binding.projection !== undefined && binding.entity === undefined) {
      return `alias ${alias} = ${sourceRef(binding.projection, 'projection')}(${sourceArguments(binding.arguments, operand)})`;
    }
    return unprintable(`the alias "${binding.alias}" is neither an entity nor a projection`);
  });
  const rules = (body.conditions || []).map((c) => {
    if (!c || typeof c.rejection !== 'string') unprintable('a rule has no rejection message');
    return `require ${sourceCondition(c, operand)}\n  else reject ${JSON.stringify(c.rejection)}`;
  });
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
  if (typeof then.rejection !== 'string') unprintable('its refusal names no message');
  return [`then rejected ${JSON.stringify(then.rejection)}`];
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

// One scenario, in the grammar when it survives the trip back and as
// JSON under a comment when it does not — `printDefinitionSource`'s
// contract, for a definition keyed by an id the text never shows.
function printScenarioSource(model, kind, body, { positional }) {
  let reason;
  try {
    const text = printScenario(model, kind, body, { positional });
    const back = parseModelSource(sourceScenarioGroup([text]), { projections: model['projection-definitions'] });
    const [record] = back.scenarios;
    if (!back.diagnostics.length && back.scenarios.length === 1 && record.kind === kind && sameDefinition(record.body, body)) {
      return text;
    }
    reason = 'it holds something the code form does not say exactly';
  } catch (error) {
    reason = error instanceof SourceUnprintable ? error.message : 'it is not shaped the way the code form expects';
  }
  return `// Written as JSON: ${reason}.\nscenario json ${JSON.stringify(body, null, 2)}`;
}

const sourceIndent = (text) => text.split('\n').map((line) => (line ? '  ' + line : line)).join('\n');

// Printed scenarios as the one group they are written in.
function sourceScenarioGroup(scenarios) {
  return `scenarios {\n${scenarios.map(sourceIndent).join('\n\n')}\n}`;
}

// A block's text with its scenarios' group added at its end, opening
// the block if the definition printed without one (a derived projection).
function sourceNest(text, scenarios) {
  if (!scenarios.length) return text;
  const inner = sourceIndent(sourceScenarioGroup(scenarios));
  if (text.endsWith(' {}')) return `${text.slice(0, -1)}\n${inner}\n}`;
  if (text.endsWith('\n}')) return `${text.slice(0, -1)}\n${inner}\n}`;
  return `${text} {\n${inner}\n}`;
}

// The whole model. Definitions of one kind sit in their stored order —
// the text's order *is* the order an apply stores — and consecutive
// one-liners stay together, so twenty value types read as a table.
// Scenarios sit in a group at the end of their command's or
// projection's block; one whose subject is gone, or whose subject is
// printed as JSON, sits in a group at the end of the text instead.
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
    out.push('', '// Scenarios', '',
      sourceScenarioGroup(loose.map(([kind, body]) => printScenarioSource(model, kind, body, { positional: false }))));
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

// What each `alias` adds to its command's append condition, as the text
// stands. `alias course = Course[courseId]` names an instance, not what
// is queried of it: only the properties a rule, guard or emission
// actually uses put their projections' events in the query
// (`deriveDcb`), so a command testing `course.status` never conflicts
// with a `CourseCapacityChanged`. The line says the opposite at a
// glance, which is why the editor says beside it how many event types
// it reads (`hint`, in the command line's words: "reads 2 types") and
// the rest — the types themselves, tag, per-property events, the
// properties left out, why the read is made — on hover. One whose
// properties nothing uses is queried by tag alone, every event under
// it, and the hint says so rather than reading as empty.
function sourceReadQueries(model, parsed) {
  const draft = sourceDraftModel(model, parsed);
  const found = [];
  for (const [command, body] of Object.entries(parsed.collections['command-definition'])) {
    let dcb;
    let references;
    try {
      dcb = deriveDcb(draft, body);
      references = bindingReferences(draft, body);
    } catch { continue; }
    for (const binding of body.boundary || []) {
      const slots = (binding && parsed.marks.get(binding)) || {};
      const item = dcb.items.find((i) => i.alias === binding.alias);
      if (!slots.statement || !slots.statementEnd || !item) continue;
      const entity = binding.entity !== undefined ? draft['entity-definitions'][binding.entity] : null;
      const properties = ((entity && entity.properties) || []).filter((p) => p && p.name);
      const read = properties.filter((p) => item.readProperties.includes(p.name));
      const reasons = [...(references.get(binding.alias) || [])];
      const types = item.types.length
        ? `${item.types.length} type${item.types.length === 1 ? '' : 's'}` : 'any type';
      found.push({
        command,
        alias: binding.alias,
        start: slots.statement,
        end: slots.statementEnd,
        tags: item.tags,
        types: item.types,
        fannedOut: !!item.fannedOut,
        properties: read.map((p) => ({ name: p.name, types: projectionHandledTypes(draft, p.projection).sort() })),
        unread: properties.filter((p) => !read.includes(p)).map((p) => p.name),
        reasons,
        hint: `‹reads ${types}${item.fannedOut ? ', one per element' : ''}${reasons.length ? '' : ' — unused'}›`,
      });
    }
  }
  return found;
}

// What each command reads in all, for its header line: the summary
// every view gives (`boundarySummary` — "reads 5 types, 2 tags, in 2
// queries") and the queries behind it, for the hover. `start`/`end`
// span the header, from the line the name is on to its `{`.
function sourceCommandQueries(model, parsed) {
  const draft = sourceDraftModel(model, parsed);
  const found = [];
  for (const [command, body] of Object.entries(parsed.collections['command-definition'])) {
    const open = (parsed.marks.get(body) || {}).open;
    const span = sourceSpanOf(parsed, 'command-definition', command);
    if (!open || !span) continue;
    let summary;
    try { summary = boundarySummary(draft, body); } catch { continue; }
    found.push({
      command, start: { line: span.nameLine, col: 1 }, end: open,
      ...summary, hint: `‹${summary.words}›`,
    });
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
// out are written as null (as the page's save does), and an omitted
// Then is what the text's definitions make of the scenario.
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
  if (reason) return { body, status: 'broken', reason };
  return { body, status: evSameOutcome(actual, body.then) ? 'current' : 'drifted', actual };
}

const SCENARIO_SUBJECT = { 'scenario-definition': 'command', 'projection-scenario-definition': 'projection' };

// The scenario collections the text describes, keyed by the ids they
// already have. A scenario carries no id in the text, so which stored
// one a block *is* is matched: an unchanged block by its content, an
// edited one by its place among its subject's scenarios, one whose
// subject was renamed by its place among the leftovers — and whatever
// is still unmatched is new.
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
      const hit = [...free].find((id) => sameDefinition(stored[id], w.body));
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
        title: 'Accept actual outcome', label: 'Accept',
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
// The language service: what the editor knows about a text beyond
// whether it parses — which definition each name in it stands for
// (go to definition, references, a rename that cannot hit a
// look-alike) and what may be written at the cursor (completion).
// Pure like the rest of this file; index.html only adapts it to
// Monaco's providers.
// ============================================================

// A symbol is a string: its kind, then the names that place it —
// `member CourseStatus Existent`, `alias DefineCourse course`. Two
// names are the same symbol exactly when these are equal, which is what
// keeps `Existent` apart from `NonExistent`, and the projection called
// CourseStatus apart from the enum of the same name.
const SOURCE_SYMBOL_WORDS = {
  type: 'type', event: 'event', entity: 'entity', projection: 'projection', command: 'command',
  member: 'enum member', field: 'record field', eventProperty: 'event property',
  entityProperty: 'entity property', commandProperty: 'command property', alias: 'alias',
  projectionParameter: 'projection parameter',
};

const SOURCE_KIND_SYMBOL = {
  'custom-type-definition': 'type',
  'event-definition': 'event',
  'entity-definition': 'entity',
  'projection-definition': 'projection',
  'command-definition': 'command',
};

const sourceSymbol = (kind, ...names) => [kind, ...names].join(' ');

function sourceSymbolParts(symbol) {
  const [kind, ...names] = symbol.split(' ');
  return { kind, names, name: names[names.length - 1], owner: names.length > 1 ? names[0] : null };
}

// The definitions a text declares, in the shape the model helpers read
// (`resolveOperandType`, `operationsFor`, …) — optionally over a stored
// model, whose definitions fill in for any the text does not hold, as a
// declaration that fails to parse while it is being typed.
function sourceTextModel(parsed, fallback) {
  const model = {};
  for (const kind of DEF_KINDS) {
    const own = SOURCE_KINDS.includes(kind) ? parsed.collections[kind] : {};
    model[DEF_COLLECTIONS[kind]] = fallback ? { ...(fallback[DEF_COLLECTIONS[kind]] || {}), ...own } : own;
  }
  return model;
}

// Every name in a parsed text, resolved: `occurrences` (`{ symbol,
// token, decl, shorthand }`), `ambiguous` (an enum member some other
// enum also has, written where nothing says which type is meant) and
// `opaque` (a script, a json body, a tag filter — text a name may hide
// in without the grammar seeing it, which a rename has to refuse over
// rather than silently miss).
//
// It walks the bodies, not the tokens: the parser marked which token
// each part came from (`parsed.marks`), and the bodies say what that
// part *is* — whose property `course.status` reads is the read's
// entity's, and which enum `Existent` belongs to is the type on the
// other side of its rule. `{ courseId }` is one token and two symbols,
// the emitted event's property and the command's own, told apart by
// `shorthand: 'key' | 'value'`.
function sourceSymbols(parsed) {
  if (parsed.symbols) return parsed.symbols;
  const { collections, marks } = parsed;
  const model = sourceTextModel(parsed);
  const has = (object, key) => !!object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
  const slotsOf = (object) => (object && typeof object === 'object' && marks && marks.get(object)) || {};
  const occurrences = [];
  const ambiguous = [];
  const opaque = [];
  const shorthands = new Set();
  const add = (symbol, token, extra = {}) => {
    if (!token) return;
    const shorthand = extra.shorthand || (shorthands.has(token) ? 'value' : undefined);
    occurrences.push({ symbol, token, decl: !!extra.decl, ...(shorthand ? { shorthand } : {}) });
  };
  const types = collections['custom-type-definition'];
  const events = collections['event-definition'];
  const entities = collections['entity-definition'];
  const projections = collections['projection-definition'];
  const commands = collections['command-definition'];
  const own = (collection, name) => (typeof name === 'string' && has(collection, name) ? collection[name] : null);
  const list = (value) => (Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') : []);
  const membersOf = (typeName) => {
    const body = own(types, typeName);
    const members = body && body.schema && body.schema.enum;
    return Array.isArray(members) ? members : [];
  };
  const recordFields = (typeName) => {
    const body = own(types, typeName);
    return body && Array.isArray(body.properties) ? list(body.properties) : null;
  };
  const typeRef = (token) => {
    if (token && !SOURCE_BASE_TYPES.includes(token.v)) add(sourceSymbol('type', token.v), token);
  };
  const member = (token, name, typeName) => {
    if (!token || typeof name !== 'string') return;
    const owners = Object.keys(types).filter((t) => membersOf(t).includes(name));
    const owner = owners.includes(typeName) ? typeName : owners.length === 1 ? owners[0] : null;
    if (owner) add(sourceSymbol('member', owner, name), token);
    else if (owners.length) ambiguous.push({ token, name, candidates: owners.map((o) => sourceSymbol('member', o, name)) });
  };
  const literal = (value, typeName) => {
    if (Array.isArray(value)) return value.forEach((v) => literal(v, typeName));
    if (has(value, 'enumMember')) member(slotsOf(value).enumMember, value.enumMember, typeName);
  };
  const declare = (kind, name, body) => {
    const slots = slotsOf(body);
    add(sourceSymbol(kind, name), slots.declName, { decl: true });
    if (slots.json) { opaque.push({ token: slots.json, text: JSON.stringify(body), json: true }); return false; }
    return true;
  };
  const parameters = (projection) => list(projection && (projection.script ? projection.script.arguments : projection.parameters));
  const parameterType = (projectionName, key) => {
    const found = parameters(own(projections, projectionName)).find((p) => p.name === key);
    return found ? found.propertyType : null;
  };
  // `name: value` pairs, keyed by the symbol each key names.
  const keyed = (args, symbolOf, value) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return;
    const slots = slotsOf(args);
    for (const key of Object.keys(args)) {
      const short = slots['short:' + key];
      if (short) shorthands.add(short);
      const symbols = [].concat(symbolOf(key) || []);
      for (const symbol of symbols) add(symbol, slots['key:' + key], short ? { shorthand: 'key' } : {});
      value(args[key], key);
    }
  };

  // ---------- types, events, entities ----------
  for (const [name, body] of Object.entries(types)) {
    if (!declare('type', name, body)) continue;
    const members = body && body.schema && body.schema.enum;
    if (Array.isArray(members)) {
      const slots = slotsOf(members);
      members.forEach((m, i) => add(sourceSymbol('member', name, m), slots['i:' + i], { decl: true }));
    }
    for (const field of list(body && body.properties)) {
      add(sourceSymbol('field', name, field.name), slotsOf(field).name, { decl: true });
      typeRef(slotsOf(field).propertyType);
    }
  }
  for (const [name, body] of Object.entries(events)) {
    if (!declare('event', name, body)) continue;
    for (const property of list(body.properties)) {
      add(sourceSymbol('eventProperty', name, property.name), slotsOf(property).name, { decl: true });
      typeRef(slotsOf(property).propertyType);
    }
    (Array.isArray(body.tags) ? body.tags : []).forEach((path, index) => {
      if (typeof path !== 'string') return;
      const [propertyName, fieldName] = path.split('.');
      add(sourceSymbol('eventProperty', name, propertyName), slotsOf(body)[`tag:${index}:property`]);
      const property = list(body.properties).find((p) => p && p.name === propertyName);
      if (fieldName !== undefined && property) {
        add(sourceSymbol('field', property.propertyType, fieldName), slotsOf(body)[`tag:${index}:field`]);
      }
    });
  }
  for (const [name, body] of Object.entries(entities)) {
    if (!declare('entity', name, body)) continue;
    const slots = slotsOf(body);
    typeRef(slots.identifierType);
    if (slots.lifecycle) add(sourceSymbol('entityProperty', name, body.lifecycle), slots.lifecycle);
    for (const property of list(body.properties)) {
      add(sourceSymbol('entityProperty', name, property.name), slotsOf(property).name, { decl: true });
      add(sourceSymbol('projection', property.projection), slotsOf(property).projection);
    }
  }

  // ---------- projections ----------
  const handlerValue = (value, typeName, event) => {
    if (has(value, 'eventProperty')) add(sourceSymbol('eventProperty', event, value.eventProperty), slotsOf(value).eventProperty);
    else if (has(value, 'successor')) handlerValue(value.successor, typeName, event);
    else literal(value, typeName);
  };
  for (const [name, body] of Object.entries(projections)) {
    if (!declare('projection', name, body)) continue;
    const slots = slotsOf(body);
    for (const parameter of [...list(body.parameters), ...list(body.script && body.script.arguments)]) {
      add(sourceSymbol('projectionParameter', name, parameter.name), slotsOf(parameter).name, { decl: true });
      typeRef(slotsOf(parameter).propertyType);
    }
    typeRef(slots.valueType);
    literal(body.initialValue, body.valueType);
    for (const slot of ['tagFilter', 'initialState']) {
      if (slots[slot] && body.script) opaque.push({ token: slots[slot], text: JSON.stringify(body.script[slot]) });
    }
    for (const handler of list(body.handlers)) {
      add(sourceSymbol('event', handler.event), slotsOf(handler).event);
      if (typeof handler.code === 'string') opaque.push({ token: slotsOf(handler).code, text: handler.code });
      if (handler.value !== undefined) handlerValue(handler.value, body.valueType, handler.event);
    }
    if (body.derived && typeof body.derived === 'object') {
      const typeOf = (operand) => {
        if (has(operand, 'projection')) { const p = own(projections, operand.projection); return p ? p.valueType : null; }
        if (has(operand, 'parameterName')) {
          const typeName = parameterType(name, operand.parameterName);
          if (operand.property === undefined) return typeName;
          const field = (recordFields(typeName) || []).find((f) => f.name === operand.property);
          return field ? field.propertyType : null;
        }
        return null;
      };
      const operand = (value, expected) => {
        if (Array.isArray(value)) return value.forEach((v) => operand(v, expected));
        const marked = slotsOf(value);
        if (has(value, 'projection')) {
          add(sourceSymbol('projection', value.projection), marked.projection);
          keyed(value.arguments, (key) => sourceSymbol('projectionParameter', value.projection, key),
            (arg, key) => operand(arg, parameterType(value.projection, key)));
        } else if (has(value, 'parameterName')) {
          add(sourceSymbol('projectionParameter', name, value.parameterName), marked.parameterName);
          const typeName = parameterType(name, value.parameterName);
          if (marked.property && recordFields(typeName)) add(sourceSymbol('field', typeName, value.property), marked.property);
        } else literal(value, expected);
      };
      const { leftHandSide, rightHandSide } = body.derived;
      operand(leftHandSide, typeOf(rightHandSide));
      if (rightHandSide !== undefined) operand(rightHandSide, typeOf(leftHandSide));
    }
  }

  // ---------- commands ----------
  // A name in a scenario's rule is still `%ref` — resolved here against
  // the command it is about, by the rule `resolveCommandNames` uses.
  const commandOperand = (commandName, body, value, expected) => {
    if (Array.isArray(value)) return value.forEach((v) => commandOperand(commandName, body, v, expected));
    const marked = slotsOf(value);
    let alias;
    let parameter;
    let property;
    if (has(value, '%ref')) {
      const [head, prop] = value['%ref'];
      const asRead = list(body.boundary).some((b) => b.alias === head)
        || (!list(body.properties).some((p) => p.name === head) && prop !== undefined);
      if (asRead) alias = head; else parameter = head;
      property = prop;
    } else if (has(value, 'alias')) {
      ({ alias, property } = value);
    } else if (has(value, 'parameterName')) {
      parameter = value.parameterName;
      ({ property } = value);
    } else return literal(value, expected);
    if (alias !== undefined) {
      add(sourceSymbol('alias', commandName, alias), marked.head);
      const binding = list(body.boundary).find((b) => b.alias === alias);
      if (binding && binding.entity && property !== undefined) {
        add(sourceSymbol('entityProperty', binding.entity, property), marked.property);
      }
      return;
    }
    add(sourceSymbol('commandProperty', commandName, parameter), marked.head);
    const declared = list(body.properties).find((p) => p.name === parameter);
    if (declared && property !== undefined && recordFields(declared.propertyType)) {
      add(sourceSymbol('field', declared.propertyType, property), marked.property);
    }
  };
  const operandType = (body, operand) => {
    let resolved = null;
    try {
      const plain = has(operand, '%ref') ? null : operand;
      resolved = plain && resolveOperandType(plain, {
        boundary: list(body.boundary), commandProperties: list(body.properties), model,
      });
    } catch { /* a defective body types nothing */ }
    return resolved ? resolved.propertyType : null;
  };
  const condition = (commandName, body, rule) => {
    if (!rule || typeof rule !== 'object') return;
    const left = operandType(body, rule.leftHandSide);
    const right = Array.isArray(rule.rightHandSide) ? null : operandType(body, rule.rightHandSide);
    commandOperand(commandName, body, rule.leftHandSide, right);
    if (rule.rightHandSide !== undefined) commandOperand(commandName, body, rule.rightHandSide, left);
    return left;
  };
  const eventPropertyType = (event, key) => {
    const found = list(own(events, event) && own(events, event).properties).find((p) => p.name === key);
    return found ? found.propertyType : null;
  };
  for (const [name, body] of Object.entries(commands)) {
    if (!declare('command', name, body)) continue;
    for (const property of list(body.properties)) {
      add(sourceSymbol('commandProperty', name, property.name), slotsOf(property).name, { decl: true });
      typeRef(slotsOf(property).propertyType);
    }
    for (const binding of list(body.boundary)) {
      const slots = slotsOf(binding);
      add(sourceSymbol('alias', name, binding.alias), slots.alias, { decl: true });
      if (binding.projection !== undefined) {
        add(sourceSymbol('projection', binding.projection), slots.projection);
        keyed(binding.arguments, (key) => sourceSymbol('projectionParameter', binding.projection, key),
          (arg, key) => commandOperand(name, body, arg, parameterType(binding.projection, key)));
        continue;
      }
      add(sourceSymbol('entity', binding.entity), slots.entity);
      const entity = own(entities, binding.entity);
      const idType = (entity && entity.identifierType) || binding.entity + 'Id';
      commandOperand(name, body, binding.id, idType);
      if (binding.excluding !== undefined) commandOperand(name, body, binding.excluding, idType);
      // `with (…)` hands values to the entity's scripted properties: a
      // key is the parameter of every property projection declaring it.
      const propertyProjections = list(entity && entity.properties).map((p) => p.projection);
      keyed(binding.arguments,
        (key) => propertyProjections.filter((p) => parameterType(p, key) !== null)
          .map((p) => sourceSymbol('projectionParameter', p, key)),
        (arg) => commandOperand(name, body, arg, null));
    }
    for (const rule of list(body.conditions)) condition(name, body, rule);
    for (const emission of list(body.publishes)) {
      add(sourceSymbol('event', emission.name), slotsOf(emission).name);
      keyed(emission.parameters, (key) => sourceSymbol('eventProperty', emission.name, key),
        (arg, key) => commandOperand(name, body, arg, eventPropertyType(emission.name, key)));
      for (const rule of list(emission.when)) condition(name, body, rule);
    }
  }

  // ---------- scenarios ----------
  // A payload's keys are its subject's properties; a bare member in it
  // was marked on its container, typed by the property it fills.
  const payload = (data, properties, symbolOf) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const slots = slotsOf(data);
    for (const key of Object.keys(data)) {
      add(symbolOf(key), slots['key:' + key]);
      const declared = list(properties).find((p) => p.name === key);
      const typeName = declared ? declared.propertyType : null;
      member(slots['value:' + key], data[key], typeName);
      const value = data[key];
      if (Array.isArray(value)) {
        const items = slotsOf(value);
        value.forEach((v, i) => member(items['i:' + i], v, typeName));
      } else if (value && typeof value === 'object' && recordFields(typeName)) {
        payload(value, recordFields(typeName), (k) => sourceSymbol('field', typeName, k));
      }
    }
  };
  const eventPayload = (eventName, data) => payload(data, own(events, eventName) && own(events, eventName).properties,
    (key) => sourceSymbol('eventProperty', eventName, key));
  for (const record of parsed.scenarios) {
    const { body } = record;
    const slots = slotsOf(body);
    if (slots.json) { opaque.push({ token: slots.json, text: JSON.stringify(body), json: true }); continue; }
    for (const step of list(body.given)) {
      add(sourceSymbol('event', step.event), slotsOf(step).event);
      eventPayload(step.event, step.data);
    }
    if (record.kind === 'scenario-definition') {
      const commandName = body.command;
      const command = own(commands, commandName) || {};
      add(sourceSymbol('command', commandName), slotsOf(body.when).command);
      if (body.when) {
        payload(body.when.arguments, command.properties, (key) => sourceSymbol('commandProperty', commandName, key));
      }
      for (const event of list(body.then && body.then.events)) {
        add(sourceSymbol('event', event.type), slotsOf(event).type);
        eventPayload(event.type, event.data);
      }
    } else {
      const projection = own(projections, body.projection);
      add(sourceSymbol('projection', body.projection), slots.projection);
      payload(body.arguments, parameters(projection), (key) => sourceSymbol('projectionParameter', body.projection, key));
      member(slots.then, body.then, projection && projection.valueType);
      if (Array.isArray(body.then)) {
        const items = slotsOf(body.then);
        body.then.forEach((v, i) => member(items['i:' + i], v, projection && projection.valueType));
      }
    }
  }
  const symbols = { occurrences, ambiguous, opaque };
  Object.defineProperty(parsed, 'symbols', { value: symbols, enumerable: false });
  return symbols;
}

const sourceTokenHas = (token, line, col) => token.line === line && col >= token.col && col <= token.endCol;

// The symbol under a 1-based position, with every place it occurs.
// On a shorthand (`{ courseId }`) it is the value — the command's own
// name, the way a rename in a shorthand property means the variable —
// and `symbols` lists both, for go to definition.
function sourceSymbolAt(parsed, line, col) {
  const { occurrences, ambiguous } = sourceSymbols(parsed);
  let hits = occurrences.filter((o) => sourceTokenHas(o.token, line, col));
  // Between two names (`a.|b`), the one the cursor is in front of.
  const inside = hits.filter((o) => col < o.token.endCol);
  if (inside.length) hits = inside;
  if (!hits.length) {
    const unclear = ambiguous.find((a) => sourceTokenHas(a.token, line, col));
    return unclear ? { ambiguous: unclear } : null;
  }
  const symbols = [...new Set(hits.map((o) => o.symbol))];
  const chosen = (hits.find((o) => o.shorthand === 'value') || hits[0]).symbol;
  return {
    symbol: chosen,
    symbols,
    token: hits[0].token,
    occurrences: occurrences.filter((o) => o.symbol === chosen),
  };
}

// Where a symbol is declared — or nothing, for a name the text only
// uses (an identifier type left implicit, a dangling reference).
function sourceDeclarationOf(parsed, symbol) {
  return sourceSymbols(parsed).occurrences.find((o) => o.symbol === symbol && o.decl) || null;
}

// ---------- rename ----------

// The names a kind of symbol may take. A lowercase one has to stay
// lowercase and a member capitalised, or the parser would read it as
// the other thing — a literal where a name was, or the reverse.
const SOURCE_RENAME_RULES = {
  member: [SOURCE_MEMBER_RE, 'an enum member starts with a capital letter'],
  type: [SOURCE_IDENT_RE, 'a name is letters, digits and _'],
  event: [SOURCE_IDENT_RE, 'a name is letters, digits and _'],
  entity: [SOURCE_IDENT_RE, 'a name is letters, digits and _'],
  projection: [SOURCE_MEMBER_RE, 'a projection starts with a capital letter'],
  command: [SOURCE_IDENT_RE, 'a name is letters, digits and _'],
};
const SOURCE_LOWER_NAME_RE = /^[a-z_][A-Za-z0-9_]*$/;
// What a script can name: an event's or a record's field
// (`event.data.x`, `state.x`), a member as the string it is, and — in
// a tag filter — an argument and a type. A json body can name anything.
const SOURCE_SCRIPT_VISIBLE = ['eventProperty', 'field', 'member', 'projectionParameter', 'type'];
const sourceArticle = (word) => (/^[aeiou]/.test(word) ? 'an' : 'a');
const SOURCE_RESERVED_NAMES = ['true', 'false', 'null', 'enum', 'not', 'count', 'event', 'currentValue', 'successor'];

// Edits that rename the symbol at a position, everywhere it occurs and
// nowhere else: `{ edits: [{ line, col, endLine, endCol, text }] }`, or
// `{ error }` saying why not. Safe means three refusals: a name a
// script, a json body or a tag filter may also hold (the grammar cannot
// see in there); an enum member written somewhere its enum cannot be
// told; and a result that would not read back as the same model with
// one name changed — checked by renaming, re-reading, and counting.
//
// An entity whose identifier type is still `<Name>Id` takes the type
// along, as renaming it on its page does; a type an entity tracks that
// way is pinned on the entity (`entity Course[CourseKey]`) instead of
// silently cut loose from it.
function sourceRename(text, line, col, newName) {
  const parsed = parseModelSource(text);
  const target = sourceRenameTarget(parsed, line, col);
  return target.error ? target : sourceRenameSymbol(text, parsed, target.symbol, newName);
}

// What a rename at a position would rename — `{ symbol, token }` — or
// `{ error }` before a new name is even asked for.
function sourceRenameTarget(parsed, line, col) {
  const at = sourceSymbolAt(parsed, line, col);
  if (!at) return { error: 'There is nothing here to rename.' };
  if (at.ambiguous) {
    const { name, candidates } = at.ambiguous;
    return { error: `${name} is a member of ${candidates.map((c) => sourceSymbolParts(c).owner).join(' and ')}, and nothing here says which — rename it at its declaration.` };
  }
  if (at.token.t !== 'ident') return { error: `${at.token.v} is written in quotes; rename it by hand.` };
  return { symbol: at.symbol, token: at.token };
}

function sourceRenameSymbol(text, parsed, symbol, newName) {
  const { occurrences, ambiguous, opaque } = sourceSymbols(parsed);
  const { kind, names, name } = sourceSymbolParts(symbol);
  const word = SOURCE_SYMBOL_WORDS[kind];
  newName = String(newName).trim();
  if (newName === name) return { edits: [] };
  const [rule, why] = SOURCE_RENAME_RULES[kind] || [SOURCE_LOWER_NAME_RE, `${sourceArticle(word)} ${word} starts with a lowercase letter`];
  if (!rule.test(newName)) return { error: `"${newName}" cannot name ${sourceArticle(word)} ${word}: ${why}.` };
  if (SOURCE_RESERVED_NAMES.includes(newName) || SOURCE_BASE_TYPES.includes(newName)) {
    return { error: `"${newName}" is a word of the language.` };
  }
  const renamed = (s, to) => sourceSymbol(sourceSymbolParts(s).kind, ...sourceSymbolParts(s).names.slice(0, -1), to);
  const group = [[symbol, newName]];
  const inserts = [];
  const entities = parsed.collections['entity-definition'];
  const tracks = (entity) => entity && typeof entity === 'object' && !entity.identifierType;
  if (kind === 'entity' && tracks(entities[name])) {
    group.push([sourceSymbol('type', name + 'Id'), newName + 'Id']);
  }
  if (kind === 'type') {
    for (const [entityName, entity] of Object.entries(entities)) {
      if (!tracks(entity) || entityName + 'Id' !== name) continue;
      const decl = sourceDeclarationOf(parsed, sourceSymbol('entity', entityName));
      if (decl) inserts.push({ token: decl.token, text: `${entityName}[${newName}]` });
    }
  }

  const edits = [];
  for (const [from, to] of group) {
    const target = renamed(from, to);
    // A read and a command property are one namespace in the text,
    // which resolves a name to whichever the command declares.
    const clashes = kind === 'alias' || kind === 'commandProperty'
      ? [sourceSymbol('alias', names[0], to), sourceSymbol('commandProperty', names[0], to)]
      : [target];
    const clash = occurrences.find((o) => clashes.includes(o.symbol));
    if (clash) {
      const parts = sourceSymbolParts(clash.symbol);
      const what = SOURCE_SYMBOL_WORDS[parts.kind];
      return { error: `There already is ${sourceArticle(what)} ${what} named ${to}${parts.owner ? ` in ${parts.owner}` : ''}.` };
    }
    const fromName = sourceSymbolParts(from).name;
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${fromName}($|[^A-Za-z0-9_])`);
    const visible = SOURCE_SCRIPT_VISIBLE.includes(sourceSymbolParts(from).kind);
    const hidden = opaque.find((o) => (o.json || visible) && pattern.test(o.text));
    if (hidden) {
      return { error: `${fromName} also appears in the script or JSON at line ${hidden.token.line}, which a rename cannot follow into — change it there by hand.` };
    }
    const unclear = ambiguous.find((a) => a.candidates.includes(from));
    if (unclear) {
      return { error: `${fromName} at line ${unclear.token.line} could be a member of ${unclear.candidates.map((c) => sourceSymbolParts(c).owner).join(' or ')} — nothing there says which.` };
    }
    for (const o of occurrences.filter((x) => x.symbol === from)) {
      if (o.token.t !== 'ident') return { error: `${fromName} is written in quotes at line ${o.token.line}; rename it there by hand.` };
      const replacement = o.shorthand === 'key' ? `${to}: ${fromName}` : o.shorthand === 'value' ? `${fromName}: ${to}` : to;
      edits.push({ line: o.token.line, col: o.token.col, endLine: o.token.endLine, endCol: o.token.endCol, text: replacement });
    }
  }
  for (const { token, text: replacement } of inserts) {
    const existing = edits.find((e) => e.line === token.line && e.col === token.col);
    if (existing) existing.text = existing.text + replacement.slice(replacement.indexOf('['));
    else edits.push({ line: token.line, col: token.col, endLine: token.endLine, endCol: token.endCol, text: replacement });
  }

  // The proof: the renamed text reads with no new errors, and each
  // renamed symbol occurs exactly where it did — no more (it merged
  // into a look-alike), no fewer (some use now reads as something else).
  const after = sourceApplyEdits(text, edits);
  const reread = parseModelSource(after);
  if (reread.diagnostics.length > parsed.diagnostics.length) {
    return { error: `Renaming to ${newName} would not read back: ${reread.diagnostics[0].message}` };
  }
  const count = (list, s) => list.filter((o) => o.symbol === s).length;
  const before = occurrences;
  const now = sourceSymbols(reread).occurrences;
  for (const [from, to] of group) {
    const expected = count(before, from) + (sourceSymbolParts(from).kind === 'type' ? inserts.length : 0);
    if (count(now, renamed(from, to)) !== expected || count(now, from) !== 0) {
      return { error: `Renaming to ${newName} would change what the text means — some other name would read differently.` };
    }
  }
  return { edits };
}

// Applies `{ line, col, endLine, endCol, text }` edits (1-based,
// non-overlapping) to a text.
function sourceApplyEdits(text, edits) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  const offset = (line, col) => (starts[line - 1] === undefined ? text.length : starts[line - 1] + col - 1);
  let out = text;
  const ordered = edits.map((e) => ({ ...e, from: offset(e.line, e.col), to: offset(e.endLine, e.endCol) }))
    .sort((a, b) => b.from - a.from);
  for (const e of ordered) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

// ---------- completion ----------

const SOURCE_CONDITION_STARTS = ['require', 'when', 'and'];
const SOURCE_COMPARISONS = ['==', '!=', '<', '<=', '>', '>=', ...SOURCE_WORD_PREDICATES];
// How each predicate is written after an operand, in the order a rule
// editor offers them.
const SOURCE_PREDICATE_SPELLINGS = {
  equals: ['==', '!='], lessThan: ['<'], lessThanOrEquals: ['<='], greaterThan: ['>'],
  greaterThanOrEquals: ['>='], equalsAny: ['in [$1]', 'not in [$1]'], contains: ['contains', 'not contains'],
  containsAny: ['containsAny', 'not containsAny'], startsWith: ['startsWith'], endsWith: ['endsWith'],
  isEmpty: ['is empty'], isNotEmpty: ['is not empty'], isTrue: ['is true'], isFalse: ['is false'],
};

// A group opens with its first scenario, since a group holds nothing else.
const SOURCE_SCENARIO_SNIPPET = 'scenario "${1}" {\n\t$0\n}';
const SOURCE_GROUP_SNIPPET = 'scenarios {\n\tscenario "${1}" {\n\t\t$0\n\t}\n}';

const SOURCE_DECLARATION_SNIPPETS = [
  ['command', 'command ${1:Name}(${2}) {\n\t$0\n}'],
  ['event', 'event ${1:Name} { $0 }'],
  ['entity', 'entity ${1:Name} {\n\t$0\n}'],
  ['projection', 'projection ${1:Name}(${2}): ${3:integer} = ${4:0} {\n\t$0\n}'],
  ['enum', 'enum ${1:Name} { $0 }'],
  ['tag type', 'tag type ${1:Name} = string'],
  ['type', 'type ${1:Name} = ${2:string}'],
  ['record', 'record ${1:Name} {\n\t$0\n}'],
  ['scenarios', SOURCE_GROUP_SNIPPET],
];

function sourceOffset(text, line, col) {
  let offset = 0;
  for (let l = 1; l < line; l += 1) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(text.length, offset + col - 1);
}

// What may be written at a 1-based position: `{ items, slot }`. Each
// item is `{ label, kind, detail, insert, snippet, sort, retrigger }` —
// `kind` one of the symbol kinds or `keyword`, `insert` a Monaco
// snippet when `snippet` is set. `slot` says the cursor sits where
// something specific is expected (after `require`, `on`, `emit E {`,
// `course.`), which is when a space alone should open the list.
//
// The context is read off the tokens before the cursor, not the parse:
// the text is mid-edit and rarely parses there. A stack of the brackets
// still open says what the cursor is inside — a command's body, an
// emit's arguments, a scenario's payload — and the tokens since the
// statement began say where in it. What the names mean comes from the
// whole text's parse, with `model`'s definitions filling in for any
// that fail to parse while being typed.
function sourceCompletions(text, line, col, { model = null } = {}) {
  const none = { items: [], slot: false };
  const prefix = text.slice(0, sourceOffset(text, line, col));
  const lexed = lexSource(prefix);
  if (lexed.diagnostics.some((d) => /never closed/.test(d.message))) return none;
  const lineText = prefix.slice(prefix.lastIndexOf('\n') + 1).replace(/"([^"\\]|\\.)*"/g, '""');
  if (lineText.includes('//')) return none;
  const tokens = lexed.tokens.slice(0, -1);
  if (tokens.length && tokens[tokens.length - 1].t === 'number' && /[0-9.]$/.test(prefix)) return none;
  if (/[A-Za-z0-9_]$/.test(prefix) && tokens.length && tokens[tokens.length - 1].t === 'ident') tokens.pop();
  const atLineStart = !tokens.length || tokens[tokens.length - 1].endLine < line;

  // ---------- where the cursor is ----------
  const DECL_WORDS = ['model', 'type', 'tag', 'enum', 'record', 'event', 'entity', 'projection', 'command', 'scenarios', 'scenario', '@'];
  const v = (t) => (t ? t.v : undefined);
  const frames = [{ kind: 'top', level: 0, open: -1, stmt: 0 }];
  const level = [];
  let decl = { keyword: null, name: null, start: 0 };
  const statement = (frame, end) => {
    const out = [];
    for (let i = frame.stmt; i < end; i += 1) if (level[i] === frame.level) out.push(tokens[i]);
    return out;
  };
  const classify = (frame, s, opener) => {
    const prev = v(s[s.length - 1]);
    const base = {
      decl: frame.decl || decl, command: frame.command, event: frame.event, projection: frame.projection,
      entity: frame.entity, block: frame.block, scenarioCommand: frame.scenarioCommand,
    };
    const own = (kind, extra) => ({ ...base, kind, ...extra });
    const k = frame.kind;
    if (k === 'top') {
      const kw = decl.keyword;
      if (opener === '{') {
        if (prev === 'json' || kw === 'type' || kw === 'model') return own('json');
        const kinds = {
          enum: 'enum', record: 'fields', event: 'fields', entity: 'entity', projection: 'projection', command: 'command',
          scenarios: 'scenarios', scenario: 'scenario',
        };
        return own(kinds[kw] || 'json', {
          entity: kw === 'entity' ? decl.name : undefined,
          command: kw === 'command' ? decl.name : undefined,
          projection: kw === 'projection' ? decl.name : undefined,
          event: kw === 'event' ? decl.name : undefined,
          block: kw === 'scenario' || kw === 'scenarios' ? null : undefined,
        });
      }
      if (opener === '(') {
        if (s.length === 2 && (kw === 'command' || kw === 'projection')) return own('params');
        if (kw === 'projection' && prev === 'count') return own('count');
        if (kw === 'projection' && s.some((t) => t.v === 'derived') && /^[A-Z]/.test(prev || '')) return own('derivedArgs', { callee: prev });
        return own('json');
      }
      if (kw === 'entity' && s.length === 2) return own('idType');
      if (kw === 'projection' && prev === '=') return own('list', { valueOf: 'projection' });
      return own('json');
    }
    if (k === 'command') {
      if (opener === '{' && v(s[0]) === 'emit' && s.length === 2) return own('emitArgs', { event: v(s[1]) });
      if (opener === '{' && v(s[0]) === 'scenarios') return own('scenarios', { block: { kind: 'command', name: frame.command } });
      if (opener === '{' && v(s[0]) === 'scenario') return own('scenario', { block: { kind: 'command', name: frame.command } });
      if (opener === '[' && v(s[0]) === 'alias' && prev && /^[A-Za-z_]/.test(prev) && v(s[s.length - 2]) === '=') return own('readId', { entity: prev });
      if (opener === '(' && prev === 'count') return own('count');
      if (opener === '(' && prev === 'with') {
        const target = s[s.indexOf(s.find((t) => t.v === '=')) + 1];
        return own('withArgs', { entity: v(target) });
      }
      if (opener === '(' && v(s[0]) === 'alias') return own('projArgs', { callee: prev });
      if (opener === '[' && prev === 'in') return own('list', { left: conditionLeft(s.slice(0, -1)) });
      return own('json');
    }
    if (k === 'projection') {
      if (opener === '{' && v(s[0]) === 'scenarios') return own('scenarios', { block: { kind: 'projection', name: frame.projection } });
      if (opener === '{' && v(s[0]) === 'scenario') return own('scenario', { block: { kind: 'projection', name: frame.projection } });
      if (opener === '(' && prev === 'successor') return own('successor', { event: v(s[1]) });
      if (opener === '(' && prev === 'script') return own('params');
      return own('json');
    }
    if (k === 'scenarios') {
      if (opener === '{' && v(s[0]) === 'scenario' && prev !== 'json') return own('scenario', { block: frame.block });
      return own('json');
    }
    if (k === 'scenario') {
      const block = frame.block;
      if (opener === '{' && v(s[0]) === 'given' && s.length === 2) return own('payload', { event: v(s[1]), block });
      if (opener === '{' && v(s[0]) === 'when' && s.length === 2) return own('payload', { command: v(s[1]), block });
      if (opener === '{' && v(s[0]) === 'then' && s.length === 2) return own('payload', { event: v(s[1]), block });
      if (opener === '(' && v(s[0]) === 'then' && s.length === 2) return own('thenArgs', { callee: v(s[1]), block });
      if (opener === '(' && prev === 'count') return own('count');
      if (opener === '[' && prev === 'in') return own('list', { left: conditionLeft(s.slice(0, -1)) });
      return own('json');
    }
    if (['emitArgs', 'projArgs', 'readId', 'withArgs', 'count', 'derivedArgs', 'successor'].includes(k)) {
      if (opener === '(' && prev === 'count') return own('count');
      if (opener === '(' && prev === 'successor') return own('successor', { event: frame.event });
      if (opener === '(' && /^[A-Z]/.test(prev || '') && k === 'derivedArgs') return own('derivedArgs', { callee: prev });
      if (opener === '[' && prev === 'in') return own('list', { left: conditionLeft(s.slice(0, -1)) });
    }
    return own('json');
  };
  // The operand a condition's tokens start with — `course.status`,
  // `count(course.subscribedStudentIds)` — as the names it is made of.
  function conditionLeft(s) {
    let start = -1;
    s.forEach((t, i) => { if (SOURCE_CONDITION_STARTS.includes(t.v) || (t.v === 'derived')) start = i; });
    let rest = s.slice(start + 1);
    while (v(rest[0]) === 'not') rest = rest.slice(1);
    if (v(rest[0]) === 'count') return { count: true };
    if (rest[0] && rest[0].t === 'ident') return { head: rest[0].v, property: v(rest[1]) === '.' ? v(rest[2]) : undefined };
    return null;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    let frame = frames[frames.length - 1];
    if (token.t === 'punct' && ['}', ')', ']'].includes(token.v)) {
      if (frames.length > 1) frames.pop();
      frame = frames[frames.length - 1];
      level[i] = frame.level;
      continue;
    }
    level[i] = frame.level;
    if (frame.kind === 'top') {
      if (token.first && DECL_WORDS.includes(token.v)) {
        const tagged = token.v === 'tag';
        decl = { keyword: tagged ? v(tokens[i + 1]) : token.v, name: v(tokens[i + (tagged ? 2 : 1)]), start: i };
        frame.stmt = i;
      }
    } else if (token.first && token.v !== 'else') frame.stmt = i;
    if (token.t === 'punct' && ['{', '(', '['].includes(token.v)) {
      const next = classify(frame, statement(frame, i), token.v);
      if (next.kind === 'scenario') next.scenarioCommand = next.block && next.block.kind === 'command' ? next.block.name : null;
      frames.push({ ...next, level: frames.length, open: i, stmt: i + 1 });
    }
  }
  const frame = frames[frames.length - 1];
  const s = atLineStart ? [] : statement(frame, tokens.length);
  const prev = v(s[s.length - 1]);

  // And what follows the cursor: the rest of the innermost bracket, at
  // its own level, and the rest of the declaration — the handlers,
  // keys and reads written below, which a block being edited does not
  // parse to tell.
  const suffix = lexSource(text.slice(prefix.length)).tokens.slice(0, -1);
  if (/[A-Za-z0-9_]$/.test(prefix) && /^[A-Za-z0-9_]/.test(text.slice(prefix.length)) && suffix.length) suffix.shift();
  const restOfFrame = [];
  const restOfDeclaration = [];
  let depth = 0;
  for (const token of suffix) {
    if (token.t === 'punct' && ['{', '(', '['].includes(token.v)) depth += 1;
    else if (token.t === 'punct' && ['}', ')', ']'].includes(token.v)) depth -= 1;
    if (frames.length > 1 && depth <= -(frames.length - 1)) break;
    if (frames.length === 1 && depth === 0 && token.first && token.line > 1 && DECL_WORDS.includes(token.v)) break;
    restOfDeclaration.push(token);
    if (depth === 0 && restOfFrame.length === restOfDeclaration.length - 1) restOfFrame.push(token);
  }
  const framed = [...statement({ ...frame, stmt: frame.open + 1 }, tokens.length), ...restOfFrame];
  const declared = [...tokens.slice(frame.decl ? frame.decl.start : decl.start), ...restOfDeclaration];
  // An argument list's own part: the tokens since its last comma.
  const lastComma = s.map((t) => t.v).lastIndexOf(',');
  const segment = lastComma >= 0 ? s.slice(lastComma + 1) : s;

  // ---------- what the names mean ----------
  const parsed = parseModelSource(text);
  const known = sourceTextModel(parsed, model);
  const coll = (kind) => known[DEF_COLLECTIONS[kind]];
  const has = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);
  const def = (kind, name) => (typeof name === 'string' && has(coll(kind), name) ? coll(kind)[name] : null);
  const list = (value) => (Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') : []);
  const typeText = (p) => `${p.propertyType}${p.isList ? '[]' : ''}${p.isOptional ? '?' : ''}`;
  const items = [];
  const push = (label, kind, detail, extra = {}) => {
    if (items.some((i) => i.label === label)) return;
    items.push({ label, kind, detail: detail || '', insert: label, sort: 1, ...extra });
  };
  const done = (slot = true) => ({ items: items.map((i) => ({ ...i, sort: String(i.sort) })), slot });

  const membersOf = (typeName) => {
    const body = def('custom-type-definition', typeName);
    const members = body && body.schema && body.schema.enum;
    return Array.isArray(members) ? members.filter((m) => typeof m === 'string') : [];
  };
  const recordFields = (typeName) => {
    const body = def('custom-type-definition', typeName);
    return body && Array.isArray(body.properties) ? list(body.properties) : null;
  };
  const valueItems = (typeName, sort = 0) => {
    for (const m of membersOf(typeName)) push(m, 'member', typeName, { sort });
    if (typeName === 'boolean') { push('true', 'keyword', 'boolean', { sort }); push('false', 'keyword', 'boolean', { sort }); }
  };
  const typeItems = ({ tagsFirst } = {}) => {
    for (const t of SIMPLE_TYPES) push(t, 'keyword', 'type', { sort: 2 });
    for (const [name, body] of Object.entries(coll('custom-type-definition'))) {
      const what = body && body.schema && Array.isArray(body.schema.enum) ? 'enum'
        : body && Array.isArray(body.properties) ? 'record' : body && body.isTag ? 'tag type' : 'type';
      push(name, 'type', what, { sort: tagsFirst && !(body && body.isTag) ? 1 : 0 });
    }
  };
  const definitionItems = (kind, { exclude = [], sort = 1, call = false, detail } = {}) => {
    for (const [name, body] of Object.entries(coll(kind))) {
      if (exclude.includes(name)) continue;
      const extra = { sort: typeof sort === 'function' ? sort(name, body) : sort };
      if (call) Object.assign(extra, { insert: call(name, body), snippet: true });
      push(name, SOURCE_KIND_SYMBOL[kind], detail ? detail(name, body) : SOURCE_KEYWORD[kind], extra);
    }
  };
  const keywords = (words, sort = 0) => words.forEach(([label, insert, snippet]) => push(label, 'keyword', '', {
    sort, insert: insert || label, snippet: !!snippet,
  }));
  // The messages a command already refuses with — offered where a rule
  // states one, so two rules can share it, and where a scenario names one.
  // Read off the tokens where the cursor is inside the command, since
  // a block being typed rarely parses.
  const rejectionItems = (name) => {
    const offer = (message) => push(JSON.stringify(message), 'text', 'rejection', { sort: 0 });
    const decl_ = frame.decl || decl;
    if (decl_ && decl_.keyword === 'command' && decl_.name === name) {
      declared.forEach((t, i) => { if (t.t === 'string' && v(declared[i - 1]) === 'reject') offer(t.v); });
    }
    for (const rule of list((def('command-definition', name) || {}).conditions)) {
      if (rule && typeof rule.rejection === 'string') offer(rule.rejection);
    }
  };

  // A command's names — its payload and its reads — from the text
  // before the cursor, with whatever its parsed body adds (a read
  // written further down is in scope too).
  const commandScope = (name) => {
    const properties = [];
    const boundary = [];
    const body = has(parsed.collections['command-definition'], name) ? parsed.collections['command-definition'][name] : def('command-definition', name);
    const emits = [];
    if (frame.decl && frame.decl.keyword === 'command' && frame.decl.name === name) {
      const d = declared;
      let i = 2;
      if (v(d[i]) === '(') {
        for (i += 1; i < d.length && v(d[i]) !== ')'; i += 1) {
          if (d[i].t === 'ident' && (v(d[i + 1]) === ':' || (v(d[i + 1]) === '?' && v(d[i + 2]) === ':'))) {
            const typeAt = i + (v(d[i + 1]) === '?' ? 3 : 2);
            properties.push({ name: d[i].v, propertyType: v(d[typeAt]), isList: v(d[typeAt + 1]) === '[' });
          }
        }
      }
      for (; i < d.length; i += 1) {
        if (v(d[i]) === 'emit' && d[i + 1] && d[i + 1].t === 'ident') emits.push(d[i + 1].v);
        // The read being written is not in scope of itself.
        if (v(d[i]) !== 'alias' || (tokens.includes(d[i]) && d[i].line === line) || !d[i + 1] || d[i + 1].t !== 'ident') continue;
        const eq = v(d[i + 2]) === '?' ? i + 3 : i + 2;
        if (v(d[eq]) !== '=' || !d[eq + 1]) continue;
        const target = d[eq + 1].v;
        boundary.push(v(d[eq + 2]) === '(' ? { alias: d[i + 1].v, projection: target } : { alias: d[i + 1].v, entity: target });
      }
    }
    for (const p of list(body && body.properties)) if (!properties.some((q) => q.name === p.name)) properties.push(p);
    for (const b of list(body && body.boundary)) if (!boundary.some((q) => q.alias === b.alias)) boundary.push(b);
    for (const e of list(body && body.publishes)) if (!emits.includes(e.name)) emits.push(e.name);
    return { name, properties, boundary, emits };
  };
  const operandType = (scope, head, property) => {
    const isRead = scope.boundary.some((b) => b.alias === head) || (property !== undefined && !scope.properties.some((p) => p.name === head));
    const operand = isRead ? { alias: head, ...(property !== undefined ? { property } : {}) }
      : { parameterName: head, ...(property !== undefined ? { property } : {}) };
    try {
      return resolveOperandType(operand, { boundary: scope.boundary, commandProperties: scope.properties, model: known });
    } catch { return null; }
  };
  const operandItems = (scope, { sort = 0, prefer } = {}) => {
    for (const b of scope.boundary) {
      push(b.alias, 'alias', b.entity ? `alias ${b.entity}[…]` : `alias ${b.projection}(…)`, { sort: prefer && !prefer(b) ? sort + 1 : sort });
    }
    for (const p of scope.properties) push(p.name, 'commandProperty', typeText(p), { sort: prefer && !prefer(p) ? sort + 1 : sort });
  };
  const entityPropertyItems = (entityName) => {
    const entity = def('entity-definition', entityName);
    for (const p of list(entity && entity.properties)) {
      const projection = def('projection-definition', p.projection);
      const type = projection ? `${projection.valueType}${projection.isList ? '[]' : ''}` : '';
      push(p.name, 'entityProperty', `${type}${type ? ' · ' : ''}${p.projection}`, { sort: 0 });
    }
  };
  const dotted = (scope) => {
    const head = s[s.length - 2];
    if (!head || head.t !== 'ident') return done();
    const binding = scope.boundary.find((b) => b.alias === head.v);
    if (binding && binding.entity) entityPropertyItems(binding.entity);
    const parameter = scope.properties.find((p) => p.name === head.v);
    for (const f of (parameter && recordFields(parameter.propertyType)) || []) push(f.name, 'field', f.propertyType, { sort: 0 });
    return done();
  };
  // The rest of a condition, from wherever it began in `cond`.
  const conditionItems = (scope, cond) => {
    const last = v(cond[cond.length - 1]);
    if (!cond.length || last === 'not') {
      operandItems(scope);
      push('count', 'keyword', 'count(…)', { insert: 'count($1)', snippet: true, sort: 1 });
      if (!cond.length) push('not', 'keyword', '', { sort: 2 });
      return done();
    }
    const left = conditionLeft([{ v: 'require' }, ...cond]);
    const leftType = left && !left.count ? operandType(scope, left.head, left.property) : left && left.count ? { propertyType: 'integer' } : null;
    if (SOURCE_COMPARISONS.includes(last)) {
      if (leftType && !leftType.isList) valueItems(leftType.propertyType);
      operandItems(scope, { sort: 1 });
      return done();
    }
    if (last === 'is') {
      const kinds = predicatesForType(leftType);
      if (kinds.includes('isEmpty')) push('empty', 'keyword');
      if (kinds.includes('isNotEmpty')) push('not empty', 'keyword');
      if (kinds.includes('isTrue')) push('true', 'keyword');
      if (kinds.includes('isFalse')) push('false', 'keyword');
      return done();
    }
    if (last === 'in') {
      // A literal list, or a list held in data (`x in xs`, stored as
      // `xs contains x`).
      push('[…]', 'keyword', 'listed values', { insert: '[$1]', snippet: true, sort: 0 });
      operandItems(scope, { sort: 1 });
      return done();
    }
    if (last === '[') return done();
    // A whole operand: what may be said of it.
    const complete = cond[cond.length - 1].t === 'ident' || last === ')';
    if (!complete) return done();
    const kinds = left && left.count ? ['countEquals', 'countLessThan', 'countGreaterThan'] : predicatesForType(leftType);
    const words = new Set();
    for (const predicate of kinds) {
      const spelling = left && left.count
        ? { countEquals: ['==', '!='], countLessThan: ['<'], countGreaterThan: ['>'] }[predicate]
        : SOURCE_PREDICATE_SPELLINGS[predicate];
      for (const word of spelling || []) words.add(word);
    }
    for (const word of words) push(word.replace(' [$1]', ''), 'keyword', 'predicate', { insert: word, snippet: word.includes('$1') });
    return done(false);
  };
  // `key: value` lists: the keys not yet written, then a value.
  const argumentItems = (properties, { shorthand = () => false, value } = {}) => {
    if (segment.length === 2 && v(segment[1]) === ':') return value ? value(segment[0].v) : done();
    if (segment.length) return done(false);
    const written = new Set(framed.filter((t, i) => t.t === 'ident' && (i === 0 || v(framed[i - 1]) === ',')).map((t) => t.v));
    for (const p of properties) {
      if (written.has(p.name)) continue;
      const short = shorthand(p.name);
      push(p.name, 'property', typeText(p), { insert: short ? p.name : `${p.name}: `, sort: short ? 0 : 1 });
    }
    return done();
  };
  const projectionParameters = (name) => {
    const ownDecl = frame.decl || decl;
    if (ownDecl.keyword === 'projection' && ownDecl.name === name) {
      const header = projectionHeader(ownDecl.start);
      if (header) return header.parameters;
    }
    const body = def('projection-definition', name);
    return list(body && (body.script ? body.script.arguments : body.parameters));
  };
  const projectionCall = (name) => `${name}(${projectionParameters(name).map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')})`;

  // A projection's own header, read off the tokens: its body is
  // mid-edit while a handler is typed, and so rarely in the parse.
  const projectionHeader = (start) => {
    const parameters = [];
    let i = start + 2;
    if (v(tokens[i]) === '(') {
      for (i += 1; i < tokens.length && v(tokens[i]) !== ')'; i += 1) {
        if (tokens[i].t === 'ident' && v(tokens[i + 1]) === ':') parameters.push({ name: tokens[i].v, propertyType: v(tokens[i + 2]) });
      }
      i += 1;
    }
    if (v(tokens[i]) !== ':') return null;
    return { valueType: v(tokens[i + 1]), isList: v(tokens[i + 2]) === '[', parameters };
  };

  // ---------- by place ----------
  const k = frame.kind;
  // The command a rule is about: the block's, or a top-level
  // scenario's `when`.
  let commandName = frame.scenarioCommand || frame.command || null;
  if (!commandName && (k === 'scenario' || frame.block === null)) {
    const at = tokens.findIndex((t, i) => i > frame.open && t.v === 'when' && t.first);
    if (at >= 0 && tokens[at + 1]) commandName = tokens[at + 1].v;
  }

  if (prev === '.') {
    const head = v(s[s.length - 2]);
    if (head === 'event' && (k === 'projection' || k === 'successor')) {
      push('data', 'keyword', 'the event\'s payload', { insert: 'data.', retrigger: true, sort: 0 });
      return done();
    }
    if (head === 'data' && v(s[s.length - 3]) === '.' && v(s[s.length - 4]) === 'event') {
      let eventName = frame.event;
      if (k === 'projection') eventName = v(s[1]);
      const event = def('event-definition', eventName);
      for (const p of list(event && event.properties)) push(p.name, 'eventProperty', typeText(p), { sort: 0 });
      return done();
    }
    if (commandName) return dotted(commandScope(commandName));
    if (frame.decl && frame.decl.keyword === 'projection') {
      const parameter = projectionParameters(frame.decl.name).find((p) => p.name === v(s[s.length - 2]));
      for (const f of (parameter && recordFields(parameter.propertyType)) || []) push(f.name, 'field', f.propertyType, { sort: 0 });
      return done();
    }
    return done();
  }

  if (k === 'top') {
    const kw = decl.keyword;
    if (!s.length) {
      for (const [label, insert] of SOURCE_DECLARATION_SNIPPETS) push(label, 'keyword', 'declaration', { insert, snippet: true, sort: 0 });
      if (kw === 'projection') push('derived', 'keyword', '', { sort: 1 });
      return done(false);
    }
    if (prev === '@') {
      for (const [name, kinds] of Object.entries(SOURCE_ANNOTATIONS)) {
        push(name, 'keyword', kinds.map((x) => SOURCE_KEYWORD[x]).join(', '), { insert: `${name}("$1")`, snippet: true, sort: 0 });
      }
      return done();
    }
    if (v(s[0]) === 'tag' && s.length === 1) { keywords([['type'], ['enum'], ['record']]); return done(); }
    if (kw === 'type' && prev === '=') { SOURCE_BASE_TYPES.forEach((t) => push(t, 'keyword', 'base type', { sort: 0 })); return done(); }
    if (kw === 'projection') {
      const ownName = decl.name;
      const body = def('projection-definition', ownName);
      const colon = s.findIndex((t) => t.v === ':');
      const valueType = colon >= 0 ? v(s[colon + 1]) : body && body.valueType;
      const derivedAt = s.findIndex((t) => t.v === 'derived');
      if (derivedAt >= 0) {
        const cond = s.slice(derivedAt + 1);
        const last = v(cond[cond.length - 1]);
        if (!cond.length || last === 'not' || SOURCE_COMPARISONS.includes(last)) {
          definitionItems('projection-definition', { exclude: [ownName], sort: 0, call: projectionCall, detail: (n, b) => `${b.valueType}` });
          for (const p of projectionParameters(ownName)) push(p.name, 'projectionParameter', p.propertyType, { sort: 0 });
          return done();
        }
        return done(false);
      }
      if (prev === ':') { typeItems(); return done(); }
      if (prev === '=') {
        valueItems(valueType);
        keywords([['null'], ['[]']], 1);
        return done();
      }
      return done(false);
    }
    return done(false);
  }
  if (k === 'params' || k === 'fields') {
    if (prev === ':') { typeItems(); return done(); }
    return done(false);
  }
  if (k === 'idType') { typeItems({ tagsFirst: true }); return done(); }
  if (k === 'entity') {
    if (!s.length) { keywords([['lifecycle', 'lifecycle ']]); return done(false); }
    if (prev === 'lifecycle') {
      const names = framed.filter((t, i) => t.t === 'ident' && v(framed[i + 1]) === '=').map((t) => t.v);
      const parsedEntity = def('entity-definition', frame.entity);
      for (const p of list(parsedEntity && parsedEntity.properties)) if (!names.includes(p.name)) names.push(p.name);
      names.forEach((n) => push(n, 'entityProperty', '', { sort: 0 }));
      return done();
    }
    if (prev === '=') {
      const idType = (def('entity-definition', frame.entity) || {}).identifierType || `${frame.entity}Id`;
      definitionItems('projection-definition', {
        sort: (n, b) => (projectionParameters(n).some((p) => p.propertyType === idType) ? 0 : 1),
        detail: (n, b) => `${b.valueType}${b.isList ? '[]' : ''}`,
      });
      return done();
    }
    return done(false);
  }
  if (k === 'projection' || k === 'successor') {
    const ownName = frame.projection || (frame.decl && frame.decl.name);
    const body = (frame.decl && projectionHeader(frame.decl.start)) || def('projection-definition', ownName) || {};
    const handlerOperands = () => {
      push('event.data', 'keyword', 'a value the event carried', { insert: 'event.data.', retrigger: true, sort: 0 });
      if (k !== 'successor' && body.valueType && hasSuccessor(known, body.valueType)) push('successor', 'keyword', 'successor(…)', { insert: 'successor($1)', snippet: true, sort: 1 });
      valueItems(body.valueType, 0);
      return done();
    };
    if (k === 'successor') return handlerOperands();
    if (!s.length) {
      keywords([['on', 'on '], ['scenarios', SOURCE_GROUP_SNIPPET, true]]);
      keywords([['script', 'script($1)', true], ['tagFilter'], ['initialState'], ['exposes']], 2);
      return done(false);
    }
    if (v(s[0]) === 'on') {
      if (s.length === 1) {
        const handled = framed.filter((t, i) => v(framed[i - 1]) === 'on').map((t) => t.v);
        definitionItems('event-definition', { exclude: handled, sort: 0 });
        return done();
      }
      if (s.length === 3 && prev === '=>') {
        for (const op of operationsFor(known, body)) push(op, 'keyword', 'operation', { sort: 0, insert: `${op} ` });
        return done();
      }
      if (s.length === 4 && OPERATIONS.includes(prev)) return handlerOperands();
    }
    return done(false);
  }
  // Where a condition being written began: after its last `require`,
  // `when`, `and` or `by`.
  const conditionTail = (tokensOf) => {
    let at = -1;
    tokensOf.forEach((t, i) => { if (SOURCE_CONDITION_STARTS.includes(t.v)) at = i; });
    return tokensOf.slice(at + 1);
  };
  if (['command', 'emitArgs', 'readId', 'projArgs', 'withArgs'].includes(k) && !commandName) return done(false);
  if (k === 'command') {
    const scope = commandScope(commandName);
    if (!s.length) {
      keywords([['alias', 'alias ${1:name} = ', true], ['require', 'require '], ['emit', 'emit '],
        ['scenarios', SOURCE_GROUP_SNIPPET, true]]);
      return done(false);
    }
    const first = v(s[0]);
    if (first === 'alias') {
      if (prev === '=' && s.length <= 4) {
        definitionItems('entity-definition', { sort: 0, call: (n) => `${n}[$1]` });
        definitionItems('projection-definition', { sort: 1, call: projectionCall, detail: (n, b) => `${b.valueType}${b.isList ? '[]' : ''}` });
        return done();
      }
      if (prev === 'excluding') { operandItems(scope); return done(); }
      if (prev === ']') { keywords([['excluding', 'excluding '], ['with', 'with ($1)', true]]); return done(false); }
      return done(false);
    }
    if (first === 'emit') {
      if (s.length === 1) {
        definitionItems('event-definition', { sort: 0, detail: (n, b) => list(b.properties).map((p) => p.name).join(', ') });
        return done();
      }
      if (s.some((t) => t.v === 'when')) return conditionItems(scope, conditionTail(s));
      if (prev === '}' || s.length === 2) { keywords([['when', 'when ']]); return done(false); }
      return done(false);
    }
    if (first === 'require') {
      const at = s.findIndex((t) => t.v === 'else');
      if (at < 0) return conditionItems(scope, conditionTail(s));
      if (s.length === at + 1) { keywords([['reject', 'reject "${1}"', true]]); return done(); }
      if (v(s[at + 1]) === 'reject' && s.length === at + 2) { rejectionItems(commandName); return done(); }
    }
    return done(false);
  }
  if (k === 'list') {
    if (frame.valueOf === 'projection') {
      const header = projectionHeader(frame.decl.start);
      if (header) valueItems(header.valueType);
      return done();
    }
    const scope = commandName ? commandScope(commandName) : null;
    if (scope && frame.left) {
      const leftType = operandType(scope, frame.left.head, frame.left.property);
      if (leftType) valueItems(leftType.propertyType);
    }
    return done();
  }
  if (k === 'emitArgs') {
    const scope = commandScope(commandName);
    const event = def('event-definition', frame.event);
    const properties = list(event && event.properties);
    const names = new Set([...scope.properties.map((p) => p.name), ...scope.boundary.map((b) => b.alias)]);
    return argumentItems(properties, {
      shorthand: (n) => names.has(n),
      value: (key) => {
        const p = properties.find((x) => x.name === key);
        if (p) valueItems(p.propertyType);
        operandItems(scope, { sort: 1, prefer: (x) => (x.propertyType ? x.propertyType === (p && p.propertyType) : true) });
        return done();
      },
    });
  }
  if (k === 'readId') {
    const scope = commandScope(commandName);
    const idType = (def('entity-definition', frame.entity) || {}).identifierType || `${frame.entity}Id`;
    operandItems(scope, { prefer: (x) => (x.propertyType ? x.propertyType === idType : true) });
    return done();
  }
  if (k === 'projArgs') {
    const scope = commandScope(commandName);
    const names = new Set([...scope.properties.map((p) => p.name), ...scope.boundary.map((b) => b.alias)]);
    return argumentItems(projectionParameters(frame.callee), {
      shorthand: (n) => names.has(n),
      value: () => { operandItems(scope); return done(); },
    });
  }
  if (k === 'withArgs') {
    const scope = commandScope(commandName);
    if (segment.length === 2 && v(segment[1]) === ':') { operandItems(scope); return done(); }
    return done(false);
  }
  if (k === 'count') {
    if (commandName) { operandItems(commandScope(commandName)); return done(); }
    if (frame.decl && frame.decl.keyword === 'projection') {
      for (const p of projectionParameters(frame.decl.name)) push(p.name, 'projectionParameter', p.propertyType, { sort: 0 });
      definitionItems('projection-definition', { exclude: [frame.decl.name], call: projectionCall });
    }
    return done();
  }
  if (k === 'derivedArgs') {
    const ownName = frame.decl && frame.decl.name;
    const own = new Set(projectionParameters(ownName).map((p) => p.name));
    return argumentItems(projectionParameters(frame.callee), {
      shorthand: (n) => own.has(n),
      value: () => {
        for (const p of projectionParameters(ownName)) push(p.name, 'projectionParameter', p.propertyType, { sort: 0 });
        return done();
      },
    });
  }
  if (k === 'scenarios') {
    if (!s.length) keywords([['scenario', SOURCE_SCENARIO_SNIPPET, true]]);
    return done(false);
  }
  if (k === 'scenario') {
    const block = frame.block;
    if (!s.length) {
      keywords([['given', 'given '], ['when', 'when '], ['then', 'then ']]);
      return done(false);
    }
    const first = v(s[0]);
    if (first === 'given' && s.length === 1) { definitionItems('event-definition', { sort: 0, call: (n) => `${n} { $1 }` }); return done(); }
    if (first === 'when' && s.length === 1) {
      if (block && block.kind === 'command') push(block.name, 'command', 'this command', { insert: `${block.name} { $1 }`, snippet: true, sort: 0 });
      definitionItems('command-definition', { sort: 1, call: (n) => `${n} { $1 }` });
      return done();
    }
    if (first === 'then' && s.length === 1) {
      if (block && block.kind === 'projection') {
        push(block.name, 'projection', 'its value', { insert: `${projectionCall(block.name)} == $0`, snippet: true, sort: 0 });
        return done();
      }
      const emits = commandName ? commandScope(commandName).emits : [];
      definitionItems('event-definition', { sort: (n) => (emits.includes(n) ? 0 : 2), call: (n) => `${n} { $1 }` });
      keywords([['nothing'], ['rejected', 'rejected "${1}"', true]], 1);
      return done();
    }
    if (first === 'then' && v(s[1]) === 'rejected') {
      if (s.length === 2 && commandName) { rejectionItems(commandName); return done(); }
    }
    return done(false);
  }
  if (k === 'payload' || k === 'thenArgs') {
    let properties;
    if (k === 'thenArgs') properties = projectionParameters(frame.callee);
    else if (frame.event) properties = list((def('event-definition', frame.event) || {}).properties);
    else if (frame.command) properties = list((def('command-definition', frame.command) || {}).properties);
    else properties = [];
    return argumentItems(properties, {
      value: (key) => {
        const p = properties.find((x) => x.name === key);
        if (p) valueItems(p.propertyType);
        if (p && p.isOptional) push('null', 'keyword', '', { sort: 1 });
        return done();
      },
    });
  }
  return done(false);
}

// ============================================================
// Folding — off the tokens alone, since a text being edited rarely
// parses and what folds should not come and go with it.
// ============================================================

// Every bracket pair that spans lines, as `{ start, end, scenarios }`
// in 1-based lines. A block folds to the line before its closing
// bracket, which stays in view the way an editor shows one; a
// `scenarios` group folds whole, closing brace included, so a block's
// examples put away cost one line rather than two.
function sourceFoldingRanges(text) {
  const { tokens } = lexSource(String(text));
  const ranges = [];
  const open = [];
  tokens.forEach((token, i) => {
    if (token.t !== 'punct') return;
    if (['{', '[', '('].includes(token.v)) {
      const previous = tokens[i - 1];
      const group = token.v === '{' && !!previous && previous.t === 'ident' && previous.v === 'scenarios'
        && previous.first && previous.line === token.line;
      open.push({ start: token.line, group });
    } else if (['}', ']', ')'].includes(token.v) && open.length) {
      const pair = open.pop();
      const end = pair.group ? token.endLine : token.line - 1;
      if (end > pair.start) ranges.push({ start: pair.start, end, scenarios: pair.group });
    }
  });
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

// ============================================================
// The grammar as Monaco reads it (a Monarch definition). Data, so the
// keyword list sits next to the parser that gives the words meaning.
// ============================================================

const SOURCE_KEYWORDS = [
  'model', 'type', 'tag', 'tags', 'enum', 'record', 'event', 'entity', 'lifecycle', 'projection', 'derived',
  'script', 'tagFilter', 'initialState', 'exposes', 'on', 'set', 'increment', 'decrement', 'append',
  'remove', 'command', 'alias', 'excluding', 'with', 'require', 'emit', 'when', 'and', 'not', 'is',
  'empty', 'in', 'contains', 'containsAny', 'startsWith', 'endsWith', 'count', 'successor',
  'currentValue', 'json', 'true', 'false', 'null', 'scenarios', 'scenario', 'given', 'then', 'nothing', 'rejected',
  'else', 'reject',
];

// The words a block's statements start with, coloured apart so the
// shape of a command — what it reads, requires, emits — shows at a
// glance.
const SOURCE_STATEMENTS = ['alias', 'require', 'emit', 'when', 'on', 'derived', 'scenarios', 'scenario', 'given', 'then'];

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

// The same colours for a text that is only shown, not edited — the
// help's snippets, where loading Monaco to colour forty lines would be
// the editor's weight for none of its use. It classes the lexer's own
// tokens by the lists above, so it cannot read a word differently from
// the parser; the comments the lexer skips are the gaps between them.
// Returns `[class, text]` runs that concatenate back to `text`; class
// is null for what Monaco leaves uncoloured.
function sourceHighlight(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const offset = (line, col) => starts[line - 1] + col - 1;
  const tokens = lexSource(text).tokens.filter((token) => token.t !== 'eof');
  const runs = [];
  const gap = (from, to) => {
    const between = text.slice(from, to);
    let at = 0;
    for (const match of between.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)) {
      if (match.index > at) runs.push([null, between.slice(at, match.index)]);
      runs.push(['comment', match[0]]);
      at = match.index + match[0].length;
    }
    if (at < between.length) runs.push([null, between.slice(at)]);
  };
  let at = 0;
  tokens.forEach((token, i) => {
    const from = offset(token.line, token.col);
    const to = offset(token.endLine, token.endCol);
    gap(at, from);
    const following = tokens[i + 1];
    let cls = null;
    if (token.t === 'string') cls = 'string';
    else if (token.t === 'number') cls = 'number';
    else if (token.t === 'code') cls = 'code';
    else if (token.t === 'punct' && token.v === '@' && following && following.t === 'ident') cls = 'annotation';
    else if (token.t === 'ident') {
      const previous = tokens[i - 1];
      if (previous && previous.t === 'punct' && previous.v === '@') cls = 'annotation';
      else if (token.v === 'event' && following && following.v === '.') cls = 'keyword';
      else if (/^[A-Z]/.test(token.v)) cls = 'type';
      else if (SOURCE_STATEMENTS.includes(token.v)) cls = 'flow';
      else if (SOURCE_KEYWORDS.includes(token.v)) cls = 'keyword';
      else if (SOURCE_BASE_TYPES.includes(token.v)) cls = 'type';
    }
    runs.push([cls, text.slice(from, to)]);
    at = to;
  });
  gap(at, text.length);
  return runs;
}
