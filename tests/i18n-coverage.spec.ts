import { describe, it, expect } from 'vitest';
import { missingNl } from '../src/i18n';

describe('i18n coverage', () => {
  it('reports missing Dutch translations', () => {
    const missing = missingNl();
    for (const key of missing) {
      console.warn(`[i18n] missing NL: ${key}`);
    }
    expect(missing).toEqual([]);
  });
});
