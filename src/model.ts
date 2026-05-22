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

export type MatchStatus = 'scheduled' | 'in-progress' | 'finished' | 'forfeit' | 'eliminated';

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
  /** Set by legacy `scheduleRound` batch assignment; omitted for live table use. */
  round?: number;
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

export type HandicapSystem = 'numerical' | 'classification';
export type HandicapStartingCriteria = 'headstart' | 'minus_points';

/** Per-tournament handicap rules (v1: numerical only; classification is reserved). */
export interface HandicapConfig {
  system: HandicapSystem;
  /** Inclusive player handicap rating bounds (numerical system). */
  minValue: number;
  maxValue: number;
  /** How handicap difference maps to game-one start (product detail TBD). */
  startingCriteria: HandicapStartingCriteria;
  /** Max absolute headstart or negative start applied from the handicap gap. */
  maxStartAdjustment: number;
}

export const DEFAULT_NUMERICAL_HANDICAP_CONFIG: HandicapConfig = {
  system: 'numerical',
  minValue: 0,
  maxValue: 9,
  startingCriteria: 'headstart',
  maxStartAdjustment: 7,
};

export function isHandicapActive(tournament: Tournament): boolean {
  return Boolean(tournament.handicapConfig);
}

export function normalizeHandicapConfig(raw: Partial<HandicapConfig> | null | undefined): HandicapConfig | undefined {
  if (!raw) return undefined;
  const system: HandicapSystem = raw.system === 'classification' ? 'classification' : 'numerical';
  const minValue = Math.max(0, Math.floor(Number(raw.minValue ?? DEFAULT_NUMERICAL_HANDICAP_CONFIG.minValue)));
  const maxValue = Math.max(0, Math.floor(Number(raw.maxValue ?? DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxValue)));
  const lo = Math.min(minValue, maxValue);
  const hi = Math.max(minValue, maxValue);
  const startingCriteria: HandicapStartingCriteria =
    raw.startingCriteria === 'minus_points' ? 'minus_points' : 'headstart';
  const maxStartAdjustment = Math.max(
    0,
    Math.floor(Number(raw.maxStartAdjustment ?? DEFAULT_NUMERICAL_HANDICAP_CONFIG.maxStartAdjustment)),
  );
  return {
    system,
    minValue: lo,
    maxValue: hi,
    startingCriteria,
    maxStartAdjustment,
  };
}

export function handicapValueBounds(config: HandicapConfig): { min: number; max: number } {
  return { min: Math.min(config.minValue, config.maxValue), max: Math.max(config.minValue, config.maxValue) };
}

