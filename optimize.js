// Optimize the Harbor homepage:
//   1. Drop Babel standalone (~860 KB base64) and pre-transpile JSX with esbuild.
//   2. Swap react/react-dom development builds for production.
// Mobile (<768px) layout is preserved byte-for-byte: the template HTML and
// design-tokens CSS are unchanged. Only manifest assets and a few <script type>
// attributes flip.
const fs = require('fs');
const zlib = require('zlib');
const { execSync } = require('child_process');

const SRC  = process.argv[2];
const OUT  = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node optimize.js <src.html> <out.html>'); process.exit(1); }

const REACT_PROD     = fs.readFileSync(__dirname + '/vendor/react.production.min.js', 'utf8');
const REACT_DOM_PROD = fs.readFileSync(__dirname + '/vendor/react-dom.production.min.js', 'utf8');

// Babel UUID is hard-coded but verified by sniffing in this script.
const raw = fs.readFileSync(SRC, 'utf8');
const beforeSize = Buffer.byteLength(raw, 'utf8');

function findBlock(s, openTag, closeStr) {
  const i = s.indexOf(openTag);
  if (i < 0) throw new Error('not found: ' + openTag);
  const afterTag = s.indexOf('>', i) + 1;
  const j = s.indexOf(closeStr, afterTag);
  return { open: i, afterOpen: afterTag, closeStart: j, closeEnd: j + closeStr.length, body: s.slice(afterTag, j).trim() };
}

const manifestBlock = findBlock(raw, '<script type="__bundler/manifest">', '</script>');
const templateBlock = findBlock(raw, '<script type="__bundler/template">', '</script>');

const manifest = JSON.parse(manifestBlock.body);
const template = JSON.parse(templateBlock.body);

function gzipB64(s) {
  const buf = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
  return zlib.gzipSync(buf, { level: 9 }).toString('base64');
}

function decode(entry) {
  const buf = Buffer.from(entry.data, 'base64');
  return entry.compressed ? zlib.gunzipSync(buf) : buf;
}

// Identify React, react-dom, Babel, and JSX/babel scripts by sniffing.
let reactUuid = null, reactDomUuid = null, babelUuid = null;
const jsxUuids = []; // entries we will pre-transpile
for (const [uuid, entry] of Object.entries(manifest)) {
  const buf = decode(entry);
  const head = buf.slice(0, 600).toString('utf8');
  if (entry.mime.includes('javascript') || entry.mime.includes('jsx')) {
    if (head.includes('react.development.js') && head.includes('@license React')) reactUuid = uuid;
    else if (head.includes('react-dom.development.js')) reactDomUuid = uuid;
    else if (head.startsWith('!function') && head.includes('Babel')) babelUuid = uuid;
  }
  if (entry.mime === 'text/jsx') jsxUuids.push(uuid);
}

if (!reactUuid || !reactDomUuid || !babelUuid) {
  throw new Error(`identification failed: react=${reactUuid} reactDom=${reactDomUuid} babel=${babelUuid}`);
}

