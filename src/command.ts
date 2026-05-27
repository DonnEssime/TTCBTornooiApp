import {
  Tournament,
  advanceBracketRound,
  applyBracketToTournament,
  bracketRoundHasFinishedPlayerMatch,
  buildNumberedGroupsFromPlayerOrder,
  buildNumberedGroupsFromPlayerOrderByGroupCount,
  canMutateBracketPlayerMatch,
  createTournament,
  ensureBracketPhasePlayerMatchesIn,
  findBracketRoundForPlayerPairingIn,
  forfeitPlayer,
  forfeitTeam,
  generateBracket,
  type GroupDefinition,
  type BracketMatch,
  type Match,
  type BracketSeedingMode,
  isBracketRoundCompleteIn,
  isMatchScoreLegal,
  materializeReadyNextRoundBracketSlots,
  playerMatchWinner,
  propagateBracketSeedsFromChildWinners,
  recomputeClassTournamentSlices,
  roundRobinPairs,
  assignMatchToTable,
  clearMatchTableAssignment,
  releaseTableForFinishedOrClearedMatch,
  scheduleRound,
  setTournamentTables,
  settleBracketWinnersIn,
  shuffleDeterministic,
  syncBracketMatchPlayerRows,
  teamMatchWinner,
  tournamentUsesClassTabs,
  isPlayerDisplayNameTaken,
  bracketScopeForPlayerMatch,
  bracketMatchRound,
  canMutateExistingGroupPhaseMatchScores,
  eliminateLowestRankedPlayersInBracketRound,
  clearBracketFromTournament,
  clampPlayerHandicapValue,
  normalizeHandicapConfig,
  validatePlayerHandicapForTournament,
  type HandicapConfig,
} from './model';
import {
  commandFail,
  commandFailFromText,
  type CommandResult,
  type UndoCheckResult,
} from './i18n/command-result';
import type { MessageKey } from './i18n/catalog';

export type CommandType =
  | 'CreatePlayer'
  | 'CreateTeam'
  | 'CreateMatch'
  | 'CreateTeamMatch'
  | 'EnterScore'
  | 'ClearMatchScores'
  | 'EnterTeamScore'
  | 'PlayerForfeit'
  | 'TeamForfeit'
  | 'SetRoundLock'
  | 'SetSeedings'
  | 'SetHandicapConfig'
  | 'SetTournamentClasses'
  | 'SetPlayerClassFlags'
  | 'SetGroups'
  | 'SetPlayerGroup'
  | 'SetClassGroups'
  | 'GenerateGroupRoundRobin'
  | 'GenerateBracket'
  | 'ClearBracket'
  | 'EliminateLowestBracketRound'
  | 'AssignTables'
  | 'SetTournamentTables'
  | 'AssignMatchToTable'
  | 'ClearMatchTableAssignment'
  | 'AdvanceBracketRound'
  | 'RenamePlayer'
  | 'Undo';

export interface CommandBase {
  id: string;
  type: CommandType;
  timestamp: string;
  dependsOn: string[];
}

export interface CreatePlayerCommand extends CommandBase {
  type: 'CreatePlayer';
  payload: { playerId: string; name: string; handicap: number };
}

export interface CreateTeamCommand extends CommandBase {
  type: 'CreateTeam';
  payload: { teamId: string; name: string; memberIds: string[] };
}

export interface CreateMatchCommand extends CommandBase {
  type: 'CreateMatch';
  payload: { matchId: string; playerA: string; playerB: string; groupId?: string; classId?: string };
}

export interface CreateTeamMatchCommand extends CommandBase {
  type: 'CreateTeamMatch';
  payload: { matchId: string; teamA: string; teamB: string };
}

export interface EnterScoreCommand extends CommandBase {
  type: 'EnterScore';
  payload: { matchId: string; scores: Array<{ playerA: number; playerB: number }> };
}

export interface ClearMatchScoresCommand extends CommandBase {
  type: 'ClearMatchScores';
  payload: { matchId: string };
}

export interface EnterTeamScoreCommand extends CommandBase {
  type: 'EnterTeamScore';
  payload: { matchId: string; scores: Array<{ playerA: number; playerB: number }> };
}

export interface PlayerForfeitCommand extends CommandBase {
  type: 'PlayerForfeit';
  payload: { playerId: string; phase: 'group' | 'bracket'; groupMode?: 'auto-win' | 'not-played' };
}

export interface TeamForfeitCommand extends CommandBase {
  type: 'TeamForfeit';
  payload: { teamId: string; phase: 'group' | 'bracket'; groupMode?: 'auto-win' | 'not-played' };
}

export interface SetRoundLockCommand extends CommandBase {
  type: 'SetRoundLock';
  payload: { bracketRound: number; locked: boolean };
}

export interface SetSeedingsCommand extends CommandBase {
  type: 'SetSeedings';
  payload: { playerIds: string[] };
}

export interface SetHandicapConfigCommand extends CommandBase {
  type: 'SetHandicapConfig';
  payload: { config: HandicapConfig | null };
}

export interface SetTournamentClassesCommand extends CommandBase {
  type: 'SetTournamentClasses';
  payload: { classes: Array<{ id?: string; name: string }> };
}

export interface SetPlayerClassFlagsCommand extends CommandBase {
  type: 'SetPlayerClassFlags';
  payload: { playerId: string; flags: Record<string, boolean> };
}

export type SetGroupsPayload =
  | { groups: Array<{ id: string; label?: string; playerIds: string[] }> }
  | { targetGroupSize: number; playerIds: string[] }
  | { targetGroupCount: number; playerIds: string[] };

export interface SetGroupsCommand extends CommandBase {
  type: 'SetGroups';
  payload: SetGroupsPayload;
}

export interface SetPlayerGroupCommand extends CommandBase {
  type: 'SetPlayerGroup';
  payload: { playerId: string; groupId?: string | null };
}

export type SetClassGroupsPayload =
  | { groups: Array<{ id: string; label?: string; playerIds: string[] }> }
  | { targetGroupSize: number; playerIds: string[] }
  | { targetGroupCount: number; playerIds: string[] };

export interface SetClassGroupsCommand extends CommandBase {
  type: 'SetClassGroups';
  payload: { classId: string } & SetClassGroupsPayload;
}

