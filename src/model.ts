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
  /** Set for group-stage player matches (not bracket). */
  groupId?: string;
  /** Set for group-stage matches in a multi-class track. */
  classId?: string;
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
  /** Display name; falls back to id in the UI when missing. */
  label?: string;
  playerIds: PlayerId[];
}

/** User-defined competition track within one tournament (e.g. junior, handicapped). */
export interface TournamentClassDefinition {
  id: string;
  name: string;
}

/** Per-class competition state (seedings derived from global order + class flags). */
export interface ClassTournamentSlice {
  /** Player ids in global seed order that are entered in this class. */
  seedings: PlayerId[];
  groups: Record<string, GroupDefinition>;
  bracketMatches: BracketMatch[];
  lockedBracketRounds: number[];
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
  /** When length ≥ 2, UI uses one tab row per class; bracket generation is per-class (see class slices). */
  classDefinitions: TournamentClassDefinition[];
  /** Per player, per class id — true means the player competes in that class track. */
  playerClassFlags: Record<PlayerId, Record<string, boolean>>;
  /** Per class id: derived seedings plus future group/bracket state for that track. */
  classTournaments: Record<string, ClassTournamentSlice>;
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
    classDefinitions: [],
    playerClassFlags: {},
    classTournaments: {},
  };
}

/** Normalize display name for duplicate checks (trim, collapse spaces, case-fold). */
export function normalizedPlayerDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * True when another player already uses this display name (case-insensitive; leading/trailing/duplicate spaces ignored).
 * Optional `exceptPlayerId` skips that player (e.g. rename-in-place). Player ids remain the canonical identity.
 */
export function isPlayerDisplayNameTaken(tournament: Tournament, name: string, exceptPlayerId?: PlayerId): boolean {
  const key = normalizedPlayerDisplayName(name);
  if (!key) return false;
  for (const [id, p] of Object.entries(tournament.players)) {
    if (exceptPlayerId !== undefined && id === exceptPlayerId) continue;
    if (normalizedPlayerDisplayName(p.name) === key) return true;
  }
  return false;
}

export function emptyClassTournamentSlice(): ClassTournamentSlice {
  return {
    seedings: [],
    groups: {},
    bracketMatches: [],
    lockedBracketRounds: [],
  };
}

function playerOptedIntoClass(t: Tournament, playerId: PlayerId, classId: string): boolean {
  return Boolean(t.playerClassFlags[playerId]?.[classId]);
}

/** Refresh per-class slice seedings from global {@link Tournament.seedings} and flags; drops stale class keys. */
export function recomputeClassTournamentSlices(t: Tournament): void {
  const validIds = new Set(t.classDefinitions.map((c) => c.id));
  for (const k of Object.keys(t.classTournaments)) {
    if (!validIds.has(k)) {
      delete t.classTournaments[k];
    }
  }

  for (const def of t.classDefinitions) {
    if (!t.classTournaments[def.id]) {
      t.classTournaments[def.id] = emptyClassTournamentSlice();
    }
    const slice = t.classTournaments[def.id];
    if (!slice.lockedBracketRounds) {
      slice.lockedBracketRounds = [];
    }
    slice.seedings = t.seedings.filter((pid) => playerOptedIntoClass(t, pid, def.id));
  }

  for (const pid of Object.keys(t.playerClassFlags)) {
    const row = t.playerClassFlags[pid];
    for (const k of Object.keys(row)) {
      if (!validIds.has(k)) {
        delete row[k];
      }
    }
  }
}

/** True when the tournament uses multiple class tabs (two or more definitions). */
export function tournamentUsesClassTabs(t: Tournament): boolean {
  return t.classDefinitions.length >= 2;
}

/** All unordered pairs for a round-robin (player ids sorted lexicographically per pair). */
export function roundRobinPairs(playerIds: PlayerId[]): Array<[PlayerId, PlayerId]> {
  const ids = [...new Set(playerIds)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const out: Array<[PlayerId, PlayerId]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      out.push([ids[i], ids[j]]);
    }
  }
  return out;
}

/**
 * Partition N players into consecutive group sizes, each between S−1 and S (when N > S),
 * or a single group of N when N ≤ S. Used for “target group size” with balanced fill.
 */
