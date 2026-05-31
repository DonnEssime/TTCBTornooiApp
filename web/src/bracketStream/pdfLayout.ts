import type { BracketMatch, Tournament } from 'ttc-tornooiapp';
import {
  bracketPlayerMatchId,
  gameWinner,
  inferBracketSlotCountFromRoundOne,
  isBracketByeWalkoverMatch,
  isBracketStructuralEmptyAdvanceWinner,
} from 'ttc-tornooiapp';
import { bracketTreeFromColumns, type BracketBNode } from './buildTree';
import { displayBracketColumns } from './displayColumns';
import { bracketSlotOutcome, type BracketSlotOutcome } from './slotOutcome';

export type BracketPdfBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  labelA: string;
  labelB: string;
  outcomeA: BracketSlotOutcome | null;
  outcomeB: BracketSlotOutcome | null;
  gamesA: string | null;
  gamesB: string | null;
  isFinal: boolean;
  done: boolean;
  hidden: boolean;
};

export type BracketPdfLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hidden?: boolean;
};

export type BracketStreamPdfLayout = {
  width: number;
  height: number;
  boxes: BracketPdfBox[];
  lines: BracketPdfLine[];
};

const BOX_W = 46;
const BOX_H = 17.5;
const CONN_W = 4.5;
const JOIN_W = 4.5;
const FEEDER_GAP = 1.5;
const FONT = 7;
const FONT_VS = 6;

function gamesWonForSlot(t: Tournament, bm: BracketMatch, side: 'a' | 'b', classId?: string): string | null {
  const w = bm.winner;
  if (!w || isBracketStructuralEmptyAdvanceWinner(w)) return null;
  const pid = side === 'a' ? bm.seedA : bm.seedB;
  if (!pid) return null;
  const pm = t.matches[bracketPlayerMatchId(bm.id, classId)];
  if (!pm || pm.groupId || pm.scores.length === 0) return null;
  const asA = pm.playerA === pid;
  const asB = pm.playerB === pid;
  if (!asA && !asB) return null;
  let n = 0;
  for (const g of pm.scores) {
    const gw = gameWinner(g);
    if (gw === 'A' && asA) n++;
    if (gw === 'B' && asB) n++;
  }
  return String(n);
}

function offsetBoxes(boxes: BracketPdfBox[], dx: number, dy: number): BracketPdfBox[] {
  return boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
}

function offsetLines(lines: BracketPdfLine[], dx: number, dy: number): BracketPdfLine[] {
  return lines.map((l) => ({
    x1: l.x1 + dx,
    y1: l.y1 + dy,
    x2: l.x2 + dx,
    y2: l.y2 + dy,
    hidden: l.hidden,
  }));
}

function connectorLinesLeft(
  feedersW: number,
  topSourceY: number,
  botSourceY: number,
  parentTopY: number,
  parentBotY: number,
  hideTop: boolean,
  hideBot: boolean,
): BracketPdfLine[] {
  const x0 = feedersW;
  const xMid = feedersW + CONN_W * 0.5;
  const x1 = feedersW + CONN_W;
  const hiddenTop = hideTop;
  const hiddenBot = hideBot;
  return [
    { x1: x0, y1: topSourceY, x2: xMid, y2: topSourceY, hidden: hiddenTop },
    { x1: x0, y1: botSourceY, x2: xMid, y2: botSourceY, hidden: hiddenBot },
    { x1: xMid, y1: topSourceY, x2: xMid, y2: parentTopY, hidden: hiddenTop },
    { x1: xMid, y1: botSourceY, x2: xMid, y2: parentBotY, hidden: hiddenBot },
    { x1: xMid, y1: parentTopY, x2: x1, y2: parentTopY, hidden: hiddenTop },
    { x1: xMid, y1: parentBotY, x2: x1, y2: parentBotY, hidden: hiddenBot },
  ];
}

