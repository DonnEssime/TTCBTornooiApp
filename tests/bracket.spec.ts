import { describe, it, expect } from 'vitest';
import {
  balancedBracketVirtualGridTarget,
  BRACKET_STRUCTURAL_EMPTY_ADVANCE,
  createTournament,
  defaultBracketSeedingMode,
  defaultBracketSeedingModeForTournament,
  defaultBracketSeedingModeFromMeta,
  supportsExtendedClosedFormBracketSeeding,
  forfeitPlayer,
  forfeitTeam,
  generateBracket,
  advanceBracketRound,
  areTopSeedsSeparated,
  bracketMatchRound,
  bracketPhaseCountsIncludingFutureRounds,
  bracketRoundAggregatesIncludingFutureRounds,
  bracketRoundHasFinishedPlayerMatch,
  compareBracketMatchId,
  compareBracketMatchIdString,
  ensureBracketPhasePlayerMatches,
  formatBracketSlotPlayerLabel,
  materializeReadyNextRoundBracketSlots,
  orderParticipantsForGroupBalancedBracket,
  resolveClosedFormBracketSeedingKind,
  splitParticipantsTopFourPerGroup,
  applyPlayInWinnersToRoundOne,
  propagateBracketSeedsFromChildWinners,
  singleEliminationPlacementRows,
  bracketMatchLoser,
  bracketPlayerMatchId,
  bracketSlotAwaitingPlay,
  bracketEffectiveWinner,
  bracketRoundHasOpenEliminationPairings,
  eliminateLowestRankedPlayersInBracketRound,
  findGroupForPlayer,
  matchPlayersResolvedForBracketPhaseList,
  settleBracketWinners,
  settleBracketWinnersIn,
  scheduleRound,
  canMutateBracketPlayerMatch,
} from '../src/model';

