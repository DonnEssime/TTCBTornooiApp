import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function clickUndo(page: Page): Promise<void> {
  await page.getByTestId('undo-btn').click();
}

export async function clickRedo(page: Page): Promise<void> {
  await page.getByTestId('redo-btn').click();
}

export async function expectRedoEnabled(page: Page, enabled: boolean): Promise<void> {
  const btn = page.getByTestId('redo-btn');
  if (enabled) await expect(btn).toBeEnabled();
  else await expect(btn).toBeDisabled();
}

export async function expectFooterLastCommand(page: Page, pattern: RegExp | string): Promise<void> {
  const el = page.getByTestId('footer-last-command');
  if (typeof pattern === 'string') await expect(el).toContainText(pattern);
  else await expect(el).toHaveText(pattern);
}
