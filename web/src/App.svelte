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
    type ReplayExecuteProfile,
    tournamentControllerFromCommandLogAsync,
    compareBracketMatchId,
    compareBracketMatchIdString,
    bracketMatchRound,
    inferBracketSlotCountFromRoundOne,
    bracketPlayerMatchId,
    canMutateBracketPlayerMatch,
    canMutateExistingGroupPhaseMatchScores,
    clampPlayerHandicapValue,
    closedFormGroupCountForPlayerCount,
    CLOSED_FORM_PLAYERS_PER_GROUP,
    defaultBracketSeedingModeForTournament,
    resolveClosedFormBracketSeedingKind,
    formatBracketSlotPlayerLabel,
    handicapValueBounds,
    isExactClosedFormBracketGrid,
    isHandicapActive,
    supportsExtendedClosedFormBracketSeeding,
    matchPlayersResolvedForBracketPhaseList,
    normalizeHandicapConfig,
    randomPlayerHandicapValue,
    singleEliminationPlacementRows,
    gameWinner,
    generateBracket,
    bracketRoundHasOpenEliminationPairings,
    groupNumberedTitle,
    tournamentUsesClassTabs,
    isGameScoreLegal,
    isMatchScoreLegal,
    isPlayerDisplayNameTaken,
    matchWinner,
    shuffleDeterministic,
    DEFAULT_NUMERICAL_HANDICAP_CONFIG,
    buildDefaultTableIds,
    matchAssignedTableId,
    matchIdOnTable,
  } from 'ttc-tornooiapp';
  import BracketStreamView from './BracketStreamView.svelte';
  import { displayBracketColumns } from './bracketStream/displayColumns';
  import PlayerName from './PlayerName.svelte';
  import TournamentOverview from './TournamentOverview.svelte';
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
    /** Planned flow; only `group-bracket` is implemented end-to-end. */
    tournamentFormat: TournamentFormat;
  }

  type ScoreRow = { a: string; b: string };

  /** Top workspace tab: `'settings'` or a tournament session id. */
  let workspaceTab = $state<string>('settings');
  let sessions = $state<TournamentSession[]>([]);
  let activeSessionId = $state<string>('');

  /** Draft handicap per player id (synced from tournament in pull when row not focused). */
  let handicapDrafts = $state<Record<string, number>>({});
  let handicapFocusPid = $state<string | null>(null);

  let tournament = $state<Tournament>(createTournament());
  const handicapEnabled = $derived(isHandicapActive(tournament));
  const handicapBounds = $derived(
    tournament.handicapConfig ? handicapValueBounds(tournament.handicapConfig) : { min: 0, max: 0 },
  );
  const bracketSeedingParticipantIds = $derived(eligibleGlobalGroupPlayerIds(tournament));
  const closedFormSeedingKind = $derived.by(() =>
    resolveClosedFormBracketSeedingKind(tournament, bracketSeedingParticipantIds, undefined),
  );
  const canPickClosedFormSeeding = $derived(closedFormSeedingKind !== null);
  const canPickExtendClosedFormSeeding = $derived(
    supportsExtendedClosedFormBracketSeeding(tournament, bracketSeedingParticipantIds, undefined),
  );
  const globalGroupPlayerCount = $derived(eligibleGlobalGroupPlayerIds(tournament).length);
  const suggestedGlobalGroupTargetCount = $derived(
    closedFormGroupCountForPlayerCount(globalGroupPlayerCount),
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

    const prevSuggested = closedFormGroupCountForPlayerCount(prevCount);
    const nextSuggested = closedFormGroupCountForPlayerCount(playerCount);
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

      const prevSuggested = closedFormGroupCountForPlayerCount(prevCount);
      const nextSuggested = closedFormGroupCountForPlayerCount(playerCount);
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
      eligibleGlobalGroupPlayerIds(tournament),
      undefined,
    );
  });
  type StatusKind = 'info' | 'warn' | 'error';
  type AppStatus = { message: string; kind: StatusKind };
  let status = $state<AppStatus | null>(null);

  function clearStatus(): void {
    status = null;
  }
  function showStatus(message: string, kind: StatusKind): void {
    status = { message, kind };
  }
  function showInfo(message: string): void {
    showStatus(message, 'info');
  }
  function showWarn(message: string): void {
    showStatus(message, 'warn');
  }
  function showError(message: string): void {
    showStatus(message, 'error');
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
      return await tournamentControllerFromCommandLogAsync(text, {}, {
        onProgress: ({ done, total }) => {
          tournamentLoad = { label, phase: 'replay', done, total };
        },
        yieldEvery: 32,
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
  const deleteConfirmOk = $derived(deleteConfirmPhrase === 'I understand');

  let newName = $state('');
  let newHc = $state(0);

  /** New tournament wizard (Settings). */
  let draftTournamentName = $state('Tournament');
  let draftHandicapEnabled = $state(false);
  let draftHandicapMin = $state(DEFAULT_NUMERICAL_HANDICAP_CONFIG.minValue);
  let draftHandicapMax = $state(DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxValue);
  let draftHandicapStartingCriteria = $state<HandicapStartingCriteria>(
    DEFAULT_NUMERICAL_HANDICAP_CONFIG.startingCriteria,
  );
  let draftHandicapMaxStart = $state(DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxStartAdjustment);
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
      nav: normalizeSessionNav(t0, { kind: 'single', inner: 'players' }),
      classEditorRows:
        t0.classDefinitions.length > 0
          ? t0.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
          : [{ id: newCompetitionClassId(), name: '' }],
      groupTargetSize: CLOSED_FORM_PLAYERS_PER_GROUP,
      groupTargetCount: closedFormGroupCountForPlayerCount(playerOrder.length),
      classGroupTargetSizeByClassId: {},
      classGroupTargetCountByClassId: {},
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
    const snapshot = `${s.tournamentName}\n${text}`;
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
      showError('Could not save before closing; tournament kept open.');
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
      showInfo(`Deleted “${name}”.`);
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
      showInfo(`Opened “${existing.tournamentName}”.`);
      return;
    }
    if (!storageAvailable) {
      showError('Local tournament storage is not available in this browser.');
      return;
    }
    const meta = recentTournaments.find((m) => m.fileId === fileId);
    const label = meta?.tournamentName ?? 'Tournament';
    try {
      tournamentLoad = { label, phase: 'read', done: 0, total: 0 };
      const text = await loadTournamentJsonl(fileId);
      const { controller: next, replay } = await buildControllerFromCommandLogWithProgress(text, label);
      if (!replay.success) {
        const reason = replay.results.find((r) => !r.success)?.reason ?? 'Replay failed';
        showError(`Could not open tournament: ${reason}`);
        return;
      }
      const session = sessionFromController(fileId, label, next);
      activateSession(session);
      logDebugReplayExecuteProfile(label, replay.executeProfile);
      showInfo(`Opened “${session.tournamentName}”.`);
    } catch (e) {
      tournamentLoad = null;
      showError(`Could not load tournament: ${e instanceof Error ? e.message : String(e)}`);
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
    return 'Win at 11+ with a two-point margin. After 10–10, if either side goes above 11, the final gap must be exactly two points (e.g. 12–10 or 13–11, not 13–10).';
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
  function openBracketPairingModal(bm: BracketMatch): void {
    if (bm.id.startsWith('__ph-')) return;
    const s = getActiveSession();
    if (!s) return;
    const canon = bracketMatchBySlotId(tournament, bm.id);
    const seedA = bm.seedA ?? canon?.seedA;
    const seedB = bm.seedB ?? canon?.seedB;
    if (!seedA || !seedB) return;
    const mid = bracketPlayerMatchId(bm.id);
    let match = tournament.matches[mid];
    if (!match) {
      const c = s.controller;
      const deps: string[] = [`cmd-${seedA}`, `cmd-${seedB}`];
      if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
      if (s.lastSetGroupsCommandId) deps.push(s.lastSetGroupsCommandId);
      const cmdId = `cmd-bracket-slot-${bm.id}-${Date.now()}`;
      const r = c.createMatch(mid, seedA, seedB, deps, cmdId);
      if (!r.success) {
        showError(r.reason ?? 'Could not create bracket match row');
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
    const cid = match.classId;
    if (cid && tournament.classTournaments[cid]?.bracketMatches?.length) {
      const s = tournament.classTournaments[cid];
      return { br: s.bracketMatches, locks: s.lockedBracketRounds ?? [] };
    }
    return { br: tournament.bracketMatches, locks: tournament.lockedBracketRounds ?? [] };
  }

  function bracketMatchBySlotId(t: Tournament, bmId: string): BracketMatch | undefined {
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
        showError(r.reason ?? 'clearMatchScores failed');
        pull();
        return;
      }
      showInfo(`Cleared group result for ${playerLabel(sm.playerA)} vs ${playerLabel(sm.playerB)}.`);
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
      showError(r.reason ?? 'clearMatchScores failed');
      pull();
      return;
    }
    showInfo(`Cleared result for ${sm.id}.`);
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

  function groupDisplayLabel(g: GroupDefinition): string {
    return groupNumberedTitle(g);
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
    const suggested = closedFormGroupCountForPlayerCount(n);
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
      showWarn('With multiple competition classes, use each class tab for groups.');
      return;
    }
    const ordered = eligibleGlobalGroupPlayerIds(t);
    if (ordered.length === 0) {
      showWarn('Add at least one player (and seedings) before creating groups.');
      return;
    }
    const deps: string[] = [...new Set(ordered)].map((id) => `cmd-${id}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setgroups-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setGroups({ ...payload, playerIds: ordered }, deps, cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not create groups');
      pull();
      return;
    }
    patchActiveSession({ lastSetGroupsCommandId: cmdId });
    showInfo('Created groups and all round‑robin matches.');
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
      showWarn('Use class tabs to clear class groups.');
      return;
    }
    const deps: string[] = [];
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setgroups-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setGroups([], deps, cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not clear groups');
      pull();
      return;
    }
    patchActiveSession({ lastSetGroupsCommandId: cmdId });
    showInfo('Cleared groups and group matches.');
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
      showWarn('Class groups require two or more competition classes.');
      return;
    }
    const slice = classSlice(t, classId);
    const ordered = [...slice.seedings];
    if (ordered.length === 0) {
      showWarn('No players in this class yet — enable the class for players on the Players tab.');
      return;
    }
    const deps: string[] = [...new Set(ordered)].map((id) => `cmd-${id}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setcg-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.setClassGroups(classId, { ...payload, playerIds: ordered }, deps, cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not create class groups');
      pull();
      return;
    }
    patchActiveSession({
      lastSetClassGroupsCommandIdByClass: { ...s.lastSetClassGroupsCommandIdByClass, [classId]: cmdId },
    });
    showInfo('Created groups and round‑robin matches for this class.');
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
      showError(r.reason ?? 'Could not clear class groups');
      pull();
      return;
    }
    patchActiveSession({
      lastSetClassGroupsCommandIdByClass: { ...s.lastSetClassGroupsCommandIdByClass, [classId]: cmdId },
    });
    showInfo('Cleared groups for this class.');
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
    adj: ['Swift', 'Quiet', 'Lucky', 'Bold', 'Calm', 'Keen', 'Bright', 'Steady', 'Quick', 'Fine'],
    noun: ['Fox', 'River', 'Paddle', 'Ace', 'Spin', 'Loop', 'Drive', 'Block', 'Serve', 'Rally'],
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

  function anyUnfinishedGroupPhaseMatch(t: Tournament): boolean {
    for (const m of Object.values(t.matches)) {
      if (!m.groupId) continue;
      if (m.status === 'scheduled' || m.status === 'in-progress') return true;
    }
    return false;
  }

  /** Scheduled or assigned to a table — still needs scores for debug simulate. */
  function matchOpenForScoring(m: Match): boolean {
    return m.status === 'scheduled' || m.status === 'in-progress';
  }

  /** After undo/clear, bracket slots may lack a `match-*` row; create scheduled rows so debug scoring can run. */
  function debugEnsureBracketMatchRows(c: TournamentController, s: TournamentSession): void {
    if (Object.keys(c.getTournament().teamMatches).length > 0) return;
    let t = c.getTournament();
    for (const bm of t.bracketMatches) {
      if (!bm.seedA || !bm.seedB) continue;
      if (!t.players[bm.seedA] || !t.players[bm.seedB]) continue;
      const mid = bracketPlayerMatchId(bm.id);
      if (t.matches[mid]) continue;
      const deps: string[] = [`cmd-${bm.seedA}`, `cmd-${bm.seedB}`];
      if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
      if (s.lastSetGroupsCommandId) deps.push(s.lastSetGroupsCommandId);
      const cmdId = `cmd-dbg-ensure-${bm.id}-${Date.now()}`;
      const r = c.createMatch(mid, bm.seedA, bm.seedB, deps, cmdId);
      if (!r.success && r.reason !== 'Match already exists') {
        showError(r.reason ?? `Could not create ${mid}`);
      }
      t = c.getTournament();
    }
  }

  /** Knockout slots that still need scores (ignores stale `bm.winner` when the player row is still open). */
  function bracketSimulateEligibleEntries(t: Tournament): Array<{ m: Match; round: number }> {
    const entries: Array<{ m: Match; round: number }> = [];
    for (const bm of t.bracketMatches) {
      if (!bm.seedA || !bm.seedB) continue;
      const mid = bracketPlayerMatchId(bm.id);
      const m = t.matches[mid];
      if (!m || m.groupId) continue;
      if (!matchOpenForScoring(m)) continue;
      if (m.scores.length > 0) continue;
      if (!matchPlayersResolvedForBracketPhaseList(t, m, undefined)) continue;
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

  function debugSimulateBracketPhaseMatches(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    let t = c.getTournament();
    if (anyUnfinishedGroupPhaseMatch(t)) {
      showWarn('Finish all group‑phase matches before simulating bracket scores.');
      pull();
      return;
    }
    debugEnsureBracketMatchRows(c, s);
    t = c.getTournament();
    const seedEntries = bracketSimulateEligibleEntries(t);
    if (seedEntries.length === 0) {
      showWarn('No knockout matches awaiting scores to simulate (byes and finished slots are skipped).');
      pull();
      return;
    }
    const targetRound = Math.min(...seedEntries.map((e) => e.round));

    const rng = Math.random;
    let done = 0;
    const maxIters = 200;
    for (let iter = 0; iter < maxIters; iter++) {
      t = c.getTournament();
      debugEnsureBracketMatchRows(c, s);
      t = c.getTournament();
      const roundEntries = bracketSimulateEligibleEntries(t).filter((e) => e.round === targetRound);
      if (roundEntries.length === 0) break;
      const m = sortBracketSimulateMatches(roundEntries.map((e) => e.m))[0]!;

      const scores = debugRandomLegalBo5Scores(rng);
      if (!isMatchScoreLegal(scores)) {
        showError('Internal: generated illegal scores.');
        pull();
        return;
      }
      const bid = m.id.startsWith('match-') ? m.id.slice('match-'.length) : '';
      const bm = bid ? t.bracketMatches.find((x) => x.id === bid) : undefined;
      const createCmdId = bm ? c.findLatestActiveCreateMatchCommandId(m.id) : undefined;
      const deps = createCmdId ? [createCmdId] : [];
      const cmdId = `cmd-dbg-brkt-${m.id}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const r = c.enterScore(m.id, scores, deps, cmdId);
      if (!r.success) {
        showError(r.reason ?? `Stopped while scoring ${m.id} (${done} done).`);
        pull();
        return;
      }
      done++;
      pull();
    }

    if (done === 0) {
      showWarn('No knockout matches awaiting scores to simulate (byes and finished slots are skipped).');
      pull();
      return;
    }

    showInfo(`Debug: simulated ${done} bracket match(es) (round ${targetRound}).`);
    pull();
  }

  function debugFillPlayers(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const n = Math.max(0, Math.min(80, Math.floor(Number(debugFillPlayerCount.trim()))));
    if (!Number.isFinite(n) || n < 1) {
      showWarn('Enter a positive number of players.');
      return;
    }
    const c = s.controller;
    const t0 = c.getTournament();
    if (Object.keys(t0.teamMatches).length > 0) {
      showWarn('Debug fill is disabled while a team vs team match exists.');
      return;
    }
    const basePool = debugAllAdjNounNames().filter((nm) => !isPlayerDisplayNameTaken(t0, nm));
    if (basePool.length < n) {
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
    for (let i = 0; i < n; i++) {
      const id = newId();
      const cmdId = `cmd-${id}`;
      const hc = randomHandicapForTournament(rng);
      const r = c.createPlayer(id, pool[i]!, hc, cmdId);
      if (!r.success) {
        showError(r.reason ?? `Stopped after ${addedIds.length} player(s).`);
        pull();
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
      pull();
      return;
    }
    patchActiveSession({ playerOrder: newOrder, lastSeedingCommandId: seedCmdId });
    const t1 = c.getTournament();
    const defs = t1.classDefinitions;
    if (defs.length >= 2) {
      for (const pid of addedIds) {
        const flags: Record<string, boolean> = {};
        for (const def of defs) {
          flags[def.id] = rng() < 0.4;
        }
        if (!defs.some((d) => flags[d.id])) {
          const pick = defs[debugRandomInt(rng, 0, defs.length - 1)]!;
          flags[pick.id] = true;
        }
        const cmdId = `cmd-dbg-class-${pid}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
        c.setPlayerClassFlags(pid, flags, [`cmd-${pid}`], cmdId);
      }
    }
    showInfo(`Debug: added ${n} player(s).`);
    pull();
  }

  function debugSimulateGroupMatches(classId: string | undefined): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    const list = groupMatchesInScope(t, classId).filter(matchOpenForScoring);
    if (list.length === 0) {
      showWarn('No group matches awaiting scores to simulate.');
      pull();
      return;
    }
    const rng = Math.random;
    let done = 0;
    for (const m of list) {
      const scores = debugRandomLegalBo5Scores(rng);
      if (!isMatchScoreLegal(scores)) {
        showError('Internal: generated illegal scores.');
        pull();
        return;
      }
      const cmdId = `cmd-dbg-sim-${m.id}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const r = c.enterScore(m.id, scores, [], cmdId);
      if (!r.success) {
        showError(r.reason ?? `Stopped while scoring ${m.id} (${done} done).`);
        pull();
        return;
      }
      done++;
    }
    showInfo(`Debug: simulated ${done} group match(es).`);
    pull();
  }

  function groupStandingsForGroup(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
  ): Array<{ pid: string; w: number; l: number }> {
    const pids = g.playerIds;
    const wins: Record<string, number> = Object.fromEntries(pids.map((p) => [p, 0]));
    const losses: Record<string, number> = Object.fromEntries(pids.map((p) => [p, 0]));
    for (const m of Object.values(t.matches)) {
      if (m.groupId !== g.id || m.status !== 'finished' || !m.winner) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      if (!pids.includes(m.playerA) || !pids.includes(m.playerB)) continue;
      wins[m.winner] = (wins[m.winner] ?? 0) + 1;
      const loser = m.winner === m.playerA ? m.playerB : m.playerA;
      losses[loser] = (losses[loser] ?? 0) + 1;
    }
    return [...pids]
      .map((pid) => ({ pid, w: wins[pid] ?? 0, l: losses[pid] ?? 0 }))
      .sort((a, b) => b.w - a.w || a.l - b.l || a.pid.localeCompare(b.pid));
  }

  /** W/L per player for the matrix footer columns (order-independent). */
  function groupStandingsWlByPid(
    t: Tournament,
    g: GroupDefinition,
    classId: string | undefined,
  ): Record<string, { w: number; l: number }> {
    const m: Record<string, { w: number; l: number }> = {};
    for (const row of groupStandingsForGroup(t, g, classId)) {
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
    const a = playerLabel(m.playerA);
    const b = playerLabel(m.playerB);
    if (m.scores.length === 0 && m.status === 'scheduled') {
      return groupMatrixCellViewOnly(t, m) ? `${a} vs ${b}, locked` : `${a} vs ${b}, enter scores`;
    }
    return groupMatrixCellViewOnly(t, m) ? `${a} vs ${b}, view scores` : `${a} vs ${b}, edit scores`;
  }

  function titleFromImportFilename(filename: string): string {
    const base = filename.trim().replace(/^.*[/\\]/, '');
    const withoutExt = base.replace(/\.(jsonl|json|txt)$/i, '');
    return withoutExt.trim() || 'Imported tournament';
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
    showInfo(`Title set to: ${suggested}`);
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

  function bracketSlotTitle(m: BracketMatch, side: 'a' | 'b', t: Tournament, bracketClassId?: string): string {
    const id = side === 'a' ? m.seedA : m.seedB;
    if (id) return formatBracketSlotPlayerLabel(t, id, bracketClassId);
    if (m.id.startsWith('__ph-')) return '—';
    return '--empty--';
  }

  /** Map legacy `bracket-setup` / `bracket:7` session nav onto current tab ids. */
  function coerceLegacyInnerTab(value: InnerTab | ClassInnerTab | string): InnerTab | ClassInnerTab {
    const s = String(value);
    if (s === 'bracket-setup') return 'groups';
    if (s.startsWith('bracket:')) return 'bracket';
    return value as InnerTab;
  }

  function normalizeInnerTab(_t: Tournament, current: InnerTab): InnerTab {
    return coerceLegacyInnerTab(current) as InnerTab;
  }

  function normalizeBracketSubTab(_rounds: number[], current: InnerTab | ClassInnerTab): InnerTab | ClassInnerTab {
    return coerceLegacyInnerTab(current);
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
        uniqueSortedRounds(t.classTournaments[first.id]?.bracketMatches ?? []),
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
    const rounds = uniqueSortedRounds(t.classTournaments[classId]?.bracketMatches ?? []);
    return {
      kind: 'multi',
      screen: { classId, inner: normalizeBracketSubTab(rounds, inner) as ClassInnerTab },
    };
  }

  function classSlice(t: Tournament, classId: string): ClassTournamentSlice {
    return (
      t.classTournaments[classId] ?? {
        seedings: [],
        groups: {},
        bracketMatches: [],
        lockedBracketRounds: [],
      }
    );
  }

  function patchActiveSession(patch: Partial<TournamentSession>): void {
    if (!getActiveSession()) return;
    sessions = sessions.map((s) => (s.id === activeSessionId ? { ...s, ...patch } : s));
  }

  function pull(): void {
    try {
      const s = getActiveSession();
      if (!s) {
        tournament = createTournament();
        return;
      }
      const t = structuredClone(s.controller.getTournament());
      // If the score modal is open for a match that doesn't exist in the next snapshot,
      // clear it *before* swapping `tournament` to avoid rendering with `sm = undefined`.
      if (scoreModalMatchId && !t.matches[scoreModalMatchId]) {
        scoreModalMatchId = null;
        scoreModalHint = null;
      }
      tournament = t;

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

      const po = sAfter.playerOrder;
      const hd: Record<string, number> = { ...handicapDrafts };
      for (const pid of po) {
        const h = t.players[pid]?.handicap ?? 0;
        if (handicapFocusPid !== pid) {
          hd[pid] = h;
        } else if (!(pid in hd)) {
          hd[pid] = h;
        }
      }
      for (const k of Object.keys(hd)) {
        if (!po.includes(k)) delete hd[k];
      }
      handicapDrafts = hd;
      void persistActiveSession();
    } catch (e) {
      // Avoid hard-locking the UI on a render-triggering exception; surface it.
      console.error('pull() failed', e);
      scoreModalMatchId = null;
      scoreModalHint = null;
      showError(`Internal UI error while updating: ${e instanceof Error ? e.message : String(e)}`);
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
    const namedClasses = draftClassesEnabled
      ? draftClassEditorRows
          .map((r) => ({
            id: r.id.trim() || newCompetitionClassId(),
            name: r.name.trim(),
          }))
          .filter((r) => r.name.length > 0)
      : [];
    if (namedClasses.length > 0) {
      const cmdId = `cmd-classes-init-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const r = controller.setTournamentClasses(namedClasses, [], cmdId);
      if (!r.success) {
        showError(r.reason ?? 'Could not apply competition classes');
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
      groupTargetCount: closedFormGroupCountForPlayerCount(0),
      lastSetGroupsCommandId: '',
      classGroupTargetSizeByClassId: {},
      classGroupTargetCountByClassId: {},
      lastSetClassGroupsCommandIdByClass: {},
      tournamentFormat: draftTournamentFormat,
    };
    activateSession(session);
    draftTournamentName = 'Tournament';
    draftHandicapEnabled = false;
    draftHandicapMin = DEFAULT_NUMERICAL_HANDICAP_CONFIG.minValue;
    draftHandicapMax = DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxValue;
    draftHandicapStartingCriteria = DEFAULT_NUMERICAL_HANDICAP_CONFIG.startingCriteria;
    draftHandicapMaxStart = DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxStartAdjustment;
    draftClassesEnabled = false;
    draftClassEditorRows = [{ id: newCompetitionClassId(), name: '' }];
    draftTournamentFormat = 'group-bracket';
    draftTableCount = 4;
    pull();
    showInfo('Tournament created. Add players on the Players tab.');
  }

  function applyOverviewTableCount(count: number): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const clamped = Math.min(32, Math.max(1, Math.floor(count)));
    const tableIds = buildDefaultTableIds(clamped);
    const r = s.controller.setTournamentTables(tableIds, [], `cmd-tables-${Date.now()}`);
    if (!r.success) {
      showError(r.reason ?? 'Could not update tables');
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
    if (!r.success) showError(r.reason ?? 'Could not assign table');
    pull();
  }

  function overviewClearMatchFromTable(matchId: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.clearMatchTableAssignment(matchId, [], `cmd-table-clear-${matchId}-${Date.now()}`);
    if (!r.success) showError(r.reason ?? 'Could not clear table');
    pull();
  }

  function doUndo(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.undoLast();
    if (!r.success) {
      showError(r.reason ?? 'Undo failed');
    } else {
      showInfo('Undid one step (logged as Undo command).');
    }
    pull();
  }

  function doRedo(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.redo();
    if (!r.success) {
      showError(r.reason ?? 'Redo failed');
    } else {
      showInfo('Redo: removed last Undo from the log.');
    }
    pull();
  }

  function addPlayer(): void {
    clearStatus();
    const s0 = getActiveSession();
    if (!s0) return;
    const name = newName.trim();
    if (!name) {
      showWarn('Enter a player name.');
      return;
    }
    const id = newId();
    const cmdId = `cmd-${id}`;
    const c = s0.controller;
    const cfg = s0.controller.getTournament().handicapConfig;
    const hc = cfg ? clampPlayerHandicapValue(cfg, Number(newHc) || 0) : 0;
    const r = c.createPlayer(id, name, hc, cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not add player');
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
    newName = '';
    newHc = 0;
    showInfo(`Added ${name} (${id}).`);
    pull();
  }

  function generateKnockoutBracket(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      showWarn(
        'This tournament has multiple competition classes. Per-class bracket generation from each class tab will be added next; the global bracket control is disabled.',
      );
      return;
    }
    if (Object.keys(t.groups).length === 0) {
      showWarn('Create groups (group phase) before generating the knockout bracket.');
      return;
    }
    if (t.seedings.length === 0 || s.playerOrder.length === 0) {
      showWarn('Add at least one player first.');
      return;
    }
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) {
      deps.push(s.lastSeedingCommandId);
    }
    if (s.lastSetGroupsCommandId) {
      deps.push(s.lastSetGroupsCommandId);
    }
    const genId = `cmd-gen-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const shuffleKey = s.tournamentName.trim() || 'Tournament';
    const tieBreakSalt = String(Date.now());
    const r = c.generateBracket(true, false, deps, genId, shuffleKey, {
      bracketSeedingMode: bracketSeedingChoice,
      tieBreakSalt,
    });
    if (!r.success) {
      showError(r.reason ?? 'Bracket generation failed');
      pull();
      return;
    }
    const live = c.getTournament();
    const r1 = live.bracketMatches.filter((m) => bracketMatchRound(m) === 1 && m.seedA && m.seedB);
    if (r1.length === 0) {
      showWarn('Bracket generated, but no round‑1 pairings with two players.');
      pull();
      return;
    }
    for (const bm of r1) {
      const mid = `match-${bm.id}`;
      if (live.matches[mid]) continue;
      const a = bm.seedA!;
      const b = bm.seedB!;
      const createCmdId = `${genId}-pair-${bm.id}`;
      const rM = c.createMatch(mid, a, b, [genId, `cmd-${a}`, `cmd-${b}`], createCmdId);
      if (!rM.success) {
        showError(rM.reason ?? 'createMatch failed');
        pull();
        return;
      }
    }
    if (c.getTournament().bracketMatches.length > 0) {
      patchActiveSession({ nav: { kind: 'single', inner: 'bracket' } });
    }
    showInfo('Knockout bracket generated (byes filled) and round‑1 matches created.');
    pull();
  }

  function removeKnockoutBracket(): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    if (tournament.bracketMatches.length === 0) {
      showWarn('No knockout bracket to remove.');
      return;
    }
    if (
      !confirm(
        'Remove the knockout bracket? All bracket pairings, scores, round locks, and related data will be forgotten. The group phase is not changed.',
      )
    ) {
      return;
    }
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    if (s.lastSetGroupsCommandId) deps.push(s.lastSetGroupsCommandId);
    const gen = [...s.controller.getCommandLog()].reverse().find((c) => c.type === 'GenerateBracket');
    if (gen) deps.push(gen.id);
    const cmdId = `cmd-clear-bracket-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = s.controller.clearBracket(deps, cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not remove bracket');
      pull();
      return;
    }
    showInfo('Knockout bracket removed. You can create a new bracket when ready.');
    pull();
  }

  function eliminateBracketRoundByRanking(round: number): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const salt = crypto.randomUUID();
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    if (s.lastSetGroupsCommandId) deps.push(s.lastSetGroupsCommandId);
    const log = s.controller.getCommandLog();
    const gen = [...log].reverse().find((c) => c.type === 'GenerateBracket');
    if (gen) deps.push(gen.id);
    const cmdId = `cmd-elim-r${round}-${salt.replaceAll('-', '').slice(0, 12)}`;
    const r = s.controller.eliminateLowestBracketRound(round, deps, salt, cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Elimination failed');
      pull();
      return;
    }
    showInfo(`Eliminated lower-ranked players in round ${round} where pairings were still open.`);
    pull();
  }

  function commitPlayerHandicap(playerId: string): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const cfg = tournament.handicapConfig;
    if (!cfg) return;
    const c = s.controller;
    const p = c.getTournament().players[playerId];
    if (!p) return;
    const raw = Number(handicapDrafts[playerId]);
    const next = clampPlayerHandicapValue(cfg, Number.isFinite(raw) ? raw : 0);
    if (next === p.handicap) return;
    const cmdId = `cmd-hc-${playerId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.renamePlayer(playerId, p.name, next, [`cmd-${playerId}`], cmdId);
    if (!r.success) {
      showError(r.reason ?? 'Could not update handicap');
    } else {
      showInfo(`Handicap for ${p.name} set to ${next}.`);
    }
    pull();
  }

  function playerLabel(id: string | undefined): string {
    if (!id) return '—';
    return tournament.players[id]?.name ?? id;
  }

  function bracketRows(matches: BracketMatch[]): BracketMatch[] {
    return [...matches].sort(
      (a, b) => bracketMatchRound(a) - bracketMatchRound(b) || compareBracketMatchId(a, b),
    );
  }

  function setRoundLock(round: number, locked: boolean): void {
    clearStatus();
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const r = c.setRoundLock(
      round,
      locked,
      [],
      `cmd-lock-${round}-${locked ? 'on' : 'off'}-${crypto.randomUUID().slice(0, 8)}`,
    );
    if (!r.success) {
      showError(r.reason ?? 'SetRoundLock failed');
    } else {
      showInfo(locked ? `Locked bracket round ${round}.` : `Unlocked bracket round ${round}.`);
    }
    pull();
  }

  function downloadJsonl(): void {
    const s = getActiveSession();
    if (!s) {
      showWarn('Create or import a tournament before exporting.');
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
    showInfo('Downloaded command log (.jsonl).');
  }

  function exportTournamentPdf(): void {
    const s = getActiveSession();
    if (!s) {
      showWarn('Create or import a tournament before exporting.');
      return;
    }
    try {
      downloadTournamentPdf(s.tournamentName, s.controller.getTournament());
      showInfo('Downloaded tournament summary (.pdf).');
    } catch (e) {
      showError(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
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
      showError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const { controller: next, replay } = await buildControllerFromCommandLogWithProgress(text, tournamentName);
    if (!replay.success) {
      const reason = replay.results.find((r) => !r.success)?.reason ?? 'Replay failed';
      showError(`Import failed: ${reason}`);
      return;
    }
    let storageFileId: string;
    if (storageAvailable) {
      try {
        storageFileId = await importTournamentJsonl(
          exportCommandsAsJsonLines(next.getCommandLog()),
          tournamentName,
        );
        await refreshRecentTournaments();
      } catch (e) {
        showError(`Import failed while saving locally: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    } else {
      storageFileId = newTournamentFileId();
    }
    const session = sessionFromController(storageFileId, tournamentName, next);
    activateSession(session);
    logDebugReplayExecuteProfile(tournamentName, replay.executeProfile);
    showInfo(`Imported ${file.name} (${replay.results.length} commands).`);
  }

  function submitScores(match: Match): void {
    clearStatus();
    const rows = scoreDrafts()[match.id];
    if (!rows) {
      showError('Internal: no score draft for this match.');
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
      bm = bracketMatchBySlotId(tournament, match.id.slice('match-'.length));
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
    showInfo(`Saved scores for ${match.id}.`);
    closeScoreModal();
    pull();
  }

  /** DEBUG: random legal BO5, write drafts, then same path as “Save match”. */
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

  function summarizeLastCommand(cmd: Command, t: Tournament): string {
    const pn = (id: string | undefined) => (id && t.players[id]?.name) || id || '—';
    const tn = (id: string | undefined) => (id && t.teams[id]?.name) || id || '—';
    switch (cmd.type) {
      case 'CreatePlayer':
        return `Added player “${cmd.payload.name}”.`;
      case 'RenamePlayer':
        return `Updated player “${pn(cmd.payload.playerId)}”.`;
      case 'SetSeedings':
        return `Set seeding order (${cmd.payload.playerIds.length} players).`;
      case 'SetHandicapConfig': {
        const cfg = cmd.payload.config;
        if (!cfg) return 'Disabled handicap tracking.';
        const crit = cfg.startingCriteria === 'minus_points' ? 'minus points' : 'headstart';
        return `Handicap: numerical ${cfg.minValue}–${cfg.maxValue}, ${crit}, max adjustment ${cfg.maxStartAdjustment}.`;
      }
      case 'EnterScore': {
        const m = t.matches[cmd.payload.matchId];
        return m ? `Entered scores · ${pn(m.playerA)} vs ${pn(m.playerB)}` : 'Entered match scores.';
      }
      case 'ClearMatchScores': {
        const m = t.matches[cmd.payload.matchId];
        return m ? `Cleared scores · ${pn(m.playerA)} vs ${pn(m.playerB)}` : 'Cleared match scores.';
      }
      case 'EnterTeamScore': {
        const tm = t.teamMatches[cmd.payload.matchId];
        return tm ? `Entered team scores · ${tn(tm.teamA)} vs ${tn(tm.teamB)}` : 'Entered team match scores.';
      }
      case 'CreateMatch':
        return `Created match · ${pn(cmd.payload.playerA)} vs ${pn(cmd.payload.playerB)}`;
      case 'CreateTeam':
        return `Created team “${cmd.payload.name}”.`;
      case 'CreateTeamMatch':
        return `Created team match · ${tn(cmd.payload.teamA)} vs ${tn(cmd.payload.teamB)}`;
      case 'GenerateBracket': {
        const mode = cmd.payload.bracketSeedingMode ?? 'heuristic';
        const label =
          mode === 'closed_form' || mode === 'crop_closed_form'
            ? 'closed-form seeding'
            : mode === 'extend_closed_form'
              ? 'extended closed-form seeding'
              : 'heuristic seeding';
        return `Generated bracket (${label}, byes filled).`;
      }
      case 'ClearBracket':
        return 'Removed knockout bracket.';
      case 'EliminateLowestBracketRound':
        return `Eliminated lower-ranked players in round ${cmd.payload.round} (bureaucratic outcome).`;
      case 'GenerateGroupRoundRobin':
        return cmd.payload.classId ? 'Generated round‑robin for a class track.' : 'Generated group round‑robin.';
      case 'SetGroups': {
        if ('groups' in cmd.payload) {
          const n = cmd.payload.groups.length;
          return n === 0 ? 'Cleared groups.' : `Updated groups (${n} group${n === 1 ? '' : 's'}).`;
        }
        return 'Created groups from seeding.';
      }
      case 'SetClassGroups': {
        const cname = t.classDefinitions.find((c) => c.id === cmd.payload.classId)?.name ?? cmd.payload.classId;
        if ('groups' in cmd.payload) {
          const n = cmd.payload.groups.length;
          return n === 0 ? `Cleared groups for “${cname}”.` : `Updated groups for “${cname}”.`;
        }
        return `Created groups for class “${cname}”.`;
      }
      case 'SetTournamentClasses':
        return `Set competition classes (${cmd.payload.classes.length}).`;
      case 'SetPlayerClassFlags':
        return `Updated class flags for ${pn(cmd.payload.playerId)}.`;
      case 'SetRoundLock':
        return cmd.payload.locked
          ? `Locked bracket round ${cmd.payload.bracketRound}.`
          : `Unlocked bracket round ${cmd.payload.bracketRound}.`;
      case 'AssignTables':
        return 'Assigned tables.';
      case 'SetTournamentTables':
        return `Set up ${cmd.payload.tableIds.length} table${cmd.payload.tableIds.length === 1 ? '' : 's'}.`;
      case 'AssignMatchToTable': {
        const m = t.matches[cmd.payload.matchId];
        const table = cmd.payload.tableId;
        return m
          ? `Started on table ${table} · ${pn(m.playerA)} vs ${pn(m.playerB)}`
          : `Assigned match to table ${table}.`;
      }
      case 'ClearMatchTableAssignment': {
        const m = t.matches[cmd.payload.matchId];
        return m ? `Cleared table · ${pn(m.playerA)} vs ${pn(m.playerB)}` : 'Cleared table assignment.';
      }
      case 'AdvanceBracketRound':
        return 'Advanced bracket round.';
      case 'PlayerForfeit':
        return `Player forfeit (${cmd.payload.phase}).`;
      case 'TeamForfeit':
        return `Team forfeit (${cmd.payload.phase}).`;
      case 'Undo':
        return 'Undo.';
    }
  }

  const useClassTabs = $derived(tournamentUsesClassTabs(tournament));

  const overviewTableCount = $derived(tournament.tables.length);

  const activeSess = $derived(getActiveSession());
  const showFormatStub = $derived(Boolean(activeSess && activeSess.tournamentFormat !== 'group-bracket'));

  const lastCommandSummary = $derived.by(() => {
    const s = getActiveSession();
    if (!s) return '';
    const t = tournament;
    const log = s.controller.getCommandLog();
    if (log.length === 0) return 'No actions yet.';
    return summarizeLastCommand(log[log.length - 1]!, t);
  });

  const singleTrackRestTabs = $derived.by((): Array<{ id: InnerTab; label: string }> => {
    const tabs: Array<{ id: InnerTab; label: string }> = [
      { id: 'groups', label: 'Group phase' },
      { id: 'bracket', label: 'Bracket' },
    ];
    if (tournament.bracketMatches.length > 0) {
      tabs.push({ id: 'results', label: 'Results' });
    }
    return tabs;
  });

  const classSubTabsList = $derived.by((): Array<{ id: ClassInnerTab; label: string }> => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'multi' || s.nav.screen === 'players' || s.nav.screen === 'overview') {
      return [];
    }
    const cid = s.nav.screen.classId;
    const rounds = uniqueSortedRounds(classSlice(tournament, cid).bracketMatches);
    const tabs: Array<{ id: ClassInnerTab; label: string }> = [
      { id: 'groups', label: 'Group phase' },
      { id: 'bracket', label: 'Bracket' },
    ];
    if (rounds.length > 0) {
      tabs.push({ id: 'results', label: 'Results' });
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

  pull();

  onMount(() => {
    void refreshRecentTournaments();
  });
</script>

<div class="app" class:app-with-footer={Boolean(activeSess)}>
  <div class="app-sticky-head">
    <header class="top-bar">
      <div class="brand">
        <span class="brand-mark">TTCB</span>
        <span class="brand-text">Tornooiapp</span>
      </div>
      <div class="top-bar-actions">
        <nav class="workspace-tabs" aria-label="Workspace">
          <button
            type="button"
            class="workspace-tab"
            class:active={workspaceTab === 'settings'}
            onclick={() => selectWorkspaceTab('settings')}
          >
            Settings
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
            title="Close tournament"
            aria-label="Close {activeSess.tournamentName}"
            onclick={() => void closeActiveSession()}
          >
            <span aria-hidden="true">×</span>
          </button>
        {/if}
      </div>
    </header>

    {#if status}
      <div
        class="banner status-banner"
        class:status-banner--warn={status.kind === 'warn'}
        class:status-banner--error={status.kind === 'error'}
        role={status.kind === 'error' ? 'alert' : 'status'}
      >
        {status.message}
      </div>
    {/if}
  </div>

  <main class="main" class:main--tournament={workspaceTab !== 'settings'}>
    {#if workspaceTab === 'settings'}
      <section class="card settings-card">
        <h1 class="h1">Tournament Management</h1>

        <div class="settings-grid">
          <div class="settings-block">
            <h2 class="h2">Data</h2>
            <div class="btn-row">
              <label class="file-btn">
                Import tournament
                <input type="file" accept=".jsonl,.txt,application/json,text/plain" class="sr" onchange={onImportFile} />
              </label>
            </div>
            {#if !storageAvailable}
              <p class="muted small">Local auto-save is unavailable in this browser; import still opens the tournament for this session.</p>
            {/if}
          </div>

          <div class="settings-block new-tournament-block">
            <h2 class="h2">New tournament</h2>
            <div class="draft-top-fields">
              <label class="field-block draft-name-field">
                <span class="field-label">Name</span>
                <input
                  class="draft-tournament-name-input"
                  type="text"
                  bind:value={draftTournamentName}
                  maxlength="120"
                  autocomplete="off"
                />
              </label>
              <label class="field-block draft-tables-field">
                <span class="field-label">#Tables</span>
                <input type="number" min="1" max="32" step="1" bind:value={draftTableCount} />
              </label>
            </div>

            <fieldset class="type-fieldset">
              <legend class="field-label">Tournament type</legend>
              <label class="radio-line">
                <input type="radio" name="draft-tournament-format" value="group-bracket" bind:group={draftTournamentFormat} />
                <span>Group phase + brackets</span>
              </label>
              <label class="radio-line radio-line-disabled">
                <input type="radio" name="draft-tournament-format" value="bracket-only" disabled />
                <span>Direct to brackets <span class="muted small">(coming soon)</span></span>
              </label>
              <label class="radio-line radio-line-disabled">
                <input type="radio" name="draft-tournament-format" value="team-vs-team" disabled />
                <span>Team vs team <span class="muted small">(coming soon)</span></span>
              </label>
            </fieldset>

            <label class="checkbox-line">
              <input type="checkbox" bind:checked={draftHandicapEnabled} />
              <span>Include handicap for players</span>
            </label>

            {#if draftHandicapEnabled}
              <fieldset class="type-fieldset handicap-config-fieldset">
                <legend class="field-label">Handicap system</legend>
                <label class="radio-line">
                  <input type="radio" name="draft-handicap-system" value="numerical" checked disabled={false} />
                  <span><strong>Numerical</strong> — player rating from min to max (active)</span>
                </label>
                <label class="radio-line radio-line-disabled">
                  <input type="radio" name="draft-handicap-system" value="classification" disabled />
                  <span
                    ><strong>Classification-based</strong>
                    <span class="muted small">(mock — coming soon)</span></span
                  >
                </label>
                <div class="handicap-config-grid">
                  <label>
                    <span class="field-label">Min rating</span>
                    <input type="number" min="0" step="1" bind:value={draftHandicapMin} />
                  </label>
                  <label>
                    <span class="field-label">Max rating</span>
                    <input type="number" min="0" step="1" bind:value={draftHandicapMax} />
                  </label>
                  <label class="handicap-config-span">
                    <span class="field-label">Starting criteria</span>
                    <select bind:value={draftHandicapStartingCriteria}>
                      <option value="headstart">Headstart for weaker player</option>
                      <option value="minus_points">Minus points for stronger player</option>
                    </select>
                  </label>
                  <label>
                    <span class="field-label">Max start adjustment</span>
                    <input type="number" min="0" step="1" bind:value={draftHandicapMaxStart} title="Maximum absolute headstart or negative start" />
                  </label>
                </div>
              </fieldset>
            {/if}

            <label class="checkbox-line">
              <input type="checkbox" bind:checked={draftClassesEnabled} />
              <span>Use competition classes</span>
            </label>

            {#if draftClassesEnabled}
              <div class="sub-card draft-classes">
                <h3 class="h3">Competition classes</h3>
                <table class="grid class-grid">
                  <thead>
                    <tr>
                      <th>Display name</th>
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
                            aria-label="Class display name"
                            oninput={(e) => updateDraftClassRow(ri, (e.currentTarget as HTMLInputElement).value)}
                          />
                        </td>
                        <td>
                          <button type="button" class="btn ghost small-inline" onclick={() => removeDraftClassRow(ri)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                <div class="btn-row">
                  <button type="button" class="btn" onclick={addDraftClassRow}>Add class row</button>
                </div>
              </div>
            {/if}

            <div class="btn-row">
              <button type="button" class="btn primary" onclick={createTournamentFromWizard}>Create tournament</button>
            </div>
          </div>

          <div class="settings-block">
            <h2 class="h2">Recent activity</h2>
            {#if !storageAvailable}
              <p class="muted small">Recent tournaments require a browser with Origin Private File System support (e.g. Chrome or Edge).</p>
            {:else if recentListLoading && recentTournaments.length === 0}
              <p class="muted">Loading…</p>
            {:else if recentTournaments.length === 0}
              <p class="muted">No saved tournaments yet. Create or import one — it will appear here after the first change.</p>
            {:else}
              <ul class="recent-list">
                {#each recentTournaments as entry (entry.fileId)}
                  <li class="recent-entry-row">
                    <button
                      type="button"
                      class="recent-entry-btn"
                      disabled={tournamentLoad !== null}
                      onclick={() => openStoredTournament(entry.fileId)}
                    >
                      <span class="recent-entry-name">{entry.tournamentName}</span>
                      <span class="recent-entry-date muted small">{formatRecentDate(entry.lastModified)}</span>
                    </button>
                    <button
                      type="button"
                      class="recent-delete-btn"
                      title="Delete saved tournament"
                      aria-label="Delete {entry.tournamentName}"
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
            Only <strong>Group phase + brackets</strong> is fully implemented. You are viewing a placeholder for the selected
            tournament type.
          </div>
        {/if}
        <div class="tournament-toolbar">
          <div class="title-block">
            <label class="title-label" for="tm-name-input">Tournament name</label>
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
                title="Download command log (.jsonl)"
                onclick={downloadJsonl}
              >
                Export Tournament File
              </button>
              <button
                type="button"
                class="btn ghost title-export-btn"
                title="Download groups, bracket, and results summary (.pdf)"
                onclick={exportTournamentPdf}
              >
                Export Tournament PDF
              </button>
            </div>
          </div>
        </div>

        <nav class="inner-tabs" aria-label="Tournament sections">
          <button
            type="button"
            class="inner-tab"
            class:active={showOverviewPanel}
            onclick={selectOverviewNav}
          >
            Overview
          </button>
          <button
            type="button"
            class="inner-tab"
            class:active={showPlayersPanel}
            onclick={selectPlayersNav}
          >
            Players
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
          {:else}
            {#each singleTrackRestTabs as tab (tab.id)}
              <button
                type="button"
                class="inner-tab"
                class:active={singleTrackInner === tab.id}
                onclick={() => selectSingleTrackTab(tab.id)}
              >
                {tab.label}
              </button>
            {/each}
          {/if}
        </nav>

        {#if useClassTabs && multiClassScreen}
          <nav class="inner-tabs inner-tabs-sub" aria-label="Class track sections">
            {#each classSubTabsList as tab (tab.id)}
              <button
                type="button"
                class="inner-tab"
                class:active={multiClassScreen.inner === tab.id}
                onclick={() => selectClassSubTab(multiClassScreen.classId, tab.id)}
              >
                {tab.label}
              </button>
            {/each}
          </nav>
        {/if}

        <div class="inner-panels">
          {#if showOverviewPanel}
            <section class="card">
              <h2 class="h2">Overview</h2>
              <TournamentOverview
                {tournament}
                useClassTabs={useClassTabs}
                groupDisplayLabel={groupDisplayLabel}
                tableCount={overviewTableCount}
                onIncrementTables={incrementOverviewTableCount}
                onDecrementTables={decrementOverviewTableCount}
                onOpenGroupMatch={openScoreModal}
                onOpenBracketSlot={openBracketPairingModal}
                onOpenTableMatch={openTableMatch}
                onAssignMatchToTable={overviewAssignMatchToTable}
                onClearMatchFromTable={overviewClearMatchFromTable}
              />
            </section>
          {:else if showPlayersPanel}
            <section class="card">
              <h2 class="h2">Players</h2>

              <form
                class="row"
                onsubmit={(e) => {
                  e.preventDefault();
                  addPlayer();
                }}
              >
                <input class="grow" placeholder="Name" bind:value={newName} autocomplete="off" />
                {#if handicapEnabled}
                  <label class="hc-add-wrap" for="new-player-hc">
                    <span class="hc-label">Handicap</span>
                    <input
                      id="new-player-hc"
                      class="hc"
                      type="number"
                      bind:value={newHc}
                      min={handicapBounds.min}
                      max={handicapBounds.max}
                      step="1"
                      title="Handicap ({handicapBounds.min}–{handicapBounds.max})"
                    />
                  </label>
                {/if}
                <button type="submit" class="btn primary">Add player</button>
              </form>
              {#if DEBUG_UI}
                <div class="row align-end gap-sm debug-fill-row">
                  <label class="row align-center gap-sm">
                    <span class="muted small"># to add</span>
                    <input
                      class="debug-fill-count"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      aria-label="Number of players to add (debug)"
                      bind:value={debugFillPlayerCount}
                    />
                  </label>
                  <button type="button" class="btn subtle" onclick={debugFillPlayers}>[DEBUG] Fill players</button>
                </div>
              {/if}
              <ol class="seed-list">
                {#each activeSess.playerOrder as pid (pid)}
                  <li class="player-row">
                    <div class="player-main">
                      <span class="name">{playerLabel(pid)}</span>
                      {#if handicapEnabled}
                        <span class="hc-wrap">
                          <label class="hc-label" for={`hc-${pid}`}>Handicap</label>
                          <input
                            id={`hc-${pid}`}
                            class="hc-inline"
                            type="number"
                            min={handicapBounds.min}
                            max={handicapBounds.max}
                            step="1"
                            aria-label={`Handicap for ${playerLabel(pid)}`}
                            bind:value={handicapDrafts[pid]}
                            onfocus={() => {
                              handicapFocusPid = pid;
                            }}
                            onblur={() => {
                              commitPlayerHandicap(pid);
                              handicapFocusPid = null;
                            }}
                          />
                        </span>
                      {/if}
                      <code class="pid">{pid}</code>
                    </div>
                    {#if tournament.classDefinitions.length > 0}
                      <div class="player-classes">
                        {#each tournament.classDefinitions as def (def.id)}
                          <label class="chk tight">
                            <input
                              type="checkbox"
                              checked={tournament.playerClassFlags[pid]?.[def.id] ?? false}
                              onchange={(e) =>
                                togglePlayerClass(pid, def.id, (e.currentTarget as HTMLInputElement).checked)}
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
              <h2 class="h2">Group phase</h2>
              {#if tournament.bracketMatches.length > 0}
                <p class="group-lock-banner">
                  Knockout bracket is active — group lineup is locked here. You can still finish unfinished
                  round‑robin matches from the matrix above.
                </p>
              {/if}
              {#if Object.keys(tournament.groups).length === 0}
                <p class="muted small">
                  {#if globalGroupPlayerCount === 0}
                    Add players on the Players tab first.
                  {:else}
                    All {globalGroupPlayerCount} seeded players are included, in seeding order.
                  {/if}
                </p>
                <div class="group-create-row">
                  <input
                    class="group-create-num"
                    type="number"
                    min="1"
                    step="1"
                    disabled={tournament.bracketMatches.length > 0}
                    value={activeSess?.groupTargetSize ?? CLOSED_FORM_PLAYERS_PER_GROUP}
                    aria-label="Target players per group"
                    oninput={(e) => {
                      const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                      patchActiveSession({ groupTargetSize: v });
                    }}
                  />
                  <button
                    type="button"
                    class="btn primary"
                    disabled={tournament.bracketMatches.length > 0 || globalGroupPlayerCount === 0}
                    onclick={createGlobalGroupsByPlayerCount}
                  >
                    Create by player count
                  </button>
                  <div class="group-create-gap" aria-hidden="true"></div>
                  <input
                    class="group-create-num"
                    type="number"
                    min="1"
                    step="1"
                    disabled={tournament.bracketMatches.length > 0}
                    value={activeSess?.groupTargetCount ?? suggestedGlobalGroupTargetCount}
                    aria-label="Target number of groups"
                    oninput={(e) => {
                      const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                      patchActiveSession({ groupTargetCount: v });
                    }}
                  />
                  <button
                    type="button"
                    class="btn primary"
                    disabled={tournament.bracketMatches.length > 0 || globalGroupPlayerCount === 0}
                    onclick={createGlobalGroupsByGroupCount}
                  >
                    Create by group count
                  </button>
                  <div class="group-create-spacer" aria-hidden="true"></div>
                </div>
              {:else}
                <div class="row align-end">
                  <button
                    type="button"
                    class="btn danger-ghost"
                    disabled={tournament.bracketMatches.length > 0}
                    onclick={clearGlobalGroups}
                  >
                    Clear groups
                  </button>
                </div>
                {#if DEBUG_UI}
                  <div class="row align-end">
                    <button type="button" class="btn subtle" onclick={() => debugSimulateGroupMatches(undefined)}>
                      [DEBUG] Simulate matches
                    </button>
                  </div>
                {/if}
                <h3 class="h3">Groups</h3>
                {#each sortGroupsForDisplay(tournament.groups) as g (g.id)}
                  {@const matrixPids = groupMatrixPlayerOrder(g)}
                  {@const standingsWl = groupStandingsWlByPid(tournament, g, undefined)}
                  <article class="sub-card">
                    <h4 class="h4">{groupDisplayLabel(g)}</h4>
                    <div class="group-matrix-wrap">
                      <table class="grid compact group-matrix-table">
                        <thead>
                          <tr>
                            <th>Player</th>
                            {#each matrixPids as colPid (colPid)}
                              <th class="h2h-th" title={playerLabel(colPid)}>
                                <span class="h2h-th-inner"><PlayerName {tournament} playerId={colPid} /></span>
                              </th>
                            {/each}
                            <th>W</th>
                            <th>L</th>
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
                                      <span class="muted" title="No match">—</span>
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
                {/each}
              {/if}

            </section>
          {:else if !useClassTabs && singleTrackInner === 'bracket'}
            <section class="card">
              <h2 class="h2">Bracket</h2>
              {#if tournament.bracketMatches.length === 0}
                <fieldset class="bracket-seed-fieldset">
                  <legend class="muted small">Bracket seeding</legend>
                  <label class="radio-line">
                    <input type="radio" bind:group={bracketSeedingChoice} value="crop_closed_form" disabled={!canPickClosedFormSeeding} />
                    <span>
                      <strong>Closed-form</strong>
                      — built-in 2×4 / 4×4 / 8×4 / 16×4 layout when you have 2, 4, 8, or 16 groups (≥4 players each).
                      {#if closedFormSeedingKind === 'culled'}
                        Top four per group use the closed layout; 5th place and lower join via an extra preliminary round (selected by default).
                      {:else if closedFormSeedingKind === 'exact'}
                        Exact G×4 grid (every group has four players).
                      {/if}
                    </span>
                  </label>
                  <label class="radio-line">
                    <input type="radio" bind:group={bracketSeedingChoice} value="extend_closed_form" disabled={!canPickExtendClosedFormSeeding} />
                    <span>
                      <strong>Extend to next closed form</strong>
                      — pad to the smallest supported virtual grid, then apply the same closed layout (BYE slots).
                    </span>
                  </label>
                  <label class="radio-line">
                    <input type="radio" bind:group={bracketSeedingChoice} value="heuristic" />
                    <span>
                      <strong>Heuristic</strong>
                      — rule-based placement from group standings.
                    </span>
                  </label>
                </fieldset>
                <div class="row align-end bracket-create-row">
                  <button
                    type="button"
                    class="btn primary"
                    disabled={Object.keys(tournament.groups).length === 0 ||
                      eligibleGlobalGroupPlayerIds(tournament).length === 0}
                    onclick={() => generateKnockoutBracket()}
                  >
                    Create knockout bracket
                  </button>
                </div>
                {#if Object.keys(tournament.groups).length === 0}
                  <p class="muted small">Finish the group phase first — the create button enables after groups exist.</p>
                {/if}
              {/if}

              {#if tournament.bracketMatches.length > 0}
                <div class="row align-end bracket-remove-row" style="margin-bottom: 0.75rem;">
                  <button type="button" class="btn danger-ghost" onclick={removeKnockoutBracket}>
                    Remove bracket
                  </button>
                </div>
                <h3 class="h3">Knockout bracket</h3>
                <BracketStreamView
                  cols={previewBracketColumns(
                    tournament,
                    tournament.seedings,
                    activeSess.tournamentName,
                    tournament.bracketMatches,
                  )}
                  mainDrawSlotCount={inferBracketSlotCountFromRoundOne(tournament.bracketMatches)}
                  {tournament}
                  slotTitle={bracketSlotTitle}
                  onPairingClick={openBracketPairingModal}
                  ariaLabel="Knockout bracket"
                />
                {#if DEBUG_UI}
                  {@const debugElimRounds = uniqueSortedRounds(tournament.bracketMatches).filter((elimRound) =>
                    bracketRoundHasOpenEliminationPairings(tournament, tournament.bracketMatches, elimRound),
                  )}
                  {#if debugElimRounds.length > 0}
                    <div class="row align-end bracket-elim-row" style="flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem;">
                      <span class="muted small">Bureaucratic elimination (distinct from forfeit):</span>
                      {#each debugElimRounds as elimRound (elimRound)}
                        <button
                          type="button"
                          class="btn subtle"
                          disabled={useClassTabs || (tournament.lockedBracketRounds ?? []).includes(elimRound)}
                          title={useClassTabs
                            ? 'Use per-class controls when multiple classes are defined.'
                            : (tournament.lockedBracketRounds ?? []).includes(elimRound)
                              ? 'This round is locked.'
                              : `In round ${elimRound}, eliminate the worse group finisher in each open pairing (ties favour larger groups, then a random pick).`}
                          onclick={() => eliminateBracketRoundByRanking(elimRound)}
                        >
                          Eliminate lowest in round {elimRound}
                        </button>
                      {/each}
                    </div>
                  {/if}
                {:else}
                  <div class="row align-end bracket-elim-row" style="flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem;">
                    <span class="muted small">Bureaucratic elimination (distinct from forfeit):</span>
                    {#each uniqueSortedRounds(tournament.bracketMatches) as elimRound (elimRound)}
                      <button
                        type="button"
                        class="btn subtle"
                        disabled={useClassTabs || (tournament.lockedBracketRounds ?? []).includes(elimRound)}
                        title={useClassTabs
                          ? 'Use per-class controls when multiple classes are defined.'
                          : (tournament.lockedBracketRounds ?? []).includes(elimRound)
                            ? 'This round is locked.'
                            : `In round ${elimRound}, eliminate the worse group finisher in each open pairing (ties favour larger groups, then a random pick).`}
                        onclick={() => eliminateBracketRoundByRanking(elimRound)}
                      >
                        Eliminate lowest in round {elimRound}
                      </button>
                    {/each}
                  </div>
                {/if}
                {#if DEBUG_UI}
                  <div class="row align-end">
                    <button
                      type="button"
                      class="btn subtle"
                      disabled={anyUnfinishedGroupPhaseMatch(tournament)}
                      title={anyUnfinishedGroupPhaseMatch(tournament)
                        ? 'Complete every group‑phase match first.'
                        : 'Fill scheduled knockout matches with random legal scores.'}
                      onclick={debugSimulateBracketPhaseMatches}
                    >
                      [DEBUG] Simulate phase matches
                    </button>
                  </div>
                {/if}
                <p class="muted small">
                  Click a pairing in the bracket to view scores or enter games. You can change or clear a result only
                  while the winner’s next bracket match has not been played yet.
                </p>
              {:else}
                <p class="muted small">The bracket appears here after you create it with one of the buttons above.</p>
              {/if}
            </section>
          {:else if !useClassTabs && singleTrackInner === 'results'}
            <section class="card">
              <h2 class="h2">Results</h2>
              {#if tournament.bracketMatches.length > 0}
                {@const placementRows = singleEliminationPlacementRows(tournament.bracketMatches, tournament)}
                {#if placementRows}
                  <ol class="plain-list placement-ol">
                    {#each placementRows as row (row.playerId)}
                      <li>
                        <span class="placement-num">{row.place}.</span>
                        <PlayerName {tournament} playerId={row.playerId} />
                      </li>
                    {/each}
                  </ol>
                {:else}
                  <p class="muted small">Complete the final match to list finishing order.</p>
                {/if}
              {:else}
                <p class="muted small">Generate a knockout bracket to show finishing order here.</p>
              {/if}
            </section>
          {:else if useClassTabs && multiClassScreen}
            {@const cid = multiClassScreen.classId}
            {@const def = tournament.classDefinitions.find((x) => x.id === cid)}
            {@const slice = classSlice(tournament, cid)}
            {@const cin = multiClassScreen.inner}
            {#if cin === 'groups'}
              <section class="card">
                <h2 class="h2">Group phase · {def?.name ?? cid}</h2>
                {#if slice.bracketMatches.length > 0}
                  <p class="group-lock-banner">
                    Knockout bracket is active for this class — group lineup is locked here. You can still finish
                    unfinished round‑robin matches from the matrix above.
                  </p>
                {/if}
                {#if Object.keys(slice.groups).length === 0}
                  {@const classGroupPlayerCount = slice.seedings.length}
                  <p class="muted small">
                    Players listed here are in this class (from the Players tab). Targets use closed-form bracket sizes
                    (4 players per group; 2, 4, or 8 groups). Creating groups also creates all round‑robin matches for this
                    class.
                  </p>
                  <p class="muted small">
                    {#if classGroupPlayerCount === 0}
                      No players in this class yet — enable the class checkbox for players on the Players tab.
                    {:else}
                      All {classGroupPlayerCount} players in this class are included, in class seeding order.
                    {/if}
                  </p>
                  <div class="group-create-row">
                    <input
                      class="group-create-num"
                      type="number"
                      min="1"
                      step="1"
                      disabled={slice.bracketMatches.length > 0}
                      value={classGroupTargetSize(cid)}
                      aria-label="Target players per group for class"
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
                      disabled={slice.bracketMatches.length > 0 || classGroupPlayerCount === 0}
                      onclick={() => createClassGroupsByPlayerCount(cid)}
                    >
                      Create by player count
                    </button>
                    <div class="group-create-gap" aria-hidden="true"></div>
                    <input
                      class="group-create-num"
                      type="number"
                      min="1"
                      step="1"
                      disabled={slice.bracketMatches.length > 0}
                      value={classGroupTargetCount(cid)}
                      aria-label="Target number of groups for class"
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
                      disabled={slice.bracketMatches.length > 0 || classGroupPlayerCount === 0}
                      onclick={() => createClassGroupsByGroupCount(cid)}
                    >
                      Create by group count
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
                      Clear groups
                    </button>
                  </div>
                  {#if DEBUG_UI}
                    <div class="row align-end">
                      <button type="button" class="btn subtle" onclick={() => debugSimulateGroupMatches(cid)}>
                        [DEBUG] Simulate matches
                      </button>
                    </div>
                  {/if}
                  <h3 class="h3">Groups</h3>
                  {#each sortGroupsForDisplay(slice.groups) as g (g.id)}
                    {@const matrixPids = groupMatrixPlayerOrder(g)}
                    {@const standingsWl = groupStandingsWlByPid(tournament, g, cid)}
                    <article class="sub-card">
                      <h4 class="h4">{groupDisplayLabel(g)}</h4>
                      <div class="group-matrix-wrap">
                        <table class="grid compact group-matrix-table">
                          <thead>
                            <tr>
                              <th>Player</th>
                              {#each matrixPids as colPid (colPid)}
                                <th class="h2h-th" title={playerLabel(colPid)}>
                                  <span class="h2h-th-inner"><PlayerName {tournament} playerId={colPid} classId={cid} /></span>
                                </th>
                              {/each}
                              <th>W</th>
                              <th>L</th>
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
                                        <span class="muted" title="No match">—</span>
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
                  {/each}
                {/if}

              </section>
            {:else if cin === 'bracket'}
              <section class="card">
                <h2 class="h2">Bracket · {def?.name ?? cid}</h2>
                <p class="muted small">
                  Per-class knockout generation from the app is not wired yet. The draw will appear here after you create a
                  bracket for this class.
                </p>
                <div class="row align-end bracket-create-row">
                  <button type="button" class="btn primary" disabled>Per-class bracket generation (coming soon)</button>
                </div>

                {#if slice.bracketMatches.length > 0}
                  <h3 class="h3">Knockout bracket</h3>
                  <p class="muted small">
                    Same centered layout as the global bracket. Player names appear once their group is fully played; until
                    then slots show <span class="mono">group … place …</span> from current standings order.
                    <span class="mono">--empty--</span> is a bye; “—” is a structural placeholder.
                  </p>
                  <BracketStreamView
                    cols={displayBracketColumns(slice.bracketMatches)}
                    mainDrawSlotCount={inferBracketSlotCountFromRoundOne(slice.bracketMatches)}
                    {tournament}
                    slotTitle={bracketSlotTitle}
                    bracketClassId={cid}
                    onPairingClick={openBracketPairingModal}
                    ariaLabel="Class knockout bracket"
                    emptyMessage="No class entrants — enable this class for players on the Players tab."
                  />
                  {#if DEBUG_UI}
                    <div class="row align-end">
                      <button
                        type="button"
                        class="btn subtle"
                        disabled={anyUnfinishedGroupPhaseMatch(tournament)}
                        title={anyUnfinishedGroupPhaseMatch(tournament)
                          ? 'Complete every group‑phase match first.'
                          : 'Fill scheduled knockout matches with random legal scores.'}
                        onclick={debugSimulateBracketPhaseMatches}
                      >
                        [DEBUG] Simulate phase matches
                      </button>
                    </div>
                  {/if}
                  <p class="muted small">
                    Click a pairing in the bracket to view scores or enter games. You can change or clear a result only
                    while the winner’s next bracket match has not been played yet.
                  </p>
                {:else}
                  <p class="muted small">The bracket appears here after a knockout bracket exists for this class.</p>
                {/if}
              </section>
            {:else if cin === 'results'}
              <section class="card">
                <h2 class="h2">Results · {def?.name ?? cid}</h2>
                {#if slice.bracketMatches.length > 0}
                  {@const classPlacementRows = singleEliminationPlacementRows(slice.bracketMatches, tournament)}
                  {#if classPlacementRows}
                    <ol class="plain-list placement-ol">
                      {#each classPlacementRows as row (row.playerId)}
                        <li>
                          <span class="placement-num">{row.place}.</span>
                          <PlayerName {tournament} playerId={row.playerId} />
                        </li>
                      {/each}
                    </ol>
                  {:else}
                    <p class="muted small">Complete the final match to list finishing order.</p>
                  {/if}
                {:else}
                  <p class="muted small">No knockout bracket for this class yet.</p>
                {/if}
              </section>
            {/if}
          {/if}
        </div>
      </div>
      {:else}
      <section class="card empty-tournament-card">
        <h2 class="h2">No tournament in this tab</h2>
        <p class="muted">
          Go to <button type="button" class="linkish" onclick={() => selectWorkspaceTab('settings')}>Settings</button> to
          create a tournament or import JSONL.
        </p>
      </section>
      {/if}
    {/if}
  </main>

  {#if activeSess}
    <footer class="tournament-footer app-dock-footer" aria-label="Tournament activity">
      <p class="footer-last muted">{lastCommandSummary}</p>
      <div class="footer-actions">
        <button type="button" class="btn ghost" onclick={doUndo} title="Append Undo for latest undoable step">Undo</button>
        <button
          type="button"
          class="btn ghost"
          onclick={doRedo}
          disabled={!activeSess.controller.canRedo()}
          title="Drop last Undo from log"
        >
          Redo
        </button>
      </div>
    </footer>
  {/if}

  {#if tournamentLoad}
    <div class="load-overlay" role="dialog" aria-modal="true" aria-labelledby="tournament-load-title">
      <div class="load-panel">
        <h3 id="tournament-load-title" class="load-title">Loading “{tournamentLoad.label}”</h3>
        {#if tournamentLoad.phase === 'replay' && tournamentLoad.total > 0}
          <p class="load-meta muted small">
            Replaying commands — {tournamentLoad.done} / {tournamentLoad.total}
          </p>
          <div
            class="load-track"
            role="progressbar"
            aria-valuenow={tournamentLoad.done}
            aria-valuemin="0"
            aria-valuemax={tournamentLoad.total}
            aria-label={`${tournamentLoad.done} of ${tournamentLoad.total} commands replayed`}
          >
            <div
              class="load-fill"
              style={`width: ${tournamentLoadPct(tournamentLoad.done, tournamentLoad.total)}%`}
            ></div>
          </div>
        {:else}
          <p class="load-meta muted small">Reading tournament file…</p>
          <div class="load-track load-track-indeterminate" role="progressbar" aria-busy="true" aria-label="Reading tournament file">
            <div class="load-fill-indeterminate"></div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if deleteTournamentTarget}
    {@const deleteTarget = deleteTournamentTarget}
    <div class="modal-root">
      <button
        type="button"
        class="modal-scrim"
        aria-label="Close delete dialog"
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
          <h3 id="delete-tournament-title" class="modal-title">Delete tournament?</h3>
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
          This permanently removes the saved copy of <strong>{deleteTarget.tournamentName}</strong> from this
          browser (local tournament files). Export a tournament file first if you need a backup.
        </p>
        <label class="field-label" for="delete-confirm-input">Type <strong>I understand</strong> to confirm</label>
        <input
          id="delete-confirm-input"
          type="text"
          class="grow delete-confirm-input"
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
            disabled={!deleteConfirmOk || deleteTournamentBusy}
            onclick={() => confirmDeleteTournament()}
          >
            {deleteTournamentBusy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if scoreModalMatchId}
    {@const sm = tournament.matches[scoreModalMatchId]}
    {#if sm}
      {@const modalRows = scoreDrafts()[scoreModalMatchId] ?? defaultRows(MIN_GAME_ROWS)}
      <div class="modal-root">
        <button
          type="button"
          class="modal-scrim"
          aria-label="Close score dialog"
          onclick={() => cancelScoreModal()}
        ></button>
        <div
          class="modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-modal-title"
          tabindex="-1"
        >
          <header class="modal-head">
            <h3 id="score-modal-title" class="modal-title">
              Games · {playerLabel(sm.playerA)} vs {playerLabel(sm.playerB)}
            </h3>
            <button type="button" class="btn subtle small-inline" onclick={() => cancelScoreModal()}>Close</button>
          </header>
          <p class="muted small modal-lead">
            Best of five (first to three games). Each game is won at 11+ with a two-point margin; once either player is
            past 11, the winning margin must be exactly two. Extra rows appear automatically when the match is not decided
            after three or four valid games (up to five games).
          </p>
          {#if !scoreModalCanEditGames() && (sm.status === 'finished' || sm.scores.length > 0)}
            <p class="muted small modal-lead">
              {#if sm.groupId}
                This group result cannot be edited: a knockout match in this track already has recorded play.
              {:else}
                This result cannot be edited: the winner’s next bracket match already has scores (or this round is locked).
              {/if}
            </p>
          {/if}
          {#if scoreModalAssignedTableId()}
            <p class="score-modal-table-readout muted small">
              <span class="field-label">Playing on table</span> Table {scoreModalAssignedTableId()}
            </p>
          {/if}
          <table class="mini score-modal-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{playerLabel(sm.playerA)}</th>
                <th>{playerLabel(sm.playerB)}</th>
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
            <button type="button" class="btn" onclick={() => cancelScoreModal()}>Cancel</button>
            {#if DEBUG_UI}
              <button
                type="button"
                class="btn subtle"
                disabled={!scoreModalCanEditGames()}
                onclick={() => debugSimulateOpenScoreModalMatch()}
              >
                [DEBUG] Simulate match
              </button>
            {/if}
            {#if scoreModalCanClearResult()}
              <button type="button" class="btn danger-ghost" onclick={() => clearScoreModalBracketResult()}>
                Clear result
              </button>
            {/if}
            <button
              type="button"
              class="btn primary"
              disabled={!scoreModalCanEditGames()}
              onclick={() => submitScores(sm)}
            >
              Save match
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
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

  .hc-inline {
    width: 3.75rem;
    font: inherit;
    padding: 0.25rem 0.35rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    text-align: center;
  }

  .hc-inline:focus {
    outline: none;
    border-color: #16a34a;
    box-shadow: 0 0 0 2px rgb(22 163 74 / 12%);
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
    height: 0.55rem;
    border-radius: 999px;
    background: #e2e8f0;
    overflow: hidden;
  }

  .load-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    transition: width 0.12s ease-out;
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