describe('Bracket generation', () => {
  it('orders m{n} bracket ids numerically (not lexicographically)', () => {
    const ids = ['m10', 'm2', 'm9', 'm1'];
    const sorted = [...ids].sort(compareBracketMatchIdString);
    expect(sorted).toEqual(['m1', 'm2', 'm9', 'm10']);
  });

  it('advanceBracketRound pairs winners using numeric m-order, not array order', () => {
    const t = createTournament();
    for (let i = 1; i <= 8; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const r1 = generateBracket(
      ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
      { fillByes: false, cullToPowerOfTwo: false },
    );
    for (const m of r1) {
      m.winner = m.seedA!;
    }
    t.bracketMatches = [...r1].sort((a, b) => b.id.localeCompare(a.id));
    advanceBracketRound(t);
    const m1 = r1.find((x) => x.id === 'm1');
    const m2 = r1.find((x) => x.id === 'm2');
    const r2 = t.bracketMatches.filter((x) => x.round === 2);
    expect(r2.some((x) => x.seedA === m1!.winner && x.seedB === m2!.winner)).toBe(true);
  });

  it('shuffles bracket participants deterministically when shuffleKey is set', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4'];
    const a = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false, shuffleKey: 'Spring Cup 2026' });
    const b = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false, shuffleKey: 'Spring Cup 2026' });
    expect(a.map((m) => [m.seedA, m.seedB])).toEqual(b.map((m) => [m.seedA, m.seedB]));

    const unshuffled = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });
    const shuffled = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false, shuffleKey: 'Spring Cup 2026' });
    expect(shuffled.map((m) => [m.seedA, m.seedB])).not.toEqual(unshuffled.map((m) => [m.seedA, m.seedB]));
  });

  it('generates 8-player bracket without byes (standard seeding)', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });

    expect(bracket).toHaveLength(4);
    expect(bracket.map((m) => [m.seedA, m.seedB])).toEqual([
      ['p1', 'p8'],
      ['p4', 'p5'],
      ['p2', 'p7'],
      ['p3', 'p6'],
    ]);
  });

  it('fills byes to next power of two for 6 players', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const bracket = generateBracket(seedings, { fillByes: true, cullToPowerOfTwo: false });

    expect(bracket).toHaveLength(4);
    // top seeds get byes automatically in the first-round structure
    const winners = bracket.map((m) => m.winner);
    // top seeds p1 and p2 decide byes; p1 and p2 have immediate advancement markers.
    expect(winners).toEqual(['p1', undefined, 'p2', undefined]);
    // first match is p1 vs BYE i.e. p1 advances indirectly; second is p4 vs p5 etc.
    expect(bracket[0]).toMatchObject({ seedA: 'p1', seedB: undefined });
    expect(bracket[1]).toMatchObject({ seedA: 'p4', seedB: 'p5' });
  });

  it('culls to previous power of two when requested', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: true });

    expect(bracket).toHaveLength(2);
    expect(bracket.map((m) => [m.seedA, m.seedB])).toEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
    ]);
  });

  it('culls to previous power of two using group finishing order when requested', () => {
    const tournament = createTournament();
    for (let i = 1; i <= 7; i++) {
      const id = `p${i}`;
      tournament.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    tournament.groups = {
      ga: { id: 'ga', playerIds: ['p1', 'p2', 'p3', 'p4'] },
      gb: { id: 'gb', playerIds: ['p5', 'p6', 'p7'] },
    };
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const bracket = generateBracket(seedings, tournament, {
      fillByes: false,
      cullToPowerOfTwo: true,
      cullByGroupPlacement: true,
      shuffleKey: 'Cup',
    });
    expect(bracket).toHaveLength(2);
    const ids = new Set(
      bracket.flatMap((m) => [m.seedA, m.seedB]).filter((x): x is string => Boolean(x)),
    );
    expect(ids.size).toBe(4);
    expect(ids.has('p1')).toBe(true);
    expect(ids.has('p2')).toBe(true);
    expect(ids.has('p5')).toBe(true);
    expect(ids.has('p6')).toBe(true);
    expect(ids.has('p3')).toBe(false);
    expect(ids.has('p4')).toBe(false);
    expect(ids.has('p7')).toBe(false);
  });

  it('advances bracket round after all winners are present', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });

    bracket[0].winner = 'p1';
    bracket[1].winner = 'p3';

    const tournament = { players: {}, teams: {}, matches: {}, teamMatches: {}, bracketMatches: bracket, seedings: [] } as any;
    advanceBracketRound(tournament);

    expect(tournament.bracketMatches.some((m: any) => m.round === 2)).toBe(true);
    const secondRound = tournament.bracketMatches.filter((m: any) => m.round === 2);
    expect(secondRound).toHaveLength(1);
    expect(secondRound[0]).toMatchObject({ seedA: 'p1', seedB: 'p3' });
  });

  it('places top two seeds in opposite halves', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const bracket = generateBracket(seedings, { fillByes: false, cullToPowerOfTwo: false });

    expect(areTopSeedsSeparated(bracket, 'p1', 'p2')).toBe(true);
  });

  it('resolves bracket winners from finished player matches and can assign tables', () => {
    const tournament = {
      players: {
        p1: { id: 'p1', name: 'A', handicap: 0 },
        p2: { id: 'p2', name: 'B', handicap: 0 },
      },
      teams: {},
      matches: {
        m1: {
          id: 'm1',
          playerA: 'p1',
          playerB: 'p2',
          scores: [{ playerA: 11, playerB: 5 }, { playerA: 11, playerB: 7 }],
          status: 'finished',
          winner: 'p1',
        },
      },
      teamMatches: {},
      bracketMatches: [{ id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 }],
      tableAssignments: [],
      seedings: ['p1', 'p2'],
    } as any;

    settleBracketWinners(tournament);
    expect(tournament.bracketMatches[0].winner).toBe('p1');

    scheduleRound(tournament, ['T1', 'T2'], 1);
    expect(tournament.tableAssignments).toEqual([{ tableId: 'T1', matchId: 'm1', round: 1 }]);
  });

  it('advances bracket match when a seeded player forfeits in bracket', () => {
    const tournament = createTournament();
    tournament.players['p1'] = { id: 'p1', name: 'Alice', handicap: 0 };
    tournament.players['p2'] = { id: 'p2', name: 'Bob', handicap: 0 };
    tournament.bracketMatches = [{ id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 }];

    forfeitPlayer(tournament, 'p1', 'bracket');
    settleBracketWinners(tournament);

    expect(tournament.bracketMatches[0].winner).toBe('p2');
  });

  it('forfeits a scheduled team vs team match (standalone, not bracket-seeded)', () => {
    const tournament = createTournament();
    tournament.teams['t1'] = { id: 't1', name: 'Team 1', memberIds: [] };
    tournament.teams['t2'] = { id: 't2', name: 'Team 2', memberIds: [] };
    tournament.teamMatches['tm1'] = { id: 'tm1', teamA: 't1', teamB: 't2', scores: [], status: 'scheduled' };

    forfeitTeam(tournament, 't1', 'bracket');

    expect(tournament.teamMatches['tm1'].status).toBe('forfeit');
    expect(tournament.teamMatches['tm1'].winner).toBe('t2');
  });

  it('bracketRoundHasFinishedPlayerMatch ignores group rows that reuse the same pairing as round 1', () => {
    const tournament = {
      players: {
        p1: { id: 'p1', name: 'A', handicap: 0 },
        p2: { id: 'p2', name: 'B', handicap: 0 },
      },
      teams: {},
      matches: {
        'gm-g1-p1-p2': {
          id: 'gm-g1-p1-p2',
          playerA: 'p1',
          playerB: 'p2',
          scores: [{ playerA: 11, playerB: 9 }],
          status: 'scheduled',
          groupId: 'g1',
        },
        'match-m1': {
          id: 'match-m1',
          playerA: 'p1',
          playerB: 'p2',
          scores: [],
          status: 'scheduled',
        },
      },
      teamMatches: {},
      bracketMatches: [{ id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 }],
      tableAssignments: [],
      seedings: ['p1', 'p2'],
      groups: {},
      forfeits: { players: {}, teams: {} },
      forfeitResults: { playerWins: {} },
      lockedBracketRounds: [],
      classDefinitions: [],
      playerClassFlags: {},
      classTournaments: {},
    } as any;

    expect(bracketRoundHasFinishedPlayerMatch(tournament, 1)).toBe(false);

    tournament.matches['match-m1'].scores = [{ playerA: 11, playerB: 5 }];
    expect(bracketRoundHasFinishedPlayerMatch(tournament, 1)).toBe(true);
  });

  it('settle then propagate clears stale parent seeds after a child bracket slot loses its winner', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
      p3: { id: 'p3', name: 'C', handicap: 0 },
      p4: { id: 'p4', name: 'D', handicap: 0 },
    };
    t.bracketMatches = [
      { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p3', seedB: 'p4', round: 1, winner: 'p3' },
      { id: 'm3', seedA: 'p1', seedB: 'p3', round: 2 },
    ];
    t.matches['match-m1'] = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p2',
      scores: [{ playerA: 11, playerB: 5 }],
      status: 'finished',
      winner: 'p1',
    };
    t.matches['match-m2'] = {
      id: 'match-m2',
      playerA: 'p3',
      playerB: 'p4',
      scores: [{ playerA: 11, playerB: 6 }],
      status: 'finished',
      winner: 'p3',
    };
    settleBracketWinnersIn(t, t.bracketMatches);
    propagateBracketSeedsFromChildWinners(t.bracketMatches);
    t.matches['match-m1'] = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p2',
      scores: [],
      status: 'scheduled',
    };
    delete t.matches['match-m1'].winner;
    settleBracketWinnersIn(t, t.bracketMatches);
    propagateBracketSeedsFromChildWinners(t.bracketMatches);
    const m3 = t.bracketMatches.find((x) => x.id === 'm3');
    expect(m3?.seedA).toBeUndefined();
    expect(m3?.seedB).toBe('p3');
    expect(m3?.winner).toBeUndefined();
  });

  it('settleBracketWinnersIn does not treat a one-sided round-2 slot as a bye walkover', () => {
    const t = createTournament();
    t.players = { p3: { id: 'p3', name: 'C', handicap: 0 } };
    t.bracketMatches = [{ id: 'm3', seedB: 'p3', round: 2 }];
    settleBracketWinnersIn(t, t.bracketMatches);
    expect(t.bracketMatches[0].winner).toBeUndefined();
  });

  it('ensureBracketPhasePlayerMatches adds scheduled rows for later rounds without winners', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
      p3: { id: 'p3', name: 'C', handicap: 0 },
      p4: { id: 'p4', name: 'D', handicap: 0 },
    };
    t.bracketMatches = [
      { id: 'm1', seedA: 'p1', seedB: 'p4', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p2', seedB: 'p3', round: 1, winner: 'p2' },
      { id: 'm3', seedA: 'p1', seedB: 'p2', round: 2 },
    ];
    ensureBracketPhasePlayerMatches(t);
    expect(t.matches['match-m3']).toMatchObject({
      id: 'match-m3',
      playerA: 'p1',
      playerB: 'p2',
      status: 'scheduled',
    });
    expect(t.matches['match-m1']).toBeUndefined();
  });

  it('bracketSlotAwaitingPlay is false after a decisive canonical or alias player row', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
    };
    const bm = { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 };
    t.bracketMatches = [bm];
    expect(bracketSlotAwaitingPlay(t, bm)).toBe(true);

    t.matches['match-m1'] = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p2',
      scores: [
        { playerA: 11, playerB: 0 },
        { playerA: 11, playerB: 0 },
        { playerA: 11, playerB: 0 },
      ],
      status: 'finished',
      winner: 'p1',
    };
    settleBracketWinners(t);
    expect(bracketSlotAwaitingPlay(t, bm)).toBe(false);
    expect(bracketEffectiveWinner(t, bm)).toBe('p1');

    delete t.matches['match-m1'];
    bm.winner = undefined;
    t.matches['match-alias'] = {
      id: 'match-alias',
      playerA: 'p2',
      playerB: 'p1',
      scores: [
        { playerA: 0, playerB: 11 },
        { playerA: 0, playerB: 11 },
        { playerA: 0, playerB: 11 },
      ],
      status: 'finished',
      winner: 'p1',
    };
    settleBracketWinners(t);
    expect(bracketSlotAwaitingPlay(t, bm)).toBe(false);
    expect(bracketEffectiveWinner(t, bm)).toBe('p1');
  });

  it('canMutateBracketPlayerMatch is false when the winner’s next bracket match already has scores', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
      p3: { id: 'p3', name: 'C', handicap: 0 },
      p4: { id: 'p4', name: 'D', handicap: 0 },
    };
    t.bracketMatches = [
      { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p3', seedB: 'p4', round: 1, winner: 'p3' },
      { id: 'm3', seedA: 'p1', seedB: 'p3', round: 2 },
    ];
    t.matches['match-m1'] = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p2',
      scores: [
        { playerA: 11, playerB: 0 },
        { playerA: 11, playerB: 0 },
        { playerA: 11, playerB: 0 },
      ],
      status: 'finished',
      winner: 'p1',
    };
    t.matches['match-m3'] = {
      id: 'match-m3',
      playerA: 'p1',
      playerB: 'p3',
      scores: [{ playerA: 11, playerB: 9 }],
      status: 'scheduled',
    };
    const br = t.bracketMatches;
    const locks = t.lockedBracketRounds;
    expect(canMutateBracketPlayerMatch(t, t.matches['match-m1']!, br, locks)).toBe(false);
  });

  it('canMutateBracketPlayerMatch is true when the next-round match exists but has no scores yet', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
      p3: { id: 'p3', name: 'C', handicap: 0 },
      p4: { id: 'p4', name: 'D', handicap: 0 },
    };
    t.bracketMatches = [
      { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p3', seedB: 'p4', round: 1, winner: 'p3' },
      { id: 'm3', seedA: 'p1', seedB: 'p3', round: 2 },
    ];
    t.matches['match-m1'] = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p2',
      scores: [
        { playerA: 11, playerB: 0 },
        { playerA: 11, playerB: 0 },
        { playerA: 11, playerB: 0 },
      ],
      status: 'finished',
      winner: 'p1',
    };
    t.matches['match-m3'] = {
      id: 'match-m3',
      playerA: 'p1',
      playerB: 'p3',
      scores: [],
      status: 'scheduled',
    };
    const br = t.bracketMatches;
    const locks = t.lockedBracketRounds;
    expect(canMutateBracketPlayerMatch(t, t.matches['match-m1']!, br, locks)).toBe(true);
  });

  it('settleBracketWinnersIn clears a bracket winner when the player match is no longer finished', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
    };
    t.bracketMatches = [{ id: 'm1', seedA: 'p1', seedB: 'p2', round: 1, winner: 'p1' }];
    t.matches['match-m1'] = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p2',
      scores: [],
      status: 'scheduled',
    };
    settleBracketWinnersIn(t, t.bracketMatches);
    expect(t.bracketMatches[0].winner).toBeUndefined();
  });
});

