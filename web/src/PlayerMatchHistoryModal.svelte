<script lang="ts">
  import type { BracketMatch, Match, Tournament } from 'ttc-tornooiapp';
  import {
    bracketKnockoutRoundLabel,
    buildPlayerMatchHistory,
    displayLabelForGroup,
    getCompetitionTrack,
    type PlayerMatchHistoryLine,
    type PlayerMatchHistoryTrackSection,
  } from 'ttc-tornooiapp';
  import { bracketSlotOutcome, type BracketSlotOutcome } from './bracketStream/slotOutcome';
  import Msg from './i18n/Msg.svelte';
  import { getLocale } from './i18n/locale.svelte';
  import { msgText } from './i18n/msg';

  let {
    tournament,
    playerId,
    playerName,
    onSetGroupId,
    onClose,
  }: {
    tournament: Tournament;
    playerId: string;
    playerName: string;
    onSetGroupId: (groupId: string | null, classId?: string) => void;
    onClose: () => void;
  } = $props();

  const locale = $derived(getLocale());
  const history = $derived(buildPlayerMatchHistory(tournament, playerId, msgText('ui.ov.mainDraw')));

  function opponentName(opponentId: string): string {
    return tournament.players[opponentId]?.name ?? opponentId;
  }

  function scoreText(line: PlayerMatchHistoryLine): string | null {
    if (!line.score) return null;
    return `${line.score.playerGames}-${line.score.opponentGames}`;
  }

  function findGroupMatch(
    groupId: string,
    opponentId: string,
    classId: string | undefined,
  ): Match | undefined {
    for (const m of Object.values(tournament.matches)) {
      if (m.groupId !== groupId) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      const ok =
        (m.playerA === playerId && m.playerB === opponentId) ||
        (m.playerA === opponentId && m.playerB === playerId);
      if (ok) return m;
    }
    return undefined;
  }

  function findBracketMatch(
    bracketMatches: BracketMatch[],
    round: number,
    opponentId: string,
  ): BracketMatch | undefined {
    return bracketMatches.find(
      (bm) =>
        bm.round === round &&
        ((bm.seedA === playerId && bm.seedB === opponentId) ||
          (bm.seedA === opponentId && bm.seedB === playerId)),
    );
  }

  function groupMatchOutcome(
    opponentId: string,
    groupId: string,
    classId: string | undefined,
    pid: string,
  ): BracketSlotOutcome | null {
    const match = findGroupMatch(groupId, opponentId, classId);
    if (!match?.winner) return null;
    return match.winner === pid ? 'winner' : 'loser';
  }

  function bracketMatchOutcome(
    bracketMatches: BracketMatch[],
    round: number,
    opponentId: string,
    pid: string,
  ): BracketSlotOutcome | null {
    const bm = findBracketMatch(bracketMatches, round, opponentId);
    if (!bm) return null;
    const side = bm.seedA === pid ? 'a' : 'b';
    return bracketSlotOutcome(bm, side);
  }

  function groupOptionsForTrack(track: PlayerMatchHistoryTrackSection) {
    const entries = Object.values(getCompetitionTrack(tournament, track.classId).groups).slice();
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }

  function selectedGroupIdForTrack(track: PlayerMatchHistoryTrackSection): string {
    return track.groupSection?.group.id ?? '';
  }

  function onGroupSelectChange(track: PlayerMatchHistoryTrackSection, e: Event): void {
    const v = (e.currentTarget as HTMLSelectElement | null)?.value ?? '';
    onSetGroupId(v ? v : null, track.classId);
  }
</script>

