import { describe, it, expect } from 'vitest';
import type { BracketMatch } from '../src/model';
import {
  bracketKnockoutRoundLabel,
  bracketKnockoutRoundMessageKey,
} from '../src/i18n/bracket-round';

function bracketWithRounds(roundCounts: Record<number, number>): BracketMatch[] {
  const out: BracketMatch[] = [];
  for (const [round, count] of Object.entries(roundCounts)) {
    const r = Number(round);
    for (let i = 0; i < count; i++) {
      out.push({ id: `m-${r}-${i}`, round: r, seedA: `a-${r}-${i}`, seedB: `b-${r}-${i}` });
    }
  }
  return out;
}

describe('bracketKnockoutRoundLabel', () => {
  it('names main-draw rounds for a 64-slot bracket', () => {
    const b = bracketWithRounds({ 1: 32, 2: 16, 3: 8, 4: 4, 5: 2, 6: 1 });
    expect(bracketKnockoutRoundMessageKey(1, b, 64)).toBe('ui.bracket.round.sixtyFourth');
    expect(bracketKnockoutRoundMessageKey(4, b, 64)).toBe('ui.bracket.round.eighth');
    expect(bracketKnockoutRoundMessageKey(5, b, 64)).toBe('ui.bracket.round.half');
    expect(bracketKnockoutRoundMessageKey(6, b, 64)).toBe('ui.bracket.round.final');
    expect(bracketKnockoutRoundLabel('en', 3, b, 64)).toBe('1/16th');
    expect(bracketKnockoutRoundLabel('nl', 5, b, 64)).toBe('1/2e');
    expect(bracketKnockoutRoundLabel('nl', 6, b, 64)).toBe('finale');
  });

  it('uses semi (1/2) before the final in larger draws', () => {
    const b = bracketWithRounds({ 1: 32, 2: 16, 3: 8, 4: 4, 5: 2 });
    expect(bracketKnockoutRoundMessageKey(5, b, 64)).toBe('ui.bracket.round.half');
    expect(bracketKnockoutRoundLabel('en', 5, b, 64)).toBe('1/2nd');
  });

  it('names an 8-slot bracket through the final', () => {
    const b = bracketWithRounds({ 1: 4, 2: 2, 3: 1 });
    expect(bracketKnockoutRoundLabel('en', 1, b, 8)).toBe('1/8th');
    expect(bracketKnockoutRoundLabel('en', 2, b, 8)).toBe('1/4th');
    expect(bracketKnockoutRoundLabel('en', 3, b, 8)).toBe('final');
  });

  it('falls back to numbered rounds for pre-main-draw tiers', () => {
    const b = bracketWithRounds({ 1: 8, 2: 8 });
    expect(bracketKnockoutRoundLabel('en', 1, b, 16)).toBe('Round 1');
    expect(bracketKnockoutRoundLabel('nl', 1, b, 16)).toBe('Ronde 1');
  });
});