export function clampPlayerHandicapValue(config: HandicapConfig, value: number): number {
  const { min, max } = handicapValueBounds(config);
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function randomPlayerHandicapValue(config: HandicapConfig, rng: () => number = Math.random): number {
  const { min, max } = handicapValueBounds(config);
  const span = max - min + 1;
  return min + Math.floor(rng() * span);
}

export function validatePlayerHandicapForTournament(tournament: Tournament, handicap: number): string | undefined {
  const config = tournament.handicapConfig;
  if (!config) return undefined;
  if (config.system === 'classification') {
    return 'Classification handicaps are not implemented yet';
  }
  const next = clampPlayerHandicapValue(config, handicap);
  if (!Number.isFinite(handicap) || Math.floor(handicap) !== next) {
    const { min, max } = handicapValueBounds(config);
    return `Handicap must be an integer from ${min} to ${max}`;
  }
  return undefined;
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
  /** Physical tables at the venue (e.g. "1", "2", …). */
  tables: string[];
  /** Live and legacy assignments of matches to tables. */
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
  /** When set, player handicaps are tracked and validated for this tournament. */
  handicapConfig?: HandicapConfig;
}

export function createTournament(): Tournament {
  return {
    players: {},
    teams: {},
    matches: {},
    teamMatches: {},
    bracketMatches: [],
    tables: [],
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
 * Partition N players into `floor(N / S)` groups (minimum 1), sizes differing by at most one
 * (first groups get the extra player when remainder). Used for “target group size” in the UI.
 */
export function partitionPlayerCountIntoGroupSizes(playerCount: number, targetSize: number): number[] {
  if (playerCount <= 0) return [];
  const S = Math.max(1, Math.floor(targetSize));
  if (S === 1) return Array.from({ length: playerCount }, () => 1);
  const g = Math.max(1, Math.floor(playerCount / S));
  return partitionPlayerCountIntoGroupCount(playerCount, g);
}

/** Players per group for closed-form bracket layouts (2×4, 4×4, 8×4, 16×4). */
export const CLOSED_FORM_PLAYERS_PER_GROUP = 4;

const CLOSED_FORM_GROUP_COUNT_OPTIONS = [2, 4, 8, 16] as const;

/** Smallest supported closed-form group count (2, 4, 8, or 16) that fits `ceil(playerCount / 4)`. */
export function closedFormGroupCountForPlayerCount(playerCount: number): number {
  const n = Math.max(0, Math.floor(playerCount));
  if (n === 0) return CLOSED_FORM_GROUP_COUNT_OPTIONS[0];
  const need = Math.ceil(n / CLOSED_FORM_PLAYERS_PER_GROUP);
  for (const g of CLOSED_FORM_GROUP_COUNT_OPTIONS) {
    if (g >= need) return g;
  }
  return CLOSED_FORM_GROUP_COUNT_OPTIONS[CLOSED_FORM_GROUP_COUNT_OPTIONS.length - 1];
}

/** Split `playerCount` across `groupCount` consecutive groups (first groups get +1 when remainder). */
export function partitionPlayerCountIntoGroupCount(playerCount: number, groupCount: number): number[] {
  const n = Math.max(0, Math.floor(playerCount));
  const G = Math.max(1, Math.floor(groupCount));
  if (n === 0) return [];
  const q = Math.floor(n / G);
  const r = n % G;
  const sizes: number[] = [];
  for (let i = 0; i < G; i++) sizes.push(q + (i < r ? 1 : 0));
  return sizes.filter((sz) => sz > 0);
}

/** Build groups with ids "1", "2", … and labels {@link groupNumberedTitle}-compatible (`Group 1`, …), in order, splitting `playerIds` by {@link partitionPlayerCountIntoGroupSizes}. */
export function buildNumberedGroupsFromPlayerOrder(playerIds: PlayerId[], targetSize: number): GroupDefinition[] {
  const ids = [...playerIds].filter(Boolean);
  const n = ids.length;
  if (n === 0) return [];
  const sizes = partitionPlayerCountIntoGroupSizes(n, targetSize);
  return buildNumberedGroupsFromSizes(ids, sizes);
}

/** Build groups from seeding order and a fixed target number of groups. */
export function buildNumberedGroupsFromPlayerOrderByGroupCount(
  playerIds: PlayerId[],
  targetGroupCount: number,
): GroupDefinition[] {
  const ids = [...playerIds].filter(Boolean);
  const n = ids.length;
  if (n === 0) return [];
  const sizes = partitionPlayerCountIntoGroupCount(n, targetGroupCount);
  return buildNumberedGroupsFromSizes(ids, sizes);
}

function buildNumberedGroupsFromSizes(ids: PlayerId[], sizes: number[]): GroupDefinition[] {
  const out: GroupDefinition[] = [];
  let offset = 0;
  for (let gi = 0; gi < sizes.length; gi++) {
    const sz = sizes[gi]!;
    const chunk = ids.slice(offset, offset + sz);
    offset += sz;
    const num = String(gi + 1);
    out.push({ id: num, label: `Group ${num}`, playerIds: chunk });
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

/**
 * Drop knockout bracket structure and all derived bracket state (player match rows without
 * `groupId`, bracket table assignments, bracket-phase forfeits). Group phase is unchanged.
 */
export function clearBracketFromTournament(tournament: Tournament, classId?: string): string | undefined {
  if (classId && !tournament.classTournaments[classId]) {
    return 'Unknown class id.';
  }
  if (tournamentUsesClassTabs(tournament) && classId === undefined) {
    return 'Clear the bracket from each class track when multiple competition classes are defined.';
  }

  const slice = classId ? tournament.classTournaments[classId]! : undefined;
  const bracketMatches = slice?.bracketMatches ?? tournament.bracketMatches;
  if (bracketMatches.length === 0) {
    return 'No knockout bracket to remove.';
  }

  const matchIdsToRemove = new Set<string>();
  for (const bm of bracketMatches) {
    matchIdsToRemove.add(bracketPlayerMatchId(bm.id));
  }
  for (const [id, m] of Object.entries(tournament.matches)) {
    if (!m.groupId) {
      matchIdsToRemove.add(id);
    }
  }

  for (const id of matchIdsToRemove) {
    delete tournament.matches[id];
  }
  tournament.tableAssignments = tournament.tableAssignments.filter((a) => !matchIdsToRemove.has(a.matchId));

  for (const [pid, entry] of Object.entries(tournament.forfeits.players)) {
    if (entry.phase === 'bracket') {
      delete tournament.forfeits.players[pid];
    }
  }

  if (slice) {
    slice.bracketMatches = [];
    slice.lockedBracketRounds = [];
  } else {
    tournament.bracketMatches = [];
    tournament.lockedBracketRounds = [];
  }

  return undefined;
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
  if (match.status === 'forfeit' || match.status === 'eliminated') return match.winner;
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
 * Internal {@link BracketMatch.winner} value when both sides are empty / BYE (no real {@link PlayerId}).
 * Counts as “decided” for materializing the next round; maps to an empty seed via {@link bracketWinnerToNextRoundSeed}.
 */
export const BRACKET_STRUCTURAL_EMPTY_ADVANCE = '__bracket_structural_empty__';

export function isBracketStructuralEmptyAdvanceWinner(w: string | undefined): boolean {
  return w === BRACKET_STRUCTURAL_EMPTY_ADVANCE;
}

/** One real seed vs an empty slot (`--empty--` in the UI); not a structural placeholder row. */
export function isBracketByeWalkoverMatch(m: BracketMatch): boolean {
  if (m.id.startsWith('__ph-')) return false;
  return Boolean(m.seedA) !== Boolean(m.seedB);
}

/** Maps a feeder match’s `winner` into the next round’s seed field (`undefined` = empty / bye slot). */
export function bracketWinnerToNextRoundSeed(w: string | undefined): string | undefined {
  if (w === undefined) return undefined;
  if (isBracketStructuralEmptyAdvanceWinner(w)) return undefined;
  return w;
}

/** Round-(R−1) feeder matches for bracket row `bm` at round R ≥ 2 (same geometry as {@link propagateBracketSeedsFromChildWinners}). */
export function bracketFeederPairForMatchIn(
  bracketMatches: BracketMatch[],
  bm: BracketMatch,
): [BracketMatch | undefined, BracketMatch | undefined] {
  const r = bracketMatchRound(bm);
  if (!Number.isFinite(r) || r <= 1) return [undefined, undefined];
  const prev = bracketMatchesSortedForPairing(bracketMatches, r - 1);
  const cur = bracketMatchesSortedForRound(bracketMatches, r);
  const idx = cur.findIndex((x) => x.id === bm.id);
  if (idx < 0) return [undefined, undefined];
  return [prev[idx * 2], prev[idx * 2 + 1]];
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

/** Numeric bracket round (handles persisted JSON where `round` may be a string). */
export function bracketMatchRound(m: BracketMatch): number {
  const r = Number(m.round);
  return Number.isFinite(r) ? Math.trunc(r) : NaN;
}

/** Bracket leaf count when reintroducing culled players after a top-four closed-form core (power of two). */
export function closedFormCropBracketSlotCount(qualifiedCount: number, culledCount: number): number {
  return nextPowerOfTwo(qualifiedCount + culledCount);
}

/** Single-elimination round (≥1) at which two power-of-two leaf indices first meet. */
export function bracketMeetRoundForLeafIndices(a: number, b: number): number {
  if (a === b) return Infinity;
  const xor = a ^ b;
  if (xor <= 0) return Infinity;
  return Math.floor(Math.log2(xor)) + 1;
}

/** Round that holds the main-draw entry tier (`slotCount / 2` matches), if present. */
export function bracketMainDrawEntryRound(
  bracketMatches: BracketMatch[],
  slotCount: number,
): number | undefined {
  const mainTier = slotCount / 2;
  if (mainTier < 1) return undefined;
  const rounds = [
    ...new Set(
      bracketMatches.map((m) => bracketMatchRound(m)).filter((r) => Number.isFinite(r) && r >= 1),
    ),
  ].sort((a, b) => a - b);
  for (const r of [...rounds].reverse()) {
    const n = bracketMatches.filter((m) => bracketMatchRound(m) === r).length;
    if (n === mainTier) return r;
  }
  return undefined;
}

/** Infers single-elimination bracket leaf slot count from existing rounds (deepest valid tier). */
export function inferBracketSlotCountFromRoundOne(bracketMatches: BracketMatch[]): number | undefined {
  const rounds = [
    ...new Set(
      bracketMatches.map((m) => bracketMatchRound(m)).filter((r) => Number.isFinite(r) && r >= 1),
    ),
  ].sort((a, b) => a - b);

  let best: number | undefined;
  for (const r of rounds) {
    const n = bracketMatches.filter((m) => bracketMatchRound(m) === r).length;
    const slotCount = n * 2 ** r;
    if (n < 1 || slotCount < 2 || (slotCount & (slotCount - 1)) !== 0) continue;
    if (best === undefined || slotCount > best) best = slotCount;
  }
  return best;
}

function bracketRoundAggregatesFromExistingOnly(
  bracketMatches: BracketMatch[],
): Array<{ round: number; total: number; done: number }> {
  const byRound = new Map<number, BracketMatch[]>();
  for (const bm of bracketMatches) {
    const r = bracketMatchRound(bm);
    if (!Number.isFinite(r) || r < 0) continue;
    const list = byRound.get(r) ?? [];
    list.push(bm);
    byRound.set(r, list);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  return rounds.map((round) => {
    const list = (byRound.get(round) ?? []).sort(compareBracketMatchId);
    return { round, total: list.length, done: list.filter((bm) => Boolean(bm.winner)).length };
  });
}

/**
 * Per-round progress for a single-elimination bracket, including later rounds that are not yet
 * present in `bracketMatches` (shown as 0% until {@link advanceBracketRound} materializes them).
 * Falls back to rounds that exist in the array only when round 1 cannot be interpreted (e.g. empty).
 */
export function bracketRoundAggregatesIncludingFutureRounds(
  bracketMatches: BracketMatch[],
): Array<{ round: number; total: number; done: number }> {
  const slotCount = inferBracketSlotCountFromRoundOne(bracketMatches);
  if (slotCount === undefined) {
    return bracketRoundAggregatesFromExistingOnly(bracketMatches);
  }
  const numRounds = Math.log2(slotCount);
  if (!Number.isInteger(numRounds) || numRounds < 1) {
    return bracketRoundAggregatesFromExistingOnly(bracketMatches);
  }
  const rows: Array<{ round: number; total: number; done: number }> = [];
  for (let round = 1; round <= numRounds; round++) {
    const expected = slotCount >>> round;
    const list = bracketMatches.filter((m) => bracketMatchRound(m) === round).sort(compareBracketMatchId);
    const total = Math.max(expected, list.length);
    const done = list.filter((bm) => Boolean(bm.winner)).length;
    rows.push({ round, total, done });
  }
  return rows;
}

/** Total/done bracket slots across all rounds, including not-yet-created later rounds. */
export function bracketPhaseCountsIncludingFutureRounds(bracketMatches: BracketMatch[]): { total: number; done: number } {
  const rows = bracketRoundAggregatesIncludingFutureRounds(bracketMatches);
  let total = 0;
  let done = 0;
  for (const r of rows) {
    total += r.total;
    done += r.done;
  }
  return { total, done };
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

/**
 * User-facing group title: normalize legacy `group N` labels to `Group N`; use any other non-empty
 * label as-is (e.g. `Pool A` even when `id` is numeric); otherwise derive `Group N` from a numeric
 * id, else fall back to the trimmed id.
 */
export function groupNumberedTitle(g: GroupDefinition): string {
  const idTrim = g.id.trim();
  const lab = g.label?.trim();
  if (lab) {
    const mNum = /^group\s*(\d+)$/i.exec(lab);
    if (mNum) return `Group ${mNum[1]}`;
    return lab;
  }
  const asNum = Number(idTrim);
  if (Number.isInteger(asNum) && asNum >= 0 && String(asNum) === idTrim) {
    return `Group ${asNum}`;
  }
  return idTrim;
}

/** Label shown in lists (group headings, overview, bracket placeholders). */
export function displayLabelForGroup(g: GroupDefinition): string {
  return groupNumberedTitle(g);
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

function sortGroupDefinitionsStable(groups: Record<string, GroupDefinition>): GroupDefinition[] {
  return Object.values(groups).sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a.id && String(nb) === b.id) {
      return na - nb;
    }
    return a.id.localeCompare(b.id);
  });
}

/** Prefix for synthetic “empty” players used only while computing group-balanced bracket layouts. */
export const BRACKET_LAYOUT_DUMMY_PREFIX = '--empty--#';

export function isBracketLayoutDummyPid(pid: PlayerId): boolean {
  return pid.startsWith(BRACKET_LAYOUT_DUMMY_PREFIX);
}

function bracketLayoutDummyPadPid(groupId: string, place: number): PlayerId {
  return `${BRACKET_LAYOUT_DUMMY_PREFIX}pad:${groupId}:${place}`;
}

function bracketLayoutDummyFullPid(groupIndex: number, place: number): PlayerId {
  return `${BRACKET_LAYOUT_DUMMY_PREFIX}full:${groupIndex}:${place}`;
}

const BALANCED_LAYOUT_S = 4;
const BALANCED_LAYOUT_G_OPTIONS = [2, 4, 8, 16] as const;

/**
 * Smallest supported **G × 4** grid (G ∈ {2,4,8,16}) that fits all real groups and has enough slots for every
 * real player. Used to pad with dummy rows and dummy groups for {@link orderParticipantsForGroupBalancedBracket}.
 */
export function balancedBracketVirtualGridTarget(G: number, S: number): { G_tgt: number; S_tgt: number } | null {
  if (S < 2 || S > BALANCED_LAYOUT_S || G < 1 || G > 16) return null;
  for (const G_tgt of BALANCED_LAYOUT_G_OPTIONS) {
    if (G_tgt < G) continue;
    if (G_tgt * BALANCED_LAYOUT_S < G * S) continue;
    return { G_tgt, S_tgt: BALANCED_LAYOUT_S };
  }
  return null;
}

/** Equal-sized group grid for the given bracket scope, or `null` if groups are missing or uneven. */
export function equalSizedGroupBracketMeta(tournament: Tournament, classId: string | undefined): { G: number; S: number } | null {
  const scope = bracketGroupLayoutScopeFromGroupsOnly(tournament, classId);
  if (!scope || !scope.equalSized) return null;
  return { G: scope.G, S: scope.maxGroupSize };
}

export type BracketGroupLayoutScope = {
  G: number;
  /** Largest group; equals uniform group size when {@link BracketGroupLayoutScope.equalSized}. */
  maxGroupSize: number;
  minGroupSize: number;
  equalSized: boolean;
  playerCount: number;
};

function bracketGroupLayoutScopeFromGroupsOnly(
  tournament: Tournament,
  classId: string | undefined,
): BracketGroupLayoutScope | null {
  const groups = sortGroupDefinitionsStable(groupRecordForBracketScope(tournament, classId));
  if (groups.length === 0) return null;
  const sizes = groups.map((g) => g.playerIds.length);
  const minGroupSize = Math.min(...sizes);
  const maxGroupSize = Math.max(...sizes);
  if (minGroupSize < 2) return null;
  return {
    G: groups.length,
    maxGroupSize,
    minGroupSize,
    equalSized: sizes.every((sz) => sz === sizes[0]),
    playerCount: sizes.reduce((sum, sz) => sum + sz, 0),
  };
}

/**
 * Group grid metadata when `participantIds` is exactly the union of all group members (typical seedings).
 */
export function bracketGroupLayoutScope(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
): BracketGroupLayoutScope | null {
  const scope = bracketGroupLayoutScopeFromGroupsOnly(tournament, classId);
  if (!scope) return null;

  const pset = new Set(participantIds);
  if (pset.size !== participantIds.length) return null;

  const groups = sortGroupDefinitionsStable(groupRecordForBracketScope(tournament, classId));
  const union = new Set<PlayerId>();
  for (const g of groups) {
    for (const pid of g.playerIds) union.add(pid);
  }
  if (scope.playerCount !== participantIds.length || union.size !== participantIds.length) return null;
  if (![...union].every((id) => pset.has(id))) return null;
  for (const pid of participantIds) {
    if (!findGroupForPlayer(tournament, pid, classId)) return null;
  }
  return scope;
}

/** Virtual closed layout without adding dummy groups (only pads places within existing groups). */
export function supportsExtendedClosedFormBracketSeeding(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
): boolean {
  const scope = bracketGroupLayoutScope(tournament, participantIds, classId);
  if (!scope) return false;
  const grid = balancedBracketVirtualGridTarget(scope.G, scope.maxGroupSize);
  return Boolean(grid && grid.G_tgt === scope.G);
}

/** True when **G×S** exactly matches a built-in closed layout (2×4, 4×4, 8×4, or 16×4). */
export function isExactClosedFormBracketGrid(G: number, S: number): boolean {
  const grid = balancedBracketVirtualGridTarget(G, S);
  return Boolean(grid && grid.G_tgt === G && grid.S_tgt === S);
}

/** True when a virtual padded closed layout exists for this **G×S** (see {@link balancedBracketVirtualGridTarget}). */
export function supportsExtendedClosedFormBracketGrid(G: number, S: number): boolean {
  return balancedBracketVirtualGridTarget(G, S) !== null;
}

/**
 * Default UI seeding mode for an equal-sized **G×S** group grid: exact closed layout, virtual padding within
 * the same group count only, or heuristic when virtual padding would add dummy groups.
 */
export function defaultBracketSeedingMode(G: number, S: number): BracketSeedingMode {
  if (isExactClosedFormBracketGrid(G, S)) return 'closed_form';
  const grid = balancedBracketVirtualGridTarget(G, S);
  if (grid && grid.G_tgt === G) return 'extend_closed_form';
  return 'heuristic';
}

export function defaultBracketSeedingModeFromMeta(meta: { G: number; S: number } | null): BracketSeedingMode {
  if (!meta) return 'heuristic';
  return defaultBracketSeedingMode(meta.G, meta.S);
}

/** Like {@link defaultBracketSeedingModeFromMeta} but also enables closed-form when top-four culling applies. */
export function defaultBracketSeedingModeForTournament(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
): BracketSeedingMode {
  const closedKind = resolveClosedFormBracketSeedingKind(tournament, participantIds, classId);
  if (closedKind) return 'crop_closed_form';
  if (supportsExtendedClosedFormBracketSeeding(tournament, participantIds, classId)) {
    return 'extend_closed_form';
  }
  const meta = equalSizedGroupBracketMeta(tournament, classId);
  return defaultBracketSeedingModeFromMeta(meta);
}

function mapLayoutDummiesToBye(ids: readonly PlayerId[]): PlayerId[] {
  return ids.map((pid) => (isBracketLayoutDummyPid(pid) ? 'BYE' : pid));
}

/** Pre-{@link seedPositions} slot order: `(groupIndex, 1-based place)` for exact **2×4**. */
const CLOSED_FORM_LAYOUT_2X4: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 1],
  [1, 3],
  [0, 3],
  [1, 2],
  [0, 2],
  [0, 4],
  [1, 4],
];

/** Pre-{@link seedPositions} slot order for exact **4×4**. */
const CLOSED_FORM_LAYOUT_4X4: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [3, 1],
  [1, 1],
  [2, 1],
  [3, 2],
  [0, 2],
  [2, 2],
  [1, 2],
  [2, 3],
  [0, 3],
  [3, 3],
  [1, 3],
  [0, 4],
  [2, 4],
  [1, 4],
  [3, 4],
];

/** Pre-{@link seedPositions} slot order for exact **8×4** (groups 0–7). */
const CLOSED_FORM_LAYOUT_8X4: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [3, 1],
  [1, 1],
  [2, 1],
  [0, 4],
  [2, 4],
  [1, 4],
  [3, 4],
  [2, 3],
  [0, 3],
  [3, 3],
  [1, 3],
  [3, 2],
  [0, 2],
  [2, 2],
  [1, 2],
  [6, 3],
  [4, 3],
  [7, 3],
  [5, 3],
  [7, 2],
  [4, 2],
  [6, 2],
  [5, 2],
  [4, 1],
  [7, 1],
  [5, 1],
  [6, 1],
  [4, 4],
  [6, 4],
  [5, 4],
  [7, 4],
];

/** Pre-{@link seedPositions} slot order for exact **16×4** (sorted group index 0–15). */
const CLOSED_FORM_LAYOUT_16X4: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [3, 1],
  [1, 1],
  [2, 1],
  [0, 4],
  [2, 4],
  [1, 4],
  [3, 4],
  [6, 3],
  [4, 3],
  [7, 3],
  [5, 3],
  [4, 4],
  [6, 4],
  [5, 4],
  [7, 4],
  [2, 3],
  [0, 3],
  [3, 3],
  [1, 3],
  [7, 2],
  [4, 2],
  [6, 2],
  [5, 2],
  [4, 1],
  [7, 1],
  [5, 1],
  [6, 1],
  [3, 2],
  [0, 2],
  [2, 2],
  [1, 2],
  [14, 3],
  [12, 3],
  [15, 3],
  [13, 3],
  [8, 4],
  [10, 4],
  [9, 4],
  [11, 4],
  [10, 3],
  [8, 3],
  [11, 3],
  [9, 3],
  [15, 2],
  [12, 2],
  [14, 2],
  [13, 2],
  [8, 1],
  [11, 1],
  [9, 1],
  [10, 1],
  [11, 2],
  [8, 2],
  [10, 2],
  [9, 2],
  [12, 1],
  [15, 1],
  [13, 1],
  [14, 1],
  [12, 4],
  [14, 4],
  [13, 4],
  [15, 4],
];

function closedFormLayoutFor(G_tgt: number): ReadonlyArray<readonly [number, number]> | null {
  switch (G_tgt) {
    case 2:
      return CLOSED_FORM_LAYOUT_2X4;
    case 4:
      return CLOSED_FORM_LAYOUT_4X4;
    case 8:
      return CLOSED_FORM_LAYOUT_8X4;
    case 16:
      return CLOSED_FORM_LAYOUT_16X4;
    default:
      return null;
  }
}

function balancedOrderFromPidFor(
  G_tgt: number,
  pidFor: (gi: number, place: number) => PlayerId,
): PlayerId[] {
  const layout = closedFormLayoutFor(G_tgt);
  if (!layout) {
    throw new Error(`balancedOrderFromPidFor: unsupported G_tgt=${G_tgt}`);
  }
  return layout.map(([gi, pl]) => pidFor(gi, pl));
}

/**
 * Reorders bracket `participants` (before {@link seedPositions}) so that, for a regular **G × S** field
 * (G equal-sized groups, S players each, G·S = N), group winners and same-group players are spread across
 * the single-elimination tree: winners meet as late as possible, same-group players are separated, and
 * round‑1 pairs prefer **winner vs loser from different groups** when a closed layout exists.
 *
 * Built-in layouts: **2×4**, **4×4**, **8×4**, and **16×4** (hardcoded pre-{@link seedPositions} slot tables).
 *
 * When **G × S** is not exactly one of those shapes but still fits **S ≤ 4**, **G ≤ 16**, and **G·S ≤ 64**,
 * the function conceptually pads each real group with synthetic `--empty--#…` players (last places) and
 * appends all-dummy groups until the field matches the smallest applicable virtual **G′ × 4** grid
 * ({@link balancedBracketVirtualGridTarget}); those dummies are returned as **`BYE`** so {@link generateBracket}
 * builds the same tree shape without exposing the placeholders.
 *
 * Returns `null` when no layout applies (caller may shuffle instead).
 */
export function orderParticipantsForGroupBalancedBracket(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
  layoutMode: 'exact' | 'virtual' = 'virtual',
): PlayerId[] | null {
  const groupsRecord = groupRecordForBracketScope(tournament, classId);
  const groups = sortGroupDefinitionsStable(groupsRecord);
  if (groups.length === 0) return null;

  const scope = bracketGroupLayoutScope(tournament, participantIds, classId);
  if (!scope) return null;
  const { G, maxGroupSize } = scope;
  const equalSized = scope.equalSized;
  const S = maxGroupSize;

  const grid = balancedBracketVirtualGridTarget(G, S);
  if (!grid) return null;
  const { G_tgt, S_tgt } = grid;

  const pidForReal = (gi: number, place: number): PlayerId => {
    const g = groups[gi]!;
    const rows = groupStandingsRowsForBracket(tournament, g, classId);
    const row = rows[place - 1];
    if (!row) {
      throw new Error(`Group ${g.id} has no standing row for place ${place}`);
    }
    return row.pid;
  };

  /** Virtual **G_tgt × S_tgt** grid: real groups first (padded to `S_tgt`), then all-dummy groups. */
  const pidForVirtual = (gi: number, place: number): PlayerId => {
    if (gi < G) {
      const groupSize = groups[gi]!.playerIds.length;
      if (place <= groupSize) return pidForReal(gi, place);
      if (place <= S_tgt) return bracketLayoutDummyPadPid(groups[gi]!.id, place);
      throw new Error(`place ${place} out of range for padded group`);
    }
    if (gi < G_tgt && place <= S_tgt) {
      return bracketLayoutDummyFullPid(gi, place);
    }
    throw new Error(`virtual group index ${gi} or place ${place} out of range`);
  };

  if (G === G_tgt && equalSized && S === S_tgt) {
    return balancedOrderFromPidFor(G_tgt, pidForReal);
  }
  if (layoutMode === 'exact') return null;
  return mapLayoutDummiesToBye(balancedOrderFromPidFor(G_tgt, pidForVirtual));
}

/**
 * Closed-form order for exactly the top four per group (G×4).
 * `participantIds` must be precisely those qualifiers (see {@link splitParticipantsTopFourPerGroup}).
 */
export function orderTopFourPerGroupForClosedFormBracket(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
): PlayerId[] | null {
  const groups = sortGroupDefinitionsStable(groupRecordForBracketScope(tournament, classId));
  if (groups.length === 0) return null;

  const G = groups.length;
  const S = CLOSED_FORM_PLAYERS_PER_GROUP;
  if (!isExactClosedFormBracketGrid(G, S)) return null;
  if (participantIds.length !== G * S) return null;

  const pset = new Set(participantIds);
  if (pset.size !== participantIds.length) return null;

  for (const g of groups) {
    const rows = groupStandingsRowsForBracket(tournament, g, classId);
    if (rows.length < S) return null;
    for (let place = 1; place <= S; place++) {
      if (!pset.has(rows[place - 1]!.pid)) return null;
    }
  }

  const pidForReal = (gi: number, place: number): PlayerId => {
    const g = groups[gi]!;
    const rows = groupStandingsRowsForBracket(tournament, g, classId);
    return rows[place - 1]!.pid;
  };

  return balancedOrderFromPidFor(G, pidForReal);
}

type CropClosedFormPlayerMeta = { groupIndex: number; place: number };

function cropClosedFormPlayerMeta(
  tournament: Tournament,
  groups: readonly GroupDefinition[],
  classId: string | undefined,
): Map<PlayerId, CropClosedFormPlayerMeta> {
  const meta = new Map<PlayerId, CropClosedFormPlayerMeta>();
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    const rows = groupStandingsRowsForBracket(tournament, g, classId);
    for (let i = 0; i < rows.length; i++) {
      meta.set(rows[i]!.pid, { groupIndex: gi, place: i + 1 });
    }
  }
  return meta;
}

function applySeedPositionsToLeafOrder(participants: readonly PlayerId[], slotCount: number): PlayerId[] {
  const sp = seedPositions(slotCount);
  return sp.map((seedIndex) => participants[seedIndex - 1] ?? 'BYE');
}

function earliestSameGroupMeetRoundForCropPlacement(
  culledGroup: number,
  culledLeaf: number,
  leaves: readonly PlayerId[],
  meta: ReadonlyMap<PlayerId, CropClosedFormPlayerMeta>,
): number {
  let earliest = Infinity;
  for (let other = 0; other < leaves.length; other++) {
    const pid = leaves[other]!;
    if (pid === 'BYE') continue;
    const m = meta.get(pid);
    if (!m || m.groupIndex !== culledGroup) continue;
    earliest = Math.min(earliest, bracketMeetRoundForLeafIndices(culledLeaf, other));
  }
  return earliest;
}

/**
 * Closed-form seeding for groups larger than four: top four per group use the built-in **G×4** layout,
 * the draw is extended by one round (each qualifier vs **BYE**), then culled players replace **BYE** slots
 * (worst culled first; opponent = lowest-ranked remaining qualifier with a bye; ties maximize rounds until
 * a same-group meeting).
 */
export function orderParticipantsForCropClosedFormBracket(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
): PlayerId[] | null {
  if (!resolveClosedFormBracketSeedingKind(tournament, participantIds, classId)) {
    return null;
  }

  const split = splitParticipantsTopFourPerGroup(tournament, participantIds, classId);
  if (!split) return null;

  const baseOrder = orderTopFourPerGroupForClosedFormBracket(tournament, split.qualified, classId);
  if (!baseOrder) return null;

  if (split.culled.length === 0) {
    return baseOrder;
  }

  const groups = sortGroupDefinitionsStable(groupRecordForBracketScope(tournament, classId));
  const meta = cropClosedFormPlayerMeta(tournament, groups, classId);
  const Q = split.qualified.length;
  const slotCount = closedFormCropBracketSlotCount(Q, split.culled.length);

  const innerSeeded = applySeedPositionsToLeafOrder(baseOrder, Q);
  const leaves: PlayerId[] = Array.from({ length: slotCount }, () => 'BYE');
  for (let i = 0; i < Q; i++) {
    leaves[2 * i] = innerSeeded[i]!;
    leaves[2 * i + 1] = 'BYE';
  }

  const culledSorted = [...split.culled].sort((a, b) => {
    const ma = meta.get(a)!;
    const mb = meta.get(b)!;
    return mb.place - ma.place || ma.groupIndex - mb.groupIndex || a.localeCompare(b);
  });

  for (const culledPid of culledSorted) {
    const culledGroup = meta.get(culledPid)!.groupIndex;

    let bestByeLeaf = -1;
    let bestOpponentPlace = -1;
    let bestDelay = -1;

    for (let leaf = 0; leaf < slotCount; leaf += 2) {
      const a = leaves[leaf]!;
      const b = leaves[leaf + 1]!;
      let opponent: PlayerId | undefined;
      let byeLeaf: number;
      if (a !== 'BYE' && b === 'BYE') {
        opponent = a;
        byeLeaf = leaf + 1;
      } else if (b !== 'BYE' && a === 'BYE') {
        opponent = b;
        byeLeaf = leaf;
      } else {
        continue;
      }

      const oppPlace = meta.get(opponent)!.place;
      const delay = earliestSameGroupMeetRoundForCropPlacement(culledGroup, byeLeaf, leaves, meta);

      if (
        oppPlace > bestOpponentPlace ||
        (oppPlace === bestOpponentPlace && delay > bestDelay)
      ) {
        bestOpponentPlace = oppPlace;
        bestDelay = delay;
        bestByeLeaf = byeLeaf;
      }
    }

    if (bestByeLeaf < 0) {
      throw new Error('Crop closed-form bracket seeding could not find a BYE slot for a culled player.');
    }
    leaves[bestByeLeaf] = culledPid;
  }

  return leaves;
}

/** Tunable bipartition penalties for {@link bestEffortOrderParticipantsForGroupBracket}. */
export type BracketBipartitionPenaltyConfig = {
  /** Per existing set member from the same group as the candidate. */
  sameGroupPenalty: number;
  /**
   * Non-empty set rank term: multiplier × (max in-group rank − |candidate rank − average set rank|).
   */
  rankSpreadMultiplier: number;
  /** Per existing set member with the same in-group rank as the candidate (non-empty sets only). */
  sameRankPenalty: number;
};

export const DEFAULT_BRACKET_BIPARTITION_PENALTIES: BracketBipartitionPenaltyConfig = {
  sameGroupPenalty: 10,
  rankSpreadMultiplier: 2.5,
  sameRankPenalty: 0.5,
};

type BracketPartitionEntry = {
  pid: PlayerId;
  groupIndex: number;
  /** 1-based in-group rank (1 = best). */
  place: number;
};

function maxGroupRankByGroupIndex(entries: readonly BracketPartitionEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of entries) {
    const prev = out.get(e.groupIndex);
    if (prev === undefined || e.place > prev) out.set(e.groupIndex, e.place);
  }
  return out;
}