describe('Bracket progress (overview totals)', () => {
  it('includes later rounds at 0 until advanced for a 9-player bye bracket', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const bracket = generateBracket(seedings, { fillByes: true, cullToPowerOfTwo: false });
    expect(bracket).toHaveLength(8);
    const rows = bracketRoundAggregatesIncludingFutureRounds(bracket);
    expect(rows.map((r) => r.total)).toEqual([8, 4, 2, 1]);
    expect(rows.map((r) => r.done)).toEqual([7, 0, 0, 0]);
    expect(bracketPhaseCountsIncludingFutureRounds(bracket)).toEqual({ total: 15, done: 7 });
  });

  it('uses materialized matches after advance while keeping unreached final at 0%', () => {
    const bracket = generateBracket(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'], {
      fillByes: false,
      cullToPowerOfTwo: false,
    });
    for (const m of bracket) {
      m.winner = m.seedA;
    }
    const tournament = {
      players: {},
      teams: {},
      matches: {},
      teamMatches: {},
      bracketMatches: [...bracket],
      seedings: [],
    } as any;
    advanceBracketRound(tournament);
    const rows = bracketRoundAggregatesIncludingFutureRounds(tournament.bracketMatches);
    expect(rows.map((r) => [r.round, r.total, r.done])).toEqual([
      [1, 4, 4],
      [2, 2, 0],
      [3, 1, 0],
    ]);
    expect(bracketPhaseCountsIncludingFutureRounds(tournament.bracketMatches)).toEqual({ total: 7, done: 4 });
  });

  it('treats string `round` like numbers so future rounds still extrapolate (e.g. JSON import)', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const bracket = generateBracket(seedings, { fillByes: true, cullToPowerOfTwo: false });
    for (const m of bracket) {
      (m as { round: unknown }).round = String(m.round);
    }
    const rows = bracketRoundAggregatesIncludingFutureRounds(bracket);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.total)).toEqual([8, 4, 2, 1]);
  });
});

