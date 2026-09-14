import {
  getCompetitionTrack,
  tournamentUsesClassTabs,
  trackTitle,
} from './competition-track';
import { isDoublesTrack, isShuffleDoublesTrack, pairForPlayer } from './doubles-track';
import {
  type BracketMatch,
  type GroupDefinition,
  type Match,
  type PlayerId,
  type Tournament,
  bracketDisplayOrderValue,
  bracketPlayerMatchId,
  findGroupForPlayer,
  findGroupMatchBetweenPairs,
  gameWinner,
  isTrackParticipantId,
  matchesOnTablesInAssignmentOrder,
} from './model';
import { isGroupMatchFinished } from './match-ordering';

/** Games won in a match from the focal player's perspective (decided games only). */
export type PlayerMatchLineScore = { playerGames: number; opponentGames: number };

export type PlayerMatchHistoryLine = {
  opponentId: PlayerId;
  /** Set when the line maps to a specific group match (required for shuffle doubles keys). */
  matchId?: string;
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

export type PlayerMatchHistoryTrackSection = {
  classId: string | undefined;
  trackTitle: string;
  group: GroupDefinition | undefined;
  groupSection: PlayerMatchHistoryGroupSection | null;
  bracketSections: PlayerMatchHistoryBracketSection[];
  bracketMatches: BracketMatch[];
};

export type PlayerTournamentMatchHistory = {
  playerId: PlayerId;
  tracks: PlayerMatchHistoryTrackSection[];
  /** True when every track has no group assignment and no bracket rows. */
  showNoMatchesAvailable: boolean;
};

/** @deprecated Use {@link PlayerTournamentMatchHistory}; kept for single-track callers. */
export type SingleTournamentPlayerMatchHistory = {
  playerId: PlayerId;
  group: GroupDefinition | undefined;
  groupSection: PlayerMatchHistoryGroupSection | null;
  bracketSections: PlayerMatchHistoryBracketSection[];
  showNoMatchesAvailable: boolean;
};

export function matchDecidedGamesWon(
  match: Match,
  focalPlayerId: PlayerId,
): PlayerMatchLineScore | null {
  if (match.scores.length === 0) return null;
  let focalIsA = match.playerA === focalPlayerId;
  if (match.teamA && match.teamB) {
    if (match.teamA.includes(focalPlayerId)) focalIsA = true;
    else if (match.teamB.includes(focalPlayerId)) focalIsA = false;
    else return null;
  } else if (match.playerA !== focalPlayerId && match.playerB !== focalPlayerId) {
    return null;
  }
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
  classId: string | undefined,
): Match | undefined {
  for (const m of Object.values(tournament.matches)) {
    if (m.groupId !== groupId) continue;
    if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
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

function findShuffleGroupMatchForPlayer(
  tournament: Tournament,
  groupId: string,
  playerId: PlayerId,
  opponentId: PlayerId,
  classId?: string,
): Match | undefined {
  for (const m of Object.values(tournament.matches)) {
    if (m.groupId !== groupId) continue;
    if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
    if (!m.teamA || !m.teamB) continue;
    const onA = m.teamA.includes(playerId);
    const onB = m.teamB.includes(playerId);
    if (!onA && !onB) continue;
    const oppTeam = onA ? m.teamB : m.teamA;
    if (oppTeam.includes(opponentId)) return m;
  }
  return undefined;
}

function compareGroupHistoryLinesByPlayOrder(
  tournament: Tournament,
  groupId: string,
  playerId: PlayerId,
  classId: string | undefined,
  a: PlayerMatchHistoryLine,
  b: PlayerMatchHistoryLine,
  doublesPairId?: string,
  shuffleDoubles?: boolean,
): number {
  const resolveMatch = (
    line: PlayerMatchHistoryLine,
    opponentId: PlayerId,
  ): Match | undefined => {
    if (line.matchId) {
      const m = tournament.matches[line.matchId];
      if (m?.groupId === groupId) return m;
    }
    if (doublesPairId) {
      return findGroupMatchBetweenPairs(tournament, groupId, classId, doublesPairId, opponentId);
    }
    if (shuffleDoubles) {
      return findShuffleGroupMatchForPlayer(tournament, groupId, playerId, opponentId, classId);
    }
    return findGroupMatchBetweenPlayers(tournament, groupId, playerId, opponentId, classId);
  };
  const matchA = resolveMatch(a, a.opponentId);
  const matchB = resolveMatch(b, b.opponentId);
  return compareGroupMatchPlayOrderKeys(
    groupMatchPlayOrderKey(tournament, matchA, a.opponentId),
    groupMatchPlayOrderKey(tournament, matchB, b.opponentId),
  );
}

function bracketLinesForPlayer(
  tournament: Tournament,
  bracketMatches: BracketMatch[],
  playerId: PlayerId,
  classId?: string,
): PlayerMatchHistoryBracketSection[] {
  const focalPair = isDoublesTrack(tournament, classId) ? pairForPlayer(tournament, classId, playerId) : undefined;
  const byRound = new Map<number, PlayerMatchHistoryLine[]>();
  for (const bm of bracketMatches) {
    let opponentId: PlayerId | undefined;
    if (focalPair) {
      if (bm.seedA !== focalPair.id && bm.seedB !== focalPair.id) continue;
      opponentId = bm.seedA === focalPair.id ? bm.seedB : bm.seedA;
    } else {
      if (bm.seedA !== playerId && bm.seedB !== playerId) continue;
      opponentId = bm.seedA === playerId ? bm.seedB : bm.seedA;
    }
    if (!opponentId || !isTrackParticipantId(tournament, opponentId, classId)) continue;
    const pm = tournament.matches[bracketPlayerMatchId(bm.id, classId)];
    const score = pm && !pm.groupId ? matchDecidedGamesWon(pm, playerId) : null;
    const round = bm.round;
    const bucket = byRound.get(round) ?? [];
    bucket.push({ opponentId, score });
    byRound.set(round, bucket);
  }
  return [...byRound.keys()]
    .sort((a, b) => {
      const ma = bracketMatches.find((m) => m.round === a) ?? { id: '', round: a };
      const mb = bracketMatches.find((m) => m.round === b) ?? { id: '', round: b };
      return bracketDisplayOrderValue(ma, bracketMatches) - bracketDisplayOrderValue(mb, bracketMatches);
    })
    .map((round) => ({ kind: 'bracket' as const, round, lines: byRound.get(round)! }));
}

function buildTrackSection(
  tournament: Tournament,
  playerId: PlayerId,
  classId: string | undefined,
  trackTitleLabel: string,
): PlayerMatchHistoryTrackSection {
  const track = getCompetitionTrack(tournament, classId);
  const group = findGroupForPlayer(tournament, playerId, classId);
  const focalPair = isDoublesTrack(tournament, classId) ? pairForPlayer(tournament, classId, playerId) : undefined;

  let groupSection: PlayerMatchHistoryGroupSection | null = null;
  if (group) {
    const lines: PlayerMatchHistoryLine[] = [];
    if (focalPair && group.pairIds?.length) {
      for (const oppPairId of group.pairIds) {
        if (oppPairId === focalPair.id) continue;
        const match = findGroupMatchBetweenPairs(tournament, group.id, classId, focalPair.id, oppPairId);
        const rep = tournament.players[focalPair.playerIds[0]!]?.id ?? focalPair.playerIds[0]!;
        lines.push({
          opponentId: oppPairId,
          matchId: match?.id,
          score: match ? matchDecidedGamesWon(match, rep) : null,
        });
      }
    } else if (isShuffleDoublesTrack(tournament, classId)) {
      for (const m of Object.values(tournament.matches)) {
        if (m.groupId !== group.id) continue;
        if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
        if (!m.teamA || !m.teamB) continue;
        const onA = m.teamA.includes(playerId);
        const onB = m.teamB.includes(playerId);
        if (!onA && !onB) continue;
        const oppTeam = onA ? m.teamB : m.teamA;
        const opponentId = oppTeam.find((pid) => pid !== playerId) ?? oppTeam[0]!;
        lines.push({
          opponentId,
          matchId: m.id,
          score: matchDecidedGamesWon(m, playerId),
        });
      }
    } else {
      for (const opponentId of group.playerIds) {
        if (opponentId === playerId) continue;
        const match = findGroupMatchBetweenPlayers(tournament, group.id, playerId, opponentId, classId);
        lines.push({
          opponentId,
          matchId: match?.id,
          score: match ? matchDecidedGamesWon(match, playerId) : null,
        });
      }
    }
    lines.sort((a, b) =>
      compareGroupHistoryLinesByPlayOrder(
        tournament,
        group.id,
        playerId,
        classId,
        a,
        b,
        focalPair?.id,
        isShuffleDoublesTrack(tournament, classId),
      ),
    );
    groupSection = { kind: 'group', group, lines };
  }

  const bracketSections = bracketLinesForPlayer(tournament, track.bracketMatches, playerId, classId);

  return {
    classId,
    trackTitle: trackTitleLabel,
    group,
    groupSection,
    bracketSections,
    bracketMatches: track.bracketMatches,
  };
}

function trackHasNoMatches(tournament: Tournament, track: PlayerMatchHistoryTrackSection): boolean {
  const groupsExist = Object.keys(getCompetitionTrack(tournament, track.classId).groups).length > 0;
  return (!groupsExist || !track.group) && track.bracketSections.length === 0;
}

/** Match history for one player across all competition tracks they are entered in. */
export function buildPlayerMatchHistory(
  tournament: Tournament,
  playerId: PlayerId,
  mainDrawLabel: string,
): PlayerTournamentMatchHistory {
  const tracks: PlayerMatchHistoryTrackSection[] = [];

  if (!tournamentUsesClassTabs(tournament)) {
    tracks.push(buildTrackSection(tournament, playerId, undefined, mainDrawLabel));
  } else {
    const flags = tournament.playerClassFlags[playerId] ?? {};
    for (const def of tournament.classDefinitions) {
      if (!flags[def.id]) continue;
      const title = trackTitle(tournament, def.id, mainDrawLabel);
      tracks.push(buildTrackSection(tournament, playerId, def.id, title));
    }
  }

  const showNoMatchesAvailable =
    tracks.length === 0 ||
    tracks.every((tr) => trackHasNoMatches(tournament, tr));

  return {
    playerId,
    tracks,
    showNoMatchesAvailable,
  };
}

/**
 * Match history for one player in a single-track tournament (first/only track).
 * @deprecated Prefer {@link buildPlayerMatchHistory} for multi-class support.
 */
export function buildSingleTournamentPlayerMatchHistory(
  tournament: Tournament,
  playerId: PlayerId,
): SingleTournamentPlayerMatchHistory {
  const full = buildPlayerMatchHistory(tournament, playerId, 'Main draw');
  const track = full.tracks[0];
  if (!track) {
    return {
      playerId,
      group: undefined,
      groupSection: null,
      bracketSections: [],
      showNoMatchesAvailable: true,
    };
  }
  return {
    playerId,
    group: track.group,
    groupSection: track.groupSection,
    bracketSections: track.bracketSections,
    showNoMatchesAvailable: track.groupSection === null && track.bracketSections.length === 0,
  };
}
