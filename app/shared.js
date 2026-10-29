// ============================================================
// Everything the interface needs that is not the model: DOM helpers,
// the experimental-features flag, and the *slice* view – everything one
// command touches, gathered here so the page never has to walk the
// definition graph itself.
//
// The slice is the idea the page is built around: a command, what it
// reads, in how many trips to the log, what it decides, what it emits,
// and what those events change. The model layer stores none of that as
// a unit; it is derived here, from the definitions. The overview pages
// read the same material across every command at once – the coupling
// matrix and the event model – and those derivations live here too.
// ============================================================

// ---------- DOM ----------

// Text is always text: a string child becomes a text node and an
// attribute value an attribute. The two ways a string could become code
// are refused – markup goes through `svg`, and a handler must be a
// function (a string `onclick` would be an attribute the browser runs).
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'html') throw new Error('h(): markup goes through svg(), not an attribute');
    if (k.startsWith('on')) {
      if (typeof v !== 'function') throw new Error(`h(): "${k}" must be a function`);
      el[k.toLowerCase()] = v;
    } else if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}

// The one sink for markup: an icon, a band's wires – SVG written in
// this code, its only interpolations numbers and fixed ids. Never pass
// it a string that came from a model. A fragment, appended whole by `h`.
function svg(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content || null;
}

let toastTimer = null;
// A refusal has to be read, not glimpsed, so it stays up well past the
// acknowledgements.
function toast(message, isError) {
  document.querySelectorAll('#toast').forEach((n) => n.remove());
  const el = h('div', { id: 'toast', class: isError ? 'err' : '' }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 8000 : 5000);
}

// Runs a model command, reports a domain error rather than throwing it
// at the console, and repaints on success.
function run(fn) {
  try {
    const out = fn();
    if (typeof render === 'function') render();
    return out;
  } catch (err) {
    if (err instanceof DomainError) toast(err.message, true);
    else { console.error(err); toast('Unexpected error: ' + err.message, true); }
  }
}

// ---------- the scripted-handler editor ----------
//
// The one part of a model the tooling neither runs nor checks is the
// scripted handler – but what its code can *see* is still knowable
// from the definitions. This turns that knowledge into TypeScript: a
// synthesized preamble typing `state`, `event` and `args` for one
// handler, fed to Monaco (the app's one vendored dependency, pinned
// by generate-vendor-monaco.js) so typing gets completion, hover and
// squiggles that actually understand the model.
//
// The synthesis is the tested part, and it is pure. The choices it
// bakes in:
//   - every named scalar custom type is *branded* (`string & { __type:
//     'CourseId' }`), so comparing a CourseId to a StudentId – or to a
//     bare string literal – draws the no-overlap squiggle;
//   - enums become literal unions, so `===` completes the legal values;
//   - `state` is inferred from the initial state but stays *loose*
//     (`& { [key: string]: any }` at every level), because a script
//     may legitimately grow keys the initial state never had;
//   - a dangling type or event reference types as `any` – a defective
//     model must still load and edit, the same rule as everywhere.
//
// Each handler's preamble is its own file-scope (`export {};` makes
// the model a module), which is what lets several editors with
// different `event` types coexist in one TypeScript project. The
// preamble ends by opening a `__check(` call whose parameter is what
// a handler must return – the projection's value type (through
// `exposes` when the state is bookkeeping around one exposed field),
// allowing the initial state's type too when it differs, a null start
// being how "nullable" is spelled. Brands are widened to their bases
// there: code *produces* values, and no expression can produce a
// brand. The call also makes a bare object literal read as an
// expression, exactly as evaluate.js compiles it. All of it is
// prepended to the author's code in the editor model and hidden from
// view; only the code between the wrapper lines is ever written back.
//
// Monaco itself loads lazily, the first time a scripted handler row
// is actually on screen: models without scripts never pay for it, and
// if the assets are missing the row falls back to the plain textarea
// it always was. Editor instances are cached across repaints (the
// page rebuilds its whole DOM per render) and disposed once their row
// is gone.

// --- the synthesis: model + script + handler → TypeScript preamble ---

function scriptTsKey(name) {
  return /^[\p{ID_Start}_$][\p{ID_Continue}$\u200C\u200D]*$/u.test(name) ? name : JSON.stringify(name);
}

// A value's own JSON, safe inside the /** … */ it is hinted in.
function scriptTsHint(value) {
  const text = String(JSON.stringify(value)).replace(/\*\//g, '*\\/');
  return text.length > 32 ? text.slice(0, 31) + '…' : text;
}

// The TypeScript shape of a JSON value – how `state` is typed from
// the initial state. Objects stay walkable but loose; arrays type
// their elements when the elements are uniform primitives and give up
// honestly (`any[]`) when they are not.
function scriptTsOfValue(value, indent) {
  if (value === null || value === undefined) return 'any';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (!value.length) return 'any[]';
    const parts = [...new Set(value.map((element) =>
      (element !== null && typeof element === 'object') ? 'any' : scriptTsOfValue(element)))];
    if (parts.includes('any')) return 'any[]';
    return (parts.length === 1 ? parts[0] : '(' + parts.join(' | ') + ')') + '[]';
  }
  const pad = ' '.repeat((indent || 0) + 2);
  const fields = Object.entries(value).map(([key, inner]) =>
    pad + '/** starts at ' + scriptTsHint(inner) + ' */\n'
    + pad + scriptTsKey(key) + ': ' + scriptTsOfValue(inner, (indent || 0) + 2) + ';');
  if (!fields.length) return '{ [key: string]: any }';
  return '{\n' + fields.join('\n') + '\n' + ' '.repeat(indent || 0) + '} & { [key: string]: any }';
}

// What a handler must return, as an inline TypeScript type. This is
// return position, so brands widen to their bases – an expression can
// compare branded values it was given, but never mint one – while
// enums stay literal unions and composites stay structural.
function scriptReturnType(model, body) {
  const inline = (typeName, depth) => {
    if (typeName === 'boolean') return 'boolean';
    if (typeName === 'integer') return 'number';
    if (typeName === 'string') return 'string';
    const definition = (model['custom-type-definitions'] || {})[typeName];
    if (!definition || depth > 2) return 'any';
    if (Array.isArray(definition.properties)) {
      return '{ ' + definition.properties
        .map((field) => scriptTsKey(field.name) + ': ' + inline(field.propertyType, depth + 1))
        .join('; ') + ' }';
    }
    const members = definition.schema && Array.isArray(definition.schema.enum)
      && definition.schema.enum.length ? definition.schema.enum : null;
    if (members) return members.map((member) => JSON.stringify(member)).join(' | ');
    return ({ string: 'string', integer: 'number', number: 'number', boolean: 'boolean' })[
      definition.schema && definition.schema.type] || 'string';
  };

  let value = inline(body.valueType, 0);
  if (value === 'any') return 'any';
  if (body.isList) value = (/[|&]/.test(value) ? '(' + value + ')' : value) + '[]';
  // With `exposes`, the state is bookkeeping around one exposed field:
  // the value type constrains that field, the rest is the script's own.
  const script = body.script || {};
  if (script.exposes) {
    value = '{ ' + scriptTsKey(script.exposes) + ': ' + value + ' } & { [key: string]: any }';
  }
  // Where the projection starts is also a legal thing to hand back – a
  // null start is how "nullable" is spelled.
  const initial = script.initialState;
  const initialTs = initial === null || initial === undefined ? 'null' : scriptTsOfValue(initial);
  return initialTs === value || initialTs === 'any' ? value : value + ' | ' + initialTs;
}

// What one scripted handler can see, as the TypeScript preamble its
// editor model is prefixed with. Ends opening the `__check(` call
// that both types the returned state and makes the code parse as the
// expression evaluate.js runs; the widget hides everything up to and
// including that line.
function scriptHandlerPreamble(model, body, handler) {
  const script = body.script || {};
  const lines = ['export {};'];
  const aliased = new Map(); // typeName → true once its alias line is out

  const resolveType = (typeName) => {
    if (typeName === 'boolean') return 'boolean';
    if (typeName === 'integer') return 'number';
    if (typeName === 'string') return 'string';
    const body = (model['custom-type-definitions'] || {})[typeName];
    if (body === undefined || !/^[\p{ID_Start}_$][\p{ID_Continue}$\u200C\u200D]*$/u.test(typeName)) return 'any';
    if (aliased.has(typeName)) return aliased.get(typeName) ? typeName : 'any';
    aliased.set(typeName, false);
    let rhs;
    if (Array.isArray(body.properties)) {
      rhs = '{ ' + body.properties
        .map((field) => scriptTsKey(field.name) + ': ' + resolveType(field.propertyType))
        .join('; ') + ' }';
    } else {
      const members = body.schema && Array.isArray(body.schema.enum) && body.schema.enum.length
        ? body.schema.enum : null;
      if (members) {
        rhs = members.map((member) => JSON.stringify(member)).join(' | ');
      } else {
        const base = ({ string: 'string', integer: 'number', number: 'number', boolean: 'boolean' })[
          body.schema && body.schema.type] || 'string';
        rhs = base + ' & { readonly __type: ' + JSON.stringify(typeName) + ' }';
      }
    }
    aliased.set(typeName, true);
    lines.push('type ' + typeName + ' = ' + rhs + ';');
    return typeName;
  };

  const propertyType = (property) => {
    let type = resolveType(property.propertyType);
    if (property.isList) type += '[]';
    if (property.isOptional) type += ' | null';
    return type;
  };

  const event = (model['event-definitions'] || {})[handler.event];
  const eventLines = [];
  if (event) {
    // Read-only, as at run time (`evFrozenEvent`, evaluate.js): the
    // editor flags a write before the run refuses it.
    eventLines.push('declare const event: {');
    eventLines.push('  readonly type: ' + JSON.stringify(handler.event) + ';');
    eventLines.push('  readonly data: {');
    for (const property of event.properties || []) {
      if (property.isOptional) {
        eventLines.push('    /** optional – null when the event carries no value */');
      } else if (property.propertyType === 'integer') {
        eventLines.push('    /** integer */');
      }
      eventLines.push('    readonly ' + scriptTsKey(property.name) + ': ' + propertyType(property) + ';');
    }
    eventLines.push('  };');
    eventLines.push('};');
  } else {
    eventLines.push('declare const event: { readonly type: string; readonly data: { readonly [key: string]: any } };');
  }

  const argFields = projectionSlots(body).filter((argument) => argument.name);
  const argsType = argFields.length
    ? '{ ' + argFields
        .map((argument) => scriptTsKey(argument.name) + ': ' + resolveType(argument.propertyType))
        .join('; ') + ' }'
    : '{}';

  // Alias lines were pushed by the resolve calls above; the declares
  // come after them, whatever order the resolving happened in.
  lines.push(...eventLines);
  lines.push('declare const state: ' + scriptTsOfValue(script.initialState, 0) + ';');
  lines.push('declare const args: ' + argsType + ';');
  lines.push('declare function __check(nextState: ' + scriptReturnType(model, body) + '): void;');
  lines.push('__check(');
  return lines.join('\n');
}

