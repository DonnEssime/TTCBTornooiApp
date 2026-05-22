<script lang="ts">
  import type { Tournament } from 'ttc-tornooiapp';
  import { formatBracketSlotPlayerLabel, isHandicapActive } from 'ttc-tornooiapp';

  let {
    tournament,
    playerId,
    classId = undefined,
    /** Plain name when set; overrides label mode. */
    displayName = undefined,
    /** `name` = always the player name; `bracket-slot` = hide names until the group is finished (bracket UI). */
    labelMode = 'name',
    tag = 'span',
  }: {
    tournament: Tournament;
    playerId: string;
    classId?: string;
    displayName?: string;
    labelMode?: 'name' | 'bracket-slot';
    tag?: 'span' | 'strong';
  } = $props();

  const name = $derived(
    displayName ??
      (labelMode === 'bracket-slot'
        ? formatBracketSlotPlayerLabel(tournament, playerId, classId)
        : (tournament.players[playerId]?.name ?? playerId)),
  );
  const handicap = $derived(
    isHandicapActive(tournament) ? (tournament.players[playerId]?.handicap ?? null) : null,
  );
</script>

{#if tag === 'strong'}
  <strong>
    {name}{#if handicap !== null}{' '}<span class="player-handicap">({handicap})</span>{/if}
  </strong>
{:else}
  <span>
    {name}{#if handicap !== null}{' '}<span class="player-handicap">({handicap})</span>{/if}
  </span>
{/if}

<style>
  .player-handicap {
    margin-left: 0.2em;
    font-style: italic;
    font-weight: 400;
    color: #64748b;
  }
</style>
