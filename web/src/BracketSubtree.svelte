<script lang="ts">
  import type { BracketMatch } from 'ttc-tornooiapp';
  import type { BracketBNode } from './bracketStream/buildTree';
  import { bracketSlotOutcome } from './bracketStream/slotOutcome';
  import Subtree from './BracketSubtree.svelte';

  type Wing = 'left' | 'right';

  let {
    node,
    wing,
    slotTitle,
    onPairingClick = undefined,
  }: {
    node: BracketBNode;
    wing: Wing;
    slotTitle: (m: BracketMatch, side: 'a' | 'b') => string;
    onPairingClick?: (bm: BracketMatch) => void;
  } = $props();

  const isLeaf = $derived(!node.left && !node.right);

  function activate(m: BracketMatch): void {
    onPairingClick?.(m);
  }
</script>

{#if isLeaf}
  {#if onPairingClick}
    <button
      type="button"
      class="match-box leaf match-box--interactive"
      class:match-done={Boolean(node.match.winner)}
      onclick={() => activate(node.match)}
    >
      <div
        class="bracket-slot"
        class:bracket-slot--winner={bracketSlotOutcome(node.match, 'a') === 'winner'}
        class:bracket-slot--loser={bracketSlotOutcome(node.match, 'a') === 'loser'}
      >
        {slotTitle(node.match, 'a')}
      </div>
      <div class="bracket-vs muted">vs</div>
      <div
        class="bracket-slot"
        class:bracket-slot--winner={bracketSlotOutcome(node.match, 'b') === 'winner'}
        class:bracket-slot--loser={bracketSlotOutcome(node.match, 'b') === 'loser'}
      >
        {slotTitle(node.match, 'b')}
      </div>
    </button>
  {:else}
    <div class="match-box leaf" class:match-done={Boolean(node.match.winner)}>
      <div
        class="bracket-slot"
        class:bracket-slot--winner={bracketSlotOutcome(node.match, 'a') === 'winner'}
        class:bracket-slot--loser={bracketSlotOutcome(node.match, 'a') === 'loser'}
      >
        {slotTitle(node.match, 'a')}
      </div>
      <div class="bracket-vs muted">vs</div>
      <div
        class="bracket-slot"
        class:bracket-slot--winner={bracketSlotOutcome(node.match, 'b') === 'winner'}
        class:bracket-slot--loser={bracketSlotOutcome(node.match, 'b') === 'loser'}
      >
        {slotTitle(node.match, 'b')}
      </div>
    </div>
  {/if}
{:else}
  <div class="subtree" class:mirror={wing === 'right'}>
    <div class="feeders">
      <div class="feeder-cell">
        <Subtree node={node.left!} {wing} {slotTitle} {onPairingClick} />
      </div>
      <div class="feeder-cell">
        <Subtree node={node.right!} {wing} {slotTitle} {onPairingClick} />
      </div>
    </div>
    <div class="connector" aria-hidden="true">
      <svg viewBox="0 0 18 100" preserveAspectRatio="none" class="connector-svg">
        {#if wing === 'right'}
          <!-- Feeders on the visual right after row-reverse; merge toward parent on the left -->
          <path
            class="connector-path"
            d="M 18 25 L 9 25 L 9 50 L 0 50 M 18 75 L 9 75 L 9 50"
            vector-effect="non-scaling-stroke"
          />
        {:else}
          <path
            class="connector-path"
            d="M 0 25 L 9 25 L 9 50 L 18 50 M 0 75 L 9 75 L 9 50"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      </svg>
    </div>
    {#if onPairingClick}
      <button
        type="button"
        class="match-box parent match-box--interactive"
        class:match-done={Boolean(node.match.winner)}
        onclick={() => activate(node.match)}
      >
        <div
          class="bracket-slot"
          class:bracket-slot--winner={bracketSlotOutcome(node.match, 'a') === 'winner'}
          class:bracket-slot--loser={bracketSlotOutcome(node.match, 'a') === 'loser'}
        >
          {slotTitle(node.match, 'a')}
        </div>
        <div class="bracket-vs muted">vs</div>
        <div
          class="bracket-slot"
          class:bracket-slot--winner={bracketSlotOutcome(node.match, 'b') === 'winner'}
          class:bracket-slot--loser={bracketSlotOutcome(node.match, 'b') === 'loser'}
        >
          {slotTitle(node.match, 'b')}
        </div>
      </button>
    {:else}
      <div class="match-box parent" class:match-done={Boolean(node.match.winner)}>
        <div
          class="bracket-slot"
          class:bracket-slot--winner={bracketSlotOutcome(node.match, 'a') === 'winner'}
          class:bracket-slot--loser={bracketSlotOutcome(node.match, 'a') === 'loser'}
        >
          {slotTitle(node.match, 'a')}
        </div>
        <div class="bracket-vs muted">vs</div>
        <div
          class="bracket-slot"
          class:bracket-slot--winner={bracketSlotOutcome(node.match, 'b') === 'winner'}
          class:bracket-slot--loser={bracketSlotOutcome(node.match, 'b') === 'loser'}
        >
          {slotTitle(node.match, 'b')}
        </div>
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

  .bracket-slot {
    font-weight: 600;
    word-break: break-word;
  }

  .bracket-slot--winner {
    font-weight: 700;
    color: #0f172a;
  }

  .bracket-slot--loser {
    text-decoration: line-through;
    font-weight: 500;
    color: #64748b;
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
