import { describe, it, expect } from 'vitest';
import type { Match, Tournament } from '../src/model';
import { roundRobinMatchRounds } from '../src/model';
import {
  estimateScheduleWaves,
  groupCompletedRoundCount,
  groupPhaseCounts,
  groupRoundStaggeredOrder,
  minWavesAvoidBackToBackOrder,
} from '../src/match-ordering';

describe('groupPhaseCounts', () => {
  it('counts finished and in-progress matches separately', () => {
    const matches: Match[] = [
      {
        id: 'm1',
        playerA: 'a',
        playerB: 'b',
        scores: [{ a: 11, b: 0 }],
        status: 'finished',
        winner: 'a',
        groupId: 'g1',
      },
      {
        id: 'm2',
        playerA: 'c',
        playerB: 'd',
        scores: [],
        status: 'in-progress',
        groupId: 'g1',
      },
      {
        id: 'm3',
        playerA: 'e',
        playerB: 'f',
        scores: [],
        status: 'scheduled',
        groupId: 'g1',
      },
      {
        id: 'm4',
        playerA: 'g',
        playerB: 'h',
        scores: [],
        status: 'in-progress',
        groupId: 'g1',
      },
    ];
    expect(groupPhaseCounts(matches)).toEqual({ total: 4, done: 1, inProgress: 2 });
  });

  it('treats finished-without-winner as not done and not in-progress', () => {
    expect(
      groupPhaseCounts([
        {
          id: 'm1',
          playerA: 'a',
          playerB: 'b',
          scores: [],
          status: 'finished',
          groupId: 'g1',
        },
      ]),
    ).toEqual({ total: 1, done: 0, inProgress: 0 });
  });
});

function mkMatch(
  id: string,
  playerA: string,
  playerB: string,
  groupId: string,
  done = false,
): Match {
  return {
    id,
    playerA,
    playerB,
    groupId,
    classId: undefined,
    status: done ? 'finished' : 'scheduled',
    winner: done ? playerA : undefined,
    scores: done ? [{ playerA: 11, playerB: 0 }] : [],
  };
}

function mkTournament(groupDefs: Record<string, string[]>, matches: Record<string, Match>): Tournament {
  return {
    players: {},
    teams: {},
    matches,
    teamMatches: {},
    bracketMatches: [],
    matchFinishOrder: [],
    tables: [],
    tableAssignments: [],
    seedings: [],
    groups: Object.fromEntries(
      Object.entries(groupDefs).map(([id, playerIds]) => [id, { id, playerIds }]),
    ),
    forfeits: { players: {}, teams: {} },
    forfeitResults: { playerWins: {} },
    lockedBracketRounds: [],
    classDefinitions: [],
    playerClassFlags: {},
    classTournaments: {},
  };
}

