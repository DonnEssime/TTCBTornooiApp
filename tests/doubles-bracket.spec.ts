import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { getTrackPairs } from '../src/doubles-track';
import {
  bracketMatchRound,
  bracketPlayerMatchId,
  bracketSlotAwaitingPlay,
  findThirdPlaceBracketMatch,
  matchPlayersResolvedForBracketPhaseList,
} from '../src/model';

describe('doubles bracket', () => {
  const ts = '2026-01-01T00:00:00.000Z';
  const BO3 = [
    { playerA: 11, playerB: 5 },
    { playerA: 11, playerB: 5 },
    { playerA: 11, playerB: 5 },
  ];

  function seedDoublesPlayers(runner: CommandRunner, count: number): string[] {
    const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`);
    for (const id of ids) {
      runner.execute({
        id,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: id, handicap: 0 },
        timestamp: ts,
      });
    }
    return ids;
  }

  function finishGroupPhase(runner: CommandRunner): void {
    for (const m of Object.values(runner.getTournament().matches)) {
      if (m.groupId && m.status !== 'finished') {
        runner.execute({
          id: `score-${m.id}`,
          type: 'EnterScore',
          dependsOn: [],
          payload: { matchId: m.id, scores: BO3 },
          timestamp: ts,
        });
      }
    }
  }

  it('GenerateBracket materializes round-1 player rows with pair sides', () => {
    const runner = new CommandRunner();
    const ids = seedDoublesPlayers(runner, 4);
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
    finishGroupPhase(runner);
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
    const km = t.matches[bracketPlayerMatchId(bm.id)]!;
    expect(km.pairA).toBe(bm.seedA);
    expect(km.pairB).toBe(bm.seedB);
    expect(matchPlayersResolvedForBracketPhaseList(t, km, undefined)).toBe(true);
    expect(bracketSlotAwaitingPlay(t, bm)).toBe(true);
  });

  it('closed-form doubles bracket creates playable round-1 rows for all pairings', () => {
    const runner = new CommandRunner();
    const ids = seedDoublesPlayers(runner, 16);
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
    finishGroupPhase(runner);
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['sgz'],
      payload: {
        fillByes: true,
        cullToPowerOfTwo: false,
        bracketSeedingMode: 'crop_closed_form',
      },
      timestamp: ts,
    });
    const t = runner.getTournament();
    const r1 = t.bracketMatches.filter(
      (bm) => bm.seedA && bm.seedB && bracketMatchRound(bm) === 1,
    );
    expect(r1.length).toBeGreaterThan(0);
    for (const bm of r1) {
      const m = t.matches[bracketPlayerMatchId(bm.id)];
      expect(m?.pairA).toBeTruthy();
      expect(m?.pairB).toBeTruthy();
      expect(matchPlayersResolvedForBracketPhaseList(t, m!, undefined)).toBe(true);
    }
  });

  it('creates a pair-seeded third-place match after both doubles semis', () => {
    const runner = new CommandRunner();
    const ids = seedDoublesPlayers(runner, 8);
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
    finishGroupPhase(runner);
    const pairIds = Object.keys(getTrackPairs(runner.getTournament()));
    expect(pairIds).toHaveLength(4);
    runner.execute({
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: ['sgz'],
      payload: { fillByes: true, cullToPowerOfTwo: false },
      timestamp: ts,
    });
    const r1 = runner
      .getTournament()
      .bracketMatches.filter((bm) => bm.seedA && bm.seedB && bracketMatchRound(bm) === 1);
    expect(r1).toHaveLength(2);
    for (const bm of r1) {
      expect(
        runner.execute({
          id: `score-${bm.id}`,
          type: 'EnterScore',
          dependsOn: ['gen'],
          payload: { matchId: bracketPlayerMatchId(bm.id), scores: BO3 },
          timestamp: ts,
        }),
      ).toEqual({ success: true });
    }
    const t = runner.getTournament();
    const tp = findThirdPlaceBracketMatch(t.bracketMatches);
    expect(tp?.seedA && tp.seedB).toBeTruthy();
    expect(pairIds).toContain(tp!.seedA);
    expect(pairIds).toContain(tp!.seedB);
    const km = t.matches[bracketPlayerMatchId(tp!.id)]!;
    expect(km.pairA).toBe(tp!.seedA);
    expect(km.pairB).toBe(tp!.seedB);
    expect(
      runner.execute({
        id: 'score-tp',
        type: 'EnterScore',
        dependsOn: r1.map((bm) => `score-${bm.id}`),
        payload: { matchId: km.id, scores: BO3 },
        timestamp: ts,
      }),
    ).toEqual({ success: true });
  });
});
