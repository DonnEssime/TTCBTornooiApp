import { describe, it, expect } from 'vitest';
import { teamMatchWinner, isTeamMatchScoreLegal, createTournament } from '../src/model';
import {
  CommandRunner,
  CreatePlayerCommand,
  CreateTeamCommand,
  CreateTeamMatchCommand,
  EnterTeamScoreCommand,
  type UndoCommand,
} from '../src/command';

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

describe('Single team-vs-team match (not a team tournament)', () => {
  it('should resolve team match winner and legality using per-game rules', () => {
    const tournament = createTournament();
    tournament.teams['t1'] = { id: 't1', name: 'Team A', memberIds: [] } as any;
    tournament.teams['t2'] = { id: 't2', name: 'Team B', memberIds: [] } as any;

    const teamMatch = {
      id: 'tm1',
      teamA: 't1',
      teamB: 't2',
      scores: [
        { playerA: 11, playerB: 9 },
        { playerA: 9, playerB: 11 },
        { playerA: 11, playerB: 6 },
      ],
      status: 'finished' as const,
    };

    expect(isTeamMatchScoreLegal(teamMatch, tournament)).toBe(true);
    expect(teamMatchWinner(teamMatch)).toBe('t1');
  });

  it('should execute and undo team commands with dependency awareness', () => {
    const runner = new CommandRunner();

    const p1: CreatePlayerCommand = {
      id: 'p1',
      type: 'CreatePlayer',
      timestamp: '2025-01-01T00:00:00.000Z',
      dependsOn: [],
      payload: { playerId: 'player1', name: 'Alice', handicap: 0 },
    };

    const p2: CreatePlayerCommand = {
      id: 'p2',
      type: 'CreatePlayer',
      timestamp: '2025-01-01T00:01:00.000Z',
      dependsOn: [],
      payload: { playerId: 'player2', name: 'Bob', handicap: 0 },
    };

    const createTeam: CreateTeamCommand = {
      id: 't1',
      type: 'CreateTeam',
      timestamp: '2025-01-01T00:02:00.000Z',
      dependsOn: ['p1', 'p2'],
      payload: { teamId: 'team1', name: 'Alpha', memberIds: ['player1', 'player2'] },
    };

    const createTeam2: CreateTeamCommand = {
      id: 't2',
      type: 'CreateTeam',
      timestamp: '2025-01-01T00:03:00.000Z',
      dependsOn: ['p1'],
      payload: { teamId: 'team2', name: 'Beta', memberIds: ['player1'] },
    };

    const createTeamMatch: CreateTeamMatchCommand = {
      id: 'tm1',
      type: 'CreateTeamMatch',
      timestamp: '2025-01-01T00:04:00.000Z',
      dependsOn: ['t1', 't2'],
      payload: { matchId: 'teamMatch1', teamA: 'team1', teamB: 'team2' },
    };

    const enterScore: EnterTeamScoreCommand = {
      id: 'tm1-s',
      type: 'EnterTeamScore',
      timestamp: '2025-01-01T00:05:00.000Z',
      dependsOn: ['tm1'],
      payload: {
        matchId: 'teamMatch1',
        scores: [
          { playerA: 11, playerB: 8 },
          { playerA: 11, playerB: 7 },
          { playerA: 9, playerB: 11 },
        ],
      },
    };

    expect(runner.execute(p1)).toEqual({ success: true });
    expect(runner.execute(p2)).toEqual({ success: true });
    expect(runner.execute(createTeam)).toEqual({ success: true });
    expect(runner.execute(createTeam2)).toEqual({ success: true });
    expect(runner.execute(createTeamMatch)).toEqual({ success: true });
    expect(runner.execute(enterScore)).toEqual({ success: true });

    expect(runner.canUndo('tm1')).toBe(false);
    expect(appendUndo(runner, 'tm1', 'ux').success).toBe(false);

    expect(runner.canUndo('tm1-s')).toBe(true);
    expect(appendUndo(runner, 'tm1-s', 'u-score')).toEqual({ success: true });
    expect(runner.getTournament().teamMatches['teamMatch1']?.status).toBe('scheduled');
  });

  it('rejects a second team vs team match in the same tournament', () => {
    const runner = new CommandRunner();
    const p1: CreatePlayerCommand = {
      id: 'p1',
      type: 'CreatePlayer',
      timestamp: '2025-01-01T00:00:00.000Z',
      dependsOn: [],
      payload: { playerId: 'a1', name: 'A', handicap: 0 },
    };
    const p2: CreatePlayerCommand = {
      id: 'p2',
      type: 'CreatePlayer',
      timestamp: '2025-01-01T00:01:00.000Z',
      dependsOn: [],
      payload: { playerId: 'b1', name: 'B', handicap: 0 },
    };
    const t1: CreateTeamCommand = {
      id: 't1',
      type: 'CreateTeam',
      timestamp: '2025-01-01T00:02:00.000Z',
      dependsOn: ['p1'],
      payload: { teamId: 'teamA', name: 'A', memberIds: ['a1'] },
    };
    const t2: CreateTeamCommand = {
      id: 't2',
      type: 'CreateTeam',
      timestamp: '2025-01-01T00:03:00.000Z',
      dependsOn: ['p2'],
      payload: { teamId: 'teamB', name: 'B', memberIds: ['b1'] },
    };
    const tm1: CreateTeamMatchCommand = {
      id: 'tm1',
      type: 'CreateTeamMatch',
      timestamp: '2025-01-01T00:04:00.000Z',
      dependsOn: ['t1', 't2'],
      payload: { matchId: 'm1', teamA: 'teamA', teamB: 'teamB' },
    };
    const tm2: CreateTeamMatchCommand = {
      id: 'tm2',
      type: 'CreateTeamMatch',
      timestamp: '2025-01-01T00:05:00.000Z',
      dependsOn: ['t1', 't2'],
      payload: { matchId: 'm2', teamA: 'teamA', teamB: 'teamB' },
    };

    expect(runner.execute(p1)).toEqual({ success: true });
    expect(runner.execute(p2)).toEqual({ success: true });
    expect(runner.execute(t1)).toEqual({ success: true });
    expect(runner.execute(t2)).toEqual({ success: true });
    expect(runner.execute(tm1)).toEqual({ success: true });
    expect(runner.execute(tm2)).toEqual({
      success: false,
      reason: 'command.onlyOneTeamVsTeamMatch',
    });
  });

  it('blocks CreateTeamMatch when a class slice has a player bracket', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: { classes: [{ id: 'jun', name: 'Junior' }, { id: 'sen', name: 'Senior' }] },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: ['tc'],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
      timestamp: '2026-01-01T00:00:01.000Z',
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: ['tc'],
      payload: { playerId: 'p2', name: 'B', handicap: 0 },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    runner.execute({
      id: 't1',
      type: 'CreateTeam',
      dependsOn: ['p1'],
      payload: { teamId: 'teamA', name: 'A', memberIds: ['p1'] },
      timestamp: '2026-01-01T00:00:03.000Z',
    });
    runner.execute({
      id: 't2',
      type: 'CreateTeam',
      dependsOn: ['p2'],
      payload: { teamId: 'teamB', name: 'B', memberIds: ['p2'] },
      timestamp: '2026-01-01T00:00:04.000Z',
    });
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2'],
      payload: { playerIds: ['p1', 'p2'] },
      timestamp: '2026-01-01T00:00:05.000Z',
    });
    runner.execute({
      id: 'f1',
      type: 'SetPlayerClassFlags',
      dependsOn: ['seed'],
      payload: { playerId: 'p1', flags: { jun: true, sen: false } },
      timestamp: '2026-01-01T00:00:06.000Z',
    });
    runner.execute({
      id: 'f2',
      type: 'SetPlayerClassFlags',
      dependsOn: ['seed'],
      payload: { playerId: 'p2', flags: { jun: true, sen: false } },
      timestamp: '2026-01-01T00:00:07.000Z',
    });
    runner.execute({
      id: 'scg',
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: { classId: 'jun', groups: [{ id: '1', playerIds: ['p1', 'p2'] }] },
      timestamp: '2026-01-01T00:00:08.000Z',
    });
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['scg'],
      payload: { fillByes: false, cullToPowerOfTwo: false, classId: 'jun' },
      timestamp: '2026-01-01T00:00:09.000Z',
    });
    expect(runner.getTournament().bracketMatches).toEqual([]);
    expect(runner.getTournament().classTournaments.jun!.bracketMatches.length).toBeGreaterThan(0);
    expect(runner.execute({
      id: 'tm1',
      type: 'CreateTeamMatch',
      dependsOn: ['t1', 't2'],
      payload: { matchId: 'm1', teamA: 'teamA', teamB: 'teamB' },
      timestamp: '2026-01-01T00:00:10.000Z',
    })).toEqual({
      success: false,
      reason: 'command.teamVsTeamWithPlayerBracket',
    });
  });
});
