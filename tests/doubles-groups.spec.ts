import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { getTrackFormat, getTrackPairs } from '../src/doubles-track';
import { roundRobinPairs } from '../src/model';

describe('doubles SetGroups', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function seedPlayers(runner: CommandRunner, n: number): string[] {
    const ids: string[] = [];
    for (let i = 1; i <= n; i++) {
      const id = `p${i}`;
      ids.push(id);
      runner.execute({
        id,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: `P${i}`, handicap: 0 },
        timestamp: ts,
      });
    }
    return ids;
  }

  it('rejects odd player count', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 5);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('command.doublesRequiresEvenPlayerCount');
  });

  it('creates pairs, pairIds on groups, and pair round-robin matches', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 8);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(true);
    const t = runner.getTournament();
    expect(getTrackFormat(t)).toBe('doubles-random-partners');
    expect(Object.keys(getTrackPairs(t)).length).toBe(4);
    const g = t.groups['1']!;
    expect(g.pairIds?.length).toBe(4);
    expect(g.playerIds.length).toBe(8);
    const gm = Object.values(t.matches).filter((m) => m.groupId);
    expect(gm.length).toBe(roundRobinPairs(g.pairIds!).length);
    for (const m of gm) {
      expect(m.pairA).toBeTruthy();
      expect(m.pairB).toBeTruthy();
    }
  });

  it('targetGroupSize is pairs per group, not players', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 16);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(true);
    const groups = Object.values(runner.getTournament().groups);
    expect(groups.length).toBe(2);
    for (const g of groups) {
      expect(g.pairIds?.length).toBe(4);
      expect(g.playerIds.length).toBe(8);
    }
  });

  it('clearing groups resets format and pairs', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 4);
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    runner.execute({
      id: 'sgz-clear',
      type: 'SetGroups',
      dependsOn: ['sgz'],
      payload: { groups: [] },
      timestamp: ts,
    });
    const t = runner.getTournament();
    expect(getTrackFormat(t)).toBe('singles');
    expect(getTrackPairs(t)).toEqual({});
    expect(Object.keys(t.groups).length).toBe(0);
  });
});

describe('doubles SetPlayerGroup', () => {
  it('blocks moving players when track is doubles', () => {
    const runner = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
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
        targetGroupSize: 4,
        playerIds: ['p1', 'p2', 'p3', 'p4'],
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
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
