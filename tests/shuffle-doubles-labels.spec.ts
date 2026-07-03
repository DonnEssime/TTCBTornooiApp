import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { allPlayersInMatch, matchSideLabels } from '../src/doubles-track';
import { createTournament, teamHandicapValue } from '../src/model';

describe('shuffle doubles labels', () => {
  it('matchSideLabels shows team names', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'Alice', handicap: 0 },
      p2: { id: 'p2', name: 'Bob', handicap: 0 },
      p3: { id: 'p3', name: 'Carol', handicap: 0 },
      p4: { id: 'p4', name: 'Dave', handicap: 0 },
    };
    const m = {
      id: 'm1',
      playerA: 'p1',
      playerB: 'p3',
      teamA: ['p1', 'p2'] as [string, string],
      teamB: ['p3', 'p4'] as [string, string],
      scores: [],
      status: 'scheduled' as const,
    };
    const labels = matchSideLabels(t, m);
    expect(labels.sideA).toContain('Alice');
    expect(labels.sideA).toContain('Bob');
    expect(labels.sideB).toContain('Carol');
    expect(labels.sideB).toContain('Dave');
  });

  it('allPlayersInMatch returns four players for shuffle match', () => {
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
    expect(allPlayersInMatch(t, m).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('teamHandicapValue averages handicaps', () => {
    const t = createTournament();
    t.handicapConfig = {
      system: 'numerical',
      minValue: 0,
      maxValue: 9,
      startingCriteria: 'headstart',
      maxStartAdjustment: 5,
    };
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 3 },
      p2: { id: 'p2', name: 'B', handicap: 5 },
    };
    expect(teamHandicapValue(t, ['p1', 'p2'])).toBe(4);
  });
});

describe('shuffle doubles command guards', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function setupShuffle(runner: CommandRunner): void {
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
  }

  it('GenerateBracket is blocked', () => {
    const runner = new CommandRunner();
    setupShuffle(runner);
    const r = runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['sgz'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: ts,
    });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('command.bracketNotAvailableForShuffleDoubles');
  });

  it('SetPlayerGroup is blocked', () => {
    const runner = new CommandRunner();
    setupShuffle(runner);
    const r = runner.execute({
      id: 'move',
      type: 'SetPlayerGroup',
      dependsOn: ['sgz'],
      payload: { playerId: 'p1', groupId: null },
      timestamp: ts,
    });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('command.movePlayerDisabledInDoubles');
  });
});
