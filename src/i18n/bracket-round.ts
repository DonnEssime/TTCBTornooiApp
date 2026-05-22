import type { BracketMatch } from '../model';
import { bracketMainDrawEntryRound, inferBracketSlotCountFromRoundOne } from '../model';
import type { MessageKey } from './catalog';
import type { Locale } from './types';
import { messageText } from './resolve';
import { catalog } from './catalog';

const FRACTION_KEYS: Partial<Record<number, MessageKey>> = {
  64: 'ui.bracket.round.sixtyFourth',
  32: 'ui.bracket.round.thirtySecond',
  16: 'ui.bracket.round.sixteenth',
  8: 'ui.bracket.round.eighth',
  4: 'ui.bracket.round.quarter',
};

/** Catalog key for a knockout bracket round (main draw), or numbered fallback for prelims/unknown. */
export function bracketKnockoutRoundMessageKey(
  internalRound: number,
  bracketMatches: BracketMatch[],
  slotCount?: number,
): MessageKey {
  const slots = slotCount ?? inferBracketSlotCountFromRoundOne(bracketMatches);
  if (slots === undefined || slots < 2) return 'ui.bracket.round.numbered';

  const depth = Math.trunc(Math.log2(slots));
  if (!Number.isFinite(depth) || depth < 1) return 'ui.bracket.round.numbered';

  const entryRound = bracketMainDrawEntryRound(bracketMatches, slots) ?? 1;
  if (internalRound < entryRound) return 'ui.bracket.round.numbered';

  const indexInMain = internalRound - entryRound + 1;
  if (indexInMain < 1 || indexInMain > depth) return 'ui.bracket.round.numbered';

  const players = slots >> (indexInMain - 1);
  if (players === 2) return 'ui.bracket.round.final';
  // Semi (1/2) only when the draw is large enough to have a separate quarter round before it.
  if (players === 4 && indexInMain < depth && depth >= 5) return 'ui.bracket.round.half';

  return FRACTION_KEYS[players] ?? 'ui.bracket.round.numbered';
}

/** Localized knockout round label (e.g. 1/8th, finale, or Round 2 for prelims). */
export function bracketKnockoutRoundLabel(
  locale: Locale,
  internalRound: number,
  bracketMatches: BracketMatch[],
  slotCount?: number,
): string {
  const key = bracketKnockoutRoundMessageKey(internalRound, bracketMatches, slotCount);
  if (key === 'ui.bracket.round.numbered') {
    return messageText(catalog, key, locale, { n: String(internalRound) });
  }
  return messageText(catalog, key, locale);
}

/** Params for catalog strings that use `{{round}}` as the display name. */
export function bracketKnockoutRoundParams(
  locale: Locale,
  internalRound: number,
  bracketMatches: BracketMatch[],
  slotCount?: number,
): { round: string } {
  return { round: bracketKnockoutRoundLabel(locale, internalRound, bracketMatches, slotCount) };
}
