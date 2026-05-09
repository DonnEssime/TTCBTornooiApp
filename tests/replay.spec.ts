import { describe, it, expect } from 'vitest';
import { CommandRunner, CreatePlayerCommand, CreateMatchCommand } from '../src/command';
import { commandToJsonLine, replayCommandsFromJsonLines, exportCommandsAsJsonLines } from '../src/storage';
import { tournamentControllerFromCommandLog } from '../src/controller';

describe('Command replay and deterministic JSONL round-trip', () => {
  it('should round-trip command serialization and replay', () => {
    const c1: CreatePlayerCommand = {
      id: 'c1',
      type: 'CreatePlayer',
      timestamp: '2026-01-01T00:00:00.000Z',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Alice', handicap: 0 },
    };
    const c2: CreatePlayerCommand = {
      id: 'c2',
      type: 'CreatePlayer',
      timestamp: '2026-01-01T00:01:00.000Z',
      dependsOn: [],
      payload: { playerId: 'p2', name: 'Bob', handicap: 0 },
    };
    const c3: CreateMatchCommand = {
      id: 'c3',
      type: 'CreateMatch',
      timestamp: '2026-01-01T00:02:00.000Z',
      dependsOn: ['c1', 'c2'],
      payload: { matchId: 'm1', playerA: 'p1', playerB: 'p2' },
    };

    const lines = [c1, c2, c3].map(commandToJsonLine);

    const runnerA = new CommandRunner();
    const resultA = replayCommandsFromJsonLines(lines, runnerA);
    expect(resultA.success).toBe(true);
    expect(runnerA.getTournament().matches['m1']).toBeDefined();

    const runnerB = new CommandRunner();
    const resultB = replayCommandsFromJsonLines(lines, runnerB);
    expect(resultB.success).toBe(true);

    expect(runnerB.getTournament()).toEqual(runnerA.getTournament());
  });

  it('should replay bracket progression when seeding and generate are command-logged', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const commands = [
      { id: 'p1', type: 'CreatePlayer' as const, dependsOn: [] as string[], payload: { playerId: 'p1', name: 'A', handicap: 0 }, timestamp: ts },
      { id: 'p2', type: 'CreatePlayer' as const, dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 }, timestamp: ts },
      { id: 'p3', type: 'CreatePlayer' as const, dependsOn: [], payload: { playerId: 'p3', name: 'C', handicap: 0 }, timestamp: ts },
      { id: 'p4', type: 'CreatePlayer' as const, dependsOn: [], payload: { playerId: 'p4', name: 'D', handicap: 0 }, timestamp: ts },
      { id: 'seed', type: 'SetSeedings' as const, dependsOn: ['p1', 'p2', 'p3', 'p4'], payload: { playerIds: ['p1', 'p2', 'p3', 'p4'] }, timestamp: ts },
      { id: 'gen', type: 'GenerateBracket' as const, dependsOn: ['seed'], payload: { fillByes: true, cullToPowerOfTwo: false }, timestamp: ts },
      {
        id: 'ma',
        type: 'CreateMatch' as const,
        dependsOn: ['gen', 'p1', 'p4'],
        payload: { matchId: 'match-a', playerA: 'p1', playerB: 'p4' },
        timestamp: ts,
      },
      {
        id: 'mb',
        type: 'CreateMatch' as const,
        dependsOn: ['gen', 'p2', 'p3'],
        payload: { matchId: 'match-b', playerA: 'p2', playerB: 'p3' },
        timestamp: ts,
      },
      {
        id: 'sa',
        type: 'EnterScore' as const,
        dependsOn: ['ma'],
        payload: {
          matchId: 'match-a',
          scores: [
            { playerA: 11, playerB: 9 },
            { playerA: 11, playerB: 6 },
            { playerA: 11, playerB: 5 },
          ],
        },
        timestamp: ts,
      },
      {
        id: 'sb',
        type: 'EnterScore' as const,
        dependsOn: ['mb'],
        payload: {
          matchId: 'match-b',
          scores: [
            { playerA: 11, playerB: 7 },
            { playerA: 3, playerB: 11 },
            { playerA: 11, playerB: 9 },
            { playerA: 11, playerB: 6 },
          ],
        },
        timestamp: ts,
      },
    ];
    const lines = commands.map(commandToJsonLine);
    const runner = new CommandRunner();
    const res = replayCommandsFromJsonLines(lines, runner);
    expect(res.success).toBe(true);
    expect(runner.getTournament().bracketMatches.some((m) => m.round === 2)).toBe(true);
  });

  it('should rebuild controller from exported JSONL text', () => {
    const ts = '2026-02-01T00:00:00.000Z';
    const cmds = [
      { id: 'p1', type: 'CreatePlayer' as const, dependsOn: [] as string[], payload: { playerId: 'p1', name: 'A', handicap: 0 }, timestamp: ts },
      { id: 'p2', type: 'CreatePlayer' as const, dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 }, timestamp: ts },
      { id: 'seed', type: 'SetSeedings' as const, dependsOn: ['p1', 'p2'], payload: { playerIds: ['p1', 'p2'] }, timestamp: ts },
      { id: 'gen', type: 'GenerateBracket' as const, dependsOn: ['seed'], payload: { fillByes: true, cullToPowerOfTwo: false }, timestamp: ts },
    ];
    const text = exportCommandsAsJsonLines(cmds);
    const { controller, replay } = tournamentControllerFromCommandLog(text);
    expect(replay.success).toBe(true);
    expect(controller.getTournament().bracketMatches.length).toBeGreaterThan(0);
  });

  it('should fail gracefully on malformed JSONL entry', () => {
    const lines = ['{ invalid json }'];
    const res = replayCommandsFromJsonLines(lines);
    expect(res.success).toBe(false);
    expect(res.results[0].success).toBe(false);
  });
});