export function partitionPlayerCountIntoGroupSizes(playerCount: number, targetSize: number): number[] {
  if (playerCount <= 0) return [];
  const S = Math.max(1, Math.floor(targetSize));
  if (S === 1) return Array.from({ length: playerCount }, () => 1);
  if (playerCount <= S) return [playerCount];
  const g = Math.ceil(playerCount / S);
  const kLarge = playerCount - g * (S - 1);
  const sizes: number[] = [];
  for (let i = 0; i < kLarge; i++) sizes.push(S);
  for (let i = 0; i < g - kLarge; i++) sizes.push(S - 1);
  return sizes;
}

/** Build groups with ids "1", "2", … and labels "group 1", "group 2", … in order, splitting `playerIds` by {@link partitionPlayerCountIntoGroupSizes}. */
export function buildNumberedGroupsFromPlayerOrder(playerIds: PlayerId[], targetSize: number): GroupDefinition[] {
  const ids = [...playerIds].filter(Boolean);
  const n = ids.length;
  if (n === 0) return [];
  const sizes = partitionPlayerCountIntoGroupSizes(n, targetSize);
  const out: GroupDefinition[] = [];
  let offset = 0;
  for (let gi = 0; gi < sizes.length; gi++) {
    const sz = sizes[gi];
    const chunk = ids.slice(offset, offset + sz);
    offset += sz;
    const num = String(gi + 1);
    out.push({ id: num, label: `group ${num}`, playerIds: chunk });
  }
  return out;
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

  /** Past 11–11 (i.e. either score > 11), the game must end on an exact two-point gap (e.g. 13–11, not 13–10). */
  if (maxScore > pointTarget) {
    return (maxScore - minScore) === 2 ? (playerA > playerB ? 'A' : 'B') : undefined;
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

/**
 * Lexicographic sort places `m10` before `m2`. Bracket columns and `advanceBracketRound` pairing
 * must use numeric order on standard `m{n}` ids from {@link generateBracket}.
 */
export function compareBracketMatchIdString(aId: string, bId: string): number {
  const ma = /^m(\d+)$/.exec(aId);
  const mb = /^m(\d+)$/.exec(bId);
  if (ma && mb) {
    const na = Number(ma[1]);
    const nb = Number(mb[1]);
    if (na !== nb) return na - nb;
    return 0;
  }
  return aId.localeCompare(bId);
}

export function compareBracketMatchId(a: BracketMatch, b: BracketMatch): number {
  return compareBracketMatchIdString(a.id, b.id);
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

/** FNV-1a 32-bit hash for PRNG seeding (stable across engines). */
function hashStringToSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle with a seeded RNG (same `seedString` → same permutation). */
export function shuffleDeterministic<T>(items: T[], seedString: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashStringToSeed(seedString));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
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

/** Standings row for one group (W/L, then player id), best first — same rules as the web group table. */
export function groupStandingsRowsForBracket(
  tournament: Tournament,
  g: GroupDefinition,
  classId: string | undefined,
): Array<{ pid: PlayerId; w: number; l: number }> {
  const pids = g.playerIds;
  const wins: Record<string, number> = Object.fromEntries(pids.map((p) => [p, 0]));
  const losses: Record<string, number> = Object.fromEntries(pids.map((p) => [p, 0]));
  for (const m of Object.values(tournament.matches)) {
    if (m.groupId !== g.id || m.status !== 'finished' || !m.winner) continue;
    if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
    if (!pids.includes(m.playerA) || !pids.includes(m.playerB)) continue;
    wins[m.winner] = (wins[m.winner] ?? 0) + 1;
    const loser = m.winner === m.playerA ? m.playerB : m.playerA;
    losses[loser] = (losses[loser] ?? 0) + 1;
  }
  return [...pids]
    .map((pid) => ({ pid, w: wins[pid] ?? 0, l: losses[pid] ?? 0 }))
    .sort((a, b) => b.w - a.w || a.l - b.l || a.pid.localeCompare(b.pid));
}

/** Label shown in lists (same fallback as the app group heading: `label` or `id`). */
export function displayLabelForGroup(g: GroupDefinition): string {
  return g.label?.trim() || g.id;
}

export function groupRecordForBracketScope(
  tournament: Tournament,
  classId: string | undefined,
): Record<string, GroupDefinition> {
  return classId ? tournament.classTournaments[classId]?.groups ?? {} : tournament.groups;
}

export function findGroupForPlayer(
  tournament: Tournament,
  playerId: PlayerId,
  classId: string | undefined,
): GroupDefinition | undefined {
  const rec = groupRecordForBracketScope(tournament, classId);
  return Object.values(rec).find((g) => g.playerIds.includes(playerId));
}

/**
 * True when every group match for this group is finished with a winner.
 * For global scope (`classId` undefined), ignores matches tagged with another `classId`.
 */
export function groupAllMatchesFinished(
  tournament: Tournament,
  group: GroupDefinition,
  classId: string | undefined,
): boolean {
  for (const m of Object.values(tournament.matches)) {
    if (m.groupId !== group.id) continue;
    if (classId !== undefined) {
      if (m.classId !== classId) continue;
    } else if (m.classId) {
      continue;
    }
    if (m.status !== 'finished' || !m.winner) return false;
  }
  return true;
}

/**
 * True when the bracket UI may show this player's real name: not in a scoped group, or that group's
 * phase is fully finished. Until then, slots use {@link formatBracketSlotPlayerLabel}.
 */
export function bracketPlayerIdentityResolvedForDisplay(
  tournament: Tournament,
  playerId: PlayerId,
  classId: string | undefined,
): boolean {
  const g = findGroupForPlayer(tournament, playerId, classId);
  if (!g) return true;
  return groupAllMatchesFinished(tournament, g, classId);
}

/** 1-based index in current {@link groupStandingsRowsForBracket} order (best row = 1). */
export function currentGroupPlace1Based(
  tournament: Tournament,
  group: GroupDefinition,
  playerId: PlayerId,
  classId: string | undefined,
): number {
  const rows = groupStandingsRowsForBracket(tournament, group, classId);
  const idx = rows.findIndex((r) => r.pid === playerId);
  return idx >= 0 ? idx + 1 : 1;
}

/**
 * Bracket slot text: player name once their group is fully played; otherwise `"{group} place {n}"`
 * from current standings order (names hidden until the whole group is finished).
 */
export function formatBracketSlotPlayerLabel(
  tournament: Tournament,
  playerId: PlayerId,
  classId: string | undefined,
): string {
  const g = findGroupForPlayer(tournament, playerId, classId);
  if (!g || groupAllMatchesFinished(tournament, g, classId)) {
    return tournament.players[playerId]?.name ?? playerId;
  }
  const place = currentGroupPlace1Based(tournament, g, playerId, classId);
  return `${displayLabelForGroup(g)} place ${place}`;
}

/** Whether a knockout-phase player match should appear in “matches this round” while groups may still be open. */
export function matchPlayersResolvedForBracketPhaseList(
  tournament: Tournament,
  match: Match,
  classId: string | undefined,
): boolean {
  return (
    bracketPlayerIdentityResolvedForDisplay(tournament, match.playerA, classId) &&
    bracketPlayerIdentityResolvedForDisplay(tournament, match.playerB, classId)
  );
}

/**
 * Drops players until `previousPowerOfTwo(seedings.length)` remain.
 * Elimination order: all true 4th-place finishers (within their group) in random order, then all 3rd-place, etc.,
 * using {@link shuffleDeterministic} per tier so the same `shuffleKey` yields the same cut.
 * Players in smaller groups have no e.g. "4th" row until larger groups have shed that tier.
 */
export function cullSeedingsByGroupPlacement(
  seedings: PlayerId[],
  tournament: Tournament,
  classId: string | undefined,
  shuffleKey: string,
): PlayerId[] {
  const n = seedings.length;
  const target = previousPowerOfTwo(n);
  if (n <= 1 || n === target) {
    return [...seedings];
  }
  const toRemove = n - target;
  const groupsRecord = classId
    ? tournament.classTournaments[classId]?.groups ?? {}
    : tournament.groups;

  if (Object.keys(groupsRecord).length === 0) {
    throw new Error('Group placement elimination requires defined groups');
  }

  const placement = new Map<PlayerId, { place: number; groupSize: number }>();
  for (const g of Object.values(groupsRecord)) {
    const ordered = groupStandingsRowsForBracket(tournament, g, classId);
    const m = ordered.length;
    for (let idx = 0; idx < ordered.length; idx++) {
      placement.set(ordered[idx]!.pid, { place: idx + 1, groupSize: m });
    }
  }

  const keyBase = shuffleKey.trim() || 'Tournament';

  for (const pid of seedings) {
    if (!placement.has(pid)) {
      throw new Error(`Player ${pid} is not listed in any group (required for placement elimination)`);
    }
  }

  const remaining = new Set(seedings);
  let removed = 0;
  const maxPlace = Math.max(...Object.values(groupsRecord).map((g) => g.playerIds.length));

  for (let placeNum = maxPlace; placeNum >= 2 && removed < toRemove; placeNum--) {
    const tier = [...remaining].filter((pid) => placement.get(pid)!.place === placeNum);
    const shuffled = shuffleDeterministic(tier, `${keyBase}:elim-tier:${placeNum}`);
    for (const pid of shuffled) {
      if (removed >= toRemove) break;
      remaining.delete(pid);
      removed++;
    }
  }

  if (remaining.size !== target) {
    if (remaining.size > target) {
      throw new Error(
        'Cannot reach a power-of-two field using only non-leaders from group standings (not enough lower-ranked players).',
      );
    }
    throw new Error('Group placement elimination removed too many players');
  }

  return seedings.filter((pid) => remaining.has(pid));
}

export type GenerateBracketOptions = {
  fillByes?: boolean;
  cullToPowerOfTwo?: boolean;
  shuffleKey?: string;
  /** When true (with `cullToPowerOfTwo` and `fillByes: false`), cull using group finishing order instead of seed order. */
  cullByGroupPlacement?: boolean;
  /** Scope for group standings when `cullByGroupPlacement` is set. */
  classId?: string;
};

export function generateBracket(
  seedings: string[],
  tournamentOrOptions?: Tournament | GenerateBracketOptions,
  options: GenerateBracketOptions = {
    fillByes: true,
    cullToPowerOfTwo: false,
  },
): BracketMatch[] {
  if (!seedings || seedings.length === 0) return [];

  let tournament: Tournament | undefined;
  let opts: GenerateBracketOptions = options;

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
      opts = tournamentOrOptions as GenerateBracketOptions;
    }
  }

  const fillByes = opts.fillByes ?? true;
  const cullToPower = opts.cullToPowerOfTwo ?? false;
  const cullByPlacement = opts.cullByGroupPlacement === true;

  if (cullByPlacement && fillByes) {
    throw new Error('cullByGroupPlacement cannot be combined with fillByes');
  }
  if (cullByPlacement && !cullToPower) {
    throw new Error('cullByGroupPlacement requires cullToPowerOfTwo');
  }
  if (cullByPlacement && !tournament) {
    throw new Error('cullByGroupPlacement requires tournament state for group standings');
  }

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
      if (cullByPlacement && tournament) {
        const tierKey = opts.shuffleKey !== undefined ? String(opts.shuffleKey).trim() || 'Tournament' : 'Tournament';
        participants = cullSeedingsByGroupPlacement(participants, tournament, opts.classId, tierKey);
      } else {
        participants = participants.slice(0, maxForCull);
      }
    }
  }

  if (opts.shuffleKey !== undefined) {
    const key = String(opts.shuffleKey).trim() || 'Tournament';
    if (participants.length > 1) {
      participants = shuffleDeterministic(participants, key);
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
  const currentMatches = tournament.bracketMatches.filter((m) => m.round === currentRound).sort(compareBracketMatchId);
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
  const firstRound = bracketMatches.filter((m) => m.round === 1).sort(compareBracketMatchId);
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
  const candidates = Object.values(tournament.matches).filter((m) => {
    const same = (m.playerA === playerA && m.playerB === playerB) || (m.playerA === playerB && m.playerB === playerA);
    return same && m.status === 'finished' && m.winner;
  });
  const bracketish = candidates.find((m) => !m.groupId);
  return bracketish ?? candidates[0];
}

/**
 * Bracket round for a player pairing, if it appears in the current bracket structure.
 * Group-phase matches can reuse the same pairing; callers that have a `Match` should ignore
 * rows with `groupId` set when treating scores as bracket play (see `matchesForBracketRound` in the app).
 */
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
    if (m.groupId) continue;
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

/**
 * For every bracket slot that still needs to be played (two seeds, no winner), ensures a scheduled
 * player {@link Match} exists at `match-${bracketMatch.id}` with no `groupId`. Later rounds only
 * receive these rows when bracket reconciliation runs after a round completes (see command runner);
 * round 1 is still typically created via explicit `CreateMatch` commands from the app.
 */
export function ensureBracketPhasePlayerMatches(tournament: Tournament): void {
  if (Object.keys(tournament.teamMatches).length > 0) {
    return;
  }
  for (const bm of tournament.bracketMatches) {
    if (!bm.seedA || !bm.seedB || bm.winner) continue;
    const mid = `match-${bm.id}`;
    if (tournament.matches[mid]) continue;
    if (!tournament.players[bm.seedA] || !tournament.players[bm.seedB]) continue;
    tournament.matches[mid] = {
      id: mid,
      playerA: bm.seedA,
      playerB: bm.seedB,
      scores: [],
      status: 'scheduled',
    };
  }
}

export function isBracketRoundComplete(tournament: Tournament, round: number): boolean {
  const matches = tournament.bracketMatches.filter((m) => m.round === round);
  if (matches.length === 0) return false;
  return matches.every((m) => Boolean(m.winner));
}

export interface BracketPlacementRow {
  place: number;
  playerId: PlayerId;
}

/** Loser of a decided two-player bracket match (undefined for bye or missing side). */
export function bracketMatchLoser(m: BracketMatch): PlayerId | undefined {
  if (!m.winner) return undefined;
  const a = m.seedA;
  const b = m.seedB;
  if (!a || !b) return undefined;
  return m.winner === a ? b : a;
}

/**
 * Single-elimination final ranking: places 1–2 from the final; for each earlier round, losers are
 * ordered by the finishing rank of the opponent who beat them (place 3 = semi loser to the champion,
 * 5–8 = quarter losers to places 1–4, etc.).
 *
 * Returns `null` if there is no single final or the final has no winner yet. Participants without a
 * computable rank (e.g. open matches) are appended with consecutive places after the last assigned rank.
 */
export function singleEliminationPlacementRows(bracketMatches: BracketMatch[]): BracketPlacementRow[] | null {
  if (bracketMatches.length === 0) return null;
  const maxRound = Math.max(...bracketMatches.map((m) => m.round));
  const finals = bracketMatches.filter((m) => m.round === maxRound);
  if (finals.length !== 1) return null;
  const fm = finals[0]!;
  if (!fm.winner || !fm.seedA || !fm.seedB) return null;

  const places = new Map<PlayerId, number>();
  places.set(fm.winner, 1);
  places.set(fm.winner === fm.seedA ? fm.seedB! : fm.seedA!, 2);

  for (let r = maxRound - 1; r >= 1; r--) {
    const roundMs = bracketMatches.filter((m) => m.round === r && m.winner).sort(compareBracketMatchId);
    const rows: Array<{ loser: PlayerId; wp: number }> = [];
    for (const m of roundMs) {
      const loser = bracketMatchLoser(m);
      if (!loser) continue;
      const wp = places.get(m.winner!);
      if (wp === undefined) continue;
      rows.push({ loser, wp });
    }
    rows.sort((a, b) => a.wp - b.wp || a.loser.localeCompare(b.loser));
    const start = 2 ** (maxRound - r) + 1;
    for (let i = 0; i < rows.length; i++) {
      places.set(rows[i]!.loser, start + i);
    }
  }

  const participants = new Set<PlayerId>();
  for (const m of bracketMatches) {
    if (m.seedA) participants.add(m.seedA);
    if (m.seedB) participants.add(m.seedB);
  }

  let maxAssigned = 0;
  for (const v of places.values()) {
    if (v > maxAssigned) maxAssigned = v;
  }
  let next = maxAssigned + 1;

  const out: BracketPlacementRow[] = [];
  for (const pid of [...participants].sort((a, b) => a.localeCompare(b))) {
    const p = places.get(pid);
    if (p !== undefined) {
      out.push({ place: p, playerId: pid });
    } else {
      out.push({ place: next++, playerId: pid });
    }
  }
  out.sort((a, b) => a.place - b.place || a.playerId.localeCompare(b.playerId));
  return out;
}

export function scheduleRound(tournament: Tournament, tableIds: string[], round: number): Tournament {
  const matches = tournament.bracketMatches.filter((m) => m.round === round).sort(compareBracketMatchId);
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

