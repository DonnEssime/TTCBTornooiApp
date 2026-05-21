/** Browser-local tournament files (OPFS) for auto-save, recent list, and import. */

export interface TournamentMeta {
  fileId: string;
  tournamentName: string;
  /** ISO-8601 timestamp of last write. */
  lastModified: string;
}

const TOURNAMENTS_DIR = 'tournaments';
const LOG_SUFFIX = '.jsonl';
const META_SUFFIX = '.meta.json';
const MAX_RECENT = 32;

export function isTournamentStorageSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

async function tournamentsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(TOURNAMENTS_DIR, { create: true });
}

function logFileName(fileId: string): string {
  return `${fileId}${LOG_SUFFIX}`;
}

function metaFileName(fileId: string): string {
  return `${fileId}${META_SUFFIX}`;
}

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  contents: string,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

export async function saveTournament(
  fileId: string,
  tournamentName: string,
  jsonl: string,
): Promise<TournamentMeta> {
  const dir = await tournamentsDirectory();
  const meta: TournamentMeta = {
    fileId,
    tournamentName,
    lastModified: new Date().toISOString(),
  };
  await writeTextFile(dir, logFileName(fileId), jsonl);
  await writeTextFile(dir, metaFileName(fileId), JSON.stringify(meta));
  return meta;
}

export async function loadTournamentJsonl(fileId: string): Promise<string> {
  const dir = await tournamentsDirectory();
  const handle = await dir.getFileHandle(logFileName(fileId));
  const file = await handle.getFile();
  return file.text();
}

export async function listRecentTournaments(limit = MAX_RECENT): Promise<TournamentMeta[]> {
  const dir = await tournamentsDirectory();
  const metas: TournamentMeta[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (!name.endsWith(META_SUFFIX) || handle.kind !== 'file') continue;
    try {
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text()) as TournamentMeta;
      if (parsed?.fileId && parsed.tournamentName && parsed.lastModified) {
        metas.push(parsed);
      }
    } catch {
      // skip corrupt meta files
    }
  }
  metas.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return metas.slice(0, limit);
}

/** Copy imported JSONL into storage; returns the new file id. */
export async function importTournamentJsonl(
  jsonl: string,
  tournamentName: string,
): Promise<string> {
  const fileId = `tournament-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const normalized =
    jsonl.length === 0 ? '' : jsonl.endsWith('\n') ? jsonl : `${jsonl}\n`;
  await saveTournament(fileId, tournamentName, normalized);
  return fileId;
}

export function newTournamentFileId(): string {
  return `tournament-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

/** Remove stored JSONL and meta for a tournament (no-op if files are already gone). */
export async function deleteTournament(fileId: string): Promise<void> {
  const dir = await tournamentsDirectory();
  for (const name of [logFileName(fileId), metaFileName(fileId)]) {
    try {
      await dir.removeEntry(name);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) {
        throw e;
      }
    }
  }
}
