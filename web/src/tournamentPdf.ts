import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  BracketMatch,
  BracketPlacementRow,
  GroupDefinition,
  Locale,
  Match,
  Tournament,
} from 'ttc-tornooiapp';
import { txt } from 'ttc-tornooiapp';
import {
  formatBracketSlotPlayerLabel,
  formatPlayerDisplayLabel,
  gameWinner,
  groupNumberedTitle,
  propagateBracketSeedsFromChildWinners,
  settleBracketWinnersIn,
  singleEliminationPlacementRows,
  tournamentUsesClassTabs,
} from 'ttc-tornooiapp';
import { drawBracketStreamOnPdf } from './bracketStream/pdfDraw';
import { bracketStreamPdfLayout } from './bracketStream/pdfLayout';

const PAGE_MARGIN = 14;
const SECTION_GAP = 8;
const PORTRAIT_FORMAT = 'a4' as const;
const PORTRAIT_ORIENTATION = 'portrait' as const;
const BRACKET_FORMAT = 'a3' as const;
const BRACKET_ORIENTATION = 'landscape' as const;

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

function playerName(t: Tournament, pid: string): string {
  return formatPlayerDisplayLabel(t, pid);
}

function groupStandingsWl(
  t: Tournament,
  g: GroupDefinition,
  classId: string | undefined,
): Record<string, { w: number; l: number }> {
  const pids = g.playerIds;
  const wins: Record<string, number> = Object.fromEntries(pids.map((p) => [p, 0]));
  const losses: Record<string, number> = Object.fromEntries(pids.map((p) => [p, 0]));
  for (const m of Object.values(t.matches)) {
    if (m.groupId !== g.id || m.status !== 'finished' || !m.winner) continue;
    if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
    if (!pids.includes(m.playerA) || !pids.includes(m.playerB)) continue;
    wins[m.winner] = (wins[m.winner] ?? 0) + 1;
    const loser = m.winner === m.playerA ? m.playerB : m.playerA;
    losses[loser] = (losses[loser] ?? 0) + 1;
  }
  const out: Record<string, { w: number; l: number }> = {};
  for (const pid of pids) {
    out[pid] = { w: wins[pid] ?? 0, l: losses[pid] ?? 0 };
  }
  return out;
}

function findGroupMatch(
  t: Tournament,
  g: GroupDefinition,
  classId: string | undefined,
  rowPid: string,
  colPid: string,
): Match | undefined {
  if (rowPid === colPid) return undefined;
  for (const m of Object.values(t.matches)) {
    if (m.groupId !== g.id) continue;
    if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
    const ok =
      (m.playerA === rowPid && m.playerB === colPid) || (m.playerA === colPid && m.playerB === rowPid);
    if (ok) return m;
  }
  return undefined;
}

function matrixCellDigit(
  t: Tournament,
  g: GroupDefinition,
  classId: string | undefined,
  rowPid: string,
  colPid: string,
): string {
  if (rowPid === colPid) return '·';
  const m = findGroupMatch(t, g, classId, rowPid, colPid);
  if (!m || m.scores.length === 0) return '—';
  let won = 0;
  let anyDecided = false;
  const rowIsA = m.playerA === rowPid;
  for (const gs of m.scores) {
    const w = gameWinner(gs);
    if (w === undefined) continue;
    anyDecided = true;
    if ((rowIsA && w === 'A') || (!rowIsA && w === 'B')) won++;
  }
  if (!anyDecided) return '—';
  return String(won);
}

/** Propagate feeder seeds and sync winners from player matches (same as UI reconciliation). */
function prepareBracketMatchesForPdf(t: Tournament, matches: BracketMatch[]): BracketMatch[] {
  const copy = matches.map((m) => ({ ...m }));
  propagateBracketSeedsFromChildWinners(copy);
  settleBracketWinnersIn(t, copy);
  return copy;
}

function bracketSlotLabel(
  m: BracketMatch,
  side: 'a' | 'b',
  t: Tournament,
  locale: Locale,
  classId?: string,
): string {
  const id = side === 'a' ? m.seedA : m.seedB;
  if (id) return formatBracketSlotPlayerLabel(t, id, classId, locale);
  if (m.id.startsWith('__ph-')) return '—';
  return txt('ui.slot.empty', locale);
}

type PdfTrack = {
  heading?: string;
  groups: Record<string, GroupDefinition>;
  bracketMatches: BracketMatch[];
  classId?: string;
};

function collectTracks(t: Tournament): PdfTrack[] {
  if (!tournamentUsesClassTabs(t)) {
    return [{ groups: t.groups, bracketMatches: t.bracketMatches }];
  }
  return t.classDefinitions.map((def) => ({
    heading: def.name,
    groups: t.classTournaments[def.id]?.groups ?? {},
    bracketMatches: t.classTournaments[def.id]?.bracketMatches ?? [],
    classId: def.id,
  }));
}

function addPortraitPage(doc: jsPDF): void {
  doc.addPage(PORTRAIT_FORMAT, PORTRAIT_ORIENTATION);
}

function addBracketPage(doc: jsPDF): void {
  doc.addPage(BRACKET_FORMAT, BRACKET_ORIENTATION);
}

function nextY(doc: jsPDF, y: number, need: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - PAGE_MARGIN) {
    addPortraitPage(doc);
    return PAGE_MARGIN;
  }
  return y;
}

