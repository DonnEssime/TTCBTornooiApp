import fs from 'fs';

const files = ['web/src/App.svelte', 'web/src/TournamentOverview.svelte'];

/** Longest-first text → replacement (markup). */
const textReplacements = [
  [
    `Local auto-save is unavailable in this browser; import still opens the tournament for this session.`,
    `<Msg key="ui.settings.localSaveUnavailable" tag="p" class="muted small" />`,
  ],
  [
    `Recent tournaments require a browser with Origin Private File System support (e.g. Chrome or Edge).`,
    `<Msg key="ui.settings.recentOpfsRequired" tag="p" class="muted small" />`,
  ],
  [
    `No saved tournaments yet. Create or import one — it will appear here after the first change.`,
    `<Msg key="ui.settings.noSavedTournaments" tag="p" class="muted" />`,
  ],
  ['Import tournament', `<Msg key="ui.import.tournament" />`],
  ['#Tables', `<Msg key="ui.settings.tablesLabel" />`],
  [
    'Direct to brackets <span class="muted small">(coming soon)</span>',
    `<Msg key="ui.direct_to_brackets" /> <span class="muted small"><Msg key="ui.settings.comingSoon" /></span>`,
  ],
  [
    'Team vs team <span class="muted small">(coming soon)</span>',
    `<Msg key="ui.team_vs_team" /> <span class="muted small"><Msg key="ui.settings.comingSoon" /></span>`,
  ],
  [
    '<strong><Msg key="ui.numerical" /></strong> — player rating from min to max (active)',
    `<strong><Msg key="ui.numerical" /></strong><Msg key="ui.settings.ratingRangeTitle" tag="span" />`,
  ],
  ['(mock — coming soon)', `<Msg key="ui.settings.mockComingSoon" tag="span" class="muted small" />`],
  ['Remove', `<Msg key="ui.remove" />`],
  ['Export Tournament File', `<Msg key="ui.export.tournamentFile" />`],
  ['Export Tournament PDF', `<Msg key="ui.export.tournamentPdf" />`],
  ['Overview', `<Msg key="ui.overview" />`],
  ['Players', `<Msg key="ui.players" />`],
  [
    `Knockout bracket is active — group lineup is locked here. You can still finish unfinished
                  round‑robin matches from the matrix above.`,
    `<Msg key="ui.group.knockoutActiveLock" tag="p" class="group-lock-banner" />`,
  ],
  [
    `Knockout bracket is active for this class — group lineup is locked here. You can still finish
                    unfinished round‑robin matches from the matrix above.`,
    `<Msg key="ui.group.knockoutActiveLockClass" tag="p" class="group-lock-banner" />`,
  ],
  ['Add players on the Players tab first.', `<Msg key="ui.group.addPlayersFirst" />`],
  ['Create by player count', `<Msg key="ui.group.createByPlayerCount" />`],
  ['Create by group count', `<Msg key="ui.group.createByGroupCount" />`],
  ['Clear groups', `<Msg key="ui.group.clearGroups" />`],
  ['[DEBUG] Simulate matches', `<Msg key="ui.group.debugSimulateMatches" />`],
  [
    'Finish the group phase first — the create button enables after groups exist.',
    `<Msg key="ui.group.finishGroupPhaseFirst" tag="p" class="muted small" />`,
  ],
  [
    '— built-in layout when you have power-of-two groups (≥4 players each).',
    `<Msg key="ui.bracket.closedFormDesc" tag="span" />`,
  ],
  [
    'Top four per group use the closed layout; 5th place and lower join via an extra preliminary round (selected by default).',
    `<Msg key="ui.bracket.closedFormCulled" />`,
  ],
  ['Exact G×4 grid (every group has four players).', `<Msg key="ui.bracket.closedFormExact" />`],
  [
    '— rule-based placement from group standings.',
    `<Msg key="ui.bracket.heuristicDesc" tag="span" />`,
  ],
  ['Create knockout bracket', `<Msg key="ui.bracket.createKnockout" />`],
  ['Remove bracket', `<Msg key="ui.bracket.removeBracket" />`],
  ['[DEBUG] Simulate phase matches', `<Msg key="ui.bracket.debugSimulatePhase" />`],
  [
    `Click a pairing in the bracket to view scores or enter games. You can change or clear a result only
                  while the winner’s next bracket match has not been played yet.`,
    `<Msg key="ui.bracket.clickPairingHint" tag="p" class="muted small" />`,
  ],
  [
    `Click a pairing in the bracket to view scores or enter games. You can change or clear a result only
                    while the winner’s next bracket match has not been played yet.`,
    `<Msg key="ui.bracket.clickPairingHint" tag="p" class="muted small" />`,
  ],
  [
    'The bracket appears here after you create it with one of the buttons above.',
    `<Msg key="ui.bracket.appearsAfterCreate" tag="p" class="muted small" />`,
  ],
  [
    'The bracket appears here after a knockout bracket exists for this class.',
    `<Msg key="ui.bracket.classAfterCreate" tag="p" class="muted small" />`,
  ],
  [
    `Players listed here are in this class (from the Players tab). Targets use closed-form bracket sizes
                    (4 players per group; 2, 4, or 8 groups). Creating groups also creates all round‑robin matches for this
                    class.`,
    `<Msg key="ui.group.classPlayersHint" tag="p" class="muted small" />`,
  ],
  [
    'No players in this class yet — enable the class checkbox for players on the Players tab.',
    `<Msg key="ui.group.noPlayersInClass" />`,
  ],
  [
    `Per-class knockout generation from the app is not wired yet. The draw will appear here after you create a
                  bracket for this class.`,
    `<Msg key="ui.bracket.classNotWired" tag="p" class="muted small" />`,
  ],
  [
    `Same centered layout as the global bracket. Player names appear once their group is fully played; until
                    then slots show <span class="mono"><Msg key="ui.group_place" /></span> from current standings order.
                    <span class="mono">--empty--</span> is a bye; “—” is a structural placeholder.`,
    `<Msg key="ui.bracket.classLayoutHint" tag="p" class="muted small" params={{ groupPlace: msgText('ui.group_place'), emptySlot: msgText('ui.slot.empty') }} />`,
  ],
  ['# to add', `<Msg key="ui.players.hashToAdd" tag="span" class="muted small" />`],
  ['[DEBUG] Fill players', `<Msg key="ui.players.debugFill" />`],
  ['Redo', `<Msg key="ui.footer.redo" />`],
  ['Close', `<Msg key="ui.close" />`],
  ['Cancel', `<Msg key="ui.cancel" />`],
  ['Delete permanently', `<Msg key="ui.delete.deletePermanently" />`],
  ['Clear result', `<Msg key="ui.score.clearResult" />`],
  ['Save match', `<Msg key="ui.score.saveMatch" />`],
  ['[DEBUG] Simulate match', `<Msg key="ui.score.debugSimulate" />`],
  [
    `Drag matches from Ready to play onto a table; drag back to unassign.`,
    `<Msg key="ui.ov.dndHint" tag="p" class="muted small ov-dnd-hint" />`,
  ],
  [
    'No tables configured yet. Use #Tables in the sidebar to add tables.',
    `<Msg key="ui.ov.noTablesHint" tag="p" class="muted small" />`,
  ],
  [
    'Nothing to highlight: no group matches waiting and no knockout slots ready to play.',
    `<Msg key="ui.ov.nothingToHighlight" tag="p" class="muted small" />`,
  ],
];

