<script lang="ts">
  import type { BracketMatch, Tournament } from 'ttc-tornooiapp';
  import { bracketMatchRound } from 'ttc-tornooiapp';
  import BracketSlotRow from './BracketSlotRow.svelte';
  import BracketSubtree from './BracketSubtree.svelte';
  import Msg from './i18n/Msg.svelte';
  import { msgText } from './i18n/msg';
  import { bracketTreeFromColumns } from './bracketStream/buildTree';
  import { bracketMatchHiddenInStream } from './bracketStream/byeMatch';

  let {
    cols,
    tournament,
    slotTitle,
    mainDrawSlotCount = undefined,
    bracketClassId = undefined,
    onPairingClick = undefined,
    ariaLabel = undefined,
    emptyMessage = undefined,
  }: {
    cols: BracketMatch[][];
    tournament: Tournament;
    slotTitle: (m: BracketMatch, side: 'a' | 'b', t: Tournament, classId?: string) => string;
    /** Leaf slot count for the main knockout tree when it differs from inferred column depth. */
    mainDrawSlotCount?: number;
    /** When set (multi-class track), group placeholders resolve against this class slice. */
    bracketClassId?: string;
    /** When set, match boxes are buttons and invoke this with the bracket slot. */
    onPairingClick?: (bm: BracketMatch) => void;
    ariaLabel?: string;
    emptyMessage?: string;
  } = $props();

  const treeDepth = $derived.by(() => {
    if (mainDrawSlotCount !== undefined && mainDrawSlotCount >= 2) {
      const d = Math.trunc(Math.log2(mainDrawSlotCount));
      return Number.isFinite(d) && d >= 1 ? d : cols.length;
    }
    return cols.length;
  });

  const earlyCols = $derived(cols.length > treeDepth ? cols.slice(0, cols.length - treeDepth) : []);
  const treeCols = $derived(cols.slice(-treeDepth));
  const root = $derived(bracketTreeFromColumns(treeCols));

  function slot(m: BracketMatch, side: 'a' | 'b'): string {
    return slotTitle(m, side, tournament, bracketClassId);
  }

  function slotPlayerId(m: BracketMatch, side: 'a' | 'b'): string | undefined {
    const id = side === 'a' ? m.seedA : m.seedB;
    return id && tournament.players[id] ? id : undefined;
  }

  function activate(m: BracketMatch): void {
    onPairingClick?.(m);
  }

  let streamInnerEl: HTMLDivElement | undefined = $state();
  let finalEl: HTMLElement | undefined = $state();
  let leftWingEl: HTMLDivElement | undefined = $state();
  let rightWingEl: HTMLDivElement | undefined = $state();
  let leftJoinPct = $state(50);
  let rightJoinPct = $state(50);
  let finalTopPct = $state(25);
  let finalBotPct = $state(75);

  function measureJoins(): void {
    if (!streamInnerEl || !finalEl || !leftWingEl || !rightWingEl) return;
    const sRect = streamInnerEl.getBoundingClientRect();
    const sH = sRect.height;
    if (sH <= 0) return;
    const sTop = sRect.top;
    const centerPct = (el: Element) => {
      const r = el.getBoundingClientRect();
      return ((r.top + r.height / 2 - sTop) / sH) * 100;
    };
    leftJoinPct = centerPct(leftWingEl);
    rightJoinPct = centerPct(rightWingEl);
    const f = finalEl.getBoundingClientRect();
    finalTopPct = ((f.top - sTop + f.height * 0.25) / sH) * 100;
    finalBotPct = ((f.top - sTop + f.height * 0.75) / sH) * 100;
  }

  $effect(() => {
    if (!streamInnerEl || !root?.left) return;
    const ro = new ResizeObserver(() => measureJoins());
    ro.observe(streamInnerEl);
    for (const el of [finalEl, leftWingEl, rightWingEl]) {
      if (el) ro.observe(el);
    }
    measureJoins();
    return () => ro.disconnect();
  });

  const joinLeftPath = $derived(`M 0 ${leftJoinPct} L 18 ${finalTopPct}`);
  const joinRightPath = $derived(`M 0 ${finalBotPct} L 18 ${rightJoinPct}`);
</script>

