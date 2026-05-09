export type PlayerId = string;
export type TeamId = string;

export interface Player {
  id: PlayerId;
  name: string;
  handicap: number; // per tournament fixed
}

export interface Team {
  id: TeamId;
  name: string;
  memberIds: PlayerId[];
}

export interface GameScore {
  playerA: number;
  playerB: number;
}

export type MatchStatus = 'scheduled' | 'in-progress' | 'finished' | 'forfeit';

export interface Match {
  id: string;
  playerA: PlayerId;
  playerB: PlayerId;
  scores: GameScore[];
  status: MatchStatus;
  winner?: PlayerId;
}

export interface TeamMatch {
  id: string;
  teamA: TeamId;
  teamB: TeamId;
  scores: GameScore[];
  status: MatchStatus;
  winner?: TeamId;
}

export interface TableAssignment {
  tableId: string;
  matchId: string;
  round: number;
}

export type ForfeitPhase = 'group' | 'bracket';

export interface ForfeitEntry {
  phase: ForfeitPhase;
  timestamp: string;
}

export interface ForfeitState {
  players: Record<PlayerId, ForfeitEntry>;
  teams: Record<TeamId, ForfeitEntry>;
}

export interface GroupDefinition {
  id: string;
  playerIds: PlayerId[];
}

export type ForfeitGroupMode = 'auto-win' | 'not-played';

export interface ForfeitResults {
  /** Group-stage forfeit side-effects (player tournaments only). */
  playerWins: Record<PlayerId, number>;
}

/**
 * Supported modes (for now): (1) individual player tournaments — brackets/matches among players;
 * (2) optionally a single team-vs-team match (two teams, aggregate games), mutually exclusive with a player bracket.
 * Team-based tournaments (multi-team events, team brackets, cross-team player grids) are not supported.
 */
export interface Tournament {
  players: Record<PlayerId, Player>;
  teams: Record<TeamId, Team>;
  matches: Record<string, Match>;
  teamMatches: Record<string, TeamMatch>;
  bracketMatches: BracketMatch[];
  tableAssignments: TableAssignment[];
  seedings: string[];
  groups: Record<string, GroupDefinition>;
  forfeits: ForfeitState;
  forfeitGroupMode?: ForfeitGroupMode;
  forfeitResults: ForfeitResults;
  /** Bracket rounds for which score edits on mapped player matches are blocked (v1: bracket player matches only). */
  lockedBracketRounds: number[];
}

export function createTournament(): Tournament {
  return {
    players: {},
    teams: {},
    matches: {},
    teamMatches: {},
    bracketMatches: [],
    tableAssignments: [],
    seedings: [],
    groups: {},
    forfeits: { players: {}, teams: {} },
    forfeitGroupMode: undefined,
    forfeitResults: { playerWins: {} },
    lockedBracketRounds: [],
  };
}

export function applyBracketToTournament(tournament: Tournament, bracketMatches: BracketMatch[]): Tournament {
  if (Object.keys(tournament.teamMatches).length > 0) {
    throw new Error('Cannot apply a player bracket while team vs team matches exist');
  }
  tournament.bracketMatches = bracketMatches;
  tournament.lockedBracketRounds = [];
  return tournament;
}

export const defaultPointTarget = 11;

function validateNonNegative(score: GameScore): boolean {
  return score.playerA >= 0 && score.playerB >= 0;
}

export function gameWinner(score: GameScore, pointTarget = defaultPointTarget): 'A' | 'B' | undefined {
  if (!validateNonNegative(score)) {
    return undefined;
  }

  const { playerA, playerB } = score;
  if (playerA === playerB) {
    return undefined;
  }

  const maxScore = Math.max(playerA, playerB);
  const minScore = Math.min(playerA, playerB);

  if (maxScore < pointTarget) {
    return undefined;
  }

  if (maxScore === pointTarget && (maxScore - minScore) >= 2) {
    return playerA > playerB ? 'A' : 'B';
  }

  if (maxScore > pointTarget && (maxScore - minScore) >= 2) {
    return playerA > playerB ? 'A' : 'B';
  }

  return undefined;
}

export function isGameScoreLegal(score: GameScore, pointTarget = defaultPointTarget): boolean {
  if (!validateNonNegative(score)) {
    return false;
  }

  const { playerA, playerB } = score;

  // both players can't have points after a game is already decided
  const possibleWinner = gameWinner(score, pointTarget);
  if (!possibleWinner) {
    return false;
  }

  // enforce no additional points after the game is finished (two-point gap property in scoring format)
  if (playerA > playerB) {
    if (playerA > pointTarget + 20 || playerB > playerA) {
      return false;
    }
  } else {
    if (playerB > pointTarget + 20 || playerA > playerB) {
      return false;
    }
  }

  return true;
}

