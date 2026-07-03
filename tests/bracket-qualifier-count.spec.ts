import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  createTournament,
  generateBracket,
  closedFormQualifierLayout,
  qualifierCountClosedFormCompatible,
  resolveClosedFormBracketSeedingKind,
  selectTopParticipantsForBracket,
  type Match,
  type Tournament,
} from '../src/model';
import { trackBracketParticipants } from '../src/doubles-track';

function finishMatchAsAWins(t: Tournament, matchId: string, winnerId: string): void {
  const m = t.matches[matchId]!;
  const scores =
    m.playerA === winnerId
      ? [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 7 },
          { playerA: 11, playerB: 3 },
        ]
      : [
          { playerA: 5, playerB: 11 },
          { playerA: 7, playerB: 11 },
          { playerA: 3, playerB: 11 },
        ];
  m.scores = scores;
  m.status = 'finished';
  m.winner = winnerId;
}

function finishAllGroupMatches(t: Tournament, classId?: string): void {
  for (const m of Object.values(t.matches)) {
    if (!m.groupId) continue;
    if (classId !== undefined && m.classId !== classId) continue;
    if (!classId && m.classId) continue;
    if (m.status === 'finished') continue;
    finishMatchAsAWins(t, m.id, m.playerA);
  }
}

function addPlayersAndGroups4x4(runner: CommandRunner): void {
  const ts = '2026-01-01T00:00:00.000Z';
  const ids: string[] = [];
  for (let g = 1; g <= 4; g++) {
    for (let p = 1; p <= 4; p++) {
      const id = `g${g}p${p}`;
      ids.push(id);
      runner.execute({
        id: `cmd-${id}`,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: id, handicap: 0 },
        timestamp: ts,
      });
    }
  }
  runner.execute({
    id: 'cmd-seed',
    type: 'SetSeedings',
    dependsOn: ids.map((id) => `cmd-${id}`),
    payload: { playerIds: ids },
    timestamp: ts,
  });
  runner.execute({
    id: 'cmd-sg',
    type: 'SetGroups',
    dependsOn: ['cmd-seed'],
    payload: {
      groups: [
        { id: '1', playerIds: ['g1p1', 'g1p2', 'g1p3', 'g1p4'] },
        { id: '2', playerIds: ['g2p1', 'g2p2', 'g2p3', 'g2p4'] },
        { id: '3', playerIds: ['g3p1', 'g3p2', 'g3p3', 'g3p4'] },
        { id: '4', playerIds: ['g4p1', 'g4p2', 'g4p3', 'g4p4'] },
      ],
      playerIds: [],
    },
    timestamp: ts,
  });
}