// --- the widget: a cached Monaco editor per handler row ---

// Rows are keyed by the draft object being edited (stable across
// repaints – the page state holds it) plus the handler's index.
const scriptEditorDraftIds = new WeakMap();
let scriptEditorDraftSeq = 0;
function scriptEditorKey(draft, index) {
  if (!scriptEditorDraftIds.has(draft)) scriptEditorDraftIds.set(draft, ++scriptEditorDraftSeq);
  return scriptEditorDraftIds.get(draft) + ':' + index;
}

const SCRIPT_EDITOR_LINE = 17;
const SCRIPT_EDITOR_MAX_LINES = 16;
let scriptEditorPhase = 'unloaded'; // → 'loading' → 'ready' | 'failed'
const scriptEditors = new Map();

function ensureScriptEditorLoaded() {
  if (scriptEditorPhase !== 'unloaded') return;
  // No real head to load into (the test stub) – the textarea is it.
  if (typeof document === 'undefined' || !document.head || !document.head.appendChild) {
    scriptEditorPhase = 'failed';
    return;
  }
  scriptEditorPhase = 'loading';
  // The stock worker bootstrap resolves its `vs` root from its own
  // URL, so everything stays under vendor/monaco.
  window.MonacoEnvironment = {
    getWorkerUrl: () => 'vendor/monaco/vs/base/worker/workerMain.js',
  };
  const fail = () => {
    scriptEditorPhase = 'failed';
    if (typeof render === 'function') render();
  };
  document.head.appendChild(h('link', { rel: 'stylesheet', href: 'vendor/monaco/vs/editor/editor.main.css' }));
  const loader = h('script', { src: 'vendor/monaco/vs/loader.js' });
  loader.onload = () => {
    window.require.config({ paths: { vs: 'vendor/monaco/vs' } });
    window.require(['vs/editor/editor.main'], () => {
      const ts = monaco.languages.typescript;
      ts.typescriptDefaults.setCompilerOptions({
        target: ts.ScriptTarget.ES2020,
        lib: ['es2020'],
        allowNonTsExtensions: true,
        noEmit: true,
        // Null is a value here (the model's one spelling of "no
        // value"), so it must be visible to the checker: without this
        // it is assignable to everything and every `| null` in the
        // synthesized types would be decoration.
        strictNullChecks: true,
      });
      ts.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
        // No unused-variable hints: the preamble declares all three
        // roots whether or not this handler reads them.
        noSuggestionDiagnostics: true,
      });
      scriptEditorPhase = 'ready';
      if (typeof render === 'function') render();
    }, fail);
  };
  loader.onerror = fail;
  document.head.appendChild(loader);
}

// The element for one handler's code. Before Monaco is up (or if it
// never comes up) this is the plain textarea it always was; after,
// the cached editor, its content resynced when the draft changed
// underneath it (undo, a switched event) but left alone mid-typing.
function scriptCodeEditor(key, spec) {
  if (scriptEditorPhase !== 'ready') {
    ensureScriptEditorLoaded();
    return h('textarea', {
      class: 'mono', rows: Math.min(16, String(spec.code || '').split('\n').length + 1),
      value: spec.code || '',
      oninput: (e) => spec.onCode(e.target.value),
    });
  }
  let entry = scriptEditors.get(key);
  if (!entry) {
    entry = createScriptEditorEntry(key);
    scriptEditors.set(key, entry);
  }
  entry.spec = spec;
  if (entry.preamble !== spec.preamble
      || (!entry.editor.hasTextFocus() && entry.currentCode() !== (spec.code || ''))) {
    entry.load(spec.preamble, spec.code || '');
  }
  monaco.editor.setTheme(isDark() ? 'vs-dark' : 'vs');
  return entry.root;
}

// Editors whose row a repaint dropped. Called after every paint; an
// entry whose root did not make it back into the document is done.
function sweepScriptEditors() {
  if (scriptEditorPhase !== 'ready') return;
  for (const [key, entry] of scriptEditors) {
    if (entry.root.isConnected) continue;
    entry.editor.dispose();
    entry.model.dispose();
    scriptEditors.delete(key);
  }
}

function scriptEditorFont() {
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--mono');
  return (declared && declared.trim()) || 'ui-monospace, Menlo, Consolas, monospace';
}

function createScriptEditorEntry(key) {
  const root = h('div', { class: 'script-editor' });
  const uri = monaco.Uri.parse('inmemory://scripted/' + encodeURIComponent(key) + '.ts');
  const model = monaco.editor.getModel(uri) || monaco.editor.createModel('', 'typescript', uri);
  const editor = monaco.editor.create(root, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 6,
    scrollBeyondLastLine: false,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    renderLineHighlight: 'none',
    wordWrap: 'on',
    wordBasedSuggestions: 'off',
    // The suggest widget must escape this small, clipped container.
    fixedOverflowWidgets: true,
    contextmenu: false,
    links: false,
    fontSize: 11,
    lineHeight: SCRIPT_EDITOR_LINE,
    fontFamily: scriptEditorFont(),
    tabSize: 2,
    padding: { top: 6, bottom: 6 },
    scrollbar: { alwaysConsumeMouseWheel: false },
  });
  const entry = { root, editor, model, spec: null, preamble: '', headerLines: 0, loading: false };

  // `setHiddenAreas` is internal API, stable here because the vendored
  // version is pinned. Without it the wrapper lines stay visible –
  // degraded, not broken.
  const hideWrapper = (force) => {
    if (typeof editor.setHiddenAreas !== 'function') return;
    // setValue drops the view's hidden areas while the widget keeps
    // its cached ranges, so re-applying identical ranges is swallowed
    // as a no-op – clear first when the model was reloaded wholesale.
    if (force) editor.setHiddenAreas([]);
    const last = model.getLineCount();
    editor.setHiddenAreas([
      new monaco.Range(1, 1, entry.headerLines, 1),
      new monaco.Range(last, 1, last, 1),
    ]);
  };

  const resize = () => {
    const height = Math.min(editor.getContentHeight(), SCRIPT_EDITOR_MAX_LINES * SCRIPT_EDITOR_LINE + 12);
    root.style.height = Math.max(height, 2 * SCRIPT_EDITOR_LINE + 12) + 'px';
  };
  // Content height reflects the hidden areas only once the view has
  // taken them in, and how soon that is is not promised – measure a
  // frame after any wholesale load, and once more for good measure.
  const resizeSoon = () => {
    requestAnimationFrame(resize);
    setTimeout(resize, 80);
  };

  entry.currentCode = () => {
    const all = model.getLinesContent();
    return all.slice(entry.headerLines, all.length - 1).join('\n');
  };

  entry.load = (preamble, code) => {
    entry.loading = true;
    entry.preamble = preamble;
    entry.headerLines = preamble.split('\n').length;
    model.setValue(preamble + '\n' + code + '\n)');
    hideWrapper(true);
    // setValue parks the cursor at 1:1 – inside the hidden preamble,
    // where typing would land invisibly. Park it at the code's end.
    const lastCodeLine = model.getLineCount() - 1;
    editor.setPosition({ lineNumber: lastCodeLine, column: model.getLineMaxColumn(lastCodeLine) });
    resizeSoon();
    entry.loading = false;
  };

  // The wrapper is hidden, not protected – a select-all delete can
  // still take it out. Whatever survived is the author's code; put the
  // frame back around it. Asynchronously, and that is load-bearing:
  // inside the change event the editing command has not yet placed its
  // final cursor, so a synchronous setValue would be re-cursored into
  // the hidden preamble and the next keystroke would land there.
  // What of the author's code survived a wrapper-damaging edit. Walks
  // the preamble line by line rather than as one prefix: a deletion at
  // the code's edge merges a code line into the last preamble line,
  // and a whole-prefix comparison would then mistake the entire
  // preamble for code and paste it into view.
  const recoverCode = (text) => {
    const preambleLines = entry.preamble.split('\n');
    const lines = text.split('\n');
    let at = 0;
    while (at < preambleLines.length && at < lines.length && lines[at] === preambleLines[at]) at += 1;
    let rest = lines.slice(at);
    // A merged boundary line: the preamble part survives as a prefix.
    if (at < preambleLines.length && rest.length && rest[0].startsWith(preambleLines[at])) {
      rest = [rest[0].slice(preambleLines[at].length), ...rest.slice(1)];
    }
    let code = rest.join('\n');
    if (code.endsWith('\n)')) code = code.slice(0, -2);
    else if (code.endsWith(')')) code = code.slice(0, -1); // merged into the last code line
    return code;
  };

  let restoreQueued = false;
  const queueRestore = () => {
    if (restoreQueued) return;
    restoreQueued = true;
    setTimeout(() => {
      restoreQueued = false;
      const text = model.getValue();
      const head = entry.preamble + '\n';
      if (text.startsWith(head) && text.endsWith('\n)')) return; // undo beat us to it
      entry.load(entry.preamble, recoverCode(text));
      if (entry.spec) entry.spec.onCode(entry.currentCode());
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }, 0);
  };

  // Better than repairing: the two deletions that would eat into the
  // wrapper – Backspace at the code's first character, Delete at its
  // last – simply do nothing, the same as at a document edge.
  editor.onKeyDown((e) => {
    if (e.keyCode !== monaco.KeyCode.Backspace && e.keyCode !== monaco.KeyCode.Delete) return;
    const selection = editor.getSelection();
    if (!selection || !selection.isEmpty()) return;
    const at = selection.getStartPosition();
    const lastCodeLine = model.getLineCount() - 1;
    const atStart = at.lineNumber === entry.headerLines + 1 && at.column === 1;
    const atEnd = at.lineNumber === lastCodeLine && at.column === model.getLineMaxColumn(lastCodeLine);
    if ((e.keyCode === monaco.KeyCode.Backspace && atStart)
        || (e.keyCode === monaco.KeyCode.Delete && atEnd)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  model.onDidChangeContent(() => {
    if (entry.loading) return;
    const text = model.getValue();
    const head = entry.preamble + '\n';
    if (!text.startsWith(head) || !text.endsWith('\n)')) return queueRestore();
    hideWrapper(); // the last line's number moves as lines come and go
    if (entry.spec) entry.spec.onCode(entry.currentCode());
    // A real, bubbling event: the page's delegated autosave must see
    // an edit here exactly as it would see one typed in a field.
    root.dispatchEvent(new Event('input', { bubbles: true }));
  });
  editor.onDidContentSizeChange(resize);

  // Escape belongs to the editor (dismissing its own widgets), never
  // to the page's close-the-form handler while typing code.
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });

  return entry;
}

// ---------- experimental features ----------
//
// Everything that is DCB is always on screen: types, events, projections,
// the consistency boundary each command derives. What the examples on
// dcb.events never need – scripted projections, guarded emissions,
// optional reads, the overview pages
// (`EXPERIMENTAL_FEATURES`, model.js) – waits behind this flag.
//
// It gates *authoring*, never reading: a model that already uses an
// experimental feature still loads, renders and evaluates it, and the
// page says which ones it found (`experimentalFeatures`). A share link
// may switch it on for one session (`&experimental`) without touching
// the stored choice – following a link never changes a setting.
//
// How it is offered is the page's business, not this file's: it is one
// of the interface's own settings, and they are collected in one place
// rather than scattered along the top of the window.