export function matchWinner(scores: GameScore[], bestOf = 5, pointTarget = defaultPointTarget): 'A' | 'B' | undefined {
  const winsNeeded = Math.ceil(bestOf / 2);
  let aWins = 0;
  let bWins = 0;

  for (const score of scores) {
    const winner = gameWinner(score, pointTarget);
    if (!winner) {
      return undefined;
    }
    if (winner === 'A') aWins++;
    if (winner === 'B') bWins++;

    if (aWins >= winsNeeded) return 'A';
    if (bWins >= winsNeeded) return 'B';

    if (aWins + bWins >= bestOf) break;
  }

  return undefined;
}

export function isMatchScoreLegal(scores: GameScore[], bestOf = 5, pointTarget = defaultPointTarget): boolean {
  if (scores.length === 0) return false;
  if (scores.length > bestOf) return false;

  let completedGames = 0;
  for (const score of scores) {
    if (!isGameScoreLegal(score, pointTarget)) {
      return false;
    }
    completedGames++;
  }

  const winner = matchWinner(scores, bestOf, pointTarget);
  return Boolean(winner);
}

export function playerMatchWinner(
  match: Match,
  bestOf = 5,
  pointTarget = defaultPointTarget,
): PlayerId | undefined {
  const winner = matchWinner(match.scores, bestOf, pointTarget);
  if (!winner) return undefined;
  return winner === 'A' ? match.playerA : match.playerB;
}

export function teamMatchWinner(
  teamMatch: TeamMatch,
  bestOf = 3,
  pointTarget = defaultPointTarget,
): TeamId | undefined {
  const winner = matchWinner(teamMatch.scores, bestOf, pointTarget);
  if (!winner) return undefined;
  return winner === 'A' ? teamMatch.teamA : teamMatch.teamB;
}

export function isTeamMatchScoreLegal(
  teamMatch: TeamMatch,
  tournament: Tournament,
  bestOf = 3,
  pointTarget = defaultPointTarget,
): boolean {
  if (!tournament.teams[teamMatch.teamA] || !tournament.teams[teamMatch.teamB]) {
    return false;
  }

  if (teamMatch.teamA === teamMatch.teamB) {
    return false;
  }

  return isMatchScoreLegal(teamMatch.scores, bestOf, pointTarget);
}

export interface BracketMatch {
  id: string;
  seedA?: string;
  seedB?: string;
  winner?: string;
  round: number;
}

