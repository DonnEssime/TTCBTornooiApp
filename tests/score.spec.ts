import { describe, it, expect } from 'vitest';
import { gameWinner, isGameScoreLegal, matchWinner, isMatchScoreLegal } from '../src/model';

describe('Table Tennis score legality', () => {
  it('should value a direct win 11-9 as valid score', () => {
    expect(gameWinner({ playerA: 11, playerB: 9 })).toBe('A');
    expect(isGameScoreLegal({ playerA: 11, playerB: 9 })).toBe(true);
  });

  it('should apply deuce rule at 10-10 and require two-point margin', () => {
    expect(gameWinner({ playerA: 10, playerB: 10 })).toBe(undefined);
    expect(isGameScoreLegal({ playerA: 10, playerB: 10 })).toBe(false);

    expect(gameWinner({ playerA: 11, playerB: 10 })).toBe(undefined);
    expect(isGameScoreLegal({ playerA: 11, playerB: 10 })).toBe(false);

    expect(gameWinner({ playerA: 12, playerB: 10 })).toBe('A');
    expect(isGameScoreLegal({ playerA: 12, playerB: 10 })).toBe(true);

    expect(gameWinner({ playerA: 13, playerB: 10 })).toBe(undefined);
    expect(isGameScoreLegal({ playerA: 13, playerB: 10 })).toBe(false);

    expect(gameWinner({ playerA: 13, playerB: 11 })).toBe('A');
    expect(isGameScoreLegal({ playerA: 13, playerB: 11 })).toBe(true);
  });

  it('should reject invalid game score with negative points', () => {
    expect(isGameScoreLegal({ playerA: -1, playerB: 11 })).toBe(false);
  });

  it('should reject non-finishing score like 11-10', () => {
    expect(gameWinner({ playerA: 11, playerB: 10 })).toBe(undefined);
    expect(isGameScoreLegal({ playerA: 11, playerB: 10 })).toBe(false);
  });

  it('should accept long deuce games with no upper score cap', () => {
    expect(isGameScoreLegal({ playerA: 32, playerB: 30 })).toBe(true);
    expect(isGameScoreLegal({ playerA: 110, playerB: 108 })).toBe(true);
  });

  it('should determine match winner in best-of-5 with 3 valid games', () => {
    const scores = [
      { playerA: 11, playerB: 9 },
      { playerA: 9, playerB: 11 },
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 8 },
    ];
    expect(matchWinner(scores)).toBe('A');
    expect(isMatchScoreLegal(scores)).toBe(true);
  });

  it('should reject match score with too many games beyond best-of', () => {
    const scores = [
      { playerA: 11, playerB: 1 },
      { playerA: 11, playerB: 2 },
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 4 },
    ];
    expect(isMatchScoreLegal(scores, 3)).toBe(false);
  });
});
