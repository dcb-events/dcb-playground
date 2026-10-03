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
  const store = new Map();
  const sandbox = {
    console,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
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
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: noop,
    TextEncoder, TextDecoder, URL, Blob: class {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = noop;
  vm.createContext(sandbox);
  return { sandbox, store };
}

// The page's own inline script — the long block; the short ones are
// the tiny loaders that pull in the files `loadApp` concatenates.
function pageScript() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  return blocks.sort((a, b) => b.length - a.length)[0];
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

// `check` records, `eq` asserts, `finish` prints the tally and sets
// the exit code. `check` follows its function: a sync body is recorded
// on the spot, an async one when it settles — one pair for all four
// suites, awaited only where a suite is actually async.
function makeChecker() {
  let passed = 0;
  const failures = [];
  const record = (name, error) => {
    if (error) failures.push(`${name}\n    ${error.message}`);
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
    console.log(`${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log('\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
      process.exit(1);
    }
  };
  return { check, eq, finish };
}

module.exports = { createSandbox, loadApp, makeChecker, textOf, findAll };
