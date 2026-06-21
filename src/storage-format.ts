/** On-disk / export format for tournament command logs and OPFS meta (bump when breaking). */

export const TOURNAMENT_STORAGE_FORMAT_VERSION = 2;

/** Matches root `package.json` — embedded in saved files for debugging. */
export const APP_VERSION = '2.1.0';

export const TOURNAMENT_LOG_HEADER_TYPE = 'TournamentLogHeader' as const;

export interface TournamentLogHeader {
  type: typeof TOURNAMENT_LOG_HEADER_TYPE;
  formatVersion: number;
  appVersion: string;
}

export function buildLogHeader(): TournamentLogHeader {
  return {
    type: TOURNAMENT_LOG_HEADER_TYPE,
    formatVersion: TOURNAMENT_STORAGE_FORMAT_VERSION,
    appVersion: APP_VERSION,
  };
}

export function buildLogHeaderLine(): string {
  return JSON.stringify(buildLogHeader());
}

export function isLogHeaderLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as Partial<TournamentLogHeader>;
    return parsed?.type === TOURNAMENT_LOG_HEADER_TYPE;
  } catch {
    return false;
  }
}

export function parseLogHeader(line: string): TournamentLogHeader | null {
  if (!isLogHeaderLine(line)) return null;
  try {
    const parsed = JSON.parse(line) as TournamentLogHeader;
    if (parsed.type !== TOURNAMENT_LOG_HEADER_TYPE) return null;
    if (typeof parsed.formatVersion !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export type CommandLogFormatError =
  | { code: 'legacy'; message: string }
  | { code: 'unsupported_version'; message: string; formatVersion: number };

export function validateCommandLogFormat(text: string): CommandLogFormatError | null {
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return null;
  const header = parseLogHeader(first);
  if (!header) {
    return {
      code: 'legacy',
      message:
        'This tournament log has no format header (saved with an older app). Open it with that version, or import a log exported from the current app.',
    };
  }
  if (header.formatVersion !== TOURNAMENT_STORAGE_FORMAT_VERSION) {
    return {
      code: 'unsupported_version',
      formatVersion: header.formatVersion,
      message: `Unsupported tournament log format version ${header.formatVersion} (this app expects ${TOURNAMENT_STORAGE_FORMAT_VERSION}).`,
    };
  }
  return null;
}
