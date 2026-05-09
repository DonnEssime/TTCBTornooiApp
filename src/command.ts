import {
  Tournament,
  advanceBracketRound,
  applyBracketToTournament,
  bracketRoundHasFinishedPlayerMatch,
  createTournament,
  findBracketRoundForPlayerPairing,
  forfeitPlayer,
  forfeitTeam,
  generateBracket,
  isBracketRoundComplete,
  playerMatchWinner,
  recomputeClassTournamentSlices,
  scheduleRound,
  settleBracketWinners,
  teamMatchWinner,
  tournamentUsesClassTabs,
} from './model';

export type CommandType =
  | 'CreatePlayer'
  | 'CreateTeam'
  | 'CreateMatch'
  | 'CreateTeamMatch'
  | 'EnterScore'
  | 'EnterTeamScore'
  | 'PlayerForfeit'
  | 'TeamForfeit'
  | 'SetRoundLock'
  | 'SetSeedings'
  | 'SetTournamentClasses'
  | 'SetPlayerClassFlags'
  | 'GenerateBracket'
  | 'AssignTables'
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
  payload: { matchId: string; playerA: string; playerB: string };
}

export interface CreateTeamMatchCommand extends CommandBase {
  type: 'CreateTeamMatch';
  payload: { matchId: string; teamA: string; teamB: string };
}

export interface EnterScoreCommand extends CommandBase {
  type: 'EnterScore';
  payload: { matchId: string; scores: Array<{ playerA: number; playerB: number }> };
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

export interface SetTournamentClassesCommand extends CommandBase {
  type: 'SetTournamentClasses';
  payload: { classes: Array<{ id?: string; name: string }> };
}

export interface SetPlayerClassFlagsCommand extends CommandBase {
  type: 'SetPlayerClassFlags';
  payload: { playerId: string; flags: Record<string, boolean> };
}

export interface GenerateBracketCommand extends CommandBase {
  type: 'GenerateBracket';
  payload: { fillByes: boolean; cullToPowerOfTwo: boolean };
}

export interface AssignTablesCommand extends CommandBase {
  type: 'AssignTables';
  payload: { tableIds: string[]; round: number };
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
  | EnterTeamScoreCommand
  | PlayerForfeitCommand
  | TeamForfeitCommand
  | SetRoundLockCommand
  | SetSeedingsCommand
  | SetTournamentClassesCommand
  | SetPlayerClassFlagsCommand
  | GenerateBracketCommand
  | AssignTablesCommand
  | AdvanceBracketRoundCommand
  | RenamePlayerCommand
  | UndoCommand;

export interface CommandResult {
  success: boolean;
  reason?: string;
}

function sortLog(log: Command[]): Command[] {
  return [...log].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
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
      return { success: false, reason: 'Command ID already exists' };
    }

    for (const dep of command.dependsOn || []) {
      if (!this.commandById.has(dep)) {
        return { success: false, reason: `Missing dependency: ${dep}` };
      }
    }

    if (command.type === 'Undo') {
      const u = command as UndoCommand;
      const ok = this.canAppendUndo(u.payload.targetCommandId);
      if (!ok.ok) {
        return { success: false, reason: ok.reason ?? 'Cannot append Undo' };
      }
    }

    this.orderedLog.push(command);
    this.commandById.set(command.id, command);

    const err = this.rebuildFromLog();
    if (err) {
      this.orderedLog.pop();
      this.commandById.delete(command.id);
      return { success: false, reason: err };
    }

    return { success: true };
  }

  canUndo(commandId: string): boolean {
    return this.canAppendUndo(commandId).ok;
  }

  /** Whether a new Undo could target this command (no active dependents after it). */
  canAppendUndo(targetCommandId: string): { ok: boolean; reason?: string } {
    const sorted = sortLog(this.orderedLog);
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const tgt = byId.get(targetCommandId);
    if (!tgt) {
      return { ok: false, reason: 'Command not found' };
    }

    if (tgt.type === 'Undo') {
      const pos = sorted.findIndex((c) => c.id === targetCommandId);
      if (pos < 0) {
        return { ok: false, reason: 'Command not found' };
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
          reason: 'Cannot reverse this Undo while later active mutations exist',
        };
      }
      return { ok: true };
    }

    const { suppressed } = this.computeSuppressedWithVictims(sorted, byId);
    if (suppressed.has(targetCommandId)) {
      return { ok: false, reason: 'Target is already undone' };
    }

