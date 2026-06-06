import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  DEFAULT_MISC_CONFIG,
  formatPlayerDisplayLabel,
  sortPlayerIdsByName,
  isMiscActive,
  isPlayerDisplayIdentityTaken,
  normalizeMiscConfig,
  randomDebugPlayerMiscValue,
} from '../src/model';

const ts = '2024-01-01T00:00:00.000Z';

describe('Misc (per-player club) configuration', () => {
  it('SetMiscConfig stores label and requires misc on CreatePlayer', () => {
    const runner = new CommandRunner();
    expect(
      runner.execute({
        id: 'mc1',
        type: 'SetMiscConfig',
        dependsOn: [],
        payload: { config: { label: 'Club' } },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
    expect(isMiscActive(runner.getTournament())).toBe(true);

    expect(
      runner.execute({
        id: 'p1',
        type: 'CreatePlayer',
        dependsOn: ['mc1'],
        payload: { playerId: 'p1', name: 'Ann', handicap: 0, misc: '' },
        timestamp: ts,
      }),
    ).toMatchObject({ success: false, reason: 'command.playerMiscRequired' });

    expect(
      runner.execute({
        id: 'p2',
        type: 'CreatePlayer',
        dependsOn: ['mc1'],
        payload: { playerId: 'p2', name: 'Ann', handicap: 0, misc: 'Eendracht' },
        timestamp: ts,
      }),
    ).toEqual({ success: true });

    expect(
      runner.execute({
        id: 'p3',
        type: 'CreatePlayer',
        dependsOn: ['mc1'],
        payload: { playerId: 'p3', name: 'Ann', handicap: 0, misc: '  eendracht ' },
        timestamp: ts,
      }),
    ).toMatchObject({ success: false, reason: 'command.playerNameMiscAlreadyExists' });

    expect(
      runner.execute({
        id: 'p4',
        type: 'CreatePlayer',
        dependsOn: ['mc1'],
        payload: { playerId: 'p4', name: 'Ann', handicap: 0, misc: 'Borgerhout' },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
  });

  it('without misc config, duplicate names are still rejected and misc is ignored', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p1', name: 'Ann', handicap: 0, misc: 'Ignored' },
      timestamp: ts,
    });
    const r = runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: 'p2', name: ' ann ', handicap: 0, misc: 'Other' },
      timestamp: ts,
    });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('command.playerNameAlreadyExists');
    expect(runner.getTournament().players['p1']?.misc).toBe('');
  });

  it('sortPlayerIdsByName orders by player name regardless of input order', () => {
    const runner = new CommandRunner();
    for (const [id, name] of [
      ['p3', 'Charlie'],
      ['p1', 'Alice'],
      ['p2', 'Bob'],
    ] as const) {
      runner.execute({
        id: `c-${id}`,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name, handicap: 0 },
        timestamp: ts,
      });
    }
    const t = runner.getTournament();
    expect(sortPlayerIdsByName(t, ['p3', 'p1', 'p2'])).toEqual(['p1', 'p2', 'p3']);
    expect(sortPlayerIdsByName(t, ['p2', 'p3', 'p1'])).toEqual(['p1', 'p2', 'p3']);
  });

  it('formatPlayerDisplayLabel appends handicap and misc in separate parentheses', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'mc1',
      type: 'SetMiscConfig',
      dependsOn: [],
      payload: { config: DEFAULT_MISC_CONFIG },
      timestamp: ts,
    });
    runner.execute({
      id: 'hc1',
      type: 'SetHandicapConfig',
      dependsOn: ['mc1'],
      payload: { config: { system: 'numerical', minValue: 0, maxValue: 9, startingCriteria: 'headstart', maxStartAdjustment: 7 } },
      timestamp: ts,
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: ['hc1'],
      payload: { playerId: 'p1', name: 'Ann', handicap: 4, misc: 'TT Borgerhout' },
      timestamp: ts,
    });
    const t = runner.getTournament();
    expect(formatPlayerDisplayLabel(t, 'p1')).toBe('Ann (4) (TT Borgerhout)');
  });

  it('normalizeMiscConfig defaults label to club', () => {
    expect(normalizeMiscConfig({})).toEqual({ label: 'club' });
    expect(normalizeMiscConfig({ label: '  Team  ' })).toEqual({ label: 'Team' });
    expect(normalizeMiscConfig(null)).toBeUndefined();
  });

  it('randomDebugPlayerMiscValue returns non-empty strings', () => {
    const v = randomDebugPlayerMiscValue(() => 0.5);
    expect(v.length).toBeGreaterThan(0);
  });

  it('isPlayerDisplayIdentityTaken respects exceptPlayerId on rename', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'mc1',
      type: 'SetMiscConfig',
      dependsOn: [],
      payload: { config: DEFAULT_MISC_CONFIG },
      timestamp: ts,
    });
    runner.execute({
      id: 'p1',
      type: 'CreatePlayer',
      dependsOn: ['mc1'],
      payload: { playerId: 'p1', name: 'Ann', handicap: 0, misc: 'A' },
      timestamp: ts,
    });
    runner.execute({
      id: 'p2',
      type: 'CreatePlayer',
      dependsOn: ['mc1'],
      payload: { playerId: 'p2', name: 'Bob', handicap: 0, misc: 'B' },
      timestamp: ts,
    });
    const t = runner.getTournament();
    expect(isPlayerDisplayIdentityTaken(t, 'Bob', 'B', 'p2')).toBe(false);
    expect(isPlayerDisplayIdentityTaken(t, 'Ann', 'A', 'p2')).toBe(true);
  });
});