/** Connector between feeders column and parent (right wing: parent on the left). */
function connectorLinesRight(
  parentRightX: number,
  topSourceY: number,
  botSourceY: number,
  parentTopY: number,
  parentBotY: number,
  hideTop: boolean,
  hideBot: boolean,
): BracketPdfLine[] {
  const xParent = parentRightX;
  const xMid = parentRightX + CONN_W * 0.5;
  const xFeed = parentRightX + CONN_W;
  const hiddenTop = hideTop;
  const hiddenBot = hideBot;
  return [
    { x1: xFeed, y1: topSourceY, x2: xMid, y2: topSourceY, hidden: hiddenTop },
    { x1: xFeed, y1: botSourceY, x2: xMid, y2: botSourceY, hidden: hiddenBot },
    { x1: xMid, y1: topSourceY, x2: xMid, y2: parentTopY, hidden: hiddenTop },
    { x1: xMid, y1: botSourceY, x2: xMid, y2: parentBotY, hidden: hiddenBot },
    { x1: xMid, y1: parentTopY, x2: xParent, y2: parentTopY, hidden: hiddenTop },
    { x1: xMid, y1: parentBotY, x2: xParent, y2: parentBotY, hidden: hiddenBot },
  ];
}

type SubtreeLayout = {
  width: number;
  height: number;
  boxes: BracketPdfBox[];
  lines: BracketPdfLine[];
  exitY: number;
};

function layoutSubtree(
  t: Tournament,
  node: BracketBNode,
  wing: 'left' | 'right',
  labelA: (m: BracketMatch, side: 'a' | 'b') => string,
  labelB: (m: BracketMatch, side: 'a' | 'b') => string,
  classId?: string,
): SubtreeLayout {
  const mkBox = (m: BracketMatch, x: number, y: number, isFinal: boolean): BracketPdfBox => ({
    x,
    y,
    w: BOX_W,
    h: BOX_H,
    labelA: labelA(m, 'a'),
    labelB: labelB(m, 'b'),
    outcomeA: bracketSlotOutcome(m, 'a'),
    outcomeB: bracketSlotOutcome(m, 'b'),
    gamesA: gamesWonForSlot(t, m, 'a', classId),
    gamesB: gamesWonForSlot(t, m, 'b', classId),
    isFinal,
    done: Boolean(m.winner),
    hidden: isBracketByeWalkoverMatch(m),
  });

  if (!node.left || !node.right) {
    return {
      width: BOX_W,
      height: BOX_H,
      boxes: [mkBox(node.match, 0, 0, false)],
      lines: [],
      exitY: BOX_H / 2,
    };
  }

  const L = layoutSubtree(t, node.left, wing, labelA, labelB, classId);
  const R = layoutSubtree(t, node.right, wing, labelA, labelB, classId);
  const feedersW = Math.max(L.width, R.width);
  const feedersH = L.height + FEEDER_GAP + R.height;
  const totalH = Math.max(feedersH, BOX_H);
  const parentY = (totalH - BOX_H) / 2;
  const parentTopY = parentY + BOX_H * 0.25;
  const parentBotY = parentY + BOX_H * 0.75;
  const exitY = parentY + BOX_H / 2;

  const boxes: BracketPdfBox[] = [];
  const lines: BracketPdfLine[] = [];

  if (wing === 'left') {
    const lDx = feedersW - L.width;
    const rDx = feedersW - R.width;
    const topSourceY = L.exitY;
    const botSourceY = R.exitY + L.height + FEEDER_GAP;
    boxes.push(
      ...offsetBoxes(L.boxes, lDx, 0),
      ...offsetBoxes(R.boxes, rDx, L.height + FEEDER_GAP),
      mkBox(node.match, feedersW + CONN_W, parentY, false),
    );
    lines.push(
      ...offsetLines(L.lines, lDx, 0),
      ...offsetLines(R.lines, rDx, L.height + FEEDER_GAP),
      ...connectorLinesLeft(
        feedersW,
        topSourceY,
        botSourceY,
        parentTopY,
        parentBotY,
        isBracketByeWalkoverMatch(node.left.match),
        isBracketByeWalkoverMatch(node.right.match),
      ),
    );
    return { width: feedersW + CONN_W + BOX_W, height: totalH, boxes, lines, exitY };
  }

  // Right wing: parent | connector | feeders (mirrored)
  const feederX = BOX_W + CONN_W;
  const topSourceY = L.exitY;
  const botSourceY = R.exitY + L.height + FEEDER_GAP;
  boxes.push(
    mkBox(node.match, 0, parentY, false),
    ...offsetBoxes(L.boxes, feederX, 0),
    ...offsetBoxes(R.boxes, feederX, L.height + FEEDER_GAP),
  );
  lines.push(
    ...offsetLines(L.lines, feederX, 0),
    ...offsetLines(R.lines, feederX, L.height + FEEDER_GAP),
    ...connectorLinesRight(
      BOX_W,
      topSourceY,
      botSourceY,
      parentTopY,
      parentBotY,
      isBracketByeWalkoverMatch(node.left.match),
      isBracketByeWalkoverMatch(node.right.match),
    ),
  );
  return { width: BOX_W + CONN_W + feedersW, height: totalH, boxes, lines, exitY };
}

