// Decode the gzipped+base64 manifest assets to understand what each one is.
const fs = require('fs');
const zlib = require('zlib');

const TARGET = 'C:/Users/swagb/Downloads/Harbor LPs/.claude/worktrees/adoring-driscoll-d8e1b2/Harbor_LP_-_Homepage.html';
const raw = fs.readFileSync(TARGET, 'utf8');
const manifestOpen = raw.indexOf('<script type="__bundler/manifest">');
const manifestAfterTag = raw.indexOf('>', manifestOpen) + 1;
const manifestClose = raw.indexOf('</script>', manifestAfterTag);
const manifestRaw = raw.slice(manifestAfterTag, manifestClose).trim();
const manifest = JSON.parse(manifestRaw);

const decoded = fs.readFileSync('decoded_template.html', 'utf8');

let totalBase64 = 0;
let totalDecoded = 0;
const rows = [];
for (const [uuid, entry] of Object.entries(manifest)) {
  const buf = Buffer.from(entry.data, 'base64');
  const base64Bytes = entry.data.length;
  totalBase64 += base64Bytes;
  let actual;
  try {
    actual = entry.compressed ? zlib.gunzipSync(buf) : buf;
  } catch (e) {
    actual = buf;
  }
  totalDecoded += actual.length;

  // Figure out what this asset is by sniffing
  let kind = entry.mime;
  let hint = '';
  if (entry.mime.includes('javascript') || entry.mime.includes('jsx')) {
    const head = actual.slice(0, 200).toString('utf8');
    if (head.includes('Babel')) hint = 'BABEL STANDALONE';
    else if (head.includes('react.production') || head.includes('react.development') || head.toLowerCase().includes('react') && head.includes('createRoot')) hint = 'REACT-DOM';
    else if (head.toLowerCase().includes('createelement') && head.includes('react')) hint = 'REACT';
    else if (head.startsWith('!function') && head.includes('react')) hint = 'REACT-related';
    else hint = head.slice(0, 100).replace(/\s+/g, ' ');
  } else if (entry.mime.includes('font')) {
    // Find what's referenced in the template
    const usage = decoded.indexOf(uuid);
    if (usage > 0) {
      // Look backwards for a fontFamily / @font-face local context
      const ctx = decoded.slice(Math.max(0, usage - 200), usage);
      const ffMatch = ctx.match(/font-family:\s*['"]?([^'";\}]+)/);
      const fwMatch = ctx.match(/font-weight:\s*([0-9]+)/);
      const fsMatch = ctx.match(/font-style:\s*([a-z]+)/);
      hint = (ffMatch?.[1].trim() || '?') + ' w' + (fwMatch?.[1] || '?') + (fsMatch?.[1] === 'italic' ? ' italic' : '');
    }
  }
  rows.push({ uuid: uuid.slice(0, 8), mime: entry.mime, compressed: entry.compressed, base64Bytes, actualBytes: actual.length, kind, hint });
}

rows.sort((a, b) => b.base64Bytes - a.base64Bytes);
console.log('uuid     | mime                 | b64 KB | dec KB | hint');
console.log('---------+----------------------+--------+--------+-------------------');
for (const r of rows) {
  console.log(`${r.uuid} | ${r.mime.padEnd(20)} | ${(r.base64Bytes/1024).toFixed(1).padStart(6)} | ${(r.actualBytes/1024).toFixed(1).padStart(6)} | ${r.hint}`);
}
console.log('---------+----------------------+--------+--------+-------------------');
console.log(`TOTAL                                       ${(totalBase64/1024).toFixed(1).padStart(6)}   ${(totalDecoded/1024).toFixed(1).padStart(6)}`);

// How many fonts are actually referenced in the decoded template?
let fontsRefd = 0;
for (const [uuid, entry] of Object.entries(manifest)) {
  if (entry.mime.includes('font') && decoded.includes(uuid)) fontsRefd++;
}
const totalFonts = rows.filter(r => r.mime.includes('font')).length;
console.log(`\nFonts in manifest: ${totalFonts}, referenced in template: ${fontsRefd}`);

// What font-families are referenced anywhere in CSS?
const ffs = [...new Set([...decoded.matchAll(/font-family:\s*([^;}]+)/g)].map(m => m[1].trim().slice(0, 80)))];
console.log('font-family declarations found:', ffs.length);
ffs.slice(0, 12).forEach(f => console.log('  ', f));
