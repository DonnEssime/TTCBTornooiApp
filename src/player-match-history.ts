import {
  type BracketMatch,
  type GroupDefinition,
  type Match,
  type PlayerId,
  type Tournament,
  bracketPlayerMatchId,
  findGroupForPlayer,
  gameWinner,
  matchesOnTablesInAssignmentOrder,
} from './model';
import { isGroupMatchFinished } from './match-ordering';

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

/** Sort key for group matches: finished order, then in-progress, then partial, then unplayed. */
type GroupMatchPlayOrderKey = readonly [tier: number, subRank: number, tieBreak: string];

function groupMatchPlayOrderKey(
  tournament: Tournament,
  match: Match | undefined,
  opponentId: PlayerId,
): GroupMatchPlayOrderKey {
  if (!match) return [4, 0, opponentId];

  const finishOrder = tournament.matchFinishOrder ?? [];
  const finishIdx = finishOrder.indexOf(match.id);
  if (finishIdx >= 0) return [0, finishIdx, ''];

  if (isGroupMatchFinished(match) || match.status === 'finished' || match.status === 'forfeit') {
    return [1, 0, match.id];
  }

  const inProgressIdx = matchesOnTablesInAssignmentOrder(tournament).findIndex((m) => m.id === match.id);
  if (inProgressIdx >= 0) return [2, inProgressIdx, ''];

  if (match.scores.length > 0) return [3, 0, match.id];

  return [4, 0, opponentId];
}

function compareGroupMatchPlayOrderKeys(a: GroupMatchPlayOrderKey, b: GroupMatchPlayOrderKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2].localeCompare(b[2]);
}

function compareGroupHistoryLinesByPlayOrder(
  tournament: Tournament,
  groupId: string,
  playerId: PlayerId,
  a: PlayerMatchHistoryLine,
  b: PlayerMatchHistoryLine,
): number {
  const matchA = findGroupMatchBetweenPlayers(tournament, groupId, playerId, a.opponentId);
  const matchB = findGroupMatchBetweenPlayers(tournament, groupId, playerId, b.opponentId);
  return compareGroupMatchPlayOrderKeys(
    groupMatchPlayOrderKey(tournament, matchA, a.opponentId),
    groupMatchPlayOrderKey(tournament, matchB, b.opponentId),
  );
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
    lines.sort((a, b) => compareGroupHistoryLinesByPlayOrder(tournament, group.id, playerId, a, b));
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
