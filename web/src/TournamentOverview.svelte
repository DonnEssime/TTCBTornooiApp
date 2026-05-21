<script lang="ts">
  import type { BracketMatch, GroupDefinition, Match, Tournament } from 'ttc-tornooiapp';
  import {
    bracketMatchRound,
    bracketPhaseCountsIncludingFutureRounds,
    bracketPlayerMatchId,
    bracketRoundAggregatesIncludingFutureRounds,
    compareBracketMatchId,
    matchIdOnTable,
    matchPlayersResolvedForBracketPhaseList,
  } from 'ttc-tornooiapp';
  import PlayerName from './PlayerName.svelte';

  let {
    tournament,
    useClassTabs,
    groupDisplayLabel,
    onOpenGroupMatch,
    onOpenBracketSlot,
    onOpenTableMatch,
    onAssignMatchToTable,
    onClearMatchFromTable,
    tableCount,
    onIncrementTables,
    onDecrementTables,
  }: {
    tournament: Tournament;
    useClassTabs: boolean;
    groupDisplayLabel: (g: GroupDefinition) => string;
    tableCount: number;
    onIncrementTables: () => void;
    onDecrementTables: () => void;
    onOpenGroupMatch: (m: Match) => void;
    onOpenBracketSlot: (bm: BracketMatch) => void;
    onOpenTableMatch: (m: Match) => void;
    onAssignMatchToTable: (matchId: string, tableId: string) => void;
    onClearMatchFromTable: (matchId: string) => void;
  } = $props();

  const DND_MATCH = 'application/x-ttc-match-id';
  const DND_SOURCE = 'application/x-ttc-dnd-source';

  type DndSource = 'ready' | 'table';

  let draggingMatchId = $state<string | null>(null);
  let draggingSource = $state<DndSource | null>(null);
  let dragOverTableId = $state<string | null>(null);
  let dragOverReady = $state(false);

  function resetDragState(): void {
    draggingMatchId = null;
    draggingSource = null;
    dragOverTableId = null;
    dragOverReady = false;
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
    if (bm.winner) return null;
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

  function groupMatchesFiltered(t: Tournament, classId: string | undefined): Match[] {
    return Object.values(t.matches).filter((m) => {
      if (!m.groupId) return false;
      if (classId === undefined) return !m.classId;
      return m.classId === classId;
    });
  }

  function groupMatchFinished(m: Match): boolean {
    return m.status === 'finished' && Boolean(m.winner);
  }

  function groupPhaseCounts(matches: Match[]): { total: number; done: number } {
    let total = 0;
    let done = 0;
    for (const m of matches) {
      total++;
      if (groupMatchFinished(m)) done++;
    }
    return { total, done };
  }

  function pct(done: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((100 * done) / total);
  }

  function progressBarAria(done: number, total: number): string {
    if (total <= 0) return 'No matches';
    const p = pct(done, total);
    return `${done} of ${total} matches completed, ${p} percent`;
  }

  /** Stable key for (competition class × group) when staggering ready group matches. */
  function groupReadyStaggerKey(m: Match): string {
    return `${m.classId ?? ''}\t${m.groupId ?? ''}`;
  }

  /**
   * Order ready group matches so groups stay in step: repeatedly pick a match from the group whose
   * **simulated** completion ratio is lowest, assuming each previously chosen match is already done
   * (increment simulated `done` for that group only).
   */
  function simulatedStaggeredGroupReadyOrder(t: Tournament, matches: Match[]): Match[] {
    if (matches.length <= 1) return [...matches];
    const rem = [...matches];
    const totals = new Map<string, { total: number; simDone: number }>();
    for (const m of matches) {
      const k = groupReadyStaggerKey(m);
      if (!totals.has(k)) {
        const classScope = m.classId ?? undefined;
        const gm = groupMatchesFiltered(t, classScope).filter((x) => x.groupId === m.groupId);
        const { done, total } = groupPhaseCounts(gm);
        totals.set(k, { total, simDone: done });
      }
    }
    const out: Match[] = [];
    while (rem.length > 0) {
      let bestIdx = 0;
      let bestRatio = Infinity;
      let bestId = '\uffff';
      for (let i = 0; i < rem.length; i++) {
        const m = rem[i]!;
        const rec = totals.get(groupReadyStaggerKey(m))!;
        const ratio = rec.total <= 0 ? 0 : rec.simDone / rec.total;
        const id = m.id;
        if (ratio < bestRatio || (ratio === bestRatio && id.localeCompare(bestId) < 0)) {
          bestRatio = ratio;
          bestId = id;
          bestIdx = i;
        }
      }
      const picked = rem.splice(bestIdx, 1)[0]!;
      out.push(picked);
      totals.get(groupReadyStaggerKey(picked))!.simDone += 1;
    }
    return out;
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
    return groupMatchesFiltered(t, classId)
      .filter((m) => m.status === 'scheduled' && m.scores.length === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Knockout slots to surface on the overview: (1) scheduled player matches with both seeds and no
   * scores (unchanged); (2) bracket rows already decided (`winner` or finished player row); (3) both
   * seeds set but no canonical player row yet (e.g. materialized next round before `ensureBracketPhase`
   * runs). Sorted later by round, then actionable rows first.
   */
  function readyBracketMatches(t: Tournament, bracketMatches: BracketMatch[], classId: string | undefined): BracketMatch[] {
    const out: BracketMatch[] = [];
    for (const bm of bracketMatches) {
      if (!bm.seedA || !bm.seedB) continue;
      const mid = bracketPlayerMatchId(bm.id);
      const m = t.matches[mid];

      const playerFinished = Boolean(m && !m.groupId && m.status === 'finished' && m.winner);
      const bracketDecided = Boolean(bm.winner);
      if (bracketDecided || playerFinished) {
        out.push(bm);
        continue;
      }

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

      if (!bm.winner && !m) {
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
    if (!useClassTabs) {
      return [
        {
          key: 'main',
          title: 'Main draw',
          classId: undefined,
          groups: tournament.groups,
          bracketMatches: tournament.bracketMatches,
        },
      ];
    }
    const out: TrackSlice[] = [];
    for (const def of tournament.classDefinitions) {
      const sl = tournament.classTournaments[def.id];
      out.push({
        key: def.id,
        title: def.name?.trim() || def.id,
        classId: def.id,
        groups: sl?.groups ?? {},
        bracketMatches: sl?.bracketMatches ?? [],
      });
    }
    return out;
  });

  /** All group matches across classes when multi-tab */
  function allClassGroupMatches(t: Tournament): Match[] {
    return Object.values(t.matches).filter((m) => Boolean(m.groupId && m.classId));
  }

  const aggregateGroupPhase = $derived.by(() => {
    if (!useClassTabs) return groupPhaseCounts(groupMatchesFiltered(tournament, undefined));
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
    return simulatedStaggeredGroupReadyOrder(tournament, list);
  });

  function matchOnTable(tableId: string): Match | undefined {
    const mid = matchIdOnTable(tournament, tableId);
    return mid ? tournament.matches[mid] : undefined;
  }

  const readyBracketsAll = $derived.by(() => {
    const list: Array<{ bm: BracketMatch; meta: string; classId: string | undefined }> = [];
    for (const tr of tracks) {
      for (const bm of readyBracketMatches(tournament, tr.bracketMatches, tr.classId)) {
        const r = bracketMatchRound(bm);
        const meta =
          tr.classId !== undefined
            ? `${tr.title} · Bracket round ${r}`
            : `Bracket round ${r}`;
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
</script>

<div class="ov">
  <div class="ov-main">
    <section class="ov-card ov-tables-card">
      <h3 class="ov-h">Tables</h3>
      {#if tournament.tables.length > 0}
        <p class="muted small ov-dnd-hint">Drag matches from Ready to play onto a table; drag back to unassign.</p>
      {/if}
      {#if tournament.tables.length === 0}
        <p class="muted small">No tables configured yet. Use #Tables in the sidebar to add tables.</p>
      {:else}
        <div class="ov-table-grid" role="list" aria-label="Tournament tables">
          {#each tournament.tables as tableId (tableId)}
            {@const tm = matchOnTable(tableId)}
            <div
              class="ov-table-tile"
              class:ov-table-busy={Boolean(tm)}
              class:ov-drop-highlight={dragOverTableId === tableId}
              role="listitem"
              ondragover={(e) => handleTableDragOver(e, tableId)}
              ondragleave={(e) => handleTableDragLeave(tableId, e)}
              ondrop={(e) => handleTableDrop(e, tableId)}
            >
              <div class="ov-table-num">Table {tableId}</div>
              {#if tm}
                <div
                  class="ov-table-match-drag ov-table-match-btn"
                  draggable="true"
                  class:ov-dragging={draggingMatchId === tm.id}
                  role="button"
                  tabindex="0"
                  aria-label={`Match on table ${tableId}, drag to move or unassign`}
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
                    <PlayerName {tournament} playerId={tm.playerA} tag="strong" /> vs
                    <PlayerName {tournament} playerId={tm.playerB} tag="strong" />
                  </span>
                  <span class="muted small">In progress</span>
                </div>
              {:else}
                <p class="ov-table-free muted small">Free</p>
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
      <h3 class="ov-h">Ready to play</h3>
      {#if readyGroupsAll.length === 0 && readyBracketsAll.length === 0}
        <p class="muted small">Nothing to highlight: no group matches waiting, and no knockout slots that are ready to play or already decided.</p>
      {:else}
        {#if readyGroupsAll.length > 0}
          <h4 class="ov-h4">Group</h4>
          <ul class="ov-ready-list">
            {#each readyGroupsAll as m (m.id)}
              <li
                class="ov-ready-item"
                draggable="true"
                class:ov-dragging={draggingMatchId === m.id}
                ondragstart={(e) => handleDragStart(e, m.id, 'ready')}
                ondragend={handleDragEnd}
              >
                <button type="button" class="ov-ready-btn" onclick={() => onOpenGroupMatch(m)}>
                  <span class="ov-ready-pair"
                    ><PlayerName {tournament} playerId={m.playerA} tag="strong" /> vs <PlayerName
                      {tournament}
                      playerId={m.playerB}
                      tag="strong"
                    /></span
                  >
                  <span class="muted small ov-ready-meta">{readyGroupMatchMeta(tournament, m)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if readyBracketsAll.length > 0}
          <h4 class="ov-h4">Knockout</h4>
          <ul class="ov-ready-list">
            {#each readyBracketsAll as item (item.bm.id)}
              {@const bracketMid = readyBracketPlayableMatchId(tournament, item.bm, item.classId)}
              <li
                class="ov-ready-item"
                class:ov-ready-not-draggable={!bracketMid}
                draggable={Boolean(bracketMid)}
                class:ov-dragging={bracketMid !== null && draggingMatchId === bracketMid}
                ondragstart={(e) => {
                  if (bracketMid) handleDragStart(e, bracketMid, 'ready');
                }}
                ondragend={handleDragEnd}
              >
                <button type="button" class="ov-ready-btn" onclick={() => onOpenBracketSlot(item.bm)}>
                  <span class="ov-ready-pair"
                    ><PlayerName {tournament} playerId={item.bm.seedA!} tag="strong" /> vs <PlayerName
                      {tournament}
                      playerId={item.bm.seedB!}
                      tag="strong"
                    /></span
                  >
                  <span class="muted small ov-ready-meta">{item.meta}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  </div>

  <aside class="ov-sidebar" aria-label="Tournament progress">
    <section class="ov-card ov-sidebar-card ov-players-tables-card">
      <div class="ov-players-tables-split">
        <div class="ov-split-metric">
          <h3 class="ov-h">Players</h3>
          <p class="ov-count">{Object.keys(tournament.players).length}</p>
          <p class="ov-count-caption muted small">in this tournament</p>
        </div>
        <div class="ov-split-metric ov-split-tables">
          <h3 class="ov-h">#Tables</h3>
          <div class="ov-table-stepper" role="group" aria-label="Number of tables">
            <p class="ov-count" aria-live="polite">{tableCount}</p>
            <div class="ov-stepper-btns">
              <button
                type="button"
                class="ov-stepper-btn"
                aria-label="Increase number of tables"
                disabled={tableCount >= 32}
                onclick={() => onIncrementTables()}
              >
                ▲
              </button>
              <button
                type="button"
                class="ov-stepper-btn"
                aria-label="Decrease number of tables"
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
      <h3 class="ov-h">Group phase</h3>
      {#if aggregateGroupPhase.total === 0}
        <p class="muted small">No group matches yet (create groups on the Group phase tab).</p>
      {:else}
        <div class="ov-metric">
          <div class="ov-metric-top">
            <span class="ov-metric-label">Overall</span>
            <span class="ov-progress-meta" title={progressBarAria(aggregateGroupPhase.done, aggregateGroupPhase.total)}>
              <span class="ov-match-ratio"
                >{aggregateGroupPhase.done} / {aggregateGroupPhase.total} matches</span
              >
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
        </div>
        <div class="ov-sub">
          {#each tracks as tr (tr.key)}
            {#each sortGroupsForDisplay(tr.groups) as g (g.id)}
              {@const gm = groupMatchesFiltered(tournament, tr.classId).filter((m) => m.groupId === g.id)}
              {@const c = groupPhaseCounts(gm)}
              {#if c.total > 0}
                <div class="ov-metric ov-metric-sub">
                  <div class="ov-metric-top">
                    <span class="ov-metric-label" title={`${tr.title} · ${groupDisplayLabel(g)}`}>{tr.title} · {groupDisplayLabel(g)}</span>
                    <span class="ov-progress-meta" title={progressBarAria(c.done, c.total)}>
                      <span class="ov-match-ratio">{c.done} / {c.total} matches</span>
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
                </div>
              {/if}
            {/each}
          {/each}
        </div>
      {/if}
    </section>

    <section class="ov-card ov-sidebar-card">
      <h3 class="ov-h">Bracket phase</h3>
      {#if aggregateBracketPhase.total === 0}
        <p class="muted small">No knockout bracket yet (create it on the Bracket tab).</p>
      {:else}
        <div class="ov-metric">
          <div class="ov-metric-top">
            <span class="ov-metric-label">Overall</span>
            <span class="ov-progress-meta" title={progressBarAria(aggregateBracketPhase.done, aggregateBracketPhase.total)}>
              <span class="ov-match-ratio"
                >{aggregateBracketPhase.done} / {aggregateBracketPhase.total} matches</span
              >
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
                <div class="ov-metric ov-metric-sub">
                  <div class="ov-metric-top">
                    <span class="ov-metric-label">{tr.title} · Round {row.round}</span>
                    <span class="ov-progress-meta" title={progressBarAria(row.done, row.total)}>
                      <span class="ov-match-ratio">{row.done} / {row.total} matches</span>
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
                </div>
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

  .ov-tables-card .ov-h {
    margin-bottom: 0.65rem;
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

  .ov-metric {
    margin-top: 0.35rem;
  }

  .ov-metric:first-of-type {
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
