// ============================================================
// Rewrites app/vendor/monaco/ — the one vendored dependency.
//
// The scripted-projection editor is Monaco, pinned to the version
// below and trimmed to what the playground actually uses: the editor
// core, the TypeScript language support (which is what turns the
// synthesized per-handler type preamble into completion and
// squiggles), and the worker that runs it. Everything else in the
// distribution — other languages, other workers, translations,
// source maps — is deliberately not vendored.
//
// 0.52.2 is the last release with the classic AMD `min/vs` layout,
// which is why it is the pin: the app is classic scripts with no
// build step, and this build loads the same way the app does. Newer
// versions are ESM-chunked and deprecate that path; moving means
// revisiting how the editor is loaded, not just editing VERSION.
//
// Like every generated artifact here: regenerate, never hand-edit.
//
//   node app/generate-vendor-monaco.js
//
// Downloads from the npm registry, so it needs the network — but only
// when rerun, which is only on a version bump. The result is checked
// in; the app never fetches anything at runtime.
// ============================================================

const VERSION = '0.52.2';

// Paths inside the tarball's package/, mapped into vendor/monaco/.
// `min/` is stripped so the app addresses a stable `vendor/monaco/vs`.
const KEEP = [
  'LICENSE',
  'ThirdPartyNotices.txt',
  'min/vs/loader.js',
  'min/vs/editor/editor.main.js',
  'min/vs/editor/editor.main.css',
  'min/vs/base/worker/workerMain.js',
  'min/vs/base/browser/ui/codicons/codicon/codicon.ttf',
  'min/vs/language/typescript/tsMode.js',
  'min/vs/language/typescript/tsWorker.js',
  'min/vs/basic-languages/typescript/typescript.js',
  'min/vs/basic-languages/javascript/javascript.js',
];

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const OUT = path.join(__dirname, 'vendor', 'monaco');
const URL = `https://registry.npmjs.org/monaco-editor/-/monaco-editor-${VERSION}.tgz`;

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// A minimal ustar reader — the one format npm publishes. Yields
// { name, body } per regular file.
function* tarEntries(buffer) {
  let at = 0;
  while (at + 512 <= buffer.length) {
    const block = buffer.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    const field = (start, length) =>
      block.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    const prefix = field(345, 155);
    const name = (prefix ? prefix + '/' : '') + field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    at += 512;
    const body = buffer.subarray(at, at + size);
    at += Math.ceil(size / 512) * 512;
    if (type === '' || type === '0') yield { name, body };
  }
}

(async () => {
  console.log(`Fetching monaco-editor ${VERSION}…`);
  const tarball = zlib.gunzipSync(await fetch(URL));

  fs.rmSync(OUT, { recursive: true, force: true });
  const wanted = new Map(KEEP.map((p) => ['package/' + p, p.replace(/^min\//, '')]));
  let written = 0;
  let bytes = 0;
  for (const { name, body } of tarEntries(tarball)) {
    const to = wanted.get(name);
    if (!to) continue;
    const target = path.join(OUT, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    wanted.delete(name);
    written += 1;
    bytes += body.length;
  }
  if (wanted.size) {
    throw new Error('Missing from the tarball: ' + [...wanted.keys()].join(', '));
  }
  fs.writeFileSync(path.join(OUT, 'VERSION'), VERSION + '\n');
  console.log(`Wrote ${written} files, ${(bytes / 1048576).toFixed(1)} MB, to ${OUT}`);
})().catch((error) => { console.error(error.message); process.exit(1); });
