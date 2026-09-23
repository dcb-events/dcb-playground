// ============================================================
// Everything the interface needs that is not the model: DOM helpers,
// the simple / advanced mode, and the *slice* view — everything one
// command touches, gathered here so the page never has to walk the
// definition graph itself.
//
// The slice is the idea the page is built around: a command, what it
// reads, in how many trips to the log, what it decides, what it emits,
// and what those events change. The model layer stores none of that as
// a unit; it is derived here, from the definitions. The overview pages
// read the same material across every command at once — the coupling
// matrix, and each entity's status as a lifecycle machine — and those
// derivations live here too.
// ============================================================

// ---------- DOM ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el[k.toLowerCase()] = v;
    else if (k === 'value') el.value = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
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
// scripted handler — but what its code can *see* is still knowable
// from the definitions. This turns that knowledge into TypeScript: a
// synthesized preamble typing `state`, `event` and `args` for one
// handler, fed to Monaco (the app's one vendored dependency, pinned
// by generate-vendor-monaco.js) so typing gets completion, hover and
// squiggles that actually understand the model.
//
// The synthesis is the tested part, and it is pure. The choices it
// bakes in:
//   - every named scalar custom type is *branded* (`string & { __type:
//     'CourseId' }`), so comparing a CourseId to a StudentId — or to a
//     bare string literal — draws the no-overlap squiggle;
//   - enums become literal unions, so `===` completes the legal values;
//   - `state` is inferred from the initial state but stays *loose*
//     (`& { [key: string]: any }` at every level), because a script
//     may legitimately grow keys the initial state never had;
//   - a dangling type or event reference types as `any` — a defective
//     model must still load and edit, the same rule as everywhere.
//
// Each handler's preamble is its own file-scope (`export {};` makes
// the model a module), which is what lets several editors with
// different `event` types coexist in one TypeScript project. The
// preamble ends by opening a `__check(` call whose parameter is what
// a handler must return — the projection's value type (through
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
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// A value's own JSON, safe inside the /** … */ it is hinted in.
function scriptTsHint(value) {
  const text = String(JSON.stringify(value)).replace(/\*\//g, '*\\/');
  return text.length > 32 ? text.slice(0, 31) + '…' : text;
}

// The TypeScript shape of a JSON value — how `state` is typed from
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
// return position, so brands widen to their bases — an expression can
// compare branded values it was given, but never mint one — while
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
  // Where the projection starts is also a legal thing to hand back — a
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
    if (body === undefined || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(typeName)) return 'any';
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
    eventLines.push('declare const event: {');
    eventLines.push('  type: ' + JSON.stringify(handler.event) + ';');
    eventLines.push('  data: {');
    for (const property of event.properties || []) {
      if (property.isOptional) {
        eventLines.push('    /** optional — null when the event carries no value */');
      } else if (property.propertyType === 'integer') {
        eventLines.push('    /** integer */');
      }
      eventLines.push('    ' + scriptTsKey(property.name) + ': ' + propertyType(property) + ';');
    }
    eventLines.push('  };');
    eventLines.push('};');
  } else {
    eventLines.push('declare const event: { type: string; data: { [key: string]: any } };');
  }

  const argFields = (script.arguments || []).filter((argument) => argument && argument.name);
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
// repaints — the page state holds it) plus the handler's index.
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
  // No real head to load into (the test stub) — the textarea is it.
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
  // version is pinned. Without it the wrapper lines stay visible —
  // degraded, not broken.
  const hideWrapper = (force) => {
    if (typeof editor.setHiddenAreas !== 'function') return;
    // setValue drops the view's hidden areas while the widget keeps
    // its cached ranges, so re-applying identical ranges is swallowed
    // as a no-op — clear first when the model was reloaded wholesale.
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
  // taken them in, and how soon that is is not promised — measure a
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
    // setValue parks the cursor at 1:1 — inside the hidden preamble,
    // where typing would land invisibly. Park it at the code's end.
    const lastCodeLine = model.getLineCount() - 1;
    editor.setPosition({ lineNumber: lastCodeLine, column: model.getLineMaxColumn(lastCodeLine) });
    resizeSoon();
    entry.loading = false;
  };

  // The wrapper is hidden, not protected — a select-all delete can
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
  // wrapper — Backspace at the code's first character, Delete at its
  // last — simply do nothing, the same as at a document edge.
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

