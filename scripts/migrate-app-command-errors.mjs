import fs from 'fs';

const fallbacks = {
  'Could not create bracket match row': 'ui.fallback.createBracketMatchRow',
  'clearMatchScores failed': 'ui.fallback.clearMatchScores',
  'Could not create groups': 'ui.fallback.createGroups',
  'Could not clear groups': 'ui.fallback.clearGroups',
  'Could not create class groups': 'ui.fallback.createClassGroups',
  'Could not clear class groups': 'ui.fallback.clearClassGroups',
  'Could not apply competition classes': 'ui.fallback.applyCompetitionClasses',
  'Could not update tables': 'ui.fallback.updateTables',
  'Could not assign table': 'ui.fallback.assignTable',
  'Could not clear table': 'ui.fallback.clearTable',
  'Undo failed': 'ui.fallback.undoFailed',
  'Redo failed': 'ui.fallback.redoFailed',
  'Could not add player': 'ui.fallback.addPlayer',
  'Bracket generation failed': 'ui.fallback.bracketGeneration',
  'Could not remove bracket': 'ui.fallback.removeBracket',
  'Elimination failed': 'ui.fallback.elimination',
  'Could not update handicap': 'ui.fallback.updateHandicap',
  'SetRoundLock failed': 'ui.fallback.setRoundLock',
};

let app = fs.readFileSync('web/src/App.svelte', 'utf8');

for (const [text, key] of Object.entries(fallbacks)) {
  const from = `showError(r.reason ?? '${text}')`;
  const to = `showCommandError(r, '${key}')`;
  app = app.split(from).join(to);
}

// dynamic mid
app = app.replace(
  /showError\(r\.reason \?\? `Could not create \$\{mid\}`\)/g,
  "showCommandError(r, 'ui.fallback.createMatch')",
);
app = app.replace(
  /showError\(r\.reason \?\? `Stopped while scoring \$\{m\.id\} \(\$\{done\} done\)\.`\)/g,
  "showCommandError(r, 'ui.fallback.stoppedScoring', { id: m.id, done: String(done) })",
);
app = app.replace(
  /showError\(r\.reason \?\? `Stopped after \$\{addedIds\.length\} player\(s\)\.`\)/g,
  "showCommandError(r, 'ui.fallback.stoppedAfterPlayers', { n: String(addedIds.length) })",
);

fs.writeFileSync('web/src/App.svelte', app);
console.log('done');