/** Penalty a bipartition set assigns to placing {@link entry} alongside its current members. */
function bracketSetPenaltyForPlayer(
  set: readonly BracketPartitionEntry[],
  entry: BracketPartitionEntry,
  maxPlaceByGroup: ReadonlyMap<number, number>,
  cfg: BracketBipartitionPenaltyConfig,
): number {
  let penalty = 0;
  for (const other of set) {
    if (other.groupIndex === entry.groupIndex) {
      penalty += cfg.sameGroupPenalty;
    }
  }
  const maxGroupRank = maxPlaceByGroup.get(entry.groupIndex) ?? entry.place;
  if (set.length === 0) {
    penalty += entry.place;
  } else {
    for (const other of set) {
      if (other.place === entry.place) {
        penalty += cfg.sameRankPenalty;
      }
    }
    const avgRank = set.reduce((sum, other) => sum + other.place, 0) / set.length;
    penalty += cfg.rankSpreadMultiplier * (maxGroupRank - Math.abs(entry.place - avgRank));
  }
  return penalty;
}

function sortBracketPartitionEntries(
  entries: readonly BracketPartitionEntry[],
): BracketPartitionEntry[] {
  return [...entries].sort(
    (a, b) => a.place - b.place || a.groupIndex - b.groupIndex || a.pid.localeCompare(b.pid),
  );
}

