import { describe, it, expect } from 'vitest';
import { createTournament, forfeitPlayer, forfeitTeam, generateBracket, advanceBracketRound, areTopSeedsSeparated, settleBracketWinners, scheduleRound } from '../src/model';

describe('Bracket generation', () => {
  it('generates 8-player bracket without byes (standard seeding)', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });

    expect(bracket).toHaveLength(4);
    expect(bracket.map((m) => [m.seedA, m.seedB])).toEqual([
      ['p1', 'p8'],
      ['p4', 'p5'],
      ['p2', 'p7'],
      ['p3', 'p6'],
    ]);
  });

  it('fills byes to next power of two for 6 players', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const bracket = generateBracket(seedings, { fillByes: true, cullToPowerOfTwo: false });

    expect(bracket).toHaveLength(4);
    // top seeds get byes automatically in the first-round structure
    const winners = bracket.map((m) => m.winner);
    expect(winners).toEqual([undefined, 'p2', undefined, undefined]);
    // first match is p1 vs BYE i.e. p1 advances indirectly; second is p4 vs p5 etc.
    expect(bracket[0]).toMatchObject({ seedA: 'p1', seedB: undefined });
    expect(bracket[1]).toMatchObject({ seedA: 'p4', seedB: 'p5' });
  });

  it('culls to previous power of two when requested', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: true });

    expect(bracket).toHaveLength(2);
    expect(bracket.map((m) => [m.seedA, m.seedB])).toEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
    ]);
  });

  it('advances bracket round after all winners are present', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });

    bracket[0].winner = 'p1';
    bracket[1].winner = 'p3';

    const tournament = { players: {}, teams: {}, matches: {}, teamMatches: {}, bracketMatches: bracket, seedings: [] } as any;
    advanceBracketRound(tournament);

    expect(tournament.bracketMatches.some((m: any) => m.round === 2)).toBe(true);
    const secondRound = tournament.bracketMatches.filter((m: any) => m.round === 2);
    expect(secondRound).toHaveLength(1);
    expect(secondRound[0]).toMatchObject({ seedA: 'p1', seedB: 'p3' });
  });

  it('places top two seeds in opposite halves', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });

    expect(areTopSeedsSeparated(bracket, 'p1', 'p2')).toBe(true);
  });

  it('resolves bracket winners from finished team matches and can assign tables', () => {
    const tournament = {
      players: {},
      teams: { t1: { id: 't1', name: 'Team 1', memberIds: [] }, t2: { id: 't2', name: 'Team 2', memberIds: [] } },
      matches: {},
      teamMatches: {
        tm1: { id: 'tm1', teamA: 't1', teamB: 't2', scores: [{ playerA: 11, playerB: 5 }, { playerA: 11, playerB: 7 }], status: 'finished', winner: 't1' },
      },
      bracketMatches: [{ id: 'm1', seedA: 't1', seedB: 't2', round: 1 }],
      tableAssignments: [],
      seedings: ['t1', 't2'],
    } as any;

    settleBracketWinners(tournament);
    expect(tournament.bracketMatches[0].winner).toBe('t1');

    scheduleRound(tournament, ['T1', 'T2'], 1);
    expect(tournament.tableAssignments).toEqual([{ tableId: 'T1', matchId: 'm1', round: 1 }]);
  });

  it('advances bracket match when a seeded player forfeits in bracket', () => {
    const tournament = createTournament();
    tournament.players['p1'] = { id: 'p1', name: 'Alice', handicap: 0 };
    tournament.players['p2'] = { id: 'p2', name: 'Bob', handicap: 0 };
    tournament.bracketMatches = [{ id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 }];

    forfeitPlayer(tournament, 'p1', 'bracket');
    settleBracketWinners(tournament);

    expect(tournament.bracketMatches[0].winner).toBe('p2');
  });

  it('advances bracket match when a seeded team forfeits in bracket', () => {
    const tournament = createTournament();
    tournament.teams['t1'] = { id: 't1', name: 'Team 1', memberIds: [] };
    tournament.teams['t2'] = { id: 't2', name: 'Team 2', memberIds: [] };
    tournament.bracketMatches = [{ id: 'm2', seedA: 't1', seedB: 't2', round: 1 }];

    forfeitTeam(tournament, 't1', 'bracket');
    settleBracketWinners(tournament);

    expect(tournament.bracketMatches[0].winner).toBe('t2');
  });
});
