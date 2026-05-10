<script lang="ts">
  import type { BracketMatch, Tournament } from 'ttc-tornooiapp';
  import BracketSubtree from './BracketSubtree.svelte';
  import { bracketTreeFromColumns } from './bracketStream/buildTree';
  import { bracketSlotOutcome } from './bracketStream/slotOutcome';

  let {
    cols,
    tournament,
    slotTitle,
    bracketClassId = undefined,
    ariaLabel = 'Knockout bracket',
    emptyMessage = 'Add players on the Players tab to preview the tree.',
  }: {
    cols: BracketMatch[][];
    tournament: Tournament;
    slotTitle: (m: BracketMatch, side: 'a' | 'b', t: Tournament, classId?: string) => string;
    /** When set (multi-class track), group placeholders resolve against this class slice. */
    bracketClassId?: string;
    ariaLabel?: string;
    emptyMessage?: string;
  } = $props();

  const root = $derived(bracketTreeFromColumns(cols));

  function slot(m: BracketMatch, side: 'a' | 'b'): string {
    return slotTitle(m, side, tournament, bracketClassId);
  }
</script>

<div class="bracket-stream" role="img" aria-label={ariaLabel}>
  {#if !root}
    <p class="muted small">{emptyMessage}</p>
  {:else if !root.left || !root.right}
    <div class="stream-single">
      <div class="match-box final-only" class:match-done={Boolean(root.match.winner)}>
        <div
          class="bracket-slot"
          class:bracket-slot--winner={bracketSlotOutcome(root.match, 'a') === 'winner'}
          class:bracket-slot--loser={bracketSlotOutcome(root.match, 'a') === 'loser'}
        >
          {slot(root.match, 'a')}
        </div>
        <div class="bracket-vs muted">vs</div>
        <div
          class="bracket-slot"
          class:bracket-slot--winner={bracketSlotOutcome(root.match, 'b') === 'winner'}
          class:bracket-slot--loser={bracketSlotOutcome(root.match, 'b') === 'loser'}
        >
          {slot(root.match, 'b')}
        </div>
      </div>
    </div>
  {:else}
    <div class="stream-inner">
      <div class="wing left">
        <BracketSubtree node={root.left} wing="left" slotTitle={slot} />
      </div>
      <div class="join-to-final" aria-hidden="true">
        <svg viewBox="0 0 18 100" preserveAspectRatio="none" class="join-svg">
          <path
            class="join-path"
            d="M 0 50 L 18 50"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div class="final-col">
        <div class="match-box final" class:match-done={Boolean(root.match.winner)}>
          <div
            class="bracket-slot"
            class:bracket-slot--winner={bracketSlotOutcome(root.match, 'a') === 'winner'}
            class:bracket-slot--loser={bracketSlotOutcome(root.match, 'a') === 'loser'}
          >
            {slot(root.match, 'a')}
          </div>
          <div class="bracket-vs muted">vs</div>
          <div
            class="bracket-slot"
            class:bracket-slot--winner={bracketSlotOutcome(root.match, 'b') === 'winner'}
            class:bracket-slot--loser={bracketSlotOutcome(root.match, 'b') === 'loser'}
          >
            {slot(root.match, 'b')}
          </div>
        </div>
      </div>
      <div class="join-to-final" aria-hidden="true">
        <svg viewBox="0 0 18 100" preserveAspectRatio="none" class="join-svg">
          <path class="join-path" d="M 0 50 L 18 50" vector-effect="non-scaling-stroke" />
        </svg>
      </div>
      <div class="wing right">
        <BracketSubtree node={root.right} wing="right" slotTitle={slot} />
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

  .small {
    font-size: 0.85rem;
    margin: 0.25rem 0;
  }
</style>
