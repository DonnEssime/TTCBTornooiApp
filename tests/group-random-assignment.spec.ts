import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import { buildNumberedGroupsFromPlayerOrderByGroupCount } from '../src/model';

function createEightPlayers(runner: CommandRunner): void {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    runner.execute({
      id: `cmd-${id}`,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: id, name: id.toUpperCase(), handicap: 0 },
      timestamp: `2026-01-01T00:00:0${i}.000Z`,
    });
  }
  runner.execute({
    id: 'cmd-seed',
    type: 'SetSeedings',
    dependsOn: ids.map((id) => `cmd-${id}`),
    payload: { playerIds: ids },
    timestamp: '2026-01-01T00:00:10.000Z',
  });
}

function groupPlayerSets(t: ReturnType<CommandRunner['getTournament']>): string[][] {
  return Object.values(t.groups)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((g) => [...g.playerIds].sort());
}

describe('time-seeded random group assignment', () => {
  it('does not assign players sequentially by seeding order', () => {
    const sequential = buildNumberedGroupsFromPlayerOrderByGroupCount(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      2,
    ).map((g) => [...g.playerIds].sort());

    const runner = new CommandRunner();
    createEightPlayers(runner);
    runner.execute({
      id: 'cmd-sg',
      type: 'SetGroups',
      dependsOn: ['cmd-seed'],
      payload: { targetGroupCount: 2, playerIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
      timestamp: '2026-03-15T14:30:00.000Z',
    });

    const actual = groupPlayerSets(runner.getTournament());
    expect(actual).not.toEqual(sequential);
  });

  it('replays identical groups for the same command timestamp', () => {
    const run = (ts: string) => {
      const runner = new CommandRunner();
      createEightPlayers(runner);
      runner.execute({
        id: 'cmd-sg',
        type: 'SetGroups',
        dependsOn: ['cmd-seed'],
        payload: { targetGroupCount: 2, playerIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
        timestamp: ts,
      });
      return groupPlayerSets(runner.getTournament());
    };

    const a = run('2026-03-15T14:30:00.000Z');
    const b = run('2026-03-15T14:30:00.000Z');
    expect(a).toEqual(b);
  });

  it('can produce different groups for different timestamps', () => {
    const run = (ts: string) => {
      const runner = new CommandRunner();
      createEightPlayers(runner);
      runner.execute({
        id: 'cmd-sg',
        type: 'SetGroups',
        dependsOn: ['cmd-seed'],
        payload: { targetGroupCount: 2, playerIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
        timestamp: ts,
      });
      return groupPlayerSets(runner.getTournament());
    };

    expect(run('2026-03-15T14:30:00.000Z')).not.toEqual(run('2026-03-15T14:31:00.000Z'));
  });

  it('shuffles class groups with the command timestamp', () => {
    const sequential = buildNumberedGroupsFromPlayerOrderByGroupCount(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      2,
    ).map((g) => [...g.playerIds].sort());

    const runner = new CommandRunner();
    runner.execute({
      id: 'cmd-classes',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: {
        classes: [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
      },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    createEightPlayers(runner);
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      runner.execute({
        id: `cmd-pcf-${id}`,
        type: 'SetPlayerClassFlags',
        dependsOn: [`cmd-${id}`],
        payload: { playerId: id, flags: { jun: true } },
        timestamp: '2026-01-01T00:00:20.000Z',
      });
    }
    runner.execute({
      id: 'cmd-scg',
      type: 'SetClassGroups',
      dependsOn: ['cmd-seed'],
      payload: {
        classId: 'jun',
        targetGroupCount: 2,
        playerIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      },
      timestamp: '2026-04-01T09:00:00.000Z',
    });

    const actual = Object.values(runner.getTournament().classTournaments.jun!.groups)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((g) => [...g.playerIds].sort());
    expect(actual).not.toEqual(sequential);
  });

  it('randomizes doubles pair placement across groups', () => {
    const runner = new CommandRunner();
    createEightPlayers(runner);
    runner.execute({
      id: 'cmd-sg',
      type: 'SetGroups',
      dependsOn: ['cmd-seed'],
      payload: {
        targetGroupCount: 2,
        playerIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        format: 'doubles-random-partners',
      },
      timestamp: '2026-05-01T12:00:00.000Z',
    });

    const t = runner.getTournament();
    const pairSets = Object.values(t.groups)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((g) => [...(g.pairIds ?? [])].sort());
    const creationOrderPairs = [
      'pair-a-b',
      'pair-c-d',
      'pair-e-f',
      'pair-g-h',
    ];
    const sequentialPairs = [
      [...creationOrderPairs.slice(0, 2)].sort(),
      [...creationOrderPairs.slice(2, 4)].sort(),
    ];
    expect(pairSets).not.toEqual(sequentialPairs);
  });
});