function crossGroupPairCountInBracketSets(
  setA: readonly BracketPartitionEntry[],
  setB: readonly BracketPartitionEntry[],
): number {
  let n = 0;
  if (setA.length === 2 && setA[0]!.groupIndex !== setA[1]!.groupIndex) n++;
  if (setB.length === 2 && setB[0]!.groupIndex !== setB[1]!.groupIndex) n++;
  return n;
}

/** 4 → best+worst | middle pair; when ranks tie, prefer splits where both pairs are cross-group. */
function bipartitionFourBracketPlayers(
  sorted: readonly BracketPartitionEntry[],
): [BracketPartitionEntry[], BracketPartitionEntry[]] {
  const minPlace = sorted[0]!.place;
  const maxPlace = sorted[3]!.place;
  const highs = sorted.filter((e) => e.place === minPlace);
  const lows = sorted.filter((e) => e.place === maxPlace);

  let best: [BracketPartitionEntry[], BracketPartitionEntry[]] | undefined;
  let bestCross = -1;

  for (const h of highs) {
    for (const l of [...lows].reverse()) {
      if (h.pid === l.pid) continue;
      const setA = [h, l];
      const setB = sorted.filter((e) => e.pid !== h.pid && e.pid !== l.pid);
      if (setB.length !== 2) continue;
      const cross = crossGroupPairCountInBracketSets(setA, setB);
      if (cross > bestCross) {
        bestCross = cross;
        best = [setA, setB];
      }
    }
  }

  return best ?? [[sorted[0]!, sorted[3]!], [sorted[1]!, sorted[2]!]];
}

/**
 * Greedy bipartition by alternating draft picks: A chooses the lowest-penalty unassigned player for
 * itself, then B, then A, … Subset sizes differ by at most one (`ceil(n/2)` vs `floor(n/2)`).
 * Tie-break among equal pick costs: earlier in rank / group / pid sort order.
 *
 * Fixed splits for small inputs (by in-group rank, best first): 3 → 1|2 (best alone); 4 → best+worst|middle pair.
 */
