import { describe, it, expect } from 'vitest';
import { CommandRunner, SetRoundLockCommand } from '../src/command';

describe('SetRoundLock and score guards', () => {
  it('blocks EnterScore when bracket round is locked', () => {
    const runner = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: ts,
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: ts,
    });
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2'],
      payload: { playerIds: ['p1', 'p2'] },
      timestamp: ts,
    });
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['seed'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: ts,
    });
    runner.execute({
      id: 'm1',
      type: 'CreateMatch',
      dependsOn: ['p1', 'p2'],
      payload: { matchId: 'match-1', playerA: 'p1', playerB: 'p2' },
      timestamp: ts,
    });
    const lock: SetRoundLockCommand = {
      id: 'lock1',
      type: 'SetRoundLock',
      dependsOn: ['m1'],
      payload: { bracketRound: 1, locked: true },
      timestamp: ts,
    };
    expect(runner.execute(lock)).toEqual({ success: true });

    const score = {
      id: 's1',
      type: 'EnterScore' as const,
      dependsOn: ['m1'],
      payload: { matchId: 'match-1', scores: [{ playerA: 11, playerB: 9 }] },
      timestamp: ts,
    };
    expect(runner.execute(score)).toEqual({ success: false, reason: 'Bracket round 1 is locked' });
  });

  it('allows unlock then EnterScore when no finished match in that round', () => {
    const runner = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
    runner.execute({ id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 }, timestamp: ts });
    runner.execute({ id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 }, timestamp: ts });
    runner.execute({ id: 'seed', type: 'SetSeedings', dependsOn: ['p1', 'p2'], payload: { playerIds: ['p1', 'p2'] }, timestamp: ts });
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['seed'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: ts,
    });
    runner.execute({
      id: 'm1',
      type: 'CreateMatch',
      dependsOn: ['p1', 'p2'],
      payload: { matchId: 'match-1', playerA: 'p1', playerB: 'p2' },
      timestamp: ts,
    });
    expect(runner.execute({ id: 'lock1', type: 'SetRoundLock', dependsOn: ['m1'], payload: { bracketRound: 1, locked: true }, timestamp: ts })).toEqual({
      success: true,
    });
    expect(
      runner.execute({ id: 'unlock1', type: 'SetRoundLock', dependsOn: ['lock1'], payload: { bracketRound: 1, locked: false }, timestamp: ts }),
    ).toEqual({ success: true });

    expect(
      runner.execute({
        id: 's1',
        type: 'EnterScore',
        dependsOn: ['m1'],
        payload: {
          matchId: 'match-1',
          scores: [
            { playerA: 11, playerB: 9 },
            { playerA: 11, playerB: 6 },
            { playerA: 11, playerB: 5 },
          ],
        },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
  });

  it('rejects unlock when a match in that round already has scores', () => {
    const runner = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
    runner.execute({ id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 }, timestamp: ts });
    runner.execute({ id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 }, timestamp: ts });
    runner.execute({ id: 'seed', type: 'SetSeedings', dependsOn: ['p1', 'p2'], payload: { playerIds: ['p1', 'p2'] }, timestamp: ts });
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['seed'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: ts,
    });
    runner.execute({
      id: 'm1',
      type: 'CreateMatch',
      dependsOn: ['p1', 'p2'],
      payload: { matchId: 'match-1', playerA: 'p1', playerB: 'p2' },
      timestamp: ts,
    });
    expect(
      runner.execute({
        id: 's1',
        type: 'EnterScore',
        dependsOn: ['m1'],
        payload: {
          matchId: 'match-1',
          scores: [
            { playerA: 11, playerB: 9 },
            { playerA: 11, playerB: 6 },
            { playerA: 11, playerB: 5 },
          ],
        },
        timestamp: ts,
      }),
    ).toEqual({ success: true });

    expect(
      runner.execute({ id: 'lock1', type: 'SetRoundLock', dependsOn: ['s1'], payload: { bracketRound: 1, locked: true }, timestamp: ts }),
    ).toEqual({ success: true });

    expect(
      runner.execute({ id: 'unlock1', type: 'SetRoundLock', dependsOn: ['lock1'], payload: { bracketRound: 1, locked: false }, timestamp: ts }),
    ).toEqual({
      success: false,
      reason: 'Cannot unlock: a match in this bracket round already has scores',
    });
  });
});
