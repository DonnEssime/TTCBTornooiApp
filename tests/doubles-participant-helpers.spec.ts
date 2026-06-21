import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  groupParticipantCount,
  groupParticipantIds,
  unionGroupParticipantIds,
  findGroupForParticipant,
  bracketSeedsMatchSides,
  closedFormGroupCountForParticipantCount,
} from '../src/model';
import { trackBracketParticipants } from '../src/doubles-track';

describe('participant helpers', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function seedDoublesGroups(runner: CommandRunner, playerCount: number, targetGroupSize: number) {
    for (let i = 1; i <= playerCount; i++) {
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
      id: 'sg',
      type: 'SetGroups',
      dependsOn: Array.from({ length: playerCount }, (_, i) => `p${i + 1}`),
      payload: {
        targetGroupSize,
        playerIds: Array.from({ length: playerCount }, (_, i) => `p${i + 1}`),
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    return runner.getTournament();
  }

  it('groupParticipantIds returns pair ids in doubles', () => {
    const runner = new CommandRunner();
    const t = seedDoublesGroups(runner, 8, 4);
    const g = t.groups['1']!;
    expect(groupParticipantIds(t, g, undefined).length).toBe(4);
    expect(g.playerIds.length).toBe(8);
  });

  it('findGroupForParticipant resolves pair ids', () => {
    const runner = new CommandRunner();
    const t = seedDoublesGroups(runner, 4, 2);
    const pairId = t.groups['1']!.pairIds![0]!;
    expect(findGroupForParticipant(t, pairId, undefined)?.id).toBe('1');
  });

  it('unionGroupParticipantIds matches trackBracketParticipants', () => {
    const runner = new CommandRunner();
    const t = seedDoublesGroups(runner, 16, 4);
    const union = unionGroupParticipantIds(t, undefined).sort();
    const seeds = [...trackBracketParticipants(t, undefined)].sort();
    expect(union).toEqual(seeds);
    expect(union.length).toBe(8);
  });

  it('closedFormGroupCountForParticipantCount matches pair-based layout', () => {
    expect(closedFormGroupCountForParticipantCount(8)).toBe(2);
    expect(closedFormGroupCountForParticipantCount(9)).toBe(4);
  });

  it('bracketSeedsMatchSides maps pair seeds to match row fields', () => {
    const runner = new CommandRunner();
    const t = seedDoublesGroups(runner, 4, 2);
    const pairIds = t.groups['1']!.pairIds!;
    const sides = bracketSeedsMatchSides(t, pairIds[0]!, pairIds[1]!, undefined);
    expect(sides.pairA).toBe(pairIds[0]);
    expect(sides.pairB).toBe(pairIds[1]);
    expect(t.players[sides.playerA]).toBeTruthy();
    expect(t.players[sides.playerB]).toBeTruthy();
  });
});
