import {
  addGroupRoundRobinMatches,
  applyBracketToTrack,
  getCompetitionTrack,
  listCompetitionTracks,
  mutateCompetitionTrack,
  resolveTrackClassId,
  setTrackGroups,
  trackSeedingsForBracket,
  tournamentUsesClassTabs,
} from './competition-track';
import {
  Tournament,
  advanceBracketRoundIn,
  bracketRoundHasFinishedPlayerMatchIn,
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
  inferBracketClassIdFromPlayerMatchId,
  isBracketRoundCompleteIn,
  isMatchScoreLegal,
  materializeReadyNextRoundBracketSlots,
  playerMatchWinner,
  propagateBracketSeedsFromChildWinners,
  recomputeClassTournamentSlices,
  assignMatchToTable,
  clearMatchTableAssignment,
  releaseTableForFinishedOrClearedMatch,
  scheduleRound,
  setTournamentTables,
  settleBracketWinnersIn,
  syncBracketMatchPlayerRows,
  teamMatchWinner,
  isTeamMatchScoreLegal,
  isPlayerDisplayIdentityTaken,
  isMiscActive,
  normalizeMiscConfig,
  normalizedPlayerMiscValue,
  DEFAULT_MISC_CONFIG,
  type MiscConfig,
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
  | 'SetMiscConfig'
  | 'SetTournamentClasses'
  | 'AddTournamentClass'
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
  payload: { playerId: string; name: string; handicap: number; misc?: string };
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
  payload: { playerId: string; phase: 'group' | 'bracket'; groupMode?: 'auto-win' | 'not-played'; classId?: string };
}

export interface TeamForfeitCommand extends CommandBase {
  type: 'TeamForfeit';
  payload: { teamId: string; phase: 'group' | 'bracket'; groupMode?: 'auto-win' | 'not-played' };
}

export interface SetRoundLockCommand extends CommandBase {
  type: 'SetRoundLock';
  payload: { bracketRound: number; locked: boolean; classId?: string };
}

export interface SetSeedingsCommand extends CommandBase {
  type: 'SetSeedings';
  payload: { playerIds: string[] };
}

export interface SetHandicapConfigCommand extends CommandBase {
  type: 'SetHandicapConfig';
  payload: { config: HandicapConfig | null };
}

export interface SetMiscConfigCommand extends CommandBase {
  type: 'SetMiscConfig';
  payload: { config: MiscConfig | null };
}

export interface SetTournamentClassesCommand extends CommandBase {
  type: 'SetTournamentClasses';
  payload: { classes: Array<{ id?: string; name: string }> };
}

export interface AddTournamentClassCommand extends CommandBase {
  type: 'AddTournamentClass';
  payload: { name: string; id?: string };
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
  payload: { playerId: string; groupId?: string | null; classId?: string };
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
  payload: { tableIds: string[]; round: number; classId?: string };
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
  payload: { classId?: string };
}

