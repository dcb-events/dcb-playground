// ============================================================
// Shared harness for the four suites. The DOM stub is the contract
// between index.html and the tests — it lives here once, so ui and
// webmcp cannot drift onto different fakes — and the loader is the
// one place that knows how the browser concatenates the scripts.
//
// Plain Node, `require`d by the suites; not a runner and not a
// dependency, same as the app's own no-build stance.
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;
const noop = () => {};

// Inert in every way but two: a node remembers the text it was made
// with and what has been appended to it, so a test can ask what a row
// actually says rather than only that building it did not throw.
const element = (text, tag) => {
  const node = {
    tag: tag || '',
    nodeText: text === undefined ? '' : String(text),
    appendChild(child) { if (child) node.children.push(child); return child; },
    insertBefore(child) { if (child) node.children.unshift(child); return child; },
    get firstChild() { return node.children[0] || null; },
    removeChild: noop, remove: noop,
    // Recorded, not rendered — so a test can ask what an attribute
    // (an optgroup's label, a title) was set to. `label` doubles as a
    // property the way it does on a real element.
    setAttribute(k, v) { node.attributes[k] = v; if (k === 'label') node.label = v; },
    attributes: {},
    addEventListener: noop, removeAttribute: noop, focus: noop, blur: noop,
    scrollIntoView: noop, contains: () => false, closest: () => null,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {}, dataset: {}, children: [], childNodes: [],
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };
  return node;
};

// Everything a node and its descendants read as, in order.
const textOf = (node) => (node.nodeText || '')
  + (node.children || []).map(textOf).join('');

// Every node in a tree that matches, in document order.
const findAll = (node, pred, out = []) => {
  if (pred(node)) out.push(node);
  for (const child of node.children || []) findAll(child, pred, out);
  return out;
};

// The context a suite runs the app in: stubbed storage over a Map,
// the inert DOM, and the browser globals the page reaches for at
// load. Every lookup answers with an inert element rather than null:
// the page wires a handful of listeners at load, and a stub that said
// "not there" would only be testing that. Nothing runs at load beyond
// that — the app boots on DOMContentLoaded, and this never fires one.
function createSandbox() {
  const storage = (map) => ({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  });
  const store = new Map();
  const sessionStore = new Map();
  // What the page listens for on `window`, kept so a suite can play the
  // part of the browser — another tab's `storage` event, say.
  const listeners = {};
  const sandbox = {
    console,
    localStorage: storage(store),
    sessionStorage: storage(sessionStore),
    document: {
      createElement: (t) => element(undefined, t), createTextNode: (t) => element(t), body: element(),
      documentElement: element(),
      getElementById: () => element(),
      querySelector: () => element(),
      querySelectorAll: () => [],
      addEventListener: noop,
    },
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState: noop },
    navigator: { clipboard: {} },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    // The page's own timers (a toast's 8 s dismissal) are unref'd: no
    // suite waits on one, and a live one only kept Node idling after
    // the tally. `finish` guards the other side — see makeChecker.
    setTimeout: (fn, ms, ...rest) => {
      const timer = setTimeout(fn, ms, ...rest);
      if (timer && timer.unref) timer.unref();
      return timer;
    },
    clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: noop,
    TextEncoder, TextDecoder, URL, Blob: class {},
    // What `e.target instanceof Element` asks of a key event's target;
    // the inert nodes are not instances, so a stub target is no field.
    Element: class {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  sandbox.window.removeEventListener = (type, fn) => {
    listeners[type] = (listeners[type] || []).filter((other) => other !== fn);
  };
  vm.createContext(sandbox);
  const dispatch = (type, event) => { for (const fn of listeners[type] || []) fn(event); };
  const listening = (type) => (listeners[type] || []).length;
  return { sandbox, store, sessionStore, dispatch, listening };
}

// The page's own inline script, marked `data-page` — named rather than
// guessed at, since the host injects inline scripts of its own (the
// theme hook) and any other inline block would be a candidate too.
function pageScript() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script data-page>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length !== 1) throw new Error(`index.html: expected one <script data-page>, found ${blocks.length}`);
  return blocks[0];
}

// Concatenates the way index.html loads: the named files in <script>
// order, then (when asked) the inline page script, then a trailer for
// what a suite needs handed out of the script's lexical scope. One
// script, one scope — the same as classic scripts sharing a window.
function loadApp(sandbox, files, { withPage = false, trailer = '' } = {}) {
  const source = files
    .map((file) => fs.readFileSync(path.join(APP, file), 'utf8'))
    .concat(withPage ? [pageScript()] : [])
    .concat(trailer ? [trailer] : [])
    .join('\n;\n');
  vm.runInContext(source, sandbox, { filename: 'app.js' });
}

// A fixture edit that must land. `String.replace` on a text that no
// longer contains its target returns the text unchanged, and the test
// goes on asserting about an edit that never happened — which is how a
// renamed section comment once left a completion test checking
// nothing. Every edit of a fixture text goes through here; the
// pre-commit hook refuses a bare `.replace(` on one.
function swap(text, from, to) {
  const found = typeof from === 'string' ? text.includes(from) : new RegExp(from.source, from.flags.replace('g', '')).test(text);
  if (!found) throw new Error(`swap: the fixture does not contain ${typeof from === 'string' ? JSON.stringify(from) : from}`);
  return text.replace(from, to);
}

// `check` records, `eq` asserts, `finish` prints the tally and sets
// the exit code. `check` follows its function: a sync body is recorded
// on the spot, an async one when it settles — one pair for all four
// suites, awaited only where a suite is actually async.
function makeChecker() {
  let passed = 0;
  const failures = [];
  // Page timers do not hold the process open (createSandbox), so a
  // suite that awaited one would end without its tally — and with a
  // zero exit. Ending without `finish` is a failure.
  let finished = false;
  process.on('exit', (code) => {
    if (!finished && code === 0) {
      console.log('the suite ended before finish() — an awaited page timer?');
      process.exitCode = 1;
    }
  });
  // STACK=1 in the environment reports a failure with its stack — for
  // the TypeError deep in a fold, where the message alone says little.
  const record = (name, error) => {
    if (error) failures.push(`${name}\n    ${process.env.STACK ? error.stack : error.message}`);
    else passed += 1;
  };
  const check = (name, fn) => {
    try {
      const out = fn();
      if (out && typeof out.then === 'function') {
        return out.then(() => record(name), (error) => record(name, error));
      }
      record(name);
    } catch (error) {
      record(name, error);
    }
    return undefined;
  };
  const eq = (actual, expected, what) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${what || 'value'}: expected ${b}, got ${a}`);
  };
  const finish = () => {
    finished = true;
    console.log(`${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
      process.exit(1);
    }
  };
  return { check, eq, finish };
}

module.exports = { createSandbox, loadApp, makeChecker, swap, textOf, findAll };
