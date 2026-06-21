import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { importJsonlAndOpen } from './helpers/importExport';
import { readBackend, snapshotClassBracket } from './helpers/backend';
import { fillBo5WinnerA, saveScoreModal } from './helpers/scores';
import { selectCompetitionClassTab, selectClassTrackTab } from './helpers/app';

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
});
