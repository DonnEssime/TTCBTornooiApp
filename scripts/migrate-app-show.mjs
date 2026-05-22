import fs from 'fs';

const catalog = fs.readFileSync('src/i18n/catalog-ui.ts', 'utf8');
const summary = fs.readFileSync('src/i18n/catalog-ui-summary.ts', 'utf8');
const enToKey = new Map();
for (const src of [catalog, summary]) {
  const re = /'([^']+)': e\('((?:\\'|[^'])*)'\)/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    const en = m[2].replace(/\\'/g, "'");
    if (!enToKey.has(en)) enToKey.set(en, key);
  }
}

let app = fs.readFileSync('web/src/App.svelte', 'utf8');

function mapShow(fn, text) {
  const key = enToKey.get(text);
  if (!key) return null;
  return `${fn}Key('${key}')`;
}

for (const fn of ['showError', 'showInfo', 'showWarn']) {
  const re = new RegExp(`${fn}\\(\\s*'([^']*)'\\s*\\)`, 'g');
  app = app.replace(re, (_, text) => {
    const rep = mapShow(fn, text);
    return rep ?? `${fn}('${text}')`;
  });
}

fs.writeFileSync('web/src/App.svelte', app);
const missing = [];
const re2 = /show(Error|Info|Warn)\(\s*'[^']*'\s*\)/g;
let m;
while ((m = re2.exec(app))) missing.push(m[0]);
console.log('remaining literal show*', missing.length);
