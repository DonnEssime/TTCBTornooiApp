import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { getTrackFormat, getTrackPairs } from '../src/doubles-track';

describe('shuffle doubles SetGroups', () => {
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

  it('rejects player count not divisible by 4', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 6);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(false);
    expect(r.reason).toBe('command.shuffleDoublesRequiresQuadrupleCount');
  });

  it('creates groups of 4 with three shuffle doubles matches per group', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 8);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(true);
    const t = runner.getTournament();
    expect(getTrackFormat(t)).toBe('doubles-shuffle-partners');
    expect(Object.keys(getTrackPairs(t)).length).toBe(0);
    expect(Object.keys(t.groups).length).toBe(2);
    for (const g of Object.values(t.groups)) {
      expect(g.playerIds.length).toBe(4);
      expect(g.pairIds).toBeUndefined();
      const gm = Object.values(t.matches).filter((m) => m.groupId === g.id);
      expect(gm.length).toBe(3);
      for (const m of gm) {
        expect(m.teamA?.length).toBe(2);
        expect(m.teamB?.length).toBe(2);
        expect(m.shuffleRound).toBeDefined();
      }
    }
    expect(Object.values(t.matches).filter((m) => m.groupId).length).toBe(6);
  });

  it('works with 12 players (3 groups)', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 12);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupCount: 3,
        playerIds: ids,
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(true);
    const t = runner.getTournament();
    expect(Object.keys(t.groups).length).toBe(3);
    expect(Object.values(t.matches).filter((m) => m.groupId).length).toBe(9);
  });

  it('rejects manual groups when a group is not size 4', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 8);
    const r = runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        groups: [
          { id: '1', playerIds: ids.slice(0, 4) },
          { id: '2', playerIds: ids.slice(4, 8) },
        ],
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    expect(r.success).toBe(true);
    const r2 = runner.execute({
      id: 'sgz-bad',
      type: 'SetGroups',
      dependsOn: ['sgz'],
      payload: {
        groups: [{ id: '1', playerIds: ids.slice(0, 6) }],
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    expect(r2.success).toBe(false);
    expect(r2.reason).toBe('command.shuffleDoublesGroupSizeMustBeFour');
  });

  it('clearing groups resets format', () => {
    const runner = new CommandRunner();
    const ids = seedPlayers(runner, 4);
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn: ids,
      payload: {
        targetGroupSize: 4,
        playerIds: ids,
        format: 'doubles-shuffle-partners',
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
    expect(Object.keys(t.groups).length).toBe(0);
    expect(Object.values(t.matches).filter((m) => m.groupId).length).toBe(0);
  });
});