export interface GenerateGroupRoundRobinCommand extends CommandBase {
  type: 'GenerateGroupRoundRobin';
  payload: { classId?: string };
}

export interface GenerateBracketCommand extends CommandBase {
  type: 'GenerateBracket';
  payload: {
    fillByes: boolean;
    cullToPowerOfTwo: boolean;
    shuffleKey?: string;
    /** Salt for random bipartition tie-breaks; stored for replay. When omitted, {@link generateBracket} uses current time. */
    tieBreakSalt?: string;
    cullByGroupPlacement?: boolean;
    classId?: string;
    /** When omitted, defaults to heuristic ordering in {@link generateBracket}. */
    bracketSeedingMode?: BracketSeedingMode | 'extend_closed_form';
  };
}

export interface ClearBracketCommand extends CommandBase {
  type: 'ClearBracket';
  payload: { classId?: string };
}

export interface EliminateLowestBracketRoundCommand extends CommandBase {
  type: 'EliminateLowestBracketRound';
  payload: {
    round: number;
    /** Per-class bracket slice; omit for the main draw. */
    classId?: string;
    /** Non-empty salt so random tie-breaks replay deterministically. */
    tieBreakSalt: string;
  };
}

export interface AssignTablesCommand extends CommandBase {
  type: 'AssignTables';
  payload: { tableIds: string[]; round: number };
}

export interface SetTournamentTablesCommand extends CommandBase {
  type: 'SetTournamentTables';
  payload: { tableIds: string[] };
}

export interface AssignMatchToTableCommand extends CommandBase {
  type: 'AssignMatchToTable';
  payload: { matchId: string; tableId: string };
}

export interface ClearMatchTableAssignmentCommand extends CommandBase {
  type: 'ClearMatchTableAssignment';
  payload: { matchId: string };
}

export interface AdvanceBracketRoundCommand extends CommandBase {
  type: 'AdvanceBracketRound';
  payload: Record<string, never>;
}

export interface RenamePlayerCommand extends CommandBase {
  type: 'RenamePlayer';
  payload: { playerId: string; name: string; handicap?: number };
}

export interface UndoCommand extends CommandBase {
  type: 'Undo';
  payload: { targetCommandId: string };
}

export type Command =
  | CreatePlayerCommand
  | CreateTeamCommand
  | CreateMatchCommand
  | CreateTeamMatchCommand
  | EnterScoreCommand
  | ClearMatchScoresCommand
  | EnterTeamScoreCommand
  | PlayerForfeitCommand
  | TeamForfeitCommand
  | SetRoundLockCommand
  | SetSeedingsCommand
  | SetHandicapConfigCommand
  | SetTournamentClassesCommand
  | SetPlayerClassFlagsCommand
  | SetGroupsCommand
  | SetPlayerGroupCommand
  | SetClassGroupsCommand
  | GenerateGroupRoundRobinCommand
  | GenerateBracketCommand
  | ClearBracketCommand
  | EliminateLowestBracketRoundCommand
  | AssignTablesCommand
  | SetTournamentTablesCommand
  | AssignMatchToTableCommand
  | ClearMatchTableAssignmentCommand
  | AdvanceBracketRoundCommand
  | RenamePlayerCommand
  | UndoCommand;

export type { CommandResult, UndoCheckResult };

function sortLog(log: Command[]): Command[] {
  return [...log.entries()]
    .sort(([i, a], [j, b]) => {
      const byTime = a.timestamp.localeCompare(b.timestamp);
      if (byTime !== 0) return byTime;
      return i - j;
    })
    .map(([, c]) => c);
}

/** Create scheduled round-robin matches for each group (skips existing match ids). */
function addGroupRoundRobinMatches(
  tournament: Tournament,
  groupsRecord: Record<string, GroupDefinition>,
  classId?: string,
): void {
  for (const g of Object.values(groupsRecord)) {
    for (const [a, b] of roundRobinPairs(g.playerIds)) {
      const sortedPair = [a, b].sort((x, y) => x.localeCompare(y));
      const mid = classId
        ? `gm-${classId}-${g.id}-${sortedPair[0]}-${sortedPair[1]}`
        : `gm-${g.id}-${sortedPair[0]}-${sortedPair[1]}`;
      if (tournament.matches[mid]) continue;
      tournament.matches[mid] = {
        id: mid,
        playerA: a,
        playerB: b,
        scores: [],
        status: 'scheduled',
        groupId: g.id,
        ...(classId ? { classId } : {}),
      };
    }
  }
}

function groupMatchIdForPair(groupId: string, playerA: string, playerB: string, classId?: string): string {
  const sortedPair = [playerA, playerB].sort((x, y) => x.localeCompare(y));
  return classId
    ? `gm-${classId}-${groupId}-${sortedPair[0]}-${sortedPair[1]}`
    : `gm-${groupId}-${sortedPair[0]}-${sortedPair[1]}`;
}

function deletePlayerScheduledGroupMatches(tournament: Tournament, playerId: string): void {
  const matchIdsToRemove: string[] = [];
  for (const mid of Object.keys(tournament.matches)) {
    const m = tournament.matches[mid];
    if (!m) continue;
    if (!m.groupId) continue;
    if (m.playerA !== playerId && m.playerB !== playerId) continue;
    if (m.scores.length > 0) continue;
    if (m.status !== 'scheduled') continue;
    matchIdsToRemove.push(mid);
  }
  if (matchIdsToRemove.length === 0) return;
  const set = new Set(matchIdsToRemove);
  for (const mid of matchIdsToRemove) {
    delete tournament.matches[mid];
  }
  tournament.tableAssignments = tournament.tableAssignments.filter((a) => !set.has(a.matchId));
}

function playerHasAnyRecordedGroupMatch(tournament: Tournament, playerId: string): boolean {
  for (const m of Object.values(tournament.matches)) {
    if (!m?.groupId) continue;
    if (m.playerA !== playerId && m.playerB !== playerId) continue;
    if (m.scores.length > 0) return true;
    if (m.status !== 'scheduled') return true;
  }
  return false;
}

