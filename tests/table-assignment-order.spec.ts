import { describe, it, expect } from 'vitest';
import { assignMatchToTable, createTournament, setTournamentTables, matchesOnTablesInAssignmentOrder } from '../src/model';

describe('table assignment ordering', () => {
  it('returns in-progress table matches in assignment (drag) order', () => {
    const t = createTournament();
    t.players = {
      a: { id: 'a', name: 'A', handicap: 0 },
      b: { id: 'b', name: 'B', handicap: 0 },
      c: { id: 'c', name: 'C', handicap: 0 },
      d: { id: 'd', name: 'D', handicap: 0 },
    };
    t.matches = {
      m1: { id: 'm1', playerA: 'a', playerB: 'b', scores: [], status: 'scheduled' },
      m2: { id: 'm2', playerA: 'c', playerB: 'd', scores: [], status: 'scheduled' },
    };

    setTournamentTables(t, ['1', '2']);

    // Simulate user dragging m2 onto a table first, then m1.
    assignMatchToTable(t, 'm2', '2');
    assignMatchToTable(t, 'm1', '1');

    expect(matchesOnTablesInAssignmentOrder(t).map((m) => m.id)).toEqual(['m2', 'm1']);
  });
});

