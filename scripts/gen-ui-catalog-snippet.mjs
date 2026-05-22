import fs from 'fs';

const files = [
  'web/src/App.svelte',
  'web/src/TournamentOverview.svelte',
  'web/src/BracketStreamView.svelte',
  'web/src/tournamentPdf.ts',
  'web/src/tournamentStorage.ts',
];

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

const entries = new Map();

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const patterns = [
    /show(?:Error|Info|Warn)\(\s*['"]([^'"]{3,})['"]/g,
    />([A-Za-z][^<{]{2,60})</g,
    /aria-label="([^"]+)"/g,
    /placeholder="([^"]+)"/g,
    /title="([^"]+)"/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(t))) {
      const text = m[1].trim();
      if (text.includes('{') || text.startsWith('http')) continue;
      const key = `ui.${slug(text) || 'text'}`;
      if (!entries.has(key)) entries.set(key, text);
    }
  }
}

let out = "import type { MessageEntry } from './types';\nconst e = (en: string): MessageEntry => ({ en, nl: '' });\n\nexport const uiCatalog = {\n";
for (const [key, text] of [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const esc = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  out += `  '${key}': e('${esc}'),\n`;
}
out += '} as const satisfies Record<string, MessageEntry>;\n';
fs.writeFileSync('src/i18n/catalog-ui.generated.ts', out);
console.log('wrote', entries.size, 'entries');
