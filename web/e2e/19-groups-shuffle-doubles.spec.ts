import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { enableShuffleDoubles, goToGroupsTab } from './helpers/groups';
import {
  fillBo5WinnerA,
  saveScoreModal,
  expectScoreModalOpen,
} from './helpers/scores';
import { goToOverviewTab } from './helpers/overview';
import { expectReplayRoundTrip, readBackend } from './helpers/backend';

test.describe('19 groups shuffle doubles', () => {
  test('creates shuffle doubles groups and scores a match', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await enableShuffleDoubles(page);
    await goToGroupsTab(page);
    await page.getByTestId('groups-create-by-players').click();

    const { tournament } = await readBackend(page);
    expect(tournament.competitionFormat).toBe('doubles-shuffle-partners');
    const groupMatches = Object.values(tournament.matches).filter((m) => m.groupId && m.teamA && m.teamB);
    expect(groupMatches.length).toBe(6);
    for (const g of Object.values(tournament.groups)) {
      expect(g.playerIds.length).toBe(4);
    }

    await expect(page.locator('.group-shuffle-panel').first()).toBeVisible();
    await expect(page.getByTestId('tab-bracket')).toHaveCount(0);

    await page.locator('.shuffle-match-btn').first().click();
    await expectScoreModalOpen(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);

    const after = await readBackend(page);
    const finished = Object.values(after.tournament.matches).filter((m) => m.status === 'finished');
    expect(finished.length).toBe(1);

    await goToOverviewTab(page);
    await expect(page.locator('.ov-ready-list').first()).toBeVisible();

    await expectReplayRoundTrip(page);
  });

  test('blocks shuffle doubles with player count not divisible by 4', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 6);
    await enableShuffleDoubles(page);
    await expect(page.getByText(/4|quadruple|multiple of 4/i)).toBeVisible();
    await expect(page.getByTestId('groups-create-by-players')).toBeDisabled();
  });
});
