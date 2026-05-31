import type { Locale } from './i18n/types';
import { txt, bracketKnockoutRoundParams } from './i18n';
import { listCompetitionTracks, trackGroupMatches, trackTitle, tournamentUsesClassTabs } from './competition-track';
import type { BracketMatch, GroupDefinition, Match, PlayerId, Tournament } from './model';
import {
  bracketEffectiveWinner,
  bracketMatchesSortedForRound,
  bracketPlayerIdentityResolvedForDisplay,
  bracketPlayerMatchId,
  compareBracketMatchIdString,
  displayLabelForGroup,
  formatBracketSlotPlayerLabel,
  formatPlayerDisplayLabel,
  isBracketByeWalkoverMatch,
  isHandicapActive,
  isMiscActive,
} from './model';

export const MATCH_NOTES_SLIPS_PER_PAGE = 6;
/** Score boxes (games) printed on each match slip (best-of-five). */
export const MATCH_NOTES_GAMES_PER_SLIP = 5;

export type MatchNotesSegment =
  | { kind: 'group-overall' }
  | { kind: 'group-pool'; classId?: string; groupId: string }
  | { kind: 'bracket-round'; classId?: string; round: number };

export type MatchNotePlayerSide = {
  label: string;
  name: string;
  handicap?: number;
  misc?: string;
};

export type MatchNoteSlip = {
  matchKey: string;
  contextLine: string;
  playerA: MatchNotePlayerSide;
  playerB: MatchNotePlayerSide;
};

export function matchNotesPageCount(slipCount: number): number {
  if (slipCount <= 0) return 0;
  return Math.ceil(slipCount / MATCH_NOTES_SLIPS_PER_PAGE);
}

/** Scheduled or in-progress only; finished / forfeit / eliminated are omitted from print runs. */
export function isMatchNotePrintable(m: Match): boolean {
  return m.status !== 'finished' && m.status !== 'forfeit' && m.status !== 'eliminated';
}

type TrackSlice = {
  classId: string | undefined;
  trackTitle: string;
  groups: Record<string, GroupDefinition>;
  bracketMatches: BracketMatch[];
};

function trackSlices(t: Tournament, locale: Locale): TrackSlice[] {
  const mainLabel = txt('ui.ov.mainDraw', locale);
  return listCompetitionTracks(t).map((tr) => ({
    classId: tr.classId,
    trackTitle: trackTitle(t, tr.classId, mainLabel),
    groups: tr.groups,
    bracketMatches: tr.bracketMatches,
  }));
}

function sortGroups(groups: Record<string, GroupDefinition>): GroupDefinition[] {
  return Object.values(groups).sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a.id && String(nb) === b.id) {
      return na - nb;
    }
    return a.id.localeCompare(b.id);
  });
}

function playerSide(
  t: Tournament,
  playerId: PlayerId,
  classId: string | undefined,
  locale: Locale,
  bracketSlotLabel: boolean,
): MatchNotePlayerSide {
  const label = bracketSlotLabel
    ? formatBracketSlotPlayerLabel(t, playerId, classId, locale)
    : formatPlayerDisplayLabel(t, playerId);
  const p = t.players[playerId];
  const name = p?.name ?? playerId;
  const side: MatchNotePlayerSide = { label, name };
  if (isHandicapActive(t) && p) side.handicap = p.handicap;
  if (isMiscActive(t) && p) {
    const trimmed = (p.misc ?? '').trim();
    if (trimmed) side.misc = trimmed;
  }
  return side;
}

function groupContextLine(
  locale: Locale,
  trackTitle: string,
  group: GroupDefinition,
): string {
  return `${trackTitle} · ${displayLabelForGroup(group, locale)} · ${txt('ui.group_phase', locale)}`;
}

function bracketContextLine(
  locale: Locale,
  trackTitle: string,
  round: number,
  bracketMatches: BracketMatch[],
): string {
  const roundLabel = bracketKnockoutRoundParams(locale, round, bracketMatches).round;
  return `${trackTitle} · ${roundLabel} · ${txt('ui.bracket_phase', locale)}`;
}

function slipFromPlayerMatch(
  t: Tournament,
  m: Match,
  contextLine: string,
  classId: string | undefined,
  locale: Locale,
): MatchNoteSlip {
  return {
    matchKey: m.id,
    contextLine,
    playerA: playerSide(t, m.playerA, classId, locale, false),
    playerB: playerSide(t, m.playerB, classId, locale, false),
  };
}

