import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { importJsonlAndOpen } from './helpers/importExport';
import { readBackend, snapshotClassBracket } from './helpers/backend';
import { fillBo5WinnerA, saveScoreModal } from './helpers/scores';
import { selectCompetitionClassTab, selectClassTrackTab, waitForTournamentTab } from './helpers/app';
import { enableClasses } from './helpers/wizard';
import { addPlayer } from './helpers/players';
import { setPlayerClassFlag } from './helpers/classes';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test.describe('08 multi-class isolation', () => {
  test('imported two-class bracket keeps classes isolated', async ({ page }) => {
    await importJsonlAndOpen(page, path.join(fixturesDir, 'two-class-mid-bracket.jsonl'));
    const senBefore = await snapshotClassBracket(page, 'sen');
    await selectCompetitionClassTab(page, 'Junior');
    await selectClassTrackTab(page, 'Bracket');
    const slot = page.locator('.match-box--interactive').first();
    await slot.click();
    await page.getByTestId('score-modal').waitFor({ state: 'visible' });
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const senAfter = await snapshotClassBracket(page, 'sen');
    expect(senAfter).toBe(senBefore);
  });

  test('class-scoped match ids exist', async ({ page }) => {
    await importJsonlAndOpen(page, path.join(fixturesDir, 'two-class-mid-bracket.jsonl'));
    await selectCompetitionClassTab(page, 'Junior');
    const { tournament } = await readBackend(page);
    const junMatches = Object.keys(tournament.matches).filter((k) => k.includes('jun'));
    expect(junMatches.length).toBeGreaterThan(0);
  });

  test('class tabs show live player counts and new players are not auto-assigned', async ({ page }) => {
    await page.getByTestId('wizard-name').fill('Class Counts');
    await enableClasses(page, ['Junior', 'Senior']);
    await page.getByTestId('wizard-create').click();
    await waitForTournamentTab(page, 'Class Counts');

    const classTabs = page.locator('nav.inner-tabs:not(.class-track-tabs)');
    await expect(classTabs.getByRole('button', { name: 'Junior (0)', exact: true })).toBeVisible();
    await expect(classTabs.getByRole('button', { name: 'Senior (0)', exact: true })).toBeVisible();

    // Multi-class tournaments no longer auto-assign a new player to a class, so
    // both counts stay at 0 right after adding.
    await addPlayer(page, 'Alice');
    await expect(classTabs.getByRole('button', { name: 'Junior (0)', exact: true })).toBeVisible();
    await expect(classTabs.getByRole('button', { name: 'Senior (0)', exact: true })).toBeVisible();

    // Opting Alice into Junior updates that tab's count live, leaving Senior untouched.
    await setPlayerClassFlag(page, 'Alice', 'Junior', true);
    await expect(classTabs.getByRole('button', { name: 'Junior (1)', exact: true })).toBeVisible();
    await expect(classTabs.getByRole('button', { name: 'Senior (0)', exact: true })).toBeVisible();

    await addPlayer(page, 'Bob');
    await setPlayerClassFlag(page, 'Bob', 'Senior', true);
    await expect(classTabs.getByRole('button', { name: 'Junior (1)', exact: true })).toBeVisible();
    await expect(classTabs.getByRole('button', { name: 'Senior (1)', exact: true })).toBeVisible();
  });
});
