import { describe, it, expect } from 'vitest';
import { CommandRunner, CreatePlayerCommand, CreateMatchCommand, type UndoCommand } from '../src/command';
import { TournamentController } from '../src/controller';
import { buildNumberedGroupsFromPlayerOrder, partitionPlayerCountIntoGroupSizes } from '../src/model';

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

const iso = () => new Date().toISOString();

describe('Player display name uniqueness', () => {
  it('rejects CreatePlayer when name matches existing (case and spacing insensitive)', () => {
    const runner = new CommandRunner();
    expect(
      runner.execute({
        id: 'c1',
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: 'p1', name: 'Ann', handicap: 0 },
        timestamp: iso(),
      }),
    ).toEqual({ success: true });
    const r = runner.execute({
      id: 'c2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: '  ANN ', handicap: 0 },
      timestamp: iso(),
    });
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/already exists/i);
    expect(runner.getTournament().players['p2']).toBeUndefined();
  });

  it('rejects RenamePlayer when target name is taken by another player', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'c1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Ann', handicap: 0 },
      timestamp: iso(),
    });
    runner.execute({
      id: 'c2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'Bob', handicap: 0 },
      timestamp: iso(),
    });
    const r = runner.execute({
      id: 'r1',
      type: 'RenamePlayer',
      dependsOn: ['c2'],
      payload: { playerId: 'p2', name: 'ann' },
      timestamp: iso(),
    });
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/already exists/i);
    expect(runner.getTournament().players['p2']?.name).toBe('Bob');
  });

  it('allows RenamePlayer to keep identical name on same player', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'c1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Ann', handicap: 0 },
      timestamp: iso(),
    });
    runner.execute({
      id: 'c2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'Bob', handicap: 0 },
      timestamp: iso(),
    });
    expect(
      runner.execute({
        id: 'r1',
        type: 'RenamePlayer',
        dependsOn: ['c1'],
        payload: { playerId: 'p1', name: 'Ann', handicap: 3 },
        timestamp: iso(),
      }),
    ).toEqual({ success: true });
    expect(runner.getTournament().players['p1']?.name).toBe('Ann');
    expect(runner.getTournament().players['p1']?.handicap).toBe(3);
  });
});

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
    runner.execute({
      id: 'sg-g1',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3'],
      payload: { groups: [{ id: 'g1', playerIds: ['p1', 'p2', 'p3'] }] },
      timestamp: '2024-01-01T00:00:02.500Z',
    });

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
    runner.execute({
      id: 'sg-g1',
      type: 'SetGroups',
      dependsOn: ['p1', 'p2', 'p3'],
      payload: { groups: [{ id: 'g1', playerIds: ['p1', 'p2', 'p3'] }] },
      timestamp: '2024-01-01T00:00:02.500Z',
    });

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

  it('SetTournamentClasses then players yields per-class slice seedings from flags', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: {
        classes: [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2'],
      payload: { playerIds: ['p1', 'p2'] },
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    runner.execute({
      id: 'f1',
      type: 'SetPlayerClassFlags',
      dependsOn: ['p1'],
      payload: { playerId: 'p1', flags: { jun: true, sen: false } },
      timestamp: '2026-01-01T00:00:04.000Z',
    });
    runner.execute({
      id: 'f2',
      type: 'SetPlayerClassFlags',
      dependsOn: ['p2'],
      payload: { playerId: 'p2', flags: { jun: false, sen: true } },
      timestamp: '2026-01-01T00:00:05.000Z',
    });
    const t = runner.getTournament();
    expect(t.classTournaments['jun']?.seedings).toEqual(['p1']);
    expect(t.classTournaments['sen']?.seedings).toEqual(['p2']);
  });

  it('rejects GenerateBracket when two competition classes are defined', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: {
        classes: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'X', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1'],
      payload: { playerIds: ['p1'] },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    const r = runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['seed'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/Global bracket|multiple competition classes/i);
  });

  it('SetTournamentClasses assigns ids when only display names are given', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: {
        classes: [{ name: 'Junior' }, { name: 'Senior' }],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const defs = runner.getTournament().classDefinitions;
    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe('Junior');
    expect(defs[1].name).toBe('Senior');
    expect(defs[0].id).toMatch(/^cid-/);
    expect(defs[1].id).toMatch(/^cid-/);
    expect(defs[0].id).not.toBe(defs[1].id);
  });

  it('SetGroups defines global groups and rejects when multiple classes are active', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc2',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: {
        classes: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'X', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    const rBlock = runner.execute({
      id: 'sg0',
      type: 'SetGroups',
      dependsOn: ['p1'],
      payload: { groups: [{ id: 'g1', playerIds: ['p1'] }] },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    expect(rBlock.success).toBe(false);
    expect(rBlock.reason).toMatch(/SetClassGroups|multiple competition classes/i);

    const runner2 = new CommandRunner();
    runner2.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner2.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    expect(
      runner2.execute({
        id: 'sg1',
        type: 'SetGroups',
        dependsOn: ['p1', 'p2'],
        payload: {
          groups: [
            { id: 'g1', label: 'Pool A', playerIds: ['p1'] },
            { id: 'g2', playerIds: ['p2'] },
          ],
        },
        timestamp: '2026-01-01T00:00:02.000Z',
      }).success,
    ).toBe(true);
    const t = runner2.getTournament();
    expect(t.groups['g1']?.label).toBe('Pool A');
    expect(t.groups['g2']?.playerIds).toEqual(['p2']);

    expect(
      runner2.execute({
        id: 'sg2',
        type: 'SetGroups',
        dependsOn: ['p1', 'p2'],
        payload: {
          groups: [
            { id: 'g1', playerIds: ['p1'] },
            { id: 'g2', playerIds: ['p1', 'p2'] },
          ],
        },
        timestamp: '2026-01-01T00:00:03.000Z',
      }).success,
    ).toBe(false);
  });

  it('SetClassGroups and GenerateGroupRoundRobin work per class', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: {
        classes: [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2'],
      payload: { playerIds: ['p1', 'p2'] },
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    runner.execute({
      id: 'f1',
      type: 'SetPlayerClassFlags',
      dependsOn: ['p1'],
      payload: { playerId: 'p1', flags: { jun: true, sen: false } },
      timestamp: '2026-01-01T00:00:04.000Z',
    });
    runner.execute({
      id: 'f2',
      type: 'SetPlayerClassFlags',
      dependsOn: ['p2'],
      payload: { playerId: 'p2', flags: { jun: true, sen: false } },
      timestamp: '2026-01-01T00:00:05.000Z',
    });
    expect(
      runner.execute({
        id: 'scg',
        type: 'SetClassGroups',
        dependsOn: ['p1', 'p2', 'seed', 'f1', 'f2'],
        payload: { classId: 'jun', groups: [{ id: 'jg', playerIds: ['p1'] }] },
        timestamp: '2026-01-01T00:00:06.000Z',
      }).success,
    ).toBe(true);

    expect(
      runner.execute({
        id: 'ggrr-bad',
        type: 'GenerateGroupRoundRobin',
        dependsOn: [],
        payload: {},
        timestamp: '2026-01-01T00:00:08.000Z',
      }).success,
    ).toBe(false);

    expect(
      runner.execute({
        id: 'ggrr-jun',
        type: 'GenerateGroupRoundRobin',
        dependsOn: ['scg'],
        payload: { classId: 'jun' },
        timestamp: '2026-01-01T00:00:09.000Z',
      }).success,
    ).toBe(true);
    const t = runner.getTournament();
    expect(Object.keys(t.matches).some((k) => k.startsWith('gm-jun-'))).toBe(false);

    runner.execute({
      id: 'scg3',
      type: 'SetClassGroups',
      dependsOn: ['p1', 'p2', 'seed', 'f1', 'f2'],
      payload: { classId: 'jun', groups: [{ id: 'jg', playerIds: ['p1', 'p2'] }] },
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    expect(
      runner.execute({
        id: 'ggrr-jun2',
        type: 'GenerateGroupRoundRobin',
        dependsOn: ['scg3'],
        payload: { classId: 'jun' },
        timestamp: '2026-01-01T00:00:11.000Z',
      }).success,
    ).toBe(true);
    const mids = Object.keys(runner.getTournament().matches).filter((k) => k.startsWith('gm-jun-jg-'));
    expect(mids.length).toBe(1);
  });

  it('balances group counts for a target size (S or S−1)', () => {
    expect(partitionPlayerCountIntoGroupSizes(10, 3)).toEqual([3, 3, 2, 2]);
    expect(partitionPlayerCountIntoGroupSizes(7, 3)).toEqual([3, 2, 2]);
    expect(partitionPlayerCountIntoGroupSizes(4, 3)).toEqual([2, 2]);
    expect(partitionPlayerCountIntoGroupSizes(4, 10)).toEqual([4]);
    expect(buildNumberedGroupsFromPlayerOrder(['a', 'b', 'c', 'd'], 3)).toEqual([
      { id: '1', label: 'group 1', playerIds: ['a', 'b'] },
      { id: '2', label: 'group 2', playerIds: ['c', 'd'] },
    ]);
  });

  it('SetGroups with targetGroupSize creates numbered groups and round-robin matches in one command', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    runner.execute({
      id: 'p3',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p3', name: 'C', handicap: 0 },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    runner.execute({
      id: 'p4',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p4', name: 'D', handicap: 0 },
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    expect(
      runner.execute({
        id: 'sgz',
        type: 'SetGroups',
        dependsOn: ['p1', 'p2', 'p3', 'p4'],
        payload: { targetGroupSize: 2, playerIds: ['p1', 'p2', 'p3', 'p4'] },
        timestamp: '2026-01-01T00:00:04.000Z',
      }).success,
    ).toBe(true);
    const t = runner.getTournament();
    expect(Object.keys(t.groups).sort()).toEqual(['1', '2']);
    const gm = Object.keys(t.matches).filter((k) => k.startsWith('gm-'));
    expect(gm.length).toBe(2);
  });
});

describe('EnterScore', () => {
  it('rejects illegal game scores and incomplete best-of-five', () => {
    const runner = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
    runner.execute({ id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 }, timestamp: ts });
    runner.execute({ id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 }, timestamp: ts });
    runner.execute({
      id: 'm1',
      type: 'CreateMatch',
      dependsOn: ['p1', 'p2'],
      payload: { matchId: 'm1', playerA: 'p1', playerB: 'p2' },
      timestamp: ts,
    });
    const bad = runner.execute({
      id: 'bad',
      type: 'EnterScore',
      dependsOn: ['m1'],
      payload: { matchId: 'm1', scores: [{ playerA: 11, playerB: 10 }] },
      timestamp: ts,
    });
    expect(bad.success).toBe(false);
    expect(bad.reason ?? '').toContain('Invalid scores');
    const partial = runner.execute({
      id: 'partial',
      type: 'EnterScore',
      dependsOn: ['m1'],
      payload: {
        matchId: 'm1',
        scores: [
          { playerA: 11, playerB: 9 },
          { playerA: 11, playerB: 9 },
        ],
      },
      timestamp: ts,
    });
    expect(partial.success).toBe(false);
    expect(partial.reason ?? '').toContain('Invalid scores');
    expect(runner.getTournament().matches.m1.status).toBe('scheduled');
  });
});

describe('Bracket undoLast coalescing', () => {
  it('undoLast on a round-1 CreateMatch that depends on GenerateBracket undoes the whole bracket batch', () => {
    const c = new TournamentController();
    expect(c.createPlayer('p1', 'A', 0, 'cmd-p1')).toEqual({ success: true });
    expect(c.createPlayer('p2', 'B', 0, 'cmd-p2')).toEqual({ success: true });
    expect(c.setSeedings(['p1', 'p2'], ['cmd-p1', 'cmd-p2'], 'cmd-seed-br')).toEqual({ success: true });
    expect(c.generateBracket(true, false, ['cmd-seed-br'], 'cmd-gen-br')).toEqual({ success: true });
    expect(c.createMatch('match-m1', 'p1', 'p2', ['cmd-gen-br', 'cmd-p1', 'cmd-p2'], 'cmd-gen-br-pair-m1')).toEqual({
      success: true,
    });
    expect(c.getTournament().bracketMatches.length).toBeGreaterThan(0);
    expect(c.getTournament().matches['match-m1']).toBeDefined();
    expect(c.undoLast()).toEqual({ success: true });
    expect(c.getTournament().bracketMatches.length).toBe(0);
    expect(c.getTournament().matches['match-m1']).toBeUndefined();
  });
});
