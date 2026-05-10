import {
  CommandRunner,
  CommandResult,
  type Command,
  CreatePlayerCommand,
  CreateTeamCommand,
  CreateMatchCommand,
  CreateTeamMatchCommand,
  EnterScoreCommand,
  ClearMatchScoresCommand,
  EnterTeamScoreCommand,
  GenerateBracketCommand,
  SetRoundLockCommand,
  SetSeedingsCommand,
  SetTournamentClassesCommand,
  SetPlayerClassFlagsCommand,
  SetGroupsCommand,
  SetClassGroupsCommand,
  GenerateGroupRoundRobinCommand,
  type AssignTablesCommand,
  type AdvanceBracketRoundCommand,
  type PlayerForfeitCommand,
  type TeamForfeitCommand,
  type RenamePlayerCommand,
  type UndoCommand,
} from './command';
import { Tournament } from './model';
import { replayCommandsFromJsonLines } from './storage';
import { TournamentView } from './view';

export interface ControllerOptions {
  debug?: boolean;
}

function sortHistory(commands: Command[]): Command[] {
  return [...commands.entries()]
    .sort(([i, a], [j, b]) => {
      const byTime = a.timestamp.localeCompare(b.timestamp);
      if (byTime !== 0) return byTime;
      return i - j;
    })
    .map(([, c]) => c);
}

export class TournamentController {
  private runner: CommandRunner;
  private view?: TournamentView;
  private options: ControllerOptions;

  constructor(init?: Tournament | CommandRunner, options: ControllerOptions = {}) {
    if (init instanceof CommandRunner) {
      this.runner = init;
    } else {
      this.runner = new CommandRunner(init);
    }
    this.options = options;
  }

  setView(view: TournamentView): void {
    this.view = view;
  }

  getTournament(): Tournament {
    return this.runner.getTournament();
  }

  getCommandLog(): Command[] {
    return sortHistory(this.runner.getHistory());
  }

  findLatestActiveCreateMatchCommandId(matchId: string): string | undefined {
    return this.runner.findLatestActiveCreateMatchCommandId(matchId);
  }

  private makeTimestamp(): string {
    return new Date().toISOString();
  }

  private newCommandId(): string {
    return `cmd-${Math.random().toString(36).substring(2, 10)}`;
  }

  createPlayer(playerId: string, name: string, handicap = 0, commandId?: string): CommandResult {
    const command: CreatePlayerCommand = {
      id: commandId ?? this.newCommandId(),
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
      id: commandId ?? this.newCommandId(),
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
      id: commandId ?? this.newCommandId(),
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
      id: commandId ?? this.newCommandId(),
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
      id: commandId ?? this.newCommandId(),
      type: 'EnterScore',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId, scores },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`EnterScore: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    if (result.success && this.getTournament().bracketMatches.length > 0) {
      this.view?.renderBracket(this.getTournament());
    }
    return result;
  }

  clearMatchScores(matchId: string, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: ClearMatchScoresCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'ClearMatchScores',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`ClearMatchScores: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    if (result.success && this.getTournament().bracketMatches.length > 0) {
      this.view?.renderBracket(this.getTournament());
    }
    return result;
  }

