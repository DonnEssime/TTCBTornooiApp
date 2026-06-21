import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { createGroupsByPlayerCount, debugSimulateGroup } from './helpers/groups';
import {
  createKnockoutClosedForm,
  removeBracket,
  openFirstBracketSlot,
  simulateBracketToCompletion,
  goToResultsTab,
} from './helpers/bracket';
import { fillBo5WinnerA, saveScoreModal } from './helpers/scores';
import { expectReplayRoundTrip, readBackend } from './helpers/backend';

async function completeGroups(page: import('@playwright/test').Page): Promise<void> {
  await createGroupsByPlayerCount(page, 4);
  while (true) {
    const { tournament } = await readBackend(page);
    const pending = Object.values(tournament.matches).filter(
      (m) => m.id.startsWith('gm-') && m.status !== 'finished',
    );
    if (pending.length === 0) break;
    await debugSimulateGroup(page);
  }
}

test.describe('05 bracket', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await completeGroups(page);
  });

  test('creates knockout with closed-form seeding', async ({ page }) => {
    await createKnockoutClosedForm(page);
    const { tournament, log } = await readBackend(page);
    expect(tournament.bracketMatches.length).toBeGreaterThan(0);
    expect(log.some((c) => c.type === 'GenerateBracket')).toBe(true);
    await expectReplayRoundTrip(page);
  });

  test('scores bracket match from slot click', async ({ page }) => {
    await createKnockoutClosedForm(page);
    await openFirstBracketSlot(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const { log } = await readBackend(page);
    expect(log.some((c) => c.type === 'EnterScore')).toBe(true);
    await expectReplayRoundTrip(page);
  });

  test('plays bracket to completion with hybrid simulate', async ({ page }) => {
    await createKnockoutClosedForm(page);
    await openFirstBracketSlot(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    await simulateBracketToCompletion(page);
    await goToResultsTab(page);
    await expect(page.locator('.placement-ol li').first()).toBeVisible();
  });

  test('removes bracket when no scores', async ({ page }) => {
    await createKnockoutClosedForm(page);
    await removeBracket(page);
    const { tournament } = await readBackend(page);
    expect(tournament.bracketMatches.length).toBe(0);
  });
});
