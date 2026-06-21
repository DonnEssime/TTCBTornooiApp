import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  bracketMatchRound,
  bracketPlayerMatchId,
  bracketSlotAwaitingPlay,
  createTournament,
  matchWinner,
  type GameScore,
  type Match,
  type Tournament,
} from '../src/model';
import { competitionTrackFunStats, funStatAwardsForDisplay, type FunStatAward, type FunStatKey } from '../src/tournament-fun-stats';

function seedPlayer(t: Tournament, id: string): void {
  t.players[id] = { id, name: id.toUpperCase(), handicap: 0 };
}

function sweepA(): GameScore[] {
  return [
    { playerA: 11, playerB: 3 },
    { playerA: 11, playerB: 3 },
    { playerA: 11, playerB: 3 },
  ];
}

function belleA(): GameScore[] {
  return [
    { playerA: 11, playerB: 9 },
    { playerA: 9, playerB: 11 },
    { playerA: 11, playerB: 9 },
    { playerA: 9, playerB: 11 },
    { playerA: 11, playerB: 8 },
  ];
}

function addGroupMatch(
  t: Tournament,
  id: string,
  playerA: string,
  playerB: string,
  scores: GameScore[],
): void {
  t.matches[id] = {
    id,
    playerA,
    playerB,
    scores,
    status: 'finished',
    winner: matchWinner(scores) === 'A' ? playerA : playerB,
    groupId: '1',
  };
}

function addBracketMatch(
  t: Tournament,
  slotId: string,
  playerA: string,
  playerB: string,
  scores: GameScore[],
  round: number,
): void {
  const mid = bracketPlayerMatchId(slotId);
  const winner = matchWinner(scores) === 'A' ? playerA : playerB;
  t.matches[mid] = {
    id: mid,
    playerA,
    playerB,
    scores,
    status: 'finished',
    winner,
  };
  t.bracketMatches.push({
    id: slotId,
    seedA: playerA,
    seedB: playerB,
    winner,
    round,
  });
}

function award(awards: FunStatAward[], key: FunStatKey): FunStatAward {
  const row = awards.find((a) => a.key === key);
  if (!row) throw new Error(`missing award ${key}`);
  return row;
}

/** Four-player group + knockout with varied scores for stat assertions. */
function buildConcludedFourPlayerTournament(): Tournament {
  const t = createTournament();
  for (const id of ['p1', 'p2', 'p3', 'p4']) seedPlayer(t, id);
  t.seedings = ['p1', 'p2', 'p3', 'p4'];
  t.groups['1'] = { id: '1', playerIds: ['p1', 'p2', 'p3', 'p4'] };

  addGroupMatch(t, 'gm-p1-p2', 'p1', 'p2', sweepA());
  addGroupMatch(t, 'gm-p1-p3', 'p1', 'p3', belleA());
  addGroupMatch(t, 'gm-p1-p4', 'p1', 'p4', sweepA());
  addGroupMatch(t, 'gm-p2-p3', 'p2', 'p3', belleA());
  addGroupMatch(t, 'gm-p2-p4', 'p2', 'p4', belleA());
  addGroupMatch(t, 'gm-p3-p4', 'p3', 'p4', [
    { playerA: 11, playerB: 9 },
    { playerA: 9, playerB: 11 },
    { playerA: 13, playerB: 11 },
    { playerA: 11, playerB: 6 },
  ]);

  addBracketMatch(t, 'm1', 'p1', 'p4', sweepA(), 1);
  addBracketMatch(t, 'm2', 'p2', 'p3', belleA(), 1);
  addBracketMatch(t, 'm3', 'p1', 'p2', sweepA(), 2);

  return t;
}

