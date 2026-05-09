<script lang="ts">
  import type { BracketMatch, ClassTournamentSlice, GroupDefinition, Match, Tournament } from 'ttc-tornooiapp';
  import {
    TournamentController,
    exportCommandsAsJsonLines,
    tournamentControllerFromCommandLog,
    findBracketRoundForPlayerPairing,
    tournamentUsesClassTabs,
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
    /** When true, player is excluded from the next global group build. */
    groupPlayerExcluded: Record<string, boolean>;
    /** Latest `SetGroups` command id (optional extra deps for follow-up commands). */
    lastSetGroupsCommandId: string;
    /** Per-class target group size. */
    classGroupTargetSizeByClassId: Record<string, number>;
    /** Per-class, per-player exclusion from group build. */
    classGroupPlayerExcludedByClassId: Record<string, Record<string, boolean>>;
    /** Latest `SetClassGroups` command id per class. */
    lastSetClassGroupsCommandIdByClass: Record<string, string>;
  }

  type ScoreRow = { a: string; b: string };

  /** Top workspace tab: `'settings'` or a tournament session id. */
  let workspaceTab = $state<string>('tournament-1');
  let sessions = $state<TournamentSession[]>([
    {
      id: 'tournament-1',
      tournamentName: 'Tournament',
      controller: new TournamentController(),
      playerOrder: [],
      lastSeedingCommandId: '',
      nav: { kind: 'single', inner: 'players' },
      classEditorRows: [{ id: newCompetitionClassId(), name: '' }],
      groupTargetSize: 4,
      groupPlayerExcluded: {},
      lastSetGroupsCommandId: '',
      classGroupTargetSizeByClassId: {},
      classGroupPlayerExcludedByClassId: {},
      lastSetClassGroupsCommandIdByClass: {},
    },
  ]);
  let activeSessionId = $state('tournament-1');

  /** Draft handicap per player id (synced from tournament in pull when row not focused). */
  let handicapDrafts = $state<Record<string, number>>({});
  let handicapFocusPid = $state<string | null>(null);

  let tournament = $state<Tournament>(snapshot());
  let status = $state<string | null>(null);

  let newName = $state('');
  let newHc = $state(0);
  let fillByes = $state(true);

  /** Score drafts keyed by match id, scoped per session. */
  let scoreDraftsBySession = $state<Record<string, Record<string, ScoreRow[]>>>({});

  /** Draft for the title field; kept in sync with the active session’s saved name when not editing. */
  let nameDraft = $state('Tournament');
  let nameInputFocused = $state(false);

  $effect(() => {
    const s = sessions.find((x) => x.id === activeSessionId);
    if (!s || nameInputFocused) return;
    nameDraft = s.tournamentName;
  });

  function defaultRows(n: number): ScoreRow[] {
    return Array.from({ length: n }, () => ({ a: '', b: '' }));
  }

  function activeSession(): TournamentSession {
    return sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  }

  function scoreDrafts(): Record<string, ScoreRow[]> {
    return scoreDraftsBySession[activeSessionId] ?? {};
  }

  function setScoreDrafts(next: Record<string, ScoreRow[]>): void {
    scoreDraftsBySession = { ...scoreDraftsBySession, [activeSessionId]: next };
  }

  function snapshot(): Tournament {
    return structuredClone(activeSession().controller.getTournament());
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
    const s = activeSession();
    if (s.playerOrder.length > 0) return [...s.playerOrder];
    if (t.seedings.length > 0) return [...t.seedings];
    return Object.keys(t.players).sort((a, b) => a.localeCompare(b));
  }

  function toggleGlobalGroupPlayerExcluded(pid: string, excluded: boolean): void {
    const s = activeSession();
    const next = { ...s.groupPlayerExcluded };
    if (excluded) next[pid] = true;
    else delete next[pid];
    patchActiveSession({ groupPlayerExcluded: next });
  }

  function classGroupTargetSize(classId: string): number {
    const v = activeSession().classGroupTargetSizeByClassId[classId];
    return typeof v === 'number' && v >= 1 ? v : 4;
  }

  function setClassGroupTargetSize(classId: string, size: number): void {
    const s = activeSession();
    patchActiveSession({
      classGroupTargetSizeByClassId: { ...s.classGroupTargetSizeByClassId, [classId]: Math.max(1, Math.floor(size)) },
    });
  }

  function isClassPlayerExcluded(classId: string, pid: string): boolean {
    return Boolean(activeSession().classGroupPlayerExcludedByClassId[classId]?.[pid]);
  }

  function toggleClassGroupPlayerExcluded(classId: string, pid: string, excluded: boolean): void {
    const s = activeSession();
    const prev = s.classGroupPlayerExcludedByClassId[classId] ?? {};
    const next = { ...prev };
    if (excluded) next[pid] = true;
    else delete next[pid];
    patchActiveSession({
      classGroupPlayerExcludedByClassId: { ...s.classGroupPlayerExcludedByClassId, [classId]: next },
    });
  }

  function createGlobalGroupsAndMatches(): void {
    status = null;
    const s = activeSession();
    const c = s.controller;
    const t = c.getTournament();
    if (tournamentUsesClassTabs(t)) {
      status = 'With multiple competition classes, use each class tab for groups.';
      return;
    }
    const eligible = eligibleGlobalGroupPlayerIds(t);
    const ordered = eligible.filter((pid) => !s.groupPlayerExcluded[pid]);
    if (ordered.length === 0) {
      status = 'Select at least one player (enable checkboxes) to place in groups.';
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
    status = 'Created numbered groups and all round‑robin matches.';
    pull();
  }

  function clearGlobalGroups(): void {
    status = null;
    const s = activeSession();
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
    const s = activeSession();
    const c = s.controller;
    const t = c.getTournament();
    if (!tournamentUsesClassTabs(t)) {
      status = 'Class groups require two or more competition classes.';
      return;
    }
    const slice = classSlice(t, classId);
    const ordered = slice.seedings.filter((pid) => !isClassPlayerExcluded(classId, pid));
    if (ordered.length === 0) {
      status = 'Include at least one player for this class.';
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
    status = 'Created numbered groups and round‑robin matches for this class.';
    pull();
  }

  function clearClassGroups(classId: string): void {
    status = null;
    const s = activeSession();
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
    const next = nameDraft.trim() || 'Untitled tournament';
    if (next !== activeSession().tournamentName) {
      patchActiveSession({ tournamentName: next });
    }
    nameDraft = next;
  }

  function applySuggestedTournamentTitle(): void {
    const s = activeSession();
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
    sessions = sessions.map((s) => (s.id === activeSessionId ? { ...s, ...patch } : s));
  }

  function pull(): void {
    const s = activeSession();
    const t = structuredClone(s.controller.getTournament());
    tournament = t;

    const navNext = normalizeSessionNav(t, s.nav);
    if (JSON.stringify(navNext) !== JSON.stringify(s.nav)) {
      patchActiveSession({ nav: navNext });
    }

    const sAfter = activeSession();
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
        next[m.id] = defaultRows(5);
      }
    }
    setScoreDrafts(next);

    const po = activeSession().playerOrder;
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
    patchActiveSession({ nav: { kind: 'single', inner: tab } });
  }

  function selectPlayersNav(): void {
    const t = activeSession().controller.getTournament();
    if (tournamentUsesClassTabs(t)) {
      patchActiveSession({ nav: { kind: 'multi', screen: 'players' } });
    } else {
      patchActiveSession({ nav: { kind: 'single', inner: 'players' } });
    }
  }

  function selectClassTopTab(classId: string): void {
    patchActiveSession({ nav: { kind: 'multi', screen: { classId, inner: 'groups' } } });
  }

  function selectClassSubTab(classId: string, sub: ClassInnerTab): void {
    patchActiveSession({ nav: { kind: 'multi', screen: { classId, inner: sub } } });
  }

  function newTournament(): void {
    patchActiveSession({
      controller: new TournamentController(),
      playerOrder: [],
      lastSeedingCommandId: '',
      lastSetGroupsCommandId: '',
      lastSetClassGroupsCommandIdByClass: {},
      nav: { kind: 'single', inner: 'players' },
      classEditorRows: [{ id: newCompetitionClassId(), name: '' }],
      tournamentName: 'Tournament',
      groupTargetSize: 4,
      groupPlayerExcluded: {},
      classGroupTargetSizeByClassId: {},
      classGroupPlayerExcludedByClassId: {},
    });
    setScoreDrafts({});
    status = 'Started a new empty tournament.';
    pull();
  }

  function doUndo(): void {
    status = null;
    const r = activeSession().controller.undoLast();
    if (!r.success) {
      status = r.reason ?? 'Undo failed';
    } else {
      status = 'Undid one step (logged as Undo command).';
    }
    pull();
  }

  function doRedo(): void {
    status = null;
    const r = activeSession().controller.redo();
    if (!r.success) {
      status = r.reason ?? 'Redo failed';
    } else {
      status = 'Redo: removed last Undo from the log.';
    }
    pull();
  }

  function addPlayer(): void {
    status = null;
    const name = newName.trim();
    if (!name) {
      status = 'Enter a player name.';
      return;
    }
    const id = newId();
    const cmdId = `cmd-${id}`;
    const c = activeSession().controller;
    const r = c.createPlayer(id, name, newHc, cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not add player';
      return;
    }
    const s = activeSession();
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
    const s = activeSession();
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
    const r = c.generateBracket(fillByes, false, deps, genId);
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
    const c = activeSession().controller;
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
    const c = activeSession().controller;
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
    const c = activeSession().controller;
    const text = exportCommandsAsJsonLines(c.getCommandLog());
    const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugForFilename(activeSession().tournamentName)}-${new Date().toISOString().slice(0, 10)}.jsonl`;
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
    patchActiveSession({
      controller: next,
      playerOrder,
      lastSeedingCommandId: lastSetSeedingsCommandId(next.getCommandLog()),
      lastSetGroupsCommandId: lastCommandIdOfType(next.getCommandLog(), 'SetGroups'),
      lastSetClassGroupsCommandIdByClass: lastSetClassGroupsCommandIdsFromLog(next.getCommandLog()),
      nav: { kind: 'single', inner: 'players' },
      classEditorRows:
        t0.classDefinitions.length > 0
          ? t0.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
          : [{ id: newCompetitionClassId(), name: '' }],
      tournamentName: titleFromImportFilename(file.name),
      groupTargetSize: 4,
      groupPlayerExcluded: {},
      classGroupTargetSizeByClassId: {},
      classGroupPlayerExcludedByClassId: {},
    });
    setScoreDrafts({});
    status = `Imported ${file.name} (${replay.results.length} commands).`;
    recentTournamentNotes = [`Imported “${file.name}” · ${new Date().toLocaleString()}`, ...recentTournamentNotes].slice(0, 8);
    pull();
  }

  function addGameRow(matchId: string): void {
    const cur = scoreDrafts()[matchId] ?? defaultRows(5);
    setScoreDrafts({ ...scoreDrafts(), [matchId]: [...cur, { a: '', b: '' }] });
  }

  function submitScores(match: Match): void {
    status = null;
    const rows = scoreDrafts()[match.id];
    if (!rows) {
      status = 'Internal: no score draft for this match.';
      return;
    }
    const scores: Array<{ playerA: number; playerB: number }> = [];
    for (const row of rows) {
      const a = Number(row.a);
      const b = Number(row.b);
      if (row.a === '' && row.b === '') continue;
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        status = 'Each entered game needs two numeric scores.';
        return;
      }
      scores.push({ playerA: a, playerB: b });
    }
    if (scores.length === 0) {
      status = 'Enter at least one game score.';
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
    const c = activeSession().controller;
    const r = c.enterScore(match.id, scores, deps, `cmd-score-${match.id}-${Date.now()}`);
    if (!r.success) {
      status = r.reason ?? 'enterScore failed';
      pull();
      return;
    }
    status = `Saved scores for ${match.id}.`;
    pull();
  }

  const bracketRounds = $derived(uniqueSortedRounds(tournament.bracketMatches));
  const lastBracketRound = $derived(bracketRounds.length ? bracketRounds[bracketRounds.length - 1] : 0);

  const finishedPlayerMatches = $derived(
    Object.values(tournament.matches).filter((m) => m.status === 'finished' && m.winner),
  );

  const useClassTabs = $derived(tournamentUsesClassTabs(tournament));

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
    const s = activeSession();
    if (s.nav.kind !== 'multi' || s.nav.screen === 'players') {
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
    const s = activeSession();
    if (s.nav.kind === 'single') return s.nav.inner === 'players';
    return s.nav.screen === 'players';
  });

  const multiClassScreen = $derived.by((): { classId: string; inner: ClassInnerTab } | null => {
    const s = activeSession();
    if (s.nav.kind !== 'multi' || s.nav.screen === 'players') return null;
    return s.nav.screen;
  });

  const singleTrackInner = $derived(activeSession().nav.kind === 'single' ? activeSession().nav.inner : null);

  function updateClassEditorRow(index: number, name: string): void {
    const s = activeSession();
    const next = s.classEditorRows.map((row, i) => (i === index ? { ...row, name } : row));
    patchActiveSession({ classEditorRows: next });
  }

  function addClassEditorRow(): void {
    const s = activeSession();
    patchActiveSession({ classEditorRows: [...s.classEditorRows, { id: newCompetitionClassId(), name: '' }] });
  }

  function removeClassEditorRow(index: number): void {
    const s = activeSession();
    const next = s.classEditorRows.filter((_, i) => i !== index);
    patchActiveSession({ classEditorRows: next.length > 0 ? next : [{ id: newCompetitionClassId(), name: '' }] });
  }

  function applyCompetitionClasses(): void {
    status = null;
    const rows = activeSession()
      .classEditorRows.map((r) => ({
        id: r.id.trim() || newCompetitionClassId(),
        name: r.name.trim(),
      }))
      .filter((r) => r.name.length > 0);
    const c = activeSession().controller;
    const cmdId = `cmd-classes-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const r = c.setTournamentClasses(rows, [], cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not save competition classes';
      pull();
      return;
    }
    const t = c.getTournament();
    patchActiveSession({
      classEditorRows:
        t.classDefinitions.length > 0
          ? t.classDefinitions.map((d) => ({ id: d.id, name: d.name }))
          : [{ id: newCompetitionClassId(), name: '' }],
    });
    status = rows.length >= 2 ? 'Competition classes saved. Use the class tabs for each track.' : 'Competition classes saved.';
    pull();
  }

  function togglePlayerClass(playerId: string, classId: string, checked: boolean): void {
    status = null;
    const c = activeSession().controller;
    const cmdId = `cmd-pcf-${playerId}-${classId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const r = c.setPlayerClassFlags(playerId, { [classId]: checked }, [`cmd-${playerId}`], cmdId);
    if (!r.success) {
      status = r.reason ?? 'Could not update class flags';
    }
    pull();
  }

  pull();
</script>

<div class="app">
  <header class="top-bar">
    <div class="brand">
      <span class="brand-mark">TTC</span>
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
    <div class="banner" role="status">{status}</div>
  {/if}

  <main class="main">
    {#if workspaceTab === 'settings'}
      <section class="card settings-card">
        <h1 class="h1">Tournament settings</h1>
        <p class="lead">
          Export and import the command log (JSONL). Multiple open tournaments will share this area later; for now only one
          tournament tab is available.
        </p>

        <div class="settings-grid">
          <div class="settings-block">
            <h2 class="h2">Data</h2>
            <div class="btn-row">
              <button type="button" class="btn primary" onclick={downloadJsonl}>Export JSONL</button>
              <label class="file-btn">
                Import JSONL
                <input type="file" accept=".jsonl,.txt,application/json,text/plain" class="sr" onchange={onImportFile} />
              </label>
              <button type="button" class="btn danger-ghost" onclick={newTournament}>New empty tournament</button>
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
      <div class="tournament-shell">
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
          <div class="toolbar-actions">
            <button type="button" class="btn ghost" onclick={doUndo} title="Append Undo for latest undoable step">Undo</button>
            <button
              type="button"
              class="btn ghost"
              onclick={doRedo}
              disabled={!activeSession().controller.canRedo()}
              title="Drop last Undo from log"
            >
              Redo
            </button>
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

              <div class="sub-card class-setup">
                <h3 class="h3">Competition classes</h3>
                <p class="muted small">
                  Define one or more parallel tracks (e.g. junior / senior). With <strong>two or more</strong> classes, each
                  class gets its own tab row below. Add classes <strong>before</strong> adding players; with players present you
                  can only rename classes, not add or remove them.
                </p>
                <table class="grid class-grid">
                  <thead>
                    <tr>
                      <th>Display name</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each activeSession().classEditorRows as row, ri (row.id)}
                      <tr>
                        <td>
                          <input
                            class="grow"
                            type="text"
                            value={row.name}
                            maxlength="80"
                            autocomplete="off"
                            aria-label="Class display name"
                            oninput={(e) => updateClassEditorRow(ri, (e.currentTarget as HTMLInputElement).value)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            class="btn ghost small-inline"
                            disabled={tournament.classDefinitions.length >= 2 && Object.keys(tournament.players).length > 0}
                            onclick={() => removeClassEditorRow(ri)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                <div class="row">
                  <button
                    type="button"
                    class="btn"
                    disabled={tournament.classDefinitions.length >= 2 && Object.keys(tournament.players).length > 0}
                    onclick={addClassEditorRow}
                  >
                    Add class row
                  </button>
                  <button type="button" class="btn primary" onclick={applyCompetitionClasses}>Save classes</button>
                </div>
              </div>

              <form
                class="row"
                onsubmit={(e) => {
                  e.preventDefault();
                  addPlayer();
                }}
              >
                <input class="grow" placeholder="Name" bind:value={newName} autocomplete="off" />
                <input class="hc" type="number" bind:value={newHc} min="0" step="1" title="Handicap" />
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
                {#each activeSession().playerOrder as pid (pid)}
                  <li class="player-row">
                    <div class="player-main">
                      <span class="name">{playerLabel(pid)}</span>
                      <span class="hc-wrap">
                        <label class="hc-label" for={`hc-${pid}`}>HC</label>
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
                numbered <strong>1, 2, …</strong> in seeding order. Creating groups also creates all round‑robin matches.
              </p>
              <div class="row group-editor-head">
                <label class="grow">
                  <span class="field-label">Target players per group</span>
                  <input
                    class="grow"
                    type="number"
                    min="1"
                    step="1"
                    value={activeSession().groupTargetSize}
                    aria-label="Target group size"
                    oninput={(e) => {
                      const v = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1));
                      patchActiveSession({ groupTargetSize: v });
                    }}
                  />
                </label>
              </div>
              <p class="field-label">Include in draw (seeding order)</p>
              <div class="group-player-grid">
                {#each eligibleGlobalGroupPlayerIds(tournament) as pid (pid)}
                  <label class="chk tight">
                    <input
                      type="checkbox"
                      checked={!activeSession().groupPlayerExcluded[pid]}
                      onchange={(e) =>
                        toggleGlobalGroupPlayerExcluded(pid, !(e.currentTarget as HTMLInputElement).checked)}
                    />
                    {playerLabel(pid)}
                  </label>
                {:else}
                  <p class="muted small">Add players on the Players tab first.</p>
                {/each}
              </div>
              <div class="row align-end">
                <button type="button" class="btn danger-ghost" onclick={clearGlobalGroups}>Clear groups</button>
                <button type="button" class="btn primary" onclick={createGlobalGroupsAndMatches}>
                  Create groups & matches
                </button>
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
                  {#if match.status === 'scheduled' && scoreDrafts()[match.id]}
                    <table class="mini">
                      <thead>
                        <tr><th>#</th><th>{playerLabel(match.playerA)}</th><th>{playerLabel(match.playerB)}</th></tr>
                      </thead>
                      <tbody>
                        {#each scoreDrafts()[match.id] as srow, gi (gi)}
                          <tr>
                            <td>{gi + 1}</td>
                            <td><input type="number" bind:value={srow.a} /></td>
                            <td><input type="number" bind:value={srow.b} /></td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                    <div class="row">
                      <button type="button" class="btn" onclick={() => addGameRow(match.id)}>Add game row</button>
                      <button type="button" class="btn primary" onclick={() => submitScores(match)}>Save scores</button>
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
                  {#if match.status === 'scheduled' && scoreDrafts()[match.id]}
                    <table class="mini">
                      <thead>
                        <tr><th>#</th><th>{playerLabel(match.playerA)}</th><th>{playerLabel(match.playerB)}</th></tr>
                      </thead>
                      <tbody>
                        {#each scoreDrafts()[match.id] as row, gi (gi)}
                          <tr>
                            <td>{gi + 1}</td>
                            <td><input type="number" bind:value={row.a} /></td>
                            <td><input type="number" bind:value={row.b} /></td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                    <div class="row">
                      <button type="button" class="btn" onclick={() => addGameRow(match.id)}>Add game row</button>
                      <button type="button" class="btn primary" onclick={() => submitScores(match)}>Save scores</button>
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
                  group is that size or one smaller). Groups are numbered 1, 2, …; creating them also creates all
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
                <p class="field-label">Include in draw (class seeding order)</p>
                <div class="group-player-grid">
                  {#each slice.seedings as pid (pid)}
                    <label class="chk tight">
                      <input
                        type="checkbox"
                        checked={!isClassPlayerExcluded(cid, pid)}
                        onchange={(e) =>
                          toggleClassGroupPlayerExcluded(cid, pid, !(e.currentTarget as HTMLInputElement).checked)}
                      />
                      {playerLabel(pid)}
                    </label>
                  {:else}
                    <p class="muted small">No players in this class yet — enable the class checkbox for players first.</p>
                  {/each}
                </div>
                <div class="row align-end">
                  <button type="button" class="btn danger-ghost" onclick={() => clearClassGroups(cid)}>Clear groups</button>
                  <button type="button" class="btn primary" onclick={() => createClassGroupsAndMatches(cid)}>
                    Create groups & matches
                  </button>
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
                    {#if match.status === 'scheduled' && scoreDrafts()[match.id]}
                      <table class="mini">
                        <thead>
                          <tr><th>#</th><th>{playerLabel(match.playerA)}</th><th>{playerLabel(match.playerB)}</th></tr>
                        </thead>
                        <tbody>
                          {#each scoreDrafts()[match.id] as srow, gi (gi)}
                            <tr>
                              <td>{gi + 1}</td>
                              <td><input type="number" bind:value={srow.a} /></td>
                              <td><input type="number" bind:value={srow.b} /></td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                      <div class="row">
                        <button type="button" class="btn" onclick={() => addGameRow(match.id)}>Add game row</button>
                        <button type="button" class="btn primary" onclick={() => submitScores(match)}>Save scores</button>
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
                      {#if match.status === 'scheduled' && scoreDrafts()[match.id]}
                        <table class="mini">
                          <thead>
                            <tr><th>#</th><th>{playerLabel(match.playerA)}</th><th>{playerLabel(match.playerB)}</th></tr>
                          </thead>
                          <tbody>
                            {#each scoreDrafts()[match.id] as row, gi (gi)}
                              <tr>
                                <td>{gi + 1}</td>
                                <td><input type="number" bind:value={row.a} /></td>
                                <td><input type="number" bind:value={row.b} /></td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                        <div class="row">
                          <button type="button" class="btn" onclick={() => addGameRow(match.id)}>Add game row</button>
                          <button type="button" class="btn primary" onclick={() => submitScores(match)}>Save scores</button>
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
    {/if}
  </main>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(165deg, #f1f5f9 0%, #e8eef5 40%, #f8fafc 100%);
    color: #0f172a;
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
    position: sticky;
    top: 0;
    z-index: 20;
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
    background: linear-gradient(135deg, #1d4ed8, #6366f1);
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
    color: #1e40af;
    font-weight: 600;
    box-shadow: 0 1px 3px rgb(15 23 42 / 8%);
  }

  .banner {
    margin: 0 1.25rem;
    padding: 0.55rem 0.85rem;
    border-radius: 0 0 10px 10px;
    background: #e0f2fe;
    border: 1px solid #7dd3fc;
    border-top: none;
    color: #0c4a6e;
    font-size: 0.9rem;
  }

  .main {
    flex: 1;
    width: 100%;
    max-width: 58rem;
    margin: 0 auto;
    padding: 1.25rem 1.25rem 2.5rem;
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

  .title-input:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgb(37 99 235 / 14%);
  }

  .toolbar-actions {
    display: flex;
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
    color: #1d4ed8;
    font-weight: 600;
    background: #fff;
    border-bottom-color: #2563eb;
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

  .group-player-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    margin-top: 0.35rem;
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

  .class-setup {
    margin-bottom: 1rem;
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
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgb(37 99 235 / 12%);
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
    border-color: #2563eb;
    background: #2563eb;
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: #1d4ed8;
    border-color: #1d4ed8;
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
</style>
