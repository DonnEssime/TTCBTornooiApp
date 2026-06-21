/** Dev-only E2E test bridge — registered when `import.meta.env.VITE_E2E` is true. */

import type { Command, Tournament } from 'ttc-tornooiapp';
import { exportCommandsAsJsonLines } from 'ttc-tornooiapp';
import type { TournamentMeta } from '../tournamentStorage';
import { clearAllStoredTournaments, listRecentTournaments } from '../tournamentStorage';

export interface TournamentSessionBridge {
  tournamentName: string;
  controller: {
    getTournament(): Tournament;
    getCommandLog(): Command[];
    canRedo(): boolean;
  };
}

export interface TestBridgeDeps {
  getActiveSession(): TournamentSessionBridge | undefined;
}

export interface TtcTestBridge {
  getTournament(): Tournament | null;
  getCommandLog(): Command[];
  exportJsonl(): string;
  canUndo(): boolean;
  canRedo(): boolean;
  getLastCommandSummary(): string | null;
  clearOpfs(): Promise<void>;
  listRecent(): TournamentMeta[];
  getActiveTournamentName(): string | null;
}

declare global {
  interface Window {
    __ttcTest?: TtcTestBridge;
  }
}

let deps: TestBridgeDeps | null = null;

function latestUndoable(controller: TournamentSessionBridge['controller']): boolean {
  const log = controller.getCommandLog();
  for (let i = log.length - 1; i >= 0; i--) {
    const cmd = log[i]!;
    if (cmd.type === 'Undo') continue;
    // Approximate: undoLast will attempt the latest non-undo command
    return true;
  }
  return false;
}

function buildBridge(): TtcTestBridge {
  return {
    getTournament() {
      const s = deps?.getActiveSession();
      if (!s) return null;
      return structuredClone(s.controller.getTournament());
    },
    getCommandLog() {
      const s = deps?.getActiveSession();
      if (!s) return [];
      return structuredClone(s.controller.getCommandLog());
    },
    exportJsonl() {
      const s = deps?.getActiveSession();
      if (!s) return '';
      return exportCommandsAsJsonLines(s.controller.getCommandLog());
    },
    canUndo() {
      const s = deps?.getActiveSession();
      if (!s) return false;
      return latestUndoable(s.controller);
    },
    canRedo() {
      const s = deps?.getActiveSession();
      if (!s) return false;
      return s.controller.canRedo();
    },
    getLastCommandSummary() {
      const s = deps?.getActiveSession();
      if (!s) return null;
      const log = s.controller.getCommandLog();
      if (log.length === 0) return null;
      return log[log.length - 1]!.type;
    },
    async clearOpfs() {
      await clearAllStoredTournaments();
    },
    listRecent() {
      // Sync wrapper not possible; tests should use page.evaluate async
      throw new Error('Use listRecentAsync via page.evaluate');
    },
    getActiveTournamentName() {
      return deps?.getActiveSession()?.tournamentName ?? null;
    },
  };
}

/** Async helpers exposed separately for Playwright evaluate. */
export async function listRecentAsync(): Promise<TournamentMeta[]> {
  return listRecentTournaments();
}

export function installTestBridge(next: TestBridgeDeps): void {
  deps = next;
  const bridge = buildBridge();
  window.__ttcTest = {
    ...bridge,
    listRecent: () => {
      throw new Error('Use window.__ttcTestListRecent()');
    },
  };
  window.__ttcTestListRecent = listRecentAsync;
}

export function uninstallTestBridge(): void {
  deps = null;
  delete window.__ttcTest;
  delete window.__ttcTestListRecent;
}

declare global {
  interface Window {
    __ttcTestListRecent?: () => Promise<TournamentMeta[]>;
  }
}
