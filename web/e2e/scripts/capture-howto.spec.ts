/**
 * Capture NL how-to screenshots and emit docs/howto/TTCB-Tornooiapp-handleiding.pdf.
 * Run: npm run howto:pdf
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test, expect } from '../fixtures/test-fixture';
import { setLocale } from '../helpers/app';
import { enableHandicap } from '../helpers/wizard';
import { goToPlayersTab, openPlayerModal, closePlayerModal } from '../helpers/players';
import { goToGroupsTab, openFirstGroupCell } from '../helpers/groups';
import { goToBracketTab, waitForBracketCreated } from '../helpers/bracket';
import { fillBo5WinnerA, saveScoreModal } from '../helpers/scores';
import { dragReadyToTable, goToOverviewTab } from '../helpers/overview';
import {
  HOWTO_HTML,
  HOWTO_IMAGES_DIR,
  HOWTO_PDF,
  HOWTO_PLAYERS,
  finishGroupsAndReimport,
  shot,
} from '../helpers/howto';

test.describe('howto capture', () => {
  test('captures NL screenshots and builds PDF', async ({ page }) => {
    fs.mkdirSync(HOWTO_IMAGES_DIR, { recursive: true });

    // 1 — Locale
    await setLocale(page, 'nl');
    await expect(page.getByRole('button', { name: 'Instellingen', exact: true })).toBeVisible();
    await shot(page, '01-locale-nl.png');

    // 2 — Wizard (handicap on, debug off) before create
    await page.getByTestId('wizard-name').fill('Demo Tornooi');
    await enableHandicap(page, 0, 9, 7);
    await expect(page.getByTestId('wizard-debug')).not.toBeChecked();
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.getByTestId('wizard-name').scrollIntoViewIfNeeded();
    await shot(page, '02-wizard-config.png');
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByTestId('wizard-create').click();
    await expect(page.getByRole('button', { name: 'Demo Tornooi', exact: true })).toBeVisible();

    // 3 — Add player form
    await goToPlayersTab(page);
    const first = HOWTO_PLAYERS[0]!;
    await page.getByTestId('player-name-input').fill(first.name);
    await page.locator('#new-player-hc').fill(String(first.handicap));
    await shot(page, '03-add-player.png');
    await page.getByTestId('player-add-btn').click();

    for (const p of HOWTO_PLAYERS.slice(1)) {
      await page.getByTestId('player-name-input').fill(p.name);
      await page.locator('#new-player-hc').fill(String(p.handicap));
      await page.getByTestId('player-add-btn').click();
    }
    await shot(page, '04-players-list.png');

    // 5 — Groups create controls
    await goToGroupsTab(page);
    await page.locator('.group-create-num').first().fill('4');
    await shot(page, '05-groups-create.png');
    await page.getByTestId('groups-create-by-players').click();
    await expect(page.locator('.group-matrix-cell-btn').first()).toBeVisible();
    await shot(page, '06-group-matrix.png');

    // 7 — Score modal mid-entry
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await shot(page, '07-score-modal.png');
    await saveScoreModal(page);

    // 8 — Overview + drag to table
    await goToOverviewTab(page);
    await expect(page.locator('.ov-ready-item').first()).toBeVisible();
    await dragReadyToTable(page, 0);
    await expect(page.locator('.ov-table-tile.ov-table-busy').first()).toBeVisible({ timeout: 10_000 });
    await shot(page, '08-overview-drag.png');

    // 9 — Player modal (name / group / handicap)
    await openPlayerModal(page, first.name);
    await expect(page.getByTestId('player-history-name')).toBeVisible();
    await shot(page, '09-player-modal.png');
    await closePlayerModal(page);

    // Finish remaining group matches offline (no debug UI), re-import for bracket shots
    await finishGroupsAndReimport(page);
    await setLocale(page, 'nl');

    // 10 — Bracket options (Gekende formule)
    await goToBracketTab(page);
    await page.locator('input[value="crop_closed_form"]').check();
    await shot(page, '10-bracket-options.png');

    // 11 — Populated bracket
    await page.getByTestId('bracket-create').click();
    await waitForBracketCreated(page);
    await page.locator('.match-box--interactive').first().scrollIntoViewIfNeeded();
    await shot(page, '11-bracket-tree.png');

    // PDF from HTML how-to
    expect(fs.existsSync(HOWTO_HTML)).toBe(true);
    await page.goto(pathToFileURL(HOWTO_HTML).href);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: HOWTO_PDF,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
  });
});
