import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { groupStandingsRowsForBracket } from '../src/model';

describe('doubles standings', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  it('tracks W/L per pair after scores', () => {
    const runner = new CommandRunner();
    for (const [id, name] of [
      ['p1', 'A'],
      ['p2', 'B'],
      ['p3', 'C'],
      ['p4', 'D'],
    ] as const) {
      runner.execute({
        id,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name, handicap: 0 },
        timestamp: ts,
      });
    }
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: {
        targetGroupSize: 4,
        playerIds: ['p1', 'p2', 'p3', 'p4'],
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    const t0 = runner.getTournament();
    const g = t0.groups['1']!;
    const pairA = g.pairIds![0]!;
    const pairB = g.pairIds![1]!;
    const m = Object.values(t0.matches).find(
      (x) =>
        x.groupId === g.id &&
        ((x.pairA === pairA && x.pairB === pairB) || (x.pairA === pairB && x.pairB === pairA)),
    )!;
    runner.execute({
      id: 'sc',
      type: 'EnterScore',
      dependsOn: ['sgz'],
      payload: {
        matchId: m.id,
        scores: [
          { playerA: 11, playerB: 3 },
          { playerA: 11, playerB: 3 },
          { playerA: 11, playerB: 3 },
        ],
      },
      timestamp: ts,
    });
    const rows = groupStandingsRowsForBracket(runner.getTournament(), g, undefined);
    const winnerRow = rows.find((r) => r.pid === (m.pairA === pairA ? pairA : pairB));
    const loserRow = rows.find((r) => r.pid === (m.pairA === pairA ? pairB : pairA));
    expect(winnerRow?.w).toBe(1);
    expect(loserRow?.l).toBe(1);
  });
});
