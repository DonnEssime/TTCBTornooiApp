import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exportCommandsAsJsonLines,
  tournamentControllerFromCommandLog,
} from '../../../src/index';
import { goToGroupsTab } from './groups';
import { fillBo5WinnerA, saveScoreModal } from './scores';
import { exportJsonl, readBackend } from './backend';
import { importJsonlAndOpen } from './importExport';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HOWTO_DIR = path.resolve(__dirname, '../../../docs/howto');
export const HOWTO_IMAGES_DIR = path.join(HOWTO_DIR, 'images');
export const HOWTO_HTML = path.join(HOWTO_DIR, 'index.html');
export const HOWTO_PDF = path.join(HOWTO_DIR, 'TTCB-Tornooiapp-handleiding.pdf');

const BO5 = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

/** Fixed demo roster: Dutch-ish names with varied handicaps (reproducible screenshots). */
export const HOWTO_PLAYERS: Array<{ name: string; handicap: number }> = [
  { name: 'Jan Vermeer', handicap: 7 },
  { name: 'Lisa Bakker', handicap: 5 },
  { name: 'Tom de Vries', handicap: 8 },
  { name: 'Sara Jansen', handicap: 4 },
  { name: 'Piet Mulder', handicap: 6 },
  { name: 'Emma Visser', handicap: 3 },
  { name: 'Dirk Smit', handicap: 9 },
  { name: 'Anna Meijer', handicap: 2 },
  { name: 'Lucas de Boer', handicap: 7 },
  { name: 'Fleur Jacobs', handicap: 5 },
  { name: 'Mark Peters', handicap: 6 },
  { name: 'Noor Willems', handicap: 4 },
  { name: 'Bram Hendriks', handicap: 8 },
  { name: 'Iris Dekker', handicap: 1 },
  { name: 'Owen Vos', handicap: 7 },
  { name: 'Mila Bos', handicap: 0 },
];

export async function shot(
  page: Page,
  filename: string,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const file = path.join(HOWTO_IMAGES_DIR, filename);
  await page.screenshot({ path: file, clip, animations: 'disabled' });
}

/** Score unfinished group matches via the matrix UI (no debug tools). */
export async function completeAllGroupMatchesViaUi(page: Page, maxSteps = 48): Promise<void> {
  await goToGroupsTab(page);
  for (let step = 0; step < maxSteps; step++) {
    const { tournament } = await readBackend(page);
    const pending = Object.values(tournament.matches).filter(
      (m) => m.id.startsWith('gm-') && m.status !== 'finished',
    );
    if (pending.length === 0) return;

    const cell = page
      .locator('.group-matrix-cell-btn')
      .filter({ has: page.locator('.group-matrix-placeholder') })
      .first();
    await cell.click();
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
  }
  const { tournament } = await readBackend(page);
  const stillPending = Object.values(tournament.matches).filter(
    (m) => m.id.startsWith('gm-') && m.status !== 'finished',
  );
  if (stillPending.length > 0) {
    throw new Error(`completeAllGroupMatchesViaUi: ${stillPending.length} matches still pending`);
  }
}

/**
 * Finish remaining group matches offline (same EnterScore commands as the UI),
 * then re-import so the howto can show a full standings bracket without debug tools.
 */
export async function finishGroupsAndReimport(page: Page): Promise<string> {
  const jsonl = await exportJsonl(page);
  const { controller } = tournamentControllerFromCommandLog(jsonl);
  const pending = Object.values(controller.getTournament().matches).filter(
    (m) => m.id.startsWith('gm-') && m.status !== 'finished',
  );
  let n = 0;
  for (const m of pending) {
    const id = `howto-gm-score-${n++}`;
    const result = controller.enterScore(m.id, BO5, [], id);
    if (!result.success) {
      throw new Error(`EnterScore failed for ${m.id}: ${JSON.stringify(result)}`);
    }
  }
  const outPath = path.join(HOWTO_DIR, 'Demo-Tornooi.jsonl');
  fs.writeFileSync(outPath, exportCommandsAsJsonLines(controller.getCommandLog()), 'utf8');

  const closeBtn = page.getByRole('button', { name: /Tornooi sluiten|Close tournament/i });
  if (await closeBtn.count()) {
    await closeBtn.first().click();
  }
  await page.getByRole('button', { name: /Instellingen|Settings/, exact: true }).click();
  return importJsonlAndOpen(page, outPath);
}