  enterTeamScore(matchId: string, scores: Array<{ playerA: number; playerB: number }>, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: EnterTeamScoreCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'EnterTeamScore',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { matchId, scores },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`EnterTeamScore: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    if (result.success && this.getTournament().bracketMatches.length > 0) {
      this.view?.renderBracket(this.getTournament());
    }
    return result;
  }

  /** Ordered player ids for bracket generation (command-logged for replay). */
  setSeedings(playerIds: string[], dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: SetSeedingsCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'SetSeedings',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { playerIds },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`SetSeedings: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  setTournamentClasses(
    classes: Array<{ id?: string; name: string }>,
    dependsOn: string[] = [],
    commandId?: string,
  ): CommandResult {
    const command: SetTournamentClassesCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'SetTournamentClasses',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { classes },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`SetTournamentClasses: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  setPlayerClassFlags(
    playerId: string,
    flags: Record<string, boolean>,
    dependsOn: string[] = [],
    commandId?: string,
  ): CommandResult {
    const command: SetPlayerClassFlagsCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'SetPlayerClassFlags',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { playerId, flags },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`SetPlayerClassFlags: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  setGroups(
    payload:
      | Array<{ id: string; label?: string; playerIds: string[] }>
      | { targetGroupSize: number; playerIds: string[] },
    dependsOn: string[] = [],
    commandId?: string,
  ): CommandResult {
    const command: SetGroupsCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'SetGroups',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: Array.isArray(payload) ? { groups: payload } : payload,
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`SetGroups: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  setClassGroups(
    classId: string,
    payload:
      | Array<{ id: string; label?: string; playerIds: string[] }>
      | { targetGroupSize: number; playerIds: string[] },
    dependsOn: string[] = [],
    commandId?: string,
  ): CommandResult {
    const command: SetClassGroupsCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'SetClassGroups',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: Array.isArray(payload) ? { classId, groups: payload } : { classId, ...payload },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`SetClassGroups: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  generateGroupRoundRobin(classId: string | undefined, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: GenerateGroupRoundRobinCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'GenerateGroupRoundRobin',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: classId ? { classId } : {},
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`GenerateGroupRoundRobin: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  generateBracket(
    fillByes = true,
    cullToPowerOfTwo = false,
    dependsOn: string[] = [],
    commandId?: string,
    shuffleKey?: string,
    extras?: { cullByGroupPlacement?: boolean; classId?: string },
  ): CommandResult {
    const payload: {
      fillByes: boolean;
      cullToPowerOfTwo: boolean;
      shuffleKey?: string;
      cullByGroupPlacement?: boolean;
      classId?: string;
    } = {
      fillByes,
      cullToPowerOfTwo,
    };
    if (shuffleKey !== undefined) {
      payload.shuffleKey = shuffleKey;
    }
    if (extras?.cullByGroupPlacement) {
      payload.cullByGroupPlacement = true;
    }
    if (extras?.classId !== undefined) {
      payload.classId = extras.classId;
    }
    const command: GenerateBracketCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'GenerateBracket',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload,
    };
    const result = this.runner.execute(command);
    if (!result.success) {
      this.view?.renderMessage(`generateBracket failed: ${result.reason ?? ''}`);
      return result;
    }
    this.view?.renderBracket(this.getTournament());
    return result;
  }

  setRoundLock(bracketRound: number, locked: boolean, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: SetRoundLockCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'SetRoundLock',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { bracketRound, locked },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`SetRoundLock: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  advanceBracketRound(dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: AdvanceBracketRoundCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'AdvanceBracketRound',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: {},
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`AdvanceBracketRound: ${JSON.stringify(result)}`);
    if (result.success) {
      this.view?.renderBracket(this.getTournament());
    }
    return result;
  }

  assignTables(tables: string[], round: number, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: AssignTablesCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'AssignTables',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { tableIds: tables, round },
    };
    const result = this.runner.execute(command);
    if (result.success) {
      this.view?.renderMessage(`Scheduled round ${round} on tables: ${tables.join(', ')}`);
    } else {
      this.view?.renderMessage(`AssignTables failed: ${result.reason ?? ''}`);
    }
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  playerForfeit(
    playerId: string,
    phase: 'group' | 'bracket',
    groupMode?: 'auto-win' | 'not-played',
    dependsOn: string[] = [],
    commandId?: string,
  ): CommandResult {
    const command: PlayerForfeitCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'PlayerForfeit',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { playerId, phase, groupMode },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`PlayerForfeit: ${JSON.stringify(result)}`);
    if (result.success) {
      this.view?.renderMessage(`Player ${playerId} forfeited in ${phase}`);
    }
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  /** Forfeits the team in standalone team vs team matches (not supported for group-stage team tournaments). */
  teamForfeit(teamId: string, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: TeamForfeitCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'TeamForfeit',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: { teamId, phase: 'bracket' },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`TeamForfeit: ${JSON.stringify(result)}`);
    if (result.success) {
      this.view?.renderMessage(`Team ${teamId} forfeited in bracket`);
    }
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  renamePlayer(playerId: string, name: string, handicap?: number, dependsOn: string[] = [], commandId?: string): CommandResult {
    const command: RenamePlayerCommand = {
      id: commandId ?? this.newCommandId(),
      type: 'RenamePlayer',
      timestamp: this.makeTimestamp(),
      dependsOn,
      payload: handicap !== undefined ? { playerId, name, handicap } : { playerId, name },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`RenamePlayer: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    return result;
  }

  canUndo(commandId: string): boolean {
    return this.runner.canUndo(commandId);
  }

  canRedo(): boolean {
    return this.runner.canRedo();
  }

  /**
   * Records an {@link UndoCommand} in the log. Redo is not a command: use {@link redo} to pop the last Undo.
   */
  undo(targetCommandId: string, commandId?: string): CommandResult {
    const id = commandId ?? this.newCommandId();
    const command: UndoCommand = {
      id,
      type: 'Undo',
      timestamp: this.makeTimestamp(),
      dependsOn: [targetCommandId],
      payload: { targetCommandId },
    };
    const result = this.runner.execute(command);
    this.view?.renderMessage(`Undo ${targetCommandId}: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    if (result.success && this.getTournament().bracketMatches.length > 0) {
      this.view?.renderBracket(this.getTournament());
    }
    return result;
  }

  /** Append Undo for the latest active (non-Undone) mutation, if allowed. Bracket round‑1 CreateMatch commands that depend on the same GenerateBracket are all undone first, then that GenerateBracket, in one user action. */
  undoLast(commandId?: string): CommandResult {
    const hist = sortHistory(this.runner.getHistory());
    for (let i = hist.length - 1; i >= 0; i--) {
      const c = hist[i];
      if (c.type === 'Undo') continue;
      if (!this.runner.canUndo(c.id)) continue;

      if (c.type === 'CreateMatch') {
        const genId = c.dependsOn.find((d) => typeof d === 'string' && d.startsWith('cmd-gen'));
        if (genId) {
          const genCmd = hist.find((x) => x.id === genId);
          if (genCmd?.type === 'GenerateBracket') {
            let r: CommandResult = { success: true };
            let firstUndo = true;
            while (true) {
              const h = sortHistory(this.runner.getHistory());
              let removedOne = false;
              for (let j = h.length - 1; j >= 0; j--) {
                const x = h[j];
                if (x.type === 'Undo') continue;
                if (!this.runner.canUndo(x.id)) continue;
                if (x.type !== 'CreateMatch' || !x.dependsOn.includes(genId)) break;
                r = this.undo(x.id, firstUndo ? commandId : undefined);
                firstUndo = false;
                if (!r.success) return r;
                removedOne = true;
                break;
              }
              if (!removedOne) break;
            }
            if (this.runner.canUndo(genId)) {
              r = this.undo(genId, firstUndo ? commandId : undefined);
            }
            return r;
          }
        }
      }

      return this.undo(c.id, commandId);
    }
    return { success: false, reason: 'Nothing to undo' };
  }

  /** Removes the trailing Undo from the log (redo); not recorded as a command. */
  redo(): CommandResult {
    const result = this.runner.redoPop();
    this.view?.renderMessage(`Redo: ${JSON.stringify(result)}`);
    this.view?.renderTournament(this.getTournament());
    if (result.success && this.getTournament().bracketMatches.length > 0) {
      this.view?.renderBracket(this.getTournament());
    }
    return result;
  }

  runDebugSequence(): void {
    if (!this.options.debug) return;
    this.view?.renderMessage('Running debug sequence');
  }
}

/** Build a controller whose runner was produced by replaying JSONL command lines. */
export function tournamentControllerFromCommandLog(
  text: string,
  options: ControllerOptions = {},
): { controller: TournamentController; replay: ReturnType<typeof replayCommandsFromJsonLines> } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const runner = new CommandRunner();
  const replay = replayCommandsFromJsonLines(lines, runner);
  return { controller: new TournamentController(runner, options), replay };
}
