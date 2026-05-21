import type { BracketMatch } from 'ttc-tornooiapp';
import {
  bracketMatchRound,
  bracketWinnerToNextRoundSeed,
  compareBracketMatchId,
} from 'ttc-tornooiapp';
import { bracketTreeFromColumns, type BracketBNode } from './buildTree';

function syntheticBracketRound(round: number, count: number): BracketMatch[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `__ph-${round}-${i}`,
    round,
  }));
}

/** Full knockout column layout: real rounds plus synthetic later rounds until final. */
export function buildBracketColumnsForDisplay(matches: BracketMatch[]): BracketMatch[][] {
  const r1 = matches.filter((m) => bracketMatchRound(m) === 1).sort(compareBracketMatchId);
  if (r1.length === 0) return [];
  const leafSlots = r1.length * 2;
  const depth = Math.round(Math.log2(leafSlots));
  const cols: BracketMatch[][] = [];
  for (let r = 1; r <= depth; r++) {
    const expected = leafSlots / 2 ** r;
    const real = matches.filter((m) => bracketMatchRound(m) === r).sort(compareBracketMatchId);
    if (real.length === expected) {
      cols.push(real);
      continue;
    }
    if (real.length === 0) {
      cols.push(syntheticBracketRound(r, expected));
      continue;
    }
    if (real.length < expected) {
      const ph = syntheticBracketRound(r, expected - real.length).map((m, i) => ({
        ...m,
        id: `__ph-${r}-${real.length + i}`,
      }));
      cols.push([...real, ...ph]);
      continue;
    }
    cols.push(real);
  }
  return cols;
}

function applyFeederWinners(node: BracketBNode): void {
  if (!node.left || !node.right) return;
  applyFeederWinners(node.left);
  applyFeederWinners(node.right);
  const m = node.match;
  if (!m.seedA) {
    const w = bracketWinnerToNextRoundSeed(node.left.match.winner);
    if (w) m.seedA = w;
  }
  if (!m.seedB) {
    const w = bracketWinnerToNextRoundSeed(node.right.match.winner);
    if (w) m.seedB = w;
  }
}

/** Display columns with feeder seeds filled from child winners (matches BracketStreamView input). */
export function displayBracketColumns(matches: BracketMatch[]): BracketMatch[][] {
  const cols = buildBracketColumnsForDisplay(matches);
  if (cols.length === 0) return cols;
  const colsCopy = cols.map((c) => c.map((m) => ({ ...m })));
  const root = bracketTreeFromColumns(colsCopy);
  if (root) applyFeederWinners(root);
  return colsCopy;
}