// ---------- simple / advanced ----------
//
// Advanced hides nothing structural — it only decides whether the parts
// a first model never needs are on screen: identifier schemas, custom
// types, projections, and the derived consistency boundary.
//
// How it is offered is the page's business, not this file's: it is one
// of the interface's own settings, and they are collected in one place
// rather than scattered along the top of the window.

const MODE_KEY = 'dcb-playground:mode';
function mode() { return localStorage.getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'simple'; }
function advanced() { return mode() === 'advanced'; }
function setMode(next) { localStorage.setItem(MODE_KEY, next); if (typeof render === 'function') render(); }

// ---------- light / dark ----------
//
// Defaults to whatever the system says, same as any other well-behaved
// page; Settings can override that per browser. `isDark` is the one
// question the rest of the page asks — nothing downstream needs to know
// whether that answer came from the system or from a stored choice.

const THEME_KEY = 'dcb-playground:theme';
function theme() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
function setTheme(next) { localStorage.setItem(THEME_KEY, next); if (typeof render === 'function') render(); }
function isDark() {
  const t = theme();
  if (t !== 'system') return t === 'dark';
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
// Only "system" cares about this firing — an explicit choice already
// repaints itself the moment it is made.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme() === 'system' && typeof render === 'function') render();
  });
}

// ---------- which model is open ----------

const MODEL_KEY = 'dcb-playground:model';

// `null` is a real answer here, not an edge case to work around: a
// browser that has never loaded anything has nothing stored, and the
// Models modal is what asks the question rather than the page silently
// picking an example on someone's behalf.
function activeModelId() {
  const stored = localStorage.getItem(MODEL_KEY);
  return stored && projectState()[stored] ? stored : null;
}
function activeModel() {
  const id = activeModelId();
  return id ? projectState()[id] : null;
}

// A model with nothing in it at all — no entities, no events, no
// commands. Everything downstream has to cope with that, because it is
// where a real model actually starts.
//
// The name is collected by the page (there are no browser dialogs in
// here); this only does the creating.
//
// `openNewModel` is the unwrapped core — one definition of what
// opening a fresh model means — shared with the WebMCP `start_model`
// tool, which needs the refusal to reach the agent rather than only
// the toast `run` turns it into.
function openNewModel(name) {
  const id = createDcbModel(name);
  localStorage.setItem(MODEL_KEY, id);
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
// demand. Both carry the same envelope — see `buildShareEnvelope` in
// model.js. Compression is the native Streams API only, matching the
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

async function gunzipFromBase64Url(encoded) {
  const stream = new Blob([base64UrlDecode(encoded)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
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

// A URL someone else hosts — a gist, a bucket, another tool's export.
// `fetch` only auto-decompresses a gzip `Content-Encoding`; a file whose
// *content type* says gzip (a plain `.json.gz` sitting on a static
// host) arrives untouched over the wire and has to be inflated by hand.
async function loadModelFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = response.headers.get('Content-Type') || '';
  const text = contentType.includes('gzip')
    ? await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text()
    : await response.text();
  return JSON.parse(text);
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

// Every entity property that handles this event — i.e. everything the
// event changes. This is the link the original interface made you go
// and find for yourself, one entity at a time.
//
// A property is a binding, so what handles the event is the projection
// behind it; `property` carries both halves, since a reader wants the
// name the entity calls it and the fold that answers for it.
function effectsOf(model, eventName) {
  const out = [];
  for (const [entityName, entity] of Object.entries(model['entity-definitions'])) {
    for (const binding of entity.properties || []) {
      const projection = model['projection-definitions'][(binding || {}).projection];
      for (const handler of (projection && projection.handlers) || []) {
        if (handler && handler.event === eventName) {
          out.push({
            entity: entityName,
            property: { ...binding, ...projection },
            projectionName: binding.projection,
            handler,
          });
        }
      }
    }
  }
  return out;
}

// Every command that publishes this event — zero, one, or many. An
// event has no single owner the way an entity does, so this answers
// "who records this" instead of a boundary binding.
function publishersOf(model, eventName) {
  const out = [];
  for (const [name, body] of Object.entries(model['command-definitions'])) {
    for (const emission of body.publishes || []) {
      if (emission && emission.name === eventName) out.push({ command: name, emission });
    }
  }
  return out;
}

// Every projection that handles this event and is *not* bound as some
// entity's property — the ones `effectsOf` does not already name,
// listed beside it rather than twice.
function projectionsHandling(model, eventName) {
  const out = [];
  for (const [name, body] of Object.entries(model['projection-definitions'])) {
    if (boundAs(model, name).length) continue;
    for (const handler of body.handlers || []) {
      if (handler && handler.event === eventName) out.push({ projection: name, body, handler });
    }
  }
  return out;
}

// Every entity property binding this projection — `{entity, property}`
// each. Empty for one no entity binds, which is what everywhere else
// calls a standalone projection.
function boundAs(model, projectionName) {
  const out = [];
  for (const [entityName, entity] of Object.entries(model['entity-definitions'])) {
    for (const binding of entity.properties || []) {
      if (binding && binding.projection === projectionName) {
        out.push({ entity: entityName, property: binding.name });
      }
    }
  }
  return out;
}

// Every scenario — over a command or over projections — whose Given or
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
    })),
    projections: projectionsRead(body),
    // Grouped by the trip to the store each read actually happens on,
    // which is the depth of the boundary's dependency graph and not
    // its length. Derived here so nothing has to author it.
    rounds: deriveRounds(body),
    dcb: deriveDcb(model, body),
    coverage: coverageIssues(model, body),
  };
}

