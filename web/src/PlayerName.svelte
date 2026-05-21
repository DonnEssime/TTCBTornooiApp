<script lang="ts">
  import type { Tournament } from 'ttc-tornooiapp';
  import { formatBracketSlotPlayerLabel, isHandicapActive } from 'ttc-tornooiapp';

  let {
    tournament,
    playerId,
    classId = undefined,
    /** Plain name when set; otherwise bracket/group placeholder rules apply. */
    displayName = undefined,
    tag = 'span',
  }: {
    tournament: Tournament;
    playerId: string;
    classId?: string;
    displayName?: string;
    tag?: 'span' | 'strong';
  } = $props();

  const name = $derived(
    displayName ?? formatBracketSlotPlayerLabel(tournament, playerId, classId),
  );
  const handicap = $derived(
    isHandicapActive(tournament) ? (tournament.players[playerId]?.handicap ?? null) : null,
  );
</script>

{#if tag === 'strong'}
  <strong>
    {name}{#if handicap !== null}<span class="player-handicap"> {handicap}</span>{/if}
  </strong>
{:else}
  <span>
    {name}{#if handicap !== null}<span class="player-handicap"> {handicap}</span>{/if}
  </span>
{/if}

<style>
  .player-handicap {
    font-style: italic;
    font-weight: 400;
    color: #64748b;
  }
</style>
