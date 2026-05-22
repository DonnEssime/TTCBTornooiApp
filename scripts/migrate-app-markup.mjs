import fs from 'fs';

function loadCatalog() {
  const enToKey = new Map();
  for (const file of [
    'src/i18n/catalog-ui.ts',
    'src/i18n/catalog-ui-summary.ts',
  ]) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /'([^']+)': e\('((?:\\'|[^'])*)'\)/g;
    let m;
    while ((m = re.exec(src))) {
      const en = m[2].replace(/\\'/g, "'");
      if (en.length >= 2 && !en.includes('{{')) enToKey.set(en, m[1]);
    }
  }
  return enToKey;
}

const files = [
  'web/src/App.svelte',
  'web/src/TournamentOverview.svelte',
  'web/src/BracketStreamView.svelte',
];

const enToKey = loadCatalog();

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  const parts = s.split(/<script[^>]*>/);
  if (parts.length < 2) continue;
  let template = parts.slice(1).join('<script').split('</script>').slice(1).join('</script>');
  const rest = parts[0] + '<script lang="ts">' + parts[1].split('</script>')[0] + '</script>';
  let tail = parts[1].split('</script>').slice(1).join('</script>');

  const sorted = [...enToKey.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [en, key] of sorted) {
    template = template.split(`>${en}<`).join(`><Msg key="${key}" /><`);
    template = template.split(`>${en}</`).join(`><Msg key="${key}" /></`);
  }

  s = rest + template;
  fs.writeFileSync(file, s);
  console.log(file, 'done');
}
