<script lang="ts">
  import type { BracketMatch, Match, Tournament } from 'ttc-tornooiapp';
  import {
    bracketKnockoutRoundLabel,
    bracketPlayerMatchId,
    buildPlayerMatchHistory,
    displayLabelForGroup,
    formatBracketSlotPlayerLabel,
    getCompetitionTrack,
    isAnyDoublesFormat,
    isDoublesTrack,
    matchSideLabels,
    pairDisplayLabel,
    pairForPlayer,
    winningPairIdFromMatch,
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
    handicapEnabled = false,
    handicapBounds = { min: 0, max: 0 },
    miscEnabled = false,
    miscFieldLabel = '',
    onUpdatePlayer,
    canSetGroupId,
    onSetGroupId,
    onClose,
  }: {
    tournament: Tournament;
    playerId: string;
    handicapEnabled?: boolean;
    handicapBounds?: { min: number; max: number };
    miscEnabled?: boolean;
    miscFieldLabel?: string;
    onUpdatePlayer: (updates: { name?: string; handicap?: number; misc?: string }) => void;
    canSetGroupId: (playerId: string, classId?: string) => boolean;
    onSetGroupId: (groupId: string | null, classId?: string) => void;
    onClose: () => void;
  } = $props();

  const locale = $derived(getLocale());
  const history = $derived(buildPlayerMatchHistory(tournament, playerId, msgText('ui.ov.mainDraw')));
  const focalPlayerName = $derived(tournament.players[playerId]?.name ?? playerId);

  let nameDraft = $state('');
  let nameFocused = $state(false);
  let handicapDraft = $state(0);
  let handicapInputEl = $state<HTMLInputElement | null>(null);
  let miscDraft = $state('');
  let miscFocused = $state(false);

  $effect(() => {
    const p = tournament.players[playerId];
    if (!p) return;
    if (!nameFocused) nameDraft = p.name;
    if (!miscFocused) miscDraft = p.misc ?? '';
    const h = p.handicap ?? 0;
    if (document.activeElement !== handicapInputEl) handicapDraft = h;
  });

  function commitName(): void {
    nameFocused = false;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      nameDraft = tournament.players[playerId]?.name ?? playerId;
      return;
    }
    if (trimmed === (tournament.players[playerId]?.name ?? '')) return;
    onUpdatePlayer({ name: trimmed });
  }

  function onNameKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    }
  }

  function onHandicapInput(e: Event): void {
    const raw = Number((e.currentTarget as HTMLInputElement).value);
    onUpdatePlayer({ handicap: Number.isFinite(raw) ? raw : 0 });
  }

  function commitMisc(): void {
    miscFocused = false;
    const trimmed = miscDraft.trim();
    if (!trimmed) {
      miscDraft = tournament.players[playerId]?.misc ?? '';
      if (miscEnabled) onUpdatePlayer({ misc: '' });
      return;
    }
    if (trimmed === (tournament.players[playerId]?.misc ?? '').trim()) return;
    onUpdatePlayer({ misc: trimmed });
  }

  function onMiscKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    }
  }

  function opponentName(opponentId: string, classId?: string, groupId?: string, matchId?: string): string {
    if (groupId) {
      const label = groupSideLabel(opponentId, groupId, classId, false, matchId);
      if (label) return label;
    }
    if (isDoublesTrack(tournament, classId) && (tournament.pairs?.[opponentId] || (classId && tournament.classTournaments[classId]?.pairs?.[opponentId]))) {
      return pairDisplayLabel(tournament, opponentId, classId, getLocale());
    }
    return tournament.players[opponentId]?.name ?? opponentId;
  }

  function focalName(opponentId: string, groupId: string, classId?: string, matchId?: string): string {
    const label = groupSideLabel(opponentId, groupId, classId, true, matchId);
    if (label) return label;
    return focalPlayerName;
  }

  function groupSideLabel(
    opponentId: string,
    groupId: string,
    classId: string | undefined,
    focal: boolean,
    matchId?: string,
  ): string | undefined {
    const match = findGroupMatch(groupId, opponentId, classId, matchId);
    if (!match || !isAnyDoublesFormat(tournament, classId)) return undefined;
    const sides = matchSideLabels(tournament, match, classId, getLocale());
    const focalOnA =
      match.teamA?.includes(playerId) ||
      (match.pairA && pairForPlayer(tournament, classId, playerId)?.id === match.pairA);
    if (focal) return focalOnA ? sides.sideA : sides.sideB;
    return focalOnA ? sides.sideB : sides.sideA;
  }

  function bracketSideLabel(
    bracketMatches: BracketMatch[],
    round: number,
    opponentId: string,
    classId: string | undefined,
    focal: boolean,
  ): string {
    const bm = findBracketMatch(bracketMatches, round, opponentId, classId);
    if (!bm) return focal ? focalPlayerName : opponentName(opponentId, classId);
    const pm = tournament.matches[bracketPlayerMatchId(bm.id, classId)];
    if (pm && !pm.groupId && isAnyDoublesFormat(tournament, classId)) {
      const sides = matchSideLabels(tournament, pm, classId, getLocale());
      const seed = focalBracketSeed(classId);
      const focalOnA = pm.pairA ? pm.pairA === seed : pm.teamA?.includes(playerId) ?? pm.playerA === playerId;
      if (focal) return focalOnA ? sides.sideA : sides.sideB;
      return focalOnA ? sides.sideB : sides.sideA;
    }
    if (isDoublesTrack(tournament, classId)) {
      const id = focal ? focalBracketSeed(classId) : opponentId;
      return formatBracketSlotPlayerLabel(tournament, id, classId, getLocale());
    }
    return focal ? focalPlayerName : opponentName(opponentId, classId);
  }

  function focalBracketSeed(classId?: string): string {
    const pair = isDoublesTrack(tournament, classId) ? pairForPlayer(tournament, classId, playerId) : undefined;
    return pair?.id ?? playerId;
  }

  function findBracketMatch(
    bracketMatches: BracketMatch[],
    round: number,
    opponentId: string,
    classId?: string,
  ): BracketMatch | undefined {
    const focal = focalBracketSeed(classId);
    return bracketMatches.find(
      (bm) =>
        bm.round === round &&
        ((bm.seedA === focal && bm.seedB === opponentId) ||
          (bm.seedA === opponentId && bm.seedB === focal)),
    );
  }

  function scoreText(line: PlayerMatchHistoryLine): string | null {
    if (!line.score) return null;
    return `${line.score.playerGames}-${line.score.opponentGames}`;
  }

  function findGroupMatch(
    groupId: string,
    opponentId: string,
    classId: string | undefined,
    matchId?: string,
  ): Match | undefined {
    if (matchId) {
      const direct = tournament.matches[matchId];
      if (
        direct?.groupId === groupId &&
        (classId ? direct.classId === classId : !direct.classId)
      ) {
        return direct;
      }
    }
    for (const m of Object.values(tournament.matches)) {
      if (m.groupId !== groupId) continue;
      if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
      if (m.pairA && m.pairB) {
        const pair = pairForPlayer(tournament, classId, playerId);
        if (!pair) continue;
        const ok =
          (m.pairA === pair.id && m.pairB === opponentId) ||
          (m.pairA === opponentId && m.pairB === pair.id);
        if (ok) return m;
        continue;
      }
      if (m.teamA && m.teamB) {
        const onA = m.teamA.includes(playerId);
        const onB = m.teamB.includes(playerId);
        if (!onA && !onB) continue;
        const oppTeam = onA ? m.teamB : m.teamA;
        if (oppTeam.includes(opponentId)) return m;
        continue;
      }
      const ok =
        (m.playerA === playerId && m.playerB === opponentId) ||
        (m.playerA === opponentId && m.playerB === playerId);
      if (ok) return m;
    }
    return undefined;
  }

  function groupMatchOutcome(
    opponentId: string,
    groupId: string,
    classId: string | undefined,
    pid: string,
    matchId?: string,
  ): BracketSlotOutcome | null {
    const match = findGroupMatch(groupId, opponentId, classId, matchId);
    if (!match) return null;
    if (match.teamA && match.teamB) {
      if (!match.winner) return null;
      const winTeam = match.winner === match.playerA ? match.teamA : match.teamB;
      return winTeam.includes(pid) ? 'winner' : 'loser';
    }
    if (match.pairA && match.pairB) {
      const winnerPair = winningPairIdFromMatch(match);
      if (!winnerPair) return null;
      let pairId: string | undefined;
      if (pid === playerId) {
        pairId = pairForPlayer(tournament, classId, playerId)?.id;
      } else if (tournament.pairs?.[pid] || (classId && tournament.classTournaments[classId]?.pairs?.[pid])) {
        pairId = pid;
      } else {
        pairId = pairForPlayer(tournament, classId, pid)?.id;
      }
      if (!pairId || (match.pairA !== pairId && match.pairB !== pairId)) return null;
      return winnerPair === pairId ? 'winner' : 'loser';
    }
    if (!match.winner) return null;
    return match.winner === pid ? 'winner' : 'loser';
  }

  function bracketMatchOutcome(
    bracketMatches: BracketMatch[],
    round: number,
    opponentId: string,
    pid: string,
    classId?: string,
  ): BracketSlotOutcome | null {
    const bm = findBracketMatch(bracketMatches, round, opponentId, classId);
    if (!bm) return null;
    const focal = focalBracketSeed(classId);
    const side = bm.seedA === focal ? 'a' : 'b';
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

  function groupSelectDisabled(track: PlayerMatchHistoryTrackSection): boolean {
    return !canSetGroupId(playerId, track.classId);
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
      <h3 id="player-history-title" class="modal-title"><Msg key="ui.players.detailsTitle" /></h3>
      <button type="button" class="btn subtle small-inline" onclick={onClose}><Msg key="ui.close" /></button>
    </header>

    <section class="player-details-form" aria-label={msgText('ui.players.detailsTitle')}>
      <label class="player-details-field">
        <span class="player-details-label"><Msg key="ui.name" /></span>
        <input
          class="player-details-input"
          type="text"
          data-testid="player-history-name"
          autocomplete="off"
          bind:value={nameDraft}
          onfocus={() => {
            nameFocused = true;
          }}
          onblur={commitName}
          onkeydown={onNameKeydown}
        />
      </label>
      {#if handicapEnabled}
        <label class="player-details-field">
          <span class="player-details-label"><Msg key="ui.handicap" /></span>
          <input
            bind:this={handicapInputEl}
            class="player-details-input player-details-handicap"
            type="number"
            min={handicapBounds.min}
            max={handicapBounds.max}
            step="1"
            aria-label={msgText('ui.handicap.forPlayer', { name: focalPlayerName })}
            title={msgText('ui.handicap.rangeTitle', {
              min: String(handicapBounds.min),
              max: String(handicapBounds.max),
            })}
            bind:value={handicapDraft}
            oninput={onHandicapInput}
          />
        </label>
      {/if}
      {#if miscEnabled}
        <label class="player-details-field">
          <span class="player-details-label">{miscFieldLabel}</span>
          <input
            class="player-details-input"
            type="text"
            autocomplete="off"
            maxlength="80"
            placeholder={miscFieldLabel}
            aria-label={msgText('ui.misc.forPlayer', { label: miscFieldLabel, name: focalPlayerName })}
            bind:value={miscDraft}
            onfocus={() => {
              miscFocused = true;
            }}
            onblur={commitMisc}
            onkeydown={onMiscKeydown}
          />
        </label>
      {/if}
    </section>

    {#if history.showNoMatchesAvailable}
      <p class="muted player-history-empty"><Msg key="ui.players.noMatchesAvailable" /></p>
    {/if}

    {#each history.tracks as track (track.classId ?? 'main')}
      <section class="player-history-section">
        {#if track.classId}
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
            disabled={groupSelectDisabled(track)}
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
            {#each track.groupSection.lines as line (line.matchId ?? line.opponentId)}
              {@const focalOutcome = groupMatchOutcome(
                line.opponentId,
                track.groupSection.group.id,
                track.classId,
                playerId,
                line.matchId,
              )}
              {@const opponentOutcome = groupMatchOutcome(
                line.opponentId,
                track.groupSection.group.id,
                track.classId,
                line.opponentId,
                line.matchId,
              )}
              <li class="player-history-line">
                <span
                  class="player-history-focal"
                  class:player-history-slot--winner={focalOutcome === 'winner'}
                  class:player-history-slot--loser={focalOutcome === 'loser'}
                >{focalName(line.opponentId, track.groupSection.group.id, track.classId, line.matchId)}</span>
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
                >{opponentName(line.opponentId, track.classId, track.groupSection.group.id, line.matchId)}</span>
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
                  track.classId,
                )}
                {@const opponentOutcome = bracketMatchOutcome(
                  track.bracketMatches,
                  section.round,
                  line.opponentId,
                  line.opponentId,
                  track.classId,
                )}
                <li class="player-history-line">
                  <span
                    class="player-history-focal"
                    class:player-history-slot--winner={focalOutcome === 'winner'}
                    class:player-history-slot--loser={focalOutcome === 'loser'}
                  >{bracketSideLabel(track.bracketMatches, section.round, line.opponentId, track.classId, true)}</span>
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
                  >{bracketSideLabel(track.bracketMatches, section.round, line.opponentId, track.classId, false)}</span>
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

  .player-details-form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem 1rem;
    margin: 0.35rem 0 0.85rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid #e2e8f0;
  }

  .player-details-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1 1 10rem;
    min-width: 0;
  }

  .player-details-label {
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
  }

  .player-details-input {
    font: inherit;
    padding: 0.4rem 0.55rem;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    color: #0f172a;
    background: #fff;
  }

  .player-details-input:focus {
    outline: 2px solid rgb(15 76 129 / 35%);
    border-color: #0f4c81;
  }

  .player-details-handicap {
    width: 5rem;
    text-align: center;
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