function bracketMatchBothPlayersKnown(
  t: Tournament,
  bm: BracketMatch,
  classId: string | undefined,
): boolean {
  if (!bm.seedA || !bm.seedB) return false;
  return (
    bracketPlayerIdentityResolvedForDisplay(t, bm.seedA, classId) &&
    bracketPlayerIdentityResolvedForDisplay(t, bm.seedB, classId)
  );
}

/** Unfinished, non-bye bracket slots in a round (candidates for match-note slips). */
function bracketRoundPendingMatches(
  t: Tournament,
  bracketMatches: BracketMatch[],
  round: number,
  classId?: string,
): BracketMatch[] {
  return bracketMatchesSortedForRound(bracketMatches, round).filter(
    (bm) => !isBracketByeWalkoverMatch(bm) && bracketEffectiveWinner(t, bm, classId) === undefined,
  );
}

/** Bracket-round slips print only when every pending slot in the round has both players known. */
function isBracketRoundNotesPrintable(
  t: Tournament,
  classId: string | undefined,
  round: number,
): boolean {
  const tr =
    listCompetitionTracks(t).find((x) => x.classId === classId) ?? listCompetitionTracks(t)[0];
  if (!tr) return false;
  const pending = bracketRoundPendingMatches(t, tr.bracketMatches, round, classId);
  if (pending.length === 0) return true;
  return pending.every((bm) => bracketMatchBothPlayersKnown(t, bm, classId));
}

function isBracketSlotNotePrintable(t: Tournament, bm: BracketMatch, classId?: string): boolean {
  if (isBracketByeWalkoverMatch(bm)) return false;
  if (bracketEffectiveWinner(t, bm, classId) !== undefined) return false;
  const mid = bracketPlayerMatchId(bm.id, classId);
  const pm = t.matches[mid];
  if (pm && !pm.groupId) return isMatchNotePrintable(pm);
  return Boolean(bm.seedA && bm.seedB);
}

function slipFromBracketMatch(
  t: Tournament,
  bm: BracketMatch,
  contextLine: string,
  classId: string | undefined,
  locale: Locale,
): MatchNoteSlip {
  const mid = bracketPlayerMatchId(bm.id, classId);
  const pm = t.matches[mid];
  if (pm && !pm.groupId) {
    return slipFromPlayerMatch(t, pm, contextLine, classId, locale);
  }
  return {
    matchKey: bm.id,
    contextLine,
    playerA: playerSide(t, bm.seedA!, classId, locale, true),
    playerB: playerSide(t, bm.seedB!, classId, locale, true),
  };
}

function collectGroupSlipsForMatches(
  t: Tournament,
  matches: Match[],
  contextForMatch: (m: Match) => string,
  classId: string | undefined,
  locale: Locale,
): MatchNoteSlip[] {
  const out: MatchNoteSlip[] = [];
  for (const m of matches.filter(isMatchNotePrintable).sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(slipFromPlayerMatch(t, m, contextForMatch(m), classId, locale));
  }
  return out;
}

/** One batch per group (track × pool); used for page breaks in group-overall PDFs. */
function collectGroupOverallBatches(t: Tournament, locale: Locale): MatchNoteSlip[][] {
  const batches: MatchNoteSlip[][] = [];
  if (!tournamentUsesClassTabs(t)) {
    const tr = trackSlices(t, locale)[0]!;
    for (const g of sortGroups(tr.groups)) {
      const matches = trackGroupMatches(t, undefined).filter((m) => m.groupId === g.id);
      const ctx = groupContextLine(locale, tr.trackTitle, g);
      const slips = collectGroupSlipsForMatches(t, matches, () => ctx, undefined, locale);
      if (slips.length > 0) batches.push(slips);
    }
    return batches;
  }
  for (const tr of trackSlices(t, locale)) {
    for (const g of sortGroups(tr.groups)) {
      const matches = trackGroupMatches(t, tr.classId).filter((m) => m.groupId === g.id);
      const ctx = groupContextLine(locale, tr.trackTitle, g);
      const slips = collectGroupSlipsForMatches(t, matches, () => ctx, tr.classId, locale);
      if (slips.length > 0) batches.push(slips);
    }
  }
  return batches;
}

