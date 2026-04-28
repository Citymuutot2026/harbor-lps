// Diff the inline <style> blocks between baseline and optimized templates.
// The user constraint: desktop CSS @media (min-width: 768px) / 1024px blocks
// inside the design-tokens style must NOT be touched.
const fs = require('fs');

function getTemplate(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const t = raw.indexOf('<script type="__bundler/template">');
  const a = raw.indexOf('>', t) + 1;
  const c = raw.indexOf('</script>', a);
  return JSON.parse(raw.slice(a, c).trim());
}

function styleBlocks(html) {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

const a = getTemplate('baseline.html');
const b = getTemplate('optimized.html');

const sa = styleBlocks(a);
const sb = styleBlocks(b);

console.log('style block count: baseline=', sa.length, 'optimized=', sb.length);
let allSame = sa.length === sb.length;
for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
  const same = sa[i] === sb[i];
  console.log(`  block[${i}]: same=${same} (baseline ${sa[i]?.length || 0} bytes vs optimized ${sb[i]?.length || 0} bytes)`);
  if (!same) allSame = false;
}
console.log('\nALL <style> CONTENT BYTE-IDENTICAL:', allSame);

// Also check that @media (min-width: 768px/1024px) blocks are present in both
for (const tag of ['baseline', 'optimized']) {
  const html = tag === 'baseline' ? a : b;
  const m768 = (html.match(/@media\s*\(min-width:\s*768px\)/g)||[]).length;
  const m1024 = (html.match(/@media\s*\(min-width:\s*1024px\)/g)||[]).length;
  console.log(`${tag}: @media 768px x ${m768}, @media 1024px x ${m1024}`);
}
