import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { enableDoubles, createGroupsByPlayerCount, debugSimulateGroup } from './helpers/groups';
import { createKnockoutClosedForm } from './helpers/bracket';
import { expectReplayRoundTrip, readBackend } from './helpers/backend';

async function completeDoublesGroups(page: import('@playwright/test').Page): Promise<void> {
  await enableDoubles(page);
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

test.describe('05 bracket doubles', () => {
  test('creates knockout with closed-form seeding for pair participants', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 16);
    await completeDoublesGroups(page);
    await createKnockoutClosedForm(page);
    const { tournament, log } = await readBackend(page);
    expect(tournament.bracketMatches.length).toBeGreaterThan(0);
    expect(tournament.competitionFormat).toBe('doubles-random-partners');
    const r1 = tournament.bracketMatches.filter((bm) => bm.round === 1 && bm.seedA && bm.seedB);
    expect(r1.length).toBeGreaterThan(0);
    for (const bm of r1) {
      expect(tournament.pairs?.[bm.seedA!]).toBeTruthy();
    }
    expect(log.some((c) => c.type === 'GenerateBracket')).toBe(true);
    await expect(page.locator('input[value="crop_closed_form"]')).toBeEnabled();
    await expectReplayRoundTrip(page);
  });
});
