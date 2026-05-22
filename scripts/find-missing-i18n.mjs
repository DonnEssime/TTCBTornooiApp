import fs from 'fs';

const files = [
  'web/src/App.svelte',
  'web/src/TournamentOverview.svelte',
  'web/src/BracketStreamView.svelte',
  'web/src/BracketSlotRow.svelte',
];

function loadKeys() {
  const keys = new Set();
  for (const file of [
    'src/i18n/catalog-ui.ts',
    'src/i18n/catalog-ui-summary.ts',
    'src/i18n/catalog-ui-remaining.ts',
  ]) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'([^']+)': e\(/g)) keys.add(m[1]);
    for (const m of src.matchAll(/e\('((?:\\'|[^'])*)'\)/g)) {
      const en = m[1].replace(/\\'/g, "'");
      keys.add(en);
    }
  }
  return keys;
}

const catalogEn = loadKeys();
const missing = new Map();

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 55);
}

function add(text, file) {
  const t = text.trim();
  if (t.length < 2 || t.length > 200) return;
  if (t.includes('{{') || t.includes('{')) return;
  if (/^[\d\sW\-–—.:,;!?×]+$/.test(t)) return;
  if (catalogEn.has(t)) return;
  if (!missing.has(t)) missing.set(t, { files: new Set() });
  missing.get(t).files.add(file);
}

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const template = raw.includes('</script>') ? raw.split('</script>').slice(1).join('</script>') : raw;
  for (const m of template.matchAll(/>([^<>{}\n][^<>{}]{1,180})</g)) {
    let t = m[1].trim();
    if (t.includes('<Msg')) continue;
    add(t, f);
  }
  for (const m of template.matchAll(/(?:title|placeholder|aria-label)=["']([^"'{]+)["']/g)) add(m[1], f);
  for (const m of template.matchAll(/show(?:Warn|Info|Error)Key\(\s*['"]([^'"]+)['"]/g)) {
    // keys ok
  }
}

const sorted = [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log('missing count', sorted.length);
for (const [text] of sorted) {
  console.log(JSON.stringify(text));
}
