import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import { createTournament, isDebugModeActive } from '../src/model';

const ts = '2024-01-01T00:00:00.000Z';

describe('Debug mode (per-tournament developer tools)', () => {
  it('SetDebugMode enabled stores debugMode on tournament', () => {
    const runner = new CommandRunner();
    expect(isDebugModeActive(runner.getTournament())).toBe(false);

    expect(
      runner.execute({
        id: 'dm1',
        type: 'SetDebugMode',
        dependsOn: [],
        payload: { enabled: true },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
    expect(isDebugModeActive(runner.getTournament())).toBe(true);
    expect(runner.getTournament().debugMode).toBe(true);
  });

  it('SetDebugMode disabled clears debugMode', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'dm1',
      type: 'SetDebugMode',
      dependsOn: [],
      payload: { enabled: true },
      timestamp: ts,
    });
    expect(isDebugModeActive(runner.getTournament())).toBe(true);

    expect(
      runner.execute({
        id: 'dm2',
        type: 'SetDebugMode',
        dependsOn: ['dm1'],
        payload: { enabled: false },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
    expect(isDebugModeActive(runner.getTournament())).toBe(false);
    expect(runner.getTournament().debugMode).toBeUndefined();
  });

  it('replay round-trip preserves debugMode', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'dm1',
      type: 'SetDebugMode',
      dependsOn: [],
      payload: { enabled: true },
      timestamp: ts,
    });
    const log = runner.getHistory();
    const replay = new CommandRunner();
    for (const cmd of log) {
      replay.execute(cmd);
    }
    expect(isDebugModeActive(replay.getTournament())).toBe(true);
  });

  it('legacy tournament without SetDebugMode has debug off', () => {
    expect(isDebugModeActive(createTournament())).toBe(false);
  });
});
