<script lang="ts">
  import type {
    BracketMatch,
    ClassTournamentSlice,
    Command,
    GameScore,
    GroupDefinition,
    Match,
    Tournament,
  } from 'ttc-tornooiapp';
  import {
    TournamentController,
    createTournament,
    exportCommandsAsJsonLines,
    tournamentControllerFromCommandLog,
    findBracketRoundForPlayerPairing,
    tournamentUsesClassTabs,
    isGameScoreLegal,
    isMatchScoreLegal,
    matchWinner,
  } from 'ttc-tornooiapp';

  function newCompetitionClassId(): string {
    return `cid-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }

  /** Sub-views for the active tournament (bracket rounds are dynamic). */
  type InnerTab = 'players' | 'groups' | 'bracket-setup' | `bracket:${number}` | 'results';
  type ClassInnerTab = Exclude<InnerTab, 'players'>;

  type SessionNav =
    | { kind: 'single'; inner: InnerTab }
    | { kind: 'multi'; screen: 'players' | { classId: string; inner: ClassInnerTab } };

  type TournamentFormat = 'group-bracket' | 'bracket-only' | 'team-vs-team';

  interface TournamentSession {
    id: string;
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
    /** Latest `SetGroups` command id (optional extra deps for follow-up commands). */
    lastSetGroupsCommandId: string;
    /** Per-class target group size. */
    classGroupTargetSizeByClassId: Record<string, number>;
    /** Latest `SetClassGroups` command id per class. */
    lastSetClassGroupsCommandIdByClass: Record<string, string>;
    /** When false, new players use handicap 0 and handicap controls are hidden. */
    handicapEnabled: boolean;
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
  let status = $state<string | null>(null);
  /** Export/import activity lines for the Settings “Recent activity” list. */
  let recentTournamentNotes = $state<string[]>([]);

  let newName = $state('');
  let newHc = $state(0);
  let fillByes = $state(true);

  /** New tournament wizard (Settings). */
  let draftTournamentName = $state('Tournament');
  let draftHandicapEnabled = $state(false);
  let draftTournamentFormat = $state<TournamentFormat>('group-bracket');
  let draftClassSectionOpen = $state(false);
  let draftClassEditorRows = $state<Array<{ id: string; name: string }>>([
    { id: newCompetitionClassId(), name: '' },
  ]);

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

  function defaultRows(n: number): ScoreRow[] {
    return Array.from({ length: n }, () => ({ a: '', b: '' }));
  }

  function getActiveSession(): TournamentSession | undefined {
    return sessions.find((s) => s.id === activeSessionId);
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

  function setScoreModalCell(mid: string, rowIndex: number, col: 'a' | 'b', raw: string): void {
    const cur = [...(scoreDrafts()[mid] ?? defaultRows(MIN_GAME_ROWS))];
    if (!cur[rowIndex]) return;
    cur[rowIndex] = { ...cur[rowIndex], [col]: raw };
    const normalized = normalizeScoreRows(cur);
    setScoreDrafts({ ...scoreDrafts(), [mid]: normalized });
    scoreModalHint = null;
  }

  function openScoreModal(match: Match): void {
    if (match.status !== 'scheduled') return;
    scoreModalHint = null;
    scoreModalMatchId = match.id;
    const existing: ScoreRow[] =
      match.scores.length > 0
        ? match.scores.map((s) => ({ a: String(s.playerA), b: String(s.playerB) }))
        : defaultRows(MIN_GAME_ROWS);
    setScoreDrafts({ ...scoreDrafts(), [match.id]: normalizeScoreRows(existing) });
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
    return g.label?.trim() || g.id;
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

  function groupLabelForMatch(t: Tournament, match: Match): string {
    const g = match.classId
      ? t.classTournaments[match.classId]?.groups?.[match.groupId ?? '']
      : t.groups[match.groupId ?? ''];
    return g ? groupDisplayLabel(g) : match.groupId ?? '';
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
    if (!s) return 4;
    const v = s.classGroupTargetSizeByClassId[classId];
    return typeof v === 'number' && v >= 1 ? v : 4;
  }

  function setClassGroupTargetSize(classId: string, size: number): void {
    const s = getActiveSession();
    if (!s) return;
    patchActiveSession({
      classGroupTargetSizeByClassId: { ...s.classGroupTargetSizeByClassId, [classId]: Math.max(1, Math.floor(size)) },
    });
  }

  function createGlobalGroupsAndMatches(): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      status = 'With multiple competition classes, use each class tab for groups.';
      return;
    }
    const ordered = eligibleGlobalGroupPlayerIds(t);
    if (ordered.length === 0) {
      status = 'Add at least one player (and seedings) before creating groups.';
      return;
    }
    const targetSize = Math.max(1, Math.floor(Number(s.groupTargetSize) || 4));
    const deps: string[] = [...new Set(ordered)].map((id) => `cmd-${id}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setgroups-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setGroups({ targetGroupSize: targetSize, playerIds: ordered }, deps, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not create groups';
      pull();
      return;
    }
    patchActiveSession({ lastSetGroupsCommandId: cmdId });
    status = 'Created groups and all round‑robin matches.';
    pull();
  }

  function clearGlobalGroups(): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      status = 'Use class tabs to clear class groups.';
      return;
    }
    const deps: string[] = [];
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setgroups-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setGroups([], deps, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not clear groups';
      pull();
      return;
    }
    patchActiveSession({ lastSetGroupsCommandId: cmdId });
    status = 'Cleared groups and group matches.';
    pull();
  }

  function createClassGroupsAndMatches(classId: string): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (!tournamentUsesClassTabs(t)) {
      status = 'Class groups require two or more competition classes.';
      return;
    }
    const slice = classSlice(t, classId);
    const ordered = [...slice.seedings];
    if (ordered.length === 0) {
      status = 'No players in this class yet — enable the class for players on the Players tab.';
      return;
    }
    const targetSize = classGroupTargetSize(classId);
    const deps: string[] = [...new Set(ordered)].map((id) => `cmd-${id}`);
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setcg-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.setClassGroups(classId, { targetGroupSize: targetSize, playerIds: ordered }, deps, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not create class groups';
      pull();
      return;
    }
    patchActiveSession({
      lastSetClassGroupsCommandIdByClass: { ...s.lastSetClassGroupsCommandIdByClass, [classId]: cmdId },
    });
    status = 'Created groups and round‑robin matches for this class.';
    pull();
  }

  function clearClassGroups(classId: string): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    if (!tournamentUsesClassTabs(c.getTournament())) return;
    const deps: string[] = [];
    if (s.lastSeedingCommandId) deps.push(s.lastSeedingCommandId);
    const cmdId = `cmd-setcg-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.setClassGroups(classId, [], deps, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not clear class groups';
      pull();
      return;
    }
    patchActiveSession({
      lastSetClassGroupsCommandIdByClass: { ...s.lastSetClassGroupsCommandIdByClass, [classId]: cmdId },
    });
    status = 'Cleared groups for this class.';
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
    status = `Title set to: ${suggested}`;
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
    const set = new Set(matches.map((m) => m.round));
    return [...set].sort((a, b) => a - b);
  }

  function matchesForBracketRound(t: Tournament, round: number): Match[] {
    return Object.values(t.matches).filter(
      (m) => findBracketRoundForPlayerPairing(t, m.playerA, m.playerB) === round,
    );
  }

  function bracketMatchesForRound(matches: BracketMatch[], round: number): BracketMatch[] {
    return matches.filter((m) => m.round === round).sort((a, b) => a.id.localeCompare(b.id));
  }

  function normalizeInnerTab(t: Tournament, current: InnerTab): InnerTab {
    const rounds = uniqueSortedRounds(t.bracketMatches);
    return normalizeBracketSubTab(rounds, current);
  }

  function normalizeBracketSubTab(rounds: number[], current: InnerTab | ClassInnerTab): InnerTab | ClassInnerTab {
    if (rounds.length === 0) {
      if (current.startsWith('bracket:') && current !== 'bracket-setup') {
        return 'bracket-setup';
      }
      return current;
    }
    if (current === 'bracket-setup') {
      return `bracket:${rounds[0]}`;
    }
    if (current.startsWith('bracket:')) {
      const n = Number(current.slice('bracket:'.length));
      if (!rounds.includes(n)) {
        return `bracket:${rounds[0]}`;
      }
    }
    return current;
  }

  function normalizeSessionNav(t: Tournament, nav: SessionNav): SessionNav {
    const multi = tournamentUsesClassTabs(t);
    if (!multi) {
      if (nav.kind === 'multi') {
        if (nav.screen === 'players') return { kind: 'single', inner: 'players' };
        return { kind: 'single', inner: nav.screen.inner };
      }
      return { kind: 'single', inner: normalizeInnerTab(t, nav.inner) };
    }
    if (nav.kind === 'single') {
      if (nav.inner === 'players') {
        return { kind: 'multi', screen: 'players' };
      }
      const first = t.classDefinitions[0];
      if (!first) {
        return { kind: 'multi', screen: 'players' };
      }
      const inner = normalizeBracketSubTab(
        uniqueSortedRounds(t.classTournaments[first.id]?.bracketMatches ?? []),
        nav.inner as ClassInnerTab,
      ) as ClassInnerTab;
      return { kind: 'multi', screen: { classId: first.id, inner } };
    }
    if (nav.screen === 'players') {
      return nav;
    }
    const { classId, inner } = nav.screen;
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
    const s = getActiveSession();
    if (!s) {
      tournament = createTournament();
      return;
    }
    const t = structuredClone(s.controller.getTournament());
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
  }

  function newId(): string {
    return `p-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
  }

  function selectWorkspaceTab(tab: string): void {
    workspaceTab = tab;
    if (tab !== 'settings' && sessions.some((s) => s.id === tab)) {
      activeSessionId = tab;
    }
    pull();
  }

  function selectSingleTrackTab(tab: InnerTab): void {
    if (!getActiveSession()) return;
    patchActiveSession({ nav: { kind: 'single', inner: tab } });
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
    status = null;
    const controller = new TournamentController();
    const namedClasses = draftClassEditorRows
      .map((r) => ({
        id: r.id.trim() || newCompetitionClassId(),
        name: r.name.trim(),
      }))
      .filter((r) => r.name.length > 0);
    if (namedClasses.length > 0) {
      const cmdId = `cmd-classes-init-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const r = controller.setTournamentClasses(namedClasses, [], cmdId);
      if (!r.success) {
        status = r.reason ?? 'Could not apply competition classes';
        return;
      }
    }
    const t0 = controller.getTournament();
    const nav = normalizeSessionNav(t0, { kind: 'single', inner: 'players' });
    const classEditorRowsForSession =
      t0.classDefinitions.length > 0
        ? t0.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
        : [{ id: newCompetitionClassId(), name: '' }];
    const id = `tournament-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const session: TournamentSession = {
      id,
      tournamentName: draftTournamentName.trim() || 'Tournament',
      controller,
      playerOrder: [],
      lastSeedingCommandId: '',
      nav,
      classEditorRows: classEditorRowsForSession,
      groupTargetSize: 4,
      lastSetGroupsCommandId: '',
      classGroupTargetSizeByClassId: {},
      lastSetClassGroupsCommandIdByClass: {},
      handicapEnabled: draftHandicapEnabled,
      tournamentFormat: draftTournamentFormat,
    };
    sessions = [...sessions, session];
    activeSessionId = id;
    workspaceTab = id;
    scoreDraftsBySession = { ...scoreDraftsBySession, [id]: {} };
    nameDraft = session.tournamentName;
    draftClassSectionOpen = false;
    draftClassEditorRows = [{ id: newCompetitionClassId(), name: '' }];
    draftTournamentName = 'Tournament';
    draftHandicapEnabled = false;
    draftTournamentFormat = 'group-bracket';
    pull();
    status = 'Tournament created. Add players on the Players tab.';
  }

  function doUndo(): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.undoLast();
    if (!r.success) {
      status = r.reason ?? 'Undo failed';
    } else {
      status = 'Undid one step (logged as Undo command).';
    }
    pull();
  }

  function doRedo(): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const r = s.controller.redo();
    if (!r.success) {
      status = r.reason ?? 'Redo failed';
    } else {
      status = 'Redo: removed last Undo from the log.';
    }
    pull();
  }

  function addPlayer(): void {
    status = null;
    const s0 = getActiveSession();
    if (!s0) return;
    const name = newName.trim();
    if (!name) {
      status = 'Enter a player name.';
      return;
    }
    const id = newId();
    const cmdId = `cmd-${id}`;
    const c = s0.controller;
    const hc = s0.handicapEnabled ? Math.max(0, Math.floor(Number(newHc) || 0)) : 0;
    const r = c.createPlayer(id, name, hc, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not add player';
      return;
    }
    const s = s0;
    const newOrder = [...s.playerOrder, id];
    const seedDeps = newOrder.map((pid) => `cmd-${pid}`);
    const seedCmdId = `cmd-seed-${crypto.randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const rSeed = c.setSeedings([...newOrder], seedDeps, seedCmdId);
    if (!rSeed.success) {
      status = rSeed.reason ?? 'Could not update seeding order';
      pull();
      return;
    }
    patchActiveSession({ playerOrder: newOrder, lastSeedingCommandId: seedCmdId });
    newName = '';
    newHc = 0;
    status = `Added ${name} (${id}).`;
    pull();
  }

  function matchesForClassBracketRound(t: Tournament, classId: string, round: number): Match[] {
    const slice = classSlice(t, classId);
    return Object.values(t.matches).filter((m) => {
      for (const bm of slice.bracketMatches) {
        if (bm.round !== round || !bm.seedA || !bm.seedB) continue;
        const same =
          (bm.seedA === m.playerA && bm.seedB === m.playerB) || (bm.seedA === m.playerB && bm.seedB === m.playerA);
        if (same) return true;
      }
      return false;
    });
  }

  function generateBracketAndRoundOneMatches(): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      status =
        'This tournament has multiple competition classes. Per-class bracket generation from each class tab will be added next; the global bracket control is disabled.';
      return;
    }
    if (t.seedings.length === 0 || s.playerOrder.length === 0) {
      status = 'Add at least one player first.';
      return;
    }
    const deps: string[] = s.playerOrder.map((pid) => `cmd-${pid}`);
    if (s.lastSeedingCommandId) {
      deps.push(s.lastSeedingCommandId);
    }
    const genId = `cmd-gen-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const shuffleKey = s.tournamentName.trim() || 'Tournament';
    const r = c.generateBracket(fillByes, false, deps, genId, shuffleKey);
    if (!r.success) {
      status = r.reason ?? 'Bracket generation failed';
      pull();
      return;
    }
    const live = c.getTournament();
    const r1 = live.bracketMatches.filter((m) => m.round === 1 && m.seedA && m.seedB);
    if (r1.length === 0) {
      status = 'Bracket generated, but no round‑1 pairings with two players.';
      pull();
      return;
    }
    for (const bm of r1) {
      const mid = `match-${bm.id}`;
      if (live.matches[mid]) continue;
      const a = bm.seedA!;
      const b = bm.seedB!;
      const rM = c.createMatch(mid, a, b, [genId, `cmd-${a}`, `cmd-${b}`], `cmd-m-${bm.id}`);
      if (!rM.success) {
        status = rM.reason ?? 'createMatch failed';
        pull();
        return;
      }
    }
    status = 'Bracket generated and round‑1 matches created.';
    pull();
  }

  function commitPlayerHandicap(playerId: string): void {
    status = null;
    const s = getActiveSession();
    if (!s?.handicapEnabled) return;
    const c = s.controller;
    const p = c.getTournament().players[playerId];
    if (!p) return;
    const raw = Number(handicapDrafts[playerId]);
    const next = Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0));
    if (next === p.handicap) return;
    const cmdId = `cmd-hc-${playerId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const r = c.renamePlayer(playerId, p.name, next, [`cmd-${playerId}`], cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not update handicap';
    } else {
      status = `Handicap for ${p.name} set to ${next}.`;
    }
    pull();
  }

  function playerLabel(id: string | undefined): string {
    if (!id) return '—';
    return tournament.players[id]?.name ?? id;
  }

  function bracketRows(matches: BracketMatch[]): BracketMatch[] {
    return [...matches].sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  }

  function setRoundLock(round: number, locked: boolean): void {
    status = null;
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
      status = r.reason ?? 'SetRoundLock failed';
    } else {
      status = locked ? `Locked bracket round ${round}.` : `Unlocked bracket round ${round}.`;
    }
    pull();
  }

  function downloadJsonl(): void {
    const s = getActiveSession();
    if (!s) {
      status = 'Create or import a tournament before exporting.';
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
    status = 'Downloaded command log (.jsonl).';
    recentTournamentNotes = [`Exported command log · ${new Date().toLocaleString()}`, ...recentTournamentNotes].slice(0, 8);
  }

  async function onImportFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    status = null;
    const text = await file.text();
    const { controller: next, replay } = tournamentControllerFromCommandLog(text);
    if (!replay.success) {
      const reason = replay.results.find((r) => !r.success)?.reason ?? 'Replay failed';
      status = `Import failed: ${reason}`;
      return;
    }
    const t0 = next.getTournament();
    const playerOrder =
      t0.seedings.length > 0 ? [...t0.seedings] : Object.keys(t0.players);
    const nav = normalizeSessionNav(t0, { kind: 'single', inner: 'players' });
    const id = `tournament-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const session: TournamentSession = {
      id,
      tournamentName: titleFromImportFilename(file.name),
      controller: next,
      playerOrder,
      lastSeedingCommandId: lastSetSeedingsCommandId(next.getCommandLog()),
      lastSetGroupsCommandId: lastCommandIdOfType(next.getCommandLog(), 'SetGroups'),
      lastSetClassGroupsCommandIdByClass: lastSetClassGroupsCommandIdsFromLog(next.getCommandLog()),
      nav,
      classEditorRows:
        t0.classDefinitions.length > 0
          ? t0.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
          : [{ id: newCompetitionClassId(), name: '' }],
      groupTargetSize: 4,
      classGroupTargetSizeByClassId: {},
      handicapEnabled: true,
      tournamentFormat: 'group-bracket',
    };
    sessions = [...sessions, session];
    activeSessionId = id;
    workspaceTab = id;
    scoreDraftsBySession = { ...scoreDraftsBySession, [id]: {} };
    nameDraft = session.tournamentName;
    setScoreDrafts({});
    status = `Imported ${file.name} (${replay.results.length} commands).`;
    recentTournamentNotes = [`Imported “${file.name}” · ${new Date().toLocaleString()}`, ...recentTournamentNotes].slice(0, 8);
    pull();
  }

  function submitScores(match: Match): void {
    status = null;
    const rows = scoreDrafts()[match.id];
    if (!rows) {
      status = 'Internal: no score draft for this match.';
      return;
    }
    const scores = scoresForSubmitFromRows(rows);
    if (!scores) {
      scoreModalHint =
        'Complete each game in order (11+ with a two-point margin; above 11 the gap must be exactly two). The match must end with one player on three game wins (best of five).';
      return;
    }
    const bm = tournament.bracketMatches.find(
      (x) =>
        x.seedA &&
        x.seedB &&
        ((x.seedA === match.playerA && x.seedB === match.playerB) || (x.seedA === match.playerB && x.seedB === match.playerA)),
    );
    const createCmdId = bm ? `cmd-m-${bm.id}` : undefined;
    const deps = createCmdId ? [createCmdId] : [];
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const r = c.enterScore(match.id, scores, deps, `cmd-score-${match.id}-${Date.now()}`);
    if (!r.success) {
      scoreModalHint = r.reason ?? 'enterScore failed';
      status = r.reason ?? 'enterScore failed';
      pull();
      return;
    }
    status = `Saved scores for ${match.id}.`;
    closeScoreModal();
    pull();
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
      case 'EnterScore': {
        const m = t.matches[cmd.payload.matchId];
        return m ? `Entered scores · ${pn(m.playerA)} vs ${pn(m.playerB)}` : 'Entered match scores.';
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
      case 'GenerateBracket':
        return 'Generated bracket.';
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

  const bracketRounds = $derived(uniqueSortedRounds(tournament.bracketMatches));
  const lastBracketRound = $derived(bracketRounds.length ? bracketRounds[bracketRounds.length - 1] : 0);

  const finishedPlayerMatches = $derived(
    Object.values(tournament.matches).filter((m) => m.status === 'finished' && m.winner),
  );

  const useClassTabs = $derived(tournamentUsesClassTabs(tournament));

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
    const base: Array<{ id: InnerTab; label: string }> = [
      { id: 'groups', label: 'Group phase' },
    ];
    if (bracketRounds.length === 0) {
      base.push({ id: 'bracket-setup', label: 'Bracket' });
    } else {
      for (const r of bracketRounds) {
        base.push({ id: `bracket:${r}`, label: `Bracket · round ${r}` });
      }
    }
    base.push({ id: 'results', label: 'Final overview' });
    return base;
  });

  const classSubTabsList = $derived.by((): Array<{ id: ClassInnerTab; label: string }> => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'multi' || s.nav.screen === 'players') {
      return [];
    }
    const cid = s.nav.screen.classId;
    const rounds = uniqueSortedRounds(classSlice(tournament, cid).bracketMatches);
    const base: Array<{ id: ClassInnerTab; label: string }> = [{ id: 'groups', label: 'Group phase' }];
    if (rounds.length === 0) {
      base.push({ id: 'bracket-setup', label: 'Bracket' });
    } else {
      for (const r of rounds) {
        base.push({ id: `bracket:${r}`, label: `Bracket · round ${r}` });
      }
    }
    base.push({ id: 'results', label: 'Final overview' });
    return base;
  });

  const showPlayersPanel = $derived.by(() => {
    const s = getActiveSession();
    if (!s) return false;
    if (s.nav.kind === 'single') return s.nav.inner === 'players';
    return s.nav.screen === 'players';
  });

  const multiClassScreen = $derived.by((): { classId: string; inner: ClassInnerTab } | null => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'multi' || s.nav.screen === 'players') return null;
    return s.nav.screen;
  });

  const singleTrackInner = $derived.by((): InnerTab | null => {
    const s = getActiveSession();
    if (!s || s.nav.kind !== 'single') return null;
    return s.nav.inner;
  });

  function togglePlayerClass(playerId: string, classId: string, checked: boolean): void {
    status = null;
    const s = getActiveSession();
    if (!s) return;
    const c = s.controller;
    const cmdId = `cmd-pcf-${playerId}-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const r = c.setPlayerClassFlags(playerId, { [classId]: checked }, [`cmd-${playerId}`], cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not update class flags';
    }
    pull();
  }

  pull();
</script>

<div class="app" class:app-with-footer={Boolean(activeSess)}>
  <div class="app-sticky-head">
    <header class="top-bar">
      <div class="brand">
        <span class="brand-mark">TTCB</span>
        <span class="brand-text">Tornooiapp</span>
      </div>
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
    </header>

    {#if status}
      <div class="banner status-banner" role="status">{status}</div>
    {/if}
  </div>

  <main class="main">
    {#if workspaceTab === 'settings'}
      <section class="card settings-card">
        <h1 class="h1">Tournament settings</h1>
        <p class="lead">
          Create a tournament, import a command log (JSONL), or export the active tournament. Open tournaments appear as tabs in
          the header.
        </p>

        <div class="settings-grid">
          <div class="settings-block">
            <h2 class="h2">Data</h2>
            <div class="btn-row">
              <button
                type="button"
                class="btn primary"
                disabled={!getActiveSession()}
                title={getActiveSession() ? 'Export command log (JSONL)' : 'Create or import a tournament first'}
                onclick={downloadJsonl}
              >
                Export JSONL
              </button>
              <label class="file-btn">
                Import JSONL
                <input type="file" accept=".jsonl,.txt,application/json,text/plain" class="sr" onchange={onImportFile} />
              </label>
            </div>
          </div>

          <div class="settings-block new-tournament-block">
            <h2 class="h2">New tournament</h2>
            <label class="field-block">
              <span class="field-label">Name</span>
              <input
                class="draft-tournament-name-input"
                type="text"
                bind:value={draftTournamentName}
                maxlength="120"
                autocomplete="off"
              />
            </label>

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

            {#if !draftClassSectionOpen}
              <p class="muted small">Competition classes are optional (separate tracks, e.g. junior / senior).</p>
              <button type="button" class="btn subtle" onclick={() => (draftClassSectionOpen = true)}>
                Add competition classes
              </button>
            {:else}
              <div class="sub-card draft-classes">
                <h3 class="h3">Competition classes</h3>
                <p class="muted small">Enter a display name per row. Empty rows are ignored when you create the tournament.</p>
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
                  <button
                    type="button"
                    class="btn ghost"
                    onclick={() => {
                      draftClassSectionOpen = false;
                      draftClassEditorRows = [{ id: newCompetitionClassId(), name: '' }];
                    }}
                  >
                    Clear classes
                  </button>
                </div>
              </div>
            {/if}

            <div class="btn-row">
              <button type="button" class="btn primary" onclick={createTournamentFromWizard}>Create tournament</button>
            </div>
          </div>

          <div class="settings-block">
            <h2 class="h2">Recent activity</h2>
            <p class="muted small">Persistent “recent tournaments” is not wired yet; this list only reflects exports and imports in this session.</p>
            {#if recentTournamentNotes.length === 0}
              <p class="muted">No recent entries.</p>
            {:else}
              <ul class="recent-list">
                {#each recentTournamentNotes as line, i (i)}
                  <li>{line}</li>
                {/each}
              </ul>
            {/if}
          </div>

          <div class="settings-block muted small">
            <h2 class="h2">Multiple tournaments</h2>
            <p>The tab row is ready for more tournament tabs; opening several files at once will be added later.</p>
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
                class="btn subtle"
                onclick={applySuggestedTournamentTitle}
                title="Set name from current roster (e.g. player names or count)"
              >
                Use suggested
              </button>
            </div>
          </div>
        </div>

        <nav class="inner-tabs" aria-label="Tournament sections">
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
          {#if showPlayersPanel}
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
                {#if activeSess.handicapEnabled}
                  <label class="hc-add-wrap" for="new-player-hc">
                    <span class="hc-label">Handicap</span>
                    <input
                      id="new-player-hc"
                      class="hc"
                      type="number"
                      bind:value={newHc}
                      min="0"
                      step="1"
                      title="Handicap"
                    />
                  </label>
                {/if}
                <button type="submit" class="btn primary">Add player</button>
              </form>
              <p class="muted small">
                Bracket seeding follows the order players are added (saved automatically).
                {#if useClassTabs}
                  Open a <strong>class tab</strong> for group phase, bracket, and results for that track.
                {:else}
                  When you are ready, open the <strong>Bracket</strong> tab to generate the draw and round‑1 matches.
                {/if}
              </p>
              <ol class="seed-list">
                {#each activeSess.playerOrder as pid (pid)}
                  <li class="player-row">
                    <div class="player-main">
                      <span class="name">{playerLabel(pid)}</span>
                      {#if activeSess.handicapEnabled}
                        <span class="hc-wrap">
                          <label class="hc-label" for={`hc-${pid}`}>Handicap</label>
                          <input
                            id={`hc-${pid}`}
                            class="hc-inline"
                            type="number"
                            min="0"
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
              <p class="muted small">
                Pick a target group size (each group will have that many players, or one fewer where needed). Groups are
                named <strong>group 1</strong>, <strong>group 2</strong>, … in seeding order. Creating groups also creates all round‑robin matches.
              </p>
              <div class="row group-editor-head">
                <label class="grow">
                  <span class="field-label">Target players per group</span>
                  <input
                    class="grow"
                    type="number"
                    min="1"
                    step="1"
                    value={activeSess.groupTargetSize}
                    aria-label="Target group size"
                    oninput={(e) => {
                      const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                      patchActiveSession({ groupTargetSize: v });
                    }}
                  />
                </label>
              </div>
              <p class="muted small">
                {#if eligibleGlobalGroupPlayerIds(tournament).length === 0}
                  Add players on the Players tab first.
                {:else}
                  All {eligibleGlobalGroupPlayerIds(tournament).length} seeded players are included, in seeding order.
                {/if}
              </p>
              <div class="row align-end">
                <button type="button" class="btn danger-ghost" onclick={clearGlobalGroups}>Clear groups</button>
                {#if Object.keys(tournament.groups).length === 0}
                  <button type="button" class="btn primary" onclick={createGlobalGroupsAndMatches}>
                    Create groups & matches
                  </button>
                {/if}
              </div>

              <h3 class="h3">Groups</h3>
              {#if Object.keys(tournament.groups).length === 0}
                <p class="muted small">No groups yet. Use Create groups & matches.</p>
              {:else}
                {#each sortGroupsForDisplay(tournament.groups) as g (g.id)}
                  <article class="sub-card">
                    <h4 class="h4">{groupDisplayLabel(g)}</h4>
                    <p class="muted small">
                      {g.playerIds.map((p) => playerLabel(p)).join(' · ') || 'No players'}
                    </p>
                    <table class="grid compact">
                      <thead>
                        <tr><th>Player</th><th>W</th><th>L</th></tr>
                      </thead>
                      <tbody>
                        {#each groupStandingsForGroup(tournament, g, undefined) as s (s.pid)}
                          <tr>
                            <td>{playerLabel(s.pid)}</td>
                            <td>{s.w}</td>
                            <td>{s.l}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </article>
                {/each}
              {/if}

              <h3 class="h3">Group matches</h3>
              {#each groupMatchesInScope(tournament, undefined) as match (match.id)}
                <article class="match-card">
                  <header>
                    <strong>{playerLabel(match.playerA)}</strong> vs <strong>{playerLabel(match.playerB)}</strong>
                    <span class="meta">{groupLabelForMatch(tournament, match)} · {match.status}</span>
                  </header>
                  {#if match.status === 'scheduled'}
                    <div class="row">
                      <button type="button" class="btn primary" onclick={() => openScoreModal(match)}>Enter games…</button>
                    </div>
                  {:else}
                    <ul class="done-scores">
                      {#each match.scores as g, i (i)}
                        <li>Game {i + 1}: {g.playerA}–{g.playerB}</li>
                      {/each}
                    </ul>
                  {/if}
                </article>
              {:else}
                <p class="muted small">No group matches yet.</p>
              {/each}
            </section>
          {:else if !useClassTabs && singleTrackInner === 'bracket-setup'}
            <section class="card">
              <h2 class="h2">Bracket</h2>
              <p class="muted">
                Build the bracket from the current seeding and open player matches for every round‑1 pairing in one step.
              </p>
              <div class="row align-end">
                <label class="chk"><input type="checkbox" bind:checked={fillByes} /> Fill byes to next power of two</label>
                <button type="button" class="btn primary" onclick={generateBracketAndRoundOneMatches}>
                  Generate bracket & round‑1 matches
                </button>
              </div>
              {#if tournament.bracketMatches.length === 0}
                <p class="muted small">No bracket structure yet.</p>
              {:else}
                <table class="grid">
                  <thead>
                    <tr>
                      <th>Rd</th>
                      <th>Slot</th>
                      <th>Pairing</th>
                      <th>Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each bracketRows(tournament.bracketMatches) as m (m.id)}
                      <tr>
                        <td>{m.round}</td>
                        <td><code>{m.id}</code></td>
                        <td>{playerLabel(m.seedA)} vs {playerLabel(m.seedB)}</td>
                        <td>{m.winner ? playerLabel(m.winner) : '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </section>
          {:else if !useClassTabs && singleTrackInner?.startsWith('bracket:')}
            {@const round = Number(singleTrackInner!.slice('bracket:'.length))}
            <section class="card">
              <h2 class="h2">Bracket · round {round}</h2>
              <p class="muted small">Pairings and scores for this bracket round. Round lock blocks entering scores for mapped matches.</p>
              <div class="row">
                <button type="button" class="btn primary" onclick={() => setRoundLock(round, true)}>Lock round</button>
                <button type="button" class="btn" onclick={() => setRoundLock(round, false)}>Unlock round</button>
                {#if tournament.lockedBracketRounds.includes(round)}
                  <span class="pill warn">Locked</span>
                {/if}
              </div>
              <table class="grid">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Pairing</th>
                    <th>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {#each bracketMatchesForRound(tournament.bracketMatches, round) as m (m.id)}
                    <tr>
                      <td><code>{m.id}</code></td>
                      <td>{playerLabel(m.seedA)} vs {playerLabel(m.seedB)}</td>
                      <td>{m.winner ? playerLabel(m.winner) : '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>

              <h3 class="h3">Matches & scores (this round)</h3>
              {#each matchesForBracketRound(tournament, round) as match (match.id)}
                <article class="match-card">
                  <header>
                    <strong>{playerLabel(match.playerA)}</strong> vs <strong>{playerLabel(match.playerB)}</strong>
                    <span class="meta">{match.status}</span>
                  </header>
                  {#if match.status === 'scheduled'}
                    <div class="row">
                      <button type="button" class="btn primary" onclick={() => openScoreModal(match)}>Enter games…</button>
                    </div>
                  {:else}
                    <ul class="done-scores">
                      {#each match.scores as g, i (i)}
                        <li>Game {i + 1}: {g.playerA}–{g.playerB}</li>
                      {/each}
                    </ul>
                  {/if}
                </article>
              {:else}
                <p class="muted">No player matches mapped to this bracket round yet.</p>
              {/each}
            </section>
          {:else if !useClassTabs && singleTrackInner === 'results'}
            <section class="card">
              <h2 class="h2">Final overview</h2>
              <p class="muted small">High-level snapshot from the current reconstructed state.</p>

              {#if tournament.bracketMatches.length > 0 && lastBracketRound > 0}
                {@const finals = bracketMatchesForRound(tournament.bracketMatches, lastBracketRound)}
                <h3 class="h3">Latest bracket round ({lastBracketRound})</h3>
                <ul class="plain-list">
                  {#each finals as m (m.id)}
                    <li>
                      <strong>{playerLabel(m.seedA)}</strong> vs <strong>{playerLabel(m.seedB)}</strong>
                      — winner: {m.winner ? playerLabel(m.winner) : '—'}
                    </li>
                  {/each}
                </ul>
              {/if}

              <h3 class="h3">Finished player matches</h3>
              {#if finishedPlayerMatches.length === 0}
                <p class="muted">No finished player matches yet.</p>
              {:else}
                {#each finishedPlayerMatches as m (m.id)}
                  <p class="result-line">
                    <strong>{playerLabel(m.winner)}</strong>
                    <span class="muted">def.</span>
                    <strong
                      >{m.winner === m.playerA ? playerLabel(m.playerB) : playerLabel(m.playerA)}</strong
                    >
                    <span class="muted">· {m.scores.length} games</span>
                  </p>
                {/each}
              {/if}

              {#if Object.keys(tournament.teamMatches).length > 0}
                <h3 class="h3">Team match</h3>
                {#each Object.values(tournament.teamMatches) as tm (tm.id)}
                  <p>{tm.status} — teams {tm.teamA} vs {tm.teamB}</p>
                {/each}
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
                <p class="muted small">
                  Players listed here are in this class (from the Players tab). Target size controls group sizes (each
                  group is that size or one smaller). Groups are named group 1, group 2, …; creating them also creates all
                  round‑robin matches for this class.
                </p>
                <div class="row group-editor-head">
                  <label class="grow">
                    <span class="field-label">Target players per group</span>
                    <input
                      class="grow"
                      type="number"
                      min="1"
                      step="1"
                      value={classGroupTargetSize(cid)}
                      aria-label="Target group size for class"
                      oninput={(e) =>
                        setClassGroupTargetSize(
                          cid,
                          Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1)),
                        )}
                    />
                  </label>
                </div>
                <p class="muted small">
                  {#if slice.seedings.length === 0}
                    No players in this class yet — enable the class checkbox for players on the Players tab.
                  {:else}
                    All {slice.seedings.length} players in this class are included, in class seeding order.
                  {/if}
                </p>
                <div class="row align-end">
                  <button type="button" class="btn danger-ghost" onclick={() => clearClassGroups(cid)}>Clear groups</button>
                  {#if Object.keys(slice.groups).length === 0}
                    <button type="button" class="btn primary" onclick={() => createClassGroupsAndMatches(cid)}>
                      Create groups & matches
                    </button>
                  {/if}
                </div>

                <h3 class="h3">Groups</h3>
                {#if Object.keys(slice.groups).length === 0}
                  <p class="muted small">No groups for this class yet.</p>
                {:else}
                  {#each sortGroupsForDisplay(slice.groups) as g (g.id)}
                    <article class="sub-card">
                      <h4 class="h4">{groupDisplayLabel(g)}</h4>
                      <p class="muted small">
                        {g.playerIds.map((p) => playerLabel(p)).join(' · ') || 'No players'}
                      </p>
                      <table class="grid compact">
                        <thead>
                          <tr><th>Player</th><th>W</th><th>L</th></tr>
                        </thead>
                        <tbody>
                          {#each groupStandingsForGroup(tournament, g, cid) as s (s.pid)}
                            <tr>
                              <td>{playerLabel(s.pid)}</td>
                              <td>{s.w}</td>
                              <td>{s.l}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </article>
                  {/each}
                {/if}

                <h3 class="h3">Group matches (this class)</h3>
                {#each groupMatchesInScope(tournament, cid) as match (match.id)}
                  <article class="match-card">
                    <header>
                      <strong>{playerLabel(match.playerA)}</strong> vs <strong>{playerLabel(match.playerB)}</strong>
                      <span class="meta">{groupLabelForMatch(tournament, match)} · {match.status}</span>
                    </header>
                    {#if match.status === 'scheduled'}
                      <div class="row">
                        <button type="button" class="btn primary" onclick={() => openScoreModal(match)}>Enter games…</button>
                      </div>
                    {:else}
                      <ul class="done-scores">
                        {#each match.scores as g, i (i)}
                          <li>Game {i + 1}: {g.playerA}–{g.playerB}</li>
                        {/each}
                      </ul>
                    {/if}
                  </article>
                {:else}
                  <p class="muted small">No group matches for this class yet.</p>
                {/each}
              </section>
            {:else if cin === 'bracket-setup'}
              <section class="card">
                <h2 class="h2">Bracket · {def?.name ?? cid}</h2>
                <p class="muted">
                  Seeding for this class follows the global player order, including only players with the checkbox for this
                  class. Per-class bracket generation and matches will be wired next; the global bracket is disabled while
                  multiple classes are defined.
                </p>
                <h3 class="h3">Class seeding (preview)</h3>
                {#if slice.seedings.length === 0}
                  <p class="muted small">No players are marked for this class yet.</p>
                {:else}
                  <ol class="plain-list">
                    {#each slice.seedings as pid (pid)}
                      <li>{playerLabel(pid)}</li>
                    {/each}
                  </ol>
                {/if}
                <div class="row align-end">
                  <label class="chk muted"><input type="checkbox" disabled checked={fillByes} /> Fill byes (soon)</label>
                  <button type="button" class="btn primary" disabled>Generate bracket for this class</button>
                </div>
              </section>
            {:else if cin.startsWith('bracket:')}
              {@const round = Number(cin.slice('bracket:'.length))}
              <section class="card">
                <h2 class="h2">Bracket · {def?.name ?? cid} · round {round}</h2>
                <p class="muted small">
                  Bracket rounds for this class will mirror the main flow once per-class brackets are generated.
                </p>
                {#if slice.bracketMatches.length === 0}
                  <p class="muted">No bracket for this class yet.</p>
                {:else}
                  <div class="row">
                    <button type="button" class="btn primary" disabled>Lock round</button>
                    <button type="button" class="btn" disabled>Unlock round</button>
                  </div>
                  <table class="grid">
                    <thead>
                      <tr>
                        <th>Slot</th>
                        <th>Pairing</th>
                        <th>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each bracketMatchesForRound(slice.bracketMatches, round) as m (m.id)}
                        <tr>
                          <td><code>{m.id}</code></td>
                          <td>{playerLabel(m.seedA)} vs {playerLabel(m.seedB)}</td>
                          <td>{m.winner ? playerLabel(m.winner) : '—'}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  <h3 class="h3">Matches & scores (this round)</h3>
                  {#each matchesForClassBracketRound(tournament, cid, round) as match (match.id)}
                    <article class="match-card">
                      <header>
                        <strong>{playerLabel(match.playerA)}</strong> vs <strong>{playerLabel(match.playerB)}</strong>
                        <span class="meta">{match.status}</span>
                      </header>
                      {#if match.status === 'scheduled'}
                        <div class="row">
                          <button type="button" class="btn primary" onclick={() => openScoreModal(match)}>Enter games…</button>
                        </div>
                      {:else}
                        <ul class="done-scores">
                          {#each match.scores as g, i (i)}
                            <li>Game {i + 1}: {g.playerA}–{g.playerB}</li>
                          {/each}
                        </ul>
                      {/if}
                    </article>
                  {:else}
                    <p class="muted">No player matches for this class bracket round yet.</p>
                  {/each}
                {/if}
              </section>
            {:else if cin === 'results'}
              {@const classRounds = uniqueSortedRounds(slice.bracketMatches)}
              {@const lastClassRound = classRounds.length ? classRounds[classRounds.length - 1] : 0}
              {@const classPid = new Set(slice.seedings)}
              {@const classFinished = finishedPlayerMatches.filter(
                (m) => classPid.has(m.playerA) && classPid.has(m.playerB),
              )}
              <section class="card">
                <h2 class="h2">Final overview · {def?.name ?? cid}</h2>
                <p class="muted small">Snapshot for this class track.</p>
                {#if slice.bracketMatches.length > 0 && lastClassRound > 0}
                  {@const finals = bracketMatchesForRound(slice.bracketMatches, lastClassRound)}
                  <h3 class="h3">Latest bracket round ({lastClassRound})</h3>
                  <ul class="plain-list">
                    {#each finals as m (m.id)}
                      <li>
                        <strong>{playerLabel(m.seedA)}</strong> vs <strong>{playerLabel(m.seedB)}</strong>
                        — winner: {m.winner ? playerLabel(m.winner) : '—'}
                      </li>
                    {/each}
                  </ul>
                {/if}
                <h3 class="h3">Finished matches (players in this class)</h3>
                {#if classFinished.length === 0}
                  <p class="muted">No finished head-to-head matches between two class entrants yet.</p>
                {:else}
                  {#each classFinished as m (m.id)}
                    <p class="result-line">
                      <strong>{playerLabel(m.winner)}</strong>
                      <span class="muted">def.</span>
                      <strong
                        >{m.winner === m.playerA ? playerLabel(m.playerB) : playerLabel(m.playerA)}</strong
                      >
                      <span class="muted">· {m.scores.length} games</span>
                    </p>
                  {/each}
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
                      disabled={!rowIndexEnabled(modalRows, gi)}
                      value={srow.a === '' ? '' : srow.a}
                      oninput={(e) =>
                        setScoreModalCell(sm.id, gi, 'a', (e.currentTarget as HTMLInputElement).value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      disabled={!rowIndexEnabled(modalRows, gi)}
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
            <button type="button" class="btn primary" onclick={() => submitScores(sm)}>Save match</button>
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
    backdrop-filter: blur(8px);
  }

  .main {
    flex: 1;
    width: 100%;
    max-width: 58rem;
    margin: 0 auto;
    padding: 1.25rem 1.25rem 2.5rem;
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
    padding-left: 1.2rem;
    color: #475569;
    font-size: 0.88rem;
  }

  .new-tournament-block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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

  .grid.compact th,
  .grid.compact td {
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
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

  .result-line {
    margin: 0.35rem 0;
    font-size: 0.92rem;
  }

  .pill {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .pill.warn {
    background: #fef3c7;
    color: #92400e;
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
