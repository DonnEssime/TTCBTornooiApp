import { jsPDF } from 'jspdf';
import type { Locale, MatchNoteSlip, MatchNotesSegment, Tournament } from 'ttc-tornooiapp';
import {
  collectMatchNoteSlipBatches,
  isHandicapActive,
  isMiscActive,
  MATCH_NOTES_GAMES_PER_SLIP,
  MATCH_NOTES_SLIPS_PER_PAGE,
  matchNotesSegmentLabel,
  txt,
} from 'ttc-tornooiapp';

const PAGE_FORMAT = 'a4' as const;
const PAGE_ORIENTATION = 'portrait' as const;
const PAGE_MARGIN_X = 10;
const PAGE_MARGIN_Y = 15;
const GRID_ORIGIN_X = PAGE_MARGIN_X;
const GRID_ORIGIN_Y = PAGE_MARGIN_Y;
const SLIP_COLS = 1;
const SLIP_ROWS = MATCH_NOTES_SLIPS_PER_PAGE;
const GUTTER_Y = 2;
const GAMES_PER_MATCH = MATCH_NOTES_GAMES_PER_SLIP;
const TABLE_LABEL_W = 14;
const TABLE_BOX_W = 12;
const TABLE_BOX_H = 6;

const PAGE_W = 210;
const PAGE_H = 297;
const SLIP_W = PAGE_W - PAGE_MARGIN_X * 2;
const SLIP_H = (PAGE_H - PAGE_MARGIN_Y * 2 - GUTTER_Y * (SLIP_ROWS - 1)) / SLIP_ROWS;

function slipOrigin(slotOnPage: number): { x: number; y: number } {
  const row = Math.floor(slotOnPage / SLIP_COLS);
  return {
    x: GRID_ORIGIN_X,
    y: GRID_ORIGIN_Y + row * (SLIP_H + GUTTER_Y),
  };
}

function truncate(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

function drawScoreBox(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  doc.setDrawColor(160);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h);
}