const EXPERIMENTAL_KEY = 'dcb-playground:experimental';
let experimentalThisSession = false;
function experimental() {
  return experimentalThisSession || localStorage.getItem(EXPERIMENTAL_KEY) === 'on';
}
function setExperimental(on) {
  experimentalThisSession = false;
  if (on) localStorage.setItem(EXPERIMENTAL_KEY, 'on');
  else localStorage.removeItem(EXPERIMENTAL_KEY);
  if (typeof render === 'function') render();
}
function enableExperimentalForSession() { experimentalThisSession = true; }

// ---------- the documentation ----------
//
// The notation is explained by its guide and reference on dcb.events,
// not here: an `ⓘ` says the one line a section needs and links the
// reference's anchor for it, and the help modal links the reference.
//
// The anchors are a contract with the website: its build fails on a
// link `helpReferenceLinks` lists that it does not define, so renaming
// one is a change on both sides. Until the website has pages for what
// 8.0 added (a projection's and an event's `tag`, `untagged`, `alias`,
// reads in place), those link the nearest page it has – the list of
// what is owed is in docs/research/2026-10-05-explicit-tags-and-aliases.md.

const NOTATION_GUIDE_URL = 'https://dcb.events/notation/';
const NOTATION_REFERENCE_URL = 'https://dcb.events/notation/reference/';
// The example models live on dcb.events too, each page opening its
// model here through a share link.
const EXAMPLES_URL = 'https://dcb.events/examples/';
// Where to reach us: feedback through the site's About page, issues in
// the website's repository – the playground's own takes pull requests
// only. The title prefix tells playground issues apart in the shared
// tracker; the label sticks only for those allowed to triage. The page
// footer and the disclaimer spell the same two links in index.html.
const FEEDBACK_URL = 'https://dcb.events/about/';
const ISSUES_URL = 'https://github.com/dcb-events/dcb-events.github.io/issues/new'
  + '?labels=playground&title=%5BPlayground%5D%20';
const NOTATION_ANCHORS = [
  'model', 'comments', 'literals', 'annotations', 'json', 'tag-type', 'type', 'enum', 'record', 'event',
  'projection', 'on', 'event-data', 'successor', 'current-value', 'require',
  'derived', 'script', 'command', 'read', 'fan-out', 'optional-read', 'with', 'emit',
  'emit-when', 'consistency-boundary', 'scenario', 'projection-scenario',
];

function notationReference(anchor) {
  return NOTATION_ANCHORS.includes(anchor) ? NOTATION_REFERENCE_URL + '#' + anchor : NOTATION_GUIDE_URL;
}

// Every page of dcb.events this page links to, with its anchor: what
// the site's build checks against the pages it has just built.
function helpReferenceLinks() {
  return [NOTATION_GUIDE_URL, ...NOTATION_ANCHORS.map((anchor) => NOTATION_REFERENCE_URL + '#' + anchor)];
}

// ---------- light / dark ----------
//
// Defaults to whatever the system says, same as any other well-behaved
// page; the sun/moon button in the bar overrides that per browser. `isDark` is the one
// question the rest of the page asks – nothing downstream needs to know
// whether that answer came from the system or from a stored choice.
//
// A page hosting the playground can own the choice instead, so that one
// switch serves both (dcb.events shares its own light/dark setting this
// way): it defines `window.DCB_PLAYGROUND_HOST.theme` before these
// scripts run, with `get()` answering 'system' | 'light' | 'dark' (or
// null for "no opinion"), `set(value)`, and optionally `onChange(fn)`
// for a choice made elsewhere, e.g. in another tab. How the host stores
// it is the host's business – nothing here knows it.

const THEME_KEY = 'dcb-playground:theme';
// Guarded, like the listeners below: dcb.events loads this file outside
// a browser to read `helpReferenceLinks`, and nothing at load may need
// a window there.
function hostTheme() {
  const host = typeof window !== 'undefined' ? window.DCB_PLAYGROUND_HOST : null;
  return host && host.theme && typeof host.theme.get === 'function' ? host.theme : null;
}
function theme() {
  const host = hostTheme();
  const hosted = host ? host.get() : null;
  if (hosted === 'system' || hosted === 'light' || hosted === 'dark') return hosted;
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
function setTheme(next) {
  const host = hostTheme();
  if (host) host.set(next);
  else localStorage.setItem(THEME_KEY, next);
  if (typeof render === 'function') render();
}
// The bar's button flips whatever is on screen, so the first click
// away from "system" always changes something.
function toggleTheme() { setTheme(isDark() ? 'light' : 'dark'); }
if (hostTheme() && typeof hostTheme().onChange === 'function') {
  hostTheme().onChange(() => { if (typeof render === 'function') render(); });
}
function isDark() {
  const t = theme();
  if (t !== 'system') return t === 'dark';
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
// Only "system" cares about this firing – an explicit choice already
// repaints itself the moment it is made.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme() === 'system' && typeof render === 'function') render();
  });
}

// ---------- which model is open ----------

//
// Each tab keeps its own answer, in sessionStorage: opening model B in
// one tab used to switch every other tab to B as well. The browser-wide
// copy in localStorage is only the last one opened anywhere – what a
// fresh tab starts on, and where a tab lands when its own model was
// deleted elsewhere.
const MODEL_KEY = 'dcb-playground:model';

// `null` is a real answer here, not an edge case to work around: a
// browser that has never loaded anything has nothing stored, and the
// Models modal is what asks the question rather than the page silently
// picking an example on someone's behalf.
function activeModelId() {
  for (const stored of [sessionStorage.getItem(MODEL_KEY), localStorage.getItem(MODEL_KEY)]) {
    if (stored && projectState()[stored]) return stored;
  }
  return null;
}
function setActiveModelId(id) {
  sessionStorage.setItem(MODEL_KEY, id);
  localStorage.setItem(MODEL_KEY, id);
}
function clearActiveModelId() {
  sessionStorage.removeItem(MODEL_KEY);
  localStorage.removeItem(MODEL_KEY);
}
function activeModel() {
  const id = activeModelId();
  return id ? projectState()[id] : null;
}

// ---------- copies opened from a link ----------
//
// A link – an example's "Open in Playground" on dcb.events, a shared
// model – imports a copy, and nothing here ever writes back to where
// it came from. Testers took their first edit of an example for an
// edit of the example itself, so a copy's first change is where the
// page says otherwise and offers to name it (`namePromptField`,
// index.html). Kept per browser and outside the event log: it is a
// fact about how this browser came by the model, not part of it.
const LINKED_COPIES_KEY = 'dcb-playground:linked-copies';