export function bipartitionBracketPlayers(
  entries: readonly BracketPartitionEntry[],
  cfg: BracketBipartitionPenaltyConfig = DEFAULT_BRACKET_BIPARTITION_PENALTIES,
): [BracketPartitionEntry[], BracketPartitionEntry[]] {
  const sorted = sortBracketPartitionEntries(entries);
  if (sorted.length === 3) {
    return [[sorted[0]!], [sorted[1]!, sorted[2]!]];
  }
  if (sorted.length === 4) {
    return bipartitionFourBracketPlayers(sorted);
  }
  const maxPlaceByGroup = maxGroupRankByGroupIndex(entries);
  const setA: BracketPartitionEntry[] = [];
  const setB: BracketPartitionEntry[] = [];
  const unassigned = new Set<BracketPartitionEntry>(sorted);
  let pickA = true;

  while (unassigned.size > 0) {
    const target = pickA ? setA : setB;
    let best: BracketPartitionEntry | undefined;
    let bestScore = Infinity;
    for (const entry of sorted) {
      if (!unassigned.has(entry)) continue;
      const score = bracketSetPenaltyForPlayer(target, entry, maxPlaceByGroup, cfg);
      if (score < bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    if (!best) break;
    target.push(best);
    unassigned.delete(best);
    pickA = !pickA;
  }
  return [setA, setB];
}

/** Binary partition tree before BYE insertion and power-of-two leaf padding. */
export type BracketPartitionTree =
  | { kind: 'terminal'; entries: BracketPartitionEntry[] }
  | { kind: 'branch'; left: BracketPartitionTree; right: BracketPartitionTree };

export type BracketPartitionTerminal = {
  /** Bipartition depth from the root (0 = stopped at the root). */
  depth: number;
  entries: BracketPartitionEntry[];
};

/** Recursively bipartition until each subset has at most two players (no BYEs yet). */
export function buildBracketPartitionTree(
  entries: readonly BracketPartitionEntry[],
  cfg: BracketBipartitionPenaltyConfig = DEFAULT_BRACKET_BIPARTITION_PENALTIES,
): BracketPartitionTree {
  if (entries.length <= 2) {
    return { kind: 'terminal', entries: [...entries] };
  }
  const [left, right] = bipartitionBracketPlayers(entries, cfg);
  return {
    kind: 'branch',
    left: buildBracketPartitionTree(left, cfg),
    right: buildBracketPartitionTree(right, cfg),
  };
}

/** All terminal subsets with their bipartition depth (pre-BYE, pre-depth equalization). */
export function collectBracketPartitionTerminals(
  node: BracketPartitionTree,
  depth = 0,
): BracketPartitionTerminal[] {
  if (node.kind === 'terminal') {
    return [{ depth, entries: node.entries }];
  }
  return [
    ...collectBracketPartitionTerminals(node.left, depth + 1),
    ...collectBracketPartitionTerminals(node.right, depth + 1),
  ];
}

export function maxBracketPartitionTerminalDepth(terminals: readonly BracketPartitionTerminal[]): number {
  return terminals.reduce((max, t) => Math.max(max, t.depth), 0);
}

/**
 * Any 2-player terminal not at {@link maxBracketPartitionTerminalDepth} becomes two 1-player terminals
 * (sibling leaves under a branch) so every partition path can reach the same depth before BYEs.
 */
export function equalizeBracketPartitionTreeDepths(
  node: BracketPartitionTree,
  depth: number,
  maxDepth: number,
): BracketPartitionTree {
  if (node.kind === 'terminal') {
    if (node.entries.length === 2 && depth < maxDepth) {
      return {
        kind: 'branch',
        left: { kind: 'terminal', entries: [node.entries[0]!] },
        right: { kind: 'terminal', entries: [node.entries[1]!] },
      };
    }
    return node;
  }
  return {
    kind: 'branch',
    left: equalizeBracketPartitionTreeDepths(node.left, depth + 1, maxDepth),
    right: equalizeBracketPartitionTreeDepths(node.right, depth + 1, maxDepth),
  };
}

/** In-order leaf slots: 1-player terminals become `[player, BYE]`; 2-player terminals stay paired. */
export function flattenBracketPartitionTreeToLeafOrder(node: BracketPartitionTree): PlayerId[] {
  if (node.kind === 'terminal') {
    if (node.entries.length === 0) return [];
    if (node.entries.length === 1) {
      return [node.entries[0]!.pid, 'BYE'];
    }
    return node.entries.map((e) => e.pid);
  }
  return [
    ...flattenBracketPartitionTreeToLeafOrder(node.left),
    ...flattenBracketPartitionTreeToLeafOrder(node.right),
  ];
}

/**
 * Heuristic leaf order: bipartition → equalize terminal depths → BYE on 1-player terminals → pad to
 * the next power of two. Round‑1 pairings are adjacent leaves (no {@link seedPositions} remap).
 */
export function buildBracketLeafOrderByBipartition(
  entries: readonly BracketPartitionEntry[],
  cfg: BracketBipartitionPenaltyConfig = DEFAULT_BRACKET_BIPARTITION_PENALTIES,
): PlayerId[] {
  if (entries.length === 0) return [];

  const tree = buildBracketPartitionTree(entries, cfg);
  const terminals = collectBracketPartitionTerminals(tree);
  const maxDepth = maxBracketPartitionTerminalDepth(terminals);
  const equalized = equalizeBracketPartitionTreeDepths(tree, 0, maxDepth);

  let leaves = flattenBracketPartitionTreeToLeafOrder(equalized);
  const slotCount = nextPowerOfTwo(leaves.length);
  while (leaves.length < slotCount) {
    leaves.push('BYE');
  }
  return leaves;
}

/**
 * When no ideal group-balanced layout applies, builds a power-of-two leaf-order list via bipartition
 * (see {@link buildBracketLeafOrderByBipartition}). Returns `null` when group data does not match
 * `participantIds` (same rules as ideal layout: every bracket player must appear in exactly one scoped
 * group and every group member must qualify).
 */
export function bestEffortOrderParticipantsForGroupBracket(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
  _shuffleKey: string,
): PlayerId[] | null {
  const groupsRecord = groupRecordForBracketScope(tournament, classId);
  const groups = sortGroupDefinitionsStable(groupsRecord);
  if (groups.length === 0) return null;

  const P = participantIds.length;
  if (P < 1) return null;

  const pset = new Set(participantIds);
  if (pset.size !== participantIds.length) return null;

  const union = new Set<PlayerId>();
  let sumSizes = 0;
  for (const g of groups) {
    sumSizes += g.playerIds.length;
    for (const pid of g.playerIds) union.add(pid);
  }
  if (sumSizes !== P || union.size !== P || ![...union].every((id) => pset.has(id))) {
    return null;
  }
  for (const pid of participantIds) {
    if (!findGroupForPlayer(tournament, pid, classId)) return null;
  }

  const entries: BracketPartitionEntry[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    const rows = groupStandingsRowsForBracket(tournament, g, classId);
    if (rows.length !== g.playerIds.length) return null;
    for (let place = 1; place <= rows.length; place++) {
      entries.push({ pid: rows[place - 1]!.pid, groupIndex: gi, place });
    }
  }

  return buildBracketLeafOrderByBipartition(entries);
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

export type BracketSeedingMode = 'closed_form' | 'extend_closed_form' | 'crop_closed_form' | 'heuristic';

/** True when `G` is a built-in closed-form group count (2, 4, 8, or 16). */
export function isClosedFormGroupCount(G: number): boolean {
  return (CLOSED_FORM_GROUP_COUNT_OPTIONS as readonly number[]).includes(G);
}

/**
 * Splits qualifiers into top four per group (by standings) and everyone else (excluded from the bracket).
 * Groups may differ in size; each must have at least `topN` players and decided standings.
 */
export function splitParticipantsTopFourPerGroup(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
  topN = CLOSED_FORM_PLAYERS_PER_GROUP,
): { qualified: PlayerId[]; culled: PlayerId[] } | null {
  const groupsRecord = groupRecordForBracketScope(tournament, classId);
  const groups = sortGroupDefinitionsStable(groupsRecord);
  if (groups.length === 0) return null;

  const pset = new Set(participantIds);
  if (pset.size !== participantIds.length) return null;

  const union = new Set<PlayerId>();
  let sumSizes = 0;
  for (const g of groups) {
    if (g.playerIds.length < topN) return null;
    sumSizes += g.playerIds.length;
    for (const pid of g.playerIds) union.add(pid);
  }
  if (sumSizes !== participantIds.length || union.size !== participantIds.length) return null;

  const qualified: PlayerId[] = [];
  const culled: PlayerId[] = [];
  for (const g of groups) {
    const rows = groupStandingsRowsForBracket(tournament, g, classId);
    if (rows.length !== g.playerIds.length) return null;
    for (let i = 0; i < rows.length; i++) {
      const pid = rows[i]!.pid;
      if (!pset.has(pid)) return null;
      if (i < topN) qualified.push(pid);
      else culled.push(pid);
    }
  }
  return { qualified, culled };
}

/**
 * Whether closed-form seeding applies: exact **G×4** grid, or larger groups culled to top four per group.
 * `participantIds` must be exactly the union of all group members in scope (typical tournament seedings).
 */
export function resolveClosedFormBracketSeedingKind(
  tournament: Tournament,
  participantIds: readonly PlayerId[],
  classId: string | undefined,
): 'exact' | 'culled' | null {
  const groups = sortGroupDefinitionsStable(groupRecordForBracketScope(tournament, classId));
  if (groups.length === 0) return null;

  const G = groups.length;
  if (!isClosedFormGroupCount(G) || !isExactClosedFormBracketGrid(G, CLOSED_FORM_PLAYERS_PER_GROUP)) {
    return null;
  }
  if (groups.some((g) => g.playerIds.length < CLOSED_FORM_PLAYERS_PER_GROUP)) return null;

  const pset = new Set(participantIds);
  if (pset.size !== participantIds.length) return null;

  const union = new Set<PlayerId>();
  for (const g of groups) {
    for (const pid of g.playerIds) union.add(pid);
  }
  if (union.size !== participantIds.length || ![...union].every((id) => pset.has(id))) return null;

  for (const pid of participantIds) {
    if (!findGroupForPlayer(tournament, pid, classId)) return null;
  }

  const split = splitParticipantsTopFourPerGroup(tournament, participantIds, classId);
  if (!split || split.qualified.length !== G * CLOSED_FORM_PLAYERS_PER_GROUP) return null;

  const meta = equalSizedGroupBracketMeta(tournament, classId);
  if (
    meta &&
    isExactClosedFormBracketGrid(meta.G, meta.S) &&
    meta.G * meta.S === participantIds.length &&
    split.culled.length === 0
  ) {
    return 'exact';
  }
  return split.culled.length > 0 ? 'culled' : null;
}

/** Round `round` rows in id order (standard pairwise advance geometry). */
export function bracketMatchesSortedForPairing(
  bracketMatches: BracketMatch[],
  round: number,
): BracketMatch[] {
  return bracketMatchesSortedForRound(bracketMatches, round);
}

export type GenerateBracketOptions = {
  fillByes?: boolean;
  cullToPowerOfTwo?: boolean;
  shuffleKey?: string;
  /** When true (with `cullToPowerOfTwo` and `fillByes: false`), cull using group finishing order instead of seed order. */
  cullByGroupPlacement?: boolean;
  /** Scope for group standings when `cullByGroupPlacement` is set. */
  classId?: string;
  /**
   * When a {@link Tournament} is passed into {@link generateBracket}, controls how participants are ordered
   * before single-elimination seeding. Ignored when there is no tournament or no usable group data.
   */
  bracketSeedingMode?: BracketSeedingMode;
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

  let heuristicBipartitionLeafOrder = false;
  let cropClosedFormLeafOrder = false;

  if (tournament) {
    const mode = opts.bracketSeedingMode ?? 'heuristic';
    const beKey = opts.shuffleKey !== undefined ? String(opts.shuffleKey).trim() || 'Tournament' : 'Tournament';

    if (mode === 'closed_form') {
      if (!resolveClosedFormBracketSeedingKind(tournament, participants, opts.classId)) {
        throw new Error(
          'Closed-form bracket seeding requires G groups (G ∈ {2,4,8,16}) with at least four players each, decided standings, and a supported G×4 layout.',
        );
      }
      const split = splitParticipantsTopFourPerGroup(tournament, participants, opts.classId);
      if (!split) {
        throw new Error(
          'Closed-form bracket seeding requires every player in exactly one group with decided standings.',
        );
      }
      const ordered = orderTopFourPerGroupForClosedFormBracket(tournament, split.qualified, opts.classId);
      if (!ordered) {
        throw new Error('Closed-form bracket seeding could not build the G×4 layout for the top four per group.');
      }
      participants = ordered;
    } else if (mode === 'crop_closed_form') {
      if (!resolveClosedFormBracketSeedingKind(tournament, participants, opts.classId)) {
        throw new Error(
          'Crop closed-form bracket seeding requires G groups (G ∈ {2,4,8,16}) with at least four players each, decided standings, and a supported G×4 layout.',
        );
      }
      const split = splitParticipantsTopFourPerGroup(tournament, participants, opts.classId);
      const ordered = orderParticipantsForCropClosedFormBracket(tournament, participants, opts.classId);
      if (!ordered) {
        throw new Error('Crop closed-form bracket seeding could not build the draw.');
      }
      participants = ordered;
      cropClosedFormLeafOrder = Boolean(split && split.culled.length > 0);
    } else if (mode === 'extend_closed_form') {
      const ordered = orderParticipantsForGroupBalancedBracket(tournament, participants, opts.classId, 'virtual');
      if (!ordered) {
        throw new Error(
          'Extended closed-form bracket seeding requires equal-sized groups that fit a supported virtual layout (S ≤ 4, G ≤ 16, G·S ≤ 64).',
        );
      }
      participants = ordered;
    } else {
      const best = bestEffortOrderParticipantsForGroupBracket(tournament, participants, opts.classId, beKey);
      if (best) {
        participants = best;
        heuristicBipartitionLeafOrder = true;
      } else if (opts.shuffleKey !== undefined) {
        const key = String(opts.shuffleKey).trim() || 'Tournament';
        if (participants.length > 1) {
          participants = shuffleDeterministic(participants, key);
        }
      }
    }
  } else if (opts.shuffleKey !== undefined) {
    const key = String(opts.shuffleKey).trim() || 'Tournament';
    if (participants.length > 1) {
      participants = shuffleDeterministic(participants, key);
    }
  }

  let slotCount = cropClosedFormLeafOrder
    ? participants.length
    : nextPowerOfTwo(participants.length);
  if (!fillByes && slotCount !== participants.length) {
    throw new Error('Cannot generate non-power-of-two bracket without fillByes');
  }

  // Pad to power of two for standard seeding; heuristic/crop leaf orders are already padded.
  if (!heuristicBipartitionLeafOrder && !cropClosedFormLeafOrder) {
    while (participants.length < slotCount) {
      participants.push('BYE');
    }
  }

  const seeded =
    heuristicBipartitionLeafOrder || cropClosedFormLeafOrder
      ? participants
      : seedPositions(slotCount).map((seedIndex) => participants[seedIndex - 1]!);

  const matches: BracketMatch[] = [];
  let idCounter = 1;

  for (let i = 0; i < seeded.length; i += 2) {
    const rawA = seeded[i];
    const rawB = seeded[i + 1];
    const slotPid = (raw: string | undefined): string | undefined => {
      if (raw === undefined || raw === 'BYE' || isBracketLayoutDummyPid(raw)) return undefined;
      return raw;
    };
    const normA = slotPid(rawA);
    const normB = slotPid(rawB);
    const match: BracketMatch = {
      id: `m${idCounter++}`,
      seedA: normA,
      seedB: normB,
      round: 1,
      winner:
        !normA && !normB
          ? BRACKET_STRUCTURAL_EMPTY_ADVANCE
          : normA && !normB
            ? normA
            : !normA && normB
              ? normB
              : undefined,
    };
    matches.push(match);
  }

  return matches;
}

/** Next `m{n}` id for {@link BracketMatch.id} (numeric compare, not array length). */
export function nextBracketMatchNumericId(bracketMatches: BracketMatch[]): number {
  let max = 0;
  for (const bm of bracketMatches) {
    const ma = /^m(\d+)$/.exec(bm.id);
    if (ma) max = Math.max(max, Number(ma[1]));
  }
  return max + 1;
}

/**
 * Append next-round {@link BracketMatch} rows as soon as each consecutive pair in round R has winners,
 * using the same pairing order as {@link advanceBracketRound} (ids sorted within each round). This exposes
 * round-two+ slots (and `ensureBracketPhasePlayerMatches` rows) before the entire prior round is finished
 * (e.g. seven round‑1 byes decided and one live match still open).
 */
export function materializeReadyNextRoundBracketSlots(bracketMatches: BracketMatch[]): boolean {
  const roundOf = (m: BracketMatch) => bracketMatchRound(m);
  let anyAdded = false;
  let passAdded = true;
  while (passAdded) {
    passAdded = false;
    const maxR = Math.max(0, ...bracketMatches.map((m) => roundOf(m)));
    if (maxR < 1) break;

    for (let R = 1; R <= maxR; R++) {
      propagateBracketSeedsFromChildWinners(bracketMatches);
      const parents = bracketMatchesSortedForPairing(bracketMatches, R);
      if (parents.length < 2) continue;

      for (let j = 0; j + 1 < parents.length; j += 2) {
        const left = parents[j]!;
        const right = parents[j + 1]!;
        if (left.winner === undefined || right.winner === undefined) continue;

        const seedA = bracketWinnerToNextRoundSeed(left.winner);
        const seedB = bracketWinnerToNextRoundSeed(right.winner);

        const children = bracketMatches.filter((m) => roundOf(m) === R + 1).sort(compareBracketMatchId);
        const already = children.some(
          (c) =>
            (c.seedA === seedA && c.seedB === seedB) ||
            (c.seedA === seedB && c.seedB === seedA),
        );
        if (already) continue;

        const idNum = nextBracketMatchNumericId(bracketMatches);
        const nm: BracketMatch = {
          id: `m${idNum}`,
          seedA,
          seedB,
          round: R + 1,
          winner: undefined,
        };
        bracketMatches.push(nm);
        passAdded = true;
        anyAdded = true;
      }
    }
  }
  return anyAdded;
}

export function advanceBracketRound(tournament: Tournament): Tournament {
  propagateBracketSeedsFromChildWinners(tournament.bracketMatches);
  const currentRound = Math.max(0, ...tournament.bracketMatches.map((m) => bracketMatchRound(m)));
  const currentMatches = bracketMatchesSortedForPairing(tournament.bracketMatches, currentRound);
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
  const base = tournament.bracketMatches;

  for (let i = 0; i < currentMatches.length; i += 2) {
    const left = currentMatches[i]!;
    const right = currentMatches[i + 1]!;
    const idNum = nextBracketMatchNumericId([...base, ...nextMatches]);
    const nm: BracketMatch = {
      id: `m${idNum}`,
      seedA: bracketWinnerToNextRoundSeed(left.winner),
      seedB: bracketWinnerToNextRoundSeed(right.winner),
      round: nextRound,
      winner: undefined,
    };
    nextMatches.push(nm);
  }

  tournament.bracketMatches = [...tournament.bracketMatches, ...nextMatches];
  return tournament;
}

export function getFirstRoundMatchPosition(bracketMatches: BracketMatch[], playerId: string): number | undefined {
  const firstRound = bracketMatches.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
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

/** True for non–group-phase matches that already have an official winner (played, forfeit, or elimination). */
export function knockoutMatchHasDecisiveOutcome(m: Match): boolean {
  if (m.groupId) return false;
  if (!m.winner) return false;
  return m.status === 'finished' || m.status === 'forfeit' || m.status === 'eliminated';
}

function findMatchByPlayers(tournament: Tournament, playerA: string, playerB: string): Match | undefined {
  return Object.values(tournament.matches).find((m) => {
    const same = (m.playerA === playerA && m.playerB === playerB) || (m.playerA === playerB && m.playerB === playerA);
    return same && !m.groupId && knockoutMatchHasDecisiveOutcome(m);
  });
}

/** Bracket slot id → canonical player match id used by the app and {@link ensureBracketPhasePlayerMatches}. */
export function bracketPlayerMatchId(bracketMatchId: string): string {
  return `match-${bracketMatchId}`;
}

/**
 * Bracket round for a pairing within a given bracket structure (main draw or a class slice).
 * Group-phase matches can reuse the same pairing; callers that have a `Match` should ignore
 * rows with `groupId` set when treating scores as bracket play (see `matchesForBracketRound` in the app).
 */
export function findBracketRoundForPlayerPairingIn(
  bracketMatches: BracketMatch[],
  playerA: PlayerId,
  playerB: PlayerId,
): number | undefined {
  for (const bm of bracketMatches) {
    if (!bm.seedA || !bm.seedB) continue;
    const same =
      (bm.seedA === playerA && bm.seedB === playerB) || (bm.seedA === playerB && bm.seedB === playerA);
    if (same) return bm.round;
  }
  return undefined;
}

/**
 * Bracket round for a player pairing, if it appears in the main tournament bracket structure.
 * Group-phase matches can reuse the same pairing; callers that have a `Match` should ignore
 * rows with `groupId` set when treating scores as bracket play (see `matchesForBracketRound` in the app).
 */
export function findBracketRoundForPlayerPairing(tournament: Tournament, playerA: PlayerId, playerB: PlayerId): number | undefined {
  return findBracketRoundForPlayerPairingIn(tournament.bracketMatches, playerA, playerB);
}

/** Main draw vs per-class bracket slice for any player match (group or bracket). */
export function bracketScopeForPlayerMatch(
  tournament: Tournament,
  match: Match,
): { bracketMatches: BracketMatch[]; lockedBracketRounds: number[] } {
  const cid = match.classId;
  const slice = cid ? tournament.classTournaments[cid] : undefined;
  if (slice?.bracketMatches?.length) {
    return {
      bracketMatches: slice.bracketMatches,
      lockedBracketRounds: slice.lockedBracketRounds ?? [],
    };
  }
  return {
    bracketMatches: tournament.bracketMatches,
    lockedBracketRounds: tournament.lockedBracketRounds ?? [],
  };
}

/** True if any knockout player row for this draw has scores or is no longer an untouched scheduled row. */
export function anyBracketKnockoutMatchHasRecordedPlay(
  tournament: Tournament,
  bracketMatches: BracketMatch[],
): boolean {
  if (bracketMatches.length === 0) return false;
  for (const bm of bracketMatches) {
    const mid = bracketPlayerMatchId(bm.id);
    const m = tournament.matches[mid];
    if (!m || m.groupId) continue;
    if (m.scores.length > 0) return true;
    if (m.status !== 'scheduled') return true;
  }
  return false;
}

/**
 * Whether an existing group-phase result may be edited, re-entered, or cleared while a bracket exists.
 * First-time score entry on a still-scheduled empty group match stays allowed (finish RR after KO is created).
 */
export function canMutateExistingGroupPhaseMatchScores(tournament: Tournament, match: Match): boolean {
  if (!match.groupId) return true;
  const bracketMatches =
    match.classId && tournament.classTournaments[match.classId]
      ? tournament.classTournaments[match.classId]!.bracketMatches
      : tournament.bracketMatches;
  if (bracketMatches.length === 0) return true;
  if (match.status === 'scheduled' && match.scores.length === 0) return true;
  return !anyBracketKnockoutMatchHasRecordedPlay(tournament, bracketMatches);
}

export function bracketMatchesSortedForRound(bracketMatches: BracketMatch[], round: number): BracketMatch[] {
  return bracketMatches.filter((m) => bracketMatchRound(m) === round).sort(compareBracketMatchId);
}

/** Parent single-elimination match (next round) for `bm`, using the same pairing order as {@link advanceBracketRound}. */
export function bracketParentMatch(bracketMatches: BracketMatch[], bm: BracketMatch): BracketMatch | undefined {
  const cur = bracketMatchesSortedForRound(bracketMatches, bm.round);
  const idx = cur.findIndex((x) => x.id === bm.id);
  if (idx < 0) return undefined;
  const parents = bracketMatchesSortedForRound(bracketMatches, bm.round + 1);
  if (parents.length === 0) return undefined;
  const pIdx = Math.floor(idx / 2);
  return parents[pIdx];
}

/**
 * Resolved winner for a bracket slot from `bm.winner`, forfeits/byes, or a decisive canonical or
 * alias player row (same sources as {@link settleBracketWinnersIn}).
 */
export function bracketEffectiveWinner(tournament: Tournament, bm: BracketMatch): PlayerId | undefined {
  if (bm.winner && !isBracketStructuralEmptyAdvanceWinner(bm.winner)) return bm.winner;
  if (!bm.seedA || !bm.seedB) return undefined;
  const mid = bracketPlayerMatchId(bm.id);
  const direct = tournament.matches[mid];
  const match =
    direct && !direct.groupId && knockoutMatchHasDecisiveOutcome(direct)
      ? direct
      : findMatchByPlayers(tournament, bm.seedA, bm.seedB);
  if (match && !match.groupId && knockoutMatchHasDecisiveOutcome(match)) return match.winner;
  return undefined;
}

/** True when both seeds are set but the slot has no decisive outcome yet. */
export function bracketSlotAwaitingPlay(tournament: Tournament, bm: BracketMatch): boolean {
  if (!bm.seedA || !bm.seedB) return false;
  return bracketEffectiveWinner(tournament, bm) === undefined;
}

function bracketEffectiveWinnerForLock(tournament: Tournament, bm: BracketMatch): PlayerId | undefined {
  return bracketEffectiveWinner(tournament, bm);
}

/**
 * True when the winner of `bm` has a next-round bracket slot whose player match already has scores
 * or is finished (so changing `bm` would contradict recorded play).
 */
export function bracketDownstreamMatchHasScores(tournament: Tournament, bracketMatches: BracketMatch[], bm: BracketMatch): boolean {
  const w = bracketEffectiveWinnerForLock(tournament, bm);
  if (!w) return false;
  const parent = bracketParentMatch(bracketMatches, bm);
  if (!parent?.seedA || !parent?.seedB) return false;
  const mid = bracketPlayerMatchId(parent.id);
  const pm = tournament.matches[mid];
  if (!pm || pm.groupId) return false;
  return pm.scores.length > 0 || knockoutMatchHasDecisiveOutcome(pm);
}

/**
 * Whether a non–group-phase player match may be scored, re-scored, or cleared for bracket UX:
 * not in a locked bracket round, and the winner’s next bracket match (if any) has not been played yet.
 */
export function canMutateBracketPlayerMatch(
  tournament: Tournament,
  match: Match,
  bracketMatches: BracketMatch[],
  lockedBracketRounds: number[],
): boolean {
  if (match.groupId) return true;
  const round = findBracketRoundForPlayerPairingIn(bracketMatches, match.playerA, match.playerB);
  if (round === undefined) return true;
  if (lockedBracketRounds.includes(round)) return false;
  let bm: BracketMatch | undefined;
  if (match.id.startsWith('match-')) {
    const bid = match.id.slice('match-'.length);
    bm = bracketMatches.find((x) => x.id === bid);
  }
  if (!bm) {
    bm = bracketMatches.find(
      (x) =>
        x.seedA &&
        x.seedB &&
        ((x.seedA === match.playerA && x.seedB === match.playerB) || (x.seedA === match.playerB && x.seedB === match.playerA)),
    );
  }
  if (!bm) return true;
  return !bracketDownstreamMatchHasScores(tournament, bracketMatches, bm);
}

/** Copy feeder winners into round ≥2 seeds (same geometry as {@link advanceBracketRound}). */
export function propagateBracketSeedsFromChildWinners(bracketMatches: BracketMatch[]): void {
  if (bracketMatches.length === 0) return;
  const maxRound = Math.max(...bracketMatches.map((m) => bracketMatchRound(m)));
  for (let r = 2; r <= maxRound; r++) {
    const prev = bracketMatchesSortedForPairing(bracketMatches, r - 1);
    const cur = bracketMatchesSortedForRound(bracketMatches, r);
    for (let j = 0; j < cur.length; j++) {
      const left = prev[j * 2];
      const right = prev[j * 2 + 1];
      const p = cur[j];
      if (!p) continue;
      if (left?.winner !== undefined) {
        p.seedA = bracketWinnerToNextRoundSeed(left.winner);
      }
      if (right?.winner !== undefined) {
        p.seedB = bracketWinnerToNextRoundSeed(right.winner);
      }
    }
  }
}

/** When a scheduled bracket slot’s players no longer match resolved seeds, reset that row (no scores / not finished). */
export function syncBracketMatchPlayerRows(tournament: Tournament, bracketMatches: BracketMatch[]): void {
  for (const bm of bracketMatches) {
    if (!bm.seedA || !bm.seedB) continue;
    const mid = bracketPlayerMatchId(bm.id);
    const m = tournament.matches[mid];
    if (!m || m.groupId) continue;
    const untouched = m.status === 'scheduled' && m.scores.length === 0;
    if (!untouched) continue;
    if (m.playerA !== bm.seedA || m.playerB !== bm.seedB) {
      m.playerA = bm.seedA;
      m.playerB = bm.seedB;
    }
  }
}

export function isBracketRoundCompleteIn(bracketMatches: BracketMatch[], round: number): boolean {
  const matches = bracketMatches.filter((m) => bracketMatchRound(m) === round);
  if (matches.length === 0) return false;
  return matches.every((m) => Boolean(m.winner));
}

/** True if any player match mapped to this bracket round has scores entered or is finished. */
export function bracketRoundHasFinishedPlayerMatch(tournament: Tournament, round: number): boolean {
  for (const m of Object.values(tournament.matches)) {
    if (m.groupId) continue;
    const r = findBracketRoundForPlayerPairing(tournament, m.playerA, m.playerB);
    if (
      r === round &&
      (m.status === 'finished' || m.status === 'eliminated' || m.status === 'forfeit' || m.scores.length > 0)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Recompute every {@link BracketMatch.winner} in `bracketMatches` from forfeits, byes, and finished
 * player rows (prefers {@link bracketPlayerMatchId} when present). Clears stale winners when the
 * underlying match is no longer decisive.
 */
export function settleBracketWinnersIn(tournament: Tournament, bracketMatches: BracketMatch[]): Tournament {
  const sorted = [...bracketMatches].sort(
    (a, b) => bracketMatchRound(a) - bracketMatchRound(b) || compareBracketMatchId(a, b),
  );
  for (const bm of sorted) {
    bm.winner = undefined;

    if (!bm.seedA && !bm.seedB) {
      bm.winner = BRACKET_STRUCTURAL_EMPTY_ADVANCE;
      continue;
    }

    const rBm = bracketMatchRound(bm);

    // Round‑1 structural byes use a single player id vs an empty slot. In round ≥2, a missing seed can
    // mean either the sibling feeder is still open, or that side is a propagated structural empty — in
    // the latter case the remaining player auto-advances (same as a bye).
    if (bm.seedA && !bm.seedB) {
      if (rBm === 1) {
        const fa = tournament.forfeits?.players?.[bm.seedA];
        bm.winner = fa?.phase === 'bracket' ? undefined : bm.seedA;
      } else {
        const [, right] = bracketFeederPairForMatchIn(bracketMatches, bm);
        const structuralMissingB =
          Boolean(right) &&
          right!.winner !== undefined &&
          bracketWinnerToNextRoundSeed(right!.winner) === undefined;
        if (structuralMissingB) {
          const fa = tournament.forfeits?.players?.[bm.seedA];
          bm.winner = fa?.phase === 'bracket' ? undefined : bm.seedA;
        } else {
          bm.winner = undefined;
        }
      }
      continue;
    }
    if (!bm.seedA && bm.seedB) {
      if (rBm === 1) {
        const fb = tournament.forfeits?.players?.[bm.seedB];
        bm.winner = fb?.phase === 'bracket' ? undefined : bm.seedB;
      } else {
        const [left] = bracketFeederPairForMatchIn(bracketMatches, bm);
        const structuralMissingA =
          Boolean(left) &&
          left!.winner !== undefined &&
          bracketWinnerToNextRoundSeed(left!.winner) === undefined;
        if (structuralMissingA) {
          const fb = tournament.forfeits?.players?.[bm.seedB];
          bm.winner = fb?.phase === 'bracket' ? undefined : bm.seedB;
        } else {
          bm.winner = undefined;
        }
      }
      continue;
    }

    const seedA = bm.seedA!;
    const seedB = bm.seedB!;
    const seedAforfeit = tournament.forfeits?.players?.[seedA];
    const seedBforfeit = tournament.forfeits?.players?.[seedB];

    if (seedAforfeit?.phase === 'bracket' && seedBforfeit?.phase !== 'bracket') {
      bm.winner = seedB;
      continue;
    }
    if (seedBforfeit?.phase === 'bracket' && seedAforfeit?.phase !== 'bracket') {
      bm.winner = seedA;
      continue;
    }
    if (seedAforfeit?.phase === 'bracket' && seedBforfeit?.phase === 'bracket') {
      bm.winner = undefined;
      continue;
    }

    const mid = bracketPlayerMatchId(bm.id);
    const direct = tournament.matches[mid];
    const match =
      direct && !direct.groupId && knockoutMatchHasDecisiveOutcome(direct) ? direct : findMatchByPlayers(tournament, seedA, seedB);

    if (match && !match.groupId && knockoutMatchHasDecisiveOutcome(match)) {
      bm.winner = match.winner;
    }
  }
  return tournament;
}

export function settleBracketWinners(tournament: Tournament): Tournament {
  return settleBracketWinnersIn(tournament, tournament.bracketMatches);
}

/**
 * For every bracket slot that still needs to be played (two seeds, no winner), ensures a scheduled
 * player {@link Match} exists at `match-${bracketMatch.id}` with no `groupId`. Later rounds only
 * receive these rows when bracket reconciliation runs after a round completes (see command runner);
 * round 1 is still typically created via explicit `CreateMatch` commands from the app.
 */
export function ensureBracketPhasePlayerMatchesIn(tournament: Tournament, bracketMatches: BracketMatch[]): void {
  if (Object.keys(tournament.teamMatches).length > 0) {
    return;
  }
  for (const bm of bracketMatches) {
    if (!bm.seedA || !bm.seedB || bm.winner) continue;
    const mid = bracketPlayerMatchId(bm.id);
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

function bracketFinishRankMeta(
  tournament: Tournament,
  pid: PlayerId,
  classId: string | undefined,
): { idx: number; groupSize: number } | null {
  const g = findGroupForPlayer(tournament, pid, classId);
  if (!g) return null;
  const rows = groupStandingsRowsForBracket(tournament, g, classId);
  const idx = rows.findIndex((r) => r.pid === pid);
  if (idx < 0) return null;
  return { idx, groupSize: g.playerIds.length };
}

function pickBracketEliminationLoser(
  pidA: PlayerId,
  metaA: { idx: number; groupSize: number },
  pidB: PlayerId,
  metaB: { idx: number; groupSize: number },
  salt: string,
): PlayerId {
  if (metaA.idx !== metaB.idx) return metaA.idx > metaB.idx ? pidA : pidB;
  if (metaA.groupSize !== metaB.groupSize) return metaA.groupSize < metaB.groupSize ? pidA : pidB;
  return shuffleDeterministic([pidA, pidB], salt)[0]!;
}

/** True when {@link eliminateLowestRankedPlayersInBracketRound} could still affect this slot. */
function bracketMatchOpenForElimination(
  tournament: Tournament,
  bm: BracketMatch,
  classId: string | undefined,
): boolean {
  if (bm.winner) return false;
  const a = bm.seedA;
  const b = bm.seedB;
  if (!a || !b) return false;
  if (!tournament.players[a] || !tournament.players[b]) return false;

  const mid = bracketPlayerMatchId(bm.id);
  const existing = tournament.matches[mid];
  if (existing) {
    if (existing.groupId) return false;
    if (existing.scores.length > 0) return false;
    if (existing.status === 'finished' || existing.status === 'forfeit' || existing.status === 'eliminated') {
      return false;
    }
  }

  const ra = bracketFinishRankMeta(tournament, a, classId);
  const rb = bracketFinishRankMeta(tournament, b, classId);
  return Boolean(ra && rb);
}

/** Whether any pairing in `round` can still be resolved by bureaucratic elimination. */
export function bracketRoundHasOpenEliminationPairings(
  tournament: Tournament,
  bracketMatches: BracketMatch[],
  round: number,
  classId?: string,
): boolean {
  const sorted = bracketMatchesSortedForRound(bracketMatches, round);
  return sorted.some((bm) => bracketMatchOpenForElimination(tournament, bm, classId));
}

/**
 * Bureaucratic bracket outcome (distinct from forfeit): in each open two-player slot of `round`,
 * the worse group finisher is eliminated and the better finisher advances without entering game scores.
 * Tie on finish index: prefer survival from the **larger** group; further ties use `tieBreakSalt` deterministically.
 */
export function eliminateLowestRankedPlayersInBracketRound(
  tournament: Tournament,
  round: number,
  classId: string | undefined,
  tieBreakSalt: string,
): string | undefined {
  const salt = tieBreakSalt.trim();
  if (!salt) return 'tieBreakSalt is required.';

  if (classId && !tournament.classTournaments[classId]) {
    return 'Unknown class id.';
  }

  const slice = classId ? tournament.classTournaments[classId]! : undefined;
  const bracketMatches = slice?.bracketMatches ?? tournament.bracketMatches;
  const locks = slice?.lockedBracketRounds ?? tournament.lockedBracketRounds;

  if (locks.includes(round)) {
    return `Bracket round ${round} is locked.`;
  }

  const sorted = bracketMatchesSortedForRound(bracketMatches, round);
  let changed = 0;
  for (const bm of sorted) {
    if (!bracketMatchOpenForElimination(tournament, bm, classId)) continue;

    const a = bm.seedA!;
    const b = bm.seedB!;
    const ra = bracketFinishRankMeta(tournament, a, classId)!;
    const rb = bracketFinishRankMeta(tournament, b, classId)!;
    const mid = bracketPlayerMatchId(bm.id);
    const existing = tournament.matches[mid];

    const loser = pickBracketEliminationLoser(a, ra, b, rb, `${salt}:${bm.id}`);
    const winner = loser === a ? b : a;

    if (!existing) {
      tournament.matches[mid] = {
        id: mid,
        playerA: a,
        playerB: b,
        scores: [],
        status: 'scheduled',
      };
    }
    const m = tournament.matches[mid]!;
    if (m.groupId) continue;
    m.playerA = a;
    m.playerB = b;
    m.scores = [];
    m.status = 'eliminated';
    m.winner = winner;
    changed++;
  }

  if (changed === 0) {
    return 'No open pairings in that round could be resolved by elimination.';
  }
  return undefined;
}

export function ensureBracketPhasePlayerMatches(tournament: Tournament): void {
  ensureBracketPhasePlayerMatchesIn(tournament, tournament.bracketMatches);
}

export function isBracketRoundComplete(tournament: Tournament, round: number): boolean {
  return isBracketRoundCompleteIn(tournament.bracketMatches, round);
}

export interface BracketPlacementRow {
  place: number;
  playerId: PlayerId;
}

/** Loser of a decided two-player bracket match (undefined for bye, structural empty advance, or missing side). */
export function bracketMatchLoser(m: BracketMatch): PlayerId | undefined {
  if (!m.winner || isBracketStructuralEmptyAdvanceWinner(m.winner)) return undefined;
  const a = m.seedA;
  const b = m.seedB;
  if (!a || !b) return undefined;
  return m.winner === a ? b : a;
}

function isRealBracketMatch(m: BracketMatch): boolean {
  return !m.id.startsWith('__ph-');
}

/** Winner for placement: bracket row, decisive player match, or legal scores on the mapped row. */
function placementBracketWinner(tournament: Tournament | undefined, m: BracketMatch): PlayerId | undefined {
  if (tournament) {
    const w = bracketEffectiveWinner(tournament, m);
    if (w) return w;
    const mid = bracketPlayerMatchId(m.id);
    const pm = tournament.matches[mid];
    if (pm && !pm.groupId && pm.winner && isMatchScoreLegal(pm.scores)) return pm.winner;
  }
  if (m.winner && !isBracketStructuralEmptyAdvanceWinner(m.winner)) return m.winner;
  return undefined;
}

/** Pick the championship match when several rows share the deepest round (e.g. duplicate materialization). */
export function resolveBracketFinalMatch(
  bracketMatches: BracketMatch[],
  tournament?: Tournament,
): BracketMatch | null {
  const real = bracketMatches.filter(isRealBracketMatch);
  if (real.length === 0) return null;
  const roundOf = (m: BracketMatch) => bracketMatchRound(m);
  const maxRound = Math.max(...real.map(roundOf).filter((r) => Number.isFinite(r)));
  const atMax = real.filter((m) => roundOf(m) === maxRound);
  if (atMax.length === 0) return null;
  if (atMax.length === 1) return atMax[0]!;
  const sorted = [...atMax].sort(compareBracketMatchId);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i]!;
    if (!m.seedA || !m.seedB) continue;
    if (placementBracketWinner(tournament, m)) return m;
  }
  return sorted[sorted.length - 1]!;
}

function runnerUpFromFinal(
  tournament: Tournament | undefined,
  fm: BracketMatch,
  winner: PlayerId,
): PlayerId | undefined {
  const fromSeeds = winner === fm.seedA ? fm.seedB : fm.seedA;
  if (fromSeeds) return fromSeeds;
  if (!tournament) return undefined;
  const pm = tournament.matches[bracketPlayerMatchId(fm.id)];
  if (!pm || pm.groupId || !pm.winner) return undefined;
  return pm.winner === winner ? pm.playerB : pm.playerA;
}

/**
 * Single-elimination final ranking: places 1–2 from the final; for each earlier round, losers are
 * ordered by the finishing rank of the opponent who beat them (place 3 = semi loser to the champion,
 * 5–8 = quarter losers to places 1–4, etc.).
 *
 * Returns `null` if there is no single final or the final has no winner yet. Participants without a
 * computable rank (e.g. open matches) are appended with consecutive places after the last assigned rank.
 */
export function singleEliminationPlacementRows(
  bracketMatches: BracketMatch[],
  tournament?: Tournament,
): BracketPlacementRow[] | null {
  if (bracketMatches.length === 0) return null;

  let ms = bracketMatches.filter(isRealBracketMatch);
  if (ms.length === 0) return null;

  if (tournament) {
    ms = ms.map((m) => ({ ...m }));
    propagateBracketSeedsFromChildWinners(ms);
    settleBracketWinnersIn(tournament, ms);
  }

  const roundOf = (m: BracketMatch) => bracketMatchRound(m);
  const rounds = ms.map(roundOf).filter((r) => Number.isFinite(r));
  if (rounds.length === 0) return null;
  const maxRound = Math.max(...rounds);

  const fm = resolveBracketFinalMatch(ms, tournament);
  if (!fm || bracketMatchRound(fm) !== maxRound) return null;

  const finalWinner = placementBracketWinner(tournament, fm);
  const runnerUp = finalWinner ? runnerUpFromFinal(tournament, fm, finalWinner) : undefined;
  if (!finalWinner || !runnerUp) return null;

  /** Tree depth from round-1 size; duplicate materialized finals can inflate raw {@link maxRound}. */
  const slotCount = inferBracketSlotCountFromRoundOne(ms);
  const depthRound =
    slotCount !== undefined && slotCount >= 2 ? Math.trunc(Math.log2(slotCount)) : maxRound;

  const places = new Map<PlayerId, number>();
  places.set(finalWinner, 1);
  places.set(runnerUp, 2);

  for (let r = depthRound - 1; r >= 1; r--) {
    const roundMs = ms.filter((m) => roundOf(m) === r && placementBracketWinner(tournament, m)).sort(compareBracketMatchId);
    const rows: Array<{ loser: PlayerId; wp: number }> = [];
    for (const m of roundMs) {
      const w = placementBracketWinner(tournament, m);
      if (!w) continue;
      const loser = w === m.seedA ? m.seedB : m.seedA;
      if (!loser || places.has(loser)) continue;
      const wp = places.get(w);
      if (wp === undefined) continue;
      rows.push({ loser, wp });
    }
    rows.sort((a, b) => a.wp - b.wp || a.loser.localeCompare(b.loser));
    const start = 2 ** (depthRound - r) + 1;
    for (let i = 0; i < rows.length; i++) {
      places.set(rows[i]!.loser, start + i);
    }
  }

  const participants = new Set<PlayerId>();
  for (const m of ms) {
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

/** Build default table ids `1` … `n` (at least 0, capped at 32). */
export function buildDefaultTableIds(count: number): string[] {
  const n = Math.min(32, Math.max(0, Math.floor(Number(count))));
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

export function normalizeTournamentTableIds(tableIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tableIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function matchAssignedTableId(tournament: Tournament, matchId: string): string | undefined {
  return tournament.tableAssignments.find((a) => a.matchId === matchId)?.tableId;
}

/** Player match currently occupying a table (live assignment), if any. */
export function matchIdOnTable(tournament: Tournament, tableId: string): string | undefined {
  for (const a of tournament.tableAssignments) {
    if (a.tableId !== tableId) continue;
    const m = tournament.matches[a.matchId];
    if (m && m.status === 'in-progress') return a.matchId;
  }
  return undefined;
}

export function isTableOccupiedByOtherMatch(tournament: Tournament, tableId: string, matchId: string): boolean {
  const other = matchIdOnTable(tournament, tableId);
  return other !== undefined && other !== matchId;
}

/** In-progress player match ids involving this player. */
export function inProgressMatchIdsForPlayer(tournament: Tournament, playerId: PlayerId): string[] {
  const ids: string[] = [];
  for (const m of Object.values(tournament.matches)) {
    if (m.status !== 'in-progress') continue;
    if (m.playerA === playerId || m.playerB === playerId) ids.push(m.id);
  }
  return ids;
}

function assertPlayersFreeForMatchAssignment(tournament: Tournament, matchId: string, match: Match): void {
  for (const playerId of [match.playerA, match.playerB]) {
    const other = inProgressMatchIdsForPlayer(tournament, playerId).filter((id) => id !== matchId);
    if (other.length === 0) continue;
    const name = tournament.players[playerId]?.name ?? playerId;
    const otherMatchId = other[0];
    const tableId = otherMatchId ? matchAssignedTableId(tournament, otherMatchId) : undefined;
    const tablePart = tableId ? ` on table ${tableId}` : '';
    throw new Error(`${name} is already playing another match${tablePart}`);
  }
}

function releaseLiveTableForMatch(tournament: Tournament, matchId: string): void {
  tournament.tableAssignments = tournament.tableAssignments.filter((a) => a.matchId !== matchId);
  const m = tournament.matches[matchId];
  if (m && m.status === 'in-progress') {
    m.status = 'scheduled';
  }
}

export function setTournamentTables(tournament: Tournament, tableIds: string[]): Tournament {
  const next = normalizeTournamentTableIds(tableIds);
  const allowed = new Set(next);
  tournament.tables = next;
  const removedTableIds = new Set<string>();
  for (const a of tournament.tableAssignments) {
    if (!allowed.has(a.tableId)) removedTableIds.add(a.tableId);
  }
  if (removedTableIds.size > 0) {
    const toRelease = tournament.tableAssignments
      .filter((a) => removedTableIds.has(a.tableId))
      .map((a) => a.matchId);
    for (const mid of toRelease) {
      releaseLiveTableForMatch(tournament, mid);
    }
  }
  return tournament;
}

export function assignMatchToTable(tournament: Tournament, matchId: string, tableId: string): void {
  const match = tournament.matches[matchId];
  if (!match) throw new Error('Match not found');
  if (!tournament.tables.includes(tableId)) throw new Error('Table not configured for this tournament');
  if (match.status === 'finished' || match.status === 'forfeit' || match.status === 'eliminated') {
    throw new Error('Cannot assign a completed match to a table');
  }
  if (isTableOccupiedByOtherMatch(tournament, tableId, matchId)) {
    throw new Error('That table already has a match in progress');
  }
  assertPlayersFreeForMatchAssignment(tournament, matchId, match);
  tournament.tableAssignments = tournament.tableAssignments.filter((a) => a.matchId !== matchId);
  tournament.tableAssignments.push({ tableId, matchId });
  match.status = 'in-progress';
}

export function clearMatchTableAssignment(tournament: Tournament, matchId: string): void {
  releaseLiveTableForMatch(tournament, matchId);
}

/** Called when a match is fully scored or cleared — frees the table for other matches. */
export function releaseTableForFinishedOrClearedMatch(tournament: Tournament, matchId: string): void {
  releaseLiveTableForMatch(tournament, matchId);
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