describe('Partial bracket materialization', () => {
  it('materializeReadyNextRoundBracketSlots adds round 2 when both round-1 slots are decided (4 players)', () => {
    const b = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: true, cullToPowerOfTwo: false });
    expect(b).toHaveLength(2);
    b[0]!.winner = 'p1';
    b[1]!.winner = 'p2';
    expect(materializeReadyNextRoundBracketSlots(b)).toBe(true);
    expect(b.some((m) => bracketMatchRound(m) === 2)).toBe(true);
  });

  it('adds round-2 slots for decided feeder pairs while one round-1 match is still open (9 players, byes)', () => {
    const seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const b = generateBracket(seedings, { fillByes: true, cullToPowerOfTwo: false });
    expect(b).toHaveLength(8);
    const pending = b.find((x) => !x.winner);
    expect(pending?.seedA).toBeTruthy();
    expect(pending?.seedB).toBeTruthy();

    expect(materializeReadyNextRoundBracketSlots(b)).toBe(true);
    const r2a = b.filter((m) => bracketMatchRound(m) === 2);
    expect(r2a).toHaveLength(3);
    for (const m of r2a) {
      expect(m.seedA).toBeTruthy();
      expect(m.seedB).toBeTruthy();
    }

    pending!.winner = pending!.seedA;
    expect(materializeReadyNextRoundBracketSlots(b)).toBe(true);
    expect(b.filter((m) => bracketMatchRound(m) === 2)).toHaveLength(4);
  });

  it('materializes next round when a round-1 slot is double-bye (structural empty advance)', () => {
    const t = createTournament();
    t.players.p1 = { id: 'p1', name: 'A', handicap: 0 };
    t.players.p2 = { id: 'p2', name: 'B', handicap: 0 };
    const mid = bracketPlayerMatchId('m2');
    t.matches[mid] = {
      id: mid,
      playerA: 'p1',
      playerB: 'p2',
      scores: [{ playerA: 11, playerB: 5 }],
      status: 'finished',
      winner: 'p1',
    };
    const b = [
      { id: 'm1', round: 1, winner: BRACKET_STRUCTURAL_EMPTY_ADVANCE },
      { id: 'm2', round: 1, seedA: 'p1', seedB: 'p2', winner: 'p1' },
    ];
    settleBracketWinnersIn(t, b);
    expect(b[0]!.winner).toBe(BRACKET_STRUCTURAL_EMPTY_ADVANCE);
    expect(b[1]!.winner).toBe('p1');
    expect(materializeReadyNextRoundBracketSlots(b)).toBe(true);
    const r2 = b.filter((m) => bracketMatchRound(m) === 2).sort(compareBracketMatchId);
    expect(r2).toHaveLength(1);
    expect(r2[0]).toMatchObject({ seedA: undefined, seedB: 'p1', winner: undefined });
    settleBracketWinnersIn(t, b);
    expect(r2[0]!.winner).toBe('p1');
  });

  it('generateBracket marks all-bye pairings with structural advance so they can chain', () => {
    const b = generateBracket(['BYE', 'BYE', 'BYE', 'BYE'], { fillByes: true, cullToPowerOfTwo: false });
    expect(b).toHaveLength(2);
    expect(b[0]!.winner).toBe(BRACKET_STRUCTURAL_EMPTY_ADVANCE);
    expect(b[1]!.winner).toBe(BRACKET_STRUCTURAL_EMPTY_ADVANCE);
    const t = createTournament();
    settleBracketWinnersIn(t, b);
    expect(materializeReadyNextRoundBracketSlots(b)).toBe(true);
    const r2 = b.filter((m) => bracketMatchRound(m) === 2).sort(compareBracketMatchId);
    expect(r2).toHaveLength(1);
    settleBracketWinnersIn(t, b);
    expect(r2[0]!.winner).toBe(BRACKET_STRUCTURAL_EMPTY_ADVANCE);
  });
});

