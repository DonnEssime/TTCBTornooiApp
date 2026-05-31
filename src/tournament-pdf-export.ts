import { listCompetitionTracks } from './competition-track';
import type { BracketMatch, BracketPlacementRow, GroupDefinition, Tournament } from './model';
import {
  propagateBracketSeedsFromChildWinners,
  settleBracketWinnersIn,
  singleEliminationPlacementRows,
} from './model';

export type TournamentPdfTrack = {
  heading?: string;
  groups: Record<string, GroupDefinition>;
  bracketMatches: BracketMatch[];
  classId?: string;
};

/** Tracks included in a tournament summary PDF (optionally one competition class). */
export function listTournamentPdfTracks(t: Tournament, classId?: string): TournamentPdfTrack[] {
  const tracks: TournamentPdfTrack[] = listCompetitionTracks(t).map((tr) => ({
    heading: tr.classId ? t.classDefinitions.find((d) => d.id === tr.classId)?.name : undefined,
    groups: tr.groups,
    bracketMatches: tr.bracketMatches,
    classId: tr.classId,
  }));
  if (classId === undefined) return tracks;
  return tracks.filter((tr) => tr.classId === classId);
}

/** Propagate feeder seeds and sync winners from player matches (same as UI reconciliation). */
export function prepareBracketMatchesForPdf(
  t: Tournament,
  matches: BracketMatch[],
  classId?: string,
): BracketMatch[] {
  const copy = matches.map((m) => ({ ...m }));
  propagateBracketSeedsFromChildWinners(copy);
  settleBracketWinnersIn(t, copy, classId);
  return copy;
}

/** Final bracket ranking rows for PDF export (uses raw track bracket + class scope). */
export function tournamentPdfPlacementRows(
  t: Tournament,
  bracketMatches: BracketMatch[],
  classId?: string,
): BracketPlacementRow[] | null {
  return singleEliminationPlacementRows(bracketMatches, t, classId);
}
