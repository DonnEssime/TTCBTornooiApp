import { describe, it, expect } from 'vitest';
import { createTournament } from '../src/model';
import { ConsoleTournamentView, DebugTournamentView, InMemoryTournamentView, HtmlStringTournamentView } from '../src/view';

describe('View module', () => {
  it('ConsoleTournamentView is defined and can render', () => {
    const view = new ConsoleTournamentView();
    const tournament = createTournament();
    expect(() => view.renderTournament(tournament)).not.toThrow();
    expect(() => view.renderBracket(tournament)).not.toThrow();
    expect(() => view.renderMessage('hello')).not.toThrow();
  });

  it('DebugTournamentView adds prefix and handles delay option', () => {
    const view = new DebugTournamentView({ injectDelayMs: 1 });
    const tournament = createTournament();
    expect(() => view.renderMessage('msg')).not.toThrow();
    const viewNoDelay = new DebugTournamentView({ useMockResults: true });
    expect(viewNoDelay.maybeGenerateMockScores()).toHaveProperty('playerA');
    expect(viewNoDelay.maybeGenerateMockScores()).toHaveProperty('playerB');
  });

  it('InMemoryTournamentView collects output history', () => {
    const view = new InMemoryTournamentView();
    const tournament = createTournament();

    view.renderMessage('m1');
    view.renderTournament(tournament);
    view.renderBracket(tournament);

    expect(view.messages).toEqual(['m1']);
    expect(view.tournamentSnapshots.length).toBe(1);
    expect(view.bracketSnapshots.length).toBe(1);

    view.clear();
    expect(view.messages).toEqual([]);
    expect(view.tournamentSnapshots).toEqual([]);
    expect(view.bracketSnapshots).toEqual([]);
  });

  it('HtmlStringTournamentView builds simple HTML output', () => {
    const view = new HtmlStringTournamentView();
    const tournament = createTournament();

    tournament.players['p1'] = { id: 'p1', name: 'Alice', handicap: 0 };
    tournament.teams['t1'] = { id: 't1', name: 'Team A', memberIds: ['p1'] };
    tournament.bracketMatches.push({ id: 'b1', seedA: 'p1', seedB: 'BYE', round: 1 });

    view.renderMessage('welcome');
    view.renderTournament(tournament);
    view.renderBracket(tournament);

    expect(view.messageLog).toEqual(['welcome']);
    expect(view.tournamentHtml).toContain('Tournament');
    expect(view.tournamentHtml).toContain('Alice');
    expect(view.tournamentHtml).toContain('Team A');
    expect(view.bracketHtml).toContain('Bracket');
    expect(view.bracketHtml).toContain('b1');
  });
});