    const pos = sorted.findIndex((c) => c.id === targetCommandId);
    if (pos < 0) return { ok: false, reason: 'Command not found' };

    for (let i = pos + 1; i < sorted.length; i++) {
      const c = sorted[i];
      if (c.type === 'Undo') continue;
      if (suppressed.has(c.id)) continue;
      if (dependsReach(c, targetCommandId, byId)) {
        return { ok: false, reason: 'Command has active dependents; cannot undo' };
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
      return { success: false, reason: 'Nothing to redo' };
    }
    this.orderedLog.pop();
    this.commandById.delete(last.id);
    const err = this.rebuildFromLog();
    if (err) {
      this.orderedLog.push(last);
      this.commandById.set(last.id, last);
      return { success: false, reason: err };
    }
    return { success: true };
  }

  getTournament(): Tournament {
    return this.tournament;
  }

  getHistory(): Command[] {
    return sortLog(this.orderedLog);
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

  private rebuildFromLog(): string | undefined {
    const sorted = sortLog(this.orderedLog);
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const { suppressed } = this.computeSuppressedWithVictims(sorted, byId);

    const t = createTournament();

    for (const c of sorted) {
      if (c.type === 'Undo') continue;
      if (suppressed.has(c.id)) continue;
      const r = this.applyCommandCore(t, c);
      if (!r.success) {
        return r.reason ?? 'Replay failed';
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
          return { success: false, reason: 'Player already exists' };
        }
        tournament.players[playerId] = { id: playerId, name, handicap };
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
          return { success: false, reason: 'Team already exists' };
        }
        for (const playerId of memberIds) {
          if (!tournament.players[playerId]) {
            return { success: false, reason: `Player not found: ${playerId}` };
          }
        }
        tournament.teams[teamId] = { id: teamId, name, memberIds };
        return { success: true };
      }
      case 'CreateMatch': {
        const { matchId, playerA, playerB } = command.payload;
        if (Object.keys(tournament.teamMatches).length > 0) {
          return { success: false, reason: 'Player matches are not allowed in a team vs team fixture' };
        }
        if (tournament.matches[matchId]) {
          return { success: false, reason: 'Match already exists' };
        }
        if (!tournament.players[playerA] || !tournament.players[playerB]) {
          return { success: false, reason: 'Player not found' };
        }
        tournament.matches[matchId] = {
          id: matchId,
          playerA,
          playerB,
          scores: [],
          status: 'scheduled',
        };
        return { success: true };
      }
      case 'CreateTeamMatch': {
        const { matchId, teamA, teamB } = command.payload;
        if (tournament.bracketMatches.length > 0) {
          return { success: false, reason: 'Team vs team matches cannot be used alongside a player bracket' };
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return { success: false, reason: 'Only one team vs team match is allowed per tournament' };
        }
        if (tournament.teamMatches[matchId]) {
          return { success: false, reason: 'Team match already exists' };
        }
        if (!tournament.teams[teamA] || !tournament.teams[teamB]) {
          return { success: false, reason: 'Team not found' };
        }
        if (teamA === teamB) {
          return { success: false, reason: 'A team cannot play itself' };
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
          return { success: false, reason: 'Match not found' };
        }
        const round = findBracketRoundForPlayerPairing(tournament, match.playerA, match.playerB);
        if (round !== undefined && tournament.lockedBracketRounds.includes(round)) {
          return { success: false, reason: `Bracket round ${round} is locked` };
        }
        match.scores = scores;
        match.status = 'finished';
        match.winner = playerMatchWinner(match);
        this.reconcileBracketAfterScore(tournament);
        return { success: true };
      }
      case 'EnterTeamScore': {
        const { matchId, scores } = command.payload;
        const teamMatch = tournament.teamMatches[matchId];
        if (!teamMatch) {
          return { success: false, reason: 'Team match not found' };
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
          return { success: false, reason: 'Player not found' };
        }
        forfeitPlayer(tournament, playerId, phase, groupMode);
        return { success: true };
      }
      case 'TeamForfeit': {
        const { teamId, phase } = command.payload;
        if (!tournament.teams[teamId]) {
          return { success: false, reason: 'Team not found' };
        }
        if (phase === 'group') {
          return { success: false, reason: 'Team group forfeits are not supported' };
        }
        forfeitTeam(tournament, teamId, phase);
        return { success: true };
      }
      case 'SetRoundLock': {
        const { bracketRound, locked } = command.payload;
        if (!Number.isInteger(bracketRound) || bracketRound < 1) {
          return { success: false, reason: 'Invalid bracket round' };
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
          return { success: false, reason: 'Cannot unlock: a match in this bracket round already has scores' };
        }
        tournament.lockedBracketRounds = tournament.lockedBracketRounds.filter((r) => r !== bracketRound);
        return { success: true };
      }
      case 'SetSeedings': {
        const { playerIds } = command.payload;
        if (!Array.isArray(playerIds) || playerIds.length === 0) {
          return { success: false, reason: 'Seedings must be a non-empty ordered player id list' };
        }
        for (const pid of playerIds) {
          if (!tournament.players[pid]) {
            return { success: false, reason: `Unknown player in seedings: ${pid}` };
          }
        }
        tournament.seedings = [...playerIds];
        recomputeClassTournamentSlices(tournament);
        return { success: true };
      }
      case 'SetTournamentClasses': {
        const { classes } = command.payload;
        if (!Array.isArray(classes)) {
          return { success: false, reason: 'classes must be an array' };
        }

        const normalized: Array<{ id: string; name: string }> = [];
        for (const c of classes) {
          const name = String(c.name ?? '').trim();
          if (!name) {
            return { success: false, reason: 'Each class needs a non-empty display name' };
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
            return { success: false, reason: 'Duplicate class id' };
          }
          idSet.add(c.id);
        }

        const hasPlayers = Object.keys(tournament.players).length > 0;
        const hadMulti = tournament.classDefinitions.length >= 2;
        const willMulti = normalized.length >= 2;

        if (hasPlayers && !hadMulti && willMulti) {
          return {
            success: false,
            reason: 'Define at least two competition classes before adding players.',
          };
        }
        if (hasPlayers && hadMulti && willMulti) {
          const oldIds = new Set(tournament.classDefinitions.map((x) => x.id));
          if (oldIds.size !== idSet.size || [...oldIds].some((id) => !idSet.has(id))) {
            return {
              success: false,
              reason: 'Cannot add or remove a competition class while players exist.',
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
          return { success: false, reason: 'Player not found' };
        }
        if (!flags || typeof flags !== 'object') {
          return { success: false, reason: 'flags object required' };
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
      case 'GenerateBracket': {
        if (tournamentUsesClassTabs(tournament)) {
          return {
            success: false,
            reason:
              'Global bracket is disabled when multiple competition classes are defined; generate a bracket from each class tab instead.',
          };
        }
        if (Object.keys(tournament.teamMatches).length > 0) {
          return { success: false, reason: 'Cannot generate bracket while a team vs team match exists' };
        }
        const { fillByes, cullToPowerOfTwo } = command.payload;
        try {
          const bm = generateBracket(tournament.seedings, tournament, {
            fillByes: fillByes ?? true,
            cullToPowerOfTwo: cullToPowerOfTwo ?? false,
          });
          applyBracketToTournament(tournament, bm);
        } catch (e) {
          return { success: false, reason: e instanceof Error ? e.message : String(e) };
        }
        return { success: true };
      }
      case 'AssignTables': {
        const { tableIds, round } = command.payload;
        if (!tableIds?.length) {
          return { success: false, reason: 'At least one table id is required' };
        }
        scheduleRound(tournament, tableIds, round);
        return { success: true };
      }
      case 'AdvanceBracketRound': {
        try {
          advanceBracketRound(tournament);
        } catch (e) {
          return { success: false, reason: e instanceof Error ? e.message : String(e) };
        }
        return { success: true };
      }
      case 'RenamePlayer': {
        const { playerId, name, handicap } = command.payload;
        const p = tournament.players[playerId];
        if (!p) {
          return { success: false, reason: 'Player not found' };
        }
        p.name = name;
        if (handicap !== undefined) {
          p.handicap = handicap;
        }
        return { success: true };
      }
      default:
        return { success: false, reason: 'Unknown command type' };
    }
  }

  private reconcileBracketAfterScore(tournament: Tournament): void {
    if (tournament.bracketMatches.length === 0) {
      return;
    }
    settleBracketWinners(tournament);
    const currentRound = Math.max(0, ...tournament.bracketMatches.map((m) => m.round));
    if (isBracketRoundComplete(tournament, currentRound)) {
      advanceBracketRound(tournament);
    }
  }
}
