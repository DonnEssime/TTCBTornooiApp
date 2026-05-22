import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  DEFAULT_NUMERICAL_HANDICAP_CONFIG,
  clampPlayerHandicapValue,
  createTournament,
  randomPlayerHandicapValue,
} from '../src/model';

describe('Handicap configuration', () => {
  it('SetHandicapConfig stores numerical bounds and validates CreatePlayer handicap', () => {
    const runner = new CommandRunner();
    const ts = '2024-01-01T00:00:00.000Z';
    expect(
      runner.execute({
        id: 'hc1',
        type: 'SetHandicapConfig',
        dependsOn: [],
        payload: { config: { ...DEFAULT_NUMERICAL_HANDICAP_CONFIG, minValue: 2, maxValue: 5 } },
        timestamp: ts,
      }),
    ).toEqual({ success: true });

    expect(
      runner.execute({
        id: 'p1',
        type: 'CreatePlayer',
        dependsOn: ['hc1'],
        payload: { playerId: 'p1', name: 'Ann', handicap: 1 },
        timestamp: ts,
      }),
    ).toMatchObject({
      success: false,
      reason: 'model.handicapMustBeIntegerInRange',
      reasonParams: { min: '2', max: '5' },
    });

    expect(
      runner.execute({
        id: 'p2',
        type: 'CreatePlayer',
        dependsOn: ['hc1'],
        payload: { playerId: 'p2', name: 'Bob', handicap: 4 },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
    expect(runner.getTournament().players['p2']?.handicap).toBe(4);
  });

  it('rejects classification system until implemented', () => {
    const runner = new CommandRunner();
    const r = runner.execute({
      id: 'hc1',
      type: 'SetHandicapConfig',
      dependsOn: [],
      payload: {
        config: {
          system: 'classification',
          minValue: 0,
          maxValue: 9,
          startingCriteria: 'headstart',
          maxStartAdjustment: 7,
        },
      },
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('model.classificationHandicapsNotImplemented');
  });

  it('randomPlayerHandicapValue stays within configured bounds', () => {
    const config = { ...DEFAULT_NUMERICAL_HANDICAP_CONFIG, minValue: 3, maxValue: 6 };
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const v = randomPlayerHandicapValue(config, () => i / 40);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(clampPlayerHandicapValue(config, 99)).toBe(6);
  });

  it('clearing handicap config removes tournament.handicapConfig', () => {
    const t = createTournament();
    t.handicapConfig = { ...DEFAULT_NUMERICAL_HANDICAP_CONFIG };
    const runner = new CommandRunner(t);
    runner.execute({
      id: 'hc-off',
      type: 'SetHandicapConfig',
      dependsOn: [],
      payload: { config: null },
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    expect(runner.getTournament().handicapConfig).toBeUndefined();
  });
});
