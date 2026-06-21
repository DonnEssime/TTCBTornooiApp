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
import { txt, listTournamentPdfTracks, prepareBracketMatchesForPdf, tournamentPdfPlacementRows, type TournamentPdfTrack } from 'ttc-tornooiapp';
import {
  formatBracketSlotPlayerLabel,
  formatPlayerDisplayLabel,
  gameWinner,
  groupNumberedTitle,
  groupStandingsRowsForBracket,
  isDoublesTrack,
  pairDisplayLabel,
} from 'ttc-tornooiapp';
import { drawBracketStreamOnPdf } from './bracketStream/pdfDraw';
import { bracketStreamPdfLayout } from './bracketStream/pdfLayout';
const PAGE_MARGIN = 14;
const SECTION_GAP = 8;
const PORTRAIT_FORMAT = 'a4' as const;
const PORTRAIT_ORIENTATION = 'portrait' as const;
const BRACKET_FORMAT = 'a3' as const;
const BRACKET_ORIENTATION = 'landscape' as const;
type PageKind = 'portrait' | 'bracket';
type PdfBuildOptions = {
  /** When set, export only this competition class (multi-class tournaments). */
  classId?: string;
};
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
function addPortraitPage(doc: jsPDF): void {
  doc.addPage(PORTRAIT_FORMAT, PORTRAIT_ORIENTATION);
}
function addBracketPage(doc: jsPDF): void {
  doc.addPage(BRACKET_FORMAT, BRACKET_ORIENTATION);
}
function ensurePortraitPage(doc: jsPDF, pageKind: { kind: PageKind }): void {
  if (pageKind.kind === 'bracket') {
    addPortraitPage(doc);
    pageKind.kind = 'portrait';
  }
}
function ensureBracketPage(doc: jsPDF, pageKind: { kind: PageKind }): void {
  addBracketPage(doc);
  pageKind.kind = 'bracket';
}
function nextY(doc: jsPDF, y: number, need: number, pageKind: { kind: PageKind }): number {
  if (pageKind.kind === 'bracket') {
    return y;
  }
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - PAGE_MARGIN) {
    addPortraitPage(doc);
    return PAGE_MARGIN;
  }
  return y;
}
function sectionHeading(
  doc: jsPDF,
  y: number,
  text: string,
  size: number,
  pageKind: { kind: PageKind },
): number {
  y = nextY(doc, y, size * 0.5 + 6, pageKind);
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
  pageKind: { kind: PageKind },
  classId?: string,
): number {
  if (isDoublesTrack(t, classId)) {
    const pairIds = [...(g.pairIds ?? [])];
    const rows = groupStandingsRowsForBracket(t, g, classId);
    const wl = Object.fromEntries(rows.map((r) => [r.pid, { w: r.w, l: r.l }]));
    const head = [
      txt('ui.pair.detailTitle', locale),
      ...pairIds.map((pid) => pairDisplayLabel(t, pid, classId, locale)),
      txt('ui.standings.win', locale),
      txt('ui.standings.loss', locale),
    ];
    const body = pairIds.map((rowPid) => [
      pairDisplayLabel(t, rowPid, classId, locale),
      ...pairIds.map((colPid) => {
        if (rowPid === colPid) return '·';
        for (const m of Object.values(t.matches)) {
          if (m.groupId !== g.id) continue;
          if (classId ? m.classId !== classId : Boolean(m.classId)) continue;
          const ok =
            (m.pairA === rowPid && m.pairB === colPid) || (m.pairA === colPid && m.pairB === rowPid);
          if (!ok) continue;
          return matrixCellDigit(t, g, classId, m.playerA, m.playerB);
        }
        return '—';
      }),
      String(wl[rowPid]?.w ?? 0),
      String(wl[rowPid]?.l ?? 0),
    ]);
    y = nextY(doc, y, 24, pageKind);
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
  y = nextY(doc, y, 24, pageKind);
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
  const prepared = prepareBracketMatchesForPdf(t, matches, classId);
  const slotLabel = (m: BracketMatch, side: 'a' | 'b') => bracketSlotLabel(m, side, t, locale, classId);
  const layout = bracketStreamPdfLayout(t, prepared, slotLabel, classId);
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
  pageKind: { kind: PageKind },
): number {
  if (rows.length === 0) return y;
  y = nextY(doc, y, 12, pageKind);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0);
  for (const row of rows) {
    const isFirst = row.place === 1;
    y = nextY(doc, y, isFirst ? 7 : 6, pageKind);
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
function sectionTitleWithHeading(
  baseKey: 'ui.pdf.groups' | 'ui.pdf.knockoutBracket' | 'ui.pdf.results',
  headingKey:
    | 'ui.pdf.groupsHeading'
    | 'ui.pdf.knockoutBracketHeading'
    | 'ui.pdf.resultsHeading',
  locale: Locale,
  track: TournamentPdfTrack,
  classScoped: boolean,
): string {
  if (classScoped || !track.heading) {
    return txt(baseKey, locale);
  }
  return txt(headingKey, locale, { heading: track.heading });
}
function appendTracksToPdf(
  doc: jsPDF,
  y: number,
  tournament: Tournament,
  tracks: TournamentPdfTrack[],
  locale: Locale,
  classScoped: boolean,
  exportClassId?: string,
): { y: number; anyContent: boolean } {
  const pageKind: { kind: PageKind } = { kind: 'portrait' };
  let anyContent = false;
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    const trackClassId = track.classId ?? exportClassId;
    const hasMoreTracks = i < tracks.length - 1;
    const groups = sortGroups(track.groups);
    const hasGroups = groups.length > 0;
    const hasBracket = track.bracketMatches.length > 0;
    if (hasGroups) {
      anyContent = true;
      const wasBracket = pageKind.kind === 'bracket';
      ensurePortraitPage(doc, pageKind);
      if (wasBracket) {
        y = PAGE_MARGIN;
      }
      const groupsTitle = sectionTitleWithHeading(
        'ui.pdf.groups',
        'ui.pdf.groupsHeading',
        locale,
        track,
        classScoped,
      );
      y = sectionHeading(doc, y, groupsTitle, 13, pageKind);
      for (const g of groups) {
        y = addGroupMatrix(doc, y, tournament, g, locale, pageKind, trackClassId);
      }
      if (hasBracket) {
        ensureBracketPage(doc, pageKind);
        y = PAGE_MARGIN;
      }
    }
    if (hasBracket) {
      anyContent = true;
      const preparedBracket = prepareBracketMatchesForPdf(tournament, track.bracketMatches, trackClassId);
      if (!hasGroups) {
        ensureBracketPage(doc, pageKind);
        y = PAGE_MARGIN;
      }
      const bracketTitle = sectionTitleWithHeading(
        'ui.pdf.knockoutBracket',
        'ui.pdf.knockoutBracketHeading',
        locale,
        track,
        classScoped,
      );
      y = sectionHeading(doc, y, bracketTitle, 13, pageKind);
      addBracketStreamView(doc, y, tournament, preparedBracket, locale, trackClassId);
      const placements = tournamentPdfPlacementRows(tournament, track.bracketMatches, trackClassId);
      if (placements) {
        addPortraitPage(doc);
        pageKind.kind = 'portrait';
        y = PAGE_MARGIN;
        const resultsTitle = sectionTitleWithHeading(
          'ui.pdf.results',
          'ui.pdf.resultsHeading',
          locale,
          track,
          classScoped,
        );
        y = sectionHeading(doc, y, resultsTitle, 13, pageKind);
        y = addPlacementList(doc, y, tournament, placements, pageKind);
        if (hasMoreTracks) {
          addPortraitPage(doc);
          pageKind.kind = 'portrait';
          y = PAGE_MARGIN;
        }
      } else if (hasMoreTracks && pageKind.kind === 'bracket') {
        ensurePortraitPage(doc, pageKind);
        y = PAGE_MARGIN;
      }
    }
  }
  return { y, anyContent };
}
/** Build a PDF blob for the tournament (groups, bracket, placements). */
export function buildTournamentPdfBlob(
  tournamentName: string,
  tournament: Tournament,
  locale: Locale = 'en',
  options?: PdfBuildOptions,
): Blob {
  const classScoped = options?.classId !== undefined;
  const tracks = listTournamentPdfTracks(tournament, options?.classId);
  const classHeading =
    classScoped && tracks[0]?.heading ? tracks[0].heading : undefined;
  const doc = new jsPDF({
    unit: 'mm',
    format: PORTRAIT_FORMAT,
    orientation: PORTRAIT_ORIENTATION,
  });
  let y = PAGE_MARGIN;
  const titleBase = tournamentName.trim() || txt('ui.pdf.tournament', locale);
  const title = classHeading ? `${titleBase} · ${classHeading}` : titleBase;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, PAGE_MARGIN, y);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  const when = new Date().toLocaleString(locale === 'nl' ? 'nl-NL' : 'en-GB');
  doc.text(txt('ui.pdf.exportedAt', locale, { when }), PAGE_MARGIN, y);
  doc.setTextColor(0);
  y += 12;
  const { y: endY, anyContent } = appendTracksToPdf(
    doc,
    y,
    tournament,
    tracks,
    locale,
    classScoped,
    options?.classId,
  );
  if (!anyContent) {
    y = sectionHeading(doc, endY, txt('ui.pdf.noDataYet', locale), 12, { kind: 'portrait' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(txt('ui.pdf.createBeforeExport', locale), PAGE_MARGIN, y);
  }
  return doc.output('blob');
}
function pdfFilenameSlug(tournamentName: string, classId: string | undefined, className: string | undefined): string {
  const base =
    tournamentName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tournament';
  if (!classId) return base;
  const classPart =
    (className ?? classId)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || classId;
  return `${base}-${classPart}`;
}
export function downloadTournamentPdf(
  tournamentName: string,
  tournament: Tournament,
  locale: Locale = 'en',
  options?: PdfBuildOptions,
): void {
  const tracks = listTournamentPdfTracks(tournament, options?.classId);
  const blob = buildTournamentPdfBlob(tournamentName, tournament, locale, options);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const slug = pdfFilenameSlug(tournamentName, options?.classId, tracks[0]?.heading);
  a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
