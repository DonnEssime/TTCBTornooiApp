import { getCompetitionTrack, trackGroupMatches } from './competition-track';
import { isDoublesTrack, trackBracketParticipants } from './doubles-track';
import {
  bracketPlayerMatchId,
  gameWinner,
  knockoutMatchHasDecisiveOutcome,
  singleEliminationPlacementRows,
  type Match,
  type PlayerId,
  type Tournament,
  winningPairIdFromMatch,
} from './model';

export type FunStatKey =
  | 'winner'
  | 'diehard'
  | 'byTheNick'
  | 'noMercy'
  | 'sweep'
  | 'marathon'
  | 'heartbreaker'
  | 'ironWall';

export type FunStatAward = {
  key: FunStatKey;
  holderIds: string[];
  value: number;
};

type ParticipantMode = 'player' | 'pair';

type ParticipantStats = {
  matchWins: number;
  matchLosses: number;
  pointsScored: number;
  pointsConceded: number;
  belles: number;
  sweepWins: number;
  closeLosses: number;
  longestGame: number;
  decidedGames: number;
};

function emptyStats(): ParticipantStats {
  return {
    matchWins: 0,
    matchLosses: 0,
    pointsScored: 0,
    pointsConceded: 0,
    belles: 0,
    sweepWins: 0,
    closeLosses: 0,
    longestGame: 0,
    decidedGames: 0,
  };
}

function participantMode(tournament: Tournament, classId?: string): ParticipantMode {
  return isDoublesTrack(tournament, classId) ? 'pair' : 'player';
}

function participantForSide(m: Match, side: 'A' | 'B', mode: ParticipantMode): PlayerId | undefined {
  if (mode === 'pair') {
    return side === 'A' ? m.pairA : m.pairB;
  }
  return side === 'A' ? m.playerA : m.playerB;
}

function matchWinnerParticipant(m: Match, mode: ParticipantMode): PlayerId | undefined {
  if (mode === 'pair') return winningPairIdFromMatch(m);
  return m.winner;
}

function isDecisiveGroupMatch(m: Match): boolean {
  if (!m.winner) return false;
  return m.status === 'finished' || m.status === 'forfeit' || m.status === 'eliminated';
}

function matchGameLine(m: Match): { gamesA: number; gamesB: number } | null {
  let gamesA = 0;
  let gamesB = 0;
  let any = false;
  for (const gs of m.scores) {
    const w = gameWinner(gs);
    if (!w) continue;
    any = true;
    if (w === 'A') gamesA++;
    else gamesB++;
  }
  return any ? { gamesA, gamesB } : null;
}

function collectTrackMatches(tournament: Tournament, classId?: string): Match[] {
  const track = getCompetitionTrack(tournament, classId);
  const byId = new Map<string, Match>();

  for (const m of trackGroupMatches(tournament, classId)) {
    if (isDecisiveGroupMatch(m)) byId.set(m.id, m);
  }

  for (const bm of track.bracketMatches) {
    const pm = tournament.matches[bracketPlayerMatchId(bm.id, classId)];
    if (pm && knockoutMatchHasDecisiveOutcome(pm)) byId.set(pm.id, pm);
  }

  return [...byId.values()];
}

function ensureParticipant(
  stats: Map<PlayerId, ParticipantStats>,
  participantIds: readonly PlayerId[],
  id: PlayerId,
): void {
  if (!participantIds.includes(id)) return;
  if (!stats.has(id)) stats.set(id, emptyStats());
}

function compareParticipants(
  a: PlayerId,
  b: PlayerId,
  metrics: Array<(id: PlayerId) => number>,
  directions: Array<'max' | 'min'>,
): number {
  for (let i = 0; i < metrics.length; i++) {
    const va = metrics[i]!(a);
    const vb = metrics[i]!(b);
    if (va !== vb) {
      return directions[i] === 'max' ? vb - va : va - vb;
    }
  }
  return a.localeCompare(b);
}

function pickBest(
  ids: readonly PlayerId[],
  metrics: Array<(id: PlayerId) => number>,
  directions: Array<'max' | 'min'>,
): PlayerId[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort((a, b) => compareParticipants(a, b, metrics, directions));
  const best = sorted[0]!;
  const bestValues = metrics.map((m) => m(best));
  return sorted.filter((id) => metrics.every((m, i) => m(id) === bestValues[i]!));
}

