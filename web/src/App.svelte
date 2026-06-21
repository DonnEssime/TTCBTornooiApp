<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    BracketMatch,
    BracketSeedingMode,
    ClassTournamentSlice,
    Command,
    GameScore,
    GroupDefinition,
    HandicapStartingCriteria,
    Match,
    Tournament,
  } from 'ttc-tornooiapp';
  import {
    TournamentController,
    createTournament,
    exportCommandsAsJsonLines,
    validateCommandLogFormat,
    type ReplayExecuteProfile,
    tournamentControllerFromCommandLogAsync,
    compareBracketMatchId,
    compareBracketMatchIdString,
    bracketMatchRound,
    inferBracketSlotCountFromRoundOne,
    bracketPlayerMatchId,
    inferBracketClassIdFromPlayerMatchId,
    parseBracketPlayerMatchId,
    canMutateBracketPlayerMatch,
    canMutateExistingGroupPhaseMatchScores,
    clampPlayerHandicapValue,
    closedFormGroupCountForParticipantCount,
    closedFormGroupCountForPlayerCount,
    CLOSED_FORM_PLAYERS_PER_GROUP,
    defaultBracketSeedingModeForTournament,
    resolveClosedFormBracketSeedingKind,
    formatBracketSlotPlayerLabel,
    handicapValueBounds,
    isExactClosedFormBracketGrid,
    isHandicapActive,
    isMiscActive,
    isPlayerDisplayIdentityTaken,
    matchPlayersResolvedForBracketPhaseList,
    isTrackParticipantId,
    bracketSeedsMatchSides,
    normalizeHandicapConfig,
    normalizeMiscConfig,
    formatPlayerDisplayLabel,
    sortPlayerIdsByName,
    sortPlayerIdsByRecentFirst,
    DEFAULT_MISC_CONFIG,
    randomPlayerHandicapValue,
    randomDebugPlayerMiscValue,
    singleEliminationPlacementRows,
    gameWinner,
    generateBracket,
    searchBestHeuristicBracketOrderAsync,
    logHeuristicBracketSearchDebug,
    HEURISTIC_BRACKET_SEARCH_TRIALS,
    bracketRoundHasOpenEliminationPairings,
    groupNumberedTitle,
    getCompetitionTrack,
    trackGroupMatches,
    tournamentUsesClassTabs,
    MAIN_TRACK_KEY,
    isDoublesTrack,
    getTrackFormat,
    getTrackPairs,
    trackBracketParticipants,
    pairDisplayLabel,
    pairById,
    matchSideLabels,
    groupStandingsRowsForBracket,
    isGameScoreLegal,
    isMatchScoreLegal,
    isPlayerDisplayNameTaken,
    matchWinner,
    anyBracketKnockoutMatchHasRecordedPlay,
    shuffleDeterministic,
    DEFAULT_NUMERICAL_HANDICAP_CONFIG,
    buildDefaultTableIds,
    matchAssignedTableId,
    matchIdOnTable,
    matchesOnTablesInAssignmentOrder,
    planFillEmptyTablesFromReady,
    matchNotesSegmentHasSlips,
    type MatchNotesSegment,
  } from 'ttc-tornooiapp';
  import BracketStreamView from './BracketStreamView.svelte';
  import { displayBracketColumns } from './bracketStream/displayColumns';
  import PlayerName from './PlayerName.svelte';
  import PlayerMatchHistoryModal from './PlayerMatchHistoryModal.svelte';
  import TournamentOverview from './TournamentOverview.svelte';
  import VersionFooter from './VersionFooter.svelte';
  import { installTestBridge, uninstallTestBridge } from './e2e/testBridge';
  import {
    deleteTournament,
    importTournamentJsonl,
    isTournamentStorageSupported,
    listRecentTournaments,
    loadTournamentJsonl,
    newTournamentFileId,
    saveTournament,
    type TournamentMeta,
  } from './tournamentStorage';
  import { downloadTournamentPdf } from './tournamentPdf';
  import { openMatchNotesPdfInNewTab } from './matchNotesPdf';
  import {
    bracketKnockoutRoundParams,
    type MessageKey,
    type ResolvedMessage,
  } from 'ttc-tornooiapp';
  import Msg from './i18n/Msg.svelte';
  import { getLocale, setLocale } from './i18n/locale.svelte';
  import { commandFailureText, enrichBracketRoundParams, msg, msgText } from './i18n/msg';

  /** When true, show developer shortcuts (bulk players, simulated group scores). */
  const DEBUG_UI = true;

  /** Draft count for [DEBUG] Fill players (parsed on click). */
  let debugFillPlayerCount = $state('21');

  /** How to order participants before single-elimination seeding (see {@link generateBracket}). */
  let bracketSeedingChoice = $state<BracketSeedingMode>('heuristic');

  function newCompetitionClassId(): string {
    return `cid-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }

  /** Sub-views for the active tournament (single Bracket tab holds the full knockout phase). */
  type InnerTab = 'overview' | 'players' | 'groups' | 'bracket' | 'results';
  type ClassInnerTab = Exclude<InnerTab, 'players'>;

  type SessionNav =
    | { kind: 'single'; inner: InnerTab }
    | { kind: 'multi'; screen: 'players' | 'overview' | { classId: string; inner: ClassInnerTab } };

  type TournamentFormat = 'group-bracket' | 'bracket-only' | 'team-vs-team';

  interface TournamentSession {
    id: string;
    /** OPFS file key for auto-save and recent list (stable for this tournament file). */
    storageFileId: string;
    /** Workspace tab label; edited by the user (not overwritten on data refresh). */
    tournamentName: string;
    controller: TournamentController;
    /** Player ids in order of addition; mirrored into `SetSeedings` after each add. */
    playerOrder: string[];
    /** Latest `SetSeedings` command id (for `generateBracket` dependencies). */
    lastSeedingCommandId: string;
    nav: SessionNav;
    /** Draft rows for “Competition classes” (applied via `SetTournamentClasses`). */
    classEditorRows: Array<{ id: string; name: string }>;
    /** Target max players per group (sizes will be this or one smaller). */
    groupTargetSize: number;
    /** Target number of groups when creating by group count. */
    groupTargetCount: number;
    /** Latest `SetGroups` command id (optional extra deps for follow-up commands). */
    lastSetGroupsCommandId: string;
    /** Per-class target group size. */
    classGroupTargetSizeByClassId: Record<string, number>;
    /** Per-class target group count. */
    classGroupTargetCountByClassId: Record<string, number>;
    /** Latest `SetClassGroups` command id per class. */
    lastSetClassGroupsCommandIdByClass: Record<string, string>;
    /** Latest `GenerateBracket` command id for the main track. */
    lastGenerateBracketCommandId: string;
    /** Latest `GenerateBracket` command id per class. */
    lastGenerateBracketCommandIdByClass: Record<string, string>;
    /** Per-track doubles (random partners) checkbox when creating groups. Key `''` = main draw. */
    doublesRandomPartnersByTrack: Record<string, boolean>;
    /** Planned flow; only `group-bracket` is implemented end-to-end. */
    tournamentFormat: TournamentFormat;
  }

  type ScoreRow = { a: string; b: string };

  type PlayersTabSortMode = 'recent' | 'alphabetical';
  const PLAYERS_TAB_SORT_KEY = 'ttc.playersTabSort';

  function loadPlayersTabSort(): PlayersTabSortMode {
    if (typeof localStorage === 'undefined') return 'recent';
    const stored = localStorage.getItem(PLAYERS_TAB_SORT_KEY);
    return stored === 'alphabetical' ? 'alphabetical' : 'recent';
  }

  /** Players tab list order; persisted in localStorage (default: most recent first). */
  let playersTabSort = $state<PlayersTabSortMode>(loadPlayersTabSort());

  function setPlayersTabSort(next: PlayersTabSortMode): void {
    playersTabSort = next;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PLAYERS_TAB_SORT_KEY, next);
    }
  }

  /** Top workspace tab: `'settings'` or a tournament session id. */
  let workspaceTab = $state<string>('settings');
  let sessions = $state<TournamentSession[]>([]);
  let activeSessionId = $state<string>('');

  /** Per-player class checkboxes (synced from tournament in pull). */
  let classFlagDrafts = $state<Record<string, Record<string, boolean>>>({});

  let tournament = $state<Tournament>(createTournament());
  const handicapEnabled = $derived(isHandicapActive(tournament));
  const miscEnabled = $derived(isMiscActive(tournament));
  const miscFieldLabel = $derived(tournament.miscConfig?.label ?? msgText('ui.misc.defaultLabel'));
  const handicapBounds = $derived(
    tournament.handicapConfig ? handicapValueBounds(tournament.handicapConfig) : { min: 0, max: 0 },
  );
  const globalGroupPlayerCount = $derived(eligibleGlobalGroupPlayerIds(tournament).length);
  const globalGroupParticipantCount = $derived(
    trackParticipantCountForGroups(tournament, undefined, globalGroupPlayerCount),
  );
  const suggestedGlobalGroupTargetCount = $derived(
    closedFormGroupCountForParticipantCount(globalGroupParticipantCount),
  );

  /** Baseline player counts for group-target auto-sync (reset on session switch). */
  let groupTargetSyncSessionId: string | null = null;
  let prevGlobalGroupPlayerCount = -1;
  let prevClassGroupPlayerCountByClassId: Record<string, number> = {};

  function resetGroupTargetSyncBaseline(sessionId: string, globalPlayerCount: number): boolean {
    if (groupTargetSyncSessionId === sessionId) return false;
    groupTargetSyncSessionId = sessionId;
    prevGlobalGroupPlayerCount = globalPlayerCount;
    prevClassGroupPlayerCountByClassId = {};
    return true;
  }

  /** When player count changes, update group target only if it still matches the old closed-form suggestion. */
  $effect(() => {
    if (tournament.bracketMatches.length > 0) return;
    if (Object.keys(tournament.groups).length > 0) return;
    const s = getActiveSession();
    if (!s) return;
    void activeSessionId;

    const playerCount = globalGroupPlayerCount;
    if (resetGroupTargetSyncBaseline(s.id, playerCount)) return;

    const prevCount = prevGlobalGroupPlayerCount;
    if (playerCount === prevCount) return;

    const participantCount = trackParticipantCountForGroups(tournament, undefined, playerCount);
    const prevSuggested = closedFormGroupCountForParticipantCount(
      trackParticipantCountForGroups(tournament, undefined, prevCount),
    );
    const nextSuggested = closedFormGroupCountForParticipantCount(participantCount);
    prevGlobalGroupPlayerCount = playerCount;

    if (s.groupTargetCount === prevSuggested && nextSuggested !== s.groupTargetCount) {
      patchActiveSession({ groupTargetCount: nextSuggested });
    }
  });

  $effect(() => {
    if (!tournamentUsesClassTabs(tournament)) return;
    const s = getActiveSession();
    if (!s) return;
    void activeSessionId;

    if (resetGroupTargetSyncBaseline(s.id, globalGroupPlayerCount)) return;

    const nextByClass: Record<string, number> = { ...s.classGroupTargetCountByClassId };
    let changed = false;

    for (const def of tournament.classDefinitions) {
      const slice = tournament.classTournaments[def.id];
      if (!slice) continue;
      if (slice.bracketMatches.length > 0) continue;
      if (Object.keys(slice.groups).length > 0) continue;

      const cid = def.id;
      const playerCount = slice.seedings.length;
      if (prevClassGroupPlayerCountByClassId[cid] === undefined) {
        prevClassGroupPlayerCountByClassId[cid] = playerCount;
        continue;
      }

      const prevCount = prevClassGroupPlayerCountByClassId[cid]!;
      if (playerCount === prevCount) continue;

      const prevSuggested = closedFormGroupCountForParticipantCount(
        trackParticipantCountForGroups(tournament, cid, prevCount),
      );
      const nextSuggested = closedFormGroupCountForParticipantCount(
        trackParticipantCountForGroups(tournament, cid, playerCount),
      );
      prevClassGroupPlayerCountByClassId[cid] = playerCount;

      const stored = s.classGroupTargetCountByClassId[cid];
      const currentVal =
        typeof stored === 'number' && stored >= 1 ? stored : prevSuggested;

      if (currentVal === prevSuggested && nextSuggested !== currentVal) {
        nextByClass[cid] = nextSuggested;
        changed = true;
      }
    }

    if (changed) patchActiveSession({ classGroupTargetCountByClassId: nextByClass });
  });

  /** Keep bracket-tab radios aligned with group grid while knockout not yet created. */
  $effect(() => {
    if (tournament.bracketMatches.length > 0) return;
    bracketSeedingChoice = defaultBracketSeedingModeForTournament(
      tournament,
      trackBracketParticipants(tournament, undefined),
      undefined,
    );
  });
  type StatusKind = 'info' | 'warn' | 'error';
  type AppStatus = { messageKey: MessageKey; kind: StatusKind; params?: Record<string, string> };
  let status = $state<AppStatus | null>(null);

  const statusResolved = $derived.by(() => {
    if (!status) return null;
    void getLocale();
    return msg(status.messageKey, status.params);
  });

  function clearStatus(): void {
    status = null;
  }
  function showStatusKey(key: MessageKey, kind: StatusKind, params?: Record<string, string>): void {
    status = { messageKey: key, kind, params };
  }
  function showInfoKey(key: MessageKey, params?: Record<string, string>): void {
    showStatusKey(key, 'info', params);
  }
  function showWarnKey(key: MessageKey, params?: Record<string, string>): void {
    showStatusKey(key, 'warn', params);
  }
  function showErrorKey(key: MessageKey, params?: Record<string, string>): void {
    showStatusKey(key, 'error', params);
  }
  function showInfo(message: string): void {
    showStatusKey('command.dynamicError', 'info', { message });
  }
  function showWarn(message: string): void {
    showStatusKey('command.dynamicError', 'warn', { message });
  }
  function showError(message: string): void {
    showStatusKey('command.dynamicError', 'error', { message });
  }
  function bracketRoundParams(
    round: number,
    matches: BracketMatch[] = tournament.bracketMatches,
  ): { round: string } {
    void getLocale();
    return bracketKnockoutRoundParams(
      getLocale(),
      round,
      matches,
      inferBracketSlotCountFromRoundOne(matches),
    );
  }

  function showCommandError(
    r: { success: boolean; reason?: MessageKey; reasonParams?: Record<string, string> },
    fallbackKey: MessageKey,
    extraParams?: Record<string, string>,
  ): void {
    if (r.success) return;
    const merged = { ...r.reasonParams, ...extraParams };
    const params = enrichBracketRoundParams(
      merged,
      tournament.bracketMatches,
      inferBracketSlotCountFromRoundOne(tournament.bracketMatches),
      r.reason,
    );
    showErrorKey(r.reason ?? fallbackKey, params);
  }
  const storageAvailable = isTournamentStorageSupported();
  let recentTournaments = $state<TournamentMeta[]>([]);
  let recentListLoading = $state(false);

  type TournamentLoadPhase = 'read' | 'replay';
  type TournamentLoadState = {
    label: string;
    phase: TournamentLoadPhase;
    done: number;
    total: number;
  };
  let tournamentLoad = $state<TournamentLoadState | null>(null);

  let bracketHeuristicSearch = $state<{ done: number; total: number } | null>(null);

  function tournamentLoadPct(done: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  function logDebugReplayExecuteProfile(label: string, profile: ReplayExecuteProfile | undefined): void {
    if (!DEBUG_UI || !profile) return;
    const fmtMs = (ms: number) => `${ms.toFixed(3)} ms`;
    console.group(`[DEBUG_UI] Replay execute profile — ${label}`);
    console.log(`Commands replayed: ${profile.commandCount}`);
    console.log(`Total execute time: ${fmtMs(profile.totalExecuteMs)}`);
    console.log(`Average per command: ${fmtMs(profile.avgExecuteMs)}`);
    console.log('Time by command type (sorted by total):');
    console.table(
      profile.byType.map((row) => ({
        type: row.type,
        count: row.count,
        total: fmtMs(row.totalMs),
        avg: fmtMs(row.avgMs),
      })),
    );
    const s = profile.slowest;
    console.log(
      `Slowest command: ${s.commandType} id=${s.commandId} (${fmtMs(s.durationMs)})`,
    );
    console.groupEnd();
  }

  async function buildControllerFromCommandLogWithProgress(
    text: string,
    label: string,
  ): Promise<Awaited<ReturnType<typeof tournamentControllerFromCommandLogAsync>>> {
    try {
      const progressEvery = 16;
      return await tournamentControllerFromCommandLogAsync(text, {}, {
        onProgress: ({ done, total }) => {
          if (done === 1 || done === total || done % progressEvery === 0) {
            tournamentLoad = { label, phase: 'replay', done, total };
          }
        },
        yieldEvery: 8,
        profileExecute: DEBUG_UI,
      });
    } finally {
      tournamentLoad = null;
    }
  }
  let deleteTournamentTarget = $state<TournamentMeta | null>(null);
  let deleteConfirmPhrase = $state('');
  let deleteTournamentBusy = $state(false);
  let deleteTournamentError = $state<string | null>(null);

  let addClassModalOpen = $state(false);
  let addClassDraftName = $state('');
  let addClassError = $state<string | null>(null);
  const deleteConfirmOk = $derived(
    deleteConfirmPhrase === 'I understand' || deleteConfirmPhrase === 'Ik begrijp het',
  );

  let newName = $state('');
  let newHc = $state(0);
  let newMisc = $state('');

  /** New tournament wizard (Settings). */
  let draftTournamentName = $state('Tournament');
  let draftHandicapEnabled = $state(false);
  let draftHandicapMin = $state(DEFAULT_NUMERICAL_HANDICAP_CONFIG.minValue);
  let draftHandicapMax = $state(DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxValue);
  let draftHandicapStartingCriteria = $state<HandicapStartingCriteria>(
    DEFAULT_NUMERICAL_HANDICAP_CONFIG.startingCriteria,
  );
  let draftHandicapMaxStart = $state(DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxStartAdjustment);
  let draftMiscEnabled = $state(false);
  let draftMiscLabel = $state(DEFAULT_MISC_CONFIG.label);
  let draftTournamentFormat = $state<TournamentFormat>('group-bracket');
  let draftClassesEnabled = $state(false);
  let draftClassEditorRows = $state<Array<{ id: string; name: string }>>([
    { id: newCompetitionClassId(), name: '' },
  ]);
  let draftTableCount = $state(4);

  /** Score drafts keyed by match id, scoped per session. */
  let scoreDraftsBySession = $state<Record<string, Record<string, ScoreRow[]>>>({});

  /** Draft for the title field; kept in sync with the active session’s saved name when not editing. */
  let nameDraft = $state('Tournament');
  let nameInputFocused = $state(false);

  $effect(() => {
    const s = getActiveSession();
    if (!s || nameInputFocused) return;
    nameDraft = s.tournamentName;
  });

  $effect(() => {
    if (!draftClassesEnabled) {
      draftClassEditorRows = [{ id: newCompetitionClassId(), name: '' }];
    }
  });

  function defaultRows(n: number): ScoreRow[] {
    return Array.from({ length: n }, () => ({ a: '', b: '' }));
  }

  function getActiveSession(): TournamentSession | undefined {
    return sessions.find((s) => s.id === activeSessionId);
  }

  function findSessionByStorageFileId(fileId: string): TournamentSession | undefined {
    return sessions.find((s) => s.storageFileId === fileId);
  }

  function formatRecentDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  async function refreshRecentTournaments(): Promise<void> {
    if (!storageAvailable) {
      recentTournaments = [];
      return;
    }
    recentListLoading = true;
    try {
      recentTournaments = await listRecentTournaments();
    } catch (e) {
      console.error('refreshRecentTournaments failed', e);
    } finally {
      recentListLoading = false;
    }
  }

  let persistSnapshotByFile = new Map<string, string>();

  /** While > 0, {@link pull} is deferred until {@link endUiBatch}. */
  let uiBatchDepth = 0;

  function normalizeJsonlForSnapshot(text: string): string {
    return text.length === 0 ? '' : text.endsWith('\n') ? text : `${text}\n`;
  }

  function persistSnapshotKey(tournamentName: string, jsonl: string): string {
    return `${tournamentName}\n${normalizeJsonlForSnapshot(jsonl)}`;
  }

  /** Mark OPFS as up-to-date (e.g. after loading or import) so the next pull skips a rewrite. */
  function seedPersistSnapshot(fileId: string, tournamentName: string, jsonl: string): void {
    persistSnapshotByFile.set(fileId, persistSnapshotKey(tournamentName, jsonl));
  }

  function beginUiBatch(): void {
    uiBatchDepth++;
  }

  function endUiBatch(options: { persist?: boolean } = {}): void {
    if (uiBatchDepth <= 0) return;
    uiBatchDepth--;
    if (uiBatchDepth === 0) {
      pull({ persist: options.persist ?? true });
    }
  }

  /** Run many controller mutations with one UI refresh and one auto-save at the end. */
  function runUiBatch(fn: () => void, options: { persist?: boolean } = {}): void {
    beginUiBatch();
    try {
      fn();
    } finally {
      endUiBatch(options);
    }
  }

  async function persistActiveSession(): Promise<void> {
    const s = getActiveSession();
    if (!s) return;
    await persistSession(s);
  }

  function sessionFromController(
    storageFileId: string,
    tournamentName: string,
    controller: TournamentController,
  ): TournamentSession {
    const t0 = controller.getTournament();
    const playerOrder =
      t0.seedings.length > 0 ? [...t0.seedings] : Object.keys(t0.players);
    const log = controller.getCommandLog();
    const id = `session-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    return {
      id,
      storageFileId,
      tournamentName,
      controller,
      playerOrder,
      lastSeedingCommandId: lastSetSeedingsCommandId(log),
      lastSetGroupsCommandId: lastCommandIdOfType(log, 'SetGroups'),
      lastSetClassGroupsCommandIdByClass: lastSetClassGroupsCommandIdsFromLog(log),
      ...(() => {
        const gen = lastGenerateBracketCommandIdsFromLog(log);
        const byClass: Record<string, string> = {};
        for (const [k, v] of Object.entries(gen)) {
          if (k !== MAIN_TRACK_KEY) byClass[k] = v;
        }
        return {
          lastGenerateBracketCommandId: gen[MAIN_TRACK_KEY] ?? '',
          lastGenerateBracketCommandIdByClass: byClass,
        };
      })(),
      nav: normalizeSessionNav(t0, { kind: 'single', inner: 'players' }),
      classEditorRows:
        t0.classDefinitions.length > 0
          ? t0.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
          : [{ id: newCompetitionClassId(), name: '' }],
      groupTargetSize: CLOSED_FORM_PLAYERS_PER_GROUP,
      groupTargetCount: closedFormGroupCountForParticipantCount(
        trackParticipantCountForGroups(t0, undefined, playerOrder.length),
      ),
      classGroupTargetSizeByClassId: {},
      classGroupTargetCountByClassId: {},
      doublesRandomPartnersByTrack: buildDoublesTrackDraftsFromTournament(t0),
      tournamentFormat: 'group-bracket',
    };
  }

  function activateSession(session: TournamentSession): void {
    if (!sessions.some((s) => s.id === session.id)) {
      sessions = [...sessions, session];
      scoreDraftsBySession = { ...scoreDraftsBySession, [session.id]: {} };
    }
    activeSessionId = session.id;
    workspaceTab = session.id;
    nameDraft = session.tournamentName;
    setScoreDrafts({});
    pull();
  }

  function openDeleteTournamentModal(entry: TournamentMeta): void {
    deleteTournamentTarget = entry;
    deleteConfirmPhrase = '';
    deleteTournamentError = null;
    deleteTournamentBusy = false;
  }

  function cancelDeleteTournamentModal(): void {
    if (deleteTournamentBusy) return;
    deleteTournamentTarget = null;
    deleteConfirmPhrase = '';
    deleteTournamentError = null;
  }

  function purgeSessionsById(removeIds: Set<string>): void {
    if (removeIds.size === 0) return;
    sessions = sessions.filter((s) => !removeIds.has(s.id));
    const nextDrafts = { ...scoreDraftsBySession };
    for (const id of removeIds) delete nextDrafts[id];
    scoreDraftsBySession = nextDrafts;
    if (removeIds.has(workspaceTab) || (activeSessionId && removeIds.has(activeSessionId))) {
      activeSessionId = sessions[0]?.id ?? '';
      workspaceTab = activeSessionId || 'settings';
      if (workspaceTab === 'settings') {
        void refreshRecentTournaments();
      } else {
        pull();
      }
    }
  }

  async function persistSession(s: TournamentSession): Promise<boolean> {
    if (!storageAvailable) return true;
    const text = exportCommandsAsJsonLines(s.controller.getCommandLog());
    const snapshot = persistSnapshotKey(s.tournamentName, text);
    if (persistSnapshotByFile.get(s.storageFileId) === snapshot) return true;
    try {
      await saveTournament(s.storageFileId, s.tournamentName, text);
      persistSnapshotByFile.set(s.storageFileId, snapshot);
      await refreshRecentTournaments();
      return true;
    } catch (e) {
      console.error('persistSession failed', e);
      return false;
    }
  }

  async function closeActiveSession(): Promise<void> {
    const s = getActiveSession();
    if (!s) return;
    commitTournamentName();
    const saved = await persistSession(s);
    if (!saved) {
      showErrorKey('ui.could_not_save_before_closing_tournament_kept_op');
      return;
    }
    clearStatus();
    purgeSessionsById(new Set([s.id]));
  }

  function closeSessionsForStorageFile(fileId: string): void {
    const removeIds = new Set(
      sessions.filter((s) => s.storageFileId === fileId).map((s) => s.id),
    );
    if (removeIds.size === 0) return;
    purgeSessionsById(removeIds);
    persistSnapshotByFile.delete(fileId);
  }

  async function confirmDeleteTournament(): Promise<void> {
    const entry = deleteTournamentTarget;
    if (!entry || !deleteConfirmOk || deleteTournamentBusy) return;
    if (!storageAvailable) {
      deleteTournamentError = 'Local tournament storage is not available in this browser.';
      return;
    }
    deleteTournamentBusy = true;
    deleteTournamentError = null;
    try {
      await deleteTournament(entry.fileId);
      closeSessionsForStorageFile(entry.fileId);
      const name = entry.tournamentName;
      deleteTournamentTarget = null;
      deleteConfirmPhrase = '';
      await refreshRecentTournaments();
      showInfoKey('ui.toast.deletedTournament', { name });
    } catch (e) {
      deleteTournamentError = e instanceof Error ? e.message : String(e);
    } finally {
      deleteTournamentBusy = false;
    }
  }

  async function openStoredTournament(fileId: string): Promise<void> {
    if (tournamentLoad) return;
    clearStatus();
    const existing = findSessionByStorageFileId(fileId);
    if (existing) {
      activateSession(existing);
      showInfoKey('ui.toast.openedExisting', { name: existing.tournamentName });
      return;
    }
    if (!storageAvailable) {
      showErrorKey('ui.local_tournament_storage_is_not_available_in_thi');
      return;
    }
    const meta = recentTournaments.find((m) => m.fileId === fileId);
    const label = meta?.tournamentName ?? 'Tournament';
    try {
      tournamentLoad = { label, phase: 'read', done: 0, total: 0 };
      const text = await loadTournamentJsonl(fileId);
      const formatErr = validateCommandLogFormat(text);
      if (formatErr) {
        tournamentLoad = null;
        showErrorKey('command.dynamicError', { message: formatErr.message });
        return;
      }
      const { controller: next, replay } = await buildControllerFromCommandLogWithProgress(text, label);
      if (!replay.success) {
        const reason = replay.results.find((r) => !r.success)?.reason ?? 'Replay failed';
        showErrorKey('ui.toast.couldNotOpen', { reason });
        return;
      }
      seedPersistSnapshot(
        fileId,
        label,
        exportCommandsAsJsonLines(next.getCommandLog()),
      );
      const session = sessionFromController(fileId, label, next);
      activateSession(session);
      logDebugReplayExecuteProfile(label, replay.executeProfile);
      showInfoKey('ui.toast.openedSession', { name: session.tournamentName });
    } catch (e) {
      tournamentLoad = null;
      showErrorKey('ui.toast.couldNotLoad', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function draftHandicapConfigFromWizard() {
    if (!draftHandicapEnabled) return null;
    return (
      normalizeHandicapConfig({
        system: 'numerical',
        minValue: draftHandicapMin,
        maxValue: draftHandicapMax,
        startingCriteria: draftHandicapStartingCriteria,
        maxStartAdjustment: draftHandicapMaxStart,
      }) ?? null
    );
  }

  function draftMiscConfigFromWizard() {
    if (!draftMiscEnabled) return null;
    return normalizeMiscConfig({ label: draftMiscLabel.trim() || DEFAULT_MISC_CONFIG.label }) ?? null;
  }

  function randomHandicapForTournament(rng: () => number = Math.random): number {
    const cfg = tournament.handicapConfig;
    return cfg ? randomPlayerHandicapValue(cfg, rng) : 0;
  }

  function scoreDrafts(): Record<string, ScoreRow[]> {
    const id = getActiveSession()?.id;
    if (!id) return {};
    return scoreDraftsBySession[id] ?? {};
  }

  function setScoreDrafts(next: Record<string, ScoreRow[]>): void {
    const id = getActiveSession()?.id;
    if (!id) return;
    scoreDraftsBySession = { ...scoreDraftsBySession, [id]: next };
  }

  const MIN_GAME_ROWS = 3;
  const MAX_GAME_ROWS = 5;

  let scoreModalMatchId = $state<string | null>(null);
  let scoreModalHint = $state<string | null>(null);
  let playerHistoryModalPid = $state<string | null>(null);
  let pairDetailModalPairId = $state<string | null>(null);
  let pairDetailModalClassId = $state<string | undefined>(undefined);

  function trackDraftKey(classId?: string): string {
    return classId ?? MAIN_TRACK_KEY;
  }

  function buildDoublesTrackDraftsFromTournament(t: Tournament): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    if (!tournamentUsesClassTabs(t)) {
      out[MAIN_TRACK_KEY] = getTrackFormat(t, undefined) === 'doubles-random-partners';
      return out;
    }
    for (const def of t.classDefinitions) {
      out[def.id] = getTrackFormat(t, def.id) === 'doubles-random-partners';
    }
    return out;
  }

  function doublesEnabledForTrack(classId?: string): boolean {
    const s = getActiveSession();
    if (!s) return false;
    return Boolean(s.doublesRandomPartnersByTrack[trackDraftKey(classId)]);
  }

  function setDoublesEnabledForTrack(classId: string | undefined, enabled: boolean): void {
    const key = trackDraftKey(classId);
    const s = getActiveSession();
    if (!s) return;
    patchActiveSession({
      doublesRandomPartnersByTrack: { ...s.doublesRandomPartnersByTrack, [key]: enabled },
    });
  }

  function groupFormatForTrack(classId?: string): 'singles' | 'doubles-random-partners' {
    return doublesEnabledForTrack(classId) ? 'doubles-random-partners' : 'singles';
  }

  function openPairDetailModal(pairId: string, classId?: string): void {
    pairDetailModalPairId = pairId;
    pairDetailModalClassId = classId;
  }

  function closePairDetailModal(): void {
    pairDetailModalPairId = null;
    pairDetailModalClassId = undefined;
  }

  function openPlayerHistoryModal(pid: string): void {
    playerHistoryModalPid = pid;
  }

  function closePlayerHistoryModal(): void {
    playerHistoryModalPid = null;
  }

  function setActivePlayerGroupFromModal(nextGroupId: string | null, classId?: string): void {
    const pid = playerHistoryModalPid;
    if (!pid) return;
    const s = getActiveSession();
    if (!s) return;
    const track = getCompetitionTrack(tournament, classId);
    if (track.bracketMatches.length > 0) {
      showErrorKey('ui.group.knockoutActiveLock');
      return;
    }
    if (Object.keys(track.groups).length === 0) {
      showErrorKey('ui.group.addPlayersFirst');
      return;
    }
    if (isDoublesTrack(tournament, classId)) {
      showErrorKey('command.movePlayerDisabledInDoubles');
      return;
    }
    runUiBatch(() => {
      const scgId = trackSetGroupsCommandId(s, classId);
      const deps = scgId ? [scgId] : [];
      const r = s.controller.setPlayerGroup(pid, nextGroupId, deps, undefined, classId);
      showCommandError(r, 'command.replayFailed');
      if (r.success) {
        showInfoKey('ui.toast.playerGroupChanged', {
          name: playerLabel(pid),
        });
      }
    });
  }

  function completedLegalGameScores(rows: ScoreRow[]): GameScore[] {
    const out: GameScore[] = [];
    for (const row of rows) {
      if (row.a === '' && row.b === '') break;
      const playerA = Number(row.a);
      const playerB = Number(row.b);
      if (!Number.isFinite(playerA) || !Number.isFinite(playerB)) break;
      const g: GameScore = { playerA, playerB };
      if (!isGameScoreLegal(g)) break;
      out.push(g);
    }
    return out;
  }

  function computeTargetRowCount(rows: ScoreRow[]): number {
    const legalPrefix = completedLegalGameScores(rows);
    const decided = matchWinner(legalPrefix) !== undefined;
    if (decided) {
      return Math.min(MAX_GAME_ROWS, Math.max(MIN_GAME_ROWS, legalPrefix.length));
    }
    return Math.min(MAX_GAME_ROWS, Math.max(MIN_GAME_ROWS, legalPrefix.length + 1));
  }

  function normalizeScoreRows(rows: ScoreRow[]): ScoreRow[] {
    const target = computeTargetRowCount(rows);
    const out = rows.slice(0, target).map((r) => ({ ...r }));
    while (out.length < target) out.push({ a: '', b: '' });
    while (out.length < MIN_GAME_ROWS) out.push({ a: '', b: '' });
    return out;
  }

  function rowIndexEnabled(rows: ScoreRow[], index: number): boolean {
    if (index === 0) return true;
    for (let i = 0; i < index; i++) {
      const row = rows[i];
      if (row.a === '' && row.b === '') return false;
      const playerA = Number(row.a);
      const playerB = Number(row.b);
      if (!Number.isFinite(playerA) || !Number.isFinite(playerB)) return false;
      if (!isGameScoreLegal({ playerA, playerB })) return false;
    }
    return true;
  }

  /** Inline hint when both points are set but the game is not a legal finished game. */
  function rowGameHint(row: ScoreRow): string | null {
    if (row.a === '' && row.b === '') return null;
    const playerA = Number(row.a);
    const playerB = Number(row.b);
    if (!Number.isFinite(playerA) || !Number.isFinite(playerB)) return null;
    if (isGameScoreLegal({ playerA, playerB })) return null;
    return msgText('ui.score.gameHint');
  }

  function scoresForSubmitFromRows(rows: ScoreRow[]): GameScore[] | null {
    const out: GameScore[] = [];
    for (const row of rows) {
      if (row.a === '' && row.b === '') break;
      const playerA = Number(row.a);
      const playerB = Number(row.b);
      if (!Number.isFinite(playerA) || !Number.isFinite(playerB)) return null;
      const g: GameScore = { playerA, playerB };
      if (!isGameScoreLegal(g)) return null;
      out.push(g);
    }
    if (out.length === 0 || !isMatchScoreLegal(out)) return null;
    return out;
  }

  function gameScoresToDraftRows(scores: GameScore[]): ScoreRow[] {
    return scores.map((g) => ({ a: String(g.playerA), b: String(g.playerB) }));
  }

  function setScoreModalCell(mid: string, rowIndex: number, col: 'a' | 'b', raw: string): void {
    const cur = [...(scoreDrafts()[mid] ?? defaultRows(MIN_GAME_ROWS))];
    if (!cur[rowIndex]) return;
    cur[rowIndex] = { ...cur[rowIndex], [col]: raw };
    const normalized = normalizeScoreRows(cur);
    setScoreDrafts({ ...scoreDrafts(), [mid]: normalized });
    scoreModalHint = null;
  }

  function openScoreModal(match: Match): void {
    if (match.groupId) {
      scoreModalHint = null;
      scoreModalMatchId = match.id;
      const existing: ScoreRow[] =
        match.scores.length > 0
          ? match.scores.map((s) => ({ a: String(s.playerA), b: String(s.playerB) }))
          : defaultRows(MIN_GAME_ROWS);
      setScoreDrafts({ ...scoreDrafts(), [match.id]: normalizeScoreRows(existing) });
      return;
    }
    if (match.status !== 'scheduled') return;
    scoreModalHint = null;
    scoreModalMatchId = match.id;
    const existing: ScoreRow[] =
      match.scores.length > 0
        ? match.scores.map((s) => ({ a: String(s.playerA), b: String(s.playerB) }))
        : defaultRows(MIN_GAME_ROWS);
    setScoreDrafts({ ...scoreDrafts(), [match.id]: normalizeScoreRows(existing) });
  }

  /** Bracket stream: open view/edit for a real pairing (both players known). */
  function openBracketPairingModal(bm: BracketMatch, classId?: string): void {
    if (bm.id.startsWith('__ph-')) return;
    const s = getActiveSession();
    if (!s) return;
    const canon = bracketMatchBySlotId(tournament, bm.id, classId);
    const seedA = bm.seedA ?? canon?.seedA;
    const seedB = bm.seedB ?? canon?.seedB;
    if (!seedA || !seedB) return;
    const mid = bracketPlayerMatchId(bm.id, classId);
    let match = tournament.matches[mid];
    if (!match) {
      const c = s.controller;
      const deps: string[] = [`cmd-${seedA}`, `cmd-${seedB}`];
      if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
      const scgId = trackSetGroupsCommandId(s, classId);
      if (scgId) deps.push(scgId);
      const cmdId = `cmd-bracket-slot-${bm.id}-${Date.now()}`;
      const r = createBracketSeedPlayerMatch(c, tournament, mid, seedA, seedB, deps, cmdId, classId);
      if (!r.success) {
        showCommandError(r, 'ui.fallback.createBracketMatchRow');
        return;
      }
      pull();
      match = tournament.matches[mid];
    }
    if (!match || match.groupId) return;
    scoreModalHint = null;
    scoreModalMatchId = mid;
    const existing: ScoreRow[] =
      match.scores.length > 0
        ? match.scores.map((sc) => ({ a: String(sc.playerA), b: String(sc.playerB) }))
        : defaultRows(MIN_GAME_ROWS);
    setScoreDrafts({ ...scoreDrafts(), [mid]: normalizeScoreRows(existing) });
  }

  function bracketLocksForMatch(match: Match | undefined): { br: BracketMatch[]; locks: number[] } {
    if (!match) return { br: [], locks: [] };
    const cid = match.classId ?? inferBracketClassIdFromPlayerMatchId(tournament, match.id);
    const tr = getCompetitionTrack(tournament, cid);
    return { br: tr.bracketMatches, locks: tr.lockedBracketRounds };
  }

  function bracketMatchBySlotId(t: Tournament, bmId: string, classId?: string): BracketMatch | undefined {
    if (classId) {
      const hit = t.classTournaments[classId]?.bracketMatches.find((x) => x.id === bmId);
      if (hit) return hit;
    }
    const fromMain = t.bracketMatches.find((x) => x.id === bmId);
    if (fromMain) return fromMain;
    for (const sl of Object.values(t.classTournaments)) {
      const hit = sl.bracketMatches.find((x) => x.id === bmId);
      if (hit) return hit;
    }
    return undefined;
  }

  function scoreModalTargetMatch(): Match | undefined {
    const mid = scoreModalMatchId;
    return mid ? tournament.matches[mid] : undefined;
  }

  function scoreModalCanEditGames(): boolean {
    const m = scoreModalTargetMatch();
    if (!m) return false;
    if (m.groupId) {
      if (m.status === 'scheduled' && m.scores.length === 0) return true;
      return canMutateExistingGroupPhaseMatchScores(tournament, m);
    }
    if (m.status === 'scheduled') return true;
    const { br, locks } = bracketLocksForMatch(m);
    return canMutateBracketPlayerMatch(tournament, m, br, locks);
  }

  function scoreModalCanClearResult(): boolean {
    const m = scoreModalTargetMatch();
    if (!m) return false;
    if (m.groupId) {
      const has = m.status === 'finished' || m.scores.length > 0;
      return has && canMutateExistingGroupPhaseMatchScores(tournament, m);
    }
    if (m.status !== 'finished' && m.scores.length === 0) return false;
    const { br, locks } = bracketLocksForMatch(m);
    return canMutateBracketPlayerMatch(tournament, m, br, locks);
  }

  function clearScoreModalBracketResult(): void {
    const sm = scoreModalTargetMatch();
    if (!sm || !scoreModalCanClearResult()) return;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    if (sm.groupId) {
      const r = c.clearMatchScores(sm.id, [], `cmd-clear-${sm.id}-${Date.now()}`);
      if (!r.success) {
        scoreModalHint = r.reason ?? 'clearMatchScores failed';
        showCommandError(r, 'ui.fallback.clearMatchScores');
        pull();
        return;
      }
      showInfoKey('ui.toast.clearedGroupResult', {
        a: playerLabel(sm.playerA),
        b: playerLabel(sm.playerB),
      });
      closeScoreModal();
      pull();
      return;
    }
    const bmId = sm.id.startsWith('match-') ? sm.id.slice('match-'.length) : sm.id;
    const bm = bracketMatchBySlotId(tournament, bmId);
    const createCmdId = bm ? c.findLatestActiveCreateMatchCommandId(sm.id) : undefined;
    const deps = createCmdId ? [createCmdId] : [];
    const r = c.clearMatchScores(sm.id, deps, `cmd-clear-${sm.id}-${Date.now()}`);
    if (!r.success) {
      scoreModalHint = r.reason ?? 'clearMatchScores failed';
      showCommandError(r, 'ui.fallback.clearMatchScores');
      pull();
      return;
    }
    showInfoKey('ui.toast.clearedResult', { id: sm.id });
    closeScoreModal();
    pull();
  }

  function closeScoreModal(): void {
    scoreModalMatchId = null;
    scoreModalHint = null;
  }

  function cancelScoreModal(): void {
    const mid = scoreModalMatchId;
    if (!mid) return;
    const m = tournament.matches[mid];
    if (m && m.status === 'scheduled') {
      const existing: ScoreRow[] =
        m.scores.length > 0
          ? m.scores.map((s) => ({ a: String(s.playerA), b: String(s.playerB) }))
          : defaultRows(MIN_GAME_ROWS);
      setScoreDrafts({ ...scoreDrafts(), [mid]: normalizeScoreRows(existing) });
    }
    closeScoreModal();
  }

  function snapshot(): Tournament {
    const s = getActiveSession();
    if (!s) return createTournament();
    return structuredClone(s.controller.getTournament());
  }

  function lastSetSeedingsCommandId(commands: Array<{ id: string; type: string }>): string {
    let last = '';
    for (const cmd of commands) {
      if (cmd.type === 'SetSeedings') last = cmd.id;
    }
    return last;
  }

  function lastCommandIdOfType(commands: Array<{ id: string; type: string }>, type: string): string {
    let last = '';
    for (const cmd of commands) {
      if (cmd.type === type) last = cmd.id;
    }
    return last;
  }

  function lastSetClassGroupsCommandIdsFromLog(
    commands: Array<{ id: string; type: string; payload?: unknown }>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const cmd of commands) {
      if (cmd.type !== 'SetClassGroups') continue;
      const p = cmd.payload as { classId?: string } | undefined;
      if (p?.classId) out[p.classId] = cmd.id;
    }
    return out;
  }

  function lastGenerateBracketCommandIdsFromLog(
    commands: Array<{ id: string; type: string; payload?: unknown }>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const cmd of commands) {
      if (cmd.type !== 'GenerateBracket') continue;
      const p = cmd.payload as { classId?: string } | undefined;
      const key = p?.classId ?? MAIN_TRACK_KEY;
      out[key] = cmd.id;
    }
    return out;
  }

  function groupDisplayLabel(g: GroupDefinition): string {
    return groupNumberedTitle(g, getLocale());
  }

  /** Sort group definitions 1, 2, … numerically when ids are numeric. */
  function sortGroupsForDisplay(groups: Record<string, GroupDefinition>): GroupDefinition[] {
    return Object.values(groups).sort((a, b) => {
      const na = Number(a.id);
      const nb = Number(b.id);
      if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a.id && String(nb) === b.id) {
        return na - nb;
      }
      return a.id.localeCompare(b.id);
    });
  }

  function eligibleGlobalGroupPlayerIds(t: Tournament): string[] {
    const s = getActiveSession();
    if (!s) return [];
    if (s.playerOrder.length > 0) return [...s.playerOrder];
    if (t.seedings.length > 0) return [...t.seedings];
    return Object.keys(t.players).sort((a, b) => a.localeCompare(b));
  }

  function classGroupTargetSize(classId: string): number {
    const s = getActiveSession();
    if (!s) return CLOSED_FORM_PLAYERS_PER_GROUP;
    const v = s.classGroupTargetSizeByClassId[classId];
    return typeof v === 'number' && v >= 1 ? v : CLOSED_FORM_PLAYERS_PER_GROUP;
  }

  function classGroupTargetCount(classId: string): number {
    const s = getActiveSession();
    const n = tournament.classTournaments[classId]?.seedings.length ?? 0;
    const participantN = trackParticipantCountForGroups(tournament, classId, n);
    const suggested = closedFormGroupCountForParticipantCount(participantN);
    if (!s) return suggested;
    const v = s.classGroupTargetCountByClassId[classId];
    return typeof v === 'number' && v >= 1 ? v : suggested;
  }

  function runSetGlobalGroups(
    payload: { targetGroupSize: number; playerIds: string[] } | { targetGroupCount: number; playerIds: string[] },
  ): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      showWarnKey('ui.with_multiple_competition_classes_use_each_class');
      return;
    }
    const ordered = eligibleGlobalGroupPlayerIds(t);
    if (ordered.length === 0) {
      showWarnKey('ui.add_at_least_one_player_and_seedings_before_crea');
      return;
    }
    const deps: string[] = [...new Set(ordered)].map((id) => `cmd-${id}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setgroups-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setGroups(
      { ...payload, playerIds: ordered, format: groupFormatForTrack(undefined) },
      deps,
      cmdId,
    );
    if (!r.success) {
      showCommandError(r, 'ui.fallback.createGroups');
      pull();
      return;
    }
    patchActiveSession({ lastSetGroupsCommandId: cmdId });
    showInfoKey('ui.created_groups_and_all_round_robin_matches');
    pull();
  }

  function createGlobalGroupsByPlayerCount(): void {
    const s = getActiveSession();
    if (!s) return;
    const targetSize = Math.max(1, Math.floor(Number(s.groupTargetSize) || CLOSED_FORM_PLAYERS_PER_GROUP));
    runSetGlobalGroups({ targetGroupSize: targetSize, playerIds: [] });
  }

  function createGlobalGroupsByGroupCount(): void {
    const s = getActiveSession();
    if (!s) return;
    const targetCount = Math.max(
      1,
      Math.floor(Number(s.groupTargetCount) || suggestedGlobalGroupTargetCount),
    );
    runSetGlobalGroups({ targetGroupCount: targetCount, playerIds: [] });
  }

  function clearGlobalGroups(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      showWarnKey('ui.use_class_tabs_to_clear_class_groups');
      return;
    }
    const deps: string[] = [];
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setgroups-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setGroups([], deps, cmdId);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.clearGroups');
      pull();
      return;
    }
    patchActiveSession({ lastSetGroupsCommandId: cmdId });
    showInfoKey('ui.cleared_groups_and_group_matches');
    pull();
  }

  function runSetClassGroups(
    classId: string,
    payload: { targetGroupSize: number; playerIds: string[] } | { targetGroupCount: number; playerIds: string[] },
  ): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (!tournamentUsesClassTabs(t)) {
      showWarnKey('ui.class_groups_require_two_or_more_competition_cla');
      return;
    }
    const slice = classSlice(t, classId);
    const ordered = [...slice.seedings];
    if (ordered.length === 0) {
      showWarnKey('ui.no_players_in_this_class_yet_enable_the_class_fo');
      return;
    }
    const deps: string[] = [...new Set(ordered)].map((id) => `cmd-${id}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setcg-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.setClassGroups(
      classId,
      { ...payload, playerIds: ordered, format: groupFormatForTrack(classId) },
      deps,
      cmdId,
    );
    if (!r.success) {
      showCommandError(r, 'ui.fallback.createClassGroups');
      pull();
      return;
    }
    patchActiveSession({
      lastSetClassGroupsCommandIdByClass: { ...s.lastSetClassGroupsCommandIdByClass, [classId]: cmdId },
    });
    showInfoKey('ui.created_groups_and_round_robin_matches_for_this_');
    pull();
  }

  function createClassGroupsByPlayerCount(classId: string): void {
    runSetClassGroups(classId, { targetGroupSize: classGroupTargetSize(classId), playerIds: [] });
  }

  function createClassGroupsByGroupCount(classId: string): void {
    runSetClassGroups(classId, { targetGroupCount: classGroupTargetCount(classId), playerIds: [] });
  }

  function clearClassGroups(classId: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    if (!tournamentUsesClassTabs(c.getTournament())) return;
    const deps: string[] = [];
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setcg-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.setClassGroups(classId, [], deps, cmdId);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.clearClassGroups');
      pull();
      return;
    }
    patchActiveSession({
      lastSetClassGroupsCommandIdByClass: { ...s.lastSetClassGroupsCommandIdByClass, [classId]: cmdId },
    });
    showInfoKey('ui.cleared_groups_for_this_class');
    pull();
  }

  function groupMatchesInScope(t: Tournament, classId: string | undefined): Match[] {
    return Object.values(t.matches)
      .filter((m) => {
        if (!m.groupId) return false;
        if (classId) return m.classId === classId;
        return !m.classId;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function debugRandomInt(rng: () => number, min: number, max: number): number {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  /** One finished game won by `side` (A = playerA), legal at 11+ with two-point margin. */
  function debugRandomLegalGameWonBy(side: 'A' | 'B', rng: () => number): GameScore {
    if (rng() < 0.65) {
      const loserPts = debugRandomInt(rng, 0, 9);
      return side === 'A' ? { playerA: 11, playerB: loserPts } : { playerA: loserPts, playerB: 11 };
    }
    const base = debugRandomInt(rng, 10, 14);
    return side === 'A' ? { playerA: base + 2, playerB: base } : { playerA: base, playerB: base + 2 };
  }

  /** Best-of-five patterns: each entry is who wins that game in (playerA, playerB) terms for a match won by A overall. */
  const DEBUG_BO5_PATTERNS_A_WINS: ('A' | 'B')[][] = [
    ['A', 'A', 'A'],
    ['B', 'A', 'A', 'A'],
    ['A', 'B', 'A', 'A'],
    ['A', 'A', 'B', 'A'],
    ['B', 'B', 'A', 'A', 'A'],
    ['B', 'A', 'B', 'A', 'A'],
    ['B', 'A', 'A', 'B', 'A'],
    ['A', 'B', 'B', 'A', 'A'],
    ['A', 'B', 'A', 'B', 'A'],
    ['A', 'A', 'B', 'B', 'A'],
  ];

  function debugRandomLegalBo5Scores(rng: () => number): GameScore[] {
    const aWinsMatch = rng() < 0.5;
    const pattern = DEBUG_BO5_PATTERNS_A_WINS[debugRandomInt(rng, 0, DEBUG_BO5_PATTERNS_A_WINS.length - 1)]!;
    const winners: ('A' | 'B')[] = pattern.map((w) => {
      if (aWinsMatch) return w;
      return w === 'A' ? 'B' : 'A';
    });
    const scores = winners.map((side) => debugRandomLegalGameWonBy(side, rng));
    if (!isMatchScoreLegal(scores)) {
      return [
        { playerA: 11, playerB: 6 },
        { playerA: 9, playerB: 11 },
        { playerA: 11, playerB: 4 },
        { playerA: 11, playerB: 7 },
      ];
    }
    return scores;
  }

  const DEBUG_NAME_PARTS = {
    adj: [
      'Swift', 'Quiet', 'Lucky', 'Bold', 'Calm', 'Keen', 'Bright', 'Steady', 'Quick', 'Fine',
      'Sharp', 'Nimble', 'Agile', 'Fierce', 'Cool', 'Crisp', 'Smooth', 'Solid', 'Hardy', 'Fresh',
      'Clear', 'Prime', 'Noble', 'Grand', 'True', 'Fair', 'Pure', 'Wild', 'Brave', 'Alert',
      'Active', 'Rapid',
    ],
    noun: [
      'Fox', 'River', 'Paddle', 'Ace', 'Spin', 'Loop', 'Drive', 'Block', 'Serve', 'Rally',
      'Ball', 'Blade', 'Net', 'Table', 'Champ', 'Star', 'Hawk', 'Wolf', 'Bear', 'Lion',
      'Eagle', 'Shark', 'Storm', 'Flame', 'Spark', 'Bolt', 'King', 'Queen', 'Knight', 'Guard',
      'Peak', 'Edge',
    ],
  };

  /** All "Adjective Noun" debug display names (no numeric suffix). */
  function debugAllAdjNounNames(): string[] {
    const out: string[] = [];
    for (const a of DEBUG_NAME_PARTS.adj) {
      for (const n of DEBUG_NAME_PARTS.noun) {
        out.push(`${a} ${n}`);
      }
    }
    return out;
  }

  function anyUnfinishedGroupPhaseMatch(t: Tournament, classId?: string): boolean {
    for (const m of trackGroupMatches(t, classId)) {
      if (m.status === 'scheduled' || m.status === 'in-progress') return true;
    }
    return false;
  }

  /** Scheduled or assigned to a table — still needs scores for debug simulate. */
  function matchOpenForScoring(m: Match): boolean {
    return m.status === 'scheduled' || m.status === 'in-progress';
  }

  function createBracketSeedPlayerMatch(
    c: TournamentController,
    t: Tournament,
    mid: string,
    seedA: string,
    seedB: string,
    deps: string[],
    cmdId: string,
    classId?: string,
  ) {
    if (!isTrackParticipantId(t, seedA, classId) || !isTrackParticipantId(t, seedB, classId)) {
      return { success: false as const, reason: 'command.playerNotFound' };
    }
    const sides = bracketSeedsMatchSides(t, seedA, seedB, classId);
    return c.createMatch(
      mid,
      sides.playerA,
      sides.playerB,
      deps,
      cmdId,
      classId,
      sides.pairA,
      sides.pairB,
    );
  }

  /** After undo/clear, bracket slots may lack a `match-*` row; create scheduled rows so debug scoring can run. */
  function debugEnsureBracketMatchRows(
    c: TournamentController,
    s: TournamentSession,
    classId?: string,
  ): void {
    if (Object.keys(c.getTournament().teamMatches).length > 0) return;
    let t = c.getTournament();
    const bracketMatches = getCompetitionTrack(t, classId).bracketMatches;
    for (const bm of bracketMatches) {
      if (!bm.seedA || !bm.seedB) continue;
      const mid = bracketPlayerMatchId(bm.id, classId);
      if (t.matches[mid]) continue;
      const deps: string[] = [`cmd-${bm.seedA}`, `cmd-${bm.seedB}`];
      if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
      const scgId = trackSetGroupsCommandId(s, classId);
      if (scgId) deps.push(scgId);
      const cmdId = `cmd-dbg-ensure-${bm.id}-${Date.now()}`;
      const r = createBracketSeedPlayerMatch(c, t, mid, bm.seedA, bm.seedB, deps, cmdId, classId);
      if (!r.success && r.reason !== 'command.matchAlreadyExists') {
        showCommandError(r, 'ui.fallback.createMatch');
      }
      t = c.getTournament();
    }
  }

  /** Knockout slots that still need scores (ignores stale `bm.winner` when the player row is still open). */
  function bracketSimulateEligibleEntries(
    t: Tournament,
    classId?: string,
  ): Array<{ m: Match; round: number }> {
    const entries: Array<{ m: Match; round: number }> = [];
    for (const bm of getCompetitionTrack(t, classId).bracketMatches) {
      if (!bm.seedA || !bm.seedB) continue;
      const mid = bracketPlayerMatchId(bm.id, classId);
      const m = t.matches[mid];
      if (!m || m.groupId) continue;
      if (!matchOpenForScoring(m)) continue;
      if (m.scores.length > 0) continue;
      if (!matchPlayersResolvedForBracketPhaseList(t, m, classId)) continue;
      entries.push({ m, round: bracketMatchRound(bm) });
    }
    return entries;
  }

  function sortBracketSimulateMatches(matches: Match[]): Match[] {
    return [...matches].sort((a, b) => {
      const ma = /^match-(m\d+)$/.exec(a.id);
      const mb = /^match-(m\d+)$/.exec(b.id);
      if (ma && mb) return compareBracketMatchIdString(ma[1]!, mb[1]!);
      return a.id.localeCompare(b.id);
    });
  }

  function debugSimulateBracketPhaseMatches(classId?: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    let t = c.getTournament();
    if (anyUnfinishedGroupPhaseMatch(t, classId)) {
      showWarnKey('ui.finish_all_group_phase_matches_before_simulating');
      pull();
      return;
    }
    debugEnsureBracketMatchRows(c, s, classId);
    t = c.getTournament();
    const seedEntries = bracketSimulateEligibleEntries(t, classId);
    if (seedEntries.length === 0) {
      showWarnKey('ui.no_knockout_matches_awaiting_scores_to_simulate_');
      pull();
      return;
    }
    const targetRound = Math.min(...seedEntries.map((e) => e.round));

    const rng = Math.random;
    let done = 0;
    const maxIters = 200;
    runUiBatch(() => {
      for (let iter = 0; iter < maxIters; iter++) {
        let t = c.getTournament();
        debugEnsureBracketMatchRows(c, s, classId);
        t = c.getTournament();
        const roundEntries = bracketSimulateEligibleEntries(t, classId).filter((e) => e.round === targetRound);
        if (roundEntries.length === 0) break;
        const m = sortBracketSimulateMatches(roundEntries.map((e) => e.m))[0]!;

        const scores = debugRandomLegalBo5Scores(rng);
        if (!isMatchScoreLegal(scores)) {
          showErrorKey('ui.internal_generated_illegal_scores');
          return;
        }
        const bid = m.id.startsWith('match-') ? m.id.slice('match-'.length) : '';
        const bm = bid
          ? getCompetitionTrack(t, classId).bracketMatches.find((x) => x.id === bid)
          : undefined;
        const createCmdId = bm ? c.findLatestActiveCreateMatchCommandId(m.id) : undefined;
        const deps = createCmdId ? [createCmdId] : [];
        const cmdId = `cmd-dbg-brkt-${m.id}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const r = c.enterScore(m.id, scores, deps, cmdId);
        if (!r.success) {
          showCommandError(r, 'ui.fallback.stoppedScoring', { id: m.id, done: String(done) });
          return;
        }
        done++;
      }
    });

    if (done === 0) {
      showWarnKey('ui.no_knockout_matches_awaiting_scores_to_simulate_');
      pull();
      return;
    }

    showInfoKey('ui.toast.debugSimulatedBracket', {
      done: String(done),
      ...bracketRoundParams(targetRound),
    });
  }

  function debugFillPlayers(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const n = Math.max(0, Math.min(256, Math.floor(Number(debugFillPlayerCount.trim()))));
    if (!Number.isFinite(n) || n < 1) {
      showWarnKey('ui.enter_a_positive_number_of_players');
      return;
    }
    const c = s.controller;
    const t0 = c.getTournament();
    if (Object.keys(t0.teamMatches).length > 0) {
      showWarnKey('ui.debug_fill_is_disabled_while_a_team_vs_team_matc');
      return;
    }
    const basePool = isMiscActive(t0)
      ? debugAllAdjNounNames()
      : debugAllAdjNounNames().filter((nm) => !isPlayerDisplayNameTaken(t0, nm));
    if (!isMiscActive(t0) && basePool.length < n) {
      showWarn(
        `Only ${basePool.length} unused debug name(s) are available; reduce the count or rename/remove players.`,
      );
      return;
    }
    const shuffleKey =
      globalThis.crypto?.randomUUID?.() ?? `dbg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pool = shuffleDeterministic([...basePool], shuffleKey);
    const rng = Math.random;
    const addedIds: string[] = [];
    runUiBatch(() => {
      for (let i = 0; i < n; i++) {
        const id = newId();
        const cmdId = `cmd-${id}`;
        const hc = randomHandicapForTournament(rng);
        const playerName = pool[i % pool.length]!;
        let misc = '';
        if (isMiscActive(t0)) {
          for (let attempt = 0; attempt < 48; attempt++) {
            const candidate = randomDebugPlayerMiscValue(rng);
            if (!isPlayerDisplayIdentityTaken(c.getTournament(), playerName, candidate)) {
              misc = candidate;
              break;
            }
          }
          if (!misc.trim()) {
            showCommandError({ success: false, reason: 'command.playerNameMiscAlreadyExists' }, 'ui.fallback.stoppedAfterPlayers', {
              n: String(addedIds.length),
            });
            return;
          }
        }
        const r = c.createPlayer(id, playerName, hc, misc, cmdId);
        if (!r.success) {
          showCommandError(r, 'ui.fallback.stoppedAfterPlayers', { n: String(addedIds.length) });
          return;
        }
        addedIds.push(id);
      }
      const newOrder = [...s.playerOrder, ...addedIds];
      const seedDeps = newOrder.map((pid) => `cmd-${pid}`);
      const seedCmdId = `cmd-seed-${crypto.randomUUID().replaceAll('-', '').slice(0, 14)}`;
      const rSeed = c.setSeedings(newOrder, seedDeps, seedCmdId);
      if (!rSeed.success) {
        showError(rSeed.reason ?? 'Could not update seedings after debug fill');
        return;
      }
      patchActiveSession({ playerOrder: newOrder, lastSeedingCommandId: seedCmdId });
      const t1 = c.getTournament();
      const defs = t1.classDefinitions;
      if (defs.length > 0) {
        for (const pid of addedIds) {
          const flags: Record<string, boolean> = {};
          for (const def of defs) {
            flags[def.id] = rng() < 0.5;
          }
          const cmdId = `cmd-dbg-class-${pid}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
          c.setPlayerClassFlags(pid, flags, [`cmd-${pid}`], cmdId);
        }
      }
      showInfoKey('ui.toast.debugAddedPlayers', { n: String(n) });
    });
  }

  /** Matches shown on Overview tables (in-progress live table assignments). */
  function overviewMatchesOnTables(t: Tournament): Match[] {
    return matchesOnTablesInAssignmentOrder(t);
  }

  function enterScoreDepsForMatch(c: TournamentController, t: Tournament, match: Match): string[] {
    const pairingPred = (x: BracketMatch) =>
      Boolean(
        x.seedA &&
          x.seedB &&
          ((x.seedA === match.playerA && x.seedB === match.playerB) ||
            (x.seedA === match.playerB && x.seedB === match.playerA)),
      );
    let bm: BracketMatch | undefined;
    if (match.id.startsWith('match-')) {
      const parsed = parseBracketPlayerMatchId(t, match.id);
      if (parsed) {
        bm = bracketMatchBySlotId(t, parsed.bracketSlotId, parsed.classId);
      }
    }
    if (!bm) bm = t.bracketMatches.find(pairingPred);
    if (!bm) {
      for (const sl of Object.values(t.classTournaments)) {
        bm = sl.bracketMatches.find(pairingPred);
        if (bm) break;
      }
    }
    const createCmdId = bm ? c.findLatestActiveCreateMatchCommandId(match.id) : undefined;
    return createCmdId ? [createCmdId] : [];
  }

  function debugSimulateOverviewTableMatches(): void {
    if (!DEBUG_UI) return;
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const list = overviewMatchesOnTables(c.getTournament());
    if (list.length === 0) {
      showWarnKey('ui.no_matches_on_tables_to_simulate');
      pull();
      return;
    }
    const rng = Math.random;
    let done = 0;
    runUiBatch(() => {
      for (const m of list) {
        const t = c.getTournament();
        const scores = debugRandomLegalBo5Scores(rng);
        if (!isMatchScoreLegal(scores)) {
          showErrorKey('ui.internal_generated_illegal_scores');
          return;
        }
        const deps = enterScoreDepsForMatch(c, t, m);
        const cmdId = `cmd-dbg-table-${m.id}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const r = c.enterScore(m.id, scores, deps, cmdId);
        if (!r.success) {
          showCommandError(r, 'ui.fallback.stoppedScoring', { id: m.id, done: String(done) });
          return;
        }
        done++;
      }
      showInfoKey('ui.toast.debugSimulatedTables', { done: String(done) });
    });
  }

  function debugFillOverviewEmptyTables(orderedMatchIds: string[]): void {
    if (!DEBUG_UI) return;
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const plan = planFillEmptyTablesFromReady(c.getTournament(), orderedMatchIds);
    if (plan.length === 0) {
      const t = c.getTournament();
      const hasFreeTable = t.tables.some((tableId) => matchIdOnTable(t, tableId) === undefined);
      showWarnKey(
        hasFreeTable ? 'ui.ov.debugFillTablesNoMatches' : 'ui.ov.debugFillTablesNoFreeTables',
      );
      pull();
      return;
    }
    let done = 0;
    runUiBatch(() => {
      for (const { matchId, tableId } of plan) {
        const r = s.controller.assignMatchToTable(
          matchId,
          tableId,
          [],
          `cmd-dbg-fill-${matchId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
        );
        if (!r.success) {
          showCommandError(r, 'ui.fallback.assignTable', { id: matchId, done: String(done) });
          return;
        }
        done++;
      }
      showInfoKey('ui.toast.debugFilledTables', { done: String(done) });
    });
  }

  function debugSimulateGroupMatches(classId: string | undefined): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    const list = groupMatchesInScope(t, classId).filter(matchOpenForScoring);
    if (list.length === 0) {
      showWarnKey('ui.no_group_matches_awaiting_scores_to_simulate');
      pull();
      return;
    }
    const rng = Math.random;
    let done = 0;
    runUiBatch(() => {
      for (const m of list) {
        const scores = debugRandomLegalBo5Scores(rng);
        if (!isMatchScoreLegal(scores)) {
          showErrorKey('ui.internal_generated_illegal_scores');
          return;
        }
        const cmdId = `cmd-dbg-sim-${m.id}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
        const r = c.enterScore(m.id, scores, [], cmdId);
        if (!r.success) {
          showCommandError(r, 'ui.fallback.stoppedScoring', { id: m.id, done: String(done) });
          return;
        }
        done++;
      }
      showInfoKey('ui.toast.debugSimulatedGroup', { done: String(done) });
    });
  }

  function groupStandingsWlByPid(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
  ): Record<string, { w: number; l: number }> {
    const m: Record<string, { w: number; l: number }> = {};
    for (const row of groupStandingsRowsForBracket(t, g, classId)) {
      m[row.pid] = { w: row.w, l: row.l };
    }
    return m;
  }

  /** Row/column order for the group matrix (permutation fixed when groups are created). */
  function groupMatrixPlayerOrder(g: GroupDefinition): string[] {
    return [...g.playerIds];
  }

  function findGroupMatchBetween(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
    rowPid: string,
    colPid: string,
  ): Match | undefined {
    if (rowPid === colPid) return undefined;
    for (const m of Object.values(t.matches)) {
      if (m.groupId !== g.id) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      const ok =
        (m.playerA === rowPid && m.playerB === colPid) || (m.playerA === colPid && m.playerB === rowPid);
      if (ok) return m;
    }
    return undefined;
  }

  function findGroupMatchBetweenPairs(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
    rowPairId: string,
    colPairId: string,
  ): Match | undefined {
    if (rowPairId === colPairId) return undefined;
    for (const m of Object.values(t.matches)) {
      if (m.groupId !== g.id) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      const ok =
        (m.pairA === rowPairId && m.pairB === colPairId) ||
        (m.pairA === colPairId && m.pairB === rowPairId);
      if (ok) return m;
    }
    return undefined;
  }

  function groupMatrixPairOrder(g: GroupDefinition): string[] {
    return [...(g.pairIds ?? [])];
  }

  function groupStandingsWlByPairId(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
  ): Record<string, { w: number; l: number }> {
    const m: Record<string, { w: number; l: number }> = {};
    for (const row of groupStandingsRowsForBracket(t, g, classId)) {
      m[row.pid] = { w: row.w, l: row.l };
    }
    return m;
  }

  function groupMatrixGamesWonDigitPairs(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
    rowPairId: string,
    colPairId: string,
  ): string {
    if (rowPairId === colPairId) return '';
    const m = findGroupMatchBetweenPairs(t, g, classId, rowPairId, colPairId);
    if (!m || m.scores.length === 0) return '';
    let won = 0;
    let anyDecided = false;
    const rowIsA = m.pairA === rowPairId;
    for (const gs of m.scores) {
      const w = gameWinner(gs);
      if (w === undefined) continue;
      anyDecided = true;
      if ((rowIsA && w === 'A') || (!rowIsA && w === 'B')) won++;
    }
    if (!anyDecided) return '';
    return String(won);
  }

  /** Games won by `rowPid` vs `colPid` from decided games only; empty string if none yet (show placeholder in UI). */
  function groupMatrixGamesWonDigit(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
    rowPid: string,
    colPid: string,
  ): string {
    if (rowPid === colPid) return '';
    const m = findGroupMatchBetween(t, g, classId, rowPid, colPid);
    if (!m || m.scores.length === 0) return '';
    let won = 0;
    let anyDecided = false;
    const rowIsA = m.playerA === rowPid;
    for (const gs of m.scores) {
      const w = gameWinner(gs);
      if (w === undefined) continue;
      anyDecided = true;
      if ((rowIsA && w === 'A') || (!rowIsA && w === 'B')) won++;
    }
    if (!anyDecided) return '';
    return String(won);
  }

  function groupMatrixCellViewOnly(t: Tournament, m: Match): boolean {
    return (
      (m.scores.length > 0 || m.status !== 'scheduled') && !canMutateExistingGroupPhaseMatchScores(t, m)
    );
  }

  function groupMatrixCellAriaLabel(t: Tournament, m: Match): string {
    const { sideA: a, sideB: b } = matchSideLabels(t, m, m.classId);
    const params = { a, b };
    if (m.scores.length === 0 && m.status === 'scheduled') {
      return groupMatrixCellViewOnly(t, m)
        ? msgText('ui.score.matrixLocked', params)
        : msgText('ui.score.matrixEnter', params);
    }
    return groupMatrixCellViewOnly(t, m)
      ? msgText('ui.score.matrixView', params)
      : msgText('ui.score.matrixEdit', params);
  }

  function titleFromImportFilename(filename: string): string {
    const base = filename.trim().replace(/^.*[/\\]/, '');
    const withoutExt = base.replace(/\.(jsonl|json|txt)$/i, '');
    return withoutExt.trim() || msgText('ui.empty.importedTournament');
  }

  function slugForFilename(name: string): string {
    const s = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || 'tournament';
  }

  function commitTournamentName(): void {
    const s = getActiveSession();
    if (!s) return;
    const next = nameDraft.trim() || 'Untitled tournament';
    if (next !== s.tournamentName) {
      patchActiveSession({ tournamentName: next });
      void persistActiveSession();
    }
    nameDraft = next;
  }

  function applySuggestedTournamentTitle(): void {
    const s = getActiveSession();
    if (!s) return;
    const t = s.controller.getTournament();
    const suggested = deriveLabel(t, s.playerOrder);
    patchActiveSession({ tournamentName: suggested });
    nameDraft = suggested;
    showInfoKey('ui.toast.titleSet', { suggested });
  }

  function deriveLabel(t: Tournament, playerOrder: string[]): string {
    if (playerOrder.length > 0) {
      const names = playerOrder
        .map((id) => t.players[id]?.name)
        .filter(Boolean) as string[];
      if (names.length <= 2) return names.join(' · ') || 'Tournament';
      return `${names.length} players`;
    }
    const ids = Object.keys(t.players);
    if (ids.length === 0) return 'Untitled tournament';
    if (ids.length <= 2) return ids.map((id) => t.players[id]?.name ?? id).join(' · ');
    return `${ids.length} players`;
  }

  function uniqueSortedRounds(matches: BracketMatch[]): number[] {
    const set = new Set(
      matches.map((m) => bracketMatchRound(m)).filter((r) => Number.isFinite(r) && r >= 0),
    );
    return [...set].sort((a, b) => a - b);
  }

  function previewBracketColumns(
    t: Tournament,
    seedIds: string[],
    shuffleKey: string,
    existing: BracketMatch[],
  ): BracketMatch[][] {
    if (existing.length > 0) return displayBracketColumns(existing);
    if (seedIds.length === 0) return [];
    try {
      const key = shuffleKey.trim() || 'Tournament';
      const r1 = generateBracket(seedIds, t, {
        fillByes: true,
        cullToPowerOfTwo: false,
        shuffleKey: key,
        tieBreakSalt: `preview:${key}`,
        bracketSeedingMode: bracketSeedingChoice,
      });
      return displayBracketColumns(r1);
    } catch {
      return [];
    }
  }

  function bracketElimRoundButtonTitle(elimRound: number): string {
    if (useClassTabs) return msgText('ui.bracket.titleUsePerClass');
    if ((tournament.lockedBracketRounds ?? []).includes(elimRound)) return msgText('ui.bracket.titleRoundLocked');
    return msgText('ui.bracket.titleEliminateRound', bracketRoundParams(elimRound));
  }

  function debugSimulateBracketTitle(): string {
    return anyUnfinishedGroupPhaseMatch(tournament)
      ? msgText('ui.bracket.debugCompleteGroupFirst')
      : msgText('ui.bracket.debugFillKnockout');
  }

  function bracketSlotTitle(m: BracketMatch, side: 'a' | 'b', t: Tournament, bracketClassId?: string): string {
    const id = side === 'a' ? m.seedA : m.seedB;
    if (id) return formatBracketSlotPlayerLabel(t, id, bracketClassId, getLocale());
    if (m.id.startsWith('__ph-')) return '—';
    return msgText('ui.slot.empty');
  }

  /** Map legacy `bracket-setup` / `bracket:7` session nav onto current tab ids. */
  function coerceLegacyInnerTab(value: InnerTab | ClassInnerTab | string): InnerTab | ClassInnerTab {
    const s = String(value);
    if (s === 'bracket-setup') return 'groups';
    if (s.startsWith('bracket:')) return 'bracket';
    return value as InnerTab;
  }

  function normalizeInnerTab(t: Tournament, current: InnerTab): InnerTab {
    const tab = coerceLegacyInnerTab(current) as InnerTab;
    if (
      tab === 'bracket' &&
      t.bracketMatches.length > 0 &&
      singleEliminationPlacementRows(t.bracketMatches, t)
    ) {
      return 'results';
    }
    return tab;
  }

  function normalizeBracketSubTab(
    t: Tournament,
    classId: string,
    bracketMatches: BracketMatch[],
    current: InnerTab | ClassInnerTab,
  ): InnerTab | ClassInnerTab {
    const tab = coerceLegacyInnerTab(current);
    if (
      tab === 'bracket' &&
      bracketMatches.length > 0 &&
      singleEliminationPlacementRows(bracketMatches, t, classId)
    ) {
      return 'results';
    }
    return tab;
  }

  function normalizeSessionNav(t: Tournament, nav: SessionNav): SessionNav {
    const multi = tournamentUsesClassTabs(t);
    if (!multi) {
      if (nav.kind === 'multi') {
        if (nav.screen === 'players') return { kind: 'single', inner: 'players' };
        if (nav.screen === 'overview') return { kind: 'single', inner: 'overview' };
        const inner0 = nav.screen.inner as string;
        const inner = (inner0 === 'bracket-setup' ? 'groups' : nav.screen.inner) as InnerTab;
        return { kind: 'single', inner: normalizeInnerTab(t, inner) };
      }
      return {
        kind: 'single',
        inner: normalizeInnerTab(t, ((nav.inner as string) === 'bracket-setup' ? 'groups' : nav.inner) as InnerTab),
      };
    }
    if (nav.kind === 'single') {
      if (nav.inner === 'players') {
        return { kind: 'multi', screen: 'players' };
      }
      if (nav.inner === 'overview') {
        return { kind: 'multi', screen: 'overview' };
      }
      const first = t.classDefinitions[0];
      if (!first) {
        return { kind: 'multi', screen: 'players' };
      }
      const innerRaw = nav.inner as string;
      const innerTab = (innerRaw === 'bracket-setup' ? 'groups' : nav.inner) as ClassInnerTab;
      const inner = normalizeBracketSubTab(
        t,
        first.id,
        t.classTournaments[first.id]?.bracketMatches ?? [],
        innerTab,
      ) as ClassInnerTab;
      return { kind: 'multi', screen: { classId: first.id, inner } };
    }
    if (nav.screen === 'players') {
      return nav;
    }
    if (nav.screen === 'overview') {
      return nav;
    }
    let { classId, inner } = nav.screen;
    if ((inner as string) === 'bracket-setup') {
      inner = 'groups';
    }
    if (!t.classDefinitions.some((c) => c.id === classId)) {
      const first = t.classDefinitions[0];
      if (!first) return { kind: 'multi', screen: 'players' };
      return { kind: 'multi', screen: { classId: first.id, inner: 'groups' } };
    }
    const bracketMatches = t.classTournaments[classId]?.bracketMatches ?? [];
    return {
      kind: 'multi',
      screen: { classId, inner: normalizeBracketSubTab(t, classId, bracketMatches, inner) as ClassInnerTab },
    };
  }

  function classSlice(t: Tournament, classId: string): ClassTournamentSlice {
    const tr = getCompetitionTrack(t, classId);
    return {
      seedings: tr.seedings,
      groups: tr.groups,
      bracketMatches: tr.bracketMatches,
      lockedBracketRounds: tr.lockedBracketRounds,
    };
  }

  function trackSetGroupsCommandId(s: TournamentSession, classId: string | undefined): string {
    if (classId) {
      return s.lastSetClassGroupsCommandIdByClass[classId] ?? '';
    }
    return s.lastSetGroupsCommandId;
  }

  function trackGenerateBracketCommandId(s: TournamentSession, classId: string | undefined): string {
    if (classId) {
      return s.lastGenerateBracketCommandIdByClass[classId] ?? '';
    }
    return s.lastGenerateBracketCommandId;
  }

  function trackParticipantCountForGroups(
    t: Tournament,
    classId: string | undefined,
    playerCount: number,
  ): number {
    if (isDoublesTrack(t, classId)) {
      const pairs = Object.keys(getTrackPairs(t, classId));
      if (pairs.length > 0) return pairs.length;
      return Math.floor(playerCount / 2);
    }
    return playerCount;
  }

  function eligibleTrackGroupPlayerIds(t: Tournament, classId: string | undefined): string[] {
    if (classId) {
      return [...getCompetitionTrack(t, classId).seedings];
    }
    return eligibleGlobalGroupPlayerIds(t);
  }

  function patchActiveSession(patch: Partial<TournamentSession>): void {
    if (!getActiveSession()) return;
    sessions = sessions.map((s) => (s.id === activeSessionId ? { ...s, ...patch } : s));
  }

  function pull(options: { persist?: boolean } = {}): void {
    if (uiBatchDepth > 0) return;
    try {
      const s = getActiveSession();
      if (!s) {
        tournament = createTournament();
        classFlagDrafts = {};
        return;
      }
      const t = structuredClone(s.controller.getTournament());
      // If the score modal is open for a match that doesn't exist in the next snapshot,
      // clear it *before* swapping `tournament` to avoid rendering with `sm = undefined`.
      if (scoreModalMatchId && !t.matches[scoreModalMatchId]) {
        scoreModalMatchId = null;
        scoreModalHint = null;
      }

      const navNext = normalizeSessionNav(t, s.nav);
      if (JSON.stringify(navNext) !== JSON.stringify(s.nav)) {
        patchActiveSession({ nav: navNext });
      }

      const sAfter = getActiveSession();
      if (!sAfter) return;
      const lastS = lastSetSeedingsCommandId(sAfter.controller.getCommandLog());
      if (t.seedings.length > 0) {
        const synced = [...t.seedings];
        if (
          synced.join(',') !== sAfter.playerOrder.join(',') ||
          (lastS && lastS !== sAfter.lastSeedingCommandId)
        ) {
          patchActiveSession({
            playerOrder: synced,
            lastSeedingCommandId: lastS || sAfter.lastSeedingCommandId,
          });
        }
      } else {
        /** All seedings undone or cleared: keep session list in sync (avoid ghost ids with no players). */
        if (sAfter.playerOrder.length > 0 || sAfter.lastSeedingCommandId) {
          patchActiveSession({
            playerOrder: [],
            lastSeedingCommandId: '',
          });
        }
      }

    const log = sAfter.controller.getCommandLog();
    const lastSG = lastCommandIdOfType(log, 'SetGroups');
    const lastSCG = lastSetClassGroupsCommandIdsFromLog(log);
    const prevScg = sAfter.lastSetClassGroupsCommandIdByClass;
    let scgChanged = lastSG !== sAfter.lastSetGroupsCommandId;
    if (!scgChanged) {
      for (const k of new Set([...Object.keys(prevScg), ...Object.keys(lastSCG)])) {
        if (prevScg[k] !== lastSCG[k]) {
          scgChanged = true;
          break;
        }
      }
    }
    if (scgChanged) {
      patchActiveSession({
        lastSetGroupsCommandId: lastSG,
        lastSetClassGroupsCommandIdByClass: lastSCG,
      });
    }

    const lastGen = lastGenerateBracketCommandIdsFromLog(log);
    const prevGen = sAfter.lastGenerateBracketCommandIdByClass;
    let genChanged = (lastGen[MAIN_TRACK_KEY] ?? '') !== sAfter.lastGenerateBracketCommandId;
    if (!genChanged) {
      for (const k of new Set([...Object.keys(prevGen), ...Object.keys(lastGen)])) {
        if (k === MAIN_TRACK_KEY) continue;
        if (prevGen[k] !== lastGen[k]) {
          genChanged = true;
          break;
        }
      }
    }
    if (genChanged) {
      const byClass: Record<string, string> = {};
      for (const [k, v] of Object.entries(lastGen)) {
        if (k !== MAIN_TRACK_KEY) byClass[k] = v;
      }
      patchActiveSession({
        lastGenerateBracketCommandId: lastGen[MAIN_TRACK_KEY] ?? '',
        lastGenerateBracketCommandIdByClass: byClass,
      });
    }

    const prev = scoreDrafts();
    const next = { ...prev };
    for (const m of Object.values(t.matches)) {
      if (m.status === 'scheduled' && !next[m.id]) {
        next[m.id] = defaultRows(3);
      }
    }
    setScoreDrafts(next);

      if (scoreModalMatchId && !t.matches[scoreModalMatchId]) {
        scoreModalMatchId = null;
        scoreModalHint = null;
      }

      const sFinal = getActiveSession();
      if (!sFinal) return;
      const po = sFinal.playerOrder;
      const cfd: Record<string, Record<string, boolean>> = {};
      for (const pid of po) {
        const row: Record<string, boolean> = {};
        for (const def of t.classDefinitions) {
          row[def.id] = Boolean(t.playerClassFlags[pid]?.[def.id]);
        }
        cfd[pid] = row;
      }
      classFlagDrafts = cfd;
      tournament = t;

      const doublesDrafts = buildDoublesTrackDraftsFromTournament(t);
      if (JSON.stringify(doublesDrafts) !== JSON.stringify(sFinal.doublesRandomPartnersByTrack)) {
        patchActiveSession({ doublesRandomPartnersByTrack: doublesDrafts });
      }

      if (options.persist !== false) {
        void persistActiveSession();
      }
    } catch (e) {
      // Avoid hard-locking the UI on a render-triggering exception; surface it.
      console.error('pull() failed', e);
      scoreModalMatchId = null;
      scoreModalHint = null;
      showErrorKey('ui.toast.internalUiError', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function newId(): string {
    return `p-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
  }

  function selectWorkspaceTab(tab: string): void {
    workspaceTab = tab;
    if (tab === 'settings') {
      void refreshRecentTournaments();
    } else if (sessions.some((s) => s.id === tab)) {
      activeSessionId = tab;
    }
    pull();
  }

  function selectSingleTrackTab(tab: InnerTab): void {
    if (!getActiveSession()) return;
    patchActiveSession({ nav: { kind: 'single', inner: tab } });
  }

  function selectOverviewNav(): void {
    const s = getActiveSession();
    if (!s) return;
    const t = s.controller.getTournament();
    if (tournamentUsesClassTabs(t)) {
      patchActiveSession({ nav: { kind: 'multi', screen: 'overview' } });
    } else {
      patchActiveSession({ nav: { kind: 'single', inner: 'overview' } });
    }
  }

  function selectPlayersNav(): void {
    const s = getActiveSession();
    if (!s) return;
    const t = s.controller.getTournament();
    if (tournamentUsesClassTabs(t)) {
      patchActiveSession({ nav: { kind: 'multi', screen: 'players' } });
    } else {
      patchActiveSession({ nav: { kind: 'single', inner: 'players' } });
    }
  }

  function selectClassTopTab(classId: string): void {
    if (!getActiveSession()) return;
    patchActiveSession({ nav: { kind: 'multi', screen: { classId, inner: 'groups' } } });
  }

  function selectClassSubTab(classId: string, sub: ClassInnerTab): void {
    if (!getActiveSession()) return;
    patchActiveSession({ nav: { kind: 'multi', screen: { classId, inner: sub } } });
  }

  function updateDraftClassRow(index: number, name: string): void {
    draftClassEditorRows = draftClassEditorRows.map((row, i) => (i === index ? { ...row, name } : row));
  }

  function addDraftClassRow(): void {
    draftClassEditorRows = [...draftClassEditorRows, { id: newCompetitionClassId(), name: '' }];
  }

  function removeDraftClassRow(index: number): void {
    const next = draftClassEditorRows.filter((_, i) => i !== index);
    draftClassEditorRows = next.length > 0 ? next : [{ id: newCompetitionClassId(), name: '' }];
  }

  function createTournamentFromWizard(): void {
    clearStatus();
    const controller = new TournamentController();
    const handicapConfig = draftHandicapConfigFromWizard();
    if (handicapConfig) {
      const cmdId = `cmd-hc-init-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const rHc = controller.setHandicapConfig(handicapConfig, [], cmdId);
      if (!rHc.success) {
        showError(rHc.reason ?? 'Could not apply handicap settings');
        return;
      }
    }
    const miscConfig = draftMiscConfigFromWizard();
    if (miscConfig) {
      const cmdId = `cmd-misc-init-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const rMisc = controller.setMiscConfig(miscConfig, [], cmdId);
      if (!rMisc.success) {
        showCommandError(rMisc, 'ui.fallback.applyMiscSettings');
        return;
      }
    }
    const namedClasses = draftClassesEnabled
      ? draftClassEditorRows
          .map((r) => ({
            id: r.id.trim() || newCompetitionClassId(),
            name: r.name.trim(),
          }))
          .filter((r) => r.name.length > 0)
      : [];
    if (draftClassesEnabled && namedClasses.length === 0) {
      showErrorKey('ui.classes.requireAtLeastOneWhenEnabled');
      return;
    }
    if (namedClasses.length > 0) {
      const cmdId = `cmd-classes-init-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const r = controller.setTournamentClasses(namedClasses, [], cmdId);
      if (!r.success) {
        showCommandError(r, 'ui.fallback.applyCompetitionClasses');
        return;
      }
    }
    {
      const cmdId = `cmd-tables-init-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const tableIds = buildDefaultTableIds(Math.max(1, Math.floor(Number(draftTableCount) || 1)));
      const rTables = controller.setTournamentTables(tableIds, [], cmdId);
      if (!rTables.success) {
        showError(rTables.reason ?? 'Could not configure tables');
        return;
      }
    }
    const t0 = controller.getTournament();
    const nav = normalizeSessionNav(t0, { kind: 'single', inner: 'players' });
    const classEditorRowsForSession =
      t0.classDefinitions.length > 0
        ? t0.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
        : [{ id: newCompetitionClassId(), name: '' }];
    const storageFileId = newTournamentFileId();
    const id = `session-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const session: TournamentSession = {
      id,
      storageFileId,
      tournamentName: draftTournamentName.trim() || 'Tournament',
      controller,
      playerOrder: [],
      lastSeedingCommandId: '',
      nav,
      classEditorRows: classEditorRowsForSession,
      groupTargetSize: CLOSED_FORM_PLAYERS_PER_GROUP,
      groupTargetCount: closedFormGroupCountForParticipantCount(0),
      lastSetGroupsCommandId: '',
      classGroupTargetSizeByClassId: {},
      classGroupTargetCountByClassId: {},
      lastSetClassGroupsCommandIdByClass: {},
      lastGenerateBracketCommandId: '',
      lastGenerateBracketCommandIdByClass: {},
      doublesRandomPartnersByTrack: {},
      tournamentFormat: draftTournamentFormat,
    };
    activateSession(session);
    draftTournamentName = 'Tournament';
    draftHandicapEnabled = false;
    draftHandicapMin = DEFAULT_NUMERICAL_HANDICAP_CONFIG.minValue;
    draftHandicapMax = DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxValue;
    draftHandicapStartingCriteria = DEFAULT_NUMERICAL_HANDICAP_CONFIG.startingCriteria;
    draftHandicapMaxStart = DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxStartAdjustment;
    draftMiscEnabled = false;
    draftMiscLabel = DEFAULT_MISC_CONFIG.label;
    draftClassesEnabled = false;
    draftClassEditorRows = [{ id: newCompetitionClassId(), name: '' }];
    draftTournamentFormat = 'group-bracket';
    draftTableCount = 4;
    pull();
    showInfoKey('ui.tournament_created_add_players_on_the_players_ta');
  }

  function applyOverviewTableCount(count: number): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const clamped = Math.min(32, Math.max(1, Math.floor(count)));
    const tableIds = buildDefaultTableIds(clamped);
    const r = s.controller.setTournamentTables(tableIds, [], `cmd-tables-${Date.now()}`);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.updateTables');
    }
    pull();
  }

  function incrementOverviewTableCount(): void {
    applyOverviewTableCount(overviewTableCount + 1);
  }

  function decrementOverviewTableCount(): void {
    if (overviewTableCount <= 1) return;
    applyOverviewTableCount(overviewTableCount - 1);
  }

  function openTableMatch(m: Match): void {
    openScoreModal(m);
  }

  /** Read-only: table assignment is changed on the Overview via drag-and-drop. */
  function scoreModalAssignedTableId(): string | null {
    const m = scoreModalTargetMatch();
    if (!m) return null;
    return matchAssignedTableId(tournament, m.id) ?? null;
  }

  function overviewAssignMatchToTable(matchId: string, tableId: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const incumbent = matchIdOnTable(tournament, tableId);
    const sourceTableId = matchAssignedTableId(tournament, matchId);
    const ts = Date.now();

    if (incumbent && incumbent !== matchId && sourceTableId && sourceTableId !== tableId) {
      const rClear = s.controller.clearMatchTableAssignment(incumbent, [], `cmd-table-clear-${incumbent}-${ts}`);
      if (!rClear.success) {
        showError(rClear.reason ?? 'Could not clear table');
        pull();
        return;
      }
      const rAssign = s.controller.assignMatchToTable(matchId, tableId, [], `cmd-table-assign-${matchId}-${ts}`);
      if (!rAssign.success) {
        showError(rAssign.reason ?? 'Could not assign table');
        pull();
        return;
      }
      const rSwap = s.controller.assignMatchToTable(incumbent, sourceTableId, [], `cmd-table-assign-${incumbent}-${ts}`);
      if (!rSwap.success) showError(rSwap.reason ?? 'Could not swap tables');
      pull();
      return;
    }

    if (incumbent && incumbent !== matchId) {
      const rClear = s.controller.clearMatchTableAssignment(
        incumbent,
        [],
        `cmd-table-clear-${incumbent}-${ts}`,
      );
      if (!rClear.success) {
        showError(rClear.reason ?? 'Could not clear table');
        pull();
        return;
      }
    }
    const r = s.controller.assignMatchToTable(matchId, tableId, [], `cmd-table-assign-${matchId}-${ts}`);
    if (!r.success) showCommandError(r, 'ui.fallback.assignTable');
    pull();
  }

  function overviewClearMatchFromTable(matchId: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.clearMatchTableAssignment(matchId, [], `cmd-table-clear-${matchId}-${Date.now()}`);
    if (!r.success) showCommandError(r, 'ui.fallback.clearTable');
    pull();
  }

  function doUndo(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.undoLast();
    if (!r.success) {
      showCommandError(r, 'ui.fallback.undoFailed');
    } else {
      showInfoKey('ui.undid_one_step_logged_as_undo_command');
    }
    pull();
  }

  function doRedo(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.redo();
    if (!r.success) {
      showCommandError(r, 'ui.fallback.redoFailed');
    } else {
      showInfoKey('ui.redo_removed_last_undo_from_the_log');
    }
    pull();
  }

  function addPlayer(): void {
    clearStatus();
    const s0 = getActiveSession();
    if (!s0) return;
    const name = newName.trim();
    if (!name) {
      showWarnKey('ui.enter_a_player_name');
      return;
    }
    const id = newId();
    const cmdId = `cmd-${id}`;
    const c = s0.controller;
    const cfg = s0.controller.getTournament().handicapConfig;
    const hc = cfg ? clampPlayerHandicapValue(cfg, Number(newHc) || 0) : 0;
    const misc = miscEnabled ? newMisc.trim() : '';
    if (miscEnabled && !misc) {
      showWarnKey('command.playerMiscRequired', { label: miscFieldLabel });
      return;
    }
    const r = c.createPlayer(id, name, hc, misc, cmdId);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.addPlayer');
      return;
    }
    const s = s0;
    const newOrder = [...s.playerOrder, id];
    const seedDeps = newOrder.map((pid) => `cmd-${pid}`);
    const seedCmdId = `cmd-seed-${crypto.randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const rSeed = c.setSeedings([...newOrder], seedDeps, seedCmdId);
    if (!rSeed.success) {
      showError(rSeed.reason ?? 'Could not update seeding order');
      pull();
      return;
    }
    patchActiveSession({ playerOrder: newOrder, lastSeedingCommandId: seedCmdId });
    const defs = c.getTournament().classDefinitions;
    // Single-class: opt in automatically. Multi-class: leave unassigned until the user picks classes.
    if (defs.length === 1) {
      const firstClassId = defs[0]!.id;
      const classCmdId = `cmd-pcf-${id}-${firstClassId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
      const rClass = c.setPlayerClassFlags(id, { [firstClassId]: true }, [`cmd-${id}`], classCmdId);
      if (!rClass.success) {
        showError(rClass.reason ?? 'Could not assign competition class');
        pull();
        return;
      }
    }
    newName = '';
    newHc = 0;
    newMisc = '';
    showInfoKey('ui.toast.addedPlayer', { name, id });
    pull();
  }

  async function generateKnockoutBracket(classId?: string): Promise<void> {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    const track = getCompetitionTrack(t, classId);
    if (Object.keys(track.groups).length === 0) {
      showWarnKey('ui.create_groups_group_phase_before_generating_the_');
      return;
    }
    const trackSeedings = trackBracketParticipants(t, classId);
    if (trackSeedings.length === 0) {
      showWarnKey('ui.add_at_least_one_player_first');
      return;
    }
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) {
      deps.push(s.lastSeedingCommandId);
    }
    const scgId = trackSetGroupsCommandId(s, classId);
    if (scgId) {
      deps.push(scgId);
    }
    const genId = `cmd-gen-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const shuffleKey = s.tournamentName.trim() || 'Tournament';
    const baseSalt = String(Date.now());
    let tieBreakSalt = baseSalt;

    if (bracketSeedingChoice === 'heuristic') {
      const participants = [...trackSeedings];
      bracketHeuristicSearch = { done: 0, total: HEURISTIC_BRACKET_SEARCH_TRIALS };
      try {
        const search = await searchBestHeuristicBracketOrderAsync(
          t,
          participants,
          classId,
          baseSalt,
          {
            trials: HEURISTIC_BRACKET_SEARCH_TRIALS,
            onProgress: (done, total) => {
              bracketHeuristicSearch = { done, total };
            },
          },
        );
        if (!search) {
          showErrorKey('ui.heuristic_bracket_seeding_could_not_be_computed_');
          return;
        }
        tieBreakSalt = search.tieBreakSalt;
        logHeuristicBracketSearchDebug(search, DEBUG_UI);
      } finally {
        bracketHeuristicSearch = null;
      }
    }

    runUiBatch(() => {
      const r = c.generateBracket(true, false, deps, genId, shuffleKey, {
        bracketSeedingMode: bracketSeedingChoice,
        tieBreakSalt,
        ...(classId !== undefined ? { classId } : {}),
      });
      if (!r.success) {
        showCommandError(r, 'ui.fallback.bracketGeneration');
        return;
      }
      const live = c.getTournament();
      const liveTrack = getCompetitionTrack(live, classId);
      const r1 = liveTrack.bracketMatches.filter((m) => bracketMatchRound(m) === 1 && m.seedA && m.seedB);
      if (r1.length === 0) {
        showWarnKey('ui.bracket_generated_but_no_round_1_pairings_with_t');
        return;
      }
      for (const bm of r1) {
        const mid = bracketPlayerMatchId(bm.id, classId);
        if (live.matches[mid]) continue;
        const a = bm.seedA!;
        const b = bm.seedB!;
        const createCmdId = `${genId}-pair-${bm.id}`;
        const rM = createBracketSeedPlayerMatch(
          c,
          live,
          mid,
          a,
          b,
          [genId, `cmd-${a}`, `cmd-${b}`],
          createCmdId,
          classId,
        );
        if (!rM.success) {
          showError(rM.reason ?? 'createMatch failed');
          return;
        }
      }
      if (getCompetitionTrack(c.getTournament(), classId).bracketMatches.length > 0) {
        if (classId) {
          patchActiveSession({ nav: { kind: 'multi', screen: { classId, inner: 'bracket' } } });
        } else {
          patchActiveSession({ nav: { kind: 'single', inner: 'bracket' } });
        }
      }
      const trialsNote =
        bracketSeedingChoice === 'heuristic'
          ? msgText('ui.toast.bracketGeneratedTrialsNote', {
              trials: String(HEURISTIC_BRACKET_SEARCH_TRIALS),
            })
          : '';
      showInfoKey('ui.toast.bracketGenerated', { trialsNote });
    });
  }

  function removeKnockoutBracket(classId?: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const track = getCompetitionTrack(tournament, classId);
    if (track.bracketMatches.length === 0) {
      showWarnKey('ui.no_knockout_bracket_to_remove');
      return;
    }
    if (anyBracketKnockoutMatchHasRecordedPlay(tournament, track.bracketMatches, classId)) {
      showWarnKey('model.cannotRemoveKnockoutBracketWithPlayedMatches');
      return;
    }
    if (!confirm(msgText('ui.confirm.removeBracketLong'))) {
      return;
    }
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const scgId = trackSetGroupsCommandId(s, classId);
    if (scgId) deps.push(scgId);
    const genId = trackGenerateBracketCommandId(s, classId);
    if (genId) deps.push(genId);
    const cmdId = `cmd-clear-bracket-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = s.controller.clearBracket(deps, cmdId, classId);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.removeBracket');
      pull();
      return;
    }
    showInfoKey('ui.knockout_bracket_removed_you_can_create_a_new_br');
    pull();
  }

  function eliminateBracketRoundByRanking(round: number, classId?: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const salt = crypto.randomUUID();
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const scgId = trackSetGroupsCommandId(s, classId);
    if (scgId) deps.push(scgId);
    const genId = trackGenerateBracketCommandId(s, classId);
    if (genId) deps.push(genId);
    const cmdId = `cmd-elim-r${round}-${salt.replaceAll('-', '').slice(0, 12)}`;
    const r = s.controller.eliminateLowestBracketRound(round, deps, salt, cmdId, classId);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.elimination');
      pull();
      return;
    }
    showInfoKey('ui.toast.eliminatedRound', bracketRoundParams(round));
    pull();
  }

  function commitPlayerUpdate(
    playerId: string,
    updates: { name?: string; handicap?: number; misc?: string },
  ): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const p = c.getTournament().players[playerId];
    if (!p) return;

    const nextName = updates.name !== undefined ? updates.name.trim() : p.name;
    if (!nextName) {
      showWarnKey('ui.enter_a_player_name');
      pull();
      return;
    }

    let hcArg: number | undefined;
    if (updates.handicap !== undefined) {
      const cfg = tournament.handicapConfig;
      if (!cfg) return;
      hcArg = clampPlayerHandicapValue(cfg, Number.isFinite(updates.handicap) ? updates.handicap : 0);
    }

    let miscArg: string | undefined;
    if (updates.misc !== undefined) {
      const trimmed = updates.misc.trim();
      if (miscEnabled && !trimmed) {
        showWarnKey('command.playerMiscRequired', { label: miscFieldLabel });
        pull();
        return;
      }
      miscArg = trimmed;
    }

    const currentMisc = (p.misc ?? '').trim();
    const nameChanged = nextName !== p.name;
    const hcChanged = hcArg !== undefined && hcArg !== p.handicap;
    const miscChanged = miscArg !== undefined && miscArg !== currentMisc;

    if (!nameChanged && !hcChanged && !miscChanged) return;

    const cmdId = `cmd-rp-${playerId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.renamePlayer(
      playerId,
      nextName,
      hcChanged ? hcArg : undefined,
      miscChanged ? miscArg : undefined,
      [`cmd-${playerId}`],
      cmdId,
    );
    if (!r.success) {
      showCommandError(
        r,
        updates.handicap !== undefined && updates.name === undefined && updates.misc === undefined
          ? 'ui.fallback.updateHandicap'
          : 'ui.fallback.updatePlayer',
      );
    } else if (nameChanged) {
      showInfoKey('ui.toast.playerNameUpdated', { name: nextName });
    } else if (hcChanged) {
      showInfoKey('ui.toast.handicapSet', { name: p.name, next: String(hcArg) });
    } else if (miscChanged) {
      showInfoKey('ui.toast.playerMiscUpdated', { name: p.name, label: miscFieldLabel });
    }
    pull();
  }

  function commitPlayerUpdateFromModal(updates: { name?: string; handicap?: number; misc?: string }): void {
    const pid = playerHistoryModalPid;
    if (!pid) return;
    commitPlayerUpdate(pid, updates);
  }

  function playerLabel(id: string | undefined): string {
    if (!id) return '—';
    return formatPlayerDisplayLabel(tournament, id);
  }

  function bracketRows(matches: BracketMatch[]): BracketMatch[] {
    return [...matches].sort(
      (a, b) => bracketMatchRound(a) - bracketMatchRound(b) || compareBracketMatchId(a, b),
    );
  }

  function setRoundLock(round: number, locked: boolean, classId?: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const r = c.setRoundLock(
      round,
      locked,
      [],
      `cmd-lock-${round}-${locked ? 'on' : 'off'}-${crypto.randomUUID().slice(0, 8)}`,
      classId,
    );
    if (!r.success) {
      showCommandError(r, 'ui.fallback.setRoundLock');
    } else {
      showInfo(locked ? `Locked bracket round ${round}.` : `Unlocked bracket round ${round}.`);
    }
    pull();
  }

  function downloadJsonl(): void {
    const s = getActiveSession();
    if (!s) {
      showWarnKey('ui.create_or_import_a_tournament_before_exporting');
      return;
    }
    const c = s.controller;
    const text = exportCommandsAsJsonLines(c.getCommandLog());
    const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugForFilename(s.tournamentName)}-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
    showInfoKey('ui.downloaded_command_log_jsonl');
  }

  function exportTournamentPdf(classId?: string): void {
    const s = getActiveSession();
    if (!s) {
      showWarnKey('ui.create_or_import_a_tournament_before_exporting');
      return;
    }
    try {
      downloadTournamentPdf(s.tournamentName, s.controller.getTournament(), getLocale(), {
        classId,
      });
      showInfoKey(classId ? 'ui.downloaded_class_summary_pdf' : 'ui.downloaded_tournament_summary_pdf');
    } catch (e) {
      showErrorKey('ui.toast.pdfFailed', { reason: e instanceof Error ? e.message : String(e) });
    }
  }

  function printMatchNotes(segment: MatchNotesSegment): void {
    const s = getActiveSession();
    if (!s) {
      showWarnKey('ui.create_or_import_a_tournament_before_exporting');
      return;
    }
    const t = s.controller.getTournament();
    const locale = getLocale();
    if (!matchNotesSegmentHasSlips(t, segment, locale)) {
      showWarnKey('ui.matchNotes.emptySegment');
      return;
    }
    try {
      openMatchNotesPdfInNewTab(s.tournamentName, t, segment, locale);
      showInfoKey('ui.toast.matchNotesOpened');
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (reason.includes('popup')) {
        showErrorKey('ui.toast.matchNotesPopupBlocked');
      } else {
        showErrorKey('ui.toast.pdfFailed', { reason });
      }
    }
  }

  async function onImportFile(ev: Event): Promise<void> {
    if (tournamentLoad) return;
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    clearStatus();
    const tournamentName = titleFromImportFilename(file.name);
    let text: string;
    try {
      tournamentLoad = { label: tournamentName, phase: 'read', done: 0, total: 0 };
      text = await file.text();
    } catch (e) {
      tournamentLoad = null;
      showErrorKey('ui.toast.importFailed', { reason: e instanceof Error ? e.message : String(e) });
      return;
    }
    const formatErr = validateCommandLogFormat(text);
    if (formatErr) {
      tournamentLoad = null;
      showErrorKey('command.dynamicError', { message: formatErr.message });
      return;
    }
    const { controller: next, replay } = await buildControllerFromCommandLogWithProgress(text, tournamentName);
    if (!replay.success) {
      const reason = replay.results.find((r) => !r.success)?.reason ?? 'Replay failed';
      showErrorKey('ui.toast.importFailed', { reason });
      return;
    }
    const exported = exportCommandsAsJsonLines(next.getCommandLog());
    let storageFileId: string;
    if (storageAvailable) {
      try {
        storageFileId = await importTournamentJsonl(exported, tournamentName);
        seedPersistSnapshot(storageFileId, tournamentName, exported);
        await refreshRecentTournaments();
      } catch (e) {
        showErrorKey('ui.toast.importSaveFailed', {
          reason: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    } else {
      storageFileId = newTournamentFileId();
    }
    const session = sessionFromController(storageFileId, tournamentName, next);
    activateSession(session);
    logDebugReplayExecuteProfile(tournamentName, replay.executeProfile);
    showInfoKey('ui.toast.imported', { file: file.name, count: String(replay.results.length) });
  }

  function submitScores(match: Match): void {
    clearStatus();
    const rows = scoreDrafts()[match.id];
    if (!rows) {
      showErrorKey('ui.internal_no_score_draft_for_this_match');
      return;
    }
    const scores = scoresForSubmitFromRows(rows);
    if (!scores) {
      scoreModalHint =
        'Complete each game in order (11+ with a two-point margin; above 11 the gap must be exactly two). The match must end with one player on three game wins (best of five).';
      return;
    }
    const pairingPred = (x: BracketMatch) =>
      Boolean(
        x.seedA &&
          x.seedB &&
          ((x.seedA === match.playerA && x.seedB === match.playerB) ||
            (x.seedA === match.playerB && x.seedB === match.playerA)),
      );
    let bm: BracketMatch | undefined;
    if (match.id.startsWith('match-')) {
      const parsed = parseBracketPlayerMatchId(tournament, match.id);
      if (parsed) {
        bm = bracketMatchBySlotId(tournament, parsed.bracketSlotId, parsed.classId);
      }
    }
    if (!bm) {
      bm = tournament.bracketMatches.find(pairingPred);
    }
    if (!bm) {
      for (const sl of Object.values(tournament.classTournaments)) {
        bm = sl.bracketMatches.find(pairingPred);
        if (bm) break;
      }
    }
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const createCmdId = bm ? c.findLatestActiveCreateMatchCommandId(match.id) : undefined;
    const deps = createCmdId ? [createCmdId] : [];
    const r = c.enterScore(match.id, scores, deps, `cmd-score-${match.id}-${Date.now()}`);
    if (!r.success) {
      scoreModalHint = r.reason ?? 'enterScore failed';
      showError(r.reason ?? 'enterScore failed');
      pull();
      return;
    }
    showInfoKey('ui.toast.savedScores', { id: match.id });
    closeScoreModal();
    pull();
  }

  /** DEBUG: random legal BO5, write drafts, then same path as Save match. */
  function debugSimulateOpenScoreModalMatch(): void {
    if (!DEBUG_UI) return;
    clearStatus();
    scoreModalHint = null;
    const sm = scoreModalTargetMatch();
    if (!sm) return;
    if (!scoreModalCanEditGames()) {
      scoreModalHint = 'This match cannot be edited (locked or downstream scores exist).';
      return;
    }
    const rng = Math.random;
    let scores: GameScore[] = [];
    for (let i = 0; i < 20; i++) {
      scores = debugRandomLegalBo5Scores(rng);
      if (isMatchScoreLegal(scores)) break;
    }
    if (!isMatchScoreLegal(scores)) {
      scoreModalHint = 'Internal: could not generate legal scores.';
      return;
    }
    const rows = normalizeScoreRows(gameScoresToDraftRows(scores));
    setScoreDrafts({ ...scoreDrafts(), [sm.id]: rows });
    submitScores(sm);
  }

  function forfeitPhaseLabel(phase: 'group' | 'bracket'): string {
    return phase === 'group' ? msgText('ui.phase.group') : msgText('ui.phase.bracket');
  }

  function summarizeLastCommand(cmd: Command, t: Tournament): ResolvedMessage {
    const pn = (id: string | undefined) => (id && t.players[id]?.name) || id || '—';
    const tn = (id: string | undefined) => (id && t.teams[id]?.name) || id || '—';
    switch (cmd.type) {
      case 'CreatePlayer':
        return msg('ui.summary.addedPlayer', { name: cmd.payload.name });
      case 'RenamePlayer':
        return msg('ui.summary.updatedPlayer', { name: pn(cmd.payload.playerId) });
      case 'SetSeedings':
        return msg('ui.summary.setSeeding', { count: String(cmd.payload.playerIds.length) });
      case 'SetHandicapConfig': {
        const cfg = cmd.payload.config;
        if (!cfg) return msg('ui.summary.disabledHandicap');
        const crit =
          cfg.startingCriteria === 'minus_points'
            ? msgText('ui.summary.critMinusPoints')
            : msgText('ui.summary.critHeadstart');
        return msg('ui.summary.handicapConfig', {
          min: String(cfg.minValue),
          max: String(cfg.maxValue),
          crit,
          adj: String(cfg.maxStartAdjustment),
        });
      }
      case 'SetMiscConfig': {
        const cfg = cmd.payload.config;
        if (!cfg) return msg('ui.summary.disabledMisc');
        return msg('ui.summary.miscConfig', { label: cfg.label });
      }
      case 'EnterScore': {
        const m = t.matches[cmd.payload.matchId];
        return m
          ? msg('ui.summary.enteredScores', { a: pn(m.playerA), b: pn(m.playerB) })
          : msg('ui.summary.enteredMatchScores');
      }
      case 'ClearMatchScores': {
        const m = t.matches[cmd.payload.matchId];
        return m
          ? msg('ui.summary.clearedScores', { a: pn(m.playerA), b: pn(m.playerB) })
          : msg('ui.summary.clearedMatchScores');
      }
      case 'EnterTeamScore': {
        const tm = t.teamMatches[cmd.payload.matchId];
        return tm
          ? msg('ui.summary.enteredTeamScores', { a: tn(tm.teamA), b: tn(tm.teamB) })
          : msg('ui.summary.enteredTeamMatchScores');
      }
      case 'CreateMatch':
        return msg('ui.summary.createdMatch', {
          a: pn(cmd.payload.playerA),
          b: pn(cmd.payload.playerB),
        });
      case 'CreateTeam':
        return msg('ui.summary.createdTeam', { name: cmd.payload.name });
      case 'CreateTeamMatch':
        return msg('ui.summary.createdTeamMatch', {
          a: tn(cmd.payload.teamA),
          b: tn(cmd.payload.teamB),
        });
      case 'GenerateBracket': {
        const mode = cmd.payload.bracketSeedingMode ?? 'heuristic';
        const label =
          mode === 'closed_form' || mode === 'crop_closed_form'
            ? msgText('ui.summary.seedingClosedForm')
            : mode === 'extend_closed_form'
              ? msgText('ui.summary.seedingExtendedClosedForm')
              : msgText('ui.summary.seedingHeuristic');
        return msg('ui.summary.generatedBracket', { label });
      }
      case 'ClearBracket':
        return msg('ui.summary.removedBracket');
      case 'EliminateLowestBracketRound':
        return msg('ui.summary.eliminatedRound', bracketRoundParams(cmd.payload.round));
      case 'GenerateGroupRoundRobin':
        return cmd.payload.classId
          ? msg('ui.summary.generatedRoundRobinClass')
          : msg('ui.summary.generatedRoundRobin');
      case 'SetGroups': {
        if ('groups' in cmd.payload) {
          const n = cmd.payload.groups.length;
          if (n === 0) return msg('ui.summary.clearedGroups');
          return n === 1
            ? msg('ui.summary.updatedGroupsOne')
            : msg('ui.summary.updatedGroupsMany', { n: String(n) });
        }
        return msg('ui.summary.createdGroupsFromSeeding');
      }
      case 'SetClassGroups': {
        const cname = t.classDefinitions.find((c) => c.id === cmd.payload.classId)?.name ?? cmd.payload.classId;
        if ('groups' in cmd.payload) {
          const n = cmd.payload.groups.length;
          return n === 0
            ? msg('ui.summary.clearedGroupsForClass', { cname })
            : msg('ui.summary.updatedGroupsForClass', { cname });
        }
        return msg('ui.summary.createdGroupsForClass', { cname });
      }
      case 'SetTournamentClasses':
        return msg('ui.summary.setCompetitionClasses', { count: String(cmd.payload.classes.length) });
      case 'AddTournamentClass':
        return msg('ui.summary.addedCompetitionClass', { name: String(cmd.payload.name).trim() });
      case 'SetPlayerClassFlags':
        return msg('ui.summary.updatedClassFlags', { name: pn(cmd.payload.playerId) });
      case 'SetRoundLock':
        return cmd.payload.locked
          ? msg('ui.summary.lockedRound', bracketRoundParams(cmd.payload.bracketRound))
          : msg('ui.summary.unlockedRound', bracketRoundParams(cmd.payload.bracketRound));
      case 'AssignTables':
        return msg('ui.summary.assignedTables');
      case 'SetTournamentTables': {
        const n = cmd.payload.tableIds.length;
        return n === 1
          ? msg('ui.summary.setUpTables', { count: '1', suffix: '' })
          : msg('ui.summary.setUpTables', { count: String(n), suffix: 's' });
      }
      case 'AssignMatchToTable': {
        const m = t.matches[cmd.payload.matchId];
        const table = cmd.payload.tableId;
        return m
          ? msg('ui.summary.startedOnTable', { table, a: pn(m.playerA), b: pn(m.playerB) })
          : msg('ui.summary.assignedMatchToTable', { table });
      }
      case 'ClearMatchTableAssignment': {
        const m = t.matches[cmd.payload.matchId];
        return m
          ? msg('ui.summary.clearedTable', { a: pn(m.playerA), b: pn(m.playerB) })
          : msg('ui.summary.clearedTableAssignment');
      }
      case 'AdvanceBracketRound':
        return msg('ui.summary.advancedBracketRound');
      case 'PlayerForfeit':
        return msg('ui.summary.playerForfeit', { phase: forfeitPhaseLabel(cmd.payload.phase) });
      case 'TeamForfeit':
        return msg('ui.summary.teamForfeit', { phase: forfeitPhaseLabel(cmd.payload.phase) });
      case 'Undo':
        return msg('ui.summary.undo');
      default: {
        const unknown = cmd as Command;
        return msg('ui.summary.unhandledCommand', { type: unknown.type });
      }
    }
  }

  const useClassTabs = $derived(tournamentUsesClassTabs(tournament));

  const overviewTableCount = $derived(tournament.tables.length);

  const activeSess = $derived(getActiveSession());
  const showFormatStub = $derived(Boolean(activeSess && activeSess.tournamentFormat !== 'group-bracket'));

  const lastCommandSummary = $derived.by((): ResolvedMessage => {
    void getLocale();
    const s = getActiveSession();
    if (!s) return { text: '', isFallback: false };
    const t = tournament;
    const log = s.controller.getCommandLog();
    if (log.length === 0) return msg('ui.noActionsYet');
    return summarizeLastCommand(log[log.length - 1]!, t);
  });

  /** Footer redo: must track command log — `canRedo()` alone is not a Svelte dependency. */
  const footerRedoEnabled = $derived.by((): boolean => {
    const s = getActiveSession();
    if (!s) return false;
    const log = s.controller.getCommandLog();
    void log.length;
    void log[log.length - 1]?.id;
    void tournament;
    return s.controller.canRedo();
  });

  const singleTrackRestTabs = $derived.by((): Array<{ id: InnerTab; labelKey: MessageKey }> => {
    void getLocale();
    const tabs: Array<{ id: InnerTab; labelKey: MessageKey }> = [
      { id: 'groups', labelKey: 'ui.group_phase' },
      { id: 'bracket', labelKey: 'ui.bracket' },
    ];
    if (tournament.bracketMatches.length > 0) {
      tabs.push({ id: 'results', labelKey: 'ui.results' });
    }
    return tabs;
  });

  const classSubTabsList = $derived.by((): Array<{ id: ClassInnerTab; labelKey: MessageKey }> => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'multi' || s.nav.screen === 'players' || s.nav.screen === 'overview') {
      return [];
    }
    const cid = s.nav.screen.classId;
    const rounds = uniqueSortedRounds(classSlice(tournament, cid).bracketMatches);
    void getLocale();
    const tabs: Array<{ id: ClassInnerTab; labelKey: MessageKey }> = [
      { id: 'groups', labelKey: 'ui.group_phase' },
      { id: 'bracket', labelKey: 'ui.bracket' },
    ];
    if (rounds.length > 0) {
      tabs.push({ id: 'results', labelKey: 'ui.results' });
    }
    return tabs;
  });

  const showOverviewPanel = $derived.by(() => {
    const s = getActiveSession();
    if (!s) return false;
    if (s.nav.kind === 'single') return s.nav.inner === 'overview';
    return s.nav.screen === 'overview';
  });

  const showPlayersPanel = $derived.by(() => {
    const s = getActiveSession();
    if (!s) return false;
    if (s.nav.kind === 'single') return s.nav.inner === 'players';
    return s.nav.screen === 'players';
  });

  const playersTabPlayerIds = $derived.by(() => {
    const s = getActiveSession();
    if (!s) return [];
    const ids = s.playerOrder;
    if (playersTabSort === 'alphabetical') {
      void getLocale();
      return sortPlayerIdsByName(tournament, ids, getLocale());
    }
    return sortPlayerIdsByRecentFirst(ids);
  });

  const multiClassScreen = $derived.by((): { classId: string; inner: ClassInnerTab } | null => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'multi') return null;
    if (s.nav.screen === 'players' || s.nav.screen === 'overview') return null;
    return s.nav.screen;
  });

  const singleTrackInner = $derived.by((): InnerTab | null => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'single') return null;
    return s.nav.inner;
  });

  function togglePlayerClass(playerId: string, classId: string, checked: boolean): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const cmdId = `cmd-pcf-${playerId}-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const r = c.setPlayerClassFlags(playerId, { [classId]: checked }, [`cmd-${playerId}`], cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not update class flags');
    }
    pull();
  }

  function openAddClassModal(): void {
    addClassDraftName = '';
    addClassError = null;
    addClassModalOpen = true;
  }

  function cancelAddClassModal(): void {
    addClassModalOpen = false;
    addClassDraftName = '';
    addClassError = null;
  }

  function confirmAddCompetitionClass(): void {
    const name = addClassDraftName.trim();
    if (!name) {
      addClassError = msgText('command.classNeedsDisplayName');
      return;
    }
    const s = getActiveSession();
    if (!s) return;
    clearStatus();
    addClassError = null;
    const beforeIds = new Set(s.controller.getTournament().classDefinitions.map((c) => c.id));
    const cmdId = `cmd-add-class-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = s.controller.addTournamentClass(name, [], cmdId);
    if (!r.success) {
      showCommandError(r, 'ui.fallback.addCompetitionClass');
      return;
    }
    const t = getActiveSession()?.controller.getTournament();
    const newDef = t?.classDefinitions.find((c) => !beforeIds.has(c.id));
    const newId = newDef?.id ?? t?.classDefinitions[t.classDefinitions.length - 1]?.id;
    if (newId) {
      patchActiveSession({ nav: { kind: 'multi', screen: { classId: newId, inner: 'groups' } } });
    }
    pull();
    cancelAddClassModal();
  }

  pull();

  onMount(() => {
    void refreshRecentTournaments();
    if (import.meta.env.VITE_E2E === 'true') {
      installTestBridge({
        getActiveSession: () => {
          const s = getActiveSession();
          if (!s) return undefined;
          return {
            tournamentName: s.tournamentName,
            controller: s.controller,
          };
        },
      });
    }
    return () => {
      if (import.meta.env.VITE_E2E === 'true') uninstallTestBridge();
    };
  });
</script>

<div class="app" class:app-with-footer={Boolean(activeSess)}>
  <div class="app-sticky-head">
    <header class="top-bar">
      <div class="brand">
        <span class="brand-mark"><Msg key="ui.ttcb" /></span>
        <span class="brand-text"><Msg key="ui.tornooiapp" /></span>
      </div>
      <div class="top-bar-actions">
        <nav class="workspace-tabs" aria-label={msgText('ui.workspace')}>
          <button
            type="button"
            class="workspace-tab"
            class:active={workspaceTab === 'settings'}
            onclick={() => selectWorkspaceTab('settings')}
          >
            <Msg key="ui.settings" />
          </button>
          {#each sessions as s (s.id)}
            <button
              type="button"
              class="workspace-tab"
              class:active={workspaceTab === s.id}
              onclick={() => selectWorkspaceTab(s.id)}
            >
              {s.tournamentName}
            </button>
          {/each}
        </nav>
        {#if workspaceTab !== 'settings' && activeSess}
          <button
            type="button"
            class="session-close-btn"
            data-testid="session-close"
            title={msgText('ui.close_tournament')}
            aria-label={msgText('ui.close_tournament') + ' ' + activeSess.tournamentName}
            onclick={() => void closeActiveSession()}
          >
            <span aria-hidden="true">×</span>
          </button>
        {/if}
        <nav class="lang-switch" aria-label={msgText('ui.lang.aria')}>
          <button
            type="button"
            class="lang-btn"
            class:active={getLocale() === 'en'}
            onclick={() => setLocale('en')}>EN</button
          >
          <button
            type="button"
            class="lang-btn"
            class:active={getLocale() === 'nl'}
            onclick={() => setLocale('nl')}>NL</button
          >
        </nav>
      </div>
    </header>

    {#if status}
      <div
        class="banner status-banner"
        class:status-banner--warn={status.kind === 'warn'}
        class:status-banner--error={status.kind === 'error'}
        role={status.kind === 'error' ? 'alert' : 'status'}
        data-testid="status-banner"
      >
        {#if statusResolved}
          <span class:i18n-fallback={statusResolved.isFallback}>{statusResolved.text}</span>
        {/if}
      </div>
    {/if}
  </div>

  <main class="main" class:main--tournament={workspaceTab !== 'settings'}>
    {#if workspaceTab === 'settings'}
      <section class="card settings-card">
        <h1 class="h1"><Msg key="ui.tournament_management" /></h1>

        <div class="settings-grid">
          <div class="settings-block">
            <h2 class="h2"><Msg key="ui.data" /></h2>
            <div class="btn-row">
              <label class="file-btn">
                <Msg key="ui.import.tournament" />
                <input type="file" accept=".jsonl,.txt,application/json,text/plain" class="sr" data-testid="import-jsonl" onchange={onImportFile} />
              </label>
            </div>
            {#if !storageAvailable}
              <Msg key="ui.settings.localSaveUnavailable" tag="p" class="muted small" />
            {/if}
          </div>

          <div class="settings-block new-tournament-block">
            <h2 class="h2"><Msg key="ui.new_tournament" /></h2>
            <div class="draft-top-fields">
              <label class="field-block draft-name-field">
                <span class="field-label"><Msg key="ui.name" /></span>
                <input
                  class="draft-tournament-name-input"
                  type="text"
                  data-testid="wizard-name"
                  bind:value={draftTournamentName}
                  maxlength="120"
                  autocomplete="off"
                />
              </label>
              <label class="field-block draft-tables-field">
                <span class="field-label"><Msg key="ui.settings.tablesLabel" /></span>
                <input type="number" min="1" max="32" step="1" data-testid="wizard-tables" bind:value={draftTableCount} />
              </label>
            </div>

            <fieldset class="type-fieldset">
              <legend class="field-label"><Msg key="ui.tournament_type" /></legend>
              <label class="radio-line">
                <input type="radio" name="draft-tournament-format" value="group-bracket" bind:group={draftTournamentFormat} />
                <span><Msg key="ui.group_phase_brackets" /></span>
              </label>
              <label class="radio-line radio-line-disabled">
                <input type="radio" name="draft-tournament-format" value="bracket-only" disabled />
                <span><Msg key="ui.direct_to_brackets" /> <span class="muted small"><Msg key="ui.settings.comingSoon" /></span></span>
              </label>
              <label class="radio-line radio-line-disabled">
                <input type="radio" name="draft-tournament-format" value="team-vs-team" disabled />
                <span><Msg key="ui.team_vs_team" /> <span class="muted small"><Msg key="ui.settings.comingSoon" /></span></span>
              </label>
            </fieldset>

            <label class="checkbox-line">
              <input type="checkbox" data-testid="wizard-handicap" bind:checked={draftHandicapEnabled} />
              <span><Msg key="ui.include_handicap_for_players" /></span>
            </label>

            {#if draftHandicapEnabled}
              <fieldset class="type-fieldset handicap-config-fieldset">
                <legend class="field-label"><Msg key="ui.handicap_system" /></legend>
                <label class="radio-line">
                  <input type="radio" name="draft-handicap-system" value="numerical" checked disabled={false} />
                  <span><strong><Msg key="ui.numerical" /></strong><Msg key="ui.settings.ratingRangeTitle" tag="span" /></span>
                </label>
                <label class="radio-line radio-line-disabled">
                  <input type="radio" name="draft-handicap-system" value="classification" disabled />
                  <span
                    ><strong><Msg key="ui.classification_based" /></strong>
                    <span class="muted small"><Msg key="ui.settings.mockComingSoon" /></span></span
                  >
                </label>
                <div class="handicap-config-grid">
                  <label>
                    <span class="field-label"><Msg key="ui.min_rating" /></span>
                    <input type="number" min="0" step="1" bind:value={draftHandicapMin} />
                  </label>
                  <label>
                    <span class="field-label"><Msg key="ui.max_rating" /></span>
                    <input type="number" min="0" step="1" bind:value={draftHandicapMax} />
                  </label>
                  <label class="handicap-config-span">
                    <span class="field-label"><Msg key="ui.starting_criteria" /></span>
                    <select bind:value={draftHandicapStartingCriteria}>
                      <option value="headstart"><Msg key="ui.headstart_for_weaker_player" /></option>
                      <option value="minus_points"><Msg key="ui.minus_points_for_stronger_player" /></option>
                    </select>
                  </label>
                  <label>
                    <span class="field-label"><Msg key="ui.max_start_adjustment" /></span>
                    <input type="number" min="0" step="1" bind:value={draftHandicapMaxStart} title={msgText('ui.maximum_absolute_headstart_or_negative_start')} />
                  </label>
                </div>
              </fieldset>
            {/if}

            <div class="checkbox-line checkbox-line-misc">
              <label class="checkbox-misc-toggle">
                <input type="checkbox" bind:checked={draftMiscEnabled} />
                <Msg key="ui.include_misc_for_players_before" />
              </label>
              <input
                type="text"
                class="misc-label-inline"
                bind:value={draftMiscLabel}
                maxlength="40"
                placeholder={msgText('ui.misc.defaultLabel')}
                autocomplete="off"
              />
              <span><Msg key="ui.include_misc_for_players_after" /></span>
            </div>

            <label class="checkbox-line">
              <input type="checkbox" data-testid="wizard-classes" bind:checked={draftClassesEnabled} />
              <span><Msg key="ui.use_competition_classes" /></span>
            </label>

            {#if draftClassesEnabled}
              <div class="sub-card draft-classes">
                <h3 class="h3"><Msg key="ui.competition_classes" /></h3>
                <table class="grid class-grid">
                  <thead>
                    <tr>
                      <th><Msg key="ui.display_name" /></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each draftClassEditorRows as row, ri (row.id)}
                      <tr>
                        <td>
                          <input
                            class="grow"
                            type="text"
                            value={row.name}
                            maxlength="80"
                            autocomplete="off"
                            aria-label={msgText('ui.class_display_name')}
                            oninput={(e) => updateDraftClassRow(ri, (e.currentTarget as HTMLInputElement).value)}
                          />
                        </td>
                        <td>
                          <button type="button" class="btn ghost small-inline" onclick={() => removeDraftClassRow(ri)}>
                            <Msg key="ui.remove" />
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                <div class="btn-row">
                  <button type="button" class="btn" onclick={addDraftClassRow}><Msg key="ui.add_class_row" /></button>
                </div>
              </div>
            {/if}

            <div class="btn-row">
              <button type="button" class="btn primary" data-testid="wizard-create" onclick={createTournamentFromWizard}><Msg key="ui.create_tournament" /></button>
            </div>
          </div>

          <div class="settings-block">
            <h2 class="h2"><Msg key="ui.recent_activity" /></h2>
            {#if !storageAvailable}
              <Msg key="ui.settings.recentOpfsRequired" tag="p" class="muted small" />
            {:else if recentListLoading && recentTournaments.length === 0}
              <p class="muted"><Msg key="ui.loading" /></p>
            {:else if recentTournaments.length === 0}
              <Msg key="ui.settings.noSavedTournaments" tag="p" class="muted" />
            {:else}
              <ul class="recent-list">
                {#each recentTournaments as entry (entry.fileId)}
                  <li class="recent-entry-row">
                    <button
                      type="button"
                      class="recent-entry-btn"
                      data-testid="recent-{entry.tournamentName}"
                      disabled={tournamentLoad !== null}
                      onclick={() => openStoredTournament(entry.fileId)}
                    >
                      <span class="recent-entry-name">{entry.tournamentName}</span>
                      <span class="recent-entry-date muted small">{formatRecentDate(entry.lastModified)}</span>
                    </button>
                    <button
                      type="button"
                      class="recent-delete-btn"
                      data-testid="recent-delete-{entry.tournamentName}"
                      title={msgText('ui.delete_saved_tournament')}
                      aria-label={msgText('ui.aria.deleteNamed', { name: entry.tournamentName })}
                      onclick={() => openDeleteTournamentModal(entry)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      </section>
    {:else}
      {#if activeSess}
      <div class="tournament-shell">
        {#if showFormatStub}
          <div class="banner format-banner" role="status">
            <Msg
              key="ui.format.onlyGroupPhaseImplemented"
              params={{ format: msgText('ui.group_phase_brackets') }}
              tag="span"
            />
          </div>
        {/if}
        <div class="tournament-toolbar">
          <div class="title-block">
            <label class="title-label" for="tm-name-input"><Msg key="ui.tournament_name" /></label>
            <div class="title-row">
              <input
                id="tm-name-input"
                class="title-input"
                type="text"
                bind:value={nameDraft}
                maxlength="120"
                autocomplete="off"
                spellcheck={false}
                onfocus={() => {
                  nameInputFocused = true;
                }}
                onblur={() => {
                  commitTournamentName();
                  nameInputFocused = false;
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <button
                type="button"
                class="btn ghost title-export-btn"
                data-testid="export-jsonl"
                title={msgText('ui.download_command_log_jsonl')}
                onclick={downloadJsonl}
              >
                <Msg key="ui.export.tournamentFile" />
              </button>
              <button
                type="button"
                class="btn ghost title-export-btn"
                data-testid="export-pdf"
                title={msgText('ui.download_groups_bracket_and_results_summary_pdf')}
                onclick={() => exportTournamentPdf()}
              >
                <Msg key="ui.export.tournamentPdf" />
              </button>
            </div>
          </div>
        </div>

        <nav class="inner-tabs" aria-label={msgText('ui.tournament_sections')}>
          <button
            type="button"
            class="inner-tab"
            data-testid="tab-overview"
            class:active={showOverviewPanel}
            onclick={selectOverviewNav}
          >
            <Msg key="ui.overview" />
          </button>
          <button
            type="button"
            class="inner-tab"
            data-testid="tab-players"
            class:active={showPlayersPanel}
            onclick={selectPlayersNav}
          >
            <Msg key="ui.players" />
          </button>
          {#if useClassTabs}
            {#each tournament.classDefinitions as c (c.id)}
              <button
                type="button"
                class="inner-tab"
                class:active={multiClassScreen?.classId === c.id}
                onclick={() => selectClassTopTab(c.id)}
              >
                {c.name}
              </button>
            {/each}
            <button
              type="button"
              class="inner-tab inner-tab-add-class"
              aria-label={msgText('ui.classes.addAria')}
              title={msgText('ui.classes.addAria')}
              onclick={openAddClassModal}
            >
              <Msg key="ui.classes.add" />
            </button>
          {:else}
            {#each singleTrackRestTabs as tab (tab.id)}
              <button
                type="button"
                class="inner-tab"
                data-testid="tab-{tab.id}"
                class:active={singleTrackInner === tab.id}
                onclick={() => selectSingleTrackTab(tab.id)}
              >
                <Msg key={tab.labelKey} />
              </button>
            {/each}
          {/if}
        </nav>

        {#if useClassTabs && multiClassScreen}
          {@const classPdfDef = tournament.classDefinitions.find((x) => x.id === multiClassScreen.classId)}
          <nav class="inner-tabs inner-tabs-sub class-track-tabs" aria-label={msgText('ui.class_track_sections')}>
            {#each classSubTabsList as tab (tab.id)}
              <button
                type="button"
                class="inner-tab"
                class:active={multiClassScreen.inner === tab.id}
                onclick={() => selectClassSubTab(multiClassScreen.classId, tab.id)}
              >
                <Msg key={tab.labelKey} />
              </button>
            {/each}
            <button
              type="button"
              class="btn ghost subtle class-track-export-btn"
              data-testid="export-class-pdf"
              title={msgText('ui.export.classPdfTitle', { name: classPdfDef?.name ?? multiClassScreen.classId })}
              onclick={() => exportTournamentPdf(multiClassScreen.classId)}
            >
              <Msg key="ui.export.classPdfShort" />
            </button>
          </nav>
        {/if}

        <div class="inner-panels">
          {#if showOverviewPanel}
            <section class="card">
              <h2 class="h2"><Msg key="ui.overview" /></h2>
              <TournamentOverview
                {tournament}
                useClassTabs={useClassTabs}
                groupDisplayLabel={groupDisplayLabel}
                tableCount={overviewTableCount}
                showDebugUi={DEBUG_UI}
                onIncrementTables={incrementOverviewTableCount}
                onDecrementTables={decrementOverviewTableCount}
                onOpenGroupMatch={openScoreModal}
                onOpenBracketSlot={openBracketPairingModal}
                onOpenTableMatch={openTableMatch}
                onAssignMatchToTable={overviewAssignMatchToTable}
                onClearMatchFromTable={overviewClearMatchFromTable}
                onDebugSimulateTables={debugSimulateOverviewTableMatches}
                onDebugFillReadyTables={debugFillOverviewEmptyTables}
                onPrintMatchNotes={printMatchNotes}
              />
            </section>
          {:else if showPlayersPanel}
            <section class="card">
              <h2 class="h2"><Msg key="ui.players" /></h2>

              <form
                class="row"
                onsubmit={(e) => {
                  e.preventDefault();
                  addPlayer();
                }}
              >
                <input class="grow" data-testid="player-name-input" placeholder={msgText('ui.name')} bind:value={newName} autocomplete="off" />
                {#if miscEnabled}
                  <label class="hc-add-wrap" for="new-player-misc">
                    <span class="hc-label">{miscFieldLabel}</span>
                    <input
                      id="new-player-misc"
                      class="hc grow"
                      type="text"
                      bind:value={newMisc}
                      maxlength="80"
                      autocomplete="off"
                      placeholder={miscFieldLabel}
                    />
                  </label>
                {/if}
                {#if handicapEnabled}
                  <label class="hc-add-wrap" for="new-player-hc">
                    <span class="hc-label"><Msg key="ui.handicap" /></span>
                    <input
                      id="new-player-hc"
                      class="hc"
                      type="number"
                      bind:value={newHc}
                      min={handicapBounds.min}
                      max={handicapBounds.max}
                      step="1"
                      title={msgText('ui.handicap.rangeTitle', {
                        min: String(handicapBounds.min),
                        max: String(handicapBounds.max),
                      })}
                    />
                  </label>
                {/if}
                <button type="submit" class="btn primary" data-testid="player-add-btn"><Msg key="ui.add_player" /></button>
              </form>
              {#if DEBUG_UI}
                <div class="row align-end gap-sm debug-fill-row">
                  <label class="row align-center gap-sm">
                    <span class="muted small"><Msg key="ui.players.hashToAdd" tag="span" class="muted small" /></span>
                    <input
                      class="debug-fill-count"
                      type="text"
                      data-testid="debug-fill-count"
                      inputmode="numeric"
                      autocomplete="off"
                      aria-label={msgText('ui.number_of_players_to_add_debug')}
                      bind:value={debugFillPlayerCount}
                    />
                  </label>
                  <button type="button" class="btn subtle" data-testid="debug-fill-btn" onclick={debugFillPlayers}><Msg key="ui.players.debugFill" /></button>
                </div>
              {/if}
              <div class="players-sort-row">
                <label class="players-sort-label">
                  <span class="muted small"><Msg key="ui.players.sortLabel" /></span>
                  <select
                    class="players-sort-select"
                    aria-label={msgText('ui.players.sortLabel')}
                    value={playersTabSort}
                    onchange={(e) =>
                      setPlayersTabSort((e.currentTarget as HTMLSelectElement).value as PlayersTabSortMode)}
                  >
                    <option value="recent"><Msg key="ui.players.sort.recent" /></option>
                    <option value="alphabetical"><Msg key="ui.players.sort.alphabetical" /></option>
                  </select>
                </label>
              </div>
              <ol class="seed-list">
                {#each playersTabPlayerIds as pid (pid)}
                  <li class="player-row">
                    <div class="player-main">
                      <button
                        type="button"
                        class="name player-name-btn"
                        aria-label={msgText('ui.players.openDetails', { name: playerLabel(pid) })}
                        onclick={() => openPlayerHistoryModal(pid)}
                      >
                        {playerLabel(pid)}
                      </button>
                      <code class="pid">{pid}</code>
                    </div>
                    {#if tournament.classDefinitions.length > 0}
                      <div class="player-classes">
                        {#each tournament.classDefinitions as def (def.id)}
                          <label class="chk tight">
                            <input
                              type="checkbox"
                              checked={Boolean(classFlagDrafts[pid]?.[def.id])}
                              onchange={(e) =>
                                togglePlayerClass(
                                  pid,
                                  def.id,
                                  (e.currentTarget as HTMLInputElement).checked,
                                )}
                            />
                            {def.name}
                          </label>
                        {/each}
                      </div>
                    {/if}
                  </li>
                {/each}
              </ol>
            </section>
          {:else if !useClassTabs && singleTrackInner === 'groups'}
            <section class="card">
              <h2 class="h2"><Msg key="ui.group_phase" /></h2>
              {#if tournament.bracketMatches.length > 0}
                <p class="group-lock-banner">
                  <Msg key="ui.group.knockoutActiveLock" tag="p" class="group-lock-banner" />
                </p>
              {/if}
              {#if Object.keys(tournament.groups).length === 0}
                <p class="muted small">
                  {#if globalGroupPlayerCount === 0}
                    <Msg key="ui.group.addPlayersFirst" />
                  {:else}
                    <Msg key="ui.group.allSeededIncluded" params={{ count: String(doublesEnabledForTrack(undefined) ? globalGroupParticipantCount : globalGroupPlayerCount) }} />
                  {/if}
                </p>
                <label class="group-doubles-option">
                  <input
                    type="checkbox"
                    data-testid="group-doubles"
                    disabled={tournament.bracketMatches.length > 0}
                    checked={doublesEnabledForTrack(undefined)}
                    onchange={(e) =>
                      setDoublesEnabledForTrack(undefined, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  <Msg key="ui.group.doublesRandomPartners" />
                </label>
                {#if doublesEnabledForTrack(undefined) && globalGroupPlayerCount % 2 !== 0}
                  <p class="muted small"><Msg key="ui.group.doublesEvenCountRequired" /></p>
                {/if}
                <div class="group-create-row">
                  <input
                    class="group-create-num"
                    type="number"
                    min="1"
                    step="1"
                    disabled={tournament.bracketMatches.length > 0}
                    value={activeSess?.groupTargetSize ?? CLOSED_FORM_PLAYERS_PER_GROUP}
                    aria-label={msgText(doublesEnabledForTrack(undefined) ? 'ui.target_participants_per_group' : 'ui.target_players_per_group')}
                    oninput={(e) => {
                      const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                      patchActiveSession({ groupTargetSize: v });
                    }}
                  />
                  <button
                    type="button"
                    class="btn primary"
                    data-testid="groups-create-by-players"
                    disabled={tournament.bracketMatches.length > 0 || globalGroupPlayerCount === 0 || (doublesEnabledForTrack(undefined) && globalGroupPlayerCount % 2 !== 0)}
                    onclick={createGlobalGroupsByPlayerCount}
                  >
                    <Msg key={doublesEnabledForTrack(undefined) ? 'ui.group.createByParticipantCount' : 'ui.group.createByPlayerCount'} />
                  </button>
                  <div class="group-create-gap" aria-hidden="true"></div>
                  <input
                    class="group-create-num"
                    type="number"
                    min="1"
                    step="1"
                    disabled={tournament.bracketMatches.length > 0}
                    value={activeSess?.groupTargetCount ?? suggestedGlobalGroupTargetCount}
                    aria-label={msgText('ui.target_number_of_groups')}
                    oninput={(e) => {
                      const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                      patchActiveSession({ groupTargetCount: v });
                    }}
                  />
                  <button
                    type="button"
                    class="btn primary"
                    disabled={tournament.bracketMatches.length > 0 || globalGroupPlayerCount === 0 || (doublesEnabledForTrack(undefined) && globalGroupPlayerCount % 2 !== 0)}
                    onclick={createGlobalGroupsByGroupCount}
                  >
                    <Msg key="ui.group.createByGroupCount" />
                  </button>
                  <div class="group-create-spacer" aria-hidden="true"></div>
                </div>
              {:else}
                <div class="row align-end">
                  <button
                    type="button"
                    class="btn danger-ghost"
                    data-testid="groups-clear"
                    disabled={tournament.bracketMatches.length > 0}
                    onclick={clearGlobalGroups}
                  >
                    <Msg key="ui.group.clearGroups" />
                  </button>
                </div>
                {#if DEBUG_UI}
                  <div class="row align-end">
                    <button type="button" class="btn subtle" data-testid="debug-simulate-group" onclick={() => debugSimulateGroupMatches(undefined)}>
                      <Msg key="ui.group.debugSimulateMatches" />
                    </button>
                  </div>
                {/if}
                <h3 class="h3"><Msg key="ui.groups" /></h3>
                {#each sortGroupsForDisplay(tournament.groups) as g (g.id)}
                  {#if isDoublesTrack(tournament, undefined)}
                    {@const matrixPairIds = groupMatrixPairOrder(g)}
                    {@const standingsWl = groupStandingsWlByPairId(tournament, g, undefined)}
                    <article class="sub-card">
                      <h4 class="h4">{groupDisplayLabel(g)}</h4>
                      <div class="group-matrix-wrap">
                        <table class="grid compact group-matrix-table">
                          <thead>
                            <tr>
                              <th><Msg key="ui.pair.detailTitle" /></th>
                              {#each matrixPairIds as colPairId (colPairId)}
                                <th class="h2h-th">
                                  <button
                                    type="button"
                                    class="pair-label-btn"
                                    onclick={() => openPairDetailModal(colPairId, undefined)}
                                  >
                                    {pairDisplayLabel(tournament, colPairId, undefined)}
                                  </button>
                                </th>
                              {/each}
                              <th><Msg key="ui.standings.win" /></th>
                              <th><Msg key="ui.standings.loss" /></th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each matrixPairIds as rowPairId (rowPairId)}
                              <tr>
                                <td>
                                  <button
                                    type="button"
                                    class="pair-label-btn"
                                    onclick={() => openPairDetailModal(rowPairId, undefined)}
                                  >
                                    {pairDisplayLabel(tournament, rowPairId, undefined)}
                                  </button>
                                </td>
                                {#each matrixPairIds as colPairId (colPairId)}
                                  <td class="h2h-cell">
                                    {#if rowPairId === colPairId}
                                      <span class="matrix-diag" aria-hidden="true">·</span>
                                    {:else}
                                      {@const gm = findGroupMatchBetweenPairs(tournament, g, undefined, rowPairId, colPairId)}
                                      {#if gm}
                                        {@const wins = groupMatrixGamesWonDigitPairs(tournament, g, undefined, rowPairId, colPairId)}
                                        <button
                                          type="button"
                                          class="group-matrix-cell-btn"
                                          class:group-matrix-cell-readonly={groupMatrixCellViewOnly(tournament, gm)}
                                          aria-label={groupMatrixCellAriaLabel(tournament, gm)}
                                          onclick={() => openScoreModal(gm)}
                                        >
                                          {#if wins === ''}
                                            <span class="group-matrix-placeholder">—</span>
                                          {:else}
                                            <span class="group-matrix-wins-digit">{wins}</span>
                                          {/if}
                                        </button>
                                      {:else}
                                        <span class="muted" title={msgText('ui.no_match')}>—</span>
                                      {/if}
                                    {/if}
                                  </td>
                                {/each}
                                <td>{standingsWl[rowPairId]?.w ?? 0}</td>
                                <td>{standingsWl[rowPairId]?.l ?? 0}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  {:else}
                  {@const matrixPids = groupMatrixPlayerOrder(g)}
                  {@const standingsWl = groupStandingsWlByPid(tournament, g, undefined)}
                  <article class="sub-card">
                    <h4 class="h4">{groupDisplayLabel(g)}</h4>
                    <div class="group-matrix-wrap">
                      <table class="grid compact group-matrix-table">
                        <thead>
                          <tr>
                            <th><Msg key="ui.player" /></th>
                            {#each matrixPids as colPid (colPid)}
                              <th class="h2h-th" title={playerLabel(colPid)}>
                                <span class="h2h-th-inner"><PlayerName {tournament} playerId={colPid} /></span>
                              </th>
                            {/each}
                            <th><Msg key="ui.standings.win" /></th>
                            <th><Msg key="ui.standings.loss" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each matrixPids as rowPid (rowPid)}
                            <tr>
                              <td><PlayerName {tournament} playerId={rowPid} /></td>
                              {#each matrixPids as colPid (colPid)}
                                <td class="h2h-cell">
                                  {#if rowPid === colPid}
                                    <span class="matrix-diag" aria-hidden="true">·</span>
                                  {:else}
                                    {@const gm = findGroupMatchBetween(tournament, g, undefined, rowPid, colPid)}
                                    {#if gm}
                                      {@const wins = groupMatrixGamesWonDigit(tournament, g, undefined, rowPid, colPid)}
                                      <button
                                        type="button"
                                        class="group-matrix-cell-btn"
                                        class:group-matrix-cell-readonly={groupMatrixCellViewOnly(tournament, gm)}
                                        aria-label={groupMatrixCellAriaLabel(tournament, gm)}
                                        onclick={() => openScoreModal(gm)}
                                      >
                                        {#if wins === ''}
                                          <span class="group-matrix-placeholder">—</span>
                                        {:else}
                                          <span class="group-matrix-wins-digit">{wins}</span>
                                        {/if}
                                      </button>
                                    {:else}
                                      <span class="muted" title={msgText('ui.no_match')}>—</span>
                                    {/if}
                                  {/if}
                                </td>
                              {/each}
                              <td>{standingsWl[rowPid]?.w ?? 0}</td>
                              <td>{standingsWl[rowPid]?.l ?? 0}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  </article>
                  {/if}
                {/each}
              {/if}

            </section>
          {:else if !useClassTabs && singleTrackInner === 'bracket'}
            {@const bracketTrack = getCompetitionTrack(tournament, undefined)}
            {@const bracketTrackSeedingIds = trackBracketParticipants(tournament, undefined)}
            {@const bracketTrackClosedForm = resolveClosedFormBracketSeedingKind(
              tournament,
              bracketTrackSeedingIds,
              undefined,
            )}
            <section class="card">
              <h2 class="h2"><Msg key="ui.bracket" /></h2>
              {#if bracketTrack.bracketMatches.length === 0}
                <fieldset class="bracket-seed-fieldset">
                  <legend class="muted small"><Msg key="ui.bracket_seeding" /></legend>
                  <label class="radio-line">
                    <input
                      type="radio"
                      bind:group={bracketSeedingChoice}
                      value="crop_closed_form"
                      disabled={bracketTrackClosedForm === null}
                    />
                    <span>
                      <strong><Msg key="ui.closed_form" /></strong>
                      <Msg key="ui.bracket.closedFormDesc" tag="span" />
                      {#if bracketTrackClosedForm === 'culled'}
                        <Msg key="ui.bracket.closedFormCulled" />
                      {:else if bracketTrackClosedForm === 'exact'}
                        <Msg key="ui.bracket.closedFormExact" />
                      {/if}
                    </span>
                  </label>
                  <label class="radio-line">
                    <input type="radio" bind:group={bracketSeedingChoice} value="heuristic" />
                    <span>
                      <strong><Msg key="ui.heuristic" /></strong>
                      <Msg key="ui.bracket.heuristicDesc" tag="span" />
                    </span>
                  </label>
                </fieldset>
                <div class="row align-end bracket-create-row">
                  <button
                    type="button"
                    class="btn primary"
                    data-testid="bracket-create"
                    disabled={bracketHeuristicSearch !== null ||
                      Object.keys(bracketTrack.groups).length === 0 ||
                      bracketTrackSeedingIds.length === 0}
                    onclick={() => void generateKnockoutBracket()}
                  >
                    <Msg key="ui.bracket.createKnockout" />
                  </button>
                </div>
                {#if Object.keys(bracketTrack.groups).length === 0}
                  <Msg key="ui.group.finishGroupPhaseFirst" tag="p" class="muted small" />
                {/if}
              {/if}

              {#if bracketTrack.bracketMatches.length > 0}
                <div class="row align-end bracket-remove-row" style="margin-bottom: 0.75rem;">
                  <button type="button" class="btn danger-ghost" data-testid="bracket-remove" onclick={() => removeKnockoutBracket()}>
                    <Msg key="ui.bracket.removeBracket" />
                  </button>
                </div>
                <h3 class="h3"><Msg key="ui.knockout_bracket" /></h3>
                <BracketStreamView
                  cols={previewBracketColumns(
                    tournament,
                    trackBracketParticipants(tournament, undefined),
                    activeSess.tournamentName,
                    tournament.bracketMatches,
                  )}
                  mainDrawSlotCount={inferBracketSlotCountFromRoundOne(tournament.bracketMatches)}
                  {tournament}
                  slotTitle={bracketSlotTitle}
                  onPairingClick={openBracketPairingModal}
                  ariaLabel={msgText('ui.bracket.aria')}
                />
                {#if DEBUG_UI}
                  {@const debugElimRounds = uniqueSortedRounds(tournament.bracketMatches).filter((elimRound) =>
                    bracketRoundHasOpenEliminationPairings(tournament, tournament.bracketMatches, elimRound),
                  )}
                  {#if debugElimRounds.length > 0}
                    <div class="row align-end bracket-elim-row" style="flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem;">
                      <span class="muted small"><Msg key="ui.bureaucratic_elimination_distinct_from_forfeit" /></span>
                      {#each debugElimRounds as elimRound (elimRound)}
                        <button
                          type="button"
                          class="btn subtle"
                          disabled={(tournament.lockedBracketRounds ?? []).includes(elimRound)}
                          title={bracketElimRoundButtonTitle(elimRound)}
                          onclick={() => eliminateBracketRoundByRanking(elimRound)}
                        >
                          <Msg key="ui.bracket.eliminateLowestRound" params={bracketRoundParams(elimRound)} />
                        </button>
                      {/each}
                    </div>
                  {/if}
                {:else}
                  <div class="row align-end bracket-elim-row" style="flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem;">
                    <span class="muted small"><Msg key="ui.bureaucratic_elimination_distinct_from_forfeit" /></span>
                    {#each uniqueSortedRounds(tournament.bracketMatches) as elimRound (elimRound)}
                      <button
                        type="button"
                        class="btn subtle"
                        disabled={(bracketTrack.lockedBracketRounds ?? []).includes(elimRound)}
                        title={bracketElimRoundButtonTitle(elimRound)}
                        onclick={() => eliminateBracketRoundByRanking(elimRound)}
                      >
                        <Msg key="ui.bracket.eliminateLowestRound" params={bracketRoundParams(elimRound)} />
                      </button>
                    {/each}
                  </div>
                {/if}
                {#if DEBUG_UI}
                  <div class="row align-end">
                    <button
                      type="button"
                      class="btn subtle"
                      data-testid="debug-simulate-bracket"
                      disabled={anyUnfinishedGroupPhaseMatch(tournament)}
                      title={debugSimulateBracketTitle()}
                      onclick={debugSimulateBracketPhaseMatches}
                    >
                      <Msg key="ui.bracket.debugSimulatePhase" />
                    </button>
                  </div>
                {/if}
                <Msg key="ui.bracket.clickPairingHint" tag="p" class="muted small" />
              {:else}
                <Msg key="ui.bracket.appearsAfterCreate" tag="p" class="muted small" />
              {/if}
            </section>
          {:else if !useClassTabs && singleTrackInner === 'results'}
            <section class="card">
              <h2 class="h2"><Msg key="ui.results" /></h2>
              {#if tournament.bracketMatches.length > 0}
                {@const placementRows = singleEliminationPlacementRows(tournament.bracketMatches, tournament)}
                {#if placementRows}
                  <ol class="plain-list placement-ol">
                    {#each placementRows as row (row.playerId)}
                      <li
                        class:placement-first={row.place === 1}
                        class:placement-after-podium={row.place === 3}
                      >
                        <span class="placement-num">{row.place}.</span>
                        {#if isDoublesTrack(tournament, undefined)}
                          {formatBracketSlotPlayerLabel(tournament, row.playerId, undefined, getLocale())}
                        {:else}
                          <PlayerName {tournament} playerId={row.playerId} />
                        {/if}
                      </li>
                    {/each}
                  </ol>
                {:else}
                  <p class="muted small"><Msg key="ui.complete_the_final_match_to_list_finishing_order" /></p>
                {/if}
              {:else}
                <p class="muted small"><Msg key="ui.generate_a_knockout_bracket_to_show_finishing_or" /></p>
              {/if}
            </section>
          {:else if useClassTabs && multiClassScreen}
            {@const cid = multiClassScreen.classId}
            {@const def = tournament.classDefinitions.find((x) => x.id === cid)}
            {@const slice = classSlice(tournament, cid)}
            {@const cin = multiClassScreen.inner}
            {#if cin === 'groups'}
              <section class="card">
                <h2 class="h2"><Msg key="ui.group.classPhaseTitle" params={{ name: def?.name ?? cid }} /></h2>
                {#if slice.bracketMatches.length > 0}
                  <p class="group-lock-banner">
                    <Msg key="ui.group.knockoutActiveLockClass" tag="p" class="group-lock-banner" />
                  </p>
                {/if}
                {#if Object.keys(slice.groups).length === 0}
                  {@const classGroupPlayerCount = slice.seedings.length}
                  {@const classGroupParticipantCount = trackParticipantCountForGroups(tournament, cid, classGroupPlayerCount)}
                  <p class="muted small">
                    <Msg key="ui.group.classPlayersHint" tag="p" class="muted small" />
                  </p>
                  <p class="muted small">
                    {#if classGroupPlayerCount === 0}
                      <Msg key="ui.group.noPlayersInClass" />
                    {:else}
                      <Msg key="ui.group.allInClassIncluded" params={{ count: String(doublesEnabledForTrack(cid) ? classGroupParticipantCount : classGroupPlayerCount) }} />
                    {/if}
                  </p>
                  <label class="group-doubles-option">
                    <input
                      type="checkbox"
                      disabled={slice.bracketMatches.length > 0}
                      checked={doublesEnabledForTrack(cid)}
                      onchange={(e) =>
                        setDoublesEnabledForTrack(cid, (e.currentTarget as HTMLInputElement).checked)}
                    />
                    <Msg key="ui.group.doublesRandomPartners" />
                  </label>
                  {#if doublesEnabledForTrack(cid) && classGroupPlayerCount % 2 !== 0}
                    <p class="muted small"><Msg key="ui.group.doublesEvenCountRequired" /></p>
                  {/if}
                  <div class="group-create-row">
                    <input
                      class="group-create-num"
                      type="number"
                      min="1"
                      step="1"
                      disabled={slice.bracketMatches.length > 0}
                      value={classGroupTargetSize(cid)}
                      aria-label={msgText(doublesEnabledForTrack(cid) ? 'ui.target_participants_per_group_for_class' : 'ui.target_players_per_group_for_class')}
                      oninput={(e) => {
                        const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                        const s = getActiveSession();
                        if (!s) return;
                        patchActiveSession({
                          classGroupTargetSizeByClassId: { ...s.classGroupTargetSizeByClassId, [cid]: v },
                        });
                      }}
                    />
                    <button
                      type="button"
                      class="btn primary"
                      disabled={slice.bracketMatches.length > 0 || classGroupPlayerCount === 0 || (doublesEnabledForTrack(cid) && classGroupPlayerCount % 2 !== 0)}
                      onclick={() => createClassGroupsByPlayerCount(cid)}
                    >
                      <Msg key={doublesEnabledForTrack(cid) ? 'ui.group.createByParticipantCount' : 'ui.group.createByPlayerCount'} />
                    </button>
                    <div class="group-create-gap" aria-hidden="true"></div>
                    <input
                      class="group-create-num"
                      type="number"
                      min="1"
                      step="1"
                      disabled={slice.bracketMatches.length > 0}
                      value={classGroupTargetCount(cid)}
                      aria-label={msgText('ui.target_number_of_groups_for_class')}
                      oninput={(e) => {
                        const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                        const s = getActiveSession();
                        if (!s) return;
                        patchActiveSession({
                          classGroupTargetCountByClassId: { ...s.classGroupTargetCountByClassId, [cid]: v },
                        });
                      }}
                    />
                    <button
                      type="button"
                      class="btn primary"
                      disabled={slice.bracketMatches.length > 0 || classGroupPlayerCount === 0 || (doublesEnabledForTrack(cid) && classGroupPlayerCount % 2 !== 0)}
                      onclick={() => createClassGroupsByGroupCount(cid)}
                    >
                      <Msg key="ui.group.createByGroupCount" />
                    </button>
                    <div class="group-create-spacer" aria-hidden="true"></div>
                  </div>
                {:else}
                  <div class="row align-end">
                    <button
                      type="button"
                      class="btn danger-ghost"
                      disabled={slice.bracketMatches.length > 0}
                      onclick={() => clearClassGroups(cid)}
                    >
                      <Msg key="ui.group.clearGroups" />
                    </button>
                  </div>
                  {#if DEBUG_UI}
                    <div class="row align-end">
                      <button type="button" class="btn subtle" onclick={() => debugSimulateGroupMatches(cid)}>
                        <Msg key="ui.group.debugSimulateMatches" />
                      </button>
                    </div>
                  {/if}
                  <h3 class="h3"><Msg key="ui.groups" /></h3>
                  {#each sortGroupsForDisplay(slice.groups) as g (g.id)}
                    {#if isDoublesTrack(tournament, cid)}
                      {@const matrixPairIds = groupMatrixPairOrder(g)}
                      {@const standingsWl = groupStandingsWlByPairId(tournament, g, cid)}
                      <article class="sub-card">
                        <h4 class="h4">{groupDisplayLabel(g)}</h4>
                        <div class="group-matrix-wrap">
                          <table class="grid compact group-matrix-table">
                            <thead>
                              <tr>
                                <th><Msg key="ui.pair.detailTitle" /></th>
                                {#each matrixPairIds as colPairId (colPairId)}
                                  <th class="h2h-th">
                                    <button
                                      type="button"
                                      class="pair-label-btn"
                                      onclick={() => openPairDetailModal(colPairId, cid)}
                                    >
                                      {pairDisplayLabel(tournament, colPairId, cid)}
                                    </button>
                                  </th>
                                {/each}
                                <th><Msg key="ui.standings.win" /></th>
                                <th><Msg key="ui.standings.loss" /></th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each matrixPairIds as rowPairId (rowPairId)}
                                <tr>
                                  <td>
                                    <button
                                      type="button"
                                      class="pair-label-btn"
                                      onclick={() => openPairDetailModal(rowPairId, cid)}
                                    >
                                      {pairDisplayLabel(tournament, rowPairId, cid)}
                                    </button>
                                  </td>
                                  {#each matrixPairIds as colPairId (colPairId)}
                                    <td class="h2h-cell">
                                      {#if rowPairId === colPairId}
                                        <span class="matrix-diag" aria-hidden="true">·</span>
                                      {:else}
                                        {@const gm = findGroupMatchBetweenPairs(tournament, g, cid, rowPairId, colPairId)}
                                        {#if gm}
                                          {@const wins = groupMatrixGamesWonDigitPairs(tournament, g, cid, rowPairId, colPairId)}
                                          <button
                                            type="button"
                                            class="group-matrix-cell-btn"
                                            class:group-matrix-cell-readonly={groupMatrixCellViewOnly(tournament, gm)}
                                            aria-label={groupMatrixCellAriaLabel(tournament, gm)}
                                            onclick={() => openScoreModal(gm)}
                                          >
                                            {#if wins === ''}
                                              <span class="group-matrix-placeholder">—</span>
                                            {:else}
                                              <span class="group-matrix-wins-digit">{wins}</span>
                                            {/if}
                                          </button>
                                        {:else}
                                          <span class="muted" title={msgText('ui.no_match')}>—</span>
                                        {/if}
                                      {/if}
                                    </td>
                                  {/each}
                                  <td>{standingsWl[rowPairId]?.w ?? 0}</td>
                                  <td>{standingsWl[rowPairId]?.l ?? 0}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    {:else}
                    {@const matrixPids = groupMatrixPlayerOrder(g)}
                    {@const standingsWl = groupStandingsWlByPid(tournament, g, cid)}
                    <article class="sub-card">
                      <h4 class="h4">{groupDisplayLabel(g)}</h4>
                      <div class="group-matrix-wrap">
                        <table class="grid compact group-matrix-table">
                          <thead>
                            <tr>
                              <th><Msg key="ui.player" /></th>
                              {#each matrixPids as colPid (colPid)}
                                <th class="h2h-th" title={playerLabel(colPid)}>
                                  <span class="h2h-th-inner"><PlayerName {tournament} playerId={colPid} classId={cid} /></span>
                                </th>
                              {/each}
                              <th><Msg key="ui.standings.win" /></th>
                              <th><Msg key="ui.standings.loss" /></th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each matrixPids as rowPid (rowPid)}
                              <tr>
                                <td><PlayerName {tournament} playerId={rowPid} classId={cid} /></td>
                                {#each matrixPids as colPid (colPid)}
                                  <td class="h2h-cell">
                                    {#if rowPid === colPid}
                                      <span class="matrix-diag" aria-hidden="true">·</span>
                                    {:else}
                                      {@const gm = findGroupMatchBetween(tournament, g, cid, rowPid, colPid)}
                                      {#if gm}
                                        {@const wins = groupMatrixGamesWonDigit(tournament, g, cid, rowPid, colPid)}
                                        <button
                                          type="button"
                                          class="group-matrix-cell-btn"
                                          class:group-matrix-cell-readonly={groupMatrixCellViewOnly(tournament, gm)}
                                          aria-label={groupMatrixCellAriaLabel(tournament, gm)}
                                          onclick={() => openScoreModal(gm)}
                                        >
                                          {#if wins === ''}
                                            <span class="group-matrix-placeholder">—</span>
                                          {:else}
                                            <span class="group-matrix-wins-digit">{wins}</span>
                                          {/if}
                                        </button>
                                      {:else}
                                        <span class="muted" title={msgText('ui.no_match')}>—</span>
                                      {/if}
                                    {/if}
                                  </td>
                                {/each}
                                <td>{standingsWl[rowPid]?.w ?? 0}</td>
                                <td>{standingsWl[rowPid]?.l ?? 0}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    </article>
                    {/if}
                  {/each}
                {/if}

              </section>
            {:else if cin === 'bracket'}
              {@const classBracketSeedingIds = trackBracketParticipants(tournament, cid)}
              {@const classBracketClosedForm = resolveClosedFormBracketSeedingKind(
                tournament,
                classBracketSeedingIds,
                cid,
              )}
              <section class="card">
                <h2 class="h2"><Msg key="ui.bracket.classTitle" params={{ name: def?.name ?? cid }} /></h2>
                {#if slice.bracketMatches.length === 0}
                  <fieldset class="bracket-seed-fieldset">
                    <legend class="muted small"><Msg key="ui.bracket_seeding" /></legend>
                    <label class="radio-line">
                      <input
                        type="radio"
                        bind:group={bracketSeedingChoice}
                        value="crop_closed_form"
                        disabled={classBracketClosedForm === null}
                      />
                      <span>
                        <strong><Msg key="ui.closed_form" /></strong>
                        <Msg key="ui.bracket.closedFormDesc" tag="span" />
                        {#if classBracketClosedForm === 'culled'}
                          <Msg key="ui.bracket.closedFormCulled" />
                        {:else if classBracketClosedForm === 'exact'}
                          <Msg key="ui.bracket.closedFormExact" />
                        {/if}
                      </span>
                    </label>
                    <label class="radio-line">
                      <input type="radio" bind:group={bracketSeedingChoice} value="heuristic" />
                      <span>
                        <strong><Msg key="ui.heuristic" /></strong>
                        <Msg key="ui.bracket.heuristicDesc" tag="span" />
                      </span>
                    </label>
                  </fieldset>
                  <div class="row align-end bracket-create-row">
                    <button
                      type="button"
                      class="btn primary"
                      data-testid="bracket-create"
                      disabled={bracketHeuristicSearch !== null ||
                        Object.keys(slice.groups).length === 0 ||
                        slice.seedings.length === 0}
                      onclick={() => void generateKnockoutBracket(cid)}
                    >
                      <Msg key="ui.bracket.createKnockout" />
                    </button>
                  </div>
                  {#if Object.keys(slice.groups).length === 0}
                    <Msg key="ui.group.finishGroupPhaseFirst" tag="p" class="muted small" />
                  {/if}
                {/if}

                {#if slice.bracketMatches.length > 0}
                  <div class="row align-end bracket-remove-row" style="margin-bottom: 0.75rem;">
                    <button type="button" class="btn danger-ghost" onclick={() => removeKnockoutBracket(cid)}>
                      <Msg key="ui.bracket.removeBracket" />
                    </button>
                  </div>
                  <h3 class="h3"><Msg key="ui.knockout_bracket" /></h3>
                  <Msg
                    key="ui.bracket.classLayoutHint"
                    tag="p"
                    class="muted small"
                    params={{
                      groupPlace: `${msgText('ui.group')} … ${msgText('model.placeWord')} …`,
                      emptySlot: msgText('ui.slot.empty'),
                    }}
                  />
                  <BracketStreamView
                    cols={displayBracketColumns(slice.bracketMatches)}
                    mainDrawSlotCount={inferBracketSlotCountFromRoundOne(slice.bracketMatches)}
                    {tournament}
                    slotTitle={bracketSlotTitle}
                    bracketClassId={cid}
                    onPairingClick={openBracketPairingModal}
                    ariaLabel={msgText('ui.bracket.classAria')}
                    emptyMessage={msgText('ui.bracket.classEmptyEntrants')}
                  />
                  {#if DEBUG_UI}
                    {@const debugElimRounds = uniqueSortedRounds(slice.bracketMatches).filter((elimRound) =>
                      bracketRoundHasOpenEliminationPairings(tournament, slice.bracketMatches, elimRound),
                    )}
                    {#if debugElimRounds.length > 0}
                      <div class="row align-end bracket-elim-row" style="flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem;">
                        <span class="muted small"><Msg key="ui.bureaucratic_elimination_distinct_from_forfeit" /></span>
                        {#each debugElimRounds as elimRound (elimRound)}
                          <button
                            type="button"
                            class="btn subtle"
                            disabled={(slice.lockedBracketRounds ?? []).includes(elimRound)}
                            title={bracketElimRoundButtonTitle(elimRound)}
                            onclick={() => eliminateBracketRoundByRanking(elimRound, cid)}
                          >
                            <Msg key="ui.bracket.eliminateLowestRound" params={bracketRoundParams(elimRound)} />
                          </button>
                        {/each}
                      </div>
                    {/if}
                  {:else}
                    <div class="row align-end bracket-elim-row" style="flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem;">
                      <span class="muted small"><Msg key="ui.bureaucratic_elimination_distinct_from_forfeit" /></span>
                      {#each uniqueSortedRounds(slice.bracketMatches) as elimRound (elimRound)}
                        <button
                          type="button"
                          class="btn subtle"
                          disabled={(slice.lockedBracketRounds ?? []).includes(elimRound)}
                          title={bracketElimRoundButtonTitle(elimRound)}
                          onclick={() => eliminateBracketRoundByRanking(elimRound, cid)}
                        >
                          <Msg key="ui.bracket.eliminateLowestRound" params={bracketRoundParams(elimRound)} />
                        </button>
                      {/each}
                    </div>
                  {/if}
                  {#if DEBUG_UI}
                    <div class="row align-end">
                      <button
                        type="button"
                        class="btn subtle"
                        disabled={anyUnfinishedGroupPhaseMatch(tournament, cid)}
                        title={debugSimulateBracketTitle()}
                        onclick={() => debugSimulateBracketPhaseMatches(cid)}
                      >
                        <Msg key="ui.bracket.debugSimulatePhase" />
                      </button>
                    </div>
                  {/if}
                  <Msg key="ui.bracket.clickPairingHint" tag="p" class="muted small" />
                {/if}
              </section>
            {:else if cin === 'results'}
              <section class="card">
                <h2 class="h2"><Msg key="ui.results.classTitle" params={{ name: def?.name ?? cid }} /></h2>
                {#if slice.bracketMatches.length > 0}
                  {@const classPlacementRows = singleEliminationPlacementRows(slice.bracketMatches, tournament, cid)}
                  {#if classPlacementRows}
                    <ol class="plain-list placement-ol">
                      {#each classPlacementRows as row (row.playerId)}
                        <li
                          class:placement-first={row.place === 1}
                          class:placement-after-podium={row.place === 3}
                        >
                          <span class="placement-num">{row.place}.</span>
                          {#if isDoublesTrack(tournament, cid)}
                            {formatBracketSlotPlayerLabel(tournament, row.playerId, cid, getLocale())}
                          {:else}
                            <PlayerName {tournament} playerId={row.playerId} classId={cid} />
                          {/if}
                        </li>
                      {/each}
                    </ol>
                  {:else}
                    <p class="muted small"><Msg key="ui.complete_the_final_match_to_list_finishing_order" /></p>
                  {/if}
                {:else}
                  <p class="muted small"><Msg key="ui.no_knockout_bracket_for_this_class_yet" /></p>
                {/if}
              </section>
            {/if}
          {/if}
        </div>
      </div>
      {:else}
      <section class="card empty-tournament-card">
        <h2 class="h2"><Msg key="ui.no_tournament_in_this_tab" /></h2>
        <p class="muted">
          Go to <button type="button" class="linkish" onclick={() => selectWorkspaceTab('settings')}><Msg key="ui.settings" /></button>
          <Msg key="ui.empty.createOrImportJsonl" tag="span" />
        </p>
      </section>
      {/if}
    {/if}
  </main>

  {#if activeSess}
    <footer class="tournament-footer app-dock-footer" aria-label="Tournament activity">
      <p class="footer-last muted" data-testid="footer-last-command">
        <span class:i18n-fallback={lastCommandSummary.isFallback}>{lastCommandSummary.text}</span>
      </p>
      <div class="footer-actions">
        <button type="button" class="btn ghost" data-testid="undo-btn" onclick={doUndo} title={msgText('ui.append_undo_for_latest_undoable_step')}><Msg key="ui.undo" /></button>
        <button
          type="button"
          class="btn ghost"
          data-testid="redo-btn"
          onclick={doRedo}
          disabled={!footerRedoEnabled}
          title={msgText('ui.drop_last_undo_from_log')}
        >
          <Msg key="ui.footer.redo" />
        </button>
      </div>
    </footer>
  {/if}

  {#if bracketHeuristicSearch}
    <div class="load-overlay" role="dialog" aria-modal="true" aria-labelledby="bracket-heuristic-search-title">
      <div class="load-panel">
        <h3 id="bracket-heuristic-search-title" class="load-title"><Msg key="ui.optimizing_bracket_draw" /></h3>
        <p class="load-meta muted small">
          <Msg
            key="ui.load.heuristicTrials"
            params={{
              done: String(bracketHeuristicSearch.done),
              total: String(bracketHeuristicSearch.total),
            }}
          />
        </p>
        <div
          class="load-track"
          role="progressbar"
          aria-valuenow={bracketHeuristicSearch.done}
          aria-valuemin="0"
          aria-valuemax={bracketHeuristicSearch.total}
          aria-label={msgText('ui.load.heuristicTrialsAria', {
            done: String(bracketHeuristicSearch.done),
            total: String(bracketHeuristicSearch.total),
          })}
        >
          <div
            class="load-fill"
            style:width="{tournamentLoadPct(bracketHeuristicSearch.done, bracketHeuristicSearch.total)}%"
          ></div>
        </div>
      </div>
    </div>
  {/if}

  {#if tournamentLoad}
    <div class="load-overlay" role="dialog" aria-modal="true" aria-labelledby="tournament-load-title">
      <div class="load-panel">
        <h3 id="tournament-load-title" class="load-title">
          <Msg key="ui.load.loadingTournament" params={{ label: tournamentLoad.label }} />
        </h3>
        {#if tournamentLoad.phase === 'replay' && tournamentLoad.total > 0}
          <p class="load-meta muted small">
            <Msg
              key="ui.load.replayingCommands"
              params={{ done: String(tournamentLoad.done), total: String(tournamentLoad.total) }}
            />
          </p>
          <div
            class="load-track"
            role="progressbar"
            aria-valuenow={tournamentLoad.done}
            aria-valuemin="0"
            aria-valuemax={tournamentLoad.total}
            aria-label={msgText('ui.load.commandsReplayedAria', {
              done: String(tournamentLoad.done),
              total: String(tournamentLoad.total),
            })}
          >
            <div
              class="load-fill"
              style:width="{tournamentLoadPct(tournamentLoad.done, tournamentLoad.total)}%"
            ></div>
          </div>
        {:else}
          <p class="load-meta muted small"><Msg key="ui.load.readingFile" /></p>
          <div class="load-track load-track-indeterminate" role="progressbar" aria-busy="true" aria-label={msgText('ui.reading_tournament_file')}>
            <div class="load-fill-indeterminate"></div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if addClassModalOpen}
    <div class="modal-root">
      <button
        type="button"
        class="modal-scrim"
        aria-label={msgText('ui.classes.addModalCancel')}
        onclick={() => cancelAddClassModal()}
      ></button>
      <div
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-class-title"
        tabindex="-1"
      >
        <header class="modal-head">
          <h3 id="add-class-title" class="modal-title"><Msg key="ui.classes.addModalTitle" /></h3>
          <button type="button" class="btn subtle small-inline" onclick={() => cancelAddClassModal()}>
            <Msg key="ui.classes.addModalCancel" />
          </button>
        </header>
        <label class="field-label" for="add-class-name-input">
          <Msg key="ui.classes.addModalNameLabel" />
        </label>
        <input
          id="add-class-name-input"
          type="text"
          class="grow"
          bind:value={addClassDraftName}
          autocomplete="off"
          spellcheck={false}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirmAddCompetitionClass();
            }
          }}
        />
        {#if addClassError}
          <p class="modal-error">{addClassError}</p>
        {/if}
        <div class="row modal-actions">
          <button type="button" class="btn" onclick={() => cancelAddClassModal()}>
            <Msg key="ui.classes.addModalCancel" />
          </button>
          <button type="button" class="btn primary" onclick={() => confirmAddCompetitionClass()}>
            <Msg key="ui.classes.addModalConfirm" />
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if deleteTournamentTarget}
    {@const deleteTarget = deleteTournamentTarget}
    <div class="modal-root">
      <button
        type="button"
        class="modal-scrim"
        aria-label={msgText('ui.close_delete_dialog')}
        disabled={deleteTournamentBusy}
        onclick={() => cancelDeleteTournamentModal()}
      ></button>
      <div
        class="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-tournament-title"
        tabindex="-1"
      >
        <header class="modal-head">
          <h3 id="delete-tournament-title" class="modal-title"><Msg key="ui.delete_tournament" /></h3>
          <button
            type="button"
            class="btn subtle small-inline"
            disabled={deleteTournamentBusy}
            onclick={() => cancelDeleteTournamentModal()}
          >
            Close
          </button>
        </header>
        <p class="muted small modal-lead">
          <Msg key="ui.delete.lead" params={{ name: deleteTarget.tournamentName }} />
        </p>
        <label class="field-label" for="delete-confirm-input">
          <Msg key="ui.delete.typeToConfirm" params={{ confirm: msgText('ui.i_understand') }} />
        </label>
        <input
          id="delete-confirm-input"
          type="text"
          class="grow delete-confirm-input"
          data-testid="delete-confirm-input"
          bind:value={deleteConfirmPhrase}
          autocomplete="off"
          spellcheck={false}
          disabled={deleteTournamentBusy}
        />
        {#if deleteTournamentError}
          <p class="modal-error">{deleteTournamentError}</p>
        {/if}
        <div class="row modal-actions">
          <button
            type="button"
            class="btn"
            disabled={deleteTournamentBusy}
            onclick={() => cancelDeleteTournamentModal()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn danger-ghost"
            data-testid="delete-confirm-btn"
            disabled={!deleteConfirmOk || deleteTournamentBusy}
            onclick={() => confirmDeleteTournament()}
          >
            {deleteTournamentBusy ? msgText('ui.delete.deleting') : msgText('ui.delete.deletePermanently')}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if pairDetailModalPairId}
    {@const pair = pairById(tournament, pairDetailModalClassId, pairDetailModalPairId)}
    {#if pair}
      <div class="modal-root">
        <button
          type="button"
          class="modal-scrim"
          aria-label={msgText('ui.close')}
          onclick={() => closePairDetailModal()}
        ></button>
        <div class="modal-dialog" role="dialog" aria-modal="true" tabindex="-1">
          <header class="modal-head">
            <h3 class="modal-title">{pairDisplayLabel(tournament, pairDetailModalPairId, pairDetailModalClassId)}</h3>
            <button type="button" class="btn subtle small-inline" onclick={() => closePairDetailModal()}>
              <Msg key="ui.close" />
            </button>
          </header>
          <ul class="plain-list pair-detail-list">
            {#each pair.playerIds as pid (pid)}
              <li><PlayerName {tournament} playerId={pid} classId={pairDetailModalClassId} tag="strong" /></li>
            {/each}
          </ul>
        </div>
      </div>
    {/if}
  {/if}

  {#if scoreModalMatchId}
    {@const sm = tournament.matches[scoreModalMatchId]}
    {#if sm}
      {@const modalRows = scoreDrafts()[scoreModalMatchId] ?? defaultRows(MIN_GAME_ROWS)}
      {@const scoreSides = matchSideLabels(tournament, sm, sm.classId)}
      <div class="modal-root">
        <button
          type="button"
          class="modal-scrim"
          aria-label={msgText('ui.close_score_dialog')}
          onclick={() => cancelScoreModal()}
        ></button>
        <div
          class="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-modal-title"
          data-testid="score-modal"
          tabindex="-1"
        >
          <header class="modal-head">
            <h3 id="score-modal-title" class="modal-title">
              <Msg
                key="ui.score.gamesTitle"
                params={{ a: scoreSides.sideA, b: scoreSides.sideB }}
              />
            </h3>
            <button type="button" class="btn subtle small-inline" onclick={() => cancelScoreModal()}><Msg key="ui.close" /></button>
          </header>
          <Msg key="ui.score.rulesLead" tag="p" class="muted small modal-lead" />
          {#if !scoreModalCanEditGames() && (sm.status === 'finished' || sm.scores.length > 0)}
            <p class="muted small modal-lead">
              {#if sm.groupId}
                <Msg key="ui.score.groupLockedEdit" />
              {:else}
                <Msg key="ui.score.bracketLockedEdit" />
              {/if}
            </p>
          {/if}
          {#if scoreModalAssignedTableId()}
            <p class="score-modal-table-readout muted small">
              <Msg
                key="ui.score.tableReadout"
                params={{ table: String(scoreModalAssignedTableId()) }}
              />
            </p>
          {/if}
          <table class="mini score-modal-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{scoreSides.sideA}</th>
                <th>{scoreSides.sideB}</th>
              </tr>
            </thead>
            <tbody>
              {#each modalRows as srow, gi (gi)}
                <tr class:row-muted={!rowIndexEnabled(modalRows, gi)}>
                  <td>{gi + 1}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      data-testid="score-g{gi + 1}-a"
                      disabled={!rowIndexEnabled(modalRows, gi) || !scoreModalCanEditGames()}
                      value={srow.a === '' ? '' : srow.a}
                      oninput={(e) =>
                        setScoreModalCell(sm.id, gi, 'a', (e.currentTarget as HTMLInputElement).value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      data-testid="score-g{gi + 1}-b"
                      disabled={!rowIndexEnabled(modalRows, gi) || !scoreModalCanEditGames()}
                      value={srow.b === '' ? '' : srow.b}
                      oninput={(e) =>
                        setScoreModalCell(sm.id, gi, 'b', (e.currentTarget as HTMLInputElement).value)}
                    />
                  </td>
                </tr>
                {#if rowGameHint(srow)}
                  <tr class="hint-row"><td colspan="3" class="game-hint">{rowGameHint(srow)}</td></tr>
                {/if}
              {/each}
            </tbody>
          </table>
          {#if scoreModalHint}
            <p class="modal-error">{scoreModalHint}</p>
          {/if}
          <div class="row modal-actions">
            <button type="button" class="btn" data-testid="score-cancel" onclick={() => cancelScoreModal()}><Msg key="ui.cancel" /></button>
            {#if DEBUG_UI}
              <button
                type="button"
                class="btn subtle"
                data-testid="debug-simulate-score"
                disabled={!scoreModalCanEditGames()}
                onclick={() => debugSimulateOpenScoreModalMatch()}
              >
                <Msg key="ui.score.debugSimulate" />
              </button>
            {/if}
            {#if scoreModalCanClearResult()}
              <button type="button" class="btn danger-ghost" data-testid="score-clear" onclick={() => clearScoreModalBracketResult()}>
                <Msg key="ui.score.clearResult" />
              </button>
            {/if}
            <button
              type="button"
              class="btn primary"
              data-testid="score-save"
              disabled={!scoreModalCanEditGames()}
              onclick={() => submitScores(sm)}
            >
              <Msg key="ui.score.saveMatch" />
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}

  {#if playerHistoryModalPid}
    <PlayerMatchHistoryModal
      {tournament}
      playerId={playerHistoryModalPid}
      {handicapEnabled}
      {handicapBounds}
      {miscEnabled}
      {miscFieldLabel}
      onUpdatePlayer={commitPlayerUpdateFromModal}
      onSetGroupId={setActivePlayerGroupFromModal}
      onClose={closePlayerHistoryModal}
    />
  {/if}

  <VersionFooter />
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(165deg, #f1f5f9 0%, #e8f3ec 40%, #f8fafc 100%);
    color: #0f172a;
  }

  .app-sticky-head {
    position: sticky;
    top: 0;
    z-index: 25;
    flex-shrink: 0;
    background: linear-gradient(165deg, #f1f5f9 0%, #e8f3ec 40%, #f8fafc 100%);
    box-shadow: 0 2px 10px rgb(15 23 42 / 8%);
  }

  .top-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.25rem;
    padding: 0.65rem 1.25rem;
    background: rgb(255 255 255 / 88%);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid #e2e8f0;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .brand-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.45rem;
    border-radius: 6px;
    background: linear-gradient(135deg, #166534, #22c55e);
    color: #fff;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .brand-text {
    font-size: 1.05rem;
    color: #334155;
  }

  .top-bar-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  .lang-switch {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: 0.35rem;
  }

  .lang-btn {
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.35rem 0.55rem;
    border: 1px solid var(--border, #ccc);
    border-radius: 0.35rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .lang-btn.active {
    background: var(--accent, #2563eb);
    border-color: var(--accent, #2563eb);
    color: #fff;
  }

  :global(.i18n-fallback) {
    color: var(--i18n-fallback, #c00);
  }

  .session-close-btn {
    flex: 0 0 auto;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #94a3b8;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .session-close-btn:hover {
    color: #64748b;
    background: rgb(148 163 184 / 12%);
  }

  .session-close-btn:focus-visible {
    outline: 2px solid #86efac;
    outline-offset: 2px;
  }

  .workspace-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0.2rem;
    border-radius: 10px;
    background: #f1f5f9;
  }

  .workspace-tab {
    border: none;
    background: transparent;
    padding: 0.45rem 0.95rem;
    border-radius: 8px;
    font: inherit;
    font-size: 0.9rem;
    color: #475569;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .workspace-tab:hover {
    background: rgb(255 255 255 / 70%);
    color: #0f172a;
  }

  .workspace-tab.active {
    background: #fff;
    color: #166534;
    font-weight: 600;
    box-shadow: 0 1px 3px rgb(15 23 42 / 8%);
  }

  .banner {
    padding: 0.55rem 1.25rem;
    background: #ecfdf5;
    color: #14532d;
    font-size: 0.9rem;
  }

  .status-banner {
    margin: 0;
    border-radius: 0;
    border: none;
    border-bottom: 1px solid #bbf7d0;
    background: rgb(236 253 245 / 96%);
    color: #14532d;
    backdrop-filter: blur(8px);
  }

  .status-banner.status-banner--warn {
    border-bottom-color: #fed7aa;
    background: rgb(255 247 237 / 96%);
    color: #9a3412;
  }

  .status-banner.status-banner--error {
    border-bottom-color: #fecaca;
    background: rgb(254 242 242 / 96%);
    color: #991b1b;
  }

  .main {
    flex: 1;
    width: 100%;
    max-width: 58rem;
    margin: 0 auto;
    padding: 1.25rem 1.25rem 2.5rem;
  }

  /** Use horizontal space on wide screens (e.g. knockout bracket tree). */
  .main.main--tournament {
    max-width: min(112rem, calc(100% - 2.5rem));
  }

  @media (min-width: 90rem) {
    .main.main--tournament {
      max-width: min(112rem, calc(100vw - 2.5rem));
    }
  }

  .app-with-footer .main {
    padding-bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px));
  }

  .card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 1.15rem 1.25rem 1.25rem;
    box-shadow: 0 2px 8px rgb(15 23 42 / 4%);
  }

  .settings-card .h1 {
    margin: 0 0 0.35rem;
    font-size: 1.35rem;
    letter-spacing: -0.02em;
  }

  .lead {
    margin: 0 0 1.25rem;
    color: #64748b;
    font-size: 0.95rem;
    max-width: 40rem;
    line-height: 1.55;
  }

  .settings-grid {
    display: grid;
    gap: 1rem;
  }

  @media (min-width: 720px) {
    .settings-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .settings-block .h2 {
    margin: 0 0 0.65rem;
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .recent-list {
    margin: 0.35rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .recent-entry-row {
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
  }

  .recent-entry-row .recent-entry-btn {
    flex: 1;
    min-width: 0;
  }

  .recent-delete-btn {
    flex: 0 0 auto;
    align-self: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 1px solid #fecaca;
    border-radius: 6px;
    background: #fef2f2;
    color: #dc2626;
    font-size: 1.15rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .recent-delete-btn:hover {
    background: #fee2e2;
    border-color: #f87171;
  }

  .recent-entry-btn {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.35rem 1rem;
    text-align: left;
    font: inherit;
    font-size: 0.88rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
    color: #334155;
    cursor: pointer;
  }

  .recent-entry-btn:hover {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }

  .recent-entry-name {
    font-weight: 600;
  }

  .title-export-btn {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .new-tournament-block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .group-lock-banner {
    margin: 0 0 0.65rem;
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
    border: 1px solid #bae6fd;
    background: #f0f9ff;
    color: #0c4a6e;
    font-size: 0.88rem;
    line-height: 1.45;
  }

  .bracket-create-row {
    margin-top: 0.35rem;
  }

  .bracket-seed-fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 0.75rem;
  }

  .bracket-seed-fieldset legend {
    padding: 0;
    margin-bottom: 0.35rem;
  }

  .radio-line {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
    margin: 0.35rem 0;
    max-width: 52rem;
  }

  .radio-line input {
    margin-top: 0.2rem;
  }

  .bracket-round-block {
    margin: 1rem 0 1.25rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .bracket-round-block:last-of-type {
    border-bottom: none;
  }

  .bracket-round-matches-head {
    margin: 0.65rem 0 0.35rem;
    font-weight: 650;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.85em;
  }

  .field-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .type-fieldset {
    margin: 0;
    padding: 0.65rem 0.85rem;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
  }

  .type-fieldset legend {
    padding: 0 0.25rem;
  }

  .handicap-config-fieldset {
    margin-top: 0.5rem;
  }

  .handicap-config-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem 0.85rem;
    margin-top: 0.5rem;
  }

  .handicap-config-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.88rem;
  }

  .handicap-config-grid input,
  .handicap-config-grid select {
    width: 100%;
    max-width: 12rem;
  }

  .handicap-config-span {
    grid-column: 1 / -1;
  }

  .radio-line {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0.35rem 0 0;
    font-size: 0.92rem;
    cursor: pointer;
  }

  .radio-line input {
    margin-top: 0.2rem;
  }

  .radio-line-disabled {
    opacity: 0.55;
    cursor: not-allowed;
    pointer-events: none;
  }

  .checkbox-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.92rem;
    cursor: pointer;
  }

  .checkbox-line-misc {
    flex-wrap: wrap;
  }

  .checkbox-misc-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .misc-label-inline {
    width: 6.5rem;
    padding: 0.15rem 0.4rem;
    font-size: inherit;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    background: #fff;
    cursor: text;
  }

  .misc-label-inline:focus {
    outline: 2px solid #93c5fd;
    outline-offset: 1px;
  }

  .draft-classes {
    margin-top: 0.25rem;
  }

  .format-banner {
    margin: 0 0 0.75rem;
    border-radius: 10px;
    border: 1px solid #bbf7d0;
  }

  .empty-tournament-card {
    max-width: 28rem;
  }

  .linkish {
    display: inline;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: #166534;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  .linkish:hover {
    color: #14532d;
  }

  .hc-add-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .tournament-shell {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .tournament-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 1.25rem;
  }

  .title-block {
    flex: 1 1 16rem;
    min-width: 12rem;
  }

  .draft-top-fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem 1.25rem;
  }

  .draft-name-field {
    flex: 1 1 14rem;
    min-width: 10rem;
  }

  .draft-tables-field {
    flex: 0 0 auto;
  }

  .draft-tables-field input[type='number'] {
    width: 4.25rem;
    font: inherit;
    font-size: 0.95rem;
    padding: 0 0.55rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #fff;
    color: inherit;
    --draft-name-line: calc(0.95rem * 1.35);
    height: calc(var(--draft-name-line) * 1.5);
    line-height: calc(var(--draft-name-line) * 1.5 - 2px);
    font-variant-numeric: tabular-nums;
  }

  .title-label {
    display: block;
    font-size: 0.7rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748b;
    margin-bottom: 0.3rem;
  }

  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }

  .title-input {
    flex: 1 1 12rem;
    min-width: 10rem;
    font: inherit;
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    padding: 0.45rem 0.7rem;
    border: 1px solid #cbd5e1;
    border-radius: 9px;
    background: #fff;
    color: #0f172a;
  }

  /**
   * Do not combine with `.grow` here: `.field-block` is a column flex container, and
   * `.grow` uses `flex: 1 1 12rem` (main axis = height), which stretches the control and
   * fights `height` + `min-height: auto` intrinsic minimums.
   */
  .draft-tournament-name-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    font-size: 0.95rem;
    padding: 0 0.55rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #fff;
    color: inherit;
    --draft-name-line: calc(0.95rem * 1.35);
    height: calc(var(--draft-name-line) * 1.5);
    line-height: calc(var(--draft-name-line) * 1.5 - 2px);
  }

  .draft-tournament-name-input:focus {
    outline: none;
    border-color: #16a34a;
    box-shadow: 0 0 0 2px rgb(22 163 74 / 12%);
  }

  .title-input:focus {
    outline: none;
    border-color: #16a34a;
    box-shadow: 0 0 0 3px rgb(22 163 74 / 14%);
  }

  .tournament-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem 1rem;
    padding: 0.55rem 0.85rem;
    background: rgb(255 255 255 / 92%);
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 1px 4px rgb(15 23 42 / 5%);
  }

  .app-dock-footer.tournament-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 19;
    margin: 0;
    max-width: none;
    border-radius: 0;
    border: none;
    border-top: 1px solid #e2e8f0;
    backdrop-filter: blur(10px);
    padding: 0.55rem 1.25rem;
    padding-bottom: calc(0.55rem + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -2px 12px rgb(15 23 42 / 7%);
  }

  .footer-last {
    margin: 0;
    flex: 1 1 14rem;
    font-size: 0.88rem;
    line-height: 1.45;
  }

  .footer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .btn.subtle {
    font-size: 0.8rem;
    padding: 0.38rem 0.65rem;
    color: #475569;
    border-color: #e2e8f0;
    background: #f8fafc;
  }

  .btn.subtle:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }

  .inner-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    padding-bottom: 0.1rem;
    border-bottom: 1px solid #cbd5e1;
  }

  .inner-tabs.inner-tabs-sub {
    margin-top: 0.35rem;
    padding-top: 0.15rem;
    border-bottom-color: #e2e8f0;
  }

  .inner-tabs.class-track-tabs {
    align-items: center;
  }

  .class-track-export-btn {
    margin-left: auto;
    margin-bottom: 0.15rem;
    white-space: nowrap;
    font-size: 0.84rem;
  }

  .inner-tab {
    border: none;
    background: transparent;
    padding: 0.5rem 0.85rem;
    margin-bottom: -1px;
    border-radius: 8px 8px 0 0;
    font: inherit;
    font-size: 0.88rem;
    color: #64748b;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }

  .inner-tab:hover {
    color: #334155;
    background: rgb(255 255 255 / 50%);
  }

  .inner-tab.inner-tab-add-class {
    min-width: 2.25rem;
    font-weight: 600;
  }

  .inner-tab.active {
    color: #15803d;
    font-weight: 600;
    background: #fff;
    border-bottom-color: #16a34a;
  }

  .inner-panels {
    margin-top: 0.5rem;
  }

  .h2 {
    margin: 0 0 0.75rem;
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .h3 {
    margin: 1rem 0 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #334155;
  }

  .h4 {
    margin: 0 0 0.35rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #334155;
  }

  .field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
    margin-bottom: 0.2rem;
  }

  .group-editor-head {
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .group-doubles-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.5rem 0;
    font-size: 0.9rem;
  }

  .pair-label-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: transparent;
  }

  .pair-label-btn:hover {
    text-decoration-color: currentColor;
  }

  .pair-detail-list {
    margin: 0.5rem 0 0;
    padding-left: 1.25rem;
  }

  .group-create-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.65rem;
    margin-top: 0.75rem;
  }

  .group-create-num {
    width: 3.25rem;
    min-height: 0;
    padding: 0.15rem 0.35rem;
    font-size: 0.9rem;
    line-height: 1.5;
    box-sizing: border-box;
  }

  .group-create-gap {
    flex: 0 0 100px;
    width: 100px;
  }

  .group-create-spacer {
    flex: 1 1 auto;
    min-width: 0;
  }

  .group-create-row .btn {
    white-space: nowrap;
  }

  .grid.compact th,
  .grid.compact td {
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
  }

  .group-matrix-wrap {
    margin-top: 0.35rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .group-matrix-table .h2h-th {
    max-width: 5.5rem;
    min-width: 2.25rem;
    vertical-align: bottom;
    text-align: center;
    padding-left: 0.25rem;
    padding-right: 0.25rem;
  }

  .group-matrix-table .h2h-th-inner {
    display: block;
    font-size: 0.65rem;
    line-height: 1.15;
    font-weight: 600;
    word-break: break-word;
  }

  .group-matrix-hint {
    margin: 0.15rem 0 0.5rem;
  }

  .group-matrix-table .h2h-cell {
    text-align: center;
    min-width: 1.75rem;
    font-variant-numeric: tabular-nums;
    padding: 0.15rem 0.2rem;
    vertical-align: middle;
  }

  .matrix-diag {
    display: inline-block;
    min-width: 1.25rem;
    color: #94a3b8;
    font-size: 1.1rem;
    line-height: 1;
  }

  .group-matrix-cell-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    width: 100%;
    min-height: 2.4rem;
    margin: 0;
    padding: 0.2rem 0.15rem;
    border: 1px dashed #cbd5e1;
    border-radius: 6px;
    background: #fff;
    color: #0f172a;
    font: inherit;
    font-size: 0.72rem;
    line-height: 1.2;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .group-matrix-cell-btn:hover {
    background: #f8fafc;
    border-color: #94a3b8;
  }

  .group-matrix-cell-btn.group-matrix-cell-readonly {
    cursor: default;
    border-style: solid;
    border-color: #e2e8f0;
    background: #f1f5f9;
    color: #475569;
  }

  .group-matrix-placeholder {
    color: #94a3b8;
    font-weight: 500;
    letter-spacing: 0.04em;
  }

  .group-matrix-wins-digit {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
  }

  .muted {
    color: #64748b;
  }

  .small {
    font-size: 0.85rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .row.align-end {
    align-items: flex-end;
  }

  .row.align-center {
    justify-content: flex-start;
  }

  .row.gap-sm {
    gap: 0.35rem;
  }

  .debug-fill-count {
    width: 4.25rem;
    padding: 0.22rem 0.4rem;
    font-size: 0.88rem;
  }

  .debug-fill-row {
    margin-top: 0.35rem;
  }

  .grow {
    flex: 1 1 12rem;
    min-width: 8rem;
  }

  .hc {
    width: 4.5rem;
  }

  .chk {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.9rem;
  }

  .seed-list {
    margin: 0.5rem 0;
    padding-left: 1.25rem;
  }

  .players-sort-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.65rem;
  }

  .players-sort-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .players-sort-select {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.22rem 0.4rem;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #fff;
    color: #0f172a;
  }

  .seed-list li {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    margin-bottom: 0.55rem;
  }

  .player-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .player-main .name {
    flex: 1 1 8rem;
    min-width: 6rem;
  }

  .player-name-btn {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-weight: 600;
    color: #0f4c81;
    text-align: left;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgb(15 76 129 / 35%);
    text-underline-offset: 0.15em;
  }

  .player-name-btn:hover {
    color: #0a3d6b;
    text-decoration-color: currentColor;
  }

  .player-classes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding-left: 0.15rem;
  }

  .chk.tight {
    font-size: 0.82rem;
    color: #475569;
  }

  .class-grid {
    margin-top: 0.45rem;
  }

  .small-inline {
    font-size: 0.78rem;
    padding: 0.28rem 0.45rem;
  }

  .hc-wrap {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .hc-label {
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }

  .player-main .pid {
    font-size: 0.8rem;
    color: #64748b;
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
    margin-top: 0.65rem;
  }

  .grid th,
  .grid td {
    text-align: left;
    padding: 0.45rem 0.5rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .grid th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
  }

  .match-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.65rem;
    background: #fafbfc;
  }

  .match-card header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.45rem;
  }

  .match-card .meta {
    font-size: 0.78rem;
    color: #64748b;
    text-transform: uppercase;
  }

  .mini {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
    margin-bottom: 0.45rem;
  }

  .mini th,
  .mini td {
    border: 1px solid #e2e8f0;
    padding: 0.25rem 0.35rem;
  }

  .mini input {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    padding: 0.25rem 0.35rem;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
  }

  .done-scores {
    margin: 0;
    padding-left: 1.1rem;
    color: #334155;
    font-size: 0.9rem;
  }

  .sub-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.65rem 0.85rem;
    margin-bottom: 0.5rem;
  }

  .plain-list {
    margin: 0.25rem 0 0;
    padding-left: 1.15rem;
  }

  .placement-ol {
    list-style: none;
    padding-left: 0;
  }

  .placement-ol li {
    margin: 0.22rem 0;
    font-size: 0.95rem;
  }

  .placement-ol li.placement-first {
    font-size: 1.08rem;
    font-weight: 700;
  }

  .placement-ol li.placement-after-podium {
    margin-bottom: 0.85rem;
  }

  .placement-num {
    display: inline-block;
    min-width: 1.85rem;
    font-weight: 600;
    color: #334155;
  }

  .result-line {
    margin: 0.35rem 0;
    font-size: 0.92rem;
  }

  .btn {
    font: inherit;
    cursor: pointer;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #fff;
    padding: 0.45rem 0.85rem;
    font-size: 0.9rem;
  }

  .btn:hover:not(:disabled) {
    border-color: #94a3b8;
    background: #f8fafc;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn.primary {
    border-color: #16a34a;
    background: #16a34a;
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: #15803d;
    border-color: #15803d;
  }

  .btn.ghost {
    border-style: dashed;
    border-color: #94a3b8;
    background: #f8fafc;
  }

  .btn.danger-ghost {
    border-color: #fca5a5;
    color: #b91c1c;
    background: #fef2f2;
  }

  .file-btn {
    position: relative;
    display: inline-block;
    padding: 0.45rem 0.85rem;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
  }

  .file-btn:hover {
    background: #f1f5f9;
  }

  .sr {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    overflow: hidden;
  }

  .grow,
  .hc {
    font: inherit;
    padding: 0.35rem 0.5rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
  }

  .load-overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(15, 23, 42, 0.45);
  }

  .load-panel {
    width: min(28rem, 100%);
    padding: 1.25rem 1.35rem 1.1rem;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
  }

  .load-title {
    margin: 0 0 0.55rem;
    font-size: 1.05rem;
    font-weight: 600;
    color: #0f172a;
  }

  .load-meta {
    margin: 0 0 0.65rem;
  }

  .load-track {
    width: 100%;
    height: 0.55rem;
    border-radius: 999px;
    background: #e2e8f0;
    overflow: hidden;
  }

  .load-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    /* No width transition — heuristic trials update faster than 120ms apart. */
  }

  .load-track-indeterminate .load-fill-indeterminate {
    width: 40%;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    animation: load-indeterminate 1.1s ease-in-out infinite;
  }

  @keyframes load-indeterminate {
    0% {
      transform: translateX(-120%);
    }
    100% {
      transform: translateX(320%);
    }
  }

  .modal-root {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 1.5rem 1rem 2rem;
    overflow-y: auto;
  }

  .modal-scrim {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: rgb(15 23 42 / 45%);
    cursor: pointer;
  }

  .modal-dialog {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 26rem;
    margin-top: 2vh;
    padding: 1rem 1.15rem 1.15rem;
    border-radius: 14px;
    background: #fff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 12px 40px rgb(15 23 42 / 18%);
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }

  .modal-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  .modal-lead {
    margin: 0 0 0.75rem;
  }

  .modal-error {
    margin: 0.5rem 0 0;
    font-size: 0.88rem;
    color: #b91c1c;
  }

  .modal-actions {
    margin-top: 0.85rem;
    justify-content: flex-end;
  }

  .delete-confirm-input {
    width: 100%;
    margin-top: 0.35rem;
    box-sizing: border-box;
  }

  .score-modal-table-readout {
    margin: 0.5rem 0 0.65rem;
  }

  .score-modal-table-readout .field-label {
    font-weight: 600;
    color: #334155;
    margin-right: 0.35rem;
  }

  .score-modal-table {
    margin-top: 0.25rem;
  }

  .score-modal-table tr.row-muted td {
    opacity: 0.45;
  }

  .game-hint {
    font-size: 0.78rem;
    color: #b45309;
    padding: 0.15rem 0 0.1rem;
  }

  .hint-row td {
    border-bottom: 1px solid #e2e8f0;
    padding-top: 0;
  }
</style>