describe('selectTopParticipantsForBracket', () => {
  it('takes floor(X/N) per group plus best next ranks globally for X=10 in 4 groups', () => {
    const runner = new CommandRunner();
    addPlayersAndGroups4x4(runner);
    const t = runner.getTournament();
    finishAllGroupMatches(t);

    const all = t.seedings;
    const picked = selectTopParticipantsForBracket(t, all, undefined, 10, 'salt');
    expect(picked).toHaveLength(10);
    expect(picked).toEqual(
      expect.arrayContaining(['g1p1', 'g1p2', 'g2p1', 'g2p2', 'g3p1', 'g3p2', 'g4p1', 'g4p2']),
    );
    const thirds = ['g1p3', 'g2p3', 'g3p3', 'g4p3'];
    const pickedThirds = picked.filter((id) => thirds.includes(id));
    expect(pickedThirds).toHaveLength(2);
  });

  it('handles unequal group counts with floor(X/N) plus ratio fill', () => {
    const t = createTournament();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      t.players[id] = { id, name: id, handicap: 0 };
    }
    t.seedings = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    t.groups = {
      ga: { id: 'ga', playerIds: ['a', 'b', 'c'] },
      gb: { id: 'gb', playerIds: ['d', 'e', 'f', 'g'] },
      gc: { id: 'gc', playerIds: ['h', 'i', 'j', 'k' as never].filter(Boolean) as string[] },
    };
    t.groups.gc = { id: 'gc', playerIds: ['h', 'i', 'j'] };
    t.groups.gd = { id: 'gd', playerIds: ['k', 'l', 'm', 'n', 'o'] };
    for (const id of ['k', 'l', 'm', 'n', 'o']) {
      t.players[id] = { id, name: id, handicap: 0 };
      t.seedings.push(id);
    }

    const mk = (id: string, a: string, b: string, winner: string): Match => ({
      id,
      playerA: a,
      playerB: b,
      groupId: 'ga',
      scores: winner === a
        ? [
            { playerA: 11, playerB: 5 },
            { playerA: 11, playerB: 7 },
            { playerA: 11, playerB: 3 },
          ]
        : [
            { playerA: 5, playerB: 11 },
            { playerA: 7, playerB: 11 },
            { playerA: 3, playerB: 11 },
          ],
      status: 'finished',
      winner,
    });

    t.matches = {
      'ga-ab': { ...mk('ga-ab', 'a', 'b', 'a'), groupId: 'ga' },
      'ga-ac': { ...mk('ga-ac', 'a', 'c', 'a'), groupId: 'ga' },
      'ga-bc': { ...mk('ga-bc', 'b', 'c', 'b'), groupId: 'ga' },
      'gb-de': { ...mk('gb-de', 'd', 'e', 'd'), groupId: 'gb' },
      'gb-df': { ...mk('gb-df', 'd', 'f', 'd'), groupId: 'gb' },
      'gb-dg': { ...mk('gb-dg', 'd', 'g', 'd'), groupId: 'gb' },
      'gb-ef': { ...mk('gb-ef', 'e', 'f', 'e'), groupId: 'gb' },
      'gb-eg': { ...mk('gb-eg', 'e', 'g', 'e'), groupId: 'gb' },
      'gb-fg': { ...mk('gb-fg', 'f', 'g', 'f'), groupId: 'gb' },
      'gc-hi': { ...mk('gc-hi', 'h', 'i', 'h'), groupId: 'gc' },
      'gc-hj': { ...mk('gc-hj', 'h', 'j', 'h'), groupId: 'gc' },
      'gc-ij': { ...mk('gc-ij', 'i', 'j', 'i'), groupId: 'gc' },
      'gd-kl': { ...mk('gd-kl', 'k', 'l', 'k'), groupId: 'gd' },
      'gd-km': { ...mk('gd-km', 'k', 'm', 'k'), groupId: 'gd' },
      'gd-kn': { ...mk('gd-kn', 'k', 'n', 'k'), groupId: 'gd' },
      'gd-ko': { ...mk('gd-ko', 'k', 'o', 'k'), groupId: 'gd' },
      'gd-lm': { ...mk('gd-lm', 'l', 'm', 'l'), groupId: 'gd' },
      'gd-ln': { ...mk('gd-ln', 'l', 'n', 'l'), groupId: 'gd' },
      'gd-lo': { ...mk('gd-lo', 'l', 'o', 'l'), groupId: 'gd' },
      'gd-mn': { ...mk('gd-mn', 'm', 'n', 'm'), groupId: 'gd' },
      'gd-mo': { ...mk('gd-mo', 'm', 'o', 'm'), groupId: 'gd' },
      'gd-no': { ...mk('gd-no', 'n', 'o', 'n'), groupId: 'gd' },
    };

    const picked = selectTopParticipantsForBracket(t, t.seedings, undefined, 9, 'salt');
    expect(picked).toHaveLength(9);
    expect(picked).toEqual(expect.arrayContaining(['a', 'd', 'h', 'k']));
    expect(picked.filter((id) => ['b', 'e', 'i', 'l'].includes(id))).toHaveLength(4);
  });
});