function linkedCopies() {
  try {
    const ids = JSON.parse(localStorage.getItem(LINKED_COPIES_KEY));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function setLinkedCopies(ids) {
  if (ids.length) localStorage.setItem(LINKED_COPIES_KEY, JSON.stringify(ids));
  else localStorage.removeItem(LINKED_COPIES_KEY);
}

// Marked once its import has landed, so the import is not its own
// first change. Ids of models gone since are dropped on the way.
function markLinkedCopy(id) {
  const models = projectState();
  setLinkedCopies([...linkedCopies().filter((other) => other !== id && models[other]), id]);
}

// The linked copy these appended events first change, if any – and
// every copy they touch is unmarked, so each is asked about once. A
// rename or a delete unmarks without asking: the one has answered the
// question already, the other has made it moot.
function takeFirstChange(appended) {
  const marked = linkedCopies();
  if (!marked.length) return null;
  const left = new Set(marked);
  let changed = null;
  for (const event of appended) {
    const id = event.data && event.data['dcb-model-id'];
    if (!left.has(id)) continue;
    left.delete(id);
    if (!changed && !event.type.startsWith('dcb-model-')) changed = id;
  }
  if (left.size !== marked.length) setLinkedCopies([...left]);
  return changed;
}

// A model with nothing in it at all – no types, no events, no
// commands. Everything downstream has to cope with that, because it is
// where a real model actually starts.
//
// The name is collected by the page (there are no browser dialogs in
// here); this only does the creating.
//
// `openNewModel` is the unwrapped core – one definition of what
// opening a fresh model means – shared with the WebMCP `start_model`
// tool, which needs the refusal to reach the agent rather than only
// the toast `run` turns it into.
function openNewModel(name) {
  const id = createDcbModel(name);
  setActiveModelId(id);
  setPendingFeatures([]);
  return id;
}

function createNamedModel(name) {
  if (!name || !name.trim()) return null;
  return run(() => openNewModel(name));
}

// ---------- sharing a model ----------
//
// Two ways a model leaves or enters this browser: a self-contained
// link (`#model=<gzipped, base64url-encoded envelope>`, so a static
// page with no backend can still hand someone a working copy of what
// it built) and a URL someone else hosts, fetched and inflated on
// demand – typed into Import, or carried by a link of its own
// (`#url=<URI-encoded address>`). Both carry the same envelope – see
// `buildShareEnvelope` in model.js. Compression is the native Streams API only, matching the
// rest of this project's lack of a dependency story; there is no
// fallback for a browser that lacks it.

function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(text.length + (4 - (text.length % 4)) % 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function gzipToBase64Url(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return base64UrlEncode(new Uint8Array(buffer));
}

// What a model may unpack to, and how long a link to one may be. The
// largest shipped model is about 20 KB as JSON and under 2 KB as a
// link; the caps leave room for a hundred times that, and still stop a
// few hundred kilobytes of gzip from unpacking to gigabytes the moment
// a link is opened.
const UNPACKED_MAX_BYTES = 5 * 1024 * 1024;
const SHARE_LINK_MAX_LENGTH = 1000 * 1000;

// A stream's text, read a chunk at a time and abandoned past the cap –
// so an oversized one is never held whole.
async function readCappedText(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > UNPACKED_MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new DomainError(`it unpacks to more than ${UNPACKED_MAX_BYTES / 1024 / 1024} MB, far more than any model.`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

async function gunzipFromBase64Url(encoded) {
  if (encoded.length > SHARE_LINK_MAX_LENGTH) {
    throw new DomainError(`it is too long – over ${SHARE_LINK_MAX_LENGTH / 1000 / 1000} million characters, far more than any model.`);
  }
  return readCappedText(new Blob([base64UrlDecode(encoded)]).stream().pipeThrough(new DecompressionStream('gzip')));
}

async function buildShareLink(model) {
  const steps = session.steps.map(({ command, args }) => ({ command, args }));
  const envelope = buildShareEnvelope(model, steps);
  const encoded = await gzipToBase64Url(JSON.stringify(envelope));
  return location.origin + location.pathname + '#model=' + encoded;
}

function decodeShareLink(encoded) {
  return gunzipFromBase64Url(encoded).then((json) => JSON.parse(json));
}

// What a link to this page carries after its `#`: a model packed into
// it (`#model=…`) or the address of a file holding one (`#url=…`), then
// `&`-separated options. Null for any other fragment. An address that
// does not decode is taken as written – the fetch reports what is
// wrong with it.
function readModelLink(hash) {
  for (const kind of ['model', 'url']) {
    const prefix = '#' + kind + '=';
    if (!hash.startsWith(prefix)) continue;
    const [value, ...options] = hash.slice(prefix.length).split('&');
    let decoded = value;
    if (kind === 'url') { try { decoded = decodeURIComponent(value); } catch { /* as written */ } }
    return { kind, value: decoded, options: new URLSearchParams(options.join('&')) };
  }
  return null;
}

// The fragment that links to a hosted file: its address as typed when
// that reads back unchanged – a gist's stays legible – and URI-encoded
// when it holds what would end or garble it.
function modelUrlLink(address) {
  return '#url=' + (/[&#%\s]/.test(address) ? encodeURIComponent(address) : address);
}

// This page's address, up to where a hosted file's address goes.
function modelUrlLinkBase() {
  return location.origin + location.pathname + '#url=';
}

// A gist's page (`gist.github.com/<user>/<id>`) is HTML; its files come
// from the API, which any site may read. The page address is the one
// people copy, so it is read as the gist it names; every other address
// – a gist's Raw link among them – is fetched as it is.
const GIST_PAGE_URL = /^https:\/\/gist\.github\.com\/(?:[\w-]+\/)?([0-9a-f]+)\/?(?:[?#].*)?$/i;

function modelSourceUrl(url) {
  const match = GIST_PAGE_URL.exec(url.trim());
  return match
    ? { url: 'https://api.github.com/gists/' + match[1], gist: true }
    : { url: url.trim(), gist: false };
}

// The file in a gist that holds the model: its first `.dcb.json` file,
// else its first `.json` file, or its only file when none is named so.
function gistModelFile(gist) {
  const files = Object.values((gist && gist.files) || {});
  const named = (pattern) => files.find((f) => pattern.test(f.filename || ''));
  const file = named(/\.dcb\.json$/i) || named(/\.json$/i) || (files.length === 1 ? files[0] : null);
  if (!file) throw new DomainError('That file was not loaded: the gist holds no .json file.');
  return file;
}

// A URL someone else hosts – a gist, a bucket, another tool's export.
// `fetch` only auto-decompresses a gzip `Content-Encoding`; a file whose
// *content type* says gzip (a plain `.dcb.json.gz` sitting on a static
// host) arrives untouched over the wire and has to be inflated by hand.
// Every way it can fail says so as a DomainError – the reader of the
// message is whoever pasted or followed the address.
async function loadModelFromUrl(url) {
  const source = modelSourceUrl(url);
  const text = await fetchCappedText(source.url, { gist: source.gist });
  if (!source.gist) return parseFetchedJson(text);
  const file = gistModelFile(parseFetchedJson(text));
  return parseFetchedJson(file.truncated ? await fetchCappedText(file.raw_url) : file.content);
}

function notLoaded(reason) {
  return new DomainError('That file was not loaded: ' + reason);
}

async function fetchCappedText(url, { gist = false } = {}) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw notLoaded('its host could not be reached, or does not let other sites read it.');
  }
  if (gist && (response.status === 403 || response.status === 429)) {
    throw notLoaded('GitHub refused to serve the gist – likely its limit of 60 requests an hour. '
      + 'Use the file’s Raw link instead.');
  }
  if (!response.ok) throw notLoaded(`its host answered ${response.status} ${response.statusText}`.trim() + '.');
  if (!response.body) throw notLoaded('the response was empty.');
  const contentType = response.headers.get('Content-Type') || '';
  const body = contentType.includes('gzip') ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
  try {
    return await readCappedText(body);
  } catch (error) {
    throw error instanceof DomainError ? notLoaded(error.message) : error;
  }
}

function parseFetchedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw notLoaded('it is not JSON. For a gist, use its page or its Raw link.');
  }
}

// The async twin of `run`: same error reporting, for a flow that has to
// await a fetch or a compression stream before it knows whether it
// worked.
async function runAsync(fn) {
  try {
    const out = await fn();
    if (typeof render === 'function') render();
    return out;
  } catch (err) {
    if (err instanceof DomainError) toast(err.message, true);
    else { console.error(err); toast('Unexpected error: ' + err.message, true); }
  }
}

// ---------- the slice ----------

// Every grouped projection that handles this event – i.e. everything
// the event changes that a group gives a name. `group` and the local
// name (`property.name`) are what a reader wants to see, `projectionName`
// the qualified name the fold answers to (`Course.capacity`).
function effectsOf(model, eventName) {
  const out = [];
  for (const [groupName, group] of Object.entries(model['group-definitions'] || {})) {
    for (const inner of groupProjections(group)) {
      const projectionName = qualifiedProjectionName(groupName, inner.name);
      const projection = projectionsOf(model)[projectionName];
      for (const handler of (projection && projection.handlers) || []) {
        if (handler && handler.event === eventName) {
          out.push({
            group: groupName,
            property: { ...projection, name: inner.name },
            projectionName,
            handler,
          });
        }
      }
    }
  }
  return out;
}

// Every command that publishes this event – zero, one, or many. An
// event has no single owner, so this answers "who records this"
// instead of a boundary binding.
function publishersOf(model, eventName) {
  const out = [];
  for (const [name, body] of Object.entries(model['command-definitions'])) {
    for (const emission of body.publishes || []) {
      if (emission && emission.name === eventName) out.push({ command: name, emission });
    }
  }
  return out;
}

// Every top-level projection that handles this event – the ones
// `effectsOf` does not already name, listed beside it rather than twice.
function projectionsHandling(model, eventName) {
  const out = [];
  for (const [name, body] of Object.entries(model['projection-definitions'])) {
    for (const handler of body.handlers || []) {
      if (handler && handler.event === eventName) out.push({ projection: name, body, handler });
    }
  }
  return out;
}

// Every scenario – over a command or over projections – whose Given or
// Then names this event. `overProjections` says which of the two, since
// they are opened and named differently.
function scenariosReferencingEvent(model, eventName) {
  const scenarios = Object.entries(model['scenario-definitions'] || {})
    .filter(([, body]) =>
      (body.given || []).some((s) => s && s.event === eventName)
      || ((body.then || {}).events || []).some((e) => e && e.type === eventName))
    .map(([key, body]) => ({ key, body, overProjections: false }));
  const projectionScenarios = Object.entries(model['projection-scenario-definitions'] || {})
    .filter(([, body]) => (body.given || []).some((s) => s && s.event === eventName))
    .map(([key, body]) => ({ key, body, overProjections: true }));
  return [...scenarios, ...projectionScenarios];
}

// Everything one feature touches, in the order a reader meets it.
function sliceOf(model, commandName) {
  const body = model['command-definitions'][commandName];
  if (!body) return null;
  return {
    name: commandName,
    body,
    payload: body.properties || [],
    reads: body.boundary || [],
    rules: body.conditions || [],
    emits: (body.publishes || []).map((emission) => ({
      emission,
      event: model['event-definitions'][emission.name] || null,
      effects: effectsOf(model, emission.name),
      standalone: projectionsHandling(model, emission.name),
    })),
    projections: projectionsRead(body),
    // Grouped by the query to the store each read actually happens in,
    // which is the depth of the boundary's dependency graph and not
    // its length. Derived here so nothing has to author it.
    rounds: deriveRounds(body),
    dcb: deriveDcb(model, body),
  };
}

function allSlices(model) {
  return Object.keys(model['command-definitions']).map((n) => sliceOf(model, n));
}

// ---------- coupling ----------
//
// Every command against every event type it writes (`publishes`) or
// reads back to decide – the same relationship each command's own page
// already shows one at a time (its derived boundary), gathered once
// into a matrix. "Consumes" is read straight off `deriveDcb`: an event
// type is in a command's boundary the moment some read property's
// handler names it, whether or not that command ever publishes it –
// which is what lets a cell be produce-only, consume-only, or both.
function couplingMatrix(model) {
  const events = Object.keys(model['event-definitions']).sort();
  const groups = featureGroups(model)
    .map((group) => ({ name: group.name, commands: group.commands.map((n) => couplingRow(model, n, events)) }))
    .filter((group) => group.commands.length);
  return { events, groups };
}

function couplingRow(model, name, events) {
  const slice = sliceOf(model, name);
  const produces = new Set((slice.body.publishes || []).map((e) => e && e.name).filter(Boolean));
  // event type -> Set of readable "where from" text.
  const via = {};
  for (const item of slice.dcb.items) {
    if (!item.types.length) continue;
    const binding = !item.projection && (slice.body.boundary || []).find((b) => b.alias === item.alias);
    const group = binding && binding.group;
    for (const eventType of item.types) {
      if (!via[eventType]) via[eventType] = new Set();
      if (item.projection) {
        via[eventType].add(readable(item.projection));
        continue;
      }
      const sources = (item.readProperties || []).filter((propName) => {
        const projection = group && projectionsOf(model)[qualifiedProjectionName(group, propName)];
        return projection && (projection.handlers || []).some((h) => h && h.event === eventType);
      });
      if (sources.length) sources.forEach((propName) => via[eventType].add(memberWords(item.alias, propName)));
      else via[eventType].add(item.alias);
    }
  }
  return {
    name,
    cells: events.map((event) => ({
      event,
      produces: produces.has(event),
      consumes: !!via[event],
      via: via[event] ? [...via[event]] : [],
    })),
  };
}

// ---------- coupling clusters ----------
//
// The matrix as a plain undirected graph – one node per command and
// per event, an edge wherever a cell has any coupling at all (produce
// or consume; direction does not matter for reachability). Two things
// fall out of that graph for free: which commands and events could be
// lifted into their own bounded context together (a connected
// component), and which single command or event is the one thing
// still holding two such components together (an articulation point –
// sever that one coupling and the model splits along the seam it
// names).
function couplingGraph(matrix) {
  const adj = new Map(); // id -> Set(id)
  const commandId = (name) => 'cmd:' + name;
  const eventId = (name) => 'evt:' + name;
  const addNode = (id) => { if (!adj.has(id)) adj.set(id, new Set()); };
  const addEdge = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };

  for (const event of matrix.events) addNode(eventId(event));
  for (const group of matrix.groups) {
    for (const row of group.commands) {
      addNode(commandId(row.name));
      for (const cell of row.cells) {
        if (cell.produces || cell.consumes) addEdge(commandId(row.name), eventId(cell.event));
      }
    }
  }
  return adj;
}

// Every node's connected-component index, assigned in the order
// `nodeOrder` first meets each component – so the numbering is stable
// and reproducible rather than an artefact of `Map` iteration order.
function connectedComponentsOf(adj, nodeOrder) {
  const componentOf = new Map();
  let next = 0;
  for (const start of nodeOrder) {
    if (componentOf.has(start)) continue;
    const stack = [start];
    componentOf.set(start, next);
    while (stack.length) {
      const id = stack.pop();
      for (const neighbor of adj.get(id)) {
        if (!componentOf.has(neighbor)) { componentOf.set(neighbor, next); stack.push(neighbor); }
      }
    }
    next += 1;
  }
  return componentOf;
}

// Articulation points (Tarjan): nodes whose removal would split the
// component they belong to into two or more pieces. Standard
// discovery/low-link DFS – recursive, since a DCB model's coupling
// graph is small enough that the call depth never approaches what
// would trouble the interpreter.
function articulationPointsOf(adj) {
  const disc = new Map();
  const low = new Map();
  const cut = new Set();
  let timer = 0;

  function dfs(id, parent) {
    disc.set(id, timer); low.set(id, timer); timer += 1;
    let children = 0;
    for (const neighbor of adj.get(id)) {
      if (neighbor === parent) continue;
      if (disc.has(neighbor)) {
        low.set(id, Math.min(low.get(id), disc.get(neighbor)));
      } else {
        children += 1;
        dfs(neighbor, id);
        low.set(id, Math.min(low.get(id), low.get(neighbor)));
        if (parent !== null && low.get(neighbor) >= disc.get(id)) cut.add(id);
      }
    }
    if (parent === null && children > 1) cut.add(id);
  }

  for (const id of adj.keys()) {
    if (!disc.has(id)) dfs(id, null);
  }
  return cut;
}

// Commands and events reordered so that coupled clusters sit together
// and, within a cluster, the most-coupled things – the likeliest
// bridges – settle toward the far edge. Clusters are numbered by size,
// largest first, so the model's core sits at the top-left and its
// loosest ends trail off toward the bottom-right.
function couplingClusters(matrix) {
  const adj = couplingGraph(matrix);
  const commandIds = matrix.groups.flatMap((g) => g.commands.map((r) => 'cmd:' + r.name));
  const eventIds = matrix.events.map((e) => 'evt:' + e);
  const nodeOrder = [...commandIds, ...eventIds];

  const componentOf = connectedComponentsOf(adj, nodeOrder);
  const bridges = articulationPointsOf(adj);

  const commandCount = new Map();
  const eventCount = new Map();
  const firstSeen = new Map();
  nodeOrder.forEach((id, i) => {
    const c = componentOf.get(id);
    if (!firstSeen.has(c)) firstSeen.set(c, i);
    (id.startsWith('cmd:') ? commandCount : eventCount).set(c, ((id.startsWith('cmd:') ? commandCount : eventCount).get(c) || 0) + 1);
  });
  const rankOrder = [...firstSeen.keys()].sort((a, b) => {
    const sizeA = (commandCount.get(a) || 0) + (eventCount.get(a) || 0);
    const sizeB = (commandCount.get(b) || 0) + (eventCount.get(b) || 0);
    return sizeB - sizeA || firstSeen.get(a) - firstSeen.get(b);
  });
  const rankOf = new Map(rankOrder.map((c, i) => [c, i]));

  const degree = (id) => adj.get(id).size;
  const byClusterThenDegree = (a, b) =>
    rankOf.get(componentOf.get(a)) - rankOf.get(componentOf.get(b))
    || (bridges.has(a) === bridges.has(b) ? degree(b) - degree(a) : bridges.has(a) ? 1 : -1);

  const commandOrder = [...commandIds].sort(byClusterThenDegree).map((id) => id.slice(4));
  const eventOrder = [...eventIds].sort(byClusterThenDegree).map((id) => id.slice(4));

  const clusters = rankOrder.map((c, rank) => ({
    rank, commands: commandCount.get(c) || 0, events: eventCount.get(c) || 0,
  }));

  return {
    commandOrder,
    eventOrder,
    clusterOfCommand: (name) => rankOf.get(componentOf.get('cmd:' + name)),
    clusterOfEvent: (name) => rankOf.get(componentOf.get('evt:' + name)),
    isBridgeCommand: (name) => bridges.has('cmd:' + name),
    isBridgeEvent: (name) => bridges.has('evt:' + name),
    clusters,
  };
}

// ---------- lifecycles ----------
//
// How a projection's value moves over time. Nothing here is authored
// or stored: every part is worked out from definitions that already
// exist, which is why a lifecycle is a view of a projection and not a
// construct of the language (it was one, an entity's designated
// property, until 11.0 – see
// docs/research/2026-10-28-lifecycles-for-enum-projections.md).
//
// Where the values are finite – an enum, a boolean – it is a state
// machine (`lifecycleMachine`). Anywhere else there are no states to
// draw, only movements (`lifecycleMovements`): each handler, the
// commands appending its event, and their rules over the value. No
// states are invented for those – "empty / not empty" or "0 / more"
// would be buckets the model does not state.
//
// The machine:
//   states       the enum's members, in declared order – with `null`
//                first when the projection can hold no state at all
//                (starts at null, or a handler sets it);
//   transitions  the projection's handlers: one that sets a member is
//                an arrow into it, starting wherever the commands
//                publishing its event are allowed to run;
//   per state    the commands allowed to run there, read off their
//                rules over this projection.
//
// A command that moves the projection with nothing guarding it is
// *unguarded*, and stays visible rather than papered over: its arrow is
// drawn from the initial state only as a convention, and flagged. What
// cannot be read – a state taken from event data, a rule comparing to a
// parameter, a command reading two instances at once – is said beside
// the machine, never guessed into an arrow.

// What a projection's lifecycle is made of, or null when it has none:
// `{kind: 'enum' | 'boolean', states}` for a machine, `{kind:
// 'movements'}` otherwise. A derived projection has no handlers of its
// own, and a scripted one's are code, so neither has one.
function lifecycleOf(model, body) {
  if (!body || scriptOf(body) || derivedOf(body)) return null;
  if (body.isList) return { kind: 'movements' };
  const members = enumMembersFor(model, body.valueType);
  if (members && members.every((member) => typeof member === 'string')) {
    return { kind: 'enum', states: [...members] };
  }
  if (!members && literalKindOf(model, body.valueType) === 'boolean') return { kind: 'boolean', states: [false, true] };
  return { kind: 'movements' };
}

// A literal state an operand names: an enum member, a boolean, or
// `null` – the empty state. `undefined` when the operand names no state
// this can read.
function lifecycleStateOperand(operand, states) {
  if (operand === null) return null;
  if (typeof operand === 'boolean') return states.includes(operand) ? operand : undefined;
  if (operandSource(operand) === 'enum-member' && states.includes(operand.enumMember)) return operand.enumMember;
  return undefined;
}

// Which states a condition over the projection allows, given the other
// side; null when the condition says nothing readable. `equals` against
// a state and `equalsAny` against a list of them are read, negated or
// not – an empty list too, which allows nothing, as it evaluates – and
// a boolean's `isTrue` / `isFalse`.
function lifecycleAllowedStates(condition, states, other) {
  const only = (keep) => states.filter((state) => keep.includes(state) !== !!condition.negate);
  if (condition.predicate === 'isTrue' && states.includes(true)) return only([true]);
  if (condition.predicate === 'isFalse' && states.includes(false)) return only([false]);
  if (condition.predicate === 'equals') {
    const state = lifecycleStateOperand(other, states);
    return state === undefined ? null : only([state]);
  }
  if (condition.predicate === 'equalsAny' && Array.isArray(other)) {
    const named = other.map((entry) => lifecycleStateOperand(entry, states));
    return named.includes(undefined) ? null : only(named);
  }
  return null;
}

// The instance of `projectionName` an operand reads, as a key – the
// read's tags, or its binding's – or null when it does not read it.
// `each` says the read fans out, so no one instance is meant.
function lifecycleReadOf(operand, body, projectionName) {
  const instance = (tags) => {
    const entries = Object.entries(tags && typeof tags === 'object' && !Array.isArray(tags) ? tags : {});
    return { key: JSON.stringify(entries), each: entries.some(([, value]) => operandSource(value) === 'each') };
  };
  const source = operandSource(operand);
  if (source === 'projection-read') return operand.projection === projectionName ? instance(operand.tags) : null;
  if (source !== 'alias-property') return null;
  const binding = (body.boundary || []).find((b) => b && b.alias === operand.alias);
  if (!binding) return null;
  if (binding.projection === projectionName && !operand.property) return instance(binding.tags);
  if (binding.group && operand.property
      && qualifiedProjectionName(binding.group, operand.property) === projectionName) return instance(binding.tags);
  return null;
}

// What one command's conditions say about the projection: whether they
// read it, the states they allow (null: unconstrained), and whether a
// rule over it could not be read. Several rules intersect.
function lifecycleConstraint(conditions, body, projectionName, states) {
  let allowed = null;
  let reads = false;
  let unreadable = false;
  for (const condition of conditions) {
    if (!condition) continue;
    for (const side of ['leftHandSide', 'rightHandSide']) {
      if (!lifecycleReadOf(condition[side], body, projectionName)) continue;
      reads = true;
      const other = condition[side === 'leftHandSide' ? 'rightHandSide' : 'leftHandSide'];
      const these = lifecycleAllowedStates(condition, states, other);
      if (these === null) { unreadable = true; continue; }
      allowed = allowed === null ? these : allowed.filter((state) => these.includes(state));
    }
  }
  return { reads, states: allowed, unreadable };
}

// Why a command cannot be placed on the machine, or null when it can:
// it reads two instances of the projection (which one moves?), reads it
// through `each`, or guards it in a way `lifecycleAllowedStates` cannot
// read.
function lifecycleUnplaced(body, projectionName, states) {
  const conditions = [
    ...(body.conditions || []),
    ...(body.publishes || []).flatMap((emission) => (emission && emission.when) || []),
  ];
  const instances = new Set();
  let each = false;
  for (const condition of conditions) {
    if (!condition) continue;
    for (const side of ['leftHandSide', 'rightHandSide']) {
      const read = lifecycleReadOf(condition[side], body, projectionName);
      if (!read) continue;
      instances.add(read.key);
      each = each || read.each;
    }
  }
  if (each || instances.size > 1) return 'ambiguous';
  if (lifecycleConstraint(conditions, body, projectionName, states).unreadable) return 'unreadable';
  return null;
}

// The machine, or null when the projection has no lifecycle. `body` is
// the projection as it is being edited – the stored one by default.
//
//   transitions  `{event, target, sources, conventional, unguarded,
//                unpublished}` – `sources` the union of where its
//                publishers may emit it (an emission's `when` narrowing
//                its own); with none to read, it is drawn from the
//                initial state (`conventional`), and `unguarded` names
//                the publishers nothing guards;
//   opaque       events whose handler sets a state this cannot read;
//   unplaced     `{command, reason}` – commands left off the machine;
//   neverSet     states neither the start nor any arrow reaches;
//   terminal     reached states no arrow leaves – none claimed while
//                anything is opaque or unplaced, since an unread arrow
//                may be the one that leaves;
//   perState     `[{state, commands: [{command, movesTo, unguarded}]}]`.
function lifecycleMachine(model, projectionName, body = projectionsOf(model)[projectionName]) {
  const lifecycle = lifecycleOf(model, body);
  if (!lifecycle || !lifecycle.states) return null;
  const members = lifecycle.states;
  // An initial value that names no member is drawn as the empty state.
  const initial = body.initialValue === undefined ? null : lifecycleStateOperand(body.initialValue, members);
  const start = initial === undefined ? null : initial;
  const handlers = (body.handlers || []).filter((handler) => handler && handler.event);
  const targetOf = (handler) => (handler.operation === 'set' ? lifecycleStateOperand(handler.value, members) : undefined);
  const states = start === null || handlers.some((handler) => targetOf(handler) === null)
    ? [null, ...members] : members;
  const commands = model['command-definitions'] || {};

  const unplaced = [];
  for (const [command, commandBody] of Object.entries(commands)) {
    const reason = commandBody && lifecycleUnplaced(commandBody, projectionName, states);
    if (reason) unplaced.push({ command, reason });
  }
  const isPlaced = (command) => !unplaced.some((entry) => entry.command === command);

  const transitions = [];
  const opaque = [];
  for (const handler of handlers) {
    const target = targetOf(handler);
    if (target === undefined) { opaque.push(handler.event); continue; }
    const publishers = publishersOf(model, handler.event);
    const sources = new Set();
    const unguarded = [];
    for (const { command, emission } of publishers) {
      if (!isPlaced(command)) continue;
      const constraint = lifecycleConstraint(
        [...(commands[command].conditions || []), ...(emission.when || [])], commands[command], projectionName, states);
      if (constraint.states === null) {
        if (!unguarded.includes(command)) unguarded.push(command);
      } else {
        for (const state of constraint.states) sources.add(state);
      }
    }
    const conventional = !sources.size;
    transitions.push({
      event: handler.event,
      target,
      sources: conventional ? [start] : states.filter((state) => sources.has(state)),
      conventional,
      unguarded,
      unpublished: !publishers.length,
    });
  }
  // An arrow with nothing to read its source from starts at the initial
  // state – unless it leads back there, where that would be no move at
  // all: then it comes from every other state the machine reaches, so
  // `set false` after `set true` is still drawn.
  const reachedBefore = new Set([start, ...transitions.map((t) => t.target)]);
  for (const transition of transitions) {
    if (!transition.conventional || transition.target !== start) continue;
    transition.sources = states.filter((state) => state !== start && reachedBefore.has(state));
  }

  const handled = new Set(handlers.map((handler) => handler.event));
  const perState = states.map((state) => ({ state, commands: [] }));
  for (const [command, commandBody] of Object.entries(commands)) {
    if (!commandBody || !isPlaced(command)) continue;
    const moving = (commandBody.publishes || []).filter((emission) => emission && handled.has(emission.name));
    const constraint = lifecycleConstraint(commandBody.conditions || [], commandBody, projectionName, states);
    if (!moving.length && constraint.states === null) continue;
    const entry = {
      command,
      movesTo: [...new Set(transitions
        .filter((t) => moving.some((emission) => emission.name === t.event)).map((t) => t.target))],
      unguarded: !!moving.length && lifecycleConstraint(
        [...(commandBody.conditions || []), ...moving.flatMap((emission) => emission.when || [])],
        commandBody, projectionName, states).states === null,
    };
    for (const slot of perState) {
      if (constraint.states === null || constraint.states.includes(slot.state)) slot.commands.push(entry);
    }
  }

  const reached = new Set([start, ...transitions.map((t) => t.target)]);
  const leaves = new Set(transitions.flatMap((t) => t.sources.filter((state) => state !== t.target)));
  const complete = !opaque.length && !unplaced.length;
  return {
    projection: projectionName,
    kind: lifecycle.kind,
    states,
    initial: start,
    transitions,
    opaque,
    unplaced,
    neverSet: states.filter((state) => !reached.has(state)),
    terminal: complete ? states.filter((state) => reached.has(state) && !leaves.has(state)) : [],
    perState,
  };
}

// A command's rules that read the projection – either side of them, in
// place or through an alias – out of `conditions`.
function lifecycleRulesOver(conditions, body, projectionName) {
  return conditions.filter((condition) => condition
    && ['leftHandSide', 'rightHandSide'].some((side) => lifecycleReadOf(condition[side], body, projectionName)));
}

// The movements of a projection that has no states to draw, or null
// when it has a machine (or no lifecycle at all).
//
//   initial    its initial value, as stored;
//   handlers   `{event, operation, value, appendedBy: [{command,
//              rules}]}` – a command's rules over the value are its
//              conditions and the guards of the emissions appending
//              that event;
//   readers    `{command, rules}` – commands with a rule over it that
//              append nothing moving it: where the value matters.
//
// No command is called unguarded here: a counter is ordinarily guarded
// through another projection (subscribing, by the capacity), so a mark
// would be noise.
function lifecycleMovements(model, projectionName, body = projectionsOf(model)[projectionName]) {
  const lifecycle = lifecycleOf(model, body);
  if (!lifecycle || lifecycle.kind !== 'movements') return null;
  const commands = model['command-definitions'] || {};
  const handlers = (body.handlers || []).filter((handler) => handler && handler.event);
  const handled = new Set(handlers.map((handler) => handler.event));
  return {
    projection: projectionName,
    kind: lifecycle.kind,
    initial: body.initialValue === undefined ? null : body.initialValue,
    handlers: handlers.map((handler) => ({
      event: handler.event,
      operation: handler.operation,
      value: handler.value,
      appendedBy: Object.entries(commands).flatMap(([command, commandBody]) => {
        const emissions = ((commandBody && commandBody.publishes) || [])
          .filter((emission) => emission && emission.name === handler.event);
        if (!emissions.length) return [];
        const rules = lifecycleRulesOver(
          [...(commandBody.conditions || []), ...emissions.flatMap((emission) => emission.when || [])],
          commandBody, projectionName);
        return [{ command, rules }];
      }),
    })),
    readers: Object.entries(commands).flatMap(([command, commandBody]) => {
      if (!commandBody) return [];
      const publishes = (commandBody.publishes || []).filter(Boolean);
      if (publishes.some((emission) => handled.has(emission.name))) return [];
      const rules = lifecycleRulesOver(
        [...(commandBody.conditions || []), ...publishes.flatMap((emission) => emission.when || [])],
        commandBody, projectionName);
      return rules.length ? [{ command, rules }] : [];
    }),
  };
}

// ---------- event model ----------
//
// The model laid out the way eventmodeling.org draws a system: time
// running left to right, each command with its payload above it and
// the events it appends below, and a read model after it for every
// piece of state those events move for the first time.
//
// The event lanes are tags, not streams. An event belongs to every
// instance it is tagged with, so one carrying a course id and a student
// id is one card across both lanes – the fact a stream-per-aggregate
// model would have to split in two, which is the whole case for DCB.
//
// A definition holds no time, so the order is the features' – the
// order the rail lists them in – and, within one, the order the
// commands were written in: an author writes the creating command
// first far more often than the rail's alphabet puts it there. (It
// used to follow the entities' lifecycles; those went with entities,
// 11.0.)
function eventModel(model) {
  const commands = model['command-definitions'];
  const features = featureGroups(model).map((group) => group.name);
  const written = Object.keys(commands);
  const ordered = written
    .map((name, at) => ({ name, at, feature: features.indexOf(featureOf(commands[name])) }))
    .sort((a, b) => a.feature - b.feature || a.at - b.at)
    .map((entry) => entry.name);

  const lanes = [];
  const laneOf = (tag) => {
    if (!lanes.includes(tag)) lanes.push(tag);
    return lanes.indexOf(tag);
  };
  const tagsOf = (eventName) => {
    const definition = model['event-definitions'][eventName];
    const tags = eventTagLeaves(model, definition).map((leaf) => leaf.identifierType);
    return [...new Set(tags)];
  };

  // Lanes are claimed in timeline order, so the first lane is the tag
  // the story starts with; untagged events share one lane, last.
  const columns = [];
  const shown = new Set();
  const untagged = [];
  for (const name of ordered) {
    const body = commands[name];
    const emits = (body.publishes || []).filter((emission) => emission && emission.name);
    const events = emits.map((emission) => {
      const tags = tagsOf(emission.name);
      const event = { name: emission.name, tags, guarded: !!(emission.when && emission.when.length), lanes: tags.map(laneOf) };
      if (!tags.length) untagged.push(event);
      return event;
    });
    columns.push({
      kind: 'command', command: name,
      payload: body.properties || [],
      rules: (body.conditions || []).length,
      guards: emits.reduce((n, emission) => n + (emission.when ? emission.when.length : 0), 0),
      reads: (body.boundary || []).map((binding) => binding.alias),
      events,
    });

    for (const event of events) {
      const fresh = new Map();
      for (const effect of effectsOf(model, event.name)) {
        if (shown.has(effect.projectionName)) continue;
        shown.add(effect.projectionName);
        if (!fresh.has(effect.group)) fresh.set(effect.group, []);
        fresh.get(effect.group).push(effect.property.name);
      }
      // In lane order, so the read models under a two-tag event come
      // in the order its lanes do.
      const laneRank = (group) => {
        const tag = groupTagOf(model['group-definitions'][group]);
        const at = tag ? lanes.indexOf(tag.tagType) : -1;
        return at < 0 ? lanes.length : at;
      };
      for (const [group, properties] of [...fresh].sort((a, b) => laneRank(a[0]) - laneRank(b[0]))) {
        columns.push({ kind: 'read', group, properties, from: event.name });
      }
      for (const { projection } of projectionsHandling(model, event.name)) {
        if (shown.has(projection)) continue;
        shown.add(projection);
        columns.push({ kind: 'read', projection, properties: [], from: event.name });
      }
    }
  }
  if (untagged.length) {
    const lane = laneOf(null);
    for (const event of untagged) event.lanes = [lane];
  }
  return { lanes, columns };
}

// ---------- features ----------
//
// A feature groups the commands that make it up. It is not a definition
// of its own: it exists because commands name it, which means a feature
// cannot be empty. Groups you have named but not filled yet are held
// here in the interface until they earn a command.

const UNGROUPED = 'Ungrouped';
const GROUPS_KEY = 'dcb-playground:pending-features';

function pendingFeatures() {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY)) || []; } catch (e) { return []; }
}
function setPendingFeatures(list) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify([...new Set(list)]));
}
function addPendingFeature(name) { setPendingFeatures([...pendingFeatures(), name]); }

