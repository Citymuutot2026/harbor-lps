// Injects desktop-only CSS into the bundled template inside Harbor_LP_-_Homepage.html.
// Mobile (<768px) is untouched. All new rules live in @media (min-width:...) blocks.
// (Note: prompt asked for Python; Node.js is used because Python isn't installed —
//  same JSON manipulation, identical result.)

const fs = require('fs');
const FILE = 'Harbor_LP_-_Homepage.html';

const SCRIPT_RE = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;

const NEW_CSS = `
/* ── Desktop layout overrides ─────────────────────────────────────────────
   Appended to the design-tokens block. Do not modify above this line.
   All rules gated on min-width — mobile (<768px) renders byte-identical. */
@media (min-width: 768px) {
  .hb-container { max-width: 720px; }
  .hb-stats { grid-template-columns: repeat(4, 1fr); }
  .hb-footer-cols { grid-template-columns: repeat(4, 1fr); }
  .hb-section { padding-left: 48px; padding-right: 48px; padding-top: 72px; padding-bottom: 72px; }
  .hb-h1 { font-size: 56px; }
  .hb-h2 { font-size: 40px; }
  .hb-sticky { display: none; }
  .hb-cmp { font-size: 14px; }
}

@media (min-width: 1024px) {
  .hb-container { max-width: 1120px; }
  .hb-section { padding-left: 80px; padding-right: 80px; padding-top: 96px; padding-bottom: 96px; }
  .hb-h1 { font-size: 72px; }
  .hb-h2 { font-size: 48px; }

  /* Hero: two-column grid — copy/CTA left, screenshot right, vertically centered.
     Targets the section that contains the niche-hero screenshot via :has(). */
  .hb-section:has(> .hb-niche-hero) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    column-gap: 64px;
    align-items: center;
  }
  .hb-section:has(> .hb-niche-hero) > * {
    grid-column: 1;
    min-width: 0;
  }
  .hb-section:has(> .hb-niche-hero) > .hb-niche-hero {
    grid-column: 2;
    grid-row: 1 / span 100;
    align-self: center;
    margin: 0;
    width: 100%;
  }

  /* Centered cards inside their wider sections */
  .hb-pricing,
  .hb-testimonial { max-width: 480px; margin-left: auto; margin-right: auto; }
}

@media (hover: hover) and (min-width: 768px) {
  /* Reserved for future hover states; kept empty to honour the constraint
     that any :hover rules live only inside @media (hover: hover). */
}
/* ── /Desktop layout overrides ─────────────────────────────────────────── */
`;

// 1) Read file
const original = fs.readFileSync(FILE, 'utf8');

// 2) Locate template <script>
const m = original.match(SCRIPT_RE);
if (!m) { console.error('FAIL: bundler template script not found'); process.exit(1); }
const [, openTag, jsonRaw, closeTag] = m;

// 3) JSON-decode
const decoded = JSON.parse(jsonRaw);
if (typeof decoded !== 'string') {
  console.error('FAIL: decoded template is not a string'); process.exit(1);
}

// 4) Find the design-tokens style block that ends with the .hb-doodle-arrow rule
const ARROW_NEEDLE = '.hb-doodle-arrow { font-family: var(--hb-font-hand); color: var(--hb-accent-deep); font-size: 28px; }';
const arrowIdx = decoded.indexOf(ARROW_NEEDLE);
if (arrowIdx === -1) { console.error('FAIL: .hb-doodle-arrow anchor not found'); process.exit(1); }
const closeStyleIdx = decoded.indexOf('</style>', arrowIdx);
if (closeStyleIdx === -1) { console.error('FAIL: closing </style> after anchor not found'); process.exit(1); }

// Sanity: there should not be any unrelated CSS rule between the anchor and </style>.
const between = decoded.substring(arrowIdx + ARROW_NEEDLE.length, closeStyleIdx);
if (between.replace(/\s/g, '').length !== 0) {
  console.error('FAIL: unexpected content between .hb-doodle-arrow and </style>:');
  console.error(JSON.stringify(between));
  process.exit(1);
}

// 5) Inject new CSS immediately before that </style>
const mutated = decoded.substring(0, closeStyleIdx) + NEW_CSS + decoded.substring(closeStyleIdx);

// 6) Re-encode and re-escape </script> / </style> so the outer <script> stays intact.
const reencoded = JSON.stringify(mutated).replace(/<\/(script|style)/g, '<\\/$1');

// 7) Write back
const updated = original.replace(SCRIPT_RE, openTag + reencoded + closeTag);
fs.writeFileSync(FILE, updated, 'utf8');

// ── Verification ────────────────────────────────────────────────────────
const after = fs.readFileSync(FILE, 'utf8');
const m2 = after.match(SCRIPT_RE);
if (!m2) { console.error('VERIFY FAIL: cannot re-locate script tag'); process.exit(1); }

let parsed;
try { parsed = JSON.parse(m2[2]); }
catch (e) { console.error('VERIFY FAIL: JSON did not re-parse:', e.message); process.exit(1); }

const probes = [
  '/* ── Desktop layout overrides',
  '@media (min-width: 768px)',
  '@media (min-width: 1024px)',
  '.hb-section:has(> .hb-niche-hero)',
  'grid-template-columns: repeat(4, 1fr)',
];
for (const p of probes) {
  if (!parsed.includes(p)) {
    console.error('VERIFY FAIL: probe missing from decoded template:', p);
    process.exit(1);
  }
}

// </style> escape check on the raw file (not decoded template)
const rawScriptBody = m2[2];
if (rawScriptBody.includes('</style>')) {
  console.error('VERIFY FAIL: unescaped </style> in raw script body');
  process.exit(1);
}
if (rawScriptBody.includes('</script>')) {
  console.error('VERIFY FAIL: unescaped </script> in raw script body');
  process.exit(1);
}
const escStyleCount = (rawScriptBody.match(/<\\\/style>/g) || []).length;
const escScriptCount = (rawScriptBody.match(/<\\\/script>/g) || []).length;
console.log('OK: escaped <\\/style> count =', escStyleCount);
console.log('OK: escaped <\\/script> count =', escScriptCount);
console.log('OK: decoded template length:', parsed.length);
console.log('OK: all probes present');
