export type Locale = 'en' | 'nl';

export type MessageEntry = { en: string; nl: string };

export type MessageCatalog = Record<string, MessageEntry>;

export type ResolvedMessage = { text: string; isFallback: boolean };
