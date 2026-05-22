import { Command, CommandRunner } from './command';
import {
  buildLogHeaderLine,
  isLogHeaderLine,
  TOURNAMENT_STORAGE_FORMAT_VERSION,
  validateCommandLogFormat,
} from './storage-format';

export {
  APP_VERSION,
  TOURNAMENT_STORAGE_FORMAT_VERSION,
  TOURNAMENT_LOG_HEADER_TYPE,
  type TournamentLogHeader,
  buildLogHeader,
  buildLogHeaderLine,
  validateCommandLogFormat,
  type CommandLogFormatError,
} from './storage-format';

export function commandToJsonLine(command: Command): string {
  return JSON.stringify(command);
}

export function exportCommandsAsJsonLines(commands: Command[]): string {
  const header = buildLogHeaderLine();
  const body = commands.map(commandToJsonLine).join('\n');
  if (!body) return `${header}\n`;
  return `${header}\n${body}\n`;
}

export function commandFromJsonLine(line: string): Command | null {
  try {
    const parsed = JSON.parse(line) as Command;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.id || !parsed.type || !parsed.timestamp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCommandLogLines(text: string): string[] {
  const formatError = validateCommandLogFormat(text);
  if (formatError) {
    throw new Error(formatError.message);
  }
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > 0 && isLogHeaderLine(lines[0]!)) {
    return lines.slice(1);
  }
  return lines;
}

export type ReplayExecuteTiming = {
  commandId: string;
  commandType: string;
  durationMs: number;
};

export type ReplayExecuteProfileByType = {
  type: string;
  count: number;
  totalMs: number;
  avgMs: number;
};

export type ReplayExecuteProfile = {
  commandCount: number;
  totalExecuteMs: number;
  avgExecuteMs: number;
  byType: ReplayExecuteProfileByType[];
  slowest: ReplayExecuteTiming;
};

export type ReplayResult = {
  success: boolean;
  results: Array<{ id: string; success: boolean; reason?: import('./i18n').MessageKey; reasonParams?: Record<string, string> }>;
  executeProfile?: ReplayExecuteProfile;
};

export type ReplayProgress = { done: number; total: number };

export type ReplayAsyncOptions = {
  onProgress?: (progress: ReplayProgress) => void;
  /** Yield to the event loop every N commands (default 32). Use 0 to run without yielding. */
  yieldEvery?: number;
  /** Time each `commandRunner.execute` and attach `executeProfile` to the replay result. */
  profileExecute?: boolean;
};

class ExecuteProfileCollector {
  private samples: ReplayExecuteTiming[] = [];

  record(cmd: Command, durationMs: number): void {
    this.samples.push({
      commandId: cmd.id,
      commandType: cmd.type,
      durationMs,
    });
  }

  build(): ReplayExecuteProfile | undefined {
    if (this.samples.length === 0) return undefined;
    const totalsByType = new Map<string, { count: number; totalMs: number }>();
    let totalExecuteMs = 0;
    let slowest = this.samples[0]!;
    for (const sample of this.samples) {
      totalExecuteMs += sample.durationMs;
      if (sample.durationMs > slowest.durationMs) slowest = sample;
      const prev = totalsByType.get(sample.commandType) ?? { count: 0, totalMs: 0 };
      totalsByType.set(sample.commandType, {
        count: prev.count + 1,
        totalMs: prev.totalMs + sample.durationMs,
      });
    }
    const commandCount = this.samples.length;
    const byType = [...totalsByType.entries()]
      .map(([type, { count, totalMs }]) => ({
        type,
        count,
        totalMs,
        avgMs: totalMs / count,
      }))
      .sort((a, b) => b.totalMs - a.totalMs || a.type.localeCompare(b.type));
    return {
      commandCount,
      totalExecuteMs,
      avgExecuteMs: totalExecuteMs / commandCount,
      byType,
      slowest,
    };
  }
}

function executeWithOptionalProfile(
  runner: CommandRunner,
  cmd: Command,
  collector?: ExecuteProfileCollector,
): ReturnType<CommandRunner['execute']> {
  if (!collector) return runner.execute(cmd);
  const t0 = performance.now();
  const result = runner.execute(cmd);
  collector.record(cmd, performance.now() - t0);
  return result;
}

export function replayCommandsFromJsonLines(
  lines: string[],
  runner?: CommandRunner,
  options: Pick<ReplayAsyncOptions, 'profileExecute'> = {},
): ReplayResult {
  const commandRunner = runner ?? new CommandRunner();
  const results: ReplayResult['results'] = [];
  const profileCollector = options.profileExecute ? new ExecuteProfileCollector() : undefined;

  for (const line of lines) {
    const cmd = commandFromJsonLine(line);
    if (!cmd) {
      return { success: false, results: [{ id: 'unknown', success: false, reason: 'command.invalidCommandFormat' }] };
    }
    const result = executeWithOptionalProfile(commandRunner, cmd, profileCollector);
    results.push({ id: cmd.id, ...result });
    if (!result.success) {
      return { success: false, results, executeProfile: profileCollector?.build() };
    }
  }

  return { success: true, results, executeProfile: profileCollector?.build() };
}

export async function replayCommandsFromJsonLinesAsync(
  lines: string[],
  runner?: CommandRunner,
  options: ReplayAsyncOptions = {},
): Promise<ReplayResult> {
  const commandRunner = runner ?? new CommandRunner();
  const results: ReplayResult['results'] = [];
  const total = lines.length;
  const yieldEvery = options.yieldEvery ?? 32;
  const profileCollector = options.profileExecute ? new ExecuteProfileCollector() : undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const cmd = commandFromJsonLine(line);
    if (!cmd) {
      return { success: false, results: [{ id: 'unknown', success: false, reason: 'command.invalidCommandFormat' }] };
    }
    const result = executeWithOptionalProfile(commandRunner, cmd, profileCollector);
    results.push({ id: cmd.id, ...result });
    if (!result.success) {
      return { success: false, results, executeProfile: profileCollector?.build() };
    }

    const done = i + 1;
    if (options.onProgress && (done === 1 || done === total || done % Math.max(1, yieldEvery) === 0)) {
      options.onProgress({ done, total });
    }
    if (yieldEvery > 0 && done < total && done % yieldEvery === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (options.onProgress && total > 0) {
    options.onProgress({ done: total, total });
  }

  return { success: true, results, executeProfile: profileCollector?.build() };
}
