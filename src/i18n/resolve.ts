import type { Locale, MessageCatalog, MessageEntry, ResolvedMessage } from './types';
import { formatMessage } from './params';

function entryText(entry: MessageEntry, locale: Locale): { text: string; isFallback: boolean } {
  const primary = locale === 'nl' ? entry.nl : entry.en;
  const trimmed = primary.trim();
  if (locale === 'nl' && trimmed.length === 0) {
    return { text: entry.en, isFallback: true };
  }
  return { text: primary, isFallback: false };
}

export function resolveMessage(
  catalog: MessageCatalog,
  key: string,
  locale: Locale,
  params?: Record<string, string>,
): ResolvedMessage {
  const entry = catalog[key];
  if (!entry) {
    const text = formatMessage(key, params);
    return { text, isFallback: false };
  }
  const { text: raw, isFallback } = entryText(entry, locale);
  return { text: formatMessage(raw, params), isFallback };
}

export function messageText(
  catalog: MessageCatalog,
  key: string,
  locale: Locale,
  params?: Record<string, string>,
): string {
  return resolveMessage(catalog, key, locale, params).text;
}

export function allMessageKeys(catalog: MessageCatalog): string[] {
  return Object.keys(catalog).sort();
}

export function missingTranslations(catalog: MessageCatalog, locale: Locale): string[] {
  if (locale === 'en') return [];
  return allMessageKeys(catalog).filter((key) => {
    const entry = catalog[key]!;
    const en = entry.en.trim();
    const target = entry[locale].trim();
    return en.length > 0 && target.length === 0;
  });
}
