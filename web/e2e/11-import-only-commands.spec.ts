import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { importJsonlAndOpen } from './helpers/importExport';
import { fillBo5WinnerA, expectScoreModalOpen } from './helpers/scores';
import { goToBracketTab, openFirstBracketSlot } from './helpers/bracket';
import { readBackend } from './helpers/backend';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test.describe('11 import-only commands', () => {
  test('round lock fixture blocks saving scores', async ({ page }) => {
    await importJsonlAndOpen(page, path.join(fixturesDir, 'round-locked-r1.jsonl'));
    await goToBracketTab(page);
    await openFirstBracketSlot(page);
    await expectScoreModalOpen(page);
    await fillBo5WinnerA(page);
    await page.getByTestId('score-save').click();
    await expectScoreModalOpen(page);
    const { log } = await readBackend(page);
    expect(log.some((c) => c.type === 'EnterScore')).toBe(false);
  });

  test('group-phase-complete import opens on groups tab data', async ({ page }) => {
    await importJsonlAndOpen(page, path.join(fixturesDir, 'group-phase-complete.jsonl'));
    await page.getByTestId('tab-groups').click();
    await expect(page.locator('.group-matrix-table').first()).toBeVisible();
  });
});