<div class="bracket-stream" role="img" aria-label={ariaLabel ?? msgText('ui.bracket.aria')}>
  {#if !root}
    <p class="muted small">{emptyMessage ?? msgText('ui.bracket.emptyPreview')}</p>
  {:else if !root.left || !root.right}
    <div class="stream-single">
      {#if onPairingClick}
        <button
          type="button"
          class="match-box final-only match-box--interactive"
          class:match-box--hidden={bracketMatchHiddenInStream(root.match)}
          class:match-done={Boolean(root.match.winner)}
          onclick={() => activate(root.match)}
        >
          <BracketSlotRow
            {tournament}
            {bracketClassId}
            bm={root.match}
            side="a"
            label={slot(root.match, 'a')}
            playerId={slotPlayerId(root.match, 'a')}
          />
          <div class="bracket-vs muted"><Msg key="ui.pdf.vs" /></div>
          <BracketSlotRow
            {tournament}
            {bracketClassId}
            bm={root.match}
            side="b"
            label={slot(root.match, 'b')}
            playerId={slotPlayerId(root.match, 'b')}
          />
        </button>
      {:else}
        <div
          class="match-box final-only"
          class:match-box--hidden={bracketMatchHiddenInStream(root.match)}
          class:match-done={Boolean(root.match.winner)}
        >
          <BracketSlotRow
            {tournament}
            {bracketClassId}
            bm={root.match}
            side="a"
            label={slot(root.match, 'a')}
            playerId={slotPlayerId(root.match, 'a')}
          />
          <div class="bracket-vs muted"><Msg key="ui.pdf.vs" /></div>
          <BracketSlotRow
            {tournament}
            {bracketClassId}
            bm={root.match}
            side="b"
            label={slot(root.match, 'b')}
            playerId={slotPlayerId(root.match, 'b')}
          />
        </div>
      {/if}
    </div>
  {:else}
    <div class="stream-inner" bind:this={streamInnerEl}>
      {#each earlyCols as earlyCol, earlyIdx (earlyIdx)}
        <div class="early-round-col">
          <span class="early-round-label muted small"
            >R{earlyCol[0] ? bracketMatchRound(earlyCol[0]) : earlyIdx + 1}</span
          >
          <div class="early-round-matches">
            {#each earlyCol as bm (bm.id)}
              {#if onPairingClick}
                <button
                  type="button"
                  class="match-box match-box--interactive early-match"
                  class:match-box--hidden={bracketMatchHiddenInStream(bm)}
                  class:match-done={Boolean(bm.winner)}
                  onclick={() => activate(bm)}
                >
                  <BracketSlotRow
                    {tournament}
                    {bracketClassId}
                    bm={bm}
                    side="a"
                    label={slot(bm, 'a')}
                    playerId={slotPlayerId(bm, 'a')}
                  />
                  <div class="bracket-vs muted"><Msg key="ui.pdf.vs" /></div>
                  <BracketSlotRow
                    {tournament}
                    {bracketClassId}
                    bm={bm}
                    side="b"
                    label={slot(bm, 'b')}
                    playerId={slotPlayerId(bm, 'b')}
                  />
                </button>
              {:else}
                <div
                  class="match-box early-match"
                  class:match-box--hidden={bracketMatchHiddenInStream(bm)}
                  class:match-done={Boolean(bm.winner)}
                >
                  <BracketSlotRow
                    {tournament}
                    {bracketClassId}
                    bm={bm}
                    side="a"
                    label={slot(bm, 'a')}
                    playerId={slotPlayerId(bm, 'a')}
                  />
                  <div class="bracket-vs muted"><Msg key="ui.pdf.vs" /></div>
                  <BracketSlotRow
                    {tournament}
                    {bracketClassId}
                    bm={bm}
                    side="b"
                    label={slot(bm, 'b')}
                    playerId={slotPlayerId(bm, 'b')}
                  />
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
      <div class="wing left" bind:this={leftWingEl}>
        <BracketSubtree
          node={root.left}
          wing="left"
          {tournament}
          {bracketClassId}
          slotTitle={slot}
          {onPairingClick}
        />
      </div>
      <div class="join-to-final" aria-hidden="true">
        <svg viewBox="0 0 18 100" preserveAspectRatio="none" class="join-svg">
          <path class="join-path" d={joinLeftPath} vector-effect="non-scaling-stroke" />
        </svg>
      </div>
      <div class="final-col">
        {#if onPairingClick}
          <button
            type="button"
            class="match-box final match-box--interactive"
            class:match-box--hidden={bracketMatchHiddenInStream(root.match)}
            class:match-done={Boolean(root.match.winner)}
            bind:this={finalEl}
            onclick={() => activate(root.match)}
          >
            <BracketSlotRow
              {tournament}
              {bracketClassId}
              bm={root.match}
              side="a"
              label={slot(root.match, 'a')}
              playerId={slotPlayerId(root.match, 'a')}
            />
            <div class="bracket-vs muted"><Msg key="ui.pdf.vs" /></div>
            <BracketSlotRow
              {tournament}
              {bracketClassId}
              bm={root.match}
              side="b"
              label={slot(root.match, 'b')}
              playerId={slotPlayerId(root.match, 'b')}
            />
          </button>
        {:else}
          <div
            class="match-box final"
            class:match-box--hidden={bracketMatchHiddenInStream(root.match)}
            class:match-done={Boolean(root.match.winner)}
            bind:this={finalEl}
          >
            <BracketSlotRow
              {tournament}
              {bracketClassId}
              bm={root.match}
              side="a"
              label={slot(root.match, 'a')}
              playerId={slotPlayerId(root.match, 'a')}
            />
            <div class="bracket-vs muted"><Msg key="ui.pdf.vs" /></div>
            <BracketSlotRow
              {tournament}
              {bracketClassId}
              bm={root.match}
              side="b"
              label={slot(root.match, 'b')}
              playerId={slotPlayerId(root.match, 'b')}
            />
          </div>
        {/if}
      </div>
      <div class="join-to-final" aria-hidden="true">
        <svg viewBox="0 0 18 100" preserveAspectRatio="none" class="join-svg">
          <path class="join-path" d={joinRightPath} vector-effect="non-scaling-stroke" />
        </svg>
      </div>
      <div class="wing right" bind:this={rightWingEl}>
        <BracketSubtree
          node={root.right}
          wing="right"
          {tournament}
          {bracketClassId}
          slotTitle={slot}
          {onPairingClick}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .bracket-stream {
    overflow-x: auto;
    padding: 0.65rem 0.75rem 0.85rem;
    margin: 0.25rem 0 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: linear-gradient(180deg, #fafafa 0%, #f4f4f5 100%);
  }

  .stream-inner {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: center;
    gap: 0;
    min-width: min-content;
  }

  .early-round-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.35rem;
    padding: 0 0.5rem 0 0;
    border-right: 1px dashed #cbd5e1;
    margin-right: 0.35rem;
  }

  .early-round-label {
    text-align: center;
    margin: 0 0 0.15rem;
  }

  .early-round-matches {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .early-match {
    min-width: 7.5rem;
  }

  .stream-single {
    display: flex;
    justify-content: center;
    padding: 0.35rem 0;
  }

  .wing {
    display: flex;
    align-items: center;
    flex: 0 1 auto;
  }

  .wing.left {
    justify-content: flex-end;
  }

  .wing.right {
    justify-content: flex-start;
  }

  .join-to-final {
    flex: 0 0 1.125rem;
    width: 1.125rem;
    align-self: stretch;
    position: relative;
    min-height: 4rem;
  }

  .join-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .join-path {
    fill: none;
    stroke: #94a3b8;
    stroke-width: 1.25;
    stroke-linecap: round;
  }

  .final-col {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    padding: 0 0.15rem;
  }

  .match-box {
    border: 1px solid #64748b;
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
    background: #fff;
    font-size: 0.84rem;
    line-height: 1.25;
    min-width: 8rem;
    max-width: 12rem;
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
  }

  .match-box--interactive {
    cursor: pointer;
    text-align: inherit;
    font: inherit;
    color: inherit;
    appearance: none;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .match-box--interactive:hover {
    border-color: #0f766e;
    box-shadow: 0 2px 8px rgb(15 23 42 / 0.1);
  }

  .match-box--interactive:focus-visible {
    outline: 2px solid #0d9488;
    outline-offset: 2px;
  }

  .match-box.final {
    border-color: #475569;
    background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
  }

  .match-box.final-only {
    border-color: #cbd5e1;
  }

  .match-box.match-done {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }

  .match-box--hidden {
    opacity: 0;
    pointer-events: none;
  }

  .bracket-vs {
    font-size: 0.72rem;
    text-align: center;
    margin: 0.1rem 0;
  }

  .muted {
    color: #64748b;
  }

  .small {
    font-size: 0.85rem;
    margin: 0.25rem 0;
  }
</style>
