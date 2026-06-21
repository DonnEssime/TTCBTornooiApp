import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const BO5_WINNER_A = [
  [11, 9],
  [11, 6],
  [11, 5],
];

export async function fillBo5WinnerA(page: Page): Promise<void> {
  for (let i = 0; i < BO5_WINNER_A.length; i++) {
    const [a, b] = BO5_WINNER_A[i]!;
    await page.getByTestId(`score-g${i + 1}-a`).fill(String(a));
    await page.getByTestId(`score-g${i + 1}-b`).fill(String(b));
  }
}

export async function fillGameScores(page: Page, games: Array<[number, number]>): Promise<void> {
  for (let i = 0; i < games.length; i++) {
    const [a, b] = games[i]!;
    await page.getByTestId(`score-g${i + 1}-a`).fill(String(a));
    await page.getByTestId(`score-g${i + 1}-b`).fill(String(b));
  }
}

export async function saveScoreModal(page: Page): Promise<void> {
  await page.getByTestId('score-save').click();
  await page.getByTestId('score-modal').waitFor({ state: 'hidden' });
}

export async function cancelScoreModal(page: Page): Promise<void> {
  await page.getByTestId('score-cancel').click();
}

export async function clearBracketResult(page: Page): Promise<void> {
  await page.getByTestId('score-clear').click();
}

export async function debugSimulateScoreModal(page: Page): Promise<void> {
  await page.getByTestId('debug-simulate-score').click();
  await page.getByTestId('score-modal').waitFor({ state: 'hidden' });
}

export async function expectScoreModalOpen(page: Page): Promise<void> {
  await expect(page.getByTestId('score-modal')).toBeVisible();
}

export async function expectScoreModalReadOnly(page: Page): Promise<void> {
  await expect(page.getByTestId('score-save')).toBeDisabled();
}

export async function expectScoreHint(page: Page): Promise<void> {
  await expect(page.locator('.modal-error, .game-hint').first()).toBeVisible();
}
