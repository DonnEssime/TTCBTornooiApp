import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { importJsonlFile } from './helpers/importExport';
import { exportPdfDownload } from './helpers/importExport';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test.describe('12 pdf exports', () => {
  test('tournament PDF download', async ({ page }) => {
    await importJsonlFile(page, path.join(fixturesDir, 'group-phase-complete.jsonl'));
    await page.getByRole('button', { name: /group-phase|tournament/i }).first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-pdf').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });
});
