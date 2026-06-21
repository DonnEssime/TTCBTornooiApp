import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { importJsonlFile } from './helpers/importExport';
import { expectReplayRoundTrip, exportJsonl, readBackend } from './helpers/backend';
import { closeActiveSession } from './helpers/storage';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test.describe('10 import export storage', () => {
  test('export JSONL replays identically', async ({ page }) => {
    await createMinimalTournament(page, 'Export Test');
    await debugFillPlayers(page, 4);
    await expectReplayRoundTrip(page);
    const jsonl = await exportJsonl(page);
    expect(jsonl).toContain('CreatePlayer');
  });

  test('imports valid JSONL fixture', async ({ page }) => {
    await importJsonlFile(page, path.join(fixturesDir, 'group-phase-complete.jsonl'));
    await page.getByRole('button', { name: /group-phase|Group|tournament/i }).first().waitFor();
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.matches).length).toBeGreaterThan(0);
  });

  test('rejects corrupt JSONL', async ({ page }) => {
    await importJsonlFile(page, path.join(fixturesDir, 'corrupt', 'invalid-format.jsonl'));
    await expect(page.getByTestId('status-banner')).toBeVisible();
  });

  test('close session keeps tournament in recent list', async ({ page }) => {
    await createMinimalTournament(page, 'Persist Me');
    await debugFillPlayers(page, 2);
    await closeActiveSession(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('recent-Persist Me')).toBeVisible();
  });
});
