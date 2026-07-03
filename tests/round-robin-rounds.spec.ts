import { describe, expect, it } from 'vitest';
import {
  roundRobinMatchRounds,
  roundRobinPairKey,
  roundRobinPairs,
  roundRobinRoundIndexForPair,
} from '../src/model';

function players(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function roundPairKeys(round: Array<[string, string]>): string[] {
  return round.map(([a, b]) => roundRobinPairKey(a, b)).sort();
}

function allPairKeys(rounds: Array<Array<[string, string]>>): string[] {
  return rounds.flatMap((r) => roundPairKeys(r)).sort();
}

describe('roundRobinMatchRounds', () => {
  it.each([
    [4, 3],
    [5, 5],
    [6, 5],
    [7, 7],
  ] as const)('N=%i yields %i rounds with floor(N/2) matches each', (n, expectedRounds) => {
    const ids = players(n);
    const rounds = roundRobinMatchRounds(ids);
    expect(rounds).toHaveLength(expectedRounds);
    for (const round of rounds) {
      expect(round).toHaveLength(Math.floor(n / 2));
    }
  });

  it('no participant appears twice in the same round', () => {
    for (const n of [4, 5, 6, 7]) {
      const ids = players(n);
      for (const round of roundRobinMatchRounds(ids)) {
        const seen = new Set<string>();
        for (const [a, b] of round) {
          expect(seen.has(a)).toBe(false);
          expect(seen.has(b)).toBe(false);
          seen.add(a);
          seen.add(b);
        }
      }
    }
  });

  it('union of rounds equals roundRobinPairs (sorted keys)', () => {
    for (const n of [4, 5, 6, 7]) {
      const ids = players(n);
      const fromRounds = allPairKeys(roundRobinMatchRounds(ids));
      const fromPairs = roundRobinPairs(ids).map(([a, b]) => roundRobinPairKey(a, b)).sort();
      expect(fromRounds).toEqual(fromPairs);
    }
  });

  it('is deterministic for the same participant order', () => {
    const ids = ['c', 'a', 'b'];
    const a = roundRobinMatchRounds(ids);
    const b = roundRobinMatchRounds(ids);
    expect(a).toEqual(b);
    expect(a).not.toEqual(roundRobinMatchRounds(['a', 'b', 'c']));
  });

  it('roundRobinRoundIndexForPair finds the correct round', () => {
    const ids = players(4);
    const rounds = roundRobinMatchRounds(ids);
    for (let i = 0; i < rounds.length; i++) {
      for (const [a, b] of rounds[i]!) {
        expect(roundRobinRoundIndexForPair(ids, a, b)).toBe(i);
        expect(roundRobinRoundIndexForPair(ids, b, a)).toBe(i);
      }
    }
  });
});
