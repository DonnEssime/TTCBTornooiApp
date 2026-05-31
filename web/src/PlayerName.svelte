<script lang="ts">
  import type { Tournament } from 'ttc-tornooiapp';
  import { formatBracketSlotPlayerLabel, isHandicapActive, isMiscActive } from 'ttc-tornooiapp';
  import { getLocale } from './i18n/locale.svelte';

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

  const name = $derived.by(() => {
    if (displayName !== undefined) return displayName;
    if (labelMode === 'bracket-slot') {
      void getLocale();
      return formatBracketSlotPlayerLabel(tournament, playerId, classId, getLocale());
    }
    return tournament.players[playerId]?.name ?? playerId;
  });
  const handicap = $derived(
    isHandicapActive(tournament) ? (tournament.players[playerId]?.handicap ?? null) : null,
  );
  const misc = $derived.by(() => {
    if (!isMiscActive(tournament)) return null;
    const trimmed = tournament.players[playerId]?.misc?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  });
</script>

{#if tag === 'strong'}
  <strong>
    {name}{#if handicap !== null}{' '}<span class="player-handicap">({handicap})</span>{/if}{#if misc !== null}{' '}<span class="player-misc">({misc})</span>{/if}
  </strong>
{:else}
  <span>
    {name}{#if handicap !== null}{' '}<span class="player-handicap">({handicap})</span>{/if}{#if misc !== null}{' '}<span class="player-misc">({misc})</span>{/if}
  </span>
{/if}

<style>
  .player-handicap,
  .player-misc {
    margin-left: 0.2em;
    font-style: italic;
    font-weight: 400;
    color: #64748b;
  }
</style>
