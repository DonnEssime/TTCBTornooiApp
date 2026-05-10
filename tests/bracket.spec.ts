import { describe, it, expect } from 'vitest';
import {
  createTournament,
  forfeitPlayer,
  forfeitTeam,
  generateBracket,
  advanceBracketRound,
  areTopSeedsSeparated,
  bracketRoundHasFinishedPlayerMatch,
  compareBracketMatchIdString,
  ensureBracketPhasePlayerMatches,
  formatBracketSlotPlayerLabel,
  matchPlayersResolvedForBracketPhaseList,
  settleBracketWinners,
  scheduleRound,
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
    expect(formatBracketSlotPlayerLabel(t, 'p1', undefined)).toBe('group 1 place 1');
    expect(formatBracketSlotPlayerLabel(t, 'p2', undefined)).toBe('group 1 place 2');
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