describe('Group-balanced bracket seeding', () => {
  it('virtual grid target: pads to smallest supported G′×4', () => {
    expect(balancedBracketVirtualGridTarget(3, 3)).toEqual({ G_tgt: 4, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(6, 4)).toEqual({ G_tgt: 8, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(3, 4)).toEqual({ G_tgt: 4, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(2, 2)).toEqual({ G_tgt: 2, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(9, 4)).toEqual({ G_tgt: 16, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(10, 4)).toEqual({ G_tgt: 16, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(16, 4)).toEqual({ G_tgt: 16, S_tgt: 4 });
    expect(balancedBracketVirtualGridTarget(17, 4)).toBeNull();
    expect(balancedBracketVirtualGridTarget(4, 5)).toBeNull();
  });

  function addGroupRR3(t: ReturnType<typeof createTournament>, gid: string, pids: [string, string, string]): void {
    const [a, b, c] = pids;
    t.groups[gid] = { id: gid, playerIds: [...pids] };
    const add = (pa: string, pb: string, w: string) => {
      const id = `m-${gid}-${pa}-${pb}`;
      t.matches[id] = {
        id,
        playerA: pa,
        playerB: pb,
        scores: [],
        status: 'finished',
        winner: w,
        groupId: gid,
      };
    };
    add(a, b, a);
    add(a, c, a);
    add(b, c, b);
  }

  function addGroupRR4(t: ReturnType<typeof createTournament>, gid: string, pids: [string, string, string, string]): void {
    const [a, b, c, d] = pids;
    t.groups[gid] = { id: gid, playerIds: [...pids] };
    const add = (pa: string, pb: string, w: string) => {
      const id = `m-${gid}-${pa}-${pb}`;
      t.matches[id] = {
        id,
        playerA: pa,
        playerB: pb,
        scores: [],
        status: 'finished',
        winner: w,
        groupId: gid,
      };
    };
    add(a, b, a);
    add(a, c, a);
    add(a, d, a);
    add(b, c, b);
    add(b, d, b);
    add(c, d, c);
  }

  it('4×4: orders round-1 pairings to separate group winners and cross-group strength', () => {
    const t = createTournament();
    for (let i = 1; i <= 16; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    addGroupRR4(t, 'ga', ['p1', 'p2', 'p3', 'p4']);
    addGroupRR4(t, 'gb', ['p5', 'p6', 'p7', 'p8']);
    addGroupRR4(t, 'gc', ['p9', 'p10', 'p11', 'p12']);
    addGroupRR4(t, 'gd', ['p13', 'p14', 'p15', 'p16']);
    t.seedings = Array.from({ length: 16 }, (_, i) => `p${i + 1}`);
    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored-when-balanced',
      bracketSeedingMode: 'extend_closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    const pair = (i: number) => new Set([r1[i]!.seedA, r1[i]!.seedB]);

    expect(pair(0)).toEqual(new Set(['p1', 'p16']));
    expect(pair(1)).toEqual(new Set(['p6', 'p11']));
    expect(pair(2)).toEqual(new Set(['p9', 'p4']));
    expect(pair(3)).toEqual(new Set(['p14', 'p7']));
    expect(pair(4)).toEqual(new Set(['p13', 'p8']));
    expect(pair(5)).toEqual(new Set(['p10', 'p3']));
    expect(pair(6)).toEqual(new Set(['p5', 'p12']));
    expect(pair(7)).toEqual(new Set(['p2', 'p15']));
  });

  it('extend_closed_form when 11 players in 4 uneven groups (max size 3)', () => {
    const t = createTournament();
    for (let i = 1; i <= 11; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    addGroupRR3(t, 'ga', ['p1', 'p2', 'p3']);
    addGroupRR3(t, 'gb', ['p4', 'p5', 'p6']);
    addGroupRR3(t, 'gc', ['p7', 'p8', 'p9']);
    t.groups['gd'] = { id: 'gd', playerIds: ['p10', 'p11'] };
    t.matches['m-gd-p10-p11'] = {
      id: 'm-gd-p10-p11',
      playerA: 'p10',
      playerB: 'p11',
      scores: [],
      status: 'finished',
      winner: 'p10',
      groupId: 'gd',
    };
    t.seedings = Array.from({ length: 11 }, (_, i) => `p${i + 1}`);

    expect(resolveClosedFormBracketSeedingKind(t, t.seedings, undefined)).toBeNull();
    expect(supportsExtendedClosedFormBracketSeeding(t, t.seedings, undefined)).toBe(true);
    expect(defaultBracketSeedingModeForTournament(t, t.seedings, undefined)).toBe('extend_closed_form');

    const ordered = orderParticipantsForGroupBalancedBracket(t, t.seedings, undefined, 'virtual');
    expect(ordered).not.toBeNull();
    expect(ordered!.length).toBe(16);
    expect(ordered!.some((pid) => pid === 'BYE')).toBe(true);

    const bracket = generateBracket([...t.seedings], t, {
      fillByes: true,
      shuffleKey: 'ignored',
      bracketSeedingMode: 'extend_closed_form',
    });
    expect(bracket.filter((m) => bracketMatchRound(m) === 1)).toHaveLength(8);
  });

  it('2×4: cross-group R1 with group winners in opposite halves', () => {
    const t = createTournament();
    for (let i = 1; i <= 8; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    addGroupRR4(t, 'ga', ['p1', 'p2', 'p3', 'p4']);
    addGroupRR4(t, 'gb', ['p5', 'p6', 'p7', 'p8']);
    t.seedings = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
    expect(orderParticipantsForGroupBalancedBracket(t, t.seedings, undefined)).toEqual([
      'p1',
      'p5',
      'p7',
      'p3',
      'p6',
      'p2',
      'p4',
      'p8',
    ]);
    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored-when-balanced',
      bracketSeedingMode: 'extend_closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    const pair = (i: number) => new Set([r1[i]!.seedA, r1[i]!.seedB]);
    // Half 1: G1P1–G2P4, G1P3–G2P2
    expect(pair(0)).toEqual(new Set(['p1', 'p8']));
    expect(pair(1)).toEqual(new Set(['p3', 'p6']));
    // Half 2: G2P1–G1P4, G2P3–G1P2
    expect(pair(2)).toEqual(new Set(['p5', 'p4']));
    expect(pair(3)).toEqual(new Set(['p7', 'p2']));
    expect(areTopSeedsSeparated(bracket, 'p1', 'p2')).toBe(true);
    expect(areTopSeedsSeparated(bracket, 'p1', 'p5')).toBe(true);
    for (const m of r1) {
      const ga = findGroupForPlayer(t, m.seedA!, undefined)!.id;
      const gb = findGroupForPlayer(t, m.seedB!, undefined)!.id;
      expect(ga).not.toBe(gb);
    }
  });

  function addGroupRR5(t: ReturnType<typeof createTournament>, gid: string, pids: [string, string, string, string, string]): void {
    const [a, b, c, d, e] = pids;
    t.groups[gid] = { id: gid, playerIds: [...pids] };
    const add = (pa: string, pb: string, w: string) => {
      const id = `m-${gid}-${pa}-${pb}`;
      t.matches[id] = {
        id,
        playerA: pa,
        playerB: pb,
        scores: [],
        status: 'finished',
        winner: w,
        groupId: gid,
      };
    };
    add(a, b, a);
    add(a, c, a);
    add(a, d, a);
    add(a, e, a);
    add(b, c, b);
    add(b, d, b);
    add(b, e, b);
    add(c, d, c);
    add(c, e, c);
    add(d, e, d);
  }

  it('closed_form with crop: top four per group in main draw, fifth places via cross-group play-in', () => {
    const t = createTournament();
    for (let i = 1; i <= 20; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    addGroupRR5(t, 'ga', ['p1', 'p2', 'p3', 'p4', 'p5']);
    addGroupRR5(t, 'gb', ['p6', 'p7', 'p8', 'p9', 'p10']);
    addGroupRR5(t, 'gc', ['p11', 'p12', 'p13', 'p14', 'p15']);
    addGroupRR5(t, 'gd', ['p16', 'p17', 'p18', 'p19', 'p20']);
    t.seedings = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
    expect(resolveClosedFormBracketSeedingKind(t, t.seedings, undefined)).toBe('crop');
    const split = splitParticipantsTopFourPerGroup(t, t.seedings, undefined);
    expect(split?.qualified.sort()).toEqual(
      ['p1', 'p2', 'p3', 'p4', 'p6', 'p7', 'p8', 'p9', 'p11', 'p12', 'p13', 'p14', 'p16', 'p17', 'p18', 'p19'].sort(),
    );
    expect(new Set(split?.culled)).toEqual(new Set(['p5', 'p10', 'p15', 'p20']));

    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored',
      bracketSeedingMode: 'closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    const r2 = bracket.filter((m) => bracketMatchRound(m) === 2).sort(compareBracketMatchId);
    const crosses = r1.filter((m) => m.seedA && m.seedB && !m.playInFor);
    expect(crosses).toHaveLength(4);
    expect(r2).toHaveLength(8);

    for (const m of crosses) {
      const ga = findGroupForPlayer(t, m.seedA!, undefined)!.id;
      const gb = findGroupForPlayer(t, m.seedB!, undefined)!.id;
      expect(ga).not.toBe(gb);
    }

    const byeWalks = r1.filter((m) => m.winner && !m.seedB);
    expect(byeWalks.length).toBeGreaterThanOrEqual(4);

    crosses[0]!.winner = crosses[0]!.seedA;
    applyPlayInWinnersToRoundOne(bracket);
    propagateBracketSeedsFromChildWinners(bracket);
    const host0 = r2.find((x) => x.seedA === crosses[0]!.winner || x.seedB === crosses[0]!.winner);
    expect(host0).toBeDefined();
  });

  function addGroupRRn(t: ReturnType<typeof createTournament>, gid: string, pids: string[]): void {
    t.groups[gid] = { id: gid, playerIds: [...pids] };
    for (let a = 0; a < pids.length; a++) {
      for (let b = a + 1; b < pids.length; b++) {
        const pa = pids[a]!;
        const pb = pids[b]!;
        const id = `m-${gid}-${pa}-${pb}`;
        t.matches[id] = {
          id,
          playerA: pa,
          playerB: pb,
          scores: [],
          status: 'finished',
          winner: pa,
          groupId: gid,
        };
      }
    }
  }

  it('closed_form crop with 11 players in 2 groups (6+5): intra-group play-in, all 11 in bracket', () => {
    const t = createTournament();
    for (let i = 1; i <= 11; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    addGroupRRn(t, 'ga', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    addGroupRRn(t, 'gb', ['p7', 'p8', 'p9', 'p10', 'p11']);
    t.seedings = Array.from({ length: 11 }, (_, i) => `p${i + 1}`);
    expect(resolveClosedFormBracketSeedingKind(t, t.seedings, undefined)).toBe('crop');

    const bracket = generateBracket([...t.seedings], t, {
      fillByes: true,
      bracketSeedingMode: 'closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1);
    const r2 = bracket.filter((m) => bracketMatchRound(m) === 2);
    expect(r1.length).toBeGreaterThanOrEqual(7);
    expect(r2).toHaveLength(4);

    const allPids = new Set<string>();
    for (const m of r1) {
      if (m.seedA) allPids.add(m.seedA);
      if (m.seedB) allPids.add(m.seedB);
    }
    expect(allPids.size).toBe(11);

    const intra = r1.find((m) => {
      const pair = new Set([m.seedA, m.seedB]);
      return pair.has('p5') && pair.has('p6');
    });
    expect(intra).toBeDefined();
    expect(intra!.playInFor).toBeDefined();
    expect(intra!.playInFor!.side).toBe('a');

    const byeWalks = r1.filter((m) => m.winner && !m.seedB);
    expect(byeWalks.length).toBeGreaterThanOrEqual(2);
  });

  it('closed_form crop when 21 players are split across 4 groups (uneven sizes)', () => {
    const t = createTournament();
    for (let i = 1; i <= 21; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const sizes = [6, 5, 5, 5];
    const gids = ['ga', 'gb', 'gc', 'gd'];
    let pid = 1;
    for (let gi = 0; gi < 4; gi++) {
      const n = sizes[gi]!;
      const pids: string[] = [];
      for (let j = 0; j < n; j++) pids.push(`p${pid++}`);
      t.groups[gids[gi]!] = { id: gids[gi]!, playerIds: pids };
      for (let a = 0; a < pids.length; a++) {
        for (let b = a + 1; b < pids.length; b++) {
          const pa = pids[a]!;
          const pb = pids[b]!;
          const id = `m-${gids[gi]}-${pa}-${pb}`;
          t.matches[id] = {
            id,
            playerA: pa,
            playerB: pb,
            scores: [],
            status: 'finished',
            winner: pa,
            groupId: gids[gi],
          };
        }
      }
    }
    t.seedings = Array.from({ length: 21 }, (_, i) => `p${i + 1}`);
    expect(resolveClosedFormBracketSeedingKind(t, t.seedings, undefined)).toBe('crop');
    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      bracketSeedingMode: 'closed_form',
    });
    expect(bracket.filter((m) => bracketMatchRound(m) === 1 && m.playInFor).length).toBeGreaterThanOrEqual(1);
    expect(bracket.filter((m) => bracketMatchRound(m) === 2).length).toBe(8);
  });

  it('16×4: stacks four 4×4-style quarters on groups 0–3, 4–7, 8–11, and 12–15', () => {
    const t = createTournament();
    for (let i = 1; i <= 64; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const gids = Array.from({ length: 16 }, (_, i) => `g${i}`);
    for (let gi = 0; gi < 16; gi++) {
      const base = gi * 4;
      addGroupRR4(t, gids[gi]!, [
        `p${base + 1}`,
        `p${base + 2}`,
        `p${base + 3}`,
        `p${base + 4}`,
      ] as [string, string, string, string]);
    }
    t.seedings = Array.from({ length: 64 }, (_, i) => `p${i + 1}`);
    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored-when-balanced',
      bracketSeedingMode: 'extend_closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    const pair = (i: number) => new Set([r1[i]!.seedA, r1[i]!.seedB]);
    expect(pair(0)).toEqual(new Set(['p1', 'p40']));
    expect(pair(1)).toEqual(new Set(['p48', 'p25']));
    expect(pair(2)).toEqual(new Set(['p64', 'p9']));
    expect(pair(3)).toEqual(new Set(['p49', 'p24']));
    expect(pair(4)).toEqual(new Set(['p6', 'p35']));
    expect(pair(5)).toEqual(new Set(['p43', 'p30']));
    expect(pair(6)).toEqual(new Set(['p59', 'p14']));
    expect(pair(7)).toEqual(new Set(['p54', 'p19']));
    expect(pair(8)).toEqual(new Set(['p41', 'p28']));
    expect(pair(9)).toEqual(new Set(['p4', 'p33']));
    expect(pair(10)).toEqual(new Set(['p52', 'p17']));
    expect(pair(11)).toEqual(new Set(['p57', 'p12']));
    expect(pair(12)).toEqual(new Set(['p46', 'p31']));
    expect(pair(13)).toEqual(new Set(['p7', 'p38']));
    expect(pair(14)).toEqual(new Set(['p55', 'p22']));
    expect(pair(15)).toEqual(new Set(['p62', 'p15']));
    expect(pair(16)).toEqual(new Set(['p45', 'p32']));
    expect(pair(17)).toEqual(new Set(['p8', 'p37']));
    expect(pair(18)).toEqual(new Set(['p56', 'p21']));
    expect(pair(19)).toEqual(new Set(['p61', 'p16']));
    expect(pair(20)).toEqual(new Set(['p42', 'p27']));
    expect(pair(21)).toEqual(new Set(['p3', 'p34']));
    expect(pair(22)).toEqual(new Set(['p51', 'p18']));
    expect(pair(23)).toEqual(new Set(['p58', 'p11']));
    expect(pair(24)).toEqual(new Set(['p5', 'p36']));
    expect(pair(25)).toEqual(new Set(['p44', 'p29']));
    expect(pair(26)).toEqual(new Set(['p60', 'p13']));
    expect(pair(27)).toEqual(new Set(['p53', 'p20']));
    expect(pair(28)).toEqual(new Set(['p2', 'p39']));
    expect(pair(29)).toEqual(new Set(['p47', 'p26']));
    expect(pair(30)).toEqual(new Set(['p63', 'p10']));
    expect(pair(31)).toEqual(new Set(['p50', 'p23']));
    for (const m of r1) {
      const ga = findGroupForPlayer(t, m.seedA!, undefined)?.id;
      const gb = findGroupForPlayer(t, m.seedB!, undefined)?.id;
      expect(ga).toBeDefined();
      expect(gb).toBeDefined();
      expect(ga).not.toBe(gb);
    }
  });

  it('8×4: stacks two 4×4-style halves on groups 0–3 and 4–7', () => {
    const t = createTournament();
    for (let i = 1; i <= 32; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const gids = ['ga', 'gb', 'gc', 'gd', 'ge', 'gf', 'gg', 'gh'];
    for (let gi = 0; gi < 8; gi++) {
      const base = gi * 4;
      addGroupRR4(t, gids[gi]!, [
        `p${base + 1}`,
        `p${base + 2}`,
        `p${base + 3}`,
        `p${base + 4}`,
      ] as [string, string, string, string]);
    }
    t.seedings = Array.from({ length: 32 }, (_, i) => `p${i + 1}`);
    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored-when-balanced',
      bracketSeedingMode: 'extend_closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    const pair = (i: number) => new Set([r1[i]!.seedA, r1[i]!.seedB]);
    expect(pair(0)).toEqual(new Set(['p1', 'p32']));
    expect(pair(1)).toEqual(new Set(['p6', 'p27']));
    expect(pair(2)).toEqual(new Set(['p16', 'p17']));
    expect(pair(3)).toEqual(new Set(['p11', 'p22']));
    expect(pair(4)).toEqual(new Set(['p9', 'p20']));
    expect(pair(5)).toEqual(new Set(['p14', 'p23']));
    expect(pair(6)).toEqual(new Set(['p4', 'p25']));
    expect(pair(7)).toEqual(new Set(['p7', 'p30']));
    expect(pair(8)).toEqual(new Set(['p13', 'p24']));
    expect(pair(9)).toEqual(new Set(['p10', 'p19']));
    expect(pair(10)).toEqual(new Set(['p8', 'p29']));
    expect(pair(11)).toEqual(new Set(['p3', 'p26']));
    expect(pair(12)).toEqual(new Set(['p5', 'p28']));
    expect(pair(13)).toEqual(new Set(['p2', 'p31']));
    expect(pair(14)).toEqual(new Set(['p12', 'p21']));
    expect(pair(15)).toEqual(new Set(['p15', 'p18']));
  });

  it('3×3: pads to virtual 4×4 (one dummy row per group + one dummy group) and keeps balanced ordering', () => {
    const t = createTournament();
    for (let i = 1; i <= 9; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    addGroupRR3(t, 'ga', ['p1', 'p2', 'p3']);
    addGroupRR3(t, 'gb', ['p4', 'p5', 'p6']);
    addGroupRR3(t, 'gc', ['p7', 'p8', 'p9']);
    t.seedings = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    const ordered = orderParticipantsForGroupBalancedBracket(t, [...t.seedings], undefined);
    expect(ordered).not.toBeNull();
    expect(ordered).toHaveLength(16);
    const byeCount = ordered!.filter((x) => x === 'BYE').length;
    expect(byeCount).toBe(7);
    expect(new Set(ordered!.filter((x) => x !== 'BYE'))).toEqual(new Set(t.seedings));

    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored-when-balanced',
      bracketSeedingMode: 'extend_closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    expect(r1.filter((m) => !m.seedA && !m.seedB).length).toBeLessThanOrEqual(1);
  });

  it('6×4: pads with two full dummy groups to virtual 8×4 (not shuffle)', () => {
    const t = createTournament();
    for (let i = 1; i <= 24; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const gids = ['ga', 'gb', 'gc', 'gd', 'ge', 'gf'];
    for (let gi = 0; gi < 6; gi++) {
      const base = gi * 4;
      addGroupRR4(t, gids[gi]!, [
        `p${base + 1}`,
        `p${base + 2}`,
        `p${base + 3}`,
        `p${base + 4}`,
      ] as [string, string, string, string]);
    }
    t.seedings = Array.from({ length: 24 }, (_, i) => `p${i + 1}`);
    const ordered = orderParticipantsForGroupBalancedBracket(t, [...t.seedings], undefined);
    expect(ordered).not.toBeNull();
    expect(ordered).toHaveLength(32);
    expect(ordered!.filter((x) => x === 'BYE')).toHaveLength(8);

    const bracket = generateBracket([...t.seedings], t, {
      fillByes: false,
      shuffleKey: 'ignored-when-balanced',
      bracketSeedingMode: 'extend_closed_form',
    });
    const r1 = bracket.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
    for (const m of r1) {
      expect(m.seedA !== undefined || m.seedB !== undefined).toBe(true);
    }
  });
});

describe('Single-elimination placement order', () => {
  it('returns null without a decided final', () => {
    expect(singleEliminationPlacementRows([])).toBeNull();
    expect(
      singleEliminationPlacementRows([
        { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 },
        { id: 'm2', seedA: 'p1', seedB: 'p2', round: 2 },
      ]),
    ).toBeNull();
  });

  it('orders four players 1–4 from final back to semis', () => {
    const bm = [
      { id: 'm1', seedA: 'p1', seedB: 'p4', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p2', seedB: 'p3', round: 1, winner: 'p2' },
      { id: 'm3', seedA: 'p1', seedB: 'p2', round: 2, winner: 'p1' },
    ];
    const rows = singleEliminationPlacementRows(bm)!;
    expect(rows.map((r) => [r.place, r.playerId])).toEqual([
      [1, 'p1'],
      [2, 'p2'],
      [3, 'p4'],
      [4, 'p3'],
    ]);
  });

  it('returns placements when duplicate rows exist at the final round (materialize + advance)', () => {
    const bm = [
      { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p3', seedB: 'p4', round: 1, winner: 'p3' },
      { id: 'm3', seedA: 'p1', seedB: 'p3', round: 2, winner: 'p1' },
      { id: 'm4', seedA: 'p1', seedB: 'p3', round: 3, winner: 'p1' },
      { id: 'm5', seedA: 'p1', seedB: 'p3', round: 3, winner: 'p1' },
    ];
    const rows = singleEliminationPlacementRows(bm)!;
    expect(rows?.map((r) => [r.place, r.playerId])).toEqual([
      [1, 'p1'],
      [2, 'p3'],
      [3, 'p2'],
      [4, 'p4'],
    ]);
  });

  it('orders eight players so quarter losers map to places 5–8 by opponent rank', () => {
    const bm = [
      { id: 'm1', seedA: 'p1', seedB: 'p8', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p2', seedB: 'p7', round: 1, winner: 'p2' },
      { id: 'm3', seedA: 'p3', seedB: 'p6', round: 1, winner: 'p3' },
      { id: 'm4', seedA: 'p4', seedB: 'p5', round: 1, winner: 'p4' },
      { id: 'm5', seedA: 'p1', seedB: 'p2', round: 2, winner: 'p1' },
      { id: 'm6', seedA: 'p3', seedB: 'p4', round: 2, winner: 'p3' },
      { id: 'm7', seedA: 'p1', seedB: 'p3', round: 3, winner: 'p1' },
    ];
    const rows = singleEliminationPlacementRows(bm)!;
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r.place]));
    expect(byId['p1']).toBe(1);
    expect(byId['p3']).toBe(2);
    expect(byId['p2']).toBe(3);
    expect(byId['p4']).toBe(4);
    expect(byId['p8']).toBe(5);
    expect(byId['p6']).toBe(6);
    expect(byId['p7']).toBe(7);
    expect(byId['p5']).toBe(8);
  });

  it('bracketMatchLoser returns the non-winner when both seeds exist', () => {
    expect(bracketMatchLoser({ id: 'm', seedA: 'a', seedB: 'b', round: 1, winner: 'a' })).toBe('b');
  });
});

describe('Group → bracket placeholders', () => {
  it('formatBracketSlotPlayerLabel uses group place until the group is fully finished', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'Alice', handicap: 0 },
      p2: { id: 'p2', name: 'Bob', handicap: 0 },
    };
    t.groups = { '1': { id: '1', label: 'group 1', playerIds: ['p1', 'p2'] } };
    t.matches = {
      'gm-1-p1-p2': {
        id: 'gm-1-p1-p2',
        playerA: 'p1',
        playerB: 'p2',
        scores: [],
        status: 'scheduled',
        groupId: '1',
      },
    };
    expect(formatBracketSlotPlayerLabel(t, 'p1', undefined)).toBe('Group 1 place 1');
    expect(formatBracketSlotPlayerLabel(t, 'p2', undefined)).toBe('Group 1 place 2');
    t.matches['gm-1-p1-p2']!.status = 'finished';
    t.matches['gm-1-p1-p2']!.scores = [
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 5 },
      { playerA: 11, playerB: 4 },
    ];
    t.matches['gm-1-p1-p2']!.winner = 'p1';
    expect(formatBracketSlotPlayerLabel(t, 'p1', undefined)).toBe('Alice');
    expect(formatBracketSlotPlayerLabel(t, 'p2', undefined)).toBe('Bob');
  });

  it('matchPlayersResolvedForBracketPhaseList is false until both entrants groups are finished', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
      p3: { id: 'p3', name: 'C', handicap: 0 },
      p4: { id: 'p4', name: 'D', handicap: 0 },
    };
    t.groups = {
      g1: { id: 'g1', label: 'Alpha', playerIds: ['p1', 'p2'] },
      g2: { id: 'g2', label: 'Beta', playerIds: ['p3', 'p4'] },
    };
    t.matches = {
      'gm-g1-p1-p2': {
        id: 'gm-g1-p1-p2',
        playerA: 'p1',
        playerB: 'p2',
        scores: [],
        status: 'scheduled',
        groupId: 'g1',
      },
      'gm-g2-p3-p4': {
        id: 'gm-g2-p3-p4',
        playerA: 'p3',
        playerB: 'p4',
        scores: [],
        status: 'scheduled',
        groupId: 'g2',
      },
    };
    const bracketMatch: Match = {
      id: 'match-m1',
      playerA: 'p1',
      playerB: 'p3',
      scores: [],
      status: 'scheduled',
    };
    expect(matchPlayersResolvedForBracketPhaseList(t, bracketMatch, undefined)).toBe(false);
    t.matches['gm-g1-p1-p2']!.status = 'finished';
    t.matches['gm-g1-p1-p2']!.scores = [
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
    ];
    t.matches['gm-g1-p1-p2']!.winner = 'p1';
    expect(matchPlayersResolvedForBracketPhaseList(t, bracketMatch, undefined)).toBe(false);
    t.matches['gm-g2-p3-p4']!.status = 'finished';
    t.matches['gm-g2-p3-p4']!.scores = [
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
    ];
    t.matches['gm-g2-p3-p4']!.winner = 'p3';
    expect(matchPlayersResolvedForBracketPhaseList(t, bracketMatch, undefined)).toBe(true);
  });

  it('class-scoped groups use classId when resolving placeholders', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'Ann', handicap: 0 },
      p2: { id: 'p2', name: 'Ben', handicap: 0 },
    };
    t.classDefinitions = [{ id: 'jun', name: 'Junior' }];
    t.classTournaments = {
      jun: {
        seedings: ['p1', 'p2'],
        groups: { '1': { id: '1', label: 'Pool A', playerIds: ['p1', 'p2'] } },
        bracketMatches: [],
        lockedBracketRounds: [],
      },
    };
    t.matches = {
      'gm-jun-1-p1-p2': {
        id: 'gm-jun-1-p1-p2',
        playerA: 'p1',
        playerB: 'p2',
        scores: [],
        status: 'scheduled',
        groupId: '1',
        classId: 'jun',
      },
    };
    expect(formatBracketSlotPlayerLabel(t, 'p1', 'jun')).toBe('Pool A place 1');
    expect(formatBracketSlotPlayerLabel(t, 'p1', undefined)).toBe('Ann');
  });
});

describe('bracketRoundHasOpenEliminationPairings', () => {
  function finishGroupRR4(
    t: ReturnType<typeof createTournament>,
    gid: string,
    pids: [string, string, string, string],
  ): void {
    const [a, b, c, d] = pids;
    t.groups[gid] = { id: gid, playerIds: [...pids] };
    const add = (pa: string, pb: string, w: string) => {
      const id = `m-${gid}-${pa}-${pb}`;
      t.matches[id] = {
        id,
        playerA: pa,
        playerB: pb,
        scores: [],
        status: 'finished',
        winner: w,
        groupId: gid,
      };
    };
    add(a, b, a);
    add(a, c, a);
    add(a, d, a);
    add(b, c, b);
    add(b, d, b);
    add(c, d, c);
  }

  it('is false when every two-player slot in the round already has a decisive outcome', () => {
    const t = createTournament();
    for (let i = 1; i <= 4; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    finishGroupRR4(t, 'g1', ['p1', 'p2', 'p3', 'p4']);
    t.bracketMatches = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    for (const bm of t.bracketMatches.filter((m) => bracketMatchRound(m) === 1)) {
      const mid = bracketPlayerMatchId(bm.id);
      t.matches[mid] = {
        id: mid,
        playerA: bm.seedA!,
        playerB: bm.seedB!,
        scores: [
          { playerA: 11, playerB: 0 },
          { playerA: 11, playerB: 0 },
          { playerA: 11, playerB: 0 },
        ],
        status: 'finished',
        winner: bm.seedA!,
      };
      bm.winner = bm.seedA!;
    }
    expect(bracketRoundHasOpenEliminationPairings(t, t.bracketMatches, 1)).toBe(false);
    expect(eliminateLowestRankedPlayersInBracketRound(t, 1, undefined, 'salt')).toMatch(/No open pairings/);
  });

  it('is true while at least one open two-player slot lacks a played outcome', () => {
    const t = createTournament();
    for (let i = 1; i <= 4; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    finishGroupRR4(t, 'g1', ['p1', 'p2', 'p3', 'p4']);
    t.bracketMatches = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    expect(bracketRoundHasOpenEliminationPairings(t, t.bracketMatches, 1)).toBe(true);
  });
});

describe('defaultBracketSeedingMode', () => {
  it('prefers closed_form on exact 2×4 / 4×4 / 8×4 / 16×4 grids', () => {
    expect(defaultBracketSeedingMode(2, 4)).toBe('closed_form');
    expect(defaultBracketSeedingMode(4, 4)).toBe('closed_form');
    expect(defaultBracketSeedingMode(8, 4)).toBe('closed_form');
    expect(defaultBracketSeedingMode(16, 4)).toBe('closed_form');
  });

  it('prefers extend_closed_form when only padding places within existing groups', () => {
    expect(defaultBracketSeedingMode(2, 3)).toBe('extend_closed_form');
    expect(defaultBracketSeedingMode(4, 3)).toBe('extend_closed_form');
  });

  it('prefers heuristic when virtual layout would add dummy groups', () => {
    expect(defaultBracketSeedingMode(3, 4)).toBe('heuristic');
    expect(defaultBracketSeedingMode(5, 4)).toBe('heuristic');
  });

  it('returns heuristic when meta is null', () => {
    expect(defaultBracketSeedingModeFromMeta(null)).toBe('heuristic');
  });
});