function layoutStream(
  t: Tournament,
  root: BracketBNode,
  labelA: (m: BracketMatch, side: 'a' | 'b') => string,
  labelB: (m: BracketMatch, side: 'a' | 'b') => string,
  classId?: string,
): BracketStreamPdfLayout {
  const mkBox = (m: BracketMatch, x: number, y: number, isFinal: boolean): BracketPdfBox => ({
    x,
    y,
    w: BOX_W,
    h: BOX_H,
    labelA: labelA(m, 'a'),
    labelB: labelB(m, 'b'),
    outcomeA: bracketSlotOutcome(m, 'a'),
    outcomeB: bracketSlotOutcome(m, 'b'),
    gamesA: gamesWonForSlot(t, m, 'a', classId),
    gamesB: gamesWonForSlot(t, m, 'b', classId),
    isFinal,
    done: Boolean(m.winner),
    hidden: isBracketByeWalkoverMatch(m),
  });

  if (!root.left || !root.right) {
    return {
      width: BOX_W,
      height: BOX_H,
      boxes: [mkBox(root.match, 0, 0, true)],
      lines: [],
    };
  }

  const left = layoutSubtree(t, root.left, 'left', labelA, labelB, classId);
  const right = layoutSubtree(t, root.right, 'right', labelA, labelB, classId);
  const streamH = Math.max(left.height, right.height, BOX_H);
  const leftY = (streamH - left.height) / 2;
  const rightY = (streamH - right.height) / 2;
  const finalY = (streamH - BOX_H) / 2;
  const finalX = left.width + JOIN_W;
  const rightX = finalX + BOX_W + JOIN_W;
  const finalTopY = finalY + BOX_H * 0.25;
  const finalBotY = finalY + BOX_H * 0.75;
  const leftJoinX = left.width;
  const rightJoinX = rightX;
  const leftSourceY = left.exitY + leftY;
  const rightSourceY = right.exitY + rightY;

  const boxes = [
    ...offsetBoxes(left.boxes, 0, leftY),
    mkBox(root.match, finalX, finalY, true),
    ...offsetBoxes(right.boxes, rightX, rightY),
  ];
  const lines = [
    ...offsetLines(left.lines, 0, leftY),
    ...offsetLines(right.lines, rightX, rightY),
    { x1: leftJoinX, y1: leftSourceY, x2: finalX, y2: finalTopY },
    { x1: finalX + BOX_W, y1: finalBotY, x2: rightJoinX, y2: rightSourceY },
  ];

  return {
    width: left.width + JOIN_W + BOX_W + JOIN_W + right.width,
    height: streamH,
    boxes,
    lines,
  };
}

export function bracketStreamPdfLayout(
  t: Tournament,
  matches: BracketMatch[],
  slotLabel: (m: BracketMatch, side: 'a' | 'b') => string,
  classId?: string,
): BracketStreamPdfLayout | null {
  const cols = displayBracketColumns(matches);
  const slotCount = inferBracketSlotCountFromRoundOne(matches);
  const treeDepth =
    slotCount !== undefined && slotCount >= 2
      ? Math.trunc(Math.log2(slotCount))
      : cols.length;
  const treeCols = cols.slice(-treeDepth);
  const root = bracketTreeFromColumns(treeCols);
  if (!root) return null;
  return layoutStream(t, root, slotLabel, slotLabel, classId);
}