export function nextPowerOfTwo(n: number): number {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function previousPowerOfTwo(n: number): number {
  if (n < 1) return 0;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

function seedPositions(size: number): number[] {
  if (size === 1) return [1];
  if ((size & (size - 1)) !== 0) {
    throw new Error('seedPositions requires power-of-two size');
  }
  const half = size / 2;
  const prev = seedPositions(half);
  const result: number[] = [];
  for (const seed of prev) {
    result.push(seed);
    result.push(size + 1 - seed);
  }
  return result;
}

export function generateBracket(
  seedings: string[],
  tournamentOrOptions?: Tournament | { fillByes?: boolean; cullToPowerOfTwo?: boolean },
  options: { fillByes?: boolean; cullToPowerOfTwo?: boolean } = { fillByes: true, cullToPowerOfTwo: false },
): BracketMatch[] {
  if (!seedings || seedings.length === 0) return [];

  let tournament: Tournament | undefined;
  let opts: { fillByes?: boolean; cullToPowerOfTwo?: boolean } = options;

  if (tournamentOrOptions) {
    if (
      'players' in tournamentOrOptions ||
      'teams' in tournamentOrOptions ||
      'matches' in tournamentOrOptions ||
      'teamMatches' in tournamentOrOptions ||
      'bracketMatches' in tournamentOrOptions
    ) {
      tournament = tournamentOrOptions as Tournament;
    } else {
      opts = tournamentOrOptions as { fillByes?: boolean; cullToPowerOfTwo?: boolean };
    }
  }

  const fillByes = opts.fillByes ?? true;
  const cullToPower = opts.cullToPowerOfTwo ?? false;

  let participants = [...seedings];

  // Remove group-forfeited players from participants pre-bracket (player tournaments only).
  if (tournament?.forfeits) {
    participants = participants.filter((p) => {
      const playerForfeit = tournament.forfeits.players[p as PlayerId];
      if (playerForfeit?.phase === 'group') {
        return false;
      }
      return true;
    });
  }

  if (cullToPower) {
    const maxForCull = previousPowerOfTwo(participants.length);
    if (maxForCull < participants.length) {
      participants = participants.slice(0, maxForCull);
    }
  }

  let slotCount = nextPowerOfTwo(participants.length);
  if (!fillByes && slotCount !== participants.length) {
    throw new Error('Cannot generate non-power-of-two bracket without fillByes');
  }

  // Include byes as empty slots
  while (participants.length < slotCount) {
    participants.push('BYE');
  }

  const positions = seedPositions(slotCount);
  const seeded = positions.map((seedIndex) => participants[seedIndex - 1]);

  const matches: BracketMatch[] = [];
  let idCounter = 1;

  for (let i = 0; i < seeded.length; i += 2) {
    const seedA = seeded[i];
    const seedB = seeded[i + 1];
    const match: BracketMatch = {
      id: `m${idCounter++}`,
      seedA: seedA === 'BYE' ? undefined : seedA,
      seedB: seedB === 'BYE' ? undefined : seedB,
      round: 1,
      winner:
        seedA === 'BYE' ? seedB === 'BYE' ? undefined : seedB : seedB === 'BYE' ? seedA : undefined,
    };
    matches.push(match);
  }

  return matches;
}

export function advanceBracketRound(tournament: Tournament): Tournament {
  const currentRound = Math.max(0, ...tournament.bracketMatches.map((m) => m.round));
  const currentMatches = tournament.bracketMatches.filter((m) => m.round === currentRound);
  if (currentMatches.length <= 1) {
    return tournament;
  }

  for (const match of currentMatches) {
    if (!match.winner) {
      throw new Error(`Cannot advance bracket: match ${match.id} has no winner`);
    }
  }

  const nextRound = currentRound + 1;
  const nextMatches: BracketMatch[] = [];
  let nextIdCounter = tournament.bracketMatches.length + 1;

  for (let i = 0; i < currentMatches.length; i += 2) {
    const left = currentMatches[i];
    const right = currentMatches[i + 1];
    const nm: BracketMatch = {
      id: `m${nextIdCounter++}`,
      seedA: left.winner,
      seedB: right.winner,
      round: nextRound,
      winner: undefined,
    };
    nextMatches.push(nm);
  }

  tournament.bracketMatches = [...tournament.bracketMatches, ...nextMatches];
  return tournament;
}

export function getFirstRoundMatchPosition(bracketMatches: BracketMatch[], playerId: string): number | undefined {
  const firstRound = bracketMatches.filter((m) => m.round === 1);
  const total = firstRound.length * 2;

  for (let idx = 0; idx < firstRound.length; idx++) {
    const match = firstRound[idx];
    if (match.seedA === playerId) {
      return idx * 2;
    }
    if (match.seedB === playerId) {
      return idx * 2 + 1;
    }
  }

  return undefined;
}

function findMatchByPlayers(tournament: Tournament, playerA: string, playerB: string): Match | undefined {
  return Object.values(tournament.matches).find((m) => {
    const same = (m.playerA === playerA && m.playerB === playerB) || (m.playerA === playerB && m.playerB === playerA);
    return same && m.status === 'finished' && m.winner; // also requires winner computed
  });
}

/** Bracket round for a player pairing, if it appears in the current bracket structure. */
export function findBracketRoundForPlayerPairing(tournament: Tournament, playerA: PlayerId, playerB: PlayerId): number | undefined {
  for (const bm of tournament.bracketMatches) {
    if (!bm.seedA || !bm.seedB) continue;
    const same =
      (bm.seedA === playerA && bm.seedB === playerB) || (bm.seedA === playerB && bm.seedB === playerA);
    if (same) return bm.round;
  }
  return undefined;
}

/** True if any player match mapped to this bracket round has scores entered or is finished. */
export function bracketRoundHasFinishedPlayerMatch(tournament: Tournament, round: number): boolean {
  for (const m of Object.values(tournament.matches)) {
    const r = findBracketRoundForPlayerPairing(tournament, m.playerA, m.playerB);
    if (r === round && (m.status === 'finished' || m.scores.length > 0)) {
      return true;
    }
  }
  return false;
}

export function settleBracketWinners(tournament: Tournament): Tournament {
  for (const bm of tournament.bracketMatches) {
    if (!bm.winner && bm.seedA && bm.seedB) {
      const seedAforfeit = tournament.forfeits?.players?.[bm.seedA];
      const seedBforfeit = tournament.forfeits?.players?.[bm.seedB];

      if (seedAforfeit?.phase === 'bracket' && seedBforfeit?.phase !== 'bracket') {
        bm.winner = bm.seedB;
        continue;
      }
      if (seedBforfeit?.phase === 'bracket' && seedAforfeit?.phase !== 'bracket') {
        bm.winner = bm.seedA;
        continue;
      }
      if (seedAforfeit?.phase === 'bracket' && seedBforfeit?.phase === 'bracket') {
        bm.winner = undefined;
        continue;
      }

      const match = findMatchByPlayers(tournament, bm.seedA, bm.seedB);
      if (match?.winner) {
        bm.winner = match.winner;
      }
    }
  }

  return tournament;
}

export function isBracketRoundComplete(tournament: Tournament, round: number): boolean {
  const matches = tournament.bracketMatches.filter((m) => m.round === round);
  if (matches.length === 0) return false;
  return matches.every((m) => Boolean(m.winner));
}

export function scheduleRound(tournament: Tournament, tableIds: string[], round: number): Tournament {
  const matches = tournament.bracketMatches.filter((m) => m.round === round);
  tournament.tableAssignments = tournament.tableAssignments.filter((a) => a.round !== round);
  let tableIndex = 0;
  for (const match of matches) {
    const assignment: TableAssignment = {
      tableId: tableIds[tableIndex % tableIds.length],
      matchId: match.id,
      round,
    };
    tournament.tableAssignments.push(assignment);
    tableIndex++;
  }
  return tournament;
}

export function forfeitPlayer(
  tournament: Tournament,
  playerId: PlayerId,
  phase: ForfeitPhase,
  configuredGroupMode?: ForfeitGroupMode,
): Tournament {
  if (!tournament.players[playerId]) {
    throw new Error('Player not found');
  }
  if (phase === 'group' && configuredGroupMode) {
    if (!tournament.forfeitGroupMode) {
      tournament.forfeitGroupMode = configuredGroupMode;
    }
  }

  tournament.forfeits.players[playerId] = { phase, timestamp: new Date().toISOString() };

  if (phase === 'group') {
    handleGroupForfeitForPlayer(tournament, playerId);
  } else {
    applyForfeitToOngoingMatches(tournament, playerId);
  }

  return tournament;
}

/** Forfeits for standalone team vs team matches only (bracket phase / in-flight matches). Team-based group tournaments are not supported. */
export function forfeitTeam(tournament: Tournament, teamId: TeamId, phase: ForfeitPhase): Tournament {
  if (!tournament.teams[teamId]) {
    throw new Error('Team not found');
  }
  if (phase === 'group') {
    throw new Error('Team group forfeits are not supported');
  }

  tournament.forfeits.teams[teamId] = { phase, timestamp: new Date().toISOString() };
  applyForfeitToOngoingTeamMatches(tournament, teamId);

  return tournament;
}

function handleGroupForfeitForPlayer(tournament: Tournament, playerId: PlayerId): void {
  const group = Object.values(tournament.groups).find((g) => g.playerIds.includes(playerId));
  if (!group) return;

  const mode = tournament.forfeitGroupMode ?? 'auto-win';
  for (const other of group.playerIds) {
    if (other === playerId) continue;
    if (mode === 'auto-win') {
      tournament.forfeitResults.playerWins[other] = (tournament.forfeitResults.playerWins[other] ?? 0) + 1;
    }
  }
}

function handleTeamMatchForfeit(tournament: Tournament, matchId: string, loserTeamId: TeamId): void {
  const tm = tournament.teamMatches[matchId];
  if (!tm) return;

  tm.status = 'forfeit';
  const winnerTeam = tm.teamA === loserTeamId ? tm.teamB : tm.teamB === loserTeamId ? tm.teamA : undefined;
  tm.winner = winnerTeam;
}

function handlePlayerMatchForfeit(tournament: Tournament, matchId: string, loserPlayerId: PlayerId): void {
  const m = tournament.matches[matchId];
  if (!m) return;

  m.status = 'forfeit';
  m.winner = m.playerA === loserPlayerId ? m.playerB : m.playerB === loserPlayerId ? m.playerA : undefined;
}

function applyForfeitToOngoingMatches(tournament: Tournament, playerId: PlayerId): void {
  for (const match of Object.values(tournament.matches)) {
    if (match.status === 'scheduled' || match.status === 'in-progress') {
      if (match.playerA === playerId || match.playerB === playerId) {
        handlePlayerMatchForfeit(tournament, match.id, playerId);
      }
    }
  }
}

function applyForfeitToOngoingTeamMatches(tournament: Tournament, teamId: TeamId): void {
  for (const match of Object.values(tournament.teamMatches)) {
    if (match.status === 'scheduled' || match.status === 'in-progress') {
      if (match.teamA === teamId || match.teamB === teamId) {
        handleTeamMatchForfeit(tournament, match.id, teamId);
      }
    }
  }
}

export function areTopSeedsSeparated(bracketMatches: BracketMatch[], topSeedId: string, secondSeedId: string): boolean {
  const pos1 = getFirstRoundMatchPosition(bracketMatches, topSeedId);
  const pos2 = getFirstRoundMatchPosition(bracketMatches, secondSeedId);
  if (pos1 === undefined || pos2 === undefined) {
    return false;
  }
  const halfSize = (bracketMatches.filter((m) => m.round === 1).length * 2) / 2;
  if (halfSize === 0) return true;
  return Math.floor(pos1 / halfSize) !== Math.floor(pos2 / halfSize);
}

