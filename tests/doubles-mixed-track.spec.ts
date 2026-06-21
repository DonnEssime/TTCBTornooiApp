import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { getTrackFormat } from '../src/doubles-track';

describe('mixed track tournament', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  it('keeps singles class isolated from doubles class', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'classes',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: { classes: [{ id: 'jun', name: 'Junior' }, { id: 'sen', name: 'Senior' }] },
      timestamp: ts,
    });
    for (let i = 1; i <= 6; i++) {
      const id = `p${i}`;
      runner.execute({
        id,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: `P${i}`, handicap: 0 },
        timestamp: ts,
      });
    }
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      payload: { playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] },
      timestamp: ts,
    });
    for (const [pid, flags] of [
      ['p1', { jun: true, sen: false }],
      ['p2', { jun: true, sen: false }],
      ['p3', { jun: true, sen: false }],
      ['p4', { jun: true, sen: false }],
      ['p5', { jun: false, sen: true }],
      ['p6', { jun: false, sen: true }],
    ] as const) {
      runner.execute({
        id: `flag-${pid}`,
        type: 'SetPlayerClassFlags',
        dependsOn: ['seed'],
        payload: { playerId: pid, flags },
        timestamp: ts,
      });
    }
    const rJun = runner.execute({
      id: 'sg-jun',
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: {
        classId: 'jun',
        targetGroupSize: 4,
        playerIds: ['p1', 'p2', 'p3', 'p4'],
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    expect(rJun.success).toBe(true);
    const rSen = runner.execute({
      id: 'sg-sen',
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: {
        classId: 'sen',
        targetGroupSize: 2,
        playerIds: ['p5', 'p6'],
      },
      timestamp: ts,
    });
    expect(rSen.success).toBe(true);
    const t = runner.getTournament();
    expect(getTrackFormat(t, 'jun')).toBe('doubles-random-partners');
    expect(getTrackFormat(t, 'sen')).toBe('singles');
    expect(Object.keys(t.classTournaments.jun!.pairs ?? {}).length).toBe(2);
    expect(t.classTournaments.sen!.pairs).toBeUndefined();
    const junGm = Object.values(t.matches).filter((m) => m.classId === 'jun' && m.groupId);
    const senGm = Object.values(t.matches).filter((m) => m.classId === 'sen' && m.groupId);
    expect(junGm.every((m) => m.pairA && m.pairB)).toBe(true);
    expect(senGm.every((m) => !m.pairA && !m.pairB)).toBe(true);
  });
});
