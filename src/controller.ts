import { CommandRunner, CommandResult, CreatePlayerCommand, CreateTeamCommand, CreateMatchCommand, CreateTeamMatchCommand, EnterScoreCommand, EnterTeamScoreCommand } from './command';
import {
  Tournament,
  createTournament,
  generateBracket,
  applyBracketToTournament,
  settleBracketWinners,
  isBracketRoundComplete,
  advanceBracketRound,
  scheduleRound,
  forfeitPlayer,
  forfeitTeam,
} from './model';
import { TournamentView } from './view';

export interface ControllerOptions {
  debug?: boolean;
}

export class TournamentController {
  private runner: CommandRunner;
  private view?: TournamentView;
  private options: ControllerOptions;

  constructor(tournament?: Tournament, options: ControllerOptions = {}) {
    this.runner = new CommandRunner(tournament);
    this.options = options;
  }

  setView(view: TournamentView): void {
    this.view = view;
  }

  getTournament(): Tournament {
    return this.runner.getTournament();
  }

  private makeTimestamp(): string {
    return new Date().toISOString();
  }

  createPlayer(playerId: string, name: string, handicap = 0, commandId?: string): CommandResult {
    const command: CreatePlayerCommand = {
      id: commandId ?? `cmd-${Math.random().toString(36).substring(2, 10)}`,
      type: 'CreatePlayer',
      timestamp: this.makeTimestamp(),
      dependsOn: [],
      payload: { playerId, name, handicap },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`CreatePlayer: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  createTeam(teamId: string, name: string, memberIds: string[], dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: CreateTeamCommand = {
      id: commandId ?? `cmd-${Math.random().toString(36).substring(2, 10)}`,
      type: 'CreateTeam',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { teamId, name, memberIds },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`CreateTeam: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  createMatch(matchId: string, playerA: string, playerB: string, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: CreateMatchCommand = {
      id: commandId ?? `cmd-${Math.random().toString(36).substring(2, 10)}`,
      type: 'CreateMatch',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId, playerA, playerB },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`CreateMatch: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  createTeamMatch(matchId: string, teamA: string, teamB: string, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: CreateTeamMatchCommand = {
      id: commandId ?? `cmd-${Math.random().toString(36).substring(2, 10)}`,
      type: 'CreateTeamMatch',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId, teamA, teamB },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`CreateTeamMatch: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  enterScore(matchId: string, scores: Array<{ playerA: number; playerB: number }>, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: EnterScoreCommand = {
      id: commandId ?? `cmd-${Math.random().toString(36).substring(2, 10)}`,
      type: 'EnterScore',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId, scores },
    };
    const result = this.runner.execute(command);
    this.settleAndAdvance();
    this.view?.renderMessage(`EnterScore: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  enterTeamScore(matchId: string, scores: Array<{ playerA: number; playerB: number }>, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: EnterTeamScoreCommand = {
      id: commandId ?? `cmd-${Math.random().toString(36).substring(2, 10)}`,
      type: 'EnterTeamScore',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId, scores },
    };
    const result = this.runner.execute(command);
    this.settleAndAdvance();
    this.view?.renderMessage(`EnterTeamScore: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  private settleAndAdvance(): void {
    const tournament = this.getTournament();
    settleBracketWinners(tournament);

    const currentRound = Math.max(0, ...tournament.bracketMatches.map((m) => m.round));
    if (isBracketRoundComplete(tournament, currentRound)) {
      this.view?.renderMessage(`Bracket round ${currentRound} complete; advancing to next round`);
      advanceBracketRound(tournament);
      this.view?.renderBracket(tournament);
    }
  }

  generateBracket(fillByes = true, cullToPowerOfTwo = false): void {
    const tournament = this.getTournament();
    if (Object.keys(tournament.teamMatches).length > 0) {
      this.view?.renderMessage('Cannot generate bracket while a team vs team match exists');
      return;
    }
    try {
      const bracketMatches = generateBracket(tournament.seedings, tournament, { fillByes, cullToPowerOfTwo });
      applyBracketToTournament(tournament, bracketMatches);
    } catch (e) {
      this.view?.renderMessage(`generateBracket failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.view?.renderBracket(tournament);
  }

  advanceBracketRound(): void {
    const tournament = this.getTournament();
    advanceBracketRound(tournament);
    this.view?.renderBracket(tournament);
  }

  assignTables(tables: string[], round: number): void {
    const tournament = this.getTournament();
    scheduleRound(tournament, tables, round);
    this.view?.renderMessage(`Scheduled round ${round} on tables: ${tables.join(', ')}`);
    this.view?.renderTournament(tournament);
  }

  playerForfeit(playerId: string, phase: 'group' | 'bracket', groupMode?: 'auto-win' | 'not-played'): void {
    const tournament = this.getTournament();
    forfeitPlayer(tournament, playerId, phase, groupMode);
    this.view?.renderMessage(`Player ${playerId} forfeited in ${phase}`);
    this.view?.renderTournament(tournament);
  }

  /** Forfeits the team in standalone team vs team matches (not supported for group-stage team tournaments). */
  teamForfeit(teamId: string): void {
    const tournament = this.getTournament();
    forfeitTeam(tournament, teamId, 'bracket');
    this.view?.renderMessage(`Team ${teamId} forfeited in bracket`);
    this.view?.renderTournament(tournament);
  }

  canUndo(commandId: string): boolean {
    return this.runner.canUndo(commandId);
  }

  undo(commandId: string): CommandResult {
    const result = this.runner.undo(commandId);
    this.view?.renderMessage(`Undo ${commandId}: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  runDebugSequence(): void {
    if (!this.options.debug) return;
    this.view?.renderMessage('Running debug sequence');
  }
}
