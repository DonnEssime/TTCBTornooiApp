import { t, txt, type MessageKey, type ResolvedMessage } from 'ttc-tornooiapp';
import type { CommandResult } from 'ttc-tornooiapp';
import { getLocale } from './locale.svelte';

/** Resolve message for the active UI locale (reactive when called from $derived). */
export function msg(key: MessageKey, params?: Record<string, string>): ResolvedMessage {
  return t(key, getLocale(), params);
}

export function msgText(key: MessageKey, params?: Record<string, string>): string {
  return txt(key, getLocale(), params);
}

export function resolveCommandFailure(r: {
  reason?: MessageKey;
  reasonParams?: Record<string, string>;
}): ResolvedMessage {
  if (!r.reason) {
    return msg('command.dynamicError', { message: 'Unknown error' });
  }
  return msg(r.reason, r.reasonParams);
}

export function commandFailureText(r: {
  reason?: MessageKey;
  reasonParams?: Record<string, string>;
}): string {
  return resolveCommandFailure(r).text;
}
