import {
  t,
  txt,
  bracketKnockoutRoundParams,
  type BracketMatch,
  type MessageKey,
  type ResolvedMessage,
} from 'ttc-tornooiapp';
import type { CommandResult } from 'ttc-tornooiapp';
import { getLocale } from './locale.svelte';

const BRACKET_ROUND_REASON_KEYS = new Set<MessageKey>([
  'command.bracketRoundLocked',
  'model.bracketRoundLockedWithPeriod',
]);

/** Replace numeric `round` in stored command/model params with a localized knockout round name. */
export function enrichBracketRoundParams(
  params: Record<string, string> | undefined,
  bracketMatches: BracketMatch[],
  slotCount?: number,
  reason?: MessageKey,
): Record<string, string> | undefined {
  if (!params?.round) return params;
  if (reason && !BRACKET_ROUND_REASON_KEYS.has(reason)) return params;
  if (!/^\d+$/.test(params.round)) return params;
  const round = Number(params.round);
  return { ...params, ...bracketKnockoutRoundParams(getLocale(), round, bracketMatches, slotCount) };
}

/** Resolve message for the active UI locale (reactive when called from $derived). */
export function msg(key: MessageKey, params?: Record<string, string>): ResolvedMessage {
  return t(key, getLocale(), params);
}

export function msgText(key: MessageKey, params?: Record<string, string>): string {
  return txt(key, getLocale(), params);
}

export function resolveCommandFailure(
  r: {
    reason?: MessageKey;
    reasonParams?: Record<string, string>;
  },
  bracketMatches: BracketMatch[] = [],
  slotCount?: number,
): ResolvedMessage {
  if (!r.reason) {
    return msg('command.dynamicError', { message: 'Unknown error' });
  }
  const params = enrichBracketRoundParams(r.reasonParams, bracketMatches, slotCount, r.reason);
  return msg(r.reason, params);
}

export function commandFailureText(
  r: {
    reason?: MessageKey;
    reasonParams?: Record<string, string>;
  },
  bracketMatches: BracketMatch[] = [],
  slotCount?: number,
): string {
  return resolveCommandFailure(r, bracketMatches, slotCount).text;
}