function featureOf(body) {
  return (body && typeof body.feature === 'string' && body.feature.trim()) || UNGROUPED;
}

// Features in the order their first command appears, then the ones still
// waiting for one, then the catch-all – so the rail never reshuffles
// under you as you edit. *Within* a feature the commands sit
// alphabetically, by the name they are shown under: a command's place
// in a group carries no meaning, so a fixed order beats an accidental
// one – and it is what lets dropping a command anywhere in a group
// mean only "into this group".
function featureGroups(model) {
  const order = [];
  const byFeature = {};
  for (const [name, body] of Object.entries(model['command-definitions'])) {
    const feature = featureOf(body);
    if (!byFeature[feature]) { byFeature[feature] = []; if (feature !== UNGROUPED) order.push(feature); }
    byFeature[feature].push(name);
  }
  const live = new Set(order);
  for (const name of pendingFeatures()) {
    if (!live.has(name) && name !== UNGROUPED) { order.push(name); byFeature[name] = []; }
  }
  if (byFeature[UNGROUPED]) order.push(UNGROUPED);
  return order.map((name) => ({
    name,
    commands: (byFeature[name] || []).sort((a, b) => readable(a).localeCompare(readable(b))),
  }));
}

// Events no feature emits – the loose ends a command-centred view
// would otherwise hide.
function orphans(model) {
  const emitted = new Set();
  for (const body of Object.values(model['command-definitions'])) {
    for (const e of body.publishes || []) emitted.add(e.name);
  }
  return {
    events: Object.keys(model['event-definitions']).filter((n) => !emitted.has(n)),
  };
}