describe('competitionTrackFunStats', () => {
  it('returns null before the final is decided', () => {
    const t = createTournament();
    for (const id of ['p1', 'p2']) seedPlayer(t, id);
    t.bracketMatches = [
      { id: 'm1', seedA: 'p1', seedB: 'p2', round: 1, winner: 'p1' },
      { id: 'm2', seedA: 'p1', seedB: 'p2', round: 2 },
    ];
    expect(competitionTrackFunStats(t)).toBeNull();
  });

  it('computes all eight awards on a concluded track', () => {
    const t = buildConcludedFourPlayerTournament();
    const stats = competitionTrackFunStats(t);
    expect(stats).not.toBeNull();
    const rows = stats!;

    expect(award(rows, 'winner').holderIds).toEqual(['p1']);
    expect(award(rows, 'sweep').holderIds).toEqual(['p1']);
    expect(award(rows, 'byTheNick').holderIds.sort()).toEqual(['p2', 'p3']);
    expect(award(rows, 'heartbreaker').holderIds).toEqual(['p3']);
    expect(award(rows, 'marathon').holderIds.sort()).toEqual(['p3', 'p4']);
    expect(award(rows, 'marathon').value).toBe(24);
    expect(award(rows, 'diehard').holderIds[0]).toBe('p2');
    expect(award(rows, 'noMercy').holderIds[0]).toBe('p1');
    expect(award(rows, 'ironWall').holderIds[0]).toBe('p1');
    expect(rows.map((r) => r.key)).toEqual([
      'winner',
      'diehard',
      'byTheNick',
      'noMercy',
      'sweep',
      'marathon',
      'heartbreaker',
      'ironWall',
    ]);
  });

  it('returns multiple holderIds when tied on a stat', () => {
    const t = createTournament();
    for (const id of ['a', 'b']) seedPlayer(t, id);
    t.seedings = ['a', 'b'];
    t.groups['1'] = { id: '1', playerIds: ['a', 'b'] };
    addGroupMatch(t, 'gm-a-b', 'a', 'b', sweepA());
    addBracketMatch(t, 'm1', 'a', 'b', sweepA(), 1);

    const stats = competitionTrackFunStats(t)!;
    expect(award(stats, 'winner').holderIds.sort()).toEqual(['a']);
    expect(award(stats, 'marathon').holderIds.sort()).toEqual(['a', 'b']);
    expect(award(stats, 'marathon').value).toBe(14);
  });

  it('omits awards shared by more than two players', () => {
    const filtered = funStatAwardsForDisplay([
      { key: 'marathon', holderIds: ['a', 'b', 'c'], value: 20 },
      { key: 'winner', holderIds: ['a', 'b'], value: 3 },
      { key: 'sweep', holderIds: ['x'], value: 2 },
    ]);
    expect(filtered.map((a) => a.key)).toEqual(['winner', 'sweep']);
  });

  it('attributes doubles stats to pair ids', () => {
    const t = createTournament();
    for (const id of ['p1', 'p2', 'p3', 'p4']) seedPlayer(t, id);
    t.competitionFormat = 'doubles-random-partners';
    t.pairs = {
      pair1: { id: 'pair1', playerIds: ['p1', 'p2'] },
      pair2: { id: 'pair2', playerIds: ['p3', 'p4'] },
    };
    t.seedings = ['p1', 'p2', 'p3', 'p4'];
    t.groups['1'] = {
      id: '1',
      playerIds: ['p1', 'p2', 'p3', 'p4'],
      pairIds: ['pair1', 'pair2'],
    };

    const gm: Match = {
      id: 'gm-pairs',
      playerA: 'p1',
      playerB: 'p3',
      pairA: 'pair1',
      pairB: 'pair2',
      scores: sweepA(),
      status: 'finished',
      winner: 'p1',
      winnerPairId: 'pair1',
      groupId: '1',
    };
    t.matches[gm.id] = gm;

    addBracketMatch(t, 'm1', 'pair1', 'pair2', sweepA(), 1);
    t.bracketMatches[0]!.seedA = 'pair1';
    t.bracketMatches[0]!.seedB = 'pair2';
    t.bracketMatches[0]!.winner = 'pair1';
    t.matches[bracketPlayerMatchId('m1')]!.pairA = 'pair1';
    t.matches[bracketPlayerMatchId('m1')]!.pairB = 'pair2';
    t.matches[bracketPlayerMatchId('m1')]!.winnerPairId = 'pair1';

    const stats = competitionTrackFunStats(t)!;
    expect(award(stats, 'winner').holderIds).toEqual(['pair1']);
    expect(award(stats, 'sweep').holderIds).toEqual(['pair1']);
  });

  it('returns per-class stats in multi-class tournaments when that class is finalized', () => {
    const runner = new CommandRunner();
    const ts = '2026-01-01T00:00:00.000Z';
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: { classes: [{ id: 'jun', name: 'Junior' }, { id: 'sen', name: 'Senior' }] },
      timestamp: ts,
    });
    for (const [pid, name] of [
      ['p1', 'J1'],
      ['p2', 'J2'],
      ['p3', 'J3'],
      ['p4', 'J4'],
    ] as const) {
      runner.execute({
        id: pid,
        type: 'CreatePlayer',
        dependsOn: ['tc'],
        payload: { playerId: pid, name, handicap: 0 },
        timestamp: ts,
      });
    }
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: { playerIds: ['p1', 'p2', 'p3', 'p4'] },
      timestamp: ts,
    });
    for (const pid of ['p1', 'p2', 'p3', 'p4'] as const) {
      runner.execute({
        id: `f-${pid}`,
        type: 'SetPlayerClassFlags',
        dependsOn: ['seed'],
        payload: { playerId: pid, flags: { jun: true, sen: false } },
        timestamp: ts,
      });
    }
    runner.execute({
      id: 'scg-jun',
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: { classId: 'jun', groups: [{ id: '1', playerIds: ['p1', 'p2', 'p3', 'p4'] }] },
      timestamp: ts,
    });
    runner.execute({
      id: 'gen-jun',
      type: 'GenerateBracket',
      dependsOn: ['scg-jun'],
      payload: { fillByes: false, cullToPowerOfTwo: false, classId: 'jun' },
      timestamp: ts,
    });

    const bo5 = sweepA();
    let dep = 'gen-jun';
    const t0 = runner.getTournament();
    for (const bm of t0.classTournaments.jun!.bracketMatches.filter((m) => bracketMatchRound(m) === 1)) {
      const mid = bracketPlayerMatchId(bm.id, 'jun');
      runner.execute({
        id: `cm-${bm.id}`,
        type: 'CreateMatch',
        dependsOn: [dep],
        payload: { matchId: mid, playerA: bm.seedA!, playerB: bm.seedB!, classId: 'jun' },
        timestamp: ts,
      });
      dep = `cm-${bm.id}`;
    }
    for (;;) {
      const t = runner.getTournament();
      const open = t.classTournaments.jun!.bracketMatches.filter(
        (bm) => bm.seedA && bm.seedB && bracketSlotAwaitingPlay(t, bm, 'jun'),
      );
      if (open.length === 0) break;
      open.sort((a, b) => bracketMatchRound(a) - bracketMatchRound(b) || a.id.localeCompare(b.id));
      const bm = open[0]!;
      const mid = bracketPlayerMatchId(bm.id, 'jun');
      runner.execute({
        id: `sc-${bm.id}`,
        type: 'EnterScore',
        dependsOn: [dep],
        payload: { matchId: mid, scores: bo5 },
        timestamp: ts,
      });
      dep = `sc-${bm.id}`;
    }

    const t = runner.getTournament();
    expect(competitionTrackFunStats(t)).toBeNull();
    expect(competitionTrackFunStats(t, 'sen')).toBeNull();
    const junStats = competitionTrackFunStats(t, 'jun');
    expect(junStats).not.toBeNull();
    expect(junStats!.length).toBe(8);
  });
});