<div class="modal-root player-history-modal-root">
  <button
    type="button"
    class="modal-scrim"
    aria-label={msgText('ui.close')}
    onclick={onClose}
  ></button>
  <div
    class="modal-dialog player-history-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="player-history-title"
    tabindex="-1"
  >
    <header class="modal-head">
      <h3 id="player-history-title" class="modal-title">{playerName}</h3>
      <button type="button" class="btn subtle small-inline" onclick={onClose}><Msg key="ui.close" /></button>
    </header>

    {#if history.showNoMatchesAvailable}
      <p class="muted player-history-empty"><Msg key="ui.players.noMatchesAvailable" /></p>
    {/if}

    {#each history.tracks as track (track.classId ?? 'main')}
      <section class="player-history-section">
        {#if history.tracks.length > 1}
          <h3 class="player-history-track-title">{track.trackTitle}</h3>
        {/if}
        <div class="player-history-heading-row">
          <h4 class="player-history-heading">
            <Msg key="ui.players.groupSubtitle" />
          </h4>
          <select
            class="player-history-group-select"
            aria-label={msgText('ui.players.groupSubtitle')}
            value={selectedGroupIdForTrack(track)}
            onchange={(e) => onGroupSelectChange(track, e)}
          >
            <option value=""><Msg key="ui.players.noGroupOption" /></option>
            {#each groupOptionsForTrack(track) as g (g.id)}
              <option value={g.id}>{displayLabelForGroup(g, locale)}</option>
            {/each}
          </select>
        </div>

        {#if track.groupSection}
          <ul class="player-history-lines">
            {#each track.groupSection.lines as line (line.opponentId)}
              {@const focalOutcome = groupMatchOutcome(
                line.opponentId,
                track.groupSection.group.id,
                track.classId,
                playerId,
              )}
              {@const opponentOutcome = groupMatchOutcome(
                line.opponentId,
                track.groupSection.group.id,
                track.classId,
                line.opponentId,
              )}
              <li class="player-history-line">
                <span
                  class="player-history-focal"
                  class:player-history-slot--winner={focalOutcome === 'winner'}
                  class:player-history-slot--loser={focalOutcome === 'loser'}
                >{playerName}</span>
                {#if scoreText(line)}
                  <span
                    class="player-history-score"
                    class:player-history-slot--winner={focalOutcome === 'winner'}
                    class:player-history-slot--loser={focalOutcome === 'loser'}
                  >{scoreText(line)}</span>
                {:else}
                  <span class="player-history-score player-history-score--pending" aria-hidden="true">—</span>
                {/if}
                <span
                  class="player-history-opponent"
                  class:player-history-slot--winner={opponentOutcome === 'winner'}
                  class:player-history-slot--loser={opponentOutcome === 'loser'}
                >{opponentName(line.opponentId)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted player-history-empty"><Msg key="ui.players.notInGroupYet" /></p>
        {/if}

        {#each track.bracketSections as section (section.round)}
          <section class="player-history-subsection">
            <h4 class="player-history-heading">
              {bracketKnockoutRoundLabel(locale, section.round, track.bracketMatches)}
            </h4>
            <ul class="player-history-lines">
              {#each section.lines as line (`${section.round}-${line.opponentId}`)}
                {@const focalOutcome = bracketMatchOutcome(
                  track.bracketMatches,
                  section.round,
                  line.opponentId,
                  playerId,
                )}
                {@const opponentOutcome = bracketMatchOutcome(
                  track.bracketMatches,
                  section.round,
                  line.opponentId,
                  line.opponentId,
                )}
                <li class="player-history-line">
                  <span
                    class="player-history-focal"
                    class:player-history-slot--winner={focalOutcome === 'winner'}
                    class:player-history-slot--loser={focalOutcome === 'loser'}
                  >{playerName}</span>
                  {#if scoreText(line)}
                    <span
                      class="player-history-score"
                      class:player-history-slot--winner={focalOutcome === 'winner'}
                      class:player-history-slot--loser={focalOutcome === 'loser'}
                    >{scoreText(line)}</span>
                  {:else}
                    <span class="player-history-score player-history-score--pending" aria-hidden="true">—</span>
                  {/if}
                  <span
                    class="player-history-opponent"
                    class:player-history-slot--winner={opponentOutcome === 'winner'}
                    class:player-history-slot--loser={opponentOutcome === 'loser'}
                  >{opponentName(line.opponentId)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .player-history-modal-root {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 1.5rem 1rem 2rem;
    overflow-y: auto;
  }

  .player-history-modal-root :global(.modal-scrim) {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: rgb(15 23 42 / 45%);
    cursor: pointer;
  }

  .player-history-dialog {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 30rem;
    margin-top: 2vh;
    padding: 1rem 1.15rem 1.15rem;
    border-radius: 14px;
    background: #fff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 12px 40px rgb(15 23 42 / 18%);
  }

  .player-history-modal-root :global(.modal-head) {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }

  .player-history-modal-root :global(.modal-title) {
    margin: 0;
    font-size: 1rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  .player-history-empty {
    margin: 0.35rem 0 0;
    font-size: 0.92rem;
  }

  .player-history-section + .player-history-section {
    margin-top: 1rem;
    padding-top: 0.85rem;
    border-top: 1px solid #e2e8f0;
  }

  .player-history-track-title {
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
    font-weight: 650;
    color: #0f172a;
  }

  .player-history-subsection {
    margin-top: 0.85rem;
  }

  .player-history-heading {
    margin: 0 0 0.5rem;
    font-size: 0.88rem;
    font-weight: 650;
    color: #475569;
    letter-spacing: 0.01em;
  }

  .player-history-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0 0 0.5rem;
  }

  .player-history-heading-row .player-history-heading {
    margin: 0;
  }

  .player-history-group-select {
    min-width: 9.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #fff;
    color: #0f172a;
    font-size: 0.9rem;
  }

  .player-history-lines {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .player-history-line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.9rem;
    line-height: 1.35;
  }

  .player-history-focal,
  .player-history-opponent {
    font-weight: 600;
    word-break: break-word;
  }

  .player-history-focal {
    text-align: left;
  }

  .player-history-slot--winner {
    font-weight: 700;
    color: #0f172a;
  }

  .player-history-slot--loser {
    color: #94a3b8;
    font-weight: 500;
  }

  .player-history-score {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #0f172a;
    white-space: nowrap;
  }

  .player-history-score--pending {
    color: #94a3b8;
    font-weight: 500;
  }

  .player-history-opponent {
    text-align: right;
  }
</style>