export interface RenamePlayerCommand extends CommandBase {
  type: 'RenamePlayer';
  payload: { playerId: string; name: string; handicap?: number; misc?: string };
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
  | SetMiscConfigCommand
  | SetTournamentClassesCommand
  | AddTournamentClassCommand
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

function playerHasAnyRecordedGroupMatch(
  tournament: Tournament,
  playerId: string,
  classId: string | undefined,
): boolean {
  for (const m of Object.values(tournament.matches)) {
    if (!m?.groupId) continue;
    if (m.playerA !== playerId && m.playerB !== playerId) continue;
    if (classId !== undefined) {
      if (m.classId !== classId) continue;
    } else if (m.classId) {
      continue;
    }
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
        const miscRaw = command.payload.misc ?? '';
        if (tournament.players[playerId]) {
          return commandFail('command.playerAlreadyExists');
        }
        const miscLabel = tournament.miscConfig?.label ?? DEFAULT_MISC_CONFIG.label;
        if (isMiscActive(tournament)) {
          if (!normalizedPlayerMiscValue(miscRaw)) {
            return commandFail('command.playerMiscRequired', { label: miscLabel });
          }
        }
        if (isPlayerDisplayIdentityTaken(tournament, name, miscRaw)) {
          return commandFail(
            isMiscActive(tournament) ? 'command.playerNameMiscAlreadyExists' : 'command.playerNameAlreadyExists',
            isMiscActive(tournament) ? { label: miscLabel } : undefined,
          );
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
        const misc = isMiscActive(tournament) ? miscRaw.trim().replace(/\s+/g, ' ') : '';
        tournament.players[playerId] = { id: playerId, name, handicap: hc, misc };
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
        if (listCompetitionTracks(tournament).some((tr) => tr.bracketMatches.length > 0)) {
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
        if (!tournament.matchFinishOrder.includes(matchId)) {
          tournament.matchFinishOrder.push(matchId);
        }
        releaseTableForFinishedOrClearedMatch(tournament, matchId);
        this.reconcileBracketAfterScore(
          tournament,
          match.classId ?? inferBracketClassIdFromPlayerMatchId(tournament, matchId),
        );
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
          tournament.matchFinishOrder = tournament.matchFinishOrder.filter((id) => id !== matchId);
          releaseTableForFinishedOrClearedMatch(tournament, matchId);
          this.reconcileBracketAfterScore(
            tournament,
            match.classId ?? inferBracketClassIdFromPlayerMatchId(tournament, matchId),
          );
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
        tournament.matchFinishOrder = tournament.matchFinishOrder.filter((id) => id !== matchId);
        releaseTableForFinishedOrClearedMatch(tournament, matchId);
        this.reconcileBracketAfterScore(
          tournament,
          match.classId ?? inferBracketClassIdFromPlayerMatchId(tournament, matchId),
        );
        return { success: true };
      }
      case 'EnterTeamScore': {
        const { matchId, scores } = command.payload;
        const teamMatch = tournament.teamMatches[matchId];
        if (!teamMatch) {
          return commandFail('command.teamMatchNotFound');
        }
        const draft = { ...teamMatch, scores, status: 'finished' as const };
        if (!isTeamMatchScoreLegal(draft, tournament)) {
          return {
            success: false,
            reason: 'command.invalidScores',
          };
        }
        teamMatch.scores = scores;
        teamMatch.status = 'finished';
        teamMatch.winner = teamMatchWinner(teamMatch);
        this.reconcileBracketAfterScore(tournament);
        return { success: true };
      }
      case 'PlayerForfeit': {
        const { playerId, phase, groupMode, classId } = command.payload;
        if (!tournament.players[playerId]) {
          return commandFail('command.playerNotFound');
        }
        if (phase === 'group' && tournamentUsesClassTabs(tournament) && classId === undefined) {
          return commandFail('command.classIdRequired');
        }
        const trackResolved = resolveTrackClassId(tournament, classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        forfeitPlayer(tournament, playerId, phase, groupMode, trackResolved.classId);
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
        const { bracketRound, locked, classId } = command.payload;
        if (!Number.isInteger(bracketRound) || bracketRound < 1) {
          return commandFail('command.invalidBracketRound');
        }
        const trackResolved = resolveTrackClassId(tournament, classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        const track = getCompetitionTrack(tournament, trackResolved.classId);
        if (locked) {
          if (!track.lockedBracketRounds.includes(bracketRound)) {
            mutateCompetitionTrack(tournament, trackResolved.classId, (tr) => {
              if (!tr.lockedBracketRounds.includes(bracketRound)) {
                tr.lockedBracketRounds.push(bracketRound);
                tr.lockedBracketRounds.sort((a, b) => a - b);
              }
            });
          }
          return { success: true };
        }
        if (!track.lockedBracketRounds.includes(bracketRound)) {
          return { success: true };
        }
        if (bracketRoundHasFinishedPlayerMatchIn(tournament, track.bracketMatches, bracketRound)) {
          return commandFail('command.cannotUnlockBracketRoundHasScores');
        }
        mutateCompetitionTrack(tournament, trackResolved.classId, (tr) => {
          tr.lockedBracketRounds = tr.lockedBracketRounds.filter((r) => r !== bracketRound);
        });
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
      case 'SetMiscConfig': {
        const normalized = normalizeMiscConfig(command.payload.config ?? undefined);
        if (command.payload.config != null && !normalized) {
          return commandFail('command.invalidMiscConfiguration');
        }
        if (normalized) {
          tournament.miscConfig = normalized;
        } else {
          delete tournament.miscConfig;
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
        const hadMulti = tournament.classDefinitions.length >= 1;
        const willMulti = normalized.length >= 1;

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
      case 'AddTournamentClass': {
        if (!tournamentUsesClassTabs(tournament)) {
          return commandFail('command.addClassOnlyInMultiClassTournament');
        }
        const name = String(command.payload.name ?? '').trim();
        if (!name) {
          return commandFail('command.classNeedsDisplayName');
        }
        let id = String(command.payload.id ?? '').trim();
        if (!id) {
          id = newTournamentClassId();
          command.payload.id = id;
        }
        const existingIds = new Set(tournament.classDefinitions.map((c) => c.id));
        if (existingIds.has(id)) {
          return commandFail('command.duplicateClassId');
        }
        tournament.classDefinitions.push({ id, name });
        for (const pid of Object.keys(tournament.players)) {
          if (!tournament.playerClassFlags[pid]) {
            tournament.playerClassFlags[pid] = {};
          }
          tournament.playerClassFlags[pid][id] = false;
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
        const result = setTrackGroups(
          tournament,
          undefined,
          command.payload as SetGroupsPayload,
          command.id,
          {
            passOneOf: 'command.setGroupsPassOneOf',
            requiresOneOf: 'command.setGroupsRequiresOneOf',
          },
        );
        if (result !== true) {
          return commandFail(result.key, result.params);
        }
        return { success: true };
      }
      case 'SetPlayerGroup': {
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.groupsNotAvailableWithTeamMatch');
        }
        const { playerId: pidRaw, groupId: gidRaw, classId } = command.payload;
        const trackResolved = resolveTrackClassId(tournament, classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        const trackClassId = trackResolved.classId;
        const pid = String(pidRaw ?? '').trim();
        if (!pid || !tournament.players[pid]) {
          return commandFail('command.playerNotFound');
        }
        const targetGroupId = gidRaw === undefined || gidRaw === null ? null : String(gidRaw).trim();
        const track = getCompetitionTrack(tournament, trackClassId);
        if (targetGroupId !== null) {
          if (!targetGroupId) {
            return commandFail('command.groupIdRequired');
          }
          if (!track.groups[targetGroupId]) {
            return commandFail('command.groupNotFound', { groupId: targetGroupId });
          }
        }

        const currentGroup = Object.values(track.groups).find((g) => g.playerIds.includes(pid));
        const currentGroupId = currentGroup?.id ?? null;
        if (currentGroupId === targetGroupId) {
          return { success: true };
        }

        if (currentGroupId !== null && targetGroupId === null) {
          if (playerHasAnyRecordedGroupMatch(tournament, pid, trackClassId)) {
            return commandFail('command.cannotLeaveGroupAlreadyPlayed');
          }
        }

        for (const mid of Object.keys(tournament.matches)) {
          const m = tournament.matches[mid];
          if (!m || !m.groupId) continue;
          if (m.playerA !== pid && m.playerB !== pid) continue;
          if (trackClassId ? m.classId !== trackClassId : Boolean(m.classId)) continue;
          if (m.scores.length > 0 || m.status !== 'scheduled') continue;
          delete tournament.matches[mid];
        }

        if (currentGroupId !== null) {
          const g = track.groups[currentGroupId]!;
          g.playerIds = g.playerIds.filter((x) => x !== pid);
        }

        if (targetGroupId !== null) {
          const g = track.groups[targetGroupId]!;
          if (!g.playerIds.includes(pid)) {
            g.playerIds = [...g.playerIds, pid];
          }
          for (const other of g.playerIds) {
            if (other === pid) continue;
            const mid = groupMatchIdForPair(g.id, pid, other, trackClassId);
            if (tournament.matches[mid]) continue;
            tournament.matches[mid] = {
              id: mid,
              playerA: pid,
              playerB: other,
              scores: [],
              status: 'scheduled',
              groupId: g.id,
              ...(trackClassId ? { classId: trackClassId } : {}),
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
        const { classId: _cid, ...groupPayload } = payload;
        const result = setTrackGroups(tournament, cid, groupPayload, command.id, {
          passOneOf: 'command.setClassGroupsPassOneOf',
          requiresOneOf: 'command.setClassGroupsRequiresOneOf',
        });
        if (result !== true) {
          return commandFail(result.key, result.params);
        }
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
        const groupsRecord = getCompetitionTrack(tournament, cid).groups;
        if (Object.keys(groupsRecord).length === 0) {
          return commandFail('command.defineGroupsBeforeRoundRobin');
        }
        addGroupRoundRobinMatches(tournament, groupsRecord, cid);
        return { success: true };
      }
      case 'GenerateBracket': {
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.cannotGenerateBracketWithTeamMatch');
        }
        const { cullToPowerOfTwo, shuffleKey, tieBreakSalt, cullByGroupPlacement, classId, bracketSeedingMode } =
          command.payload;
        const trackResolved = resolveTrackClassId(tournament, classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        const trackClassId = trackResolved.classId;
        const existingBracket = getCompetitionTrack(tournament, trackClassId).bracketMatches;
        if (existingBracket.length > 0) {
          const clearErr = clearBracketFromTournament(tournament, trackClassId);
          if (clearErr) {
            return commandFail(clearErr.key, clearErr.params);
          }
        }
        const seedings = trackSeedingsForBracket(tournament, trackClassId);
        try {
          const bm = generateBracket(seedings, tournament, {
            fillByes: true,
            cullToPowerOfTwo: cullToPowerOfTwo ?? false,
            ...(shuffleKey !== undefined ? { shuffleKey } : {}),
            ...(tieBreakSalt !== undefined ? { tieBreakSalt } : {}),
            ...(cullByGroupPlacement ? { cullByGroupPlacement: true } : {}),
            ...(trackClassId !== undefined ? { classId: trackClassId } : {}),
            ...(bracketSeedingMode !== undefined ? { bracketSeedingMode } : {}),
          });
          applyBracketToTrack(tournament, bm, trackClassId);
        } catch (e) {
          return commandFailFromText(e instanceof Error ? e.message : String(e));
        }
        return { success: true };
      }
      case 'ClearBracket': {
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.cannotClearBracketWithTeamMatch');
        }
        const trackResolved = resolveTrackClassId(tournament, command.payload.classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        const err = clearBracketFromTournament(tournament, trackResolved.classId);
        if (err) {
          return commandFail(err.key, err.params);
        }
        return { success: true };
      }
      case 'EliminateLowestBracketRound': {
        if (Object.keys(tournament.teamMatches).length > 0) {
          return commandFail('command.bracketEliminationNotWithTeamMatch');
        }
        const { round, classId, tieBreakSalt } = command.payload;
        const trackResolved = resolveTrackClassId(tournament, classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        const r = Math.floor(Number(round));
        if (!Number.isFinite(r) || r < 1) {
          return commandFail('command.roundMustBePositive');
        }
        const err = eliminateLowestRankedPlayersInBracketRound(
          tournament,
          r,
          trackResolved.classId,
          tieBreakSalt,
        );
        if (err) {
          return commandFail(err.key, err.params);
        }
        this.reconcileBracketAfterScore(tournament, trackResolved.classId);
        return { success: true };
      }
      case 'AssignTables': {
        const { tableIds, round, classId } = command.payload;
        if (!tableIds?.length) {
          return commandFail('command.atLeastOneTableId');
        }
        if (tournamentUsesClassTabs(tournament) && classId === undefined) {
          return commandFail('command.classIdRequired');
        }
        const trackResolved = resolveTrackClassId(tournament, classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        scheduleRound(tournament, tableIds, round, trackResolved.classId);
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
        const trackResolved = resolveTrackClassId(tournament, command.payload.classId);
        if ('key' in trackResolved) {
          return commandFail(trackResolved.key);
        }
        const track = getCompetitionTrack(tournament, trackResolved.classId);
        try {
          const added = advanceBracketRoundIn(track.bracketMatches);
          if (added.length > 0) {
            mutateCompetitionTrack(tournament, trackResolved.classId, (tr) => {
              tr.bracketMatches = [...tr.bracketMatches, ...added];
            });
          }
        } catch (e) {
          return commandFailFromText(e instanceof Error ? e.message : String(e));
        }
        return { success: true };
      }
      case 'RenamePlayer': {
        const { playerId, name, handicap, misc } = command.payload;
        const p = tournament.players[playerId];
        if (!p) {
          return commandFail('command.playerNotFound');
        }
        const nextMisc = misc !== undefined ? misc : (p.misc ?? '');
        const miscLabel = tournament.miscConfig?.label ?? DEFAULT_MISC_CONFIG.label;
        if (isMiscActive(tournament) && misc !== undefined && !normalizedPlayerMiscValue(misc)) {
          return commandFail('command.playerMiscRequired', { label: miscLabel });
        }
        if (isPlayerDisplayIdentityTaken(tournament, name, nextMisc, playerId)) {
          return commandFail(
            isMiscActive(tournament) ? 'command.playerNameMiscAlreadyExists' : 'command.playerNameAlreadyExists',
            isMiscActive(tournament) ? { label: miscLabel } : undefined,
          );
        }
        p.name = name;
        if (misc !== undefined) {
          p.misc = isMiscActive(tournament) ? misc.trim().replace(/\s+/g, ' ') : '';
        }
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

  private reconcileBracketAfterScore(tournament: Tournament, classId?: string): void {
    const tracks =
      classId !== undefined ? [getCompetitionTrack(tournament, classId)] : listCompetitionTracks(tournament);
    for (const track of tracks) {
      if (track.bracketMatches.length > 0) {
        this.reconcileBracketScope(tournament, track.bracketMatches, track.classId);
      }
    }
  }

  private reconcileBracketScope(
    tournament: Tournament,
    bracketMatches: BracketMatch[],
    classId: string | undefined,
  ): void {
    if (bracketMatches.length === 0) {
      return;
    }
    // Winners must be recomputed from player rows *before* feeding them into the next round; otherwise
    // a cleared match still leaves stale `bm.winner` on children and `propagate` copies wrong seeds upward.
    settleBracketWinnersIn(tournament, bracketMatches, classId);
    propagateBracketSeedsFromChildWinners(bracketMatches);
    settleBracketWinnersIn(tournament, bracketMatches, classId);
    syncBracketMatchPlayerRows(tournament, bracketMatches, classId);
    if (materializeReadyNextRoundBracketSlots(bracketMatches)) {
      settleBracketWinnersIn(tournament, bracketMatches, classId);
      propagateBracketSeedsFromChildWinners(bracketMatches);
      settleBracketWinnersIn(tournament, bracketMatches, classId);
      syncBracketMatchPlayerRows(tournament, bracketMatches, classId);
    }
    const currentRound = Math.max(0, ...bracketMatches.map((m) => bracketMatchRound(m)));
    if (isBracketRoundCompleteIn(bracketMatches, currentRound)) {
      try {
        const added = advanceBracketRoundIn(bracketMatches);
        if (added.length > 0) {
          mutateCompetitionTrack(tournament, classId, (tr) => {
            tr.bracketMatches = [...tr.bracketMatches, ...added];
          });
        }
      } catch {
        // Incomplete round winners — materialize path may still apply on next score.
      }
    }
    ensureBracketPhasePlayerMatchesIn(
      tournament,
      getCompetitionTrack(tournament, classId).bracketMatches,
      classId,
    );
  }
}
