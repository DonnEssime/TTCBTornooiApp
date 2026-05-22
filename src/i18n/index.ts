export type { Locale, MessageEntry, MessageCatalog, ResolvedMessage } from './types';
export { formatMessage } from './params';
export {
  resolveMessage,
  messageText,
  allMessageKeys,
  missingTranslations,
} from './resolve';
export { catalog, type MessageKey } from './catalog';
export { commandCatalog } from './catalog-command';
export { modelCatalog } from './catalog-model';
export { uiCatalog } from './catalog-ui';
export { uiSummaryCatalog } from './catalog-ui-summary';
export {
  commandFail,
  commandFailFromText,
  type CommandResult,
  type UndoCheckResult,
} from './command-result';

export type ModelReason = { key: MessageKey; params?: Record<string, string> };

import { catalog } from './catalog';
import type { Locale } from './types';
import { messageText, missingTranslations, resolveMessage, allMessageKeys } from './resolve';
import type { MessageKey } from './catalog';

export function t(key: MessageKey, locale: Locale, params?: Record<string, string>) {
  return resolveMessage(catalog, key, locale, params);
}

export function txt(key: MessageKey, locale: Locale, params?: Record<string, string>): string {
  return messageText(catalog, key, locale, params);
}

export function keys(): MessageKey[] {
  return allMessageKeys(catalog) as MessageKey[];
}

export function missingNl(): MessageKey[] {
  return missingTranslations(catalog, 'nl') as MessageKey[];
}

export { modelErrorToKey, modelErrorParams } from './model-error-map';
