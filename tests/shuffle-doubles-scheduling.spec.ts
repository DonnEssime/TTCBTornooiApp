import { describe, expect, it } from 'vitest';
import { createTournament, planFillEmptyTablesFromReady } from '../src/model';
import { estimateScheduleWaves } from '../src/match-ordering';
import { allPlayersInMatch } from '../src/doubles-track';

describe('shuffle doubles scheduling', () => {
  it('planFillEmptyTablesFromReady skips shuffle match when group player is busy', () => {
    const t = createTournament();
    t.tables = ['1', '2'];
    t.matches = {
      m1: {
        id: 'm1',
        playerA: 'p1',
        playerB: 'p3',
        teamA: ['p1', 'p2'],
        teamB: ['p3', 'p4'],
        scores: [],
        status: 'in-progress',
        groupId: '1',
      },
      m2: {
        id: 'm2',
        playerA: 'p1',
        playerB: 'p2',
        teamA: ['p1', 'p3'],
        teamB: ['p2', 'p4'],
        scores: [],
        status: 'scheduled',
        groupId: '1',
      },
    };
    const plan = planFillEmptyTablesFromReady(t, ['m2']);
    expect(plan.length).toBe(0);
  });

  it('planFillEmptyTablesFromReady assigns unrelated shuffle group match', () => {
    const t = createTournament();
    t.tables = ['1', '2'];
    t.matches = {
      m1: {
        id: 'm1',
        playerA: 'p1',
        playerB: 'p3',
        teamA: ['p1', 'p2'],
        teamB: ['p3', 'p4'],
        scores: [],
        status: 'in-progress',
        groupId: '1',
      },
      m2: {
        id: 'm2',
        playerA: 'p5',
        playerB: 'p7',
        teamA: ['p5', 'p6'],
        teamB: ['p7', 'p8'],
        scores: [],
        status: 'scheduled',
        groupId: '2',
      },
    };
    const plan = planFillEmptyTablesFromReady(t, ['m2']);
    expect(plan.length).toBe(1);
    expect(plan[0]!.matchId).toBe('m2');
  });

  it('estimateScheduleWaves cannot run two same-group shuffle matches in one wave', () => {
    const slots = [
      { playerA: 'p1', playerB: 'p3', playerIds: ['p1', 'p2', 'p3', 'p4'] },
      { playerA: 'p1', playerB: 'p2', playerIds: ['p1', 'p2', 'p3', 'p4'] },
    ];
    expect(estimateScheduleWaves(slots, 2)).toBe(2);
  });

  it('allPlayersInMatch returns four ids for shuffle match', () => {
    const t = createTournament();
    const m = {
      id: 'm1',
      playerA: 'p1',
      playerB: 'p3',
      teamA: ['p1', 'p2'] as [string, string],
      teamB: ['p3', 'p4'] as [string, string],
      scores: [],
      status: 'scheduled' as const,
    };
    expect(allPlayersInMatch(t, m).length).toBe(4);
  });
});
