// Externalize bundled woff2 fonts to Google Fonts CDN.
//
// The bundle ships 11 woff2 files (~577 KB base64) for Inter 400-800 and
// Caveat 500/700 with 50 @font-face declarations against UUID URLs. They
// are the exact files Google's CSS2 endpoint serves, so swapping to a
// hosted <link> drops the bytes without touching what the browser renders.
//
// What changes:
//   1. Add preconnect + Google Fonts <link> to the bundled template's head.
//   2. Remove all 50 @font-face blocks from the template.
//   3. Drop every font/woff2 entry from the manifest.
//
// Mobile rendering must remain 1:1: the font URLs are identical (same
// subsets, same files), font-display:swap is preserved by the Google CSS,
// and the cascade outside @font-face is untouched.

const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node extract_fonts.js <src.html> <out.html>'); process.exit(1); }

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
let template = JSON.parse(templateBlock.body);

// 1. Strip @font-face blocks. Some have trailing whitespace/newlines we
//    also want to clean to avoid leaving dead vertical gaps inside the
//    <style> block.
const ffRe = /@font-face\s*\{[^}]+\}\s*/g;
const ffMatches = template.match(ffRe) || [];
console.log(`@font-face blocks found: ${ffMatches.length}`);
template = template.replace(ffRe, '');

// 2. Drop font/woff2 entries from manifest.
const fontUuids = [];
for (const [uuid, entry] of Object.entries(manifest)) {
  if (entry.mime && entry.mime.includes('font')) fontUuids.push(uuid);
}
console.log(`font assets in manifest: ${fontUuids.length}`);
let droppedB64 = 0;
for (const uuid of fontUuids) {
  droppedB64 += manifest[uuid].data.length;
  delete manifest[uuid];
}
console.log(`dropped manifest bytes (base64): ${droppedB64} (${(droppedB64/1024).toFixed(1)} KB)`);

// 3. Inject Google Fonts <link> tags. Match the same families/weights the
//    Desktop_Homepage_v1 already uses (Caveat 500/700, Inter 400-800).
//    Insert immediately after the design-tokens <style> open tag's closing
//    </style> — easiest reliable insertion point is just before the first
//    </head>. The bundled template's <head> exists; we slot links there.
const fontLinks = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">',
].join('\n');

const headCloseIdx = template.indexOf('</head>');
if (headCloseIdx < 0) throw new Error('no </head> in template');
template = template.slice(0, headCloseIdx) + fontLinks + '\n' + template.slice(headCloseIdx);

// 4. Re-encode template + manifest into HTML shell, escaping </script> the
//    same way the bundler runtime does so the wrapping <script> tags don't
//    close mid-payload.
function safeStringify(v) {
  return JSON.stringify(v).split('</' + 'script>').join('<\\/' + 'script>');
}
const newManifestStr = safeStringify(manifest);
const newTemplateStr = safeStringify(template);

let outHtml = raw.slice(0, manifestBlock.afterOpen)
  + '\n' + newManifestStr + '\n  '
  + raw.slice(manifestBlock.closeStart, templateBlock.afterOpen)
  + '\n' + newTemplateStr + '\n  '
  + raw.slice(templateBlock.closeStart);

fs.writeFileSync(OUT, outHtml);
const afterSize = Buffer.byteLength(outHtml, 'utf8');
console.log(`\nFILE SIZE: ${beforeSize} -> ${afterSize} bytes  (saved ${beforeSize - afterSize}, ${((beforeSize-afterSize)/beforeSize*100).toFixed(1)}%)`);
