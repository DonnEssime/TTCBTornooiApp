import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { trackBracketParticipants } from '../src/doubles-track';
import {
  generateBracket,
  resolveClosedFormBracketSeedingKind,
  equalSizedGroupBracketMeta,
} from '../src/model';

describe('doubles closed-form bracket', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function setupTwoGroupsOfFourPairs() {
    const runner = new CommandRunner();
    for (let i = 1; i <= 16; i++) {
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
      dependsOn: Array.from({ length: 16 }, (_, i) => `p${i + 1}`),
      payload: {
        targetGroupSize: 4,
        playerIds: Array.from({ length: 16 }, (_, i) => `p${i + 1}`),
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    return runner.getTournament();
  }

  it('resolveClosedFormBracketSeedingKind accepts 2×4 pair grid', () => {
    const t = setupTwoGroupsOfFourPairs();
    const participants = trackBracketParticipants(t, undefined);
    expect(participants.length).toBe(8);
    expect(resolveClosedFormBracketSeedingKind(t, participants, undefined)).toBe('exact');
    const meta = equalSizedGroupBracketMeta(t, undefined);
    expect(meta).toEqual({ G: 2, S: 4 });
  });

  it('generates closed-form bracket with pair seeds', () => {
    const t = setupTwoGroupsOfFourPairs();
    const participants = trackBracketParticipants(t, undefined);
    const bm = generateBracket(participants, t, {
      fillByes: true,
      cullToPowerOfTwo: false,
      bracketSeedingMode: 'crop_closed_form',
    });
    const r1 = bm.filter((m) => m.round === 1 && m.seedA && m.seedB);
    expect(r1.length).toBe(4);
    for (const m of r1) {
      expect(t.pairs![m.seedA!]).toBeTruthy();
      expect(t.pairs![m.seedB!]).toBeTruthy();
    }
  });
});
