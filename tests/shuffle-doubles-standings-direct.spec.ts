import { describe, expect, it } from 'vitest';
import { createTournament, groupStandingsRowsForShuffleDoubles } from '../src/model';
import type { Match } from '../src/model';

describe('shuffle standings direct', () => {
  it('credits team members from manual tournament state', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'p1', handicap: 0 },
      p2: { id: 'p2', name: 'p2', handicap: 0 },
      p3: { id: 'p3', name: 'p3', handicap: 0 },
      p4: { id: 'p4', name: 'p4', handicap: 0 },
    };
    t.competitionFormat = 'doubles-shuffle-partners';
    t.groups = { '1': { id: '1', playerIds: ['p1', 'p2', 'p3', 'p4'] } };
    t.matches = {
      m0: {
        id: 'm0',
        playerA: 'p1',
        playerB: 'p3',
        teamA: ['p1', 'p2'],
        teamB: ['p3', 'p4'],
        shuffleRound: 0,
        scores: [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 6 },
          { playerA: 11, playerB: 4 },
        ],
        status: 'finished',
        winner: 'p1',
        groupId: '1',
      } as Match,
    };
    const rows = groupStandingsRowsForShuffleDoubles(t, t.groups['1']!, undefined);
    const p1 = rows.find((r) => r.pid === 'p1');
    expect(p1?.w).toBe(1);
    expect(p1?.l).toBe(0);
  });
});
