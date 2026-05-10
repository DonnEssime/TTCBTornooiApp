import type { BracketMatch } from 'ttc-tornooiapp';

export type BracketBNode = {
  match: BracketMatch;
  left?: BracketBNode;
  right?: BracketBNode;
};

/**
 * Reconstructs a binary tree from column-major bracket data (`buildBracketColumnsForDisplay`),
 * matching `advanceBracketRound` pairing: round r match j is fed by round r−1 matches 2j and 2j+1.
 */
export function bracketTreeFromColumns(cols: BracketMatch[][]): BracketBNode | null {
  if (cols.length === 0) return null;
  const depth = cols.length;

  function nodeAt(ri: number, j: number): BracketBNode {
    const m = cols[ri]![j]!;
    if (ri === 0) return { match: m };
    return {
      match: m,
      left: nodeAt(ri - 1, 2 * j),
      right: nodeAt(ri - 1, 2 * j + 1),
    };
  }

  return nodeAt(depth - 1, 0);
}
