<script lang="ts">
  import type { GroupDefinition, Match, Tournament } from 'ttc-tornooiapp';
  import {
    canMutateExistingGroupPhaseMatchScores,
    gameWinner,
    groupMatrixParticipantOrder,
    groupNumberedTitle,
    groupStandingsRowsForBracket,
    matchSideLabels,
  } from 'ttc-tornooiapp';
  import PlayerName from './PlayerName.svelte';
  import Msg from './i18n/Msg.svelte';
  import { getLocale } from './i18n/locale.svelte';
  import { msgText } from './i18n/msg';

  const DND_PLAYER = 'application/x-ttc-player-id';
  const DND_FROM_GROUP = 'application/x-ttc-from-group-id';
  const DND_CLASS = 'application/x-ttc-class-id';

  let {
    tournament,
    group,
    classId = undefined,
    dndEnabled = false,
    canDragPlayer,
    draggingPlayerId = null,
    dragOverGroupId = null,
    onOpenScoreModal,
    onDragStart,
    onDragEnd,
    onGroupDragOver,
    onGroupDragLeave,
    onGroupDrop,
  }: {
    tournament: Tournament;
    group: GroupDefinition;
    classId?: string;
    dndEnabled?: boolean;
    canDragPlayer: (playerId: string) => boolean;
    draggingPlayerId?: string | null;
    dragOverGroupId?: string | null;
    onOpenScoreModal: (m: Match) => void;
    onDragStart: (e: DragEvent, playerId: string, fromGroupId: string, classId?: string) => void;
    onDragEnd: () => void;
    onGroupDragOver: (e: DragEvent, groupId: string) => void;
    onGroupDragLeave: (groupId: string) => void;
    onGroupDrop: (e: DragEvent, groupId: string, classId?: string) => void;
  } = $props();

  const groupTitle = $derived.by(() => {
    void getLocale();
    return groupNumberedTitle(group, getLocale());
  });

  const matrixPids = $derived(groupMatrixParticipantOrder(tournament, group, classId));

  const standingsWl = $derived.by(() => {
    const m: Record<string, { w: number; l: number }> = {};
    for (const row of groupStandingsRowsForBracket(tournament, group, classId)) {
      m[row.pid] = { w: row.w, l: row.l };
    }
    return m;
  });

  function playerLabel(pid: string): string {
    return tournament.players[pid]?.name ?? pid;
  }

  function findGroupMatchBetween(rowPid: string, colPid: string): Match | undefined {
    if (rowPid === colPid) return undefined;
    for (const m of Object.values(tournament.matches)) {
      if (m.groupId !== group.id) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      const ok =
        (m.playerA === rowPid && m.playerB === colPid) || (m.playerA === colPid && m.playerB === rowPid);
      if (ok) return m;
    }
    return undefined;
  }

  function groupMatrixGamesWonDigit(rowPid: string, colPid: string): string {
    if (rowPid === colPid) return '';
    const m = findGroupMatchBetween(rowPid, colPid);
    if (!m || m.scores.length === 0) return '';
    let won = 0;
    let anyDecided = false;
    const rowIsA = m.playerA === rowPid;
    for (const gs of m.scores) {
      const w = gameWinner(gs);
      if (!w) continue;
      anyDecided = true;
      if ((rowIsA && w === 'A') || (!rowIsA && w === 'B')) won++;
    }
    if (!anyDecided) return '';
    return String(won);
  }

  function groupMatrixCellViewOnly(m: Match): boolean {
    return (
      (m.scores.length > 0 || m.status !== 'scheduled') &&
      !canMutateExistingGroupPhaseMatchScores(tournament, m)
    );
  }

  function groupMatrixCellAriaLabel(m: Match): string {
    const { sideA: a, sideB: b } = matchSideLabels(tournament, m, m.classId);
    const params = { a, b };
    if (m.scores.length === 0 && m.status === 'scheduled') {
      return groupMatrixCellViewOnly(m)
        ? msgText('ui.score.matrixLocked', params)
        : msgText('ui.score.matrixEnter', params);
    }
    return groupMatrixCellViewOnly(m)
      ? msgText('ui.score.matrixView', params)
      : msgText('ui.score.matrixEdit', params);
  }

  function handlePlayerDragStart(e: DragEvent, playerId: string): void {
    if (!dndEnabled || !canDragPlayer(playerId)) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData(DND_PLAYER, playerId);
    dt.setData(DND_FROM_GROUP, group.id);
    dt.setData(DND_CLASS, classId ?? '');
    dt.effectAllowed = 'move';
    onDragStart(e, playerId, group.id, classId);
  }

  function handleCardDragOver(e: DragEvent): void {
    if (!draggingPlayerId) return;
    e.preventDefault();
    onGroupDragOver(e, group.id);
  }

  function handleCardDrop(e: DragEvent): void {
    onGroupDrop(e, group.id, classId);
  }
</script>

<article
  class="sub-card group-singles-matrix"
  class:group-dnd-drop-target={dragOverGroupId === group.id && draggingPlayerId !== null}
  role="region"
  aria-label={groupTitle}
  data-testid="group-drop-{group.id}"
  ondragover={handleCardDragOver}
  ondragleave={() => onGroupDragLeave(group.id)}
  ondrop={handleCardDrop}
>
  <h4 class="h4">{groupTitle}</h4>
  <div class="group-matrix-wrap">
    <table class="grid compact group-matrix-table">
      <thead>
        <tr>
          <th><Msg key="ui.player" /></th>
          {#each matrixPids as colPid (colPid)}
            <th class="h2h-th" title={playerLabel(colPid)}>
              <span class="h2h-th-inner">
                <PlayerName {tournament} playerId={colPid} {classId} />
              </span>
            </th>
          {/each}
          <th><Msg key="ui.standings.win" /></th>
          <th><Msg key="ui.standings.loss" /></th>
        </tr>
      </thead>
      <tbody>
        {#each matrixPids as rowPid (rowPid)}
          {@const draggable = dndEnabled && canDragPlayer(rowPid)}
          <tr>
            <td
              class:group-player-draggable={draggable}
              class:group-player-drag-locked={dndEnabled && !canDragPlayer(rowPid)}
              draggable={draggable}
              data-testid="group-player-drag-{rowPid}"
              ondragstart={(e) => handlePlayerDragStart(e, rowPid)}
              ondragend={onDragEnd}
            >
              <PlayerName {tournament} playerId={rowPid} {classId} />
            </td>
            {#each matrixPids as colPid (colPid)}
              <td class="h2h-cell">
                {#if rowPid === colPid}
                  <span class="matrix-diag" aria-hidden="true">·</span>
                {:else}
                  {@const gm = findGroupMatchBetween(rowPid, colPid)}
                  {#if gm}
                    {@const wins = groupMatrixGamesWonDigit(rowPid, colPid)}
                    <button
                      type="button"
                      class="group-matrix-cell-btn"
                      class:group-matrix-cell-readonly={groupMatrixCellViewOnly(gm)}
                      aria-label={groupMatrixCellAriaLabel(gm)}
                      onclick={() => onOpenScoreModal(gm)}
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

<style>
  .sub-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 0.65rem 0.85rem;
    margin-bottom: 0.5rem;
  }

  .sub-card.group-dnd-drop-target {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    background: #f8fafc;
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
    -webkit-overflow-scrolling: touch;
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
    margin-top: 0.65rem;
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
    color: #94a3b8;
  }

  .group-player-draggable {
    cursor: grab;
  }

  .group-player-draggable:active {
    cursor: grabbing;
  }

  .group-player-drag-locked {
    opacity: 0.72;
  }
</style>
