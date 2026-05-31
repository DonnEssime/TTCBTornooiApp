<script lang="ts">
  import type { BracketMatch, GroupDefinition, Match, MatchNotesSegment, Tournament } from 'ttc-tornooiapp';
  import { listCompetitionTracks, trackGroupMatches, trackTitle } from 'ttc-tornooiapp';
  import {
    bracketKnockoutRoundParams,
    bracketMatchRound,
    bracketPhaseCountsIncludingFutureRounds,
    bracketPlayerMatchId,
    bracketRoundAggregatesIncludingFutureRounds,
    bracketSlotAwaitingPlay,
    compareBracketMatchId,
    groupPhaseCounts,
    groupCompletionStaggeredOrder,
    inProgressMatchIdsForPlayer,
    matchAssignedTableId,
    matchIdOnTable,
    matchNotesSegmentHasSlips,
    matchNotesSegmentLabel,
    matchPlayersResolvedForBracketPhaseList,
    estimateScheduleWaves,
    matchesOnTablesInAssignmentOrder,
    minWavesAvoidBackToBackOrder,
  } from 'ttc-tornooiapp';
  import PlayerName from './PlayerName.svelte';
  import Msg from './i18n/Msg.svelte';
  import { msgText } from './i18n/msg';
  import { getLocale } from './i18n/locale.svelte';

  let {
    tournament,
    useClassTabs,
    groupDisplayLabel,
    onOpenGroupMatch,
    onOpenBracketSlot,
    onOpenTableMatch,
    onAssignMatchToTable,
    onClearMatchFromTable,
    onPrintMatchNotes,
    tableCount,
    onIncrementTables,
    onDecrementTables,
    showDebugUi = false,
    onDebugSimulateTables,
    onDebugFillReadyTables,
  }: {
    tournament: Tournament;
    useClassTabs: boolean;
    groupDisplayLabel: (g: GroupDefinition) => string;
    tableCount: number;
    onIncrementTables: () => void;
    onDecrementTables: () => void;
    showDebugUi?: boolean;
    onDebugSimulateTables?: () => void;
    onDebugFillReadyTables?: (orderedMatchIds: string[]) => void;
    onOpenGroupMatch: (m: Match) => void;
    onOpenBracketSlot: (bm: BracketMatch) => void;
    onOpenTableMatch: (m: Match) => void;
    onAssignMatchToTable: (matchId: string, tableId: string) => void;
    onClearMatchFromTable: (matchId: string) => void;
    onPrintMatchNotes: (segment: MatchNotesSegment) => void;
  } = $props();

  const DND_MATCH = 'application/x-ttc-match-id';
  const DND_SOURCE = 'application/x-ttc-dnd-source';

  type DndSource = 'ready' | 'table';

  let draggingMatchId = $state<string | null>(null);
  let draggingSource = $state<DndSource | null>(null);
  let dragOverTableId = $state<string | null>(null);
  let dragOverReady = $state(false);
  type ReadyOrderingChoice = 'groupCompletionStaggered' | 'minWavesAvoidBackToBack';
  const READY_ORDERING_KEY = 'ttc.readyOrderingAlgorithm';

  function loadReadyOrderingChoice(): ReadyOrderingChoice {
    if (typeof localStorage === 'undefined') return 'groupCompletionStaggered';
    const stored = localStorage.getItem(READY_ORDERING_KEY);
    return stored === 'minWavesAvoidBackToBack' || stored === 'groupCompletionStaggered'
      ? (stored as ReadyOrderingChoice)
      : 'groupCompletionStaggered';
  }

  let readyOrderingChoice = $state<ReadyOrderingChoice>(loadReadyOrderingChoice());

  function setReadyOrderingChoice(next: ReadyOrderingChoice): void {
    readyOrderingChoice = next;
    lastReadyIds = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(READY_ORDERING_KEY, next);
    }
  }

  function sameIdOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
  }

  function resetDragState(): void {
    draggingMatchId = null;
    draggingSource = null;
    dragOverTableId = null;
    dragOverReady = false;
  }

  type ReadyTableConstraint = {
    hasBusyPlayer: boolean;
    swapTargetTableId: string | null;
    incumbentMatchId: string | null;
  };

  /** When a ready match involves a player already on a table, only that table can accept a drop (swap). */
  function readyMatchTableConstraint(
    t: Tournament,
    matchId: string,
    playerA: string,
    playerB: string,
  ): ReadyTableConstraint {
    const busyTables = new Map<string, string>();
    let hasBusyPlayer = false;
    for (const playerId of [playerA, playerB]) {
      const otherIds = inProgressMatchIdsForPlayer(t, playerId).filter((id) => id !== matchId);
      if (otherIds.length === 0) continue;
      hasBusyPlayer = true;
      const otherMatchId = otherIds[0]!;
      const tableId = matchAssignedTableId(t, otherMatchId);
      if (tableId) busyTables.set(tableId, otherMatchId);
    }
    if (!hasBusyPlayer) {
      return { hasBusyPlayer: false, swapTargetTableId: null, incumbentMatchId: null };
    }
    if (busyTables.size === 1) {
      const [swapTargetTableId, incumbentMatchId] = [...busyTables.entries()][0]!;
      return { hasBusyPlayer: true, swapTargetTableId, incumbentMatchId };
    }
    return { hasBusyPlayer: true, swapTargetTableId: null, incumbentMatchId: null };
  }

  function readyConstraintForMatchId(matchId: string): ReadyTableConstraint | null {
    const m = tournament.matches[matchId];
    if (!m) return null;
    return readyMatchTableConstraint(tournament, matchId, m.playerA, m.playerB);
  }

  const draggingReadyConstraint = $derived.by((): ReadyTableConstraint | null => {
    if (!draggingMatchId || draggingSource !== 'ready') return null;
    return readyConstraintForMatchId(draggingMatchId);
  });

  function tableAcceptsReadyDrag(tableId: string): boolean {
    const c = draggingReadyConstraint;
    if (!c?.hasBusyPlayer) return true;
    return c.swapTargetTableId === tableId;
  }

  function handleDragStart(e: DragEvent, matchId: string, source: DndSource): void {
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData(DND_MATCH, matchId);
    dt.setData(DND_SOURCE, source);
    dt.effectAllowed = 'move';
    draggingMatchId = matchId;
    draggingSource = source;
  }

  function handleDragEnd(): void {
    resetDragState();
  }

  function handleTableDragOver(e: DragEvent, tableId: string): void {
    if (!draggingMatchId) return;
    if (!tableAcceptsReadyDrag(tableId)) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt) dt.dropEffect = 'move';
    dragOverTableId = tableId;
    dragOverReady = false;
  }

  function handleTableDragLeave(tableId: string, e: DragEvent): void {
    if (dragOverTableId !== tableId) return;
    const rel = e.relatedTarget as Node | null;
    const tile = e.currentTarget as HTMLElement;
    if (rel && tile.contains(rel)) return;
    dragOverTableId = null;
  }

  function handleTableDrop(e: DragEvent, tableId: string): void {
    if (!tableAcceptsReadyDrag(tableId)) {
      resetDragState();
      return;
    }
    e.preventDefault();
    const matchId = e.dataTransfer?.getData(DND_MATCH) || draggingMatchId;
    resetDragState();
    if (!matchId) return;
    onAssignMatchToTable(matchId, tableId);
  }

  function handleReadyDragOver(e: DragEvent): void {
    if (draggingSource !== 'table' || !draggingMatchId) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt) dt.dropEffect = 'move';
    dragOverReady = true;
    dragOverTableId = null;
  }

  function handleReadyDragLeave(e: DragEvent): void {
    const rel = e.relatedTarget as Node | null;
    const zone = e.currentTarget as HTMLElement;
    if (rel && zone.contains(rel)) return;
    dragOverReady = false;
  }

  function handleReadyDrop(e: DragEvent): void {
    if (draggingSource !== 'table') {
      resetDragState();
      return;
    }
    e.preventDefault();
    const matchId = e.dataTransfer?.getData(DND_MATCH) || draggingMatchId;
    resetDragState();
    if (!matchId) return;
    onClearMatchFromTable(matchId);
  }

  /** Knockout ready row with a playable scheduled player match (draggable to a table). */
  function readyBracketPlayableMatchId(
    t: Tournament,
    bm: BracketMatch,
    classId: string | undefined,
  ): string | null {
    if (!bracketSlotAwaitingPlay(t, bm)) return null;
    const mid = bracketPlayerMatchId(bm.id);
    const m = t.matches[mid];
    if (!m || m.groupId) return null;
    if (m.status !== 'scheduled' || m.scores.length > 0) return null;
    if (!matchPlayersResolvedForBracketPhaseList(t, m, classId)) return null;
    return mid;
  }

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

  function pct(done: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((100 * done) / total);
  }

  function progressBarAria(done: number, total: number): string {
    void getLocale();
    if (total <= 0) return msgText('ui.ov.noMatches');
    const p = pct(done, total);
    return msgText('ui.ov.progressCompleted', {
      done: String(done),
      total: String(total),
      pct: String(p),
    });
  }

  function segmentPrintAria(segment: MatchNotesSegment): string {
    void getLocale();
    return msgText('ui.matchNotes.printAria', {
      segment: matchNotesSegmentLabel(tournament, segment, getLocale()),
    });
  }

  function canPrintSegment(segment: MatchNotesSegment): boolean {
    void getLocale();
    return matchNotesSegmentHasSlips(tournament, segment, getLocale());
  }

  function groupProgressForMatch(t: Tournament, m: Match): { total: number; done: number } {
    const classScope = m.classId ?? undefined;
    const gm = trackGroupMatches(t, classScope).filter((x) => x.groupId === m.groupId);
    return groupPhaseCounts(gm);
  }

  function groupDefForMatch(t: Tournament, m: Match): GroupDefinition | undefined {
    if (!m.groupId) return undefined;
    if (m.classId) {
      return t.classTournaments[m.classId]?.groups[m.groupId];
    }
    return t.groups[m.groupId];
  }

  /** Sidebar “ready” line: same title as elsewhere (`Group N`), with class when scoped. */
  function readyGroupMatchMeta(t: Tournament, m: Match): string {
    const def = groupDefForMatch(t, m);
    const title = def ? groupDisplayLabel(def) : m.groupId ?? '—';
    if (m.classId) {
      const cname = t.classDefinitions.find((d) => d.id === m.classId)?.name?.trim() || m.classId;
      return `${cname} · ${title}`;
    }
    return title;
  }

  function readyGroupMatches(t: Tournament, classId: string | undefined): Match[] {
    return trackGroupMatches(t, classId)
      .filter((m) => m.status === 'scheduled' && m.scores.length === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Knockout slots still awaiting play: scheduled player rows with both seeds and no scores, or both
   * seeds set but no canonical player row yet (e.g. next round before reconciliation creates rows).
   * Finished or simulated slots are excluded.
   */
  function readyBracketMatches(t: Tournament, bracketMatches: BracketMatch[], classId: string | undefined): BracketMatch[] {
    const out: BracketMatch[] = [];
    for (const bm of bracketMatches) {
      if (!bracketSlotAwaitingPlay(t, bm)) continue;
      const mid = bracketPlayerMatchId(bm.id);
      const m = t.matches[mid];

      const playableScheduled =
        m &&
        !m.groupId &&
        m.status === 'scheduled' &&
        m.scores.length === 0 &&
        matchPlayersResolvedForBracketPhaseList(t, m, classId);
      if (playableScheduled) {
        out.push(bm);
        continue;
      }

      if (!m) {
        out.push(bm);
      }
    }
    return out;
  }

  /** Lower = show first within the same round (scheduled playable before decided / pairing-only). */
  function bracketKnockoutReadyRank(t: Tournament, bm: BracketMatch, classId: string | undefined): number {
    const mid = bracketPlayerMatchId(bm.id);
    const m = t.matches[mid];
    if (
      m &&
      !m.groupId &&
      m.status === 'scheduled' &&
      m.scores.length === 0 &&
      !bm.winner &&
      matchPlayersResolvedForBracketPhaseList(t, m, classId)
    ) {
      return 0;
    }
    return 1;
  }

  type TrackSlice = {
    key: string;
    title: string;
    classId: string | undefined;
    groups: Record<string, GroupDefinition>;
    bracketMatches: BracketMatch[];
  };

  const tracks = $derived.by((): TrackSlice[] => {
    void getLocale();
    const mainLabel = msgText('ui.ov.mainDraw');
    return listCompetitionTracks(tournament).map((tr) => ({
      key: tr.classId ?? 'main',
      title: trackTitle(tournament, tr.classId, mainLabel),
      classId: tr.classId,
      groups: tr.groups,
      bracketMatches: tr.bracketMatches,
    }));
  });

  /** All group matches across classes when multi-tab */
  function allClassGroupMatches(t: Tournament): Match[] {
    return Object.values(t.matches).filter((m) => Boolean(m.groupId && m.classId));
  }

  const aggregateGroupPhase = $derived.by(() => {
    if (!useClassTabs) return groupPhaseCounts(trackGroupMatches(tournament, undefined));
    return groupPhaseCounts(allClassGroupMatches(tournament));
  });

  const aggregateBracketPhase = $derived.by(() => {
    if (!useClassTabs) return bracketPhaseCountsIncludingFutureRounds(tournament.bracketMatches);
    let total = 0;
    let done = 0;
    for (const tr of tracks) {
      const c = bracketPhaseCountsIncludingFutureRounds(tr.bracketMatches);
      total += c.total;
      done += c.done;
    }
    return { total, done };
  });

  const readyGroupsAll = $derived.by(() => {
    const list: Match[] = [];
    for (const tr of tracks) {
      list.push(...readyGroupMatches(tournament, tr.classId));
    }
    switch (readyOrderingChoice) {
      case 'groupCompletionStaggered':
      default:
        return groupCompletionStaggeredOrder(list, (m) => groupProgressForMatch(tournament, m));
    }
  });

  function matchOnTable(tableId: string): Match | undefined {
    const mid = matchIdOnTable(tournament, tableId);
    return mid ? tournament.matches[mid] : undefined;
  }

  const readyBracketsAll = $derived.by(() => {
    void getLocale();
    const list: Array<{ bm: BracketMatch; meta: string; classId: string | undefined }> = [];
    for (const tr of tracks) {
      for (const bm of readyBracketMatches(tournament, tr.bracketMatches, tr.classId)) {
        const r = bracketMatchRound(bm);
        const roundParams = bracketKnockoutRoundParams(getLocale(), r, tr.bracketMatches);
        const meta =
          tr.classId !== undefined
            ? msgText('ui.ov.readyBracketMetaClass', { track: tr.title, ...roundParams })
            : msgText('ui.ov.bracketRound', roundParams);
        list.push({ bm, meta, classId: tr.classId });
      }
    }
    list.sort((a, b) => {
      const ra = bracketMatchRound(a.bm);
      const rb = bracketMatchRound(b.bm);
      if (ra !== rb) return ra - rb;
      const sa = bracketKnockoutReadyRank(tournament, a.bm, a.classId);
      const sb = bracketKnockoutReadyRank(tournament, b.bm, b.classId);
      if (sa !== sb) return sa - sb;
      return compareBracketMatchId(a.bm, b.bm);
    });
    return list;
  });

  type ReadyDisplayEntry =
    | { kind: 'group'; match: Match }
    | { kind: 'bracket'; bm: BracketMatch; meta: string; classId: string | undefined; matchId: string };

  // Warm-start tie-break hint. Must NOT be $state — a reactive write would loop with $derived below.
  let lastReadyIds: string[] = [];

  const readyMatchIdsAllOrdered = $derived.by((): string[] => {
    const ids: string[] = [];
    for (const m of readyGroupsAll) ids.push(m.id);
    for (const item of readyBracketsAll) {
      const mid = readyBracketPlayableMatchId(tournament, item.bm, item.classId);
      if (mid) ids.push(mid);
    }

    if (readyOrderingChoice !== 'minWavesAvoidBackToBack') {
      return ids;
    }

    const readyMatches: Match[] = [];
    for (const id of ids) {
      const m = tournament.matches[id];
      if (m) readyMatches.push(m);
    }

    const pastFinished: Match[] = [];
    for (const mid of tournament.matchFinishOrder ?? []) {
      const m = tournament.matches[mid];
      if (m) pastFinished.push(m);
    }

    const inProgress = matchesOnTablesInAssignmentOrder(tournament);

    const ordered = minWavesAvoidBackToBackOrder(readyMatches, {
      tableCount: tournament.tables.length,
      pastFinishedInOrder: pastFinished,
      inProgressInAssignmentOrder: inProgress,
      preferredReadyOrderIds: lastReadyIds,
    });
    return ordered.map((m) => m.id);
  });

  // Remember the last computed order for the next tournament-state change (non-reactive write).
  $effect(() => {
    const ids = readyMatchIdsAllOrdered;
    if (ids.length === 0 || sameIdOrder(ids, lastReadyIds)) return;
    lastReadyIds = ids;
  });

  /** Ready queue in display order (single list mirrors optimizer / wave estimate). */
  const readyAllDisplay = $derived.by((): ReadyDisplayEntry[] => {
    const groupById = new Map(readyGroupsAll.map((m) => [m.id, m] as const));
    const bracketByMatchId = new Map<string, { bm: BracketMatch; meta: string; classId: string | undefined }>();
    for (const item of readyBracketsAll) {
      const mid = readyBracketPlayableMatchId(tournament, item.bm, item.classId);
      if (mid) bracketByMatchId.set(mid, item);
    }

    const out: ReadyDisplayEntry[] = [];
    for (const id of readyMatchIdsAllOrdered) {
      const group = groupById.get(id);
      if (group) {
        out.push({ kind: 'group', match: group });
        continue;
      }
      const bracket = bracketByMatchId.get(id);
      if (bracket) {
        out.push({ kind: 'bracket', ...bracket, matchId: id });
      }
    }
    return out;
  });

  const readyScheduleSlots = $derived.by(() => {
    const slots: Array<{ playerA: string; playerB: string }> = [];
    for (const mid of readyMatchIdsAllOrdered) {
      const m = tournament.matches[mid];
      if (!m) continue;
      slots.push({ playerA: m.playerA, playerB: m.playerB });
    }
    return slots;
  });

  const readyScheduleWaveEstimate = $derived.by(() =>
    estimateScheduleWaves(readyScheduleSlots, tournament.tables.length),
  );

  function debugFillEmptyTables(): void {
    onDebugFillReadyTables?.(readyMatchIdsAllOrdered);
  }
</script>

<div class="ov">
  <div class="ov-main">
    <section class="ov-card ov-tables-card">
      <div class="ov-tables-head">
        <h3 class="ov-h"><Msg key="ui.tables" /></h3>
        {#if showDebugUi}
          <button type="button" class="ov-debug-btn" onclick={() => onDebugSimulateTables?.()}>
            <Msg key="ui.ov.debugSimulateTables" />
          </button>
        {/if}
      </div>
      {#if tournament.tables.length > 0}
        <p class="muted small ov-dnd-hint"><Msg key="ui.ov.dndHint" tag="p" class="muted small ov-dnd-hint" /></p>
      {/if}
      {#if tournament.tables.length === 0}
        <p class="muted small"><Msg key="ui.ov.noTablesHint" tag="p" class="muted small" /></p>
      {:else}
        <div class="ov-table-grid" role="list" aria-label={msgText('ui.tournament_tables')}>
          {#each tournament.tables as tableId (tableId)}
            {@const tm = matchOnTable(tableId)}
            {@const constrainedReadyDrag = draggingReadyConstraint?.hasBusyPlayer === true}
            {@const swapTargetTableId = draggingReadyConstraint?.swapTargetTableId ?? null}
            {@const tableDimmed =
              constrainedReadyDrag && (swapTargetTableId === null || swapTargetTableId !== tableId)}
            {@const tableSwapTarget = constrainedReadyDrag && swapTargetTableId === tableId}
            <div
              class="ov-table-tile"
              class:ov-table-busy={Boolean(tm)}
              class:ov-table-dimmed={tableDimmed}
              class:ov-table-swap-target={tableSwapTarget}
              class:ov-drop-highlight={dragOverTableId === tableId && tableAcceptsReadyDrag(tableId)}
              role="listitem"
              ondragover={(e) => handleTableDragOver(e, tableId)}
              ondragleave={(e) => handleTableDragLeave(tableId, e)}
              ondrop={(e) => handleTableDrop(e, tableId)}
            >
              <div class="ov-table-num"><Msg key="ui.ov.tableLabel" params={{ id: tableId }} /></div>
              {#if tm}
                <div
                  class="ov-table-match-drag ov-table-match-btn"
                  draggable="true"
                  class:ov-dragging={draggingMatchId === tm.id}
                  class:ov-swap-incumbent={draggingReadyConstraint?.incumbentMatchId === tm.id}
                  role="button"
                  tabindex="0"
                  aria-label={msgText('ui.ov.matchOnTableAria', { table: tableId })}
                  ondragstart={(e) => handleDragStart(e, tm.id, 'table')}
                  ondragend={handleDragEnd}
                  onclick={() => onOpenTableMatch(tm)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenTableMatch(tm);
                    }
                  }}
                >
                  <span class="ov-table-match-pair">
                    <PlayerName {tournament} playerId={tm.playerA} tag="strong" />
                    <Msg key="ui.ov.vs" tag="span" />
                    <PlayerName {tournament} playerId={tm.playerB} tag="strong" />
                  </span>
                  <span class="muted small"><Msg key="ui.in_progress" /></span>
                </div>
              {:else}
                <p class="ov-table-free muted small"><Msg key="ui.free" /></p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section
      class="ov-card ov-card-main"
      class:ov-ready-drop-highlight={dragOverReady}
      ondragover={handleReadyDragOver}
      ondragleave={handleReadyDragLeave}
      ondrop={handleReadyDrop}
    >
      <div class="ov-ready-head">
        <h3 class="ov-h"><Msg key="ui.ready_to_play" /></h3>
        <label class="ov-ordering-row">
          <span class="muted small"><Msg key="ui.ov.orderingLabel" /></span>
          <select
            class="ov-ordering-select"
            value={readyOrderingChoice}
            onchange={(e) => setReadyOrderingChoice((e.currentTarget as HTMLSelectElement).value as ReadyOrderingChoice)}
          >
            <option value="groupCompletionStaggered"><Msg key="ui.ov.ordering.groupCompletionStaggered" /></option>
            <option value="minWavesAvoidBackToBack"><Msg key="ui.ov.ordering.minWavesAvoidBackToBack" /></option>
          </select>
        </label>
        {#if showDebugUi}
          <button type="button" class="ov-debug-btn" onclick={debugFillEmptyTables}>
            <Msg key="ui.ov.debugFillTables" />
          </button>
        {/if}
      </div>
      {#if readyAllDisplay.length > 0}
        {#if tournament.tables.length > 0 && readyScheduleSlots.length > 0}
          <p class="muted small ov-waves-estimate">
            <Msg
              key="ui.ov.scheduleWavesEstimate"
              params={{
                waves: String(readyScheduleWaveEstimate),
                count: String(readyScheduleSlots.length),
                tables: String(tournament.tables.length),
              }}
            />
          </p>
        {:else if readyScheduleSlots.length > 0}
          <p class="muted small ov-waves-estimate">
            <Msg key="ui.ov.scheduleWavesNoTables" />
          </p>
        {/if}
      {/if}
      {#if readyAllDisplay.length === 0}
        <p class="muted small"><Msg key="ui.ov.nothingToHighlight" tag="p" class="muted small" /></p>
      {:else}
        <ul class="ov-ready-list">
          {#each readyAllDisplay as entry (entry.kind === 'group' ? entry.match.id : entry.bm.id)}
            {#if entry.kind === 'group'}
              {@const m = entry.match}
              {@const readyConstraint = readyMatchTableConstraint(tournament, m.id, m.playerA, m.playerB)}
              <li
                class="ov-ready-item"
                draggable="true"
                class:ov-ready-busy={readyConstraint.hasBusyPlayer}
                class:ov-dragging={draggingMatchId === m.id}
                ondragstart={(e) => handleDragStart(e, m.id, 'ready')}
                ondragend={handleDragEnd}
              >
                <button type="button" class="ov-ready-btn" onclick={() => onOpenGroupMatch(m)}>
                  <span class="ov-ready-pair"
                    ><PlayerName {tournament} playerId={m.playerA} tag="strong" />
                    <Msg key="ui.ov.vs" tag="span" />
                    <PlayerName {tournament} playerId={m.playerB} tag="strong" /></span
                  >
                  <span class="muted small ov-ready-meta">{readyGroupMatchMeta(tournament, m)}</span>
                </button>
              </li>
            {:else}
              {@const bracketMid = entry.matchId}
              {@const bracketMatch = tournament.matches[bracketMid]}
              {@const readyConstraint =
                bracketMatch
                  ? readyMatchTableConstraint(tournament, bracketMid, bracketMatch.playerA, bracketMatch.playerB)
                  : { hasBusyPlayer: false, swapTargetTableId: null, incumbentMatchId: null }}
              <li
                class="ov-ready-item"
                class:ov-ready-not-draggable={!bracketMatch}
                class:ov-ready-busy={readyConstraint.hasBusyPlayer}
                draggable={Boolean(bracketMatch)}
                class:ov-dragging={draggingMatchId === bracketMid}
                ondragstart={(e) => handleDragStart(e, bracketMid, 'ready')}
                ondragend={handleDragEnd}
              >
                <button type="button" class="ov-ready-btn" onclick={() => onOpenBracketSlot(entry.bm)}>
                  <span class="ov-ready-pair"
                    ><PlayerName {tournament} playerId={entry.bm.seedA!} tag="strong" />
                    <Msg key="ui.ov.vs" tag="span" />
                    <PlayerName {tournament} playerId={entry.bm.seedB!} tag="strong" /></span
                  >
                  <span class="muted small ov-ready-meta">{entry.meta}</span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <aside class="ov-sidebar" aria-label="Tournament progress">
    <section class="ov-card ov-sidebar-card ov-players-tables-card">
      <div class="ov-players-tables-split">
        <div class="ov-split-metric">
          <h3 class="ov-h"><Msg key="ui.players" /></h3>
          <p class="ov-count">{Object.keys(tournament.players).length}</p>
          <p class="ov-count-caption muted small"><Msg key="ui.in_this_tournament" /></p>
        </div>
        <div class="ov-split-metric ov-split-tables">
          <h3 class="ov-h"><Msg key="ui.settings.tablesLabel" /></h3>
          <div class="ov-table-stepper" role="group" aria-label={msgText('ui.number_of_tables')}>
            <p class="ov-count" aria-live="polite">{tableCount}</p>
            <div class="ov-stepper-btns">
              <button
                type="button"
                class="ov-stepper-btn"
                aria-label={msgText('ui.increase_number_of_tables')}
                disabled={tableCount >= 32}
                onclick={() => onIncrementTables()}
              >
                ▲
              </button>
              <button
                type="button"
                class="ov-stepper-btn"
                aria-label={msgText('ui.decrease_number_of_tables')}
                disabled={tableCount <= 1}
                onclick={() => onDecrementTables()}
              >
                ▼
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="ov-card ov-sidebar-card">
      <h3 class="ov-h"><Msg key="ui.group_phase" /></h3>
      {#if aggregateGroupPhase.total === 0}
        <p class="muted small"><Msg key="ui.no_group_matches_yet_create_groups_on_the_group_" /></p>
      {:else}
        <button
          type="button"
          class="ov-metric-btn ov-metric"
          disabled={!canPrintSegment({ kind: 'group-overall' })}
          aria-label={segmentPrintAria({ kind: 'group-overall' })}
          onclick={() => onPrintMatchNotes({ kind: 'group-overall' })}
        >
          <div class="ov-metric-top">
            <span class="ov-metric-label"><Msg key="ui.overall" /></span>
            <span class="ov-progress-meta" title={progressBarAria(aggregateGroupPhase.done, aggregateGroupPhase.total)}>
              <span class="ov-match-ratio">
                <Msg
                  key="ui.ov.matchesRatio"
                  params={{
                    done: String(aggregateGroupPhase.done),
                    total: String(aggregateGroupPhase.total),
                  }}
                />
              </span>
              <span class="ov-progress-spacer" aria-hidden="true"></span>
              <span class="ov-pct">{pct(aggregateGroupPhase.done, aggregateGroupPhase.total)}%</span>
            </span>
          </div>
          <div
            class="ov-track"
            role="progressbar"
            aria-valuenow={aggregateGroupPhase.total > 0 ? aggregateGroupPhase.done : 0}
            aria-valuemin="0"
            aria-valuemax={Math.max(1, aggregateGroupPhase.total)}
            aria-label={progressBarAria(aggregateGroupPhase.done, aggregateGroupPhase.total)}
          >
            <div class="ov-fill" style={`width: ${pct(aggregateGroupPhase.done, aggregateGroupPhase.total)}%`}></div>
          </div>
        </button>
        <div class="ov-sub">
          {#each tracks as tr (tr.key)}
            {#each sortGroupsForDisplay(tr.groups) as g (g.id)}
              {@const gm = trackGroupMatches(tournament, tr.classId).filter((m) => m.groupId === g.id)}
              {@const c = groupPhaseCounts(gm)}
              {#if c.total > 0}
                {@const poolSegment = { kind: 'group-pool', classId: tr.classId, groupId: g.id } as const}
                <button
                  type="button"
                  class="ov-metric-btn ov-metric ov-metric-sub"
                  disabled={!canPrintSegment(poolSegment)}
                  aria-label={segmentPrintAria(poolSegment)}
                  onclick={() => onPrintMatchNotes(poolSegment)}
                >
                  <div class="ov-metric-top">
                    <span class="ov-metric-label" title={`${tr.title} · ${groupDisplayLabel(g)}`}>{tr.title} · {groupDisplayLabel(g)}</span>
                    <span class="ov-progress-meta" title={progressBarAria(c.done, c.total)}>
                      <span class="ov-match-ratio">
                        <Msg key="ui.ov.matchesRatio" params={{ done: String(c.done), total: String(c.total) }} />
                      </span>
                      <span class="ov-progress-spacer" aria-hidden="true"></span>
                      <span class="ov-pct">{pct(c.done, c.total)}%</span>
                    </span>
                  </div>
                  <div
                    class="ov-track ov-track-sub"
                    role="progressbar"
                    aria-valuenow={c.total > 0 ? c.done : 0}
                    aria-valuemin="0"
                    aria-valuemax={Math.max(1, c.total)}
                    aria-label={progressBarAria(c.done, c.total)}
                  >
                    <div class="ov-fill ov-fill-sub" style={`width: ${pct(c.done, c.total)}%`}></div>
                  </div>
                </button>
              {/if}
            {/each}
          {/each}
        </div>
      {/if}
    </section>

    <section class="ov-card ov-sidebar-card">
      <h3 class="ov-h"><Msg key="ui.bracket_phase" /></h3>
      {#if aggregateBracketPhase.total === 0}
        <p class="muted small"><Msg key="ui.no_knockout_bracket_yet_create_it_on_the_bracket" /></p>
      {:else}
        <div class="ov-metric">
          <div class="ov-metric-top">
            <span class="ov-metric-label"><Msg key="ui.overall" /></span>
            <span class="ov-progress-meta" title={progressBarAria(aggregateBracketPhase.done, aggregateBracketPhase.total)}>
              <span class="ov-match-ratio">
                <Msg
                  key="ui.ov.matchesRatio"
                  params={{
                    done: String(aggregateBracketPhase.done),
                    total: String(aggregateBracketPhase.total),
                  }}
                />
              </span>
              <span class="ov-progress-spacer" aria-hidden="true"></span>
              <span class="ov-pct">{pct(aggregateBracketPhase.done, aggregateBracketPhase.total)}%</span>
            </span>
          </div>
          <div
            class="ov-track"
            role="progressbar"
            aria-valuenow={aggregateBracketPhase.total > 0 ? aggregateBracketPhase.done : 0}
            aria-valuemin="0"
            aria-valuemax={Math.max(1, aggregateBracketPhase.total)}
            aria-label={progressBarAria(aggregateBracketPhase.done, aggregateBracketPhase.total)}
          >
            <div class="ov-fill ov-fill-bracket" style={`width: ${pct(aggregateBracketPhase.done, aggregateBracketPhase.total)}%`}></div>
          </div>
        </div>
        <div class="ov-sub">
          {#each tracks as tr (tr.key)}
            {#if tr.bracketMatches.length > 0}
              {#each bracketRoundAggregatesIncludingFutureRounds(tr.bracketMatches) as row (row.round)}
                {@const roundSegment = { kind: 'bracket-round', classId: tr.classId, round: row.round } as const}
                <button
                  type="button"
                  class="ov-metric-btn ov-metric ov-metric-sub"
                  disabled={!canPrintSegment(roundSegment)}
                  aria-label={segmentPrintAria(roundSegment)}
                  onclick={() => onPrintMatchNotes(roundSegment)}
                >
                  <div class="ov-metric-top">
                    <span class="ov-metric-label"
                      >{tr.title} · {bracketKnockoutRoundParams(getLocale(), row.round, tr.bracketMatches).round}</span
                    >
                    <span class="ov-progress-meta" title={progressBarAria(row.done, row.total)}>
                      <span class="ov-match-ratio">
                        <Msg key="ui.ov.matchesRatio" params={{ done: String(row.done), total: String(row.total) }} />
                      </span>
                      <span class="ov-progress-spacer" aria-hidden="true"></span>
                      <span class="ov-pct">{pct(row.done, row.total)}%</span>
                    </span>
                  </div>
                  <div
                    class="ov-track ov-track-sub"
                    role="progressbar"
                    aria-valuenow={row.total > 0 ? row.done : 0}
                    aria-valuemin="0"
                    aria-valuemax={Math.max(1, row.total)}
                    aria-label={progressBarAria(row.done, row.total)}
                  >
                    <div class="ov-fill ov-fill-bracket ov-fill-sub" style={`width: ${pct(row.done, row.total)}%`}></div>
                  </div>
                </button>
              {/each}
            {/if}
          {/each}
        </div>
      {/if}
    </section>
  </aside>
</div>

<style>
  .ov {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(14rem, 19rem);
    gap: 1rem;
    align-items: start;
  }

  .ov-main {
    min-width: 0;
  }

  .ov-sidebar {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    position: sticky;
    top: 0.75rem;
  }

  @media (max-width: 52rem) {
    .ov {
      grid-template-columns: 1fr;
    }

    .ov-sidebar {
      position: static;
    }
  }

  .ov-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.85rem 1rem;
    background: #fff;
  }

  .ov-tables-card {
    margin-bottom: 0.75rem;
  }

  .ov-tables-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.65rem;
  }

  .ov-tables-head .ov-h {
    margin-bottom: 0;
  }

  .ov-ready-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .ov-ready-head .ov-h {
    margin-bottom: 0;
  }

  .ov-ordering-row {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .ov-ordering-select {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.22rem 0.4rem;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #fff;
    color: #0f172a;
  }

  .ov-waves-estimate {
    margin: 0 0 0.65rem;
  }

  .ov-debug-btn {
    flex-shrink: 0;
    font-size: 0.78rem;
    padding: 0.28rem 0.55rem;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #f8fafc;
    color: #475569;
    cursor: pointer;
    font: inherit;
  }

  .ov-debug-btn:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }

  .ov-dnd-hint {
    margin: 0 0 0.5rem;
  }

  .ov-table-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.55rem;
  }

  .ov-table-tile {
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.55rem 0.6rem;
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    min-height: 5.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .ov-table-tile.ov-table-busy {
    border-color: #0d9488;
    background: linear-gradient(180deg, #f0fdfa 0%, #ccfbf1 40%, #f0fdfa 100%);
    box-shadow: 0 0 0 1px rgba(13, 148, 136, 0.15);
  }

  .ov-table-tile.ov-drop-highlight {
    border-color: #0d9488;
    box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.35);
  }

  .ov-table-tile.ov-table-dimmed {
    opacity: 0.38;
    filter: grayscale(0.35);
    pointer-events: none;
  }

  .ov-table-tile.ov-table-swap-target {
    border-color: #0d9488;
    box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.4);
  }

  .ov-table-match-drag.ov-swap-incumbent {
    background: rgba(255, 255, 255, 0.9);
    box-shadow: inset 0 0 0 2px rgba(13, 148, 136, 0.55);
    border-radius: 6px;
  }

  .ov-card-main.ov-ready-drop-highlight {
    box-shadow: inset 0 0 0 2px rgba(13, 148, 136, 0.45);
    border-color: #0d9488;
  }

  .ov-table-num {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
  }

  .ov-table-busy .ov-table-num {
    color: #0f766e;
  }

  .ov-table-free {
    margin: auto 0 0;
    text-align: center;
  }

  .ov-table-match-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.2rem;
    margin: 0;
    padding: 0.35rem 0.25rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    font: inherit;
    text-align: center;
    cursor: pointer;
    color: inherit;
  }

  .ov-table-match-btn:hover {
    background: rgba(255, 255, 255, 0.65);
  }

  .ov-table-match-drag {
    cursor: grab;
  }

  .ov-table-match-drag:active {
    cursor: grabbing;
  }

  .ov-ready-item {
    cursor: grab;
    list-style: none;
  }

  .ov-ready-item.ov-ready-not-draggable {
    cursor: default;
  }

  .ov-ready-item.ov-ready-busy:not(.ov-dragging) .ov-ready-btn {
    opacity: 0.55;
    background: #f1f5f9;
    border-color: #e2e8f0;
  }

  .ov-ready-item.ov-ready-busy:not(.ov-dragging) .ov-ready-btn:hover {
    border-color: #cbd5e1;
    background: #eef2f6;
  }

  .ov-ready-item.ov-dragging,
  .ov-table-match-drag.ov-dragging {
    opacity: 0.55;
  }

  .ov-ready-item:active {
    cursor: grabbing;
  }

  .ov-table-match-pair {
    font-size: 0.78rem;
    line-height: 1.25;
  }

  .ov-card-main {
    min-height: 4rem;
  }

  .ov-sidebar-card {
    padding: 0.75rem 0.85rem;
  }

  .ov-players-tables-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem 0.5rem;
    align-items: start;
  }

  .ov-split-metric {
    min-width: 0;
  }

  .ov-split-metric .ov-h {
    margin-bottom: 0.35rem;
  }

  .ov-table-stepper {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .ov-table-stepper .ov-count {
    margin: 0;
    min-width: 1.5ch;
  }

  .ov-stepper-btns {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .ov-stepper-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.35rem;
    padding: 0;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    background: #fff;
    font-size: 0.62rem;
    line-height: 1;
    color: #334155;
    cursor: pointer;
  }

  .ov-stepper-btn:hover:not(:disabled) {
    border-color: #0d9488;
    background: #f0fdfa;
    color: #0f766e;
  }

  .ov-stepper-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ov-h {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    color: #0f172a;
  }

  .ov-sidebar-card .ov-h {
    font-size: 0.92rem;
    margin-bottom: 0.4rem;
  }

  .ov-h4 {
    margin: 0.75rem 0 0.35rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .ov-h4:first-of-type {
    margin-top: 0;
  }

  .ov-count {
    margin: 0;
    font-size: 1.85rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: #0f172a;
    letter-spacing: -0.02em;
  }

  .ov-count-caption {
    margin: 0.15rem 0 0;
  }

  .ov-metric-btn {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0.2rem 0.15rem;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    font: inherit;
    text-align: inherit;
    color: inherit;
    cursor: pointer;
  }

  .ov-metric-btn:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #e2e8f0;
  }

  .ov-metric-btn:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }

  .ov-metric-btn:disabled {
    cursor: default;
    opacity: 0.85;
  }

  .ov-metric {
    margin-top: 0.35rem;
  }

  .ov-metric-btn.ov-metric:first-of-type {
    margin-top: 0;
  }

  .ov-metric-sub {
    margin-top: 0.45rem;
  }

  .ov-metric-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.2rem;
  }

  .ov-metric-label {
    font-size: 0.75rem;
    color: #475569;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .ov-track {
    height: 0.65rem;
    border-radius: 999px;
    background: #e2e8f0;
    overflow: hidden;
  }

  .ov-track-sub {
    height: 0.5rem;
  }

  .ov-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #0d9488, #14b8a6);
    transition: width 0.2s ease;
  }

  .ov-fill-bracket {
    background: linear-gradient(90deg, #475569, #64748b);
  }

  .ov-fill-sub {
    opacity: 0.92;
  }

  .ov-pct {
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: #334155;
    font-weight: 600;
    flex: 0 0 auto;
  }

  .ov-progress-meta {
    display: flex;
    align-items: baseline;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 72%;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .ov-match-ratio {
    flex: 0 0 auto;
    color: #64748b;
    font-weight: 500;
    white-space: nowrap;
  }

  .ov-progress-spacer {
    flex: 1 1 auto;
    min-width: 1rem;
    max-width: 4.5rem;
  }

  .ov-sub {
    margin-top: 0.45rem;
    padding-left: 0.35rem;
    border-left: 2px solid #e2e8f0;
  }

  .ov-ready-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ov-ready-list .ov-ready-item {
    margin: 0;
    padding: 0;
  }

  .ov-ready-btn {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.35rem 0.75rem;
    width: 100%;
    margin: 0.25rem 0 0;
    padding: 0.45rem 0.55rem;
    text-align: left;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #f8fafc;
    font: inherit;
    cursor: pointer;
    color: inherit;
  }

  .ov-ready-btn:hover {
    border-color: #0d9488;
    background: #f0fdfa;
  }

  .ov-ready-pair {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.88rem;
  }

  .ov-ready-meta {
    flex: 0 0 auto;
    text-align: right;
  }

  .muted {
    color: #64748b;
  }

  .small {
    font-size: 0.8rem;
  }
</style>