function sectionHeading(doc: jsPDF, y: number, text: string, size: number): number {
  y = nextY(doc, y, size * 0.5 + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.text(text, PAGE_MARGIN, y);
  return y + size * 0.4 + SECTION_GAP;
}

function tableFinalY(doc: jsPDF): number {
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function addGroupMatrix(
  doc: jsPDF,
  y: number,
  t: Tournament,
  g: GroupDefinition,
  locale: Locale,
  classId?: string,
): number {
  const pids = [...g.playerIds];
  const wl = groupStandingsWl(t, g, classId);
  const head = [
    txt('ui.pdf.playerColumn', locale),
    ...pids.map((pid) => playerName(t, pid)),
    txt('ui.standings.win', locale),
    txt('ui.standings.loss', locale),
  ];
  const body = pids.map((rowPid) => [
    playerName(t, rowPid),
    ...pids.map((colPid) => matrixCellDigit(t, g, classId, rowPid, colPid)),
    String(wl[rowPid]?.w ?? 0),
    String(wl[rowPid]?.l ?? 0),
  ]);

  y = nextY(doc, y, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(groupNumberedTitle(g, locale), PAGE_MARGIN, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [51, 65, 85] },
  });
  return tableFinalY(doc) + SECTION_GAP;
}

/** Draw bracket on the current A3 landscape page; caller must add that page first. */
function addBracketStreamView(
  doc: jsPDF,
  y: number,
  t: Tournament,
  matches: BracketMatch[],
  locale: Locale,
  classId?: string,
): void {
  const prepared = prepareBracketMatchesForPdf(t, matches);
  const slotLabel = (m: BracketMatch, side: 'a' | 'b') => bracketSlotLabel(m, side, t, locale, classId);
  const layout = bracketStreamPdfLayout(t, prepared, slotLabel);
  if (!layout) return;

  const availW = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  const availH = doc.internal.pageSize.getHeight() - y - PAGE_MARGIN;
  const scale = Math.min(1, availW / layout.width, availH / layout.height);
  const scaledW = layout.width * scale;
  const scaledH = layout.height * scale;
  const originX = PAGE_MARGIN + (availW - scaledW) / 2;
  const originY = y + (availH - scaledH) / 2;
  drawBracketStreamOnPdf(doc, layout, originX, originY, scale, txt('ui.pdf.vs', locale));
}

function addPlacementList(
  doc: jsPDF,
  y: number,
  t: Tournament,
  rows: BracketPlacementRow[],
): number {
  if (rows.length === 0) return y;

  y = nextY(doc, y, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0);
  for (const row of rows) {
    const isFirst = row.place === 1;
    y = nextY(doc, y, isFirst ? 7 : 6);
    doc.setFont('helvetica', isFirst ? 'bold' : 'normal');
    doc.setFontSize(isFirst ? 11 : 10);
    doc.text(`${row.place}. ${playerName(t, row.playerId)}`, PAGE_MARGIN + 4, y);
    y += isFirst ? 6 : 5;
    if (row.place === 3) {
      y += 5;
    }
  }
  return y + SECTION_GAP;
}

/** Build a PDF blob for the tournament (groups, bracket, placements). */
export function buildTournamentPdfBlob(
  tournamentName: string,
  tournament: Tournament,
  locale: Locale = 'en',
): Blob {
  const doc = new jsPDF({
    unit: 'mm',
    format: PORTRAIT_FORMAT,
    orientation: PORTRAIT_ORIENTATION,
  });
  let y = PAGE_MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(tournamentName.trim() || txt('ui.pdf.tournament', locale), PAGE_MARGIN, y);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  const when = new Date().toLocaleString(locale === 'nl' ? 'nl-NL' : 'en-GB');
  doc.text(txt('ui.pdf.exportedAt', locale, { when }), PAGE_MARGIN, y);
  doc.setTextColor(0);
  y += 12;

  const tracks = collectTracks(tournament);
  let anyContent = false;

  for (const track of tracks) {
    const groups = sortGroups(track.groups);
    const hasGroups = groups.length > 0;
    const hasBracket = track.bracketMatches.length > 0;

    if (hasGroups) {
      anyContent = true;
      const groupsTitle = track.heading
        ? txt('ui.pdf.groupsHeading', locale, { heading: track.heading })
        : txt('ui.pdf.groups', locale);
      y = sectionHeading(doc, y, groupsTitle, 13);
      for (const g of groups) {
        y = addGroupMatrix(doc, y, tournament, g, locale, track.classId);
      }
      if (hasBracket) {
        addBracketPage(doc);
        y = PAGE_MARGIN;
      }
    }

    if (hasBracket) {
      anyContent = true;
      const preparedBracket = prepareBracketMatchesForPdf(tournament, track.bracketMatches);
      if (!hasGroups) {
        addBracketPage(doc);
        y = PAGE_MARGIN;
      }
      const bracketTitle = track.heading
        ? txt('ui.pdf.knockoutBracketHeading', locale, { heading: track.heading })
        : txt('ui.pdf.knockoutBracket', locale);
      y = sectionHeading(doc, y, bracketTitle, 13);
      addBracketStreamView(doc, y, tournament, preparedBracket, locale, track.classId);

      const placements = singleEliminationPlacementRows(preparedBracket, tournament);
      if (placements) {
        addPortraitPage(doc);
        y = PAGE_MARGIN;
        const resultsTitle = track.heading
          ? txt('ui.pdf.resultsHeading', locale, { heading: track.heading })
          : txt('ui.pdf.results', locale);
        y = sectionHeading(doc, y, resultsTitle, 13);
        y = addPlacementList(doc, y, tournament, placements);
      }
    }
  }

  if (!anyContent) {
    y = sectionHeading(doc, y, txt('ui.pdf.noDataYet', locale), 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(txt('ui.pdf.createBeforeExport', locale), PAGE_MARGIN, y);
  }

  return doc.output('blob');
}

export function downloadTournamentPdf(
  tournamentName: string,
  tournament: Tournament,
  locale: Locale = 'en',
): void {
  const blob = buildTournamentPdfBlob(tournamentName, tournament, locale);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const slug = tournamentName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tournament';
  a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
