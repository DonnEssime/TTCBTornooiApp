import type { BracketMatch } from 'ttc-tornooiapp';
import {
  bracketMainDrawEntryRound,
  bracketMatchRound,
  bracketWinnerToNextRoundSeed,
  compareBracketMatchId,
  inferBracketSlotCountFromRoundOne,
} from 'ttc-tornooiapp';
import { bracketTreeFromColumns, type BracketBNode } from './buildTree';

function syntheticBracketRound(round: number, count: number): BracketMatch[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `__ph-${round}-${i}`,
    round,
  }));
}

function matchesInRoundForDisplay(matches: BracketMatch[], round: number): BracketMatch[] {
  return matches.filter((m) => bracketMatchRound(m) === round).sort(compareBracketMatchId);
}

function pushRoundColumn(
  cols: BracketMatch[][],
  matches: BracketMatch[],
  round: number,
  expected: number,
): void {
  const real = matchesInRoundForDisplay(matches, round);
  if (real.length === expected) {
    cols.push(real);
    return;
  }
  if (real.length === 0) {
    cols.push(syntheticBracketRound(round, expected));
    return;
  }
  if (real.length < expected) {
    const ph = syntheticBracketRound(round, expected - real.length).map((m, i) => ({
      ...m,
      id: `__ph-${round}-${real.length + i}`,
    }));
    cols.push([...real, ...ph]);
    return;
  }
  cols.push(real.slice(0, expected));
}

/** Full knockout column layout (round 1 left, final right). */export function buildBracketColumnsForDisplay(matches: BracketMatch[]): BracketMatch[][] {
  const slotCount = inferBracketSlotCountFromRoundOne(matches);
  if (!slotCount) return [];

  const depth = Math.trunc(Math.log2(slotCount));
  if (!Number.isFinite(depth) || depth < 1) return [];

  const mainTier = slotCount / 2;
  const entryRound = bracketMainDrawEntryRound(matches, slotCount);
  const cols: BracketMatch[][] = [];

  if (entryRound !== undefined && entryRound > 1) {
    for (let r = 1; r < entryRound; r++) {
      const real = matchesInRoundForDisplay(matches, r);
      if (real.length > 0) cols.push(real);
    }
    for (let i = 0; i < depth; i++) {
      const r = entryRound + i;
      const expected = mainTier >> i;
      pushRoundColumn(cols, matches, r, expected);
    }
    return cols;
  }

  for (let r = 1; r <= depth; r++) {
    const expected = slotCount / 2 ** r;
    pushRoundColumn(cols, matches, r, expected);
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
  const depth = Math.trunc(Math.log2(inferBracketSlotCountFromRoundOne(matches) ?? 0));
  const treeCols = depth > 0 ? colsCopy.slice(-depth) : colsCopy;
  const root = bracketTreeFromColumns(treeCols);
  if (root) applyFeederWinners(root);
  return colsCopy;
}
