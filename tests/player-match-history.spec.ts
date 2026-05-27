import { describe, it, expect } from 'vitest';
import {
  bracketPlayerMatchId,
  createTournament,
  ensureBracketPhasePlayerMatches,
  generateBracket,
} from '../src/model';
import {
  buildSingleTournamentPlayerMatchHistory as buildHistory,
  matchDecidedGamesWon,
} from '../src/player-match-history';

describe('matchDecidedGamesWon', () => {
  it('counts decided games from the focal player perspective', () => {
    const m = {
      id: 'm1',
      playerA: 'a',
      playerB: 'b',
      scores: [
        { playerA: 11, playerB: 9 },
        { playerA: 9, playerB: 11 },
        { playerA: 11, playerB: 7 },
      ],
      status: 'finished' as const,
    };
    expect(matchDecidedGamesWon(m, 'a')).toEqual({ playerGames: 2, opponentGames: 1 });
    expect(matchDecidedGamesWon(m, 'b')).toEqual({ playerGames: 1, opponentGames: 2 });
  });

  it('returns null when no games are decided', () => {
    const m = {
      id: 'm1',
      playerA: 'a',
      playerB: 'b',
      scores: [],
      status: 'scheduled' as const,
    };
    expect(matchDecidedGamesWon(m, 'a')).toBeNull();
  });
});

describe('buildSingleTournamentPlayerMatchHistory', () => {
  function seedPlayers(t: ReturnType<typeof createTournament>, ids: string[]): void {
    for (const id of ids) {
      t.players[id] = { id, name: id.toUpperCase(), handicap: 0 };
    }
  }

  it('reports no matches when groups are missing and player has no bracket', () => {
    const t = createTournament();
    seedPlayers(t, ['p1']);
    const h = buildHistory(t, 'p1');
    expect(h.showNoMatchesAvailable).toBe(true);
    expect(h.groupSection).toBeNull();
    expect(h.bracketSections).toEqual([]);
  });

  it('lists group opponents with scores and scheduled rows without scores', () => {
    const t = createTournament();
    seedPlayers(t, ['a', 'b', 'c']);
    t.groups['3'] = { id: '3', playerIds: ['a', 'b', 'c'] };
    t.matches['m-ab'] = {
      id: 'm-ab',
      playerA: 'a',
      playerB: 'b',
      scores: [
        { playerA: 11, playerB: 9 },
        { playerA: 11, playerB: 7 },
        { playerA: 9, playerB: 11 },
      ],
      status: 'finished',
      groupId: '3',
    };
    t.matches['m-ac'] = {
      id: 'm-ac',
      playerA: 'a',
      playerB: 'c',
      scores: [{ playerA: 11, playerB: 9 }],
      status: 'scheduled',
      groupId: '3',
    };

    const h = buildHistory(t, 'a');
    expect(h.showNoMatchesAvailable).toBe(false);
    expect(h.groupSection?.group.id).toBe('3');
    expect(h.groupSection?.lines).toEqual([
      { opponentId: 'b', score: { playerGames: 2, opponentGames: 1 } },
      { opponentId: 'c', score: { playerGames: 1, opponentGames: 0 } },
    ]);
  });

  it('includes bracket rounds with decided games', () => {
    const t = createTournament();
    seedPlayers(t, ['p1', 'p2', 'p3', 'p4']);
    const r1 = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    t.bracketMatches = r1;
    ensureBracketPhasePlayerMatches(t);
    const bm = r1.find((m) => m.seedA === 'p1' || m.seedB === 'p1')!;
    const mid = bracketPlayerMatchId(bm.id);
    t.matches[mid] = {
      ...t.matches[mid]!,
      scores: [
        { playerA: 11, playerB: 6 },
        { playerA: 11, playerB: 8 },
        { playerA: 11, playerB: 4 },
      ],
      status: 'finished',
      winner: 'p1',
    };

    const h = buildHistory(t, 'p1');
    expect(h.bracketSections).toHaveLength(1);
    expect(h.bracketSections[0]!.round).toBe(1);
    expect(h.bracketSections[0]!.lines[0]).toMatchObject({
      opponentId: 'p4',
      score: { playerGames: 3, opponentGames: 0 },
    });
  });

  it('shows bracket scheduled matches without a score line', () => {
    const t = createTournament();
    seedPlayers(t, ['p1', 'p2']);
    t.bracketMatches = generateBracket(['p1', 'p2'], { fillByes: false, cullToPowerOfTwo: false });
    ensureBracketPhasePlayerMatches(t);

    const h = buildHistory(t, 'p1');
    expect(h.showNoMatchesAvailable).toBe(false);
    expect(h.bracketSections[0]!.lines[0]!.score).toBeNull();
  });
});
