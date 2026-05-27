import {
  type BracketMatch,
  type GroupDefinition,
  type Match,
  type PlayerId,
  type Tournament,
  bracketPlayerMatchId,
  findGroupForPlayer,
  gameWinner,
} from './model';

/** Games won in a match from the focal player's perspective (decided games only). */
export type PlayerMatchLineScore = { playerGames: number; opponentGames: number };

export type PlayerMatchHistoryLine = {
  opponentId: PlayerId;
  /** `null` when the match exists but has no decided games yet. */
  score: PlayerMatchLineScore | null;
};

export type PlayerMatchHistoryGroupSection = {
  kind: 'group';
  group: GroupDefinition;
  lines: PlayerMatchHistoryLine[];
};

export type PlayerMatchHistoryBracketSection = {
  kind: 'bracket';
  round: number;
  lines: PlayerMatchHistoryLine[];
};

export type SingleTournamentPlayerMatchHistory = {
  playerId: PlayerId;
  group: GroupDefinition | undefined;
  groupSection: PlayerMatchHistoryGroupSection | null;
  bracketSections: PlayerMatchHistoryBracketSection[];
  /** True when there is no group assignment (or no groups) and no bracket rows for this player. */
  showNoMatchesAvailable: boolean;
};

export function matchDecidedGamesWon(
  match: Match,
  focalPlayerId: PlayerId,
): PlayerMatchLineScore | null {
  if (match.playerA !== focalPlayerId && match.playerB !== focalPlayerId) return null;
  if (match.scores.length === 0) return null;
  const focalIsA = match.playerA === focalPlayerId;
  let playerGames = 0;
  let opponentGames = 0;
  let anyDecided = false;
  for (const gs of match.scores) {
    const w = gameWinner(gs);
    if (!w) continue;
    anyDecided = true;
    if ((focalIsA && w === 'A') || (!focalIsA && w === 'B')) playerGames++;
    else opponentGames++;
  }
  return anyDecided ? { playerGames, opponentGames } : null;
}

function findGroupMatchBetweenPlayers(
  tournament: Tournament,
  groupId: string,
  playerA: PlayerId,
  playerB: PlayerId,
): Match | undefined {
  for (const m of Object.values(tournament.matches)) {
    if (m.groupId !== groupId || m.classId) continue;
    const ok =
      (m.playerA === playerA && m.playerB === playerB) || (m.playerA === playerB && m.playerB === playerA);
    if (ok) return m;
  }
  return undefined;
}

function bracketLinesForPlayer(
  tournament: Tournament,
  bracketMatches: BracketMatch[],
  playerId: PlayerId,
): PlayerMatchHistoryBracketSection[] {
  const byRound = new Map<number, PlayerMatchHistoryLine[]>();
  for (const bm of bracketMatches) {
    if (bm.seedA !== playerId && bm.seedB !== playerId) continue;
    const opponentId = bm.seedA === playerId ? bm.seedB : bm.seedA;
    if (!opponentId || !tournament.players[opponentId]) continue;
    const pm = tournament.matches[bracketPlayerMatchId(bm.id)];
    const score = pm && !pm.groupId ? matchDecidedGamesWon(pm, playerId) : null;
    const round = bm.round;
    const bucket = byRound.get(round) ?? [];
    bucket.push({ opponentId, score });
    byRound.set(round, bucket);
  }
  return [...byRound.keys()]
    .sort((a, b) => a - b)
    .map((round) => ({ kind: 'bracket' as const, round, lines: byRound.get(round)! }));
}

/**
 * Match history for one player in a single-track (non–per-class) tournament.
 * Bracket sections use {@link tournament.bracketMatches} only.
 */
export function buildSingleTournamentPlayerMatchHistory(
  tournament: Tournament,
  playerId: PlayerId,
): SingleTournamentPlayerMatchHistory {
  const group = findGroupForPlayer(tournament, playerId, undefined);
  const groupsExist = Object.keys(tournament.groups).length > 0;

  let groupSection: PlayerMatchHistoryGroupSection | null = null;
  if (group) {
    const lines: PlayerMatchHistoryLine[] = [];
    for (const opponentId of group.playerIds) {
      if (opponentId === playerId) continue;
      const match = findGroupMatchBetweenPlayers(tournament, group.id, playerId, opponentId);
      lines.push({
        opponentId,
        score: match ? matchDecidedGamesWon(match, playerId) : null,
      });
    }
    groupSection = { kind: 'group', group, lines };
  }

  const bracketSections = bracketLinesForPlayer(tournament, tournament.bracketMatches, playerId);

  const showNoMatchesAvailable = (!groupsExist || !group) && bracketSections.length === 0;

  return {
    playerId,
    group,
    groupSection,
    bracketSections,
    showNoMatchesAvailable,
  };
}
