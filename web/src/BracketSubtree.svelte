<script lang="ts">
  import type { BracketMatch, Tournament } from 'ttc-tornooiapp';
  import type { BracketBNode } from './bracketStream/buildTree';
  import { bracketMatchHiddenInStream } from './bracketStream/byeMatch';
  import BracketSlotRow from './BracketSlotRow.svelte';
  import Subtree from './BracketSubtree.svelte';

  type Wing = 'left' | 'right';

  let {
    node,
    wing,
    tournament,
    bracketClassId = undefined,
    slotTitle,
    onPairingClick = undefined,
  }: {
    node: BracketBNode;
    wing: Wing;
    tournament: Tournament;
    bracketClassId?: string;
    slotTitle: (m: BracketMatch, side: 'a' | 'b') => string;
    onPairingClick?: (bm: BracketMatch, classId?: string) => void;
  } = $props();

  const isLeaf = $derived(!node.left && !node.right);
  const hidden = $derived(bracketMatchHiddenInStream(node.match));
  const topFeederHidden = $derived(node.left ? bracketMatchHiddenInStream(node.left.match) : false);
  const botFeederHidden = $derived(node.right ? bracketMatchHiddenInStream(node.right.match) : false);

  let subtreeEl: HTMLDivElement | undefined = $state();
  let parentEl: HTMLElement | undefined = $state();
  let feederTopEl: HTMLDivElement | undefined = $state();
  let feederBotEl: HTMLDivElement | undefined = $state();
  let topSrcPct = $state(25);
  let botSrcPct = $state(75);
  let parentTopPct = $state(25);
  let parentBotPct = $state(75);

  function slotPlayerId(m: BracketMatch, side: 'a' | 'b'): string | undefined {
    const id = side === 'a' ? m.seedA : m.seedB;
    return id && tournament.players[id] ? id : undefined;
  }

  function activate(m: BracketMatch): void {
    onPairingClick?.(m, bracketClassId);
  }

  function measureConnector(): void {
    if (!subtreeEl || !parentEl || !feederTopEl || !feederBotEl) return;
    const sRect = subtreeEl.getBoundingClientRect();
    const sH = sRect.height;
    if (sH <= 0) return;
    const sTop = sRect.top;
    const centerPct = (el: Element) => {
      const r = el.getBoundingClientRect();
      return ((r.top + r.height / 2 - sTop) / sH) * 100;
    };
    topSrcPct = centerPct(feederTopEl);
    botSrcPct = centerPct(feederBotEl);
    const p = parentEl.getBoundingClientRect();
    parentTopPct = ((p.top - sTop + p.height * 0.25) / sH) * 100;
    parentBotPct = ((p.top - sTop + p.height * 0.75) / sH) * 100;
  }

  $effect(() => {
    if (!subtreeEl || isLeaf) return;
    const ro = new ResizeObserver(() => measureConnector());
    ro.observe(subtreeEl);
    for (const el of [parentEl, feederTopEl, feederBotEl]) {
      if (el) ro.observe(el);
    }
    measureConnector();
    return () => ro.disconnect();
  });

  const connectorPathTop = $derived.by(() => {
    if (wing === 'right') {
      return `M 18 ${topSrcPct} L 9 ${topSrcPct} L 9 ${parentTopPct} L 0 ${parentTopPct}`;
    }
    return `M 0 ${topSrcPct} L 9 ${topSrcPct} L 9 ${parentTopPct} L 18 ${parentTopPct}`;
  });

  const connectorPathBot = $derived.by(() => {
    if (wing === 'right') {
      return `M 18 ${botSrcPct} L 9 ${botSrcPct} L 9 ${parentBotPct} L 0 ${parentBotPct}`;
    }
    return `M 0 ${botSrcPct} L 9 ${botSrcPct} L 9 ${parentBotPct} L 18 ${parentBotPct}`;
  });
</script>

