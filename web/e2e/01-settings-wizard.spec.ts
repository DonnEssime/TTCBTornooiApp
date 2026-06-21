import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament, enableHandicap, enableMisc, enableClasses, setWizardTableCount } from './helpers/wizard';
import { expectReplayRoundTrip, readBackend, expectLogContains } from './helpers/backend';
import { waitForTournamentTab, workspaceTab, gotoSettings, selectCompetitionClassTab } from './helpers/app';

test.describe('01 settings wizard', () => {
  test('creates minimal tournament with tables configured', async ({ page }) => {
    await createMinimalTournament(page, 'Wizard Minimal');
    const { tournament, log } = await readBackend(page);
    expect(tournament.tables.length).toBe(4);
    expect(log.some((c) => c.type === 'SetTournamentTables')).toBe(true);
    await expectReplayRoundTrip(page);
  });

  test('creates tournament with handicap config', async ({ page }) => {
    await page.getByTestId('wizard-name').fill('HC Tournament');
    await enableHandicap(page, 2, 8);
    await page.getByTestId('wizard-create').click();
    await waitForTournamentTab(page, 'HC Tournament');
    await expectLogContains(page, 'SetHandicapConfig');
    await expectReplayRoundTrip(page);
  });

  test('creates tournament with misc field', async ({ page }) => {
    await page.getByTestId('wizard-name').fill('Misc T');
    await enableMisc(page, 'Club');
    await page.getByTestId('wizard-create').click();
    await waitForTournamentTab(page, 'Misc T');
    await expectLogContains(page, 'SetMiscConfig');
    await expectReplayRoundTrip(page);
  });

  test('creates multi-class tournament', async ({ page }) => {
    await page.getByTestId('wizard-name').fill('Classes T');
    await enableClasses(page, ['Junior', 'Senior']);
    await page.getByTestId('wizard-create').click();
    await waitForTournamentTab(page, 'Classes T');
    await selectCompetitionClassTab(page, 'Junior');
    await expectLogContains(page, 'SetTournamentClasses');
    await expectReplayRoundTrip(page);
  });

  test('table count boundary 1 and 32', async ({ page }) => {
    await setWizardTableCount(page, 1);
    await createMinimalTournament(page, 'One Table');
    let { tournament } = await readBackend(page);
    expect(tournament.tables.length).toBe(1);

    await gotoSettings(page);
    await setWizardTableCount(page, 32);
    await createMinimalTournament(page, 'Many Tables');
    ({ tournament } = await readBackend(page));
    expect(tournament.tables.length).toBe(32);
  });

  test('rejects empty class name when classes enabled', async ({ page }) => {
    await page.getByTestId('wizard-name').fill('Bad Classes');
    await enableClasses(page, ['']);
    await page.getByTestId('wizard-create').click();
    await expect(page.getByTestId('status-banner')).toBeVisible();
    await expect(workspaceTab(page, 'Bad Classes')).toHaveCount(0);
  });
});
