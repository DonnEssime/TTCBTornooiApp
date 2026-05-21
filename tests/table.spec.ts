import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import { TournamentController } from '../src/controller';
import {
  assignMatchToTable,
  buildDefaultTableIds,
  createTournament,
  matchAssignedTableId,
  matchIdOnTable,
  setTournamentTables,
} from '../src/model';

const iso = () => new Date().toISOString();

function setupPlayersAndMatch(runner: CommandRunner): string {
  runner.execute({
    id: 'p1',
    type: 'CreatePlayer',
    dependsOn: [],
    payload: { playerId: 'a', name: 'Ann', handicap: 0 },
    timestamp: iso(),
  });
  runner.execute({
    id: 'p2',
    type: 'CreatePlayer',
    dependsOn: [],
    payload: { playerId: 'b', name: 'Bob', handicap: 0 },
    timestamp: iso(),
  });
  runner.execute({
    id: 'm1',
    type: 'CreateMatch',
    dependsOn: ['p2'],
    payload: { matchId: 'gm-g1-a-b', playerA: 'a', playerB: 'b', groupId: 'g1' },
    timestamp: iso(),
  });
  return 'gm-g1-a-b';
}

describe('Tournament tables', () => {
  it('buildDefaultTableIds produces 1..n', () => {
    expect(buildDefaultTableIds(4)).toEqual(['1', '2', '3', '4']);
    expect(buildDefaultTableIds(0)).toEqual([]);
  });

  it('SetTournamentTables configures tables via command log', () => {
    const runner = new CommandRunner();
    const r = runner.execute({
      id: 't1',
      type: 'SetTournamentTables',
      dependsOn: [],
      payload: { tableIds: ['1', '2'] },
      timestamp: iso(),
    });
    expect(r.success).toBe(true);
    expect(runner.getTournament().tables).toEqual(['1', '2']);
  });

  it('AssignMatchToTable marks match in-progress and blocks double booking', () => {
    const runner = new CommandRunner();
    setupPlayersAndMatch(runner);
    runner.execute({
      id: 'tabs',
      type: 'SetTournamentTables',
      dependsOn: [],
      payload: { tableIds: ['1', '2'] },
      timestamp: iso(),
    });
    const mid = 'gm-g1-a-b';
    expect(
      runner.execute({
        id: 'a1',
        type: 'AssignMatchToTable',
        dependsOn: ['m1'],
        payload: { matchId: mid, tableId: '1' },
        timestamp: iso(),
      }).success,
    ).toBe(true);
    const t = runner.getTournament();
    expect(t.matches[mid]?.status).toBe('in-progress');
    expect(matchAssignedTableId(t, mid)).toBe('1');
    expect(matchIdOnTable(t, '1')).toBe(mid);

    runner.execute({
      id: 'p3',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'c', name: 'Cal', handicap: 0 },
      timestamp: iso(),
    });
    runner.execute({
      id: 'm2',
      type: 'CreateMatch',
      dependsOn: ['p3'],
      payload: { matchId: 'gm-g1-c-b', playerA: 'c', playerB: 'b', groupId: 'g1' },
      timestamp: iso(),
    });
    const blockedTable = runner.execute({
      id: 'a2',
      type: 'AssignMatchToTable',
      dependsOn: ['m2'],
      payload: { matchId: 'gm-g1-c-b', tableId: '1' },
      timestamp: iso(),
    });
    expect(blockedTable.success).toBe(false);
    expect(blockedTable.reason).toMatch(/table already/i);

    const blockedPlayer = runner.execute({
      id: 'a3',
      type: 'AssignMatchToTable',
      dependsOn: ['m2'],
      payload: { matchId: 'gm-g1-c-b', tableId: '2' },
      timestamp: iso(),
    });
    expect(blockedPlayer.success).toBe(false);
    expect(blockedPlayer.reason).toMatch(/already playing another match on table 1/i);
  });

  it('AssignMatchToTable allows moving the same in-progress match to another table', () => {
    const runner = new CommandRunner();
    setupPlayersAndMatch(runner);
    runner.execute({
      id: 'tabs',
      type: 'SetTournamentTables',
      dependsOn: [],
      payload: { tableIds: ['1', '2'] },
      timestamp: iso(),
    });
    const mid = 'gm-g1-a-b';
    runner.execute({
      id: 'a1',
      type: 'AssignMatchToTable',
      dependsOn: ['m1'],
      payload: { matchId: mid, tableId: '1' },
      timestamp: iso(),
    });
    const moved = runner.execute({
      id: 'a2',
      type: 'AssignMatchToTable',
      dependsOn: ['a1'],
      payload: { matchId: mid, tableId: '2' },
      timestamp: iso(),
    });
    expect(moved.success).toBe(true);
    const t = runner.getTournament();
    expect(t.matches[mid]?.status).toBe('in-progress');
    expect(matchAssignedTableId(t, mid)).toBe('2');
    expect(matchIdOnTable(t, '1')).toBeUndefined();
    expect(matchIdOnTable(t, '2')).toBe(mid);
  });

  it('EnterScore frees the table', () => {
    const runner = new CommandRunner();
    setupPlayersAndMatch(runner);
    runner.execute({
      id: 'tabs',
      type: 'SetTournamentTables',
      dependsOn: [],
      payload: { tableIds: ['1'] },
      timestamp: iso(),
    });
    const mid = 'gm-g1-a-b';
    runner.execute({
      id: 'a1',
      type: 'AssignMatchToTable',
      dependsOn: ['m1'],
      payload: { matchId: mid, tableId: '1' },
      timestamp: iso(),
    });
    const scores = [
      { playerA: 11, playerB: 5 },
      { playerA: 11, playerB: 7 },
      { playerA: 11, playerB: 9 },
    ];
    runner.execute({
      id: 'sc1',
      type: 'EnterScore',
      dependsOn: ['a1'],
      payload: { matchId: mid, scores },
      timestamp: iso(),
    });
    const t = runner.getTournament();
    expect(t.matches[mid]?.status).toBe('finished');
    expect(t.tableAssignments.some((a) => a.matchId === mid)).toBe(false);
    expect(matchIdOnTable(t, '1')).toBeUndefined();
  });

  it('ClearMatchTableAssignment is undoable', () => {
    const c = new TournamentController();
    c.setTournamentTables(['1', '2'], [], 'tabs');
    c.createPlayer('a', 'Ann', 0, 'pa');
    c.createPlayer('b', 'Bob', 0, 'pb');
    c.createMatch('m', 'a', 'b', ['pb'], 'cm');
    c.assignMatchToTable('m', '2', ['cm'], 'at');
    expect(c.getTournament().matches['m']?.status).toBe('in-progress');
    c.clearMatchTableAssignment('m', ['at'], 'clr');
    expect(c.getTournament().matches['m']?.status).toBe('scheduled');
    c.undo('clr');
    expect(c.getTournament().matches['m']?.status).toBe('in-progress');
    expect(matchAssignedTableId(c.getTournament(), 'm')).toBe('2');
  });

  it('reducing table count releases assignments on removed tables', () => {
    const t = createTournament();
    t.players['a'] = { id: 'a', name: 'A', handicap: 0 };
    t.players['b'] = { id: 'b', name: 'B', handicap: 0 };
    t.matches['m'] = {
      id: 'm',
      playerA: 'a',
      playerB: 'b',
      scores: [],
      status: 'scheduled',
    };
    setTournamentTables(t, ['1', '2', '3']);
    assignMatchToTable(t, 'm', '3');
    setTournamentTables(t, ['1', '2']);
    expect(t.matches['m']?.status).toBe('scheduled');
    expect(t.tableAssignments.some((a) => a.matchId === 'm')).toBe(false);
  });
});
