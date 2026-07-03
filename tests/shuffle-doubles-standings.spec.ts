import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  groupStandingsRowsForBracket,
  groupStandingsRowsForShuffleDoubles,
  setsAndPointsWonInGroupForPlayer,
} from '../src/model';

describe('shuffle doubles standings', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function setupGroupWithScores(): { runner: CommandRunner; groupId: string } {
    const runner = new CommandRunner();
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      runner.execute({
        id,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: id, handicap: 0 },
        timestamp: ts,
      });
    }
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: {
        groups: [{ id: '1', playerIds: ['p1', 'p2', 'p3', 'p4'] }],
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    const t = runner.getTournament();
    const groupId = Object.keys(t.groups)[0]!;
    const matches = Object.values(t.matches).filter((m) => m.groupId === groupId);
    expect(matches.length).toBe(3);

    // Round 0: p1+p2 vs p3+p4 — team A wins 3-0
    const m0 = matches.find((m) => m.shuffleRound === 0)!;
    const r0 = runner.execute({
      id: 's0',
      type: 'EnterScore',
      dependsOn: ['sgz'],
      payload: {
        matchId: m0.id,
        scores: [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 6 },
          { playerA: 11, playerB: 4 },
        ],
      },
      timestamp: ts,
    });
    expect(r0.success).toBe(true);

    // Round 1: p1+p3 vs p2+p4 — team B wins 3-0
    const m1 = matches.find((m) => m.shuffleRound === 1)!;
    runner.execute({
      id: 's1',
      type: 'EnterScore',
      dependsOn: ['s0'],
      payload: {
        matchId: m1.id,
        scores: [
          { playerA: 5, playerB: 11 },
          { playerA: 6, playerB: 11 },
          { playerA: 4, playerB: 11 },
        ],
      },
      timestamp: ts,
    });

    // Round 2: p1+p4 vs p2+p3 — team A wins 3-0
    const m2 = matches.find((m) => m.shuffleRound === 2)!;
    runner.execute({
      id: 's2',
      type: 'EnterScore',
      dependsOn: ['s1'],
      payload: {
        matchId: m2.id,
        scores: [
          { playerA: 11, playerB: 7 },
          { playerA: 11, playerB: 8 },
          { playerA: 11, playerB: 9 },
        ],
      },
      timestamp: ts,
    });

    return { runner, groupId };
  }

  it('credits W/L to each player on their team', () => {
    const { runner, groupId } = setupGroupWithScores();
    const t = runner.getTournament();
    const g = t.groups[groupId]!;
    const rows = groupStandingsRowsForShuffleDoubles(t, g, undefined);
    const byId = Object.fromEntries(rows.map((r) => [r.pid, r]));
    // p1: W r0, L r1, W r2 => 2W 1L
    expect(byId.p1).toEqual({ pid: 'p1', w: 2, l: 1 });
    // p2: W r0, W r1, L r2 => 2W 1L
    expect(byId.p2).toEqual({ pid: 'p2', w: 2, l: 1 });
    // p3: L r0, L r1, L r2 => 0W 3L
    expect(byId.p3).toEqual({ pid: 'p3', w: 0, l: 3 });
    // p4: L r0, W r1, W r2 => 2W 1L
    expect(byId.p4).toEqual({ pid: 'p4', w: 2, l: 1 });
  });

  it('groupStandingsRowsForBracket routes shuffle format correctly', () => {
    const { runner, groupId } = setupGroupWithScores();
    const t = runner.getTournament();
    const g = t.groups[groupId]!;
    expect(groupStandingsRowsForBracket(t, g, undefined)[0]!.pid).toBe('p2');
  });

  it('attributes games won to players on their side', () => {
    const { runner, groupId } = setupGroupWithScores();
    const t = runner.getTournament();
    const g = t.groups[groupId]!;
    const matches = Object.values(t.matches).filter((m) => m.groupId === groupId);
    const p1Stats = setsAndPointsWonInGroupForPlayer(matches, 'p1');
    expect(p1Stats.setsWon).toBe(6);
    expect(p1Stats.setsLost).toBe(3);
  });
});