// Inspect the template's <script type="text/babel" src="UUID"> tags. Those
// referenced UUIDs need pre-transpiling regardless of their declared mime.
const babelSrcRe = /<script\s+type=["']text\/babel["']([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi;
let m;
while ((m = babelSrcRe.exec(template)) !== null) {
  const uuid = m[2];
  if (manifest[uuid] && !jsxUuids.includes(uuid)) jsxUuids.push(uuid);
}

console.log('react uuid     :', reactUuid);
console.log('react-dom uuid :', reactDomUuid);
console.log('babel uuid     :', babelUuid, '(will be REMOVED)');
console.log('jsx/babel src  :', jsxUuids);

function esbuildJsx(code) {
  return execSync('npx --yes esbuild --loader=jsx --target=es2018', {
    input: code,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 50 * 1024 * 1024,
  });
}

// Multiple JSX files declare `const { useState } = React;` at the top level.
// Classic <script> tags in the same realm share a lexical environment, so
// declaring `const useState` twice throws SyntaxError on the second tag.
// Babel's text/babel transform path apparently isolated each script (probably
// via eval). esbuild emits plain top-level code, so we wrap each output in
// an IIFE and re-expose top-level function declarations as globals so other
// scripts can still see their React components / helpers.
function wrapForGlobalScope(code) {
  const fnNames = new Set();
  const fnRe = /^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
  let m;
  while ((m = fnRe.exec(code)) !== null) fnNames.add(m[1]);
  const exposes = [...fnNames].map(n => `globalThis.${n}=${n};`).join('');
  return `(function(){\n${code}\n${exposes}\n})();`;
}

// 1. Pre-transpile JSX/text-babel sourced files. Wrap each in an IIFE so
//    top-level `const`/`let` don't collide with sibling scripts.
for (const uuid of jsxUuids) {
  const entry = manifest[uuid];
  const src = decode(entry).toString('utf8');
  const transpiled = esbuildJsx(src);
  const wrapped = wrapForGlobalScope(transpiled);
  manifest[uuid] = {
    mime: 'application/javascript',
    compressed: true,
    data: gzipB64(wrapped),
  };
  console.log(`  transpiled ${uuid.slice(0,8)}: ${src.length} -> ${wrapped.length} bytes (b64=${manifest[uuid].data.length})`);
}

// 2. Swap React + react-dom to production
const oldReactB64 = manifest[reactUuid].data.length;
const oldReactDomB64 = manifest[reactDomUuid].data.length;
manifest[reactUuid] = { mime: 'text/javascript', compressed: true, data: gzipB64(REACT_PROD) };
manifest[reactDomUuid] = { mime: 'text/javascript', compressed: true, data: gzipB64(REACT_DOM_PROD) };
console.log(`  react dev b64=${oldReactB64} -> prod b64=${manifest[reactUuid].data.length}`);
console.log(`  react-dom dev b64=${oldReactDomB64} -> prod b64=${manifest[reactDomUuid].data.length}`);

// 3. Drop Babel
const droppedBabelB64 = manifest[babelUuid].data.length;
delete manifest[babelUuid];
console.log(`  babel b64=${droppedBabelB64} -> REMOVED`);

// 4. Modify template:
//    a. Remove the <script src="BABEL_UUID"> tag entirely.
//    b. Change <script type="text/babel" src="..."> to <script src="...">
//    c. Pre-transpile + change <script type="text/babel" data-presets=...> (inline) to <script>
let newTemplate = template;

// (a) Drop the Babel <script src="UUID"> tag
const babelScriptRe = new RegExp(`<script\\b[^>]*src=["']${babelUuid}["'][^>]*></script>\\n?`, 'g');
const beforeBabelStrip = newTemplate.length;
newTemplate = newTemplate.replace(babelScriptRe, '');
console.log(`  template babel <script> tag removed: ${beforeBabelStrip - newTemplate.length} bytes`);

// (b) Inline <script ... type="text/babel" ...> blocks (no src): transpile
//     body, then switch type to plain. Done BEFORE the sourced-script type
//     stripper so this regex still matches its target. Attribute order in
//     the source HTML is unknown, so the type attribute can be anywhere.
//     Wrap the transpiled body in an IIFE so any top-level `const`/`let`
//     declarations stay isolated from other scripts that share the same
//     globals (e.g. multiple files doing `const { useState } = React`).
const inlineBabelRe = /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi;
const inlineMatches = [];
let im;
while ((im = inlineBabelRe.exec(newTemplate)) !== null) {
  if (!/type=["'](?:text\/babel|text\/jsx)["']/i.test(im[1])) continue;
  if (/\bsrc=/i.test(im[1])) continue; // sourced — handled in (c)
  inlineMatches.push(im);
}
for (let k = inlineMatches.length - 1; k >= 0; k--) {
  const match = inlineMatches[k];
  let attrs = match[1]
    .replace(/\s*type=["'](?:text\/babel|text\/jsx)["']/i, '')
    .replace(/\s*data-presets=["'][^"']*["']/i, '');
  const body = match[2];
  const transpiled = esbuildJsx(body);
  const wrapped = wrapForGlobalScope(transpiled);
  const replacement = `<script${attrs}>${wrapped}</script>`;
  newTemplate = newTemplate.slice(0, match.index) + replacement + newTemplate.slice(match.index + match[0].length);
  console.log(`  inline babel block: ${body.length} -> ${transpiled.length} bytes`);
}

// (c) Strip type="text/babel" / type="text/jsx" from <script src=...>
newTemplate = newTemplate.replace(/<script\b([^>]*)>/gi, (full, attrs) => {
  if (!/type=["'](?:text\/babel|text\/jsx)["']/i.test(attrs)) return full;
  if (!/\bsrc=/i.test(attrs)) return full;
  const stripped = attrs.replace(/\s*type=["'](?:text\/babel|text\/jsx)["']/i, '');
  return `<script${stripped}>`;
});

// 5. Re-encode template + manifest into HTML shell.
//    JSON.stringify leaves </script> literal — that would close the wrapping
//    <script type="__bundler/template"> tag mid-payload, so escape it the same
//    way the bundler runtime does (line 119 of the outer shell).
function safeStringify(v) {
  return JSON.stringify(v).split('</' + 'script>').join('<\\/' + 'script>');
}
const newManifestStr = safeStringify(manifest);
const newTemplateStr = safeStringify(newTemplate);

let outHtml = raw.slice(0, manifestBlock.afterOpen)
  + '\n' + newManifestStr + '\n  '
  + raw.slice(manifestBlock.closeStart, templateBlock.afterOpen)
  + '\n' + newTemplateStr + '\n  '
  + raw.slice(templateBlock.closeStart);

fs.writeFileSync(OUT, outHtml);
const afterSize = Buffer.byteLength(outHtml, 'utf8');
console.log(`\nFILE SIZE: ${beforeSize} -> ${afterSize} bytes  (saved ${beforeSize - afterSize}, ${((beforeSize-afterSize)/beforeSize*100).toFixed(1)}%)`);
