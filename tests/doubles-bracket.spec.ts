import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { getTrackPairs } from '../src/doubles-track';
import { bracketPlayerMatchId } from '../src/model';

describe('doubles bracket', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  it('creates knockout matches with pair sides after group phase', () => {
    const runner = new CommandRunner();
    const ids = ['p1', 'p2', 'p3', 'p4'] as const;
    for (const id of ids) {
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
      dependsOn: [...ids],
      payload: {
        targetGroupSize: 4,
        playerIds: [...ids],
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    const pairs = getTrackPairs(runner.getTournament());
    const pairIds = Object.keys(pairs);
    expect(pairIds.length).toBe(2);
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['sgz'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: ts,
    });
    const t = runner.getTournament();
    const r1 = t.bracketMatches.filter((bm) => bm.seedA && bm.seedB);
    expect(r1.length).toBeGreaterThan(0);
    expect(pairIds).toContain(r1[0]!.seedA);
    const bm = r1[0]!;
    runner.execute({
      id: 'cm',
      type: 'CreateMatch',
      dependsOn: ['gen'],
      payload: {
        matchId: bracketPlayerMatchId(bm.id),
        playerA: pairs[bm.seedA!]!.playerIds[0],
        playerB: pairs[bm.seedB!]!.playerIds[0],
        pairA: bm.seedA,
        pairB: bm.seedB,
      },
      timestamp: ts,
    });
    const km = runner.getTournament().matches[bracketPlayerMatchId(bm.id)]!;
    expect(km.pairA).toBe(bm.seedA);
    expect(km.pairB).toBe(bm.seedB);
  });
});