describe('group round ordering', () => {
  it('emits a full round at once for the least-complete group', () => {
    const pids = ['a', 'b', 'c', 'd'];
    const rounds = roundRobinMatchRounds(pids);
    const g1Matches: Record<string, Match> = {};
    for (const [a, b] of rounds[0]!) {
      const id = `g1-${a}-${b}`;
      g1Matches[id] = mkMatch(id, a, b, '1');
    }
    for (const [a, b] of rounds[1]!) {
      const id = `g1-${a}-${b}`;
      g1Matches[id] = mkMatch(id, a, b, '1');
    }
    const g2a = mkMatch('g2-a', 'e', 'f', '2');
    const t = mkTournament({ '1': pids, '2': ['e', 'f', 'g', 'h'] }, { ...g1Matches, 'g2-a': g2a });

    const ready = Object.values(g1Matches).concat([g2a]);
    const order = groupRoundStaggeredOrder(ready, t);

    expect(order).toHaveLength(5);
    expect(order[0]?.groupId).toBe('1');
    expect(order[1]?.groupId).toBe('1');
    expect(order[2]?.groupId).toBe('2');
    expect(order[3]?.groupId).toBe('1');
    expect(order[4]?.groupId).toBe('1');

    const round0Keys = new Set(rounds[0]!.map(([a, b]) => `${a}\t${b}`));
    for (const m of order.slice(0, 2)) {
      const key = m.playerA < m.playerB ? `${m.playerA}\t${m.playerB}` : `${m.playerB}\t${m.playerA}`;
      expect(round0Keys.has(key)).toBe(true);
    }
  });

  it('after round 1 is complete, next batch is entire round 2', () => {
    const pids = ['a', 'b', 'c', 'd'];
    const rounds = roundRobinMatchRounds(pids);
    const matches: Record<string, Match> = {};
    for (const [a, b] of rounds[0]!) {
      const id = `r0-${a}-${b}`;
      matches[id] = mkMatch(id, a, b, '1', true);
    }
    for (const [a, b] of rounds[1]!) {
      const id = `r1-${a}-${b}`;
      matches[id] = mkMatch(id, a, b, '1');
    }
    const t = mkTournament({ '1': pids }, matches);
    const ready = Object.values(matches).filter((m) => m.status === 'scheduled');
    const order = groupRoundStaggeredOrder(ready, t);
    expect(order).toHaveLength(2);
    expect(order.every((m) => m.id.startsWith('r1-'))).toBe(true);
  });

  it('partially finished round emits only remaining matches from that round', () => {
    const pids = ['a', 'b', 'c', 'd'];
    const rounds = roundRobinMatchRounds(pids);
    const [a0, b0] = rounds[0]![0]!;
    const done = mkMatch('done', a0, b0, '1', true);
    const [a1, b1] = rounds[0]![1]!;
    const open = mkMatch('open', a1, b1, '1');
    const t = mkTournament({ '1': pids }, { done, open });
    const order = groupRoundStaggeredOrder([open], t);
    expect(order.map((m) => m.id)).toEqual(['open']);
    expect(groupCompletedRoundCount(Object.values(t.matches), pids)).toBe(0);
  });
});

describe('match ordering penalties', () => {
  it('estimateScheduleWaves counts parallel table-limited waves in display order', () => {
    const slot = (a: string, b: string) => ({ playerA: a, playerB: b });
    expect(estimateScheduleWaves([], 4)).toBe(0);
    expect(estimateScheduleWaves([slot('a', 'b')], 0)).toBe(0);
    expect(estimateScheduleWaves([slot('a', 'b'), slot('c', 'd')], 2)).toBe(1);
    expect(estimateScheduleWaves([slot('a', 'b'), slot('c', 'd'), slot('e', 'f')], 2)).toBe(2);
    expect(estimateScheduleWaves([slot('a', 'b'), slot('a', 'c'), slot('d', 'e')], 3)).toBe(2);
  });

  it('minWavesAvoidBackToBackOrder reduces wave count when display order is bad', () => {
    const m1 = mkMatch('m1', 'a', 'b', '1');
    const m2 = mkMatch('m2', 'c', 'd', '1');
    const m3 = mkMatch('m3', 'e', 'f', '1');
    const m4 = mkMatch('m4', 'a', 'c', '1');

    const inOrder = [m1, m4, m2, m3];
    const optimized = minWavesAvoidBackToBackOrder(inOrder, {
      tableCount: 2,
      pastFinishedInOrder: [],
      inProgressInAssignmentOrder: [],
    });

    const slots = (ms: Match[]) => ms.map((m) => ({ playerA: m.playerA, playerB: m.playerB }));
    const wavesBefore = estimateScheduleWaves(slots(inOrder), 2);
    const wavesAfter = estimateScheduleWaves(slots(optimized), 2);
    expect(wavesAfter).toBeLessThanOrEqual(wavesBefore);
    expect(wavesAfter).toBe(2);
  });

  it('minWavesAvoidBackToBackOrder uses preferred order as tie-break', () => {
    const a = mkMatch('a', 'p1', 'p2', '1');
    const b = mkMatch('b', 'p3', 'p4', '1');
    const c = mkMatch('c', 'p5', 'p6', '1');
    const d = mkMatch('d', 'p7', 'p8', '1');
    const ready = [a, b, c, d];

    const preferred = ['c', 'a', 'd', 'b'];
    const optimized = minWavesAvoidBackToBackOrder(ready, {
      tableCount: 2,
      pastFinishedInOrder: [],
      inProgressInAssignmentOrder: [],
      preferredReadyOrderIds: preferred,
    });

    expect(optimized.map((m) => m.id)).toEqual(preferred);
  });
});
