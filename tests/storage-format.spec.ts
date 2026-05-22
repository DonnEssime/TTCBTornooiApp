import { describe, it, expect } from 'vitest';
import { CommandRunner, type CreatePlayerCommand } from '../src/command';
import {
  exportCommandsAsJsonLines,
  parseCommandLogLines,
  replayCommandsFromJsonLines,
  TOURNAMENT_STORAGE_FORMAT_VERSION,
  validateCommandLogFormat,
} from '../src/storage';

describe('Tournament log format version', () => {
  it('exportCommandsAsJsonLines prepends format header', () => {
    const text = exportCommandsAsJsonLines([]);
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(1);
    const header = JSON.parse(lines[0]!);
    expect(header.formatVersion).toBe(TOURNAMENT_STORAGE_FORMAT_VERSION);
    expect(header.type).toBe('TournamentLogHeader');
  });

  it('parseCommandLogLines rejects legacy logs without header', () => {
    const legacy = JSON.stringify({
      id: 'c1',
      type: 'CreatePlayer',
      timestamp: '2026-01-01T00:00:00.000Z',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
    } satisfies CreatePlayerCommand);
    expect(validateCommandLogFormat(legacy)?.code).toBe('legacy');
    expect(() => parseCommandLogLines(legacy)).toThrow(/no format header/i);
  });

  it('round-trips export through parse and replay', () => {
    const cmd: CreatePlayerCommand = {
      id: 'c1',
      type: 'CreatePlayer',
      timestamp: '2026-01-01T00:00:00.000Z',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'A', handicap: 0 },
    };
    const text = exportCommandsAsJsonLines([cmd]);
    const lines = parseCommandLogLines(text);
    const runner = new CommandRunner();
    const replay = replayCommandsFromJsonLines(lines, runner);
    expect(replay.success).toBe(true);
    expect(runner.getTournament().players['p1']?.name).toBe('A');
  });
});
