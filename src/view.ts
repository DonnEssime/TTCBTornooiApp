import { Tournament } from './model';

export interface TournamentView {
  renderTournament(tournament: Tournament): void;
  renderBracket(tournament: Tournament): void;
  renderMessage(message: string): void;
}

export class ConsoleTournamentView implements TournamentView {
  renderTournament(tournament: Tournament): void {
    console.log('Tournament state:', JSON.stringify(tournament, null, 2));
  }

  renderBracket(tournament: Tournament): void {
    console.log('Bracket matches:', JSON.stringify(tournament.bracketMatches, null, 2));
  }

  renderMessage(message: string): void {
    console.log('Message:', message);
  }
}

export interface DebugOptions {
  useMockResults?: boolean;
  injectDelayMs?: number;
}

export class DebugTournamentView extends ConsoleTournamentView {
  private options: DebugOptions;

  constructor(options: DebugOptions = {}) {
    super();
    this.options = options;
  }

  renderMessage(message: string): void {
    if (this.options.injectDelayMs && this.options.injectDelayMs > 0) {
      const start = Date.now();
      while (Date.now() - start < this.options.injectDelayMs) {
        // busy-wait to simulate slow debug
      }
    }
    super.renderMessage('[DEBUG] ' + message);
  }

  maybeGenerateMockScores(): { playerA: number; playerB: number } {
    if (!this.options.useMockResults) {
      return { playerA: 0, playerB: 0 };
    }
    const a = Math.floor(Math.random() * 6) + 11;
    const b = Math.floor(Math.random() * 4) + 7;
    return Math.abs(a - b) >= 2 ? { playerA: Math.max(a, b), playerB: Math.min(a, b) } : { playerA: 11, playerB: 9 };
  }
}

export class InMemoryTournamentView implements TournamentView {
  public tournamentSnapshots: Tournament[] = [];
  public bracketSnapshots: Tournament[] = [];
  public messages: string[] = [];

  renderTournament(tournament: Tournament): void {
    this.tournamentSnapshots.push(JSON.parse(JSON.stringify(tournament)));
  }

  renderBracket(tournament: Tournament): void {
    this.bracketSnapshots.push(JSON.parse(JSON.stringify(tournament)));
  }

  renderMessage(message: string): void {
    this.messages.push(message);
  }

  clear(): void {
    this.tournamentSnapshots = [];
    this.bracketSnapshots = [];
    this.messages = [];
  }
}

export class HtmlStringTournamentView implements TournamentView {
  public tournamentHtml = '';
  public bracketHtml = '';
  public messageLog: string[] = [];

  renderTournament(tournament: Tournament): void {
    this.tournamentHtml = this.renderTournamentToHtml(tournament);
  }

  renderBracket(tournament: Tournament): void {
    this.bracketHtml = this.renderBracketToHtml(tournament);
  }

  renderMessage(message: string): void {
    this.messageLog.push(message);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private renderTournamentToHtml(tournament: Tournament): string {
    const playersHtml = Object.values(tournament.players)
      .map((p) => `<li>${this.escapeHtml(p.id)}: ${this.escapeHtml(p.name)} (handicap ${p.handicap})</li>`)
      .join('');
    const teamsHtml = Object.values(tournament.teams)
      .map((t) => `<li>${this.escapeHtml(t.id)}: ${this.escapeHtml(t.name)} (${t.memberIds.map((id) => this.escapeHtml(id)).join(', ')})</li>`)
      .join('');

    return `
      <section class="tournament">
        <h2>Tournament</h2>
        <div>Players</div>
        <ul>${playersHtml}</ul>
        <div>Teams</div>
        <ul>${teamsHtml}</ul>
        <div>Table assignments: ${tournament.tableAssignments.length}</div>
      </section>
    `;
  }

  private renderBracketToHtml(tournament: Tournament): string {
    const rows = tournament.bracketMatches
      .map((m) => `<li>${this.escapeHtml(m.id)}: ${this.escapeHtml(String(m.seedA))} vs ${this.escapeHtml(String(m.seedB))} (round ${m.round})</li>`)
      .join('');

    return `
      <section class="bracket">
        <h2>Bracket</h2>
        <ul>${rows}</ul>
      </section>
    `;
  }
}