function aggregateTrackStats(
  tournament: Tournament,
  classId: undefined | string,
  matches: readonly Match[],
  participantIds: readonly PlayerId[],
  mode: ParticipantMode,
): Map<PlayerId, ParticipantStats> {
  const stats = new Map<PlayerId, ParticipantStats>();
  for (const pid of participantIds) stats.set(pid, emptyStats());

  for (const m of matches) {
    const sideA = participantForSide(m, 'A', mode);
    const sideB = participantForSide(m, 'B', mode);
    if (!sideA || !sideB) continue;

    ensureParticipant(stats, participantIds, sideA);
    ensureParticipant(stats, participantIds, sideB);

    const winnerId = matchWinnerParticipant(m, mode);
    if (winnerId && participantIds.includes(winnerId)) {
      stats.get(winnerId)!.matchWins++;
      const loserId = winnerId === sideA ? sideB : sideA;
      if (participantIds.includes(loserId)) stats.get(loserId)!.matchLosses++;
    }

    const line = matchGameLine(m);
    if (!line) continue;

    const gamesFor = (side: 'A' | 'B') => (side === 'A' ? line.gamesA : line.gamesB);
    const gamesAgainst = (side: 'A' | 'B') => (side === 'A' ? line.gamesB : line.gamesA);

    for (const side of ['A', 'B'] as const) {
      const pid = participantForSide(m, side, mode);
      if (!pid || !participantIds.includes(pid)) continue;
      const row = stats.get(pid)!;
      const pg = gamesFor(side);
      const og = gamesAgainst(side);
      row.decidedGames += pg + og;

      if (pg + og === 5 && pg >= 2 && og >= 2) row.belles++;
      if (winnerId === pid && pg === 3 && og === 0) row.sweepWins++;
      if (winnerId !== pid && pg === 2 && og === 3) row.closeLosses++;
    }

    for (const gs of m.scores) {
      const w = gameWinner(gs);
      if (!w) continue;
      const gameTotal = gs.playerA + gs.playerB;
      for (const side of ['A', 'B'] as const) {
        const pid = participantForSide(m, side, mode);
        if (!pid || !participantIds.includes(pid)) continue;
        const row = stats.get(pid)!;
        const scored = side === 'A' ? gs.playerA : gs.playerB;
        const conceded = side === 'A' ? gs.playerB : gs.playerA;
        row.pointsScored += scored;
        row.pointsConceded += conceded;
        if (gameTotal > row.longestGame) row.longestGame = gameTotal;
      }
    }
  }

  return stats;
}

function buildAwards(
  participantIds: readonly PlayerId[],
  stats: Map<PlayerId, ParticipantStats>,
): FunStatAward[] {
  const pointsPlayed = (id: PlayerId) => {
    const s = stats.get(id)!;
    return s.pointsScored + s.pointsConceded;
  };
  const pointDiff = (id: PlayerId) => stats.get(id)!.pointsScored - stats.get(id)!.pointsConceded;
  const withDecidedGames = participantIds.filter((id) => stats.get(id)!.decidedGames > 0);

  const defs: Array<{ key: FunStatKey; holderIds: PlayerId[]; value: number }> = [
    {
      key: 'winner',
      holderIds: pickBest(
        participantIds,
        [(id) => stats.get(id)!.matchWins, (id) => stats.get(id)!.matchLosses, (id) => id.charCodeAt(0)],
        ['max', 'min', 'min'],
      ),
      value: 0,
    },
    {
      key: 'diehard',
      holderIds: pickBest(
        participantIds,
        [(id) => pointsPlayed(id), (id) => stats.get(id)!.matchWins + stats.get(id)!.matchLosses],
        ['max', 'max'],
      ),
      value: 0,
    },
    {
      key: 'byTheNick',
      holderIds: pickBest(participantIds, [(id) => stats.get(id)!.belles], ['max']),
      value: 0,
    },
    {
      key: 'noMercy',
      holderIds: pickBest(
        withDecidedGames,
        [(id) => stats.get(id)!.pointsConceded, (id) => stats.get(id)!.decidedGames],
        ['min', 'max'],
      ),
      value: 0,
    },
    {
      key: 'sweep',
      holderIds: pickBest(participantIds, [(id) => stats.get(id)!.sweepWins], ['max']),
      value: 0,
    },
    {
      key: 'marathon',
      holderIds: pickBest(participantIds, [(id) => stats.get(id)!.longestGame], ['max']),
      value: 0,
    },
    {
      key: 'heartbreaker',
      holderIds: pickBest(participantIds, [(id) => stats.get(id)!.closeLosses], ['max']),
      value: 0,
    },
    {
      key: 'ironWall',
      holderIds: pickBest(participantIds, [(id) => pointDiff(id)], ['max']),
      value: 0,
    },
  ];

  return defs.map(({ key, holderIds }) => {
    let value = 0;
    const first = holderIds[0];
    if (first) {
      const s = stats.get(first)!;
      switch (key) {
        case 'winner':
          value = s.matchWins;
          break;
        case 'diehard':
          value = s.pointsScored + s.pointsConceded;
          break;
        case 'byTheNick':
          value = s.belles;
          break;
        case 'noMercy':
          value = s.pointsConceded;
          break;
        case 'sweep':
          value = s.sweepWins;
          break;
        case 'marathon':
          value = s.longestGame;
          break;
        case 'heartbreaker':
          value = s.closeLosses;
          break;
        case 'ironWall':
          value = s.pointsScored - s.pointsConceded;
          break;
      }
    }
    return { key, holderIds, value };
  });
}

/** Drop awards where more than two participants share the top spot. */
export function funStatAwardsForDisplay(awards: FunStatAward[]): FunStatAward[] {
  return awards.filter((a) => a.holderIds.length <= 2);
}

/** null when placement list is not finalized yet */
export function competitionTrackFunStats(
  tournament: Tournament,
  classId?: string,
): FunStatAward[] | null {
  const track = getCompetitionTrack(tournament, classId);
  if (
    singleEliminationPlacementRows(track.bracketMatches, tournament, classId) === null
  ) {
    return null;
  }

  const mode = participantMode(tournament, classId);
  const participantIds = trackBracketParticipants(tournament, classId);
  const matches = collectTrackMatches(tournament, classId);
  const stats = aggregateTrackStats(tournament, classId, matches, participantIds, mode);
  return funStatAwardsForDisplay(buildAwards(participantIds, stats));
}
