import { describe, expect, it } from 'vitest';
import { shuffleDoublesFixturesForFour } from '../src/model';

describe('shuffleDoublesFixturesForFour', () => {
  it('returns exactly three fixtures for four players', () => {
    const fixtures = shuffleDoublesFixturesForFour(['a', 'b', 'c', 'd']);
    expect(fixtures).toHaveLength(3);
  });

  it('covers AB-CD, AC-BD, AD-BC pairings', () => {
    const fixtures = shuffleDoublesFixturesForFour(['a', 'b', 'c', 'd']);
    const keys = fixtures.map((f) =>
      [...f.teamA].sort().join('+') + ' vs ' + [...f.teamB].sort().join('+'),
    );
    expect(keys).toContain('a+b vs c+d');
    expect(keys).toContain('a+c vs b+d');
    expect(keys).toContain('a+d vs b+c');
  });

  it('each player partners with every other player exactly once', () => {
    const fixtures = shuffleDoublesFixturesForFour(['p1', 'p2', 'p3', 'p4']);
    const partners: Record<string, Set<string>> = {
      p1: new Set(),
      p2: new Set(),
      p3: new Set(),
      p4: new Set(),
    };
    for (const f of fixtures) {
      partners[f.teamA[0]]!.add(f.teamA[1]!);
      partners[f.teamA[1]]!.add(f.teamA[0]!);
      partners[f.teamB[0]]!.add(f.teamB[1]!);
      partners[f.teamB[1]]!.add(f.teamB[0]!);
    }
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      expect(partners[pid]!.size).toBe(3);
    }
  });

  it('assigns shuffleRound 0, 1, 2 in order', () => {
    const fixtures = shuffleDoublesFixturesForFour(['a', 'b', 'c', 'd']);
    expect(fixtures.map((f) => f.shuffleRound)).toEqual([0, 1, 2]);
  });
});