function drawSlip(
  doc: jsPDF,
  slip: MatchNoteSlip,
  tournamentName: string,
  tournament: Tournament,
  locale: Locale,
  originX: number,
  originY: number,
): void {
  const pad = 3;
  const innerW = SLIP_W - pad * 2;
  let y = originY + pad + 3;

  doc.setDrawColor(200);
  doc.setLineWidth(0.25);
  doc.rect(originX, originY, SLIP_W, SLIP_H);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90);
  const tableBlockW = TABLE_LABEL_W + TABLE_BOX_W + 1;
  const contextMaxW = innerW - tableBlockW - 2;
  doc.text(truncate(doc, slip.contextLine, contextMaxW), originX + pad, y);
  const tableLabel = txt('ui.matchNotes.table', locale);
  const tableX = originX + SLIP_W - pad - TABLE_BOX_W;
  const tableLabelX = tableX - TABLE_LABEL_W;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(70);
  doc.text(tableLabel, tableLabelX, y);
  doc.setTextColor(0);
  drawScoreBox(doc, tableX, y - 3.5, TABLE_BOX_W, TABLE_BOX_H);
  y += 5;

  doc.setFontSize(8);
  doc.setTextColor(0);
  const showHcp = isHandicapActive(tournament);
  const showMisc = isMiscActive(tournament);
  const miscLabel = tournament.miscConfig?.label?.trim() || txt('ui.matchNotes.miscDefault', locale);

  const nameColW = showHcp && showMisc ? innerW * 0.42 : showHcp || showMisc ? innerW * 0.55 : innerW * 0.62;
  const hcpColW = showHcp ? 12 : 0;
  const miscColW = showMisc ? innerW * 0.18 : 0;
  const gameColW = (innerW - nameColW - hcpColW - miscColW) / GAMES_PER_MATCH;
  const compact = SLIP_ROWS >= 6;
  const gameBoxH = compact ? 5.5 : 7;
  const rowH = compact ? 7.5 : 9;
  const tableTop = y + (compact ? 2 : 3);

  let colX = originX + pad;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(txt('ui.matchNotes.player', locale), colX, tableTop);
  colX += nameColW;
  if (showHcp) {
    doc.text(txt('ui.matchNotes.handicap', locale), colX + 1, tableTop);
    colX += hcpColW;
  }
  if (showMisc) {
    doc.text(truncate(doc, miscLabel, miscColW - 1), colX + 1, tableTop);
    colX += miscColW;
  }
  for (let g = 0; g < GAMES_PER_MATCH; g++) {
    const gx = colX + g * gameColW + gameColW / 2;
    doc.text(txt('ui.matchNotes.gameN', locale, { n: String(g + 1) }), gx, tableTop, { align: 'center' });
  }

  const drawPlayerRow = (side: MatchNoteSlip['playerA'], rowY: number): void => {
    colX = originX + pad;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(compact ? 7.5 : 8.5);
    doc.text(truncate(doc, side.name, nameColW - 1), colX, rowY + (compact ? 4 : 5));
    colX += nameColW;
    if (showHcp) {
      doc.setFontSize(8);
      const hcp = side.handicap !== undefined ? String(side.handicap) : '—';
      doc.text(hcp, colX + 2, rowY + (compact ? 4 : 5));
      colX += hcpColW;
    }
    if (showMisc) {
      doc.text(truncate(doc, side.misc ?? '—', miscColW - 1), colX + 1, rowY + (compact ? 4 : 5));
      colX += miscColW;
    }
    for (let g = 0; g < GAMES_PER_MATCH; g++) {
      drawScoreBox(doc, colX + g * gameColW + 0.8, rowY + (compact ? 1 : 1.5), gameColW - 1.6, gameBoxH);
    }
  };

  drawPlayerRow(slip.playerA, tableTop + 2);
  drawPlayerRow(slip.playerB, tableTop + 2 + rowH);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(110);
  const footerY = originY + SLIP_H - pad - 1;
  doc.text(truncate(doc, tournamentName.trim() || txt('ui.pdf.tournament', locale), innerW * 0.7), originX + pad, footerY);
  doc.setTextColor(0);
}

export function buildMatchNotesPdfBlob(
  tournamentName: string,
  tournament: Tournament,
  segment: MatchNotesSegment,
  locale: Locale = 'en',
): Blob {
  const batches = collectMatchNoteSlipBatches(tournament, segment, locale);
  const doc = new jsPDF({
    unit: 'mm',
    format: PAGE_FORMAT,
    orientation: PAGE_ORIENTATION,
  });

  const segmentTitle = matchNotesSegmentLabel(tournament, segment, locale);

  let pageStarted = false;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    if (pageStarted) {
      doc.addPage(PAGE_FORMAT, PAGE_ORIENTATION);
    }
    for (let i = 0; i < batch.length; i++) {
      const slotOnPage = i % MATCH_NOTES_SLIPS_PER_PAGE;
      if (pageStarted && i > 0 && slotOnPage === 0) {
        doc.addPage(PAGE_FORMAT, PAGE_ORIENTATION);
      }
      pageStarted = true;
      const { x, y } = slipOrigin(slotOnPage);
      drawSlip(doc, batch[i]!, tournamentName, tournament, locale, x, y);
    }
  }

  doc.setProperties({
    title: `${segmentTitle} — ${tournamentName}`,
  });

  return doc.output('blob');
}

export function openMatchNotesPdfInNewTab(
  tournamentName: string,
  tournament: Tournament,
  segment: MatchNotesSegment,
  locale: Locale = 'en',
): void {
  const blob = buildMatchNotesPdfBlob(tournamentName, tournament, segment, locale);
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  if (!tab) {
    URL.revokeObjectURL(url);
    throw new Error('popup blocked');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