{#if isLeaf}
  {#if onPairingClick}
    <button
      type="button"
      class="match-box leaf match-box--interactive"
      class:match-box--hidden={hidden}
      class:match-done={Boolean(node.match.winner)}
      onclick={() => activate(node.match)}
    >
      <BracketSlotRow
        {tournament}
        {bracketClassId}
        bm={node.match}
        side="a"
        label={slotTitle(node.match, 'a')}
        playerId={slotPlayerId(node.match, 'a')}
      />
      <div class="bracket-vs muted">vs</div>
      <BracketSlotRow
        {tournament}
        {bracketClassId}
        bm={node.match}
        side="b"
        label={slotTitle(node.match, 'b')}
        playerId={slotPlayerId(node.match, 'b')}
      />
    </button>
  {:else}
    <div class="match-box leaf" class:match-box--hidden={hidden} class:match-done={Boolean(node.match.winner)}>
      <BracketSlotRow
        {tournament}
        {bracketClassId}
        bm={node.match}
        side="a"
        label={slotTitle(node.match, 'a')}
        playerId={slotPlayerId(node.match, 'a')}
      />
      <div class="bracket-vs muted">vs</div>
      <BracketSlotRow
        {tournament}
        {bracketClassId}
        bm={node.match}
        side="b"
        label={slotTitle(node.match, 'b')}
        playerId={slotPlayerId(node.match, 'b')}
      />
    </div>
  {/if}
{:else}
  <div class="subtree" class:mirror={wing === 'right'} bind:this={subtreeEl}>
    <div class="feeders">
      <div class="feeder-cell" bind:this={feederTopEl}>
        <Subtree node={node.left!} {wing} {tournament} {bracketClassId} {slotTitle} {onPairingClick} />
      </div>
      <div class="feeder-cell" bind:this={feederBotEl}>
        <Subtree node={node.right!} {wing} {tournament} {bracketClassId} {slotTitle} {onPairingClick} />
      </div>
    </div>
    <div class="connector" aria-hidden="true">
      <svg viewBox="0 0 18 100" preserveAspectRatio="none" class="connector-svg">
        <path
          class="connector-path"
          class:connector-path--hidden={topFeederHidden}
          d={connectorPathTop}
          vector-effect="non-scaling-stroke"
        />
        <path
          class="connector-path"
          class:connector-path--hidden={botFeederHidden}
          d={connectorPathBot}
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>
    {#if onPairingClick}
      <button
        type="button"
        class="match-box parent match-box--interactive"
        class:match-box--hidden={hidden}
        class:match-done={Boolean(node.match.winner)}
        bind:this={parentEl}
        onclick={() => activate(node.match)}
      >
        <BracketSlotRow
          {tournament}
          {bracketClassId}
          bm={node.match}
          side="a"
          label={slotTitle(node.match, 'a')}
          playerId={slotPlayerId(node.match, 'a')}
        />
        <div class="bracket-vs muted">vs</div>
        <BracketSlotRow
          {tournament}
          {bracketClassId}
          bm={node.match}
          side="b"
          label={slotTitle(node.match, 'b')}
          playerId={slotPlayerId(node.match, 'b')}
        />
      </button>
    {:else}
      <div
        class="match-box parent"
        class:match-box--hidden={hidden}
        class:match-done={Boolean(node.match.winner)}
        bind:this={parentEl}
      >
        <BracketSlotRow
          {tournament}
          {bracketClassId}
          bm={node.match}
          side="a"
          label={slotTitle(node.match, 'a')}
          playerId={slotPlayerId(node.match, 'a')}
        />
        <div class="bracket-vs muted">vs</div>
        <BracketSlotRow
          {tournament}
          {bracketClassId}
          bm={node.match}
          side="b"
          label={slotTitle(node.match, 'b')}
          playerId={slotPlayerId(node.match, 'b')}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .subtree {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 0;
    flex: 0 1 auto;
  }

  .subtree.mirror {
    flex-direction: row-reverse;
  }

  .feeders {
    display: grid;
    grid-template-rows: 1fr 1fr;
    align-items: stretch;
    min-height: 5.5rem;
    flex: 0 1 auto;
  }

  .feeder-cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-height: 0;
  }

  .connector {
    flex: 0 0 1.125rem;
    width: 1.125rem;
    min-height: 4rem;
    align-self: stretch;
    position: relative;
  }

  .connector-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .connector-path {
    fill: none;
    stroke: #94a3b8;
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .connector-path--hidden {
    opacity: 0;
  }

  .match-box--hidden {
    opacity: 0;
    pointer-events: none;
  }

  .match-box {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 0.35rem 0.45rem;
    background: #fff;
    font-size: 0.82rem;
    line-height: 1.25;
    min-width: 7.5rem;
    max-width: 11rem;
    flex: 0 0 auto;
    align-self: center;
  }

  .match-box--interactive {
    cursor: pointer;
    text-align: inherit;
    font: inherit;
    color: inherit;
    appearance: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .match-box--interactive:hover {
    border-color: #0f766e;
    box-shadow: 0 2px 8px rgb(15 23 42 / 0.08);
  }

  .match-box--interactive:focus-visible {
    outline: 2px solid #0d9488;
    outline-offset: 2px;
  }

  .match-box.leaf {
    min-height: 3.35rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .match-box.parent {
    min-height: 3.35rem;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .match-box.match-done {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }

  .bracket-vs {
    font-size: 0.72rem;
    text-align: center;
    margin: 0.1rem 0;
  }

  .muted {
    color: #64748b;
  }
</style>
