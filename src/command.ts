import { Tournament, createTournament, forfeitPlayer, forfeitTeam } from './model';

export type CommandType =
  | 'CreatePlayer'
  | 'CreateTeam'
  | 'CreateMatch'
  | 'CreateTeamMatch'
  | 'EnterScore'
  | 'EnterTeamScore'
  | 'PlayerForfeit'
  | 'TeamForfeit'
  | 'SetRoundLock';

export interface CommandBase {
  id: string;
  type: CommandType;
  timestamp: string;
  dependsOn: string[]; // command IDs this command depends on
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

export type Command =
  | CreatePlayerCommand
  | CreateTeamCommand
  | CreateMatchCommand
  | CreateTeamMatchCommand
  | EnterScoreCommand
  | EnterTeamScoreCommand
  | PlayerForfeitCommand
  | TeamForfeitCommand;

export interface CommandResult {
  success: boolean;
  reason?: string;
}

export class CommandRunner {
  private tournament: Tournament;
  private history: Map<string, Command> = new Map();
  private dependents: Map<string, Set<string>> = new Map();

  constructor(tournament?: Tournament) {
    this.tournament = tournament ?? createTournament();
  }

  execute(command: Command): CommandResult {
    if (this.history.has(command.id)) {
      return { success: false, reason: 'Command ID already exists' };
    }

    for (const dep of command.dependsOn || []) {
      if (!this.history.has(dep)) {
        return { success: false, reason: `Missing dependency: ${dep}` };
      }
    }

    // apply command to tournament state
    const applyResult = this.applyCommand(command);
    if (!applyResult.success) {
      return applyResult;
    }

    this.history.set(command.id, command);

    // dependency graph building
    for (const dep of command.dependsOn || []) {
      if (!this.dependents.has(dep)) {
        this.dependents.set(dep, new Set());
      }
      this.dependents.get(dep)!.add(command.id);
    }

    if (!this.dependents.has(command.id)) {
      this.dependents.set(command.id, new Set());
    }

    return { success: true };
  }

  canUndo(commandId: string): boolean {
    if (!this.history.has(commandId)) return false;
    const deps = this.dependents.get(commandId); // dependents of this command
    return !deps || deps.size === 0;
  }

  undo(commandId: string): CommandResult {
    if (!this.history.has(commandId)) {
      return { success: false, reason: 'Command not found' };
    }

    if (!this.canUndo(commandId)) {
      return { success: false, reason: 'Command has dependents; cannot undo' };
    }

    const cmd = this.history.get(commandId)!;

    // remove command from the state by full replay
    this.history.delete(commandId);

    // update dependent graph
    for (const [target, deps] of this.dependents.entries()) {
      if (deps.has(commandId)) {
        deps.delete(commandId);
      }
    }
    this.dependents.delete(commandId);

    // reconstruct state from scratch from remaining history
    this.tournament = createTournament();
    const remainingCommands = Array.from(this.history.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    this.history = new Map();
    this.dependents = new Map();

    for (const c of remainingCommands) {
      this.execute(c);
    }

    return { success: true };
  }

  private applyCommand(command: Command): CommandResult {
    switch (command.type) {
      case 'CreatePlayer': {
        const { playerId, name, handicap } = command.payload;
        if (this.tournament.players[playerId]) {
          return { success: false, reason: 'Player already exists' };
        }
        this.tournament.players[playerId] = { id: playerId, name, handicap };
        return { success: true };
      }
      case 'CreateTeam': {
        const { teamId, name, memberIds } = command.payload;
        if (this.tournament.teams[teamId]) {
          return { success: false, reason: 'Team already exists' };
        }
        for (const playerId of memberIds) {
          if (!this.tournament.players[playerId]) {
            return { success: false, reason: `Player not found: ${playerId}` };
          }
        }
        this.tournament.teams[teamId] = { id: teamId, name, memberIds };
        return { success: true };
      }
      case 'CreateMatch': {
        const { matchId, playerA, playerB } = command.payload;
        if (this.tournament.matches[matchId]) {
          return { success: false, reason: 'Match already exists' };
        }
        if (!this.tournament.players[playerA] || !this.tournament.players[playerB]) {
          return { success: false, reason: 'Player not found' };
        }
        this.tournament.matches[matchId] = {
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
        if (this.tournament.teamMatches[matchId]) {
          return { success: false, reason: 'Team match already exists' };
        }
        if (!this.tournament.teams[teamA] || !this.tournament.teams[teamB]) {
          return { success: false, reason: 'Team not found' };
        }
        if (teamA === teamB) {
          return { success: false, reason: 'A team cannot play itself' };
        }
        this.tournament.teamMatches[matchId] = {
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
        const match = this.tournament.matches[matchId];
        if (!match) {
          return { success: false, reason: 'Match not found' };
        }
        match.scores = scores;
        match.status = 'finished';
        return { success: true };
      }
      case 'EnterTeamScore': {
        const { matchId, scores } = command.payload;
        const teamMatch = this.tournament.teamMatches[matchId];
        if (!teamMatch) {
          return { success: false, reason: 'Team match not found' };
        }
        teamMatch.scores = scores;
        teamMatch.status = 'finished';
        return { success: true };
      }
      case 'PlayerForfeit': {
        const { playerId, phase, groupMode } = command.payload as { playerId: string; phase: 'group' | 'bracket'; groupMode?: 'auto-win' | 'not-played' };
        if (!this.tournament.players[playerId]) {
          return { success: false, reason: 'Player not found' };
        }
        forfeitPlayer(this.tournament, playerId, phase, groupMode);
        return { success: true };
      }
      case 'TeamForfeit': {
        const { teamId, phase, groupMode } = command.payload as { teamId: string; phase: 'group' | 'bracket'; groupMode?: 'auto-win' | 'not-played' };
        if (!this.tournament.teams[teamId]) {
          return { success: false, reason: 'Team not found' };
        }
        forfeitTeam(this.tournament, teamId, phase, groupMode);
        return { success: true };
      }
      default:
        return { success: false, reason: 'Unknown command type' };
    }
  }

  getTournament(): Tournament {
    return this.tournament;
  }

  getHistory(): Command[] {
    return Array.from(this.history.values());
  }
}
