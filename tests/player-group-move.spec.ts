import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';

function baseCmd(id: string, type: any, payload: any, dependsOn: string[] = []) {
  return {
    id,
    type,
    timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    dependsOn,
    payload,
  };
}

describe('SetPlayerGroup', () => {
  it('creates scheduled matches when moving into a group', () => {
    const r = new CommandRunner();
    expect(r.execute(baseCmd('p-a', 'CreatePlayer', { playerId: 'a', name: 'A', handicap: 0 }) as any).success).toBe(true);
    expect(r.execute(baseCmd('p-b', 'CreatePlayer', { playerId: 'b', name: 'B', handicap: 0 }) as any).success).toBe(true);
    expect(r.execute(baseCmd('p-c', 'CreatePlayer', { playerId: 'c', name: 'C', handicap: 0 }) as any).success).toBe(true);
    expect(
      r.execute(
        baseCmd(
          'cmd-set-groups',
          'SetGroups',
          { groups: [{ id: 'g1', playerIds: ['b', 'c'] }] },
          [],
        ) as any,
      ).success,
    ).toBe(true);

    const cmd = baseCmd('cmd-move', 'SetPlayerGroup', { playerId: 'a', groupId: 'g1' }, []);
    expect(r.execute(cmd as any).success).toBe(true);

    const next = r.getTournament();
    expect(next.groups.g1.playerIds).toContain('a');
    expect(Object.keys(next.matches)).toEqual(expect.arrayContaining(['gm-g1-a-b', 'gm-g1-a-c']));
    expect(next.matches['gm-g1-a-b']?.status).toBe('scheduled');
    expect(next.matches['gm-g1-a-c']?.status).toBe('scheduled');
  });

  it('deletes scheduled group matches when leaving (only if no group match was played)', () => {
    const r = new CommandRunner();
    expect(r.execute(baseCmd('p-a', 'CreatePlayer', { playerId: 'a', name: 'A', handicap: 0 }) as any).success).toBe(true);
    expect(r.execute(baseCmd('p-b', 'CreatePlayer', { playerId: 'b', name: 'B', handicap: 0 }) as any).success).toBe(true);
    expect(
      r.execute(
        baseCmd(
          'cmd-set-groups',
          'SetGroups',
          { groups: [{ id: 'g1', playerIds: ['a', 'b'] }] },
          [],
        ) as any,
      ).success,
    ).toBe(true);

    expect(r.execute(baseCmd('cmd-leave', 'SetPlayerGroup', { playerId: 'a', groupId: null }) as any).success).toBe(
      true,
    );
    const next = r.getTournament();
    expect(next.groups.g1.playerIds).toEqual(['b']);
    expect(next.matches['gm-g1-a-b']).toBeUndefined();
  });

  it('blocks leaving a group when the player has recorded group play', () => {
    const r = new CommandRunner();
    expect(r.execute(baseCmd('p-a', 'CreatePlayer', { playerId: 'a', name: 'A', handicap: 0 }) as any).success).toBe(true);
    expect(r.execute(baseCmd('p-b', 'CreatePlayer', { playerId: 'b', name: 'B', handicap: 0 }) as any).success).toBe(true);
    expect(
      r.execute(
        baseCmd(
          'cmd-set-groups',
          'SetGroups',
          { groups: [{ id: 'g1', playerIds: ['a', 'b'] }] },
          [],
        ) as any,
      ).success,
    ).toBe(true);
    expect(
      r.execute(
        baseCmd('cmd-score', 'EnterScore', {
          matchId: 'gm-g1-a-b',
          scores: [
            { playerA: 11, playerB: 9 },
            { playerA: 11, playerB: 9 },
            { playerA: 11, playerB: 9 },
          ],
        }) as any,
      ).success,
    ).toBe(true);

    const res = r.execute(baseCmd('cmd-leave', 'SetPlayerGroup', { playerId: 'a', groupId: null }) as any);
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.cannotLeaveGroupAlreadyPlayed');
  });

  it('allows leaving a class group when recorded play is only in another class', () => {
    const r = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
    r.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: { classes: [{ id: 'jun', name: 'Junior' }, { id: 'sen', name: 'Senior' }] },
      timestamp: ts,
    });
    for (const pid of ['p1', 'p2', 'p3']) {
      r.execute(baseCmd(pid, 'CreatePlayer', { playerId: pid, name: pid, handicap: 0 }, ['tc']) as any);
    }
    r.execute(baseCmd('seed', 'SetSeedings', { playerIds: ['p1', 'p2', 'p3'] }, ['p1', 'p2', 'p3']) as any);
    for (const [pid, flags] of [
      ['p1', { jun: true, sen: true }],
      ['p2', { jun: true, sen: false }],
      ['p3', { jun: false, sen: true }],
    ] as const) {
      r.execute(baseCmd(`f-${pid}`, 'SetPlayerClassFlags', { playerId: pid, flags }, ['seed']) as any);
    }
    r.execute(
      baseCmd('scg-jun', 'SetClassGroups', { classId: 'jun', groups: [{ id: '1', playerIds: ['p1', 'p2'] }] }, ['seed']) as any,
    );
    r.execute(
      baseCmd('scg-sen', 'SetClassGroups', { classId: 'sen', groups: [{ id: '1', playerIds: ['p1', 'p3'] }] }, ['seed']) as any,
    );
    const junMid = 'gm-jun-1-p1-p2';
    r.execute(
      baseCmd(
        'score-jun',
        'EnterScore',
        { matchId: junMid, scores: [{ playerA: 11, playerB: 9 }, { playerA: 11, playerB: 6 }, { playerA: 11, playerB: 5 }] },
        ['scg-jun'],
      ) as any,
    );
    expect(
      r.execute(baseCmd('leave-sen', 'SetPlayerGroup', { playerId: 'p1', groupId: null, classId: 'sen' }, ['scg-sen']) as any)
        .success,
    ).toBe(true);
    expect(r.getTournament().classTournaments.sen!.groups['1'].playerIds).toEqual(['p3']);
  });

  it('is undoable via Undo command', () => {
    const r = new CommandRunner();
    expect(r.execute(baseCmd('p-a', 'CreatePlayer', { playerId: 'a', name: 'A', handicap: 0 }) as any).success).toBe(true);
    expect(r.execute(baseCmd('p-b', 'CreatePlayer', { playerId: 'b', name: 'B', handicap: 0 }) as any).success).toBe(true);
    expect(
      r.execute(
        baseCmd(
          'cmd-set-groups',
          'SetGroups',
          { groups: [{ id: 'g1', playerIds: ['b'] }] },
          [],
        ) as any,
      ).success,
    ).toBe(true);

    expect(r.execute(baseCmd('cmd-move', 'SetPlayerGroup', { playerId: 'a', groupId: 'g1' }) as any).success).toBe(
      true,
    );
    expect(r.getTournament().groups.g1.playerIds).toContain('a');

    const undo = baseCmd('cmd-undo', 'Undo', { targetCommandId: 'cmd-move' }, ['cmd-move']);
    expect(r.execute(undo as any).success).toBe(true);
    expect(r.getTournament().groups.g1.playerIds).toEqual(['b']);
  });
});