function collectGroupOverall(t: Tournament, locale: Locale): MatchNoteSlip[] {
  return collectGroupOverallBatches(t, locale).flat();
}

function collectGroupPool(t: Tournament, classId: string | undefined, groupId: string, locale: Locale): MatchNoteSlip[] {
  const tr =
    trackSlices(t, locale).find((x) => x.classId === classId) ?? trackSlices(t, locale)[0];
  if (!tr) return [];
  const g = tr.groups[groupId];
  if (!g) return [];
  const matches = trackGroupMatches(t, classId).filter((m) => m.groupId === groupId);
  const ctx = groupContextLine(locale, tr.trackTitle, g);
  return collectGroupSlipsForMatches(t, matches, () => ctx, classId, locale);
}

function collectBracketRound(
  t: Tournament,
  classId: string | undefined,
  round: number,
  locale: Locale,
): MatchNoteSlip[] {
  if (!isBracketRoundNotesPrintable(t, classId, round)) return [];
  const tr =
    trackSlices(t, locale).find((x) => x.classId === classId) ?? trackSlices(t, locale)[0];
  if (!tr) return [];
  const ctx = bracketContextLine(locale, tr.trackTitle, round, tr.bracketMatches);
  const out: MatchNoteSlip[] = [];
  for (const bm of bracketMatchesSortedForRound(tr.bracketMatches, round)) {
    if (!isBracketSlotNotePrintable(t, bm, classId)) continue;
    out.push(slipFromBracketMatch(t, bm, ctx, classId, locale));
  }
  out.sort((a, b) => compareBracketMatchIdString(a.matchKey, b.matchKey));
  return out;
}

export function collectMatchNoteSlips(
  tournament: Tournament,
  segment: MatchNotesSegment,
  locale: Locale = 'en',
): MatchNoteSlip[] {
  return collectMatchNoteSlipBatches(tournament, segment, locale).flat();
}

/**
 * Slips grouped for PDF layout. Group-overall uses one batch per pool (page break between batches);
 * other segments return a single batch.
 */
export function collectMatchNoteSlipBatches(
  tournament: Tournament,
  segment: MatchNotesSegment,
  locale: Locale = 'en',
): MatchNoteSlip[][] {
  switch (segment.kind) {
    case 'group-overall':
      return collectGroupOverallBatches(tournament, locale);
    case 'group-pool': {
      const slips = collectGroupPool(tournament, segment.classId, segment.groupId, locale);
      return slips.length > 0 ? [slips] : [];
    }
    case 'bracket-round': {
      const slips = collectBracketRound(tournament, segment.classId, segment.round, locale);
      return slips.length > 0 ? [slips] : [];
    }
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}

export function matchNotesSegmentHasSlips(
  tournament: Tournament,
  segment: MatchNotesSegment,
  locale: Locale = 'en',
): boolean {
  if (segment.kind === 'bracket-round' && !isBracketRoundNotesPrintable(tournament, segment.classId, segment.round)) {
    return false;
  }
  return collectMatchNoteSlips(tournament, segment, locale).length > 0;
}

/** Localized short description for print affordances (aria-label, toasts). */
export function matchNotesSegmentLabel(
  tournament: Tournament,
  segment: MatchNotesSegment,
  locale: Locale = 'en',
): string {
  switch (segment.kind) {
    case 'group-overall':
      return `${txt('ui.overall', locale)} · ${txt('ui.group_phase', locale)}`;
    case 'group-pool': {
      const tr =
        trackSlices(tournament, locale).find((x) => x.classId === segment.classId) ??
        trackSlices(tournament, locale)[0];
      const g = tr?.groups[segment.groupId];
      const groupLabel = g ? displayLabelForGroup(g, locale) : segment.groupId;
      return `${tr?.trackTitle ?? ''} · ${groupLabel} · ${txt('ui.group_phase', locale)}`;
    }
    case 'bracket-round': {
      const tr =
        trackSlices(tournament, locale).find((x) => x.classId === segment.classId) ??
        trackSlices(tournament, locale)[0];
      if (!tr) return txt('ui.bracket_phase', locale);
      const roundLabel = bracketKnockoutRoundParams(locale, segment.round, tr.bracketMatches).round;
      return `${tr.trackTitle} · ${roundLabel} · ${txt('ui.bracket_phase', locale)}`;
    }
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}
