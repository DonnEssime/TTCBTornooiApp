import type { MessageKey } from './catalog';
import { modelErrorParams, modelErrorToKey } from './model-error-map';

export interface CommandResult {
  success: boolean;
  reason?: MessageKey;
  reasonParams?: Record<string, string>;
}

export function commandFail(key: MessageKey, params?: Record<string, string>): CommandResult {
  return params ? { success: false, reason: key, reasonParams: params } : { success: false, reason: key };
}

export function commandFailFromText(message: string): CommandResult {
  const key = modelErrorToKey(message);
  const params = modelErrorParams(message);
  return commandFail(key, params);
}

export type UndoCheckResult = { ok: boolean; reason?: MessageKey; reasonParams?: Record<string, string> };
