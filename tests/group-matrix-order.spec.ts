import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { groupMatrixParticipantOrder } from '../src/model';

describe('groupMatrixParticipantOrder', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  it('keeps creation order while group matches are still open', () => {
    const r = new CommandRunner();
    for (const id of ['a', 'b', 'c']) {
      r.execute({
        id: `p-${id}`,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: id.toUpperCase(), handicap: 0 },
        timestamp: ts,
      });
    }
    r.execute({
      id: 'sg',
      type: 'SetGroups',
      dependsOn: ['p-a', 'p-b', 'p-c'],
      payload: { groups: [{ id: '1', playerIds: ['c', 'a', 'b'] }] },
      timestamp: ts,
    });
    const t = r.getTournament();
    const g = t.groups['1']!;
    expect(groupMatrixParticipantOrder(t, g, undefined)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by standings once every group match is finished', () => {
    const r = new CommandRunner();
    for (const id of ['a', 'b', 'c']) {
      r.execute({
        id: `p-${id}`,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: id.toUpperCase(), handicap: 0 },
        timestamp: ts,
      });
    }
    r.execute({
      id: 'sg',
      type: 'SetGroups',
      dependsOn: ['p-a', 'p-b', 'p-c'],
      payload: { groups: [{ id: '1', playerIds: ['c', 'a', 'b'] }] },
      timestamp: ts,
    });
    const sweep = [
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 3 },
    ];
    for (const mid of ['gm-1-a-b', 'gm-1-a-c', 'gm-1-b-c']) {
      r.execute({
        id: `sc-${mid}`,
        type: 'EnterScore',
        dependsOn: ['sg'],
        payload: { matchId: mid, scores: sweep },
        timestamp: ts,
      });
    }
    const t = r.getTournament();
    const g = t.groups['1']!;
    expect(groupMatrixParticipantOrder(t, g, undefined)).toEqual(['a', 'b', 'c']);
  });
});
