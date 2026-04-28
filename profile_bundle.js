// Profile the byte distribution of the bundled Harbor homepage.
const fs = require('fs');
const path = require('path');

const TARGET = 'C:/Users/swagb/Downloads/Harbor LPs/.claude/worktrees/adoring-driscoll-d8e1b2/Harbor_LP_-_Homepage.html';

const raw = fs.readFileSync(TARGET, 'utf8');
const totalBytes = Buffer.byteLength(raw, 'utf8');
console.log('TOTAL FILE BYTES:', totalBytes, `(${(totalBytes / 1024).toFixed(1)} KB)`);

// Locate template script tag
const templateOpen = raw.indexOf('<script type="__bundler/template">');
const templateAfterTag = raw.indexOf('>', templateOpen) + 1;
const templateClose = raw.indexOf('</script>', templateAfterTag);
const templateRaw = raw.slice(templateAfterTag, templateClose).trim();
console.log('TEMPLATE SECTION BYTES (JSON-stringified):', Buffer.byteLength(templateRaw, 'utf8'));

const manifestOpen = raw.indexOf('<script type="__bundler/manifest">');
const manifestAfterTag = raw.indexOf('>', manifestOpen) + 1;
const manifestClose = raw.indexOf('</script>', manifestAfterTag);
const manifestRaw = raw.slice(manifestAfterTag, manifestClose).trim();
console.log('MANIFEST SECTION BYTES:', Buffer.byteLength(manifestRaw, 'utf8'));

// Parse the manifest JSON to see assets
let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (e) {
  console.log('Manifest parse failed:', e.message);
}
if (manifest) {
  console.log('\nMANIFEST ASSETS:');
  for (const [uuid, entry] of Object.entries(manifest)) {
    console.log(`  ${uuid.slice(0, 8)}…  mime=${entry.mime}  compressed=${entry.compressed}  base64bytes=${entry.data.length}`);
  }
}

// JSON-decode the template (it's a JSON string of HTML)
const decoded = JSON.parse(templateRaw);
const decodedBytes = Buffer.byteLength(decoded, 'utf8');
console.log('\nDECODED TEMPLATE (actual HTML) BYTES:', decodedBytes, `(${(decodedBytes / 1024).toFixed(1)} KB)`);
console.log('JSON-string overhead vs raw:', templateRaw.length - decodedBytes, 'bytes');

// Section the decoded template
function sliceBetween(s, start, end, fromIdx = 0) {
  const i = s.indexOf(start, fromIdx);
  if (i < 0) return null;
  const j = s.indexOf(end, i + start.length);
  if (j < 0) return null;
  return { start: i, end: j + end.length, content: s.slice(i + start.length, j) };
}

// Find each <style>...</style>, <script>...</script>, <svg>...</svg>
function* findAll(s, openRe, closeStr) {
  let m;
  openRe.lastIndex = 0;
  while ((m = openRe.exec(s)) !== null) {
    const openEnd = m.index + m[0].length;
    const close = s.indexOf(closeStr, openEnd);
    if (close < 0) break;
    yield { tagOpen: m[0], openIdx: m.index, contentStart: openEnd, contentEnd: close, closeEnd: close + closeStr.length };
    openRe.lastIndex = close + closeStr.length;
  }
}

let styleBytes = 0, styleCount = 0;
for (const m of findAll(decoded, /<style[^>]*>/gi, '</style>')) {
  styleBytes += m.contentEnd - m.contentStart;
  styleCount++;
}

let scriptBytes = 0, scriptCount = 0, scriptDetails = [];
for (const m of findAll(decoded, /<script[^>]*>/gi, '</script>')) {
  const len = m.contentEnd - m.contentStart;
  scriptBytes += len;
  scriptCount++;
  scriptDetails.push({ open: m.tagOpen.slice(0, 80), bytes: len });
}

let svgBytes = 0, svgCount = 0;
for (const m of findAll(decoded, /<svg[^>]*>/gi, '</svg>')) {
  svgBytes += m.contentEnd - m.contentStart;
  svgCount++;
}

let imgBytes = 0;
const imgRe = /<img[^>]*>/gi;
let im;
while ((im = imgRe.exec(decoded)) !== null) imgBytes += im[0].length;

// Data URIs in src=, srcset=, url(...)
const dataUriRe = /data:[^"')\s]{50,}/g;
let dataUriBytes = 0, dataUriCount = 0;
let du;
while ((du = dataUriRe.exec(decoded)) !== null) {
  dataUriBytes += du[0].length;
  dataUriCount++;
}

console.log('\nDECODED TEMPLATE BREAKDOWN:');
console.log(`  <style> blocks       : ${styleCount} blocks, ${styleBytes} bytes (${(styleBytes/decodedBytes*100).toFixed(1)}%)`);
console.log(`  <script> blocks      : ${scriptCount} blocks, ${scriptBytes} bytes (${(scriptBytes/decodedBytes*100).toFixed(1)}%)`);
console.log(`  <svg> inline         : ${svgCount} blocks, ${svgBytes} bytes (${(svgBytes/decodedBytes*100).toFixed(1)}%)`);
console.log(`  <img> tags           : ${imgBytes} bytes`);
console.log(`  data: URIs (≥50 ch.) : ${dataUriCount} occurrences, ${dataUriBytes} bytes (${(dataUriBytes/decodedBytes*100).toFixed(1)}%)`);

const known = styleBytes + scriptBytes + svgBytes;
console.log(`  remainder (markup/text): ${decodedBytes - known} bytes (${((decodedBytes-known)/decodedBytes*100).toFixed(1)}%)`);

console.log('\nSCRIPT BLOCKS (top 10 by size):');
scriptDetails.sort((a,b) => b.bytes - a.bytes);
for (const s of scriptDetails.slice(0, 10)) {
  console.log(`  ${s.bytes.toString().padStart(8)} bytes  ${s.open.replace(/\s+/g,' ')}`);
}

// Look for the design-tokens style block specifically
const designTokens = decoded.match(/<style[^>]*id=["']design-tokens["'][^>]*>([\s\S]*?)<\/style>/i)
  || decoded.match(/<style[^>]*data-name=["']design-tokens["'][^>]*>([\s\S]*?)<\/style>/i);
if (designTokens) {
  console.log('\nDESIGN-TOKENS STYLE BLOCK:', designTokens[1].length, 'bytes');
}

// Identify mobile vs desktop CSS split
const m768 = (decoded.match(/@media\s*\(min-width:\s*768px\)/g) || []).length;
const m1024 = (decoded.match(/@media\s*\(min-width:\s*1024px\)/g) || []).length;
console.log('@media(min-width:768px) occurrences:', m768);
console.log('@media(min-width:1024px) occurrences:', m1024);

// Search for unused .hb-stats / .hb-testimonial CSS — confirm presence
const hbStatsRules = (decoded.match(/\.hb-stats[^\{]*\{[^\}]*\}/g) || []).length;
const hbTestimonialRules = (decoded.match(/\.hb-testimonial[^\{]*\{[^\}]*\}/g) || []).length;
console.log('.hb-stats rule blocks:', hbStatsRules);
console.log('.hb-testimonial rule blocks:', hbTestimonialRules);

// Save decoded HTML for downstream tooling
fs.writeFileSync(path.join(__dirname, 'decoded_template.html'), decoded);
console.log('\nWrote decoded_template.html for inspection (', decodedBytes, 'bytes )');
