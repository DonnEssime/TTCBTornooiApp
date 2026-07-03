<script lang="ts">
  import type { GroupDefinition, Match, Tournament } from 'ttc-tornooiapp';
  import {
    canMutateExistingGroupPhaseMatchScores,
    gameWinner,
    groupMatrixParticipantOrder,
    groupNumberedTitle,
    groupStandingsRowsForBracket,
    matchSideLabels,
    setsAndPointsWonInGroupForPlayer,
  } from 'ttc-tornooiapp';
  import PlayerName from './PlayerName.svelte';
  import Msg from './i18n/Msg.svelte';
  import { getLocale } from './i18n/locale.svelte';
  import { msgText } from './i18n/msg';

  let {
    tournament,
    group,
    classId = undefined,
    onOpenScoreModal,
  }: {
    tournament: Tournament;
    group: GroupDefinition;
    classId?: string;
    onOpenScoreModal: (m: Match) => void;
  } = $props();

  const groupTitle = $derived.by(() => {
    void getLocale();
    return groupNumberedTitle(group, getLocale());
  });

  const playerOrder = $derived(groupMatrixParticipantOrder(tournament, group, classId));

  const standingsWl = $derived.by(() => {
    const m: Record<string, { w: number; l: number }> = {};
    for (const row of groupStandingsRowsForBracket(tournament, group, classId)) {
      m[row.pid] = { w: row.w, l: row.l };
    }
    return m;
  });

  const groupMatches = $derived.by(() => {
    const out: Match[] = [];
    for (const m of Object.values(tournament.matches)) {
      if (m.groupId !== group.id) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      if (!m.teamA || !m.teamB) continue;
      out.push(m);
    }
    return out.sort((a, b) => (a.shuffleRound ?? 0) - (b.shuffleRound ?? 0));
  });

  function gamesStatsForPlayer(pid: string): { won: number; lost: number } {
    const stats = setsAndPointsWonInGroupForPlayer(groupMatches, pid);
    return { won: stats.setsWon, lost: stats.setsLost };
  }

  function gamesWonDigit(m: Match): string {
    if (m.scores.length === 0) return '';
    let wonA = 0;
    let anyDecided = false;
    for (const gs of m.scores) {
      const w = gameWinner(gs);
      if (!w) continue;
      anyDecided = true;
      if (w === 'A') wonA++;
    }
    if (!anyDecided) return '';
    return `${wonA}-${m.scores.length - wonA}`;
  }

  function cellViewOnly(m: Match): boolean {
    return (
      (m.scores.length > 0 || m.status !== 'scheduled') &&
      !canMutateExistingGroupPhaseMatchScores(tournament, m)
    );
  }

  function cellAriaLabel(m: Match): string {
    const { sideA: a, sideB: b } = matchSideLabels(tournament, m, m.classId);
    const params = { a, b };
    if (m.scores.length === 0 && m.status === 'scheduled') {
      return cellViewOnly(m)
        ? msgText('ui.score.matrixLocked', params)
        : msgText('ui.score.matrixEnter', params);
    }
    return cellViewOnly(m)
      ? msgText('ui.score.matrixView', params)
      : msgText('ui.score.matrixEdit', params);
  }
</script>

<article class="sub-card group-shuffle-panel" role="region" aria-label={groupTitle}>
  <h4 class="h4">{groupTitle}</h4>
  <div class="group-matrix-wrap">
    <table class="grid compact group-matrix-table">
      <thead>
        <tr>
          <th><Msg key="ui.player" /></th>
          <th><Msg key="ui.standings.win" /></th>
          <th><Msg key="ui.standings.loss" /></th>
          <th><Msg key="ui.group.shuffleGamesWon" /></th>
          <th><Msg key="ui.group.shuffleGamesLost" /></th>
        </tr>
      </thead>
      <tbody>
        {#each playerOrder as pid (pid)}
          {@const gs = gamesStatsForPlayer(pid)}
          <tr>
            <td><PlayerName {tournament} playerId={pid} {classId} /></td>
            <td>{standingsWl[pid]?.w ?? 0}</td>
            <td>{standingsWl[pid]?.l ?? 0}</td>
            <td>{gs.won}</td>
            <td>{gs.lost}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <ul class="shuffle-match-list plain-list">
    {#each groupMatches as gm (gm.id)}
      {@const sides = matchSideLabels(tournament, gm, classId)}
      {@const digit = gamesWonDigit(gm)}
      <li>
        <button
          type="button"
          class="group-matrix-cell-btn shuffle-match-btn"
          class:group-matrix-cell-readonly={cellViewOnly(gm)}
          aria-label={cellAriaLabel(gm)}
          onclick={() => onOpenScoreModal(gm)}
        >
          <span class="shuffle-match-label">{sides.sideA} vs {sides.sideB}</span>
          {#if digit === ''}
            <span class="group-matrix-placeholder">—</span>
          {:else}
            <span class="group-matrix-wins-digit">{digit}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</article>

<style>
  .sub-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.65rem 0.85rem;
    margin-bottom: 0.5rem;
  }

  .h4 {
    margin: 0 0 0.35rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #334155;
  }

  .group-matrix-wrap {
    margin-top: 0.35rem;
    overflow-x: auto;
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }

  .grid.compact th,
  .grid.compact td {
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
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

  .shuffle-match-list {
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .shuffle-match-btn {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-height: 2.4rem;
    padding: 0.35rem 0.5rem;
    border: 1px dashed #cbd5e1;
    border-radius: 6px;
    background: #fff;
    color: #0f172a;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .shuffle-match-btn:hover {
    background: #f8fafc;
    border-color: #94a3b8;
  }

  .shuffle-match-btn.group-matrix-cell-readonly {
    cursor: default;
    border-style: solid;
    border-color: #e2e8f0;
    background: #f1f5f9;
    color: #475569;
  }

  .shuffle-match-label {
    text-align: left;
    flex: 1;
    margin-right: 0.5rem;
  }

  .group-matrix-placeholder {
    color: #94a3b8;
    font-weight: 500;
  }

  .group-matrix-wins-digit {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .plain-list {
    list-style: none;
  }
</style>