// Which commands read a projection, however they reach it: by name –
// an alias's read or one in place – or, for a grouped one, as the
// member of a group alias (`course.capacity`, `course` bound to the
// group). One question rather than two, because the member read *is*
// the qualified read, spelled through the alias.
function projectionReaders(model, projectionName) {
  const split = splitQualifiedName(projectionName);
  const readers = [];
  for (const [command, body] of Object.entries(model['command-definitions'])) {
    let reads = (body.boundary || []).some((b) => b && b.projection === projectionName)
      || inlineReads(body).some(({ read }) => read.projection === projectionName);
    if (!reads && split) {
      const aliases = new Set((body.boundary || [])
        .filter((b) => b && b.group === split.group).map((b) => b.alias));
      forEachCommandOperand(body, (operand) => {
        if (operandSource(operand) === 'alias-property'
            && aliases.has(operand.alias) && operand.property === split.local) reads = true;
      });
    }
    if (reads) readers.push(command);
  }
  return readers;
}

// ---------- groups ----------
//
// What the `+ group` form offers and proposes. A group is read by one
// tag, `{name, tagType}`, so the tags a model already reads things by
// are the likeliest answers: every projection's, every group's, and a
// tag type nobody reads by yet under the name it would get (`CourseId`
// → `courseId`). In that order, each once.
function groupTagChoices(model) {
  const out = [];
  const seen = new Set();
  const add = (tag) => {
    if (!tag || !tag.name || !tag.tagType) return;
    const key = tag.name + ':' + tag.tagType;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: tag.name, tagType: tag.tagType });
  };
  for (const body of Object.values(model['projection-definitions'] || {})) projectionTagParams(body).forEach(add);
  for (const group of Object.values(model['group-definitions'] || {})) add(groupTagOf(group));
  const typed = new Set(out.map((tag) => tag.tagType));
  for (const [type, body] of Object.entries(model['custom-type-definitions'] || {})) {
    if (body && body.isTag && !Array.isArray(body.properties) && !typed.has(type)) {
      add({ name: type.charAt(0).toLowerCase() + type.slice(1), tagType: type });
    }
  }
  return out;
}

