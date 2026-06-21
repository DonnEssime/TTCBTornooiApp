<script lang="ts">
  import type { FunStatAward, FunStatKey, MessageKey, Tournament } from 'ttc-tornooiapp';
  import { formatBracketSlotPlayerLabel, isDoublesTrack } from 'ttc-tornooiapp';
  import Msg from './i18n/Msg.svelte';
  import { getLocale } from './i18n/locale.svelte';
  import { msgText } from './i18n/msg';
  import PlayerName from './PlayerName.svelte';

  let {
    tournament,
    classId = undefined,
    awards,
  }: {
    tournament: Tournament;
    classId?: string;
    awards: FunStatAward[];
  } = $props();

  let expanded = $state(false);

  const statTitleKeys: Record<FunStatKey, MessageKey> = {
    winner: 'ui.results.funStats.winner.title',
    diehard: 'ui.results.funStats.diehard.title',
    byTheNick: 'ui.results.funStats.byTheNick.title',
    noMercy: 'ui.results.funStats.noMercy.title',
    sweep: 'ui.results.funStats.sweep.title',
    marathon: 'ui.results.funStats.marathon.title',
    heartbreaker: 'ui.results.funStats.heartbreaker.title',
    ironWall: 'ui.results.funStats.ironWall.title',
  };

  const statDescKeys: Record<FunStatKey, MessageKey> = {
    winner: 'ui.results.funStats.winner.desc',
    diehard: 'ui.results.funStats.diehard.desc',
    byTheNick: 'ui.results.funStats.byTheNick.desc',
    noMercy: 'ui.results.funStats.noMercy.desc',
    sweep: 'ui.results.funStats.sweep.desc',
    marathon: 'ui.results.funStats.marathon.desc',
    heartbreaker: 'ui.results.funStats.heartbreaker.desc',
    ironWall: 'ui.results.funStats.ironWall.desc',
  };

  const statValueKeys: Record<FunStatKey, MessageKey> = {
    winner: 'ui.results.funStats.winner.value',
    diehard: 'ui.results.funStats.diehard.value',
    byTheNick: 'ui.results.funStats.byTheNick.value',
    noMercy: 'ui.results.funStats.noMercy.value',
    sweep: 'ui.results.funStats.sweep.value',
    marathon: 'ui.results.funStats.marathon.value',
    heartbreaker: 'ui.results.funStats.heartbreaker.value',
    ironWall: 'ui.results.funStats.ironWall.value',
  };

  function holderLabel(participantId: string): string {
    void getLocale();
    if (isDoublesTrack(tournament, classId)) {
      return formatBracketSlotPlayerLabel(tournament, participantId, classId, getLocale());
    }
    return tournament.players[participantId]?.name ?? participantId;
  }

  function formattedValue(key: FunStatKey, value: number): string {
    void getLocale();
    let count = String(value);
    if (key === 'ironWall' && value > 0) count = `+${value}`;
    return msgText(statValueKeys[key], { count });
  }
</script>

<section class="card fun-stats-card" data-testid="fun-stats-card">
  <button
    type="button"
    class="fun-stats-toggle h2"
    aria-expanded={expanded}
    aria-controls="fun-stats-panel"
    onclick={() => (expanded = !expanded)}
  >
    <span class="fun-stats-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
    <Msg key="ui.results.funStats.title" />
  </button>
  {#if expanded}
    <ul id="fun-stats-panel" class="fun-stats-list">
      {#each awards as award (award.key)}
        <li class="fun-stat-row">
          <p class="fun-stat-summary">
            <strong class="fun-stat-label"><Msg key={statTitleKeys[award.key]} tag="span" /></strong><span
              class="fun-stat-colon"
            >: </span><span class="fun-stat-desc muted"><Msg key={statDescKeys[award.key]} tag="span" /></span><span
              class="fun-stat-value"
            > ({formattedValue(award.key, award.value)})</span>
          </p>
          <p class="fun-stat-holders">
            {#each award.holderIds as holderId, i (holderId)}
              {#if i > 0}<span class="fun-stat-sep">, </span>{/if}
              {#if isDoublesTrack(tournament, classId)}
                {holderLabel(holderId)}
              {:else}
                <PlayerName {tournament} playerId={holderId} {classId} />
              {/if}
            {/each}
          </p>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .fun-stats-card {
    margin-top: 0.75rem;
  }

  .fun-stats-toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .fun-stats-toggle:hover {
    opacity: 0.85;
  }

  .fun-stats-chevron {
    flex: 0 0 auto;
    font-size: 0.85em;
    line-height: 1;
  }

  .fun-stats-list {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .fun-stat-row {
    margin: 0;
    padding: 0;
  }

  .fun-stat-summary {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.45;
  }

  .fun-stat-label {
    font-weight: 650;
  }

  .fun-stat-colon {
    margin-right: 0.15em;
  }

  .fun-stat-desc {
    font-size: 0.88em;
    margin-right: 0.25em;
  }

  .fun-stat-value {
    font-size: 0.88em;
    color: #64748b;
  }

  .fun-stat-holders {
    margin: 0.15rem 0 0;
    padding-left: 0.35rem;
  }

  .fun-stat-sep {
    white-space: pre;
  }
</style>
