import type { Command, Tournament } from 'ttc-tornooiapp';
import type { TournamentMeta } from '../src/tournamentStorage';

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
    __ttcTestListRecent?: () => Promise<TournamentMeta[]>;
  }
}

export {};
