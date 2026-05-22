import type { jsPDF } from 'jspdf';
import type { BracketPdfBox, BracketPdfLine, BracketStreamPdfLayout } from './pdfLayout';

const PAD = 1.2;
const BG = { r: 250, g: 250, b: 250 } as const;
const BORDER = { r: 100, g: 116, b: 139 } as const;
const FINAL_BORDER = { r: 71, g: 85, b: 105 } as const;
const LINE_COLOR = { r: 148, g: 163, b: 184 } as const;
const MUTED = { r: 100, g: 116, b: 139 } as const;
const TEXT = { r: 15, g: 23, b: 42 } as const;

function firstLine(doc: jsPDF, text: string, maxW: number): string {
  const lines = doc.splitTextToSize(text, maxW);
  return (lines[0] as string | undefined) ?? text;
}

function drawSlotLine(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  label: string,
  games: string | null,
  bold: boolean,
  muted: boolean,
  fontSize: number,
): void {
  const gamesW = games !== null ? 4 : 0;
  const labelW = w - gamesW;
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(muted ? MUTED.r : TEXT.r, muted ? MUTED.g : TEXT.g, muted ? MUTED.b : TEXT.b);
  doc.text(firstLine(doc, label, labelW), x, y, { baseline: 'middle', maxWidth: labelW });
  if (games !== null) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(games, x + labelW, y, { baseline: 'middle', align: 'right' });
  }
}

function drawMatchBox(
  doc: jsPDF,
  box: BracketPdfBox,
  ox: number,
  oy: number,
  scale: number,
  vsLabel: string,
): void {
  if (box.hidden) return;
  const x = ox + box.x * scale;
  const y = oy + box.y * scale;
  const w = box.w * scale;
  const h = box.h * scale;
  const border = box.isFinal ? FINAL_BORDER : BORDER;
  const fill = box.done ? { r: 241, g: 245, b: 249 } : { r: 255, g: 255, b: 255 };

  doc.setFillColor(fill.r, fill.g, fill.b);
  doc.setDrawColor(border.r, border.g, border.b);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');

  const innerW = w - PAD * 2;
  const lineA = y + h * 0.28;
  const lineVs = y + h * 0.5;
  const lineB = y + h * 0.72;
  const fs = Math.max(5.5, 7 * scale);

  drawSlotLine(
    doc,
    x + PAD,
    lineA,
    innerW,
    box.labelA,
    box.gamesA,
    box.outcomeA === 'winner',
    box.outcomeA === 'loser',
    fs,
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Math.max(5, 6 * scale));
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(vsLabel, x + w / 2, lineVs, { align: 'center', baseline: 'middle' });
  drawSlotLine(
    doc,
    x + PAD,
    lineB,
    innerW,
    box.labelB,
    box.gamesB,
    box.outcomeB === 'winner',
    box.outcomeB === 'loser',
    fs,
  );
  doc.setTextColor(TEXT.r, TEXT.g, TEXT.b);
}

function drawLines(doc: jsPDF, lines: BracketPdfLine[], ox: number, oy: number, scale: number): void {
  doc.setDrawColor(LINE_COLOR.r, LINE_COLOR.g, LINE_COLOR.b);
  doc.setLineWidth(0.25);
  for (const l of lines) {
    if (l.hidden) continue;
    doc.line(ox + l.x1 * scale, oy + l.y1 * scale, ox + l.x2 * scale, oy + l.y2 * scale);
  }
}

/** Draw bracket stream layout; returns bottom y (mm) on the page. */
export function drawBracketStreamOnPdf(
  doc: jsPDF,
  layout: BracketStreamPdfLayout,
  originX: number,
  originY: number,
  scale: number,
  vsLabel = 'vs',
): number {
  doc.setFillColor(BG.r, BG.g, BG.b);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  const bgW = layout.width * scale + 3;
  const bgH = layout.height * scale + 3;
  doc.roundedRect(originX - 1.5, originY - 1.5, bgW, bgH, 2, 2, 'FD');

  drawLines(doc, layout.lines, originX, originY, scale);
  for (const box of layout.boxes) {
    drawMatchBox(doc, box, originX, originY, scale, vsLabel);
  }
  return originY + layout.height * scale + 3;
}