function allSlices(model) {
  return Object.keys(model['command-definitions']).map((n) => sliceOf(model, n));
}

// ---------- coupling ----------
//
// Every command against every event type it writes (`publishes`) or
// reads back to decide — the same relationship each command's own page
// already shows one at a time (its derived boundary), gathered once
// into a matrix. "Consumes" is read straight off `deriveDcb`: an event
// type is in a command's boundary the moment some read property's
// handler names it, whether or not that command ever publishes it —
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
    const entity = binding && model['entity-definitions'][binding.entity];
    for (const eventType of item.types) {
      if (!via[eventType]) via[eventType] = new Set();
      if (item.projection) {
        via[eventType].add(readable(item.projection));
        continue;
      }
      const sources = (item.readProperties || []).filter((propName) => {
        const projection = entity && entityPropertyTarget(model, binding.entity, propName).projection;
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
// The matrix as a plain undirected graph — one node per command and
// per event, an edge wherever a cell has any coupling at all (produce
// or consume; direction does not matter for reachability). Two things
// fall out of that graph for free: which commands and events could be
// lifted into their own bounded context together (a connected
// component), and which single command or event is the one thing
// still holding two such components together (an articulation point —
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
// `nodeOrder` first meets each component — so the numbering is stable
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
// discovery/low-link DFS — recursive, since a DCB model's coupling
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
// and, within a cluster, the most-coupled things — the likeliest
// bridges — settle toward the far edge. Clusters are numbered by size,
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
// Each entity's status read as a state machine. Nothing here is
// authored — every part is derived from definitions that already
// exist, through the convention `model.js` documents: a lifecycle is
// an ordinary enum custom type plus an ordinary property named
// `status`.
//
//   states       the members of the enum typing the status property;
//   transitions  the status projection's declared handlers — a handler
//                that sets a member is an arrow into that member, and
//                the arrow starts wherever the commands publishing its
//                event are allowed to run;
//   commands     every command binding the entity, placed by its
//                status conditions.
//
// A command with no condition over a status it touches is *unguarded*:
// nothing refuses it at any state. That is a fact worth surfacing, not
// papering over — an unguarded transition is drawn from the initial
// state only as a convention, and flagged as such, so a missing guard
// stays visible.

// The states `body`'s conditions allow `entityName`'s status to be in,
// read off every `alias · status equals <member>` condition over an
// alias binding the entity — the same comparison shape the
// enum-membership advisory reads (either side may hold the status).
// `states: null` means unguarded: the command binds the entity but no
// condition constrains its status. Only identity is readable this way,
// negated or not: `equals` against a member reference, and `equalsAny`
// against a list whose every entry is one — a bare literal in the list
// makes it unreadable, not guessed at. Any other predicate over the
// status leaves the command unguarded rather than guessed at. Several
// conditions (or several aliases) intersect: each is one more thing
// that must hold.
function statusConstraint(model, body, entityName, states) {
  const aliases = new Set((body.boundary || [])
    .filter((binding) => binding && binding.entity === entityName)
    .map((binding) => binding.alias));
  if (!aliases.size) return { binds: false, states: null };
  let allowed = null;
  for (const condition of body.conditions || []) {
    for (const side of ['leftHandSide', 'rightHandSide']) {
      const operand = condition[side];
      if (operandSource(operand) !== 'alias-property') continue;
      if (!aliases.has(operand.alias) || operand.property !== STATUS_PROPERTY) continue;
      const other = condition[side === 'leftHandSide' ? 'rightHandSide' : 'leftHandSide'];
      let these = null;
      if (condition.predicate === 'equals' && operandSource(other) === 'enum-member') {
        these = condition.negate
          ? states.filter((member) => member !== other.enumMember)
          : states.filter((member) => member === other.enumMember);
      } else if (condition.predicate === 'equalsAny' && Array.isArray(other)
          && other.every((entry) => operandSource(entry) === 'enum-member')) {
        // An empty list is still read: "one of nothing" allows no
        // state, which is what it evaluates to — unreadable would
        // claim the opposite.
        const listed = other.map((entry) => String(entry.enumMember));
        these = condition.negate
          ? states.filter((member) => !listed.includes(member))
          : states.filter((member) => listed.includes(member));
      }
      if (these === null) continue;
      allowed = allowed === null ? these : allowed.filter((member) => these.includes(member));
    }
  }
  return { binds: true, states: allowed };
}

// Every entity's machine, plus the entities that do not yield one and
// why — an entity without the convention is not an error, it is simply
// not on this page, and the page should say so rather than silently
// thin out.
//
// Per machine:
//   states / initial      off the enum and the projection's initial
//                         value;
//   transitions           `{event, target, publishers, sources,
//                         unguarded, conventional}` — `sources` is the
//                         union of the publishing commands' allowed
//                         states; a transition only unguarded
//                         publishers reach is drawn from the initial
//                         state (`conventional: true`);
//   perState              state -> the commands allowed there, each
//                         `{command, movesTo, unguarded}`;
//   terminal              states no drawn transition leaves — with the
//                         conventional arrows counted, so "terminal"
//                         matches what the page draws;
//   opaque                events whose handler touches the status in a
//                         way this cannot read (a computed value, an
//                         operation other than `set`).
function lifecycleMachines(model) {
  const machines = [];
  const excluded = [];
  for (const entityName of Object.keys(model['entity-definitions'])) {
    const { binding, projection } = entityPropertyTarget(model, entityName, STATUS_PROPERTY);
    if (!binding || !projection) { excluded.push({ entity: entityName, reason: 'no-status' }); continue; }
    if (scriptOf(projection)) { excluded.push({ entity: entityName, reason: 'scripted' }); continue; }
    const members = enumMembersFor(model, projection.valueType);
    if (!members) { excluded.push({ entity: entityName, reason: 'not-enum' }); continue; }
    const states = members.map(String);

    const initial = operandSource(projection.initialValue) === 'enum-member'
      && states.includes(projection.initialValue.enumMember)
      ? projection.initialValue.enumMember : null;

    const transitions = [];
    const opaque = [];
    for (const handler of projection.handlers || []) {
      if (!handler || !handler.event) continue;
      if (handler.operation !== 'set' || operandSource(handler.value) !== 'enum-member') {
        opaque.push(handler.event);
        continue;
      }
      const target = handler.value.enumMember;
      const publishers = publishersOf(model, handler.event).map(({ command }) => ({
        command,
        sources: statusConstraint(model, model['command-definitions'][command], entityName, states).states,
      }));
      const sources = [...new Set(publishers.flatMap((p) => p.sources || []))];
      const unguarded = publishers.some((p) => p.sources === null);
      const conventional = !sources.length && unguarded && initial !== null && initial !== target;
      transitions.push({
        event: handler.event, target, publishers, unguarded, conventional,
        sources: conventional ? [initial] : sources,
        unpublished: !publishers.length,
      });
    }

    const perState = {};
    for (const state of states) perState[state] = [];
    for (const [commandName, body] of Object.entries(model['command-definitions'])) {
      const constraint = statusConstraint(model, body, entityName, states);
      if (!constraint.binds) continue;
      const moved = transitions.find((t) =>
        (body.publishes || []).some((emission) => emission && emission.name === t.event));
      const entry = {
        command: commandName,
        movesTo: moved ? moved.target : null,
        unguarded: constraint.states === null,
      };
      for (const state of constraint.states === null ? states : constraint.states) {
        perState[state].push(entry);
      }
    }

    const leads = new Set();
    for (const t of transitions) {
      for (const from of t.sources) if (from !== t.target) leads.add(from);
    }

    machines.push({
      entity: entityName,
      property: STATUS_PROPERTY,
      projection: binding.projection,
      valueType: projection.valueType,
      states, initial, transitions, opaque, perState,
      terminal: states.filter((state) => !leads.has(state)),
    });
  }
  return { machines, excluded };
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
// waiting for one, then the catch-all — so the rail never reshuffles
// under you as you edit. *Within* a feature the commands sit
// alphabetically, by the name they are shown under: a command's place
// in a group carries no meaning, so a fixed order beats an accidental
// one — and it is what lets dropping a command anywhere in a group
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

// Events no feature emits, and entities nothing reads — the loose ends
// a command-centred view would otherwise hide.
function orphans(model) {
  const emitted = new Set();
  const boundEntities = new Set();
  for (const body of Object.values(model['command-definitions'])) {
    for (const e of body.publishes || []) emitted.add(e.name);
    for (const b of body.boundary || []) boundEntities.add(b.entity);
  }
  return {
    events: Object.keys(model['event-definitions']).filter((n) => !emitted.has(n)),
    entities: Object.keys(model['entity-definitions']).filter((n) => !boundEntities.has(n)),
  };
}

// Everything that happens to one property: which features move it, and
// which features consult it. The inspector needs both halves to answer
// "is this still earning its place?".
function propertyUsage(model, entityName, propertyName) {
  const { binding, projection } = entityPropertyTarget(model, entityName, propertyName);
  // `property` is what a caller renders: the binding's name over the
  // bound projection's shape, which between them is everything the old
  // single definition carried.
  const property = binding ? { ...binding, ...(projection || {}) } : undefined;
  const changedBy = [];
  const readBy = [];
  for (const [command, body] of Object.entries(model['command-definitions'])) {
    for (const emission of body.publishes || []) {
      const handler = ((projection && projection.handlers) || []).find((x) => x.event === emission.name);
      if (handler) changedBy.push({ command, event: emission.name, handler });
    }
    const aliases = (body.boundary || []).filter((b) => b.entity === entityName).map((b) => b.alias);
    let reads = false;
    forEachCommandOperand(body, (operand) => {
      if (operandSource(operand) === 'alias-property'
          && aliases.includes(operand.alias) && operand.property === propertyName) reads = true;
    });
    if (reads) readBy.push(command);
  }
  return { property, binding, projection, changedBy, readBy };
}

// Which commands read a projection, however they reach it: directly by
// name when nothing binds it, and through an entity alias when
// something does. One question rather than two, because a projection
// does not know which of the two it is — that is the whole point of a
// property being a binding.
function projectionReaders(model, projectionName) {
  const owners = boundAs(model, projectionName);
  const readers = [];
  for (const [command, body] of Object.entries(model['command-definitions'])) {
    let reads = (body.boundary || []).some((b) => b.projection === projectionName);
    if (!reads) {
      // Every (alias, property) pair that lands on this projection: an
      // alias bound to an entity that calls it something, under the
      // name that entity calls it.
      const pairs = new Set();
      for (const binding of body.boundary || []) {
        if (!binding.entity) continue;
        for (const owner of owners) {
          if (owner.entity === binding.entity) pairs.add(binding.alias + '\0' + owner.property);
        }
      }
      forEachCommandOperand(body, (operand) => {
        if (operandSource(operand) === 'alias-property'
            && pairs.has(operand.alias + '\0' + operand.property)) reads = true;
      });
    }
    if (reads) readers.push(command);
  }
  return readers;
}

// ---------- names ----------
//
// A modeler types "define course"; the model stores `DefineCourse`. The
// PascalCase is the schema's business, not the author's, so it is
// derived on the way in and unwound on the way out. Advanced mode shows
// the stored identifier beside the label for anyone who wants it.

function toPascal(label) {
  return String(label || '').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

function toCamel(label) {
  const pascal = toPascal(label);
  return pascal ? pascal[0].toLowerCase() + pascal.slice(1) : '';
}

function splitWords(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/).filter(Boolean);
}

// `CourseDefined` -> "Course defined". For things with a name of their
// own: a command, an event, an entity, a value type, a status.
function readable(name) {
  const words = splitWords(name);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
}

// `courseId` -> "course id". For the things that belong to something
// else — a property, a parameter, a field. They are never capitalised,
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
// suggestion — it is offered in an editable field, never imposed.
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
  // `equalsAny`'s literal list — the entries, said in order.
  if (Array.isArray(operand)) {
    return operand.length ? operand.map(operandWords).join(', ') : 'an empty list';
  }
  switch (operandSource(operand)) {
    case 'alias-property':
      // No property means a bound projection's single value, which the
      // alias already names.
      if (!operand.property) return propertyWords(operand.alias);
      return memberWords(operand.alias, operand.property);
    case 'parameter':
      return operand.property
        ? memberWords(propertyWords(operand.parameterName), operand.property)
        : propertyWords(operand.parameterName);
    case 'enum-member': return readable(operand.enumMember);
    case 'event-property': return propertyWords(operand.eventProperty);
    case 'current-value': return 'its current value';
    case 'successor': return `the one after ${operandWords(operand.successor)}`;
    // A derived predicate's read of another projection. The arguments
    // are not said — the partition is shared, and the editor is where
    // it is spelled out.
    case 'projection-read': return readable(operand.projection || '?');
    default:
      if (typeof operand === 'string') return `"${operand}"`;
      // A record a scripted projection folded to is a static value
      // with no operand shape — it reads as the JSON it is rather
      // than as "[object Object]".
      if (operand !== null && typeof operand === 'object') return JSON.stringify(operand);
      return String(operand);
  }
}

// Where a projection starts, as a reader reads it.
//
// `null` says *nothing yet* and never renders as a blank: a value that
// has not arrived is a different answer from the empty string, and a
// page that showed both as nothing would be lying about one of them.
// An empty string is quoted for the same reason — so it is visibly a
// value rather than an absence.
function initialValueWords(value) {
  if (value === null || value === undefined) return 'nothing yet';
  if (Array.isArray(value)) {
    return value.length ? value.map(operandWords).join(', ') : 'an empty list';
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
// operands without re-parsing the text.
function conditionParts(condition) {
  const words = PREDICATE_WORDS[condition.predicate] || [condition.predicate, 'not ' + condition.predicate];
  const verb = words[condition.negate ? 1 : 0];
  const left = operandWords(condition.leftHandSide);
  if (condition.rightHandSide === undefined) return { left, verb, right: null };
  return { left, verb, right: operandWords(condition.rightHandSide) };
}

// A condition as one plain sentence — the same words `conditionParts`
// hands the slice page's rule editor, joined into a string for a
// read-only overview that has nowhere to hang per-operand styling.
function ruleSentence(model, body, condition) {
  const p = conditionParts(condition);
  const quantifier = quantifierWords(model, body, condition);
  return (quantifier ? quantifier + ', ' : '') + p.left + ' ' + p.verb + (p.right ? ' ' + p.right : '');
}

const OPERATION_WORDS = {
  set: 'becomes', increment: 'goes up by', decrement: 'goes down by',
  append: 'gains', remove: 'loses',
};

function effectParts(effect) {
  // A scripted handler has no operation and no operand to name — the
  // code is both, and nothing here reads it.
  if (effect.handler.code !== undefined) {
    return {
      subject: memberWords(readable(effect.entity), effect.property.name),
      verb: 'is worked out by',
      object: 'a script',
    };
  }
  return {
    subject: memberWords(readable(effect.entity), effect.property.name),
    verb: OPERATION_WORDS[effect.handler.operation] || effect.handler.operation,
    object: operandWords(effect.handler.value),
  };
}

// A binding, in words: what it is and how the command found it.
function readParts(model, body, binding) {
  if (binding.projection) {
    const projection = model['projection-definitions'][binding.projection] || {};
    return {
      alias: binding.alias,
      projection: binding.projection,
      plural: false,
      // One entry per name the projection declares, in its order. For
      // a declared projection these arguments *are* the tags of its
      // query; for a scripted one they are values its code reads, and
      // the tags are stated in the script itself.
      arguments: ((projection.script ? projection.script.arguments : projection.parameters) || [])
        .map((p) => ({
          name: p.name,
          words: operandWords((binding.arguments || {})[p.name]),
        })),
    };
  }
  return {
    alias: binding.alias,
    entity: binding.entity,
    plural: isFannedOut(model, body, binding),
    from: operandWords(binding.id),
    excluding: binding.excluding !== undefined ? operandWords(binding.excluding) : null,
    // What the command hands a scripted property it reads.
    arguments: Object.entries(binding.arguments || {})
      .map(([name, operand]) => ({ name, words: operandWords(operand) })),
  };
}

// The type a member or projection holds, written the way a reader
// reads it. `propertyType` on anything that declares one (an event
// field, a command input, a composite's field); `valueType` on a
// projection — the two never both appear on one object.
function typeLabel(member) {
  const type = member.propertyType !== undefined ? member.propertyType : member.valueType;
  return `${type}${member.isList ? '[]' : ''}${member.isOptional ? '?' : ''}`;
}

// ---------- what a thing looks like ----------
//
// An entity is named in a dozen places — the rail, a read, a change, a
// loose end — and a page with five kinds of thing on it is scanned by
// shape long before it is read by name. So every entity carries one
// mark, and the mark goes wherever the entity does.
//
// It is authored rather than derived: only the modeler knows whether a
// Course is a book or a lecture hall. Until one is chosen a neutral
// glyph stands in — different per entity, so the page is legible
// straight away, but never claiming a meaning nobody gave it.
const ENTITY_MARKS = ['◆', '●', '■', '▲', '★', '◇', '○', '□', '△', '✦'];

// One hash for all three families: the mark is the identity of every
// unmarked glyph on the page, so entities, events and commands must
// shuffle the same way — a distribution fix applied to one kind and
// not the others would be a bug wearing a different mask per page.
function defaultMark(name, marks) {
  let sum = 0;
  for (const ch of String(name || '')) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return marks[sum % marks.length];
}

// The icon a body actually carries, or '' when it carries none worth
// showing — the one place the trim-or-fall-back rule lives.
function chosenIcon(model, collection, name) {
  const body = model && model[collection] ? model[collection][name] : null;
  return body && typeof body.icon === 'string' ? body.icon.trim() : '';
}

function defaultEntityIcon(name) {
  return defaultMark(name, ENTITY_MARKS);
}

function entityIcon(model, name) {
  return chosenIcon(model, 'entity-definitions', name) || defaultEntityIcon(name);
}

// An event earns the same legibility once it appears as more than a
// line of text — the sandbox lays a whole session out as a strip of
// these. But an event is a moment, not a thing, so its neutral mark
// comes from a different family than an entity's: a spark rather than
// a shape, so a page holding both never reads an unmarked glyph as the
// wrong kind of thing.
const EVENT_MARKS = ['✱', '✲', '✳', '✴', '✵', '✶', '✷', '✸', '✹', '✺'];

function defaultEventIcon(name) {
  return defaultMark(name, EVENT_MARKS);
}

// A command earns the same legibility, from a third family again — a
// tool, not a shape or a spark, since a page can hold all three kinds
// at once and an unmarked glyph should never read as the wrong one.
const COMMAND_MARKS = ['▶', '▷', '◈', '◉', '◐', '◑', '◒', '◓', '⬖', '⬗'];

function defaultCommandIcon(name) {
  return defaultMark(name, COMMAND_MARKS);
}

function commandIcon(model, name) {
  return chosenIcon(model, 'command-definitions', name) || defaultCommandIcon(name);
}

// Every command that publishes this event — usually none or one, since
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
  // command's doing by default, the same mark and all — a modeler who
  // wants this event to look like its own thing gives it its own icon,
  // same as always. Two commands recording the same event agree on
  // nothing this way, so that case falls back to the neutral mark.
  const commands = commandsPublishing(model, name);
  if (commands.length === 1) return commandIcon(model, commands[0]);
  return defaultEventIcon(name);
}

// Shown beside the type, never behind the Advanced gate: a value
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
