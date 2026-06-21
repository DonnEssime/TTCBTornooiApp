import { test as base } from '@playwright/test';
import { resetAppState } from '../helpers/app';

export const test = base.extend({
  page: async ({ page }, use) => {
    await resetAppState(page);
    await use(page);
  },
});

test.describe.configure({ mode: 'serial' });

export { expect } from '@playwright/test';