function dependsReach(cmd: Command, ancestorId: string, byId: Map<string, Command>): boolean {
  const stack = [...cmd.dependsOn];
  const seen = new Set<string>();
  while (stack.length) {
    const d = stack.pop()!;
    if (d === ancestorId) return true;
    if (seen.has(d)) continue;
    seen.add(d);
    const p = byId.get(d);
    if (!p) continue;
    if (p.type === 'Undo') {
      stack.push(p.payload.targetCommandId);
    } else {
      stack.push(...p.dependsOn);
    }
  }
  return false;
}

function newTournamentClassId(): string {
  const u = globalThis.crypto?.randomUUID?.();
  if (u) {
    return `cid-${u.replace(/-/g, '').slice(0, 12)}`;
  }
  return `cid-${Math.random().toString(36).slice(2, 14)}`;
}

export class CommandRunner {
  private tournament: Tournament;
  /** Append-only command log (includes {@link UndoCommand}). */
  private orderedLog: Command[] = [];
  private commandById = new Map<string, Command>();

  constructor(tournament?: Tournament) {
    this.tournament = tournament ?? createTournament();
    if (!this.tournament.lockedBracketRounds) {
      this.tournament.lockedBracketRounds = [];
    }
    if (!this.tournament.classDefinitions) {
      this.tournament.classDefinitions = [];
    }
    if (!this.tournament.playerClassFlags) {
      this.tournament.playerClassFlags = {};
    }
    if (!this.tournament.classTournaments) {
      this.tournament.classTournaments = {};
    }
  }

  execute(command: Command): CommandResult {
    if (this.commandById.has(command.id)) {
      return commandFail('command.commandIdAlreadyExists');
    }

    for (const dep of command.dependsOn || []) {
      if (!this.commandById.has(dep)) {
        return commandFail('command.missingDependency', { dep });
      }
    }

    if (command.type === 'Undo') {
      const u = command as UndoCommand;
      const ok = this.canAppendUndo(u.payload.targetCommandId);
      if (!ok.ok) {
        return commandFail(ok.reason ?? 'command.cannotAppendUndo', ok.reasonParams);
      }
    }

    this.orderedLog.push(command);
    this.commandById.set(command.id, command);

    const err = this.rebuildFromLog();
    if (err) {
      this.orderedLog.pop();
      this.commandById.delete(command.id);
      return err;
    }

    return { success: true };
  }

  canUndo(commandId: string): boolean {
    return this.canAppendUndo(commandId).ok;
  }

  /** Whether a new Undo could target this command (no active dependents after it). */
  canAppendUndo(targetCommandId: string): UndoCheckResult {
    const sorted = sortLog(this.orderedLog);
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const tgt = byId.get(targetCommandId);
    if (!tgt) {
      return { ok: false, reason: 'command.commandNotFound' };
    }

    if (tgt.type === 'Undo') {
      const pos = sorted.findIndex((c) => c.id === targetCommandId);
      if (pos < 0) {
        return { ok: false, reason: 'command.commandNotFound' };
      }
      const { suppressed } = this.computeSuppressedWithVictims(sorted, byId);
      for (let i = pos + 1; i < sorted.length; i++) {
        const v = sorted[i];
        if (v.type === 'Undo') {
          continue;
        }
        if (suppressed.has(v.id)) {
          continue;
        }
        return {
          ok: false,
          reason: 'command.cannotReverseUndoWithLaterMutations',
        };
      }
      return { ok: true };
    }

    const { suppressed } = this.computeSuppressedWithVictims(sorted, byId);
    if (suppressed.has(targetCommandId)) {
      return { ok: false, reason: 'command.targetAlreadyUndone' };
    }

    const pos = sorted.findIndex((c) => c.id === targetCommandId);
    if (pos < 0) return { ok: false, reason: 'command.commandNotFound' };

    for (let i = pos + 1; i < sorted.length; i++) {
      const c = sorted[i];
      if (c.type === 'Undo') continue;
      if (suppressed.has(c.id)) continue;
      if (dependsReach(c, targetCommandId, byId)) {
        return { ok: false, reason: 'command.commandHasActiveDependents' };
      }
    }

    return { ok: true };
  }

  /** True if the last log entry is an Undo (redo can pop it). */
  canRedo(): boolean {
    const last = this.orderedLog[this.orderedLog.length - 1];
    return Boolean(last && last.type === 'Undo');
  }

  /** Redo is not a command: removes the trailing Undo entry and rebuilds. */
  redoPop(): CommandResult {
    const last = this.orderedLog[this.orderedLog.length - 1];
    if (!last || last.type !== 'Undo') {
      return commandFail('command.nothingToRedo');
    }
    this.orderedLog.pop();
    this.commandById.delete(last.id);
    const err = this.rebuildFromLog();
    if (err) {
      this.orderedLog.push(last);
      this.commandById.set(last.id, last);
      return err;
    }
    return { success: true };
  }

  getTournament(): Tournament {
    return this.tournament;
  }

  getHistory(): Command[] {
    return sortLog(this.orderedLog);
  }