// The name a group is offered under, read off its tag's type: what the
// type identifies – `CourseId` → `Course`, `OrderKey` → `Order`.
function suggestGroupName(tagType) {
  const type = String(tagType || '');
  const stem = type.replace(/(Id|ID|Key|Identifier|Number)$/, '');
  return stem && /^\p{Lu}/u.test(stem) ? stem : type;
}

// ---------- names ----------
//
// A modeler types "define course"; the model stores `DefineCourse`. The
// PascalCase is the schema's business, not the author's, so it is
// derived on the way in and unwound on the way out. The stored
// identifier rides beside the label, for anyone who wants it.

function toPascal(label) {
  return String(label || '').split(/[^\p{L}\p{M}\p{Nd}]+/u).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

function toCamel(label) {
  const pascal = toPascal(label);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : '';
}

function splitWords(name) {
  return String(name || '')
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/\s+/).filter(Boolean);
}

// `CourseDefined` -> "Course defined". For things with a name of their
// own: a command, an event, a group, a value type, a status. A grouped
// projection's qualified name reads as the group and its member, the
// way an alias's member does – `Course.subscriptionCount` -> "Course ·
// subscription count".
function readable(name) {
  const split = splitQualifiedName(name);
  if (split) return memberWords(readable(split.group), split.local);
  const words = splitWords(name);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
}

// `courseId` -> "course id". For the things that belong to something
// else – a property, a parameter, a field. They are never capitalised,
// and they read the same wherever they turn up: in the list that
// declares them and in the sentence that refers back to them.
function propertyWords(name) {
  return splitWords(name).map((w) => w.toLowerCase()).join(' ');
}

// A property reached through the alias it was bound under.
function memberWords(alias, property) {
  return `${alias} · ${propertyWords(property)}`;
}

function pastTense(verb) {
  if (/e$/i.test(verb)) return verb + 'd';
  if (/[^aeiou]y$/i.test(verb)) return verb.slice(0, -1) + 'ied';
  return verb + 'ed';
}

const PREPOSITIONS = ['To', 'From', 'In', 'On', 'For', 'With', 'At', 'Of'];

// An event is usually the command in the past tense, with the verb
// moved behind the thing it acted on: DefineCourse -> CourseDefined,
// SubscribeStudentToCourse -> StudentSubscribedToCourse. Only ever a
// suggestion – it is offered in an editable field, never imposed.
function suggestEventName(commandName) {
  const words = splitWords(toPascal(commandName));
  if (!words.length) return '';
  if (words.length === 1) return pastTense(words[0]);
  const [verb, ...rest] = words;
  const at = rest.findIndex((w) => PREPOSITIONS.includes(w));
  const past = pastTense(verb);
  if (at > 0) return rest.slice(0, at).join('') + past + rest.slice(at).join('');
  return rest.join('') + past;
}

// ---------- saying it in words ----------

function operandWords(operand) {
  // `equalsAny`'s literal list – the entries, said in order.
  if (Array.isArray(operand)) {
    return operand.length ? operand.map(operandWords).join(', ') : '[]';
  }
  switch (operandSource(operand)) {
    case 'alias-property':
      // No property means a bound projection's single value, which the
      // alias already names. A group member's arguments are its own,
      // so they follow it, the way a read in place's do.
      if (!operand.property) return propertyWords(operand.alias);
      if (operand.arguments && Object.keys(operand.arguments).length) {
        return memberWords(operand.alias, operand.property) + ' (' + Object.entries(operand.arguments)
          .map(([name, value]) => `${name} = ${operandWords(value)}`).join(', ') + ')';
      }
      return memberWords(operand.alias, operand.property);
    case 'parameter':
      return operand.property
        ? memberWords(propertyWords(operand.parameterName), operand.property)
        : propertyWords(operand.parameterName);
    case 'enum-member': return readable(operand.enumMember);
    // A path, not a name: the same `event.data.capacity` a scripted
    // handler writes, so the stored spelling stays – humanizing inside
    // a dotted path reads as a typo. It is also what tells a value the
    // event carried apart from a constant at a glance.
    case 'event-property': return `event.data.${operand.eventProperty}`;
    // Both are operand *kinds*, not prose: the schema names them and
    // nothing an author typed is being unwound here, so they read as
    // the tokens they are rather than as descriptions of themselves.
    case 'current-value': return 'currentValue';
    case 'successor': return `successor(${operandWords(operand.successor)})`;
    // A projection read in place, as a call: the name, then the values
    // it gives its tags and arguments – `Developer seniority level
    // (developer)`. The code view's spelling with the words a reader
    // reads; `projectionReadParts` hands the pieces to a renderer.
    // A grouped one reads as the group's instance and then its member,
    // `Course (course id) · seats on (slot = slot)` – the code view's
    // `Course(courseId).seatsOn(slot: slot)`, in words.
    case 'projection-read': {
      const { name, values, member, memberValues } = projectionReadParts(operand);
      const call = (head, list) => (list.length ? `${head} (${list.map((v) => v.words).join(', ')})` : head);
      return member === undefined ? call(name, values) : `${call(name, values)} · ${call(member, memberValues)}`;
    }
    case 'tag-literal': return operandText(operand);
    case 'each': return 'each ' + operandWords(operand.each);
    default:
      if (typeof operand === 'string') return `"${operand}"`;
      // A record a scripted projection folded to is a static value
      // with no operand shape – it reads as the JSON it is rather
      // than as "[object Object]".
      if (operand !== null && typeof operand === 'object') return JSON.stringify(operand);
      return String(operand);
  }
}

// Where a projection starts, as the literal it is.
//
// `null`, `""` and `[]` are three different answers and each keeps its
// own spelling: a value that has not arrived is not the empty string,
// and an empty list is neither. None of them is softened into words –
// this reader gets the literal faster than a description of it.
function initialValueWords(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return value.length ? value.map(operandWords).join(', ') : '[]';
  }
  return operandWords(value);
}

const PREDICATE_WORDS = {
  equals: ['is', 'is not'],
  equalsAny: ['is one of', 'is not one of'],
  lessThan: ['is less than', 'is not less than'],
  lessThanOrEquals: ['is at most', 'is more than'],
  greaterThan: ['is more than', 'is not more than'],
  greaterThanOrEquals: ['is at least', 'is less than'],
  contains: ['contains', 'does not contain'],
  containsAny: ['overlaps', 'does not overlap'],
  countEquals: ['has exactly', 'does not have exactly'],
  countLessThan: ['has fewer than', 'does not have fewer than'],
  countGreaterThan: ['has more than', 'does not have more than'],
  startsWith: ['starts with', 'does not start with'],
  endsWith: ['ends with', 'does not end with'],
  isEmpty: ['is empty', 'is not empty'],
  isNotEmpty: ['is not empty', 'is empty'],
  isTrue: ['holds', 'does not hold'],
  isFalse: ['does not hold', 'holds'],
};

// A condition as a sentence. Returns parts so a renderer can style the
// operands without re-parsing the text. `model` and `body` are accepted
// for the callers that pass them; the literal reading needs neither.
function conditionParts(condition, model, body) {
  const words = PREDICATE_WORDS[condition.predicate] || [condition.predicate, 'not ' + condition.predicate];
  const verb = words[condition.negate ? 1 : 0];
  const left = operandWords(condition.leftHandSide);
  if (condition.rightHandSide === undefined) return { left, verb, right: null };
  return { left, verb, right: operandWords(condition.rightHandSide) };
}

// A read in place in pieces: the projection's name, and each value
// it is read with – tags first, then arguments as `name = value` – with
// the operand each came from, so a renderer can point back at it.
//
// A grouped projection's read splits in two, the way the code view
// writes it: the group and the tag that picks its instance (`name`,
// `values`, `group` set), then the member and its own arguments
// (`member`, `memberValues`).
function projectionReadParts(operand) {
  const tagWords = (tag) => (operandSource(tag) === 'tag-literal' ? operandText(tag) : operandWords(tag));
  const tags = readTagOperands(operand).map((tag) => ({ operand: tag, words: tagWords(tag) }));
  const args = Object.entries(operand.arguments || {})
    .map(([name, value]) => ({ operand: value, words: `${name} = ${operandWords(value)}` }));
  const split = splitQualifiedName(operand.projection);
  if (split) {
    return { name: readable(split.group), group: split.group, values: tags, member: propertyWords(split.local), memberValues: args };
  }
  return { name: readable(operand.projection || '?'), values: [...tags, ...args] };
}

