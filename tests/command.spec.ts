import { describe, it, expect } from 'vitest';
import { CommandRunner, CreatePlayerCommand, CreateMatchCommand, type UndoCommand } from '../src/command';

function appendUndo(runner: CommandRunner, targetId: string, undoId: string): ReturnType<CommandRunner['execute']> {
  const u: UndoCommand = {
    id: undoId,
    type: 'Undo',
    timestamp: new Date().toISOString(),
    dependsOn: [targetId],
    payload: { targetCommandId: targetId },
  };
  return runner.execute(u);
}

describe('CommandRunner dependency-aware undo', () => {
  it('should execute and undo independent command', () => {
    const runner = new CommandRunner();
    const c1: CreatePlayerCommand = {
      id: 'c1',
      type: 'CreatePlayer',
      timestamp: new Date().toISOString(),
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Alice', handicap: 0 },
    };

    expect(runner.execute(c1)).toEqual({ success: true });
    expect(runner.canUndo('c1')).toBe(true);
    expect(appendUndo(runner, 'c1', 'u1')).toEqual({ success: true });
    expect(runner.getTournament().players).toEqual({});
  });

  it('should not undo command with dependents', () => {
    const runner = new CommandRunner();
    const c1: CreatePlayerCommand = {
      id: 'c1',
      type: 'CreatePlayer',
      timestamp: '2024-01-01T00:00:00.000Z',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Alice', handicap: 0 },
    };
    const c2: CreateMatchCommand = {
      id: 'c2',
      type: 'CreateMatch',
      timestamp: '2024-01-01T00:01:00.000Z',
      dependsOn: ['c1'],
      payload: { matchId: 'm1', playerA: 'p1', playerB: 'p2' },
    };

    // need second player
    const c3: CreatePlayerCommand = {
      id: 'c3',
      type: 'CreatePlayer',
      timestamp: '2024-01-01T00:00:30.000Z',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'Bob', handicap: 0 },
    };

    runner.execute(c1);
    runner.execute(c3);
    runner.execute(c2);

    expect(runner.canUndo('c1')).toBe(false);
    expect(appendUndo(runner, 'c1', 'ux').success).toBe(false);
  });

  it('should allow player forfeit in bracket', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Alice', handicap: 0 },
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'Bob', handicap: 0 },
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    runner.execute({
      id: 'm1',
      type: 'CreateMatch',
      dependsOn: ['p1', 'p2'],
      payload: { matchId: 'match1', playerA: 'p1', playerB: 'p2' },
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    runner.execute({
      id: 'f1',
      type: 'PlayerForfeit',
      dependsOn: [],
      payload: { playerId: 'p1', phase: 'bracket' },
      timestamp: '2024-01-01T00:00:03.000Z',
    });

    expect(runner.getTournament().forfeits.players['p1'].phase).toBe('bracket');
  });

  it('should set group mode and auto-win other players when first group forfeit occurs', () => {
    const runner = new CommandRunner();
    runner.execute({ id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'Alice', handicap: 0 }, timestamp: '2024-01-01T00:00:00.000Z' });
    runner.execute({ id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'Bob', handicap: 0 }, timestamp: '2024-01-01T00:00:01.000Z' });
    runner.execute({ id: 'p3', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p3', name: 'Charlie', handicap: 0 }, timestamp: '2024-01-01T00:00:02.000Z' });

    const tournament = runner.getTournament();
    tournament.groups['g1'] = { id: 'g1', playerIds: ['p1', 'p2', 'p3'] };

    runner.execute({
      id: 'f2',
      type: 'PlayerForfeit',
      dependsOn: [],
      payload: { playerId: 'p1', phase: 'group', groupMode: 'auto-win' },
      timestamp: '2024-01-01T00:00:03.000Z',
    });

    expect(runner.getTournament().forfeitGroupMode).toBe('auto-win');
    expect(runner.getTournament().forfeitResults.playerWins['p2']).toBe(1);
    expect(runner.getTournament().forfeitResults.playerWins['p3']).toBe(1);
  });

  it('should respect not-played mode for group forfeits', () => {
    const runner = new CommandRunner();
    runner.execute({ id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'Alice', handicap: 0 }, timestamp: '2024-01-01T00:00:00.000Z' });
    runner.execute({ id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'Bob', handicap: 0 }, timestamp: '2024-01-01T00:00:01.000Z' });
    runner.execute({ id: 'p3', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p3', name: 'Charlie', handicap: 0 }, timestamp: '2024-01-01T00:00:02.000Z' });

    const tournament = runner.getTournament();
    tournament.groups['g1'] = { id: 'g1', playerIds: ['p1', 'p2', 'p3'] };

    runner.execute({
      id: 'f2',
      type: 'PlayerForfeit',
      dependsOn: [],
      payload: { playerId: 'p1', phase: 'group', groupMode: 'not-played' },
      timestamp: '2024-01-01T00:00:03.000Z',
    });

    expect(runner.getTournament().forfeitGroupMode).toBe('not-played');
    expect(runner.getTournament().forfeitResults.playerWins['p2']).toBeUndefined();
    expect(runner.getTournament().forfeitResults.playerWins['p3']).toBeUndefined();
  });

  it('allows undo-of-undo after a new mutation so history stays coherent', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'a',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'b',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    expect(appendUndo(runner, 'b', 'ub')).toEqual({ success: true });
    expect(Object.keys(runner.getTournament().players)).toEqual(['p1']);
    runner.execute({
      id: 'c',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p3', name: 'C', handicap: 0 },
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    expect(appendUndo(runner, 'ub', 'uub')).toEqual({ success: true });
    expect(runner.getTournament().players['p2']?.name).toBe('B');
    expect(runner.getTournament().players['p3']?.name).toBe('C');
  });

  it('redoPop removes the last Undo and reapplies its target', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'c1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    expect(appendUndo(runner, 'c1', 'u1')).toEqual({ success: true });
    expect(runner.getTournament().players).toEqual({});
    expect(runner.canRedo()).toBe(true);
    expect(runner.redoPop()).toEqual({ success: true });
    expect(runner.getTournament().players['p1']?.name).toBe('A');
  });
});
