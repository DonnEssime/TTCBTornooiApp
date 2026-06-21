import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  groupStandingsRowsForBracket,
  roundRobinPairs,
} from '../src/model';
import { getTrackFormat } from '../src/doubles-track';

/** Golden-path singles tournament — guardrail that doubles work must not alter singles behavior. */
describe('singles regression (doubles feature guardrail)', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function seedFourPlayers(runner: CommandRunner): void {
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
  }

  it('SetGroups without format leaves track as singles with player round-robin', () => {
    const runner = new CommandRunner();
    seedFourPlayers(runner);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: { targetGroupSize: 4, playerIds: ['p1', 'p2', 'p3', 'p4'] },
      timestamp: ts,
    });
    expect(r.success).toBe(true);
    const t = runner.getTournament();
    expect(getTrackFormat(t, undefined)).toBe('singles');
    expect(t.pairs).toBeUndefined();
    expect(Object.keys(t.groups)).toEqual(['1']);
    expect(t.groups['1']!.playerIds.sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(t.groups['1']!.pairIds).toBeUndefined();
    const gm = Object.values(t.matches).filter((m) => m.groupId);
    expect(gm.length).toBe(roundRobinPairs(['p1', 'p2', 'p3', 'p4']).length);
    for (const m of gm) {
      expect(m.pairA).toBeUndefined();
      expect(m.pairB).toBeUndefined();
    }
  });

  it('explicit format singles matches omitted format', () => {
    const runner = new CommandRunner();
    seedFourPlayers(runner);
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: {
        targetGroupSize: 4,
        playerIds: ['p1', 'p2', 'p3', 'p4'],
        format: 'singles',
      },
      timestamp: ts,
    });
    const t = runner.getTournament();
    expect(getTrackFormat(t, undefined)).toBe('singles');
    expect(t.pairs).toBeUndefined();
  });

  it('singles group standings remain per-player after scores', () => {
    const runner = new CommandRunner();
    seedFourPlayers(runner);
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: { targetGroupSize: 4, playerIds: ['p1', 'p2', 'p3', 'p4'] },
      timestamp: ts,
    });
    const t0 = runner.getTournament();
    const g = t0.groups['1']!;
    const m = t0.matches['gm-1-p1-p2']!;
    runner.execute({
      id: 'sc1',
      type: 'EnterScore',
      dependsOn: ['sgz'],
      payload: {
        matchId: m.id,
        scores: [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
        ],
      },
      timestamp: ts,
    });
    const rows = groupStandingsRowsForBracket(runner.getTournament(), g, undefined);
    expect(rows.find((r) => r.pid === 'p1')).toEqual({ pid: 'p1', w: 1, l: 0 });
    expect(rows.find((r) => r.pid === 'p2')).toEqual({ pid: 'p2', w: 0, l: 1 });
  });
});