// The message a rule is refused with when its author wrote none: the
// condition, said as what the command requires – `Developer seniority
// level must be at least Required seniority level`. A read in place is
// named without its tags, an alias's property as words: the message is
// static text, and what a refusal read is never part of it.
function derivedRejection(model, body, condition) {
  // "Is one of" a list held in data is stored with its sides swapped
  // (`contains`, the list first); said the way the rule adder asks it.
  const swapped = condition.predicate === 'contains'
    && operandSource(condition.leftHandSide) === 'parameter'
    && operandSource(condition.rightHandSide) === 'alias-property';
  const said = swapped
    ? { ...condition, predicate: 'equalsAny', leftHandSide: condition.rightHandSide, rightHandSide: condition.leftHandSide }
    : condition;
  const p = conditionParts(said, model, body);
  // Only where the sentence named the operand itself.
  const words = (operand, fallback) => {
    if (fallback !== operandWords(operand)) return fallback;
    if (operandSource(operand) === 'projection-read') return readable(operand.projection || '?');
    if (operandSource(operand) === 'alias-property' && operand.property) {
      return `${propertyWords(operand.alias)} ${propertyWords(operand.property)}`;
    }
    return fallback;
  };
  const left = words(said.leftHandSide, p.left);
  const right = p.right === null ? null
    : Array.isArray(said.rightHandSide) ? p.right : words(said.rightHandSide, p.right);
  const text = [left, requirementVerb(p.verb), right].filter(Boolean).join(' ');
  const message = text[0].toUpperCase() + text.slice(1);
  return message.length > REJECTION_MAX_LENGTH ? message.slice(0, REJECTION_MAX_LENGTH - 1) + '…' : message;
}

// A rule's verb, as a requirement: "is at least" -> "must be at least",
// "does not contain" -> "must not contain", "has fewer than" -> "must
// have fewer than", "exists" -> "must exist".
function requirementVerb(verb) {
  if (/^is not\b/.test(verb)) return verb.replace(/^is not\b/, 'must not be');
  if (/^is\b/.test(verb)) return verb.replace(/^is\b/, 'must be');
  if (/^does not\b/.test(verb)) return verb.replace(/^does not\b/, 'must not');
  if (/^not\b/.test(verb)) return verb.replace(/^not\b/, 'must not');
  if (/^has\b/.test(verb)) return verb.replace(/^has\b/, 'must have');
  const [first, ...rest] = verb.split(' ');
  const base = /(ss|sh|ch|x)es$/.test(first) ? first.slice(0, -2) : first.replace(/s$/, '');
  return ['must', base, ...rest].join(' ');
}

// A condition as one plain sentence – the same words `conditionParts`
// hands the slice page's rule editor, joined into a string for a
// read-only overview that has nowhere to hang per-operand styling.
function ruleSentence(model, body, condition) {
  const p = conditionParts(condition, model, body);
  const quantifier = quantifierWords(model, body, condition);
  return (quantifier ? quantifier + ', ' : '') + p.left + ' ' + p.verb + (p.right ? ' ' + p.right : '');
}

function effectParts(effect) {
  // A top-level projection (`projectionsHandling`) is its own subject;
  // a grouped one is named through its group.
  const subject = effect.group
    ? memberWords(readable(effect.group), effect.property.name)
    : readable(effect.projection);
  // A scripted handler has no operation and no operand to name – the
  // code is both, and nothing here reads it.
  if (effect.handler.code !== undefined) {
    return { subject, verb: 'scripted', object: null };
  }
  return {
    subject,
    // The operation's own token, as the Code view spells it – see
    // _The interface register_ in docs/design-notes.md.
    verb: effect.handler.operation,
    object: operandWords(effect.handler.value),
  };
}

// A binding, in words: what it is and how the command found it.
function readParts(model, body, binding) {
  if (binding.projection) {
    const projection = projectionsOf(model)[binding.projection] || {};
    return {
      alias: binding.alias,
      projection: binding.projection,
      plural: false,
      // What it is read by – a value for each tag it declares, in the
      // command's scope or a literal with its type – and the values a
      // script's code reads besides.
      tags: readTagEntries(binding).map(([name, operand]) => ({
        name,
        operand,
        words: operandSource(operand) === 'tag-literal' ? operandText(operand) : operandWords(operand),
      })),
      arguments: projectionSlots(projection).map((p) => ({
        name: p.name,
        words: operandWords((binding.arguments || {})[p.name]),
      })),
    };
  }
  // A group alias: the instance its one tag picks, and nothing else –
  // arguments are given per member read, never to the group.
  const tags = readTagEntries(binding);
  return {
    alias: binding.alias,
    group: binding.group,
    plural: isFannedOut(model, body, binding),
    from: tags.length ? operandWords(tags[0][1]) : '?',
    tags: tags.map(([name, operand]) => ({
      name,
      operand,
      words: operandSource(operand) === 'tag-literal' ? operandText(operand) : operandWords(operand),
    })),
    arguments: [],
  };
}

// The type a member or projection holds, written the way a reader
// reads it. `propertyType` on anything that declares one (an event
// field, a command input, a composite's field); `valueType` on a
// projection – the two never both appear on one object.
function typeLabel(member) {
  const type = member.propertyType !== undefined ? member.propertyType : member.valueType;
  return `${type}${member.isList ? '[]' : ''}${member.isOptional ? '?' : ''}`;
}

// ---------- what a thing looks like ----------
//
// A group is named in a dozen places – the projections list, a read, a
// change – and a page with five kinds of thing on it is scanned by
// shape long before it is read by name. So a group carries one mark,
// and the mark goes wherever the group does.
//
// A group's mark is authored and only authored. An unmarked group
// carries no glyph: a hashed stand-in was tried and did not earn its
// place – a shape nobody chose says nothing about the thing, so every
// page paid a column of noise for a legibility that never arrived. What
// the picker offers is `ICON_CHOICES` (index.html).
//
// Commands and events are the exception: an unmarked one shows its
// kind's mark (`COMMAND_FALLBACK_ICON`, `EVENT_FALLBACK_ICON`) – one
// mark per kind, not per name, so it says only what the thing is. The
// glyph carries the meaning (an intent pushed in, something that
// happened) and the stylesheet the colour: a plain text glyph takes
// the colour of what it sits in, and `fallbackIconClass` lets a slot
// that is not already kind-coloured paint it. It is a rendering, never
// stored: the code view and the wire format see only an authored icon.

// The icon a body actually carries, or '' when it carries none worth
// showing – the one place the trim-or-fall-back rule lives.
function chosenIcon(model, collection, name) {
  const body = model && model[collection] ? model[collection][name] : null;
  return body && typeof body.icon === 'string' ? body.icon.trim() : '';
}

// A mark in front of a label, for the places that build one string
// rather than two elements. Unmarked things are the common case now, so
// the separator belongs to the mark and not to the label – otherwise
// every unmarked name renders behind a space nobody can see but every
// alignment can.
function iconPrefix(icon, separator) {
  return icon ? icon + (separator === undefined ? ' ' : separator) : '';
}

function groupIcon(model, name) {
  return chosenIcon(model, 'group-definitions', name);
}

const COMMAND_FALLBACK_ICON = '➜';
const EVENT_FALLBACK_ICON = '↯';

// The class a mark's element takes when the mark is a kind's fallback.
// An authored icon that happens to be the same glyph reads the same,
// which is what it looks like anyway.
function fallbackIconClass(icon) {
  if (icon === COMMAND_FALLBACK_ICON) return ' fallback-command';
  if (icon === EVENT_FALLBACK_ICON) return ' fallback-event';
  return '';
}

function commandIcon(model, name) {
  return chosenIcon(model, 'command-definitions', name) || COMMAND_FALLBACK_ICON;
}

// Every command that publishes this event – usually none or one, since
// every shipped example records one event per command, but nothing
// stops two commands recording the same fact.
function commandsPublishing(model, eventName) {
  return Object.entries(model['command-definitions'] || {})
    .filter(([, body]) => (body.publishes || []).some((emission) => emission.name === eventName))
    .map(([name]) => name);
}

function eventIcon(model, name) {
  const chosen = chosenIcon(model, 'event-definitions', name);
  if (chosen) return chosen;
  // Unmarked, and the outcome of exactly one command: read as that
  // command's doing, the same mark and all – a modeler who wants this
  // event to look like its own thing gives it its own icon, same as
  // always. Only an *authored* command mark is borrowed – the command's
  // fallback would make the event read as a command. Two commands
  // recording the same event agree on nothing, so that case falls back.
  const commands = commandsPublishing(model, name);
  const borrowed = commands.length === 1 ? chosenIcon(model, 'command-definitions', commands[0]) : '';
  return borrowed || EVENT_FALLBACK_ICON;
}

// Shown beside the type, never behind a gate: a value
// arrived at by code, or worked out from other projections, is a
// different kind of claim from one arrived at by a declaration, and a
// rule reading it should say so on the page.
function scriptLabel(property) {
  if (property && property.script) return 'scripted';
  if (property && property.derived) return 'derived';
  return null;
}

// The payload as operand choices, expanded one level into composite
// fields. A composite is offered whole *and* field by field: the whole
// value is what an emission wants, a field is what a boundary binding
// or a rule wants.
function payloadChoices(model, payload) {
  const out = [];
  for (const p of payload || []) {
    const label = 'given · ' + propertyWords(p.name);
    const fields = compositeFieldsOf(model, p.propertyType);
    if (!fields) {
      out.push([JSON.stringify({ parameterName: p.name }), label]);
      continue;
    }
    out.push([JSON.stringify({ parameterName: p.name }), label + ' (all of it)']);
    for (const f of fields) {
      out.push([
        JSON.stringify({ parameterName: p.name, property: f.name }),
        `${label} · ${propertyWords(f.name)}`,
      ]);
    }
  }
  return out;
}

// The quantifier a condition carries but never states. A fanned-out
// alias makes it universal; an operand rooted at the same list makes
// the pairing by index. Both follow from the operands' types, so the
// reader is told rather than left to work it out.
function quantifierWords(model, body, condition) {
  const roots = conditionFanRoots(model, body, condition);
  if (roots.length !== 1) return '';
  const operands = conditionOperands(condition);
  if (operands.some((o) => isZipped(model, body, condition, o))) {
    return `for each entry of ${roots[0].replace(/^parameter:/, '')}`;
  }
  const alias = operands.find((o) =>
    operandSource(o) === 'alias-property' && fanRootOf(model, body, o) === roots[0]);
  return `for every ${alias ? alias.alias : roots[0].replace(/^binding:|^parameter:/, '')}`;
}
