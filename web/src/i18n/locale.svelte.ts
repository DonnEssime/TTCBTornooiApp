import type { Locale } from 'ttc-tornooiapp';

const STORAGE_KEY = 'ttc.locale';

function readInitialLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'en';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'nl' ? 'nl' : 'en';
}

let locale = $state<Locale>(readInitialLocale());

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  locale = next;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, next);
  }
}
