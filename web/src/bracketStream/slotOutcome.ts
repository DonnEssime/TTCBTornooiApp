import type { BracketMatch } from 'ttc-tornooiapp';

export type BracketSlotOutcome = 'winner' | 'loser';

/** Per-slot outcome when the bracket match has a decided winner (including bye). Empty seed side returns null (no bold/strike on bye text). */
export function bracketSlotOutcome(match: BracketMatch, side: 'a' | 'b'): BracketSlotOutcome | null {
  if (!match.winner) return null;
  const pid = side === 'a' ? match.seedA : match.seedB;
  if (!pid) return null;
  if (match.winner === pid) return 'winner';
  return 'loser';
}
