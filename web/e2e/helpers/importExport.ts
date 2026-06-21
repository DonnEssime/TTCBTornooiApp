import type { Page } from '@playwright/test';
import path from 'node:path';
import { expect } from '@playwright/test';
import { waitForTournamentTab } from './app';

export function importTournamentNameFromPath(filePath: string): string {
  const base = filePath.replace(/^.*[/\\]/, '');
  return base.replace(/\.(jsonl|json|txt)$/i, '');
}

export async function importJsonlFile(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('import-jsonl').setInputFiles(filePath);
  await page.locator('#tournament-load-title').waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});
}

/** Import JSONL and wait until the workspace session tab for that file is active. */
export async function importJsonlAndOpen(page: Page, filePath: string): Promise<string> {
  const name = importTournamentNameFromPath(filePath);
  await importJsonlFile(page, filePath);
  await waitForTournamentTab(page, name);
  return name;
}

export async function exportJsonlDownload(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-jsonl').click();
  const download = await downloadPromise;
  const filePath = path.join(await download.path() ?? '', download.suggestedFilename());
  return filePath;
}

export async function exportPdfDownload(page: Page): Promise<void> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-pdf').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
}

export async function exportClassPdf(page: Page): Promise<void> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-class-pdf').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
}