describe('generateBracket qualifierCount', () => {
  it('only seeds selected participants into round one', () => {
    const runner = new CommandRunner();
    addPlayersAndGroups4x4(runner);
    const t = runner.getTournament();
    finishAllGroupMatches(t);

    const bm = generateBracket(t.seedings, t, {
      fillByes: true,
      cullToPowerOfTwo: false,
      qualifierCount: 8,
      bracketSeedingMode: 'heuristic',
      tieBreakSalt: 'test',
    });
    const r1Ids = new Set(
      bm
        .filter((m) => m.round === 1)
        .flatMap((m) => [m.seedA, m.seedB])
        .filter((x): x is string => Boolean(x) && x !== 'BYE'),
    );
    expect(r1Ids.size).toBeLessThanOrEqual(8);
    const expected = new Set(selectTopParticipantsForBracket(t, t.seedings, undefined, 8, 'test'));
    for (const id of r1Ids) {
      expect(expected.has(id)).toBe(true);
    }
  });

  it('closedFormQualifierLayout accepts G×4 and rejects uneven top-N splits', () => {
    const runner = new CommandRunner();
    addPlayersAndGroups4x4(runner);
    const t = runner.getTournament();
    finishAllGroupMatches(t);
    expect(closedFormQualifierLayout(t, undefined, 16)).toEqual({ perGroup: 4, kind: 'exact' });
    expect(closedFormQualifierLayout(t, undefined, 10)).toBeNull();
    expect(closedFormQualifierLayout(t, undefined, 8)).toEqual({ perGroup: 2, kind: 'virtual' });
  });

  it('qualifierCountClosedFormCompatible is false for 10 and true for 16 in 4×4 grid', () => {
    const runner = new CommandRunner();
    addPlayersAndGroups4x4(runner);
    const t = runner.getTournament();
    finishAllGroupMatches(t);
    const all = t.seedings;
    expect(qualifierCountClosedFormCompatible(t, undefined, 10, all)).toBe(false);
    expect(qualifierCountClosedFormCompatible(t, undefined, 16, all)).toBe(true);
    const selected = selectTopParticipantsForBracket(t, all, undefined, 16, 'salt');
    expect(resolveClosedFormBracketSeedingKind(t, selected, undefined)).toBe('exact');
  });

  it('generateBracket with qualifierCount 16 uses closed-form seeding', () => {
    const runner = new CommandRunner();
    addPlayersAndGroups4x4(runner);
    const t = runner.getTournament();
    finishAllGroupMatches(t);

    const bm = generateBracket(t.seedings, t, {
      fillByes: true,
      cullToPowerOfTwo: false,
      qualifierCount: 16,
      bracketSeedingMode: 'crop_closed_form',
      tieBreakSalt: 'cf',
    });
    const r1 = bm.filter((m) => m.round === 1 && m.seedA && m.seedB);
    expect(r1).toHaveLength(8);
  });
});

describe('doubles qualifierCount', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function setupDoublesTwoByFour() {
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
    return runner;
  }

  it('selects top pair ids for qualifier count', () => {
    const runner = setupDoublesTwoByFour();
    const t = runner.getTournament();
    finishAllGroupMatches(t);
    const pairs = trackBracketParticipants(t, undefined);
    expect(pairs).toHaveLength(8);
    const picked = selectTopParticipantsForBracket(t, pairs, undefined, 4, 'salt');
    expect(picked).toHaveLength(4);
    for (const pairId of picked) {
      expect(t.pairs![pairId]).toBeTruthy();
    }
    expect(qualifierCountClosedFormCompatible(t, undefined, 4, pairs)).toBe(true);
    expect(qualifierCountClosedFormCompatible(t, undefined, 5, pairs)).toBe(false);
  });

  it('generateBracket with top 4 pairs uses closed-form pair seeds', () => {
    const runner = setupDoublesTwoByFour();
    const t = runner.getTournament();
    finishAllGroupMatches(t);
    const pairs = trackBracketParticipants(t, undefined);
    const bm = generateBracket(pairs, t, {
      fillByes: true,
      cullToPowerOfTwo: false,
      qualifierCount: 4,
      bracketSeedingMode: 'crop_closed_form',
      tieBreakSalt: 'dp',
    });
    const r1Pairs = new Set(
      bm
        .filter((m) => m.round === 1)
        .flatMap((m) => [m.seedA, m.seedB])
        .filter((x): x is string => Boolean(x) && x !== 'BYE'),
    );
    expect(r1Pairs.size).toBe(4);
    for (const pairId of r1Pairs) {
      expect(t.pairs![pairId]).toBeTruthy();
    }
  });

  it('generateBracket with all 8 pairs uses full closed-form grid', () => {
    const runner = setupDoublesTwoByFour();
    const t = runner.getTournament();
    finishAllGroupMatches(t);
    const pairs = trackBracketParticipants(t, undefined);
    const bm = generateBracket(pairs, t, {
      fillByes: true,
      cullToPowerOfTwo: false,
      qualifierCount: 8,
      bracketSeedingMode: 'crop_closed_form',
      tieBreakSalt: 'dp8',
    });
    const r1 = bm.filter((m) => m.round === 1 && m.seedA && m.seedB);
    expect(r1).toHaveLength(4);
  });
});
