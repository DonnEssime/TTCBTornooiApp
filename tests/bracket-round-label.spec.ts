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
    expect(bracketKnockoutRoundMessageKey(1, b, 64)).toBe('ui.bracket.round.thirtySecond');
    expect(bracketKnockoutRoundMessageKey(4, b, 64)).toBe('ui.bracket.round.quarter');
    expect(bracketKnockoutRoundMessageKey(5, b, 64)).toBe('ui.bracket.round.half');
    expect(bracketKnockoutRoundMessageKey(6, b, 64)).toBe('ui.bracket.round.final');
    expect(bracketKnockoutRoundLabel('en', 3, b, 64)).toBe('1/8th');
    expect(bracketKnockoutRoundLabel('nl', 5, b, 64)).toBe('1/2e');
    expect(bracketKnockoutRoundLabel('nl', 6, b, 64)).toBe('finale');
  });

  it('names main-draw rounds for a 32-slot bracket', () => {
    const b = bracketWithRounds({ 1: 16, 2: 8, 3: 4, 4: 2, 5: 1 });
    expect(bracketKnockoutRoundLabel('en', 1, b, 32)).toBe('1/16th');
    expect(bracketKnockoutRoundLabel('en', 2, b, 32)).toBe('1/8th');
    expect(bracketKnockoutRoundLabel('en', 3, b, 32)).toBe('1/4th');
    expect(bracketKnockoutRoundLabel('en', 4, b, 32)).toBe('1/2nd');
    expect(bracketKnockoutRoundLabel('en', 5, b, 32)).toBe('final');
    expect(bracketKnockoutRoundLabel('nl', 4, b, 32)).toBe('1/2e');
    expect(bracketKnockoutRoundLabel('nl', 5, b, 32)).toBe('finale');
  });

  it('names main-draw rounds for a 16-slot bracket', () => {
    const b = bracketWithRounds({ 1: 8, 2: 4, 3: 2, 4: 1 });
    expect(bracketKnockoutRoundLabel('en', 1, b, 16)).toBe('1/8th');
    expect(bracketKnockoutRoundLabel('en', 2, b, 16)).toBe('1/4th');
    expect(bracketKnockoutRoundLabel('en', 3, b, 16)).toBe('1/2nd');
    expect(bracketKnockoutRoundLabel('en', 4, b, 16)).toBe('final');
    expect(bracketKnockoutRoundLabel('nl', 2, b, 16)).toBe('1/4e');
    expect(bracketKnockoutRoundLabel('nl', 3, b, 16)).toBe('1/2e');
  });

  it('names an 8-slot bracket through the final', () => {
    const b = bracketWithRounds({ 1: 4, 2: 2, 3: 1 });
    expect(bracketKnockoutRoundLabel('en', 1, b, 8)).toBe('1/4th');
    expect(bracketKnockoutRoundLabel('en', 2, b, 8)).toBe('1/2nd');
    expect(bracketKnockoutRoundLabel('en', 3, b, 8)).toBe('final');
  });

  it('falls back to numbered rounds for pre-main-draw tiers', () => {
    const b = bracketWithRounds({ 1: 8, 2: 8 });
    expect(bracketKnockoutRoundLabel('en', 1, b, 16)).toBe('Round 1');
    expect(bracketKnockoutRoundLabel('nl', 1, b, 16)).toBe('Ronde 1');
  });
});
