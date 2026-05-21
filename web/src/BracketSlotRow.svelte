<script lang="ts">
  import type { BracketMatch, Tournament } from 'ttc-tornooiapp';
  import { bracketPlayerMatchId, gameWinner } from 'ttc-tornooiapp';
  import { bracketSlotOutcome } from './bracketStream/slotOutcome';
  import PlayerName from './PlayerName.svelte';

  let {
    tournament,
    bm,
    side,
    label,
    playerId = undefined,
    bracketClassId = undefined,
  }: {
    tournament: Tournament;
    bm: BracketMatch;
    side: 'a' | 'b';
    label: string;
    playerId?: string;
    bracketClassId?: string;
  } = $props();

  function gamesWonForBracketSlot(t: Tournament, match: BracketMatch, s: 'a' | 'b'): number | null {
    if (!match.winner) return null;
    const pid = s === 'a' ? match.seedA : match.seedB;
    if (!pid) return null;
    const pm = t.matches[bracketPlayerMatchId(match.id)];
    if (!pm || pm.groupId || pm.scores.length === 0) return null;
    const asA = pm.playerA === pid;
    const asB = pm.playerB === pid;
    if (!asA && !asB) return null;
    let n = 0;
    for (const g of pm.scores) {
      const w = gameWinner(g);
      if (w === 'A' && asA) n++;
      if (w === 'B' && asB) n++;
    }
    return n;
  }

  const outcome = $derived(bracketSlotOutcome(bm, side));
  const games = $derived(gamesWonForBracketSlot(tournament, bm, side));
  const showPlayerName = $derived(Boolean(playerId && tournament.players[playerId]));
</script>

<div
  class="bracket-slot"
  class:bracket-slot--winner={outcome === 'winner'}
  class:bracket-slot--loser={outcome === 'loser'}
>
  <span class="bracket-slot-label">
    {#if showPlayerName}
      <PlayerName {tournament} playerId={playerId!} classId={bracketClassId} labelMode="bracket-slot" />
    {:else}
      {label}
    {/if}
  </span>
  {#if games !== null}
    <span class="bracket-slot-games" class:bracket-slot-games--winner={outcome === 'winner'}>{games}</span>
  {/if}
</div>

<style>
  .bracket-slot {
    display: flex;
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.35rem;
    font-weight: 600;
    word-break: break-word;
    min-width: 0;
  }

  .bracket-slot-label {
    flex: 1 1 auto;
    min-width: 0;
  }

  .bracket-slot-games {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
    text-align: right;
    font-weight: 500;
    color: #64748b;
  }

  .bracket-slot--winner .bracket-slot-label {
    font-weight: 700;
    color: #0f172a;
  }

  .bracket-slot--winner .bracket-slot-games--winner {
    color: #0f172a;
    font-weight: 700;
  }

  .bracket-slot--loser .bracket-slot-label,
  .bracket-slot--loser .bracket-slot-games {
    color: #94a3b8;
    font-weight: 500;
  }
</style>