const attrReplacements = [
  ['title="Download command log (.jsonl)"', 'title={msgText(\'ui.download_command_log_jsonl\')}'],
  [
    'title="Download groups, bracket, and results summary (.pdf)"',
    'title={msgText(\'ui.download_groups_bracket_and_results_summary_pdf\')}',
  ],
  ['aria-label="Tournament sections"', 'aria-label={msgText(\'ui.tournament_sections\')}'],
  ['aria-label="Class track sections"', 'aria-label={msgText(\'ui.class_track_sections\')}'],
  ['aria-label="Target players per group"', 'aria-label={msgText(\'ui.target_players_per_group\')}'],
  ['aria-label="Target number of groups"', 'aria-label={msgText(\'ui.target_number_of_groups\')}'],
  [
    'aria-label="Target players per group for class"',
    'aria-label={msgText(\'ui.target_players_per_group_for_class\')}',
  ],
  [
    'aria-label="Target number of groups for class"',
    'aria-label={msgText(\'ui.target_number_of_groups_for_class\')}',
  ],
  ['title="No match"', 'title={msgText(\'ui.no_match\')}'],
  ['aria-label="Knockout bracket"', 'aria-label={msgText(\'ui.bracket.aria\')}'],
  ['ariaLabel="Knockout bracket"', 'ariaLabel={msgText(\'ui.bracket.aria\')}'],
  ['ariaLabel="Class knockout bracket"', 'ariaLabel={msgText(\'ui.bracket.classAria\')}'],
  [
    'emptyMessage="No class entrants — enable this class for players on the Players tab."',
    'emptyMessage={msgText(\'ui.bracket.classEmptyEntrants\')}',
  ],
  ['placeholder="Name"', 'placeholder={msgText(\'ui.name\')}'],
  [
    'aria-label="Number of players to add (debug)"',
    'aria-label={msgText(\'ui.number_of_players_to_add_debug\')}',
  ],
  ['title="Maximum absolute headstart or negative start"', 'title={msgText(\'ui.maximum_absolute_headstart_or_negative_start\')}'],
  ['aria-label="Class display name"', 'aria-label={msgText(\'ui.class_display_name\')}'],
  ['aria-label="Remove class row"', 'aria-label={msgText(\'ui.aria.removeClassRow\')}'],
  ['title="Delete saved tournament"', 'title={msgText(\'ui.delete_saved_tournament\')}'],
  ['aria-label="Close delete dialog"', 'aria-label={msgText(\'ui.close_delete_dialog\')}'],
  ['aria-label="Close score dialog"', 'aria-label={msgText(\'ui.close_score_dialog\')}'],
  ['title="Append Undo for latest undoable step"', 'title={msgText(\'ui.append_undo_for_latest_undoable_step\')}'],
  ['title="Drop last Undo from log"', 'title={msgText(\'ui.drop_last_undo_from_log\')}'],
  ['aria-label="Reading tournament file"', 'aria-label={msgText(\'ui.reading_tournament_file\')}'],
  ['aria-label="Tournament tables"', 'aria-label={msgText(\'ui.tournament_tables\')}'],
  ['aria-label="Number of tables"', 'aria-label={msgText(\'ui.number_of_tables\')}'],
  ['aria-label="Increase number of tables"', 'aria-label={msgText(\'ui.increase_number_of_tables\')}'],
  ['aria-label="Decrease number of tables"', 'aria-label={msgText(\'ui.decrease_number_of_tables\')}'],
];

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  const isApp = file.includes('App.svelte');
  if (isApp && !s.includes("import { commandFailureText, msg, msgText }")) {
    throw new Error('msgText import missing');
  }
  if (!isApp && !s.includes("import Msg from './i18n/Msg.svelte'")) {
    s = s.replace(
      "import PlayerName from './PlayerName.svelte';",
      "import PlayerName from './PlayerName.svelte';\n  import Msg from './i18n/Msg.svelte';\n  import { msgText } from './i18n/msg';\n  import { getLocale } from './i18n/locale.svelte';",
    );
  }

  textReplacements.sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of textReplacements) {
    if (s.includes(from) && !s.includes(to)) s = s.split(from).join(to);
  }
  for (const [from, to] of attrReplacements) {
    s = s.split(from).join(to);
  }

  fs.writeFileSync(file, s);
  console.log('patched', file);
}