  /** Latest non-suppressed CreateMatch command id for this player match id. */
  findLatestActiveCreateMatchCommandId(matchId: string): string | undefined {
    const sorted = sortLog(this.orderedLog);
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const { suppressed } = this.computeSuppressedWithVictims(sorted, byId);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const c = sorted[i]!;
      if (c.type === 'Undo') continue;
      if (suppressed.has(c.id)) continue;
      if (c.type === 'CreateMatch' && c.payload.matchId === matchId) {
        return c.id;
      }
    }
    return undefined;
  }

  private computeSuppressedWithVictims(
    sorted: Command[],
    byId: Map<string, Command>,
  ): { suppressed: Set<string>; undoVictims: Map<string, Set<string>> } {
    const suppressed = new Set<string>();
    const undoVictims = new Map<string, Set<string>>();

    for (const c of sorted) {
      if (c.type !== 'Undo') continue;
      const u = c as UndoCommand;
      const t = u.payload.targetCommandId;
      const tgt = byId.get(t);
      if (!tgt) continue;

      if (tgt.type === 'Undo') {
        const victims = undoVictims.get(t);
        if (victims) {
          for (const v of victims) {
            suppressed.delete(v);
          }
        }
        undoVictims.delete(t);
        continue;
      }

      const before = new Set(suppressed);
      suppressed.add(t);
      let growth = true;
      while (growth) {
        growth = false;
        for (const cmd of sorted) {
          if (cmd.type === 'Undo') continue;
          if (suppressed.has(cmd.id)) continue;
          if (cmd.dependsOn.some((d) => suppressed.has(d))) {
            suppressed.add(cmd.id);
            growth = true;
          }
        }
      }
      const victims = new Set<string>();
      for (const id of suppressed) {
        if (!before.has(id)) {
          victims.add(id);
        }
      }
      undoVictims.set(c.id, victims);
    }

    return { suppressed, undoVictims: undoVictims };
  }

  private rebuildFromLog(): CommandResult | undefined {
    const sorted = sortLog(this.orderedLog);
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const { suppressed } = this.computeSuppressedWithVictims(sorted, byId);

    const t = createTournament();

    for (const c of sorted) {
      if (c.type === 'Undo') continue;
      if (suppressed.has(c.id)) continue;
      const r = this.applyCommandCore(t, c);
      if (!r.success) {
        return r.reason
          ? { success: false, reason: r.reason, reasonParams: r.reasonParams }
          : commandFail('command.replayFailed');
      }
    }

    this.tournament = t;
    return undefined;
  }

  private applyCommandCore(tournament: Tournament, command: Command): CommandResult {
    switch (command.type) {
      case 'CreatePlayer': {
        const { playerId, name, handicap } = command.payload;
        if (tournament.players[playerId]) {
          return commandFail('command.playerAlreadyExists');
        }
        if (isPlayerDisplayNameTaken(tournament, name)) {
          return commandFail('command.playerNameAlreadyExists');
        }
        const hcErr = tournament.handicapConfig
          ? validatePlayerHandicapForTournament(tournament, handicap)
          : undefined;
        if (hcErr) {
          return commandFail(hcErr.key, hcErr.params);
        }
        const hc = tournament.handicapConfig
          ? clampPlayerHandicapValue(tournament.handicapConfig, handicap)
          : Math.max(0, Math.floor(handicap));
        tournament.players[playerId] = { id: playerId, name, handicap: hc };
        tournament.playerClassFlags[playerId] = {};
        for (const c of tournament.classDefinitions) {
          tournament.playerClassFlags[playerId][c.id] = false;
        }
        recomputeClassTournamentSlices(tournament);
        return { success: true };
      }
      case 'CreateTeam': {
        const { teamId, name, memberIds } = command.payload;
        if (tournament.teams[teamId]) {
          return commandFail('command.teamAlreadyExists');
        }
        for (const playerId of memberIds) {
          if (!tournament.players[playerId]) {
            return commandFail('command.playerNotFoundWithId', { playerId });
          }
        }
        tournament.teams[teamId] = { id: teamId, name, memberIds };
        return { success: true };
      }
      case 'CreateMatch': {
        const { matchId, playerA, playerB, groupId, classId } = command.payload;
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.playerMatchesNotAllowedInTeamFixture');
        }
        if (tournament.matches[matchId]) {
          return commandFail('command.matchAlreadyExists');
        }
        if (!tournament.players[playerA] || !tournament.players[playerB]) {
          return commandFail('command.playerNotFound');
        }
        tournament.matches[matchId] = {
          id: matchId,
          playerA,
          playerB,
          scores: [],
          status: 'scheduled',
          ...(groupId ? { groupId: String(groupId) } : {}),
          ...(classId ? { classId: String(classId) } : {}),
        };
        return { success: true };
      }
      case 'CreateTeamMatch': {
        const { matchId, teamA, teamB } = command.payload;
        if (tournament.bracketMatches.length > 0) {
          return commandFail('command.teamVsTeamWithPlayerBracket');
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.onlyOneTeamVsTeamMatch');
        }
        if (tournament.teamMatches[matchId]) {
          return commandFail('command.teamMatchAlreadyExists');
        }
        if (!tournament.teams[teamA] || !tournament.teams[teamB]) {
          return commandFail('command.teamNotFound');
        }
        if (teamA === teamB) {
          return commandFail('command.teamCannotPlayItself');
        }
        tournament.teamMatches[matchId] = {
          id: matchId,
          teamA,
          teamB,
          scores: [],
          status: 'scheduled',
        };
        return { success: true };
      }
      case 'EnterScore': {
        const { matchId, scores } = command.payload;
        const match = tournament.matches[matchId];
        if (!match) {
          return commandFail('command.matchNotFound');
        }
        if (match.status === 'eliminated' || match.status === 'forfeit') {
          return {
            success: false,
            reason: 'command.matchDecidedWithoutScores',
          };
        }
        const scope = bracketScopeForPlayerMatch(tournament, match);
        const round =
          match.groupId === undefined
            ? findBracketRoundForPlayerPairingIn(scope.bracketMatches, match.playerA, match.playerB)
            : undefined;
        if (round !== undefined && scope.lockedBracketRounds.includes(round)) {
          return commandFail('command.bracketRoundLocked', { round: String(round) });
        }
        if (!canMutateBracketPlayerMatch(tournament, match, scope.bracketMatches, scope.lockedBracketRounds)) {
          return {
            success: false,
            reason: 'command.bracketMatchCannotChange',
          };
        }
        if (match.groupId) {
          const changingExistingGroupResult =
            match.scores.length > 0 || match.status !== 'scheduled';
          if (changingExistingGroupResult && !canMutateExistingGroupPhaseMatchScores(tournament, match)) {
            return {
              success: false,
              reason: 'command.groupResultCannotChange',
            };
          }
        }
        if (!isMatchScoreLegal(scores)) {
          return {
            success: false,
            reason: 'command.invalidScores',
          };
        }
        match.scores = scores;
        match.status = 'finished';
        match.winner = playerMatchWinner(match);
        releaseTableForFinishedOrClearedMatch(tournament, matchId);
        this.reconcileBracketAfterScore(tournament);
        return { success: true };
      }
      case 'ClearMatchScores': {
        const { matchId } = command.payload;
        const match = tournament.matches[matchId];
        if (!match) {
          return commandFail('command.matchNotFound');
        }
        if (match.groupId) {
          if (match.scores.length === 0 && match.status === 'scheduled') {
            return commandFail('command.noScoresToClear');
          }
          if (!canMutateExistingGroupPhaseMatchScores(tournament, match)) {
            return {
              success: false,
              reason: 'command.groupResultCannotClear',
            };
          }
          match.scores = [];
          match.status = 'scheduled';
          delete match.winner;
          releaseTableForFinishedOrClearedMatch(tournament, matchId);
          this.reconcileBracketAfterScore(tournament);
          return { success: true };
        }
        if (!match.groupId && match.status === 'eliminated') {
          return commandFail('command.eliminatedResultsCannotClear');
        }
        const scope = bracketScopeForPlayerMatch(tournament, match);
        const round =
          findBracketRoundForPlayerPairingIn(scope.bracketMatches, match.playerA, match.playerB);
        if (round !== undefined && scope.lockedBracketRounds.includes(round)) {
          return commandFail('command.bracketRoundLocked', { round: String(round) });
        }
        if (!canMutateBracketPlayerMatch(tournament, match, scope.bracketMatches, scope.lockedBracketRounds)) {
          return {
            success: false,
            reason: 'command.bracketMatchCannotClear',
          };
        }
        match.scores = [];
        match.status = 'scheduled';
        delete match.winner;
        releaseTableForFinishedOrClearedMatch(tournament, matchId);
        this.reconcileBracketAfterScore(tournament);
        return { success: true };
      }
      case 'EnterTeamScore': {
        const { matchId, scores } = command.payload;
        const teamMatch = tournament.teamMatches[matchId];
        if (!teamMatch) {
          return commandFail('command.teamMatchNotFound');
        }
        teamMatch.scores = scores;
        teamMatch.status = 'finished';
        teamMatch.winner = teamMatchWinner(teamMatch);
        this.reconcileBracketAfterScore(tournament);
        return { success: true };
      }
      case 'PlayerForfeit': {
        const { playerId, phase, groupMode } = command.payload;
        if (!tournament.players[playerId]) {
          return commandFail('command.playerNotFound');
        }
        forfeitPlayer(tournament, playerId, phase, groupMode);
        return { success: true };
      }
      case 'TeamForfeit': {
        const { teamId, phase } = command.payload;
        if (!tournament.teams[teamId]) {
          return commandFail('command.teamNotFound');
        }
        if (phase === 'group') {
          return commandFail('command.teamGroupForfeitsNotSupported');
        }
        forfeitTeam(tournament, teamId, phase);
        return { success: true };
      }
      case 'SetRoundLock': {
        const { bracketRound, locked } = command.payload;
        if (!Number.isInteger(bracketRound) || bracketRound < 1) {
          return commandFail('command.invalidBracketRound');
        }
        if (locked) {
          if (!tournament.lockedBracketRounds.includes(bracketRound)) {
            tournament.lockedBracketRounds.push(bracketRound);
            tournament.lockedBracketRounds.sort((a, b) => a - b);
          }
          return { success: true };
        }
        if (!tournament.lockedBracketRounds.includes(bracketRound)) {
          return { success: true };
        }
        if (bracketRoundHasFinishedPlayerMatch(tournament, bracketRound)) {
          return commandFail('command.cannotUnlockBracketRoundHasScores');
        }
        tournament.lockedBracketRounds = tournament.lockedBracketRounds.filter((r) => r !== bracketRound);
        return { success: true };
      }
      case 'SetSeedings': {
        const { playerIds } = command.payload;
        if (!Array.isArray(playerIds) || playerIds.length === 0) {
          return commandFail('command.seedingsMustBeNonEmpty');
        }
        for (const pid of playerIds) {
          if (!tournament.players[pid]) {
            return commandFail('command.unknownPlayerInSeedings', { pid });
          }
        }
        tournament.seedings = [...playerIds];
        recomputeClassTournamentSlices(tournament);
        return { success: true };
      }
      case 'SetHandicapConfig': {
        const normalized = normalizeHandicapConfig(command.payload.config ?? undefined);
        if (command.payload.config != null && !normalized) {
          return commandFail('command.invalidHandicapConfiguration');
        }
        if (normalized?.system === 'classification') {
          return commandFail('model.classificationHandicapsNotImplemented');
        }
        if (normalized) {
          tournament.handicapConfig = normalized;
        } else {
          delete tournament.handicapConfig;
        }
        return { success: true };
      }
      case 'SetTournamentClasses': {
        const { classes } = command.payload;
        if (!Array.isArray(classes)) {
          return commandFail('command.classesMustBeArray');
        }

        const normalized: Array<{ id: string; name: string }> = [];
        for (const c of classes) {
          const name = String(c.name ?? '').trim();
          if (!name) {
            return commandFail('command.classNeedsDisplayName');
          }
          let id = String(c.id ?? '').trim();
          if (!id) {
            id = newTournamentClassId();
          }
          normalized.push({ id, name });
        }
        const idSet = new Set<string>();
        for (const c of normalized) {
          if (idSet.has(c.id)) {
            return commandFail('command.duplicateClassId');
          }
          idSet.add(c.id);
        }

        const hasPlayers = Object.keys(tournament.players).length > 0;
        const hadMulti = tournament.classDefinitions.length >= 2;
        const willMulti = normalized.length >= 2;

        if (hasPlayers && !hadMulti && willMulti) {
          return {
            success: false,
            reason: 'command.defineTwoClassesBeforePlayers',
          };
        }
        if (hasPlayers && hadMulti && willMulti) {
          const oldIds = new Set(tournament.classDefinitions.map((x) => x.id));
          if (oldIds.size !== idSet.size || [...oldIds].some((id) => !idSet.has(id))) {
            return {
              success: false,
              reason: 'command.cannotChangeClassesWhilePlayersExist',
            };
          }
        }

        tournament.classDefinitions = normalized;
        for (const pid of Object.keys(tournament.players)) {
          if (!tournament.playerClassFlags[pid]) {
            tournament.playerClassFlags[pid] = {};
          }
          for (const def of tournament.classDefinitions) {
            if (tournament.playerClassFlags[pid][def.id] === undefined) {
              tournament.playerClassFlags[pid][def.id] = false;
            }
          }
        }
        recomputeClassTournamentSlices(tournament);
        return { success: true };
      }
      case 'SetPlayerClassFlags': {
        const { playerId, flags } = command.payload;
        if (!tournament.players[playerId]) {
          return commandFail('command.playerNotFound');
        }
        if (!flags || typeof flags !== 'object') {
          return commandFail('command.flagsObjectRequired');
        }
        if (!tournament.playerClassFlags[playerId]) {
          tournament.playerClassFlags[playerId] = {};
        }
        const valid = new Set(tournament.classDefinitions.map((c) => c.id));
        for (const [k, v] of Object.entries(flags)) {
          if (!valid.has(k)) continue;
          tournament.playerClassFlags[playerId][k] = Boolean(v);
        }
        recomputeClassTournamentSlices(tournament);
        return { success: true };
      }
      case 'SetGroups': {
        if (tournamentUsesClassTabs(tournament)) {
          return {
            success: false,
            reason: 'command.useSetClassGroupsFromClassTab',
          };
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.groupsNotAvailableWithTeamMatch');
        }
        const payload = command.payload as SetGroupsPayload;
        const hasGroups = 'groups' in payload && payload.groups !== undefined;
        const hasSize = 'targetGroupSize' in payload;
        const hasCount = 'targetGroupCount' in payload;
        if ((hasGroups ? 1 : 0) + (hasSize ? 1 : 0) + (hasCount ? 1 : 0) > 1) {
          return {
            success: false,
            reason: 'command.setGroupsPassOneOf',
          };
        }
        let shuffleGroupMemberOrder = false;
        let groups: Array<{ id: string; label?: string; playerIds: string[] }>;
        if (hasSize || hasCount) {
          shuffleGroupMemberOrder = true;
          const rawList = (payload as { playerIds: unknown }).playerIds;
          if (!Array.isArray(rawList)) {
            return {
              success: false,
              reason: 'command.playerIdsMustBeArray',
            };
          }
          const ordered: string[] = [];
          const seenPid = new Set<string>();
          for (const x of rawList) {
            const pid = String(x ?? '').trim();
            if (!pid || seenPid.has(pid)) continue;
            if (!tournament.players[pid]) {
              return commandFail('command.unknownPlayer', { pid });
            }
            seenPid.add(pid);
            ordered.push(pid);
          }
          if (hasSize) {
            const ts = Number((payload as { targetGroupSize: number }).targetGroupSize);
            const tInt = Math.floor(ts);
            if (!Number.isFinite(ts) || tInt < 1) {
              return commandFail('command.targetGroupSizePositive');
            }
            const defs = buildNumberedGroupsFromPlayerOrder(ordered, tInt);
            groups = defs.map((g) => ({ id: g.id, label: g.label, playerIds: g.playerIds }));
          } else {
            const tc = Number((payload as { targetGroupCount: number }).targetGroupCount);
            const gInt = Math.floor(tc);
            if (!Number.isFinite(tc) || gInt < 1) {
              return commandFail('command.targetGroupCountPositive');
            }
            const defs = buildNumberedGroupsFromPlayerOrderByGroupCount(ordered, gInt);
            groups = defs.map((g) => ({ id: g.id, label: g.label, playerIds: g.playerIds }));
          }
        } else if (hasGroups) {
          const arr = (payload as { groups: unknown }).groups;
          if (!Array.isArray(arr)) {
            return commandFail('command.groupsMustBeArray');
          }
          groups = arr as Array<{ id: string; label?: string; playerIds: string[] }>;
        } else {
          return {
            success: false,
            reason: 'command.setGroupsRequiresOneOf',
          };
        }
        for (const mid of Object.keys(tournament.matches)) {
          const m = tournament.matches[mid];
          if (m.groupId && !m.classId) {
            delete tournament.matches[mid];
          }
        }
        const rec: Record<string, GroupDefinition> = {};
        const gidSeen = new Set<string>();
        const pidSeen = new Set<string>();
        for (const raw of groups) {
          const id = String(raw.id ?? '').trim();
          if (!id) {
            return commandFail('command.eachGroupNeedsId');
          }
          if (gidSeen.has(id)) {
            return commandFail('command.duplicateGroupId');
          }
          gidSeen.add(id);
          const label = String(raw.label ?? '').trim();
          const playerIds = Array.isArray(raw.playerIds) ? [...raw.playerIds] : [];
          for (const pid of playerIds) {
            if (!tournament.players[pid]) {
              return commandFail('command.unknownPlayerInGroup', { id, pid });
            }
            if (pidSeen.has(pid)) {
              return commandFail('command.playerInMultipleGroups', { pid });
            }
            pidSeen.add(pid);
          }
          rec[id] = {
            id,
            ...(label ? { label } : {}),
            playerIds: shuffleGroupMemberOrder
              ? shuffleDeterministic(playerIds, `${command.id}:group-order:${id}`)
              : [...playerIds],
          };
        }
        tournament.groups = rec;
        addGroupRoundRobinMatches(tournament, rec, undefined);
        return { success: true };
      }
      case 'SetPlayerGroup': {
        if (tournamentUsesClassTabs(tournament)) {
          return commandFail('command.playerGroupMoveNotSupportedMultiClass');
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.groupsNotAvailableWithTeamMatch');
        }
        const { playerId: pidRaw, groupId: gidRaw } = command.payload;
        const pid = String(pidRaw ?? '').trim();
        if (!pid || !tournament.players[pid]) {
          return commandFail('command.playerNotFound');
        }
        const targetGroupId = gidRaw === undefined || gidRaw === null ? null : String(gidRaw).trim();
        if (targetGroupId !== null) {
          if (!targetGroupId) {
            return commandFail('command.groupIdRequired');
          }
          if (!tournament.groups[targetGroupId]) {
            return commandFail('command.groupNotFound', { groupId: targetGroupId });
          }
        }

        const currentGroup = Object.values(tournament.groups).find((g) => g.playerIds.includes(pid));
        const currentGroupId = currentGroup?.id ?? null;
        if (currentGroupId === targetGroupId) {
          return { success: true };
        }

        if (currentGroupId !== null && targetGroupId === null) {
          if (playerHasAnyRecordedGroupMatch(tournament, pid)) {
            return commandFail('command.cannotLeaveGroupAlreadyPlayed');
          }
        }

        // Remove any scheduled group matches for this player across all groups (safe because leaving
        // is blocked once any recorded group play exists).
        deletePlayerScheduledGroupMatches(tournament, pid);

        // Remove player from previous group (if any).
        if (currentGroupId !== null) {
          tournament.groups[currentGroupId]!.playerIds = tournament.groups[currentGroupId]!.playerIds.filter(
            (x) => x !== pid,
          );
        }

        // Add player to new group (if any) and materialize missing round-robin matches vs its members.
        if (targetGroupId !== null) {
          const g = tournament.groups[targetGroupId]!;
          if (!g.playerIds.includes(pid)) {
            g.playerIds = [...g.playerIds, pid];
          }
          for (const other of g.playerIds) {
            if (other === pid) continue;
            const mid = groupMatchIdForPair(g.id, pid, other, undefined);
            if (tournament.matches[mid]) continue;
            tournament.matches[mid] = {
              id: mid,
              playerA: pid,
              playerB: other,
              scores: [],
              status: 'scheduled',
              groupId: g.id,
            };
          }
        }
        return { success: true };
      }
      case 'SetClassGroups': {
        if (!tournamentUsesClassTabs(tournament)) {
          return commandFail('command.setClassGroupsOnlyWithMultipleClasses');
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.groupsNotAvailableWithTeamMatch');
        }
        const payload = command.payload as { classId: string } & SetClassGroupsPayload;
        const cid = String(payload.classId ?? '').trim();
        if (!cid || !tournament.classDefinitions.some((c) => c.id === cid)) {
          return commandFail('command.unknownClassId');
        }
        const slice = tournament.classTournaments[cid];
        if (!slice) {
          return commandFail('command.classSliceNotFound');
        }
        const eligible = new Set(slice.seedings);
        const hasGroups = 'groups' in payload && payload.groups !== undefined;
        const hasSize = 'targetGroupSize' in payload;
        const hasCount = 'targetGroupCount' in payload;
        if ((hasGroups ? 1 : 0) + (hasSize ? 1 : 0) + (hasCount ? 1 : 0) > 1) {
          return {
            success: false,
            reason: 'command.setClassGroupsPassOneOf',
          };
        }
        let shuffleGroupMemberOrder = false;
        let groups: Array<{ id: string; label?: string; playerIds: string[] }>;
        if (hasSize || hasCount) {
          shuffleGroupMemberOrder = true;
          const rawList = (payload as { playerIds: unknown }).playerIds;
          if (!Array.isArray(rawList)) {
            return {
              success: false,
              reason: 'command.playerIdsMustBeArray',
            };
          }
          const ordered: string[] = [];
          const seenPid = new Set<string>();
          for (const x of rawList) {
            const pid = String(x ?? '').trim();
            if (!pid || seenPid.has(pid)) continue;
            if (!eligible.has(pid)) {
              return commandFail('command.playerNotInClassSeedingList', { pid });
            }
            seenPid.add(pid);
            ordered.push(pid);
          }
          if (hasSize) {
            const ts = Number((payload as { targetGroupSize: number }).targetGroupSize);
            const tInt = Math.floor(ts);
            if (!Number.isFinite(ts) || tInt < 1) {
              return commandFail('command.targetGroupSizePositive');
            }
            const defs = buildNumberedGroupsFromPlayerOrder(ordered, tInt);
            groups = defs.map((g) => ({ id: g.id, label: g.label, playerIds: g.playerIds }));
          } else {
            const tc = Number((payload as { targetGroupCount: number }).targetGroupCount);
            const gInt = Math.floor(tc);
            if (!Number.isFinite(tc) || gInt < 1) {
              return commandFail('command.targetGroupCountPositive');
            }
            const defs = buildNumberedGroupsFromPlayerOrderByGroupCount(ordered, gInt);
            groups = defs.map((g) => ({ id: g.id, label: g.label, playerIds: g.playerIds }));
          }
        } else if (hasGroups) {
          const arr = (payload as { groups: unknown }).groups;
          if (!Array.isArray(arr)) {
            return commandFail('command.groupsMustBeArray');
          }
          groups = arr as Array<{ id: string; label?: string; playerIds: string[] }>;
        } else {
          return {
            success: false,
            reason: 'command.setClassGroupsRequiresOneOf',
          };
        }
        for (const mid of Object.keys(tournament.matches)) {
          const m = tournament.matches[mid];
          if (m.classId === cid && m.groupId) {
            delete tournament.matches[mid];
          }
        }
        const rec: Record<string, GroupDefinition> = {};
        const gidSeen = new Set<string>();
        const pidSeen = new Set<string>();
        for (const raw of groups) {
          const id = String(raw.id ?? '').trim();
          if (!id) {
            return commandFail('command.eachGroupNeedsId');
          }
          if (gidSeen.has(id)) {
            return commandFail('command.duplicateGroupId');
          }
          gidSeen.add(id);
          const label = String(raw.label ?? '').trim();
          const playerIds = Array.isArray(raw.playerIds) ? [...raw.playerIds] : [];
          for (const pid of playerIds) {
            if (!eligible.has(pid)) {
              return commandFail('command.playerNotInClassSeedingList', { pid });
            }
            if (pidSeen.has(pid)) {
              return commandFail('command.playerInMultipleGroups', { pid });
            }
            pidSeen.add(pid);
          }
          rec[id] = {
            id,
            ...(label ? { label } : {}),
            playerIds: shuffleGroupMemberOrder
              ? shuffleDeterministic(playerIds, `${command.id}:class:${cid}:group-order:${id}`)
              : [...playerIds],
          };
        }
        slice.groups = rec;
        addGroupRoundRobinMatches(tournament, rec, cid);
        return { success: true };
      }
      case 'GenerateGroupRoundRobin': {
        const { classId: cidRaw } = command.payload;
        const cid = cidRaw ? String(cidRaw).trim() : undefined;
        if (tournamentUsesClassTabs(tournament)) {
          if (!cid || !tournament.classDefinitions.some((c) => c.id === cid)) {
            return {
              success: false,
              reason: 'command.classIdRequiredForGroupMatches',
            };
          }
        } else if (cid) {
          return commandFail('command.classIdMustNotBeSetSingleClass');
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.groupRoundRobinNotWithTeamMatch');
        }
        const groupsRecord = cid ? tournament.classTournaments[cid]?.groups ?? {} : tournament.groups;
        if (Object.keys(groupsRecord).length === 0) {
          return commandFail('command.defineGroupsBeforeRoundRobin');
        }
        addGroupRoundRobinMatches(tournament, groupsRecord, cid);
        return { success: true };
      }
      case 'GenerateBracket': {
        if (tournamentUsesClassTabs(tournament)) {
          return {
            success: false,
            reason: 'command.globalBracketDisabledMultiClass',
          };
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.cannotGenerateBracketWithTeamMatch');
        }
        const { cullToPowerOfTwo, shuffleKey, tieBreakSalt, cullByGroupPlacement, classId, bracketSeedingMode } =
          command.payload;
        try {
          const bm = generateBracket(tournament.seedings, tournament, {
            fillByes: true,
            cullToPowerOfTwo: cullToPowerOfTwo ?? false,
            ...(shuffleKey !== undefined ? { shuffleKey } : {}),
            ...(tieBreakSalt !== undefined ? { tieBreakSalt } : {}),
            ...(cullByGroupPlacement ? { cullByGroupPlacement: true } : {}),
            ...(classId !== undefined ? { classId } : {}),
            ...(bracketSeedingMode !== undefined ? { bracketSeedingMode } : {}),
          });
          applyBracketToTournament(tournament, bm);
        } catch (e) {
          return commandFailFromText(e instanceof Error ? e.message : String(e));
        }
        return { success: true };
      }
      case 'ClearBracket': {
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.cannotClearBracketWithTeamMatch');
        }
        const err = clearBracketFromTournament(tournament, command.payload.classId);
        if (err) {
          return commandFail(err.key, err.params);
        }
        return { success: true };
      }
      case 'EliminateLowestBracketRound': {
        if (tournamentUsesClassTabs(tournament)) {
          return {
            success: false,
            reason: 'command.globalBracketActionsDisabledMultiClass',
          };
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.bracketEliminationNotWithTeamMatch');
        }
        const { round, classId, tieBreakSalt } = command.payload;
        const r = Math.floor(Number(round));
        if (!Number.isFinite(r) || r < 1) {
          return commandFail('command.roundMustBePositive');
        }
        const err = eliminateLowestRankedPlayersInBracketRound(tournament, r, classId, tieBreakSalt);
        if (err) {
          return commandFail(err.key, err.params);
        }
        this.reconcileBracketAfterScore(tournament);
        return { success: true };
      }
      case 'AssignTables': {
        const { tableIds, round } = command.payload;
        if (!tableIds?.length) {
          return commandFail('command.atLeastOneTableId');
        }
        scheduleRound(tournament, tableIds, round);
        return { success: true };
      }
      case 'SetTournamentTables': {
        const { tableIds } = command.payload;
        if (!Array.isArray(tableIds)) {
          return commandFail('command.tableIdsMustBeArray');
        }
        setTournamentTables(tournament, tableIds);
        return { success: true };
      }
      case 'AssignMatchToTable': {
        const { matchId, tableId } = command.payload;
        if (!matchId?.trim() || !tableId?.trim()) {
          return commandFail('command.matchIdAndTableIdRequired');
        }
        try {
          assignMatchToTable(tournament, matchId, tableId);
        } catch (e) {
          return commandFailFromText(e instanceof Error ? e.message : String(e));
        }
        return { success: true };
      }
      case 'ClearMatchTableAssignment': {
        const { matchId } = command.payload;
        if (!matchId?.trim()) {
          return commandFail('command.matchIdRequired');
        }
        if (!tournament.matches[matchId]) {
          return commandFail('command.matchNotFound');
        }
        if (!tournament.tableAssignments.some((a) => a.matchId === matchId)) {
          return commandFail('command.matchNotAssignedToTable');
        }
        clearMatchTableAssignment(tournament, matchId);
        return { success: true };
      }
      case 'AdvanceBracketRound': {
        try {
          advanceBracketRound(tournament);
        } catch (e) {
          return commandFailFromText(e instanceof Error ? e.message : String(e));
        }
        return { success: true };
      }
      case 'RenamePlayer': {
        const { playerId, name, handicap } = command.payload;
        const p = tournament.players[playerId];
        if (!p) {
          return commandFail('command.playerNotFound');
        }
        if (isPlayerDisplayNameTaken(tournament, name, playerId)) {
          return commandFail('command.playerNameAlreadyExists');
        }
        p.name = name;
        if (handicap !== undefined) {
          const hcErr = tournament.handicapConfig
            ? validatePlayerHandicapForTournament(tournament, handicap)
            : undefined;
          if (hcErr) {
            return commandFail(hcErr.key, hcErr.params);
          }
          p.handicap = tournament.handicapConfig
            ? clampPlayerHandicapValue(tournament.handicapConfig, handicap)
            : Math.max(0, Math.floor(handicap));
        }
        return { success: true };
      }
      default:
        return commandFail('command.unknownCommandType');
    }
  }

  private reconcileBracketAfterScore(tournament: Tournament): void {
    if (tournament.bracketMatches.length > 0) {
      this.reconcileBracketScope(tournament, tournament.bracketMatches, true);
    }
    for (const slice of Object.values(tournament.classTournaments)) {
      if (slice.bracketMatches.length > 0) {
        this.reconcileBracketScope(tournament, slice.bracketMatches, false);
      }
    }
  }

  private reconcileBracketScope(tournament: Tournament, bracketMatches: BracketMatch[], allowAdvance: boolean): void {
    if (bracketMatches.length === 0) {
      return;
    }
    // Winners must be recomputed from player rows *before* feeding them into the next round; otherwise
    // a cleared match still leaves stale `bm.winner` on children and `propagate` copies wrong seeds upward.
    settleBracketWinnersIn(tournament, bracketMatches);
    propagateBracketSeedsFromChildWinners(bracketMatches);
    settleBracketWinnersIn(tournament, bracketMatches);
    syncBracketMatchPlayerRows(tournament, bracketMatches);
    if (materializeReadyNextRoundBracketSlots(bracketMatches)) {
      settleBracketWinnersIn(tournament, bracketMatches);
      propagateBracketSeedsFromChildWinners(bracketMatches);
      settleBracketWinnersIn(tournament, bracketMatches);
      syncBracketMatchPlayerRows(tournament, bracketMatches);
    }
    if (allowAdvance) {
      const currentRound = Math.max(0, ...bracketMatches.map((m) => bracketMatchRound(m)));
      if (isBracketRoundCompleteIn(bracketMatches, currentRound)) {
        advanceBracketRound(tournament);
      }
    }
    ensureBracketPhasePlayerMatchesIn(tournament, bracketMatches);
  }
}
